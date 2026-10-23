import type { LabelSelectorModel, NetpolModel, PeerModel, PodLabels, PolicyModel, PortModel, RuleModel } from "../types/k8s";

// #24 NetworkPolicy evaluator (docs/impl/v2.2.0-tasks.md FZ4, D8, O6, O7). An APPROXIMATION of the standard
// NetworkPolicy semantics, for one namespace. Pure: no React, no Date, deterministic.

export type Dir = "ingress" | "egress";

/** Pod-label keys that make every pod of a controller unique; ignored for grouping unless a policy selects on them (D8). */
export const IGNORED_LABELS = [
  "pod-template-hash", "controller-revision-hash", "statefulset.kubernetes.io/pod-name", "apps.kubernetes.io/pod-index",
  "batch.kubernetes.io/controller-uid", "batch.kubernetes.io/job-name", "controller-uid", "job-name",
];

export interface NetpolGroup {
  id: string;
  name: string;
  pods: string[];
  /** Full labels of the first pod (members differ only in ignored keys, which no selector uses). */
  labels: Record<string, string>;
  ingress: { restrictedBy: string[] };
  egress: { restrictedBy: string[] };
}
export interface NetpolPseudo { id: string; label: string; side: "src" | "dst" | "both" }
export interface NetpolEdge { from: string; to: string; ports: string[]; allowedBy: string[] }
export interface NetpolResult {
  groups: NetpolGroup[];
  pseudo: NetpolPseudo[];
  edges: NetpolEdge[];
  selectsNothing: string[];
  /** Per receiving group id: the other groups no rule lets send to it. Computed from the evaluation, not from the drawn edges. */
  noRule: Record<string, string[]>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const uniq = (l: string[]) => [...new Set(l)].sort(cmp);

// ─── Selectors ───────────────────────────────────────────────────────────────

export const isEmptySelector = (s: LabelSelectorModel) => Object.keys(s.match_labels).length === 0 && s.match_expressions.length === 0;

/** Kubernetes semantics: every matchLabels pair present; In, NotIn (absent key matches), Exists, DoesNotExist; empty matches all. */
export function matchSelector(sel: LabelSelectorModel, labels: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(sel.match_labels)) if (labels[k] !== v) return false;
  for (const e of sel.match_expressions) {
    const has = Object.prototype.hasOwnProperty.call(labels, e.key);
    const v = labels[e.key];
    if (e.operator === "In" && !(has && e.values.includes(v))) return false;
    if (e.operator === "NotIn" && has && e.values.includes(v)) return false;
    if (e.operator === "Exists" && !has) return false;
    if (e.operator === "DoesNotExist" && has) return false;
  }
  return true;
}

export function selectorText(sel: LabelSelectorModel): string {
  const parts = [
    ...Object.entries(sel.match_labels).sort((a, b) => cmp(a[0], b[0])).map(([k, v]) => `${k}=${v}`),
    ...sel.match_expressions.map((e) =>
      e.operator === "Exists" ? e.key : e.operator === "DoesNotExist" ? `!${e.key}` : `${e.key} ${e.operator === "In" ? "in" : "notin"} (${e.values.join(",")})`),
  ];
  return parts.length ? parts.join(", ") : "all";
}

// ─── Ports ───────────────────────────────────────────────────────────────────

interface PortSpec { proto: string; name: string | null; from: number | null; to: number | null }
type PortSet = "any" | PortSpec[];

function toSpec(p: PortModel): PortSpec {
  const proto = p.protocol || "TCP";
  if (p.port === null || p.port === "") return { proto, name: null, from: null, to: null };
  const n = Number(p.port);
  if (Number.isInteger(n)) return { proto, name: null, from: n, to: p.end_port ?? n };
  return { proto, name: p.port, from: null, to: null };
}
const portSet = (ports: PortModel[]): PortSet => (ports.length === 0 ? "any" : ports.map(toSpec));

export function portLabel(p: PortSpec): string {
  if (p.name !== null) return `port ${p.name} (name, not resolved)`;
  if (p.from === null) return `any ${p.proto} port`;
  return `${p.proto} ${p.to !== null && p.to !== p.from ? `${p.from}-${p.to}` : p.from}`;
}

