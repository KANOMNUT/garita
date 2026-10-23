import { describe, expect, it } from "vitest";
import type { UnusedCandidate } from "../types/k8s";
import {
  cardCounts, filterCandidates, groupByKind, kindsInScope, partialLine, scopeLine, uncheckedKinds, unusedPageState, type UnusedSource,
} from "./unused";

const skip = (source: UnusedSource) => ({ source, reason: "forbidden: nope" });
const cand = (kind: UnusedCandidate["kind"], name: string, namespace = "shop"): UnusedCandidate =>
  ({ kind, namespace, name, reason: "not-referenced", detail: "d" });

describe("kindsInScope", () => {
  it("lists PVs and cluster roles only for all namespaces", () => {
    expect(kindsInScope("all")).toContain("pv");
    expect(kindsInScope("all")).toContain("croles");
    expect(kindsInScope("shop")).not.toContain("pv");
    expect(kindsInScope("shop")).not.toContain("croles");
  });
});

describe("uncheckedKinds", () => {
  it("pods skipped: cm, sec, pvc and sa are not checked; the rest still are", () => {
    expect(uncheckedKinds([skip("pods")], "all")).toEqual(["cm", "sec", "pvc", "sa"]);
  });
  it("a skipped own list stops only that kind", () => {
    expect(uncheckedKinds([skip("persistentvolumes")], "all")).toEqual(["pv"]);
    expect(uncheckedKinds([skip("deployments")], "all")).toEqual(["cm", "sec", "pvc", "sa", "deploy"]);
  });
  it("role bindings skipped stop roles and cluster roles", () => {
    expect(uncheckedKinds([skip("rolebindings")], "all")).toEqual(["roles", "croles"]);
    expect(uncheckedKinds([skip("rolebindings")], "shop")).toEqual(["roles"]);
  });
  it("gateways skipped stops secrets", () => {
    expect(uncheckedKinds([skip("gateways")], "shop")).toEqual(["sec"]);
  });
});

describe("unusedPageState", () => {
  it("is no-access only when every kind in scope is unchecked and nothing came back", () => {
    const all: UnusedSource[] = ["pods", "configmaps", "secrets", "persistentvolumeclaims", "serviceaccounts", "persistentvolumes", "roles", "clusterroles", "deployments", "statefulsets"];
    expect(unusedPageState(0, all.map(skip), "all")).toBe("no-access");
    expect(unusedPageState(0, [skip("pods")], "all")).toBe("nothing-partial");
    expect(unusedPageState(0, [], "all")).toBe("nothing");
    expect(unusedPageState(3, [skip("pods")], "all")).toBe("partial");
    expect(unusedPageState(3, [], "all")).toBe("list");
  });
});

describe("partialLine", () => {
  it("names the sources and the unchecked kinds", () => {
    expect(partialLine([skip("pods")], "all")).toBe("Couldn't read pods (forbidden). ConfigMaps, Secrets, PVCs and Service accounts weren't checked.");
  });
});

describe("cards, filter, groups", () => {
  const cs = [cand("cm", "b"), cand("cm", "a"), cand("deploy", "d"), cand("sts", "s")];
  it("merges deploy and sts into Workloads", () => {
    expect(cardCounts(cs)).toEqual([{ id: "cm", label: "ConfigMaps", count: 2 }, { id: "workloads", label: "Workloads", count: 2 }]);
    expect(filterCandidates(cs, "workloads", "")).toHaveLength(2);
  });
  it("searches kind label, namespace and name", () => {
    expect(filterCandidates(cs, null, "statefulset")).toHaveLength(1);
    expect(filterCandidates(cs, null, "shop/a")).toHaveLength(0);
    expect(filterCandidates(cs, null, "shop a")).toHaveLength(1);
  });
  it("groups in a fixed kind order", () => {
    expect(groupByKind(cs).map((g) => g.kind)).toEqual(["cm", "deploy", "sts"]);
  });
});

describe("scopeLine", () => {
  it("prints the excluded namespaces from the payload", () => {
    expect(scopeLine("all", ["kube-system", "kube-public", "kube-node-lease"], 9))
      .toBe("All namespaces except kube-system, kube-public and kube-node-lease · 9 found");
    expect(scopeLine("shop", [], 3)).toBe("Namespace shop · 3 found");
    expect(scopeLine("all", [], null)).toBe("All namespaces");
  });
});
