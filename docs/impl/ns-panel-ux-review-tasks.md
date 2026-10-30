# Namespaces page, namespace picker, and the Pod / ArgoCD panel fixes: contract and tasks

Run: `feat/ns-panel-ux-review`, base main `4e11176`. Ledger: `.claude/checkpoints/feat-ns-panel-ux-review/ledger.md`. Re-planned by T5 (tech-lead) on 2026-10-28. This file replaces T1's plan (commit `ce655a1`; its §1 assumed no Rust change and no Namespaces page, both void now). Line numbers in `docs/ux/24-pod-argocd-review-and-ns-panel.md` are at the base commit and drift after every wave: grep the names, not the numbers.

Binding inputs, in this order when they disagree:

1. The ledger's "User decisions" (2026-10-28): Q-place "Both", Q1 two batches, Q2 real `service_account` and `conditions` now, Q6 merge Pod Overview into Summary, Q7 remove the diff expander, Q8 later, Q9 Force confirms, Q13 floor 10.5 px, Q16 one rows command and one query, Q17 conditions and finalizers, Q21 403 card for all core lists, the rest option A; palette create "no"; forbidden list "return forbidden"; protect `kube-node-lease` now.
2. This file (§2 and §3 are the frozen contract).
3. `docs/ux/24-pod-argocd-review-and-ns-panel.md`: Part A findings are the exact fixes (class strings, copy); Part B is the namespaces UX. A finding's "Fix" text is what a task implements unless this file says otherwise.

## Contents

0. Summary: minimal version, what it skips
1. Decisions taken in this re-plan
2. Contract A: Namespaces (frozen)
3. Contract B: Pod `service_account` and `conditions` (frozen)
4. Hard-rule check
5. Waves, file ownership, collisions
6. Task briefs (R1, F1, W1R, F2, W2R, R2, F3, W3R, F4, W4R; fix batches)
7. Deferred and skipped
8. Questions for the user
9. Observed, out of scope

---

## 0. Summary

Minimal version:

- **Namespaces** becomes a cluster-scoped resource kind `ns` with a page (table, standard detail panel, create through the existing TopBar New / `⌘N` namespace form, typed delete moved verbatim from the Sidebar). The TopBar namespace dropdown becomes a `Popover` picker with a filter, a muted `Terminating` tag and a "Manage namespaces" link. The Sidebar namespace list goes; "Namespaces" is the first row of the Sidebar "Cluster" section.
- **Rust:** one new read command `list_namespace_rows` returning `NamespaceRow`; the `ns` arms in `get_resource_yaml` / `apply_resource_yaml`, `gvk_for` and `get_resource_metadata`; `Pod` gains `service_account` and `conditions`; `delete_namespace` sends Background through `delete_params_for`. No new parameter on any command.
- **One query** for every namespace consumer: key `["namespaces", ctx]`, data `NamespaceRow[]`.
- **Pod and ArgoCD:** B1 = the five Critical findings plus POD-3, POD-5, POD-12, ARGO-2, ARGO-4, ARGO-5; B2 = the rest of "Implement now" with the user's answers, split into a Pod half (F3) and an ArgoCD and shared half (F4) because both halves edit `ui.md` and `CHANGELOG.md`.

Skipped (each is a later request): arrow-key navigation in the picker and tables; per-namespace counts, quota, a "deleting since" column, bulk delete, a guided label editor (labels are edited in YAML), a row "Show pods" action (Q24); a namespace edit form; the Timeline tab for namespaces; `KIND_TO_RESOURCE_TYPE` / journal alias for `Namespace` (ArgoCD Resources rows of kind Namespace stay non-clickable; journal shows "namespace" verbatim); `metadata.finalizers` of the Namespace object (only `spec.finalizers`, per Q17); a palette "Create namespace…" (user: no); a typed-name fallback when the list is forbidden (user: no); ARGO-8 (Q8, later Rust run).

---

## 1. Decisions taken in this re-plan

| # | Decision | Why |
|---|---|---|
| D1 | `NamespaceRow` carries `age` (formatted, like every other row struct), not a raw `created` time. | The Age column and its `parseAge` sort read a formatted age everywhere; nothing reads the raw time. UX 4.2 asked for "created time (for Age)". |
| D2 | `delete_namespace` moves to `delete_params_for(None)` (Background) in R1. `delete_pod`, `delete_node` and `delete_argocd_app` stay the documented exceptions. | The hard rule says deletes send an explicit policy; kubectl sends Background for a namespace; the namespace controller removes the contents either way, so the effect is unchanged. `writes.md` changes in the same task. |
| D3 | Namespace delete keeps `delete_namespace` (no `delete_resource` arm for `ns`). One `DeleteNamespaceConfirm` instance is hosted in `App.tsx`; the page's row trash and the panel's header trash request it. | UX 4.2 and 4.4.7: the Sidebar dialog moves verbatim (title, "and everything in it", typed name, journal verb). One host owns the `onDeleted` reset of the picker. |
| D4 | R1 keeps `list_namespaces`; R2 removes it after F2 has switched both TS callers. | No commit on the branch leaves the app calling a missing command. |
| D5 | The page polls 5 s while any row is Terminating, else 30 s (the `usePVs` interval). Only the page polls; the picker, App and the forms read the same query with `staleTime` 60 s and no interval. | UX 4.4.7 ("poll faster while any row is Terminating"); an always-mounted App observer must not start app-wide polling. |
| D6 | Pod conditions render with the existing Summary Conditions table (Type, Status, Reason, Message; `ui.md` → Conditions Table Fix), extracted to `ConditionsTable.tsx` in F3. Hidden when the list is empty, as for workloads. | T2 specified no real-condition layout (its recommendation was Q2 option A); reuse instead of a new design. |
| D7 | Q6 merged tab is named **Summary** and is the first and default Pod tab. Order inside: Explain card (when present), Metadata (real Service account), Conditions, Container States, Labels (neutral chips), Constraints, Who can reach, Field managers. Summary's old Status card and accent Labels card are deleted (POD-11). | Ledger: "merge Pod Overview into Summary". |
| D8 | Q21's 403 card is built in F2 (the Namespaces page needs it); it applies to every core list in `GenericResourceTable`. | One change, needed first by the page. |
| D9 | `GenericResourceTable` gains a per-row `deleteReason` and a per-row `deleteLabel`; any row with a reason (read-only included) renders the trash present, focusable and dimmed. The `PVView` pattern of hiding the trash on an RBAC denial is not copied. | Hard rule: denied means disabled with a reason, not hidden. |
| D10 | X-1's name-cell button in `GenericResourceTable` applies to every table. F1 audits first columns before the change and stops (Status blocked) if any first cell holds a button or link. | A button may not contain a button or link (UX X-1 audit). |
| D11 | The X-3 fix for the Pod row menu (replace it with a named delete button, from X-4) ships in F1; the other X-4 menus ship in F3 / F4. | That control has no accessible name until replaced; the replacement is the exact fix T2 named. |

---

## 2. Contract A: Namespaces (frozen)

### 2.1 Rust (`src-tauri/src/commands/namespaces.rs`)

```rust
use std::collections::BTreeMap;
use super::extras::ResourceCondition; // existing struct, unchanged

/// One namespace for the Namespaces page, the picker and every names consumer.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NamespaceRow {
    pub name: String,                       // metadata.name (unwrap_or_default)
    pub phase: String,                      // status.phase verbatim ("Active" | "Terminating"); "" when absent
    pub age: String,                        // age_from_timestamp(metadata.creationTimestamp); "—" when absent
    pub labels: BTreeMap<String, String>,   // metadata.labels, sorted by key (stable chip order); {} when absent
    pub deletion_timestamp: Option<String>, // metadata.deletionTimestamp, RFC 3339; None when not being deleted
    pub conditions: Vec<ResourceCondition>, // status.conditions in API order; [] when absent
    pub finalizers: Vec<String>,            // spec.finalizers in API order; [] when absent
}

/// Pure, tested. No unwrap / expect / indexing (panic = "abort").
pub(crate) fn namespace_row(ns: Namespace) -> NamespaceRow;

#[tauri::command]
pub async fn list_namespace_rows(context: String) -> Result<Vec<NamespaceRow>, String>;
// Api::all, ListParams::default(). Errors keep today's strings:
// "Failed to connect: {e}" and "Failed to list namespaces: {e}" (the kube 403 text contains
// "forbidden", which classifyReadError and isForbidden rely on).
```

`ResourceCondition` mapping (the same rule as `get_workload_conditions`): `type_` ← `type_`; `status` ← `status`; `reason` ← `reason` or `""`; `message` ← `message` or `""`; `last_transition` ← `lastTransitionTime` as RFC 3339 or `""`.

Registered in `lib.rs` `generate_handler![]`. `list_namespaces` stays registered until R2 (D4).

### 2.2 TypeScript mirror (`src/types/k8s.ts`, F2)

```ts
/** Mirrors namespaces.rs NamespaceRow. */
export interface NamespaceRow {
  name: string;
  /** status.phase verbatim: "Active" | "Terminating"; "" when the API sent none. */
  phase: string;
  /** Formatted age ("5d", "3h12m"); "—" when unknown. */
  age: string;
  /** metadata.labels, keys sorted. */
  labels: Record<string, string>;
  /** metadata.deletionTimestamp, RFC 3339; null when not being deleted. */
  deletion_timestamp: string | null;
  /** status.conditions in API order. */
  conditions: ResourceCondition[];
  /** spec.finalizers in API order. */
  finalizers: string[];
}
```

Plus: `ResourceType` gains `"ns"`; `SelectedResource` gains `| { kind: "ns"; item: NamespaceRow }` (no `ns` field: cluster-scoped).

### 2.3 Commands: Rust param ↔ JS arg

No command gains a parameter, so no new `Option<T>`.

| Command | Rust params | JS caller (hook, `useResources.ts`) | JS args | Wrapper | Change, owner |
|---|---|---|---|---|---|
| `list_namespace_rows` | `context: String` | `namespaceRowsQuery` via `useNamespaceRows`, `useNamespaces`, `fetchNamespacesOrNull` | `{ context }` | `invoke` | new, R1 |
| `list_namespaces` | `context: String` | none after F2 | | | kept by R1, removed by R2 |
| `delete_namespace` | `context: String, name: String` | `useDeleteNamespace` (called only by `DeleteNamespaceConfirm`) | `{ context, name }` | `invokeWrite` | body: `delete_params_for(None)`, R1 |
| `get_resource_yaml`, `get_resource_yaml_neat` | `context, namespace, resource_type, name` | `useResourceYaml`, `useResourceYamlNeat` | `{ context, namespace: "", resourceType: "ns", name }` | `invoke` | `ns` arm (`fetch_all!`), R1 |
| `apply_resource_yaml`, `preview_resource_yaml` | unchanged | the existing YAML Save gate | `resourceType: "ns"`, `namespace: ""` | `invokeWrite` / preview | `ns` arm in the one replace path (`replace_all!`), R1 |
| `get_resource_json`, `patch_resource` | unchanged | Compare, Field managers | `resourceType: "ns"` | `invoke` | `gvk_for` row `("", "v1", "Namespace", "namespaces", false)`, R1. No edit form. |
| `get_resource_metadata` | `context, namespace, resource_type, name` | `useResourceMetadata` | `{ context, namespace: "", resourceType: "ns", name }` | `invoke` | `"ns" \| "namespace" => get_all!(K8sNamespace)`, R1 |
| `get_resource_events` | unchanged | `useResourceEvents` | `kind: "Namespace"`, `namespace: ""` | `invoke` | none (`EVENT_INVOLVED_KIND`, F2); `namespace ""` already lists `Api::all` |
| `can_i` | unchanged | `usePermissions(context, "", "ns")` | `RBAC_RESOURCE.ns = { group: "", resource: "namespaces" }` | `invoke` | table entry, F2 |
| `create_resource_from_yaml` | unchanged | `ResourceCreator` with the existing `ns` form | unchanged | `invokeWrite` | none |

