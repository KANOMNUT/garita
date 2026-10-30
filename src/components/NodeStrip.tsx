import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Server, ChevronRight } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import type { MetricRangeId, NodeCapacity, NodeResource, ServiceTarget } from "../types/k8s";
import { useMetricRange } from "../hooks/useResources";
import { HISTORY_DOWN, RANGE_IDS, RANGE_LABEL, toPercent } from "../utils/metricChart";
import { Segmented } from "./health/HealthShell";
import { capacityLevel, capacityRow, reqLine, type CapacityRow } from "../utils/capacity";
import { Sparkline } from "./Sparkline";
import { stripColumns } from "../utils/nodeStrip";

// One 65/85 threshold pair for every capacity surface (X7): NodeStrip's red moved from 80 to 85.
// Literal class pairs (bg for the bar fill, text for the sparkline stroke) so Tailwind sees them.
function cpuColor(pct: number) {
  const l = capacityLevel(pct);
  return l === "high" ? { bg: "bg-bar-high", text: "text-bar-high" } : l === "mid" ? { bg: "bg-bar-mid", text: "text-bar-mid" } : { bg: "bg-metric-cpu", text: "text-metric-cpu" };
}
function memColor(pct: number) {
  const l = capacityLevel(pct);
  return l === "high" ? { bg: "bg-bar-high", text: "text-bar-high" } : l === "mid" ? { bg: "bg-bar-mid", text: "text-bar-mid" } : { bg: "bg-metric-mem", text: "text-metric-mem" };
}

/** Requests tick on a usage bar: an SVG attribute carries the position, so no inline style. */
function ReqTick({ pct }: { pct: number | undefined }) {
  if (pct === undefined) return null;
  return (
    <svg className="absolute inset-0 w-full h-full" aria-hidden>
      <rect x={`${Math.min(pct, 99)}%`} width="1.5" height="100%" className="fill-ink/70" />
    </svg>
  );
}

interface NodeCardProps {
  node: NodeResource;
  cpuHistory?: number[];
  memHistory?: number[];
  /** Requests overlay; absent while the capacity query is loading, failed or denied. */
  cap?: CapacityRow;
  /** Prometheus history (v2.3.0). With range "now" or no target the card is exactly the session view. */
  context?: string;
  target?: ServiceTarget;
  range?: MetricRangeId;
  alloc?: { cpu: number | null; mem: number | null };
  onStatus?: (node: string, status: HistStatus, message: string) => void;
}

type HistStatus = "idle" | "pending" | "ok" | "error";
const NO_ALLOC = "Node capacity isn't available, so history can't be shown as a percentage.";

