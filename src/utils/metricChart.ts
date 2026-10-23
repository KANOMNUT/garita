// Pure helpers for the metric history chart (v2.3.0 F2, UX 16 §3.1/§3.3).
import type { MetricRangeId } from "../types/k8s";

export type Point = [number, number];

export const RANGE_IDS: readonly MetricRangeId[] = ["now", "1h", "6h", "24h", "7d"];
export const RANGE_LABEL: Record<MetricRangeId, string> = { now: "Now", "1h": "1 h", "6h": "6 h", "24h": "24 h", "7d": "7 d" };
const RANGE_WORDS: Record<MetricRangeId, string> = { now: "now", "1h": "hour", "6h": "6 hours", "24h": "24 hours", "7d": "7 days" };

const STORAGE_KEY = "metrics-range";

/** Per viewer, shared by the Metrics tab. Unknown or unreadable reads as 1 h. */
export function readStoredRange(): MetricRangeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return RANGE_IDS.includes(v as MetricRangeId) ? (v as MetricRangeId) : "1h";
  } catch {
    return "1h";
  }
}
export function storeRange(r: MetricRangeId): void {
  try { localStorage.setItem(STORAGE_KEY, r); } catch {}
}

/** Breaks the line wherever consecutive points are more than twice the step apart. Never interpolates across a gap. */
export function splitSegments(points: readonly Point[], step: number): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  for (const p of points) {
    if (cur.length && p[0] - cur[cur.length - 1][0] > 2 * step) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function seriesStats(points: readonly Point[]): { min: number; max: number; latest: number } | null {
  if (points.length === 0) return null;
  let min = Infinity, max = -Infinity;
  for (const [, v] of points) { if (v < min) min = v; if (v > max) max = v; }
  return { min, max, latest: points[points.length - 1][1] };
}

/** First point later than the range start by more than two steps: the container is younger than the range. */
export const isYoung = (points: readonly Point[], startSec: number, step: number) => points.length > 0 && points[0][0] - startSec > 2 * step;

const fmt = (v: number) => String(Math.round(v));

/** `min 12m · max 88m · latest 42m` (memory: `Mi`). */
export function statsText(s: { min: number; max: number; latest: number }, suffix: "m" | "Mi"): string {
  return `min ${fmt(s.min)}${suffix} · max ${fmt(s.max)}${suffix} · latest ${fmt(s.latest)}${suffix}`;
}

export function ariaLabel(kind: "CPU" | "Memory", container: string, range: MetricRangeId, s: { min: number; max: number; latest: number }): string {
  const unit = kind === "CPU" ? "millicores" : "mebibytes";
  const w = RANGE_WORDS[range];
  const span = w === "hour" ? "last hour" : `last ${w}`;
  return `${kind}, container ${container}, ${span}: minimum ${fmt(s.min)} ${unit}, maximum ${fmt(s.max)} ${unit}, latest ${fmt(s.latest)} ${unit}.`;
}

/** Left end label of the x axis; the right one is always "now". */
export const agoLabel = (range: MetricRangeId) => `${RANGE_LABEL[range]} ago`;

/** SVG `points` strings, one per segment. y starts at 0; a lone point becomes a 1-unit dash so it is visible. */
export function plotSegments(segments: readonly Point[][], x0: number, x1: number, w: number, h: number, yMax: number): string[] {
  const top = yMax > 0 ? yMax : 1;
  const X = (t: number) => (x1 > x0 ? ((t - x0) / (x1 - x0)) * w : w);
  const Y = (v: number) => h - (Math.max(0, v) / top) * h;
  return segments.map((seg) => {
    const pts = seg.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`);
    if (pts.length === 1) { const [x, y] = pts[0].split(","); pts.push(`${(Number(x) + 1).toFixed(1)},${y}`); }
    return pts.join(" ");
  });
}

/** Node history: absolute value as percent of allocatable, clamped to 100. No allocatable: no history. */
export function toPercent(points: readonly Point[], allocatable: number | null | undefined): number[] | null {
  if (!allocatable || allocatable <= 0) return null;
  return points.map(([, v]) => Math.min(100, Math.round((v / allocatable) * 100)));
}

/** Disabled-range reason shared by the Metrics tab and NodeStrip. */
export const HISTORY_DOWN = "History needs Prometheus, which isn't reachable right now.";
