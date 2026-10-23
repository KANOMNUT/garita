//! App log file (v1.3.1 Diagnostics). Hand-rolled on purpose: no `log` crate, no regex, no new
//! dependency. See `docs/impl/v1.3.1-tasks.md` §2.10.
//!
//! Properties worth keeping:
//! - **Never panics and never returns an error to a caller.** Every IO failure is swallowed, and
//!   the mutex is taken with `lock().unwrap_or_else(|e| e.into_inner())`.
//! - **Every message is scrubbed centrally** in [`log`] before it is written, so a caller cannot
//!   forget to (this covers the text `friendly_auth_error` echoes from an exec plugin).
//! - **Write payloads are never logged.** Callers pass kind, namespace and name only.
//! - Only records written through this module are captured. No `log`-facade logger is installed,
//!   so kube-rs, hyper and Tauri internal records are NOT in the file.

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

pub const MAX_FILES: u32 = 5;
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const LOG_FILE_NAME: &str = "app.log";
const CONFIG_FILE_NAME: &str = "diagnostics.json";
const REDACTED: &str = "<redacted>";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
    Trace = 4,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Error => "error",
            Level::Warn => "warn",
            Level::Info => "info",
            Level::Debug => "debug",
            Level::Trace => "trace",
        }
    }

    fn padded(self) -> &'static str {
        match self {
            Level::Error => "ERROR",
            Level::Warn => "WARN ",
            Level::Info => "INFO ",
            Level::Debug => "DEBUG",
            Level::Trace => "TRACE",
        }
    }

    fn from_u8(n: u8) -> Level {
        match n {
            0 => Level::Error,
            1 => Level::Warn,
            2 => Level::Info,
            3 => Level::Debug,
            _ => Level::Trace,
        }
    }
}

/// Parse one of the five closed level names (case-insensitive, surrounding space ignored).
pub fn parse_level(s: &str) -> Option<Level> {
    match s.trim().to_ascii_lowercase().as_str() {
        "error" => Some(Level::Error),
        "warn" => Some(Level::Warn),
        "info" => Some(Level::Info),
        "debug" => Some(Level::Debug),
        "trace" => Some(Level::Trace),
        _ => None,
    }
}

// ─── Scrub ───────────────────────────────────────────────────────────────────

/// Keys whose value is redacted, longest first so a longer key wins over its own suffix.
const SCRUB_KEYS: &[&str] = &[
    "client-certificate-data",
    "client-key-data",
    "access_token",
    "refresh-token",
    "id_token",
    "id-token",
    "password",
    "secret",
    "token",
];

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_b64url(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

fn starts_with_ci(chars: &[char], i: usize, pat: &str) -> bool {
    let mut j = i;
    for p in pat.chars() {
        match chars.get(j) {
            Some(c) if c.eq_ignore_ascii_case(&p) => j += 1,
            _ => return false,
        }
    }
    true
}

/// End (exclusive) of a bearer-style token starting at `i`.
fn token_end(chars: &[char], mut i: usize) -> usize {
    while let Some(c) = chars.get(i) {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~' | '+' | '/' | '=') {
            i += 1;
        } else {
            break;
        }
    }
    i
}

/// If a JWT (`eyJ…` base64url, `.`, base64url, `.`, base64url) starts at `i`, return its end.
fn jwt_end(chars: &[char], i: usize) -> Option<usize> {
    if chars.get(i..i + 3) != Some(&['e', 'y', 'J'][..]) {
        return None;
    }
    let mut j = i + 3;
    while chars.get(j).copied().is_some_and(is_b64url) {
        j += 1;
    }
    for need_nonempty in [true, false] {
        if chars.get(j).copied() != Some('.') {
            return None;
        }
        j += 1;
        let seg_start = j;
        while chars.get(j).copied().is_some_and(is_b64url) {
            j += 1;
        }
        if need_nonempty && j == seg_start {
            return None;
        }
    }
    Some(j)
}

