//! Prometheus range queries through the API server's service proxy (v2.3.0).
//! Closed template set; the PromQL is built here only. Read-only.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::observability::{
    escape_label, proxy_get, proxy_path, valid_subdomain, ProxyErr, ServiceTarget,
};
use super::utils::client_for_context;
use crate::launch::valid_namespace;

const MAX_POINTS: usize = 1100;
const MAX_SERIES: usize = 20;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MetricSeries {
    pub label: String,
    /// (unix seconds, value)
    pub points: Vec<(i64, f64)>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MetricRange {
    pub template: String,
    /// "millicores" | "MiB"
    pub unit: String,
    pub series: Vec<MetricSeries>,
    pub truncated: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackendProbe {
    /// "ok" | "unreachable" | "forbidden" | "wrong-service"
    pub state: String,
    pub message: String,
    pub version: Option<String>,
}

struct Rendered {
    query: String,
    fallback: Option<String>,
    unit: &'static str,
}

/// Build the PromQL for a template. Names are shape-validated, then escaped.
fn render(template: &str, ns: &str, name: &str, container: Option<&str>) -> Result<Rendered, String> {
    let pod_sel = |ns: &str, pod: &str| -> Result<String, String> {
        if !valid_namespace(ns) {
            return Err(format!("invalid namespace '{}'", ns));
        }
        if !valid_subdomain(pod) {
            return Err(format!("invalid pod name '{}'", pod));
        }
        let c = match container {
            Some(c) if !c.is_empty() => {
                if !valid_namespace(c) {
                    return Err(format!("invalid container name '{}'", c));
                }
                format!("container=\"{}\"", escape_label(c)?)
            }
            _ => "container!=\"\",container!=\"POD\"".to_string(),
        };
        Ok(format!("namespace=\"{}\",pod=\"{}\",{}", escape_label(ns)?, escape_label(pod)?, c))
    };
    let node_re = |node: &str| -> Result<String, String> {
        if !valid_subdomain(node) {
            return Err(format!("invalid node name '{}'", node));
        }
        // only '.' is regex-special in a node name; escape it, then the string escape.
        escape_label(&node.replace('.', "\\."))
    };
    let pod_cpu = |sel: &str| format!("sum by (container) (rate(container_cpu_usage_seconds_total{{{}}}[5m])) * 1000", sel);
    let pod_mem = |sel: &str| format!("sum by (container) (container_memory_working_set_bytes{{{}}}) / 1048576", sel);
    let (query, fallback, unit) = match template {
        "pod-cpu" => (pod_cpu(&pod_sel(ns, name)?), None, "millicores"),
        "pod-mem" => (pod_mem(&pod_sel(ns, name)?), None, "MiB"),
        // ponytail: node identity differs per Prometheus setup; selectors are tried in this order; §6.2 rows decide; add a selector here
        "node-cpu" => {
            let re = node_re(name)?;
            let n = escape_label(name)?;
            (
                format!("sum(rate(node_cpu_seconds_total{{mode!=\"idle\"}}[5m]) * on(instance) group_left() node_uname_info{{nodename=\"{n}\"}}) * 1000"),
                Some(format!("sum(rate(container_cpu_usage_seconds_total{{id=\"/\",node=\"{n}\"}}[5m])) * 1000 or sum(rate(container_cpu_usage_seconds_total{{id=\"/\",instance=~\"{re}(:.*)?\"}}[5m])) * 1000")),
                "millicores",
            )
        }
        "node-mem" => {
            let re = node_re(name)?;
            let n = escape_label(name)?;
            (
                format!("sum((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) * on(instance) group_left() node_uname_info{{nodename=\"{n}\"}}) / 1048576"),
                Some(format!("sum(container_memory_working_set_bytes{{id=\"/\",node=\"{n}\"}}) / 1048576 or sum(container_memory_working_set_bytes{{id=\"/\",instance=~\"{re}(:.*)?\"}}) / 1048576")),
                "MiB",
            )
        }
        other => return Err(format!("unknown template '{}'", other)),
    };
    Ok(Rendered { query, fallback, unit })
}

/// Keep the point count at or under MAX_POINTS by widening the step.
fn effective_step(start: i64, end: i64, step: i64) -> Result<i64, String> {
    let span = end.checked_sub(start).filter(|s| *s > 0).ok_or("end must be after start")?;
    let min_step = span.saturating_add(MAX_POINTS as i64 - 2) / (MAX_POINTS as i64 - 1);
    Ok(step.max(1).max(min_step))
}

fn err_text(v: &Value) -> String {
    let t = v.get("errorType").and_then(Value::as_str).unwrap_or("error");
    let e = v.get("error").and_then(Value::as_str).unwrap_or("");
    format!("{}: {}", t, e).chars().take(200).collect()
}

/// Parse a Prometheus matrix response. No panics on any input.
fn parse_matrix(body: &str, default_label: &str) -> Result<(Vec<MetricSeries>, bool), String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "response is not JSON".to_string())?;
    if v.get("status").and_then(Value::as_str) != Some("success") {
        return Err(format!("backend error ({})", err_text(&v)));
    }
    let data = v.get("data");
    if data.and_then(|d| d.get("resultType")).and_then(Value::as_str) != Some("matrix") {
        return Err("unexpected result type".to_string());
    }
    let result = data
        .and_then(|d| d.get("result"))
        .and_then(Value::as_array)
        .ok_or("missing result")?;
    let mut truncated = result.len() > MAX_SERIES;
    let mut series = Vec::new();
    for r in result.iter().take(MAX_SERIES) {
        let label = r
            .get("metric")
            .and_then(|m| m.get("container"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(default_label)
            .to_string();
        let mut points: Vec<(i64, f64)> = Vec::new();
        for p in r.get("values").and_then(Value::as_array).into_iter().flatten() {
            let Some(pair) = p.as_array() else { continue };
            let ts = pair.first().and_then(Value::as_f64).filter(|t| t.is_finite());
            let val = pair
                .get(1)
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|x| x.is_finite());
            if let (Some(t), Some(x)) = (ts, val) {
                if points.len() >= MAX_POINTS {
                    truncated = true;
                    break;
                }
                points.push((t.floor() as i64, x));
            }
        }
        if !points.is_empty() {
            series.push(MetricSeries { label, points });
        }
    }
    Ok((series, truncated))
}

async fn range(
    client: &kube::Client,
    target: &ServiceTarget,
    query: &str,
    start: i64,
    end: i64,
    step: i64,
    label: &str,
) -> Result<(Vec<MetricSeries>, bool), String> {
    let (s, e, st) = (start.to_string(), end.to_string(), step.to_string());
    let path = proxy_path(
        target,
        "/api/v1/query_range",
        &[("query", query), ("start", &s), ("end", &e), ("step", &st)],
    )?;
    let body = proxy_get(client, target, &path).await.map_err(|e| e.into_msg("metrics"))?;
    parse_matrix(&body, label).map_err(|e| format!("Failed to query metrics: {}", e))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_metric_range(
    context: String,
    target: ServiceTarget,
    template: String,
    namespace: String,
    name: String,
    container: Option<String>,
    start: i64,
    end: i64,
    step_seconds: i64,
) -> Result<MetricRange, String> {
    let r = render(&template, &namespace, &name, container.as_deref())
        .map_err(|e| format!("Failed to query metrics: {}", e))?;
    let step = effective_step(start, end, step_seconds).map_err(|e| format!("Failed to query metrics: {}", e))?;
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let label = if name.is_empty() { "value" } else { name.as_str() };
    let (mut series, mut truncated) = range(&client, &target, &r.query, start, end, step, label).await?;
    if series.is_empty() {
        if let Some(fb) = &r.fallback {
            (series, truncated) = range(&client, &target, fb, start, end, step, label).await?;
        }
    }
    Ok(MetricRange { template, unit: r.unit.to_string(), series, truncated })
}

/// `Some(version)` when the body is a Prometheus-shaped success envelope.
fn probe_version(body: &str) -> Option<Option<String>> {
    let v: Value = serde_json::from_str(body).ok()?;
    if v.get("status").and_then(Value::as_str) != Some("success") {
        return None;
    }
    Some(
        v.get("data")
            .and_then(|d| d.get("version"))
            .and_then(Value::as_str)
            .map(|s| s.chars().take(64).collect()),
    )
}

fn probe(state: &str, message: String, version: Option<String>) -> BackendProbe {
    BackendProbe { state: state.to_string(), message, version }
}

/// Loki `/loki/api/v1/labels` answers the `{"status":"success"}` envelope.
fn loki_ok(body: &str) -> bool {
    probe_version(body).is_some()
}

/// VictoriaLogs answers NDJSON: empty, or the first non-empty line is a JSON object.
fn vl_ok(body: &str) -> bool {
    match body.lines().map(str::trim).find(|l| !l.is_empty()) {
        None => true,
        Some(l) => serde_json::from_str::<Value>(l).map(|v| v.is_object()).unwrap_or(false),
    }
}

/// Map a probe request result to a state. Pure.
fn outcome(flavour: &str, name: &str, res: Result<String, ProxyErr>) -> BackendProbe {
    let wrong = || probe("wrong-service", format!("The service answered, but not with a {} API response", name), None);
    let ok = |v: Option<String>| probe("ok", format!("{} API reachable", name), v);
    match res {
        Ok(body) => match flavour {
            "prometheus" => probe_version(&body).map(ok).unwrap_or_else(wrong),
            "loki" if loki_ok(&body) => ok(None),
            "victorialogs" if vl_ok(&body) => ok(None),
            _ => wrong(),
        },
        Err(ProxyErr::Forbidden(m)) => probe("forbidden", format!("No access to services/proxy: {}", m), None),
        Err(ProxyErr::Backend(404, _)) => wrong(),
        Err(e) => probe("unreachable", e.into_msg("backend"), None),
    }
}

#[tauri::command]
pub async fn probe_observability_backend(
    context: String,
    target: ServiceTarget,
    flavour: String,
) -> Result<BackendProbe, String> {
    let name = match flavour.as_str() {
        "prometheus" => "Prometheus",
        "loki" => "Loki",
        "victorialogs" => "VictoriaLogs",
        o => return Err(format!("Failed to probe: unknown backend '{}'", o)),
    };
    let since = (chrono::Utc::now().timestamp() - 300).to_string();
    let paths = match flavour.as_str() {
        "prometheus" => proxy_path(&target, "/api/v1/status/buildinfo", &[])
            .and_then(|a| proxy_path(&target, "/api/v1/query", &[("query", "vector(1)")]).map(|b| (a, Some(b)))),
        "loki" => proxy_path(&target, "/loki/api/v1/labels", &[]).map(|a| (a, None)),
        // ponytail: query shape not live-verified; §6.2 row decides
        _ => proxy_path(&target, "/select/logsql/query", &[("query", "*"), ("start", &since), ("limit", "1")])
            .map(|a| (a, None)),
    };
    let (first, second) = match paths {
        Ok(p) => p,
        Err(e) => return Ok(probe("unreachable", e, None)),
    };
    let client = match client_for_context(&context).await {
        Ok(c) => c,
        Err(e) => return Ok(probe("unreachable", format!("Failed to connect: {}", e), None)),
    };
    let mut res = proxy_get(&client, &target, &first).await;
    // Old Prometheus and some compatible servers lack buildinfo.
    if let (Some(q), Err(ProxyErr::Backend(404, _))) = (&second, &res) {
        res = proxy_get(&client, &target, q).await;
    }
    Ok(outcome(&flavour, name, res))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(t: &str, c: Option<&str>) -> String {
        render(t, "ns", "web-1", c).unwrap().query
    }

    #[test]
    fn templates_render() {
        assert_eq!(
            q("pod-cpu", None),
            r#"sum by (container) (rate(container_cpu_usage_seconds_total{namespace="ns",pod="web-1",container!="",container!="POD"}[5m])) * 1000"#
        );
        assert_eq!(
            q("pod-mem", Some("app")),
            r#"sum by (container) (container_memory_working_set_bytes{namespace="ns",pod="web-1",container="app"}) / 1048576"#
        );
        assert!(render("container-p95-cpu", "ns", "web-1", None).is_err());
        assert!(render("container-p95-mem", "ns", "web-1", None).is_err());
        let n = render("node-cpu", "", "node-1.a.io", None).unwrap();
        assert_eq!(
            n.query,
            r#"sum(rate(node_cpu_seconds_total{mode!="idle"}[5m]) * on(instance) group_left() node_uname_info{nodename="node-1.a.io"}) * 1000"#
        );
        assert_eq!(
            n.fallback.unwrap(),
            r#"sum(rate(container_cpu_usage_seconds_total{id="/",node="node-1.a.io"}[5m])) * 1000 or sum(rate(container_cpu_usage_seconds_total{id="/",instance=~"node-1\\.a\\.io(:.*)?"}[5m])) * 1000"#
        );
        let m = render("node-mem", "", "node-1", None).unwrap();
        assert_eq!(
            m.query,
            r#"sum((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) * on(instance) group_left() node_uname_info{nodename="node-1"}) / 1048576"#
        );
        assert_eq!(
            m.fallback.unwrap(),
            r#"sum(container_memory_working_set_bytes{id="/",node="node-1"}) / 1048576 or sum(container_memory_working_set_bytes{id="/",instance=~"node-1(:.*)?"}) / 1048576"#
        );
        assert_eq!(m.unit, "MiB");
    }

    #[test]
    fn render_rejects_bad_input() {
        assert!(render("nope", "ns", "p", None).is_err());
        assert!(render("pod-cpu", "ns\"x", "p", None).is_err());
        assert!(render("pod-cpu", "ns", "p\nq", None).is_err());
        assert!(render("pod-cpu", "ns", "p", Some("c\"}")).is_err());
        assert!(render("node-cpu", "", "n{}", None).is_err());
    }

    #[test]
    fn step_widens_to_cap() {
        assert_eq!(effective_step(0, 3600, 15).unwrap(), 15);
        assert_eq!(effective_step(0, 7 * 86400, 15).unwrap(), 551);
        assert_eq!(effective_step(0, 100, 0).unwrap(), 1);
        assert!(effective_step(10, 10, 5).is_err());
        assert!(effective_step(i64::MIN, i64::MAX, 5).is_err());
    }

    #[test]
    fn parse_ok_and_label() {
        let b = r#"{"status":"success","data":{"resultType":"matrix","result":[
          {"metric":{"container":"app"},"values":[[1700000000.5,"1.5"],[1700000015,"NaN"],[1700000030,"2"]]},
          {"metric":{},"values":[[1,"3"]]}]}}"#;
        let (s, t) = parse_matrix(b, "pod").unwrap();
        assert!(!t);
        assert_eq!(s[0].label, "app");
        assert_eq!(s[0].points, vec![(1700000000, 1.5), (1700000030, 2.0)]);
        assert_eq!(s[1].label, "pod");
    }

    #[test]
    fn parse_empty_error_and_garbage() {
        let e = r#"{"status":"success","data":{"resultType":"matrix","result":[]}}"#;
        assert!(parse_matrix(e, "x").unwrap().0.is_empty());
        let err = r#"{"status":"error","errorType":"bad_data","error":"parse error"}"#;
        assert!(parse_matrix(err, "x").unwrap_err().contains("bad_data"));
        for g in ["", "<html>", "null", "[]", "{}", r#"{"status":"success"}"#,
            r#"{"status":"success","data":{"resultType":"vector","result":[]}}"#,
            r#"{"status":"success","data":{"resultType":"matrix","result":[1,{"values":5},{"values":[1,[2],["a","b"],[]]}]}}"#] {
            let _ = parse_matrix(g, "x");
        }
        assert!(parse_matrix("<html>", "x").is_err());
        assert!(parse_matrix(r#"{"status":"success"}"#, "x").is_err());
    }

    #[test]
    fn caps_points_and_series() {
        let vals: Vec<String> = (0..1200).map(|i| format!("[{i},\"1\"]")).collect();
        let one = format!(r#"{{"metric":{{}},"values":[{}]}}"#, vals.join(","));
        let many = vec![one.clone(); 25].join(",");
        let b = format!(r#"{{"status":"success","data":{{"resultType":"matrix","result":[{}]}}}}"#, many);
        let (s, t) = parse_matrix(&b, "x").unwrap();
        assert!(t);
        assert_eq!(s.len(), 20);
        assert_eq!(s[0].points.len(), 1100);
        let b1 = format!(r#"{{"status":"success","data":{{"resultType":"matrix","result":[{}]}}}}"#, one);
        let (s1, t1) = parse_matrix(&b1, "x").unwrap();
        assert!(t1 && s1.len() == 1);
    }

    #[test]
    fn probe_parsing() {
        assert_eq!(probe_version(r#"{"status":"success","data":{"version":"2.45.0"}}"#), Some(Some("2.45.0".into())));
        assert_eq!(probe_version(r#"{"status":"success","data":{"resultType":"vector"}}"#), Some(None));
        assert_eq!(probe_version(r#"{"status":"error"}"#), None);
        assert_eq!(probe_version("<html>"), None);
    }

    #[test]
    fn per_flavour_classifiers() {
        assert!(loki_ok(r#"{"status":"success","data":["a"]}"#));
        assert!(!loki_ok("<html>") && !loki_ok(r#"{"status":"error"}"#));
        assert!(vl_ok("") && vl_ok("\n  \n"));
        assert!(vl_ok("{\"_time\":\"x\",\"_msg\":\"y\"}\n"));
        assert!(!vl_ok("<html>") && !vl_ok("[1]") && !vl_ok("\n42"));
    }

    #[test]
    fn outcome_states() {
        let st = |f: &str, r: Result<String, ProxyErr>| outcome(f, "X", r).state;
        let m = || "m".to_string();
        assert_eq!(st("prometheus", Err(ProxyErr::Forbidden(m()))), "forbidden");
        assert_eq!(st("prometheus", Err(ProxyErr::NotFound(m()))), "unreachable");
        assert_eq!(st("prometheus", Err(ProxyErr::Backend(404, m()))), "wrong-service");
        for c in [401, 400, 503] {
            assert_eq!(st("loki", Err(ProxyErr::Backend(c, m()))), "unreachable");
        }
        assert_eq!(st("prometheus", Ok("<html>".into())), "wrong-service");
        assert_eq!(st("prometheus", Ok(r#"{"status":"success"}"#.into())), "ok");
        assert_eq!(st("victorialogs", Ok("".into())), "ok");
    }

    #[tokio::test]
    async fn unknown_flavour_is_err() {
        let t = ServiceTarget {
            namespace: "a".into(),
            service: "b".into(),
            port: "1".into(),
            scheme: None,
            path_prefix: None,
            tenant: None,
        };
        let e = probe_observability_backend("c".into(), t, "nope".into()).await.unwrap_err();
        assert_eq!(e, "Failed to probe: unknown backend 'nope'");
    }
}
