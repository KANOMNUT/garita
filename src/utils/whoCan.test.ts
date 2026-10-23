import { describe, expect, it } from "vitest";
import type { CRD, ClusterRoleBinding, RbacSubject, RoleBinding, RuleGrant, WhoCanGrant } from "../types/k8s";
import {
  boundTo, foundAnnouncement, groupRuleGrants, groupSubjects, parseResourceInput, resolveResource, resourceChoices,
  skipLine, subjectCount, whoCanState,
} from "./whoCan";

const sa = (ns: string, name: string): RbacSubject => ({ kind: "ServiceAccount", name, namespace: ns });
const grant = (subject: RbacSubject, p: Partial<WhoCanGrant> = {}): WhoCanGrant => ({
  subject, binding_kind: "RoleBinding", binding: "b", binding_namespace: "shop", role_kind: "ClusterRole", role: "edit",
  scope: "namespace", resource_names: [], via_wildcard: false, ...p,
});

describe("parseResourceInput", () => {
  it("reads the kubectl forms", () => {
    expect(parseResourceInput("pods")).toEqual({ resource: "pods", group: null, subresource: "" });
    expect(parseResourceInput("deployments.apps")).toEqual({ resource: "deployments", group: "apps", subresource: "" });
    expect(parseResourceInput("pods/log")).toEqual({ resource: "pods", group: null, subresource: "log" });
    expect(parseResourceInput(" certificates.cert-manager.io/status ")).toEqual({ resource: "certificates", group: "cert-manager.io", subresource: "status" });
  });
});

describe("resolveResource", () => {
  const crd = { plural: "widgets", group: "acme.io", scope: "Cluster" } as CRD;
  const choices = resourceChoices({ pods: { group: "", resource: "pods" }, deploy: { group: "apps", resource: "deployments" }, nodes: { group: "", resource: "nodes" } }, [crd]);
  it("carries the group of known kinds and CRDs", () => {
    expect(resolveResource("deployments", choices)).toMatchObject({ group: "apps", resource: "deployments", clusterScoped: false });
    expect(resolveResource("widgets", choices)).toMatchObject({ group: "acme.io", clusterScoped: true });
    expect(resolveResource("nodes", choices)?.clusterScoped).toBe(true);
  });
  it("takes an explicit group and a subresource, and defaults unknown text to core", () => {
    expect(resolveResource("pods/log", choices)).toMatchObject({ group: "", resource: "pods", subresource: "log" });
    expect(resolveResource("foos.bar.io", choices)).toMatchObject({ group: "bar.io", resource: "foos" });
    expect(resolveResource("foos", choices)).toMatchObject({ group: "", resource: "foos" });
    expect(resolveResource("  ", choices)).toBeNull();
  });
});

describe("groupSubjects", () => {
  const grants = [
    grant(sa("shop", "ci")), grant(sa("shop", "ci"), { binding: "b2" }),
    grant({ kind: "Group", name: "system:masters", namespace: null }),
    grant({ kind: "Group", name: "devs", namespace: null }),
    grant({ kind: "User", name: "alice", namespace: null }),
  ];
  it("makes one row per subject and collapses system:* but still counts it", () => {
    const g = groupSubjects(grants);
    expect(g.map((x) => [x.label, x.count])).toEqual([["Service accounts", 1], ["Groups", 2], ["Users", 1]]);
    expect(g[0].rows[0].grants).toHaveLength(2);
    expect(g[1].rows.map((r) => r.subject.name)).toEqual(["devs"]);
    expect(g[1].builtin.map((r) => r.subject.name)).toEqual(["system:masters"]);
    expect(subjectCount(g)).toBe(4);
  });
  it("filters by subject text", () => {
    expect(subjectCount(groupSubjects(grants, "shop/ci"))).toBe(1);
    expect(subjectCount(groupSubjects(grants, "SYSTEM"))).toBe(1);
  });
  it("announces", () => {
    expect(foundAnnouncement(1)).toBe("1 subject found");
    expect(foundAnnouncement(4)).toBe("4 subjects found");
  });
});

