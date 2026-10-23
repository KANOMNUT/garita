# UX 01: Safety patch (v1.2.1)

Status: wave 1 draft. Depends on `docs/ux/00-overview.md` (cited by contract name: CONFIRM-ANATOMY, DISABLE-PRECEDENCE, STATE-VOCAB, TOKEN-ROLES, KEYMAP, COPY-RULES, A11Y-BASELINE).
Baseline: Watchtower v1.2.0. Design only; no code, no command signatures. Data needs are in section 9.

## 1. Scope

| ID | Item | Class | Surface |
|---|---|---|---|
| P0 / #35 | PDB-respecting drain with preview, progress and honest result | (a) full design | `NodeOverview` in `ResourceDetailPanel.tsx` (Node Actions) |
| P2 | Confirms for Restart, Pause, Resume, Trigger CronJob | (b) note | `WorkloadActions.tsx` |
| P1 | Events tab filtering and empty state | (b) note | `EventsTabContent` in `ResourceDetailPanel.tsx` |
| P5 | ArgoCD History rollback copy | (b) note | ArgoCD History tab in `ResourceDetailPanel.tsx` |

This package is the first consumer of CONFIRM-ANATOMY: the drain uses size `lg` with phases; P2 uses `sm` non-destructive; the force-delete uses a nested `md`.

---

## 2. P0 / #35: Drain

### 2.1 What the user is trying to do

Take a node out of service for maintenance or an upgrade, without taking down any workload. The user's mental model is "move the pods off, tell me when it's safe to reboot". Today the app gives one sentence, no view of what will move, and a success line that over-counts. The new flow must answer three questions in order: what will happen, what is happening, what actually happened.

### 2.2 Entry

`Node Actions` row keeps its three buttons: Cordon/Uncordon, Drain, Delete. Changes:

- Drain button label becomes **"Drain…"** (ellipsis: opens a dialog).
- Cordon/Uncordon, Delete unchanged.
- All three follow DISABLE-PRECEDENCE: in progress > read-only (from v1.3) > RBAC > capability. "In progress" now includes a drain that is running or in the attention state (section 2.9).
- Drain tooltip when RBAC denies: "You don't have permission to drain nodes. Draining needs permission to update nodes and create pod evictions." (SSAR hint, fail open; data need Q1.)

### 2.3 Flow

```
[Drain…]
   │
   ▼
REVIEW (preview loads) ──fails──► REVIEW (preview unavailable, can still drain)
   │ Cancel / Esc → close
   │ [Drain node]
   ▼
RUNNING  step 1: cordon   step 2: evict pods
   │ [Stop] → STOPPED result
   │
   ├── every pod evicted or skipped ──────────► RESULT: complete
   │
   ├── some pods blocked by a PDB (429) ──────► ATTENTION
   │        ├─ [Retry blocked pods] ─► RUNNING (blocked pods only)
   │        ├─ [Stop, leave node cordoned] ──► RESULT: incomplete
   │        └─ [Force-delete blocked pods…] ─► nested dialog (opt-in)
   │                 ├─ Cancel ─► back to ATTENTION
   │                 └─ confirm ─► RUNNING (forced) ─► RESULT
   │
   └── other pods failed (not 429) ──────────► RESULT: incomplete (failed counts shown)
```

Numbered flow:

1. User clicks **Drain…**. A `lg` dialog opens in phase `review`. Identity badge is shown (C1). The preview request starts immediately.
2. Preview renders (2.4). The user reads it, optionally refreshes it, and clicks **Drain node** or cancels.
3. Phase `running`. First step is cordon; if cordon fails, the dialog goes to `error` (2.8) and nothing was evicted. Second step evicts pods. Per-pod outcomes update live (2.6).
4. If all pods are done: phase `result`, outcome "complete".
5. If one or more pods were refused by a PDB (HTTP 429 from the eviction): the run for the other pods continues to the end of the first pass, then the dialog moves to phase `attention` (2.7). Blocked pods are never deleted by the app unless the user chooses **Force-delete** and passes the typed confirm.
6. In `attention`, the user chooses Retry, Stop, or (if in scope) Force-delete.
7. A final `result` card persists in the Node Actions area after the dialog closes (2.10), and the node's cordon state is stated in it.

Why a single pass then stop, instead of waiting for budgets (recommendation, see Q3): the brief says a 429 is a stop-and-report outcome, not a failure to hide. A silent wait looks like a hang and the user cannot tell "waiting for a rollout to free a budget" from "stuck forever". Manual retry makes the cause visible. If the tech lead adds automatic retry, the UI already has a "Waiting" per-pod state (2.6) and an elapsed timer; the only change is that blocked rows read "Retrying in 12s" instead of "Blocked".

### 2.4 Review phase: wireframe (window ≥ 900 px, `lg` dialog ≈ 672 px)

