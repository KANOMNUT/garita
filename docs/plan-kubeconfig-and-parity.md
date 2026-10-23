# Kubeconfig lifecycle, trust states, daily workflow, coverage — implementation plan

**Status:** frozen contract. Written to be executed by `@rust-engineer` and `@frontend-engineer` **in parallel**.
The two agents cannot negotiate the IPC boundary mid-flight, so every command name, every parameter
(Rust name → JS name), and every return struct in this document is **frozen before either starts**.

**Companion reading, in order:** `CLAUDE.md` (authoritative, carries several "do not simplify this back"
contracts), then `docs/plan-guided-edit.md` §3–4 for the existing patch/edit contract this plan reuses.

**Ground rule inherited from CLAUDE.md:** a Tauri v2 `invoke()` with a **bare `bool`** parameter errors
`"missing required key <name>"` when the arg is absent. Every additive/optional parameter in this document
is `Option<T>`. This shipped as a real bug twice (`create_resource_from_yaml`, `patch_resource`).

**Param naming:** Tauri v2 camelCases snake_case Rust params. Verified in-repo:
`resource_type` → `resourceType`, `dry_run` → `dryRun`, `context_name` → `contextName`
(`useResources.ts:483`, `:996`). Every command table below carries **both** columns.

**Green-tree gate at the end of every phase:** `cargo check` **and** `npm run build` (`tsc && vite build`)
**and** `node scripts/check-emit.ts`. Each phase is independently shippable.

---

## 0. Sizing, order, and what is cut

| Phase | Content | Size | Rust | Frontend |
|---|---|---|---|---|
| 1 | Kubeconfig lifecycle + de-anchoring | **M** — highest risk | ~450 LOC, 1 new dep | ~400 LOC, 1 new dep |
| 2 | Trust states + cluster identity | **S** | ~150 LOC | ~200 LOC |
| 3 | Daily workflow (4 features; updater deferred) | **L** | ~500 LOC | ~600 LOC |
| 4 | Coverage (6 kinds + CRD tree) | **M** — mechanical | ~400 LOC | ~450 LOC |

Phase 1 is the highest risk in the plan because it modifies `client_for_context()`
(`src-tauri/src/commands/utils.rs:141`), which **every** Tauri command routes through. Nothing else in
this plan touches that function. Land Phase 1 alone, verify against a live cluster, then proceed.

**Cut or deferred — stated with cost, not silently narrowed. See §6.**
Tauri auto-updater (deferred to its own release), `helm repo add/remove/update` (cut), Leases (cut),
simultaneous multi-cluster views (out of scope, as instructed).

---

## 1. Phase 1 — Kubeconfig lifecycle + de-anchoring

### 1.1 The problem, restated from verified code

- `switch_context` (`commands/context.rs:42`) rewrites `current-context:` **in the user's real kubeconfig
  on disk**. In-app cluster selection mutates global kubectl state.
- `kubeconfig_path()` (`context.rs:59`) returns only the **first** `$KUBECONFIG` entry, while
  `Kubeconfig::read()` **merges all of them** — so switching to a context defined in file #2 edits file #1,
  a file that does not define it.
- `set_current_context_in_yaml` (`context.rs:77`) is a line-based rewrite: `lines.join("\n")` drops the
  trailing newline and flattens CRLF on Windows.
- **The write is unnecessary.** Every Tauri command already takes `context: String` as its first param and
  `client_for_context()` resolves it via `KubeConfigOptions`. Only `switch_context` + `get_current_context`
  anchor the app to disk.

### 1.2 The single most important architectural rule in this plan

> **Never merge an imported kubeconfig into `~/.kube/config`. The user's own file is read-only to us.**

The default implementation of "add a kubeconfig" is to merge into the user's file. That would reintroduce
exactly the side effect this phase exists to remove. Instead: an **app-local registry of kubeconfig paths**,
and `client_for_context` builds from the **union** of default + registered.

### 1.3 Merge semantics — verified against kube-client 0.95 source, not assumed

`Kubeconfig::merge(self, next)` (`file_config.rs`) calls `append_new_named(&mut self.contexts, next.contexts, …)`,
which is:

```rust
next.into_iter().filter(|x| !existing.contains(f(x)))
```

**First-wins by name.** Also `self.current_context = self.current_context.or(next.current_context)`.

**Frozen rule for duplicate context names across files:**
merge order is **default kubeconfig first, then registered entries in registration order**; on a name
collision the **earlier file wins** (kubectl-compatible). The loser is not dropped from the UI — it is
surfaced as `shadowed_sources` on the `KubeContext` row so the user can see why "their" context resolves
to a different cluster.

**The merge is per-name, per-section — not per-file.** `append_new_named` runs *independently* over
`clusters`, `auth_infos` and `contexts`. So a context can win from file A while the **cluster it names**
wins from file B, if both files define a cluster of that name. Therefore `KubeContext.source` is the origin
of the **context entry**, not necessarily of the cluster or the credentials. The provenance UI must not
claim more than that — label it "context defined in", not "cluster from".

**FROZEN — the enabled set is the only set.** `list_contexts` reflects the **enabled** union only:
- a context defined **only** in a disabled file does **not** appear in `list_contexts`;
- a disabled file never contributes a `shadowed_sources` entry;
- `list_kubeconfigs` still lists disabled files (with their `contexts`, read individually) — that is what
  the toggle UI reads. The two commands answer different questions and their sets differ on purpose.

This also settles the disable-the-active-context case: §1.6's validation cascade tests membership in
`list_contexts()`, i.e. the **enabled** set, so disabling a file that defines the active context falls back
to the next resolvable one rather than leaving a context selected that `client_for_context` cannot build.

**Required unit test (no cluster needed), `#[cfg(test)]` in `kubeconfig.rs`:** merge two in-memory
`Kubeconfig`s that share a context name, assert the base's cluster/user survive. This locks the claim above
in CI rather than leaving it as a documented assumption.

### 1.4 The paste-vs-file asymmetry — verified, and it is a real trap

`Kubeconfig::read_from(path)` **remaps relative file references to absolute**, using the kubeconfig's own
parent directory: `certificate-authority`, `client-certificate`, `client-key`, `token_file`
(kube-client 0.95 `file_config.rs`, `read_from`).

Therefore:
- **File-picker import is safe.** Relative refs resolve against the picked file's directory.
- **Paste-YAML import is NOT.** There is no meaningful base directory, so a relative
  `client-key: ./certs/user.key` resolves against the app config dir and fails opaquely at first request.

**Frozen validation rule for the paste path only:** reject a pasted kubeconfig containing a **relative**
value in any of `certificate-authority`, `client-certificate`, `client-key`, `tokenFile`. Absolute paths
and inline `*-data` fields are fine. The error message names the offending field and context.
`exec.command` is exempt — `resolve_command()` in `utils.rs` already handles bare binary names.

Both `preview_kubeconfig_yaml` and `add_kubeconfig_yaml` run this check. **Never trust a two-step check** —
the preview is advisory; the add re-validates.

