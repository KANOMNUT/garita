import { useEffect, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { useDeleteCustomResource } from "../hooks/useResources";
import type { CustomResourceSelection } from "../types/k8s";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { crdKubectlNoun } from "../utils/crds";
import { deleteEquiv } from "../utils/kubectlEquiv";

interface Props {
  context: string;
  /** The object to delete, with the CRD it was listed under; null while the dialog is closed. */
  target: CustomResourceSelection | null;
  onClose: () => void;
  /** After a successful delete, before `onClose`. The host closes a panel that showed this object. */
  onDeleted: (target: CustomResourceSelection) => void;
}

/**
 * The confirm for deleting one custom resource. One instance, hosted in App, serves the objects list's row trash and the
 * custom resource panel's header trash (the DeleteNamespaceConfirm pattern). Outside the TopBar `<header>`: a ConfirmModal
 * has no portal and the header starts a window drag on mousedown.
 *
 * The delete is a Background delete (the backend sends the policy explicitly; there is no picker). A cluster-scoped
 * object asks for its name typed, as every cluster-scoped delete does. The dialog stays open on a failed delete and
 * shows the backend message verbatim; only a success closes it.
 */
export function DeleteCustomResourceConfirm({ context, target, onClose, onDeleted }: Props) {
  const identity = useClusterIdentity(context);
  const del = useDeleteCustomResource();
  const [error, setError] = useState("");
  // The host renders this once and never unmounts it, so a failed attempt must not outlive its dialog. Keyed on the
  // identity string, not the object: the host builds a new object each time it opens the dialog.
  const identityKey = target ? `${target.crd.name}\u0000${target.item.namespace}\u0000${target.item.name}` : "";
  useEffect(() => { setError(""); }, [identityKey, context]);

  const kind = target?.crd.kind ?? "";
  const name = target?.item.name ?? "";
  const namespace = target?.item.namespace ?? "";
  const clusterScoped = target?.crd.scope === "Cluster";

  const confirm = async () => {
    if (!target) return;
    setError("");
    try {
      await del.mutateAsync({ context, crd: target.crd, namespace: target.item.namespace, name: target.item.name });
      onDeleted(target);
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
      kubectlEquivalent={target ? deleteEquiv({ context, namespace, kind: crdKubectlNoun(target.crd), name }) : null}
      open={target !== null}
      title={`Delete ${kind} ${name}`}
      description={clusterScoped
        ? `Deletes ${kind} "${name}" from the cluster. This can't be undone.`
        : `Deletes ${kind} "${name}" from namespace "${namespace}". This can't be undone.`}
      confirmLabel={`Delete ${kind}`}
      destructive
      requireTyping={clusterScoped ? name : undefined}
      requireTypingLabel={clusterScoped ? "Type the name to confirm" : undefined}
      status={error ? { tone: "error", text: error } : null}
      onConfirm={confirm}
      onCancel={onClose}
      isPending={del.isPending}
    />
  );
}
