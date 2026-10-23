# Watchtower Feature Recommendations: Consolidated Master List

Date: 2026-10-03. Baseline: Watchtower v1.2.0.
Sources merged:
- **[GUI]** research on established tools (k9s, Lens, Freelens, Headlamp, Aptakube, kdash, Monokle, Octant, Komodor, Kubevious, Kubetail, stern, Popeye, kor, Pluto, Nova, kube-capacity, Seabird, kubectl plugins).
- **[AI]** research on AI-built tools (klustr, rubick, KubeCove, k7s, Kore, PodSteer, sofka, lfk, ku, argonaut, srelens, PodLogs, kite-desktop, kubiq, Aster).
- **[CL]** `CLAUDE.md` Known Open Items, used only where an open item is a prerequisite for a recommended feature.

This is a recommendation only. No code was changed.

Constraints applied to every item: no kubectl binary, kube-rs only; Helm stays shell-out only; no server-side apply; React Query is the only state layer; every new or optional Tauri parameter is `Option<T>`; no in-app LLM; no in-cluster agent; ArgoCD stays CRD-only, with health computed K8s-natively.

---

## 1. Summary

**55 recommended items** (#1–#55: 43 features, 7 quality/engineering, 5 platform/distribution), plus **4 additional prerequisite fixes** drawn from CLAUDE.md (§3.0: P1, P2, P4, P5; P0 and P3 are items #35 and #49). **23 items are not recommended** (§5). Every recommended item was spot-checked against the v1.2.0 tree and is not shipped. The spot-check evidence is in §7.

**One finding surfaced during the spot-check, and it belongs ahead of every feature.** `drain_node` in `src-tauri/src/commands/nodes.rs` (~line 311) tries `evict()` and, **if eviction fails, falls back to a plain `delete()`**. An eviction that fails with 429 is a PodDisruptionBudget refusing the disruption, so this fallback silently bypasses every PDB on the node. The fallback is also `let _ = …delete(…)` followed by an unconditional `evicted += 1`, so failed deletes are swallowed and the success message over-counts. That is a safety bug, not a missing feature. It is item #35.

### Top 10 must-haves

| Rank | # | Feature | Why |
|---|---|---|---|
| 1 | 35 | PDB-respecting drain + drain preview | Current drain bypasses PDBs through a delete fallback, which risks an outage on a routine node operation |
| 2 | 11 | Problems / diagnostics view | Answers "what is broken right now, and why" on one screen. Biggest UX gain, and 9 surveyed tools have it |
| 3 | 1 | Log timestamps + "since" window | Cross-pod incident correlation is near-impossible today (`timestamps: false` is hard-coded) |
| 4 | 29 | Per-context read-only mode / guardrails | Strongest extension of the existing Cluster Identity prod-accident guard, and frontend only |
| 5 | 33 | Keep Secret data out of list payloads + redact Helm values | Closes the known `list_secrets` exposure. Peers (KubeCove, rubick) keep secret material backend-side |
| 6 | 5 | Ephemeral debug container | Distroless images have no shell. Very common pain, and 5 tools ship it |
| 7 | 3+4 | Smart container pre-select (`default-container` annotation + failing container) | Removes a click from the most common crash workflow. Small frontend change |
| 8 | 12 | Node capacity (requests/limits vs allocatable) | Explains "why Pending" and supports right-sizing. Reuses existing parsers |
| 9 | 44 | Frontend test harness + more Rust tests | 33 inline Rust tests and 0 frontend tests vs peers' 88 to 1,909. The edit-form transforms are inspection-verified only |
| 10 | 38 | Watch API instead of polling | Table stakes in both cohorts. Instant updates and less API load. Fits React Query through `setQueryData` |

---

## 2. Master table

Columns: **Val** = user value (H/M/L). **Eff** = effort (S under ~1 day, M a few days, L a week or more). **Side** = R (Rust), F (frontend), R+F (both).

### Logs / Debug

| # | Feature | Inspired by | Val | Eff | Side | Risks / conflicts | Prereqs / deps |
|---|---|---|---|---|---|---|---|
| 1 | Log timestamps toggle + "since" selector (5m/1h/6h/all) in LogViewer and MultiLogViewer | stern, kdash, Lens [GUI]; k7s, PodLogs [AI] | H | S | R+F | `timestamps: Option<bool>` and `since_seconds: Option<i64>` must be `Option` (that bug class has shipped twice). `parseLogLine` must accept an RFC3339 prefix | None |
| 2 | Log include/exclude/highlight regex, level filter, JSON pretty view, and filter by node/zone in multi-pod logs | stern, Kubetail (node/AZ filters) [GUI]; PodLogs [AI] | M | S–M | F | Filtering has to run on the 5000-line ring buffer without re-subscribing channels (the effect-deps rule in MultiLogViewer) | #1 (same controls bar) |
| 3 | Honour `kubectl.kubernetes.io/default-container` when pre-selecting the container for shell and logs | Freelens [GUI] | M | S | F | None. The annotation is already on the pod object | None |
| 4 | Open logs on the failing container (crashing, or init-failing via the `init:` prefix bridge) | rubick [AI] | M | S | F | Precedence vs #3: failing container wins, then the annotation, then the first container | #3 (same selection function) |
| 5 | Ephemeral debug container: choose image + target container, then attach through the existing xterm path | Headlamp [GUI]; klustr, lfk, sofka, PodSteer [AI] | H | M | R+F | kube 0.95 support for the `ephemeralcontainers` subresource needs checking. PSA or admission can reject it. Use **attach**, not exec. Gate with SSAR `update pods/ephemeralcontainers` (fail open) | Reuses ShellTerminal sizing rules (initial cols/rows, zero-dimension guard) |
| 6 | "Neat" YAML toggle that hides `managedFields`, `last-applied-configuration` and status noise | k9s, kubectl-neat, Aptakube [GUI] | M | S | F | **Display only.** Save must never round-trip the stripped object, or `apply_resource_yaml`'s typed replace drops fields | None |
| 7 | Field-manager blame: show `managedFields` as "who owns this field" | lfk [AI] | M | M | F | Read-only display from `get_resource_json`. Does **not** adopt SSA | Pairs with the managed-by banner; complements #6 (the same data, shown instead of hidden) |
| 8 | Resource diff between two objects (namespace↔namespace or context↔context) | Aptakube, Monokle [GUI] | H | M | F | Strip status and managedFields before diffing. Arrays stay leaf "replaced" rows, as in `mergePreview.ts` | Shared diff-row helper (also used by #9, #10, #42) |
| 9 | Rollout-history template diff before rollback | klustr [AI] | M | S–M | R+F | `RevisionInfo` has only `revision`/`image`/`age`. Either add `template: Option<Value>` or fetch each ReplicaSet with `get_resource_json` | Shared diff-row helper |
| 10 | Server-side dry-run diff before the YAML tab's Save | klustr [AI] | H | M | R+F | Must dry-run the **same typed `replace()`** with `dry_run`, never SSA. That also exposes "fields newer than k8s-openapi get dropped" | `apply_resource_yaml` gains `dry_run: Option<bool>`; shared diff-row helper |

### Observability / Health

| # | Feature | Inspired by | Val | Eff | Side | Risks / conflicts | Prereqs / deps |
|---|---|---|---|---|---|---|---|
| 11 | Problems / diagnostics view (also covers the schema/policy-validation idea as built-in heuristics). Deterministic findings: CrashLoop with last exit reason, OOM, ImagePull, Pending with an unschedulable event, missing probes, Service with 0 ready endpoints, PVC Pending, failed Jobs, certs expiring. Includes a per-object "explain why unhealthy" card | Headlamp, k9s Pulses, Popeye, Aptakube [GUI]; sofka, PodSteer, klustr, KubeCove, lfk crash investigator [AI] | H | M | R+F | Heuristics only, no scoring engine. Events-based hints inherit the Events cross-contamination bug | **P1 Events fix first**; uses `expiry.ts` for certs; `list_problems(context, namespace: Option<String>)` |
| 12 | Node capacity: per-node requests and limits vs allocatable, with a usage overlay | kube-capacity, Aptakube [GUI] | H | M | R+F | Needs a cluster-wide pod list, so reuse the existing pods query/data. Reuse `parse_cpu_millis`/`parse_mem_mib` | None |
| 13 | Right-sizing advisor: request vs actual-usage hints per container ("undersized" / "oversized") | Aptakube [GUI]; lfk, PodSteer [AI] | M | M | F | Metrics-server data is point-in-time, so label the result a hint. Better with #16 | #12; metrics history |
| 14 | Constraints view: which ResourceQuota, LimitRange, PDB, PriorityClass and webhooks apply to the selected object | lfk [AI] | M | M | F | Webhook selector matching must read "may apply" | Every input is already listed (`rq`, `lr`, `pdb`, `pc`, `mwc`, `vwc`) |
| 15 | "Not looked at" vs "nothing there": tell apart CRD-absent, RBAC-denied and a genuine 0 rows | rubick [AI] | M | S–M | R+F | Contract change for 4+ commands (flux, gateway, certmanager, `vs`). Freeze the struct (`{ installed, items }`) first | None |
| 16 | Optional external observability backends, reached via the K8s service proxy: Prometheus for metrics (metrics-server stays the fallback), and Loki / VictoriaLogs for historical logs beyond the pod's retained log | Lens, Aptakube, Headlamp [GUI]; rubick (Prom + Loki), sofka (VictoriaLogs), k7s, lfk [AI] | M | L | R+F | Endpoint discovery and config surface. Must degrade gracefully like the Metrics API | None (enables better #13) |
| 17 | Change timeline from retained data (Events, ReplicaSet revisions, Helm history, ArgoCD `status.history`) | Komodor, Kubevious [GUI]; sofka session timeline [AI] | M | L | R+F | No agent means no real history. Events expire after about 1h, so say so in the UI | **P1 Events fix**; reuses #31's journal if shipped |
| 18 | Cluster resource map: Service→Pod, Ingress→Service, Pod→CM/Secret/PVC, plus ownership | Headlamp Map, Octant, Komodor [GUI]; PodSteer, KubeCove [AI] | H | L | R+F | Performance at scale, so scope it per namespace. A new graph-renderer dependency | Extends `graph.rs` (selector and volume edges) |
| 19 | Deprecated / removed API scan of Helm release manifests and `last-applied-configuration` against served versions | Pluto, Monokle [GUI]; PodSteer [AI] | M | M | R+F | The deprecation table needs upkeep each k8s minor, so keep it a data file | Reuses the Helm release-secret decoder + discovery |
| 20 | Unused-resource finder: unreferenced CM/Secret, Service with no endpoints, unbound PVC, Role with no binding, 0-replica workloads | kor, Popeye [GUI]; lfk orphans [AI] | M | M | R+F | False positives from dynamic references. Word it "possibly unused" and **never offer bulk delete from it** | None |
| 21 | cert-manager full chain: Issuer, ClusterIssuer, CertificateRequest, Order, Challenge | klustr, rubick [AI] | M | M | R+F | CRD graceful-empty pattern. New kinds touch the 14 per-kind sites | #15 recommended first |
| 22 | Broader Flux coverage: GitRepository, HelmRepository, OCIRepository, Bucket, plus suspend/resume/reconcile actions | klustr (9 kinds), sofka [AI] | M | M | R+F | Actions are merge patches on `spec.suspend` and the `reconcile.fluxcd.io/requestedAt` annotation. Same no-REST discipline as ArgoCD | #15 |
| 23 | Ingress / Gateway routing explained: host→path→service→port as sentences, with per-link HTTPRoute status | rubick, klustr rule matrix [AI] | M | M | F | Controller-specific annotations (Traefik, nginx) are a long tail. Start with core Ingress + Gateway API | Existing `ing`/`gw`/`httproute` data |
| 24 | NetworkPolicy visualizer (which pods can reach which) | lfk [AI] | L | L | F | Policy semantics are easy to misstate. Label it an approximation | #18's graph renderer |
| 25 | Cloud node-pool / zone columns (GKE/EKS/AKS/Karpenter labels) in Nodes view | rubick [AI] | L | S | F | None (labels already present) | None |
| 26 | CRD instance columns from `additionalPrinterColumns` instead of name/ns/age only | ku (server-rendered columns) [AI] | M | M | R+F | JSONPath evaluation on DynamicObject. Keep it a small, panic-free evaluator (`panic = "abort"`) | Existing `crd-instances` view |
| 27 | Typed panels for common add-ons (KEDA ScaledObject, Karpenter NodePool, Argo Rollouts, External Secrets, Istio VirtualService) | klustr, PodSteer [AI] | L | L | R+F | Each one is a new kind across the 14 per-kind sites. Do it on demand, one at a time | #15 |

### Security / Safety

| # | Feature | Inspired by | Val | Eff | Side | Risks / conflicts | Prereqs / deps |
|---|---|---|---|---|---|---|---|
| 28 | Copyable "kubectl equivalent" for each write, shown in ConfirmModal | PodSteer, ku [AI] | M | S | F | Text + copy button only, so no kubectl dependency. Merge patches render as `kubectl patch --type=merge -p '…'`. **Never put Secret values in the string** | ConfirmModal choke point |
| 29 | Per-context read-only mode / guardrails (writes disabled, optional typed confirm, max bulk size) | sofka, lfk, klustr [AI] | H | S–M | F | Stored beside colour/label in `localStorage["cluster-identity"]`. A hint, not a security boundary. Must gate the same choke points as `usePermissions`, **plus** YAML Save and Helm Values | **P4** (gate YAML Save + Helm Values) |
| 30 | Delete propagation picker (Background / Foreground / Orphan) | lfk [AI] | M | S | R+F | `delete_resource` gains `propagation: Option<String>` (must be `Option`) | None |
| 31 | Local action journal: an append-only record of every write (time, context, kind/ns/name, verb, patch summary, result) | sofka [AI] | M | M | R+F | Write to `<app_config_dir>`. **Never log Secret `data`/`stringData`**; redact `sec` patches to keys only | None |
| 32 | RBAC who-can for verb+resource, plus "what can this ServiceAccount do" | k9s [GUI]; klustr, lfk, sofka, PodSteer [AI] | M | M | R+F | Walk Roles, ClusterRoles and bindings (SSAR only answers for self). Aggregated ClusterRoles and wildcards must be handled or the answer misleads | `rbac.rs` lists |
| 33 | Keep Secret values out of `list_secrets` (keys and sizes only; fetch values on reveal) and redact credential-looking keys in the Helm Values tab | KubeCove, rubick, k7s [AI] | H | M | R+F | Helm Values is **editable** and feeds `upgrade_helm_release`. A redacted `***` must never round-trip into an upgrade, so editing needs a reveal fetch first. Only the `list_secrets` payload and the list-view decode toggle change; the guided Secret editor already reads one object through `get_resource_json` | Prerequisite for any future MCP or export feature |
| 34 | User impersonation ("view as" a user or group) for RBAC testing | ku [AI] | L | M | R | Goes through `client_for_context`, the highest-risk path. Needs `impersonate` RBAC. Show a loud banner while active | #32 complements it |
| 35 | **PDB-respecting drain + drain preview** (list of pods to evict, PDBs that will block, DaemonSets skipped; on 429, report and stop or retry; never fall back to delete without explicit opt-in) | klustr PDB-aware drain, PodSteer drain preview, sofka drain options [AI] | H | S–M | R+F | **Bug fix, two defects in one block.** The delete fallback bypasses PDBs, and `let _ = ns_api.delete(...)` swallows delete failures while `evicted += 1` still runs, so the success message over-reports. Any new option such as `force: Option<bool>` must be `Option` | None, do first |

### Ops / Workflow

| # | Feature | Inspired by | Val | Eff | Side | Risks / conflicts | Prereqs / deps |
|---|---|---|---|---|---|---|---|
| 36 | In-place pod resize through the `pods/resize` subresource | klustr, lfk [AI] | M | M | R+F | Needs a server version that serves it, plus kube 0.95 subresource-patch support. Gate with SSAR `patch pods/resize`. Validate with `edit/quantity.ts` | Server version check |
| 37 | Helm upgrade preview: diff of current vs edited values, plus a `--dry-run` manifest preview before Upgrade | klustr, lfk [AI] | M | S–M | R+F | Upgrade still extracts the chart from the release secret, never from a repo lookup. `dry_run: Option<bool>` on `upgrade_helm_release` (install already has it) | Shared diff-row helper |
| 38 | Watch API (`kube::runtime::watcher` over a `Channel`) for hot views, written into `queryClient.setQueryData` | Lens, Headlamp, k9s [GUI]; klustr, sofka, k7s, Kore, galacius, kubiq [AI] | H | L | R+F | React Query stays the only state layer. Needs watcher lifecycle on context/namespace switch (same cleanup shape as log channels), relist on 410 Gone, and a polling fallback | Pilot on pods first |
| 39 | Simultaneous multi-cluster tables (union view with a cluster column) | Aptakube [GUI]; klustr, PodSteer, lfk [AI] | M | L | F | Already deferred in CLAUDE.md. View-layer cost: N parallel queries + a merged sort | Query keys are already `[kind, context]` |
| 40 | Saved searches / saved filters per view | Headlamp [GUI] | L | S | F | `localStorage` per-viewer convenience only | None |

### UX

| # | Feature | Inspired by | Val | Eff | Side | Risks / conflicts | Prereqs / deps |
|---|---|---|---|---|---|---|---|
| 41 | Light theme + accent colour, following the OS by default | Freelens (#1280, #550, top requests) and every GUI [GUI]; klustr, k7s, lfk, ku [AI] | H | M | F | No `darkMode` in `tailwind.config.js` today. Cluster-identity colours must stay distinguishable in both themes. Sparklines and status colours need contrast checks | Token audit in `tailwind.config.js` |
| 42 | Custom keybindings | k9s, kdash [GUI] | L | M | F | Conflicts with existing shortcuts (⌘K, ⌘N, `r`). Persist in `localStorage` | None |
| 43 | Inline field reference docs in the YAML editor (hover a key, read its description from the OpenAPI schema) | Seabird [GUI] | L | M | R+F | Schema fetch size. CRD schemas are often incomplete. Read-only help, **not** a schema form engine (that stays rejected) | Discovery / OpenAPI v3 fetch |

### Quality / Engineering

| # | Feature | Inspired by | Val | Eff | Side | Risks / conflicts | Prereqs / deps |
|---|---|---|---|---|---|---|---|
| 44 | Frontend test harness (Vitest) covering the `.tsx` edit-form clone-and-mutate transforms; grow inline Rust tests (parsers, `gvk_for`, health, kubeconfig merge) | All peers: KubeCove 331, rubick 935, sofka 1,909 Rust tests [AI] | H | M | R+F | Vitest handles JSX, which removes the Node type-stripping limitation of `check-emit.ts`. Keep `check-emit.ts` as is | None |
| 45 | Demo / fixture mode with synthetic large tables (5,000+ rows) | k7s, PodSteer [AI] | M | M | F | Must be impossible to confuse with a real cluster (a banner, a fixed identity colour) | Seeded from the existing `MOCK_PODS` |
| 46 | App log file + runtime log level in Settings | k7s, srelens [AI] | M | S | R+F | Scrub tokens from the auth-plugin output that `friendly_auth_error` echoes. Bounded rotation | None |
| 47 | Live-cluster verification run: kind/k3d smoke job, or a scripted manual run of the §7 ledger | PodSteer, lfk fixture clusters [AI]; CL §7 | H | M | R+F | CI cost. Exec-plugin auth (GKE/EKS/AKS) still needs a real cloud cluster | `docs/plan-kubeconfig-and-parity.md` §7 |
| 48 | Remove the dead Developer ID branch from the Makefile (it references the deleted `entitlements.plist`) and align CLAUDE.md's signing section with ad-hoc-only | [AI] §3 quality table | L | S | — | Docs-vs-code divergence class: CLAUDE.md still documents a Developer ID path | None |
| 54 | Publish an explicit "what Watchtower deliberately does not do" list (no kubectl, no SSA, no node shell, no AI, no ArgoCD REST, no Helm repo writes) in the README / landing page | rubick, Aster [AI] | L | S | — | Must stay in sync with CLAUDE.md's immutable decisions; doc-vs-code divergence risk | None |
| 49 | Consolidate `isClusterScoped` and `resourceNamespace()` into one shared constant | CL Known Open Items | M | S | F | Must keep TopBar's `clusterScoped` separate, since it deliberately disagrees on `argocd` | Do before adding any new kinds (#21, #22, #27) |

### Platform / Distribution

| # | Feature | Inspired by | Val | Eff | Side | Risks / conflicts | Prereqs / deps |
|---|---|---|---|---|---|---|---|
| 50 | kubeconfig `proxy-url` support (HTTP + SOCKS5) | Freelens, Headlamp #1966 [GUI] | M | S–M | R | `kube = 0.95` is built without `http-proxy`/`socks5` features (confirmed in `Cargo.toml`). Touches `client_for_context`, the highest-risk path | Needs a proxied test cluster |
| 51 | Tauri auto-updater with `latest.json` on GitLab Pages | Lens, Freelens, Headlamp [GUI]; Kore (validated pattern) [AI] | H | M | R+CI | Changes the bundle output set and can break the release pipeline. Verifiable only with a real tag. Ship it alone, not bundled with features | Signing keypair, `TAURI_SIGNING_PRIVATE_KEY` in CI |
| 52 | Windows CI build (currently commented out) | Cohort observation [AI] (Windows unsigned everywhere) | L | M | CI | Needs the same `rules:` guard as `build:linux`/`build:mac`, or every merge fires a long build. The landing-page `COUNT -ne 4` check must be updated deliberately | None |
| 53 | Package-manager manifests (winget, scoop, AUR) pointing at the anonymous registry URLs | lfk (9 package managers) [AI] | L | M | CI | `brew tap` is SAML-walled. Only manifests that fetch registry file URLs work for outsiders | #52 for winget/scoop |
| 55 | `watchtower` terminal launcher: bare `watchtower` opens the app detached; optional `--context <ctx> -n <ns> [kind]` lands on a view; `--help` / `--version`. A second invocation focuses the running window and forwards its args | VS Code `code` convention; k9s, kdash, lfk are terminal-native, so launched from the shell by definition [GUI/AI]. No surveyed GUI tool was verified to ship one | M | M | R+F | Windows release builds use `windows_subsystem = "windows"`, so `--help`/`--version` must attach to the parent console (console-flash vs silent-output trade-off). macOS symlinks into the `.app` bundle, which ad-hoc signing tolerates. Any new optional Tauri param is `Option<T>`. Forwarded args are data only: never reach a shell. Unknown context or kind is ignored, never an error | `tauri-plugin-single-instance` registered **first** in the builder. Per-OS PATH work (see §2.1) |

Count: 55 rows (#1–#55; #54 sits in the Quality table, #55 in Platform / Distribution). #3 and #4 share one selection helper but stay separate rows. The roadmap in §4 places every row.

### 2.1 Notes on #55 (terminal launcher)

- **Single instance.** `tauri-plugin-single-instance` must be the first plugin registered, or a second process gets far enough to start its own window. The running instance receives the second invocation's argv, focuses its window and applies the args. A forwarded `--context` is validated against `list_contexts()` exactly as `useActiveContext` validates a stored name; an unknown context is ignored. An unknown `kind` is ignored and the current view stays. Args only ever select app state; they never reach a subprocess or shell.
- **Linux (.deb / .rpm).** These already install the main binary under `/usr/bin`, but `Cargo.toml` names the binary `Watchtower` (capital W), so the installed command is probably `/usr/bin/Watchtower`, which is not `watchtower` on a case-sensitive filesystem. Confirm with `dpkg -c` / `rpm -qlp` on a real bundle, then fix through Tauri's `mainBinaryName` or a lowercase symlink in the package. **AppImage**: document only (users place or alias it themselves).
- **macOS.** Two routes, either or both: an in-app "Install 'watchtower' command in PATH" action that symlinks `/usr/local/bin/watchtower` to the binary inside `Watchtower.app`, and, if that directory is not writable, shows the exact `sudo ln -s …` command as copyable text (no privilege-escalation tricks, same text-not-shell-out pattern as the context switcher's `kubectl config use-context`); and/or a `binary` stanza in `Casks/watchtower.rb` for Homebrew users (group members only, since `brew tap` is SAML-walled).
- **Windows.** The NSIS / MSI installer must add the install directory to `PATH`. Because the release binary is a GUI-subsystem executable, `--help` / `--version` print nothing unless the process attaches to the parent console (`AttachConsole(ATTACH_PARENT_PROCESS)`), and only those two flags should attach. Switching the release build to the console subsystem instead is the wrong trade: it flashes a console window on every Start-menu launch. Attaching has its own known wart (the shell prompt returns before the output, so the output can land after it). Depends on #52 for a Windows build to test against.

---

## 3. Phases / tiers

### 3.0 Prerequisite fixes (from CLAUDE.md Known Open Items; schedule before the features that depend on them)

| ID | Fix | Unblocks |
|---|---|---|
| P0 | PDB-respecting drain (item #35) | Safety, regardless of anything else |
| P1 | Events cross-contamination: filter on `involvedObject.kind` too (`cluster_info.rs:225`, or frontend-side on `Event.object`) | #11 Problems, #17 Timeline |
| P2 | Confirm dialogs for Restart / Pause / Resume / trigger_cronjob | #28 kubectl-equivalent, #29 guardrails (both live in ConfirmModal) |
| P3 | Consolidate the cluster-scoped predicates (item #49) | Any new kind (#21, #22, #27) |
| P4 | Permission-gate YAML Save and the Helm Values upgrade | #29 guardrails must reach the same choke points |
| P5 | ArgoCD History rollback restores `Source`/`Sources` + `SyncStrategy: {Apply: {}}` | Correctness of the existing rollback, which #9 (rollout diff) will make more visible |

### 3.1 Quick wins (S)

#1 log timestamps + since, #3 + #4 container pre-select, #6 neat YAML, #54 "does not do" list, #25 node-pool columns, #28 kubectl equivalent, #30 propagation picker, #35 PDB drain, #40 saved searches, #46 app log file, #48 Makefile/doc cleanup, #49 predicate consolidation.

### 3.2 High-value medium (M)

#2 log filters, #5 debug container, #8 resource diff, #9 rollout diff, #10 YAML dry-run diff, #11 Problems view, #12 node capacity, #13 right-sizing, #14 constraints view, #15 not-looked-at vs nothing-there, #19 deprecated APIs, #20 unused resources, #29 read-only guardrails, #31 action journal, #32 who-can, #33 secret redaction, #36 pod resize, #37 Helm upgrade preview, #41 light theme.

### 3.3 Big bets (L)

#16 Prometheus, #17 change timeline, #18 resource map, #24 NetworkPolicy visualizer, #27 add-on panels, #38 watch API, #39 multi-cluster tables.

### 3.4 Engineering / quality / platform

#44 test harness, #45 demo mode, #46 app log, #47 live verification, #48 signing-doc cleanup, #49 predicate consolidation, #50 proxy-url, #51 auto-updater, #52 Windows CI, #53 package managers, #55 `watchtower` terminal launcher. Also tracked here: #33 secret handling (scheduled as a security fix, not a feature).

Remaining M items not listed in 3.2 (#21 cert-manager chain, #22 Flux coverage, #23 routing explained, #26 CRD printer columns, #34 impersonation, #42 keybindings, #43 inline docs) are lower value and go in after the big bets or on demand.

---

## 4. Suggested release roadmap

Bundling principle: ship shared helpers once and use them several times; keep risky pipeline or auth-path changes in their own releases.

### v1.2.1: Safety patch (small, ship fast)
- P0 / #35 PDB-respecting drain + drain preview
- P1 Events cross-contamination fix
- P2 confirm dialogs for Restart / Pause / Resume / Trigger
- #48 Makefile + CLAUDE.md signing cleanup
- #54 "deliberately does not do" list

### v1.3: "Debug faster" (logs, diffs, safety UX)
- Logs bundle: #1 timestamps + since, #2 filters, #3 + #4 container pre-select (one selection helper)
- Diff bundle, built on one shared diff-row helper extracted from `mergePreview.ts`: #6 neat YAML, #8 resource diff, #9 rollout diff, #10 YAML dry-run diff (with `apply_resource_yaml` `dry_run: Option<bool>`), #37 Helm upgrade preview
- Write-safety bundle, all in ConfirmModal / the identity store: P4 gating, #28 kubectl equivalent, #29 read-only guardrails, #30 propagation picker
- #5 ephemeral debug container
- #44 test harness lands **first** in this release, so the new transforms ship with tests
- #46 app log file

### v1.4: "What is broken, and why" (health + capacity)
- P3 / #49 predicate consolidation (before any new kinds)
- #11 Problems view (needs P1)
- #12 node capacity → #13 right-sizing
- #14 constraints view, #15 not-looked-at vs nothing-there
- #19 deprecated API scan, #20 unused-resource finder (both "possibly" wording, read-only)
- #32 who-can
- #33 secret redaction (security fix; it changes the Secret decode/edit read path, so it needs its own test pass)
- #31 action journal (needs #33's redaction rules)
- #41 light theme
- #25 node-pool columns, #40 saved searches

### v1.5: Platform release (alone, because it touches the pipeline and the auth path)
- #51 auto-updater (Pages `latest.json`)
- #50 proxy-url (`client_for_context`)
- #47 live verification run, covering everything v1.3–v1.5 changed
- #52 Windows CI build, #53 package manifests, if wanted
- #55 `watchtower` terminal launcher. It belongs here, not in v1.3: it changes what the installers put on disk (PATH, `/usr/bin` name, cask `binary` stanza), and installed-bundle behaviour can only be checked on real installs, the same gate as #51

### v2.0: Real-time and fleet
- #38 Watch API (pilot on pods, then the hot views)
- #39 multi-cluster tables (the view layer already sits on `[kind, context]` keys)
- #18 cluster resource map → #24 NetworkPolicy visualizer (same renderer)
- #17 change timeline (uses #31 journal + P1)
- #16 Prometheus source

### Backlog (on demand)
#21 cert-manager chain, #22 Flux coverage + actions, #23 routing explained, #26 CRD printer columns, #27 add-on panels, #34 impersonation, #36 pod resize (once target clusters serve `pods/resize`), #42 keybindings, #43 inline docs, #45 demo mode, P5 ArgoCD rollback source restore (could move earlier if users hit it).

---

## 5. Not recommended / rejected

| Feature | Seen in | Reason |
|---|---|---|
| In-app AI assistant | Lens, Headlamp plugin [GUI]; Kubeli, k10s, KlustrEye, kubepit, k8sUI, crd-wizard [AI] | Sends cluster data off-machine; user preference is no built-in AI; Secret data still reaches the frontend (#33 would be a hard prerequisite) |
| MCP server for external agents | PodSteer, srelens [AI] | Same no-built-in-AI preference; would expose cluster data while `list_secrets` ships Secret data |
| Node shell (privileged pod) | Lens, Freelens [GUI]; klustr, k7s, PodSteer, lfk, ku [AI] | Privileged-pod security surface; rejected under restricted PSA. #5 (debug container) covers most of the need |
| Plugin / extension system | k9s, Lens, Headlamp [GUI]; sofka, ku [AI] | Large API-stability commitment |
| HTTP benchmark of pods/services | k9s [GUI] | Niche |
| Outdated Helm chart detection | Nova [GUI] | Needs repo index fetches. Defer; if ever built, keep it read-only and separate from upgrade, which must never use repo lookup |
| Server-side apply writes | PodSteer [AI] | SSA rejected: ArgoCD's controller is a field manager on every resource it manages |
| kubectl / krew / helm installer toolbox | srelens [AI] | Conflicts with the no-kubectl decision |
| kubectl command bar | lfk [AI] | Conflicts with the no-kubectl decision (#28 gives the copyable text instead) |
| `argocd` CLI / argocd-server REST dependency | argonaut [AI] | ArgoCD stays CRD-only; health is K8s-native |
| Zustand state store | PodLogs [AI] | React Query is the only state layer |
| Developer ID signing + notarisation | klustr, rubick [AI] | Ad-hoc signing only, by decision on 2026-05-27; added and then fully removed. Listed so it is not re-proposed. (#48 only removes the dead remnants) |
| Popeye-style 0–100 cluster score / rules engine | Popeye [GUI]; Kubevious [GUI] | #11 uses deterministic heuristics; a scoring engine adds tuning debt for little decision value |
| In-cluster agent / automated root-cause analysis | Komodor [GUI] | No in-cluster agent; desktop app only |
| Stored config history ("Time Machine") | Kubevious [GUI] | Needs persistent history from an agent; #17 shows retained data honestly instead |
| Security dashboard driving Trivy / Kyverno / Kubescape | lfk, PodSteer [AI] | Requires external binaries or bundled scanners. Reading their result CRDs could be a later typed panel (#27) |
| Opt-in crash reporting / analytics | k7s, kite-desktop [AI] | Sends data off-machine; #46 local log file covers supportability |
| Local Helm/Kustomize render preview | Monokle [GUI] | Needs `helm template`/kustomize on local sources; out of the app's cluster-centric scope |
| Separate "set image" action | sofka [AI] | Already covered: the deploy/sts/ds guided edit form edits container `image` |
| i18n / RTL | Headlamp [GUI] | No demand signal in the research; large string-extraction cost |
| 460+ themes | lfk [AI] | Overkill; #41 light + accent covers the demand |
| Helm repo add / remove / update | klustr [AI] | CUT (not deferred) in v1.2.0 per CLAUDE.md: three write commands shelling out with user-supplied URLs to save a one-time `helm repo add`. `list_helm_repos` stays read-only |
| Public GitHub-style Releases + weekly tag cadence | peers generally [AI] | Org decision, blocked by the SAML wall; the anonymous registry URLs + landing page are the public path. #51/#53 improve reach within that constraint |

---

## 6. Needs live-cluster verification first

| Item | What must be confirmed |
|---|---|
| #35 PDB drain | 429 behaviour on eviction against a real PDB; what the preview shows for mirror pods and DaemonSets |
| #5 debug container | kube 0.95 `ephemeralcontainers` subresource patch works; PSA `restricted` rejection message; attach handles the TTY |
| #36 pod resize | Which server versions serve `pods/resize`; kube 0.95 subresource patch; graceful degradation on older servers |
| #10 YAML dry-run diff | `replace()` with `dry_run` returns the defaulted object; what fields newer than k8s-openapi look like in the diff |
| #37 Helm upgrade preview | `helm upgrade --dry-run` output from the extracted-chart tempdir path |
| #38 watch API | Watcher lifecycle on context switch, 410 Gone relist, load on a large cluster, exec-plugin token refresh during long watches |
| #50 proxy-url | HTTP and SOCKS5 through `client_for_context`, including exec-plugin auth behind the proxy |
| #51 auto-updater | Only verifiable by cutting a real tag; keep it alone in its release |
| #55 terminal launcher | Not a cluster check: needs real installed bundles per OS. The `/usr/bin` name from `.deb`/`.rpm`; macOS symlink into an ad-hoc-signed `.app` still launches past Gatekeeper; Windows installer PATH entry and `--help`/`--version` console output; second invocation focuses the running window and forwards args on all three |
| #33 secret redaction | Secret decode toggle, guided Secret edit and the TLS tab still work with per-object reveal fetches |
| #11 / #17 events-based hints | After P1, that events attach to the right kind; event TTL on the target clusters |
| #29 guardrails, #32 who-can | Aggregated ClusterRoles and wildcard rules on a real RBAC setup |
| #19 deprecated API scan | Served-version discovery on a cluster one minor behind and one ahead |
| Everything above | Inherits the existing open ledger in `docs/plan-kubeconfig-and-parity.md` §7: GKE/EKS/AKS exec auth through `load_merged_kubeconfig`, client-cache invalidation, SSAR fail-open |

---

## 7. Spot-check evidence (v1.2.0 tree, 2026-10-03)

- `pods.rs:546,562` → `timestamps: false` hard-coded; no `since_seconds` anywhere (#1 not shipped).
- No `managedFields` handling in `src/` or `src-tauri/src` (#6, #7 not shipped).
- `default-container` appears only as a comment in `create/fields.tsx:263` (system-annotation list), not in shell/log selection (#3 not shipped).
- No `darkMode` in `tailwind.config.js` (#41 not shipped).
- No propagation policy in `src-tauri/src` (#30 not shipped).
- `Cargo.toml`: `kube = { version = "0.95", features = ["derive", "ws", "client"] }`, no `http-proxy`/`socks5` (#50 not shipped). No `runtime` feature (dropped because nothing used it; #38 must re-add it) and no `watcher` use in commands (#38 not shipped). No `ephemeral` container code (#5 not shipped).
- `workload_actions.rs` `RevisionInfo` carries revision/image/age only (#9 needs a template source).
- `nodes.rs` drain: `evict()` then `delete()` on failure (#35 is a bug).
- `ClusterOverview.tsx:86` "Problem pods" count card only (#11 not shipped).
- No journal, who-can, read-only mode, kubectl-equivalent outside ContextSwitcher, or app log plugin found (#28, #29, #31, #32, #46 not shipped).
- No `single-instance` plugin in `Cargo.toml`/`lib.rs`; `[[bin]] name = "Watchtower"` (capital W); `main.rs` sets `windows_subsystem = "windows"` for release; the cask has no `binary` stanza (#55 not shipped).
- `portforward.rs:41` binds `127.0.0.1` (KubeCove's loopback-only port-forward idea is already shipped).
- Already shipped, so excluded: Helm install dry-run (`helm.rs:442`), cordon/uncordon (`nodes.rs:176,187`), Flux `suspended` read (no actions), image editing in the workload edit form, multi-pod logs, cluster identity, SSAR gating, TLS tab, guided forms.
