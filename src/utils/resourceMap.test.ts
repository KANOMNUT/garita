import { describe, expect, it } from "vitest";
import type { MapEdge, MapKind, MapNode, MapSource, MapStatus, ResourceMap } from "../types/k8s";
import {
  ALL_KINDS, DRAW_CAP, KIND_GROUPS, KIND_SOURCE, edgeFamily, relationLabel, MAP_COLUMN, NO_STATUS_KINDS, SKIPPED_COPY, countByKind, drawable, focusNodeId, groupPods, hideKinds,
  focusBanner, groupState, groupZeroReason, hiddenLinkText, hiddenLinks, hiddenPresent, kindsAnnouncement, lineage, mapState, matchIds, matchLineText, prepareMap, relationsOf,
  setGroupShown, zeroReason, type KindGroupId, type MapViewNode,
} from "./resourceMap";

const node = (kind: MapKind, name: string, status: MapStatus = "ok"): MapNode => ({
  id: `${kind}/${kind === "pv" ? "" : "shop"}/${name}`, kind, namespace: kind === "pv" ? "" : "shop", name, status,
});
const edge = (from: MapNode, to: MapNode, relation: MapEdge["relation"] = "owns", detail = ""): MapEdge => ({ from: from.id, to: to.id, relation, detail });
const pods = (n: number, status: (i: number) => MapStatus = () => "ok") => Array.from({ length: n }, (_, i) => node("pods", `p${String(i).padStart(3, "0")}`, status(i)));

describe("tables", () => {
  it("MAP_COLUMN covers every kind group member and matches the FZ3 table", () => {
    for (const g of KIND_GROUPS) for (const k of g.kinds) expect(MAP_COLUMN[k]).toBeTypeOf("number");
    expect(MAP_COLUMN).toMatchObject({ ing: 0, gw: 0, httproute: 1, svc: 2, hpa: 2, deploy: 3, rs: 4, pdb: 4, pods: 5, pvc: 6, sec: 6, pv: 7 });
  });
  it("NO_STATUS_KINDS is cm and sec", () => {
    expect([...NO_STATUS_KINDS].sort()).toEqual(["cm", "sec"]);
  });
  it("SKIPPED_COPY has a row for every source, endpointslices apart from services, and persistentvolumes (O5)", () => {
    const all: MapSource[] = ["pods", "deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs", "services", "endpointslices", "ingresses", "gateways", "httproutes", "persistentvolumeclaims", "persistentvolumes", "configmaps", "secrets", "horizontalpodautoscalers", "poddisruptionbudgets"];
    for (const s of all) expect(SKIPPED_COPY[s]).toBeTruthy();
    expect(SKIPPED_COPY.endpointslices).toBe("Service status isn't shown.");
    expect(SKIPPED_COPY.endpointslices).not.toBe(SKIPPED_COPY.services);
    expect(SKIPPED_COPY.persistentvolumes).toBe("PersistentVolumes aren't shown; their PVCs still are.");
    expect(SKIPPED_COPY.replicasets).toBe("ReplicaSet objects and their ownership connections aren't shown.");
  });
  it("focusNodeId puts pv in namespace empty", () => {
    expect(focusNodeId("deploy", "shop", "api")).toBe("deploy/shop/api");
    expect(focusNodeId("pv", "shop", "pv-1")).toBe("pv//pv-1");
  });
});

