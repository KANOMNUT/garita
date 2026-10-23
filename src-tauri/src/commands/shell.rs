use k8s_openapi::api::core::v1::Pod as K8sPod;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::Status;
use kube::{api::AttachParams, Api};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

use super::utils::client_for_context;

pub struct ShellSession {
    pub stdin_tx: mpsc::UnboundedSender<String>,
    pub resize_tx: mpsc::UnboundedSender<(u16, u16)>,
    pub abort_handle: tokio::task::AbortHandle,
}

pub struct ShellState {
    pub sessions: Arc<Mutex<HashMap<String, ShellSession>>>,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Emitted once as `shell-closed-{session_id}` when the output loop ends on its own. Not emitted
/// when `stop_shell_session` aborts the task.
#[derive(Serialize, Clone, Debug)]
pub struct ShellClosed {
    pub reason: String,  // "eof" | "error"
    pub message: String, // "" for eof
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellMode {
    Exec,
    Attach,
}

/// `None` or `"exec"` -> exec `sh`; `"attach"` -> attach to the container's main process.
fn parse_shell_mode(mode: Option<&str>) -> Result<ShellMode, String> {
    match mode {
        None | Some("exec") => Ok(ShellMode::Exec),
        Some("attach") => Ok(ShellMode::Attach),
        Some(m) => Err(format!("Failed to start shell: unknown mode '{}'", m)),
    }
}

/// The close event for a finished read, or `None` while the stream is still delivering data.
fn shell_closed_for(read: &std::io::Result<usize>) -> Option<ShellClosed> {
    match read {
        Ok(0) => Some(ShellClosed { reason: "eof".to_string(), message: String::new() }),
        Err(e) => Some(ShellClosed { reason: "error".to_string(), message: e.to_string() }),
        Ok(_) => None,
    }
}

/// How long to wait for the status channel after stdout ends.
const STATUS_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

/// Close event once stdout has ended cleanly (`Ok(0)`), from the status channel's result.
/// A `Failure` whose reason is not `NonZeroExitCode` (for example a missing `sh`) is an `error`
/// carrying the server's message verbatim; a non-zero exit, `Success`, no status and a timeout
/// are all a plain `eof`.
fn close_for_status(status: Option<&Status>) -> ShellClosed {
    match status {
        Some(s) if s.status.as_deref() == Some("Failure") && s.reason.as_deref() != Some("NonZeroExitCode") => {
            ShellClosed { reason: "error".to_string(), message: s.message.clone().unwrap_or_default() }
        }
        _ => ShellClosed { reason: "eof".to_string(), message: String::new() },
    }
}

/// 1-64 characters of `[A-Za-z0-9_-]`.
fn is_valid_session_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A caller-supplied id (validated), else `{pod}-{millis}` with every `.` replaced by `-`: pod
/// names may contain `.`, while Tauri event names allow only alphanumerics, `-`, `/`, `:`, `_`.
fn resolve_session_id(supplied: Option<&str>, pod: &str, millis: i64) -> Result<String, String> {
    match supplied {
        Some(id) if is_valid_session_id(id) => Ok(id.to_string()),
        Some(_) => Err("Failed to start shell: invalid session id".to_string()),
        None => Ok(format!("{}-{}", pod, millis).replace('.', "-")),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // frozen IPC signature (v1.3.1 §2.2)
pub async fn start_shell_session(
    app: AppHandle,
    state: State<'_, ShellState>,
    context: String,
    namespace: String,
    pod: String,
    container: String,
    initial_cols: u16,
    initial_rows: u16,
    mode: Option<String>,
    session_id: Option<String>,
) -> Result<String, String> {
    // Validate mode and id before connecting so a bad value never reaches the cluster.
    let shell_mode = parse_shell_mode(mode.as_deref())?;
    let session_id = resolve_session_id(session_id.as_deref(), &pod, chrono::Utc::now().timestamp_millis())?;
    let verb = if shell_mode == ShellMode::Attach { "attach" } else { "exec" };
    let log_ctx = context.clone();
    let result = start_session(
        app, state, context, namespace.clone(), pod.clone(), container, initial_cols, initial_rows, shell_mode, session_id,
    )
    .await;
    crate::app_log::log_write(&log_ctx, verb, "pod", &namespace, &pod, None, &result);
    result
}

#[allow(clippy::too_many_arguments)]
async fn start_session(
    app: AppHandle,
    state: State<'_, ShellState>,
    context: String,
    namespace: String,
    pod: String,
    container: String,
    initial_cols: u16,
    initial_rows: u16,
    shell_mode: ShellMode,
    session_id: String,
) -> Result<String, String> {
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u16, u16)>();

    let client = client_for_context(&context)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    let api: Api<K8sPod> = Api::namespaced(client, &namespace);

    let ap = AttachParams {
        container: if container.is_empty() { None } else { Some(container) },
        stdin: true,
        stdout: true,
        stderr: false,
        tty: true,
        ..Default::default()
    };

    let mut attached = match shell_mode {
        ShellMode::Exec => api
            .exec(&pod, vec!["sh"], &ap)
            .await
            .map_err(|e| format!("Failed to start shell: {}", e))?,
        ShellMode::Attach => api
            .attach(&pod, &ap)
            .await
            .map_err(|e| format!("Failed to attach: {}", e))?,
    };

    let mut stdin_writer = attached.stdin().ok_or("No stdin available")?;
    let mut stdout_reader = attached.stdout().ok_or("No stdout available")?;

    if let Some(mut ts_sink) = attached.terminal_size() {
        let cols = if initial_cols > 0 { initial_cols } else { 80 };
        let rows = if initial_rows > 0 { initial_rows } else { 24 };
        let _ = ts_sink.try_send(kube::api::TerminalSize { width: cols, height: rows });
        tokio::spawn(async move {
            while let Some((cols, rows)) = resize_rx.recv().await {
                if cols > 0 && rows > 0 {
                    let _ = ts_sink.try_send(kube::api::TerminalSize { width: cols, height: rows });
                }
            }
        });
    }

    // A missing `sh` is reported after the upgrade, as a Status on the status channel.
    let status_fut = attached.take_status();

    let sid = session_id.clone();
    let app_clone = app.clone();
    // The task waits for this before reading, so a duplicate-id start (dropped below) never
    // emits an event under the id of the session that already owns it.
    let (go_tx, go_rx) = tokio::sync::oneshot::channel::<()>();

    let task = tokio::spawn(async move {
        if go_rx.await.is_err() {
            return;
        }
        // Keep the AttachedProcess alive for the life of the session.
        let _attached = attached;
        // Forward stdin channel → kube stdin
        let stdin_task = tokio::spawn(async move {
            while let Some(data) = stdin_rx.recv().await {
                if stdin_writer.write_all(data.as_bytes()).await.is_err() {
                    break;
                }
            }
        });

        // Read stdout → emit events
        let mut buf = vec![0u8; 4096];
        loop {
            let read = stdout_reader.read(&mut buf).await;
            if let Some(closed) = shell_closed_for(&read) {
                // On a clean end of stdout, ask the status channel why (bounded wait).
                let closed = if matches!(read, Ok(0)) {
                    let status = match status_fut {
                        Some(fut) => tokio::time::timeout(STATUS_WAIT, fut).await.ok().flatten(),
                        None => None,
                    };
                    close_for_status(status.as_ref())
                } else {
                    closed
                };
                // Exactly once, and only when the loop ends on its own: an abort from
                // `stop_shell_session` (also during the status wait) drops this task first.
                let _ = app_clone.emit(&format!("shell-closed-{}", sid), closed);
                break;
            }
            if let Ok(n) = read {
                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app_clone.emit(&format!("shell-output-{}", sid), data);
            }
        }
        stdin_task.abort();
    });

    let abort_handle = task.abort_handle();

    {
        // Duplicate check and insert under one lock; never overwrite (that would orphan the
        // existing entry's abort handle).
        let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if sessions.contains_key(&session_id) {
            drop(sessions);
            task.abort(); // drops the new connection; it never started reading
            return Err("Failed to start shell: session id already in use".to_string());
        }
        sessions.insert(
            session_id.clone(),
            ShellSession {
                stdin_tx,
                resize_tx,
                abort_handle,
            },
        );
    }
    let _ = go_tx.send(());

    Ok(session_id)
}

#[tauri::command]
pub async fn write_to_shell(
    state: State<'_, ShellState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(session) = sessions.get(&session_id) {
        let _ = session.stdin_tx.send(data);
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_shell(
    state: State<'_, ShellState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(session) = sessions.get(&session_id) {
        let _ = session.resize_tx.send((cols, rows));
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_shell_session(
    state: State<'_, ShellState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(session) = sessions.remove(&session_id) {
        session.abort_handle.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_defaults_to_exec() {
        assert_eq!(parse_shell_mode(None), Ok(ShellMode::Exec));
        assert_eq!(parse_shell_mode(Some("exec")), Ok(ShellMode::Exec));
        assert_eq!(parse_shell_mode(Some("attach")), Ok(ShellMode::Attach));
    }

    #[test]
    fn unknown_mode_is_rejected_with_the_frozen_text() {
        assert_eq!(
            parse_shell_mode(Some("Attach")),
            Err("Failed to start shell: unknown mode 'Attach'".to_string())
        );
        assert!(parse_shell_mode(Some("")).is_err());
    }

    #[test]
    fn close_event_for_eof_error_and_data() {
        let eof = shell_closed_for(&Ok(0)).expect("eof closes");
        assert_eq!((eof.reason.as_str(), eof.message.as_str()), ("eof", ""));
        let err = std::io::Error::new(std::io::ErrorKind::BrokenPipe, "pipe gone");
        let closed = shell_closed_for(&Err(err)).expect("error closes");
        assert_eq!(closed.reason, "error");
        assert!(closed.message.contains("pipe gone"));
        assert!(shell_closed_for(&Ok(12)).is_none());
    }

    fn status(summary: &str, reason: &str, message: &str) -> Status {
        serde_json::from_value(serde_json::json!({"status": summary, "reason": reason, "message": message})).expect("status json")
    }

    #[test]
    fn status_failure_internal_error_is_error_with_message() {
        let c = close_for_status(Some(&status("Failure", "InternalError", "exec: \"sh\": executable file not found in $PATH")));
        assert_eq!(c.reason, "error");
        assert_eq!(c.message, "exec: \"sh\": executable file not found in $PATH");
    }

    #[test]
    fn status_non_zero_exit_is_eof() {
        let c = close_for_status(Some(&status("Failure", "NonZeroExitCode", "command terminated with exit code 1")));
        assert_eq!((c.reason.as_str(), c.message.as_str()), ("eof", ""));
    }

    #[test]
    fn status_success_is_eof() {
        let c = close_for_status(Some(&status("Success", "", "")));
        assert_eq!((c.reason.as_str(), c.message.as_str()), ("eof", ""));
    }

    #[test]
    fn no_status_is_eof() {
        let c = close_for_status(None);
        assert_eq!((c.reason.as_str(), c.message.as_str()), ("eof", ""));
    }

    #[test]
    fn session_id_validation() {
        assert_eq!(resolve_session_id(Some("a1B_-z"), "p", 1).unwrap(), "a1B_-z");
        assert!(resolve_session_id(Some(&"a".repeat(64)), "p", 1).is_ok());
        for bad in ["", "a.b", "has space", "slash/x"] {
            assert_eq!(resolve_session_id(Some(bad), "p", 1).unwrap_err(), "Failed to start shell: invalid session id", "{:?}", bad);
        }
        assert!(resolve_session_id(Some(&"a".repeat(65)), "p", 1).is_err());
    }

    #[test]
    fn generated_id_replaces_dots() {
        assert_eq!(resolve_session_id(None, "web.v1.abc", 1700).unwrap(), "web-v1-abc-1700");
        assert_eq!(resolve_session_id(None, "web", 5).unwrap(), "web-5");
    }

    #[test]
    fn shell_closed_json_shape() {
        let v = serde_json::to_value(ShellClosed { reason: "eof".into(), message: String::new() }).expect("json");
        assert_eq!(v, serde_json::json!({"reason": "eof", "message": ""}));
    }
}
