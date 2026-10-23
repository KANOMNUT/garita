import { useEffect, useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { PropagationPolicy, ResourceType } from "../types/k8s";

// #30 delete propagation picker (docs/ux/03-diffs-write-safety.md §12, copy §17.5).
// Lives in the body of the existing delete ConfirmModal for the kinds that own
// dependents through ownerReferences. It is NEVER remembered: the policy resets
// to Background on every open (a remembered Orphan is how a later delete leaves
// a fleet of owner-less pods), and the chosen value is always sent explicitly.

/** Dependents named in the copy, per owner kind (§12.1). Kinds absent here get no picker. */
export const PROPAGATION_DEPENDENTS: Partial<Record<ResourceType, string>> = {
  deploy: "ReplicaSets and pods",
  sts: "pods",
  ds: "pods",
  jobs: "pods",
  rs: "pods",
  cron: "Jobs and their pods",
};

export function propagationDependents(kind: ResourceType | string): string | undefined {
  return PROPAGATION_DEPENDENTS[kind as ResourceType];
}

/** The primary's label changes with the choice, for every owner kind (§12.3). */
export function deleteLabelFor(policy: PropagationPolicy): string {
  return policy === "orphan" ? "Delete, keep dependents" : "Delete";
}

/** Resets to Background each time the dialog opens. */
export function usePropagationState(open: boolean): [PropagationPolicy, (p: PropagationPolicy) => void] {
  const [policy, setPolicy] = useState<PropagationPolicy>("background");
  useEffect(() => {
    if (open) setPolicy("background");
  }, [open]);
  return [policy, setPolicy];
}

export function PropagationPicker({
  name,
  dependents,
  value,
  onChange,
  disabled = false,
}: {
  name: string;
  dependents: string;
  value: PropagationPolicy;
  onChange: (p: PropagationPolicy) => void;
  disabled?: boolean;
}) {
  const groupName = useId();
  const headingId = useId();
  const options: { id: PropagationPolicy; label: string; desc: string }[] = [
    {
      id: "background",
      label: "Background (kubectl's default)",
      desc: `"${name}" is deleted now. Kubernetes removes its ${dependents} afterwards.`,
    },
    {
      id: "foreground",
      label: "Foreground",
      desc: `"${name}" stays in the list, marked as deleting, until its ${dependents} are gone.`,
    },
    {
      id: "orphan",
      label: "Orphan",
      desc: `Only "${name}" is deleted. Its ${dependents} keep running with no owner.`,
    },
  ];

  return (
    <div role="radiogroup" aria-labelledby={headingId} className="flex flex-col gap-2">
      <div id={headingId} className="text-[11.5px] text-mute font-medium">
        What happens to its {dependents}
      </div>
      {options.map((o) => {
        const descId = `${groupName}-${o.id}`;
        return (
          <label key={o.id} className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name={groupName}
              checked={value === o.id}
              disabled={disabled}
              onChange={() => onChange(o.id)}
              aria-describedby={descId}
              className="mt-0.5 accent-accent"
            />
            <div>
              <span className="text-[12.5px] text-ink">{o.label}</span>
              <p id={descId} className="text-[11px] text-dim">{o.desc}</p>
            </div>
          </label>
        );
      })}
      {value === "orphan" && (
        <div role="note" className="flex items-start gap-2 rounded-lg px-3 py-2 ring-1 text-[12px] text-warn bg-warn/10 ring-warn/25">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Orphaned pods aren't cleaned up automatically. You'll need to delete them yourself.</span>
        </div>
      )}
    </div>
  );
}
