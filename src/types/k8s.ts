// ─── Core ────────────────────────────────────────────────────────────────────

export interface KubeContext {
  name: string;
  cluster: string;
  user: string;
  is_kubeconfig_default: boolean;  // was: is_current — your kubectl default, NOT the active-in-app marker (that's useActiveContext local state)
  source: string;                  // abs path of the file whose CONTEXT entry won — may differ from the file the cluster/user entries won from
  shadowed_sources: string[];      // other ENABLED files also defining this context name; empty when unique
  server: string;                  // v1.3.1: the cluster entry's server URL the merged context references; "" when it cannot be resolved
  proxy: string | null;            // v2.1.2: display_proxy output (scheme://host[:port]); never contains userinfo; null = no proxy-url
}

export interface KubeconfigEntry {
  path: string;            // absolute
  source: "default" | "registered";
  enabled: boolean;        // the default entry is always true
  app_owned: boolean;      // true = pasted YAML we wrote into the app config dir
  contexts: string[];      // contexts THIS FILE defines, read pre-merge
  error: string | null;    // unreadable/invalid -> Some(msg), contexts empty
}

// Trust states — cluster access probe (docs/plan-kubeconfig-and-parity.md §2.1).
// check_cluster_access returns Ok even for failures; `state` carries the result.
// `state !== "ok"` is the banner trigger, never `query.error` — an actual query
// error here means something structurally broken (not a normal unreachable cluster).
export interface ClusterAccess {
  state: "ok" | "unreachable" | "auth" | "forbidden" | "unknown";
  message: string;
  server_version: string | null;
  via_proxy: boolean;              // v2.1.2: the context's cluster entry has a proxy-url
}

export interface ContainerEnvVarSource {
  source_type: "configmap" | "secret" | "fieldRef" | "resourceField" | "unknown";
  name?: string;
  key?: string;
  field_path?: string;
}

export interface ContainerEnvVar {
  name: string;
  value?: string;
  value_from?: ContainerEnvVarSource;
}

export interface ContainerEnvFrom {
  source_type: "configmap" | "secret" | "unknown";
  name: string;
  prefix?: string;
}

export interface ContainerVolumeMount {
  name: string;
  mount_path: string;
  read_only: boolean;
  sub_path?: string;
}

export interface ContainerProbe {
  probe_type: "httpGet" | "tcpSocket" | "exec" | "grpc" | "unknown";
  path?: string;
  port?: string;
  host?: string;
  command?: string[];
  grpc_service?: string;
  initial_delay_seconds?: number;
  period_seconds?: number;
  failure_threshold?: number;
  success_threshold?: number;
  timeout_seconds?: number;
}

export interface ContainerProbes {
  liveness?: ContainerProbe;
  readiness?: ContainerProbe;
  startup?: ContainerProbe;
}

export interface PodTemplateContainer {
  name: string;
  image: string;
  is_init: boolean;
  cpu_request_m?: number;
  mem_request_mi?: number;
  cpu_limit_m?: number;
  mem_limit_mi?: number;
}

export interface PodTemplateSpec {
  containers: PodTemplateContainer[];
  image_pull_policy?: string;
  service_account_name?: string;
  restart_policy?: string;
}

export interface Container {
  name: string;
  image: string;
  status: string;
  ready: boolean;
  restart_count: number;
  is_init?: boolean;
  /** Frontend-only: an ephemeral debug container shown beside the real ones (never sent by Rust). */
  is_debug?: boolean;
  ports: number[];
  env?: ContainerEnvVar[];
  env_from?: ContainerEnvFrom[];
  volume_mounts?: ContainerVolumeMount[];
  probes?: ContainerProbes;
  cpu_request_m?: number;
  mem_request_mi?: number;
  cpu_limit_m?: number;
  mem_limit_mi?: number;
}

export interface ContainerStatus {
  name: string;
  restart_count: number;
  current_state: string;
  current_started_at?: string;
  current_reason?: string;
  last_state?: string;
  last_reason?: string;
  last_exit_code?: number;
  last_signal?: number;
  last_started_at?: string;
  last_finished_at?: string;
}

// ─── Workloads ───────────────────────────────────────────────────────────────

