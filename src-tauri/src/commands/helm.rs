use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HelmRelease {
    pub name: String,
    pub namespace: String,
    pub revision: String,
    pub updated: String,
    pub status: String,
    pub chart: String,
    pub chart_name: String,
    pub app_version: String,
}

#[derive(Deserialize)]
struct HelmRaw {
    name: String,
    namespace: String,
    revision: String,
    updated: String,
    status: String,
    chart: String,
    app_version: String,
}

fn chart_base_name(chart: &str) -> String {
    if let Some(idx) = chart.rfind('-') {
        let after = &chart[idx + 1..];
        if after.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return chart[..idx].to_string();
        }
    }
    chart.to_string()
}

/// Build a PATH that prepends every known auth-plugin location for all major
/// Kubernetes providers (GKE, EKS, AKS, OIDC, Rancher, K3s, self-hosted).
/// fix_path() has already run so the login-shell PATH is in `current`; these
/// static prefixes are a belt-and-suspenders fallback for bundled-app launches.
fn helm_path() -> String {
    let home    = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let static_extra = [
        // macOS standard tool locations
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        // ── GKE: gke-gcloud-auth-plugin ──────────────────────────────────────
        "/opt/homebrew/share/google-cloud-sdk/bin",
        "/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin",
        "/usr/local/google-cloud-sdk/bin",
        "/usr/lib/google-cloud-sdk/bin",
        "/usr/share/google-cloud-sdk/bin",
        // ── EKS: aws-iam-authenticator / aws CLI v2 ──────────────────────────
        "/usr/local/aws-cli/v2/current/bin",   // AWS CLI v2 macOS pkg installer
        "/usr/local/aws-cli/bin",
        // ── AKS: kubelogin (azure kubelogin) ─────────────────────────────────
        "/opt/homebrew/opt/kubelogin/bin",
        // ── Linux snap ───────────────────────────────────────────────────────
        "/snap/bin",
        "/snap/google-cloud-cli/current/bin",
    ];
    let home_extra = [
        // GKE — user-level gcloud install
        format!("{}/google-cloud-sdk/bin", home),
        format!("{}/Library/google-cloud-sdk/bin", home),
        // EKS — aws-iam-authenticator / aws CLI manual installs
        format!("{}/.local/bin", home),
        format!("{}/bin", home),
        // AKS — kubelogin user install
        format!("{}/.azure/bin", home),
        // kubectl krew plugins (kubelogin, aws-iam-authenticator, etc.)
        format!("{}/.krew/bin", home),
    ];
    let mut parts: Vec<String> = static_extra.iter().map(|s| s.to_string())
        .chain(home_extra)
        .chain(current.split(':').filter(|s| !s.is_empty()).map(|s| s.to_string()))
        .collect();
    parts.dedup();
    parts.join(":")
}

/// Provider-specific message matching lives in `utils::friendly_auth_error` (shared with
/// `check_cluster_access` — see docs/plan-kubeconfig-and-parity.md §2.1). Observable output
/// here is unchanged: a matched hint gets `\n---\n{stderr}` appended, same as before extraction.
fn friendly_helm_error(stderr: &str) -> String {
    match super::utils::friendly_auth_error(stderr) {
        Some(hint) => format!("{hint}\n---\n{stderr}"),
        None => stderr.to_string(),
    }
}

/// The `helm` binary resolves `--kube-context` against its own view of `$KUBECONFIG` — it has no
/// awareness of this app's local kubeconfig registry (`commands/kubeconfig.rs`). Without this, a
/// context that exists only in a registered (non-default) kubeconfig fails every Helm operation
/// with a confusing "context not found" from the subprocess, even though the same context works
/// fine for every kube-rs call in the app. Reuses `kubeconfig::enabled_kubeconfig_paths()` rather
/// than re-deriving which paths are enabled.
fn kubeconfig_env_value() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    super::kubeconfig::enabled_kubeconfig_paths().join(sep)
}

/// Run `helm` and hand back the raw output. `Err` only when the binary could not be run at all.
async fn helm_output(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("helm")
        .args(args)
        .env("PATH", helm_path())
        .env("KUBECONFIG", kubeconfig_env_value())
        .output()
        .await
        .map_err(|e| format!("helm not found or failed to run: {}", e))
}

async fn helm_run(args: &[&str]) -> Result<String, String> {
    let out = helm_output(args).await?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(crate::app_log::scrub(&friendly_helm_error(String::from_utf8_lossy(&out.stderr).trim())))
    }
}

#[tauri::command]
pub async fn list_helm_releases(context: String) -> Result<Vec<HelmRelease>, String> {
    let raw = helm_run(&[
        "list", "--all-namespaces", "-o", "json", "--kube-context", &context,
    ])
    .await?;
    let items: Vec<HelmRaw> =
        serde_json::from_str(&raw).map_err(|e| format!("Parse error: {}", e))?;
    Ok(items
        .into_iter()
        .map(|r| {
            let chart_name = chart_base_name(&r.chart);
            HelmRelease {
                name: r.name,
                namespace: r.namespace,
                revision: r.revision,
                updated: r.updated,
                status: r.status,
                chart_name,
                chart: r.chart,
                app_version: r.app_version,
            }
        })
        .collect())
}