function meet(a: PortSpec, b: PortSpec): PortSpec | null {
  if (a.proto !== b.proto) return null;
  if (a.name !== null) return a; // a named port is kept against any port
  if (b.name !== null) return b;
  if (a.from === null) return b;
  if (b.from === null) return a;
  const lo = Math.max(a.from, b.from);
  const hi = Math.min(a.to ?? a.from, b.to ?? b.from);
  return lo <= hi ? { proto: a.proto, name: null, from: lo, to: hi } : null;
}
export function intersectPorts(a: PortSet, b: PortSet): PortSet {
  if (a === "any") return b;
  if (b === "any") return a;
  const out: PortSpec[] = [];
  for (const x of a) for (const y of b) { const m = meet(x, y); if (m) out.push(m); }
  return out;
}
const unionPorts = (a: PortSet, b: PortSet): PortSet => (a === "any" || b === "any" ? "any" : [...a, ...b]);
const isEmptyPorts = (s: PortSet) => s !== "any" && s.length === 0;
export function portLabels(s: PortSet): string[] {
  return s === "any" ? ["any port"] : uniq(s.map(portLabel));
}
/** Exported for tests: intersection of two rules' port lists, as labels. */
export function intersectLabels(a: PortModel[], b: PortModel[]): string[] {
  const r = intersectPorts(portSet(a), portSet(b));
  return isEmptyPorts(r) ? [] : portLabels(r);
}

// ─── Groups ──────────────────────────────────────────────────────────────────

function usedKeys(policies: PolicyModel[]): Set<string> {
  const keys = new Set<string>();
  const add = (s: LabelSelectorModel | null) => {
    if (!s) return;
    Object.keys(s.match_labels).forEach((k) => keys.add(k));
    s.match_expressions.forEach((e) => keys.add(e.key));
  };
  for (const p of policies) {
    add(p.pod_selector);
    for (const r of [...p.ingress, ...p.egress]) for (const peer of r.peers) add(peer.pod_selector);
  }
  return keys;
}

/** "ReplicaSet/api-7d9f" with pod-template-hash 7d9f is owner "api"; any other "Kind/name" is "name". */
function ownerName(p: PodLabels): string {
  const i = p.controller.indexOf("/");
  if (i < 0) return "";
  const kind = p.controller.slice(0, i);
  let name = p.controller.slice(i + 1);
  const h = p.labels["pod-template-hash"];
  if (kind === "ReplicaSet" && h && name.endsWith(`-${h}`)) name = name.slice(0, -(h.length + 1));
  return name;
}

const policyApplies = (p: PolicyModel, d: Dir) => p.policy_types.includes(d === "ingress" ? "Ingress" : "Egress");
const rulesOf = (p: PolicyModel, d: Dir): RuleModel[] => (d === "ingress" ? p.ingress : p.egress);

// ─── Peers ───────────────────────────────────────────────────────────────────

/** `all`: the peer covers every group (podSelector {}, Anywhere, a namespace selector matching this namespace). Drawn through pseudo-nodes. */
interface Resolved { groups: Set<string>; all: boolean; pseudos: { id: string; label: string }[] }

