# Diagnostics and the app log file

Backend: `src-tauri/src/app_log.rs`, `src-tauri/src/commands/diagnostics.rs`. Host view: Settings view in `ui.md`.

## Diagnostics (v1.3.1)

A small hand-rolled support log: what Garita did and which cluster writes it made. **No `log` crate, no regex crate, no new dependency.** Not a tracing system.

- **Path:** `<app_log_dir>/app.log`, resolved once in `.setup(...)` (`lib.rs`) after `init_config_dir`. The directory is created on first write, so `open_log_folder` can say "no log file has been written yet".
- **Rotation:** five files × 5 MiB (`MAX_FILES`, `MAX_FILE_BYTES`). Before a write would exceed the limit: `.3`→`.4`, `.2`→`.3`, `.1`→`.2`, live→`.1`, old `.4` dropped. Order from pure `rotation_moves(max_files)`. An empty file never rotates (no loop on one huge line).
- **Levels:** `error`, `warn`, `info`, `debug`, `trace`; default `info`; stored in `<app_config_dir>/diagnostics.json` as `{"level":"info"}` (missing/bad → `info`). **`set_log_level` applies live** (atomic), then persists; a persist failure is swallowed.
- **Line:** `<RFC3339 UTC ms> <LEVEL padded to 5> <message>\n`. Embedded newlines become spaces.

### Must not regress

- **Never panics, never returns an error.** IO failures are swallowed; mutex via `lock().unwrap_or_else(|e| e.into_inner())`. `panic = "abort"` would kill the app.
- **`app_log::log` scrubs every message centrally** (covers echoed text such as `friendly_auth_error` output). `scrub` is pure, char-based (never splits UTF-8), idempotent. Replaced with `<redacted>`:
  - the token after `Bearer `
  - JWT-shaped tokens (`eyJ` + base64url `.` base64url `.` base64url)
  - values after `token`, `access_token`, `id-token`, `id_token`, `refresh-token`, `password`, `client-key-data`, `client-certificate-data`, `secret` (case-insensitive) in `key: v`, `key=v`, `"key":"v"`, `--key=v`. Key must start at a word boundary (`mysecretvalue=1` untouched).
- **Write payloads are never logged.** A write line carries verb, kind, namespace and name only: never a patch body, YAML, Helm values or Secret data. `log_write`'s `payload` argument only feeds the journal's `journal_summary` (below) and is never stored.
- **Dry runs are not logged.**

### What is logged

- **Info:** `startup version=… os=… arch=…`; one line per cluster write: `write verb=<v> kind=<k> ns=<ns> name=<n> result=ok` or `result=error: <scrubbed>`. Verbs: `delete`, `apply`, `patch`, `create`, `merge` (per document), `scale`, `restart`, `pause`, `resume`, `rollback`, `cordon`, `uncordon`, `taint-add`, `taint-remove`, `trigger`, `evict`, `sync`, `refresh`, `upgrade`, `install`, `uninstall`, `debug`, `exec`, `attach`, `port-forward-start`, `port-forward-stop`. `evict_pod` returns `Ok` but logs the verdict (blocked/failed = `error`; evicted/gone = `ok`).
- **Warn:** non-`ok` `check_cluster_access` state.
- **Debug:** only `get_resource_json`, `preview_resource_yaml`, `preview_custom_resource_yaml`, `preview_helm_upgrade` (`app_log::log_read(command, context)`). Not every read; do not claim otherwise.

**Not captured:** kube-rs, hyper and Tauri internal records (no `log`-facade logger). Trace level does not show HTTP traffic.

### Commands

| Command | Behaviour |
|---|---|
| `get_log_settings() -> LogSettings` | `level`, `log_dir`, `log_file` (absolute), `file_exists`, `max_files` (5), `max_file_bytes` (5 MiB). `Err("Failed to read log settings: …")` only if never initialised |
| `set_log_level(level) -> LogSettings` | Unknown level: `Err("Failed to set log level: unknown level '…'")`, before any state change |
| `open_log_folder()` | No directory: `Err("Failed to open log folder: no log file has been written yet")`. Else spawns `open` / `explorer` / `xdg-open` with the path as **one `.arg()`**. `spawn()` without waiting (Windows `explorer` exits non-zero on success) |

**App-local: no `context` parameter**, an explicit exemption like the kubeconfig registry commands. Hooks `useLogSettings` (staleTime 30 s, `retry: false`), `useSetLogLevel`, `useOpenLogFolder` are exempt from the write backstop; `set_log_level` is in `writeBackstop.test.ts`'s exemption list so Settings works in read-only mode.

### Frontend

