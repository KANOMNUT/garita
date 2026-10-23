# ArgoCD

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## ArgoCD

Applications are namespaced `argoproj.io/Application` CRDs read via `DynamicObject`, listed cluster-wide. The API version is discovered at runtime (see ArgoCD Lens Parity). `tabsFor()` returns four tabs:

- **Overview**: status badges, commit box, fields, Sync/Refresh action bar.
- **Resources**: `status.resources[]` with Sync and Health; 21 standard kinds are clickable; own Refresh / Hard Refresh.
- **History**: `status.history[]`, each with "Roll back to this revision…" → `rollback_argocd_app(context, namespace, name, historyId)`, keyed by `ArgoCdHistoryEntry.id` (React key too). The backend reads revision and source(s) from the live object; the display string is never sent. Disabled with a reason when `ArgoCdApp.auto_sync`. `short_revision` shortens **only** a 40-hex SHA to 7 chars; other values (chart versions, `HEAD`, tags) pass through; multi-source shows `revisions[]` joined with `, `.
- **Events**: K8s events for the app.

**Click-to-navigate:** `ArgoCdResourcesTab` maps kinds via `KIND_TO_RESOURCE_TYPE` and calls `onNavigate(kind, namespace, name)`. `App.tsx` sets `navigateSearchRef.current = name` before `setActiveResource` / `setNamespace`, so the target page opens with the name in the search box.

**Commit metadata** is fetched lazily with three fallbacks: port-forward plain HTTP → K8s API proxy anonymous → K8s proxy with JWT from `argocd-initial-admin-secret`.

### Resource Health — K8s-native computation

ArgoCD v2.8+ (`resourceHealthSource: appTree`) keeps per-resource health only in controller memory (REST API, auth required). So `get_argocd_app_resources` computes health **from K8s `.status`** via `k8s_resource_health()`, per `(group, kind)`. **Never call the ArgoCD REST API for health.**

| Kind | Healthy when | Other states |
|---|---|---|
| `apps/Deployment` | `Available=True` + `availableReplicas >= spec.replicas` | replicas 0 Suspended; `Progressing=True` Progressing; else Degraded |
| `apps/StatefulSet` | `readyReplicas >= spec.replicas` | else Progressing |
| `apps/DaemonSet` | `numberReady >= desiredNumberScheduled`, no misscheduled | misscheduled > 0 Degraded |
| `apps/ReplicaSet` | `readyReplicas >= spec.replicas` | else Progressing |
| `core/Pod` | `Running` + `Ready=True`, or `Succeeded` | `Failed` Degraded; `Pending` Progressing |
| `core/PersistentVolumeClaim` | `Bound` | `Lost` Degraded; `Pending` Progressing |
| `core/Service` | LoadBalancer with ingress; ClusterIP/NodePort/ExternalName always | LB without IP Progressing |
| `autoscaling/HorizontalPodAutoscaler` | `AbleToScale=True` + `ScalingActive=True` | `AbleToScale=False` Degraded |
| `networking.k8s.io/Ingress` | has `status.loadBalancer.ingress` | else Progressing |
| `batch/Job` | `Complete=True` | `Failed=True` Degraded; else Progressing |
| everything else | always Healthy (no fetch) | Sync shows drift |

Fetch failure (resource deleted since reconcile): `Missing`. `kind_to_plural()` handles irregular plurals for `ApiResource`.

**Sync and Health are independent; never collapse or fall back one to the other.** Sync (`status.resources[].status`) = does the cluster match git. Health (K8s `.status`) = does it work. A hand-edited ConfigMap goes `OutOfSync` after the next reconcile (~3 min) and stays `Healthy`.

The Resources tab Refresh / Hard Refresh call `useRefreshArgoCdApp`, which invalidates `["argocd-apps", context]` and `["argocd-app-resources", context, ns, name]`.

## ArgoCD UX Redesign (v0.9.3)

Overview, Resources and Events were reorganised. Architecture unchanged: local health, independent Sync/Health, three-strategy commit fetch.

## ArgoCD Lens Parity (v1.0.0)