export interface Pod {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  node: string;
  cpu_request: string;
  memory_request: string;
  containers: Container[];
  labels: Record<string, string>;
  cpu_m?: number;
  cpu_lim?: number;
  mem_mi?: number;
  mem_lim?: number;
  owner?: string;
  image?: string;
  containers_status?: ContainerStatus[];
  /** kubectl.kubernetes.io/default-container annotation, verbatim; null/absent when unset (v1.3.0). */
  default_container?: string | null;
  /** v1.3.1: debug containers from spec.ephemeralContainers (never in `containers`). Optional so MOCK_PODS compiles. */
  ephemeral_containers?: EphemeralContainerInfo[];
  /** spec.priorityClassName (v1.4.0). Optional so MOCK_PODS compiles. */
  priority_class?: string | null;
}

// v1.3.1 — ephemeral debug containers (mirrors pods.rs EphemeralContainerInfo).
export type EphemeralState = "running" | "waiting" | "terminated" | "pending";
export interface EphemeralContainerInfo {
  name: string;
  image: string;
  target_container: string | null;
  state: EphemeralState;
  reason: string | null;
  message: string | null;
  exit_code: number | null;
  started_at: string | null;
}

/** v1.3.1: payload of the `shell-closed-{id}` event. */
export interface ShellClosed {
  reason: "eof" | "error";
  message: string;
}

export interface Deployment {
  name: string;
  namespace: string;
  ready: string;
  up_to_date: number;
  available: number;
  age: string;
  image: string;
  pod_template?: PodTemplateSpec;
}

export interface StatefulSet {
  name: string;
  namespace: string;
  ready: string;
  replicas: number;
  age: string;
  image: string;
  pod_template?: PodTemplateSpec;
}

export interface DaemonSet {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  up_to_date: number;
  available: number;
  age: string;
  image: string;
  pod_template?: PodTemplateSpec;
}

export interface Job {
  name: string;
  namespace: string;
  completions: string;
  duration: string;
  age: string;
  status: string;
  image: string;
  pod_template?: PodTemplateSpec;
}

export interface CronJob {
  name: string;
  namespace: string;
  schedule: string;
  suspend: boolean;
  active: number;
  last_schedule: string;
  age: string;
  pod_template?: PodTemplateSpec;
}

// ─── Networking ──────────────────────────────────────────────────────────────

export interface Service {
  name: string;
  namespace: string;
  type_: string;
  cluster_ip: string;
  external_ip: string;
  ports: string;
  age: string;
}

export interface IngressPath {
  path: string;
  path_type: string;
  service: string;
  port: string;
}

export interface IngressRule {
  host: string;
  tls: boolean;
  paths: IngressPath[];
}

export interface Ingress {
  name: string;
  namespace: string;
  class: string;
  hosts: string;
  address: string;
  ports: string;
  rules: IngressRule[];
  age: string;
}

// ─── Config & Storage ────────────────────────────────────────────────────────

export interface ConfigMap {
  name: string;
  namespace: string;
  data_count: number;
  data: Record<string, string>;
  age: string;
}

export interface Secret {
  name: string;
  namespace: string;
  type_: string;
  data_count: number;
  keys: string[];
  sizes: Record<string, number>;
  age: string;
}

// Mirrors Rust TlsCertInfo (src-tauri/src/commands/tls_cert.rs). Concrete fields
// mirror as required; key_size_bits is the ONLY genuine Option<T> (R9).
export interface TlsCertInfo {
  source_key: string;
  index: number;
  parse_error: string;
  subject: string;
  subject_cn: string;
  issuer: string;
  issuer_cn: string;
  serial: string;
  not_before: string;
  not_after: string;
  dns_names: string[];
  other_sans: string[];
  signature_algorithm: string;
  key_algorithm: string;
  key_size_bits?: number | null;
  sha256_fingerprint: string;
  is_ca: boolean;
  self_signed: boolean;
}

export interface PersistentVolumeClaim {
  name: string;
  namespace: string;
  status: string;
  volume: string;
  capacity: string;
  access_modes: string;
  storage_class: string;
  age: string;
}

export interface PersistentVolume {
  name: string;
  capacity: string;
  access_modes: string;
  reclaim_policy: string;
  status: string;
  claim: string;
  storage_class: string;
  age: string;
}

// ─── Cluster ─────────────────────────────────────────────────────────────────

export interface NodeTaint {
  key: string;
  value: string;
  effect: string;
}

export interface PortForwardEntry {
  id: string;
  target_type: string;  // "pod" | "service"
  namespace: string;
  name: string;
  pod_port: number;
  local_port: number;
}

