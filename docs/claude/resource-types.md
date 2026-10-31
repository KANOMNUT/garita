# Resource types and per-kind tables

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Resource Types

Every listable kind is a row below. `ResourceType` (`src/types/k8s.ts`) has one more member, `crd-instances`: a *view* (the objects of one CRD, opened from the CRDs page), absent from `SelectedResource` and every per-kind table. **Scoped** = how Kubernetes scopes the object, not how Garita lists it.

| kind | Resource | Scoped |
|------|----------|--------|
| `pods` | Pod | namespace |
| `deploy` | Deployment | namespace |
| `sts` | StatefulSet | namespace |
| `ds` | DaemonSet | namespace |
| `jobs` | Job | namespace |
| `cron` | CronJob | namespace |
| `hpa` | HorizontalPodAutoscaler | namespace |
| `pdb` | PodDisruptionBudget | namespace |
| `rs` | ReplicaSet | namespace |
| `svc` | Service | namespace |
| `ing` | Ingress | namespace |
| `netpol` | NetworkPolicy | namespace |
| `gw` | Gateway | namespace |
| `httproute` | HTTPRoute | namespace |
| `ep` | Endpoints | namespace |
| `eps` | EndpointSlice | namespace |
| `cm` | ConfigMap | namespace |
| `sec` | Secret | namespace |
| `pvc` | PersistentVolumeClaim | namespace |
| `cert` | cert-manager Certificate | namespace |
| `rq` | ResourceQuota | namespace |
| `lr` | LimitRange | namespace |
| `vs` | VolumeSnapshot | namespace; CRD `snapshot.storage.k8s.io/v1`, empty when absent |
| `sa` | ServiceAccount | namespace |
| `roles` | Role | namespace |
| `rbindings` | RoleBinding | namespace |
| `events` | Event | namespace |
| `pv` | PersistentVolume | cluster |
| `sc` | StorageClass | cluster |
| `nodes` | Node | cluster |
| `ns` | Namespace | cluster; page + panel, deleted through `delete_namespace` (no `delete_resource` arm) |
| `crd` | CRD | cluster |
| `pc` | PriorityClass | cluster |
| `mwc` | MutatingWebhookConfiguration | cluster |
| `vwc` | ValidatingWebhookConfiguration | cluster |
| `croles` | ClusterRole | cluster |
| `crbindings` | ClusterRoleBinding | cluster |
| `helm` | Helm Release | namespace (via helm) |
| `argocd` | ArgoCD Application | **namespace**, listed cluster-wide via `Api::all_with` |
| `argo-appsets` | ArgoCD ApplicationSet | namespace, listed cluster-wide |
| `argo-projects` | ArgoCD AppProject | namespace, listed cluster-wide |
| `argo-repos` | ArgoCD Repository | namespace, listed cluster-wide; no detail panel |
| `flux-ks` | Flux Kustomization | namespace |
| `flux-hr` | Flux HelmRelease | namespace |

**`argocd` and its three siblings are namespaced objects.** Listing cluster-wide is a list strategy, not a scope. `resourceNamespace()` returns `resource.ns` for them (Events tab and guided edit depend on it); `gvk_for` marks `argocd` `namespaced: true`. Treating them as cluster-scoped sends `Api::all_with` on a write path and 404s.

`resourceNamespace(resource): string | null` (`src/utils/scope.ts`) returns **`null`**, never `""`, for cluster-scoped kinds (`pv`, `sc`, `nodes`, `ns`, `crd`, `croles`, `crbindings`, `pc`, `mwc`, `vwc`). `ResourceEditor` takes `namespace: string`, so callers coerce; `resource_edit.rs`'s `require_namespace()` turns a bad coercion into a readable error. `get_resource_yaml` / `apply_resource_yaml` use `fetch_all!` / `replace_all!` for these kinds.

## Adding a New Resource Type

