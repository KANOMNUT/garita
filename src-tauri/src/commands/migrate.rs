//! One-shot migration of the app config dir after the bundle identifier changed (v2.0.0 rebrand).
//! Copies the kubeconfig registry and its app-owned files from the legacy identifier's dir.
//! The legacy dir is never modified or deleted; user kubeconfig files are never touched.

use serde_json::Value;
use std::path::{Path, PathBuf};

use super::utils::invalidate_client_cache;

const LEGACY_IDENTIFIER: &str = "com.watchtower.app";
const REGISTRY: &str = "kubeconfigs.json";
const OWNED_DIR: &str = "kubeconfigs";
/// Small app-local settings file sitting beside the registry (see `app_log.rs`).
const DIAGNOSTICS: &str = "diagnostics.json";

/// Sibling dir of the legacy identifier. `None` when `new_dir` has no parent.
fn legacy_dir(new_dir: &Path) -> Option<PathBuf> {
    Some(new_dir.parent()?.join(LEGACY_IDENTIFIER))
}

/// Rewrite `path` from under `legacy` to under `new`; `None` if it is not under `legacy`.
fn rebase(path: &str, legacy: &Path, new: &Path) -> Option<String> {
    let rest = Path::new(path).strip_prefix(legacy).ok()?;
    Some(new.join(rest).to_string_lossy().into_owned())
}

/// Rewrite registry JSON: app-owned entries under `legacy` get rebased, everything else verbatim.
fn rewrite_registry(json: &str, legacy: &Path, new: &Path) -> Result<String, String> {
    let mut v: Value = serde_json::from_str(json).map_err(|e| format!("Failed to parse legacy registry: {}", e))?;
    if let Some(entries) = v.get_mut("entries").and_then(Value::as_array_mut) {
        for e in entries {
            if e.get("app_owned").and_then(Value::as_bool) != Some(true) {
                continue;
            }
            let Some(p) = e.get("path").and_then(Value::as_str).and_then(|p| rebase(p, legacy, new)) else {
                continue;
            };
            e["path"] = Value::String(p);
        }
    }
    serde_json::to_string_pretty(&v).map_err(|e| format!("Failed to serialize registry: {}", e))
}

/// Ok(true) = migrated, Ok(false) = nothing to do.
fn migrate_dirs(legacy: &Path, new: &Path) -> Result<bool, String> {
    if legacy == new || new.join(REGISTRY).exists() {
        return Ok(false);
    }
    let Ok(old_json) = std::fs::read_to_string(legacy.join(REGISTRY)) else {
        return Ok(false);
    };
    // Parse first: a corrupt legacy registry leaves no trace in the new dir.
    let new_json = rewrite_registry(&old_json, legacy, new)?;

    let new_owned = new.join(OWNED_DIR);
    std::fs::create_dir_all(&new_owned).map_err(|e| format!("Failed to create {}: {}", new_owned.display(), e))?;
    if let Ok(rd) = std::fs::read_dir(legacy.join(OWNED_DIR)) {
        for f in rd.flatten() {
            let p = f.path();
            if p.is_file() && p.extension().is_some_and(|x| x == "yaml") {
                if let Some(name) = p.file_name() {
                    std::fs::copy(&p, new_owned.join(name))
                        .map_err(|e| format!("Failed to copy {}: {}", p.display(), e))?;
                }
            }
        }
    }
    let diag = new.join(DIAGNOSTICS);
    if !diag.exists() {
        let _ = std::fs::copy(legacy.join(DIAGNOSTICS), diag); // optional file, best effort
    }
    // Registry last (tmp + rename) so a crash never leaves a half-written one that blocks retry.
    let tmp = new.join("kubeconfigs.json.tmp");
    std::fs::write(&tmp, new_json).map_err(|e| format!("Failed to write registry: {}", e))?;
    std::fs::rename(&tmp, new.join(REGISTRY)).map_err(|e| format!("Failed to write registry: {}", e))?;
    Ok(true)
}

/// True iff a legacy install dir exists and is not the current dir.
fn legacy_install_present(new_dir: &Path) -> bool {
    legacy_dir(new_dir).is_some_and(|l| l != new_dir && l.is_dir())
}