export interface NodeResource {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
  os_image: string;
  cpu_capacity: string;
  memory_capacity: string;
  pod_capacity: string;
  cpu_percent?: number;
  mem_percent?: number;
  pod_count?: number;
  labels: Record<string, string>;
  taints: NodeTaint[];
  unschedulable: boolean;
}

export interface ClusterInfo {
  total_nodes: number;
  ready_nodes: number;
  total_pods: number;
  running_pods: number;
  pending_pods: number;
  failed_pods: number;
  terminating_pods: number;
  crash_loop_pods: number;
  version: string;
}

export interface K8sEvent {
  name: string;
  namespace: string;
  type_: string;
  reason: string;
  message: string;
  source: string;
  object: string;
  count: number;
  age: string;
  first_seen: string;
  /** RFC3339 of lastTimestamp, else eventTime, else "". */
  last_timestamp: string;
}

// ─── Navigation ──────────────────────────────────────────────────────────────

export interface HPA {
  name: string;
  namespace: string;
  reference: string;
  min_replicas: number;
  max_replicas: number;
  current_replicas: number;
  desired_replicas: number;
  cpu_current?: number;
  cpu_target?: number;
  mem_current?: string;
  mem_target?: string;
  age: string;
}

export interface CRD {
  name: string;
  group: string;
  kind: string;
  plural: string;
  scope: string;
  versions: string;
  established: boolean;
  age: string;
}

export interface CRDResource {
  name: string;
  namespace: string;
  age: string;
}

export interface ContainerUsage {
  name: string;
  cpu_usage: string;
  memory_usage: string;
  cpu_millicores: number;
  memory_mib: number;
}

export interface PodMetricsResult {
  containers: ContainerUsage[];
}

export interface PdbRow {
  name: string;
  namespace: string;
  min_available: string;
  max_unavailable: string;
  desired_healthy: number;
  current_healthy: number;
  disruptions_allowed: number;
  age: string;
  /** Selector facts for the Constraints section (#14). */
  match_labels: Record<string, string>;
  has_match_expressions: boolean;
}

export interface ArgoCdResource {
  group: string;
  version: string;
  kind: string;
  namespace: string;
  name: string;
  sync_status: string;
  health_status: string;
  health_message: string;
  requires_pruning: boolean;
}

export interface ArgoCdHistoryEntry {
  /** status.history[].id — the key rollback_argocd_app takes (v1.2.1). */
  id: number;
  revision: string;
  deployed_at: string;
  deployed_at_iso: string;
  message: string;
  author: string;
}

export interface ArgoCdApp {
  name: string;
  namespace: string;
  project: string;
  repo_url: string;
  path: string;
  target_revision: string;
  dest_server: string;
  dest_namespace: string;
  health_status: string;
  sync_status: string;
  age: string;
  last_commit: string;
  last_synced_at: string;
  operation_phase: string;
  commit_message: string;
  commit_author: string;
  history?: ArgoCdHistoryEntry[];
  owner_appset: string;
  /** spec.syncPolicy.automated is enabled — rollback is refused while true (v1.2.1). */
  auto_sync: boolean;
}

export interface ArgoCdAppSet {
  name: string;
  namespace: string;
  generators: string[];
  project: string;
  status: string;
  message: string;
  generated_apps: number;
  age: string;
}

export interface ArgoCdProject {
  name: string;
  namespace: string;
  description: string;
  source_repos: string[];
  destinations: string[];
  cluster_resource_allowed: boolean;
  orphaned_warn: boolean;
  age: string;
}

export interface ArgoCdRepository {
  name: string;
  url: string;
  repo_type: string;
  project: string;
  insecure: boolean;
  enable_oci: boolean;
  auth_method: string;
  source: string;
  age: string;
}

export interface ResourceMetadata {
  annotations: Record<string, string>;
  labels: Record<string, string>;
}

export interface Certificate {
  name: string;
  namespace: string;
  ready: boolean;
  secret_name: string;
  issuer_name: string;
  issuer_kind: string;
  dns_names: string[];
  renewal_time: string;
  not_after: string;
  age: string;
  status: string;
  last_failure_message: string;
}

