# UX Task Briefs: Feature Recommendations #1–#55 + P0–P5

Date: 2026-10-03. Baseline: Watchtower v1.2.0.
Author: tech lead. Audience: the `senior-ux-specialist` agent (one or more instances).
Source of truth for scope: `docs/feature-recommendations.md` (every item #1–#55 and P0–P5 accepted).
Source of truth for constraints: `CLAUDE.md`. If this brief and CLAUDE.md disagree, CLAUDE.md wins. Raise the disagreement as an open question.

This is a **design-only** phase. No code is written. The UX specialist must not:

- invent Tauri command signatures, struct fields or parameter names;
- propose changes to the immutable architecture decisions;
- add new state libraries.

When a design needs data that may not exist yet, the spec names the **data need** in plain words (for example: "the list of pods the drain would evict, with the PDB that blocks each one") and adds it to that spec's **Open questions for tech lead** list. The tech lead turns data needs into contracts afterwards.

---

## 1. Triage

Legend:
- **(a)** needs UX/UI design: flows, wireframes, states, copy.
- **(b)** small UI tweak: note only, no full spec section. Covered by a short paragraph in the owning package.
- **(c)** no UI: backend, CI or docs only. Listed here and skipped.

Aliases: **P0 is #35** and **P3 is #49**. Each appears once below, with both IDs.

The **Release** column follows the roadmap in feature-recommendations §4.

**Roadmap gap.** #7 (field-manager blame) is not placed in any release or in the backlog in §4. This brief places it in **v1.3**, next to #6, because both read the same `managedFields` data. The tech lead must confirm this placement.

| ID | Item | Class | Package | Release |
|---|---|---|---|---|
| P0 / #35 | PDB-respecting drain + drain preview | (a) | UX-01 | v1.2.1 |
| P1 | Events cross-contamination fix | (b) | UX-01 | v1.2.1 |
| P2 | Confirm dialogs for Restart / Pause / Resume / Trigger CronJob | (b) | UX-01 | v1.2.1 |
| P3 / #49 | Consolidate cluster-scoped predicates | (c) | — | v1.4 |
| P4 | Permission-gate YAML Save + Helm Values upgrade | (b) | UX-03 | v1.3 |
| P5 | ArgoCD History rollback restores Source/Sources | (b) | UX-01 | backlog |
| #1 | Log timestamps + "since" window | (a) | UX-02 | v1.3 |
| #2 | Log include/exclude/highlight, level filter, JSON view, node/zone filter in multi-pod | (a) | UX-02 | v1.3 |
| #3 | Honour `default-container` annotation | (b) | UX-02 | v1.3 |
| #4 | Open logs on the failing container | (b) | UX-02 | v1.3 |
| #5 | Ephemeral debug container | (a) | UX-02 | v1.3 |
| #6 | "Neat" YAML toggle | (b) | UX-03 | v1.3 |
| #7 | Field-manager blame | (a) | UX-03 | v1.3 (placed by this brief) |
| #8 | Resource diff (ns↔ns, ctx↔ctx) | (a) | UX-03 | v1.3 |
| #9 | Rollout-history template diff before rollback | (a) | UX-03 | v1.3 |
| #10 | Server-side dry-run diff before YAML Save | (a) | UX-03 | v1.3 |
| #11 | Problems / diagnostics view + "explain why unhealthy" card | (a) | UX-04 | v1.4 |
| #12 | Node capacity (requests/limits vs allocatable) | (a) | UX-04 | v1.4 |
| #13 | Right-sizing advisor | (a) | UX-04 | v1.4 |
| #14 | Constraints view | (a) | UX-04 | v1.4 |
| #15 | "Not looked at" vs "nothing there" | (a) | UX-04 (taxonomy defined in 00-overview) | v1.4 |
| #16 | Prometheus / Loki / VictoriaLogs backends | (a) | UX-06 | v2.0 |
| #17 | Change timeline | (a) | UX-06 | v2.0 |
| #18 | Cluster resource map | (a) | UX-06 | v2.0 |
| #19 | Deprecated / removed API scan | (a) | UX-04 | v1.4 |
| #20 | Unused-resource finder | (a) | UX-04 | v1.4 |
| #21 | cert-manager full chain | (b) | UX-04 | backlog |
| #22 | Broader Flux coverage + suspend/resume/reconcile | (b) | UX-04 | backlog |
| #23 | Ingress / Gateway routing explained | (a) | UX-06 | backlog |
| #24 | NetworkPolicy visualizer | (a) | UX-06 | v2.0 |
| #25 | Cloud node-pool / zone columns | (b) | UX-04 | v1.4 |
| #26 | CRD `additionalPrinterColumns` | (b) | UX-04 | backlog |
| #27 | Typed add-on panels | (b) | UX-04 | backlog |
| #28 | Copyable "kubectl equivalent" in ConfirmModal | (a) | UX-03 | v1.3 |
| #29 | Per-context read-only mode / guardrails | (a) | UX-03 | v1.3 |
| #30 | Delete propagation picker | (a) | UX-03 | v1.3 |
| #31 | Local action journal | (a) | UX-04 | v1.4 |
| #32 | RBAC who-can + "what can this SA do" | (a) | UX-04 | v1.4 |
| #33 | Secret values out of list payload + Helm Values redaction | (a) | UX-04 | v1.4 |
| #34 | User impersonation ("view as") | (a) low-fi | UX-04 | backlog |
| #36 | In-place pod resize | (a) low-fi | UX-03 | backlog |
| #37 | Helm upgrade preview | (a) | UX-03 | v1.3 |
| #38 | Watch API | (a) | UX-06 | v2.0 |
| #39 | Multi-cluster tables | (a) | UX-06 | v2.0 |
| #40 | Saved searches / filters | (a) small | UX-04 | v1.4 |
| #41 | Light theme + accent, follows OS | (a) | UX-05 | v1.4 |
| #42 | Custom keybindings | (a) low-fi | UX-05 | backlog |
| #43 | Inline field docs in YAML editor | (a) low-fi | UX-03 | backlog |
| #44 | Frontend test harness + Rust tests | (c) | — | v1.3 |
| #45 | Demo / fixture mode | (a) low-fi | UX-05 | backlog |
| #46 | App log file + runtime log level in Settings | (a) small | UX-05 | v1.3 |
| #47 | Live-cluster verification run | (c) | — | v1.5 |
| #48 | Remove dead Developer ID branch + align CLAUDE.md | (c) | — | v1.2.1 |
| #50 | kubeconfig `proxy-url` support | (b) | UX-05 | v1.5 |
| #51 | Tauri auto-updater | (a) | UX-05 | v1.5 |
| #52 | Windows CI build | (c) | — | v1.5 |
| #53 | winget / scoop / AUR manifests | (c) | — | v1.5 |
| #54 | "What Watchtower deliberately does not do" list (README / landing page) | (c) | — | v1.2.1 |
| #55 | `watchtower` terminal launcher | (a) | UX-05 | v1.5 |

Coverage check: the table has 55 numbered items plus P0–P5. Each alias pair (P0/#35 and P3/#49) has one row, so that is 59 rows.

### (c) items, listed and skipped

- **P3 / #49**: an internal constant. It has no visible change by design. The TopBar `clusterScoped` list stays separate.
- **#44**: test harness.
- **#47**: verification run.
- **#48**: Makefile and doc cleanup.
- **#52, #53**: CI and packaging.
- **#54**: README and landing-page copy. The tech lead writes it from CLAUDE.md's immutable decisions. It is not a UX deliverable, but UX copy elsewhere must not contradict it. For example, never imply a node shell, AI features, or Helm repo writes.

---

## 2. Work packages

Six packages, each mapped to a roadmap release, with items grouped by shared surface. Backlog items with UI are folded into the package whose surface they share, marked **low-fi**. Low-fi means one flow, one wireframe and the states table. No pixel-level detail.

| Package | Release | Theme | Fidelity |
|---|---|---|---|
| UX-01 | v1.2.1 | Safety patch: drain preview, confirm coverage | Full |
| UX-02 | v1.3 | Logs & debug | Full |
| UX-03 | v1.3 | Diffs & write safety (ConfirmModal, YAML, Helm, guardrails) | Full |
| UX-04 | v1.4 | Health, problems, capacity, RBAC & secrets | Full (backlog items low-fi) |
| UX-05 | v1.3 (#46) / v1.4 / v1.5 | Theme, settings & platform. The Settings shell and Diagnostics are designed in 00 | Full for #41/#46/#51/#55; low-fi for backlog |
| UX-06 | v2.0 | Real-time & fleet | Medium: flows + IA + states; layouts low-fi |

Output files: `docs/ux/01-safety-patch.md` through `docs/ux/06-realtime-fleet.md`, plus `docs/ux/00-overview.md`. See §4.

---

### UX-01: Safety patch (v1.2.1)

**Items**
- (a) P0 / #35: drain preview + PDB-respecting drain.
- (b) P2: confirm dialogs for Restart, Pause, Resume and Trigger CronJob.
- (b) P1: Events tab filtering.
- (b) P5: rollback confirm copy.

**Surfaces**
- `src/components/ResourceDetailPanel.tsx`
  - The node action bar and its drain `ConfirmModal`, around lines 368–500 (`handleAction`, `confirmAction`).
  - `EventsTabContent`, around line 2181.
  - The ArgoCD History rollback, around line 2326.
- `src/components/WorkloadActions.tsx`
  - `RestartAction` and `PauseResumeAction`. Both fire on one click today.
  - The CronJob trigger.
- `src/components/ConfirmModal.tsx`
  - This package is the **first consumer** of the richer modal anatomy defined in `00-overview.md`.

**Existing patterns to reuse**
- `ConfirmModal`, with `contextLabel` / `contextColor` on every call site. That property is verified for every site. A new site without it is a regression.
- `requireTyping` for the highest-risk path.
- Disabled-with-reason via `usePermissions` (`NO_PERMISSION_PATCH` tooltips in WorkloadActions). This is fail-open: only an explicit deny greys anything out.
- Destructive vs non-destructive button styling (`bad` vs `accent` token).

**P0 / #35: what the design must express**

1. **Preview before confirm.** The preview shows:
   - the pods that will be evicted;
   - the DaemonSet pods that will be skipped;
   - mirror / static pods (not evictable);
   - the pods whose PDB will block eviction right now. For each, name the PDB and its `allowed disruptions` value.
2. **Live progress.** Show progress while the drain runs: evicted, waiting, blocked.
3. **A 429 (PDB refused) is a stop-and-report outcome, not a failure to hide.** The user chooses one of:
   - **retry**;
   - **stop**, which leaves the node cordoned and says so;
   - **force-delete the blocked pods**. This is an **explicit, separately confirmed opt-in**. It needs its own `requireTyping` confirm and its own consequence copy ("bypasses the PodDisruptionBudget, may cause an outage"). It is never the default and never a pre-checked option.
4. **The result summary must be honest.** Counts come from real outcomes (evicted / failed / skipped / blocked). The old message over-counted. Never show "N evicted" when some failed.
5. **Cordon persists after an aborted drain.** The UI must say "Node remains cordoned. Uncordon to return it to service", and keep Uncordon reachable.

**Hard constraints**
- Never fall back to delete silently. Force is an opt-in, never a recovery path.
- The preview is a point-in-time snapshot: PDB budgets change while the drain runs. Copy must not promise the preview result.
- P2's four confirms are **not destructive** in the data sense, so use the non-destructive style. Restart still deserves a clear consequence line ("all pods will be replaced, rolling").

**P2**: for each of the four actions, give the title, description and confirm label. Pause has a specific consequence: "rollouts stop until resumed; scaling still works". Trigger CronJob says "creates a Job now, outside the schedule".

**P1**: no new controls. Specify the Events tab empty-state copy for when filtering removes everything. That case is now more likely, and it is correct. Example: "No events for this Deployment. Events are kept for about 1 hour."

**P5**: confirm copy for the ArgoCD History rollback.
- After the fix: "Restores revision X **and the source it was deployed from**".
- Until the fix lands, the copy must not over-promise.
- Open question: the wording in each state.

**Deliverables**
- The drain flow: preview → confirm → progress → result. Include the branch for a 429 mid-drain.
- An ASCII wireframe of the drain modal, using the "large" ConfirmModal variant from 00.
- States: preview loading, preview failed, nothing to evict, all blocked, partial, done.
  - Once P0 lands, the backend enforces PDBs whatever the preview shows, so a failed preview is **informational**. Do not call this "fail open"; that term means SSAR hints elsewhere in this doc.
- Microcopy for every state and for the four P2 confirms.
- Keyboard: Esc cancels before start. During progress, Esc must **not** cancel silently. Define the behaviour.
- Accessibility: live-region announcement of progress counts.
- Dark and light: the blocked / evicted / skipped colours must use semantic roles (see 00), not raw hex.

**Open questions for tech lead**
- Can the preview list be computed without side effects? Data need: pods on the node + matching PDBs + their current `disruptionsAllowed`.
- Retry policy on 429: manual only, or automatic with a backoff?
- Is the force-delete opt-in in scope for v1.2.1, or deferred so that v1.2.1 is report-and-stop only?
- When the preview fails to load, may the user still drain (with a warning that the backend still enforces PDBs), or is Drain blocked until a preview loads?

---

### UX-02: Logs & debug (v1.3)

**Items**
- (a) #1: timestamps + "since".
- (a) #2: filters.
- (a) #5: ephemeral debug container.
- (b) #3 + #4: container pre-select.

**#2 is an extension, not a greenfield design.** `src/components/LogViewer.tsx` already ships:
- free-text search;
- a regex toggle with an error state;
- level toggles (ERROR / WARN / INFO / DEBUG / FATAL);
- follow, wrap and previous-instance;
- download.

`src/components/MultiLogViewer.tsx` has only follow and a container picker. The work is:

1. Add **exclude** and **highlight** (separate from include/filter) and a **JSON pretty view** for structured lines, in both viewers.
2. Bring MultiLogViewer to parity with LogViewer: search, regex, levels, wrap, download.
3. Add **node / zone filters** in MultiLogViewer only.

Redesign the existing LogViewer controls only where needed to fit the new ones.

**Surfaces**
- `src/components/LogViewer.tsx`: toolbar around lines 200–300 and `parseLogLine`.
- `src/components/MultiLogViewer.tsx`: 20-pod cap notice, colour-tagged lines.
- `src/components/DetailPanel.tsx`: pod Logs and Shell tabs. Container selector around lines 1097–1110 currently defaults to `containers[0]`.
- `src/components/ShellTerminal.tsx`: the #5 attach target.
- `src/components/ResourceDetailPanel.tsx`: the workload Logs tab hosts MultiLogViewer.

**Existing patterns to reuse**
- `Toggle` chip style and `Kbd`.
- The `[init] <name>` container label convention.
- The DetailPanel tab structure and the resizable panel (320–900 px).
- The cluster identity badge on any confirm.
- SSAR disabled-with-reason, fail open.

**Hard constraints**
- **"Since" restarts the stream; filters never do.** Changing the since window or the timestamps toggle re-subscribes on the backend and clears the buffer. Include, exclude, highlight, level and JSON view run over the existing buffer (5000-line ring buffer in multi-pod). The UI must make this difference visible. For example: since and timestamps sit in a "source" group, and filters sit in a "view" group. Changing since shows a brief "reloading from <window>" state.
- **The ring buffer drops old lines.** Filters cannot show lines that were evicted. State this where a user might expect a full-history search ("searching the last 5,000 lines").
- **#3 / #4 precedence**: failing container first, then the `kubectl.kubernetes.io/default-container` annotation, then the first container.
  - The user must be able to see **why** a container was pre-selected. Example: a subtle hint "selected: last crashed (OOMKilled)".
  - The user must be able to override it with one click.
  - Init containers use the `init:` prefix bridge.
- **#5 debug container**:
  - It is an **attach**, not an exec. The flow: choose image (sensible default plus free text), choose target container, start, then the terminal attaches.
  - The container persists in the pod spec after detaching. Ephemeral containers cannot be removed, so say this plainly before confirm.
  - It is a write, so it goes through ConfirmModal with the cluster identity badge, and read-only mode (#29) blocks it.
  - States: denied (SSAR `update pods/ephemeralcontainers`, disabled with reason); rejected by PSA or admission (show the server message verbatim plus a plain-language line); image pull failing; container waiting; attached; detached.
- Never offer a node shell. That feature is rejected.

**Deliverables**
- A toolbar redesign for both viewers, as ASCII wireframes: compact at 480 px panel width, expanded at 900 px.
- The since selector (5m / 1h / 6h / all, plus a custom value?) and the timestamps display format, including the local-vs-UTC choice.
- Node/zone filter UX in multi-pod, including the pod-count-vs-filter interaction with the 20-pod cap.
- The JSON pretty view: inline expand per line, or a whole-view mode?
- The #5 flow, the debug-container modal wireframe, and the full states list.
- Copy for every state. Keyboard shortcuts for toolbar focus, next/previous match and toggling follow, checked against the global keymap in 00.
- Accessibility: virtualised list semantics, highlight contrast in both themes, colour-tagged pod prefixes that do not rely on colour alone.

**Open questions for tech lead**
- Can since and timestamps apply to previous-instance logs too?
- Data need for the node/zone filter: per pod, its node and the node's zone label.
- The debug-image default (busybox? a configurable default in Settings?).
- Whether #5 needs the same initial cols/rows handshake as the shell. The designer only needs to know whether a "connecting" state exists.

---

### UX-03: Diffs & write safety (v1.3)

**Items**
- (a) #7 field-manager blame (placed in v1.3 by this brief).
- (a) #8, #9, #10, #37: diffs.
- (a) #28, #29, #30: ConfirmModal and identity-store additions.
- (b) P4: permission gating.
- (b) #6: neat YAML toggle.
- Backlog, low-fi: (a) #36 pod resize and (a) #43 inline field docs in the YAML editor.

**Surfaces**
- `src/components/ConfirmModal.tsx`, plus PodTable's **separate bespoke bulk-confirm dialog** in `src/components/PodTable.tsx`. #28 and #29 must reach that dialog too. It reuses `ClusterBadge` but is not built on ConfirmModal.
- `src/components/ResourceDetailPanel.tsx`:
  - YAML tab: edit/save around lines 3127–3179; Helm Values tab: edit/upgrade around lines 3034–3093.
  - `tabsFor()` around line 2527.
  - Header delete and pencil.
- `src/components/WorkloadActions.tsx`: rollback history list (#9).
- `src/components/edit/ResourceEditor.tsx`: already has a Patch preview toggle and Dry run. #28 adds the kubectl-equivalent here.
- `src/components/MergeFromFileModal.tsx`: reached by #28 and #29.
- `src/components/ResourceCreator.tsx` and `HelmInstallModal.tsx`: reached by #29.
- `src/components/GenericResourceTable.tsx`: per-row delete (#30, #29).
- `src/components/ContextSwitcher.tsx` `IdentityEditor`: where #29 is configured (see 00 IA).
- `src/utils/mergePreview.ts`: the visual source of the shared diff row.

**Existing patterns to reuse**
- The ConfirmModal choke point plus `contextLabel` / `contextColor`.
- `requireTyping`.
- Disabled-with-reason, never hidden. The one exception: `GenericResourceTable`'s `onDelete` hides the delete column on deny. See 00 for how read-only interacts with it.
- The Merge-from-file preview rows. Arrays are a single **"replaced"** leaf row, never an element-wise merge.
- The ResourceEditor Patch preview and Dry run.
- The managed-by banner ("Managed by X: changes will be reverted on the next sync"), with confident vs "Possibly managed by".

**Hard constraints**
- **One shared diff-row component** (defined in 00) serves #8, #9, #10 and #37, plus the existing Merge-from-file preview. Arrays are leaf "replaced" rows everywhere. Never imply an element-wise merge.
- **#28 kubectl-equivalent must name the real verb.** It is text plus a copy button, with no shell-out.

  | Action | Rendered as |
  |---|---|
  | YAML tab Save | `kubectl replace` (a typed whole-object replace) |
  | Guided edit | `kubectl patch --type=merge -p '…'` |
  | Delete | `kubectl delete`, including `--cascade=` when #30 changes it |
  | Scale / restart | Their real equivalents |
  | Merge from file | Never `kubectl apply`. This is the same "never say Apply" rule reached by a different route. Render each document as its real create or merge-patch equivalent, or omit the equivalent and say why |
  | Helm actions | The real `helm` command line (`helm upgrade …`, `helm rollback …`) |
  | Secret | **Keys only, never values**, in `data` or `stringData`. Show keys with a placeholder such as `<redacted>` |

- **#29 read-only is a hint, not a security boundary.** Copy must never say "protected", "secured" or "locked". Prefer "Read-only mode (Watchtower guardrail)".
  - **Scope is a property, not a list: every mutation call site in the app.** The list below is illustrative only. Several writes are not reached by `usePermissions` today: Helm rollback and uninstall, namespace create and delete from the Sidebar `+`, ArgoCD History rollback, node delete, Scale, and Trigger CronJob. The UX spec must include a **write-surface inventory table**: surface, file, and how read-only presents there. The tech lead verifies that table against the code.
  - Illustrative surfaces:
    - all `usePermissions` choke points;
    - YAML Save and Helm Values upgrade (P4);
    - Merge from file;
    - +New / ⌘N;
    - Helm install;
    - #5 debug container;
    - drain, cordon and taints;
    - bulk pod actions;
    - ArgoCD sync/refresh, including bulk.
  - Shell exec is an **open question**. Do not decide it in the design. Present both options.
  - The other guardrails (optional typed confirm and max bulk size) are per-context settings, stored beside colour and label.
- **#6 neat YAML is display-only.** Entering edit mode must show the full object, or must clearly warn that hidden fields are kept. Save must never round-trip a stripped object. The toggle state must be visible in edit mode.
- **#7 blame is read-only display.** It does not introduce SSA wording such as "ownership", "force" or "conflict".
- **#10 dry-run diff** runs the same typed replace. Fields dropped because they are newer than the pinned schema will appear as removals. Design a callout for that: "This field will be dropped because Watchtower's schema does not know it".
- **#37 Helm upgrade preview**:
  - A values diff (current vs edited), plus a dry-run manifest preview.
  - Never mention a repo or chart version lookup; the upgrade source is the release itself.
  - #33's redaction (UX-04) means a redacted value must never be sent in an upgrade. Coordinate on a "reveal to edit" step.
- **#9** reuses the existing rollback confirm and adds "Compare with current" per revision.
- **#36 (low-fi)**: in-place resize uses quantity validation ("100m", not "100"). When the server does not serve `pods/resize`, show it disabled with the reason: "This cluster's API server doesn't support in-place resize".

**Deliverables**
- A ConfirmModal "write" variant using the 00 anatomy. It needs: kubectl-equivalent disclosure (collapsed by default), propagation picker (#30), read-only block state, and the typed-confirm guardrail.
- The same treatment for PodTable's bulk dialog. Include the max-bulk-size refusal: "Read-only guardrail: bulk actions limited to N on prod".
- The read-only configuration UI in `IdentityEditor`, and the global indicator:
  - how a read-only context looks in TopBar, Sidebar chip, ContextSwitcher rows and every disabled control;
  - the reason tooltip copy;
  - a one-click path to turn it off, with a confirm.
- The #8 entry point and picker: pick a second object by namespace or context, then a diff view with the shared rows.
- #9, #10 and #37 flows. Each is "preview → confirm", with the diff in the large modal.
- The #7 blame display. Inline gutter in the YAML tab, or a separate panel? Decide and justify.
- #6 toggle placement and its edit-mode behaviour.
- States: diff loading, no differences, dry-run rejected by the server (show the server message), denied, read-only, context unreachable (for ctx↔ctx diff).
- Microcopy, keyboard (for example ⌘↵ to confirm and Esc to close; check against the keymap), and accessibility: diff rows must not rely on red/green alone, so use +/−/~ glyphs.
- Low-fi: #36 resize dialog, and #43 hover docs, which are read-only help and **never** a schema-driven form.

**Open questions for tech lead**
- Rollout diff data: how is a revision's pod template obtained?
- Should the ctx↔ctx diff warn when the two contexts point at the same cluster?
- The exact helm command string for the kubectl-equivalent of an upgrade that uses an extracted-chart tempdir. Rendering a meaningless tempdir path may be worse than omitting the string.
- The default for #30 propagation (Background, to match the API default?).

---

### UX-04: Health, problems, capacity, RBAC & secrets (v1.4)

**Items**
- (a): #11, #12, #13, #14, #15, #19, #20, #31, #32, #33, #40.
- (b): #25.
- Backlog: (a) low-fi #34 impersonation; (b) #21, #22, #26, #27.

**Surfaces**
- `src/components/ClusterOverview.tsx`: today a "Problem pods" count card only (around line 86). It becomes the entry point to #11.
- `src/components/Sidebar.tsx`: new nav entries. Sections today: Workloads, Networking, Config & Storage, Access Control, Cluster, Custom Resources, Helm, GitOps.
- `src/components/CommandPalette.tsx`: `NAV_ITEMS`.
- `src/components/NodeStrip.tsx`: CPU/MEM bars with inline hex colours (#12 overlay).
- `src/components/ResourceViews.tsx`: the Nodes view (#12, #25) and the Secrets view (#33).
- `src/components/ResourceDetailPanel.tsx`:
  - Summary tab (#11 explain card, #14 constraints).
  - Secret data rows with the base64 decode toggle, around lines 103–183 (#33).
  - Helm Values tab (#33).
  - SA, Role and ClusterRole panels (#32).
- `src/components/DetailPanel.tsx`: the Containers tab `DualZoneBar` (#13 hints).
- `src/components/TopBar.tsx`: the search box (#40).

**Existing patterns to reuse**
- `GenericResourceTable`: sort, column hide, and loading/error/empty states.
- Health colour vocabulary: ok / warn / bad, and Healthy / Progressing / Degraded / Missing / Suspended.
- The ArgoCD 7-bucket health strip as clickable filter cards, as the model for Problems categories.
- `expiry.ts` for certificates. There is exactly one expiry rule; never add a second threshold.
- `DualZoneBar`: request tick and limit zones.
- `onNavigate` with `navigateSearchRef` pre-filling the search box: the pattern for "jump to the object".
- ⌘K palette entries.
- Fail-open SSAR.

**Hard constraints**
- **#11 Problems**:
  - Deterministic heuristics only. **No score, no 0–100 grade.**
  - Each finding states the evidence: which field and which event.
  - Event-based hints carry an honesty note: "Events expire after about 1 hour; older causes may not appear".
  - "Explain why unhealthy" is a card in the object's own panel, not a separate screen.
- **#13 right-sizing is a hint.** Metrics are point-in-time: "Based on current usage only". Never write "recommended value" without that qualifier.
- **#14**:
  - Webhook matching reads **"may apply"**, never "applies".
  - Quotas, LimitRanges, PDBs and PriorityClasses that are matched exactly can read "applies".
- **#19**: findings name the API version and the Kubernetes version where it was removed. The deprecation table is a data file that can go stale, so show "table updated for Kubernetes ≤ X".
- **#20 unused finder**:
  - Wording is **"possibly unused"** everywhere, including the nav label, headers and the empty state.
  - **No bulk delete. No multi-select.** Per-row navigation to the object only; deleting happens from the object's own panel through the normal confirm.
  - State why the result can be wrong: dynamic references, out-of-cluster consumers.
- **#15 taxonomy** (canonical definitions live in 00) applies to every CRD-backed view in this package and to #21, #22 and #27.
- **#32 who-can**:
  - The answer must cover aggregated ClusterRoles and wildcards, or say which part is approximate.
  - SSAR answers only for the current user. "Who can" is computed from bindings, which is a different source. Copy must not conflate them.
  - Admission webhooks can still deny, so this is a hint.
- **#33 secrets**:
  - Lists show keys and sizes only. Values are fetched on reveal, per object.
  - Reveal is an explicit action. Specify whether reveal state persists across tab switches.
  - Helm Values: credential-looking keys show as redacted, and **editing requires a reveal first**. A redacted placeholder must never be sendable in an upgrade; design this so it is unreachable, not just warned about.
  - The guided Secret editor and the TLS tab keep working, and must not look degraded.
- **#31 journal**:
  - Local only (`<app_config_dir>`).
  - Secret entries show keys only. It records what Watchtower sent, not what the cluster did after.
  - Copy: "Actions performed from this app on this machine".
  - The viewer is read-only, with filter by context, kind and result.
- **#34 (low-fi)**: impersonation shows a loud, persistent banner using a fixed, impossible-to-miss style. It is not a cluster identity colour. One click exits.

**(b) notes**
- **#25**: node-pool and zone columns in the Nodes view, hidden by default via the existing column-hide mechanism. Labels are GKE / EKS / AKS / Karpenter.
- **#21, #22, #26, #27**: new views reuse `GenericResourceTable` plus the #15 states.
  - #22's suspend / resume / reconcile reuse the `ArgoCdActionBar` pattern and ConfirmModal.
  - #26's printer columns render as ordinary columns. A JSONPath failure renders as "—" with a tooltip, never as a broken table.

**Deliverables**
- IA: where Problems, Node capacity, Possibly unused, Deprecated APIs, Who-can and the Journal live (Sidebar section? Cluster section? ⌘K only?), plus the ClusterOverview entry points.
- Wireframes:
  - the Problems view (grouped by category, filter cards, finding row anatomy, evidence disclosure);
  - the explain card;
  - the node capacity view, including the NodeStrip overlay;
  - the right-sizing hint in the Containers tab;
  - the constraints section in Summary;
  - the who-can query UI (verb + resource + namespace → subjects) and "what can this SA do";
  - the secret reveal row;
  - the Helm Values redaction plus reveal-to-edit;
  - the journal list;
  - the saved-search affordance in TopBar (#40).
- States for each view: loading, empty ("No problems found in <ns>"), error, denied, CRD-absent, and partial (some namespaces forbidden). Use the 00 state vocabulary. Namespace = "all" is not a data state.
- Microcopy, including every "possibly", "may apply" and "hint" qualifier.
- Keyboard: jump-to-object, next and previous finding.
- Accessibility: severity uses icon plus text, never colour alone.
- Light and dark: severity colours and capacity bars use semantic roles.

**Open questions for tech lead**
- Problems scope: current namespace, or cluster-wide with the namespace = "all" fail-open rule?
- Refresh cadence for the Problems view.
- Whether #40 saved filters cover only the search text, or also the status tabs and column sort.
- Journal retention and rotation, as shown to the user.
- Reveal: one object at a time, or per key?

---

### UX-05: Theme, settings & platform (v1.4 theme; v1.3 log level; v1.5 platform)

**Items**
- (a): #41 light theme, #46 app log + log level, #51 auto-updater, #55 terminal launcher.
- (b): #50 proxy-url.
- Backlog, low-fi: (a) #42 custom keybindings, (a) #45 demo mode.

**Surfaces**
- `tailwind.config.js`: dark-only hex tokens today. `edge` and `edge2` are white rgba and disappear on a light background. There is no `darkMode` key.
- Hard-coded colours outside the tokens:
  - `ConfirmModal.tsx` uses `bg-gray-800/95`, `ring-gray-700` and `bg-gray-900/80`;
  - `NodeStrip.tsx` has inline-style `cpuColor` / `memColor` hex;
  - hex literals appear in about 10 components (ClusterOverview, DetailPanel, LogViewer, MultiLogViewer, NodeStrip, PodTable, ResourceDetailPanel, ResourceViews, ShellTerminal, Sparkline);
  - `rgba()` literals in TopBar (the green context dot glow) and ResourceDetailPanel.
- `src/components/ShellTerminal.tsx`: the xterm theme.
- `src/utils/clusterIdentity.ts`: six token-name colours (accent, ok, warn, orange, bad, purple).
- A **new Settings surface**. None exists today; see 00 IA.
- `src/components/ContextSwitcher.tsx`: #50 provenance.
- The trust banner in `App.tsx` (`useClusterAccess`): #50 failure copy.
- `src/App.tsx`: the global keyboard handler around lines 183–200 (⌘K, ⌘N, Esc, `r`) for #42.

**Existing patterns to reuse**
- Design tokens by **name**. The `clusterIdentity.ts` approach of storing token names and mapping them to literal class strings is the model.
- `prefers-reduced-motion` handling in `src/index.css`.
- The ContextSwitcher **text-not-shell-out** pattern: the `kubectl config use-context` string with a copy button is the model for #55's `sudo ln -s` fallback.
- `localStorage` for per-viewer preferences, wrapped in try/catch.

**Hard constraints**
- **#41**:
  - Follow the OS by default, with a manual override.
  - The six cluster identity colours must stay distinguishable from each other, and readable as chip text, in **both** themes. `warn` yellow on white is the known risk.
  - Status colours, sparklines, the log level colours and the xterm palette all need light variants.
  - Accent colour choice: a small fixed set of tokens, not a free colour picker.
  - The identity colour must never be overridable by the accent. **This cannot hold under today's token model.** `clusterIdentity.ts` stores identity colours by token name, and `"accent"` is one of the six names. It is also the hash default and the empty-context fallback. An accent picker would therefore recolour every cluster whose identity is "accent", including prod. Identity colours must become a separate role set, decoupled from the UI accent (see 00 token roles).
- **#46**:
  - Settings shows the log level and an "Open log folder" action.
  - Copy states that tokens are scrubbed and logs stay local.
  - No "send logs" or upload button. Crash reporting and analytics are rejected.
- **#50 has no proxy form.** `proxy-url` is read from the kubeconfig.
  - The UI is provenance only: "via proxy <host>" on the context row in ContextSwitcher.
  - Plus proxy-specific failure copy in the trust banner (unreachable: proxy refused or unreachable).
  - Do **not** design an app-level proxy settings screen. That would be a contract change.
- **#51 updater**:
  - Non-blocking notification. The user chooses when to install, and the user is told that the app restarts.
  - Release notes must link to a **publicly reachable** URL (GitLab Pages), never the repo or the Releases page. Those are SAML-walled.
  - States: checking, up to date, update available, downloading (progress), ready to restart, failed (with a manual-download link to the landing page).
  - An offline or failed check must be silent or low-key, never a modal.
- **#55 launcher**:
  - macOS: Settings action "Install 'watchtower' command in PATH". If `/usr/local/bin` is not writable, show the exact `sudo ln -s …` command as copyable text. No privilege-escalation prompt.
  - Linux .deb/.rpm: nothing to install in-app. Show the status "watchtower is on PATH" or "available as …".
  - AppImage: documentation text only.
  - Windows: the installer handles PATH. In-app shows status only.
  - Also in scope: the `watchtower --help` text and the `--version` output format, plus the behaviour when a second invocation focuses the window. Show a toast when forwarded args were ignored ("Context 'foo' not found; staying on 'bar'"). Unknown args are never an error dialog.
- **#45 (low-fi)**: demo mode is impossible to confuse with a real cluster.
  - A fixed, non-identity banner.
  - A fixed identity colour reserved for demo.
  - Every confirm in demo states "Demo data, nothing is sent".
- **#42 (low-fi)**:
  - A rebinding UI with conflict detection against ⌘K, ⌘N, `r` and Esc, and against OS-reserved combinations.
  - The user can reset to defaults.

**Deliverables**
- The full light palette for every token, plus the semantic role mapping from 00.
- A contrast table (WCAG AA for text, 3:1 for UI elements) for both themes, including identity chips, status pills, the log levels and the diff +/−/~ rows.
- The Settings IA and wireframe: Appearance, Keyboard, Diagnostics (log level, log folder), Updates, Command-line tool. Per-context settings stay in ContextSwitcher.
- Updater flows and every state. The launcher install flow per OS. The `--help` copy.
- #50 provenance and banner copy.
- Low-fi: the keybinding editor and the demo-mode banner.

**Open questions for tech lead**
- Does the theme need to reach the xterm terminal live, or only on next open?
- Updater check cadence and opt-out.
- How stored `"accent"` identity values migrate once identity colours are decoupled from the UI accent. Users have already saved `"accent"` in `localStorage["cluster-identity"]`, and the hash default can produce it.
- The Settings shell and its Diagnostics section (#46) are designed in 00, because #46 ships in v1.3. UX-05 adds the remaining sections. Confirm that v1.3 ships Settings with only Diagnostics.

---

### UX-06: Real-time & fleet (v2.0)

**Items**
- (a): #38 watch API, #39 multi-cluster tables, #18 resource map, #24 NetworkPolicy visualizer, #17 change timeline, #16 Prometheus / Loki backends.
- Backlog: (a) #23 routing explained, which shares the map's "explain the path" vocabulary.

**Fidelity is medium.** Deliver flows, IA, states and copy. Layouts are low-fi. v2.0 is far away, and the contracts are not designed yet.

**Surfaces**
- `src/components/TopBar.tsx`:
  - The refresh button (`RotateCw`, spinning via `useIsFetching`, 2 s cooldown, "Updated HH:MM:SS" tooltip). Its meaning changes under watch.
  - Namespace/context breadcrumbs (#39).
- `GenericResourceTable.tsx` and `PodTable.tsx`: the cluster column (#39).
- The `ResourceDetailPanel.tsx` Relationships tab (`graph.rs` tree) as the seed for #18.
- `ClusterOverview.tsx` and `NodeStrip.tsx` (#16 metrics source).
- The DetailPanel Metrics tab and LogViewer (#16 history beyond the retained pod log).

**Existing patterns to reuse**
- `[kind, context]` query keys.
- Cluster identity colours. In #39 these are the cluster column's primary encoding, with text, never colour alone.
- Per-context trust states (`ok` / `unreachable` / `auth` / `forbidden`). In #39, one cluster failing must degrade only its rows.
- The Relationships tree's collapsible rows.
- The fail-open and graceful-empty conventions (metrics-server absent results in an empty state, not an error).

**Hard constraints**
- **#38 watch**:
  - The UI shows connection state: live, reconnecting, or fallen back to polling.
  - Decide what the manual refresh button means while live. A relist? Hidden? It must stay reachable.
  - Respect reduced motion for any "row changed" flash.
- **#39 multi-cluster**:
  - The context set is a selection of several contexts.
  - Destructive actions on a mixed selection must show each row's cluster identity in the confirm. A bulk action across clusters is either refused or requires per-cluster confirmation; present both options.
  - Read-only (#29) applies per row's context.
- **#18 and #24**:
  - Scoped per namespace.
  - #24 is labelled **"approximation"** everywhere.
  - Large-graph states: a "too many nodes" state with a filter prompt, not a frozen canvas.
- **#17 timeline**:
  - Shows only retained data. The honesty copy is mandatory: "Events are kept about 1 hour; ReplicaSet, Helm and ArgoCD history go back further. This is not a full audit log".
  - Sources are labelled per entry.
  - The journal (#31) appears as "from this app".
- **#16**:
  - Endpoint config is per context.
  - Metrics-server stays the fallback. Show which source each chart uses.
  - Degrades gracefully: unreachable Prometheus means a fallback and a subtle note, not an error page.
- **#23**: routing sentences ("host → path → service:port → pods"), with per-link status. Controller-specific annotations are out of scope; say so where relevant.

**Deliverables**
- IA for Map and Timeline (new views or detail tabs?).
- The multi-context selection UX.
- Live-state indicator spec.
- Low-fi wireframes for the map, NetworkPolicy view, timeline and multi-cluster table.
- States, including per-cluster partial failure.
- Copy for every honesty qualifier.

**Open questions for tech lead**
- Where #16 endpoint configuration lives (per-context settings in ContextSwitcher, matching #29?).
- The maximum context count for #39.
- Does the map need a new graph-rendering dependency? The designer should not assume features the renderer may not have.

---

## 3. Cross-package rules

These apply everywhere. 00-overview.md must restate them as design rules.

1. **ConfirmModal is the single write choke point.**
   - Every new write confirm uses it and carries `contextLabel` / `contextColor`.
   - The PodTable bulk dialog is the one bespoke exception, and must receive the same additions.
2. **Disabled with a reason, never hidden.** The one existing exception is `GenericResourceTable`'s `onDelete` column, which is hidden on deny.
3. **Permission hints fail open.** Only an explicit deny greys anything out. Namespace = "all" is fail-open. SSAR is a hint; the error path on the action itself is never removed.
4. **Read-only mode is a hint, not a boundary.** Never call it "secure" or "locked".
5. **Never say "Apply" for Merge from file**, and never render it as `kubectl apply`.
6. **Secret values never appear** in:
   - kubectl-equivalent text;
   - journal entries;
   - diffs, unless the user has revealed that object;
   - logs.
7. **Honesty qualifiers are mandatory copy**:
   - "possibly unused" (#20);
   - "may apply" (#14 webhooks);
   - "hint" (#13, SSAR);
   - "approximation" (#24);
   - events TTL of about 1 hour (#11, #17, P1);
   - "point-in-time" (#13, drain preview).
8. **No scoring engine, no AI wording**, no "smart", no "auto-fix".
9. **No new kubectl dependency.** Any kubectl string is text plus a copy button.
10. **Design tokens by role.** No new hex in wireframes. Reference semantic roles from 00.

---

## 4. Global UX deliverable spec

**Location**: `docs/ux/`. Create the folder; it does not exist yet.

| File | Content |
|---|---|
| `docs/ux/00-overview.md` | Shared patterns, design-token roles, IA/navigation changes, consistency rules, global keymap, state vocabulary |
| `docs/ux/01-safety-patch.md` | UX-01 |
| `docs/ux/02-logs-debug.md` | UX-02 |
| `docs/ux/03-diffs-write-safety.md` | UX-03 |
| `docs/ux/04-health-capacity-rbac.md` | UX-04 |
| `docs/ux/05-theme-settings-platform.md` | UX-05 |
| `docs/ux/06-realtime-fleet.md` | UX-06 |

**Format**
- Markdown.
- ASCII or markdown wireframes. Box-drawing is fine, and each one gives its width context (480 px panel, 900 px panel, full window).
- No code and no images.
- No TSX, no Tailwind class strings, and no Rust or TS type definitions.
- Name **token roles**, not hex values. The one exception is the UX-05 palette table, which defines the values.

**Required sections in every package file (01–06)**
1. Scope: the item IDs, with their (a)/(b) class.
2. User flows, as numbered steps with branches.
3. Wireframes, per surface.
4. A states table covering loading, empty, error, denied (SSAR), read-only (#29), CRD-absent / not-looked-at (#15 taxonomy), partial, and unreachable cluster. Mark any state that is not applicable "n/a" with a reason; do not omit it.
5. Microcopy: every label, tooltip, confirm title, description, button, empty state and error line.
6. Keyboard and accessibility: focus order, shortcuts checked against the 00 keymap, screen-reader announcements, and no colour-only encoding.
7. Light and dark theme notes, using role names.
8. A constraint checklist: each hard constraint from this brief, ticked with where the design satisfies it.
9. Open questions for tech lead, including the data needs.

**00-overview.md must define, before any package spec is finalised**

- **ConfirmModal anatomy.** Today it is `max-w-sm` with a plain-string `description` and no body slot. Define:
  - size variants (sm / md / lg);
  - slot order: identity badge → title → consequence summary → body (preview list / diff / picker) → kubectl-equivalent disclosure → guardrail notice → typed confirm → footer;
  - destructive vs non-destructive styling;
  - pending and progress behaviour;
  - Esc and backdrop-click rules while pending.
  
  The PodTable bulk dialog either adopts this anatomy or mirrors it.
- **The shared diff row.** States are added, removed, changed, and "replaced" (array leaf). Define the glyphs (+/−/~/⇄), collapsed unchanged context, long-value truncation, and secret masking.
- **The state vocabulary**, from #15. Every view uses these terms consistently:

  #15 is three states: **not installed**, **no access**, and a **genuine zero**. "Not looked at" is at most an umbrella label over the first two. It is **not** a separate state, and it does **not** mean namespace = "all". With "all", the list query still runs; only the SSAR permission hint is skipped. That belongs under disable precedence, never in a view's data state.

  | State | Meaning |
  |---|---|
  | Not installed | CRD absent |
  | No access | RBAC denied |
  | Partially visible | Some namespaces forbidden |
  | Nothing here | A genuine zero |
  | Unreachable | Cluster trust state |
  | Error | Anything else |

- **Disable precedence and copy.** When several reasons apply, show one primary reason. The proposed order is below. Confirm it or change it, with a reason.
  1. in progress;
  2. read-only mode (actionable by the user: "Turn off in cluster settings");
  3. RBAC denied (`NO_PERMISSION_*` copy);
  4. server capability missing (for example `pods/resize`).
  
  Also decide whether read-only **disables** the delete column (keeps it visible) or follows the `onDelete` hide-on-deny exception. The tech lead recommends that it disables, because the user set read-only and can undo it, so hiding would confuse. This is open for the UX to confirm.
- **Token roles**, needed before UX-05 picks values:
  - surfaces: base, panel, card, overlay/modal;
  - borders: edge and strong edge;
  - text: ink, mute, dim;
  - status: ok, warn, bad, info, progressing;
  - accent (UI accent, user-pickable under #41);
  - identity colours: six, as a **separate role set decoupled from the UI accent**, so that an accent change can never recolour a cluster;
  - diff add, remove and change;
  - log levels;
  - focus ring.
  
  Map every hard-coded colour found today (ConfirmModal grays, NodeStrip inline hex, about 10 files with hex literals, TopBar rgba) to a role.
- **IA changes.**
  - The **Settings** entry point (Sidebar footer gear + ⌘, ?) and its sections. Settings holds app-wide preferences only: theme, keymap, diagnostics, updates, CLI tool. **00 designs the Settings shell and the Diagnostics section (#46: log level, open log folder)**, because #46 ships in v1.3, before UX-05's wave.
  - **Per-context settings stay in ContextSwitcher's `IdentityEditor`**: colour, label, read-only (#29) and guardrails, and the #16 endpoints. Read-only is stored in the `cluster-identity` store; it is not an app-wide setting.
  - New nav entries (Problems, capacity, possibly unused, deprecated APIs, who-can, journal, map, timeline): which Sidebar section each goes in, and its ⌘K presence.
- **The global keymap.** Existing shortcuts are ⌘K (palette), ⌘N (new), Esc, and `r` (refresh, not inside inputs). Define the reserved set and the conflict rules that #42 and every package must check against.
- **Copy rules**: §3's cross-package rules restated as a style guide, plus tone (terse, factual, no exclamation marks) and the qualifier glossary.

---

## 5. Run plan: parallel or sequential

Recommendation: **three waves**, with **no more than three concurrent UX instances**. Do not launch six because there are six packages. Parallel instances that each re-derive shared patterns produce divergent modals and copy, which costs more than it saves.

**Wave 1: one instance, sequential.**
- `00-overview.md` first, then `01-safety-patch.md`.
- 00 defines the ConfirmModal anatomy, diff row, state vocabulary, disable precedence, token roles, IA and keymap. Everything else depends on these.
- UX-01 is the first consumer of the ConfirmModal anatomy, and v1.2.1 ships first. Doing both in one instance validates the anatomy against a real case immediately.
- The tech lead reviews 00 before wave 2 starts. 00 is the contract between parallel instances.

**Wave 2: three instances in parallel, after 00 is approved.**
- `02-logs-debug.md`.
- `03-diffs-write-safety.md`. This is the heaviest consumer of the ConfirmModal and diff-row patterns, and it owns the read-only design that UX-02 (#5) and UX-04 must reference.
- `04-health-capacity-rbac.md`.
- Coordination points:
  - UX-03 ↔ UX-04 on #33 redaction vs #37 Helm upgrade preview (reveal-to-edit);
  - UX-03 ↔ UX-04 on #28 secret masking vs #31 journal redaction (one masking rule);
  - UX-02 ↔ UX-03 on #5 going through the write ConfirmModal and being blocked by read-only.
- Each instance must read 00 and the other wave-2 briefs in this file, not their outputs.

**Wave 3: up to two instances, after wave 2.**
- `05-theme-settings-platform.md`. It can start during wave 2 once 00's token roles are fixed, if capacity allows. Theme values do not block the other packages, because they reference roles.
- `06-realtime-fleet.md`, at medium fidelity. It is the furthest release, and its contracts are not designed.

**Why this order**
- The shared ConfirmModal anatomy, diff row, state vocabulary and token roles must exist before anything that renders them.
- v1.2.1 is a fast safety patch, so its design must not wait on v1.3+ work.
- Theme comes later because it is pure values over roles, and putting it later avoids repainting wireframes.

**Instruction to the main session when launching the UX specialist(s)**
- Pass this file's path plus the package ID(s).
- Restrict writes to `docs/ux/`.
- Restate: design only, no code, no command signatures; data needs go to open questions.
