import { useState } from "react";
import { Eye } from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { READ_ONLY_TABLE_STRIP } from "../utils/guardrails";

// Read-only mode surfaces (docs/ux/03 §11.3). All text plus an EYE glyph — never a padlock
// (a padlock says "secured"), never the warn role (a warning would read as "something is
// wrong"): neutral `mute` text on a tinted surface with an edge ring.

/** Compact "Read-only" chip for panel headers, the Sidebar chip and ContextSwitcher rows. */
export function ReadOnlyChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-[2px] rounded-md bg-surface-tint/4 ring-1 ring-edge2 text-[10.5px] text-mute ${className}`}
    >
      <Eye size={10} aria-hidden />
      Read-only
    </span>
  );
}

/**
 * The "Turn off read-only mode" confirm. Always a confirm, from every place it is offered
 * (editor, TopBar popover, table strip, palette). It must not be blocked by the very mode
 * it turns off, so it ignores the guardrails (`ignoreGuardrails`). No typed confirm: the
 * user set the mode and can undo it, and a typed confirm on the escape hatch becomes a
 * trap during an incident.
 */
export function TurnOffReadOnlyConfirm({ context, open, onClose }: { context: string; open: boolean; onClose: () => void }) {
  const identity = useClusterIdentity(context);
  return (
    <ConfirmModal
      open={open}
      context={context}
      ignoreGuardrails
      contextLabel={identity.label}
      contextColor={identity.color}
      title="Turn off read-only mode"
      description={`Write actions become available again for ${identity.label || context}.`}
      confirmLabel="Turn off read-only"
      destructive={false}
      size="sm"
      onConfirm={() => {
        identity.setIdentity({ readOnly: false });
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

/**
 * The strip above a table header. GenericResourceTable's row delete is `opacity-0` until
 * hover, so this strip is the ONLY persistent read-only signal on a list view. It shows
 * whenever the mode is on, even if RBAC has hidden the delete column (it reports the mode).
 */
export function ReadOnlyStrip({ context }: { context: string }) {
  const identity = useClusterIdentity(context);
  const [confirming, setConfirming] = useState(false);
  if (!context || !identity.readOnly) return null;
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-tint/3 ring-1 ring-edge2 text-[11.5px] text-mute">
        <Eye size={12} aria-hidden className="shrink-0" />
        <span>{READ_ONLY_TABLE_STRIP}</span>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-accent hover:underline shrink-0"
        >
          Turn off…
        </button>
      </div>
      <TurnOffReadOnlyConfirm context={context} open={confirming} onClose={() => setConfirming(false)} />
    </>
  );
}
