// Pure node-drain helpers (v1.2.1). No React, no runtime imports — type-only —
// so scripts/check-emit.ts can load this file under Node's native TS
// type-stripping (which strips types but not JSX).
//
// "Evicted" always means the eviction request was ACCEPTED (HTTP 2xx); the pod
// then terminates within its grace period. Nothing here may imply the pod is
// already gone. "gone" (HTTP 404) is counted separately and never folded into
// "evicted".
import type { DrainPdbRef, DrainPodPreview, DrainPreview, EvictionOutcome } from "../types/k8s";

// `deleting` / `force-deleted` are DRAIN-ROW states only (F5, UXP-22). They are never added
// to EvictionOutcome, which mirrors Rust's closed set. A failed force-delete goes back to
// `blocked` with its message; a failed row would be unreachable by Retry and Override.
export type DrainRowStatus = "waiting" | "evicting" | "deleting" | "force-deleted" | EvictionOutcome;

export interface DrainRow {
  key: string;
  namespace: string;
  name: string;
  /** "Deployment api" — null when the pod has no controller. */
  owner: string | null;
  unmanaged: boolean;
  pdbs: DrainPdbRef[];
  status: DrainRowStatus;
  /** Server text verbatim for blocked/failed rows, "" otherwise. */
  message: string;
}

export function podKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

export function ownerLabel(p: Pick<DrainPodPreview, "owner_kind" | "owner_name">): string | null {
  if (!p.owner_kind || !p.owner_name) return null;
  return `${p.owner_kind} ${p.owner_name}`;
}

export function rowFromPreview(p: DrainPodPreview): DrainRow {
  return {
    key: podKey(p.namespace, p.name),
    namespace: p.namespace,
    name: p.name,
    owner: ownerLabel(p),
    unmanaged: p.unmanaged,
    pdbs: p.pdbs,
    status: "waiting",
    message: "",
  };
}

export interface PreviewSummary {
  /** Evictable pods with no expected refusal. */
  toEvict: number;
  /** Evictable pods a matching PDB currently allows zero disruptions for. */
  mayBeBlocked: number;
  daemonset: number;
  mirror: number;
  /** Evictable pods with no controller (they will not be recreated). */
  unmanaged: number;
  /** Evictable pods using emptyDir volumes (data is deleted on eviction). */
  emptyDir: number;
}

/**
 * toEvict, mayBeBlocked, daemonset and mirror are DISJOINT and sum to
 * `preview.pods.length` — the chips are built from the same lists as the
 * sections below them, so the numbers cannot disagree.
 */
export function summarizePreview(preview: DrainPreview): PreviewSummary {
  const s: PreviewSummary = { toEvict: 0, mayBeBlocked: 0, daemonset: 0, mirror: 0, unmanaged: 0, emptyDir: 0 };
  for (const p of preview.pods) {
    if (p.category === "daemonset") s.daemonset++;
    else if (p.category === "mirror") s.mirror++;
    else {
      if (p.may_be_blocked) s.mayBeBlocked++;
      else s.toEvict++;
      if (p.unmanaged) s.unmanaged++;
      if (p.has_empty_dir) s.emptyDir++;
    }
  }
  return s;
}

/**
 * D1-1: the node name must be typed when the preview is unavailable (the user
 * cannot see whether unmanaged pods exist) or when any pod that will be evicted
 * has no controller to recreate it. A DaemonSet/mirror pod is never evicted, so
 * an unmanaged flag on one of those does not count.
 */
export function requiresTypedConfirm(preview: DrainPreview | null): boolean {
  if (!preview) return true;
  return preview.pods.some((p) => p.category === "evict" && p.unmanaged);
}

export interface RunCounts {
  total: number;
  evicted: number;
  gone: number;
  /** Pods removed by a direct delete, bypassing the PDB. Counted on their own, never as "evicted". */
  forced: number;
  evicting: number;
  deleting: number;
  waiting: number;
  blocked: number;
  failed: number;
  /** Settled for this pass: evicted + gone + forced + blocked + failed. */
  done: number;
}

export function runCounts(rows: DrainRow[]): RunCounts {
  const c: RunCounts = { total: rows.length, evicted: 0, gone: 0, forced: 0, evicting: 0, deleting: 0, waiting: 0, blocked: 0, failed: 0, done: 0 };
  for (const r of rows) {
    switch (r.status) {
      case "evicted": c.evicted++; break;
      case "gone": c.gone++; break;
      case "force-deleted": c.forced++; break;
      case "evicting": c.evicting++; break;
      case "deleting": c.deleting++; break;
      case "waiting": c.waiting++; break;
      case "blocked": c.blocked++; break;
      case "failed": c.failed++; break;
    }
  }
  c.done = c.evicted + c.gone + c.forced + c.blocked + c.failed;
  return c;
}

