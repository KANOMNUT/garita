# UX 24: Pod and ArgoCD panel review, and the namespaces picker and page

Status: draft for the tech lead. Written for task T2 of the run `feat/ns-panel-ux-review` (`.claude/checkpoints/feat-ns-panel-ux-review/ledger.md`). Design only: no code, no Tauri signatures. Code read on 2026-10-28 at base `4e11176` (line numbers are at that commit; grep the names). Nobody ran the app, so every layout, scroll and WebView statement is derived from the code and the token numbers, and the ones that need eyes are listed under "Needs visual check" (section 4.7).

Scope update (user, relayed by the coordinator, 2026-10-28): the Pod and ArgoCD findings in Part A **will be implemented**. The tech lead turns the findings marked "Implement now" into tasks for `frontend-engineer`. So every finding carries a decision (Implement now, Defer, or Question), and every fix names file, line, token, class and copy. Anything I was not sure of (product intent, scope, copy meaning, a behaviour change) is not assumed: it sits in section 6 with options and a recommendation, and the finding says which question blocks it.

Second scope update (user, relayed by the coordinator, 2026-10-28): plan section 1 is **reopened**. The namespace list leaves the sidebar for **two surfaces**: the TopBar namespace dropdown (picking and filtering only) and a new **Namespaces resource page** (table, detail panel, create, delete with a typed confirm). No palette "Create namespace…" action; a forbidden namespace list shows the forbidden state with no typed-name fallback; `kube-node-lease` joins the delete-protected set, disabled with a reason and not hidden. Part B therefore specifies UX for both surfaces and is not a code contract; the tech lead re-plans from it (4.6 says what of plan section 1 is void and what carries over). Backend needs are flagged in 4.2, not decided.

## Contents

1. Summary
2. Method, lenses and limits
3. Part A: review of the Pod panel and the ArgoCD panel
   - 3.1 Top 10
   - 3.2 Dispositions (all 37 findings)
   - 3.3 Cross-cutting findings (X)
   - 3.4 Pod findings (POD)
   - 3.5 ArgoCD findings (ARGO)
   - 3.6 Reviewed with no findings
4. Part B: namespaces, the picker and the page
5. Docs and gates the fix batch owes
6. Questions for the user (with options and a recommendation)

---

## 1. Summary

**Verdict.** Garita has two generations of UI code. The newer pieces (`LogViewer`, `ShellTab`, `DebugContainerDialog`, `MetricChart`, `WhoCanReachSection`, `TimelineTab`, the generic `EventsTabContent`, the Map kind filter) meet the bar: real labels, `mute` for text, `aria-pressed`, live regions, `Popover`, visible reasons. The older pieces (`DetailPanel`, `PodTable`, `ResourceDetailPanel` outside Events and History, the ArgoCD action bar) do not, and the gap is the review. Nothing here asks for a new component or a new token. The fix is to lift the old code to the standard the new code already sets.

**Counts.** 37 findings: 5 Critical, 24 Significant, 8 Polish. 31 are "Implement now" (7 of them only in part), 6 wait entirely on a question.

**The five Critical findings.**

1. **X-1**: nobody can open a Pod or an Application from the keyboard. Rows open the panel only through a `<tr onClick>`.
2. **ARGO-1**: the ArgoCD panel header says **Degraded** in red for any app that is not both Healthy and Synced. A Healthy but OutOfSync app, and a Progressing one, read as broken. This collapses two independent axes, which is a CLAUDE.md hard rule.
3. **X-3**: the panel close buttons, the row checkboxes, the pod menu button and the forward "stop" button have no accessible name.
4. **POD-1**: the Containers tab accordions are re-created on every render, so a keyboard user loses focus each time they open ENV, MOUNTS or PROBES.
5. **X-2**: `text-dim` and alpha-suffixed text (`/60`, `/70`, `/80`) carry real information in about 250 places and fail 4.5:1 in both themes (dark `dim` on a card is 2.85:1).

**The Claude design lens (what I changed my mind about).** The panels spend their boldness in the wrong place. Ten type sizes (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14 px) and uppercase tracked eyebrows on every card make everything shout at the same level, while the one thing the user opens a panel for, "what state is this in", is either wrong (ARGO-1), the wrong colour (POD-3: a pod in `ImagePullBackOff` or `Failed` gets the green Running pill in the panel) or hidden below the fold (ARGO-2: Sync sits under the field list). The design direction for the fix batch is: one memorable element per panel, the status header (Health and Sync as a pair for Applications; the status pill and ready fraction for Pods); everything else quiet, in `ink` and `mute`, on one small type scale, with state said in words plus a glyph and never in colour alone.

**Part B in one paragraph.** Two surfaces. The **picker** becomes a 320 px `Popover`: a filter field, a scrolling list ("All namespaces", then the namespaces, a check mark on the current one, a muted `Terminating` tag when the phase is known) and one pinned footer link, **Manage namespaces** (recommended; Q18). The **Namespaces page** is a new cluster-scoped kind `ns`, first row of the sidebar "Cluster" section, with a four-column table (Name, Status, Age, Labels: `Active` is a quiet dot and word, `Terminating` is the one loud purple pill), the standard detail panel (Overview, Summary, Events, YAML; a "Why it is still deleting" card for a Terminating namespace; a "Show pods in this namespace" link), create through the existing TopBar New and `⌘N`, and delete through the Sidebar's typed confirm moved verbatim. Delete is **disabled with a reason, not hidden**, for read-only mode, an RBAC denial, the four built-in namespaces and a namespace that is already Terminating. Every state is specified: loading, empty, error, forbidden, Terminating, read-only. The page cannot be built without a **Rust change** (today `list_namespaces` returns names only): that is flagged in 4.2 and asked in Q16 and Q17.

**Skipped on purpose (ponytail).** Arrow-key row navigation in the tables (the native button in the name cell is the minimum); a full roving `tablist` for the panel tabs (`aria-current` is the minimum); a new field-border token; a toast system; a rewrite of any component. Each has an upgrade path named in its finding.

---

## 2. Method, lenses and limits

- **Lenses.** Nielsen's ten heuristics (cited by number), WCAG 2.1 AA success criteria (cited by number; criteria from WCAG 2.2 are marked "2.2" and used only as advice), density for expert users, and the Anthropic `frontend-design` skill, read as a file: hierarchy, a clear type scale, spend boldness in one place, structure that carries information, copy that names what happens. It is applied inside Garita's role-named tokens: no rebrand, no new font, no new palette. Where a fix would need a token that does not exist, it goes to a question, not into a fix.
- **ux-ui-pro-max was not installed in this environment.** Its usual ground (heuristics, WCAG including light-theme contrast, focus, target size, names and roles, interaction states, expert density) is covered by this method instead.
- **Contrast** was computed from the token values in `src/index.css` for both themes and all six accents, with `bg-card/70` flattened over `surface-panel`, and `/N` text flattened over its own background. The script is in the T2 scratchpad; the numbers below are its output. Dark / light, text on `surface-panel` unless stated:

| Colour | Dark | Light | Verdict as text (4.5:1) |
|---|---|---|---|
| `ink` | 15.00 | 16.96 | pass |
| `mute` | 5.91 | 5.92 | pass |
| `dim` | 3.04 (card 2.85) | 3.61 (card 3.75) | **fail** |
| `dim/60` on card | 1.83 | 2.05 | **fail** |
| `text-ok/70` on `bg-ok/10` | 4.42 | 3.23 | fail in light |
| `text-warn/70` on `bg-warn/10` | 4.91 | 3.17 | fail in light |
| `text-bad/70` on `bg-bad/10` | 3.37 | 4.00 | **fail** both |
| `text-status-progress/70` on its tint | 3.46 | 3.21 | **fail** both |
| `text-warn/80` on `bg-warn/10` | 5.93 | 3.87 | fail in light |
| `text-accent/80` on card (blue) | 4.58 | 4.35 | fail in light (amber 4.24, teal 4.45) |
| `text-accent/70` on card (blue) | 3.82 | 3.51 | **fail** both |
| `text-on-accent` on `bg-bad/80` (blue accent) | 3.96 | 5.71 | **fail** in dark, at 9 px |
| accent text on `bg-accent/15` | 5.43 to 7.73 | 5.16 to 7.64 | pass, all six accents |
| status colours at full strength on their `/10` tint | 5.40 to 8.39 | 5.81 to 6.14 | pass |

  Non-text (3:1 for a component boundary or a focus indicator, WCAG 1.4.11): `ring-edge` on the panel is **1.16** dark and **1.18** light; `ring-edge-strong` is 1.31 and 1.34; `dim` as an icon is 3.04 / 3.61 on the panel but 2.85 dark on a card; `ring-accent/40` is 2.11 to 2.71 dark and 1.89 to 2.12 light; `ring-accent/60` is 2.80 light blue; **`ring-accent/70` is at least 3.95 dark and 3.35 light for all six accents**, which is the pattern `docs/ux/22` already chose. `ring-mute/70` is 3.53 dark and 3.11 light.
- **Limits.** I did not run the app (CLAUDE.md: the user may own port 1420). I did not read `ConstraintsSection`, `ExplainCard`, `FieldManagers`, `YamlFind`, `YamlSaveGate` or `ConfirmModal` beyond how the two panels call them; they are covered by earlier specs. `ArgoCDView` is read only where it frames the panel (its health strip and column set).

---

## 3. Part A: review of the Pod panel and the ArgoCD panel

Severity: **Critical** blocks the task or fails WCAG 2.1 AA; **Significant** is friction or an inconsistency; **Polish** is minor. Effort: S (under an hour of editing), M (a component), L (a sweep of many sites). "Rule" says whether the fix touches a hard rule in `CLAUDE.md`.

### 3.1 Top 10

| # | ID | Sev | One line |
|---|---|---|---|
| 1 | X-1 | Critical | Pod, Application and managed-resource rows open only by mouse (`<tr onClick>`). |
| 2 | ARGO-1 | Critical | Panel header says "Degraded" for Healthy+OutOfSync and Progressing apps; the Resources filter chip "Healthy" means Healthy and Synced. |
| 3 | X-3 | Critical | Close, menu, row checkbox, stop-forward and clear-search controls have no accessible name. |
| 4 | POD-1 | Critical | `AccordionHeader` is defined inside the render: focus is lost on every toggle, and no `aria-expanded`. |
| 5 | X-2 | Critical | `text-dim` and `/60 /70 /80` text fail 4.5:1 in about 250 places, including toggle labels and dates. |
| 6 | POD-5 | Significant | Delete pod (panel and table) closes the dialog and swallows a failed delete. |
| 7 | POD-3 | Significant | Pod panel status pill falls back to green Running for ImagePullBackOff, Failed and Unknown; the table disagrees. |
| 8 | ARGO-4 | Significant | In read-only mode Sync, Refresh and Hard Refresh look enabled, and a click does nothing, silently. |
| 9 | X-4 | Significant | Hand-rolled menus are not layers: Esc closes the whole panel under an open menu; the row menu never closes on an outside click. |
| 10 | ARGO-2 | Significant | The primary job (Sync) is below the field list and the panel never says whether auto-sync is on. |

### 3.2 Dispositions (all 37)

"Implement now" means the fix in the finding is exact and needs no answer. "Q" means a question in section 6 blocks it (or its blocked part). Batch: B1 is the first fix batch (Critical, silent failures, wrong status), B2 the second.

| ID | Sev | Decision | Q | Batch |
|---|---|---|---|---|
| X-1 | Critical | Implement now | | B1 |
| X-2 | Critical | Implement now | | B1 |
| X-3 | Critical | Implement now | | B1 |
| X-4 | Significant | Implement now (DetailPanel, PodTable). The TopBar New menu waits until the namespace work on `TopBar.tsx` has landed. | | B2 |
| X-5 | Significant | Implement now | | B2 |
| X-6 | Significant | Implement now (feedback). Whether Copy names keeps clearing the selection: Q12 | Q12 | B2 |
| X-7 | Significant | Implement now (size floor, no prose in mono). Full scale and eyebrow case: Defer | Q13 | B2 |
| X-8 | Significant | Implement now (focus rings). Field boundaries: Defer | Q14 | B2 |
| X-9 | Polish | Implement now | | B2 |
| POD-1 | Critical | Implement now | | B1 |
| POD-2 | Significant | Defer, waiting on the answer | Q2 | B2 |
| POD-3 | Significant | Implement now | | B1 |
| POD-4 | Significant | Implement now | | B2 |
| POD-5 | Significant | Implement now | | B1 |
| POD-6 | Significant | Implement now | | B2 |
| POD-7 | Significant | Implement now (the "req" label). Bar denominator and sorting: Defer | Q3, Q4 | B2 |
| POD-8 | Significant | Implement now | | B2 |
| POD-9 | Significant | Implement now | | B2 |
| POD-10 | Significant | Defer, waiting on the answer | Q5 | B2 |
| POD-11 | Significant | Defer, waiting on the answer | Q6 | B2 |
| POD-12 | Significant | Implement now | | B1 |
| POD-13 | Polish | Implement now | | B2 |
| POD-14 | Polish | Implement now | | B2 |
| POD-15 | Polish | Implement now | | B2 |
| ARGO-1 | Critical | Implement now (header). The generic "Degraded" label for other kinds: Q15 | Q15 | B1 |
| ARGO-2 | Significant | Implement now | | B1 |
| ARGO-3 | Significant | Implement now (checkboxes, always-visible help). Force wording: Q10 | Q10 | B2 |
| ARGO-4 | Significant | Implement now | | B1 |
| ARGO-5 | Significant | Implement now | | B1 |
| ARGO-6 | Significant | Defer, waiting on the answer | Q7 | B2 |
| ARGO-7 | Significant | Implement now (full message, always-visible chevron). "Current" marker: Q11 | Q11 | B2 |
| ARGO-8 | Significant | Defer, waiting on the answer | Q8 | later (Rust) |
| ARGO-9 | Significant | Defer, waiting on the answer | Q9 | B2 |
| ARGO-10 | Polish | Implement now | | B2 |
| ARGO-11 | Polish | Implement now | | B2 |
| ARGO-12 | Polish | Implement now | | B2 |
| ARGO-13 | Polish | Implement now | | B2 |

### 3.3 Cross-cutting findings (X)

#### X-1. Rows and row-like links are mouse-only (Critical, Implement now, M)