export type ResourceType =
  | "pods" | "deploy" | "sts" | "ds" | "cron" | "jobs" | "hpa" | "pdb" | "rs"
  | "svc" | "ing" | "netpol" | "gw" | "httproute" | "ep" | "eps"
  | "cm" | "sec" | "pv" | "pvc" | "sc" | "cert" | "rq" | "lr" | "vs"
  | "nodes" | "events" | "crd" | "pc" | "mwc" | "vwc" | "ns"
  | "sa" | "roles" | "croles" | "rbindings" | "crbindings"
  | "helm" | "argocd" | "flux-ks" | "flux-hr"
  | "argo-appsets" | "argo-projects" | "argo-repos"
  | "crd-instances";

export type PodStatus = "All" | "Running" | "Pending" | "CrashLoopBackOff" | "ImagePullBackOff" | "Terminating" | "Succeeded" | "Failed";

// ─── Selected Resource (discriminated union for detail panel) ─────────────────

export type SelectedResource =
  | { kind: "deploy"; item: Deployment; ns: string }
  | { kind: "sts";    item: StatefulSet; ns: string }
  | { kind: "ds";     item: DaemonSet; ns: string }
  | { kind: "jobs";   item: Job; ns: string }
  | { kind: "cron";   item: CronJob; ns: string }
  | { kind: "hpa";    item: HPA; ns: string }
  | { kind: "svc";    item: Service; ns: string }
  | { kind: "ing";    item: Ingress; ns: string }
  | { kind: "cm";     item: ConfigMap; ns: string }
  | { kind: "sec";    item: Secret; ns: string }
  | { kind: "pvc";    item: PersistentVolumeClaim; ns: string }
  | { kind: "pv";     item: PersistentVolume }
  | { kind: "sc";     item: StorageClassRow }
  | { kind: "nodes";  item: NodeResource }
  | { kind: "crd";    item: CRD }
  | { kind: "netpol"; item: NetworkPolicyRow; ns: string }
  | { kind: "sa";     item: ServiceAccountRow; ns: string }
  | { kind: "roles";  item: RBACRole; ns: string }
  | { kind: "croles"; item: ClusterRole }
  | { kind: "rbindings";  item: RoleBinding; ns: string }
  | { kind: "crbindings"; item: ClusterRoleBinding }
  | { kind: "helm";   item: HelmRelease; ns: string }
  | { kind: "pdb";    item: PdbRow; ns: string }
  | { kind: "cert";   item: Certificate; ns: string }
  | { kind: "argocd"; item: ArgoCdApp; ns: string }
  | { kind: "argo-appsets";  item: ArgoCdAppSet;  ns: string }
  | { kind: "argo-projects"; item: ArgoCdProject; ns: string }
  | { kind: "flux-ks"; item: FluxKustomization; ns: string }
  | { kind: "flux-hr"; item: FluxHelmRelease; ns: string }
  | { kind: "gw"; item: GatewayInfo; ns: string }
  | { kind: "httproute"; item: HttpRouteInfo; ns: string }
  | { kind: "rq"; item: ResourceQuotaInfo; ns: string }
  | { kind: "lr"; item: LimitRangeInfo; ns: string }
  | { kind: "pc"; item: PriorityClassInfo }
  | { kind: "ep";  item: EndpointsRow; ns: string }
  | { kind: "eps"; item: EndpointSliceRow; ns: string }
  | { kind: "rs";  item: ReplicaSetRow; ns: string }
  | { kind: "mwc"; item: WebhookConfigRow }
  | { kind: "vwc"; item: WebhookConfigRow }
  | { kind: "vs";  item: VolumeSnapshotRow; ns: string }
  | { kind: "ns";  item: NamespaceRow };

// ─── v0.4.0 additions ────────────────────────────────────────────────────────

export interface RevisionInfo {
  revision: number;
  image: string;
  age: string;
  /** v1.3.1: the ReplicaSet's spec.template with pod-template-hash stripped; null when absent. */
  template: Record<string, unknown> | null;
  /** RFC3339 UTC of the ReplicaSet's creationTimestamp; "" when absent. Not the time the revision went live (a rollback reuses an older ReplicaSet). */
  created_at: string;
}

export interface ResourceCondition {
  type_: string;
  status: string;
  reason: string;
  message: string;
  last_transition: string;
}

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

export interface ServiceAccountRow {
  name: string;
  namespace: string;
  age: string;
}

export interface RBACRole {
  name: string;
  namespace: string;
  rules_count: number;
  age: string;
}

export interface ClusterRole {
  name: string;
  rules_count: number;
  age: string;
}

/** Structured subject of a binding / who-can grant (Rust RbacSubject). */
export interface RbacSubject { kind: "User" | "Group" | "ServiceAccount"; name: string; namespace: string | null; }

