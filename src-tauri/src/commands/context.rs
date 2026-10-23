//! Context listing — read-only. See `docs/plan-kubeconfig-and-parity.md` §1.5: the app no longer
//! writes to any kubeconfig on disk. `switch_context` / `set_current_context_in_yaml` /
//! `kubeconfig_path()` are deleted, not fixed — the write they performed was an unnecessary side
//! effect (every command already takes `context: String` and resolves it independently via
//! `client_for_context`), and deleting them removes their bugs as a class rather than patching them.

use kube::config::Kubeconfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct KubeContext {
    pub name: String,
    pub cluster: String,
    pub user: String,
    /// RENAMED from `is_current`. After de-anchoring this means "your kubectl default" (computed
    /// from the real default kubeconfig only — never influenced by app-registered entries, since
    /// kubectl itself never sees those). The "active in the app" marker is separate, local
    /// frontend state.
    pub is_kubeconfig_default: bool,
    /// Absolute path of the file whose CONTEXT entry won. The cluster/auth entries it references
    /// may have won from a different file — see §1.3. Label this "context defined in" in the UI,
    /// never "cluster from".
    pub source: String,
    /// Other ENABLED files also defining a context with this name, in merge order. Empty when unique.
    pub shadowed_sources: Vec<String>,
    /// `server` URL of the cluster entry (in the merged kubeconfig) this context references. `""`
    /// when the cluster entry or its `server` cannot be resolved. Lets the UI tell that two
    /// contexts point at the same API server.
    pub server: String,
    /// v2.1.2: `display_proxy` of the proxy-url of the cluster entry this context references.
    /// `scheme://host[:port]`, userinfo, path and query dropped. None = no proxy-url, or unparsable.
    pub proxy: Option<String>,
}

/// The `server` URL of the cluster named `cluster`, or `""` when there is no such entry or it
/// carries no server. First match wins, like kubectl's merge.
fn server_for_cluster(clusters: &[kube::config::NamedCluster], cluster: &str) -> String {
    clusters
        .iter()
        .find(|c| c.name == cluster)
        .and_then(|c| c.cluster.as_ref())
        .and_then(|c| c.server.clone())
        .unwrap_or_default()
}

/// Raw `proxy-url` of the cluster entry `cluster` (first match wins); `None` when missing or empty.
pub fn proxy_for_cluster(clusters: &[kube::config::NamedCluster], cluster: &str) -> Option<String> {
    clusters
        .iter()
        .find(|c| c.name == cluster)
        .and_then(|c| c.cluster.as_ref())
        .and_then(|c| c.proxy_url.clone())
        .filter(|p| !p.is_empty())
}

/// Raw `proxy-url` of the cluster that `context` references in `kc`.
pub fn proxy_url_for_context(kc: &Kubeconfig, context: &str) -> Option<String> {
    let ctx = kc.contexts.iter().find(|c| c.name == context)?.context.as_ref()?;
    proxy_for_cluster(&kc.clusters, &ctx.cluster)
}

/// True when an unencoded `/`, `?` or `#` sits in the userinfo (before the LAST `@`). `http::Uri`
/// would end the authority early there and mis-read the user name as the host, or let SOCKS
/// credentials through, so both helpers reject such a URL before parsing.
fn userinfo_has_delimiter(raw: &str) -> bool {
    raw.split_once("://")
        .and_then(|(_, rest)| rest.rsplit_once('@'))
        .is_some_and(|(info, _)| info.contains(['/', '?', '#']))
}

/// `scheme://host[:port]` of a proxy URL: userinfo, path and query dropped, IPv6 brackets kept.
/// `None` when unparsable or hostless. Safe for display.
pub fn display_proxy(raw: &str) -> Option<String> {
    if userinfo_has_delimiter(raw) {
        return None;
    }
    let uri: http::Uri = raw.parse().ok()?;
    let scheme = uri.scheme_str().filter(|s| !s.is_empty())?;
    let host = uri.host().filter(|h| !h.is_empty())?;
    if has_bad_port(&uri) {
        return None;
    }
    Some(match uri.port_u16() {
        Some(p) => format!("{scheme}://{host}:{p}"),
        None => format!("{scheme}://{host}"),
    })
}