/// `key` at `i` followed by an optional closing quote, optional space, `:` or `=`, optional
/// space and a value. Returns `(value_start, value_end)` of the span to redact.
fn key_value_span(chars: &[char], i: usize, key: &str) -> Option<(usize, usize)> {
    if !starts_with_ci(chars, i, key) {
        return None;
    }
    let mut j = i + key.chars().count();
    if matches!(chars.get(j), Some('"') | Some('\'')) {
        j += 1;
    }
    while matches!(chars.get(j), Some(' ') | Some('\t')) {
        j += 1;
    }
    if !matches!(chars.get(j), Some(':') | Some('=')) {
        return None;
    }
    j += 1;
    while matches!(chars.get(j), Some(' ') | Some('\t')) {
        j += 1;
    }
    let start = j;
    let end = match chars.get(j) {
        Some(&q) if q == '"' || q == '\'' => {
            // Quoted value: redact the content, keep the quotes.
            let content_start = j + 1;
            let mut k = content_start;
            while let Some(&c) = chars.get(k) {
                if c == '\\' {
                    k += 2;
                    continue;
                }
                if c == q {
                    break;
                }
                k += 1;
            }
            let k = k.min(chars.len());
            return if k > content_start { Some((content_start, k)) } else { None };
        }
        _ => {
            let mut k = j;
            while let Some(&c) = chars.get(k) {
                if c.is_whitespace() || matches!(c, ',' | ';' | '"' | '\'' | '}' | ')' | ']') {
                    break;
                }
                k += 1;
            }
            k
        }
    };
    if end > start {
        Some((start, end))
    } else {
        None
    }
}

/// Replace credentials in a log message with `<redacted>`: the token after `Bearer `, JWT-shaped
/// tokens, and the value after the sensitive keys in the forms `key: v`, `key=v`, `"key":"v"`
/// and `--key=v`. Pure and char-based, so multi-byte text can never be split.
pub fn scrub(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    let mut url_end = 0; // each whitespace-delimited run is scanned once (no quadratic rescans)
    while i < chars.len() {
        let at_boundary = i == 0 || !is_word(chars[i - 1]);

        if at_boundary && starts_with_ci(&chars, i, "bearer ") {
            let tok_start = i + 7;
            let end = token_end(&chars, tok_start);
            if end > tok_start {
                out.extend(&chars[i..tok_start]);
                out.push_str(REDACTED);
                i = end;
                continue;
            }
        }

        if at_boundary || (i > 0 && chars[i - 1] == '=') {
            if let Some(end) = jwt_end(&chars, i) {
                out.push_str(REDACTED);
                i = end;
                continue;
            }
        }

        if at_boundary {
            let mut matched = false;
            for key in SCRUB_KEYS {
                if let Some((vs, ve)) = key_value_span(&chars, i, key) {
                    out.extend(&chars[i..vs]);
                    out.push_str(REDACTED);
                    i = ve;
                    matched = true;
                    break;
                }
            }
            if matched {
                continue;
            }
        }

        // URL userinfo: `scheme://userinfo@host` -> `scheme://<redacted>@host`. Userinfo runs to
        // the LAST `@` before whitespace or end, so `@ / ? #` in a password cannot leak a tail.
        if i >= url_end && chars[i] == ':' && i > 0 && is_word(chars[i - 1]) && chars.get(i + 1) == Some(&'/') && chars.get(i + 2) == Some(&'/') {
            let start = i + 3;
            let end = chars[start..]
                .iter()
                .position(|c| c.is_whitespace())
                .map_or(chars.len(), |p| start + p);
            url_end = end;
            if let Some(at) = chars[start..end].iter().rposition(|&c| c == '@') {
                if at > 0 {
                    out.push_str("://");
                    out.push_str(REDACTED);
                    i = start + at;
                    continue;
                }
            }
        }

        out.push(chars[i]);
        i += 1;
    }
    out
}

// ─── Formatting and rotation (pure) ──────────────────────────────────────────

/// `<RFC3339 UTC millis> <LEVEL padded to 5> <message>\n`
pub fn format_line(timestamp: &str, level: Level, message: &str) -> String {
    format!("{} {} {}\n", timestamp, level.padded(), message)
}