### 1.5 `switch_context` — decision: **delete it**

Grepped: `switch_context` has exactly one call site — `useSwitchContext` in `useResources.ts:36`, used
once in `App.tsx:55`. Nothing else depends on it.

**Delete `switch_context`, `set_current_context_in_yaml`, and `kubeconfig_path()`.** Deleting removes
findings 1.1's bugs #2 and #3 as *bug classes* rather than fixing them — −56 lines, three bugs gone.
Fixing them would mean writing a correct YAML round-tripper for a side effect the app should not own.

Cost, stated: a user who relied on Watchtower changing their kubectl default must now run
`kubectl config use-context <name>` themselves. Mitigation is a **string with a copy button** in the
context switcher showing that exact command. That is text on a button — it does **not** shell out and does
**not** violate the immutable "no kubectl dependency" decision.

`get_current_context` is **kept**, read-only, demoted to one job: seeding the app-local active context on
first launch. `list_contexts` is **kept** with a modified return shape (§1.7).

### 1.6 Persistence choice: `localStorage`

**`localStorage`, not the Tauri store plugin** — the codebase already persists UI state there
(`detail-panel-width`, `columns-<resourceType>`), so it is zero new dependency and zero new pattern.
The *registry* of kubeconfig paths lives Rust-side (§1.8) because `client_for_context` needs it and takes
only `context: String`.

**The stored active context MUST be validated on load.** A stored name whose kubeconfig was since removed
makes every hook fire against a dead context and the app looks broken at launch. Resolution order:
stored value **if present in `list_contexts()`** → `get_current_context()` **if present in `list_contexts()`**
→ first available → `""` (all hooks are already `enabled: !!context`-guarded).

### 1.7 Frozen structs

```rust
// src-tauri/src/commands/kubeconfig.rs  (NEW FILE)
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct KubeconfigEntry {
    pub path: String,            // absolute
    pub source: String,          // "default" | "registered"
    pub enabled: bool,           // the default entry is always true
    pub app_owned: bool,         // true = pasted YAML we wrote into the app config dir
    pub contexts: Vec<String>,   // contexts THIS FILE defines, read pre-merge
    pub error: Option<String>,   // unreadable/invalid -> Some(msg), contexts empty
}
```

```rust
// src-tauri/src/commands/context.rs  (MODIFIED)
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct KubeContext {
    pub name: String,
    pub cluster: String,
    pub user: String,
    pub is_kubeconfig_default: bool,   // RENAMED from `is_current`
    pub source: String,                // abs path of the file whose CONTEXT entry won (see §1.3:
                                       // the cluster/auth entries may have won from a different file)
    pub shadowed_sources: Vec<String>, // other ENABLED files defining this name; empty when unique
}
```

**`is_current` is renamed to `is_kubeconfig_default` deliberately.** After de-anchoring it means "your
kubectl default", while the UI has a *separate* "active in Watchtower" marker driven by local state.
Leaving the old name guarantees the frontend renders the checkmark from the wrong field.

```ts
// src/types/k8s.ts
export interface KubeconfigEntry {
  path: string;
  source: "default" | "registered";
  enabled: boolean;
  app_owned: boolean;
  contexts: string[];
  error: string | null;
}

export interface KubeContext {           // MODIFIED — existing interface
  name: string;
  cluster: string;
  user: string;
  is_kubeconfig_default: boolean;        // was: is_current
  source: string;
  shadowed_sources: string[];
}
```

Field names stay snake_case — serde default naming, matching every other struct pair in `k8s.ts`.

### 1.8 Frozen commands

| Command | Rust params | JS args | Returns |
|---|---|---|---|
| `list_contexts` | *(none)* | `{}` | `Vec<KubeContext>` — **shape changed** |
| `get_current_context` | *(none)* | `{}` | `String` — unchanged |
| ~~`switch_context`~~ | — | — | **DELETED** |
| `list_kubeconfigs` | *(none)* | `{}` | `Vec<KubeconfigEntry>` |
| `preview_kubeconfig_path` | `path: String` | `{ path }` | `KubeconfigEntry` |
| `preview_kubeconfig_yaml` | `yaml: String` | `{ yaml }` | `KubeconfigEntry` |
| `add_kubeconfig_path` | `path: String` | `{ path }` | `KubeconfigEntry` |
| `add_kubeconfig_yaml` | `yaml: String, name: String` | `{ yaml, name }` | `KubeconfigEntry` |
| `remove_kubeconfig` | `path: String` | `{ path }` | `()` |
| `set_kubeconfig_enabled` | `path: String, enabled: bool` | `{ path, enabled }` | `()` |

**Deliberately four commands, not two with `Option` unions.** `add_kubeconfig(path: Option, yaml: Option, name: Option)`
would force the frontend agent to guess the both-set and neither-set behaviour. One command per shape.

Notes the rust-engineer must honour:
- `preview_*` **never** writes anything and **never** mutates the registry.
- `add_kubeconfig_yaml` writes to `<app_config_dir>/kubeconfigs/<sanitised-name>.yaml` with **mode 0600 on
  unix** (we are writing credentials to disk), then registers that path with `app_owned: true`.
  `<sanitised-name>`: `[-._a-zA-Z0-9]` only, non-matching chars replaced with `-`, collision-suffixed.
- `remove_kubeconfig` **de-registers only. It never deletes a file from disk** — not the user's, not our own.
  De-registering an `app_owned` file leaves it recoverable through the file picker.
- `set_kubeconfig_enabled` on the `"default"` entry is a no-op returning `Ok(())`; the default kubeconfig is
  always in the union.
- **Every command that mutates the registry calls `invalidate_client_cache()`** (already exported from
  `utils.rs:25`). Missing this is a silent staleness bug — the old client keeps serving.

### 1.9 Rust task list — `@rust-engineer`

1. **New `src-tauri/src/commands/kubeconfig.rs`.**
   - `static CONFIG_DIR: OnceLock<PathBuf>` + `pub fn init_config_dir(app: &tauri::AppHandle)`, called from
     a `.setup(…)` closure in `lib.rs::run()`. **Reason:** `client_for_context()` lives in `utils.rs` and has
     no `AppHandle`; resolving the dir once at startup keeps the registry reachable from there without
     threading `AppHandle` through 80 command signatures.
   - Registry file `<app_config_dir>/kubeconfigs.json`:
     `{ "entries": [ { "path": "...", "enabled": true, "app_owned": false } ] }`.
     Missing file = empty registry (first run), **not** an error.
   - `pub fn load_merged_kubeconfig() -> anyhow::Result<Kubeconfig>` —
     `Kubeconfig::read()` (honours `$KUBECONFIG` merge) then `.merge(Kubeconfig::read_from(p)?)` for each
     **enabled** registered entry in order.
     **A broken/deleted registered entry is skipped, not fatal** — one bad file must not break every command
     in the app. Its error surfaces through `list_kubeconfigs`, which reads each file individually.
   - Validation helper shared by preview + add (§1.4).
   - The four preview/add commands, `list_kubeconfigs`, `remove_kubeconfig`, `set_kubeconfig_enabled`.
   - `#[cfg(test)]`: (a) the duplicate-name merge test from §1.3; (b) relative-path rejection for each of the
     four fields; (c) absolute paths and inline `*-data` pass.