Preview loaded, mixed case:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                                          │
│ ⚠ Drain node worker-3                                                │
│ Cordons the node, then evicts its pods so they reschedule elsewhere. │
│ Pods that a PodDisruptionBudget protects are not deleted.            │
│                                                                      │
│ Point-in-time snapshot taken 14:02:11. Budgets can change while the  │
│ drain runs.                                              [↻ Refresh] │
│                                                                      │
│  12 to evict     2 may be blocked     4 DaemonSet skipped   1 static │
│                                                                      │
│ ▾ May be blocked by a PodDisruptionBudget (2)                        │
│   ⊘ shop/checkout-6f8c     PDB checkout-pdb   allowed disruptions: 0 │
│   ⊘ shop/checkout-7a21     PDB checkout-pdb   allowed disruptions: 0 │
│                                                                      │
│ ▾ Will be evicted (12)                                               │
│   ○ shop/api-7d9f        Deployment api                              │
│   ○ shop/api-8e10        Deployment api                              │
│   ○ shop/worker-0        StatefulSet worker                          │
│   … 9 more                                            [Show all]     │
│                                                                      │
│ ▸ Skipped: DaemonSet pods (4)                                        │
│ ▸ Skipped: static (mirror) pods (1)                                  │
│                                                                      │
│ ⚠ 1 pod has no controller and will not be recreated:                 │
│   batch/one-off-migrate                                              │
│                                                                      │
│ Type worker-3 to confirm  [______________________]   (only if above) │
│                                                                      │
│                                   [Cancel]  [Drain node]             │
└──────────────────────────────────────────────────────────────────────┘
```

Behavioural notes:

- **Counts row is a summary of the sections below** and is built from the same lists; chips are not buttons. Each chip pairs a glyph and a word: "to evict", "may be blocked", "DaemonSet skipped", "static skipped".
- **Section order** puts the thing the user must act on first: may-be-blocked, then will-be-evicted, then skipped (collapsed by default).
- A pod that may be blocked appears **only in the may-be-blocked section**, not also in will-be-evicted, so the counts add up: 12 to evict + 2 may be blocked + 4 + 1 = the node's pod list. The "12 to evict" chip means *evictable without an expected refusal*.
- "Allowed disruptions: 0" is the PDB's value at snapshot time. The copy says "allowed disruptions", the K8s field name, since the audience knows it.
- **Unmanaged pods (no controller)** get their own warning because eviction removes them for good. If any exist, the typed confirm (node name) is required (recommendation, Q5). If none, no typed confirm.
- **Refresh** re-runs the preview, keeps scroll and expansion state, and updates the timestamp. Auto-refresh does not happen.
- The preview never promises the outcome. The header line says "may be blocked", never "will be blocked" and never "will succeed".
- Identity badge always rendered (C1).
- Dialog title icon: warning triangle (destructive style, C2).

Compact variant (window narrower than 560 px): chips wrap to two rows; pod rows show namespace/name on the first line and owner on the second; the PDB info moves to the second line.

### 2.5 Review phase: states

| State | What the user sees |
|---|---|
| Preview loading | Dialog opens at full size. Summary and chips replaced by "Checking what's on worker-3…" with a skeleton of 4 rows. Primary button disabled with label "Drain node" and reason on focus: "Waiting for the preview." Cancel enabled. |
| Preview loaded | Section 2.4. |
| Preview failed | See "Preview failed" below. |
| Nothing to evict | See "Nothing to evict" below. |
| All blocked | See "All blocked" below. |
| Node already cordoned | A line under the consequence summary: "This node is already cordoned." The Drain flow continues normally (cordon step is skipped and shown as "Already cordoned"). |
| Node not Ready / unreachable | Info line: "worker-3 is NotReady. Eviction requests may time out." Does not block. |
| Denied (RBAC) | Drain button is not reachable (disabled with reason, section 2.2). If the denial surfaces only at run time (SSAR is a hint), the dialog goes to `error` with the server message verbatim (2.8). |
| Read-only (v1.3, #29) | Drain button disabled with the read-only reason; dialog cannot open. n/a in v1.2.1. |
| CRD-absent | n/a: nodes, pods, PDBs and evictions are core APIs. |
| Cluster unreachable | Preview fails with the Unreachable state from STATE-VOCAB inside the body: "Can't reach prod-eu-1." plus "Retry". Drain stays disabled (nothing can run). |
| Namespace = "all" | n/a: a node is cluster-scoped. |

**Preview failed** (informational, not a block; this is not a fail-open of the SSAR kind):

```
│ ⓘ Couldn't load the preview: <message>.                       [Retry] │
│ You can still drain. Watchtower only asks the API server to evict      │
│ pods, and PodDisruptionBudgets are enforced by the server. Pods it     │
│ refuses to evict are reported, not deleted.                            │
│                                         [Cancel]  [Drain without preview] │
```

- Primary label changes to **"Drain without preview"** so the user cannot press "Drain node" without noticing the missing information.
- Typed confirm (node name) is required in this state, because the user cannot see whether unmanaged pods exist.
- This relies on the backend change in P0 (eviction only, no delete fallback). If the tech lead does not ship that change together with this UI, the copy above is false and this state must instead block the drain (Q4).

**Nothing to evict**

```
│ ⓘ Nothing to evict.                                                    │
│ worker-3 runs only DaemonSet pods (4) and static pods (1).             │
│ Draining would only cordon the node.                                   │
│                                        [Cancel]  [Cordon node]         │
```

If the node is already cordoned: summary "worker-3 is already cordoned and has nothing to evict." and only **Close** in the footer.

**All blocked**

```
│ ⚠ All 14 evictable pods are blocked by PodDisruptionBudgets right now.  │
│ Draining will cordon worker-3 and evict nothing until budgets allow it. │
│                                       [Cancel]  [Cordon and try drain]  │
```

### 2.6 Running phase: wireframe

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                                          │
│ ⟳ Draining worker-3                                                  │
│ ✓ Cordoned   ● Evicting pods…                       elapsed 0:42     │
│                                                                      │
│ ████████████░░░░░░░░░░░░░░░░░░   8 of 14 done                        │
│                                                                      │
│  8 evicted    1 evicting    3 waiting    2 blocked    0 failed       │
│                                                                      │
│ ⊘ shop/checkout-6f8c   Blocked by PDB checkout-pdb (0 allowed)       │
│ ⊘ shop/checkout-7a21   Blocked by PDB checkout-pdb (0 allowed)       │
│ ⟳ shop/api-9b40        Evicting…                                     │
│ ○ shop/api-9c11        Waiting                                       │
│ ✓ shop/api-7d9f        Evicted                                       │
│ ✓ shop/api-8e10        Evicted                                       │
│   … 6 more                                                           │
│                                                                      │
│ The node stays cordoned if you stop.             [Stop]              │
└──────────────────────────────────────────────────────────────────────┘
```

