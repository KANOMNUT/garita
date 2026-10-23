import type { Container, MetricRange, PodUsage } from "../types/k8s";

/** Thresholds for right-sizing hints (T4-8). One place, so a change is one diff. */
export const RIGHT_SIZING = {
  minSamples: 10,
  memUndersizedOfLimit: 0.9,   // max mem usage >= 90% of the container's own limit
  cpuThrottleOfLimit: 0.9,     // max cpu usage >= 90% of the container's own limit
  oversizedOfRequest: 0.25,    // max usage < 25% of the container's own request, every sample
} as const;

export const SAMPLE_CAP = 20;
export const SAMPLES_TOOLTIP = "Samples are taken by this app while it is open.";
export const HINT_TAIL = "Based on current usage only.";

// ─── Sample buffers ─────────────────────────────────────────────────────────────────────────────
// Keyed by namespace so two pods with the same name in different namespaces never share a ring
// (the namespace picker "all" lists both).

export const podKey = (ns: string, pod: string): string => `${ns}/${pod}`;
export const containerKey = (ns: string, pod: string, container: string): string => `${ns}/${pod}/${container}`;

export function pushSample(buf: Map<string, number[]>, key: string, value: number): void {
  buf.set(key, [...(buf.get(key) ?? []), value].slice(-SAMPLE_CAP));
}

export interface UsageHistory {
  podCpu: Map<string, number[]>;
  podMem: Map<string, number[]>;
  ctrCpu: Map<string, number[]>;
  ctrMem: Map<string, number[]>;
}

export const newUsageHistory = (): UsageHistory =>
  ({ podCpu: new Map(), podMem: new Map(), ctrCpu: new Map(), ctrMem: new Map() });

/** One `list_pod_metrics` result becomes one sample per pod and per container. */
export function recordUsage(h: UsageHistory, usage: PodUsage[]): void {
  for (const p of usage) {
    pushSample(h.podCpu, podKey(p.namespace, p.name), p.cpu_m);
    pushSample(h.podMem, podKey(p.namespace, p.name), p.mem_mi);
    for (const c of p.containers ?? []) {
      pushSample(h.ctrCpu, containerKey(p.namespace, p.name, c.name), c.cpu_m);
      pushSample(h.ctrMem, containerKey(p.namespace, p.name, c.name), c.mem_mi);
    }
  }
}

// ─── Hints ──────────────────────────────────────────────────────────────────────────────────────

export interface SizingHint {
  resource: "cpu" | "memory";
  kind: "undersized" | "oversized";
  observedMax: number;
  reference: number;
  samples: number;
  /** v2.3.0: the value is a 24 h 95th percentile from Prometheus, not a session peak. */
  p95?: true;
}

export type SizingResult =
  | { state: "unavailable" }
  | { state: "collecting"; samples: number }
  | { state: "ready"; hints: SizingHint[] };

type Own = Pick<Container, "cpu_request_m" | "mem_request_mi" | "cpu_limit_m" | "mem_limit_mi">;

const positive = (n: number | undefined): n is number => n !== undefined && n > 0;

function hintsFor(
  resource: SizingHint["resource"], samples: number[], request: number | undefined, limit: number | undefined,
  nearLimit: number,
): SizingHint[] {
  const max = Math.max(...samples);
  const out: SizingHint[] = [];
  if (positive(limit) && max >= nearLimit * limit) out.push({ resource, kind: "undersized", observedMax: max, reference: limit, samples: samples.length });
  if (positive(request) && max < RIGHT_SIZING.oversizedOfRequest * request) out.push({ resource, kind: "oversized", observedMax: max, reference: request, samples: samples.length });
  return out;
}

/**
 * Hints for ONE container from its own request and limit only (never the pod fallback, never
 * the 2x mark: UX H6). No value is ever suggested. Below `minSamples` there is no hint.
 */
export function sizingHints(c: Own, cpu: number[] | undefined, mem: number[] | undefined): SizingResult {
  if (!cpu?.length && !mem?.length) return { state: "unavailable" };
  const n = Math.min(cpu?.length ?? 0, mem?.length ?? 0);
  if (n < RIGHT_SIZING.minSamples) return { state: "collecting", samples: n };
  return {
    state: "ready",
    hints: [
      ...hintsFor("memory", mem!, c.mem_request_mi, c.mem_limit_mi, RIGHT_SIZING.memUndersizedOfLimit),
      ...hintsFor("cpu", cpu!, c.cpu_request_m, c.cpu_limit_m, RIGHT_SIZING.cpuThrottleOfLimit),
    ],
  };
}

