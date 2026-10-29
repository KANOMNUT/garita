import { describe, expect, it } from "vitest";
import type { ArgoCdHistoryEntry, HelmRevision, JournalEntry, K8sEvent, RevisionInfo } from "../types/k8s";
import { groupByDay, mergeTimeline, parseTs, type MergeInput } from "./timeline";

const ev = (p: Partial<K8sEvent>): K8sEvent => ({ name: "e1", namespace: "shop", type_: "Normal", reason: "Scheduled", message: "ok", source: "s", object: "o", count: 1, age: "1m", first_seen: "", last_timestamp: "", ...p });
const rev = (revision: number, image: string, created_at: string): RevisionInfo => ({ revision, image, age: "", template: null, created_at });
const helm = (revision: number, updated: string, status = "deployed"): HelmRevision => ({ revision, updated, status, chart: "api-1.0.0", app_version: "1", description: "Upgrade complete" });
const argo = (id: number, iso: string): ArgoCdHistoryEntry => ({ id, revision: "3f9a2c1", deployed_at: "", deployed_at_iso: iso, message: "msg", author: "ann" });
const jr = (p: Partial<JournalEntry>): JournalEntry => ({ ts: "2026-10-16T12:05:00.000Z", context: "c", verb: "scale", kind: "deploy", namespace: "shop", name: "api", summary: "replicas=5", result: "ok", message: "", ...p });
const input = (p: Partial<MergeInput>): MergeInput => ({ kind: "deploy", events: [], revisions: [], helm: [], argocd: [], journal: [], ...p });

describe("parseTs", () => {
  it("parses RFC3339Nano with an offset, Z, and trims long fractions", () => {
    expect(parseTs("2026-10-16T12:00:00.123456789+07:00")).toBe(Date.parse("2026-10-16T05:00:00.123Z"));
    expect(parseTs("2026-10-16T12:00:00Z")).toBe(Date.parse("2026-10-16T12:00:00Z"));
    expect(parseTs("2026-10-16T12:00:00.5Z")).toBe(Date.parse("2026-10-16T12:00:00.500Z"));
  });
  it("maps empty and garbage to null", () => {
    expect(parseTs("")).toBeNull();
    expect(parseTs("   ")).toBeNull();
    expect(parseTs("garbage")).toBeNull();
  });
});