Per-pod row states. Every state has a glyph, a word, and a role colour; none relies on colour:

| State | Glyph | Word | Role |
|---|---|---|---|
| Waiting | `○` | Waiting | `dim` |
| Evicting | `⟳` | Evicting… | `status-progress` |
| Evicted | `✓` | Evicted | `status-ok` |
| Blocked | `⊘` | Blocked by PDB <name> (<n> allowed) | `status-warn` |
| Failed | `✕` | Failed: <reason> | `status-bad` |
| Skipped | `–` | Skipped: DaemonSet / static pod | `dim` |

Rules:

- **Sort**: blocked and failed first, then evicting, then waiting, then evicted. A pod moves down the list when it changes state; the list does not jump while the user is reading: re-sorting happens at most once every 2 seconds and never while the pointer is over the list or focus is in it.
- **Counts row** is derived from real per-pod outcomes. "done" in the progress label means evicted + skipped (terminal) + blocked/failed (settled for this pass). The label reads "8 of 14 done" and the counts row spells out the split, so "done" cannot be misread as "evicted".
- **Determinate vs indeterminate**: determinate when the total is known (it is, from the preview or the first listing). If the backend only reports a final result (Q2), the bar is indeterminate, the counts row is replaced by "Waiting for the API server… elapsed 0:42", per-pod rows are not shown, and the result phase still gives real counts.
- **Stop** (secondary button, footer). Semantics: no further evictions are started; an eviction request already in flight completes. The node stays cordoned. The text beside it says so. Clicking Stop sets the footer to "Stopping after the current eviction…" with the button disabled, then moves to `result` with outcome "stopped".
- **Esc does nothing to the run** (CONFIRM-ANATOMY 2.5). It focuses Stop and sets the status line: "Press Stop to stop. Esc doesn't cancel a running drain."
- **Backdrop click** does nothing. There is no close (X) control while running.
- If the user must leave the panel, they cannot while this dialog is open. The drain is typically seconds to a few minutes. Alternative considered and rejected for v1.2.1: minimising to an inline card. It adds a second state machine, and the app-level Esc handler (finding F2) would unmount the panel. Revisit with Q2 (progress transport) and the layered Esc fix.
- Window close or app quit mid-drain: the node stays cordoned and some pods may be evicted. The app should warn on quit (data need Q6); the copy is in 2.11.

