# Namespace panel and Pod / ArgoCD UX review: tasks

Run: `feat/ns-panel-ux-review`, base main `4e11176`. Ledger: `.claude/checkpoints/feat-ns-panel-ux-review/ledger.md`. Written by T1 (tech-lead) on 2026-10-28. Line numbers are at the base commit; grep the names, not the numbers.

User request (2026-10-28): a senior UX review of the Pod panel and the ArgoCD panel, using the Claude design skill, and moving the namespace list from the left sidebar into the namespace panel.

Reading of the request:

- "ux-ui-pro-max" is not installed in this environment. "Claude design" is Anthropic's `frontend-design` skill, read as a file at `/mnt/skills/public/frontend-design/SKILL.md`.
- "Namespace panel" is the TopBar namespace picker (`TopBar.tsx`, `nsOpen`). There is no Namespaces resource view.
- The review produces findings only. Implementing them is a later run, unless the user asks.

## Contents

0. Summary: the minimal version and what it skips
1. Contract: the namespace move (frozen)
2. T2 brief: senior-ux-specialist (review + namespace panel spec)
3. T3 brief: frontend-engineer (namespace move)
4. T4 brief: tech-lead (review of T3)
5. Questions for the user
6. Observed, out of scope

---

## 0. Summary

Minimal version:

- The Sidebar "Namespaces" section (list, `+` create, hover delete with a typed confirm) is removed. Its three jobs move into the TopBar namespace dropdown, which becomes a `Popover` with a filter field, the list, a "New namespace…" button and a per-row delete button. The typed delete confirm moves with it, unchanged.
- One new component (`NamespacePanel.tsx`) and one pure helper file (`utils/namespaces.ts`, tested). No Rust change, no new command, no new hook.
- Keyboard comes from `Popover` (Esc closes and returns focus) and native tab order. A filter field covers long lists.
- T2 reviews the Pod and ArgoCD panels and writes the panel's visual and copy spec. T3 implements only the namespace move.

Skipped on purpose (each is a separate request if wanted):

- Arrow-key roving focus in the list. The Map kind filter set the precedent (no arrow-key handler, C-2, user-confirmed).
- Using a typed namespace name when the list is forbidden (Question Q2).
- A "Terminating" badge: `list_namespaces` returns names only; a phase needs a Rust change.
- Recent or pinned namespaces, per-namespace counts, a refresh button inside the panel (the query refetches on open when stale; the error state has Retry).
- A palette entry "Create namespace…" (see §1.9 and Q1).
- Protecting `kube-node-lease` (Q3). The protected set stays as it is today.
- Any fix from the Pod or ArgoCD review.

---

## 1. Contract: the namespace move (frozen)

T2 designs inside this contract. A T2 deviation is listed in T2's doc under "Contract deviations proposed" and is applied only after the main session records it in the ledger. Where T2's spec and this section disagree, this section wins.

### 1.1 Rust and IPC

No Rust change. No new command, no new struct, no new hook. The panel uses what exists:

| Rust command | Rust params | JS call (hook in `useResources.ts`) | JS args |
|---|---|---|---|
| `list_namespaces` (`commands/namespaces.rs`) | `context: String` | `useNamespaces(context)`, `invoke` | `{ context }` |
| `delete_namespace` (`commands/extras.rs`) | `context: String, name: String` | `useDeleteNamespace()`, `invokeWrite` | `{ context, name }` |
| `create_resource_from_yaml` | unchanged | `ResourceCreator` with `creatorKind = "ns"` (as today) | unchanged |

Gate: `git diff --stat 4e11176 -- src-tauri` is empty at the end of T3.

### 1.2 Files

