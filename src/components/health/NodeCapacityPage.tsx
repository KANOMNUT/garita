import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Info, ShieldOff } from "lucide-react";
import { useApiPresence, useNodeCapacity } from "../../hooks/useResources";
import {
  capacityRow, filterRows, fmtCpu, fmtMem, sortRows, totals, totalsLine,
  type CapacitySort, type CapacityLevel, type ResourceCell,
} from "../../utils/capacity";
import { isForbidden } from "../../utils/viewState";
import { clock, StaleStrip } from "./StaleStrip";


const FILL: Record<CapacityLevel, string> = { low: "fill-bar-low", mid: "fill-bar-mid", high: "fill-bar-high" };
const ZONE: Record<CapacityLevel, string> = { low: "fill-bar-low/30", mid: "fill-bar-mid/30", high: "fill-bar-high/30" };

/**
 * NODE-CAPACITY-BAR (X6): fill = requests, marker = usage, tinted = limits (clamped at the end;
 * the number beside it carries any overflow). SVG attributes carry the widths, so no inline style.
 */
function CapacityBar({ cell, label }: { cell: ResourceCell; label: string }) {
  const req = Math.min(cell.reqPct, 100);
  const lim = Math.min(cell.limPct, 100);
  const text = `${label}: ${cell.reqPct} percent of allocatable requested, limits ${cell.limPct} percent${cell.usagePct !== null ? `, usage ${cell.usagePct} percent` : ""}.`;
  return (
    <svg role="img" aria-label={text} className="w-full h-[6px] min-w-[96px]">
      <rect width="100%" height="100%" rx="2" className="fill-surface-tint/6" />
      {lim > req && <rect x={`${req}%`} width={`${lim - req}%`} height="100%" className={ZONE[cell.level]} />}
      <rect width={`${req}%`} height="100%" rx="2" className={FILL[cell.level]} />
      {cell.usagePct !== null && <rect x={`${Math.min(cell.usagePct, 99)}%`} width="2" height="100%" className="fill-ink" />}
    </svg>
  );
}

function Cell({ cell, label, requested, usage }: { cell: ResourceCell | null; label: string; requested: string; usage: string | null }) {
  if (!cell) return <span className="text-dim">Allocatable unavailable</span>;
  return (
    <div className="flex flex-col gap-1 min-w-[190px]">
      <span className="mono text-[11.5px] text-ink">{requested}</span>
      <div className="flex items-center gap-2">
        <span className={`mono text-[11.5px] tabular-nums shrink-0 ${cell.level === "high" ? "text-bad" : "text-mute"}`}>
          {cell.level === "high" && (
            <span title="Requests are at 85% or more of allocatable." className="inline-flex items-center gap-0.5 mr-1">
              <AlertTriangle size={11} aria-hidden /> High
            </span>
          )}
          {cell.reqPct}%
        </span>
        <CapacityBar cell={cell} label={label} />
      </div>
      <span className="text-[11px] text-dim">
        Limits {cell.limPct}%{cell.limPct > 100 ? " (over 100%)" : ""}{usage ? ` · usage ${usage}` : ""}
      </span>
    </div>
  );
}

interface Props {
  context: string;
  /** Hidden mount (Q3): the query runs only while the page is visible. */
  visible: boolean;
  /** The TopBar search box: filters nodes by name. */
  search: string;
  onOpenNode: (name: string) => void;
}

