# Command-line launcher (`garita`)

Contract for v2.1.3 (#55). The grammar, the detach, the single instance and the forwarding live in Rust; the strip and the Settings section live in the frontend. Source: `src-tauri/src/launch.rs`, `src-tauri/src/main.rs`, `src-tauri/src/commands/launcher.rs`, `src-tauri/src/commands/cli.rs`, `src-tauri/windows/`; frontend `src/utils/launchArgs.ts`, `src/utils/cliStatus.ts`, `useResources.ts` (`launch-args`, `useCliStatus`).

The command is `garita` (`CLI_COMMAND_NAME`). There is no `watchtower` alias and no "formerly" wording: the product was renamed before the command shipped (v2.0.0 Q200-3).

## Grammar

`garita [--context <ctx>|--context=<ctx>] [-n|--namespace <ns>|--namespace=<ns>|-n=<ns>] [<kind>]`, `-h`/`--help`, `-V`/`--version`. One pure parser, `parse_launch_args(&[String]) -> LaunchAction`, serves both entry points (the first process in `main.rs`, a forwarded second one in `lib.rs`). It never panics on any argv: no `unwrap`, no indexing.

- `argv[0]` is skipped. `--help` beats `--version`, which beats a normal run, regardless of order or unknown neighbours.
- **`ignored` holds every token the parser did not consume**, so the UI needs one message. Consumed flag values never appear in it.
  - An unrecognised kind goes to `ignored` and `kind` stays `None`; the first positional is the only kind candidate, so a second and later positional also go to `ignored`.
  - A value flag with no value (last argument, or followed by a flag) puts the flag token in `ignored` and does not swallow the next flag.
  - `-nfoo` goes to `ignored`. `-n=x`, `--namespace=x` and `--context=x` are accepted; an empty value after `=` goes to `ignored`.
  - A namespace value that is not an RFC 1123 label (`valid_namespace`, hand-written) goes to `ignored` as the flag plus the value (`-n Bad_NS`, `--namespace=Bad_NS`) and `namespace` stays `None` (S4). A context value is never validated here.
  - macOS Finder's `-psn_*` is dropped silently.
- Every token echoed into `ignored` or to stderr is capped at 64 characters plus `...` (`cap`). Context and namespace names themselves are not capped in Rust (real context names exceed 64 characters); the frontend caps them for display only.
- **Kind table:** one `match` in `normalize_kind` maps Garita kind tokens and kubectl short names (`po`, `deploy`, `svc`, `ing`, `cm`, `secret`, `no`, plurals and singulars) to the exact `ResourceType` strings of `src/types/k8s.ts`, case-insensitively. `ns`/`namespace(s)` and `crd-instances` are deliberately unmapped (there is no namespaces view; a CRD instance needs a CRD): a typed `ns` lands in `ignored`. The help's short-name line is `HELP_SHORT_NAMES`, and a test checks every name in it resolves, so the help cannot drift from the table.
- `--help` and `--version` text is built in Rust from `PRODUCT_NAME`, `CLI_COMMAND_NAME` and `CARGO_PKG_VERSION`. The UI does not duplicate it.

## stderr lines

Printed by the **launching** process only, before it detaches, only when stderr is a terminal, one per `ignored` token (`ignored_warning`): unknown option, unknown resource type, option needs a value, invalid namespace. Exit code stays 0. **Windows prints none of them** (no console is attached outside help/version); the strip in the app is the only feedback there. Do not widen the console attach to fix that.

## Help, version, detach (`main.rs`)

- `--help`/`--version` print and exit 0 **before** the Tauri builder; nothing else starts, so they work without a display.
- **Windows console wart:** the release build stays `windows_subsystem = "windows"` (switching subsystem would flash a console on every Start-menu launch). Only help/version call `AttachConsole(ATTACH_PARENT_PROCESS)`; if stdout is not redirected the text is written to `CONOUT$`. The prompt can return before the output appears.
- **Unix detach:** when stdout is a terminal and `GARITA_DETACHED` is unset, the process re-spawns itself with the same args, `process_group(0)`, stdio to null and `GARITA_DETACHED=1`, then exits 0, so closing the terminal does not kill the app. If the spawn fails it keeps running attached.

## Single instance and forwarding (`lib.rs`)

- `tauri-plugin-single-instance` is registered **first** in the builder, before every other plugin. Keep it first.
- **Forwarded argv is data only.** The callback parses it with the same parser and stores it; it never reaches a subprocess or a shell.
- **Pull delivery (K6):** the callback stores the parsed `LaunchArgs` in a pending slot (latest wins), emits `launch-args` with a **null payload**, then `unminimize` + `set_focus`. `get_launch_args` returns the pending slot if set (and counts the first instance's own argv as consumed); otherwise its own argv once; then `LaunchArgs::default()`. The webview registers the `launch-args` listener **before** its first pull and pulls on every event, so a second invocation during startup is not lost and a webview reload never applies args twice. `LaunchArgs::default()` means nothing to apply. The take rule is the pure fn `take` in `commands/launcher.rs`.
- **Why this is not a log-stream `listen`:** the "no global `listen`" rule (`pods-logs.md`) is about per-invocation log channels. `launch-args` is one app-lifetime ping with a single listener, registered once from `useResources.ts`; the data comes through `invoke`, not the event.
- The frontend defers a forwarded request while a dialog is open, and fails open on namespace validation (see `ui.md`).

### Upstream limits (N11)

Read from `tauri-plugin-single-instance` 2.4.5 (`~/.cargo/registry`), not fixable here:
- On Linux the plugin calls `unwrap()` on its D-Bus `serve_at(...)` result, and on the session-bus `session()` and the well-known `name()` builders, during setup; an error there aborts the first instance at startup (release is `panic = "abort"`). The realistic trigger is a malformed `DBUS_SESSION_BUS_ADDRESS`; an unset one falls back to `/run/user/<uid>/bus`, and a failed connect is handled.
- The **second** process reads `std::env::args()` inside the plugin, which panics on non-UTF-8 argv, so that process aborts and nothing is forwarded. Our own parser uses `args_os` lossily (`os_argv`) and is not the cause.
- On Windows the plugin joins argv with `|`, so a forwarded argument containing `|` splits in two.

## Settings → Command line (`commands/cli.rs`)

App-local commands (no `context`): `get_cli_status`, `install_cli_command` (macOS only, otherwise `Err("Failed to install command: not supported on this platform")`). `install_cli_command` is a local symlink, not a cluster write: a raw `invoke` with an `EXEMPT` entry in `writeBackstop.test.ts`. Decisions are pure (`decide_status`, `plan_install`) over a `Probe`; the filesystem/registry reads are thin shims, and `get_cli_status` runs them in `spawn_blocking`.

`CliStatus` (`method`, `on_path`, `resolved_path`, `manual_command`, `path_hint`):

| OS | `method` | `on_path` is true when | `manual_command` |
|---|---|---|---|
| macOS | `symlink` | `garita` on PATH (after `fix_path`) or in `/usr/local/bin` canonicalises to this app's binary | always set. **Administrator** (`/Applications` writable, i.e. the admin group; `mac_admin`): `sudo ln -s '<exe>' /usr/local/bin/garita`; `ln -sfh` only over an existing symlink; prefixed `sudo mkdir -p /usr/local/bin && ` when the directory is absent. **Standard account**: `mkdir -p ~/.local/bin && ln -s '<exe>' ~/.local/bin/garita`, no `sudo`, plus `path_hint` `export PATH="$HOME/.local/bin:$PATH"` unless `~/.local/bin` is already on PATH. Paths are single-quoted (`sh_quote`). |
| Linux package | `package` | `garita` on PATH canonicalises to `current_exe()` | none |
| Linux with `$APPIMAGE` | `manual` | `garita` on PATH canonicalises to the canonical `$APPIMAGE` | `ln -s '<APPIMAGE>' ~/.local/bin/garita` (no AppImage is published; this is for self-built ones) |
| Windows | `installer` | `garita.exe` is in a directory of the HKCU `Environment` Path, the HKLM `Session Manager\Environment` Path or the process PATH (`%VAR%` expanded, quotes trimmed) | the exe's folder when not on PATH |

`resolved_path` is what was found, even when stale (`on_path=false` with `Some` means a stale or foreign link). The UI prints it and never a hard-coded path (a Homebrew `binary` stanza links elsewhere).

`path_hint` is a line for the user's shell profile, shown under the copy line; it is `None` on every row except the macOS standard-account one. **The app never writes a shell profile.**

macOS `install_cli_command` (`plan_install`, never escalates, never shells out) tries the links of `install_links` in order: `/usr/local/bin/garita`, then `<user_bin>/garita`. `user_bin` is the first of `$HOME/.local/bin` and `$HOME/bin` that is a directory and is on PATH (after `fix_path`); install never creates a folder, since a new one would not be on PATH. `/usr/local/bin` goes first so an install that worked before keeps landing there, and so a new link is not shadowed by an older one in `/usr/local/bin`. Per link: a temporary location (path under `/AppTranslocation/` or a read-only volume via `statfs`) is an `Err`; a regular file or a live link to anything other than `…/Contents/MacOS/garita` is `Err("Failed to install command: <link> already exists and is not Garita's link")` and stops the install; a dangling or Garita-shaped link is replaced; permission denied or a missing directory moves on to the next link. When none is writable it returns `Ok` with `on_path: false`, the `manual_command` and the `path_hint`.

Known ceiling: when `fix_path` falls back to its static list (no login shell answered), that list contains `~/.local/bin` and `~/bin`, so a link there can read as installed although the user's terminal does not have that folder on PATH.

## Per-OS install (K2–K5)

- **Linux:** the binary is `/usr/bin/garita` in the `.deb`/`.rpm`, so there are no post-install scripts. AppImage: none published.
- **macOS:** `Garita.app/Contents/MacOS/garita`. The Settings button creates the link above; the cask has `binary "#{appdir}/Garita.app/Contents/MacOS/garita"` (Homebrew links it into its own prefix).
- **Windows NSIS** (`bundle.windows.nsis.installerHooks` → `src-tauri/windows/hooks.nsh`): per-user install; adds `$INSTDIR` to the **user** PATH. It **never writes a PATH it did not read in full**: if `ReadRegStr` sets the error flag PATH is left untouched; it adds only when `StrLen(PATH)+1+StrLen($INSTDIR) < 1000` (`NSIS_MAX_STRLEN` is 1024 and Tauri's NSIS ships no EnVar plugin); the entry match is exact, case-insensitive and `;`-delimited; it writes back with `WriteRegExpandStr`; it broadcasts `WM_SETTINGCHANGE`. Uninstall removes only that exact entry and leaves the rest of PATH as it was. A user whose PATH is too long gets no command; Settings shows the folder to add.
  - Uninstall leaves PATH **untouched when it is 1000 characters or longer** (the scan builds `;PATH;` in a 1023-character register, and a longer value could be truncated on write-back); an entry we added to such a PATH stays. When our entry was the only one, uninstall writes an empty string with `WriteRegExpandStr` (it does not delete the value), so the value is byte-identical to before install.
  - The match also accepts the entry with a trailing backslash, so a hand-added `...\Garita\` is neither duplicated on install nor left behind on uninstall.
  - The add path writes `REG_EXPAND_SZ` even when the user's Path was `REG_SZ`; harmless (the system expands it either way).
- **Windows MSI** (`bundle.windows.wix.fragmentPaths` → `src-tauri/windows/path.wxs`, `componentRefs: GaritaPathEnv`): per-machine (Tauri's `main.wxs`), adds `[INSTALLDIR]` to the **system** PATH with `<Environment System="yes" Permanent="no">`; Windows Installer removes it on uninstall.
- **Scoop** extracts the MSI (no installer runs, no PATH hook); its `bin` shim provides `garita`. See `build-and-release.md`.
- The process PATH is stale until the app is relaunched after an installer ran; that is why Windows status reads the registry first.

## Windows build facts

Installers are unsigned (no Authenticode). The updater `.sig` files are a different thing (minisign, made only in `release.yml` → `publish`). In-app update install stays macOS-only; Windows and Linux get a notice (`updateMode`, `capabilities/updater-macos.json`).

## Tests

Rust: `launch::tests` (parser, help names, namespace validation, caps), `commands::launcher::tests` (take rule), `commands::cli::tests` (every `CliStatus` row including the standard-account line and `path_hint`, `plan_install`, `install_links`, `user_bin`, quoting, `expand_env`). TS: `launchArgs.test.ts`, `cliStatus.test.ts`, `writeBackstop.test.ts`.

The `cfg(unix)` code (detach, stderr gating, macOS `install_cli_command` and its `statfs` and `access` (`mac_admin`) shims, the Linux status path) does not compile on a Windows box; it needs `cargo check` and `cargo test --lib` on macOS and Linux (`open-items.md`).
