import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, X, XCircle } from "lucide-react";
import { ConfirmModal, type ConfirmStatus } from "./ConfirmModal";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { useAccessChecks } from "../hooks/useResources";
import { checkBulk, disabledAttrs, pickDisabledReason } from "../utils/guardrails";
import { drainEquiv, forceDeleteEquiv } from "../utils/kubectlEquiv";
import { deniedNamespaces, evictionChecks, evictionDeniedLine } from "../utils/permissionHints";
import type { NodeDrainControls, NodeDrainState } from "../hooks/useNodeDrain";
import type { DrainPodPreview } from "../types/k8s";
import {
  CORDON_LINE_REMAINS, cordonLine, countsSentence, defaultForceSelection, forceDeletable, outcomeTitle, pdbReason, plural,
  requiresTypedConfirm, runCounts, sortRows, summarizePreview,
  type DrainOutcome, type DrainRow,
} from "../utils/drain";
import { PRODUCT_NAME } from "../brand";

// Drain dialog (docs/ux/01-safety-patch.md §2, with the tech-lead overrides in
// docs/impl/v1.2.1-tasks.md §1.3). Presentation only: the run state machine
// lives in useNodeDrain and is owned by NodeOverview, so closing this dialog
// keeps the data and "View details" on the result card can reopen it.

const BTN = "px-3 py-1.5 rounded-lg text-[12.5px] ring-1 transition-colors disabled:opacity-50 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60";
const BTN_PLAIN = `${BTN} text-mute ring-edge hover:text-ink`;
const BTN_PRIMARY = `${BTN} bg-accent/10 text-accent ring-accent/30 hover:bg-accent/20`;

const SUMMARY_REVIEW =
  "Cordons the node, then evicts its pods so they reschedule elsewhere. Pods that a PodDisruptionBudget protects are not deleted.";

// ─── helpers ──────────────────────────────────────────────────────────────────

function hhmmss(d: Date): string {
  return d.toLocaleTimeString([], { hour12: false });
}

