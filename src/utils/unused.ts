// #20 Possibly unused (v1.4.1 B-12, B-13, 07 P4/P10/P20). Pure helpers for the Health page.
// Every sentence says "possibly": the check cannot see dynamic references or consumers outside the cluster.
import type { SkippedSource, UnusedCandidate, UnusedReason } from "../types/k8s";
import { reasonWord } from "./problems";

/** Closed source ids of list_possibly_unused's `skipped` (B-12). */
export type UnusedSource =
  | "pods" | "deployments" | "statefulsets" | "daemonsets" | "replicasets" | "jobs" | "cronjobs" | "ingresses"
  | "gateways" | "certificates" | "serviceaccounts" | "configmaps" | "secrets" | "persistentvolumeclaims"
  | "persistentvolumes" | "roles" | "clusterroles" | "rolebindings" | "clusterrolebindings";

const SOURCE_NAME: Record<UnusedSource, string> = {
  pods: "pods", deployments: "deployments", statefulsets: "stateful sets", daemonsets: "daemon sets", replicasets: "replica sets",
  jobs: "jobs", cronjobs: "cron jobs", ingresses: "ingresses", gateways: "gateways", certificates: "certificates",
  serviceaccounts: "service accounts", configmaps: "config maps", secrets: "secrets", persistentvolumeclaims: "PVCs",
  persistentvolumes: "PVs", roles: "roles", clusterroles: "cluster roles", rolebindings: "role bindings", clusterrolebindings: "cluster role bindings",
};

export type UnusedKind = UnusedCandidate["kind"];
export const KIND_ORDER: UnusedKind[] = ["cm", "sec", "pvc", "pv", "roles", "croles", "sa", "deploy", "sts"];
/** Cluster-scoped kinds are listed only for "all namespaces" (B-13). */
const CLUSTER_ONLY: UnusedKind[] = ["pv", "croles"];

export const KIND_LABEL: Record<UnusedKind, string> = {
  cm: "ConfigMap", sec: "Secret", pvc: "PVC", pv: "PV", roles: "Role", croles: "Cluster role", sa: "Service account",
  deploy: "Deployment", sts: "StatefulSet",
};
export const KIND_PLURAL: Record<UnusedKind, string> = {
  cm: "ConfigMaps", sec: "Secrets", pvc: "PVCs", pv: "PVs", roles: "Roles", croles: "Cluster roles", sa: "Service accounts",
  deploy: "Deployments", sts: "StatefulSets",
};

const WORKLOADS: UnusedSource[] = ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs"];
/** B-13 required-sources table: a kind is listed only when its own list and every reference source it needs were read. */
export const REQUIRED_SOURCES: Record<UnusedKind, UnusedSource[]> = {
  cm: ["configmaps", "pods", ...WORKLOADS],
  sec: ["secrets", "pods", ...WORKLOADS, "ingresses", "serviceaccounts", "gateways", "certificates"],
  pvc: ["persistentvolumeclaims", "pods", ...WORKLOADS],
  pv: ["persistentvolumes"],
  roles: ["roles", "rolebindings"],
  croles: ["clusterroles", "clusterrolebindings", "rolebindings"],
  sa: ["serviceaccounts", "pods", ...WORKLOADS],
  deploy: ["deployments"],
  sts: ["statefulsets"],
};

export const REASON_SENTENCE: Record<UnusedReason, string> = {
  "not-referenced": "No reference found from pods, workload templates, Ingresses, Gateways, service accounts or Certificates.",
  "not-mounted": "Bound, but no pod or workload template mounts it.",
  unbound: "Not bound to a claim.",
  "no-binding": "No role binding references it, and it isn't an aggregation target.",
  "no-pods": "No pod or workload template uses it.",
  "zero-replicas": "Scaled to zero replicas.",
};

export const QUALIFIER = "Dynamic references and consumers outside the cluster aren't visible. Treat every row as a question, not an answer.";

/** Kinds this scope lists at all ("all" adds PVs and cluster roles). */
export const kindsInScope = (namespace: string): UnusedKind[] =>
  KIND_ORDER.filter((k) => namespace === "all" || !CLUSTER_ONLY.includes(k));

