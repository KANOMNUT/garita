import { useCallback, useState, type ReactNode } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { useClusterIdentity } from "../utils/clusterIdentity";
import type { KubectlEquiv } from "../utils/kubectlEquiv";

// D3-5 (docs/ux/03 §11.6): a write with no confirm of its own — ArgoCD Sync / Refresh /
// Hard Refresh, Cordon / Uncordon, Taint add / remove — keeps its one-click behaviour. It
// gains an `sm` confirm ONLY while the cluster's "Confirm writes by typing the cluster
// label" guardrail is on, and that confirm carries the typed gate (via ConfirmModal's
// `context`), the identity badge and the kubectl equivalent.

export interface GuardedSpec {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  equivalent?: KubectlEquiv;
  destructive?: boolean;
  /** The write. Errors thrown here are shown in the dialog; handle them yourself to keep your own surface. */
  run: () => Promise<void> | void;
}

export function useGuardedAction(context: string): { guarded: (spec: GuardedSpec) => void; dialog: ReactNode } {
  const identity = useClusterIdentity(context);
  const [pending, setPending] = useState<GuardedSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const typedConfirm = identity.typedConfirm;
  const guarded = useCallback(
    (spec: GuardedSpec) => {
      if (!typedConfirm) {
        void spec.run();
        return;
      }
      setError("");
      setPending(spec);
    },
    [typedConfirm],
  );

  const dialog = (
    <ConfirmModal
      open={pending !== null}
      context={identity.context}
      contextLabel={identity.label}
      contextColor={identity.color}
      size="sm"
      destructive={pending?.destructive ?? false}
      title={pending?.title ?? ""}
      description={pending?.description ?? ""}
      confirmLabel={pending?.confirmLabel ?? "Confirm"}
      kubectlEquivalent={pending?.equivalent}
      status={error ? { tone: "error", text: error } : null}
      isPending={busy}
      onCancel={() => setPending(null)}
      onConfirm={async () => {
        if (!pending) return;
        setBusy(true);
        setError("");
        try {
          await pending.run();
          setPending(null);
        } catch (e) {
          setError((e as any)?.message ?? String(e));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { guarded, dialog };
}
