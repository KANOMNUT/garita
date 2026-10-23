//! Kubeconfig lifecycle + de-anchoring — app-local registry of kubeconfig paths.
//!
//! See `docs/plan-kubeconfig-and-parity.md` §1 for the frozen contract. The load-bearing rule:
//! **the user's own kubeconfig is read-only to us.** Importing a kubeconfig never merges into
//! `~/.kube/config` — it registers a path (or, for pasted YAML, a file we write ourselves under
//! the app config dir) in a small local JSON registry, and `load_merged_kubeconfig()` unions the
//! default kubeconfig with the *enabled* registered entries at read time, every time.
//!
//! `client_for_context()` in `utils.rs` is the only other file that calls into this module
//! (`load_merged_kubeconfig`) — that function is on every Tauri command's path, so nothing here
//! may change its behaviour for a caller that has never touched the registry (empty registry =
//! byte-for-byte the old `Kubeconfig::read()` behaviour).

use kube::config::Kubeconfig;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::utils::invalidate_client_cache;

// ─── App config dir ─────────────────────────────────────────────────────────

/// Resolved once at startup from `tauri::AppHandle::path().app_config_dir()` (see `lib.rs`'s
/// `.setup()` closure). `client_for_context()` lives in `utils.rs` and has no `AppHandle`, so
/// resolving this once here keeps the registry reachable from there without threading
/// `AppHandle` through every command signature.
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init_config_dir(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = CONFIG_DIR.set(dir);
    }
}

fn config_dir() -> Result<PathBuf, String> {
    CONFIG_DIR
        .get()
        .cloned()
        .ok_or_else(|| "App config directory not initialized".to_string())
}

// ─── Registry ────────────────────────────────────────────────────────────────

/// One app-registered kubeconfig path. Persisted at `<app_config_dir>/kubeconfigs.json`.
/// The *default* kubeconfig is never stored here — it is synthesized on every read (see
/// `default_kubeconfig_display_path`) so it is always present and always enabled.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegistryEntry {
    path: String,
    enabled: bool,
    app_owned: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Registry {
    #[serde(default)]
    entries: Vec<RegistryEntry>,
}

fn registry_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("kubeconfigs.json"))
}

/// Missing file = empty registry (first run), not an error. A corrupt registry file degrades the
/// same way — an empty registry — rather than breaking every kube command in the app.
fn load_registry() -> Registry {
    let Some(dir) = CONFIG_DIR.get() else {
        return Registry::default();
    };
    match std::fs::read_to_string(dir.join("kubeconfigs.json")) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Registry::default(),
    }
}

// ponytail: no lock around read-modify-write of the registry file. Mutations are user-triggered
// (add/remove/toggle in the switcher UI), not a hot path — add a mutex if concurrent writers ever
// show up in practice.
fn save_registry(reg: &Registry) -> Result<(), String> {
    let path = registry_path()?;
    let content = serde_json::to_string_pretty(reg)
        .map_err(|e| format!("Failed to serialize kubeconfig registry: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write kubeconfig registry: {}", e))
}

/// Best-effort display path for "the default kubeconfig" row: the first `$KUBECONFIG` entry, or
/// `~/.kube/config`. This is display/identity metadata only — it is NOT used to decide what to
/// merge (that's `Kubeconfig::read()`, which honours the full `$KUBECONFIG` list) and it is NOT
/// used to decide where to write anything. Moved here from the deleted `context.rs::kubeconfig_path()`.
fn default_kubeconfig_display_path() -> String {
    if let Ok(kc) = std::env::var("KUBECONFIG") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        if let Some(first) = kc.split(sep).find(|s| !s.is_empty()) {
            return first.to_string();
        }
    }
    let home = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .unwrap_or_else(|_| if cfg!(windows) { "C:\\Users\\default".to_string() } else { "/root".to_string() });
    Path::new(&home).join(".kube").join("config").to_string_lossy().to_string()
}

