//! Diagnostics: the app log file's settings. See `docs/impl/v1.3.1-tasks.md` §2.10.
//!
//! **App-local commands: they touch no cluster, so they take no `context`.** This is an explicit
//! exemption from the "`context: String` first" rule, like the kubeconfig registry commands.

use crate::app_log::{self, LogSettings};
use crate::journal::{self, JournalEntry, JournalFilter};

#[tauri::command]
pub async fn get_log_settings() -> Result<LogSettings, String> {
    app_log::settings().map_err(|e| format!("Failed to read log settings: {}", e))
}

#[tauri::command]
pub async fn set_log_level(level: String) -> Result<LogSettings, String> {
    let parsed = app_log::parse_level(&level)
        .ok_or_else(|| format!("Failed to set log level: unknown level '{}'", level))?;
    app_log::set_level(parsed).map_err(|e| format!("Failed to set log level: {}", e))
}

/// Newest first, across the rotated journal files. Default limit 500, max 5000; `before` is an
/// RFC3339 cursor (entries strictly older). `context`, `namespace`, `name`: optional exact-match filters applied before the limit.
#[tauri::command]
pub async fn list_journal(
    limit: Option<u32>,
    before: Option<String>,
    context: Option<String>,
    namespace: Option<String>,
    name: Option<String>,
) -> Result<Vec<JournalEntry>, String> {
    let filter = JournalFilter { context, namespace, name };
    journal::read(limit, before.as_deref(), &filter).map_err(|e| format!("Failed to read journal: {}", e))
}

/// The platform's file manager command. The folder path is always one `.arg()`, never part of a
/// shell string.
fn opener_program() -> &'static str {
    if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    }
}

#[tauri::command]
pub async fn open_log_folder() -> Result<(), String> {
    let dir = app_log::log_dir()
        .filter(|d| d.is_dir())
        .ok_or_else(|| "Failed to open log folder: no log file has been written yet".to_string())?;
    std::process::Command::new(opener_program())
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open log folder: {}", e))
}

const RELEASES_URL: &str = "https://github.com/KANOMNUT/garita/releases/latest";

/// Opens the hard-coded release page. Takes no URL: it cannot become an arbitrary-URL opener.
#[tauri::command]
pub async fn open_release_page() -> Result<(), String> {
    std::process::Command::new(opener_program())
        .arg(RELEASES_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open the release page: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opener_is_a_bare_program_name() {
        let p = opener_program();
        assert!(["open", "explorer", "xdg-open"].contains(&p));
    }

    #[tokio::test]
    async fn set_log_level_rejects_unknown_level_before_touching_state() {
        let err = set_log_level("loud".to_string()).await.expect_err("unknown level");
        assert_eq!(err, "Failed to set log level: unknown level 'loud'");
    }
}
