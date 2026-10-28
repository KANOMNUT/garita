import { useState, useEffect, useRef, Fragment } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useResizablePanel } from "../hooks/useResizablePanel";
import { GitCompare, X, Boxes, Eye, EyeOff, Copy, Check, AlertTriangle, Play, Square, Wifi, RefreshCw, RefreshCcw, GitMerge, Loader2, Plus, GitCommit, Trash2, Pencil, CheckCircle2, ArrowUpRight, ChevronRight, StepBack, Network } from "lucide-react";
import { useResourceYaml, useResourceEvents, useApplyResource, useCRDResources, useNodePods, useCordonNode, useUncordonNode, useDeleteNode, useAddNodeTaint, useRemoveNodeTaint, useStartServicePortForward, usePortForwards, useStopPortForward, useHelmValues, useUpgradeHelmRelease, useHelmHistory, useRollbackHelmRelease, useSyncArgoCdApp, useRollbackArgoCdApp, useRefreshArgoCdApp, useArgoCdCommitInfo, useArgoCdAppResources, useWorkloadPods, useResourceMetadata, useWorkloadConditions, useResourceGraph, useDeleteResource, useDeleteArgoCdApp, useUninstallHelmRelease, useTlsCertificateInfo, usePermissions, useResourceYamlNeat } from "../hooks/useResources";
import type { SelectedResource, ArgoCdResource, ResourceType, MapKind, Pod, GraphNode, PodTemplateSpec, ArgoCdHistoryEntry, TlsCertInfo, HelmRevision, NamespaceRow } from "../types/k8s";
import { useRevealedSecret, forgetSecret, forgetHelmValues, useAccessChecks } from "../hooks/useResources";
import { deniedNamespaces, secretGetCheck } from "../utils/permissionHints";
import { formatSecretSize, hasRedactionSentinel, helmEditSeed } from "../utils/secretReveal";
import { expiryState } from "../utils/expiry";
import { KIND_TO_RESOURCE_TYPE } from "../utils/kindToResourceType";
import {
  ScaleAction, RestartAction, PauseResumeAction, RolloutHistory, TriggerCronJob,
  ResourceAnnotations, ResourceConditions,
} from "./WorkloadActions";
import { ConfirmModal } from "./ConfirmModal";
import { loadNeatPref, saveNeatPref } from "../utils/neatYaml";
import { NeatChip, NeatNote } from "./NeatYaml";
import { YamlFind } from "./YamlFind";
import { NEAT_NO_MATCH_HINT, REDACTED_NO_MATCH_HINT } from "../utils/yamlFind";
import { PropagationPicker, deleteLabelFor, propagationDependents, usePropagationState } from "./PropagationPicker";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { disabledAttrs, pickDisabledReason } from "../utils/guardrails";
import {
  argoDeleteEquiv, argoRefreshEquiv, argoRollbackEquiv, argoSyncEquiv, cordonEquiv, deleteEquiv, deleteNodeEquiv,
  helmRollbackEquiv, helmUninstallEquiv, taintEquiv,
} from "../utils/kubectlEquiv";
import { YamlSaveGate } from "./YamlSaveGate";
import { HelmUpgradeGate } from "./HelmUpgradeGate";
import { ReadOnlyChip } from "./ReadOnlyBadge";
import { ExplainCard, ProblemChip, useExplain } from "./health/ExplainCard";
import { ConstraintsSection } from "./ConstraintsSection";
import { isConstraintKind } from "../utils/constraints";
import { ResourceCompareDialog } from "./ResourceCompareDialog";
import { FieldManagers } from "./FieldManagers";
import { PermissionsSection, PERMISSION_KINDS } from "./PermissionsSection";
import { canCompare } from "../utils/resourceCompare";
import { MAP_PANEL_KINDS } from "../utils/resourceMap";
import { TIMELINE_KINDS } from "../utils/timeline";
import { TimelineTab } from "./TimelineTab";
import { useGuardedAction } from "./GuardedActionConfirm";
import { EDIT_FORM } from "./edit/registry";
import { ResourceEditor } from "./edit/ResourceEditor";
import { MultiLogViewer } from "./MultiLogViewer";
import { CLUSTER_SCOPED_KINDS, resourceNamespace } from "../utils/scope";
import { NodeDrainDialog, DrainResultCard } from "./NodeDrainDialog";
import { useNodeDrain } from "../hooks/useNodeDrain";
import { defaultLogView } from "../utils/logFilter";
import { podStatusStyle } from "../utils/podStatus";
import { PROTECTED_NAMESPACES, PROTECTED_NAMESPACE_REASON, chipLabels, deletingFor, isTerminating, namespaceDeleteReason } from "../utils/namespaces";
import {
  ARGO_CHIP_CLS, SYNC_FILTERS, argoHealthCount, argoHealthPill, argoPhasePill, argoSortScore, argoSyncCount,
  argoSyncPill, filterArgoResources, isArgoHealthy, isDegradedOrMissing, visibleHealthFilters,
  type ArgoHealthStatus, type ArgoPill, type ArgoSyncStatus,
} from "../utils/argoStatus";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function KV({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-edge-raw/60 last:border-b-0">
      <span className="text-[11px] text-mute w-[110px] shrink-0">{k}</span>
      <span className={`text-[12px] text-ink ${mono ? "mono" : ""} truncate`}>{v}</span>
    </div>
  );
}

// ─── ArgoCD status chip (ARGO-1) ──────────────────────────────────────────────
// The pill tables and the Resources-tab filter logic are pure and live in utils/argoStatus.ts, shared by the panel
// header, the Overview and the Resources tab. Health and Sync are independent (argocd.md).

/** A Health or Sync chip in the panel header. The glyph is decoration; the sr-only prefix names the status. */
function ArgoStatusChip({ which, pill }: { which: "Health" | "Sync"; pill: ArgoPill }) {
  return (
    <span
      title={`${which} status`}
      className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11px] font-medium ring-1 ${pill.cls}`}
    >
      <span aria-hidden>{pill.icon}</span>
      <span className="sr-only">{which}: </span>
      {pill.label}
    </span>
  );
}

// ─── HPA metric bar helpers ───────────────────────────────────────────────────

function HPAMetricBar({ label, current, target, unit, color }: {
  label: string; current?: number; target: number; unit: string; color: string;
}) {
  const pct = current != null ? Math.min(100, Math.round((current / (target || 1)) * 100)) : 0;
  const tone = pct >= 100 ? "bg-bar-high" : pct >= 80 ? "bg-bar-mid" : color;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-mute">{label}</span>
        <span className="mono text-[11px] text-ink">
          {current != null ? `${current}${unit}` : "—"} / {target}{unit}
        </span>
      </div>
      <div className="h-[5px] rounded-xs overflow-hidden bg-surface-tint/6">
        <div className={`h-full rounded-xs transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="mono text-[10px] text-mute">{pct}% of target</span>
        {pct >= 100 && <span className="mono text-[10px] text-bad">scaling up</span>}
      </div>
    </div>
  );
}

