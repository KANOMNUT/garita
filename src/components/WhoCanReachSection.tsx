import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useNetworkPolicyModel } from "../hooks/useResources";
import { evaluateNetpol, podReach, type PodReachRow } from "../utils/netpolEval";

// #24 pod panel section (docs/ux/06 §4.4). Same model query as the Map page's Network policies mode (staleTime 30 s).
// Read only; every line is an approximation and says so.

const quiet = "text-[11.5px] text-mute";

function Rows({ rows }: { rows: PodReachRow[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.id} className="text-[11.5px] text-mute">
          <span aria-hidden>● </span>
          <span className="text-ink">{r.id.startsWith("group:") ? `Pods: ${r.label}` : r.label}</span>
          <br />
          <span className="pl-3">{r.ports.join(", ")} · allowed by {r.allowedBy.join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

export function WhoCanReachSection({ context, namespace, podName, onShowOnMap }: {
  context: string;
  namespace: string;
  podName: string;
  /** Opens the Map page in Network policies (approximation) mode, focused on this pod's group. */
  onShowOnMap: () => void;
}) {
  const q = useNetworkPolicyModel(context, namespace, true);
  const [egressOpen, setEgressOpen] = useState(false);
  const model = q.data;
  const reach = useMemo(() => (model ? podReach(evaluateNetpol(model, namespace), podName) : null), [model, namespace, podName]);

  let body: React.ReactNode;
  if (!model) {
    body = q.error ? (
      <p className={quiet}>
        Couldn&apos;t read network policies: {(q.error as any)?.message ?? String(q.error)}.{" "}
        <button type="button" onClick={() => void q.refetch()} className="text-accent hover:underline">Retry</button>
      </p>
    ) : (
      <p className={quiet}>Reading network policies…</p>
    );
  } else if (model.skipped.some((s) => s.source === "networkpolicies" || s.source === "pods")) {
    const what = model.skipped.some((s) => s.source === "networkpolicies") ? "NetworkPolicies" : "pods";
    body = <p className={quiet}>You don&apos;t have access to {what} in this namespace, so this can&apos;t be worked out.</p>;
  } else if (!reach) {
    body = <p className={quiet}>This pod isn&apos;t in the network policy model (it may have finished or been deleted).</p>;
  } else {
    const by = reach.group.ingress.restrictedBy;
    body = (
      <>
        {by.length === 0 ? (
          <p className="text-[11.5px] text-mute">No policy selects this pod for ingress, so no standard NetworkPolicy restricts traffic to it. (approximation)</p>
        ) : (
          <>
            <p className="text-[11.5px] text-mute">Selected for ingress by {by.length} {by.length === 1 ? "policy" : "policies"}: <span className="mono text-ink">{by.join(", ")}</span></p>
            <h5 className="text-[10.5px] uppercase tracking-wider text-mute">Allowed sources</h5>
            {reach.ingress.length ? <Rows rows={reach.ingress} /> : <p className={quiet}>No allow rule found.</p>}
          </>
        )}
        <button type="button" aria-expanded={egressOpen} onClick={() => setEgressOpen((v) => !v)} className="self-start text-[11.5px] text-mute hover:text-ink">
          {egressOpen ? "▾" : "▸"} Where this pod can connect (egress)
        </button>
        {egressOpen && (
          reach.group.egress.restrictedBy.length === 0 ? (
            <p className={quiet}>No policy selects this pod for egress, so no standard NetworkPolicy restricts its outgoing traffic. (approximation)</p>
          ) : reach.egress.length ? <Rows rows={reach.egress} /> : <p className={quiet}>No allow rule found.</p>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[10.5px] uppercase tracking-wider text-mute">Who can reach this pod (approximation)</h4>
      {body}
      <p className={quiet}>
        Approximation. Built from standard NetworkPolicy objects only. CNI-specific policies, named ports, node-local traffic or policies in other namespaces aren&apos;t covered.{" "}
        <button type="button" onClick={onShowOnMap} className="inline-flex items-center gap-0.5 text-accent hover:underline">
          Show on map <ArrowUpRight size={11} aria-hidden />
        </button>
      </p>
    </div>
  );
}