- **Where.** `PodTable.tsx:498-513` (`PodRow`: `<tr onClick={handleClick}>`, name cell at `:511`). `GenericResourceTable.tsx:291-307` (every list view, including the ArgoCD Applications list). `ResourceDetailPanel.tsx:1975-1981` and `:2044-2050` (ArgoCD Resources tab: the kind cell is styled as a link, `text-accent group-hover:underline`, but is a `<span>` in a clickable `<tr>`). No `tabIndex`, `onKeyDown` or role appears for these rows in `PodTable.tsx`, `GenericResourceTable.tsx` or the Resources tab, and `App.tsx` has no row navigation, so a keyboard-only user cannot open a Pod panel, an Application panel, or navigate from a managed resource to the object.
- **Principle.** WCAG 2.1.1 Keyboard (A); Nielsen 7 (flexibility and efficiency for experts).
- **Fix.** Keep the `<tr onClick>` for the mouse and put one native `<button type="button">` in the name cell. The button needs **no handler**: Enter and Space dispatch `click`, which bubbles to the row. Shared classes: `max-w-full text-left rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70`.
  - `PodTable.tsx:511-513`: replace `<span className="mono text-[12px] truncate block">{pod.name}</span>` with `<button type="button" aria-current={selected ? "true" : undefined} title={pod.name} className="mono text-[12px] truncate block max-w-full text-left rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">{pod.name}</button>`. The `title` also fixes the truncated name having no tooltip.
  - `GenericResourceTable.tsx:299-306`: when `onSelect` is set and `ci === 0`, wrap `{col.cell(item)}` in the same button (no `title`), with `aria-current={isSelected ? "true" : undefined}`. **Audit before this ships:** a button may not contain a button or a link. Grep the first column of every `Column[]` in `ResourceViews.tsx` and `GenericResourceTable` callers (`grep -n "cell: " src/components/ResourceViews.tsx` and read the `id: "name"` entries); a list whose first cell holds interactive content is reported to the tech lead and left unchanged, not silently altered. The ArgoCD column `name` renders `<N t={a.name} />`, plain text (`ResourceViews.tsx:1672`).
  - `ResourceDetailPanel.tsx:1980` and `:2049`: when `clickable`, render the kind as `<button type="button" aria-label={`Open ${r.kind} ${r.name}`} className="mono text-accent hover:underline rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">{r.kind}</button>` (same pattern as the existing `Open ConfigMap …` labels at `DetailPanel.tsx:1092`). Not clickable: keep the plain `<span>`.
  - Esc: the existing `App.tsx:535-552` handler clears the selection, and focus stays on the row button (it is still mounted), so Shift+Tab and Esc keep working. No focus move into the panel is added (that would be a new behaviour).
- **Skips.** Arrow-key row navigation (j and k, or up and down). Upgrade path: a roving row focus like `TimelineTab` (`onRowKey`). The Map kind filter set the precedent of not adding arrow handlers (C-2).
- **Rule.** None. Tests: none (DOM). Manual: Tab reaches the name, Enter opens the panel, Esc closes it, focus is visible in dark and light.

#### X-2. `dim` and alpha-suffixed text fail 4.5:1 (Critical, Implement now, L)

- **Where (counts by `grep`).** `text-dim` as text: `DetailPanel.tsx` 53, `PodTable.tsx` 10, `ResourceDetailPanel.tsx` 160, `LogViewBar.tsx` 14, `LogSourceBar.tsx` 2, `ShellTab.tsx` 5, `DebugContainerDialog.tsx` 3, plus `ResourceViews.tsx:1690, 1694, 1699, 1705, 1724` (ArgoCD list: the Destination, Repo, Revision and Synced second lines and the health-card label). `text-dim/NN`: `DetailPanel.tsx` 5, `ResourceDetailPanel.tsx` 11. Alpha-suffixed status and accent text: 17 sites, among them `ResourceDetailPanel.tsx:1851, 1858, 1868, 1878, 1888` (Resources filter chips), `:1998, :2066` (`text-warn/70`), `:2017, :2085` (`text-warn/80`), `:2475` (`text-warn/70`), `DetailPanel.tsx:1063, :1125` (`text-accent/80`, `/70`), `:1196` (`text-warn/80`).
- **Problem.** The information carried is not decoration: the Containers tab `KV` keys, the "req / lim" lines, the History dates, the ArgoCD Unknown and Suspended pills (the states that most need attention), the toggle labels `previous`, `follow`, `.* regex` when off, the event ages, the delete-mode radio descriptions. The CLAUDE.md rule is "`dim` fails WCAG AA as text; use `mute`", and this is a direct breach of it, not a new standard.
- **Principle.** WCAG 1.4.3 Contrast (Minimum), AA; 1.4.11 for icons on cards.
- **Fix (rules; apply by editing, not by a blind codemod, then read the diff).**

| Now | Replace with | Why |
|---|---|---|
| `text-dim` on any text | `text-mute` | 5.91 / 5.92 |
| `text-dim/50` to `/70`, `/40` on text | `text-mute`; a decorative glyph that is not information gets `aria-hidden` and may stay `text-dim/50` (`DetailPanel.tsx:1060`, the `⊞` glyph) | 1.6 to 2.4 as text |
| `text-ok/70`, `text-warn/70`, `text-bad/70`, `text-status-progress/70`, `text-warn/80` on a tint | the full token (`text-ok`, `text-warn`, `text-bad`, `text-status-progress`). The "inactive" look of a chip comes from its background (`/10` against `/20` when active), its ring (`ring-X/20` against `/40`) and `aria-pressed`, never from fading the text. | 5.4 to 8.4 |
| `text-accent/70`, `/80` | `text-accent` | 4.2 to 7.6 |
| `bg-bad/80 text-on-accent text-[9px]` count badge (`ResourceDetailPanel.tsx:3338`) | see ARGO-12 | 3.96 dark |
| Pod `Unknown` pill (`PodTable.tsx:19`: `text-dim bg-dim/10 ring-dim/30`) | `text-mute bg-surface-tint/5 ring-edge`; the same for ArgoCD Suspended and Unknown (`ResourceDetailPanel.tsx:1371-1372, 1377, 1386, 1775, 1785-1786, 1987`) | |
| Meaningful icon on a card in `text-dim` | `text-mute` (dim as an icon is 2.85 dark on a card) | 1.4.11 |

  An icon that sits on `surface-panel` and is redundant with adjacent text may stay `text-dim` (3.04 dark, 3.61 light).
- **Gate for the fix batch.** `grep -nE 'text-dim' src/components/DetailPanel.tsx src/components/PodTable.tsx src/components/ResourceDetailPanel.tsx src/components/LogViewBar.tsx src/components/LogSourceBar.tsx src/components/ShellTab.tsx src/components/DebugContainerDialog.tsx` returns only icon lines; `grep -rnE 'text-(ok|warn|bad|status-progress|accent)/(40|50|60|70|80)' <same files>` returns nothing. The tech lead may want this as a G5 line in `ui.md` → Appearance.
- **Risk.** The ink / mute / dim ladder becomes ink / mute. Hierarchy then has to come from size and weight, which X-7 settles. Needs a visual check in both themes.
- **Rule.** Enforces the CLAUDE.md `dim` rule. No colour literals are introduced (G1, G2, G4 stay clean).

#### X-3. Controls without an accessible name (Critical, Implement now, S)

- **Principle.** WCAG 4.1.2 Name, Role, Value (A); 1.3.1; 3.3.2.
- **Fix, exact.**

| Where | Control | Add |
|---|---|---|
| `DetailPanel.tsx:669-674` | close X | `aria-label="Close pod panel"` `title="Close (Esc)"` |
| `ResourceDetailPanel.tsx:3315-3320` | close X | `aria-label={`Close ${kindLabel(resource)} panel`}` `title="Close (Esc)"` |
| `DetailPanel.tsx:702-707` | more menu | `aria-label="Pod actions"` `aria-haspopup="dialog"` `aria-expanded={menuOpen}` (see X-4) |
| `PodTable.tsx:503-509` | row checkbox | `aria-label={`Select pod ${pod.name}`}` |
| `PodTable.tsx:887-893` | header checkbox | `aria-label="Select all shown pods"` |
| `PodTable.tsx:571-576` | row menu | replaced by a named delete button (X-4) |
| `DetailPanel.tsx:377-382` | forward "stop" | `aria-label={`Stop forward localhost:${f.local_port}`}` |
| `TopBar.tsx:236-241` | clear-search `✕` | `aria-label="Clear search"`. Outside the two panels but the same defect; do it after the namespace work on `TopBar.tsx` has landed (that file is rebuilt by Part B). |
| `ResourceDetailPanel.tsx:3295-3314` | Edit and Delete icon buttons | they rely on `title` alone: add `aria-label` equal to the title string. |

- **Rule.** None.

#### X-4. Hand-rolled menus are not layers (Significant, Implement now, M)

- **Where.** `DetailPanel.tsx:701-725` (`menuRef` plus the mousedown effect at `:599-606`); `PodTable.tsx:160-219` (Labels) and `:222-265` (Sort), closed by the effect at `:125-133`; `PodTable.tsx:570-591` (the row menu); `TopBar.tsx:260-293` (New).
- **Problem.** These menus are not modal layers, so Esc reaches `App.tsx:549-551` and clears the selected pod: the panel closes under the open menu (`ui.md` → Keyboard layering says Esc closes only the topmost layer). The row menu in `PodTable.tsx:570-591` has no outside-click close at all, so two can be open at once. None exposes `aria-expanded`, and focus does not return to the trigger.
- **Principle.** WCAG 4.1.2, 2.4.3; Nielsen 3 (user control); `ui.md` Keyboard layering.
- **Fix.**
  - Use the shared `Popover` exactly as `LogViewBar.tsx:161-163` does: a `triggerRef`, `open`, `onClose`, a `label`, trigger with `aria-haspopup="dialog"` and `aria-expanded`. Delete `menuRef`, `labelsRef`, `sortRef` and the three `mousedown` effects. The parent wrapper stays `relative`.
  - `DetailPanel.tsx`: `<Popover open={menuOpen} onClose={() => setMenuOpen(false)} triggerRef={menuBtnRef} label="Pod actions" className="right-0 top-8 w-44 py-1">` with the existing two items. Item buttons gain `type="button"` and `outline-hidden focus-visible:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70`. Copy pod name does not close the menu: its label flips to "Copied pod name" for 1.5 s (X-6).
  - `PodTable.tsx` Labels and Sort: `label="Filter by label"` with `className="right-0 top-9 w-72 py-2 max-h-80 overflow-y-auto"`, and `label="Sort pods"` with `className="right-0 top-9 w-52 py-1"`.
  - **`PodRow`: remove the menu, ponytail.** It holds one item. Replace it (`:569-592`) with a direct button using the pattern that `GenericResourceTable.tsx:307-317` already ships: add `group` to the `<tr>` class list at `:500`, delete `menuOpen`, and render
    `<button type="button" aria-label={`Delete pod ${pod.name}`} onClick={(e) => { e.stopPropagation(); if (rowReason) return; handleDelete(); }} {...(rowReason ? disabledAttrs(rowReason) : { title: `Delete pod ${pod.name}` })} className={`h-6 w-6 flex items-center justify-center rounded-sm text-mute opacity-0 group-hover:opacity-100 focus-visible:opacity-100 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${rowReason ? "cursor-not-allowed" : "hover:text-bad hover:bg-bad/10"}`}><Trash2 size={12} aria-hidden /></button>`.
    `rowReason = readOnlyReason ?? (bulkActive ? "Clear the selection to delete a single pod." : undefined)`: read-only wins (DISABLE-PRECEDENCE). This replaces `opacity-30 pointer-events-none`, which left the button focusable and unexplained. Per-row delete stays disabled while a bulk selection exists (`pods-logs.md`).
  - `TopBar.tsx` New menu (`:260-293`): same `Popover` change, **after the namespace work on `TopBar.tsx` has landed**, because Part B rebuilds that file's picker and New item label.
- **Rule.** `ui.md` Keyboard layering. Delete still goes through `ConfirmModal` (context props unchanged) and `invokeWrite`.

#### X-5. Widget state is not exposed (Significant, Implement now, S to M)

- **Principle.** WCAG 4.1.2; 1.4.1.
- **Fix.**
  - Panel tab strips, `DetailPanel.tsx:777-791` and `ResourceDetailPanel.tsx:3325-3352`: wrap the strip in `role="group" aria-label="Pod sections"` (for the resource panel: `` `${kindLabel(resource)} sections` ``) and add `aria-current={tab === t ? "true" : undefined}` to each tab button. Minimal on purpose. Upgrade path: `role="tablist"` with roving focus, copying `onTabKey` from `HelmUpgradeGate.tsx:218-231`.
  - Pod status filter, `PodTable.tsx:145-157`: `role="group" aria-label="Filter by status"` and `aria-pressed={status === s}` on each button.
  - ArgoCD Resources chips (rebuilt in ARGO-1), the Flat/Grouped toggle (`ResourceDetailPanel.tsx:1895-1905`): `aria-pressed`, with a fixed label "Group by kind" (today the visible word flips between "Flat" and "Grouped", which names the next state, not the current one; a pressed toggle must not change its name).
  - `ArgoHealthCard` (`ResourceViews.tsx:1718-1726`): `aria-pressed={active}`; label size per X-7.
  - Sortable headers: `PodTable.tsx:611-628` puts `onClick` on the `<th>`. Move it to a `<button type="button" className="flex items-center gap-1 rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">` inside the `<th>` and add `aria-sort={isActive ? (activeSortDir === "asc" ? "ascending" : "descending") : undefined}` on the `<th>`. `GenericResourceTable.tsx:231-250` already has the button; add the same `aria-sort`.
  - `LogViewer.tsx:210` (`previous`) and `:213` (`follow`): `aria-pressed={previous}` and `aria-pressed={follow && !previous && !hist}`.
- **Rule.** None.

#### X-6. Outcomes with no feedback (Significant, Implement now (feedback) / Q12, S)

- **Where.** Copy pod name, `DetailPanel.tsx:711-712` (the menu closes, nothing says it worked); YAML copy, `:1477-1483`; bulk Copy names, `PodTable.tsx:815-818` (`navigator.clipboard.writeText` is not awaited or caught, and the selection is then cleared).
- **Problem.** The app has no toast system; feedback is inline. A copy that fails (the clipboard can be denied) is also silent. Nielsen 1 (visibility of status), 9 (error recovery).
- **Fix.** One small hook, `src/hooks/useCopyFeedback.ts`: `useCopyFeedback(ms = 1500)` returns `{ state: "idle" | "copied" | "failed", copy(text) }`; `copy` awaits `navigator.clipboard.writeText` in a try/catch, sets the state, and resets it after `ms` (timer cleared on unmount). The button label flips in place and a sr-only `role="status"` carries the same text:
  - menu item: "Copy pod name" to "Copied pod name" (and "Couldn't copy" on failure);
  - YAML: "Copy" to "Copied", "Copy neat" to "Copied neat YAML";
  - bulk: "Copy names" to `Copied ${n} names`.
  No test (needs a DOM and the clipboard). Do not add a toast.
- **Question.** Whether bulk Copy names keeps clearing the selection afterwards is Q12 (I would keep it, so Delete or Restart can follow). Until answered, keep today's behaviour and add only the feedback.
- **Rule.** None.

#### X-7. Type scale and prose in mono (Significant, Implement now (floor, prose) / Q13 (rest), L)

- **Where.** `DetailPanel.tsx` uses ten sizes (9: 3 sites, 9.5: 5, 10: 25, 10.5: 23, 11: 37, 11.5: 8, 12: 6, 12.5: 2, 13: 1, 14: 1); `ResourceDetailPanel.tsx` the same ten; `PodTable.tsx` eight. 33 sites in `DetailPanel.tsx` and 60 in `ResourceDetailPanel.tsx` are below 10.5 px. Uppercase tracked eyebrows: 21 in `DetailPanel.tsx`, 49 in `ResourceDetailPanel.tsx`. Sentences set in `mono`: `DetailPanel.tsx:282, 1435`, `ResourceDetailPanel.tsx:1934, 1937, 2018, 2086, 2740, 2901-2908, 2950`.
- **Problem.** No scale, so hierarchy is made by guesswork; the smallest text carries real data (the init badge at 9 px, "req / lim" at 10 px, exit codes at 10 px). The frontend-design skill's two named tells both appear: all-caps labels as the default, and mono used as decoration. Mono is for identifiers, values and commands; a sentence in mono reads as a log line.
- **Principle.** Nielsen 8 (aesthetic and minimalist design); WCAG 1.4.4 (resize) is met, but readability at the app's own default zoom is the issue.
- **Fix (now).**
  1. **Floor.** No text smaller than `text-[10.5px]` in the touched files: change every `text-[9px]`, `text-[9.5px]` and `text-[10px]` that sets text (not an icon size) to `text-[10.5px]`. Check `DetailPanel.tsx:916, 1196, 1319` (badges) and the `TimingChip` at `:154-160` for wrapping.
  2. **Mono only for identifiers.** Drop `mono` (and use `text-[11px]`) on the sentences listed above and on word-labelled buttons (X-9). Names, ids, ports, versions, numbers, commands and YAML stay mono.
