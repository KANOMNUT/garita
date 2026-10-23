import { beforeEach, describe, expect, it } from "vitest";
import { agoLabel, ariaLabel, isYoung, plotSegments, readStoredRange, seriesStats, splitSegments, statsText, storeRange, toPercent, type Point } from "./metricChart";

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as Storage;
});

describe("remembered range", () => {
  it("defaults to 1h and rejects unknown values", () => {
    expect(readStoredRange()).toBe("1h");
    data.set("metrics-range", "9d");
    expect(readStoredRange()).toBe("1h");
    storeRange("24h");
    expect(readStoredRange()).toBe("24h");
    storeRange("now");
    expect(readStoredRange()).toBe("now");
  });
  it("survives blocked storage", () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(readStoredRange()).toBe("1h");
    expect(() => storeRange("6h")).not.toThrow();
  });
});

describe("splitSegments", () => {
  const p = (...ts: number[]): Point[] => ts.map((t) => [t, 1]);
  it("keeps a continuous series whole, splits only past 2 x step", () => {
    expect(splitSegments(p(0, 15, 30, 45), 15)).toHaveLength(1);
    expect(splitSegments(p(0, 30), 15)).toHaveLength(1); // exactly 2 x step is not a gap
    expect(splitSegments(p(0, 31), 15)).toHaveLength(2);
    expect(splitSegments(p(0, 15, 100, 115), 15).map((s) => s.length)).toEqual([2, 2]);
    expect(splitSegments([], 15)).toEqual([]);
  });
});

describe("stats and copy", () => {
  it("min max latest", () => {
    expect(seriesStats([])).toBeNull();
    const s = seriesStats([[0, 12.4], [1, 88.6], [2, 42]])!;
    expect(s).toEqual({ min: 12.4, max: 88.6, latest: 42 });
    expect(statsText(s, "m")).toBe("min 12m · max 89m · latest 42m");
    expect(statsText(s, "Mi")).toContain("42Mi");
    expect(ariaLabel("CPU", "api", "6h", s)).toBe("CPU, container api, last 6 hours: minimum 12 millicores, maximum 89 millicores, latest 42 millicores.");
    expect(ariaLabel("Memory", "api", "1h", s)).toContain("last hour");
    expect(agoLabel("6h")).toBe("6 h ago");
  });
  it("young container: first point more than two steps after the start", () => {
    expect(isYoung([[100, 1]], 0, 15)).toBe(true);
    expect(isYoung([[30, 1]], 0, 15)).toBe(false);
    expect(isYoung([], 0, 15)).toBe(false);
  });
});

describe("plotSegments", () => {
  it("starts y at 0 and maps x over the window", () => {
    expect(plotSegments([[[0, 0], [10, 50]]], 0, 10, 100, 48, 100)).toEqual(["0.0,48.0 100.0,24.0"]);
  });
  it("a lone point becomes a visible dash; yMax 0 does not divide by zero", () => {
    expect(plotSegments([[[5, 0]]], 0, 10, 100, 48, 0)).toEqual(["50.0,48.0 51.0,48.0"]);
  });
});

describe("toPercent", () => {
  it("clamps at 100 and needs allocatable", () => {
    expect(toPercent([[0, 500], [1, 3000]], 2000)).toEqual([25, 100]);
    expect(toPercent([[0, 1]], null)).toBeNull();
    expect(toPercent([[0, 1]], 0)).toBeNull();
  });
});
