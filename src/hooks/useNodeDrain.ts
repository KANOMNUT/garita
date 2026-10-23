import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { drainPreviewQuery, useCordonNode, useDeletePod, useEvictPod } from "./useResources";
import type { DrainPreview } from "../types/k8s";
import {
  drainOutcome, isDeletePodNotFound, rowFromPreview, runCounts,
  type DrainOutcome, type DrainRow,
} from "../utils/drain";

// The drain run state machine (v1.2.1, docs/impl/v1.2.1-tasks.md §1.3 Q2).
//
// The FRONTEND drives the drain, one pod at a time, instead of a long-running
// backend task: cordon_node → preview_node_drain (fresh, after the cordon) →
// evict_pod per pod, sequentially. Every evict_pod call returns that pod's real
// outcome, so progress is per-pod and determinate, and there is no backend
// cancellation registry and no orphaned Tokio task when the panel unmounts.
//
//  - Stop is a ref checked BEFORE each new eviction; the in-flight call completes.
//  - One pass, then stop. A 429 is reported, never retried automatically and
//    never turned into a delete. "Retry blocked pods" is manual and re-runs
//    evict_pod over the `blocked` rows only.
//  - Closing the window mid-drain stops the loop after the in-flight eviction
//    and leaves the node cordoned (new Known Open Item — no quit warning yet).
//
// This hook calls only other hooks and query-client methods — never a direct Tauri call.

export type DrainRunPhase = "review" | "running" | "attention" | "result" | "error";
export type PreviewStatus = "loading" | "ready" | "failed";
export type CordonStep = "pending" | "done" | "already" | "failed";

export interface NodeDrainState {
  /** The dialog is on screen. Data survives close so "View details" can reopen it. */
  open: boolean;
  /** Any drain data exists (the dialog is open, or a result/attention card is pending). */
  active: boolean;
  phase: DrainRunPhase;
  preview: DrainPreview | null;
  previewStatus: PreviewStatus;
  previewError: string;
  snapshotAt: Date | null;
  rows: DrainRow[];
  skipped: { daemonset: number; mirror: number };
  attempt: number;
  stopping: boolean;
  stopped: boolean;
  cordonStep: CordonStep;
  /** Best knowledge of whether WE (or the user) left the node cordoned; null = unknown. */
  cordoned: boolean | null;
  errorMessage: string;
  outcome: DrainOutcome | null;
  startedAt: number | null;
  /** A drain is running or paused on blocked pods — the Drain button stays disabled. */
  busy: boolean;
  /** Pods being force-deleted in the current pass (0 = not force-deleting). F5. */
  forcing: number;
}

export interface NodeDrainControls {
  openReview: () => void;
  refreshPreview: () => void;
  start: () => void;
  stop: () => void;
  /** Leave `attention`: settle as an incomplete result without another pass. */
  stopAttention: () => void;
  retryBlocked: () => void;
  /**
   * F5: delete the given BLOCKED pods directly (bypassing the PodDisruptionBudget), one at a
   * time, through `delete_pod` with the default grace period. Only ever called from the
   * nested, typed-confirm dialog — never automatically, never as a retry path.
   */
  forceDelete: (keys: string[]) => void;
  /** Hide the dialog but keep the data (attention / result / error only). */
  close: () => void;
  /** Reopen the dialog on the existing data ("View details"). */
  reopen: () => void;
  /** Discard everything (Dismiss, or Cancel from review). */
  dismiss: () => void;
  markUncordoned: () => void;
}

const errText = (e: unknown): string => (e as any)?.message ?? String(e);

const INITIAL: NodeDrainState = {
  open: false,
  active: false,
  phase: "review",
  preview: null,
  previewStatus: "loading",
  previewError: "",
  snapshotAt: null,
  rows: [],
  skipped: { daemonset: 0, mirror: 0 },
  attempt: 0,
  stopping: false,
  stopped: false,
  cordonStep: "pending",
  cordoned: null,
  errorMessage: "",
  outcome: null,
  startedAt: null,
  busy: false,
  forcing: 0,
};