- **Not now (Q13).** Collapsing 11.5 and 12.5 into 11 and 12, and replacing uppercase eyebrows with sentence case. The proposed scale for when the user agrees: 10.5 caption and badge; 11 label and secondary; 12 body and control; 13 empty-state line; 14 panel title. The eyebrow recipe if changed: `text-[11px] font-medium text-mute`, sentence case. I recommend keeping uppercase eyebrows for now because every other view uses them and a change in two panels only would make the app inconsistent.
- **Rule.** Uses `mute`, not `dim`.

#### X-8. Focus rings and field boundaries are below 3:1 (Significant, Implement now (focus) / Q14 (boundaries), M)

- **Where.** Focus rings at `/40` or `/60`: `LogViewBar.tsx:131, 136, 158` (`focus:ring-accent/40`), `LogViewer.tsx:199, 217, 218` (`/60`), `DetailPanel.tsx:241, 1094, 1122` (`/40`, `/60`), `TopBar.tsx:233` (`focus:ring-accent/40`), `DetailPanel.tsx:1441-1449` buttons with no ring. 13 sites in `DetailPanel.tsx`, `PodTable.tsx` and `ResourceDetailPanel.tsx` alone carry `ring-accent/40` or `/60`.
- **Problem.** A focus indicator is a state of a component, so it needs 3:1 (WCAG 1.4.11). `ring-accent/40` is 2.11 dark and 1.92 light for the default blue; `/60` is 2.80 in light blue. Separately, `ring-1 ring-edge` is 1.16:1 (dark) and 1.18:1 (light) against the panel, and the field fill `surface-input` is 1.03:1 against it, so a text field's boundary is effectively invisible. That is the design system's hairline choice, not a bug in these two panels.
- **Principle.** WCAG 2.4.7 Focus Visible (AA), 1.4.11 Non-text Contrast (AA).
- **Fix (now).** Every focus ring on the touched controls becomes `focus-visible:ring-2 focus-visible:ring-accent/70` (computed at least 3.95:1 dark and 3.35:1 light for all six accents; the existing `MapPage` pattern). For inputs that use `focus:` (not `focus-visible:`) keep `focus:` and use `focus:ring-2 focus:ring-accent/70`.
- **Not now (Q14).** Field boundaries. Option A, no new token: `ring-1 ring-mute/70` on text fields (3.53 dark, 3.11 light against the panel; 3.47 and 3.01 against the field fill). Part B uses option A for its filter field and will need the same answer.
- **Rule.** None; a token gap is the tech lead's decision, which is why the boundary half is a question.

#### X-9. Button vocabulary and casing (Polish, Implement now, S)

- **Problem.** The same kind of action is written three ways: lowercase mono (`cancel`, `edit`, `copy`, `stop`, `previous`, `follow`, `Hard`), Title Case (`Start Forward`, `Hard Refresh`), sentence case (`Review & save…`, `Roll back to this revision…`). Generic confirm labels: `Delete` on a pod where every other dialog names the object (`Delete namespace`, `Delete app + resources`).
- **Principle.** Nielsen 4 (consistency); the frontend-design skill's rule that an action keeps one name.
- **Fix (exact copy).** Sentence case, sans (not mono) for word labels: `Cancel`, `Edit`, `Copy`, `Copy neat`, `Stop`, `Start forward`, `Hard refresh` (both `ResourceDetailPanel.tsx:1928` "Hard" and `:2939` "Hard Refresh"), `Previous`, `Follow`. Confirm labels: `DetailPanel.tsx:763` and `PodTable.tsx:965` `confirmLabel="Delete pod"`. The `.* regex`, `Aa case` and `{} JSON` toggles stay mono because they are literal tokens. Sites: `DetailPanel.tsx:379, 408, 1441, 1449, 1480, 1487`, `LogViewer.tsx:210, 213`, `ResourceDetailPanel.tsx:1904, 1928, 2939`.
- **Rule.** Write dialogs say "Merge", never "Apply": none of these strings contain it.

### 3.4 Pod findings (POD)

#### POD-1. `AccordionHeader` remounts on every render (Critical, Implement now, S)

- **Where.** `DetailPanel.tsx:533-549`. `const AccordionHeader = (...) => (<button …>)` is declared inside `DetailPanel`, then used as `<AccordionHeader …/>` at `:1044, 1179, 1210`.
- **Problem.** A component declared inside a render function is a new component type on every render, so React unmounts and remounts it. Activating ENV, MOUNTS or PROBES changes state, the panel re-renders, the focused button is replaced, and focus drops to `<body>`: a keyboard user starts again from the top after every toggle. The button also has no `aria-expanded`. The same remount happens on any poll-driven re-render of the panel.
- **Principle.** WCAG 2.4.3 Focus Order, 4.1.2.
- **Fix.** Move it to module scope, taking `open` and `onToggle` as props, and expose the state:
  `function AccordionHeader({ label, count, open, onToggle, controls }: { label: string; count: number; open: boolean; onToggle: () => void; controls: string }) { return (<button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} className="flex items-center gap-1.5 w-full min-h-7 py-1.5 mt-2 text-left border-t border-edge-raw/40 hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"><span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold flex-1">{label}</span><span className="mono text-[10.5px] text-mute">({count})</span><ChevronRight size={12} aria-hidden className={`text-mute transition-transform ${open ? "rotate-90" : ""}`} /></button>); }`.
  Call sites: `<AccordionHeader label="ENV" count={…} open={isOpen(c.name, "env")} onToggle={() => toggleSection(c.name, "env")} controls={`acc-${c.name}-env`} />`, and give each body wrapper (`:1051, 1186, 1217`) `id={`acc-${c.name}-env`}` (`-mounts`, `-probes`). Container names are unique per pod.
- **Rule.** None. Manual: Tab to ENV, Enter; the panel opens and focus stays on the header; `aria-expanded` flips.

#### POD-2. Overview shows data the app does not have (Significant, Defer: Q2, S)

- **Where.** `DetailPanel.tsx:803` `<KV k="Service account" v="default" />` (hard-coded). `:819-837` Conditions: `Initialized = status !== "Pending"`, `Ready = status === "Running"`, `ContainersReady = status === "Running"`, `PodScheduled = node !== "—"`. The `Pod` type (`types/k8s.ts:133-158`) has no `service_account` and no `conditions`.
- **Problem.** A Running pod whose readiness probe fails reads "Ready: True" next to a header that says `0/1 ready`. A pod using any service account other than `default` reads "default". Showing an invented fact in a diagnostic tool is worse than showing nothing (Nielsen 5 prevent errors, 9; the CLAUDE.md doc-vs-code rule applies in spirit).
- **Fix (recommended, needs Q2).** Remove the Service account row. Derive `Ready` and `ContainersReady` from the ready fraction: `const [r, t] = pod.ready.split("/").map(Number); const allReady = t > 0 && r === t;`, keep Initialized and PodScheduled as they are, and caption the card "From the pod's phase and ready count." (`text-[11px] text-mute`, under the title). Real values need a Rust change (`service_account`, `conditions` on `Pod`); that is a separate run.
- **Rule.** None.

#### POD-3. The pod status vocabulary has drifted between two files (Significant, Implement now, S)

- **Where.** `DetailPanel.tsx:37-58` has five entries (Running, Pending, CrashLoopBackOff, Terminating, Succeeded) and falls back to `STATUS_MAP["Running"]` (green). `PodTable.tsx:12-35` has seven (adds ImagePullBackOff and Unknown) and falls back to a neutral Unknown. The backend (`pods.rs:208-229`, `pod_status`) returns `Terminating`, `CrashLoopBackOff`, `ImagePullBackOff`, `Pending`, or the Kubernetes phase: `Running`, `Pending`, `Succeeded`, `Failed`, `Unknown`.
- **Problem.** In the panel a pod in `ImagePullBackOff` is orange in the table and **green** in the panel header; `Failed` and `Unknown` are green in the panel and neutral in the table. The status pill is the one element the header exists to show.
- **Principle.** Nielsen 2 (match the real world), 4 (consistency), 5; WCAG 1.4.1 (the word is there, but the colour says the opposite).
- **Fix.** New `src/utils/podStatus.ts` exporting `POD_STATUS_STYLE: Record<string, { dot: string; text: string; bg: string; ring: string; pulse: boolean }>` and `podStatusStyle(status: string)`; both `StatusPill` components use it and the local maps are deleted. Entries: the seven in `PodTable.tsx:12-20` plus `Failed: { dot: "bg-bad", text: "text-bad", bg: "bg-bad/10", ring: "ring-bad/30", pulse: false }`. Fallback (unknown strings): `{ dot: "bg-mute", text: "text-mute", bg: "bg-surface-tint/5", ring: "ring-edge", pulse: false }`. `Unknown` uses the same neutral style (not `dim`, X-2). Add a pure test `podStatus.test.ts`: every status the backend emits maps to a defined style, and an unknown string returns the neutral one. Extend `PodStatus` (`types/k8s.ts:567`) with `"Failed"` and add it to `STATUSES` (`PodTable.tsx:93`) so failed pods can be isolated.
- **Rule.** None.

#### POD-4. Events and YAML tabs hide load errors, and Events lacks what the generic tab has (Significant, Implement now, M)

- **Where.** `DetailPanel.tsx:551-553` (`usePodEvents` destructured as `data, isLoading` only), `:1336-1368` (the Events body), `:554-556` (`useResourceYaml`, no `error`), `:564`.
- **Problem.** A failed events or YAML request renders "No events found" or a blank YAML view, so an error looks like an empty result (Nielsen 9). Severity is shown by colour only (`:1353-1356`: a dot and the reason colour; the word "Warning" is never present), WCAG 1.4.1. The generic `EventsTabContent` (`ResourceDetailPanel.tsx:2438-2559`) already has loading, error with Retry, the empty state with the one-hour note, a Warnings-only filter, a glyph plus the word for severity, and the event count, none of which the Pod tab has.
- **Fix.**
  - Events: move `EventsTabContent` to `src/components/EventsTabContent.tsx` (exported; `ResourceDetailPanel.tsx` imports it) and render it in the Pod panel in place of `:1337-1367`: `<EventsTabContent events={podEvents} isLoading={eventsLoading} error={eventsError} onRetry={() => void refetchEvents()} kind="Pod" scopedToKind={false} />`. `scopedToKind` is **false** because `get_pod_events` filters by object name and namespace only (`cluster_info.rs:179-182`), and the "Its pods and ReplicaSets have their own events" sentence is wrong for a Pod. Destructure `error: eventsError, refetch: refetchEvents` from `usePodEvents`. The moved component also takes the X-2 and X-7 sweeps.
  - YAML: destructure `error: yamlError, refetch: refetchYaml`; when `yamlError && !yamlLoading` render, in place of the `YamlFind`: `<div role="alert" className="py-12 flex flex-col items-center gap-3 text-center"><p className="text-[13px] text-bad wrap-break-word max-w-full">Couldn&apos;t load YAML: {(yamlError as any)?.message ?? String(yamlError)}.</p><button type="button" onClick={() => void refetchYaml()} className="h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">Retry</button></div>` (same shape and copy pattern as `ResourceDetailPanel.tsx:2496-2507`).
- **Rule.** Pod YAML is not a Secret; no reveal or masking rule applies.

#### POD-5. Delete pod swallows a failed delete (Significant, Implement now, S)

- **Where.** `DetailPanel.tsx:765-769` (`deletePod.mutate(…); setConfirmDeletePod(false); onClose();`) and `PodTable.tsx:967-971` (`mutate`, then `setRowDeleteTarget(null)`).
- **Problem.** The dialog closes before the request resolves. An RBAC denial, a read-only backstop refusal or a network error is never shown, and the panel has already closed. Restart in the same panel does it correctly (`DetailPanel.tsx:743-751`: `await`, catch, `status`). Nielsen 1, 9.
- **Fix.** Panel: add `const [deleteError, setDeleteError] = useState("")`; `onConfirm={async () => { setDeleteError(""); try { await deletePod.mutateAsync({ context, namespace: pod.namespace, podName: pod.name }); setConfirmDeletePod(false); onClose(); } catch (e) { setDeleteError((e as any)?.message ?? String(e)); } }}`; `status={deleteError ? { tone: "error", text: deleteError } : null}`; `onCancel` also clears the error; `confirmLabel={deletePod.isPending ? "Deleting…" : "Delete pod"}`. Table: the same with `rowDeleteError`; the dialog stays open on error. The verbatim backend message is shown, as everywhere else.
- **Rule.** `ConfirmModal` keeps `contextLabel`, `contextColor`, `context`; the write stays `invokeWrite` through `useDeletePod`.

#### POD-6. Pods table: status filter has no counts, and a not-ready Running pod looks fine (Significant, Implement now, S)

- **Where.** `PodTable.tsx:145-157` (status buttons), `:520` (Ready cell), `DetailPanel.tsx:664-666` (header summary line).
- **Problem.** To learn how many pods are CrashLoopBackOff the user clicks and counts. A `Running` pod with `0/1` ready is green in the status pill and `mute` in the Ready cell, the same as `1/1`, though "Running but not ready" is the most common reason to open the panel.
- **Fix.**
  - Counts: compute `statusCounts` from `pods` after the label and search filters but before the status filter, and render `<span className="ml-1 mono text-[10.5px] tabular-nums text-mute">{n}</span>` inside each status button (no count on "All"). A zero count stays clickable.
  - Selected state: `status === s ? "bg-surface-tint/8 text-ink ring-1 ring-edge-strong" : "text-mute hover:text-ink"`. The ring adds the state that the `/8` tint (nearly invisible in light) does not, so it is not carried by text colour alone. Add `aria-pressed` (X-5).
  - Not-ready: `const notReady = pod.status === "Running" && (() => { const [r, t] = pod.ready.split("/").map(Number); return t > 0 && r < t; })();` Ready cell class `${notReady ? "text-warn" : "text-mute"}` and `title={notReady ? "Running but not ready" : undefined}`. Header summary line (`DetailPanel.tsx:664-666`): the `{pod.ready} ready` part gets the same `text-warn` and the whole line becomes `text-mute`. The words "not ready" appear in the `title`, so colour is not the only carrier (the fraction itself is the text).
- **Rule.** None.

#### POD-7. CPU and Memory columns do not say whether they show usage or request (Significant, Implement now (label) / Q3, Q4, M)

