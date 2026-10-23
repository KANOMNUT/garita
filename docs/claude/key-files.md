# Key files

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Key Files

### Frontend

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root layout, keyboard shortcuts, React Query wiring, `mainView`, palette actions |
| `src/components/Sidebar.tsx` | Nav, namespace list, context chip, Custom Resources tree |
| `src/components/TopBar.tsx` | Draggable header, search, manual refresh, `RESOURCE_LABELS` |
| `src/components/PodTable.tsx` | Pod list: sort, status tabs, restart pill, bulk ops, CPU/MEM sparklines |
| `src/components/DetailPanel.tsx` | Pod panel (Overview / Summary / Containers / Events / Logs / Shell / YAML / Metrics / Forward). Owns `useDebugSession` and `logView`. Content keyed `pod.name + "-" + tab` (remount on pod or tab change) |
| `src/components/ResourceDetailPanel.tsx` | Panel for every other kind; tabs from `tabsFor()`. Default Overview / Summary / Events / YAML; ArgoCD Overview / Resources / History / Events; Helm Overview / Values / History / Events; workloads add Pods, Logs, Relationships; TLS Secrets add TLS; `Timeline` (v2.2.0) is added for `deploy`, `sts`, `ds`, `helm`, `argocd`. Hosts the editor pencil and delete |
| `src/components/ResourceViews.tsx` | Table views for non-pod kinds |
| `src/components/GenericResourceTable.tsx` | Sortable table with loading/error/empty states; hidden columns in `localStorage["columns-<resourceType>"]` |
| `src/components/ConfirmModal.tsx` | Shared confirm dialog + `ClusterBadge`. See Confirm-on-Destructive |
| `src/components/NodeDrainDialog.tsx` | Drain dialog on `ConfirmModal` `lg`, Override band, nested force-delete dialog |
| `src/hooks/useNodeDrain.ts` | Drain state machine, called from `NodeOverview`; hooks only, never `invoke` |
| `src/utils/updateState.ts` | `UpdateState` and its pure transitions for Settings → Updates and the Sidebar notice (the plugin calls live in `useAppUpdate`, `useResources.ts`) |
| `src/utils/launchArgs.ts` | Pure plan for forwarded launch args (strip lines, deferral, namespace check) |
| `src/utils/cliStatus.ts` | Pure model of `CliStatus` for Settings → Command line |
| `src/utils/drain.ts` | Pure drain helpers; owns the `deleting` / `force-deleted` row states (never in `EvictionOutcome`) |
| `src/utils/modalLayer.ts` | `useModalLayer`, `isModalOpen`, `isEditableTarget`. See Keyboard layering |
| `src/components/Popover.tsx` | The one popover primitive; registers a modal layer |
| `src/components/ObservabilityDialog.tsx` | v2.3.0 per-cluster observability dialog (discovery, Test, Save) and its `ObservabilityDialogHost`. See `pods-logs.md` (External observability), `ui.md` |
| `src/utils/observability.ts` | Validators mirroring `observability.rs`, `LOG_LABEL_PRESETS`, `targetKey` / `probeKey`, `METRIC_RANGES` / `rangeWindow`, `samePlotExceptRange`, `isForbidden`, draft logic, `requestObservabilityDialog` pub/sub |
| `src/components/MetricChart.tsx` / `src/utils/metricChart.ts` | Metric history chart in the pod Metrics tab, and its pure helpers (`splitSegments`, `plotSegments`, `toPercent`, stored range) |
| `src/utils/segmented.ts` | `stepIndex`: the one-step wrap-around index `Segmented` uses for arrow keys |
| `src/utils/rightSizing.ts` | Right-sizing hints; v2.3.0 adds `p95Hints`, `percentile`, `withSessionFallback`, `P95_MIN_POINTS`. See `health.md` |
| `src/components/LogViewer.tsx` / `MultiLogViewer.tsx` | Single-pod and workload log viewers via `startLogStream`; 5,000-line ring buffer; multi-pod caps 20 pods |
| `src/components/LogViewBar.tsx` / `LogLine.tsx` | Log View group and row renderer. See Log viewers |
| `src/utils/logFilter.ts`, `logJson.ts`, `logDownload.ts`, `multiPods.ts`, `logParse.ts`, `logBuffer.ts`, `podStreams.ts`, `containerSelect.ts` | Pure log helpers: filters (match `body`, never timestamp), JSON rows (200 cap), downloads, node/zone narrowing (20 cap), timestamp/level parsing, bounded buffer (`MAX_LOG_LINES` 5000, `useBoundedLines`), per-pod stream state, container pre-select (bridges `init:`) |
| `src/components/ShellTerminal.tsx` / `ShellTab.tsx` | xterm.js shell; Shell tab body (debug strip, end-state cards, read-only state) |
| `src/components/DebugContainerDialog.tsx` / `src/hooks/useDebugSession.ts` / `src/utils/debugContainer.ts` | Debug container dialog, session state, pure rules |
| `src/utils/sessionId.ts` | `newSessionId()` (`randomUUID` or 32-char fallback), `stripShellPrefix` |
| `src/components/Sparkline.tsx` | Inline SVG sparkline |
| `src/components/ResourceCreator.tsx` | Kind-aware create modal (form or templated YAML), Dry run |
| `src/components/create/` | Create forms: `emit.ts` (no React), `fields.tsx`, `registry.ts` (`CREATE_FORM`), `forms/*.tsx`. 23 kinds |
| `src/components/edit/` | Edit forms: `ResourceEditor.tsx`, `patch.ts` (RFC 7386, no React), `quantity.ts`, `transforms.ts`, `registry.ts` (`EDIT_FORM`), `forms/*.tsx`. 19 registrations |
| `src/components/ContextSwitcher.tsx` | Context switcher, identity editor, guardrails |
| `src/components/NodeStrip.tsx` / `ClusterOverview.tsx` | Node usage bars; cluster summary |
| `src/components/MergeFromFileModal.tsx` / `src/utils/mergePreview.ts` | Merge from file; `previewRows` (React-free, arrays `"replaced"`) |
| `src/components/HelmInstallModal.tsx` | `helm install`; Helm is not a `CreatableKind` |
| `src/utils/clusterIdentity.ts` | `localStorage["cluster-identity"]`: colour (`IdentityRole`, legacy names via `LEGACY_IDENTITY_ALIAS`), label, guardrails; `getGuardrailSettings` for the backstop |
| `src/index.css` / `tailwind.config.js` | Colour roles as `--c-*` / `--a-*` variables (dark on `:root`, light and accent blocks) and their Tailwind keys. See `ui.md` Appearance |
| `src/utils/appearance.ts` | `localStorage["appearance"]`, `useAppearance`, `setAppearance`, `initAppearance`; mirrored by the inline script in `index.html` |
| `src/utils/terminalTheme.ts` | xterm theme from the `--c-*` variables (`XTERM_ROLES`); the only file allowed colour literals |
| `src/utils/themeTokens.test.ts` | Reads `index.css` and `tailwind.config.js`: dark parity table, accepted deltas, totality, alpha forms, accent isolation |
| `src/utils/guardrails.ts` | `READ_ONLY_BLOCKS_SHELL`, `assertWritable`, `checkBulk`, `pickDisabledReason`, `disabledAttrs` |
| `src/components/DisabledReasonHost.tsx` | Mounted once; sr-only reason text for `aria-describedby` |
| `src/components/ReadOnlyBadge.tsx` / `GuardrailGate.tsx` / `GuardedActionConfirm.tsx` | Read-only chip/strip/turn-off; guardrails for non-`ConfirmModal` dialogs; `useGuardedAction` |
| `src/utils/kubectlEquiv.ts` / `src/components/KubectlEquivalent.tsx` | kubectl equivalents (slot 6) |
| `src/utils/diffRows.ts` / `src/components/DiffRows.tsx` | The **one** diff helper and renderer |
| `src/components/YamlSaveGate.tsx` / `HelmUpgradeGate.tsx` | PREVIEW-GATE dialogs |
| `src/utils/rolloutDiff.ts` | Rollout template diff for `RolloutHistory` |
| `src/components/ResourceCompareDialog.tsx` / `src/utils/resourceCompare.ts` | Resource compare |
| `src/components/FieldManagers.tsx` / `src/utils/managedFields.ts` | Field managers |
| `src/utils/permissionHints.ts` | Subresource SSAR hints (`pods/eviction`, `pods/ephemeralcontainers`), fail open |
| `src/components/SettingsView.tsx` / `src/utils/diagnostics.ts` | Settings; Diagnostics and Appearance sections |
| `src/components/JournalPage.tsx` / `src/utils/journal.ts` | Journal page; pure `journalKind`, `journalResourceType` (any of the three kind spellings to a `ResourceType`), `filterJournal`, `journalOptions`, result words. `useJournal` pages `list_journal`. See `diagnostics.md` |
| `src/components/WhoCanPage.tsx` / `src/components/PermissionsSection.tsx` / `src/utils/whoCan.ts` | Who can… and the Permissions sections: `parseResourceInput`, `resolveResource`, `groupSubjects`, `whoCanState`, `boundTo`. See `cluster-access.md` |
| `src/components/health/UnusedPage.tsx` / `DeprecatedApisPage.tsx` / `HealthShell.tsx` | v1.4.1 Health pages and the shell shared with `ProblemsPage`. Pure state: `src/utils/unused.ts` (`REQUIRED_SOURCES`, `uncheckedKinds`), `src/utils/deprecations.ts` (`statusOf`, `parseMinor`, `openTarget`) |
| `src/components/SavedSearchMenu.tsx` / `src/utils/savedSearches.ts` | Saved searches per view (`localStorage["saved-searches"]`). See `ui.md` |
| `src/utils/kindToResourceType.ts` | `KIND_TO_RESOURCE_TYPE`, `RESOURCE_LABELS` |
| `src/utils/secretReveal.ts` / `src/hooks/secretCache.test.ts` | #33: `HELM_REDACTION_SENTINEL`, `formatSecretSize`, `helmEditSeed`; tests for `secretReadOptions` / `forgetSecret` / `forgetHelmValues` (which live in `useResources.ts`) |
| `src/utils/scope.ts` | `CLUSTER_SCOPED_KINDS`, `resourceNamespace()`, `viewHidesNamespacePicker()` |
| `src/utils/resourceQueryKey.ts` | `RESOURCE_QUERY_KEY`, `HEALTH_QUERY_KEY`, `HEALTH_PAGES` |
| `src/utils/viewState.ts` / `src/components/ViewState.tsx` | Not installed / No access / Nothing here |
| `src/components/health/` / `src/utils/problems.ts` | Problems and Node capacity pages, `FindingRow`, `ExplainCard`; `RULES` table |
| `src/components/graph/` / `src/utils/graphLayout.ts` | `GraphCanvas` (keyboard canvas), `GraphList` (list fallback); `layout`, `rankColumns`, `layoutKey`, `readingOrder` (own layered layout, no dependency) |
| `src/components/health/MapPage.tsx` / `NetpolView.tsx` / `src/utils/resourceMap.ts` / `src/utils/netpolEval.ts` | The Map page and its Network policies (approximation) mode. Pure: `prepareMap`, `groupPods`, `MAP_COLUMN`, `SKIPPED_COPY`, `mapState`; `evaluateNetpol`, `podReach` |
| `src/components/WhoCanReachSection.tsx` | Pod panel section "Who can reach this pod (approximation)" |
| `src/components/TimelineTab.tsx` / `src/utils/timeline.ts` | Change timeline tab; pure `mergeTimeline`, `groupByDay`, `parseTs`, `TIMELINE_KINDS` |
| `src/utils/capacity.ts` / `nodeLabels.ts` / `rightSizing.ts` / `constraints.ts` | Health helpers; `SizingHint.tsx`, `ConstraintsSection.tsx` render them |
| `src/utils/expiry.ts` | The one certificate-expiry rule |
| `src/hooks/useActiveContext.ts` | App-local active context, validated against `list_contexts()` |
| `src/hooks/useResources.ts` | All React Query hooks, `invokeWrite`, `startLogStream`, `RBAC_RESOURCE` |
| `src/hooks/useResizablePanel.ts` | Shared panel width hook |
| `src/types/k8s.ts` | TS types mirroring Rust structs |
| `vitest.config.ts` | Vitest (`node` env, `src/**/*.test.ts(x)`); `npm test` |