### 2.4 One query, every consumer (`useResources.ts`, F2)

```ts
/** The one namespaces query: key ["namespaces", ctx], data NamespaceRow[]. Every reader spreads this. */
export const namespaceRowsQuery = (context: string) => ({
  queryKey: ["namespaces", context] as const,
  queryFn: () => invoke<NamespaceRow[]>("list_namespace_rows", { context }),
  staleTime: 60_000,
});

/** Page (poll = true), picker. enabled: !!context. With poll: 5 s while any row isTerminating, else 30 s. */
export function useNamespaceRows(context: string, poll?: boolean): UseQueryResult<NamespaceRow[], Error>;

/** Names only: the same query with `select: namespaceNames` (QT1 option A). Signature unchanged. */
export function useNamespaces(context: string): UseQueryResult<string[], Error>;

/** Launcher check. Signature unchanged; fetchQuery({ ...namespaceRowsQuery(context), retry: false }) then namespaceNames. */
export function fetchNamespacesOrNull(qc: QueryClient, context: string): Promise<string[] | null>;
```

Consumers, counted by grep at the base commit (the UX doc listed four; the real count is 22 hook call sites in 9 files plus the launcher):

| Consumer | Today | After F2 (QT1 A) |
|---|---|---|
| `App.tsx:251` (feeds `MapPage`; `TopBar` and `Sidebar` props go) | `useNamespaces` | unchanged line |
| `WhoCanPage.tsx`, `ResourceCompareDialog.tsx`, `create/forms/{rbac,networking,workloads,keyvalue,storage}.tsx` (20 sites) | `useNamespaces` | unchanged |
| `fetchNamespacesOrNull` (launcher, `App.tsx:493`) | own `invoke("list_namespaces")` on the same key | spreads `namespaceRowsQuery`, maps names |
| `NamespacePicker` body (new) | | `useNamespaceRows(context)` |
| `NamespacesView` (new) | | `useNamespaceRows(context, true)` |
| `ResourceCreator` invalidation, `useCreateNamespace`, `useDeleteNamespace` | `["namespaces", ctx]` | unchanged key |
| Refresh (`r`), `useDeleteResource`, `usePatchResource`, `useApplyResource` | `RESOURCE_QUERY_KEY` | `RESOURCE_QUERY_KEY.ns = "namespaces"` (same key) |

**Trap (cache shape):** every `queryFn` on `["namespaces", ctx]` must be `namespaceRowsQuery`'s. A leftover `invoke<string[]>` on that key would put names into a cache that the picker and page read as rows. Gate: `grep -n '"namespaces"' src/hooks/useResources.ts` shows only `namespaceRowsQuery` and the two mutation invalidations.

### 2.5 Every per-kind site for `ns` (`resource-types.md` → Adding a New Resource Type)

| Site | File | `tsc` catches? | `ns` value | Owner |
|---|---|---|---|---|
| Silent 1: `get_resource_yaml` / `apply_resource_yaml` | `commands/pods.rs` | no | `"ns" \| "namespace" \| "namespaces"` → `fetch_all!` / `replace_all!(K8sNamespace)` | R1 |
| Silent 2: `delete_resource` | `commands/pods.rs` | no | **none, on purpose** (D3); the generic panel delete confirm excludes `ns` | R1 (no arm), F2 (exclusion) |
| Silent 3: `gvk_for` | `commands/resource_edit.rs` | no | `("", "v1", "Namespace", "namespaces", false)`; tests: `READABLE_KINDS` + `"ns"`, the cluster-scoped expected set + `"ns"` (rename the test from "nine") | R1 |
| Silent 4: `RESOURCE_QUERY_KEY` | `utils/resourceQueryKey.ts` | no | `ns: "namespaces"` | F2 |
| Silent 5: `CLUSTER_SCOPED_KINDS` | `utils/scope.ts` (+ `scope.test.ts`: the list of ten) | no | add `"ns"`; `viewHidesNamespacePicker` follows | F2 |
| `get_resource_metadata` arm | `commands/extras.rs` | no | `get_all!(K8sNamespace)` | R1 |
| Command + registration | `commands/namespaces.rs`, `lib.rs` | no | `list_namespace_rows` | R1 |
| `ResourceType`, `SelectedResource`, `NamespaceRow` | `types/k8s.ts` | | §2.2 | F2 |
| `RESOURCE_LABELS` | `utils/kindToResourceType.ts` (not `TopBar.tsx` as `resource-types.md` says; F2 fixes the doc) | yes | `"namespaces"` | F2 |
| `kindLabel`, `EVENT_INVOLVED_KIND`, `isHealthy` | `ResourceDetailPanel.tsx` | yes | `"Namespace"`, `"Namespace"`, `phase === "Active"` | F2 |
| `OverviewContent` case | `ResourceDetailPanel.tsx` | **no** (blank panel) | UX 4.4.5 Overview card | F2 |
| `statusChip` (made by F1, ARGO-1) | `ResourceDetailPanel.tsx` | | `ns` arm: Active / Terminating pill / neutral | F2 |
| `NAV_ITEMS` | `CommandPalette.tsx` | no | `{ id: "ns", label: "Namespaces", section: "Cluster" }`, first in Cluster | F2 |
| `RBAC_RESOURCE` | `useResources.ts` | no | `{ group: "", resource: "namespaces" }` | F2 |
| Sidebar nav item | `Sidebar.tsx` | no | first row of "Cluster", `FolderTree` (lucide 1.50 has it) | F2 |
| Route | `App.tsx` | no | `activeResource === "ns"` → `NamespacesView` | F2 |
| View + columns | `ResourceViews.tsx` | | `NamespacesView`, UX 4.4.3 | F2 |
| `canCompare` `EXCLUDED` | `utils/resourceCompare.ts` | no | not excluded (Compare and Field managers stay on) | none |
| `CREATE_FORM` / `RESOURCE_TEMPLATE` | `create/registry.ts`, `resourceTemplates.ts` | | exist already (`NS_FORMS`, `ns:`) | none |
| `EDIT_FORM` | `edit/registry.ts` | | none, on purpose | none |
| `WORKLOAD_KINDS`, `TIMELINE_KINDS`, `MAP_PANEL_KINDS`, `CLUSTER_WIDE_LIST_QUERY` | various | no | not members, on purpose | none |
| Launcher `normalize_kind` | `launch.rs` | no | QT3 (comment and `launcher.md` reason go stale either way) | R2 |

### 2.6 Frontend modules (F2)

**`src/utils/namespaces.ts`** (pure; `namespaces.test.ts` beside it):

```ts
/** Delete is offered disabled with a reason for these (user decision: kube-node-lease joins). */
export const PROTECTED_NAMESPACES: ReadonlySet<string>; // "default", "kube-system", "kube-public", "kube-node-lease"
export const PROTECTED_NAMESPACE_REASON: string;   // `Built-in namespace. Deleting it can break the cluster, so ${PRODUCT_NAME} doesn't offer it.`
export const TERMINATING_NAMESPACE_REASON: string; // "This namespace is already being deleted."
export const NAMESPACE_DELETE_RBAC_REASON: string; // "You don't have permission to delete namespaces on this cluster."

/** phase === "Terminating" || deletion_timestamp !== null. */
export function isTerminating(row: Pick<NamespaceRow, "phase" | "deletion_timestamp">): boolean;

/** pickDisabledReason order: read-only, RBAC (explicit deny only), protected (capability), Terminating (finished). */
export function namespaceDeleteReason(row: NamespaceRow, i: { readOnly: boolean; canDelete: boolean }): string | undefined;

/** Picker rows (T1 §1.5 rule, unchanged): "all" only for an empty trimmed query; a selected name missing
 *  from `names` next; then `names` containing the trimmed query, case-insensitive; no duplicates. */
export function namespaceRows(names: readonly string[], selected: string, query: string): string[];

/** Stable `select` for useNamespaces and the launcher. */
export function namespaceNames(rows: readonly NamespaceRow[]): string[];

/** Label chips for the table: drops "kubernetes.io/metadata.name"; keeps key order. */
export function chipLabels(labels: Record<string, string>): [string, string][];

/** "45s" | "3m" | "2h" | "5d" since an RFC 3339 time; null for null or an unparseable time. */
export function deletingFor(deletionTimestamp: string | null, now?: number): string | null;
```

Tests: the four protected names and `canDelete` precedence (read-only wins over everything, RBAC over protected, protected over Terminating); `isTerminating` by phase and by timestamp alone; every `namespaceRows` case from T1 §1.5; `namespaceNames`; `chipLabels` drops only the metadata-name label; `deletingFor` boundaries and bad input.

**`src/components/NamespacePicker.tsx`** (the TopBar picker; UX 4.3 is the layout and copy):

```ts
export function NamespacePicker(props: {
  context: string;
  ns: string;               // "all" or a namespace name
  setNs: (ns: string) => void;
  onManage?: () => void;    // absent: no "Manage namespaces" footer
}): JSX.Element;
```

Trigger plus the shared `Popover` (no second popover). The body mounts only while open and calls `useNamespaceRows(context)`; it never calls `invoke`. Focus rule from T1 §1.6 stays: focus the trigger, then close, then act (`setNs` or `onManage`). States per UX 4.3.3; forbidden via `classifyReadError(message) === "no-access"`. No writes, so read-only changes nothing.

**`src/components/DeleteNamespaceConfirm.tsx`**:

```ts
export function DeleteNamespaceConfirm(props: {
  context: string;
  name: string | null;              // null: closed
  onClose: () => void;
  onDeleted: (name: string) => void;
}): JSX.Element;
```

The Sidebar `ConfirmModal` moved verbatim (title `Delete namespace {name}`, description `Deletes the namespace and everything in it. This can't be undone.`, confirm `Delete namespace`, `destructive`, `requireTyping={name}`, `requireTypingLabel="Type the namespace name to confirm"`, `contextLabel` / `contextColor` / `context` from `useClusterIdentity(context)`, `kubectlEquivalent` from `deleteNamespaceEquiv`, `isPending`, verbatim backend error in `status`, dialog stays open on error). It owns `useDeleteNamespace()`. On success: `onDeleted(name)`, then `onClose()`.

**`GenericResourceTable.tsx`** additions:

```ts
deleteLabel?: string | ((item: T) => string);   // widened; used as aria-label always and title when enabled
deleteReason?: (item: T) => string | undefined; // checked after read-only (READ_ONLY_REASON_SHORT stays first)
```

A row with a reason renders its trash present, focusable and dimmed: `opacity-0 group-hover:opacity-50 group-focus-within:opacity-50 focus-visible:opacity-50 cursor-not-allowed` with `disabledAttrs(reason)` and a bail-out. Without a reason: `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100`. Exclusive strings, never both pairs. Q21: when `error && !presenceKey && isForbidden(message)`, render the shared `ViewState` no-access card (title row kept, no Retry) instead of the raw error box.

