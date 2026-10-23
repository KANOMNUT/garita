# UX 00: Shared contracts

Status: wave 1 draft, for tech lead review before wave 2 starts.
Baseline: Watchtower v1.2.0. Source brief: `docs/ux-task-briefs.md`. If this file and `CLAUDE.md` disagree, `CLAUDE.md` wins; raise it as an open question.

This file is the contract between the parallel UX instances in waves 2 and 3. Every shared pattern has a **name in capitals** (for example `CONFIRM-ANATOMY`). Later specs cite the name instead of redrawing the pattern. If a later spec needs a variant, it adds it to its own file and says "extends CONFIRM-ANATOMY", it does not fork it.

Design only. No code, no Tauri command signatures, no Tailwind class strings, no hex values. Data needs go to open questions.

## Contents

1. Findings from the current UI that shape these contracts
2. CONFIRM-ANATOMY
3. DIFF-ROW
4. STATE-VOCAB (the #15 set)
5. DISABLE-PRECEDENCE
6. TOKEN-ROLES
7. IA changes: Settings shell, Diagnostics, new nav entries
8. KEYMAP
9. COPY-RULES
10. A11Y-BASELINE
11. Open questions (tech lead, and decisions needed from the user)

---

## 1. Findings from the current UI

Read from the code on 2026-10-03. These are facts the contracts below react to.

| # | Finding | Where | Consequence |
|---|---|---|---|
| F1 | `ConfirmModal` is a fixed narrow dialog (`max-w-sm`) with a plain-string description, no body slot, no error slot, no dialog semantics, no focus trap and no Esc handling of its own. Backdrop click cancels. | `ConfirmModal.tsx` | Cannot hold a preview, a diff, a progress list or an inline error. First thing to extend (CONFIRM-ANATOMY). |
| F2 | The app-level key handler closes the detail panel, the palette, the creator and the switcher on **any** Esc, whether or not a modal is open. | `App.tsx` ~line 191 | A drain modal rendered inside the node panel is unmounted when Esc closes the panel. Esc must be layered (KEYMAP rule K3). Likely also: Esc pressed inside the shell terminal closes the panel. Verify. |
| F3 | The `r` refresh shortcut skips only `INPUT` elements. | `App.tsx` ~line 200 | Typing `r` in a `textarea` (YAML editor, xterm's hidden input) probably triggers a refresh. Verify. KEYMAP rule K2. |
| F4 | The drain confirm says "evict all non-DaemonSet pods" and the result is one line of text in `actionResult`. There is no preview and no progress. | `ResourceDetailPanel.tsx` `NodeOverview`, ~lines 366-500 | See `01-safety-patch.md`. |
| F5 | Restart, Pause/Resume and Trigger Now fire on one click. Scale-to-zero and rollback already confirm. Buttons do not signal that they open a dialog. | `WorkloadActions.tsx` | See `01-safety-patch.md`. |
| F6 | `ClusterBadge` is the only identity surface inside dialogs. PodTable has its own bulk dialog that reuses the badge but not the modal. | `ConfirmModal.tsx`, `PodTable.tsx` | PodTable bulk dialog must adopt or mirror CONFIRM-ANATOMY. |
| F7 | Colours are dark-only hex tokens in `tailwind.config.js`. `edge` and `edge2` are white-alpha. `ConfirmModal` uses raw `gray-*` utilities that are not tokens. | `tailwind.config.js`, `ConfirmModal.tsx` | TOKEN-ROLES mapping table (section 6). |
| F8 | Identity colours are stored as token **names** (`accent`, `ok`, `warn`, `orange`, `bad`, `purple`). `accent` is both an identity choice and the default hash result. | `clusterIdentity.ts` | An accent picker (#41) would recolour clusters. Decoupling rule in section 6. |
| F9 | `setClusterIdentity` writes only `color` and `label`. | `clusterIdentity.ts` | Adding read-only and guardrails (#29) to the same record needs the writer to preserve fields it does not own. Tech lead must confirm (open question Q4). |
| F10 | There is no Settings surface. The Sidebar is 280 px wide with a context chip button at the top that opens the ContextSwitcher. | `Sidebar.tsx` | Settings shell design in section 7. |
| F11 | Events empty state is a bare "No events found". | `ResourceDetailPanel.tsx` `EventsTabContent` | See P1 in `01-safety-patch.md`. |

---

## 2. CONFIRM-ANATOMY

Every write goes through one modal. This contract defines what it can contain. It does not define code; the frontend engineer decides the API.

### 2.1 Sizes

| Size | Width at full window | Use | Body scroll |
|---|---|---|---|
| `sm` | about 384 px (today's size) | One-line consequence, optional typed confirm. Restart, Pause, Resume, Trigger, delete of a single object. | None |
| `md` | about 512 px | Consequence plus a short list or a single picker (propagation, force-delete list). | Body scrolls above 50% of window height |
| `lg` | about 672 px | Preview lists, progress, diffs. Drain, YAML dry-run diff, Helm upgrade preview. | Body scrolls above 60% of window height; header and footer stay pinned |

Below 560 px window width every size collapses to full width minus a 16 px gutter. Dialogs never exceed 90% of window height.

### 2.2 Slot order

Top to bottom. A slot that has no content is not rendered and leaves no gap.

```
┌────────────────────────────────────────────────────┐
│ 1  Identity badge        (always, see rule C1)     │
│ 2  Title row             icon + title              │
│ 3  Consequence summary   1 to 3 lines, plain text  │
│ 4  Body                  preview list / diff /     │
│                          picker / progress         │
│ 5  Status line           inline error or result    │
│ 6  kubectl-equivalent    collapsed disclosure (#28)│
│ 7  Guardrail notice      read-only / bulk limit    │
│ 8  Typed confirm         only when required        │
│ 9  Footer                Cancel left of primary    │
└────────────────────────────────────────────────────┘
```

Notes on the order, because it is a deliberate departure from the brief's list:

- **Status line is slot 5** (new). Today a failed action is shown outside the modal or not at all. An error must appear where the user is looking, next to the button they just pressed, and the modal stays open so they can retry.
- **kubectl-equivalent (6) is below the body** so that the user reads the consequence first and the command second. It is collapsed by default and holds a copy button. Reserved from v1.2.1, first rendered in v1.3 (#28).
- **Guardrail notice (7) is above the typed confirm** so that the reason typing is required appears before the field.

### 2.3 Rules

| ID | Rule |
|---|---|
| C1 | Slot 1 is mandatory on every write confirm. The badge shows the cluster identity label and colour. A call site without it is a regression of the prod-accident guard (CLAUDE.md, Confirm-on-Destructive). |
| C2 | **Destructive** style: title icon uses the warning role, primary button uses the bad role (outlined tint, as today). **Non-destructive** style: title icon is an info glyph (not a warning triangle) using the accent role, primary button uses the accent role. A non-destructive action must never show a warning triangle; that is how users learn to ignore the triangle. |
| C3 | Primary button label is a verb plus object where space allows: "Drain node", "Restart deployment", "Create Job". Never "OK", "Yes", "Confirm" on new dialogs. (The default "Confirm" in today's component is kept only as a fallback.) |
| C4 | Cancel is always present, always left of the primary, always the label "Cancel" in the pre-run phase and "Close" after a result. |
| C5 | Initial focus: destructive without typed confirm lands on **Cancel**. Typed confirm lands on the input. Non-destructive lands on the primary button. Enter activates only the focused control. **Amended v1.3 (PREVIEW-GATE override, 03 §14.2):** a PREVIEW-GATE dialog (#9, #10, #37) is read before it is confirmed, so its initial focus is **Back to editor / Cancel**, whatever its destructive/non-destructive styling. Initial focus is therefore chosen independently of the `destructive` style. |
| C6 | `requireTyping` (existing) stays the high-risk gate. The typed string is shown as placeholder text and in the label: "Type <value> to confirm". Match is exact and case-sensitive. The typed value is cleared whenever the dialog reopens. |
| C7 | Dialogs expose dialog semantics (A11Y-BASELINE section 10.2). |

### 2.4 Phases

A dialog may move through phases without closing. Phases are how a drain goes from preview to result in one place.

| Phase | Body shows | Footer |
|---|---|---|
| `review` | Preview, diff, picker | Cancel, primary |
| `running` | Progress (determinate when the total is known, indeterminate with elapsed time otherwise) | A single "Stop" button, or none if the action cannot be stopped (then say so in the summary: "This cannot be stopped once started.") |
| `attention` | A paused outcome that needs a decision (for example PDB-blocked pods) | Decision buttons, Close |
| `result` | Honest outcome summary | Follow-up actions, Close |
| `error` | Status line with the failure | Retry (when safe), Close |

Phase changes are announced (A11Y-BASELINE 10.4). A phase change never resets scroll position of a list the user was reading.

### 2.5 Pending, Esc and backdrop

| Situation | Esc | Backdrop click | Cancel button |
|---|---|---|---|
| `review`, nothing typed | Closes | Closes (only for `sm` with no typed confirm) | Closes |
| `review`, typed text present or `md`/`lg` size | Closes (typed text discarded) | **Does nothing**. Accidental backdrop clicks lose reading position and typed text. | Closes |
| Single request pending (`sm` Restart, etc.) | Does nothing (button shows spinner) | Does nothing | Disabled (as today) |
| `running` with a Stop button | **Does not close and does not stop.** Moves focus to Stop and sets the status line to "Press Stop to stop. Esc doesn't cancel a running action." | Does nothing | n/a (Stop is the control) |
| `attention`, `result`, `error` | Closes, after which the outcome stays visible as a persistent card where the spec defines one | Does nothing | "Close" closes |

A nested dialog (for example force-delete over a drain) takes Esc first; the dialog below becomes inert and is visually dimmed. Esc closes only the topmost dialog (KEYMAP K3).

### 2.6 PodTable bulk dialog

It adopts the same slot order, sizes, C1 to C7 and the Esc/backdrop table. Today it is a separate component; the contract is on behaviour, not on reuse. Bulk dialogs additionally show a count line in slot 3 ("Delete 14 pods in namespace shop"), and the guardrail notice slot carries the max-bulk-size refusal (UX-03).

### 2.7 Wireframe: slot anatomy at `md`

```
512 px dialog
┌───────────────────────────────────────────────────┐
│ ● prod-eu-1                                       │  slot 1
│ ⓘ Restart deployment                              │  slot 2
│ Replaces every pod of "api" with a new one,       │  slot 3
│ rolling. Pods keep serving until replacements     │
│ are ready.                                        │
│ ┌───────────────────────────────────────────────┐ │
│ │ (body: list / diff / picker)                  │ │  slot 4
│ └───────────────────────────────────────────────┘ │
│ ✕ Couldn't restart "api": forbidden. Check ...    │  slot 5
│ ▸ kubectl equivalent                              │  slot 6
│ Read-only guardrail is off for this context.      │  slot 7
│ Type api to confirm  [______________]             │  slot 8
│                         [Cancel] [Restart]        │  slot 9
└───────────────────────────────────────────────────┘
```

---

## 3. DIFF-ROW

One component shape for #8 resource diff, #9 rollout diff, #10 YAML dry-run diff, #37 Helm upgrade preview, and the existing Merge-from-file preview (`mergePreview.ts`). Arrays are leaf values everywhere (CLAUDE.md, Merge from File).

### 3.1 Row states

| State | Glyph | Text label (for screen readers and for users who cannot see colour) | Meaning |
|---|---|---|---|
| Added | `+` | "added" | Key exists only on the new side |
| Removed | `−` (U+2212) | "removed" | Key exists only on the old side. In merge-from-file the key is *not removed* by a merge patch, so that view must not use this state; see 3.5. |
| Changed | `~` | "changed" | Scalar present on both sides, different value |
| Replaced | `⇄` | "replaced" | Array (or other leaf) swapped wholesale. Never expanded into per-element rows. |
| Unchanged | none | "unchanged" | Only shown in expanded context |
| Dropped by schema | `−` plus a callout | "dropped by schema" | #10 only: a field Watchtower's pinned schema does not know, so the typed replace would drop it |

State is encoded by **glyph + text label + role colour**. Colour alone never carries meaning (A11Y-BASELINE).

### 3.2 Row anatomy

```
Full width (modal body at lg, 672 px)
┌────────────────────────────────────────────────────────────┐
│ +  spec.template.metadata.labels.tier        web           │ added
│ ~  spec.replicas                       3  →  5             │ changed
│ ⇄  spec.template.spec.containers   array, 2 items → 3 items│ replaced
│ −  metadata.annotations.owner           platform-team      │ removed
│ ⋯  12 unchanged fields                            [Show]   │ collapsed context
└────────────────────────────────────────────────────────────┘

Narrow (480 px detail panel): value pair stacks
┌──────────────────────────────────────────┐
│ ~  spec.replicas                         │
│      3                                   │
│    → 5                                   │
└──────────────────────────────────────────┘
```

- Path is monospace, dot-separated, full path always visible (wrap, never truncate the path). Array indexes appear in brackets.
- Glyph column is fixed width, left, and is the first element in reading order.
- Value text is monospace.

### 3.3 Collapsed context

Unchanged fields collapse to a single row "N unchanged fields" with a Show button. The control toggles per group (per parent object), not globally. Default: collapsed. A diff with zero changed rows shows the empty state in 3.6 and no collapsed rows.

### 3.4 Long values and masking

| Case | Behaviour |
|---|---|
| Value over 120 characters or multi-line | Truncate to the first 120 characters with "…" and a "Show full value" toggle on that row. Expanded value scrolls horizontally inside the row, not the page. |
| Array / replaced | One line: type and item count on both sides ("array, 2 items → 3 items"). A "View both" toggle shows the two arrays as plain text blocks side by side (stacked at narrow width), never as element-wise rows. |
| Secret `data` / `stringData` values (and Helm credential-like keys) | Value is masked as `••••••••` plus byte count ("12 bytes"). State (added / removed / changed) still shows, so the user sees *that* a key changed, not what it contains. Unmasking only happens for an object the user has explicitly revealed (UX-04 #33 owns reveal). |
| Binary / non-UTF-8 | "binary, N bytes" |
| Path length | Wraps. Never truncated. |

**Amended v1.3 (D3-1, adopted): "Inside this array" reading aid.** This keeps to the arrays-are-leaf rule.
- The `⇄ replaced` row itself is unchanged: glyph, word, item counts and "View both".
- "View both" gains a panel above the two text blocks, **"Inside this array"**. It appears only when every element of both sides is an object with a unique `name` (containers, env, ports, volumes, volumeMounts, imagePullSecrets).
- Rows inside the panel use `+`, `−` and `~`, keyed by `name`. For example: `~ [api] image   v2.3.1 → v2.2.0`.
- The panel always carries the fixed header **"For reading only. Watchtower writes the whole array."** No row may imply an element-wise merge.
- Default state: **expanded** in #8 and #9 (read-only comparisons) and **collapsed** in #10 and #37 (write previews).
- Arrays without unique names get no panel.
- **Merge from file never shows it** (3.5 is unchanged).

### 3.5 Merge-from-file exception

A merge patch never removes keys that are absent from the file. That view therefore never renders a `−` row from absence, only `+`, `~`, `⇄`. Its header stays "These keys will be set:". This is why `−` is defined as "removed" for the other four consumers and not for this one. Do not add a "removed" state to Merge from file.

### 3.6 Diff-level states

| State | Copy |
|---|---|
| Loading | Skeleton of 5 rows. Status: "Comparing…" |
| No differences | "No differences." Secondary line: "These two objects match after ignoring status and managed fields." (consumer may replace the secondary line) |
| Server rejected the dry run | Status line (CONFIRM-ANATOMY slot 5): "The API server rejected this change: <server message verbatim>". Below it, one plain-language line from the consumer spec. |
| Too many rows | Show the first 200 rows, then "N more changes. Narrow the comparison to see them." |

---

## 4. STATE-VOCAB (the #15 set)

Every list view, panel tab or card that can come back empty uses **these terms and this copy skeleton**. The taxonomy is *not installed*, *no access*, *nothing here*, with *partially visible*, *unreachable* and *error* as the surrounding states. "Not looked at" is not a state and is never shown to users.

### 4.1 The states

| State | Meaning | Icon (with text, never icon only) | Primary copy skeleton | Action |
|---|---|---|---|---|
| Loading | Query in flight, no data yet | Spinner / skeleton rows | "Loading <things>…" | None |
| Nothing here | Query succeeded, genuinely zero rows | Neutral outline circle | "No <things> in <scope>." | Context-specific, optional |
| Not installed | The CRD or API group is absent | Package-with-slash | "<Thing> isn't installed on this cluster." + "The <CRD name> custom resource isn't available." | Link to docs only if a stable public URL exists; otherwise none |
| No access | RBAC denied for every namespace asked | Shield-with-slash | "You don't have access to <things> <in scope>." + "Your account can't list <resource>. Ask a cluster admin for the `list` permission." | "Try another namespace" when namespace-scoped |
| Partially visible | Some namespaces forbidden, others returned | Info circle in the warn role | "Showing <things> from N of M namespaces." + "You don't have access to the other K." | "Show which" (expands a list of forbidden namespaces) |
| Unreachable | Cluster trust state is not `ok` (unreachable, auth) | Cloud-with-slash | "Can't reach <cluster label>." + the trust-state message already shown in the banner | "Retry". Do not repeat the banner's long text; link to it. |
| Error | Anything else | Error circle in the bad role | "Couldn't load <things>." + message (see COPY-RULES for the plain-string handling) | "Retry" |

Evaluation order when several apply (first match wins): **Unreachable, No access, Not installed, Error, Partially visible, Nothing here**. A view with partial data and a non-fatal error still shows its rows with the Partially visible strip above them.

### 4.2 Placement

| Surface | Where the state renders |
|---|---|
| Full list view (`GenericResourceTable`) | Centered block replacing the table body, header row kept |
| Detail panel tab | Centered block inside the tab, no card chrome |
| Card in a dashboard | Inside the card, one line plus icon |
| Partially visible | A strip directly above the table, never replacing it |

### 4.3 Namespace = "all" is not a data state

With namespace "all" the list query still runs. Only the SSAR permission **hint** is skipped (CLAUDE.md, Permission Gating). So:

- It never produces a "No access" or "Not looked at" state.
- It belongs to DISABLE-PRECEDENCE (a hint that is unavailable, so the control stays enabled).
- A tooltip on an enabled control never mentions "all".

### 4.4 Copy examples

| View | State | Text |
|---|---|---|
| Certificates (cert-manager) | Not installed | "cert-manager isn't installed on this cluster. The Certificate custom resource isn't available." |
| Gateways | No access | "You don't have access to Gateways in namespace shop. Your account can't list gateways. Ask a cluster admin for the list permission." |
| Pods | Partially visible | "Showing pods from 6 of 9 namespaces. You don't have access to the other 3." |
| VolumeSnapshots | Nothing here | "No volume snapshots in namespace shop." |

---

## 5. DISABLE-PRECEDENCE

When more than one reason disables a control, show **one primary reason**. Everything else stays hidden until the primary clears.

### 5.1 Order (confirmed with one clarification)

1. **In progress.** A request for this very control is running. Tooltip: none; the control shows its own spinner or label ("Restarting…").
2. **Read-only mode** (#29). Actionable by the user. Tooltip: "Read-only mode (Watchtower guardrail). Turn off in cluster settings."
3. **RBAC denied.** Explicit `allowed: false` only. Tooltip uses the existing `NO_PERMISSION_*` strings.
4. **Server capability missing** (for example `pods/resize`). Tooltip: "This cluster's API server doesn't support <capability>."

Clarification added: **a fifth condition, "hint unavailable" (namespace "all", query error, no data yet), is not a reason. It leaves the control enabled** (fail open). It is listed here so no spec invents a disabled state for it.

### 5.2 Why this order

| Position | Reason |
|---|---|
| In progress first | It is transient and local. Showing "turn off read-only" over a spinner is noise. |
| Read-only before RBAC | The user can change it in one click. An RBAC denial cannot be changed by the user, so surfacing it first would hide the thing they can fix. If they turn read-only off and then hit RBAC, they learn about it next, which is accurate. |
| RBAC before capability | RBAC is about the person, capability is about the cluster. Both are not user-fixable, but RBAC is far more common and has a defined remedy (ask an admin). |

### 5.3 Rules

| ID | Rule |
|---|---|
| D1 | Disabled controls remain visible and focusable. Use `aria-disabled` with the reason as the accessible description, so keyboard and screen-reader users can reach the explanation; a natively disabled button cannot be focused. |
| D2 | A disabled control's tooltip appears on hover and on keyboard focus. |
| D3 | The reason text is a full sentence ending in a period; the action part ("Turn off in cluster settings") is last. |
| D4 | The explanation never claims security: "Read-only mode" is a guardrail, never "protected", "secured", "locked". |

### 5.4 Read-only and the delete column (needs user decision)

**Recommendation: read-only disables, it does not hide.** Keep the delete column visible; each delete control is disabled with the read-only reason.

- Rationale: the user set read-only and can undo it. A vanished column reads as a bug or a missing permission. RBAC-deny hiding (the existing `onDelete` exception) stays as is, because the user cannot change it.
- Cost: on a long table, 200 identical disabled icons are visual noise. Mitigation: disabled icons use the dimmed text role (not a full colour), and the table gets one line above its header: "Read-only mode. Writes are disabled for this context." with a "Turn off" link. This strip is the single place the full explanation lives; per-row tooltips are short ("Read-only mode.").
- If both read-only and RBAC deny delete apply, the RBAC rule hides the column (RBAC wins on *presence*; read-only wins on *tooltip text* when the column is visible). Spell this out once so UX-03 does not re-derive it.

**Marked: needs user decision** (D-1 in section 11).

**Amended v1.3 (F3-9, from 03 §11.3; D-1 adopted as "disable").** `GenericResourceTable`'s row delete button is `opacity-0` until the row is hovered, so a disabled delete icon is just as invisible. The strip above the table is therefore the **only** persistent read-only signal on a list view. The "200 identical disabled icons" cost above does not arise. The disabled icon must also appear on keyboard focus (`focus-visible`), with the short tooltip "Read-only mode."

---

## 6. TOKEN-ROLES

Roles, not values. UX-05 assigns light and dark values. Every wireframe in later specs names a role from this table. No new hex.

### 6.1 Role table

| Group | Role | Used for | Today's token |
|---|---|---|---|
| Surface | `surface-base` | App background | `base` |
| Surface | `surface-panel` | Sidebar, detail panel | `panel` |
| Surface | `surface-card` | Cards, table rows hover, inputs inside panels | `card` |
| Surface | `surface-overlay` | Modals, popovers, palette | none (ConfirmModal uses raw gray-800) |
| Surface | `surface-input` | Text inputs inside overlays | none (raw gray-900) |
| Surface | `surface-tint` | Subtle chip backgrounds, badge fill | raw `white/[0.03]` |
| Surface | `scrim` | Behind modals | raw `black/60` |
| Border | `edge` | Hairlines, table row separators | `edge` |
| Border | `edge-strong` | Input borders, modal ring, focus-adjacent | `edge2` (and raw gray-700) |
| Text | `ink` | Primary text | `ink` |
| Text | `mute` | Secondary text | `mute` |
| Text | `dim` | Tertiary text, disabled glyphs | `dim` |
| Status | `status-ok` | Healthy, evicted, succeeded | `ok` |
| Status | `status-warn` | Degraded-soft, blocked, pending attention | `warn` |
| Status | `status-bad` | Failed, destructive | `bad` |
| Status | `status-info` | Informational | `info` |
| Status | `status-progress` | In progress, progressing | `accent` / `info` today; separate role so it can differ from the accent |
| Accent | `accent` | UI accent: primary buttons (non-destructive), links, focus ring base, selected tab. **User-pickable under #41.** | `accent` |
| Identity | `identity-blue`, `identity-green`, `identity-yellow`, `identity-orange`, `identity-red`, `identity-purple` | Cluster identity only | `accent`, `ok`, `warn`, `orange`, `bad`, `purple` |
| Identity | `identity-demo` | Reserved for demo mode (#45). Not selectable. | none |
| Special | `banner-impersonation` | Fixed style for "viewing as" (#34). Not an identity role, not themeable by accent. | none |
| Diff | `diff-add`, `diff-remove`, `diff-change` | Row tint and glyph colour | none (ad hoc green/red today) |
| Log | `log-error`, `log-warn`, `log-info`, `log-debug`, `log-fatal` | Level text | ad hoc |
| Focus | `focus-ring` | 2 px ring on keyboard focus | `accent/50` ring on inputs only |
| Metrics | `bar-low`, `bar-mid`, `bar-high` | Capacity and usage bars (thresholds 65% and 85%, per DualZoneBar) | inline hex in NodeStrip |
| Surface | `surface-sunken` | Log pane and terminal backgrounds (amended v1.3, Q-L14) | hard-coded near-black today |
| Log | `log-match` | Include-filter match tint (amended v1.3, Q-L14) | none |
| Log | `log-highlight` | Highlight mark tint, always paired with an underline (amended v1.3, Q-L14). The mark tints keep 3:1 against the pane and 4.5:1 for the text over them. | none |
| Series | `series-1` … `series-6` | Secondary hue cue for multi-pod log tags (amended v1.3, Q-L14). Kept separate from `identity-*`: a pod tag must never read as a cluster identity. | none (hash over identity tokens today) |

### 6.2 Identity decoupling (satisfies the #41 constraint)

The problem: identity colours are saved by token name and `accent` is one of the six. An accent picker would recolour clusters.

Contract:

1. Identity uses its own role set (`identity-*`). Those roles do **not** read the `accent` role. The UI accent can change without any identity chip changing.
2. **Stored names keep working without a data migration.** The six legacy stored names map one-to-one to identity roles by an alias table applied when reading: `accent` to `identity-blue`, `ok` to `identity-green`, `warn` to `identity-yellow`, `orange` to `identity-orange`, `bad` to `identity-red`, `purple` to `identity-purple`. New writes may use either spelling; the reader accepts both. This answers UX-05's migration question as a design recommendation; the tech lead confirms (Q5).
3. Default accent value equals today's blue. `identity-blue` default value equals today's accent blue. So nothing visibly changes on upgrade.
4. Identity colours are always paired with text (the label). A chip is never a colour dot alone.
5. In dark and light themes each identity role must (a) be distinguishable from the other five at chip size, (b) reach 4.5:1 as chip text on the chip fill. UX-05 verifies; `identity-yellow` on a light surface is the known risk and may need a darker light-theme value than its dark-theme value.
6. Identity red and status `status-bad` are both red-ish. This is accepted (prod is red by user choice); disambiguation is by shape: identity is a dot plus label chip, status is an icon plus text.

### 6.3 Hard-coded colours found today, mapped to a role

| Where | Today | Role |
|---|---|---|
| `ConfirmModal` outer wrap backdrop | black at 60% | `scrim` |
| `ConfirmModal` card background | gray-800 at 95% | `surface-overlay` |
| `ConfirmModal` card ring | gray-700 | `edge-strong` |
| `ConfirmModal` input background | gray-900 at 80% | `surface-input` |
| `ClusterBadge` fill | white at 3% | `surface-tint` |
| `NodeStrip` cpu/mem colour functions (inline hex) | green / amber / red by threshold | `bar-low`, `bar-mid`, `bar-high` |
| TopBar green context dot glow (rgba) | green glow | `status-ok` at reduced alpha |
| `ResourceDetailPanel` rgba literals | various | nearest `status-*` / `surface-*` role; UX-05 lists each |
| Hex literals in about 10 components (ClusterOverview, DetailPanel, LogViewer, MultiLogViewer, NodeStrip, PodTable, ResourceDetailPanel, ResourceViews, ShellTerminal, Sparkline) | mixed | UX-05 audits each site and assigns a role. 00 only fixes the role list; the per-site mapping is UX-05's deliverable. |
| xterm palette | fixed dark palette | Terminal-specific role set, UX-05 |

### 6.4 Rule

Wireframes and copy say "status-warn", never "yellow". Prose may say "amber" only in this file's tables when quoting today's value.

---

## 7. IA changes

### 7.1 Settings shell

**Entry points**

- A gear button in a new **Sidebar footer**, always visible, below the scrolling nav and above the window edge. It sits to the right of the app version text or on its own row.
- Keyboard: `⌘,` (macOS) and `Ctrl+,` (Windows, Linux). This follows platform convention on macOS and is widely used on others.
- Command palette: entry "Settings" in a new "App" group.

**Surface:** a **view in the main content area**, not a modal. Settings will hold six sections over time; a modal would cap them. It is not a resource, so it is not a `ResourceType`; it is app state alongside the active view. (Tech lead decides how; the contract is the user-facing behaviour.) Esc does not leave Settings (a view, not a layer). The Sidebar nav highlights the gear.

Selecting any resource in the Sidebar leaves Settings.

**Structure**

```
Full window, Settings active
┌─ Sidebar ────┐ ┌─ Settings ─────────────────────────────────────────┐
│ (nav)        │ │ Settings                                           │
│              │ │ ┌─────────────┐ ┌────────────────────────────────┐ │
│              │ │ │ Diagnostics │ │ Diagnostics                    │ │
│              │ │ │             │ │ ...section content...          │ │
│              │ │ │             │ │                                │ │
│ ⚙ Settings   │ │ └─────────────┘ └────────────────────────────────┘ │
└──────────────┘ └────────────────────────────────────────────────────┘
```

Section list (left, 160 px, vertical):

| Section | Ships | Owner |
|---|---|---|
| Diagnostics | v1.3 (#46) | 00 |
| Appearance | v1.4 (#41) | UX-05 |
| Keyboard | backlog (#42) | UX-05 |
| Updates | v1.5 (#51) | UX-05 |
| Command-line tool | v1.5 (#55) | UX-05 |

**v1.3 ships Settings with Diagnostics only.** The section list still renders, with one item, so the shell does not change shape when sections arrive. Sections that have not shipped are **absent**, not disabled or "coming soon".

**Narrow window:** below 720 px content width the section list becomes a select control above the content.

**Not in Settings:** per-context settings (colour, label, read-only, guardrails, #16 endpoints) stay in the ContextSwitcher `IdentityEditor`. Reason: they belong to a cluster, and the cluster picker is where users look. Settings carries an explanatory link: "Per-cluster settings (colour, label, read-only) live in the cluster switcher." that opens it.

### 7.2 Diagnostics section (#46)

Purpose: help the user (or a colleague) find out what the app did. Local only.

```
Content area, 640 px
┌────────────────────────────────────────────────────────────┐
│ Diagnostics                                                │
│                                                            │
│ Log level                                                  │
│ [ Info                ▾ ]                                  │
│ Controls how much detail Watchtower writes to its log      │
│ file. Use Debug when reproducing a problem.                │
│                                                            │
│ Log file                                                   │
│ ~/Library/Logs/Watchtower/watchtower.log        [Copy path]│
│ [ Open log folder ]                                        │
│                                                            │
│ ⓘ Logs stay on this machine. Tokens and credentials are   │
│   scrubbed before anything is written. Watchtower never    │
│   uploads logs.                                            │
└────────────────────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Log level control | A select with the levels the backend supports (data need). Default shown: the current level. Changes apply immediately if the backend supports it; otherwise a line appears: "Takes effect after you restart Watchtower." (open question Q6) |
| Debug / Trace warning | Selecting Debug or Trace shows an inline note under the control: "Debug logs are larger and may include request URLs. Switch back to Info when done." |
| Log file path | Read-only text, platform path supplied by the app, with a Copy button. Path is shown so users on locked-down machines can find it without the button. |
| Open log folder | Opens the folder in the OS file manager. If it fails: "Couldn't open the folder. The log file is at <path>." |
| Privacy note | Always visible, not a tooltip. No "Send logs", "Upload" or "Report a problem" control (crash reporting and analytics are rejected). |
| Terminology | This section is called **Diagnostics**. The cluster health view (#11) is called **Problems**. The two words are never swapped. |

States for Diagnostics:

| State | Behaviour |
|---|---|
| Loading | Controls skeleton for under one second; no spinner text |
| Log folder missing / not yet created | Open button disabled with reason "No log file has been written yet." |
| Error reading current level | Select shows "Unknown", note "Couldn't read the current log level. Changing it will still apply." |
| Denied / read-only / unreachable / CRD-absent / partial | n/a: app-local, no cluster involved |

### 7.3 New nav entries

Current Sidebar sections: Workloads, Networking, Config & Storage, Access Control, Cluster, Custom Resources, Helm, GitOps. The command palette `NAV_ITEMS` mirrors them.

Decision: add one new Sidebar section **Health**, placed **first** (above Workloads), plus a small **App** group in the footer. Reason: Problems is the answer to "what is broken", which is the first question on opening a cluster; placing it first makes it the landing alternative to Cluster Overview.

| Entry | Sidebar location | Palette group | Ships | Spec |
|---|---|---|---|---|
| Problems | Health | Health | v1.4 | UX-04 |
| Node capacity | Health | Health | v1.4 | UX-04 |
| Possibly unused | Health | Health | v1.4 | UX-04 |
| Deprecated APIs | Health | Health | v1.4 | UX-04 |
| Who can… (RBAC) | Access Control | Access Control | v1.4 | UX-04 |
| Constraints | A section in the object's Summary tab, no nav entry | none | v1.4 | UX-04 |
| Resource map | **Amended 2026-10-17 (v2.2.0, UX-06 D14):** Health page "Map" (last in Health), plus a "Map" action in workload and Service panels. Confirmed. | Health | v2.2.0 | UX-06 |
| Change timeline | **Amended 2026-10-17 (v2.2.0, UX-06 D14):** a "Timeline" tab in deploy, sts, ds, Helm and ArgoCD detail panels. No Health row and no nav entry. | none (a panel tab) | v2.2.0 | UX-06 |
| Action journal | Footer App group, label "Journal" | App | v1.4 | UX-04 |
| Settings | Footer App group, gear | App | v1.3 | 00 |
| Light theme, updater, CLI install | Inside Settings | App ("Settings: Appearance"…) | later | UX-05 |

Rules:

- Every nav entry has a ⌘K entry. A view reachable only from the sidebar is a defect.
- ⌘K entries for Settings sections are listed as "Settings: Diagnostics", "Settings: Appearance", and so on, so each section is reachable by name.
- A nav entry never shows a count badge unless that spec defines the number's meaning. (A bare badge on Problems implies a score.)
- Entries for features whose backing data is absent (for example Flux on a cluster with no Flux CRDs) still appear and show the Not installed state. Hiding would make the user wonder where the feature went.

### 7.4 Per-context settings

Stay in `ContextSwitcher`'s `IdentityEditor`. Stored in the `cluster-identity` record (read-only and guardrails are fields on the same record as colour and label). This 00 reserves the names **Read-only mode** and **Guardrails** for those controls; UX-03 designs them.

Reserved global indicators (UX-03 designs the visuals): a read-only badge on the Sidebar context chip, TopBar and ContextSwitcher rows. 00 only fixes that the badge is text ("Read-only") plus an icon, uses a neutral role (not `status-warn`, which would read as a warning), and never uses the words "locked", "protected" or "secured".

---

## 8. KEYMAP

### 8.1 Existing shortcuts (verified in `App.tsx`)

| Keys | Action | Scope |
|---|---|---|
| `⌘K` / `Ctrl+K` | Open command palette | Global |
| `⌘N` / `Ctrl+N` | New resource (creator; Helm install on the Helm view) | Global |
| `Esc` | Closes switcher, palette, creator, merge-from-file, Helm install, and clears the selected pod and resource | Global (see rule K3: to be layered) |
| `r` | Refresh the active view | Global, ignored when focus is in an `INPUT` |

### 8.2 Reserved set

These are reserved for the app. #42 (custom keybindings) and every package must not bind them to something else, and a user rebinding must be warned.

| Keys | Meaning | Status |
|---|---|---|
| `⌘K` | Palette | Existing |
| `⌘N` | New | Existing |
| `⌘,` | Settings | **New in 00** (v1.3) |
| `Esc` | Close topmost layer | Existing, layered by K3 |
| `r` | Refresh | Existing |
| `⌘↵` | Primary action of the open dialog | **New**, rule K5 |
| `/` | Focus the search box (TopBar) | **Proposed**, needs tech lead check that TopBar does not already bind it |
| `?` | Keyboard help overlay | **Proposed**, backlog (#42 section) |
| `⌘F` | Find in the current text view (logs, YAML) | **Proposed**, UX-02 and UX-03 use it inside their text views only. Amended v1.3: ships in v1.3.1 as "focus Include" in the log toolbar and "find" in diff dialogs. |
| `⌘S` | In YAML or Helm Values **edit mode only**: open the review gate (Review & save / Review upgrade). It never saves by itself. | **Amended v1.3** (03 §14.2). A modifier shortcut, so it is allowed from a textarea (K4). Ships in v1.3.1. |
| `⌥↓` / `⌥↑` | Next / previous changed row in a diff dialog | **Amended v1.3** (03 §14.2). No single-letter keys inside dialogs (K1). Ships in v1.3.1. |
| `f` | Toggle follow in the log viewer | **Amended v1.3** (02 Q-L17). Scoped to the log region with focus on a non-editable element (K1). No conflict with `r`, `/` or `?`. Ships in v1.3.0. |

OS-reserved combinations that must never be bound: `⌘Q`, `⌘W`, `⌘H`, `⌘M`, `⌘Tab`, `⌘Space` (macOS); `Alt+F4`, `Alt+Tab`, `Win+*` (Windows); `Ctrl+Alt+F*`, `Super+*` (Linux). Copy/paste/cut/select-all/undo (`⌘C V X A Z`) are never rebound.

### 8.3 Rules

| ID | Rule |
|---|---|
| K1 | A single-letter shortcut (`r`, `/`, `?`) is active only when focus is on the page body or a non-editable element and no dialog is open. |
| K2 | "Editable" means `input`, `textarea`, `select`, any `contenteditable`, and the terminal. The current check covers only `INPUT` (finding F3). |
| K3 | **Esc is layered.** The topmost layer consumes it and nothing below reacts. Layer order, top to bottom: nested dialog, dialog, popover or menu, palette, switcher, detail panel. Esc inside the terminal belongs to the terminal and does nothing at app level (finding F2). |
| K4 | Modifier shortcuts (`⌘…`) work from inside text inputs unless the input itself needs the combination. |
| K5 | `⌘↵` / `Ctrl+Enter` triggers the primary button of the open dialog **only if that button is enabled**. It never bypasses a typed confirm. Not available while a dialog is `running`. |
| K6 | Any new shortcut a package proposes must be added to the table in 8.2 in that package's open questions, with the conflict check result. The table here is updated by the tech lead, not by the later specs. |
| K7 | Windows and Linux use `Ctrl` where macOS uses `⌘`. Specs write `⌘` and mean the platform modifier. Menu hints show the platform's own glyph. |
| K8 | Shortcuts are shown in tooltips and in the palette, in the platform's own form. Copy for tooltips: "Refresh (r)". |

---

## 9. COPY-RULES

### 9.1 Tone

Terse, factual, specific, no exclamation marks, no emoji, no jokes. Users are DevOps engineers; Kubernetes terms are fine. Say what happened, why, and what to do next.

### 9.2 Structure

| Element | Pattern | Example |
|---|---|---|
| Confirm title | Verb + object, sentence case | "Drain node worker-3" |
| Confirm button | Same verb + object when the dialog is destructive | "Drain node" |
| Consequence summary | What changes, in the present or future tense, one to three lines | "Replaces every pod of "api", rolling." |
| Success | State result with real counts | "Restarted "api"." |
| Error | What failed + why (server text) + next step | "Couldn't restart "api": forbidden. Check that your account can patch deployments, or ask a cluster admin." |
| Empty | Why empty + next step | "No events for this Deployment. Kubernetes keeps events for about 1 hour." |
| Disabled | Full sentence, action last | "Read-only mode (Watchtower guardrail). Turn off in cluster settings." |

Always quote object names with straight double quotes in sentences. In monospace contexts no quotes are needed.

### 9.3 Errors from Tauri

Tauri v2 rejects `invoke()` with a plain string. Copy specs write the message slot as `<message>` and assume the frontend extracts it with the project's standard `message ?? String(error)` pattern. A spec never relies on an `Error.name` or a status code that a plain string does not carry. Server messages are shown **verbatim** and are never rewritten; the spec adds a plain-language line before or after, not instead.

### 9.4 Forbidden words and constructions

| Do not write | Why | Write |
|---|---|---|
| "Apply" for Merge from file | It is not `kubectl apply` | "Merge from file", "These keys will be set" |
| "protected", "secured", "locked" for read-only | It is a hint, not a boundary | "Read-only mode (Watchtower guardrail)" |
| "recommended value" without a qualifier | Right-sizing is a hint | "Based on current usage only" |
| "applies" for a webhook | Selectors are approximated | "may apply" |
| "unused" | Dynamic references exist | "possibly unused" |
| "smart", "AI", "auto-fix", "score", "grade" | No scoring engine, no AI | n/a |
| "Drained" when anything failed or was blocked | Over-claims | "Drain incomplete" |
| "force" in an SSA sense | SSA is not used | "Force-delete" only for the drain bypass, spelled that way |
| "Safe" | Nothing here is guaranteed | Describe the effect |

### 9.5 Qualifier glossary

Mandatory wherever the named feature appears. Wording is exact.

| Qualifier | Feature | Required text |
|---|---|---|
| point-in-time | Drain preview (#35), right-sizing (#13), diff gates (#8, #9, #10, #37; amended v1.3, 03 §16.3 item 5) | "Point-in-time snapshot" (drain), "Based on current usage only" (right-sizing), "Compared {HH:MM:SS}. The cluster can change before you confirm." (diff gates) |
| possibly unused | #20 | "possibly unused" in nav label, headers, empty state, and a line stating why it can be wrong: "Dynamic references and consumers outside the cluster aren't visible." |
| may apply | #14 webhooks | "may apply" |
| hint | #13, SSAR | "Hint" label on the element |
| approximation | #24 | "Approximation" label on the view and its legend |
| events ~1 hour | #11, #17, P1 | "Kubernetes keeps events for about 1 hour." |
| not an audit log | #17 | "This is not a full audit log." |
| from this app | #31, #17 | "Actions performed from this app on this machine" |
| read-only | #29 | "Read-only mode (Watchtower guardrail)" |

### 9.6 Dates, numbers, units

Relative time for recent ("3m ago") with the absolute time on hover. Counts are real numbers; never "a few". CPU in millicores with `m`, memory in `Mi` or `Gi`, matching the existing tables.

---

## 10. A11Y-BASELINE

WCAG 2.1 AA minimum, with these 2.2 items adopted because they matter for a dense desktop UI.

### 10.1 General

| Rule | Detail |
|---|---|
| Contrast | 4.5:1 for body text, 3:1 for large text and UI boundaries, in both themes |
| No colour alone | Every state pairs colour with a glyph and text (DIFF-ROW, severity, evicted/blocked, log levels, identity chips) |
| Target size | Interactive controls at least 24 by 24 CSS px (WCAG 2.2). Existing `h-7` buttons satisfy it |
| Focus visible | Every focusable element shows the `focus-ring` role. Today's inputs-only ring is extended to buttons, rows and tabs |
| Reduced motion | Spinners may keep rotating; pulses, row-change flashes and slide-ins stop. Existing `prefers-reduced-motion` CSS stays the reference |
| Zoom | Layouts hold at 200% zoom without horizontal scroll inside dialogs |

### 10.2 Dialog semantics

Every modal is a dialog with an accessible name (the title) and an accessible description (the consequence summary). Focus moves into the dialog on open (initial focus per C5), is trapped while open, and returns to the control that opened it on close. Content outside is inert.

### 10.3 Disabled controls

Per D1: `aria-disabled` plus a description, focusable, not natively disabled. Activating it does nothing and may re-announce the reason.

### 10.4 Live regions

| Event | Politeness |
|---|---|
| Progress counts changing | Polite, throttled: at most one announcement every 5 seconds, and immediately on a new blocked or failed item. Text is a sentence, not a number ("8 of 12 pods evicted. 2 blocked."). |
| Phase change to `attention` | Assertive |
| Phase change to `result` | Polite |
| Inline error (slot 5) | Assertive |
| State vocabulary blocks appearing | Polite |

A progress bar has `progressbar` semantics with min, max and now; indeterminate progress omits the value.

### 10.5 Lists and tables

Preview and progress lists are lists with one item per pod; each item's accessible text reads in full ("Evicted: shop/api-7d9f, from Deployment api"). Expand/collapse controls report expanded state.

### 10.6 Terminal and logs

Out of scope here; UX-02 defines virtualised-list semantics and the pod-prefix rule (name text, not colour alone).

---

## 11. Open questions

### 11.1 For the tech lead (data needs and checks)

| # | Question |
|---|---|
| Q1 | Confirm that the app-level `Esc` handler can be made layered (K3) and that `Esc` and `r` reach the terminal and text editors correctly today (findings F2, F3). Both look like defects that predate this work. |
| Q2 | Can `ConfirmModal` grow sizes, a body slot, a status slot, phases and dialog semantics without breaking its existing call sites? (All sites currently pass a string description.) |
| Q3 | Does `/` already focus the TopBar search? Is `⌘,` free on all three platforms? |
| Q4 | The `cluster-identity` writer persists only colour and label. Adding read-only and guardrail fields requires preserving unknown fields on write. Confirm. |
| Q5 | Identity alias table (section 6.2): confirm that reading old stored names without migration is acceptable, and that new writes may use the role-style names or the old ones. |
| Q6 | Diagnostics: which log levels exist, whether a level change applies live, the platform log path, and whether the folder can be opened from the app. Also the retention/rotation numbers if they are to be shown. |
| Q7 | Where does Settings live in app state (not a `ResourceType`)? UX-visible requirement: it is reachable from ⌘K and the footer gear, and Esc does not leave it. |
| Q8 | Does the `InputElement` check for `r` consider xterm's helper textarea editable? |

### 11.2 Needs user decision (recommendation given)

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| D-1 | Does read-only mode **disable** or **hide** the delete column? | **Disable**, with a one-line strip above the table. RBAC-deny keeps hiding. | The user set it and can undo it; a vanishing column looks like a bug. (Section 5.4.) **Amended v1.3 (F3-9):** the row delete is `opacity-0` until hover, so the strip is the only persistent signal. The disabled icon must also show on keyboard focus. Adopted as the default in `docs/impl/v1.3.0-tasks.md` §1.3; ships in v1.3.1. |
| D-2 | Is Settings a view or a modal? | **View** in the main content area. | It will hold six sections; a modal caps growth and traps Esc. |
| D-3 | New **Health** Sidebar section, placed first? | **Yes.** | Problems answers the first question users have on opening a cluster. |
| D-4 | Identity colour roles: keep six, rename, or add more? | Keep six, add alias names, reserve `identity-demo`. | No data migration; no relearning. |
| D-5 | `⌘↵` as dialog primary. | **Yes**, never while `running` and never past a typed confirm. | Fast confirm for keyboard users without weakening the guard. |
