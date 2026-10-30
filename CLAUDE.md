# Garita

Tauri v2 + React 18 desktop app for Kubernetes cluster management.

## Development

```bash
make dev              # cargo tauri dev; on Windows switches to the MSVC toolchain first
```

**Windows:**
- Needs the MSVC Rust toolchain (`rustup toolchain install stable-x86_64-pc-windows-msvc` + VS Build Tools "Desktop development with C++"). A GNU Rust (Chocolatey/scoop) earlier on `PATH` fails with mass `E0461 … expected target triple x86_64-pc-windows-gnu`. `rustup run` does not fix it (toolchain dir lands last on `PATH`).
- The Makefile `RUN` macro (`dev`, `windows`, `deps`) prepends the MSVC bin dir, exports `RUSTUP_TOOLCHAIN`, asserts an MSVC host, and fails fast otherwise (`WIN_TOOLCHAIN=…` overrides).
- Outside `make`, `RUSTUP_TOOLCHAIN` alone is not enough. Use `export PATH="$HOME/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH" RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc; rustc -vV | grep host` and check the host before trusting results (a GNU build's test binary dies with `STATUS_ENTRYPOINT_NOT_FOUND`). After a mixed run: `cargo clean --profile dev --manifest-path src-tauri/Cargo.toml`.
- `make` works from PowerShell, cmd and Git Bash: the Makefile pins `SHELL` to Git for Windows' `usr/bin/bash.exe` (lookup: `GIT_BASH=…`, `%ProgramW6432%\Git`, `%ProgramFiles%\Git`, `%LOCALAPPDATA%\Programs\Git`, `git --exec-path`). **Never use a bare `bash`** (it is the WSL launcher). In a VS Developer prompt, Git's `link.exe` may shadow MSVC's; use a plain shell.
- Bash/PowerShell/Monitor tool calls go through the PreToolUse hook `.claude/hooks/rtk-hook.mjs`, subagents included. It wraps **every** command in `rtk proxy` (maintainer rule; with no `rtk` on `PATH` it only strips `rtk`/`rtk proxy` prefixes, so contributors without rtk are unaffected): the command reaches a child `"$BASH"` (or `powershell`) on stdin, never argv (MSYS would drop `\\`, path-convert a leading `/usr/bin/x` and glob); the child hands its cwd back so `cd` persists; exit codes pass through. Before wrapping: `rtk hook claude`, plus `MSYS=noglob` scoped to `rtk grep`/`rtk find` (MSYS grep/find spawned by native `rtk.exe` re-glob `{1,2}`, `*`, `?`), except a segment with a literal `"` (noglob breaks MSYS's parsing of it). **Never set `MSYS=noglob` globally** (settings `env`, `setx`, `.bashrc`): Claude Code starts `bash.exe` with a quoted command line that noglob breaks. The RTK setup here is project-only: the user-level copy `~/.claude/hooks/rtk-hook.mjs` steps aside when this file exists; keep the two identical (`node .claude/hooks/rtk-hook.mjs --test`). Write commands with an `rtk` prefix, per `~/.claude/RTK.md` (the hook keeps it and adds `rtk proxy` on top; Team protocol), and **never run `rtk init` or `rtk init -g` here**: it rewrites the RTK block below from a machine setting and `-g` adds a second, unwrapped user hook.
- The user may have `make dev` running on :1420. Check who owns the port before a dev run; `scripts/dev-preflight.mjs` would kill their vite.

## Build

Tauri cannot cross-compile; build each platform natively.

```bash
make deps             # Rust targets + npm deps for current OS
make build            # current OS
make mac              # macOS ARM64 .dmg
make mac-app          # macOS ARM64 .app only (ad-hoc signed)
make mac-install      # mac-app, copied to ~/Applications (no admin password)
make mac-universal    # macOS Universal .dmg
make windows          # .msi + NSIS .exe
make linux            # .deb + .rpm + .AppImage (also linux-deb, linux-rpm, linux-appimage, linux-pacman)
make clean            # wipe dist/ and Rust build artifacts
```

Bundles land in `src-tauri/target/<triple>/release/bundle/` (`aarch64-apple-darwin`, `universal-apple-darwin`, `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`).

macOS is **ad-hoc signed only**; Developer ID/notarization was removed on purpose, do not re-add. Signing and release steps: `docs/build-and-release.md`.

`release.yml` also builds Windows x64 (`windows-2022`, `msi,nsis`, **unsigned**: SmartScreen warns; the updater `.sig` files are not code signing). `make windows` is the local gate for both bundles; Windows facts: `build-and-release.md` → Windows installers and Scoop.

## Release notes

`CHANGELOG.md`, Keep a Changelog 1.1.0 + SemVer, newest first. Work in progress goes under `## [Unreleased]`; a release renames it to `## [X.Y.Z] - YYYY-MM-DD` and opens a new empty `[Unreleased]`. Groups in order, empty ones omitted: Added, Changed, Deprecated, Removed, Fixed, Security. Shipped items only. README has no per-version notes.

## Architecture

- **Rust** (`src-tauri/`): every Kubernetes call via kube-rs 0.95 / k8s-openapi 0.23. No kubectl binary. Helm is shell-out only.
- **React** (`src/`): UI only; all data via `invoke()`. The app's HTML entry is `app.html` (Vite `build.rollupOptions.input`, Tauri window `url`); the root `index.html` is the GitHub Pages landing page (`pages.yml` deploys it with the files it loads), never the app.
- **State**: React Query v5 only (no Redux/Zustand); `refetchInterval` on resource queries. All hooks in `src/hooks/useResources.ts`; components never call `invoke`.
- **Design tokens** are role-named CSS variables in `src/index.css`, mapped in `tailwind.config.js`; components never use colour literals (`ui.md` → Appearance). Use Tailwind classes; inline `style` only for computed values (widths, positions, runtime colours). `dim` fails WCAG AA as text colour; use `mute` for secondary text.

## Tauri Command Convention

- `async`, returns `Result<T, String>`, named `verb_noun`, `context: String` first (app-local commands such as the kubeconfig registry and diagnostics are exempt).
- Errors: `.map_err(|e| format!("Failed to …: {}", e))`; no `unwrap()` in handlers.
- JS args are camelCase (`resourceType`, `dryRun`); Tauri maps them to snake_case.
- Tauri v2 rejects `invoke()` with a **plain string**: display with `(error as any)?.message ?? String(error)`.

## Hard rules (details in the linked file)

- **Every additive/optional Tauri param is `Option<T>`.** A bare `bool`/`String` errors `missing required key …` at runtime; shipped twice. (`resource-types.md`)
- **Per-kind knowledge lives in five silent tables** (`get_resource_yaml`/`apply_resource_yaml`, `delete_resource`, `gvk_for`, `RESOURCE_QUERY_KEY`, `resourceNamespace()`/`CLUSTER_SCOPED_KINDS`) plus more sites; `tsc` catches only some. (`resource-types.md`)
- **`argocd` + siblings are namespaced**, only *listed* cluster-wide. `resourceNamespace()` returns `null` (not `""`) for cluster-scoped kinds. `CLUSTER_SCOPED_KINDS` (object scope) and `viewHidesNamespacePicker` (view rule) in `src/utils/scope.ts` answer different questions. (`resource-types.md`)
- **Drain = Eviction API only.** Never `delete` as a fallback for a refused eviction. (`node-drain.md`)
- **Never write the user's kubeconfig**; never merge imports into `~/.kube/config`; `remove_kubeconfig` never deletes files; every registry mutation calls `invalidate_client_cache()`. (`cluster-access.md`)
- **`helm_run` sets `KUBECONFIG`** to the enabled registry paths. Helm **upgrade** extracts the chart from the release secret (never `helm search repo`); **install** must not. Args via separate `.arg()`, never a shell string. (`helm.md`)
- **Guided edit = clone → mutate → `mergePatch` → `Patch::Merge`.** Never re-serialise from form state; no element-wise array merge in `patch.ts`; no SSA, no strategic merge. **One exception:** `start_debug_container` (`Patch::Strategic` on Pod `ephemeralcontainers`); `grep -rn "Patch::Strategic" src-tauri/src` must return exactly that hit. Secret edits → `stringData`, deletes → `data: {k: null}`. (`writes.md`, `pods-logs.md`)
- **Every cluster write goes through `invokeWrite()`** in `useResources.ts` (read-only backstop; a hint, not a security boundary). Shells are blocked in read-only (`READ_ONLY_BLOCKS_SHELL`). `src/hooks/writeBackstop.test.ts` fails on a raw `invoke()` of a write command. (`ui.md`)
- **YAML Save and Helm upgrade go through a PREVIEW-GATE** (server dry run first); an `Err` from the preview means "unavailable", never "approved". One shared replace path in `pods.rs`. (`writes.md`)
- **`split_yaml_documents` stays a `for` loop that breaks on the first error** (`serde_yaml` 0.9.34 iterator hangs past an error). Resolve plurals from discovery, never `kind_to_plural`. UI says "Merge", never "Apply". (`writes.md`)
- **ArgoCD writes:** sync is an `.operation` merge patch; force is `syncStrategy.hook.force`; omit `revision`; reject if `.operation` is set; refresh is an annotation; only rollback uses `syncStrategy.apply`. Never hardcode the `argoproj.io` version. Health is computed from K8s `.status`, never the ArgoCD API; Sync and Health stay independent. (`argocd.md`)
- **Deletes send an explicit propagation policy** (Background default) via `delete_params_for`. (`writes.md`)
- **`can_i` fails open.** Only explicit `allowed: false` disables; denied = disabled with a reason, not hidden. (`cluster-access.md`)
- **Every `<ConfirmModal>` carries `contextLabel`/`contextColor`.** (`ui.md`)
- **Log streams:** per-invocation `Channel<LogStreamEvent>`, no global `listen` for log data; starters live in `useResources.ts`, no component calls `invoke`. The one app-lifetime listener is the null-payload `launch-args` ping (`launcher.md`). (`pods-logs.md`)
- **No Secret value is shown without a per-object reveal, and none outlives its panel.** `list_secrets` ships keys and sizes only; every webview Secret read spreads `secretReadOptions` and `forgetSecret` drops it on Hide, close or selection change; every diff and preview masks `data`/`stringData` (and their parent rows) and the last-applied annotation; Rust masks Secret documents in Helm output and the Secret last-applied annotation in `get_resource_metadata`; Helm Values are redacted backend-side and upgrade/preview refuse the sentinel; the resource map lists Secret names only (`list_metadata`). (`writes.md`)
- **`panic = "abort"` in release:** parsers of untrusted input (certs, YAML, CRDs, Helm blobs) have no `unwrap`/`expect`/indexing; `catch_unwind` does nothing. TLS: never drop a PEM block, never read `tls.key`. (`writes.md`)
- **Health is read-only and deterministic.** `list_problems` rules are pure Rust; a failed source goes to `skipped`, never `Err`; event evidence matches kind and name; **no Secret data leaves the backend** (TLS: `tls.crt`, `not_after`/`not_before` only); one expiry rule (`expiryState`); right-sizing and Constraints are hints ("hint", "may apply"). (`health.md`)
- **External metrics/logs go through the API server's service proxy only** (GET, `get services/proxy`), from fixed query templates (`pod-cpu`, `pod-mem`, `node-cpu`, `node-mem`; no p95 template); metrics-server stays the fallback; config is app-local on the cluster identity record, not synced. Errors are classified by origin: only an API-server 403 is "No access to services/proxy". (`pods-logs.md`)
- **Knowingly kept, don't "fix":** `list_pod_metrics` swallowing errors; 404→empty for absent CRDs. (`resource-types.md` → Services fallback)
- **Updater:** the macOS updater tarball is made from the ad-hoc-signed `.app` after `codesign`, never by `tauri build`. `TAURI_SIGNING_PRIVATE_KEY` is used only in `release.yml` → `publish` → "Sign updater files" (environment `release`). Linux and Windows get an update notice, not an in-app install (`capabilities/updater-macos.json`). Losing the key strands every install. (`build-and-release.md`)
- **Launcher:** `tauri-plugin-single-instance` stays registered **first** in `lib.rs`. Forwarded and own argv are DATA ONLY (parsed by `parse_launch_args`; never reach a shell or another program, the only re-use is the Unix detach re-exec of the app itself) and are pulled through `get_launch_args` after a null-payload `launch-args` ping. `--help`/`--version` exit before the Tauri builder. The NSIS hook never writes a PATH it did not read in full. `ignored` holds every token the parser did not consume. No `watchtower` alias. (`launcher.md`)
- **Doc-vs-code:** these docs have described features that did not exist. Verify claims against code; state properties checkable by grep, not counts; change the doc in the same diff as the behaviour.

## Team protocol

How multi-agent runs work here. The Boot step in every `.claude/agents/*.md` makes this section binding, together with the hard rules.

- **Boot, at every spawn and every resume** (maintainer rule: caveman, ponytail and rtk, always, where installed):
  - Load the caveman skill at ultra unless its rules are already in context: `caveman:caveman`, else `caveman`, else `anthropic-skills:caveman`. Load `ponytail:ponytail` at ultra the same way. A contributor without these skills skips this step.
  - Prefix every shell command with `rtk` (`rtk git status`, `rtk grep`, `rtk ls`), per `~/.claude/RTK.md`. The hook keeps the prefix and wraps the whole command in `rtk proxy` (Development → Windows); without `rtk` on `PATH` it strips the prefix and runs the command plain. Where Testing names an exact form (`npx vitest run`), that form wins.
  - Search file contents with the Grep tool when the pattern holds a quote or `\|`: through `rtk grep`, MSYS grep has failed on such patterns and left a `grep.exe.stackdump`. Delete any `*.stackdump` at the repo root; never commit one.
  - The main session repeats Boot in every spawn and resume prompt.
- **Chat is caveman ultra (when the skill is loaded); files are normal prose.** Files, code comments, commit messages, docs, `CHANGELOG.md`, checkpoints and memory stay normal prose.
- **Ponytail in plans and reviews.** A plan leads with the minimal version and names what it skips; a review flags over-engineering.
- **The main session dispatches; agents never spawn agents.** Dispatch honestly: named agents are candidates, not a quota. Before parallel Rust + frontend work, freeze each struct in both languages and a per-command table of Rust param ↔ JS arg names.
- **Multi-agent runs checkpoint to disk:** whoever dispatches keeps `.claude/checkpoints/<branch>/ledger.md` (briefs, owners, commits, user decisions; written before acting); each agent keeps its own checkpoint file and writes its report there before sending it. Resume from those files and `git status`, never from context. (`agent-checkpoints.md`)
- **Ownership is by file.** The ledger row lists the paths each task owns, one owner per file per wave. An agent edits only those paths and its checkpoint.
- **Agents make no git writes** (no add, commit, stash, restore, checkout, reset, tag or push). The main session commits per task with path-limited commits (`git commit -- <paths>`) after checking `git status` and `git log`, and never stages `src-tauri/gen/schemas/*.json` or a hunk the user made.
- **`[skip ci]` on every commit while the GitHub Actions quota is out.** For the commit that will be tagged, the main session asks the user.
- **Reviews roll.** The tech-lead reviews after each chunk and each fix batch, and every fix batch is re-checked (fix batches have brought regressions). A UX acceptance (`docs/ux/NN-vX.Y.Z-acceptance.md`) runs before the release commit. The release commit is last, then a local annotated tag; pushing is the user's call.
- **Resume after a session limit:** SendMessage to the same agent ID first; if that fails, a fresh agent of the same type reads the ledger and its checkpoint (`agent-checkpoints.md` → Resume).
- **Never route around an auto-mode classifier denial** (no other command, tool or wording for the same action). Stop that action and report it to the main session, which asks the user.

## Testing

- `npx vitest run` (same as `npm test`): Vitest (`node` env, `src/**/*.test.ts(x)`). Every pure helper ships with a `*.test.ts` beside it. Agents run `npx vitest run` with no pipe or redirect: the RTK hook rewrites only that form (to `rtk vitest`), never `npm test`.
- `node --experimental-strip-types scripts/check-emit.ts` (Node 22.11): React-free serialisers, patch and quantity helpers (cannot strip JSX).
- `cargo test --lib` in `src-tauri`: pure Rust functions, no cluster needed. Windows: use the MSVC `PATH` recipe above. `kubeconfig::tests::accepts_absolute_paths` fails on Windows only (pre-existing).
- Live checks so far come only from the kind harness (`make live`); `open-items.md` → "Live harness ledger" lists what it observed and the rows only a real cluster can close.
- `make live` runs the live harness against a throwaway kind cluster (needs Docker); on macOS and Linux `scripts/live/run.sh` directly (`live-verification.md`).
- GitHub CI (`.github/workflows/`, contract in `docs/build-and-release.md` → GitHub Actions) runs the commands above plus `cargo clippy` and `cargo deny check` (policy `src-tauri/deny.toml`). Actions are pinned to commit SHAs; keep new ones pinned.
- v1.4.1 Rust tests: `secret_sizes`; `redact_values`, `mask_rendered_secrets`, `reject_redacted`, `install_output`, `decode_helm_release` (`helm.rs`); `mask_last_applied`; `rule_matches`, `compute_who_can`, `compute_permissions`, `subject_list` (`rbac.rs`); `find_unused`; `journal_summary`, `entry_line`, `page` (`journal.rs`); `match_deprecations`, `manifest_findings`, `last_applied_finding` and the embedded-table parse (`deprecations.rs`).
- v1.4.1 TS tests: `secretReveal`, `secretCache` (`secretReadOptions` / `forgetSecret` / `forgetHelmValues` on a real `QueryClient`), `journal`, `whoCan`, `unused`, `deprecations`, `savedSearches`, plus additions to `mergePreview`, `diffRows`, `permissionHints`.
- v1.4.2 TS tests (no Rust change): `themeTokens`, `clusterIdentity`, `appearance`, `terminalTheme`. The first and last read `src/index.css` and `tailwind.config.js` as text.
- v2.1.2 tests: Rust proxy helpers in `commands/context.rs` (`proxy_*`, `display_proxy`, `effective_proxy`, delimiter and port rejection), the URL-userinfo rule in `app_log.rs` (`scrub_*`), `live::tests` (`src-tauri/src/live/mod.rs`); TS `proxyLabel`.
- v2.1.3 tests: Rust `launch::tests` (parser, kind table, help names, namespace validation), `commands::launcher::tests` (take rule), `commands::cli::tests` (`CliStatus` rows, `plan_install`, quoting); TS `launchArgs`, `cliStatus`, `updateState` (Windows notice), `writeBackstop` (`install_cli_command` exempt). The `cfg(unix)` code needs a check on macOS and Linux (`open-items.md`).
- v2.2.0 tests: Rust `map::tests` (each edge function, `limit_component`, the injected root-CA ConfigMap, forbidden Secrets, `ready_endpoints`), `netpol::tests` (peer shapes, ports, defaulted `policy_types`, `pod_labels`), plus the R3 additions (`last_timestamp` fallback in `cluster_info.rs`, `revision_info` `created_at`, `JournalFilter` in `journal.rs`); TS `graphLayout`, `resourceMap`, `netpolEval`, `timeline`, and the `journalResourceType` additions to `journal`.
- v2.3.0 tests: Rust `observability::tests` (`proxy_path`, `classify`, `read_capped`, `valid_tenant`, discovery rules and reasons, sort order), `prometheus::tests` (each template, `parse_matrix`, caps, `outcome`, per-flavour classifiers), `logs_backend::tests` (presets, queries, Loki and VictoriaLogs parsing); TS `observability`, `metricChart`, `segmented`, `lineage`, `focusBanner` (`resourceMap`), `elbow`, `spreadLabels`, `clampToGap` and the routing invariant (`graphLayout`), plus additions to `clusterIdentity`, `logSource` and `rightSizing`.
- v2.3.1 tests (TS only, no Rust change): `tableRows`, `yamlFind`, `platform`, plus additions to `resourceMap` (the kind filter helpers, and `prepareMap` grouping pods before hiding kinds).
- v2.4.0 tests: Rust `namespaces::tests` (`namespace_row`: Active, Terminating conditions in order, defaults, serialised field names), the `convert_pod` additions in `pods.rs` (`service_account`, `conditions` order and defaults), the `ns` rows in `resource_edit.rs` (`gvk_for` aliases, `cluster_scoped_set_is_exactly_the_null_namespace_kinds`), `last_commit_display_rules`, `history_entry_message_rules` and `operation_message_display_rules` (`argocd.rs`, module `rollback_tests`), and the `ns` kind tokens in `launch::tests`; TS `namespaces`, `podStatus`, `podTableView`, `argoStatus` (with `argoOperationNote` and `isArgoOperationMessageCut`), `argoHistory`, plus additions to `scope` (`ns` cluster-scoped), `launchArgs` (kind `ns`) and `timeline` (an ArgoCD entry keeps only the first line of its commit message).

## Requirements

Rust stable ≥ 1.90; Node ≥ 22.6; tauri-cli v2 (`cargo install tauri-cli --version "^2.0"`).

## Detailed docs: read before touching the area

Per-feature contracts live in `docs/claude/`. Most carry "do not simplify this back" rules not repeated here. A "see <Section>" pointer in code or docs resolves with `grep -rn "^#.* <Section>" docs/claude/`.

| Touching… | Read |
|---|---|
| Where a file lives | `key-files.md` |
| Resource kinds, per-kind tables, cluster scope | `resource-types.md` |
| Pods, containers, logs (filters, JSON, multi-pod narrowing), shell, debug containers, metrics | `pods-logs.md` |
| TopBar, panels, ⌘K, `ConfirmModal`, keyboard/Esc, cluster identity, theme/accent/colour tokens, read-only/guardrails, Settings, compare, field managers, app views (Journal, Who can, Health pages), resource map (incl. the Kinds filter), NetworkPolicy view, change timeline, YAML find (`⌘F` / `Ctrl+F` in the YAML views) | `ui.md` |
| Create/edit forms, `patch.ts`, validators, merge-from-file, delete, neat YAML, TLS, previews, diff rows, kubectl equivalents, rollout diff, Secret values in the webview | `writes.md` |
| App log, Diagnostics, action journal (`app_log.rs`, `journal.rs`, `commands/diagnostics.rs`) | `diagnostics.md` |
| Helm (incl. redacted Values, release decoding) | `helm.md` |
| ArgoCD | `argocd.md` |
| Kubeconfig, auth plugins, trust banner, `can_i`, who can / subject permissions | `cluster-access.md` |
| Node drain / eviction | `node-drain.md` |
| External observability: Prometheus / Loki / VictoriaLogs through the service proxy, metric and log history, the observability dialog, node selectors, caps (`observability.rs`, `prometheus.rs`, `logs_backend.rs`) | `pods-logs.md` (External observability), `ui.md` (Observability dialog) |
| Health: Problems, capacity, API presence, right-sizing, Constraints, Possibly unused, Deprecated APIs (`presence.rs`, `problems.rs`, `capacity.rs`, `unused.rs`, `deprecations.rs`) | `health.md` |
| Live harness (`make live`, `scripts/live/`, `src-tauri/src/live/`) | `live-verification.md` |
| Command-line launcher (`garita`), single instance, Settings → Command line, per-OS command install, Windows PATH hooks | `launcher.md` |
| Live-verification ledger, open bugs, deferred work | `open-items.md` |
| Multi-agent runs: checkpoint files, run ledger, resume after a session limit, snapshot hook | `agent-checkpoints.md` |

`docs/impl/`, `docs/ux/` and `docs/plan-*.md` are release plans and UX specs. Read one only when a task or code comment names it. Documents dated before v2.0.0 refer to the product by its former name, Watchtower.

<!-- rtk-instructions v2 -->
# Command output

Command output here is condensed to save tokens, keeping every signal and
dropping costly noise. Treat it as the complete result: run commands
normally, and batch related commands into one call to avoid extra turns.
Truncated results state their recovery path in their own output. Re-run a
command as `rtk proxy <cmd>` only when its result is unusable: empty when
output was clearly expected, contradicting its exit code, or garbled.
<!-- /rtk-instructions -->