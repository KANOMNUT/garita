import type { MapEdge, MapKind, MapNode, MapRelation, MapSource, MapStatus, ResourceMap, ResourceType } from "../types/k8s";

// #18 Map: pure helpers (docs/impl/v2.2.0-tasks.md FZ2, FZ3, D1, D5, D6, O1, O5, O10, O11; v2.3.1: docs/impl/v2.3.1-tasks.md §3.2).
// Frontend pipeline order, always: lineage (focus) -> group pods -> hide kinds -> count -> cap.

export const DRAW_CAP = 400;
export const GROUP_OVER = 8;

/** Layout column per kind (UX L1). */
export const MAP_COLUMN: Record<MapKind, number> = {
  ing: 0, gw: 0,
  httproute: 1,
  svc: 2, hpa: 2,
  deploy: 3, sts: 3, ds: 3, cron: 3,
  rs: 4, jobs: 4, pdb: 4,
  pods: 5,
  pvc: 6, cm: 6, sec: 6,
  pv: 7,
};

/** D5: ConfigMap and Secret nodes show no status. */
export const NO_STATUS_KINDS: ReadonlySet<MapKind> = new Set<MapKind>(["cm", "sec"]);

/** O10: kinds whose panel gets a Map action (workloads and Services, not pods). */
export const MAP_PANEL_KINDS: ReadonlySet<ResourceType> = new Set<ResourceType>(["deploy", "sts", "ds", "rs", "jobs", "cron", "svc"]);

export const KIND_LABEL: Record<MapKind, string> = {
  pods: "Pod", deploy: "Deployment", sts: "StatefulSet", ds: "DaemonSet", rs: "ReplicaSet", jobs: "Job", cron: "CronJob",
  svc: "Service", ing: "Ingress", gw: "Gateway", httproute: "HTTPRoute", pvc: "PVC", pv: "PersistentVolume",
  cm: "ConfigMap", sec: "Secret", hpa: "HPA", pdb: "PDB",
};
export const KIND_PLURAL: Record<MapKind, string> = {
  pods: "Pods", deploy: "Deployments", sts: "StatefulSets", ds: "DaemonSets", rs: "ReplicaSets", jobs: "Jobs", cron: "CronJobs",
  svc: "Services", ing: "Ingresses", gw: "Gateways", httproute: "HTTPRoutes", pvc: "PVCs", pv: "PersistentVolumes",
  cm: "ConfigMaps", sec: "Secrets", hpa: "HPAs", pdb: "PDBs",
};

export type KindGroupId = "workloads" | "routing" | "storage" | "config" | "scaling";
/**
 * The chips' grouping and the canvas/Kinds-list order. O11 (hiding is per group) is superseded by v2.3.1: the hidden
 * state is a set of kinds, and a group chip is a shortcut over its kinds.
 */
export const KIND_GROUPS: { id: KindGroupId; label: string; kinds: MapKind[] }[] = [
  { id: "workloads", label: "Workloads", kinds: ["deploy", "sts", "ds", "rs", "jobs", "cron", "pods"] },
  { id: "routing", label: "Services & routing", kinds: ["svc", "ing", "gw", "httproute"] },
  { id: "storage", label: "Storage", kinds: ["pvc", "pv"] },
  { id: "config", label: "Config", kinds: ["cm", "sec"] },
  { id: "scaling", label: "Scaling & budgets", kinds: ["hpa", "pdb"] },
];
const GROUP = new Map<KindGroupId, { id: KindGroupId; label: string; kinds: MapKind[] }>(KIND_GROUPS.map((g) => [g.id, g]));
/** Every kind, in the Kinds list order. */
export const ALL_KINDS: MapKind[] = KIND_GROUPS.flatMap((g) => g.kinds);

