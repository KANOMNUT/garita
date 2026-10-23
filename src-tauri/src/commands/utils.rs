use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use kube::{Client, Config};
use kube::config::KubeConfigOptions;

// ─── Caches ──────────────────────────────────────────────────────────────────

// Resolved exec-plugin paths — zsh only spawned once per unique binary name.
static CMD_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

// kube Clients — built once per context name; kube-rs refreshes auth tokens
// internally so the same Client can be safely reused across requests.
static CLIENT_CACHE: OnceLock<Mutex<HashMap<String, Client>>> = OnceLock::new();

fn cmd_cache() -> &'static Mutex<HashMap<String, String>> {
    CMD_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn client_cache() -> &'static Mutex<HashMap<String, Client>> {
    CLIENT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Drop all cached clients (call after a context switch so the new context
/// gets a fresh client on its first request).
pub fn invalidate_client_cache() {
    if let Some(m) = CLIENT_CACHE.get() {
        if let Ok(mut map) = m.lock() {
            map.clear();
        }
    }
}

// ─── Shell / path resolution ─────────────────────────────────────────────────

/// Find the absolute path of a binary by asking a login shell.
/// Explicitly sources .zshrc/.zprofile so Homebrew-managed PATH entries are
/// visible even though `zsh -l` is login-but-non-interactive (skips .zshrc).
fn which_via_shell(bin: &str) -> Option<String> {
    let zsh_cmd = format!(
        "[ -f ~/.zprofile ] && source ~/.zprofile 2>/dev/null; \
         [ -f ~/.zshrc ] && source ~/.zshrc 2>/dev/null; \
         which {}",
        bin
    );
    let bash_cmd = format!(
        "[ -f ~/.bash_profile ] && source ~/.bash_profile 2>/dev/null; \
         [ -f ~/.bashrc ] && source ~/.bashrc 2>/dev/null; \
         which {}",
        bin
    );
    for (shell, cmd) in &[("/bin/zsh", zsh_cmd.as_str()), ("/bin/bash", bash_cmd.as_str())] {
        if let Ok(out) = std::process::Command::new(shell)
            .args(["-l", "-c", cmd])
            .output()
        {
            if out.status.success() {
                let raw = String::from_utf8_lossy(&out.stdout);
                // Take the last non-empty line — sourcing files may print extra lines.
                let path = raw.lines()
                    .rev()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() && std::path::Path::new(&path).exists() {
                    return Some(path);
                }
            }
        }
    }
    None
}

/// Search common install locations when the shell lookup fails.
/// Covers GKE (gke-gcloud-auth-plugin), EKS (aws / aws-iam-authenticator),
/// AKS (kubelogin), and generic system paths.
fn find_in_known_paths(bin: &str) -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        // ── GKE — gke-gcloud-auth-plugin ─────────────────────────────────────
        format!("/opt/homebrew/share/google-cloud-sdk/bin/{}", bin),
        format!("/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin/{}", bin),
        format!("{}/google-cloud-sdk/bin/{}", home, bin),
        format!("{}/Library/google-cloud-sdk/bin/{}", home, bin),
        format!("/usr/local/google-cloud-sdk/bin/{}", bin),
        format!("{}/Downloads/google-cloud-sdk/bin/{}", home, bin),

        // ── EKS — aws CLI and aws-iam-authenticator ───────────────────────────
        // AWS CLI v2 default install locations
        format!("/usr/local/bin/{}", bin),
        format!("{}/Library/Python/3.11/bin/{}", home, bin),
        format!("{}/Library/Python/3.10/bin/{}", home, bin),
        format!("{}/Library/Python/3.9/bin/{}", home, bin),
        format!("{}/.local/bin/{}", home, bin),
        // AWS CLI v2 macOS pkg installer
        format!("/usr/local/aws-cli/v2/current/bin/{}", bin),
        // aws-iam-authenticator common locations
        format!("{}/bin/{}", home, bin),

        // ── AKS — kubelogin ───────────────────────────────────────────────────
        format!("/opt/homebrew/bin/{}", bin),
        // kubelogin via krew plugin manager
        format!("{}/.krew/bin/{}", home, bin),
        // kubelogin manual install
        format!("{}/kubelogin/{}", home, bin),

        // ── Linux system paths ────────────────────────────────────────────────
        format!("/usr/bin/{}", bin),
        format!("/snap/bin/{}", bin),
    ];
    candidates.into_iter().find(|p| std::path::Path::new(p).exists())
}