### 2.7 Attention phase (429 branch): wireframe

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                                          │
│ ⚠ Drain paused on worker-3                                           │
│ 2 pods can't be evicted right now because a PodDisruptionBudget      │
│ refuses it. 10 pods were evicted. The node is still cordoned.        │
│                                                                      │
│  10 evicted    2 blocked    0 failed    4 DaemonSet and 1 static     │
│  skipped                                                             │
│                                                                      │
│ Blocked pods                                                         │
│ ⊘ shop/checkout-6f8c   PDB checkout-pdb · allowed disruptions: 0     │
│     Server: Cannot evict pod as it would violate the pod's           │
│     disruption budget.                                               │
│ ⊘ shop/checkout-7a21   PDB checkout-pdb · allowed disruptions: 0     │
│     Server: Cannot evict pod as it would violate the pod's           │
│     disruption budget.                                               │
│                                                                      │
│ ▸ Evicted (10)                                                       │
│                                                                      │
│ Budgets free up when other replicas become ready, for example after  │
│ a rollout finishes. Retry in a moment, or stop and come back later.  │
│                                                                      │
│              [Stop, leave node cordoned]   [Retry blocked pods]      │
│                                                                      │
│ ── Override ─────────────────────────────────────────────────────    │
│ Force-delete the blocked pods…   Bypasses the PodDisruptionBudget.   │
└──────────────────────────────────────────────────────────────────────┘
```

Behavioural notes:

- **Primary** is **Retry blocked pods**. It runs the same eviction on only the blocked pods. Counts are cumulative across attempts; the summary shows attempts ("Attempt 2").
- **Stop** is secondary. Label is exact: "Stop, leave node cordoned", so the consequence is in the button.
- **Force-delete is not in the footer and not a button.** It is a link-style control in a separate "Override" band below a rule, in `status-bad` text with an icon, so it cannot be hit by muscle memory while retrying. It is never preselected, never default focus, never reachable by Enter from the footer buttons. Tab order: Stop, Retry, then the Override link.
- The server message is shown verbatim (COPY-RULES 9.3), under each blocked pod, in monospace and dimmed. Long messages wrap.
- Per CONFIRM-ANATOMY, Esc closes the dialog in `attention`. Closing here is the same as Stop: nothing further runs, and the node stays cordoned. The persistent result card (2.10) then shows "Drain paused. 2 pods are still blocked." So closing never hides the unresolved state.
- Announcement on entering: assertive, "Drain paused. 2 pods are blocked by a PodDisruptionBudget. 10 pods were evicted."
- **If force-delete is deferred (Q4 in the brief, Q3 here):** the Override band is replaced by one dim line: "To remove these pods anyway, delete them from the Pods view. Deleting bypasses the PodDisruptionBudget." That is a pointer, not a control; the existing pod delete confirm carries the consequence.

### 2.8 Force-delete (explicit opt-in): nested dialog

Opens above the attention dialog. The dialog below is dimmed and inert. `md` size, destructive style, own identity badge (C1).

```
512 px
┌───────────────────────────────────────────────────┐
│ ● prod-eu-1                                       │
│ ⚠ Force-delete 2 blocked pods                     │
│ This bypasses the PodDisruptionBudget. The pods   │
│ are deleted directly, so the workloads they       │
│ belong to can lose availability or go down        │
│ entirely.                                         │
│                                                   │
│ shop/checkout-6f8c   PDB checkout-pdb             │
│ shop/checkout-7a21   PDB checkout-pdb             │
│                                                   │
│ ⚠ 1 of these pods has no controller and will not  │
│   be recreated.                      (if any)     │
│                                                   │
│ Type worker-3 to confirm  [_________________]     │
│                                                   │
│                  [Cancel]  [Force-delete 2 pods]  │
└───────────────────────────────────────────────────┘
```

| Rule | Detail |
|---|---|
| Scope | Only the pods currently blocked. Never every pod on the node, never pods that are still waiting. The list in the dialog is the exact set. |
| Typed confirm | Always required. Typed value is the **node name** (the thing being operated on). Initial focus on the input; Cancel stays reachable by Tab. |
| Primary label | "Force-delete N pods", with N. Disabled until the typed value matches. `⌘↵` works only after a match (KEYMAP K5). |
| Not a retry path | The app never offers force as an automatic follow-up, as a pre-checked option, or as a "Retry with force" shortcut. |
| After confirm | The parent dialog returns to `running` with a banner "Force-deleting 2 pods…". Rows show "Deleting…", then "Deleted, PDB bypassed" in `status-warn` with the `✓` glyph plus the word "bypassed", so the result stays honest about how the pod went away. |
| Result copy | Counts show "forced" as its own number: "10 evicted · 2 force-deleted". Never merged into "evicted". |
| Cancel / Esc | Closes only this dialog; the attention dialog is intact. |

### 2.9 Result phase: honest summary

Outcomes and titles. The word "drained" appears only when blocked = 0, failed = 0 and the run was not stopped early.

| Outcome | Condition | Title | Icon role |
|---|---|---|---|
| Complete | Every evictable pod evicted; skipped pods are DaemonSet/static only | "Node drained" | `status-ok` |
| Complete with forced | As above, but at least one pod was force-deleted | "Node drained, 2 pods force-deleted" | `status-warn` |
| Incomplete | Any blocked or failed pod remains | "Drain incomplete" | `status-warn` |
| Stopped | User pressed Stop | "Drain stopped" | `status-warn` |
| Failed | Cordon failed or nothing could run | "Drain failed" | `status-bad` |

Wireframe, incomplete:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● prod-eu-1                                                          │
│ ⚠ Drain incomplete on worker-3                                       │
│ 10 evicted · 2 blocked by a PodDisruptionBudget · 1 failed ·         │
│ 4 DaemonSet and 1 static pod skipped                                 │
│                                                                      │
│ Node remains cordoned. Uncordon to return it to service.             │
│                                                                      │
│ ✕ shop/report-0     Failed: <server message>                         │
│ ⊘ shop/checkout-6f8c   Blocked by PDB checkout-pdb                   │
│ ⊘ shop/checkout-7a21   Blocked by PDB checkout-pdb                   │
│ ▸ Evicted (10)                                                       │
│                                                                      │
│              [Uncordon node]  [Retry blocked pods]  [Close]          │
└──────────────────────────────────────────────────────────────────────┘
```

Rules:

1. **Counts come from real outcomes.** The summary never shows "N evicted" where N includes pods whose eviction failed or was refused. (This replaces the old message that over-counted.)
2. Each count appears only if non-zero, except `evicted`, which is always shown, including "0 evicted".
3. The cordon line is always present unless the node is uncordoned: **"Node remains cordoned. Uncordon to return it to service."** On a complete drain the line reads: "Node is cordoned and empty. Uncordon when maintenance is done."
4. **Uncordon is reachable in the dialog footer** and also from the Node Actions button (which already toggles to Uncordon). Uncordon from the dialog is a one-click action without its own confirm, because it is reversible and the user already confirmed the drain; it shows its own pending state and a one-line result ("Node uncordoned.").
5. Footer actions vary: Incomplete shows [Uncordon node] [Retry blocked pods] [Close]; Complete shows [Uncordon node] [Close]; Stopped shows [Uncordon node] [Resume drain] [Close] where Resume drain re-opens the review phase with a fresh preview; Failed shows [Retry] [Close].
6. The `result` and `attention` phases are the only ones in which the pod list is allowed to be long: it scrolls inside the body.

### 2.10 Persistent result card (Node Actions area)

When the dialog closes after `attention` or `result`, the outcome stays visible in the existing `actionResult` position (above the buttons) as a card, because the dialog is gone and the node's state is still unresolved.

```
Node Actions
┌─────────────────────────────────────────────────────────┐
│ ⚠ Drain incomplete · 10 evicted, 2 blocked, 1 failed    │
│   Node remains cordoned. Uncordon to return it to       │
│   service.                          [View details] [✕]  │
└─────────────────────────────────────────────────────────┘
[Uncordon]  [Drain…]  [Delete]
```

