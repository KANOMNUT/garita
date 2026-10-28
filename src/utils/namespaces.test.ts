import { describe, expect, it } from "vitest";
import {
  NAMESPACE_DELETE_RBAC_REASON, PROTECTED_NAMESPACES, PROTECTED_NAMESPACE_REASON, TERMINATING_NAMESPACE_REASON,
  chipLabels, deletingFor, isTerminating, namespaceDeleteReason, namespaceNames, namespaceRows,
} from "./namespaces";
import { READ_ONLY_REASON } from "./guardrails";
import type { NamespaceRow } from "../types/k8s";

const row = (over: Partial<NamespaceRow> = {}): NamespaceRow => ({
  name: "payments", phase: "Active", age: "5d", labels: {}, deletion_timestamp: null, conditions: [], finalizers: ["kubernetes"],
  ...over,
});
const OPEN = { readOnly: false, canDelete: true };

describe("PROTECTED_NAMESPACES", () => {
  it("is exactly the four built-in namespaces", () => {
    expect([...PROTECTED_NAMESPACES].sort()).toEqual(["default", "kube-node-lease", "kube-public", "kube-system"]);
  });
  it("names the product in the reason and says it can break the cluster", () => {
    expect(PROTECTED_NAMESPACE_REASON).toBe("Built-in namespace. Deleting it can break the cluster, so Garita doesn't offer it.");
  });
});

describe("isTerminating", () => {
  it("is true for the Terminating phase", () => {
    expect(isTerminating({ phase: "Terminating", deletion_timestamp: null })).toBe(true);
  });
  it("is true for a deletion time alone, whatever the phase says", () => {
    expect(isTerminating({ phase: "Active", deletion_timestamp: "2026-10-28T10:00:00+00:00" })).toBe(true);
    expect(isTerminating({ phase: "", deletion_timestamp: "2026-10-28T10:00:00+00:00" })).toBe(true);
  });
  it("is false for Active, an empty phase and an unknown phase with no deletion time", () => {
    expect(isTerminating({ phase: "Active", deletion_timestamp: null })).toBe(false);
    expect(isTerminating({ phase: "", deletion_timestamp: null })).toBe(false);
    expect(isTerminating({ phase: "Weird", deletion_timestamp: null })).toBe(false);
  });
});

describe("namespaceDeleteReason", () => {
  it("is undefined for an ordinary Active namespace", () => {
    expect(namespaceDeleteReason(row(), OPEN)).toBeUndefined();
  });
  it("gives the protected reason for each of the four built-ins", () => {
    for (const name of PROTECTED_NAMESPACES) {
      expect(namespaceDeleteReason(row({ name }), OPEN)).toBe(PROTECTED_NAMESPACE_REASON);
    }
  });
  it("gives the Terminating reason for a namespace that is being deleted", () => {
    expect(namespaceDeleteReason(row({ phase: "Terminating" }), OPEN)).toBe(TERMINATING_NAMESPACE_REASON);
    expect(namespaceDeleteReason(row({ deletion_timestamp: "2026-10-28T10:00:00+00:00" }), OPEN)).toBe(TERMINATING_NAMESPACE_REASON);
  });
  it("gives the RBAC reason only for an explicit denial (canDelete false)", () => {
    expect(namespaceDeleteReason(row(), { readOnly: false, canDelete: false })).toBe(NAMESPACE_DELETE_RBAC_REASON);
  });
  it("read-only wins over everything", () => {
    const all = row({ name: "default", phase: "Terminating" });
    expect(namespaceDeleteReason(all, { readOnly: true, canDelete: false })).toBe(READ_ONLY_REASON);
    expect(namespaceDeleteReason(row(), { readOnly: true, canDelete: true })).toBe(READ_ONLY_REASON);
  });
  it("RBAC wins over protected, protected wins over Terminating", () => {
    const protectedAndTerminating = row({ name: "kube-system", phase: "Terminating" });
    expect(namespaceDeleteReason(protectedAndTerminating, { readOnly: false, canDelete: false })).toBe(NAMESPACE_DELETE_RBAC_REASON);
    expect(namespaceDeleteReason(protectedAndTerminating, OPEN)).toBe(PROTECTED_NAMESPACE_REASON);
  });
});

