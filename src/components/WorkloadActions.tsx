import { useMemo, useState, memo } from "react";
import { Play, RotateCw, Pause, StepBack } from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { disabledAttrs, pickDisabledReason } from "../utils/guardrails";
import { rollbackDeploymentEquiv, rolloutPauseEquiv, rolloutRestartEquiv, scaleEquiv, triggerCronJobEquiv } from "../utils/kubectlEquiv";
import {
  useScaleWorkload, useRestartWorkload, usePauseDeployment, useResumeDeployment,
  useRolloutHistory, useRollbackDeployment, useTriggerCronJob,
  useResourceMetadata, useWorkloadConditions, usePermissions, useResourceJson,
} from "../hooks/useResources";
import { DiffRows } from "./DiffRows";
import { changeCountText } from "../utils/diffRows";
import { currentTemplate, diffFailedText, noDiffSecondary, ROLLBACK_CONSEQUENCE, templateDiff } from "../utils/rolloutDiff";
import type { ResourceCondition, ResourceType, RevisionInfo } from "../types/k8s";

// §3.4 can-i (docs/plan-kubeconfig-and-parity.md §3.4) — every action button
// below is disabled with a reason tooltip when denied, never hidden. SSAR
// only answers RBAC, so the existing confirm-and-fail error handling (the
// Feedback pill on a caught error) is unchanged; greying out is a hint, not
// a guarantee.
const NO_PERMISSION_PATCH = "You don't have permission to update this resource";
const NO_PERMISSION_CREATE = "You don't have permission to create resources here";

// ─── Shared feedback pill ─────────────────────────────────────────────────────

const Feedback = memo(function Feedback({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div className={`mono text-[10.5px] px-2 py-1.5 rounded-sm mb-2 ${ok ? "text-ok bg-ok/10 ring-1 ring-ok/20" : "text-bad bg-bad/10 ring-1 ring-bad/20"}`}>
      {msg}
    </div>
  );
});

// ─── Scale ────────────────────────────────────────────────────────────────────