- **Where.** `PodTable.tsx:540-565` (the `Bar` label and fill), `:37-60`, `:475-486` (`cpuLim = pod.cpu_lim ?? 500`, `memLim = pod.mem_lim ?? 512`), `:901-902` (headers); `DetailPanel.tsx:183-184` (the same invented defaults in the Metrics fallback).
- **Problem.** Without metrics the bar and the number show the **request** (`pods-logs.md`: "without them by request") in exactly the style of usage. A request number reads as consumption (Nielsen 1, 2). Separately, a pod with no limit gets an invented 500 m / 512 Mi denominator, so a pod using 800 m with no limit shows a full red bar.
- **Fix (now).** When `!hasMetrics`, suffix the label: `${cpuM}m req`, `${memMi}Mi req`, and raise the `Bar` label `minWidth` from 44 to 56 (`PodTable.tsx:57`). Give the CPU and Memory `Th` a `title`: "Usage from metrics-server. Shows the request when metrics are not available." Also fix the stray 10 and 9.5 px sizes per X-7.
- **Questions.** The invented denominator is Q3. Sorting by CPU or Memory (there is no sort on these columns, and "what is using the most" is the first triage question) is Q4.
- **Rule.** None.

#### POD-8. Pods table: empty and filtered states (Significant, Implement now, S)

- **Where.** `PodTable.tsx:912-923` (empty), `:139-141` (count line).
- **Problem.** With a status or label filter on and no matches, the empty state says "No pods found" and "Try selecting a different namespace or status filter" but offers no control; the user has to find the Labels menu again (Nielsen 3, 7). The count line reads "12 in all" when the namespace is `all`.
- **Fix.**
  - Count line: `{… } in {ns === "all" ? "all namespaces" : ns}`.
  - Empty state, when `status !== "All"` or any label is active, add under the message: `<button type="button" onClick={() => { setStatus("All"); setActiveLabels({}); }} className="h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">Clear status and label filters</button>`. The search text is the TopBar's; when `search` is set the existing line `No pods matching "…"` stays, and the user clears it with the TopBar clear control.
  - Hint colour per X-2 (`text-mute`).
- **Rule.** None.

#### POD-9. Port-forward form has no labels and no validation (Significant, Implement now, S)

- **Where.** `DetailPanel.tsx:341-420` (`:389-404` inputs, `:377-382` stop, `:405-411` start).
- **Problem.** The two number inputs are labelled by sibling `<span>`s that are not associated (`:392`, `:399`), so a screen reader hears "spin button" twice. `parseInt` of an empty or out-of-range value goes to the backend (`NaN`). The stop button is 20 px high and its name is the bare word "stop".
- **Principle.** WCAG 1.3.1, 3.3.2 (labels), 3.3.1 (error identification); Nielsen 5.
- **Fix.** `<label htmlFor="pf-pod-port" className="text-[11px] text-mute">Pod port</label>` and `id="pf-pod-port"` on the input; the same with `pf-local-port` and "Local port". Inputs: `type="number" min={1} max={65535} inputMode="numeric"`, `aria-invalid={!ok || undefined}`. `const valid = (v: string) => /^\d+$/.test(v) && +v >= 1 && +v <= 65535;` The Start button is `aria-disabled` with `disabledAttrs("Enter ports from 1 to 65535.")` while either is invalid, its handler bails out, and its label is "Start forward". Stop button: `h-6 px-2 rounded-sm text-[11px] text-mute hover:text-bad outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70` with the label from X-3. Active-forward row text per X-2.
- **Rule.** Port-forward stays unconfirmed by design (`ui.md`).

#### POD-10. A blocked Shell tab does nothing when clicked (Significant, Defer: Q5, S)

- **Where.** `DetailPanel.tsx:781` (`if (t === "Shell" && shellReason) return;`), `:679` (Exec shell header button), `:968` (the Containers tab `exec` link). `ShellTab.tsx:137-153` already renders the read-only explanation.
- **Problem.** In read-only mode the three controls are `aria-disabled` with the reason only in a `title` and a hidden description. A click or Enter is a silent no-op, and a sighted keyboard user never sees the reason. The explanation card that was written for this state (`ShellTab.tsx:137-153`) is unreachable except when read-only is switched on while the Shell tab is open.
- **Principle.** Nielsen 1, 5; the agent rule "disabled controls show their reason".
- **Fix (recommended).** Let the three controls navigate to the Shell tab, which already shows "{reason}" in its body, and remove the bail-outs at `:679` and `:781` and the `exec` link's. This conflicts with the `ui.md` DISABLE-PRECEDENCE sentence "the click handler must still bail out", so it needs Q5.
- **Rule.** `READ_ONLY_BLOCKS_SHELL` stays; no shell is started.

#### POD-11. Overview and Summary repeat each other (Significant, Defer: Q6, S)

- **Where.** `DetailPanel.tsx:795-839` (Overview: Metadata, Labels, Conditions) and `:424-471` (`SummaryTab`: Status, Labels, Container States).
- **Problem.** Labels appear twice with two different chip styles (neutral `ring-edge` chips against accent chips); Phase, Ready, Node, Restarts and Age repeat the header line and the Metadata card. Nine tabs, two of which overlap, make "where is X" a guess (Nielsen 6, 8). Plan constraint: prefer in-panel expansion over a new tab, so the fix removes, it does not add.
- **Fix (recommended, needs Q6).** Delete the `Status` card (`:429-436`) and the `Labels` card (`:438-452`) from `SummaryTab`; keep `Container States`. Labels stay on Overview with the neutral chip style.
- **Rule.** None.

#### POD-12. The `logs` link on a container card ignores the container (Significant, Implement now, S)

- **Where.** `DetailPanel.tsx:974` `<button onClick={() => setTab("Logs")} …>`, next to `exec` at `:968` which does `setSelectedContainer(c.name)`. `logPick` and `setLogPick` exist (`:514`, passed to `LogViewer` at `:1378-1379`).
- **Problem.** Clicking `logs` on the `sidecar` card opens the Logs tab on the default container, so the user reads the wrong container's logs and may not notice.
- **Fix.** `onClick={() => { setLogPick(c.name); setTab("Logs"); }}`. Names match: `logContainers` includes debug containers and init containers under their raw names, which is what `LogViewer` expects. Also make both links reachable targets: `className="h-6 px-1.5 -mx-1.5 rounded-sm flex items-center gap-1 hover:bg-surface-tint/6 hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"` with `aria-label={`Open shell in ${c.name}`}` and `aria-label={`Open logs for ${c.name}`}` (the links are 14 px high today).
- **Rule.** None.

#### POD-13. Containers tab and log toolbar: density (Polish, Implement now, S)

