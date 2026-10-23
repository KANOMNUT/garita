import { describe, expect, it } from "vitest";
import type { LimitRangeInfo, PdbRow, PriorityClassInfo, ResourceQuotaInfo, WebhookConfigRow, WebhookMatch } from "../types/k8s";
import {
  groupState, isConstraintKind, limitRangeRows, pdbRows, priorityRows, quotaRows, webhookMatches, webhookRows,
  type ConstraintTarget,
} from "./constraints";
import { PRODUCT_NAME } from "../brand";

const match = (over: Partial<WebhookMatch> = {}): WebhookMatch => ({
  webhook: "w", api_groups: [""], resources: ["pods"], operations: ["CREATE"], scope: "*",
  has_namespace_selector: false, has_object_selector: false, failure_policy: "Fail", ...over,
});
const cfg = (name: string, matches: WebhookMatch[]): WebhookConfigRow =>
  ({ name, webhooks: matches.length, failure_policy: "Fail", targets: "", age: "1d", matches });
const pod: ConstraintTarget = { kind: "pods", namespace: "shop", labels: { app: "web", tier: "fe" }, priorityClass: null };
const deploy: ConstraintTarget = { ...pod, kind: "deploy" };

describe("webhookMatches (A-13)", () => {
  it("core group, plural, wildcard and */*", () => {
    expect(webhookMatches(match(), "", "pods")).toBe(true);
    expect(webhookMatches(match({ resources: ["*"] }), "", "pods")).toBe(true);
    expect(webhookMatches(match({ resources: ["*/*"] }), "", "pods")).toBe(true);
    expect(webhookMatches(match({ api_groups: ["*"] }), "apps", "pods")).toBe(true);
  });
  it("subresource-only rules do not match", () => {
    expect(webhookMatches(match({ resources: ["pods/exec"] }), "", "pods")).toBe(false);
    expect(webhookMatches(match({ resources: ["pods/*"] }), "", "pods")).toBe(false);
    expect(webhookMatches(match({ resources: ["pods/exec", "pods"] }), "", "pods")).toBe(true);
  });
  it("wrong group or Cluster scope do not match; operations never filter", () => {
    expect(webhookMatches(match({ api_groups: ["apps"] }), "", "pods")).toBe(false);
    expect(webhookMatches(match({ scope: "Cluster" }), "", "pods")).toBe(false);
    expect(webhookMatches(match({ scope: "Namespaced" }), "", "pods")).toBe(true);
    expect(webhookMatches(match({ operations: ["DELETE"] }), "", "pods")).toBe(true);
  });
});

describe("webhookRows", () => {
  it("is always may-apply, never applies, and names the target and operations", () => {
    const rows = webhookRows([cfg("kyverno", [match({ operations: ["UPDATE", "CREATE"], has_namespace_selector: true })])], pod, "vwc");
    expect(rows).toHaveLength(1);
    expect(rows[0].applicability).toBe("may-apply");
    expect(rows[0].detail).toBe(
      "May apply to pods on CREATE, UPDATE. Has a namespace selector. If it is unreachable, requests are rejected (failure policy: Fail).",
    );
    expect(rows[0].open).toEqual({ kind: "vwc", namespace: "" });
  });
  it("a workload matches its own resource and pods, and the row says which", () => {
    const own = match({ api_groups: ["apps"], resources: ["deployments"] });
    expect(webhookRows([cfg("a", [own])], deploy, "mwc")[0].detail).toContain("May apply to deployments on CREATE.");
    const both = webhookRows([cfg("b", [own, match()])], deploy, "mwc")[0].detail;
    expect(both).toContain("May apply to deployments and pods on CREATE.");
    expect(webhookRows([cfg("c", [own])], pod, "mwc")).toEqual([]);
  });
  it("Ignore policy and the object selector", () => {
    const d = webhookRows([cfg("x", [match({ failure_policy: "Ignore", has_object_selector: true })])], pod, "mwc")[0].detail;
    expect(d).toContain("Has an object selector.");
    expect(d).toContain("requests are allowed (failure policy: Ignore).");
  });
  it("skips configs with no matching rule", () => {
    expect(webhookRows([cfg("n", [match({ resources: ["secrets"] })])], pod, "vwc")).toEqual([]);
  });
});

