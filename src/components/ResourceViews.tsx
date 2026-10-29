import { memo, useState, useEffect, useRef, useMemo } from "react";
import {
  Layers, Package, PackageMinus, List, Clock, Briefcase, Network, Globe,
  FileCode, Lock, Database, Server, Activity, TrendingUp, Puzzle, ShieldAlert, GitBranch,
  ShieldCheck, Boxes, FolderGit2, X, RefreshCw, RefreshCcw, GitMerge,
  Waypoints, Split, Copy, Webhook, Camera, FolderTree,
} from "lucide-react";
import { GenericResourceTable, type Column } from "./GenericResourceTable";
import { ConfirmModal } from "./ConfirmModal";
import { PropagationPicker, deleteLabelFor, propagationDependents, usePropagationState } from "./PropagationPicker";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { argoBulkRefreshEquiv, argoBulkSyncEquiv, deleteEquiv, helmUninstallEquiv } from "../utils/kubectlEquiv";
import { checkBulk, disabledAttrs, pickDisabledReason } from "../utils/guardrails";
import { relativeFromIso, expiryState } from "../utils/expiry";
import { rangeSelect, shownRows, type SortState } from "../utils/tableRows";
import { nodePool, nodeZone, nodeInstanceType, type LabelHit } from "../utils/nodeLabels";
import {
  useDeployments, useStatefulSets, useDaemonSets, useJobs, useCronJobs, useHPAs,
  useServices, useIngresses, useConfigMaps, useSecrets, usePVCs, usePVs,
  useNodes, useEvents, useCRDs,
  useServiceAccounts, useRoles, useClusterRoles, useRoleBindings, useClusterRoleBindings,
  useNetworkPolicies, useHelmReleases, useStorageClasses, usePdbs, useArgoCdApps,
  useCertificates,
  useFluxKustomizations, useFluxHelmReleases, useGateways, useHttpRoutes,
  useResourceQuotas, useLimitRanges, usePriorityClasses,
  useDeleteResource, useUninstallHelmRelease,
  useArgoCdAppSets, useArgoCdProjects, useArgoCdRepositories,
  useBulkSyncArgoCdApps, useBulkRefreshArgoCdApps,
  usePermissions, useNamespaceRows,
  useEndpoints, useEndpointSlices, useReplicaSets,
  useMutatingWebhooks, useValidatingWebhooks, useVolumeSnapshots, useCRDResources,
} from "../hooks/useResources";
import type {
  Deployment, StatefulSet, DaemonSet, Job, CronJob, HPA, CRD,
  Service, Ingress, ConfigMap, Secret, PersistentVolumeClaim,
  PersistentVolume, NodeResource, K8sEvent,
  ServiceAccountRow, RBACRole, ClusterRole, RoleBinding, ClusterRoleBinding,
  NetworkPolicyRow, HelmRelease, StorageClassRow, PdbRow, ArgoCdApp, Certificate,
  FluxKustomization, FluxHelmRelease, GatewayInfo, HttpRouteInfo,
  ResourceQuotaInfo, LimitRangeInfo, PriorityClassInfo,
  ArgoCdAppSet, ArgoCdProject, ArgoCdRepository,
  EndpointsRow, EndpointSliceRow, ReplicaSetRow, WebhookConfigRow, VolumeSnapshotRow, CRDResource, NamespaceRow,
} from "../types/k8s";
import { podStatusStyle } from "../utils/podStatus";
import { chipLabels, deletingFor, isTerminating, namespaceDeleteReason } from "../utils/namespaces";

interface ViewProps { context: string; namespace: string; search?: string; selectedKey?: string | null; }

function parseAge(age: string): number {
  let s = 0;
  const d = /(\d+)d/.exec(age);   if (d)   s += +d[1] * 86400;
  const h = /(\d+)h/.exec(age);   if (h)   s += +h[1] * 3600;
  const m = /(\d+)m/.exec(age);   if (m)   s += +m[1] * 60;
  const sc = /(\d+)s/.exec(age);  if (sc)  s += +sc[1];
  return s;
}