/// `Kubeconfig::read()` (the default kubeconfig, honouring `$KUBECONFIG`) followed by
/// `.merge()`-ing every *enabled* registered entry, in registration order. Default-first,
/// registered-in-order after — first-wins-by-name (§1.3), matching kubectl's own merge rule.
///
/// A broken/deleted registered entry (unreadable file, or a merge that errors on a kind/apiVersion
/// mismatch) is skipped, not fatal — one bad file must not break every command in the app. Its
/// error surfaces through `list_kubeconfigs`, which reads each file individually.
///
/// A missing/unreadable *default* kubeconfig is likewise not fatal here: a user whose only
/// kubeconfig is one they pasted via `add_kubeconfig_yaml` (no `~/.kube/config` at all) must still
/// be able to use it. `Kubeconfig::default()` is an empty base — merging registered entries into
/// it just yields the registered union. `list_kubeconfigs`'s default-row `error` field is the
/// channel for surfacing a missing default to the user, not this function returning `Err`.
pub fn load_merged_kubeconfig() -> anyhow::Result<Kubeconfig> {
    let mut merged = Kubeconfig::read().unwrap_or_default();
    for entry in load_registry().entries.into_iter().filter(|e| e.enabled) {
        if let Ok(kc) = Kubeconfig::read_from(&entry.path) {
            if let Ok(m) = merged.clone().merge(kc) {
                merged = m;
            }
        }
    }
    Ok(merged)
}

/// Enabled kubeconfig file paths, in merge order (default first, then enabled registered
/// entries) — same membership as `load_merged_kubeconfig`'s union, but returned as plain paths
/// rather than parsed `Kubeconfig`s. For external tools that need a `$KUBECONFIG`-style path
/// list — currently only `helm.rs`, whose `helm` subprocess has no awareness of this app's
/// kubeconfig registry and otherwise resolves `--kube-context` against the OS's own
/// `$KUBECONFIG`/`~/.kube/config`, failing with a confusing "context not found" for any context
/// that lives only in a registered (non-default) kubeconfig.
pub(crate) fn enabled_kubeconfig_paths() -> Vec<String> {
    let mut paths = vec![default_kubeconfig_display_path()];
    paths.extend(load_registry().entries.into_iter().filter(|e| e.enabled).map(|e| e.path));
    paths
}

/// Enabled kubeconfig "groups" in merge order: `(source_path, parsed_config)`, default first,
/// then enabled registered entries in registration order. Used by `context.rs::list_contexts` to
/// compute per-context provenance (which file's CONTEXT entry won, and which other enabled files
/// shadow it — §1.3). Unreadable entries are skipped, mirroring `load_merged_kubeconfig`.
pub(crate) fn enabled_groups() -> Vec<(String, Kubeconfig)> {
    let mut groups = Vec::new();
    if let Ok(kc) = Kubeconfig::read() {
        groups.push((default_kubeconfig_display_path(), kc));
    }
    for entry in load_registry().entries.into_iter().filter(|e| e.enabled) {
        if let Ok(kc) = Kubeconfig::read_from(&entry.path) {
            groups.push((entry.path, kc));
        }
    }
    groups
}

// ─── Paste-vs-file asymmetry (§1.4) ─────────────────────────────────────────