/// Resolve a command to its absolute path.
/// Result is cached so the shell is only spawned once per unique binary name.
fn resolve_command(cmd: &str) -> String {
    if cmd.starts_with('/') {
        return cmd.to_string();
    }
    // Check cache
    if let Ok(map) = cmd_cache().lock() {
        if let Some(cached) = map.get(cmd) {
            return cached.clone();
        }
    }
    let resolved = which_via_shell(cmd)
        .or_else(|| find_in_known_paths(cmd))
        .unwrap_or_else(|| cmd.to_string());
    // Store in cache
    if let Ok(mut map) = cmd_cache().lock() {
        map.insert(cmd.to_string(), resolved.clone());
    }
    resolved
}

// ─── Kube client ─────────────────────────────────────────────────────────────

/// Return a kube Client for the given context.
/// Clients are cached — the same instance is reused across all commands for the
/// same context. kube-rs handles auth-token refresh internally.
pub async fn client_for_context(context: &str) -> anyhow::Result<Client> {
    // Fast path: return cached client
    if let Ok(map) = client_cache().lock() {
        if let Some(client) = map.get(context) {
            return Ok(client.clone());
        }
    }

    // Slow path: build a new client (runs once per context per app session)
    // Union of the default kubeconfig + enabled app-registered entries (see
    // commands/kubeconfig.rs) — never a merge into the user's own file.
    let mut kubeconfig = super::kubeconfig::load_merged_kubeconfig()?;

    // Replace relative exec commands with absolute paths so the bundled .app
    // can find auth plugins (e.g. gke-gcloud-auth-plugin) without a shell PATH.
    for named in kubeconfig.auth_infos.iter_mut() {
        if let Some(auth) = named.auth_info.as_mut() {
            if let Some(exec) = auth.exec.as_mut() {
                if let Some(cmd) = exec.command.as_deref() {
                    exec.command = Some(resolve_command(cmd));
                }
            }
        }
    }

    let options = KubeConfigOptions {
        context: Some(context.to_string()),
        cluster: None,
        user: None,
    };
    let proxy = super::context::effective_proxy(
        super::context::proxy_url_for_context(&kubeconfig, context).as_deref(),
    ).map_err(anyhow::Error::msg)?;
    let mut config = Config::from_custom_kubeconfig(kubeconfig, &options).await?;
    config.proxy_url = proxy; // T51-7: never kube 0.95's env fallback
    let client = Client::try_from(config)?;

    // Cache the new client
    if let Ok(mut map) = client_cache().lock() {
        map.insert(context.to_string(), client.clone());
    }

    Ok(client)
}

// ─── Provider auth-error hints ────────────────────────────────────────────────

/// Map a raw auth-plugin error message to a friendly, provider-specific install hint.
/// Returns `None` when no known pattern matches — callers decide the fallback (e.g.
/// `friendly_helm_error` falls back to the raw message; `check_cluster_access` does too).
///
/// Extracted from `helm.rs`'s `friendly_helm_error` (see docs/plan-kubeconfig-and-parity.md
/// §2.1) so `check_cluster_access` can reuse the same provider hint bank instead of
/// duplicating it. `friendly_helm_error`'s observable output is unchanged — it still always
/// returns a `String`, appending `\n---\n{msg}` after each hint exactly as before.
/// Display name of the app; interpolated into user-facing strings.
pub const PRODUCT_NAME: &str = "Garita";