| Path | Change |
|---|---|
| `src/utils/namespaces.ts` | new: pure helpers (§1.5) |
| `src/utils/namespaces.test.ts` | new: tests for §1.5 |
| `src/components/NamespacePanel.tsx` | new: `NamespacePanel` and `DeleteNamespaceConfirm` (§1.4) |
| `src/components/TopBar.tsx` | the inline dropdown is replaced by `NamespacePanel`; hosts `DeleteNamespaceConfirm` (§1.3) |
| `src/components/Sidebar.tsx` | the Namespaces section and its delete confirm are removed (§1.3) |
| `src/App.tsx` | prop wiring only (§1.3) |
| `docs/claude/ui.md`, `docs/claude/key-files.md`, `docs/claude/writes.md`, `CHANGELOG.md` | docs in the same diff (§1.11) |

### 1.3 Props removed and added

**`Sidebar.tsx`** loses these props: `ns`, `setNs`, `namespaces`, `onCreateNamespace`, `onDeleteNamespace`.
It also loses the state `nsToDelete`, `nsDeletePending`, `nsDeleteError`, `hoveredNs`, the callback `handleDeleteNs`, the const `nsReason`, the section "Namespaces", the delete `ConfirmModal`, and every import left unused by that (`Plus`, `Trash2`, `ConfirmModal`, `disabledAttrs`, `pickDisabledReason`, `deleteNamespaceEquiv`; check each with grep before removing). `identity` stays (context chip).

**`TopBar.tsx`**:
- Removed: prop `namespaces`; state `nsOpen`; ref `nsRef`; the `mousedown` outside-click effect for the namespace dropdown; the inline `["all", ...namespaces].map` dropdown.
- Added: prop `onCreateNamespace?: () => void`; state `const [nsToDelete, setNsToDelete] = useState<string | null>(null)`.
- Renders `<NamespacePanel …/>` where the dropdown was, inside the same `{!clusterScoped && …}` branch, after the `/` separator.
- Renders `<DeleteNamespaceConfirm …/>` **after `</header>`**, beside `TurnOffReadOnlyConfirm`. `ConfirmModal` has no portal, and the header's `onMouseDown` starts a window drag (`ui.md` → Window Dragging), so a dialog inside the header would start a drag on a click on its text.

**`App.tsx`**:
- `<Sidebar>` drops `ns`, `setNs`, `namespaces`, `onCreateNamespace`, `onDeleteNamespace`.
- `<TopBar>` drops `namespaces` and gains `onCreateNamespace={() => { setCreatorKind("ns"); setCreatorOpen(true); }}` (the handler moves unchanged from the Sidebar wiring).
- `const deleteNamespace = useDeleteNamespace();` and the `useDeleteNamespace` import go (the hook moves into `DeleteNamespaceConfirm`).
- `const { data: namespaces = [] } = useNamespaces(currentContext);` stays: `MapPage` uses it.

### 1.4 `NamespacePanel.tsx`

```ts
export function NamespacePanel(props: {
  context: string;
  ns: string;                          // "all" or a namespace name
  setNs: (ns: string) => void;
  onCreateNamespace?: () => void;      // absent: no "New namespace…" button
  onRequestDelete: (name: string) => void;
}): JSX.Element;

export function DeleteNamespaceConfirm(props: {
  context: string;
  name: string | null;                 // null: closed
  onClose: () => void;
  onDeleted: (name: string) => void;
}): JSX.Element;
```

`NamespacePanel` renders the trigger and a `Popover` (the shared primitive; no second popover implementation).

- **Trigger:** the current button (namespace text, mono, chevron). Add `aria-haspopup="dialog"` and `aria-expanded`. Its accessible name contains the visible text (WCAG 2.5.3), e.g. `aria-label={`Namespace: ${ns}`}`. The `Popover` gets `label="Namespaces"`.
- **Body:** a separate component, mounted only while open, that calls `useNamespaces(context)`. Mounting it on open refetches the list when it is stale (60 s), and the filter text resets on every open. Data access stays in the hook; the component never calls `invoke`.
- **Contents, top to bottom:** filter field; rows from `namespaceRows(data ?? [], ns, query)` (§1.5); the "New namespace…" button. T2 places and words them.