const StatusDot = memo(function StatusDot({ status, text }: { status: string; text?: string }) {
  const colorMap: Record<string, string> = {
    Running: "bg-ok", Active: "bg-ok", Bound: "bg-ok", Ready: "bg-ok",
    Complete: "bg-info", Succeeded: "bg-info", Released: "bg-info",
    Pending: "bg-warn", Terminating: "bg-warn",
    Failed: "bg-bad", CrashLoopBackOff: "bg-bad", NotReady: "bg-bad",
    Unknown: "bg-dim", Lost: "bg-dim",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${colorMap[status] ?? "bg-dim"}`} />
      <span className="mono text-[11.5px] text-mute">{text ?? status}</span>
    </span>
  );
});

const N = ({ t }: { t: string }) => <span className="mono text-[12px] truncate">{t}</span>;
const Ns = ({ t }: { t: string }) => <span className="mono text-[11.5px] text-mute">{t}</span>;
const Dim = ({ t }: { t: string }) => <span className="mono text-[11.5px] text-dim tabular-nums">{t}</span>;
const Mute = ({ t }: { t: string }) => <span className="mono text-[11.5px] text-mute">{t}</span>;
function Img({ t }: { t: string }) {
  const short = t.split("/").pop() ?? t;
  return (
    <span className="mono text-[11px] text-dim truncate inline-block max-w-[200px] align-middle" title={t}>
      {short}
    </span>
  );
}

// ─── Deployments ─────────────────────────────────────────────────────────────

const deployColumns: Column<Deployment>[] = [
  { id: "name",      header: "Name",       sortable: true, sortValue: (d) => d.name,         cell: (d) => <N t={d.name} /> },
  { id: "ns",        header: "Namespace",  width: 130, sortable: true, sortValue: (d) => d.namespace,  cell: (d) => <Ns t={d.namespace} /> },
  { id: "ready",     header: "Ready",      width: 80,  sortable: true, sortValue: (d) => d.ready,      cell: (d) => <Mute t={d.ready} /> },
  { id: "uptodate",  header: "Up-to-date", width: 90,  sortable: true, sortValue: (d) => d.up_to_date, cell: (d) => <Mute t={String(d.up_to_date)} /> },
  { id: "available", header: "Available",  width: 90,  sortable: true, sortValue: (d) => d.available,  cell: (d) => <Mute t={String(d.available)} /> },
  { id: "image",     header: "Image",      width: 220,                                                  cell: (d) => <Img t={d.image} /> },
  { id: "age",       header: "Age",        width: 80,  sortable: true, sortValue: (d) => parseAge(d.age), cell: (d) => <Dim t={d.age} /> },
];

export const DeploymentView = memo(function DeploymentView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (d: Deployment) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useDeployments(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<Deployment | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const [propagation, setPropagation] = usePropagationState(deleteTarget !== null);
  const perm = usePermissions(context, namespace, "deploy");
  return (
    <>
      <GenericResourceTable context={context} columns={deployColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(d) => `${d.namespace}/${d.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Deployments" count={data.length}
        emptyIcon={<Layers size={32} />} emptyText="No deployments found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "deploy", name: deleteTarget?.name ?? "", propagation })}
        open={deleteTarget !== null}
        title="Delete Deployment"
        description={`Delete deployment "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel={deleteLabelFor(propagation)}
        destructive
        size="md"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "deploy", name: deleteTarget.name, propagation });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      >
        <PropagationPicker
          name={deleteTarget?.name ?? ""}
          dependents={propagationDependents("deploy") ?? "dependents"}
          value={propagation}
          onChange={setPropagation}
          disabled={deleteResource.isPending}
        />
      </ConfirmModal>
    </>
  );
});

// ─── StatefulSets ────────────────────────────────────────────────────────────

const stsColumns: Column<StatefulSet>[] = [
  { id: "name",     header: "Name",      sortable: true, sortValue: (s) => s.name,           cell: (s) => <N t={s.name} /> },
  { id: "ns",       header: "Namespace", width: 130, sortable: true, sortValue: (s) => s.namespace,  cell: (s) => <Ns t={s.namespace} /> },
  { id: "ready",    header: "Ready",     width: 80,  sortable: true, sortValue: (s) => s.ready,      cell: (s) => <Mute t={s.ready} /> },
  { id: "replicas", header: "Replicas",  width: 90,  sortable: true, sortValue: (s) => s.replicas,   cell: (s) => <Mute t={String(s.replicas)} /> },
  { id: "image",    header: "Image",     width: 220,                                                  cell: (s) => <Img t={s.image} /> },
  { id: "age",      header: "Age",       width: 80,  sortable: true, sortValue: (s) => parseAge(s.age), cell: (s) => <Dim t={s.age} /> },
];

export const StatefulSetView = memo(function StatefulSetView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (s: StatefulSet) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useStatefulSets(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<StatefulSet | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const [propagation, setPropagation] = usePropagationState(deleteTarget !== null);
  const perm = usePermissions(context, namespace, "sts");
  return (
    <>
      <GenericResourceTable context={context} columns={stsColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(s) => `${s.namespace}/${s.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="StatefulSets" count={data.length}
        emptyIcon={<Package size={32} />} emptyText="No StatefulSets found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "sts", name: deleteTarget?.name ?? "", propagation })}
        open={deleteTarget !== null}
        title="Delete StatefulSet"
        description={`Delete statefulset "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel={deleteLabelFor(propagation)}
        destructive
        size="md"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "sts", name: deleteTarget.name, propagation });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      >
        <PropagationPicker
          name={deleteTarget?.name ?? ""}
          dependents={propagationDependents("sts") ?? "dependents"}
          value={propagation}
          onChange={setPropagation}
          disabled={deleteResource.isPending}
        />
      </ConfirmModal>
    </>
  );
});

// ─── DaemonSets ───────────────────────────────────────────────────────────────

const dsColumns: Column<DaemonSet>[] = [
  { id: "name",      header: "Name",       sortable: true, sortValue: (d) => d.name,         cell: (d) => <N t={d.name} /> },
  { id: "ns",        header: "Namespace",  width: 130, sortable: true, sortValue: (d) => d.namespace,  cell: (d) => <Ns t={d.namespace} /> },
  { id: "desired",   header: "Desired",    width: 80,  sortable: true, sortValue: (d) => d.desired,    cell: (d) => <Mute t={String(d.desired)} /> },
  { id: "current",   header: "Current",    width: 80,  sortable: true, sortValue: (d) => d.current,    cell: (d) => <Mute t={String(d.current)} /> },
  { id: "ready",     header: "Ready",      width: 80,  sortable: true, sortValue: (d) => d.ready,      cell: (d) => <Mute t={String(d.ready)} /> },
  { id: "uptodate",  header: "Up-to-date", width: 90,  sortable: true, sortValue: (d) => d.up_to_date, cell: (d) => <Mute t={String(d.up_to_date)} /> },
  { id: "available", header: "Available",  width: 90,  sortable: true, sortValue: (d) => d.available,  cell: (d) => <Mute t={String(d.available)} /> },
  { id: "image",     header: "Image",      width: 200,                                                  cell: (d) => <Img t={d.image} /> },
  { id: "age",       header: "Age",        width: 80,  sortable: true, sortValue: (d) => parseAge(d.age), cell: (d) => <Dim t={d.age} /> },
];

export const DaemonSetView = memo(function DaemonSetView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (d: DaemonSet) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useDaemonSets(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<DaemonSet | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const [propagation, setPropagation] = usePropagationState(deleteTarget !== null);
  const perm = usePermissions(context, namespace, "ds");
  return (
    <>
      <GenericResourceTable context={context} columns={dsColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(d) => `${d.namespace}/${d.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="DaemonSets" count={data.length}
        emptyIcon={<List size={32} />} emptyText="No DaemonSets found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "ds", name: deleteTarget?.name ?? "", propagation })}
        open={deleteTarget !== null}
        title="Delete DaemonSet"
        description={`Delete daemonset "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel={deleteLabelFor(propagation)}
        destructive
        size="md"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "ds", name: deleteTarget.name, propagation });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      >
        <PropagationPicker
          name={deleteTarget?.name ?? ""}
          dependents={propagationDependents("ds") ?? "dependents"}
          value={propagation}
          onChange={setPropagation}
          disabled={deleteResource.isPending}
        />
      </ConfirmModal>
    </>
  );
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

const jobColumns: Column<Job>[] = [
  { id: "name",        header: "Name",        sortable: true, sortValue: (j) => j.name,           cell: (j) => <N t={j.name} /> },
  { id: "ns",          header: "Namespace",   width: 130, sortable: true, sortValue: (j) => j.namespace,  cell: (j) => <Ns t={j.namespace} /> },
  { id: "status",      header: "Status",      width: 120, sortable: true, sortValue: (j) => j.status,     cell: (j) => <StatusDot status={j.status} /> },
  { id: "completions", header: "Completions", width: 110,                                                  cell: (j) => <Mute t={j.completions} /> },
  { id: "duration",    header: "Duration",    width: 90,                                                   cell: (j) => <Dim t={j.duration} /> },
  { id: "image",       header: "Image",       width: 200,                                                  cell: (j) => <Img t={j.image} /> },
  { id: "age",         header: "Age",         width: 80,  sortable: true, sortValue: (j) => parseAge(j.age), cell: (j) => <Dim t={j.age} /> },
];

export const JobView = memo(function JobView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (j: Job) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useJobs(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const [propagation, setPropagation] = usePropagationState(deleteTarget !== null);
  const perm = usePermissions(context, namespace, "jobs");
  return (
    <>
      <GenericResourceTable context={context} columns={jobColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(j) => `${j.namespace}/${j.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Jobs" count={data.length}
        emptyIcon={<Briefcase size={32} />} emptyText="No jobs found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "jobs", name: deleteTarget?.name ?? "", propagation })}
        open={deleteTarget !== null}
        title="Delete Job"
        description={`Delete job "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel={deleteLabelFor(propagation)}
        destructive
        size="md"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "jobs", name: deleteTarget.name, propagation });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      >
        <PropagationPicker
          name={deleteTarget?.name ?? ""}
          dependents={propagationDependents("jobs") ?? "dependents"}
          value={propagation}
          onChange={setPropagation}
          disabled={deleteResource.isPending}
        />
      </ConfirmModal>
    </>
  );
});

// ─── CronJobs ────────────────────────────────────────────────────────────────

const cronColumns: Column<CronJob>[] = [
  { id: "name",      header: "Name",          sortable: true, sortValue: (c) => c.name,           cell: (c) => <N t={c.name} /> },
  { id: "ns",        header: "Namespace",     width: 130, sortable: true, sortValue: (c) => c.namespace,  cell: (c) => <Ns t={c.namespace} /> },
  { id: "schedule",  header: "Schedule",      width: 150, sortable: true, sortValue: (c) => c.schedule,   cell: (c) => <Mute t={c.schedule} /> },
  { id: "suspend",   header: "Suspend",       width: 90,                                                   cell: (c) => (
    <span className={`mono text-[11.5px] ${c.suspend ? "text-warn" : "text-dim"}`}>
      {c.suspend ? "true" : "false"}
    </span>
  )},
  { id: "active",    header: "Active",        width: 80,  sortable: true, sortValue: (c) => c.active,     cell: (c) => <Mute t={String(c.active)} /> },
  { id: "lastSched", header: "Last schedule", width: 130,                                                  cell: (c) => <Dim t={c.last_schedule} /> },
  { id: "age",       header: "Age",           width: 80,  sortable: true, sortValue: (c) => parseAge(c.age), cell: (c) => <Dim t={c.age} /> },
];

export const CronJobView = memo(function CronJobView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (c: CronJob) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useCronJobs(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const [propagation, setPropagation] = usePropagationState(deleteTarget !== null);
  const perm = usePermissions(context, namespace, "cron");
  return (
    <>
    <GenericResourceTable context={context} columns={cronColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(c) => `${c.namespace}/${c.name}`}
      selectedKey={selectedKey} onSelect={onSelect} search={search}
      title="CronJobs" count={data.length}
      emptyIcon={<Clock size={32} />} emptyText="No CronJobs found"
      onDelete={perm.canDelete ? setDeleteTarget : undefined}
      extra={deleteError ? (
        <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
          {deleteError}
          <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
        </div>
      ) : undefined}
    />
    <ConfirmModal
      contextLabel={identity.label}
      contextColor={identity.color}
      context={identity.context}
      kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "cron", name: deleteTarget?.name ?? "", propagation })}
      open={deleteTarget !== null}
      title="Delete CronJob"
      description={`Delete cronjob "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
      confirmLabel={deleteLabelFor(propagation)}
      destructive
      size="md"
      onConfirm={async () => {
        if (!deleteTarget) return;
        setDeleteError("");
        try {
          await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "cron", name: deleteTarget.name, propagation });
          setDeleteTarget(null);
        } catch (e) {
          setDeleteTarget(null);
          setDeleteError((e as any)?.message ?? String(e));
        }
      }}
      onCancel={() => setDeleteTarget(null)}
      isPending={deleteResource.isPending}
    >
      <PropagationPicker
        name={deleteTarget?.name ?? ""}
        dependents={propagationDependents("cron") ?? "dependents"}
        value={propagation}
        onChange={setPropagation}
        disabled={deleteResource.isPending}
      />
    </ConfirmModal>
    </>
  );
});

// ─── Services ────────────────────────────────────────────────────────────────

const svcColumns: Column<Service>[] = [
  { id: "name",       header: "Name",        sortable: true, sortValue: (s) => s.name,          cell: (s) => <N t={s.name} /> },
  { id: "ns",         header: "Namespace",   width: 130, sortable: true, sortValue: (s) => s.namespace, cell: (s) => <Ns t={s.namespace} /> },
  { id: "type",       header: "Type",        width: 110, sortable: true, sortValue: (s) => s.type_,     cell: (s) => <Mute t={s.type_} /> },
  { id: "clusterIP",  header: "Cluster IP",  width: 130,                                                 cell: (s) => <Mute t={s.cluster_ip} /> },
  { id: "externalIP", header: "External IP", width: 150,                                                 cell: (s) => <Dim t={s.external_ip || "—"} /> },
  { id: "ports",      header: "Ports",       width: 160,                                                 cell: (s) => <span className="mono text-[11px] text-mute">{s.ports}</span> },
  { id: "age",        header: "Age",         width: 80,  sortable: true, sortValue: (s) => parseAge(s.age), cell: (s) => <Dim t={s.age} /> },
];

export const ServiceView = memo(function ServiceView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (s: Service) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useServices(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "svc");
  return (
    <>
      <GenericResourceTable context={context} columns={svcColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(s) => `${s.namespace}/${s.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Services" count={data.length}
        emptyIcon={<Network size={32} />} emptyText="No services found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "svc", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Service"
        description={`Delete service "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "svc", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── Ingresses ───────────────────────────────────────────────────────────────

const ingColumns: Column<Ingress>[] = [
  { id: "name",    header: "Name",      sortable: true, sortValue: (i) => i.name,          cell: (i) => <N t={i.name} /> },
  { id: "ns",      header: "Namespace", width: 130, sortable: true, sortValue: (i) => i.namespace, cell: (i) => <Ns t={i.namespace} /> },
  { id: "class",   header: "Class",     width: 130, sortable: true, sortValue: (i) => i.class,     cell: (i) => <Mute t={i.class || "—"} /> },
  { id: "hosts",   header: "Hosts",     width: 200, sortable: true, sortValue: (i) => i.hosts,     cell: (i) => (
    <span className="mono text-[11.5px] text-mute truncate inline-block max-w-[190px]">{i.hosts}</span>
  )},
  { id: "address", header: "Address",   width: 150,                                                 cell: (i) => <Dim t={i.address || "—"} /> },
  { id: "ports",   header: "Ports",     width: 80,                                                  cell: (i) => <Dim t={i.ports} /> },
  { id: "age",     header: "Age",       width: 80,  sortable: true, sortValue: (i) => parseAge(i.age), cell: (i) => <Dim t={i.age} /> },
];

export const IngressView = memo(function IngressView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (i: Ingress) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useIngresses(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<Ingress | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "ing");
  return (
    <>
      <GenericResourceTable context={context} columns={ingColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(i) => `${i.namespace}/${i.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Ingresses" count={data.length}
        emptyIcon={<Globe size={32} />} emptyText="No ingresses found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "ing", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Ingress"
        description={`Delete ingress "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "ing", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── ConfigMaps ───────────────────────────────────────────────────────────────

const cmColumns: Column<ConfigMap>[] = [
  { id: "name", header: "Name",      sortable: true, sortValue: (c) => c.name,           cell: (c) => <N t={c.name} /> },
  { id: "ns",   header: "Namespace", width: 130, sortable: true, sortValue: (c) => c.namespace,  cell: (c) => <Ns t={c.namespace} /> },
  { id: "keys", header: "Keys",      width: 80,  sortable: true, sortValue: (c) => c.data_count, cell: (c) => <Mute t={String(c.data_count)} /> },
  { id: "age",  header: "Age",       width: 80,  sortable: true, sortValue: (c) => parseAge(c.age), cell: (c) => <Dim t={c.age} /> },
];

export const ConfigMapView = memo(function ConfigMapView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (c: ConfigMap) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useConfigMaps(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<ConfigMap | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "cm");
  return (
    <>
      <GenericResourceTable context={context} columns={cmColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(c) => `${c.namespace}/${c.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="ConfigMaps" count={data.length}
        emptyIcon={<FileCode size={32} />} emptyText="No ConfigMaps found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "cm", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete ConfigMap"
        description={`Delete configmap "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "cm", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── Secrets ─────────────────────────────────────────────────────────────────

const secColumns: Column<Secret>[] = [
  { id: "name", header: "Name",      sortable: true, sortValue: (s) => s.name,           cell: (s) => <N t={s.name} /> },
  { id: "ns",   header: "Namespace", width: 130, sortable: true, sortValue: (s) => s.namespace,  cell: (s) => <Ns t={s.namespace} /> },
  { id: "type", header: "Type",      width: 220, sortable: true, sortValue: (s) => s.type_,      cell: (s) => <Dim t={s.type_} /> },
  { id: "keys", header: "Keys",      width: 80,  sortable: true, sortValue: (s) => s.data_count, cell: (s) => <Mute t={String(s.data_count)} /> },
  { id: "age",  header: "Age",       width: 80,  sortable: true, sortValue: (s) => parseAge(s.age), cell: (s) => <Dim t={s.age} /> },
];

export const SecretView = memo(function SecretView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (s: Secret) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useSecrets(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<Secret | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "sec");
  return (
    <>
      <GenericResourceTable context={context} columns={secColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(s) => `${s.namespace}/${s.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Secrets" count={data.length}
        emptyIcon={<Lock size={32} />} emptyText="No secrets found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "sec", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Secret"
        description={`Delete secret "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "sec", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── PVCs ─────────────────────────────────────────────────────────────────────

const pvcColumns: Column<PersistentVolumeClaim>[] = [
  { id: "name",   header: "Name",          sortable: true, sortValue: (p) => p.name,          cell: (p) => <N t={p.name} /> },
  { id: "ns",     header: "Namespace",     width: 130, sortable: true, sortValue: (p) => p.namespace, cell: (p) => <Ns t={p.namespace} /> },
  { id: "status", header: "Status",        width: 110, sortable: true, sortValue: (p) => p.status,    cell: (p) => <StatusDot status={p.status} /> },
  { id: "volume", header: "Volume",        width: 200,                                                 cell: (p) => (
    <span className="mono text-[11.5px] text-mute truncate inline-block max-w-[190px]">{p.volume || "—"}</span>
  )},
  { id: "cap",    header: "Capacity",      width: 100,                                                 cell: (p) => <Mute t={p.capacity} /> },
  { id: "sc",     header: "Storage class", width: 160, sortable: true, sortValue: (p) => p.storage_class, cell: (p) => <Dim t={p.storage_class} /> },
  { id: "age",    header: "Age",           width: 80,  sortable: true, sortValue: (p) => parseAge(p.age), cell: (p) => <Dim t={p.age} /> },
];

export const PVCView = memo(function PVCView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (p: PersistentVolumeClaim) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = usePVCs(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<PersistentVolumeClaim | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "pvc");
  return (
    <>
      <GenericResourceTable context={context} columns={pvcColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(p) => `${p.namespace}/${p.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="PersistentVolumeClaims" count={data.length}
        emptyIcon={<Database size={32} />} emptyText="No PVCs found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "pvc", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete PersistentVolumeClaim"
        description={`Delete persistentvolumeclaim "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "pvc", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── PVs ──────────────────────────────────────────────────────────────────────

const pvColumns: Column<PersistentVolume>[] = [
  { id: "name",    header: "Name",           sortable: true, sortValue: (p) => p.name,             cell: (p) => <N t={p.name} /> },
  { id: "cap",     header: "Capacity",       width: 100,                                            cell: (p) => <Mute t={p.capacity} /> },
  { id: "access",  header: "Access modes",   width: 150,                                            cell: (p) => <Dim t={p.access_modes} /> },
  { id: "reclaim", header: "Reclaim policy", width: 130, sortable: true, sortValue: (p) => p.reclaim_policy, cell: (p) => <Mute t={p.reclaim_policy} /> },
  { id: "status",  header: "Status",         width: 100, sortable: true, sortValue: (p) => p.status,         cell: (p) => <StatusDot status={p.status} /> },
  { id: "claim",   header: "Claim",          width: 200,                                            cell: (p) => (
    <span className="mono text-[11.5px] text-mute truncate inline-block max-w-[190px]">{p.claim || "—"}</span>
  )},
  { id: "sc",      header: "Storage class",  width: 160, sortable: true, sortValue: (p) => p.storage_class,  cell: (p) => <Dim t={p.storage_class} /> },
  { id: "age",     header: "Age",            width: 80,  sortable: true, sortValue: (p) => parseAge(p.age),  cell: (p) => <Dim t={p.age} /> },
];

export const PVView = memo(function PVView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (p: PersistentVolume) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = usePVs(context);
  const [deleteTarget, setDeleteTarget] = useState<PersistentVolume | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "pv");
  return (
    <>
      <GenericResourceTable context={context} columns={pvColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(p) => p.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="PersistentVolumes" count={data.length}
        emptyIcon={<Database size={32} />} emptyText="No PersistentVolumes found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "pv", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete PersistentVolume"
        description={`This will permanently remove persistentvolume "${deleteTarget?.name}" from the cluster.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "pv", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── Namespaces (docs/ux/24 §4.4) ─────────────────────────────────────────────
// Cluster-scoped kind `ns`. Create is TopBar New / ⌘N (the existing namespace form); delete is the typed confirm
// that App hosts (DeleteNamespaceConfirm), opened from the row trash here and from the panel header.

/** Quiet when normal, loud when not: forty green pills would hide the one Terminating row that matters. */
function NamespaceStatus({ row }: { row: NamespaceRow }) {
  if (isTerminating(row)) {
    // The look of a Terminating pod: same table, same pulse.
    const s = podStatusStyle("Terminating");
    const since = deletingFor(row.deletion_timestamp);
    return (
      <span
        title={since ? `Deleting for ${since}` : "This namespace is being deleted."}
        className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11px] font-medium ${s.text} ${s.bg} ring-1 ${s.ring}`}
      >
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className={`absolute inset-0 rounded-full opacity-60 animate-blink ${s.dot}`} />
          <span className={`relative rounded-full h-1.5 w-1.5 ${s.dot}`} />
        </span>
        Terminating
      </span>
    );
  }
  if (row.phase === "Active") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-mute">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
        Active
      </span>
    );
  }
  if (row.phase === "") return <Mute t="—" />;
  // A phase this app does not know: the word, neutral.
  return (
    <span className="inline-flex items-center px-2 py-[3px] rounded-md text-[11px] font-medium text-mute bg-surface-tint/5 ring-1 ring-edge">
      {row.phase}
    </span>
  );
}

/** Up to two `key=value` chips, then `+N`. The title lists every label. */
function NamespaceLabels({ labels }: { labels: Record<string, string> }) {
  const all = chipLabels(labels);
  if (all.length === 0) return <Mute t="—" />;
  return (
    <span className="flex items-center gap-1 min-w-0" title={all.map(([k, v]) => `${k}=${v}`).join("\n")}>
      {all.slice(0, 2).map(([k, v]) => (
        <span key={k} className="mono text-[10.5px] px-1.5 py-0.5 rounded-sm bg-surface-tint/5 ring-1 ring-edge text-mute max-w-[150px] truncate">
          {k}={v}
        </span>
      ))}
      {all.length > 2 && <span className="mono text-[10.5px] text-mute shrink-0">+{all.length - 2}</span>}
    </span>
  );
}

const namespaceColumns: Column<NamespaceRow>[] = [
  { id: "name",   header: "Name",   sortable: true, sortValue: (r) => r.name,
    cell: (r) => <span className="mono text-[12px] truncate" title={r.name}>{r.name}</span> },
  { id: "status", header: "Status", width: 130, sortable: true, sortValue: (r) => r.phase, cell: (r) => <NamespaceStatus row={r} /> },
  { id: "age",    header: "Age",    width: 80,  sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Mute t={r.age} /> },
  { id: "labels", header: "Labels", cell: (r) => <NamespaceLabels labels={r.labels} /> },
];

export const NamespacesView = memo(function NamespacesView({ context, search, selectedKey, onSelect, onRequestDelete }: {
  context: string;
  search?: string;
  selectedKey?: string | null;
  onSelect?: (r: NamespaceRow) => void;
  onRequestDelete: (name: string) => void;
}) {
  // The page polls (5 s while any row is Terminating); the picker and the forms read the same query without an interval.
  const { data = [], isLoading, error, refetch } = useNamespaceRows(context, true);
  const perm = usePermissions(context, "", "ns");
  return (
    <GenericResourceTable context={context} columns={namespaceColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(r) => r.name}
      selectedKey={selectedKey} onSelect={onSelect} search={search}
      title="Namespaces" count={data.length} storageKey="ns"
      emptyIcon={<FolderTree size={32} />} emptyText="No namespaces found."
      onDelete={(r) => onRequestDelete(r.name)}
      // The table checks read-only first, so only the RBAC, protected and Terminating reasons are decided here.
      deleteReason={(r) => namespaceDeleteReason(r, { readOnly: false, canDelete: perm.canDelete })}
      deleteLabel={(r) => `Delete namespace ${r.name}`}
    />
  );
});

// ─── Nodes ────────────────────────────────────────────────────────────────────

const UsageBar = memo(function UsageBar({ pct }: { pct?: number }) {
  if (pct == null) return <span className="mono text-[11px] text-dim">—</span>;
  const color = pct >= 90 ? "bg-bad" : pct >= 70 ? "bg-warn" : "bg-ok";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1 w-14 rounded-full bg-surface-tint/[0.07] overflow-hidden">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`mono text-[11px] tabular-nums ${pct >= 90 ? "text-bad" : pct >= 70 ? "text-warn" : "text-mute"}`}>
        {pct}%
      </span>
    </span>
  );
});

const LabelCell = ({ hit, missing }: { hit: LabelHit | null; missing: string }) => (
  <span className={`mono text-[11.5px] ${hit ? "text-mute" : "text-dim"}`} title={hit ? `From label ${hit.key}` : missing}>{hit?.value ?? "—"}</span>
);

const nodeColumns: Column<NodeResource>[] = [
  { id: "name",    header: "Name",     sortable: true, sortValue: (n) => n.name,  cell: (n) => <N t={n.name} /> },
  { id: "status",  header: "Status",   width: 110, sortable: true, sortValue: (n) => n.status, cell: (n) => (
    <StatusDot status={n.status === "ok" ? "Ready" : "NotReady"} text={n.status === "ok" ? "Ready" : "Not Ready"} />
  )},
  { id: "sched",   header: "Schedulable", width: 140, cell: (n) => (
    n.unschedulable
      ? <span className="mono text-[11px] text-warn">SchedulingDisabled</span>
      : <span className="mono text-[11px] text-dim">Schedulable</span>
  )},
  { id: "version", header: "Version",  width: 120, sortable: true, sortValue: (n) => n.version, cell: (n) => <Dim t={n.version} /> },
  { id: "cpu",     header: "CPU cap",  width: 80,  cell: (n) => <Mute t={n.cpu_capacity} /> },
  { id: "cpuPct",  header: "CPU %",    width: 110, sortable: true, sortValue: (n) => n.cpu_percent ?? -1, cell: (n) => <UsageBar pct={n.cpu_percent} /> },
  { id: "mem",     header: "Mem cap",  width: 110, cell: (n) => <Mute t={n.memory_capacity} /> },
  { id: "memPct",  header: "Mem %",    width: 110, sortable: true, sortValue: (n) => n.mem_percent ?? -1, cell: (n) => <UsageBar pct={n.mem_percent} /> },
  { id: "pods",    header: "Pods",     width: 80,  sortable: true, sortValue: (n) => n.pod_count ?? 0, cell: (n) => (
    <Dim t={n.pod_count != null ? `${n.pod_count}/${n.pod_capacity}` : n.pod_capacity} />
  )},
  { id: "age",     header: "Age",      width: 80,  sortable: true, sortValue: (n) => parseAge(n.age), cell: (n) => <Dim t={n.age} /> },
  // #25: hidden until ticked in the column menu (defaultHidden on NodeView).
  { id: "pool",    header: "Pool",     width: 140, sortable: true, sortValue: (n) => nodePool(n.labels)?.value ?? "", cell: (n) => <LabelCell hit={nodePool(n.labels)} missing="No pool label found" /> },
  { id: "zone",    header: "Zone",     width: 140, sortable: true, sortValue: (n) => nodeZone(n.labels)?.value ?? "", cell: (n) => <LabelCell hit={nodeZone(n.labels)} missing="No zone label found" /> },
  { id: "itype",   header: "Instance type", width: 150, sortable: true, sortValue: (n) => nodeInstanceType(n.labels)?.value ?? "", cell: (n) => <LabelCell hit={nodeInstanceType(n.labels)} missing="No instance type label found" /> },
];

const NODE_DEFAULT_HIDDEN = ["pool", "zone", "itype"];

export const NodeView = memo(function NodeView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (n: NodeResource) => void }) {
  const { data = [], isLoading, error, refetch } = useNodes(context);
  return (
    <GenericResourceTable context={context} columns={nodeColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(n) => n.name}
      selectedKey={selectedKey} onSelect={onSelect} search={search}
      title="Nodes" count={data.length} storageKey="nodes" defaultHidden={NODE_DEFAULT_HIDDEN}
      emptyIcon={<Server size={32} />} emptyText="No nodes found" />
  );
});

// ─── HPAs ─────────────────────────────────────────────────────────────────────

const MetricUtil = memo(function MetricUtil({ cur, target, unit = "%" }: { cur?: number | string; target?: number | string; unit?: string }) {
  if (target == null) return <span className="mono text-[11.5px] text-dim">—</span>;
  const curNum = typeof cur === "string" ? parseFloat(cur) : cur;
  const tgtNum = typeof target === "string" ? parseFloat(target) : target;
  const over = curNum != null && tgtNum != null && curNum > tgtNum;
  const curStr = cur != null ? (typeof cur === "number" ? `${cur}${unit}` : cur) : "—";
  const tgtStr = typeof target === "number" ? `${target}${unit}` : target;
  return (
    <span className={`mono text-[11.5px] ${over ? "text-warn" : "text-mute"}`}>
      {curStr} / {tgtStr}
    </span>
  );
});

const hpaColumns: Column<HPA>[] = [
  { id: "name",     header: "Name",       sortable: true, sortValue: (h) => h.name,              cell: (h) => <N t={h.name} /> },
  { id: "ns",       header: "Namespace",  width: 130, sortable: true, sortValue: (h) => h.namespace,     cell: (h) => <Ns t={h.namespace} /> },
  { id: "ref",      header: "Reference",  width: 160, sortable: true, sortValue: (h) => h.reference,     cell: (h) => <Mute t={h.reference} /> },
  { id: "replicas", header: "Replicas",   width: 110, sortable: true, sortValue: (h) => h.current_replicas, cell: (h) => (
    <span className="mono text-[11.5px] text-mute">
      {h.current_replicas}/{h.max_replicas} (min {h.min_replicas})
    </span>
  )},
  { id: "cpu",      header: "CPU",        width: 110,                                             cell: (h) => <MetricUtil cur={h.cpu_current} target={h.cpu_target} unit="%" /> },
  { id: "mem",      header: "Memory",     width: 120,                                             cell: (h) => <MetricUtil cur={h.mem_current} target={h.mem_target} unit="" /> },
  { id: "age",      header: "Age",        width: 80,  sortable: true, sortValue: (h) => parseAge(h.age), cell: (h) => <Dim t={h.age} /> },
];

export const HPAView = memo(function HPAView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (h: HPA) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useHPAs(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<HPA | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "hpa");
  return (
    <>
      <GenericResourceTable context={context} columns={hpaColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(h) => `${h.namespace}/${h.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="HorizontalPodAutoscalers" count={data.length}
        emptyIcon={<TrendingUp size={32} />} emptyText="No HPAs found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "hpa", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete HorizontalPodAutoscaler"
        description={`Delete horizontalpodautoscaler "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "hpa", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── CRDs ─────────────────────────────────────────────────────────────────────

const crdColumns: Column<CRD>[] = [
  { id: "name",     header: "Name",      sortable: true, sortValue: (c) => c.name,          cell: (c) => <N t={c.name} /> },
  { id: "group",    header: "Group",     width: 200, sortable: true, sortValue: (c) => c.group,  cell: (c) => <Dim t={c.group} /> },
  { id: "kind",     header: "Kind",      width: 150, sortable: true, sortValue: (c) => c.kind,   cell: (c) => <Mute t={c.kind} /> },
  { id: "scope",    header: "Scope",     width: 120, sortable: true, sortValue: (c) => c.scope,  cell: (c) => (
    <span className={`mono text-[11.5px] ${c.scope === "Namespaced" ? "text-accent" : "text-dim"}`}>{c.scope}</span>
  )},
  { id: "versions", header: "Versions",  width: 100,                                         cell: (c) => <Dim t={c.versions} /> },
  { id: "status",   header: "Status",    width: 110, sortable: true, sortValue: (c) => c.established ? "Ready" : "Pending", cell: (c) => <StatusDot status={c.established ? "Ready" : "Pending"} text={c.established ? "Established" : "Pending"} /> },
  { id: "age",      header: "Age",       width: 80,  sortable: true, sortValue: (c) => parseAge(c.age), cell: (c) => <Dim t={c.age} /> },
];

export const CRDView = memo(function CRDView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (c: CRD) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useCRDs(context);
  const [deleteTarget, setDeleteTarget] = useState<CRD | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "crd");
  return (
    <>
      <GenericResourceTable context={context} columns={crdColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(c) => c.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="CustomResourceDefinitions" count={data.length}
        emptyIcon={<Puzzle size={32} />} emptyText="No CRDs found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "crd", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete CustomResourceDefinition"
        description={`This will permanently remove customresourcedefinition "${deleteTarget?.name}" from the cluster. Deleting this CRD will also delete all custom resources of kind ${deleteTarget?.kind ?? ""} across the cluster.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "crd", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── Events ───────────────────────────────────────────────────────────────────

const eventColumns: Column<K8sEvent>[] = [
  { id: "type",    header: "Type",    width: 90,  cell: (e) => (
    <span className={`mono text-[11px] font-medium ${e.type_ === "Warning" ? "text-warn" : "text-dim"}`}>
      {e.type_}
    </span>
  )},
  { id: "reason",  header: "Reason",  width: 140, cell: (e) => <Mute t={e.reason} /> },
  { id: "object",  header: "Object",  width: 200, cell: (e) => (
    <span className="mono text-[11.5px] text-mute truncate inline-block max-w-[190px]">{e.object}</span>
  )},
  { id: "message", header: "Message",             cell: (e) => (
    <span className="text-[11.5px] text-ink/80 truncate inline-block max-w-[300px]" title={e.message}>{e.message}</span>
  )},
  { id: "count",   header: "Count",   width: 70,  cell: (e) => <Dim t={String(e.count)} /> },
  { id: "source",  header: "Source",  width: 140, cell: (e) => <span className="mono text-[11px] text-dim">{e.source}</span> },
  { id: "age",     header: "Age",     width: 80,  cell: (e) => <Dim t={e.age} /> },
];

export const EventView = memo(function EventView({ context, namespace }: ViewProps) {
  const { data = [], isLoading, error, refetch } = useEvents(context, namespace);
  return (
    <GenericResourceTable context={context} columns={eventColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(e) => e.name}
      title="Events" count={data.length}
      emptyIcon={<Activity size={32} />} emptyText="No events found" />
  );
});

// ─── ServiceAccounts ─────────────────────────────────────────────────────────

const saColumns: Column<ServiceAccountRow>[] = [
  { id: "name", header: "Name",      sortable: true, sortValue: (s) => s.name,      cell: (s) => <N t={s.name} /> },
  { id: "ns",   header: "Namespace", width: 160, sortable: true, sortValue: (s) => s.namespace, cell: (s) => <Ns t={s.namespace} /> },
  { id: "age",  header: "Age",       width: 80,  sortable: true, sortValue: (s) => parseAge(s.age), cell: (s) => <Dim t={s.age} /> },
];
export const ServiceAccountView = memo(function ServiceAccountView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (s: ServiceAccountRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useServiceAccounts(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<ServiceAccountRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "sa");
  return (
    <>
      <GenericResourceTable context={context} columns={saColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(s) => `${s.namespace}/${s.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="ServiceAccounts" count={data.length}
        emptyIcon={<Server size={32} />} emptyText="No service accounts found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "sa", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete ServiceAccount"
        description={`Delete serviceaccount "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "sa", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── Roles ───────────────────────────────────────────────────────────────────

const roleColumns: Column<RBACRole>[] = [
  { id: "name",  header: "Name",       sortable: true, sortValue: (r) => r.name,       cell: (r) => <N t={r.name} /> },
  { id: "ns",    header: "Namespace",  width: 160, sortable: true, sortValue: (r) => r.namespace,  cell: (r) => <Ns t={r.namespace} /> },
  { id: "rules", header: "Rules",      width: 80,  sortable: true, sortValue: (r) => r.rules_count, cell: (r) => <Mute t={String(r.rules_count)} /> },
  { id: "age",   header: "Age",        width: 80,  sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];
export const RoleView = memo(function RoleView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: RBACRole) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useRoles(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<RBACRole | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "roles");
  return (
    <>
      <GenericResourceTable context={context} columns={roleColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Roles" count={data.length}
        emptyIcon={<Lock size={32} />} emptyText="No roles found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "roles", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Role"
        description={`Delete role "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "roles", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── ClusterRoles ─────────────────────────────────────────────────────────────

const croleColumns: Column<ClusterRole>[] = [
  { id: "name",  header: "Name",  sortable: true, sortValue: (r) => r.name,        cell: (r) => <N t={r.name} /> },
  { id: "rules", header: "Rules", width: 80, sortable: true, sortValue: (r) => r.rules_count, cell: (r) => <Mute t={String(r.rules_count)} /> },
  { id: "age",   header: "Age",   width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];
export const ClusterRoleView = memo(function ClusterRoleView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (r: ClusterRole) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useClusterRoles(context);
  const [deleteTarget, setDeleteTarget] = useState<ClusterRole | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "croles");
  return (
    <>
      <GenericResourceTable context={context} columns={croleColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => r.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="ClusterRoles" count={data.length}
        emptyIcon={<Lock size={32} />} emptyText="No cluster roles found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "croles", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete ClusterRole"
        description={`This will permanently remove clusterrole "${deleteTarget?.name}" from the cluster.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "croles", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── RoleBindings ─────────────────────────────────────────────────────────────

const rbColumns: Column<RoleBinding>[] = [
  { id: "name",     header: "Name",       sortable: true, sortValue: (r) => r.name,     cell: (r) => <N t={r.name} /> },
  { id: "ns",       header: "Namespace",  width: 140, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "roleref",  header: "Role ref",   width: 200, cell: (r) => <Mute t={r.role_ref} /> },
  { id: "subjects", header: "Subjects",   width: 200, cell: (r) => <Dim t={r.subjects} /> },
  { id: "age",      header: "Age",        width: 80,  sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];
export const RoleBindingView = memo(function RoleBindingView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: RoleBinding) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useRoleBindings(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<RoleBinding | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "rbindings");
  return (
    <>
      <GenericResourceTable context={context} columns={rbColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="RoleBindings" count={data.length}
        emptyIcon={<Lock size={32} />} emptyText="No role bindings found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "rbindings", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete RoleBinding"
        description={`Delete rolebinding "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "rbindings", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── ClusterRoleBindings ──────────────────────────────────────────────────────

const crbColumns: Column<ClusterRoleBinding>[] = [
  { id: "name",     header: "Name",      sortable: true, sortValue: (r) => r.name,     cell: (r) => <N t={r.name} /> },
  { id: "roleref",  header: "Role ref",  width: 200, cell: (r) => <Mute t={r.role_ref} /> },
  { id: "subjects", header: "Subjects",  width: 200, cell: (r) => <Dim t={r.subjects} /> },
  { id: "age",      header: "Age",       width: 80,  sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];
export const ClusterRoleBindingView = memo(function ClusterRoleBindingView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (r: ClusterRoleBinding) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useClusterRoleBindings(context);
  const [deleteTarget, setDeleteTarget] = useState<ClusterRoleBinding | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "crbindings");
  return (
    <>
      <GenericResourceTable context={context} columns={crbColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => r.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="ClusterRoleBindings" count={data.length}
        emptyIcon={<Lock size={32} />} emptyText="No cluster role bindings found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "crbindings", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete ClusterRoleBinding"
        description={`This will permanently remove clusterrolebinding "${deleteTarget?.name}" from the cluster.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "crbindings", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── NetworkPolicies ──────────────────────────────────────────────────────────

const netpolColumns: Column<NetworkPolicyRow>[] = [
  { id: "name",     header: "Name",         sortable: true, sortValue: (n) => n.name,      cell: (n) => <N t={n.name} /> },
  { id: "ns",       header: "Namespace",    width: 140, sortable: true, sortValue: (n) => n.namespace, cell: (n) => <Ns t={n.namespace} /> },
  { id: "selector", header: "Pod selector", width: 180, cell: (n) => <Mute t={n.pod_selector} /> },
  { id: "ingress",  header: "Ingress",      width: 80,  cell: (n) => <Dim t={String(n.ingress_count)} /> },
  { id: "egress",   header: "Egress",       width: 80,  cell: (n) => <Dim t={String(n.egress_count)} /> },
  { id: "types",    header: "Policy types", width: 160, cell: (n) => <Mute t={n.policy_types || "—"} /> },
  { id: "age",      header: "Age",          width: 80,  sortable: true, sortValue: (n) => parseAge(n.age), cell: (n) => <Dim t={n.age} /> },
];
export const NetworkPolicyView = memo(function NetworkPolicyView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (n: NetworkPolicyRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useNetworkPolicies(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<NetworkPolicyRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "netpol");
  return (
    <>
      <GenericResourceTable context={context} columns={netpolColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(n) => `${n.namespace}/${n.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="NetworkPolicies" count={data.length}
        emptyIcon={<Network size={32} />} emptyText="No network policies found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "netpol", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete NetworkPolicy"
        description={`Delete networkpolicy "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "netpol", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── Helm Releases ────────────────────────────────────────────────────────────

const helmStatusColor: Record<string, string> = {
  deployed:   "text-ok",
  failed:     "text-bad",
  pending:    "text-warn",
  superseded: "text-dim",
  uninstalled: "text-dim",
};

const helmColumns: Column<HelmRelease>[] = [
  { id: "name",    header: "Name",        sortable: true, sortValue: (h) => h.name,        cell: (h) => <N t={h.name} /> },
  { id: "ns",      header: "Namespace",   width: 140, sortable: true, sortValue: (h) => h.namespace, cell: (h) => <Ns t={h.namespace} /> },
  { id: "chart",   header: "Chart",       width: 180, sortable: true, sortValue: (h) => h.chart,     cell: (h) => <Mute t={h.chart} /> },
  { id: "appver",  header: "App version", width: 120, cell: (h) => <Dim t={h.app_version} /> },
  { id: "status",  header: "Status",      width: 110, sortable: true, sortValue: (h) => h.status,    cell: (h) => (
    <span className={`mono text-[11.5px] ${helmStatusColor[h.status] ?? "text-mute"}`}>{h.status}</span>
  )},
  { id: "rev",     header: "Rev",         width: 60, cell: (h) => <Dim t={h.revision} /> },
  { id: "updated", header: "Updated",     width: 160, cell: (h) => <Dim t={h.updated.split(".")[0]} /> },
];
export const HelmView = memo(function HelmView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (h: HelmRelease) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useHelmReleases(context);
  const [deleteTarget, setDeleteTarget] = useState<HelmRelease | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const uninstall = useUninstallHelmRelease();
  return (
    <>
      <GenericResourceTable context={context} columns={helmColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(h) => `${h.namespace}/${h.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Helm Releases" count={data.length}
        emptyIcon={<Package size={32} />} emptyText="No Helm releases found (is helm installed?)"
        onDelete={setDeleteTarget}
        deleteLabel="Uninstall"
        deleteIcon={<PackageMinus size={12} />}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={helmUninstallEquiv({ context, namespace: deleteTarget?.namespace ?? "", release: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Uninstall Helm Release"
        description={`Uninstall Helm release "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This runs "helm uninstall" and cannot be undone.`}
        confirmLabel="Uninstall"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await uninstall.mutateAsync({ context, namespace: deleteTarget.namespace, release: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={uninstall.isPending}
      />
    </>
  );
});

// ─── StorageClasses ───────────────────────────────────────────────────────────

const scColumns: Column<StorageClassRow>[] = [
  { id: "name",        header: "Name",           sortable: true, sortValue: (s) => s.name, cell: (s) => (
    <span className="flex items-center gap-1.5">
      <N t={s.name} />
      {s.is_default && <span className="mono text-[10.5px] px-1 py-0.5 rounded-sm bg-ok/10 text-ok ring-1 ring-ok/30">default</span>}
    </span>
  )},
  { id: "provisioner", header: "Provisioner",    sortable: true, sortValue: (s) => s.provisioner, cell: (s) => <Mute t={s.provisioner} /> },
  { id: "reclaim",     header: "Reclaim policy", width: 130, cell: (s) => <Dim t={s.reclaim_policy} /> },
  { id: "binding",     header: "Binding mode",   width: 160, cell: (s) => <Dim t={s.volume_binding_mode} /> },
  { id: "expand",      header: "Expandable",     width: 100, cell: (s) => (
    <span className={s.allow_volume_expansion ? "text-ok mono text-[11.5px]" : "text-dim mono text-[11.5px]"}>
      {s.allow_volume_expansion ? "yes" : "no"}
    </span>
  )},
  { id: "age",         header: "Age",            width: 80, sortable: true, sortValue: (s) => parseAge(s.age), cell: (s) => <Dim t={s.age} /> },
];

export const StorageClassView = memo(function StorageClassView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (s: StorageClassRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useStorageClasses(context);
  const [deleteTarget, setDeleteTarget] = useState<StorageClassRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "sc");
  return (
    <>
      <GenericResourceTable context={context} columns={scColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(s) => s.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="StorageClasses" count={data.length}
        emptyIcon={<Database size={32} />} emptyText="No storage classes found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "sc", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete StorageClass"
        description={`This will permanently remove storageclass "${deleteTarget?.name}" from the cluster.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "sc", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── PodDisruptionBudgets ─────────────────────────────────────────────────────

const pdbColumns: Column<PdbRow>[] = [
  { id: "name",    header: "Name",        sortable: true, sortValue: (p) => p.name,      cell: (p) => <N t={p.name} /> },
  { id: "ns",      header: "Namespace",   width: 140, sortable: true, sortValue: (p) => p.namespace, cell: (p) => <Ns t={p.namespace} /> },
  { id: "minavail",header: "Min available", width: 110, cell: (p) => <Mute t={p.min_available} /> },
  { id: "maxuna",  header: "Max unavailable", width: 130, cell: (p) => <Mute t={p.max_unavailable} /> },
  { id: "desired", header: "Desired",     width: 80, sortable: true, sortValue: (p) => p.desired_healthy, cell: (p) => <Dim t={String(p.desired_healthy)} /> },
  { id: "current", header: "Healthy",     width: 80, sortable: true, sortValue: (p) => p.current_healthy, cell: (p) => (
    <span className={`mono text-[11.5px] tabular-nums ${p.current_healthy >= p.desired_healthy ? "text-ok" : "text-bad"}`}>
      {p.current_healthy}
    </span>
  )},
  { id: "allowed", header: "Allowed",     width: 80, sortable: true, sortValue: (p) => p.disruptions_allowed, cell: (p) => <Dim t={String(p.disruptions_allowed)} /> },
  { id: "age",     header: "Age",         width: 80, sortable: true, sortValue: (p) => parseAge(p.age), cell: (p) => <Dim t={p.age} /> },
];

export const PDBView = memo(function PDBView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (p: PdbRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = usePdbs(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<PdbRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "pdb");
  return (
    <>
      <GenericResourceTable context={context} columns={pdbColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(p) => `${p.namespace}/${p.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="PodDisruptionBudgets" count={data.length}
        emptyIcon={<ShieldAlert size={32} />} emptyText="No PodDisruptionBudgets found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "pdb", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete PodDisruptionBudget"
        description={`Delete poddisruptionbudget "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "pdb", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── ArgoCD Applications ──────────────────────────────────────────────────────

function healthPillClass(status: string): string {
  switch (status) {
    case "Healthy":     return "bg-ok/10 text-ok ring-1 ring-ok/30";
    case "Degraded":    return "bg-bad/10 text-bad ring-1 ring-bad/30";
    case "Progressing": return "bg-status-progress/10 text-status-progress ring-1 ring-status-progress/30";
    default:            return "bg-surface-tint/4 text-mute ring-1 ring-edge";
  }
}

function healthIcon(status: string): string {
  switch (status) {
    case "Healthy":
    case "Degraded":  return "●";
    case "Progressing": return "↻";
    default:          return "?";
  }
}

function syncPillClass(status: string): string {
  switch (status) {
    case "Synced":    return "bg-ok/10 text-ok ring-1 ring-ok/30";
    case "OutOfSync": return "bg-warn/10 text-warn ring-1 ring-warn/30";
    default:          return "bg-surface-tint/4 text-mute ring-1 ring-edge";
  }
}

function syncIcon(status: string): string {
  switch (status) {
    case "Synced":    return "✓";
    case "OutOfSync": return "↑";
    default:          return "?";
  }
}

const repoShort = (url: string): string => {
  try {
    const parts = url.replace(/\.git$/, "").split("/");
    return parts[parts.length - 1] || url;
  } catch { return url; }
};

const PILL = "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] mono font-medium";
/** A focus ring of at least 3:1 in both themes (X-8, ui.md G6). */
const ARGO_FOCUS = "outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70";

const argoColumns: Column<ArgoCdApp>[] = [
  { id: "name",    header: "Name",        sortable: true, sortValue: (a) => a.name,     cell: (a) => <N t={a.name} /> },
  { id: "ns",      header: "Namespace",   width: 130, sortable: true, sortValue: (a) => a.namespace, cell: (a) => <Ns t={a.namespace} /> },
  { id: "project", header: "Project",     width: 120, sortable: true, sortValue: (a) => a.project,   cell: (a) => <Mute t={a.project} /> },
  { id: "health",  header: "Health",      width: 110, sortable: true, sortValue: (a) => a.health_status, cell: (a) => (
    <span className={`${PILL} ${healthPillClass(a.health_status)}`}>
      <span aria-hidden>{healthIcon(a.health_status)}</span>
      {a.health_status || "—"}
    </span>
  )},
  { id: "sync",    header: "Sync",        width: 100, sortable: true, sortValue: (a) => a.sync_status, cell: (a) => (
    <span className={`${PILL} ${syncPillClass(a.sync_status)}`}>
      <span aria-hidden>{syncIcon(a.sync_status)}</span>
      {a.sync_status || "—"}
    </span>
  )},
  { id: "dest",    header: "Destination", width: 150, cell: (a) => (
    <div className="flex flex-col" title={a.dest_server}>
      <span className="mono text-[11.5px] text-mute truncate max-w-[140px]">{a.dest_namespace || "—"}</span>
      <span className="mono text-[10.5px] text-mute truncate max-w-[140px]">{a.dest_server.replace(/^https?:\/\//, "")}</span>
    </div>
  )},
  { id: "repo",    header: "Repo",        width: 160, cell: (a) => (
    <span className="mono text-[11px] text-mute truncate inline-block max-w-[150px]" title={a.repo_url}>{repoShort(a.repo_url)}</span>
  )},
  { id: "rev",     header: "Revision",    width: 100, cell: (a) => (
    // last_commit and target_revision can be a full chart version, tag or branch name: cut with an ellipsis, whole value in the tooltip.
    <div className="flex flex-col">
      <span className="mono text-[11.5px] text-mute tabular-nums truncate block max-w-[90px]" title={a.last_commit || undefined}>{a.last_commit || "—"}</span>
      <span className="mono text-[10.5px] text-mute tabular-nums truncate block max-w-[90px]" title={a.target_revision || undefined}>{a.target_revision || "HEAD"}</span>
    </div>
  )},
  { id: "synced",  header: "Synced",      width: 100, sortable: true, sortValue: (a) => parseAge(a.age), cell: (a) => (
    <div className="flex flex-col">
      <span className="mono text-[11.5px] text-mute tabular-nums">{a.last_synced_at || "—"}</span>
      <span className="mono text-[10.5px] text-mute tabular-nums">{a.age}</span>
    </div>
  )},
];

// ─── ArgoCD health strip — Lens's "needs attention" panel as 7 compact cards ──

type ArgoFilter = "all" | "healthy" | "degraded" | "missing" | "progressing" | "outofsynced" | "synced";

function ArgoHealthCard({ label, value, active, color, onClick }: {
  label: string; value: number; active: boolean; /** A `text-*` class. */ color: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg ring-1 px-2 py-1 flex flex-col items-start min-w-[56px] transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${
        active ? "bg-surface-tint/[0.07] ring-accent/70" : "bg-card/70 ring-edge hover:bg-surface-tint/4"
      }`}
    >
      <span className="text-[10.5px] uppercase tracking-wide text-mute font-medium">{label}</span>
      <span className={`text-[14px] font-semibold tabular-nums leading-tight ${color}`}>{value}</span>
    </button>
  );
}

function ArgoCdHealthStrip({ apps, filter, setFilter }: {
  apps: ArgoCdApp[]; filter: ArgoFilter; setFilter: (f: ArgoFilter) => void;
}) {
  const cards: { key: ArgoFilter; label: string; value: number; color: string }[] = [
    { key: "all",         label: "Total",       value: apps.length, color: "text-ink" },
    { key: "synced",      label: "Synced",      value: apps.filter(a => a.sync_status === "Synced").length,        color: "text-ok" },
    { key: "healthy",     label: "Healthy",     value: apps.filter(a => a.health_status === "Healthy").length,     color: "text-ok" },
    { key: "outofsynced", label: "OutOfSync",   value: apps.filter(a => a.sync_status === "OutOfSync").length,     color: "text-warn" },
    { key: "degraded",    label: "Degraded",    value: apps.filter(a => a.health_status === "Degraded").length,    color: "text-bad" },
    { key: "missing",     label: "Missing",     value: apps.filter(a => a.health_status === "Missing").length,     color: "text-warn" },
    { key: "progressing", label: "Progressing", value: apps.filter(a => a.health_status === "Progressing").length, color: "text-status-progress" },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {cards.map((c) => (
        <ArgoHealthCard key={c.key} label={c.label} value={c.value} active={filter === c.key} color={c.color}
          onClick={() => setFilter(c.key === "all" ? "all" : filter === c.key ? "all" : c.key)} />
      ))}
    </div>
  );
}

/** The table key of an Application (`namespace/name`); also the bulk-selection key. */
const argoKey = (a: ArgoCdApp): string => `${a.namespace}/${a.name}`;

const ARGO_FILTER_PREDICATE: Partial<Record<ArgoFilter, (a: ArgoCdApp) => boolean>> = {
  healthy:     (a) => a.health_status === "Healthy",
  degraded:    (a) => a.health_status === "Degraded",
  missing:     (a) => a.health_status === "Missing",
  progressing: (a) => a.health_status === "Progressing",
  outofsynced: (a) => a.sync_status === "OutOfSync",
  synced:      (a) => a.sync_status === "Synced",
};

export const ArgoCDView = memo(function ArgoCDView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (a: ArgoCdApp) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useArgoCdApps(context);
  const [filter, setFilter] = useState<ArgoFilter>("all");
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const lastCheckedRef = useRef<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"sync" | "refresh" | "hardRefresh" | null>(null);
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: { name: string; error: string }[] } | null>(null);

  const bulkSync = useBulkSyncArgoCdApps();
  const bulkRefresh = useBulkRefreshArgoCdApps();

  const [sort, setSort] = useState<SortState | null>(null);

  const filtered = useMemo(
    () => (filter === "all" ? data : data.filter(ARGO_FILTER_PREDICATE[filter]!)),
    [data, filter],
  );
  // Exactly the rows the table shows (health filter, then its search, in its sort order). Select
  // all, the shift-range and the bulk actions all work from this list, never from `filtered`.
  const shown = useMemo(
    () => shownRows(filtered, search, argoKey, argoColumns, sort),
    [filtered, search, sort],
  );

  // Stale keys after a filter/search change would make "N selected" lie about what's visible.
  useEffect(() => {
    setBulkSelected(new Set());
    lastCheckedRef.current = null;
  }, [filter, search]);

  const handleBulkCheck = (app: ArgoCdApp, shiftHeld: boolean) => {
    const key = argoKey(app);
    // Read the anchor now: the updater below may run after the ref has moved on.
    const anchor = lastCheckedRef.current;
    const order = shown.map(argoKey);
    lastCheckedRef.current = key;
    setBulkSelected(prev => rangeSelect(prev, order, anchor, key, shiftHeld));
  };

  const columns = useMemo<Column<ArgoCdApp>[]>(() => [
    {
      id: "sel", header: "", width: 28, interactive: true,
      cell: (a) => {
        const key = argoKey(a);
        return (
          <input
            type="checkbox"
            checked={bulkSelected.has(key)}
            onClick={(e) => { e.stopPropagation(); handleBulkCheck(a, e.shiftKey); }}
            onChange={() => {}}
            className="w-3.5 h-3.5 accent-accent cursor-pointer"
          />
        );
      },
    },
    ...argoColumns,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [bulkSelected, shown]);

  const selectedApps = shown.filter(a => bulkSelected.has(argoKey(a)));

  const confirmCopy: Record<"sync" | "refresh" | "hardRefresh", { title: string; description: string; confirmLabel: string }> = {
    sync: {
      title: "Sync applications",
      description: `Sync ${selectedApps.length} application${selectedApps.length !== 1 ? "s" : ""}. Prune is disabled for bulk operations.`,
      confirmLabel: "Sync",
    },
    refresh: {
      title: "Refresh applications",
      description: `Refresh ${selectedApps.length} application${selectedApps.length !== 1 ? "s" : ""} from git.`,
      confirmLabel: "Refresh",
    },
    hardRefresh: {
      title: "Hard refresh applications",
      description: `Hard refresh ${selectedApps.length} application${selectedApps.length !== 1 ? "s" : ""} — clears ArgoCD's cache and re-fetches manifests from git.`,
      confirmLabel: "Hard refresh",
    },
  };

  const isBulkPending = bulkSync.isPending || bulkRefresh.isPending;
  // G2 + read-only: the bulk buttons are disabled with ONE reason (read-only first, then the limit).
  const bulkLimit = checkBulk(selectedApps.length, identity.bulkLimit, identity.label || context);
  const bulkReason = pickDisabledReason({ readOnly: identity.readOnly, capability: bulkLimit.message ?? undefined });
  const bulkEquivalent = confirmAction === null
    ? null
    : confirmAction === "sync"
      ? argoBulkSyncEquiv({ context, apps: selectedApps })
      : argoBulkRefreshEquiv({ context, apps: selectedApps, hard: confirmAction === "hardRefresh" });

  const handleConfirmBulk = async () => {
    if (!confirmAction) return;
    const items = selectedApps.map(a => ({ context, namespace: a.namespace, name: a.name }));
    try {
      const result = confirmAction === "sync"
        ? await bulkSync.mutateAsync(items)
        : await bulkRefresh.mutateAsync(items.map(i => ({ ...i, hard: confirmAction === "hardRefresh" })));
      setBulkResult(result);
      setBulkSelected(new Set());
    } catch (e) {
      // e.g. the read-only backstop: nothing was sent.
      setBulkResult({ ok: 0, failed: [{ name: "all selected", error: (e as any)?.message ?? String(e) }] });
    }
    setConfirmAction(null);
  };

  const bulkBar = selectedApps.length > 0 ? (
    <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
      <span className="mono text-[11px] text-accent font-semibold shrink-0">{selectedApps.length} selected</span>
      <button type="button" onClick={() => setBulkSelected(new Set())} className={`h-6 px-2 rounded-sm text-[11px] text-mute hover:text-ink bg-surface-tint/3 ring-1 ring-edge flex items-center gap-1 ${ARGO_FOCUS}`}>
        <X size={10} aria-hidden /> Clear
      </button>
      <button type="button" onClick={() => setBulkSelected(new Set(shown.map(argoKey)))} className={`h-6 px-2 rounded-sm text-[11px] text-mute hover:text-ink bg-card/70 ring-1 ring-edge ${ARGO_FOCUS}`}>
        Select all
      </button>
      <button type="button" onClick={() => { if (bulkReason) return; setConfirmAction("sync"); }} {...disabledAttrs(bulkReason)} className={`h-6 px-2.5 rounded-sm text-[11px] text-accent hover:bg-accent/20 bg-accent/10 ring-1 ring-accent/30 flex items-center gap-1.5 ${ARGO_FOCUS} ${bulkReason ? "opacity-50 cursor-not-allowed" : ""}`}>
        <GitMerge size={11} aria-hidden /> Sync
      </button>
      <button type="button" onClick={() => { if (bulkReason) return; setConfirmAction("refresh"); }} {...disabledAttrs(bulkReason)} className={`h-6 px-2.5 rounded-sm text-[11px] text-mute hover:text-ink bg-card/70 ring-1 ring-edge flex items-center gap-1.5 ${ARGO_FOCUS} ${bulkReason ? "opacity-50 cursor-not-allowed" : ""}`}>
        <RefreshCw size={11} aria-hidden /> Refresh
      </button>
      <button type="button" onClick={() => { if (bulkReason) return; setConfirmAction("hardRefresh"); }} {...disabledAttrs(bulkReason)} className={`h-6 px-2.5 rounded-sm text-[11px] text-mute hover:text-ink bg-card/70 ring-1 ring-edge flex items-center gap-1.5 ${ARGO_FOCUS} ${bulkReason ? "opacity-50 cursor-not-allowed" : ""}`}>
        <RefreshCcw size={11} aria-hidden /> Hard refresh
      </button>
      {bulkLimit.message && !identity.readOnly && (
        <span className="text-[10.5px] text-mute max-w-[300px] truncate" title={bulkLimit.message}>{bulkLimit.message}</span>
      )}
    </div>
  ) : (
    <button type="button" onClick={() => setBulkSelected(new Set(shown.map(argoKey)))} className={`h-6 px-2 rounded-sm text-[11px] text-mute hover:text-ink bg-surface-tint/3 ring-1 ring-edge shrink-0 whitespace-nowrap ${ARGO_FOCUS}`}>
      Select all
    </button>
  );

  return (
    <>
      <GenericResourceTable context={context} presenceKey="argocd" columns={columns} data={filtered} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={argoKey}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        sort={sort} onSortChange={setSort}
        title="ArgoCD Applications"
        extraLeft={<ArgoCdHealthStrip apps={data} filter={filter} setFilter={setFilter} />}
        extra={
          <div className="flex items-center gap-2">
            {bulkResult && (
              <div role={bulkResult.failed.length > 0 ? "alert" : "status"} className={`text-[10.5px] px-2 py-1 rounded ring-1 flex items-center gap-1.5 max-w-[360px] ${
                bulkResult.failed.length > 0 ? "bg-bad/10 ring-bad/20 text-bad" : "bg-ok/10 ring-ok/20 text-ok"
              }`}>
                <span className="shrink-0">{bulkResult.ok} succeeded · {bulkResult.failed.length} failed</span>
                {bulkResult.failed.length > 0 && (
                  <span className="truncate" title={bulkResult.failed.map(f => `${f.name}: ${f.error}`).join(", ")}>
                    {bulkResult.failed.map(f => f.name).join(", ")}
                  </span>
                )}
                <button type="button" onClick={() => setBulkResult(null)} aria-label="Dismiss result" className={`ml-1 text-mute hover:text-ink shrink-0 rounded-xs ${ARGO_FOCUS}`}><span aria-hidden>✕</span></button>
              </div>
            )}
            {bulkBar}
          </div>
        }
        emptyIcon={<GitBranch size={32} />} emptyText="No ArgoCD applications found (is Argo CD installed?)" />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={bulkEquivalent}
        confirmDisabled={!bulkLimit.ok}
        confirmDisabledReason={bulkLimit.message ?? undefined}
        notice={bulkLimit.message ?? undefined}
        open={confirmAction !== null}
        title={confirmAction ? confirmCopy[confirmAction].title : ""}
        description={confirmAction ? confirmCopy[confirmAction].description : ""}
        confirmLabel={confirmAction ? confirmCopy[confirmAction].confirmLabel : "Confirm"}
        destructive={false}
        onConfirm={handleConfirmBulk}
        onCancel={() => setConfirmAction(null)}
        isPending={isBulkPending}
      />
    </>
  );
});

// ─── ArgoCD ApplicationSets ───────────────────────────────────────────────────

function appSetStatusPillClass(status: string): string {
  switch (status) {
    case "Healthy":     return "bg-ok/10 text-ok ring-1 ring-ok/30";
    case "Degraded":    return "bg-bad/10 text-bad ring-1 ring-bad/30";
    case "Progressing": return "bg-status-progress/10 text-status-progress ring-1 ring-status-progress/30";
    default:            return "bg-surface-tint/4 text-dim ring-1 ring-edge";
  }
}

export const ArgoCdAppSetView = memo(function ArgoCdAppSetView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (s: ArgoCdAppSet) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useArgoCdAppSets(context);
  const { data: apps = [] } = useArgoCdApps(context);
  const [deleteTarget, setDeleteTarget] = useState<ArgoCdAppSet | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "argo-appsets");

  const appCountByAppSet = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of apps) {
      if (a.owner_appset) m.set(a.owner_appset, (m.get(a.owner_appset) ?? 0) + 1);
    }
    return m;
  }, [apps]);

  const columns = useMemo<Column<ArgoCdAppSet>[]>(() => [
    { id: "name",    header: "Name",       sortable: true, sortValue: (s) => s.name,      cell: (s) => <N t={s.name} /> },
    { id: "ns",      header: "Namespace",  width: 130, sortable: true, sortValue: (s) => s.namespace, cell: (s) => <Ns t={s.namespace} /> },
    { id: "status",  header: "Status",     width: 110, sortable: true, sortValue: (s) => s.status, cell: (s) => (
      <span className={`${PILL} ${appSetStatusPillClass(s.status)}`}>{s.status || "—"}</span>
    )},
    { id: "gen",     header: "Generators", width: 160, cell: (s) => (
      <div className="flex flex-wrap gap-1">
        {s.generators.map((g) => (
          <span key={g} className="mono text-[10.5px] text-mute bg-surface-tint/4 ring-1 ring-edge-raw/60 px-1 py-0.5 rounded-sm">{g}</span>
        ))}
      </div>
    )},
    { id: "project", header: "Project",    width: 110, sortable: true, sortValue: (s) => s.project, cell: (s) => <Mute t={s.project} /> },
    { id: "apps",    header: "Apps",       width: 70,  sortable: true, sortValue: (s) => appCountByAppSet.get(s.name) ?? 0, cell: (s) => <Mute t={String(appCountByAppSet.get(s.name) ?? 0)} /> },
    { id: "age",     header: "Age",        width: 80,  sortable: true, sortValue: (s) => parseAge(s.age), cell: (s) => <Dim t={s.age} /> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [appCountByAppSet]);

  return (
    <>
      <GenericResourceTable context={context} presenceKey="argo-appsets" columns={columns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(s) => `${s.namespace}/${s.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="ApplicationSets" count={data.length}
        emptyIcon={<Boxes size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "argo-appsets", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete ApplicationSet"
        description={`Delete ApplicationSet "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "argo-appsets", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── ArgoCD AppProjects ───────────────────────────────────────────────────────

export const ArgoCdProjectView = memo(function ArgoCdProjectView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (p: ArgoCdProject) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useArgoCdProjects(context);
  const { data: apps = [] } = useArgoCdApps(context);
  const [deleteTarget, setDeleteTarget] = useState<ArgoCdProject | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "argo-projects");

  const appCountByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of apps) m.set(a.project, (m.get(a.project) ?? 0) + 1);
    return m;
  }, [apps]);

  const columns = useMemo<Column<ArgoCdProject>[]>(() => [
    { id: "name",  header: "Name",         sortable: true, sortValue: (p) => p.name, cell: (p) => <N t={p.name} /> },
    { id: "desc",  header: "Description",  width: 220, cell: (p) => (
      <span className="text-[11.5px] text-mute truncate inline-block max-w-[210px]" title={p.description}>{p.description || "—"}</span>
    )},
    { id: "repos", header: "Source Repos", width: 110, cell: (p) => (
      <span className="mono text-[11.5px] text-mute" title={p.source_repos.join("\n")}>{p.source_repos.length}</span>
    )},
    { id: "dests", header: "Destinations", width: 110, cell: (p) => (
      <span className="mono text-[11.5px] text-mute" title={p.destinations.join("\n")}>{p.destinations.length}</span>
    )},
    { id: "apps",  header: "Apps",         width: 70,  sortable: true, sortValue: (p) => appCountByProject.get(p.name) ?? 0, cell: (p) => <Mute t={String(appCountByProject.get(p.name) ?? 0)} /> },
    { id: "age",   header: "Age",          width: 80,  sortable: true, sortValue: (p) => parseAge(p.age), cell: (p) => <Dim t={p.age} /> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [appCountByProject]);

  return (
    <>
      <GenericResourceTable context={context} presenceKey="argo-projects" columns={columns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(p) => `${p.namespace}/${p.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="AppProjects" count={data.length}
        emptyIcon={<FolderGit2 size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "argo-projects", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete AppProject"
        description={`Delete AppProject "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "argo-projects", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── ArgoCD Repositories ──────────────────────────────────────────────────────

function repoAuthPillClass(method: string): string {
  switch (method) {
    case "ssh":        return "bg-accent/10 text-accent ring-1 ring-accent/30";
    case "https":      return "bg-ok/10 text-ok ring-1 ring-ok/30";
    case "github-app": return "bg-purple/10 text-purple ring-1 ring-purple/30";
    default:           return "bg-surface-tint/4 text-dim ring-1 ring-edge";
  }
}

const repoColumns: Column<ArgoCdRepository>[] = [
  { id: "name",     header: "Name",     sortable: true, sortValue: (r) => r.name, cell: (r) => <N t={r.name || "—"} /> },
  { id: "url",      header: "URL",      width: 260, cell: (r) => (
    <span className="mono text-[11px] text-dim truncate inline-block max-w-[250px]" title={r.url}>{r.url}</span>
  )},
  { id: "type",     header: "Type",     width: 90,  sortable: true, sortValue: (r) => r.repo_type, cell: (r) => <Mute t={r.repo_type} /> },
  { id: "project",  header: "Project",  width: 110, sortable: true, sortValue: (r) => r.project, cell: (r) => <Mute t={r.project || "—"} /> },
  { id: "auth",     header: "Auth",     width: 100, sortable: true, sortValue: (r) => r.auth_method, cell: (r) => (
    <span className={`${PILL} ${repoAuthPillClass(r.auth_method)}`}>{r.auth_method || "none"}</span>
  )},
  { id: "insecure", header: "Insecure", width: 90, cell: (r) => r.insecure ? (
    <span className={`${PILL} bg-warn/10 text-warn ring-1 ring-warn/30`}>⚠ insecure</span>
  ) : <Dim t="—" /> },
  { id: "age",      header: "Age",      width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const ArgoCdRepositoryView = memo(function ArgoCdRepositoryView({ context, search }: { context: string; search?: string }) {
  const { data = [], isLoading, error, refetch } = useArgoCdRepositories(context);
  return (
    <GenericResourceTable context={context} columns={repoColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(r) => `${r.name}/${r.url}`} search={search}
      title="Repositories" count={data.length}
      emptyIcon={<GitBranch size={32} />} emptyText="No repositories found" />
  );
});

// ─── cert-manager Certificates ────────────────────────────────────────────────

const certColumns: Column<Certificate>[] = [
  { id: "name",   header: "Name",      sortable: true, sortValue: (c) => c.name,      cell: (c) => <N t={c.name} /> },
  { id: "ns",     header: "Namespace", width: 130, sortable: true, sortValue: (c) => c.namespace, cell: (c) => <Ns t={c.namespace} /> },
  { id: "ready",  header: "Ready",     width: 90, sortable: true, sortValue: (c) => (c.ready ? 1 : 0), cell: (c) => (
    <span className={`${PILL} ${healthPillClass(c.status)}`}>
      <span aria-hidden>{healthIcon(c.status)}</span>
      {c.ready ? "True" : "False"}
    </span>
  )},
  { id: "secret", header: "Secret",    width: 150, cell: (c) => <Mute t={c.secret_name || "—"} /> },
  { id: "issuer", header: "Issuer",    width: 160, sortable: true, sortValue: (c) => c.issuer_name, cell: (c) => (
    <span className="mono text-[11.5px] text-mute truncate inline-block max-w-[150px]" title={`${c.issuer_name} (${c.issuer_kind})`}>
      {c.issuer_name || "—"}
      {c.issuer_kind === "ClusterIssuer" && <span className="text-dim"> (ClusterIssuer)</span>}
    </span>
  )},
  { id: "dns",    header: "DNS names", width: 200, cell: (c) => {
    if (!c.dns_names.length) return <Dim t="—" />;
    const first = c.dns_names[0];
    const rest = c.dns_names.length - 1;
    return (
      <span className="mono text-[11px] text-dim truncate inline-block max-w-[190px]" title={c.dns_names.join(", ")}>
        {first}{rest > 0 && <span className="text-mute"> +{rest} more</span>}
      </span>
    );
  }},
  { id: "renewal", header: "Renewal",  width: 100, sortable: true, sortValue: (c) => Date.parse(c.renewal_time) || 0, cell: (c) => (
    <Dim t={relativeFromIso(c.renewal_time).label} />
  )},
  { id: "expiry",  header: "Expiry",   width: 100, sortable: true, sortValue: (c) => Date.parse(c.not_after) || 0, cell: (c) => {
    const { label, cls } = expiryState(c.not_after);
    return <span className={`mono text-[11.5px] tabular-nums ${cls}`}>{label}</span>;
  }},
  { id: "age",    header: "Age",       width: 80, sortable: true, sortValue: (c) => parseAge(c.age), cell: (c) => <Dim t={c.age} /> },
];

export const CertificateView = memo(function CertificateView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (c: Certificate) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useCertificates(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<Certificate | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "cert");
  return (
    <>
      <GenericResourceTable context={context} presenceKey="cert" columns={certColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(c) => `${c.namespace}/${c.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Certificates" count={data.length}
        emptyIcon={<ShieldCheck size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "cert", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Certificate"
        description={`Delete certificate "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "cert", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── v0.8.0 — Flux ───────────────────────────────────────────────────────────

function fluxStatusPill(suspended: boolean, status: string): string {
  if (suspended) return "bg-surface-tint/4 text-dim ring-1 ring-edge";
  switch (status) {
    case "Healthy":     return "bg-ok/10 text-ok ring-1 ring-ok/30";
    case "Degraded":    return "bg-bad/10 text-bad ring-1 ring-bad/30";
    case "Progressing": return "bg-status-progress/10 text-status-progress ring-1 ring-status-progress/30";
    default:            return "bg-surface-tint/4 text-dim ring-1 ring-edge";
  }
}

const fluxKsColumns: Column<FluxKustomization>[] = [
  { id: "name",     header: "Name",      sortable: true, sortValue: (r) => r.name,      cell: (r) => <N t={r.name} /> },
  { id: "ns",       header: "Namespace", width: 130, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "status",   header: "Status",    width: 120, sortable: true, sortValue: (r) => r.status, cell: (r) => (
    <span className={`${PILL} ${fluxStatusPill(r.suspended, r.status)}`}>
      {r.suspended ? "Suspended" : r.status}
    </span>
  )},
  { id: "path",     header: "Path",      width: 160, cell: (r) => <Mute t={r.path || "—"} /> },
  { id: "source",   header: "Source",    width: 160, cell: (r) => <Mute t={r.source_ref || "—"} /> },
  { id: "revision", header: "Revision",  width: 120, cell: (r) => <Dim t={r.revision || "—"} /> },
  { id: "age",      header: "Age",       width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const FluxKustomizationView = memo(function FluxKustomizationView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: FluxKustomization) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useFluxKustomizations(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<FluxKustomization | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "flux-ks");
  return (
    <>
      <GenericResourceTable context={context} presenceKey="flux-ks" columns={fluxKsColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Flux Kustomizations" count={data.length}
        emptyIcon={<GitBranch size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "flux-ks", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Flux Kustomization"
        description={`Delete kustomization "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "flux-ks", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

const fluxHrColumns: Column<FluxHelmRelease>[] = [
  { id: "name",    header: "Name",      sortable: true, sortValue: (r) => r.name,      cell: (r) => <N t={r.name} /> },
  { id: "ns",      header: "Namespace", width: 130, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "status",  header: "Status",    width: 120, sortable: true, sortValue: (r) => r.status, cell: (r) => (
    <span className={`${PILL} ${fluxStatusPill(r.suspended, r.status)}`}>
      {r.suspended ? "Suspended" : r.status}
    </span>
  )},
  { id: "chart",   header: "Chart",     width: 180, cell: (r) => <Mute t={r.chart || "—"} /> },
  { id: "version", header: "Version",   width: 100, cell: (r) => <Dim t={r.chart_version || "—"} /> },
  { id: "age",     header: "Age",       width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const FluxHelmReleaseView = memo(function FluxHelmReleaseView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: FluxHelmRelease) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useFluxHelmReleases(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<FluxHelmRelease | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "flux-hr");
  return (
    <>
      <GenericResourceTable context={context} presenceKey="flux-hr" columns={fluxHrColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Flux HelmReleases" count={data.length}
        emptyIcon={<GitBranch size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "flux-hr", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Flux HelmRelease"
        description={`Delete helmrelease "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "flux-hr", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── v0.8.0 — Gateway API ────────────────────────────────────────────────────

function gwStatusPill(status: string): string {
  switch (status) {
    case "Healthy":     return "bg-ok/10 text-ok ring-1 ring-ok/30";
    case "Degraded":    return "bg-bad/10 text-bad ring-1 ring-bad/30";
    case "Progressing": return "bg-status-progress/10 text-status-progress ring-1 ring-status-progress/30";
    default:            return "bg-surface-tint/4 text-dim ring-1 ring-edge";
  }
}

const gatewayColumns: Column<GatewayInfo>[] = [
  { id: "name",      header: "Name",       sortable: true, sortValue: (r) => r.name,      cell: (r) => <N t={r.name} /> },
  { id: "ns",        header: "Namespace",  width: 130, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "status",    header: "Status",     width: 120, sortable: true, sortValue: (r) => r.status, cell: (r) => (
    <span className={`${PILL} ${gwStatusPill(r.status)}`}>{r.status}</span>
  )},
  { id: "class",     header: "Class",      width: 150, cell: (r) => <Mute t={r.gateway_class_name || "—"} /> },
  { id: "listeners", header: "Listeners",  width: 160, cell: (r) => {
    if (!r.listeners.length) return <Dim t="—" />;
    return (
      <span className="mono text-[11px] text-dim truncate inline-block max-w-[150px]" title={r.listeners.join(", ")}>
        {r.listeners[0]}{r.listeners.length > 1 && <span className="text-mute"> +{r.listeners.length - 1}</span>}
      </span>
    );
  }},
  { id: "addresses", header: "Addresses",  width: 160, cell: (r) => {
    if (!r.addresses.length) return <Dim t="—" />;
    return <span className="mono text-[11px] text-dim truncate inline-block max-w-[150px]" title={r.addresses.join(", ")}>{r.addresses[0]}</span>;
  }},
  { id: "age",       header: "Age",        width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const GatewayView = memo(function GatewayView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: GatewayInfo) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useGateways(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<GatewayInfo | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "gw");
  return (
    <>
      <GenericResourceTable context={context} presenceKey="gw" columns={gatewayColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Gateways" count={data.length}
        emptyIcon={<Globe size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "gw", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete Gateway"
        description={`Delete gateway "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "gw", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

const httpRouteColumns: Column<HttpRouteInfo>[] = [
  { id: "name",      header: "Name",       sortable: true, sortValue: (r) => r.name, cell: (r) => <N t={r.name} /> },
  { id: "ns",        header: "Namespace",  width: 130, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "status",    header: "Status",     width: 120, sortable: true, sortValue: (r) => r.status, cell: (r) => (
    <span className={`${PILL} ${gwStatusPill(r.status)}`}>{r.status}</span>
  )},
  { id: "parents",   header: "Parents",    width: 160, cell: (r) => {
    if (!r.parent_refs.length) return <Dim t="—" />;
    return (
      <span className="mono text-[11px] text-dim truncate inline-block max-w-[150px]" title={r.parent_refs.join(", ")}>
        {r.parent_refs[0]}{r.parent_refs.length > 1 && <span className="text-mute"> +{r.parent_refs.length - 1}</span>}
      </span>
    );
  }},
  { id: "hostnames", header: "Hostnames",  width: 180, cell: (r) => {
    if (!r.hostnames.length) return <Dim t="—" />;
    return (
      <span className="mono text-[11px] text-dim truncate inline-block max-w-[170px]" title={r.hostnames.join(", ")}>
        {r.hostnames[0]}{r.hostnames.length > 1 && <span className="text-mute"> +{r.hostnames.length - 1}</span>}
      </span>
    );
  }},
  { id: "rules",     header: "Rules",      width: 70, sortable: true, sortValue: (r) => r.rule_count, cell: (r) => <Dim t={String(r.rule_count)} /> },
  { id: "age",       header: "Age",        width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const HttpRouteView = memo(function HttpRouteView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: HttpRouteInfo) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useHttpRoutes(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<HttpRouteInfo | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "httproute");
  return (
    <>
      <GenericResourceTable context={context} presenceKey="httproute" columns={httpRouteColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="HTTPRoutes" count={data.length}
        emptyIcon={<Globe size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "httproute", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete HTTPRoute"
        description={`Delete httproute "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "httproute", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── v0.8.0 — Quotas & LimitRanges ──────────────────────────────────────────

const resourceQuotaColumns: Column<ResourceQuotaInfo>[] = [
  { id: "name",    header: "Name",      sortable: true, sortValue: (r) => r.name, cell: (r) => <N t={r.name} /> },
  { id: "ns",      header: "Namespace", width: 130, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "cpu_req", header: "CPU Req",   width: 120, cell: (r) => <Dim t={`${r.cpu_request_used} / ${r.cpu_request_hard}`} /> },
  { id: "cpu_lim", header: "CPU Lim",   width: 120, cell: (r) => <Dim t={`${r.cpu_limit_used} / ${r.cpu_limit_hard}`} /> },
  { id: "mem_req", header: "Mem Req",   width: 130, cell: (r) => <Dim t={`${r.memory_request_used} / ${r.memory_request_hard}`} /> },
  { id: "mem_lim", header: "Mem Lim",   width: 130, cell: (r) => <Dim t={`${r.memory_limit_used} / ${r.memory_limit_hard}`} /> },
  { id: "pods",    header: "Pods",      width: 90, cell: (r) => <Dim t={`${r.pods_used} / ${r.pods_hard}`} /> },
  { id: "age",     header: "Age",       width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const ResourceQuotaView = memo(function ResourceQuotaView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: ResourceQuotaInfo) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useResourceQuotas(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<ResourceQuotaInfo | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "rq");
  return (
    <>
      <GenericResourceTable context={context} columns={resourceQuotaColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Resource Quotas" count={data.length}
        emptyIcon={<Database size={32} />} emptyText="No ResourceQuotas found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "rq", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete ResourceQuota"
        description={`Delete resourcequota "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "rq", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

const limitRangeColumns: Column<LimitRangeInfo>[] = [
  { id: "name",        header: "Name",         sortable: true, sortValue: (r) => r.name, cell: (r) => <N t={r.name} /> },
  { id: "ns",          header: "Namespace",    width: 130, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "constraints", header: "Constraints",  width: 100, sortable: true, sortValue: (r) => r.constraint_count, cell: (r) => <Dim t={String(r.constraint_count)} /> },
  { id: "def_cpu",     header: "Default CPU",  width: 120, cell: (r) => <Mute t={r.default_cpu} /> },
  { id: "def_mem",     header: "Default Mem",  width: 120, cell: (r) => <Mute t={r.default_memory} /> },
  { id: "age",         header: "Age",          width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const LimitRangeView = memo(function LimitRangeView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: LimitRangeInfo) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useLimitRanges(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<LimitRangeInfo | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "lr");
  return (
    <>
      <GenericResourceTable context={context} columns={limitRangeColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Limit Ranges" count={data.length}
        emptyIcon={<Database size={32} />} emptyText="No LimitRanges found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "lr", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete LimitRange"
        description={`Delete limitrange "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "lr", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── v0.8.0 — PriorityClass ──────────────────────────────────────────────────

const priorityClassColumns: Column<PriorityClassInfo>[] = [
  { id: "name",       header: "Name",           sortable: true, sortValue: (r) => r.name, cell: (r) => <N t={r.name} /> },
  { id: "value",      header: "Value",          width: 100, sortable: true, sortValue: (r) => r.value, cell: (r) => <Dim t={String(r.value)} /> },
  { id: "global",     header: "Global Default", width: 120, sortable: true, sortValue: (r) => (r.global_default ? 1 : 0), cell: (r) => (
    <span className={r.global_default ? "mono text-[11.5px] text-ok" : "mono text-[11.5px] text-dim"}>
      {r.global_default ? "Yes" : "No"}
    </span>
  )},
  { id: "preemption", header: "Preemption",     width: 140, cell: (r) => <Mute t={r.preemption_policy || "—"} /> },
  { id: "desc",       header: "Description",    cell: (r) => (
    <span className="mono text-[11px] text-dim truncate inline-block max-w-[240px]" title={r.description}>
      {r.description || "—"}
    </span>
  )},
  { id: "age",        header: "Age",            width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const PriorityClassView = memo(function PriorityClassView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (r: PriorityClassInfo) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = usePriorityClasses(context);
  const [deleteTarget, setDeleteTarget] = useState<PriorityClassInfo | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "pc");
  return (
    <>
      <GenericResourceTable context={context} columns={priorityClassColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => r.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="Priority Classes" count={data.length}
        emptyIcon={<Server size={32} />} emptyText="No PriorityClasses found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "pc", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete PriorityClass"
        description={`This will permanently remove priorityclass "${deleteTarget?.name}" from the cluster.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "pc", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── Phase 4 — coverage (docs/plan-kubeconfig-and-parity.md §4) ─────────────
// Endpoints — controller-owned, no onDelete anywhere (§4.2: deleting one is a
// no-op that looks like it worked, so the row action is simply never wired).

const endpointsColumns: Column<EndpointsRow>[] = [
  { id: "name",  header: "Name",      sortable: true, sortValue: (e) => e.name,      cell: (e) => <N t={e.name} /> },
  { id: "ns",    header: "Namespace", width: 130, sortable: true, sortValue: (e) => e.namespace, cell: (e) => <Ns t={e.namespace} /> },
  { id: "addrs", header: "Addresses", width: 260, cell: (e) => (
    <span className="mono text-[11px] text-mute truncate inline-block max-w-[250px]" title={e.addresses}>
      {e.addresses || "—"}
    </span>
  )},
  { id: "count", header: "Count", width: 70, sortable: true, sortValue: (e) => e.address_count, cell: (e) => <Mute t={String(e.address_count)} /> },
  { id: "ready", header: "Ready", width: 70, sortable: true, sortValue: (e) => e.ready_count,   cell: (e) => <Mute t={String(e.ready_count)} /> },
  { id: "age",   header: "Age",   width: 80, sortable: true, sortValue: (e) => parseAge(e.age), cell: (e) => <Dim t={e.age} /> },
];

export const EndpointsView = memo(function EndpointsView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (e: EndpointsRow) => void }) {
  const { data = [], isLoading, error, refetch } = useEndpoints(context, namespace);
  return (
    <GenericResourceTable context={context} columns={endpointsColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(e) => `${e.namespace}/${e.name}`}
      selectedKey={selectedKey} onSelect={onSelect} search={search}
      title="Endpoints" count={data.length}
      emptyIcon={<Waypoints size={32} />} emptyText="No endpoints found" />
  );
});

// ─── EndpointSlices ──────────────────────────────────────────────────────────

const endpointSliceColumns: Column<EndpointSliceRow>[] = [
  { id: "name", header: "Name",      sortable: true, sortValue: (e) => e.name,      cell: (e) => <N t={e.name} /> },
  { id: "ns",   header: "Namespace", width: 130, sortable: true, sortValue: (e) => e.namespace, cell: (e) => <Ns t={e.namespace} /> },
  { id: "svc",  header: "Service",   width: 150, sortable: true, sortValue: (e) => e.service, cell: (e) => <Mute t={e.service || "—"} /> },
  { id: "type", header: "Type",      width: 80,  cell: (e) => <Dim t={e.address_type} /> },
  { id: "eps",  header: "Endpoints", width: 90,  sortable: true, sortValue: (e) => e.endpoints, cell: (e) => <Mute t={String(e.endpoints)} /> },
  { id: "ready",header: "Ready",     width: 70,  sortable: true, sortValue: (e) => e.ready, cell: (e) => <Mute t={String(e.ready)} /> },
  { id: "ports",header: "Ports",     width: 160, cell: (e) => (
    <span className="mono text-[11px] text-dim truncate inline-block max-w-[150px]" title={e.ports}>
      {e.ports || "—"}
    </span>
  )},
  { id: "age",  header: "Age",       width: 80, sortable: true, sortValue: (e) => parseAge(e.age), cell: (e) => <Dim t={e.age} /> },
];

export const EndpointSliceView = memo(function EndpointSliceView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (e: EndpointSliceRow) => void }) {
  const { data = [], isLoading, error, refetch } = useEndpointSlices(context, namespace);
  return (
    <GenericResourceTable context={context} columns={endpointSliceColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(e) => `${e.namespace}/${e.name}`}
      selectedKey={selectedKey} onSelect={onSelect} search={search}
      title="EndpointSlices" count={data.length}
      emptyIcon={<Split size={32} />} emptyText="No endpoint slices found" />
  );
});

// ─── ReplicaSets ─────────────────────────────────────────────────────────────

const rsColumns: Column<ReplicaSetRow>[] = [
  { id: "name",    header: "Name",      sortable: true, sortValue: (r) => r.name,      cell: (r) => <N t={r.name} /> },
  { id: "ns",      header: "Namespace", width: 130, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace} /> },
  { id: "desired", header: "Desired",   width: 80, sortable: true, sortValue: (r) => r.desired, cell: (r) => <Mute t={String(r.desired)} /> },
  { id: "current", header: "Current",   width: 80, sortable: true, sortValue: (r) => r.current, cell: (r) => <Mute t={String(r.current)} /> },
  { id: "ready",   header: "Ready",     width: 80, sortable: true, sortValue: (r) => r.ready,   cell: (r) => <Mute t={String(r.ready)} /> },
  { id: "owner",   header: "Owner",     width: 180, cell: (r) => <Mute t={r.owner || "—"} /> },
  { id: "images",  header: "Images",    width: 220, cell: (r) => <Img t={r.images} /> },
  { id: "age",     header: "Age",       width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const ReplicaSetView = memo(function ReplicaSetView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (r: ReplicaSetRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useReplicaSets(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<ReplicaSetRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const [propagation, setPropagation] = usePropagationState(deleteTarget !== null);
  const perm = usePermissions(context, namespace, "rs");
  return (
    <>
      <GenericResourceTable context={context} columns={rsColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="ReplicaSets" count={data.length}
        emptyIcon={<Copy size={32} />} emptyText="No replica sets found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "rs", name: deleteTarget?.name ?? "", propagation })}
        open={deleteTarget !== null}
        title="Delete ReplicaSet"
        description={`Delete replicaset "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel={deleteLabelFor(propagation)}
        destructive
        size="md"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "rs", name: deleteTarget.name, propagation });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      >
        <PropagationPicker
          name={deleteTarget?.name ?? ""}
          dependents={propagationDependents("rs") ?? "dependents"}
          value={propagation}
          onChange={setPropagation}
          disabled={deleteResource.isPending}
        />
      </ConfirmModal>
    </>
  );
});

// ─── Webhook Configurations (mwc / vwc share one struct + column set) ────────

const webhookColumns: Column<WebhookConfigRow>[] = [
  { id: "name",     header: "Name",           sortable: true, sortValue: (w) => w.name, cell: (w) => <N t={w.name} /> },
  { id: "webhooks", header: "Webhooks",       width: 90,  sortable: true, sortValue: (w) => w.webhooks, cell: (w) => <Mute t={String(w.webhooks)} /> },
  { id: "policy",   header: "Failure policy", width: 130, cell: (w) => <Mute t={w.failure_policy || "—"} /> },
  { id: "targets",  header: "Targets",        width: 240, cell: (w) => (
    <span className="mono text-[11px] text-dim truncate inline-block max-w-[230px]" title={w.targets}>
      {w.targets || "—"}
    </span>
  )},
  { id: "age",      header: "Age", width: 80, sortable: true, sortValue: (w) => parseAge(w.age), cell: (w) => <Dim t={w.age} /> },
];

export const MutatingWebhookView = memo(function MutatingWebhookView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (w: WebhookConfigRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useMutatingWebhooks(context);
  const [deleteTarget, setDeleteTarget] = useState<WebhookConfigRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "mwc");
  return (
    <>
      <GenericResourceTable context={context} columns={webhookColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(w) => w.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="MutatingWebhookConfigurations" count={data.length}
        emptyIcon={<Webhook size={32} />} emptyText="No mutating webhook configurations found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "mwc", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete MutatingWebhookConfiguration"
        description={`This will permanently remove mutatingwebhookconfiguration "${deleteTarget?.name}" from the cluster. This can affect admission control for every resource its rules match.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "mwc", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

export const ValidatingWebhookView = memo(function ValidatingWebhookView({ context, search, selectedKey, onSelect }: { context: string; search?: string; selectedKey?: string | null; onSelect?: (w: WebhookConfigRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useValidatingWebhooks(context);
  const [deleteTarget, setDeleteTarget] = useState<WebhookConfigRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, "", "vwc");
  return (
    <>
      <GenericResourceTable context={context} columns={webhookColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(w) => w.name}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="ValidatingWebhookConfigurations" count={data.length}
        emptyIcon={<Webhook size={32} />} emptyText="No validating webhook configurations found"
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: "", kind: "vwc", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete ValidatingWebhookConfiguration"
        description={`This will permanently remove validatingwebhookconfiguration "${deleteTarget?.name}" from the cluster. This can affect admission control for every resource its rules match.`}
        confirmLabel="Delete permanently"
        destructive
        requireTyping={deleteTarget?.name}
        requireTypingLabel="Type the name to confirm"
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: "", resourceType: "vwc", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── VolumeSnapshots ─────────────────────────────────────────────────────────

const vsColumns: Column<VolumeSnapshotRow>[] = [
  { id: "name",   header: "Name",           sortable: true, sortValue: (v) => v.name, cell: (v) => <N t={v.name} /> },
  { id: "ns",     header: "Namespace",      width: 130, sortable: true, sortValue: (v) => v.namespace, cell: (v) => <Ns t={v.namespace} /> },
  { id: "ready",  header: "Ready",          width: 90,  sortable: true, sortValue: (v) => (v.ready ? 1 : 0), cell: (v) => (
    <StatusDot status={v.ready ? "Ready" : "Pending"} />
  )},
  { id: "source", header: "Source PVC",     width: 160, cell: (v) => <Mute t={v.source_pvc || "—"} /> },
  { id: "class",  header: "Snapshot class", width: 160, cell: (v) => <Mute t={v.snapshot_class || "—"} /> },
  { id: "size",   header: "Restore size",   width: 100, cell: (v) => <Dim t={v.restore_size || "—"} /> },
  { id: "age",    header: "Age",            width: 80,  sortable: true, sortValue: (v) => parseAge(v.age), cell: (v) => <Dim t={v.age} /> },
];

export const VolumeSnapshotView = memo(function VolumeSnapshotView({ context, namespace, search, selectedKey, onSelect }: ViewProps & { onSelect?: (v: VolumeSnapshotRow) => void }) {
  const identity = useClusterIdentity(context);
  const { data = [], isLoading, error, refetch } = useVolumeSnapshots(context, namespace);
  const [deleteTarget, setDeleteTarget] = useState<VolumeSnapshotRow | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteResource = useDeleteResource();
  const perm = usePermissions(context, namespace, "vs");
  return (
    <>
      <GenericResourceTable context={context} presenceKey="vs" columns={vsColumns} data={data} isLoading={isLoading}
        error={error} onRetry={refetch} keyFn={(v) => `${v.namespace}/${v.name}`}
        selectedKey={selectedKey} onSelect={onSelect} search={search}
        title="VolumeSnapshots" count={data.length}
        emptyIcon={<Camera size={32} />}
        onDelete={perm.canDelete ? setDeleteTarget : undefined}
        extra={deleteError ? (
          <div className="mono text-[10.5px] text-bad px-2 py-1 rounded-sm bg-bad/10 ring-1 ring-bad/20 flex items-center gap-1.5">
            {deleteError}
            <button onClick={() => setDeleteError("")} className="ml-1 text-dim hover:text-ink">✕</button>
          </div>
        ) : undefined}
      />
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={deleteEquiv({ context, namespace: deleteTarget?.namespace ?? "", kind: "vs", name: deleteTarget?.name ?? "" })}
        open={deleteTarget !== null}
        title="Delete VolumeSnapshot"
        description={`Delete volumesnapshot "${deleteTarget?.name}" from namespace "${deleteTarget?.namespace}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleteError("");
          try {
            await deleteResource.mutateAsync({ context, namespace: deleteTarget.namespace, resourceType: "vs", name: deleteTarget.name });
            setDeleteTarget(null);
          } catch (e) {
            setDeleteTarget(null);
            setDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteResource.isPending}
      />
    </>
  );
});

// ─── CRD instances (§4.5 — wiring only, no detail panel) ─────────────────────
// CRDResource is {name, namespace, age} only — nothing worth a detail panel,
// so no onSelect and no delete, matching ArgoCdRepositoryView's shape.
// useCRDResources takes no namespace arg (frozen 3-arg call, unchanged) — the
// list is cluster-wide by construction, same "view lists cluster-wide even
// though the objects may be namespaced" precedent as argo-repos/argo-appsets.

const crdInstanceColumns: Column<CRDResource>[] = [
  { id: "name", header: "Name",      sortable: true, sortValue: (r) => r.name,      cell: (r) => <N t={r.name} /> },
  { id: "ns",   header: "Namespace", width: 160, sortable: true, sortValue: (r) => r.namespace, cell: (r) => <Ns t={r.namespace || "—"} /> },
  { id: "age",  header: "Age",       width: 80, sortable: true, sortValue: (r) => parseAge(r.age), cell: (r) => <Dim t={r.age} /> },
];

export const CRDInstanceView = memo(function CRDInstanceView({ context, crd, namespace, search }: { context: string; crd: CRD; namespace: string; search?: string }) {
  const { data = [], isLoading, error, refetch } = useCRDResources(context, crd, true, namespace);
  return (
    <GenericResourceTable context={context} columns={crdInstanceColumns} data={data} isLoading={isLoading}
      error={error} onRetry={refetch} keyFn={(r) => `${r.namespace}/${r.name}`} search={search}
      title={crd.kind} count={data.length}
      emptyIcon={<Boxes size={32} />} emptyText={`No ${crd.kind} resources found`} />
  );
});