export const ScaleAction = memo(function ScaleAction({ context, namespace, kind, name, currentReplicas }: {
  context: string; namespace: string; kind: ResourceType; name: string; currentReplicas: number;
}) {
  const identity = useClusterIdentity(context);
  const [replicas, setReplicas] = useState(String(currentReplicas));
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmZero, setConfirmZero] = useState(false);
  const scale = useScaleWorkload();
  const perm = usePermissions(context, namespace, kind);
  const reason = pickDisabledReason({ readOnly: identity.readOnly, rbac: perm.canPatch ? undefined : NO_PERMISSION_PATCH });

  const handleScale = async () => {
    setResult(null);
    setConfirmZero(false);
    try {
      await scale.mutateAsync({ context, namespace, kind, name, replicas: parseInt(replicas) });
      setResult({ msg: `Scaled to ${replicas} replicas`, ok: true });
    } catch (e) {
      setResult({ msg: (e as any)?.message ?? String(e), ok: false });
    }
  };

  const handleApply = () => {
    if (reason) return;
    if (parseInt(replicas) === 0) {
      setConfirmZero(true);
    } else {
      handleScale();
    }
  };

  return (
    <div className="mt-3">
      <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5">Scale</div>
      {result && <Feedback {...result} />}
      <div className="flex items-center gap-2">
        <input
          type="number" min={0} value={replicas}
          onChange={(e) => setReplicas(e.target.value)}
          className="h-7 w-20 rounded-md bg-base ring-1 ring-edge mono text-[11px] text-ink px-2 focus:ring-accent focus:outline-hidden"
        />
        <button
          onClick={handleApply} disabled={scale.isPending}
          {...disabledAttrs(reason)}
          className={`h-7 px-3 rounded-md bg-accent/15 ring-1 ring-accent/30 text-[11px] text-accent hover:bg-accent/25 mono disabled:opacity-50 ${reason ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {scale.isPending ? "Scaling…" : "Apply"}
        </button>
      </div>
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={scaleEquiv({ context, namespace, kind, name, replicas: 0 })}
        open={confirmZero}
        title="Scale to zero"
        description={`This will scale "${name}" to 0 replicas. All running pods will be terminated.`}
        confirmLabel="Scale to 0"
        destructive
        onConfirm={handleScale}
        onCancel={() => setConfirmZero(false)}
        isPending={scale.isPending}
      />
    </div>
  );
});

// ─── Restart ─────────────────────────────────────────────────────────────────

const RESTART_KIND_LABEL: Partial<Record<ResourceType, string>> = {
  deploy: "Deployment",
  sts: "StatefulSet",
  ds: "DaemonSet",
};

// Server text is shown verbatim; strip only a trailing period so the sentence
// the copy deck wraps around it doesn't end in "..".
function serverMsg(e: unknown): string {
  return String((e as any)?.message ?? e).replace(/\.+$/, "");
}

export const RestartAction = memo(function RestartAction({ context, namespace, kind, name }: {
  context: string; namespace: string; kind: ResourceType; name: string;
}) {
  const identity = useClusterIdentity(context);
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restart = useRestartWorkload();
  const perm = usePermissions(context, namespace, kind);
  const kindLabel = RESTART_KIND_LABEL[kind] ?? "workload";
  const reason = pickDisabledReason({ readOnly: identity.readOnly, rbac: perm.canPatch ? undefined : NO_PERMISSION_PATCH });

  const handle = async () => {
    setError(null);
    try {
      await restart.mutateAsync({ context, namespace, kind, name });
      setConfirmOpen(false);
      setResult({ msg: `Restarted "${name}".`, ok: true });
    } catch (e) {
      // Dialog stays open; the status slot carries the error and the primary becomes "Try again".
      setError(`Couldn't restart "${name}": ${serverMsg(e)}. Check that your account can update ${kindLabel.toLowerCase()}s in ${namespace}, or ask a cluster admin.`);
    }
  };

  return (
    <div className="mt-2">
      {result && <Feedback {...result} />}
      <button
        onClick={() => { if (reason) return; setResult(null); setError(null); setConfirmOpen(true); }}
        disabled={restart.isPending}
        {...disabledAttrs(reason)}
        className={`h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11px] text-mute hover:text-ink mono flex items-center gap-1.5 disabled:opacity-50 ${reason ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <RotateCw size={11} /> {restart.isPending ? "Restarting…" : "Rolling Restart…"}
      </button>
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={rolloutRestartEquiv({ context, namespace, kind, name })}
        open={confirmOpen}
        title={`Restart ${kindLabel} ${name}`}
        description={`Replaces every pod of "${name}" with a new one, rolling, according to its update strategy. Pods keep serving until replacements are ready.`}
        confirmLabel={restart.isPending ? "Restarting…" : error ? "Try again" : `Restart ${kindLabel}`}
        destructive={false}
        phase={error ? "error" : "review"}
        status={error ? { tone: "error", text: error } : null}
        onConfirm={handle}
        onCancel={() => { setConfirmOpen(false); setError(null); }}
        isPending={restart.isPending}
      />
    </div>
  );
});

// ─── Pause / Resume ───────────────────────────────────────────────────────────

export const PauseResumeAction = memo(function PauseResumeAction({ context, namespace, name, paused }: {
  context: string; namespace: string; name: string; paused: boolean;
}) {
  const identity = useClusterIdentity(context);
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pause = usePauseDeployment();
  const resume = useResumeDeployment();
  const perm = usePermissions(context, namespace, "deploy");
  const busy = pause.isPending || resume.isPending;
  const reason = pickDisabledReason({ readOnly: identity.readOnly, rbac: perm.canPatch ? undefined : NO_PERMISSION_PATCH });

  const handle = async () => {
    setError(null);
    try {
      if (paused) {
        await resume.mutateAsync({ context, namespace, name });
        setResult({ msg: `Resumed rollouts for "${name}".`, ok: true });
      } else {
        await pause.mutateAsync({ context, namespace, name });
        setResult({ msg: `Paused rollouts for "${name}".`, ok: true });
      }
      setConfirmOpen(false);
    } catch (e) {
      setError(
        `Couldn't ${paused ? "resume" : "pause"} rollouts for "${name}": ${serverMsg(e)}. Check that your account can update deployments in ${namespace}.`,
      );
    }
  };

  return (
    <div className="mt-2">
      {result && <Feedback {...result} />}
      <button
        onClick={() => { if (reason) return; setResult(null); setError(null); setConfirmOpen(true); }}
        disabled={busy}
        {...disabledAttrs(reason)}
        className={`h-7 px-3 rounded-md ring-1 text-[11px] mono flex items-center gap-1.5 disabled:opacity-50 ${reason ? "opacity-50 cursor-not-allowed " : ""}${
          paused
            ? "bg-ok/10 ring-ok/30 text-ok hover:bg-ok/20"
            : "bg-warn/10 ring-warn/30 text-warn hover:bg-warn/20"
        }`}
      >
        <Pause size={11} /> {busy ? "…" : paused ? "Resume…" : "Pause…"}
      </button>
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={rolloutPauseEquiv({ context, namespace, name, resume: paused })}
        open={confirmOpen}
        title={paused ? `Resume rollouts for ${name}` : `Pause rollouts for ${name}`}
        description={
          paused
            ? "Rollouts start again. Any pod template changes made while paused will roll out now."
            : "Rollouts stop until you resume. Changes to the pod template won't roll out. Scaling still works, and running pods are not touched."
        }
        confirmLabel={
          busy ? (paused ? "Resuming…" : "Pausing…") : error ? "Try again" : paused ? "Resume rollouts" : "Pause rollouts"
        }
        destructive={false}
        phase={error ? "error" : "review"}
        status={error ? { tone: "error", text: error } : null}
        onConfirm={handle}
        onCancel={() => { setConfirmOpen(false); setError(null); }}
        isPending={busy}
      />
    </div>
  );
});