2. **`utils.rs`:** in `client_for_context()`, replace `Kubeconfig::read()?` with
   `super::kubeconfig::load_merged_kubeconfig()?`. **Leave the exec-path patching loop and the client cache
   exactly as they are** — both must keep working (`resolve_command` is what makes GKE/EKS/AKS auth plugins
   resolvable from a Finder-launched `.app`).
3. **`context.rs`:** rewrite `list_contexts` to build from `load_merged_kubeconfig()` for the winning row,
   and to read each **enabled** file individually for `source` / `shadowed_sources`. **Disabled files are
   excluded from both** — see the FROZEN note in §1.3; `list_kubeconfigs` is the command that sees them.
   Rename `is_current` → `is_kubeconfig_default`. **Delete** `switch_context`,
   `set_current_context_in_yaml`, `kubeconfig_path()`.
4. **`lib.rs`:** `mod` + `use` + `generate_handler![]` for the 7 new commands; remove `switch_context`;
   add the `.setup()` call for `init_config_dir`.
5. **`Cargo.toml`:** `tauri-plugin-dialog = "2"`; `.plugin(tauri_plugin_dialog::init())` in `run()`.
6. **`capabilities/default.json`:** add `"dialog:allow-open"`.

### 1.10 Frontend task list — `@frontend-engineer`

1. **`package.json`:** `@tauri-apps/plugin-dialog`.
2. **`src/types/k8s.ts`:** add `KubeconfigEntry`; modify `KubeContext` per §1.7.
3. **`src/hooks/useActiveContext.ts` (new, small).** `useState` + `localStorage["active-context"]`,
   with the load-time validation cascade from §1.6. Returns `[activeContext, setActiveContext]`.
4. **`src/hooks/useResources.ts`:**
   - **Delete `useSwitchContext`** (lines 36–52).
   - Add `useKubeconfigs()` (`queryKey: ["kubeconfigs"]`, `staleTime: 30_000`).
   - Add `usePreviewKubeconfigPath/Yaml` (mutations, `retry: false` — one-shot fetches).
   - Add `useAddKubeconfigPath`, `useAddKubeconfigYaml`, `useRemoveKubeconfig`, `useSetKubeconfigEnabled`.
     **All four invalidate both `["kubeconfigs"]` and `["contexts"]`** on success.
   - Error display everywhere: `(error as any)?.message ?? String(error)`.
5. **`src/App.tsx`:** `currentContext` now comes from `useActiveContext()`. Delete the `switchContext`
   mutation, `switchError` state, and the `isSwitching` plumbing (switching is now synchronous).
   `onSwitch` becomes `setActiveContext(name)`. **Keep the existing `prevContextRef` effect** at `:108` —
   it already resets namespace/selection/search on context change and now fires on local state change.
6. **`src/components/ContextSwitcher.tsx`:**
   - Per-row provenance: source file **basename**, full path in `title`. Label it **"context defined in"** —
     not "cluster from" (§1.3: the cluster entry may have won from a different file).
   - Duplicate badge when `shadowed_sources.length > 0`, listing the shadowed files, with the first-wins rule
     spelled out in the tooltip.
   - New **Kubeconfigs** section: list `useKubeconfigs()` rows (path, context count, enabled toggle,
     Remove); "Add from file…" (`open()` from `@tauri-apps/plugin-dialog`, filters `yaml`/`yml`/`config`/`*`)
     and "Paste YAML…" — both routed through a preview step showing the contributed contexts and any
     collisions **before** commit. Entries with `error !== null` render the message inline.
   - `kubectl config use-context <name>` copy button (§1.5).
   - **Delete the `⌘N add kubeconfig` line in the footer** (line 175). It is currently a lie — the global
     ⌘N opens `ResourceCreator`. Replace with a visible "+ Add kubeconfig" button. Deletion over addition.
   - The active-context checkmark reads **the app's active context**, never `is_kubeconfig_default`.
     Render `is_kubeconfig_default` as a separate muted "kubectl default" tag if useful.

### 1.11 The one ordering constraint

`switch_context` is a **one-way dependency, not an atomic co-land**:

1. Frontend stops calling it (delete `useSwitchContext`, switch to local state).
2. **Then** Rust deletes the command.

Between the two, the command exists and is unused — harmless. The reverse order leaves a rejected
`invoke()` promise in the switcher. (An unknown Tauri v2 command **rejects the promise**; it does not panic.
The hazard is a broken switcher, not a crash.)

Everything else in Phase 1 is fully parallel: the frontend builds against §1.7/§1.8 from minute one.

---

## 2. Phase 2 — Trust states

### 2.1 Cluster access probe

```rust
// src-tauri/src/commands/cluster_info.rs (append) — reuses client_for_context
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ClusterAccess {
    pub state: String,                  // "ok" | "unreachable" | "auth" | "forbidden" | "unknown"
    pub message: String,                // human-readable, already formatted
    pub server_version: Option<String>, // Some only when state == "ok"
}
```
```ts
export interface ClusterAccess {
  state: "ok" | "unreachable" | "auth" | "forbidden" | "unknown";
  message: string;
  server_version: string | null;
}
```

| Command | Rust params | JS args | Returns |
|---|---|---|---|
| `check_cluster_access` | `context: String` | `{ context }` | `ClusterAccess` |

**It returns `Ok` even for failures — the *state* is the payload.** `Err` is reserved for something
structurally broken (the context is not defined in any kubeconfig). A command that returns `Err` for an
unreachable cluster gives the frontend a red error box identical to a bug.

Classification, using `Client::apiserver_version()` (verified present at kube-client 0.95
`src/client/mod.rs:374`):

| Signal | `state` |
|---|---|
| `client_for_context()` fails (exec plugin non-zero, missing binary, bad context) | `auth` |
| `apiserver_version()` → `Ok` | `ok` + version |
| `kube::Error::Api(ae)` with `ae.code == 401` | `auth` |
| `kube::Error::Api(ae)` with `ae.code == 403` | `forbidden` |
| connect / DNS / TLS / timeout errors | `unreachable` |
| anything else | `unknown` |

**Reuse, do not duplicate, the provider-specific hint bank.** `friendly_helm_error()` (`helm.rs:85`)
already maps GKE/EKS/AKS auth failures to install instructions. Move its message-matching core to
`utils.rs` as `pub(crate) fn friendly_auth_error(msg: &str) -> Option<String>` and call it from **both**
`friendly_helm_error` and `check_cluster_access`. `helm.rs`'s observable behaviour must not change.

Frontend: `useClusterAccess(context)` — `staleTime: 15_000`, `refetchInterval: 60_000`, `retry: false`.
Renders a dismissible banner above the content area whenever `state !== "ok"`, carrying `message`.