/// A port that is present but not a valid u16 (`:99999`).
fn has_bad_port(uri: &http::Uri) -> bool {
    let Some(auth) = uri.authority() else { return false };
    let hostport = auth.as_str().rsplit_once('@').map_or(auth.as_str(), |(_, h)| h);
    hostport
        .rsplit_once(':')
        .is_some_and(|(h, p)| !p.contains(']') && !h.is_empty() && p.parse::<u16>().is_err())
}

fn uri_with_scheme(uri: http::Uri, scheme: &str) -> Option<http::Uri> {
    let mut parts = uri.into_parts();
    parts.scheme = Some(scheme.parse().ok()?);
    http::Uri::from_parts(parts).ok()
}

/// What `client_for_context` puts in `Config.proxy_url` (kubeconfig only, never env). kube 0.95
/// honours exactly `http` and `socks5` (no SOCKS credentials); anything else would be silently
/// bypassed, so it fails closed. Messages never carry the host or userinfo.
pub fn effective_proxy(raw: Option<&str>) -> Result<Option<http::Uri>, String> {
    let Some(raw) = raw else { return Ok(None) };
    let invalid = || {
        "The proxy-url in your kubeconfig isn't a valid URL. Use http://host:port or socks5://host:port."
            .to_string()
    };
    if userinfo_has_delimiter(raw) {
        return Err(invalid());
    }
    let uri: http::Uri = raw.parse().map_err(|_| invalid())?;
    let scheme = uri.scheme_str().filter(|s| !s.is_empty()).ok_or_else(invalid)?.to_ascii_lowercase();
    if uri.host().is_none_or(str::is_empty) || has_bad_port(&uri) {
        return Err(invalid());
    }
    // Normalised to lowercase: kube matches the scheme exactly and bypasses on a mismatch.
    let target = match scheme.as_str() {
        "http" => "http",
        "socks5" | "socks5h" => {
            if uri.authority().is_some_and(|a| a.as_str().contains('@')) {
                return Err("SOCKS5 proxies with a user name and password aren't supported yet. Remove them from the proxy-url, or use an http proxy.".to_string());
            }
            "socks5"
        }
        other => {
            return Err(format!(
                "This proxy type isn't supported: {}. Supported types: http, socks5.",
                other
            ))
        }
    };
    uri_with_scheme(uri, target).map(Some).ok_or_else(invalid)
}

/// The enabled union only (default + enabled registered entries) — a context defined solely in a
/// disabled file does not appear here. `list_kubeconfigs` is the command that sees disabled files.
#[tauri::command]
pub async fn list_contexts() -> Result<Vec<KubeContext>, String> {
    let merged = super::kubeconfig::load_merged_kubeconfig()
        .map_err(|e| format!("Failed to read kubeconfig: {}", e))?;

    // "kubectl default" is computed from the real default kubeconfig only — never from the
    // app-local union, since kubectl itself never sees registered entries.
    let default_current = Kubeconfig::read().ok().and_then(|kc| kc.current_context);

    // Per-context provenance: which enabled file's CONTEXT entry won, and which other enabled
    // files also define that name (shadowed). Built by reading each enabled file individually —
    // the merged object above no longer retains per-entry origin.
    let groups = super::kubeconfig::enabled_groups();
    let mut sources_by_name: HashMap<String, Vec<String>> = HashMap::new();
    for (source, kc) in &groups {
        for named_ctx in &kc.contexts {
            sources_by_name.entry(named_ctx.name.clone()).or_default().push(source.clone());
        }
    }

    let clusters = merged.clusters;
    let contexts = merged
        .contexts
        .into_iter()
        .map(|named_ctx| {
            let ctx = named_ctx.context.unwrap_or_default();
            let mut sources = sources_by_name.remove(&named_ctx.name).unwrap_or_default();
            let source = if sources.is_empty() { String::new() } else { sources.remove(0) };
            let server = server_for_cluster(&clusters, &ctx.cluster);
            let proxy = proxy_for_cluster(&clusters, &ctx.cluster).and_then(|p| display_proxy(&p));
            KubeContext {
                name: named_ctx.name.clone(),
                server,
                proxy,
                cluster: ctx.cluster, // String in kube 0.95
                user: ctx.user,       // String in kube 0.95
                is_kubeconfig_default: default_current.as_deref() == Some(named_ctx.name.as_str()),
                source,
                shadowed_sources: sources,
            }
        })
        .collect();

    Ok(contexts)
}