/// Placeholder written over redacted values; the upgrade/preview guards refuse any YAML containing it.
pub(crate) const HELM_REDACTION_SENTINEL: &str = "<redacted>";
/// Pre-v2 placeholder. Still refused forever: values saved from an old session may carry it.
const LEGACY_HELM_REDACTION_SENTINEL: &str = "<redacted by Watchtower>";

const HELM_REDACT_UNPARSABLE: &str = "# Values could not be parsed for redaction. Use Reveal to view them.";

/// Case-insensitive substrings; a scalar under a matching key is redacted.
/// (app_log.rs `SCRUB_KEYS` is a different, log-line-shaped list, so this one stands alone.)
const HELM_REDACT_KEYS: &[&str] = &["password", "secret", "token", "key", "credential"];

/// `hit`: the nearest enclosing mapping key looks like a credential. Sequences pass it to their
/// elements; a nested mapping uses its own keys.
fn redact_value(v: &mut serde_yaml::Value, hit: bool) {
    use serde_yaml::Value;
    match v {
        Value::Mapping(m) => {
            for (k, val) in m.iter_mut() {
                let hit = k.as_str().is_some_and(|k| {
                    let k = k.to_ascii_lowercase();
                    HELM_REDACT_KEYS.iter().any(|p| k.contains(p))
                });
                redact_value(val, hit);
            }
        }
        Value::Sequence(seq) => seq.iter_mut().for_each(|e| redact_value(e, hit)),
        _ if hit => *v = Value::String(HELM_REDACTION_SENTINEL.into()),
        _ => {}
    }
}

/// Replace every scalar under a credential-looking key with the sentinel. Single-document parse;
/// anything unparsable yields a fixed notice, never the raw text.
fn redact_values(yaml: &str) -> String {
    match serde_yaml::from_str::<serde_yaml::Value>(yaml) {
        Ok(serde_yaml::Value::Null) => String::new(),
        Ok(mut v) => {
            redact_value(&mut v, false);
            serde_yaml::to_string(&v).unwrap_or_else(|_| HELM_REDACT_UNPARSABLE.into())
        }
        Err(_) => HELM_REDACT_UNPARSABLE.into(),
    }
}

/// Parsed values for the journal summary (a key count; the values themselves are never kept).
fn values_payload(values_yaml: &str) -> Option<serde_json::Value> {
    serde_yaml::from_str::<serde_json::Value>(values_yaml).ok()
}

const HELM_MASK_UNPARSABLE: &str = "# The rendered manifest could not be parsed for masking.";