describe("hideKinds", () => {
  const d = node("deploy", "api");
  const cm = node("cm", "env");
  const p = node("pods", "p");
  const edges = [edge(d, p), edge(p, cm, "uses-config")];
  it("removes a hidden kind's nodes and touching edges", () => {
    const r = hideKinds([d, cm, p], edges, new Set<MapKind>(["cm"]));
    expect(r.nodes.map((n) => n.id)).toEqual([d.id, p.id]);
    expect(r.edges).toEqual([edges[0]]);
  });
  it("hides one kind of a group and keeps the others", () => {
    const rs = node("rs", "api-1");
    const r = hideKinds([d, rs, p], [edge(d, rs), edge(rs, p)], new Set<MapKind>(["rs"]));
    expect(r.nodes.map((n) => n.id)).toEqual([d.id, p.id]);
    expect(r.edges).toEqual([]);
  });
  it("is a no-op with nothing hidden", () => {
    expect(hideKinds([d], [], new Set()).nodes).toEqual([d]);
  });
  it("countByKind counts per kind and lists every kind", () => {
    const c = countByKind([d, cm, p, node("pods", "q")]);
    expect(c).toMatchObject({ deploy: 1, cm: 1, pods: 2, rs: 0, sec: 0 });
    expect(Object.keys(c).sort()).toEqual([...ALL_KINDS].sort());
    expect(ALL_KINDS).toHaveLength(17);
  });
});

describe("KIND_SOURCE (D5)", () => {
  it("covers all 17 kinds, every value is a SKIPPED_COPY key, and endpointslices maps to no kind", () => {
    expect(Object.keys(KIND_SOURCE).sort()).toEqual([...ALL_KINDS].sort());
    for (const s of Object.values(KIND_SOURCE)) expect(SKIPPED_COPY[s]).toBeTruthy();
    expect(Object.values(KIND_SOURCE)).not.toContain("endpointslices");
    expect(new Set(Object.values(KIND_SOURCE)).size).toBe(17);
    expect(KIND_SOURCE.rs).toBe("replicasets");
    expect(KIND_SOURCE.pvc).toBe("persistentvolumeclaims");
  });
});

describe("group chips over kinds", () => {
  const counts = (o: Partial<Record<MapKind, number>>) => ({ ...countByKind([]), ...o });
  const c = counts({ deploy: 4, rs: 12, pods: 2, cm: 8 });
  it("groupState: all, some, none and empty are over the present kinds", () => {
    expect(groupState("workloads", new Set(), c)).toEqual({ state: "all", shown: 18, total: 18 });
    expect(groupState("workloads", new Set<MapKind>(["rs"]), c)).toEqual({ state: "some", shown: 6, total: 18 });
    expect(groupState("workloads", new Set<MapKind>(["deploy", "rs", "pods"]), c)).toEqual({ state: "none", shown: 0, total: 18 });
    expect(groupState("routing", new Set(), c)).toEqual({ state: "empty", shown: 0, total: 0 });
    // a hidden kind with no objects hides nothing
    expect(groupState("workloads", new Set<MapKind>(["sts", "ds"]), c).state).toBe("all");
    expect(groupState("config", new Set<MapKind>(["sec"]), c).state).toBe("all");
  });
  it("setGroupShown(false) hides every kind of the group, absent ones included, and leaves other groups alone", () => {
    const next = setGroupShown("workloads", new Set<MapKind>(["cm"]), false);
    expect([...next].sort()).toEqual(["cm", "cron", "deploy", "ds", "jobs", "pods", "rs", "sts"]);
    expect(groupState("workloads", next, c).state).toBe("none");
    expect(groupState("config", next, c).state).toBe("none");
    expect(groupState("routing", next, c).state).toBe("empty");
  });
  it("setGroupShown(true) shows every kind of the group, flagged-but-absent ones too, and leaves other groups alone", () => {
    const h = new Set<MapKind>(["rs", "cm", "sts", "deploy", "pods"]);
    expect([...setGroupShown("workloads", h, true)]).toEqual(["cm"]);
    expect(groupState("workloads", setGroupShown("workloads", h, true), c).state).toBe("all");
    // an empty group flagged hidden (after hiding all of it) can be cleared
    expect(setGroupShown("routing", new Set(ALL_KINDS), true).has("svc")).toBe(false);
    expect(setGroupShown("routing", new Set(ALL_KINDS), true).has("deploy")).toBe(true);
    expect(setGroupShown("routing", new Set(), true).size).toBe(0);
  });
  it("setGroupShown is idempotent and does not mutate its input", () => {
    const h = new Set<MapKind>(["rs"]);
    const hidden = setGroupShown("workloads", h, false);
    expect([...setGroupShown("workloads", hidden, false)].sort()).toEqual([...hidden].sort());
    expect([...h]).toEqual(["rs"]);
    expect([...setGroupShown("workloads", h, true)]).toEqual([]);
    expect([...h]).toEqual(["rs"]);
  });
  it("hiddenPresent counts only hidden kinds that have objects", () => {
    expect(hiddenPresent(new Set(), c)).toBe(0);
    expect(hiddenPresent(new Set<MapKind>(["rs", "cm", "sts", "svc"]), c)).toBe(2);
    expect(hiddenPresent(new Set(ALL_KINDS), c)).toBe(4);
  });
  it("every group id is covered by KIND_GROUPS", () => {
    const ids: KindGroupId[] = KIND_GROUPS.map((g) => g.id);
    expect(ids).toEqual(["workloads", "routing", "storage", "config", "scaling"]);
  });
});

