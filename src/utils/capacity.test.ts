import { describe, expect, it } from "vitest";
import type { NodeCapacity } from "../types/k8s";
import {
  capacityLevel, capacityRow, filterRows, fmtMem, reqLine, share, sortRows, totals, totalsLine,
} from "./capacity";

const node = (over: Partial<NodeCapacity> = {}): NodeCapacity => ({
  node: "n1", cpu_allocatable_m: 4000, mem_allocatable_mi: 16384, pods_allocatable: 110,
  cpu_requests_m: 2400, cpu_limits_m: 5680, mem_requests_mi: 8192, mem_limits_mi: 26214,
  pods: 42, pods_without_limits: 4, cpu_usage_m: 1850, mem_usage_mi: null, ...over,
});

describe("capacityLevel (65 / 85, X7)", () => {
  it("switches at the boundaries", () => {
    expect([0, 64, 65, 84, 85, 300].map(capacityLevel)).toEqual(["low", "low", "mid", "mid", "high", "high"]);
  });
});

describe("share and formatting", () => {
  it("rounds, never clamps, and is null without a denominator", () => {
    expect(share(2400, 4000)).toBe(60);
    expect(share(12400, 4000)).toBe(310);
    expect(share(5, null)).toBeNull();
    expect(share(5, 0)).toBeNull();
  });
  it("memory switches to Gi at 1024 Mi", () => {
    expect(fmtMem(512)).toBe("512 Mi");
    expect(fmtMem(11468)).toBe("11.2 Gi");
    expect(fmtMem(1024)).toBe("1 Gi");
  });
});

describe("capacityRow", () => {
  it("computes shares against allocatable, with limits over 100 left as is", () => {
    const r = capacityRow(node());
    expect(r.cpu).toMatchObject({ reqPct: 60, limPct: 142, usagePct: 46, level: "low" });
    expect(r.mem).toMatchObject({ reqPct: 50, limPct: 160, usagePct: null });
  });
  it("high at 85%", () => {
    expect(capacityRow(node({ cpu_requests_m: 3400 })).cpu?.level).toBe("high");
  });
  it("unreadable allocatable gives a null cell (no bar, no percentage)", () => {
    expect(capacityRow(node({ cpu_allocatable_m: null })).cpu).toBeNull();
    expect(capacityRow(node({ mem_allocatable_mi: 0 })).mem).toBeNull();
  });
});

describe("totals", () => {
  it("sums only nodes with known allocatable and counts the excluded ones", () => {
    const rows = [
      capacityRow(node({ node: "a" })),
      capacityRow(node({ node: "b", cpu_allocatable_m: null, cpu_requests_m: 999 })),
    ];
    const t = totals(rows);
    expect(t).toMatchObject({ nodes: 2, withoutAllocatable: 1, cpuRequestsM: 2400, cpuAllocatableM: 4000, cpuPct: 60 });
    expect(totalsLine(t)).toBe("2 nodes (1 without allocatable data) · CPU requests 2.4 of 4 cores (60%) · Memory requests 16 Gi of 32 Gi (50%)");
  });
  it("no allocatable anywhere drops the sums", () => {
    expect(totalsLine(totals([capacityRow(node({ cpu_allocatable_m: null, mem_allocatable_mi: null }))])))
      .toBe("1 node (1 without allocatable data)");
  });
});

describe("sortRows and filterRows", () => {
  const rows = [
    capacityRow(node({ node: "a", cpu_requests_m: 1000 })),
    capacityRow(node({ node: "b", cpu_requests_m: 3000 })),
    capacityRow(node({ node: "c", cpu_allocatable_m: null })),
  ];
  it("CPU share descending, unknown last in both directions", () => {
    expect(sortRows(rows, "cpu", false).map((r) => r.node)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "cpu", true).map((r) => r.node)).toEqual(["a", "b", "c"]);
  });
  it("node name and numeric columns sort", () => {
    expect(sortRows(rows, "node", false).map((r) => r.node)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, "pods", true).map((r) => r.node)).toEqual(["a", "b", "c"]);
  });
  it("filters by node name, case-insensitively", () => {
    expect(filterRows(rows, " B ").map((r) => r.node)).toEqual(["b"]);
    expect(filterRows(rows, "")).toHaveLength(3);
  });
});

describe("reqLine", () => {
  it("prints shares, a dash for unreadable allocatable, and flags High", () => {
    expect(reqLine(capacityRow(node({ cpu_requests_m: 3800 })))).toEqual({ text: "cpu 95% · mem 50%", high: true });
    expect(reqLine(capacityRow(node({ mem_allocatable_mi: null })))).toEqual({ text: "cpu 60% · mem —", high: false });
  });
});