describe("namespaceRows", () => {
  const names = ["default", "kube-system", "payments", "payments-old"];
  it("puts all first only while the trimmed query is empty", () => {
    expect(namespaceRows(names, "all", "")).toEqual(["all", ...names]);
    expect(namespaceRows(names, "all", "   ")).toEqual(["all", ...names]);
    expect(namespaceRows(names, "all", "pay")).toEqual(["payments", "payments-old"]);
  });
  it("lists a selected name that is missing from the names, right after all", () => {
    expect(namespaceRows(names, "gone", "")).toEqual(["all", "gone", ...names]);
  });
  it("filters a selected-but-missing name by the query", () => {
    expect(namespaceRows(names, "gone", "pay")).toEqual(["payments", "payments-old"]);
    expect(namespaceRows(names, "gone", "gon")).toEqual(["gone"]);
  });
  it("does not duplicate a selected name that is in the list or the all row", () => {
    expect(namespaceRows(names, "payments", "")).toEqual(["all", ...names]);
    expect(namespaceRows(names, "all", "")).toEqual(["all", ...names]);
  });
  it("matches case-insensitively on the trimmed query", () => {
    expect(namespaceRows(names, "all", "  PAY  ")).toEqual(["payments", "payments-old"]);
    expect(namespaceRows(["Team-A", "team-b"], "all", "TEAM")).toEqual(["Team-A", "team-b"]);
  });
  it("keeps the given order and drops repeated names", () => {
    expect(namespaceRows(["b", "a", "b"], "all", "")).toEqual(["all", "b", "a"]);
  });
  it("handles an empty list and no match", () => {
    expect(namespaceRows([], "all", "")).toEqual(["all"]);
    expect(namespaceRows([], "x", "")).toEqual(["all", "x"]);
    expect(namespaceRows(names, "all", "zzz")).toEqual([]);
  });
});

describe("namespaceNames", () => {
  it("returns the names in row order", () => {
    expect(namespaceNames([row({ name: "a" }), row({ name: "b" })])).toEqual(["a", "b"]);
    expect(namespaceNames([])).toEqual([]);
  });
});

describe("chipLabels", () => {
  it("drops only kubernetes.io/metadata.name and keeps the key order", () => {
    const labels = { "app.kubernetes.io/name": "x", "kubernetes.io/metadata.name": "payments", team: "payments" };
    expect(chipLabels(labels)).toEqual([["app.kubernetes.io/name", "x"], ["team", "payments"]]);
  });
  it("keeps a label that merely contains the dropped key", () => {
    expect(chipLabels({ "x.kubernetes.io/metadata.name": "1" })).toEqual([["x.kubernetes.io/metadata.name", "1"]]);
  });
  it("is empty for no labels or only the metadata-name label", () => {
    expect(chipLabels({})).toEqual([]);
    expect(chipLabels({ "kubernetes.io/metadata.name": "payments" })).toEqual([]);
  });
});

describe("deletingFor", () => {
  const T = Date.parse("2026-10-28T10:00:00+00:00");
  const iso = "2026-10-28T10:00:00+00:00";
  it("is null for null and for a time that does not parse", () => {
    expect(deletingFor(null, T)).toBeNull();
    expect(deletingFor("not a time", T)).toBeNull();
    expect(deletingFor("", T)).toBeNull();
  });
  it("truncates to the largest unit at each boundary", () => {
    expect(deletingFor(iso, T)).toBe("0s");
    expect(deletingFor(iso, T + 45_000)).toBe("45s");
    expect(deletingFor(iso, T + 59_999)).toBe("59s");
    expect(deletingFor(iso, T + 60_000)).toBe("1m");
    expect(deletingFor(iso, T + 3 * 60_000 + 40_000)).toBe("3m");
    expect(deletingFor(iso, T + 3_599_000)).toBe("59m");
    expect(deletingFor(iso, T + 3_600_000)).toBe("1h");
    expect(deletingFor(iso, T + 2 * 3_600_000 + 1_800_000)).toBe("2h");
    expect(deletingFor(iso, T + 86_399_000)).toBe("23h");
    expect(deletingFor(iso, T + 86_400_000)).toBe("1d");
    expect(deletingFor(iso, T + 5 * 86_400_000)).toBe("5d");
  });
  it("reads a time in the future as 0s", () => {
    expect(deletingFor(iso, T - 10_000)).toBe("0s");
  });
  it("parses the +00:00 form the backend sends", () => {
    expect(deletingFor("2026-10-28T09:57:00+00:00", T)).toBe("3m");
  });
});