export type DrainOutcome = "complete" | "incomplete" | "stopped" | "failed";

/**
 * "complete" (the only outcome that may be titled "Node drained") requires
 * every row to have settled as evicted or gone: blocked = 0, failed = 0, and
 * nothing left waiting/in flight. `gone` never blocks it.
 */
export function drainOutcome(args: { rows: DrainRow[]; stopped: boolean; cordonFailed: boolean }): DrainOutcome {
  if (args.cordonFailed) return "failed";
  if (args.stopped) return "stopped";
  const c = runCounts(args.rows);
  if (c.blocked > 0 || c.failed > 0 || c.waiting > 0 || c.evicting > 0 || c.deleting > 0) return "incomplete";
  return "complete";
}

function sortRank(s: DrainRowStatus): number {
  switch (s) {
    case "blocked":
    case "failed": return 0;
    case "evicting":
    case "deleting": return 1;
    case "waiting": return 2;
    default: return 3; // evicted, gone
  }
}

/** blocked/failed → evicting → waiting → done; stable by namespace/name inside a rank. */
export function sortRows(rows: DrainRow[]): DrainRow[] {
  return [...rows].sort((a, b) => sortRank(a.status) - sortRank(b.status) || a.key.localeCompare(b.key));
}

/** "Blocked by PDB checkout-pdb (0 allowed)" — picks the PDB that actually refuses. */
export function pdbReason(pdbs: DrainPdbRef[]): string {
  const refusing = pdbs.find((p) => p.disruptions_allowed <= 0) ?? pdbs[0];
  if (!refusing) return "Blocked by a PodDisruptionBudget";
  return `Blocked by PDB ${refusing.name} (${Math.max(0, refusing.disruptions_allowed)} allowed)`;
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * One sentence of real counts. `evicted` is always present (including "0
 * evicted"); every other count only when non-zero.
 */
export function countsSentence(c: RunCounts, skipped: { daemonset: number; mirror: number }): string {
  const parts: string[] = [`${c.evicted} evicted`];
  if (c.forced > 0) parts.push(`${c.forced} force-deleted`);
  if (c.gone > 0) parts.push(`${c.gone} already gone`);
  if (c.blocked > 0) parts.push(`${c.blocked} blocked by a PodDisruptionBudget`);
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  if (c.waiting > 0) parts.push(`${c.waiting} not attempted`);
  const skip: string[] = [];
  if (skipped.daemonset > 0) skip.push(`${skipped.daemonset} DaemonSet`);
  if (skipped.mirror > 0) skip.push(`${skipped.mirror} static`);
  if (skip.length > 0) {
    const n = skipped.daemonset + skipped.mirror;
    parts.push(`${skip.join(" and ")} ${plural(n, "pod", "pods")} skipped`);
  }
  return parts.join(" · ");
}

export function outcomeTitle(outcome: DrainOutcome, node: string, nothingToEvict: boolean, forced = 0): string {
  switch (outcome) {
    case "complete":
      if (forced > 0) return `Node drained, ${forced} ${plural(forced, "pod", "pods")} force-deleted`;
      return nothingToEvict ? `Node ${node} cordoned` : "Node drained";
    case "incomplete": return `Drain incomplete on ${node}`;
    case "stopped": return "Drain stopped";
    case "failed": return "Drain failed";
  }
}

export const CORDON_LINE_REMAINS = "Node remains cordoned. Uncordon to return it to service.";
export const CORDON_LINE_COMPLETE =
  "Node is cordoned. Evicted pods stop within their termination grace period. Uncordon when maintenance is done.";

export function cordonLine(outcome: DrainOutcome): string {
  return outcome === "complete" ? CORDON_LINE_COMPLETE : CORDON_LINE_REMAINS;
}

/** Rows a force-delete may target: only the ones currently blocked, never failed or waiting. */
export function forceDeletable(rows: DrainRow[]): DrainRow[] {
  return rows.filter((r) => r.status === "blocked");
}

/**
 * Default per-pod selection for the force-delete dialog (D3-14): every blocked pod, checked,
 * up to the cluster's bulk limit; the rest start unchecked. `limit` null = no limit.
 */
export function defaultForceSelection(rows: DrainRow[], limit: number | null): Set<string> {
  const keys = forceDeletable(rows).map((r) => r.key);
  return new Set(limit === null ? keys : keys.slice(0, limit));
}

/**
 * A `delete_pod` rejection that means the pod is already gone (HTTP 404). The backend wraps
 * the kube error as "Failed to delete pod: ApiError: ... NotFound (ErrorResponse { ... code:
 * 404 })". A connect failure ("Failed to connect: ...") never matches, even if it says
 * "not found".
 */
export function isDeletePodNotFound(message: string): boolean {
  if (!message.startsWith("Failed to delete pod:")) return false;
  return /\bNotFound\b|code:\s*404\b/.test(message);
}
