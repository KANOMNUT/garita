# UX 06: Map, network policies, timeline, observability, live state and multi-cluster (v2.2.0, v2.3.0 and later)

Status: wave 1 draft, for tech lead freeze. Written for task U1 in `docs/impl/v2.2.0-tasks.md` §3. It designs the whole UX-06 package once: #18, #24 and #17 (v2.2.0, complete, they gate the frontend), #16 (v2.3.0), #38 and #39 (unscheduled, low-fi).
Depends on `docs/ux/00-overview.md` and `docs/ux/04-health-capacity-rbac.md`. It cites contracts by name (STATE-VOCAB, DISABLE-PRECEDENCE, TOKEN-ROLES, KEYMAP, COPY-RULES, A11Y-BASELINE, HEALTH-SHELL, FINDING-ROW, CHECKED-LINE, HONESTY-NOTE, VIEW-STATE) and does not redefine them.
Baseline: branch `feat/v2.2.0` (v2.1.3 shipped). The product is **Garita**; 00 and 04 still say Watchtower in places.
Design only. No code, no Tauri signatures, no class strings, no hex. The IPC contracts in `docs/impl/v2.2.0-tasks.md` §2 and `docs/impl/v2.3.0-tasks.md` §2 are inputs; where this design needs something they lack, it is raised in section 11 or 12, never assumed.
Fidelity: medium for #18, #24, #17, #16 (flows, IA, states, copy); layouts low-fi everywhere. #38 and #39 are low-fi: IA, one flow, a states table.

## Contents

