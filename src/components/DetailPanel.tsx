import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import { useResizablePanel } from "../hooks/useResizablePanel";
import {
  X, Terminal, FileCode, RefreshCw, MoreHorizontal, Boxes, Trash2, Copy, ChevronRight, ArrowUpRight,
} from "lucide-react";
import { LogViewer } from "./LogViewer";
import { ShellTab } from "./ShellTab";
import { FieldManagers } from "./FieldManagers";
import { DebugContainerDialog } from "./DebugContainerDialog";
import { useDebugSession } from "../hooks/useDebugSession";
import { debugAsContainers, isNoShellError } from "../utils/debugContainer";
import { usePodEvents, useDeletePod, useResourceYaml, usePodMetrics, useApplyResource, useStartPodPortForward, usePortForwards, useStopPortForward, usePermissions, useResourceYamlNeat, useApiPresence } from "../hooks/useResources";
import { ConfirmModal } from "./ConfirmModal";
import { YamlSaveGate } from "./YamlSaveGate";
import { ReadOnlyChip } from "./ReadOnlyBadge";
import { ExplainCard, ProblemChip, useExplain } from "./health/ExplainCard";
import { SizingHint } from "./SizingHint";
import { MetricChart } from "./MetricChart";
import { PartialStrip, Segmented } from "./health/HealthShell";
import { useMetricRange } from "../hooks/useResources";
import { HISTORY_DOWN, RANGE_IDS, RANGE_LABEL, readStoredRange, storeRange } from "../utils/metricChart";
import { isForbidden, requestObservabilityDialog } from "../utils/observability";
import { ConstraintsSection } from "./ConstraintsSection";
import { WhoCanReachSection } from "./WhoCanReachSection";
import { containerKey, p95Hints } from "../utils/rightSizing";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { disabledAttrs, pickDisabledReason, READ_ONLY_BLOCKS_SHELL } from "../utils/guardrails";
import { deletePodsEquiv, restartPodEquiv } from "../utils/kubectlEquiv";
import { selectShellContainer } from "../utils/containerSelect";
import { loadNeatPref, saveNeatPref } from "../utils/neatYaml";
import { defaultLogView } from "../utils/logFilter";
import { NeatChip, NeatNote } from "./NeatYaml";
import type { MetricRangeId, Pod, Container, ContainerStatus, ContainerEnvVar, ContainerEnvFrom, ContainerVolumeMount, ContainerProbe, ResourceType } from "../types/k8s";

const STATUS_MAP: Record<string, { dot: string; text: string; bg: string; ring: string; pulse: boolean }> = {
  Running:          { dot: "bg-ok", text: "text-ok",     bg: "bg-ok/10",     ring: "ring-ok/30",     pulse: false },
  Pending:          { dot: "bg-warn", text: "text-warn",   bg: "bg-warn/10",   ring: "ring-warn/30",   pulse: true  },
  CrashLoopBackOff: { dot: "bg-bad", text: "text-bad",    bg: "bg-bad/10",    ring: "ring-bad/30",    pulse: true  },
  Terminating:      { dot: "bg-purple", text: "text-purple", bg: "bg-purple/10", ring: "ring-purple/30", pulse: true  },
  Succeeded:        { dot: "bg-info", text: "text-info",   bg: "bg-info/10",   ring: "ring-info/30",   pulse: false },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP["Running"];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11px] ${s.text} ${s.bg} ring-1 ${s.ring} font-medium`}>
      <span className="relative flex h-1.5 w-1.5">
        {s.pulse && (
          <span className={`absolute inset-0 rounded-full opacity-60 animate-blink ${s.dot}`} />
        )}
        <span className={`relative rounded-full h-1.5 w-1.5 ${s.dot}`} />
      </span>
      {status}
    </span>
  );
}

function KV({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-edge-raw/60 last:border-b-0">
      <span className="text-[11px] text-dim w-[110px] shrink-0">{k}</span>
      <span className={`text-[12px] text-ink ${mono ? "mono" : ""} truncate`}>{v}</span>
    </div>
  );
}

interface BarProps { value: number; limit: number; color?: string; label: string; }
function Bar({ value, limit, color = "bg-metric-cpu", label }: BarProps) {
  const pct = Math.min(100, Math.round((value / (limit || 1)) * 100));
  const tone = pct >= 85 ? "bg-bar-high" : pct >= 65 ? "bg-bar-mid" : color;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-[5px] rounded-xs overflow-hidden bg-surface-tint/4">
        <div className={`h-full rounded-xs ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="mono text-[11px] text-mute tabular-nums shrink-0">{label}</span>
    </div>
  );
}

// ─── DualZoneBar ─────────────────────────────────────────────────────────────