**`ResourceDetailPanel.tsx`** additions: the §2.5 rows; prop `onRequestNamespaceDelete?: (name: string) => void`; for `ns` the header trash uses `namespaceDeleteReason(item, { readOnly: identity.readOnly, canDelete: perm.canDelete })` and calls `onRequestNamespaceDelete(name)` (rendered only when the prop is passed); the generic delete confirm condition adds `resource.kind !== "ns"`; the panel stays open after a delete (it then reads Terminating).

**`NamespacesView`** (`ResourceViews.tsx`): `{ context; search?; selectedKey?; onSelect?(row); onRequestDelete(name) }`. `useNamespaceRows(context, true)`, `usePermissions(context, "", "ns")`, `GenericResourceTable` with `title="Namespaces"`, `storageKey="ns"`, `keyFn = name`, `onDelete={(r) => onRequestDelete(r.name)}`, `deleteReason={(r) => namespaceDeleteReason(r, { readOnly: false, canDelete: perm.canDelete })}` (the table checks read-only first), `deleteLabel={(r) => \`Delete namespace ${r.name}\`}`. Columns per UX 4.4.3.

**Wiring:**

- `TopBar.tsx`: drops prop `namespaces`, state `nsOpen`, ref `nsRef`, the outside-click effect and the inline dropdown; renders `<NamespacePicker>` in the same `{!clusterScoped && …}` branch; gains `onManageNamespaces?: () => void`; New item label `New namespace…` when `activeResource === "ns"` (Helm keeps `Install release…`).
- `Sidebar.tsx`: drops props `ns`, `setNs`, `namespaces`, `onCreateNamespace`, `onDeleteNamespace`, the section, its confirm, its state and every import left unused (grep each to zero first); gains the nav item.
- `App.tsx`: `<Sidebar>` and `<TopBar>` lose the props above; `<TopBar onManageNamespaces={() => { setMainView("resources"); setActiveResource("ns"); }}>`; `const [nsToDelete, setNsToDelete] = useState<string | null>(null)`; renders `<DeleteNamespaceConfirm context={currentContext} name={nsToDelete} onClose={() => setNsToDelete(null)} onDeleted={(n) => { if (n === namespace) setNamespace("all"); }} />` beside `TurnOffReadOnlyConfirm` (outside `<header>`; `ConfirmModal` has no portal and the header starts a drag); passes `onRequestDelete={setNsToDelete}` to `NamespacesView` and `onRequestNamespaceDelete={setNsToDelete}` to `ResourceDetailPanel`; drops `useDeleteNamespace` and `deleteNamespace`; keeps `useNamespaces(currentContext)` for `MapPage`.
- `CommandPalette.tsx`: the `NAV_ITEMS` row. No create action.

### 2.7 Behaviour rules

- Protected set of four; delete disabled with a reason, never hidden, on the row trash and the panel trash; the panel Overview prints the protected reason as a line for the four (UX 4.4.5).
- Delete disabled while Terminating (`TERMINATING_NAMESPACE_REASON`).
- After a delete the row usually turns Terminating; the page polls 5 s until no row is Terminating (D5). If the deleted name was the picker's selection, the picker resets to `all`.
- The picker renders where it renders today (`!clusterScoped`); it is hidden on the Namespaces page because `ns` is in `CLUSTER_SCOPED_KINDS`.
- "Show pods in this namespace" (panel link) calls the panel's existing `onNavigate("pods", name, "")`.
- The Labels column leaves out `kubernetes.io/metadata.name` (count and chips); Summary still shows it.

---

## 3. Contract B: Pod `service_account` and `conditions` (frozen)

Rust (`commands/pods.rs`, R1). `Pod` is built only in `convert_pod`, so one constructor changes:

```rust
pub struct Pod {
    // … existing fields unchanged …
    pub service_account: Option<String>,    // spec.serviceAccountName; None when absent
    pub conditions: Vec<ResourceCondition>, // status.conditions in API order; [] when absent (same mapping as §2.1)
}
```

TypeScript (`types/k8s.ts`, F3):

```ts
export interface Pod {
  // … existing fields unchanged …
  /** spec.serviceAccountName; null when absent. Optional so fixtures compile. */
  service_account?: string | null;
  /** status.conditions in API order (shape shared with get_workload_conditions). Optional so fixtures compile. */
  conditions?: ResourceCondition[];
}
```

Every command returning `Pod` (`list_pods`, `list_pods_on_node`, `get_pod`, `list_workload_pods`) carries the fields; no parameter changes. UI (F3): Metadata `Service account` = `pod.service_account ?? "—"`; the Conditions card is `ConditionsTable` over `pod.conditions` (D6); the hard-coded `"default"` and the phase-derived conditions are deleted.

---

## 4. Hard-rule check

| Rule (CLAUDE.md) | How the plan meets it | Check (owner) |
|---|---|---|
| Additive Tauri params are `Option<T>` | No command gains a parameter | `git diff` of `#[tauri::command]` signatures shows only the new command (W1R) |
| Five silent tables | §2.5, each with an owner | §2.5 greps (W1R, W2R) |
| `CLUSTER_SCOPED_KINDS` equals the `gvk_for` non-namespaced set | both sides add `ns`; Rust and TS tests list ten | `cargo test --lib`, `npx vitest run` |
| `resourceNamespace()` returns `null` for cluster-scoped | `ns` joins the set | `scope.test.ts` |
| Every cluster write through `invokeWrite` | delete via `useDeleteNamespace`, YAML Save via the existing gate, create via `ResourceCreator` | `writeBackstop.test.ts` |
| Components never call `invoke` | picker, view, confirm use hooks | `grep -n "invoke" src/components/NamespacePicker.tsx src/components/DeleteNamespaceConfirm.tsx` shows no call |
| PREVIEW-GATE, one shared replace path | the `ns` arm goes into the one replace path, so preview and save share it | read the R1 diff |
| Deletes send an explicit policy | `delete_namespace` → `delete_params_for(None)` (D2) | `grep -n "DeleteParams::default()" src-tauri/src/commands/extras.rs` empty |
| `can_i` fails open; denied = disabled with a reason | `deleteReason` + `NAMESPACE_DELETE_RBAC_REASON`; no hiding | read `NamespacesView` |
| Every `ConfirmModal` carries `contextLabel` / `contextColor` | moved verbatim; POD-5 keeps them | `grep -n "contextLabel" src/components/DeleteNamespaceConfirm.tsx` |
| `panic = "abort"`: no unwrap / expect / indexing on untrusted input | `namespace_row`, the condition maps | `grep -nE "unwrap\(\)|expect\(|\[[0-9]" src-tauri/src/commands/namespaces.rs` shows tests only |
| ArgoCD Sync and Health independent | ARGO-1 (F1) splits the header; `isHealthy("argocd")` reads Health only | `argocd.md` updated (F1) |
| UI says "Merge", never "Apply" | POD-14 copy; ARGO-3 help drops "applied" | each review reads every new user-facing string for "Apply" / "applied" |
| Tokens only; `mute` not `dim` for text | X-2 sweep, G5 gate | G1, G2, G4, G5 |
| `Patch::Strategic` exactly one hit | untouched | `grep -rn "Patch::Strategic" src-tauri/src` = 1 |
| No Secret value shown | no Secret path touched | none |

---

## 5. Waves, file ownership, collisions

### 5.1 Waves

| Wave | Task | Agent | Starts after | Owns (exactly) |
|---|---|---|---|---|
| 1 | R1 | rust-engineer | now | `src-tauri/src/commands/namespaces.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/pods.rs`, `src-tauri/src/commands/resource_edit.rs`, `src-tauri/src/commands/extras.rs`, `docs/claude/writes.md` |
| 1 | F1 (B1) | frontend-engineer | now | `src/components/DetailPanel.tsx`, `src/components/PodTable.tsx`, `src/components/ResourceDetailPanel.tsx`, `src/components/GenericResourceTable.tsx`, `src/components/ResourceViews.tsx`, `src/components/LogViewBar.tsx`, `src/components/LogSourceBar.tsx`, `src/components/ShellTab.tsx`, `src/components/DebugContainerDialog.tsx`, `src/utils/podStatus.ts` (new), `src/utils/podStatus.test.ts` (new), `src/types/k8s.ts`, `docs/claude/ui.md`, `docs/claude/pods-logs.md`, `docs/claude/argocd.md`, `docs/claude/key-files.md`, `CHANGELOG.md` |
| 1R | W1R | tech-lead | R1 and F1 committed | checkpoint only |
| 2 | F2 (namespaces) | frontend-engineer | W1R clean (or FX1 re-checked); QT1 answered | `src/types/k8s.ts`, `src/hooks/useResources.ts`, `src/utils/resourceQueryKey.ts`, `src/utils/scope.ts`, `src/utils/scope.test.ts`, `src/utils/kindToResourceType.ts`, `src/utils/namespaces.ts` (new), `src/utils/namespaces.test.ts` (new), `src/components/NamespacePicker.tsx` (new), `src/components/DeleteNamespaceConfirm.tsx` (new), `src/components/TopBar.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx`, `src/components/CommandPalette.tsx`, `src/components/ResourceViews.tsx`, `src/components/GenericResourceTable.tsx`, `src/components/ResourceDetailPanel.tsx`, `docs/claude/ui.md`, `docs/claude/resource-types.md`, `docs/claude/key-files.md`, `docs/claude/writes.md`, `docs/claude/open-items.md`, `CHANGELOG.md`. QT1 option B adds `src/components/WhoCanPage.tsx`, `src/components/ResourceCompareDialog.tsx`, `src/components/create/forms/{rbac,networking,workloads,keyvalue,storage}.tsx`. |
| 2R | W2R | tech-lead | F2 committed | checkpoint only |
| 2R | R2 | rust-engineer | F2 committed; QT2 and QT3 answered | `src-tauri/src/commands/namespaces.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/argocd.rs` (QT2 A), `src-tauri/src/launch.rs`, `docs/claude/launcher.md`, `docs/claude/argocd.md`, `docs/claude/key-files.md`, `CHANGELOG.md` |
| 3 | F3 (B2 Pod) | frontend-engineer | W2R clean (or FX2 re-checked) and R2 committed | `src/components/DetailPanel.tsx`, `src/components/PodTable.tsx`, `src/components/LogViewer.tsx`, `src/components/LogViewBar.tsx`, `src/index.css`, `src/hooks/useCopyFeedback.ts` (new), `src/components/EventsTabContent.tsx` (new), `src/components/ConditionsTable.tsx` (new), `src/components/ResourceDetailPanel.tsx` (extraction only), `src/types/k8s.ts`, `docs/claude/ui.md`, `docs/claude/pods-logs.md`, `docs/claude/key-files.md`, `CHANGELOG.md` |
| 3R | W3R | tech-lead | F3 committed | checkpoint only (reviews F3 and R2) |
| 4 | F4 (B2 ArgoCD + shared) | frontend-engineer | W3R clean (or FX3 re-checked) | `src/components/ResourceDetailPanel.tsx`, `src/components/ResourceViews.tsx`, `src/components/GenericResourceTable.tsx`, `src/components/TopBar.tsx`, `src/utils/argoHistory.ts` (new), `src/utils/argoHistory.test.ts` (new), `docs/claude/argocd.md`, `docs/claude/ui.md`, `docs/claude/key-files.md`, `CHANGELOG.md` |
| 4R | W4R | tech-lead | F4 committed | checkpoint only |