1. Rust command in `src-tauri/src/commands/<resource>.rs`.
2. Register in `lib.rs` `tauri::generate_handler![]`.
3. TS type in `src/types/k8s.ts`; add to `ResourceType`.
4. `get_resource_yaml` / `apply_resource_yaml` arms in `pods.rs`.
5. `Column<T>[]` + view component in `ResourceViews.tsx`.
6. Nav item in `Sidebar.tsx`. If the **view** should hide the namespace picker, extend `viewHidesNamespacePicker` (`src/utils/scope.ts`). Not the same question as object scope (see below).
7. Route/case in `App.tsx`.
8. `RESOURCE_QUERY_KEY` entry (`src/utils/resourceQueryKey.ts`). Refresh, `useDeleteResource`, `usePatchResource` and `useApplyResource` (a YAML Save) read it. Missing = silent no-op invalidation.
9. `delete_resource` arm in `pods.rs` if deletable. Omitting it is supported: `GenericResourceTable` delete is opt-in via `onDelete`. `ep` / `eps` have none (controller-owned). `ns` has none on purpose: a namespace deletes through `delete_namespace` (`useDeleteNamespace`, one typed `DeleteNamespaceConfirm` hosted in `App.tsx`), and the panel's generic delete confirm excludes `ns`.
10. If the object is cluster-scoped, add it to `CLUSTER_SCOPED_KINDS` (`src/utils/scope.ts`). That one set feeds `resourceNamespace()`, the detail-panel delete confirm and `viewHidesNamespacePicker`. **It must equal the Rust `gvk_for` non-namespaced set**; `resource_edit.rs` and `scope.test.ts` test each side.
11. `RESOURCE_LABELS` (`src/utils/kindToResourceType.ts`), `kindLabel`, `isHealthy`, `OverviewContent` case, `NAV_ITEMS` row (`CommandPalette.tsx`). `tsc` catches the first three, not the last two.
12. Optional create form: `CREATE_FORM` (`src/components/create/registry.ts`) + `resourceTemplates.ts`.
13. Optional edit form: `gvk_for` row (`resource_edit.rs`) **and** `EDIT_FORM` entry (`src/components/edit/registry.ts`). A `gvk_for` row alone has no UI; an `EDIT_FORM` entry alone fails at runtime. New kinds usually need the `gvk_for` row anyway (compare, field managers).

**Map (v2.2.0):** a kind that should appear on the resource map touches both sides.
- **Rust (`map.rs`, nothing checks these):** a `Sources` field, its list in `get_resource_map` and its node status in `map_nodes`; the `own!` owner list in `build_map` and any edge function that should reach the kind.
- **TS (`types/k8s.ts`, `utils/resourceMap.ts`):** a `MapKind` member (documented as a subset of `ResourceType`, not enforced: `MapPage` casts `n.kind as ResourceType`); a `MapSource` member and its `SKIPPED_COPY` row for the list; `MAP_COLUMN`, `KIND_LABEL`, `KIND_PLURAL`, `KIND_SOURCE` and `KIND_GROUPS`.
- **What `tsc` catches:** the `Record<MapKind, …>` tables (`MAP_COLUMN`, `KIND_LABEL`, `KIND_PLURAL`, `KIND_SOURCE`), and `SKIPPED_COPY` only once `MapSource` has the member (a missing source is not caught). `KIND_GROUPS` is a plain array: a kind missing there is left out of `ALL_KINDS`, so the Kinds list never offers it and `countByKind` counts it as `NaN`.

No form is a supported state: `ResourceCreator` falls back to YAML; the panel shows no pencil. Without a form, still add the `resourceTemplates.ts` entry, or ⌘N opens an empty textarea.

**Hook shape:** list key `[key, context, namespace]` (cluster-scoped: `[key, context]`), `enabled: !!context`, a `refetchInterval`. Writes use `invokeWrite` and invalidate through `RESOURCE_QUERY_KEY`. A namespaced kind whose list query is cluster-wide (no namespace in the key) must be in `CLUSTER_WIDE_LIST_QUERY` (`useResources.ts`; today `argo-appsets`, `argo-projects`), or delete/patch invalidation never matches. QueryClient defaults: `retry: 2`, `refetchOnWindowFocus: false`.

**Verify by hand** (no compiler covers these): open the panel's YAML tab; if the kind is editable, the pencil form must load the live object; delete a row and ⌘N-create one, and the list must refresh by itself.

### The five silent tables

A kind missing from any of these **degrades silently**, no compile error:

