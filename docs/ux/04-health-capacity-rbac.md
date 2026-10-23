# UX 04: Health, capacity, RBAC and secrets (v1.4.0 and v1.4.1)

Status: wave 2 draft, for tech lead review. Written for task U1 in `docs/impl/v1.4.0-tasks.md` §3. It designs the whole UX-04 package once, so v1.4.0 (#11, #12, #13, #14, #15, #25) and v1.4.1 (#19, #20, #31, #32, #33, #40) share one Health section, one finding row and one reveal pattern.
Depends on `docs/ux/00-overview.md`. It cites contracts by name (STATE-VOCAB, DISABLE-PRECEDENCE, TOKEN-ROLES, KEYMAP, COPY-RULES, A11Y-BASELINE, CONFIRM-ANATOMY, DIFF-ROW) and does not redefine them. Format precedent: `02-logs-debug.md`, `03-diffs-write-safety.md`.
Baseline: the working tree on branch `feat/v1.4.0` (v1.3.1 shipped; `SettingsView`, `mainView`, `guardrails.ts`, `scope.ts` exist). Date: 2026-10-06.
Design only. No code, no Tauri command signatures, no class strings, no hex values. The IPC contracts in `v1.4.0-tasks.md` §2 and `v1.4.1-tasks.md` §2 are inputs. Where this design needs something they lack, it is raised in section 9 (disagreements) or section 10 (open questions). It is never assumed.

## Contents

1. Scope, findings from the code, shared patterns, information architecture
2. User flows
3. Wireframes
4. States (eight states for every view)
5. Microcopy
6. Keyboard and accessibility
7. Light and dark notes
8. Constraint checklist
9. Disagreements with `v1.4.0-tasks.md` §2 and `v1.4.1-tasks.md` §2
10. Open questions for the tech lead

The brief's nine required sections are 1 to 8 and 10. Section 9 is added because the tech lead records disagreements separately (`v1.4.0-tasks.md` §1.5).

---

## 1. Scope

### 1.1 Items

| ID | Item | Class | Release | Surface |
|---|---|---|---|---|
| #11 | Problems view, and the "Why is this unhealthy?" card | (a) | v1.4.0 | New Health page; card in both detail panels' Summary tab; `ClusterOverview` entry |
| #12 | Node capacity | (a) | v1.4.0 | New Health page; `NodeStrip` overlay |
| #13 | Right-sizing hints | (a) | v1.4.0 | `DetailPanel` Containers tab |
| #14 | Constraints section | (a) | v1.4.0 | Summary tab of pods and workloads |
| #15 | Not installed, No access, Nothing here | (a) | v1.4.0 | Every CRD-backed view; a shared renderer (VIEW-STATE) |
| #25 | Node pool, zone and instance-type columns | (b) | v1.4.0 | Nodes view |
| #33 | Secret values out of the list payload, Helm Values redaction | (a) | v1.4.1 | Secret Overview and YAML tabs; Helm Values tab |
| #31 | Local action journal | (a) | v1.4.1 | New App page in the Sidebar footer |
| #32 | RBAC "who can" and "what can this subject do" | (a) | v1.4.1 | New Access Control page; Summary tab of five RBAC kinds |
| #20 | Possibly unused | (a) | v1.4.1 | New Health page |
| #19 | Deprecated and removed APIs | (a) | v1.4.1 | New Health page |
| #40 | Saved searches | (a) small | v1.4.1 | `TopBar` search box |
| #34 | User impersonation ("view as") | (a) low-fi | backlog | Banner, entry points (section 3.19) |
| #21, #22, #26, #27 | cert-manager chain, broader Flux, printer columns, typed add-on panels | (b) | backlog | Notes only (section 3.20) |

The jobs behind the package, in the user's words:

- "I just opened a cluster. What is broken, and why?" (#11)
- "Will my pods fit? Where is the headroom?" (#12)
- "Is this container sized sensibly, or is it about to be OOM-killed?" (#13)
- "What rules are constraining this workload?" (#14)
- "Is this view empty because there is nothing, because I can't see it, or because it isn't installed?" (#15)
- "Who can do X here? What can this service account do?" (#32)
- "What is safe to look at without leaking a secret?" (#33)
- "What did I send to this cluster from this app?" (#31)

### 1.2 Findings from the current code

Read on 2026-10-06. These facts shape the design.

| # | Finding | Where | Consequence |
|---|---|---|---|
| H1 | `ClusterOverview` and `NodeStrip` render only on the Pods view (`isPodView`). | `App.tsx` | The "Problem pods" entry point exists only while the user is on Pods. Pods is therefore the real landing view; Problems cannot rely on the overview as its only door (Sidebar and ⌘K are the doors). |
| H2 | The "Problem pods" card counts CrashLoop plus Failed pods, and says "All healthy" when the count is 0. | `ClusterOverview.tsx` | The Problems page checks far more (image pull, unschedulable, services, PVCs, certificates). "All healthy" beside a Problems page with findings is a contradiction (heuristic: *consistency*, *visibility of system status*). The copy changes (section 5.1) and the link must not imply the two numbers match. |
| H3 | `onNavigate` switches the main resource, **sets the namespace to the object's namespace**, pre-fills the search box with the name, clears the selection, and does **not** open the detail panel. | `App.tsx` ~599 to 650 | A jump from a cluster-wide Problems list would silently re-scope the namespace picker to one namespace, and Problems would then shrink when the user returns. Jump behaviour is specified in 2.1 and 10 Q2. |
| H4 | `TopBar` always renders the resource breadcrumb, the search box and the New button, whatever `mainView` is. Today Settings already shows them. | `TopBar.tsx` | Every non-resource view needs a defined TopBar (section 1.5). |
| H5 | Capacity thresholds disagree: `Bar` and `DualZoneBar` switch at 65% and 85%; `NodeStrip` switches at 65% and **80%**. Colours are inline hex, and `DualZoneBar` text uses raw `text-red-400` and `text-yellow-400`. `tailwind.config.js` has no `bar-*` tokens. | `DetailPanel.tsx`, `NodeStrip.tsx`, `tailwind.config.js` | One threshold pair (65 and 85) and the `bar-low/mid/high` roles. `v1.4.0-tasks.md` §6 already lets the frontend add `bar-*` tokens. |
| H6 | `DualZoneBar`'s container values fall back to the **pod's** totals (`c.cpu_request_m ?? pod.cpu_m`), and with no limit it uses **2x the request** as the 100% mark. | `DetailPanel.tsx` ~786, 98 | A bar percentage with no limit is not "percent of anything real". Right-sizing hints must use a container's own request and limit only, and show absolute numbers, never a percentage of the 2x mark. |
| H7 | A Secret's Overview shows every value as **base64 text immediately**; "reveal all" only decodes it. | `ResourceDetailPanel.tsx` 133 to 222 | Today there is no concept of reveal. #33 raises the bar, and the two actions need different names (fetch vs decode). |
| H8 | `GenericResourceTable` has no default-hidden columns (`hiddenCols` starts empty and only restores saved state), `NodeView` passes no `storageKey`, search matches `keyFn` only, and the error state is one red block with no No-access variant. | `GenericResourceTable.tsx`, `ResourceViews.tsx` 862 | "Hidden by default via the existing column-hide mechanism" (#25) is not true today. See section 9 X8. |
| H9 | The Helm Values `edit` button seeds the editor from whatever text is displayed; `copy` copies displayed text; the textarea background is a hard-coded literal. | `ResourceDetailPanel.tsx` 3316 to 3409 | After #33, the displayed text is redacted, so the seed must never be the displayed text (section 3.15). |
| H10 | Panels do not share tabs. Helm: Overview, Values, History, Events. ArgoCD: Overview, Resources, History, Events. TLS Secret: Overview, TLS, Summary, Events, YAML. Workloads and other kinds have Summary. Pod panel: Overview, Summary, Containers, Events, Logs, Shell, YAML, Metrics, Forward. | `tabsFor`, `DetailPanel.tsx` | The explain card and Constraints live in Summary, so Helm and ArgoCD objects have neither (n/a, stated per view). The default tab is Overview, so a card in Summary is invisible unless something points at it (the "Problem found" chip, 3.5). |
| H11 | `expiryState` returns a text class, not a state: `text-bad` for both "expired" and "expiring soon", `text-dim` otherwise. The sign of `deltaMs` separates them. | `expiry.ts` | The certificate finding must distinguish expired from expiring. The sign is not a second threshold (section 5.2). |
| H12 | The ArgoCD health strip cards are `button`s with a coloured count, an uppercase label and no `aria-pressed`. Colours are inline hex. | `ResourceViews.tsx` 1698 | The Problems cards reuse the shape but add `aria-pressed`, a glyph and the word, and read colour from roles. |
| H13 | The Sidebar footer holds only the Settings button. Sidebar `active` is a `ResourceType`, and Settings passes an empty string. | `Sidebar.tsx`, `App.tsx` 306 | Health pages, Who can and Journal need their own "active" highlight. |
| H14 | `Esc` is already layered (`isModalOpen`, `isInTerminal`, `isEditableTarget`), and `r` ignores editable targets. | `App.tsx` 245 to 296 | The old findings F2 and F3 in 00 are fixed. This package adds no global shortcut. |

### 1.3 Shared patterns introduced here

Later specs cite these by name. UX-06 reuses FINDING-ROW (the map and timeline entries) and HEALTH-SHELL.

| Name | What it is | Used by |
|---|---|---|
| HEALTH-SHELL | The page frame for Health pages: title, scope line, CHECKED-LINE, filter cards, partial strip, body. Pages mount in the main area like Settings does. | Problems, Node capacity, Possibly unused, Deprecated APIs |
| FINDING-ROW | One row anatomy for a finding: lead, object, summary, evidence disclosure, Open. The lead slot varies by page: a severity for Problems, a kind for Possibly unused, a removal status for Deprecated APIs. | Problems, Possibly unused, Deprecated APIs, explain card |
| CHECKED-LINE | One line stating when the data was computed, plus any honesty qualifier that page needs. | Every Health page, explain card, Permissions, Who can |
| HONESTY-NOTE | A fixed sentence from the 00 qualifier glossary, shown as visible text (never only a tooltip). | Events TTL, "Hint", "may apply", "possibly unused", "covers up to" |
| VIEW-STATE | The renderer for the #15 vocabulary in STATE-VOCAB: Not installed, No access, Nothing here, Error, Unreachable, plus the Partially visible strip. One component, per-view copy slots. | All CRD-backed views, and every new page in this package |
| NODE-CAPACITY-BAR | A node-level bar that **extends DualZoneBar** with different semantics (3.6). | Node capacity page, NodeStrip overlay |
| REVEAL | The pattern for fetching sensitive values on explicit request, per object, with a visible state and a one-click Hide. | Secret Overview and YAML tabs, Helm Values tab |
| HINT-ROW | A one-line advisory under a control, with the "Hint" label and an information glyph. Never a warning triangle. | Right-sizing hints |
| SAVED-SEARCH-MENU | The popover under the TopBar search box. | #40 |

### 1.4 Terminology (hard rule)

- **Problems** is the cluster-health view (#11). **Diagnostics** is the Settings section (#46). They are never swapped (00 §7.2).
- **Hint** (right-sizing, who-can) is advisory. **Finding** is the generic noun for a Problems, Possibly unused or Deprecated APIs row. A Possibly unused finding is never called a "problem".
- **Reveal** fetches values from the cluster. **Decode** converts base64 to text. Both words appear in the Secret panel and always mean those two things.

### 1.5 Information architecture

Decisions follow 00 §7.3 (D-3: a new Health section, first). Confirmed here with the additions below.

```
Sidebar (280 px)
┌─────────────────────────────┐
│ Watchtower  v1.4.0          │
│ [ctx chip]                  │
│ HEALTH                      │
│   Problems                  │
│   Node capacity             │
│   Possibly unused           │
│   Deprecated APIs           │
│ WORKLOADS … (unchanged)     │
│ NETWORKING                  │
│ CONFIG & STORAGE            │
│ ACCESS CONTROL              │
│   Service Accounts          │
│   Roles                     │
│   Cluster Roles             │
│   Role Bindings             │
│   Cluster Role Bindings     │
│   Who can…                  │  new, last in the section
│ CLUSTER … HELM … GITOPS     │
├─────────────────────────────┤
│ ⚙ Settings   ☰ Journal      │  footer, App group
└─────────────────────────────┘
```

| Entry | Sidebar | ⌘K group and label | Page | TopBar breadcrumb | Namespace picker | Search box means |
|---|---|---|---|---|---|---|
| Problems | Health | "Health": "Problems" | HEALTH-SHELL | `problems` | Shown (scope) | Filters findings by kind, namespace, name, summary |
| Node capacity | Health | "Health": "Node capacity" | HEALTH-SHELL | `node capacity` | **Hidden** (cluster-wide) | Filters nodes by name |
| Possibly unused | Health | "Health": "Possibly unused" | HEALTH-SHELL | `possibly unused` | Shown | Filters findings |
| Deprecated APIs | Health | "Health": "Deprecated APIs" | HEALTH-SHELL | `deprecated apis` | Shown | Filters findings |
| Who can… | Access Control (last) | "Access Control": "Who can…" | Form page | `who can` | **Hidden** (the form has its own namespace field) | Hidden |
| Journal | Footer, beside Settings | "App": "Journal" | Table page | `journal` | **Hidden** (all clusters) | Filters entries by object and summary |
| Constraints | none (a section in Summary) | none | n/a | n/a | n/a | n/a |

Rules for every non-resource view (Health pages, Who can, Journal):

1. The TopBar **New** button is hidden and ⌘N does nothing (no error, no announcement). These views create nothing.
2. The saved-search button (#40) is hidden. Saved searches belong to resource lists (section 3.18).
3. The search box clears when the page changes, as it does when the resource changes today.
4. The refresh button and `r` re-run the active page's query. On Who can and Journal "refresh" re-runs the last query and re-reads the file. The spinner and the 2-second cooldown stay.
5. The Sidebar highlights exactly one entry. Health pages and Journal need their own "active" state because `active` is a `ResourceType` today (finding H13).
6. Every entry has a ⌘K entry. Entries are present even when the backing data is absent (00 §7.3). Possibly unused on a cluster with no ConfigMaps still opens and shows Nothing here.
7. **No count badges** on Sidebar entries. A bare number on Problems implies a score (00 §7.3, section 8).
8. Pods stays the landing view (open question Q4-2, recommendation adopted). On the Pods view the "Problem pods" card gets one added link (3.1).

Health pages keep their filters and expanded rows when the user leaves and returns in the same session. How that is built (hidden mount versus state held in the parent) is the tech lead's call, with one condition: a Health page's query runs only while the page is visible (or an explain card needs it), because `list_problems` is the most expensive read in the app (open question Q3).

---

## 2. User flows

### 2.1 Triage a cluster with Problems (#11)

1. The user opens a cluster and clicks **Problems** in the Sidebar, or presses ⌘K and types "problems".
2. The page shows a skeleton and "Checking for problems…". On success, filter cards show counts and the list shows findings grouped by severity. Critical and Warning groups are open. Info is collapsed.
3. Branch A: the result is partly unreadable. A Partially visible strip appears above the cards, naming each skipped source and the rules that did not run. The list below it still works.
4. Branch B: no findings. The page shows "No problems found in <scope>." with the checked time and the events note (never a bare "All healthy").
5. The user clicks a card (Critical, Warning, Info) to filter, or opens the **Rule** menu to narrow to one rule. Clicking the active card clears it.
6. The user expands a finding's **Evidence**. They see the exact field path and value, and for events the reason and age.
7. The user clicks **Open**. The app switches to that object's list, filtered to its name, **without changing the namespace picker** (H3, Q2). If exactly one row matches the kind, namespace and name, the detail panel opens on it (Q2 recommendation).
8. To return, the user clicks **Problems** in the Sidebar. Filters and expansion are as they left them.
9. Data refreshes on the 30-second cadence, on `r`, and on the refresh button. Rows are matched by finding id, so an expanded row stays expanded and focus stays on the same finding. A finding that disappears is announced politely ("Resolved: ...").

### 2.2 Understand one unhealthy object (#11 card)

1. The user opens a pod or workload panel. The default tab is Overview.
2. If the problems check has a finding for this object, a compact **Problem found** chip shows in the panel header (3.5). Clicking it opens Summary and focuses the card. If the user opens Summary on their own, the card is the first block.
3. The card lists each finding (critical first), with its evidence and the events note when any evidence is an event.
4. The card offers existing tabs as links ("Open Logs", "Open Events"). Nothing is changed or fixed from the card.
5. If the check has not finished, the card shows "Checking…". If it could not run, it shows why (4.2). If it ran and found nothing, one quiet line says so (3.5). The card is never silently absent for a kind the rules cover (section 9 X1).

### 2.3 Review node capacity (#12)

1. The user clicks **Node capacity**. The page loads one row per node.
2. Rows sort by highest requested CPU share first. The user can re-sort by any numeric column.
3. Each row states numbers first (requests, limits, allocatable) and shows the bar as a second encoding.
4. A node whose requests are at or above 85% of allocatable shows a high marker (glyph plus the word "High"). Limits above 100% show as a number ("Limits 142%"), not clamped.
5. A count of pods with a container lacking a CPU or memory limit shows per node ("No limits: 4 pods").
6. The user clicks a node name to open it in the Nodes view (jump, as 2.1 step 7).
7. Branch: metrics-server is absent. The usage marker is missing and one line says so; requests and limits still show.
8. Branch: the cluster-wide pod list is forbidden. The page shows No access with the specific reason (3.6).

### 2.4 See a right-sizing hint (#13)

1. The user opens a pod, then the **Containers** tab. Each container card shows its bars (unchanged).
2. Under the bars, a HINT-ROW appears only when the rules in `v1.4.0-tasks.md` §2.6 fire. Below 10 samples a quiet line says "Collecting samples (4 of 10)".
3. The hint states the observation with real numbers, names the sample count, and ends "Based on current usage only." It never suggests a number to type in.
4. Hints do not appear on init containers, and never use the pod-level fallback values (H6).

### 2.5 See which rules constrain an object (#14)

1. The user opens the **Summary** tab of a pod or workload.
2. A **Constraints** section lists five groups: Resource quotas, Limit ranges, Pod disruption budgets, Priority class, Admission webhooks.
3. Each group loads on its own, so a slow or forbidden group never blocks the others (webhook configurations are cluster-scoped and often forbidden to developers).
4. Rows say **Applies** (matched exactly) or **May apply** (cannot be fully evaluated). Webhook rows always say **May apply**.
5. Each row has an **Open** link to the constraint object (jump).

### 2.6 Open a CRD-backed view that has no data (#15)

1. The user opens, for example, Certificates.
2. The app combines presence and the list query (the mapping table in `v1.4.0-tasks.md` §2.2) and shows exactly one state: Not installed, No access, Nothing here, or Error.
3. If presence could not be confirmed and the list is empty, the view shows Nothing here with the subtitle "Couldn't confirm whether Certificates is installed."
4. No state mentions "all namespaces" as a cause (00 §4.3).

### 2.7 Reveal a Secret's values (#33)

1. The user opens a Secret. Overview shows each key with its size and a hidden value. Nothing has been fetched.
2. The user clicks **Reveal values**. The panel fetches that one object. Rows then show the base64 text, as today. A **Revealed** status and a **Hide values** button appear.
3. The user can click **Decode** per row, or **Decode all**, to see text instead of base64. This never fetches.
4. Switching tabs inside the panel keeps the reveal. Closing the panel, selecting another object, or clicking **Hide values** discards the values.
5. The YAML tab shows a placeholder until the reveal exists, with its own **Reveal values** button. Opening the guided Secret editor counts as a reveal (T41-3).
6. Branch: the reveal fails. The rows stay hidden, an inline error shows the server text, and Retry is offered.
7. Read-only mode does not block any of this. Reveal is a read. Only **Edit** is disabled (03, DISABLE-PRECEDENCE).

### 2.8 Reveal and edit Helm values (#33)

1. The user opens a Helm release and the **Values** tab. It shows redacted text, read-only. Credential-looking values read `<redacted by Watchtower>`.
2. The view offers **Reveal values** (read) and **Reveal and edit…** (read, then edit). There is no plain Edit button while values are redacted, so the redacted text cannot be edited by any path.
3. **Reveal values** shows the original text read-only, with **Hide values** and **Edit**.
4. **Reveal and edit…** fetches the original text, then enters edit mode seeded only from it. If read-only mode or RBAC disables edit, this button is disabled with the reason, and **Reveal values** still works.
5. In edit mode, **Review upgrade…** opens the upgrade gate (UX-03, unchanged). If the text still contains the placeholder, the button is disabled with the reason "A redacted value is still in the edit. Reveal it or remove it first." (03 §9.4).
6. After a successful upgrade the tab returns to the redacted view.

### 2.9 Ask who can do something (#32)

1. The user clicks **Who can…**. The page shows a form: Verb, Resource, optional Subresource, Namespace.
2. The user fills it and clicks **Find subjects**. The result groups subjects by kind (Users, Groups, Service accounts), each with its scope and the binding that grants it.
3. The honesty notes are always visible: the result comes from RBAC bindings, it is not the user's own permission check, admission webhooks and non-RBAC authorizers can still deny or allow.
4. Branch: some bindings or roles could not be read. A Partially visible strip says which. This is the common case for non-admins.
5. Branch: nothing matched. "No bindings grant ..." with the note that access may come from outside RBAC. Never "no one can".
6. A subject row opens the binding, or the service account, by jump.

### 2.10 Ask what a service account can do (#32)

1. The user opens a Service Account, then **Summary**. A **Permissions** section appears with the hint label and the same notes.
2. It loads on demand (when Summary opens), grouped as **Cluster-wide** and **In namespace <ns>**, each row showing resources, verbs and where the grant comes from.
3. On a Role Binding or Cluster Role Binding panel, the section lists the bound subjects, and each subject expands to the same permissions on demand.
4. On a Role or Cluster Role panel, the section lists **Bound to** (subjects) from the binding lists already in cache (section 9 X10).

### 2.11 Find possibly unused objects (#20)

1. The user clicks **Possibly unused**. The qualifier and the excluded namespaces show above the list before any result.
2. Findings group by kind (ConfigMaps, Secrets, PVCs, PVs, Roles, Cluster roles, Service accounts, Workloads with zero replicas). Each row says why it was flagged.
3. The only action is **Open**, which jumps to the object. There are no checkboxes, no select-all and no delete control on this page.
4. To delete, the user opens the object and uses its own panel and normal confirm.

### 2.12 Find deprecated APIs (#19)

1. The user clicks **Deprecated APIs**. The header states what is scanned (Helm release manifests and last-applied annotations only) and "Table covers Kubernetes up to <X>".
2. Each finding says the API version, the status on this cluster (Removed, Deprecated, Deprecated with no removal planned), the Kubernetes versions, the replacement, and where it was found.
3. If the cluster is newer than the table, a stronger note says findings may be missing.

### 2.13 Read the journal (#31)

1. The user clicks **Journal** in the Sidebar footer. A table lists newest first: time, cluster, verb, object, summary, result.
2. The user filters by cluster, kind or result, and loads older entries with **Load older**.
3. There is no edit, delete, clear or export. Entries are read only.

### 2.14 Save and reuse a search (#40)

1. The user types a search on a resource list, then clicks the bookmark button next to the search box.
2. The menu offers **Save current search**, a name field (prefilled), and the saved list for this view.
3. Clicking a saved search replaces the search text. The namespace and sort are not changed or saved.
4. The user removes a saved search with its Remove button. A one-line Undo remains while the menu is open.

### 2.15 Show or hide node columns (#25)

1. The Nodes view opens with Pool, Zone and Instance type hidden.
2. The user opens the existing column menu (gear) and ticks them. The choice persists.
3. A node missing a label shows "—". Hover or focus shows which label key was used.

---
## 3. Wireframes

Width context is given for each. Glyphs: `✕` critical, `▲` warning, `ⓘ` info/hint, `●` applies, `◐` may apply, `▸ ▾` collapsed/expanded. Severity is always glyph plus word. Roles are named in section 7.

### 3.1 ClusterOverview entry point (Pods view only, card about 220 px wide)

```
┌───────────────────────────┐
│ ▦ PROBLEM PODS            │
│ 3 pods                    │
│ 2 CrashLoop · 1 Failed    │
│ Open Problems →           │   new, a link, mute role, underlined on hover and focus
└───────────────────────────┘
```

- The count and its sub-line keep today's source (CrashLoop plus Failed).
- When the count is 0 the sub-line reads "No CrashLoop or Failed pods" in the dim role, not "All healthy" (H2).
- The link is "Open Problems" with an arrow glyph. It never shows a number, so it cannot disagree with the card.

### 3.2 Problems page, full window (main area about 1000 px)

```
TopBar: [●] ctx / all ▾ / problems                      ⟳  [Filter findings…   ]
┌────────────────────────────────────────────────────────────────────────────┐
│ Problems                                  Checked 14:02:11  What is checked ▾│
│ All namespaces · 12 findings                                               │
│                                                                            │
│ ⓘ Partially visible. Couldn't read 2 sources: events (forbidden),          │
│   nodes (forbidden). Rules that need them didn't run.        [Show which ▾]│
│                                                                            │
│ ┌──────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐  Rule: [All ▾]│
│ │ ALL    12│ │ ✕ CRITICAL 4│ │ ▲ WARNING  6│ │ ⓘ INFO    2│               │
│ └──────────┘ └─────────────┘ └─────────────┘ └────────────┘               │
│ Kubernetes keeps events for about 1 hour. Older causes may not appear.     │
│                                                                            │
│ ▾ ✕ Critical · 4                                                           │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ ✕ Critical  Crash loop                                                 │ │
│ │   Pod shop/api-7d9f8c-xk2lp · container "api"                          │ │
│ │   Container "api" is in CrashLoopBackOff.          ▸ Evidence   Open ↗ │ │
│ ├────────────────────────────────────────────────────────────────────────┤ │
│ │ ✕ Critical  Out of memory                                              │ │
│ │   Pod shop/worker-5b6c-q9d2m · container "worker"                      │ │
│ │   Last termination was OOMKilled and the container restarted 6 times.  │ │
│ │                                                ▾ Evidence   Open ↗     │ │
│ │   ┌────────────────────────────────────────────────────────────────┐   │ │
│ │   │ Field  status.containerStatuses[worker].lastState.terminated.  │   │ │
│ │   │        reason                                                  │   │ │
│ │   │        OOMKilled                                               │   │ │
│ │   │ Field  spec.containers[worker].resources.limits.memory         │   │ │
│ │   │        256Mi                                                   │   │ │
│ │   └────────────────────────────────────────────────────────────────┘   │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ ▾ ▲ Warning · 6                                                            │
│ │ … rows …                                                                 │
│ ▸ ⓘ Info · 2   (collapsed)                                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

Anatomy (HEALTH-SHELL):

| Zone | Content |
|---|---|
| Title row | "Problems" (page title), CHECKED-LINE on the right ("Checked 14:02:11"), a **What is checked** disclosure |
| Scope line | "All namespaces" or "Namespace shop", then the finding count: "12 findings" |
| Partial strip | Only when `skipped` is non-empty. Directly above the cards, never replacing the list (STATE-VOCAB 4.2) |
| Filter cards | Severity cards: All, Critical, Warning, Info. Each is a toggle button showing glyph, word and count. A **Rule** menu narrows by one rule, with counts. |
| Events note | Always visible once data has loaded, including when there are zero findings (4.1) |
| Groups | Severity group headers (button, `aria-expanded`), then rows. Info starts collapsed. |

**Why severity cards plus a Rule menu, not a card per rule.** There are 11 rules plus the certificate finding. A card per rule is about 15 cards: they do not fit in 480 or 900 px and push the list below the fold. Severity answers "what first"; the Rule menu answers "only the crash loops" (section 9 X4).

**FINDING-ROW (Problems lead):**

| Slot | Content |
|---|---|
| Lead | Severity glyph, severity word, rule label ("Crash loop") |
| Object | Kind label, `namespace/name`, then `· container "<name>"` when present. Monospace for the name. |
| Summary | The backend's one-sentence summary, verbatim |
| Evidence | A disclosure button ("Evidence", with the count when more than one). Opens a block of evidence rows under the row. |
| Open | A button "Open" with an arrow glyph. Jumps to the object (2.1 step 7). |

**Evidence block.** One row per evidence item:

- Field evidence: label "Field", then the path in monospace, then the value in monospace on the next line when long.
- Event evidence: label "Event", the age ("4m ago"), the event reason, then the message. Directly under the last event row: "Kubernetes keeps events for about 1 hour. Older causes may not appear."
- Values are shown verbatim (the backend truncates at 500 characters). A long value wraps. It never adds a horizontal scroll bar to the page.

**Narrow (main area below about 720 px).**

```
~ 480 px main area
┌────────────────────────────────────────────┐
│ Problems                       Checked 14:02│
│ All namespaces · 12 findings               │
│ [ALL 12][✕ 4][▲ 6][ⓘ 2]   Rule: [All ▾]    │
│ ✕ Critical  Crash loop                     │
│   Pod shop/api-7d9f8c-xk2lp                │
│   container "api"                          │
│   Container "api" is in CrashLoopBackOff.  │
│   ▸ Evidence                      Open ↗   │
└────────────────────────────────────────────┘
```

Cards stay on one row (glyph and count; the word moves to the accessible name and tooltip below 560 px). The Rule menu wraps below them. The row stacks lead, object, summary and actions.

### 3.3 "What is checked" disclosure (Problems)

```
┌───────────────────────────────────────────────┐
│ What is checked                               │
│ Fixed rules over fields and events Watchtower │
│ can read. There is no score or grade.         │
│  ✕ Crash loop, Out of memory, Image pull      │
│    failing, Init container failing,           │
│    Can't be scheduled, Node not ready,        │
│    Certificate expired                        │
│  ▲ Workload unavailable, Job failed, Service  │
│    has no ready endpoints, Volume claim       │
│    pending, Certificate expiring              │
│  ⓘ No readiness probe                         │
│ Certificates: cert-manager isn't installed,   │
│ so only TLS Secrets were checked.             │
└───────────────────────────────────────────────┘
```

The last line appears only when the `cert` presence is `absent`. The disclosure is read on demand and changes nothing.

### 3.4 Problems empty and degraded variants (body area)

```
Nothing here                              Partially visible, nothing found
┌──────────────────────────────┐          ┌─────────────────────────────────┐
│ ○  No problems found in      │          │ ⓘ  Nothing found in what could  │
│    namespace shop.           │          │    be read.                     │
│    Checked 11 rules at       │          │    Couldn't read pods           │
│    14:02:11. Kubernetes keeps│          │    (forbidden), so pod rules    │
│    events for about 1 hour,  │          │    didn't run.                  │
│    so an older cause may not │          │    [Try a namespace]            │
│    appear. This is not a     │          └─────────────────────────────────┘
│    guarantee that everything │
│    works.                    │
└──────────────────────────────┘
```

### 3.5 Explain card and the "Problem found" chip (480 px panel, Summary tab)

```
Panel header (480 px)
┌──────────────────────────────────────────────┐
│ api-7d9f8c-xk2lp                       ✕ Close│
│ shop · Running                                │
│ [✕ Problem found: 2 · Why?]                   │   chip, only when findings exist
├──────────────────────────────────────────────┤
│ Overview  Summary  Containers  Events  Logs … │

Summary tab, card first
┌──────────────────────────────────────────────┐
│ Why is this unhealthy?        Checked 14:02:11│
│ ✕ Critical · Crash loop · container "api"     │
│ Container "api" is in CrashLoopBackOff.       │
│   Field  …state.waiting.reason                │
│          CrashLoopBackOff                     │
│   Field  …lastState.terminated.reason         │
│          OOMKilled                            │
│   Event  4m ago · BackOff                     │
│          Back-off restarting failed container │
│ ─────────────────────────────────────────     │
│ ✕ Critical · Out of memory · container "api"  │
│ …                                             │
│ Kubernetes keeps events for about 1 hour.     │
│ Older causes may not appear.                  │
│ [Open Logs] [Open Events] [See in Problems]   │
└──────────────────────────────────────────────┘
```

Rules:

- The card is the first block of Summary, above "Managed by" and Conditions. Evidence is **expanded** here (the card exists to explain), unlike the Problems page where it is collapsed.
- Several findings stack, Critical first, separated by a hairline. Findings for one container sit together under the container name.
- Links are existing tabs (Logs, Events; for workloads, Pods) and **See in Problems**, which jumps to the Problems page. Nothing writes or fixes. There is no "Fix" button anywhere (section 8).
- The **Problem found** chip is a button. It sets the tab to Summary and moves focus to the card heading. It is the only cue on the default Overview tab (H10). If frontend capacity is short, drop the chip; the card still ships and the gap is recorded.
- Helm and ArgoCD panels have no Summary tab: no card, by design (n/a rows in 4.2).

**Quiet states of the card** (one line, `mute` role, no card chrome):

```
Checked, nothing found (covered kinds only):
ⓘ Problems check: nothing found for this object (14:02:11). It runs a fixed set of rules and is not a health score.

While running:    Checking this object…
Could not run:    ⓘ Problems check unavailable: couldn't read pods (forbidden).
```

Kinds the rules do not cover (ConfigMaps, Roles and so on) show nothing, because "nothing found" would imply they were examined.

**Workloads.** A Deployment's own findings are `workload-unavailable`. The pods behind it that are crashing are the usual cause, and the contract has no owner link on a finding (section 10 Q1). With that link the card adds a second block, **In its pods**, listing counts by rule ("3 pods: Crash loop") with an **Open Pods tab** link. Without the link the card shows only the object's own findings and says: "Findings in this workload's pods appear on the Problems page."

### 3.6 Node capacity page, full window

```
TopBar: [●] ctx / node capacity                        ⟳  [Filter nodes…      ]
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Node capacity                                              Checked 14:02:11       │
│ 6 nodes · CPU requests 41.2 of 64 cores (64%) · Memory requests 98 of 128 Gi (77%)│
│ Bars: fill = requests · marker = current usage · tinted = limits.                 │
│                                                                                   │
│ NODE            CPU                          MEMORY                    PODS  NO LIMITS│
│ ● ip-10-0-1-12  2400m of 3920m requested     11.2 of 15.0 Gi requested 42/110   4   │
│                 61% [██████████░░░░░░|░░░]   75% [████████████░░░|░░]               │
│                 Limits 142% · usage 1850m    Limits 160% · usage 9.8 Gi             │
│ ● ip-10-0-1-19  3700m of 3920m requested     …                         108/110   9   │
│                 ▲ High 94% [███████████████▌|░]                                      │
│                 Limits 310% ▸ (over 100%)                                            │
│ ○ ip-10-0-2-03  Allocatable unavailable                                  —           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

NODE-CAPACITY-BAR (extends DualZoneBar, with different semantics):

| Element | Meaning | Encoding |
|---|---|---|
| Fill | Sum of effective pod requests as a share of **allocatable** (what the scheduler counts) | `bar-low` below 65%, `bar-mid` 65 to 84%, `bar-high` 85% and above |
| Marker | Current usage (metrics-server) | A thin vertical mark in the `ink` role, only when usage is available |
| Limit zone | Requests up to limits, clamped at the bar's end, with an overflow cue ("▸") when limits exceed 100% | The `bar-*` role at reduced emphasis (a `surface-tint` blend) |
| Numbers | Always printed beside the bar: "2400m of 3920m requested", "61%", "Limits 142%", "usage 1850m" | Text in `ink` and `mute` roles |
| High cue | At 85% and above: a `▲` glyph and the word "High" next to the percentage | Never colour alone |

A legend line sits above the table ("Bars: fill = requests · marker = current usage · tinted = limits.") because this bar's fill means something different from the Containers tab bar. See section 9 X6.

Row behaviour:

- Click or Enter on the node name jumps to the node in the Nodes view. The rest of the row is not interactive.
- "No limits" counts pods with at least one app container lacking a CPU or memory limit. The header tooltip says so. It is a count, not a severity.
- The totals line sums only nodes whose allocatable is known, and says so when some are excluded: "6 nodes (1 without allocatable data)".
- Units follow COPY-RULES 9.6: CPU in millicores with `m`; memory in `Mi` or `Gi`.
- Sorting: the default is requested CPU share, descending. Numeric columns are sortable.

**NodeStrip overlay (a node card in the Pods view, about 200 px wide):**

```
┌───────────────────────────┐
│ ● ip-10-0-1-19         W  │
│ CPU  [██████░|░░░░]  58%  │   usage fill (as today) + new requests tick |
│ MEM  [████░░░|░░░░]  41%  │
│ REQ  cpu 94% · mem 77%    │   new row, mono, dim role; ▲ when 85% or above
│ pods 108/110              │
└───────────────────────────┘
```

- The overlay adds a tick on each existing bar at the requests share, plus one `REQ` text row. It adds no new card chrome and no new link.
- The existing bars show usage as a share of whatever `cpu_percent` uses today. The new tick and row use **allocatable**. The tooltip on the REQ row says "Requests, as a share of allocatable." Whether the existing percentage should also move to allocatable is open question Q6.
- The existing threshold changes from 80% to 85% so the strip agrees with the rest of the app (H5).
- The overlay is progressive. If the capacity query is loading, failed or denied, the card shows today's content with no error text (the Node capacity page owns the explanation).

### 3.7 Right-sizing hint in the Containers tab (480 px panel)

```
┌──────────────────────────────────────────────┐
│ ● api                                  RUNNING│
│ ghcr.io/acme/api:2.3.1                        │
│ CPU     [██░░░░░|░░░░░░░░░░░░░░]       18m    │
│         req: 100m              lim: 500m      │
│ Memory  [██████████████████░|░░]      486Mi   │
│         req: 256Mi             lim: 512Mi     │
│ ┌────────────────────────────────────────────┐│
│ │ ▲ Hint  Memory reached 95% of its limit    ││
│ │ (486Mi of 512Mi) in the last 20 samples.   ││
│ │ Based on current usage only.               ││
│ └────────────────────────────────────────────┘│
│ restarts 6 · exec · logs                      │
└──────────────────────────────────────────────┘
```

HINT-ROW rules:

- It sits directly under the bars of that container and above the restarts row. One row per fired hint, at most one per resource and kind.
- The **Hint** label is a word in the row, always present. The glyph is `ⓘ` for oversized and `▲` for "close to the limit", with the word in the text. The `▲` here is a plain status marker. The "no warning triangle on non-destructive actions" rule (CONFIRM-ANATOMY C2) concerns dialogs.
- The row quotes the container's **own** request and limit and the observed peak in absolute units. It never quotes a percentage of the 2x fallback mark (H6) and never shows a suggested value.
- Quiet lines replace hints when none can be shown: "Collecting samples (4 of 10)." and "Hints need metrics-server, which isn't installed on this cluster." (from the `metrics` presence key).
- Init containers show no hint row (they run to completion).

### 3.8 Constraints section in Summary (480 px panel)

```
┌──────────────────────────────────────────────┐
│ Constraints                                  │
│ ● Applies: matched from labels or namespace. │
│ ◐ May apply: can't be fully evaluated here.  │
│                                              │
│ RESOURCE QUOTAS                              │
│ ● compute-quota   Applies to every pod in    │
│                   namespace shop.   Open ↗   │
│ LIMIT RANGES                                 │
│   None in namespace shop.                    │
│ POD DISRUPTION BUDGETS                       │
│ ● web-pdb         Applies. Selects pods with │
│                   app=web.          Open ↗   │
│ ◐ batch-pdb       May apply. Uses label      │
│                   expressions.      Open ↗   │
│ PRIORITY CLASS                               │
│ ● high-priority   Applies. Set on the pod.   │
│                                     Open ↗   │
│ ADMISSION WEBHOOKS                           │
│ ◐ kyverno-resource-validating-webhook-cfg    │
│   May apply to pods on CREATE, UPDATE.       │
│   Has a namespace selector. If it is         │
│   unreachable, requests are rejected         │
│   (failure policy: Fail).          Open ↗    │
└──────────────────────────────────────────────┘
```

- Each group is its own query, so each has its own state line (Loading, None, No access, Error). The section never shows one error for all.
- Placement: after Pod Template (workloads) or Conditions (pods), before Field managers.
- Wording: **Applies** is allowed only for exact matches (quotas, limit ranges, priority class, label-subset PDBs). **May apply** is used for webhooks and for PDBs with expressions. Webhook rows never say "applies" (section 8).
- Applies and May apply differ by glyph (`●` versus `◐`) and word, not by colour. Both use a neutral role: neither is a good or a bad state.
- Detail text uses only facts the contract carries: operations, scope, selector presence, failure policy, labels. It never claims a webhook "will" run.

### 3.9 Nodes view with the new columns (full window)

```
Nodes                                       6                    ⚙ Columns ▾
NAME            STATUS   SCHEDULABLE   VERSION   CPU %   MEM %   PODS   AGE   (POOL) (ZONE) (INSTANCE TYPE)
                                                                              hidden until ticked
Column menu
┌───────────────────────┐
│ ☑ Status              │
│ ☐ Pool                │
│ ☐ Zone                │
│ ☐ Instance type       │
└───────────────────────┘
Cell:  system-pool        tooltip: from label eks.amazonaws.com/nodegroup
Cell:  —                  tooltip: no pool label found
```

### 3.10 VIEW-STATE blocks for CRD-backed views (#15), centred in the table body

```
Not installed                          No access
┌──────────────────────────────┐       ┌────────────────────────────────────┐
│ ▣  Certificates isn't        │       │ ⛉  You don't have access to        │
│    installed on this cluster.│       │    Gateways in namespace shop.     │
│    The Certificate custom    │       │    Your account can't list         │
│    resource isn't available. │       │    gateways. Ask a cluster admin   │
└──────────────────────────────┘       │    for the list permission.        │
                                       │    [Try another namespace]         │
Nothing here, presence unknown         └────────────────────────────────────┘
┌──────────────────────────────┐
│ ○  No volume snapshots in    │
│    namespace shop.           │
│    Couldn't confirm whether  │
│    VolumeSnapshots is        │
│    installed.                │
└──────────────────────────────┘
```

The table header row stays (STATE-VOCAB 4.2). The icon is always shown with its text.

### 3.11 Possibly unused page, full window

```
TopBar: [●] ctx / all ▾ / possibly unused                  ⟳  [Filter findings…   ]
┌────────────────────────────────────────────────────────────────────────────┐
│ Possibly unused                                       Checked 14:02:11      │
│ All namespaces except kube-system, kube-public and kube-node-lease · 9 found│
│ ⓘ Dynamic references and consumers outside the cluster aren't visible.      │
│   Treat every row as a question, not an answer.     [How this was checked ▾]│
│                                                                             │
│ [ALL 9][ConfigMaps 4][Secrets 2][PVCs 1][Roles 1][Workloads 1]              │
│ ▾ ConfigMaps · 4                                                            │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ ConfigMap  shop/legacy-feature-flags                                    │ │
│ │ Not referenced by any pod or workload template.   ▸ Evidence   Open ↗   │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ▾ Secrets · 2   …                                                           │
└────────────────────────────────────────────────────────────────────────────┘

How this was checked (disclosure)
┌───────────────────────────────────────────────────────────────┐
│ A ConfigMap or Secret counts as referenced when a pod, a       │
│ workload template, an Ingress, a Gateway listener, a service   │
│ account or a cert-manager Certificate points at it, including  │
│ init containers, projected volumes and env sources.            │
│ Always skipped: service account token and Helm release Secrets,│
│ Argo CD repository Secrets, kube-root-ca.crt.                  │
│ This can be wrong when an app reads the object through the API │
│ at run time, something outside the cluster uses it, or an      │
│ operator reads a field this check doesn't scan. Secret values  │
│ are never read.                                                │
└───────────────────────────────────────────────────────────────┘
```

- The FINDING-ROW lead here is the **kind** (a neutral pill), not a severity. The page never uses the words "problem" or "warning". It never says "unused" without "possibly". There is no checkbox column, no select-all, no delete control and no shortcut that deletes (section 8).
- Evidence shows the reason in words and the backend `detail` verbatim.
- Nav label, title, group headers, empty state and tooltips all say "possibly unused".

### 3.12 Deprecated APIs page, full window

```
TopBar: [●] ctx / all ▾ / deprecated apis                 ⟳  [Filter findings…   ]
┌────────────────────────────────────────────────────────────────────────────┐
│ Deprecated APIs                                       Checked 14:02:11      │
│ Cluster runs Kubernetes 1.28 · Table covers Kubernetes up to 1.34 · 3 found │
│ ⓘ Checks Helm release manifests and kubectl last-applied annotations only.  │
│   It doesn't scan live objects or files in git.                             │
│                                                                             │
│ [ALL 3][Removed 1][Deprecated 2]                                            │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ ✕ Removed   policy/v1beta1 PodDisruptionBudget                          │ │
│ │   web-pdb in Helm release shop/web                                      │ │
│ │   Deprecated in 1.21, removed in 1.25. Use policy/v1.                   │ │
│ │                                                  ▸ Evidence   Open ↗    │ │
│ ├─────────────────────────────────────────────────────────────────────────┤ │
│ │ ▲ Deprecated  autoscaling/v2beta2 HorizontalPodAutoscaler               │ │
│ │   web in kubectl last-applied annotation (shop)                         │ │
│ │   Deprecated in 1.23, removed in 1.26. Use autoscaling/v2.              │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘

Cluster newer than the table
┌────────────────────────────────────────────────────────────────────────────┐
│ ▲ This cluster runs Kubernetes 1.36. The table covers up to 1.34, so APIs  │
│   removed after 1.34 won't be reported. Fewer findings here is not a clean │
│   result.                                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

Status words for the lead slot (computed from the cluster's version and the entry's `removed_in`, section 10 Q11):

| Condition | Word | Glyph | Role |
|---|---|---|---|
| `removed_in` known and the cluster's minor version is at or above it | Removed | `✕` | `status-bad` |
| `removed_in` known and the cluster is below it | Deprecated | `▲` | `status-warn` |
| `removed_in` not known | Deprecated | `ⓘ` | `status-info` |

The Evidence block says whether the cluster still serves the version ("This cluster still serves policy/v1beta1."), the source ("Helm release manifest" or "kubectl last-applied-configuration annotation"), and the Helm release when there is one.

The staleness wording is "Table covers Kubernetes up to <X>" (v1.4.1 wording). The brief's "table updated for Kubernetes ≤ X" says the same thing; the plainer form is used so it reads aloud cleanly (section 9 X11).

### 3.13 Who can… page, full window

```
TopBar: [●] ctx / who can                                  ⟳
┌────────────────────────────────────────────────────────────────────────────┐
│ Who can…                                                    ⓘ Hint          │
│ Computed from RBAC bindings. This isn't a check of your own access, and     │
│ admission webhooks or non-RBAC authorizers can still allow or deny.         │
│                                                                             │
│ Verb        Resource                    Subresource      Namespace          │
│ [ list   ▾] [ pods                   ▾] [ (optional)   ] [ shop          ▾] │
│ Cluster-wide shows only grants that apply in every namespace.               │
│ [ Find subjects ]                                                           │
│                                                                             │
│ ⓘ Partially visible. Couldn't read cluster role bindings (forbidden).       │
│   The list may be incomplete.                              [Show which ▾]   │
│                                                                             │
│ Service accounts · 3                                                        │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ shop/ci-deployer                                                        │ │
│ │ In namespace shop · RoleBinding ci → ClusterRole edit                   │ │
│ │ [Wildcard] [Limited to 2 named objects ▸]                       Open ↗  │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ Groups · 2     Users · 1  …                                                 │
│                                                                             │
│ Notes                                                                       │
│  • Computed from RBAC bindings. Admission webhooks and non-RBAC authorizers │
│    (for example cloud IAM mappings) are not visible here.                   │
│  • ClusterRole view is aggregated and its rules are not filled in yet;      │
│    results may be incomplete.                                               │
└────────────────────────────────────────────────────────────────────────────┘
```

- The form never sends on change. **Find subjects** (or Enter in any field) runs the query. It is on demand, with no interval.
- Resource field: a combobox of known kinds, plus the cluster's custom resources, plus free text. Free text accepts `resource`, `resource.group` and `resource/subresource`, as kubectl does. The mapping from text to API group is open question Q8.
- The Namespace select has "Cluster-wide" first, then namespaces. The line beneath it explains the difference. It is hidden when the chosen resource is cluster-scoped.
- Result groups: Service accounts, Groups, Users. Each row: the subject (service accounts show `namespace/name`), the scope in words ("Cluster-wide" or "In namespace shop"), the binding and role, and tags for **Wildcard** (the matching rule used `*`) and **Limited to N named objects** (a disclosure listing them).
- Notes from the backend are always visible and never collapsed. They are fixed strings (`v1.4.1-tasks.md` §2.4).
- Rows have no actions other than **Open** (the binding; for a service account, the service account). "View as" belongs to #34 (3.19).

### 3.14 Permissions section in a Service Account's Summary (480 px panel)

```
┌──────────────────────────────────────────────┐
│ Permissions                          ⓘ Hint   │
│ Computed from RBAC bindings. Admission        │
│ webhooks and non-RBAC authorizers are not     │
│ visible here.                                 │
│ CLUSTER-WIDE                                  │
│ ClusterRoleBinding ci-view → ClusterRole view │
│   pods, services, configmaps   get list watch │
│ IN NAMESPACE shop                             │
│ RoleBinding ci → ClusterRole edit             │
│   deployments.apps    get list create update… │
│   [Wildcard] all verbs on all resources       │
│ ▸ Show 6 more rules                           │
└──────────────────────────────────────────────┘
```

- Rows are grouped by scope, then by binding. A wildcard row carries the tag **Wildcard** and the words "all verbs" or "all resources", not only `*`.
- Named-object grants read "only pods named a, b" (a disclosure over three names).
- Non-resource URLs are their own group, "Non-resource URLs".
- After three bindings the rest collapse behind "Show N more rules".
- On a Role Binding or Cluster Role Binding panel the same section lists the bound subjects, and each subject row expands to its permissions on demand (one query per expanded subject).
- On a Role or Cluster Role panel the section is **Bound to**: the subjects of every binding that references it, from the lists already cached (section 9 X10).

### 3.15 Secret reveal (480 px panel, Overview tab)

```
Before reveal                                 After reveal
┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────┐
│ Type  Opaque                            │   │ Type  Opaque                            │
│ Keys  3 keys                            │   │ Keys  3 keys                            │
│ DATA                  [Eye] Reveal values │   │ DATA  Revealed  [Decode all] [Hide values]│
│ ─────────────────────────────────────── │   │ ─────────────────────────────────────── │
│ DB_PASSWORD             12 bytes        │   │ DB_PASSWORD         [Decode] [Copy]     │
│   ••••••••                              │   │   cGFzc3dvcmQxMjM0                      │
│ tls.crt                 1.2 KiB         │   │ tls.crt             [Decode] [Copy]     │
│   ••••••••                              │   │   LS0tLS1CRUdJTi…                       │
│ EMPTY_KEY               empty value     │   │ EMPTY_KEY           empty value         │
│ Values are hidden. Reveal fetches this  │   │ Showing base64. Decode converts to text.│
│ Secret from the cluster.                │   │ Values are discarded when you close this│
└─────────────────────────────────────────┘   │ panel or hide them.                     │
                                              └─────────────────────────────────────────┘
YAML tab before reveal
┌─────────────────────────────────────────┐
│ Secret values are hidden.               │
│ The YAML tab shows base64 values. Reveal│
│ them to read the YAML or edit it.       │
│ [ Reveal values ]                       │
└─────────────────────────────────────────┘
```

- Reveal is **per object** (T41-1), not per key. The single button sits on the DATA heading row.
- A hidden row shows the key, its size and a fixed mask. The mask never reflects the real length; only the size column does. "empty value" means size 0.
- After reveal, the per-row **Decode** and **Decode all** keep today's behaviour (base64 to text, local, no fetch). Their labels change from "reveal" to "decode" so the two words stay distinct (H7).
- **Revealed** is a visible status (text plus the `status-info` role, not colour alone), shown in the DATA heading row. It remains while the panel is open, across tab switches. **Hide values** discards the fetched object at once.
- The footer line states the lifetime in plain words.
- The TLS tab is unchanged and needs no reveal. It parses on the backend and shows no private key (section 8).
- The guided Secret editor opens without an extra step and counts as a reveal. The editor header carries one line: "Editing shows this Secret's values." (Polish.)
- Copy exists only after reveal and copies the visible form (base64 or decoded), as today.

### 3.16 Helm Values tab (480 px panel and 900 px panel)

```
Redacted (default)                            Revealed (read only)
┌────────────────────────────────────────┐   ┌────────────────────────────────────────┐
│ ⓘ Credential-looking values are        │   │ Revealed  [Hide values] [Edit] [Copy]  │
│   redacted. Comments aren't shown in   │   │ ────────────────────────────────────── │
│   this view.                           │   │ db:                                    │
│ [Reveal values] [Reveal and edit…]     │   │   password: s3cr3t                     │
│ [Copy redacted text]                   │   │ replicas: 3                            │
│ ────────────────────────────────────── │   └────────────────────────────────────────┘
│ db:                                    │
│   password: <redacted by Watchtower>   │   Edit mode with a leftover placeholder
│ replicas: 3                            │   ┌────────────────────────────────────────┐
└────────────────────────────────────────┘   │ Editing — will run helm upgrade [cancel]│
                                             │ [Review upgrade…] (disabled)           │
Parse failure                                │ A redacted value is still in the edit. │
┌────────────────────────────────────────┐   │ Reveal it or remove it first.          │
│ # Values could not be parsed for       │   │ ┌────────────────────────────────────┐ │
│ # redaction. Use Reveal to view them.  │   │ │ password: <redacted by Watchtower>  │ │
│ [Reveal values] [Reveal and edit…]     │   │ └────────────────────────────────────┘ │
└────────────────────────────────────────┘   └────────────────────────────────────────┘
```

The redacted placeholder must be **unreachable** in an upgrade, not just warned about (brief, #33):

1. There is **no Edit button** in the redacted view. The only way to edit is **Reveal and edit…**, which fetches the original text and seeds the editor from it alone. A disabled Edit button in the redacted view would invite a workaround, so none exists.
2. The editor is seeded from the revealed data only. The redacted text is never an input to any editor.
3. If the text in the editor contains the placeholder anyway (a paste, a changed mind), **Review upgrade…** is disabled with the reason above, announced through DISABLE-PRECEDENCE (D1: focusable, `aria-disabled`). The backend also refuses (v1.4.1 §2.2), as the second line of defence.
4. A successful upgrade returns the tab to the redacted view.
5. **Copy** in the redacted view is labelled "Copy redacted text" so it is never mistaken for copying the real values.
6. The upgrade gate (UX-03) masks credential-looking rows with a per-row **Show**. Show is available because the release was revealed, and it starts masked even then (a diff gets screenshotted; 03 D3-3).

### 3.17 Journal page, full window

```
TopBar: [●] ctx / journal                                  ⟳  [Filter journal…    ]
┌────────────────────────────────────────────────────────────────────────────┐
│ Journal                                                                     │
│ Actions performed from this app on this machine                             │
│ Records what Watchtower sent, not what the cluster did afterwards. Secret   │
│ values are never recorded. Writes blocked by read-only mode aren't recorded │
│ because nothing was sent.                                                   │
│ Keeps recent entries only, up to about 25 MiB. Older entries are deleted.   │
│                                                                             │
│ Cluster [All ▾]   Kind [All ▾]   Result [All ▾]                             │
│                                                                             │
│ TIME     CLUSTER        VERB            OBJECT           SUMMARY      RESULT│
│ 3m ago   ● prod-eu-1    scale_workload  deploy shop/api  replicas=5   ✓ Accepted│
│ 12m ago  ● staging      patch_resource  sec shop/db      keys: password (values not recorded)  ✓ Accepted│
│ 14m ago  ● prod-eu-1    delete_pod      pods shop/api-…  grace=default ✕ Failed│
│            ▾ forbidden: pods "api-7d9f" is forbidden …                      │
│                                            [ Load older ]                   │
└────────────────────────────────────────────────────────────────────────────┘
```

- The cluster cell is the identity chip (colour **and** label text), as in ConfirmModal. A context no longer in the kubeconfig shows its name with the default identity.
- Time shows relative, with the absolute UTC time on hover and focus. Verb is shown verbatim in monospace (open question Q7).
- **Accepted** means the API server returned success. It does not mean the change finished taking effect (tooltip). **Failed** rows expand to the scrubbed message.
- The page has no row actions, no selection, no clear and no export (v1.4.1 §1.2).

### 3.18 Saved-search menu in the TopBar (#40)

```
TopBar right side:  ⟳  [Search] Search resources…  ✕ [Bookmark]  [+ New ▾]

Menu (about 300 px), anchored under the bookmark button
┌────────────────────────────────────────────┐
│ Saved searches for Pods                    │
│ ┌────────────────────────────────────────┐ │
│ │ crashloop                      ✕ Remove │ │
│ │ api-                           ✕ Remove │ │
│ └────────────────────────────────────────┘ │
│ Save current search                        │
│ Name [ app=api                          ]  │
│ [ Save ]                                   │
│ Saves the search text only. The namespace  │
│ and sort aren't saved.                     │
└────────────────────────────────────────────┘
```

- The button is a `Bookmark` icon button, 32 px (the same size as refresh), placed immediately after the search box. It is hidden on non-resource views.
- With an empty search, **Save** is disabled with "Type a search first."
- At 20 saved searches, **Save** is disabled with "20 saved searches is the limit. Remove one first."
- Saving a name that exists replaces it, and the button then reads **Replace**.
- Removing shows "Removed "crashloop". Undo" for as long as the menu stays open.
- A corrupt store reads as empty, and the menu says once: "Saved searches couldn't be read, so the list is empty."

### 3.19 Impersonation (#34), low-fi, backlog

```
Full window, impersonating
┌────────────────────────────────────────────────────────────────────────────┐
│ [Alert] VIEWING AS  system:serviceaccount:shop:ci-deployer  on prod-eu-1   [Exit] │  fixed banner role, above TopBar
├────────────────────────────────────────────────────────────────────────────┤
│ TopBar … (the breadcrumb adds the chip "as ci-deployer")                    │
```

- Style: the fixed `banner-impersonation` role (not an identity colour, not themeable by the accent), full width, text plus icon, persistent on every view while active, above the TopBar, never scrolling away.
- One click on **Exit** ends it, with no confirm. Entering uses a non-destructive `md` ConfirmModal with the identity badge: "Send requests as <subject>?" with the consequence "Every request, including writes, is sent as this subject until you exit. Your own permissions don't apply."
- Entry points: a "View as…" action on a Who can row and on a Service Account panel. Whether read-only mode forces impersonation to read-only is open question Q15.
- Announcements: "Now viewing as <subject>." and "Stopped viewing as <subject>." (polite).
- Per context: switching cluster ends it, with the same announcement.
- States are in 4.17.

### 3.20 The (b) items for the backlog

- **#21 cert-manager chain, #22 Flux, #27 typed add-on panels:** each new view uses `GenericResourceTable` plus VIEW-STATE and is Not installed aware from its presence key. Add-on panels (KEDA, Karpenter, Kyverno) are Summary-tab sections that follow the FINDING-ROW evidence rules and the 00 qualifier glossary. #22's suspend, resume and reconcile reuse `ArgoCdActionBar` and ConfirmModal. Reconcile is non-destructive. Suspend is non-destructive and states "Stops reconciling until resumed". Every dialog carries `contextLabel` and `contextColor`.
- **#26 printer columns:** they render as ordinary columns. A JSONPath that fails renders "—" with the tooltip "Couldn't read <path>", never a broken table or a thrown error.

---

## 4. States

Every view has all eight rows. Terms follow STATE-VOCAB. A row that does not apply says **n/a** with a reason. Reading the rows:

- **Denied** covers both an explicit SSAR deny on a control (hint, fails open) and a list that came back 403 (STATE-VOCAB "No access").
- **Read-only** is #29's read-only mode. Most surfaces here only read, so they are n/a with that reason. Reads are never blocked by read-only mode (the brief's cross-package rule 4 concerns writes).
- **Not installed** is the CRD-absent state from #15.
- **Unreachable** is the cluster trust state (not `ok`). For cluster views it shows "Can't reach <cluster label>." with Retry and defers to the banner for the long text (STATE-VOCAB). App-local views are n/a.
- Namespace "all" is never a state (STATE-VOCAB 4.3).

### 4.1 Problems page

| State | Behaviour |
|---|---|
| Loading | First load: skeleton of six finding rows, title area "Checking for problems…", card counts show "—". A background refetch keeps the rows, updates CHECKED-LINE, and shows the spinning refresh button. |
| Nothing here | "No problems found in <scope>." plus the checked rule count and time, the events note and "This is not a guarantee that everything works." If `skipped` is also non-empty, the page shows the **Partially visible, nothing found** variant instead: "Nothing found in what could be read." It never says "No problems found" while a source was skipped. |
| Error | "Couldn't check for problems." plus `<message>` and **Retry**. If earlier results exist they stay, with the strip "Couldn't refresh. Showing results from 14:02:11." |
| Denied | No SSAR hint on this page (it reads). When every source is skipped, or the **pods** source is skipped and no finding came back, the page shows **No access**: "You don't have access to pods in <scope>. Your account can't list pods. Ask a cluster admin for the list permission." with **Try a namespace** when the scope is all namespaces. Pods carry most rules; showing "partial" over an empty list would read as clean (section 9 X2). |
| Read-only | n/a: the page reads and navigates only. Nothing here writes. |
| Not installed | n/a: no rule needs a CRD. cert-manager's absence is a quiet line in "What is checked" (3.3). |
| Partially visible | A strip above the cards lists each skipped source with its verbatim reason and the rules that did not run. The list below keeps working. The strip is not dismissible while the condition holds. |
| Unreachable | "Can't reach <cluster label>." with **Retry**. Cached rows, if any, are hidden behind it (stale cluster data could mislead). |

The overview link (3.1) is static text with no state of its own. The card keeps its existing skeleton while cluster info loads.

### 4.2 Explain card ("Why is this unhealthy?")

| State | Behaviour |
|---|---|
| Loading | One quiet line: "Checking this object…". No skeleton block. |
| Nothing here | Covered kinds: the quiet line "Problems check: nothing found for this object (<time>). It runs a fixed set of rules and is not a health score." Kinds the rules do not cover: nothing is shown (n/a: "nothing found" would imply they were examined). |
| Error | Quiet line "Problems check unavailable: <message>." with a **Retry** text button. |
| Denied | A skipped source relevant to this kind: "Problems check unavailable: couldn't read <source> (forbidden)." No SSAR (n/a: read). |
| Read-only | n/a: the card reads and links to existing tabs. |
| Not installed | n/a: rules for this object depend on core kinds. A cert-manager Certificate that exists proves the CRD is installed. |
| Partially visible | Findings from sources that ran are shown, plus one line: "Some sources couldn't be read: events. Event evidence is missing." |
| Unreachable | Quiet line "Problems check unavailable: can't reach <cluster label>." The panel's own states are unchanged. |

Panels without a Summary tab (Helm releases, ArgoCD apps) show no card and no chip: n/a, the surface does not exist there. The "Problem found" chip appears only when findings exist for the object and is absent in every other state.

### 4.3 Node capacity page

| State | Behaviour |
|---|---|
| Loading | Skeleton of six node rows with two bar placeholders each; the totals line reads "Checking capacity…". |
| Nothing here | "No nodes found." (STATE-VOCAB skeleton.) A node with no pods is not empty: it shows 0% requests. |
| Error | "Couldn't load node capacity." plus `<message>` and **Retry**. |
| Denied | The capacity needs a cluster-wide pod list. A forbidden pod list shows **No access**: "Node capacity needs a cluster-wide pod list. Your account can't list pods in all namespaces. Ask a cluster admin for the list permission." A forbidden node list shows the standard No access for nodes. The page recognises a 403 through the one shared helper described in open question Q5, not through per-view string matching. |
| Read-only | n/a: read-only page. |
| Not installed | metrics-server absent (presence key `metrics`): a strip above the table, "Current usage isn't shown: metrics-server isn't installed on this cluster. Requests and limits are still accurate." The usage marker is omitted. This is a partial-data note, not a page-level state. |
| Partially visible | A node whose allocatable could not be read shows "Allocatable unavailable", no bar and no percentage, and is excluded from the totals (the totals line says so). Nodes without a usage sample omit the marker. |
| Unreachable | "Can't reach <cluster label>." with **Retry**. |

### 4.4 NodeStrip requests overlay

| State | Behaviour |
|---|---|
| Loading | The card shows today's content. The overlay is absent. No skeleton for it. |
| Nothing here | n/a: a node with no pods shows "REQ cpu 0% · mem 0%". |
| Error | The overlay is absent. No text (the Node capacity page owns the explanation). |
| Denied | Same as Error: overlay absent, no text. |
| Read-only | n/a: read-only surface. |
| Not installed | n/a: requests do not need metrics-server. The existing usage bars already handle missing metrics. |
| Partially visible | A node with unreadable allocatable shows no tick, and the REQ row reads "REQ —". |
| Unreachable | Today's behaviour; the trust banner owns it. |

### 4.5 Right-sizing hint (Containers tab)

| State | Behaviour |
|---|---|
| Loading | No hint row while metrics load. No skeleton (a skeleton would promise a hint). |
| Nothing here | With 10 or more samples and no rule firing, nothing is shown. The absence of a hint is not stated as "fine". |
| Error | `list_pod_metrics` swallows errors (knowingly kept), so a failure looks like missing data: "Current usage isn't available right now." when `metrics` is installed. |
| Denied | n/a: no SSAR gates a read. A 403 on metrics is swallowed and reads as the line above. |
| Read-only | n/a: advisory text only. |
| Not installed | "Hints need metrics-server, which isn't installed on this cluster." (from the `metrics` presence key). |
| Partially visible | A container with fewer than 10 samples shows "Collecting samples (N of 10)." Other containers keep their hints. A container with no limit gets no "close to the limit" hint, and one with no request gets no "oversized" hint. A missing limit or request is not itself a hint. |
| Unreachable | n/a: the Containers tab already depends on the pod being loaded; no hint row is drawn. |

### 4.6 Constraints section (Summary tab)

Each of the five groups has its own state.

| State | Behaviour |
|---|---|
| Loading | Per group: "Loading <group>…". Groups already loaded render immediately. |
| Nothing here | Per group: "None in namespace <ns>." Webhooks: "None configured on this cluster." |
| Error | Per group: "Couldn't load <group>: <message>." with **Retry**. |
| Denied | Per group: "You don't have access to <resource>." Webhooks, which developers often cannot list, add: "Webhooks that may apply can't be listed." |
| Read-only | n/a: read-only surface. |
| Not installed | n/a: every group is a core API kind. |
| Partially visible | The section is partial whenever groups differ in state. There is no summary strip. Each group states its own condition so the user sees exactly which answers are missing. |
| Unreachable | One line for the whole section: "Can't reach <cluster label>." with **Retry**, not five repeats. |

### 4.7 Nodes view columns (#25)

| State | Behaviour |
|---|---|
| Loading | The existing skeleton rows. The three columns are hidden by default, so they add no skeleton cells until ticked. |
| Nothing here | The existing "No nodes found". |
| Error | The existing error block with **Retry**. |
| Denied | The existing error block. The Nodes view does not yet use VIEW-STATE; adding it is a one-line follow-up (section 10 Q12). |
| Read-only | n/a: columns are display only. |
| Not installed | n/a: nodes are core. |
| Partially visible | A node without any matching label shows "—" in that cell, with the tooltip "No pool label found" (or zone or instance type). On a cluster where no node has any of the labels, the column menu shows the entries unchanged. |
| Unreachable | Existing banner and error block. |

### 4.8 CRD-backed views (#15 VIEW-STATE)

Applies to Flux Kustomizations, Flux HelmReleases, Gateways, HTTPRoutes, Certificates, Volume Snapshots, ArgoCD Apps, ApplicationSets and Projects. (Repositories read Secrets, not a CRD, and is n/a.)

| State | Behaviour |
|---|---|
| Loading | The table header with skeleton rows and "Loading <things>…". If the list already returned rows, show them at once (rows prove the kind is installed). If the list returned zero rows, wait for presence before choosing a state, so Nothing here never flashes before Not installed. |
| Nothing here | Presence `installed` and an empty list: "No <things> in <scope>." Presence `unknown` and an empty list: the same, plus "Couldn't confirm whether <things> is installed." |
| Error | Any other error: "Couldn't load <things>." plus `<message>` and **Retry**. A presence query that errors on its own is treated as `unknown`, so the view is never worse than v1.3.1. |
| Denied | `installed` or `unknown` with a list 403: **No access** copy. The existing action bars (Argo sync, refresh) keep their own SSAR hints and fail-open rule. This state adds none. |
| Read-only | n/a: the state renderer writes nothing. The views' existing actions keep their read-only behaviour (03). |
| Not installed | Presence `absent`: "<Thing> isn't installed on this cluster. The <Kind> custom resource isn't available." No link, because there is no stable public URL (STATE-VOCAB). |
| Partially visible | n/a: one list call returns all or an error, so a mixed result is not observable. If a per-namespace fan-out is ever added it would show the standard strip. |
| Unreachable | The list and the presence query both fail with a connection error: "Can't reach <cluster label>." with **Retry**. |

Evaluation order is the one in STATE-VOCAB (Unreachable, No access, Not installed, Error, Partially visible, Nothing here). The mapping in `v1.4.0-tasks.md` §2.2 gives the same result: `absent` yields no 403 in practice because a missing CRD returns 404, which the commands turn into an empty list.

### 4.9 Possibly unused

| State | Behaviour |
|---|---|
| Loading | Skeleton rows and "Checking for possibly unused objects…". On-demand: no background polling. |
| Nothing here | "Nothing looks possibly unused in <scope>." plus the qualifier line: "Dynamic references and consumers outside the cluster aren't visible." It never says "everything is used". |
| Error | "Couldn't check for possibly unused objects." plus `<message>` and **Retry**. |
| Denied | All sources forbidden: **No access** ("Your account can't list pods, so references can't be checked."). One or more **reference** sources forbidden: rules that need them do not run (section 10 Q10) and the page is Partially visible. A false "possibly unused" caused by an unreadable pod list is the worst outcome of this page, so those rules must not run. |
| Read-only | n/a: no write control exists on this page by design. |
| Not installed | n/a: core kinds. Gateway and cert-manager references are checked only when those CRDs are installed. "How this was checked" says so. |
| Partially visible | Strip: "Couldn't read pods (forbidden). ConfigMaps, Secrets, PVCs and service accounts weren't checked." Kinds that were checked still list. |
| Unreachable | "Can't reach <cluster label>." with **Retry**. |

### 4.10 Deprecated APIs

| State | Behaviour |
|---|---|
| Loading | Skeleton rows and "Scanning for deprecated APIs…". On-demand. |
| Nothing here | "No deprecated APIs found in Helm releases or last-applied annotations in <scope>." plus "Table covers Kubernetes up to <X>." and the scope sentence. If the cluster is newer than the table the stronger note stays and the page does not use the word "clean". |
| Error | "Couldn't scan for deprecated APIs." plus `<message>` and **Retry**. A table-load failure shows the backend message verbatim ("Failed to load deprecation table: …"). |
| Denied | Helm release Secrets forbidden: Partially visible with only last-applied annotations checked. Both sources forbidden: **No access**. |
| Read-only | n/a: read-only page. |
| Not installed | n/a: Helm is not a CRD. A cluster with no Helm releases shows the Nothing here copy. |
| Partially visible | Strip: "Couldn't read Helm release Secrets (forbidden). Only kubectl last-applied annotations were checked." |
| Unreachable | "Can't reach <cluster label>." with **Retry**. |

### 4.11 Who can page

| State | Behaviour |
|---|---|
| Loading | The form stays. The button shows a spinner and "Looking up bindings…". Before any query: "Choose a verb and a resource, then find subjects." |
| Nothing here | "No bindings grant "<verb> <resource>" in <scope>." plus "Access may still come from outside RBAC, for example cloud IAM or an authorizing webhook." plus the notes. Never "No one can". |
| Error | "Couldn't look up bindings." plus `<message>` and **Retry**. |
| Denied | All RBAC sources forbidden: **No access**: "You don't have access to roles and bindings. Your account can't list them. Ask a cluster admin for the list permission." The page does not call SSAR and never answers the user's own access. |
| Read-only | n/a: read-only page. |
| Not installed | n/a: RBAC is a core API. |
| Partially visible | Strip naming each skipped source ("cluster role bindings (forbidden)") and "The list may be incomplete." This is the common case for non-admins. |
| Unreachable | "Can't reach <cluster label>." with **Retry**. |

### 4.12 Permissions section (SA, Role, ClusterRole, RoleBinding, ClusterRoleBinding panels)

| State | Behaviour |
|---|---|
| Loading | "Looking up permissions…". On demand: runs when Summary opens (or when a subject row is expanded on a binding panel). |
| Nothing here | "No bindings grant this service account any permissions." plus the notes. For Bound to: "No bindings reference this role." |
| Error | "Couldn't look up permissions." plus `<message>` and **Retry**. |
| Denied | "You don't have access to bindings, so permissions can't be computed." when the lists are forbidden. |
| Read-only | n/a: read-only surface. |
| Not installed | n/a: core API. |
| Partially visible | Strip naming skipped sources: "Couldn't read cluster role bindings (forbidden). The list may be incomplete." |
| Unreachable | "Can't reach <cluster label>." with **Retry**. |

### 4.13 Secret reveal (Overview and YAML tabs)

| State | Behaviour |
|---|---|
| Loading | After **Reveal values**: the button shows a spinner and "Revealing…". Rows stay hidden. |
| Nothing here | A Secret with no keys: "This Secret has no data." There is no Reveal button, since nothing can be fetched. |
| Error | Inline under DATA: "Couldn't load the values: <message>." with **Retry**. Rows stay hidden. |
| Denied | Explicit SSAR deny on `get` for Secrets in this namespace: **Reveal values** is disabled with the reason "Your account can't read the values of Secrets in namespace <ns>." (DISABLE-PRECEDENCE position 3). Fail open otherwise. A server 403 after the click shows the Error row with the server text plus "Your account can list Secrets but can't read their values." |
| Read-only | **Reveal is not blocked** (it is a read). Only **Edit** and the guided editor are disabled, with the read-only reason. |
| Not installed | n/a: Secrets are core. |
| Partially visible | n/a: one object. |
| Unreachable | The existing banner shows. A reveal attempt fails with "Can't reach <cluster label>." and stays hidden. |

### 4.14 Helm Values tab

| State | Behaviour |
|---|---|
| Loading | The existing skeleton lines. During a reveal the clicked button shows a spinner and the view stays redacted until the fetch ends. |
| Nothing here | Empty values: "No custom values — using chart defaults" with one button, **Add values…**, which reveals (an empty string) and enters edit mode. |
| Error | Redacted fetch failed: error block with **Retry**. Reveal failed: inline "Couldn't load the values: <message>." with **Retry**, and the view stays redacted. |
| Denied | The release Secret cannot be read: the error line above plus "Your account can't read this release's Secret." The existing `valuesReason` (SSAR and read-only) disables **Reveal and edit…** and the revealed view's **Edit**. **Reveal values** is a read and stays enabled. |
| Read-only | **Reveal and edit…** and **Edit** are disabled with "Read-only mode (Watchtower guardrail). Turn off in cluster settings." (DISABLE-PRECEDENCE position 2). **Reveal values** and **Copy redacted text** keep working. |
| Not installed | n/a: values come from the release Secret, not a CRD. (A missing `helm` binary is an upgrade-time error owned by UX-03.) |
| Partially visible | n/a: one release. |
| Unreachable | The existing banner and error block. |

### 4.15 Journal page

| State | Behaviour |
|---|---|
| Loading | Skeleton rows and "Loading the journal…". |
| Nothing here | "No actions recorded yet. Writes you make from this app appear here." Filtered: "No entries match these filters." with **Clear filters**. At the end of a long list: "End of journal. Older entries are deleted automatically." |
| Error | "Couldn't read the journal: <message>" with **Retry**. |
| Denied | n/a: app-local file, no cluster permission involved. |
| Read-only | n/a: the page only reads. Writes blocked by read-only mode are not recorded; the header says so. |
| Not installed | n/a: app-local. |
| Partially visible | n/a: a truncated last line is skipped silently by the reader and is not visible. |
| Unreachable | n/a: app-local; the cluster's state does not matter. |

### 4.16 Saved searches (TopBar menu)

| State | Behaviour |
|---|---|
| Loading | n/a: read synchronously from local storage. |
| Nothing here | "No saved searches for Pods yet." |
| Error | Storage unavailable: the list is empty, **Save** is disabled with "Saved searches can't be stored in this session." A corrupt store reads as empty with the one-time note in 3.18. |
| Denied | n/a: local only. |
| Read-only | n/a: it saves local UI text, not a cluster write. |
| Not installed | n/a: local only. |
| Partially visible | n/a: a malformed entry is dropped silently. |
| Unreachable | n/a: local only. |

### 4.17 Impersonation banner (low-fi, backlog)

| State | Behaviour |
|---|---|
| Loading | The confirm shows "Switching…". The banner appears only after the first request succeeds as the subject. |
| Nothing here | n/a: not a list. |
| Error | The server refused: the dialog stays open with "<message>. Your account may not be allowed to impersonate this subject." No banner. |
| Denied | SSAR deny on the `impersonate` verb: "View as…" is disabled with the reason "Your account can't impersonate users or service accounts." (fails open when unknown). |
| Read-only | Open question Q15. Recommendation: impersonation does not bypass read-only; the banner shows both. |
| Not installed | n/a. |
| Partially visible | Permission hints under impersonation answer for the subject, not the user (data need, Q15). Until then, hints are hidden and the banner says so. |
| Unreachable | Impersonation ends with the announcement, and the cluster's unreachable state shows as usual. |

---

## 5. Microcopy

Tone and structure follow COPY-RULES: terse, factual, no exclamation marks, no emoji, object names in straight double quotes inside sentences, server messages verbatim and never rewritten (Tauri rejects with a plain string, so `<message>` is the extracted text). Quotes are shown here with straight marks.

### 5.1 Navigation and TopBar

| Surface | Copy |
|---|---|
| Sidebar section | HEALTH |
| Sidebar entries | Problems · Node capacity · Possibly unused · Deprecated APIs · Who can… (Access Control) · Journal (footer) |
| ⌘K entries | Group "Health": Problems, Node capacity, Possibly unused, Deprecated APIs. Group "Access Control": Who can… Group "App": Journal |
| Breadcrumb (lowercase, as today) | `problems` · `node capacity` · `possibly unused` · `deprecated apis` · `who can` · `journal` |
| Search placeholder | "Filter findings…" (Problems, Possibly unused, Deprecated APIs) · "Filter nodes…" · "Filter journal…" |
| Saved-search button | Tooltip "Saved searches"; accessible name "Saved searches for <view>" |
| Overview card link | "Open Problems" |
| Overview card zero sub-line | "No CrashLoop or Failed pods" |

### 5.2 Problems

| Element | Copy |
|---|---|
| Title | Problems |
| Scope line | "All namespaces · 12 findings" · "Namespace shop · 1 finding" |
| CHECKED-LINE | "Checked 14:02:11" |
| Card labels | "All 12" · "Critical 4" · "Warning 6" · "Info 2". Accessible name: "Critical, 4 findings, filter". |
| Rule menu | Label "Rule". Options "All rules" then each rule label with its count. |
| Group headers | "Critical · 4" · "Warning · 6" · "Info · 2" |
| Severity words | Critical · Warning · Info |
| Events note (always) | "Kubernetes keeps events for about 1 hour. Older causes may not appear." |
| Row buttons | "Evidence" (with "Evidence (2)" when more than one) · "Open" · tooltip on Open: "Open pod shop/api-7d9f8c-xk2lp" |
| Evidence labels | "Field" · "Event" · "Event, 4m ago" |
| Partial strip | "Partially visible. Couldn't read 2 sources: events (forbidden), nodes (forbidden). Rules that need them didn't run." Action "Show which". Expanded: each source, the verbatim reason, and the rules affected. |
| Empty | "No problems found in namespace shop." / "No problems found in all namespaces." Detail: "Checked 11 rules at 14:02:11. Kubernetes keeps events for about 1 hour, so an older cause may not appear. This is not a guarantee that everything works." |
| Empty, partial | "Nothing found in what could be read." Detail: "Couldn't read pods (forbidden), so pod rules didn't run." Action "Try a namespace" (only when the scope is all namespaces). |
| No access | "You don't have access to pods in all namespaces." Detail: "Your account can't list pods. Ask a cluster admin for the list permission." |
| Error | "Couldn't check for problems." plus `<message>`. Action "Retry". Stale: "Couldn't refresh. Showing results from 14:02:11." |
| Resolved (live region) | "Resolved: Crash loop, pod shop/api-7d9f8c-xk2lp." |
| What is checked | Heading "What is checked". Body: "Fixed rules over fields and events Watchtower can read. There is no score or grade." |

**Rule labels (frontend):**

| Rule | Severity | Label |
|---|---|---|
| `crashloop` | Critical | Crash loop |
| `oom-killed` | Critical | Out of memory |
| `image-pull` | Critical | Image pull failing |
| `init-failing` | Critical | Init container failing |
| `unschedulable` | Critical | Can't be scheduled |
| `node-not-ready` | Critical | Node not ready |
| `workload-unavailable` | Warning | Workload unavailable |
| `job-failed` | Warning | Job failed |
| `service-no-endpoints` | Warning | Service has no ready endpoints |
| `pvc-pending` | Warning | Volume claim pending |
| certificate (frontend only) | Critical when expired, Warning when expiring | Certificate expired · Certificate expiring |
| `missing-probes` | Info | No readiness probe |

**Certificate findings** are built in the frontend from `expiryState`. The only inputs are the label and the sign of `deltaMs`; there is no second threshold (section 9 X5).

| Case | Summary | Evidence |
|---|---|---|
| Expired (delta below 0) | "Certificate "web-tls" expired 3d ago." | Field "Not valid after" with the timestamp |
| Expiring (delta at or above 0 and `expiryState` is bad) | "Certificate "web-tls" expires in 3d." | Same, plus "Not valid before" when known |
| TLS Secret | "TLS Secret "web-tls" expires in 3d." | Same |

Certificates inside the expiry window show the same relative label the Certificates view and the TLS tab show.

### 5.3 Explain card

| Element | Copy |
|---|---|
| Title | Why is this unhealthy? |
| Header chip | "Problem found: 2" with the tooltip "Open the Summary tab to see why." Accessible name: "2 problems found for this object. Open Summary." |
| Checked | "Checked 14:02:11" |
| Events note | "Kubernetes keeps events for about 1 hour. Older causes may not appear." (shown when any evidence item is an event) |
| Links | "Open Logs" · "Open Events" · "Open Pods" · "See in Problems" |
| Workload without owner data | "Findings in this workload's pods appear on the Problems page." |
| Workload with owner data | Block title "In its pods". Rows "3 pods: Crash loop". |
| Quiet lines | See 3.5 and 4.2. |

### 5.4 Node capacity

| Element | Copy |
|---|---|
| Title | Node capacity |
| Totals | "6 nodes · CPU requests 41.2 of 64 cores (64%) · Memory requests 98 of 128 Gi (77%)" · "(1 without allocatable data)" |
| Legend | "Bars: fill = requests · marker = current usage · tinted = limits." |
| Column headers | Node · CPU · Memory · Pods · No limits |
| CPU cell | "2400m of 3920m requested", "61%", "Limits 142% · usage 1850m" |
| Memory cell | "11.2 of 15.0 Gi requested", "75%", "Limits 160% · usage 9.8 Gi" |
| High cue | "High" (with `▲`) at 85% and above. Tooltip: "Requests are at 85% or more of allocatable." |
| Over 100% limits | "Limits 310% (over 100%)" |
| No limits header tooltip | "Pods with at least one container that has no CPU or memory limit." |
| No limits cell | "4 pods" (never "unsafe", never "risky") |
| Unavailable | "Allocatable unavailable" |
| Metrics note | "Current usage isn't shown: metrics-server isn't installed on this cluster. Requests and limits are still accurate." |
| No access | "Node capacity needs a cluster-wide pod list. Your account can't list pods in all namespaces. Ask a cluster admin for the list permission." |
| Overlay REQ tooltip | "Requests, as a share of allocatable." |

### 5.5 Right-sizing hints

All hints end "Based on current usage only." The label "Hint" is always present. None shows a suggested value.

| Case | Copy |
|---|---|
| Memory near limit | "Hint  Memory reached 95% of its limit (486Mi of 512Mi) in the last 20 samples. Based on current usage only." |
| CPU near limit | "Hint  CPU reached 93% of its limit (465m of 500m) in the last 20 samples. It may be throttled. Based on current usage only." |
| Oversized (CPU) | "Hint  CPU stayed under 25% of its request (peak 18m, request 100m) across the last 20 samples. The request may be larger than needed. Based on current usage only." |
| Oversized (memory) | "Hint  Memory stayed under 25% of its request (peak 40Mi, request 256Mi) across the last 20 samples. The request may be larger than needed. Based on current usage only." |
| Too few samples | "Collecting samples (4 of 10) before a hint can be shown." |
| Samples tooltip | "Samples are taken by this app while it is open. A restarted pod starts again from zero." |
| No metrics-server | "Hints need metrics-server, which isn't installed on this cluster." |
| Metrics unavailable | "Current usage isn't available right now." |

The words "recommended", "right size", "optimal" and "should be" never appear (00 §9.4). The oversized wording reads "may be larger than needed", not "reduce to".

### 5.6 Constraints

| Element | Copy |
|---|---|
| Title | Constraints |
| Legend | "● Applies: matched from labels or namespace." · "◐ May apply: can't be fully evaluated here." |
| Group headers | Resource quotas · Limit ranges · Pod disruption budgets · Priority class · Admission webhooks |
| Quota row | ""compute-quota"  Applies to every pod in namespace shop." |
| Limit range row | ""defaults"  Applies to every pod in namespace shop." |
| PDB row (labels) | ""web-pdb"  Applies. Selects pods with app=web." |
| PDB row (expressions) | ""batch-pdb"  May apply. Uses label expressions, which Watchtower doesn't evaluate." |
| Priority row | ""high-priority"  Applies. Set on the pod." · "Applies. Cluster default class." |
| Webhook row | ""<name>"  May apply to pods on CREATE, UPDATE." plus "Has a namespace selector." and/or "Has an object selector." plus "If it is unreachable, requests are rejected (failure policy: Fail)." / "(failure policy: Ignore)." |
| Group states | "None in namespace shop." · "None configured on this cluster." · "Loading quotas…" · "You don't have access to webhook configurations. Webhooks that may apply can't be listed." |
| Open link | "Open" with tooltip "Open <kind> <name>" |

### 5.7 CRD-backed views (#15)

Pattern from STATE-VOCAB: "<Thing> isn't installed on this cluster." then "The <Kind> custom resource isn't available."

| View | Not installed | No access (namespace shop) | Nothing here |
|---|---|---|---|
| Flux Kustomizations | "Flux isn't installed on this cluster. The Kustomization custom resource isn't available." | "You don't have access to Kustomizations in namespace shop. Your account can't list kustomizations. Ask a cluster admin for the list permission." | "No Kustomizations in namespace shop." |
| Flux HelmReleases | "Flux isn't installed on this cluster. The HelmRelease custom resource isn't available." | "…HelmReleases… can't list helmreleases…" | "No HelmReleases in namespace shop." |
| Gateways | "Gateway API isn't installed on this cluster. The Gateway custom resource isn't available." | "You don't have access to Gateways in namespace shop. Your account can't list gateways. Ask a cluster admin for the list permission." (00 §4.4) | "No Gateways in namespace shop." |
| HTTPRoutes | "Gateway API isn't installed on this cluster. The HTTPRoute custom resource isn't available." | "…HTTPRoutes… can't list httproutes…" | "No HTTPRoutes in namespace shop." |
| Certificates | "cert-manager isn't installed on this cluster. The Certificate custom resource isn't available." (00 §4.4) | "…Certificates… can't list certificates…" | "No certificates in namespace shop." |
| Volume Snapshots | "Volume snapshots aren't set up on this cluster. The VolumeSnapshot custom resource isn't available." | "…volume snapshots… can't list volumesnapshots…" | "No volume snapshots in namespace shop." (00 §4.4) |
| ArgoCD Apps | "Argo CD isn't installed on this cluster. The Application custom resource isn't available." | "…Applications… can't list applications…" | "No Applications in <scope>." |
| ApplicationSets | "Argo CD isn't installed on this cluster. The ApplicationSet custom resource isn't available." | "…ApplicationSets…" | "No ApplicationSets in <scope>." |
| Projects | "Argo CD isn't installed on this cluster. The AppProject custom resource isn't available." | "…AppProjects…" | "No AppProjects in <scope>." |

Other copy:

- Presence unknown subtitle: "Couldn't confirm whether Certificates is installed." (uses the view's plural, with the verb matching it).
- Action on No access, namespace-scoped views only: "Try another namespace".
- The cluster-wide scope replaces "in namespace shop" with "in all namespaces".
- Error: "Couldn't load <things>." plus `<message>`. Action "Retry".

### 5.8 Possibly unused

| Element | Copy |
|---|---|
| Title / nav / tooltips | "Possibly unused" |
| Scope line | "All namespaces except kube-system, kube-public and kube-node-lease · 9 found" · "Namespace shop · 3 found" |
| Qualifier (always visible) | "Dynamic references and consumers outside the cluster aren't visible. Treat every row as a question, not an answer." |
| Disclosure | "How this was checked" (body in 3.11) |
| Card labels | "All 9" and one per kind: "ConfigMaps 4", "Secrets 2", "PVCs 1", "PVs 0" omitted when zero |
| Group headers | "ConfigMaps · 4" |
| Empty | "Nothing looks possibly unused in namespace shop." plus the qualifier. |
| Row lead | Kind pill: ConfigMap · Secret · PVC · PV · Role · Cluster role · Service account · Deployment · StatefulSet |
| Row action | "Open" only |

Reason sentences (the backend `detail` is shown verbatim beneath in Evidence):

| `reason` | Sentence |
|---|---|
| `not-referenced` | "No reference found from pods, workload templates, Ingresses, Gateways, service accounts or Certificates." |
| `not-mounted` | "Bound, but no pod or workload template mounts it." |
| `unbound` | "Not bound to a claim." |
| `no-binding` | "No role binding references it, and it isn't an aggregation target." |
| `no-pods` | "No pod or workload template uses it." |
| `zero-replicas` | "Scaled to zero replicas." |

There is no "Delete", "Clean up" or "Remove" anywhere on this page. A tooltip on Open says "Open <kind> <name>. Delete from its own panel." (a pointer, not an action).

### 5.9 Deprecated APIs

| Element | Copy |
|---|---|
| Title | Deprecated APIs |
| Header | "Cluster runs Kubernetes 1.28 · Table covers Kubernetes up to 1.34 · 3 found" |
| Scope sentence | "Checks Helm release manifests and kubectl last-applied annotations only. It doesn't scan live objects or files in git." |
| Cluster newer than table | "This cluster runs Kubernetes 1.36. The table covers up to 1.34, so APIs removed after 1.34 won't be reported. Fewer findings here is not a clean result." |
| Status words | Removed · Deprecated |
| Row | "policy/v1beta1 PodDisruptionBudget" · "web-pdb in Helm release shop/web" · "Deprecated in 1.21, removed in 1.25. Use policy/v1." · when `removed_in` is unknown: "Deprecated in 1.21. No removal is planned." |
| Evidence | "Source: Helm release manifest" / "Source: kubectl last-applied-configuration annotation" · "This cluster still serves policy/v1beta1." / "This cluster no longer serves policy/v1beta1." |
| Cards | "All 3" · "Removed 1" · "Deprecated 2" |
| Empty | "No deprecated APIs found in Helm releases or last-applied annotations in namespace shop. Table covers Kubernetes up to 1.34." |

### 5.10 Who can and Permissions

| Element | Copy |
|---|---|
| Title / label | Who can… · "Hint" |
| Intro | "Computed from RBAC bindings. This isn't a check of your own access, and admission webhooks or non-RBAC authorizers can still allow or deny." |
| Form labels | Verb · Resource · Subresource (optional) · Namespace |
| Namespace help | "Cluster-wide shows only grants that apply in every namespace." |
| Button | "Find subjects" |
| Verb options | get · list · watch · create · update · patch · delete · deletecollection · "any verb (*)" |
| Group headers | "Service accounts · 3" · "Groups · 2" · "Users · 1" |
| Row scope | "Cluster-wide" · "In namespace shop" |
| Row tags | "Wildcard" · "Limited to 2 named objects" |
| Notes (verbatim from the backend) | "Computed from RBAC bindings. Admission webhooks and non-RBAC authorizers (for example cloud IAM mappings) are not visible here." · "ClusterRole {name} is aggregated and its rules are not filled in yet; results may be incomplete." · "Binding {name} references {kind} {role}, which does not exist." |
| Empty | "No bindings grant "list pods" in namespace shop. Access may still come from outside RBAC, for example cloud IAM or an authorizing webhook." |
| Partial | "Partially visible. Couldn't read cluster role bindings (forbidden). The list may be incomplete." |
| Permissions section title | Permissions · "Hint" |
| Section scope headers | "Cluster-wide" · "In namespace shop" · "Non-resource URLs" |
| Wildcard words | "all verbs" · "all resources" |
| Overflow | "Show 6 more rules" |
| Bound to | "Bound to" · "No bindings reference this role." |

The copy never says "only these subjects can", "no one can" or "this account is safe". The word "SSAR" never appears in the UI.

### 5.11 Secret reveal

| Element | Copy |
|---|---|
| Hidden row | "<key>" · "12 bytes" · "1.2 KiB" · "empty value" · mask "••••••••" |
| Hidden footer | "Values are hidden. Reveal fetches this Secret from the cluster." |
| Reveal button | "Reveal values". Tooltip: "Fetch this Secret's values from the cluster. They are discarded when you close this panel." |
| Disabled reason | "Your account can't read the values of Secrets in namespace shop." |
| Revealing | "Revealing…" |
| Revealed status | "Revealed" |
| Hide button | "Hide values" |
| Decode controls | "Decode" · "Show as base64" · "Decode all" · "Show all as base64" |
| Revealed footer | "Showing base64. Decode converts to text. Values are discarded when you close this panel or hide them." |
| Error | "Couldn't load the values: <message>." plus, on a 403, "Your account can list Secrets but can't read their values." |
| YAML placeholder | "Secret values are hidden. The YAML tab shows base64 values. Reveal them to read the YAML or edit it." |
| Empty | "This Secret has no data." |
| Editor header line | "Editing shows this Secret's values." |

### 5.12 Helm Values

| Element | Copy |
|---|---|
| Redacted note | "Credential-looking values are redacted. Comments aren't shown in this view." |
| Buttons | "Reveal values" · "Reveal and edit…" · "Copy redacted text" · "Hide values" · "Edit" · "Add values…" (empty values) |
| Placeholder (backend text) | `<redacted by Watchtower>` |
| Parse failure (backend text) | "# Values could not be parsed for redaction. Use Reveal to view them." |
| Blocked reason (matches 03 §9.4) | "A redacted value is still in the edit. Reveal it or remove it first." |
| Read-only reason | "Read-only mode (Watchtower guardrail). Turn off in cluster settings." |
| Error | "Couldn't load the values: <message>." |
| Revealed status | "Revealed" |

### 5.13 Journal

| Element | Copy |
|---|---|
| Title / subtitle | Journal · "Actions performed from this app on this machine" |
| Explanation | "Records what Watchtower sent, not what the cluster did afterwards. Secret values are never recorded. Writes blocked by read-only mode aren't recorded because nothing was sent." |
| Retention line | "Keeps recent entries only, up to about 25 MiB. Older entries are deleted automatically." (numbers need confirming, Q7) |
| Filters | "Cluster" · "Kind" · "Result", each with "All" |
| Columns | Time · Cluster · Verb · Object · Summary · Result |
| Result | "Accepted" · "Failed". Tooltip: "Accepted means the API server returned success. It doesn't mean the change has finished taking effect." |
| Empty | "No actions recorded yet. Writes you make from this app appear here." |
| Filtered empty | "No entries match these filters." Action "Clear filters". |
| End of list | "End of journal. Older entries are deleted automatically." |
| Pagination | "Load older" |
| Error | "Couldn't read the journal: <message>" |

### 5.14 Saved searches

| Element | Copy |
|---|---|
| Menu title | "Saved searches for Pods" |
| Empty | "No saved searches for Pods yet." |
| Name label / button | "Name" · "Save" · "Replace" |
| Remove | "Remove" · "Removed "crashloop". Undo" |
| Footnote | "Saves the search text only. The namespace and sort aren't saved." |
| Disabled reasons | "Type a search first." · "20 saved searches is the limit. Remove one first." · "Saved searches can't be stored in this session." |
| Corrupt | "Saved searches couldn't be read, so the list is empty." |

### 5.15 Impersonation (low-fi)

| Element | Copy |
|---|---|
| Banner | "VIEWING AS system:serviceaccount:shop:ci-deployer on prod-eu-1" · button "Exit" |
| Confirm title / body | "View as ci-deployer" · "Every request, including writes, is sent as this subject until you exit. Your own permissions don't apply." · button "View as ci-deployer" |
| Announcements | "Now viewing as ci-deployer." · "Stopped viewing as ci-deployer." |
| Error | "<message>. Your account may not be allowed to impersonate this subject." |

### 5.16 Where each mandatory qualifier appears

| Qualifier (00 §9.5) | Required text | Placement here |
|---|---|---|
| events about 1 hour | "Kubernetes keeps events for about 1 hour. Older causes may not appear." | Problems (always visible, including empty), the evidence block of any event, the explain card, the empty-state paragraph |
| hint (#13) | "Hint" label and "Based on current usage only." | Every right-sizing HINT-ROW, no exceptions. Also "Hint" on Who can and Permissions. |
| may apply (#14) | "May apply" | Every webhook row, PDB rows with expressions, and the legend |
| possibly unused (#20) | "possibly unused" and "Dynamic references and consumers outside the cluster aren't visible." | Nav label, ⌘K entry, breadcrumb, page title, group headers, empty state, tooltips |
| point-in-time | "Based on current usage only." | #13 (the right-sizing form of the qualifier) |
| from this app (#31) | "Actions performed from this app on this machine" | Journal subtitle |
| read-only | "Read-only mode (Watchtower guardrail)" | Helm reveal-and-edit disabled reason; never "locked", "protected" or "secured" |
| table staleness (#19) | "Table covers Kubernetes up to <X>" | Deprecated APIs header and empty state |

### 5.17 Words this package never uses

"score", "grade", "health score", "smart", "AI", "auto-fix", "fix" as a button, "recommended value", "recommended", "optimal", "right-size" as an instruction, "safe", "protected", "secured", "locked", "applies" for a webhook, "unused" without "possibly", "no one can", "clean" for a result, "all healthy" as a verdict, "Apply" for Merge from file, "delete all", "clean up".

---

## 6. Keyboard and accessibility

### 6.1 Keymap check (KEYMAP 8.2, rule K6)

This package adds **no global shortcut**. Reserved keys are untouched.

| Key | Behaviour on the new surfaces | Conflict check |
|---|---|---|
| `⌘K` | Palette gains the entries in 5.1. | None. |
| `⌘N` | Does nothing on non-resource views (1.5 rule 1). | None. Unchanged on resource views. |
| `⌘,` | Settings, unchanged. | None. |
| `Esc` | Closes the topmost layer only (K3). On Health pages it closes an open disclosure, popover or menu first; it never leaves the page, and never closes a detail panel behind a menu. | None. |
| `r` | Refresh the active page's query (K1, K2). Ignored in the Who can form and the saved-search name field (editable targets). | None. |
| `⌘↵` | Not used. The Who can form uses plain Enter, because it is not a dialog. | None. |
| Single letters | None added. Next and previous finding use arrow keys inside the list (below), not a global key. | None. |

### 6.2 Focus order

**Problems, Possibly unused, Deprecated APIs:** Sidebar, TopBar controls, page header (What is checked, How this was checked), Show which (when present), filter cards, Rule menu, then the list.

**List composite.** The list is **one tab stop**, a roving focus across group headers and rows:

| Key | Behaviour |
|---|---|
| `↓` / `↑` | Next or previous row or group header |
| `Home` / `End` | First or last |
| `→` / `←` on a row | Expand or collapse Evidence |
| `→` / `←` on a group header | Expand or collapse the group |
| `Enter` on a row | **Open** the object (jump) |
| `Space` on a row | Toggle Evidence |
| `Tab` on a focused row | Moves to that row's Evidence button, then Open, then out of the list to the next control |

This is the keyboard "jump to object, next and previous finding" the brief asks for, without a new global key. Mouse and screen-reader users use the visible **Evidence** and **Open** buttons, which are real buttons in the DOM.

**After a refetch,** focus stays on the same finding id. If that finding disappears, focus moves to the next row, and a polite live region says "Resolved: <rule label>, <object>."

**Node capacity:** the table is a native table with sortable column headers (buttons). The node name is a link-styled button. Row focus is the name.

**Explain card:** the **Problem found** chip is a button in the panel header's tab order. Activating it moves focus to the card's heading, which has `tabindex` of -1 so it can receive programmatic focus. Evidence is expanded, so there are no disclosure controls to tab through.

**Constraints, Permissions:** each group has a heading. Open links are real links in reading order.

**Secret and Helm Values:** the **Reveal values** button precedes the rows. After a reveal, focus stays on the same control, whose label changes to **Hide values**. After **Hide values**, focus returns to **Reveal values**. After **Reveal and edit…** focus moves to the editor.

**Who can:** form fields in the order Verb, Resource, Subresource, Namespace, Find subjects, then results. After a query completes, focus stays on **Find subjects**, and a polite announcement reports the count.

**Saved-search menu:** the button opens a popover (the existing `Popover` pattern). Focus moves to the first saved search, or the name field when the list is empty. `Esc` closes it and returns focus to the button. Remove buttons are reachable by Tab. `Delete` does **not** remove an entry (no single-key destructive shortcut).

### 6.3 Screen-reader behaviour

| Surface | Semantics |
|---|---|
| Filter cards | `button` with `aria-pressed`. Name "Critical, 4 findings, filter". The glyph is `aria-hidden` because the word is in the name. |
| Group header | `button` with `aria-expanded`, controlling its list. Name "Critical, 4 findings". |
| Finding row | A list item. Name composed as "Critical. Crash loop. Pod shop/api-7d9f8c-xk2lp, container api. Container "api" is in CrashLoopBackOff. Collapsed. 3 of 12." (`aria-posinset` and `aria-setsize` across the whole list). |
| Evidence | Disclosure button `aria-expanded`. The block is a description list: "Field: <path>. Value: <value>." and "Event, 4m ago: <reason>. <message>." |
| Severity | The word is always visible text. The glyph is decorative (`aria-hidden`). |
| Capacity bar | The numbers are the accessible content. The bar is a `meter` or an `img` with a text alternative equal to the printed numbers ("CPU: 2400 of 3920 millicores requested, 61 percent. High."). Colour is never the only carrier: the percentage and the "High" word are text. |
| Constraints legend | "Applies" and "May apply" are text in each row. The glyphs are decorative. |
| Disabled controls | `aria-disabled` plus a description (D1), focusable. |
| Redacted values | The placeholder is read as written. The status "Revealed" is text. |
| Journal | A native table with column headers. Time cells contain a `time` element whose title carries the UTC time. |

**Live regions (A11Y-BASELINE 10.4):**

| Event | Politeness | Text |
|---|---|---|
| First load of a Health page | Polite | "Problems loaded. 12 findings, 4 critical." |
| User-initiated refresh | Polite | Same sentence, only when the counts changed |
| Background refresh | Silent, except resolved findings | "Resolved: …" (polite), and "New critical problem: …" (polite) |
| Partial strip appearing | Polite | "Partially visible. Couldn't read 2 sources." |
| Reveal succeeded or failed | Polite / assertive | "Values revealed." / the inline error (assertive) |
| Reveal hidden | Polite | "Values hidden." |
| Who can result | Polite | "3 service accounts, 2 groups, 1 user can list pods in namespace shop." (with "The list may be incomplete." when partial) |
| Saved search applied / removed | Polite | "Applied saved search crashloop." / "Removed crashloop." |

Announcements never repeat on every 30-second refetch.

### 6.4 Motion and zoom

- No flash or highlight when rows appear or change. Findings appear and disappear without animation, so reduced-motion needs no special case. The refresh spinner may keep rotating (A11Y-BASELINE).
- The refetch must not move the list under the user's pointer. Rows are keyed by finding id, order is deterministic, and an expanded row stays open.
- At 200% zoom the pages reflow to the narrow layout (3.2). Cards wrap, tables collapse rows into stacked blocks, and no horizontal scroll appears inside panels. The Node capacity table scrolls horizontally inside its own container, never the page.
- Targets are at least 24 by 24 px: cards, Evidence, Open, Remove, Reveal, Hide and the bookmark button all satisfy it.

---

## 7. Light and dark notes

All colour is by role (TOKEN-ROLES). UX-05 supplies values. Nothing here uses a literal.

| Surface | Roles | Notes |
|---|---|---|
| Severity glyphs and words | `status-bad` (Critical, Removed), `status-warn` (Warning, Deprecated), `status-info` (Info, Hint, Revealed) | The glyph carries the colour; the word is in `ink` so contrast does not depend on a coloured text on a pale light surface (`status-warn` text on white is the known risk). Glyph and word are both present always. |
| Filter cards | `surface-card` fill, `edge` ring, `accent` ring when active | Active state is also `aria-pressed` and a bolder count, not colour alone. |
| Evidence block | `surface-tint` fill, `edge` border, monospace in `ink` and `mute` | Not `surface-sunken`: that role is reserved for log and terminal panes. |
| Partial strip | `status-info` icon on `surface-tint`; text in `ink` | It is information, not a failure. The No access block uses `surface-card` with the shield icon in `mute`. |
| Capacity bar | Fill `bar-low`, `bar-mid`, `bar-high`; track `surface-tint`; usage marker `ink`; limit zone a reduced-emphasis `bar-*` | Fill against the track must reach 3:1 in both themes (non-text contrast). `bar-*` tokens do not exist in `tailwind.config.js` yet and are added by the frontend (`v1.4.0-tasks.md` §6). Today's NodeStrip, `Bar` and `DualZoneBar` use inline literals and raw utility colours; mapping them to `bar-*` is part of the same task. |
| Constraints | Neutral: `ink`, `mute`, `surface-tint` | `Applies` and `May apply` are not good or bad, so neither uses `status-ok` or `status-warn`. |
| Hint row | `status-info` icon, `surface-tint` fill, text `ink` | The near-limit variant uses the `status-warn` glyph with the word in `ink`. |
| Reveal state | `status-info` text plus a glyph | "Revealed" is never only a tint. |
| Journal | Identity chips use `identity-*` roles (colour plus label text); result glyphs `status-ok` and `status-bad` with words | Identity red and `status-bad` are both red-ish; shape separates them (chip versus glyph and word, 00 §6.2). |
| Impersonation banner | Fixed `banner-impersonation` | Not an identity role and not affected by the accent picker (#41). |
| Code and path text | Monospace in `ink` | Paths wrap; they are never truncated (DIFF-ROW precedent). |
| Disabled | `dim` text, `aria-disabled`, reason on hover and focus | As elsewhere. |

Light-theme risks to hand to UX-05: `status-warn` as small text; the `bar-mid` fill against a light track; the `▲`, `✕` and `ⓘ` glyph colours at 16 px; `identity-yellow` chips in the Journal.

---

## 8. Constraint checklist

Each hard constraint from the UX-04 brief (`docs/ux-task-briefs.md`), the (b) notes, the deliverables and the cross-package rules in §3 of that file, ticked with where this design satisfies it. `[x]` means satisfied by the design as written. Anything that depends on the tech lead's answer says so.

### 8.1 Hard constraints per item

| ✓ | Constraint | Where satisfied |
|---|---|---|
| [x] | **#11** Deterministic heuristics only. No score, no 0 to 100 grade | 3.2 (cards are counts by severity, never combined into one number), 3.3 ("There is no score or grade."), 1.5 rule 7 (no nav badge), 5.17 |
| [x] | **#11** Each finding states the evidence: which field and which event | 3.2 Evidence block (Field path and value, Event reason and age); 3.5 card with Evidence expanded; every FINDING-ROW has an Evidence control |
| [x] | **#11** Event-based hints carry the honesty note about the roughly one-hour event lifetime | "Kubernetes keeps events for about 1 hour. Older causes may not appear." Always visible on Problems, including the empty state (3.2, 3.4, 4.1); under every event evidence item; in the explain card (3.5). See X3 |
| [x] | **#11** "Explain why unhealthy" is a card in the object's own panel, not a separate screen | 3.5 (first block of Summary in both panels, plus the header chip) |
| [x] | **#13** A hint, never a "recommended value". "Based on current usage only." | 3.7, 5.5 (every hint ends with the qualifier; no suggested value), 5.16, 5.17 |
| [x] | **#14** Webhook matches read "may apply", never "applies". Exact matches may read "applies" | 3.8 and 5.6: webhooks and expression-based PDBs say "May apply"; quotas, limit ranges, priority class and label-subset PDBs say "Applies" |
| [x] | **#19** Findings name the API version and the Kubernetes version where it was removed | 3.12 row ("Deprecated in 1.21, removed in 1.25. Use policy/v1."), 5.9 |
| [x] | **#19** The table can go stale: show what it covers | 3.12 and 5.9: "Table covers Kubernetes up to <X>", plus the stronger note when the cluster is newer (X11, Q11) |
| [x] | **#20** "possibly unused" everywhere: nav label, headers, empty state | 1.5, 3.11, 5.1, 5.8, 5.16. The bare word "unused" is a forbidden word (5.17) |
| [x] | **#20** No bulk delete, no multi-select. Per-row navigation only | 3.11: no checkbox column, no select-all, no delete control. The only row action is Open. Deleting happens in the object's panel through the normal confirm (2.11) |
| [x] | **#20** State why the result can be wrong | 3.11 qualifier line (always visible) and "How this was checked" (dynamic references, outside consumers, unscanned operators) |
| [x] | **#15** The taxonomy applies to every CRD-backed view in this package, and to #21, #22, #27 | 3.10, 4.8, 5.7. #21, #22, #27 in 3.20 reuse VIEW-STATE. "Not looked at" is never a state, and "all" is never a data state (4.8, 4 intro) |
| [x] | **#32** The answer covers aggregated ClusterRoles and wildcards, or says which part is approximate | 3.13 and 3.14: **Wildcard** tag and "all verbs" words; the aggregated-role note and the missing-role note are always visible (5.10) |
| [x] | **#32** SSAR answers only for the current user. Who-can is computed from bindings. Copy must not conflate them | 3.13 intro: "This isn't a check of your own access". The page never calls SSAR (4.11). "SSAR" never appears in the UI (5.10) |
| [x] | **#32** Admission webhooks can still deny, so this is a hint | The **Hint** label on Who can and on Permissions, and the first note (5.10) |
| [x] | **#33** Lists show keys and sizes only. Values are fetched on reveal, per object | 3.15: key, size, mask. One **Reveal values** per object (2.7) |
| [x] | **#33** Reveal is an explicit action. Specify whether reveal state persists across tab switches | It persists across tab switches while the panel is open, and is discarded on close, on selecting another object, or on **Hide values** (2.7, 3.15). Clarification of T41-2 (Q17) |
| [x] | **#33** Helm Values: credential-looking keys redacted, and **editing requires a reveal first** | 3.16 and 2.8: no Edit button exists in the redacted view; **Reveal and edit…** is the only path |
| [x] | **#33** A redacted placeholder is unsendable, so unreachable, not just warned about | 3.16 points 1 to 4: no edit path from redacted text, editor seeded only from revealed data, **Review upgrade…** disabled while the placeholder is present, backend guard as second line |
| [x] | **#33** The guided Secret editor and the TLS tab keep working and do not look degraded | 3.15: the editor opens without an extra step (counts as a reveal); the TLS tab is unchanged and needs no reveal |
| [x] | **#31** Local only. Secret entries show keys only. Records what was sent, not what the cluster did | 3.17 explanation text; summary text "keys: password (values not recorded)"; "Accepted" tooltip |
| [x] | **#31** Copy: "Actions performed from this app on this machine" | 3.17 and 5.13, verbatim |
| [x] | **#31** The viewer is read-only, with filter by context, kind and result | 3.17: three filters, no row actions, no clear, no export |
| [x] | **#34** (low-fi) Loud, persistent banner in a fixed style that is not a cluster identity colour. One click exits | 3.19: `banner-impersonation` role, above the TopBar, **Exit** with no confirm |
| [x] | **(b) #25** Node pool and zone columns, hidden by default through the existing column-hide mechanism. Labels are GKE, EKS, AKS, Karpenter | 3.9. The mechanism does not support default-hidden today (H8), so X8 asks for a small `GenericResourceTable` addition. The label precedence is in `v1.4.0-tasks.md` §2.8 |
| [x] | **(b) #21, #22, #26, #27** Reuse `GenericResourceTable` plus the #15 states. #22 reuses `ArgoCdActionBar` and ConfirmModal. #26 shows "—" with a tooltip on a JSONPath failure | 3.20 |

### 8.2 Deliverables in the brief

| ✓ | Deliverable | Where |
|---|---|---|
| [x] | IA: where Problems, Node capacity, Possibly unused, Deprecated APIs, Who can and the Journal live, plus ClusterOverview entry points | 1.5, 3.1 |
| [x] | Wireframes: Problems (grouped, filter cards, row anatomy, evidence) | 3.2, 3.3, 3.4 |
| [x] | Wireframe: the explain card | 3.5 |
| [x] | Wireframe: node capacity including the NodeStrip overlay | 3.6 |
| [x] | Wireframe: right-sizing hint in the Containers tab | 3.7 |
| [x] | Wireframe: constraints section in Summary | 3.8 |
| [x] | Wireframe: who-can (verb + resource + namespace to subjects) and "what can this SA do" | 3.13, 3.14 |
| [x] | Wireframe: secret reveal row | 3.15 |
| [x] | Wireframe: Helm Values redaction and reveal-to-edit | 3.16 |
| [x] | Wireframe: journal list | 3.17 |
| [x] | Wireframe: saved-search affordance in the TopBar | 3.18 |
| [x] | States for each view: loading, empty ("No problems found in <ns>"), error, denied, CRD-absent, partial. 00 vocabulary. "all" is not a data state | Section 4: 17 tables with all eight rows each |
| [x] | Microcopy, including every "possibly", "may apply" and "hint" qualifier | Section 5, with 5.16 mapping each qualifier to its surfaces |
| [x] | Keyboard: jump-to-object, next and previous finding | 6.2 (roving list: ↑ and ↓ move, Enter opens). No new global key (6.1) |
| [x] | Accessibility: severity uses icon plus text, never colour alone | 3.2, 3.12, 6.3, section 7 |
| [x] | Light and dark: severity colours and capacity bars use semantic roles | Section 7 |

### 8.3 Cross-package rules (`docs/ux-task-briefs.md` §3)

| ✓ | Rule | How this package complies |
|---|---|---|
| [x] | 1 ConfirmModal is the single write choke point. Every new write confirm carries `contextLabel` and `contextColor` | This package adds one write-like confirm: #34 entry (3.19), which uses a non-destructive `md` ConfirmModal with the identity badge. Reveal is a read and has no confirm. Helm upgrade keeps UX-03's gate. #22's confirms (3.20) carry the badge |
| [x] | 2 Disabled with a reason, never hidden | Reveal and Reveal and edit are disabled with reasons (4.13, 4.14). "View as…" is disabled with a reason. The New button and the saved-search button are **not applicable** on non-resource views, so they are absent, not denied. No permission or state ever hides a control. The `onDelete` hide-on-deny exception is untouched |
| [x] | 3 Permission hints fail open. "all" is fail-open | Reveal and "View as…" disable only on an explicit deny and otherwise stay enabled (4.13, 4.17). Pages read lists and never gate on SSAR. "all" never appears as a state |
| [x] | 4 Read-only mode is a hint, not a boundary | Wording is "Read-only mode (Watchtower guardrail)" only. Reads (reveal, pages) are not blocked (4.13, 4.14) |
| [x] | 5 Never "Apply" for Merge from file | n/a: no merge flow here. The word is on the forbidden list (5.17) |
| [x] | 6 Secret values never appear in kubectl text, journal, diffs of unrevealed objects, logs | The journal shows keys only (3.17). The upgrade gate masks credential rows even after reveal (3.16 point 6). A finding or evidence value never carries Secret data (certificate evidence is timestamps only, 5.2). This package shows no kubectl text |
| [x] | 7 Honesty qualifiers are mandatory copy | 5.16 |
| [x] | 8 No scoring engine, no AI wording. No "smart", no "auto-fix" | 3.3, 5.17. There is no fix action on the explain card or anywhere (3.5) |
| [x] | 9 No new kubectl dependency | This package shows no kubectl strings |
| [x] | 10 Design tokens by role. No new hex in wireframes | Section 7. Wireframes name roles only |

---

## 9. Disagreements with `v1.4.0-tasks.md` §2 and `v1.4.1-tasks.md` §2

Stated as the tech lead asked, so they can be recorded in §1.5 of each brief. **The brief wins unless the tech lead adopts a change.** Each item says what the brief says, what is wrong with it, the change proposed, and what happens if it is rejected. They are ordered by how much they affect users. X1 to X5 affect whether the page can be trusted.

| # | Brief says | Problem | Proposed change | If rejected |
|---|---|---|---|---|
| X1 | v1.4.0 §2.4: the explain card "filters the cached report … and never issues its own query". §8 (Risks): the report is fetched "only while the Problems page or an explain card is mounted" | The two sentences contradict. With an empty cache, or a cache scoped to a different namespace, the card renders nothing, and that reads as "healthy" (violates *visibility of system status*) | The card is a consumer of the same problems query, scoped to cover its object (the object's namespace, or the cluster for cluster-scoped kinds). It may read a broader cached report first. It shows Checking, Nothing found and Unavailable explicitly (4.2) and renders nothing only for kinds the rules do not cover | The card must still show "The problems check hasn't run for this object. Open Problems to run it." on covered kinds when the cache cannot answer. Silence is not acceptable |
| X2 | v1.4.0 §2.4: `skipped` non-empty is the **Partially visible** state naming each skipped source. STATE-VOCAB copy is "Showing <things> from N of M namespaces" | `skipped` is per **source**, not per namespace, so the N-of-M copy cannot be produced. A namespace-scoped user on "all" has `pods` skipped, so almost no rule runs, and a Partially visible strip over an empty list reads as a clean cluster | Copy names sources, not namespaces (3.2, 4.1). **A skipped `pods` source with zero findings becomes No access**, with "Try a namespace". Zero findings with any other skipped source never says "No problems found" (4.1, 3.4) | Users without cluster-wide pod access see a normal-looking Problems page that checked almost nothing |
| X3 | v1.4.0 §2.4: the events line is shown "when any finding has event evidence" | The empty state is exactly where expired events mislead: the cause aged out of the one-hour window and the page says nothing is wrong | The events note is always visible on Problems once data has loaded, including with zero findings, and inside the empty-state paragraph (3.2, 3.4) | An empty Problems page can read as proof that nothing is wrong |
| X4 | v1.4.0 §2.4: "Critical, Warning, Info, plus one card per rule" | Eleven rules plus the certificate finding make about 15 cards. They do not fit in a 480 or 900 px main area and push the list below the fold | Four severity cards (All, Critical, Warning, Info) and a **Rule** menu with counts (3.2) | Cards wrap into three rows at 900 px and the list starts below the fold. The Rule menu is then the fallback for narrow windows |
| X5 | v1.4.0 §2.4: cert facts become "a `cert-expiring` finding, severity warning". §2.9: `ProblemRule` is a closed set that lacks `cert-expiring` | The type cannot hold the finding. `expiryState` returns `text-bad` for both an expired and an expiring certificate (H11), so one severity hides the difference between "already broken" and "soon" | Add a frontend-only certificate rule value to the TS type. **Expired is Critical, expiring is Warning**. The split uses the sign of the delta that `relativeFromIso` already returns, not a new threshold, so there is still one expiry rule (5.2) | Expired certificates show as Warning, and the summary text carries the whole difference ("expired 3d ago"). Acceptable only as a fallback |
| X6 | v1.4.0 §2.5: per-row bars with "request tick, limit zone, usage fill" (the DualZoneBar semantics) | At node level the primary question is "how much can I still schedule", which is the **requests** share of allocatable. Colouring a usage fill with the 65% and 85% thresholds says "fine" at 30% usage while requests sit at 98% and new pods go Pending | **NODE-CAPACITY-BAR** (3.6): fill = requests, marker = usage, tinted zone = limits, thresholds on the requests share, numbers always printed, a legend line because the meaning differs from the Containers tab bar | The page needs a printed requests percentage beside the bar, and its colour thresholds should still follow requests. Otherwise usage and scheduling pressure disagree on screen |
| X7 | v1.4.0 §2.5: thresholds "65% and 85%, as today" | Today only `Bar` and `DualZoneBar` use 85. `NodeStrip` uses **80** (H5). `tailwind.config.js` has no `bar-*` tokens | Use 65 and 85 everywhere. This changes NodeStrip's red threshold from 80 to 85, a visible but small change. The frontend adds `bar-low`, `bar-mid` and `bar-high` (already permitted by `v1.4.0-tasks.md` §6) | NodeStrip turns red at a different point from every other bar in the app (violates *consistency and standards*) |
| X8 | v1.4.0 §2.8: the #25 columns are hidden by default "via the existing column-hide mechanism" | The mechanism has no default-hidden option: `hiddenCols` starts empty and only restores saved state, and `NodeView` passes no `storageKey`, so choices are not even persisted (H8) | A small `GenericResourceTable` addition: a default-hidden list used when no saved state exists, and a `storageKey` for the Nodes view. Frontend-only, no IPC | Either the three columns show by default (about 12 columns, the Nodes table becomes crowded) or the feature is dropped |
| X9 | v1.4.0 §2.3: `mainView` is `"resources"`, `"settings"` or `"health"`, plus `healthPage`. v1.4.1 adds Possibly unused and Deprecated APIs to `healthPage` | The Journal (footer) and Who can… (Access Control) have no value. TopBar behaviour on non-resource views is undefined (H4): breadcrumb, New, ⌘N, search meaning, namespace picker | Add `journal` and `whocan` to `mainView`. Neither is a `ResourceType`. Adopt the table in 1.5, including: namespace picker shown on Problems, Possibly unused and Deprecated APIs (v1.4.0 §2.3 only names Problems and Node capacity), hidden on Journal and Who can; New hidden and ⌘N inert on every non-resource view | Frontend invents these rules per page and they diverge |
| X10 | v1.4.1 §2.4: a Permissions section in SA, Role, ClusterRole, RoleBinding and ClusterRoleBinding panels using `subject_permissions` "(for bindings: the bound subjects)" | `subject_permissions` takes a subject. A Role or ClusterRole is not a subject, so the contract does not say what those two panels show | Role and ClusterRole panels show **Bound to** (subjects from the cached binding lists, no new IPC). Whether they also show the role's own rules is open question Q9 | Role and ClusterRole panels get no Permissions section in v1.4.1 (the YAML tab already shows rules) |
| X11 | v1.4.1 §2.6 and T41-9: the view shows "Table covers Kubernetes up to {max}". UX brief: "table updated for Kubernetes ≤ X" | Same intent, two wordings. And a table that is older than the cluster makes "no findings" misleading, which neither wording addresses | Use v1.4.1's wording. Add the stronger **cluster newer than table** note (3.12), which needs the cluster's minor version from `server_version` (Q11) | The header alone says what the table covers. A user on a newer cluster can still read "3 found" as complete |
| X12 | v1.4.0 §2.4: "ClusterOverview's 'Problem pods' card links to Problems" | The card's zero state says "All healthy". Next to a Problems page that checks image pulls, scheduling, services, PVCs and certificates, that is an overclaim, and the card count (CrashLoop plus Failed) will not equal the findings count (H2) | Add the link "Open Problems" with no number. Change the zero sub-line to "No CrashLoop or Failed pods" (3.1) | The card can say "All healthy" while Problems lists critical findings |

### 9.1 Clarifications that need no contract change

These extend the briefs without conflicting with them, and are listed so the tech lead can see everything the design relies on.

1. **Reveal lifetime (T41-2).** Reveal also persists across tab switches within one open panel. **Hide values** discards it at once. A successful Helm upgrade returns the Values tab to the redacted view (3.15, 3.16).
2. **Secret reveal and SSAR.** **Reveal values** is disabled only on an explicit SSAR deny for `get` on Secrets in the object's namespace, and fails open otherwise (4.13). If the existing hint helper cannot ask that question, drop the gate and keep only the server-error path.
3. **Helm Values: one combined action.** "Edit is reachable only after Reveal" (v1.4.1 §2.2) is implemented as no Edit button in the redacted view and a **Reveal and edit…** action (3.16). The empty-values case uses **Add values…**.
4. **FINDING-ROW lead variants.** v1.4.0 §2.3 specifies severity icon plus word. Possibly unused and Deprecated APIs have no severity, so the lead slot takes a kind pill or a removal status (3.11, 3.12). The shared component takes a lead slot rather than a required severity.
5. **Info group collapsed.** Matches Q4-3's recommendation (collapsed by default) and is applied to the severity group (3.2).
6. **Problems stays off the landing view.** Q4-2's recommendation is adopted. The Sidebar entry and ⌘K are the doors, plus the overview link on the Pods view only (H1).
7. **New and Saved searches are absent on Health pages, Who can and Journal because they do not apply there.** This is not a permission or state denial, so cross-package rule 2 ("disabled with a reason, never hidden") is unchanged. Creating and saving searches make no sense on those views, and a disabled control would add noise on every page. The tech lead should confirm this reading of rule 2 (1.5 rules 1 and 2).

---

## 10. Open questions for the tech lead

Numbered, each with a recommendation. "Data need" means the design needs a field or a signal the contract lacks. The brief's questions (Problems scope, refresh cadence, saved filters, journal retention, reveal granularity) are answered by `v1.4.0-tasks.md` T4-2, T4-3, `v1.4.1-tasks.md` T41-10, T41-5 and T41-1 and are consistent with this design. The numbered questions below are new.

| # | Question | Recommendation |
|---|---|---|
| Q1 | **Owner link on a finding** (data need). A Deployment's panel should explain "why is this unhealthy" mostly through its crashing pods, but a finding has no owner. Without it the workload card can only show the workload's own findings (3.5) | Add an optional owner (kind and name of the top workload, resolved through ReplicaSet to Deployment) to `Finding`. The card then shows "In its pods" counts. If it is not added, ship the card with the fallback sentence in 3.5 |
| Q2 | **Jump-to-object behaviour.** `onNavigate` changes the namespace and does not open the panel (H3). From a cluster-wide Problems list that silently re-scopes the picker | Health jumps do not change the namespace picker (the list is cluster-wide on "all" and the search finds the name). When exactly one row matches kind, namespace and name, open its detail panel. If that is a larger change than the release allows, ship "no namespace change" alone |
| Q3 | **Health query lifecycle and state retention.** `list_problems` is the heaviest read. A hidden-but-mounted page would keep polling (the Settings view stays mounted) | Queries run only while the page is visible or an explain card needs them (`enabled`). Hold filter, expansion and scroll state in a parent so leaving and returning feels unchanged |
| Q4 | **Closed vocabulary for `skipped.source`** (data need). The partial strip names sources and the rules they block (4.1). That needs stable source ids | Define a closed set (pods, deployments, statefulsets, daemonsets, jobs, services, endpointslices, pvcs, events, nodes, certificates, tls-secrets) with the rules each feeds, in the contract. The frontend owns the display names |
| Q5 | **A structured denial signal** (data need). Capacity's No access depends on a pod-list 403, delivered as `Err("Failed to list pods: …")`. Matching message text is fragile. Presence `unknown` has the same issue | One tested helper in `viewState.ts` recognises a denial from the error text, as the §2.2 mapping table already assumes ("error with HTTP 403 text"), and every view and the capacity page use it. If the tech lead prefers a structured signal, the cleanest within the plain-string error convention is a stable, documented message prefix for forbidden results from the new commands |
| Q6 | **NodeStrip percentage denominator.** What does `cpu_percent` divide by (capacity or allocatable)? The overlay uses allocatable | Move the existing percentages to allocatable too, so one card never mixes two denominators. If that is too large a change now, keep both and keep the tooltip in 3.6 |
| Q7 | **Journal display needs.** (a) The verb vocabulary, so the page can show verbs verbatim, or friendly names. (b) Whether the retention line may state "about 25 MiB" (5 files of up to 5 MiB, T41-5). (c) Whether the page may show the journal folder path | (a) Show verbs verbatim in monospace and add friendly names later. (b) Yes, state the number as "up to about 25 MiB". (c) Not in v1.4.1. Diagnostics already shows where the log file lives |
| Q8 | **Who can: resource and namespace semantics.** (a) `who_can` takes a `group`. How does free text map to a group (kubectl style `resource.group`)? (b) With `namespace: None`, do RoleBindings count? The brief says "cluster-wide" | (a) Known kinds and installed CRDs carry their group. Free text accepts `resource.group`, and no discovery call is made. Core resources need no group. (b) `None` means grants that apply in every namespace, so ClusterRoleBindings only, and the UI says so under the field (3.13) |
| Q9 | **Role and ClusterRole panels** (see X10). Do the existing Role rows carry their rules? Do the cached binding rows include their subjects? | If both exist, Bound to needs no IPC. If rules are missing, leave the rules to the YAML tab and add nothing in v1.4.1 |
| Q10 | **Possibly unused with a skipped reference source.** If pods or workload templates are unreadable, every ConfigMap looks unreferenced. Also: does an explicitly chosen `kube-system` list its objects (T41-8 excludes it only for "all")? | The rules that depend on a skipped reference source **do not run** and the page says which kinds were not checked (4.9). An explicit namespace choice includes that namespace |
| Q11 | **Cluster version for the deprecation view.** What does `server_version` look like (for example `v1.28.3-eks-abc`)? The page needs the minor version to choose Removed versus Deprecated and to detect "cluster newer than table" | The frontend parses a leading `v?MAJOR.MINOR` in a tested helper. If it cannot parse, the page shows "Couldn't read this cluster's Kubernetes version", every finding says "Deprecated", and the newer-than-table note is replaced by a neutral line. Alternatively add a `server_minor` field to the report |
| Q12 | **Nodes and other core views and VIEW-STATE.** The Nodes view still uses the generic red error block (4.7). Should `GenericResourceTable` grow a No access variant for all views? | Out of v1.4.0 scope. File it as a follow-up so No access reads the same everywhere. Not needed for the CRD views, which get their own renderer |
| Q13 | **Hint history.** (a) Can the copy state a time span? That needs the metrics poll interval. (b) Does the per-container buffer reset when a pod is recreated? | (a) The copy says "the last N samples", never minutes (5.5). (b) Yes, buffers key on the pod name plus its start time or UID, so a restarted pod starts from zero. The tooltip says so |
| Q14 | **Constraints details.** (a) Do the quota and limit-range rows already carry hard and used values (the row could show "cpu 3.2 of 4")? (b) Webhook rules that match only subresources (for example `pods/exec`) | (a) Show names and the "applies to every pod in the namespace" sentence only, unless the fields exist. (b) Do not list subresource-only rules as matches for the object. They apply to other operations |
| Q15 | **Impersonation (#34, backlog).** Does impersonation force read-only? Do permission hints answer for the subject? | Impersonation never bypasses read-only mode, and the banner shows both. Permission hints under impersonation are hidden until they can answer for the subject, and the banner says so |
| Q16 | **Saved-search scope.** Saved searches key on `ResourceType`, so `crd-instances` would mix every CRD. Also: the search box clears on page change (1.5 rule 3) | Key `crd-instances` by CRD name. Health pages and Journal do not save searches |
| Q17 | **Reveal contract.** Confirm the lifetime in 9.1 point 1 (persist across tabs, discard on close, selection change, Hide, and after a Helm upgrade) and that opening the guided Secret editor sets the reveal | Adopt it. It matches T41-2 and T41-3 and adds only the explicit Hide and the post-upgrade reset |
| Q18 | **Header chip.** The "Problem found" chip needs a slot in both panel headers and a way to switch tab and focus the card | Ship it. It is the only cue on the default Overview tab. If the headers cannot take it this release, drop the chip and keep the card, and record the gap |

### 10.1 Keymap additions (rule K6)

None proposed. No new shortcut is added by this package, so there is no conflict check to record (6.1).

### 10.2 Data needs, in one list

For the tech lead's contract pass: owner link on `Finding` (Q1); a closed `skipped.source` vocabulary (Q4); a recognisable permission-denied signal (Q5); the NodeStrip denominator (Q6); journal verb vocabulary and retention numbers (Q7); who-can group and namespace semantics (Q8); Role and ClusterRole row contents (Q9); skipped-source behaviour of the unused rules (Q10); the cluster minor version (Q11); pod identity for the history buffer (Q13); quota and limit-range quantities (Q14).