pub(crate) fn friendly_auth_error(msg: &str) -> Option<String> {
    // GKE
    if msg.contains("gke-gcloud-auth-plugin") {
        return Some(format!(
            "GKE auth plugin not found (gke-gcloud-auth-plugin).\n\
             \n\
             Install:\n\
             \u{2022} gcloud components install gke-gcloud-auth-plugin\n\
             \u{2022} brew install --cask google-cloud-sdk\n\
             \n\
             Then restart {}.", PRODUCT_NAME)
        );
    }
    // EKS — aws-iam-authenticator
    if msg.contains("aws-iam-authenticator") {
        return Some(format!(
            "EKS auth plugin not found (aws-iam-authenticator).\n\
             \n\
             Install:\n\
             \u{2022} brew install aws-iam-authenticator\n\
             \u{2022} Or install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html\n\
             \n\
             Then restart {}.", PRODUCT_NAME)
        );
    }
    // EKS — aws CLI exec credential plugin
    if msg.contains("aws eks get-token") || msg.contains("\"aws\"") && msg.contains("exec") {
        return Some(format!(
            "EKS auth requires the AWS CLI.\n\
             \n\
             Install:\n\
             \u{2022} brew install awscli\n\
             \u{2022} Or: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html\n\
             \n\
             Then restart {}.", PRODUCT_NAME)
        );
    }
    // AKS — kubelogin
    if msg.contains("kubelogin") {
        return Some(format!(
            "AKS auth plugin not found (kubelogin).\n\
             \n\
             Install:\n\
             \u{2022} brew install Azure/kubelogin/kubelogin\n\
             \u{2022} Or: https://azure.github.io/kubelogin/\n\
             \n\
             Then restart {}.", PRODUCT_NAME)
        );
    }
    // Generic exec/credential plugin error
    if msg.contains("credential plugin") || msg.contains("exec plugin") || msg.contains("exec format error") {
        return Some(format!(
            "Kubernetes auth plugin failed to run.\n\
             \n\
             The authentication plugin configured in your kubeconfig could not be executed.\n\
             Common causes:\n\
             \u{2022} GKE:     install gke-gcloud-auth-plugin\n\
             \u{2022} EKS:     install aws-iam-authenticator or AWS CLI v2\n\
             \u{2022} AKS:     install kubelogin\n\
             \u{2022} OIDC:    install kubelogin or your OIDC provider's plugin\n\
             \n\
             After installing, restart {}.", PRODUCT_NAME)
        );
    }
    None
}

// ─── Age helpers ─────────────────────────────────────────────────────────────

pub fn age_from_timestamp(ts: Option<&chrono::DateTime<chrono::Utc>>) -> String {
    ts.map(|t| {
        let secs = (chrono::Utc::now() - *t).num_seconds().max(0) as u64;
        format_age(secs)
    })
    .unwrap_or_else(|| "—".to_string())
}

pub fn format_age(secs: u64) -> String {
    if secs < 60 {
        format!("{}s", secs)
    } else if secs < 3600 {
        format!("{}m", secs / 60)
    } else if secs < 86400 {
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        if m > 0 { format!("{}h{}m", h, m) } else { format!("{}h", h) }
    } else {
        let d = secs / 86400;
        let h = (secs % 86400) / 3600;
        if h > 0 { format!("{}d{}h", d, h) } else { format!("{}d", d) }
    }
}

// ─── Resource quantity parsers ───────────────────────────────────────────────

/// Parse a CPU quantity string like "250m" or "1.5" to millicores.
pub(crate) fn parse_cpu_millis(s: &str) -> Option<i64> {
    if s.ends_with('m') { s[..s.len()-1].parse().ok() }
    else { s.parse::<f64>().ok().map(|v| (v * 1000.0) as i64) }
}

/// Parse a Kubernetes memory Quantity to bytes: binary suffixes `Ki`..`Ei`, decimal `k`..`E` and
/// `m`, no suffix (bytes), exponent form (`129e6`) and a decimal mantissa (`1.5Gi`). `None` for
/// garbage, empty, negative, non-finite or overflowing input. Never panics.
pub(crate) fn parse_mem_bytes(s: &str) -> Option<i64> {
    const SUFFIXES: [(&str, f64); 13] = [
        ("Ki", 1024.0),
        ("Mi", 1_048_576.0),
        ("Gi", 1_073_741_824.0),
        ("Ti", 1_099_511_627_776.0),
        ("Pi", 1_125_899_906_842_624.0),
        ("Ei", 1_152_921_504_606_846_976.0),
        ("k", 1e3),
        ("M", 1e6),
        ("G", 1e9),
        ("T", 1e12),
        ("P", 1e15),
        ("E", 1e18),
        ("m", 1e-3),
    ];
    let (num, mult) = SUFFIXES
        .iter()
        .find_map(|(suf, m)| s.strip_suffix(suf).map(|n| (n, *m)))
        .unwrap_or((s, 1.0));
    let v = num.parse::<f64>().ok()? * mult;
    (v.is_finite() && v >= 0.0 && v < i64::MAX as f64).then_some(v as i64)
}

/// Memory quantity in whole MiB (floor).
pub(crate) fn parse_mem_mib(s: &str) -> Option<i64> {
    parse_mem_bytes(s).map(|b| b / 1_048_576)
}

// ─── Dynamic-object plural helper ────────────────────────────────────────────