| # | Table | File | Effect if missing |
|---|---|---|---|
| 1 | `get_resource_yaml` / `apply_resource_yaml` | `commands/pods.rs` | YAML tab errors |
| 2 | `delete_resource` | `commands/pods.rs` | `unsupported resource type` |
| 3 | `gvk_for` | `commands/resource_edit.rs` | `get_resource_json` / `patch_resource` fail; also field managers, compare, YAML Save preview. Covers every `get_resource_yaml` kind except `argo-appsets` / `argo-projects`; editability is decided only by `EDIT_FORM` |
| 4 | `RESOURCE_QUERY_KEY` | `src/utils/resourceQueryKey.ts` | Refresh/invalidation silently does nothing |
| 5 | `resourceNamespace()` / `CLUSTER_SCOPED_KINDS` | `src/utils/scope.ts` | Cluster-scoped kind sends a namespace on writes |

### Other per-kind sites

Do not hard-code a total; the next kind makes it stale.

| Site | Where | `tsc` catches? |
|---|---|---|
| `RESOURCE_LABELS` | `src/utils/kindToResourceType.ts` | Yes (`Record<ResourceType, string>`); also the launcher's list of kinds the frontend accepts (`launchArgs.ts`) |
| `kindLabel()` | `ResourceDetailPanel.tsx` | Yes (`Record<SelectedResource["kind"], string>`) |
| `EVENT_INVOLVED_KIND` | `ResourceDetailPanel.tsx` | Yes. Kind sent to `get_resource_events`; `null` = no filter (`helm`). `flux-ks` → `Kustomization`, `flux-hr` → `HelmRelease`, `argocd` → `Application` |
| `isHealthy()` | `ResourceDetailPanel.tsx` | Yes (explicit `: boolean`, no `default`) |
| `OverviewContent` switch | `ResourceDetailPanel.tsx` | **No**: inferred return widens to `undefined`, panel renders blank |
| `CLUSTER_SCOPED_KINDS` | `src/utils/scope.ts` | No (`ReadonlySet<string>`) |
| `viewHidesNamespacePicker` | `src/utils/scope.ts` | No |
| `WORKLOAD_KINDS` | `ResourceDetailPanel.tsx` | No; drives Pods/Logs/Relationships tabs |
| `RBAC_RESOURCE` | `useResources.ts` | No (`Partial<Record>`); missing = `usePermissions` fails open (intended) |
| `NAV_ITEMS` | `CommandPalette.tsx` | No; kind unreachable from ⌘K |
| `EXCLUDED` in `canCompare` | `src/utils/resourceCompare.ts` | No; a new kind gets Compare and Field managers unless excluded |

### Two "cluster-scoped" predicates, deliberately different

| Predicate | Members | Question |
|---|---|---|
| `resourceNamespace()` returns `null` | `CLUSTER_SCOPED_KINDS`: `pv`, `sc`, `nodes`, `ns`, `crd`, `croles`, `crbindings`, `pc`, `mwc`, `vwc` | Is the **object** cluster-scoped? Drives the detail panel and every write path |
| `viewHidesNamespacePicker(view, crdNamespaced?)` (called by `TopBar.tsx`) | the set above + `argocd`, `argo-appsets`, `argo-projects`, `argo-repos`, and `crd-instances` **only when the selected CRD is cluster-scoped** | Should the **view** hide the picker? |

`argocd` proves the difference: picker hidden (listed cluster-wide), object namespaced. Never use the picker predicate on a write path. Health pages use neither; their picker rule is `HEALTH_PAGES` (`resourceQueryKey.ts`).

## Services — All-Namespaces Fallback

`list_services` tries `Api::all()`, then lists per namespace if denied (GKE may block cluster-wide list). It counts `attempted` / `succeeded`: `attempted > 0 && succeeded == 0` returns `Err("Failed to list services: forbidden in all N namespaces")`. Partial success returns `Ok`.

CRD-backed views get Not installed / No access / Nothing here from `list_api_presence` + the list query (`src/utils/viewState.ts`, `ViewState.tsx`; see `health.md`).

**Knowingly kept, do not "fix":**
- `list_pod_metrics` swallows all errors to `Ok(Vec::new())` (sparklines only; metrics API absence is graceful by contract).
- 404-to-empty arms in `flux.rs` / `gateway.rs` / `certmanager.rs` / `list_volume_snapshots` mean "CRD not installed". 401/403 still return `Err`.

## StorageClass — k8s-openapi Layout

