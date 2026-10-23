import { describe, expect, it } from "vitest";
import type { LabelSelectorModel, NetpolModel, PeerModel, PodLabels, PolicyModel, PortModel, RuleModel } from "../types/k8s";
import { evaluateNetpol, intersectLabels, matchSelector, podReach } from "./netpolEval";

const sel = (labels: Record<string, string> = {}, exprs: LabelSelectorModel["match_expressions"] = []): LabelSelectorModel => ({ match_labels: labels, match_expressions: exprs });
const pod = (name: string, labels: Record<string, string>, controller = ""): PodLabels => ({ name, labels, controller });
const peer = (p: Partial<PeerModel>): PeerModel => ({ pod_selector: null, namespace_selector: null, ip_block: null, ...p });
const port = (p: string | null, end: number | null = null, protocol = "TCP"): PortModel => ({ protocol, port: p, end_port: end });
const rule = (peers: PeerModel[] = [], ports: PortModel[] = []): RuleModel => ({ peers, ports });
const pol = (name: string, podSel: LabelSelectorModel, types: PolicyModel["policy_types"], ingress: RuleModel[] = [], egress: RuleModel[] = []): PolicyModel =>
  ({ name, pod_selector: podSel, policy_types: types, ingress, egress });
const model = (policies: PolicyModel[], pods: PodLabels[], extra: Partial<NetpolModel> = {}): NetpolModel =>
  ({ policies, pods, namespaces: [{ name: "shop", labels: { team: "a" } }, { name: "other", labels: { team: "a" } }, { name: "kube-system", labels: {} }], skipped: [], ...extra });
const web = pod("web-1", { app: "web" });
const api = pod("api-1", { app: "api" });
const db = pod("db-1", { app: "db" });
const byName = (r: ReturnType<typeof evaluateNetpol>, n: string) => r.groups.find((g) => g.name === n)!;

describe("matchSelector", () => {
  it("follows Kubernetes semantics", () => {
    expect(matchSelector(sel(), { a: "1" })).toBe(true);
    expect(matchSelector(sel({ a: "1" }), { a: "1", b: "2" })).toBe(true);
    expect(matchSelector(sel({ a: "2" }), { a: "1" })).toBe(false);
    const ex = (operator: "In" | "NotIn" | "Exists" | "DoesNotExist", values: string[] = []) => sel({}, [{ key: "k", operator, values }]);
    expect(matchSelector(ex("In", ["x"]), { k: "x" })).toBe(true);
    expect(matchSelector(ex("In", ["x"]), {})).toBe(false);
    expect(matchSelector(ex("NotIn", ["x"]), {})).toBe(true);
    expect(matchSelector(ex("NotIn", ["x"]), { k: "x" })).toBe(false);
    expect(matchSelector(ex("Exists"), { k: "" })).toBe(true);
    expect(matchSelector(ex("DoesNotExist"), { k: "" })).toBe(false);
  });
});