`DeleteNamespaceConfirm` is the Sidebar's `ConfirmModal` moved verbatim: `contextLabel`, `contextColor`, `context` from `useClusterIdentity(context)`, `kubectlEquivalent` from `deleteNamespaceEquiv`, `destructive`, `requireTyping={name}`, `requireTypingLabel`, `status` with the verbatim backend error, `isPending`. It owns `useDeleteNamespace()` and its pending and error state. The dialog stays open on error. On success it calls `onDeleted(name)` and then `onClose()`.

TopBar wiring: `onRequestDelete={setNsToDelete}`; `onClose={() => setNsToDelete(null)}`; `onDeleted={(n) => { if (n === ns) setNs("all"); }}`. The last one is new behaviour: a deleted namespace that was selected no longer scopes the lists.

### 1.5 `utils/namespaces.ts` (pure, tested)

```ts
/** Never offered for delete in the namespace panel. Same set as the Sidebar had. */
export const PROTECTED_NAMESPACES: ReadonlySet<string>; // "default", "kube-system", "kube-public"

/** False for "all" and for PROTECTED_NAMESPACES. */
export function canDeleteNamespace(name: string): boolean;

/**
 * Rows the panel lists, in order:
 * 1. "all", only while the trimmed query is empty;
 * 2. `selected`, when it is not "all" and not in `names` (set by the launcher, a list
 *    that failed, or a namespace that was just deleted), when it matches the query;
 * 3. `names` in the given order that contain the trimmed query, ignoring case.
 * No duplicates.
 */
export function namespaceRows(names: readonly string[], selected: string, query: string): string[];
```

Tests (`namespaces.test.ts`): "all" first only with an empty or whitespace query; selected-but-missing shown and filtered by the query; selected "all" not duplicated; selected present in `names` not duplicated; case-insensitive trimmed match; empty `names`; `canDeleteNamespace` false for the three protected names and "all", true otherwise.

### 1.6 Behaviour