/// Read-only. Demoted to one job: seeding the app-local active context on first launch (see
/// `useActiveContext` on the frontend). Reads only the real default kubeconfig — never the
/// app-registered union — matching `is_kubeconfig_default` above.
#[tauri::command]
pub async fn get_current_context() -> Result<String, String> {
    let config = Kubeconfig::read().map_err(|e| format!("Failed to read kubeconfig: {}", e))?;
    Ok(config.current_context.unwrap_or_else(|| "default".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use kube::config::{Cluster, NamedCluster};

    fn named(name: &str, server: Option<&str>) -> NamedCluster {
        NamedCluster {
            name: name.to_string(),
            cluster: Some(Cluster {
                server: server.map(|s| s.to_string()),
                ..Default::default()
            }),
        }
    }

    #[test]
    fn context_resolves_to_its_clusters_server() {
        let clusters = vec![
            named("prod", Some("https://prod.example.com:6443")),
            named("stage", Some("https://stage.example.com:6443")),
        ];
        assert_eq!(server_for_cluster(&clusters, "stage"), "https://stage.example.com:6443");
        assert_eq!(server_for_cluster(&clusters, "prod"), "https://prod.example.com:6443");
    }

    #[test]
    fn unknown_cluster_or_missing_server_is_empty() {
        let clusters = vec![
            named("no-server", None),
            NamedCluster { name: "bare".to_string(), cluster: None },
        ];
        assert_eq!(server_for_cluster(&clusters, "missing"), "");
        assert_eq!(server_for_cluster(&clusters, "no-server"), "");
        assert_eq!(server_for_cluster(&clusters, "bare"), "");
        assert_eq!(server_for_cluster(&[], "anything"), "");
    }

    fn with_proxy(name: &str, proxy: Option<&str>) -> NamedCluster {
        NamedCluster {
            name: name.to_string(),
            cluster: Some(Cluster { proxy_url: proxy.map(|s| s.to_string()), ..Default::default() }),
        }
    }

    // Built at runtime: no literal user:password URL in the repo (TruffleHog).
    fn userinfo(scheme: &str, tail: &str) -> String {
        [scheme, "://", "user", ":", "pw", "@", tail].concat()
    }

    #[test]
    fn proxy_for_cluster_cases() {
        let c = vec![
            with_proxy("a", Some("http://p:3128")),
            with_proxy("empty", Some("")),
            with_proxy("none", None),
            with_proxy("dup", Some("http://first")),
            with_proxy("dup", Some("http://second")),
        ];
        assert_eq!(proxy_for_cluster(&c, "a").as_deref(), Some("http://p:3128"));
        assert_eq!(proxy_for_cluster(&c, "missing"), None);
        assert_eq!(proxy_for_cluster(&c, "empty"), None);
        assert_eq!(proxy_for_cluster(&c, "none"), None);
        assert_eq!(proxy_for_cluster(&c, "dup").as_deref(), Some("http://first"));
    }

    #[test]
    fn proxy_url_for_context_cases() {
        use kube::config::{Context, NamedContext};
        let kc = Kubeconfig {
            clusters: vec![with_proxy("c1", Some("socks5://s:1080")), with_proxy("c1", Some("http://x"))],
            contexts: vec![NamedContext {
                name: "ctx".into(),
                context: Some(Context { cluster: "c1".into(), ..Default::default() }),
            }],
            ..Default::default()
        };
        assert_eq!(proxy_url_for_context(&kc, "ctx").as_deref(), Some("socks5://s:1080"));
        assert_eq!(proxy_url_for_context(&kc, "nope"), None);
    }

    #[test]
    fn display_proxy_cases() {
        for (raw, want) in [
            ("http://proxy:3128", "http://proxy:3128"),
            ("https://proxy.example:8443", "https://proxy.example:8443"),
            ("socks5://127.0.0.1:1080", "socks5://127.0.0.1:1080"),
            ("socks5h://s:1080", "socks5h://s:1080"),
            ("http://[::1]:3128", "http://[::1]:3128"),
            ("http://proxy", "http://proxy"),
            ("http://proxy:3128/a/b?x=1", "http://proxy:3128"),
        ] {
            assert_eq!(display_proxy(raw).as_deref(), Some(want), "{raw}");
        }
        for tail in ["proxy:3128", "p@x:3128/path?q=1"] {
            let out = display_proxy(&userinfo("http", tail)).unwrap();
            assert!(!out.contains('@') && !out.contains("pw"), "{out}");
        }
        for bad in ["", "garbage", "/just/a/path", "http://", "://x"] {
            assert_eq!(display_proxy(bad), None, "{bad}");
        }
    }

    #[test]
    fn effective_proxy_arms() {
        assert_eq!(effective_proxy(None), Ok(None));
        let http = effective_proxy(Some("http://proxy:3128")).unwrap().unwrap();
        assert_eq!(http.to_string(), "http://proxy:3128/");
        // http userinfo is kept (hyper-http-proxy sends it as Basic).
        let with = userinfo("http", "proxy:3128");
        let u = effective_proxy(Some(&with)).unwrap().unwrap();
        assert!(u.authority().unwrap().as_str().contains('@'));
        let s5 = effective_proxy(Some("socks5://s:1080")).unwrap().unwrap();
        assert_eq!(s5.scheme_str(), Some("socks5"));
        let s5h = effective_proxy(Some("socks5h://s:1080")).unwrap().unwrap();
        assert_eq!(s5h.scheme_str(), Some("socks5"));
        assert_eq!(s5h.authority().unwrap().as_str(), "s:1080");
        // Scheme case is normalised: kube matches it exactly and would bypass otherwise.
        assert_eq!(effective_proxy(Some("SOCKS5://s:1080")).unwrap().unwrap().scheme_str(), Some("socks5"));
        assert_eq!(effective_proxy(Some("HTTP://p:1")).unwrap().unwrap().scheme_str(), Some("http"));
    }

    #[test]
    fn delimiter_in_password_is_rejected_without_leaking() {
        // Built at runtime (§0.8). Each would otherwise parse with the user name as the host.
        let cases = [
            ["http", "://", "zed", ":", "1234", "/x", "@", "px9:3128"].concat(),
            ["http", "://", "zed", ":", "1234", "?x", "@", "px9:3128"].concat(),
            ["http", "://", "zed", ":", "1234", "#x", "@", "px9:3128"].concat(),
            ["http", "://", "us", "@", "zed", ":", "pa/ss", "@", "px9:3128"].concat(),
            ["socks5", "://", "zed", ":", "9", "/x", "@", "px9:1080"].concat(),
        ];
        for raw in &cases {
            assert_eq!(display_proxy(raw), None, "{raw}");
            let e = effective_proxy(Some(raw)).unwrap_err();
            assert!(e.contains("isn't a valid URL"), "{e}");
            for bad in ["zed", "1234", "pa/ss", "us@", "px9"] {
                assert!(!e.contains(bad), "{e}");
            }
        }
    }

    #[test]
    fn invalid_port_is_rejected() {
        for raw in ["http://proxy:99999", "http://proxy:abc", "socks5://proxy:70000"] {
            assert_eq!(display_proxy(raw), None, "{raw}");
            assert!(effective_proxy(Some(raw)).unwrap_err().contains("isn't a valid URL"), "{raw}");
        }
        assert!(effective_proxy(Some("http://[::1]:3128")).is_ok());
        assert!(effective_proxy(Some("http://[::1]")).is_ok());
    }

    #[test]
    fn effective_proxy_errors_leak_nothing() {
        let creds = userinfo("socks5", "secret-host:1080");
        let creds_h = userinfo("socks5h", "secret-host:1080");
        let https = userinfo("https", "secret-host:3128");
        let ftp = userinfo("ftp", "secret-host:21");
        let cases = [
            (creds.as_str(), "SOCKS5 proxies with a user name and password"),
            (creds_h.as_str(), "SOCKS5 proxies with a user name and password"),
            (https.as_str(), "This proxy type isn't supported: https. Supported types: http, socks5."),
            (ftp.as_str(), "This proxy type isn't supported: ftp."),
            ("secret-host:3128", "isn't a valid URL"),
            ("secret-host", "isn't a valid URL"),
            ("not a url secret-host", "isn't a valid URL"),
            ("", "isn't a valid URL"),
            ("http://", "isn't a valid URL"),
            ("://secret-host", "isn't a valid URL"),
        ];
        for (raw, want) in cases {
            let e = effective_proxy(Some(raw)).unwrap_err();
            assert!(e.contains(want), "{raw} -> {e}");
            assert!(!e.contains('@') && !e.contains("secret-host") && !e.contains("pw"), "{e}");
        }
    }

    #[test]
    fn first_cluster_entry_wins() {
        let clusters = vec![named("dup", Some("https://first")), named("dup", Some("https://second"))];
        assert_eq!(server_for_cluster(&clusters, "dup"), "https://first");
    }
}
