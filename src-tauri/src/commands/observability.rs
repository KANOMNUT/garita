//! External observability, shared half (v2.3.0): targets, the service-proxy
//! path builder, label escaping, the proxy GET and Service discovery.
//! Everything goes through the API server's service proxy with the cached kube
//! client (so exec-plugin auth and the app proxies apply). Read-only.

use k8s_openapi::api::core::v1::Service;
use kube::{api::ListParams, Api};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::problems::{take, SkippedSource};
use super::utils::client_for_context;
use crate::launch::valid_namespace;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ServiceTarget {
    pub namespace: String,
    pub service: String,
    /// Number or port name.
    pub port: String,
    /// "http" (default) | "https".
    #[serde(default)]
    pub scheme: Option<String>,
    /// Absolute, e.g. "/prometheus".
    #[serde(default)]
    pub path_prefix: Option<String>,
    /// X-Scope-OrgID; None or "" sends no header.
    #[serde(default)]
    pub tenant: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogLabelMap {
    pub namespace: String,
    pub pod: String,
    pub container: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogsTarget {
    pub service: ServiceTarget,
    /// "loki" | "victorialogs"
    pub flavour: String,
    pub labels: LogLabelMap,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ObservabilityCandidate {
    /// "prometheus" | "loki" | "victorialogs"
    pub kind: String,
    pub target: ServiceTarget,
    pub reason: String,
}

const MAX_BODY: usize = 32 * 1024 * 1024;

// ─── validation and escaping (pure) ──────────────────────────────────────────

/// RFC 1123 subdomain (pod, node names).
pub fn valid_subdomain(s: &str) -> bool {
    s.len() <= 253 && s.split('.').all(valid_namespace)
}

/// Port number (1..=65535) or IANA service name (lowercase, digits, '-', <= 15).
pub fn valid_port(s: &str) -> bool {
    if !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()) {
        return s.parse::<u16>().map(|p| p > 0).unwrap_or(false);
    }
    !s.is_empty()
        && s.len() <= 15
        && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// Log label / field name: `[A-Za-z_][A-Za-z0-9_.]*`, <= 128 (dots for VictoriaLogs).
pub fn valid_field_name(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 128
        && b.first().is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'.')
}

/// Escape a value for a double-quoted PromQL/LogQL/LogsQL string. Newlines rejected.
pub fn escape_label(v: &str) -> Result<String, String> {
    if v.contains('\n') || v.contains('\r') {
        return Err("label value contains a newline".to_string());
    }
    Ok(v.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Percent-encode everything outside RFC 3986 unreserved.
pub fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// `/api/v1/namespaces/{ns}/services/{scheme}:{svc}:{port}/proxy{prefix}{api_path}?k=v`
pub fn proxy_path(
    t: &ServiceTarget,
    api_path: &str,
    query: &[(&str, &str)],
) -> Result<String, String> {
    if !valid_namespace(&t.namespace) {
        return Err(format!("invalid namespace '{}'", t.namespace));
    }
    if !valid_namespace(&t.service) {
        return Err(format!("invalid service name '{}'", t.service));
    }
    if !valid_port(&t.port) {
        return Err(format!("invalid port '{}'", t.port));
    }
    let scheme = match t.scheme.as_deref() {
        None | Some("") | Some("http") => "http",
        Some("https") => "https",
        Some(o) => return Err(format!("invalid scheme '{}'", o)),
    };
    let prefix = match t.path_prefix.as_deref() {
        None | Some("") => "",
        Some(p) => {
            if !p.starts_with('/') {
                return Err("path prefix must start with '/'".to_string());
            }
            if p.contains("..") {
                return Err("path prefix must not contain '..'".to_string());
            }
            if !p.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.' | b'_' | b'~' | b'/')) {
                return Err("path prefix has unsupported characters".to_string());
            }
            p.trim_end_matches('/')
        }
    };
    if !api_path.starts_with('/') {
        return Err("api path must start with '/'".to_string());
    }
    let mut out = format!(
        "/api/v1/namespaces/{}/services/{}:{}:{}/proxy{}{}",
        t.namespace, scheme, t.service, t.port, prefix, api_path
    );
    for (i, (k, v)) in query.iter().enumerate() {
        out.push(if i == 0 { '?' } else { '&' });
        out.push_str(&pct_encode(k));
        out.push('=');
        out.push_str(&pct_encode(v));
    }
    Ok(out)
}

/// Tenant ID charset of Loki: `[A-Za-z0-9!._*'()-]`, 1..=150.
pub fn valid_tenant(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 150
        && s.bytes().all(|c| c.is_ascii_alphanumeric() || b"!._*'()-".contains(&c))
}

// ─── transport ───────────────────────────────────────────────────────────────

pub enum ProxyErr {
    /// API server 403 on services/proxy (RBAC).
    Forbidden(String),
    /// API server 404: the Service does not exist.
    NotFound(String),
    /// The backend's own HTTP status (code, text).
    Backend(u16, String),
    Other(String),
}

impl ProxyErr {
    /// Text for the frontend: a 403 starts with "No access to services/proxy".
    pub fn into_msg(self, what: &str) -> String {
        match self {
            ProxyErr::Forbidden(m) => format!("No access to services/proxy: {}", m),
            ProxyErr::NotFound(m) => format!("Failed to query {}: service not found: {}", what, m),
            ProxyErr::Backend(c, m) => format!("Failed to query {}: backend returned {}: {}", what, c, m),
            ProxyErr::Other(m) => format!("Failed to query {}: {}", what, m),
        }
    }
}

/// Origin of an error: an API-server Status carries its own `reason`; kube builds
/// "Failed to parse error data" for any non-Status body, i.e. the backend's own reply.
pub fn classify(code: u16, reason: &str, msg: String) -> ProxyErr {
    // kube copies the whole backend error body into the message.
    let msg = msg.chars().take(300).collect::<String>();
    match (code, reason) {
        (403, "Forbidden") => ProxyErr::Forbidden(msg),
        (404, "NotFound") => ProxyErr::NotFound(msg),
        _ => ProxyErr::Backend(code, msg),
    }
}

/// Read at most `max` bytes; one byte over is an error.
pub async fn read_capped<R: futures::AsyncRead + Unpin>(r: R, max: usize) -> Result<String, ProxyErr> {
    use futures::AsyncReadExt;
    let mut buf = Vec::new();
    r.take(max as u64 + 1)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| ProxyErr::Other(e.to_string()))?;
    if buf.len() > max {
        return Err(ProxyErr::Other("response too large".to_string()));
    }
    String::from_utf8(buf).map_err(|_| ProxyErr::Other("response is not UTF-8".to_string()))
}

// ponytail: kube 0.95 handle_api_errors still reads 4xx/5xx bodies whole; switch to Client::send with own status handling and a limited body read if a backend ever sends huge error pages
pub async fn proxy_get(client: &kube::Client, target: &ServiceTarget, path: &str) -> Result<String, ProxyErr> {
    let mut b = http::Request::get(path).header("Accept", "application/json");
    match target.tenant.as_deref() {
        None | Some("") => {}
        Some(t) if valid_tenant(t) => b = b.header("X-Scope-OrgID", t),
        Some(t) => return Err(ProxyErr::Other(format!("invalid tenant '{}'", t.chars().take(40).collect::<String>()))),
    }
    let req = b.body(Vec::new()).map_err(|e| ProxyErr::Other(e.to_string()))?;
    match client.request_stream(req).await {
        Ok(s) => read_capped(s, MAX_BODY).await,
        Err(kube::Error::Api(s)) => Err(classify(s.code, &s.reason, s.message)),
        Err(e) => Err(ProxyErr::Other(e.to_string())),
    }
}

// ─── discovery ───────────────────────────────────────────────────────────────

const COMMON_NAMESPACES: [&str; 5] =
    ["monitoring", "observability", "prometheus", "loki", "kube-prometheus-stack"];

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ObservabilityDiscovery {
    pub candidates: Vec<ObservabilityCandidate>,
    /// `source` is the namespace, or "*" for the cluster-wide list.
    pub skipped: Vec<SkippedSource>,
}

fn pick_port(ports: &[(Option<String>, i32)], preferred: &[i32]) -> Option<String> {
    preferred
        .iter()
        .find_map(|p| ports.iter().find(|(_, n)| n == p))
        .or_else(|| ports.first())
        .map(|(_, n)| n.to_string())
}

/// Pure matching rule over plain Service values. The reason names the rule that matched.
pub fn candidate_for(
    ns: &str,
    name: &str,
    app_name: Option<&str>,
    ports: &[(Option<String>, i32)],
) -> Option<ObservabilityCandidate> {
    let app = app_name.unwrap_or("");
    let by_name = format!("Matched the service name \"{}\".", name);
    let by_label = format!("Matched the label app.kubernetes.io/name={}.", app);
    let (kind, prefer, why): (&str, &[i32], String) =
        if name.starts_with("victoria-logs") || name.starts_with("vlsingle-") {
            ("victorialogs", &[9428], by_name)
        } else if matches!(name, "loki" | "loki-gateway") || name.ends_with("-loki") || name.ends_with("-loki-gateway") {
            ("loki", &[3100, 80], by_name)
        } else if matches!(name, "prometheus" | "prometheus-operated" | "prometheus-server")
            || name.ends_with("-prometheus")
            || name.starts_with("vmsingle-")
        {
            ("prometheus", &[9090, 80], by_name)
        } else if app == "loki" && !name.contains("headless") && !name.contains("memberlist") {
            ("loki", &[3100, 80], by_label)
        } else if app == "prometheus" {
            ("prometheus", &[9090, 80], by_label)
        } else {
            return None;
        };
    let port = pick_port(ports, prefer)?;
    Some(ObservabilityCandidate {
        kind: kind.to_string(),
        target: ServiceTarget {
            namespace: ns.to_string(),
            service: name.to_string(),
            port,
            scheme: Some("http".to_string()),
            path_prefix: None,
            tenant: None,
        },
        reason: why,
    })
}

pub fn candidates_from(services: &[Service]) -> Vec<ObservabilityCandidate> {
    let mut out: Vec<ObservabilityCandidate> = services
        .iter()
        .filter_map(|s| {
            let name = s.metadata.name.as_deref()?;
            let ns = s.metadata.namespace.as_deref()?;
            let labels: Option<&BTreeMap<String, String>> = s.metadata.labels.as_ref();
            let app = labels.and_then(|l| l.get("app.kubernetes.io/name")).map(|v| v.as_str());
            let ports: Vec<(Option<String>, i32)> = s
                .spec
                .as_ref()
                .and_then(|sp| sp.ports.as_ref())
                .map(|ps| ps.iter().map(|p| (p.name.clone(), p.port)).collect())
                .unwrap_or_default();
            candidate_for(ns, name, app, &ports)
        })
        .collect();
    out.sort_by(|a, b| {
        // name matches first, so Prometheus stays above the UI's 8-row cut
        let key = |c: &ObservabilityCandidate| {
            (c.reason.starts_with("Matched the label"), c.kind.clone(), c.target.namespace.clone(), c.target.service.clone())
        };
        key(a).cmp(&key(b))
    });
    out
}

#[tauri::command]
pub async fn discover_observability(
    context: String,
    all_namespaces: Option<bool>,
) -> Result<ObservabilityDiscovery, String> {
    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let mut services: Vec<Service> = Vec::new();
    let mut skipped: Vec<SkippedSource> = Vec::new();
    // A failed list goes to `skipped`, never to Err; an absent namespace lists empty.
    if all_namespaces.unwrap_or(false) {
        let r = Api::<Service>::all(client).list(&ListParams::default()).await;
        services.extend(take(r, "*", true, &mut skipped).unwrap_or_default());
    } else {
        for ns in COMMON_NAMESPACES {
            let r = Api::<Service>::namespaced(client.clone(), ns).list(&ListParams::default()).await;
            services.extend(take(r, ns, true, &mut skipped).unwrap_or_default());
        }
    }
    Ok(ObservabilityDiscovery { candidates: candidates_from(&services), skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t() -> ServiceTarget {
        ServiceTarget {
            namespace: "monitoring".into(),
            service: "prometheus-operated".into(),
            port: "9090".into(),
            scheme: None,
            path_prefix: None,
            tenant: None,
        }
    }

    #[test]
    fn proxy_path_default() {
        assert_eq!(
            proxy_path(&t(), "/api/v1/query", &[]).unwrap(),
            "/api/v1/namespaces/monitoring/services/http:prometheus-operated:9090/proxy/api/v1/query"
        );
    }

    #[test]
    fn proxy_path_https_prefix_and_encoding() {
        let mut x = t();
        x.scheme = Some("https".into());
        x.path_prefix = Some("/prometheus/".into());
        x.port = "web".into();
        let p = proxy_path(&x, "/api/v1/query", &[("query", "a{b=\"c d\"}&x"), ("s", "1")]).unwrap();
        assert_eq!(
            p,
            "/api/v1/namespaces/monitoring/services/https:prometheus-operated:web/proxy/prometheus/api/v1/query?query=a%7Bb%3D%22c%20d%22%7D%26x&s=1"
        );
    }

    #[test]
    fn proxy_path_rejects_bad_prefix_and_names() {
        for p in ["rel", "/a/../b", "/..", "/a%2e%2e", "/a?b", "/a b", "/a#"] {
            let mut x = t();
            x.path_prefix = Some(p.into());
            assert!(proxy_path(&x, "/x", &[]).is_err(), "{p}");
        }
        for f in [
            |x: &mut ServiceTarget| x.namespace = "Bad_NS".into(),
            |x: &mut ServiceTarget| x.service = "a/b".into(),
            |x: &mut ServiceTarget| x.port = "99999".into(),
            |x: &mut ServiceTarget| x.port = "0".into(),
            |x: &mut ServiceTarget| x.port = "".into(),
            |x: &mut ServiceTarget| x.scheme = Some("ftp".into()),
        ] {
            let mut x = t();
            f(&mut x);
            assert!(proxy_path(&x, "/x", &[]).is_err());
        }
        assert!(proxy_path(&t(), "x", &[]).is_err());
    }

    #[test]
    fn target_deserializes_without_optional_keys() {
        let v: ServiceTarget =
            serde_json::from_str(r#"{"namespace":"a","service":"b","port":"80"}"#).unwrap();
        assert!(v.scheme.is_none() && v.path_prefix.is_none());
    }

    #[test]
    fn escape_label_rules() {
        assert_eq!(escape_label(r#"a\b"c"#).unwrap(), r#"a\\b\"c"#);
        assert!(escape_label("a\nb").is_err());
        assert!(escape_label("a\rb").is_err());
        assert_eq!(escape_label("plain").unwrap(), "plain");
    }

    #[test]
    fn name_shapes() {
        assert!(valid_subdomain("node-1.example.com"));
        assert!(!valid_subdomain("Node"));
        assert!(!valid_subdomain("a..b"));
        assert!(!valid_subdomain(""));
        assert!(valid_port("http-web") && valid_port("9090"));
        assert!(!valid_port("a_b") && !valid_port("65536"));
        assert!(valid_field_name("kubernetes.pod_name") && valid_field_name("pod"));
        assert!(!valid_field_name("a\"b") && !valid_field_name("1a") && !valid_field_name(""));
    }

    fn p(n: i32) -> (Option<String>, i32) {
        (None, n)
    }

    #[test]
    fn discovery_rules() {
        let k = |n: &str, app: Option<&str>, ports: &[(Option<String>, i32)]| {
            candidate_for("monitoring", n, app, ports).map(|c| (c.kind, c.target.port))
        };
        let s = |a: &str, b: i32| Some((a.to_string(), b.to_string()));
        assert_eq!(k("prometheus-operated", None, &[p(9090)]), s("prometheus", 9090));
        assert_eq!(k("kps-kube-prometheus-stack-prometheus", None, &[p(9093), p(9090)]), s("prometheus", 9090));
        assert_eq!(k("foo", Some("prometheus"), &[p(8080)]), s("prometheus", 8080));
        assert_eq!(k("vmsingle-main", None, &[p(8429)]), s("prometheus", 8429));
        assert_eq!(k("loki-gateway", None, &[p(80)]), s("loki", 80));
        assert_eq!(k("loki", None, &[p(7946), p(3100)]), s("loki", 3100));
        assert_eq!(k("loki-headless", Some("loki"), &[p(3100)]), None);
        assert_eq!(k("loki-memberlist", Some("loki"), &[p(7946)]), None);
        assert_eq!(k("victoria-logs-single-server", None, &[p(9428)]), s("victorialogs", 9428));
        assert_eq!(k("node-exporter", None, &[p(9100)]), None);
        assert_eq!(k("prometheus", None, &[]), None);
        assert_eq!(k("alertmanager-operated", None, &[p(9093)]), None);
    }

    #[test]
    fn classify_by_origin() {
        let m = || "m".to_string();
        assert!(matches!(classify(403, "Forbidden", m()), ProxyErr::Forbidden(_)));
        assert!(matches!(classify(404, "NotFound", m()), ProxyErr::NotFound(_)));
        assert!(matches!(classify(403, "Failed to parse error data", m()), ProxyErr::Backend(403, _)));
        assert!(matches!(classify(404, "Failed to parse error data", m()), ProxyErr::Backend(404, _)));
        assert!(matches!(classify(500, "InternalError", m()), ProxyErr::Backend(500, _)));
        assert!(matches!(classify(502, "x", "é".repeat(1000)), ProxyErr::Backend(_, t) if t.chars().count() == 300));
    }

    #[tokio::test]
    async fn capped_read() {
        let ok = read_capped(futures::io::Cursor::new(vec![b'a'; 8]), 8).await;
        assert_eq!(ok.ok().map(|s| s.len()), Some(8));
        let big = read_capped(futures::io::Cursor::new(vec![b'a'; 9]), 8).await;
        assert!(matches!(big, Err(ProxyErr::Other(m)) if m == "response too large"));
        let bad = read_capped(futures::io::Cursor::new(vec![0xff, 0xfe]), 8).await;
        assert!(matches!(bad, Err(ProxyErr::Other(_))));
    }

    #[test]
    fn tenant_shapes() {
        for ok in ["tenant-1", "a.b_c", "a*b!'()"] {
            assert!(valid_tenant(ok), "{ok}");
        }
        for bad in ["", "a\nb", "a\rb", "a b", "a|b"] {
            assert!(!valid_tenant(bad), "{bad:?}");
        }
        assert!(valid_tenant(&"a".repeat(150)) && !valid_tenant(&"a".repeat(151)));
    }

    #[test]
    fn target_tenant_optional() {
        let v: ServiceTarget =
            serde_json::from_str(r#"{"namespace":"a","service":"b","port":"80"}"#).unwrap();
        assert!(v.tenant.is_none());
        let w: ServiceTarget =
            serde_json::from_str(r#"{"namespace":"a","service":"b","port":"80","tenant":"t"}"#).unwrap();
        assert_eq!(w.tenant.as_deref(), Some("t"));
    }

    #[test]
    fn candidate_reasons() {
        let r = |n: &str, app: Option<&str>| candidate_for("m", n, app, &[p(9090)]).map(|c| c.reason);
        assert_eq!(r("prometheus", None).as_deref(), Some("Matched the service name \"prometheus\"."));
        assert_eq!(r("foo", Some("prometheus")).as_deref(), Some("Matched the label app.kubernetes.io/name=prometheus."));
        assert_eq!(r("foo", Some("loki")).as_deref(), Some("Matched the label app.kubernetes.io/name=loki."));
    }

    #[test]
    fn name_matches_sort_before_label_matches() {
        let svc = |n: &str, app: &str| {
            let mut x = Service::default();
            x.metadata.name = Some(n.into());
            x.metadata.namespace = Some("m".into());
            x.metadata.labels = Some(BTreeMap::from([("app.kubernetes.io/name".to_string(), app.to_string())]));
            x.spec = Some(k8s_openapi::api::core::v1::ServiceSpec {
                ports: Some(vec![k8s_openapi::api::core::v1::ServicePort { port: 3100, ..Default::default() }]),
                ..Default::default()
            });
            x
        };
        let c = candidates_from(&[svc("aaa", "loki"), svc("prometheus", "x"), svc("loki", "loki")]);
        let names: Vec<&str> = c.iter().map(|c| c.target.service.as_str()).collect();
        assert_eq!(names, ["loki", "prometheus", "aaa"]);
    }
}