export function useNodeDrain(context: string, node: string): NodeDrainState & NodeDrainControls {
  const qc = useQueryClient();
  const cordon = useCordonNode();
  const evict = useEvictPod();
  const deletePod = useDeletePod();

  const [state, setState] = useState<NodeDrainState>(INITIAL);

  // runId invalidates an in-flight loop (node switch, dismiss, unmount) without
  // it ever touching state again. stopRef is the user's Stop.
  const runIdRef = useRef(0);
  const stopRef = useRef(false);
  const previewReqRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((p: Partial<NodeDrainState>) => setState((s) => ({ ...s, ...p })), []);

  const reset = useCallback(() => {
    runIdRef.current++;
    previewReqRef.current++;
    stopRef.current = false;
    setState(INITIAL);
  }, []);

  // A different node (or cluster) is a different drain. Unmount stops the loop
  // after its in-flight eviction.
  useEffect(() => {
    reset();
    return () => { runIdRef.current++; previewReqRef.current++; };
  }, [context, node, reset]);

  const loadPreview = useCallback(async () => {
    const req = ++previewReqRef.current;
    patch({ previewStatus: "loading", previewError: "" });
    try {
      const preview = await qc.fetchQuery(drainPreviewQuery(context, node));
      if (req !== previewReqRef.current) return;
      patch({ preview, previewStatus: "ready", snapshotAt: new Date() });
    } catch (e) {
      if (req !== previewReqRef.current) return;
      patch({ preview: null, previewStatus: "failed", previewError: errText(e) });
    }
  }, [qc, context, node, patch]);

  const openReview = useCallback(() => {
    runIdRef.current++;
    stopRef.current = false;
    setState({ ...INITIAL, open: true, active: true, phase: "review" });
    void loadPreview();
  }, [loadPreview]);

  const settle = useCallback((phase: "attention" | "result", rows: DrainRow[], stopped: boolean) => {
    patch({
      phase,
      rows,
      stopping: false,
      stopped,
      outcome: drainOutcome({ rows, stopped, cordonFailed: false }),
      busy: phase === "attention",
    });
    qc.invalidateQueries({ queryKey: ["nodes", context] });
    qc.invalidateQueries({ queryKey: ["node-pods", context, node] });
    qc.invalidateQueries({ queryKey: ["pods", context] });
  }, [patch, qc, context, node]);

  // One sequential pass over `targets` (row keys). `rowsIn` is the rows snapshot
  // the pass starts from; the loop keeps its own copy and mirrors it into state.
  const runPass = useCallback(async (runId: number, rowsIn: DrainRow[], targets: string[]) => {
    let rows = rowsIn;
    const apply = (key: string, status: DrainRow["status"], message = "") => {
      rows = rows.map((r) => (r.key === key ? { ...r, status, message } : r));
      patch({ rows });
    };

    for (const key of targets) {
      if (runIdRef.current !== runId) return;
      if (stopRef.current) break;
      const row = rows.find((r) => r.key === key);
      if (!row) continue;
      apply(key, "evicting");
      try {
        const res = await evict.mutateAsync({ context, namespace: row.namespace, name: row.name });
        if (runIdRef.current !== runId) return;
        apply(key, res.outcome, res.message);
      } catch (e) {
        if (runIdRef.current !== runId) return;
        // A rejected invoke is a failed row whose message is the error string.
        apply(key, "failed", errText(e));
      }
    }

    if (runIdRef.current !== runId) return;
    if (stopRef.current) {
      // Rows never attempted go back to "waiting" (already are); an eviction
      // that was in flight completed and is recorded above.
      settle("result", rows, true);
    } else if (runCounts(rows).blocked > 0) {
      settle("attention", rows, false);
    } else {
      settle("result", rows, false);
    }
  }, [evict, context, patch, settle]);

  const start = useCallback(async () => {
    const runId = ++runIdRef.current;
    stopRef.current = false;
    const before = stateRef.current;
    patch({
      phase: "running", stopping: false, stopped: false, errorMessage: "", outcome: null,
      attempt: 1, startedAt: Date.now(), busy: true, rows: [],
      cordonStep: before.preview?.unschedulable ? "already" : "pending",
    });

    // Step 1: cordon, unless the snapshot says it already is.
    if (!before.preview?.unschedulable) {
      try {
        await cordon.mutateAsync({ context, node });
      } catch (e) {
        if (runIdRef.current !== runId) return;
        patch({
          phase: "error", busy: false, cordonStep: "failed", outcome: "failed",
          errorMessage: `Couldn't cordon ${node}: ${errText(e)}. No pods were evicted. Check that your account can update nodes, or ask a cluster admin.`,
        });
        return;
      }
      if (runIdRef.current !== runId) return;
      patch({ cordonStep: "done", cordoned: true });
    } else {
      patch({ cordoned: true });
    }

    // Step 2: a FRESH preview, taken after the cordon, decides the targets.
    let fresh: DrainPreview;
    try {
      fresh = await qc.fetchQuery(drainPreviewQuery(context, node));
    } catch (e) {
      if (runIdRef.current !== runId) return;
      patch({
        phase: "error", busy: false, outcome: "failed",
        errorMessage: `Couldn't list pods on ${node}: ${errText(e)}. No pods were evicted.`,
      });
      return;
    }
    if (runIdRef.current !== runId) return;

    const rows = fresh.pods.filter((p) => p.category === "evict").map(rowFromPreview);
    patch({
      preview: fresh,
      rows,
      skipped: {
        daemonset: fresh.pods.filter((p) => p.category === "daemonset").length,
        mirror: fresh.pods.filter((p) => p.category === "mirror").length,
      },
    });

    // Step 3: evict, sequentially.
    await runPass(runId, rows, rows.map((r) => r.key));
  }, [cordon, qc, context, node, patch, runPass]);

  const retryBlocked = useCallback(() => {
    const cur = stateRef.current;
    const targets = cur.rows.filter((r) => r.status === "blocked").map((r) => r.key);
    if (targets.length === 0) return;
    const runId = ++runIdRef.current;
    stopRef.current = false;
    patch({
      phase: "running", stopping: false, stopped: false, outcome: null, busy: true,
      attempt: cur.attempt + 1, startedAt: Date.now(),
    });
    void runPass(runId, cur.rows, targets);
  }, [patch, runPass]);

  const forceDelete = useCallback(async (keys: string[]) => {
    const cur = stateRef.current;
    const targets = keys.filter((k) => cur.rows.some((r) => r.key === k && r.status === "blocked"));
    if (targets.length === 0) return;
    const runId = ++runIdRef.current;
    stopRef.current = false;
    patch({
      phase: "running", stopping: false, stopped: false, outcome: null, busy: true,
      startedAt: Date.now(), forcing: targets.length,
    });
    let rows = cur.rows;
    const apply = (key: string, status: DrainRow["status"], message = "") => {
      rows = rows.map((r) => (r.key === key ? { ...r, status, message } : r));
      patch({ rows });
    };
    for (const key of targets) {
      if (runIdRef.current !== runId) return;
      // Stop applies before each NEXT delete; the one in flight completes.
      if (stopRef.current) break;
      const row = rows.find((r) => r.key === key);
      if (!row) continue;
      apply(key, "deleting");
      try {
        await deletePod.mutateAsync({ context, namespace: row.namespace, podName: row.name });
        if (runIdRef.current !== runId) return;
        apply(key, "force-deleted");
      } catch (e) {
        if (runIdRef.current !== runId) return;
        const text = errText(e);
        // A 404 means the pod vanished meanwhile: count it as `gone`, never as blocked again.
        if (isDeletePodNotFound(text)) apply(key, "gone");
        // Back to `blocked` (not `failed`): Retry and Override can still reach it.
        else apply(key, "blocked", `Force delete failed: ${text}`);
      }
    }
    if (runIdRef.current !== runId) return;
    patch({ forcing: 0 });
    if (stopRef.current) settle("result", rows, true);
    else if (runCounts(rows).blocked > 0) settle("attention", rows, false);
    else settle("result", rows, false);
  }, [deletePod, context, patch, settle]);

  const stop = useCallback(() => {
    stopRef.current = true;
    patch({ stopping: true });
  }, [patch]);

  const stopAttention = useCallback(() => {
    const rows = stateRef.current.rows;
    patch({
      phase: "result", busy: false, stopped: false,
      outcome: drainOutcome({ rows, stopped: false, cordonFailed: false }),
    });
  }, [patch]);

  const close = useCallback(() => {
    // Never while a pass is in flight — the dialog has no close control then.
    if (stateRef.current.phase === "running") return;
    patch({ open: false });
  }, [patch]);

  const reopen = useCallback(() => patch({ open: true }), [patch]);

  const dismiss = useCallback(() => {
    if (stateRef.current.phase === "running") return;
    reset();
  }, [reset]);

  const markUncordoned = useCallback(() => patch({ cordoned: false }), [patch]);

  return {
    ...state,
    openReview, refreshPreview: () => { void loadPreview(); }, start: () => { void start(); },
    stop, stopAttention, retryBlocked, forceDelete: (keys: string[]) => { void forceDelete(keys); }, close, reopen, dismiss, markUncordoned,
  };
}