/// Rendered manifest with every Secret document's `data`/`stringData` values replaced by the
/// sentinel. Hang-safe split; any parse error yields a fixed line, never the raw text.
fn mask_rendered_secrets(manifest: &str) -> String {
    let mut out = Vec::new();
    for (_, doc) in super::apply_file::split_yaml_documents(manifest) {
        let Ok(mut doc) = doc else { return HELM_MASK_UNPARSABLE.into() };
        if doc.get("kind").and_then(|k| k.as_str()) == Some("Secret") {
            for f in ["data", "stringData"] {
                if let Some(m) = doc.get_mut(f).and_then(|d| d.as_object_mut()) {
                    m.values_mut().for_each(|v| *v = HELM_REDACTION_SENTINEL.into());
                }
            }
        }
        match serde_yaml::to_string(&doc) {
            Ok(y) => out.push(y),
            Err(_) => return HELM_MASK_UNPARSABLE.into(),
        }
    }
    out.join("---
")
}

const HELM_DRY_RUN_OK: &str =
    "Dry run succeeded. The rendered manifest isn't shown because it can contain Secret values.";

/// A successful dry run never returns helm's output (it holds rendered Secret documents).
fn install_output(dry_run: bool, result: Result<String, String>) -> Result<String, String> {
    match result {
        Ok(_) if dry_run => Ok(HELM_DRY_RUN_OK.into()),
        r => r,
    }
}

/// `Err(msg)` if the edited values still carry the redaction placeholder.
fn reject_redacted(values_yaml: &str, op: &str) -> Result<(), String> {
    if values_yaml.contains(HELM_REDACTION_SENTINEL) || values_yaml.contains(LEGACY_HELM_REDACTION_SENTINEL) {
        return Err(format!(
            "Failed to {}: the values contain a redacted placeholder. Reveal the values and edit again.",
            op
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn get_helm_values(
    context: String, namespace: String, release: String, reveal: Option<bool>,
) -> Result<String, String> {
    let raw = helm_run(&[
        "get", "values", &release, "-n", &namespace, "--kube-context", &context, "-o", "yaml",
    ])
    .await?;
    Ok(if reveal == Some(true) {
        if raw.trim() == "null" { String::new() } else { raw }
    } else {
        redact_values(&raw)
    })
}


/// Recursively materialise a Helm chart JSON object (as stored inside a Helm 3
/// release secret) into a filesystem directory that `helm upgrade` can consume.
/// Handles Chart.yaml, values.yaml, templates/, files/, values.schema.json, and
/// nested subcharts under charts/.
fn write_chart_to_dir(chart: &serde_json::Value, dir: &std::path::Path) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    // Chart.yaml from metadata field
    if let Some(meta) = chart.get("metadata") {
        let yaml = serde_yaml::to_string(meta)
            .map_err(|e| format!("Failed to serialize Chart.yaml: {}", e))?;
        std::fs::write(dir.join("Chart.yaml"), yaml)
            .map_err(|e| format!("Failed to write Chart.yaml: {}", e))?;
    }

    // values.yaml from values field
    if let Some(vals) = chart.get("values") {
        let yaml = serde_yaml::to_string(vals)
            .map_err(|e| format!("Failed to serialize values.yaml: {}", e))?;
        std::fs::write(dir.join("values.yaml"), yaml)
            .map_err(|e| format!("Failed to write values.yaml: {}", e))?;
    }

    // templates/ directory
    if let Some(templates) = chart.get("templates").and_then(|t| t.as_array()) {
        let tpl_dir = dir.join("templates");
        std::fs::create_dir_all(&tpl_dir)
            .map_err(|e| format!("Failed to create templates dir: {}", e))?;
        for tpl in templates {
            let name = tpl.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
            let data_b64 = tpl.get("data").and_then(|d| d.as_str()).unwrap_or("");
            let data = STANDARD.decode(data_b64)
                .unwrap_or_else(|_| data_b64.as_bytes().to_vec());
            // name is like "templates/deployment.yaml" or "templates/grafana/configmap.yaml"
            let filename = name.trim_start_matches("templates/");
            if filename.is_empty() { continue; }
            let file_path = tpl_dir.join(filename);
            if let Some(parent) = file_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir for template {}: {}", name, e))?;
            }
            std::fs::write(&file_path, data)
                .map_err(|e| format!("Failed to write template {}: {}", name, e))?;
        }
    }

    // files/ (CRDs, README, etc.)
    if let Some(files) = chart.get("files").and_then(|f| f.as_array()) {
        for file in files {
            let name = file.get("name").and_then(|n| n.as_str()).unwrap_or_default();
            if name.is_empty() { continue; }
            let data_b64 = file.get("data").and_then(|d| d.as_str()).unwrap_or("");
            let data = STANDARD.decode(data_b64)
                .unwrap_or_else(|_| data_b64.as_bytes().to_vec());
            let path = dir.join(name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir for {}: {}", name, e))?;
            }
            std::fs::write(&path, data)
                .map_err(|e| format!("Failed to write file {}: {}", name, e))?;
        }
    }

    // values.schema.json (optional, base64-encoded)
    if let Some(schema_b64) = chart.get("schema").and_then(|s| s.as_str()) {
        if !schema_b64.is_empty() {
            if let Ok(schema_bytes) = STANDARD.decode(schema_b64) {
                if !schema_bytes.is_empty() {
                    std::fs::write(dir.join("values.schema.json"), schema_bytes)
                        .map_err(|e| format!("Failed to write schema: {}", e))?;
                }
            }
        }
    }

    // Subcharts go in charts/ — try both "dependencies" (Go JSON field) and "charts"
    let deps_key = if chart.get("dependencies").and_then(|d| d.as_array()).is_some() {
        "dependencies"
    } else {
        "charts"
    };
    if let Some(deps) = chart.get(deps_key).and_then(|d| d.as_array()) {
        if !deps.is_empty() {
            let charts_dir = dir.join("charts");
            std::fs::create_dir_all(&charts_dir)
                .map_err(|e| format!("Failed to create charts dir: {}", e))?;
            for dep in deps {
                let dep_name = dep.get("metadata")
                    .and_then(|m| m.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("dep");
                let sub_dir = charts_dir.join(dep_name);
                std::fs::create_dir_all(&sub_dir)
                    .map_err(|e| format!("Failed to create subchart dir {}: {}", dep_name, e))?;
                write_chart_to_dir(dep, &sub_dir)?;
            }
        }
    }

    Ok(())
}

/// Decode a Helm 3 release secret's `release` value: base64(gzip(json)) stored as a UTF-8
/// string. kube-rs already removed the outer Kubernetes base64 layer, so `bytes` are the raw
/// helm-encoded bytes. The decoded release (it holds the chart and values) never leaves the backend.
pub(crate) fn decode_helm_release(bytes: &[u8]) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use flate2::read::GzDecoder;
    use std::io::Read;

    let b64_str = std::str::from_utf8(bytes)
        .map_err(|e| format!("Helm secret value is not valid UTF-8: {}", e))?;

    let gzipped = STANDARD.decode(b64_str.trim())
        .map_err(|e| format!("Failed to base64-decode Helm release data: {}", e))?;

    let mut gz = GzDecoder::new(gzipped.as_slice());
    let mut json_bytes = Vec::new();
    gz.read_to_end(&mut json_bytes)
        .map_err(|e| format!("Failed to decompress Helm release data: {}", e))?;

    serde_json::from_slice(&json_bytes)
        .map_err(|e| format!("Failed to parse Helm release JSON: {}", e))
}

/// Extract the full chart archive that Helm 3 stores in the release secret and
/// write it to a temp directory. This is source-agnostic: it works for charts
/// installed from private repos, OCI registries, local paths, or CI pipelines,
/// because Helm always embeds the complete chart in the release secret.
async fn extract_chart_from_k8s(
    context: &str,
    namespace: &str,
    release: &str,
) -> Result<tempfile::TempDir, String> {
    use kube::{Api, api::ListParams};
    use k8s_openapi::api::core::v1::Secret;

    let client = crate::commands::utils::client_for_context(context).await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let secrets: Api<Secret> = Api::namespaced(client, namespace);

    // Helm 3 release secrets are labeled owner=helm,name=<release>
    let lp = ListParams::default().labels(&format!("owner=helm,name={}", release));
    let list = secrets.list(&lp).await
        .map_err(|e| format!("Failed to list Helm release secrets: {}", e))?;

    // Pick the secret with the highest revision number.
    // Secret names: sh.helm.release.v1.<release>.v<N>
    let secret = list.items
        .into_iter()
        .filter_map(|s| {
            let name = s.metadata.name.as_deref()?;
            let ver: i64 = name.rsplit('.').next()
                .and_then(|v| v.strip_prefix('v'))
                .and_then(|v| v.parse().ok())?;
            Some((ver, s))
        })
        .max_by_key(|(v, _)| *v)
        .map(|(_, s)| s)
        .ok_or_else(|| format!(
            "No Helm release secret found for '{}' in namespace '{}'. \
             The release may use a non-default storage backend.",
            release, namespace
        ))?;

    let data_map = secret.data
        .ok_or("Helm release secret has no data")?;
    let byte_string = data_map.get("release")
        .ok_or("Helm release secret missing 'release' key")?;

    let release_json = decode_helm_release(&byte_string.0)?;

    let chart = release_json.get("chart")
        .ok_or("Helm release JSON is missing the 'chart' field")?;

    let tmp = tempfile::TempDir::new()
        .map_err(|e| format!("Failed to create temp chart directory: {}", e))?;

    write_chart_to_dir(chart, tmp.path())?;

    Ok(tmp)
}

#[tauri::command]
pub async fn upgrade_helm_release(
    context: String,
    namespace: String,
    release: String,
    _chart_name: String,
    _chart: String,
    values_yaml: String,
) -> Result<String, String> {
    reject_redacted(&values_yaml, "upgrade")?;
    let outcome = upgrade_release(&context, &namespace, &release, &values_yaml).await;
    crate::app_log::log_write(&context, "upgrade", "helmrelease", &namespace, &release, values_payload(&values_yaml).as_ref(), &outcome);
    outcome
}

async fn upgrade_release(
    context: &str,
    namespace: &str,
    release: &str,
    values_yaml: &str,
) -> Result<String, String> {
    use tempfile::NamedTempFile;
    use std::io::Write;

    let mut values_tmp = NamedTempFile::new()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    values_tmp.write_all(values_yaml.as_bytes())
        .map_err(|e| format!("Failed to write values: {}", e))?;
    let values_path = values_tmp.path().to_string_lossy().to_string();

    // Extract the chart from the K8s release secret and upgrade from the local dir.
    // This is source-agnostic: it works for any chart origin (private repos, OCI,
    // GitLab registries, CI-deployed charts) because helm always embeds the full
    // chart archive in the release secret regardless of where the chart came from.
    let chart_tmp = extract_chart_from_k8s(context, namespace, release).await?;

    let chart_dir = chart_tmp.path().to_string_lossy().to_string();
    let result = helm_run(&[
        "upgrade", release, &chart_dir,
        "--values", &values_path,
        "--namespace", namespace,
        "--kube-context", context,
    ]).await;

    drop(values_tmp);
    drop(chart_tmp); // deletes the temp chart dir after helm completes
    result
}

#[tauri::command]
pub async fn uninstall_helm_release(
    context: String, namespace: String, release: String,
) -> Result<String, String> {
    let result = helm_run(&[
        "uninstall", &release, "-n", &namespace, "--kube-context", &context,
    ])
    .await;
    crate::app_log::log_write(&context, "uninstall", "helmrelease", &namespace, &release, None, &result);
    result
}

// ─── Install / rollback / history (§3.3) ─────────────────────────────────────

// `#[serde(default)]` only affects the deserialize direction (parsing `helm history -o json`),
// never the outbound shape sent to the frontend, so it can't drift the frozen IPC contract. It
// buys tolerance for a helm version that omits/nulls a field this codebase has never been able
// to test against a live `helm history` invocation.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct HelmRevision {
    pub revision: i64,
    pub updated: String,
    pub status: String,
    pub chart: String,
    pub app_version: String,
    pub description: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HelmRepo {
    pub name: String,
    pub url: String,
}

#[tauri::command]
pub async fn list_helm_history(
    context: String, namespace: String, release: String,
) -> Result<Vec<HelmRevision>, String> {
    let raw = helm_run(&[
        "history", &release, "-n", &namespace, "-o", "json", "--kube-context", &context,
    ])
    .await?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse helm history: {}", e))
}

#[tauri::command]
pub async fn rollback_helm_release(
    context: String, namespace: String, release: String, revision: i64,
) -> Result<String, String> {
    let result = helm_run(&[
        "rollback", &release, &revision.to_string(), "-n", &namespace, "--kube-context", &context,
    ])
    .await;
    crate::app_log::log_write(&context, "rollback", "helmrelease", &namespace, &release, None, &result);
    result
}

/// A brand-new install, NOT the release-secret extraction path `upgrade_helm_release` uses.
/// There is no release secret yet for a release that doesn't exist, so a repo/OCI/local chart
/// reference is required by definition — this must stay a separate path. Do not "unify" this
/// with `upgrade_helm_release`; see CLAUDE.md's Helm section and
/// docs/plan-kubeconfig-and-parity.md §3.3.
#[tauri::command]
pub async fn install_helm_release(
    context: String,
    namespace: String,
    release: String,
    chart: String,
    version: Option<String>,
    values_yaml: Option<String>,
    create_namespace: Option<bool>,
    dry_run: Option<bool>,
) -> Result<String, String> {
    let (log_ns, log_release, log_ctx) = (namespace.clone(), release.clone(), context.clone());
    let log_values = values_yaml.as_deref().and_then(values_payload);
    let is_dry_run = dry_run.unwrap_or(false);
    // Kept alive until after helm_run so the temp file still exists on disk for --values.
    let mut values_tmp: Option<tempfile::NamedTempFile> = None;

    let mut args: Vec<String> = vec![
        "install".to_string(),
        release,
        chart,
        "--namespace".to_string(),
        namespace,
        "--kube-context".to_string(),
        context,
    ];

    if let Some(v) = version {
        args.push("--version".to_string());
        args.push(v);
    }
    if create_namespace.unwrap_or(false) {
        args.push("--create-namespace".to_string());
    }
    if dry_run.unwrap_or(false) {
        args.push("--dry-run".to_string());
    }
    if let Some(values) = values_yaml {
        use std::io::Write;
        let mut tmp = tempfile::NamedTempFile::new()
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        tmp.write_all(values.as_bytes())
            .map_err(|e| format!("Failed to write values: {}", e))?;
        args.push("--values".to_string());
        args.push(tmp.path().to_string_lossy().to_string());
        values_tmp = Some(tmp);
    }

    // Separate .arg() calls throughout — chart/version are user-supplied and reach a subprocess.
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let result = helm_run(&arg_refs).await;
    drop(values_tmp);
    if !is_dry_run {
        crate::app_log::log_write(&log_ctx, "install", "helmrelease", &log_ns, &log_release, log_values.as_ref(), &result);
    }
    install_output(is_dry_run, result)
}

#[tauri::command]
pub async fn list_helm_repos() -> Result<Vec<HelmRepo>, String> {
    match helm_run(&["repo", "list", "-o", "json"]).await {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("Failed to parse helm repo list: {}", e)),
        // `helm repo list` exits non-zero when no repos are configured — that's an empty list,
        // not an error.
        Err(e) if e.to_lowercase().contains("no repositories") => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

// ─── Upgrade preview (v1.3.1) ────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HelmRenderedResource {
    pub api_version: String,
    pub kind: String,
    pub namespace: String, // metadata.namespace, else the release namespace
    pub name: String,
    pub change: String, // "new" | "changed" | "removed" | "unchanged"
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HelmUpgradePreview {
    pub outcome: String,                      // "ok" | "invalid" | "rejected"
    pub message: String,                      // "" | "Invalid values YAML: {e}" | helm stderr trimmed and scrubbed
    pub current_values: serde_json::Value,    // `helm get values <rel> -o json`; JSON null -> {}
    pub new_values: serde_json::Value,        // values_yaml parsed; "" -> {}; Null when invalid
    pub resources: Vec<HelmRenderedResource>, // sorted by (kind, namespace, name); [] unless ok
    pub rendered_manifest: String,            // the dry run's .manifest; "" unless ok
}

/// `values_yaml` as a JSON mapping. Empty and comment-only text is an empty mapping, exactly what
/// `helm --values` makes of an empty file.
fn parse_values_yaml(values_yaml: &str) -> Result<serde_json::Value, String> {
    // A single-document parse. The multi-document iterator hangs on malformed input
    // (see apply_file.rs), and a values file is one document.
    let value = serde_yaml::from_str::<serde_json::Value>(values_yaml)
        .map_err(|e| format!("Invalid values YAML: {}", e))?;
    match value {
        serde_json::Value::Null => Ok(serde_json::json!({})),
        v @ serde_json::Value::Object(_) => Ok(v),
        _ => Err("Invalid values YAML: values must be a mapping".to_string()),
    }
}

type ResourceKey = (String, String, String); // (kind, namespace, name)

/// Parse one manifest into `key -> (apiVersion, object)`. Documents split through
/// `split_yaml_documents` (never on a literal `---`, never an iterator chain: serde_yaml's
/// multi-document stream hangs after the first parse error). Empty and comment-only documents
/// are skipped by the splitter; anything that is not a mapping with a `kind` is not a Kubernetes
/// object and is skipped here.
fn index_manifest(
    manifest: &str,
    default_ns: &str,
    which: &str,
) -> Result<std::collections::BTreeMap<ResourceKey, (String, serde_json::Value)>, String> {
    let mut map = std::collections::BTreeMap::new();
    for (_, parsed) in super::apply_file::split_yaml_documents(manifest) {
        let doc = parsed.map_err(|e| format!("Failed to parse the {} manifest: {}", which, e))?;
        let Some(kind) = doc.get("kind").and_then(|v| v.as_str()).filter(|k| !k.is_empty()) else {
            continue;
        };
        let meta = doc.get("metadata");
        let name = meta
            .and_then(|m| m.get("name"))
            .and_then(|v| v.as_str())
            .or_else(|| meta.and_then(|m| m.get("generateName")).and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();
        let namespace = meta
            .and_then(|m| m.get("namespace"))
            .and_then(|v| v.as_str())
            .filter(|n| !n.is_empty())
            .unwrap_or(default_ns)
            .to_string();
        let api_version = doc.get("apiVersion").and_then(|v| v.as_str()).unwrap_or("").to_string();
        map.insert((kind.to_string(), namespace, name), (api_version, doc.clone()));
    }
    Ok(map)
}

/// Compare the release's current manifest with the dry-run's rendered one, resource by resource.
/// Keyed by `(kind, namespace-or-default, name)`; values are compared as `serde_json::Value`.
/// Sorted by `(kind, namespace, name)`.
fn diff_manifests(current: &str, rendered: &str, default_ns: &str) -> Result<Vec<HelmRenderedResource>, String> {
    let cur = index_manifest(current, default_ns, "current")?;
    let new = index_manifest(rendered, default_ns, "rendered")?;
    let mut out: Vec<HelmRenderedResource> = Vec::new();

    for (key, (api_version, doc)) in &new {
        let change = match cur.get(key) {
            None => "new",
            Some((_, old)) if old == doc => "unchanged",
            Some(_) => "changed",
        };
        out.push(HelmRenderedResource {
            api_version: api_version.clone(),
            kind: key.0.clone(),
            namespace: key.1.clone(),
            name: key.2.clone(),
            change: change.to_string(),
        });
    }
    for (key, (api_version, _)) in &cur {
        if !new.contains_key(key) {
            out.push(HelmRenderedResource {
                api_version: api_version.clone(),
                kind: key.0.clone(),
                namespace: key.1.clone(),
                name: key.2.clone(),
                change: "removed".to_string(),
            });
        }
    }
    out.sort_by(|a, b| (&a.kind, &a.namespace, &a.name).cmp(&(&b.kind, &b.namespace, &b.name)));
    Ok(out)
}

fn failed_preview(outcome: &str, message: String, current: serde_json::Value, new: serde_json::Value) -> HelmUpgradePreview {
    HelmUpgradePreview {
        outcome: outcome.to_string(),
        message,
        current_values: current,
        new_values: new,
        resources: Vec::new(),
        rendered_manifest: String::new(),
    }
}

/// Preview `upgrade_helm_release` without changing the release: current vs new values and a
/// per-resource new/changed/removed/unchanged list from `helm upgrade --dry-run`.
///
/// Uses the same release-secret chart extraction `upgrade_helm_release` uses (never a repo
/// lookup). `Err` means "preview unavailable" (helm missing, auth failure, chart extraction
/// failure, unexpected helm output); a render failure is `Ok` with `outcome: "rejected"`.
#[tauri::command]
pub async fn preview_helm_upgrade(
    context: String,
    namespace: String,
    release: String,
    values_yaml: String,
) -> Result<HelmUpgradePreview, String> {
    use std::io::Write;
    crate::app_log::log_read("preview_helm_upgrade", &context);
    reject_redacted(&values_yaml, "preview upgrade")?;

    let new_values = match parse_values_yaml(&values_yaml) {
        Ok(v) => v,
        Err(message) => {
            return Ok(failed_preview("invalid", message, serde_json::Value::Null, serde_json::Value::Null));
        }
    };

    let raw_current = helm_run(&[
        "get", "values", &release, "-n", &namespace, "--kube-context", &context, "-o", "json",
    ])
    .await?;
    let current_values = match serde_json::from_str::<serde_json::Value>(&raw_current) {
        Ok(serde_json::Value::Null) => serde_json::json!({}),
        Ok(v) => v,
        Err(e) => return Err(format!("Failed to preview upgrade: unexpected helm output: {}", e)),
    };

    let mut values_tmp = tempfile::NamedTempFile::new()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    values_tmp
        .write_all(values_yaml.as_bytes())
        .map_err(|e| format!("Failed to write values: {}", e))?;
    let values_path = values_tmp.path().to_string_lossy().to_string();

    let chart_tmp = extract_chart_from_k8s(&context, &namespace, &release).await?;
    let chart_dir = chart_tmp.path().to_string_lossy().to_string();

    let out = helm_output(&[
        "upgrade", &release, &chart_dir,
        "--values", &values_path,
        "--namespace", &namespace,
        "--kube-context", &context,
        "--dry-run", "-o", "json",
    ])
    .await;
    drop(values_tmp);
    drop(chart_tmp);
    let out = out?;

    if !out.status.success() {
        let stderr = crate::app_log::scrub(String::from_utf8_lossy(&out.stderr).trim());
        // An auth-plugin failure means the cluster was never consulted: unavailable, not a verdict.
        if super::utils::friendly_auth_error(&stderr).is_some() {
            return Err(friendly_helm_error(&stderr));
        }
        return Ok(failed_preview("rejected", stderr, current_values, new_values));
    }

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let release_json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to preview upgrade: unexpected helm output: {}", e))?;
    let rendered_manifest = release_json
        .get("manifest")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();

    let current_manifest = helm_run(&[
        "get", "manifest", &release, "-n", &namespace, "--kube-context", &context,
    ])
    .await?;

    match diff_manifests(&current_manifest, &rendered_manifest, &namespace) {
        Ok(resources) => Ok(HelmUpgradePreview {
            outcome: "ok".to_string(),
            message: String::new(),
            current_values,
            new_values,
            resources,
            rendered_manifest: mask_rendered_secrets(&rendered_manifest),
        }),
        Err(message) => Ok(failed_preview("rejected", message, current_values, new_values)),
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn decode_helm_release_round_trip_and_errors() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(br#"{"name":"r","manifest":"kind: A"}"#).unwrap();
        let b64 = STANDARD.encode(enc.finish().unwrap());
        let v = decode_helm_release(b64.as_bytes()).unwrap();
        assert_eq!(v["name"], "r");
        assert!(decode_helm_release(&[0xff, 0xfe]).unwrap_err().starts_with("Helm secret value is not valid UTF-8"));
        assert!(decode_helm_release(b"!!!").unwrap_err().starts_with("Failed to base64-decode"));
        assert!(decode_helm_release(STANDARD.encode(b"notgzip").as_bytes()).unwrap_err().starts_with("Failed to decompress"));
    }

    #[test]
    fn redact_sequence_under_credential_key() {
        let out = redact_values("apiKeys: [k1, {name: n}]
imagePullSecrets:
  - name: regcred
");
        let v: serde_yaml::Value = serde_yaml::from_str(&out).unwrap();
        assert_eq!(v["apiKeys"][0].as_str(), Some(HELM_REDACTION_SENTINEL));
        assert_eq!(v["apiKeys"][1]["name"].as_str(), Some("n"));
        assert_eq!(v["imagePullSecrets"][0]["name"].as_str(), Some("regcred"));
    }

    #[test]
    fn mask_rendered_secrets_masks_only_secrets() {
        let m = "kind: Secret
data:
  p: aHVudGVyMg==
stringData:
  q: plain
---
kind: ConfigMap
data:
  c: keep
";
        let out = mask_rendered_secrets(m);
        assert!(!out.contains("aHVudGVyMg==") && !out.contains("plain"));
        assert!(out.contains("keep") && out.contains(HELM_REDACTION_SENTINEL));
        assert_eq!(mask_rendered_secrets("a: [unclosed
: :"), "# The rendered manifest could not be parsed for masking.");
    }

    #[test]
    fn dry_run_success_hides_helm_output() {
        assert_eq!(install_output(true, Ok("MANIFEST: secret".into())).unwrap(), HELM_DRY_RUN_OK);
        assert!(HELM_DRY_RUN_OK.to_lowercase().contains("dry run"));
        assert_eq!(install_output(false, Ok("x".into())).unwrap(), "x");
        assert_eq!(install_output(true, Err("e".into())).unwrap_err(), "e");
    }

    #[test]
    fn redact_scalars_by_key_recursing_containers() {
        let out = redact_values("db:
  Password: hunter2
  host: h
items:
  - apiToken: t
    name: n
secrets:
  inner: v
  tlsKey: k
");
        let v: serde_yaml::Value = serde_yaml::from_str(&out).unwrap();
        assert_eq!(v["db"]["Password"].as_str(), Some(HELM_REDACTION_SENTINEL));
        assert_eq!(v["db"]["host"].as_str(), Some("h"));
        assert_eq!(v["items"][0]["apiToken"].as_str(), Some(HELM_REDACTION_SENTINEL));
        assert_eq!(v["items"][0]["name"].as_str(), Some("n"));
        assert_eq!(v["secrets"]["inner"].as_str(), Some("v")); // matching key, map value: recursed
        assert_eq!(v["secrets"]["tlsKey"].as_str(), Some(HELM_REDACTION_SENTINEL));
        assert!(!out.contains("hunter2"));
    }

    #[test]
    fn redact_empty_is_empty_and_plain_mapping_round_trips() {
        assert_eq!(redact_values("null
"), "");
        assert_eq!(redact_values(""), "");
        assert_eq!(redact_values("a: 1
b:
  c: x
"), "a: 1
b:
  c: x
");
    }

    #[test]
    fn redact_unparsable_never_echoes_input() {
        let out = redact_values("password: [unclosed
  : :");
        assert_eq!(out, "# Values could not be parsed for redaction. Use Reveal to view them.");
    }

    #[test]
    fn sentinel_guard_blocks_upgrade_and_preview() {
        let y = format!("password: {}
", HELM_REDACTION_SENTINEL);
        assert_eq!(reject_redacted(&y, "upgrade").unwrap_err(), "Failed to upgrade: the values contain a redacted placeholder. Reveal the values and edit again.");
        assert_eq!(reject_redacted(&y, "preview upgrade").unwrap_err(), "Failed to preview upgrade: the values contain a redacted placeholder. Reveal the values and edit again.");
        let legacy = format!("password: {}", LEGACY_HELM_REDACTION_SENTINEL);
        assert!(reject_redacted(&legacy, "upgrade").is_err());
        assert!(reject_redacted("a: b
", "upgrade").is_ok());
    }
    use super::*;

    fn find<'a>(rs: &'a [HelmRenderedResource], kind: &str, name: &str) -> &'a HelmRenderedResource {
        rs.iter().find(|r| r.kind == kind && r.name == name).expect("resource present")
    }

    const CURRENT: &str = "\
---
# Source: chart/templates/cm.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: same
  namespace: apps
data:
  a: \"1\"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: changing
data:
  a: \"1\"
---
apiVersion: v1
kind: Service
metadata:
  name: going-away
";

    const RENDERED: &str = "\
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: same
  namespace: apps
data:
  a: \"1\"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: changing
data:
  a: \"2\"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: brand-new
";

    #[test]
    fn diff_reports_all_four_changes_sorted() {
        let rs = diff_manifests(CURRENT, RENDERED, "apps").expect("ok");
        assert_eq!(find(&rs, "ConfigMap", "same").change, "unchanged");
        assert_eq!(find(&rs, "ConfigMap", "changing").change, "changed");
        assert_eq!(find(&rs, "Deployment", "brand-new").change, "new");
        assert_eq!(find(&rs, "Service", "going-away").change, "removed");
        assert_eq!(find(&rs, "Deployment", "brand-new").api_version, "apps/v1");
        assert_eq!(rs.len(), 4);
        let keys: Vec<_> = rs.iter().map(|r| (r.kind.clone(), r.namespace.clone(), r.name.clone())).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }

    #[test]
    fn missing_namespace_falls_back_to_the_default() {
        let rs = diff_manifests(CURRENT, RENDERED, "apps").expect("ok");
        // `changing` has no metadata.namespace in either manifest, so it keys under the default
        // and compares as the same resource instead of one removed plus one new.
        assert_eq!(find(&rs, "ConfigMap", "changing").namespace, "apps");
        assert_eq!(find(&rs, "ConfigMap", "changing").change, "changed");
        let other = diff_manifests(CURRENT, RENDERED, "elsewhere").expect("ok");
        assert_eq!(find(&other, "ConfigMap", "changing").namespace, "elsewhere");
        // `same` carries an explicit namespace, which wins over the default.
        assert_eq!(find(&other, "ConfigMap", "same").namespace, "apps");
    }

    #[test]
    fn comment_only_and_empty_documents_are_skipped() {
        let rs = diff_manifests("---\n# nothing here\n---\n", "# just a comment\n", "ns").expect("ok");
        assert!(rs.is_empty());
        let rs = diff_manifests("", "---\n---\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: x\n", "ns").expect("ok");
        assert_eq!(rs.len(), 1);
        assert_eq!(rs[0].change, "new");
    }

    #[test]
    fn dashes_inside_a_block_scalar_do_not_split() {
        let manifest = "\
apiVersion: v1
kind: ConfigMap
metadata:
  name: pem
data:
  cert: |-
    -----BEGIN CERTIFICATE-----
    ---
    -----END CERTIFICATE-----
";
        let rs = diff_manifests(manifest, manifest, "ns").expect("ok");
        assert_eq!(rs.len(), 1);
        assert_eq!(rs[0].change, "unchanged");
    }

    /// A malformed document must come back as an `Err`, never hang: serde_yaml's multi-document
    /// stream never ends once one document fails to parse (see `split_yaml_documents`). If
    /// `index_manifest` regressed to an iterator chain this test would hang rather than fail.
    #[test]
    fn malformed_document_is_an_error_not_a_hang() {
        for bad in ["foo: [1, 2\n", "key: \"unterminated\n", "{unterminated: flow\n"] {
            let manifest = format!("kind: ConfigMap\nmetadata:\n  name: a\n---\n{}---\nkind: Secret\n", bad);
            let err = diff_manifests(&manifest, "", "ns").expect_err("must be an error");
            assert!(err.contains("current manifest"), "got {}", err);
            let err = diff_manifests("", &manifest, "ns").expect_err("must be an error");
            assert!(err.contains("rendered manifest"), "got {}", err);
        }
    }

    #[test]
    fn non_kubernetes_documents_are_skipped() {
        let rs = diff_manifests("just: a mapping\n---\n- a\n- list\n", "plain scalar\n", "ns").expect("ok");
        assert!(rs.is_empty());
    }

    #[test]
    fn values_yaml_parsing() {
        assert_eq!(parse_values_yaml("").expect("ok"), serde_json::json!({}));
        assert_eq!(parse_values_yaml("# only a comment\n").expect("ok"), serde_json::json!({}));
        assert_eq!(parse_values_yaml("a: 1\nb:\n  c: x\n").expect("ok"), serde_json::json!({"a": 1, "b": {"c": "x"}}));
        let err = parse_values_yaml("a: [1, 2\n").expect_err("invalid");
        assert!(err.starts_with("Invalid values YAML: "), "got {}", err);
        assert_eq!(
            parse_values_yaml("- a\n- b\n").expect_err("not a mapping"),
            "Invalid values YAML: values must be a mapping"
        );
    }

    #[test]
    fn preview_wire_shape_is_frozen() {
        let p = failed_preview("rejected", "boom".into(), serde_json::json!({}), serde_json::Value::Null);
        let v = serde_json::to_value(&p).expect("json");
        assert_eq!(
            v,
            serde_json::json!({
                "outcome": "rejected", "message": "boom", "current_values": {}, "new_values": null,
                "resources": [], "rendered_manifest": ""
            })
        );
    }
}