export function evaluateNetpol(model: NetpolModel, namespace: string): NetpolResult {
  const used = usedKeys(model.policies);
  const byKey = new Map<string, PodLabels[]>();
  for (const pod of [...model.pods].sort((a, b) => cmp(a.name, b.name))) {
    const key = Object.entries(pod.labels).filter(([k]) => !IGNORED_LABELS.includes(k) || used.has(k)).sort((a, b) => cmp(a[0], b[0])).map(([k, v]) => `${k}=${v}`).join(",");
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(pod);
  }
  const groups: NetpolGroup[] = [...byKey].sort((a, b) => cmp(a[0], b[0])).map(([key, pods]) => {
    const owners = uniq(pods.map(ownerName));
    return {
      id: `group:${key}`,
      name: owners.length === 1 && owners[0] ? owners[0] : key || "(no labels)",
      pods: pods.map((p) => p.name),
      labels: pods[0].labels,
      ingress: { restrictedBy: [] },
      egress: { restrictedBy: [] },
    };
  });

  // N13: two groups can share a display name (one owner, two label sets); suffix the label set on a clash.
  const clash = new Map<string, number>();
  for (const g of groups) clash.set(g.name, (clash.get(g.name) ?? 0) + 1);
  for (const g of groups) if (clash.get(g.name)! > 1) g.name = `${g.name} (${g.id.slice("group:".length) || "no labels"})`;

  // Restricted: some policy of that type whose podSelector matches the group.
  for (const g of groups) {
    for (const d of ["ingress", "egress"] as const) {
      g[d].restrictedBy = uniq(model.policies.filter((p) => policyApplies(p, d) && matchSelector(p.pod_selector, g.labels)).map((p) => p.name));
    }
  }

  const nsKnown = !model.skipped.some((s) => s.source === "namespaces");
  const nsLabels = model.namespaces.map((n) => ({ name: n.name, labels: { "kubernetes.io/metadata.name": n.name, ...n.labels } }));
  const ownLabels = nsLabels.find((n) => n.name === namespace)?.labels ?? { "kubernetes.io/metadata.name": namespace };
  const allPodsLabel = `All pods in namespace ${namespace}`;

  function resolve(peer: PeerModel): Resolved {
    const none: Resolved = { groups: new Set(), all: false, pseudos: [] };
    const podMatch = (s: LabelSelectorModel | null) => new Set(groups.filter((g) => !s || matchSelector(s, g.labels)).map((g) => g.id));
    if (peer.ip_block) {
      const ex = peer.ip_block.except.length ? ` except ${peer.ip_block.except.join(", ")}` : "";
      const label = `External ${peer.ip_block.cidr}${ex}`;
      return { groups: new Set(), all: false, pseudos: [{ id: `pseudo:${label}`, label }] };
    }
    const ns = peer.namespace_selector;
    const pod = peer.pod_selector;
    if (ns) {
      const nsAll = isEmptySelector(ns);
      let matchesOwn: boolean;
      let others: boolean;
      let suffix = "";
      if (nsKnown) {
        const hit = nsLabels.filter((n) => matchSelector(ns, n.labels));
        matchesOwn = matchSelector(ns, ownLabels);
        others = hit.some((n) => n.name !== namespace);
        if (!nsAll) suffix = ` (${hit.length} matching)`;
      } else {
        // O7: matching namespaces unknown; own namespace only for {} or a selector on kubernetes.io/metadata.name = N.
        const keys = Object.keys(ns.match_labels);
        matchesOwn = nsAll || (keys.length === 1 && keys[0] === "kubernetes.io/metadata.name" && ns.match_labels[keys[0]] === namespace && ns.match_expressions.length === 0);
        others = true;
        if (!nsAll) suffix = " (matching namespaces unknown)";
      }
      const label = `${nsAll ? "All namespaces" : `Namespaces: ${selectorText(ns)}`}${pod ? ` · pods: ${selectorText(pod)}` : ""}${suffix}`;
      const pseudos = others ? [{ id: `pseudo:${label}`, label }] : [];
      // S9: this namespace's own pods, all of them: the same collapse as podSelector {}.
      if (matchesOwn && (!pod || isEmptySelector(pod))) return { groups: new Set(), all: true, pseudos: [{ id: `pseudo:${allPodsLabel}`, label: allPodsLabel }, ...pseudos] };
      return { groups: matchesOwn ? podMatch(pod) : new Set(), all: false, pseudos };
    }
    if (pod) {
      // D8: podSelector {} alone is every pod of the namespace; one pseudo-node, not N x N group edges.
      if (isEmptySelector(pod)) return { groups: new Set(), all: true, pseudos: [{ id: `pseudo:${allPodsLabel}`, label: allPodsLabel }] };
      return { groups: podMatch(pod), all: false, pseudos: [] };
    }
    return none;
  }
  const anywhere: Resolved = { groups: new Set(), all: true, pseudos: [{ id: "pseudo:Anywhere", label: "Anywhere" }] };
  // An empty peer list means every peer: one "Anywhere" pseudo-node, like "All pods", never N x N group edges.
  const resolveRule = (r: RuleModel): Resolved[] => (r.peers.length === 0 ? [anywhere] : r.peers.map(resolve));

  interface Contrib { by: string; ports: PortSet; peers: Resolved[] }
  const contribs = (g: NetpolGroup, d: Dir): Contrib[] => {
    const out: Contrib[] = [];
    for (const p of model.policies) {
      if (!policyApplies(p, d) || !matchSelector(p.pod_selector, g.labels)) continue;
      rulesOf(p, d).forEach((r, i) => out.push({ by: `policy ${p.name}, ${d} rule ${i + 1}`, ports: portSet(r.ports), peers: resolveRule(r) }));
    }
    return out;
  };
  const cIn = new Map(groups.map((g) => [g.id, contribs(g, "ingress")]));
  const cOut = new Map(groups.map((g) => [g.id, contribs(g, "egress")]));

  // Merge edges by from/to: union of ports, union of allowedBy.
  const edgeMap = new Map<string, { from: string; to: string; ports: PortSet; by: string[] }>();
  const addEdge = (from: string, to: string, ports: PortSet, by: string[]) => {
    const k = `${from}\u0000${to}`;
    const cur = edgeMap.get(k);
    if (cur) { cur.ports = unionPorts(cur.ports, ports); cur.by.push(...by); }
    else edgeMap.set(k, { from, to, ports, by: [...by] });
  };
  const pseudoSide = new Map<string, { label: string; src: boolean; dst: boolean }>();
  const notePseudo = (p: { id: string; label: string }, side: "src" | "dst") => {
    const cur = pseudoSide.get(p.id) ?? { label: p.label, src: false, dst: false };
    cur[side] = true;
    pseudoSide.set(p.id, cur);
  };

  // Group to group: A -> B is allowed when egress(A) and ingress(B) both let it through (an unrestricted side lets
  // everything). It is DRAWN only when a restricted side matched through a specific peer: an "all" peer (Anywhere,
  // All pods) is already shown by its pseudo-node, and drawing it per pair would be the complete digraph (D8).
  const noRule: Record<string, string[]> = {};
  for (const b of groups) {
    for (const a of groups) {
      const aR = a.egress.restrictedBy.length > 0;
      const bR = b.ingress.restrictedBy.length > 0;
      let e: PortSet = "any";
      let i: PortSet = "any";
      let specific = false;
      const by: string[] = [];
      if (aR) {
        e = [];
        for (const c of cOut.get(a.id)!) {
          if (!c.peers.some((p) => p.all || p.groups.has(b.id))) continue;
          e = unionPorts(e, c.ports);
          by.push(c.by);
          if (c.peers.some((p) => !p.all && p.groups.has(b.id))) specific = true;
        }
      }
      if (bR) {
        i = [];
        for (const c of cIn.get(b.id)!) {
          if (!c.peers.some((p) => p.all || p.groups.has(a.id))) continue;
          i = unionPorts(i, c.ports);
          by.push(c.by);
          if (c.peers.some((p) => !p.all && p.groups.has(a.id))) specific = true;
        }
      }
      const ports = intersectPorts(e, i);
      if (isEmptyPorts(ports)) { if (a.id !== b.id) (noRule[b.id] ??= []).push(a.id); }
      else if (specific) addEdge(a.id, b.id, ports, by);
    }
  }
  // Pseudo-nodes: only the in-namespace side is evaluated (O6).
  for (const g of groups) {
    for (const c of cIn.get(g.id)!) for (const p of c.peers) for (const ps of p.pseudos) { notePseudo(ps, "src"); addEdge(ps.id, g.id, c.ports, [c.by]); }
    for (const c of cOut.get(g.id)!) for (const p of c.peers) for (const ps of p.pseudos) { notePseudo(ps, "dst"); addEdge(g.id, ps.id, c.ports, [c.by]); }
  }

  const edges: NetpolEdge[] = [...edgeMap.values()]
    .map((e) => ({ from: e.from, to: e.to, ports: portLabels(e.ports), allowedBy: uniq(e.by) }))
    .sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  const pseudo: NetpolPseudo[] = [...pseudoSide].sort((a, b) => cmp(a[0], b[0])).map(([id, v]) => ({ id, label: v.label, side: v.src && v.dst ? "both" : v.src ? "src" : "dst" }));
  const selectsNothing = model.policies.filter((p) => !model.pods.some((pod) => matchSelector(p.pod_selector, pod.labels))).map((p) => p.name).sort(cmp);
  return { groups, pseudo, edges, selectsNothing, noRule };
}

// ─── Pod panel ───────────────────────────────────────────────────────────────

export interface PodReachRow { id: string; label: string; ports: string[]; allowedBy: string[] }
export interface PodReach { group: NetpolGroup; ingress: PodReachRow[]; egress: PodReachRow[] }

/** "Who can reach this pod": the pod's group, its allowed sources and destinations. Null when the pod is not in the model. */
export function podReach(res: NetpolResult, podName: string): PodReach | null {
  const group = res.groups.find((g) => g.pods.includes(podName));
  if (!group) return null;
  const label = (id: string) => res.groups.find((g) => g.id === id)?.name ?? res.pseudo.find((p) => p.id === id)?.label ?? id;
  const row = (e: NetpolEdge, other: string): PodReachRow => ({ id: other, label: label(other), ports: e.ports, allowedBy: e.allowedBy });
  return {
    group,
    ingress: res.edges.filter((e) => e.to === group.id).map((e) => row(e, e.from)),
    egress: res.edges.filter((e) => e.from === group.id).map((e) => row(e, e.to)),
  };
}