function useElapsed(startedAt: number | null, running: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (startedAt === null) return "0:00";
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Re-sort at most once every 2s, and never while the pointer or focus is in the
// list: a row that jumps under the cursor is how a user clicks the wrong thing.
function useThrottledOrder(rows: DrainRow[], hold: boolean): DrainRow[] {
  const [order, setOrder] = useState<string[]>([]);
  const lastRef = useRef(0);
  useEffect(() => {
    const sorted = sortRows(rows).map((r) => r.key);
    const wait = 2000 - (Date.now() - lastRef.current);
    if (!hold && wait <= 0) {
      lastRef.current = Date.now();
      setOrder(sorted);
      return;
    }
    // New rows are never hidden while we wait: they are appended below.
    const id = window.setTimeout(() => {
      if (hold) return;
      lastRef.current = Date.now();
      setOrder(sorted);
    }, Math.max(wait, 50));
    return () => window.clearTimeout(id);
  }, [rows, hold]);
  return useMemo(() => {
    const idx = new Map(order.map((k, i) => [k, i] as const));
    return [...rows].sort((a, b) => (idx.get(a.key) ?? 1e9) - (idx.get(b.key) ?? 1e9));
  }, [rows, order]);
}

function rowWord(r: DrainRow): string {
  switch (r.status) {
    case "waiting": return "Waiting";
    case "evicting": return "Evicting…";
    case "deleting": return "Deleting…";
    case "force-deleted": return "Deleted, PDB bypassed";
    case "evicted": return "Evicted";
    case "gone": return "Already gone";
    case "blocked": return pdbReason(r.pdbs);
    case "failed": return "Failed";
  }
}

function rowAria(r: DrainRow): string {
  const owner = r.owner ? `, from ${r.owner}` : "";
  const msg = (r.status === "failed" || r.status === "blocked") && r.message ? `, ${r.message}` : "";
  return `${rowWord(r)}: ${r.namespace}/${r.name}${owner}${msg}`;
}

// ─── row + section primitives ─────────────────────────────────────────────────

function RowGlyph({ status }: { status: DrainRow["status"] }) {
  switch (status) {
    case "waiting": return <span aria-hidden className="text-dim w-4 text-center shrink-0">○</span>;
    case "evicting":
    case "deleting": return <Loader2 aria-hidden size={12} className="animate-spin text-accent w-4 shrink-0" />;
    case "force-deleted": return <span aria-hidden className="text-warn w-4 text-center shrink-0">✓</span>;
    case "evicted": return <span aria-hidden className="text-ok w-4 text-center shrink-0">✓</span>;
    case "gone": return <span aria-hidden className="text-dim w-4 text-center shrink-0">✓</span>;
    case "blocked": return <span aria-hidden className="text-warn w-4 text-center shrink-0">⊘</span>;
    case "failed": return <span aria-hidden className="text-bad w-4 text-center shrink-0">✕</span>;
  }
}

const ROW_TEXT: Record<DrainRow["status"], string> = {
  waiting: "text-dim",
  evicting: "text-accent",
  deleting: "text-accent",
  "force-deleted": "text-warn",
  evicted: "text-ok",
  gone: "text-dim",
  blocked: "text-warn",
  failed: "text-bad",
};

function DrainRowItem({ row }: { row: DrainRow }) {
  const detail = (row.status === "blocked" || row.status === "failed") && row.message;
  return (
    <li aria-label={rowAria(row)} className="py-1">
      <div className="flex items-baseline gap-2 text-[12px]">
        <RowGlyph status={row.status} />
        <span className="mono text-ink truncate min-w-0" title={`${row.namespace}/${row.name}`}>
          {row.namespace}/{row.name}
        </span>
        <span className={`text-[11.5px] shrink-0 ${ROW_TEXT[row.status]}`}>{rowWord(row)}</span>
        {row.owner && <span className="mono text-[10.5px] text-dim truncate ml-auto">{row.owner}</span>}
      </div>
      {detail && (
        <div className="mono text-[10.5px] text-dim pl-6 mt-0.5 wrap-break-word">
          {row.status === "blocked" ? "Server: " : ""}{row.message}
        </div>
      )}
    </li>
  );
}

function Disclosure({
  title, count, defaultOpen = false, cap = 8, items,
}: {
  title: string; count: number; defaultOpen?: boolean; cap?: number; items: ReactNode[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  if (count === 0) return null;
  const shown = all ? items : items.slice(0, cap);
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[12px] text-ink font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60 rounded-sm"
      >
        <span aria-hidden className="text-dim text-[10px] w-3">{open ? "▾" : "▸"}</span>
        {title} ({count})
      </button>
      {open && (
        <>
          <ul className="mt-1 pl-4">{shown}</ul>
          {items.length > cap && !all && (
            <button
              onClick={() => setAll(true)}
              className="ml-4 mt-1 text-[11.5px] text-accent hover:underline outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60 rounded-sm"
            >
              Show all ({items.length})
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ n, label, tone = "text-ink" }: { n: number; label: string; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 px-2 py-1 rounded-md bg-surface-tint/3 ring-1 ring-edge">
      <span className={`mono text-[12px] font-semibold ${tone}`}>{n}</span>
      <span className="text-[11.5px] text-mute">{label}</span>
    </span>
  );
}

function InfoLine({ children, tone = "text-mute" }: { children: ReactNode; tone?: string }) {
  return <p className={`text-[12px] mb-3 ${tone}`}>{children}</p>;
}

function PreviewRow({ p, glyph, glyphTone, extra }: { p: DrainPodPreview; glyph: string; glyphTone: string; extra?: ReactNode }) {
  const owner = p.owner_kind && p.owner_name ? `${p.owner_kind} ${p.owner_name}` : null;
  return (
    <li className="py-1 flex items-baseline gap-2 text-[12px]">
      <span aria-hidden className={`${glyphTone} w-4 text-center shrink-0`}>{glyph}</span>
      <span className="mono text-ink truncate min-w-0" title={`${p.namespace}/${p.name}`}>{p.namespace}/{p.name}</span>
      {extra}
      {owner && <span className="mono text-[10.5px] text-dim truncate ml-auto">{owner}</span>}
      {!owner && p.category === "evict" && <span className="text-[10.5px] text-warn ml-auto shrink-0">no controller</span>}
    </li>
  );
}

// ─── bodies ───────────────────────────────────────────────────────────────────

function ReviewBody({ node, drain }: { node: string; drain: NodeDrainState & NodeDrainControls }) {
  const { preview, previewStatus, previewError, snapshotAt } = drain;

  if (previewStatus === "loading") {
    return (
      <div aria-busy="true">
        <p className="text-[12.5px] text-mute mb-3">Checking what&apos;s on {node}…</p>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-5 rounded-sm bg-surface-tint/4 animate-pulse mb-1.5" />
        ))}
      </div>
    );
  }

  if (previewStatus === "failed" || !preview) {
    return (
      <div>
        <div className="flex items-start gap-2 mb-3 text-[12px] text-mute">
          <span className="flex-1 min-w-0 wrap-break-word">Couldn&apos;t load the preview: {previewError}.</span>
          <button onClick={drain.refreshPreview} className={`${BTN_PLAIN} shrink-0 py-0.5! text-[11.5px]!`}>Retry</button>
        </div>
        <InfoLine>
          You can still drain. {PRODUCT_NAME} only asks the API server to evict pods, and PodDisruptionBudgets are enforced
          by the server. Pods it refuses to evict are reported, not deleted.
        </InfoLine>
      </div>
    );
  }

  const s = summarizePreview(preview);
  const evictPods = preview.pods.filter((p) => p.category === "evict");
  const blocked = evictPods.filter((p) => p.may_be_blocked);
  const normal = evictPods.filter((p) => !p.may_be_blocked);
  const daemon = preview.pods.filter((p) => p.category === "daemonset");
  const mirror = preview.pods.filter((p) => p.category === "mirror");
  const unmanaged = evictPods.filter((p) => p.unmanaged);
  const nothing = s.toEvict + s.mayBeBlocked === 0;
  const allBlocked = s.toEvict === 0 && s.mayBeBlocked > 0;

  return (
    <div>
      <div className="flex items-start gap-2 mb-3">
        <p className="flex-1 text-[11.5px] text-dim">
          Point-in-time snapshot taken {snapshotAt ? hhmmss(snapshotAt) : "just now"}. Budgets can change while the drain runs.
        </p>
        <button onClick={drain.refreshPreview} className={`${BTN_PLAIN} shrink-0 py-0.5! text-[11.5px]! flex items-center gap-1`}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {preview.unschedulable && <InfoLine>This node is already cordoned.</InfoLine>}
      {!preview.node_ready && <InfoLine tone="text-warn">{node} is NotReady. Eviction requests may time out.</InfoLine>}
      {preview.pdb_lookup_errors.map((e) => (
        <InfoLine key={e}>
          {e.replace(/\.+$/, "")}. PodDisruptionBudget information for that namespace is unavailable, so its pods may still be blocked.
        </InfoLine>
      ))}

      {nothing ? (
        <InfoLine tone="text-ink">
          {preview.unschedulable
            ? `${node} is already cordoned and has nothing to evict.`
            : `Nothing to evict. ${node} runs only DaemonSet pods (${s.daemonset}) and static pods (${s.mirror}). Draining would only cordon the node.`}
        </InfoLine>
      ) : (
        allBlocked && (
          <InfoLine tone="text-warn">
            All {s.mayBeBlocked} evictable pods are blocked by PodDisruptionBudgets right now. Draining will cordon {node} and
            evict nothing until budgets allow it.
          </InfoLine>
        )
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Chip n={s.toEvict} label="to evict" />
        {s.mayBeBlocked > 0 && <Chip n={s.mayBeBlocked} label="may be blocked" tone="text-warn" />}
        {s.daemonset > 0 && <Chip n={s.daemonset} label="DaemonSet skipped" />}
        {s.mirror > 0 && <Chip n={s.mirror} label="static skipped" />}
      </div>

      <Disclosure
        title="May be blocked by a PodDisruptionBudget"
        count={blocked.length}
        defaultOpen
        items={blocked.map((p) => (
          <PreviewRow
            key={`${p.namespace}/${p.name}`}
            p={p}
            glyph="⊘"
            glyphTone="text-warn"
            extra={
              <span className="text-[11px] text-mute shrink-0">
                {p.pdbs
                  .filter((d) => d.disruptions_allowed <= 0)
                  .map((d) => `PDB ${d.name} · allowed disruptions: ${Math.max(0, d.disruptions_allowed)}`)
                  .join(", ")}
              </span>
            }
          />
        ))}
      />
      <Disclosure
        title="Will be evicted"
        count={normal.length}
        defaultOpen
        cap={3}
        items={normal.map((p) => <PreviewRow key={`${p.namespace}/${p.name}`} p={p} glyph="○" glyphTone="text-dim" />)}
      />
      <Disclosure
        title="Skipped: DaemonSet pods"
        count={daemon.length}
        items={daemon.map((p) => <PreviewRow key={`${p.namespace}/${p.name}`} p={p} glyph="–" glyphTone="text-dim" />)}
      />
      <Disclosure
        title="Skipped: static (mirror) pods"
        count={mirror.length}
        items={mirror.map((p) => <PreviewRow key={`${p.namespace}/${p.name}`} p={p} glyph="–" glyphTone="text-dim" />)}
      />

      {unmanaged.length > 0 && (
        <InfoLine tone="text-warn">
          {unmanaged.length} {plural(unmanaged.length, "pod has", "pods have")} no controller and will not be recreated:{" "}
          <span className="mono">
            {unmanaged.slice(0, 5).map((p) => `${p.namespace}/${p.name}`).join(", ")}
            {unmanaged.length > 5 ? `, and ${unmanaged.length - 5} more` : ""}
          </span>
        </InfoLine>
      )}
      {s.emptyDir > 0 && (
        <InfoLine tone="text-warn">
          {s.emptyDir} {plural(s.emptyDir, "pod uses", "pods use")} emptyDir volumes. That data is deleted when{" "}
          {plural(s.emptyDir, "it is", "they are")} evicted.
        </InfoLine>
      )}
    </div>
  );
}

function CountsRow({ rows }: { rows: DrainRow[] }) {
  const c = runCounts(rows);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] mb-3">
      <span className="text-ok">{c.evicted} evicted</span>
      {c.forced > 0 && <span className="text-warn">{c.forced} force-deleted</span>}
      {c.gone > 0 && <span className="text-dim">{c.gone} already gone</span>}
      <span className="text-accent">{c.evicting + c.deleting} {c.deleting > 0 ? "in progress" : "evicting"}</span>
      <span className="text-dim">{c.waiting} waiting</span>
      <span className="text-warn">{c.blocked} blocked</span>
      <span className="text-bad">{c.failed} failed</span>
    </div>
  );
}

function RunBody({ drain }: { drain: NodeDrainState & NodeDrainControls }) {
  const [hold, setHold] = useState(false);
  const ordered = useThrottledOrder(drain.rows, hold);
  const elapsed = useElapsed(drain.startedAt, true);
  const c = runCounts(drain.rows);
  const step =
    drain.cordonStep === "already" ? "✓ Already cordoned"
    : drain.cordonStep === "done" ? "✓ Cordoned"
    : "● Cordoning…";

  return (
    <div>
      <div className="flex items-center gap-3 text-[12px] text-mute mb-3">
        <span>{step}</span>
        <span>{drain.rows.length > 0 || drain.cordonStep !== "pending" ? "● Evicting pods…" : ""}</span>
        <span className="ml-auto mono text-dim">elapsed {elapsed}</span>
      </div>
      {drain.rows.length > 0 ? (
        <>
          <div className="flex items-center gap-3 mb-3">
            <progress
              max={c.total}
              value={c.done}
              aria-label="Drain progress"
              className="flex-1 h-1.5 appearance-none [&::-webkit-progress-bar]:rounded-sm [&::-webkit-progress-bar]:bg-surface-tint/6 [&::-webkit-progress-value]:rounded-sm [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent"
            />
            <span className="mono text-[11.5px] text-mute shrink-0">{c.done} of {c.total} done</span>
          </div>
          <CountsRow rows={drain.rows} />
          <ul
            tabIndex={0}
            aria-label="Pods being evicted"
            onMouseEnter={() => setHold(true)}
            onMouseLeave={() => setHold(false)}
            onFocus={() => setHold(true)}
            onBlur={() => setHold(false)}
            className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-edge px-3 py-1 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {ordered.map((r) => <DrainRowItem key={r.key} row={r} />)}
          </ul>
        </>
      ) : (
        <div className="h-1.5 rounded-sm bg-surface-tint/6 animate-pulse" aria-label="Preparing drain" />
      )}
    </div>
  );
}

function ResultBody({
  node, drain, cordoned, outcome,
}: { node: string; drain: NodeDrainState & NodeDrainControls; cordoned: boolean; outcome: DrainOutcome }) {
  const ordered = useMemo(() => sortRows(drain.rows), [drain.rows]);
  const attention = ordered.filter((r) => r.status === "blocked" || r.status === "failed");
  const rest = ordered.filter((r) => r.status !== "blocked" && r.status !== "failed" && r.status !== "waiting");
  const forcedCount = rest.filter((r) => r.status === "force-deleted").length;
  const notAttempted = ordered.filter((r) => r.status === "waiting");
  const phase = drain.phase;

  return (
    <div>
      {phase === "attention" && (
        <>
          <p className="text-[12px] text-ink mb-3">
            {drain.attempt > 1 ? `Attempt ${drain.attempt}. ` : ""}
            Blocked pods
          </p>
        </>
      )}
      {attention.length > 0 && (
        <ul className="rounded-lg ring-1 ring-edge px-3 py-1 mb-3 max-h-64 overflow-y-auto" tabIndex={0} aria-label="Blocked and failed pods">
          {attention.map((r) => <DrainRowItem key={r.key} row={r} />)}
        </ul>
      )}
      <Disclosure title={forcedCount > 0 ? "Evicted and force-deleted" : "Evicted"} count={rest.length} items={rest.map((r) => <DrainRowItem key={r.key} row={r} />)} />
      <Disclosure title="Not attempted" count={notAttempted.length} items={notAttempted.map((r) => <DrainRowItem key={r.key} row={r} />)} />

      {phase === "attention" && (
        <>
          <InfoLine>
            Budgets free up when other replicas become ready, for example after a rollout finishes. Retry in a moment, or stop and come back later.
          </InfoLine>
        </>
      )}
      {phase !== "attention" && cordoned && (
        <InfoLine tone="text-ink">{cordonLine(outcome)}</InfoLine>
      )}
      {phase === "attention" && cordoned && <InfoLine>{CORDON_LINE_REMAINS}</InfoLine>}
      {!cordoned && <InfoLine>{node} is not cordoned.</InfoLine>}
    </div>
  );
}

// ─── dialog ───────────────────────────────────────────────────────────────────

export function NodeDrainDialog({
  context, node, drain, nodeUnschedulable, onUncordon,
}: {
  context: string;
  node: string;
  drain: NodeDrainState & NodeDrainControls;
  /** The node's own cordon state from the node list — used until the drain learns better. */
  nodeUnschedulable: boolean;
  onUncordon: () => Promise<void>;
}) {
  const identity = useClusterIdentity(context);
  const { phase, preview, previewStatus } = drain;
  const cordoned = drain.cordoned ?? nodeUnschedulable;
  const counts = useMemo(() => runCounts(drain.rows), [drain.rows]);
  const nothingToEvict = drain.rows.length === 0;
  const outcome: DrainOutcome = drain.outcome ?? "incomplete";

  // Read-only disables every write control in the footer (Retry); Stop and Close stay available.
  const roReason = pickDisabledReason({ readOnly: identity.readOnly });
  // C-7: the eviction hint is PER NAMESPACE (a drain spans namespaces) and never disables Drain.
  const evictChecks = useMemo(() => evictionChecks(preview), [preview]);
  const { data: evictAccess } = useAccessChecks(
    context, evictChecks, drain.open && phase === "review" && previewStatus !== "loading",
  );
  const deniedNs = deniedNamespaces(evictChecks, evictAccess);
  const includesUnmanaged = !!preview?.pods.some((p) => p.category === "evict" && p.unmanaged);

  // F5: the nested force-delete dialog. The per-pod selection resets every time it opens.
  const [forceOpen, setForceOpen] = useState(false);
  const [forceSel, setForceSel] = useState<Set<string>>(new Set());
  const blockedRows = forceDeletable(drain.rows);
  const openForce = () => {
    setForceSel(defaultForceSelection(drain.rows, identity.bulkLimit));
    setForceOpen(true);
  };
  const chosen = blockedRows.filter((r) => forceSel.has(r.key));
  const forceBulk = checkBulk(chosen.length, identity.bulkLimit, identity.label || context);
  const noController = chosen.filter((r) => r.unmanaged).length;
  // The dialog goes away if the pass moves on (a retry, a stop) or read-only turns on.
  useEffect(() => { if (phase !== "attention") setForceOpen(false); }, [phase]);

  const stopBtnRef = useRef<HTMLButtonElement>(null);
  const [escHint, setEscHint] = useState(false);
  const [uncordoning, setUncordoning] = useState(false);
  const [uncordonStatus, setUncordonStatus] = useState<ConfirmStatus | null>(null);

  useEffect(() => {
    setEscHint(false);
    setUncordonStatus(null);
  }, [phase, drain.open]);

  // ── live regions (UX §2.12): polite + throttled to 5s while running,
  //    immediate on the first blocked/failed pod, assertive on attention,
  //    polite on result.
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const lastAnnounceRef = useRef(0);
  const prevBadRef = useRef(0);
  useEffect(() => {
    if (phase !== "running") { prevBadRef.current = 0; return; }
    const bad = counts.blocked + counts.failed;
    const msg =
      `${counts.done} of ${counts.total} pods done.` +
      (counts.blocked > 0 ? ` ${counts.blocked} blocked.` : "") +
      (counts.failed > 0 ? ` ${counts.failed} failed.` : "");
    const firstBad = bad > 0 && prevBadRef.current === 0;
    prevBadRef.current = bad;
    const sinceLast = Date.now() - lastAnnounceRef.current;
    if (firstBad || sinceLast >= 5000) {
      lastAnnounceRef.current = Date.now();
      setPolite(msg);
      return;
    }
    const id = window.setTimeout(() => {
      lastAnnounceRef.current = Date.now();
      setPolite(msg);
    }, 5000 - sinceLast);
    return () => window.clearTimeout(id);
  }, [phase, counts]);
  useEffect(() => {
    if (phase === "attention") {
      setAssertive(`Drain paused. ${counts.blocked} ${plural(counts.blocked, "pod is", "pods are")} blocked by a PodDisruptionBudget. ${counts.evicted} ${plural(counts.evicted, "pod was", "pods were")} evicted.`);
    } else if (phase === "result") {
      setPolite(`${outcomeTitle(outcome, node, nothingToEvict, counts.forced)}. ${countsSentence(counts, drain.skipped)}`);
    } else {
      setAssertive("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function doUncordon() {
    setUncordoning(true);
    setUncordonStatus(null);
    try {
      await onUncordon();
      setUncordonStatus({ tone: "ok", text: "Node uncordoned." });
    } catch (e) {
      setUncordonStatus({ tone: "error", text: `Couldn't uncordon ${node}: ${(e as any)?.message ?? String(e)}` });
    }
    setUncordoning(false);
  }

  const uncordonBtn = cordoned ? (
    <button onClick={doUncordon} disabled={uncordoning} className={`${BTN_PLAIN} flex items-center gap-1.5`}>
      {uncordoning && <Loader2 size={12} className="animate-spin" />} Uncordon node
    </button>
  ) : null;
  const closeBtn = (label = "Close") => <button onClick={drain.close} className={BTN_PLAIN}>{label}</button>;

  // ── per-phase wiring ──
  let title = `Drain node ${node}`;
  let description: ReactNode = SUMMARY_REVIEW;
  let body: ReactNode = null;
  let footer: ReactNode | undefined;
  let status: ConfirmStatus | null = null;
  let icon: ReactNode | undefined;
  let destructive = true;
  let confirmLabel = "Drain node";
  let confirmDisabled = false;
  let confirmDisabledReason: string | undefined;
  let onConfirm: () => void = () => {};
  let onCancel: () => void = drain.close;
  let requireTyping: string | undefined;

  if (phase === "review") {
    onConfirm = drain.start;
    onCancel = drain.dismiss;
    body = (
      <>
        {deniedNs.length > 0 && <InfoLine tone="text-warn">{evictionDeniedLine(deniedNs)}</InfoLine>}
        <ReviewBody node={node} drain={drain} />
      </>
    );
    if (previewStatus === "loading") {
      confirmDisabled = true;
      confirmDisabledReason = "Waiting for the preview.";
    } else {
      requireTyping = requiresTypedConfirm(preview) ? node : undefined;
      if (previewStatus === "failed" || !preview) {
        confirmLabel = "Drain without preview";
      } else {
        const s = summarizePreview(preview);
        if (s.toEvict + s.mayBeBlocked === 0) {
          if (preview.unschedulable) {
            confirmDisabled = true;
            confirmDisabledReason = "Nothing to do.";
            footer = <div className="flex justify-end"><button onClick={drain.dismiss} className={BTN_PLAIN}>Close</button></div>;
          } else {
            confirmLabel = "Cordon node";
          }
        } else if (s.toEvict === 0) {
          confirmLabel = "Cordon and try drain";
        }
      }
    }
  } else if (phase === "running") {
    title = `Draining ${node}`;
    description = "Evicting pods one at a time. Each eviction is a request the API server can refuse; refused pods are reported, never deleted.";
    destructive = false;
    icon = <Loader2 size={16} className="text-accent shrink-0 animate-spin" />;
    confirmDisabled = true;
    body = <RunBody drain={drain} />;
    if (drain.forcing > 0) {
      title = `Force-deleting on ${node}`;
      description = `Force-deleting ${drain.forcing} ${plural(drain.forcing, "pod", "pods")}… The PodDisruptionBudget is bypassed.`;
    }
    status = drain.stopping
      ? { tone: "info", text: drain.forcing > 0 ? "Stopping after the current delete…" : "Stopping after the current eviction…" }
      : escHint ? { tone: "info", text: "Press Stop to stop. Esc doesn't cancel a running drain." } : null;
    footer = (
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[11.5px] text-dim">{drain.forcing > 0 ? "Pods already deleted stay deleted if you stop." : "The node stays cordoned if you stop."}</span>
        <button ref={stopBtnRef} onClick={drain.stop} disabled={drain.stopping} className={BTN_PLAIN}>
          {drain.stopping ? "Stopping…" : "Stop"}
        </button>
      </div>
    );
  } else if (phase === "attention") {
    title = `Drain paused on ${node}`;
    description = `${counts.blocked} ${plural(counts.blocked, "pod can't", "pods can't")} be evicted right now because a PodDisruptionBudget refuses it. ${counts.evicted} ${plural(counts.evicted, "pod was", "pods were")} evicted. The node is still cordoned.`;
    icon = <AlertTriangle size={16} className="text-warn shrink-0" />;
    onConfirm = drain.retryBlocked;
    body = <ResultBody node={node} drain={drain} cordoned={cordoned} outcome="incomplete" />;
    // The Override band sits in the PINNED footer, BELOW the buttons and a rule (UXP-21):
    // Tab order is Stop, Retry, then Override; it is never default focus and never reachable
    // from the footer buttons by muscle memory. Read-only disables it with the reason.
    footer = (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-end gap-2">
          <button onClick={drain.stopAttention} className={BTN_PLAIN}>Stop, leave node cordoned</button>
          <button onClick={() => { if (roReason) return; drain.retryBlocked(); }} {...disabledAttrs(roReason)} className={`${BTN_PRIMARY} ${roReason ? "opacity-50 cursor-not-allowed" : ""}`}>Retry blocked pods</button>
        </div>
        <div className="border-t border-edge pt-2 flex items-baseline gap-3">
          <span className="text-[11px] text-dim uppercase tracking-wider shrink-0">Override</span>
          <button
            type="button"
            onClick={() => { if (roReason) return; openForce(); }}
            {...disabledAttrs(roReason)}
            className={`text-[12px] text-bad hover:underline inline-flex items-center gap-1.5 outline-hidden focus-visible:ring-2 focus-visible:ring-bad/60 rounded-sm ${roReason ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <AlertTriangle size={12} aria-hidden /> Force-delete the blocked pods…
          </button>
          <span className="text-[11px] text-dim">Bypasses the PodDisruptionBudget.</span>
        </div>
      </div>
    );
    status = uncordonStatus;
  } else if (phase === "result") {
    const t = outcomeTitle(outcome, node, nothingToEvict, counts.forced);
    title = t;
    destructive = false;
    description = countsSentence(counts, drain.skipped);
    icon = outcome === "complete" && counts.forced === 0
      ? <CheckCircle2 size={16} className="text-ok shrink-0" />
      : <AlertTriangle size={16} className="text-warn shrink-0" />;
    body = <ResultBody node={node} drain={drain} cordoned={cordoned} outcome={outcome} />;
    status = uncordonStatus;
    footer = (
      <div className="flex items-center justify-end gap-2">
        {uncordonBtn}
        {outcome === "stopped" && <button onClick={drain.openReview} className={BTN_PLAIN}>Resume drain</button>}
        {outcome === "incomplete" && counts.blocked > 0 && (
          <button onClick={() => { if (roReason) return; drain.retryBlocked(); }} {...disabledAttrs(roReason)} className={`${BTN_PRIMARY} ${roReason ? "opacity-50 cursor-not-allowed" : ""}`}>Retry blocked pods</button>
        )}
        {closeBtn()}
      </div>
    );
  } else {
    title = "Drain failed";
    destructive = false;
    description = `${node} was not drained.`;
    icon = <XCircle size={16} className="text-bad shrink-0" />;
    status = uncordonStatus ?? { tone: "error", text: drain.errorMessage };
    body = cordoned ? <InfoLine tone="text-ink">{CORDON_LINE_REMAINS}</InfoLine> : null;
    footer = (
      <div className="flex items-center justify-end gap-2">
        {uncordonBtn}
        <button onClick={() => { if (roReason) return; drain.start(); }} {...disabledAttrs(roReason)} className={`${BTN_PRIMARY} ${roReason ? "opacity-50 cursor-not-allowed" : ""}`}>Retry</button>
        {closeBtn()}
      </div>
    );
  }

  return (
    <ConfirmModal
      open={drain.open}
      size="lg"
      phase={phase}
      title={title}
      description={description}
      destructive={destructive}
      icon={icon}
      confirmLabel={confirmLabel}
      confirmDisabled={confirmDisabled}
      confirmDisabledReason={confirmDisabledReason}
      requireTyping={requireTyping}
      requireTypingLabel={requireTyping ? `Type ${node} to confirm` : undefined}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onEscapeWhileRunning={() => { setEscHint(true); stopBtnRef.current?.focus(); }}
      status={status}
      footer={footer}
      contextLabel={identity.label}
      contextColor={identity.color}
      context={identity.context}
      kubectlEquivalent={phase === "review" ? drainEquiv({ context, node, includesUnmanaged }) : null}
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" role="alert">{assertive}</div>
      {body}
      {forceOpen && (
        // Nested `md`, destructive, over the attention dialog. The typed NODE NAME is always
        // required (it is the one typed field: the guardrail adds none). Esc / Cancel close
        // only this dialog; the attention dialog stays intact.
        <ConfirmModal
          open
          size="md"
          destructive
          context={identity.context}
          contextLabel={identity.label}
          contextColor={identity.color}
          title={`Force-delete ${chosen.length} blocked ${plural(chosen.length, "pod", "pods")}`}
          description="This bypasses the PodDisruptionBudget. The pods are deleted directly, so the workloads they belong to can lose availability or go down entirely."
          confirmLabel={`Force-delete ${chosen.length} ${plural(chosen.length, "pod", "pods")}`}
          requireTyping={node}
          requireTypingLabel={`Type ${node} to confirm`}
          confirmDisabled={chosen.length === 0 || !forceBulk.ok}
          confirmDisabledReason={forceBulk.message ?? (chosen.length === 0 ? "Select at least one pod." : undefined)}
          notice={
            <>
              {forceBulk.message && <span>{forceBulk.message}</span>}
              {noController > 0 && (
                <span>{noController} of these {plural(noController, "pod has", "pods have")} no controller and will not be recreated.</span>
              )}
            </>
          }
          kubectlEquivalent={forceDeleteEquiv({ context, pods: chosen.map((r) => ({ namespace: r.namespace, name: r.name })) })}
          onCancel={() => setForceOpen(false)}
          onConfirm={() => { setForceOpen(false); drain.forceDelete(chosen.map((r) => r.key)); }}
        >
          <ul aria-label="Blocked pods to force-delete" className="flex flex-col gap-0.5">
            {blockedRows.map((r) => (
              <li key={r.key}>
                <label className="flex items-baseline gap-2 text-[12px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forceSel.has(r.key)}
                    onChange={() => setForceSel((old) => {
                      const next = new Set(old);
                      if (next.has(r.key)) next.delete(r.key); else next.add(r.key);
                      return next;
                    })}
                    className="accent-accent"
                  />
                  <span className="mono text-ink truncate min-w-0">{r.namespace}/{r.name}</span>
                  <span className="mono text-[10.5px] text-dim shrink-0">{r.pdbs[0] ? `PDB ${r.pdbs[0].name}` : ""}</span>
                </label>
              </li>
            ))}
          </ul>
        </ConfirmModal>
      )}
    </ConfirmModal>
  );
}

// ─── persistent result card (UX §2.10) ────────────────────────────────────────

const CARD_TONE = {
  ok: "border-ok/60 text-ok",
  warn: "border-warn/60 text-warn",
  bad: "border-bad/60 text-bad",
} as const;

export function DrainResultCard({
  node, drain, nodeUnschedulable,
}: { node: string; drain: NodeDrainState & NodeDrainControls; nodeUnschedulable: boolean }) {
  const { phase } = drain;
  if (!drain.active || drain.open) return null;
  if (phase !== "attention" && phase !== "result" && phase !== "error") return null;

  const cordoned = drain.cordoned ?? nodeUnschedulable;
  const counts = runCounts(drain.rows);
  const outcome: DrainOutcome = drain.outcome ?? "incomplete";

  let tone: keyof typeof CARD_TONE;
  let title: string;
  let detail: string;
  if (phase === "attention") {
    tone = "warn";
    title = `Drain paused on ${node}`;
    detail = `${counts.blocked} ${plural(counts.blocked, "pod is", "pods are")} still blocked · ${counts.evicted} evicted`;
  } else if (phase === "error") {
    tone = "bad";
    title = "Drain failed";
    detail = drain.errorMessage;
  } else {
    tone = outcome === "complete" && counts.forced === 0 ? "ok" : outcome === "failed" ? "bad" : "warn";
    title = outcomeTitle(outcome, node, drain.rows.length === 0, counts.forced);
    detail = countsSentence(counts, drain.skipped);
  }

  return (
    <div
      role="status"
      className={`mb-2 rounded-lg bg-card/70 ring-1 ring-edge border-l-2 px-3 py-2 ${CARD_TONE[tone]}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium">{title}</div>
          <div className="text-[11.5px] text-mute mt-0.5 wrap-break-word">{detail}</div>
          {cordoned && <div className="text-[11.5px] text-mute mt-0.5">{phase === "result" ? cordonLine(outcome) : CORDON_LINE_REMAINS}</div>}
        </div>
        <button onClick={drain.reopen} className="shrink-0 h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono">
          View details
        </button>
        <button
          onClick={drain.dismiss}
          aria-label="Dismiss drain result"
          className="shrink-0 h-6 w-6 rounded-sm hover:bg-surface-tint/6 text-dim hover:text-ink flex items-center justify-center"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