/** D5: the source whose failure leaves a kind empty. `endpointslices` maps to no kind (it only affects Service status). */
export const KIND_SOURCE: Record<MapKind, MapSource> = {
  pods: "pods", rs: "replicasets", deploy: "deployments", sts: "statefulsets", ds: "daemonsets", jobs: "jobs", cron: "cronjobs",
  svc: "services", ing: "ingresses", gw: "gateways", httproute: "httproutes",
  pvc: "persistentvolumeclaims", pv: "persistentvolumes", cm: "configmaps", sec: "secrets",
  hpa: "horizontalpodautoscalers", pdb: "poddisruptionbudgets",
};

/** Kinds the "Start from an object" picker offers (UX 3.6). */
export const START_KINDS: MapKind[] = ["deploy", "sts", "ds", "svc", "ing"];

export const isMapKind = (k: string): k is MapKind => k in MAP_COLUMN;

/** Node id for a focus request (`pv` is cluster-scoped: namespace ""). */
export const focusNodeId = (kind: MapKind, namespace: string, name: string): string => `${kind}/${kind === "pv" ? "" : namespace}/${name}`;

export interface MapViewNode extends MapNode {
  /** Collapsed pods of one owner (D6b). */
  members?: MapNode[];
  /** "10 OK, 2 Warning" for a group. */
  counts?: string;
}
export interface MapView { nodes: MapViewNode[]; edges: MapEdge[] }

export function countByKind(nodes: MapNode[]): Record<MapKind, number> {
  const out = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<MapKind, number>;
  for (const n of nodes) out[n.kind]++;
  return out;
}

/**
 * "Show only this": the focus's lineage, not its whole connected component. Walk upstream through strictly lower
 * `MAP_COLUMN`s and downstream through strictly higher ones (either edge direction), then add the up- and
 * downstream of every Pod in that set. Pods never reach each other (same column), so one pass is enough.
 * Sibling ReplicaSets and other apps that share a Secret drop out; a Deployment keeps all its ReplicaSets.
 * ponytail: the Rust `NODE_CEILING` (`limit_component`) still counts the whole component, so a huge component can be
 * truncated although its lineage would fit; move this walk into `limit_component` only if that is seen.
 */