describe("quota and limit range rows", () => {
  it("show the name and the namespace sentence only, for the same namespace", () => {
    const q = [{ name: "compute", namespace: "shop" }, { name: "other", namespace: "x" }] as ResourceQuotaInfo[];
    const l = [{ name: "defaults", namespace: "shop" }] as LimitRangeInfo[];
    expect(quotaRows(q, pod)).toEqual([{
      group: "quota", name: "compute", applicability: "applies",
      detail: "Applies to every pod in namespace shop.", open: { kind: "rq", namespace: "shop" },
    }]);
    expect(limitRangeRows(l, pod)[0].detail).toBe("Applies to every pod in namespace shop.");
  });
});

describe("pdbRows", () => {
  const pdb = (over: Partial<PdbRow>): PdbRow => ({
    name: "p", namespace: "shop", min_available: "1", max_unavailable: "", desired_healthy: 1, current_healthy: 1,
    disruptions_allowed: 0, age: "1d", match_labels: { app: "web" }, has_match_expressions: false, ...over,
  });
  it("label subset applies", () => {
    expect(pdbRows([pdb({})], pod)[0]).toMatchObject({ applicability: "applies", detail: "Applies. Selects pods with app=web." });
  });
  it("a label that is not on the pod never matches", () => {
    expect(pdbRows([pdb({ match_labels: { app: "db" } })], pod)).toEqual([]);
    expect(pdbRows([pdb({ match_labels: { app: "db" }, has_match_expressions: true })], pod)).toEqual([]);
  });
  it("expressions make it may-apply", () => {
    expect(pdbRows([pdb({ has_match_expressions: true })], pod)[0]).toMatchObject({
      applicability: "may-apply", detail: `May apply. Uses label expressions, which ${PRODUCT_NAME} doesn't evaluate.`,
    });
  });
  it("an empty selector is may-apply, not applies", () => {
    expect(pdbRows([pdb({ match_labels: {} })], pod)[0].applicability).toBe("may-apply");
  });
  it("other namespaces are skipped", () => expect(pdbRows([pdb({ namespace: "x" })], pod)).toEqual([]));
});

describe("priorityRows", () => {
  const classes = [
    { name: "high", global_default: false }, { name: "standard", global_default: true },
  ] as PriorityClassInfo[];
  it("the class on the pod, wording per target", () => {
    expect(priorityRows(classes, { ...pod, priorityClass: "high" })[0].detail).toBe("Applies. Set on the pod.");
    expect(priorityRows(classes, { ...deploy, priorityClass: "high" })[0].detail).toBe("Applies. Set on the pod template.");
  });
  it("falls back to the global default, else nothing", () => {
    expect(priorityRows(classes, pod)[0]).toMatchObject({ name: "standard", detail: "Applies. Cluster default class." });
    expect(priorityRows([classes[0]], pod)).toEqual([]);
  });
});

describe("groupState and kinds", () => {
  it("each group has its own state; a 403 is denied", () => {
    expect(groupState(true, null, 0)).toBe("loading");
    expect(groupState(false, null, 0)).toBe("none");
    expect(groupState(false, "Failed to list x: forbidden: nope", 0)).toBe("denied");
    expect(groupState(false, "connection reset", 0)).toBe("error");
    expect(groupState(false, "boom", 2)).toBe("rows");
  });
  it("only the six kinds get a section", () => {
    for (const k of ["pods", "deploy", "sts", "ds", "rs", "jobs"]) expect(isConstraintKind(k)).toBe(true);
    for (const k of ["cron", "svc", "cm", "nodes"]) expect(isConstraintKind(k)).toBe(false);
  });
});
