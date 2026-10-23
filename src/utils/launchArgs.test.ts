import { describe, expect, it } from "vitest";
import type { LaunchArgs } from "../types/k8s";
import { deferredLine, isEmptyLaunch, launchLines, namespaceLine, planLaunchArgs } from "./launchArgs";

const a = (p: Partial<LaunchArgs>): LaunchArgs => ({ context: null, namespace: null, kind: null, ignored: [], ...p });
const ctxs = ["dev", "prod"];
const plan = (p: Partial<LaunchArgs>, source: "startup" | "forwarded" = "forwarded", view?: Parameters<typeof planLaunchArgs>[4]) =>
  planLaunchArgs(a(p), ctxs, "dev", source, view);

describe("planLaunchArgs", () => {
  it("carries context, namespace, kind", () => {
    expect(plan({ context: "prod", namespace: "kube-system", kind: "deploy" })).toMatchObject({ context: "prod", namespace: "kube-system", kind: "deploy" });
  });
  it("forwarded switch gets a Switched line; startup does not", () => {
    expect(plan({ context: "prod" }).lines).toEqual(["Switched to 'prod' (from the command line)."]);
    expect(plan({ context: "prod" }, "startup").lines).toEqual([]);
  });
  it("unknown context: line, no switch, rest still applies", () => {
    const p = plan({ context: "nope", kind: "pods" });
    expect(p.context).toBeNull();
    expect(p.kind).toBe("pods");
    expect(p.lines).toEqual(["Context 'nope' not found; staying on 'dev'."]);
  });
  it("current context is a no-op with no line", () => {
    expect(plan({ context: "dev" })).toMatchObject({ context: null, lines: [] });
  });
  it("unknown kind and prototype keys fold into the Ignored line", () => {
    expect(plan({ kind: "widgets" })).toMatchObject({ kind: null, ignoredLine: "Ignored: widgets." });
    expect(plan({ kind: "toString" }).kind).toBeNull();
  });
  it("Ignored: first 3 then 'and N more'", () => {
    expect(plan({ ignored: ["--foo", "pdos"] }).ignoredLine).toBe("Ignored: --foo, pdos.");
    expect(plan({ ignored: ["--foo", "pdos", "x", "y", "z"] }).ignoredLine).toBe("Ignored: --foo, pdos, x and 2 more.");
    expect(plan({ ignored: ["a", "b"], kind: "nope" }).ignoredLine).toBe("Ignored: a, b, nope.");
  });
  it("caps displayed names at 64 characters", () => {
    const long = "c".repeat(100);
    const p = planLaunchArgs(a({ context: long }), [long], "dev", "forwarded");
    expect(p.lines[0]).toBe(`Switched to '${"c".repeat(64)}...' (from the command line).`);
  });
  it("drops namespace on cluster-scoped and argocd kinds, silently", () => {
    expect(plan({ namespace: "x", kind: "nodes" })).toMatchObject({ namespace: null, kind: "nodes", lines: [] });
    expect(plan({ namespace: "x", kind: "argocd" }).namespace).toBeNull();
  });
  it("without kind, namespace judged by current view", () => {
    expect(plan({ namespace: "x" }, "forwarded", "nodes").namespace).toBeNull();
    expect(plan({ namespace: "x" }, "forwarded", "pods").namespace).toBe("x");
    expect(plan({ namespace: "x" }).namespace).toBe("x");
  });
});

describe("namespaceLine (K10 fail open)", () => {
  it("null list or known name: no line", () => {
    expect(namespaceLine("x", null, "prod", "all")).toBeNull();
    expect(namespaceLine("x", ["x", "y"], "prod", "all")).toBeNull();
  });
  it("unknown name: line with current label", () => {
    expect(namespaceLine("x", ["y"], "prod", "all")).toBe("Namespace 'x' not found in 'prod'; staying on All namespaces.");
    expect(namespaceLine("x", ["y"], "prod", "kube-system")).toBe("Namespace 'x' not found in 'prod'; staying on 'kube-system'.");
  });
});

describe("launchLines / deferredLine / isEmptyLaunch", () => {
  it("orders context, namespace, ignored", () => {
    const p = plan({ context: "prod", ignored: ["--foo"] });
    expect(launchLines(p, "NS")).toEqual(["Switched to 'prod' (from the command line).", "NS", "Ignored: --foo."]);
  });
  it("deferred lists only the parts present", () => {
    expect(deferredLine(plan({ context: "prod", namespace: "kube-system", kind: "pods" })))
      .toBe("The command line asked for context 'prod', namespace 'kube-system', Pods. Close the open dialog first.");
    expect(deferredLine(plan({ kind: "deploy" }))).toBe("The command line asked for Deployments. Close the open dialog first.");
  });
  it("default args are empty", () => {
    expect(isEmptyLaunch(a({}))).toBe(true);
    expect(isEmptyLaunch(a({ ignored: ["x"] }))).toBe(false);
  });
});