// ─── Rollout History ──────────────────────────────────────────────────────────

// #9: the pod-template diff shown in the rollback confirm AND the read-only Compare dialog.
// Left = the current template, right = revision #N (the rollback direction). It is
// INFORMATIONAL, never a gate: if it cannot load, the rollback stays available.
function RolloutDiffBody({
  rev, deploy, loading, error,
}: { rev: RevisionInfo; deploy: Record<string, unknown> | undefined; loading: boolean; error: string }) {
  const result = useMemo(
    () => (deploy ? templateDiff(currentTemplate(deploy), rev.template) : null),
    [deploy, rev.template],
  );
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        <p className="text-[11.5px] text-dim">Comparing…</p>
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-3 rounded-sm bg-surface-tint/5 motion-safe:animate-pulse" />)}
      </div>
    );
  }
  if (error || !result) return <p className="text-[12px] text-mute">{diffFailedText(error || "no data")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10.5px] text-dim">−  in the current template   +  in revision #{rev.revision}   ~  differs</p>
      <span className="self-start text-[11.5px] text-ink px-2 py-0.5 rounded-md bg-surface-tint/4 ring-1 ring-edge">
        {result.changed === 0 ? "No differences" : `${changeCountText(result.changed)} to the pod template`}
      </span>
      <DiffRows
        result={result}
        insideDefaultOpen
        label={`Pod template changes for revision #${rev.revision}`}
        emptyTitle="No differences."
        emptySecondary={noDiffSecondary(rev.revision)}
      />
    </div>
  );
}