/// Lets the UI offer a one-time import hint for users coming from the pre-v2 identifier.
#[tauri::command]
pub async fn detect_legacy_install(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().map_err(|e| format!("Failed to resolve app config dir: {}", e))?;
    Ok(legacy_install_present(&dir))
}

/// Call from `.setup()` before `init_config_dir`. Never fails startup.
pub fn run(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(new) = app.path().app_config_dir() else { return };
    let Some(legacy) = legacy_dir(&new) else { return };
    match migrate_dirs(&legacy, &new) {
        Ok(true) => invalidate_client_cache(),
        Ok(false) => {}
        Err(e) => eprintln!("Registry migration skipped: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let t = tempfile::tempdir().unwrap();
        let legacy = t.path().join(LEGACY_IDENTIFIER);
        let new = t.path().join("io.example.new");
        std::fs::create_dir_all(legacy.join(OWNED_DIR)).unwrap();
        (t, legacy, new)
    }

    fn registry(legacy: &Path, user: &str) -> String {
        let owned = legacy.join(OWNED_DIR).join("a.yaml");
        serde_json::json!({"entries": [
            {"path": owned.to_string_lossy(), "enabled": true, "app_owned": true},
            {"path": user, "enabled": false, "app_owned": false},
        ]})
        .to_string()
    }

    #[test]
    fn legacy_dir_is_sibling() {
        assert_eq!(legacy_dir(Path::new("/c/io.x.new")), Some(PathBuf::from("/c").join(LEGACY_IDENTIFIER)));
        assert_eq!(legacy_dir(Path::new("/")), None);
    }

    #[test]
    fn rewrites_app_owned_only_and_copies_files() {
        let (_t, legacy, new) = setup();
        let user = legacy.join(OWNED_DIR).join("b.yaml"); // user entry even though path is under legacy
        let user = user.to_string_lossy().into_owned();
        std::fs::write(legacy.join(OWNED_DIR).join("a.yaml"), "x").unwrap();
        std::fs::write(legacy.join(REGISTRY), registry(&legacy, &user)).unwrap();
        assert!(migrate_dirs(&legacy, &new).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(new.join(REGISTRY)).unwrap()).unwrap();
        let e = v["entries"].as_array().unwrap();
        assert_eq!(Path::new(e[0]["path"].as_str().unwrap()), new.join(OWNED_DIR).join("a.yaml"));
        assert_eq!(e[1]["path"].as_str().unwrap(), user);
        assert!(new.join(OWNED_DIR).join("a.yaml").is_file());
        assert!(legacy.join(REGISTRY).is_file() && legacy.join(OWNED_DIR).join("a.yaml").is_file());
    }

    #[test]
    fn noop_when_new_registry_exists() {
        let (_t, legacy, new) = setup();
        std::fs::write(legacy.join(REGISTRY), registry(&legacy, "/u")).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(new.join(REGISTRY), "KEEP").unwrap();
        assert!(!migrate_dirs(&legacy, &new).unwrap());
        assert_eq!(std::fs::read_to_string(new.join(REGISTRY)).unwrap(), "KEEP");
    }

    #[test]
    fn noop_when_legacy_missing() {
        let (_t, legacy, new) = setup();
        assert!(!migrate_dirs(&legacy, &new).unwrap());
        assert!(!new.exists());
    }

    #[test]
    fn legacy_install_detection() {
        let (t, legacy, new) = setup();
        assert!(legacy_install_present(&new));
        assert!(!legacy_install_present(&legacy)); // identifier unchanged: same dir
        assert!(!legacy_install_present(&t.path().join("other").join("x"))); // sibling absent
    }

    #[test]
    fn noop_when_same_dir() {
        let (_t, legacy, _) = setup();
        std::fs::write(legacy.join(REGISTRY), registry(&legacy, "/u")).unwrap();
        let before = std::fs::read_to_string(legacy.join(REGISTRY)).unwrap();
        assert!(!migrate_dirs(&legacy, &legacy).unwrap());
        assert_eq!(std::fs::read_to_string(legacy.join(REGISTRY)).unwrap(), before);
    }

    #[test]
    fn corrupt_legacy_leaves_no_registry() {
        let (_t, legacy, new) = setup();
        std::fs::write(legacy.join(REGISTRY), "{not json").unwrap();
        assert!(migrate_dirs(&legacy, &new).is_err());
        assert!(!new.join(REGISTRY).exists());
    }
}
