//! The action journal: one JSON line per cluster write, in `journal.jsonl` beside the
//! app log. Written by `app_log::log_write` (one source with the log line), **not** gated by the
//! log level. A payload is only ever turned into `journal_summary`'s text (paths, key names and
//! counts, never a value) and is not stored. Never panics and never returns an error to the
//! caller, like `app_log`.

use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::app_log::{needs_rotation, rotate_file, rotated_path, scrub, MAX_FILES, MAX_FILE_BYTES};

const JOURNAL_FILE_NAME: &str = "journal.jsonl";
const DEFAULT_LIMIT: u32 = 500;
const MAX_LIMIT: u32 = 5000;

static IO: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct JournalEntry {
    pub ts: String, // RFC3339 UTC millis
    pub context: String,
    pub verb: String,
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub summary: String,
    pub result: String,  // "ok" | "error"
    pub message: String, // scrubbed error text; "" for ok
}

// ─── Summary (pure) ──────────────────────────────────────────────────────────

/// Dotted paths of a merge patch, at most two levels deep.
fn patch_paths(v: &Value, prefix: &str, depth: usize, out: &mut BTreeSet<String>) {
    match v {
        Value::Object(m) if depth < 2 && !m.is_empty() => {
            for (k, val) in m {
                let p = if prefix.is_empty() { k.clone() } else { format!("{}.{}", prefix, k) };
                patch_paths(val, &p, depth + 1, out);
            }
        }
        _ => {
            if !prefix.is_empty() {
                out.insert(prefix.to_string());
            }
        }
    }
}

fn changed_paths(patch: &Value) -> String {
    let mut paths = BTreeSet::new();
    patch_paths(patch, "", 0, &mut paths);
    if paths.is_empty() {
        return String::new();
    }
    let shown: Vec<&str> = paths.iter().take(10).map(String::as_str).collect();
    let extra = paths.len().saturating_sub(10);
    let mut s = format!("changed: {}", shown.join(", "));
    if extra > 0 {
        s.push_str(&format!(", +{} more", extra));
    }
    s
}

fn is_secret_kind(kind: &str) -> bool {
    crate::commands::resource_edit::gvk_for(&kind.to_lowercase()).is_ok_and(|(_, _, k, _, _)| k == "Secret")
}

/// Key names under `data` / `stringData`; a `null` value (a merge patch deleting the key) is
/// "removed". `None` when the payload carries neither field.
fn secret_keys(payload: &Value) -> Option<String> {
    let (mut keys, mut removed) = (BTreeSet::new(), BTreeSet::new());
    let mut found = false;
    for f in ["data", "stringData"] {
        if let Some(m) = payload.get(f).and_then(Value::as_object) {
            found = true;
            for (k, v) in m {
                if v.is_null() { removed.insert(k.clone()) } else { keys.insert(k.clone()) };
            }
        }
    }
    if !found {
        return None;
    }
    let mut parts = Vec::new();
    if !keys.is_empty() || removed.is_empty() {
        let list = keys.iter().cloned().collect::<Vec<_>>().join(", ");
        parts.push(format!("keys: {} (values not recorded)", if list.is_empty() { "none" } else { &list }));
    }
    if !removed.is_empty() {
        parts.push(format!("removed: {}", removed.into_iter().collect::<Vec<_>>().join(", ")));
    }
    Some(parts.join("; "))
}

/// One short line describing a write. Paths, key names and counts only; never a value.
pub fn journal_summary(verb: &str, kind: &str, payload: Option<&Value>) -> String {
    let Some(p) = payload else {
        return if verb == "delete" && kind == "pod" { "grace=default".into() } else { String::new() };
    };
    if is_secret_kind(kind) {
        if let Some(s) = secret_keys(p) {
            return s;
        }
    }
    match verb {
        "patch" => changed_paths(p),
        "scale" => p.get("replicas").and_then(Value::as_i64).map(|n| format!("replicas={}", n)).unwrap_or_default(),
        "delete" => p.get("propagation").and_then(Value::as_str).map(|s| format!("propagation={}", s)).unwrap_or_default(),
        "upgrade" | "install" => format!("values: {} top-level keys", p.as_object().map_or(0, |m| m.len())),
        _ => String::new(),
    }
}

/// Optional exact-match filters for `list_journal`; `None` or blank = no filter.
#[derive(Debug, Clone, Default)]
pub struct JournalFilter {
    pub context: Option<String>,
    pub namespace: Option<String>,
    pub name: Option<String>,
}

impl JournalFilter {
    pub fn matches(&self, e: &JournalEntry) -> bool {
        fn on(f: &Option<String>) -> Option<&str> {
            f.as_deref().filter(|s| !s.is_empty())
        }
        on(&self.context).is_none_or(|c| c == e.context)
            && on(&self.namespace).is_none_or(|n| n == e.namespace)
            && on(&self.name).is_none_or(|n| n == e.name)
    }
}

