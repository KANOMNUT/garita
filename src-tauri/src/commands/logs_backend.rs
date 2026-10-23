//! Historical logs from Loki or VictoriaLogs through the API server's service
//! proxy (v2.3.0). Read-only. Lines come back chronological, RFC3339Nano.

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::observability::{
    escape_label, proxy_get, proxy_path, valid_field_name, valid_subdomain, LogLabelMap, LogsTarget,
};
use super::utils::client_for_context;
use crate::launch::valid_namespace;

const MAX_LINES: u32 = 5000;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendLogLine {
    /// RFC3339Nano
    pub ts: String,
    pub line: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendLogs {
    pub lines: Vec<BackendLogLine>,
    pub truncated: bool,
}

/// Label presets per flavour (T70-6).
pub fn label_preset(flavour: &str) -> Option<LogLabelMap> {
    let m = |a: &str, b: &str, c: &str| LogLabelMap { namespace: a.into(), pod: b.into(), container: c.into() };
    match flavour {
        "loki" => Some(m("namespace", "pod", "container")),
        "victorialogs" => Some(m("kubernetes.pod_namespace", "kubernetes.pod_name", "kubernetes.container_name")),
        _ => None,
    }
}

/// Empty names fall back to the flavour's preset; all must be valid field names.
fn resolve_labels(flavour: &str, l: &LogLabelMap) -> Result<LogLabelMap, String> {
    let p = label_preset(flavour).ok_or_else(|| format!("unknown log backend '{}'", flavour))?;
    let pick = |v: &str, d: String| if v.is_empty() { d } else { v.to_string() };
    let out = LogLabelMap {
        namespace: pick(&l.namespace, p.namespace),
        pod: pick(&l.pod, p.pod),
        container: pick(&l.container, p.container),
    };
    for n in [&out.namespace, &out.pod, &out.container] {
        if !valid_field_name(n) {
            return Err(format!("invalid label name '{}'", n));
        }
    }
    Ok(out)
}

/// (label name, value) filters; the container filter only when asked.
fn filters(l: &LogLabelMap, ns: &str, pod: &str, container: Option<&str>) -> Result<Vec<(String, String)>, String> {
    if !valid_namespace(ns) {
        return Err(format!("invalid namespace '{}'", ns));
    }
    if !valid_subdomain(pod) {
        return Err(format!("invalid pod name '{}'", pod));
    }
    let mut f = vec![(l.namespace.clone(), escape_label(ns)?), (l.pod.clone(), escape_label(pod)?)];
    if let Some(c) = container.filter(|c| !c.is_empty()) {
        if !valid_namespace(c) {
            return Err(format!("invalid container name '{}'", c));
        }
        f.push((l.container.clone(), escape_label(c)?));
    }
    Ok(f)
}

fn loki_query(f: &[(String, String)]) -> String {
    let parts: Vec<String> = f.iter().map(|(k, v)| format!("{}=\"{}\"", k, v)).collect();
    format!("{{{}}}", parts.join(","))
}

fn vl_query(f: &[(String, String)], limit: u32) -> String {
    let parts: Vec<String> = f.iter().map(|(k, v)| format!("\"{}\":=\"{}\"", k, v)).collect();
    format!("{} | sort by (_time) desc limit {}", parts.join(" "), limit)
}

fn nanos_ts(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Nanos, true)
}

/// Sort chronologically, keep the newest `limit`. Returns (lines, truncated).
fn finish(mut raw: Vec<(Option<DateTime<Utc>>, String, String)>, limit: usize) -> BackendLogs {
    let truncated = raw.len() >= limit;
    raw.sort_by_key(|r| r.0);
    let skip = raw.len().saturating_sub(limit);
    let lines = raw
        .into_iter()
        .skip(skip)
        .map(|(dt, raw_ts, line)| BackendLogLine { ts: dt.as_ref().map(nanos_ts).unwrap_or(raw_ts), line })
        .collect();
    BackendLogs { lines, truncated }
}

