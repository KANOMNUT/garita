import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { ChevronDown, ChevronUp, Filter, ArrowUpDown, Boxes, Trash2, X, Copy, RotateCcw } from "lucide-react";
import type { Pod, PodStatus } from "../types/k8s";
import { useDeletePod, useBulkDeletePods, usePermissions } from "../hooks/useResources";
import { Sparkline } from "./Sparkline";
import { ConfirmModal } from "./ConfirmModal";
import { ReadOnlyStrip } from "./ReadOnlyBadge";
import { useClusterIdentity, type IdentityRole } from "../utils/clusterIdentity";
import { checkBulk, disabledAttrs, pickDisabledReason, READ_ONLY_REASON_SHORT } from "../utils/guardrails";
import { deletePodsByNamespaceEquiv, deletePodsEquiv } from "../utils/kubectlEquiv";
import { podStatusStyle } from "../utils/podStatus";
import { barDenominator, displayedUsage, isNotReady, statusCounts, usageLabel } from "../utils/podTableView";
import { useCopyFeedback, type CopyState } from "../hooks/useCopyFeedback";
import { Popover } from "./Popover";

// The one focus-visible ring of the app's controls (docs/ux/24 X-8: at least 3:1 against the panel in both themes).
const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70";
// The same ring for a row inside a menu: inset, so the panel's rounded edge does not clip it.
const ITEM_RING = "outline-hidden focus-visible:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70";

const StatusPill = memo(function StatusPill({ status }: { status: string }) {
  const s = podStatusStyle(status);
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
});