describe("mergeTimeline", () => {
  it("interleaves all five sources newest first, never comparing strings", () => {
    const merged = mergeTimeline(input({
      kind: "deploy",
      events: [ev({ name: "e1", last_timestamp: "2026-10-16T12:03:00Z" })],
      revisions: [rev(7, "api:2", "2026-10-16T12:04:00Z")],
      journal: [jr({ ts: "2026-10-16T12:05:00.000Z" })],
    }));
    expect(merged.map((m) => m.id)).toEqual(["journal:2026-10-16T12:05:00.000Z:scale:api", "rollout:7", "event:e1"]);
    const h = mergeTimeline(input({ kind: "helm", helm: [helm(2, "2026-10-16T19:00:00.123456789+07:00"), helm(3, "2026-10-16T12:30:00Z")], journal: [jr({ kind: "helmrelease", ts: "2026-10-16T12:10:00Z" })] }));
    // 19:00+07:00 is 12:00Z, so it is older than 12:10Z and 12:30Z although "19" sorts after "12" as text
    expect(h.map((m) => m.id)).toEqual(["helm:3", "journal:2026-10-16T12:10:00Z:scale:api", "helm:2"]);
    const a = mergeTimeline(input({ kind: "argocd", argocd: [argo(1, "2026-10-16T11:00:00Z")], journal: [jr({ kind: "argocd", ts: "2026-10-16T11:30:00Z" })] }));
    expect(a.map((m) => m.source)).toEqual(["journal", "argocd"]);
    expect(a[1].title).toBe("ArgoCD synced to 3f9a2c1");
    const syncedTitle = (revision: string) => mergeTimeline(input({ kind: "argocd", argocd: [{ ...argo(2, "2026-10-16T11:00:00Z"), revision }] }))[0].title;
    expect(syncedTitle("10.11.12")).toBe("ArgoCD synced to 10.11.12");
    expect(syncedTitle("")).toBe("ArgoCD synced");
  });

  it("uses only the first line of an ArgoCD commit message in the detail", () => {
    const detail = (message: string, author = "ann") =>
      mergeTimeline(input({ kind: "argocd", argocd: [{ ...argo(1, "2026-10-16T11:00:00Z"), message, author }] }))[0].detail;
    expect(detail("fix: bug\n\nBody line 1\nBody line 2")).toBe("fix: bug. by ann");
    expect(detail("fix: bug\r\nBody")).toBe("fix: bug. by ann");
    expect(detail("single line")).toBe("single line. by ann");
    expect(detail("", "")).toBe("");
  });

  it("puts unknown timestamps last in input order", () => {
    const m = mergeTimeline(input({
      kind: "sts",
      events: [ev({ name: "a", last_timestamp: "" }), ev({ name: "b", last_timestamp: "2026-10-16T12:00:00Z" }), ev({ name: "c", last_timestamp: "nope" })],
    }));
    expect(m.map((x) => x.id)).toEqual(["event:b", "event:a", "event:c"]);
  });

  it("filters journal rows by kind across the three spellings", () => {
    const rows = ["deploy", "Deployment", "deployment", "sts", "Pod", "namespace"].map((kind, i) => jr({ kind, name: `n${i}` }));
    expect(mergeTimeline(input({ kind: "deploy", journal: rows })).map((x) => x.id.split(":").pop())).toEqual(["n0", "n1", "n2"]);
    expect(mergeTimeline(input({ kind: "sts", journal: rows })).map((x) => x.id.split(":").pop())).toEqual(["n3"]);
  });

  it("rollout text per O3, with and without a previous image", () => {
    const m = mergeTimeline(input({ revisions: [rev(6, "shop/api:1.4.1", "2026-10-15T18:20:00Z"), rev(7, "shop/api:1.4.2", "2026-10-16T12:00:00Z")] }));
    expect(m[0]).toMatchObject({ title: "Revision 7", detail: "Image shop/api:1.4.2 (was shop/api:1.4.1). ReplicaSet created 2026-10-16 12:00 UTC" });
    expect(m[1]).toMatchObject({ title: "Revision 6", detail: "Image shop/api:1.4.1. ReplicaSet created 2026-10-15 18:20 UTC" });
    expect(mergeTimeline(input({ revisions: [rev(1, "x", "")] }))[0].detail).toBe("Image x");
  });

  it("severity: Warning event, failed Helm, failed journal", () => {
    expect(mergeTimeline(input({ events: [ev({ type_: "Warning" })] }))[0].severity).toBe("warning");
    expect(mergeTimeline(input({ kind: "helm", helm: [helm(1, "2026-10-16T12:00:00Z", "failed")] }))[0].severity).toBe("failed");
    expect(mergeTimeline(input({ journal: [jr({ result: "error", message: "boom" })] }))[0]).toMatchObject({ severity: "failed", detail: "Failed: boom" });
  });

  it("only the deploy kind reads rollouts", () => {
    expect(mergeTimeline(input({ kind: "sts", revisions: [rev(1, "x", "2026-10-16T12:00:00Z")] }))).toEqual([]);
  });
});

describe("groupByDay", () => {
  const e = (ts: string) => ({ id: ts, ts, source: "event" as const, title: "t", detail: "", severity: "info" as const });
  it("splits at midnight in the given offset", () => {
    const now = Date.parse("2026-10-16T00:30:00Z");
    const g = groupByDay([e("2026-10-16T00:10:00Z"), e("2026-10-15T23:50:00Z"), e("2026-10-14T10:00:00Z"), e("")], now, 0);
    expect(g.map((x) => x.heading)).toEqual(["Today", "Yesterday", "2026-10-14", "Time unknown"]);
    // the same instants at +07:00: 23:50Z on the 15th is 06:50 on the 16th, so it is Today
    const east = groupByDay([e("2026-10-16T00:10:00Z"), e("2026-10-15T23:50:00Z"), e("2026-10-15T10:00:00Z")], now, 420);
    expect(east.map((x) => [x.heading, x.entries.length])).toEqual([["Today", 2], ["Yesterday", 1]]);
  });
});