`SettingsView.tsx` Diagnostics: level select (live, Debug/Trace note), log path + Copy, "Open log folder" (disabled "No log file has been written yet." when `!file_exists`; plain message if the open fails), privacy note, retention line from `retentionLine` (`src/utils/diagnostics.ts`).

## Action journal (v1.4.1)

Local, read-only record of the cluster writes Garita itself made: what, where, when, and whether the API server accepted it. **Not** an audit log (it does not see kubectl or other tools); "Accepted" = the API server returned success, not that the change took effect. Contract: `docs/impl/v1.4.1-tasks.md` §2.3, B-8, B-9, B-25.

- **Path:** `journal.jsonl` in the app log directory, beside `app.log` (`journal.rs` via `app_log::log_dir()`); rotated slots `journal.jsonl.1`... Nothing is written if the logger was never initialised.
- **One source with the log line:** `app_log::log_write(context, verb, kind, ns, name, payload, result)` writes the level-gated info line **and** appends one journal line. No second call site. Dry runs are not recorded, nor writes the read-only backstop refused before Rust.
- **Not level-gated:** `journal::append` never consults the log level. Never panics, never returns an error, like `app_log`.
- **Shared rotation:** `app_log::rotate_file(file, max_files)` for both files; 5 × 5 MiB, so up to about 25 MiB of the newest entries.
- **Entry:** `JournalEntry { ts (RFC3339 UTC millis), context, verb, kind, namespace, name, summary, result ("ok"|"error"), message }`. `message` = error text through `scrub()`, `""` for ok. `stop_port_forward` has no context and records `""`. Verb and kind are **verbatim** (same strings as the log line, not normalised): `ResourceType` ids, singular nouns (`pod`, `node`, `cronjob`, `service`, `helmrelease`, `namespace`, `portforward`) and PascalCase API kinds (`apply_yaml_documents`, `create_resource`). A custom resource write (v2.4.1: `delete_custom_resource` and `apply_custom_resource_yaml`) records the kind `<plural>.<group>` (for example `widgets.acme.io`, `cr_journal_kind` in `crds.rs`), kubectl's noun for it. The frontend maps them with `journalKind` (`KIND_TO_RESOURCE_TYPE`, then aliases, then the label; unknown shown verbatim, so a custom resource kind shows as `<plural>.<group>`).
- **The summary is never a value.** Pure, tested `journal_summary(verb, kind, payload)` keeps key names, paths and counts; the payload is never stored. Patch: up to ten dotted paths two levels deep (`changed: spec.replicas, ...`, `+N more`). Any Secret write (kind via `gvk_for`: `sec`, `secret`, `Secret`): `keys: a, b (values not recorded)`, `removed: c` for `null` keys. Scale `replicas=<n>`; `delete_resource` `propagation=<policy>`; `delete_pod` `grace=default`; Helm upgrade/install `values: <n> top-level keys`; else `""`. A Secret delete has no `data` and falls through.
- **Payload per site:** `patch_resource` the merge patch; `scale_workload` `{replicas}`; `delete_resource` `{propagation}` (default `background`); `delete_custom_resource` `{propagation: "background"}`; `apply_resource_yaml` and `apply_custom_resource_yaml` the YAML as JSON; `create_resource_from_yaml` the document; `apply_yaml_documents` (verb `merge`) one entry per document; Helm upgrade/install the parsed values. Every other site: `None`.
- **Verbs:** `apply`, `attach`, `cordon`, `create`, `debug`, `delete`, `evict`, `exec`, `install`, `merge`, `patch`, `pause`, `port-forward-start`, `port-forward-stop`, `refresh`, `restart`, `resume`, `rollback`, `scale`, `sync`, `taint-add`, `taint-remove`, `trigger`, `uncordon`, `uninstall`, `upgrade`.
- **Reading:** `list_journal(limit?, before?, context?, namespace?, name?) -> JournalEntry[]` (app-local, no `context` required: the `context` arg is an optional filter): newest first across live + rotated files, stops at `limit` (default 500, clamped 1..5000); the three filters are exact matches on the entry (blank = none) applied before the limit, and there is no `kind` filter (journal kinds come in three spellings; the frontend filters with `journalResourceType`); `before` = RFC3339 cursor, strictly older; an unparseable (truncated) line is skipped; missing file = `[]`; only error is I/O: `Failed to read journal: {e}`. Same-millisecond entries at a page boundary are skipped (open item).
- **Frontend:** Journal page (Sidebar beside Settings; palette "Journal"), read only: no row actions, selection, clear or export. `useInfiniteQuery` on the `before` cursor; filters loaded entries only (Cluster, Kind, Result, TopBar search); verbs monospace; cluster as a `getClusterIdentity` chip (none for `""`); results Accepted / Failed. See `ui.md` (App views).
