import { describe, expect, it } from "vitest";
import {
  countsSentence, defaultForceSelection, drainOutcome, forceDeletable, isDeletePodNotFound, outcomeTitle, runCounts,
  sortRows, type DrainRow, type DrainRowStatus,
} from "./drain";

const row = (name: string, status: DrainRowStatus): DrainRow => ({
  key: `ns/${name}`, namespace: "ns", name, owner: null, unmanaged: false, pdbs: [], status, message: "",
});
const NO_SKIP = { daemonset: 0, mirror: 0 };

describe("force-deleted rows", () => {
  const rows = [row("a", "evicted"), row("b", "force-deleted"), row("c", "force-deleted")];
  it("are counted on their own, never as evicted", () => {
    const c = runCounts(rows);
    expect(c.evicted).toBe(1);
    expect(c.forced).toBe(2);
    expect(c.done).toBe(3);
  });
  it("do not block a complete drain", () => {
    expect(drainOutcome({ rows, stopped: false, cordonFailed: false })).toBe("complete");
  });
  it("a still-blocked or deleting row keeps it incomplete", () => {
    expect(drainOutcome({ rows: [...rows, row("d", "blocked")], stopped: false, cordonFailed: false })).toBe("incomplete");
    expect(drainOutcome({ rows: [...rows, row("d", "deleting")], stopped: false, cordonFailed: false })).toBe("incomplete");
  });
  it("title the run and show the forced count in the sentence", () => {
    expect(outcomeTitle("complete", "n1", false, 2)).toBe("Node drained, 2 pods force-deleted");
    expect(outcomeTitle("complete", "n1", false, 1)).toBe("Node drained, 1 pod force-deleted");
    expect(outcomeTitle("complete", "n1", false)).toBe("Node drained");
    expect(countsSentence(runCounts(rows), NO_SKIP)).toBe("1 evicted · 2 force-deleted");
  });
  it("deleting sorts with in-flight rows", () => {
    expect(sortRows([row("a", "evicted"), row("b", "deleting"), row("c", "blocked")]).map((r) => r.name)).toEqual(["c", "b", "a"]);
  });
});

describe("force-delete scope", () => {
  const rows = [row("a", "blocked"), row("b", "failed"), row("c", "waiting"), row("d", "blocked"), row("e", "blocked")];
  it("targets only blocked rows", () => {
    expect(forceDeletable(rows).map((r) => r.name)).toEqual(["a", "d", "e"]);
  });
  it("pre-checks blocked pods up to the bulk limit", () => {
    expect([...defaultForceSelection(rows, null)]).toEqual(["ns/a", "ns/d", "ns/e"]);
    expect([...defaultForceSelection(rows, 2)]).toEqual(["ns/a", "ns/d"]);
  });
});

describe("isDeletePodNotFound", () => {
  it("matches a delete_pod 404 from the backend", () => {
    expect(isDeletePodNotFound('Failed to delete pod: ApiError: pods "web-1" not found: NotFound (ErrorResponse { status: "Failure", reason: "NotFound", code: 404 })')).toBe(true);
    expect(isDeletePodNotFound("Failed to delete pod: ApiError: x (ErrorResponse { code: 404 })")).toBe(true);
  });
  it("does not match other failures", () => {
    expect(isDeletePodNotFound("Failed to delete pod: ApiError: Forbidden (ErrorResponse { code: 403 })")).toBe(false);
    expect(isDeletePodNotFound("Failed to connect: context not found: NotFound")).toBe(false);
  });
});