export interface RoleBinding {
  name: string;
  namespace: string;
  role_ref: string;
  subjects: string;
  subject_list: RbacSubject[];
  age: string;
}

export interface ClusterRoleBinding {
  name: string;
  role_ref: string;
  subjects: string;
  subject_list: RbacSubject[];
  age: string;
}

export interface NetworkPolicyRow {
  name: string;
  namespace: string;
  pod_selector: string;
  ingress_count: number;
  egress_count: number;
  policy_types: string;
  age: string;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  chart_name: string;
  app_version: string;
}

export interface StorageClassRow {
  name: string;
  provisioner: string;
  reclaim_policy: string;
  volume_binding_mode: string;
  allow_volume_expansion: boolean;
  is_default: boolean;
  age: string;
}

// ─── v0.8.0 — Flux / Gateway / Quotas / Search ───────────────────────────────

export interface FluxKustomization {
  name: string;
  namespace: string;
  ready: string;
  status: string;
  path: string;
  source_ref: string;
  revision: string;
  age: string;
  suspended: boolean;
}

export interface FluxHelmRelease {
  name: string;
  namespace: string;
  ready: string;
  status: string;
  chart: string;
  chart_version: string;
  age: string;
  suspended: boolean;
}

export interface GatewayInfo {
  name: string;
  namespace: string;
  gateway_class_name: string;
  listeners: string[];
  addresses: string[];
  status: string;
  age: string;
}

export interface HttpRouteInfo {
  name: string;
  namespace: string;
  parent_refs: string[];
  hostnames: string[];
  rule_count: number;
  status: string;
  age: string;
}

export interface ResourceQuotaInfo {
  name: string;
  namespace: string;
  cpu_request_used: string;
  cpu_request_hard: string;
  cpu_limit_used: string;
  cpu_limit_hard: string;
  memory_request_used: string;
  memory_request_hard: string;
  memory_limit_used: string;
  memory_limit_hard: string;
  pods_used: string;
  pods_hard: string;
  age: string;
}

export interface LimitRangeInfo {
  name: string;
  namespace: string;
  constraint_count: number;
  default_cpu: string;
  default_memory: string;
  age: string;
}

export interface PriorityClassInfo {
  name: string;
  value: number;
  global_default: boolean;
  preemption_policy: string;
  description: string;
  age: string;
}

/** Per-container usage inside one PodUsage. Named PodContainerUsage because ContainerUsage is taken (A-2). */
export interface PodContainerUsage { name: string; cpu_m: number; mem_mi: number; }

export interface PodUsage {
  name: string;
  namespace: string;
  cpu_m: number;
  mem_mi: number;
  /** Optional so mocks compile. */
  containers?: PodContainerUsage[];
}

export interface GraphNode {
  kind: string;
  name: string;
  namespace: string;
  uid: string;
  status: string;
  children: GraphNode[];
}

export interface SearchResult {
  kind: string;
  name: string;
  namespace?: string;
  resource_type: string;
}

// ─── Phase 3 — daily workflow (docs/plan-kubeconfig-and-parity.md §3) ────────
// Frozen contract with @rust-engineer — field names/shapes must match
// apply_file.rs, helm.rs and the can_i command exactly.

// §3.1 — merge-from-file
export interface DocPreview {
  index: number;
  api_version: string;
  kind: string;
  name: string;
  namespace: string;
  action: "create" | "update" | "error";
  live: Record<string, any> | null;
  desired: Record<string, any>;
  error: string | null;
}

export interface ApplyResult {
  index: number;
  kind: string;
  name: string;
  namespace: string;
  action: "created" | "updated" | "failed";
  message: string;
}