### Rust Backend

| File | Purpose |
|------|---------|
| `src-tauri/src/lib.rs` | Setup, `generate_handler![]`, `fix_path()`; the single-instance plugin is registered first |
| `src-tauri/src/launch.rs` | Launcher grammar: `parse_launch_args`, `normalize_kind` (the one kind table), `valid_namespace`, `help_text`, `ignored_warning`, `CLI_COMMAND_NAME`. Pure, panic-free. See `launcher.md` |
| `src-tauri/src/main.rs` | Help/version before the builder, Windows console attach, Unix detach, stderr warnings |
| `src-tauri/src/commands/launcher.rs` | `get_launch_args`, pending slot (`set_pending`, pure `take`) |
| `src-tauri/src/commands/cli.rs` | `get_cli_status`, `install_cli_command`; pure `decide_status`, `plan_install` |
| `src-tauri/windows/hooks.nsh`, `path.wxs` | NSIS user-PATH hooks and the MSI system-PATH fragment (wired in `tauri.conf.json` `bundle.windows`) |
| `site/scoop/garita.json` | Scoop manifest template; `pages.yml` renders it from the latest release |
| `src-tauri/src/commands/pods.rs` | Pods (`containers_status`, `ephemeral_containers`, `default_container` annotation verbatim), `get_pod` (404 → `None`), logs and `stream_pod_logs`, `delete_resource`, `get_resource_yaml` / `_neat`, `apply_resource_yaml` / `preview_resource_yaml` via one `replace_resource_yaml`, `start_debug_container` (only `Patch::Strategic`), `list_pod_metrics` |
| `src-tauri/src/commands/nodes.rs` | Nodes (CPU%/MEM% of allocatable), cordon/uncordon/delete/taints. No `drain_node` |
| `src-tauri/src/commands/drain.rs` | `preview_node_drain`, `evict_pod` (Eviction API only) |
| `src-tauri/src/commands/deployments.rs` | `list_deployments` only |
| `src-tauri/src/commands/workloads.rs` | StatefulSets, DaemonSets, Jobs, CronJobs, ReplicaSets; `build_pod_template()` |
| `src-tauri/src/commands/workload_actions.rs` | Scale, restart, pause/resume, rollout history (`RevisionInfo.template`), rollback (strips `pod-template-hash`) |
| `src-tauri/src/commands/workload_pods.rs` | `list_workload_pods` |
| `src-tauri/src/commands/networking.rs` | Services (per-namespace fallback), Ingresses, NetworkPolicies, Endpoints, EndpointSlices |
| `src-tauri/src/commands/rbac.rs` | ServiceAccounts, Roles, ClusterRoles, bindings (rows carry `subject_list`); `who_can`, `subject_permissions`, pure `rule_matches` / `compute_who_can` / `compute_permissions`. See `cluster-access.md` |
| `src-tauri/src/commands/config_storage.rs` | ConfigMaps, Secrets, PVCs, PVs, StorageClasses, VolumeSnapshots |
| `src-tauri/src/commands/helm.rs` | Helm list/values/upgrade/preview/install/rollback/history/uninstall (shell-out) |
| `src-tauri/src/commands/shell.rs` | Exec/attach shell sessions, `shell-output-{id}` / `shell-closed-{id}` |
| `src-tauri/src/commands/portforward.rs` | Pod and Service port-forward (binds `127.0.0.1`) |
| `src-tauri/src/commands/hpa.rs`, `pdb.rs`, `quotas.rs` | HPA; PDBs (`match_labels`); ResourceQuotas, LimitRanges, PriorityClasses |
| `src-tauri/src/commands/crds.rs` | CRDs and `list_crd_resources` |
| `src-tauri/src/commands/context.rs` | `list_contexts`, `get_current_context` |
| `src-tauri/src/commands/kubeconfig.rs` | App-local kubeconfig registry, `load_merged_kubeconfig()` |
| `src-tauri/src/commands/apply_file.rs` | Merge from file; `split_yaml_documents`; plurals via discovery |
| `src-tauri/src/commands/access.rs` | `can_i` (fails open) |
| `src-tauri/src/commands/admission.rs` | Mutating/validating webhooks; `WebhookConfigRow.matches` |
| `src-tauri/src/commands/namespaces.rs` | Namespaces |
| `src-tauri/src/commands/cluster_info.rs` | Cluster metadata, `check_cluster_access`, `list_events`, `get_resource_events(…, kind: Option<String>)` |
| `src-tauri/src/commands/argocd.rs` | ArgoCD apps/appsets/projects/repos, sync/refresh/rollback, `k8s_resource_health()`, `argo_api_resource()` |
| `src-tauri/src/commands/flux.rs`, `gateway.rs`, `certmanager.rs` | CRD lists via `DynamicObject`; empty on 404 |
| `src-tauri/src/commands/search.rs` | `search_resources` |
| `src-tauri/src/commands/graph.rs` | `get_resource_graph` |
| `src-tauri/src/commands/map.rs` | `get_resource_map`: pure edge functions (`owner_edges`, `selector_edges`, `ingress_edges`, `route_edges`, `volume_edges`, `env_edges`, `hpa_edges`), `build_map`, `limit_component`, `INJECTED_CONFIGMAPS`, `NODE_CEILING`. See `ui.md` → Resource map |
| `src-tauri/src/commands/netpol.rs` | `get_network_policy_model`: `policy_model`, `pod_labels`, defaulted `policy_types`. The semantics are frontend-side (`netpolEval.ts`) |
| `src-tauri/src/commands/observability.rs` | v2.3.0 shared half: `ServiceTarget`, `proxy_path`, `proxy_get` (`classify`, `read_capped`, tenant header), `discover_observability` |
| `src-tauri/src/commands/prometheus.rs` | `query_metric_range` (closed template set), `probe_observability_backend` (pure `outcome`) |
| `src-tauri/src/commands/logs_backend.rs` | `query_backend_logs` for Loki and VictoriaLogs; `label_preset` |
| `src-tauri/src/commands/resource_create.rs` | `create_resource_from_yaml` |
| `src-tauri/src/commands/resource_edit.rs` | `get_resource_json`, `patch_resource`, `gvk_for` |
| `src-tauri/src/commands/tls_cert.rs` | `get_tls_certificate_info` (panic-free parser) |
| `src-tauri/src/commands/presence.rs`, `problems.rs`, `capacity.rs` | Health. See `health.md` |
| `src-tauri/src/commands/extras.rs` | `trigger_cronjob`, `create_namespace`, `delete_namespace`, `get_resource_metadata`, `get_workload_conditions` (unknown kinds return empty) |
| `src-tauri/src/commands/diagnostics.rs` / `src-tauri/src/app_log.rs` | Log settings commands and `list_journal`; the app log: scrub, `rotate_file` (shared with the journal), `log_write(context, verb, kind, ns, name, payload, result)`. See `diagnostics.md` |
| `src-tauri/src/journal.rs` | Action journal: `journal_summary`, `entry_line`, `page`, `append`, `read`. Written by `log_write`, not level-gated, never panics. See `diagnostics.md` |
| `src-tauri/src/commands/unused.rs` | `list_possibly_unused`, pure `find_unused` over `Option` inputs. See `health.md` |
| `src-tauri/src/commands/deprecations.rs` / `src-tauri/data/deprecated-apis.json` | `scan_deprecated_apis`, `match_deprecations`, the embedded table. See `health.md` |
| `src-tauri/src/commands/utils.rs` | `client_for_context`, `invalidate_client_cache`, `friendly_auth_error`, `age_from_timestamp` / `format_age`, `parse_cpu_millis`, `parse_mem_bytes` / `parse_mem_mib` |
| `src-tauri/capabilities/default.json` | Tauri capabilities |
| `src-tauri/capabilities/updater-macos.json` | macOS-only `updater:allow-download`, `updater:allow-install`, `process:allow-restart`; `default.json` has only `updater:allow-check`. See `build-and-release.md` → In-app updater |
