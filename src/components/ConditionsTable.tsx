import type { ResourceCondition } from "../types/k8s";

/**
 * The Conditions card of the Summary tab: Type, Status, Reason, Message (ui.md → Conditions Table Fix).
 * Shared by the workload Summary (`ResourceDetailPanel`) and the Pod Summary (`DetailPanel`). Renders nothing when the list
 * is empty, so a kind or pod without conditions shows no empty card.
 *
 * `colourFor` says which condition types get the ok / bad / warn colour for their status; the default is every type (workloads
 * and pods). A type it rejects shows its status in `text-ink`: a custom resource's conditions have no common meaning for
 * `False` (for `Stalled` it is the good answer), so only `Ready` is coloured there.
 */
export function ConditionsTable({ conditions, colourFor }: { conditions: ResourceCondition[]; colourFor?: (type: string) => boolean }) {
  if (conditions.length === 0) return null;
  return (
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
              <td className={`py-1 pr-3 ${colourFor && !colourFor(c.type_) ? "text-ink" : c.status === "True" ? "text-ok" : c.status === "False" ? "text-bad" : "text-warn"}`}>
                {c.status}
              </td>
              <td className="py-1 pr-3 text-mute truncate" title={c.reason}>{c.reason}</td>
              <td className="py-1 text-mute wrap-break-word leading-snug">{c.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