| Element | Behaviour |
|---|---|
| View details | Reopens the dialog in `result` phase with the same data |
| Dismiss (✕) | Removes the card; does not change the node |
| Lifetime | Until dismissed, until the panel switches to another node, or until a new drain starts. Not persisted across app restarts |
| Role | `status-ok` for complete; `status-warn` for incomplete/stopped/paused; `status-bad` for failed |
| Announcement | Polite on appearance |

### 2.11 Copy deck (drain)

| Slot | Text |
|---|---|
| Entry button | "Drain…" |
| Review title | "Drain node {node}" |
| Review summary | "Cordons the node, then evicts its pods so they reschedule elsewhere. Pods that a PodDisruptionBudget protects are not deleted." |
| Snapshot line | "Point-in-time snapshot taken {HH:MM:SS}. Budgets can change while the drain runs." |
| Section headers | "May be blocked by a PodDisruptionBudget ({n})", "Will be evicted ({n})", "Skipped: DaemonSet pods ({n})", "Skipped: static (mirror) pods ({n})" |
| Blocked row | "{ns}/{pod}   PDB {pdb}   allowed disruptions: {n}" |
| Unmanaged warning | "{n} pod has no controller and will not be recreated: {ns}/{pod}" (plural: "{n} pods have no controller and will not be recreated.") |
| Typed label | "Type {node} to confirm" |
| Primary | "Drain node" (also "Drain without preview", "Cordon node", "Cordon and try drain") |
| Cancel | "Cancel" |
| Preview loading | "Checking what's on {node}…" |
| Preview failed | "Couldn't load the preview: {message}." + "You can still drain. Watchtower only asks the API server to evict pods, and PodDisruptionBudgets are enforced by the server. Pods it refuses to evict are reported, not deleted." |
| Nothing to evict | "Nothing to evict. {node} runs only DaemonSet pods ({n}) and static pods ({n}). Draining would only cordon the node." |
| Already cordoned, nothing to evict | "{node} is already cordoned and has nothing to evict." |
| All blocked | "All {n} evictable pods are blocked by PodDisruptionBudgets right now. Draining will cordon {node} and evict nothing until budgets allow it." |
| Running title | "Draining {node}" |
| Steps | "Cordoned", "Already cordoned", "Evicting pods…" |
| Progress | "{k} of {n} done" |
| Counts | "{n} evicted", "{n} evicting", "{n} waiting", "{n} blocked", "{n} failed" |
| Stop hint | "The node stays cordoned if you stop." |
| Stopping | "Stopping after the current eviction…" |
| Esc during run | "Press Stop to stop. Esc doesn't cancel a running drain." |
| Attention title | "Drain paused on {node}" |
| Attention summary | "{n} pods can't be evicted right now because a PodDisruptionBudget refuses it. {k} pods were evicted. The node is still cordoned." |
| Attention help | "Budgets free up when other replicas become ready, for example after a rollout finishes. Retry in a moment, or stop and come back later." |
| Attention buttons | "Retry blocked pods", "Stop, leave node cordoned" |
| Override link | "Force-delete the blocked pods…" with sub-line "Bypasses the PodDisruptionBudget." |
| Override alt (deferred) | "To remove these pods anyway, delete them from the Pods view. Deleting bypasses the PodDisruptionBudget." |
| Force title | "Force-delete {n} blocked pods" |
| Force consequence | "This bypasses the PodDisruptionBudget. The pods are deleted directly, so the workloads they belong to can lose availability or go down entirely." |
| Force primary | "Force-delete {n} pods" |
| Result titles | "Node drained", "Node drained, {n} pods force-deleted", "Drain incomplete on {node}", "Drain stopped", "Drain failed" |
| Cordon line | "Node remains cordoned. Uncordon to return it to service." / "Node is cordoned and empty. Uncordon when maintenance is done." |
| Error (cordon failed) | "Couldn't cordon {node}: {message}. No pods were evicted. Check that your account can update nodes, or ask a cluster admin." |
| Error (evict forbidden) | "Couldn't evict pods on {node}: {message}. Your account may lack permission to create pod evictions. Ask a cluster admin." |
| Quit during drain (data need Q6) | "A drain of {node} is running. If you quit, {node} stays cordoned and some pods may already have been evicted." |

### 2.12 Keyboard and accessibility (drain)