/// `write verb=<v> kind=<k> ns=<ns> name=<n> result=ok|error[: <message>]`. The message is
/// scrubbed again at write time; no payload is ever part of it.
pub fn format_write_message(verb: &str, kind: &str, ns: &str, name: &str, outcome: Result<(), &str>) -> String {
    let result = match outcome {
        Ok(()) => "ok".to_string(),
        Err(m) => format!("error: {}", m),
    };
    format!("write verb={} kind={} ns={} name={} result={}", verb, kind, ns, name, result)
}

/// File for rotation slot `index`: 0 is the live file, `n` is `app.log.n`.
pub fn rotated_path(live: &Path, index: u32) -> PathBuf {
    if index == 0 {
        return live.to_path_buf();
    }
    let mut name = live.as_os_str().to_os_string();
    name.push(format!(".{}", index));
    PathBuf::from(name)
}

/// The renames a rotation performs, in order, as `(from_slot, to_slot)`. With 5 files that is
/// `.3→.4`, `.2→.3`, `.1→.2`, `log→.1`; whatever sat in the last slot is dropped.
pub fn rotation_moves(max_files: u32) -> Vec<(u32, u32)> {
    if max_files < 2 {
        return Vec::new();
    }
    (0..max_files - 1).rev().map(|from| (from, from + 1)).collect()
}

/// Whether appending `incoming` bytes to a file of `current` bytes must rotate first. An empty
/// file never rotates, so one oversized line cannot loop.
pub fn needs_rotation(current: u64, incoming: u64, max_bytes: u64) -> bool {
    current > 0 && current + incoming > max_bytes
}

// ─── Logger ──────────────────────────────────────────────────────────────────

