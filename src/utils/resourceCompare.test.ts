import { describe, expect, it } from "vitest";
import { canCompare, classifyReadError, compareIgnore, notFoundText, sameApiServer } from "./resourceCompare";

describe("canCompare", () => {
  it("offers namespaced and cluster-scoped kinds, never pods, helm or the discovery-only ArgoCD kinds", () => {
    for (const k of ["deploy", "sec", "cm", "nodes", "pv", "argocd", "flux-ks", "crd"]) expect(canCompare(k)).toBe(true);
    for (const k of ["pods", "helm", "argo-appsets", "argo-projects", "argo-repos", "crd-instances"]) expect(canCompare(k)).toBe(false);
  });
});

describe("compareIgnore", () => {
  it("ignores status, managed fields and identity by default; the toggle only re-includes status", () => {
    expect(compareIgnore(false)).toContain("status");
    expect(compareIgnore(true)).not.toContain("status");
    for (const p of ["metadata.managedFields", "metadata.uid", "metadata.name", "metadata.namespace"]) expect(compareIgnore(true)).toContain(p);
  });
});

describe("classifyReadError", () => {
  it("maps the common rejections", () => {
    expect(classifyReadError('Failed to get resource: deployments.apps "x" not found')).toBe("not-found");
    expect(classifyReadError("deployments.apps is forbidden: User cannot get")).toBe("no-access");
    expect(classifyReadError("the server could not find the requested resource")).toBe("not-installed");
    expect(classifyReadError("Failed to connect: dns error")).toBe("unreachable");
    expect(classifyReadError("something odd")).toBe("error");
  });
});

describe("same API server", () => {
  it("needs both servers known and equal", () => {
    expect(sameApiServer({ server: "https://a" }, { server: "https://a" })).toBe(true);
    expect(sameApiServer({ server: "https://a" }, { server: "https://b" })).toBe(false);
    expect(sameApiServer({ server: "" }, { server: "" })).toBe(false);
    expect(sameApiServer(undefined, { server: "x" })).toBe(false);
  });
  it("words not-found", () => {
    expect(notFoundText("Deployment", "api", "staging", "shop")).toBe('Deployment "api" doesn\'t exist in staging / shop.');
    expect(notFoundText("Node", "n1", "staging", "")).toBe('Node "n1" doesn\'t exist in staging.');
  });
});
