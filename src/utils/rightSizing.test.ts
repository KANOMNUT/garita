import { describe, expect, it } from "vitest";
import {
  collectingText, containerKey, hintText, newUsageHistory, podKey, pushSample, recordUsage, RIGHT_SIZING,
  SAMPLE_CAP, sizingHints, p95Hints, withSessionFallback, P95_MIN_POINTS, percentile,
} from "./rightSizing";

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

describe("sample buffers", () => {
  it("caps the ring at 20", () => {
    const m = new Map<string, number[]>();
    for (let i = 0; i < 30; i++) pushSample(m, "k", i);
    expect(m.get("k")).toHaveLength(SAMPLE_CAP);
    expect(m.get("k")?.[0]).toBe(10);
  });
  it("keys pods by namespace/name so same-named pods in two namespaces never collide", () => {
    const h = newUsageHistory();
    recordUsage(h, [
      { name: "redis-0", namespace: "a", cpu_m: 1, mem_mi: 10, containers: [{ name: "redis", cpu_m: 1, mem_mi: 10 }] },
      { name: "redis-0", namespace: "b", cpu_m: 5, mem_mi: 50, containers: [{ name: "redis", cpu_m: 5, mem_mi: 50 }] },
    ]);
    expect(h.podCpu.get(podKey("a", "redis-0"))).toEqual([1]);
    expect(h.podCpu.get(podKey("b", "redis-0"))).toEqual([5]);
    expect(h.ctrMem.get(containerKey("b", "redis-0", "redis"))).toEqual([50]);
  });
  it("a pod without per-container usage still records its totals", () => {
    const h = newUsageHistory();
    recordUsage(h, [{ name: "p", namespace: "a", cpu_m: 2, mem_mi: 3 }]);
    expect(h.podMem.get("a/p")).toEqual([3]);
    expect(h.ctrCpu.size).toBe(0);
  });
});

describe("sizingHints", () => {
  const own = { cpu_request_m: 100, cpu_limit_m: 500, mem_request_mi: 256, mem_limit_mi: 512 };

  it("is unavailable with no samples at all", () => expect(sizingHints(own, undefined, undefined)).toEqual({ state: "unavailable" }));
  it("collects below the minimum, however bad the usage", () => {
    expect(sizingHints(own, flat(9, 500), flat(9, 512))).toEqual({ state: "collecting", samples: 9 });
    expect(collectingText(4)).toBe("Collecting samples (4 of 10) before a hint can be shown.");
  });
  it("memory near the limit at the 90% boundary", () => {
    const r = sizingHints(own, flat(10, 200), [...flat(9, 300), 461]);
    expect(r.state === "ready" && r.hints).toEqual([
      { resource: "memory", kind: "undersized", observedMax: 461, reference: 512, samples: 10 },
    ]);
    const below = sizingHints(own, flat(10, 200), [...flat(9, 300), 460]);
    expect(below.state === "ready" && below.hints).toEqual([]);
  });
  it("cpu near the limit", () => {
    const r = sizingHints(own, flat(12, 450), flat(12, 300));
    expect(r.state === "ready" && r.hints.map((h) => `${h.resource}:${h.kind}`)).toEqual(["cpu:undersized"]);
  });
  it("oversized needs every sample under 25% of the request", () => {
    const r = sizingHints(own, flat(10, 18), flat(10, 300));
    expect(r.state === "ready" && r.hints).toEqual([
      { resource: "cpu", kind: "oversized", observedMax: 18, reference: 100, samples: 10 },
    ]);
    const spike = sizingHints(own, [...flat(9, 18), 30], flat(10, 300));
    expect(spike.state === "ready" && spike.hints).toEqual([]);
  });
  it("uses only the container's own request and limit: none means no hint of that kind", () => {
    const r = sizingHints({}, flat(10, 1), flat(10, 99999));
    expect(r).toEqual({ state: "ready", hints: [] });
    const noLimit = sizingHints({ mem_request_mi: 256 }, flat(10, 100), flat(10, 255));
    expect(noLimit.state === "ready" && noLimit.hints).toEqual([]);
  });
  it("a zero request or limit counts as unset", () => {
    expect(sizingHints({ cpu_request_m: 0, cpu_limit_m: 0 }, flat(10, 0), flat(10, 1))).toEqual({ state: "ready", hints: [] });
  });
  it("threshold constant is the single source", () => {
    expect(RIGHT_SIZING.minSamples).toBe(10);
  });
});