/** The sentence for one hint, without the "Hint" label or the tail. "Last N samples", never minutes. */
export function hintText(h: SizingHint): string {
  const unit = h.resource === "cpu" ? "m" : "Mi";
  const name = h.resource === "cpu" ? "CPU" : "Memory";
  if (h.p95) {
    const v = Math.round(h.observedMax);
    if (h.kind === "undersized") {
      return `${name}'s 95th percentile reached ${Math.round((h.observedMax / h.reference) * 100)}% of its limit (${v}${unit} of ${h.reference}${unit}).${h.resource === "cpu" ? " It may be throttled." : ""}`;
    }
    return `${name}'s 95th percentile stayed under ${Math.round(RIGHT_SIZING.oversizedOfRequest * 100)}% of its request (${v}${unit}, request ${h.reference}${unit}). The request may be larger than needed.`;
  }
  if (h.kind === "undersized") {
    const pct = Math.round((h.observedMax / h.reference) * 100);
    return `${name} reached ${pct}% of its limit (${h.observedMax}${unit} of ${h.reference}${unit}) in the last ${h.samples} samples.${h.resource === "cpu" ? " It may be throttled." : ""}`;
  }
  const pct = Math.round(RIGHT_SIZING.oversizedOfRequest * 100);
  return `${name} stayed under ${pct}% of its request (peak ${h.observedMax}${unit}, request ${h.reference}${unit}) across the last ${h.samples} samples. The request may be larger than needed.`;
}

// ─── 24 h 95th percentile (v2.3.0 #13+) ─────────────────────────────────────────────────────────

/** 75 % of the 288 five-minute points in 24 h: fewer is "not over 24 hours". */
export const P95_MIN_POINTS = 216;
export const P95_TAIL = "Based on the 95th percentile over 24 hours.";

/** Nearest rank: the smallest value with at least q of the data at or below it. */
export function percentile(values: readonly number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length, Math.max(1, Math.ceil(q * s.length))) - 1];
}

/** The slice of a useMetricRange result this needs. */
export interface RangeInput { data?: MetricRange; isPlaceholderData?: boolean }

/** `covered`: the resources that had a usable p95; the other one falls back to its session hint. */
export interface P95Result { hints: SizingHint[]; covered: SizingHint["resource"][] }

/**
 * Hints from the container's 24 h pod-cpu / pod-mem series, own request and limit only (never the pod
 * fallback). null = no usable p95 (no data, placeholder from another object, or under P95_MIN_POINTS):
 * the caller shows the session hint. [] = usable p95 and nothing to say.
 */
export function p95Hints(c: Own, container: string, cpu: RangeInput | undefined, mem: RangeInput | undefined): P95Result | null {
  const pts = (q: RangeInput | undefined) => {
    if (!q || q.isPlaceholderData) return null;
    const p = q.data?.series.find((s) => s.label === container)?.points;
    return p && p.length >= P95_MIN_POINTS ? p.map(([, v]) => v) : null;
  };
  const m = pts(mem), u = pts(cpu);
  if (!m && !u) return null;
  const tag = (hs: SizingHint[]) => hs.map((h): SizingHint => ({ ...h, p95: true }));
  const hints = [
    ...(m ? tag(hintsFor("memory", [percentile(m, 0.95)], c.mem_request_mi, c.mem_limit_mi, RIGHT_SIZING.memUndersizedOfLimit)) : []),
    ...(u ? tag(hintsFor("cpu", [percentile(u, 0.95)], c.cpu_request_m, c.cpu_limit_m, RIGHT_SIZING.cpuThrottleOfLimit)) : []),
  ];
  return { hints, covered: [...(m ? ["memory" as const] : []), ...(u ? ["cpu" as const] : [])] };
}

/** p95 hints plus the session hints of the resource p95 did not cover (only when the session result is ready; never a "Collecting" line). */
export function withSessionFallback(p: P95Result, c: Own, cpu: number[] | undefined, mem: number[] | undefined): SizingHint[] {
  const s = p.covered.length < 2 ? sizingHints(c, cpu, mem) : null;
  return [...p.hints, ...(s?.state === "ready" ? s.hints.filter((h) => !p.covered.includes(h.resource)) : [])];
}

export const collectingText = (n: number): string => `Collecting samples (${n} of ${RIGHT_SIZING.minSamples}) before a hint can be shown.`;