Dependencies (one-way): F2 needs R1 (command and arms) and F1 (`statusChip`, the X-1 name button, the X-2 classes in the two shared files). R2 needs F2 (no caller of `list_namespaces` left). F3 needs R1 (Pod fields). F4 needs R2 when QT2 is A (exact revision match). R1 and F1 have no dependency on each other.

### 5.2 Collisions and how they are sequenced

| File | Tasks that edit it | Order |
|---|---|---|
| `ResourceDetailPanel.tsx` | F1, F2, F3 (extraction), F4 | W1, W2, W3, W4 |
| `GenericResourceTable.tsx` | F1 (X-1), F2 (delete reason, 403 card), F4 (X-5, X-8) | W1, W2, W4 |
| `ResourceViews.tsx` | F1 (X-2 ArgoCD lines), F2 (view), F4 (X-5, ARGO-10) | W1, W2, W4 |
| `DetailPanel.tsx`, `PodTable.tsx`, `LogViewBar.tsx` | F1, F3 | W1, W3 |
| `TopBar.tsx` | F2 (picker, New label), F4 (X-3 clear, X-4 New menu, X-8) | W2, W4 (UX: after the picker lands) |
| `useResources.ts` | F2 only | W2 |
| `types/k8s.ts` | F1 (`PodStatus` "Failed"), F2 (`ns`), F3 (Pod fields) | W1, W2, W3 |
| `CHANGELOG.md` | F1, F2, R2, F3, F4 (R1 has no user-visible change) | W1, W2, 2R, W3, W4 |
| `docs/claude/ui.md` | F1, F2, F3, F4 | W1 to W4 |
| `docs/claude/key-files.md` | F1, F2, R2, F3, F4 | W1, W2, 2R, W3, W4 |
| `docs/claude/argocd.md` | F1, R2, F4 | W1, 2R, W4 |
| `docs/claude/writes.md` | R1, F2 | W1, W2 |
| `namespaces.rs`, `lib.rs` | R1, R2 | W1, 2R |

R1 and F1 share no file. R2 and W2R share none (a review owns only its checkpoint).

---

## 6. Task briefs

### 6.0 Common to every task

