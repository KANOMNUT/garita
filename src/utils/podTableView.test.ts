import { describe, expect, it } from "vitest";
import { barDenominator, displayedUsage, isNotReady, readyFraction, statusCounts, usageLabel, validPort } from "./podTableView";

describe("barDenominator", () => {
  it("uses the limit when there is one", () => {
    expect(barDenominator(500, 100, "usage")).toBe(500);
    expect(barDenominator(500, 100, "request")).toBe(500);
  });
  it("draws usage against twice the request when there is no limit", () => {
    expect(barDenominator(undefined, 100, "usage")).toBe(200);
    expect(barDenominator(null, 256, "usage")).toBe(512);
  });
  it("draws a request only against a limit", () => {
    expect(barDenominator(undefined, 100, "request")).toBeNull();
  });
  it("returns null, not an invented default, with no limit and no request", () => {
    expect(barDenominator(undefined, undefined, "usage")).toBeNull();
    expect(barDenominator(null, 0, "usage")).toBeNull();
    expect(barDenominator(0, 0, "usage")).toBeNull();
  });
  it("treats a zero limit as no limit", () => {
    expect(barDenominator(0, 50, "usage")).toBe(100);
  });
});

describe("displayedUsage and usageLabel", () => {
  it("shows the last sample when metrics exist", () => {
    const d = displayedUsage([10, 20, 30], 100);
    expect(d).toEqual({ value: 30, fromMetrics: true });
    expect(usageLabel(d, "m")).toBe("30m");
  });
  it("falls back to the request and says so", () => {
    const d = displayedUsage(undefined, 128);
    expect(d).toEqual({ value: 128, fromMetrics: false });
    expect(usageLabel(d, "Mi")).toBe("128Mi req");
  });
  it("treats an empty history as no metrics and a missing request as 0", () => {
    expect(displayedUsage([], undefined)).toEqual({ value: 0, fromMetrics: false });
  });
});

describe("isNotReady", () => {
  it("flags a Running pod with fewer ready containers than total", () => {
    expect(isNotReady("Running", "0/1")).toBe(true);
    expect(isNotReady("Running", "1/2")).toBe(true);
  });
  it("does not flag a ready pod, another phase, or a bad fraction", () => {
    expect(isNotReady("Running", "1/1")).toBe(false);
    expect(isNotReady("Running", "0/0")).toBe(false);
    expect(isNotReady("Pending", "0/1")).toBe(false);
    expect(isNotReady("Running", "—")).toBe(false);
    expect(isNotReady("Running", "")).toBe(false);
  });
  it("parses the fraction", () => {
    expect(readyFraction("2/3")).toEqual({ ready: 2, total: 3 });
    expect(readyFraction("x/y")).toBeNull();
  });
});

describe("statusCounts", () => {
  it("counts each status word", () => {
    expect(statusCounts([{ status: "Running" }, { status: "Running" }, { status: "Failed" }])).toEqual({ Running: 2, Failed: 1 });
    expect(statusCounts([])).toEqual({});
  });
});

describe("validPort", () => {
  it("accepts 1 to 65535", () => {
    for (const v of ["1", "80", "8080", "65535"]) expect(validPort(v)).toBe(true);
  });
  it("rejects empty, zero, out of range and non-digits", () => {
    for (const v of ["", "0", "65536", "-1", "1.5", "80a", " 80", "1e3"]) expect(validPort(v)).toBe(false);
  });
});