export const RolloutHistory = memo(function RolloutHistory({ context, namespace, name }: {
  context: string; namespace: string; name: string; currentRevision?: number;
}) {
  const identity = useClusterIdentity(context);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [compare, setCompare] = useState<number | null>(null);
  const [comparedAt, setComparedAt] = useState("");
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const { data: history = [], isLoading } = useRolloutHistory(context, namespace, name, true);
  const rollback = useRollbackDeployment();
  const perm = usePermissions(context, namespace, "deploy");
  // The current template is a READ (get_resource_json): not backstopped, and it fails soft.
  const dialogOpen = confirm !== null || compare !== null;
  const deployJson = useResourceJson(context, namespace, "deploy", name, dialogOpen);
  const shownRev = history.find((r) => r.revision === (confirm ?? compare));
  const diffError = deployJson.isError ? ((deployJson.error as any)?.message ?? String(deployJson.error)) : "";
  const stamp = () => new Date().toLocaleTimeString([], { hour12: false });
  // Read-only disables Rollback only; the (read-only) Compare view stays available.
  const reason = pickDisabledReason({ readOnly: identity.readOnly, rbac: perm.canPatch ? undefined : NO_PERMISSION_PATCH });

  const handleRollback = async (revision: number) => {
    setResult(null);
    try {
      await rollback.mutateAsync({ context, namespace, name, revision });
      setResult({ msg: `Rolled back to revision ${revision}`, ok: true });
    } catch (e) {
      setResult({ msg: (e as any)?.message ?? String(e), ok: false });
    }
    setConfirm(null);
  };

  return (
    <div className="mt-4">
      <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5">Rollout History</div>
      {result && <Feedback {...result} />}
      {isLoading ? (
        <div className="flex flex-col gap-1.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-7 rounded-sm bg-surface-tint/3 animate-pulse" />)}</div>
      ) : history.length === 0 ? (
        <div className="text-[12px] text-dim py-3 text-center">No history available</div>
      ) : (
        <div className="rounded-lg ring-1 ring-edge overflow-hidden">
          {history.map((rev, i) => (
            <div key={rev.revision} className={`flex items-center gap-2 px-3 py-2 text-[11.5px] ${i < history.length - 1 ? "border-b border-edge-raw/60" : ""}`}>
              <span className="mono text-dim w-6 shrink-0">#{rev.revision}</span>
              <span className="mono text-mute truncate flex-1 text-[11px]" title={rev.image}>{rev.image.split("/").pop()}</span>
              <span className="mono text-dim text-[10.5px] shrink-0">{rev.age}</span>
                <button
                  onClick={() => { setComparedAt(stamp()); setCompare(rev.revision); }}
                  className="h-5 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[9.5px] text-mute hover:text-ink mono shrink-0"
                  title="Compare this revision pod template with the current one"
                >
                  Compare
                </button>
                <button
                  onClick={() => { if (reason) return; setComparedAt(stamp()); setConfirm(rev.revision); }}
                  {...disabledAttrs(reason)}
                  className={`h-5 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[9.5px] text-mute hover:text-ink mono flex items-center gap-1 shrink-0 ${reason ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <StepBack size={9} /> Rollback
                </button>
            </div>
          ))}
        </div>
      )}
      {/* Rollback confirm: lg, non-destructive (a rollback loses no data; the revision it replaces is itself in history). */}
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={confirm !== null ? rollbackDeploymentEquiv({ context, namespace, name, revision: confirm }) : null}
        open={confirm !== null}
        size="lg"
        title={`Roll back ${name} to revision #${confirm ?? ""}`}
        description={
          <>
            {ROLLBACK_CONSEQUENCE}
            {comparedAt && <span className="block mt-0.5 text-[11.5px] text-dim">Compared {comparedAt}. The cluster can change before you confirm.</span>}
          </>
        }
        confirmLabel={`Roll back to #${confirm ?? ""}`}
        destructive={false}
        onConfirm={() => { if (confirm !== null) handleRollback(confirm); }}
        onCancel={() => setConfirm(null)}
        isPending={rollback.isPending}
      >
        {shownRev && confirm !== null && (
          <RolloutDiffBody rev={shownRev} deploy={deployJson.data} loading={deployJson.isLoading} error={diffError} />
        )}
      </ConfirmModal>

      {/* Compare: the same body, read-only. Nothing is written, so no kubectl equivalent and no guardrail notice. */}
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        ignoreGuardrails
        open={compare !== null}
        size="lg"
        title={`Compare revision #${compare ?? ""} with current`}
        description={comparedAt ? `Compared ${comparedAt}. The cluster can change after this.` : ""}
        confirmLabel="Close"
        confirmDisabled
        destructive={false}
        initialFocus="cancel"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => { const n = compare; setCompare(null); if (n !== null && !reason) { setComparedAt(stamp()); setConfirm(n); } }}
              {...disabledAttrs(reason)}
              className={`text-[12px] text-accent hover:underline ${reason ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Roll back to this revision…
            </button>
            <button
              type="button"
              data-modal-cancel
              onClick={() => setCompare(null)}
              className="px-3 py-1.5 rounded-lg text-[12.5px] text-mute ring-1 ring-edge hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Close
            </button>
          </div>
        }
        onConfirm={() => setCompare(null)}
        onCancel={() => setCompare(null)}
      >
        {shownRev && compare !== null && (
          <RolloutDiffBody rev={shownRev} deploy={deployJson.data} loading={deployJson.isLoading} error={diffError} />
        )}
      </ConfirmModal>
    </div>
  );
});

// ─── CronJob Trigger ─────────────────────────────────────────────────────────

export const TriggerCronJob = memo(function TriggerCronJob({ context, namespace, name, suspended }: {
  context: string; namespace: string; name: string;
  /** Adds the "manual run still creates a Job" line. Omit when unknown — no extra fetch. */
  suspended?: boolean;
}) {
  const identity = useClusterIdentity(context);
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useTriggerCronJob();
  // Manual Trigger creates a Job, not a CronJob patch.
  const perm = usePermissions(context, namespace, "jobs");
  const reason = pickDisabledReason({ readOnly: identity.readOnly, rbac: perm.canCreate ? undefined : NO_PERMISSION_CREATE });

  const handle = async () => {
    setError(null);
    try {
      const jobName = await trigger.mutateAsync({ context, namespace, name });
      setConfirmOpen(false);
      setResult({ msg: `Created Job "${jobName}" from "${name}".`, ok: true });
    } catch (e) {
      setError(`Couldn't create a Job from "${name}": ${serverMsg(e)}. Check that your account can create jobs in ${namespace}.`);
    }
  };

  return (
    <div className="mt-4">
      <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5">Manual Trigger</div>
      {result && <Feedback {...result} />}
      <button
        onClick={() => { if (reason) return; setResult(null); setError(null); setConfirmOpen(true); }}
        disabled={trigger.isPending}
        {...disabledAttrs(reason)}
        className={`h-7 px-3 rounded-md bg-accent/15 ring-1 ring-accent/30 text-[11px] text-accent hover:bg-accent/25 mono flex items-center gap-1.5 disabled:opacity-50 ${reason ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <Play size={11} /> {trigger.isPending ? "Creating…" : "Trigger Now…"}
      </button>
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={triggerCronJobEquiv({ context, namespace, name })}
        open={confirmOpen}
        title={`Run ${name} now`}
        description={
          `Creates a Job from this CronJob's template now, outside its schedule. The schedule is unchanged. To stop the run, delete the Job.` +
          (suspended ? " This CronJob is suspended; a manual run still creates a Job." : "")
        }
        confirmLabel={trigger.isPending ? "Creating…" : error ? "Try again" : "Create Job"}
        destructive={false}
        phase={error ? "error" : "review"}
        status={error ? { tone: "error", text: error } : null}
        onConfirm={handle}
        onCancel={() => { setConfirmOpen(false); setError(null); }}
        isPending={trigger.isPending}
      />
    </div>
  );
});

// ─── Annotations ─────────────────────────────────────────────────────────────

export const ResourceAnnotations = memo(function ResourceAnnotations({ context, namespace, resourceType, name }: {
  context: string; namespace: string; resourceType: string; name: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: metadata, isLoading } = useResourceMetadata(context, namespace, resourceType, name, true);
  const entries = Object.entries(metadata?.annotations ?? {}).filter(([k]) => !k.startsWith("kubectl.kubernetes.io/last-applied"));
  if (isLoading || entries.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded(v => !v)}
        className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5 flex items-center gap-1.5 hover:text-mute"
      >
        Annotations ({entries.length})
        <span className="text-[9px]">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
          {entries.map(([k, v]) => (
            <div key={k} className="px-2 py-1 rounded-md bg-surface-tint/2 ring-1 ring-edge-raw/60">
              <div className="mono text-[10px] text-dim truncate">{k}</div>
              <div className="mono text-[11px] text-mute break-all">{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Conditions ──────────────────────────────────────────────────────────────

export const ResourceConditions = memo(function ResourceConditions({ context, namespace, kind, name }: {
  context: string; namespace: string; kind: string; name: string;
}) {
  const { data: conditions = [] } = useWorkloadConditions(context, namespace, kind, name, true);
  if (conditions.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5">Conditions</div>
      <div className="rounded-lg ring-1 ring-edge overflow-hidden">
        {conditions.map((c: ResourceCondition, i: number) => {
          const ok = c.status === "True";
          const color = ok ? "text-ok" : c.status === "False" ? "text-bad" : "text-dim";
          return (
            <div key={i} className={`px-3 py-2 text-[11.5px] flex items-start gap-3 ${i < conditions.length - 1 ? "border-b border-edge-raw/60" : ""}`}>
              <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${ok ? "bg-ok" : "bg-bad"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`mono text-[11px] font-medium ${color}`}>{c.type_}</span>
                  <span className="mono text-[10px] text-dim">{c.reason}</span>
                </div>
                {c.message && <div className="text-[11px] text-ink/70 mt-0.5 wrap-break-word">{c.message}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
