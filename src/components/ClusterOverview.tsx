import { memo } from "react";
import { Server, Activity } from "lucide-react";
import type { ClusterInfo } from "../types/k8s";

const MetricCard = memo(function MetricCard({ icon, label, value, unit, sub, accent = "text-ink" }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  sub: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline px-3 py-2.5 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-1.5 text-mute">
        <span className="text-dim">{icon}</span>
        <span className="text-[10.5px] font-medium tracking-wide uppercase">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[22px] font-semibold tracking-tight tabular-nums ${accent}`}>
          {value}
        </span>
        <span className="text-[11.5px] text-mute mono">{unit}</span>
      </div>
      <span className="text-[11px] text-dim">{sub}</span>
    </div>
  );
});

function MemIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="1"/>
      <path d="M6 10v4"/><path d="M10 10v4"/><path d="M14 10v4"/><path d="M18 10v4"/>
    </svg>
  );
}

interface Props {
  clusterInfo?: ClusterInfo;
  /** "Open Problems" link on the Problem pods card (X12). No number: it can't disagree with the card. */
  onOpenProblems?: () => void;
}

export const ClusterOverview = memo(function ClusterOverview({ clusterInfo, onOpenProblems }: Props) {
  if (!clusterInfo) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl bg-card/70 ring-1 ring-edge px-3 py-2.5 flex flex-col gap-1.5">
            <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-20" />
            <div className="h-6 rounded-sm bg-surface-tint/4 animate-pulse w-14 mt-1" />
            <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-28" />
          </div>
        ))}
      </div>
    );
  }

  const { total_nodes, ready_nodes, total_pods, running_pods, pending_pods, failed_pods, terminating_pods, crash_loop_pods } = clusterInfo;
  const problemPods = crash_loop_pods + failed_pods;
  const inflightPods = pending_pods + terminating_pods;
  const nodesHealthy = ready_nodes === total_nodes;

  return (
    <div className="grid grid-cols-4 gap-3">
      <MetricCard
        icon={<Server size={13} />}
        label="Nodes ready"
        value={String(ready_nodes)}
        unit={`/ ${total_nodes}`}
        sub={nodesHealthy
          ? <span className="text-ok">All nodes healthy</span>
          : <span className="text-warn">{total_nodes - ready_nodes} not ready</span>
        }
        accent="text-ok"
      />
      <MetricCard
        icon={<Activity size={13} />}
        label="Pods running"
        value={String(running_pods)}
        unit={`/ ${total_pods}`}
        sub={<span>{total_pods - running_pods} not running</span>}
        accent="text-status-progress"
      />
      <MetricCard
        icon={<MemIcon size={13} />}
        label="Problem pods"
        value={String(problemPods)}
        unit="pods"
        sub={
          <span className="flex flex-col gap-0.5">
            <span>
              {crash_loop_pods > 0 && <span className="text-bad">{crash_loop_pods} CrashLoop</span>}
              {crash_loop_pods > 0 && failed_pods > 0 && " · "}
              {failed_pods > 0 && <span className="text-bad">{failed_pods} Failed</span>}
              {problemPods === 0 && <span className="text-dim">No CrashLoop or Failed pods</span>}
            </span>
            {onOpenProblems && (
              <button type="button" onClick={onOpenProblems} className="self-start min-h-6 inline-flex items-center rounded-sm text-mute hover:text-ink hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-accent/60">
                Open Problems →
              </button>
            )}
          </span>
        }
        accent={problemPods > 0 ? "text-bad" : "text-ok"}
      />
      <MetricCard
        icon={<Activity size={13} />}
        label="In-flight"
        value={String(inflightPods)}
        unit="pods"
        sub={
          <span>
            {pending_pods > 0 && <span className="text-warn">{pending_pods} Pending</span>}
            {pending_pods > 0 && terminating_pods > 0 && " · "}
            {terminating_pods > 0 && <span className="text-purple">{terminating_pods} Terminating</span>}
            {inflightPods === 0 && <span className="text-dim">None</span>}
          </span>
        }
        accent={inflightPods > 0 ? "text-warn" : "text-dim"}
      />
    </div>
  );
});