`StorageClass` fields sit directly on the struct: `sc.provisioner`, `sc.reclaim_policy`, `sc.volume_binding_mode`, `sc.allow_volume_expansion`. There is no `sc.spec`.

## Flux v2 Support (v0.8.0)

`flux.rs`: `list_flux_kustomizations`, `list_flux_helmreleases` via `DynamicObject`. Health: `Ready=True` Healthy; suspended Suspended; Progressing reason Progressing; else Degraded. Empty list when CRDs are absent. Sidebar: GitOps.

## Gateway API Support (v0.8.0)

`gateway.rs`: `list_gateways`, `list_http_routes` via `DynamicObject`, `gateway.networking.k8s.io/v1`. Health: `Programmed=True` Healthy; `Accepted=False` Degraded. Empty when CRDs are absent. Sidebar: Networking.

## ResourceQuota / LimitRange / PriorityClass (v0.8.0)

`quotas.rs`, typed. PriorityClass is cluster-scoped (`Api::all()`). `LimitRange.spec.limits` is `Vec<LimitRangeItem>`, not `Option`. Sidebar: RQ/LR under Config & Storage, PC under Cluster.

## Coverage — six kinds (v1.2.0) and CRD instances (v2.4.1)

| kind | Rust file | API | Delete arm | cluster-scoped |
|---|---|---|---|---|
| `ep` | `networking.rs` | `core/v1` | **no** | no |
| `eps` | `networking.rs` | `discovery.k8s.io/v1` | **no** | no |
| `rs` | `workloads.rs` | `apps/v1` | yes | no |
| `mwc` | `admission.rs` | `admissionregistration.k8s.io/v1` | yes (`delete_all!`) | yes |
| `vwc` | `admission.rs` | `admissionregistration.k8s.io/v1` | yes (`delete_all!`) | yes |
| `vs` | `config_storage.rs` | `snapshot.storage.k8s.io/v1` `DynamicObject` | yes | no |

- None has a create or edit form.
- `ep` / `eps` have no delete: controller-owned, deleting is a no-op that looks like success. `canDelete` in `ResourceDetailPanel` excludes them too.
- `ep` and `eps` are knowingly redundant (EndpointSlice is authoritative since 1.21). If one is dropped, drop `ep`.
- `rs` gets Pods/Logs (`workload_pods.rs` has an `rs` arm) but **not** Relationships: `graph.rs` has no `rs` arm, so the tab would poll an error every 30 s. `rs` is in `WORKLOAD_KINDS` and filtered out by `hasRelationships`; both places must agree.
- Leases were cut: hundreds of kubelet/controller rows nobody browses.

### CRD instances and the custom resource panel

`crd-instances` is a `ResourceType` member, **not** a `SelectedResource` member. Only `RESOURCE_QUERY_KEY` has it (`"crd-resources"`). **A custom resource is not a `SelectedResource` member either** (plan D2): it has a runtime group, version and kind, while the five silent tables and the `Record<SelectedResource["kind"], …>` tables (`kindLabel`, `EVENT_INVOLVED_KIND`, `isHealthy`) are keyed by a static kind, and `get_resource_yaml` / `delete_resource` have no dynamic arm. So no per-kind table has a row for a custom resource, and "Adding a New Resource Type" does not apply to one. Its panel is its own component, `CustomResourcePanel.tsx` (the Pod panel is the precedent), and `CRDResource` stays `{ name, namespace, age }`: identity only.

**Entry.** There is no Sidebar tree. The only ways in are the **Instances** button on a CRDs page row and the **Show instances** link in the CRD panel's Overview; both call `openCrdInstances` in `App.tsx`, which sets `crdTarget` and `activeResource = "crd-instances"`. The Sidebar's **CRDs** row is active on both `crd` and `crd-instances`, and the Sidebar no longer observes `useCRDs`. A context switch clears `crdTarget` while `activeResource` stays, so the view shows "Pick a CRD on the CRDs page to see its objects." with an **Open CRDs** button.

**Panel host rule (plan D3).** `selectedCr` (a `CustomResourceSelection`: the CRD plus the listed object) lives in `App.tsx`, apart from `selectedResource` and `selectedPod`. The panel renders only while `activeResource === "crd-instances"` and `selectedCr.crd.name === crdTarget.name`, so a stale selection never shows a panel for another CRD. `setSelectedCr(null)` runs in the `[namespace, activeResource]` effect, the context-switch effect, the Esc branch, the panel's `onClose` and `onNavigate`, and after its object is deleted.

