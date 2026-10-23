import { useEffect, useState } from "react";
import { KubectlEquivalent } from "./KubectlEquivalent";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { guardrailTypingNotice, READ_ONLY_REASON, readOnlyTurnedOnWhileOpen } from "../utils/guardrails";
import type { KubectlEquiv } from "../utils/kubectlEquiv";

// Guardrails for the write dialogs that are NOT built on ConfirmModal (ResourceEditor,
// ResourceCreator, HelmInstallModal, MergeFromFileModal — each is its own modal host with
// its own buttons). ConfirmModal applies the same rules itself via its `context` prop; this
// is the identical behaviour for the hosts that cannot:
//   - read-only: the write controls are disabled with the reason, and a mode switched on
//     while the dialog is open says so (03 §11.4);
//   - G1: the cluster label must be typed before the real write (the dry run is not a write);
//   - one typed field at most (D3-6) — hosts with their own typed gate do not use this.

export interface WriteGate {
  readOnly: boolean;
  /** Full-sentence reason the write controls are disabled, if any. */
  reason: string | undefined;
  typedRequired: boolean;
  label: string;
  typed: string;
  setTyped: (v: string) => void;
  /** False while a required typed label is missing or wrong. */
  typedOk: boolean;
  /** The real write may proceed. A dry run only needs `!readOnly`. */
  canWrite: boolean;
  context: string;
  color: ReturnType<typeof useClusterIdentity>["color"];
}

export function useWriteGate(context: string, open: boolean): WriteGate {
  const identity = useClusterIdentity(context);
  const [typed, setTyped] = useState("");
  // C6: the typed value never survives a close, a reopen, or a change of cluster.
  useEffect(() => {
    setTyped("");
  }, [open, context]);
  const label = identity.label || context;
  const typedRequired = identity.typedConfirm;
  const typedOk = !typedRequired || typed === label;
  return {
    readOnly: identity.readOnly,
    reason: identity.readOnly ? READ_ONLY_REASON : typedRequired && !typedOk ? `Type ${label} to confirm.` : undefined,
    typedRequired,
    label,
    typed,
    setTyped,
    typedOk,
    canWrite: !identity.readOnly && typedOk,
    context,
    color: identity.color,
  };
}

/** Slot 6 (equivalent), read-only status and slot 7 + the typed field, for a custom modal host. */
export function GuardrailBlock({ gate, equivalent }: { gate: WriteGate; equivalent?: KubectlEquiv | null }) {
  return (
    <div className="flex flex-col gap-2">
      {gate.readOnly && (
        <p role="alert" className="text-[12px] text-bad bg-bad/10 ring-1 ring-bad/25 rounded-lg px-3 py-2">
          {readOnlyTurnedOnWhileOpen(gate.label)}
        </p>
      )}
      {equivalent && <KubectlEquivalent equiv={equivalent} context={gate.context} />}
      {gate.typedRequired && !gate.readOnly && (
        <div className="rounded-lg bg-surface-tint/3 ring-1 ring-edge px-3 py-2 flex flex-col gap-1.5">
          <p className="text-[11.5px] text-mute">{guardrailTypingNotice(gate.label)}</p>
          <label className="text-[12px] text-mute" htmlFor="guardrail-typed">Type {gate.label} to confirm</label>
          <input
            id="guardrail-typed"
            type="text"
            value={gate.typed}
            onChange={(e) => gate.setTyped(e.target.value)}
            placeholder={gate.label}
            spellCheck={false}
            className="w-full rounded-lg bg-surface-input/80 ring-1 ring-edge px-3 py-1.5 text-[12.5px] text-ink placeholder:text-dim outline-hidden focus:ring-accent/50 focus:ring-2"
          />
        </div>
      )}
    </div>
  );
}