describe("zero reasons (UX 22 §3.6)", () => {
  const c = { ...countByKind([]), deploy: 3 };
  it("a kind with objects has no reason", () => {
    expect(zeroReason("deploy", c, [], "namespace")).toBeNull();
    expect(zeroReason("deploy", c, ["deployments"], "chain")).toBeNull();
  });
  it("no objects, source read fine: namespace or chain wording", () => {
    expect(zeroReason("ds", c, [], "namespace")).toBe("No objects of this kind in this namespace.");
    expect(zeroReason("ds", c, ["pods"], "chain")).toBe("No objects of this kind in this chain.");
  });
  it("a skipped source reads Couldn't read, never No objects", () => {
    expect(zeroReason("ds", c, ["daemonsets"], "namespace")).toBe("Couldn't read this kind.");
    expect(zeroReason("pv", c, ["persistentvolumes"], "chain")).toBe("Couldn't read this kind.");
    expect(zeroReason("svc", c, ["endpointslices"], "namespace")).toBe("No objects of this kind in this namespace.");
  });
  it("the chip says Couldn't read this group only when every kind of the group was skipped", () => {
    expect(groupZeroReason("workloads", c, [], "namespace")).toBeNull();
    expect(groupZeroReason("config", c, ["configmaps"], "namespace")).toBe("No objects of this kind in this namespace.");
    expect(groupZeroReason("config", c, ["configmaps", "secrets"], "namespace")).toBe("Couldn't read this group.");
    expect(groupZeroReason("storage", c, [], "chain")).toBe("No objects of this kind in this chain.");
  });
});

describe("matchLineText", () => {
  it("the four sentences", () => {
    expect(matchLineText(3, 0)).toBe("3 matches.");
    expect(matchLineText(1, 0)).toBe("1 match.");
    expect(matchLineText(3, 2)).toBe("3 matches. 2 more in hidden kinds.");
    expect(matchLineText(0, 2)).toBe("No match in the shown kinds. 2 in hidden kinds.");
    expect(matchLineText(0, 0)).toBe("No match on the map.");
  });
});