export function lineage<T extends Pick<ResourceMap, "nodes" | "edges">>(map: T, fid: string | null): T {
  if (!fid) return map;
  const col = new Map(map.nodes.map((n) => [n.id, MAP_COLUMN[n.kind]]));
  if (!col.has(fid)) return map;
  const next = new Map<string, string[]>();
  for (const e of map.edges) {
    if (!col.has(e.from) || !col.has(e.to)) continue;
    (next.get(e.from) ?? next.set(e.from, []).get(e.from)!).push(e.to);
    (next.get(e.to) ?? next.set(e.to, []).get(e.to)!).push(e.from);
  }
  const keep = new Set([fid]);
  const walk = (start: string, dir: 1 | -1) => {
    const seen = new Set([start]);
    for (const id of seen) {
      for (const w of next.get(id) ?? []) {
        if (!seen.has(w) && Math.sign(col.get(w)! - col.get(id)!) === dir) {
          seen.add(w);
          keep.add(w);
        }
      }
    }
  };
  walk(fid, 1);
  walk(fid, -1);
  for (const n of map.nodes) {
    if (n.kind === "pods" && keep.has(n.id)) {
      walk(n.id, 1);
      walk(n.id, -1);
    }
  }
  return { ...map, nodes: map.nodes.filter((n) => keep.has(n.id)), edges: map.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

/** Banner under the page header while focused: what changed. `n` = drawn lineage size, `m` = backend component size. */
export function focusBanner(label: string, n: number, m: number): string {
  if (n === 0) return `Showing the chain for ${label}.`;
  if (n === 1) return `${label} has no connections. Showing it alone.`;
  if (n < m) return `Showing the chain for ${label}: ${n} of ${m} connected objects. Sibling objects and shared config are left out.`;
  return `Showing the chain for ${label}. Everything connected to it is part of the chain.`;
}

/**
 * Drop every node of a hidden kind and the edges that touch one. Generic so a grouped view keeps its node type.
 * A collapsed pod group has kind `pods`, so hiding Pods hides the groups.
 */
export function hideKinds<N extends MapNode>(nodes: N[], edges: MapEdge[], hidden: ReadonlySet<MapKind>): { nodes: N[]; edges: MapEdge[] } {
  if (hidden.size === 0) return { nodes, edges };
  const keep = nodes.filter((n) => !hidden.has(n.kind));
  const ids = new Set(keep.map((n) => n.id));
  return { nodes: keep, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

// ── Kind filter (UX 22 §3, docs/impl/v2.3.1-tasks.md §3.2) ──

/** "empty" = the group has no objects here; the others are over the group's present kinds (those with objects). */
export type GroupState = "all" | "some" | "none" | "empty";

export function groupState(g: KindGroupId, hidden: ReadonlySet<MapKind>, counts: Record<MapKind, number>): { state: GroupState; shown: number; total: number } {
  let total = 0, shown = 0, present = 0, visible = 0;
  for (const k of GROUP.get(g)!.kinds) {
    const n = counts[k];
    total += n;
    if (n === 0) continue;
    present++;
    if (!hidden.has(k)) { visible++; shown += n; }
  }
  const state: GroupState = present === 0 ? "empty" : visible === present ? "all" : visible === 0 ? "none" : "some";
  return { state, shown, total };
}

/** Chip click: "all" hides every kind of the group (present or not); "some", "none" and "empty" show every kind of it. */
export function toggleGroup(g: KindGroupId, hidden: ReadonlySet<MapKind>, counts: Record<MapKind, number>): Set<MapKind> {
  const hide = groupState(g, hidden, counts).state === "all";
  const next = new Set(hidden);
  for (const k of GROUP.get(g)!.kinds) {
    if (hide) next.add(k);
    else next.delete(k);
  }
  return next;
}

/** Kinds that are hidden AND have objects here: the N of "Kinds · N hidden", so "hidden" always means "this is hiding something". */
export function hiddenPresent(hidden: ReadonlySet<MapKind>, counts: Record<MapKind, number>): number {
  let n = 0;
  for (const k of hidden) if (counts[k] > 0) n++;
  return n;
}

/** Disabled reason of a zero-count row, or null when it has objects. A skipped source comes first: never "No objects" for a kind that could not be read. */
export function zeroReason(kind: MapKind, counts: Record<MapKind, number>, skipped: readonly MapSource[], scopeWord: "namespace" | "chain"): string | null {
  if (counts[kind] > 0) return null;
  return skipped.includes(KIND_SOURCE[kind]) ? "Couldn't read this kind." : `No objects of this kind in this ${scopeWord}.`;
}

/** The chip's version of `zeroReason`: null when the group has objects; "Couldn't read this group." only when every kind of it was skipped. */
export function groupZeroReason(g: KindGroupId, counts: Record<MapKind, number>, skipped: readonly MapSource[], scopeWord: "namespace" | "chain"): string | null {
  const kinds = GROUP.get(g)!.kinds;
  if (kinds.some((k) => counts[k] > 0)) return null;
  return kinds.every((k) => skipped.includes(KIND_SOURCE[k])) ? "Couldn't read this group." : `No objects of this kind in this ${scopeWord}.`;
}

/** UX 22 §3.7: a search must not say "no match" while a hidden kind holds the object. */
export function matchLineText(shown: number, inHidden: number): string {
  if (shown > 0) {
    const base = `${shown} ${shown === 1 ? "match" : "matches"}.`;
    return inHidden > 0 ? `${base} ${inHidden} more in hidden kinds.` : base;
  }
  return inHidden > 0 ? `No match in the shown kinds. ${inHidden} in hidden kinds.` : "No match on the map.";
}

/**
 * C-5: for each shown node id (a collapsed pod group counts its members, `groupOf` maps member id -> group id), the number
 * of distinct (relation, direction, other object) links whose other end is of a hidden kind. 12 pods that mount one
 * hidden ConfigMap count 1. Edges with both ends hidden or both shown are ignored; nodes with no such link are absent.
 */
export function hiddenLinks(map: Pick<ResourceMap, "nodes" | "edges">, hidden: ReadonlySet<MapKind>, groupOf: ReadonlyMap<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  if (hidden.size === 0) return out;
  const kind = new Map(map.nodes.map((n) => [n.id, n.kind]));
  const links = new Map<string, Set<string>>();
  for (const e of map.edges) {
    const kf = kind.get(e.from);
    const kt = kind.get(e.to);
    if (!kf || !kt) continue;
    const fromHidden = hidden.has(kf);
    if (fromHidden === hidden.has(kt)) continue;
    const shownId = fromHidden ? e.to : e.from;
    const owner = groupOf.get(shownId) ?? shownId;
    const key = `${e.relation}\u0000${fromHidden ? "in" : "out"}\u0000${fromHidden ? e.from : e.to}`;
    (links.get(owner) ?? links.set(owner, new Set()).get(owner)!).add(key);
  }
  for (const [id, set] of links) out.set(id, set.size);
  return out;
}

/**
 * The strip / node name / List sentence about links that go to hidden kinds, or null when nothing is hidden (or there is
 * nothing to add). `shownRelations` = the node's relations among the shown kinds; `hiddenLinkCount` = its `hiddenLinks`.
 */
export function hiddenLinkText(shownRelations: number, hiddenLinkCount: number, anyHidden: boolean): string | null {
  if (!anyHidden) return null;
  const n = hiddenLinkCount;
  if (shownRelations === 0) {
    if (n === 0) return "No connections among the shown kinds.";
    return `No connections among the shown kinds. ${n} ${n === 1 ? "goes to a hidden kind" : "go to hidden kinds"}.`;
  }
  if (n === 0) return null;
  return `${n} ${n === 1 ? "connection goes to a hidden kind" : "connections go to hidden kinds"}.`;
}

/** Polite announcement after a toggle. Counts are the hidden-applied, ungrouped set (C-4), the same as the List. */
export function kindsAnnouncement(hiddenPresentCount: number, objects: number, connections: number): string {
  const o = `${objects} ${objects === 1 ? "object" : "objects"}`;
  const c = `${connections} ${connections === 1 ? "connection" : "connections"}`;
  return hiddenPresentCount === 0
    ? `All kinds shown. ${o}, ${c}.`
    : `${hiddenPresentCount} ${hiddenPresentCount === 1 ? "kind" : "kinds"} hidden. ${o}, ${c} shown.`;
}

const BADNESS: Record<MapStatus, number> = { ok: 0, unknown: 1, warn: 2, bad: 3 };
const WORD: Record<MapStatus, string> = { ok: "OK", warn: "Warning", bad: "Failing", unknown: "Unknown" };
export const worstStatus = (list: MapStatus[]): MapStatus => list.reduce<MapStatus>((w, s) => (BADNESS[s] > BADNESS[w] ? s : w), "ok");
export const statusCounts = (list: MapStatus[]): string =>
  (["ok", "warn", "bad", "unknown"] as const)
    .map((s) => [s, list.filter((x) => x === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${WORD[s]}`)
    .join(", ");

/**
 * D6b: an owner with more than `over` pods becomes one node `group:<ownerId>`. Edges are re-targeted to it and
 * deduped by from/to/relation (first detail wins). The group's status is the worst member's.
 */
export function groupPods(nodes: MapNode[], edges: MapEdge[], over = GROUP_OVER): MapView {
  const ids = new Map(nodes.map((n) => [n.id, n]));
  const byOwner = new Map<string, MapNode[]>();
  for (const e of edges) {
    const pod = ids.get(e.to);
    if (e.relation === "owns" && pod?.kind === "pods" && ids.has(e.from)) {
      const l = byOwner.get(e.from) ?? [];
      if (!l.includes(pod)) l.push(pod);
      byOwner.set(e.from, l);
    }
  }
  const to = new Map<string, string>(); // pod id -> group id
  const groups = new Map<string, MapViewNode>();
  for (const [owner, pods] of [...byOwner].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (pods.length <= over) continue;
    const gid = `group:${owner}`;
    const st = pods.map((p) => p.status);
    const first = [...pods].sort((a, b) => (a.name < b.name ? -1 : 1))[0];
    groups.set(gid, {
      id: gid, kind: "pods", namespace: first.namespace, name: `×${pods.length}`, status: worstStatus(st),
      members: pods, counts: statusCounts(st),
    });
    for (const p of pods) to.set(p.id, gid);
  }
  if (groups.size === 0) return { nodes, edges };
  const out: MapEdge[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const from = to.get(e.from) ?? e.from;
    const t = to.get(e.to) ?? e.to;
    if (from === t) continue;
    const k = `${from}\u0000${t}\u0000${e.relation}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...e, from, to: t });
  }
  return { nodes: [...nodes.filter((n) => !to.has(n.id)), ...groups.values()], edges: out };
}

/** Count drawable nodes, then apply the cap: above it the page shows the too-many state and never lays out. */
export function drawable(nodes: unknown[], cap = DRAW_CAP): { count: number; tooMany: boolean } {
  return { count: nodes.length, tooMany: nodes.length > cap };
}

export interface MapPrepared extends MapView {
  /** Drawable node count after group and hide. */
  count: number;
  tooMany: boolean;
}
/**
 * The whole pipeline in its one allowed order: group pods -> hide kinds -> count -> cap. Grouping comes first so that
 * hiding an owner kind (ReplicaSets) keeps its pods collapsed instead of dropping the `owns` edges that make the group.
 */
export function prepareMap(map: Pick<ResourceMap, "nodes" | "edges">, hidden: ReadonlySet<MapKind>): MapPrepared {
  const g = groupPods(map.nodes, map.edges);
  const v = hideKinds(g.nodes, g.edges, hidden);
  return { ...v, ...drawable(v.nodes) };
}

// Relation words: [as source, as target]; REL_ORDER is the details-strip order (UX 2.4).
const VERB: Record<MapRelation, [string, string]> = {
  owns: ["Owns", "Owned by"],
  selects: ["Selects", "Selected by"],
  "routes-to": ["Routes to", "Routed to by"],
  "attaches-to": ["Attaches to", "Has route"],
  mounts: ["Mounts", "Mounted by"],
  binds: ["Binds", "Bound by"],
  "uses-config": ["Uses config", "Config used by"],
  "uses-secret": ["Uses secret", "Secret used by"],
  scales: ["Scales", "Scaled by"],
  protects: ["Protects", "Protected by"],
};
const REL_ORDER: MapRelation[] = ["owns", "selects", "routes-to", "attaches-to", "mounts", "binds", "uses-config", "uses-secret", "scales", "protects"];
const SENTENCE_VERB: Record<MapRelation, string> = {
  owns: "owns", selects: "selects", "routes-to": "routes to", "attaches-to": "attaches to", mounts: "mounts", binds: "binds",
  "uses-config": "uses config", "uses-secret": "uses secret", scales: "scales", protects: "protects",
};

/** "Deployment api" or, for a collapsed group, "12 pods". Secrets: name only (O1). */
export function nodeText(n: MapViewNode): string {
  return n.members ? `${n.members.length} pods` : `${KIND_LABEL[n.kind]} ${n.name}`;
}

/** Line style carries the family, not colour (UX 2.3). */
export function edgeFamily(r: MapRelation): "solid" | "dashed" | "dotted" {
  return r === "scales" || r === "protects" ? "dotted" : r === "mounts" || r === "binds" || r === "uses-config" || r === "uses-secret" ? "dashed" : "solid";
}
/** Label drawn on an edge incident to the focused node: relation word, then the backend's detail. */
export const relationLabel = (e: MapEdge): string => `${SENTENCE_VERB[e.relation]}${e.detail ? ` · ${e.detail}` : ""}`;

export interface NodeRelation { relation: MapRelation; outgoing: boolean; other: string; verb: string; text: string }
/** Relations of one node from its own point of view ("Selects Pod api (7080 → 3000)"), detail included, in strip order. */
export function relationsOf(id: string, edges: MapEdge[], byId: ReadonlyMap<string, MapViewNode>): NodeRelation[] {
  const out: NodeRelation[] = [];
  for (const e of edges) {
    const outgoing = e.from === id;
    if (!outgoing && e.to !== id) continue;
    const other = byId.get(outgoing ? e.to : e.from);
    if (!other) continue;
    const verb = VERB[e.relation][outgoing ? 0 : 1];
    out.push({ relation: e.relation, outgoing, other: other.id, verb, text: `${verb} ${nodeText(other)}${e.detail ? ` (${e.detail})` : ""}` });
  }
  return out.sort(
    (a, b) => REL_ORDER.indexOf(a.relation) - REL_ORDER.indexOf(b.relation) || Number(b.outgoing) - Number(a.outgoing) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
}

const lc = (s: string) => s.toLowerCase();
/** Ids whose name (or, for a group, any member's name) contains the query. */
export function matchIds(nodes: MapViewNode[], query: string): Set<string> {
  const q = lc(query.trim());
  const out = new Set<string>();
  if (!q) return out;
  for (const n of nodes) if (lc(n.name).includes(q) || n.members?.some((m) => lc(m.name).includes(q))) out.add(n.id);
  return out;
}

const KINDS_OWNING: [MapSource, string][] = [
  ["replicasets", "ReplicaSet"], ["deployments", "Deployment"], ["statefulsets", "StatefulSet"],
  ["daemonsets", "DaemonSet"], ["jobs", "Job"], ["cronjobs", "CronJob"],
];
/** UX 3.5 + O5: what a skipped source costs the user. */
export const SKIPPED_COPY: Record<MapSource, string> = {
  pods: "Pods and everything that attaches to them aren't shown.",
  ...(Object.fromEntries(KINDS_OWNING.map(([s, k]) => [s, `${k} objects and their ownership connections aren't shown.`])) as Record<
    "replicasets" | "deployments" | "statefulsets" | "daemonsets" | "jobs" | "cronjobs", string
  >),
  services: "Connections from Services to pods aren't shown.",
  endpointslices: "Service status isn't shown.",
  ingresses: "Connections from Ingresses to Services aren't shown.",
  gateways: "Gateway and HTTPRoute connections aren't shown.",
  httproutes: "Gateway and HTTPRoute connections aren't shown.",
  persistentvolumeclaims: "Volume connections and PVCs aren't shown.",
  persistentvolumes: "PersistentVolumes aren't shown; their PVCs still are.",
  configmaps: "Connections to ConfigMaps aren't shown.",
  secrets: "Connections to Secrets aren't shown.",
  horizontalpodautoscalers: "Autoscaler connections aren't shown.",
  poddisruptionbudgets: "Disruption budget connections aren't shown.",
};
export const SOURCE_COUNT = Object.keys(SKIPPED_COPY).length;

export type MapPageState = "truncated" | "no-access" | "nothing-partial" | "nothing" | "focus-gone" | "ok";
/** Page state from a response (UX 3.5, D2). Never "nothing" while a source was skipped. */
export function mapState(map: ResourceMap, focusId: string | null): MapPageState {
  if (map.truncated) return "truncated";
  const sk = map.skipped.map((s) => s.source);
  if (map.nodes.length === 0) {
    if (sk.includes("pods") || sk.length >= SOURCE_COUNT) return "no-access";
    if (focusId) return "focus-gone";
    return sk.length ? "nothing-partial" : "nothing";
  }
  if (focusId && !map.nodes.some((n) => n.id === focusId)) return "focus-gone";
  return "ok";
}
