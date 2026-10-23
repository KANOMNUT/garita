import { describe, it, expect } from "vitest";
import { PROPAGATION_DEPENDENTS, deleteLabelFor, propagationDependents } from "./PropagationPicker";

describe("propagation picker contract", () => {
  it("covers exactly the six owner kinds", () => {
    expect(Object.keys(PROPAGATION_DEPENDENTS).sort()).toEqual(["cron", "deploy", "ds", "jobs", "rs", "sts"]);
  });
  it("names the right dependents (03 §12.1)", () => {
    expect(propagationDependents("deploy")).toBe("ReplicaSets and pods");
    expect(propagationDependents("cron")).toBe("Jobs and their pods");
    expect(propagationDependents("sts")).toBe("pods");
  });
  it("pods, namespaces, services, argocd and helm get no picker", () => {
    for (const k of ["pods", "svc", "argocd", "helm", "nodes", "cm"]) expect(propagationDependents(k)).toBeUndefined();
  });
  it("only Orphan changes the primary label", () => {
    expect(deleteLabelFor("background")).toBe("Delete");
    expect(deleteLabelFor("foreground")).toBe("Delete");
    expect(deleteLabelFor("orphan")).toBe("Delete, keep dependents");
  });
});