function DualZoneBar({
  label,
  usageM,
  requestM,
  limitM,
  unitSuffix,
}: {
  label: string;
  usageM?: number | null;
  requestM?: number | null;
  limitM?: number | null;
  unitSuffix: string;
}) {
  const denominator = limitM ?? (requestM ? requestM * 2 : null);
  if (!denominator) {
    return (
      <div className="mb-3 last:mb-0 flex items-center justify-between text-[11px]">
        <span className="text-mute">{label}</span>
        <span className="mono text-ink">{usageM != null ? `${usageM}${unitSuffix}` : '—'}</span>
      </div>
    );
  }

  const usagePct = usageM != null ? Math.min(100, Math.round((usageM / denominator) * 100)) : 0;
  const requestPct = requestM ? Math.min(100, Math.round((requestM / denominator) * 100)) : 0;
  const color = usagePct >= 85 ? 'bg-bar-high' : usagePct >= 65 ? 'bg-bar-mid' : 'bg-bar-low';

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-mute">{label}</span>
        <span className="mono text-[11px] text-ink">
          {usageM != null ? `${usageM}${unitSuffix}` : '—'}
        </span>
      </div>
      <div className="relative h-[5px] rounded-xs overflow-hidden bg-surface-tint/4">
        <div
          className={`absolute inset-y-0 left-0 rounded-xs transition-all ${color}`}
          style={{ width: `${usagePct}%` }}
        />
        {requestPct > 0 && requestPct < 100 && (
          <div
            className="absolute inset-y-0 w-px bg-surface-tint/30"
            style={{ left: `${requestPct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="mono text-[10px] text-dim">req: {requestM != null ? `${requestM}${unitSuffix}` : '—'}</span>
        {limitM != null && (
          <span className="mono text-[10px] text-dim">lim: {limitM}{unitSuffix}</span>
        )}
      </div>
      <div className="flex gap-3 mt-0.5">
        {requestM != null && usageM != null && (
          <span className={`mono text-[10px] ${usagePct >= 85 ? 'text-bad' : usagePct >= 65 ? 'text-warn' : 'text-dim'}`}>
            {Math.round((usageM / requestM) * 100)}% of req
          </span>
        )}
        {limitM != null && (
          <span className="mono text-[10px] text-dim">{usagePct}% of lim</span>
        )}
      </div>
    </div>
  );
}

// ─── TimingChip ──────────────────────────────────────────────────────────────

function TimingChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 text-[10px] leading-none">
      <span className="text-dim">{label}</span>
      <span className="mono text-mute font-medium tabular-nums">{value}</span>
    </span>
  );
}

// ─── Metrics Tab ─────────────────────────────────────────────────────────────

function SaveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}


function MetricsTab({ pod, podMetrics, isLoading, error, context }: {
  pod: Pod;
  context: string;
  podMetrics: import("../types/k8s").PodMetricsResult | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  const cpuLim = pod.cpu_lim ?? 500;
  const memLim = pod.mem_lim ?? 512;
  const metrics = podMetrics;

  // History (v2.3.0): Prometheus through the service proxy. The bars above stay metrics-server data.
  const target = useClusterIdentity(context).observability?.prometheus;
  const [range, setRangeState] = useState<MetricRangeId>(readStoredRange);
  const cpuQ = useMetricRange(context, target, "pod-cpu", pod.namespace, pod.name, range, true);
  const memQ = useMetricRange(context, target, "pod-mem", pod.namespace, pod.name, range, true);
  const groupRef = useRef<HTMLDivElement>(null);
  const retried = useRef(false);
  const queryErr = range !== "now" ? (cpuQ.error ?? memQ.error) : null;
  const failed = !!target && !!queryErr;
  const empty = !!target && range !== "now" && !failed && !!cpuQ.data && !!memQ.data && cpuQ.data.series.length === 0 && memQ.data.series.length === 0;
  const hist = !!target && range !== "now" && !failed;
  const strip = failed || empty;
  // The strip unmounts under the user's focus after a successful Retry: focus moves to the checked radio.
  useEffect(() => {
    if (!strip && retried.current) {
      retried.current = false;
      groupRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    }
  }, [strip]);
  const [why, setWhy] = useState(false);

  const chart = (q: typeof cpuQ, kind: "CPU" | "Memory", name: string) => {
    if (!hist) return null;
    if (q.isLoading) return <div className="h-12 mt-1 rounded-sm bg-surface-tint/4 animate-pulse" />;
    const s = q.data?.series.find((x) => x.label === name);
    if (!s) return q.data && !empty ? <div className="text-[10.5px] text-mute mt-1">No data for this container in Prometheus.</div> : null;
    return <MetricChart points={s.points} range={range as Exclude<MetricRangeId, "now">} kind={kind} container={name} busy={q.isPlaceholderData} updatedAt={q.dataUpdatedAt} />;
  };

  const historyHeader = target ? (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[11px] text-mute">Range</span>
        <div ref={groupRef} data-range-group>
          <Segmented<MetricRangeId>
            label="Range"
            value={failed ? "now" : range}
            options={RANGE_IDS.map((id): readonly [MetricRangeId, string, string?] => [id, RANGE_LABEL[id], failed && id !== "now" ? HISTORY_DOWN : undefined])}
            onChange={(r) => { if (failed && r === "now") return; setRangeState(r); storeRange(r); }}
          />
        </div>
        <span className="text-[11px] text-mute">{hist && !empty ? "Source: Prometheus" : "Source: metrics-server · this session"}</span>
      </div>
      {strip && (
        <PartialStrip
          live
          toggleLabel="Why?"
          open={why}
          onToggle={() => setWhy((v) => !v)}
          actions={
            <button
              type="button"
              aria-disabled={cpuQ.isFetching || memQ.isFetching || undefined}
              onClick={() => { if (cpuQ.isFetching || memQ.isFetching) return; retried.current = true; cpuQ.refetch(); memQ.refetch(); }}
              className="text-mute hover:text-ink shrink-0 inline-flex items-center min-h-6 px-2 rounded-sm focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden"
            >
              {cpuQ.isFetching || memQ.isFetching ? "Retrying…" : "Retry"}
            </button>
          }
          which={<li className="mono break-words">{queryErr ? queryErr.message : "Prometheus answered with no series for this pod."}</li>}
        >
          {empty
            ? "No data for this pod in Prometheus. Showing current usage only."
            : isForbidden(queryErr?.message ?? "")
              ? `No access to services/proxy in ${target.namespace}. Showing current usage only.`
              : "Prometheus unavailable, showing current usage only."}
        </PartialStrip>
      )}
      {hist && (cpuQ.data?.truncated || memQ.data?.truncated) && <div className="text-[10.5px] text-mute">Showing the first 20 series.</div>}
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
      <span>Source: metrics-server · this session</span>
      <span>History beyond this session needs Prometheus. Not set for this cluster.</span>
      <button type="button" onClick={() => requestObservabilityDialog(context)} className="inline-flex items-center min-h-6 px-2 rounded-sm focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden ring-1 ring-edge hover:text-ink">Configure…</button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3 animate-pulse">
            <div className="h-3 w-32 rounded-sm bg-surface-tint/6 mb-3" />
            <div className="h-[48px] rounded-sm bg-surface-tint/4" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="p-4 flex flex-col gap-3">
        {historyHeader}
        <div className="mono text-[10.5px] text-warn px-2 py-1.5 rounded-sm bg-warn/10 ring-1 ring-warn/20">
          Metrics server unavailable — showing resource requests
        </div>
        {[
          { label: "CPU (millicores)", color: "bg-metric-cpu", value: pod.cpu_m ?? 0, limit: cpuLim },
          { label: "Memory (MiB)",     color: "bg-metric-mem", value: pod.mem_mi ?? 0, limit: memLim },
        ].map((m) => (
          <div key={m.label} className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11.5px] text-mute">{m.label}</span>
              <span className="mono text-[11px] text-ink">{m.value} / {m.limit}</span>
            </div>
            <Bar value={m.value} limit={m.limit} color={m.color} label={`${Math.round((m.value / (m.limit || 1)) * 100)}%`} />
          </div>
        ))}
        {hist && [...new Set([...(cpuQ.data?.series ?? []), ...(memQ.data?.series ?? [])].map((s) => s.label))].map((label) => (
          <div key={label} className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
            <div className="text-[11px] text-mute mono mb-1">{label}</div>
            {chart(cpuQ, "CPU", label)}
            {chart(memQ, "Memory", label)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {historyHeader}
      {metrics.containers.map((c) => {
        const containerSpec = pod.containers.find((pc) => pc.name === c.name);
        return (
          <div key={c.name} className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
            <div className="text-[11px] text-dim mono mb-3">{c.name}</div>
            <DualZoneBar
              label="CPU"
              usageM={c.cpu_millicores}
              requestM={containerSpec?.cpu_request_m ?? pod.cpu_m}
              limitM={containerSpec?.cpu_limit_m ?? pod.cpu_lim}
              unitSuffix="m"
            />
            {chart(cpuQ, "CPU", c.name)}
            <DualZoneBar
              label="Memory"
              usageM={c.memory_mib}
              requestM={containerSpec?.mem_request_mi ?? pod.mem_mi}
              limitM={containerSpec?.mem_limit_mi ?? pod.mem_lim}
              unitSuffix="Mi"
            />
            {chart(memQ, "Memory", c.name)}
          </div>
        );
      })}
    </div>
  );
}

// ─── Pod port-forward ─────────────────────────────────────────────────────────

function PodPortForward({ pod, context }: { pod: Pod; context: string }) {
  const [localPort, setLocalPort] = useState("8080");
  const [podPort, setPodPort] = useState(() => {
    const first = pod.containers.flatMap((c) => c.ports)[0];
    return first != null ? String(first) : "80";
  });
  const [error, setError] = useState("");
  const startForward = useStartPodPortForward();
  const stopForward = useStopPortForward();
  const { data: forwards = [] } = usePortForwards();
  const myForwards = forwards.filter((f) => f.name === pod.name && f.namespace === pod.namespace && f.target_type === "pod");

  const handleStart = async () => {
    setError("");
    try {
      await startForward.mutateAsync({
        context, namespace: pod.namespace, pod: pod.name,
        podPort: parseInt(podPort), localPort: parseInt(localPort),
      });
    } catch (e) {
      setError((e as any)?.message ?? String(e));
    }
  };

  return (
    <div className="p-4">
      <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
        <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-3">Active Forwards</div>
        {myForwards.length === 0 ? (
          <div className="text-[12px] text-dim py-4 text-center">No active port-forwards for this pod</div>
        ) : (
          <div className="flex flex-col gap-1.5 mb-3">
            {myForwards.map((f) => (
              <div key={f.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-ok/5 ring-1 ring-ok/20">
                <span className="h-1.5 w-1.5 rounded-full bg-ok shrink-0" />
                <span className="mono text-[11.5px] text-ok flex-1">localhost:{f.local_port} → pod:{f.pod_port}</span>
                <button
                  onClick={() => stopForward.mutate({ forwardId: f.id })}
                  className="h-5 px-2 rounded-sm text-[10px] mono text-dim hover:text-bad transition-colors"
                >
                  stop
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-edge-raw/60 pt-3 mt-3">
          <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-2">New Forward</div>
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="mono text-[9.5px] text-dim">Pod port</span>
              <input
                type="number" value={podPort} onChange={(e) => setPodPort(e.target.value)}
                className="h-7 w-24 rounded-md bg-base ring-1 ring-edge mono text-[11px] text-ink px-2 focus:ring-accent focus:outline-hidden"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="mono text-[9.5px] text-dim">Local port</span>
              <input
                type="number" value={localPort} onChange={(e) => setLocalPort(e.target.value)}
                className="h-7 w-24 rounded-md bg-base ring-1 ring-edge mono text-[11px] text-ink px-2 focus:ring-accent focus:outline-hidden"
              />
            </div>
            <button
              onClick={handleStart}
              disabled={startForward.isPending}
              className="h-7 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-[11px] text-accent hover:bg-accent/25 mono disabled:opacity-50"
            >
              {startForward.isPending ? "Starting…" : "Start Forward"}
            </button>
          </div>
          {error && (
            <div className="mono text-[10.5px] text-bad px-2 py-1 mt-2 rounded-sm bg-bad/10 ring-1 ring-bad/20">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary Tab ─────────────────────────────────────────────────────────────

function SummaryTab({ pod }: { pod: Pod }) {
  const labels = Object.entries(pod.labels ?? {});
  return (
    <div className="p-4 flex flex-col gap-4 overflow-auto">
      {/* Status summary */}
      <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
        <h3 className="text-[11px] uppercase tracking-wider text-dim mb-2">Status</h3>
        <KV k="Phase" v={pod.status} />
        <KV k="Ready" v={pod.ready} />
        <KV k="Node" v={pod.node || "—"} />
        <KV k="Restarts" v={String(pod.restarts)} />
        <KV k="Age" v={pod.age} />
      </div>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-dim mb-2">Labels</h3>
          <div className="flex flex-wrap gap-1.5">
            {labels.map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 ring-1 ring-accent/20 text-[11px] mono">
                <span className="text-accent">{k}</span>
                <span className="text-dim">=</span>
                <span className="text-ink">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Container statuses */}
      {pod.containers_status && pod.containers_status.length > 0 && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-dim mb-2">Container States</h3>
          {pod.containers_status.map(cs => (
            <div key={cs.name} className="flex items-center gap-3 py-1.5 border-b border-edge-raw/60 last:border-b-0">
              <span className="mono text-[11.5px] flex-1 truncate">{cs.name}</span>
              <span className={`text-[11px] ${cs.current_state === "running" ? "text-ok" : cs.current_state === "terminated" ? "text-bad" : "text-warn"}`}>
                {cs.current_state}
              </span>
              <span className="text-[11px] text-dim mono">↻{cs.restart_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = "Overview" | "Summary" | "Containers" | "Events" | "Logs" | "Shell" | "YAML" | "Metrics" | "Forward";
const TABS: Tab[] = ["Overview", "Summary", "Containers", "Events", "Logs", "Shell", "YAML", "Metrics", "Forward"];

interface DetailPanelProps {
  pod: Pod;
  context: string;
  onClose: () => void;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
  /** The App's pods list: the fallback for fresh pod data (C-6) before the click-time snapshot. */
  podsList?: Pod[];
  /** "See in Problems" on the explain card. */
  onOpenProblems?: () => void;
  /** False while a Health page is on screen: the panel stays mounted but must not poll list_problems (A-5). */
  problemsVisible?: boolean;
  /** Per-container usage rings keyed "namespace/pod/container" (right-sizing hints, #13). */
  containerCpuHistory?: Map<string, number[]>;
  containerMemHistory?: Map<string, number[]>;
  /** "Show on map" in "Who can reach this pod (approximation)": Map page, Network policies mode, this pod's group. */
  onOpenMap?: (namespace: string, podName: string) => void;
}

export function DetailPanel({ pod, context, onClose, onNavigate, podsList, onOpenProblems, problemsVisible = true, containerCpuHistory, containerMemHistory, onOpenMap }: DetailPanelProps) {
  const identity = useClusterIdentity(context);
  const metricsAbsent = useApiPresence(context).data?.find((p) => p.key === "metrics")?.state === "absent";
  const explain = useExplain(context, "pods", pod.namespace, pod.name, problemsVisible);
  const constraintPod = useMemo(() => ({ labels: pod.labels ?? {}, priorityClass: pod.priority_class ?? null }), [pod.labels, pod.priority_class]);
  const [explainNonce, setExplainNonce] = useState(0);
  const { width, startResize } = useResizablePanel("detail-panel-width");
  const [tab, setTab] = useState<Tab>("Overview");
  // 24 h series for the p95 hint: the same cache entry as the Metrics tab's 24 h chart. Silent on failure.
  const promTarget = identity.observability?.prometheus;
  const p95Cpu = useMetricRange(context, promTarget, "pod-cpu", pod.namespace, pod.name, "24h", tab === "Containers");
  const p95Mem = useMetricRange(context, promTarget, "pod-mem", pod.namespace, pod.name, "24h", tab === "Containers");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  // Manual container choices. They stick for this pod until the panel closes or the pod changes
  // (they live here, not in the tabs, because the content wrapper remounts on every tab switch).
  const [selectedContainer, setSelectedContainer] = useState<string>("");
  const [logPick, setLogPick] = useState<string | null>(null);
  // UXP-25: the message explaining a missing shell (start rejection or `shell-closed`).
  const [shellFailure, setShellFailure] = useState<string | null>(null);
  // View filters survive tab switches, but reset with this pod. Never persist them.
  const [logView, setLogView] = useState(() => defaultLogView("single"));
  const [openSections, setOpenSections] = useState<Record<string, Set<string>>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleSection = (containerName: string, section: string) => {
    setOpenSections(prev => {
      const current = new Set(prev[containerName] ?? []);
      if (current.has(section)) current.delete(section);
      else current.add(section);
      return { ...prev, [containerName]: current };
    });
  };
  const isOpen = (containerName: string, section: string) =>
    openSections[containerName]?.has(section) ?? false;

  const AccordionHeader = ({
    containerName, section, label, count
  }: { containerName: string; section: string; label: string; count: number }) => (
    <button
      onClick={() => toggleSection(containerName, section)}
      className="flex items-center gap-1.5 w-full py-1.5 mt-2 text-left border-t border-edge-raw/40 hover:text-ink transition-colors"
    >
      <span className="text-[10px] uppercase tracking-wider text-dim font-semibold flex-1">
        {label}
      </span>
      <span className="mono text-[10px] text-dim/60">({count})</span>
      <ChevronRight
        size={10}
        className={`text-dim transition-transform ${isOpen(containerName, section) ? 'rotate-90' : ''}`}
      />
    </button>
  );

  const { data: podEvents = [], isLoading: eventsLoading } = usePodEvents(
    context, pod.namespace, pod.name, tab === "Events"
  );
  const { data: yamlContent = "", isLoading: yamlLoading } = useResourceYaml(
    "pods", context, pod.namespace, pod.name, tab === "YAML"
  );
  // #6 neat YAML: DISPLAY ONLY. The editor seed (setEditContent(yamlContent)) and Save always use
  // the full get_resource_yaml text; the neat query's data never reaches the editor or apply.
  const [neat, setNeat] = useState(loadNeatPref);
  const toggleNeat = () => setNeat((v) => { saveNeatPref(!v); return !v; });
  const neatQuery = useResourceYamlNeat("pods", context, pod.namespace, pod.name, tab === "YAML" && neat && !editMode);
  const neatShown = neat && !editMode && !!neatQuery.data;
  const shownYaml = neatShown && neatQuery.data ? neatQuery.data.yaml : yamlContent;
  const yamlSkeleton = yamlLoading || (neat && !editMode && neatQuery.isLoading);
  const { data: podMetrics, isLoading: metricsLoading, error: metricsError } = usePodMetrics(
    context, pod.namespace, pod.name, tab === "Containers" || tab === "Metrics"
  );
  const deletePod = useDeletePod();
  const [confirmDeletePod, setConfirmDeletePod] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restartError, setRestartError] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  const applyResource = useApplyResource();
  // Fails open (usePermissions contract): only an explicit allowed:false greys YAML edit/Save.
  const perm = usePermissions(context, pod.namespace, "pods");
  const noUpdateReason = perm.canUpdate ? undefined : `You don't have permission to update pods in ${pod.namespace}.`;
  // DISABLE-PRECEDENCE: read-only first, then RBAC. Controls stay focusable (aria-disabled).
  const roReason = pickDisabledReason({ readOnly: identity.readOnly });
  const yamlReason = pickDisabledReason({ readOnly: identity.readOnly, rbac: noUpdateReason });
  // D3-7: shell exec is blocked while read-only is on (one switch: READ_ONLY_BLOCKS_SHELL).
  const shellReason = READ_ONLY_BLOCKS_SHELL ? roReason : undefined;
  // UXP-24: the debug session lives HERE, above the key-remounted tab content.
  const dbg = useDebugSession({ context, snapshot: pod, podsList, tab, shellReason, readOnly: identity.readOnly });
  const debugContainers = dbg.pod.ephemeral_containers;
  const debugNamesKey = (debugContainers ?? []).map((e) => e.name).join(",");

  useEffect(() => {
    if (tab !== "YAML") { setEditMode(false); setConfirmSave(false); }
  }, [tab]);

  useEffect(() => {
    setTab("Overview");
    setSelectedContainer("");
    setLogPick(null);
    setShellFailure(null);
    setLogView(defaultLogView("single"));
  }, [pod.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const containers: Container[] = pod.containers.length > 0
    ? pod.containers
    : [{
        name: pod.name.split("-")[0] + "-main",
        image: pod.image ?? "unknown",
        status: pod.status,
        ready: pod.status === "Running",
        restart_count: pod.restarts,
        is_init: false,
        ports: [],
      }];

  // Shell precedence (02 §2.3): annotation, then first running. A manual choice sticks.
  // `[debug]` entries appear in the Containers tab and the selectors (never in the default
  // pre-selection precedence, which keeps its real-container rules).
  const shellContainers = useMemo(
    () => [...containers, ...debugAsContainers(debugContainers)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [containers, debugContainers],
  );
  // The Logs tab must NOT see a new array identity on every 2 s poll (C-6): that would re-run
  // container pre-selection and could restart streams. Key it by the debug container NAMES.
  const logContainers = useMemo(
    () => [...containers, ...debugAsContainers(debugContainers)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pod.containers, pod.name, debugNamesKey],
  );
  const podSelectable = { containers: shellContainers, containers_status: pod.containers_status, default_container: pod.default_container };
  const shellContainer = shellContainers.some((c) => c.name === selectedContainer)
    ? selectedContainer
    : selectShellContainer(podSelectable);

  return (
    <aside className="slide-in shrink-0 bg-panel/95 border-l border-edge flex flex-col relative" style={{ width: `${width}px` }}>
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute left-0 inset-y-0 w-1.5 cursor-col-resize z-20 group hover:bg-accent/30 transition-colors"
      >
        <div className="absolute left-0 inset-y-0 w-px bg-edge group-hover:bg-accent/60 transition-colors" />
      </div>
      {/* header */}
      <div className="px-4 pt-3 pb-3 border-b border-edge">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-dim">
              <Boxes size={11} />
              <span>Pod</span>
              <span className="text-edge2">·</span>
              <span className="mono normal-case tracking-normal text-mute">{pod.namespace}</span>
            </div>
            <h3 data-panel-heading tabIndex={-1} className="mono text-[14px] mt-1 break-all leading-tight outline-hidden">{pod.name}</h3>
            <div className="flex items-center gap-2 mt-2">
              <StatusPill status={pod.status} />
              {identity.readOnly && <ReadOnlyChip />}
              <ProblemChip model={explain.model} onClick={() => { setTab("Summary"); setExplainNonce((n) => n + 1); }} />
              <span className="text-[11px] text-dim mono">
                {pod.ready} ready · {pod.restarts} restarts · {pod.age} old
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 -mr-1 rounded-md hover:bg-surface-tint/6 text-mute hover:text-ink flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>
        {/* actions */}
        <div className="flex items-center gap-1.5 mt-3">
          <button
            onClick={() => { if (shellReason) return; setTab("Shell"); }}
            {...disabledAttrs(shellReason)}
            className={`h-7 px-2.5 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[11.5px] flex items-center gap-1.5 hover:bg-accent/25 ${shellReason ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Terminal size={12} /> Exec shell
          </button>
          <button
            onClick={() => setTab("Logs")}
            className="h-7 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink flex items-center gap-1.5"
          >
            <FileCode size={12} /> Logs
          </button>
          <button
            onClick={() => { if (roReason) return; setRestartError(""); setConfirmRestart(true); }}
            disabled={deletePod.isPending}
            title="Deletes the pod; its controller creates a replacement"
            {...disabledAttrs(roReason)}
            className={`h-7 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink flex items-center gap-1.5 disabled:opacity-50 ${roReason ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <RefreshCw size={12} className={deletePod.isPending ? "animate-spin" : ""} /> Restart
          </button>
          <div className="flex-1" />
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="h-7 w-7 rounded-md bg-card/80 ring-1 ring-edge text-mute hover:text-ink flex items-center justify-center"
            >
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-44 rounded-lg bg-panel border border-edge shadow-xl py-1">
                <button
                  onClick={() => { navigator.clipboard.writeText(pod.name); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-mute hover:text-ink hover:bg-surface-tint/4 flex items-center gap-2"
                >
                  <Copy size={12} /> Copy pod name
                </button>
                <div className="my-1 border-t border-edge-raw/60" />
                <button
                  onClick={() => { if (roReason) return; setConfirmDeletePod(true); setMenuOpen(false); }}
                  {...disabledAttrs(roReason)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] text-bad hover:bg-surface-tint/4 flex items-center gap-2 ${roReason ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Trash2 size={12} /> Delete pod
                </button>
              </div>
            )}
          </div>
          <ConfirmModal
            contextLabel={identity.label}
            contextColor={identity.color}
            context={identity.context}
            kubectlEquivalent={restartPodEquiv({ context, namespace: pod.namespace, name: pod.name })}
            open={confirmRestart}
            title={`Restart pod ${pod.name}`}
            description={
              <>
                Deletes the pod. Its controller creates a replacement.
                {!pod.owner && " This pod has no controller, so it won't come back."}
              </>
            }
            confirmLabel={deletePod.isPending ? "Restarting…" : "Restart pod"}
            destructive={!pod.owner}
            status={restartError ? { tone: "error", text: restartError } : null}
            onConfirm={async () => {
              setRestartError("");
              try {
                await deletePod.mutateAsync({ context, namespace: pod.namespace, podName: pod.name });
                setConfirmRestart(false);
              } catch (e) {
                setRestartError((e as any)?.message ?? String(e));
              }
            }}
            onCancel={() => { setConfirmRestart(false); setRestartError(""); }}
            isPending={deletePod.isPending}
          />
          <ConfirmModal
            contextLabel={identity.label}
            contextColor={identity.color}
            context={identity.context}
            kubectlEquivalent={deletePodsEquiv({ context, namespace: pod.namespace, names: [pod.name] })}
            open={confirmDeletePod}
            title="Delete pod"
            description={`Delete pod "${pod.name}" from namespace "${pod.namespace}"? Kubernetes will recreate it if managed by a controller.`}
            confirmLabel="Delete"
            destructive
            onConfirm={() => {
              deletePod.mutate({ context, namespace: pod.namespace, podName: pod.name });
              setConfirmDeletePod(false);
              onClose();
            }}
            onCancel={() => setConfirmDeletePod(false)}
            isPending={deletePod.isPending}
          />
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-0.5 px-4 border-b border-edge shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => { if (t === "Shell" && shellReason) return; setTab(t); }}
            {...(t === "Shell" ? disabledAttrs(shellReason) : {})}
            className={`relative h-9 px-2.5 text-[12px] shrink-0 ${tab === t ? "text-ink" : "text-mute hover:text-ink"} ${t === "Shell" && shellReason ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {t}
            {tab === t && (
              <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-t bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* tab content */}
      <div className="flex-1 overflow-y-auto fade-in" key={`${pod.name}-${tab}`}>
        {tab === "Overview" && (
          <div className="p-4 flex flex-col gap-3">
            <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5">Metadata</div>
              <KV k="Name"            v={pod.name} />
              <KV k="Namespace"       v={pod.namespace} />
              <KV k="Owner"           v={pod.owner ?? "—"} />
              <KV k="Node"            v={pod.node} />
              <KV k="Service account" v="default" />
              <KV k="Created"         v={`${pod.age} ago`} mono={false} />
            </div>
            <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-2">Labels</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(pod.labels).length > 0
                  ? Object.entries(pod.labels).map(([k, v]) => (
                    <span key={k} className="mono text-[10.5px] px-1.5 py-0.5 rounded-sm bg-surface-tint/5 ring-1 ring-edge text-mute">
                      {k}={v}
                    </span>
                  ))
                  : <span className="text-[11px] text-dim">No labels</span>
                }
              </div>
            </div>
            <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-2">Conditions</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { k: "Initialized",     v: pod.status !== "Pending" },
                  { k: "Ready",           v: pod.status === "Running" },
                  { k: "ContainersReady", v: pod.status === "Running" },
                  { k: "PodScheduled",    v: pod.node !== "—" },
                ].map((c) => (
                  <div key={c.k} className="flex items-center gap-2 text-[11.5px]">
                    <span className={`h-1.5 w-1.5 rounded-full ${c.v ? "bg-ok" : "bg-bad"}`} />
                    <span className="text-mute">{c.k}</span>
                    <span className={`mono text-[10.5px] ml-auto ${c.v ? "text-ok" : "text-bad"}`}>
                      {c.v ? "True" : "False"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "Summary" && explain.model && (
          <div className="px-4 pt-4">
            <ExplainCard
              model={explain.model}
              checkedAt={explain.checkedAt}
              onRetry={explain.retry}
              focusNonce={explainNonce}
              ownsPods={false}
              links={[
                { label: "Open Logs", onClick: () => setTab("Logs") },
                { label: "Open Events", onClick: () => setTab("Events") },
                ...(onOpenProblems ? [{ label: "See in Problems", onClick: onOpenProblems }] : []),
              ]}
            />
          </div>
        )}
        {tab === "Summary" && <SummaryTab pod={pod} />}
        {tab === "Summary" && (
          <div className="px-4 pb-4">
            <ConstraintsSection
              context={context}
              kind="pods"
              namespace={pod.namespace}
              name={pod.name}
              pod={constraintPod}
              onOpen={(k, ns, n) => onNavigate?.(k, ns, n)}
            />
            {onOpenMap && (
              <div className="mt-4">
                <WhoCanReachSection context={context} namespace={pod.namespace} podName={pod.name} onShowOnMap={() => onOpenMap(pod.namespace, pod.name)} />
              </div>
            )}
          </div>
        )}
        {tab === "Summary" && (
          <FieldManagers context={context} namespace={pod.namespace} kind="pods" kindLabel="Pod" name={pod.name} />
        )}

        {tab === "Containers" && (
          <div className="p-4 flex flex-col gap-2.5">
            {containers.map((c, i) => {
              // containers_status prefixes init container names with "init:" —
              // bridge the prefix so init containers resolve their restart history.
              const statusName = c.is_init ? `init:${c.name}` : c.name;
              const cs: ContainerStatus | undefined = pod.containers_status?.find((s) => s.name === statusName);
              const hasHistory = cs != null && (cs.restart_count > 0 || cs.last_state != null);
              // Section header: emitted before the first container of each group.
              const isFirstInit = c.is_init && (i === 0 || !containers[i - 1].is_init);
              const isFirstRegular = !c.is_init && (i === 0 || containers[i - 1].is_init);
              const exitCodeColor = cs?.last_exit_code === 0
                ? "text-ok"
                : cs?.last_exit_code === 137
                ? "text-bad"
                : cs?.last_exit_code != null && cs.last_exit_code > 0
                ? "text-warn"
                : "text-mute";
              const reasonIsNonTerminal = !cs?.last_reason || cs.last_reason === "Completed";
              return (
                <Fragment key={i}>
                {isFirstInit && (
                  <div className="text-[10px] uppercase tracking-wider text-dim font-semibold flex items-center gap-1.5">
                    Init Containers
                    <span className="text-[9.5px] text-mute normal-case tracking-normal">— run to completion before app containers start</span>
                  </div>
                )}
                {isFirstRegular && containers.some((x) => x.is_init) && (
                  <div className="text-[10px] uppercase tracking-wider text-dim font-semibold mt-1">
                    Containers
                  </div>
                )}
                <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${c.ready ? "bg-ok" : "bg-bad"}`} />
                    <span className="mono text-[12.5px]">{c.name}</span>
                    {c.is_init && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-accent/10 ring-1 ring-accent/20 text-accent">
                        init
                      </span>
                    )}
                    <span className="ml-auto text-[10.5px] uppercase tracking-wider text-dim">{c.status}</span>
                  </div>
                  <div className="mono text-[11px] text-dim mt-1 truncate">{c.image}</div>
                  {c.ports.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      {c.ports.map((p) => (
                        <span key={p} className="mono text-[10px] px-1.5 py-0.5 rounded-sm bg-accent/10 ring-1 ring-accent/20 text-accent">
                          :{p}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-col gap-1">
                    {(() => {
                      const containerMetric = podMetrics?.containers.find(m => m.name === c.name);
                      return (
                        <>
                          <DualZoneBar
                            label="CPU"
                            usageM={containerMetric?.cpu_millicores ?? null}
                            requestM={c.cpu_request_m ?? pod.cpu_m}
                            limitM={c.cpu_limit_m ?? pod.cpu_lim}
                            unitSuffix="m"
                          />
                          <DualZoneBar
                            label="Memory"
                            usageM={containerMetric?.memory_mib ?? null}
                            requestM={c.mem_request_mi ?? pod.mem_mi}
                            limitM={c.mem_limit_mi ?? pod.mem_lim}
                            unitSuffix="Mi"
                          />
                        </>
                      );
                    })()}
                    {!c.is_init && !c.is_debug && (
                      <SizingHint
                        container={c}
                        cpu={containerCpuHistory?.get(containerKey(pod.namespace, pod.name, c.name))}
                        mem={containerMemHistory?.get(containerKey(pod.namespace, pod.name, c.name))}
                        metricsAbsent={metricsAbsent}
                        p95={p95Hints(c, c.name, p95Cpu, p95Mem)}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-[11px] text-mute">
                    <span>restarts <span className="mono text-ink">{c.restart_count}</span></span>
                    <span className="text-edge2">·</span>
                    <button
                      onClick={() => { if (shellReason) return; setSelectedContainer(c.name); setTab("Shell"); }}
                      {...disabledAttrs(shellReason)}
                      className={`hover:text-ink flex items-center gap-1 ${shellReason ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Terminal size={11} />exec
                    </button>
                    <button onClick={() => setTab("Logs")} className="hover:text-ink flex items-center gap-1">
                      <FileCode size={11} />logs
                    </button>
                  </div>
                  {hasHistory && (
                    <div className="mt-3 border-t border-edge-raw/60 pt-3">
                      <div className="text-[10px] uppercase tracking-wider text-dim font-semibold mb-2">Restart History</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div>
                          <div className="text-[9.5px] uppercase tracking-wider text-dim mb-1">Current State</div>
                          <span className={`mono text-[11px] ${cs?.current_state === "running" ? "text-ok" : cs?.current_state === "terminated" ? "text-bad" : "text-warn"}`}>
                            {cs?.current_state ?? c.status}
                          </span>
                          {cs?.current_started_at && (
                            <div className="mono text-[10px] text-dim mt-0.5">{cs.current_started_at}</div>
                          )}
                          {cs?.current_reason && (
                            <span className="mt-1 inline-block mono text-[10px] px-1.5 py-0.5 rounded-sm bg-warn/10 ring-1 ring-warn/20 text-warn">
                              {cs.current_reason}
                            </span>
                          )}
                        </div>
                        {cs?.last_state && (
                          <div>
                            <div className="text-[9.5px] uppercase tracking-wider text-dim mb-1">Last State</div>
                            <span className="mono text-[11px] text-bad">{cs.last_state}</span>
                            {cs.last_finished_at && (
                              <div className={`mono text-[10px] mt-0.5 ${reasonIsNonTerminal ? "text-dim" : "text-warn"}`}>
                                {reasonIsNonTerminal ? cs.last_finished_at : `Last crash: ${cs.last_finished_at}`}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {cs.last_reason && (
                                <span title={
                                  cs.last_reason === "OOMKilled" ? "Pod hit memory limit (exit 137)" :
                                  cs.last_reason === "Error" ? "Application process crashed" :
                                  cs.last_reason === "Completed" ? "Graceful exit (exit 0)" :
                                  cs.last_reason === "ContainerCannotRun" ? "Image or command issue" :
                                  cs.last_reason === "DeadlineExceeded" ? "activeDeadlineSeconds exceeded" :
                                  cs.last_reason
                                } className={`mono text-[10px] px-1.5 py-0.5 rounded ring-1 ${
                                  reasonIsNonTerminal
                                    ? "bg-ok/10 ring-ok/20 text-ok"
                                    : cs.last_exit_code === 137
                                    ? "bg-bad/10 ring-bad/20 text-bad"
                                    : "bg-warn/10 ring-warn/20 text-warn"
                                }`}>
                                  {cs.last_reason}
                                </span>
                              )}
                              {cs.last_exit_code != null && (
                                <span className={`mono text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-tint/4 ring-1 ring-edge ${exitCodeColor}`}>
                                  exit {cs.last_exit_code}
                                </span>
                              )}
                              {cs.last_signal != null && cs.last_signal !== 0 && (
                                <span className="mono text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-tint/4 ring-1 ring-edge text-dim">
                                  sig {cs.last_signal}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ENV accordion */}
                  {((c.env?.length ?? 0) + (c.env_from?.length ?? 0)) > 0 && (
                    <>
                      <AccordionHeader
                        containerName={c.name}
                        section="env"
                        label="ENV"
                        count={(c.env?.length ?? 0) + (c.env_from?.length ?? 0)}
                      />
                      {isOpen(c.name, 'env') && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {c.env_from?.map((ef: ContainerEnvFrom, i: number) => {
                            const isNavigable = (ef.source_type === 'configmap' || ef.source_type === 'secret') && !!onNavigate;
                            const badgeClass = ef.source_type === 'configmap'
                              ? 'bg-info/10 ring-1 ring-info/20 text-info'
                              : 'bg-warn/10 ring-1 ring-warn/20 text-warn';

                            const rowContent = (
                              <>
                                <span className="text-dim/50 shrink-0 text-[10px]">⊞</span>
                                <span className={`mono flex-1 min-w-0 truncate transition-colors ${
                                  isNavigable
                                    ? 'text-accent/80 group-hover:text-accent group-hover:underline'
                                    : 'text-ink'
                                }`}>
                                  {ef.name}
                                </span>
                                {isNavigable && (
                                  <ArrowUpRight
                                    size={12}
                                    className="text-dim opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
                                    aria-hidden="true"
                                  />
                                )}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-sm shrink-0 ${badgeClass}`}>
                                  {ef.source_type === 'configmap' ? 'CM' : 'S'}
                                </span>
                                {ef.prefix && (
                                  <span className="text-dim/60 text-[10px] truncate max-w-[80px]">{ef.prefix}</span>
                                )}
                              </>
                            );

                            return isNavigable ? (
                              <button
                                key={i}
                                onClick={() => onNavigate!(
                                  ef.source_type === 'configmap' ? 'cm' : 'sec',
                                  pod.namespace,
                                  ef.name
                                )}
                                aria-label={`Open ${ef.source_type === 'configmap' ? 'ConfigMap' : 'Secret'} ${ef.name}`}
                                className="w-full flex items-center gap-2 py-0.5 px-0.5 rounded-xs text-[11px] text-left
                                           hover:bg-surface-tint/6 focus-visible:outline-hidden focus-visible:ring-1
                                           focus-visible:ring-accent/40 transition-colors group cursor-pointer"
                              >
                                {rowContent}
                              </button>
                            ) : (
                              <div key={i} className="flex items-center gap-2 py-0.5 text-[11px]">
                                {rowContent}
                              </div>
                            );
                          })}
                          {(c.env_from?.length ?? 0) > 0 && (c.env?.length ?? 0) > 0 && (
                            <hr className="border-edge-raw/30 my-1" />
                          )}
                          {c.env?.map((ev: ContainerEnvVar, i: number) => (
                            <div key={i} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                              <span className="mono text-ink shrink-0 w-[40%] truncate" title={ev.name}>{ev.name}</span>
                              {ev.value_from ? (
                                <>
                                  {(ev.value_from.source_type === 'configmap' || ev.value_from.source_type === 'secret') && onNavigate ? (
                                    <button
                                      onClick={() => onNavigate!(
                                        ev.value_from!.source_type === 'configmap' ? 'cm' : 'sec',
                                        pod.namespace,
                                        ev.value_from!.name ?? ''
                                      )}
                                      aria-label={`Open ${ev.value_from.source_type === 'configmap' ? 'ConfigMap' : 'Secret'} ${ev.value_from.name}`}
                                      className="flex items-center gap-1.5 flex-1 min-w-0 rounded-xs px-1 py-0.5
                                                 hover:bg-surface-tint/6 focus-visible:outline-hidden focus-visible:ring-1
                                                 focus-visible:ring-accent/40 transition-colors group cursor-pointer"
                                    >
                                      <span className="mono text-accent/70 group-hover:text-accent group-hover:underline
                                                       flex-1 truncate text-[10.5px] italic transition-colors">
                                        {ev.value_from.name}/{ev.value_from.key}
                                      </span>
                                      <ArrowUpRight
                                        size={12}
                                        className="text-dim opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
                                        aria-hidden="true"
                                      />
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                        ev.value_from.source_type === 'configmap'
                                          ? 'bg-info/10 ring-1 ring-info/20 text-info'
                                          : 'bg-warn/10 ring-1 ring-warn/20 text-warn'
                                      }`}>
                                        {ev.value_from.source_type === 'configmap' ? 'CM' : 'S'}
                                      </span>
                                    </button>
                                  ) : (
                                    <>
                                      <span className="mono text-dim/60 flex-1 truncate text-[10.5px] italic">
                                        {ev.value_from.source_type === 'fieldRef'
                                          ? `(fieldRef: ${ev.value_from.field_path})`
                                          : ev.value_from.source_type === 'resourceField'
                                          ? `(resourceField: ${ev.value_from.key})`
                                          : `${ev.value_from.name}/${ev.value_from.key}`}
                                      </span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                        ev.value_from.source_type === 'configmap'
                                          ? 'bg-info/10 ring-1 ring-info/20 text-info'
                                          : ev.value_from.source_type === 'secret'
                                          ? 'bg-warn/10 ring-1 ring-warn/20 text-warn'
                                          : 'bg-surface-tint/5 ring-1 ring-edge text-dim'
                                      }`}>
                                        {ev.value_from.source_type === 'configmap' ? 'CM'
                                         : ev.value_from.source_type === 'secret' ? 'S'
                                         : ev.value_from.source_type === 'fieldRef' ? 'field'
                                         : 'res'}
                                      </span>
                                    </>
                                  )}
                                </>
                              ) : (
                                <span className="mono text-dim flex-1 truncate">{ev.value ?? ''}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* MOUNTS accordion */}
                  {(c.volume_mounts?.length ?? 0) > 0 && (
                    <>
                      <AccordionHeader
                        containerName={c.name}
                        section="mounts"
                        label="MOUNTS"
                        count={c.volume_mounts!.length}
                      />
                      {isOpen(c.name, 'mounts') && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {c.volume_mounts?.map((vm: ContainerVolumeMount, i: number) => (
                            <div key={i} className="flex items-center gap-2 py-0.5 text-[11px]">
                              <span className="mono text-ink flex-1 min-w-0 truncate" title={vm.mount_path}>
                                {vm.mount_path}
                              </span>
                              <span className="mono text-dim/70 w-[110px] shrink-0 truncate text-right" title={vm.name}>
                                {vm.name}
                              </span>
                              {vm.read_only && (
                                <span className="text-[9px] uppercase tracking-wider text-warn/80 bg-warn/10 ring-1 ring-warn/20 px-1 rounded-sm shrink-0">
                                  ro
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* PROBES accordion */}
                  {c.probes !== undefined && (
                    <>
                      <AccordionHeader
                        containerName={c.name}
                        section="probes"
                        label="PROBES"
                        count={[c.probes?.liveness, c.probes?.readiness, c.probes?.startup].filter(Boolean).length}
                      />
                      {isOpen(c.name, 'probes') && (
                        <div className="mt-1 flex flex-col gap-1.5">
                          {(['liveness', 'readiness', 'startup'] as const).map((probeKey) => {
                            const probe: ContainerProbe | undefined = c.probes?.[probeKey];
                            const kindLabel =
                              probeKey === 'liveness'  ? 'Liveness'  :
                              probeKey === 'readiness' ? 'Readiness' :
                                                         'Startup';

                            const typeLabelMap: Record<string, string> = {
                              httpGet:   'HTTP GET',
                              tcpSocket: 'TCP',
                              exec:      'EXEC',
                              grpc:      'gRPC',
                            };
                            const typeLabel = probe ? (typeLabelMap[probe.probe_type] ?? 'Unknown') : null;

                            const probeTarget = (() => {
                              if (!probe) return null;
                              switch (probe.probe_type) {
                                case 'exec':
                                  return (probe.command ?? []).join(' ');
                                case 'httpGet':
                                  return `${probe.path ?? '/'}:${probe.port ?? ''}`;
                                case 'tcpSocket':
                                  return probe.host
                                    ? `port ${probe.port ?? ''}  (${probe.host})`
                                    : `port ${probe.port ?? ''}`;
                                case 'grpc':
                                  return probe.grpc_service
                                    ? `port ${probe.port ?? ''} · ${probe.grpc_service}`
                                    : `port ${probe.port ?? ''}`;
                                default:
                                  return probe.port ? `port ${probe.port}` : '—';
                              }
                            })();

                            const initialDelay = probe?.initial_delay_seconds ?? 0;
                            const period       = probe?.period_seconds        ?? 10;
                            const timeout      = probe?.timeout_seconds       ?? 1;
                            const failAfter    = probe?.failure_threshold     ?? 3;
                            const succeedAfter = probe?.success_threshold     ?? 1;

                            return (
                              <div
                                key={probeKey}
                                className={`rounded-md px-2.5 py-2 flex flex-col gap-1 border ${
                                  probe
                                    ? 'border-edge-raw/40 bg-surface-tint/2'
                                    : 'border-edge-raw/20 bg-transparent'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[12px] font-medium text-ink leading-none">
                                    {kindLabel}
                                  </span>
                                  {probe && typeLabel ? (
                                    <span className="bg-surface-tint/5 ring-1 ring-edge-raw/60 text-mute text-[10px] px-1.5 py-[2px] rounded-sm mono leading-none shrink-0">
                                      {typeLabel}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-dim italic">
                                      Not configured
                                    </span>
                                  )}
                                </div>

                                {probe && (
                                  <>
                                    <div
                                      className="mono text-[11px] text-mute truncate leading-snug"
                                      title={probeTarget ?? undefined}
                                    >
                                      {probeTarget}
                                    </div>

                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                      <TimingChip label="initial"       value={`${initialDelay}s`} />
                                      <TimingChip label="every"         value={`${period}s`}       />
                                      <TimingChip label="timeout"       value={`${timeout}s`}      />
                                      <TimingChip label="fail after"    value={`${failAfter} ${failAfter === 1 ? 'time' : 'times'}`}    />
                                      <TimingChip label="success after" value={`${succeedAfter} ${succeedAfter === 1 ? 'time' : 'times'}`} />
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
                </Fragment>
              );
            })}
            {(debugContainers?.length ?? 0) > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-dim font-semibold mt-1">Debug Containers</div>
                {debugContainers!.map((e) => (
                  <div key={e.name} className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[12.5px]">{e.name}</span>
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-surface-tint/6 ring-1 ring-edge text-mute">debug</span>
                      <span className="ml-auto text-[10.5px] uppercase tracking-wider text-dim">{e.state}</span>
                    </div>
                    <div className="mono text-[11px] text-dim mt-1 truncate">{e.image}</div>
                    <div className="text-[11px] text-mute mt-1">
                      {e.target_container ? `target: ${e.target_container}` : "no target"}
                      {e.reason ? ` · ${e.reason}` : ""}
                      {e.state === "terminated" && e.exit_code !== null ? ` · exit ${e.exit_code}` : ""}
                    </div>
                    {e.message && <div className="mono text-[10.5px] text-dim mt-1 wrap-break-word">{e.message}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === "Events" && (
          <div className="p-4 flex flex-col gap-1">
            {eventsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-2.5 py-2 border-b border-edge-raw/60">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-surface-tint/4 animate-pulse shrink-0" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-32" />
                    <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-full" />
                  </div>
                </div>
              ))
            ) : podEvents.length === 0 ? (
              <p className="py-12 text-center text-[13px] text-dim">No events found</p>
            ) : (
              podEvents.map((e, i) => (
                <div key={i} className="flex gap-2.5 py-2 border-b border-edge-raw/60 last:border-b-0">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${e.type_ === "Warning" ? "bg-warn" : "bg-mute/60"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[11px] font-semibold ${e.type_ === "Warning" ? "text-warn" : "text-mute"}`}>
                        {e.reason}
                      </span>
                      <span className="mono text-[10.5px] text-dim">{e.source}</span>
                      <span className="ml-auto mono text-[10.5px] text-dim">{e.age}</span>
                    </div>
                    <div className="text-[11.5px] text-ink/85 mt-0.5">{e.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "Logs" && (
          <LogViewer
            context={context}
            namespace={pod.namespace}
            podName={pod.name}
            containers={logContainers}
            containersStatus={pod.containers_status}
            defaultContainer={pod.default_container}
            pick={logPick}
            onPick={setLogPick}
            view={logView}
            onViewChange={setLogView}
          />
        )}

        {tab === "Shell" && (
          <ShellTab
            pod={pod}
            context={context}
            selectable={podSelectable}
            shellContainer={shellContainer}
            onPickContainer={setSelectedContainer}
            shellReason={shellReason}
            clusterLabel={identity.label}
            dbg={dbg}
            noShell={shellFailure && isNoShellError(shellFailure) ? shellFailure : null}
            onShellFailure={setShellFailure}
          />
        )}

        {tab === "YAML" && (
          <div className="p-3 flex flex-col gap-2">
            {yamlSkeleton ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse"
                    style={{ width: `${40 + (i % 3) * 20}%` }}
                  />
                ))}
              </div>
            ) : editMode ? (
              <>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-warn mono">Editing — changes apply to the cluster</span>
                  <div className="flex-1" />
                  <NeatChip on={neat} onToggle={toggleNeat} editing />
                  <button
                    onClick={() => { setEditMode(false); }}
                    className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono"
                  >
                    cancel
                  </button>
                  <button
                    disabled={applyResource.isPending}
                    onClick={() => { if (yamlReason) return; setConfirmSave(true); }}
                    {...disabledAttrs(yamlReason)}
                    className={`h-6 px-2 rounded-sm bg-accent/20 ring-1 ring-accent/40 text-[10.5px] text-accent hover:bg-accent/30 mono flex items-center gap-1.5 disabled:opacity-50 ${yamlReason ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <SaveIcon /> Review &amp; save…
                  </button>
                </div>
                {confirmSave && (
                  <YamlSaveGate
                    context={context}
                    namespace={pod.namespace}
                    resourceType="pods"
                    name={pod.name}
                    kindLabel="Pod"
                    yaml={editContent}
                    hasForm={false}
                    onOpenForm={() => {}}
                    onClose={() => setConfirmSave(false)}
                    onSaved={() => { setConfirmSave(false); setEditMode(false); }}
                  />
                )}
                <NeatNote hidden={[]} editing />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => {
                    // ⌘S / Ctrl+S opens the review gate; it never saves by itself.
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      if (!yamlReason && !applyResource.isPending) { setConfirmSave(true); }
                    }
                  }}
                  spellCheck={false}
                  className="mono text-[11px] leading-[1.6] rounded-lg p-3 ring-1 ring-accent/40 resize-none focus:outline-hidden min-h-[60vh] bg-surface-sunken"
                />
              </>
            ) : (
              <div className="flex flex-col gap-2 min-w-0">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <NeatChip on={neat} onToggle={toggleNeat} editing={false} />
                  <button
                    onClick={() => navigator.clipboard.writeText(shownYaml)}
                    title={neatShown ? "Copies the neat YAML, without the hidden fields." : undefined}
                    className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono"
                  >
                    {neatShown ? "copy neat" : "copy"}
                  </button>
                  <button
                    onClick={() => { if (yamlReason) return; setEditContent(yamlContent); setEditMode(true); }}
                    {...disabledAttrs(yamlReason)}
                    className={`h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono flex items-center gap-1 disabled:opacity-50 ${yamlReason ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <SaveIcon /> edit
                  </button>
                </div>
                {neat && (
                  <div className="min-w-0">
                    <NeatNote
                      hidden={neatQuery.data?.hidden ?? []}
                      editing={false}
                      error={neatQuery.error ? ((neatQuery.error as any)?.message ?? String(neatQuery.error)) : undefined}
                    />
                  </div>
                )}
                <pre className="mono text-[11px] leading-[1.6] rounded-lg p-3 ring-1 ring-edge overflow-auto bg-surface-sunken">
                  {shownYaml}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === "Metrics" && (
          <MetricsTab
            pod={pod}
            context={context}
            podMetrics={podMetrics}
            isLoading={metricsLoading}
            error={metricsError}
          />
        )}

        {tab === "Forward" && (
          <PodPortForward pod={pod} context={context} />
        )}
      </div>
      {dbg.dialogOpen && (
        <DebugContainerDialog
          pod={dbg.pod}
          context={context}
          onClose={dbg.closeDialog}
          onStarted={(started) => dbg.started({ ...started, startedAt: Date.now() })}
        />
      )}
    </aside>
  );
}