describe("hiddenLinks", () => {
  const dep = node("deploy", "api");
  const rs = node("rs", "api-1");
  const rs2 = node("rs", "api-2");
  const pod = node("pods", "api-1-x");
  const cm = node("cm", "env");
  const sec = node("sec", "tls");
  const none = new Map<string, string>();
  const map = (edges: MapEdge[], ...nodes: MapNode[]) => ({ nodes, edges });
  it("nothing hidden gives an empty map", () => {
    expect(hiddenLinks(map([edge(dep, rs)], dep, rs), new Set(), none).size).toBe(0);
  });
  it("counts the links of each shown end that go to a hidden kind", () => {
    const m = map([edge(dep, rs), edge(dep, rs2), edge(rs, pod), edge(rs2, pod)], dep, rs, rs2, pod);
    const r = hiddenLinks(m, new Set<MapKind>(["rs"]), none);
    expect(r.get(dep.id)).toBe(2);
    expect(r.get(pod.id)).toBe(2);
    expect(r.has(rs.id)).toBe(false);
  });
  it("is distinct per relation, direction and other object", () => {
    const e = edge(pod, cm, "uses-config");
    const m = map([e, { ...e }, edge(pod, sec, "uses-secret")], pod, cm, sec);
    expect(hiddenLinks(m, new Set<MapKind>(["cm", "sec"]), none).get(pod.id)).toBe(2);
  });
  it("a collapsed group counts the distinct links of its members once", () => {
    const ps = pods(12);
    const m = map([...ps.map((p) => edge(p, cm, "uses-config")), edge(ps[0], sec, "uses-secret")], cm, sec, ...ps);
    const groupOf = new Map(ps.map((p) => [p.id, "group:rs/x"] as const));
    const r = hiddenLinks(m, new Set<MapKind>(["cm", "sec"]), groupOf);
    expect(r.get("group:rs/x")).toBe(2);
    expect(r.size).toBe(1);
    // ungrouped (the List): one per pod, the first pod has two
    const flat = hiddenLinks(m, new Set<MapKind>(["cm", "sec"]), none);
    expect(flat.get(ps[0].id)).toBe(2);
    expect(flat.get(ps[1].id)).toBe(1);
  });
  it("the pod group of a hidden owner survives and has one link to it", () => {
    const owner = node("rs", "api-1");
    const ps = pods(12);
    const m = map(ps.map((p) => edge(owner, p)), owner, ...ps);
    const hide = new Set<MapKind>(["rs"]);
    const prepared = prepareMap(m, hide);
    expect(prepared.nodes.map((n) => n.id)).toEqual([`group:${owner.id}`]);
    const groupOf = new Map(prepared.nodes.flatMap((n) => (n.members ?? []).map((p) => [p.id, n.id] as const)));
    const r = hiddenLinks(m, hide, groupOf);
    expect([...r]).toEqual([[`group:${owner.id}`, 1]]);
  });
  it("ignores edges with both ends hidden or both shown, and edges to unknown ids", () => {
    const m = map([edge(dep, rs), edge(rs, pod), edge(pod, cm, "uses-config"), { from: pod.id, to: "ghost/x/y", relation: "owns", detail: "" }], dep, rs, pod, cm);
    const r = hiddenLinks(m, new Set<MapKind>(["rs", "pods"]), none);
    expect(r.get(dep.id)).toBe(1);
    expect(r.get(cm.id)).toBe(1);
    expect(r.has(rs.id)).toBe(false);
    expect(r.has(pod.id)).toBe(false);
  });
  it("opposite directions to the same object are two links", () => {
    const a = edge(dep, rs, "owns");
    const b = edge(rs, dep, "owns");
    expect(hiddenLinks(map([a, b], dep, rs), new Set<MapKind>(["rs"]), none).get(dep.id)).toBe(2);
  });
});

describe("hiddenLinkText", () => {
  it("is null when nothing is hidden", () => {
    expect(hiddenLinkText(0, 0, false)).toBeNull();
    expect(hiddenLinkText(3, 2, false)).toBeNull();
  });
  it("shown relations plus hidden links: singular and plural", () => {
    expect(hiddenLinkText(2, 1, true)).toBe("1 connection goes to a hidden kind.");
    expect(hiddenLinkText(2, 3, true)).toBe("3 connections go to hidden kinds.");
    expect(hiddenLinkText(2, 0, true)).toBeNull();
  });
  it("no shown relations: the strip and node name sentence", () => {
    expect(hiddenLinkText(0, 2, true)).toBe("No connections among the shown kinds. 2 go to hidden kinds.");
    expect(hiddenLinkText(0, 1, true)).toBe("No connections among the shown kinds. 1 goes to a hidden kind.");
    expect(hiddenLinkText(0, 0, true)).toBe("No connections among the shown kinds.");
  });
});