struct Logger {
    dir: PathBuf,
    file: PathBuf,
    config_file: PathBuf,
    level: AtomicU8,
    io: Mutex<()>,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

#[derive(Serialize, Deserialize)]
struct PersistedConfig {
    level: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogSettings {
    pub level: String,
    pub log_dir: String,
    pub log_file: String,
    pub file_exists: bool,
    pub max_files: u32,
    pub max_file_bytes: u64,
}

fn read_persisted_level(config_file: &Path) -> Level {
    fs::read_to_string(config_file)
        .ok()
        .and_then(|s| serde_json::from_str::<PersistedConfig>(&s).ok())
        .and_then(|c| parse_level(&c.level))
        .unwrap_or(Level::Info)
}

/// Resolve the log and config directories, apply the persisted level and write the startup line.
/// Call once from `.setup(...)`, beside `init_config_dir`. Failures leave logging disabled.
pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    let (Ok(log_dir), Ok(config_dir)) = (app.path().app_log_dir(), app.path().app_config_dir()) else {
        return;
    };
    let config_file = config_dir.join(CONFIG_FILE_NAME);
    let level = read_persisted_level(&config_file);
    let logger = Logger {
        file: log_dir.join(LOG_FILE_NAME),
        dir: log_dir,
        config_file,
        level: AtomicU8::new(level as u8),
        io: Mutex::new(()),
    };
    if LOGGER.set(logger).is_err() {
        return;
    }
    log(
        Level::Info,
        &format!(
            "startup version={} os={} arch={}",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );
}

fn timestamp_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Shift `file` through its numbered siblings (`.1`..), dropping what sat in the last slot.
/// Shared by the log and the journal.
pub fn rotate_file(file: &Path, max_files: u32) {
    for (from, to) in rotation_moves(max_files) {
        let src = rotated_path(file, from);
        if !src.exists() {
            continue;
        }
        let dst = rotated_path(file, to);
        let _ = fs::remove_file(&dst);
        let _ = fs::rename(&src, &dst);
    }
}

fn rotate(logger: &Logger) {
    rotate_file(&logger.file, MAX_FILES);
}

/// Write one record if `level` is enabled. Scrubs, flattens to one line, rotates, appends.
/// Swallows every failure.
pub fn log(level: Level, message: &str) {
    let Some(logger) = LOGGER.get() else { return };
    if level > Level::from_u8(logger.level.load(Ordering::Relaxed)) {
        return;
    }
    let flat: String = scrub(message)
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect();
    let line = format_line(&timestamp_now(), level, &flat);

    let _guard = logger.io.lock().unwrap_or_else(|e| e.into_inner());
    let _ = fs::create_dir_all(&logger.dir);
    let current = fs::metadata(&logger.file).map(|m| m.len()).unwrap_or(0);
    if needs_rotation(current, line.len() as u64, MAX_FILE_BYTES) {
        rotate(logger);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&logger.file) {
        let _ = f.write_all(line.as_bytes());
    }
}

pub fn warn(message: &str) {
    log(Level::Warn, message);
}

pub fn info(message: &str) {
    log(Level::Info, message);
}

pub fn debug(message: &str) {
    log(Level::Debug, message);
}

/// One line per cluster write: `write verb=… kind=… ns=… name=… result=ok|error[: …]`, plus one
/// journal line (not level-gated). Takes the command's own result by reference so the call site
/// stays one line. `payload` only feeds `journal_summary` (paths, key names, counts) and is never stored.
pub fn log_write<T>(
    context: &str, verb: &str, kind: &str, ns: &str, name: &str,
    payload: Option<&serde_json::Value>, result: &Result<T, String>,
) {
    let outcome = match result {
        Ok(_) => Ok(()),
        Err(m) => Err(m.as_str()),
    };
    info(&format_write_message(verb, kind, ns, name, outcome));
    crate::journal::append(context, verb, kind, ns, name, payload, outcome);
}

/// Debug-level record for a read command: its name and context.
pub fn log_read(command: &str, context: &str) {
    debug(&format!("read command={} context={}", command, context));
}

// ─── Settings (used by commands/diagnostics.rs) ──────────────────────────────

pub fn settings() -> Result<LogSettings, String> {
    let logger = LOGGER.get().ok_or_else(|| "logging is not initialised".to_string())?;
    Ok(LogSettings {
        level: Level::from_u8(logger.level.load(Ordering::Relaxed)).as_str().to_string(),
        log_dir: logger.dir.to_string_lossy().to_string(),
        log_file: logger.file.to_string_lossy().to_string(),
        file_exists: logger.file.is_file(),
        max_files: MAX_FILES,
        max_file_bytes: MAX_FILE_BYTES,
    })
}

/// Apply a level live and persist it. A persistence failure is swallowed: the level still holds
/// for this session.
pub fn set_level(level: Level) -> Result<LogSettings, String> {
    let logger = LOGGER.get().ok_or_else(|| "logging is not initialised".to_string())?;
    logger.level.store(level as u8, Ordering::Relaxed);
    if let Ok(json) = serde_json::to_string(&PersistedConfig { level: level.as_str().to_string() }) {
        if let Some(parent) = logger.config_file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&logger.config_file, json);
    }
    info(&format!("log level set to {}", level.as_str()));
    settings()
}

/// The log directory, if the logger is initialised.
pub fn log_dir() -> Option<PathBuf> {
    LOGGER.get().map(|l| l.dir.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- scrub ----

    #[test]
    fn scrub_bearer_token() {
        let s = scrub("request failed: Authorization: Bearer abc.DEF-123_x~+/= for host");
        assert_eq!(s, "request failed: Authorization: Bearer <redacted> for host");
        assert_eq!(scrub("bearer abc123"), "bearer <redacted>");
    }

    #[test]
    fn scrub_jwt() {
        let jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl";
        let s = scrub(&format!("exec plugin returned {} and exited", jwt));
        assert_eq!(s, "exec plugin returned <redacted> and exited");
        // A lone eyJ with no dots is not a JWT.
        assert_eq!(scrub("eyJhbGciOiJ"), "eyJhbGciOiJ");
    }

    #[test]
    fn scrub_key_colon_and_equals_forms() {
        assert_eq!(scrub("token: abc123 next"), "token: <redacted> next");
        assert_eq!(scrub("password=hunter2, more"), "password=<redacted>, more");
        assert_eq!(scrub("Secret = s3cr3t"), "Secret = <redacted>");
        assert_eq!(scrub("access_token=aaa id_token=bbb"), "access_token=<redacted> id_token=<redacted>");
        assert_eq!(scrub("id-token: x refresh-token: y"), "id-token: <redacted> refresh-token: <redacted>");
        assert_eq!(
            scrub("client-key-data: LS0tLS1CRUdJTg== client-certificate-data: QUJD"),
            "client-key-data: <redacted> client-certificate-data: <redacted>"
        );
    }

    #[test]
    fn scrub_json_and_flag_forms() {
        assert_eq!(scrub(r#"{"token":"abc","user":"bob"}"#), r#"{"token":"<redacted>","user":"bob"}"#);
        assert_eq!(scrub(r#"{"password": "p w d"}"#), r#"{"password": "<redacted>"}"#);
        assert_eq!(scrub("kubelogin --token=abc123 --server x"), "kubelogin --token=<redacted> --server x");
        assert_eq!(scrub("--password=hunter2"), "--password=<redacted>");
    }

    #[test]
    fn scrub_leaves_ordinary_text_alone() {
        for s in [
            "write verb=delete kind=pod ns=default name=web result=ok",
            "secrets is forbidden: User cannot list resource",
            "token: ",
            "mysecretvalue=1",
            "Failed to connect: connection refused",
            "日本語のメッセージ token: 秘密 end",
        ] {
            let out = scrub(s);
            if s.starts_with("日本語") {
                assert_eq!(out, "日本語のメッセージ token: <redacted> end");
            } else {
                assert_eq!(out, s);
            }
        }
    }

    #[test]
    fn scrub_url_userinfo() {
        let u = |tail: &str| ["http", "://", "user", ":", "pw", "@", tail].concat();
        assert_eq!(scrub(&format!("dial {} failed", u("proxy:3128/x"))), "dial http://<redacted>@proxy:3128/x failed");
        assert_eq!(scrub(&u("h")), "http://<redacted>@h");
        // Last `@` wins: no tail of the password leaks, whatever it contains.
        let tricky = ["socks5", "://", "us", ":", "p", "@", "ss", "@", "host:1080"].concat();
        assert_eq!(scrub(&tricky), "socks5://<redacted>@host:1080");
        for pw in ["pa/ss", "pa?ss", "pa#ss"] {
            let raw = ["http", "://", "us", ":", pw, "@", "host:3128/x"].concat();
            assert_eq!(scrub(&raw), "http://<redacted>@host:3128/x", "{pw}");
        }
        // Accepted over-redaction: a later `@` in the path is taken as the end of userinfo.
        assert_eq!(scrub("oci://reg/chart@sha256:abc"), "oci://<redacted>@sha256:abc");
        // Untouched: plain email, no userinfo, empty userinfo.
        for s in ["mail user@example.com now", "http://proxy:3128/a", "ping http://@host", "a://"] {
            assert_eq!(scrub(s), s);
        }
        let once = scrub(&u("h"));
        assert_eq!(scrub(&once), once);
    }

    #[test]
    fn scrub_many_scheme_separators_is_linear() {
        let s = "a://".repeat(50_000);
        assert_eq!(scrub(&s), s);
    }

    #[test]
    fn scrub_client_go_proxy_line() {
        let url = ["socks5", "://", "us", ":", "p/w", "@", "h:1080"].concat();
        let line = format!("Error: invalid 'proxy-url' \"{}\": bad", url);
        let out = scrub(&line);
        assert!(!out.contains("p/w") && !out.contains("us:"), "{out}");
    }

    #[test]
    fn scrub_is_idempotent() {
        let once = scrub("token: abc Bearer xyz");
        assert_eq!(scrub(&once), once);
    }

    #[test]
    fn scrub_handles_truncated_input_without_panicking() {
        for s in ["Bearer ", "token", "token:", "token=\"", "\"token\":\"abc", "eyJ.", "eyJa.b.", "--token=", "password: \"\\", "http://", "http://u@", "://@", "x://a@"] {
            let _ = scrub(s);
        }
    }

    // ---- level, format, rotation ----

    #[test]
    fn level_parse_is_closed_and_case_insensitive() {
        for (s, l) in [
            ("error", Level::Error),
            ("WARN", Level::Warn),
            (" info ", Level::Info),
            ("Debug", Level::Debug),
            ("trace", Level::Trace),
        ] {
            assert_eq!(parse_level(s), Some(l));
        }
        assert_eq!(parse_level("verbose"), None);
        assert_eq!(parse_level(""), None);
        assert!(Level::Error < Level::Info && Level::Info < Level::Trace);
    }

    #[test]
    fn line_format_pads_the_level() {
        assert_eq!(
            format_line("2026-10-04T10:00:00.123Z", Level::Warn, "hello"),
            "2026-10-04T10:00:00.123Z WARN  hello\n"
        );
        assert_eq!(format_line("t", Level::Info, "m"), "t INFO  m\n");
        assert_eq!(format_line("t", Level::Error, "m"), "t ERROR m\n");
    }

    #[test]
    fn write_message_shape() {
        assert_eq!(
            format_write_message("delete", "pod", "default", "web", Ok(())),
            "write verb=delete kind=pod ns=default name=web result=ok"
        );
        assert_eq!(
            format_write_message("scale", "deploy", "prod", "api", Err("Failed to scale: boom")),
            "write verb=scale kind=deploy ns=prod name=api result=error: Failed to scale: boom"
        );
    }

    #[test]
    fn rotation_naming_and_moves() {
        let live = PathBuf::from("/x/app.log");
        assert_eq!(rotated_path(&live, 0), live);
        assert_eq!(rotated_path(&live, 1), PathBuf::from("/x/app.log.1"));
        assert_eq!(rotated_path(&live, 4), PathBuf::from("/x/app.log.4"));
        assert_eq!(rotation_moves(5), vec![(3, 4), (2, 3), (1, 2), (0, 1)]);
        assert!(rotation_moves(1).is_empty());
    }

    #[test]
    fn rotation_threshold() {
        assert!(!needs_rotation(0, 10_000_000, MAX_FILE_BYTES));
        assert!(!needs_rotation(100, 100, MAX_FILE_BYTES));
        assert!(needs_rotation(MAX_FILE_BYTES - 5, 10, MAX_FILE_BYTES));
        assert!(!needs_rotation(MAX_FILE_BYTES - 10, 10, MAX_FILE_BYTES));
    }

    #[test]
    fn rotate_renames_files_on_disk() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let logger = Logger {
            dir: dir.path().to_path_buf(),
            file: dir.path().join(LOG_FILE_NAME),
            config_file: dir.path().join(CONFIG_FILE_NAME),
            level: AtomicU8::new(Level::Info as u8),
            io: Mutex::new(()),
        };
        for idx in 0..MAX_FILES {
            fs::write(rotated_path(&logger.file, idx), format!("slot{}", idx)).expect("write");
        }
        rotate(&logger);
        assert!(!logger.file.exists());
        assert_eq!(fs::read_to_string(rotated_path(&logger.file, 1)).expect("read"), "slot0");
        assert_eq!(fs::read_to_string(rotated_path(&logger.file, 4)).expect("read"), "slot3");
        assert!(!rotated_path(&logger.file, 5).exists());
    }

    #[test]
    fn persisted_level_defaults_to_info() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let cfg = dir.path().join(CONFIG_FILE_NAME);
        assert_eq!(read_persisted_level(&cfg), Level::Info);
        fs::write(&cfg, r#"{"level":"debug"}"#).expect("write");
        assert_eq!(read_persisted_level(&cfg), Level::Debug);
        fs::write(&cfg, "not json").expect("write");
        assert_eq!(read_persisted_level(&cfg), Level::Info);
        fs::write(&cfg, r#"{"level":"loud"}"#).expect("write");
        assert_eq!(read_persisted_level(&cfg), Level::Info);
    }
}