| Aspect | Spec |
|---|---|
| Focus on open (review) | Cancel (destructive without typed confirm, C5). If typed confirm is required, the input. |
| Tab order, review | Refresh, section disclosures, typed input (if any), Cancel, primary |
| Tab order, running | Stop only (list is read-only; the list itself is reachable as a scrollable region with `tabindex` so keyboard users can scroll it) |
| Tab order, attention | Pod list region, Stop, Retry, Override link |
| Shortcuts | `Esc` per CONFIRM-ANATOMY 2.5. `⌘↵` triggers the primary in `review` and Retry in `attention`, never Force-delete before the typed value matches, never in `running` |
| Dialog semantics | `role=dialog`, name = title, description = summary; focus trapped; focus returns to the Drain… button (or the result card's View details) on close |
| Live region | Polite, throttled to one announcement per 5 s: "8 of 14 pods done. 2 blocked." Immediate announcement when the first blocked or failed pod appears. Assertive on `attention`. Polite on `result`. |
| Progress bar | `progressbar` role with min 0, max total, now = done. Indeterminate when total unknown |
| Pod rows | Each row is a list item whose text reads in full, e.g. "Blocked: shop/checkout-6f8c, PodDisruptionBudget checkout-pdb, 0 disruptions allowed" |
| No colour alone | Every state has a glyph and a word (2.6 table) |
| Reduced motion | Spinner on "Evicting…" may rotate; the progress bar fill changes without animation |
| Light and dark | Roles only: evicted `status-ok`, blocked and paused `status-warn`, failed `status-bad`, in progress `status-progress`, skipped and waiting `dim`, section chips on `surface-tint`, dialog on `surface-overlay`, rule lines `edge`, override link text `status-bad` (must reach 4.5:1 on `surface-overlay` in both themes; UX-05 verifies) |

### 2.13 Components touched

| File | Change (design-level) |
|---|---|
| `src/components/ConfirmModal.tsx` | Extended per CONFIRM-ANATOMY: sizes, body slot, status slot, phases, Esc/backdrop rules, dialog semantics |
| `src/components/ResourceDetailPanel.tsx` (`NodeOverview`) | Drain button label and dialog; persistent result card replaces the one-line `actionResult` for drain; Uncordon reachable from dialog |
| Hooks for node actions (`useResources.ts`) | Frontend data needs in section 9; no signature is proposed here |

---

## 3. P2: Confirms for Restart, Pause, Resume, Trigger CronJob

### 3.1 Class and style

All four are **non-destructive** in the data sense (C2): info glyph in the `accent` role, primary button in `accent`, `sm` size, identity badge (C1). They change the running system, so each states the consequence in one or two lines.

Entry buttons gain a trailing ellipsis because they now open a dialog: "Rolling Restart…", "Pause…", "Resume…", "Trigger Now…". Scale and Rollback stay as they are (they already confirm or use an inline control).

Read-only (v1.3) and RBAC follow DISABLE-PRECEDENCE; the existing `NO_PERMISSION_PATCH` / `NO_PERMISSION_CREATE` strings remain the RBAC tooltips.

### 3.2 Flow (same for all four)

1. Click the button. Dialog opens; focus lands on the primary button (non-destructive, C5).
2. Confirm: button shows a spinner and "Restarting…" style label; Cancel is disabled (existing behaviour); Esc and backdrop do nothing while pending.
3. Success: the dialog closes and the existing result affordance (button label returns, query refetches) shows the new state. A one-line toast-style result appears in the actions area: "Restarted "api"." (the project has no toast system; use the same inline result strip pattern as Node Actions.)
4. Failure: the dialog stays open, the status slot shows the error, the primary becomes "Try again".

### 3.3 Copy

| Action | Title | Consequence summary | Primary | Pending label | Success line |
|---|---|---|---|---|---|
| Restart (Deployment, StatefulSet, DaemonSet) | "Restart {kind} {name}" | "Replaces every pod of "{name}" with a new one, rolling, according to its update strategy. Pods keep serving until replacements are ready." | "Restart {kind}" | "Restarting…" | "Restarted "{name}"." |
| Pause (Deployment) | "Pause rollouts for {name}" | "Rollouts stop until you resume. Changes to the pod template won't roll out. Scaling still works, and running pods are not touched." | "Pause rollouts" | "Pausing…" | "Paused rollouts for "{name}"." |
| Resume (Deployment) | "Resume rollouts for {name}" | "Rollouts start again. Any pod template changes made while paused will roll out now." | "Resume rollouts" | "Resuming…" | "Resumed rollouts for "{name}"." |
| Trigger CronJob | "Run {name} now" | "Creates a Job from this CronJob's template now, outside its schedule. The schedule is unchanged. To stop the run, delete the Job." | "Create Job" | "Creating…" | "Created Job "{job}" from "{name}"." (job name is a data need, Q7; fall back to "Created a Job from "{name}".") |

Notes:

- Restart for a StatefulSet and a DaemonSet uses the same sentence: "according to its update strategy" is true for both and avoids claiming an ordering that depends on `OnDelete` settings.
- Trigger on a **suspended** CronJob works the same, so the summary adds: "This CronJob is suspended; a manual run still creates a Job." (shown only when suspended; data already on the object).
- Trigger name collisions or `concurrencyPolicy: Forbid`: no claim is made; failure is shown verbatim.
- A kubectl-equivalent line arrives in v1.3 (#28) in slot 6; no change to these dialogs is needed in v1.2.1.

### 3.4 Error copy

| Action | Text |
|---|---|
| Restart | "Couldn't restart "{name}": {message}. Check that your account can update {kind}s in {namespace}, or ask a cluster admin." |
| Pause | "Couldn't pause rollouts for "{name}": {message}. Check that your account can update deployments in {namespace}." |
| Resume | "Couldn't resume rollouts for "{name}": {message}. Check that your account can update deployments in {namespace}." |
| Trigger | "Couldn't create a Job from "{name}": {message}. Check that your account can create jobs in {namespace}." |

### 3.5 States

| State | Behaviour |
|---|---|
| Loading | n/a for the dialog; the button is disabled while the workload's data is loading (existing) |
| Empty | n/a |
| Error | Status slot, dialog stays open, "Try again" |
| Denied (SSAR) | Entry button disabled with existing `NO_PERMISSION_*` tooltip. If the server denies at run time, the error text above |
| Read-only (v1.3) | Entry disabled with the read-only reason (precedence 2) |
| CRD-absent | n/a |
| Partial | n/a |
| Unreachable cluster | Error state with the server/transport message verbatim; trust banner is already visible |
| Namespace = "all" | n/a (workload actions operate on a specific object) |

### 3.6 Keyboard and a11y

Initial focus on the primary button. `Enter` activates it; `Esc` cancels (not while pending). `⌘↵` also confirms. Dialog semantics, polite result announcement, assertive error announcement per A11Y-BASELINE.

### 3.7 Components touched

`src/components/WorkloadActions.tsx` (`RestartAction`, `PauseResumeAction`, `TriggerCronJob`), `src/components/ConfirmModal.tsx`.

---

## 4. P1: Events tab

### 4.1 Problem and effect on the UI

After the fix, events are matched on object kind as well as name. A Deployment and a Service that share a name no longer show each other's events, so the tab will show **fewer** events and sometimes none. The empty state must explain that this is correct and what the retention limit is, or users will read "no events" as "something is broken".

### 4.2 No new controls. Changed copy and states

Existing tab has a severity filter (all vs warnings). Keep it.

```
Events tab, 480 px panel
┌──────────────────────────────────────────┐
│ [All 12] [Warnings 3]                    │
│ ⚠ BackOff   Back-off restarting failed...│
│   Pod/api-7d9f · 4m ago · ×12            │
│ ...                                      │
│ ────────────────────────────────────     │
│ Events about this {Kind} only. Its pods  │
│ and ReplicaSets have their own events.   │
│ Kubernetes keeps events for about 1 hour.│
└──────────────────────────────────────────┘
```

The footer note is one dim line, always shown when at least one event is listed.

### 4.3 States

| State | Copy |
|---|---|
| Loading | Skeleton rows (existing). Status for screen readers: "Loading events." |
| Empty, all filter | "No events for this {Kind}." + "Kubernetes keeps events for about 1 hour, so older causes may not appear." |
| Empty, Warnings filter, events exist | "No warning events." + "{n} normal events are hidden." + button "Show all" |
| Error | "Couldn't load events: {message}." + Retry |
| Denied | STATE-VOCAB No access: "You don't have access to events in {namespace}. Your account can't list events. Ask a cluster admin for the list permission." |
| Read-only | n/a: read view |
| CRD-absent | n/a: Events are core |
| Partial | n/a: scoped to one object and namespace |
| Unreachable | STATE-VOCAB Unreachable |
| Namespace = "all" | n/a: events are fetched for the object's own namespace; cluster-scoped objects use the empty namespace |

### 4.4 Accessibility

The empty and filtered-empty blocks are announced politely on tab open. The "Show all" button is a normal button. Severity is shown by glyph and the word "Warning" or "Normal", not colour only.

### 4.5 Components touched

`src/components/ResourceDetailPanel.tsx` (`EventsTabContent`, the empty branch currently "No events found").

---

## 5. P5: ArgoCD History rollback copy

### 5.1 Today

The History tab renders a "Rollback to this revision" action per entry. CLAUDE.md documents that it sends a bare revision and does not restore the source (repo, path, chart). The name over-promises.

### 5.2 Copy by state

State A: **before the fix lands** (v1.2.1 if the engine fix is not shipped).

| Element | Text |
|---|---|
| Row button | "Sync to this revision…" (renamed from "Rollback to this revision") |
| Dialog title | "Sync {app} to revision {short-sha}" |
| Consequence | "Syncs the app's current source at revision {short-sha}. It does not restore the repository, path or chart that revision was deployed from." |
| Extra line, only if this entry's recorded source differs from the app's current source | "This revision was deployed from a different source than the app uses now. Syncing it here may not reproduce the old state." |
| Primary | "Sync to revision" |
| Style | Keeps whatever `destructive` flag the call site has today (no change) |

State B: **after the fix lands**.

| Element | Text |
|---|---|
| Row button | "Roll back to this revision…" |
| Dialog title | "Roll back {app} to revision {short-sha}" |
| Consequence | "Restores revision {short-sha} and the source it was deployed from (repository, path and target revision)." |
| Extra line | "If auto-sync is on, the controller may sync the app forward again." (shown only when auto-sync is enabled; whether rollback is even accepted with auto-sync on is Q8) |
| Primary | "Roll back" |

Transition rule: the button label and the dialog text change together with the engine fix, in the same release. A release that ships the old engine with state B copy is a regression.

### 5.3 States

| State | Behaviour |
|---|---|
| Loading | n/a (history is already on the Application) |
| Empty | Existing History empty state; "No deployment history yet." if none (keep) |
| Error | Status slot in the dialog: "Couldn't {sync/roll back} {app}: {message}." |
| Denied | Row button disabled via existing mechanism; reason text per DISABLE-PRECEDENCE |
| Read-only (v1.3) | Disabled with read-only reason. Note: this write is not reached by `usePermissions` today (brief UX-03 inventory) |
| CRD-absent | n/a: ArgoCD views already handle absent CRDs |
| Others | n/a |

### 5.4 Components touched

`src/components/ResourceDetailPanel.tsx` (ArgoCD History tab; find by the string "Rollback to this revision").

---

## 6. Cross-cutting: states summary for the package

| State | P0 drain | P2 confirms | P1 events | P5 rollback |
|---|---|---|---|---|
| Loading | Preview skeleton | n/a | Skeleton | n/a |
| Empty | Nothing to evict | n/a | "No events for this {Kind}." | Existing |
| Error | Dialog error slot / preview failed | Status slot | Retry | Status slot |
| Denied | Entry disabled; run-time server message | Entry disabled | STATE-VOCAB No access | Entry disabled |
| Read-only | v1.3 | v1.3 | n/a | v1.3 |
| CRD-absent / not installed | n/a (core API) | n/a | n/a | n/a |
| Partial | `attention` and `incomplete` outcomes | n/a | n/a | n/a |
| Unreachable | Preview fails to Unreachable block; drain disabled | Error with message | STATE-VOCAB Unreachable | Error with message |
| Namespace = "all" | n/a | n/a | n/a | n/a |

---

## 7. Light and dark notes

All colour is by role (TOKEN-ROLES). Specific points for this package:

- Blocked (`status-warn`) must remain distinguishable from failed (`status-bad`) without colour: glyphs `⊘` and `✕` and words differ.
- The Override band uses `status-bad` for text and icon only, with no fill, so it is visible but not loud; the force dialog's primary uses the standard destructive treatment.
- The persistent result card uses `surface-card` with a left edge in the outcome's status role; text stays `ink`.
- Light theme risk: `status-warn` text on a light `surface-overlay`. UX-05 must supply a darker light value; this package does not rely on the dark value.

---

## 8. Constraint checklist

| Constraint (brief or CLAUDE.md) | Where satisfied |
|---|---|
| Preview shows evicted, DaemonSet-skipped, mirror/static, PDB-blocked with PDB name and allowed disruptions | 2.4 |
| Live progress: evicted, waiting, blocked | 2.6 |
| 429 is stop-and-report; retry / stop / force | 2.7 |
| Force-delete separate, own typed confirm, consequence copy, never default, never pre-checked | 2.7, 2.8 |
| Result counts from real outcomes; never "N evicted" when some failed | 2.9 rule 1 |
| Cordon persists after aborted drain; message and Uncordon reachable | 2.9, 2.10 |
| Never fall back to delete silently | 2.7, 2.8 (force is only a user decision) |
| Preview is point-in-time; copy does not promise the result | 2.4 snapshot line, "may be blocked" |
| P2 non-destructive style, Restart states consequence | 3.1, 3.3 |
| Pause copy: rollouts stop until resumed, scaling still works | 3.3 |
| Trigger copy: Job now, outside schedule | 3.3 |
| P1 empty-state copy | 4.3 |
| P5 copy per state, does not over-promise | 5.2 |
| Esc cancels before start; during progress Esc does not cancel silently | 2.6, CONFIRM-ANATOMY 2.5 |
| Live-region progress counts | 2.12 |
| Semantic colour roles | 2.6 table, section 7 |
| Failed preview is informational, not called "fail open" | 2.5 (term not used; "informational" framing) |
| Every ConfirmModal carries contextLabel / contextColor | C1; every dialog in this file has the badge |
| ConfirmModal is the single choke point | All dialogs here are CONFIRM-ANATOMY dialogs |
| No node shell, no AI wording | None present |
| Error messages: plain-string Tauri rejects handled | COPY-RULES 9.3 used for every `{message}` |
| No new state library; no command signatures | None invented; data needs in section 9 |

---

## 9. Open questions for tech lead

### Data needs (plain words)

| # | Need |
|---|---|
| Q1 | Whether the user can drain and cordon: a permission hint for "update nodes" and "create pod evictions". Fail open as elsewhere. |
| Q2 | Progress transport for a running drain. Design needs per-pod outcomes as they happen (evicting, evicted, blocked with PDB name and allowed disruptions, failed with reason). If the drain is a single call that returns only at the end, the UI falls back to indeterminate progress and a final result. Which is it? |
| Q3 | Retry policy on 429. **Recommendation: single pass, manual "Retry blocked pods".** If the backend auto-retries with backoff, tell the UI the interval so rows can read "Retrying in {s}". |
| Q4 | Is force-delete in scope for v1.2.1? **Recommendation: ship report-and-stop first** (deferred variant text in 2.7) unless the delete-with-bypass command is already planned; it is the highest-risk path and can ride in v1.3 with the typed-confirm machinery already designed here. If deferred, nothing else in the design changes. |
| Q5 | Preview data: for the node, the list of pods with owner (kind and name), whether each is a DaemonSet pod, a static/mirror pod, or has no controller, plus matching PDB name and current allowed disruptions for each evictable pod. Must be computable with no side effects. **Recommendation: require typed confirm of the node name when any pod has no controller, or when the preview is unavailable.** |
| Q6 | Whether the app can warn on quit while a drain is running, or at least whether a drain survives the window closing. |
| Q7 | Name of the Job created by Trigger, for the success line. |
| Q8 | Whether ArgoCD accepts a rollback while auto-sync is on, and whether the app can read the auto-sync setting from the Application. Also: for each History entry, whether the entry's source can be compared with the current source (for the P5 state A warning). |
| Q9 | Behaviour when preview fails: **Recommendation: allow the drain with "Drain without preview"**, because the backend enforces PDBs. This is only true if the P0 backend change (no delete fallback, real counts) ships in the same release. If it does not, the drain must be blocked when the preview is unavailable. |

### Decisions for the user (with recommendation)

| # | Decision | Recommendation |
|---|---|---|
| D1-1 | Typed confirm for a plain drain? | No, except when unmanaged pods exist or the preview failed. Data loss is the trigger, not "it's a drain". |
| D1-2 | Single pass then stop vs automatic wait-and-retry | Single pass then stop (Q3). |
| D1-3 | Force-delete in v1.2.1 or v1.3 | v1.3 (Q4); v1.2.1 is report-and-stop with a pointer to pod delete. |
| D1-4 | Rename ArgoCD "Rollback" to "Sync to this revision" until the engine fix ships | Yes; honest naming is cheaper than a wrong promise. |
