import { useQuery, useMutation, useQueryClient, useInfiniteQuery, type QueryClient } from "@tanstack/react-query";
import { useRef, useEffect, useState, useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, HPA, CRD, CRDResource,
  Service, Ingress, ConfigMap, Secret, TlsCertInfo, PersistentVolumeClaim, PersistentVolume,
  NodeResource, ClusterInfo, K8sEvent, KubeContext, KubeconfigEntry, ClusterAccess, PodMetricsResult, PortForwardEntry,
  RevisionInfo, ResourceCondition, ServiceAccountRow, RBACRole, ClusterRole,
  RoleBinding, ClusterRoleBinding, NetworkPolicyRow, HelmRelease, StorageClassRow,
  ApiPresence, ProblemReport, NodeCapacity, PdbRow, ArgoCdApp, ArgoCdResource, Certificate,
  FluxKustomization, FluxHelmRelease, GatewayInfo, HttpRouteInfo,
  ResourceQuotaInfo, LimitRangeInfo, PriorityClassInfo, SearchResult,
  PodUsage, GraphNode, ResourceType,
  ArgoCdAppSet, ArgoCdProject, ArgoCdRepository, ResourceMetadata,
  DocPreview, ApplyResult, HelmRevision, HelmRepo, AccessCheck, AccessResult,
  EndpointsRow, EndpointSliceRow, ReplicaSetRow, WebhookConfigRow, VolumeSnapshotRow,
  DrainPreview, EvictionResult, LogStreamEvent, NeatYaml, PropagationPolicy,
  LaunchArgs, CliStatus, YamlSavePreview, HelmUpgradePreview, LogSettings, AppLogLevel, JournalEntry, WhoCanResult, RuleGrant, UnusedReport, DeprecationReport, ResourceMap, NetpolModel,
  NamespaceRow, ServiceTarget, LogsTarget, MetricTemplate, MetricRangeId, MetricRange, ObservabilityDiscovery, ObservabilityKind, BackendProbe, BackendLogs,
} from "../types/k8s";
import { METRIC_RANGES, rangeWindow, samePlotExceptRange, targetKey } from "../utils/observability";
import { newUsageHistory, recordUsage, type UsageHistory } from "../utils/rightSizing";
import { RESOURCE_QUERY_KEY } from "../utils/resourceQueryKey";
import { isTerminating, namespaceNames } from "../utils/namespaces";
import { assertWritable, READ_ONLY_BLOCKS_SHELL } from "../utils/guardrails";
import {
  canCheck, DEFAULT_PREFS, parsePrefs, reduce, UPDATES_KEY, updateMode,
  type UpdateEvent, type UpdatePrefs, type UpdateState,
} from "../utils/updateState";

// ─── Write backstop (v1.3.1 F4, C-8) ─────────────────────────────────────────
// Every command that CHANGES cluster state goes through invokeWrite(), which refuses
// while read-only mode is on for the call's `context` — so a call site the UI missed
// cannot bypass the mode. The property is greppable: a write command name appears only
// as the first argument of invokeWrite (plus startShellSession below, which guards
// itself because D3-7 is a switch).
//
// EXEMPT, with reasons: preview_* and can_i (reads); the kubeconfig registry, diagnostics
// and settings (app-local, and must stay reachable so read-only can be turned off);
// port-forward start/stop (opens a local listener, changes no cluster object);
// write_to_shell / resize_shell / stop_shell_session (act on an already-open session —
// turning read-only on ends those sessions instead, §0.5).
//
// Dry-run calls (patch_resource, create_resource_from_yaml, install_helm_release,
// apply_yaml_documents, sync_argocd_app) are guarded too: the dialogs that issue them
// cannot open while read-only is on, so a dry run there would be a missed entry point.
function invokeWrite<T>(command: string, args: { context: string } & Record<string, unknown>): Promise<T> {
  try {
    assertWritable(args.context);
  } catch (e) {
    return Promise.reject(e);
  }
  return invoke<T>(command, args);
}

// ─── Context ─────────────────────────────────────────────────────────────────

export function useKubeContexts() {
  return useQuery<KubeContext[], Error>({
    queryKey: ["contexts"],
    queryFn: () => invoke<KubeContext[]>("list_contexts"),
    staleTime: 30_000,
  });
}

/** RB-3b: true when a previous install's config dir exists. A read (no context), so not invokeWrite. */
export function detectLegacyInstall(): Promise<boolean> {
  return invoke<boolean>("detect_legacy_install");
}

export function useCurrentContext() {
  return useQuery<string, Error>({
    queryKey: ["current-context"],
    queryFn: () => invoke<string>("get_current_context"),
    staleTime: 10_000,
  });
}

// switch_context is DELETED (docs/plan-kubeconfig-and-parity.md §1.5) — the app
// no longer rewrites the user's kubeconfig. Switching context is now synchronous
// local state; see useActiveContext.ts. Query keys are [kind, context, ...]-shaped,
// so a context change already invalidates by changing the key — no manual
// invalidation list needed.

// ─── Kubeconfig registry (Phase 1 — de-anchoring) ───────────────────────────
// docs/plan-kubeconfig-and-parity.md §1.7–1.8. The registry lives Rust-side;
// these hooks are thin wrappers. preview_* never writes — only add_* does.

export function useKubeconfigs() {
  return useQuery<KubeconfigEntry[], Error>({
    queryKey: ["kubeconfigs"],
    queryFn: () => invoke<KubeconfigEntry[]>("list_kubeconfigs"),
    staleTime: 30_000,
  });
}

function invalidateKubeconfigQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["kubeconfigs"] });
  qc.invalidateQueries({ queryKey: ["contexts"] });
}

export function usePreviewKubeconfigPath() {
  return useMutation<KubeconfigEntry, Error, string>({
    mutationFn: (path) => invoke<KubeconfigEntry>("preview_kubeconfig_path", { path }),
    retry: false,
  });
}

export function usePreviewKubeconfigYaml() {
  return useMutation<KubeconfigEntry, Error, string>({
    mutationFn: (yaml) => invoke<KubeconfigEntry>("preview_kubeconfig_yaml", { yaml }),
    retry: false,
  });
}

export function useAddKubeconfigPath() {
  const qc = useQueryClient();
  return useMutation<KubeconfigEntry, Error, string>({
    mutationFn: (path) => invoke<KubeconfigEntry>("add_kubeconfig_path", { path }),
    onSuccess: () => invalidateKubeconfigQueries(qc),
  });
}

export function useAddKubeconfigYaml() {
  const qc = useQueryClient();
  return useMutation<KubeconfigEntry, Error, { yaml: string; name: string }>({
    mutationFn: ({ yaml, name }) => invoke<KubeconfigEntry>("add_kubeconfig_yaml", { yaml, name }),
    onSuccess: () => invalidateKubeconfigQueries(qc),
  });
}

export function useRemoveKubeconfig() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (path) => invoke<void>("remove_kubeconfig", { path }),
    onSuccess: () => invalidateKubeconfigQueries(qc),
  });
}

export function useSetKubeconfigEnabled() {
  const qc = useQueryClient();
  return useMutation<void, Error, { path: string; enabled: boolean }>({
    mutationFn: ({ path, enabled }) => invoke<void>("set_kubeconfig_enabled", { path, enabled }),
    onSuccess: () => invalidateKubeconfigQueries(qc),
  });
}

// ─── Namespaces ──────────────────────────────────────────────────────────────

// ONE query for every namespace consumer: key ["namespaces", ctx], data NamespaceRow[]. Every reader spreads
// namespaceRowsQuery, so no queryFn on that key can put another shape (names, say) into the cache that the
// picker and the Namespaces page read as rows. The names-only readers add a `select`.
export const namespaceRowsQuery = (context: string) => ({
  queryKey: ["namespaces", context] as const,
  queryFn: () => invoke<NamespaceRow[]>("list_namespace_rows", { context }),
  staleTime: 60_000,
});

/**
 * Rows for the Namespaces page (`poll`: 5 s while any row is Terminating, else 30 s) and the picker
 * (no interval). Only the page polls, so the always-mounted observers in App and the forms never start
 * app-wide polling.
 */
export function useNamespaceRows(context: string, poll?: boolean) {
  return useQuery<NamespaceRow[], Error>({
    ...namespaceRowsQuery(context),
    enabled: !!context,
    refetchInterval: poll
      ? (query) => (query.state.data?.some(isTerminating) ? 5_000 : 30_000)
      : false,
  });
}

/** Names only: the same query as `useNamespaceRows` with a `select`, so the form and page call sites keep their shape. */
export function useNamespaces(context: string) {
  return useQuery<NamespaceRow[], Error, string[]>({
    ...namespaceRowsQuery(context),
    enabled: !!context,
    select: namespaceNames,
  });
}

// ─── Trust states — cluster access probe (Phase 2, §2.1) ────────────────────
// Returns Ok even for failures; `state` carries the result. `retry: false`
// because a retried unreachable-cluster call just delays the banner for no gain.