// §3.3 — Helm install / rollback / history
export interface HelmRevision {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export interface HelmRepo {
  name: string;
  url: string;
}

// §3.4 — can-i / SelfSubjectAccessReview
export interface AccessCheck {
  group: string;
  resource: string;
  verb: string;
  namespace: string;
  /** v1.3.1: e.g. "ephemeralcontainers", "eviction". Omit for the main resource. */
  subresource?: string | null;
}

export interface AccessResult {
  allowed: boolean;
  reason: string;
}

// ─── Phase 4 — coverage (docs/plan-kubeconfig-and-parity.md §4) ─────────────
// Frozen contract with @rust-engineer — row structs match §4.3 field-for-field.

export interface EndpointsRow {
  name: string;
  namespace: string;
  addresses: string;
  address_count: number;
  ready_count: number;
  age: string;
}

export interface EndpointSliceRow {
  name: string;
  namespace: string;
  service: string;
  address_type: string;
  endpoints: number;
  ready: number;
  ports: string;
  age: string;
}

export interface ReplicaSetRow {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  owner: string;
  images: string;
  age: string;
}

// mwc AND vwc — one struct, two commands (§4.3).
/** One rule of one webhook (admission.rs). scope: "*" | "Namespaced" | "Cluster". */
export interface WebhookMatch {
  webhook: string; api_groups: string[]; resources: string[]; operations: string[];
  scope: string; has_namespace_selector: boolean; has_object_selector: boolean; failure_policy: string;
}

export interface WebhookConfigRow {
  name: string;
  webhooks: number;
  failure_policy: string;
  targets: string;
  age: string;
  matches: WebhookMatch[];
}

export interface VolumeSnapshotRow {
  name: string;
  namespace: string;
  ready: boolean;
  source_pvc: string;
  snapshot_class: string;
  restore_size: string;
  age: string;
}

// ─── Node drain (v1.2.1) — mirrors src-tauri/src/commands/drain.rs ────────────

export type DrainPodCategory = "evict" | "daemonset" | "mirror";

export interface DrainPdbRef {
  name: string;
  disruptions_allowed: number;
}

export interface DrainPodPreview {
  namespace: string;
  name: string;
  category: DrainPodCategory;
  owner_kind: string | null;
  owner_name: string | null;
  unmanaged: boolean;
  has_empty_dir: boolean;
  pdbs: DrainPdbRef[];
  may_be_blocked: boolean;
}

export interface DrainPreview {
  node: string;
  unschedulable: boolean;
  node_ready: boolean;
  pods: DrainPodPreview[];
  pdb_lookup_errors: string[];
}

export type EvictionOutcome = "evicted" | "blocked" | "gone" | "failed";

export interface EvictionResult {
  namespace: string;
  name: string;
  outcome: EvictionOutcome;
  message: string;
}

// ─── v1.3.0 ──────────────────────────────────────────────────────────────────

/** Payload of the stream_pod_logs Channel (docs/impl/v1.3.0-tasks.md §2.1). */
export type LogStreamEvent =
  | { type: "line"; line: string }
  | { type: "end" }
  | { type: "error"; message: string };

/** get_resource_yaml_neat: display-only YAML plus the dotted paths actually removed. */
export interface NeatYaml {
  yaml: string;
  hidden: string[];
}

export type PropagationPolicy = "background" | "foreground" | "orphan";

// ─── v1.3.1 — previews, diagnostics (frozen IPC contract §2.5, §2.6, §2.10) ──

export type YamlSaveOutcome = "ok" | "invalid" | "rejected" | "conflict";
export interface YamlSavePreview {
  outcome: YamlSaveOutcome;
  message: string;
  live: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  dropped_paths: string[];
}

export type HelmResourceChange = "new" | "changed" | "removed" | "unchanged";
export interface HelmRenderedResource {
  api_version: string;
  kind: string;
  namespace: string;
  name: string;
  change: HelmResourceChange;
}
export interface HelmUpgradePreview {
  outcome: "ok" | "invalid" | "rejected";
  message: string;
  current_values: unknown;
  new_values: unknown;
  resources: HelmRenderedResource[];
  rendered_manifest: string;
}

export type AppLogLevel = "error" | "warn" | "info" | "debug" | "trace";
export interface LogSettings {
  level: AppLogLevel;
  log_dir: string;
  log_file: string;
  file_exists: boolean;
  max_files: number;
  max_file_bytes: number;
}

// list_api_presence (commands/presence.rs). `message` is "" unless state === "unknown".
export type PresenceState = "installed" | "absent" | "unknown";
export interface ApiPresence { key: string; group: string; state: PresenceState; version: string | null; message: string; }

// list_problems (commands/problems.rs). Closed sets mirror the Rust rules and sources.
export type ProblemSeverity = "critical" | "warning" | "info";
export type ProblemRule = "crashloop" | "oom-killed" | "image-pull" | "init-failing" | "unschedulable"
  | "workload-unavailable" | "job-failed" | "service-no-endpoints" | "pvc-pending" | "node-not-ready" | "missing-probes";
export type ProblemSource = "pods" | "deployments" | "statefulsets" | "daemonsets" | "jobs" | "services"
  | "endpointslices" | "persistentvolumeclaims" | "events" | "nodes" | "certificates" | "secrets";
export interface ProblemEvidence { source: "field" | "event"; path: string; value: string; event_age: string | null; }
export interface Finding {
  id: string; rule: ProblemRule; severity: ProblemSeverity;
  /** A ResourceType value; pods are a ResourceType but not a SelectedResource (A-1). */
  kind: ResourceType;
  namespace: string; name: string; container: string | null; summary: string; evidence: ProblemEvidence[];
}
export interface CertExpiryFact { kind: "cert" | "sec"; namespace: string; name: string; not_after: string; not_before: string | null; }
/** Each report declares its own closed id union beside its page util (B-12). */
export interface SkippedSource<S extends string = ProblemSource> { source: S; reason: string; }
export interface ProblemReport { findings: Finding[]; cert_expiry: CertExpiryFact[]; skipped: SkippedSource[]; }

// list_node_capacity (commands/capacity.rs). Usage is null when metrics-server is unavailable.
export interface NodeCapacity {
  node: string; cpu_allocatable_m: number | null; mem_allocatable_mi: number | null; pods_allocatable: number | null;
  cpu_requests_m: number; cpu_limits_m: number; mem_requests_mi: number; mem_limits_mi: number;
  pods: number; pods_without_limits: number; cpu_usage_m: number | null; mem_usage_mi: number | null;
}

// Mirrors Rust JournalEntry (src-tauri/src/commands/diagnostics.rs, v1.4.1 §2.3). App-local, no context arg.
export interface JournalEntry {
  ts: string;
  context: string;
  verb: string;
  kind: string;
  namespace: string;
  name: string;
  summary: string;
  result: "ok" | "error";
  message: string;
}

// who_can / subject_permissions (commands/rbac.rs, v1.4.1 §2.4). Source ids: WhoCanSource in utils/whoCan.ts.
export interface WhoCanGrant {
  subject: RbacSubject; binding_kind: "RoleBinding" | "ClusterRoleBinding"; binding: string;
  binding_namespace: string | null; role_kind: "Role" | "ClusterRole"; role: string; scope: "cluster" | "namespace";
  resource_names: string[]; via_wildcard: boolean;
}
export interface WhoCanResult { grants: WhoCanGrant[]; notes: string[]; skipped: SkippedSource<import("../utils/whoCan").WhoCanSource>[]; }
export interface RuleGrant {
  api_groups: string[]; resources: string[]; verbs: string[]; resource_names: string[]; non_resource_urls: string[];
  binding_kind: string; binding: string; binding_namespace: string | null; role_kind: string; role: string;
  scope: "cluster" | "namespace"; via_group: string | null;
}

// list_possibly_unused (commands/unused.rs) and scan_deprecated_apis (commands/deprecations.rs), v1.4.1 §2.5, §2.6.
export type UnusedReason = "not-referenced" | "not-mounted" | "unbound" | "no-binding" | "no-pods" | "zero-replicas";
export interface UnusedCandidate {
  kind: "cm" | "sec" | "pvc" | "pv" | "roles" | "croles" | "sa" | "deploy" | "sts";
  namespace: string; name: string; reason: UnusedReason; detail: string;
}
export interface UnusedReport {
  candidates: UnusedCandidate[]; skipped: SkippedSource<import("../utils/unused").UnusedSource>[]; excluded_namespaces: string[];
}
export interface DeprecatedApiFinding {
  source: "helm" | "last-applied"; api_version: string; kind: string; namespace: string; name: string;
  helm_release: string | null; helm_release_namespace: string | null; deprecated_in: string;
  removed_in: string | null; replacement: string | null; served_by_this_server: boolean;
}
export interface DeprecationReport {
  findings: DeprecatedApiFinding[]; server_version: string; table_covers_up_to: string;
  skipped: SkippedSource<import("../utils/deprecations").DeprecationSource>[];
}

// ─── CLI launcher (mirrors Rust LaunchArgs / CliStatus, snake_case serde) ─────

export interface LaunchArgs { context: string | null; namespace: string | null; kind: string | null; ignored: string[]; }
export interface CliStatus { method: "symlink" | "package" | "installer" | "manual"; on_path: boolean; resolved_path: string | null; manual_command: string | null; path_hint: string | null; }

// ─── Resource map (mirrors Rust commands/map.rs, snake_case serde; docs/impl/v2.2.0-tasks.md A3) ───

export type MapKind = "pods" | "deploy" | "sts" | "ds" | "rs" | "jobs" | "cron" | "svc" | "ing" | "gw" | "httproute" | "pvc" | "pv" | "cm" | "sec" | "hpa" | "pdb"; // ⊂ ResourceType
export type MapStatus = "ok" | "warn" | "bad" | "unknown";
export type MapRelation = "owns" | "selects" | "routes-to" | "attaches-to" | "mounts" | "binds" | "uses-config" | "uses-secret" | "scales" | "protects";
export type MapSource = "pods" | "deployments" | "statefulsets" | "daemonsets" | "replicasets" | "jobs" | "cronjobs" | "services" | "endpointslices" | "ingresses" | "gateways" | "httproutes" | "persistentvolumeclaims" | "persistentvolumes" | "configmaps" | "secrets" | "horizontalpodautoscalers" | "poddisruptionbudgets";
export interface MapNode { id: string; kind: MapKind; namespace: string; name: string; status: MapStatus; }
export interface MapEdge { from: string; to: string; relation: MapRelation; detail: string; }
export interface ResourceMap { nodes: MapNode[]; edges: MapEdge[]; truncated: boolean; skipped: SkippedSource<MapSource>[]; }

// ─── NetworkPolicy model (mirrors Rust commands/netpol.rs, snake_case serde; A3) ───

export type NetpolSource = "networkpolicies" | "pods" | "namespaces";
export interface SelectorExpr { key: string; operator: "In" | "NotIn" | "Exists" | "DoesNotExist"; values: string[]; }
export interface LabelSelectorModel { match_labels: Record<string, string>; match_expressions: SelectorExpr[]; }
export interface IpBlockModel { cidr: string; except: string[]; }
export interface PeerModel { pod_selector: LabelSelectorModel | null; namespace_selector: LabelSelectorModel | null; ip_block: IpBlockModel | null; }
export interface PortModel { protocol: string; port: string | null; end_port: number | null; }
export interface RuleModel { peers: PeerModel[]; ports: PortModel[]; }
export interface PolicyModel { name: string; pod_selector: LabelSelectorModel; policy_types: ("Ingress" | "Egress")[]; ingress: RuleModel[]; egress: RuleModel[]; }
export interface PodLabels { name: string; labels: Record<string, string>; controller: string; }
export interface NamespaceLabels { name: string; labels: Record<string, string>; }
export interface NetpolModel { policies: PolicyModel[]; pods: PodLabels[]; namespaces: NamespaceLabels[]; skipped: SkippedSource<NetpolSource>[]; }

// ─── External observability (v2.3.0). Mirrors commands/{observability,prometheus,logs_backend}.rs: snake_case on the wire, no rename_all. ───
export type ObservabilityKind = "prometheus" | "loki" | "victorialogs"; // candidate kind and probe flavour
export type LogFlavour = "loki" | "victorialogs";
export type MetricTemplate = "pod-cpu" | "pod-mem" | "node-cpu" | "node-mem";
export type MetricUnit = "millicores" | "MiB";
export type ProbeState = "ok" | "unreachable" | "forbidden" | "wrong-service";
export type MetricRangeId = "now" | "1h" | "6h" | "24h" | "7d"; // "now" = metrics-server, never sent
export interface ServiceTarget { namespace: string; service: string; port: string; scheme?: "http" | "https" | null; path_prefix?: string | null; tenant?: string | null }
export interface LogLabelMap { namespace: string; pod: string; container: string }
export interface LogsTarget { service: ServiceTarget; flavour: LogFlavour; labels: LogLabelMap }
export interface ObservabilityCandidate { kind: ObservabilityKind; target: ServiceTarget; reason: string }
export interface ObservabilityDiscovery { candidates: ObservabilityCandidate[]; skipped: SkippedSource<string>[] } // source: a namespace, or "*" for the all-namespaces list
export interface MetricSeries { label: string; points: [number, number][] }
export interface MetricRange { template: MetricTemplate; unit: MetricUnit; series: MetricSeries[]; truncated: boolean }
export interface BackendProbe { state: ProbeState; message: string; version: string | null }
export interface BackendLogLine { ts: string; line: string }
export interface BackendLogs { lines: BackendLogLine[]; truncated: boolean }
/** Stored on cluster-identity[context].observability (localStorage), already in the IPC shape. */
export interface Observability { prometheus?: ServiceTarget; logs?: LogsTarget }