function Block({ icon, title, body, retry }: { icon: React.ReactNode; title: string; body?: string; retry?: () => void }) {
  return (
    <div className="rounded-xl bg-card/70 ring-1 ring-edge flex flex-col items-center gap-3 text-center px-6 py-14">
      <div className="text-dim">{icon}</div>
      <p className="text-[13px] text-mute">{title}</p>
      {body && <p className="text-[11.5px] text-dim max-w-md whitespace-pre-wrap">{body}</p>}
      {retry && <button onClick={retry} className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25">Retry</button>}
    </div>
  );
}

const HEADERS: { key: CapacitySort; label: string; title?: string }[] = [
  { key: "node", label: "Node" },
  { key: "cpu", label: "CPU" },
  { key: "mem", label: "Memory" },
  { key: "pods", label: "Pods" },
  { key: "noLimits", label: "No limits", title: "Pods with at least one container that has no CPU or memory limit." },
];

export function NodeCapacityPage({ context, visible, search, onOpenNode }: Props) {
  const q = useNodeCapacity(context, visible);
  const presence = useApiPresence(context, visible);
  const metricsAbsent = presence.data?.find((p) => p.key === "metrics")?.state === "absent";
  const [sort, setSort] = useState<CapacitySort>("cpu");
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => (q.data ?? []).map(capacityRow), [q.data]);
  const sum = useMemo(() => totals(rows), [rows]);
  const shown = useMemo(() => sortRows(filterRows(rows, search), sort, asc), [rows, search, sort, asc]);

  const errMsg = q.error ? ((q.error as any)?.message ?? String(q.error)) : null;
  let body: React.ReactNode;
  if (!q.data) {
    body = errMsg === null ? (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[74px] rounded-lg bg-surface-tint/4 motion-safe:animate-pulse" />)}
      </div>
    ) : isForbidden(errMsg) ? (
      <Block icon={<ShieldOff size={32} />} title="Node capacity needs a cluster-wide pod list."
        body="Your account can't list pods in all namespaces. Ask a cluster admin for the list permission." />
    ) : (
      <Block icon={<AlertCircle size={32} />} title="Couldn't load node capacity." body={errMsg} retry={() => void q.refetch()} />
    );
  } else if (rows.length === 0) {
    body = <Block icon={<Info size={32} />} title="No nodes found." />;
  } else if (shown.length === 0) {
    body = <p className="text-[12px] text-mute px-1">No nodes match the filter.</p>;
  } else {
    body = (
      <div className="overflow-x-auto rounded-xl bg-card/70 ring-1 ring-edge">
        <table className="w-full text-[12px]">
          <caption className="sr-only">Node capacity: requests, limits and usage per node</caption>
          <thead>
            <tr className="text-left text-dim text-[10.5px] uppercase tracking-wider border-b border-edge">
              {HEADERS.map((h) => (
                <th key={h.key} scope="col" aria-sort={sort === h.key ? (asc ? "ascending" : "descending") : "none"} className="px-3 py-2 font-medium" title={h.title}>
                  <button
                    type="button"
                    onClick={() => { if (sort === h.key) setAsc((v) => !v); else { setSort(h.key); setAsc(h.key === "node"); } }}
                    className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink"
                  >
                    {h.label}
                    {sort === h.key && (asc ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.node} className="border-b border-edge-raw/70 last:border-b-0 align-top">
                <td className="px-3 py-2.5">
                  <button type="button" onClick={() => onOpenNode(r.node)} title={`Open node ${r.node}`}
                    className="mono text-[12px] text-accent hover:underline break-all text-left">{r.node}</button>
                </td>
                <td className="px-3 py-2.5">
                  <Cell cell={r.cpu} label="CPU" requested={r.cpu ? `${fmtCpu(r.cpu.requests)} of ${fmtCpu(r.cpu.allocatable)} requested` : ""}
                    usage={r.cpu?.usage != null ? fmtCpu(r.cpu.usage) : null} />
                </td>
                <td className="px-3 py-2.5">
                  <Cell cell={r.mem} label="Memory" requested={r.mem ? `${fmtMem(r.mem.requests)} of ${fmtMem(r.mem.allocatable)} requested` : ""}
                    usage={r.mem?.usage != null ? fmtMem(r.mem.usage) : null} />
                </td>
                <td className="px-3 py-2.5 mono text-[11.5px] text-mute tabular-nums">{r.pods}/{r.podsAllocatable ?? "—"}</td>
                <td className="px-3 py-2.5 mono text-[11.5px] text-mute tabular-nums">{r.noLimits} {r.noLimits === 1 ? "pod" : "pods"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3 ${visible ? "" : "hidden"}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[14px] font-semibold tracking-tight">Node capacity</h1>
          <p className="text-[11.5px] text-mute">{q.data ? totalsLine(sum) : "Checking capacity…"}</p>
        </div>
        {q.data && <span className="text-[11.5px] text-dim shrink-0">Checked {clock(q.dataUpdatedAt)}</span>}
      </div>
      <p className="text-[11.5px] text-dim">Bars: fill = requests · marker = current usage · tinted = limits.</p>
      {q.data && q.error && <StaleStrip at={q.dataUpdatedAt} />}
      {q.data && metricsAbsent && (
        <p className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex items-start gap-2">
          <Info size={13} className="text-info mt-0.5 shrink-0" aria-hidden />
          Current usage isn't shown: metrics-server isn't installed on this cluster. Requests and limits are still accurate.
        </p>
      )}
      {body}
    </div>
  );
}