- Commands `list_argocd_appsets`, `list_argocd_projects`, `list_argocd_repositories`: `context` only, cluster-wide via `Api::all_with`.
- **Runtime version discovery:** `argo_api_resource(client, kind, plural)` uses `kube::discovery::group(client, "argoproj.io")` + `recommended_kind`. Only `DiscoveryError::MissingApiGroup` means "not installed" → `Ok(None)` (lists return empty; the four mutations return a clear `Err`). Every other error propagates. **Never hardcode a version matrix.** (Flux, Gateway, cert-manager and the `pods.rs` arms still hardcode one version each.)
- `ResourceType` gains `argo-appsets`, `argo-projects`, `argo-repos`. Only the first two are in `SelectedResource`; repos have no detail panel, no `tabsFor()` branch, no `get_resource_yaml` arm.
- **Repositories:** Secrets labelled `argocd.argoproj.io/secret-type in (repository, repo-creds)` in the ArgoCD namespace, falling back to `argocd-cm` `repositories`. **Return an allowlist of non-secret fields only.** `auth_method` is derived from which keys exist: `sshPrivateKey` "ssh", `password` "https", `githubAppPrivateKey` "github-app", else "none".
- **7-bucket health strip** in `ArgoCDView` (Total / Synced / Healthy / OutOfSync / Degraded / Missing / Progressing) as filter cards. "Healthy" = `health_status === "Healthy"` alone.
- Columns: **Destination** (`dest_namespace`, `dest_server` tooltip); **Revision** shows `last_commit` (synced SHA), `target_revision` secondary.
- **Bulk sync/refresh:** multi-select with shift-range, `Promise.allSettled`. **Bulk sync always sends `prune: false, dryRun: false, force: false`**; prune is single-app only.
- **"Managed by"** in the Summary tab, precedence: `annotations["argocd.argoproj.io/tracking-id"]` (segment before first `:`) → `labels["argocd.argoproj.io/instance"]` → `labels["app.kubernetes.io/instance"]` (shown as "possibly managed by"; Helm sets it too). ArgoCD's default tracking is `label`, so `get_resource_metadata` returns `{ annotations, labels }`.
- **Prune risk before confirm:** `ArgoCdResource.requires_pruning`; `ArgoCdActionBar` shows `⚠ prune will delete N resources` and lists them.
- Cut, do not re-add: Settings > Clusters view, "Open Argo CD UI" button, AI assist, a separate GitOps dashboard page, per-kind summary cards. Recent-activity timeline deferred (events expire in ~1 h).

### ArgoCD CRD write contract (immutable)

No REST API, no client library, so these shapes are hand-written and fail silently:

- **Sync = `.operation`**, JSON merge patch.
- **Force = `operation.sync.syncStrategy.hook.force`.** `SyncOperation` has no `force` field (`operation.sync.force` is a silent no-op). Use `hook`, not `apply`: `IsApplyStrategy()` makes gitops-engine skip sync hooks.
- **Omit `revision`** unless the caller passes one, so `targetRevision` applies. Hardcoding `"HEAD"` synced tag-pinned apps to HEAD. Omission also handles multi-source apps (`revisions[]`).
- **Guard:** reject when `.operation` is already non-null. Check `.operation` presence, **not** `operationState.phase` (right after a patch, phase still shows the previous `Succeeded`). Without it, the controller resumes the in-flight op and discards the new options.
- **Refresh = annotation** `argocd.argoproj.io/refresh` = `normal` | `hard`; the controller removes it.
- `dryRun: true` still reports through `status.operationState`.
- **Rollback is the only sanctioned `syncStrategy.apply`** (upstream `Rollback` parity). `rollback_argocd_app` restores the entry's full revision **and** `source` (or `sources` + `revisions`), sets `syncStrategy: { apply: {} }`, `prune: false`, `dryRun: false`, copies `spec.syncPolicy.syncOptions` only when non-empty. **Never align sync and rollback.** No `force` key in a rollback patch. Pure `build_rollback_patch` guards in order: operation in progress → auto-sync enabled → no entry with that `id` → entry has no source (Argo CD ≤ v1.4). Auto-sync enabled = `spec.syncPolicy.automated` is an object whose `enabled` is not `false` (`auto_sync_enabled`, also fills `ArgoCdApp.auto_sync`).
- Verify changes to `sync_argocd_app` / `refresh_argocd_app` against upstream source, never memory. Live-cluster confirmation is still owed.