- **Where.** `DetailPanel.tsx:916` (`init` badge at 9 px), `:903` (the nested `normal-case` helper at 9.5 px), `:980-998` (three levels of eyebrow inside one card); `LogViewBar.tsx:153` (the "View" eyebrow plus "Filters loaded lines", which the group's own `aria-label` already says), `:169` (a permanent 10 px note under the filters).
- **Problem.** The log toolbar is up to five rows of chrome before the first log line, and one of them is a note shown whether or not a filter is set (Nielsen 8).
- **Fix.** Containers: sizes per X-7; keep two eyebrow levels at most (container name row, then ENV / MOUNTS / PROBES). `LogViewBar.tsx`: delete the `View` eyebrow row `:153`; show the `:169` note only while `filtering` is true (`{filtering && <p …>}`).
- **Rule.** Log filters never touch the stream (`pods-logs.md`); this is layout only.

#### POD-14. Copy in the YAML and Metrics tabs (Polish, Implement now, S)

- **Where.** `DetailPanel.tsx:1435` "Editing — changes apply to the cluster"; `:282-284` "Metrics server unavailable — showing resource requests"; `:370` "No active port-forwards for this pod".
- **Problem.** "apply" is the verb the copy rules reserve against ("Merge, never Apply"), and the sentence is also inaccurate: nothing is sent until Review and save, which opens a dry-run preview gate. Em dashes and mono in sentences (X-7).
- **Fix (exact copy).** `Editing. Nothing changes until you review and save.` (sans, `text-[11px] text-warn`); `Metrics server isn't available. Showing resource requests.` (sans, `text-[11px] text-warn`); `No active port-forwards for this pod.` (`text-mute`).
- **Rule.** Copy rules in the agent brief.

#### POD-15. The pulsing status dot ignores reduced motion (Polish, Implement now, S)

- **Where.** `src/index.css:320-326` (the `prefers-reduced-motion` block lists `.animate-spin`, `.slide-in` and `.fade-in` only); `animate-blink` is used by the Pod status pill (`PodTable.tsx:28`, `DetailPanel.tsx:51`) for Pending, CrashLoopBackOff, ImagePullBackOff and Terminating, and the Terminating pill on the new Namespaces page (Part B) reuses it.
- **Problem.** The dot pulses forever (`blink 1.6s infinite`) for anyone who asked the OS for less motion, and a long list of Pending pods pulses together. WCAG 2.3.3 Animation from Interactions is AAA, but 2.2.2 Pause, Stop, Hide (A) applies to blinking that starts automatically and runs more than 5 seconds next to other content; the app's own rule (`ui.md` Manual Refresh) already honours reduced motion for the other animations.
- **Fix.** Add `.animate-blink` to the selector list in the reduced-motion block: `.animate-spin, .animate-blink, .slide-in, .fade-in { animation: none; }`. The dot is then a steady dot; the status word still carries the state.
- **Rule.** None.

### 3.5 ArgoCD findings (ARGO)

#### ARGO-1. Sync and Health are collapsed into one word (Critical, Implement now, M)

- **Where.** Header chip, `ResourceDetailPanel.tsx:3262-3266`: `{healthy ? "Healthy" : "Degraded"}`, where `healthy = isHealthy(resource)` and the argocd case (`:1705`) is `health_status === "Healthy" && sync_status === "Synced"`. Resources tab, `:1812-1823` (counts and filters) and `:1850-1893` (chips). Reference that gets it right: `ArgoCdHealthStrip` in `ResourceViews.tsx:1730-1750`, where "Healthy" is `health_status === "Healthy"` alone (`argocd.md`).
- **Problem.** A Healthy but OutOfSync Application, a Progressing one, a Suspended one and a Missing one all read **Degraded in red**, directly above an Overview that shows "● Healthy" and "↑ OutOfSync" (`:1392-1397`): the panel contradicts itself. Hand-edited drift, which is normal and healthy, reads as an outage. In the Resources tab the chip "N Healthy" means Healthy **and** Synced, so a Healthy but OutOfSync resource is in no Healthy count; "N Degraded" counts Degraded **and** Missing; Suspended and Unknown appear in no chip. The CLAUDE.md hard rule is "Sync and Health stay independent".
- **Principle.** Nielsen 2 (match the real world), 5, 1; hard rule (`argocd.md`).
- **Fix, header.**
  1. Extract the maps at `:1366-1384` into module scope as `argoHealthPill(status)`, `argoSyncPill(status)` and `argoPhasePill(phase)` returning `{ label, icon, cls }`, so the header, Overview and Resources tab share one definition.
  2. For `resource.kind === "argocd"` render two chips in place of `:3262-3266`, Health then Sync: `<span className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11px] font-medium ring-1 ${hp.cls}`} title="Health status"><span aria-hidden>{hp.icon}</span><span className="sr-only">Health: </span>{hp.label}</span>` and the Sync twin (`title="Sync status"`, `Sync: `). Other kinds keep the existing chip (the Namespaces page adds a second per-kind override, 4.4.5; do both as one `statusChip(resource)` function returning `{ label, tone }`).
  3. Overview (`:1391-1406`): remove the Health and Sync pills (now in the header) and keep the operation pill, relabelled so it is not mistaken for a third status: `Last operation: {a.operation_phase}`.
  4. `isHealthy` (`:1705`): `case "argocd": return resource.item.health_status === "Healthy";` so the function no longer folds Sync in (nothing else reads it for Applications).
- **Fix, Resources tab (`:1749-1893`).** Two independent single-select groups. State: `healthFilter: "all" | "Healthy" | "Progressing" | "Degraded" | "Missing" | "Suspended" | "Unknown"` and `syncFilter: "all" | "Synced" | "OutOfSync"`. `displayed = resources.filter(r => (healthFilter === "all" || r.health_status === healthFilter) && (syncFilter === "all" || r.sync_status === syncFilter))`. Counts are always taken from the full list and are per status, so a Missing resource is counted under Missing, not Degraded. Render a `role="group" aria-label="Health"` row (chips for Healthy, Progressing, Degraded, Missing, and Suspended and Unknown only when their count is above 0) and a `role="group" aria-label="Sync"` row (Synced, OutOfSync), each chip `aria-pressed`, the label being the status word and the count, e.g. `Degraded 2` (glyph `aria-hidden`). Chip classes follow X-2 (full-strength text; active `bg-X/20 ring-X/40`, inactive `bg-X/10 ring-X/20`). The `sortScore` order (Degraded and Missing, then OutOfSync, then Progressing) is unchanged. The tab-strip badge (ARGO-12) keeps counting Degraded or Missing, now named.
- **Q15 (copy meaning).** Every other kind keeps the generic chip, and its fallback word "Degraded" is also loose for a Pending PVC or a NotReady node. Q15 asks whether to rename it "Not healthy" for those kinds; not part of this fix.
- **Rule.** Hard rule honoured: Sync and Health independent; health still computed from K8s `.status` (nothing changes in Rust).

#### ARGO-2. The primary action is below the fold and the panel does not say if auto-sync is on (Significant, Implement now, S)

- **Where.** `ResourceDetailPanel.tsx:3356-3373` (Overview renders the field card, then `ArgoCdActionBar`), `:1430-1437` (the KV list), `:2872-2957`.
- **Problem.** The reason to open an Application panel is usually "is it in sync, and if not, sync it". The Actions card is the last block of the Overview scroll, under 8 to 10 field rows and the commit box; on a short window it is off screen. The panel also never says whether `spec.syncPolicy.automated` is on (`ArgoCdApp.auto_sync` exists and is read only by History, `:3463`), which decides whether a manual Sync matters.
- **Principle.** Nielsen 7, 6 (recognition over recall); `frontend-design` ("one place for each job").
- **Fix.** In the Overview tab render `ArgoCdActionBar` **before** the field card (move `:3363-3371` above `:3358-3362`) and change its wrapper `px-4 pb-4 pt-3` (`:2873`) to `px-4 pt-4`. Add one row after "Target revision" (`:1434`): `<KV k="Sync policy" v={a.auto_sync ? "Automated" : "Manual"} mono={false} />`.
- **Rule.** Sync and refresh semantics are untouched.

#### ARGO-3. Sync options: toggles without state, and consequences hidden until chosen (Significant, Implement now (structure) / Q10 (wording), S)

- **Where.** `ResourceDetailPanel.tsx:2877-2899`.
- **Problem.** Prune, Dry run and Force are `<button>`s whose pressed state is only a colour change (no `aria-pressed`, WCAG 4.1.2, 1.4.1); off they are `text-dim` (X-2). What each option does appears **only after** it is switched on (`:2894`), which is backwards for Prune and Force: the user should read "removes resources" before choosing it (Nielsen 5, 6).
- **Fix.** Replace the three buttons with native checkboxes, as the Map kind filter does (`accent-accent h-3.5 w-3.5`), each with its help line always visible:
  `<fieldset className="flex flex-col gap-1.5"><legend className="sr-only">Sync options</legend>{OPTIONS.map(({ key, label }) => (<label key={key} className="flex items-start gap-2 text-[12px] text-ink cursor-pointer"><input type="checkbox" checked={syncOpts[key]} onChange={() => setSyncOpts(v => ({ ...v, [key]: !v[key] }))} className="mt-0.5 h-3.5 w-3.5 accent-accent" /><span>{label}<span className="block text-[11px] text-mute">{SYNC_OPT_HELP[key]}</span></span></label>))}</fieldset>`.
  Help copy (sentence case, no "applied"): Prune "Removes resources that are no longer in git." ; Dry run "Simulates the sync. Nothing is changed." ; Force "Overwrites resources that conflict with git." (Prune and Force wording unchanged apart from case and the full stop; Dry run drops "no changes applied".) The existing prune warning line (`:2900-2910`) stays below, in sans (X-7).
- **Q10.** The Force sentence is the old wording kept. `argocd.md` says to verify sync semantics against upstream source, not memory, so I did not rewrite it.
- **Rule.** `syncOpts` and the `.operation` patch are unchanged; "Merge" not "Apply" holds.

#### ARGO-4. In read-only mode the action buttons look enabled and do nothing (Significant, Implement now, S)

- **Where.** `ResourceDetailPanel.tsx:2913-2940` (Sync, Refresh, Hard Refresh), `:1906-1929` (Resources tab Refresh and Hard), `:2915-2916`, `:2925-2926`.
- **Problem.** They spread `disabledAttrs(actionReason)`, which sets `aria-disabled`, a description and a `title`, but the class lists only style `disabled:` (the DOM `disabled` attribute, set only while busy), so under read-only they look fully active; a click returns silently at `:2835, :2847`. DetailPanel and PodTable add `opacity-50 cursor-not-allowed` per site; these do not. Nielsen 1, 5; "disabled controls show their reason".
- **Fix.**
  - Append `aria-disabled:opacity-50 aria-disabled:cursor-not-allowed` to the class lists at `:2917, :2926, :2934, :1911, :1923` (and `:1901` stays as is). This is the pattern already used at `LogViewer.tsx:213` and `ResourceDetailPanel.tsx:2731`.
  - Show the reason where the user is looking: under the button row, `{actionReason && <p className="text-[11px] text-mute">{actionReason}</p>}` (the standard `READ_ONLY_REASON`).
  - Replace `disabled={busy}` with `aria-disabled` plus a bail-out (`if (busy) return` at the top of each handler) so a pending request does not blur the focused button: `{...disabledAttrs(actionReason)} aria-disabled={busy || !!actionReason || undefined}`.
- **Rule.** Disabled with a reason, never hidden: honoured.

#### ARGO-5. Action feedback disappears, is not announced, and errors vanish in 6 seconds (Significant, Implement now, S)

- **Where.** `ResourceDetailPanel.tsx:2812` (`feedback: string`), `:2823-2832`, `:2859-2868` (`setTimeout(…, 4000)` and `6000`), `:2949-2956` (a plain `<p>`, tone decided by `feedback.startsWith("Error")`), `:1933-1938` (Resources tab: success and error paragraphs without roles).
- **Problem.** An error such as an RBAC refusal or "operation already in progress" disappears after 6 s, before the user has read it or copied it, and nothing is announced to a screen reader (WCAG 2.2.1 Timing Adjustable, 4.1.3 Status Messages, 3.3.1). The tone is derived from the text.
- **Fix.** `feedback` becomes `{ tone: "ok" | "error"; text: string } | null`. Success: `setFeedback({ tone: "ok", text: msg })` and an effect clears it after 4 s with a cleanup (`useEffect(() => { if (feedback?.tone !== "ok") return; const t = window.setTimeout(() => setFeedback(null), 4000); return () => window.clearTimeout(t); }, [feedback])`). Error: no timer; it stays until the next action starts (`setFeedback(null)` at the top of `runSync` and `runRefresh`). Render `<p role={feedback.tone === "error" ? "alert" : "status"} className={`text-[11.5px] wrap-break-word ${feedback.tone === "error" ? "text-bad" : "text-ok"}`}>{feedback.text}</p>`. Error text: `Couldn't sync ${name}: ${message}` and `Couldn't refresh ${name}: ${message}` (the form History already uses, `:2765`). The dry-run hint at `:2954` keeps matching the backend text (`startsWith("Dry-run")`), now on `feedback.text`; `ponytail:` that is a string match on backend wording, noted, not changed. Resources tab: same roles; copy per ARGO-11.
- **Rule.** None.

#### ARGO-6. The "diff" button shows no diff, and its sentence points at things that do not exist (Significant, Defer: Q7, S)

- **Where.** `ResourceDetailPanel.tsx:1996-2001` and `:2064-2069` (a `text-[9.5px] text-warn/70 underline` button, "diff" or "hide"), `:2014-2021` and `:2082-2089`.
- **Problem.** The label promises a diff; the expansion is a fixed sentence: "OutOfSync — this resource differs from git. Open the YAML tab to view live manifest, or click Sync to reconcile." An Application panel has **no YAML tab** (`tabsFor`, `:2777`, and `ui.md`: ArgoCD Applications have none), and Sync is on the Overview tab. The button is 9.5 px and `warn/70` (3.17:1 light), has no `aria-expanded`, and its name is "diff" for every row (Nielsen 2, 4; WCAG 4.1.2, 1.4.3).
- **Fix.** Option A (recommended): delete the expander, the `expandedOutOfSync` state and both expansion rows; the OutOfSync pill and the row's open action already say it. Option B: keep it, relabel `details`, add `aria-expanded` and `aria-label={`${isExpanded ? "Hide" : "Show"} sync details for ${r.kind} ${r.name}`}`, size 10.5 px, `text-warn`, and the sentence `This resource differs from git. Open it to see the live manifest, or sync the application from Overview.`
- **Rule.** None.

#### ARGO-7. History: the full message is never shown, the chevron needs a hover, and nothing marks the live revision (Significant, Implement now (a, b) / Q11 (c), S)

- **Where.** `ResourceDetailPanel.tsx:2695-2737`.
- **Problem.** (a) The commit message is `truncate` in the row (`:2711`) and the expanded block shows only the author and an ISO time, so the message can never be read in full. (b) The expand chevron is `opacity-0 group-hover:opacity-100` (`:2712`): invisible to a keyboard user and to anyone before hovering. (c) A rollback list with no "this is the live one" marker invites rolling back to the revision already running (Nielsen 1, 6).
- **Fix.** (a) At the top of the expanded block: `<p className="text-[12px] text-ink whitespace-pre-wrap wrap-break-word">{entry.message || "No commit message recorded."}</p>`. (b) Replace the `▲ ▼` span with `<ChevronRight size={12} aria-hidden className={`shrink-0 text-mute transition-transform ${expanded === entry.id ? "rotate-90" : ""}`} />`, always visible; the button already has `aria-expanded`. The header row (`:2697-2701`) takes the X-2 and X-7 sweeps. (c) Q11.
- **Rule.** Rollback stays keyed by `entry.id`, the backend still reads revision and source from the live object, and the dialog is unchanged.

#### ARGO-8. A failed operation shows no reason (Significant, Defer: Q8, M, needs Rust)

- **Where.** `ResourceDetailPanel.tsx:1398-1405` (the operation pill); `types/k8s.ts:480-501` (`ArgoCdApp` has `operation_phase` and no `operation_message`).
- **Problem.** An Application whose last sync failed shows a red "Failed" pill and nothing else. Why it failed (a hook failure, a conflict, a missing CRD) is the next thing the user needs, and it is in `status.operationState.message`.
- **Fix.** Needs a new field, so it is not a frontend-only fix: see Q8.
- **Rule.** Health is still computed from K8s `.status`, never the ArgoCD API; this would read `.status.operationState.message` from the same object.

#### ARGO-9. Force sync is a single click when typed-confirm is off (Significant, Defer: Q9, S)

- **Where.** `ResourceDetailPanel.tsx:2834-2844` (`handleSync`: only `prune` goes to a confirm; everything else goes through `guarded`, which confirms only while the cluster's typed-confirm guardrail is on); `ui.md` lists "ArgoCD Sync without prune" among the single-click writes by design.
- **Problem.** Force overwrites conflicting resources and is checked with one click and run with one click. Whether that is acceptable is a product call that `ui.md` made for plain Sync, not for Sync with Force.
- **Fix (recommended).** Treat Force like Prune: `if (syncOpts.prune || syncOpts.force) { setConfirmPrune(true); return; }`, with the dialog title and copy chosen by the options. Needs Q9, which also changes the `ui.md` "Single-click writes" sentence.
- **Rule.** Force stays `syncStrategy.hook.force` and the bulk path stays `force: false`.

#### ARGO-10. Status glyphs are read aloud, and two of them may render as emoji (Polish, Implement now, S)

- **Where.** `ResourceDetailPanel.tsx:1366-1384`, `:1772-1790`, `:1393, 1396, 1402, 1987-1988, 2007`; `ResourceViews.tsx:1677, 1683` (`healthIcon`, `syncIcon`).
- **Problem.** `●`, `✕`, `↻`, `?`, `⏸`, `✓`, `↑` are plain text next to the word, so a screen reader says "black circle Healthy" or "multiplication x Degraded". `⏸` (U+23F8) can render as a colour emoji in WKWebView. Nielsen 4; WCAG 1.1.1, 1.4.1 (the word is present, so colour is not the only carrier).
- **Fix.** Wrap each glyph in `<span aria-hidden>`. Replace `⏸` with the lucide `Pause` icon at `size={10}` `aria-hidden` (Needs visual check on macOS and Linux). Colours per X-2.
- **Rule.** None.

#### ARGO-11. Resources tab: refresh copy and labels (Polish, Implement now, S)

- **Where.** `ResourceDetailPanel.tsx:1894-1938`.
- **Problem.** "Hard" is not a word that says what it does; the title strings use em dashes; the success line "Refresh triggered — sync status will update within seconds." promises a time the same tab's tooltip contradicts ("≈3-min reconciliation lag otherwise"), is not a live region, and never clears.
- **Fix (exact copy).** Button label `Hard refresh`. Titles: `Refresh. Asks ArgoCD to re-check drift now; without it the check can lag by about 3 minutes.` and `Hard refresh. Asks ArgoCD to clear its cache and re-fetch from git.` Success: `<p role="status" className="text-[11px] text-ok">Refresh requested. ArgoCD updates the status when it finishes.</p>`, cleared after 4 s like ARGO-5. Error: `role="alert"`, `Couldn't refresh ${appName}: ${message}`, `text-bad`, sans.
- **Rule.** Refresh remains an annotation; Resources tab keeps its own Refresh and Hard refresh (`argocd.md`).

#### ARGO-12. Tab count badges (Polish, Implement now, S)

- **Where.** `ResourceDetailPanel.tsx:3333-3345`.
- **Problem.** The red count after "Resources" is a bare number in `bg-bad/80 text-on-accent text-[9px]`: nothing says what it counts, and white on that fill is 3.96:1 in dark with the blue accent (X-2). The neutral counts are `text-dim`.
- **Fix.** Neutral count: `<span className="ml-1 px-1.5 py-px rounded-full bg-surface-tint/8 text-[10.5px] text-mute">{n}<span className="sr-only"> resources</span></span>` (and `pods` for the Pods tab at `:3344`). Problem count: `<span className="ml-1 px-1.5 py-px rounded-full bg-bad/10 text-bad ring-1 ring-bad/30 text-[10.5px]" title="Degraded or missing">{n}<span className="sr-only"> degraded or missing</span></span>` (5.40 dark, 6.14 light).
- **Rule.** None.

#### ARGO-13. Long values are cut off with no way to read them (Polish, Implement now, S)

- **Where.** `ResourceDetailPanel.tsx:52-59` and `DetailPanel.tsx:60-67` (`KV` value `truncate`); `:1430-1437` (Repo, Path, Target revision, Dest cluster).
- **Problem.** A repository URL or a chart path loses its tail, which is the part that differs between repos, and there is no `title`. Nielsen 6; WCAG 1.4.10 (reflow) is fine, the information is not.
- **Fix.** `KV` gains `wrap?: boolean` and a `title={v}` on the value; `wrap` swaps `truncate` for `break-all` and `items-start`. Use `wrap` on Repo, Path, Target revision and Dest cluster. Key text colour per X-2.
- **Rule.** None.

### 3.6 Reviewed with no findings

- `TimelineTab.tsx` (the Events and Timeline tabs as they render for an Application): roving row keys, glyph plus word severity, `aria-pressed`, `role="status"` announcements, no `dim` text. This is the standard the fixes above aim at. The retention line is in `ui.md`.
- `ShellTab.tsx`, `DebugContainerDialog.tsx`, `MetricChart.tsx`, `WhoCanReachSection.tsx`: apart from three `text-dim` help lines in the debug dialog (`:139, 160, 163`, covered by X-2) and POD-10, they meet the bar.
- `ArgoCdActionBar`'s prune warning, the typed-confirm delete dialog for an Application (`:3767-3813`: radios named by a `radiogroup`, the confirm label follows the choice) and the rollback dialog are correct apart from X-2 colour (`:3801, 3808`).
- Not reviewed: `ConstraintsSection`, `ExplainCard` internals, `FieldManagers`, `YamlFind`, `YamlSaveGate`, `ConfirmModal`.

---

## 4. Part B: namespaces, the picker and the page

The user decided on 2026-10-28 (relayed by the coordinator), and plan section 1 is **reopened** because of it:

1. **Both surfaces.** (a) The TopBar namespace dropdown does picking and filtering only. (b) A new **Namespaces resource page** (sidebar nav item, table, detail panel, create, delete with a typed confirm) owns management. The sidebar namespace list goes away.
2. **No palette action** "Create namespace…". (A palette navigation row for the page is the normal nav entry every kind has; see 4.5.)
3. **Forbidden list:** show the forbidden state. No typed-name fallback.
4. **`kube-node-lease` is protected from delete** together with `default`, `kube-system` and `kube-public`. The delete control is **disabled with a reason, not hidden**.

This part specifies the UX. It is not a code contract: the tech lead re-plans from it. Section 4.2 lists what the design needs from the backend (flagged, not decided), and section 4.6 lists which parts of plan section 1 are void and which carry over.

### 4.1 Jobs and the minimal version

- **The picker's job:** change the scope of every namespaced list ("show me `payments`"), or find one in a long list ("was it `payments-staging`?"). One click from the breadcrumb, as today.
- **The page's job:** see every namespace and its state at a glance (which are Terminating, how old, how labelled); open one to read its labels, events and YAML; jump to its pods; create one; delete one on purpose.

**Minimal version.** The picker is the existing dropdown as a `Popover` with a filter field and one footer link. The page is the table and detail panel the app already has for every other cluster-scoped kind (`PVView` is the closest sibling), with one new kind `ns`. Create goes through the existing TopBar New and `⌘N` (the namespace form already exists in `ResourceCreator`). Delete reuses the Sidebar's typed confirm, moved verbatim.

**Skips (each is a later request).** Arrow-key navigation in the picker (the Map kind filter set the precedent, C-2) and in the table; per-namespace counts (pods, quota usage) in the table; a "deleting since" column; bulk delete; a guided label editor (labels are edited in the YAML tab for now); a quota summary; recent or pinned namespaces; a typed-name fallback when the list is forbidden (user decision 3); a palette create action (user decision 2).

### 4.2 What the two surfaces need from the backend (flags for the re-plan)

Plan section 1.1 said "No Rust change". The page cannot keep that: `list_namespaces` returns **names only** (`commands/namespaces.rs:7`), and the page needs state.