1. Scope, findings from the code, IA
2. GRAPH-CANVAS: the shared graph surface (#18 and #24)
3. #18 Namespace resource map
4. #24 NetworkPolicy view (approximation)
5. #17 Change timeline
6. #16 External observability (v2.3.0)
7. #38 Live-state indicator (low-fi)
8. #39 Multi-cluster tables (low-fi)
9. Keyboard, focus and accessibility, consolidated
10. Light and dark notes
11. Decisions for the tech lead
12. Disagreements with the briefs
13. Where each mandatory qualifier appears

---

## 1. Scope, findings from the code, IA

### 1.1 Items and the job behind each

| ID | Item | Release | Surface | The user's question |
|---|---|---|---|---|
| #18 | Namespace resource map | v2.2.0 | Health page "Map"; "Map" action in workload and Service panels | "What is connected to what in this namespace, and which part of the chain is unhealthy?" |
| #24 | NetworkPolicy view | v2.2.0 | A mode of the Map page; a section in the Pod panel | "Which pods may talk to which, according to the policies I can see?" |
| #17 | Change timeline | v2.2.0 | A **Timeline** tab in deploy, sts, ds, Helm and ArgoCD panels | "What changed around the time it broke?" |
| #16 | External observability | v2.3.0 | IdentityEditor summary plus a dialog; Metrics tab; Node capacity; LogViewer | "Show me history beyond the last 20 samples, from the Prometheus we already run." |
| #38 | Live-state indicator | later | TopBar, list views | "Is what I see current?" |
| #39 | Multi-context selection | later | ContextSwitcher, tables | "Show me the same kind of thing across several clusters." |

Backlog #23 (routing explained) would reuse the map's edge vocabulary; nothing here blocks it.

### 1.2 Findings from the current code

Read on 2026-10-16.

| # | Finding | Where | Consequence |
|---|---|---|---|
| M1 | The existing Relationships tab is a collapsible tree of ownership only (`deploy` → ReplicaSets → Pods), with no `rs` arm. | `ResourceDetailPanel.tsx` `RelationshipsTab`, `graph.rs` | The map does not replace it. A tree answers "what does this workload own"; the map answers "what is connected". The panel keeps both. |
| M2 | Workload panels already have seven tabs (Overview, Summary, Pods, Logs, Relationships, Events, YAML). Helm and ArgoCD have four. | `tabsFor` | A Timeline tab is an eighth. The tab strip must scroll horizontally inside itself at 480 px, keep the selected tab in view, and never wrap (section 5.2). |
| M3 | `onNavigate` switches the main resource, sets the namespace to the object's, pre-fills the search box with the name, clears the selection and does **not** open the detail panel (04 H3). | `App.tsx` | The task brief says "click a node → `onNavigate`". That lands the user on a filtered list, not on the object. The map therefore separates *looking at a node* (focus, details strip) from *opening it* (section 3.4). |
| M4 | **The IdentityEditor is an inline expander inside the 520 px ContextSwitcher dropdown.** Every control in it applies immediately; there is no Save. It holds a label field, six swatches and three guardrail controls. | `ContextSwitcher.tsx` 74 to 174 | T70-1 puts #16 there. Discovery, two service forms, label mappings and Test do not fit an inline expander, and "apply immediately" is wrong for a field the user has not finished typing. Storage stays on the identity record; the form moves to a dialog (section 6.2). |
| M5 | Health pages mount hidden, query only while visible, never poll, and each has a CHECKED-LINE and a partial strip (04). | `docs/claude/health.md` | The Map page follows the same rules: on demand, `staleTime` 30 s, no interval. |
| M6 | There are 61 `refetchInterval` sites in `useResources.ts`. The TopBar refresh button invalidates the active view's key set and has a 2 s cooldown. | `useResources.ts`, `TopBar.tsx` | #38's indicator describes one view's list query, never the whole app. Panels and counts keep polling. |
| M7 | Bulk selection and the delete column exist in `PodTable` and `GenericResourceTable`; per-context guardrails are read from `cluster-identity` by context name. | `ui.md` | #39 can resolve read-only per row without new storage. |
| M8 | The journal carries context, kind, namespace and name per entry (v1.4.1) and `list_journal` gains filters in v2.2.0. | `docs/impl/v2.2.0-tasks.md` §2.3 | Timeline can show "from this app" entries for the object. Journal timestamps use this computer's clock; cluster events use the cluster's. Order across the two is approximate (section 5.4). |

### 1.3 Terminology (hard rule)

- **Map** is the connection graph (#18). **Relationships** stays the ownership tree in workload panels. The words are never swapped.
- **Network policies (approximation)** is the name of the #24 mode, in full, wherever the mode is named. The short form "NetworkPolicy view" is for prose in docs only; in the UI the word *approximation* always travels with it.
- **Timeline** is the per-object change tab. It is never called "history" (Helm and ArgoCD already have a History tab with a narrower meaning) or "audit log".
- **Live** (#38) means this view's list is fed by a watch. **Polling** means timed refetch. A word is never used for both.
- **Cluster** in the UI means a kubeconfig context, as everywhere else.

### 1.4 Information architecture

Decisions, answering the UX-06 brief and 00 §7.3's provisional rows.

```
Sidebar (280 px)
┌─────────────────────────────┐
│ Garita                      │
│ [ctx chip]                  │
│ HEALTH                      │
│   Problems                  │
│   Node capacity             │
│   Possibly unused           │
│   Deprecated APIs           │
│   Map                       │  new, last in Health
│ WORKLOADS … (unchanged)     │
└─────────────────────────────┘
```

| Question from the brief | Decision | Why |
|---|---|---|
| Map: new view or detail tab? | **A Health page "Map"**, plus a **"Map" action** in workload and Service panels that opens the page focused on that object (T60-3, adopted). | A map is a page-sized object; 480 px cannot hold it, and panel tabs are already crowded (M2). The panel action keeps it reachable from where the question starts. |
| Timeline: new view or detail tab? | **A tab in the object's panel** (T60-5, adopted). **No Health "Timeline" page**; 00 §7.3's provisional row is retired. | "What changed on *this* object" is object-scoped. A namespace-wide feed is a different product (T60-5 excludes it). |
| Where does the NetworkPolicy view live? | **A mode of the Map page**, plus a **"Who can reach this pod" section** in the Pod panel's Summary tab. | Same renderer, same namespace scope; the pod section answers the common single-pod question without opening a graph. |
| Where do #16 endpoints live? | **Stored on the identity record, edited in a dialog opened from a summary row in the IdentityEditor** (section 6.2). | 00 §7.1 keeps per-cluster settings in the switcher. A dialog fits the form; the record stays the single store. |
| #38 | A text indicator next to the TopBar refresh button, with a popover. | Section 7. |
| #39 | A multi-select mode in the ContextSwitcher, a Cluster column, a per-cluster state strip. | Section 8. |

Entry table:

| Entry | Where | ⌘K group and label | Page | TopBar breadcrumb | Namespace picker | Search box means |
|---|---|---|---|---|---|---|
| Map | Sidebar, Health | "Health": "Map" | Map page | `map` | Shown; **"all" is not valid here** (3.5) | "Find on map…" highlights matching nodes |
| Network policies | Mode toggle on the Map page | "Health": "Network policies (approximation)" opens Map in that mode | Map page | `map` | as Map | as Map |
| Map (from a panel) | Panel header action "Map" | none (the page entry covers ⌘K) | Map page, focused | `map` | Set to the object's namespace | as Map |
| Timeline | Tab "Timeline" in deploy, sts, ds, Helm, ArgoCD panels | none (a tab) | n/a | n/a | n/a | n/a |
| Live indicator | TopBar | none | n/a | n/a | n/a | n/a |
| Add clusters to a view | ContextSwitcher | "App": "Clusters: show several clusters…" and "Clusters: back to one cluster" | n/a | `3 clusters / … / pods` | Shown (union, 8.4) | unchanged |

Rules, from 00 §7.3: every entry has a ⌘K entry (the Timeline tab and the indicator are not nav entries); a nav entry never shows a count badge; the Map page mounts hidden and queries only while visible; the TopBar refresh invalidates the Map key while the Map page is visible (`r` stays inert in editable targets).

---

## 2. GRAPH-CANVAS: the shared graph surface

#18 and #24 share one renderer (F1). This section is the contract between the two designs and the layout library. It states requirements, not a library; Q60-1 stays open.

### 2.1 Layout requirements (library-independent)

| ID | Requirement | Reason |
|---|---|---|
| L1 | **Layered, left to right.** Traffic and control flow enters on the left and ends on the right: Ingress, Gateway and HTTPRoute, then Service, then workload (Deployment, ReplicaSet, Pod), then PVC, PV, ConfigMap, Secret. HPA and PDB sit to the left of their targets. | It matches how the user reads a request path and how Kubernetes objects own each other. The same direction in both modes lets the user carry what they learned. |
| L2 | **Connected components are separate islands**, stacked top to bottom, ordered by their smallest node id. A component with one node (a lone ConfigMap) goes in a final "Not connected" band. | A namespace is rarely one graph. Islands keep unrelated apps from interleaving. |
| L3 | **Deterministic.** Inputs are sorted by node id before layout; the same node and edge set always yields the same positions. | Required for L4 and for tests. |
| L4 | **Stable across refetch.** Re-layout only when the **set of node ids or edge ids** changes. A status change, a new `detail` string or a refetch with an identical set never moves a node. When the set changes, nodes that still exist keep their position when the library allows it, otherwise the viewport and the focused node are preserved (the focused node is scrolled into the same place on screen). | Pointer and focus stability (A11Y-BASELINE, 04 §6.4). |
| L5 | **No animation.** Positions snap. The canvas has no intro, no "settling" and no edge animation, so reduced motion needs no special case. | Section 9.4. |
| L6 | **Off the main thread or chunked.** Layout of 400 nodes must not freeze input. While it runs the previous layout stays on screen, or the skeleton during first load, with the text "Laying out the map…" after 400 ms. | The brief: never a frozen canvas. |
| L7 | **Node boxes are a fixed size** (184 by 52 CSS px at 100% zoom). Long names are cut with an ellipsis at the end; the full name is always available in the details strip, `title` and the accessible name. | Fixed boxes keep layout cheap and L4 true. |
| L8 | **Pods of one owner may collapse** into a single group node when the owner has more than 8 (3.7). Groups are a rendering concern of the frontend; they do not change the response. | A 40-replica Deployment must not become 40 boxes. Optional; see decision D6. |
| L9 | **Edges are orthogonal (right-angle elbows in the column gaps, long edges through reserved lanes), never curved to avoid crossings** in a way that hides direction. Arrowheads always present. Edge labels are drawn only on hover or keyboard focus of an end node (2.3). | Legibility at 400 nodes. |

### 2.2 Node anatomy

```
Node box, 184 x 52 px
┌─────────────────────────────────┐
│ [icon] Deployment         ✕ Failing │   kind label in mute; status glyph + word
│ api-gateway                      │   name in monospace, ink, ellipsis at the end
└─────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Kind | Small icon (decorative) plus the kind label in `mute` ("Deployment", "Service", "PersistentVolumeClaim" shortened to "PVC"). |
| Name | Monospace, `ink`. |
| Status | Glyph **and word**: ✓ OK (`status-ok`), ▲ Warning (`status-warn`), ✕ Failing (`status-bad`), ○ Unknown (`mute`). The word is `ink`; the glyph carries the colour (04 §7 precedent). ConfigMap and Secret nodes show **no status** (closed list in the UI, decision D5). |
| Border | `edge` ring; the focused node gets the `focus-ring` role (2 px) and a thicker inner border; a search match gets a dashed `accent` ring plus the text "match" in the details strip, so a match is not colour alone. |
| Cluster-scoped | A PersistentVolume carries the small suffix "cluster-scoped" in `mute` under its kind. |
| Secret | The node shows kind, name and type only. No value, ever. Opening it follows the Secret reveal rules (`writes.md`). |
| Group node (L8) | "Pods x12" with the worst status and the status counts as words: "10 OK, 2 Warning". Enter expands it in place. |

Status uses the same rules as the resource lists; the map does not compute a health score. The legend says so.

### 2.3 Edges

| Part | Spec |
|---|---|
| Line style carries the **family**, so it is not colour alone | Solid: `owns`, `selects`, `routes-to`, `attaches-to`. Dashed: `mounts`, `binds`, `uses-config`, `uses-secret`. Dotted: `scales`, `protects`. |
| Colour | `mute` by default; `ink` for edges incident to the focused node. Edges never use status colours. |
| Label | Drawn only while a node is hovered or has keyboard focus, and only for that node's own edges: a small card above the nodes, placed in its column gap so it does not cover a box at about 83% zoom and up (below that it is centred on the gap and can overlap box edges), with the relation word and then the backend's `detail` when present ("selects", "routes to · path /api", "selects · 7080 → 3000"). Nothing is labelled otherwise. The same detail is in the text equivalents: the details strip and the List view read "Selects Pod api (7080 → 3000)". |
| Text equivalent | Every relation is also written as a sentence in the details strip (2.4), which is the accessible content. |
| Direction | Arrowhead at `to`. The legend states the direction of each relation in words. |

Relation words (closed, one per `relation` value): owns, selects, routes to, attaches to, mounts, binds, uses config, uses secret, scales, protects. In sentences: "Deployment api owns ReplicaSet api-7d9f", "Service api selects 3 pods", "Ingress web routes to Service api (path /)", "Pod api-xk2lp mounts PVC data", "PVC data binds PersistentVolume pv-81", "Pod api-xk2lp uses config ConfigMap app-env", "uses secret Secret app-tls", "HPA api scales Deployment api", "PDB api protects 3 pods".

### 2.4 Details strip

A fixed region under the canvas, 112 px high at 100% zoom, scrolling inside itself. It always describes the **focused node** (or the focused edge in #24). It is the text alternative to the picture and the place for actions.

```
Details strip, under the canvas (full window width)
┌────────────────────────────────────────────────────────────────────────────┐
│ Deployment  shop/api-gateway          ✕ Failing         [ Open ↗ ] [ Show only this ] │
│ Owns ReplicaSet api-gateway-7d9f ▸  · Selected by Service api-gateway ▸    │
│ Scaled by HPA api-gateway ▸  · Protected by PDB api-gateway ▸              │
│ Uses config ConfigMap app-env ▸ · Uses secret Secret app-tls ▸            │
└────────────────────────────────────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Header line | Kind, `namespace/name` (monospace, wraps, never truncated), status glyph and word. |
| Relation lines | One sentence fragment per relation group, in the order owns, selected by, routes, mounts, config, scaling, protection. Each related object is a button (the `▸`); activating it **moves focus to that node** and scrolls it into view. This is how a keyboard or screen-reader user follows an edge. |
| Open | Opens the object's detail panel in its own list view (3.4). Disabled with a reason for a kind the app has no panel for. |
| Show only this | Narrows the map to the lineage of this node: everything upstream of it (toward Ingress and Gateway) and downstream (toward Pods and config), plus the up- and downstream of each Pod in that set. Sibling ReplicaSets and other apps that share a Secret are not shown; a Deployment keeps all its ReplicaSets. The Graph, the List and the counts show the same set. Hidden when already focused on it. |
| Empty | "No connections found for this object." plus "References to objects that don't exist aren't shown." |

### 2.5 Pan, zoom, controls

| Control | Spec |
|---|---|
| Pan | Drag the background; scrollbars on the canvas container. The container scrolls, so a browser at 200% zoom needs no page scroll (A11Y-BASELINE). |
| Zoom | Buttons `+`, `-`, **Fit** (24 by 24 px minimum, with tooltips "Zoom in", "Zoom out", "Fit to view"); ⌘/Ctrl + wheel. Range 50 to 200 percent. Plain wheel scrolls. |
| Keys inside the canvas | `+`, `-`, `0` (fit). Single-letter-style keys are scoped to the canvas with focus on a non-editable element (KEYMAP K1). No new global key. |
| Position | Controls sit in the canvas' top-right corner and are in tab order **after** the canvas (2.6). |

### 2.6 Keyboard

The canvas is **one tab stop** with roving focus over nodes (the 04 list-composite precedent). Nodes are buttons; the container has `role="group"` and an accessible name ("Resource map for namespace shop", "Network policy map (approximation) for namespace shop").

| Key | Behaviour |
|---|---|
| `Tab` | Enter the canvas on the last focused node (first node on first entry: top-left of the first island). A second `Tab` leaves to the canvas controls, then the details strip. |
| `←` / `→` | Move to the nearest node in the previous or next layer, preferring a node connected to the current one. |
| `↑` / `↓` | Move to the previous or next node in the same layer, within the island, then into the next island at the end. |
| `Home` / `End` | First or last node in reading order (islands top to bottom, layers left to right). |
| `Enter` | **Open** the focused node (same as the Open button; on a group node, expand it). |
| `Space` | Show the focused node's details strip expanded to full height; a second `Space` returns it. Useful at 200% zoom. |
| `Escape` | Follows the app rules (`ui.md`, Keyboard layering): closes the topmost popover or menu, otherwise nothing in the canvas. It does not leave focus mode and does not clear the focused node. |
| `+` `-` `0` | Zoom and fit (2.5). |

Focus follows movement: arrow keys move DOM focus, the details strip updates, and the viewport scrolls the node into view with `nearest`. The strip is not a live region (it would announce on every arrow press); the node's own accessible name carries the content (2.7).

Mouse: clicking a node focuses it (details strip updates). Double-click opens it. Clicking the background clears nothing.

### 2.7 Accessible names and the list alternative

- Node accessible name: "Deployment api-gateway in shop. Failing. Owns 1, selected by 1, uses 2. 3 of 41." (`aria-posinset`/`aria-setsize` over reading order). Pseudo-nodes in #24 read the same way.
- The graph is not the only way to get the information. A **List** view toggle ("Graph | List") renders the same nodes as a grouped list: a heading per kind with its count, one row per object (status word, name, then its relations as text), each row an Open button. It is the keyboard and screen-reader fallback, the 200%-zoom fallback and the answer to "I just want to find the PVC". Decision D6 asks the tech lead to confirm it; without it, the details strip is the only text equivalent and the map still meets WCAG 1.3.1 and 1.1.1 for the information it carries, but with more keystrokes.

### 2.8 Shared states (both modes)

| State | Behaviour |
|---|---|
| Loading, first load | The page frame renders at once. The canvas shows the skeleton: three columns of static placeholder boxes (no shimmer under reduced motion; the shimmer is otherwise allowed, it is not information). Title area: "Mapping namespace shop…". The counts read "—". |
| Loading, refetch | The previous map stays. The CHECKED-LINE updates when done; the refresh button spins. Focus, zoom and scroll position survive (L4). |
| Too many | See 3.6. |
| Error | See 3.5. |
| Unreachable | "Can't reach {cluster label}." and **Retry** (STATE-VOCAB). A cached map is hidden behind it, as for Problems (stale cluster data could mislead). |

---

## 3. #18 Namespace resource map

### 3.1 Flows

**A. Understand a namespace (Health → Map).**
1. User opens Map from the Sidebar or ⌘K. If the namespace picker says "all", the page shows the **Choose a namespace** block (3.5) instead of data.
2. With a namespace chosen the page loads, lays out and shows the islands. The user filters by kind, searches by name, pans and zooms.
3. They move to a node (arrow keys or click). The details strip tells them what it is connected to and its status word.
4. **Open** takes them to the object.

**B. Start from an object (panel → Map).**
1. A panel for a workload or a Service has a **Map** action beside Compare in the header. It is a plain button, not a write; read-only mode and RBAC hints do not affect it.
2. Activating it closes the panel, switches to the Map page, sets the namespace to the object's namespace (the same intended re-scope `onNavigate` makes) and requests the map with `focus` = that object. Focus lands on that node.
3. A **focus chip** under the title reads "Showing the chain for Deployment api-gateway: 9 of 31 connected objects. Sibling objects and shared config are left out." with **Show whole namespace** (when the chain is everything connected: "Showing the chain for Deployment api-gateway. Everything connected to it is part of the chain."; a lone object: "Deployment api-gateway has no connections. Showing it alone."). Removing focus refetches without `focus`; the focused node stays focused when it still exists.
4. **Back to the object:** the node's **Open** button reopens its panel. The browser-style "back" is not promised.

**C. Too many objects.** 3.6.

### 3.2 Wireframe: Map page, full window (main area about 1000 px)

```
TopBar: [●] ctx / shop ▾ / map                         ⟳  [Find on map…      ]
┌────────────────────────────────────────────────────────────────────────────┐
│ Map                                       Checked 14:02:11  What this map shows ▾ │
│ Namespace shop · 41 objects · 63 connections       [Resources | Network policies (approximation)] │
│ ⓘ Showing the chain for Deployment api-gateway: 9 of 31 connected objects.   [Show whole namespace]  │
│ ⓘ Partially visible. Couldn't read 1 source: secrets (forbidden).            │
│   Connections to Secrets aren't shown.                          [Show which ▾] │
│ Show: [x Workloads 18] [x Services & routing 6] [x Storage 7] [x Config 8] [x Scaling & budgets 2]  [Graph | List] │
│ ┌────────────────────────────────────────────────────────────── ＋ － Fit ─┐ │
│ │ ┌───────────┐   ┌──────────┐   ┌─────────────┐   ┌────────┐            │ │
│ │ │Ingress web│──▶│Svc api   │──▶│Pod api-xk2lp│──▶│PVC data│──▶ PV …    │ │
│ │ └───────────┘   └──────────┘ ╱ └─────────────┘   └────────┘            │ │
│ │ ┌───────────┐   ┌──────────┐╱  ┌─────────────┐                          │ │
│ │ │HPA api    │──▶│Deploy api│──▶│RS api-7d9f  │──▶ (pods)                │ │
│ │ └───────────┘   └──────────┘   └─────────────┘                          │ │
│ │ Not connected:  [CM kube-root-ca.crt] [CM feature-flags]                 │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ── Details strip (2.4) ─────────────────────────────────────────────────── │
│ ┄ solid: owns, selects, routes to, attaches to · ┄ dashed: mounts, binds, uses config, uses secret · dotted: scales, protects  │
│ Status uses the same rules as the resource lists. References to objects that don't exist aren't shown. │
└────────────────────────────────────────────────────────────────────────────┘
```

Anatomy (HEALTH-SHELL, extended):

| Zone | Content |
|---|---|
| Title row | "Map", CHECKED-LINE ("Checked 14:02:11"), a **What this map shows** disclosure (3.3), the mode toggle |
| Scope line | "Namespace shop", then "41 objects · 63 connections" |
| Focus chip | Only in focus mode (3.1 B) |
| Partial strip | Only when `skipped` is non-empty; above the canvas, never replacing it (STATE-VOCAB 4.2); not dismissible while it holds |
| Kind filter | Toggle buttons with `aria-pressed`, glyph-free, word and count. Groups: Workloads (deploy, sts, ds, rs, jobs, cron, pods), Services & routing (svc, ing, gateway, HTTPRoute), Storage (PVC, PV), Config (ConfigMap, Secret), Scaling & budgets (HPA, PDB). A group with zero objects is shown with count 0 and `aria-disabled` plus the reason "No objects of this kind in this namespace." |
| Mode toggle | Segmented control, two options, `role="radiogroup"`. The second label always carries "(approximation)". |
| Graph or List | Segmented control (2.7) |
| Canvas | 2.1 to 2.6 |
| Details strip | 2.4 |
| Legend | Always visible under the strip; two lines (line styles, status rule). Its text is the "Legend" in the accessible tree. |

Narrow (main area below about 720 px): the kind filter wraps to two rows; the mode toggle moves under the scope line; the details strip stays under the canvas; the canvas scrolls inside itself. Below 560 px the page defaults to **List**, with a visible switch back to Graph.

### 3.3 "What this map shows" disclosure

Visible text, not a tooltip (HONESTY-NOTE). Expanded:

```
What this map shows
Connections Kubernetes records on the objects themselves: ownership, Service and
PodDisruptionBudget selectors, Ingress and HTTPRoute backends, Gateway routes,
volumes (including projected sources), environment references, PVC binding, and
HorizontalPodAutoscaler targets.
Not shown: live traffic, connections inferred from events, other namespaces
(except PersistentVolumes), and references to objects that don't exist.
Secrets appear by name and type only. No values are read.
```

### 3.4 Node actions

| Action | Where | Behaviour |
|---|---|---|
| Focus | click, arrows | Updates the details strip. Never navigates. |
| Open | button, `Enter`, double-click | Opens the object in its own list view **with its detail panel open**. If the existing `onNavigate` cannot open the panel (M3), the frontend uses the same path the Problems page's Open uses (`jumpFromHealth`). The map must not use the search-prefill behaviour as its Open. A PersistentVolume opens in the cluster-scoped PV view. |
| Show only this | button in the strip | Sets `focus`; adds the focus chip. |
| Copy name | none | Not added. The name is selectable text in the strip. |

### 3.5 States

| State | Behaviour |
|---|---|
| Choose a namespace | Namespace picker is "all". Not a data state (STATE-VOCAB 4.3): the page shows a centred block, "The map shows one namespace at a time." with a namespace select (the same list as the picker) and **Show map**. Choosing sets the TopBar namespace. Reason it exists: a cluster-wide map is excluded in this release. |
| Loading | 2.8. |
| Nothing here | "No objects to map in namespace shop." plus the CHECKED-LINE. With `skipped` non-empty, the **Partially visible, nothing found** variant: "Nothing found in what could be read." It never says "No objects" while a source was skipped. |
| Single object | A map with one node and no edges: the node renders, the details strip says "No connections found for this object. References to objects that don't exist aren't shown." |
| Focus target gone | `focus` names an object that is not in the response: "Deployment "api-gateway" isn't in namespace shop." with **Show whole namespace**. No empty canvas. |
| Error | "Couldn't build the map." plus `<message>` and **Retry**. Earlier results stay with the strip "Couldn't refresh. Showing the map from 14:02:11." |
| No access | Every source skipped, or **pods** skipped and no node came back: "You don't have access to pods in namespace shop. Your account can't list pods. Ask a cluster admin for the list permission." with **Try a namespace**. Same reasoning as Problems (04 X2): pods anchor most edges, so "partial" over an empty canvas would read as clean. |
| Partially visible | Strip lists each skipped source, its verbatim reason, and **what is missing** (table below). The map keeps working. |
| Too many | 3.6. |
| Read-only | n/a: the page reads and navigates only. |
| Not installed | n/a as a state. Gateway API absent returns no nodes, which is indistinguishable from "none"; the disclosure (3.3) names the kinds covered, so the absence is explained there, not as an error. |
| Unreachable | 2.8. |

Skipped source to consequence copy (ids follow the final `SkippedSource.source` set from R1; the table is the copy, the ids are the frontend's lookup):

| Source | Consequence line |
|---|---|
| pods | "Pods and everything that attaches to them aren't shown." |
| replicasets, deployments, statefulsets, daemonsets, jobs, cronjobs | "{Kind} objects and their ownership connections aren't shown." |
| services, endpointslices | "Connections from Services to pods aren't shown." |
| ingresses | "Connections from Ingresses to Services aren't shown." |
| gateways, httproutes | "Gateway and HTTPRoute connections aren't shown." |
| persistentvolumeclaims | "Volume connections and PVCs aren't shown." |
| configmaps | "Connections to ConfigMaps aren't shown." |
| secrets | "Connections to Secrets aren't shown." |
| horizontalpodautoscalers | "Autoscaler connections aren't shown." |
| poddisruptionbudgets | "Disruption budget connections aren't shown." |

### 3.6 Too many objects (T60-2)

Triggered by `truncated: true`. The page never renders a partial graph as if it were complete, and never lays out more than 400 nodes.

```
Canvas area replaced by a centred block (VIEW-STATE style, no card chrome)
        ⊘  This namespace has too many objects to draw.
           More than 400 objects in namespace shop. A map this size isn't readable.
           Narrow it down:
           Start from an object:   [ Kind ▾ Deployment ]  [ Name ▾ api-gateway ]   [ Show map ]
           Or hide kinds:          [ Pods ] [ ConfigMaps ] [ Secrets ] …           [ Try again ]
```

| Element | Spec |
|---|---|
| Copy | Title "This namespace has too many objects to draw." (while focused: "This chain has too many objects to draw."; when the backend cannot load the focus: "Too many objects to load.") Body "More than 400 objects in namespace shop. Start from one object, or hide some kinds." If the response carries a count (D1): "412 objects in namespace shop." |
| Start from an object | A kind select (Deployment, StatefulSet, DaemonSet, Service, Ingress) and a name select fed by the **existing list queries** for that kind in this namespace (no new command). **Show map** requests `focus`. |
| Hide kinds | The same kind toggles as the filter bar, with counts when D1 is adopted. **Try again** refetches with those kinds excluded. Needs a contract change (D1). Without it this row is removed and only "Start from an object" remains. |
| Focus is still too big | "The chain for Deployment api-gateway has 412 objects (the limit is 400). Hide ConfigMaps and Secrets, or start from a narrower object." Shared ConfigMaps and cluster-wide Secrets cause it. When the backend itself cannot load the focus (more than 2,000 objects connected): "The objects connected to Deployment api-gateway are too many to load (more than 2,000). Start from a narrower object." |
| Behaviour | No canvas. Details strip hidden. The CHECKED-LINE shows. Focus moves to the "Name" select when the block appears from a user action, otherwise to the block's heading (`tabindex` -1). Polite announcement: "Too many objects to draw. Choose where to start." |

### 3.7 Collapsed pod groups (optional, D6)

An owner with more than 8 pods collapses to one group node "Pods x12" (2.2). Enter expands it in place (up to the cap), and the expansion state lives in component state keyed by the group's owner id so L4 holds. The group's status word is the worst child's; the count line reads "10 OK, 2 Warning". The details strip for a group lists the non-OK pods first, each a button.

### 3.8 Copy

| Where | Text |
|---|---|
| Page title | "Map" |
| Scope line | "Namespace shop · 41 objects · 63 connections" |
| Focus chip | "Showing the chain for Deployment api-gateway: 9 of 31 connected objects. Sibling objects and shared config are left out." / "Show whole namespace". Screen readers hear "Showing the chain for Deployment api-gateway. 9 objects, 8 connections." once per focus change. Zero kind chips read "No objects of this kind in this chain." while focused. |
| Search placeholder | "Find on map…"; with matches "3 matches"; none "No match on the map." |
| Open disabled | "There's no detail panel for this kind." |
| Legend line 1 | "Solid line: owns, selects, routes to, attaches to. Dashed: mounts, binds, uses config, uses secret. Dotted: scales, protects." |
| Legend line 2 | "Status uses the same rules as the resource lists. References to objects that don't exist aren't shown." |
| Live announce, first load | "Map loaded. 41 objects, 63 connections." |
| Live announce, node vanished after refetch | "Removed from the map: Pod api-xk2lp." |

---

## 4. #24 NetworkPolicy view (approximation)

### 4.1 Honesty copy (mandatory)

The word **approximation** appears in the mode label, the page title in this mode, the legend, the empty state, the Pod panel section title and the details strip's edge explanation. The reason is stated where the user reads the result, not in a tooltip.

| Where | Exact text |
|---|---|
| Mode toggle label | "Network policies (approximation)" |
| Page title in this mode | "Network policies (approximation)" |
| Persistent note under the scope line (HONESTY-NOTE) | "Approximation. Built from standard NetworkPolicy objects only. Real traffic can differ: CNI-specific policies (Calico, Cilium, AdminNetworkPolicy) aren't included, named ports aren't resolved to numbers, and traffic to or from the node itself is handled differently by some CNIs. This is not a connectivity test." |
| Legend heading | "Legend (approximation)" |
| Empty state | "No NetworkPolicies in namespace shop. Kubernetes lets pods that no policy selects send and receive any traffic, so nothing here is restricted by a standard policy. This is an approximation: CNI-specific policies aren't shown." |
| Pod panel section title | "Who can reach this pod (approximation)" |

Wording rules for this view: use **restricted** and **not restricted** (never "isolated", "protected", "secured", "open", "blocked"). A missing edge reads "No allow rule found", never "blocked". An edge reads "allowed by" a named policy. Port-less rules read "any port". Named ports read "port http (name, not resolved)".

### 4.2 What the canvas draws

The evaluator (T60-4) yields allow-edges among pods plus pseudo-nodes. A graph of pods would be unreadable (40 pods is 1,600 pairs), so the frontend draws **pod groups**.

| Concept | Rule |
|---|---|
| Node = pod group | Pods with the **same label set** in the namespace form one group node, named by the owner workload when all members share one ("api-gateway", from the owner chain) and otherwise by the label set ("app=web,tier=fe"). The count is on the node ("3 pods"). |
| Per-node direction words | Two lines on every group node: "Ingress: restricted by 2 policies" or "Ingress: not restricted", and the same for Egress. These words carry the semantics so absence of edges is not misread. |
| Pseudo-nodes | **One per distinct `namespaceSelector`**, labelled with the selector and the matching namespaces: "Namespaces: team=a (2 matching)", "All namespaces" for `{}`. **One per distinct `ipBlock`**, labelled "External 10.0.0.0/8" with "except 10.1.0.0/16" when present. A peer that matches this namespace's own pods draws to those groups instead. |
| Edge A → B | Drawn when the evaluator finds that A can send to B **and at least one side is restricted by a policy**. If both sides are not restricted the edge is not drawn (it would connect everything to everything); the "not restricted" words on both nodes say so. |
| Edge detail | The allowed ports ("TCP 8080", "any port", "port http (name, not resolved)") and the policy that allows them ("allowed by policy allow-web, ingress rule 1"). Shown on the focused edge in the details strip, and as the edge label (hover or keyboard focus of either end node). |
| Policy count line | Scope line: "5 policies · 1 selects no pods". The name of a policy that selects nothing is in the "What this view shows" disclosure. |
| Layout | The same renderer (L1 to L9). Pseudo-nodes sit at the far left (sources) and far right (destinations) in their own layer so the namespace's groups stay in the middle. |

Edges are not focusable. The details strip lists "Can send to" and "Can receive from" as buttons that move focus to the neighbouring node, and each entry states the ports and the allowing policy beside it. This keeps one roving focus over nodes only and puts every edge's explanation in text.

### 4.3 Wireframe: Network policies mode, full window

```
TopBar: [●] ctx / shop ▾ / map                         ⟳  [Find on map…      ]
┌────────────────────────────────────────────────────────────────────────────┐
│ Network policies (approximation)           Checked 14:02:11  What this view shows ▾ │
│ Namespace shop · 5 policies · 6 pod groups     [Resources | Network policies (approximation)] │
│ ⓘ Approximation. Built from standard NetworkPolicy objects only. Real traffic can  │
│   differ: CNI-specific policies (Calico, Cilium, AdminNetworkPolicy) aren't        │
│   included, named ports aren't resolved to numbers, and traffic to or from the    │
│   node itself is handled differently by some CNIs. This is not a connectivity test.│
│ ┌──────────────────────────────────────────────────────────── ＋ － Fit ──┐ │
│ │ ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────┐     │ │
│ │ │ All namespaces  │──▶│ web (3 pods)     │──▶│ api (3 pods)     │──┐  │ │
│ │ │ pseudo          │   │ In: restricted 1 │   │ In: restricted 2 │  │  │ │
│ │ └─────────────────┘   │ Out: not restr.  │   │ Out: restricted 1│  ▼  │ │
│ │ ┌─────────────────┐   └──────────────────┘   └──────────────────┘ ┌──────────────┐ │
│ │ │ Namespaces:     │──▶ ...                                        │ External     │ │
│ │ │ team=a (2)      │                                               │ 10.0.0.0/8   │ │
│ │ └─────────────────┘                                               └──────────────┘ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ── Details strip ───────────────────────────────────────────────────────── │
│ Pod group  api  (3 pods)    Ingress: restricted by 2 policies  Egress: restricted by 1 policy │
│ Can receive from: web ▸ (TCP 8080, allowed by allow-web) · Namespaces team=a ▸ (any port, allowed by allow-team)│
│ Can send to: db ▸ (TCP 5432, allowed by allow-api-egress) · External 10.0.0.0/8 ▸ (TCP 443)  │
│ No allow rule found for traffic from: worker ▸                          [ Open pod list ↗ ] │
│ ── Legend (approximation) ──────────────────────────────────────────────── │
│ Arrow: traffic an allow rule permits, from source to destination. No arrow does not mean a guarantee of no traffic. │
└────────────────────────────────────────────────────────────────────────────┘
```

Narrow and List fallback behave as in 3.2; in List mode each group is a row with its two direction sentences and its allow lists.

### 4.4 Pod panel section: "Who can reach this pod (approximation)"

In-panel expansion on the Pod panel's **Summary** tab (no new tab). Read-only, on demand while the panel is open and the tab is shown; reuses the same model query as the page (`staleTime` 30 s).

```
480 px panel, Summary tab
┌────────────────────────────────────────────┐
│ Who can reach this pod (approximation)     │
│ Selected for ingress by 2 policies:        │
│   allow-api, default-deny-ingress          │
│ Allowed sources                            │
│  ● Pods labelled app=web in this namespace │
│    TCP 8080 · allowed by allow-api         │
│  ● Namespaces labelled team=a (2 matching) │
│    any port · allowed by allow-team        │
│  ● External 10.0.0.0/8 except 10.1.0.0/16  │
│    TCP 443 · allowed by allow-edge         │
│ ▸ Where this pod can connect (egress)      │
│ Approximation. Built from standard         │
│ NetworkPolicy objects only. CNI-specific   │
│ policies, named ports and node-local       │
│ traffic aren't covered. [Show on map ↗]   │
└────────────────────────────────────────────┘
```

- No policy selects this pod for ingress: "No policy selects this pod for ingress, so no standard NetworkPolicy restricts traffic to it. (approximation)".
- Egress is a disclosure, collapsed, same pattern.
- **Show on map** opens the Map page in this mode, focused on the pod's group.
- The section sits below Constraints in Summary. The required qualifier is "approximation", already in the title; no second "Hint" label.

### 4.5 States

| State | Behaviour |
|---|---|
| Loading | 2.8 skeleton; section in the panel shows one quiet line "Reading network policies…". |
| Nothing here (no policies) | The exact empty-state text in 4.1, shown **instead of the canvas**, with the pod groups listed as a plain list ("6 pod groups, none selected by a policy"). The page does not draw an edgeless graph. |
| Policies exist but none selects a pod | Canvas draws groups, all "not restricted", no edges, note "5 policies exist; none selects a pod in this namespace." |
| Error | "Couldn't read network policies." plus `<message>` and **Retry**. |
| No access | `networkpolicies` skipped and nothing else usable: "You don't have access to NetworkPolicies in namespace shop. Your account can't list networkpolicies. Ask a cluster admin for the list permission." A forbidden **pods** or **namespaces** list: strip "Partially visible. Couldn't read namespaces (forbidden). Namespace selectors can't be matched, so traffic from other namespaces isn't shown." |
| Partially visible | As 3.5; consequence lines: pods → "Pod groups aren't shown."; namespaces → as above. |
| Too many | Over 400 groups plus pseudo-nodes: 3.6 with "Start from a pod group". The frontend counts after grouping. |
| Not installed | n/a: NetworkPolicy is a core API. A cluster whose CNI ignores NetworkPolicy still returns objects, which is exactly why the honesty text exists. |
| Read-only | n/a. |
| Unreachable | 2.8. |

---

## 5. #17 Change timeline

### 5.1 Flow

1. A user looking at a failing Deployment opens its panel and picks **Timeline**. (Placement 5.2.)
2. The tab loads every source for the kind (section 5.3), merges them newest first, and groups by day.
3. They scan: an "Event BackOff" 4 minutes ago, a "Rollout revision 7 created" 6 minutes ago with a new image, an entry "from this app" 6 minutes ago ("Scaled deployment"). Cause and sequence are visible together.
4. An entry's **Show in Events / History** link switches to the tab that holds the source detail. Nothing else is clickable.
5. The retention line is on screen the whole time. It is the answer to "why is the last hour only events?".

### 5.2 Placement

| Kind | Tabs after the change |
|---|---|
| deploy, sts, ds | Overview, Summary, Pods, Logs, Relationships, Events, **Timeline**, YAML |
| Helm | Overview, Values, History, Events, **Timeline** |
| ArgoCD | Overview, Resources, History, Events, **Timeline** |

Timeline sits right after Events (the closest source), before YAML. The existing Events and History tabs stay; the Timeline merges them and does not replace them. Kinds with no Timeline have no such tab (absent, not disabled, as for Summary elsewhere).

The tab strip must scroll horizontally inside itself at 320 to 480 px, never wrap, and scroll the selected tab into view. This is a requirement of this tab, because workloads reach eight tabs (M2).

### 5.3 Sources per kind (T60-5, §2.3 of the brief)

| Kind | Sources | Source chip text |
|---|---|---|
| deploy | rollout revisions, Events, journal | Rollout, Event, From this app |
| sts, ds | Events, journal | Event, From this app |
| helm | Helm history, Events, journal | Helm, Event, From this app |
| argocd | ArgoCD history, Events, journal | ArgoCD, Event, From this app |

### 5.4 Wireframe: Timeline tab, 480 px panel (Deployment)

```
480 px panel, Timeline tab
┌────────────────────────────────────────────────┐
│ Timeline                    Updated 14:02:11   │
│ Events are kept about 1 hour; ReplicaSet, Helm │
│ and ArgoCD history go back further. This is    │
│ not a full audit log.                          │
│ Show: [x Event 8] [x Rollout 4] [x From this app 3]   │
│ ⓘ Partially shown. Couldn't read events        │
│   (forbidden).                    [Show which ▾]│
│                                                │
│ Today                                          │
│ ▲ 4m ago  Event   BackOff                      │
│           Back-off restarting failed container │
│                              ▸ Details  Show in Events │
│ ● 6m ago  Rollout Revision 7 created           │
│           Image shop/api:1.4.2 (was 1.4.1)     │
│                              ▸ Details  Show in History │
│ ● 6m ago  From this app  Scaled deployment     │
│           3 replicas to 5 · succeeded          │
│                              ▸ Details  Show in Journal │
│ Yesterday                                      │
│ ● 18:20   Rollout Revision 6 created …         │
│ Time unknown                                   │
│ ○ —       Event   Scheduled                    │
│           These entries have no timestamp. Their order isn't meaningful. │
│ [ Show 100 more ]                              │
└────────────────────────────────────────────────┘
```

The retention line is **verbatim**: "Events are kept about 1 hour; ReplicaSet, Helm and ArgoCD history go back further. This is not a full audit log." It is plain visible text directly under the title, in `mute` at normal body size (not a tooltip, not collapsible), and appears in **every state** except Unreachable (where the tab shows no data and the line would describe nothing). For sts and ds a second line follows it in the same block: "StatefulSet and DaemonSet revisions aren't included." (the verbatim sentence names ReplicaSet history, which those kinds do not have in this release; see section 12.)

### 5.5 Entry anatomy (FINDING-ROW variant)

| Slot | Content |
|---|---|
| Lead | Severity glyph and, for non-info entries, the word: ▲ Warning (Warning events, failed Helm revision, failed journal action), ✕ Failed (journal action that failed, Helm `failed`), ● for the rest (no word). Then the **time** and the **source chip**. |
| Time | Relative ("4m ago") with the absolute local time and UTC in the `<time>` element's title and `datetime`. Older than 24 h: the clock time under a day heading. |
| Source chip | Text always: "Event", "Rollout", "Helm", "ArgoCD", "From this app". Icon decorative. Neutral role (`surface-tint`, `edge`), not status colours. |
| Title | One line: event reason; "Revision N created"; "Helm revision N {status}"; "ArgoCD synced to {short revision}"; the journal's own summary verbatim. |
| Detail | Event message verbatim (the backend caps at its own limit); rollout image(s); Helm description and chart version; ArgoCD revision and sync status; journal result. Wraps, never truncated, no horizontal scroll. |
| Details | Disclosure showing the remaining fields (full revision id, count, source object). |
| Show in … | A link-styled button that switches tab: Event, to Events; Helm and ArgoCD, to History; Rollout, to the workload's rollout history in Overview; From this app, to the Journal page with its search pre-filled with the object's name. |

**From this app.** The chip text is "From this app". Its tooltip and the Details disclosure say "Actions performed from this app on this machine. Times use this computer's clock." The second sentence is the clock-skew caveat (M8): a journal entry and a cluster event within a few seconds of each other can be in either order.

### 5.6 States

| State | Behaviour |
|---|---|
| Loading | One quiet line "Loading timeline…" and six skeleton rows. The panel gates rendering until **every source has settled**, so late sources do not insert rows above what the user is reading. If a source is still pending after 4 s the settled sources render and a line reads "Still loading Helm history…"; late arrivals merge in without moving the scrolled entry (anchor by entry id). The retention line shows during loading. |
| Nothing here | "No timeline entries for Deployment "api-gateway" in what could be read." plus the retention line. If all sources succeeded the first sentence reads "No timeline entries for Deployment "api-gateway"." and a second sentence: "Events from more than about an hour ago aren't kept." |
| Partial | A strip names each failed source with the verbatim reason: "Partially shown. Couldn't read events (forbidden). Showing rollouts and entries from this app." Entries from sources that worked still list. The source chip for the failed source is shown disabled with count "–" and the reason on focus and hover (DISABLE-PRECEDENCE). Never "No entries" while a source failed. |
| Error | Every source failed for a non-permission reason: "Couldn't load the timeline." plus `<message>` and **Retry**. With earlier results kept: the strip "Couldn't refresh. Showing entries from 14:02:11." |
| No access | Every source forbidden (journal is app-local and never forbidden, so this state cannot occur for the tab as a whole; if the journal is the only source that worked, it is Partial). |
| Too much data | The list shows the newest 100 entries; **Show 100 more** appends the next 100 and keeps focus on the first new entry. Count: "Showing 100 of 312". The journal fetch asks for 50 entries; if it comes back full, a line: "Showing the latest 50 actions from this app." |
| Time unknown | Entries with an empty timestamp go in a last group "Time unknown" with the explanation line (5.4). The group is collapsed when it has more than 20 entries. |
| Read-only | n/a: reads only. Reads are never blocked by read-only mode. |
| Not installed | ArgoCD or Helm panels exist only when those kinds do; n/a. |
| Unreachable | "Can't reach {cluster label}." and **Retry**. The journal is local but is not shown alone, to avoid a partial picture that looks complete. |

### 5.7 Interaction rules

- The list is **one tab stop** with roving focus (04 §6.2 precedent): `↑`/`↓` rows and day headings, `Home`/`End`, `→`/`←` expand or collapse Details, `Enter` follows **Show in …**, `Space` toggles Details. `Tab` on a row moves to its Details and Show-in buttons, then out.
- Source filter chips are toggle buttons (`aria-pressed`) with real counts; turning one off removes its entries and updates "Showing N of M". The default is all on.
- After a refetch focus stays on the same entry id; if it disappears, focus moves to the next entry and a polite region says "Removed from the timeline: {title}." No other refetch announcement (04 §6.3).
- No auto-refresh interval of its own. The panel's existing queries (Events etc.) refresh as they do today; the Timeline reads the same query data and the TopBar refresh invalidates them. The "Updated" time is the latest source fetch.

### 5.8 Copy

| Where | Text |
|---|---|
| Tab label | "Timeline" |
| Retention line (all kinds) | "Events are kept about 1 hour; ReplicaSet, Helm and ArgoCD history go back further. This is not a full audit log." |
| sts, ds extra line | "StatefulSet and DaemonSet revisions aren't included." |
| Journal chip description | "Actions performed from this app on this machine. Times use this computer's clock." |
| Time-unknown note | "These entries have no timestamp. Their order isn't meaningful." |
| Empty, all sources read | "No timeline entries for Deployment "api-gateway". Events from more than about an hour ago aren't kept." |
| Rollout title | "Revision 7 created" |
| Rollout detail | "Image shop/api:1.4.2 (was 1.4.1)" when the previous revision is known; otherwise "Image shop/api:1.4.2". |
| Helm title | "Helm revision 4 deployed" / "… failed" / "… superseded" (the history's own status word) |
| ArgoCD title | "ArgoCD synced to 3f9a2c1" (short revision) |
| First-load announce | "Timeline loaded. 15 entries." |

---

## 6. #16 External observability (ships in v2.3.0)

Inputs: `docs/impl/v2.3.0-tasks.md` T70-1 to T70-6; user decisions 2026-10-16: **Q70-1** both Prometheus and Loki/VictoriaLogs (logs are the expendable half), **Q70-2** discovery searches common namespaces first, with a **Search all namespaces** button.

### 6.1 Principles

- **Reached only through the API server's service proxy**, with the cluster credentials Garita already uses. The configuration dialog says so in one sentence, because it is the answer to "where does my data go?".
- **Metrics-server stays the fallback.** Every chart names its source. An unreachable backend degrades to a subtle note, never an error page.
- **Templates only.** There is no query box. The dialog says "Garita sends fixed queries; you can't edit them."
- Configuration is an app-local edit (the identity record), not a cluster write: no `ConfirmModal`, not blocked by read-only mode (the same standing as the read-only toggle itself). The probe and the queries are reads and are never blocked by read-only mode.

### 6.2 Where it lives: summary row plus a dialog (disagreement with T70-1's form placement, M4)

The identity record stays the store (T70-1). In the IdentityEditor, below Guardrails, a new group holds only a **summary** and one button.

```
IdentityEditor (inline, about 490 px, inside the 520 px switcher)
┌──────────────────────────────────────────────────────────────┐
│ OBSERVABILITY                                                │
│ Metrics  Prometheus: monitoring/prometheus-operated:9090     │
│ Logs     Not set                         [ Configure… ]      │
└──────────────────────────────────────────────────────────────┘
```

| State of the summary | Text |
|---|---|
| Nothing set | "Metrics: not set · Logs: not set. Garita uses metrics-server for current usage." and **Configure…** |
| Set | "Metrics: Prometheus, monitoring/prometheus-operated:9090" and "Logs: Loki, monitoring/loki-gateway:80". No live status here; reachability is tested in the dialog and shown by the charts. |
| Corrupt record | The existing `CORRUPT_STORE_NOTE` already shows for the whole editor; the summary reads "Not set" (corrupt is treated as unset, §2.5). |

**Configure…** opens the dialog (a modal layer, so Esc closes only it and `⌘K`, `⌘N`, `r` are inert while it is open; focus returns to the button). Opening it does not close the switcher; Esc closes the dialog first, then (a second press) the switcher, per Keyboard layering.

### 6.3 Dialog wireframe (size `lg`, about 640 px wide)

```
Observability · ● prod-eu                                              [x]
────────────────────────────────────────────────────────────────────────
Garita reads metrics and logs through the Kubernetes API server's service
proxy, using this cluster's credentials. It never connects to Prometheus,
Loki or VictoriaLogs directly, and sends fixed queries only.

[ Find services ]   Searches monitoring, observability, prometheus, loki
                    and kube-prometheus-stack first.

Suggestions (suggestions only; check the service before saving)
  Prometheus     monitoring/prometheus-operated:9090            [ Use ]
                 Matched the service name "prometheus-operated".
  Loki           monitoring/loki-gateway:80                     [ Use ]
                 Matched the label app.kubernetes.io/name=loki.
  Not here?  [ Search all namespaces ]

METRICS: PROMETHEUS
  Namespace [monitoring        ]  Service [prometheus-operated   ]
  Port [9090    ]  Scheme (•) http  ( ) https   Path prefix [        ]
  [ Test ]  ✓ Reachable. Prometheus 2.53.1                    [ Clear ]
  ⓘ Hint: needs permission to get services/proxy in monitoring.

LOGS
  Backend (•) Loki  ( ) VictoriaLogs
  Namespace [monitoring] Service [loki-gateway] Port [80] Scheme … Prefix …
  Labels  Preset [Loki (Promtail/Alloy) ▾]
          namespace [namespace] pod [pod] container [container]
  [ Test ]  ✓ Reachable.                                      [ Clear ]
────────────────────────────────────────────────────────────────────────
                                                   [ Cancel ]  [ Save ]
```

| Part | Spec |
|---|---|
| Title | "Observability" with the cluster's identity chip (`ClusterBadge`: colour plus label text), so the user knows which cluster. |
| Intro | The three-sentence paragraph above, visible text. |
| Find services | Runs `discover_observability` with common namespaces. Button label becomes "Find services again" afterward. While running: the button is `aria-disabled` with a spinner and "Searching…". |
| Suggestions | One row per candidate: kind word, `namespace/service:port`, the backend's `reason` verbatim under it, **Use**. No candidate is preselected and nothing is saved by finding or using. **Use** fills the matching group's fields and marks the dialog dirty. Several Prometheus candidates (operator, k8s, thanos) are listed; the user chooses. |
| Search all namespaces | Appears after the first search, and also when the first search found nothing. It runs the cluster-wide list on demand (Q70-2). Helper text: "Lists Services in every namespace your account can read." |
| Service fields | Namespace, Service, Port (number or name), Scheme (http default), Path prefix (optional, must start with `/`, no `..`). Inline validation on blur and on Save: "Path prefix must start with / and can't contain ..". |
| Test | Calls the probe for that group. Result is an inline line in `role="status"` (see 6.5). It never saves. |
| Clear | Empties that group's fields (undo is Cancel). |
| Logs labels | A preset select (Loki: namespace, pod, container; VictoriaLogs: `kubernetes.pod_namespace`, `kubernetes.pod_name`, `kubernetes.container_name`; Custom). Custom enables three text fields. The fields are always visible and read-only for presets, so the user sees what will be queried. |
| Save | Writes the record through the spread-preserving writer and closes. Disabled with reason while a field is invalid ("Fix the highlighted fields."); never disabled by the permission hint (fail open). |
| Cancel / Esc | Closes without saving. With unsaved edits, Esc and Cancel open a stacked confirm modal "Discard changes?" (red "Discard" / "Keep editing", focus on Keep editing); see `docs/ux/19-v2.3.0-discard-confirm.md`. |
| Initial focus | **Find services** (first control). |

### 6.4 Permission hint (T70-3)

`can_i` for `get services/proxy` in the entered namespace, fail open. Rendered as a HINT-ROW under the service fields: "Hint: needs permission to get services/proxy in monitoring." Only on an explicit deny the text becomes "Hint: your account may not be allowed to read through the service proxy in monitoring. **Test** shows the real result.", **and Test is `aria-disabled` with that reason** (DISABLE-PRECEDENCE: only an explicit deny disables; Save stays enabled). The charts never pre-check; they try and fall back.

### 6.5 Test results (probe states)

| `state` | Line | Role |
|---|---|---|
| ok | "✓ Reachable. Prometheus 2.53.1." (version when present) | `status-ok` glyph, `ink` text |
| unreachable | "Couldn't reach the service. Check the namespace, service and port. {message}" | `status-warn` glyph |
| forbidden | "No access to services/proxy in monitoring. {message}" | `status-warn` glyph |
| not-prometheus | "The service answered, but it doesn't look like Prometheus. Check the port and path prefix." | `status-warn` glyph |
| while testing | "Testing…" with a spinner; Test is `aria-disabled` | none |

Messages from the backend are shown verbatim after the plain line (00 §9.3). The words in each line carry the meaning; the glyph is decorative.

### 6.6 Where the sources show up (F2, F3, F4)

**Metrics tab (pod) and Node capacity history.**

```
480 px panel, Metrics tab, Prometheus configured and reachable
┌────────────────────────────────────────────────┐
│ Range  [ 1 h | 6 h | 24 h | 7 d ]    Source: Prometheus │
│ CPU    ▁▂▃▅▆▅▃▂▂▃▅▇▆▄▃▂  api  42m   (container "api") │
│ Memory ▃▃▃▄▄▅▅▅▆▆▆▆▇▇▇▇  api  118Mi                    │
└────────────────────────────────────────────────┘

Prometheus configured but unreachable
┌────────────────────────────────────────────────┐
│ Range  [ Now ]  (1 h, 6 h, 24 h, 7 d need Prometheus) │
│ ⓘ Prometheus unavailable, showing current usage only.  │
│   [ Retry ]  Why? ▾                                   │
│ Source: metrics-server · this session                 │
└────────────────────────────────────────────────┘

Not configured
│ Source: metrics-server · this session                 │
│ History beyond this session needs Prometheus. Not set for this cluster. [ Configure… ] │
```

| Part | Spec |
|---|---|
| Range picker | Segmented control 1 h, 6 h, 24 h, 7 d, default 1 h. Remembered per viewer in `localStorage` (try/catch), not on the identity record. When Prometheus is unavailable or unset, the longer options are `aria-disabled` with the reason "History needs Prometheus." |
| Source badge | Text chip, always visible, never colour alone: "Source: Prometheus" or "Source: metrics-server · this session" (the session qualifier matches right-sizing's "from this app session"). |
| Fallback strip | Exact text "Prometheus unavailable, showing current usage only." `status-info` glyph on `surface-tint`, text `ink`. It is information, not an error: no red, no alert role. **Retry** refetches; **Why?** discloses the backend message verbatim ("Failed to query metrics: …"). |
| No access | A 403 shows "No access to services/proxy in monitoring. Showing current usage only." with the same Retry and Why?. |
| Empty series | "No data for this pod in Prometheus." plus the fallback line. |
| Truncated | "Showing the first 20 series." (series cap) — points are downsampled by step selection and need no note. |
| Not configured | The quiet two-line block above. Not dismissible, one line of body text; it is not an error and does not nag with a badge. **Configure…** opens the dialog for the active cluster, from anywhere. |
| Node capacity | The node capacity history uses the same range picker, badge and strips; the existing 20-sample strip remains when falling back. |
| Right-sizing | When a 24 h p95 exists, the hint reads "Based on the 95th percentile over 24 hours." (still labelled **Hint**); otherwise unchanged: "Based on current usage only." The minimum-sample rule stays. |

**LogViewer (#16b).** The Source group gains a **History** range (1 h, 6 h, 24 h, 7 d) when a logs target is configured; otherwise the control is absent and the Source group is unchanged (a quiet "Log history isn't set up for this cluster. [Configure…]" line under the group, not an error).

| State | Behaviour |
|---|---|
| History selected | Lines come from the backend, shown in chronological order, filters and JSON mode work unchanged. A line under the toolbar: "Showing history from Loki, last 6 h." |
| Capped | "Showing the latest 5,000 lines of this range." |
| Backend unreachable | Falls back to the pod's retained log, with the strip "Log history unavailable, showing the pod's current log." and Retry. |
| No access | "No access to services/proxy in monitoring. Showing the pod's current log." |
| Empty | "No log lines from Loki for this pod in the last 6 h." |
| Pod no longer exists | The panel needs an existing pod, so deleted-pod history has no entry point yet. Decision D9. |

### 6.7 States for the configuration dialog

| State | Behaviour |
|---|---|
| Loading (discovery) | "Searching monitoring, observability… (N of M done)" is not available (the call returns once); show "Searching…" with the button disabled. |
| Nothing found | "No Prometheus, Loki or VictoriaLogs services found in the common namespaces." plus **Search all namespaces**; after that search: "None found in any namespace you can read. Enter the service manually." |
| Partial | The all-namespaces list can be forbidden or partial: "Couldn't list Services in some namespaces. The list may be incomplete." |
| Error | "Couldn't search for services." plus `<message>` and **Retry**. The manual form is unaffected. |
| Denied | Explicit deny on services/proxy: 6.4. |
| Read-only | Not affected (6.1). |
| Unreachable | Discovery and Test show "Can't reach {cluster label}."; the form stays editable and Save works (it only writes locally). |

---

## 7. #38 Live-state indicator (low-fi)

Inputs: T200-1 to T200-5 in `docs/impl/v2.0.0-tasks.md` (watch per active list view, polling always the fallback, manual refresh restarts the watch).

### 7.1 IA

A **text indicator** sits in the TopBar immediately left of the refresh button on resource list views. It is absent on non-resource views (Health, Journal, Settings, Map), whose data is on demand.

```
TopBar, right side
… [Filter…]   ● Live   ⟳
              ◐ Reconnecting…   ⟳
              ○ Polling         ⟳
              ‖ Paused          ⟳
```

Clicking it opens a `Popover` (registers a modal layer; Esc closes it and returns focus):

```
┌──────────────────────────────────────┐
│ Live updates                         │
│ Pods in namespace shop are updated   │
│ as they change.                      │
│ Last change 14:02:11                 │
│ [ Pause live updates ]               │
└──────────────────────────────────────┘
```

### 7.2 States

| State | Indicator text and glyph | Popover body | Data on screen | Refresh button |
|---|---|---|---|---|
| Connecting | ◐ "Connecting…" | "Starting live updates for pods in shop." | The polled data, no flash | Works as in Live |
| Live | ● "Live" | "{Kind} in {scope} are updated as they change. Last change 14:02:11." Action **Pause live updates**. | Rows update in place (7.3) | "Reload now": restarts the watch and shows a fresh snapshot. Tooltip "Reload now · live updates restart · Updated 14:02:11 (r)" |
| Reconnecting | ◐ "Reconnecting…" | "Live updates were interrupted at 14:01:50. Trying again. Rows below may be out of date." Reason verbatim when known. Actions **Retry now**, **Pause**. | Rows stay; the CHECKED/Updated time stops advancing | "Retry now": restart. Tooltip "Retry live updates · Updated 14:01:50 (r)" |
| Polling (fallback) | ○ "Polling" | "Live updates aren't available here, so this view refreshes every 30 s. {reason verbatim}" Action **Try live updates again**. | Polled | Refetch now and tries the watch again |
| Polling (kind not watchable, or multi-cluster) | ○ "Polling" | "This view refreshes every 30 s." No reason, no action. | Polled | Refetch now |
| Paused | ‖ "Paused" | "Live updates are paused. Showing data from 14:02:11." Action **Resume**. | Static; rows never change under the pointer | One-shot refetch; stays paused |

The interval in the Polling copy is the view's actual `refetchInterval`, supplied by the hook, never a hard-coded number.

Glyphs are decorative; the word is the state. The indicator uses neutral roles (`mute` text, `ink` on hover); only Reconnecting adds the `status-warn` glyph, because it is the one state that can mislead. Polling is not coloured as a failure.

### 7.3 Refresh, motion, order

- **Manual refresh stays reachable and enabled in every state** (brief constraint). Under Live it restarts the watch (T200-5); the spinner runs until the snapshot arrives; the 2 s cooldown stays.
- **Row-change feedback.** A row updated by a watch event gets a brief background tint that fades over about 1.2 s (`surface-tint` raised one step). Under `prefers-reduced-motion` there is **no flash and no fade**; the tint is omitted entirely. Nothing in the UI depends on the flash: the "Last change" time in the popover and the row's own values carry the information.
- **Rows must not move under the pointer.** While the pointer is over the table body or focus is inside it, a watch event updates values in place but does not re-sort. If the sort column is volatile (status, restarts, age) a strip appears above the table: "Rows changed. Order is paused while you work." with **Reorder now**. Moving the pointer out for 2 s, or pressing Reorder now, re-sorts. This is also the WCAG 2.2.2 mechanism together with Pause.
- **Pause** exists because automatically updating content that starts by itself must be pausable (WCAG 2.2.2). Pause stops the watch; Resume starts it and shows a fresh snapshot.

### 7.4 Scope, accessibility

- One indicator, for the active list view's watch. Panels, counts, NodeStrip and ClusterOverview keep polling and show no indicator (M6); the tooltip on the refresh button says only "Updated HH:MM:SS".
- Live region: a polite announcement only on **entering** Reconnecting ("Live updates interrupted. Retrying.") and entering Polling after a fallback ("Live updates unavailable. Refreshing by polling."). Nothing on entering Live or on row changes.
- The indicator is a button (24 by 24 px target at least), named "Live updates: Live" and so on, `aria-haspopup="dialog"`.

### 7.5 Open items for the tech lead

How many failed attempts before Reconnecting becomes Polling (copy shows the state, not the number); whether Paused persists across navigation (recommendation: no, a view mount starts live again). Both are D10.

---

## 8. #39 Multi-cluster tables (low-fi)

Inputs: T200-6 to T200-9 (polling, max 6 contexts, cross-cluster bulk refused, read-only per row's context).

### 8.1 Multi-context selection (ContextSwitcher)

The switcher's row click still **switches the active context**. Multi-select is a second, explicit control so the two meanings never share a click.

```
ContextSwitcher, 520 px
┌──────────────────────────────────────────────────────────────┐
│ Clusters                          [ Show several clusters ]  │
│ ☑ ● prod-eu      eks-eu-1    (active)                        │
│ ☑ ● staging      eks-st-1                                    │
│ ☐ ● dev          kind-dev                                    │
│ ☐ ● prod-us      eks-us-1                                    │
│ 2 of 6 selected · Selected clusters are shown together in lists. │
└──────────────────────────────────────────────────────────────┘
```

| Part | Spec |
|---|---|
| Mode | Off by default. **Show several clusters** reveals a checkbox column. The active row's checkbox is checked and `aria-disabled` with the reason "The active cluster is always included. Switch the active cluster to remove it." |
| Count | "2 of 6 selected." The 7th checkbox is `aria-disabled` with "A multi-cluster view holds up to 6 clusters." |
| Applying | Takes effect on check, no Apply step; the set is stored in `localStorage["active-context-set"]` (try/catch). One selected cluster means single-cluster mode (the set of one is not a multi view). |
| Leaving | **Back to one cluster** in the switcher, in the strip (8.3) and in ⌘K ("Clusters: back to one cluster"). The active context is unchanged. |
| Stale entries | A stored context that is no longer in the kubeconfig is dropped; the strip says once "{name} isn't in your kubeconfig anymore and was removed from this view." |
| Sidebar chip | Shows the active cluster plus the text "+2 clusters". TopBar breadcrumb: "3 clusters / all / pods". |
| Which views | List views drawn by `GenericResourceTable` and `PodTable`. Health pages, Map, Journal, Who can, Settings and detail-panel-only views use the **active cluster only** and show one line at the top: "This page uses the active cluster only: prod-eu." |

### 8.2 Cluster column

```
Pods, 3 clusters, namespace "all"   (full window)
┌────────────────────────────────────────────────────────────────────────────────┐
│ ☐ │ Cluster          │ Namespace │ Name            │ Ready │ Status  │ …       │
│ ☐ │ ● prod-eu        │ shop      │ api-7d9f-xk2lp  │ 1/1   │ Running │         │
│ ☐ │ ● staging  Read-only │ shop  │ api-5b6c-q9d2m  │ 1/1   │ Running │         │
└────────────────────────────────────────────────────────────────────────────────┘
```

- The cluster cell is the identity colour dot **plus the cluster label as text** (never colour alone), with the existing `ReadOnlyChip` when that cluster is read-only. A left row rule in the identity colour is a secondary cue only.
- The column is sortable and filterable, and is the first data column.
- Two clusters with the same colour or label are separated by the text; when labels collide the tooltip shows the context name.
- Row selection and keys are unchanged.

### 8.3 Per-cluster state strip

A strip above the table, one chip per selected cluster. Each chip is a toggle button (`aria-pressed`) that filters the table to that cluster, and shows the cluster's state in words.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [● prod-eu  Loaded 42] [● staging  Loaded 17] [● dev  Unreachable  Retry]  Back to one cluster │
│ Partially visible. Showing pods from 2 of 3 clusters. dev: can't reach the API server.            │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Per-cluster state | Chip text | Rows |
|---|---|---|
| Loading | "Loading…" | none yet |
| Loaded | "Loaded 42" | shown |
| Nothing here | "Loaded 0" | none; counts into the all-empty rule |
| Unreachable / auth | "Unreachable" / "Sign-in needed" + **Retry** | that cluster's rows are hidden (stale data could mislead); other clusters unaffected |
| Forbidden | "No access" | none |
| Error | "Error" + **Retry**; message in a disclosure | none |

Full-table states (STATE-VOCAB): all clusters failed, "Can't reach any selected cluster."; all loaded and empty, "No pods in namespace shop on any of 3 clusters."; some failed, the **Partially visible** strip above, rows still listed. A cluster is never silently omitted.

### 8.4 Namespace picker

The picker lists the union of namespaces across the set. Choosing "shop" applies to every cluster; a cluster without it shows "Loaded 0" with the note "namespace shop doesn't exist" in its chip's disclosure, so "no rows" is explained. Default for a new set is "all".

### 8.5 Row actions, bulk, read-only

| Case | Decision |
|---|---|
| Open a row | The detail panel is bound to the **row's** context and shows the identity chip in its header whenever the set has more than one cluster. The active cluster does not change. If the panel cannot take a context prop, the fallback is to switch the active cluster and show a strip "Switched to staging." (decision D11) |
| Write confirm | Always one cluster. `ConfirmModal` carries that row's `contextLabel`/`contextColor`; the title names the cluster: "Delete pod api-7d9f on staging". |
| Bulk selection | **Limited to one cluster** (T200-8). Once a row is selected, checkboxes of **other clusters' rows are `aria-disabled` with the reason** "Selection is limited to one cluster: prod-eu. Clear the selection to pick rows from another cluster." The existing selection is kept. This differs from T200-8's "clear the first selection with a notice", which loses the user's work silently. |
| Select all | The header checkbox is `aria-disabled` while more than one cluster has visible rows, reason "Select all works on one cluster. Pick a cluster in the strip first." |
| Mixed-cluster alternatives | (1) Refuse (above, recommended). (2) Per-cluster confirm: one confirm per cluster in sequence, each with that cluster's identity and typed confirm. Costs: N dialogs, partial completion states, an unclear Undo story. Refusal keeps one confirm equal to one context. |
| Read-only | Resolved **per row's context**. The strip above the table (existing `ReadOnlyStrip`) reads "Read-only mode is on for 2 of 3 clusters: prod-eu, staging. Writes on their rows are disabled." Each affected row's write controls are `aria-disabled` with "Read-only mode on staging (Garita guardrail)." |
| Watch | Not used in multi-cluster tables (T200-6); the TopBar indicator shows "Polling" with no action. |

### 8.6 States summary

Loading, per-cluster loading (chip), Nothing here (all empty), Partially visible (some clusters failed or hidden), Unreachable (per cluster; all clusters is a full-table state), Error (per cluster with Retry), No access (per cluster), Read-only (per row), Not installed (a CRD-backed kind absent on one cluster: that cluster's chip reads "Not installed" and the others still list; STATE-VOCAB wording).

---

## 9. Keyboard, focus and accessibility, consolidated

### 9.1 Keymap check (KEYMAP K6)

No new global shortcut. Scoped keys introduced:

| Keys | Meaning | Scope | Conflict check |
|---|---|---|---|
| Arrows, `Home`, `End`, `Enter`, `Space` | Move over graph nodes, open, details | Inside the focused graph canvas only | Same keys as the Health list composite; no global binding |
| `+`, `-`, `0` | Zoom in, out, fit | Inside the focused graph canvas, non-editable target (K1) | `r`, `/`, `?`, `f` untouched |
| `↑`/`↓`/`→`/`←`/`Enter`/`Space` | Timeline list composite | Inside the Timeline list | Same as Problems |
| `Esc` | Closes topmost layer | Global rule | Dialog, popovers register layers; the Map page and the Timeline tab are not layers |

`r` refreshes the visible page: Map invalidates its key; a panel's Timeline invalidates its sources.

### 9.2 Focus order

- **Map page:** Sidebar, TopBar, page header (What this map shows, mode toggle), focus-chip action, partial-strip Show which, kind filter toggles, Graph/List toggle, the canvas (one stop), canvas controls (+, -, Fit), details strip (Open, Show only this, related-object buttons), legend text. Choose-namespace and too-many blocks: heading, then their first control.
- **Timeline:** tab list, retention line (static text), source toggles, partial strip, the list (one stop), Show more.
- **Observability dialog:** Find services, suggestions (Use, then Search all namespaces), Metrics fields, Test, Clear, Logs fields, Test, Clear, Cancel, Save. Esc closes the dialog (with the stacked discard confirm if dirty; its focus order is Keep editing, then Discard).
- **Switcher multi-select:** Show several clusters, then each row's checkbox followed by its existing controls.

### 9.3 Live regions

| Event | Politeness | Text |
|---|---|---|
| Map first load | Polite | "Map loaded. 41 objects, 63 connections." |
| Map refetch with changed counts, user-initiated | Polite | Same sentence |
| Background refresh | Silent, except removed focused node | "Removed from the map: Pod api-xk2lp." |
| Too many appears | Polite | "Too many objects to draw. Choose where to start." |
| Partial strip appears | Polite | "Partially visible. Couldn't read 1 source." |
| Timeline first load | Polite | "Timeline loaded. 15 entries." |
| Test result in the dialog | Polite (assertive for a failure) | The result line |
| Live state, entering Reconnecting or Polling | Polite | Section 7.4 |
| Multi-cluster, a cluster fails | Polite | "dev: can't reach the API server." |

Announcements never repeat on every refetch.

### 9.4 Motion, zoom, targets

- Canvas has no animation (L5). The only motion in this package is the optional live row tint (7.3), absent under reduced motion; spinners may keep rotating (A11Y-BASELINE).
- At 200% zoom: pages reflow to the narrow layouts; the canvas scrolls inside its container; the dialog body scrolls; no page-level horizontal scroll. Below 560 px the Map defaults to List.
- Targets are at least 24 by 24 px: filter toggles, zoom buttons, Use, Test, Retry, Show in …, the live indicator.
- Colour is never the only carrier: node status (glyph and word), edges (line style and words in the strip), search match (dashed ring and "match"), cluster identity (colour dot plus label text), probe results (words).

---

## 10. Light and dark notes

All colour is by role (TOKEN-ROLES); UX-05's values apply. Nothing here uses a literal. `dim` fails WCAG AA as text in both themes; secondary text here uses `mute`.

| Surface | Roles | Notes |
|---|---|---|
| Canvas background | `surface-card` | Not `surface-sunken` (reserved for log and terminal panes). |
| Node box | `surface-panel` fill, `edge` ring; focused `focus-ring` | Status glyph carries `status-ok`/`warn`/`bad`; `mute` for Unknown; words in `ink` so contrast does not depend on coloured text. |
| Edges | `mute`, incident edges `ink` | Line style, not colour, separates families. Arrowheads same colour as the line. |
| Search match ring | `accent`, dashed | Follows the accent; never used for status. |
| Pseudo-nodes (#24) | `surface-tint` fill, `edge` ring | Visibly different from real objects by fill and by the word "pseudo" in the details strip. |
| Details strip, legend, strips | `surface-tint`, text `ink`/`mute` | Partial strips use a `status-info` glyph: information, not failure. |
| Timeline source chips | `surface-tint`, `edge` | Neutral; severity glyphs use `status-warn`/`status-bad` with the word in `ink`. |
| Fallback strip (#16) | `status-info` glyph on `surface-tint` | Not warn, not bad: a fallback is not an error. |
| Series in charts | `metric-cpu`, `metric-mem` | Never the accent. The badge text "Prometheus"/"metrics-server" is `ink` on `surface-tint`. |
| Cluster chips (#39) | `identity-*` dot plus label text | Identity red and `status-bad` are both red-ish; shape separates them (dot plus text vs glyph plus word), as in 04 §7. |
| Live indicator | `mute` text, `status-warn` glyph only for Reconnecting | |

---

## 11. Decisions for the tech lead

Numbered. Each has my recommendation. Items marked **R123** matter to the Rust task already running; the tech-lead freeze should relay them before the contract hardens.

| # | Decision | Recommendation |
|---|---|---|
| D1 **(R123)** | **Too-many state needs data the contract lacks.** T60-2 offers "filter by kind or by a starting object", but `get_resource_map` takes only `focus`. A kind filter that works on a truncated namespace has to be applied **before** the cap. | Add `exclude_kinds: Option<Vec<String>>` to `get_resource_map`, and `total_nodes: u32` plus `kind_counts` (map of kind to count, computed before truncation) to `ResourceMap`. The UI keeps working without `total_nodes`/`kind_counts` (the copy has a count-less form) and without `exclude_kinds` it drops "hide kinds" and keeps "start from an object" (which uses existing list hooks). Cheap in Rust; do it now. |
| D2 **(R123)** | What does a truncated response contain? | Return **empty `nodes` and `edges`** with `truncated: true`, plus the counts from D1. The UI never draws a partial graph, and a partial graph would silently drop the focus component's edges. |
| D3 | `status` for ConfigMap, Secret, PDB and HPA nodes. | Backend returns `unknown` for ConfigMap and Secret; the UI hides the status line for those two kinds only (closed list in the UI, D5). PDB and HPA get a real status if the list view has one, else `unknown`. |
| D4 | Dangling references (a Pod mounts a ConfigMap that does not exist) produce no edge, so the map hides a top debugging case. | Out of scope for v2.2.0 (Q60-2 says structural edges only). Say it in the footnote (done, 3.8). Next release: ghost node with `status: bad` and the word "Missing". |
| D5 | Where the "no status for cm/sec" rule lives. | A small constant beside the kind-to-label table in the frontend, with a test, not a new backend field. |
| D6 | Two optional frontend items: (a) **List view** toggle as the text alternative (2.7); (b) collapsed **pod groups** (3.7). | Ship (a) in F1: it is the keyboard, screen-reader and narrow-window answer and costs one grouped list over data already loaded. (b) is the difference between readable and unreadable for 20+ replica Deployments; ship it unless F1 is late. |
| D7 | Q60-1 (layout library). | This doc states requirements L1 to L9 and depends on no library. Any of `elkjs`, `dagre` or a hand-written layered layout meets them if it supports deterministic layered LR layout, islands, and a fixed node size. If layout runs in a worker (L6), `elkjs` needs its worker build; check bundle weight under Tauri. |
| D8 | Evaluator output shape for #24. | `netpolEval.ts` should return **group edges** (after label-set grouping) with `ports` and `allowedBy: string[]` (policy name plus direction plus rule index), and a per-group `{ingress, egress}: { restrictedBy: string[] }`. The "draw an edge only when at least one side is restricted" rule (4.2) lives in the evaluator, with tests. |
| D9 | Deleted-pod log history (#16b) has no entry point, because the pod panel needs a live pod. | Keep it out of v2.3.0 UI; the live item "A deleted pod's logs are retrievable" stays a backend check. If wanted, a "Pod name" field in a workload's History range is the smallest entry point. |
| D10 | #38 details: failures before fallback; Paused persistence. | Fall back after 3 failed reconnects within 60 s; Paused does not persist across view mounts. Copy never states the numbers. |
| D11 | #39: panel context for a row of another cluster. | Panels accept a `context` and show the identity chip. If panel components read the global context, switch the active cluster and show a strip "Switched to staging." Decide before F2 of that release. |
| D12 | #16 probe for logs. | `probe_metric_backend` is named and typed for Prometheus (`not-prometheus`). Generalise it to take a flavour (`prometheus`, `loki`, `victorialogs`) and return `not-{flavour}`, or add `probe_logs_backend`. The dialog's second Test needs it. |
| D13 | #16 dialog is a new modal host. | It must register a modal layer (`useModalLayer`), restore focus to Configure…, and be in the `ui.md` "every modal host" list. |
| D14 | Provisional rows in 00 §7.3 for Resource map and Change timeline. | Update: Map = Health page (confirmed); Timeline = panel tab, no Health row. |

Answers to the UX-06 brief's own open questions:

| Brief question | Answer |
|---|---|
| Where #16 endpoint configuration lives | Identity record, edited in a dialog opened from a summary row in the ContextSwitcher IdentityEditor (6.2). |
| Maximum context count for #39 | 6 (T200-7, adopted); the 7th checkbox is disabled with a reason (8.1). |
| Does the map need a graph-rendering dependency? | A layout dependency, not a renderer (Q60-1). The design assumes only L1 to L9; a hand-rolled layered layout would also meet them. |
| IA for Map and Timeline | Map: Health page plus panel action. Timeline: panel tab (1.4). |
| Live-state indicator | Section 7. |
| Multi-context selection UX | Section 8. |

---

## 12. Disagreements with the briefs

The brief wins unless the tech lead adopts a change. Each is deliberate.

| # | Where | Brief says | This doc says | Why |
|---|---|---|---|---|
| X1 | `v2.2.0` F2 "click a node → `onNavigate`" | A click navigates. | A click or arrow **focuses** a node (details strip); **Open**, `Enter` or double-click navigates, and uses the Problems-style jump that opens the panel (M3). | `onNavigate` lands on a filtered list without a panel; navigating on click also destroys keyboard exploration of a graph. |
| X2 | `v2.2.0` §1.3 T60-2 / §2.1 | "Filter prompt by kind" with only `focus` in the contract. | Needs `exclude_kinds`, counts and empty `nodes` when truncated (D1, D2). | A kind filter after truncation cannot work. |
| X3 | `v2.2.0` §2.3 retention line, verbatim | One sentence for every kind. | The sentence stays verbatim; for sts and ds a second line adds "StatefulSet and DaemonSet revisions aren't included." | The sentence names ReplicaSet history; sts/ds have none in this release (T60-5 table), so the sentence alone over-claims. |
| X4 | `v2.3.0` T70-1 / F1 "IdentityEditor Observability group" | The group holds discovery, manual entry, Test and the hint. | The group is a summary row; the form is a dialog (M4). Storage is unchanged. | The editor is an inline expander in a 520 px dropdown with immediate-apply controls and no Save; a form with Test needs a Save/Cancel boundary. |
| X5 | `v2.0.0` T200-8 "selecting a second cluster's row clears the first selection with a notice" | Clear on cross-cluster select. | Other clusters' checkboxes become `aria-disabled` with a reason; the selection stays (8.5). | DISABLE-PRECEDENCE: disabled with a reason beats silent loss. |
| X6 | `v2.2.0` F3 "Health Map mode toggle" | A toggle on the Health page. | Same, plus a ⌘K entry "Health: Network policies (approximation)" and the Pod-panel section "Who can reach this pod (approximation)" in the Summary tab. | Every nav entry needs a ⌘K entry (00 §7.3). The section was already in F3. |
| X7 | `v2.3.0` §2.2 probe | `probe_metric_backend` only. | Generalise or add a logs probe (D12). | The logs half needs a Test too. |
| X8 | 00 §7.3 rows 491 and 492 | Map and Timeline provisional in Health. | Map confirmed in Health; Timeline is a panel tab only (D14). | T60-5. |

---

## 13. Where each mandatory qualifier appears

| Qualifier | Required text | Surfaces in this package |
|---|---|---|
| approximation (#24) | "Network policies (approximation)", the persistent note, "Legend (approximation)", the empty-state sentence, the Pod panel title | Mode toggle label, page title in the mode, note under the scope line, legend heading, empty state, Pod panel section, ⌘K entry, canvas accessible name |
| events about 1 hour, not an audit log (#17) | "Events are kept about 1 hour; ReplicaSet, Helm and ArgoCD history go back further. This is not a full audit log." | Timeline tab, directly under the title, in every state but Unreachable (including loading and empty) |
| from this app (#17, #31) | "From this app" chip; "Actions performed from this app on this machine. Times use this computer's clock." | Journal entries in the Timeline |
| hint (#16 p95, permission, SSAR) | "Hint" label; "Based on the 95th percentile over 24 hours." / "Based on current usage only." | Right-sizing hint with Prometheus; the services/proxy permission HINT-ROW in the dialog |
| point-in-time / source | "Source: Prometheus" / "Source: metrics-server · this session" | Every chart in the Metrics tab and Node capacity |
| read-only wording | "Read-only mode (Garita guardrail)" | Per-row disabled reasons in multi-cluster tables (8.5) |

Words this package never uses: "secure", "protected", "isolated", "blocked" (for a missing network edge), "smart", "score", "grade", "auto-fix", "audit log" (except in the negation above), "Apply" (nothing here writes).