/// `Kubeconfig::read_from(path)` remaps relative `certificate-authority` / `client-certificate` /
/// `client-key` / `tokenFile` values to absolute, using the kubeconfig's own parent directory.
/// Pasted YAML has no such directory — a relative value would resolve against the app config dir
/// and fail opaquely at first request. Reject it up front instead, naming the offending field and
/// context. `exec.command` is exempt (`resolve_command()` in `utils.rs` already handles bare
/// binary names). Absolute paths and inline `*-data` fields are fine and are not checked here.
fn validate_no_relative_paths(kc: &Kubeconfig) -> Result<(), String> {
    for named_ctx in &kc.contexts {
        let Some(ctx) = &named_ctx.context else { continue };

        if let Some(cluster) = kc
            .clusters
            .iter()
            .find(|c| c.name == ctx.cluster)
            .and_then(|c| c.cluster.as_ref())
        {
            if let Some(ca) = &cluster.certificate_authority {
                if !Path::new(ca).is_absolute() {
                    return Err(format!(
                        "Context '{}' has a relative path in 'certificate-authority': '{}'. Pasted kubeconfigs must use absolute paths (or inline certificate-authority-data).",
                        named_ctx.name, ca
                    ));
                }
            }
        }

        if let Some(auth) = kc
            .auth_infos
            .iter()
            .find(|a| a.name == ctx.user)
            .and_then(|a| a.auth_info.as_ref())
        {
            if let Some(p) = &auth.client_certificate {
                if !Path::new(p).is_absolute() {
                    return Err(format!(
                        "Context '{}' has a relative path in 'client-certificate': '{}'. Pasted kubeconfigs must use absolute paths (or inline client-certificate-data).",
                        named_ctx.name, p
                    ));
                }
            }
            if let Some(p) = &auth.client_key {
                if !Path::new(p).is_absolute() {
                    return Err(format!(
                        "Context '{}' has a relative path in 'client-key': '{}'. Pasted kubeconfigs must use absolute paths (or inline client-key-data).",
                        named_ctx.name, p
                    ));
                }
            }
            if let Some(p) = &auth.token_file {
                if !Path::new(p).is_absolute() {
                    return Err(format!(
                        "Context '{}' has a relative path in 'tokenFile': '{}'. Pasted kubeconfigs must use absolute paths.",
                        named_ctx.name, p
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Shared by `preview_kubeconfig_yaml` and `add_kubeconfig_yaml` — never trust a two-step check,
/// the add path re-validates rather than trusting a prior preview.
fn parse_and_validate_pasted_yaml(yaml: &str) -> Result<Kubeconfig, String> {
    let kc: Kubeconfig =
        serde_yaml::from_str(yaml).map_err(|e| format!("Failed to parse kubeconfig YAML: {}", e))?;
    validate_no_relative_paths(&kc)?;
    Ok(kc)
}

// ─── KubeconfigEntry (frozen struct, §1.7) ──────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct KubeconfigEntry {
    pub path: String,
    pub source: String,
    pub enabled: bool,
    pub app_owned: bool,
    pub contexts: Vec<String>,
    pub error: Option<String>,
}

fn entry_from_result(
    path: String,
    source: &str,
    enabled: bool,
    app_owned: bool,
    result: Result<Kubeconfig, kube::config::KubeconfigError>,
) -> KubeconfigEntry {
    match result {
        Ok(kc) => KubeconfigEntry {
            path,
            source: source.to_string(),
            enabled,
            app_owned,
            contexts: kc.contexts.into_iter().map(|c| c.name).collect(),
            error: None,
        },
        Err(e) => KubeconfigEntry {
            path,
            source: source.to_string(),
            enabled,
            app_owned,
            contexts: Vec::new(),
            error: Some(format!("Failed to read kubeconfig: {}", e)),
        },
    }
}

fn build_default_entry() -> KubeconfigEntry {
    entry_from_result(default_kubeconfig_display_path(), "default", true, false, Kubeconfig::read())
}

fn build_entry(path: String, enabled: bool, app_owned: bool) -> KubeconfigEntry {
    let result = Kubeconfig::read_from(&path);
    entry_from_result(path, "registered", enabled, app_owned, result)
}

// ─── Filename sanitisation (§1.8) ───────────────────────────────────────────

/// `[-._a-zA-Z0-9]` only, non-matching chars replaced with `-`.
fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' })
        .collect();
    if sanitized.is_empty() {
        "kubeconfig".to_string()
    } else {
        sanitized
    }
}

/// Collision-suffixed: `<base>.yaml`, then `<base>-2.yaml`, `<base>-3.yaml`, ...
fn unique_path(dir: &Path, base: &str) -> PathBuf {
    let candidate = dir.join(format!("{}.yaml", base));
    if !candidate.exists() {
        return candidate;
    }
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("{}-{}.yaml", base, n));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Write a brand-new file with mode 0600 from the moment it exists — we are writing credentials
/// to disk. Plain `fs::write` + a follow-up `set_permissions` leaves the file at the umask default
/// (commonly 0644, world-readable) for the window between create and chmod; `create_new` + `mode`
/// sets the mode atomically at creation on unix. Non-unix has no equivalent story here.
#[cfg(unix)]
fn write_new_file_0600(path: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("Failed to write kubeconfig: {}", e))?;
    f.write_all(content.as_bytes()).map_err(|e| format!("Failed to write kubeconfig: {}", e))
}

#[cfg(not(unix))]
fn write_new_file_0600(path: &Path, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| format!("Failed to write kubeconfig: {}", e))
}

// ─── Commands (§1.8) ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_kubeconfigs() -> Result<Vec<KubeconfigEntry>, String> {
    let mut result = vec![build_default_entry()];
    for entry in load_registry().entries {
        result.push(build_entry(entry.path, entry.enabled, entry.app_owned));
    }
    Ok(result)
}

/// Never writes anything, never mutates the registry. File-picker path is safe by construction —
/// `Kubeconfig::read_from` remaps relative cert/key paths against the picked file's own directory.
#[tauri::command]
pub async fn preview_kubeconfig_path(path: String) -> Result<KubeconfigEntry, String> {
    Ok(build_entry(path, true, false))
}

/// Never writes anything, never mutates the registry. Runs the paste-only relative-path check
/// (§1.4) since there is no file location for a pasted document's relative refs to resolve
/// against. `path` is empty — nothing has been written yet at preview time.
#[tauri::command]
pub async fn preview_kubeconfig_yaml(yaml: String) -> Result<KubeconfigEntry, String> {
    match parse_and_validate_pasted_yaml(&yaml) {
        Ok(kc) => Ok(KubeconfigEntry {
            path: String::new(),
            source: "registered".to_string(),
            enabled: true,
            app_owned: true,
            contexts: kc.contexts.into_iter().map(|c| c.name).collect(),
            error: None,
        }),
        Err(e) => Ok(KubeconfigEntry {
            path: String::new(),
            source: "registered".to_string(),
            enabled: true,
            app_owned: true,
            contexts: Vec::new(),
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn add_kubeconfig_path(path: String) -> Result<KubeconfigEntry, String> {
    // The default kubeconfig is already in the union unconditionally (§1.8). Registering it too
    // would make `enabled_groups()` see it twice, marking every context as shadowed by itself.
    if path == default_kubeconfig_display_path() {
        return Ok(build_default_entry());
    }

    // Validate it actually reads before registering — a file the user just picked that turns out
    // to be broken should not be silently added.
    Kubeconfig::read_from(&path).map_err(|e| format!("Failed to read kubeconfig: {}", e))?;

    let mut reg = load_registry();
    if !reg.entries.iter().any(|e| e.path == path) {
        reg.entries.push(RegistryEntry { path: path.clone(), enabled: true, app_owned: false });
        save_registry(&reg)?;
    }
    invalidate_client_cache();
    Ok(build_entry(path, true, false))
}

#[tauri::command]
pub async fn add_kubeconfig_yaml(yaml: String, name: String) -> Result<KubeconfigEntry, String> {
    parse_and_validate_pasted_yaml(&yaml)?;

    let dir = config_dir()?.join("kubeconfigs");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create kubeconfigs directory: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Best-effort: the file itself is created at 0600 regardless (see write_new_file_0600),
        // this just keeps the directory listing from being world-readable too.
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }

    let sanitized = sanitize_filename(&name);
    let path = unique_path(&dir, &sanitized);

    write_new_file_0600(&path, &yaml)?;

    let path_str = path.to_string_lossy().to_string();
    let mut reg = load_registry();
    reg.entries.push(RegistryEntry { path: path_str.clone(), enabled: true, app_owned: true });
    save_registry(&reg)?;

    invalidate_client_cache();
    Ok(build_entry(path_str, true, true))
}

/// De-registers only. Never deletes a file from disk — not the user's, not our own. De-registering
/// an `app_owned` file leaves it recoverable through the file picker.
#[tauri::command]
pub async fn remove_kubeconfig(path: String) -> Result<(), String> {
    let mut reg = load_registry();
    reg.entries.retain(|e| e.path != path);
    save_registry(&reg)?;
    invalidate_client_cache();
    Ok(())
}

#[tauri::command]
pub async fn set_kubeconfig_enabled(path: String, enabled: bool) -> Result<(), String> {
    // The default kubeconfig is always in the union — toggling it is a no-op.
    if path == default_kubeconfig_display_path() {
        return Ok(());
    }
    let mut reg = load_registry();
    if let Some(entry) = reg.entries.iter_mut().find(|e| e.path == path) {
        entry.enabled = enabled;
    }
    save_registry(&reg)?;
    invalidate_client_cache();
    Ok(())
}

// ─── Tests (§1.3, §1.9 item 1) ───────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use kube::config::{AuthInfo, Cluster, Context, NamedAuthInfo, NamedCluster, NamedContext};
    use std::collections::HashSet;

    fn kc_with(ctx_name: &str, cluster_name: &str, server: &str, user_name: &str) -> Kubeconfig {
        Kubeconfig {
            clusters: vec![NamedCluster {
                name: cluster_name.to_string(),
                cluster: Some(Cluster { server: Some(server.to_string()), ..Default::default() }),
            }],
            auth_infos: vec![NamedAuthInfo { name: user_name.to_string(), auth_info: Some(AuthInfo::default()) }],
            contexts: vec![NamedContext {
                name: ctx_name.to_string(),
                context: Some(Context {
                    cluster: cluster_name.to_string(),
                    user: user_name.to_string(),
                    namespace: None,
                    extensions: None,
                }),
            }],
            ..Default::default()
        }
    }

    /// §1.3's required test: merge two in-memory Kubeconfigs that share a context name, assert
    /// the base's cluster/user survive (first-wins-by-name, per `append_new_named`).
    #[test]
    fn merge_first_wins_on_duplicate_context_name() {
        let base = kc_with("shared", "base-cluster", "https://base.example", "base-user");
        let other = kc_with("shared", "other-cluster", "https://other.example", "other-user");

        let merged = base.merge(other).expect("merge should succeed");

        assert_eq!(merged.contexts.len(), 1, "duplicate context name must not be duplicated");
        let ctx = merged.contexts[0].context.as_ref().expect("context body present");
        assert_eq!(ctx.cluster, "base-cluster");
        assert_eq!(ctx.user, "base-user");

        // The base's cluster (and its server URL) must survive untouched.
        let cluster = merged
            .clusters
            .iter()
            .find(|c| c.name == "base-cluster")
            .expect("base cluster survives");
        assert_eq!(cluster.cluster.as_ref().unwrap().server.as_deref(), Some("https://base.example"));

        // The shadowed cluster/user are still present (merge is per-name, per-section — §1.3) —
        // they just aren't the ones this context resolves to.
        let names: HashSet<_> = merged.clusters.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains("other-cluster"));
    }

    fn base_valid_kc() -> Kubeconfig {
        kc_with("ctx", "cluster", "https://example.com", "user")
    }

    #[test]
    fn rejects_relative_certificate_authority() {
        let mut kc = base_valid_kc();
        kc.clusters[0].cluster.as_mut().unwrap().certificate_authority = Some("./certs/ca.pem".to_string());
        let err = validate_no_relative_paths(&kc).expect_err("relative CA path must be rejected");
        assert!(err.contains("certificate-authority"));
        assert!(err.contains("ctx"));
    }

    #[test]
    fn rejects_relative_client_certificate() {
        let mut kc = base_valid_kc();
        kc.auth_infos[0].auth_info.as_mut().unwrap().client_certificate = Some("certs/user.crt".to_string());
        let err = validate_no_relative_paths(&kc).expect_err("relative client-certificate must be rejected");
        assert!(err.contains("client-certificate"));
        assert!(err.contains("ctx"));
    }

    #[test]
    fn rejects_relative_client_key() {
        let mut kc = base_valid_kc();
        kc.auth_infos[0].auth_info.as_mut().unwrap().client_key = Some("./certs/user.key".to_string());
        let err = validate_no_relative_paths(&kc).expect_err("relative client-key must be rejected");
        assert!(err.contains("client-key"));
        assert!(err.contains("ctx"));
    }

    #[test]
    fn rejects_relative_token_file() {
        let mut kc = base_valid_kc();
        kc.auth_infos[0].auth_info.as_mut().unwrap().token_file = Some("token".to_string());
        let err = validate_no_relative_paths(&kc).expect_err("relative tokenFile must be rejected");
        assert!(err.contains("tokenFile"));
        assert!(err.contains("ctx"));
    }

    #[test]
    fn accepts_absolute_paths() {
        let mut kc = base_valid_kc();
        kc.clusters[0].cluster.as_mut().unwrap().certificate_authority = Some("/abs/ca.pem".to_string());
        let auth = kc.auth_infos[0].auth_info.as_mut().unwrap();
        auth.client_certificate = Some("/abs/user.crt".to_string());
        auth.client_key = Some("/abs/user.key".to_string());
        auth.token_file = Some("/abs/token".to_string());
        assert!(validate_no_relative_paths(&kc).is_ok());
    }

    #[test]
    fn accepts_inline_data_fields() {
        let mut kc = base_valid_kc();
        // Inline *-data fields, no plain path fields set at all — nothing to reject.
        kc.clusters[0].cluster.as_mut().unwrap().certificate_authority_data = Some("aGVsbG8=".to_string());
        kc.auth_infos[0].auth_info.as_mut().unwrap().client_certificate_data = Some("aGVsbG8=".to_string());
        assert!(validate_no_relative_paths(&kc).is_ok());
    }
}