- **Boot:** CLAUDE.md Team protocol and hard rules are binding. Load caveman at ultra (Skill `anthropic-skills:caveman`, args `ultra`). ponytail is not installed: apply it by hand (minimal version first, name what you skip, flag over-engineering). `rtk` is not on PATH; the hook strips the prefix. Chat in caveman ultra; files, comments and docs in normal prose.
- **Run and checkpoint:** task `<ID>` of `.claude/checkpoints/feat-ns-panel-ux-review/ledger.md`. Checkpoint `.claude/checkpoints/feat-ns-panel-ux-review/<ID>-<agent>.md` (`docs/claude/agent-checkpoints.md`). Write it within your first few steps, after each sub-step, before any long build; write the report into it before you reply.
- **Ownership:** edit only the paths in your §5.1 row and your checkpoint. No git writes. No agents. Need a file you do not own: stop, set Status `blocked`, report.
- **Unsure about intent, scope or copy:** do not assume. Add it to your report as a question with options and a recommendation, and leave that item undone.
- **Inputs:** this file (§2, §3 win), `docs/ux/24-pod-argocd-review-and-ns-panel.md` (the finding's Fix is the exact change), the ledger's User decisions.
- **Frontend gates** (run plainly; `npx vitest run` with no pipe): `npx tsc --noEmit`; `npx vitest run`; `npm run build`; `node --experimental-strip-types scripts/check-emit.ts`; `ui.md` → Appearance G1, G2, G4 (and G5 once F1 adds it). Do not run `make dev` (the user may own port 1420).
- **Rust gates** (in `src-tauri`): `cargo check`; `cargo test --lib`; `cargo clippy --all-targets --locked`.
- **Docs:** every behaviour change carries its doc and `CHANGELOG.md` `[Unreleased]` line in the same task (Keep a Changelog groups in order Added, Changed, Fixed; user terms; shipped behaviour only). Grep every new doc claim against your code.
- **Report:** files changed, gates with results, each finding ID done or left (with why), questions.

### R1. rust-engineer: namespace rows, `ns` arms, Pod fields, namespace delete policy

1. `commands/namespaces.rs`: `NamespaceRow`, `namespace_row`, `list_namespace_rows` (§2.1). Keep `list_namespaces`. Tests (`namespaces::tests`, JSON fixtures through `serde_json::from_value::<Namespace>`): an Active namespace (phase, `finalizers == ["kubernetes"]`, labels sorted, `deletion_timestamp` None); a Terminating one with `deletionTimestamp` and two conditions (`NamespaceContentRemaining`, `NamespaceFinalizersRemaining`, status `True`) mapped in order with reason and message; a namespace with no `status` and no `spec` (phase `""`, empty lists).
2. `lib.rs`: register `list_namespace_rows`.
3. `commands/pods.rs`: `Pod.service_account`, `Pod.conditions` (§3) in `convert_pod`; tests beside the existing `convert_pod` tests (present, absent, condition order and defaults). `ns` arms in `get_resource_yaml` (`fetch_all!`) and the one replace path (`replace_all!`), with the aliases `"ns" | "namespace" | "namespaces"`. Make `delete_params_for` `pub(crate)`.
4. `commands/resource_edit.rs`: the `gvk_for` row; `READABLE_KINDS` gains `"ns"`; the cluster-scoped expected set gains `"ns"`; rename `cluster_scoped_set_is_exactly_the_nine_null_namespace_kinds` so it holds no count.
5. `commands/extras.rs`: `get_resource_metadata` arm; `delete_namespace` uses `super::pods::delete_params_for(None)?` (D2).
6. `docs/claude/writes.md` → Delete propagation: `delete_namespace` now sends Background through `delete_params_for`; the separate list becomes `delete_pod`, `delete_node`, `delete_argocd_app`; add the check `grep -n "DeleteParams::default()" src-tauri/src/commands/extras.rs` (empty).
- No `CHANGELOG.md` line: nothing user-visible changes until F2 and F3 (state this in the report).
- Gates: Rust gates; `grep -rn "Patch::Strategic" src-tauri/src` returns one hit; no `unwrap()` / `expect(` / slice indexing outside `#[cfg(test)]` in the new code.

### F1. frontend-engineer: B1 (the five Critical findings, POD-3, POD-5, POD-12, ARGO-2, ARGO-4, ARGO-5)

Implement each finding's Fix from `docs/ux/24` §3, in this order (cheapest regressions first):

1. **POD-1** (`DetailPanel.tsx`): module-scope `AccordionHeader` with `aria-expanded` / `aria-controls`, body ids.
2. **POD-12** (`DetailPanel.tsx`): `logs` sets `logPick` before `setTab("Logs")`; both links get the target classes and names.
3. **POD-3**: new `src/utils/podStatus.ts` (`POD_STATUS_STYLE`, `podStatusStyle`) and `podStatus.test.ts`; both `StatusPill`s use it; local maps deleted; `PodStatus` gains `"Failed"`; `STATUSES` gains `"Failed"`.
4. **POD-5** (`DetailPanel.tsx`, `PodTable.tsx`): `mutateAsync`, dialog stays open with the verbatim error, `confirmLabel` `Delete pod` / `Deleting…`.
5. **X-3** for every row of its table except `TopBar.tsx` (F4). The Pod row menu is replaced by the named direct delete button from X-4 (D11), with `rowReason` (read-only wins, then "Clear the selection to delete a single pod.").
6. **X-1:** first run the audit (`grep -n "cell: " src/components/ResourceViews.tsx`, read the first column of every `Column[]`). If any first cell renders a button or a link, set Status `blocked` and report the list before touching `GenericResourceTable.tsx` (D10). Then the name-cell button in `PodTable.tsx`, `GenericResourceTable.tsx` and the ArgoCD Resources tab kind cells.
7. **ARGO-1** (`ResourceDetailPanel.tsx`): module-scope `argoHealthPill`, `argoSyncPill`, `argoPhasePill`; header shows Health and Sync chips for `argocd`; a module-scope `statusChip(resource): { label; tone }` serves every other kind (generic Healthy / Degraded for now; Q15's "Not healthy" is F4; F2 adds `ns`); Overview drops its two pills and relabels the operation pill `Last operation: …`; `isHealthy("argocd")` reads Health only; Resources tab: two independent single-select groups with per-status counts, `aria-pressed`, full-strength text.
8. **ARGO-2**: Actions before the field card; `Sync policy` row (`Automated` / `Manual`).
9. **ARGO-4**: `aria-disabled:` styling, visible reason line, `busy` through `aria-disabled` plus bail-out.
10. **ARGO-5**: `feedback` becomes `{ tone, text } | null`; success clears after 4 s with cleanup; errors stay until the next action; `role="alert"` / `role="status"`; `Couldn't sync {name}: …`, `Couldn't refresh {name}: …`. Resources tab gets the roles now, its copy in F4 (ARGO-11).
11. **X-2** last, as one read-the-diff sweep over the eight files listed in the finding (including the ArgoCD list lines in `ResourceViews.tsx`). Add **G5** to `ui.md` → Appearance: `grep -nE 'text-dim' <the seven component files>` returns icon lines only, and `grep -nE 'text-(ok|warn|bad|status-progress|accent)/(40|50|60|70|80)' <same files>` returns nothing.

Docs: `ui.md` (Confirm-on-Destructive: pod delete stays open on failure with the verbatim error; one line on keyboard-openable rows: a name-cell button with no handler, Enter and Space bubble a click to the row; G5); `pods-logs.md` (one pod status vocabulary in `podStatus.ts`, `Failed` filterable; the `logs` link picks its container); `argocd.md` (Health and Sync chips in the header; Resources filter groups, Healthy is `health_status === "Healthy"` alone; Actions first and Sync policy on Overview; action errors stay until the next action); `key-files.md` (`podStatus.ts`); `CHANGELOG.md` `### Fixed` (X-1, X-3, POD-1, POD-3, POD-5, POD-12, ARGO-1, ARGO-4, ARGO-5, X-2 contrast) and `### Changed` (ARGO-2).
Gates: frontend gates plus G5; F1 edits no file under `src-tauri` (R1 runs at the same time).

### W1R. tech-lead: review R1 and F1

Review only (checkpoint `W1R-tech-lead.md`). Check R1 against §2.1, §2.3, §2.5 (Rust rows), §3 and D2; F1 against each finding's Fix, D10, D11 and §4. Run the Rust and frontend gates, G1 to G5, and grep every new doc claim. Ponytail: flag anything beyond the findings. Findings Blocking / Should fix / Nit with file, line and exact fix; the main session turns them into FX1 (one owner per file; R1 files to rust-engineer, F1 files to frontend-engineer), and W1R re-checks every fix batch (FX1R).

### F2. frontend-engineer: the namespaces picker and page

Implement §2.2, §2.4, §2.5 (frontend rows), §2.6, §2.7, with the layout and copy of `docs/ux/24` §4.3 (picker) and §4.4 (page and panel). Order:

1. `types/k8s.ts`, `utils/namespaces.ts` + test, `resourceQueryKey.ts`, `scope.ts` + `scope.test.ts` (ten kinds), `kindToResourceType.ts`. Run `npx vitest run`.
2. `useResources.ts`: `namespaceRowsQuery`, `useNamespaceRows`, `useNamespaces` per QT1, `fetchNamespacesOrNull`, `RBAC_RESOURCE.ns`. Run the §2.4 trap grep.
3. `GenericResourceTable.tsx` (`deleteReason`, widened `deleteLabel`, `group-focus-within`, Q21 403 card).
4. `NamespacesView`, `ResourceDetailPanel.tsx` `ns` sites and header trash, `DeleteNamespaceConfirm.tsx`.
5. `NamespacePicker.tsx`; `TopBar.tsx`, `Sidebar.tsx`, `App.tsx`, `CommandPalette.tsx`. Grep every removed name to zero before deleting an import.

Docs: `ui.md` (new section `## Namespaces: picker and page` as a grep target, with the picker's contents, states, footer link and focus rule, the page's columns, quiet Active and loud Terminating, the dropped metadata-name label, the protected set of four, the delete-reason order, the `deleteReason` row rule, the opacity reveal (never `invisible`), the 5 s / 30 s poll, why the picker is hidden on the page; Confirm-on-Destructive "Sidebar namespace delete" becomes "Namespaces page delete (row trash and panel header), typed"; App views / TopBar rules clause; Keyboard layering: the picker is a `Popover` user; the 403 card for core lists); `resource-types.md` (kind table row `ns` cluster; the kind-count sentence; both cluster-scoped lists; `RESOURCE_LABELS` lives in `kindToResourceType.ts`; `ns` has no `delete_resource` arm, it deletes through `delete_namespace`); `key-files.md` (Sidebar row drops "namespace list"; rows for `NamespacePicker.tsx`, `DeleteNamespaceConfirm.tsx`, `utils/namespaces.ts`; `namespaces.rs` row names `list_namespace_rows`); `writes.md` ("Namespace form opens from the Sidebar `+`" becomes TopBar New and `⌘N` on the Namespaces page; the protected set and its reasons); `open-items.md` (live rows: a namespace stuck in Terminating shows its conditions; the Events tab finds events about a namespace); `CHANGELOG.md` (`### Added` the Namespaces page; `### Changed` the picker filter and Manage link, the sidebar list removed, `kube-node-lease` protected, the "no access" card on core lists; `### Fixed` namespace delete reachable by keyboard).
Gates: frontend gates; §4 greps for F2; `git diff --stat -- src-tauri` shows nothing from F2.
Verify by hand (main session or the user, `make dev`): YAML tab and Save preview on a namespace; Compare and Field managers; ⌘N creates and the row appears; delete turns the row Terminating and it disappears; `r` refreshes the page; picker forbidden state with a restricted user.

### W2R. tech-lead: review F2

As W1R, against §2 and §4, D3, D5, D8, D9, the §2.4 trap and every §2.5 row. FX2 and its re-check follow the same rule. FX2 starts only after R2 is committed (R2 owns `CHANGELOG.md` and `key-files.md` meanwhile).

### R2. rust-engineer: remove `list_namespaces`; QT2 and QT3 (runs alongside W2R)

1. Remove `list_namespaces` from `namespaces.rs` and `lib.rs` (`grep -rn "list_namespaces" src src-tauri/src` returns nothing first). `key-files.md`: drop it if listed.
2. QT2 A: `argocd.rs` `last_commit` becomes `"—"` when the revision is empty, else `short_revision(revision)`; remove the byte slice; a test with a 40-hex SHA, a chart version longer than 7 characters and a non-ASCII revision. `argocd.md`: the Revision column and Overview show `last_commit` through `short_revision`. `CHANGELOG.md` `### Fixed`: an ArgoCD app that tracks a chart version, tag or branch shows the full revision instead of its first 7 characters. QT2 B: skip this step.
3. QT3: A maps `ns` / `namespace` / `namespaces` to `"ns"` in `normalize_kind` (+ test, `HELP_SHORT_NAMES` if it lists kinds, `launcher.md`, `CHANGELOG.md` `### Added`); B keeps them unmapped and rewrites the reason in the `launch.rs` comment and `launcher.md` ("not mapped from the command line; open the Namespaces page from the sidebar").
Gates: Rust gates.

### F3. frontend-engineer: B2, Pod half

Findings and decisions: **POD-2** with Q2 (§3, D6: real Service account and `ConditionsTable`; delete the hard-coded `default` and the phase-derived conditions), **POD-4** (move `EventsTabContent` to `src/components/EventsTabContent.tsx`, imported back by `ResourceDetailPanel.tsx`; Pod Events uses it with `scopedToKind={false}`; YAML error state with Retry), **POD-6**, **POD-7** with Q3 A (limit, else twice the request, else no bar and the number only) and Q4 A (sort CPU and Memory by the displayed value), **POD-8**, **POD-9**, **POD-10** with Q5 A (the three blocked Shell controls open the Shell tab; edit the `ui.md` DISABLE-PRECEDENCE sentence to name this one exception), **POD-11** with Q6 merge (D7; reset and default tab become `Summary`; grep `"Overview"` in `DetailPanel.tsx` and its callers), **POD-13**, **POD-14**, **POD-15** (`index.css` reduced-motion list gains `.animate-blink`; update the `ui.md` Manual Refresh sentence that lists the stopped animations), **X-4** for `DetailPanel.tsx` and `PodTable.tsx` (Labels, Sort; the row menu went in F1), **X-5** for the Pod tab strip, the status filter, the sortable headers and `LogViewer.tsx` toggles, **X-6** with Q12 A (`src/hooks/useCopyFeedback.ts`; bulk Copy names keeps the selection), **X-7** with Q13 A (floor 10.5 px and no prose in mono in `DetailPanel.tsx`, `PodTable.tsx`, `EventsTabContent.tsx`; keep uppercase eyebrows), **X-8** with Q14 A (`ring-accent/70` focus rings; `ring-1 ring-mute/70` on text fields) in `DetailPanel.tsx`, `PodTable.tsx`, `LogViewBar.tsx`, `LogViewer.tsx`, **X-9** for the Pod files, **ARGO-13** for the `DetailPanel.tsx` `KV` (`title={v}`). Also extract `ConditionsTable.tsx` from the workload Summary in `ResourceDetailPanel.tsx` (D6). `ResourceDetailPanel.tsx` changes in F3 are the two extractions only.
Docs: `ui.md` (Keyboard layering: the pod actions, Labels and Sort menus are `Popover` users; DISABLE-PRECEDENCE exception; Manual Refresh reduced motion); `pods-logs.md` (Summary tab merged with real service account and conditions; Events via `EventsTabContent`; CPU and Memory `req` suffix, denominator and sort; port-forward validation); `key-files.md` (`useCopyFeedback.ts`, `EventsTabContent.tsx`, `ConditionsTable.tsx`; the `pods.rs` row names `service_account` and `conditions`); `CHANGELOG.md`.
Gates: frontend gates; `grep -nE 'text-\[(9|9\.5|10)px\]'` and `grep -nE 'ring-accent/(40|60)'` on the F3 component files return nothing.

### W3R. tech-lead: review F3 and R2

As W1R. R2: §2.3 row for `list_namespaces`, QT2 and QT3 as answered, Rust gates. F3: each finding's Fix, D6, D7, the hard rules. FX3 and its re-check follow the same rule.

### F4. frontend-engineer: B2, ArgoCD half and shared files

Findings and decisions: **ARGO-3** with Q10 A (checkboxes, always-visible help, existing Force meaning), **ARGO-6** with Q7 A (delete the expander, its state and both expansion rows), **ARGO-7** with Q11 A (full message, always-visible chevron, a neutral `Current` chip from `liveHistoryId`), **ARGO-9** with Q9 A (Prune or Force goes through the confirm, title and copy chosen by the options; edit `ui.md` "Single-click writes, by design" to exclude Sync with Force), **ARGO-10**, **ARGO-11**, **ARGO-12**, **ARGO-13** (`ResourceDetailPanel.tsx` `KV` `wrap` and `title`), **Q15** A (`statusChip` generic fallback reads `Not healthy`), **X-3** (`TopBar.tsx` clear-search name), **X-4** (`TopBar.tsx` New menu as a `Popover`), **X-5** (resource panel tab strip, Flat / Grouped toggle with the fixed label `Group by kind`, `ArgoHealthCard`, `aria-sort` in `GenericResourceTable.tsx`), **X-7** with Q13 A, **X-8** with Q14 A, **X-9** for `ResourceDetailPanel.tsx`, `ResourceViews.tsx` (ArgoCD parts), `TopBar.tsx`, `GenericResourceTable.tsx`.
New `src/utils/argoHistory.ts` + test: `liveHistoryId(history: ArgoCdHistoryEntry[], lastCommit: string): number | null` returns the highest `id` whose `revision` equals `lastCommit`, or null. With QT2 B it also returns null unless `lastCommit` is 7 hex characters or shorter than 7 (a truncated chart version could match the wrong entry).
Docs: `argocd.md` (sync options, the Force confirm, History message and Current marker, the expander removed, Resources tab Hard refresh copy, tab badges); `ui.md` (Single-click writes; Keyboard layering: the TopBar New menu is a `Popover` user; the header fallback word); `key-files.md` (`argoHistory.ts`); `CHANGELOG.md`.
Gates: frontend gates; the F3 size and ring greps on the F4 files.

### W4R. tech-lead: review F4

As W1R, plus the run-level checks: `cargo check` and `cargo test --lib` in `src-tauri`; every CLAUDE.md hard rule; `CHANGELOG.md` `[Unreleased]` reads as one coherent list (no duplicate or contradicting lines across F1 to F4). FX4 and its re-check follow the same rule.

### Fix batches (FXn)

The main session writes each FXn brief from the review's findings, assigns each file to one owner (rust-engineer for `src-tauri`, frontend-engineer otherwise), and records it in the ledger before dispatch. An FXn task owns only the files its findings name, runs its wave's gates, and is re-checked by the tech lead (FXnR) before the next wave starts. Fix batches have brought regressions here before, so every re-check re-runs all gates, not only the touched lines.

---

## 7. Deferred and skipped

- **ARGO-8 / Q8** (`operation_message` on `ArgoCdApp`): a later Rust run; nothing now.
- The CLAUDE.md "Testing" line for this run's tests (`namespaces::tests`, the `convert_pod` additions, TS `namespaces`, `podStatus`, `argoHistory`): the main session adds it with the release commit (agents do not edit CLAUDE.md).
- A UX acceptance (`docs/ux/NN-…-acceptance.md`) runs before a release commit; this run has none planned.
- Everything listed under "Skipped" in §0.
- `useCreateNamespace` and `create_namespace` (no caller) stay as they are.

---

## 8. Questions for the user

Each blocks only the task named. Recommended option first.

**QT1. Keep `useNamespaces` as a names view of the one query? (blocks F2)** Your Q16 answer asked for one `useNamespaceRows` hook for every consumer. A grep found 22 `useNamespaces` call sites in 9 files (the create forms, Who can, Compare, App) plus the launcher check, not the four the UX doc listed.
- A (recommended): `useNamespaces(context)` stays, reading the same query with a `select` that returns names. One query key, one data shape (rows), one fetch; no change in the 20 form and page call sites. The page and picker call `useNamespaceRows`.
- B: replace every call with `useNamespaceRows` and map to names at each site. Same runtime result; F2 also edits `WhoCanPage.tsx`, `ResourceCompareDialog.tsx` and five create-form files, each site needing a memoised name list.

**QT2. ArgoCD `last_commit` is cut with a byte slice. (blocks R2 step 2 and F4's Current chip rule)** `argocd.rs` takes the first 7 bytes of `status.sync.revision`. A non-ASCII revision crashes the app in a release build (`panic = "abort"`, a CLAUDE.md hard rule), and a chart version such as `10.11.12` shows as `10.11.1`, so the History "Current" chip (your Q11) could mark the wrong entry.
- A (recommended): fix it in R2 with the existing `short_revision` (only a 40-character SHA is shortened). Visible change: chart versions, tags and branch names show in full on the Applications list and the panel. The Current chip then uses an exact match.
- B: leave it for a later run. The Current chip shows only when `last_commit` is a 7-character hex SHA or shorter than 7 characters, so Helm-based apps with long versions get no chip.

**QT3. Open the Namespaces page from the command line? (blocks R2 step 3)** `garita ns` is ignored today because "there is no namespaces view"; after F2 that reason is wrong.
- A: map `ns`, `namespace`, `namespaces` to the new page (one table row, a test, `launcher.md`, a CHANGELOG line).
- B (recommended): not in this run; R2 only rewrites the reason in the comment and `launcher.md`. A separate request if wanted.

---

## 9. Observed, out of scope

- `delete_pod` (`pods.rs`) and `delete_node` (`nodes.rs`) still use `DeleteParams::default()`; `writes.md` documents them as exceptions. Not changed (D2 covers only `delete_namespace`).
- `docs/claude/resource-types.md` says `RESOURCE_LABELS` lives in `TopBar.tsx`; it is in `src/utils/kindToResourceType.ts`. F2 fixes the line.
- `.claude/agents/senior-ux-specialist.md` still says "Sidebar (… namespace list …)" and "Dark-only palette". After F2 lands the main session or the user may update it; agents do not edit agent configuration.
- The Who can page, Compare dialog and every create form fetch the namespace list on open; with this plan they share the cache with the page, so a list fetched for the page also fills them.

## 10. User decisions during the run

Copied from the run ledger when the run closed (`docs/claude/agent-checkpoints.md` → Cleanup). Newest first. "NOT the recommendation" marks a choice that differs from the option the agents recommended.

- 2026-10-29: D25 (Pods Labels and Sort menus run past the window bottom) = "Fix now" before v2.4.0 (NOT the recommendation). The vite-kill question was not answered; the container restart ended that vite process, so nothing to do.
- 2026-10-29 (answers to V2 questions, docs/ux/25 section 7): Q1 FX5 = must + should (FX5-1..FX5-6; Tier B NOT included); Q2 TopBar search may shrink to 200 px; Q3 captions say "with sample data"; Q4 "In v2.4.0" (NOT the recommendation): add a top-level React error boundary in this release (new `src/components/ErrorBoundary.tsx`, wired in `src/main.tsx`; fallback with a plain message and Reload; components never call invoke, so no IPC logging; no error stack or object data on screen).
- 2026-10-29: README and landing page get new screenshots from the Chromium captures: REPLACE the hero `site/demo.png` (caption and alt must say it uses sample data, not "a real window on a kind cluster") AND add a small gallery (Namespaces page, Pod panel, ArgoCD panel). Dark theme. Marketing shots are captured after any FX5 so they show the final UI.
- 2026-10-29: release v2.4.0: the release commit keeps `[skip ci]`; NO tag yet (tag after the PR merges to main; user's call).
- 2026-10-29 (user, after the run summary): (1) run the by-sight check with a Chromium driver; (2) release v2.4.0; (3) update `.claude/agents/senior-ux-specialist.md` (done c2ccb12); (4) the PR is the user's, later.
- 2026-10-29: Q-T = A. Change timeline shows only the first line of an ArgoCD commit message (`timeline.ts` + one `timeline.test.ts` case; argocd.md sentence). History tab keeps the whole message. FX4b.
- 2026-10-29 (answers to F4 / W4R questions):
  - Q-A: "Rust change now" (NOT the recommendation): ArgoCD History shows the whole commit message. Contract: `ArgoCdHistoryEntry.message` becomes the full message (all lines, trailing whitespace trimmed); the row shows the first line, the expanded entry shows all lines (`whitespace-pre-wrap`). R3 (Rust, argocd.rs history mapping + test) and FX4 (frontend render + docs + CHANGELOG) in parallel.
  - Q-B: leave the YAML edit banner text (asked twice, the second time with the "not directly, Save previews first" point; user kept "Leave").
  - Q-C: accept Cmd+N inert while the New popover is open (documented).
  - Q-D: A. Applications list Health/Sync cells use the shared `argoHealthPill`/`argoSyncPill`; ArgoGlyph moves to `src/components/ArgoGlyph.tsx`; delete `syncPillClass`/`syncIcon` (keep `healthPillClass`/`healthIcon` for the Certificate Ready column); argocd.md + CHANGELOG Fixed.
- 2026-10-29 (answers to F3 questions):
  - F3-QA: option 1, as implemented: "twice the request" applies to live usage only; a request-only value is drawn against the limit, else the number alone.
  - F3-QB: keep ascending first click for CPU/Memory (same as other columns).
  - Unowned weak rings / sub-10.5 px text: fix the Pod-panel ones in this run (user said "in F4"; W3R found they must land in FX3 for the CHANGELOG line to be true, so FX3 S3 = A: LogSourceBar, NeatYaml, plus MetricChart axis, all inside the Pod panel). FieldManagers, DiffRows, ConfirmModal, MergeFromFileModal, HelmInstallModal, WhoCanPage, ClusterOverview, ExplainCard wait for a later app-wide pass (log in open-items). TopBar stays F4.
- 2026-10-29 (answers to F2 questions):
  - F2-Q1: A. Accept that deleting the picked namespace resets the picker to "all" and closes the panel.
  - F2-Q2: "Fix in this run" (NOT the recommendation): `useApplyResource` invalidates `[RESOURCE_QUERY_KEY[resourceType], context]` (prefix, like `useDeleteResource`), so every list refreshes after a YAML Save; update `resource-types.md` step 8 and a CHANGELOG Fixed line. In FX2.
- 2026-10-28 (answers to F1 questions):
  - F1-Q1 X-1: A. Add `interactive?: boolean` to `Column`; GenericResourceTable puts the name button in the first visible non-interactive column; flag the ArgoCD Applications `sel` column. Done in F1b before F2.
  - F1-Q2: "Extract + test" (NOT the recommendation): move the pure ArgoCD Health/Sync pill and filter logic from ResourceDetailPanel.tsx into `src/utils/argoStatus.ts` with `argoStatus.test.ts`. Done in F1b.
- 2026-10-28 (answers to T5 plan §8):
  - QT1: A. `useNamespaces` stays a names-only `select` over the one rows query; the 20 form/page call sites do not change.
  - QT2: A. Fix the `revision[..7]` byte slice in `argocd.rs` with `short_revision` in R2; History "Current" marker uses exact match.
  - QT3: "Map it now" (NOT the recommendation): `garita ns`, `namespace`, `namespaces` open the Namespaces page (R2, `launch.rs` + `launcher.md`). If a frontend file must change for it, R2 reports it and the main session assigns it (F3 or F4).
  - delete_namespace propagation: accepted. R1 moves it to `delete_params_for` (Background); delete_pod, delete_node, delete_argocd_app stay documented exceptions.
- 2026-10-28 (answers to T2 §6 questions, docs/ux/24 §6):
  - Q1 batches: two batches. B1 = 5 Critical + POD-3, POD-5, POD-12, ARGO-2, ARGO-4, ARGO-5; review; B2 = rest of "implement now".
  - Q16: new Rust rows command + one `useNamespaceRows` hook for page, picker, MapPage, creator invalidation (names derived from rows; one query key).
  - Q17: real reasons: rows carry `status.conditions` and `spec.finalizers`; Terminating card shows them.
  - Q8: `operation_message` in a later Rust run; nothing now.
  - Q5: blocked Shell click opens the Shell tab (edit ui.md DISABLE-PRECEDENCE).
  - Q9: Force sync goes through a confirm, like Prune, even with the typed-confirm guardrail off.
  - Q2: "Real fields now" (NOT the recommendation): add `service_account` and `conditions` to the Rust pod type this run and show real values; remove the hardcoded "default" and phase-derived conditions.
  - Q6: "Merge tabs" (NOT the recommendation): merge Pod Overview into Summary (one fewer tab).
  - Q7: remove the ArgoCD Resources "diff" expander.
  - Q13: floor 10.5 px, no mono sentences, keep uppercase eyebrows.
  - Q21: 403 ViewState card for all core lists in GenericResourceTable.
  - Q3, Q4, Q10, Q11, Q12, Q14, Q15, Q18, Q19, Q20, Q22, Q23, Q24: accept T2 recommendations (option A each).
- 2026-10-28 (answers to main-session questions):
  - Q-place: "Both". TopBar namespace dropdown = picking + filter; a new Namespaces resource page (table + detail panel) = create, delete, details. Sidebar namespace list removed (the page gets a sidebar nav item). This reopens plan §1 (frozen contract): new resource kind, cross-stack; tech-lead re-plans.
  - Q1 palette "Create namespace…": no, not now.
  - Q2 forbidden namespace list: "Return forbidden" (show the forbidden state; no typed-name fallback).
  - Q3: protect `kube-node-lease` from delete in this run.
- 2026-10-28: Scope widened: the Pod and ArgoCD panel improvements that T2 judges needed get implemented. After T2, tech-lead turns T2 findings into implementation tasks (new briefs). Any part an agent is unsure of becomes a question to the user, not an assumption.
- 2026-10-28: UX re-check focus is the Pod detail panel and the ArgoCD panel; namespace list moves from the left sidebar into the namespace panel.

## 11. ArgoCD sync-failure reason (v2.4.0 addition)

Run 2 of this branch (ledger, user request of 2026-10-29: "add the ArgoCD sync-failure reason to this release"). It supersedes the deferral in §7 ("ARGO-8 / Q8: a later Rust run") and the `argocd.md` line "Not shown (Q8, deferred)". v2.4.0 is committed at `66d7406` and not tagged, so this joins v2.4.0 with no version change. Inputs: `docs/ux/24-pod-argocd-review-and-ns-panel.md` ARGO-8 and §6 Q8 option A; the ArgoCD rules in CLAUDE.md and `argocd.md`. Questions are in §11.7; a task that a question blocks says so.

### 11.0 Minimal version, and what it skips

Minimal: one Rust field `operation_message` on `ArgoCdApp`, read from `status.operationState.message` of the same Application object the list already reads; one pure Rust helper with a unit test; the TypeScript mirror; one pure TS helper with tests; a box under the "Last operation" pill in the Overview when the last operation failed. No new command, no new parameter, no new tab.

Skipped (each is a later request unless an answer in §11.7 adds it):

- Per-resource results (`status.operationState.syncResult.resources[]` entries with `status: SyncFailed` and their `message`). ARGO-8 asks for the operation message only; the Resources tab reads `status.resources[]`, not the sync result, and joining the two is its own design.
- `status.conditions` (ComparisonError, SyncError, OrphanedResourceWarning and the rest): a different field with its own meaning, not the last operation.
- A hint in the Applications list (Q-R4).
- A copy button for the message.
- The message of a Succeeded operation (upstream writes a fixed "successfully synced" sentence; it adds nothing).
- Masking the message (§11.1.4).
- A live-harness test: the kind harness installs no Argo CD.

### 11.1 Contract (frozen)

#### 11.1.1 Rust (`src-tauri/src/commands/argocd.rs`, R4)

```rust
/// Longest `operation_message` sent to the webview, in characters (Unicode scalar values, not bytes).
pub(crate) const OPERATION_MESSAGE_MAX_CHARS: usize = 2000;

pub struct ArgoCdApp {
    // … existing fields unchanged …
    pub operation_phase: String,
    /// `status.operationState.message`: the controller's text about the last operation, for every
    /// phase (the frontend chooses which phases it shows). Empty when absent or not a string.
    /// Display form from `operation_message_display`.
    pub operation_message: String,
    // … existing fields unchanged …
}

/// Display form of `status.operationState.message`. Never byte-slices, never panics.
pub(crate) fn operation_message_display(message: &str) -> String;
```

`operation_message_display`, in this order:

1. Lines are joined with `\n` (`str::lines`, so a CRLF message loses its `\r`).
2. Control characters other than `\n` and `\t` are dropped (`char::is_control`). An ANSI colour sequence from plugin output then loses its ESC byte instead of reaching the DOM raw; its printable rest stays.
3. Leading and trailing whitespace is trimmed. Inner blank lines and indentation stay.
4. A result longer than `OPERATION_MESSAGE_MAX_CHARS` characters keeps its first `OPERATION_MESSAGE_MAX_CHARS` characters (`chars().take(n)`) followed by `…` (U+2026). A result of exactly the limit is unchanged and has no `…`.

Call site, in `list_argocd_apps` next to `operation_phase`:

```rust
let operation_message = status["operationState"]["message"]
    .as_str()
    .map(operation_message_display)
    .unwrap_or_default();
```

- Not `str_or_dash`: an absent message is `""`, never `—`, so the frontend tests emptiness only.
- `panic = "abort"`: the input is untrusted controller text. No `unwrap`, `expect`, indexing or byte slicing (`&s[..n]`); only `lines`, `chars`, `filter`, `take`, `trim`.
- Commands: `list_argocd_apps` only. It holds the one constructor of `ArgoCdApp` (`grep -rn "ArgoCdApp {" src-tauri/src` has two hits: the struct and that constructor), and the panel's `item` is a list row. No parameter is added to any command, so the `Option<T>` rule has nothing to apply to.
- The cap: the list is polled every 30 s and carries every Application. 2000 characters holds a multi-object apply failure in practice and bounds the payload; the raw YAML tab keeps the whole text.
- Source: the Kubernetes object only (the existing `argo_api_resource` discovery, so no hardcoded `argoproj.io` version), never the Argo CD API. Health and Sync are untouched.

Test `argocd::tests::operation_message_display_rules`: absent stays empty at the call site (covered by `unwrap_or_default`, no test needed); `""` and whitespace only give `""`; surrounding spaces and newlines are trimmed; `"a\r\nb"` gives `"a\nb"`; an inner blank line and a `\t` survive; `"\u{1b}[31mfailed\u{1b}[0m"` gives `"[31mfailed[0m"`; exactly 2000 ASCII characters are unchanged with no `…`; 2001 characters give 2000 plus `…`; 2500 × `é` (two bytes each) give 2000 × `é` plus `…` (2001 characters, no panic).

#### 11.1.2 TypeScript mirror (`src/types/k8s.ts`, F5)

```ts
export interface ArgoCdApp {
  // … existing fields unchanged …
  operation_phase: string;
  /** status.operationState.message, for every phase; "" when absent. Trimmed, control characters other than newline and tab removed, cut at 2000 characters with "…" (operation_message_display in argocd.rs). */
  operation_message: string;
  // … existing fields unchanged …
}
```

Required, not optional: Rust always sends it, and no TS fixture builds an `ArgoCdApp` (`grep -rn "operation_phase" src` finds only the type and the panel).

#### 11.1.3 Pure TS helper (`src/utils/argoStatus.ts`, F5)

```ts
export interface ArgoOperationNote { text: string; failed: boolean }
/** What the Overview shows under the "Last operation" pill, or null for nothing. */
export function argoOperationNote(phase: string, message: string): ArgoOperationNote | null;
```

- Q-R1 A: `Failed` and `Error` give `{ text: message, failed: true }` when `message.trim()` is not empty. Every other phase (`Succeeded`, `Running`, `Terminating`, `—`, `""`, a phase the table does not list) gives `null`.
- Q-R1 B adds: `Running` and `Terminating` give `{ text: message, failed: false }` when the message is not empty.
- Phases are matched by own key, like the pill tables (`constructor` gives `null`).

Tests in `argoStatus.test.ts`: Failed and Error with a message; Failed with `""` and with spaces only (null); Succeeded with upstream's sentence (null); Running and Terminating (null under A, `failed: false` under B); `—` and `""` phases (null); `constructor` (null).

#### 11.1.4 Secret values in the message

Decision (Q-R3 asks the user to confirm): the message is shown verbatim, not masked. Reasons:

- The Secret hard rule (`writes.md`, Secret values in the webview) covers Secret objects: their `data`/`stringData` values, revealed per object. `operationState.message` is a field of an Application. The Application's raw YAML tab already shows it unmasked to anyone who can read the Application, and upstream's controller copies the same text into its `OperationCompleted` Warning event (read from upstream source, not seen live; Q8 option B relied on that event).
- The text is free-form: API server and admission webhook refusals, Helm, Kustomize and config-management-plugin output. A Kustomize or plugin error can quote a whole object, so a Secret manifest from git (base64 `data`) can appear in it. No mask can find a value in free text: a pattern would hide good messages, miss bad ones, and read as a guarantee the app cannot give.
- No new path: the message is not written to the app log or the journal and goes nowhere but the webview, where React renders it as text (no `dangerouslySetInnerHTML`).

### 11.2 UI (F5)

Overview (`ResourceDetailPanel.tsx`, `case "argocd"`). The pill stays as it is. The pill row and a new box sit in one `mb-3` wrapper, so the gap to the commit box stays one step. The box renders when `argoOperationNote(a.operation_phase, a.operation_message)` is not null:

- Failed or Error: `mt-2 p-2.5 rounded-lg bg-bad/6 ring-1 ring-bad/30` (the Certificate "Last failure" box's padding, radius, tint and ring, with `mt-2` for its `mt-3`, so a failure has one look in the panel). Eyebrow `text-[10.5px] uppercase tracking-wide text-bad mb-1` reading **Reason** (Q-R5). Message `<p className="text-[12px] text-ink whitespace-pre-wrap wrap-break-word">`: the History message's classes, sans and not mono (`ui.md` G6: no sentences in `mono`), `ink` not `mute` because it is the main content of the box.
- Running or Terminating (Q-R1 B only): the same layout in the commit box's neutral classes `bg-surface-tint/3 ring-1 ring-edge-raw/60`, eyebrow `text-mute` reading **Message**.
- Full text: never clamped, wraps at any character (long object paths), keeps line breaks. No tooltip and no scroll region (a scroll region needs a focus stop). A message that Rust cut ends with `…`; the whole text is in the YAML tab's raw view (the neat view hides `status`).
- No live region: a poll must not announce. The eyebrow and the message are plain text, read in order after the pill.
- The controller's words are quoted as they are (they may say "apply"); our own copy ("Reason", "Message") never says "Apply" (CLAUDE.md).
- No new tab, no change to the Actions card or the Applications list (Q-R4 A).

Live panel (Q-R2 A; nothing under Q-R2 B). Today the ArgoCD panel shows the row as it was when it was clicked, so after a Sync started from the panel fails, neither "Failed" nor the reason appears until the row is clicked again. The fix follows the `ns` precedent (`App.tsx` `panelResource`):

- `useResources.ts`: `useCachedArgoCdApps(context)` = `useQuery<ArgoCdApp[], Error>({ queryKey: ["argocd-apps", context], queryFn: () => invoke<ArgoCdApp[]>("list_argocd_apps", { context }), enabled: false })`. It observes the list's query and never fetches or polls (§1 D5: an always-mounted App observer must not start polling). The Applications view's `useArgoCdApps` stays the only poller.
- `App.tsx` `panelResource` gains an `argocd` arm: the cached row with the same `namespace` and `name` replaces the snapshot; a row that left the list keeps its snapshot.
- The panel's resets are keyed on kind, name and namespace (the `useEffect` on `resource.kind, resourceName(resource), resourceNamespace(resource)`), so the swap keeps the open tab, the sync options and an open dialog. F5 confirms this by reading `ArgoCdActionBar` and `ArgoCdHistoryTab` state before relying on it.
- Effect: the pill, the reason, the header chips and History follow the list (the 30 s poll, or the refetch the Sync mutation's invalidation starts).

### 11.3 Docs and tests, in the same diffs

| File | Change | Owner |
|---|---|---|
| `src-tauri/src/commands/argocd.rs` | The field's and the helper's doc comments (§11.1.1); `operation_message_display_rules` | R4 |
| `src/utils/argoStatus.test.ts` | `argoOperationNote` cases (§11.1.3) | F5 |
| `docs/claude/argocd.md` | Replace the "Not shown (Q8, deferred)" bullet with the shipped rule (field, helper, phases, cap with the YAML tab for the whole text, verbatim and why, Q-R2's live panel). In the tab list's Overview line, add the reason box after the Last operation badge. In the Panel header section's Overview bullet, one sentence on the box. | F5 |
| `docs/claude/key-files.md` | `argocd.rs` row: add `operation_message_display`. `argoStatus.ts` row: add `argoOperationNote`. (Q-R2 A: `App.tsx` row: "live panel row for `ns` and `argocd`".) | F5 |
| `docs/claude/open-items.md` | There is no Q8 entry to remove (`grep -n "Q8" docs/claude/open-items.md` is empty). Add one row under "v2.4.0 deferred" → owed on a real build: a real failed sync (an object the API server refuses, a failing hook, a retrying auto-sync) shows its reason in the Overview with the same text as `argocd app get`; under Q-R2 A, the panel turns Failed without a reselect. | F5 |
| `CHANGELOG.md` `[Unreleased]` | `### Added`: ArgoCD Overview shows why the last sync failed (user terms, one line). Q-R2 A also `### Fixed`: an open ArgoCD panel follows the list instead of keeping the state it was opened with. | F5 |
| `CLAUDE.md` Testing | Name `operation_message_display_rules` and the `argoOperationNote` cases with the v2.4.0 tests | main session at REL2 (agents do not edit CLAUDE.md) |
| `docs/ux/25-v2.4.0-acceptance.md` | New `## 10.` addendum at the end (§11.6 V3) | V3 |

R4 adds no CHANGELOG line: nothing is visible until F5 lands.

### 11.4 Hard-rule check

| Rule | How §11 meets it | Check (owner) |
|---|---|---|
| Additive Tauri params are `Option<T>` | No parameter added | `git diff 66d7406 -- src-tauri/src` shows no `#[tauri::command]` signature change (W5R) |
| ArgoCD health from K8s `.status`, never the Argo CD API; Sync and Health independent | Reads `.status.operationState.message` of the same object; Health and Sync untouched | read the R4 diff; `argoStatus.test.ts` independence tests still pass (W5R) |
| Never hardcode the `argoproj.io` version | No new API call | `git diff` adds no `v1alpha1` (W5R) |
| `panic = "abort"` | §11.1.1 helper; multi-byte over-limit test | `cargo test --lib`; read the helper for `unwrap(`, `expect(`, `[` on the string (W5R) |
| No Secret value without a reveal | §11.1.4 (Q-R3) | read §11.1.4 against `writes.md` (W5R) |
| Components never call `invoke`; data only in `useResources.ts` | Q-R2 hook lives in `useResources.ts` | `grep -n "invoke" src/App.tsx` has no output (W5R) |
| Every cluster write through `invokeWrite` | No write added | `writeBackstop.test.ts` (in `npx vitest run`) |
| Tokens only; `mute` not `dim`; type floor; no sentences in `mono` | §11.2 classes | `ui.md` → Appearance G1, G2, G4, G5, G6 (F5, W5R) |
| UI says "Merge", never "Apply" | Our copy is "Reason" / "Message" | read the diff's strings (W5R) |
| `Patch::Strategic` exactly one hit | Untouched | `grep -rn "Patch::Strategic" src-tauri/src` = 1 (R4, W5R) |

### 11.5 Waves and ownership

| Wave | Task | Agent | Starts after | Owns (exactly) |
|---|---|---|---|---|
| 1 | R4 | rust-engineer | §11.7 answered (Q-R1 to Q-R5 do not change R4; it may start once the user accepts §11.1.1) | `src-tauri/src/commands/argocd.rs` |
| 1 | F5 | frontend-engineer | §11.7 answered | `src/types/k8s.ts`, `src/utils/argoStatus.ts`, `src/utils/argoStatus.test.ts`, `src/components/ResourceDetailPanel.tsx`, `docs/claude/argocd.md`, `docs/claude/key-files.md`, `docs/claude/open-items.md`, `CHANGELOG.md`; with Q-R2 A also `src/hooks/useResources.ts`, `src/App.tsx`. Outside the repo, in the V1 harness `<scratchpad>/visual/`: `fixtures.js`, `mock.js` (only if a scenario flag is needed), `argo8.js` (new), `shots/argo8-*.png`, `logs/argo8-*` |
| 1R | W5R | tech-lead | R4 and F5 committed | checkpoint only |
| 1R | FX7, then FX7R | per finding (rust-engineer for `src-tauri`, frontend-engineer otherwise), then tech-lead | W5R findings | the files the findings name |
| 1V | V3 | senior-ux-specialist | W5R clean (or FX7R clean) and F5's shots taken from the reviewed tree | `docs/ux/25-v2.4.0-acceptance.md` (new §10 at the end only) |
| REL2 | closing commit | main session | V3 ship | `CHANGELOG.md` (`[Unreleased]` into `[2.4.0]`), `CLAUDE.md` Testing line, the ledger |

R4 and F5 share no file and have no ordering constraint: F5 builds against the frozen field name and the harness mocks `invoke`. One-way dependencies: W5R needs R4 and F5 committed; V3 needs W5R clean. A fix batch that changes the UI recaptures the affected shots before V3. `<scratchpad>` is `/tmp/claude-0/-home-user-garita/f4fdec7d-6df0-5838-af75-f4d6d23d0b64/scratchpad`.

### 11.6 Briefs

All of §6.0 applies (Boot, checkpoint `.claude/checkpoints/feat-ns-panel-ux-review/<ID>-<agent>.md`, ownership, no git writes, no agents, ask instead of assuming, gates, docs, report).

**R4. rust-engineer: `operation_message` on `ArgoCdApp`.**
1. Add `OPERATION_MESSAGE_MAX_CHARS`, `operation_message_display` and the field exactly as §11.1.1, with the doc comments.
2. Fill the field in `list_argocd_apps` with the call site in §11.1.1.
3. Add `operation_message_display_rules` to the existing `mod tests` with every case in §11.1.1.
- Gates: `cargo check`; `cargo test --lib`; `cargo clippy --all-targets --locked`; `grep -rn "Patch::Strategic" src-tauri/src` gives one hit; `grep -rn "ArgoCdApp {" src-tauri/src` gives two hits (the struct and the one constructor); the new non-test code has no `unwrap()`, `expect(` or slice indexing.
- No doc and no CHANGELOG edit (F5 owns them; the names are frozen here). The report gives the final helper and constant names so W5R can grep F5's docs against them.

**F5. frontend-engineer: the reason in the ArgoCD Overview.**
1. `types/k8s.ts`: the field (§11.1.2).
2. `argoStatus.ts`: `ArgoOperationNote` and `argoOperationNote` (§11.1.3, the Q-R1 answer); the cases in `argoStatus.test.ts`.
3. `ResourceDetailPanel.tsx`: the box (§11.2, the Q-R1 and Q-R5 answers).
4. Q-R2 A only: `useCachedArgoCdApps` in `useResources.ts` and the `argocd` arm of `panelResource` in `App.tsx` (§11.2). Read `ArgoCdActionBar` and `ArgoCdHistoryTab` first; if any state there is keyed on the item object, stop and report.
5. Docs and CHANGELOG (§11.3, F5 rows).
6. Screenshots with the V1 harness (vite on `:1431`, `npx vite --port 1431 --strictPort` from the repo; never `make dev` or port 1420). Add `operation_message` to the `argoApp` default in `fixtures.js` (`"successfully synced (all tasks run)"`, so a Succeeded app proves the box stays hidden) and messages to existing apps: `legacy-reports` (Failed) a multi-line refusal of an object by the API server; `search-indexer` (Failed) a 2000-character text ending in `…`; one app in phase `Error` with a one-line message (a scenario flag in `mock.js`, or a new fixture app, whichever leaves the earlier captures' list unchanged); a Failed app with `""` (no box); `canary-rollout` (Running) a retry text such as `one or more objects failed to apply … Retrying attempt #2 at 3:04PM.` (box only under Q-R1 B). New script `argo8.js` captures the Overview of each, in light and dark, at 1280×800 and 1024×768, plus under Q-R2 A a before and after pair where the mock flips an open app to Failed and the panel follows without a reselect. Shots `shots/argo8-*.png`, notes `logs/argo8-*.json` (the box's text and computed colours). Do not re-run `marketing.js`: the committed site images stay as they are.
- Gates: §6.0 frontend gates; `ui.md` → Appearance G1, G2, G4, G5, G6 (all clean); `grep -n "invoke" src/App.tsx` has no output; `npx vitest run` includes `writeBackstop.test.ts`.

**W5R. tech-lead: review R4 and F5.** Every check in §11.4; the contract field by field (Rust name and type, TS name and type, `""` never `—`); the helper's tests cover each rule in §11.1.1; the phase rule follows the Q-R1 answer; the docs' claims grep true against the code (`operation_message_display`, `argoOperationNote`, `OPERATION_MESSAGE_MAX_CHARS`, `useCachedArgoCdApps`); one coherent `[Unreleased]` with no line that contradicts `[2.4.0]`. Run `cargo check` and `cargo test --lib` in `src-tauri`, `npm run build`, `npx vitest run`, `node --experimental-strip-types scripts/check-emit.ts`. FX7 and FX7R follow §6's fix-batch rule (every gate re-run).

**V3. senior-ux-specialist: acceptance addendum.** From F5's `shots/argo8-*.png` and `logs/argo8-*.json` (Chromium with sample data, no real cluster), append `## 10. Addendum: ArgoCD sync-failure reason (ARGO-8)` at the end of `docs/ux/25-v2.4.0-acceptance.md`, leaving §0 to §9 unchanged: a verdict (ship, or the defects); per state whether the box appears exactly when §11.1.3 says; the copy; wrapping of the multi-line and the 2000-character message at both widths; contrast of the `text-bad` eyebrow on `bg-bad/6` and of `text-ink` in both themes, computed from `src/index.css`; spacing between the pill, the box and the commit box; under Q-R2 A, the before and after pair; what stays owed on a real build. A defect goes to the main session as an FX7 item with its exact class or copy change.

**REL2. main session.** Move the `[Unreleased]` lines into `[2.4.0]` (one coherent list; keep the release date unless the user says otherwise), add the CLAUDE.md Testing names (§11.3), copy any V3 "owed on a real build" item into `open-items.md` if F5's row does not hold it, record the user's §11.7 answers in §10 of this file, and make the closing commit last with `[skip ci]`. No tag (user decision, 2026-10-29).

### 11.7 Questions for the user

Recommended option first. Q-R1, Q-R2, Q-R4 and Q-R5 block F5 only; Q-R3 blocks F5 and V3. None blocks R4.

**Q-R1. For which phases does the Overview show the message? (blocks F5)** Upstream sets a failing sync with retries configured back to `Running`, with the failure text and "Retrying attempt #N" in the same message (from upstream source, not seen live). With option A such an app shows "Last operation: Running" and no reason.
- B (recommended): Failed and Error in a red "Reason" box; Running and Terminating in a neutral "Message" box. Covers retrying syncs; a plain Running sync shows progress text such as "waiting for healthy state of …".
- A (minimal): Failed and Error only.

**Q-R2. Should the open ArgoCD panel follow the list? (blocks F5 step 4)** Today the panel keeps the row as it was when clicked. After a Sync from the panel fails, neither "Failed" nor the reason appears until you click the row again; this applies to the existing pill and header chips too.
- A (recommended): yes, like the Namespaces panel. Two small changes (`useResources.ts`, `App.tsx`), no extra polling; one CHANGELOG Fixed line.
- B: no; log it in `open-items.md` as a known limit.

**Q-R3. Show the controller's message as it is? (blocks F5, V3)** It is free text and can quote an object from git, in rare cases a Secret manifest. The same text is already in the Application's YAML tab and in its Events.
- A (recommended): show it verbatim (§11.1.4). Secret masking covers Secret objects; free text cannot be masked reliably.
- B: hide it behind a "Show reason" button, per panel, like a Secret reveal. One more click on every failure; the YAML tab still shows it without a click.
- C: mask lines that look like Secret data. Rejected by the tech lead: a pattern misses real values and hides good text.

**Q-R4. Anything in the Applications list? (blocks F5)**
- A (recommended): nothing. The list has no last-operation column; ARGO-8 is about the panel.
- B: a small "Last sync failed" marker after the name, with the reason as its tooltip (new design, needs V3 to check it too).

**Q-R5. The box's heading. (blocks F5)**
- A (recommended): "Reason" (and "Message" for the neutral box under Q-R1 B).
- B: "Why it failed".
- C: no heading; the text sits right under the pill.

### 11.8 Erratum (2026-10-30, W5R)

- An ArgoCD Application panel has no YAML tab: `tabsFor` in `ResourceDetailPanel.tsx` returns Overview, Resources, History, Events and Timeline. The sentences that send the reader to a YAML tab are wrong about the app: §11.1.1 (the cap: "the raw YAML tab keeps the whole text"), §11.1.4 ("The Application's raw YAML tab already shows it unmasked"), §11.2 ("the whole text is in the YAML tab's raw view"), the §11.3 `argocd.md` row ("cap with the YAML tab for the whole text") and Q-R3 with its option B. The whole text is only in the Application object itself (`kubectl get`, the Argo CD UI); the app shows at most 2000 characters.
- User decision (2026-10-30): the note under a cut message is plain text with no link, "Cut at 2000 characters. The full text is in status.operationState.message on the Application." F5 shipped it that way; `isArgoOperationMessageCut` in `argoStatus.ts` decides when it shows.
- §11.1.4 stands without the YAML-tab point: anyone who can read the Application can read the field, and free text cannot be masked reliably. That the same text is in the Application's Events comes from upstream source and is not verified.
- The test is `commands::argocd::rollback_tests::operation_message_display_rules` (the file's only test module), not `argocd::tests::…` as §11.1.1 says.