### 2.2 The one provably-reachable "forbidden reads as empty"

`list_services` (`networking.rs`), all-namespaces fallback path:

```rust
let svc_api: Api<K8sSvc> = Api::namespaced(client.clone(), &ns_name);
if let Ok(list) = svc_api.list(&ListParams::default()).await {
    result.extend(list.items.into_iter().map(convert_service));
}
```

Every per-namespace failure is silently dropped. If **all** namespaces are forbidden, the function returns
`Ok(vec![])` — an empty table indistinguishable from "this cluster has no Services". This is a **named,
specific task**, not a general audit:

> Count `attempted` and `succeeded`. If `attempted > 0 && succeeded == 0`, return
> `Err(format!("Failed to list services: forbidden in all {} namespaces", attempted))`.
> Partial success still returns `Ok` — a partial list is genuinely useful and the alternative is worse.

**Knowingly kept, do not "fix":** `list_pod_metrics` (`pods.rs:1024`) swallows *all* errors to `Ok(Vec::new())`.
It feeds sparklines only, and the metrics-API-absent case is the documented graceful contract.
The 404-to-empty arms in `flux.rs`, `gateway.rs`, `certmanager.rs` are also correct — they mean "CRD not
installed", which genuinely is an empty result. They already let 401/403 through as `Err`.

### 2.3 Cluster identity — prod-accident guard. **Zero Rust.**

- **`src/utils/clusterIdentity.ts` (new).** `localStorage["cluster-identity"]` →
  `Record<contextName, { color: string; label: string }>`; export `useClusterIdentity(context)`.
  **Colors come from the existing `tailwind.config.js` design tokens** — do not invent a palette.
  `label` defaults to the context name.
- Surfaces: the Sidebar context chip (`Sidebar.tsx`, the `initials` badge background), `TopBar` (a colored
  left rule), `ContextSwitcher` (per-row swatch + the editor for color/label).
- **Destructive-action surfacing goes through `ConfirmModal` — the single existing choke point.**
  Add optional `contextLabel?: string` + `contextColor?: string` props and pass them at every call site:
  `PodTable` (bulk + row delete), `DetailPanel` (pod delete), `ResourceDetailPanel` (delete, node drain,
  node delete), `WorkloadActions` (scale-to-zero, rollback), `ArgoCdActionBar` (sync/prune),
  `GenericResourceTable`'s row delete. One prop pair, ~8 call sites — no new modal component.

### 2.4 Parallelization

`check_cluster_access` + the `list_services` fix are **Rust-only**. Cluster identity is **frontend-only,
zero Rust**. The only shared surface is the `ClusterAccess` struct in §2.1. Fully parallel.

---

## 3. Phase 3 — Daily workflow

Four features, mutually independent — they can be split across the two agents in any order.
The auto-updater is **deferred**; see §6.1.

### 3.1 Merge-from-file with a change preview

**Naming decision, and it is load-bearing: this is NOT `kubectl apply`.**
`kubectl apply` performs a three-way merge and **prunes** fields the file removed. An RFC 7386 merge patch
does not. Server-side apply *would* match the semantics, and loses to the exact same argument that killed
it for guided edit (`CLAUDE.md` → Guided Edit → "Why not server-side apply": ArgoCD's application
controller is a field manager on every resource it manages, so SSA means constant conflicts or a
`force: true` clobber).

> **The UI says "Merge from file". The preview header says "These keys will be set:".**
> Never the word "Apply". This is free now and expensive after the UI ships.

**Rust — new `src-tauri/src/commands/apply_file.rs`, 2 commands.**

```rust
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct DocPreview {
    pub index: usize,                        // 0-based doc index within the file
    pub api_version: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,                   // "" for cluster-scoped
    pub action: String,                      // "create" | "update" | "error"
    pub live: Option<serde_json::Value>,     // null when action == "create"
    pub desired: serde_json::Value,          // the parsed document, verbatim
    pub error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ApplyResult {
    pub index: usize,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub action: String,   // "created" | "updated" | "failed"
    pub message: String,
}
```
```ts
export interface DocPreview {
  index: number; api_version: string; kind: string; name: string; namespace: string;
  action: "create" | "update" | "error";
  live: Record<string, any> | null;
  desired: Record<string, any>;
  error: string | null;
}
export interface ApplyResult {
  index: number; kind: string; name: string; namespace: string;
  action: "created" | "updated" | "failed";
  message: string;
}
```

| Command | Rust params | JS args | Returns |
|---|---|---|---|
| `preview_yaml_documents` | `context: String, yaml: String` | `{ context, yaml }` | `Vec<DocPreview>` |
| `apply_yaml_documents` | `context: String, yaml: String, dry_run: Option<bool>` | `{ context, yaml, dryRun }` | `Vec<ApplyResult>` |

**Frozen implementation rules:**

- **GVK → plural comes from the discovery API. NEVER from `kind_to_plural`.**
  `kube::discovery::oneshot::pinned_kind(&client, &GroupVersionKind) -> (ApiResource, ApiCapabilities)`
  (verified at kube-client 0.95 `src/discovery/oneshot.rs:104`). `ApiCapabilities.scope` also gives
  namespaced-vs-cluster, so we stop inferring scope from whether `metadata.namespace` happens to be present.
  An arbitrary user file contains arbitrary kinds; a string-suffix rule is wrong for every irregular CRD
  plural and — proof — for `Endpoints`, which `kind_to_plural`'s `+s` fallback turns into `endpointss`.
  The durable rule: **resolve the plural from the server, never from a string rule.**
- **Separate one-line fix, independent of this feature:** add `"Endpoints" => "endpoints".to_string(),`
  to `kind_to_plural` in `utils.rs`. It is wrong *today* for `create_resource_from_yaml` and `argocd.rs`.
- Multi-doc split via `serde_yaml::Deserializer::from_str`. **Do not split on the literal string `---`** —
  it appears inside block scalars (this codebase already ships PEM blocks through YAML).
- Per doc: `api.get_opt(&name)` → `None` = create, `Some` = update.
  Apply: `create(&PostParams { dry_run, ..default }, &obj)` or
  `patch(&name, &PatchParams { dry_run, ..default }, &Patch::Merge(&desired))`.
- **One document's failure never aborts the batch.** Collect per-doc results — same partial-success shape as
  `useBulkDeletePods` and the ArgoCD bulk operations.

**Frontend:**

- **`src/utils/mergePreview.ts` (new) — React/JSX-free**, so `scripts/check-emit.ts` can import it under
  Node's native type-stripping (which strips types but **not** JSX). Same dependency direction as
  `create/emit.ts` and `edit/patch.ts`.
  `previewRows(live: unknown, desired: unknown): PreviewRow[]` where
  `PreviewRow = { path: string; from: string | null; to: string; state: "added" | "changed" | "unchanged" | "replaced" }`.
  Recursive walk of `desired` against `live`. **Arrays are leaf values and the state is `"replaced"`** —
  merge patch replaces arrays wholesale, and any row implying element-wise merge is a lie. Add a
  `check-emit.ts` case asserting exactly that on a `containers` array.