- **Select:** a row click calls `setNs(name)` and closes the panel. Enter in the filter field picks the first row when the query is not empty.
- **Focus rule (one rule for every close from inside the panel):** focus the trigger first, then close the panel, then open any dialog. Reason: `ConfirmModal` records `document.activeElement` as its opener when it opens and returns focus there; the clicked row unmounts with the panel, and on WebKit a click does not focus a button at all (`ui.md` → Keyboard layering, Popover). Esc and outside clicks are handled by `Popover`.
- **On open:** focus moves to the filter field.
- **Tab order:** filter, rows (each row: select button, then its delete button when present), "New namespace…". No arrow-key handler.
- **Create:** "New namespace…" calls `onCreateNamespace` (focus rule first). It opens `ResourceCreator` with the namespace form, as the Sidebar `+` did.
- **Delete:** one button per row where `canDeleteNamespace(name)`. It calls `onRequestDelete(name)` (focus rule first). Accessible name: `Delete namespace {name}`. It is hidden visually until row hover or focus with **opacity** (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`), never with `invisible`. Reason: `visibility: hidden` cannot take focus, so the Sidebar's `invisible focus-visible:visible` button was unreachable by keyboard.
- **Protected namespaces:** no delete button (as today).
- **Read-only:** `const reason = pickDisabledReason({ readOnly: identity.readOnly })`. "New namespace…" and every delete button stay visible and focusable with `disabledAttrs(reason)`, and their click handlers bail out (D1). Selecting a namespace is not a write and is never disabled.
- **States of the body** (copy by T2):
  - Loading (`isLoading`): the "all" row and a selected-but-missing row stay usable, plus a muted loading line.
  - Error: the same rows stay usable, plus an error line (`role="alert"`) with the verbatim message (`(error as any)?.message ?? String(error)`) and a Retry button (`refetch()`).
  - Forbidden: `classifyReadError(message) === "no-access"` (`utils/resourceCompare.ts`, already tested) gets its own copy instead of the generic error line. No new classifier.
  - Empty list (no error): an empty-state line.
  - No match for the filter: a no-match line that names the query.
  - Long list: the rows scroll inside the panel; the filter and the New button stay in view.

### 1.7 Scope of the panel

The panel renders only where the picker renders today: `!clusterScoped` in `TopBar.tsx`. That is every namespaced resource view, and the Problems, Possibly unused, Deprecated APIs and Map pages. It is hidden on cluster-scoped kinds, the ArgoCD views, cluster-scoped CRD instances, Node capacity, Journal and Who can (`viewHidesNamespacePicker`, `HEALTH_PAGES[...].nsPicker`, `appView`). On Settings it follows the last resource view, as the picker does today. Those rules do not change.

### 1.8 Keyboard layering

`Popover` registers a modal layer, so while the panel is open `r`, `⌘K` and `⌘N` are inert, and typing in the filter field cannot trigger a shortcut. Esc closes only the panel. While the delete dialog is open, Esc closes only the dialog. Nothing new to add.

### 1.9 Decision: reachability from views without a picker

Options considered:

1. **Accept (chosen).** Create and delete are reachable from every view that shows the picker, which is every namespaced view (Pods, the default view, is one click away). Reasons: showing a namespace control on Nodes, Journal or Who can would suggest the view is filtered by it, which reverses the picker rule (`ui.md` → App views, TopBar rules; P8 in the `TopBar.tsx` comment); a namespace picked from the Sidebar on those views already had no visible effect; create and delete are rare. Cost: from a cluster-scoped view, managing namespaces takes one extra click.
2. Show the namespace chip everywhere as a panel trigger. Rejected: reverses P8 and adds a "this view ignores the namespace" state.
3. Palette action "Create namespace…" (about one line in `App.tsx`'s `settingsActions`). Not in the minimal version; offered to the user as Q1. Delete from the palette would need a name picker and is not offered.

### 1.10 Hard rules that apply

| Rule (CLAUDE.md) | How it is met | Check |
|---|---|---|
| Every `<ConfirmModal>` carries `contextLabel` / `contextColor` | moved verbatim | `grep -n "contextLabel\|contextColor" src/components/NamespacePanel.tsx` |
| Every cluster write goes through `invokeWrite()` | `useDeleteNamespace` (unchanged); create through `ResourceCreator` (unchanged) | `writeBackstop.test.ts` passes |
| Components never call `invoke` | the panel uses `useNamespaces` / `useDeleteNamespace` | `grep -n "invoke" src/components/NamespacePanel.tsx` shows no call |
| Tokens, no colour literals | Tailwind role classes only | `ui.md` → Appearance greps G1, G2, G4 return nothing new |
| `dim` fails AA as text; use `mute` | secondary text is `text-mute` | `grep -n "text-dim" src/components/NamespacePanel.tsx`: icons only, if any |
| Disabled controls stay visible with a reason | `disabledAttrs` + bail-out | read the two handlers |
| Esc closes only the topmost layer | `Popover` and `ConfirmModal` as they are | manual |
| `can_i` fails open | not used here (no RBAC hint added) | none |

### 1.11 Docs in the same diff

- `docs/claude/ui.md`:
  - Confirm-on-Destructive: "Sidebar namespace delete: destructive, typed (namespace)." becomes the namespace panel's delete, same rule.
  - A new section `## Namespace panel` (a grep target): trigger, contents, states, read-only, protected set, the focus rule, the opacity rule, the dialog outside `<header>`, and the scope rule from §1.7 and §1.9.
  - App views, TopBar rules: one clause that the namespace panel follows the picker rule.
  - Keyboard layering: add the namespace panel to the `Popover` users list.
- `docs/claude/key-files.md`: the `Sidebar.tsx` row drops "namespace list"; new rows for `NamespacePanel.tsx` and `utils/namespaces.ts`.
- `docs/claude/writes.md`: "Namespace form opens from the Sidebar `+`." becomes "from the namespace panel's New namespace… (TopBar)".
- `CHANGELOG.md` `[Unreleased]` → `### Changed`: one entry in user terms (the namespace list, create and delete moved from the sidebar into the namespace menu in the top bar, which gained a filter; the delete button is now reachable by keyboard; deleting the namespace you are viewing switches to All namespaces). Only shipped behaviour.

---

## 2. T2 brief: senior-ux-specialist

**Boot:** CLAUDE.md Team protocol and hard rules are binding. Load caveman at ultra (Skill `anthropic-skills:caveman`, args `ultra`). ponytail is not installed: apply it by hand (lead with the minimal fix, name what it skips; flag over-engineering). `rtk` is not on PATH; the hook strips the prefix. Chat in caveman ultra; files in normal prose.

**Run and checkpoint:** task T2 of `.claude/checkpoints/feat-ns-panel-ux-review/ledger.md`. Checkpoint: `.claude/checkpoints/feat-ns-panel-ux-review/T2-senior-ux-specialist.md` (`docs/claude/agent-checkpoints.md`). Write the report into it before you reply.

**Owns:** `docs/ux/24-pod-argocd-review-and-ns-panel.md` only. No production code, no other doc, no git writes, no agents.

**Read first:** this file §0 and §1 (frozen contract); CLAUDE.md hard rules; `docs/claude/ui.md` (Confirm-on-Destructive, Keyboard layering, Read-only mode and guardrails, Appearance, App views); `docs/claude/pods-logs.md`; `docs/claude/argocd.md`; `docs/claude/writes.md` → Secret values in the webview; `src/index.css` and `tailwind.config.js` (tokens, both themes); `docs/ux/22-v2.3.1-search-and-filter.md` for format. Read `/mnt/skills/public/frontend-design/SKILL.md` as a file (it is not in the Skill list). The agent file's "dark-only palette" is out of date: Garita has light and dark themes and six accents since v1.4.2; check both.

**Design lens.** Use the frontend-design skill for intent: hierarchy, typography rhythm, spacing, emphasis, and choices that read as deliberate rather than default. Apply it inside Garita's design system: a dense, technical, dark-first tool with role-named tokens. No rebrand, no new font, no new palette. A token gap is a decision for the tech lead, not a fix.

**Method.** Read the code and compute contrast from the token values in both themes. Do not run `make dev` (the user may own port 1420). Mark every layout, scroll or WebView claim you could not see as "Needs visual check".

### Part A: review

Scope, at base `4e11176` (grep the names):

- **Pod:** the Pods page `PodTable.tsx` (header, status tabs, rows, restart pill, bulk bar) and the Pod panel `DetailPanel.tsx` (header and actions; tabs Overview, Summary, Containers, Events, Logs, Shell, YAML, Metrics, Forward), with what the panel renders: `LogViewer.tsx`, `LogViewBar.tsx`, `LogSourceBar.tsx`, `ShellTab.tsx`, `MetricChart.tsx`, `WhoCanReachSection.tsx`, `DebugContainerDialog.tsx`.
- **ArgoCD:** the ArgoCD panel in `ResourceDetailPanel.tsx`: the panel header and actions for `argocd`, `OverviewContent` case `"argocd"`, `ArgoCdResourcesTab`, `ArgoCdHistoryTab`, `ArgoCdActionBar`, and the Events and Timeline tabs as they render for an Application. `ArgoCDView` (`ResourceViews.tsx`) only where it frames the panel.

Each finding: ID (`POD-n`, `ARGO-n`, `X-n` for shared patterns), severity (**Critical**: blocks a task or fails WCAG 2.1 AA; **Significant**: friction or inconsistency; **Polish**), location (file and function), problem, principle (Nielsen heuristic or WCAG 2.1 success criterion), exact fix (Tailwind token classes, spacing, copy), effort S/M/L, and whether the fix touches a hard rule. Lead with a top-10 list. At most 40 findings: one finding per pattern, listing every location. A fix never breaks a hard rule (ConfirmModal context props, Secret reveal and masking, ArgoCD Sync and Health independence, "Merge" never "Apply", no colour literals, `mute` not `dim` for text, disabled-with-reason not hidden, copy rules in the agent file).

### Part B: §ns-panel spec

The design T3 implements, inside §1:

- ASCII wireframes: the closed trigger in the breadcrumb, and the open panel.
- Width, maximum height, row height and padding as Tailwind classes; long names (truncate with `title`); the selected marker; the delete button's hover and focus look.
- Exact copy: trigger accessible name, filter placeholder and label, the "all" row label (the value stays `"all"`), "New namespace…", the delete button name, and each state in §1.6 (loading, error, forbidden, empty, no match), including Retry.
- Read-only look of New and delete (reason through `disabledAttrs`).
- Keyboard table and focus order, as in §1.6; ARIA names and roles.
- Light and dark contrast for every text and icon colour you use.
- "Contract deviations proposed": any change to §1, with the reason. Empty if none.

End the doc with questions for the user, each with a recommended answer.

**Done when:** the doc exists; every finding has a fix; §ns-panel covers every state in §1.6. Report in caveman ultra: path, finding counts per severity, the top 5, deviations proposed, questions.

---

## 3. T3 brief: frontend-engineer

**Boot:** CLAUDE.md Team protocol and hard rules are binding. Load caveman at ultra (Skill `anthropic-skills:caveman`, args `ultra`). ponytail is not installed: apply it by hand. `rtk` is not on PATH; the hook strips the prefix. Chat in caveman ultra; files in normal prose.

**Run and checkpoint:** task T3 of `.claude/checkpoints/feat-ns-panel-ux-review/ledger.md`. Checkpoint: `.claude/checkpoints/feat-ns-panel-ux-review/T3-frontend-engineer.md`. Write the report into it before you reply.

**Starts after T2** (one-way dependency: T3 needs T2's §ns-panel). No git writes, no agents.

**Owns exactly:**
- `src/utils/namespaces.ts` (new)
- `src/utils/namespaces.test.ts` (new)
- `src/components/NamespacePanel.tsx` (new)
- `src/components/TopBar.tsx`
- `src/components/Sidebar.tsx`
- `src/App.tsx`
- `docs/claude/ui.md`, `docs/claude/key-files.md`, `docs/claude/writes.md`
- `CHANGELOG.md`

**Inputs:** this file §1 (the contract; it wins) and `docs/ux/24-pod-argocd-review-and-ns-panel.md` §ns-panel (layout and copy) plus any deviation the ledger records as accepted. Do not implement Pod or ArgoCD findings.

**Steps:**
1. `utils/namespaces.ts` and its test (§1.5). Run `npx vitest run`.
2. `NamespacePanel.tsx` (§1.4, §1.6), using `Popover`, `useNamespaces`, `useDeleteNamespace`, `useClusterIdentity`, `pickDisabledReason`, `disabledAttrs`, `classifyReadError`, `deleteNamespaceEquiv`.
3. `TopBar.tsx`, `Sidebar.tsx`, `App.tsx` (§1.3). Grep every removed name to zero before deleting an import.
4. Docs (§1.11). Grep each new doc claim against your code.

**Gates (all must pass; run them plainly, `npx vitest run` with no pipe):**
- `npx tsc --noEmit`
- `npx vitest run`
- `npm run build`
- `node --experimental-strip-types scripts/check-emit.ts`
- The §1.10 greps, and `ui.md` → Appearance G1, G2 and G4.
- `git diff --stat 4e11176 -- src-tauri` is empty.

**Traps:**
- `ConfirmModal` has no portal: render `DeleteNamespaceConfirm` after `</header>`, never inside it.
- The focus rule in §1.6: focus the trigger before closing the panel, or focus lands on `<body>` after the dialog closes.
- The delete button uses opacity, never `invisible`.
- Keep `useNamespaces` in `App.tsx`: `MapPage` reads `namespaces`.

**Report:** caveman ultra: files changed, gates with results, any spec item you could not follow and why.

---

## 4. T4 brief: tech-lead (review of T3)

**Boot:** as T3. Checkpoint: `.claude/checkpoints/feat-ns-panel-ux-review/T4-tech-lead.md`. Review only: no edits except the checkpoint, no git writes, no agents.

Check T3's diff (`git diff 4e11176 -- <T3 paths>`) against:

1. §1.3: every listed prop, state and import is gone from `Sidebar.tsx` and `App.tsx`; `grep -n "onDeleteNamespace\|onCreateNamespace\|nsToDelete\|hoveredNs\|deleteNamespaceEquiv" src/components/Sidebar.tsx` and `grep -n "useDeleteNamespace" src/App.tsx` return nothing.
2. §1.4: the signatures match; `Popover` is reused; the body that calls `useNamespaces` mounts only while open.
3. §1.5: the helper matches the doc comment; each listed test case exists.
4. §1.6: the focus rule on select, New and delete; Enter in the filter; read-only bail-out in both handlers; opacity, not `invisible`; every state present, forbidden through `classifyReadError`; `onDeleted` resets a selected namespace to `"all"`.
5. §1.10 hard rules, by grep, plus G1, G2, G4.
6. `DeleteNamespaceConfirm` renders outside `<header>`.
7. §1.11: every doc change is present and each claim matches the code; `CHANGELOG.md` `[Unreleased]` → Changed only.
8. No `src-tauri` diff, so the cargo gates are not needed; say so in the report. Re-run `npx tsc --noEmit`, `npx vitest run`, `npm run build` and `node --experimental-strip-types scripts/check-emit.ts`.
9. Ponytail: flag anything beyond §1 (new state, a second popover, arrow-key handling, extra props).

Findings: Blocking / Should fix / Nit, each with file, line and the exact fix. A fix batch is re-checked by T4 again.

---

## 5. Questions for the user

- **Q1. Reach from views without a picker.** Create and delete are not reachable from Nodes, ArgoCD, Journal, Who can and the other views without a namespace picker; one click to any namespaced view reaches them. Add a palette entry "Create namespace…" so create works from every view? Recommended: no for now; it is about one line if wanted.
- **Q2. Forbidden namespace list.** When the user may not list namespaces, the panel shows only "All namespaces" and the current namespace (as the dropdown does today). Let the filter field accept a typed name ("Use namespace …") in that state? Recommended: separate item; it needs a name validator and copy.
- **Q3. `kube-node-lease`.** Add it to the namespaces that offer no delete button? Recommended: yes in a follow-up; deleting it breaks node heartbeats. Not in this run, since it changes behaviour beyond the move.

## 6. Observed, out of scope

- `delete_namespace` (`commands/extras.rs`), `delete_pod` (`pods.rs`) and `delete_node` (`nodes.rs`) use `DeleteParams::default()`, not `delete_params_for`. The CLAUDE.md delete rule is documented for `delete_resource` (`writes.md` → Delete propagation); `delete_argocd_app` is exempt by its own rule (finalizers). For a Namespace the namespace controller deletes the contents regardless of the policy. Not changed here; flagged for a later Rust review.
- `useCreateNamespace` in `useResources.ts` has no caller (namespace create goes through `ResourceCreator`). Left as is.
- `.claude/agents/senior-ux-specialist.md` still says "Sidebar (… namespace list …)" and "Dark-only palette". After T3 lands, the main session or the user may update it; agents do not edit agent configuration.