/** Kinds that were NOT checked because a source they need was skipped. */
export function uncheckedKinds(skipped: SkippedSource<UnusedSource>[], namespace: string): UnusedKind[] {
  const bad = new Set(skipped.map((s) => s.source));
  return kindsInScope(namespace).filter((k) => REQUIRED_SOURCES[k].some((s) => bad.has(s)));
}

export type UnusedState = "no-access" | "nothing-partial" | "nothing" | "partial" | "list";

/** No access = every kind in scope is unchecked and nothing came back. Some unchecked = partial. */
export function unusedPageState(candidateCount: number, skipped: SkippedSource<UnusedSource>[], namespace: string): UnusedState {
  const unchecked = uncheckedKinds(skipped, namespace);
  if (candidateCount === 0) {
    if (unchecked.length === kindsInScope(namespace).length) return "no-access";
    return skipped.length > 0 ? "nothing-partial" : "nothing";
  }
  return skipped.length > 0 ? "partial" : "list";
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "Couldn't read pods (forbidden). ConfigMaps, Secrets, PVCs and service accounts weren't checked." */
export function partialLine(skipped: SkippedSource<UnusedSource>[], namespace: string): string {
  const read = skipped.map((s) => `${SOURCE_NAME[s.source] ?? s.source} (${reasonWord(s.reason)})`);
  const kinds = uncheckedKinds(skipped, namespace).map((k) => KIND_PLURAL[k]);
  return `Couldn't read ${list(read)}.${kinds.length ? ` ${list(kinds)} ${kinds.length === 1 ? "wasn't" : "weren't"} checked.` : ""}`;
}

export const candidateKey = (c: UnusedCandidate) => `${c.kind}/${c.namespace}/${c.name}`;

/** Filter-card ids: a kind, or "workloads" for deploy + sts. */
export type UnusedCard = UnusedKind | "workloads";
const cardOf = (k: UnusedKind): UnusedCard => (k === "deploy" || k === "sts" ? "workloads" : k);
export const CARD_LABEL: Record<UnusedCard, string> = { ...KIND_PLURAL, workloads: "Workloads" };

export function cardCounts(cands: UnusedCandidate[]): { id: UnusedCard; label: string; count: number }[] {
  const n = new Map<UnusedCard, number>();
  for (const c of cands) n.set(cardOf(c.kind), (n.get(cardOf(c.kind)) ?? 0) + 1);
  return (["cm", "sec", "pvc", "pv", "roles", "croles", "sa", "workloads"] as UnusedCard[])
    .filter((id) => n.has(id)).map((id) => ({ id, label: CARD_LABEL[id], count: n.get(id) ?? 0 }));
}

export function filterCandidates(cands: UnusedCandidate[], card: UnusedCard | null, search: string): UnusedCandidate[] {
  const q = search.trim().toLowerCase();
  return cands.filter((c) =>
    (!card || cardOf(c.kind) === card) &&
    (!q || [KIND_LABEL[c.kind], c.kind, c.namespace, c.name].join(" ").toLowerCase().includes(q)));
}

/** Candidates grouped by kind in KIND_ORDER (the backend sorts kind/ns/name; this keeps the order stable). */
export function groupByKind(cands: UnusedCandidate[]): { kind: UnusedKind; rows: UnusedCandidate[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, rows: cands.filter((c) => c.kind === kind) })).filter((g) => g.rows.length > 0);
}

/** The scope line prints `excluded_namespaces` from the payload, never a literal. */
export function scopeLine(namespace: string, excluded: string[], count: number | null): string {
  const found = count === null ? "" : ` · ${count} found`;
  if (namespace !== "all") return `Namespace ${namespace}${found}`;
  const ex = excluded.length ? ` except ${list(excluded)}` : "";
  return `All namespaces${ex}${found}`;
}

export const CLUSTER_SCOPED_NOTE = "Cluster-scoped objects (PVs, cluster roles) appear when all namespaces are selected.";
export const loadedLine = (n: number) => `Possibly unused loaded. ${n} found.`;