| Need | Used by | Today | Flag |
|---|---|---|---|
| Name list | picker, Map page, create invalidation | `list_namespaces -> Vec<String>`, query key `["namespaces", ctx]` | exists |
| Phase (`Active` or `Terminating`) | page Status column and pill, delete gate, picker tag | not returned | **Rust change.** Q16 |
| Created time (for Age) | page Age column | not returned | same |
| Labels | page Labels column, Summary tab | not returned (`get_resource_metadata` reads one object and has no `ns` arm) | same |
| Deletion timestamp | "Deleting for 3 m" on the Terminating pill | not returned | same |
| Conditions and `spec.finalizers` | "Why it is still deleting" card in the panel | not returned | optional Rust field. Q17 |

Adding `ns` as a kind touches the places `docs/claude/resource-types.md` lists, and `tsc` catches only some. For the re-plan so none is missed: the five silent tables (`get_resource_yaml` and `apply_resource_yaml` for the YAML tab, `gvk_for` as non-namespaced, `RESOURCE_QUERY_KEY`, `CLUSTER_SCOPED_KINDS`; `delete_resource` is **not** needed because delete keeps using `delete_namespace`), and `RESOURCE_LABELS`, `kindLabel`, `isHealthy`, the `OverviewContent` case (not caught by `tsc`: the panel renders blank), `EVENT_INVOLVED_KIND` (`Namespace`), `NAV_ITEMS` in the palette, `RBAC_RESOURCE` (`delete` on `namespaces`, fails open), the `get_resource_metadata` arm, and `canCompare` (recommended: leave eligible, so Compare and Field managers work). Verify by hand that the Events tab finds events about a cluster-scoped object; Kubernetes stores those in a namespace that is usually `default`.

**Cache key.** The picker, `MapPage` and `ResourceCreator`'s invalidation (`ResourceCreator.tsx:116-122`) all use `["namespaces", ctx]` for a list of names. One key cannot hold two shapes, so the clean answer is one rows query that every consumer reads (names derived from the rows). That is Q16.

**Delete** keeps `delete_namespace` with `invokeWrite` and its journal verb. Plan section 6's note (it uses `DeleteParams::default()`) stays out of scope.

### 4.3 Surface 1: the namespace picker (TopBar)

**Decision for the tech lead: should it carry a "Manage namespaces" link? Yes, recommended** (Q18 asks the user to confirm). Reasons: the sidebar list used to be where users found namespace management, so an in-context pointer removes the "where did it go" moment (Nielsen 6, 10); it costs one 32 px row at the bottom; it is navigation, so it is never disabled, in read-only mode or any other state. Not a write, so no guardrail applies. The sidebar item (4.4.1) stays the primary route.

**Retired from the previous draft of this part:** delete buttons, "New namespace…", the read-only note, and the three additive deviations that came with them. The picker has no writes now, so read-only mode does not change it.

#### 4.3.1 Wireframes

Closed (unchanged place in the breadcrumb):

```
▌ [● prod-eu ⌄] [Read-only] / [payments ⌄] / pods
                              ^ aria-label "Namespace: payments", visible text "payments"
```

Open (`Popover`, `absolute left-0 top-8`, 320 px):

```
▌ [● prod-eu ⌄] / [payments ⌄] / pods
                   ┌──────────────────────────────────────┐   w-80, rounded-lg, ring-edge2, shadow-xl
                   │ [⌕ Filter namespaces…              ] │   p-2, field h-7; focus lands here on open
                   ├──────────────────────────────────────┤
                   │    All namespaces                    │   row h-7, sans (a mode, not an identifier)
                   │ ✓  payments                          │   current: bg-accent/10, text-ink, check = accent
                   │    payments-old        Terminating   │   tag only when the phase is known
                   │    kube-system                       │
                   │    monitoring                        │   names mono 12 px, truncate + title
                   │    …                                 │   list scrolls: max-h-[min(18rem,50vh)] (about 10 rows)
                   ├──────────────────────────────────────┤
                   │ ↗  Manage namespaces                 │   h-8, mute, navigation; pinned
                   └──────────────────────────────────────┘
```

Filtering (the "All namespaces" row hides while the query is not empty; the count sits in the field):

```
                   │ [⌕ pay                         2 of 41] │
                   │ ✓  payments                           │
                   │    payments-old        Terminating    │
```

Forbidden list (decision 3: the state is shown; there is no typed-name box):

```
                   │ [⌕ Filter namespaces…                 ] │
                   │    All namespaces                      │
                   │ ✓  payments                            │   only if it is the current one
                   │ You don't have access to list          │   role="alert", text-mute
                   │ namespaces in this cluster.            │
                   │ Only the entries above can be selected.│   text-[11px] text-mute
                   │ [Retry]                                │
                   ├────────────────────────────────────────┤
                   │ ↗  Manage namespaces                   │
```

#### 4.3.2 Anatomy and classes

All colour classes are role tokens; no `dim` text. The trigger, the popover shell, the filter block, the list, the row, the select button, the selected marker, the labels and the status and announcement regions are exactly as follows.

| Part | Spec |
|---|---|
| Wrapper | `<div className="relative">` where `nsRef` was; trigger and `Popover` inside. |
| Trigger | `<button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Namespace: ${ns}`} className="group flex items-center gap-1 px-1.5 py-1 rounded-sm hover:bg-surface-tint/4 aria-expanded:bg-surface-tint/6 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">`. Text: `<span className="mono text-[12px] text-ink max-w-[28ch] truncate" title={ns}>{ns}</span>` (a 63-character name no longer pushes the breadcrumb). Chevron `ChevronDown size={12}` `text-mute` (was `text-dim`), `rotate-180` when open, `aria-hidden`. |
| Popover | `label="Namespaces"`, `className="left-0 top-8 w-80 max-w-[calc(100vw-2rem)] flex flex-col overflow-hidden"`. `Popover` supplies `absolute z-30 rounded-lg bg-panel ring-1 ring-edge2 shadow-xl outline-hidden`, `tabIndex={-1}` and the blur and Esc rules. Because of `overflow-hidden`, every focus ring inside is `ring-inset` (the filter field sits inside `p-2`, so its outer ring fits). |
| Filter block | `<div className="p-2 border-b border-edge">`. Search icon `Search size={12}` `absolute left-2 top-1/2 -translate-y-1/2 text-mute pointer-events-none` `aria-hidden`. Input `type="text" aria-label="Filter namespaces" placeholder="Filter namespaces…" spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off"`, `className="h-7 w-full pl-7 pr-16 rounded-md bg-surface-input ring-1 ring-mute/70 mono text-[12px] text-ink placeholder:text-mute placeholder:font-sans outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"`. The boundary `ring-mute/70` is option A of Q14. |
| Count in the field | While the trimmed query is not empty and the rows are loaded: `<span className="absolute right-2 top-1/2 -translate-y-1/2 mono text-[11px] tabular-nums text-mute" aria-hidden>{shown} of {total}</span>`. |
| Status for screen readers | `<div role="status" aria-live="polite" className="sr-only">`: `${shown} of ${total} namespaces` while the query is not empty, loaded and `shown > 0`; empty otherwise (the no-match line announces itself). Updated 400 ms after the last keystroke (the delay may be dropped; the status may not: WCAG 4.1.3). |
| List | `<ul className="max-h-[min(18rem,50vh)] overflow-y-auto overscroll-contain py-1">`, one `<li>` per row. Filter and footer sit outside the scroll area. |
| Row `<li>` | `className={`mx-1 flex items-center rounded-sm ${current ? "bg-accent/10" : "hover:bg-surface-tint/6 focus-within:bg-surface-tint/6"}`}`. Height `h-7` (28 px). |
| Select button | `<button type="button" aria-current={current ? "true" : undefined} className={`flex-1 min-w-0 h-7 pl-2 pr-2 flex items-center gap-2 rounded-sm text-left outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 ${current ? "text-ink" : "text-mute hover:text-ink"}`}>`: a fixed slot `<span className="w-3.5 shrink-0 flex justify-center" aria-hidden>{current && <Check size={12} className="text-accent" />}</span>`, the label, and the optional tag. |
| Selected marker | A check mark in a fixed slot, `bg-accent/10` and `aria-current`; not the old 6 px accent dot. Every row has the slot, so names align. |
| Label | "All" row: `<span className="text-[12px] truncate">All namespaces</span>` (sans; the value stays `"all"`). Others: `<span className="mono text-[12px] truncate" title={name}>{name}</span>`. |
| Terminating tag | Only when the rows carry a phase (Q16, Q20): `<span className="ml-auto shrink-0 text-[10.5px] text-purple" title="This namespace is being deleted.">Terminating</span>`. It says the word, so colour is not the only carrier. |
| Footer link | Only when the host passes `onManage`: `<div className="border-t border-edge"><button type="button" onClick={…} className="w-full h-8 px-3 flex items-center gap-2 text-[12px] text-mute hover:text-ink hover:bg-surface-tint/6 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"><ArrowUpRight size={12} aria-hidden />Manage namespaces</button></div>`. `ArrowUpRight` is the app's "go to the object" glyph. |
| State lines | `px-3 py-2 text-[11.5px] text-mute` (the error line `text-bad`), after the `<ul>` inside the scroll area. |

#### 4.3.3 States

| State | What shows |
|---|---|
| Closed | The trigger only. The body (and its query) mounts only while open. |
| Loading | Rows: "All namespaces" and the current row (the current namespace is "selected but missing" until the list is known). After them `<p role="status" className="flex items-center gap-2 px-3 py-2 text-[11.5px] text-mute"><Loader2 size={12} className="animate-spin" aria-hidden />Loading namespaces…</p>`. Typing still narrows the visible rows. The spinner stops under `prefers-reduced-motion` (existing CSS). |
| Loaded | Rows from `namespaceRows(names, ns, query)`; footer link. |
| Filtering, matches | Count in the field, polite status, "All namespaces" hidden (plan 1.5). |
| No match | `<p role="status" className="px-3 py-2 text-[11.5px] text-mute break-all">No namespace matches "{query.trim()}".</p>`. The field keeps focus. |
| Empty list (loaded, no error) | After the rows: `<p role="status" className="px-3 py-2 text-[11.5px] text-mute">No namespaces found.</p>`. |
| Error | `<div role="alert" className="px-3 py-2 flex flex-col gap-1.5"><p className="text-[11.5px] text-bad wrap-break-word">Couldn't load namespaces: {message}.</p><button type="button" onClick={() => void refetch()} aria-disabled={isFetching || undefined} className="self-start h-6 px-2 rounded-sm ring-1 ring-edge text-[11.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">{isFetching ? "Retrying…" : "Retry"}</button></div>`; `message` is verbatim (`(error as any)?.message ?? String(error)`). "All namespaces" and the current row stay usable. |
| Forbidden (`classifyReadError(message) === "no-access"`) | The same container and Retry, with `<p className="text-[11.5px] text-mute">You don't have access to list namespaces in this cluster.</p><p className="text-[11px] text-mute">Only the entries above can be selected.</p>`. No input box for a typed name (decision 3). |
| Selected but not listed | Shown as the second row, marked current (a launcher-set name, a failed list, or one just deleted). |
| Current is `all` | The "All namespaces" row has the check and `aria-current`. |
| Long list | The list scrolls; filter and footer stay. |
| Read-only | No change: the picker writes nothing. |
| Narrow window | `max-w-[calc(100vw-2rem)]`; list height `min(18rem, 50vh)`. |

#### 4.3.4 Copy

| Where | Text |
|---|---|
| Trigger name | `Namespace: {ns}` (`Namespace: all` for the all view; the visible `all` is contained in it, WCAG 2.5.3) |
| Panel name | `Namespaces` |
| Filter label / placeholder | `Filter namespaces` / `Filter namespaces…` |
| "All" row | `All namespaces` (value `"all"`) |
| Terminating tag | `Terminating`; title `This namespace is being deleted.` |
| Footer link | `Manage namespaces` |
| Loading / empty / no match | `Loading namespaces…` / `No namespaces found.` / `No namespace matches "{query}".` |
| Error | `Couldn't load namespaces: {message}.` and `Retry` (`Retrying…`) |
| Forbidden | `You don't have access to list namespaces in this cluster.` then `Only the entries above can be selected.` and `Retry` |
| Count | `{shown} of {total}` (visible); `{shown} of {total} namespaces` (announced) |

#### 4.3.5 Keyboard and focus

Focus rule (plan 1.6, kept): focus the trigger first, then close, then act (`setNs` or navigate).

| Key | Where | Behaviour |
|---|---|---|
| Enter, Space, click | trigger | Opens or closes; on open, focus moves to the filter. |
| Type | filter | Narrows the rows; letters never reach `r`, `⌘K` or `⌘N` (the `Popover` layer makes them inert and `isEditableTarget` ignores them). |
| Enter | filter | With a non-empty query, picks the first row. Empty query or no match: nothing. |
| Tab | in the panel | Filter, each row's select button, Manage namespaces. Tab out of the last control closes the panel (`Popover` blur rule). Shift+Tab from the filter reaches the trigger without closing. |
| Enter, Space | a row | Picks it, closes. The current row just closes. |
| Enter, Space | Manage namespaces | Focus rule, close, open the Namespaces page. |
| Esc | open | Closes only the panel; focus returns to the trigger. |
| Pointer outside | open | Closes it. |
| Up and down arrows | list | Not handled (skip). |

#### 4.3.6 ARIA

Trigger: button, `aria-haspopup="dialog"`, `aria-expanded`, name `Namespace: {ns}`. Panel: `role="dialog"` named `Namespaces` (from `Popover`), not modal. Filter: text input named `Filter namespaces`. List: `<ul>`/`<li>`, the current row's button `aria-current="true"`. Footer link: button, name is its text. State lines: loading, empty and no match `role="status"`; error and forbidden `role="alert"`. Count: one `role="status"` region; the visible count is `aria-hidden`. Icons `aria-hidden`.

#### 4.3.7 Contrast (dark / light; method in section 2)

| Use | Colours | Dark | Light | Needs |
|---|---|---|---|---|
| Row text | `text-mute` on panel; on hover tint | 5.91; 5.09 | 5.92; 5.25 | 4.5 |
| Current row text | `text-ink` on `bg-accent/10` (six accents) | 12.3 to 13.1 | 14.3 to 14.7 | 4.5 |
| Check icon | accent on `bg-accent/10` | 5.92 to 8.73 | 5.57 to 8.33 | 3 |
| Terminating tag | `text-purple` on panel; on `bg-accent/10`; on hover tint | 6.71; 5.81; 5.77 | 6.55; 5.64; 5.81 | 4.5 |
| Filter text, placeholder | `ink`, `mute` on `surface-input` | 14.59; 5.75 | 16.08; 5.62 | 4.5 |
| Field boundary | `ring-mute/70` vs panel | 3.53 | 3.11 | 3 (1.4.11); fill alone is 1.03 and 1.05 |
| Focus ring | `ring-accent/70` vs panel, worst of six accents | 3.95 | 3.35 | 3 |
| Footer link | `text-mute` on panel; on hover tint | 5.91; 5.09 | 5.92; 5.25 | 4.5 |
| State lines | `text-mute`, `text-bad` on panel | 5.91; 6.60 | 5.92; 7.15 | 4.5 |

### 4.4 Surface 2: the Namespaces page

#### 4.4.1 Where it lives

**Recommendation: the sidebar "Cluster" section, as its first row, above Nodes** (Q19). Namespaces are cluster-scoped objects, which is what that section holds (Nodes, Events, CRDs, Priority Classes, webhooks), and they are the scope frame for everything else, so they read first. Label `Namespaces`, icon `FolderTree` from `lucide-react` (`size={15}`; `Folder` if the installed version lacks it), the same `NavItem` as its siblings. The old Sidebar "Namespaces" section is deleted, which also removes a list that grew with the cluster and pushed the nav down on a 200-namespace cluster. The palette gets the same `NAV_ITEMS` row `Namespaces` (navigation only, decision 2 stands).