- **`src/components/MergeFromFileModal.tsx` (new).** `open()` from `@tauri-apps/plugin-dialog` (already added
  in Phase 1) plus a paste textarea; per-document accordion of `PreviewRow`s; **Dry run** and **Merge**.
  Reached from the TopBar `+New` overflow, not from `ResourceCreator` — the two do different things.
- Hooks `usePreviewYamlDocuments` / `useApplyYamlDocuments`, `retry: false`. On a non-dry-run success, call
  `qc.invalidateQueries()` **unfiltered** — a multi-kind file can touch anything, and enumerating
  `RESOURCE_QUERY_KEY` per result is more code for a worse guarantee.
- `usePatchResource`'s existing precedent applies: **skip invalidation when `dryRun` was requested**, and
  detect a backend that ignored the flag from the response text.

### 3.2 Multi-pod aggregated log tail — **zero Rust**

The v0.8.1 contract (per-invocation `Channel<String>`, never a global `emit`) is satisfied **by
construction**: the frontend opens one channel per pod and already knows which channel is which pod, so it
can prefix lines itself. No new command, no change to `stream_pod_logs`.

- **`src/components/MultiLogViewer.tsx` (new).** Props `{ context, namespace, pods: string[], container?: string }`.
  One `new Channel<string>()` per pod; each line rendered with a colored pod tag; appended to a bounded ring
  buffer (**cap 5000 lines** — an unbounded array is an OOM on a chatty deployment).
- **Cap at 20 pods**, with a visible notice when the workload has more. Reason: N concurrent backend tasks.
- **The effect deps must be a stable joined key — `pods.join(",")`, never the array itself.**
  `useWorkloadPods` refetches every 15 s and returns a **new array identity** each time; keying the effect on
  the array re-subscribes every 15 s and leaks N backend tasks per cycle. The single cleanup clears every
  channel's `onmessage` in one pass, which is what terminates the backend tasks.
- Surfaced as a **Logs** tab in `tabsFor()` for `deploy` / `sts` / `ds` / `jobs` / `cron`, fed by the
  existing `useWorkloadPods` — zero new data plumbing.

### 3.3 Helm install / rollback / history

```rust
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct HelmRevision {
    pub revision: i64,
    pub updated: String,
    pub status: String,
    pub chart: String,
    pub app_version: String,
    pub description: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct HelmRepo { pub name: String, pub url: String }
```
```ts
export interface HelmRevision {
  revision: number; updated: string; status: string;
  chart: string; app_version: string; description: string;
}
export interface HelmRepo { name: string; url: string }
```

| Command | Rust params | JS args | Returns |
|---|---|---|---|
| `list_helm_history` | `context: String, namespace: String, release: String` | `{ context, namespace, release }` | `Vec<HelmRevision>` |
| `rollback_helm_release` | `context: String, namespace: String, release: String, revision: i64` | `{ context, namespace, release, revision }` | `String` |
| `install_helm_release` | `context: String, namespace: String, release: String, chart: String, version: Option<String>, values_yaml: Option<String>, create_namespace: Option<bool>, dry_run: Option<bool>` | `{ context, namespace, release, chart, version, valuesYaml, createNamespace, dryRun }` | `String` |
| `list_helm_repos` | *(none)* | `{}` | `Vec<HelmRepo>` |

**Frozen rules:**

- All four reuse `helm_path()` and `friendly_helm_error()` from `helm.rs`. Immutable decision holds:
  Helm is shell-out only, `tokio::process::Command`, kube-rs is not used for Helm.
- **Arguments are passed as separate `.arg()` calls and NEVER joined into a shell string.** `chart` and
  `version` are user-supplied and reach a subprocess.
- `helm history -o json` and `helm repo list -o json` are parsed with serde. `helm repo list` exits non-zero
  when no repos are configured — that is `Ok(vec![])`, not an error.