const Bar = memo(function Bar({ value, limit, color = "bg-metric-cpu", label, requestPct }: {
  value: number;
  /** The denominator. Null draws the number alone: there is no limit and nothing honest to compare it with. */
  limit: number | null;
  color?: string;
  label: string;
  requestPct?: number;
}) {
  if (limit == null) {
    return (
      <div className="flex items-center gap-2">
        {/* Keeps the number in the column where the bars put it. */}
        <span aria-hidden className="shrink-0" style={{ width: 72 }} />
        <span className="mono text-[11px] text-mute tabular-nums whitespace-nowrap" style={{ minWidth: 56 }}>{label}</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((value / (limit || 1)) * 100));
  const tone = pct >= 85 ? "bg-bar-high" : pct >= 65 ? "bg-bar-mid" : color;
  return (
    <div className="flex items-center gap-2">
      <div className="relative rounded-xs overflow-hidden bg-surface-tint/4" style={{ width: 72, height: 5 }}>
        <div className={`h-full rounded-xs ${tone}`} style={{ width: `${pct}%` }} />
        {requestPct != null && requestPct > 0 && requestPct < 100 && (
          <div
            className="absolute inset-y-0 w-px bg-surface-tint/40"
            style={{ left: `${requestPct}%` }}
          />
        )}
      </div>
      <span className="mono text-[11px] text-mute tabular-nums whitespace-nowrap" style={{ minWidth: 56 }}>{label}</span>
    </div>
  );
});

// ─── Sort ────────────────────────────────────────────────────────────────────

type SortField = "name" | "namespace" | "status" | "restarts" | "age" | "node" | "cpu" | "memory";
type SortDir   = "asc" | "desc";

function parseAge(age: string): number {
  let s = 0;
  const d = /(\d+)d/.exec(age);   if (d)   s += +d[1]   * 86400;
  const h = /(\d+)h/.exec(age);   if (h)   s += +h[1]   * 3600;
  const m = /(\d+)m/.exec(age);   if (m)   s += +m[1]   * 60;
  const sec = /(\d+)s/.exec(age); if (sec) s += +sec[1];
  return s;
}

const SORT_OPTIONS: { field: SortField; dir: SortDir; label: string }[] = [
  { field: "name",      dir: "asc",  label: "Name  A → Z" },
  { field: "name",      dir: "desc", label: "Name  Z → A" },
  { field: "namespace", dir: "asc",  label: "Namespace  A → Z" },
  { field: "namespace", dir: "desc", label: "Namespace  Z → A" },
  { field: "status",    dir: "asc",  label: "Status  A → Z" },
  { field: "status",    dir: "desc", label: "Status  Z → A" },
  { field: "restarts",  dir: "desc", label: "Restarts  most first" },
  { field: "restarts",  dir: "asc",  label: "Restarts  least first" },
  { field: "age",       dir: "asc",  label: "Age  newest first" },
  { field: "age",       dir: "desc", label: "Age  oldest first" },
  { field: "node",      dir: "asc",  label: "Node  A → Z" },
  { field: "node",      dir: "desc", label: "Node  Z → A" },
  { field: "cpu",       dir: "desc", label: "CPU  most first" },
  { field: "cpu",       dir: "asc",  label: "CPU  least first" },
  { field: "memory",    dir: "desc", label: "Memory  most first" },
  { field: "memory",    dir: "asc",  label: "Memory  least first" },
];

// ─── FiltersBar ──────────────────────────────────────────────────────────────

const STATUSES: PodStatus[] = ["All", "Running", "Pending", "CrashLoopBackOff", "ImagePullBackOff", "Terminating", "Failed"];

interface FiltersBarProps {
  ns: string;
  status: PodStatus;
  setStatus: (s: PodStatus) => void;
  /** Pods per status word after the label and search filters, before the status filter. */
  counts: Record<string, number>;
  count: number;
  total: number;
  search: string;
  sortField: SortField | null;
  sortDir: SortDir;
  onSort: (f: SortField, d: SortDir) => void;
  onClearSort: () => void;
  allLabels: { key: string; values: string[] }[];
  activeLabels: Record<string, string>;
  onToggleLabel: (key: string, value: string) => void;
  onClearLabels: () => void;
}

const FiltersBar = memo(function FiltersBar({
  ns, status, setStatus, counts, count, total, search,
  sortField, sortDir, onSort, onClearSort,
  allLabels, activeLabels, onToggleLabel, onClearLabels,
}: FiltersBarProps) {
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [sortOpen, setSortOpen]     = useState(false);
  const labelsBtnRef = useRef<HTMLButtonElement>(null);
  const sortBtnRef   = useRef<HTMLButtonElement>(null);

  const activeLabelCount = Object.keys(activeLabels).length;
  const activeSortLabel  = SORT_OPTIONS.find(o => o.field === sortField && o.dir === sortDir)?.label;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-1">
        <h2 className="text-[14px] font-semibold tracking-tight">Pods</h2>
        <span className="mono text-[11px] text-mute">
          {search || status !== "All" || activeLabelCount > 0 ? `${count} / ${total}` : `${total}`} in {ns === "all" ? "all namespaces" : ns}
        </span>
      </div>

      {/* Status tabs */}
      <div role="group" aria-label="Filter by status" className="flex items-center gap-1 bg-card/70 ring-1 ring-edge rounded-md p-0.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={`px-2 h-6 text-[11.5px] rounded ${FOCUS_RING} ${
              status === s ? "bg-surface-tint/8 text-ink ring-1 ring-edge-strong" : "text-mute hover:text-ink"
            }`}
          >
            {s}
            {s !== "All" && <span className="ml-1 mono text-[10.5px] tabular-nums text-mute">{counts[s] ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* Labels and Sort wrap as one group at the right edge of their row, so the right-0 menus open into the table. */}
      <div className="ml-auto flex items-center gap-2">
      {/* Labels dropdown */}
      <div className="relative">
        <button
          ref={labelsBtnRef}
          type="button"
          onClick={() => { setLabelsOpen(v => !v); setSortOpen(false); }}
          aria-haspopup="dialog"
          aria-expanded={labelsOpen}
          className={`h-7 px-2.5 rounded-md ring-1 text-[12px] flex items-center gap-1.5 transition-colors ${FOCUS_RING}
            ${activeLabelCount > 0
              ? "bg-accent/15 ring-accent/30 text-accent"
              : "bg-card/70 ring-edge text-mute hover:text-ink"
            }`}
        >
          <Filter size={12} aria-hidden />
          Labels
          {activeLabelCount > 0 && (
            <span className="bg-accent/25 text-accent text-[10.5px] px-1 rounded-sm font-bold">{activeLabelCount}</span>
          )}
        </button>

        <Popover open={labelsOpen} onClose={() => setLabelsOpen(false)} triggerRef={labelsBtnRef} label="Filter by label" className="right-0 top-9 w-72 py-2 max-h-80 overflow-y-auto">
            {allLabels.length === 0 ? (
              <p className="px-3 py-2 text-[11.5px] text-mute">No labels found on pods</p>
            ) : (
              <>
                {activeLabelCount > 0 && (
                  <div className="px-3 pb-2 mb-1 border-b border-edge-raw/50">
                    <button
                      type="button"
                      onClick={onClearLabels}
                      className={`text-[11px] text-mute hover:text-bad flex items-center gap-1 rounded-xs ${FOCUS_RING}`}
                    >
                      <X size={10} aria-hidden /> Clear all filters
                    </button>
                  </div>
                )}
                {allLabels.map(({ key, values }) => (
                  <div key={key} className="px-3 py-1.5">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-mute mb-1.5">{key}</p>
                    <div className="flex flex-wrap gap-1">
                      {values.map(v => {
                        const active = activeLabels[key] === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => onToggleLabel(key, v)}
                            aria-pressed={active}
                            className={`px-2 py-0.5 rounded mono text-[11px] ring-1 transition-colors ${FOCUS_RING}
                              ${active
                                ? "bg-accent/20 ring-accent/30 text-accent"
                                : "bg-card ring-edge text-mute hover:text-ink hover:bg-surface-tint/4"
                              }`}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
        </Popover>
      </div>

      {/* Sort dropdown */}
      <div className="relative">
        <button
          ref={sortBtnRef}
          type="button"
          onClick={() => { setSortOpen(v => !v); setLabelsOpen(false); }}
          aria-haspopup="dialog"
          aria-expanded={sortOpen}
          className={`h-7 px-2.5 rounded-md ring-1 text-[12px] flex items-center gap-1.5 transition-colors max-w-[200px] truncate ${FOCUS_RING}
            ${sortField
              ? "bg-accent/15 ring-accent/30 text-accent"
              : "bg-card/70 ring-edge text-mute hover:text-ink"
            }`}
        >
          <ArrowUpDown size={12} className="shrink-0" aria-hidden />
          <span className="truncate">{sortField ? activeSortLabel : "Sort"}</span>
        </button>

        <Popover open={sortOpen} onClose={() => setSortOpen(false)} triggerRef={sortBtnRef} label="Sort pods" className="right-0 top-9 w-52 py-1">
            {sortField && (
              <>
                <button
                  type="button"
                  onClick={() => { onClearSort(); setSortOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] text-mute hover:text-bad hover:bg-surface-tint/4 flex items-center gap-2 ${ITEM_RING}`}
                >
                  <X size={11} aria-hidden /> Clear sort
                </button>
                <div className="my-1 border-t border-edge-raw/50" />
              </>
            )}
            {SORT_OPTIONS.map(o => {
              const active = sortField === o.field && sortDir === o.dir;
              return (
                <button
                  key={`${o.field}-${o.dir}`}
                  type="button"
                  onClick={() => { onSort(o.field, o.dir); setSortOpen(false); }}
                  aria-pressed={active}
                  className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 ${ITEM_RING}
                    ${active ? "text-accent bg-accent/8" : "text-mute hover:text-ink hover:bg-surface-tint/4"}`}
                >
                  {active && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                  {!active && <span aria-hidden className="w-1.5 h-1.5 shrink-0" />}
                  {o.label}
                </button>
              );
            })}
        </Popover>
      </div>
      </div>
    </div>
  );
});

// ─── BulkActionBar ───────────────────────────────────────────────────────────

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onRestart: () => void;
  onCopyNames: () => void;
  /** Feedback for the last Copy names: the button label flips in place (X-6). */
  copyState: CopyState;
  isPending: boolean;
  multiNamespace: boolean;
  /** §3.4 can-i — pod delete permission for the current namespace filter. Both
   *  Delete and Restart gate on it (a pod "restart" is a delete + recreate by
   *  the owning workload). Disabled with a reason, never hidden. */
  canDelete: boolean;
  /** Read-only mode's reason (full sentence), when on. Buttons stay focusable (aria-disabled). */
  readOnlyReason?: string;
  /** G2 refusal text when the selection is over the cluster's bulk limit. */
  bulkMessage?: string | null;
}

const BulkActionBar = memo(function BulkActionBar({
  count, onClear, onDelete, onRestart, onCopyNames, copyState, isPending, multiNamespace, canDelete, readOnlyReason, bulkMessage,
}: BulkActionBarProps) {
  const copyLabel = copyState === "copied" ? `Copied ${count} name${count === 1 ? "" : "s"}` : copyState === "failed" ? "Couldn't copy" : "Copy names";
  const noPermTitle = canDelete ? undefined : "You don't have permission to delete pods";
  // DISABLE-PRECEDENCE: read-only, then the guardrail refusal. RBAC keeps its native disabled + title.
  const actionReason = pickDisabledReason({ readOnly: !!readOnlyReason, capability: bulkMessage ?? undefined });
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/[0.07] ring-1 ring-accent/25 flex-wrap">
      <span className="mono text-[12px] text-accent font-semibold shrink-0">{count} selected</span>
      <button
        type="button"
        onClick={onClear}
        className={`h-6 px-2 rounded-sm text-[11px] text-mute hover:text-ink flex items-center gap-1 bg-surface-tint/3 ring-1 ring-edge ${FOCUS_RING}`}
      >
        <X size={10} aria-hidden /> Clear
      </button>
      <div className="flex-1" />
      {multiNamespace && (
        <span className="text-[10.5px] text-warn">Cross-namespace selection. Delete and Restart are disabled.</span>
      )}
      {bulkMessage && !readOnlyReason && (
        <span className="text-[11px] text-mute basis-full order-last">{bulkMessage}</span>
      )}
      <button
        type="button"
        onClick={onCopyNames}
        className={`h-6 px-2.5 rounded-sm text-[11px] text-mute hover:text-ink flex items-center gap-1.5 bg-card/70 ring-1 ring-edge ${FOCUS_RING}`}
      >
        <Copy size={11} aria-hidden /> {copyLabel}
      </button>
      <span role="status" className="sr-only">{copyState === "idle" ? "" : copyLabel}</span>
      <button
        type="button"
        disabled={isPending || multiNamespace || !canDelete}
        onClick={() => { if (actionReason) return; onRestart(); }}
        title={noPermTitle}
        {...disabledAttrs(actionReason)}
        className={`h-6 px-2.5 rounded-sm text-[11px] text-mute hover:text-ink flex items-center gap-1.5 bg-card/70 ring-1 ring-edge disabled:opacity-40 ${FOCUS_RING} ${actionReason ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <RotateCcw size={11} aria-hidden /> Restart
      </button>
      <button
        type="button"
        disabled={isPending || multiNamespace || !canDelete}
        onClick={() => { if (actionReason) return; onDelete(); }}
        title={noPermTitle}
        {...disabledAttrs(actionReason)}
        className={`h-6 px-2.5 rounded-sm text-[11px] text-bad hover:bg-bad/10 flex items-center gap-1.5 bg-bad/5 ring-1 ring-bad/20 disabled:opacity-40 ${FOCUS_RING} ${actionReason ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <Trash2 size={11} aria-hidden /> Delete
      </button>
    </div>
  );
});

// ─── ConfirmBulkModal ─────────────────────────────────────────────────────────
// Rebuilt on ConfirmModal `md` (UXP-17): Esc, focus trap, ⌘↵, slots 6 and 7 and the typed
// guardrail now come from the shared dialog. Partial results use phase "result" with the
// failed list in the body.

interface ConfirmBulkModalProps {
  action: "delete" | "restart";
  pods: Pod[];
  context: string;
  contextLabel: string;
  contextColor: IdentityRole;
  bulkLimit: number | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  partialResult: { ok: number; failed: { name: string; error: string }[] } | null;
  error: string;
}

function ConfirmBulkModal({
  action, pods, context, contextLabel, contextColor, bulkLimit, onConfirm, onCancel, isPending, partialResult, error,
}: ConfirmBulkModalProps) {
  const n = pods.length;
  const plural = n !== 1 ? "s" : "";
  const verb = action === "delete" ? "Delete" : "Restart";
  const namespaces = [...new Set(pods.map((p) => p.namespace))];
  const sharedNs = namespaces.length === 1 ? namespaces[0] : null;
  const clusterLabel = contextLabel || context;
  // Above 10 pods: type the namespace — but only when every pod shares it. A selection
  // spanning namespaces types the cluster label instead (one typed field either way, D3-6).
  const typed = n > 10 ? (sharedNs ?? clusterLabel) : undefined;
  const bulk = checkBulk(n, bulkLimit, clusterLabel);
  const failed = partialResult && partialResult.failed.length > 0 ? partialResult : null;
  const nsText = sharedNs ? ` in namespace ${sharedNs}` : ` across ${namespaces.length} namespaces`;

  return (
    <ConfirmModal
      open
      size="md"
      destructive
      context={context}
      contextLabel={contextLabel}
      contextColor={contextColor}
      title={`${verb} ${n} pod${plural}`}
      description={
        <>
          {verb} {n} pod{plural}{nsText}.{" "}
          {action === "delete"
            ? "Their owning workload will recreate them if applicable."
            : "Each pod will be deleted and recreated by its owning workload."}
        </>
      }
      confirmLabel={`${verb} ${n} pod${plural}`}
      requireTyping={typed}
      requireTypingLabel={typed ? `Type ${typed} to confirm` : undefined}
      confirmDisabled={!bulk.ok || !!failed}
      confirmDisabledReason={bulk.message ?? undefined}
      notice={bulk.message ?? undefined}
      phase={failed ? "result" : error ? "error" : "review"}
      status={
        error
          ? { tone: "error", text: error }
          : failed
            ? { tone: "error", text: `${failed.ok} succeeded · ${failed.failed.length} failed` }
            : null
      }
      kubectlEquivalent={deletePodsByNamespaceEquiv({ context, pods })}
      footer={
        failed ? (
          <div className="flex justify-end">
            <button
              data-modal-cancel
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-[12.5px] text-mute ring-1 ring-edge hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              Close
            </button>
          </div>
        ) : undefined
      }
      isPending={isPending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="flex flex-col gap-1">
        {pods.map((p) => (
          <div key={`${p.namespace}/${p.name}`} className="flex items-center gap-2 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-bad shrink-0" />
            <span className="mono text-[11.5px] truncate">{p.name}</span>
            <span className="mono text-[10.5px] text-mute ml-auto shrink-0">{p.namespace}</span>
          </div>
        ))}
      </div>
      {failed && (
        <div className="mt-3 pt-3 border-t border-edge-raw/60 flex flex-col gap-1 max-h-28 overflow-y-auto">
          {failed.failed.map((f) => (
            <div key={f.name} className="mono text-[10.5px] text-bad">{f.name}: {f.error}</div>
          ))}
        </div>
      )}
    </ConfirmModal>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-edge-raw/70">
      {[28, 240, 100, 120, 50, 100, 60, 150, 150, 130].map((w, i) => (
        <td key={i} className="px-2 py-3 first:pl-3">
          <div className="h-3 rounded-sm bg-surface-tint/4 animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── PodRow ──────────────────────────────────────────────────────────────────

interface PodRowProps {
  pod: Pod;
  selected: boolean;
  setSelected: (p: Pod | null) => void;
  onDelete: (name: string, namespace: string) => void;
  bulkChecked: boolean;
  onBulkCheck: (pod: Pod, shiftHeld: boolean) => void;
  bulkActive: boolean;
  cpuHistory?: number[];
  memHistory?: number[];
  /** Short read-only reason for the row delete; the table strip carries the full explanation. */
  readOnlyReason?: string;
}

const PodRow = memo(function PodRow({ pod, selected, setSelected, onDelete, bulkChecked, onBulkCheck, bulkActive, cpuHistory, memHistory, readOnlyReason }: PodRowProps) {
  // The number is usage when metrics exist, else the pod's request (the label then says "req", POD-7). The bar never
  // uses an invented limit: see barDenominator.
  const cpu = displayedUsage(cpuHistory, pod.cpu_m);
  const mem = displayedUsage(memHistory, pod.mem_mi);
  const cpuDen = barDenominator(pod.cpu_lim, pod.cpu_m, cpu.fromMetrics ? "usage" : "request");
  const memDen = barDenominator(pod.mem_lim, pod.mem_mi, mem.fromMetrics ? "usage" : "request");
  const cpuReqPct = cpuDen ? Math.min(100, Math.round(((pod.cpu_m ?? 0) / cpuDen) * 100)) : 0;
  const memReqPct = memDen ? Math.min(100, Math.round(((pod.mem_mi ?? 0) / memDen) * 100)) : 0;
  const notReady = isNotReady(pod.status, pod.ready);

  // Read-only wins (DISABLE-PRECEDENCE); a bulk selection comes second (pods-logs.md: no single delete while selecting).
  const rowReason = readOnlyReason ?? (bulkActive ? "Clear the selection to delete a single pod." : undefined);
  // Exclusive strings: hidden until the row is hovered or any control in it has focus. With a reason the trash shows
  // dimmed, never in the enabled look (plan D9).
  const trashReveal = rowReason
    ? "opacity-0 group-hover:opacity-50 group-focus-within:opacity-50 focus-visible:opacity-50 cursor-not-allowed"
    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-bad hover:bg-bad/10";

  const crashReason = pod.containers_status?.find(
    (cs) => cs.restart_count > 0 && cs.last_reason && cs.last_reason !== "Completed"
  )?.last_reason;

  const handleClick  = useCallback(() => setSelected(pod), [pod, setSelected]);
  const handleDelete = useCallback(() => onDelete(pod.name, pod.namespace), [pod.name, pod.namespace, onDelete]);

  return (
    <tr
      onClick={handleClick}
      className={`group row-hover cursor-pointer border-b border-edge-raw/70 ${selected ? "row-selected" : ""}`}
    >
      <td className="pl-3 pr-1 py-2 align-middle" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={bulkChecked}
          aria-label={`Select pod ${pod.name}`}
          onClick={(e) => { e.stopPropagation(); onBulkCheck(pod, e.shiftKey); }}
          onChange={() => {}}
          className="w-3.5 h-3.5 accent-accent cursor-pointer"
        />
      </td>
      <td className="row-bar pl-2 pr-2 py-2 align-middle">
        {/* X-1: the one keyboard stop for the row. It has no handler: Enter and Space dispatch a click that bubbles to the <tr>. */}
        <button
          type="button"
          aria-current={selected ? "true" : undefined}
          title={pod.name}
          className="mono text-[12px] truncate block max-w-full text-left rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          {pod.name}
        </button>
      </td>
      <td className="px-2 py-2">
        <span className="mono text-[11.5px] text-mute">{pod.namespace}</span>
      </td>
      <td className="px-2 py-2">
        <StatusPill status={pod.status} />
      </td>
      <td
        className={`px-2 py-2 mono text-[11.5px] tabular-nums ${notReady ? "text-warn" : "text-mute"}`}
        title={notReady ? "Running but not ready" : undefined}
      >
        {pod.ready}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className={`mono text-[11.5px] tabular-nums ${
            pod.restarts >= 5 ? "text-bad" : pod.restarts >= 1 ? "text-warn" : "text-mute"
          }`}>{pod.restarts}</span>
          {crashReason && pod.restarts > 0 && (
            <span className={`mono text-[10.5px] px-1 py-px rounded ring-1 ${
              crashReason === "OOMKilled"
                ? "text-bad bg-bad/10 ring-bad/20"
                : "text-warn bg-warn/10 ring-warn/20"
            }`}>
              {crashReason}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-2 mono text-[11.5px] text-mute tabular-nums">{pod.age}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <Bar
            value={cpu.value}
            limit={cpuDen}
            color="bg-metric-cpu"
            label={usageLabel(cpu, "m")}
            requestPct={cpu.fromMetrics ? cpuReqPct : undefined}
          />
          {cpuHistory && cpuHistory.length >= 2 && (
            <Sparkline data={cpuHistory} colorClass="text-metric-cpu" width={44} height={14} />
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <Bar
            value={mem.value}
            limit={memDen}
            color="bg-metric-mem"
            label={usageLabel(mem, "Mi")}
            requestPct={mem.fromMetrics ? memReqPct : undefined}
          />
          {memHistory && memHistory.length >= 2 && (
            <Sparkline data={memHistory} colorClass="text-metric-mem" width={44} height={14} />
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        <span className="mono text-[11px] text-mute truncate inline-block max-w-[160px] align-middle">{pod.node}</span>
      </td>
      <td className="pr-3 pl-1 py-2 text-right">
        <button
          type="button"
          aria-label={`Delete pod ${pod.name}`}
          onClick={(e) => { e.stopPropagation(); if (rowReason) return; handleDelete(); }}
          {...(rowReason ? disabledAttrs(rowReason) : { title: `Delete pod ${pod.name}` })}
          className={`h-6 w-6 inline-flex items-center justify-center rounded-sm text-mute outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${trashReveal}`}
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </td>
    </tr>
  );
});

// ─── Th ──────────────────────────────────────────────────────────────────────

function Th({
  children, sortKey, activeSortField, activeSortDir, onSort, style, title,
}: {
  children?: React.ReactNode;
  sortKey?: SortField;
  activeSortField: SortField | null;
  activeSortDir: SortDir;
  onSort?: (f: SortField) => void;
  style?: React.CSSProperties;
  /** Tooltip for the header (what the column shows). */
  title?: string;
}) {
  const isActive = !!sortKey && activeSortField === sortKey;
  return (
    <th
      style={style}
      aria-sort={isActive ? (activeSortDir === "asc" ? "ascending" : "descending") : undefined}
      className={`sticky top-0 z-1 bg-panel/95 backdrop-blur-sm border-b border-edge text-left text-[10.5px] uppercase tracking-[0.06em] font-semibold py-2 px-2 first:pl-3 last:pr-3
        ${isActive ? "text-accent" : "text-mute"}`}
    >
      {sortKey ? (
        // The sort control is a button inside the header (X-5), so it is a keyboard stop and carries the column name.
        <button
          type="button"
          onClick={() => onSort?.(sortKey)}
          title={title}
          className={`flex items-center gap-1 rounded-xs uppercase tracking-[0.06em] font-semibold cursor-pointer select-none ${FOCUS_RING}`}
        >
          {children}
          {isActive
            ? (activeSortDir === "asc"
                ? <ChevronUp size={10} aria-hidden className="text-accent" />
                : <ChevronDown size={10} aria-hidden className="text-accent" />)
            : <ChevronDown size={10} aria-hidden className="opacity-30" />}
        </button>
      ) : (
        <div className="flex items-center gap-1" title={title}>{children}</div>
      )}
    </th>
  );
}

// ─── PodTable ────────────────────────────────────────────────────────────────

const USAGE_TITLE = "Usage from metrics-server. Shows the request when metrics are not available.";

interface PodTableProps {
  pods: Pod[];
  selected: Pod | null;
  setSelected: (p: Pod | null) => void;
  isLoading: boolean;
  error: Error | null;
  ns: string;
  onRetry: () => void;
  context: string;
  search: string;
  cpuHistory?: Map<string, number[]>;
  memHistory?: Map<string, number[]>;
}

export function PodTable({
  pods, selected, setSelected, isLoading, error, ns, onRetry, context, search,
  cpuHistory, memHistory,
}: PodTableProps) {
  const [status, setStatus]             = useState<PodStatus>("All");
  const [sortField, setSortField]       = useState<SortField | null>(null);
  const [sortDir, setSortDir]           = useState<SortDir>("asc");
  const [activeLabels, setActiveLabels] = useState<Record<string, string>>({});
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [lastChecked, setLastChecked]   = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"delete" | "restart" | null>(null);
  const [partialResult, setPartialResult] = useState<{ ok: number; failed: { name: string; error: string }[] } | null>(null);
  const [rowDeleteTarget, setRowDeleteTarget] = useState<{ name: string; namespace: string } | null>(null);
  const [rowDeleteError, setRowDeleteError] = useState("");
  const [bulkError, setBulkError] = useState("");

  const deletePod = useDeletePod();
  const bulkDelete = useBulkDeletePods();
  const identity = useClusterIdentity(context);
  // §3.4 can-i — ns is the active namespace filter, including the "all"
  // sentinel; usePermissions normalizes that to "" itself.
  const perm = usePermissions(context, ns, "pods");
  const bulkCheck = checkBulk(bulkSelected.size, identity.bulkLimit, identity.label || context);
  const copyNames = useCopyFeedback();

  // Clear bulk selection when filters change to avoid stale keys
  useEffect(() => {
    setBulkSelected(new Set());
    setLastChecked(null);
  }, [ns, status, search, JSON.stringify(activeLabels)]);

  const allLabels = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    pods.forEach(p => {
      Object.entries(p.labels ?? {}).forEach(([k, v]) => {
        if (!map[k]) map[k] = new Set();
        map[k].add(v);
      });
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, vs]) => ({ key, values: [...vs].sort() }));
  }, [pods]);

  // The label and search filters first: the status buttons count what is left after them (POD-6).
  const matched = useMemo(() => {
    let result = pods;

    if (Object.keys(activeLabels).length > 0) {
      result = result.filter(p =>
        Object.entries(activeLabels).every(([k, v]) => p.labels?.[k] === v)
      );
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) || p.namespace.toLowerCase().includes(q)
      );
    }

    return result;
  }, [pods, activeLabels, search]);

  const counts = useMemo(() => statusCounts(matched), [matched]);

  // CPU and Memory sort by the number the column shows: usage when metrics exist, else the request (POD-7).
  const shownUsage = useCallback((p: Pod, field: "cpu" | "memory") => field === "cpu"
    ? displayedUsage(cpuHistory?.get(`${p.namespace}/${p.name}`), p.cpu_m).value
    : displayedUsage(memHistory?.get(`${p.namespace}/${p.name}`), p.mem_mi).value,
  [cpuHistory, memHistory]);
  // The history maps are mutated in place, so their identity never changes when a new sample lands. While a usage
  // column is the sort key, this signature of the shown numbers is what makes the order follow the data.
  const usageSig = sortField === "cpu" || sortField === "memory" ? matched.map(p => shownUsage(p, sortField)).join(",") : "";

  const filtered = useMemo(() => {
    let result = status !== "All" ? matched.filter(p => p.status === status) : matched;

    if (sortField) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortField === "name")      cmp = a.name.localeCompare(b.name);
        if (sortField === "namespace") cmp = a.namespace.localeCompare(b.namespace);
        if (sortField === "status")    cmp = a.status.localeCompare(b.status);
        if (sortField === "restarts")  cmp = a.restarts - b.restarts;
        if (sortField === "age")       cmp = parseAge(a.age) - parseAge(b.age);
        if (sortField === "node")      cmp = (a.node ?? "").localeCompare(b.node ?? "");
        if (sortField === "cpu" || sortField === "memory") cmp = shownUsage(a, sortField) - shownUsage(b, sortField);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [matched, status, sortField, sortDir, shownUsage, usageSig]);

  const handleColumnSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }, [sortField]);

  const handleDropdownSort = useCallback((field: SortField, dir: SortDir) => {
    setSortField(field);
    setSortDir(dir);
  }, []);

  const handleClearSort   = useCallback(() => setSortField(null), []);
  const handleClearLabels = useCallback(() => setActiveLabels({}), []);

  const toggleLabel = useCallback((key: string, value: string) => {
    setActiveLabels(prev => {
      if (prev[key] === value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const handleDelete = useCallback((podName: string, namespace: string) => {
    setRowDeleteError("");
    setRowDeleteTarget({ name: podName, namespace });
  }, []);

  const handleBulkCheck = useCallback((pod: Pod, shiftHeld: boolean) => {
    const key = `${pod.namespace}/${pod.name}`;
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (shiftHeld && lastChecked) {
        const ids = filtered.map(p => `${p.namespace}/${p.name}`);
        const a = ids.indexOf(lastChecked);
        const b = ids.indexOf(key);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const addAll = !prev.has(key);
          for (let i = lo; i <= hi; i++) {
            if (addAll) next.add(ids[i]); else next.delete(ids[i]);
          }
          setLastChecked(key);
          return next;
        }
      }
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      setLastChecked(key);
      return next;
    });
  }, [filtered, lastChecked]);

  const bulkPods = useMemo(
    () => filtered.filter(p => bulkSelected.has(`${p.namespace}/${p.name}`)),
    [filtered, bulkSelected]
  );

  const uniqueNamespaces = useMemo(
    () => new Set(bulkPods.map(p => p.namespace)),
    [bulkPods]
  );
  const multiNamespace = uniqueNamespaces.size > 1;

  const allFilteredChecked = filtered.length > 0 && filtered.every(p => bulkSelected.has(`${p.namespace}/${p.name}`));
  const someFilteredChecked = filtered.some(p => bulkSelected.has(`${p.namespace}/${p.name}`));

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someFilteredChecked && !allFilteredChecked;
    }
  }, [someFilteredChecked, allFilteredChecked]);

  const handleHeaderCheck = useCallback(() => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (allFilteredChecked) {
        filtered.forEach(p => next.delete(`${p.namespace}/${p.name}`));
      } else {
        filtered.forEach(p => next.add(`${p.namespace}/${p.name}`));
      }
      return next;
    });
  }, [filtered, allFilteredChecked]);

  // The selection stays after a copy, so Delete or Restart can follow (Q12 A). The button says what happened.
  const copyText = copyNames.copy;
  const handleCopyNames = useCallback(() => {
    void copyText(bulkPods.map(p => p.name).join("\n"));
  }, [bulkPods, copyText]);

  const handleConfirmBulk = useCallback(async () => {
    if (!confirmAction) return;
    setPartialResult(null);
    setBulkError("");
    try {
      const result = await bulkDelete.mutateAsync(
        bulkPods.map(p => ({ context, namespace: p.namespace, name: p.name }))
      );
      setPartialResult(result);
      if (result.failed.length === 0) {
        setBulkSelected(new Set());
        setConfirmAction(null);
        setPartialResult(null);
      }
    } catch (e) {
      // e.g. the read-only backstop: shown in the dialog, which stays open.
      setBulkError((e as any)?.message ?? String(e));
    }
  }, [confirmAction, bulkPods, bulkDelete, context]);

  const thProps = { activeSortField: sortField, activeSortDir: sortDir, onSort: handleColumnSort };

  if (error) {
    return (
      <div className="rounded-xl bg-card/70 ring-1 ring-edge flex-1 min-h-0 flex items-center justify-center flex-col gap-3">
        <p className="text-[13px] text-bad">{error.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className={`h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25 ${FOCUS_RING}`}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <FiltersBar
        ns={ns} status={status} setStatus={setStatus} counts={counts}
        count={filtered.length} total={pods.length} search={search}
        sortField={sortField} sortDir={sortDir}
        onSort={handleDropdownSort} onClearSort={handleClearSort}
        allLabels={allLabels} activeLabels={activeLabels}
        onToggleLabel={toggleLabel} onClearLabels={handleClearLabels}
      />
      <ReadOnlyStrip context={context} />
      {bulkSelected.size > 0 && (
        <BulkActionBar
          count={bulkSelected.size}
          onClear={() => { setBulkSelected(new Set()); setLastChecked(null); }}
          onDelete={() => { setPartialResult(null); setBulkError(""); setConfirmAction("delete"); }}
          onRestart={() => { setPartialResult(null); setBulkError(""); setConfirmAction("restart"); }}
          onCopyNames={handleCopyNames}
          copyState={copyNames.state}
          isPending={bulkDelete.isPending}
          multiNamespace={multiNamespace}
          canDelete={perm.canDelete}
          readOnlyReason={identity.readOnly ? READ_ONLY_REASON_SHORT : undefined}
          bulkMessage={bulkCheck.message}
        />
      )}
      <div className="rounded-xl bg-card/70 ring-1 ring-edge flex-1 min-h-0 overflow-hidden">
        <div className="h-full overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky top-0 z-1 bg-panel/95 backdrop-blur-sm border-b border-edge py-2 pl-3 pr-1 w-8">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allFilteredChecked}
                    aria-label="Select all shown pods"
                    onChange={handleHeaderCheck}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer"
                  />
                </th>
                <Th {...thProps} sortKey="name">Name</Th>
                <Th {...thProps} sortKey="namespace" style={{ width: 130 }}>Namespace</Th>
                <Th {...thProps} sortKey="status" style={{ width: 170 }}>Status</Th>
                <Th {...thProps} style={{ width: 70 }}>Ready</Th>
                <Th {...thProps} sortKey="restarts" style={{ width: 160 }}>Restarts</Th>
                <Th {...thProps} sortKey="age" style={{ width: 80 }}>Age</Th>
                <Th {...thProps} sortKey="cpu" style={{ width: 180 }} title={USAGE_TITLE}>CPU</Th>
                <Th {...thProps} sortKey="memory" style={{ width: 180 }} title={USAGE_TITLE}>Memory</Th>
                <Th {...thProps} sortKey="node" style={{ width: 170 }}>Node</Th>
                <Th {...thProps} style={{ width: 38 }} />
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                : filtered.length === 0
                ? (
                  <tr>
                    <td colSpan={11}>
                      <div className="py-16 flex flex-col items-center gap-3">
                        <Boxes size={32} className="text-dim" />
                        <p className="text-[13px] text-mute">
                          {search ? `No pods matching "${search}"` : "No pods found"}
                        </p>
                        {!search && (
                          <p className="text-[11.5px] text-mute">Try selecting a different namespace or status filter</p>
                        )}
                        {(status !== "All" || Object.keys(activeLabels).length > 0) && (
                          <button
                            type="button"
                            onClick={() => { setStatus("All"); setActiveLabels({}); }}
                            className={`h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink ${FOCUS_RING}`}
                          >
                            Clear status and label filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
                : filtered.map((p) => (
                  <PodRow
                    key={`${p.namespace}/${p.name}`}
                    pod={p}
                    selected={selected?.name === p.name && selected?.namespace === p.namespace}
                    setSelected={setSelected}
                    onDelete={handleDelete}
                    bulkChecked={bulkSelected.has(`${p.namespace}/${p.name}`)}
                    onBulkCheck={handleBulkCheck}
                    bulkActive={bulkSelected.size > 0}
                    cpuHistory={cpuHistory?.get(`${p.namespace}/${p.name}`)}
                    memHistory={memHistory?.get(`${p.namespace}/${p.name}`)}
                    readOnlyReason={identity.readOnly ? READ_ONLY_REASON_SHORT : undefined}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirmAction && (
        <ConfirmBulkModal
          action={confirmAction}
          pods={bulkPods}
          context={identity.context}
          contextLabel={identity.label}
          contextColor={identity.color}
          bulkLimit={identity.bulkLimit}
          onConfirm={handleConfirmBulk}
          onCancel={() => { setConfirmAction(null); setPartialResult(null); setBulkError(""); }}
          isPending={bulkDelete.isPending}
          partialResult={partialResult}
          error={bulkError}
        />
      )}
      <ConfirmModal
        open={rowDeleteTarget !== null}
        title="Delete pod"
        description={`Delete pod "${rowDeleteTarget?.name}" from namespace "${rowDeleteTarget?.namespace}"? Kubernetes will recreate it if managed by a controller.`}
        confirmLabel={deletePod.isPending ? "Deleting…" : "Delete pod"}
        destructive
        status={rowDeleteError ? { tone: "error", text: rowDeleteError } : null}
        onConfirm={async () => {
          if (!rowDeleteTarget) return;
          // Stay open until the delete resolves: a refusal (RBAC, read-only backstop, network) shows in the dialog.
          setRowDeleteError("");
          try {
            await deletePod.mutateAsync({ context, namespace: rowDeleteTarget.namespace, podName: rowDeleteTarget.name });
            setRowDeleteTarget(null);
          } catch (e) {
            setRowDeleteError((e as any)?.message ?? String(e));
          }
        }}
        onCancel={() => { setRowDeleteTarget(null); setRowDeleteError(""); }}
        isPending={deletePod.isPending}
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={rowDeleteTarget ? deletePodsEquiv({ context, namespace: rowDeleteTarget.namespace, names: [rowDeleteTarget.name] }) : null}
      />
    </div>
  );
}
