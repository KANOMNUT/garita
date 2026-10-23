# UX 03: Diffs and write safety (v1.3)

Status: wave 2 draft, for tech lead review. Depends on `docs/ux/00-overview.md`, cited by contract name: CONFIRM-ANATOMY, DIFF-ROW, STATE-VOCAB, DISABLE-PRECEDENCE, TOKEN-ROLES, KEYMAP, COPY-RULES, A11Y-BASELINE. It also builds on `docs/ux/01-safety-patch.md` (drain, P2 confirms) and does not redefine anything in them.
Baseline: Watchtower v1.2.1 as shipped. Everything below was read from the v1.2.1 code. Where the brief and the code disagree, section 1 says so.
Design only. No code, no Tauri command signatures, no Tailwind classes, no hex. Data needs are in section 14. `CLAUDE.md` wins over this file.

## Contents

1. Findings from the code (they change the brief's assumptions)
2. Scope
3. Shared patterns added by this package: PREVIEW-GATE, KUBECTL-EQUIV, GUARDRAILS, and one amendment to DIFF-ROW
4. #6 Neat YAML
5. #7 Field-manager blame
6. #8 Resource diff
7. #9 Rollout-history template diff
8. #10 YAML Save: server dry-run diff
9. #37 Helm upgrade preview
10. #28 kubectl equivalent
11. #29 Read-only mode and guardrails, including the write-surface inventory
12. #30 Delete propagation picker
13. Drain force-delete (extends 01 section 2.8), P4, #46 delta, #36 and #43 (low-fi)
14. States matrix, keyboard, accessibility, light and dark
15. Constraint checklist
16. Open questions for tech lead, and decisions needed from the user
17. Microcopy index

---

## 1. Findings from the code

Read on 2026-10-03 from the v1.2.1 tree. Numbered F3-n so they do not collide with 00's F1 to F11.

| # | Finding | Where | Consequence for this package |
|---|---|---|---|
| F3-1 | **YAML Save is a single click with no confirm, no identity badge and no permission gate, in two places.** The pod YAML tab (`DetailPanel.tsx` ~1143) and every other kind (`ResourceDetailPanel.tsx` ~3283). It is a whole-object typed replace. Helm Values "upgrade" (`ResourceDetailPanel.tsx` ~3190) is the same: one click, no confirm. | `DetailPanel.tsx`, `ResourceDetailPanel.tsx` | #10 and #37 *create* the confirm for these writes. They are not "add a diff to an existing confirm". #28, #29 and P4 apply to both YAML Save sites. |
| F3-2 | **The pod header button labelled "Restart" calls `deletePod` directly, with no confirm** (`DetailPanel.tsx` 497 to 509). A separate "Delete pod" in the overflow menu does confirm (line 536). Reachable, so a mislabelled, unconfirmed pod delete sits one click from the header. P2 in 01 covered the workload Restart and missed this one. | `DetailPanel.tsx` | Added to the inventory (section 11.5). Recommendation: it gets the same `sm` confirm as the workload Restart, and its label stays "Restart" only if the confirm says plainly that it deletes the pod. See D3-5. |
| F3-3 | **The brief names one bespoke write dialog (PodTable bulk). There are at least eight write dialogs off ConfirmModal.** Hand-rolled: PodTable `ConfirmBulkModal` (`PodTable.tsx` 340), Sidebar namespace delete (`Sidebar.tsx` 307 to 329: no typed confirm, deletes a whole namespace), ArgoCD app delete (`ResourceDetailPanel.tsx` 3338 to 3405, with raw gray utilities). Own modal hosts: `ResourceEditor`, `ResourceCreator`, `HelmInstallModal`, `MergeFromFileModal`. | many | #28 and #29 must reach all of them. Section 11.5 lists each, with how it adopts CONFIRM-ANATOMY by mirroring (00 section 2.6 rule), not by rewrite. |
| F3-4 | **`ResourceEditor` and `ResourceCreator` render no identity badge.** `ClusterBadge` is imported only by `HelmInstallModal` and `MergeFromFileModal` among the four. `ResourceEditor`'s primary button is labelled "Apply", next to a Patch tab that is `kubectl patch --type=merge`. | `edit/ResourceEditor.tsx`, `ResourceCreator.tsx` | Breaks C1 (identity badge mandatory on every write confirm). Fixed by this package (11.5, 10.6). "Apply" is a label decision (D3-8). |
| F3-5 | **Esc handling is split across three mechanisms.** ConfirmModal uses the modal-layer registry (`useModalLayer`) and swallows Esc in the capture phase. `ResourceEditor`, `ResourceCreator` and `HelmInstallModal` each add a raw window `keydown` listener. `MergeFromFileModal` has no Esc handler that I could find. | `ResourceEditor.tsx` 101, `ResourceCreator.tsx` 66, `HelmInstallModal.tsx` 65 | Any confirm opened *over* one of these (the read-only turn-off confirm, a #10-style preview) would also close its host on Esc. This violates KEYMAP K3. Raised as a tech-lead question (Q3-8). The designs below assume K3 is honoured by all four hosts. |
| F3-6 | **Writes that are one click with no confirm today:** ArgoCD Sync without prune, Refresh and Hard Refresh (`ResourceDetailPanel.tsx` 2712 to 2735); node Cordon and Uncordon from the button (392 to 395); Add taint (411); Remove taint except NoExecute (424); the pod header "Restart" (F3-2); port-forward start and stop. | `ResourceDetailPanel.tsx`, `DetailPanel.tsx` | #28's equivalent can only attach where a confirm exists. The inventory marks these "none". D3-5 decides what to do about them. |
| F3-7 | **`usePermissions` reaches fewer sites than assumed.** It checks `delete`, `patch`, `create`, three verbs. It is not used by: Helm rollback and uninstall, ArgoCD History rollback, ArgoCD sync and refresh, Sidebar namespace delete, taints, `DetailPanel` pod actions and YAML Save, `ResourceDetailPanel` YAML Save and Helm Values, Merge from file, Helm install, `ResourceCreator`. YAML replace needs the `update` verb, which is not among the three. Helm has no `RBAC_RESOURCE` row on purpose. | `useResources.ts` 1448 to 1536 | P4 for YAML Save needs a fourth verb (Q3-11). P4 for Helm Values has no honest RBAC hint (13.2). |
| F3-8 | **The YAML view is a `<pre>`; edit mode is a `<textarea>` seeded from the raw text.** Neither has a line model or a token model. | `ResourceDetailPanel.tsx` 3267 to 3331, `DetailPanel.tsx` 1127 to 1189 | Decides #7 (a line gutter is impossible, section 5) and bounds #6 and #43. |
| F3-9 | **`GenericResourceTable`'s delete button is `opacity-0` until the row is hovered.** | `GenericResourceTable.tsx` 279 | A disabled delete icon is just as invisible. For read-only mode the strip above the table is the *only* persistent signal. D-1 in 00 should say so (section 11.3). Keyboard focus must also reveal the button. |
| F3-10 | **`RevisionInfo` carries `revision`, `image`, `age` only**, so the Rollout History rows show one image (`WorkloadActions.tsx` 268). A template diff has nothing to compare. | `WorkloadActions.tsx` `RolloutHistory` | Data need Q3-4 (the brief's own open question). |
| F3-11 | **Jobs and propagation.** In the Kubernetes API, `batch/v1` Jobs default to *orphaning* dependents when the delete request names no propagation policy; `kubectl` sends Background explicitly. `delete_resource` today takes no propagation argument. If it sends none, **deleting a Job from Watchtower may leave its pods running**. I could not confirm what the backend sends. | `useResources.ts` 1244 (`delete_resource`) | The #30 picker must default to Background *explicitly* and say "kubectl's default". Q3-9 asks the tech lead to check today's behaviour; it may be a live bug independent of this feature. |
| F3-12 | **ArgoCD's cascade/orphan choice is a finalizer choice, not `propagationPolicy`.** Its dialog is also hand-rolled (F3-3). | `ResourceDetailPanel.tsx` 3352 to 3367 | Its kubectl equivalent must not render `--cascade=`. It must not be merged with #30's picker. |
| F3-13 | The drain dialog's attention phase ships the *pointer* variant from 01 section 2.7: "To remove these pods anyway, delete them from the Pods view. Deleting bypasses the PodDisruptionBudget." (`NodeDrainDialog.tsx` ~428). ArgoCD History is already in 01's "state B" copy, and the rollback button is disabled with a reason while auto-sync is on. | `NodeDrainDialog.tsx`, `ResourceDetailPanel.tsx` 2573, 2624 | Force-delete (13.1) replaces the pointer line. P5 needs no work here. |
| F3-14 | **Doc-vs-code check.** CLAUDE.md lists node delete as a `requireTyping` site. The node delete confirm in `NodeOverview` (`ResourceDetailPanel.tsx` 517 to 528) has no `requireTyping`; the generic cluster-scoped typed confirm lives in the "all other kinds" branch, which excludes `nodes`. | `ResourceDetailPanel.tsx` | Listed in the inventory as "verify". Not designed here; flagged so the doc or the code is corrected. |
| F3-15 | `setClusterIdentity` writes only `color` and `label` (00 F9, Q4). | `clusterIdentity.ts` 76 to 83 | #29 stores two more fields on the same record. The writer must preserve fields it does not own. Cited, not re-derived. |
| F3-16 | The YAML `<pre>`, the Helm Values `<pre>`/`<textarea>` and the pod YAML tab paint an inline dark background (`#070a10`) at six sites. The ArgoCD delete modal copies ConfirmModal's old raw `gray-800/700/900` utilities. | `ResourceDetailPanel.tsx` 3221, 3243, 3309, 3328; `DetailPanel.tsx` 1167, 1186 | Roles for UX-05: the code surface maps to `surface-input`. Noted in section 14.5. |

---

## 2. Scope

| ID | Item | Class | Where it lives |
|---|---|---|---|
| #6 | Neat YAML toggle (display only) | (b) in the brief, specified here because it constrains #7 and #10 | YAML tab, both panels |
| #7 | Field-manager blame (read-only) | (a) | Summary tab section, both panels |
| #8 | Resource diff, ns to ns and context to context | (a) | Header action in `ResourceDetailPanel`; palette |
| #9 | Rollout-history template diff | (a) | `RolloutHistory`, rollback confirm |
| #10 | Server-side dry-run diff before YAML Save | (a) | YAML tab, both panels |
| #37 | Helm upgrade preview | (a) | Helm Values tab |
| #28 | kubectl equivalent in write dialogs | (a) | Slot 6 of every write dialog |
| #29 | Read-only mode and guardrails | (a) | `IdentityEditor`, TopBar, Sidebar chip, ContextSwitcher, every write site |
| #30 | Delete propagation picker | (a) | Delete confirm for owner kinds |
| Drain force-delete | Deferred from v1.2.1 (D1-3) | (a), extends 01 | Drain attention phase |
| P4 | Permission hints for YAML Save and Helm Values | (b) | Folded into #10 and #37 |
| #46 | App log file: only what 00 section 7.2 lacks | (a) small | Settings, Diagnostics |
| #36 | In-place pod resize | (a) low-fi, backlog | Pod Containers tab |
| #43 | Inline field docs in the YAML editor | (a) low-fi, backlog | YAML tab |

Also fixed because the brief's property ("every mutation call site") demands it: F3-2 (pod header Restart) and F3-4 (missing identity badges).

---

## 3. Shared patterns added by this package

These are named so UX-02 (#5 debug container) and UX-04 (#33 reveal) can cite them. They extend 00; they do not fork it.

### 3.1 PREVIEW-GATE

A write dialog that shows *what will change* before the user commits. Used by #9 (rollback), #10 (YAML Save), #37 (Helm upgrade). It is CONFIRM-ANATOMY at size `lg`, with phases (section 2.4 of 00) and these additions.

**Phase flow**

```
review.loading ──► review.diff        (rows, primary enabled)
              ├──► review.nochange    ("No differences", primary disabled)
              ├──► review.rejected    (server said no: blocking)
              └──► review.unavailable (could not ask: informational)
review.diff ─ primary ─► running ─► result | error
```

**The one rule that distinguishes the two failure kinds** (this is the 01 section 2.5 "preview failed" rule, generalised):

| Kind | Meaning | Primary button | Typed confirm |
|---|---|---|---|
| `rejected` | The API server, or Helm's template engine, *answered no*. The write would fail. | Disabled, label unchanged. Footer offers "Back to editor". | n/a |
| `unavailable` | Watchtower could not ask: transport error, timeout, preview command missing. The write may still be fine. | Enabled, label becomes "{Verb} without preview". | **Required**, the object name (same logic as 01 "Drain without preview": the user cannot see what will change). |

A rejected preview is never "informational". An unavailable one is never a block. Do not call either "fail open" (that term is reserved for SSAR hints, 00 section 5.1).

**Slots used** (CONFIRM-ANATOMY numbering)

| Slot | Content in PREVIEW-GATE |
|---|---|
| 1 | Identity badge (C1). Also the read-only strip never appears here; read-only blocks the dialog from opening. |
| 2 | Title: verb plus object. Non-destructive style unless the consumer says otherwise (C2). |
| 3 | Consequence summary, 1 to 3 lines. |
| 4 | Body: a summary chip row ("7 changes"), then DIFF-ROW rows, then the optional callout. |
| 5 | Status line: server rejection verbatim, or a conflict. |
| 6 | KUBECTL-EQUIV, collapsed. |
| 7 | GUARDRAIL-NOTICE when the context has guardrails. |
| 8 | Typed confirm: only for `unavailable`, for a guardrail, or when the consumer requires it. At most one typed field (D3-6). |
| 9 | Footer. |

**Point-in-time.** Every PREVIEW-GATE body carries one dim line: "Compared {HH:MM:SS}. The cluster can change before you confirm." (matches 00 qualifier "point-in-time", drain 01 section 2.4).

### 3.2 KUBECTL-EQUIV (slot 6)

Defined fully in section 10. Summary: a collapsed disclosure labelled "kubectl equivalent", monospace text, a Copy button, a one-line honesty footer, and masking rules for Secrets.

### 3.3 GUARDRAILS

Per-context settings stored beside colour and label: **Read-only mode**, **Confirm writes by typing the cluster label**, **Limit bulk actions to N items**. Defined fully in section 11.

### 3.4 Amendment to DIFF-ROW (needs a decision, D3-1)

00 section 3.1 says arrays are leaf `⇄ replaced` rows "everywhere" and never expanded into per-element rows. That rule is correct for **writes**, where RFC 7386 replaces an array wholesale. It is the wrong default for **reading** two objects: the single most common thing a user wants from #8 and #9 is "which container's image changed", and `containers`, `env`, `ports` and `volumes` are all arrays. A diff that says "containers: array, 2 items to 2 items" answers nothing.

Proposed amendment, kept inside the spirit of the rule:

- The top-level row stays `⇄ replaced` with the item counts. The glyph, the word and the "View both" toggle are unchanged.
- "View both" gains a second panel above the two text blocks, **"Inside this array"**, shown only when every element of both sides is an object with a unique `name` (containers, env, ports, volumes, volumeMounts, imagePullSecrets). Rows inside use `+`, `−`, `~` keyed by `name`, e.g. `~ [api] image   v2.3.1 → v2.2.0`.
- That panel carries a fixed header line: **"For reading only. Watchtower writes the whole array."** So no row implies an element-wise merge.
- Default state: **expanded** in #8 and #9 (read-only comparisons, no write semantics); **collapsed** in #10 and #37 (write previews, where the top-level `⇄` row is the contract the user is confirming).
- Arrays without unique names (args, command, rules, subjects) get no "Inside" panel: text blocks only.
- Merge from file keeps its exception (00 section 3.5): leaf rows, no "Inside" panel.

If the user rejects the amendment, #8 and #9 fall back to text blocks and lose most of their value. Say so when deciding.

---

## 4. #6 Neat YAML (display only)

### 4.1 Job and rule

The job: read a manifest without 80 lines of `managedFields`, `status` and `last-applied-configuration`, and copy something you can reuse. The rule (brief): display only. **Neat never feeds the edit seed, never feeds Save, never feeds the dry-run.** F3-8: view is a `<pre>` of the raw text, edit is a `<textarea>` seeded from that same raw text; neat must be a *separate* derived string.

### 4.2 Placement

Top-right button cluster of the YAML tab, which today holds "copy" and "edit". The cluster gains a toggle chip, placed first: **Neat**. It is a two-state toggle chip (the project's `Toggle` chip style, UX-02 reuses it), `aria-pressed`, not a menu.

```
YAML tab, 480 px panel, view mode
┌──────────────────────────────────────────────┐
│                     [Neat ○] [copy] [edit]   │
│ apiVersion: apps/v1                          │
│ kind: Deployment                             │
│ metadata:                                    │
│   managedFields: ...   <- shown when Neat is │
│   ...                     off                │
└──────────────────────────────────────────────┘

Neat on
│                     [Neat ●] [copy] [edit]   │
│ Hiding managedFields, status, 5 more.  [What?]│
│ apiVersion: apps/v1                          │
```

- With Neat on, a one-line dim note appears above the text: "Hiding managedFields, status and 5 other fields. Display only; editing shows the full object." The note's "What?" opens a small popover with the closed list (4.4).
- Default: **off** (full object, same as today). The choice is remembered per viewer (localStorage, wrapped in try/catch, panel still renders without it). D3-2.

### 4.3 Edit mode (the critical behaviour)

Entering edit mode while Neat is on:

1. The text shown becomes the **full** object, seeded from the raw text exactly as today.
2. The Neat chip stays visible but is `aria-disabled`, shows the state **off**, and its reason is "Neat is display only. Cancel editing to switch." (D1: focusable, reason as description.)
3. A one-line notice sits in the existing amber editing bar: "Editing the full object, including managedFields and status. Neat is display only and is never saved."
4. Cancel returns to view mode and restores the user's previous Neat setting.

```
YAML tab, edit mode
┌──────────────────────────────────────────────┐
│ Editing the full object. Neat is display     │
│ only and is never saved.                     │
│ [Neat (disabled)]      [cancel] [Review & save…]│
│ ┌──────────────────────────────────────────┐ │
│ │ (textarea, full raw YAML)                │ │
```

Rejected alternative: editing the neat text and merging the hidden parts back. It is a round-trip of a stripped object by another name, which is the exact failure the brief forbids.

### 4.4 What Neat hides (closed list, shown in the popover)

`metadata.managedFields`, the `kubectl.kubernetes.io/last-applied-configuration` annotation, the whole `status` block, `metadata.uid`, `metadata.resourceVersion`, `metadata.generation`, `metadata.creationTimestamp`. Nothing else. A user who wants more hidden uses their own tooling. The list is closed so "Neat" never silently differs between kinds.

### 4.5 Copy

"copy" copies **what is shown**. With Neat on the label is "copy neat" and the tooltip is "Copies the neat YAML, without the hidden fields." Never silently copy the raw text under a neat label, and never the reverse.

### 4.6 States

| State | Behaviour |
|---|---|
| Loading | Existing skeleton. The Neat chip is disabled with no reason text until data arrives. |
| Empty | n/a: an object always has fields. |
| Error | Existing YAML load error. Neat chip disabled with reason "No YAML loaded." |
| Denied | The YAML tab's existing error. STATE-VOCAB No access. |
| Read-only | n/a: viewing is not a write. The *edit* button follows 11.4. |
| Not installed | n/a for the toggle; STATE-VOCAB Not installed for CRD-backed kinds is the panel's own. |
| Partial / Unreachable / "all" | n/a for the toggle (single object). Unreachable uses STATE-VOCAB. |
| Nothing hidden | The list yielded nothing to hide: note reads "Nothing to hide for this object." The toggle still works. |

### 4.7 Where neat is computed

There is no YAML parser on the frontend (CLAUDE.md, guided edit). Data need Q3-1: where the neat string comes from. UX does not care, but the contract is: a string, derived, never the Save input.

### 4.8 Components touched

`src/components/ResourceDetailPanel.tsx` (YAML tab), `src/components/DetailPanel.tsx` (pod YAML tab). Both have the same markup today; they should share one component, or at least one behaviour.

---

## 5. #7 Field-manager blame

### 5.1 Job

"Who last set this field? Why does my change keep coming back?" The managed-by banner already answers the coarse version for ArgoCD and Flux. This is the precise version, from `managedFields`.

### 5.2 Decision: a Summary-tab section, not a gutter, not a tab

**Why not a gutter.** F3-8: the YAML view is a `<pre>` of a plain string and edit is a `<textarea>`. A gutter needs a line-to-field-path map in both modes, and in edit mode the text changes under the user's hands, so the map would be wrong after the first keystroke. Blame data is keyed by field *path*, not by line. A gutter would also need the YAML text and the `fieldsV1` tree to be parsed against each other on every render.

**Why not a tab.** The pod panel already has nine tabs and the strip scrolls horizontally (`overflow-x-auto`). A tenth tab hides itself.

**Decision:** a collapsible **"Field managers"** section in the Summary tab of both panels, below Conditions. A "See field managers" link in the managed-by banner of `ResourceEditor` and the Summary tab jumps to it.

### 5.3 Wording (hard rule from the brief)

No SSA vocabulary. Never "owner", "ownership", "owns", "force", "conflict", "claim", "apply manager". Use: **field managers**, **last set by**, **wrote**. The section never suggests the user can change who manages a field; it is read-only.

### 5.4 Wireframe, 480 px panel

```
Summary tab
┌──────────────────────────────────────────────┐
│ ▾ Field managers (4)                         │
│   Who last wrote each field, as recorded by  │
│   the API server. Read-only.                 │
│                                              │
│   Find a field  [ replicas____________ ]     │
│                                              │
│   argocd-application-controller              │
│   Apply · 3m ago · 41 fields            [▸]  │
│   kube-controller-manager                    │
│   Update · 12m ago · 6 fields           [▸]  │
│     status (subresource)                     │
│   kubectl-client-side-apply                  │
│   Update · 2d ago · 19 fields           [▸]  │
│   watchtower                                 │
│   Update · 5m ago · 2 fields            [▸]  │
│                                              │
│ Managed fields reflect what the API server   │
│ recorded. Not every tool writes the same way.│
└──────────────────────────────────────────────┘

Expanded manager (one at a time on narrow panels)
│   argocd-application-controller              │
│   Apply · 3m ago · 41 fields            [▾]  │
│     spec.replicas                            │
│     spec.template.spec.containers[api].image │
│     spec.template.spec.containers[api].env   │
│     … 38 more                      [Show all]│

Find a field, matching "replicas"
│   2 matches                                  │
│   spec.replicas       last set by argocd-application-controller (3m ago)│
│   status.replicas     last set by kube-controller-manager (12m ago)     │
```

### 5.5 Behaviour

- Manager name is shown **verbatim** from the object. Watchtower never rewrites or classifies it (no "this is Helm"). The *Operation* word is `Apply` or `Update` as recorded; a subresource, if any, is a dim line.
- Sort: most recently written first. Time is relative with the absolute time on hover (COPY-RULES 9.6).
- Field paths are rendered from `fieldsV1` into readable dotted paths. Keyed list entries read `containers[api]` (by `name`) or `ports[8080/TCP]`, not the raw `k:{"name":"api"}`. Paths are monospace and wrap.
- "Find a field" is a substring match over all managers' paths; results list the most recent writer first. A field can appear under two managers when both wrote it; the result shows all of them.
- Cap: 50 paths per manager until "Show all".
- Watchtower itself appears as whatever manager name the field-manager string carries; no special treatment. Guided edit's patches show up as that name once written.
- The footer honesty line is mandatory: "Managed fields reflect what the API server recorded. Not every tool writes the same way."
- If the object is a Secret, paths show but values never do (nothing here shows values).

### 5.6 States

| State | Copy / behaviour |
|---|---|
| Loading | Three skeleton rows. SR: "Loading field managers." |
| Nothing here | "No field manager data on this object." + "The API server didn't record any, or it was created before field management was enabled." |
| Error | "Couldn't load field managers: {message}." + Retry |
| Denied | STATE-VOCAB No access: "You don't have access to {kind}s in {ns}. Your account can't get {resource}. Ask a cluster admin for the get permission." |
| Read-only | n/a: read only |
| Not installed | n/a: derived from the object's own metadata |
| Partial | n/a: one object |
| Unreachable | STATE-VOCAB Unreachable |
| Namespace "all" | n/a: the object carries its own namespace |
| No match in find | "No field matches "{text}"." |

### 5.7 Accessibility

The section header is a disclosure button with `aria-expanded`. Each manager row is a disclosure with its field count in its accessible name ("argocd-application-controller, Apply, 3 minutes ago, 41 fields, collapsed"). The find box has a visible label. Match counts announce politely.

### 5.8 Data and components

`get_resource_json` already returns the raw object with no filtering (CLAUDE.md, guided edit), so `managedFields` should be present (Q3-2 confirms). **No new backend is expected.** Components: `ResourceDetailPanel.tsx` Summary tab, `DetailPanel.tsx` Summary tab, `edit/ResourceEditor.tsx` (banner link only).

---

## 6. #8 Resource diff (namespace to namespace, context to context)

### 6.1 Job

"Is staging really the same as prod?" and "what drifted between these two namespaces?" It is a read. It writes nothing, so it is not a write confirm; it borrows the dialog shell (CONFIRM-ANATOMY sizes, focus trap, Esc layering) for behaviour, not for the destructive/non-destructive styling.

### 6.2 Entry points

- A **Compare** icon button in the `ResourceDetailPanel` header, left of the pencil. Tooltip: "Compare with another namespace or cluster". It is not a write, so it is never disabled by read-only mode or RBAC deny.
- Command palette: "Compare {kind} {name} with…" while a resource is selected.
- Not offered for kinds with no detail panel (Repositories, `crd-instances`) or for `helm` (no object to diff; Helm's History tab is the place, out of scope).
- Pods are not offered: pod diffs are noise (status, node, IPs). Recommendation, easy to reverse.

### 6.3 Flow

1. User opens Compare. A dialog (`lg`) opens in `review` phase: the picker.
2. Left side is fixed: the current object, with its cluster badge.
3. User chooses the other side with a segmented control: **Another namespace** or **Another cluster**.
4. Name defaults to the same name and is editable. (This makes "same namespace, different name" work without a third mode.)
5. **Compare** runs both reads and shows the diff in the same dialog.
6. Footer gains "Swap sides" and "Change comparison" (back to the picker). Close ends it.

### 6.4 Wireframe: picker, 672 px dialog

```
┌────────────────────────────────────────────────────────────────┐
│ Compare Deployment api                                         │
│                                                                │
│  This object                      Compare with                 │
│  ● prod-eu-1                      (•) Another namespace        │
│  namespace shop                   ( ) Another cluster          │
│  api                                                           │
│                                   Namespace  [ staging      ▾ ]│
│                                   Name       [ api            ]│
│                                                                │
│ Ignored in the comparison: status, managed fields, uid,        │
│ resourceVersion, generation, creation time, name and namespace.│
│ [ ] Include status                                             │
│                                                                │
│                                    [Cancel]  [Compare]         │
└────────────────────────────────────────────────────────────────┘

Another cluster mode
│                                   Cluster    [ staging-eu-1 ▾ ]│
│                                   Namespace  [ shop         ▾ ]│
│                                   Name       [ api            ]│
```

- The cluster list is the enabled contexts, each shown with its identity label and colour dot (text plus dot, never colour alone).
- The other side's namespace list loads from that cluster. While loading the select shows "Loading namespaces…".
- Cluster-scoped kinds hide the Namespace select.
- "Ignored in the comparison" is a closed list (the 4.4 family plus name and namespace, which differ by design). The only toggle is "Include status"; default off.

### 6.5 Wireframe: diff, 672 px dialog

```
┌────────────────────────────────────────────────────────────────┐
│ Compare Deployment api                                         │
│ ● prod-eu-1 / shop      vs      ● staging-eu-1 / shop          │
│ −  only in prod-eu-1    +  only in staging-eu-1   ~  differs   │
│ Compared 14:02:11. Either side can change after this.          │
│                                                                │
│  6 differences                                                 │
│  ~  spec.replicas                       6  →  2                │
│  ~  spec.strategy.rollingUpdate.maxSurge   25%  →  1           │
│  −  metadata.annotations.owner          platform-team          │
│  +  metadata.labels.tier                web                    │
│  ⇄  spec.template.spec.containers   array, 2 items → 2 items   │
│     ▾ Inside this array (for reading only. Watchtower writes   │
│       the whole array.)                                        │
│       ~ [api] image      reg/api:2.3.1  →  reg/api:2.2.0       │
│       ~ [api] resources.limits.memory   1Gi → 512Mi            │
│  ⋯  41 unchanged fields                              [Show]    │
│                                                                │
│                    [Swap sides]  [Change comparison]  [Close]  │
└────────────────────────────────────────────────────────────────┘
```

- **Direction words.** There is no old and new here. The header states the legend in plain words: `−` only in the left object, `+` only in the right, `~` differs. Each row's accessible name repeats it ("only in prod-eu-1", "differs").
- Row anatomy, collapsed context, long-value truncation and the 200-row cap are DIFF-ROW 3.2 to 3.6, unchanged. Arrays use the 3.4 amendment (expanded by default here).
- **Secrets.** `data` and `stringData` values are masked per DIFF-ROW 3.4: `••••••••` plus byte count. A key present on both sides with different content shows `~` "differs" and no values. v1.3 has no reveal (UX-04 #33 owns it); the comparison is useful at key level.
- Same-cluster warning: if both contexts resolve to the same API server (data need Q3-3) *and* the namespace and name are also the same, an info line above the rows reads "prod-eu-1 and prod-eu-2 use the same API server. You are comparing an object with itself."

### 6.6 States

| State | Copy / behaviour |
|---|---|
| Loading namespaces | Select shows "Loading namespaces…". Compare disabled. |
| Loading diff | DIFF-ROW skeleton, status "Comparing…". Both reads run in parallel. |
| No differences | "No differences." / "These two objects match after ignoring status and managed fields." (00 3.6) |
| Other side not found | Info block, not an error: "{kind} "{name}" doesn't exist in {cluster} / {namespace}." + "Check the name, or pick another namespace." Footer: Change comparison. |
| Other side: not installed | STATE-VOCAB Not installed, naming the cluster: "{Thing} isn't installed on staging-eu-1." (CRD kinds only) |
| Other side: no access | STATE-VOCAB No access: "You don't have access to {things} in staging-eu-1 / shop. Your account can't get {resource}. Ask a cluster admin for the get permission." The left side still renders, with "Couldn't read the other side." |
| Other side unreachable | STATE-VOCAB Unreachable: "Can't reach staging-eu-1." + the trust message + Retry. Left side unaffected. This is the common case for context to context. |
| Error | "Couldn't load {kind} "{name}" from {cluster}: {message}." + Retry |
| Too many rows | DIFF-ROW 3.6: first 200, then "N more differences. Narrow the comparison to see them." (In v1.3 the only lever is leaving "Include status" off.) |
| Read-only | n/a: reads only. |
| Partial | n/a: one object per side. |
| Namespace "all" | n/a: the picker always chooses a concrete namespace. |

### 6.7 Keyboard

Enter in the picker activates Compare. In the diff: Tab reaches the row expanders; `⌥↓` and `⌥↑` jump to the next and previous changed row (proposed, K6 entry in 16.1; no single-letter keys because K1 forbids them while a dialog is open); `⌘F` finds in the diff (00 proposed). Esc closes (`lg` rule, CONFIRM-ANATOMY 2.5).

### 6.8 Components and data

New dialog component; `ResourceDetailPanel.tsx` (header button), `CommandPalette.tsx` (entry), shared diff rows. `src/utils/mergePreview.ts` is the visual source, but its `previewRows` is a one-sided walk of the *desired* object and cannot be reused as-is for a two-sided comparison; a sibling helper is needed (Q3-3). Data: the existing raw-object read (`get_resource_json`) already takes a `context`, so neither side should need a new command; `list_namespaces` takes a context too.

---

## 7. #9 Rollout-history template diff

### 7.1 Job

Before rolling back a Deployment, see **what the rollback will change**. Today the history row shows one image and a Rollback button (`WorkloadActions.tsx` 255 to 281), and the confirm says only "Roll back "api" to revision #N? This will perform a rolling restart."

### 7.2 Flow

Two entry points, one diff body (PREVIEW-GATE):

- **Rollback…** (existing button) opens the rollback confirm, now `lg`, with the diff already in the body. A user who clicks Rollback straight away still sees the consequence.
- **Compare** (new, second button on each row, left of Rollback) opens the same body read-only. Footer: [Close] and a link-style "Roll back to this revision…" that closes this dialog and opens the rollback confirm.

The diff direction is the rollback's direction: **left = current, right = revision #N**, legend "−  in the current template   +  in revision #N   ~  differs".

### 7.3 Wireframe: rollback confirm with diff, 672 px

```
┌────────────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                                    │
│ ⓘ Roll back api to revision #4                                 │
│ Restores the pod template from revision #4 and rolls the pods. │
│ Replicas, strategy and other fields stay as they are.          │
│ Compared 14:02:11. The cluster can change before you confirm.  │
│                                                                │
│  3 changes to the pod template                                 │
│  ⇄  spec.containers   array, 2 items → 2 items                 │
│     ▾ Inside this array (for reading only. Watchtower writes   │
│       the whole array.)                                        │
│       ~ [api] image       reg/api:2.3.1  →  reg/api:2.2.0      │
│       + [api] env.FEATURE_X   true                             │
│  ~  metadata.labels.version               v5  →  v4            │
│  ⋯  64 unchanged fields                              [Show]    │
│                                                                │
│ ▸ kubectl equivalent                                           │
│                              [Cancel]  [Roll back to #4]       │
└────────────────────────────────────────────────────────────────┘
```

- `pod-template-hash` is stripped from both sides (it differs by construction).
- Style: non-destructive (C2). Today's confirm is `destructive`, giving it a warning triangle. A rollback loses no data, and the revision it replaces is itself in history. Recommend the info glyph and the accent primary. A small, visible change.
- **The diff is informational, not a gate.** If it cannot load: "Couldn't load the comparison: {message}. You can still roll back." The primary stays enabled; no typed confirm (the action is the same one today's dialog already confirms). This differs from #10 and #37 on purpose: those preview a write whose content the user authored; this previews a write the user picked from a list.

### 7.4 Compare dialog (read-only)

Same layout, title "Compare revision #4 with current", footer [Close] plus the link-style "Roll back to this revision…". No KUBECTL-EQUIV and no guardrail notice (nothing is written).

### 7.5 States

| State | Copy / behaviour |
|---|---|
| Loading | DIFF-ROW skeleton, "Comparing…". Rollback primary stays enabled (the diff is not a gate). |
| No differences | "No differences." / "Revision #4 has the same pod template as the current one." Do not add "rolling back would restart no pods" unless Q3-4 confirms it. |
| Error | "Couldn't load the comparison: {message}. You can still roll back." |
| Denied | Rollback keeps the existing `NO_PERMISSION_PATCH` tooltip. Compare is a read: STATE-VOCAB No access if the ReplicaSet reads are forbidden. |
| Read-only | **Rollback** disabled with the read-only reason (precedence 2). **Compare stays enabled** (it reads). |
| Not installed / Partial / "all" | n/a |
| Unreachable | STATE-VOCAB Unreachable in the body; Rollback unavailable because nothing can run. |
| Revision no longer available | "Revision #2 isn't available any more. Kubernetes keeps only the most recent revisions." Normally unreachable, since the list is built from existing ReplicaSets. |

### 7.6 Components and data

`WorkloadActions.tsx` (`RolloutHistory`, its `ConfirmModal`), the shared diff body. Data need Q3-4: the pod template of each revision (the brief's own question: add it to the revision record, or read the ReplicaSet). Also confirm that Watchtower's rollback restores the pod template only, as `kubectl rollout undo` does; the consequence line depends on it.

Out of scope here: Helm History compare and ArgoCD History compare. Both could reuse the same body; neither is in the brief.

---

## 8. #10 YAML Save: server dry-run diff

### 8.1 Job

"What will actually happen when I press Save?" Today Save is one click and a whole-object typed replace (F3-1). It silently drops fields newer than the pinned `k8s-openapi` (CLAUDE.md, Known Open Items). The user needs the real result before committing, including the fields they did not touch but will lose.

### 8.2 Flow

1. User clicks **edit**, changes the YAML, clicks **Review & save…** (replaces "save"; the ellipsis says it opens a dialog).
2. PREVIEW-GATE `lg` opens in `review.loading` and asks the server to run the **same typed replace** as a dry run. Never server-side apply (CLAUDE.md, Guided Edit; brief).
3. Outcome is one of the cases in 8.4. In the normal case: a diff of *the object as it is now* against *the object the server would store*.
4. The user confirms with **Save changes**, or goes **Back to editor** with their text intact.
5. The real save runs (`running`, cannot be stopped), then `result`: "Saved {kind} "{name}"." and the dialog closes; the panel shows the fresh YAML.

The editor never loses text: closing or rejecting returns to the textarea exactly as left.

### 8.3 Wireframe: normal diff, 672 px

```
┌────────────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                                    │
│ ⓘ Review changes to Deployment api                             │
│ Saving replaces the whole object with your YAML.               │
│ Compared 14:02:11. The cluster can change before you confirm.  │
│                                                                │
│  4 changes (2 you made, 2 the server adds)                     │
│  ~  spec.replicas                              3  →  5         │
│  ~  spec.template.spec.containers[api].image   …:2.3  →  …:2.4 │
│  +  spec.template.spec.dnsPolicy               ClusterFirst    │
│  +  spec.progressDeadlineSeconds               600             │
│  ⋯  118 unchanged fields                           [Show]      │
│                                                                │
│ ▸ kubectl equivalent                                           │
│                       [Back to editor]  [Save changes]         │
└────────────────────────────────────────────────────────────────┘
```

- Rows compare the live object now (left) with the object the server would store (right). The "you made / the server adds" split in the chip line appears only if the backend can tell them apart (Q3-5); otherwise it reads "4 changes".
- Status, managed fields and the other 4.4 fields are not diffed; an "Ignored" footnote lists them.

### 8.4 Outcomes and states

| Outcome | What the user sees |
|---|---|
| **Diff** | The wireframe above. Primary "Save changes". |
| **No differences** | "No differences." / "The server would store this object exactly as it is now." Primary disabled. Footer [Back to editor] [Close]. |
| **Dropped by schema** (can co-occur with a diff) | The callout in 8.5. |
| **Rejected by the server** (`review.rejected`) | Phase `error`. Status line: "The API server rejected this change: {server message verbatim}". Below it: "Nothing was saved. Fix the YAML and review again." Footer [Back to editor] [Copy error]. For pods this is the common outcome (most pod fields are immutable); the verbatim server text is the useful part. |
| **Conflict** | If the YAML carries `resourceVersion` and the object changed since the editor opened, the server answers with a conflict (Q3-5 confirms the editor text carries it). Status: "This object changed on the cluster after you opened the editor." + "Your YAML wasn't saved." Footer [Copy my YAML] [Back to editor]. "Back to editor" does not auto-refresh: reloading would discard the user's edits. The user chooses: copy, cancel, reopen. |
| **Unavailable** (`review.unavailable`) | Info block: "Couldn't ask the API server for a preview: {message}." + "You can still save. The server checks the change when you do." Primary becomes "Save without preview"; **typed confirm of the object name required** (3.1 table). |
| Loading | DIFF-ROW skeleton, status "Asking the API server what would change…". Primary disabled with reason "Waiting for the preview." |
| Error saving (after confirm) | Phase `error`, status line with the verbatim message, footer [Back to editor] [Try again]. |

### 8.5 The "dropped by schema" callout

Fields that exist on the live object, are not touched by the user's edit, and vanish from the server's result because Watchtower's pinned schema does not know them. They render as DIFF-ROW `Dropped by schema` rows (`−` plus the words "dropped by schema") grouped under a callout in the `status-warn` role:

```
│ ⚠ 2 fields will be dropped because Watchtower's schema does    │
│   not know them. You didn't edit them.                         │
│   −  spec.template.spec.resources.claims     (dropped by schema)│
│   −  spec.template.spec.hostUsers            (dropped by schema)│
│   Saving replaces the whole object, so these are removed.      │
│   [ ] I understand 2 fields I didn't edit will be removed.     │
│   Edit with the form instead. It only changes the fields you   │
│   edit.  [Open form]    (only if the kind has an edit form)    │
```

- The brief's copy is kept: "This field will be dropped because Watchtower's schema does not know it." The group header pluralises it.
- Primary becomes **"Save and drop 2 fields"** and stays disabled until the acknowledgement checkbox is ticked (D3-9: one checkbox, not a typed confirm, to keep the one-typed-field rule).
- "Open form" closes the dialog and opens the guided editor (`ResourceEditor`) when `EDIT_FORM` has the kind. The guided path uses a merge patch and does not have this problem (CLAUDE.md, Known Open Items). It is the escape hatch the user would otherwise not know exists.
- Telling "dropped by schema" apart from "the user deleted the field" needs backend help (Q3-5). **Without it, do not guess.** Show those rows as plain `−` removed and add the summary line "Some removed fields may be ones Watchtower's schema doesn't know."

### 8.6 Entry gating (P4 for YAML)

- **Read-only mode.** The **edit** button is disabled, not only Review & save: letting the user write 40 lines and then refusing is the worse failure. Tooltip: "Read-only mode (Watchtower guardrail). Turn off in cluster settings." (DISABLE-PRECEDENCE 2.)
- **RBAC.** An SSAR hint on the `update` verb for the kind in the object's namespace (F3-7). Denied tooltip: "You don't have permission to update {kind}s in {namespace}." Applies to edit and Review & save. Fail open as everywhere: namespace "all" cannot occur (a panel always has a concrete namespace), and a query error or missing data means enabled. The server's answer on the dry run is the real check.
- Both sites: `ResourceDetailPanel.tsx` and `DetailPanel.tsx` (pod YAML). The pod panel has no `usePermissions` today (F3-7), so it gains one.

### 8.7 Guardrails and equivalent

GUARDRAIL-NOTICE (slot 7) and the typed confirm apply per 11.6. KUBECTL-EQUIV shows `kubectl replace` (10.3).

### 8.8 Components

`ResourceDetailPanel.tsx` and `DetailPanel.tsx` (YAML tabs), `ConfirmModal.tsx` (consumer), shared diff body. A shared YAML-edit component would remove the duplication (F3-8): recommended, not required.

---

## 9. #37 Helm upgrade preview

### 9.1 Job

Before running `helm upgrade` from the Values tab: see which **values** changed and what the chart will **render**, and learn about a template error before anything is touched. Today the "upgrade" button runs `helm upgrade` immediately (F3-1).

### 9.2 Flow

1. In the Values tab, user clicks **edit**, changes values, clicks **Review upgrade…**.
2. PREVIEW-GATE `lg` opens with two panels in a tab list: **Values** and **Rendered resources**. Both load together.
3. The user reads them, then **Upgrade release** or **Back to editor**.
4. `running` ("This can't be stopped once started."), then `result` or `error`.

The chart source is never described as a repository or a version lookup. The consequence line reads: **"Upgrades "{release}" with your edited values, using the chart stored with this release."** (CLAUDE.md, Helm upgrade; brief.)

### 9.3 Wireframe, 672 px, Values panel

```
┌────────────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                                    │
│ ⓘ Upgrade Helm release grafana                                 │
│ Upgrades "grafana" with your edited values, using the chart    │
│ stored with this release.                                      │
│ Compared 14:02:11. The cluster can change before you confirm.  │
│                                                                │
│  [Values (3)]  [Rendered resources (12)]                       │
│  ─────────────────────────────────────                         │
│  ~  replicas                                   1  →  2         │
│  +  persistence.enabled                        true            │
│  ~  adminPassword                       ••••••••  →  ••••••••  [Show]
│  ⋯  27 unchanged values                            [Show]      │
│                                                                │
│ ▸ kubectl equivalent   (a helm command)                        │
│                    [Back to editor]  [Upgrade release]         │
└────────────────────────────────────────────────────────────────┘

Rendered resources panel
│  Rendered with your values · 12 resources                      │
│  ~  Deployment  monitoring/grafana          changed            │
│  +  PersistentVolumeClaim  monitoring/grafana   new            │
│     ConfigMap   monitoring/grafana          unchanged          │
│  …                                                             │
│  [View rendered manifest]                                      │
```

### 9.4 Decisions inside the pattern

**Values diff.** Key-path rows (DIFF-ROW) if the backend can give structured values; otherwise a line diff with the same `+` and `−` glyphs. There is no YAML parser on the frontend (CLAUDE.md), so this is Q3-6. Either way the panel is titled "Values".

**Rendered resources.**
- Minimum (required): the dry run's resource list as "kind namespace/name", a count, and a "View rendered manifest" text view. The dry run's main value is catching a **template or schema error before upgrading**.
- Better, if the data exists (Q3-6): each resource marked `new`, `changed`, `removed` or `unchanged` against the current release's manifest. If the backend cannot give this, the panel does not claim it: it shows the list only, with "This is what the chart renders, not a change list."

**Credential-looking values in v1.3 (D3-3).** #33's redaction ships in v1.4, so in v1.3 the Values tab already shows every value in clear text. DIFF-ROW 3.4 says Helm credential-like keys are masked. Recommendation: **mask them in this diff** (key-name patterns from the single list UX-04 owns, for example password, secret, token, key, credential) with a per-row **Show** control scoped to the dialog's lifetime. Reason: a diff is what people screenshot and paste into tickets; seeing a value costs one click for a user who could see it two clicks away anyway. When #33 lands, Show here obeys whatever reveal state the Values tab holds.

**Forward guard for #33.** The primary has a *blocked reason* slot. When #33 redacts values, any edited content that still contains the redaction placeholder makes **Upgrade release** unreachable (disabled, reason "A redacted value is still in the edit. Reveal it or remove it first."), not merely warned about. In v1.3 the slot is empty.

### 9.5 States

| State | Copy / behaviour |
|---|---|
| Loading | Both panels skeleton. Status "Rendering the chart with your values…" (can take seconds: indeterminate, elapsed time shown after 3 s). Primary disabled: "Waiting for the preview." |
| No value changes | "Your values are unchanged." Primary disabled, reason "Nothing changed." (A same-values upgrade still writes a new revision; it is deliberately not offered.) |
| Rendered fine | Both panels as above. |
| **Rejected** (`review.rejected`) | Helm or the API server refused the dry run. Phase `error`, status "Helm couldn't render this release: {helm message verbatim}" + "Nothing was upgraded." Footer [Back to editor] [Copy error]. The edit text is kept. |
| **Unavailable** | `helm` not found or not runnable. Use the existing `friendly_helm_error` text (it has provider-specific hints) as the status, then "You can still upgrade. Helm will check the chart when it runs." Primary "Upgrade without preview"; typed confirm of the release name required. |
| Error after confirm | Status verbatim + "If the upgrade failed partway, Helm may have recorded a failed revision. Check the History tab." Footer [Back to editor] [Try again]. |
| Success | `result`: "Upgraded "grafana"." with the revision if known; the dialog closes; Values and History refresh. |
| Denied | **No RBAC hint exists for Helm** (F3-7: a release is a bundle of writes across kinds; `RBAC_RESOURCE` has no `helm` row on purpose). No SSAR-based disabling. The server's own error appears in the `error` phase. Do not invent a hint on `secrets`: it would be half true. |
| Read-only | **edit** button disabled in view mode (same reasoning as 8.6), plus Review upgrade. Reason per DISABLE-PRECEDENCE 2. |
| Not installed | n/a (a missing helm binary is *Unavailable* above) |
| Partial | n/a |
| Unreachable | STATE-VOCAB Unreachable in the body; both panels replaced; Back to editor. |
| Namespace "all" | n/a: a release has a concrete namespace. |

### 9.6 KUBECTL-EQUIV for Helm

The real `helm` command, not kubectl (brief). Shape, with named placeholders where Watchtower uses temporary files:

```
helm upgrade grafana <chart> --values <values.yaml> --namespace monitoring --kube-context prod-eu-1
```

Footnote: "Watchtower upgrades from the chart stored with the release, using temporary files. `<chart>` and `<values.yaml>` stand for those files." The brief asks whether to omit the string when it would show a meaningless tempdir. This shows the **shape**, not the path. Recommendation: keep it, because it tells the user which flags Watchtower uses; the tech lead may overrule (Q3-6).

### 9.7 Components and data

`ResourceDetailPanel.tsx` (Values tab and the `upgradeHelmRelease` call), `ConfirmModal.tsx`. Data: Q3-6 (dry-run render output, current manifest, structured values, helm string, helm-missing signal).

---

## 10. #28 kubectl equivalent

### 10.1 Job and rules

Let a careful operator check "is this really the command I would have run?" and reuse it in a runbook or ticket. Text plus a copy button. **No shell-out, no kubectl dependency** (CLAUDE.md, no kubectl dependency; cross-package rule 9).

| Rule | Detail |
|---|---|
| E1 | The string names the **real verb** Watchtower performs, not the nearest friendly one. |
| E2 | Every kubectl string carries `--context {name}` and `-n {namespace}` (cluster-scoped kinds omit `-n`). Reason: Watchtower's selected cluster is app-local and can differ from the user's kubectl default (CLAUDE.md, Kubeconfig Lifecycle). A string without `--context` runs against the wrong cluster, which is the accident this app exists to prevent. |
| E3 | **Secret values never appear.** Keys may; values render as `<redacted>` (10.5). |
| E4 | The string is **built separately** from any on-screen patch or diff text. `ResourceEditor`'s Patch tab shows `stringData` in clear text (the user's own input); the copyable string must not reuse that text. |
| E5 | Honest footer, always: "Equivalent, not identical. Watchtower calls the Kubernetes API directly and doesn't run kubectl." |
| E6 | Merge from file never renders as `kubectl apply` (cross-package rule 5; 10.3, and D3-10). |
| E7 | Only attached where a confirm exists (F3-6). A single-click write shows no equivalent; D3-5 decides whether those gain a confirm. |

### 10.2 Disclosure (slot 6)

Collapsed by default. The state (open or closed) is remembered per viewer in localStorage (wrapped in try/catch; renders correctly without it).

```
Collapsed
│ ▸ kubectl equivalent                                           │

Expanded, 672 px dialog
│ ▾ kubectl equivalent                                  [Copy]   │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ kubectl scale deployment/api --replicas=0 -n shop \        │ │
│ │   --context prod-eu-1                                      │ │
│ └────────────────────────────────────────────────────────────┘ │
│ Equivalent, not identical. Watchtower calls the Kubernetes API │
│ directly and doesn't run kubectl.                              │

Context lives outside your default kubeconfig
│ Context "prod-eu-1" is defined in work-clusters.yaml. Add      │
│ --kubeconfig /Users/me/kube/work-clusters.yaml, or include     │
│ that file in KUBECONFIG.                                       │
```

- The block is monospace on `surface-input`. It wraps; it is never truncated on screen except by the long-command rule below. A line break in the displayed text is cosmetic: **Copy puts a single command on one line** (or one command per line for multi-command cases), with no line-continuation characters, so a paste always runs.
- **Copy** gives immediate feedback: the button label becomes "Copied" with a check for 2 seconds, announced politely ("Command copied").
- **Long commands** (a patch over about 1,000 characters): the on-screen text shows the first 300 characters, then "…", then "Show full command". Copy always copies the full string.
- **Context outside the default kubeconfig.** If the cluster's context entry comes from a registered file (`KubeContext.source` is not the default), the extra footnote above appears. This is a correctness note, not decoration: `--context prod-eu-1` alone fails in a shell that cannot see that file.
- **Windows.** A merge patch is `-p '{"a":1}'` in a POSIX shell, and breaks in PowerShell 5.1 and cmd (quote handling differs). On Windows the disclosure carries a two-way toggle **PowerShell | POSIX shell**, remembered per viewer; elsewhere it is absent. (Alternative: always show `--patch-file`. Rejected: it needs a file the user does not have.) D3-11.

### 10.3 What each write renders as

`{ctx}`, `{ns}` are Watchtower's context and namespace. Resource names use kubectl's short singular where one exists (`deployment`, `pod`, `node`), otherwise plural-and-group (`applications.argoproj.io`).

| Action | Rendered as | Note |
|---|---|---|
| Delete one object | `kubectl delete {kind} {name} -n {ns} --context {ctx}` | Owner kinds append `--cascade=background|foreground|orphan` (section 12). Always rendered explicitly for those kinds, even when Background. |
| Delete pods (bulk) | `kubectl delete pod {a} {b} {c} -n {ns} --context {ctx}` | One command, names space-separated. Display collapses after 10 names, Copy has all. |
| Pod header "Restart" (F3-2) | `kubectl delete pod {name} -n {ns} --context {ctx}` | Honest: it is a delete. |
| Workload Restart | `kubectl rollout restart {kind}/{name} -n {ns} --context {ctx}` | |
| Pause / Resume | `kubectl rollout pause deployment/{name} …` / `kubectl rollout resume deployment/{name} …` | |
| Scale | `kubectl scale {kind}/{name} --replicas={n} -n {ns} --context {ctx}` | |
| Rollback (Deployment) | `kubectl rollout undo deployment/{name} --to-revision={n} -n {ns} --context {ctx}` | |
| Trigger CronJob | `kubectl create job <job-name> --from=cronjob/{name} -n {ns} --context {ctx}` | `<job-name>` is generated at run time (01 Q7); shown as a placeholder. |
| Cordon / Uncordon | `kubectl cordon {node} --context {ctx}` / `kubectl uncordon …` | |
| Drain | `kubectl drain {node} --ignore-daemonsets --delete-emptydir-data --context {ctx}` | Add `--force` only when the run includes pods with no controller. Footnote: "kubectl retries refused evictions. Watchtower stops and reports them (see the drain preview)." |
| Delete node | `kubectl delete node {node} --context {ctx}` | |
| Add / remove taint | `kubectl taint nodes {node} {key}={value}:{effect} --context {ctx}` / `kubectl taint nodes {node} {key}:{effect}- --context {ctx}` | Only if these gain a confirm (D3-5). |
| Delete namespace | `kubectl delete namespace {name} --context {ctx}` | |
| Create namespace | `kubectl create namespace {name} --context {ctx}` | |
| Guided edit (Patch) | `kubectl patch {kind} {name} -n {ns} --context {ctx} --type=merge -p '{patch}'` | `{patch}` is the merge patch with Secret values masked (10.5). |
| **YAML Save** | `kubectl replace -f <your-edited-yaml> --context {ctx}` | A typed whole-object replace, so `replace`, not `apply` and not `patch`. Footnote: "The file is the YAML in the editor." No body, so nothing to mask. |
| Create (+New / ⌘N) | `kubectl create -f <file> --context {ctx}` | **Only if** `create_resource_from_yaml` is create-only. If it applies, it cannot honestly be rendered as `create` (Q3-7). |
| Merge from file | **Not rendered** (E6, D3-10) | Replaced by the line: "Merge from file has no single kubectl equivalent. Each document is created if it doesn't exist and merge-patched if it does. The preview lists the exact keys that will be set." |
| ArgoCD Sync | `kubectl patch applications.argoproj.io {app} -n {ns} --context {ctx} --type=merge -p '{"operation":{"sync":{…}}}'` | Sync is an `.operation` merge patch (CLAUDE.md, ArgoCD write contract). Never `argocd app sync`: a different tool, not what the app does. The exact payload is the tech lead's (Q3-7). |
| ArgoCD Refresh / Hard | `kubectl annotate applications.argoproj.io {app} -n {ns} --context {ctx} argocd.argoproj.io/refresh=normal --overwrite` (`hard` for Hard Refresh) | Refresh is an annotation (CLAUDE.md). |
| ArgoCD History rollback | `kubectl patch applications.argoproj.io {app} … --type=merge -p '{"operation":{"sync":{…}}}'` | Payload from the tech lead (Q3-7). |
| ArgoCD delete | `kubectl delete applications.argoproj.io {app} -n {ns} --context {ctx}` | **Never `--cascade=`** (F3-12). Footnote: "Whether the app's resources are deleted too depends on the resources-finalizer.argocd.argoproj.io finalizer, not on --cascade." Exact finalizer handling is Q3-7. |
| ArgoCD bulk Sync / Refresh | One line per app, as above | Copy gives all lines. |
| Helm rollback | `helm rollback {release} {revision} --namespace {ns} --kube-context {ctx}` | |
| Helm uninstall | `helm uninstall {release} --namespace {ns} --kube-context {ctx}` | |
| Helm upgrade | `helm upgrade {release} <chart> --values <values.yaml> --namespace {ns} --kube-context {ctx}` | 9.6. |
| Helm install | `helm install {release} {chart} --namespace {ns} --kube-context {ctx}` plus `--version`/`--values` as filled in | The fields come from `HelmInstallModal`; the tech lead supplies the exact flag set (Q3-7). |
| Drain force-delete | `kubectl delete pod {a} {b} -n {ns} --context {ctx}` (one line per namespace) | Footnote: "Deleting a pod directly bypasses PodDisruptionBudgets." |
| Resize (#36) | Tech lead supplies | See 13.4 for why merge patch is not an option. |
| Debug container (#5) | UX-02 owns | |
| Shell | No equivalent attached | No confirm exists. If shell stays available the Shell tab shows `kubectl exec -it {pod} -c {container} -n {ns} --context {ctx} -- sh` as plain help text, not a confirm slot. |

### 10.4 Where it attaches (and how, for dialogs that are not ConfirmModal)

| Host | How |
|---|---|
| `ConfirmModal` | New optional slot 6. The consumer passes the string(s) and any footnote. |
| `ConfirmBulkModal` (PodTable) | Mirrors the slot (00 section 2.6). |
| `ResourceEditor`, `MergeFromFileModal`, `HelmInstallModal`, `ResourceCreator` | Mirror slot 6 above the footer, collapsed. `MergeFromFileModal` shows the explanatory line, not a command. |
| Sidebar namespace delete, ArgoCD app delete | These are rebuilt on ConfirmModal as part of this package (11.5 rows 15 and 30); the slot comes with that. |

### 10.5 Secret masking

- Applies to: guided-edit patches for `sec`, any patch containing `data` or `stringData` on a Secret, and Merge from file (which renders no command).
- Keys stay. A removed key stays (`"oldKey":null`). Values become `<redacted>`:
  `-p '{"stringData":{"password":"<redacted>"},"data":{"oldKey":null}}'`
- Footnote when any value was masked: "Secret values are replaced with <redacted>. Fill them in before running."
- The same masking rule applies to the DIFF-ROW masks (3.4) and the future journal (#31), so UX-04 and this package use **one rule**: Secret values never leave the object's own panel except when the user has revealed that object (#33).

### 10.6 Dialog label fixes tied to this work

- `ResourceEditor`'s primary is **"Apply"** (F3-4), shown beside `kubectl patch`. That invites the same confusion as `kubectl apply` that the Merge-from-file rule exists to prevent. Recommendation (D3-8): rename to **"Save changes"**. "Dry run" stays.
- YAML tab primary: "Review & save…", then "Save changes" in the gate (8.2).

### 10.7 States

| State | Behaviour |
|---|---|
| Loading | The disclosure is present but its block shows "Building…" only if the string depends on a pending value (for example the diff). Otherwise instant. |
| Empty | n/a: every write has an equivalent or the explanatory line. |
| Error | If the string cannot be built, the disclosure shows "No equivalent available for this action." and Copy is disabled. The action itself is unaffected. |
| Denied / read-only | The dialog cannot open (read-only) or the primary is disabled (RBAC). The disclosure still renders so the user can copy the command and run it elsewhere. Do not hide it. |
| Not installed / Partial / Unreachable / "all" | n/a: text, not data. |

### 10.8 Keyboard and accessibility

The disclosure is a button with `aria-expanded`. The block is a read-only region with a visible label ("kubectl equivalent") and selectable text. Copy is a button with an accessible name that includes what it copies ("Copy kubectl command"). `⌘↵` is unaffected (K5).

---

## 11. #29 Read-only mode and guardrails

### 11.1 The model

Three settings per cluster, edited in `IdentityEditor` (ContextSwitcher), stored on the `cluster-identity` record beside `color` and `label` (00 section 7.4; F3-15: `setClusterIdentity` writes only those two today, so the writer must preserve fields it does not own, Q4 in 00).

| Setting | Effect | Default |
|---|---|---|
| **Read-only mode** | Watchtower's write actions for that cluster are disabled, with a reason. | Off |
| **Confirm writes by typing the cluster label** | Every write dialog on that cluster needs the cluster label typed (11.6). | Off |
| **Limit bulk actions to N items** | Bulk selections above N are refused (11.6). | Off (suggested N when turned on: 10) |

Read-only mode is a **hint, not a security boundary**: it governs Watchtower's buttons only. `kubectl`, other tools and anyone with the credentials are unaffected, and the server's RBAC is the real boundary. Copy never says "protected", "secured", "locked" (COPY-RULES 9.4). The glyph must not be a padlock either (a padlock says "secured"); use an eye (view only).

Nothing defaults on and nothing is inferred from the label or the colour: guessing "this looks like prod" would be wrong in both directions.

### 11.2 Configuration UI

`IdentityEditor` is a small inline editor that today holds a label input and six colour dots. It gains a **Guardrails** group.

```
Inline editor under a context row, ContextSwitcher modal width
┌────────────────────────────────────────────────────────────┐
│ Label  [ prod-eu-1                          ]              │
│ Colour ● ● ● ● ● ●                                         │
│ ── Guardrails ─────────────────────────────────────────    │
│ [x] Read-only mode                                         │
│     Disables Watchtower's write actions on this cluster.   │
│     A guardrail, not a security boundary: kubectl and other│
│     tools aren't affected.                                 │
│ [ ] Confirm writes by typing the cluster label             │
│ [ ] Limit bulk actions to  [ 10 ]  items                   │
└────────────────────────────────────────────────────────────┘
```

**Flows**

- **Turn on:** immediate, no confirm (the safe direction). The TopBar, Sidebar chip and table strips update at once. Announced politely: "Read-only mode on for prod-eu-1."
- **Turn off:** always a confirm, from any place it is offered (editor, TopBar popover, table strip, palette). `sm`, non-destructive, with the cluster's badge:

```
┌──────────────────────────────────────────┐
│ ● prod-eu-1                              │
│ ⓘ Turn off read-only mode                │
│ Watchtower's write actions become        │
│ available again for prod-eu-1.           │
│            [Cancel]  [Turn off read-only]│
└──────────────────────────────────────────┘
```

  Initial focus on the primary (non-destructive, C5); Esc cancels. The confirm does not require typing: the user set the mode and can undo it, so friction here protects nobody, and a typed confirm on the escape hatch makes it a trap during an incident.
- **Limit bulk:** the number field accepts 1 to 500; blank or unticked means off. Invalid input shows "Enter a whole number from 1 to 500." under the field.

Edge: turning read-only on does **not** stop an action already running (a drain, a Helm upgrade). Copy in the editor help: "Actions already running aren't stopped."

### 11.3 Global indicators

All text plus icon; none uses `status-warn` (a warning role would read as "something is wrong"). The badge uses a neutral role: `mute` text on `surface-tint` with an `edge-strong` ring.

```
TopBar (left cluster, next to the identity rule)
│▌ prod-eu-1  (eye) Read-only        shop ▾      ...  │
 ▌ = the identity rule in the identity colour (unchanged)

Sidebar context chip (second line, 280 px sidebar)
│ ┌──────────────────────────────┐ │
│ │ PE  prod-eu-1              ▾ │ │
│ │     (eye) Read-only          │ │
│ └──────────────────────────────┘ │

ContextSwitcher row
│ ● prod-eu-1   kubectl default   Read-only    ⟨palette⟩ ⟨copy⟩ │

ResourceDetailPanel / DetailPanel header (compact chip beside the title)
│ Deployment api     (eye) Read-only                 │

Table strip (above the header row of any GenericResourceTable or PodTable)
│ (eye) Read-only mode. Writes are disabled for this cluster.  [Turn off…] │
```

- **TopBar badge is a button.** Click opens a small popover: "Read-only mode (Watchtower guardrail) is on for prod-eu-1. It disables Watchtower's write actions. It doesn't affect kubectl or other tools." with [Turn off…] and [Keep on]. It is the single always-reachable path to turn it off.
- **Table strip.** The text is 00 section 5.4's: "Read-only mode. Writes are disabled for this context." with the added [Turn off…] link. It shows whenever read-only is on, even if RBAC has hidden the delete column (the strip reports the mode, not the column).
- **Why the strip matters (F3-9).** `GenericResourceTable`'s delete button is `opacity-0` until row hover, so a disabled delete icon is just as invisible; per-row signalling does not exist. The strip is the **only persistent signal** on a list view. This supports D-1 (disable, don't hide) but changes its cost: there is nothing noisy to mitigate, because the icons are invisible anyway. Two implementation notes: the disabled icon must also appear on keyboard focus (`focus-visible`), and its tooltip is the short "Read-only mode."
- **Window title and OS taskbar:** unchanged.

### 11.4 How a disabled control looks and answers

Per DISABLE-PRECEDENCE: in progress, then read-only, then RBAC, then capability. Per D1 the control is focusable with `aria-disabled` and the reason as its description. Activating it does nothing.

| Control type | Presentation | Tooltip / description |
|---|---|---|
| Action button (Scale, Restart, Rollback, Drain…, Cordon, Delete in a panel) | Dimmed, keeps its label and icon | "Read-only mode (Watchtower guardrail). Turn off in cluster settings." |
| Table row delete | Dimmed icon on hover or focus (F3-9) | "Read-only mode." (short, because the strip carries the full text) |
| Bulk action bar buttons | Dimmed | The full sentence |
| Entry points: TopBar **+ New**, ⌘N, palette "New resource", Merge from file, Helm install, Sidebar namespace + and trash | Dimmed; palette entries are listed but disabled with the sentence on the right | The full sentence |
| YAML **edit**, Helm Values **edit**, pencil | Dimmed (the entry, not only the final button: 8.6) | The full sentence |
| ⌘N pressed while read-only | Nothing opens. A polite announcement: "Read-only mode. New resource is disabled." The TopBar badge shows a 2 s ring (no motion; reduced-motion safe). | |

- The phrase "Turn off in cluster settings." is last (rule D3 in 00 section 5.3). The words name the place: the cluster's settings are the `IdentityEditor`, reached from the TopBar badge or the context switcher.
- A backstop below the UI: the mutation hooks should refuse while read-only is on, so a call site the inventory missed cannot bypass it. The refusal copy is "Read-only mode (Watchtower guardrail) is on for {cluster}. Turn it off in cluster settings to make changes." It surfaces through the normal error path. This is a request to the tech lead (Q3-8); it is what turns the inventory from a promise into a property.
- If read-only turns on while a write dialog is open (rare; different window or the palette), the dialog stays, the primary becomes disabled with the reason, and the status line says "Read-only mode was turned on for prod-eu-1. This action can't be completed."

### 11.5 Write-surface inventory

The property: **every place the app can change cluster state**. The tech lead verifies this table against the code: every `useMutation` in `src/hooks/useResources.ts` and every `invoke(` in `src/components/`. Lines are v1.2.1.

Legend. **Confirm today:** none; CM = ConfirmModal; bespoke = a hand-rolled dialog; own = a modal host with its own buttons. **usePermissions:** yes = a check reaches this control, no = none. **Read-only presentation:** B = button or menu item disabled with the reason (11.4); C = table delete control disabled, strip above the table; E = entry point disabled (button, ⌘N, palette); N = not gated, with the reason. **#28** column: the equivalent in 10.3, or why none.

| # | Surface | File:line | Command | Confirm today | usePermissions | Read-only | #28 |
|---|---|---|---|---|---|---|---|
| 1 | Row delete in every list view (about 30 views) | `ResourceViews.tsx` 114 to 2855 (for example 126) | `delete_resource` | CM | yes (deny hides the column) | C | delete (+ cascade for owners) |
| 2 | Row delete, ArgoCD AppSets and Projects | `ResourceViews.tsx` 1888, 1962 | `delete_resource` | CM | yes | C | delete |
| 3 | Helm uninstall (table row) | `ResourceViews.tsx` 1356 to 1368 | `uninstall_helm_release` | CM | no (no Helm RBAC row) | C | helm uninstall |
| 4 | ArgoCD bulk Sync, Refresh, Hard Refresh | `ResourceViews.tsx` 1740, 1798 | `sync_argocd_app`, `refresh_argocd_app` | CM | no | B, plus max-bulk (11.6) | one line per app |
| 5 | Pod row delete | `PodTable.tsx` 931 to 939 | `delete_pod` | CM | yes | B | delete pod |
| 6 | Pod bulk delete and restart | `PodTable.tsx` 806; dialog 340 | `delete_pod` ×N | bespoke (`ConfirmBulkModal`) | yes | B, plus max-bulk | delete pods |
| 7 | Pod header "Restart" | `DetailPanel.tsx` 497 to 509 | `delete_pod` | **none (F3-2)** | no | B | delete pod |
| 8 | Pod "Delete pod" (overflow menu) | `DetailPanel.tsx` 527 to 551 | `delete_pod` | CM | no | B | delete pod |
| 9 | Pod YAML Save | `DetailPanel.tsx` 1143 | `apply_resource_yaml` | **none (F3-1)**, becomes PREVIEW-GATE | no, gains `update` hint | B on edit and save | `kubectl replace` |
| 10 | Resource YAML Save | `ResourceDetailPanel.tsx` 3283 | `apply_resource_yaml` | **none (F3-1)**, becomes PREVIEW-GATE | no, gains `update` hint | B on edit and save | `kubectl replace` |
| 11 | Helm Values upgrade | `ResourceDetailPanel.tsx` 3190 | `upgrade_helm_release` | **none (F3-1)**, becomes PREVIEW-GATE | no (cannot be checked, 9.5) | B on edit and review | helm upgrade |
| 12 | Guided edit (pencil, Apply) | `ResourceDetailPanel.tsx` 3473; `edit/ResourceEditor.tsx` 128 | `patch_resource` | own; **no identity badge (F3-4)** | yes (pencil) | E (pencil) | `kubectl patch` |
| 13 | Panel header Delete (generic kinds) | `ResourceDetailPanel.tsx` 3453 | `delete_resource` | CM | yes | B | delete (+ cascade for owners) |
| 14 | Panel header Uninstall (Helm) | `ResourceDetailPanel.tsx` 3421 | `uninstall_helm_release` | CM | no | B | helm uninstall |
| 15 | Panel header Delete (ArgoCD app) | `ResourceDetailPanel.tsx` 3338 to 3405 | `delete_argocd_app` | bespoke (F3-3), rebuilt on CM here | verify | B | delete, finalizer footnote |
| 16 | Node Cordon, Uncordon | `ResourceDetailPanel.tsx` 392, 395 | `cordon_node`, `uncordon_node` | none | yes (`canPatch`) | B | cordon, uncordon |
| 17 | Node Drain | `NodeDrainDialog.tsx`; `useNodeDrain.ts` 177, 212 | `cordon_node`, `evict_pod` | CM (`lg`) | yes (`canPatch`) | B | drain |
| 18 | Drain force-delete (new, 13.1) | `NodeDrainDialog.tsx` ~428 | `delete_pod` ×N (Q3-10) | CM (nested `md`) | follows drain | B | delete pods |
| 19 | Node delete | `ResourceDetailPanel.tsx` 398; dialog 517 | `delete_node` | CM; **no typed confirm (F3-14, verify)** | yes | B | delete node |
| 20 | Taint add, remove | `ResourceDetailPanel.tsx` 411, 424, 435 | `add_node_taint`, `remove_node_taint` | add and most removes: none; NoExecute remove: CM | no (verify) | B | taint |
| 21 | Scale | `WorkloadActions.tsx` 46; dialog 79 | `scale_workload` | CM | yes | B | scale |
| 22 | Workload Restart | `WorkloadActions.tsx` 123; dialog 143 | `restart_workload` | CM (v1.2.1) | yes | B | rollout restart |
| 23 | Pause, Resume | `WorkloadActions.tsx` 179, 182; dialog 208 | `pause_deployment`, `resume_deployment` | CM (v1.2.1) | yes | B | rollout pause, resume |
| 24 | Rollback (Deployment) | `WorkloadActions.tsx` 247; dialog 282 | `rollback_deployment` | CM, gains diff (#9) | yes | B (Compare stays on) | rollout undo |
| 25 | Trigger CronJob | `WorkloadActions.tsx` 316; dialog 336 | `trigger_cronjob` | CM (v1.2.1) | yes (`canCreate`) | B | create job |
| 26 | Helm History rollback | `ResourceDetailPanel.tsx` 2537; dialog 2526 | `rollback_helm_release` | CM | no | B | helm rollback |
| 27 | ArgoCD History rollback | `ResourceDetailPanel.tsx` 2647; dialog 2633 | `rollback_argocd_app` | CM | no (disabled while auto-sync) | B (read-only first, then the auto-sync reason) | patch operation |
| 28 | ArgoCD Sync (single) | `ResourceDetailPanel.tsx` 2712 | `sync_argocd_app` | none; CM only with prune | no | B | patch operation |
| 29 | ArgoCD Refresh, Hard Refresh | `ResourceDetailPanel.tsx` 2728, 1667 | `refresh_argocd_app` | none | no | B | annotate |
| 30 | Sidebar namespace delete | `Sidebar.tsx` 112 to 115, 307 to 329; `App.tsx` 239 | `delete_namespace` | bespoke, **no typed confirm (F3-3)**, rebuilt on CM here | no | B (trash icon) | delete namespace |
| 31 | Sidebar namespace create (+) | `Sidebar.tsx` 259 to 270 | `create_namespace` hook exists (`useResources.ts` 790); the ns form goes through the creator (verify) | own | no | E | create namespace |
| 32 | **+ New** / ⌘N / palette | `ResourceCreator.tsx` 90 | `create_resource_from_yaml` | own; **no identity badge (F3-4)** | no | E | `kubectl create -f` (Q3-7) |
| 33 | Merge from file | `MergeFromFileModal.tsx` 213 | `apply_yaml_documents` | own, has badge | no | E | none, explained (E6) |
| 34 | Helm install | `HelmInstallModal.tsx` 81 | `install_helm_release` | own, has badge | no | E | helm install |
| 35 | Debug container (#5) | UX-02 owns | UX-02 | CM (UX-02) | SSAR `update pods/ephemeralcontainers` (UX-02) | B | UX-02 |
| 36 | **Pod shell (exec)** | `DetailPanel.tsx` 1090 to 1108; `ShellTerminal.tsx` 56 | `start_shell_session` | none | no | **Open: both options in 11.7** | none (help text only) |
| 37 | Port-forward start, stop | `DetailPanel.tsx` 241, 263; `ResourceDetailPanel.tsx` 812, 831; `PortForwardBar.tsx` 23 | `start_pod_port_forward`, `start_service_port_forward`, `stop_port_forward` | none | no | N: opens a local listener, changes no cluster object | none |
| 38 | Kubeconfig add, remove, enable | `ContextSwitcher.tsx` 159, 183, 266, 268 | `add_kubeconfig_*`, `remove_kubeconfig`, `set_kubeconfig_enabled` | none | no | N: app-local registry. Must stay reachable so a user can fix a broken config and turn read-only off | none |
| 39 | Identity, read-only and guardrail edits | `clusterIdentity.ts` 76 | none (localStorage) | CM for turning read-only off (11.2) | no | N: app-local | none |
| 40 | Diagnostics, other Settings | Settings (00 section 7.2) | app-local | none | no | N: app-local | none |

Reads that look like writes and are **not** in the table: every `preview_*` mutation (`preview_kubeconfig_*`, `preview_yaml_documents`) only reads; `preview_node_drain` is a read.

How the tech lead checks completeness: grep `useMutation` in `useResources.ts` and `invoke(` in `src/components/`; every hit is a row above, a read, or an app-local setting. A hit that is none of those is a gap in this table.

### 11.6 Guardrail behaviour

**Typed confirm (G1).** When on, every write dialog for that cluster requires the cluster **label** typed, C6 form: "Type prod-eu-1 to confirm". Notice (slot 7): "Guardrail on prod-eu-1: confirming this action needs typing." **One typed field at most (D3-6):** if the dialog already requires typing something (node name, namespace, release), that field is the gate and the guardrail adds none. Reason: two inputs in one dialog is the pattern users learn to autopilot, and an existing typed gate already forces the pause. The identity badge in slot 1 already proves the cluster.

Sites with no confirm today (F3-6) gain an `sm` confirm **only while this guardrail is on** (D3-5). Their default behaviour (one click) is unchanged.

**Bulk limit (G2).** Applies wherever a selection or a batch feeds one action: PodTable bulk delete/restart, ArgoCD bulk Sync/Refresh, and the document count in Merge from file. Refusal copy (the brief's example reworded, because "read-only guardrail" would conflate this with read-only mode): **"Guardrail: bulk actions are limited to 10 on prod-eu-1. Deselect 4 to continue."** The action buttons are disabled with that text as their reason; the same text sits in slot 7 of the bulk dialog if it was already open.

```
PodTable bulk bar, N = 10, 14 selected
│ 14 selected  [Clear]            [Copy names] [Restart] [Delete] │
│ Guardrail: bulk actions are limited to 10 on prod-eu-1.         │
│ Deselect 4 to continue.                                         │

ConfirmBulkModal mirroring CONFIRM-ANATOMY, 8 selected, typed guardrail on
┌────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                            │
│ ⚠ Delete 8 pods                                        │
│ Their owning workload will recreate them if applicable.│
│  ● api-7d9f        shop                                │
│  ● api-8e10        shop                                │
│  … 6 more                                              │
│ ▸ kubectl equivalent                                   │
│ Guardrail on prod-eu-1: confirming needs typing.       │
│ Type prod-eu-1 to confirm  [______________]            │
│                              [Cancel]  [Delete 8 pods] │
└────────────────────────────────────────────────────────┘
```

(The existing >10 pods typed-namespace gate remains a *second* reason to type; by the one-field rule, with the guardrail on and more than 10 pods the namespace is what is typed, not the label.)

### 11.7 Shell exec and read-only: open, both options, no recommendation

Per the brief this is not decided in the design. It needs the user (D3-7). Whichever is chosen, the badge popover and the Shell tab must **state** it.

| | Option A: shell is blocked in read-only | Option B: shell stays available |
|---|---|---|
| Rationale | `exec` can change anything inside a container, and the point of the mode is "I won't change this cluster by accident". | Shell is the main way to inspect a running pod; blocking it makes read-only mode useless during an incident. |
| Shell tab | "Exec shell" button and Shell tab disabled: "Read-only mode (Watchtower guardrail). Turn off in cluster settings." | Available. A dim line inside the tab: "Read-only mode doesn't restrict commands you run in a shell." |
| Badge popover adds | "Pod shells are blocked." | "Pod shells and port-forwards aren't blocked." |
| Cost | Operators turn the mode off to debug, then forget to turn it back on. | A user may believe "read-only" means nothing can change. The line above is the mitigation. |
| Port-forward | Available in both (no cluster object changes). | |

### 11.8 States (read-only and guardrails)

| State | Behaviour |
|---|---|
| Loading | n/a: app-local, synchronous. |
| Empty | n/a. |
| Error | If the stored record cannot be read (corrupt or storage blocked): treat as everything off, and show once in the editor: "Couldn't read this cluster's guardrail settings. They're off until you set them again." Fail to *off* is the existing identity behaviour (try/catch, defaults); a corrupt store must not brick the app. |
| Denied | n/a: not an RBAC concept. |
| Read-only | The subject of this section. |
| Not installed / Partial | n/a |
| Unreachable | Settings still editable (app-local). |
| Namespace "all" | n/a: the mode is per cluster, not per namespace. |

### 11.9 Components touched

`src/utils/clusterIdentity.ts` (record fields, writer preserving unknown fields), `src/components/ContextSwitcher.tsx` (`IdentityEditor`, row badge), `src/components/Sidebar.tsx` (chip, namespace +/trash), `src/components/TopBar.tsx` (badge and popover, +New), `src/components/GenericResourceTable.tsx` (strip, delete control), `src/components/PodTable.tsx` (strip, bulk bar, `ConfirmBulkModal`), `src/components/ConfirmModal.tsx` (slots 6 and 7, guardrail typed confirm), every file in the inventory, `src/components/CommandPalette.tsx` (disabled entries, "Turn on read-only mode" and "Turn off read-only mode…" entries for the active cluster), `src/hooks/useResources.ts` (the backstop, Q3-8).

---

## 12. #30 Delete propagation picker

### 12.1 Job and scope

When deleting an object that **owns** other objects, choose what happens to them. Shown only for kinds that own dependents through `ownerReferences`; for every other kind the delete dialog is unchanged (no picker, no `--cascade` in the equivalent).

| Kind | Dependents named in the copy |
|---|---|
| `deploy` | ReplicaSets and pods |
| `sts`, `ds`, `jobs`, `rs` | pods |
| `cron` | Jobs and their pods |

Pods, namespaces, Services, ArgoCD apps, Helm releases and nodes get no picker. **ArgoCD's cascade or orphan choice is a finalizer choice, not `propagationPolicy` (F3-12)**: it keeps its own two-option block and its own words ("Delete app + resources", "Delete app only"), is rebuilt on ConfirmModal in the same release (inventory row 15), and its kubectl equivalent never renders `--cascade=`.

Surfaces: the per-row delete in the six workload list views and the delete in `ResourceDetailPanel`'s header (both feed the same `ConfirmModal`).

### 12.2 Wireframe, `md` dialog (512 px)

```
┌───────────────────────────────────────────────────┐
│ ● prod-eu-1                                       │
│ ⚠ Delete Deployment api                           │
│ Permanently removes "api" from namespace "shop".  │
│ This can't be undone.                             │
│                                                   │
│ What happens to its ReplicaSets and pods          │
│ (•) Background  (kubectl's default)               │
│     "api" is deleted now. Kubernetes removes its  │
│     ReplicaSets and pods afterwards.              │
│ ( ) Foreground                                    │
│     "api" stays in the list, marked as deleting,  │
│     until its ReplicaSets and pods are gone.      │
│ ( ) Orphan                                        │
│     Only "api" is deleted. Its ReplicaSets and    │
│     pods keep running with no owner.              │
│                                                   │
│ ▸ kubectl equivalent                              │
│                         [Cancel]  [Delete]        │
└───────────────────────────────────────────────────┘

Orphan selected
│ ( ) Foreground …                                  │
│ (•) Orphan                                        │
│     Only "api" is deleted. Its ReplicaSets and    │
│     pods keep running with no owner.              │
│ ⚠ Orphaned pods aren't cleaned up automatically.  │
│   You'll need to delete them yourself.            │
│                       [Cancel]  [Delete, keep dependents]│
```

### 12.3 Rules

- **Default: Background, always, explicitly.** The default is chosen in the UI and sent, never left to the server. Reason (F3-11): for `batch/v1` Jobs the server's own default is to orphan, and `kubectl` sends Background explicitly. "Matches the API default" would be wrong for Jobs. The label says "kubectl's default" so a user who knows kubectl sees the match.
- **Never remembered.** The picker resets to Background on every open. A remembered Orphan is how a later delete leaves a fleet of owner-less pods.
- **Orphan changes the primary's label** to "Delete, keep dependents" for every owner kind (the consequence in the button, as in 01's "Stop, leave node cordoned"). One label, so the wording does not vary by kind.
- **Foreground** adds no warning; the description sets the expectation that the object lingers.
- The radio group is labelled by its heading line. Arrow keys move between options (A11Y); each option's description is its accessible description.
- Typed confirm, guardrails and read-only behave as everywhere. None of the owner kinds is cluster-scoped, so the existing cluster-scoped typed gate does not apply.
- KUBECTL-EQUIV always renders the flag: `kubectl delete deployment api -n shop --context prod-eu-1 --cascade=background` (and `foreground`, `orphan`).

### 12.4 States

| State | Behaviour |
|---|---|
| Loading | n/a: the picker is static. |
| Empty | n/a. |
| Error | Status slot with the verbatim message; dialog stays open; picker selection preserved; primary "Try again". |
| Denied | The existing delete permission mechanism: the row delete column hides on explicit deny (the one hide-on-deny exception, CLAUDE.md); the header Delete is disabled with the existing sentence. |
| Read-only | Delete disabled with the reason (11.4); dialog cannot open. |
| Not installed / Partial / Unreachable / "all" | n/a. Unreachable: the error path. |
| Foreground in flight | After confirm, the dialog closes. The list keeps the row until it disappears; no special state. If the user reopens the panel they see the object with a deletion timestamp. |

### 12.5 Components and data

`ResourceViews.tsx` (six workload views' `ConfirmModal`), `ResourceDetailPanel.tsx` (header delete), `ConfirmModal.tsx` (consumer; body slot). Data: Q3-9. The delete command must accept the policy as an optional argument (the project rule: every additive Tauri parameter is `Option<T>`, CLAUDE.md), and today's behaviour for Jobs needs checking regardless of this feature.

---

## 13. Drain force-delete, P4, #46, #36, #43

### 13.1 Drain force-delete (extends 01 section 2.8)

01 designed this in full and deferred it to v1.3 (D1-3). Everything in 01 sections 2.7, 2.8 and 2.9 stands. **Only the deltas are listed here.**

1. **Replaces the shipped pointer.** `NodeDrainDialog.tsx` (~428) currently ends the attention phase with "To remove these pods anyway, delete them from the Pods view. Deleting bypasses the PodDisruptionBudget." That line is replaced by 01 section 2.7's Override band:

```
│ ── Override ───────────────────────────────────────────────── │
│ Force-delete the blocked pods…     Bypasses the PodDisruptionBudget.│
```

   A link-style control, `status-bad` text and icon, no fill, never the default focus, last in tab order. It opens 01's nested `md` dialog (typed node name always required).
2. **Read-only mode.** A drain cannot start while read-only is on (Drain… is disabled, 11.4). If read-only is turned on while the attention phase is open, the Override control becomes disabled with the reason and the dialog's other buttons are unaffected (Retry also becomes disabled: it is a write).
3. **Guardrails.** Force-delete counts as a bulk delete: if N pods exceed the cluster's bulk limit, the nested dialog's primary is disabled with "Guardrail: bulk actions are limited to 10 on prod-eu-1. Deselect 4 to continue." The user selects which blocked pods to include via checkboxes in the nested dialog's list (new: 01 forced the whole blocked set, which a limit cannot honour). Default: all checked up to the limit; the rest unchecked. Typed gate: the node name (already required), so the guardrail adds no second field (D3-6).
4. **KUBECTL-EQUIV** (nested dialog, collapsed): `kubectl delete pod {a} {b} -n {ns} --context {ctx}`, one line per namespace, footnote "Deleting a pod directly bypasses PodDisruptionBudgets." The drain's own equivalent (10.3) carries the "kubectl retries refused evictions, Watchtower stops and reports them" footnote.
5. **New row state "force-deleted".** The drain rows today are waiting, evicting, evicted, already gone, blocked, failed. Add `force-deleted`: glyph `✓` plus the word "Deleted, PDB bypassed" in `status-warn` (01 section 2.8). The counts row gains "{n} force-deleted", never merged into "evicted". The outcome titles are 01 section 2.9's ("Node drained, 2 pods force-deleted").
6. **Data.** Confirm that the frontend loop can reuse the existing `delete_pod` call with the default grace period (Q3-10). If it needs a distinct command or a grace-period argument, say so; the design assumes none.
7. **New decision, D3-14:** the per-pod checkboxes in item 3 reverse 01 section 2.8's rule that the list is the exact blocked set. Recommendation: yes, because a bulk limit cannot be honoured without a selection. Without the checkboxes, refuse outright when the blocked count exceeds the limit and reword the refusal as "Guardrail: bulk actions are limited to 10 on prod-eu-1. 14 pods are blocked; raise the limit or use the Pods view." D1-3 (v1.3) is unchanged.

### 13.2 P4: permission hints for YAML Save and Helm Values

| Surface | Hint | Copy | Why |
|---|---|---|---|
| YAML **edit** and **Review & save…** (both panels) | SSAR on the **`update`** verb for the kind in the object's namespace | "You don't have permission to update {kind}s in {namespace}." | Save is a typed replace (PUT), which is `update`. `usePermissions` checks `delete`, `patch`, `create` only (F3-7); this needs a fourth verb in the same batched call (Q3-11). Using `patch` would be a hint about a different verb. |
| Helm Values **edit** and **Review upgrade…** | **None** | n/a | A release is a bundle of writes across many kinds; `RBAC_RESOURCE` has no Helm row on purpose (CLAUDE.md, Permission Gating). Any single-resource hint would be half true. Read-only mode (11.4) applies; the server's error appears in the `error` phase. |
| Helm rollback, ArgoCD History rollback, ArgoCD Sync/Refresh, Sidebar namespace delete, taints | Unchanged in v1.3 | | Not part of P4. Read-only mode covers them (inventory rows 14, 26 to 30). Their lack of an RBAC hint is the contract working as designed (fail open); the hint is missing, the action is not unsafe. |

Fail open, as always: only an explicit deny greys anything out; a query error or no data leaves it enabled; the error path on the action is never removed. DISABLE-PRECEDENCE order applies: read-only first, then RBAC.

### 13.3 #46 App log file: only what 00 section 7.2 lacks

00 already specifies Settings, Diagnostics: log level select, log path with Copy, Open log folder, the privacy note, and its states. **None of that is redrawn.** Three additions:

1. **Scrub scope, stated.** The privacy note's second sentence becomes: "Tokens and credentials are removed before anything is written, including output from cluster authentication plugins." The auth-plugin output is the specific path (`friendly_auth_error` echoes it, feature-recommendations row 46). Data need: the tech lead confirms the scrub covers it (Q3-12).
2. **What gets logged about writes.** One added line under the privacy note: "Write actions are logged by resource name. For Secrets, only key names are logged, never values." This is the same masking rule as KUBECTL-EQUIV (10.5) and the future journal (#31): one rule across the product.
3. **Retention, if the backend can state it.** A single dim line under the path: "Keeps up to {n} files of {size} each. Older files are deleted." Shown only if the numbers are supplied (Q3-12); otherwise omitted, never invented.

No new control. No "send logs" button (cross-package rule). States: unchanged from 00 section 7.2.

### 13.4 #36 In-place pod resize (low-fi, backlog)

**Flow.** Pod panel, Containers tab: each container card with resource values gains **Resize…** (pods only). It opens an `md` write dialog, prefilled with the container's current requests and limits.

```
┌───────────────────────────────────────────────────┐
│ ● prod-eu-1                                       │
│ ⓘ Resize container api in pod api-7d9f            │
│ Changes the container's CPU and memory in place.  │
│ Some changes restart the container, depending on  │
│ its resize policy.                                │
│                CPU           Memory               │
│ Request   [ 100m     ]   [ 128Mi    ]             │
│ Limit     [ 500m     ]   [ 256Mi    ]             │
│ ▸ kubectl equivalent                              │
│                          [Cancel]  [Resize]       │
└───────────────────────────────────────────────────┘
```

- Fields use quantity validation (`edit/quantity.ts`): "100m" is valid, "100" is accepted by the server but means 100 whole cores, so the existing hint applies. Submit is disabled until valid; fail-closed on a bad quantity.
- **Capability.** If the cluster's API server does not serve `pods/resize`, **Resize…** is disabled with the reason "This cluster's API server doesn't support in-place resize." (DISABLE-PRECEDENCE 4). RBAC hint: SSAR on `patch pods/resize` (feature-recommendations row 36). Read-only: disabled (precedence 2).
- **After submit:** a status line follows the pod's resize conditions: "Resize requested." then "Resizing…", "Resize in progress", or "Resize can't be applied right now: {reason}" using the server's condition message verbatim.
- **Hazard flagged for the tech lead.** The guided-edit path uses an RFC 7386 merge patch, which replaces the whole `containers` array (CLAUDE.md). The resize must not reuse it for `containers`; it needs a patch type that merges containers by name. The kubectl equivalent depends on that choice (Q3-13).

| State | Behaviour |
|---|---|
| Loading | Fields disabled until current values load. |
| Empty | Container has no resources: fields blank; helper "No requests or limits set." |
| Error | Status slot, verbatim message. |
| Denied | Disabled with the SSAR sentence. |
| Read-only | Disabled with the read-only reason. |
| Capability missing | Disabled with the capability reason. |
| Not installed / Partial / Unreachable / "all" | n/a / n/a / error path / n/a |

### 13.5 #43 Inline field docs in the YAML editor (low-fi, backlog)

**Read-only help. Never a schema-driven form** (rejected product decision, CLAUDE.md).

F3-8 shapes this: the YAML view is a `<pre>` and the editor a `<textarea>`; neither can host per-token hover targets. So the doc surface is a **help strip** at the bottom of the YAML tab, not a hover popover on the text.

```
YAML tab, bottom strip (both view and edit)
┌────────────────────────────────────────────────────┐
│ ...yaml text...                                    │
├────────────────────────────────────────────────────┤
│ spec.template.spec.containers[].resources          │
│ ResourceRequirements describes the compute resource│
│ requirements.                    Kubernetes 1.30  ⓘ│
└────────────────────────────────────────────────────┘
```

- The strip follows the **caret** in edit mode and a **click on a key** in view mode. Keyboard users move the caret and read; no hover required.
- Source label: the field description comes from the cluster's own API schema; the strip says which ("Kubernetes 1.30" or the CRD's name).
- If a field has no description (CRD schemas are often incomplete): "No description for this field." If the schema could not be fetched: the strip is hidden and nothing else changes; this feature must never block editing.
- Path-at-caret needs a YAML-aware lookup, which the frontend does not have (Q3-14). That cost, not the design, is why this is backlog.

| State | Behaviour |
|---|---|
| Loading | Strip shows "Loading field help…" once; editing is never blocked. |
| Empty | "No description for this field." |
| Error | Strip hidden. |
| Denied | The schema read is forbidden or aggregated API absent: strip hidden. |
| Read-only | n/a (help is not a write). |
| Not installed | CRD not installed: strip hidden. |
| Partial / Unreachable / "all" | n/a / strip hidden / n/a |

---

## 14. States matrix, keyboard, accessibility, light and dark

### 14.1 States matrix

"n/a" always carries its reason. Details live in each section.

| Feature | Loading | Nothing here / no differences | Error | Denied (SSAR) | Read-only (#29) |
|---|---|---|---|---|---|
| #6 Neat | Chip disabled until YAML loads (4.6) | "Nothing to hide for this object." | YAML load error; chip disabled | YAML tab's own No access | n/a (view); edit follows 8.6 |
| #7 Blame | Skeleton rows | "No field manager data on this object." | "Couldn't load field managers" + Retry | No access sentence (5.6) | n/a: read only |
| #8 Compare | Namespaces select, then skeleton | "No differences." | "Couldn't load … from {cluster}" + Retry | Other side: No access, left side kept | n/a: reads only |
| #9 Rollout diff | Skeleton; Rollback still enabled | "No differences." | "Couldn't load the comparison … You can still roll back." | Rollback `NO_PERMISSION_PATCH`; Compare No access | Rollback disabled; Compare enabled |
| #10 YAML Save | Skeleton, primary disabled | "The server would store this object exactly as it is now." | Rejected / conflict / unavailable (8.4) | edit and save disabled, `update` sentence | edit and save disabled |
| #37 Helm upgrade | "Rendering the chart …" | "Your values are unchanged." | Rejected / unavailable (9.5) | None possible (no Helm RBAC row) | edit and review disabled |
| #28 Equivalent | n/a: instant | n/a: every write has one or an explanation | "No equivalent available" + Copy disabled | Disclosure still shows | Disclosure still shows |
| #29 Guardrails | n/a: app-local | n/a | Corrupt store: all off + one-time note | n/a: not RBAC | The subject |
| #30 Propagation | n/a: static | n/a | Status slot, selection kept | Existing delete gating | Delete disabled |
| Drain force-delete | Inherits 01 | n/a | Row `failed` with message | Inherits 01 | Override disabled |

| Feature | Not installed | Partial | Unreachable cluster | Namespace "all" |
|---|---|---|---|---|
| #6 Neat | n/a: derived from the object | n/a: one object | YAML tab's own Unreachable | n/a: object has a namespace |
| #7 Blame | n/a: object's own metadata | n/a: one object | STATE-VOCAB Unreachable | n/a |
| #8 Compare | Other side: "{Thing} isn't installed on {cluster}." (CRD kinds) | n/a: one object per side | Other side: "Can't reach {cluster}." Left side kept | n/a: picker uses a concrete namespace |
| #9 Rollout diff | n/a | n/a | Body shows Unreachable; Rollback unavailable | n/a |
| #10 YAML Save | n/a (object exists) | n/a | Preview unavailable → "Save without preview" path, or Unreachable | n/a: panel has a concrete namespace |
| #37 Helm upgrade | helm missing is Unavailable (9.5) | n/a | Unreachable body; Back to editor | n/a |
| #28 Equivalent | n/a: text | n/a | n/a | n/a |
| #29 Guardrails | n/a | n/a | Settings stay editable | n/a: per cluster, not per namespace |
| #30 Propagation | n/a | n/a | Error path | n/a |
| Drain force-delete | n/a | Partial results are the point: counts per outcome | Inherits 01 | n/a: node is cluster-scoped |

### 14.2 Keyboard

Checked against 00's KEYMAP. Proposed additions are in 16.1 per rule K6; this file does not edit the table.

| Keys | Where | Meaning | Conflict check |
|---|---|---|---|
| `⌘↵` / `Ctrl+Enter` | Any open dialog | Primary action if enabled; never past a typed confirm or a missing acknowledgement checkbox; never in `running` (K5) | Existing contract |
| `Esc` | Dialogs | Topmost layer only (K3). Closes `review`, `attention`, `result`, `error`. In `running` it moves focus to Stop where one exists and states why. | Existing contract |
| `⌘S` / `Ctrl+S` | YAML tab or Helm Values tab **in edit mode** | Opens Review & save / Review upgrade (does not save by itself) | **Proposed.** Modifier shortcut, allowed from a textarea (K4). Not reserved by 00. No OS conflict in a Tauri window; confirm that the webview does not map it. |
| `⌘F` / `Ctrl+F` | Diff dialogs, YAML view | Find in the current text view | Already proposed in 00 8.2 |
| `⌥↓` / `⌥↑` | Diff dialogs | Next, previous changed row | **Proposed.** No single-letter keys (K1). |
| `Tab` | Dialogs | Focus trapped (ConfirmModal) | |
| Arrow keys | Propagation picker; PREVIEW-GATE tab list (Values, Rendered resources) | Radio and tab roving focus | |
| `r`, `/`, `?` | n/a | Inactive while a dialog is open (K1) | |

**Initial focus in PREVIEW-GATE.** C5 puts non-destructive dialogs on the primary button. For a gate whose purpose is to be read, landing on the primary invites Enter-through. PREVIEW-GATE overrides C5: initial focus is **Back to editor / Cancel**. `ConfirmModal` today ties focus to the `destructive` flag, so the consumer needs to choose focus independently of styling (a small contract request, Q3-8). The diff body is a scrollable region reachable by Tab (`tabindex` 0, labelled).

### 14.3 Accessibility (beyond A11Y-BASELINE)

| Element | Rule |
|---|---|
| Diff rows | A list; each item reads in full: "Changed: spec.replicas, from 3 to 5". Glyph, word and role colour together (DIFF-ROW). Masked values read "masked, 12 bytes". |
| Collapsed context and Show buttons | `aria-expanded`; the button name includes the count ("Show 41 unchanged fields"). |
| "Inside this array" | A nested list with a heading; its fixed header sentence is part of the list's description. |
| Dialog tabs (#37) | Proper tab list with roving focus and `aria-selected`; panels labelled by their tab. |
| Callout checkbox (#10) | A real checkbox with the full sentence as its label; the primary's disabled reason names it ("Tick the box to continue"). |
| Live regions | Preview result: polite ("Comparison ready: 4 changes."). Rejection or conflict: assertive. Copy: polite ("Command copied"). Read-only on or off: polite. |
| Read-only badge | Text plus icon; the popover is a labelled dialog or menu with Esc closing it (K3: a popover is a layer). |
| Propagation picker | A `radiogroup` with a visible group label; each option's description is `aria-describedby`. |
| Neat chip | `aria-pressed`; disabled state via `aria-disabled` with the reason (D1). |
| Reduced motion | The badge "ring" on a blocked ⌘N is a static ring for 2 s, not an animation. Skeletons may pulse only without `prefers-reduced-motion`. |
| Zoom | Dialogs hold at 200% zoom: value pairs stack at narrow width (DIFF-ROW 3.2). |

### 14.4 Light and dark (roles only, TOKEN-ROLES)

| Element | Role |
|---|---|
| Diff rows | Tint from `diff-add`, `diff-remove`, `diff-change`; glyph and word carry meaning; text stays `ink` so contrast does not depend on the tint |
| Dropped-by-schema callout | `status-warn` for border and icon, `ink` for text; rows keep `diff-remove` |
| Masked value `••••••••` | `dim` |
| "Inside this array" panel | `surface-tint` with an `edge` rule |
| KUBECTL-EQUIV block | `surface-input` with `ink`; Copy uses the neutral button style, "Copied" uses `status-ok` text plus a check |
| Read-only badge, strip, chip | `mute` text on `surface-tint` with an `edge-strong` ring. **Not** `status-warn`, **not** an identity role |
| Guardrail notice (slot 7) | `mute` text on `surface-tint`; the typed field uses `surface-input` |
| Propagation: Orphan warning | `status-warn` text and icon |
| Override band (drain) | `status-bad` text and icon, no fill (01) |
| Field-manager tags `Apply` / `Update` | Text only, `mute`; no colour distinction between them |
| YAML view and editor background | `surface-input` (replaces the six `#070a10` literals, F3-16). UX-05 assigns values. |
| Risk for UX-05 | `status-warn` text on a light `surface-overlay`; `diff-add` and `diff-remove` tints must keep 4.5:1 for the `ink` text over them in both themes |

---

## 15. Constraint checklist

| Constraint (brief, CLAUDE.md, 00) | Where satisfied |
|---|---|
| One shared diff-row component serves #8, #9, #10, #37 and Merge-from-file; arrays are leaf "replaced" rows | 3.4, 6.5, 7.3, 8.3, 9.3. **One amendment proposed (D3-1)**: "Inside this array" is a reading aid inside the replaced row, not a new row state; Merge-from-file is untouched. |
| Never imply an element-wise merge | The fixed header "For reading only. Watchtower writes the whole array." (3.4) |
| #28 names the real verb: YAML Save = replace, edit = patch --type=merge, merge-from-file never "apply" | 10.3 (rows: YAML Save, Guided edit, Merge from file), rule E6 |
| #28 Secret keys only, never values | E3, 10.5; E4 keeps it out of the Patch tab text |
| #28 is text plus copy, no shell-out | 10.1 |
| #28 Helm actions render as real helm commands | 10.3, 9.6 |
| #29 hint, not boundary; never "protected", "secured", "locked" | 11.1, 11.3 (eye glyph, not a padlock), copy throughout |
| #29 write-surface inventory covering every mutation site | 11.5 (40 rows) plus the grep method |
| #29 stored beside colour and label in `cluster-identity` | 11.1, F3-15 |
| #29 shell exec: present both options, do not decide | 11.7 |
| #29 other guardrails per context: optional typed confirm, max bulk size | 11.2, 11.6 |
| #29 one-click path to turn off, with a confirm | 11.2, 11.3 (TopBar badge popover), palette |
| #29 and D-1 read-only disables, does not hide the delete column; RBAC deny still hides | 11.3, 11.4, F3-9 |
| DISABLE-PRECEDENCE order honoured | 11.4, 8.6, 7.5 |
| #6 display only; Save never round-trips a stripped object; toggle visible in edit mode | 4.1 to 4.3 |
| #7 read-only, no SSA wording | 5.3, 5.1 |
| #10 same typed replace, never SSA; dropped-fields callout | 8.2, 8.5 |
| #37 values diff plus dry-run manifest; no repo or chart-version lookup; redacted value never sendable | 9.2, 9.4 (forward guard) |
| #9 reuses the rollback confirm and adds Compare | 7.2 |
| #30 picker; ArgoCD finalizer is separate | 12.1, F3-12 |
| P4 permission hints; fail open | 13.2 |
| Drain force-delete: separate typed opt-in, never default | 13.1 (extends 01 2.8) |
| #46: only what 00 lacks | 13.3 |
| #36 and #43 low-fi | 13.4, 13.5 |
| Every write confirm carries `contextLabel` / `contextColor` | C1; F3-4 fixes `ResourceEditor` and `ResourceCreator`; inventory marks them |
| ConfirmModal is the single write choke point; bespoke exceptions adopt the anatomy | F3-3, 10.4, 11.5 (rows 6, 12, 15, 30 to 34) |
| Disabled with a reason, never hidden (one existing exception) | 11.4 |
| Permission hints fail open; error path never removed | 8.6, 9.5, 13.2 |
| No new state library; no command signatures; no code | None present; data needs only |
| No node shell, no AI wording, no scoring | None present |
| Errors from Tauri are plain strings; server messages verbatim | Every `{message}` and "verbatim" slot; COPY-RULES 9.3 |
| "Apply" never used for Merge from file | 10.3; the guided editor's "Apply" is a separate decision (D3-8) |
| No fail-open wording for the preview-unavailable case | 3.1 uses "unavailable" |
| Qualifier copy: point-in-time | "Compared {HH:MM:SS}. The cluster can change before you confirm." in every gate |
| Design tokens by role, no hex | Section 14.4 |
| A11y: diff rows not red/green alone | DIFF-ROW glyphs and words, 14.3 |

---

## 16. Open questions and decisions

### 16.1 For the tech lead

Data needs in plain words. No signatures are proposed.

| # | Need |
|---|---|
| Q3-1 | **#6.** Where is the neat string produced? There is no YAML parser on the frontend. Contract: a derived string; never the Save or dry-run input. |
| Q3-2 | **#7.** Confirm the raw-object read returns `managedFields` untouched, as CLAUDE.md says it returns the object with no filtering. Confirm turning `fieldsV1` into readable paths is done in the frontend. |
| Q3-3 | **#8.** (a) A two-sided diff helper beside `mergePreview.ts`, whose `previewRows` walks only the desired side. (b) Can the app tell that two contexts reach the same API server (server URL equality)? (c) Listing objects of a kind by name in another namespace or cluster, for a name combobox (the free-text name field is the fallback). |
| Q3-4 | **#9.** The pod template of each rollout revision: add it to the revision record, or read the ReplicaSet. Confirm that Watchtower's rollback restores the pod template only, as `kubectl rollout undo` does; the consequence line depends on it. |
| Q3-5 | **#10.** The dry run of the typed replace must return the object as it is now and the object as the server would store it. (a) Can the backend flag which removed keys are "dropped by schema" (present in the submitted YAML, absent after the typed round-trip) as opposed to deleted by the user? Without it the callout falls back to plain removed rows (8.5). (b) Does the editor's YAML carry `resourceVersion`, so a concurrent change surfaces as a conflict? (c) Which changes are the user's and which the server's defaulting, if separable. |
| Q3-6 | **#37.** (a) A dry-run of the upgrade returning the rendered manifest. (b) The current release's manifest, for a per-resource changed/new/removed list (otherwise the list-only fallback). (c) Values as structured data or a key-level diff; otherwise a line diff. (d) Is the shape-only helm command string acceptable, or omit it? (e) A signal for "helm not found" distinct from a template error (the existing friendly error may already be it). |
| Q3-7 | **#28.** (a) The exact `.operation` payload shapes for ArgoCD Sync and History rollback, and what Watchtower does with finalizers on app delete. (b) Is `create_resource_from_yaml` create-only? If it applies, it cannot render as `kubectl create`. (c) The Job name generated by Trigger (01 Q7). (d) The exact `helm install` flag set from `HelmInstallModal`. (e) `KubeContext.source` and the registered file's path, for the `--kubeconfig` footnote. (f) A kubectl-name table for resource types (singular where one exists, otherwise plural-and-group); `RBAC_RESOURCE` already holds plural-and-group for about 40 kinds. |
| Q3-8 | **#29 and contracts.** (a) The `cluster-identity` writer must preserve fields it does not own (00 Q4). (b) A central read-only refusal in the mutation hooks as a backstop to the UI (11.4); without it the inventory is a promise, not a property. (c) The four non-ConfirmModal hosts (`ResourceEditor`, `ResourceCreator`, `HelmInstallModal`, `MergeFromFileModal`) must join the modal-layer registry so Esc is layered (K3) before any dialog is opened over them (F3-5). (d) `ConfirmModal` choosing initial focus independently of `destructive` (14.2). (e) Slots 6 and 7 and a guardrail typed gate on `ConfirmModal`. |
| Q3-9 | **#30.** What propagation does `delete_resource` send today, for Jobs and for the other owner kinds? If it sends none, deleting a Job may orphan its pods now, which is a bug regardless of this feature. Any new argument is `Option<T>`. |
| Q3-10 | **Drain force-delete.** Confirm the frontend loop can reuse `delete_pod` with the default grace period; if a different command or a grace-period argument is needed, say so. |
| Q3-11 | **P4.** Add the `update` verb to the batched access check for YAML Save. It is one more entry in the existing call. |
| Q3-12 | **#46.** Log levels, whether a change applies live, the scrub scope (does it cover the auth-plugin output echoed by `friendly_auth_error`?), and the rotation numbers if they are to be shown. |
| Q3-13 | **#36.** How the server's support for `pods/resize` is detected; which patch type the resize uses (merge patch replaces the whole `containers` array, so it cannot be reused). |
| Q3-14 | **#43.** The schema source and size (OpenAPI v3), and how a field path is found from the caret position. |
| Q3-15 | **Doc check.** F3-14: CLAUDE.md lists node delete under `requireTyping`; the node delete confirm has none. Fix the doc or the code. |

**Shortcuts for the K6 table (proposed, not edited into 00):** `⌘S` in edit mode (opens the review gate), `⌥↓` and `⌥↑` in diff dialogs, `⌘F` (already proposed in 00).

### 16.2 Decisions needed from the user

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| D3-1 | Amend DIFF-ROW so a `⇄ replaced` array row can show an "Inside this array" reading aid for named elements. Expanded by default in #8 and #9, collapsed in #10 and #37. | **Yes.** | The leaf-only rule is right for writes. For reading, `containers`, `env` and `volumes` are arrays, so without this #8 and #9 cannot show which image changed. Without the amendment, drop to text blocks and accept the lower value. |
| D3-2 | Neat YAML default. | **Off, remembered per viewer.** | Preserves what users see today; the remembered choice serves those who want it always. |
| D3-3 | Mask credential-looking Helm values in the v1.3 upgrade diff, though the Values tab shows them in clear text. | **Mask, with per-row Show.** | A diff is what gets pasted into tickets. Costs one click. Matches #33 later. |
| D3-4 | Turning read-only off needs a confirm, and the TopBar badge is the always-available path. | **Yes; plain confirm, no typing.** | The user set it and can undo it. A typed confirm on the escape hatch becomes a trap during an incident. |
| D3-5 | Single-click writes (F3-6): add confirms universally, or only when "Confirm writes by typing" is on. | **Universal confirm only for the pod header "Restart" (F3-2, it is a delete). The rest gain an `sm` confirm only while that guardrail is on.** | Keeps muscle memory for frequent reversible actions (Refresh, Cordon) while making the guardrail real. |
| D3-6 | One typed field per dialog at most. If the dialog already needs typing, the guardrail adds none. | **Yes.** | Two inputs become autopilot; the badge already shows the cluster. |
| D3-7 | Shell exec in read-only mode: blocked or allowed. | **No recommendation (brief).** Options in 11.7. | Either is defensible. It is a product call. |
| D3-8 | Rename `ResourceEditor`'s "Apply" to "Save changes". | **Yes.** | It sits beside a `kubectl patch` equivalent and invites the `kubectl apply` confusion the Merge-from-file rule exists to prevent. |
| D3-9 | YAML Save with schema-dropped fields: acknowledgement checkbox, or typed confirm. | **Checkbox**, with "Open form" as the escape. | Keeps one typed field per dialog. The risk is silent data loss on fields the user never touched; an explicit, specific tick addresses it. |
| D3-10 | Merge from file shows no kubectl command, only an explanation. | **Omit.** | Create versus merge-patch is decided per document at run time; masking Secrets across many documents is error-prone; the preview already lists the exact keys. |
| D3-11 | Windows shell toggle (PowerShell or POSIX) on the kubectl equivalent. | **Yes, Windows only.** | A copy button that produces a command that fails on the platform of 1 of 3 shipped installers is a defect. |
| D3-12 | The Resource diff entry for pods. | **Not offered.** | Pod diffs are mostly noise; reversible. |
| D3-13 | The bulk-limit refusal wording avoids "read-only". | **"Guardrail: bulk actions are limited to N on {label}."** | The brief's example said "Read-only guardrail"; that conflates two separate settings. |
| D3-14 | Drain force-delete dialog gets per-pod checkboxes (reverses 01 section 2.8's exact-set rule) so a bulk limit can be honoured. | **Yes.** | A limit cannot be honoured without a selection. Fallback: refuse outright above the limit (13.1 item 7). |

### 16.3 Corrections to 00 this package asks for

1. **D-1 (delete column).** Add the F3-9 observation: the row delete is `opacity-0` until hover, so the strip is the only persistent signal, and the disabled icon must also show on keyboard focus.
2. **DIFF-ROW 3.4.** The amendment in D3-1, if accepted.
3. **CONFIRM-ANATOMY 2.3.** C5 initial focus for PREVIEW-GATE (14.2), if accepted.
4. **KEYMAP 8.2.** `⌘S` (edit modes only) and `⌥↓`/`⌥↑` in diff dialogs, if accepted.
5. **COPY-RULES 9.5.** One added line to the qualifier glossary: "Compared {HH:MM:SS}. The cluster can change before you confirm." as the point-in-time wording for diff gates.

---

## 17. Microcopy index

The cross-cutting strings an engineer will grep for. Feature-specific copy lives in its own section; this table is the single place for text that appears at many sites. Curly braces are values. Names and quoted objects use straight double quotes in prose (COPY-RULES 9.2). Server messages are inserted verbatim (COPY-RULES 9.3).

### 17.1 Read-only mode and guardrails (#29)

| Where | Text |
|---|---|
| Disabled control, full | Read-only mode (Watchtower guardrail). Turn off in cluster settings. |
| Disabled control, short (table row delete) | Read-only mode. |
| Table strip | Read-only mode. Writes are disabled for this context. [Turn off…] |
| Badge label | Read-only |
| Badge popover | Read-only mode (Watchtower guardrail) is on for {cluster}. It disables Watchtower's write actions. It doesn't affect kubectl or other tools. [Turn off…] [Keep on] |
| Shell line, option B only | Read-only mode doesn't restrict commands you run in a shell. |
| Editor: setting label | Read-only mode |
| Editor: setting help | Disables Watchtower's write actions on this cluster. A guardrail, not a security boundary: kubectl and other tools aren't affected. Actions already running aren't stopped. |
| Editor: other settings | Confirm writes by typing the cluster label / Limit bulk actions to {n} items |
| Editor: invalid limit | Enter a whole number from 1 to 500. |
| Editor: corrupt store | Couldn't read this cluster's guardrail settings. They're off until you set them again. |
| Turn-off confirm | Title: Turn off read-only mode. Body: Watchtower's write actions become available again for {cluster}. Primary: Turn off read-only. Cancel: Cancel |
| Turn-on announcement | Read-only mode on for {cluster}. |
| ⌘N while read-only | Read-only mode. New resource is disabled. |
| Turned on while a dialog is open | Read-only mode was turned on for {cluster}. This action can't be completed. |
| Backstop refusal | Read-only mode (Watchtower guardrail) is on for {cluster}. Turn it off in cluster settings to make changes. |
| Guardrail notice (slot 7) | Guardrail on {cluster}: confirming this action needs typing. |
| Typed label | Type {cluster label} to confirm |
| Bulk refusal | Guardrail: bulk actions are limited to {n} on {cluster}. Deselect {k} to continue. |
| Palette | Turn on read-only mode / Turn off read-only mode… |

### 17.2 PREVIEW-GATE (#9, #10, #37)

| Where | Text |
|---|---|
| Point-in-time line | Compared {HH:MM:SS}. The cluster can change before you confirm. |
| Loading status | #9 Comparing… / #10 Asking the API server what would change… / #37 Rendering the chart with your values… |
| Primary disabled while loading | Waiting for the preview. |
| Rejected status | #10 The API server rejected this change: {message}. / #37 Helm couldn't render this release: {message}. |
| Rejected follow-up | #10 Nothing was saved. Fix the YAML and review again. / #37 Nothing was upgraded. |
| Unavailable, #10 | Couldn't ask the API server for a preview: {message}. You can still save. The server checks the change when you do. |
| Unavailable, #37 | {friendly helm error}. You can still upgrade. Helm will check the chart when it runs. |
| Unavailable primaries | Save without preview / Upgrade without preview (typed confirm: the object or release name) |
| Gate primaries | #10 Save changes / #37 Upgrade release / #9 Roll back to #{n} |
| Gate secondary | Back to editor / Cancel |
| No differences | No differences. + #10 The server would store this object exactly as it is now. / #8 These two objects match after ignoring status and managed fields. / #9 Revision #{n} has the same pod template as the current one. / #37 Your values are unchanged. |
| Conflict | This object changed on the cluster after you opened the editor. + Your YAML wasn't saved. [Copy my YAML] [Back to editor] |
| Diff failed, informational (#9) | Couldn't load the comparison: {message}. You can still roll back. |
| Inside-array header | For reading only. Watchtower writes the whole array. |

### 17.3 #10 dropped-by-schema callout

| Where | Text |
|---|---|
| Row note | This field will be dropped because Watchtower's schema does not know it. |
| Group header | {n} fields will be dropped because Watchtower's schema does not know them. You didn't edit them. |
| Consequence | Saving replaces the whole object, so these are removed. |
| Acknowledgement | I understand {n} fields I didn't edit will be removed. |
| Primary | Save and drop {n} fields (disabled until ticked; reason: Tick the box to continue.) |
| Escape | Edit with the form instead. It only changes the fields you edit. [Open form] |
| Fallback when the backend cannot tell | Some removed fields may be ones Watchtower's schema doesn't know. |

### 17.4 KUBECTL-EQUIV (#28)

| Where | Text |
|---|---|
| Disclosure label | kubectl equivalent |
| Honesty footer | Equivalent, not identical. Watchtower calls the Kubernetes API directly and doesn't run kubectl. |
| Masking footnote | Secret values are replaced with <redacted>. Fill them in before running. |
| Kubeconfig footnote | Context "{ctx}" is defined in {file}. Add --kubeconfig {path}, or include that file in KUBECONFIG. |
| Copy / copied / announcement | Copy / Copied / Command copied |
| Long command | Show full command |
| Unavailable | No equivalent available for this action. |
| Merge from file (no command) | Merge from file has no single kubectl equivalent. Each document is created if it doesn't exist and merge-patched if it does. The preview lists the exact keys that will be set. |
| Drain footnote | kubectl retries refused evictions. Watchtower stops and reports them. |
| Force-delete footnote | Deleting a pod directly bypasses PodDisruptionBudgets. |
| ArgoCD delete footnote | Whether the app's resources are deleted too depends on the resources-finalizer.argocd.argoproj.io finalizer, not on --cascade. |
| Helm upgrade footnote | Watchtower upgrades from the chart stored with the release, using temporary files. <chart> and <values.yaml> stand for those files. |
| Windows toggle | PowerShell / POSIX shell |

### 17.5 #30 Propagation

| Where | Text |
|---|---|
| Group label | What happens to its {dependents} |
| Background | Background (kubectl's default). "{name}" is deleted now. Kubernetes removes its {dependents} afterwards. |
| Foreground | Foreground. "{name}" stays in the list, marked as deleting, until its {dependents} are gone. |
| Orphan | Orphan. Only "{name}" is deleted. Its {dependents} keep running with no owner. |
| Orphan warning | Orphaned pods aren't cleaned up automatically. You'll need to delete them yourself. |
| Primaries | Delete / Delete, keep dependents |
| Dependents by kind | deploy: ReplicaSets and pods. sts, ds, jobs, rs: pods. cron: Jobs and their pods. |

### 17.6 #6, #7, #8, #9

| Where | Text |
|---|---|
| Neat chip / note | Neat / Hiding managedFields, status and {n} other fields. Display only; editing shows the full object. |
| Neat in edit mode | Neat is display only. Cancel editing to switch. / Editing the full object, including managedFields and status. Neat is display only and is never saved. |
| Neat copy | copy neat. Tooltip: Copies the neat YAML, without the hidden fields. |
| Field managers | Field managers ({n}). Who last wrote each field, as recorded by the API server. Read-only. / Managed fields reflect what the API server recorded. Not every tool writes the same way. / No field manager data on this object. |
| Compare entry / legend | Compare with another namespace or cluster / − only in {left} + only in {right} ~ differs |
| Compare: ignored | Ignored in the comparison: status, managed fields, uid, resourceVersion, generation, creation time, name and namespace. |
| Same API server | {a} and {b} use the same API server. You are comparing an object with itself. |
| Other side missing | {kind} "{name}" doesn't exist in {cluster} / {namespace}. Check the name, or pick another namespace. |
| Rollback consequence | Restores the pod template from revision #{n} and rolls the pods. Replicas, strategy and other fields stay as they are. |

### 17.7 Permission and capability hints (P4, #36)

| Where | Text |
|---|---|
| YAML edit / save denied | You don't have permission to update {kind}s in {namespace}. |
| Resize unsupported | This cluster's API server doesn't support in-place resize. |
| Helm Values | No RBAC hint (none can be computed). Read-only mode applies. |

### 17.8 #46 additions

| Where | Text |
|---|---|
| Scrub note | Tokens and credentials are removed before anything is written, including output from cluster authentication plugins. |
| Writes in the log | Write actions are logged by resource name. For Secrets, only key names are logged, never values. |
| Retention (only if supplied) | Keeps up to {n} files of {size} each. Older files are deleted. |
