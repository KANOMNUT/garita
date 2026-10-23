import { describe, expect, it } from "vitest";
import type { DeprecatedApiFinding } from "../types/k8s";
import {
  cardOf, clusterNewerThanTable, deprecationState, evidenceLines, findingKey, headerLine, openTarget, parseMinor,
  partialLine, statusOf, summaryLine, whereLine,
} from "./deprecations";

const f = (p: Partial<DeprecatedApiFinding> = {}): DeprecatedApiFinding => ({
  source: "helm", api_version: "policy/v1beta1", kind: "PodDisruptionBudget", namespace: "shop", name: "web-pdb",
  helm_release: "web", helm_release_namespace: "shop", deprecated_in: "1.21", removed_in: "1.25", replacement: "policy/v1",
  served_by_this_server: false, ...p,
});

describe("parseMinor", () => {
  it("reads gitVersion shapes", () => {
    expect(parseMinor("v1.28.3-eks-abc")).toEqual({ major: 1, minor: 28 });
    expect(parseMinor("1.34")).toEqual({ major: 1, minor: 34 });
    expect(parseMinor("")).toBeNull();
    expect(parseMinor("garbage")).toBeNull();
  });
});

describe("cluster newer than table", () => {
  it("compares only when both parse", () => {
    expect(clusterNewerThanTable("v1.36.0", "1.34")).toBe(true);
    expect(clusterNewerThanTable("v1.34.2", "1.34")).toBe(false);
    expect(clusterNewerThanTable("v1.28.3", "1.34")).toBe(false);
    expect(clusterNewerThanTable("", "1.34")).toBe(false);
  });
  it("header falls back when the version is unreadable", () => {
    expect(headerLine("v1.28.3-eks", "1.34", 3)).toBe("Cluster runs Kubernetes 1.28 · Table covers Kubernetes up to 1.34 · 3 found");
    expect(headerLine("", "1.34", null)).toBe("Couldn't read this cluster's Kubernetes version. · Table covers Kubernetes up to 1.34");
  });
});

describe("status", () => {
  it("comes from served_by_this_server", () => {
    expect(statusOf(f())).toBe("removed");
    expect(statusOf(f({ served_by_this_server: true }))).toBe("deprecated");
    expect(statusOf(f({ served_by_this_server: true, removed_in: null }))).toBe("deprecated-no-removal");
    expect(cardOf(f({ served_by_this_server: true, removed_in: null }))).toBe("deprecated");
    expect(cardOf(f())).toBe("removed");
  });
});

describe("lines", () => {
  it("words the row", () => {
    expect(summaryLine(f())).toBe("Deprecated in 1.21, removed in 1.25. Use policy/v1.");
    expect(summaryLine(f({ removed_in: null, replacement: null }))).toBe("Deprecated in 1.21. No removal is planned.");
    expect(whereLine(f())).toBe("web-pdb in Helm release shop/web");
    expect(whereLine(f({ source: "last-applied", helm_release: null, helm_release_namespace: null }))).toBe("web-pdb in kubectl last-applied annotation (shop)");
  });
  it("evidence says served-or-not and explains a removed last-applied row", () => {
    expect(evidenceLines(f({ served_by_this_server: true }))).toEqual(["Source: Helm release manifest", "This cluster still serves policy/v1beta1."]);
    expect(evidenceLines(f({ source: "last-applied" }))).toHaveLength(3);
  });
});

describe("openTarget", () => {
  it("opens the Helm release for helm findings", () => {
    expect(openTarget(f())).toEqual({ kind: "helm", namespace: "shop", name: "web" });
  });
  it("opens the object for last-applied when the kind maps, else nothing", () => {
    expect(openTarget(f({ source: "last-applied", kind: "HorizontalPodAutoscaler", name: "h" }))).toEqual({ kind: "hpa", namespace: "shop", name: "h" });
    expect(openTarget(f({ source: "last-applied", kind: "Widget" }))).toBeNull();
    expect(openTarget(f({ source: "last-applied", kind: "constructor" }))).toBeNull();
  });
});

describe("findingKey", () => {
  it("separates the same object in two releases", () => {
    expect(findingKey(f())).not.toBe(findingKey(f({ helm_release: "other" })));
  });
});

describe("deprecationState / partialLine", () => {
  // The real Rust reasons: `<ns>/<release>: <err>` for Helm, `<plural>.<group>: <err>` for last-applied.
  const h = { source: "helm-releases" as const, reason: "forbidden: secrets is forbidden: User cannot list resource secrets" };
  const hr = { source: "helm-releases" as const, reason: "shop/web: forbidden: nope" };
  const l = { source: "last-applied" as const, reason: "horizontalpodautoscalers.autoscaling: forbidden: nope" };
  it("never says no-access: any skip with zero findings is nothing-partial", () => {
    expect(deprecationState(0, [h])).toBe("nothing-partial");
    expect(deprecationState(0, [h, l])).toBe("nothing-partial");
    // a view-only account: Helm Secrets forbidden and some last-applied kinds forbidden
    expect(deprecationState(0, [h, l, { ...l, reason: "poddisruptionbudgets.policy: forbidden: nope" }])).toBe("nothing-partial");
    expect(deprecationState(0, [])).toBe("nothing");
    expect(deprecationState(2, [h])).toBe("partial");
    expect(deprecationState(2, [])).toBe("list");
  });
  it("words the strip from the real reason shapes", () => {
    expect(partialLine([h])).toBe("Couldn't read Helm release Secrets (forbidden). Only kubectl last-applied annotations were checked.");
    expect(partialLine([hr])).toBe("Couldn't read Helm release Secrets (forbidden). Only kubectl last-applied annotations were checked.");
    expect(partialLine([l])).toBe("Couldn't read last-applied annotations for 1 kind (forbidden).");
    expect(partialLine([{ source: "helm-releases", reason: "shop/web: connection reset" }])).toContain("(error)");
  });
});