describe("hintText", () => {
  it("says samples, never minutes, and never suggests a value", () => {
    const texts = [
      hintText({ resource: "memory", kind: "undersized", observedMax: 486, reference: 512, samples: 20 }),
      hintText({ resource: "cpu", kind: "undersized", observedMax: 465, reference: 500, samples: 20 }),
      hintText({ resource: "cpu", kind: "oversized", observedMax: 18, reference: 100, samples: 20 }),
      hintText({ resource: "memory", kind: "oversized", observedMax: 40, reference: 256, samples: 20 }),
    ];
    expect(texts[0]).toBe("Memory reached 95% of its limit (486Mi of 512Mi) in the last 20 samples.");
    expect(texts[1]).toBe("CPU reached 93% of its limit (465m of 500m) in the last 20 samples. It may be throttled.");
    expect(texts[2]).toBe("CPU stayed under 25% of its request (peak 18m, request 100m) across the last 20 samples. The request may be larger than needed.");
    expect(texts[3]).toContain("(peak 40Mi, request 256Mi)");
    for (const t of texts) expect(t).not.toMatch(/minute|recommend|right.?size|optimal|should be|reduce to/i);
  });
});

describe("p95Hints (24 h percentile, v2.3.0)", () => {
  const series = (label: string, n: number, v: number | ((i: number) => number)) => ({
    template: "pod-cpu" as const, unit: "millicores" as const, truncated: false,
    series: [{ label, points: Array.from({ length: n }, (_, i): [number, number] => [i * 300, typeof v === "function" ? v(i) : v]) }],
  });
  const c = { cpu_request_m: 100, cpu_limit_m: 200, mem_request_mi: 100, mem_limit_mi: 200 };
  const hot = (n: number) => ({ data: series("api", n, 195) });

  it("percentile is nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95);
    expect(percentile([7], 0.95)).toBe(7);
  });
  it("coverage: 215 points is the session path, 216 is a p95", () => {
    expect(p95Hints(c, "api", hot(215), undefined)).toBeNull();
    expect(p95Hints(c, "api", hot(P95_MIN_POINTS - 1), undefined)).toBeNull();
    expect(p95Hints(c, "api", hot(216), undefined)?.hints.length).toBe(1);
  });
  it("undersized for both kinds, with the p95 sentences", () => {
    const cpu = p95Hints(c, "api", hot(216), undefined)!.hints[0];
    expect(cpu).toMatchObject({ resource: "cpu", kind: "undersized", p95: true });
    expect(hintText(cpu)).toBe("CPU's 95th percentile reached 98% of its limit (195m of 200m). It may be throttled.");
    const mem = p95Hints(c, "api", undefined, hot(216))!.hints[0];
    expect(hintText(mem)).toBe("Memory's 95th percentile reached 98% of its limit (195Mi of 200Mi).");
  });
  it("oversized for both kinds", () => {
    const low = { data: series("api", 288, 10) };
    const hs = p95Hints(c, "api", low, low)!.hints;
    expect(hs.map((h) => `${h.resource}-${h.kind}`)).toEqual(["memory-oversized", "cpu-oversized"]);
    expect(hintText(hs[1])).toBe("CPU's 95th percentile stayed under 25% of its request (10m, request 100m). The request may be larger than needed.");
  });
  it("a p95 below the thresholds is usable and silent", () => {
    expect(p95Hints(c, "api", { data: series("api", 288, 100) }, undefined)?.hints).toEqual([]);
  });
  it("own request and limit only: no pod fallback, no hint without them", () => {
    expect(p95Hints({}, "api", hot(216), hot(216))?.hints).toEqual([]);
  });
  it("the 95th percentile hides a short spike", () => {
    const spiky = { data: series("api", 288, (i) => (i < 5 ? 1000 : 50)) };
    expect(p95Hints(c, "api", spiky, undefined)?.hints).toEqual([]);
  });
  it("placeholder data, a missing container or no data is the session path", () => {
    expect(p95Hints(c, "api", { ...hot(288), isPlaceholderData: true }, undefined)).toBeNull();
    expect(p95Hints(c, "other", hot(288), undefined)).toBeNull();
    expect(p95Hints(c, "api", undefined, undefined)).toBeNull();
    expect(p95Hints(c, "api", {}, {})).toBeNull();
  });
  it("one resource covered: the other keeps its ready session hint", () => {
    const p = p95Hints(c, "api", hot(215), { data: series("api", 216, 195) })!;
    expect(p.covered).toEqual(["memory"]);
    const ring = Array.from({ length: 10 }, () => 195);
    const hs = withSessionFallback(p, c, ring, ring);
    expect(hs.map((h) => `${h.resource}-${h.kind}-${!!h.p95}`)).toEqual(["memory-undersized-true", "cpu-undersized-false"]);
    expect(hintText(hs[1])).toContain("in the last 10 samples");
    // session ring not ready: no extra row
    expect(withSessionFallback(p, c, ring.slice(0, 5), ring.slice(0, 5))).toEqual(p.hints);
  });
  it("session path is unchanged", () => {
    const flat = Array.from({ length: 10 }, () => 195);
    const r = sizingHints(c, flat, flat);
    expect(r.state).toBe("ready");
    if (r.state === "ready") expect(hintText(r.hints[0])).toContain("in the last 10 samples");
  });
});