describe("whoCanState / skipLine", () => {
  const skip = (source: "rolebindings" | "clusterrolebindings" | "roles" | "clusterroles") => ({ source, reason: "forbidden: nope" });
  it("is no-access only when every binding source read was skipped", () => {
    expect(whoCanState(0, [skip("clusterrolebindings")], false)).toBe("no-access");
    // the role lists skipped: nothing to match rules against, even though the bindings read
    expect(whoCanState(0, [skip("clusterroles")], false)).toBe("no-access");
    expect(whoCanState(0, [skip("clusterroles")], true)).toBe("nothing-partial");
    expect(whoCanState(0, [skip("clusterroles"), skip("roles")], true)).toBe("no-access");
    expect(whoCanState(3, [skip("clusterroles")], false)).toBe("partial");
    expect(whoCanState(0, [skip("clusterrolebindings")], true)).toBe("nothing-partial");
    expect(whoCanState(0, [skip("clusterrolebindings"), skip("rolebindings")], true)).toBe("no-access");
    expect(whoCanState(0, [], true)).toBe("nothing");
    expect(whoCanState(2, [skip("roles")], true)).toBe("partial");
    expect(whoCanState(2, [], true)).toBe("list");
  });
  it("words the strip", () => {
    expect(skipLine([skip("clusterrolebindings")])).toBe("Couldn't read cluster role bindings (forbidden). The list may be incomplete.");
  });
});

describe("boundTo", () => {
  const rb = (ns: string, name: string, role_ref: string): RoleBinding =>
    ({ name, namespace: ns, role_ref, subjects: "", subject_list: [sa(ns, "x")], age: "1d" });
  const crb = (name: string, role_ref: string): ClusterRoleBinding => ({ name, role_ref, subjects: "", subject_list: [], age: "1d" });
  const rbs = [rb("a", "r1", "Role/dev"), rb("b", "r2", "Role/dev"), rb("a", "r3", "ClusterRole/dev")];
  const crbs = [crb("c1", "ClusterRole/dev"), crb("c2", "ClusterRole/other")];
  it("matches a Role in its own namespace only", () => {
    expect(boundTo({ kind: "Role", name: "dev", namespace: "a" }, rbs, crbs).map((b) => b.name)).toEqual(["r1"]);
  });
  it("matches a ClusterRole across cluster bindings and any namespace's RoleBindings", () => {
    expect(boundTo({ kind: "ClusterRole", name: "dev", namespace: "" }, rbs, crbs).map((b) => `${b.kind}:${b.name}`)).toEqual(["ClusterRoleBinding:c1", "RoleBinding:r3"]);
  });
});

describe("groupRuleGrants", () => {
  const rg = (p: Partial<RuleGrant>): RuleGrant => ({
    api_groups: [""], resources: ["pods"], verbs: ["get"], resource_names: [], non_resource_urls: [], binding_kind: "RoleBinding",
    binding: "b", binding_namespace: "shop", role_kind: "ClusterRole", role: "edit", scope: "namespace", via_group: null, ...p,
  });
  it("groups by scope (cluster first) then binding, and spells out wildcards", () => {
    const blocks = groupRuleGrants([
      rg({ resources: ["*"], verbs: ["*"] }),
      rg({ scope: "cluster", binding_kind: "ClusterRoleBinding", binding_namespace: null, api_groups: ["apps"], resources: ["deployments"], resource_names: ["a"] }),
      rg({ resources: [], non_resource_urls: ["/healthz"], verbs: ["get"] }),
    ]);
    expect(blocks.map((b) => b.title)).toEqual(["Cluster-wide", "In namespace shop"]);
    expect(blocks[0].bindings[0].rules[0]).toMatchObject({ text: "deployments.apps", named: ["a"], wildcard: false });
    const ns = blocks[1].bindings[0];
    expect(ns.rules[0].wordsAll).toEqual(["all verbs", "all resources"]);
    expect(ns.urls[0].text).toBe("/healthz");
  });
  it("keeps a group-reached binding apart", () => {
    const blocks = groupRuleGrants([rg({}), rg({ via_group: "system:authenticated" })]);
    expect(blocks[0].bindings.map((b) => b.viaGroup)).toEqual([null, "system:authenticated"]);
  });
});