describe("kindsAnnouncement", () => {
  it("says what is hidden and what is left, singular and plural", () => {
    expect(kindsAnnouncement(2, 27, 31)).toBe("2 kinds hidden. 27 objects, 31 connections shown.");
    expect(kindsAnnouncement(1, 1, 1)).toBe("1 kind hidden. 1 object, 1 connection shown.");
    expect(kindsAnnouncement(0, 41, 63)).toBe("All kinds shown. 41 objects, 63 connections.");
    expect(kindsAnnouncement(0, 1, 0)).toBe("All kinds shown. 1 object, 0 connections.");
  });
});

describe("groupPods", () => {
  const rs = node("rs", "api-1");
  const svc = node("svc", "api");
  const mk = (n: number) => {
    const ps = pods(n, (i) => (i === 0 ? "bad" : i === 1 ? "warn" : "ok"));
    const edges = [...ps.map((p) => edge(rs, p)), ...ps.map((p) => edge(svc, p, "selects", "port 80"))];
    return { ps, edges };
  };
  it("leaves an owner with 8 pods alone", () => {
    const { ps, edges } = mk(8);
    const r = groupPods([rs, svc, ...ps], edges);
    expect(r.nodes).toHaveLength(10);
    expect(r.edges).toHaveLength(16);
  });
  it("collapses 9+ pods into group:<ownerId>, re-targets and dedupes edges, worst status", () => {
    const { ps, edges } = mk(12);
    const r = groupPods([rs, svc, ...ps], edges);
    const g = r.nodes.find((n) => n.id === `group:${rs.id}`)!;
    expect(r.nodes).toHaveLength(3);
    expect(g.members).toHaveLength(12);
    expect(g.status).toBe("bad");
    expect(g.counts).toBe("10 OK, 1 Warning, 1 Failing");
    expect(r.edges).toEqual([
      { from: rs.id, to: g.id, relation: "owns", detail: "" },
      { from: svc.id, to: g.id, relation: "selects", detail: "port 80" },
    ]);
  });
  it("does not group pods without an owner", () => {
    expect(groupPods(pods(20), []).nodes).toHaveLength(20);
  });
});

describe("drawable and prepareMap", () => {
  it("caps at 400", () => {
    expect(drawable(new Array(DRAW_CAP).fill(0))).toEqual({ count: 400, tooMany: false });
    expect(drawable(new Array(DRAW_CAP + 1).fill(0))).toEqual({ count: 401, tooMany: true });
  });
  it("pipeline order is group, hide, count, cap", () => {
    const rs = node("rs", "r");
    const ps = pods(500);
    const map = { nodes: [rs, ...ps], edges: ps.map((p) => edge(rs, p)) };
    // grouped before counting: 500 pods become 1 group, so 2 drawable, not 501
    expect(prepareMap(map, new Set())).toMatchObject({ count: 2, tooMany: false });
    // pods have kind pods, so hiding Pods hides the group node too
    expect(prepareMap(map, new Set<MapKind>(["rs", "pods"]))).toMatchObject({ count: 0, tooMany: false });
    // hiding one kind keeps the rest
    expect(prepareMap(map, new Set<MapKind>(["pods"]))).toMatchObject({ count: 1, tooMany: false });
    // hiding the owner keeps its pods collapsed: group first, then hide (only the owns edge goes)
    const noRs = prepareMap(map, new Set<MapKind>(["rs"]));
    expect(noRs).toMatchObject({ count: 1, tooMany: false });
    expect(noRs.nodes.map((n) => n.id)).toEqual([`group:${rs.id}`]);
    expect(noRs.edges).toEqual([]);
    // 450 unowned pods stay separate and trip the cap
    expect(prepareMap({ nodes: pods(450), edges: [] }, new Set())).toMatchObject({ count: 450, tooMany: true });
  });
});

