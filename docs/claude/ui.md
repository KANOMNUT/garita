# UI shell, modals, keyboard

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Manual Refresh (v0.8.1)

`RotateCw` icon button in `TopBar.tsx`.

- Keys come from `RESOURCE_QUERY_KEY` (`src/utils/resourceQueryKey.ts`).
- Pods view invalidates `["pods", ctx, ns]`, `["cluster-info", ctx]`, `["nodes", ctx]`; other views invalidate a 2-element prefix key.
- 2 s cooldown via `lastRefreshRef` (`useRef<number>`), not timer state.
- `useIsFetching()` drives spin and disabled state; `prefers-reduced-motion` (`src/index.css`) stops the spin and the `.slide-in` / `.fade-in` panel animations (Tailwind 4 emits their keyframes from the config, so they run).
- Tooltip: `"Refresh · Updated HH:MM:SS · (r)"`.
- **Non-resource views (v1.4.1):** `handleRefresh` has one explicit branch per view. Settings does nothing; it must not fall through to the active-resource branch. Journal invalidates `["journal"]`. Who can invalidates `["who-can", ctx]`. Health pages use `HEALTH_QUERY_KEY`.

## Window Dragging

`data-tauri-drag-region` is unreliable in Tauri v2 (checks `event.target` only, not ancestors). Use:

```tsx
onMouseDown={(e) => {
  if (!(e.target as HTMLElement).closest("button, input, a")) {
    e.preventDefault();
    void getCurrentWindow().startDragging();
  }
}}
```

Needs `"core:window:allow-start-dragging"` in `src-tauri/capabilities/default.json`.

## Resizable Detail Panel

`DetailPanel` and `ResourceDetailPanel` both call `useResizablePanel("detail-panel-width")` (`src/hooks/useResizablePanel.ts`). Shared `localStorage` key; clamp 320-900 px, default 480 px; 6 px left-edge handle (drag left widens). Do not duplicate this logic.

## Command Palette (⌘K)

`CommandPalette.tsx` lists resource types by section. `↑`/`↓` move, `Enter` selects, `Esc` closes. `listRef` + `scrollIntoView({ block: "nearest" })` on `[data-active="true"]` keeps the highlight visible.

- **Actions (v1.3.1):** `actions?: PaletteAction[]` (read-only on/off, Settings, Settings: Appearance, Settings: Diagnostics, Compare…) in an "App" section built in `App.tsx`. `PaletteAction.keywords?: string` is extra words the palette matches (not shown), matched like `label`; "Settings: Appearance" carries `theme dark light accent colour`. The palette **closes before `run()`**. Disabled entries stay visible with `disabledReason`. Read-only on is immediate; off is always a confirm.
- **Cluster-wide search (v0.8.0):** with `query.length >= 2` and a `context`, `useSearchResources` results show above nav items; keyboard spans both. A result calls `onNavigate(resource_type, namespace, name)` (pre-fills the target page search via `navigateSearchRef`). `Loader2` replaces the `⌘K` badge while fetching.

## Ownership Relationship Graph (v0.8.0)

`get_resource_graph(context, namespace, kind, name) -> Vec<GraphNode>` (`graph.rs`) walks `ownerReferences`: `deploy` → ReplicaSets → Pods; `sts` / `ds` / `jobs` → Pods; `cron` → Jobs → Pods. Node: `kind`, `name`, `namespace`, `uid`, `status`, `children`. No `rs` arm.

Workload panels get a Relationships tab (`RelationshipsTab`, collapsible `GraphNodeRow`). `useResourceGraph` is enabled as soon as a workload panel opens, not on tab click.

## Resource map and NetworkPolicy view (v2.2.0)

Read-only. Two commands, one renderer, one Health page ("Map", `HEALTH_PAGES.map`, query prefix `"resource-map"`). Contract: `docs/impl/v2.2.0-tasks.md`; UX: `docs/ux/06-realtime-fleet.md` §2–§4.