- **`install_helm_release` must NOT use the release-secret chart extraction path**, and the code must carry a
  comment saying so. The v0.9.x contract ("upgrade extracts the chart from the K8s release secret, not
  `helm search repo`") is about **upgrading an existing release**. An install has no release secret yet, so a
  repo / OCI / local chart reference is required by definition. Anyone "unifying" the two paths breaks
  upgrade. `upgrade_helm_release` is not touched by this phase.
- `rollback_helm_release` invalidates `["helm-releases", context]`, `["helm-values", …]` and
  `["helm-history", …]`.

**Frontend:** `tabsFor("helm")` gains **History** → Overview / Values / History / Events (still no YAML tab).
Per-revision **Rollback** behind `ConfirmModal`, carrying the Phase 2 cluster label/color.
Install is a standalone `HelmInstallModal.tsx` reached from the Helm view's `+New` — **`helm` does not become
a `CreatableKind`** and does not enter the `CREATE_FORM` registry; a Helm install is not a K8s manifest.

### 3.4 `can-i` — SelfSubjectAccessReview

```rust
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct AccessCheck {
    pub group: String,      // "" for the core API group
    pub resource: String,   // PLURAL, e.g. "pods", "deployments"
    pub verb: String,       // "get" | "list" | "create" | "update" | "patch" | "delete"
    pub namespace: String,  // "" for cluster-scoped or all-namespaces
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct AccessResult { pub allowed: bool, pub reason: String }
```
```ts
export interface AccessCheck { group: string; resource: string; verb: string; namespace: string }
export interface AccessResult { allowed: boolean; reason: string }
```

| Command | Rust params | JS args | Returns |
|---|---|---|---|
| `can_i` | `context: String, checks: Vec<AccessCheck>` | `{ context, checks }` | `Vec<AccessResult>` |

**Frozen rules:**

- One **batched** command. `k8s_openapi::api::authorization::v1::SelfSubjectAccessReview`, POSTed via
  `Api::<SelfSubjectAccessReview>::all(client).create(&PostParams::default(), &ssar)`. Results returned in
  **input order**; concurrency via `join_all` (reuse the `search.rs` pattern).
- **Check per `(verb, resource, namespace)`, never per object.** RBAC is rarely `resourceNames`-scoped, and a
  per-row check on a 200-row table is 200 requests.
- **FAIL OPEN. This is not negotiable.** Only an explicit `allowed: false` greys anything out. If the `can_i`
  query itself errors — SSAR unavailable, aggregation layer down, network blip — **every action stays
  enabled**. A cluster where SSAR does not answer must not render a fully-disabled UI.
- **SSAR answers RBAC only.** Admission webhooks (Kyverno / OPA / Gatekeeper) can still deny a
  permitted request. Greying out is a **hint**, not a guarantee — **the confirm-and-fail error path stays
  exactly as it is.** Do not remove error handling on the grounds that "we already checked".

**Frontend:** `usePermissions(context, namespace, resourceType)` → `{ canDelete, canPatch, canCreate }`;
`staleTime: 5 * 60_000`, `retry: false`, `enabled: !!context`. Consumers: `GenericResourceTable`'s
`onDelete` gate (pass `undefined` to hide the column entirely when denied — the prop is already optional,
verified at `GenericResourceTable.tsx:30`), `ResourceDetailPanel`'s delete + pencil buttons,
`WorkloadActions`, `PodTable`'s bulk action bar. A denied button renders **disabled with a reason tooltip,
never hidden** — same principle as guided edit's immutable fields.

### 3.5 Parallelization within Phase 3

| Sub-feature | `@rust-engineer` | `@frontend-engineer` |
|---|---|---|
| 3.1 Merge-from-file | `apply_file.rs`, `kind_to_plural` fix | `mergePreview.ts`, `MergeFromFileModal`, hooks |
| 3.2 Multi-pod logs | **nothing** | `MultiLogViewer`, `tabsFor()` |
| 3.3 Helm | 4 commands in `helm.rs` | History tab, `HelmInstallModal`, hooks |
| 3.4 can-i | `can_i` command | `usePermissions` + ~5 consumer sites |

Fully parallel given the frozen structs above. 3.2 is frontend-only and can start immediately.

---

## 4. Phase 4 — Coverage

### 4.1 The per-kind tables — there are **five**, not four

`CLAUDE.md` documents four tables that must be kept in sync by hand. `resourceNamespace()` is a **fifth**,
documented separately, and it deliberately disagrees with `TopBar`'s `clusterScoped`. A kind missing from any
of them **degrades silently rather than failing to compile.**

| # | Table | File | Effect if the kind is missing |
|---|---|---|---|
| 1 | `get_resource_yaml` / `apply_resource_yaml` | `commands/pods.rs` | YAML tab errors |
| 2 | `delete_resource` | `commands/pods.rs` | Delete returns `unsupported resource type` |
| 3 | `gvk_for` | `commands/resource_edit.rs` | Guided edit + Patch return `Unsupported resource type` |
| 4 | `RESOURCE_QUERY_KEY` | `src/utils/resourceQueryKey.ts` | Refresh/invalidation **silently does nothing** |
| 5 | `resourceNamespace()` | `ResourceDetailPanel.tsx:1459` | Cluster-scoped kind sends a namespace on write paths |
| — | `clusterScoped` | `TopBar.tsx:49` | Namespace picker shown on a cluster-wide view (**a view predicate, not a scope predicate — deliberately a different set**) |

**No Phase 4 kind gets a create form or an edit form.** Per CLAUDE.md's hard rule
("no edit form for any kind that has no create form"), that means **table 3 (`gvk_for`) is untouched for all
six kinds**, and there are no `CREATE_FORM` / `EDIT_FORM` entries. Five tables in play, four touched.

### 4.2 Per-kind matrix — frozen

| kind | Rust file | API | Object scope | 1. YAML arms | 2. delete arm | 3. `gvk_for` | 4. QUERY_KEY | 5. `resourceNamespace` → null | `TopBar.clusterScoped` |
|---|---|---|---|---|---|---|---|---|---|
| `ep` Endpoints | `networking.rs` | `core/v1` typed | namespaced | yes | **no** | no | `endpoints` | no | no |
| `eps` EndpointSlice | `networking.rs` | `discovery.k8s.io/v1` typed | namespaced | yes | **no** | no | `endpointslices` | no | no |
| `rs` ReplicaSet | `workloads.rs` | `apps/v1` typed | namespaced | yes | yes | no | `replicasets` | no | no |
| `mwc` MutatingWebhookConfiguration | `admission.rs` (new) | `admissionregistration.k8s.io/v1` typed | **cluster** | yes, via `fetch_all!` / `replace_all!` | yes | no | `mutatingwebhooks` | **YES** | **YES** |
| `vwc` ValidatingWebhookConfiguration | `admission.rs` (new) | `admissionregistration.k8s.io/v1` typed | **cluster** | yes, via `fetch_all!` / `replace_all!` | yes | no | `validatingwebhooks` | **YES** | **YES** |
| `vs` VolumeSnapshot | `config_storage.rs` | `snapshot.storage.k8s.io/v1` **DynamicObject** | namespaced | yes | yes | no | `volumesnapshots` | no | no |
| ~~`leases`~~ | — | — | — | — | — | — | — | — | **CUT — see §6.3** |

**`ep` / `eps` get no `delete_resource` arm on purpose.** `GenericResourceTable`'s delete is **opt-in via the
`onDelete` prop** (verified, `GenericResourceTable.tsx:30` / `:229`), so simply omitting the prop on those two
views makes the unsupported-kind error unreachable. Endpoints and EndpointSlices are controller-owned —
deleting one is a no-op that *looks* like it did something.

**`vs` VolumeSnapshot is a CRD.** Copy the graceful-empty pattern from `flux.rs` / `gateway.rs` verbatim
(`Err(kube::Error::Api(ae)) if ae.code == 404 => return Ok(Vec::new())`, plus the "not found" string arms).
The CSI snapshot CRDs are frequently absent.

**`rs` gets a Pods tab for free.** `workload_pods.rs` already resolves `kind: "rs"` → Pods (direct). Adding
`"rs"` to `tabsFor()`'s workload list is the whole change — zero new backend.

### 4.3 Row structs — frozen

```rust
pub struct EndpointsRow {           // ep
    pub name: String, pub namespace: String,
    pub addresses: String,          // comma-joined "ip:port", truncated at 5 with "+N more"
    pub address_count: i64,
    pub ready_count: i64,
    pub age: String,
}
pub struct EndpointSliceRow {       // eps
    pub name: String, pub namespace: String,
    pub service: String,            // labels["kubernetes.io/service-name"], "" when absent
    pub address_type: String,       // "IPv4" | "IPv6" | "FQDN"
    pub endpoints: i64,
    pub ready: i64,
    pub ports: String,              // comma-joined "name:port/proto"
    pub age: String,
}
pub struct ReplicaSetRow {          // rs
    pub name: String, pub namespace: String,
    pub desired: i32, pub current: i32, pub ready: i32,
    pub owner: String,              // ownerReferences[0] as "Kind/name", "" when none
    pub images: String,             // comma-joined container images
    pub age: String,
}
pub struct WebhookConfigRow {       // mwc AND vwc — one struct, two commands
    pub name: String,
    pub webhooks: i64,
    pub failure_policy: String,     // comma-joined distinct values across webhooks
    pub targets: String,            // comma-joined distinct "group/resource" from rules
    pub age: String,
}
pub struct VolumeSnapshotRow {      // vs
    pub name: String, pub namespace: String,
    pub ready: bool,                // status.readyToUse
    pub source_pvc: String,         // spec.source.persistentVolumeClaimName
    pub snapshot_class: String,     // spec.volumeSnapshotClassName
    pub restore_size: String,       // status.restoreSize
    pub age: String,
}
```

TypeScript mirrors are field-identical, snake_case, `i64`/`i32` → `number`, `bool` → `boolean`.

| Command | Rust params | JS args | Returns |
|---|---|---|---|
| `list_endpoints` | `context: String, namespace: String` | `{ context, namespace }` | `Vec<EndpointsRow>` |
| `list_endpoint_slices` | `context: String, namespace: String` | `{ context, namespace }` | `Vec<EndpointSliceRow>` |
| `list_replicasets` | `context: String, namespace: String` | `{ context, namespace }` | `Vec<ReplicaSetRow>` |
| `list_mutating_webhooks` | `context: String` | `{ context }` | `Vec<WebhookConfigRow>` |
| `list_validating_webhooks` | `context: String` | `{ context }` | `Vec<WebhookConfigRow>` |
| `list_volume_snapshots` | `context: String, namespace: String` | `{ context, namespace }` | `Vec<VolumeSnapshotRow>` |

All namespaced list commands use the existing `namespaced_or_all!` macro (`utils.rs:253`).

### 4.4 Per-kind frontend checklist (× 6, mechanical)

For each kind, in order:
1. `src/types/k8s.ts`: interface, add to the `ResourceType` union, add to `SelectedResource`
   (namespaced kinds carry `ns: string`; `mwc`/`vwc` do not).
2. `src/hooks/useResources.ts`: `useQuery` with `staleTime`, `refetchInterval` (30 s), `enabled: !!context`.
3. `src/components/ResourceViews.tsx`: `Column<T>[]` + view component. Pass `onDelete` **except** for
   `ep` / `eps`.
4. `src/components/Sidebar.tsx`: nav item — `ep`/`eps` under **Networking**, `rs` under **Workloads**,
   `mwc`/`vwc` under **Cluster**, `vs` under **Config & Storage**.
5. `src/components/TopBar.tsx:49`: add `mwc` and `vwc` to the `clusterScoped` chain. **Nothing else.**
6. `src/App.tsx`: route case.
7. `src/utils/resourceQueryKey.ts`: entry (table 4).
8. `src/components/ResourceDetailPanel.tsx:1459`: add `mwc` and `vwc` to the `null` list (table 5).

### 4.5 CRD instances as a sidebar tree — wiring, not a build

`list_crd_resources` → `useCRDResources` (`useResources.ts:329`) → `ResourceDetailPanel.tsx:700` already
works. It is only reachable nested inside the CRD detail panel.

- **`src/types/k8s.ts`:** one new `ResourceType` member, `"crd-instances"`. **Not** added to
  `SelectedResource` — `CRDResource` is `{ name, namespace, age }` only, so there is no detail panel worth
  opening. Deepening `list_crd_resources` is a separate, later ask; say no to it here.
- **`src/App.tsx`:** new state `crdTarget: CRD | null`, cleared when `activeResource` changes away.
- **`Sidebar.tsx`:** a collapsible **Custom Resources** section fed by the existing `useCRDs(context)`,
  grouped by `crd.group`, kinds sorted. Selecting a kind sets `crdTarget` **and**
  `activeResource = "crd-instances"`.
- **`ResourceViews.tsx`:** `CRDInstanceView` = `GenericResourceTable` + `useCRDResources(context, crdTarget, true)`.
- **`resourceQueryKey.ts`:** `"crd-instances": "crd-resources"` (table 4).
- Tables 1, 2, 3 and 5: **not touched** — no YAML tab, no delete, no edit, no detail panel.

**Bug to fix while here — `crds.rs:87-91`:**

```rust
let items = if scope == "Namespaced" {
    Api::<DynamicObject>::all_with(client, &ar)
} else {
    Api::<DynamicObject>::all_with(client, &ar)   // <-- identical arms
};
```

Both arms are identical, so the namespace selection is **silently ignored** for namespaced CRDs — the tree
would always list cluster-wide regardless of the namespace picker. Fix: add
`namespace: Option<String>` and use `Api::namespaced_with` when it is `Some(ns)` and `ns != "all"` and
`scope == "Namespaced"`.

> **`Option<String>`, not `String`** — the existing `useCRDResources` caller does not pass it, and a bare
> `String` would error `"missing required key namespace"` at runtime with nothing caught at compile time.
> This is the exact bug that has already shipped twice.

### 4.6 Parallelization

Per kind: the Rust list command and the frontend view are fully parallel once §4.3's structs are frozen.
The one cross-agent contract is that struct table. `@rust-engineer` also owns tables 1 and 2 (`pods.rs`);
`@frontend-engineer` owns tables 4, 5 and `clusterScoped`. Neither can complete the other's half — **the
per-kind checklist must be verified as a pair before the phase is called done**, since a missing entry in
table 4 or 5 compiles cleanly and fails silently.

---

## 5. Parallelization boundary — summary

| Work | `@rust-engineer` | `@frontend-engineer` | Must serialize |
|---|---|---|---|
| **P1** kubeconfig registry + merge | `kubeconfig.rs`, `utils.rs`, `context.rs`, `lib.rs`, dialog plugin | `useActiveContext`, hooks, `App.tsx`, `ContextSwitcher`, types | **Yes, one point:** frontend drops `useSwitchContext` **before** Rust deletes `switch_context` (§1.11) |
| **P2** access probe | `check_cluster_access`, `friendly_auth_error` move, `list_services` fix | `useClusterAccess` + banner | No |
| **P2** cluster identity | **nothing** | `clusterIdentity.ts`, `ConfirmModal` props, ~8 call sites | No |
| **P3.1** merge-from-file | `apply_file.rs`, `kind_to_plural` fix | `mergePreview.ts`, modal, hooks | No |
| **P3.2** multi-pod logs | **nothing** | `MultiLogViewer`, `tabsFor()` | No |
| **P3.3** helm | 4 commands | History tab, install modal, hooks | No |
| **P3.4** can-i | `can_i` | `usePermissions` + consumers | No |
| **P4** 6 kinds | list commands, tables 1 + 2 | types/hooks/views/sidebar, tables 4 + 5 | No, but **verify the 5-table checklist as a pair** |
| **P4** CRD tree | `crds.rs` namespace fix | sidebar tree, view, table 4 | No |

**Genuinely blocking, whole-plan:** nothing after the structs in this document are frozen. Phase 1 must land
and be verified before Phase 2–4 start, because it changes `client_for_context()`, which every other command
routes through — that is a *phase* ordering constraint, not an agent one.

---

## 6. Deferred and cut — with cost, not silently narrowed

### 6.1 Tauri auto-updater — **DEFERRED to its own release, after Phase 4**

**Cost of deferring:** users still cannot discover updates. Distribution is SAML-walled and the generic
package-registry file URLs are the only anonymous install path, so today there is no notification channel
at all. This is a real gap and it stays open.

**Why it is not in this plan:** it needs a signing keypair (`tauri signer generate`), `TAURI_SIGNING_PRIVATE_KEY`
in CI, `createUpdaterArtifacts: true` in `tauri.conf.json` — which **changes the bundle output set** that
`upload:linux` / `upload:mac` publish — plus a publicly reachable `latest.json`. It is the only item in this
plan that can break the currently-green release pipeline, and it **cannot be verified without cutting a real
tag**. Bundling it with feature work means a failed release debugs two things at once.

**When it does happen, the cheap public endpoint is GitLab Pages, not the registry.** Put `latest.json`
alongside the existing `public/index.html` and let the same `sed "s/{{VERSION}}/${V}/g"` in the `pages` job
substitute it.
- **Verified safe:** the job's `COUNT -ne 4` assertion greps `public/index.html` **only**
  (`grep -o 'https://gitlab.com/api/v4/projects/[^"]*' public/index.html`), so adding a second file to
  `public/` does not trip it.
- The registry alternative would need a **stable** `latest` package-version segment; the current URL scheme
  (`.../generic/watchtower/v<VERSION>/<FILE>`) has none.
- **Do not touch the `workflow:` rules** to make Pages deploy on merge — `build:linux` / `build:mac` carry no
  `rules:` of their own and would fire two-hour native builds on every push to `main`. Tag + web trigger is
  the accepted tradeoff, and a release is exactly when a tag exists.
- Pages access control must already be set to **Everyone**; verify in a logged-out browser, because nothing
  in CI checks the page's own accessibility.

### 6.2 `helm repo add` / `remove` / `update` — **CUT**

`list_helm_repos` (read-only, for the install dropdown) stays. **Cost:** users run `helm repo add` in a
terminal once. **Reason:** three write commands shelling out with user-supplied URLs, to save a one-time
setup step that every Helm user has already done.

### 6.3 Leases — **CUT entirely**, not scoped down

**Cost:** no Lease view. **Reason:** every kubelet and every controller-manager holds one; a real cluster has
hundreds of rows that nobody browses. A hardcoded-namespace half-version (`kube-system` only) is worse than
none — it looks like a feature and answers no question.

### 6.4 `Endpoints` **and** `EndpointSlice` — both shipped, redundancy noted

Both were explicitly requested and both are in §4.2. For the record: EndpointSlice has been the authoritative
source since Kubernetes 1.21, and `Endpoints` is a compatibility projection that **truncates at 1000
addresses**. If one is ever dropped, it is `ep`.

### 6.5 Simultaneous multi-cluster views — **OUT OF SCOPE**, as instructed

One table spanning clusters is deferred. **Reason:** every view, hook and detail panel takes a single
`context: string` prop, and `RESOURCE_QUERY_KEY`-based invalidation assumes a 2-element `[key, context]`
prefix throughout `App.tsx` and `useDeleteResource`.

It is **reachable later precisely because query keys are already `[kind, context]`-shaped** — the remaining
work is at the view layer (a cluster column, N parallel queries, a merged sort), not the data layer.
Nothing in this plan forecloses it. **Phase 1 in fact unblocks it**, because the active context stops being
global disk state and becomes ordinary app state that could trivially become a *set*.

---

## 7. Live-cluster verification ledger

`CLAUDE.md`'s Known Open Items already carries *"nothing in the guided create or guided edit path is known to
have been exercised against a real API server."* **Do not add to that pile silently.** Every item below
needs a live cluster and must be reported back before the phase it belongs to is called done.

| Phase | Must be verified against a live cluster | Why inspection cannot settle it |
|---|---|---|
| 1 | Merge order + duplicate-context shadowing with a real second kubeconfig | The `append_new_named` first-wins semantics are unit-tested (§1.3), but the **UI's** provenance/shadow display is not |
| 1 | File-picker import of a kubeconfig with **relative** cert paths | §1.4's claim that `read_from` remaps them is source-read, not observed |
| 1 | GKE / EKS / AKS exec-plugin auth still works through `load_merged_kubeconfig` | This is the highest-risk regression in the plan — `client_for_context` is on every command's path |
| 1 | Client cache invalidation after add/remove/toggle | A stale cached client serves the *previous* cluster's data — silent and dangerous |
| 2 | `check_cluster_access` classification for each of: unreachable, expired auth, 403 | Provider error strings differ per provider and per plugin version |
| 2 | `list_services` returning `Err` when all namespaces are forbidden | Needs a genuinely RBAC-restricted cluster |
| 3.1 | A merge-from-file round trip on a real object, incl. an array field | Merge-patch array-replacement semantics; and that discovery resolves an irregular CRD plural correctly |
| 3.1 | A multi-document file where one document fails | Partial-success collection, not batch abort |
| 3.2 | 20-pod fan-out for 5+ minutes without task leakage | The 15 s `useWorkloadPods` re-identity hazard (§3.2) only shows over time |
| 3.3 | `helm install`, `helm rollback`, `helm history` against a real release | Shell-out exit codes and JSON shapes |
| 3.3 | **`upgrade_helm_release` still works** after the `helm.rs` additions | Regression guard on the release-secret extraction contract |
| 3.4 | SSAR on a cluster where the user is genuinely denied **and** one where SSAR is unavailable | Fail-open behaviour is the whole safety property |
| 4 | Each of the 6 list commands | Standard |
| 4 | `vs` on a cluster **without** the CSI snapshot CRDs | Graceful-empty path |
| 4 | `list_crd_resources` namespace scoping after the §4.5 fix | The bug is that both arms were identical — only a live namespaced CRD proves the fix |

**Cheapest end-to-end smoke per phase:** P1 — switch to a context from a *registered* (non-default)
kubeconfig and confirm pods list. P2 — break auth (`gcloud auth revoke`) and confirm the banner says
`auth`, not an empty table. P3 — merge-from-file a one-key ConfigMap change with Dry run first.
P4 — open each new view once with the namespace picker set to a specific namespace.

---

## 8. Compliance check against the immutable decisions

| Immutable decision | This plan |
|---|---|
| No kubectl dependency | Held. The `kubectl config use-context` hint (§1.5) is a **string on a copy button**; nothing shells out to kubectl. |
| No Redux/Zustand | Held. Active context is `useState` + `localStorage`; server state stays in React Query. |
| Helm is shell-out only | Held. §3.3 adds four `tokio::process::Command` calls; kube-rs is not used for Helm. |
| Helm upgrade extracts the chart from the K8s release secret | Held, and **explicitly protected** — §3.3 forbids install from reusing that path and requires a code comment saying why. |
| Shell terminal: xterm CSS static top-level import | Untouched. |
| Window dragging: explicit JS `startDragging()` | Untouched. |
| ArgoCD commit metadata: three-strategy lazy fetch | Untouched. |
| ArgoCD resource health computed locally from K8s `.status` | Untouched. |
| Sync vs Health are independent | Untouched. |
| ArgoCD `resourceHealthSource: appTree` | Untouched. |
| Guided edit: clone-and-mutate-then-diff; SSA rejected | Held, and **reinforced** — §3.1 rejects SSA for merge-from-file on the same ArgoCD-field-manager grounds and renames the feature rather than pretending merge patch is apply. |
| No create form → no edit form | Held. No Phase 4 kind gets either, hence no `gvk_for` rows (§4.1). |
| Per-invocation `Channel<String>` log isolation | Held **by construction** — §3.2 adds zero Rust and opens one channel per pod. |