**Commands** (`commands/crds.rs`), reached only through hooks in `useResources.ts`: `get_custom_resource`, `get_custom_resource_yaml`, `get_custom_resource_yaml_neat`, `preview_custom_resource_yaml`, `apply_custom_resource_yaml`, `delete_custom_resource`. `apply_custom_resource_yaml` and `delete_custom_resource` are writes; `preview_custom_resource_yaml` is their dry run, a read like `preview_resource_yaml` (`writes.md` → Custom resources). All take the CRD's `group, version, kind, plural, scope` **flat** (`crdRef(crd)` in `src/utils/crds.ts`, spread into the arguments, so the names cannot drift between commands) plus `namespace` and `name` (and `yaml` for preview and apply). The scope comes from the CRD, never from the namespace value; `namespace` is `""` for a cluster-scoped object. `get_custom_resource` returns an `Option`: a 404 is `Ok(None)` so the panel can say the object is gone instead of showing an error box. The YAML reads answer a missing object with an `Err`. The new commands' parameters are required (new commands with one caller each), and no existing command gained a parameter.

**One read version.** `CRD.read_version` is the storage version when it is served, else the first served version, and `""` when none is served (`read_version` in `crds.rs`); `list_crds` sends it beside `versions`. `crdReadVersion(crd)` (`src/utils/crds.ts`) is the one place the frontend picks the version: `useCRDResources` and the `useCustomResource*` read hooks use it, and `crdRef` sends it. It falls back to the first served entry of `versions` when `read_version` is missing, so a backend that does not send it keeps working. No other code splits `versions`. The row's **Instances** button and the **Show instances** link are disabled, with a reason, when the CRD is not established or has no served version (`crdInstancesReason`).

**`cr_request` runs first in every one of these commands**, before `client_for_context`. kube-core pastes group, version, namespace, plural and name into the request path without encoding them, and these commands take them from the webview, so `cr_request` is **defense in depth**, not the Secret mechanism: the webview is not a security boundary (it can already call `get_resource_yaml`, which reads Secrets by design behind the UI gates). It does two things.
- It refuses an empty API group. A CRD always has a group; without the refusal, `group: ""` with `plural: "secrets"` would read, replace or delete a core Secret with no reveal, no masking and none of the Secret rules.
- It keeps every value inside its URL segment, so a malformed or hostile call cannot steer the path (for example `group: "x/../../api"`). Values that came from the cluster always pass. `kind` never enters the URL and gets no format check.

The checks run in this order, and the first failure wins: an empty group; an empty version, kind, plural or name; an invalid group, version, plural or name; the scope; `require_namespace`; an invalid namespace (namespaced only, a cluster-scoped request ignores its namespace). The group must be a DNS subdomain of at least two labels (at most 253 bytes); the version, plural and namespace must be DNS-1123 labels (`is_dns1123_label`, `pods.rs`); the name is 1 to 253 characters, not `.` or `..`, with none of `/ % ? #` and no control or whitespace character. The name rule is wider than DNS on purpose: the API server owns the exact naming rules (an RBAC name may contain `:`), the check only keeps the name inside its segment. The messages describe a bad request, not a failed read or write, so the write commands return them too, with `{Kind}` (or "custom resource" when the kind is empty):
- `Failed to get {Kind}: a custom resource needs an API group`
- `Failed to get {Kind}: missing {version|kind|plural|name}`
- `Failed to get {Kind}: invalid API group '…'`, `invalid version '…'`, `invalid plural '…'`, `invalid name '…'`, `invalid namespace '…'`
- `Failed to get {Kind}: unknown scope '…'`
- `{Kind} is namespace-scoped and requires a namespace` (the `require_namespace` message)

`list_crd_resources` takes `namespace: Option<String>` and the pure `crd_list_namespace()` decides the scope (the old two arms were identical, so namespaced CRDs ignored the picker). It is `Option`, not `String`, because the existing caller did not send it: a bare `String` errors `missing required key namespace` at runtime. **Every additive or optional Tauri parameter is `Option<T>`.**
