import { describe, expect, it } from "vitest";
import type { MapEdge, MapKind, MapNode, MapSource, MapStatus, ResourceMap } from "../types/k8s";
import {
  DRAW_CAP, KIND_GROUPS, edgeFamily, relationLabel, MAP_COLUMN, NO_STATUS_KINDS, SKIPPED_COPY, countByGroup, drawable, focusNodeId, groupPods, hideGroups,
  focusBanner, lineage, mapState, matchIds, prepareMap, relationsOf, type MapViewNode,
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

describe("hideGroups", () => {
  const d = node("deploy", "api");
  const cm = node("cm", "env");
  const p = node("pods", "p");
  const edges = [edge(d, p), edge(p, cm, "uses-config")];
  it("removes a hidden group's nodes and touching edges", () => {
    const r = hideGroups([d, cm, p], edges, new Set(["config"]));
    expect(r.nodes.map((n) => n.id)).toEqual([d.id, p.id]);
    expect(r.edges).toEqual([edges[0]]);
  });
  it("is a no-op with nothing hidden", () => {
    expect(hideGroups([d], [], new Set()).nodes).toEqual([d]);
  });
  it("countByGroup counts per group", () => {
    expect(countByGroup([d, cm, p])).toEqual({ workloads: 2, routing: 0, storage: 0, config: 1, scaling: 0 });
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
  it("pipeline order is hide, group, count, cap", () => {
    const rs = node("rs", "r");
    const ps = pods(500);
    const map = { nodes: [rs, ...ps], edges: ps.map((p) => edge(rs, p)) };
    // grouped before counting: 500 pods become 1 group, so 2 drawable, not 501
    expect(prepareMap(map, new Set())).toMatchObject({ count: 2, tooMany: false });
    // hiding workloads removes the pods before grouping
    expect(prepareMap(map, new Set(["workloads"]))).toMatchObject({ count: 0, tooMany: false });
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
