# Node drain

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Node Drain (v1.2.1)

Contract: `docs/impl/v1.2.1-tasks.md`. Backend: `commands/drain.rs`.

**Eviction only. Nothing in `src-tauri/src` deletes a pod as a fallback for a refused eviction** (that bypasses the PDB). The old `drain_node` did; it was removed. `grep -rn drain_node src-tauri/src` returns nothing.

### Frontend-driven sequential loop

No Channel, no long backend task. The frontend runs `cordon_node` → `preview_node_drain` (fresh, after cordon) → `evict_pod` per pod, one at a time. Each call returns that pod's outcome. No cancellation registry, no orphaned task on unmount; Stop/Retry are frontend state. `useNodeDrain` is called from `NodeOverview`, not the dialog, so closing the dialog keeps rows.

| Command | Behaviour |
|---|---|
| `preview_node_drain(context, node) -> DrainPreview` | No writes: one node `GET`, one pod `LIST` (`spec.nodeName`), one `policy/v1` PDB `LIST` per namespace. Point-in-time, so re-fetched after cordon |
| `evict_pod(context, namespace, name) -> EvictionResult` | `Api::<Pod>::evict`. `Err` only if the client cannot be built; API outcomes go in `outcome` |

### The four outcomes

| `outcome` | Meaning |
|---|---|
| `evicted` | Accepted (2xx). Pod is terminating, **not** gone |
| `blocked` | 429 whose message contains "disruption budget" (case-insensitive) |
| `gone` | 404. Counted separately, **never folded into evicted** |
| `failed` | Anything else: bare 429 (APF throttling), 500 "multiple PDBs", transport errors. Server message verbatim |

Pure, tested: `classify_eviction_error(code, message)`.

### Preview classification

| Rule | Behaviour |
|---|---|
| `mirror` | Annotation `kubernetes.io/config.mirror` present. Checked first |
| `daemonset` | Controller ref (`controller == true`) kind `DaemonSet` |
| `evict` | Everything else, incl. unmanaged, completed, terminating |
| `unmanaged` | No controller ref. Mirror pods report `false` |
| `owner_kind` / `owner_name` | From the controller ref; a ReplicaSet named `…-<pod-template-hash>` is reported as its Deployment (no API call) |
| PDB match | `selector == None` matches nothing; empty selector matches all; all `matchLabels` must match; `In`/`NotIn`/`Exists`/`DoesNotExist`; unknown operator no match. Display only |
| `may_be_blocked` | `evict` and a matching PDB has `disruptions_allowed <= 0` |
| `has_empty_dir` | Any `emptyDir` volume (data lost on eviction) |
| PDB list failure | In `pdb_lookup_errors` per namespace; those pods get `pdbs: []`, `may_be_blocked: false`; preview still `Ok` |

### Run semantics

- **Stop** is checked before each eviction; the in-flight one completes.
- **One pass, no automatic retry.** Any `blocked` → attention phase. "Retry blocked pods" retries `blocked` only, **not `failed`**.
- **"Node drained" only when blocked = 0, failed = 0, not stopped.** `gone` never blocks it. The line says the node is cordoned and evicted pods stop within grace; it never claims the node is empty.
- **Typed confirm** (node name) only when a pod to evict is `unmanaged` or the preview failed ("Drain without preview"). `emptyDir` gets a warning, not a typed confirm.
- Closing the window mid-drain leaves the node cordoned (loop lives in the webview).
- Cordon / Drain / Delete node use `usePermissions(context, "", "nodes")` (`canPatch` for Cordon and Drain, `canDelete` for Delete), disabled with a reason, never hidden.
- **`pods/eviction` hint per namespace:** `evictionChecks(preview)` (`utils/permissionHints.ts`) sends one `create pods/eviction` check per namespace of `evict` pods via `useAccessChecks`. Explicit `allowed: false` shows "Your account can't evict pods in …. Those evictions will fail." Hint only, fails open; real denials surface as `failed` rows.
- Read-only mode disables Retry and Override; Stop and Close stay.

## Drain force-delete (v1.3.1)

For PDB-blocked pods. Frontend only, no new Rust: reuses `delete_pod` (default grace) through `invokeWrite`. Still **no automatic fallback**: nothing deletes unless the user opts in.

- **Opt-in Override band** in the attention phase, below Stop and Retry ("Force-delete the blocked pods…", "Bypasses the PodDisruptionBudget."). Never default focus.
- **Nested `md` destructive `ConfirmModal`** (`NodeDrainDialog.tsx`): node name **always typed**; per-pod checkboxes start checked up to the bulk limit (`defaultForceSelection`); bulk-limit check (G2); notice for pods without a controller ("will not be recreated"); kubectl equivalent with one line per namespace (`forceDeleteEquiv`, footnote: bypasses PDBs). Only `blocked` rows are offered (`forceDeletable`).
- Sequential loop `useNodeDrain.forceDelete(keys)`; Stop checked before each delete. A failed delete returns the row to **`blocked`** with "Force delete failed: …" (so Retry/Override still reach it). A 404 (`isDeletePodNotFound`) goes to `gone`.
- **Row states `deleting` and `force-deleted` ("Deleted, PDB bypassed", warn) are drain-row states only, never an `EvictionOutcome`, never folded into `evicted`.** They live in `src/utils/drain.ts`. `runCounts` counts `forced` and `deleting` separately. `drainOutcome`: a forced pod does not block "complete" (only `blocked`, `failed`, `waiting`, `evicting`, `deleting` do). `outcomeTitle(…, forced)` reads "Node drained, N pods force-deleted". Result card and strip use **warn** tone whenever `forced > 0`.
- Force-deletes log `verb=delete kind=pod`; `evict_pod` logs a blocked eviction as `result=error`.
