import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccessChecks, useClusterAccess, useGetPod } from "./useResources";
import { debugCard, type DebugCard } from "../utils/debugContainer";
import {
  DEBUG_DENIED_REASON, DEBUG_FINISHED_REASON, DEBUG_UNSUPPORTED_REASON, isFinishedPodStatus, supportsEphemeralContainers,
} from "../utils/debugContainer";
import { pickDisabledReason } from "../utils/guardrails";
import { deniedNamespaces, ephemeralContainerCheck } from "../utils/permissionHints";
import type { EphemeralContainerInfo, Pod, ShellClosed } from "../types/k8s";

// Debug container session state for the pod detail panel (v1.3.1 F7, UXP-24).
//
// It is owned by DetailPanel, NOT by the Shell tab: tab content is keyed `pod.name-tab`, so
// leaving the Shell tab unmounts it, and a session held there would lose "Waiting:
// ImagePullBackOff" and the NAME of a container that now exists permanently in the pod spec.
//
// Pod data comes from the `get_pod` query (fresh), falling back to the matching row of the
// App's pods list, then to the click-time snapshot (C-6): the snapshot's `status` (the Q-L10
// gate) and `ephemeral_containers` go stale because nothing refreshes it.

export interface DebugSession {
  name: string;
  image: string;
  target: string | null;
  startedAt: number;
}

/** What the Shell tab body shows for a debug container. */
export type DebugMode = "strip" | "terminal" | "detached";

export interface DebugState {
  session: DebugSession | null;
  mode: DebugMode;
  stopWaiting: boolean;
  /** UXA-2: "Keep waiting" on the pull-failing card; hides the card, keeps polling. */
  keepWaiting: boolean;
  /** The terminal reported its output loop ended (`shell-closed`). */
  closed: ShellClosed | null;
  connected: boolean;
  /** The freshest pod we have. */
  pod: Pod;
  podGone: boolean;
  ephemeral: EphemeralContainerInfo | undefined;
  card: DebugCard;
  /** Why "Debug container…" is disabled, in DISABLE-PRECEDENCE order; undefined = enabled. */
  entryReason: string | undefined;
  dialogOpen: boolean;
}

export interface DebugActions {
  openDialog: () => void;
  closeDialog: () => void;
  started: (s: DebugSession) => void;
  attach: () => void;
  detach: () => void;
  stopWaitingNow: () => void;
  keepWaitingNow: () => void;
  clear: () => void;
  onConnected: () => void;
  onClosed: (c: ShellClosed) => void;
}

export function useDebugSession(args: {
  context: string;
  snapshot: Pod;
  podsList?: Pod[];
  tab: string;
  /** D3-7: set while read-only blocks shells. The session detaches and Attach is disabled. */
  shellReason: string | undefined;
  readOnly: boolean;
}): DebugState & DebugActions {
  const { context, snapshot, podsList, tab, shellReason, readOnly } = args;
  const [session, setSession] = useState<DebugSession | null>(null);
  const [mode, setMode] = useState<DebugMode>("strip");
  const [stopWaiting, setStopWaiting] = useState(false);
  const [keepWaiting, setKeepWaiting] = useState(false);
  const [closed, setClosed] = useState<ShellClosed | null>(null);
  const [connected, setConnected] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // A different pod is a different session. (The panel keeps the same component instance.)
  useEffect(() => {
    setSession(null);
    setMode("strip");
    setStopWaiting(false);
    setKeepWaiting(false);
    setClosed(null);
    setConnected(false);
    setDialogOpen(false);
  }, [snapshot.namespace, snapshot.name]);

  const onShellOrContainers = tab === "Shell" || tab === "Containers";
  // The strip is "visible" while a session exists on the Shell tab and no terminal is attached.
  const stripVisible = !!session && tab === "Shell" && mode !== "terminal";
  const fresh = useGetPod(context, snapshot.namespace, snapshot.name, onShellOrContainers, stripVisible ? 2000 : false);
  const row = podsList?.find((p) => p.namespace === snapshot.namespace && p.name === snapshot.name);
  const podGone = fresh.data === null;
  const pod: Pod = fresh.data ?? row ?? snapshot;
  const ephemeral = session ? pod.ephemeral_containers?.find((e) => e.name === session.name) : undefined;
  const card = debugCard(podGone, ephemeral);

  // Auto-attach: once the container is running (and the user did not "Stop waiting").
  useEffect(() => {
    if (!session || mode !== "strip" || stopWaiting || shellReason) return;
    if (card.kind === "running") setMode("terminal");
  }, [session, mode, stopWaiting, shellReason, card.kind]);

  // Leaving the Shell tab unmounts the terminal (which stops the session): that is a detach.
  useEffect(() => {
    if (tab !== "Shell" && mode === "terminal") { setMode("detached"); setConnected(false); }
  }, [tab, mode]);

  // §0.5 / D3-7: read-only turned on -> the terminal unmounted (DetailPanel renders the
  // closed state in its place). The container keeps running; the strip shows Detached.
  useEffect(() => {
    if (shellReason && mode === "terminal") { setMode("detached"); setConnected(false); }
  }, [shellReason, mode]);

  // Gates, DISABLE-PRECEDENCE order: read-only, RBAC, capability, finished pod.
  const checks = useMemo(() => ephemeralContainerCheck(snapshot.namespace), [snapshot.namespace]);
  const { data: access } = useAccessChecks(context, checks, tab === "Shell");
  const { data: clusterAccess } = useClusterAccess(context);
  const entryReason = pickDisabledReason({
    readOnly,
    rbac: deniedNamespaces(checks, access).length > 0 ? DEBUG_DENIED_REASON : undefined,
    capability: supportsEphemeralContainers(clusterAccess?.server_version) ? undefined : DEBUG_UNSUPPORTED_REASON,
    finished: isFinishedPodStatus(pod.status) ? DEBUG_FINISHED_REASON : undefined,
  });

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);
  const started = useCallback((s: DebugSession) => {
    setSession(s);
    setMode("strip");
    setStopWaiting(false);
    setKeepWaiting(false);
    setClosed(null);
    setConnected(false);
    setDialogOpen(false);
  }, []);
  const attach = useCallback(() => { setClosed(null); setConnected(false); setStopWaiting(false); setMode("terminal"); }, []);
  const detach = useCallback(() => { setMode("detached"); setConnected(false); }, []);
  const stopWaitingFn = useCallback(() => setStopWaiting(true), []);
  const keepWaitingFn = useCallback(() => setKeepWaiting(true), []);
  const clear = useCallback(() => { setSession(null); setKeepWaiting(false); setClosed(null); setConnected(false); setMode("strip"); }, []);
  const onConnected = useCallback(() => setConnected(true), []);
  const onClosed = useCallback((c: ShellClosed) => { setClosed(c); setMode("detached"); setConnected(false); }, []);

  return {
    session, mode, stopWaiting, keepWaiting, closed, connected, pod, podGone, ephemeral, card, entryReason, dialogOpen,
    openDialog, closeDialog, started, attach, detach, stopWaitingNow: stopWaitingFn, keepWaitingNow: keepWaitingFn, clear, onConnected, onClosed,
  };
}