// ─── Lines and paging (pure) ─────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn entry_line(
    ts: &str, context: &str, verb: &str, kind: &str, ns: &str, name: &str,
    payload: Option<&Value>, outcome: Result<(), &str>,
) -> String {
    let (result, message) = match outcome {
        Ok(()) => ("ok", String::new()),
        Err(m) => ("error", scrub(m)),
    };
    let e = JournalEntry {
        ts: ts.into(), context: context.into(), verb: verb.into(), kind: kind.into(),
        namespace: ns.into(), name: name.into(), summary: journal_summary(verb, kind, payload),
        result: result.into(), message,
    };
    let mut line = serde_json::to_string(&e).unwrap_or_default();
    line.push('\n');
    line
}

/// Entries of one file, oldest first. A line that does not parse (a truncated last line) is skipped.
pub fn parse_entries(text: &str) -> Vec<JournalEntry> {
    text.lines().filter_map(|l| serde_json::from_str::<JournalEntry>(l).ok()).collect()
}

/// Newest first across files given newest file first, at most `limit` entries strictly older
/// than `before` (an RFC3339 UTC millis cursor; the shared format compares as text).
pub fn page(files_newest_first: &[String], limit: Option<u32>, before: Option<&str>, filter: &JournalFilter) -> Vec<JournalEntry> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize;
    let mut out = Vec::new();
    for text in files_newest_first {
        for e in parse_entries(text).into_iter().rev() {
            if before.is_some_and(|b| e.ts.as_str() >= b) || !filter.matches(&e) {
                continue;
            }
            out.push(e);
            if out.len() >= limit {
                return out;
            }
        }
    }
    out
}

// ─── File I/O ────────────────────────────────────────────────────────────────

fn journal_path() -> Option<PathBuf> {
    crate::app_log::log_dir().map(|d| d.join(JOURNAL_FILE_NAME))
}

/// Append one line. Swallows every failure.
#[allow(clippy::too_many_arguments)]
pub fn append(
    context: &str, verb: &str, kind: &str, ns: &str, name: &str,
    payload: Option<&Value>, outcome: Result<(), &str>,
) {
    let Some(file) = journal_path() else { return };
    let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let line = entry_line(&ts, context, verb, kind, ns, name, payload, outcome);
    let _guard = IO.lock().unwrap_or_else(|e| e.into_inner());
    append_line(&file, &line);
}

