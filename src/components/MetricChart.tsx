import type { MetricRangeId } from "../types/k8s";
import { METRIC_RANGES, rangeWindow } from "../utils/observability";
import { agoLabel, ariaLabel, isYoung, plotSegments, seriesStats, splitSegments, statsText, type Point } from "../utils/metricChart";

const W = 300;
const H = 48;

/** One series, one line, no pointer tooltip. The visible numbers under the chart are the text alternative. */
export function MetricChart({ points, range, kind, container, busy, updatedAt }: {
  points: Point[];
  range: Exclude<MetricRangeId, "now">;
  kind: "CPU" | "Memory";
  container: string;
  /** The previous range's chart while the new one loads. */
  busy?: boolean;
  /** Query dataUpdatedAt (ms): the window the backend fetched ends here, whatever the last sample is. */
  updatedAt?: number;
}) {
  const { step } = METRIC_RANGES[range];
  const stats = seriesStats(points);
  if (!stats) return null;
  const { start: x0, end: x1 } = rangeWindow(range, (updatedAt || Date.now()) / 1000);
  const lines = plotSegments(splitSegments(points, step), x0, x1, W, H, stats.max);
  const suffix = kind === "CPU" ? "m" : "Mi";
  return (
    <div className={`mt-1 ${busy ? "opacity-60" : ""}`} aria-busy={busy || undefined}>
      <div className="text-[10.5px] text-mute mb-0.5">{kind}, last {RANGE_TEXT[range]}</div>
      <svg
        role="img" aria-label={ariaLabel(kind, container, range, stats)}
        width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        className={`block ${kind === "CPU" ? "text-metric-cpu" : "text-metric-mem"}`}
      >
        {lines.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="flex justify-between text-[10.5px] text-mute"><span>{agoLabel(range)}</span><span>now</span></div>
      <div className="mono text-[10.5px] text-mute tabular-nums">{statsText(stats, suffix)}</div>
      {!busy && isYoung(points, x0, step) && <div className="text-[10.5px] text-mute">History starts when the container started.</div>}
    </div>
  );
}

const RANGE_TEXT: Record<Exclude<MetricRangeId, "now">, string> = { "1h": "hour", "6h": "6 hours", "24h": "24 hours", "7d": "7 days" };