describe("relations", () => {
  const ing = node("ing", "web");
  const svc = node("svc", "api");
  const sec = node("sec", "tls");
  const group: MapViewNode = { ...node("pods", "x12"), id: "group:x", members: pods(12) };
  it("relationsOf text carries the backend detail in parentheses, groups as counts", () => {
    const by = new Map<string, MapViewNode>([ing, svc, group].map((n) => [n.id, n]));
    expect(relationsOf(ing.id, [edge(ing, svc, "routes-to", "path /")], by).map((x) => x.text)).toEqual(["Routes to Service api (path /)"]);
    expect(relationsOf(svc.id, [{ from: svc.id, to: group.id, relation: "selects", detail: "" }], by).map((x) => x.text)).toEqual(["Selects 12 pods"]);
  });
  it("Secret text is kind and name only (O1)", () => {
    const pod = node("pods", "p");
    const r = relationsOf(sec.id, [edge(pod, sec, "uses-secret")], new Map([[sec.id, sec], [pod.id, pod]]));
    expect(r.map((x) => x.text)).toEqual(["Secret used by Pod p"]);
  });
  it("relationsOf is from the node's own point of view, in strip order", () => {
    const by = new Map<string, MapViewNode>([ing, svc, sec].map((n) => [n.id, n]));
    const rs = relationsOf(svc.id, [edge(ing, svc, "routes-to"), edge(svc, sec, "mounts")], by);
    expect(rs.map((r) => r.text)).toEqual(["Routed to by Ingress web", "Mounts Secret tls"]);
  });
});

describe("edge style", () => {
  it("family by relation and label with detail", () => {
    expect(["owns", "selects", "routes-to", "attaches-to"].map((r) => edgeFamily(r as MapEdge["relation"]))).toEqual(["solid", "solid", "solid", "solid"]);
    expect(["mounts", "binds", "uses-config", "uses-secret"].map((r) => edgeFamily(r as MapEdge["relation"]))).toEqual(["dashed", "dashed", "dashed", "dashed"]);
    expect(edgeFamily("scales")).toBe("dotted");
    expect(edgeFamily("protects")).toBe("dotted");
    expect(relationLabel({ from: "a", to: "b", relation: "routes-to", detail: "path /api" })).toBe("routes to · path /api");
    expect(relationLabel({ from: "a", to: "b", relation: "owns", detail: "" })).toBe("owns");
  });
});