fn append_line(file: &Path, line: &str) {
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let current = fs::metadata(file).map(|m| m.len()).unwrap_or(0);
    if needs_rotation(current, line.len() as u64, MAX_FILE_BYTES) {
        rotate_file(file, MAX_FILES);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(file) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Journal entries, newest first, across the rotated files. Reading stops once `limit` is met.
pub fn read(limit: Option<u32>, before: Option<&str>, filter: &JournalFilter) -> Result<Vec<JournalEntry>, String> {
    let Some(live) = journal_path() else { return Ok(Vec::new()) };
    let _guard = IO.lock().unwrap_or_else(|e| e.into_inner());
    let mut texts = Vec::new();
    for slot in 0..MAX_FILES {
        match fs::read(rotated_path(&live, slot)) {
            // Lossy: a line cut mid-character is skipped later, never an error.
            Ok(b) => texts.push(String::from_utf8_lossy(&b).into_owned()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(page(&texts, limit, before, filter))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn summary_table() {
        let s = |v: &str, k: &str, p: Value| journal_summary(v, k, Some(&p));
        assert_eq!(s("patch", "deploy", json!({"spec": {"replicas": 3, "template": {"x": 1}}, "metadata": {"labels": {"a": "b"}}})),
                   "changed: metadata.labels, spec.replicas, spec.template");
        assert_eq!(s("scale", "deploy", json!({"replicas": 4})), "replicas=4");
        assert_eq!(s("delete", "pods", json!({"propagation": "foreground"})), "propagation=foreground");
        assert_eq!(journal_summary("delete", "pod", None), "grace=default");
        assert_eq!(journal_summary("delete", "node", None), "");
        assert_eq!(s("upgrade", "helmrelease", json!({"a": 1, "b": {"c": 2}})), "values: 2 top-level keys");
        assert_eq!(s("install", "helmrelease", json!(null)), "values: 0 top-level keys");
        assert_eq!(journal_summary("cordon", "node", None), "");
        assert_eq!(s("restart", "deploy", json!({"x": 1})), "");
    }

    #[test]
    fn patch_summary_caps_at_ten_paths() {
        let mut m = serde_json::Map::new();
        for i in 0..13 {
            m.insert(format!("k{:02}", i), json!(1));
        }
        let out = journal_summary("patch", "cm", Some(&Value::Object(m)));
        assert!(out.ends_with(", +3 more"), "{out}");
        assert!(out.contains("k09") && !out.contains("k10"));
    }

    #[test]
    fn secret_writes_record_key_names_only() {
        let patch = json!({"stringData": {"password": "hunter2"}, "data": {"old": null, "tls.crt": "QUJD"}});
        for kind in ["sec", "secret", "Secret"] {
            let out = journal_summary("patch", kind, Some(&patch));
            assert_eq!(out, "keys: password, tls.crt (values not recorded); removed: old");
            assert!(!out.contains("hunter2") && !out.contains("QUJD"));
        }
        assert_eq!(journal_summary("create", "Secret", Some(&json!({"data": {"a": "x"}}))), "keys: a (values not recorded)");
        // a Secret delete has no data fields: the general rule applies
        assert_eq!(journal_summary("delete", "sec", Some(&json!({"propagation": "background"}))), "propagation=background");
    }

    #[test]
    fn entry_line_scrubs_and_never_holds_the_payload() {
        let l = entry_line("2026-01-01T00:00:00.000Z", "ctx", "patch", "sec", "ns", "n",
            Some(&json!({"data": {"k": "SECRETVALUE"}})), Err("boom password=hunter2"));
        assert!(l.ends_with('\n') && !l.contains("SECRETVALUE") && !l.contains("hunter2"));
        let e: JournalEntry = serde_json::from_str(l.trim()).expect("round trip");
        assert_eq!((e.result.as_str(), e.context.as_str()), ("error", "ctx"));
        assert_eq!(e.message, "boom password=<redacted>");
        let ok = entry_line("t", "", "scale", "deploy", "n", "d", None, Ok(()));
        assert!(ok.contains(r#""result":"ok""#) && ok.contains(r#""message":"""#));
    }

    fn file(entries: &[(&str, &str)], truncated: bool) -> String {
        let mut s: String = entries.iter().map(|(ts, n)| entry_line(ts, "c", "scale", "deploy", "ns", n, None, Ok(()))).collect();
        if truncated {
            s.push_str(r#"{"ts":"2026-01-09T00:00:00.000Z","context":"c","ver"#);
        }
        s
    }

    #[test]
    fn page_is_newest_first_across_files_and_skips_truncated_line() {
        let live = file(&[("2026-01-03T00:00:00.000Z", "c"), ("2026-01-04T00:00:00.000Z", "d")], true);
        let old = file(&[("2026-01-01T00:00:00.000Z", "a"), ("2026-01-02T00:00:00.000Z", "b")], false);
        let files = vec![live, old];
        let names = |v: Vec<JournalEntry>| v.into_iter().map(|e| e.name).collect::<Vec<_>>();
        assert_eq!(names(page(&files, None, None, &JournalFilter::default())), ["d", "c", "b", "a"]);
        assert_eq!(names(page(&files, Some(3), None, &JournalFilter::default())), ["d", "c", "b"]);
        assert_eq!(names(page(&files, None, Some("2026-01-03T00:00:00.000Z"), &JournalFilter::default())), ["b", "a"]);
        assert_eq!(page(&files, Some(0), None, &JournalFilter::default()).len(), 1); // clamped to at least 1
    }

    #[test]
    fn page_filters_before_the_limit() {
        let mk = |ts: &str, ctx: &str, ns: &str, name: &str| entry_line(ts, ctx, "scale", "deploy", ns, name, None, Ok(()));
        let files = vec![[
            mk("2026-01-01T00:00:00.000Z", "a", "x", "web"),
            mk("2026-01-02T00:00:00.000Z", "b", "x", "web"),
            mk("2026-01-03T00:00:00.000Z", "a", "x", "db"),
            mk("2026-01-04T00:00:00.000Z", "a", "y", "web"),
        ].concat()];
        let f = |c: Option<&str>, n: Option<&str>, name: Option<&str>| JournalFilter {
            context: c.map(Into::into), namespace: n.map(Into::into), name: name.map(Into::into),
        };
        let days = |v: Vec<JournalEntry>| v.into_iter().map(|e| e.ts.chars().skip(8).take(2).collect::<String>()).collect::<Vec<_>>();
        assert_eq!(days(page(&files, None, None, &f(Some("a"), None, None))), ["04", "03", "01"]);
        assert_eq!(days(page(&files, None, None, &f(None, Some("x"), Some("web")))), ["02", "01"]);
        // the limit counts matches, not scanned lines
        assert_eq!(days(page(&files, Some(1), None, &f(None, None, Some("db")))), ["03"]);
        // blank = no filter
        assert_eq!(page(&files, None, None, &f(Some(""), Some(""), None)).len(), 4);
        assert!(page(&files, None, None, &f(Some("zzz"), None, None)).is_empty());
    }

    #[test]
    fn append_rotates_and_is_written_regardless_of_log_level() {
        // append_line has no level gate by construction; check the on-disk behaviour.
        let dir = tempfile::TempDir::new().expect("tempdir");
        let f = dir.path().join(JOURNAL_FILE_NAME);
        append_line(&f, "one\n");
        fs::write(&f, vec![b'x'; MAX_FILE_BYTES as usize]).expect("fill");
        append_line(&f, "two\n");
        assert_eq!(fs::read_to_string(&f).expect("live"), "two\n");
        assert_eq!(fs::metadata(rotated_path(&f, 1)).expect("rotated").len(), MAX_FILE_BYTES);
    }
}
