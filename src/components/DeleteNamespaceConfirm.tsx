import { useEffect, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { useDeleteNamespace } from "../hooks/useResources";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { deleteNamespaceEquiv } from "../utils/kubectlEquiv";

interface Props {
  context: string;
  /** The namespace to delete; null while the dialog is closed. */
  name: string | null;
  onClose: () => void;
  /** After a successful delete, before `onClose`. The host resets a picker that pointed at `name`. */
  onDeleted: (name: string) => void;
}

/**
 * The typed-name confirm for deleting a namespace. One instance, hosted in App, serves the Namespaces page row
 * trash and the detail panel's header trash. Outside the TopBar `<header>`: a ConfirmModal has no portal and the
 * header starts a window drag on mousedown.
 *
 * The dialog stays open on a failed delete and shows the backend message verbatim. Success usually leaves the
 * namespace Terminating, not gone; the Namespaces page polls until it disappears.
 */
export function DeleteNamespaceConfirm({ context, name, onClose, onDeleted }: Props) {
  const identity = useClusterIdentity(context);
  const del = useDeleteNamespace();
  const [error, setError] = useState("");
  // The host renders this once and never unmounts it, so a failed attempt must not outlive its dialog.
  useEffect(() => { setError(""); }, [name, context]);

  const confirm = async () => {
    if (!name) return;
    setError("");
    try {
      await del.mutateAsync({ context, name });
      onDeleted(name);
      onClose();
    } catch (e) {
      setError((e as any)?.message ?? String(e));
    }
  };

  return (
    <ConfirmModal
      contextLabel={identity.label}
      contextColor={identity.color}
      context={identity.context}
      kubectlEquivalent={name ? deleteNamespaceEquiv({ context, name }) : null}
      open={name !== null}
      title={`Delete namespace ${name ?? ""}`}
      description="Deletes the namespace and everything in it. This can't be undone."
      confirmLabel="Delete namespace"
      destructive
      requireTyping={name ?? undefined}
      requireTypingLabel="Type the namespace name to confirm"
      status={error ? { tone: "error", text: error } : null}
      onConfirm={confirm}
      onCancel={onClose}
      isPending={del.isPending}
    />
  );
}