describe("evaluateNetpol", () => {
  it("default-deny ingress restricts every group for ingress only and draws no edge", () => {
    const r = evaluateNetpol(model([pol("deny", sel(), ["Ingress"])], [web, api]), "shop");
    expect(r.groups.map((g) => g.ingress.restrictedBy)).toEqual([["deny"], ["deny"]]);
    expect(r.groups.map((g) => g.egress.restrictedBy)).toEqual([[], []]);
    expect(r.edges).toEqual([]);
  });

  it("allow-from-same-namespace collapses to the All pods pseudo-node", () => {
    const r = evaluateNetpol(model([pol("same-ns", sel(), ["Ingress"], [rule([peer({ pod_selector: sel() })])])], [web, api]), "shop");
    expect(r.pseudo).toEqual([{ id: "pseudo:All pods in namespace shop", label: "All pods in namespace shop", side: "src" }]);
    expect(r.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual([
      "pseudo:All pods in namespace shop>group:app=api",
      "pseudo:All pods in namespace shop>group:app=web",
    ]);
    expect(r.edges.every((e) => e.allowedBy[0] === "policy same-ns, ingress rule 1" && e.ports[0] === "any port")).toBe(true);
  });

  it("a podSelector peer draws group to group edges with ports and allowedBy", () => {
    const m = model([pol("allow-api", sel({ app: "api" }), ["Ingress"], [rule([peer({ pod_selector: sel({ app: "web" }) })], [port("8080")])])], [web, api]);
    const r = evaluateNetpol(m, "shop");
    expect(r.edges).toEqual([{ from: "group:app=web", to: "group:app=api", ports: ["TCP 8080"], allowedBy: ["policy allow-api, ingress rule 1"] }]);
  });

  it("a namespaceSelector matching the policy's namespace collapses to All pods, plus a pseudo-node for the others (S9)", () => {
    const m = model([pol("ns", sel({ app: "api" }), ["Ingress"], [rule([peer({ namespace_selector: sel({ team: "a" }) })])])], [web, api]);
    const r = evaluateNetpol(m, "shop");
    expect(r.edges.some((e) => e.from.startsWith("group:"))).toBe(false);
    expect(r.pseudo.map((p) => p.label)).toEqual(["All pods in namespace shop", "Namespaces: team=a (2 matching)"]);
  });

  it("a namespaceSelector {} with a podSelector still draws the specific groups", () => {
    const m = model([pol("ns", sel({ app: "api" }), ["Ingress"], [rule([peer({ namespace_selector: sel(), pod_selector: sel({ app: "web" }) })])])], [web, api]);
    expect(evaluateNetpol(m, "shop").edges.some((e) => e.from === "group:app=web" && e.to === "group:app=api")).toBe(true);
  });

  it("M1: B allows anywhere and A's egress is restricted to B: the A to B edge is drawn, with no false no-rule line", () => {
    const m = model(
      [
        pol("b-in", sel({ app: "b" }), ["Ingress"], [rule([], [port("80")])]),
        pol("a-out", sel({ app: "a" }), ["Egress"], [], [rule([peer({ pod_selector: sel({ app: "b" }) })], [port("80")])]),
      ],
      [pod("a-1", { app: "a" }), pod("b-1", { app: "b" })],
    );
    const r = evaluateNetpol(m, "shop");
    expect(r.edges.find((e) => e.from === "group:app=a" && e.to === "group:app=b")).toMatchObject({ ports: ["TCP 80"], allowedBy: ["policy a-out, egress rule 1", "policy b-in, ingress rule 1"] });
    expect(r.edges.some((e) => e.from === "pseudo:Anywhere" && e.to === "group:app=b")).toBe(true);
    expect(r.noRule["group:app=b"] ?? []).toEqual([]);
  });

  it("M1: A egress to podSelector {} and B ingress from app=a: the A to B edge is drawn", () => {
    const m = model(
      [
        pol("a-out", sel({ app: "a" }), ["Egress"], [], [rule([peer({ pod_selector: sel() })])]),
        pol("b-in", sel({ app: "b" }), ["Ingress"], [rule([peer({ pod_selector: sel({ app: "a" }) })])]),
      ],
      [pod("a-1", { app: "a" }), pod("b-1", { app: "b" })],
    );
    const r = evaluateNetpol(m, "shop");
    expect(r.edges.some((e) => e.from === "group:app=a" && e.to === "group:app=b")).toBe(true);
    expect(r.edges.some((e) => e.from === "group:app=a" && e.to === "pseudo:All pods in namespace shop")).toBe(true);
  });

  it("M1: noRule comes from the evaluation: empty under Anywhere and All pods, set when a rule excludes a group", () => {
    const pods = [pod("a-1", { app: "a" }), pod("b-1", { app: "b" }), pod("c-1", { app: "c" })];
    const any = evaluateNetpol(model([pol("any", sel({ app: "b" }), ["Ingress"], [rule()])], pods), "shop");
    expect(any.noRule["group:app=b"] ?? []).toEqual([]);
    const allPods = evaluateNetpol(model([pol("all", sel({ app: "b" }), ["Ingress"], [rule([peer({ pod_selector: sel() })])])], pods), "shop");
    expect(allPods.noRule["group:app=b"] ?? []).toEqual([]);
    const only = evaluateNetpol(model([pol("only-a", sel({ app: "b" }), ["Ingress"], [rule([peer({ pod_selector: sel({ app: "a" }) })])])], pods), "shop");
    expect(only.noRule["group:app=b"]).toEqual(["group:app=c"]);
  });

  it("the complete digraph stays collapsed: allow-from-everything draws no group to group edge", () => {
    const pods = [pod("a-1", { app: "a" }), pod("b-1", { app: "b" }), pod("c-1", { app: "c" })];
    const m = model([pol("deny-ish", sel(), ["Ingress", "Egress"], [rule([peer({ pod_selector: sel() })])], [rule([peer({ pod_selector: sel() })])])], pods);
    const r = evaluateNetpol(m, "shop");
    expect(r.edges.some((e) => e.from.startsWith("group:") && e.to.startsWith("group:"))).toBe(false);
    expect(r.edges.length).toBe(6);
  });

  it("N13: two groups with one owner name get their label set appended", () => {
    const c = (name: string, labels: Record<string, string>) => pod(name, labels, "ReplicaSet/api-7d9f");
    const r = evaluateNetpol(model([], [c("p1", { app: "api", "pod-template-hash": "7d9f" }), c("p2", { app: "api", track: "canary", "pod-template-hash": "7d9f" })]), "shop");
    expect(r.groups.map((g) => g.name).sort()).toEqual(["api (app=api)", "api (app=api,track=canary)"]);
  });

  it("a namespaceSelector that does not match this namespace draws only the pseudo-node", () => {
    const m = model([pol("ns", sel({ app: "api" }), ["Ingress"], [rule([peer({ namespace_selector: sel({ team: "b" }) })])])], [web, api], {
      namespaces: [{ name: "shop", labels: { team: "a" } }, { name: "z", labels: { team: "b" } }],
    });
    const r = evaluateNetpol(m, "shop");
    expect(r.edges.map((e) => e.from)).toEqual(["pseudo:Namespaces: team=b (1 matching)"]);
  });

  it("ipBlock with except becomes an External pseudo-node on the destination side", () => {
    const m = model([pol("out", sel({ app: "api" }), ["Egress"], [], [rule([peer({ ip_block: { cidr: "10.0.0.0/8", except: ["10.1.0.0/16"] } })], [port("443")])])], [web, api]);
    const r = evaluateNetpol(m, "shop");
    expect(r.pseudo).toEqual([{ id: "pseudo:External 10.0.0.0/8 except 10.1.0.0/16", label: "External 10.0.0.0/8 except 10.1.0.0/16", side: "dst" }]);
    expect(r.edges).toEqual([{ from: "group:app=api", to: "pseudo:External 10.0.0.0/8 except 10.1.0.0/16", ports: ["TCP 443"], allowedBy: ["policy out, egress rule 1"] }]);
  });

  it("an empty peer list is the Anywhere pseudo-node and an empty port list is any port", () => {
    const r = evaluateNetpol(model([pol("open", sel(), ["Ingress"], [rule()])], [web]), "shop");
    expect(r.pseudo.map((p) => p.label)).toEqual(["Anywhere"]);
    expect(r.edges[0].ports).toEqual(["any port"]);
  });

  it("an egress-only policy draws an edge when only the source side is restricted", () => {
    const m = model([pol("egress-api", sel({ app: "api" }), ["Egress"], [], [rule([peer({ pod_selector: sel({ app: "db" }) })], [port("5432")])])], [api, db, web]);
    const r = evaluateNetpol(m, "shop");
    expect(r.edges).toEqual([{ from: "group:app=api", to: "group:app=db", ports: ["TCP 5432"], allowedBy: ["policy egress-api, egress rule 1"] }]);
  });

  it("both sides restricted: the edge needs both to allow, with the port intersection", () => {
    const m = model(
      [
        pol("out", sel({ app: "web" }), ["Egress"], [], [rule([peer({ pod_selector: sel({ app: "api" }) })], [port("8000", 8100)])]),
        pol("in", sel({ app: "api" }), ["Ingress"], [rule([peer({ pod_selector: sel({ app: "web" }) })], [port("8050")])]),
      ],
      [web, api],
    );
    const r = evaluateNetpol(m, "shop");
    expect(r.edges).toEqual([{ from: "group:app=web", to: "group:app=api", ports: ["TCP 8050"], allowedBy: ["policy in, ingress rule 1", "policy out, egress rule 1"] }]);
  });

  it("policy_types Egress with an ingress section: the ingress rules are ignored", () => {
    const m = model([pol("odd", sel({ app: "api" }), ["Egress"], [rule([peer({ pod_selector: sel({ app: "web" }) })])], [])], [web, api]);
    const r = evaluateNetpol(m, "shop");
    expect(byName(r, "app=api").ingress.restrictedBy).toEqual([]);
    expect(r.edges).toEqual([]);
  });

  it("a policy that selects no pod goes to selectsNothing", () => {
    const r = evaluateNetpol(model([pol("ghost", sel({ app: "none" }), ["Ingress"]), pol("zzz", sel({ app: "web" }), ["Ingress"])], [web]), "shop");
    expect(r.selectsNothing).toEqual(["ghost"]);
  });

  it("StatefulSet pod-name is ignored (one group) and kept when a policy selects on it", () => {
    const pods = [0, 1, 2].map((i) => pod(`db-${i}`, { app: "db", "statefulset.kubernetes.io/pod-name": `db-${i}` }, "StatefulSet/db"));
    const one = evaluateNetpol(model([], pods), "shop");
    expect(one.groups).toHaveLength(1);
    expect(one.groups[0]).toMatchObject({ name: "db", pods: ["db-0", "db-1", "db-2"] });
    const sel0 = pol("p0", sel({ "statefulset.kubernetes.io/pod-name": "db-0" }), ["Ingress"]);
    const three = evaluateNetpol(model([sel0], pods), "shop");
    expect(three.groups).toHaveLength(3);
    expect(three.groups.filter((g) => g.ingress.restrictedBy.length).map((g) => g.pods)).toEqual([["db-0"]]);
  });

  it("names a group after its ReplicaSet owner minus the hash, else by labels, else (no labels)", () => {
    const a = pod("api-7d9f-x", { app: "api", "pod-template-hash": "7d9f" }, "ReplicaSet/api-7d9f");
    const b = pod("lone", {});
    const r = evaluateNetpol(model([], [a, b]), "shop");
    expect(r.groups.map((g) => g.name).sort()).toEqual(["(no labels)", "api"]);
    const c = pod("mixed", { app: "x" }, "");
    expect(evaluateNetpol(model([], [c]), "shop").groups[0].name).toBe("app=x");
  });

  it("O7: with namespaces skipped, a selector draws to own groups only for {} or the metadata.name label", () => {
    const skipped = [{ source: "namespaces" as const, reason: "forbidden" }];
    const mk = (s: LabelSelectorModel) => evaluateNetpol(model([pol("p", sel({ app: "api" }), ["Ingress"], [rule([peer({ namespace_selector: s })])])], [web, api], { skipped, namespaces: [] }), "shop");
    const team = mk(sel({ team: "a" }));
    expect(team.pseudo[0].label).toBe("Namespaces: team=a (matching namespaces unknown)");
    expect(team.edges.map((e) => e.from)).toEqual([team.pseudo[0].id]);
    const all = mk(sel());
    expect(all.pseudo.map((p) => p.label)).toEqual(["All namespaces", "All pods in namespace shop"]);
    const own = mk(sel({ "kubernetes.io/metadata.name": "shop" }));
    expect(own.pseudo.map((p) => p.label)).toContain("All pods in namespace shop");
    expect(own.edges.some((e) => e.from === "group:app=web")).toBe(false);
    const elsewhere = mk(sel({ "kubernetes.io/metadata.name": "other" }));
    expect(elsewhere.edges.some((e) => e.from === "group:app=web")).toBe(false);
  });
});

describe("ports", () => {
  it("intersects ranges, keeps a named port against any port, drops disjoint and cross-protocol", () => {
    expect(intersectLabels([port("8000", 8100)], [port("8050")])).toEqual(["TCP 8050"]);
    expect(intersectLabels([port("8000", 8100)], [port("8050", 9000)])).toEqual(["TCP 8050-8100"]);
    expect(intersectLabels([port("http")], [port("80")])).toEqual(["port http (name, not resolved)"]);
    expect(intersectLabels([port("80")], [port("81")])).toEqual([]);
    expect(intersectLabels([port("53", null, "UDP")], [port("53")])).toEqual([]);
    expect(intersectLabels([], [port("80")])).toEqual(["TCP 80"]);
    expect(intersectLabels([], [])).toEqual(["any port"]);
  });
});

describe("podReach", () => {
  it("lists a pod group's allowed sources and destinations, null for an unknown pod", () => {
    const m = model([pol("allow-api", sel({ app: "api" }), ["Ingress"], [rule([peer({ pod_selector: sel({ app: "web" }) })], [port("8080")])])], [web, api]);
    const r = evaluateNetpol(m, "shop");
    const reach = podReach(r, "api-1")!;
    expect(reach.group.name).toBe("app=api");
    expect(reach.ingress).toEqual([{ id: "group:app=web", label: "app=web", ports: ["TCP 8080"], allowedBy: ["policy allow-api, ingress rule 1"] }]);
    expect(reach.egress).toEqual([]);
    expect(podReach(r, "nope")).toBeNull();
  });
});