The breadcrumb reads `prod-eu / namespaces`. The picker is hidden on this page: a Namespace is a cluster-scoped object (it goes into `CLUSTER_SCOPED_KINDS`), and `viewHidesNamespacePicker` already follows that set, so the page is not filtered by the namespace you were viewing (the P8 rule in `TopBar.tsx`).

#### 4.4.2 Wireframes

Page:

```
▌ [● prod-eu ⌄] / namespaces                                   ⟳   [⌕ Search resources, names, labels…  ⌘ K]  [+ New ⌄]
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Namespaces  [41]                                                                                          [⚙]     │
│ (read-only strip when on)                                                                                          │
│ NAME ▲                       STATUS             AGE    LABELS                                                       │
│ cert-manager                 ● Active           412d   app.kubernetes.io/name=cert-manager                          │
│ default                      ● Active           412d   —                                                  [trash, dim]  │
│ kube-node-lease              ● Active           412d   —                                                  [trash, dim]  │
│ payments                     ● Active           86d    team=payments  env=prod  +2                          [trash]    │
│ payments-old                 ◐ Terminating      86d    team=payments                                        [trash, dim]  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
   [trash, dim] = delete button present and focusable, dimmed, reason in its title and description (revealed on row hover or focus)
```

Detail panel (kind `ns`, the standard resizable `ResourceDetailPanel`, tabs Overview, Summary, Events, YAML):

```
┌─────────────────────────────────────────────────────────┐
│ NAMESPACE · cluster-wide                [compare] [trash] [✕] │
│ payments-old                                              │
│ [◐ Terminating]  [Read-only]                              │
├─────────────────────────────────────────────────────────┤
│ Overview   Summary   Events   YAML                        │
│ ┌ card ───────────────────────────────────────────────┐   │
│ │ Name        payments-old                            │   │
│ │ Status      Terminating, deleting for 3 m           │   │
│ │ Age         86d                                     │   │
│ │ Finalizers  kubernetes                              │   │
│ │ Labels      3 (see Summary)                         │   │
│ │ [↗ Show pods in this namespace]                     │   │
│ └─────────────────────────────────────────────────────┘   │
│ ┌ Why it is still deleting ───────────────────────────┐   │   Terminating only
│ │ ✕ NamespaceContentRemaining: Some resources are …   │   │
│ │ ✕ NamespaceFinalizersRemaining: Some content in …   │   │
│ └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### 4.4.3 Table columns

`GenericResourceTable` with `title="Namespaces"`, `count`, `storageKey="ns"` (column menu), `keyFn = name`, `onSelect`, and the X-1 name button. Header cells follow the X-2 and X-5 fixes (`text-mute`, sort buttons with `aria-sort`).

| Column | Width | Sort | Cell |
|---|---|---|---|
| Name | flex | yes (`name`) | `N` (mono 12 px) inside the X-1 button; `title={name}`. Never hidden (the table's rule). |
| Status | 130 | yes (`phase`) | **Quiet when normal, loud when not** (the design lens: boldness in one place). `Active`: `<span className="inline-flex items-center gap-1.5 text-[11.5px] text-mute"><span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />Active</span>`: a dot and a word, no pill, because forty green pills hide the one that matters. `Terminating`: `<span className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11px] font-medium text-purple bg-purple/10 ring-1 ring-purple/30" title={`Deleting for ${since}`}><span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 rounded-full opacity-60 animate-blink bg-purple" /><span className="relative rounded-full h-1.5 w-1.5 bg-purple" /></span>Terminating</span>` (the same look as a Terminating pod). Any other phase string: a neutral pill `text-mute bg-surface-tint/5 ring-1 ring-edge` with the word. |
| Age | 80 | yes (`parseAge`) | `Mute` (mono 11.5). |
| Labels | flex | no | Up to two chips `mono text-[10.5px] px-1.5 py-0.5 rounded-sm bg-surface-tint/5 ring-1 ring-edge text-mute max-w-[150px] truncate` (`key=value`), then `+N` (`mono text-[10.5px] text-mute`) for the rest; `—` when none; cell `title` lists every label, one per line. **The label `kubernetes.io/metadata.name` is left out of the chips and the count**: Kubernetes sets it on every namespace and it equals the name, so it is noise (it still appears in Summary). |
| (actions) | 48 | no | The row delete button (4.4.4). |

Default order: the API's (alphabetical by name). Sort state is the table's own.

#### 4.4.4 Row delete, the protected set and reasons

The per-row delete follows the pattern `GenericResourceTable` ships (a trash button revealed by `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`, never `invisible`) with three changes the table needs (flagged in 4.6): add `group-focus-within:opacity-100` so the button is visible while its row's name button has focus; accept a per-row reason, `deleteReason?: (item: T) => string | undefined`; and render a row with a reason as **present, focusable and dimmed**: `opacity-0 group-hover:opacity-50 group-focus-within:opacity-50 focus-visible:opacity-50 cursor-not-allowed`, `{...disabledAttrs(reason)}`, handler bails out. Exclusive class strings, not both pairs, so Tailwind's output order cannot decide.

The reason is chosen by the standard precedence, `pickDisabledReason({ readOnly, rbac, capability, finished })`: read-only first, then RBAC (explicit deny only; fails open), then the protected set, then "already being deleted". The same reasons gate the detail panel's header trash.

| Situation | Reason (one string, exact) | Precedence slot |
|---|---|---|
| Read-only mode | the standard `READ_ONLY_REASON` | `readOnly` |
| RBAC says no | `You don't have permission to delete namespaces on this cluster.` | `rbac` |
| `default`, `kube-system`, `kube-public`, `kube-node-lease` | `Built-in namespace. Deleting it can break the cluster, so Garita doesn't offer it.` (use `PRODUCT_NAME`; wording Q23) | `capability` |
| Phase is `Terminating` (Q22) | `This namespace is already being deleted.` | `finished` |

The protected set is one exported constant of four names (decision 4), tested. The existing per-view pattern `onDelete={perm.canDelete ? … : undefined}` (`PVView`) **hides** the control when RBAC denies; that breaks the hard rule "denied = disabled with a reason, not hidden", so the Namespaces page does not copy it.

#### 4.4.5 The detail panel

Reuse `ResourceDetailPanel` with `SelectedResource` kind `ns` (`{ kind: "ns"; item: NamespaceRow }`, cluster-scoped, no `ns` field).

- **Header.** Eyebrow `Namespace · cluster-wide` (the existing form). Title mono 14 px. Status chip: for this kind the generic Healthy/Degraded chip is wrong (a Terminating namespace is not "Degraded"), so it shows the phase: `Active` (`text-ok bg-ok/10 ring-ok/30`) or `Terminating` (the purple pill above). This is the same per-kind override as ARGO-1 and Q15; do it as one function `statusChip(resource)` returning `{ label, tone }` for `argocd`, `ns` and the generic fallback.
- **Header actions.** Compare (inherited), delete trash (disabled with the 4.4.4 reason, same attributes), close. No pencil: there is no edit form; labels are edited in the YAML tab, through the existing Review and save gate. No "Show on map".
- **Tabs.** The default set, `Overview, Summary, Events, YAML` (`tabsFor` falls through to it). Summary gets Labels and Annotations from `get_resource_metadata`; this needs the `ns` arm (4.2).
- **Overview card.** `KV` rows: Name, Status (`Active` or `Terminating, deleting for {since}`), Age, Finalizers (`spec.finalizers`, mono; `—` when the field is unknown), Labels (`{n}` with the hint `see Summary`; `n` excludes `kubernetes.io/metadata.name`). Under the card, one link-button: `<button type="button" onClick={() => onNavigate?.("pods", name, "")} className="h-7 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink flex items-center gap-1.5 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"><ArrowUpRight size={12} aria-hidden />Show pods in this namespace</button>`. `openObject` (`App.tsx:393`) sets the namespace, leaves the page and opens the Pods list with an empty search. This is the page's one cross-link (ponytail: no row action for it; Q24).
- **Protected note.** For the four built-in namespaces, one line at the top of the card, `text-[11.5px] text-mute`: `Built-in namespace. Deleting it can break the cluster, so Garita doesn't offer it.` This prints the reason for the sighted keyboard user who sees a dimmed trash and no tooltip.
- **Terminating card** (phase `Terminating` only), titled `Why it is still deleting` (`text-[11px] font-medium text-mute`, sentence case). With conditions (Q17 option A): one line per condition whose status is `True`: `<span aria-hidden>✕</span> {type}: {message}` in `text-[11.5px] text-ink wrap-break-word`, and a closing line `Kubernetes removes the objects inside a namespace first. It stays Terminating while an object or a finalizer blocks removal.` (`text-mute`). Without conditions (option B): only that closing sentence, plus `Open Events or YAML to look for what is blocking it.` with the two as link-buttons to those tabs.
- **Events tab.** The shared `EventsTabContent` (after POD-4 moves it), `kind="Namespace"`, `scopedToKind` true.

#### 4.4.6 Create