/// Map a Kubernetes `kind` (e.g. "Gateway") to its lowercase plural resource name (e.g.
/// "gateways"), for building an `ApiResource` when talking to a CRD/DynamicObject.
///
/// Consolidated from two independent, both-slightly-wrong copies (see
/// docs/plan-tls-cert-and-context-new.md §3.2): `resource_create.rs` used a `y`→`ies` suffix
/// rule that turns `Gateway` into `gatewaies`, and `argocd.rs` used a bare `+s` fallback that
/// turns `PriorityClass` into `priorityclasss`. This version keeps the explicit-irregular-arms
/// + `+s` fallback shape (the correct one) and adds the missing `PriorityClass` arm.
pub(crate) fn kind_to_plural(kind: &str) -> String {
    match kind {
        "Ingress"                    => "ingresses".to_string(),
        "NetworkPolicy"              => "networkpolicies".to_string(),
        "HorizontalPodAutoscaler"    => "horizontalpodautoscalers".to_string(),
        "CustomResourceDefinition"   => "customresourcedefinitions".to_string(),
        "PodDisruptionBudget"        => "poddisruptionbudgets".to_string(),
        "ClusterRole"                => "clusterroles".to_string(),
        "ClusterRoleBinding"         => "clusterrolebindings".to_string(),
        "RoleBinding"                => "rolebindings".to_string(),
        "ServiceAccount"             => "serviceaccounts".to_string(),
        "StorageClass"               => "storageclasses".to_string(),
        "PriorityClass"              => "priorityclasses".to_string(),
        "Endpoints"                  => "endpoints".to_string(),
        k                            => format!("{}s", k.to_lowercase()),
    }
}

// ─── Namespace macro ─────────────────────────────────────────────────────────

/// Resolve "all" / "" to a namespaced or cluster-scoped kube Api.
macro_rules! namespaced_or_all {
    ($client:expr, $ty:ty, $ns:expr) => {
        if $ns == "all" || $ns.is_empty() {
            kube::Api::<$ty>::all($client)
        } else {
            kube::Api::<$ty>::namespaced($client, &$ns)
        }
    };
}

pub(crate) use namespaced_or_all;

#[cfg(test)]
mod tests {
    use super::{friendly_auth_error, kind_to_plural, parse_mem_bytes, parse_mem_mib};

    /// Regression test for the `endpointss` bug (docs/plan-kubeconfig-and-parity.md §3.1): the
    /// bare `+s` fallback used to turn "Endpoints" (already plural) into "endpointss".
    #[test]
    fn endpoints_plural_is_not_doubled() {
        assert_eq!(kind_to_plural("Endpoints"), "endpoints");
    }

    #[test]
    fn memory_quantity_table() {
        for (q, mib) in [
            ("128Mi", 128), ("1Gi", 1024), ("1G", 953), ("512M", 488), ("1.5Gi", 1536),
            ("134217728", 128), ("129e6", 123), ("1Ti", 1_048_576), ("1024Ki", 1), ("1k", 0),
        ] {
            assert_eq!(parse_mem_mib(q), Some(mib), "{q}");
        }
        assert_eq!(parse_mem_bytes("1k"), Some(1000));
        assert_eq!(parse_mem_bytes("1E3"), Some(1000));
        assert_eq!(parse_mem_bytes("1E"), Some(1_000_000_000_000_000_000));
        assert_eq!(parse_mem_bytes("1Ei"), Some(1_152_921_504_606_846_976));
        assert_eq!(parse_mem_bytes("1500m"), Some(1));
        for bad in ["garbage", "", "-1Gi", "Gi", "inf", "NaN", "1e400", "9Ei", "1 Gi", "1Gib"] {
            assert_eq!(parse_mem_bytes(bad), None, "{bad}");
        }
    }

    #[test]
    fn classifies_known_provider_hints() {
        assert!(friendly_auth_error("exec: \"gke-gcloud-auth-plugin\": executable file not found")
            .unwrap()
            .contains("gcloud components install"));
        assert!(friendly_auth_error("exec: \"aws-iam-authenticator\": executable file not found")
            .unwrap()
            .contains("brew install aws-iam-authenticator"));
        assert!(friendly_auth_error("exec: \"kubelogin\": executable file not found")
            .unwrap()
            .contains("kubelogin"));
        assert!(friendly_auth_error("the credential plugin exited with an error")
            .unwrap()
            .contains("auth plugin failed to run"));
    }

    #[test]
    fn returns_none_for_unmatched_messages() {
        // Unreachable/connection-refused/generic errors are NOT auth-plugin errors and must
        // fall through to the caller's own fallback rather than being mislabeled.
        assert!(friendly_auth_error("connection refused").is_none());
        assert!(friendly_auth_error("dial tcp: i/o timeout").is_none());
        assert!(friendly_auth_error("").is_none());
    }
}