export function useClusterAccess(context: string) {
  return useQuery<ClusterAccess, Error>({
    queryKey: ["cluster-access", context],
    queryFn: () => invoke<ClusterAccess>("check_cluster_access", { context }),
    enabled: !!context,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

// ─── Cluster Info ─────────────────────────────────────────────────────────────

export function useClusterInfo(context: string) {
  return useQuery<ClusterInfo, Error>({
    queryKey: ["cluster-info", context],
    queryFn: () => invoke<ClusterInfo>("get_cluster_info", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

// ─── Workloads ───────────────────────────────────────────────────────────────

export function usePods(context: string, namespace: string) {
  return useQuery<Pod[], Error>({
    queryKey: ["pods", context, namespace],
    queryFn: () => invoke<Pod[]>("list_pods", { context, namespace }),
    enabled: !!context,
    refetchInterval: 15_000,
  });
}

export function useDeployments(context: string, namespace: string) {
  return useQuery<Deployment[], Error>({
    queryKey: ["deployments", context, namespace],
    queryFn: () => invoke<Deployment[]>("list_deployments", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useStatefulSets(context: string, namespace: string) {
  return useQuery<StatefulSet[], Error>({
    queryKey: ["statefulsets", context, namespace],
    queryFn: () => invoke<StatefulSet[]>("list_statefulsets", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useDaemonSets(context: string, namespace: string) {
  return useQuery<DaemonSet[], Error>({
    queryKey: ["daemonsets", context, namespace],
    queryFn: () => invoke<DaemonSet[]>("list_daemonsets", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useJobs(context: string, namespace: string) {
  return useQuery<Job[], Error>({
    queryKey: ["jobs", context, namespace],
    queryFn: () => invoke<Job[]>("list_jobs", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useCronJobs(context: string, namespace: string) {
  return useQuery<CronJob[], Error>({
    queryKey: ["cronjobs", context, namespace],
    queryFn: () => invoke<CronJob[]>("list_cronjobs", { context, namespace }),
    enabled: !!context,
    refetchInterval: 60_000,
  });
}

export function useHPAs(context: string, namespace: string) {
  return useQuery<HPA[], Error>({
    queryKey: ["hpas", context, namespace],
    queryFn: () => invoke<HPA[]>("list_hpas", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

// ─── Networking ──────────────────────────────────────────────────────────────

export function useServices(context: string, namespace: string) {
  return useQuery<Service[], Error>({
    queryKey: ["services", context, namespace],
    queryFn: () => invoke<Service[]>("list_services", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useIngresses(context: string, namespace: string) {
  return useQuery<Ingress[], Error>({
    queryKey: ["ingresses", context, namespace],
    queryFn: () => invoke<Ingress[]>("list_ingresses", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

// ─── Config & Storage ────────────────────────────────────────────────────────

export function useConfigMaps(context: string, namespace: string) {
  return useQuery<ConfigMap[], Error>({
    queryKey: ["configmaps", context, namespace],
    queryFn: () => invoke<ConfigMap[]>("list_configmaps", { context, namespace }),
    enabled: !!context,
    refetchInterval: 60_000,
  });
}

export function useSecrets(context: string, namespace: string) {
  return useQuery<Secret[], Error>({
    queryKey: ["secrets", context, namespace],
    queryFn: () => invoke<Secret[]>("list_secrets", { context, namespace }),
    enabled: !!context,
    refetchInterval: 60_000,
  });
}

// One-shot lazy fetch on TLS tab open — mirrors useResourceYaml/useHelmValues.
// Backend contract: src-tauri/src/commands/tls_cert.rs (frozen in
// docs/plan-tls-cert-and-context-new.md §1.2).
export function useTlsCertificateInfo(
  context: string, namespace: string, name: string, enabled: boolean,
) {
  return useQuery<TlsCertInfo[], Error>({
    queryKey: ["tls-cert-info", context, namespace, name],
    queryFn: () => invoke<TlsCertInfo[]>("get_tls_certificate_info", { context, namespace, name }),
    enabled: enabled && !!context && !!namespace && !!name,
    staleTime: 60_000,
    retry: false,
  });
}

export function usePVCs(context: string, namespace: string) {
  return useQuery<PersistentVolumeClaim[], Error>({
    queryKey: ["pvcs", context, namespace],
    queryFn: () => invoke<PersistentVolumeClaim[]>("list_pvcs", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function usePVs(context: string) {
  return useQuery<PersistentVolume[], Error>({
    queryKey: ["pvs", context],
    queryFn: () => invoke<PersistentVolume[]>("list_pvs", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useStorageClasses(context: string) {
  return useQuery<StorageClassRow[], Error>({
    queryKey: ["storageclasses", context],
    queryFn: () => invoke<StorageClassRow[]>("list_storage_classes", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

// ─── Nodes ───────────────────────────────────────────────────────────────────

export function useNodes(context: string) {
  return useQuery<NodeResource[], Error>({
    queryKey: ["nodes", context],
    queryFn: () => invoke<NodeResource[]>("list_nodes", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useNodeMetricsHistory(context: string) {
  const result = useNodes(context);
  const cpuHistory = useRef<Map<string, number[]>>(new Map());
  const memHistory = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    if (!result.data) return;
    result.data.forEach((node) => {
      if (node.cpu_percent != null) {
        const arr = cpuHistory.current.get(node.name) ?? [];
        cpuHistory.current.set(node.name, [...arr, node.cpu_percent].slice(-20));
      }
      if (node.mem_percent != null) {
        const arr = memHistory.current.get(node.name) ?? [];
        memHistory.current.set(node.name, [...arr, node.mem_percent].slice(-20));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.dataUpdatedAt]);

  return { ...result, cpuHistory: cpuHistory.current, memHistory: memHistory.current };
}

export function usePodMetricsHistory(context: string, namespace: string) {
  const result = useQuery<PodUsage[], Error>({
    queryKey: ["pod-metrics-batch", context, namespace],
    queryFn: () => invoke<PodUsage[]>("list_pod_metrics", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
  // Rings keyed "namespace/pod" and "namespace/pod/container" (see rightSizing.ts): a bare pod
  // name collided across namespaces when the picker is "all". Same 20-sample ring as before.
  const history = useRef<UsageHistory>(newUsageHistory());

  const [, setSamples] = useState(0);
  useEffect(() => {
    if (!result.data) return;
    recordUsage(history.current, result.data);
    // The rings are mutated in place: this render is what shows the new sample (otherwise the
    // render that receives the metrics still reads an empty ring and a cell keeps its "req" label).
    setSamples((n) => n + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.dataUpdatedAt]);

  const h = history.current;
  return { cpuHistory: h.podCpu, memHistory: h.podMem, containerCpuHistory: h.ctrCpu, containerMemHistory: h.ctrMem };
}

export function useResourceGraph(
  context: string,
  namespace: string,
  kind: string,
  name: string,
  enabled: boolean,
) {
  return useQuery<GraphNode[], Error>({
    queryKey: ["resource-graph", context, namespace, kind, name],
    queryFn: () => invoke<GraphNode[]>("get_resource_graph", { context, namespace, kind, name }),
    enabled: enabled && !!context && !!kind && !!name,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useCRDs(context: string) {
  return useQuery<CRD[], Error>({
    queryKey: ["crds", context],
    queryFn: () => invoke<CRD[]>("list_crds", { context }),
    enabled: !!context,
    refetchInterval: 60_000,
  });
}

export function useNodePods(context: string, node: string, enabled: boolean) {
  return useQuery<Pod[], Error>({
    queryKey: ["node-pods", context, node],
    queryFn: () => invoke<Pod[]>("list_pods_on_node", { context, node }),
    enabled: enabled && !!context && !!node,
    refetchInterval: 15_000,
  });
}

export function useWorkloadPods(
  context: string,
  namespace: string,
  kind: string,
  name: string,
  enabled: boolean,
) {
  return useQuery<Pod[], Error>({
    queryKey: ["workload-pods", context, namespace, kind, name],
    queryFn: () => invoke<Pod[]>("list_workload_pods", { context, namespace, kind, name }),
    enabled: enabled && !!context && !!namespace && !!kind && !!name,
    refetchInterval: 15_000,
  });
}

export function useCRDResources(
  context: string,
  crd: CRD | null,
  enabled: boolean,
  // Backend ignores this unless scope === "Namespaced" (crds.rs). Omitted by the
  // CRD detail-panel caller, which deliberately lists cluster-wide.
  namespace?: string,
) {
  const version = crd?.versions.split(",")[0].trim() ?? "";
  return useQuery<CRDResource[], Error>({
    queryKey: ["crd-resources", context, crd?.name, version, namespace ?? ""],
    queryFn: () => invoke<CRDResource[]>("list_crd_resources", {
      context,
      group:   crd!.group,
      version,
      kind:    crd!.kind,
      plural:  crd!.plural,
      scope:   crd!.scope,
      namespace,
    }),
    enabled: enabled && !!context && !!crd && !!version,
    refetchInterval: 30_000,
  });
}

export function usePodMetrics(context: string, namespace: string, pod: string, enabled: boolean) {
  return useQuery<PodMetricsResult, Error>({
    queryKey: ["pod-metrics", context, namespace, pod],
    queryFn: () => invoke<PodMetricsResult>("get_pod_metrics", { context, namespace, pod }),
    enabled: enabled && !!context && !!namespace && !!pod,
    refetchInterval: 15_000,
    retry: 0,
  });
}

export function useApplyResource() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; namespace: string; resourceType: string; name: string; yaml: string }>({
    mutationFn: ({ context, namespace, resourceType, name, yaml }) =>
      invokeWrite<void>("apply_resource_yaml", { context, namespace, resourceType, name, yaml }),
    onSuccess: (_d, { resourceType, context, namespace }) => {
      qc.invalidateQueries({ queryKey: [resourceType, context, namespace] });
      // The list key, as a prefix like useDeleteResource: the line above matches no list key for most kinds, so a saved
      // list stayed stale until its next poll. Active queries only refetch.
      const listKey = RESOURCE_QUERY_KEY[resourceType as ResourceType];
      if (listKey) qc.invalidateQueries({ queryKey: [listKey, context] });
      qc.invalidateQueries({ queryKey: ["resource-yaml"] });
    },
  });
}

// ─── v1.3.1 previews (PREVIEW-GATE). Reads: exempt from the write backstop. ──────
// A mutation, not a query: a preview is a one-shot snapshot for ONE dialog open, never
// cacheable, and `retry: false` so a hung dry run is not silently repeated.

export function usePreviewResourceYaml() {
  return useMutation<
    YamlSavePreview,
    Error,
    { context: string; namespace: string; resourceType: string; name: string; yaml: string }
  >({
    mutationFn: ({ context, namespace, resourceType, name, yaml }) =>
      invoke<YamlSavePreview>("preview_resource_yaml", { context, namespace, resourceType, name, yaml }),
    retry: false,
  });
}

export function usePreviewHelmUpgrade() {
  return useMutation<
    HelmUpgradePreview,
    Error,
    { context: string; namespace: string; release: string; valuesYaml: string }
  >({
    mutationFn: ({ context, namespace, release, valuesYaml }) =>
      invoke<HelmUpgradePreview>("preview_helm_upgrade", { context, namespace, release, valuesYaml }),
    retry: false,
  });
}

// ─── Events ──────────────────────────────────────────────────────────────────

export function useEvents(context: string, namespace: string) {
  return useQuery<K8sEvent[], Error>({
    queryKey: ["events", context, namespace],
    queryFn: () => invoke<K8sEvent[]>("list_events", { context, namespace }),
    enabled: !!context,
    refetchInterval: 15_000,
  });
}

export function usePodEvents(context: string, namespace: string, podName: string, enabled: boolean) {
  return useQuery<K8sEvent[], Error>({
    queryKey: ["pod-events", context, namespace, podName],
    queryFn: () => invoke<K8sEvent[]>("get_pod_events", { context, namespace, podName }),
    enabled: enabled && !!context && !!namespace && !!podName,
    staleTime: 10_000,
  });
}

// ─── Pod actions ─────────────────────────────────────────────────────────────

export function useDeletePod() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; namespace: string; podName: string }>({
    mutationFn: ({ context, namespace, podName }) =>
      invokeWrite<void>("delete_pod", { context, namespace, podName }),
    onSuccess: (_d, { context, namespace }) => {
      qc.invalidateQueries({ queryKey: ["pods", context, namespace] });
    },
  });
}

export interface BulkDeleteResult {
  ok: number;
  failed: { name: string; error: string }[];
}

export function useBulkDeletePods() {
  const qc = useQueryClient();
  return useMutation<BulkDeleteResult, Error, { context: string; namespace: string; name: string }[]>({
    mutationFn: async (pods) => {
      // Once, up front: per-row refusals would be N identical rejected rows.
      if (pods.length > 0) assertWritable(pods[0].context);
      const results = await Promise.allSettled(
        pods.map((p) => invokeWrite<void>("delete_pod", { context: p.context, namespace: p.namespace, podName: p.name }))
      );
      const failed = results
        .map((r, i) => ({ r, name: pods[i].name }))
        .filter(({ r }) => r.status === "rejected")
        .map(({ r, name }) => ({
          name,
          error: (r as PromiseRejectedResult).reason != null
            ? ((r as PromiseRejectedResult).reason as any)?.message ?? String((r as PromiseRejectedResult).reason)
            : "Unknown error",
        }));
      return { ok: results.length - failed.length, failed };
    },
    onSettled: (_d, _e, pods) => {
      if (pods.length > 0) {
        qc.invalidateQueries({ queryKey: ["pods", pods[0].context, pods[0].namespace] });
      }
    },
  });
}

export function usePodLogs(context: string, namespace: string, pod: string, container: string, enabled: boolean) {
  return useQuery<string, Error>({
    queryKey: ["pod-logs", context, namespace, pod, container],
    queryFn: () => invoke<string>("get_pod_logs", { context, namespace, pod, container, tailLines: 200 }),
    enabled: enabled && !!context && !!namespace && !!pod && !!container,
    staleTime: 5_000,
    refetchInterval: false,
  });
}

// #33 (B-2): one read rule for every webview Secret read. Spread LAST so it wins.
export function secretReadOptions(kind: string) {
  return kind === "sec" ? { gcTime: 0, staleTime: 0, retry: false } : {};
}

// Removal is the guarantee, gcTime: 0 the backup. Exactly the four Secret read keys (B-2).
export function forgetSecret(qc: QueryClient, context: string, namespace: string, name: string) {
  for (const queryKey of [
    ["secret-reveal", context, namespace, name],
    ["resource-json", "sec", context, namespace, name],
    ["resource-yaml", "sec", context, namespace, name],
    ["resource-yaml", "neat", "sec", context, namespace, name],
  ]) qc.removeQueries({ queryKey });
}

export function forgetHelmValues(qc: QueryClient, context: string, namespace: string, release: string) {
  qc.removeQueries({ queryKey: ["helm-values", context, namespace, release, "revealed"] });
}

// Reveal = one whole-object fetch, mounted in the panel ROOT (an unobserved gcTime: 0 query is dropped at once).
export function useRevealedSecret(context: string, namespace: string, name: string, enabled: boolean) {
  return useQuery<Record<string, any>, Error>({
    queryKey: ["secret-reveal", context, namespace, name],
    queryFn: () => invoke<Record<string, any>>("get_resource_json", { context, namespace, resourceType: "sec", name }),
    enabled: enabled && !!context && !!name,
    ...secretReadOptions("sec"),
  });
}

export function useResourceYaml(
  kind: string, context: string, namespace: string, name: string, enabled: boolean,
) {
  return useQuery<string, Error>({
    queryKey: ["resource-yaml", kind, context, namespace, name],
    queryFn: () => invoke<string>("get_resource_yaml", { context, namespace, resourceType: kind, name }),
    enabled: enabled && !!context && !!name,
    staleTime: 30_000,
    ...secretReadOptions(kind),
  });
}

// #6 neat YAML — DISPLAY ONLY. The key sits under ["resource-yaml", …] so every
// existing "resource-yaml" invalidation (apply, patch) refreshes it too. Its data
// must never reach the editor seed or apply_resource_yaml: the YAML tabs seed the
// editor from useResourceYaml (get_resource_yaml) and nothing else.
export function useResourceYamlNeat(
  kind: string, context: string, namespace: string, name: string, enabled: boolean,
) {
  return useQuery<NeatYaml, Error>({
    queryKey: ["resource-yaml", "neat", kind, context, namespace, name],
    queryFn: () => invoke<NeatYaml>("get_resource_yaml_neat", { context, namespace, resourceType: kind, name }),
    enabled: enabled && !!context && !!name,
    staleTime: 30_000,
    ...secretReadOptions(kind),
  });
}

// ─── Guided edit (v1.1.0) — raw live object + RFC 7386 merge patch ──────────
// docs/plan-guided-edit.md §4.4. `get_resource_json` returns the raw API
// object (unlike the display-shaped list structs) so ResourceEditor can diff
// a clone-and-mutated copy against it. staleTime: 0 + retry: false because
// an edit must diff against *now*, not a 30s-stale cache — a stale `live`
// would silently resurrect fields the server already dropped or changed.
export function useResourceJson(
  context: string, namespace: string, kind: string, name: string, enabled: boolean,
) {
  return useQuery<Record<string, any>, Error>({
    queryKey: ["resource-json", kind, context, namespace, name],
    queryFn: () => invoke<Record<string, any>>("get_resource_json", { context, namespace, resourceType: kind, name }),
    enabled: enabled && !!context && !!name,
    staleTime: 0,
    retry: false,
    ...secretReadOptions(kind),
  });
}

export function usePatchResource() {
  const qc = useQueryClient();
  return useMutation<
    string,
    Error,
    { context: string; namespace: string; resourceType: ResourceType; name: string; patch: Record<string, any>; dryRun?: boolean }
  >({
    mutationFn: ({ context, namespace, resourceType, name, patch, dryRun = false }) =>
      invokeWrite<string>("patch_resource", { context, namespace, resourceType, name, patch, dryRun }),
    onSuccess: (_d, { context, namespace, resourceType, dryRun }) => {
      // A real dry run changed nothing server-side — skip invalidation.
      // Besides being a pointless refetch, invalidating unconditionally
      // here is what would wipe ResourceEditor's `next` (its clone of the
      // live object) out from under the user while the modal is
      // deliberately still open after a dry run. The one case that DOES
      // need invalidation despite `dryRun` being requested — the backend
      // silently ignored the flag and mutated for real — is handled by
      // ResourceEditor itself, which invalidates manually in that branch.
      if (dryRun) return;
      const queryKey = RESOURCE_QUERY_KEY[resourceType];
      if (queryKey) {
        const keys = [queryKey, context];
        if (namespace && !CLUSTER_WIDE_LIST_QUERY[resourceType]) keys.push(namespace);
        qc.invalidateQueries({ queryKey: keys });
      }
      qc.invalidateQueries({ queryKey: ["resource-yaml"] });
      qc.invalidateQueries({ queryKey: ["resource-json"] });
    },
  });
}

// `kind` is the involvedObject Kind (e.g. "Deployment"); null/undefined = no
// kind filter (Helm releases, which are not a Kubernetes kind). Without it a
// Deployment and a Service that share a name pollute each other's Events tab.
// The Rust param is Option<String>, so null is the correct "absent".
export function useResourceEvents(
  context: string, namespace: string, name: string, enabled: boolean, kind?: string | null,
) {
  return useQuery<K8sEvent[], Error>({
    queryKey: ["resource-events", context, namespace, name, kind ?? null],
    queryFn: () => invoke<K8sEvent[]>("get_resource_events", { context, namespace, name, kind: kind ?? null }),
    enabled: enabled && !!context && !!name,
    staleTime: 10_000,
  });
}

// ─── Node actions ─────────────────────────────────────────────────────────────

export function useCordonNode() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; node: string }>({
    mutationFn: ({ context, node }) => invokeWrite<void>("cordon_node", { context, node }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["nodes", context] }); },
  });
}

export function useUncordonNode() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; node: string }>({
    mutationFn: ({ context, node }) => invokeWrite<void>("uncordon_node", { context, node }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["nodes", context] }); },
  });
}

// v1.2.1: drain_node (which fell back to delete when a PDB refused) is gone.
// The drain is driven from the frontend, one pod at a time: cordon_node →
// preview_node_drain → evict_pod per pod. See hooks/useNodeDrain.ts.
//
// A query-options factory rather than a hook so useNodeDrain can
// queryClient.fetchQuery() a FRESH preview (after the cordon) without calling
// invoke() itself — only this file talks to Tauri. staleTime/gcTime 0: a
// preview is a point-in-time snapshot and must never be served from cache.
export function drainPreviewQuery(context: string, node: string) {
  return {
    queryKey: ["drain-preview", context, node] as const,
    queryFn: () => invoke<DrainPreview>("preview_node_drain", { context, node }),
    staleTime: 0,
    gcTime: 0,
    retry: false as const,
  };
}

// No refetchInterval on purpose: this is a one-shot snapshot the user can
// Refresh by hand, not a live resource list.
export function useDrainPreview(context: string, node: string, enabled: boolean) {
  return useQuery<DrainPreview, Error>({
    ...drainPreviewQuery(context, node),
    enabled: enabled && !!context && !!node,
  });
}

// Deliberately NO per-pod invalidation: useNodeDrain invalidates once, when a
// pass settles. Per-pod invalidation would refetch the node/pod lists N times
// during a drain.
export function useEvictPod() {
  return useMutation<EvictionResult, Error, { context: string; namespace: string; name: string }>({
    mutationFn: ({ context, namespace, name }) =>
      invokeWrite<EvictionResult>("evict_pod", { context, namespace, name }),
  });
}

export function useDeleteNode() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; node: string }>({
    mutationFn: ({ context, node }) => invokeWrite<void>("delete_node", { context, node }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["nodes", context] }); },
  });
}

export function useAddNodeTaint() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; node: string; key: string; value: string; effect: string }>({
    mutationFn: ({ context, node, key, value, effect }) =>
      invokeWrite<void>("add_node_taint", { context, node, key, value, effect }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["nodes", context] }); },
  });
}

export function useRemoveNodeTaint() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; node: string; key: string; effect: string }>({
    mutationFn: ({ context, node, key, effect }) =>
      invokeWrite<void>("remove_node_taint", { context, node, key, effect }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["nodes", context] }); },
  });
}

// ─── Port-forward ─────────────────────────────────────────────────────────────

export function usePortForwards() {
  return useQuery<PortForwardEntry[], Error>({
    queryKey: ["port-forwards"],
    queryFn: () => invoke<PortForwardEntry[]>("list_port_forwards"),
    refetchInterval: 3_000,
  });
}

export function useStartPodPortForward() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; pod: string; podPort: number; localPort: number }>({
    mutationFn: ({ context, namespace, pod, podPort, localPort }) =>
      invoke<string>("start_pod_port_forward", { context, namespace, pod, podPort, localPort }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["port-forwards"] }); },
  });
}

export function useStartServicePortForward() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; service: string; servicePort: number; localPort: number }>({
    mutationFn: ({ context, namespace, service, servicePort, localPort }) =>
      invoke<string>("start_service_port_forward", { context, namespace, service, servicePort, localPort }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["port-forwards"] }); },
  });
}

export function useStopPortForward() {
  const qc = useQueryClient();
  return useMutation<void, Error, { forwardId: string }>({
    mutationFn: ({ forwardId }) => invoke<void>("stop_port_forward", { forwardId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["port-forwards"] }); },
  });
}

// ─── v0.4.0 — Workload actions ────────────────────────────────────────────────

export function useScaleWorkload() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; namespace: string; kind: string; name: string; replicas: number }>({
    mutationFn: ({ context, namespace, kind, name, replicas }) =>
      invokeWrite<void>("scale_workload", { context, namespace, kind, name, replicas }),
    onSuccess: (_d, { context, namespace }) => {
      qc.invalidateQueries({ queryKey: ["deployments", context, namespace] });
      qc.invalidateQueries({ queryKey: ["statefulsets", context, namespace] });
    },
  });
}

export function useRestartWorkload() {
  return useMutation<void, Error, { context: string; namespace: string; kind: string; name: string }>({
    mutationFn: ({ context, namespace, kind, name }) =>
      invokeWrite<void>("restart_workload", { context, namespace, kind, name }),
  });
}

export function usePauseDeployment() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; namespace: string; name: string }>({
    mutationFn: ({ context, namespace, name }) =>
      invokeWrite<void>("pause_deployment", { context, namespace, name }),
    onSuccess: (_d, { context, namespace }) => {
      qc.invalidateQueries({ queryKey: ["deployments", context, namespace] });
    },
  });
}

export function useResumeDeployment() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; namespace: string; name: string }>({
    mutationFn: ({ context, namespace, name }) =>
      invokeWrite<void>("resume_deployment", { context, namespace, name }),
    onSuccess: (_d, { context, namespace }) => {
      qc.invalidateQueries({ queryKey: ["deployments", context, namespace] });
    },
  });
}

export function useRolloutHistory(context: string, namespace: string, name: string, enabled: boolean) {
  return useQuery<RevisionInfo[], Error>({
    queryKey: ["rollout-history", context, namespace, name],
    queryFn: () => invoke<RevisionInfo[]>("list_rollout_history", { context, namespace, name }),
    enabled: enabled && !!context && !!name,
    staleTime: 30_000,
  });
}

export function useRollbackDeployment() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; namespace: string; name: string; revision: number }>({
    mutationFn: ({ context, namespace, name, revision }) =>
      invokeWrite<void>("rollback_deployment", { context, namespace, name, revision }),
    onSuccess: (_d, { context, namespace }) => {
      qc.invalidateQueries({ queryKey: ["deployments", context, namespace] });
      qc.invalidateQueries({ queryKey: ["rollout-history"] });
    },
  });
}

export function useTriggerCronJob() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; name: string }>({
    mutationFn: ({ context, namespace, name }) =>
      invokeWrite<string>("trigger_cronjob", { context, namespace, name }),
    onSuccess: (_d, { context, namespace }) => {
      qc.invalidateQueries({ queryKey: ["jobs", context, namespace] });
    },
  });
}

export function useCreateNamespace() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; name: string }>({
    mutationFn: ({ context, name }) => invokeWrite<void>("create_namespace", { context, name }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["namespaces", context] }); },
  });
}

export function useDeleteNamespace() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; name: string }>({
    mutationFn: ({ context, name }) => invokeWrite<void>("delete_namespace", { context, name }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["namespaces", context] }); },
  });
}

export function useResourceMetadata(
  context: string, namespace: string, resourceType: string, name: string, enabled: boolean
) {
  return useQuery<ResourceMetadata, Error>({
    queryKey: ["resource-metadata", resourceType, context, namespace, name],
    queryFn: () => invoke<ResourceMetadata>("get_resource_metadata", { context, namespace, resourceType, name }),
    enabled: enabled && !!context && !!name,
    staleTime: 60_000,
  });
}

export function useWorkloadConditions(
  context: string, namespace: string, kind: string, name: string, enabled: boolean
) {
  return useQuery<ResourceCondition[], Error>({
    queryKey: ["conditions", kind, context, namespace, name],
    queryFn: () => invoke<ResourceCondition[]>("get_workload_conditions", { context, namespace, kind, name }),
    enabled: enabled && !!context && !!name,
    staleTime: 30_000,
  });
}

// ─── v0.4.0 — RBAC & Network ─────────────────────────────────────────────────

export function useServiceAccounts(context: string, namespace: string) {
  return useQuery<ServiceAccountRow[], Error>({
    queryKey: ["serviceaccounts", context, namespace],
    queryFn: () => invoke<ServiceAccountRow[]>("list_service_accounts", { context, namespace }),
    enabled: !!context, refetchInterval: 60_000,
  });
}

export function useRoles(context: string, namespace: string) {
  return useQuery<RBACRole[], Error>({
    queryKey: ["roles", context, namespace],
    queryFn: () => invoke<RBACRole[]>("list_roles", { context, namespace }),
    enabled: !!context, refetchInterval: 60_000,
  });
}

export function useClusterRoles(context: string) {
  return useQuery<ClusterRole[], Error>({
    queryKey: ["clusterroles", context],
    queryFn: () => invoke<ClusterRole[]>("list_cluster_roles", { context }),
    enabled: !!context, refetchInterval: 60_000,
  });
}

export function useRoleBindings(context: string, namespace: string) {
  return useQuery<RoleBinding[], Error>({
    queryKey: ["rolebindings", context, namespace],
    queryFn: () => invoke<RoleBinding[]>("list_role_bindings", { context, namespace }),
    enabled: !!context, refetchInterval: 60_000,
  });
}

export function useClusterRoleBindings(context: string) {
  return useQuery<ClusterRoleBinding[], Error>({
    queryKey: ["clusterrolebindings", context],
    queryFn: () => invoke<ClusterRoleBinding[]>("list_cluster_role_bindings", { context }),
    enabled: !!context, refetchInterval: 60_000,
  });
}

// #32: on demand (the form never sends on change), 30 s stale, no interval. Key is [id, context, ...].
export interface WhoCanQuery { verb: string; group: string; resource: string; namespace: string | null; subresource: string }

export function useWhoCan(context: string, q: WhoCanQuery | null, enabled: boolean) {
  return useQuery<WhoCanResult, Error>({
    queryKey: ["who-can", context, q],
    queryFn: () => invoke<WhoCanResult>("who_can", {
      context, verb: q!.verb, group: q!.group, resource: q!.resource,
      namespace: q!.namespace ?? undefined, subresource: q!.subresource || undefined,
    }),
    enabled: enabled && !!context && !!q,
    staleTime: 30_000,
    retry: false,
  });
}

export function useSubjectPermissions(context: string, subjectKind: string, name: string, namespace: string | null, enabled: boolean) {
  return useQuery<RuleGrant[], Error>({
    queryKey: ["subject-permissions", context, subjectKind, name, namespace ?? ""],
    queryFn: () => invoke<RuleGrant[]>("subject_permissions", { context, subjectKind, name, namespace: namespace ?? undefined }),
    enabled: enabled && !!context && !!name,
    staleTime: 30_000,
    retry: false,
  });
}

export function useNetworkPolicies(context: string, namespace: string) {
  return useQuery<NetworkPolicyRow[], Error>({
    queryKey: ["networkpolicies", context, namespace],
    queryFn: () => invoke<NetworkPolicyRow[]>("list_network_policies", { context, namespace }),
    enabled: !!context, refetchInterval: 30_000,
  });
}

// ─── v0.4.0 — Helm ───────────────────────────────────────────────────────────

export function useHelmReleases(context: string) {
  return useQuery<HelmRelease[], Error>({
    queryKey: ["helm-releases", context],
    queryFn: () => invoke<HelmRelease[]>("list_helm_releases", { context }),
    enabled: !!context, refetchInterval: 60_000,
    retry: 1,
  });
}

// Redacted by default (backend). `reveal` = the real values: its own key, B-2 options, mounted in the
// panel root, removed on Hide / close / selection change / upgrade success (B-6).
export function useHelmValues(context: string, namespace: string, release: string, enabled: boolean, reveal = false) {
  return useQuery<string, Error>({
    queryKey: reveal ? ["helm-values", context, namespace, release, "revealed"] : ["helm-values", context, namespace, release],
    queryFn: () => invoke<string>("get_helm_values", reveal ? { context, namespace, release, reveal: true } : { context, namespace, release }),
    enabled: enabled && !!context && !!release,
    staleTime: 30_000,
    ...(reveal ? secretReadOptions("sec") : {}),
  });
}

export function useUpgradeHelmRelease() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; release: string; chartName: string; chart: string; valuesYaml: string }>({
    mutationFn: ({ context, namespace, release, chartName, chart, valuesYaml }) =>
      invokeWrite<string>("upgrade_helm_release", { context, namespace, release, chartName, chart, valuesYaml }),
    onSuccess: (_d, { context, namespace, release }) => {
      qc.invalidateQueries({ queryKey: ["helm-releases", context] });
      forgetHelmValues(qc, context, namespace, release);
      qc.invalidateQueries({ queryKey: ["helm-values", context, namespace, release] });
    },
  });
}

export function useUninstallHelmRelease() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; release: string }>({
    mutationFn: ({ context, namespace, release }) =>
      invokeWrite<string>("uninstall_helm_release", { context, namespace, release }),
    onSuccess: (_d, { context }) => { qc.invalidateQueries({ queryKey: ["helm-releases", context] }); },
  });
}

// ─── PDB ─────────────────────────────────────────────────────────────────────

export function usePdbs(context: string, namespace: string) {
  return useQuery<PdbRow[], Error>({
    queryKey: ["pdbs", context, namespace],
    queryFn: () => invoke<PdbRow[]>("list_pdbs", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

// ─── cert-manager ────────────────────────────────────────────────────────────

export function useCertificates(context: string, namespace: string) {
  return useQuery<Certificate[], Error>({
    queryKey: ["certificates", context, namespace],
    queryFn: () => invoke<Certificate[]>("list_certificates", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

// Additive discovery pass behind the #15 view states (not-installed / no-access / nothing-here).
// No refetchInterval: installing a CRD is rare; the TopBar refresh invalidates it.
export function useApiPresence(context: string, enabled = true) {
  return useQuery<ApiPresence[], Error>({
    queryKey: ["api-presence", context],
    queryFn: () => invoke<ApiPresence[]>("list_api_presence", { context }),
    enabled: !!context && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// #11: one read-only report per (context, namespace), T4-3 cadence. `enabled` is the caller's
// visibility gate (Problems page visible, or a covered detail panel open): it is the most
// expensive read in the app, so it never runs in the background. "all" means cluster-wide.
export function useProblems(context: string, namespace: string, enabled: boolean) {
  return useQuery<ProblemReport, Error>({
    queryKey: ["problems", context, namespace],
    queryFn: () => invoke<ProblemReport>("list_problems", { context, namespace }),
    enabled: !!context && enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

// #20 / #19: on demand (the page is the visibility gate), no interval. Key is [id, context, namespace].
export function usePossiblyUnused(context: string, namespace: string, enabled: boolean) {
  return useQuery<UnusedReport, Error>({
    queryKey: ["possibly-unused", context, namespace],
    queryFn: () => invoke<UnusedReport>("list_possibly_unused", { context, namespace: namespace === "all" ? undefined : namespace }),
    enabled: !!context && enabled,
    staleTime: 60_000,
    retry: false,
  });
}

// #18: on demand (the page is the visibility gate), no interval. A read; `focus` is "<MapKind>/<name>".
export function useResourceMap(context: string, namespace: string, focus: string | null, enabled: boolean) {
  return useQuery<ResourceMap, Error>({
    queryKey: ["resource-map", context, namespace, focus ?? ""],
    queryFn: () => invoke<ResourceMap>("get_resource_map", { context, namespace, focus: focus ?? null }),
    enabled: !!context && namespace !== "all" && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

// #24: shares the Map refresh prefix ["resource-map", ctx]. The pod panel section reuses it.
export function useNetworkPolicyModel(context: string, namespace: string, enabled: boolean) {
  return useQuery<NetpolModel, Error>({
    queryKey: ["resource-map", context, namespace, "netpol"],
    queryFn: () => invoke<NetpolModel>("get_network_policy_model", { context, namespace }),
    enabled: !!context && namespace !== "all" && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useDeprecatedApis(context: string, namespace: string, enabled: boolean) {
  return useQuery<DeprecationReport, Error>({
    queryKey: ["deprecated-apis", context, namespace],
    queryFn: () => invoke<DeprecationReport>("scan_deprecated_apis", { context, namespace: namespace === "all" ? undefined : namespace }),
    enabled: !!context && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// #12: one small row per node, aggregated in Rust (a cluster-wide pod list never reaches the webview).
// The page and the NodeStrip overlay share this key, so both on screen means one request.
export function useNodeCapacity(context: string, enabled: boolean) {
  return useQuery<NodeCapacity[], Error>({
    queryKey: ["node-capacity", context],
    queryFn: () => invoke<NodeCapacity[]>("list_node_capacity", { context }),
    enabled: !!context && enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

// ─── ArgoCD ──────────────────────────────────────────────────────────────────

export function useArgoCdApps(context: string) {
  return useQuery<ArgoCdApp[], Error>({
    queryKey: ["argocd-apps", context],
    queryFn: () => invoke<ArgoCdApp[]>("list_argocd_apps", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useSyncArgoCdApp() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; name: string; prune?: boolean; dryRun?: boolean; force?: boolean; revision?: string }>({
    mutationFn: ({ context, namespace, name, prune = false, dryRun = false, force = false, revision }) =>
      invokeWrite<string>("sync_argocd_app", { context, namespace, name, prune, dryRun, force, revision }),
    onSuccess: (_d, { context, namespace, name }) => {
      qc.invalidateQueries({ queryKey: ["argocd-apps", context] });
      qc.invalidateQueries({ queryKey: ["argocd-app-resources", context, namespace, name] });
    },
  });
}

// Upstream-parity rollback, keyed by status.history[].id — the backend reads the
// full revision and source itself (the History tab only ever holds a shortened
// revision string, which is display-only). Refused by the backend while
// auto-sync is on or another operation is in flight.
export function useRollbackArgoCdApp() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; name: string; historyId: number }>({
    mutationFn: ({ context, namespace, name, historyId }) =>
      invokeWrite<string>("rollback_argocd_app", { context, namespace, name, historyId }),
    onSuccess: (_d, { context, namespace, name }) => {
      qc.invalidateQueries({ queryKey: ["argocd-apps", context] });
      qc.invalidateQueries({ queryKey: ["argocd-app-resources", context, namespace, name] });
    },
  });
}

export function useRefreshArgoCdApp() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; name: string; hard?: boolean }>({
    mutationFn: ({ context, namespace, name, hard = false }) =>
      invokeWrite<string>("refresh_argocd_app", { context, namespace, name, hard }),
    onSuccess: (_d, { context, namespace, name }) => {
      qc.invalidateQueries({ queryKey: ["argocd-apps", context] });
      qc.invalidateQueries({ queryKey: ["argocd-app-resources", context, namespace, name] });
    },
  });
}

export function useArgoCdCommitInfo(
  context: string,
  namespace: string,
  name: string,
  enabled: boolean,
) {
  return useQuery<{ message: string; author: string }, Error>({
    queryKey: ["argocd-commit-info", context, namespace, name],
    queryFn: () => invoke<{ message: string; author: string }>("get_argocd_commit_info", {
      context,
      appNamespace: namespace,
      name,
    }),
    enabled: enabled && !!context && !!name,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useArgoCdAppResources(context: string, namespace: string, name: string, enabled: boolean) {
  return useQuery<ArgoCdResource[], Error>({
    queryKey: ["argocd-app-resources", context, namespace, name],
    queryFn: () => invoke<ArgoCdResource[]>("get_argocd_app_resources", { context, namespace, name }),
    enabled: enabled && !!context && !!name,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useArgoCdAppSets(context: string) {
  return useQuery<ArgoCdAppSet[], Error>({
    queryKey: ["argocd-appsets", context],
    queryFn: () => invoke<ArgoCdAppSet[]>("list_argocd_appsets", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useArgoCdProjects(context: string) {
  return useQuery<ArgoCdProject[], Error>({
    queryKey: ["argocd-projects", context],
    queryFn: () => invoke<ArgoCdProject[]>("list_argocd_projects", { context }),
    enabled: !!context,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useArgoCdRepositories(context: string) {
  return useQuery<ArgoCdRepository[], Error>({
    queryKey: ["argocd-repositories", context],
    queryFn: () => invoke<ArgoCdRepository[]>("list_argocd_repositories", { context }),
    enabled: !!context,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
}

// ─── ArgoCD bulk sync / refresh ──────────────────────────────────────────────

export interface BulkArgoResult {
  ok: number;
  failed: { name: string; error: string }[];
}

export function useBulkSyncArgoCdApps() {
  const qc = useQueryClient();
  return useMutation<BulkArgoResult, Error, { context: string; namespace: string; name: string }[]>({
    mutationFn: async (apps) => {
      if (apps.length > 0) assertWritable(apps[0].context);
      const results = await Promise.allSettled(
        apps.map((a) => invokeWrite<string>("sync_argocd_app", {
          context: a.context, namespace: a.namespace, name: a.name,
          prune: false, dryRun: false, force: false,
        }))
      );
      const failed = results
        .map((r, i) => ({ r, name: apps[i].name }))
        .filter(({ r }) => r.status === "rejected")
        .map(({ r, name }) => ({
          name,
          error: (r as PromiseRejectedResult).reason != null
            ? ((r as PromiseRejectedResult).reason as any)?.message ?? String((r as PromiseRejectedResult).reason)
            : "Unknown error",
        }));
      return { ok: results.length - failed.length, failed };
    },
    onSettled: (_d, _e, apps) => {
      if (apps.length > 0) qc.invalidateQueries({ queryKey: ["argocd-apps", apps[0].context] });
    },
  });
}

export function useBulkRefreshArgoCdApps() {
  const qc = useQueryClient();
  return useMutation<BulkArgoResult, Error, { context: string; namespace: string; name: string }[]>({
    mutationFn: async (apps) => {
      if (apps.length > 0) assertWritable(apps[0].context);
      const results = await Promise.allSettled(
        apps.map((a) => invokeWrite<string>("refresh_argocd_app", {
          context: a.context, namespace: a.namespace, name: a.name, hard: false,
        }))
      );
      const failed = results
        .map((r, i) => ({ r, name: apps[i].name }))
        .filter(({ r }) => r.status === "rejected")
        .map(({ r, name }) => ({
          name,
          error: (r as PromiseRejectedResult).reason != null
            ? ((r as PromiseRejectedResult).reason as any)?.message ?? String((r as PromiseRejectedResult).reason)
            : "Unknown error",
        }));
      return { ok: results.length - failed.length, failed };
    },
    onSettled: (_d, _e, apps) => {
      if (apps.length > 0) qc.invalidateQueries({ queryKey: ["argocd-apps", apps[0].context] });
    },
  });
}

// ─── Resource Create ─────────────────────────────────────────────────────────

export function useCreateResource() {
  // dryRun is additive on the Rust side (create_resource_from_yaml gains an
  // optional dry_run param under §3.4 of the TLS-cert/+New plan, landing in
  // parallel) — always sending it, defaulted false, means this hook works
  // whether or not that param has landed yet (unknown fields are ignored by
  // Tauri's arg deserializer) and needs no follow-up change once it does.
  return useMutation<string, Error, { context: string; yaml: string; dryRun?: boolean }>({
    mutationFn: ({ context, yaml, dryRun = false }) =>
      invokeWrite<string>("create_resource_from_yaml", { context, yaml, dryRun }),
  });
}

// ─── v0.8.0 — Flux ───────────────────────────────────────────────────────────

export function useFluxKustomizations(context: string, namespace: string) {
  return useQuery<FluxKustomization[], Error>({
    queryKey: ["flux-kustomizations", context, namespace],
    queryFn: () => invoke<FluxKustomization[]>("list_flux_kustomizations", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useFluxHelmReleases(context: string, namespace: string) {
  return useQuery<FluxHelmRelease[], Error>({
    queryKey: ["flux-helmreleases", context, namespace],
    queryFn: () => invoke<FluxHelmRelease[]>("list_flux_helmreleases", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
    retry: 1,
  });
}

// ─── v0.8.0 — Gateway API ────────────────────────────────────────────────────

export function useGateways(context: string, namespace: string) {
  return useQuery<GatewayInfo[], Error>({
    queryKey: ["gateways", context, namespace],
    queryFn: () => invoke<GatewayInfo[]>("list_gateways", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useHttpRoutes(context: string, namespace: string) {
  return useQuery<HttpRouteInfo[], Error>({
    queryKey: ["httproutes", context, namespace],
    queryFn: () => invoke<HttpRouteInfo[]>("list_http_routes", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
    retry: 1,
  });
}

// Class enumerations for the Gateway/Ingress create-form dropdowns — not
// resource-list views, so no refetchInterval (mirrors useNamespaces' shape).
export function useGatewayClasses(context: string) {
  return useQuery<string[], Error>({
    queryKey: ["gatewayclasses", context],
    queryFn: () => invoke<string[]>("list_gateway_classes", { context }),
    enabled: !!context,
    staleTime: 60_000,
    retry: false,
  });
}

export function useIngressClasses(context: string) {
  return useQuery<string[], Error>({
    queryKey: ["ingressclasses", context],
    queryFn: () => invoke<string[]>("list_ingress_classes", { context }),
    enabled: !!context,
    staleTime: 60_000,
    retry: false,
  });
}

// ─── v0.8.0 — Quotas ─────────────────────────────────────────────────────────

export function useResourceQuotas(context: string, namespace: string) {
  return useQuery<ResourceQuotaInfo[], Error>({
    queryKey: ["resource-quotas", context, namespace],
    queryFn: () => invoke<ResourceQuotaInfo[]>("list_resource_quotas", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useLimitRanges(context: string, namespace: string) {
  return useQuery<LimitRangeInfo[], Error>({
    queryKey: ["limit-ranges", context, namespace],
    queryFn: () => invoke<LimitRangeInfo[]>("list_limit_ranges", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function usePriorityClasses(context: string) {
  return useQuery<PriorityClassInfo[], Error>({
    queryKey: ["priority-classes", context],
    queryFn: () => invoke<PriorityClassInfo[]>("list_priority_classes", { context }),
    enabled: !!context,
    refetchInterval: 60_000,
  });
}

// ─── v0.8.0 — Cluster-wide search ───────────────────────────────────────────

export function useSearchResources(context: string, query: string, enabled: boolean) {
  return useQuery<SearchResult[], Error>({
    queryKey: ["search", context, query],
    queryFn: () => invoke<SearchResult[]>("search_resources", { context, query }),
    enabled: enabled && !!context && query.length >= 2,
    staleTime: 10_000,
  });
}

// ─── Generic resource delete ─────────────────────────────────────────────────

// These kinds are namespaced (their detail panel shows a real namespace, and
// delete needs it), but their list query fetches cluster-wide with no
// namespace segment in the key — pushing the item's namespace onto the
// invalidation key would never match the cached query.
const CLUSTER_WIDE_LIST_QUERY: Partial<Record<ResourceType, true>> = {
  "argo-appsets": true,
  "argo-projects": true,
};

// `propagation` is only sent by the owner kinds that show the picker (deploy sts
// ds jobs rs cron); every other kind omits it and the backend sends Background.
export function useDeleteResource() {
  const qc = useQueryClient();
  return useMutation<void, Error, { context: string; namespace: string; resourceType: ResourceType; name: string; propagation?: PropagationPolicy }>({
    mutationFn: ({ context, namespace, resourceType, name, propagation }) =>
      invokeWrite<void>("delete_resource", { context, namespace, resourceType, name, propagation }),
    onSuccess: (_d, { context, namespace, resourceType }) => {
      const queryKey = RESOURCE_QUERY_KEY[resourceType];
      if (queryKey) {
        const keys = [queryKey, context];
        if (namespace && !CLUSTER_WIDE_LIST_QUERY[resourceType]) keys.push(namespace);
        qc.invalidateQueries({ queryKey: keys });
      }
    },
  });
}

// ─── ArgoCD delete ───────────────────────────────────────────────────────────

export function useDeleteArgoCdApp() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; name: string; cascade: boolean }>({
    mutationFn: ({ context, namespace, name, cascade }) =>
      invokeWrite<string>("delete_argocd_app", { context, namespace, name, cascade }),
    onSuccess: (_d, { context }) => {
      qc.invalidateQueries({ queryKey: ["argocd-apps", context] });
    },
  });
}

// ─── §3.1 — Merge from file ───────────────────────────────────────────────────
// docs/plan-kubeconfig-and-parity.md §3.1. Called "Merge from file", never
// "Apply" — every document is sent as an RFC 7386 merge patch, which never
// prunes fields the file removed (unlike `kubectl apply`'s three-way merge).
// preview_yaml_documents never writes.

export function usePreviewYamlDocuments() {
  return useMutation<DocPreview[], Error, { context: string; yaml: string }>({
    mutationFn: ({ context, yaml }) => invoke<DocPreview[]>("preview_yaml_documents", { context, yaml }),
    retry: false,
  });
}

export function useApplyYamlDocuments() {
  const qc = useQueryClient();
  return useMutation<ApplyResult[], Error, { context: string; yaml: string; dryRun?: boolean }>({
    mutationFn: ({ context, yaml, dryRun = false }) =>
      invokeWrite<ApplyResult[]>("apply_yaml_documents", { context, yaml, dryRun }),
    onSuccess: (_results, { dryRun }) => {
      // A real dry run changed nothing server-side — skip invalidation, same
      // discipline as usePatchResource. The caller (MergeFromFileModal) is
      // responsible for detecting a backend that silently ignored the flag
      // (from each result's `message`) and invalidating manually in that one
      // case, mirroring ResourceEditor's identical defensive shape.
      if (dryRun) return;
      // A multi-kind, multi-doc file can touch anything — enumerating
      // RESOURCE_QUERY_KEY per result is more code for a worse guarantee
      // than one unfiltered invalidation.
      qc.invalidateQueries();
    },
  });
}

// ─── §3.3 — Helm install / rollback / history ────────────────────────────────

export function useHelmHistory(context: string, namespace: string, release: string, enabled: boolean) {
  return useQuery<HelmRevision[], Error>({
    queryKey: ["helm-history", context, namespace, release],
    queryFn: () => invoke<HelmRevision[]>("list_helm_history", { context, namespace, release }),
    enabled: enabled && !!context && !!release,
    staleTime: 10_000,
  });
}

export function useRollbackHelmRelease() {
  const qc = useQueryClient();
  return useMutation<string, Error, { context: string; namespace: string; release: string; revision: number }>({
    mutationFn: ({ context, namespace, release, revision }) =>
      invokeWrite<string>("rollback_helm_release", { context, namespace, release, revision }),
    onSuccess: (_d, { context, namespace, release }) => {
      qc.invalidateQueries({ queryKey: ["helm-releases", context] });
      qc.invalidateQueries({ queryKey: ["helm-values", context, namespace, release] });
      qc.invalidateQueries({ queryKey: ["helm-history", context, namespace, release] });
    },
  });
}

// Blank optional fields must be sent as `undefined` (omitted), never `""` —
// `--version ""` and an empty values file are both real, wrong CLI behavior,
// same discipline as the Option<T> ground rule one layer up the stack.
export function useInstallHelmRelease() {
  const qc = useQueryClient();
  return useMutation<
    string,
    Error,
    {
      context: string; namespace: string; release: string; chart: string;
      version?: string; valuesYaml?: string; createNamespace?: boolean; dryRun?: boolean;
    }
  >({
    mutationFn: ({ context, namespace, release, chart, version, valuesYaml, createNamespace, dryRun = false }) =>
      invokeWrite<string>("install_helm_release", {
        context, namespace, release, chart,
        version: version || undefined,
        valuesYaml: valuesYaml || undefined,
        createNamespace,
        dryRun,
      }),
    onSuccess: (_d, { context, dryRun }) => {
      if (dryRun) return;
      qc.invalidateQueries({ queryKey: ["helm-releases", context] });
    },
  });
}

// list_helm_repos reads the machine-global `helm repo list` — no per-cluster
// context, so no context segment in the key (unlike every other hook here).
export function useHelmRepos() {
  return useQuery<HelmRepo[], Error>({
    queryKey: ["helm-repos"],
    queryFn: () => invoke<HelmRepo[]>("list_helm_repos"),
    staleTime: 5 * 60_000,
  });
}

// ─── Phase 4 — coverage (docs/plan-kubeconfig-and-parity.md §4) ─────────────
// Frozen contract with @rust-engineer — command names and args match §4.3
// verbatim. All namespaced list commands use the existing `namespaced_or_all!`
// macro server-side; refetchInterval 30s per §4.4 step 2.

export function useEndpoints(context: string, namespace: string) {
  return useQuery<EndpointsRow[], Error>({
    queryKey: ["endpoints", context, namespace],
    queryFn: () => invoke<EndpointsRow[]>("list_endpoints", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useEndpointSlices(context: string, namespace: string) {
  return useQuery<EndpointSliceRow[], Error>({
    queryKey: ["endpointslices", context, namespace],
    queryFn: () => invoke<EndpointSliceRow[]>("list_endpoint_slices", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useReplicaSets(context: string, namespace: string) {
  return useQuery<ReplicaSetRow[], Error>({
    queryKey: ["replicasets", context, namespace],
    queryFn: () => invoke<ReplicaSetRow[]>("list_replicasets", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useMutatingWebhooks(context: string) {
  return useQuery<WebhookConfigRow[], Error>({
    queryKey: ["mutating-webhooks", context],
    queryFn: () => invoke<WebhookConfigRow[]>("list_mutating_webhooks", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

export function useValidatingWebhooks(context: string) {
  return useQuery<WebhookConfigRow[], Error>({
    queryKey: ["validating-webhooks", context],
    queryFn: () => invoke<WebhookConfigRow[]>("list_validating_webhooks", { context }),
    enabled: !!context,
    refetchInterval: 30_000,
  });
}

// VolumeSnapshot is a CRD (snapshot.storage.k8s.io) — frequently absent, same
// situation as Flux/Gateway. retry: 1 matches useFluxKustomizations/useGateways.
export function useVolumeSnapshots(context: string, namespace: string) {
  return useQuery<VolumeSnapshotRow[], Error>({
    queryKey: ["volumesnapshots", context, namespace],
    queryFn: () => invoke<VolumeSnapshotRow[]>("list_volume_snapshots", { context, namespace }),
    enabled: !!context,
    refetchInterval: 30_000,
    retry: 1,
  });
}

// ─── §3.4 — can-i / SelfSubjectAccessReview ──────────────────────────────────
// docs/plan-kubeconfig-and-parity.md §3.4. FAIL OPEN is not negotiable: only
// an explicit `allowed: false` greys anything out. A missing RBAC_RESOURCE
// entry, a query error, or no data yet all mean "stay enabled" — a cluster
// where SSAR doesn't answer must not render a fully-disabled UI. SSAR only
// answers RBAC; admission webhooks can still deny a permitted request, so
// every consumer keeps its existing confirm-and-fail error handling —
// greying out is a hint, not a guarantee.

// group/resource are the plural k8s API terms can_i needs, not the app's
// ResourceType strings. Cross-checked against resource_edit.rs's gvk_for
// where the two tables overlap (19 kinds: cm, sec, deploy, sts, ds, svc, ing,
// roles, croles, rbindings, crbindings, argocd, pvc, sa, rq, lr, cron,
// flux-ks, flux-hr); the rest are well-known built-in API groups, verified
// against the Rust file that actually queries each one (hpa.rs, pdb.rs,
// gateway.rs, certmanager.rs, quotas.rs, crds.rs, networking.rs,
// config_storage.rs, argocd.rs). "helm" and "argo-repos" are deliberately
// absent — neither is a real RBAC resource (a Helm release is a bundle of
// writes across many kinds; a Repository row is a read-only Secret view).
// "ep"/"eps" are also deliberately absent — they get no onDelete anywhere
// (§4.2: controller-owned, deleting one is a no-op that looks like it
// worked), so nothing ever calls usePermissions with those kinds.
export const RBAC_RESOURCE: Partial<Record<ResourceType, { group: string; resource: string }>> = {
  pods: { group: "", resource: "pods" },
  deploy: { group: "apps", resource: "deployments" },
  sts: { group: "apps", resource: "statefulsets" },
  ds: { group: "apps", resource: "daemonsets" },
  rs: { group: "apps", resource: "replicasets" },
  jobs: { group: "batch", resource: "jobs" },
  cron: { group: "batch", resource: "cronjobs" },
  hpa: { group: "autoscaling", resource: "horizontalpodautoscalers" },
  pdb: { group: "policy", resource: "poddisruptionbudgets" },
  svc: { group: "", resource: "services" },
  ing: { group: "networking.k8s.io", resource: "ingresses" },
  netpol: { group: "networking.k8s.io", resource: "networkpolicies" },
  gw: { group: "gateway.networking.k8s.io", resource: "gateways" },
  httproute: { group: "gateway.networking.k8s.io", resource: "httproutes" },
  cm: { group: "", resource: "configmaps" },
  sec: { group: "", resource: "secrets" },
  pv: { group: "", resource: "persistentvolumes" },
  pvc: { group: "", resource: "persistentvolumeclaims" },
  sc: { group: "storage.k8s.io", resource: "storageclasses" },
  cert: { group: "cert-manager.io", resource: "certificates" },
  rq: { group: "", resource: "resourcequotas" },
  lr: { group: "", resource: "limitranges" },
  nodes: { group: "", resource: "nodes" },
  ns: { group: "", resource: "namespaces" },
  events: { group: "", resource: "events" },
  crd: { group: "apiextensions.k8s.io", resource: "customresourcedefinitions" },
  pc: { group: "scheduling.k8s.io", resource: "priorityclasses" },
  mwc: { group: "admissionregistration.k8s.io", resource: "mutatingwebhookconfigurations" },
  vwc: { group: "admissionregistration.k8s.io", resource: "validatingwebhookconfigurations" },
  vs: { group: "snapshot.storage.k8s.io", resource: "volumesnapshots" },
  sa: { group: "", resource: "serviceaccounts" },
  roles: { group: "rbac.authorization.k8s.io", resource: "roles" },
  croles: { group: "rbac.authorization.k8s.io", resource: "clusterroles" },
  rbindings: { group: "rbac.authorization.k8s.io", resource: "rolebindings" },
  crbindings: { group: "rbac.authorization.k8s.io", resource: "clusterrolebindings" },
  argocd: { group: "argoproj.io", resource: "applications" },
  "argo-appsets": { group: "argoproj.io", resource: "applicationsets" },
  "argo-projects": { group: "argoproj.io", resource: "appprojects" },
  "flux-ks": { group: "kustomize.toolkit.fluxcd.io", resource: "kustomizations" },
  "flux-hr": { group: "helm.toolkit.fluxcd.io", resource: "helmreleases" },
};

export interface Permissions {
  canDelete: boolean;
  canPatch: boolean;
  canCreate: boolean;
  /** `update` verb (v1.3.0, P4) — YAML edit/Save replace the whole object via PUT, which is `update`, not `patch`. */
  canUpdate: boolean;
}

const ALWAYS_ALLOWED: Permissions = { canDelete: true, canPatch: true, canCreate: true, canUpdate: true };

export function usePermissions(context: string, namespace: string, resourceType: ResourceType): Permissions {
  // Frozen contract: AccessCheck.namespace is `""` for cluster-scoped OR
  // all-namespaces — never the frontend's "all" sentinel. Normalized here,
  // once, so every one of this hook's ~40 call sites can pass whatever they
  // already have (a View's own `namespace` prop, which is "all" when the
  // user has "All namespaces" selected) without remembering the conversion.
  // A cluster-wide SSAR is not the question the user asked. `App.tsx` defaults the
  // filter to "all", so asking it there denies every namespace-scoped user — the
  // majority RBAC shape — and hides every delete control on first launch. Fail open:
  // gating is accurate only once a specific namespace is selected, and the real error
  // still surfaces on the action itself (pre-existing behaviour, so no regression).
  const allNamespaces = namespace === "all";
  const ns = allNamespaces ? "" : namespace;
  const gr = RBAC_RESOURCE[resourceType];
  const checks: AccessCheck[] = gr
    ? [
        { group: gr.group, resource: gr.resource, verb: "delete", namespace: ns },
        { group: gr.group, resource: gr.resource, verb: "patch", namespace: ns },
        { group: gr.group, resource: gr.resource, verb: "create", namespace: ns },
        { group: gr.group, resource: gr.resource, verb: "update", namespace: ns },
      ]
    : [];

  const { data, isError } = useQuery<AccessResult[], Error>({
    queryKey: ["can-i", context, ns, resourceType],
    queryFn: () => invoke<AccessResult[]>("can_i", { context, checks }),
    enabled: !!context && checks.length > 0 && !allNamespaces,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (allNamespaces || !gr || isError || !data) return ALWAYS_ALLOWED;
  // `!== false` fails open on a missing/malformed index too — only an
  // explicit `allowed: false` at that position denies.
  return {
    canDelete: data[0]?.allowed !== false,
    canPatch: data[1]?.allowed !== false,
    canCreate: data[2]?.allowed !== false,
    canUpdate: data[3]?.allowed !== false,
  };
}

// Subresource-aware batched SSAR (v1.3.1 C-7). `usePermissions` is keyed by ResourceType and
// has no subresource, so the drain's `create pods/eviction` hint and the debug container's
// `update pods/ephemeralcontainers` gate go through this. FAIL OPEN like everything else here:
// callers treat only an explicit `allowed: false` as a denial (utils/permissionHints.ts).
export function useAccessChecks(context: string, checks: AccessCheck[], enabled: boolean) {
  return useQuery<AccessResult[], Error>({
    queryKey: ["can-i-checks", context, JSON.stringify(checks)],
    queryFn: () => invoke<AccessResult[]>("can_i", { context, checks }),
    enabled: enabled && !!context && checks.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}

// ─── External observability (v2.3.0). All reads through the API server's service proxy: plain `invoke`, never invokeWrite. ───

/**
 * Pod/node history from Prometheus. `range` "now" or no target = disabled (metrics-server path). Placeholder data
 * survives a RANGE change only (samePlotExceptRange): another pod, node, cluster or target never shows the old chart.
 */
export function useMetricRange(
  context: string, target: ServiceTarget | undefined, template: MetricTemplate, namespace: string, name: string,
  range: MetricRangeId, enabled: boolean,
) {
  const key = ["metric-range", context, target ? targetKey(target) : "", template, namespace, name, range] as const;
  return useQuery<MetricRange, Error>({
    queryKey: key,
    queryFn: () => {
      const { start, end, stepSeconds } = rangeWindow(range as Exclude<MetricRangeId, "now">, Date.now() / 1000);
      // container: null on purpose: one query per pod returns every container's series.
      return invoke<MetricRange>("query_metric_range", { context, target, template, namespace, name, container: null, start, end, stepSeconds });
    },
    enabled: enabled && !!context && !!target && !!name && range !== "now",
    staleTime: range === "now" ? 60_000 : Math.max(60_000, METRIC_RANGES[range].step * 1000), // a new point appears once per step
    refetchInterval: range === "now" ? 60_000 : Math.max(60_000, METRIC_RANGES[range].step * 1000),
    retry: false,
    placeholderData: (prev, prevQuery) => (prevQuery && samePlotExceptRange(prevQuery.queryKey, key) ? prev : undefined),
  });
}

export function discoverObservability(context: string, allNamespaces: boolean): Promise<ObservabilityDiscovery> {
  return invoke<ObservabilityDiscovery>("discover_observability", { context, allNamespaces });
}

export function probeObservabilityBackend(context: string, target: ServiceTarget, flavour: ObservabilityKind): Promise<BackendProbe> {
  return invoke<BackendProbe>("probe_observability_backend", { context, target, flavour });
}

export interface BackendLogsArgs { context: string; target: LogsTarget; namespace: string; pod: string; container: string | null; start: number; end: number }

/** One-shot history fetch (never polls; the caller guards late results with a request id). */
export function fetchBackendLogs(a: BackendLogsArgs): Promise<BackendLogs> {
  return invoke<BackendLogs>("query_backend_logs", { ...a, limit: null });
}

// ─── Journal (v1.4.1 #31) ────────────────────────────────────────────────────

export const JOURNAL_PAGE = 500;

/** Newest first, paged by the `before` cursor (the oldest loaded `ts`). App-local: no context. */
/**
 * #17 timeline source (O9): this app's own actions on one object. `list_journal` has no kind filter, so the
 * 50 newest rows for the name come back and the timeline filters them by kind. A read: not `invokeWrite`.
 */
export const OBJECT_JOURNAL_LIMIT = 50;
export function useObjectJournal(context: string, namespace: string, name: string, enabled: boolean) {
  return useQuery<JournalEntry[], Error>({
    queryKey: ["journal", "object", context, namespace, name],
    queryFn: () => invoke<JournalEntry[]>("list_journal", { limit: OBJECT_JOURNAL_LIMIT, before: null, context, namespace, name }),
    enabled: enabled && !!context && !!name,
    staleTime: 10_000,
    retry: false,
  });
}

export function useJournal(enabled: boolean) {
  return useInfiniteQuery<JournalEntry[], Error, { pages: JournalEntry[][] }, ["journal", number], string | undefined>({
    queryKey: ["journal", JOURNAL_PAGE],
    queryFn: ({ pageParam }) => invoke<JournalEntry[]>("list_journal", { limit: JOURNAL_PAGE, before: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.length >= JOURNAL_PAGE ? last[last.length - 1].ts : undefined),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

// ─── Debug container (v1.3.1 F7) ─────────────────────────────────────────────

/**
 * A single pod, fresh. `null` = the pod no longer exists. Used by the debug surfaces so the
 * click-time snapshot in the pods table (stale `status`, stale `ephemeral_containers`, C-6)
 * is never the source of truth. `refetchMs` false = no polling.
 */
export function useGetPod(context: string, namespace: string, name: string, enabled: boolean, refetchMs: number | false = false) {
  return useQuery<Pod | null, Error>({
    queryKey: ["pod", context, namespace, name],
    queryFn: () => invoke<Pod | null>("get_pod", { context, namespace, name }),
    enabled: enabled && !!context && !!namespace && !!name,
    staleTime: 0,
    retry: false,
    refetchInterval: refetchMs,
  });
}

/** Adds an ephemeral container (a write: guarded). Returns the container NAME. */
export function useStartDebugContainer() {
  const qc = useQueryClient();
  return useMutation<
    string,
    Error,
    { context: string; namespace: string; pod: string; name: string; image: string; targetContainer?: string }
  >({
    mutationFn: ({ context, namespace, pod, name, image, targetContainer }) =>
      invokeWrite<string>("start_debug_container", { context, namespace, pod, name, image, targetContainer }),
    onSuccess: (_n, { context, namespace, pod }) => {
      qc.invalidateQueries({ queryKey: ["pod", context, namespace, pod] });
      qc.invalidateQueries({ queryKey: ["pods", context] });
    },
  });
}

// ─── Diagnostics (v1.3.1 F6) ─────────────────────────────────────────────────
// App-local commands: they touch no cluster and take NO `context`, so they are exempt from
// the write backstop (Settings must stay reachable under read-only).

export function useLogSettings() {
  return useQuery<LogSettings, Error>({
    queryKey: ["log-settings"],
    queryFn: () => invoke<LogSettings>("get_log_settings"),
    staleTime: 30_000,
    retry: false,
  });
}

export function useSetLogLevel() {
  const qc = useQueryClient();
  return useMutation<LogSettings, Error, AppLogLevel>({
    mutationFn: (level) => invoke<LogSettings>("set_log_level", { level }),
    onSuccess: (settings) => { qc.setQueryData(["log-settings"], settings); },
  });
}

export function useOpenLogFolder() {
  return useMutation<void, Error, void>({
    mutationFn: () => invoke<void>("open_log_folder"),
  });
}

// ─── App updates (v2.1.0, docs/claude/ui.md → Updates) ───────────────────────
// A module-level store (the Sidebar reads it after Settings unmounts), like appearance.ts. The state model is
// pure in utils/updateState.ts. Not a cluster write: no invokeWrite. NEVER the combined download-and-install call (its permission
// is not granted); Linux must never reach download/install/relaunch (capabilities are macOS-only), so every one of
// them is guarded by UPDATE_MODE === "app" here, not only hidden in the UI.
const UPDATE_MODE = updateMode(typeof navigator === "undefined" ? "" : navigator.userAgent, import.meta.env.DEV);
interface UpdateStore { state: UpdateState; lastChecked: number | null; prefs: UpdatePrefs; saveFailed: boolean }
let updateStore: UpdateStore = {
  state: UPDATE_MODE === "unavailable" ? { s: "unavailable" } : { s: "idle" },
  lastChecked: null,
  prefs: (() => { try { return parsePrefs(localStorage.getItem(UPDATES_KEY)); } catch { return DEFAULT_PREFS; } })(),
  saveFailed: false,
};
const updateListeners = new Set<() => void>();
// The Update from check() stays here between download and restart: install() uses the bytes download() stored.
let heldUpdate: Update | null = null;

function setUpdateStore(patch: Partial<UpdateStore>) {
  updateStore = { ...updateStore, ...patch };
  updateListeners.forEach((l) => l());
}
const updateDispatch = (e: UpdateEvent) => setUpdateStore({ state: reduce(updateStore.state, e) });
const errMsg = (e: unknown) => (e as any)?.message ?? String(e);
const dropHeld = () => { const u = heldUpdate; heldUpdate = null; if (u) void u.close().catch(() => {}); };

async function runUpdateCheck(manual: boolean): Promise<UpdateState> {
  const prev = updateStore.state;
  if (!canCheck(prev)) return prev;
  updateDispatch({ t: "check-start" });
  try {
    const u = await check({ timeout: 30_000 }); // no default timeout: a stalled connection would block every later check
    const at = Date.now();
    if (u) {
      if (heldUpdate !== u) dropHeld();
      heldUpdate = u;
      updateDispatch({ t: "found", version: u.version, notes: u.body ?? "", at });
    } else {
      dropHeld();
      updateDispatch({ t: "none", at });
    }
    setUpdateStore({ lastChecked: at });
  } catch (e) {
    // Automatic: silent (state restored). Manual: the reducer shows the failed line.
    updateDispatch({ t: "check-failed", message: errMsg(e), manual, prev });
  }
  return updateStore.state;
}

async function runUpdateDownload(): Promise<UpdateState> {
  const s = updateStore.state;
  const u = heldUpdate;
  const version = s.s === "available" || (s.s === "failed" && s.phase !== "check") ? s.version : null;
  if (UPDATE_MODE !== "app" || !u || !version) return s;
  updateDispatch({ t: "download-start", version });
  try {
    await u.download((ev) => {
      if (ev.event === "Started") updateDispatch({ t: "progress", chunk: 0, total: ev.data.contentLength ?? null });
      else if (ev.event === "Progress") updateDispatch({ t: "progress", chunk: ev.data.chunkLength });
    });
    updateDispatch({ t: "downloaded" });
  } catch (e) {
    updateDispatch({ t: "download-failed", message: errMsg(e) });
  }
  return updateStore.state;
}

async function runUpdateRestart(): Promise<UpdateState> {
  const u = heldUpdate;
  if (UPDATE_MODE !== "app" || !u || updateStore.state.s !== "ready") return updateStore.state;
  updateDispatch({ t: "install-start" });
  try {
    await u.install();
  } catch (e) {
    updateDispatch({ t: "install-failed", message: errMsg(e) });
    return updateStore.state;
  }
  // The bundle is already swapped: a relaunch failure is not an install failure.
  try { await relaunch(); } catch { updateDispatch({ t: "relaunch-failed" }); }
  return updateStore.state;
}

function saveUpdatePrefs(prefs: UpdatePrefs) {
  let saveFailed = false;
  try { localStorage.setItem(UPDATES_KEY, JSON.stringify(prefs)); } catch { saveFailed = true; }
  setUpdateStore({ prefs, saveFailed });
}
const setUpdateAutoCheck = (autoCheck: boolean) => saveUpdatePrefs({ ...updateStore.prefs, autoCheck });
const dismissUpdateNotice = (dismissed: string) => saveUpdatePrefs({ ...updateStore.prefs, dismissed });
const openReleasePage = () => { void invoke<void>("open_release_page").catch(() => {}); };

// One timer for the whole app: first check shortly after launch (<= 10 s), then every 24 h while running.
// Reads the switch at tick time. Dev builds and unsupported platforms never check.
let updateTimerStarted = false;
function startUpdateTimer() {
  if (updateTimerStarted || UPDATE_MODE === "unavailable") return;
  updateTimerStarted = true;
  const tick = () => { if (updateStore.prefs.autoCheck) void runUpdateCheck(false); };
  window.setTimeout(tick, 8000);
  window.setInterval(tick, 24 * 60 * 60 * 1000);
}
const subscribeUpdates = (l: () => void) => { updateListeners.add(l); return () => { updateListeners.delete(l); }; };
const getUpdateStore = () => updateStore;

export function useAppUpdate() {
  const st = useSyncExternalStore(subscribeUpdates, getUpdateStore);
  useEffect(startUpdateTimer, []);
  return {
    state: st.state,
    lastChecked: st.lastChecked,
    /** macOS only: download + install in the app. Linux: notice + release page. */
    inAppInstall: UPDATE_MODE === "app",
    autoCheck: st.prefs.autoCheck,
    saveFailed: st.saveFailed,
    dismissed: st.prefs.dismissed,
    setAutoCheck: setUpdateAutoCheck,
    dismiss: dismissUpdateNotice,
    checkNow: () => runUpdateCheck(true),
    download: runUpdateDownload,
    restart: runUpdateRestart,
    openReleasePage,
  };
}

// ─── Log streaming (v1.3.0) ──────────────────────────────────────────────────
// These are exported FUNCTIONS, not queries: a stream is a per-effect session,
// not cacheable server state. They live here because only this file calls
// invoke(). The per-invocation Channel isolation (v0.8.1) is unchanged: every
// call creates its own Channel, and cleanup clears onmessage, which makes the
// backend's next on_log.send() fail and terminate the task.

export interface LogStreamArgs {
  context: string;
  namespace: string;
  pod: string;
  container: string;
  tailLines?: number;
  sinceSeconds?: number;
  timestamps?: boolean;
}

/** A LogStreamEvent, plus the rejection of the start itself (e.g. a waiting container). */
export type LogStreamSignal = LogStreamEvent | { type: "start_error"; message: string };

/** Starts a log stream. Returns the cleanup: call it to stop receiving and end the backend task. */
export function startLogStream(args: LogStreamArgs, onEvent: (e: LogStreamSignal) => void): () => void {
  const channel = new Channel<LogStreamEvent>();
  let live = true;
  channel.onmessage = (e) => {
    if (live) onEvent(e);
  };
  invoke("stream_pod_logs", {
    onLog: channel,
    context: args.context,
    namespace: args.namespace,
    pod: args.pod,
    container: args.container,
    tailLines: args.tailLines,
    sinceSeconds: args.sinceSeconds,
    timestamps: args.timestamps,
  }).catch((e) => {
    if (live) onEvent({ type: "start_error", message: (e as any)?.message ?? String(e) });
  });
  return () => {
    live = false;
    channel.onmessage = () => {};
  };
}

export interface PodLogsArgs {
  context: string;
  namespace: string;
  pod: string;
  container: string;
  tailLines?: number;
  previous?: boolean;
  sinceSeconds?: number;
  timestamps?: boolean;
}

/** One-shot log fetch (the previous-instance view). Rejects with the backend's plain string. */
export function fetchPodLogs(args: PodLogsArgs): Promise<string> {
  return invoke<string>("get_pod_logs", {
    context: args.context,
    namespace: args.namespace,
    pod: args.pod,
    container: args.container,
    tailLines: args.tailLines,
    previous: args.previous,
    sinceSeconds: args.sinceSeconds,
    timestamps: args.timestamps,
  });
}

// ─── Shell session (moved here from ShellTerminal, behaviour unchanged) ──────

export interface ShellSessionArgs {
  context: string;
  namespace: string;
  pod: string;
  container: string;
  initialCols: number;
  initialRows: number;
  /** "attach" for a debug container (v1.3.1); omitted = the existing exec. */
  mode?: "exec" | "attach";
  /**
   * Client-supplied session id (RA-1): the frontend generates it so `shell-output-{id}` and
   * `shell-closed-{id}` listeners exist BEFORE the invoke, and a session that closes at once
   * cannot lose its close event. 1-64 characters of [A-Za-z0-9_-].
   */
  sessionId?: string;
}

export function startShellSession(args: ShellSessionArgs): Promise<string> {
  // D3-7: a shell can change anything inside a container, so it is blocked while
  // read-only is on. One switch (READ_ONLY_BLOCKS_SHELL) reverses the decision.
  if (READ_ONLY_BLOCKS_SHELL) {
    try {
      assertWritable(args.context);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return invoke<string>("start_shell_session", { ...args });
}

export function writeToShell(sessionId: string, data: string): Promise<void> {
  return invoke<void>("write_to_shell", { sessionId, data });
}

export function resizeShell(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("resize_shell", { sessionId, cols, rows });
}

export function stopShellSession(sessionId: string): Promise<void> {
  return invoke<void>("stop_shell_session", { sessionId });
}

// ─── Command-line launch args (v2.1.3 K6: pulled, not pushed) ────────────────
// The `launch-args` event is a null-payload ping; the args wait in a Rust slot that
// `get_launch_args` drains. The listener is registered BEFORE the first pull so a second
// invocation during startup is never lost, and every event pulls. An app-lifetime listener,
// not a log stream. `LaunchArgs::default()` means nothing to apply: callers skip it.
export function startLaunchArgs(onArgs: (args: LaunchArgs, source: "startup" | "forwarded") => void): () => void {
  let unlisten: (() => void) | null = null;
  let stopped = false;
  const pull = (source: "startup" | "forwarded") => {
    invoke<LaunchArgs>("get_launch_args").then((a) => onArgs(a, source), () => {});
  };
  listen<null>("launch-args", () => pull("forwarded")).then(
    (fn) => {
      if (stopped) fn(); // cleaned up (StrictMode remount) before the registration finished
      else { unlisten = fn; pull("startup"); }
    },
    () => {},
  );
  return () => { stopped = true; unlisten?.(); };
}

/** Namespace names of a context for the launch-args check, or null when the list fails or is forbidden (K10: fail open). */
export function fetchNamespacesOrNull(qc: QueryClient, context: string): Promise<string[] | null> {
  // retry: false (the client default is 2) and a ~3 s cap: a slow cluster must not stall the launch (fail open).
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
  const fetch = qc
    .fetchQuery<NamespaceRow[], Error>({ ...namespaceRowsQuery(context), retry: false })
    .then(namespaceNames)
    .catch(() => null);
  return Promise.race([fetch, timeout]);
}

// ─── Command-line tool (v2.1.3, Settings → Command line) ─────────────────────
// App-local, not a cluster write: raw invoke, EXEMPT in writeBackstop.test.ts (K11). Works in read-only.
export function useCliStatus() {
  return useQuery<CliStatus, Error>({
    queryKey: ["cli-status"],
    queryFn: () => invoke<CliStatus>("get_cli_status"),
    retry: false,
  });
}

export function useInstallCliCommand() {
  const qc = useQueryClient();
  return useMutation<CliStatus, Error, void>({
    mutationFn: () => invoke<CliStatus>("install_cli_command"),
    onSuccess: (s) => qc.setQueryData(["cli-status"], s),
  });
}