/// Loki `query_range` response (streams). No panics on any input.
fn parse_loki(body: &str, limit: usize) -> Result<BackendLogs, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "response is not JSON".to_string())?;
    if v.get("status").and_then(Value::as_str) != Some("success") {
        return Err("backend reported an error".to_string());
    }
    let streams = v
        .get("data")
        .and_then(|d| d.get("result"))
        .and_then(Value::as_array)
        .ok_or("missing result")?;
    let mut raw = Vec::new();
    for s in streams {
        for e in s.get("values").and_then(Value::as_array).into_iter().flatten() {
            let Some(pair) = e.as_array() else { continue };
            let (Some(ts), Some(line)) = (
                pair.first().and_then(Value::as_str),
                pair.get(1).and_then(Value::as_str),
            ) else { continue };
            let dt = ts
                .parse::<i64>()
                .ok()
                .and_then(|n| DateTime::from_timestamp(n.div_euclid(1_000_000_000), n.rem_euclid(1_000_000_000) as u32));
            raw.push((dt, ts.to_string(), line.to_string()));
        }
    }
    Ok(finish(raw, limit))
}

/// VictoriaLogs NDJSON (`_time`, `_msg`). Bad lines are skipped.
fn parse_vl(body: &str, limit: usize) -> BackendLogs {
    let raw = body
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|v| {
            let ts = v.get("_time")?.as_str()?.to_string();
            let msg = v.get("_msg")?.as_str()?.to_string();
            let dt = DateTime::parse_from_rfc3339(&ts).ok().map(|d| d.with_timezone(&Utc));
            Some((dt, ts, msg))
        })
        .collect();
    finish(raw, limit)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_backend_logs(
    context: String,
    target: LogsTarget,
    namespace: String,
    pod: String,
    container: Option<String>,
    start: i64,
    end: i64,
    limit: Option<u32>,
) -> Result<BackendLogs, String> {
    let fail = |e: String| format!("Failed to query logs: {}", e);
    if end <= start {
        return Err(fail("end must be after start".to_string()));
    }
    let limit = limit.unwrap_or(MAX_LINES).clamp(1, MAX_LINES);
    let labels = resolve_labels(&target.flavour, &target.labels).map_err(fail)?;
    let f = filters(&labels, &namespace, &pod, container.as_deref()).map_err(fail)?;
    let lim = limit.to_string();
    let path = if target.flavour == "loki" {
        let ns = |s: i64| s.checked_mul(1_000_000_000).map(|n| n.to_string()).ok_or("time out of range".to_string());
        let (s, e) = (ns(start).map_err(fail)?, ns(end).map_err(fail)?);
        proxy_path(
            &target.service,
            "/loki/api/v1/query_range",
            &[("query", &loki_query(&f)), ("start", &s), ("end", &e), ("limit", &lim), ("direction", "backward")],
        )
    } else {
        let (s, e) = (start.to_string(), end.to_string());
        proxy_path(
            &target.service,
            "/select/logsql/query",
            &[("query", &vl_query(&f, limit)), ("start", &s), ("end", &e), ("limit", &lim)],
        )
    }
    .map_err(fail)?;
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let body = proxy_get(&client, &target.service, &path).await.map_err(|e| e.into_msg("logs"))?;
    if target.flavour == "loki" {
        parse_loki(&body, limit as usize).map_err(fail)
    } else {
        Ok(parse_vl(&body, limit as usize))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets() {
        let l = label_preset("loki").unwrap();
        assert_eq!((l.namespace.as_str(), l.pod.as_str(), l.container.as_str()), ("namespace", "pod", "container"));
        let v = label_preset("victorialogs").unwrap();
        assert_eq!(v.pod, "kubernetes.pod_name");
        assert_eq!(v.container, "kubernetes.container_name");
        assert_eq!(v.namespace, "kubernetes.pod_namespace");
        assert!(label_preset("x").is_none());
    }

    #[test]
    fn labels_resolve_and_validate() {
        let empty = LogLabelMap { namespace: "".into(), pod: "".into(), container: "".into() };
        assert_eq!(resolve_labels("loki", &empty).unwrap().pod, "pod");
        let custom = LogLabelMap { namespace: "ns".into(), pod: "p".into(), container: "c".into() };
        assert_eq!(resolve_labels("loki", &custom).unwrap().namespace, "ns");
        let bad = LogLabelMap { namespace: "a\"}".into(), pod: "p".into(), container: "c".into() };
        assert!(resolve_labels("loki", &bad).is_err());
        assert!(resolve_labels("nope", &empty).is_err());
    }

    #[test]
    fn queries_build() {
        let l = label_preset("loki").unwrap();
        let f = filters(&l, "ns", "web-1", Some("app")).unwrap();
        assert_eq!(loki_query(&f), r#"{namespace="ns",pod="web-1",container="app"}"#);
        assert_eq!(loki_query(&filters(&l, "ns", "web-1", None).unwrap()), r#"{namespace="ns",pod="web-1"}"#);
        let v = label_preset("victorialogs").unwrap();
        let q = vl_query(&filters(&v, "ns", "web-1", Some("")).unwrap(), 10);
        assert_eq!(
            q,
            r#""kubernetes.pod_namespace":="ns" "kubernetes.pod_name":="web-1" | sort by (_time) desc limit 10"#
        );
        assert!(filters(&l, "ns", "p\"q", None).is_err());
        assert!(filters(&l, "ns", "p", Some("c\n")).is_err());
    }

    #[test]
    fn loki_orders_and_caps() {
        let b = r#"{"status":"success","data":{"resultType":"streams","result":[
          {"stream":{},"values":[["1700000000000000003","c"],["1700000000000000001","a"]]},
          {"stream":{},"values":[["1700000000000000002","b"],["bad"],[1,2]]}]}}"#;
        let r = parse_loki(b, 10).unwrap();
        assert!(!r.truncated);
        assert_eq!(r.lines.iter().map(|l| l.line.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
        assert_eq!(r.lines[0].ts, "2023-11-14T22:13:20.000000001Z");
        let c = parse_loki(b, 2).unwrap();
        assert!(c.truncated);
        assert_eq!(c.lines.iter().map(|l| l.line.as_str()).collect::<Vec<_>>(), ["b", "c"]);
    }

    #[test]
    fn loki_bad_input() {
        assert!(parse_loki("<html>", 5).is_err());
        assert!(parse_loki(r#"{"status":"error"}"#, 5).is_err());
        assert!(parse_loki(r#"{"status":"success","data":{}}"#, 5).is_err());
        assert!(parse_loki(r#"{"status":"success","data":{"result":[]}}"#, 5).unwrap().lines.is_empty());
        assert!(parse_loki(r#"{"status":"success","data":{"result":[1,{"values":3},{"values":[["99999999999999999999","x"]]}]}}"#, 5).is_ok());
    }

    #[test]
    fn vl_orders_normalises_and_skips_junk() {
        let b = "{\"_time\":\"2024-01-01T00:00:00.1Z\",\"_msg\":\"later\"}\nnot json\n{\"_time\":\"2024-01-01T00:00:00.05Z\",\"_msg\":\"first\"}\n{\"_msg\":\"no time\"}\n\n";
        let r = parse_vl(b, 10);
        assert_eq!(r.lines.iter().map(|l| l.line.as_str()).collect::<Vec<_>>(), ["first", "later"]);
        assert_eq!(r.lines[0].ts, "2024-01-01T00:00:00.050000000Z");
        let c = parse_vl(b, 1);
        assert!(c.truncated);
        assert_eq!(c.lines[0].line, "later");
        assert!(parse_vl("", 5).lines.is_empty());
    }
}
