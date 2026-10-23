# Garita — System Architecture

A short map for humans. Contracts and "do not simplify" rules live in `docs/claude/` (start with `key-files.md`); they win on any conflict with this page.

## Data flow

```
 Kubernetes cluster: kube-apiserver, metrics.k8s.io, CRDs (argoproj.io, Flux, Gateway API, cert-manager)
        │ HTTPS, kubeconfig auth (exec plugins resolved to absolute paths)
        ▼
 Rust backend (src-tauri/)
   lib.rs            fix_path() at startup; Tauri builder; generate_handler![…];
                     .manage(PortForwardState, ShellState)
   commands/utils.rs client_for_context() (cached kube::Client per context),
                     resolve_command(), invalidate_client_cache(), namespaced_or_all!
   commands/*.rs     #[tauri::command] async fn … -> Result<T, String>
   app_log.rs        scrubbed, rotating support log
        │ Tauri IPC: invoke (request/response), Channel (log streams), events (shell)
        ▼
 React frontend (src/)
   App.tsx                 QueryClientProvider; top-level state (activeResource, namespace,
                           selection, mainView)
   hooks/useResources.ts   every useQuery / useMutation; invokeWrite (read-only backstop);
                           startLogStream
   components/             Sidebar, TopBar, PodTable, DetailPanel, ResourceViews,
                           ResourceDetailPanel, create/, edit/, health/
```

## IPC paths

**Invoke.** Hooks call `invoke("verb_noun", { context, … })`; args are camelCase and Tauri maps them to snake_case. Errors arrive as plain strings.

**Log streams.** Each `stream_pod_logs` call gets its own `Channel<LogStreamEvent>` (`line` / `end` / `error`). Clearing `channel.onmessage` makes the next `send()` fail and the Rust task exits. Never move logs to a global event (that mixed pods' output before v0.8.1).

**Shell.** `start_shell_session` (exec or attach) streams output with `app.emit("shell-output-{id}")` and reports the close reason on `shell-closed-{id}`. The client generates the id and listens before invoking. Input and resize go through `write_to_shell` / `resize_shell`.

**Guided edit.** `get_resource_json` (raw object) → form mutates a clone → `mergePatch` → `patch_resource` (`Patch::Merge`). See `docs/claude/writes.md`.

## kube-rs client

`client_for_context(context)` in `commands/utils.rs`:

1. Return the cached client if present.
2. Load the union of the default kubeconfig and enabled registered files (`load_merged_kubeconfig()`); never write any of them.
3. Replace relative exec-plugin commands with absolute paths (`resolve_command`: login-shell lookup, then known install paths, cached).
4. `Config::from_custom_kubeconfig` with the context, `Client::try_from`, cache, return.

kube-rs refreshes tokens itself and runs exec plugins lazily on the first request. Every kubeconfig-registry mutation calls `invalidate_client_cache()`.

## Directory layout

```
src/
  App.tsx, types/k8s.ts, hooks/, utils/ (pure helpers, each with *.test.ts)
  components/ (views, panels, dialogs), components/create/, components/edit/, components/health/
src-tauri/
  src/lib.rs, src/app_log.rs, src/commands/<domain>.rs
  capabilities/default.json
docs/claude/      per-area contracts (read before editing an area)
docs/impl/, docs/ux/, docs/plan-*.md   release plans and UX specs (dated records)
```

File-by-file map: `docs/claude/key-files.md`. Build and release: `docs/build-and-release.md`. Auth and `PATH`: `docs/cluster-auth.md`.
