import { useMemo, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { useStartDebugContainer } from "../hooks/useResources";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { findFailing, selectShellContainer } from "../utils/containerSelect";
import {
  DEBUG_IMAGE_SUGGESTIONS, defaultImage, generateDebugName, loadRecentImages, pushRecentImage, rejectionPlainLine,
  rejectionStatus, saveRecentImages, validateImage,
} from "../utils/debugContainer";
import { debugEquiv } from "../utils/kubectlEquiv";
import type { Pod } from "../types/k8s";

// "Start debug container in <pod>" (docs/ux/02 §3.8, copy §5.4): ConfirmModal `md`,
// NON-destructive (info glyph, accent primary). Irreversibility is stated in words, not with
// a warning triangle, so the triangle keeps its meaning. It attaches (never execs): the
// container is created with stdin + tty and no command, like `kubectl debug -it`.
//
// Read-only and the typed guardrail come from ConfirmModal's `context` (D3-7 blocks this
// whole entry while read-only is on; if it turns on while the dialog is open the primary
// goes inert with the reason).

export interface StartedDebug {
  name: string;
  image: string;
  target: string | null;
}

interface Props {
  pod: Pod;
  context: string;
  onClose: () => void;
  onStarted: (s: StartedDebug) => void;
}

const NONE = "";

export function DebugContainerDialog({ pod, context, onClose, onStarted }: Props) {
  const identity = useClusterIdentity(context);
  const start = useStartDebugContainer();
  const [recent, setRecent] = useState<string[]>(() => loadRecentImages());
  const [image, setImage] = useState(() => defaultImage(loadRecentImages()));
  // Generated once per open so the user can recognise it in the Containers tab afterwards.
  const [name] = useState(() => generateDebugName());
  const selectable = useMemo(
    () => ({ containers: pod.containers, containers_status: pod.containers_status, default_container: pod.default_container }),
    [pod],
  );
  const [target, setTarget] = useState<string>(() => selectShellContainer(selectable));
  const [error, setError] = useState("");

  const failing = useMemo(() => new Set(findFailing(selectable).map((f) => f.name)), [selectable]);
  const imageError = validateImage(image);
  const running = start.isPending;

  const submit = async () => {
    setError("");
    const img = image.trim();
    try {
      const created = await start.mutateAsync({
        context, namespace: pod.namespace, pod: pod.name, name, image: img,
        targetContainer: target === NONE ? undefined : target,
      });
      const next = pushRecentImage(recent, img);
      setRecent(next);
      saveRecentImages(next);
      onStarted({ name: created || name, image: img, target: target === NONE ? null : target });
    } catch (e) {
      setError((e as any)?.message ?? String(e));
    }
  };

  const suggestions = [...recent, ...DEBUG_IMAGE_SUGGESTIONS.filter((s) => !recent.includes(s))];

  return (
    <ConfirmModal
      open
      size="md"
      destructive={false}
      initialFocus="first"
      context={identity.context}
      contextLabel={identity.label}
      contextColor={identity.color}
      title={`Start debug container in "${pod.name}"`}
      description={
        <>
          Adds an ephemeral container to this pod so you can run tools next to your app. It doesn't restart the pod or its other containers.
          <span className="block mt-1.5">
            This can't be undone. Kubernetes doesn't allow removing an ephemeral container: it stays in the pod's spec until the pod is deleted.
          </span>
          {pod.owner && <span className="block mt-1.5">Pods created later by the owning workload won't have it.</span>}
        </>
      }
      confirmLabel={error ? "Retry" : "Start debug container"}
      confirmDisabled={!!imageError || running}
      confirmDisabledReason={imageError ?? undefined}
      phase={running ? "running" : error ? "error" : "review"}
      isPending={running}
      status={
        error
          ? { tone: "error", text: rejectionStatus(error) }
          : running
            ? { tone: "info", text: "Adding debug container to the pod… This can't be stopped once started." }
            : null
      }
      kubectlEquivalent={debugEquiv({ context, namespace: pod.namespace, pod: pod.name, image: image.trim() || "<image>", target: target === NONE ? undefined : target })}
      onEscapeWhileRunning={() => {}}
      footer={running ? <p className="text-[12px] text-mute">Adding debug container to the pod… This can't be stopped once started. Wait for it to finish.</p> : undefined}
      onCancel={onClose}
      onConfirm={() => { void submit(); }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="debug-image" className="text-[12px] font-medium text-ink">Image</label>
          <input
            id="debug-image"
            data-modal-initial
            value={image}
            onChange={(e) => setImage(e.target.value)}
            list="debug-image-list"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={imageError ? true : undefined}
            className="h-8 px-2.5 rounded-md bg-surface-input/80 ring-1 ring-edge mono text-[12px] text-ink focus:outline-hidden focus:ring-accent/50 focus:ring-2"
          />
          <datalist id="debug-image-list">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setImage(s)}
                className="mono text-[10.5px] px-1.5 py-0.5 rounded-sm ring-1 ring-edge text-mute hover:text-ink"
              >
                {s}{recent.includes(s) ? " · recent" : ""}
              </button>
            ))}
          </div>
          {imageError && <p role="alert" className="text-[11px] text-bad">{imageError}</p>}
          <p className="text-[11px] text-dim">The image needs a shell (sh or bash). The node pulls it using the pod's image pull secrets.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="debug-target" className="text-[12px] font-medium text-ink">Target container</label>
          <select
            id="debug-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-8 px-2.5 rounded-md bg-surface-input/80 ring-1 ring-edge text-[12px] text-ink focus:outline-hidden focus:ring-accent/50 focus:ring-2"
          >
            <option value={NONE}>None (don't share a process namespace)</option>
            {pod.containers.map((c) => (
              <option key={c.name} value={c.name}>
                {c.is_init ? `[init] ${c.name}` : c.name}{failing.has(c.name) ? " (crashed)" : ""}
              </option>
            ))}
            {(pod.ephemeral_containers ?? []).map((e) => (
              <option key={e.name} value={e.name}>[debug] {e.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-dim">Lets you see this container's processes. Not every container runtime supports it.</p>
        </div>

        <p className="text-[11.5px] text-mute">Name <span className="mono text-ink">{name}</span> <span className="text-dim">(generated)</span></p>

        {error && <p className="text-[11.5px] text-mute">{rejectionPlainLine(error)}</p>}
      </div>
    </ConfirmModal>
  );
}
