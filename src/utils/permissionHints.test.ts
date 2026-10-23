import { describe, expect, it } from "vitest";
import { deniedNamespaces, ephemeralContainerCheck, evictionChecks, evictionDeniedLine, secretGetCheck } from "./permissionHints";
import type { DrainPodPreview, DrainPreview } from "../types/k8s";

const pod = (namespace: string, name: string, category: DrainPodPreview["category"]): DrainPodPreview => ({
  namespace, name, category, owner_kind: null, owner_name: null, unmanaged: false,
  has_empty_dir: false, pdbs: [], may_be_blocked: false,
});
const preview = (pods: DrainPodPreview[]): DrainPreview => ({
  node: "n1", unschedulable: true, node_ready: true, pods, pdb_lookup_errors: [],
});

describe("evictionChecks", () => {
  it("issues one create pods/eviction check per distinct namespace of pods to evict", () => {
    const checks = evictionChecks(preview([
      pod("b", "p1", "evict"), pod("a", "p2", "evict"), pod("a", "p3", "evict"),
      pod("c", "ds", "daemonset"), pod("d", "mirror", "mirror"),
    ]));
    expect(checks.map((c) => c.namespace)).toEqual(["a", "b"]);
    expect(checks[0]).toEqual({ group: "", resource: "pods", subresource: "eviction", verb: "create", namespace: "a" });
  });
  it("is empty without a preview", () => {
    expect(evictionChecks(null)).toEqual([]);
    expect(evictionChecks(undefined)).toEqual([]);
  });
});

describe("deniedNamespaces", () => {
  const checks = evictionChecks(preview([pod("a", "x", "evict"), pod("b", "y", "evict"), pod("c", "z", "evict")]));
  it("returns only explicit denials, in input order", () => {
    expect(deniedNamespaces(checks, [{ allowed: true }, { allowed: false }, { allowed: false }] as never)).toEqual(["b", "c"]);
  });
  it("fails open on missing data, short results and malformed entries", () => {
    expect(deniedNamespaces(checks, undefined)).toEqual([]);
    expect(deniedNamespaces(checks, [])).toEqual([]);
    expect(deniedNamespaces(checks, [{ allowed: undefined }, null, {}] as never)).toEqual([]);
  });
  it("words the line from the denied namespaces", () => {
    expect(evictionDeniedLine(["a", "b"])).toBe("Your account can't evict pods in a, b. Those evictions will fail.");
  });
});

describe("ephemeralContainerCheck", () => {
  it("checks update pods/ephemeralcontainers in the pod's own namespace", () => {
    expect(ephemeralContainerCheck("shop")).toEqual([
      { group: "", resource: "pods", subresource: "ephemeralcontainers", verb: "update", namespace: "shop" },
    ]);
    expect(ephemeralContainerCheck("")).toEqual([]);
  });
});

describe("secretGetCheck", () => {
  it("checks get secrets in the Secret's own namespace", () => {
    expect(secretGetCheck("shop")).toEqual([{ group: "", resource: "secrets", verb: "get", namespace: "shop" }]);
    expect(secretGetCheck("")).toEqual([]);
  });
});