function HPAMetricBarStr({ label, current, target, color }: {
  label: string; current?: string; target: string; color: string;
}) {
  // Parse numeric value from strings like "80%", "200Mi", "1G"
  const parseVal = (s: string) => {
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
  };
  const curVal = current != null ? parseVal(current) : null;
  const tgtVal = parseVal(target);
  const isPercent = target.endsWith("%");
  const pct = curVal != null && tgtVal != null
    ? Math.min(100, Math.round((curVal / (tgtVal || 1)) * 100))
    : null;
  const tone = pct != null ? (pct >= 100 ? "bg-bar-high" : pct >= 80 ? "bg-bar-mid" : color) : color;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-mute">{label}</span>
        <span className="mono text-[11px] text-ink">
          {current ?? "—"} / {target}
        </span>
      </div>
      {pct != null && (
        <>
          <div className="h-[5px] rounded-xs overflow-hidden bg-surface-tint/6">
            <div className={`h-full rounded-xs transition-all ${tone}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="mono text-[10px] text-mute">
              {isPercent ? `${pct}% of target` : `${pct}% utilization`}
            </span>
            {pct >= 100 && <span className="mono text-[10px] text-bad">scaling up</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Secret data row with base64 decode toggle ────────────────────────────────

function decodeBase64(b64: string): { ok: true; value: string } | { ok: false; error: string } {
  try {
    return { ok: true, value: atob(b64) };
  } catch {
    return { ok: false, error: "invalid base64" };
  }
}


/** #33: the panel root owns the fetch (B-3); this is only what the Overview needs to draw it. */
interface SecretReveal {
  /** The user clicked Reveal for THIS object. Values draw only while this is true and `data` exists. */
  revealed: boolean;
  /** `data` of the fetched object (base64). */
  data: Record<string, string> | undefined;
  loading: boolean;
  error: string;
  /** Explicit SSAR deny on `get secrets` (fails open otherwise). */
  deniedReason?: string;
  onReveal: () => void;
  onHide: () => void;
  onRetry: () => void;
}

const smallBtn = "h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono flex items-center gap-1 disabled:opacity-50";

function SecretOverview({ item, reveal }: { item: import("../types/k8s").Secret; reveal: SecretReveal }) {
  const [decodeAll, setDecodeAll] = useState(false);
  const shown = reveal.revealed ? reveal.data : undefined;
  const forbidden = /forbidden|403/i.test(reveal.error);
  const revealReason = reveal.deniedReason;

  return (
    <>
      <KV k="Type" v={item.type_} />
      <KV k="Keys" v={`${item.data_count} keys`} />
      <KV k="Age"  v={item.age} />
      {item.keys.length === 0 ? (
        <p className="mt-3 text-[11px] text-mute">This Secret has no data.</p>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold">Data</span>
            {shown && <span className="mono text-[10px] px-1.5 rounded-sm bg-info/15 text-info ring-1 ring-info/30">Revealed</span>}
            <div className="flex-1" />
            {shown && (
              <button onClick={() => setDecodeAll((v) => !v)} className={smallBtn}>
                {decodeAll ? "Show all as base64" : "Decode all"}
              </button>
            )}
            {/* One toggle in a fixed place: activating it keeps focus on it while the label flips (04 6.2). */}
            <button
              aria-disabled={reveal.loading || undefined}
              onClick={() => {
                if (reveal.loading) return;
                if (shown) { setDecodeAll(false); reveal.onHide(); return; }
                if (revealReason) return;
                reveal.onReveal();
              }}
              {...(shown ? {} : disabledAttrs(revealReason))}
              title={shown ? undefined : revealReason ?? "Fetch this Secret's values from the cluster. They are discarded when you close this panel."}
              className={`${smallBtn} ${!shown && revealReason ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {reveal.loading ? <Loader2 size={11} className="animate-spin" /> : shown ? <EyeOff size={11} /> : <Eye size={11} />}
              {reveal.loading ? "Revealing…" : shown ? "Hide values" : "Reveal values"}
            </button>
          </div>
          {reveal.error && (
            <div role="alert" className="mb-1.5 rounded-sm bg-bad/10 ring-1 ring-bad/30 px-2 py-1.5 text-[11px] text-bad flex items-start gap-2">
              <span className="flex-1 min-w-0 wrap-break-word">
                Couldn't load the values: {reveal.error}.
                {forbidden && " Your account can list Secrets but can't read their values."}
              </span>
              <button onClick={reveal.onRetry} className={smallBtn}>Retry</button>
            </div>
          )}
          {item.keys.map((k) => (
            <SecretRow key={`${k}:${shown ? "r" : "h"}`} secretKey={k} size={item.sizes[k] ?? 0} b64Value={shown ? shown[k] : undefined} decodeAll={decodeAll} />
          ))}
          <p className="mt-2 text-[10.5px] text-mute">
            {shown
              ? "Showing base64. Decode converts to text. Values are discarded when you close this panel or hide them."
              : "Values are hidden. Reveal fetches this Secret from the cluster."}
          </p>
        </div>
      )}
    </>
  );
}

function SecretRow({
  secretKey, size, b64Value, decodeAll,
}: { secretKey: string; size: number; b64Value: string | undefined; decodeAll: boolean }) {
  const [decode, setDecode] = useState(false);
  const [copied, setCopied] = useState(false);
  const decoding = decodeAll || decode;
  // Values exist here only while the panel's reveal is on; b64Value is undefined otherwise.
  const visible = b64Value !== undefined && size > 0;
  const decoded = visible && decoding ? decodeBase64(b64Value) : null;
  const text = decoded ? (decoded.ok ? decoded.value : `⚠ ${decoded.error}`) : b64Value ?? "";

  const copyValue = () => {
    navigator.clipboard.writeText(decoded?.ok ? decoded.value : b64Value ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="py-1.5 border-b border-edge-raw/60 last:border-b-0">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[11px] text-mute flex-1 truncate" title={secretKey}>{secretKey}</span>
        {visible ? (
          <>
            <button onClick={() => setDecode((v) => !v)} className={smallBtn}>
              {decoding ? "Show as base64" : "Decode"}
            </button>
            <button onClick={copyValue} className={smallBtn}>
              {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />} Copy
            </button>
          </>
        ) : (
          <span className="mono text-[10.5px] text-mute">{formatSecretSize(size)}</span>
        )}
      </div>
      {size > 0 && (
        <pre className={`mono text-[11px] whitespace-pre-wrap break-all max-h-24 overflow-auto rounded px-1.5 py-1 transition-colors ${
          decoded
            ? decoded.ok
              ? "text-ok/90 bg-ok/6 ring-1 ring-ok/20"
              : "text-bad bg-bad/6 ring-1 ring-bad/20"
            : "text-ink/60"
        }`}>
          {visible ? text : "••••••••"}
        </pre>
      )}
      {decoded?.ok && <span className="mono text-[9.5px] text-ok">decoded</span>}
    </div>
  );
}

// ─── TLS certificate tab (kubernetes.io/tls Secrets) ──────────────────────────

// R1: every field renders "—" rather than nothing when empty — a cert that
// parses to all-blank fields must not read as a cluster bug.
const orDash = (v: string) => v || "—";

function TlsCertCard({ cert, defaultOpen }: { cert: TlsCertInfo; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  // R2: parse_error branches BEFORE anything else. Every other field is a Rust
  // Default on a failed row (empty strings, deltaMs === null) — rendering them
  // would show a bare "—" styled as if it were a real reading.
  if (cert.parse_error) {
    return (
      <div className="rounded-lg bg-warn/5 ring-1 ring-warn/30 p-3 mb-2">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={12} className="text-warn shrink-0" />
          <span className="mono text-[11px] text-warn">{cert.source_key} [{cert.index}] — parse failed</span>
        </div>
        <p className="mono text-[11px] text-warn break-all">{cert.parse_error}</p>
      </div>
    );
  }

  // Research F1b: computed role stops users reading the wrong cert out of a
  // chain. issuer-RDN == subject-RDN is the cheap self-signature equivalent
  // (real verification is cut — see plan §7).
  const role = !cert.is_ca ? "TLS" : cert.self_signed ? "Root CA" : "Intermediate CA";
  const roleBadgeCls = role === "TLS"
    ? "bg-accent/15 text-accent ring-accent/30"
    : role === "Root CA"
    ? "bg-surface-tint/6 text-mute ring-edge"
    : "bg-info/15 text-info ring-info/30";
  const { label: expiryLabel, cls: expiryCls } = expiryState(cert.not_after, cert.not_before || undefined);

  const copyFingerprint = () => {
    navigator.clipboard.writeText(cert.sha256_fingerprint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="rounded-lg bg-card/70 ring-1 ring-edge hairline mb-2 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-tint/2 transition-colors"
      >
        <ChevronRight size={11} className={`text-mute transition-transform shrink-0 ${open ? "rotate-90" : ""}`} />
        <span className="mono text-[12px] text-ink truncate flex-1">{orDash(cert.subject_cn || cert.subject)}</span>
        <span className="mono text-[9px] text-mute shrink-0">{cert.source_key}[{cert.index}]</span>
        <span className={`mono text-[9.5px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm ring-1 shrink-0 ${roleBadgeCls}`}>
          {role}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-edge-raw/60">
          <div className="mb-2.5">
            <span className="text-[10.5px] text-mute uppercase tracking-wider">Expiry</span>
            <div className={`mono text-[13px] mt-0.5 ${expiryCls}`}>{expiryLabel}</div>
            <div className="mono text-[10.5px] text-mute mt-0.5">
              {cert.not_before ? new Date(cert.not_before).toLocaleString() : "—"}
              {" → "}
              {cert.not_after ? new Date(cert.not_after).toLocaleString() : "—"}
            </div>
          </div>

          <div className="mb-2.5">
            <span className="text-[10.5px] text-mute uppercase tracking-wider">SANs</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {cert.dns_names.length === 0 ? (
                <span className="text-[11px] text-mute">—</span>
              ) : cert.dns_names.map((d, i) => (
                <span key={`${d}-${i}`} className="mono text-[10.5px] text-mute bg-surface-tint/4 rounded-sm px-1.5 py-0.5 ring-1 ring-edge-raw/60 break-all">
                  {d}
                </span>
              ))}
            </div>
            {cert.other_sans.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {cert.other_sans.map((s, i) => (
                  <span key={`${s}-${i}`} className="mono text-[10px] text-mute bg-surface-tint/2 rounded-sm px-1.5 py-0.5 ring-1 ring-edge-raw/40 break-all">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>

          <KV k="Issuer" v={orDash(cert.issuer_cn || cert.issuer)} />
          {cert.issuer && (
            <div className="mono text-[10px] text-mute truncate pb-1.5 border-b border-edge-raw/60" title={cert.issuer}>
              {cert.issuer}
            </div>
          )}
          <KV k="Key" v={orDash(cert.key_algorithm) + (cert.key_size_bits == null ? "" : ` ${cert.key_size_bits}-bit`)} />
          <KV k="Signature" v={orDash(cert.signature_algorithm)} />
          <KV k="Serial" v={orDash(cert.serial)} />

          <div className="mt-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10.5px] text-mute uppercase tracking-wider flex-1">Fingerprint (SHA-256)</span>
              <button
                onClick={copyFingerprint}
                title="Copy fingerprint"
                className="h-5 w-5 flex items-center justify-center rounded-sm text-mute hover:text-ink transition-colors"
              >
                {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
              </button>
            </div>
            <p className="mono text-[10.5px] text-mute break-all">{orDash(cert.sha256_fingerprint)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function TlsTab({ certs, isLoading, error }: { certs: TlsCertInfo[]; isLoading: boolean; error: unknown }) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse" style={{ width: `${30 + (i % 4) * 15}%` }} />
        ))}
      </div>
    );
  }
  // R10: an RBAC error (get denied on a Secret that lists fine) must read as
  // an error, never as an empty state.
  if (error) {
    return (
      <div className="p-4">
        <p className="mono text-[11.5px] text-bad">{(error as any)?.message ?? String(error)}</p>
      </div>
    );
  }
  // The silently-empty-table trap: Ok(vec![]) means "no PEM CERTIFICATE blocks
  // found", which must read as an explicit message, not a blank panel.
  if (certs.length === 0) {
    return (
      <div className="p-4">
        <p className="text-[12px] text-mute">tls.crt contains no PEM certificate blocks.</p>
      </div>
    );
  }
  return (
    <div className="p-3">
      {certs.map((cert, i) => (
        <TlsCertCard key={`${cert.source_key}-${cert.index}`} cert={cert} defaultOpen={i === 0} />
      ))}
    </div>
  );
}

// ─── Node pod list ────────────────────────────────────────────────────────────

function NodeOverview({ item, context }: { item: import("../types/k8s").NodeResource; context: string }) {
  const identity = useClusterIdentity(context);
  const { data: pods = [], isLoading: podsLoading } = useNodePods(context, item.name, true);
  const cordon = useCordonNode();
  const uncordon = useUncordonNode();
  const deleteNode = useDeleteNode();
  // The drain run lives HERE, not inside the dialog, so closing the dialog keeps
  // the data and the result card's "View details" can reopen it.
  const drain = useNodeDrain(context, item.name);
  // Fails open. Cordon/Drain are node patches; the pods/eviction SSAR hint is not
  // gated in v1.2.1 (eviction denials surface at run time as failed rows).
  const perm = usePermissions(context, "", "nodes");
  const addTaint = useAddNodeTaint();
  const removeTaint = useRemoveNodeTaint();
  const { guarded, dialog: guardedDialog } = useGuardedAction(context);
  // DISABLE-PRECEDENCE: read-only first, then the RBAC hint. Controls stay focusable.
  const ro = identity.readOnly;
  const cordonReason = pickDisabledReason({ readOnly: ro, rbac: perm.canPatch ? undefined : "You don't have permission to update nodes." });
  const drainRbac = perm.canPatch ? undefined : "You don't have permission to drain nodes. Draining starts by cordoning the node, which needs permission to update nodes.";
  const drainReason = pickDisabledReason({ readOnly: ro, rbac: drainRbac });
  const deleteReason = pickDisabledReason({ readOnly: ro, rbac: perm.canDelete ? undefined : "You don't have permission to delete nodes." });
  const taintReason = pickDisabledReason({ readOnly: ro });
  const [confirmAction, setConfirmAction] = useState<"delete" | null>(null);
  const [confirmRemoveTaint, setConfirmRemoveTaint] = useState<{ key: string; effect: string } | null>(null);
  const [actionResult, setActionResult] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showAddTaint, setShowAddTaint] = useState(false);
  const [taintKey, setTaintKey] = useState("");
  const [taintValue, setTaintValue] = useState("");
  const [taintEffect, setTaintEffect] = useState("NoSchedule");
  const isReady = item.status === "ok";

  const handleAction = async (action: "cordon" | "uncordon" | "delete") => {
    setActionResult(null);
    try {
      if (action === "cordon") {
        await cordon.mutateAsync({ context, node: item.name });
        setActionResult({ msg: "Node cordoned", ok: true });
      } else if (action === "uncordon") {
        await uncordon.mutateAsync({ context, node: item.name });
        setActionResult({ msg: "Node uncordoned", ok: true });
      } else if (action === "delete") {
        await deleteNode.mutateAsync({ context, node: item.name });
        setActionResult({ msg: "Node deleted", ok: true });
      }
    } catch (e) {
      setActionResult({ msg: (e as any)?.message ?? String(e), ok: false });
    }
    setConfirmAction(null);
  };

  const runAddTaint = async () => {
    setActionResult(null);
    try {
      await addTaint.mutateAsync({ context, node: item.name, key: taintKey.trim(), value: taintValue.trim(), effect: taintEffect });
      setActionResult({ msg: `Taint "${taintKey.trim()}:${taintEffect}" added`, ok: true });
      setShowAddTaint(false);
      setTaintKey(""); setTaintValue(""); setTaintEffect("NoSchedule");
    } catch (e) {
      setActionResult({ msg: (e as any)?.message ?? String(e), ok: false });
    }
  };

  const handleAddTaint = () => {
    if (!taintKey.trim() || taintReason) return;
    const key = taintKey.trim();
    const value = taintValue.trim();
    guarded({
      title: `Add taint to node ${item.name}`,
      description: `Adds the taint "${key}${value ? `=${value}` : ""}:${taintEffect}" to node "${item.name}".${taintEffect === "NoExecute" ? " NoExecute immediately evicts non-tolerating pods." : ""}`,
      confirmLabel: "Add taint",
      equivalent: taintEquiv({ context, node: item.name, key, value, effect: taintEffect }),
      run: runAddTaint,
    });
  };

  const handleRemoveTaint = async (key: string, effect: string) => {
    if (taintReason) return;
    if (identity.typedConfirm) {
      // The guardrail's typed confirm replaces the inline NoExecute panel: one dialog, one typed field.
      guarded({
        title: `Remove taint from node ${item.name}`,
        description: `Removes the taint "${key}:${effect}" from node "${item.name}".${effect === "NoExecute" ? " Pods evicted by it may reschedule." : ""}`,
        confirmLabel: "Remove taint",
        equivalent: taintEquiv({ context, node: item.name, key, effect, remove: true }),
        run: async () => {
          await removeTaint.mutateAsync({ context, node: item.name, key, effect });
          setActionResult({ msg: `Taint "${key}:${effect}" removed`, ok: true });
        },
      });
      return;
    }
    if (effect === "NoExecute") { setConfirmRemoveTaint({ key, effect }); return; }
    setActionResult(null);
    try {
      await removeTaint.mutateAsync({ context, node: item.name, key, effect });
      setActionResult({ msg: `Taint "${key}:${effect}" removed`, ok: true });
    } catch (e) {
      setActionResult({ msg: (e as any)?.message ?? String(e), ok: false });
    }
  };

  const doRemoveTaint = async () => {
    if (!confirmRemoveTaint) return;
    setActionResult(null);
    try {
      await removeTaint.mutateAsync({ context, node: item.name, key: confirmRemoveTaint.key, effect: confirmRemoveTaint.effect });
      setActionResult({ msg: `Taint "${confirmRemoveTaint.key}:${confirmRemoveTaint.effect}" removed`, ok: true });
    } catch (e) {
      setActionResult({ msg: (e as any)?.message ?? String(e), ok: false });
    }
    setConfirmRemoveTaint(null);
  };

  const isBusy = cordon.isPending || uncordon.isPending || deleteNode.isPending;
  const drainBusyReason = drain.busy
    ? "A drain of this node is running or paused. Open its details, or dismiss the result, first."
    : undefined;

  // Uncordon from inside the drain dialog: reversible and already implied by the
  // drain the user confirmed, so no second confirm. Throws so the dialog can show it.
  const uncordonFromDrain = async () => {
    await uncordon.mutateAsync({ context, node: item.name });
    drain.markUncordoned();
  };
  const labels = Object.entries(item.labels ?? {});
  const taints = item.taints ?? [];

  return (
    <>
      {/* Status & Info */}
      <KV k="Status"          v={isReady ? "Ready" : "Not Ready"} />
      <KV k="Schedulable"     v={item.unschedulable ? "SchedulingDisabled" : "Schedulable"} />
      <KV k="Roles"           v={item.roles} />
      <KV k="Version"         v={item.version} />
      <KV k="OS Image"        v={item.os_image} />
      <KV k="CPU capacity"    v={item.cpu_capacity} />
      <KV k="Memory capacity" v={item.memory_capacity} />
      <KV k="Pod capacity"    v={item.pod_capacity} />
      <KV k="Pod count"       v={podsLoading ? "…" : `${pods.length} / ${item.pod_capacity}`} />
      <KV k="Age"             v={item.age} />

      {/* Actions */}
      <div className="mt-4">
        <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mb-2">Node Actions</div>
        <DrainResultCard node={item.name} drain={drain} nodeUnschedulable={item.unschedulable} />
        {actionResult && (
          <div className={`mono text-[10.5px] px-2 py-1.5 rounded-sm mb-2 ${actionResult.ok ? "text-ok bg-ok/10 ring-1 ring-ok/20" : "text-bad bg-bad/10 ring-1 ring-bad/20"}`}>
            {actionResult.msg}
          </div>
        )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (cordonReason) return;
                const action = item.unschedulable ? "uncordon" : "cordon";
                guarded({
                  title: `${item.unschedulable ? "Uncordon" : "Cordon"} node ${item.name}`,
                  description: item.unschedulable
                    ? `Marks node "${item.name}" schedulable again.`
                    : `Marks node "${item.name}" unschedulable. Running pods stay.`,
                  confirmLabel: item.unschedulable ? "Uncordon" : "Cordon",
                  equivalent: cordonEquiv({ context, node: item.name, uncordon: !!item.unschedulable }),
                  run: () => handleAction(action),
                });
              }}
              disabled={isBusy}
              {...disabledAttrs(cordonReason)}
              className={`h-7 px-3 rounded-md bg-accent/15 ring-1 ring-accent/30 text-[11px] text-accent hover:bg-accent/25 mono disabled:opacity-50 ${cordonReason ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {item.unschedulable ? "Uncordon" : "Cordon"}
            </button>
            <button
              onClick={() => { if (drainReason) return; drain.openReview(); }}
              disabled={isBusy || drain.busy}
              title={drainBusyReason}
              {...disabledAttrs(drainReason)}
              className={`h-7 px-3 rounded-md bg-warn/10 ring-1 ring-warn/30 text-[11px] text-warn hover:bg-warn/20 mono disabled:opacity-50 ${drainReason ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Drain…
            </button>
            <button
              onClick={() => { if (deleteReason) return; setConfirmAction("delete"); }}
              disabled={isBusy}
              {...disabledAttrs(deleteReason)}
              className={`h-7 px-3 rounded-md bg-bad/10 ring-1 ring-bad/30 text-[11px] text-bad hover:bg-bad/20 mono disabled:opacity-50 ${deleteReason ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Delete
            </button>
          </div>
          <NodeDrainDialog
            context={context}
            node={item.name}
            drain={drain}
            nodeUnschedulable={item.unschedulable}
            onUncordon={uncordonFromDrain}
          />
          {guardedDialog}
          <ConfirmModal
            contextLabel={identity.label}
            contextColor={identity.color}
            context={identity.context}
            kubectlEquivalent={deleteNodeEquiv({ context, node: item.name })}
            open={confirmAction === "delete"}
            title="Delete node"
            description={`Delete node "${item.name}" from the cluster? This action cannot be undone.`}
            confirmLabel="Delete"
            destructive
            requireTyping={item.name}
            requireTypingLabel="Type the node name to confirm"
            onConfirm={() => handleAction("delete")}
            onCancel={() => setConfirmAction(null)}
            isPending={deleteNode.isPending}
          />
      </div>

      {/* Labels */}
      {labels.length > 0 && (
        <div className="mt-4">
          <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mb-1.5">Labels ({labels.length})</div>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {labels.map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 ring-1 ring-accent/20 mono text-[10.5px]">
                <span className="text-accent">{k}</span>
                {v && <><span className="text-mute">=</span><span className="text-mute">{v}</span></>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Taints */}
      <div className="mt-4">
        <div className="flex items-center mb-1.5">
          <span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold flex-1">
            Taints{taints.length > 0 ? ` (${taints.length})` : ""}
          </span>
          <button
            onClick={() => { if (taintReason) return; setShowAddTaint(v => !v); }}
            {...(taintReason ? disabledAttrs(taintReason) : { title: "Add taint" })}
            className={`h-5 w-5 flex items-center justify-center rounded-sm hover:bg-surface-tint/10 text-mute hover:text-ink ${taintReason ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Plus size={12} />
          </button>
        </div>

        {taints.length > 0 && (
          <div className="flex flex-col gap-1 mb-2">
            {taints.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-warn/5 ring-1 ring-warn/20 mono text-[10.5px]">
                <span className="text-warn">{t.key}</span>
                {t.value && <><span className="text-mute">=</span><span className="text-mute">{t.value}</span></>}
                <span className="text-mute">:</span>
                <span className="text-mute flex-1">{t.effect}</span>
                <button
                  onClick={() => handleRemoveTaint(t.key, t.effect)}
                  disabled={removeTaint.isPending}
                  {...(taintReason ? disabledAttrs(taintReason) : { title: "Remove taint" })}
                  className={`h-4 w-4 flex items-center justify-center rounded-sm hover:bg-bad/20 text-mute hover:text-bad disabled:opacity-50 ${taintReason ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {confirmRemoveTaint && (
          <div className="flex flex-col gap-2 p-3 rounded-lg ring-1 ring-bad/40 bg-bad/5 mb-2">
            <div className="flex items-center gap-2 text-[11.5px] text-warn">
              <AlertTriangle size={13} />
              <span>NoExecute taint will be removed — pods evicted by it may reschedule.</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={doRemoveTaint}
                disabled={removeTaint.isPending}
                className="h-6 px-3 rounded-sm bg-bad/20 ring-1 ring-bad/40 text-[10.5px] text-bad hover:bg-bad/30 mono disabled:opacity-50"
              >
                {removeTaint.isPending ? "…" : "Confirm remove"}
              </button>
              <button
                onClick={() => setConfirmRemoveTaint(null)}
                className="h-6 px-3 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showAddTaint && (
          <div className="p-2.5 rounded-lg ring-1 ring-edge bg-surface-tint/2 flex flex-col gap-2">
            <input
              type="text"
              placeholder="key (e.g. dedicated)"
              value={taintKey}
              onChange={e => setTaintKey(e.target.value)}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              className="h-7 px-2 rounded-sm bg-surface-tint/5 ring-1 ring-edge text-[11px] mono text-ink placeholder:text-mute focus:outline-hidden focus:ring-1 focus:ring-accent/40"
            />
            <input
              type="text"
              placeholder="value (optional)"
              value={taintValue}
              onChange={e => setTaintValue(e.target.value)}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              className="h-7 px-2 rounded-sm bg-surface-tint/5 ring-1 ring-edge text-[11px] mono text-ink placeholder:text-mute focus:outline-hidden focus:ring-1 focus:ring-accent/40"
            />
            <select
              value={taintEffect}
              onChange={e => setTaintEffect(e.target.value)}
              className="h-7 px-2 rounded-sm bg-surface-tint/5 ring-1 ring-edge text-[11px] mono text-ink focus:outline-hidden focus:ring-1 focus:ring-accent/40"
            >
              <option value="NoSchedule">NoSchedule</option>
              <option value="PreferNoSchedule">PreferNoSchedule</option>
              <option value="NoExecute">NoExecute</option>
            </select>
            {taintEffect === "NoExecute" && (
              <div className="flex items-center gap-1.5 text-[10.5px] text-warn">
                <AlertTriangle size={11} />
                <span>NoExecute immediately evicts non-tolerating pods.</span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleAddTaint}
                disabled={!taintKey.trim() || addTaint.isPending}
                {...disabledAttrs(taintReason)}
                className="h-6 px-3 rounded-sm bg-accent/15 ring-1 ring-accent/30 text-[10.5px] text-accent hover:bg-accent/25 mono disabled:opacity-50"
              >
                {addTaint.isPending ? "…" : "Add Taint"}
              </button>
              <button
                onClick={() => { setShowAddTaint(false); setTaintKey(""); setTaintValue(""); setTaintEffect("NoSchedule"); }}
                className="h-6 px-3 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {taints.length === 0 && !showAddTaint && (
          <div className="text-[11px] text-mute">No taints</div>
        )}
      </div>

      {/* Pods on this node */}
      <div className="mt-4">
        <div className="flex items-center mb-2">
          <span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold flex-1">Pods on this node</span>
          {!podsLoading && <span className="mono text-[10px] text-mute">{pods.length} pods</span>}
        </div>
        {podsLoading ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-7 rounded-lg bg-surface-tint/3 animate-pulse" />
            ))}
          </div>
        ) : pods.length === 0 ? (
          <div className="rounded-lg ring-1 ring-edge py-6 flex items-center justify-center">
            <span className="text-[12px] text-mute">No pods scheduled</span>
          </div>
        ) : (
          <div className="rounded-lg ring-1 ring-edge overflow-hidden">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky top-0 bg-panel/95 border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute font-semibold py-1.5 px-3">Name</th>
                  <th className="sticky top-0 bg-panel/95 border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute font-semibold py-1.5 px-2 w-[110px]">Namespace</th>
                  <th className="sticky top-0 bg-panel/95 border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute font-semibold py-1.5 px-2 w-[100px]">Status</th>
                  <th className="sticky top-0 bg-panel/95 border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute font-semibold py-1.5 px-2 w-[55px]">Age</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p, i) => {
                  const dotColor = podStatusStyle(p.status).dot;
                  return (
                    <tr key={i} className="border-b border-edge-raw/60 last:border-b-0">
                      <td className="px-3 py-1.5"><span className="mono text-[11.5px] text-ink truncate block max-w-[160px]" title={p.name}>{p.name}</span></td>
                      <td className="px-2 py-1.5"><span className="mono text-[11px] text-mute truncate block">{p.namespace}</span></td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
                          <span className="mono text-[11px] text-mute">{p.status}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5"><span className="mono text-[11px] text-mute tabular-nums">{p.age}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── CRD resource list ────────────────────────────────────────────────────────

function CRDOverview({ item, context }: { item: import("../types/k8s").CRD; context: string }) {
  const { data: resources = [], isLoading } = useCRDResources(context, item, true);
  const isNamespaced = item.scope === "Namespaced";

  return (
    <>
      <KV k="Group"       v={item.group || "(core)"} />
      <KV k="Kind"        v={item.kind} />
      <KV k="Plural"      v={item.plural} />
      <KV k="Scope"       v={item.scope} />
      <KV k="Versions"    v={item.versions} />
      <KV k="Established" v={item.established ? "True" : "False"} />
      <KV k="Age"         v={item.age} />

      <div className="mt-4">
        <div className="flex items-center mb-2">
          <span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold flex-1">
            Resources
          </span>
          {!isLoading && (
            <span className="mono text-[10px] text-mute">{resources.length} total</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-7 rounded-lg bg-surface-tint/3 animate-pulse" />
            ))}
          </div>
        ) : resources.length === 0 ? (
          <div className="rounded-lg ring-1 ring-edge py-6 flex items-center justify-center">
            <span className="text-[12px] text-mute">No resources found</span>
          </div>
        ) : (
          <div className="rounded-lg ring-1 ring-edge overflow-hidden">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky top-0 bg-panel/95 border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute font-semibold py-1.5 px-3">Name</th>
                  {isNamespaced && (
                    <th className="sticky top-0 bg-panel/95 border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute font-semibold py-1.5 px-2 w-[110px]">Namespace</th>
                  )}
                  <th className="sticky top-0 bg-panel/95 border-b border-edge text-left text-[10px] uppercase tracking-wider text-mute font-semibold py-1.5 px-2 w-[60px]">Age</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r, i) => (
                  <tr key={i} className="border-b border-edge-raw/60 last:border-b-0">
                    <td className="px-3 py-1.5">
                      <span className="mono text-[11.5px] text-ink truncate block max-w-[180px]" title={r.name}>{r.name}</span>
                    </td>
                    {isNamespaced && (
                      <td className="px-2 py-1.5">
                        <span className="mono text-[11px] text-mute truncate block" title={r.namespace}>{r.namespace || "—"}</span>
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      <span className="mono text-[11px] text-mute tabular-nums">{r.age}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Service port-forward ─────────────────────────────────────────────────────

function ServicePortForward({ item, context }: { item: import("../types/k8s").Service; context: string }) {
  const [localPort, setLocalPort] = useState("8080");
  const [svcPort, setSvcPort] = useState(() => {
    const first = item.ports.split(",")[0].split(":")[0].trim();
    const num = parseInt(first);
    return isNaN(num) ? "80" : String(num);
  });
  const [error, setError] = useState("");
  const startForward = useStartServicePortForward();
  const stopForward = useStopPortForward();
  const { data: forwards = [] } = usePortForwards();
  const myForwards = forwards.filter((f) => f.name === item.name && f.namespace === item.namespace && f.target_type === "service");

  const handleStart = async () => {
    setError("");
    try {
      await startForward.mutateAsync({
        context, namespace: item.namespace, service: item.name,
        servicePort: parseInt(svcPort), localPort: parseInt(localPort),
      });
    } catch (e) {
      setError((e as any)?.message ?? String(e));
    }
  };

  return (
    <div className="mt-4">
      <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mb-2">Port Forward</div>
      {myForwards.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {myForwards.map((f) => (
            <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-ok/5 ring-1 ring-ok/20">
              <Wifi size={11} className="text-ok shrink-0" />
              <span className="mono text-[11px] text-ok flex-1">localhost:{f.local_port} → :{f.pod_port}</span>
              <button
                onClick={() => stopForward.mutate({ forwardId: f.id })}
                className="h-5 w-5 flex items-center justify-center rounded-sm text-mute hover:text-bad transition-colors"
                title="Stop"
              >
                <Square size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="mono text-[9.5px] text-mute">Svc port</span>
          <input
            type="number" value={svcPort} onChange={(e) => setSvcPort(e.target.value)}
            className="h-7 w-20 rounded-md bg-base ring-1 ring-edge mono text-[11px] text-ink px-2 focus:ring-accent focus:outline-hidden"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="mono text-[9.5px] text-mute">Local port</span>
          <input
            type="number" value={localPort} onChange={(e) => setLocalPort(e.target.value)}
            className="h-7 w-20 rounded-md bg-base ring-1 ring-edge mono text-[11px] text-ink px-2 focus:ring-accent focus:outline-hidden"
          />
        </div>
        <button
          onClick={handleStart}
          disabled={startForward.isPending}
          className="mt-4 h-7 px-3 rounded-md bg-accent/15 ring-1 ring-accent/30 text-[11px] text-accent hover:bg-accent/25 mono flex items-center gap-1.5 disabled:opacity-50"
        >
          <Play size={10} /> {startForward.isPending ? "Starting…" : "Forward"}
        </button>
      </div>
      {error && (
        <div className="mono text-[10.5px] text-bad px-2 py-1 mt-2 rounded-sm bg-bad/10 ring-1 ring-bad/20">{error}</div>
      )}
    </div>
  );
}

// ─── Overview renderers per resource kind ─────────────────────────────────────

/** Namespace Overview (docs/ux/24 §4.4.5): the fields, the pods link, the built-in note and, while deleting, why it is stuck. */
function NamespaceOverview({ row, onNavigate, onShowTab }: {
  row: NamespaceRow;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
  onShowTab?: (tab: "Events" | "YAML") => void;
}) {
  const terminating = isTerminating(row);
  const since = deletingFor(row.deletion_timestamp);
  // The conditions that explain a stuck delete are the ones that are True (NamespaceContentRemaining and friends).
  const blocking = row.conditions.filter((c) => c.status === "True");
  const labelCount = chipLabels(row.labels).length;
  const link = "text-accent hover:underline rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70";
  return (
    <>
      {PROTECTED_NAMESPACES.has(row.name) && (
        <p className="text-[11.5px] text-mute pt-1 pb-2">{PROTECTED_NAMESPACE_REASON}</p>
      )}
      <KV k="Name"       v={row.name} />
      <KV k="Status"     v={terminating ? `Terminating${since ? `, deleting for ${since}` : ""}` : row.phase || "—"} mono={false} />
      <KV k="Age"        v={row.age} />
      <KV k="Finalizers" v={row.finalizers.length > 0 ? row.finalizers.join(", ") : "—"} />
      <KV k="Labels"     v={labelCount > 0 ? `${labelCount} (see Summary)` : "—"} mono={false} />
      {onNavigate && (
        <button
          type="button"
          onClick={() => onNavigate("pods", row.name, "")}
          className="mt-3 h-7 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink flex items-center gap-1.5 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <ArrowUpRight size={12} aria-hidden />
          Show pods in this namespace
        </button>
      )}
      {terminating && (
        <section aria-label="Why it is still deleting" className="mt-3 pt-3 border-t border-edge-raw/60 flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium text-mute">Why it is still deleting</h4>
          {blocking.map((c) => (
            <p key={c.type_} className="text-[11.5px] text-ink wrap-break-word">
              <span aria-hidden>✕</span> {c.type_}{c.message ? `: ${c.message}` : ""}
            </p>
          ))}
          <p className="text-[11.5px] text-mute">
            Kubernetes removes the objects inside a namespace first. It stays Terminating while an object or a finalizer blocks removal.
          </p>
          {blocking.length === 0 && (
            <p className="text-[11.5px] text-mute">
              Open{" "}
              <button type="button" onClick={() => onShowTab?.("Events")} className={link}>Events</button>
              {" "}or{" "}
              <button type="button" onClick={() => onShowTab?.("YAML")} className={link}>YAML</button>
              {" "}to look for what is blocking it.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function OverviewContent({ resource, context, onNavigate, onShowTab, secretReveal }: {
  resource: SelectedResource;
  context: string;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
  onShowTab?: (tab: "Events" | "YAML") => void;
  secretReveal: SecretReveal;
}) {
  // Fetch commit metadata from ArgoCD API lazily — data may not be in the CRD.
  const { data: argoCdCommit, isLoading: commitLoading } = useArgoCdCommitInfo(
    context,
    resource.kind === "argocd" ? resource.item.namespace : "",
    resource.kind === "argocd" ? resource.item.name : "",
    resource.kind === "argocd",
  );

  switch (resource.kind) {
    case "ns":
      return <NamespaceOverview row={resource.item} onNavigate={onNavigate} onShowTab={onShowTab} />;
    case "deploy": {
      const d = resource.item;
      const [, total] = d.ready.split("/").map(Number);
      return (
        <>
          <KV k="Ready"       v={d.ready} />
          <KV k="Up-to-date"  v={String(d.up_to_date)} />
          <KV k="Available"   v={String(d.available)} />
          <KV k="Age"         v={d.age} />
          <KV k="Image"       v={d.image} />
          <div className="mt-3 flex flex-wrap gap-2">
            <ScaleAction context={context} namespace={resource.ns} kind="deploy" name={d.name} currentReplicas={total || 1} />
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            <RestartAction context={context} namespace={resource.ns} kind="deploy" name={d.name} />
            <PauseResumeAction context={context} namespace={resource.ns} name={d.name} paused={false} />
          </div>
          <RolloutHistory context={context} namespace={resource.ns} name={d.name} />
          <ResourceConditions context={context} namespace={resource.ns} kind="deploy" name={d.name} />
          <ResourceAnnotations context={context} namespace={resource.ns} resourceType="deploy" name={d.name} />
        </>
      );
    }
    case "sts": {
      const s = resource.item;
      return (
        <>
          <KV k="Ready"    v={s.ready} />
          <KV k="Replicas" v={String(s.replicas)} />
          <KV k="Age"      v={s.age} />
          <KV k="Image"    v={s.image} />
          <ScaleAction context={context} namespace={resource.ns} kind="sts" name={s.name} currentReplicas={s.replicas} />
          <RestartAction context={context} namespace={resource.ns} kind="sts" name={s.name} />
          <ResourceConditions context={context} namespace={resource.ns} kind="sts" name={s.name} />
          <ResourceAnnotations context={context} namespace={resource.ns} resourceType="sts" name={s.name} />
        </>
      );
    }
    case "ds": {
      const d = resource.item;
      return (
        <>
          <KV k="Desired"     v={String(d.desired)} />
          <KV k="Current"     v={String(d.current)} />
          <KV k="Ready"       v={String(d.ready)} />
          <KV k="Up-to-date"  v={String(d.up_to_date)} />
          <KV k="Available"   v={String(d.available)} />
          <KV k="Age"         v={d.age} />
          <KV k="Image"       v={d.image} />
          <RestartAction context={context} namespace={resource.ns} kind="ds" name={d.name} />
          <ResourceAnnotations context={context} namespace={resource.ns} resourceType="ds" name={d.name} />
        </>
      );
    }
    case "jobs": {
      const j = resource.item;
      return (
        <>
          <KV k="Status"      v={j.status} />
          <KV k="Completions" v={j.completions} />
          <KV k="Duration"    v={j.duration} />
          <KV k="Age"         v={j.age} />
          <KV k="Image"       v={j.image} />
        </>
      );
    }
    case "cron": {
      const c = resource.item;
      return (
        <>
          <KV k="Schedule"      v={c.schedule} />
          <KV k="Suspend"       v={c.suspend ? "true" : "false"} />
          <KV k="Active"        v={String(c.active)} />
          <KV k="Last schedule" v={c.last_schedule} />
          <KV k="Age"           v={c.age} />
          <TriggerCronJob context={context} namespace={resource.ns} name={c.name} suspended={c.suspend} />
          <ResourceAnnotations context={context} namespace={resource.ns} resourceType="cron" name={c.name} />
        </>
      );
    }
    case "svc": {
      const s = resource.item;
      return (
        <>
          <KV k="Type"        v={s.type_} />
          <KV k="Cluster IP"  v={s.cluster_ip} />
          <KV k="External IP" v={s.external_ip || "—"} />
          <KV k="Ports"       v={s.ports} />
          <KV k="Age"         v={s.age} />
          <ServicePortForward item={s} context={context} />
        </>
      );
    }
    case "ing": {
      const i = resource.item;
      return (
        <>
          <KV k="Class"   v={i.class || "—"} />
          <KV k="Address" v={i.address || "—"} />
          <KV k="Ports"   v={i.ports} />
          <KV k="Age"     v={i.age} />
          {i.rules.length > 0 && (
            <div className="mt-3">
              <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mb-2">Routing Rules</div>
              {i.rules.map((rule, ri) => (
                <div key={ri} className="mb-3 last:mb-0 rounded-lg ring-1 ring-edge overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-tint/3 border-b border-edge">
                    {rule.tls && (
                      <span className="mono text-[9.5px] px-1.5 py-0.5 rounded-sm bg-ok/10 ring-1 ring-ok/30 text-ok">TLS</span>
                    )}
                    <span className="mono text-[12px] text-ink">{rule.host}</span>
                  </div>
                  {rule.paths.map((p, pi) => (
                    <div key={pi} className="flex items-center gap-0 text-[11px] border-b border-edge-raw/50 last:border-b-0">
                      <span className="mono px-3 py-1.5 text-mute w-[140px] shrink-0 border-r border-edge-raw/50 truncate" title={p.path}>
                        {p.path}
                      </span>
                      <span className="mono px-2 py-1.5 text-mute w-[80px] shrink-0 border-r border-edge-raw/50 text-[10px]">
                        {p.path_type}
                      </span>
                      <span className="mono px-3 py-1.5 text-accent truncate flex-1">
                        {p.service}{p.port ? `:${p.port}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      );
    }
    case "cm": {
      const c = resource.item;
      const entries = Object.entries(c.data ?? {});
      return (
        <>
          <KV k="Keys" v={`${c.data_count} keys`} />
          <KV k="Age"  v={c.age} />
          {entries.length > 0 && (
            <>
              <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mt-3 mb-1">Data</div>
              {entries.map(([k, v]) => (
                <div key={k} className="py-1.5 border-b border-edge-raw/60 last:border-b-0">
                  <div className="text-[11px] text-mute mb-0.5">{k}</div>
                  <pre className="mono text-[11px] text-ink/80 whitespace-pre-wrap break-all max-h-24 overflow-auto">{v}</pre>
                </div>
              ))}
            </>
          )}
        </>
      );
    }
    case "sec": {
      return <SecretOverview item={resource.item} reveal={secretReveal} />;
    }
    case "pvc": {
      const p = resource.item;
      return (
        <>
          <KV k="Status"        v={p.status} />
          <KV k="Volume"        v={p.volume || "—"} />
          <KV k="Capacity"      v={p.capacity} />
          <KV k="Access modes"  v={p.access_modes} />
          <KV k="Storage class" v={p.storage_class} />
          <KV k="Age"           v={p.age} />
          <ResourceConditions context={context} namespace={resource.ns} kind="pvc" name={p.name} />
        </>
      );
    }
    case "pv": {
      const p = resource.item;
      return (
        <>
          <KV k="Capacity"        v={p.capacity} />
          <KV k="Access modes"    v={p.access_modes} />
          <KV k="Reclaim policy"  v={p.reclaim_policy} />
          <KV k="Status"          v={p.status} />
          <KV k="Claim"           v={p.claim || "—"} />
          <KV k="Storage class"   v={p.storage_class} />
          <KV k="Age"             v={p.age} />
        </>
      );
    }
    case "sc": {
      const s = resource.item;
      return (
        <>
          <KV k="Provisioner"          v={s.provisioner} />
          <KV k="Reclaim policy"       v={s.reclaim_policy} />
          <KV k="Volume binding mode"  v={s.volume_binding_mode} />
          <KV k="Allow expansion"      v={s.allow_volume_expansion ? "Yes" : "No"} />
          <KV k="Default"              v={s.is_default ? "Yes" : "No"} />
          <KV k="Age"                  v={s.age} />
        </>
      );
    }
    case "nodes": {
      return <NodeOverview item={resource.item} context={context!} />;
    }
    case "hpa": {
      const h = resource.item;
      return (
        <>
          <KV k="Reference"        v={h.reference} />
          <KV k="Min replicas"     v={String(h.min_replicas)} />
          <KV k="Max replicas"     v={String(h.max_replicas)} />
          <KV k="Current replicas" v={String(h.current_replicas)} />
          <KV k="Desired replicas" v={String(h.desired_replicas)} />
          <KV k="Age"              v={h.age} />
          {(h.cpu_target != null || h.mem_target != null) && (
            <div className="mt-3">
              <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold mb-2">Metrics</div>
              {h.cpu_target != null && (
                <HPAMetricBar
                  label="CPU"
                  current={h.cpu_current}
                  target={h.cpu_target}
                  unit="%"
                  color="bg-metric-cpu"
                />
              )}
              {h.mem_target != null && (
                <HPAMetricBarStr
                  label="Memory"
                  current={h.mem_current}
                  target={h.mem_target}
                  color="bg-metric-mem"
                />
              )}
            </div>
          )}
        </>
      );
    }
    case "crd": {
      return <CRDOverview item={resource.item} context={context!} />;
    }
    case "netpol": {
      const n = resource.item;
      return (
        <>
          <KV k="Pod selector"  v={n.pod_selector} />
          <KV k="Policy types"  v={n.policy_types || "—"} />
          <KV k="Ingress rules" v={String(n.ingress_count)} />
          <KV k="Egress rules"  v={String(n.egress_count)} />
          <KV k="Age"           v={n.age} />
        </>
      );
    }
    case "sa": {
      const s = resource.item;
      return (
        <>
          <KV k="Namespace" v={s.namespace} />
          <KV k="Age"       v={s.age} />
          <ResourceAnnotations context={context} namespace={resource.ns} resourceType="sa" name={s.name} />
        </>
      );
    }
    case "roles": {
      const r = resource.item;
      return (<><KV k="Namespace" v={r.namespace} /><KV k="Rules" v={String(r.rules_count)} /><KV k="Age" v={r.age} /></>);
    }
    case "croles": {
      const r = resource.item;
      return (<><KV k="Rules" v={String(r.rules_count)} /><KV k="Age" v={r.age} /></>);
    }
    case "rbindings": {
      const r = resource.item;
      return (<><KV k="Namespace" v={r.namespace} /><KV k="Role ref" v={r.role_ref} /><KV k="Subjects" v={r.subjects} /><KV k="Age" v={r.age} /></>);
    }
    case "crbindings": {
      const r = resource.item;
      return (<><KV k="Role ref" v={r.role_ref} /><KV k="Subjects" v={r.subjects} /><KV k="Age" v={r.age} /></>);
    }
    case "helm": {
      const h = resource.item;
      return (
        <>
          <KV k="Chart"       v={h.chart} />
          <KV k="App version" v={h.app_version} />
          <KV k="Status"      v={h.status} />
          <KV k="Revision"    v={h.revision} />
          <KV k="Updated"     v={h.updated.split(".")[0]} />
        </>
      );
    }
    case "pdb": {
      const p = resource.item;
      return (
        <>
          <KV k="Namespace"         v={p.namespace} />
          <KV k="Min available"     v={p.min_available} />
          <KV k="Max unavailable"   v={p.max_unavailable} />
          <KV k="Desired healthy"   v={String(p.desired_healthy)} />
          <KV k="Current healthy"   v={String(p.current_healthy)} />
          <KV k="Disruptions allowed" v={String(p.disruptions_allowed)} />
          <KV k="Age"               v={p.age} />
        </>
      );
    }
    case "cert": {
      const c = resource.item;
      const statusPill: Record<string, { icon: string; cls: string }> = {
        Healthy:     { icon: "●", cls: "bg-ok/10 text-ok ring-ok/30" },
        Progressing: { icon: "↻", cls: "bg-status-progress/10 text-status-progress ring-status-progress/30" },
        Degraded:    { icon: "✕", cls: "bg-bad/10 text-bad ring-bad/30" },
      };
      const sp = statusPill[c.status] ?? { icon: "?", cls: "bg-surface-tint/5 text-mute ring-edge" };
      const fmtIso = (iso: string) => (iso ? iso.replace("T", " ").replace(/\.\d+Z?$/, "").replace("Z", " UTC") : "—");
      return (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] mono font-medium ring-1 ${sp.cls}`}>
              <span>{sp.icon}</span>{c.ready ? "Ready" : c.status}
            </span>
          </div>

          <KV k="Namespace"     v={c.namespace} />
          <KV k="Ready"         v={c.ready ? "True" : "False"} />
          <KV k="Secret"        v={c.secret_name || "—"} />
          <KV k="Issuer"        v={c.issuer_name ? `${c.issuer_name} (${c.issuer_kind})` : "—"} />
          <KV k="Renewal"       v={fmtIso(c.renewal_time)} />
          <KV k="Expiry"        v={fmtIso(c.not_after)} />
          <KV k="Age"           v={c.age} />

          {c.dns_names.length > 0 && (
            <div className="mt-3">
              <div className="text-[10.5px] uppercase tracking-wide text-mute mb-1.5">DNS names ({c.dns_names.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {c.dns_names.map((d) => (
                  <span key={d} className="mono text-[11px] text-mute bg-surface-tint/4 ring-1 ring-edge-raw/60 px-1.5 py-0.5 rounded-sm">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {c.last_failure_message && (
            <div className="mt-3 p-2.5 rounded-lg bg-bad/6 ring-1 ring-bad/30">
              <div className="text-[10.5px] uppercase tracking-wide text-bad mb-1">Last failure</div>
              <p className="text-[11.5px] text-ink/90 leading-snug mono">{c.last_failure_message}</p>
            </div>
          )}
        </>
      );
    }
    case "argocd": {
      const a = resource.item;
      // Merge: prefer live ArgoCD API data over what's in the CRD (CRD often lacks revisionMetadata).
      const effectiveMessage = a.commit_message || argoCdCommit?.message || "";
      const effectiveAuthor = (a.commit_author && a.commit_author !== "—")
        ? a.commit_author
        : (argoCdCommit?.author || "");

      return (
        <>
          {/* Health and Sync are the header chips. Only the last operation stays here, labelled so it is not read as a third status. */}
          {a.operation_phase && a.operation_phase !== "—" && (() => {
            const pp = argoPhasePill(a.operation_phase);
            return (
              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] mono font-medium ring-1 ${pp.cls}`}>
                  <span aria-hidden>{pp.icon}</span>Last operation: {a.operation_phase}
                </span>
              </div>
            );
          })()}

          {/* Last commit — prominent like ArgoCD UI */}
          {a.last_commit && a.last_commit !== "—" && (
            <div className="mb-3 p-2.5 rounded-lg bg-surface-tint/3 ring-1 ring-edge-raw/60 space-y-1.5">
              <div className="flex items-center gap-2">
                <GitCommit size={11} className="text-mute shrink-0 mt-0.5" />
                <span className="mono text-[12px] font-semibold text-accent bg-accent/12 px-2 py-0.5 rounded-sm">
                  {a.last_commit}
                </span>
                <span className="text-[11px] text-mute mono">{a.last_synced_at}</span>
                {commitLoading && (
                  <Loader2 size={11} className="text-mute animate-spin ml-auto" />
                )}
              </div>
              {effectiveMessage && (
                <p className="text-[11.5px] text-ink/90 leading-snug">{effectiveMessage}</p>
              )}
              {effectiveAuthor && (
                <p className="text-[10.5px] text-mute mono"><span className="text-mute">by </span>{effectiveAuthor}</p>
              )}
            </div>
          )}

          <KV k="Namespace"       v={a.namespace} />
          <KV k="Project"         v={a.project} />
          <KV k="Repo"            v={a.repo_url} />
          <KV k="Path"            v={a.path} />
          <KV k="Target revision" v={a.target_revision} />
          <KV k="Sync policy"     v={a.auto_sync ? "Automated" : "Manual"} mono={false} />
          <KV k="Dest namespace"  v={a.dest_namespace} />
          <KV k="Dest cluster"    v={a.dest_server.replace(/^https?:\/\//, "")} />
          <KV k="Age"             v={a.age} />
          {a.owner_appset && (
            <div className="flex items-baseline gap-3 py-1.5 border-b border-edge-raw/60 last:border-b-0">
              <span className="text-[11px] text-mute w-[110px] shrink-0">Owner</span>
              <button
                onClick={() => onNavigate?.("argo-appsets", a.namespace, a.owner_appset!)}
                className="mono text-[12px] text-accent hover:underline truncate flex items-center gap-1 group"
              >
                {a.owner_appset}
                <ArrowUpRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          )}
        </>
      );
    }
    case "argo-appsets": {
      const s = resource.item;
      return (
        <>
          <KV k="Namespace" v={s.namespace} />
          <KV k="Project"   v={s.project} />
          <KV k="Status"    v={s.status} />
          <KV k="Message"   v={s.message || "—"} />
          <KV k="Generated apps" v={String(s.generated_apps)} />
          <KV k="Age"       v={s.age} />
          {s.generators.length > 0 && (
            <div className="mt-3">
              <div className="text-[10.5px] uppercase tracking-wide text-mute mb-1.5">Generators ({s.generators.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {s.generators.map((g) => (
                  <span key={g} className="mono text-[11px] text-mute bg-surface-tint/4 ring-1 ring-edge-raw/60 px-1.5 py-0.5 rounded-sm">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      );
    }
    case "argo-projects": {
      const p = resource.item;
      return (
        <>
          <KV k="Description" v={p.description || "—"} />
          <KV k="Cluster resources" v={p.cluster_resource_allowed ? "Allowed" : "Denied"} />
          {p.orphaned_warn && (
            <div className="mt-1 mb-1 p-2.5 rounded-lg bg-warn/6 ring-1 ring-warn/30">
              <p className="text-[11.5px] text-warn/90">Orphaned resources warning is enabled for this project.</p>
            </div>
          )}
          <KV k="Age" v={p.age} />
          {p.source_repos.length > 0 && (
            <div className="mt-3">
              <div className="text-[10.5px] uppercase tracking-wide text-mute mb-1.5">Source repos ({p.source_repos.length})</div>
              <div className="flex flex-col gap-1">
                {p.source_repos.map((r) => (
                  <span key={r} className="mono text-[11px] text-mute bg-surface-tint/4 ring-1 ring-edge-raw/60 px-1.5 py-0.5 rounded-sm truncate" title={r}>
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
          {p.destinations.length > 0 && (
            <div className="mt-3">
              <div className="text-[10.5px] uppercase tracking-wide text-mute mb-1.5">Destinations ({p.destinations.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {p.destinations.map((d) => (
                  <span key={d} className="mono text-[11px] text-mute bg-surface-tint/4 ring-1 ring-edge-raw/60 px-1.5 py-0.5 rounded-sm">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      );
    }
    case "ep": {
      const e = resource.item;
      return (
        <>
          <KV k="Addresses"     v={e.addresses || "—"} />
          <KV k="Address count" v={String(e.address_count)} />
          <KV k="Ready"         v={String(e.ready_count)} />
          <KV k="Age"           v={e.age} />
        </>
      );
    }
    case "eps": {
      const e = resource.item;
      return (
        <>
          <KV k="Service"      v={e.service || "—"} />
          <KV k="Address type" v={e.address_type} />
          <KV k="Endpoints"    v={String(e.endpoints)} />
          <KV k="Ready"        v={String(e.ready)} />
          <KV k="Ports"        v={e.ports || "—"} />
          <KV k="Age"          v={e.age} />
        </>
      );
    }
    case "rs": {
      const r = resource.item;
      return (
        <>
          <KV k="Desired" v={String(r.desired)} />
          <KV k="Current" v={String(r.current)} />
          <KV k="Ready"   v={String(r.ready)} />
          <KV k="Owner"   v={r.owner || "—"} />
          <KV k="Images"  v={r.images} />
          <KV k="Age"     v={r.age} />
        </>
      );
    }
    case "mwc":
    case "vwc": {
      const w = resource.item;
      return (
        <>
          <KV k="Webhooks"       v={String(w.webhooks)} />
          <KV k="Failure policy" v={w.failure_policy || "—"} />
          <KV k="Targets"        v={w.targets || "—"} />
          <KV k="Age"            v={w.age} />
        </>
      );
    }
    case "vs": {
      const v = resource.item;
      return (
        <>
          <KV k="Ready"          v={v.ready ? "True" : "False"} />
          <KV k="Source PVC"     v={v.source_pvc || "—"} />
          <KV k="Snapshot class" v={v.snapshot_class || "—"} />
          <KV k="Restore size"   v={v.restore_size || "—"} />
          <KV k="Age"            v={v.age} />
        </>
      );
    }
  }
}

// ─── Kind label + healthy heuristic ──────────────────────────────────────────

function kindLabel(resource: SelectedResource): string {
  const map: Record<SelectedResource["kind"], string> = {
    deploy: "Deployment",
    sts:    "StatefulSet",
    ds:     "DaemonSet",
    jobs:   "Job",
    cron:   "CronJob",
    hpa:    "HorizontalPodAutoscaler",
    svc:    "Service",
    ing:    "Ingress",
    cm:     "ConfigMap",
    sec:    "Secret",
    pvc:    "PersistentVolumeClaim",
    pv:     "PersistentVolume",
    sc:     "StorageClass",
    nodes:  "Node",
    ns:     "Namespace",
    crd:    "CustomResourceDefinition",
    netpol:     "NetworkPolicy",
    sa:         "ServiceAccount",
    roles:      "Role",
    croles:     "ClusterRole",
    rbindings:  "RoleBinding",
    crbindings: "ClusterRoleBinding",
    helm:       "HelmRelease",
    pdb:        "PodDisruptionBudget",
    cert:       "Certificate",
    argocd:     "Application",
    "argo-appsets":  "ApplicationSet",
    "argo-projects": "AppProject",
    gw:         "Gateway",
    httproute:  "HTTPRoute",
    rq:         "ResourceQuota",
    lr:         "LimitRange",
    pc:         "PriorityClass",
    "flux-ks":  "Flux Kustomization",
    "flux-hr":  "Flux HelmRelease",
    ep:  "Endpoints",
    eps: "EndpointSlice",
    rs:  "ReplicaSet",
    mwc: "MutatingWebhookConfiguration",
    vwc: "ValidatingWebhookConfiguration",
    vs:  "VolumeSnapshot",
  };
  return map[resource.kind];
}

// involvedObject.kind to filter the Events tab on (v1.2.1). Without it a
// Deployment and a Service that share a name pollute each other's Events.
// `null` = no kind filter. Typed as a Record over every SelectedResource kind
// so tsc catches a new kind that forgets to say which Kind its events carry.
// Mostly kindLabel's value; the exceptions are Flux (kindLabel is a display
// name, the API Kind has no "Flux " prefix) and Helm (a release is not a
// Kubernetes kind at all, so the pre-existing name-only lookup is kept).
const EVENT_INVOLVED_KIND: Record<SelectedResource["kind"], string | null> = {
  deploy: "Deployment",
  sts: "StatefulSet",
  ds: "DaemonSet",
  jobs: "Job",
  cron: "CronJob",
  hpa: "HorizontalPodAutoscaler",
  svc: "Service",
  ing: "Ingress",
  cm: "ConfigMap",
  sec: "Secret",
  pvc: "PersistentVolumeClaim",
  pv: "PersistentVolume",
  sc: "StorageClass",
  nodes: "Node",
  ns: "Namespace",
  crd: "CustomResourceDefinition",
  netpol: "NetworkPolicy",
  sa: "ServiceAccount",
  roles: "Role",
  croles: "ClusterRole",
  rbindings: "RoleBinding",
  crbindings: "ClusterRoleBinding",
  helm: null,
  pdb: "PodDisruptionBudget",
  cert: "Certificate",
  argocd: "Application",
  "argo-appsets": "ApplicationSet",
  "argo-projects": "AppProject",
  gw: "Gateway",
  httproute: "HTTPRoute",
  rq: "ResourceQuota",
  lr: "LimitRange",
  pc: "PriorityClass",
  "flux-ks": "Kustomization",
  "flux-hr": "HelmRelease",
  ep: "Endpoints",
  eps: "EndpointSlice",
  rs: "ReplicaSet",
  mwc: "MutatingWebhookConfiguration",
  vwc: "ValidatingWebhookConfiguration",
  vs: "VolumeSnapshot",
};

function isHealthy(resource: SelectedResource): boolean {
  switch (resource.kind) {
    case "deploy": return resource.item.available > 0;
    case "sts":    return resource.item.replicas > 0;
    case "ds":     return resource.item.ready === resource.item.desired;
    case "jobs":   return resource.item.status === "Complete" || resource.item.status === "Succeeded";
    case "cron":   return !resource.item.suspend;
    case "hpa":    return resource.item.current_replicas > 0;
    case "svc":    return true;
    case "ing":    return !!resource.item.address;
    case "cm":     return true;
    case "sec":    return true;
    case "pvc":    return resource.item.status === "Bound";
    case "pv":     return resource.item.status === "Bound" || resource.item.status === "Available";
    case "nodes":  return resource.item.status === "ok";
    case "ns":     return resource.item.phase === "Active";
    case "crd":    return resource.item.established;
    case "netpol":    return true;
    case "sa":        return true;
    case "roles":     return true;
    case "croles":    return true;
    case "rbindings": return true;
    case "crbindings":return true;
    case "helm":      return resource.item.status === "deployed";
    case "sc":        return true;
    case "pdb":       return resource.item.disruptions_allowed > 0;
    case "cert":      return resource.item.ready;
    case "argocd":    return isArgoHealthy(resource.item.health_status);
    case "argo-appsets":  return resource.item.status === "Healthy";
    case "argo-projects": return !resource.item.orphaned_warn;
    case "gw":        return resource.item.status === "Healthy";
    case "httproute": return resource.item.status === "Healthy";
    case "rq":        return true;
    case "lr":        return true;
    case "pc":        return true;
    case "flux-ks":   return resource.item.status === "Healthy";
    case "flux-hr":   return resource.item.status === "Healthy";
    case "ep":        return resource.item.ready_count > 0;
    case "eps":       return resource.item.ready > 0;
    case "rs":        return resource.item.ready === resource.item.desired;
    case "mwc":       return true;
    case "vwc":       return true;
    case "vs":        return resource.item.ready;
  }
}

type ChipTone = "ok" | "bad" | "terminating" | "neutral";

/**
 * The one header chip for every kind except Application (which shows separate Health and Sync chips).
 * The generic words stay Healthy / Degraded until Q15 is applied (F4). A Namespace shows its phase instead:
 * a Terminating namespace is being deleted, not "Degraded".
 */
function statusChip(resource: SelectedResource): { label: string; tone: ChipTone } {
  if (resource.kind === "ns") {
    if (isTerminating(resource.item)) return { label: "Terminating", tone: "terminating" };
    if (resource.item.phase === "Active") return { label: "Active", tone: "ok" };
    return { label: resource.item.phase || "Unknown", tone: "neutral" };
  }
  const healthy = isHealthy(resource);
  return { label: healthy ? "Healthy" : "Degraded", tone: healthy ? "ok" : "bad" };
}

/** Header chip classes per tone. Literal strings so Tailwind sees them; `terminating` is the Terminating pod look. */
const CHIP_STYLE: Record<ChipTone, { cls: string; dot: string; pulse: boolean }> = {
  ok:          { cls: "text-ok bg-ok/10 ring-ok/30", dot: "bg-ok", pulse: false },
  bad:         { cls: "text-bad bg-bad/10 ring-bad/30", dot: "bg-bad", pulse: false },
  terminating: { cls: "text-purple bg-purple/10 ring-purple/30", dot: "bg-purple", pulse: true },
  neutral:     { cls: "text-mute bg-surface-tint/5 ring-edge", dot: "bg-mute", pulse: false },
};

function resourceName(resource: SelectedResource): string {
  return resource.item.name;
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = "Overview" | "Summary" | "Events" | "YAML" | "Values" | "Resources" | "Pods" | "Logs" | "Relationships" | "History" | "TLS" | "Timeline";

// ─── ArgoCD managed resources tab ────────────────────────────────────────────

/**
 * The kind cell of a managed-resource row (X-1). The row's onClick stays for the mouse; a clickable kind is a native
 * button with no handler of its own, so Enter and Space dispatch a click that bubbles to the row.
 */
function ArgoKindCell({ r, clickable }: { r: ArgoCdResource; clickable: boolean }) {
  if (!clickable) return <span className="mono text-ink">{r.kind}</span>;
  return (
    <button
      type="button"
      aria-label={`Open ${r.kind} ${r.name}`}
      className="mono text-accent group-hover:underline rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      {r.kind}
    </button>
  );
}

function ArgoCdResourcesTab({
  resources,
  isLoading,
  onNavigate,
  context,
  appNamespace,
  appName,
}: {
  resources: ArgoCdResource[];
  isLoading: boolean;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
  context: string;
  appNamespace: string;
  appName: string;
}) {
  // ARGO-1: Health and Sync are two independent single-select filters (argocd.md).
  const [healthFilter, setHealthFilter] = useState<"all" | ArgoHealthStatus>("all");
  const [syncFilter, setSyncFilter] = useState<"all" | ArgoSyncStatus>("all");
  const [grouped, setGrouped] = useState<boolean>(() => {
    try { return localStorage.getItem("argocd-resources-view") === "grouped"; } catch { return false; }
  });
  const [expandedOutOfSync, setExpandedOutOfSync] = useState<Set<string>>(new Set());
  const refresh = useRefreshArgoCdApp();
  const tabIdentity = useClusterIdentity(context);
  const { guarded: guardedRefresh, dialog: refreshDialog } = useGuardedAction(context);
  const refreshReason = pickDisabledReason({ readOnly: tabIdentity.readOnly });
  const handleRefresh = (hard: boolean) => {
    if (!appName || refreshReason || refresh.isPending) return;
    guardedRefresh({
      title: `${hard ? "Hard refresh" : "Refresh"} ${appName}`,
      description: hard
        ? `Tells ArgoCD to clear its cache and re-fetch "${appName}" from git.`
        : `Tells ArgoCD to re-check drift for "${appName}" now.`,
      confirmLabel: hard ? "Hard refresh" : "Refresh",
      equivalent: argoRefreshEquiv({ context, namespace: appNamespace, name: appName, hard }),
      run: () => { refresh.mutate({ context, namespace: appNamespace, name: appName, hard }); },
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5 border-b border-edge-raw/50">
            <span className="bg-surface-tint/4 animate-pulse rounded-sm h-3 w-[60px]" />
            <span className="bg-surface-tint/4 animate-pulse rounded-sm h-3 flex-1" />
            <span className="bg-surface-tint/4 animate-pulse rounded-sm h-3 w-[80px]" />
            <span className="bg-surface-tint/4 animate-pulse rounded-sm h-4 w-[56px]" />
            <span className="bg-surface-tint/4 animate-pulse rounded-sm h-4 w-[60px]" />
          </div>
        ))}
      </div>
    );
  }
  if (resources.length === 0) {
    return <p className="py-12 text-center text-[13px] text-mute">No managed resources found</p>;
  }

  // Counts are per status and always taken from the full unfiltered list: a Missing resource is counted
  // under Missing, not Degraded, and a Healthy but OutOfSync one is counted under both Healthy and OutOfSync.
  const healthCount = (st: ArgoHealthStatus) => argoHealthCount(resources, st);
  const syncCount = (st: ArgoSyncStatus) => argoSyncCount(resources, st);

  // Filter, then sort so problematic rows come first
  const displayed = filterArgoResources(resources, healthFilter, syncFilter);

  const sorted = [...displayed].sort((a, b) => argoSortScore(a) - argoSortScore(b));

  // Grouped view: group by kind, within each kind sort by health priority
  const groupedRows: Array<{ kind: string; items: ArgoCdResource[] }> = [];
  if (grouped) {
    const byKind = new Map<string, ArgoCdResource[]>();
    for (const r of sorted) {
      const list = byKind.get(r.kind) ?? [];
      list.push(r);
      byKind.set(r.kind, list);
    }
    for (const [kind, items] of byKind) {
      groupedRows.push({ kind, items: [...items].sort((a, b) => argoSortScore(a) - argoSortScore(b)) });
    }
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Count / filter bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] mono font-medium bg-accent/10 text-accent ring-1 ring-accent/20">
          {resources.length} resources
        </span>
        <div role="group" aria-label="Health" className="flex items-center gap-1.5 flex-wrap">
          {visibleHealthFilters(resources, healthFilter).map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={healthFilter === st}
              onClick={() => setHealthFilter(f => f === st ? "all" : st)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] mono font-medium ring-1 transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${healthFilter === st ? ARGO_CHIP_CLS[st].on : ARGO_CHIP_CLS[st].off}`}
            >
              <span aria-hidden>{argoHealthPill(st).icon}</span>{st} {healthCount(st)}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Sync" className="flex items-center gap-1.5 flex-wrap">
          {SYNC_FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={syncFilter === st}
              onClick={() => setSyncFilter(f => f === st ? "all" : st)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] mono font-medium ring-1 transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${syncFilter === st ? ARGO_CHIP_CLS[st].on : ARGO_CHIP_CLS[st].off}`}
            >
              <span aria-hidden>{argoSyncPill(st).icon}</span>{st} {syncCount(st)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => {
              const next = !grouped;
              setGrouped(next);
              try { localStorage.setItem("argocd-resources-view", next ? "grouped" : "flat"); } catch { /* */ }
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10.5px] mono font-medium ring-1 ring-edge text-mute hover:text-ink hover:bg-surface-tint/4 transition-colors"
            title={grouped ? "Switch to flat view" : "Switch to grouped view"}
          >
            {grouped ? "Flat" : "Grouped"}
          </button>
          <button
            type="button"
            onClick={() => handleRefresh(false)}
            title="Refresh — tells ArgoCD to re-check drift now (≈3-min reconciliation lag otherwise)"
            {...disabledAttrs(refreshReason)}
            aria-disabled={refresh.isPending || !!refreshReason || undefined}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10.5px] mono font-medium ring-1 ring-edge text-mute hover:text-ink hover:bg-surface-tint/4 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors"
          >
            {refresh.isPending && !refresh.variables?.hard
              ? <Loader2 size={11} className="animate-spin" />
              : <RefreshCw size={11} />}
            Refresh
          </button>
          <button
            type="button"
            onClick={() => handleRefresh(true)}
            title="Hard refresh — force-reload manifests from git, ignoring ArgoCD cache"
            {...disabledAttrs(refreshReason)}
            aria-disabled={refresh.isPending || !!refreshReason || undefined}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10.5px] mono font-medium ring-1 ring-edge text-mute hover:text-ink hover:bg-surface-tint/4 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors"
          >
            {refresh.isPending && refresh.variables?.hard
              ? <Loader2 size={11} className="animate-spin" />
              : <RefreshCcw size={11} />}
            Hard
          </button>
        </div>
      </div>
      {refreshDialog}
      {refreshReason && <p className="text-[11px] text-mute">{refreshReason}</p>}
      {refresh.isSuccess && !refresh.isPending && (
        <p role="status" className="text-[10.5px] text-ok mono">✓ Refresh triggered — sync status will update within seconds.</p>
      )}
      {refresh.isError && (
        <p role="alert" className="text-[10.5px] text-bad mono">✕ {(refresh.error as any)?.message ?? String(refresh.error)}</p>
      )}

      {/* Table */}
      <table className="w-full text-[11.5px] border-collapse">
        <thead>
          <tr className="border-b border-edge text-[10.5px] uppercase tracking-wider text-mute">
            <th className="text-left py-1.5 pr-3 font-semibold">Kind</th>
            <th className="text-left py-1.5 pr-3 font-semibold">Name</th>
            {!grouped && <th className="text-left py-1.5 pr-3 font-semibold w-[90px]">Namespace</th>}
            <th className="text-left py-1.5 pr-3 font-semibold w-[80px]">Sync</th>
            <th className="text-left py-1.5 font-semibold w-[100px]">Health</th>
          </tr>
        </thead>
        <tbody>
          {grouped ? (
            groupedRows.map(({ kind, items }) => {
              const degradedInKind = items.filter(isDegradedOrMissing).length;
              return (
                <Fragment key={`group-${kind}`}>
                  <tr className="bg-surface-tint/2 border-b border-edge">
                    <td colSpan={4} className="px-3 py-1 text-[10px] uppercase tracking-wider text-mute font-semibold">
                      <span>{kind}</span>
                      <span className="ml-2 text-mute normal-case tracking-normal font-normal">· {items.length} total</span>
                      {degradedInKind > 0 && (
                        <span className="ml-2 text-bad font-medium">✕ {degradedInKind} Degraded</span>
                      )}
                    </td>
                  </tr>
                  {items.map((r, i) => {
                    const targetKind = KIND_TO_RESOURCE_TYPE[r.kind];
                    const clickable = !!targetKind && !!onNavigate;
                    const isDegraded = isDegradedOrMissing(r);
                    const isOutOfSync = !isDegraded && r.sync_status === "OutOfSync";
                    const rowKey = `${kind}-${i}`;
                    const isExpanded = expandedOutOfSync.has(rowKey);
                    return (
                      <Fragment key={rowKey}>
                        <tr
                          onClick={clickable ? () => onNavigate!(targetKind, r.namespace, r.name) : undefined}
                          className={`border-b border-edge-raw/50 ${clickable ? "cursor-pointer hover:bg-surface-tint/6 group" : "hover:bg-surface-tint/2.5"}`}
                        >
                          <td className={`py-1.5 pr-3 pl-1 border-l-2 ${isDegraded ? "border-bad/60" : isOutOfSync ? "border-warn/50" : "border-transparent"}`}>
                            <ArgoKindCell r={r} clickable={clickable} />
                          </td>
                          <td className="py-1.5 pr-3">
                            <span className="mono text-[11.5px] text-ink block">{r.name || "—"}</span>
                            <span className="mono text-[10px] text-mute block">{r.namespace || ""}</span>
                          </td>
                          <td className="py-1.5 pr-3">
                            <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded-sm text-[10px] mono ring-1 ${argoSyncPill(r.sync_status).cls}`}>
                              <span>{argoSyncPill(r.sync_status).icon}</span>{r.sync_status || "—"}
                            </span>
                            {r.requires_pruning && (
                              <span className="ml-1 inline-flex items-center px-1 py-px rounded-sm text-[9.5px] mono bg-bad/10 text-bad ring-1 ring-bad/30" title="Will be pruned on next sync with prune enabled">
                                prune
                              </span>
                            )}
                            {isOutOfSync && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedOutOfSync(s => { const n = new Set(s); n.has(rowKey) ? n.delete(rowKey) : n.add(rowKey); return n; }); }}
                                className="ml-1 mono text-[9.5px] text-warn hover:text-warn underline"
                              >
                                {isExpanded ? "hide" : "diff"}
                              </button>
                            )}
                          </td>
                          <td className="py-1.5">
                            {r.health_status && r.health_status !== "Unknown" ? (
                              <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded-sm text-[10px] mono ring-1 ${argoHealthPill(r.health_status).cls}`} title={r.health_message || undefined}>
                                <span>{argoHealthPill(r.health_status).icon}</span>{r.health_status}
                              </span>
                            ) : (
                              <span className="text-mute text-[10px] mono">—</span>
                            )}
                          </td>
                        </tr>
                        {isOutOfSync && isExpanded && (
                          <tr className="bg-warn/2">
                            <td colSpan={4} className="px-3 py-2">
                              <div className="rounded-lg ring-1 ring-warn/20 p-2.5 text-[11px] text-warn mono">
                                OutOfSync — this resource differs from git. Open the YAML tab to view live manifest, or click Sync to reconcile.
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })
          ) : (
            sorted.map((r, i) => {
              const targetKind = KIND_TO_RESOURCE_TYPE[r.kind];
              const clickable = !!targetKind && !!onNavigate;
              const isDegraded = isDegradedOrMissing(r);
              const isOutOfSync = !isDegraded && r.sync_status === "OutOfSync";
              const firstTdBorder = isDegraded
                ? "border-l-2 border-bad/60"
                : isOutOfSync
                ? "border-l-2 border-warn/50"
                : "border-l-2 border-transparent";
              const rowKey = `flat-${i}`;
              const isExpanded = expandedOutOfSync.has(rowKey);
              return (
                <Fragment key={rowKey}>
                  <tr
                    onClick={clickable ? () => onNavigate!(targetKind, r.namespace, r.name) : undefined}
                    className={`border-b border-edge-raw/50 last:border-b-0 ${clickable ? "cursor-pointer hover:bg-surface-tint/6 group" : "hover:bg-surface-tint/2.5"}`}
                  >
                    <td className={`py-1.5 pr-3 pl-1 ${firstTdBorder}`}>
                      <ArgoKindCell r={r} clickable={clickable} />
                      {r.group && <span className="ml-1 text-mute text-[10px]">{r.group}</span>}
                    </td>
                    <td className="py-1.5 pr-3 mono text-mute truncate max-w-[120px]" title={r.name}>{r.name || "—"}</td>
                    <td className="py-1.5 pr-3 mono text-mute text-[10.5px]">{r.namespace || "—"}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded-sm text-[10px] mono ring-1 ${argoSyncPill(r.sync_status).cls}`}>
                        <span>{argoSyncPill(r.sync_status).icon}</span>{r.sync_status || "—"}
                      </span>
                      {r.requires_pruning && (
                        <span className="ml-1 inline-flex items-center px-1 py-px rounded-sm text-[9.5px] mono bg-bad/10 text-bad ring-1 ring-bad/30" title="Will be pruned on next sync with prune enabled">
                          prune
                        </span>
                      )}
                      {isOutOfSync && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedOutOfSync(s => { const n = new Set(s); n.has(rowKey) ? n.delete(rowKey) : n.add(rowKey); return n; }); }}
                          className="ml-1 mono text-[9.5px] text-warn hover:text-warn underline"
                        >
                          {isExpanded ? "hide" : "diff"}
                        </button>
                      )}
                    </td>
                    <td className="py-1.5">
                      {r.health_status && r.health_status !== "Unknown" ? (
                        <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded-sm text-[10px] mono ring-1 ${argoHealthPill(r.health_status).cls}`} title={r.health_message || undefined}>
                          <span>{argoHealthPill(r.health_status).icon}</span>{r.health_status}
                        </span>
                      ) : (
                        <span className="text-mute text-[10px] mono">—</span>
                      )}
                    </td>
                  </tr>
                  {isOutOfSync && isExpanded && (
                    <tr className="bg-warn/2">
                      <td colSpan={5} className="px-3 py-2">
                        <div className="rounded-lg ring-1 ring-warn/20 p-2.5 text-[11px] text-warn mono">
                          OutOfSync — this resource differs from git. Open the YAML tab to view live manifest, or click Sync to reconcile.
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Workload → Pods tab ──────────────────────────────────────────────────────

function WorkloadPodsTab({
  pods,
  isLoading,
  onNavigate,
}: {
  pods: Pod[];
  isLoading: boolean;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 rounded-lg bg-surface-tint/4 animate-pulse" />
        ))}
      </div>
    );
  }

  if (pods.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center gap-3">
        <Boxes size={28} className="text-dim" />
        <p className="text-[13px] text-mute">No pods</p>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-1">
      {pods.map((p) => {
        const crashReason = p.containers_status?.find(
          (cs) => cs.restart_count > 0 && cs.last_reason && cs.last_reason !== "Completed"
        )?.last_reason;
        const dotCls = podStatusStyle(p.status).dot;
        return (
          <button
            key={`${p.namespace}/${p.name}`}
            onClick={() => onNavigate?.("pods", p.namespace, p.name)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-surface-tint/4 text-left transition-colors group"
          >
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`} />
            <span className="mono text-[11.5px] flex-1 truncate group-hover:text-ink text-mute">{p.name}</span>
            {p.restarts > 0 && (
              <span className={`mono text-[10px] px-1.5 py-px rounded ring-1 shrink-0 ${
                crashReason && crashReason !== "Completed"
                  ? crashReason === "OOMKilled"
                    ? "text-bad bg-bad/10 ring-bad/20"
                    : "text-warn bg-warn/10 ring-warn/20"
                  : "text-mute bg-surface-tint/4 ring-edge"
              }`}>
                ↻ {p.restarts}{crashReason && crashReason !== "Completed" ? ` · ${crashReason}` : ""}
              </span>
            )}
            <span className="mono text-[10.5px] text-mute shrink-0">{p.age}</span>
          </button>
        );
      })}
    </div>
  );
}

// "rs" is a workload kind for Pods/Logs purposes only — workload_pods.rs
// supports "rs" (ReplicaSet -> Pods, direct) but graph.rs does not (its match
// falls through to `_ => Err(...)` for any kind other than
// deploy/sts/ds/jobs/cron), so Relationships/useResourceGraph is gated
// separately below via `hasRelationships`, not this flag directly.
const WORKLOAD_KINDS: SelectedResource["kind"][] = ["deploy", "sts", "ds", "jobs", "cron", "rs"];

// ─── Summary tab ─────────────────────────────────────────────────────────────

// Resolve which ArgoCD Application (if any) manages this resource, in order of
// confidence. tracking-id wins when present; app.kubernetes.io/instance is a
// plain-Helm convention too, so it's flagged low-confidence.
// Exported for src/components/edit/ResourceEditor.tsx's GitOps warning
// banner (docs/plan-guided-edit.md §6b) — same signal, zero extra requests,
// since the live object the editor fetches already carries these fields.
export function resolveManagedBy(
  annotations: Record<string, string>, labels: Record<string, string>,
): { app: string; confident: boolean } | null {
  const trackingId = annotations["argocd.argoproj.io/tracking-id"];
  if (trackingId) return { app: trackingId.split(":")[0], confident: true };
  const instanceLabel = labels["argocd.argoproj.io/instance"];
  if (instanceLabel) return { app: instanceLabel, confident: true };
  const helmInstance = labels["app.kubernetes.io/instance"];
  if (helmInstance) return { app: helmInstance, confident: false };
  return null;
}

function ResourceSummaryTab({
  resource, context, ns, name, onNavigate,
}: {
  resource: SelectedResource;
  context: string;
  ns: string;
  name: string;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
}) {
  const [showAnnotations, setShowAnnotations] = useState(false);
  const isWorkload = (WORKLOAD_KINDS as string[]).includes(resource.kind);

  const { data: metadata } = useResourceMetadata(context, ns, resource.kind, name, true);
  const annotations = metadata?.annotations ?? {};
  const { data: conditions = [] } = useWorkloadConditions(context, ns, resource.kind, name, isWorkload);

  // Extract labels from the item if available (not all kinds have them)
  const item = (resource as any).item;
  const labels: [string, string][] = Object.entries(item?.labels ?? {});
  const annotationEntries = Object.entries(annotations);
  const managedBy = resolveManagedBy(annotations, metadata?.labels ?? {});

  return (
    <div className="p-4 flex flex-col gap-4 overflow-auto">
      {/* Managed by — ArgoCD cross-reference */}
      {managedBy && (
        <button
          onClick={() => onNavigate?.("argocd", "", managedBy.app)}
          className="flex items-center gap-2 rounded-lg bg-card/70 ring-1 ring-edge p-3 text-left hover:bg-surface-tint/3 transition-colors group"
        >
          <span className="text-[11px] uppercase tracking-wider text-mute shrink-0">
            {managedBy.confident ? "Managed by" : "Possibly managed by"}
          </span>
          <span className={`mono text-[12px] ${managedBy.confident ? "text-accent" : "text-mute"}`}>{managedBy.app}</span>
          <ArrowUpRight size={12} className="text-mute opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
        </button>
      )}

      {/* Conditions (workloads only) */}
      {conditions.length > 0 && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3 overflow-hidden">
          <h3 className="text-[11px] uppercase tracking-wider text-mute mb-2">Conditions</h3>
          <table className="w-full text-[11.5px] table-fixed">
            <thead>
              <tr className="text-mute text-[10.5px] uppercase">
                <th className="text-left pb-1 pr-3 w-[28%]">Type</th>
                <th className="text-left pb-1 pr-3 w-[14%]">Status</th>
                <th className="text-left pb-1 pr-3 w-[22%]">Reason</th>
                <th className="text-left pb-1 w-[36%]">Message</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((c) => (
                <tr key={c.type_} className="border-t border-edge-raw/40">
                  <td className="py-1 pr-3 mono truncate" title={c.type_}>{c.type_}</td>
                  <td className={`py-1 pr-3 ${c.status === "True" ? "text-ok" : c.status === "False" ? "text-bad" : "text-warn"}`}>
                    {c.status}
                  </td>
                  <td className="py-1 pr-3 text-mute truncate" title={c.reason}>{c.reason}</td>
                  <td className="py-1 text-mute wrap-break-word leading-snug">{c.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pod Template section — workloads only, when backend provides it */}
      {isWorkload && (() => {
        const pt: PodTemplateSpec | undefined = item?.pod_template;
        if (!pt) return null;
        return (
          <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
            <h3 className="text-[11px] uppercase tracking-wider text-mute mb-2">
              Pod Template
            </h3>
            <div className="flex flex-col">
              {pt.containers.map((c, i) => {
                const cpuRange = c.cpu_limit_m
                  ? `${c.cpu_request_m ?? '—'}m–${c.cpu_limit_m}m`
                  : c.cpu_request_m ? `${c.cpu_request_m}m` : '';
                const memRange = c.mem_limit_mi
                  ? `${c.mem_request_mi ?? '—'}Mi–${c.mem_limit_mi}Mi`
                  : c.mem_request_mi ? `${c.mem_request_mi}Mi` : '';

                return (
                  <div key={i} className="flex items-center gap-2 py-1 text-[11px] border-t border-edge-raw/30 first:border-t-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-dim/30 shrink-0" />
                    <span className="mono text-ink shrink-0 w-[90px] truncate">{c.name}</span>
                    {c.is_init && (
                      <span className="text-[9px] uppercase tracking-wider bg-status-purple/10 ring-1 ring-status-purple/20 text-status-purple px-1 rounded-sm shrink-0">
                        init
                      </span>
                    )}
                    <span className="mono text-mute flex-1 min-w-0 truncate text-[10.5px]" title={c.image}>
                      {c.image}
                    </span>
                    {(cpuRange || memRange) && (
                      <span className="mono text-[10px] text-mute shrink-0 text-right">
                        {cpuRange} {memRange}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-col gap-1">
              {([
                ['IMAGE PULL POLICY', pt.image_pull_policy],
                ['SERVICE ACCOUNT', pt.service_account_name || 'default'],
                ['RESTART POLICY', pt.restart_policy],
              ] as [string, string | undefined][]).filter(([, v]) => v).map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-3 text-[11px]">
                  <span className="text-[10px] uppercase tracking-wider text-mute font-medium shrink-0 w-[130px]">
                    {label}
                  </span>
                  <span className="mono text-ink">{value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Labels */}
      {labels.length > 0 && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-mute mb-2">Labels</h3>
          <div className="flex flex-wrap gap-1.5">
            {labels.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 ring-1 ring-accent/20 text-[11px] mono"
              >
                <span className="text-accent">{k}</span>
                <span className="text-mute">=</span>
                <span className="text-ink">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Annotations */}
      {annotationEntries.length > 0 && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
          <button
            onClick={() => setShowAnnotations((v) => !v)}
            className="flex items-center justify-between w-full"
          >
            <h3 className="text-[11px] uppercase tracking-wider text-mute">
              Annotations ({annotationEntries.length})
            </h3>
            <span className="text-mute text-[11px]">{showAnnotations ? "Hide" : "Show"}</span>
          </button>
          {showAnnotations && (
            <div className="mt-2 flex flex-col gap-1">
              {annotationEntries.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[11px]">
                  <span className="mono text-accent shrink-0">{k}:</span>
                  <span className="text-mute truncate" title={v}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Relationships tab ────────────────────────────────────────────────────────

function graphStatusColor(status: string): string {
  if (status === "Running" || status === "Ready" || status === "Complete" || status === "Succeeded") return "text-ok";
  if (status === "Failed" || status === "Degraded" || status === "Error") return "text-bad";
  if (status === "Pending" || status === "Not Ready" || status === "Progressing" || status === "Scaled Down") return "text-warn";
  return "text-mute";
}

function GraphNodeRow({ node, depth = 0 }: { node: GraphNode; depth?: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <>
      <div className="flex items-center gap-2 py-1.5 hover:bg-surface-tint/3 rounded-sm px-2 cursor-default"
        style={{ paddingLeft: `${8 + depth * 20}px` }}>
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)}
            className="h-4 w-4 flex items-center justify-center text-mute hover:text-ink shrink-0">
            <span className={`transition-transform ${open ? "rotate-90" : ""} text-[10px]`}>▶</span>
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <span className="text-[11px] text-mute w-24 shrink-0">{node.kind}</span>
        <span className="mono text-[11.5px] flex-1 truncate">{node.name}</span>
        <span className={`mono text-[10.5px] shrink-0 ${graphStatusColor(node.status)}`}>{node.status}</span>
      </div>
      {open && hasChildren && node.children.map((child) => (
        <GraphNodeRow key={child.uid || child.name} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function RelationshipsTab({ nodes, isLoading }: { nodes: GraphNode[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-7 rounded-sm bg-surface-tint/4 animate-pulse" />
        ))}
      </div>
    );
  }
  if (nodes.length === 0) {
    return <p className="py-12 text-center text-[13px] text-mute">No owned resources found</p>;
  }
  return (
    <div className="p-3">
      <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-2">
        <div className="flex items-center gap-2 px-2 py-1 border-b border-edge-raw/60 mb-1">
          <span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold w-24 shrink-0">Kind</span>
          <span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold flex-1">Name</span>
          <span className="text-[10.5px] uppercase tracking-wider text-mute font-semibold shrink-0">Status</span>
        </div>
        {nodes.map((node) => (
          <GraphNodeRow key={node.uid || node.name} node={node} />
        ))}
      </div>
    </div>
  );
}

// ─── Events tab with severity filter ─────────────────────────────────────────

function EventsTabContent({
  events, isLoading, error, onRetry, kind, scopedToKind,
}: {
  events: import("../types/k8s").K8sEvent[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** Display Kind for the empty state ("No events for this Deployment."). */
  kind: string;
  /** False for Helm: events are matched on name only, so the "this Kind only" note would be untrue. */
  scopedToKind: boolean;
}) {
  const [eventFilter, setEventFilter] = useState<"all" | "warning">("all");

  const displayed = eventFilter === "warning" ? events.filter(e => e.type_ === "Warning") : events;
  const warningCount = events.filter(e => e.type_ === "Warning").length;
  const hiddenNormal = events.length - warningCount;

  return (
    <div className="p-4 flex flex-col gap-1">
      {!isLoading && !error && events.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2">
          <button
            onClick={() => setEventFilter("all")}
            aria-pressed={eventFilter === "all"}
            className={`px-2 py-0.5 rounded text-[10.5px] mono ring-1 transition-colors ${
              eventFilter === "all" ? "bg-surface-tint/8 text-ink ring-edge-raw/60" : "text-mute ring-edge hover:text-ink"
            }`}
          >
            All
            <span className="ml-1 text-mute text-[9.5px]">{events.length}</span>
          </button>
          {warningCount > 0 && (
            <button
              onClick={() => setEventFilter(f => f === "warning" ? "all" : "warning")}
              aria-pressed={eventFilter === "warning"}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] mono ring-1 transition-colors ${
                eventFilter === "warning" ? "bg-warn/20 text-warn ring-warn/40" : "bg-warn/10 text-warn ring-warn/30 hover:bg-warn/20 hover:text-warn"
              }`}
            >
              Warnings only
              <span className="px-1 py-px rounded-full bg-warn/20 text-warn text-[9.5px]">{warningCount}</span>
            </button>
          )}
        </div>
      )}
      {isLoading ? (
        <div role="status" aria-label="Loading events.">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-2.5 py-2 border-b border-edge-raw/60">
              <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-surface-tint/4 animate-pulse shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-32" />
                <div className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="py-12 flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] text-bad wrap-break-word max-w-full">
            Couldn&apos;t load events: {(error as any)?.message ?? String(error)}.
          </p>
          <button
            onClick={onRetry}
            className="h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11px] text-mute hover:text-ink mono"
          >
            Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <div role="status" className="py-12 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[13px] text-mute">No events for this {kind}.</p>
          <p className="text-[12px] text-mute">Kubernetes keeps events for about 1 hour, so older causes may not appear.</p>
        </div>
      ) : displayed.length === 0 ? (
        <div role="status" className="py-12 flex flex-col items-center gap-2 text-center">
          <CheckCircle2 size={24} className="text-ok" />
          <p className="text-[13px] text-mute">No warning events.</p>
          <p className="text-[12px] text-mute">{hiddenNormal} normal {hiddenNormal === 1 ? "event is" : "events are"} hidden.</p>
          <button
            onClick={() => setEventFilter("all")}
            className="h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11px] text-mute hover:text-ink mono"
          >
            Show all
          </button>
        </div>
      ) : (
        <>
          {displayed.map((e, i) => (
            <div key={i} className={`flex gap-2.5 py-2 border-b border-edge-raw/60 last:border-b-0 rounded-sm px-1 ${e.type_ === "Warning" ? "bg-warn/3" : ""}`}>
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${e.type_ === "Warning" ? "bg-warn" : "bg-mute/60"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {/* Severity is glyph + word, never colour alone. */}
                  <span className={`text-[10px] uppercase tracking-wider shrink-0 ${e.type_ === "Warning" ? "text-warn" : "text-mute"}`}>
                    <span aria-hidden>{e.type_ === "Warning" ? "⚠ " : "● "}</span>
                    {e.type_ === "Warning" ? "Warning" : "Normal"}
                  </span>
                  <span className={`text-[11px] font-semibold ${e.type_ === "Warning" ? "text-warn" : "text-mute"}`}>
                    {e.reason}
                  </span>
                  <span className="mono text-[10.5px] text-mute">{e.source}</span>
                  {e.count > 1 && (
                    <span className="mono text-[10px] px-1.5 py-px rounded-full bg-surface-tint/5 text-mute shrink-0">
                      ×{e.count}
                    </span>
                  )}
                  <span className="ml-auto mono text-[10.5px] text-mute">{e.age}</span>
                </div>
                <div className="text-[11.5px] text-ink/85 mt-0.5">{e.message}</div>
              </div>
            </div>
          ))}
          <p className="mt-3 pt-2 border-t border-edge-raw/60 text-[11px] text-mute">
            {scopedToKind ? `Events about this ${kind} only. Its pods and ReplicaSets have their own events. ` : ""}
            Kubernetes keeps events for about 1 hour.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Helm History tab ─────────────────────────────────────────────────────────
// docs/plan-kubeconfig-and-parity.md §3.3.

function HelmHistoryTab({
  context, namespace, release, history, isLoading,
}: {
  context: string;
  namespace: string;
  release: string;
  history: HelmRevision[];
  isLoading: boolean;
}) {
  const identity = useClusterIdentity(context);
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null);
  const rollback = useRollbackHelmRelease();
  const rollbackReason = pickDisabledReason({ readOnly: identity.readOnly });

  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 rounded-lg bg-surface-tint/4 animate-pulse" />
        ))}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center gap-3">
        <GitCommit size={28} className="text-dim" />
        <p className="text-[13px] text-mute">No revision history recorded</p>
      </div>
    );
  }

  const sorted = [...history].sort((a, b) => b.revision - a.revision);
  const latest = sorted[0]?.revision;

  return (
    <div className="p-3 flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-edge-raw/60 mb-1">
        <span className="mono text-[10px] uppercase tracking-wider text-mute font-semibold w-[52px] shrink-0">Rev</span>
        <span className="mono text-[10px] uppercase tracking-wider text-mute font-semibold w-[100px] shrink-0">Status</span>
        <span className="mono text-[10px] uppercase tracking-wider text-mute font-semibold flex-1">Chart</span>
        <span className="mono text-[10px] uppercase tracking-wider text-mute font-semibold w-[90px] shrink-0">Updated</span>
      </div>
      {sorted.map((rev) => (
        <div key={rev.revision} className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-tint/4 transition-colors">
          <span className="mono text-[11px] text-accent w-[52px] shrink-0">#{rev.revision}</span>
          <span className={`mono text-[10.5px] w-[100px] shrink-0 truncate ${
            rev.status === "deployed" ? "text-ok" : rev.status === "superseded" ? "text-mute" : "text-warn"
          }`}>
            {rev.status}
          </span>
          <span className="text-[11.5px] text-ink/80 flex-1 truncate" title={rev.description}>
            {rev.chart} <span className="text-mute">{rev.app_version}</span>
          </span>
          <span className="mono text-[10px] text-mute w-[90px] shrink-0 truncate">{rev.updated}</span>
          {rev.revision !== latest && (
            <button
              onClick={() => { if (rollbackReason) return; setRollbackTarget(rev.revision); }}
              {...disabledAttrs(rollbackReason)}
              className={`h-5 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[9.5px] text-mute hover:text-ink mono flex items-center gap-1 shrink-0 ${rollbackReason ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <StepBack size={9} /> Rollback
            </button>
          )}
        </div>
      ))}
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={rollbackTarget !== null ? helmRollbackEquiv({ context, namespace, release, revision: rollbackTarget }) : null}
        open={rollbackTarget !== null}
        title="Rollback Helm release"
        description={`Roll back "${release}" to revision #${rollbackTarget}? This runs "helm rollback".`}
        confirmLabel="Rollback"
        destructive={false}
        onConfirm={async () => {
          if (rollbackTarget === null) return;
          try {
            await rollback.mutateAsync({ context, namespace, release, revision: rollbackTarget });
            setRollbackTarget(null);
          } catch { /* error surfaced via rollback.isError below */ }
        }}
        onCancel={() => setRollbackTarget(null)}
        isPending={rollback.isPending}
      />
      {rollback.isError && (
        <p className="mono text-[10.5px] text-bad px-2 py-1">
          ✕ {(rollback.error as any)?.message ?? String(rollback.error)}
        </p>
      )}
    </div>
  );
}

// ─── ArgoCD History tab ───────────────────────────────────────────────────────

function ArgoCdHistoryTab({
  history, context, namespace, appName, autoSync,
}: {
  history: ArgoCdHistoryEntry[];
  context: string;
  namespace: string;
  appName: string;
  autoSync: boolean;
}) {
  const identity = useClusterIdentity(context);
  // Keyed by entry.id, never entry.revision: two history entries can share a
  // (short) revision, and the backend rolls back by history id.
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ArgoCdHistoryEntry | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackDone, setRollbackDone] = useState<string | null>(null);
  const rollback = useRollbackArgoCdApp();

  const AUTO_SYNC_REASON =
    "Auto-sync is on. ArgoCD doesn't allow a rollback while auto-sync is enabled. Turn off auto-sync first.";
  // Read-only first, then the auto-sync reason (DISABLE-PRECEDENCE).
  const rollbackReason = pickDisabledReason({ readOnly: identity.readOnly, capability: autoSync ? AUTO_SYNC_REASON : undefined });

  if (history.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center gap-3">
        <GitCommit size={28} className="text-dim" />
        <p className="text-[13px] text-mute">No deployment history recorded</p>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-edge-raw/60 mb-1">
        <span className="mono text-[10px] uppercase tracking-wider text-mute font-semibold w-[68px] shrink-0">Revision</span>
        <span className="mono text-[10px] uppercase tracking-wider text-mute font-semibold w-[80px] shrink-0">Deployed</span>
        <span className="mono text-[10px] uppercase tracking-wider text-mute font-semibold flex-1">Message</span>
      </div>
      {history.map((entry) => (
        <div key={entry.id}>
          <button
            onClick={() => setExpanded(e => e === entry.id ? null : entry.id)}
            aria-expanded={expanded === entry.id}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-tint/4 text-left transition-colors group"
          >
            <span className="mono text-[11px] text-accent w-[68px] shrink-0 truncate" title={entry.revision}>{entry.revision}</span>
            <span className="mono text-[11px] text-mute w-[80px] shrink-0">{entry.deployed_at}</span>
            <span className="text-[11.5px] text-ink/80 flex-1 truncate">{entry.message || "—"}</span>
            <span className="text-[10px] text-mute opacity-0 group-hover:opacity-100 shrink-0">
              {expanded === entry.id ? "▲" : "▼"}
            </span>
          </button>
          {expanded === entry.id && (
            <div className="mx-2 mb-1 p-2.5 rounded-lg bg-surface-tint/3 ring-1 ring-edge-raw/60 flex flex-col gap-2">
              {entry.author && (
                <p className="mono text-[11px] text-mute">by {entry.author}</p>
              )}
              <p className="mono text-[10px] text-mute">{entry.deployed_at_iso}</p>
              {autoSync && <p className="text-[11px] text-warn">{AUTO_SYNC_REASON}</p>}
              <button
                onClick={() => {
                  if (rollbackReason) return;
                  setRollbackError(null);
                  setRollbackDone(null);
                  setRollbackTarget(entry);
                }}
                {...disabledAttrs(rollbackReason)}
                className="self-start h-6 px-2.5 rounded-sm bg-warn/10 ring-1 ring-warn/30 text-[10.5px] text-warn mono hover:bg-warn/20 transition-colors aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-warn/10"
              >
                Roll back to this revision…
              </button>
            </div>
          )}
        </div>
      ))}
      {rollbackDone && (
        <p role="status" className="mono text-[10.5px] text-ok px-2 py-1">✓ {rollbackDone}</p>
      )}
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={rollbackTarget ? argoRollbackEquiv({ context, namespace, name: appName, historyId: rollbackTarget.id }) : null}
        open={rollbackTarget !== null}
        title={`Roll back ${appName} to revision ${rollbackTarget?.revision ?? ""}`}
        description={`Restores revision ${rollbackTarget?.revision ?? ""} and the source it was deployed from (repository, path and target revision).`}
        confirmLabel={rollback.isPending ? "Rolling back…" : rollbackError ? "Try again" : "Roll back"}
        destructive={false}
        phase={rollbackError ? "error" : "review"}
        status={rollbackError ? { tone: "error", text: rollbackError } : null}
        onConfirm={async () => {
          if (!rollbackTarget) return;
          setRollbackError(null);
          try {
            const msg = await rollback.mutateAsync({
              context, namespace, name: appName, historyId: rollbackTarget.id,
            });
            setRollbackTarget(null);
            setRollbackDone(msg);
          } catch (e) {
            const m = String((e as any)?.message ?? e).replace(/\.+$/, "");
            setRollbackError(`Couldn't roll back ${appName}: ${m}.`);
          }
        }}
        onCancel={() => { setRollbackTarget(null); setRollbackError(null); }}
        isPending={rollback.isPending}
      />
    </div>
  );
}

function tabsFor(resource: SelectedResource): Tab[] {
  if (resource.kind === "helm") return ["Overview", "Values", "History", "Events", "Timeline"];
  if (resource.kind === "argocd") return ["Overview", "Resources", "History", "Events", "Timeline"];
  if (resource.kind === "sec" && resource.item.type_ === "kubernetes.io/tls")
    return ["Overview", "TLS", "Summary", "Events", "YAML"];
  if ((WORKLOAD_KINDS as string[]).includes(resource.kind)) {
    const tabs: Tab[] = ["Overview", "Summary", "Pods", "Logs", "Relationships", "Events", ...(TIMELINE_KINDS.has(resource.kind) ? (["Timeline"] as Tab[]) : []), "YAML"];
    // "rs" has no graph.rs support (see WORKLOAD_KINDS comment) — Relationships
    // would just poll get_resource_graph into a permanent error every 30s.
    return resource.kind === "rs" ? tabs.filter((t) => t !== "Relationships") : tabs;
  }
  return ["Overview", "Summary", "Events", "YAML"];
}

function SaveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

// ─── ArgoCD action bar ────────────────────────────────────────────────────────

const SYNC_OPT_HELP: Record<string, string> = {
  prune: "removes resources not in git",
  dryRun: "simulates sync, no changes applied",
  force: "overwrites conflicting resources",
};

function ArgoCdActionBar({ context, namespace, name, destNamespace, destServer }: { context: string; namespace: string; name: string; destNamespace?: string; destServer?: string }) {
  const identity = useClusterIdentity(context);
  const sync = useSyncArgoCdApp();
  const refresh = useRefreshArgoCdApp();
  const [syncOpts, setSyncOpts] = useState({ prune: false, dryRun: false, force: false });
  // ARGO-5: the tone is state, never derived from the text. Success clears itself; an error stays until the next action.
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (feedback?.tone !== "ok") return;
    const t = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [feedback]);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const { guarded, dialog: guardedDialog } = useGuardedAction(context);
  const actionReason = pickDisabledReason({ readOnly: identity.readOnly });

  // Prune risk — only fetched when Prune is checked, so it's surfaced before the user confirms.
  const { data: appResources = [], isLoading: pruneResourcesLoading, isError: pruneResourcesError } =
    useArgoCdAppResources(context, namespace, name, syncOpts.prune);
  const pruneTargets = appResources.filter(r => r.requires_pruning);
  const pruneCountKnown = !pruneResourcesLoading && !pruneResourcesError;

  const busy = sync.isPending || refresh.isPending;

  const runSync = async () => {
    setFeedback(null);
    try {
      const msg = await sync.mutateAsync({ context, namespace, name, ...syncOpts });
      setFeedback({ tone: "ok", text: msg });
    } catch (e) {
      setFeedback({ tone: "error", text: `Couldn't sync ${name}: ${(e as any)?.message ?? String(e)}` });
    }
  };

  const handleSync = () => {
    if (actionReason || busy) return;
    if (syncOpts.prune) { setConfirmPrune(true); return; }
    guarded({
      title: `Sync ${name}`,
      description: syncOpts.dryRun ? `Runs a dry-run sync of "${name}". Nothing is applied.` : `Syncs "${name}" to its target revision.`,
      confirmLabel: "Sync",
      equivalent: argoSyncEquiv({ context, namespace, name, ...syncOpts }),
      run: runSync,
    });
  };

  const handleRefresh = (hard: boolean) => {
    if (actionReason || busy) return;
    guarded({
      title: `${hard ? "Hard refresh" : "Refresh"} ${name}`,
      description: hard
        ? `Tells ArgoCD to clear its cache and re-fetch "${name}" from git.`
        : `Tells ArgoCD to re-check drift for "${name}" now.`,
      confirmLabel: hard ? "Hard refresh" : "Refresh",
      equivalent: argoRefreshEquiv({ context, namespace, name, hard }),
      run: () => runRefresh(hard),
    });
  };

  const runRefresh = async (hard: boolean) => {
    setFeedback(null);
    try {
      const msg = await refresh.mutateAsync({ context, namespace, name, hard });
      setFeedback({ tone: "ok", text: msg });
    } catch (e) {
      setFeedback({ tone: "error", text: `Couldn't refresh ${name}: ${(e as any)?.message ?? String(e)}` });
    }
  };

  return (
    <div className="px-4 pt-4">
      <div className="rounded-xl bg-card/60 ring-1 ring-edge p-3 space-y-3">
        <div className="text-[10.5px] uppercase tracking-wider text-mute font-semibold">Actions</div>
      {/* Sync options */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {[
          { key: "prune" as const, label: "Prune" },
          { key: "dryRun" as const, label: "Dry run" },
          { key: "force" as const, label: "Force" },
        ].map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-0.5">
            <button
              onClick={() => setSyncOpts(v => ({ ...v, [key]: !v[key] }))}
              className={`px-2 py-0.5 rounded ring-1 mono text-[10.5px] transition-colors ${
                syncOpts[key]
                  ? "bg-accent/15 text-accent ring-accent/40"
                  : "text-mute ring-edge hover:text-ink"
              }`}
            >
              {label}
            </button>
            {syncOpts[key] && (
              <span className="text-[10.5px] text-mute">{SYNC_OPT_HELP[key]}</span>
            )}
          </div>
        ))}
      </div>
      {syncOpts.prune && (
        <p className={`text-[10.5px] mono ${syncOpts.dryRun ? "text-warn" : "text-bad"}`}>
          {pruneResourcesLoading
            ? "⚠ checking which resources would be pruned…"
            : pruneResourcesError
            ? "⚠ prune target count unknown (could not load current state)"
            : pruneTargets.length > 0
            ? `⚠ prune ${syncOpts.dryRun ? "would simulate deleting" : "will delete"} ${pruneTargets.length} resource${pruneTargets.length !== 1 ? "s" : ""}${syncOpts.dryRun ? " — dry run, nothing will actually be deleted" : ""}`
            : "no resources currently require pruning"}
        </p>
      )}
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSync}
          {...disabledAttrs(actionReason)}
          aria-disabled={busy || !!actionReason || undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/12 text-accent ring-1 ring-accent/30 text-[12px] font-medium hover:bg-accent/20 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors"
        >
          {sync.isPending ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
          Sync
        </button>
        <button
          type="button"
          onClick={() => handleRefresh(false)}
          {...disabledAttrs(actionReason)}
          aria-disabled={busy || !!actionReason || undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card/80 text-mute ring-1 ring-edge text-[12px] hover:text-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors"
        >
          {refresh.isPending && !refresh.variables?.hard ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
        <button
          type="button"
          onClick={() => handleRefresh(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card/80 text-mute ring-1 ring-edge text-[12px] hover:text-ink aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors"
          title="Hard refresh — clears cache and re-fetches from git"
          {...disabledAttrs(actionReason)}
          aria-disabled={busy || !!actionReason || undefined}
        >
          {refresh.isPending && refresh.variables?.hard ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
          Hard Refresh
        </button>
      </div>
      {actionReason && <p className="text-[11px] text-mute">{actionReason}</p>}
      {(destNamespace || destServer) && (
        <p className="text-[10.5px] text-mute">
          Destination: {destNamespace ? <span className="mono">{destNamespace}</span> : null}
          {destNamespace && destServer ? " on " : null}
          {destServer ? <span className="mono">{destServer.replace(/^https?:\/\//, "")}</span> : null}
        </p>
      )}
      {feedback && (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`text-[11.5px] wrap-break-word ${feedback.tone === "error" ? "text-bad" : "text-ok"}`}
        >
          {feedback.text}
        </p>
      )}
      {/* ponytail: a string match on the backend's dry-run wording (sync_argocd_app), noted and unchanged. */}
      {feedback?.tone === "ok" && feedback.text.startsWith("Dry-run") && (
        <p className="text-[10.5px] text-mute">See Last operation below for the dry-run result.</p>
      )}
      </div>
      {guardedDialog}
      <ConfirmModal
        contextLabel={identity.label}
        contextColor={identity.color}
        context={identity.context}
        kubectlEquivalent={argoSyncEquiv({ context, namespace, name, ...syncOpts })}
        open={confirmPrune}
        title="Prune resources on sync"
        description={
          syncOpts.dryRun
            ? `Sync "${name}" is a dry run — nothing will actually be deleted. ${
                pruneCountKnown
                  ? pruneTargets.length > 0
                    ? `Would target ${pruneTargets.length} resource(s) for pruning: ${pruneTargets.map(r => `${r.kind}/${r.name}`).join(", ")}`
                    : "No resources currently require pruning."
                  : "Prune target count is unknown (could not load current state)."
              }`
            : pruneCountKnown
            ? pruneTargets.length > 0
              ? `Sync "${name}" with prune enabled will delete ${pruneTargets.length} resource(s) no longer in git: ${pruneTargets.map(r => `${r.kind}/${r.name}`).join(", ")}`
              : `Sync "${name}" with prune enabled — no resources currently require pruning.`
            : `Sync "${name}" with prune enabled will delete resources no longer in git (count unknown — could not load current state).`
        }
        confirmLabel="Sync with prune"
        destructive={!syncOpts.dryRun}
        onConfirm={() => { setConfirmPrune(false); runSync(); }}
        onCancel={() => setConfirmPrune(false)}
        isPending={sync.isPending}
      />
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  resource: SelectedResource;
  context: string;
  onClose: () => void;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
  /** Bumped by App (palette "Compare … with…") to open the compare dialog. */
  compareNonce?: number;
  /** "See in Problems" on the explain card. */
  onOpenProblems?: () => void;
  /** False while a Health page is on screen: the panel stays mounted but must not poll list_problems (A-5). */
  problemsVisible?: boolean;
  /** Header "Map" action (O10: workload and Service kinds only): map what is connected to this object. */
  onOpenMap?: (kind: MapKind, namespace: string, name: string) => void;
  /**
   * Namespaces: the header trash asks the host to open the typed delete confirm (one dialog, also opened by the page's
   * row trash). Without it a Namespace panel has no delete button.
   */
  onRequestNamespaceDelete?: (name: string) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResourceDetailPanel({ resource, context, onClose, onNavigate, compareNonce = 0, onOpenProblems, problemsVisible = true, onOpenMap, onRequestNamespaceDelete }: Props) {
  const identity = useClusterIdentity(context);
  const { width, startResize } = useResizablePanel("detail-panel-width");
  const [tab, setTab] = useState<Tab>("Overview");
  // Keep log filters when changing tabs. Reset when resource changes.
  const [logView, setLogView] = useState(() => defaultLogView("multi"));
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [valuesEditMode, setValuesEditMode] = useState(false);
  const [valuesEditContent, setValuesEditContent] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cascadeDelete, setCascadeDelete] = useState(true);
  const [deleteError, setDeleteError] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  // "See field managers" (from the editor banner): opens the Summary tab section; cleared when the tab changes.
  const [fmNonce, setFmNonce] = useState(0);
  useEffect(() => { if (compareNonce > 0 && canCompare(resource.kind)) setShowCompare(true); }, [compareNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmUpgrade, setConfirmUpgrade] = useState(false);
  const [propagation, setPropagation] = usePropagationState(showDeleteConfirm);
  const deleteResource = useDeleteResource();
  const deleteArgoCdApp = useDeleteArgoCdApp();
  const uninstallHelm = useUninstallHelmRelease();

  const tabs = tabsFor(resource);
  // #30: owner kinds (deploy sts ds jobs rs cron) get the propagation picker in the delete confirm.
  const ownerDependents = propagationDependents(resource.kind);
  // ep/eps get no delete_resource arm on purpose (§4.2: controller-owned —
  // deleting one is a no-op that looks like it worked), so the panel header's
  // delete button must exclude them the same way GenericResourceTable's
  // per-row onDelete already does by simply never being wired for those kinds.
  // A Namespace deletes through the host's typed confirm (delete_namespace, no delete_resource arm), so its button exists only when the host passed the opener.
  const canDelete = resource.kind !== "nodes" && resource.kind !== "ep" && resource.kind !== "eps"
    && (resource.kind !== "ns" || !!onRequestNamespaceDelete);
  // Adds "nodes" vs the old chain; harmless: canDelete already excludes nodes.
  const clusterScopedObject = CLUSTER_SCOPED_KINDS.has(resource.kind);
  // Same predicate tabsFor() uses to decide whether "TLS" belongs in `tabs`.
  // Hoisted so the hook `enabled` guard and the render branch can never
  // disagree with it — otherwise there is a one-frame window (effect runs
  // after paint) where a stale `tab === "TLS"` still passes `kind === "sec"`
  // on a freshly-selected Opaque Secret and fires get_tls_certificate_info.
  const hasTlsTab = resource.kind === "sec" && resource.item.type_ === "kubernetes.io/tls";

  useEffect(() => {
    if (!tabs.includes(tab)) setTab("Overview");
    setLogView(defaultLogView("multi"));
    // deps include resourceName(resource) and resourceNamespace(resource), not
    // just resource.kind (R4): switching between two Secrets of the same kind
    // must still re-evaluate whether "TLS" is still a valid tab, or a stale
    // TLS tab renders an empty panel on the non-TLS Secret. Namespace is
    // included too so two identically-named Secrets in different namespaces
    // (one TLS, one not) don't share a false "same resource" identity. Both
    // are hoisted function declarations, so they are callable here even
    // though `name`/`ns` below are declared later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.kind, resourceName(resource), resourceNamespace(resource)]);

  const name = resourceName(resource);
  const ns = resourceNamespace(resource) ?? "";
  const chip = statusChip(resource);
  // #11 explain card + chip: covered kinds only (useExplain returns a null model otherwise).
  const explain = useExplain(context, resource.kind, ns, name, problemsVisible);
  const [explainNonce, setExplainNonce] = useState(0);
  // §3.4 can-i — fails open (RBAC_RESOURCE has no "helm" entry, so Helm
  // always reads as allowed; SSAR only answers RBAC, so the existing
  // confirm-and-fail error handling below is unchanged either way).
  const perm = usePermissions(context, ns, resource.kind);
  const noUpdateReason = perm.canUpdate ? undefined : `You don't have permission to update ${kindLabel(resource).toLowerCase()}s in ${ns || "this cluster"}.`;
  // DISABLE-PRECEDENCE (00 §5): read-only first, then the RBAC hint. Helm has no RBAC hint, by design.
  const yamlReason = pickDisabledReason({ readOnly: identity.readOnly, rbac: noUpdateReason });
  const valuesReason = pickDisabledReason({ readOnly: identity.readOnly });
  const editorReason = pickDisabledReason({
    readOnly: identity.readOnly,
    rbac: perm.canPatch ? undefined : "You don't have permission to update this resource",
  });
  // Namespaces add the built-in and already-deleting reasons, in the same precedence (utils/namespaces.ts).
  const deleteHeaderReason = resource.kind === "ns"
    ? namespaceDeleteReason(resource.item, { readOnly: identity.readOnly, canDelete: perm.canDelete })
    : pickDisabledReason({
        readOnly: identity.readOnly,
        rbac: perm.canDelete ? undefined : "You don't have permission to delete this resource",
      });

  // #33 (B-3, B-4): reveal state and fetches live in the ROOT, never in a tab body (the tab body is
  // keyed and remounts; an unobserved gcTime: 0 query would be dropped at once). Reveal is keyed to the
  // object identity, so a selection, context or namespace change ends it with no stale render.
  const qc = useQueryClient();
  const isSec = resource.kind === "sec";
  const idKey = [resource.kind, context, ns, name].join("\u0000");
  const [revealedFor, setRevealedFor] = useState("");
  const revealed = isSec && revealedFor === idKey;
  const [helmRevealedFor, setHelmRevealedFor] = useState("");
  const helmRevealed = resource.kind === "helm" && helmRevealedFor === idKey;
  const [helmEditIntent, setHelmEditIntent] = useState(false);
  // One polite line for reveal / hide, for Secrets and Helm values (the toggle keeps focus, so speech must carry it).
  const [revealNote, setRevealNote] = useState("");
  // S-1 (FX-U2a): the Values find is keyed on the reveal flag (the Secret reset), which remounts the Reveal/Hide toggle the
  // user just activated and drops focus to <body>. The click sets the flag, the effect below puts focus back.
  const valuesBodyRef = useRef<HTMLDivElement>(null);
  const helmToggleActivated = useRef(false);
  useEffect(() => () => {
    // Cleanup of the previous identity: close, selection change, context or namespace switch. Kind is in the
    // key so Secret `x` -> ConfigMap `x` still fires. Edit buffers go too (they hold Secret / Helm values).
    forgetSecret(qc, context, ns, name);
    forgetHelmValues(qc, context, ns, name);
    setEditMode(false); setEditContent(""); setValuesEditMode(false); setValuesEditContent(""); setHelmEditIntent(false); setRevealNote("");
    helmToggleActivated.current = false;
    // Reveal is keyed to an identity string; without this, going x -> y -> x would find revealedFor === idKey again
    // and re-reveal (and un-gate the YAML tab) with no click.
    setRevealedFor(""); setHelmRevealedFor("");
  }, [qc, resource.kind, context, ns, name]);
  const secretQuery = useRevealedSecret(context, ns, name, revealed);
  const secretCheck = secretGetCheck(ns);
  const secretAccess = useAccessChecks(context, secretCheck, isSec);
  const secretReveal: SecretReveal = {
    revealed,
    data: secretQuery.data?.data,
    loading: revealed && secretQuery.isLoading,
    error: revealed && secretQuery.isError ? ((secretQuery.error as any)?.message ?? String(secretQuery.error)) : "",
    deniedReason: deniedNamespaces(secretCheck, secretAccess.data).length > 0
      ? `Your account can't read the values of Secrets in namespace ${ns}.`
      : undefined,
    onReveal: () => { if (revealed) void secretQuery.refetch(); else setRevealedFor(idKey); },
    onHide: () => { setRevealedFor(""); forgetSecret(qc, context, ns, name); setEditContent(""); setRevealNote("Values hidden."); },
    onRetry: () => { void secretQuery.refetch(); },
  };
  // The YAML tab for a Secret shows base64 values: placeholder until Reveal, and no hidden fetch behind it.
  const yamlGated = isSec && !revealed;
  const { data: yamlContent = "", isLoading: yamlLoading } = useResourceYaml(
    resource.kind, context, ns, name, tab === "YAML" && !yamlGated,
  );
  // #6 neat YAML: DISPLAY ONLY. The editor seed (setEditContent(yamlContent)) and Save always use
  // the full get_resource_yaml text; the neat query's data never reaches the editor or apply.
  const [neat, setNeat] = useState(loadNeatPref);
  const toggleNeat = () => setNeat((v) => { saveNeatPref(!v); return !v; });
  const neatQuery = useResourceYamlNeat(resource.kind, context, ns, name, tab === "YAML" && neat && !editMode && !yamlGated);
  const neatShown = neat && !editMode && !!neatQuery.data;
  const shownYaml = neatShown && neatQuery.data ? neatQuery.data.yaml : yamlContent;
  const yamlSkeleton = yamlLoading || (neat && !editMode && neatQuery.isLoading);
  // Helm Values: the redacted read (backend) feeds the view only; the revealed read has its own key and
  // is the ONLY editor seed (helmEditSeed). Removed on Hide, close, selection change and upgrade success.
  const { data: helmValues = "", isLoading: helmValuesLoading, error: helmValuesErr, refetch: refetchHelmValues } = useHelmValues(
    context, ns, name, resource.kind === "helm" && tab === "Values",
  );
  const helmValuesError = helmValuesErr ? ((helmValuesErr as any)?.message ?? String(helmValuesErr)) : "";
  const helmRevealQuery = useHelmValues(context, ns, name, helmRevealed, true);
  const helmRevealedNow = helmRevealed && helmRevealQuery.data !== undefined;
  const helmRevealing = helmRevealed && helmRevealQuery.isLoading;
  const prevHelmRevealedNow = useRef(helmRevealedNow);
  useEffect(() => {
    if (prevHelmRevealedNow.current === helmRevealedNow) return;
    prevHelmRevealedNow.current = helmRevealedNow;
    const activated = helmToggleActivated.current;
    helmToggleActivated.current = false;
    // Only when focus really fell to the document: never steal it from a control the user moved to.
    const ae = document.activeElement;
    if (!activated || (ae && ae !== document.body)) return;
    valuesBodyRef.current?.querySelector<HTMLElement>("[data-helm-reveal-toggle]")?.focus();
  }, [helmRevealedNow]);
  // The Values tab shows the text view (read or edit) in this case; the error and the "No custom values" cards otherwise.
  const valuesFindable = valuesEditMode || (!(helmValuesError && !helmRevealedNow) && (helmRevealedNow || !!helmValues.trim()));
  const helmRevealError = helmRevealed && helmRevealQuery.isError ? ((helmRevealQuery.error as any)?.message ?? String(helmRevealQuery.error)) : "";
  useEffect(() => {
    if (helmEditIntent && helmRevealed && helmRevealQuery.data !== undefined) {
      setValuesEditContent(helmEditSeed(qc, context, ns, name));
      setValuesEditMode(true);
      setHelmEditIntent(false);
    }
  }, [helmEditIntent, helmRevealed, helmRevealQuery.data, qc, context, ns, name]);
  const secretShown = revealed && !!secretQuery.data;
  useEffect(() => { if (secretShown || helmRevealedNow) setRevealNote("Values revealed."); }, [secretShown, helmRevealedNow]);
  const hideHelmValues = () => { setHelmRevealedFor(""); setHelmEditIntent(false); forgetHelmValues(qc, context, ns, name); setValuesEditContent(""); setRevealNote("Values hidden."); };
  // 03 §9.4: a placeholder left in the edit blocks the review (the backend refuses it too).
  const upgradeReason = pickDisabledReason({
    readOnly: identity.readOnly,
    capability: hasRedactionSentinel(valuesEditContent)
      ? "A redacted value is still in the edit. Reveal it or remove it first."
      : undefined,
  });
  const { data: helmHistory = [], isLoading: helmHistoryLoading } = useHelmHistory(
    context, ns, name, resource.kind === "helm" && tab === "History",
  );
  const eventsKind = EVENT_INVOLVED_KIND[resource.kind];
  // The tab strip scrolls inside itself; keep the selected tab in view.
  const selectedTabRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selectedTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [tab]);
  const {
    data: events = [], isLoading: eventsLoading, error: eventsError, refetch: refetchEvents,
  } = useResourceEvents(context, ns, name, tab === "Events", eventsKind);
  const { data: tlsCerts = [], isLoading: tlsLoading, error: tlsError } = useTlsCertificateInfo(
    context, ns, name, hasTlsTab && tab === "TLS",
  );
  const applyResource = useApplyResource();
  const upgradeHelmRelease = useUpgradeHelmRelease();
  const { data: argoResources = [], isLoading: argoResourcesLoading } = useArgoCdAppResources(
    context,
    resource.kind === "argocd" ? resource.item.namespace : "",
    resource.kind === "argocd" ? resource.item.name : "",
    resource.kind === "argocd" && tab === "Resources",
  );

  const isWorkload = (WORKLOAD_KINDS as string[]).includes(resource.kind);
  const workloadKindStr = isWorkload ? resource.kind : "";
  const workloadNs = isWorkload && "ns" in resource ? resource.ns : "";
  const { data: workloadPods = [], isLoading: workloadPodsLoading } = useWorkloadPods(
    context,
    workloadNs,
    workloadKindStr,
    name,
    isWorkload,
  );

  // graph.rs has no "rs" arm (falls through to Err) — enabling this for "rs"
  // would poll a guaranteed failure every 30s for as long as the panel is
  // open. Mirrors tabsFor()'s exclusion of the Relationships tab for "rs".
  const hasRelationships = isWorkload && resource.kind !== "rs";
  const { data: graphNodes = [], isLoading: graphLoading } = useResourceGraph(
    context,
    workloadNs,
    workloadKindStr,
    name,
    hasRelationships,
  );

  useEffect(() => { if (tab !== "Summary") setFmNonce(0); }, [tab]);
  useEffect(() => {
    if (tab !== "YAML") { setEditMode(false); setConfirmSave(false); }
    if (tab !== "Values") { setValuesEditMode(false); setConfirmUpgrade(false); }
  }, [tab]);

  return (
    <aside className="slide-in shrink-0 bg-panel/95 border-l border-edge flex flex-col relative" style={{ width: `${width}px` }}>
      <div role="status" aria-live="polite" className="sr-only">{revealNote}</div>
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
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-mute">
              <Boxes size={11} />
              <span>{kindLabel(resource)}</span>
              <span className="text-edge2">·</span>
              {ns ? (
                <span className="mono normal-case tracking-normal text-mute">{ns}</span>
              ) : (
                <span className="mono normal-case tracking-normal text-mute">cluster-wide</span>
              )}
            </div>
            <h3 className="mono text-[14px] mt-1 break-all leading-tight">{name}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {resource.kind === "argocd" ? (
                <>
                  <ArgoStatusChip which="Health" pill={argoHealthPill(resource.item.health_status)} />
                  <ArgoStatusChip which="Sync" pill={argoSyncPill(resource.item.sync_status)} />
                </>
              ) : (
                <span className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[11px] ring-1 font-medium ${CHIP_STYLE[chip.tone].cls}`}
                >
                  <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                    {CHIP_STYLE[chip.tone].pulse && (
                      <span className={`absolute inset-0 rounded-full opacity-60 animate-blink ${CHIP_STYLE[chip.tone].dot}`} />
                    )}
                    <span className={`relative inline-block h-2 w-2 rounded-full ${CHIP_STYLE[chip.tone].dot}`} />
                  </span>
                  {chip.label}
                </span>
              )}
              {identity.readOnly && <ReadOnlyChip />}
              <ProblemChip model={explain.model} onClick={() => { setTab("Summary"); setExplainNonce((n) => n + 1); }} />
            </div>
          </div>
          {onOpenMap && MAP_PANEL_KINDS.has(resource.kind) && (
            // A read: never disabled by read-only mode or RBAC.
            <button
              type="button"
              onClick={() => onOpenMap(resource.kind as MapKind, ns, name)}
              title="Show what is connected to this object on the map"
              aria-label="Show on map"
              className="h-7 w-7 -mr-1 rounded-md hover:bg-accent/10 text-mute hover:text-accent flex items-center justify-center transition-colors"
            >
              <Network size={14} />
            </button>
          )}
          {canCompare(resource.kind) && (
            // A read: never disabled by read-only mode or RBAC.
            <button
              type="button"
              onClick={() => setShowCompare(true)}
              title="Compare with another namespace or cluster"
              aria-label="Compare with another namespace or cluster"
              className="h-7 w-7 -mr-1 rounded-md hover:bg-accent/10 text-mute hover:text-accent flex items-center justify-center transition-colors"
            >
              <GitCompare size={14} />
            </button>
          )}
          {EDIT_FORM[resource.kind] && (
            <button
              type="button"
              onClick={() => { if (editorReason) return; setShowEditor(true); }}
              aria-label={`Edit ${kindLabel(resource)}`}
              title={`Edit ${kindLabel(resource)}`}
              {...disabledAttrs(editorReason)}
              className={`h-7 w-7 -mr-1 rounded-md hover:bg-accent/10 text-mute hover:text-accent flex items-center justify-center transition-colors ${editorReason ? "opacity-30 cursor-not-allowed" : ""}`}
            >
              <Pencil size={14} aria-hidden />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={(e) => {
                if (deleteHeaderReason) return;
                if (resource.kind === "ns") {
                  // Focus the opener first: the confirm returns focus to what was focused when it opened (WebKit does not focus on click).
                  e.currentTarget.focus();
                  onRequestNamespaceDelete?.(name);
                  return;
                }
                setShowDeleteConfirm(true); setDeleteError(""); setCascadeDelete(true);
              }}
              aria-label={resource.kind === "helm" ? `Uninstall ${kindLabel(resource)}` : `Delete ${kindLabel(resource)}`}
              title={resource.kind === "helm" ? `Uninstall ${kindLabel(resource)}` : `Delete ${kindLabel(resource)}`}
              {...disabledAttrs(deleteHeaderReason)}
              className={`h-7 w-7 -mr-1 rounded-md hover:bg-bad/10 text-mute hover:text-bad flex items-center justify-center transition-colors ${deleteHeaderReason ? "opacity-30 cursor-not-allowed" : ""}`}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${kindLabel(resource)} panel`}
            title="Close (Esc)"
            className="h-7 w-7 -mr-1 rounded-md hover:bg-surface-tint/6 text-mute hover:text-ink flex items-center justify-center"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-0.5 px-4 border-b border-edge shrink-0 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t}
            ref={tab === t ? selectedTabRef : undefined}
            onClick={() => setTab(t)}
            className={`relative h-9 px-2.5 text-[12px] shrink-0 whitespace-nowrap ${tab === t ? "text-ink" : "text-mute hover:text-ink"}`}
          >
            {t === "Resources" && resource.kind === "argocd" && argoResources.length > 0
              ? <>
                  {t}
                  <span className="ml-1 px-1.5 py-px rounded-full bg-surface-tint/8 text-[10px] text-mute">{argoResources.length}</span>
                  {argoResources.filter(isDegradedOrMissing).length > 0 && (
                    <span className="ml-1 px-1 py-px rounded-full bg-bad/80 text-on-accent text-[9px]">
                      {argoResources.filter(isDegradedOrMissing).length}
                    </span>
                  )}
                </>
              : t === "Pods" && workloadPods.length > 0
              ? <>{t} <span className="ml-1 px-1.5 py-px rounded-full bg-surface-tint/8 text-[10px] text-mute">{workloadPods.length}</span></>
              : t
            }
            {tab === t && (
              <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-t bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* tab content */}
      <div className="flex-1 overflow-y-auto fade-in" key={tab}>
        {tab === "Overview" && (
          <div className="overflow-y-auto flex-1">
            {/* ARGO-2: the primary job (sync) comes first, not below the field list. */}
            {resource.kind === "argocd" && (
              <ArgoCdActionBar
                context={context}
                namespace={resource.ns}
                name={resource.item.name}
                destNamespace={resource.item.dest_namespace}
                destServer={resource.item.dest_server}
              />
            )}
            <div className="p-4">
              <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3 pt-2">
                <OverviewContent resource={resource} context={context} onNavigate={onNavigate} onShowTab={setTab} secretReveal={secretReveal} />
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
              ownsPods={tabs.includes("Pods")}
              links={[
                ...(["Logs", "Pods", "Events"] as Tab[]).filter((t) => tabs.includes(t)).map((t) => ({ label: `Open ${t}`, onClick: () => setTab(t) })),
                ...(onOpenProblems ? [{ label: "See in Problems", onClick: onOpenProblems }] : []),
              ]}
            />
          </div>
        )}
        {tab === "Summary" && (
          <ResourceSummaryTab
            resource={resource}
            context={context}
            ns={ns}
            name={name}
            onNavigate={onNavigate}
          />
        )}
        {tab === "Summary" && isConstraintKind(resource.kind) && (
          <div className="px-4 pb-4">
            <ConstraintsSection
              context={context}
              kind={resource.kind}
              namespace={ns}
              name={name}
              onOpen={(k, n, nm) => onNavigate?.(k, n, nm)}
            />
          </div>
        )}
        {tab === "Summary" && PERMISSION_KINDS.has(resource.kind) && (
          <PermissionsSection resource={resource} context={context} ns={ns} name={name} onOpen={(k, n, nm) => onNavigate?.(k, n, nm)} />
        )}
        {tab === "Summary" && canCompare(resource.kind) && (
          <FieldManagers context={context} namespace={ns} kind={resource.kind} kindLabel={kindLabel(resource)} name={name} openNonce={fmNonce} />
        )}

        {tab === "Events" && (
          <EventsTabContent
            events={events}
            isLoading={eventsLoading}
            error={eventsError}
            onRetry={() => { void refetchEvents(); }}
            kind={eventsKind ?? kindLabel(resource)}
            scopedToKind={eventsKind !== null}
          />
        )}

        {tab === "Timeline" && tabs.includes("Timeline") && (
          <TimelineTab
            context={context}
            namespace={ns}
            name={name}
            kind={resource.kind}
            kindLabel={kindLabel(resource)}
            eventsKind={eventsKind}
            argocdHistory={resource.kind === "argocd" ? resource.item.history : undefined}
            active
            onShowTab={setTab}
          />
        )}

        {tab === "TLS" && hasTlsTab && (
          <TlsTab certs={tlsCerts} isLoading={tlsLoading} error={tlsError} />
        )}

        {tab === "Resources" && resource.kind === "argocd" && (
          <ArgoCdResourcesTab
            resources={argoResources}
            isLoading={argoResourcesLoading}
            onNavigate={onNavigate}
            context={context}
            appNamespace={resource.item.namespace}
            appName={resource.item.name}
          />
        )}

        {tab === "History" && resource.kind === "argocd" && (
          <ArgoCdHistoryTab
            history={resource.item.history ?? []}
            context={context}
            namespace={resource.item.namespace}
            appName={resource.item.name}
            autoSync={resource.item.auto_sync === true}
          />
        )}

        {tab === "History" && resource.kind === "helm" && (
          <HelmHistoryTab
            context={context}
            namespace={ns}
            release={name}
            history={helmHistory}
            isLoading={helmHistoryLoading}
          />
        )}

        {tab === "Pods" && isWorkload && (
          <WorkloadPodsTab
            pods={workloadPods}
            isLoading={workloadPodsLoading}
            onNavigate={onNavigate}
          />
        )}

        {tab === "Logs" && isWorkload && (
          <MultiLogViewer context={context} namespace={workloadNs} pods={workloadPods} view={logView} onViewChange={setLogView} />
        )}

        {tab === "Relationships" && hasRelationships && (
          <RelationshipsTab nodes={graphNodes} isLoading={graphLoading} />
        )}

        {tab === "Values" && resource.kind === "helm" && (
          <div ref={valuesBodyRef} className="p-3 flex flex-col gap-2">
            {helmValuesLoading ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse"
                    style={{ width: `${30 + (i % 4) * 15}%` }}
                  />
                ))}
              </div>
            ) : valuesFindable ? (
              // One <YamlFind> for the read and the edit view. Keyed on the object identity plus the reveal flag (S2):
              // Hide, a selection change and a panel close unmount it, and with it the query.
              <YamlFind
                key={`${idKey}\u0000${helmRevealedNow}`}
                text={valuesEditMode ? valuesEditContent : (helmRevealedNow ? (helmRevealQuery.data ?? "") : helmValues)}
                noun="values"
                regionLabel={`${name} values`}
                edit={valuesEditMode ? {
                  onChange: setValuesEditContent,
                  onKeyDown: (e) => {
                    // ⌘S / Ctrl+S opens the review gate; it never upgrades by itself.
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      if (!upgradeReason && !upgradeHelmRelease.isPending) setConfirmUpgrade(true);
                    }
                  },
                } : null}
                noMatchHint={!valuesEditMode && !helmRevealedNow ? { text: REDACTED_NO_MATCH_HINT } : null}
              >
                {({ findButton, bar, content }) => valuesEditMode ? (
                  <>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-warn mono">Editing — will run helm upgrade</span>
                      <div className="flex-1" />
                      {findButton}
                      <button
                        onClick={() => { setValuesEditMode(false); }}
                        className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono"
                      >
                        cancel
                      </button>
                      {/* No RBAC hint on purpose: an upgrade is a bundle of writes across many kinds, so no single can-i answers it. */}
                      <button
                        disabled={upgradeHelmRelease.isPending}
                        onClick={() => { if (upgradeReason) return; setConfirmUpgrade(true); }}
                        {...disabledAttrs(upgradeReason)}
                        className={`h-6 px-2 rounded-sm bg-accent/20 ring-1 ring-accent/40 text-[10.5px] text-accent hover:bg-accent/30 mono flex items-center gap-1.5 disabled:opacity-50 ${upgradeReason ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <SaveIcon /> Review upgrade…
                      </button>
                    </div>
                    {upgradeReason && !identity.readOnly && <p className="text-[11px] text-warn">{upgradeReason}</p>}
                    {confirmUpgrade && resource.kind === "helm" && (
                      <HelmUpgradeGate
                        context={context}
                        namespace={ns}
                        release={name}
                        chartName={resource.item.chart_name}
                        chart={resource.item.chart}
                        valuesYaml={valuesEditContent}
                        onClose={() => setConfirmUpgrade(false)}
                        onUpgraded={() => { setConfirmUpgrade(false); setValuesEditMode(false); setValuesEditContent(""); setHelmRevealedFor(""); }}
                      />
                    )}
                    {bar}
                    {content}
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    {!helmRevealedNow && (
                      <p className="text-[11px] text-mute">
                        Values under credential-looking keys are redacted. Other values may still be sensitive. Comments aren't shown in this view.
                      </p>
                    )}
                    {/* One toolbar for both states. The Values find remounts on reveal (S2 key), so the effect on helmRevealedNow puts focus back on this toggle (04 6.2, UX 23 S-1). */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        data-helm-reveal-toggle=""
                        aria-disabled={helmRevealing || undefined}
                        onClick={() => {
                          if (helmRevealing) return;
                          helmToggleActivated.current = true;
                          if (helmRevealedNow) { hideHelmValues(); return; }
                          setHelmEditIntent(false); setHelmRevealedFor(idKey);
                        }}
                        className={smallBtn}
                      >
                        {helmRevealedNow ? <EyeOff size={11} /> : <Eye size={11} />}{" "}
                        {helmRevealedNow ? "Hide values" : helmRevealing && !helmEditIntent ? "Revealing…" : "Reveal values"}
                      </button>
                      {helmRevealedNow && <span className="mono text-[10px] px-1.5 rounded-sm bg-info/15 text-info ring-1 ring-info/30">Revealed</span>}
                      <div className="flex-1" />
                      {findButton}
                      <button
                        aria-disabled={helmRevealing || undefined}
                        onClick={() => {
                          if (valuesReason || helmRevealing) return;
                          if (helmRevealedNow) { setValuesEditContent(helmEditSeed(qc, context, ns, name)); setValuesEditMode(true); return; }
                          setHelmEditIntent(true); setHelmRevealedFor(idKey);
                        }}
                        {...disabledAttrs(valuesReason)}
                        className={`${smallBtn} ${valuesReason ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <SaveIcon /> {helmRevealedNow ? "Edit" : helmRevealing && helmEditIntent ? "Revealing…" : "Reveal and edit…"}
                      </button>
                      {helmRevealedNow
                        ? (helmRevealQuery.data ?? "").trim() && (
                            <button onClick={() => navigator.clipboard.writeText(helmRevealQuery.data ?? "")} className={smallBtn}>Copy</button>
                          )
                        : <button onClick={() => navigator.clipboard.writeText(helmValues)} className={smallBtn}>Copy redacted text</button>}
                    </div>
                    {helmRevealError && (
                      <div role="alert" className="rounded-sm bg-bad/10 ring-1 ring-bad/30 px-2 py-1.5 text-[11px] text-bad flex items-start gap-2">
                        <span className="flex-1 min-w-0 wrap-break-word">Couldn't load the values: {helmRevealError}.</span>
                        <button onClick={() => { void helmRevealQuery.refetch(); }} className={smallBtn}>Retry</button>
                      </div>
                    )}
                    {helmRevealedNow && !(helmRevealQuery.data ?? "").trim() ? (
                      <p className="pt-6 text-center text-[13px] text-mute">No custom values — using chart defaults</p>
                    ) : (
                      <>
                        {bar}
                        {content}
                      </>
                    )}
                  </div>
                )}
              </YamlFind>
            ) : helmValuesError && !helmRevealedNow ? (
              <div role="alert" className="rounded-sm bg-bad/10 ring-1 ring-bad/30 px-2 py-1.5 text-[11px] text-bad flex items-start gap-2">
                <span className="flex-1 min-w-0 wrap-break-word">Couldn't load the values: {helmValuesError}.</span>
                <button onClick={() => { void refetchHelmValues(); }} className={smallBtn}>Retry</button>
              </div>
            ) : (
              <div className="pt-10 pb-6 flex flex-col items-center gap-4">
                <p className="text-[13px] text-mute">No custom values — using chart defaults</p>
                <button
                  onClick={() => { if (valuesReason) return; setValuesEditContent(""); setValuesEditMode(true); }}
                  {...disabledAttrs(valuesReason)}
                  className={`${smallBtn} ${valuesReason ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <SaveIcon /> Add values…
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "YAML" && (
          <div className="p-3 flex flex-col gap-2">
            {yamlGated ? (
              <div className="rounded-lg ring-1 ring-edge bg-card/50 p-4 flex flex-col items-start gap-2">
                <p className="text-[12.5px] text-ink">Secret values are hidden.</p>
                <p className="text-[11px] text-mute">The YAML tab shows base64 values. Reveal them to read the YAML or edit it.</p>
                <button
                  aria-disabled={secretReveal.loading || undefined}
                  onClick={() => { if (secretReveal.loading || secretReveal.deniedReason) return; secretReveal.onReveal(); }}
                  {...disabledAttrs(secretReveal.deniedReason)}
                  className={`${smallBtn} ${secretReveal.deniedReason ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Eye size={11} /> Reveal values
                </button>
              </div>
            ) : yamlSkeleton ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse"
                    style={{ width: `${40 + (i % 3) * 20}%` }}
                  />
                ))}
              </div>
            ) : (
              // One <YamlFind> for the read and the edit view, so the find bar survives the switch. Keyed on the
              // object identity (S2); the skeleton and the Secret placeholder above stay outside it.
              <YamlFind
                key={idKey}
                text={editMode ? editContent : shownYaml}
                noun="YAML"
                regionLabel={`${kindLabel(resource)} ${name} YAML`}
                edit={editMode ? {
                  onChange: setEditContent,
                  onKeyDown: (e) => {
                    // ⌘S / Ctrl+S opens the review gate; it never saves by itself.
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      if (!yamlReason && !applyResource.isPending) setConfirmSave(true);
                    }
                  },
                } : null}
                noMatchHint={neatShown && (neatQuery.data?.hidden.length ?? 0) > 0
                  ? { text: NEAT_NO_MATCH_HINT, action: { label: "Search full object", run: toggleNeat } }
                  : null}
              >
                {({ findButton, bar, content }) => editMode ? (
                  <>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-warn mono">Editing — changes apply directly to the cluster</span>
                      <div className="flex-1" />
                      {findButton}
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
                        namespace={ns}
                        resourceType={resource.kind}
                        name={name}
                        kindLabel={kindLabel(resource)}
                        yaml={editContent}
                        hasForm={!!EDIT_FORM[resource.kind]}
                        onOpenForm={() => { setConfirmSave(false); setEditMode(false); setShowEditor(true); }}
                        onClose={() => setConfirmSave(false)}
                        onSaved={() => { setConfirmSave(false); setEditMode(false); }}
                      />
                    )}
                    <NeatNote hidden={[]} editing />
                    {bar}
                    {content}
                  </>
                ) : (
                  <div className="flex flex-col gap-2 min-w-0">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {findButton}
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
                    {bar}
                    {content}
                  </div>
                )}
              </YamlFind>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation — ArgoCD. The cascade/orphan choice is a finalizer choice, NOT propagationPolicy (it must not be merged with the #30 picker). */}
      {resource.kind === "argocd" && (
        <ConfirmModal
          contextLabel={identity.label}
          contextColor={identity.color}
          context={identity.context}
          kubectlEquivalent={argoDeleteEquiv({ context, namespace: resource.ns, name, cascade: cascadeDelete })}
          open={showDeleteConfirm}
          title="Delete ArgoCD Application"
          description={`Deleting "${name}" may cascade-delete all managed resources (Deployments, Services, ConfigMaps, and more).`}
          confirmLabel={cascadeDelete ? "Delete app + resources" : "Delete app only"}
          destructive
          size="md"
          requireTyping={name}
          requireTypingLabel="Type the application name to confirm"
          status={deleteError ? { tone: "error", text: deleteError } : null}
          onConfirm={async () => {
            setDeleteError("");
            try {
              await deleteArgoCdApp.mutateAsync({ context, namespace: resource.ns, name, cascade: cascadeDelete });
              setShowDeleteConfirm(false);
              onClose();
            } catch (e) {
              // The dialog stays open with the verbatim message.
              setDeleteError((e as any)?.message ?? String(e));
            }
          }}
          onCancel={() => { setShowDeleteConfirm(false); setDeleteError(""); }}
          isPending={deleteArgoCdApp.isPending}
        >
          <div role="radiogroup" aria-label="What happens to the managed resources" className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="argocd-delete-mode" checked={cascadeDelete} onChange={() => setCascadeDelete(true)} className="mt-0.5 accent-accent" />
              <div>
                <span className="text-[12.5px] text-ink">Cascade delete</span>
                <p className="text-[11px] text-mute">Delete app and all managed resources</p>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="argocd-delete-mode" checked={!cascadeDelete} onChange={() => setCascadeDelete(false)} className="mt-0.5 accent-accent" />
              <div>
                <span className="text-[12.5px] text-ink">Orphan resources</span>
                <p className="text-[11px] text-mute">Delete app only, keep managed resources</p>
              </div>
            </label>
          </div>
        </ConfirmModal>
      )}

      {/* Delete confirmation — Helm release */}
      {showDeleteConfirm && resource.kind === "helm" && (
        <ConfirmModal
          contextLabel={identity.label}
          contextColor={identity.color}
          context={identity.context}
          kubectlEquivalent={helmUninstallEquiv({ context, namespace: ns, release: name })}
          open={showDeleteConfirm}
          title="Uninstall Helm Release"
          description={`Uninstall Helm release "${name}" from namespace "${ns}"? This runs "helm uninstall" and cannot be undone.`}
          confirmLabel="Uninstall"
          destructive
          onConfirm={async () => {
            setDeleteError("");
            try {
              await uninstallHelm.mutateAsync({ context, namespace: ns, release: name });
              setShowDeleteConfirm(false);
              onClose();
            } catch (e) {
              setDeleteError((e as any)?.message ?? String(e));
              setShowDeleteConfirm(false);
            }
          }}
          onCancel={() => setShowDeleteConfirm(false)}
          isPending={uninstallHelm.isPending}
        />
      )}

      {/* Delete confirmation — all other resource kinds */}
      {showDeleteConfirm && resource.kind !== "argocd" && resource.kind !== "helm" && resource.kind !== "nodes" && resource.kind !== "ns" && (
        <ConfirmModal
          contextLabel={identity.label}
          contextColor={identity.color}
          context={identity.context}
          kubectlEquivalent={deleteEquiv({ context, namespace: ns, kind: resource.kind, name, propagation: ownerDependents ? propagation : undefined })}
          open={showDeleteConfirm}
          title={`Delete ${kindLabel(resource)}`}
          description={
            clusterScopedObject
              ? `This will permanently remove ${kindLabel(resource).toLowerCase()} "${name}" from the cluster.${resource.kind === "crd" ? ` Deleting this CRD will also delete all custom resources of kind ${(resource.item as import("../types/k8s").CRD).kind} across the cluster.` : ""}`
              : `Delete ${kindLabel(resource).toLowerCase()} "${name}" from namespace "${ns}"? This action cannot be undone.`
          }
          confirmLabel={clusterScopedObject ? "Delete permanently" : ownerDependents ? deleteLabelFor(propagation) : "Delete"}
          destructive
          size={ownerDependents ? "md" : "sm"}
          requireTyping={clusterScopedObject ? name : undefined}
          requireTypingLabel={clusterScopedObject ? "Type the name to confirm" : undefined}
          onConfirm={async () => {
            setDeleteError("");
            try {
              await deleteResource.mutateAsync({
                context, namespace: ns, resourceType: resource.kind as import("../types/k8s").ResourceType, name,
                // Only owner kinds show the picker; every other kind omits it and the backend sends Background.
                propagation: ownerDependents ? propagation : undefined,
              });
              setShowDeleteConfirm(false);
              onClose();
            } catch (e) {
              setDeleteError((e as any)?.message ?? String(e));
              setShowDeleteConfirm(false);
            }
          }}
          onCancel={() => setShowDeleteConfirm(false)}
          isPending={deleteResource.isPending}
        >
          {ownerDependents && (
            <PropagationPicker
              name={name}
              dependents={ownerDependents}
              value={propagation}
              onChange={setPropagation}
              disabled={deleteResource.isPending}
            />
          )}
        </ConfirmModal>
      )}

      {deleteError && !showDeleteConfirm && (
        <div className="fixed bottom-4 right-4 z-50 mono text-[10.5px] text-bad px-3 py-2 rounded-lg bg-surface-overlay ring-1 ring-bad/30 shadow-lg flex items-center gap-2">
          {deleteError}
          <button onClick={() => setDeleteError("")} className="text-mute hover:text-ink">✕</button>
        </div>
      )}

      {showCompare && (
        <ResourceCompareDialog
          context={context}
          kind={resource.kind}
          kindLabel={kindLabel(resource)}
          namespace={ns}
          name={name}
          clusterScoped={resourceNamespace(resource) === null}
          onClose={() => setShowCompare(false)}
        />
      )}
      <ResourceEditor
        open={showEditor}
        onClose={() => setShowEditor(false)}
        context={context}
        namespace={ns}
        resourceType={resource.kind}
        name={name}
        kindLabel={kindLabel(resource)}
        onSeeFieldManagers={canCompare(resource.kind) && tabs.includes("Summary") ? () => { setShowEditor(false); setFmNonce((n) => n + 1); setTab("Summary"); } : undefined}
      />
    </aside>
  );
}