- **`get_resource_map(context, namespace, focus?) -> ResourceMap`** (`map.rs`). `focus` = `"<kind>/<name>"`.
  - Node id = `"<kind>/<namespace>/<name>"`; a PersistentVolume has namespace `""` (`pv//<name>`). `kind` is a `ResourceType` id, so pods are `pods`.
  - Per namespace only: `""` and `"all"` return `Err` (`map_namespace`); the UI never sends them.
  - A forbidden or failed list goes to `skipped` (reuses `SkippedSource`); `Err` only when the client cannot be built. Absent Gateway API CRDs (404) give no nodes and no skip.
  - Edges, `from -> to`: `owns` (owner -> owned, by `ownerReferences` uid), `selects` (Service -> Pod, label match; a Service without a selector selects nothing here), `protects` (PDB -> Pod, `drain::selector_matches`), `routes-to` (Ingress -> Service; HTTPRoute -> Service), `attaches-to` (HTTPRoute -> Gateway), `mounts` (Pod -> PVC), `binds` (PVC -> PV), `uses-config` / `uses-secret` (Pod -> ConfigMap / Secret through volumes, projected sources, `env.valueFrom` and `envFrom`), `scales` (HPA -> Deployment, StatefulSet or ReplicaSet). `imagePullSecrets` and generic ephemeral volumes have no edge.
  - An edge whose endpoint is not a listed node is dropped in `build_map`: other namespaces (only PVs cross), objects that are gone, forbidden sources. Only PVs that a listed PVC names get a node. There are no ghost nodes.
  - **`kube-root-ca.crt` and `openshift-service-ca.crt` (`INJECTED_CONFIGMAPS`) get no node and so no edge.** Every pod projects the root CA, so an edge from each pod would join the whole namespace into one component and `focus` would narrow nothing.
  - ConfigMap and Secret nodes have status `"unknown"` (the map does not evaluate them; the UI hides their status word, `NO_STATUS_KINDS`). Other statuses are a coarse tone (`ok|warn|bad|unknown`) computed in `map.rs`; the list views' words are frontend-side, so this mirrors them and does not share code.
  - ConfigMaps and Secrets are listed with `list_metadata`, Secrets with the field selector `type!=kubernetes.io/service-account-token,type!=helm.sh/release.v1`: names only, no data, no type.
  - **Ceiling:** `NODE_CEILING = 2000` is a payload guard, not a readability cap. `focus` is applied first (`limit_component`: that object's connected component, which is a superset of what the page shows; an unknown focus gives an empty map, `truncated: false`); then, above the ceiling, `nodes` and `edges` are empty and `truncated` is true. A partial graph is never returned.
- **"Show only this" = lineage, not the component** (`lineage(map, fid)`, `resourceMap.ts`). Walk upstream through strictly lower `MAP_COLUMN`s and downstream through strictly higher ones (either edge direction), then add the up- and downstream of every Pod in that set. A Pod focus keeps Ingress, Service, HPA, Deployment, its own ReplicaSet, the Pod and its config, and drops sibling ReplicaSets and other apps that share a Secret; a Deployment keeps all its ReplicaSets; a Service keeps HTTPRoute -> Gateway. `MapPage` computes it once (`narrowed`) and feeds the graph, the List rows, the kind counts, the announcement and the scope line, so Graph and List never diverge. `ponytail:` the Rust `NODE_CEILING` still counts the whole component.
- **Frontend pipeline, always in this order** (`lineage` when focused, then `prepareMap`, `resourceMap.ts`): lineage (focus) -> group pods (an owner with more than `GROUP_OVER` = 8 pods becomes one `group:<ownerId>` node, edges re-targeted and deduped, worst status) -> hide kinds (`hideKinds`) -> count -> **`DRAW_CAP` = 400**. Pods are grouped **before** kinds are hidden (v2.3.1): hiding an owner kind (ReplicaSets, StatefulSets, DaemonSets, Jobs) first would remove its `owns` edges, `groupPods` would see unowned pods and every pod would become its own node, so hiding a kind would make the map bigger and could cross the cap. A group has kind `pods`, so hiding Pods still hides the groups; hiding the owner drops only the owner and its `owns` edge. `hideKinds` is generic over the node type so a group keeps its `members`. Count and cap stay after both steps. The List view (`flat` in `MapPage`) hides on the ungrouped set, and the kind counts (`countByKind`) are taken from the lineage-narrowed set before any hiding. Above 400 drawable nodes the page shows the too-many state with a start-from-an-object prompt and never calls `layout`. Pod groups are collapsed-only: the details strip lists the members with an Open button each; there is no expand in place.
- **Kind filter (v2.3.1).** The hidden state is a `ReadonlySet<MapKind>` (`hidden` in `MapPage`); every change goes through `setKinds`. It replaces the v2.2.0 per-group hiding (O11 is superseded; `hideGroups` and `countByGroup` are gone). Contract: `docs/impl/v2.3.1-tasks.md` §3.2; UX: `docs/ux/22-v2.3.1-search-and-filter.md` §3 as amended by the plan's §2.2.
  - **Controls** (`KindFilter`, rendered in the page's filter row and, in the too-many state, as "Or hide kinds:" unless the response was `truncated`). The five group chips (`KIND_GROUPS`) stay as shortcuts over kinds: `groupState` / `toggleGroup`, `aria-pressed` true, false or `"mixed"` (button text "x of y" when partial). The **Kinds** button (`data-kinds-button`, text "Kinds" or "Kinds · N hidden", N = `hiddenPresent`: hidden kinds that have objects here) opens the shared `Popover` with a checklist of every kind (`ALL_KINDS`, grouped by `KIND_GROUPS`) with its object count (`countByKind`), plus **Show all** and **Hide all** (each disabled with a reason when it would do nothing).
  - **Keyboard.** Each row is a native checkbox and one tab stop; Space toggles; there is no arrow-key handler (C-2, confirmed by the user). Focus moves to the first row on open. Esc closes the popover and returns focus to the button (`Popover`).
  - **Zero-count rows** are disabled with a reason from `zeroReason`: "Couldn't read this kind." when the kind's source is in `skipped` (`KIND_SOURCE`; `endpointslices` maps to no kind), else "No objects of this kind in this namespace." (or "chain" while focused). A group chip with no objects is disabled the same way (`groupZeroReason`) unless one of its kinds is flagged hidden (after Hide all), so it can be turned back on.
  - **Hidden is disclosed, never bridged** (user, Q3): no edge is drawn through a hidden kind. The search match line says when matches sit in hidden kinds (`matchLineText`, counted with `matchIds` over the hidden nodes of the lineage-narrowed set); a node's accessible name, the details strip and the List row say how many connections go to hidden kinds (`hiddenLinkText`, counted by `hiddenLinks`: distinct relation, direction and other-object links, and a collapsed pod group counts its members' distinct links, so 12 pods that mount one hidden ConfigMap count 1). A kind toggle is announced once per burst (400 ms, `kindsAnnouncement`) with the counts of the ungrouped hidden-applied set (the List's `flat`), and not at all while the too-many state is shown. With every kind hidden the page says "All kinds are hidden. Turn a kind back on to see the map." and **Show all kinds** (`showAllKinds`) arms `requestFocus` first, then focuses the Kinds button.
  - **Persistence.** Not persisted: `hidden` resets to empty when the context or namespace changes (an effect keyed on `${context}/${namespace}`). It survives a focus change, the Graph/List toggle and the Resources / Network policies mode, because `MapPage` stays mounted (the netpol mode is rendered from `MapPage`'s own early return). The canvas `epoch` is the sorted hidden kinds plus the focus, so a node that leaves because of a toggle is not announced as "Removed from the map".
- **Layout: no layout dependency** (user, 2026-10-16; `package.json` gains none). `utils/graphLayout.ts` is pure and synchronous: map columns from `MAP_COLUMN` (`ing, gw` 0; `httproute` 1; `svc, hpa` 2; `deploy, sts, ds, cron` 3; `rs, jobs, pdb` 4; `pods` 5; `pvc, cm, sec` 6; `pv` 7), connected islands ordered by smallest id with one-node islands in a final "Not connected" band, dummy nodes for edges spanning more than one column (one reserved lane slot per intermediate column), 4 barycenter sweeps. Edges are orthogonal (`elbow`, `graphLayout.ts`, tested): out of the source's side, vertical in the column gap, into the target's side; a long edge runs horizontally through each dummy slot's own y, so no segment crosses a box that is not an endpoint, and every point is inside the canvas (invariant test). Corners are sharp. Per gap and island, each left-side owner of a turn (a node or a lane) gets its own vertical x track, spread inside the gap and ordered by the owner's y; a fan-out shares one bus and no two unrelated edges share a vertical run (overlap assertion in the routing invariant test). `COL_PITCH` 304 leaves a 120 px gap for the labels. Marked `ponytail:` (no crossing counting); the upgrade path is a transposition pass, then `@dagrejs/dagre`, which needs a fresh OK from the user. Every sort has an id tie-break, so `layout` is a pure function of the node and edge sets; `layoutKey` ignores status and labels. Netpol mode ranks columns with `rankColumns` (back edges reversed for ranking only).
- **`GraphCanvas`** (`components/graph/`): one scroll container, a CSS `scale` transform (0.5 to 2), an SVG edge layer under absolutely positioned HTML `<button>` nodes (hover does not tint a node, so a box stays opaque). **Edge labels** (relation word, then the backend `detail`; netpol: the ports) show only while a node is hovered or has DOM focus (keyboard focus wins after a key press; ids that left the map are ignored), for that node's own edges: HTML spans above the nodes in an **unscaled** layer (11 px at every zoom, positioned by `x * zoom`), `bg-surface-card`, anchored on the route's own vertical track (`PlacedEdge.anchors`), `aria-hidden`. `spreadLabels` merges edges with the same anchor x and text into one card ("selects · 7080 → 3000 ×3") and keeps cards at least 44 px apart; a card near the canvas top is drawn below its anchor. Esc hides the drawn labels (and is consumed only then). Nothing is labelled otherwise. `ponytail:` labels are not tested against nodes beyond that (a 3-line card on a top lane can still cover a neighbour's lane). A card is clamped inside its column gap (`clampToGap`), so it does not cover a box while it fits the gap (zoom of about 83% and up); below that it is centred on the gap and can overlap the edges of the boxes beside it. Ceiling (`ponytail:` in `graphLayout.ts`): a horizontal exit or entry stub can run on another edge's line for 12-55 px when a source and another edge's target share a row in adjacent columns (entry ports or dagre would fix it; `open-items.md`). Changing the focus fits the new set once, at most 100% (`fitKey`); node buttons carry `scroll-margin` so arrow-key reveals leave room for the gap's labels. The same detail is in text: `relationsOf` appends `(detail)`, which feeds the details strip and the List view. The focus banner (`focusBanner`) says how many of the connected objects the chain keeps; zero kind chips say "in this chain" while focused. The Network policies view keeps its own focus (direct neighbours, banner "Showing what is connected to …"); do not align the two. One tab stop, roving focus; line style (solid, dashed, dotted via `edgeFamily`) carries the relation family, not colour. `GraphList` is the grouped-list view behind the page's Graph/List toggle; it is never auto-selected (the toggle starts on Graph at every width).
- **Entry points.** The Health "Map" page (namespace picker; `"all"` shows "Choose a namespace"), a header **Map** action in the panel for `MAP_PANEL_KINDS` (workloads and Services, not pods; `openMap` in `App.tsx` closes the panel, sets the namespace and the focus, and DOM focus lands on that node once it first renders; `focus.enter`), and the palette. Queries run only while the page is visible (hidden mount), `staleTime` 30 s, no interval, `retry: false`; TopBar refresh invalidates `["resource-map", ctx]`.
- **Open = `jumpFromHealth`** (as on the Problems page): the object's list view filtered to its name. **No panel opens** (deferred, `open-items.md`).
- **NetworkPolicy view: always labelled "approximation".** `get_network_policy_model(context, namespace) -> NetpolModel` (`netpol.rs`) converts the policies, this namespace's pods (name, labels, `controller` = `"<Kind>/<name>"` of the controller ownerReference; `Succeeded` and `Failed` pods are left out) and every namespace's labels into plain data; `policy_types` is defaulted as the API does. The semantics live in one place, `utils/netpolEval.ts` (`evaluateNetpol`, `podReach`; pure, tested):
  - A pod no policy selects is unrestricted for that direction; a selected pod gets the union of its policies' rules; an empty `ports` list means all ports; `podSelector` plus `namespaceSelector` in one peer is AND; an `ipBlock` is an "External {cidr}" pseudo-node; a named port stays a name.
  - **All-peers.** An empty `peers` list is the "Anywhere" pseudo-node. `podSelector: {}` alone, and a `namespaceSelector` that matches this namespace with no or an empty `podSelector`, are also all-peers (the latter adds a namespaces pseudo-node when other namespaces match). An all-peer matches every group in the two-sided check and is drawn only as pseudo-nodes ("Anywhere", "All pods in namespace {ns}"), never as per-pair group edges.
  - **Group edges.** A -> B needs A's egress and B's ingress to both allow it (an unrestricted side allows everything). The edge is drawn only when at least one side is restricted and a restricted side matched through a specific (non-all) peer; otherwise the pseudo-node edge already shows it, so there is no complete digraph.
  - **"No allow rule found"** comes from the evaluation (`NetpolResult.noRule`), never from the absence of a drawn edge. An unrestricted direction reads "not restricted by its own policies (any source)" / "(any destination)"; the node sub-line abbreviates it to "no limit" ("In: restricted · Out: no limit"), with the full words in the tooltip, accessible name and strip.
  - Pods group by labels minus `IGNORED_LABELS` (`pod-template-hash`, `controller-revision-hash`, the StatefulSet pod-name and pod-index labels, the Job controller-uid and job-name labels) unless a policy selects on them.
  - For pseudo-node peers (other namespaces, external, all-peers) only the in-namespace side is evaluated (O6). With the namespaces list skipped, a `namespaceSelector` matches this namespace only for `{}` or a lone `kubernetes.io/metadata.name` selector naming it (`{}` reads "All namespaces"), and its pseudo-node reads "matching namespaces unknown" (O7).
  - **Fixed wording** (`NETPOL_NOTE` in `NetpolView.tsx`, and the pod panel note): CNI-specific policies (Calico, Cilium, AdminNetworkPolicy) are not included; named ports are not resolved to numbers; traffic to or from the node itself is handled differently by some CNIs; this is not a connectivity test; policies in other namespaces aren't read.
- **Surfaces.** The Map page's mode toggle "Resources" / "Network policies (approximation)" (state owned by `App.tsx`; switching remounts the tree, and `Segmented remounts` in `HealthShell.tsx` hands DOM focus back to the checked toggle button); the palette entry "Network policies (approximation)"; the pod panel section "Who can reach this pod (approximation)" (`WhoCanReachSection.tsx`) with "Show on map".
- Adding a map kind: `resource-types.md` → Adding a New Resource Type.

## Change timeline (v2.2.0)

An object-scoped **Timeline** panel tab (`TimelineTab.tsx`; pure merge in `utils/timeline.ts`: `mergeTimeline`, `groupByDay`). No new aggregation command: it reads what the panel can already read.

- **Kinds and sources** (`TIMELINE_KINDS` = `deploy`, `sts`, `ds`, `helm`, `argocd`):
  - `deploy`: rollout history (`RevisionInfo.created_at`, the ReplicaSet's creation time, shown as the detail "ReplicaSet created …" because a rollback reuses an old ReplicaSet), Events (kind-filtered by `EVENT_INVOLVED_KIND`), journal.
  - `sts`, `ds`: Events and journal only. The tab says "StatefulSet and DaemonSet revisions aren't included."; ControllerRevisions are not fetched.
  - `helm`: `list_helm_history` (`updated`), Events (no kind filter, `EVENT_INVOLVED_KIND.helm` is null), journal.
  - `argocd`: `ArgoCdApp.history` (`deployed_at_iso`, passed in by the panel), Events (kind `Application`), journal.
- **Retention line, verbatim, in every state:** "Events are kept about 1 hour; ReplicaSet, Helm and ArgoCD history go back further. This is not a full audit log."
- **Event time:** `Event.last_timestamp` (RFC3339 seconds, `Z`) comes from `problems::event_time`: `lastTimestamp`, else `eventTime`, else `metadata.creationTimestamp`, else `""`. The Problems rules use the same function.
- **Journal rows are labelled "From this app".** `list_journal(limit?, before?, context?, namespace?, name?)` filters server-side on exact context, namespace and name (blank = no filter, applied before the limit). There is **no `kind` filter**: kinds come in three spellings, so `useObjectJournal` asks for the 50 newest rows for the name and `mergeTimeline` keeps those whose `journalResourceType(kind)` equals the panel kind (`utils/journal.ts`; `journalKind` uses the same lookup). There is no "Show in Journal" link: `TimelineTab` has an optional `onOpenJournal` prop and the panel does not pass it.
- **`parseTs`** returns epoch ms, or `null` for `""` and anything unparseable. It trims the fraction to 3 digits first, because WebKit's `Date.parse` can reject Helm's RFC3339Nano `updated`. Entries with no usable time sort last under "Time unknown"; the rest are newest first, grouped Today / Yesterday / date by local day.
- Sources are read only while the Timeline tab is active. The panel's tab strip scrolls horizontally inside itself (`overflow-x-auto`) and keeps the selected tab in view.

## Confirm-on-Destructive (v0.8.0, corrected v1.2.0)

This section once claimed `PodTable` single-row delete was confirmed when it was not. Verify claims against code; change this section in the same diff as the behaviour.

Confirmed through `ConfirmModal`:
- `PodTable`: single-row delete; bulk delete and restart (typed above 10 pods: namespace, or cluster label across namespaces).
- `DetailPanel`: overflow-menu delete; header **Restart** (calls `delete_pod`; the dialog says the controller recreates it; `owner` null gets destructive styling and a "will not come back" note).
- `WorkloadActions`: scale-to-zero warning, rollback target revision, and Restart / Pause / Resume / Trigger CronJob as `sm` **non-destructive** (info glyph, primary not red; labels end with "…"). On error the dialog stays open with the error in `status` and the primary reads "Try again". Trigger success names the Job `trigger_cronjob` returns.
- `ResourceDetailPanel`: delete, node delete (**typed**, node name), node drain (`NodeDrainDialog`).
- Sidebar namespace delete: destructive, typed (namespace).
- ArgoCD app delete: `md`, two finalizer options ("Delete app + resources" / "Delete app only").
- YAML **Review & save…** and Helm **Review upgrade…**: PREVIEW-GATE `lg` dialogs (`YamlSaveGate`, `HelmUpgradeGate`). See `writes.md`.
- `ResourceEditor` / `ResourceCreator` show the cluster badge; the editor primary reads **"Save changes"**.
- `GenericResourceTable` row delete; `ArgoCdActionBar` sync/prune; ArgoCD History rollback (non-destructive style); Helm uninstall and rollback.

`requireTyping?: string` gates the primary on an exact typed match.

**Every `<ConfirmModal>` call site carries `contextLabel` / `contextColor`**, and so does the drain dialog. Check it as a property (grep), not a count. The props are optional, so `tsc` will not catch a new site that omits them.

**Single-click writes, by design:** ArgoCD Sync without prune, Refresh / Hard Refresh, Cordon / Uncordon, Taint add / remove get an `sm` confirm via `useGuardedAction` **only while the cluster's typed-confirm guardrail is on**. Port-forward start/stop stay unconfirmed (local listener, no cluster object).

### ConfirmModal anatomy (v1.2.1)

All props optional; old call sites compile unchanged.

- **Sizes** `sm` (default) / `md` / `lg`. Body scrolls, header/footer pinned, max 90vh, full width minus 16 px on narrow screens.
- **Slots:** `children` body, `status` (`{ tone: "error" | "info" | "ok", text }`, errors in an assertive live region), optional `footer`. `description` takes a `ReactNode`.
- **Phases** `review` / `running` / `attention` / `result` / `error`; `confirmDisabled` + `confirmDisabledReason`.
- **Semantics:** `role="dialog"`, `aria-modal`, `aria-labelledby` title, `aria-describedby` summary. Focus trapped, returns to opener. Initial focus: destructive without typing → Cancel; typed → input; non-destructive → primary.
- **Esc/backdrop:** in `running`, Esc calls `onEscapeWhileRunning` and does not close; while a mutation is pending both do nothing; backdrop closes only an `sm` dialog without typing, in `review`.
- **`⌘↵` / `Ctrl+Enter`** fires the primary only when enabled: never past an unmatched typed value, never in `running`.
- The typed value resets to `""` every time `open` turns true.
- Non-destructive dialogs use an `accent` info glyph, never the warning triangle.
- **v1.3.1 props:** `context` (applies that cluster's guardrails: typed label, read-only block, `--kubeconfig` footnote), `ignoreGuardrails` (the "Turn off read-only" confirm), `cancelLabel` ("Back to editor" in PREVIEW-GATE), `initialFocus` (`"cancel" | "primary" | "input"`, overrides the rule above), `kubectlEquivalent` (slot 6), `notice` (slot 7, above the typed input), `acknowledge` (`{ label, reason? }` checkbox gate; resets on reopen; `⌘↵` never passes it).
- **At most one typed field.** A site with its own `requireTyping` gets no extra cluster-label field.
- Registers a modal layer (see Keyboard layering).

## Keyboard layering (v1.2.1)

`src/utils/modalLayer.ts`: module-level registry. `useModalLayer(open)` registers a unique id with effect cleanup (survives StrictMode double mount; a counter would not). `isModalOpen()` reads it. `isEditableTarget(target)` is true for `input`, `textarea`, `select`, `contentEditable`, and anything inside `.xterm`.

- **Esc closes only the topmost layer.** A `ConfirmModal` never closes the panel under it.
- Esc inside `.xterm`, or on an editable target, is ignored at app level.
- With an overlay open (context switcher, palette, creator, merge-from-file, Helm install), Esc closes it; otherwise Esc clears the selected pod/resource.
- **`⌘K`, `⌘N`, `r` are inert while a modal is open.** Single-letter shortcuts ignore editable targets.
- `⌘,` / `Ctrl+,` opens Settings (inert with a modal layer or overlay open). `⌘S` / `Ctrl+S` in the YAML and Helm values editors opens the review gate; it never saves directly. `⌘F` / `Ctrl+F` focuses the log Include field (inert with a modal open); in the YAML views it opens the YAML find instead (v2.3.1): `⌘F` on macOS and `Ctrl+F` elsewhere (`isMacUserAgent`), only while focus is inside the view (the `<YamlFind>` root's React `onKeyDown`, checked by DOM containment), inert while a modal layer is open, with no `window` or `document` listener and no layer of its own. Esc with the bar open closes the bar, calls `stopPropagation()` and stops there, so the detail panel stays open; Esc with the bar closed follows the layering above. The log viewers and a YAML view are never mounted together (the tab body is keyed by tab), so the two uses of the chord do not meet. See YAML find (v2.3.1). `⌥↓` / `⌥↑` step changed rows in `DiffRows`. `⌘N` is inert in read-only mode and announces why. In the log region, `f` toggles follow and `End` jumps to latest.
- **Every modal host registers a layer and acts on Esc only when topmost:** `ConfirmModal` (so `NodeDrainDialog`, the bulk dialog, `YamlSaveGate`, `HelmUpgradeGate`), `ResourceEditor`, `ResourceCreator`, `HelmInstallModal`, `MergeFromFileModal`, `ObservabilityDialog`, `Popover`.
- `ContextSwitcher` and `CommandPalette` do **not** register, which is why `⌘,` also checks `overlayOpen`.
- **Graph canvas keys (v2.2.0)** belong to a focused node button (`GraphCanvas.onNodeKey`): arrows, `Home`/`End`, `Enter` (Open), `Space` (grow/shrink the details strip), and `+` `=` `-` `0` (zoom, fit). They are inert anywhere else, so the single-letter shortcuts are unchanged. The canvas registers no modal layer and handles no `Esc`; `Esc` follows the layering above. `Enter` on a collapsed pod group moves focus to its first member's Open button instead of opening it. The Timeline list (`TimelineTab.tsx`) has its own roving keys on a focused row: `↑`/`↓`, `Home`/`End`, `→`/`←` (open/close details), `Space` (toggle details), `Enter` (jump to the source tab).
- **`Popover.tsx`** (read-only badge, log Filters / Pods / Download) is not modal but registers a layer, so it must close itself or Esc, `r` and `⌘K` stay stranded. It closes on Esc (when topmost; focus returns to trigger), outside pointerdown, and focus leaving the panel.

## YAML find (v2.3.1)

Find in the YAML views with `⌘F` / `Ctrl+F` while focus is inside the view. Frontend only (no Tauri command). Contract: `docs/impl/v2.3.1-tasks.md` §3.3 and §3.3.1; UX: `docs/ux/22-v2.3.1-search-and-filter.md` §4 as amended by the plan's §2.2 (C-1 to C-12).

- **Three surfaces, one component.** The generic YAML tab and the Helm Values tab (`ResourceDetailPanel.tsx`) and the Pod YAML tab (`DetailPanel.tsx`) each render one `<YamlFind>` (`components/YamlFind.tsx`; render-prop `children({ findButton, bar, content })`, so each caller keeps its own toolbar layout). Its `edit` prop switches between the read view and the editor, so the bar survives the switch. Not covered: the Create, Merge-from-file and Helm-install textareas (user, Q7), the diff previews, and ArgoCD Applications (they have no YAML tab).
- **Pure helpers** in `utils/yamlFind.ts`: `yamlMatches`, `yamlSegments`, `firstAtOrAfter`, `lineOf`, `findCountText`, `findStatusText`, `shortcutMatches`, `prefillFrom`, `scrollTopFor`, `FIND_CAP`, `MIRROR_TAIL`; and `utils/platform.ts` `isMacUserAgent`, the one macOS test in the app (`updateMode` calls it too).
- **Matching reuses the log viewers' literal matcher** (C-1): `compileMatcher(query, false, false)`, `findRanges` and `markSegments` from `logFilter.ts`, stepping with `stepIndex` from `segmented.ts`. Literal, case-insensitive, non-overlapping; a blank query has no matches. At most `FIND_CAP` = 1000 matches are marked and stepped ("1 of 1000+"). Marks use the `log-match` (other matches) and `log-highlight` (current match) roles, so those roles now serve the YAML find as well; never put a `/N` modifier on them (G4).
- **Bar.** `role="search"`, sticky; the count ("3 of 12", "No matches") sits inside the input; Enter / Shift+Enter step (also the two buttons); `Cmd/Ctrl+F` again from anywhere in the view puts focus back in the input; there is no Cmd/Ctrl+G (C-3, confirmed by the user). The input is prefilled from a one-line selection of 1 to 120 characters. "Line n" shows in the edit view only. One `role="status"` live region announces counts (debounced 500 ms) and steps.
- **Read view.** The `<pre>` is `tabIndex={0}`, `role="region"` and named ("Deployment api YAML", "Pod api-7d9 YAML", "my-release values"), so it can be reached and scrolled from the keyboard. Matches are real `<mark>` elements. No find button and no shortcut while the shown text is blank (C-8).
- **Secret rules S1 to S4** (see `writes.md` → Secret values in the webview): S1 the find reads only its `text` prop, the string the view renders (`shownYaml`, the edit buffer, or the shown Helm text), never a query cache or another variant. S2 its state lives in the component and the caller keys it on identity (generic: `idKey`; Values: `${idKey}\u0000${helmRevealedNow}`; Pod: context, namespace and name), so Hide, a selection change and a panel close unmount it; a Secret's YAML view does not exist before Reveal. S3 the query is never persisted, sent or logged (no `localStorage`, `invoke` or `useQuery` in `YamlFind.tsx` or `yamlFind.ts`). S4 the live region and every `title` carry counts and positions, never the query.
- **Neat YAML.** The find searches the text on screen. With Neat on, a query with no match, and hidden fields, the hint line offers "Search full object", which calls the same `toggleNeat` as the Neat chip, so Neat stays off and is remembered (C-7). The first neat load of an object shows the skeleton, which unmounts the view and resets the bar (C-6).
- **Helm Values.** The redacted view searches the redacted string, so a redacted value cannot be matched or counted; the no-match hint says values under credential-looking keys are redacted (not shown in the edit view, whose buffer is the user's own text).
- **Edit view: highlight overlay** (`Mirror`, in `YamlFind.tsx`; C-12). An `aria-hidden`, `select-none`, `pointer-events-none` copy of the buffer sits **behind** a textarea with a transparent background (not a transparent-text textarea on top of a coloured copy), its text transparent and the matches drawn as coloured backgrounds. If it ever drifts, only a mark background sits off its word; the text, caret and selection stay the textarea's own.
  - **One metrics constant.** `EDITOR_TEXT` (`mono text-[11px] leading-[1.6] p-3 whitespace-pre-wrap wrap-break-word [tab-size:8]`) is used by the textarea and the mirror, and nothing else on either may set font, size, line height, padding, white space, wrapping or tab size. `wrap-break-word` is Tailwind 4's name for `overflow-wrap: break-word`. `MIRROR_TAIL` (a zero-width space) is appended so a trailing newline gives the mirror the same last line as the textarea.
  - The mirror is mounted only while the edit bar is open and the query has a match, sized from the textarea's `clientWidth` and `clientHeight` through a `ResizeObserver` (disconnected on close), scrolled in step with the textarea (`onScroll` plus a layout effect), and rendered from deferred values so typing stays at the textarea's speed. Stepping reveals the current match from its mark's `offsetTop` (`scrollTopFor`) and **never calls `scrollIntoView` on a mirror mark**. Stepping does not move the textarea selection; closing the bar makes the current match the selection.
  - Approved fallback if a webview misaligns the mirror: swap `whitespace-pre-wrap wrap-break-word` for `whitespace-pre` in `EDITOR_TEXT` and give the textarea `wrap="off"`; nothing else changes. `ponytail:` the mirror holds a second, transparent copy of the whole buffer with no virtualisation (`open-items.md`).

## Observability dialog and history controls (v2.3.0)

Contracts for the backend side are in `pods-logs.md` (External observability).

- **`ObservabilityDialog.tsx`** is mounted once by `ObservabilityDialogHost` in `App.tsx`; callers open it with `requestObservabilityDialog(context)` (module-level pub/sub in `utils/observability.ts`, like `clusterIdentity`'s notify), so no prop is threaded. It registers a modal layer; Esc closes only when topmost, and with unsaved changes Cancel or Esc opens a stacked `ConfirmModal` ("Discard changes?", Keep editing / Discard; Ctrl/Cmd+Enter is Discard and a backdrop click is Keep editing, the `ConfirmModal` conventions; it gets no `context`, so read-only and typed-label guardrails never apply). Initial focus is Find services; on close, focus returns to the opener. Two groups, Metrics (Prometheus) and Logs (Loki or VictoriaLogs), each with its own Test. A half-filled or invalid group is never saved (`draftErrors`); clearing both deletes the key. A Test result belongs to the target it tested (`probeKey`): any edit, Use or backend switch hides it.
- **Discovery** shows 8 rows (`SHOWN_ROWS`) with "Show {n} more"; "Search all namespaces" is the second button; a `skipped` list becomes the "may be incomplete" line (`skippedLine`).
- **⌘K entry:** "Observability: configure for {cluster}" (section App), present only with an active context (`App.tsx`). Other openers: Cluster switcher → Configure…, the pod Metrics tab (no target), the log viewer (no logs target).
- **`Segmented` `disabledReason`** (`HealthShell.tsx`): an option tuple's optional third element disables it with a reason (`disabledAttrs`, an `aria-describedby` span). Arrow keys move one step from the focused option, may land on a disabled one (focus only), and never pick it. The pod Metrics tab, and NodeStrip when every displayed node fails, use it to disable 1 h to 7 d with "History needs Prometheus, which isn't reachable right now." while the checked option reads Now. In both failed states choosing Now is a no-op (`onChange` returns early), so the remembered range survives and the view recovers on its own.
- **`PartialStrip` `toggleLabel` / `actions`** (`HealthShell.tsx`): `toggleLabel` renames the disclosure button (default "Show which"; the metrics fallback strip says "Why?"), `actions` renders buttons before it (Retry). After a successful Retry the strip unmounts and focus moves to the checked range radio.
- **Focus return.** On close the dialog refocuses the opener unless it is `<body>` (the palette case), then falls back in order to the checked range radio, `[data-panel-heading]`, then `<main>` (`tabIndex={-1}` in `App.tsx`). Keep editing (or Esc in the confirm) closes only the confirm; `ConfirmModal` returns focus to the element focused before it opened. Discard closes both layers and focus follows the chain above.
- **Range controls:** the pod Metrics tab stores the range in `localStorage["metrics-range"]` (default 1 h); the NodeStrip range is not persisted and defaults to Now (no Prometheus call until a range is chosen).

## Cluster-wide Search (v0.8.0)

`search_resources(context, query)` (`search.rs`) queries 10 types in parallel (`join_all`), filters by name prefix, returns ≤ 50 `SearchResult { kind, name, namespace, resource_type }`. Min 2 chars. Hook `useSearchResources(context, query, enabled)`, staleTime 10 s.

## Conditions Table Fix (v0.9.0)

Summary-tab Conditions table: `table-fixed`, card `overflow-hidden`, widths 28/14/22/36 % (Type/Status/Reason/Message), `truncate` + `title` on Type and Reason, `break-words` on Message. No horizontal scroll.

## Cluster Identity (v1.2.0)

Prod-accident guard, zero Rust. `src/utils/clusterIdentity.ts`: `localStorage["cluster-identity"]` = `Record<contextName, { color, label, readOnly?, typedConfirm?, bulkLimit? }>`; `useClusterIdentity(context)`. `label` defaults to the context name (read with `??`, so a cleared `""` label stays cleared).

**Identity colours (v1.4.2)** are their own role set, `identity-blue|green|yellow|orange|red|purple` (`--c-identity-*` in `src/index.css`, same-named Tailwind keys). They **never follow the accent**: no `identity-*` value references `--c-accent`, and the accent blocks set only `--c-accent` / `--c-on-accent` (both are tests; see Appearance). Choosing the teal accent leaves every cluster chip as it was.
- `color` is an `IdentityRole`, mapped to literal class strings in `CLUSTER_COLOR_CLASSES` (literal so Tailwind's scan finds them). Never invent a palette.
- **Legacy stored names** (`accent`, `ok`, `warn`, `orange`, `bad`, `purple`, written by v1.3.1 to v1.4.1) are read through `LEGACY_IDENTITY_ALIAS` in `readIdentityColor(stored, context)`. **No migration**: the stored record is never rewritten on read. An unknown value falls back to the hash default of the context.
- **Do not simplify this back: `IDENTITY_ROLES` order is load-bearing.** It equals the legacy order (`accent, ok, warn, orange, bad, purple`) because `defaultColorFor` hashes into it. Reordering recolours every context that has no stored colour. `clusterIdentity.test.ts` pins the order index for index and a fixed context's default.
- **Do not simplify this back: `setClusterIdentity` writes `color` only when `patch.color` is set.** A guardrail toggle (read-only, typed confirm, bulk limit) must leave a stored `"accent"` byte-identical. Writing the normalised `"identity-blue"` would make v1.4.1 (whose reader rejects role names) recolour the cluster to its hash default after a downgrade. An explicit pick writes the role name, so a downgrade after a pick still loses that colour (accepted).
- The swatches in `ContextSwitcher` are colour-only buttons, so each is named through `IDENTITY_ROLE_LABELS` (Blue, Green, Yellow, Orange, Red, Purple) as `aria-label` and `title`. A new role needs a label.

Surfaces: Sidebar chip, TopBar left rule, `ContextSwitcher` swatches + editor, every `ConfirmModal` (`contextLabel` / `contextColor`). Bespoke write dialogs reuse `ClusterBadge` (exported from `ConfirmModal.tsx`).

## Read-only mode and guardrails (v1.3.1)

Per cluster, in the `cluster-identity` record: `readOnly`, `typedConfirm`, `bulkLimit` (`number | null`, 1-500). All default off, except the one-time upgrade seed (RB-3b). Edited in `ContextSwitcher`'s Guardrails group. Logic in `src/utils/guardrails.ts`.

- **A hint, not a security boundary.** It governs Garita's buttons only, not kubectl or other tools. Copy never says "protected", "secured" or "locked".
- `setClusterIdentity` spreads the stored entry before patching, so unknown fields survive. A corrupt store reads as **everything off** and the editor shows `CORRUPT_STORE_NOTE`; "never written" and "corrupt" are different states.
- **Backstop:** every cluster write goes through `invokeWrite()` in `useResources.ts`, which calls `assertWritable(context)` and rejects with the refusal text (an `Error`). The command name appears only as `invokeWrite`'s first argument. **`src/hooks/writeBackstop.test.ts` fails on a raw `invoke()` of a write-verb command.** Dry runs are guarded too (their dialogs cannot open in read-only). Bulk hooks check once.
  - **Exempt:** `preview_*` and `can_i` (reads); kubeconfig registry and `set_log_level` (app-local, needed to turn read-only off); port-forward start/stop; `write_to_shell`, `resize_shell`, `stop_shell_session` (act on an open session). `startShellSession` guards itself.
- **Shells are blocked in read-only** (user decision): Shell tab, "Exec shell", "Debug container…" disabled with the read-only reason; badge popover says "Pod shells are blocked." Port-forward unaffected. One constant: `READ_ONLY_BLOCKS_SHELL = true`. Turning read-only on ends every open shell/attach session for that cluster (the tab unmounts `ShellTerminal`; "Shell closed: read-only mode was turned on…" shows only if one was open). A debug container keeps running.
- **DISABLE-PRECEDENCE** (`pickDisabledReason`): one reason, in order read-only, RBAC (explicit deny only; fail open), missing capability, finished pod. "In progress" keeps the control's spinner. Disabled controls stay focusable with `aria-disabled` + reason (`disabledAttrs`); the click handler must still bail out.
- **Surfaces:** TopBar badge (popover + "Turn off…"), Sidebar chip, ContextSwitcher rows, panel headers (`ReadOnlyChip`), `ReadOnlyStrip` above `GenericResourceTable` / `PodTable`, `⌘N` inert with an announcement, palette on (immediate) / off (always a confirm, never typed, `ignoreGuardrails`: a typed escape hatch is a trap in an incident).
- **G1, typed confirm** of the cluster label in every write dialog (max one typed field). `ConfirmModal` applies it via `context`; `ResourceEditor`, `ResourceCreator`, `HelmInstallModal`, `MergeFromFileModal` use `GuardrailGate`. Dry runs are not gated.
- **G2, bulk limit** (`checkBulk`): PodTable bulk, ArgoCD bulk, Merge-from-file document count, drain force-delete selection. Over the limit the confirm is disabled with the refusal text.
- `useGuardedAction` adds the `sm` confirm to the single-click writes above only while `typedConfirm` is on.

## Settings view (v1.3.1)

App state, not a `ResourceType`: a value of `mainView` (the `MainView` union in `utils/resourceQueryKey.ts`, see App views) in `App.tsx`.
- Every navigation goes through the `setActiveResource` wrapper, which returns to `"resources"`, so any Sidebar resource, "view all", panel `onNavigate` or palette pick leaves Settings. **Esc does not leave Settings.**
- Entry points: the Sidebar gear, `⌘,` / `Ctrl+,` (checks `overlayOpen`), and the palette entries "Settings" / "Settings: Appearance" / "Settings: Diagnostics" / "Settings: Updates" / "Settings: Command line". The section entries set `settingsSection` and open Settings; they do not move focus.
- Below 720 px the section list is a select.
- Sections that have not shipped are absent, not disabled. The sections are Diagnostics (`diagnostics.md`), Appearance (v1.4.2, below), Updates (v2.1.0, below) and Command line (v2.1.3). The body renders by `section`.
- **Command line** (`CommandLine` in `SettingsView.tsx`; model `utils/cliStatus.ts`): status from `get_cli_status`, always printing `resolved_path`, never a fixed path. On macOS an Install/Reinstall button calls `install_cli_command` (raw `invoke`, EXEMPT in `writeBackstop.test.ts`: a local symlink, works read-only); an `Ok` with `on_path=false` and `resolved_path` null or `/usr/local/bin/garita` shows the `manual_command` in a `CopyLine`, any other `resolved_path` is a shadowing `garita` and reads as stale. An `Err` string shows as `role="alert"`. No `--help` preview: two muted "Try it" lines built from `CLI_COMMAND_NAME`.
- **`LaunchNoticeStrip`** (`App.tsx`): the one inline strip for command-line arguments (no toast system). `startLaunchArgs` (`useResources.ts`) registers `listen("launch-args")` before the first `get_launch_args` pull and pulls on every event; a request that arrives before the context list and active context resolve is queued. Apply order is context, namespace, kind; a namespace for a context switch is applied after the context-change reset, only for that context. A forwarded request made while `isModalOpen() || overlayOpen` is held (raw args, re-planned on **Go now**); Go now is `aria-disabled` with the reason while a dialog is open, and a held request is dropped when the user switches context. The namespace check fails open (list error, forbidden or ~3 s timeout applies it as typed), and a newer request, or a dialog opening during that wait, supersedes or holds the older one (`launchSeq`).

## Appearance (v1.4.2)

Light and dark theme, six accents, Settings → Appearance. Frontend only: no Rust, no IPC. Dark theme with the blue accent is v1.4.1 pixel for pixel, apart from the accepted deltas in `open-items.md`.

**Tokens.** Every colour is a role-named CSS variable in `src/index.css`, mapped in `tailwind.config.js`. Components use Tailwind classes only. Tailwind 4 loads that JS config through `@config "../tailwind.config.js"` in `src/index.css`, after `@import "tailwindcss" source(none)`: `source(none)` turns off automatic scanning (it would read `docs/` and emit default-palette classes quoted there), so only the config's `content` globs are scanned. `corePlugins`, `safelist` and `separator` are unsupported in v4 and unused here. A `@layer base` block at the top of `index.css` restores three v3 preflight defaults (border colour `gray-200`, `cursor: pointer` on enabled buttons, placeholder colour `gray-400`, both themes, as in v3 and v1.4.1).
- **Space-separated RGB channels, not hex** (`--c-surface-panel: 18 21 29`), and the Tailwind value is `rgb(var(--c-x) / <alpha-value>)`. **Why:** opacity modifiers (`bg-accent/20`, `ring-ok/30`, `border-edge/60`) must keep working. A hex variable cannot take a modifier. Do not convert a variable to hex.
- **Alpha-baked roles** (`edge`, `edge-strong`, `log-match`, `log-highlight`) carry a default alpha, so they use `rgb(var(--c-x) / var(--a-x))` and the channel triple has a companion `--a-<role>`. The plain form would make an unmodified `ring-edge` opaque. On Tailwind 4 a modifier on a baked key would multiply the baked alpha (`border-edge/60` = 6 % x 60 %), so a modifier use is written on **`edge-raw`**, the same channel with no baked alpha and the `<alpha-value>` form (the one allow-listed exception in the `themeTokens` form test): `border-edge-raw/60` is 60 % of the channel colour in both themes, so light mode tunes modifier sites only through the channel. Plain `border-edge`/`ring-edge` keeps the baked alpha. Never write `edge/N`, `edge-strong/N`, `edge2/N`, `log-match/N` or `log-highlight/N` (G4 and a `themeTokens` test fail it). Variables with no Tailwind key follow the same pair: `--c-hairline`/`--a-hairline`, `--a-scrollbar`/`--a-scrollbar-hover`, `--c-term-selection`/`--a-term-selection`. A role that gains a default alpha needs both the config form and the `--a-` variable; `themeTokens.test.ts` checks that every config key takes the form its variables imply.
- **Surfaces and tints:** `surface-base|panel|card|overlay|input|sunken`, `surface-tint` and `scrim` for translucent overlays. `surface-tint` is white in dark and the ink channel in light, so `bg-surface-tint/[0.04]` is a faint lift in both. Legacy names (`base`, `panel`, `card`, `edge2`, `ok`, `warn`, `bad`, `info`, `orange`, `purple`) alias their role.
- **Dark values sit on `:root`** (also the fallback when no attribute is set); light values on `:root[data-theme="light"]`. Every variable on `:root` must exist in the light block (tested).
- `dim` fails WCAG AA as text in both themes; use `mute`.
- **Webview floor (Tailwind 4).** The CSS uses cascade layers (Safari 15.4, Chromium 99) and `color-mix()` for every opacity modifier (Safari 16.2, Chromium 111). A webview without `color-mix()` paints modifier tints as solid fills; one without layers shows the app unstyled. The README states the floor; no in-app check exists.

**Attributes.** `<html data-theme="light|dark" data-accent="blue|teal|violet|amber|rose|slate">`, always the resolved theme (never `system`). No Tailwind `darkMode` line and no `dark:` variants: a component never branches on the theme. There is no `color-scheme` property: setting it would restyle native controls in dark mode (a parity break).

**Accent blocks are theme-scoped and exclusive.**
- Dark: `:root:not([data-theme="light"])[data-accent="<name>"]`. Light: `:root[data-theme="light"][data-accent="<name>"]`. Blue lives in the theme blocks. Never write a bare `:root[data-accent=…]`: it ties with the light block on specificity and would leak dark values into light.
- A block sets only `--c-accent`, plus `--c-on-accent` on the dark blocks of the five non-blue accents. Nothing else may change with the accent (tested), which is what keeps identity, status, metric and series colours fixed.
- **`on-accent`** is the label colour on `bg-accent` (and on the `bg-bad/80` count badge). It is white in light and in dark blue (v1.4.1 parity; known contrast issue, `open-items.md`). White fails on the five non-blue dark accents, so those blocks set it to `11 13 18`. The badge label therefore follows the accent: accepted, both labels pass.
- **`--c-swatch-*` / `swatch-*` are picker-only.** They duplicate each accent's own value (per theme) so the Appearance swatches show every accent at once while one is active. A test pins each equal to that accent's `--c-accent`. Components never use them for anything else; use `accent`.

**What never reads the accent.** `status-*` (including `status-progress`, the fixed `#4ea1ff` for Progressing pills and "Pods running"), `metric-cpu` / `metric-mem`, `bar-low|mid|high`, `log-*`, `identity-*`, `series-*` and the terminal ANSI colours. A CPU bar or a Progressing pill written as `text-accent` passes the dark-parity check and breaks under the teal accent; use the role. `grep -rnE 'Progressing.*accent|accent.*Progressing' src --include=*.tsx` returns nothing. Everything else (primary buttons, links, selected tabs, toggles, focus rings, row hover and selection, drain progress fill, the terminal cursor, the left `.grain` glow) follows the accent.

**Preference and first paint.**
- `localStorage["appearance"]` = `{ theme: "system"|"light"|"dark", accent }`, per viewer, in try/catch. `parseAppearance` falls back **per field**: a corrupt record or one unknown value does not reset the other field. A failed write keeps the choice for the session (`saveFailed`, shown in Settings).
- `src/utils/appearance.ts` owns it. `main.tsx` calls `initAppearance()` once. While the theme is `system` it follows the OS live through `matchMedia("(prefers-color-scheme: dark)")`. A missing or throwing `matchMedia` reads as dark.
- **Do not simplify this back: `useAppearance` is a `useSyncExternalStore` over one cached snapshot object**, replaced only when a field changes. `getSnapshot` returning a fresh object per call re-renders forever. `commit` writes the DOM attributes **before** notifying listeners, because the terminal reads computed CSS variables in its listener.
- **`app.html` (the app entry; the root `index.html` is the landing page) has an inline `<script>` that sets `data-theme` / `data-accent` before React mounts**, so a light launch has no dark flash. It repeats the storage key, the allowed values and the resolve rule (system → `matchMedia`, unreadable → dark) from `appearance.ts`. **Keep the two in step**: a new accent or theme value goes in both. `html, body` take `surface-base` from `index.css`, which the production build links in `<head>`. Dev mode flashes regardless (Vite injects CSS from JS); judge first paint on a bundle. The page has no CSP; if one is ever set, the script needs its hash.
- **The native window is not themed.** No `backgroundColor` in `tauri.conf.json`, no `core:window:allow-set-background-color` or `allow-set-theme` in the capability file. macOS paints the webview under the overlay title bar; Windows and Linux decorations follow the OS, so a forced theme that differs from the OS gives mismatched decorations (accepted).

**Terminal.** `utils/terminalTheme.ts` builds the xterm theme from the `--c-*` variables: `XTERM_ROLES` maps every xterm colour key to a role (`background` is `surface-sunken`, `cursor` is `accent`, the rest `term-*`), plus `selectionBackground` from `term-selection`. A variable that cannot be read falls back to the dark literal beside it. `terminalContrast` is 4.5 in light and 1 (xterm's default) in dark.
- **Do not simplify this back: `ShellTerminal` has two effects.** The session effect (keyed on pod, container, context, mode) creates the terminal from `terminalTheme()` and must **not** depend on the theme or accent, or a theme change restarts the shell. A separate effect keyed on `resolved` and `accent` assigns `terminal.options.theme = terminalTheme()` (a **fresh object**: xterm 6 ignores in-place mutation) and `minimumContrastRatio` through a ref. The accent is a dependency because the cursor follows it. The session effect reads the theme only through `resolvedRef`.
- ANSI colours do not follow the accent.

**Hard-coded colours: a checkable property.** After v1.4.2, no component contains a colour literal. Run these plainly (not through `rtk proxy`):
```
# G1: only src/utils/terminalTheme.ts (the allow-list)
grep -rnE '#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\(' src --include=*.ts --include=*.tsx --exclude=*.test.ts
# G2: none (Tailwind default-palette classes ignore the theme; `accent` covers the native checkbox/radio tint, which is `accent-accent`)
P='(bg|text|ring|ring-offset|border|divide|outline|fill|stroke|from|via|to|shadow|placeholder|caret|decoration|accent)'
grep -rnE "\b$P-(white|black)\b|\b$P-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]" src --include=*.ts --include=*.tsx --exclude=*.test.ts
# G3: none (index.css and tailwind.config.js hold channel triples only)
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\([0-9 .,]+\)' src/index.css tailwind.config.js
# G4: none (a modifier on a baked-alpha key multiplies under Tailwind 4; use edge-raw)
grep -rnE --include=*.tsx -e '-(edge|edge-strong|edge2|log-match|log-highlight)/' src
```
- A `rgb(var(--c-…))` string in a `.tsx` file trips G1 on purpose. A colour prop is a **literal class-string prop** (Sparkline takes `text-*` and strokes `currentColor`; the `Bar` components, `MetricCard`, NodeStrip, the HPA bars and the status-dot maps pass class strings), so Tailwind's content scan finds it.
- **Tailwind scans `*.test.ts` too** (`content` is `./src/**/*.{ts,tsx}`). A class-like string in a test, even in a comment (`bg-white/10`), emits CSS. G1 and G2 exclude tests, so keep such strings out of them.
- Comments in `index.css` and `tailwind.config.js` must not quote old hex values (G3 strips comments in its test, the grep does not).

**Tests.** `themeTokens` (dark values equal v1.4.1 by a frozen table; accepted deltas; totality; alpha form; status/metric/bar/log/identity/series keys never read the accent), `clusterIdentity`, `appearance`, `terminalTheme` (all xterm keys in both themes, light totality, accent-block isolation). They read `src/index.css` and `tailwind.config.js` as text, so a new variable or accent must keep them green.

## Updates (v2.1.0)

Settings → Updates, the Sidebar notice and the palette entry "Settings: Updates". Copy and states: `docs/ux/05-theme-settings-platform.md` §9. Rust side and frozen calls: `docs/impl/v2.1.0-tasks.md` §2.

- **State.** `utils/updateState.ts` is the pure model: `UpdateState`, a `reduce(state, event)` reducer, `updateMode`, `noticeLabel`, `parsePrefs`, formatters (`updateState.test.ts`). `useAppUpdate()` in `useResources.ts` owns a module-level store (`useSyncExternalStore`, like `appearance.ts`), so the Sidebar still sees the update after Settings unmounts. It also holds the `Update` from `check()` between download and restart (`install()` uses the bytes `download()` stored); a superseded one is `close()`d.
- **Plugin calls.** `check`, `Update.download`, `Update.install`, `relaunch` and `invoke("open_release_page")` appear only in `useResources.ts`. **Never `downloadAndInstall()`**: its permission is not granted (`git grep downloadAndInstall src` must be empty).
- **Platform.** `updateMode(userAgent, import.meta.env.DEV)`: dev builds are `unavailable` (state `{s:"unavailable"}`: the section renders, Check and the switch are `aria-disabled` with the reason, no timer); macOS (`Macintosh`/`Mac OS X`) is `app` (`inAppInstall`: download in the app, confirm, `install()` then `relaunch()`); everything else (Linux `.deb`/`.rpm`, Windows) is `notice`. The capabilities for download, install and restart are macOS-only, so `runUpdateDownload` and `runUpdateRestart` return early unless the mode is `app`; the Linux and Windows UI offer only **Download**, which calls `open_release_page`. The UI hiding the buttons is not the guard.
- **Failures.** Automatic check (first one 8 s after launch, then every 24 h, one timer for the whole app, `autoCheck` read at tick time): a failure restores the previous state and shows nothing; it never writes the live region. A manual failure shows the `failed`/`check` line unless an update is already pending (kept). Download and install failures keep the version and the Sidebar notice; Try again downloads again. No modal, no toast.
- **Preferences.** `localStorage["updates"]` = `{ autoCheck, dismissed }` (default on, `parsePrefs` per field, try/catch). A failed write keeps the choice for the session and shows "Couldn't save this choice."
- **Sidebar notice.** Its own row under the title row (the title row is the drag region; the control must not sit in it). Neutral text, no badge or pulse. ✕ stores the dismissed **version**; `ready` is never dismissible. It opens Updates through `openUpdates` in `App.tsx`, which bumps `focusUpdates`; `Updates` then focuses `[data-update-primary]` (the primary action, else Check for updates). Opening from the palette does not start a check.
- **A11y.** The status line is plain text; a separate `sr-only` `role="status"` receives text only from click handlers (`act()`). The restart confirm is an inline row (not `ConfirmModal`: it is not a cluster write): focus goes to Cancel, Esc closes only the row and returns focus to Restart to update. Progress is a `role="progressbar"` stepping `aria-valuenow` by 10.
- **Not a write.** No `invokeWrite`, not affected by read-only mode.

## Resource compare (v1.3.1)

`ResourceCompareDialog.tsx` + `utils/resourceCompare.ts`: compare an object with the same kind in another namespace or cluster, read via `get_resource_json` with that `context`.

- **Eligible:** every `SelectedResource` kind except `pods` (noise), `helm` (no object), `argo-appsets` / `argo-projects` (`gvk_for` cannot reach them), and views without a detail panel. `canCompare` uses a closed `EXCLUDED` set: a new kind is eligible unless added.
- Entry: panel header Compare button; palette "Compare … with…" while an eligible resource is selected (`compareNonce`).
- **A read:** `ignoreGuardrails`, never blocked by read-only, RBAC hints or typed confirm. Secret `data` masked.
- Closed ignore list: status, managed fields, uid, resourceVersion, generation, creation time, name, namespace. Only toggle: status. Same `KubeContext.server` on both sides: "You are comparing an object with itself". `classifyReadError` maps the other side's rejection to no access / not installed / not found / unreachable / error. Other name is free text.

## Field managers (v1.3.1)

`FieldManagers.tsx` + `utils/managedFields.ts` (`fieldsV1ToPaths`, `parseManagedFields`, `findFields`): Summary-tab section listing who last wrote each field, from `metadata.managedFields` via `get_resource_json`. Read-only; "Find a field" search; 50 paths per manager until "Show all". No server-side-apply vocabulary. Offered for compare-eligible kinds plus `pods`. **Not on ArgoCD Applications or Helm releases** (no Summary tab; Known Open Item). `ResourceEditor`'s managed-by banner links here (`onSeeFieldManagers`).

## Settings and the app log

See `diagnostics.md`.

## App views: Journal, Who can and the Health pages (v1.4.1)

- **`MainView`** (`utils/resourceQueryKey.ts`) = `"resources" | "settings" | "health" | "journal" | "whocan"`.
  - None is a `ResourceType`, so no per-kind table gains a row.
  - Entry points: Journal button beside Settings (Sidebar footer); "Who can…" under Access Control; the five Health items (Problems, Node capacity, Possibly unused, Deprecated APIs, Map); palette "Journal" (App) and "Who can…" (Access Control).
  - Leaving to any non-resource view clears the TopBar search (`if (mainView !== "resources") setSearch("")`).
- **TopBar rules.**
  - The breadcrumb reads "journal" / "who can" (or the Health page's own).
  - The namespace picker is hidden for Journal and Who can: `appView` forces `clusterScoped`, so the last resource cannot decide it.
  - Search placeholders: "Filter journal…" (filters loaded entries only), "Filter subjects…" (the search stays on Who can), or the Health page's own.
  - New and `⌘N` are inert off `"resources"`.
- **Mounting.** `JournalPage` mounts only while selected. `WhoCanPage` and the Health pages mount hidden, so the form and last result survive leaving; their queries run only while `visible`, on demand, with no interval.
- **Navigation.** Who can's Open uses the namespace-setting `openObject`, because the page is not scoped by the namespace picker. Health pages use `jumpFromHealth`.
- **`KIND_TO_RESOURCE_TYPE` / `RESOURCE_LABELS`** live in `utils/kindToResourceType.ts`, exported. They are used for journal kind labels, the ArgoCD resources tab and the TopBar breadcrumb.
- **Saved searches** (`SavedSearchMenu.tsx`, `utils/savedSearches.ts`, a bookmark button in the TopBar).
  - **Search text only**: no sort, namespace, status or label filters.
  - Stored in `localStorage["saved-searches"]` as `Record<viewKey, {name, text}[]>`, per viewer and never shared. The view key is the `ResourceType`, or `crd-instances:<crd name>`. No key (and no button) until a CRD is picked.
  - At most 20 per view, enforced on read and write. Saving an existing name replaces it; a 21st is refused with a reason.
  - Every storage touch is in try/catch. Unavailable storage disables Save with a reason. Corrupt JSON reads as empty.
  - The button renders only when `mainView === "resources"`.
  - Remove offers Undo while the menu is open.
  - The menu is a `Popover`; focus moves inside on open.
- **Permissions section** (`PermissionsSection.tsx`) on the Summary tab of ServiceAccount, Role, ClusterRole, RoleBinding and ClusterRoleBinding panels. It is read only, on demand, labelled "Hint", and its only action is Open. "Bound to" comes from `boundTo`; the semantics are in `cluster-access.md`.