const NodeCard = memo(function NodeCard({ node, cpuHistory: sessionCpu, memHistory: sessionMem, cap, context = "", target, range = "now", alloc, onStatus }: NodeCardProps) {
  const on = !!target && range !== "now";
  const cpuQ = useMetricRange(context, target, "node-cpu", "", node.name, range, on);
  const memQ = useMetricRange(context, target, "node-mem", "", node.name, range, on);
  const err = on ? (cpuQ.error ?? memQ.error) : null;
  const status: HistStatus = !on ? "idle" : err ? "error" : cpuQ.data && memQ.data ? "ok" : "pending";
  const message = err?.message ?? "";
  useEffect(() => { onStatus?.(node.name, status, message); }, [onStatus, node.name, status, message]);
  const pctCpu = on && !err ? toPercent(cpuQ.data?.series[0]?.points ?? [], alloc?.cpu) : null;
  const pctMem = on && !err ? toPercent(memQ.data?.series[0]?.points ?? [], alloc?.mem) : null;
  const cpuHistory = pctCpu && pctCpu.length >= 2 ? pctCpu : sessionCpu;
  const memHistory = pctMem && pctMem.length >= 2 ? pctMem : sessionMem;
  const note = on && status === "ok" && (!alloc?.cpu || !alloc?.mem) ? NO_ALLOC : undefined;
  const cpu = node.cpu_percent ?? 0;
  const mem = node.mem_percent ?? 0;
  const isCP = node.roles.includes("control-plane");

  return (
    <div className="rounded-lg bg-base/60 ring-1 ring-edge p-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${node.status === "ok" ? "bg-ok" : "bg-warn"}`} />
          <span className="mono text-[11px] truncate">{node.name}</span>
        </div>
        <span className="text-[9.5px] uppercase tracking-wider text-dim shrink-0">
          {isCP ? "CP" : "W"}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-dim w-7">CPU</span>
          <div className="relative flex-1 h-[5px] rounded-xs overflow-hidden bg-surface-tint/4">
            <div className={`h-full rounded-xs ${cpuColor(cpu).bg}`} style={{ width: `${cpu}%` }} />
            <ReqTick pct={cap?.cpu?.reqPct} />
          </div>
          <span className="mono text-[10px] text-mute tabular-nums w-7 text-right">{cpu}%</span>
          {cpuHistory && cpuHistory.length >= 2 && (
            <span title={note}><Sparkline data={cpuHistory} colorClass={cpuColor(cpu).text} width={48} height={16} /></span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-dim w-7">MEM</span>
          <div className="relative flex-1 h-[5px] rounded-xs overflow-hidden bg-surface-tint/4">
            <div className={`h-full rounded-xs ${memColor(mem).bg}`} style={{ width: `${mem}%` }} />
            <ReqTick pct={cap?.mem?.reqPct} />
          </div>
          <span className="mono text-[10px] text-mute tabular-nums w-7 text-right">{mem}%</span>
          {memHistory && memHistory.length >= 2 && (
            <span title={note}><Sparkline data={memHistory} colorClass={memColor(mem).text} width={48} height={16} /></span>
          )}
        </div>
        {cap && (() => {
          const req = reqLine(cap);
          return (
            <div className="flex items-center justify-between gap-2" title="Requests, as a share of allocatable.">
              <span className="text-[10px] text-dim">REQ</span>
              <span className={`mono text-[10px] tabular-nums whitespace-nowrap inline-flex items-center gap-0.5 ${req.high ? "text-bad" : "text-dim"}`}>
                {req.high && <AlertTriangle size={9} aria-hidden />}{req.text}
              </span>
            </div>
          );
        })()}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-dim">pods</span>
          <span className="mono text-[10px] tabular-nums">
            {node.pod_count != null ? `${node.pod_count}/` : ""}{node.pod_capacity}
          </span>
        </div>
      </div>
    </div>
  );
});

function SkeletonCard() {
  return (
    <div className="rounded-lg bg-base/60 ring-1 ring-edge p-2.5 flex flex-col gap-2">
      <div className="h-3 rounded-sm bg-surface-tint/4 animate-pulse w-24" />
      <div className="h-2 rounded-sm bg-surface-tint/4 animate-pulse" />
      <div className="h-2 rounded-sm bg-surface-tint/4 animate-pulse" />
      <div className="h-2 rounded-sm bg-surface-tint/4 animate-pulse w-16" />
    </div>
  );
}

interface NodeStripProps {
  nodes: NodeResource[];
  onViewAll?: () => void;
  cpuHistory?: Map<string, number[]>;
  memHistory?: Map<string, number[]>;
  capacity?: NodeCapacity[];
  /** The active context and its Prometheus target; the range control appears only with a target. */
  context?: string;
  target?: ServiceTarget;
}

export const NodeStrip = memo(function NodeStrip({ nodes, onViewAll, cpuHistory, memHistory, capacity, context, target }: NodeStripProps) {
  const displayed = nodes.slice(0, 6);
  // Default Now (the 20-sample session ring): the overview makes no Prometheus call until a range is chosen. Not persisted.
  const [range, setRange] = useState<MetricRangeId>("now");
  const [statuses, setStatuses] = useState<Record<string, { s: HistStatus; m: string }>>({});
  const onStatus = useCallback((n: string, s: HistStatus, m: string) => {
    setStatuses((prev) => (prev[n]?.s === s && prev[n]?.m === m ? prev : { ...prev, [n]: { s, m } }));
  }, []);
  const allFailed = range !== "now" && displayed.length > 0 && displayed.every((n) => statuses[n.name]?.s === "error");
  const failMsg = allFailed ? statuses[displayed[0].name]?.m : undefined;
  const allocByNode = useMemo(() => new Map((capacity ?? []).map((c) => [c.node, { cpu: c.cpu_allocatable_m, mem: c.mem_allocatable_mi }])), [capacity]);
  const capByNode = useMemo(() => new Map((capacity ?? []).map((c) => [c.node, capacityRow(c)])), [capacity]);
  const isLoading = nodes.length === 0;

  return (
    <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-dim" />
          <span className="text-[12px] font-medium">Nodes</span>
          {!isLoading && (
            <span className="text-[11px] text-dim mono">
              {nodes.length} total
            </span>
          )}
        </div>
        {target && (
          <div className="flex items-center gap-2 mr-auto ml-3">
            <Segmented<MetricRangeId> label="Node history range" value={allFailed ? "now" : range} options={RANGE_IDS.map((id): readonly [MetricRangeId, string, string?] => [id, RANGE_LABEL[id], allFailed && id !== "now" ? HISTORY_DOWN : undefined])} onChange={(r) => { if (allFailed && r === "now") return; setRange(r); }} />
            <span role="status" className="text-[11px] text-mute" title={failMsg}>
              {range !== "now" && !allFailed ? "Source: Prometheus" : "Source: metrics-server · this session"}
              {allFailed && ` · ${HISTORY_DOWN}`}
            </span>
          </div>
        )}
        <button
          onClick={onViewAll}
          className="text-[11.5px] text-mute hover:text-ink flex items-center gap-1 transition-colors"
        >
          View all <ChevronRight size={11} />
        </button>
      </div>
      <div
        role="group"
        aria-label="Node cards"
        tabIndex={0}
        className="overflow-x-auto rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
      >
        <div className="grid gap-2" style={{ gridTemplateColumns: stripColumns(isLoading ? 6 : displayed.length) }}>
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : displayed.map((n) => (
                <NodeCard
                  key={n.name}
                  node={n}
                  cpuHistory={cpuHistory?.get(n.name)}
                  memHistory={memHistory?.get(n.name)}
                  cap={capByNode.get(n.name)}
                  context={context}
                  target={target}
                  range={range}
                  alloc={allocByNode.get(n.name)}
                  onStatus={onStatus}
                />
              ))
          }
        </div>
      </div>
    </div>
  );
});