describe("lineage", () => {
  const ing = node("ing", "web");
  const gw = node("gw", "gw");
  const route = node("httproute", "r");
  const svc = node("svc", "api");
  const hpa = node("hpa", "api");
  const dep = node("deploy", "api");
  const rs1 = node("rs", "api-1");
  const rs2 = node("rs", "api-2");
  const pod = node("pods", "api-1-x");
  const cm = node("cm", "env");
  const sec = node("sec", "shared");
  const dep2 = node("deploy", "other");
  const rs3 = node("rs", "other-1");
  const pod2 = node("pods", "other-1-y");
  const all = [ing, gw, route, svc, hpa, dep, rs1, rs2, pod, cm, sec, dep2, rs3, pod2];
  const edges = [
    edge(ing, svc, "routes-to"), edge(gw, route, "attaches-to"), edge(route, svc, "routes-to"), edge(svc, pod, "selects"),
    edge(hpa, dep, "scales"), edge(dep, rs1), edge(dep, rs2), edge(rs1, pod), edge(pod, cm, "uses-config"), edge(pod, sec, "uses-secret"),
    edge(dep2, rs3), edge(rs3, pod2), edge(pod2, sec, "uses-secret"),
  ];
  const map = { nodes: all, edges };
  const ids = (m: { nodes: MapNode[] }) => m.nodes.map((n) => n.id).sort();
  const want = (...ns: MapNode[]) => ns.map((n) => n.id).sort();

  it("no focus returns the map unchanged", () => {
    expect(lineage(map, null)).toBe(map);
    expect(lineage(map, "pods/shop/nope")).toBe(map);
  });
  it("a Pod keeps its chain, own ReplicaSet and config; sibling ReplicaSets and other apps sharing a Secret drop out", () => {
    const r = lineage(map, pod.id);
    expect(ids(r)).toEqual(want(ing, gw, route, svc, hpa, dep, rs1, pod, cm, sec));
    expect(r.edges.every((e) => ids(r).includes(e.from) && ids(r).includes(e.to))).toBe(true);
  });
  it("a Deployment keeps all its ReplicaSets and its pods' chain", () => {
    expect(ids(lineage(map, dep.id))).toEqual(want(ing, gw, route, svc, hpa, dep, rs1, rs2, pod, cm, sec));
  });
  it("a Service keeps HTTPRoute to Gateway but not the old ReplicaSet", () => {
    const r = ids(lineage(map, svc.id));
    expect(r).toEqual(want(ing, gw, route, svc, hpa, dep, rs1, pod, cm, sec));
    expect(r).not.toContain(rs2.id);
  });
  it("a Secret keeps every pod that uses it and their chains", () => {
    expect(ids(lineage(map, sec.id))).toEqual(want(ing, gw, route, svc, hpa, dep, rs1, pod, cm, sec, dep2, rs3, pod2));
  });
});

describe("focusBanner", () => {
  it("says what the chain left out, or that nothing was", () => {
    expect(focusBanner("Pod p", 9, 31)).toBe("Showing the chain for Pod p: 9 of 31 connected objects. Sibling objects and shared config are left out.");
    expect(focusBanner("Deployment d", 12, 12)).toBe("Showing the chain for Deployment d. Everything connected to it is part of the chain.");
    expect(focusBanner("Pod p", 1, 1)).toBe("Pod p has no connections. Showing it alone.");
    expect(focusBanner("Pod p", 0, 0)).toBe("Showing the chain for Pod p.");
  });
});

describe("matchIds", () => {
  it("matches names and group members, case-insensitively; empty query matches nothing", () => {
    const a = node("svc", "Api");
    const g: MapViewNode = { ...node("pods", "x9"), id: "group:g", members: [node("pods", "worker-1")] };
    expect(matchIds([a, g], "api")).toEqual(new Set([a.id]));
    expect(matchIds([a, g], "WORKER")).toEqual(new Set(["group:g"]));
    expect(matchIds([a, g], " ").size).toBe(0);
  });
});

describe("mapState", () => {
  const base: ResourceMap = { nodes: [], edges: [], truncated: false, skipped: [] };
  const sk = (...s: MapSource[]) => s.map((source) => ({ source, reason: "forbidden" }));
  it("truncated first", () => expect(mapState({ ...base, truncated: true }, null)).toBe("truncated"));
  it("nothing vs nothing-partial: never 'nothing' while a source was skipped", () => {
    expect(mapState(base, null)).toBe("nothing");
    expect(mapState({ ...base, skipped: sk("secrets") }, null)).toBe("nothing-partial");
  });
  it("no access when pods are skipped and nothing came back", () => {
    expect(mapState({ ...base, skipped: sk("pods") }, null)).toBe("no-access");
  });
  it("focus gone, and ok", () => {
    const n = node("deploy", "a");
    expect(mapState({ ...base, nodes: [n] }, "deploy/shop/b")).toBe("focus-gone");
    expect(mapState(base, "deploy/shop/b")).toBe("focus-gone");
    expect(mapState({ ...base, nodes: [n] }, n.id)).toBe("ok");
    expect(mapState({ ...base, nodes: [n] }, null)).toBe("ok");
  });
});