Entry is the TopBar New menu and `⌘N`, as for every other kind; there is no page-level button, no palette action (decision 2), and no sidebar `+` any more. On this page `onCreateResource` opens `ResourceCreator` for `ns` (the namespace form already exists: `ResourceCreator.tsx:116`, the `CreatableKind` `"ns"`). The TopBar item label becomes `New namespace…` for this page (today it reads `New resource…`, or `Install release…` for Helm), keeping the `⌘N` hint, and `Merge from file…` stays. After a successful create the list refetches (the creator already invalidates `"namespaces"`) and the new row appears; focus returns to the opener (the creator's existing rule). Read-only: the New button is disabled with the standard reason and `⌘N` announces it (existing behaviour, `NEW_RESOURCE_BLOCKED_ANNOUNCEMENT`).

From any other view, create is two steps: the picker's "Manage namespaces", then New. That is the accepted cost of decisions 1 and 2.

#### 4.4.7 Delete and what the user sees afterwards

Row trash or header trash, with the focus rule (focus the opener first), opens `DeleteNamespaceConfirm`, the Sidebar's confirm moved verbatim: title `Delete namespace {name}`, description `Deletes the namespace and everything in it. This can't be undone.`, confirm `Delete namespace`, `destructive`, `requireTyping={name}`, label `Type the namespace name to confirm`, `contextLabel` and `contextColor` and `context`, the `kubectl` equivalent, the verbatim backend error in `status` with the dialog kept open, `isPending`. One dialog, two entry points, hosted where both the view and the panel can reach it (the host is the re-plan's decision; plan 1.3's reason for hosting it outside any drag region still applies).

**After success** the dialog closes and the list refetches. The namespace is then usually **Terminating**, not gone: its row shows the purple pill, the trash dims with `This namespace is already being deleted.`, and the row disappears when Kubernetes finishes. So the list must poll faster while any row is Terminating (suggested: 5 s then, otherwise the page's normal interval). This replaces the old "the name lingers and nothing says why" gap. If the deleted namespace was the one the picker had selected (`ns` equal to it), the scope resets to `all`, as in plan 1.4. If the panel was showing that namespace it stays open and now reads Terminating.

#### 4.4.8 States

| State | What shows |
|---|---|
| Loading | The table's skeleton rows (8) under the title. No count chip yet. |
| Loaded | Rows as 4.4.3. |
| Empty (loaded, no rows, no error) | Table empty state: `Folder`-style icon, `No namespaces found.` This should not happen on a healthy cluster (`default` always exists); it can appear when RBAC returns an empty list. |
| Search with no rows | `No results for "{search}"` (the table's existing line). |
| Error (not forbidden) | The table's error card: the verbatim message in the bad box and `Retry`. |
| **Forbidden list** | `ViewState` `no-access` copy, never a raw error box: icon `ShieldOff`, `You don't have access to Namespaces.`, `Your account can't list this resource. Ask a cluster admin for the list permission.`, no Retry (a 403 repeats; the TopBar refresh re-queries). Today `GenericResourceTable` renders `ViewState` only for CRD-backed views (`presenceKey`); a core kind gets the raw error box. The re-plan extends the `error && !presenceKey` branch with `isForbidden(message)` (4.6; Q21). |
| Terminating row | 4.4.3 pill; trash dimmed with its reason; row stays selectable; panel shows the card. |
| Terminating for a long time | No special state: the pill's title shows the age (`Deleting for 2 h`); the panel card shows why (Q17). |
| Protected row | Trash present, dimmed, reason on hover, focus and in the panel note. |
| Read-only | Read-only strip above the table (existing), trash dimmed with the read-only reason, New disabled; selecting and opening are not writes and stay enabled. |
| RBAC cannot delete | Trash dimmed with the RBAC reason (not hidden). |
| Long label set | Two chips, `+N`, full list in the title and in Summary. |
| Long name | Truncates with `title`. |
| Many namespaces | The table scrolls inside its card; the header row is sticky (existing). |

#### 4.4.9 Copy

| Where | Text |
|---|---|
| Sidebar and palette | `Namespaces` |
| Breadcrumb | `namespaces` (`RESOURCE_LABELS`) |
| Page title | `Namespaces` |
| Status | `Active`, `Terminating` (pill title `Deleting for {since}`) |
| Row delete name | `Delete namespace {name}` (title when enabled; `aria-label` always) |
| Disabled reasons | the four strings in 4.4.4 |
| TopBar New item | `New namespace…` |
| Panel eyebrow | `Namespace · cluster-wide` |
| Panel link | `Show pods in this namespace` |
| Protected note | `Built-in namespace. Deleting it can break the cluster, so Garita doesn't offer it.` |
| Terminating card | `Why it is still deleting`; `Kubernetes removes the objects inside a namespace first. It stays Terminating while an object or a finalizer blocks removal.`; without conditions also `Open Events or YAML to look for what is blocking it.` |
| Empty | `No namespaces found.` |
| Forbidden | `You don't have access to Namespaces.` and `Your account can't list this resource. Ask a cluster admin for the list permission.` |
| Delete dialog | unchanged, moved verbatim |

#### 4.4.10 Keyboard and focus

| Key | Where | Behaviour |
|---|---|---|
| Tab | the page | Toolbar, column menu, header sort buttons, then per row: the name button, then its trash button; the trash is reachable even when dimmed. |
| Enter, Space | a name button | Opens the detail panel (X-1). Focus stays on the row. |
| Enter, Space | a trash button | Focus rule, then the typed confirm. Dimmed: nothing happens; the reason is in its title and description, and in the panel note for protected rows. |
| Esc | panel open | Clears the selection, as for every panel (`App.tsx:549-551`); a dialog on top closes first (`ConfirmModal`). |
| `⌘N`, New | resources view | Opens the namespace form; inert and announced in read-only mode. |
| `r` | page | Refreshes (`RESOURCE_QUERY_KEY["ns"]`). |

No arrow-key row navigation (skip, X-1).

#### 4.4.11 ARIA

Table: the existing `<table>` with `aria-sort` on the sorted header (X-5). Name button: `aria-current="true"` when selected. Status: the word is always present; the dot and glyphs `aria-hidden`. Trash: name `Delete namespace {name}`; dimmed ones `aria-disabled`, `aria-describedby` the reason (from `disabledAttrs`). Panel: the existing `<aside>` and heading (`data-panel-heading`); the Terminating card is a `<section aria-label="Why it is still deleting">`.

#### 4.4.12 Contrast (dark / light)

| Use | Colours | Dark | Light | Needs |
|---|---|---|---|---|
| `Active` word | `text-mute` on card | 5.56 | 6.14 | 4.5 |
| `Active` dot | `bg-ok` vs card (non-text) | 8.92 | 6.81 | 3 |
| Terminating pill | `text-purple` on `bg-purple/10` over card | 5.40 | 5.81 | 4.5 |
| Label chips | `text-mute` on `bg-surface-tint/5` over card | 4.86 | 5.55 | 4.5 |
| Name, key cells | `text-ink` on card | 14.10 | 17.58 | 4.5 |
| Trash rest and hover | `text-mute`; `text-bad` on `bg-bad/10` | 5.91; 5.80 | 5.92; 5.93 | 3; 4.5 |
| Dimmed trash | `opacity-50` | 2.40 | 2.14 | exempt (inactive); the reason is also printed in the panel for protected rows |
| Focus ring | `ring-accent/70` | 3.95 | 3.35 | 3 |

### 4.5 The sidebar and the palette

The Sidebar loses its "Namespaces" section (list, `+`, delete confirm, `hoveredNs`), its props `ns`, `setNs`, `namespaces`, `onCreateNamespace`, `onDeleteNamespace`, and gains one `NavItem` in "Cluster". The context chip and the rest are unchanged. The palette gains the `NAV_ITEMS` row `Namespaces` and **no** create action (decision 2); `settingsActions` is untouched.

### 4.6 Plan section 1: what this part voids and what it keeps

For the tech lead's re-plan. Nothing here is binding until the main session records it.

| Plan section 1 item | Status |
|---|---|
| 1.1 "No Rust change, no new command" | **Void.** The page needs phase, age, labels and deletion time (4.2, Q16), optionally conditions and finalizers (Q17). `delete_namespace` is unchanged. |
| 1.2 files (`NamespacePanel.tsx` and the rest) | **Changed.** The dropdown component keeps the filter and drops create and delete. New: the `ns` view, its row and panel cases, the `ns` kind sites (4.2). |
| 1.3 props: Sidebar loses the five, TopBar loses `namespaces` | **Keeps** the Sidebar removals. TopBar no longer gets `onCreateNamespace`; it gets `onManage?: () => void` instead. |
| 1.4 `NamespacePanel` props `onCreateNamespace`, `onRequestDelete` | **Void** for the picker (it has neither). `DeleteNamespaceConfirm` **keeps** its shape and moves to where the page and panel can both open it. |
| 1.5 `namespaceRows`, `canDeleteNamespace`, `PROTECTED_NAMESPACES` | **Keeps** `namespaceRows` for the picker. The protected set gains `kube-node-lease` and is **disabled with a reason, not hidden**; `canDeleteNamespace` is replaced by a function returning a reason. |
| 1.6 focus rule, filter, tab order, states | **Keeps** the focus rule, filter behaviour and states for the picker. Create, delete, read-only rows and the opacity-reveal rule move to the page (`GenericResourceTable`). |
| 1.7 scope: the picker renders where it does today | **Keeps.** The page itself hides the picker (cluster-scoped kind). |
| 1.8 keyboard layering | **Keeps.** |
| 1.9 reach decision (accept the extra click) | **Moot.** Create and delete live on a page reachable from the sidebar in one click from any view, and from the picker's link. |
| 1.10 hard rules | **Keeps**, plus: protected rows disabled with a reason, RBAC denial disabled with a reason (the `PVView` pattern of hiding it is not copied). |
| 1.11 docs | **Changed**: `ui.md` (picker, page, protected set), `resource-types.md` (the `ns` row), `key-files.md`, `writes.md` ("Namespace form opens from the Sidebar `+`" becomes TopBar New on the Namespaces page), `CHANGELOG.md`. |

`GenericResourceTable` changes the page needs (all small; each also helps the other tables): the per-row `deleteReason` prop and the dimmed-present rendering; `group-focus-within:opacity-100` on the trash; `aria-sort` on headers (X-5); the name-cell button (X-1); and the forbidden state for core kinds (Q21). `TopBar` changes: the New item label per kind (`New namespace…`), the picker component, `onManage`.

### 4.7 Needs visual check

1. The picker's placement against the 80 px header (`items-end`): `top-8` under a 28 px trigger, not covering the cluster rule or the context chip.
2. List height at a 600 px high window: `min(18rem, 50vh)` plus the filter (about 52 px) plus the footer (32 px).
3. `ring-inset` focus rings inside `overflow-hidden`; the opacity reveal of the row trash in the light theme.
4. WKWebView: the `aria-expanded:` variant on the trigger, `placeholder:font-sans`, a click on a row.
5. A 63-character name in the trigger (`max-w-[28ch]`), in a picker row, and in the table's name cell.
6. The Labels column at the default and the narrowest panel widths; the `+N` chip.
7. The Terminating pill pulse under `prefers-reduced-motion` (needs the POD-15 fix to stop).
8. The sidebar "Cluster" section with one more row on a short window.

---

## 5. Docs and gates the fix batch owes

For the tech lead's briefs. The documentation for the namespaces work (Part B) is listed last; plan 1.11 is superseded by it (4.6).

- `docs/claude/ui.md`:
  - Keyboard layering: the pod menu, the Labels and Sort menus and (later) the TopBar New menu now use `Popover`; add them to the users list.
  - Confirm-on-Destructive: the pod delete now keeps the dialog open on failure with the verbatim error.
  - Appearance: optional gate G5, `text-dim` on text in the touched files returns icons only (X-2).
  - Read-only: if Q5 is answered A, change the DISABLE-PRECEDENCE sentence "the click handler must still bail out" to say navigation to an explanatory tab is the one exception. If Q9 is answered A, change "Single-click writes, by design" so it excludes Sync with Force.
- `docs/claude/pods-logs.md`: Pod status vocabulary and its one source (`podStatus.ts`), the CPU and Memory "req" suffix, the `logs` link picks the container.
- `docs/claude/argocd.md`: header shows Health and Sync as two chips; Resources tab filters are two independent groups where Healthy is `health_status === "Healthy"` alone; Overview shows Sync policy; Actions render first.
- `docs/claude/key-files.md`: `podStatus.ts`, `useCopyFeedback.ts`, `EventsTabContent.tsx`.
- `CHANGELOG.md` `[Unreleased]`: `### Fixed` for X-1, POD-1, POD-3, POD-5, POD-12, ARGO-1, ARGO-4, ARGO-5 and `### Changed` for the rest, in user terms, only for what ships.
- Namespaces (Part B), replacing plan 1.11:
  - `docs/claude/ui.md`: a new section `## Namespaces: picker and page` (a grep target): the picker's contents, states, footer link and focus rule; the page's columns (quiet `Active`, loud `Terminating`), the label `kubernetes.io/metadata.name` left out of the Labels column, the protected set of four, the disable-precedence order for the delete reasons, the `deleteReason` row rule, the opacity reveal (never `invisible`), and why the picker is hidden on the page. Confirm-on-Destructive: "Sidebar namespace delete" becomes "Namespaces page delete (row trash and panel header), typed (namespace)". App views, TopBar rules: one clause each for the picker and the page. Keyboard layering: the picker is a `Popover` user.
  - `docs/claude/resource-types.md`: the `ns` row (cluster) in the kind table, `CLUSTER_SCOPED_KINDS`, and the kind-count sentence.
  - `docs/claude/key-files.md`: the Sidebar row drops "namespace list"; rows for the picker component, the namespaces view and `utils/namespaces.ts`.
  - `docs/claude/writes.md`: "Namespace form opens from the Sidebar `+`" becomes "from TopBar New (and `⌘N`) on the Namespaces page"; the protected set and its reasons.
  - `CHANGELOG.md` `[Unreleased]`: `### Added` the Namespaces page; `### Changed` the picker filter and the sidebar list moving; `### Fixed` the namespace delete being unreachable by keyboard. User terms, shipped behaviour only.
- Tests (pure helpers): `podStatus.test.ts` (POD-3); `namespaces.test.ts` (the protected set of four, the delete-reason precedence, the label filter that drops `kubernetes.io/metadata.name`, `namespaceRows`). Everything else is DOM and checked by hand. Gates as in CLAUDE.md Testing: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `node --experimental-strip-types scripts/check-emit.ts`, and the Appearance greps G1, G2, G4.

---

## 6. Questions for the user (with options and a recommendation)

Each is a decision I did not assume. The recommended option is first.

**Q1. Fix batches.** Which findings go in the first batch?
- A (recommended): B1 = the five Critical findings plus POD-3, POD-5, POD-12, ARGO-2, ARGO-4, ARGO-5 (the table in 3.2); B2 = the other "Implement now" findings after B1 is reviewed.
- B: everything marked "Implement now" in one batch.
- C: only the five Critical.

**Q2. POD-2, invented data in the Pod Overview.**
- A (recommended): remove the hard-coded Service account row; derive Ready and ContainersReady from the ready fraction and caption the card "From the pod's phase and ready count."; add the real fields (`service_account`, `conditions`) in a later Rust run.
- B: remove the Service account row and the whole Conditions card.
- C: leave it as is.

**Q3. POD-7, bar denominator when a pod has no limit.**
- A (recommended): limit, else twice the request, else no bar and the number only (what `DualZoneBar` already does).
- B: keep the invented 500 m and 512 Mi defaults.

**Q4. POD-7, sort the CPU and Memory columns.**
- A (recommended): add sorting by the displayed value (usage when metrics exist, else the request).
- B: sort by usage only; pods without metrics go last.
- C: no sorting on these columns.

**Q5. POD-10, a blocked Shell control.**
- A (recommended): clicking the Shell tab, Exec shell or a container's exec link opens the Shell tab, which already explains read-only mode; this edits the `ui.md` DISABLE-PRECEDENCE sentence.
- B: stay a no-op and add a visible one-line reason in the panel header.
- C: leave it (tooltip and hidden description only).

**Q6. POD-11, Overview and Summary overlap.**
- A (recommended): delete the Status and Labels cards from Summary; keep Container States.
- B: merge Overview into Summary (eight tabs).
- C: leave both.

**Q7. ARGO-6, the "diff" expander on the Resources tab.**
- A (recommended): remove it; the OutOfSync pill and the row action already say it.
- B: keep it as "details" with accurate copy (ARGO-6).
- C: leave it.

**Q8. ARGO-8, why a sync failed.**
- A (recommended): add `operation_message` (from `status.operationState.message`) to `ArgoCdApp` in a later Rust run and show it under the operation pill; nothing now.
- B: frontend only, now: when the last operation is Failed or Error, say "The last operation failed. Open Events for details." with a button to the Events tab.
- C: leave it.

**Q9. ARGO-9, Sync with Force.**
- A (recommended): checking Force sends Sync through a confirm, like Prune, even when the typed-confirm guardrail is off.
- B: keep it single-click (today's documented behaviour for plain Sync).

**Q10. ARGO-3, the Force help sentence.**
- A (recommended): keep the existing meaning ("Overwrites resources that conflict with git.") and check it in the live verification, since `argocd.md` says to verify sync semantics against upstream, not memory.
- B: a verified rewrite before the batch ships.

**Q11. ARGO-7, mark the revision that is live in History.**
- A (recommended): show a neutral "Current" chip on the entry whose `revision` equals the Application's `last_commit` (exact string match; no chip when nothing matches).
- B: no marker.

**Q12. X-6, bulk Copy names.**
- A (recommended): keep the selection after copying, so Delete or Restart can follow; show "Copied 3 names".
- B: keep clearing the selection (today); add only the "Copied" feedback.

**Q13. X-7, the type scale and eyebrows.**
- A (recommended): now, raise the floor to 10.5 px and stop setting sentences in mono; keep uppercase eyebrows because every other view uses them; do the 11.5/12.5 collapse in a later app-wide pass.
- B: also switch the eyebrows to sentence case (`text-[11px] font-medium text-mute`) in these two panels only; they would then differ from the rest of the app.
- C: leave the scale alone.

**Q14. X-8 and the picker's filter field, the field boundary** (4.3.2).
- A (recommended): `ring-1 ring-mute/70` on text fields (no new token; 3.53 dark, 3.11 light), used first on the namespace filter.
- B: add a new field-boundary token (a tech-lead decision, and `themeTokens` tests).
- C: keep `ring-edge` or `ring-edge-strong` (1.2 to 1.3:1, which fails WCAG 1.4.11).

**Q15. ARGO-1, the generic header word for other kinds.**
- A (recommended): rename the fallback "Degraded" to "Not healthy" for every non-ArgoCD kind (a Pending PVC or a NotReady node is not "degraded").
- B: leave it.

**Q16. Part B, where the Namespaces page gets its data (Rust).** `list_namespaces` returns names only; the page needs phase, created time, labels and deletion time (4.2).
- A (recommended): a new command returning rows (`name`, `phase`, `created`, `labels`, `deletion_timestamp`) plus one `useNamespaceRows` hook that the page, the picker, `MapPage` and the creator's invalidation all read (names derived from the rows); `list_namespaces` is left for compatibility or removed in the same change. One query key, one shape.
- B: extend `list_namespaces` itself to return rows and update its callers.
- C: keep `list_namespaces` for the picker and add a second query for the page (two keys, two fetches, and the picker cannot show Terminating).

**Q17. Part B, "why is it still deleting" in the detail panel.** A namespace stuck in Terminating is the commonest namespace problem; Kubernetes records the reason in `status.conditions` and the blockers in `spec.finalizers`.
- A (recommended): include `conditions` and `finalizers` in the Rust row and show the card with the real messages (4.4.5).
- B: the static explanation and a pointer to the Events and YAML tabs only; no extra Rust fields.
- C: no Terminating card.

**Q18. Part B, a "Manage namespaces" link in the picker** (4.3).
- A (recommended): yes, a footer row that opens the Namespaces page; it is navigation, never disabled.
- B: no; the sidebar item is the only route.

**Q19. Part B, where the sidebar item sits** (4.4.1).
- A (recommended): "Cluster" section, first row, above Nodes.
- B: "Cluster" section, after Nodes.
- C: its own section "Namespaces" with that one row.

**Q20. Part B, the `Terminating` tag in the picker** (needs the rows from Q16).
- A (recommended): show it, muted, on a Terminating row (a pod list that is emptying is otherwise a surprise).
- B: names only, no tag.

**Q21. Part B, the forbidden state for the page** (4.4.8). `GenericResourceTable` shows the shared "no access" card only for CRD-backed views; a core kind shows the raw error box.
- A (recommended): extend the table so any core list that fails with a 403 shows the same `ViewState` card (a small change that improves every core list view).
- B: opt in for the Namespaces page only, through a prop.

**Q22. Part B, deleting a namespace that is already Terminating.**
- A (recommended): delete is disabled with `This namespace is already being deleted.`
- B: leave it enabled (a second delete is accepted by the API and changes nothing).

**Q23. Part B, the wording of the protected reason.**
- A (recommended): `Built-in namespace. Deleting it can break the cluster, so Garita doesn't offer it.` It states Garita's choice and makes no claim about what Kubernetes does.
- B: a sentence that says Kubernetes may refuse it. I could not verify that for all four names from the code, so I did not write it.

**Q24. Part B, a "Show pods" action on each table row** (in addition to the link in the detail panel).
- A (recommended): no; the panel link is the one cross-link (ponytail), and the row already opens the panel.
- B: add a row action.
