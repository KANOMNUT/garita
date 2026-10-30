import { describe, expect, it } from "vitest";
import { CLUSTER_SCOPED_KINDS, resourceNamespace, viewHidesNamespacePicker } from "./scope";
import type { ResourceType, SelectedResource } from "../types/k8s";

const CLUSTER_SCOPED = ["pv", "sc", "nodes", "crd", "croles", "crbindings", "pc", "mwc", "vwc", "ns"];
const sel = (kind: string) => ({ kind, ns: "ns1", item: { name: "x" } }) as unknown as SelectedResource;

describe("scope", () => {
  it("has exactly the cluster-scoped kinds gvk_for lists as non-namespaced", () => {
    expect([...CLUSTER_SCOPED_KINDS].sort()).toEqual([...CLUSTER_SCOPED].sort());
  });
  it("resourceNamespace is null for cluster-scoped, ns for argocd", () => {
    for (const k of CLUSTER_SCOPED) expect(resourceNamespace(sel(k))).toBeNull();
    expect(resourceNamespace(sel("argocd"))).toBe("ns1");
  });
  it("viewHidesNamespacePicker keeps argocd and conditional crd-instances", () => {
    for (const k of [...CLUSTER_SCOPED, "argocd", "argo-appsets", "argo-projects", "argo-repos"])
      expect(viewHidesNamespacePicker(k as ResourceType, true)).toBe(true);
    expect(viewHidesNamespacePicker("crd-instances", false)).toBe(true);
    expect(viewHidesNamespacePicker("crd-instances", true)).toBe(false);
    expect(viewHidesNamespacePicker("deploy", false)).toBe(false);
  });
});
