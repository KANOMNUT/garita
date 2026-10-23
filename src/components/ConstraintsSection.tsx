import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import type { ResourceType } from "../types/k8s";
import {
  useLimitRanges, useMutatingWebhooks, usePdbs, usePriorityClasses, useResourceJson, useResourceQuotas,
  useValidatingWebhooks,
} from "../hooks/useResources";
import {
  groupState, limitRangeRows, pdbRows, priorityRows, quotaRows, webhookRows,
  type ConstraintKind, type ConstraintRow, type ConstraintTarget, type GroupState,
} from "../utils/constraints";

const quiet = "text-[11.5px] text-dim";
const msgOf = (e: unknown): string | null => (e ? ((e as any)?.message ?? String(e)) : null);

interface GroupProps {
  title: string;
  /** Plural noun for the loading and denied lines, e.g. "quotas". */
  noun: string;
  state: GroupState;
  rows: ConstraintRow[];
  none: string;
  errorMessage: string | null;
  deniedExtra?: string;
  onRetry: () => void;
  onOpen: (kind: ResourceType, namespace: string, name: string) => void;
  /** A group built from two queries can be partly readable. */
  note?: string;
}

function Group({ title, noun, state, rows, none, errorMessage, deniedExtra, onRetry, onOpen, note }: GroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[10.5px] uppercase tracking-wider text-dim">{title}</h4>
      {state === "loading" && <p className={quiet}>Loading {noun}…</p>}
      {state === "none" && <p className={quiet}>{none}</p>}
      {state === "denied" && <p className={quiet}>You don't have access to {noun}.{deniedExtra ? ` ${deniedExtra}` : ""}</p>}
      {state === "error" && (
        <p className={quiet}>
          Couldn't load {noun}: {errorMessage}.{" "}
          <button type="button" onClick={onRetry} className="text-accent hover:underline">Retry</button>
        </p>
      )}
      {state === "rows" && rows.map((r) => (
        <div key={`${r.group}/${r.name}`} className="flex items-start gap-2 text-[11.5px]">
          <span className="text-mute mt-px w-3 shrink-0" aria-hidden>{r.applicability === "applies" ? "●" : "◐"}</span>
          <p className="flex-1 min-w-0 text-mute">
            <span className="mono text-ink break-all">"{r.name}"</span> {r.detail}
          </p>
          <button
            type="button"
            onClick={() => onOpen(r.open.kind, r.open.namespace, r.name)}
            title={`Open ${r.group === "pdb" ? "pod disruption budget" : r.group === "quota" ? "resource quota" : r.group === "limit-range" ? "limit range" : r.group === "priority" ? "priority class" : "webhook configuration"} ${r.name}`}
            className="inline-flex items-center gap-0.5 text-accent hover:underline shrink-0"
          >
            Open <ArrowUpRight size={11} aria-hidden />
          </button>
        </div>
      ))}
      {note && <p className={quiet}>{note}</p>}
    </div>
  );
}

interface Props {
  context: string;
  kind: ConstraintKind;
  namespace: string;
  name: string;
  /** Pods carry their own labels and priority class; workloads read them from their pod template. */
  pod?: { labels: Record<string, string>; priorityClass: string | null };
  onOpen: (kind: ResourceType, namespace: string, name: string) => void;
}

/**
 * #14: which rules constrain this object. Five groups, each with its own query and its own state,
 * so a forbidden webhook list never hides the quotas. Quota and limit-range rows are
 * names plus a sentence only; the quota's own view is one Open away.
 */
export function ConstraintsSection({ context, kind, namespace, name, pod, onOpen }: Props) {
  const json = useResourceJson(context, namespace, kind, name, !pod);
  const quotas = useResourceQuotas(context, namespace);
  const ranges = useLimitRanges(context, namespace);
  const pdbs = usePdbs(context, namespace);
  const classes = usePriorityClasses(context);
  const mwc = useMutatingWebhooks(context);
  const vwc = useValidatingWebhooks(context);

  const target = useMemo<ConstraintTarget>(() => {
    const tpl = json.data?.spec?.template;
    const labels = pod ? pod.labels : (tpl?.metadata?.labels ?? {});
    const pc = pod ? pod.priorityClass : (tpl?.spec?.priorityClassName ?? null);
    return { kind, namespace, labels, priorityClass: typeof pc === "string" && pc !== "" ? pc : null };
  }, [kind, namespace, pod, json.data]);

  // Workload labels and class come from the live object: groups that need them wait for it.
  const needsObject = !pod;
  const objectLoading = needsObject && json.isLoading;
  const objectError = needsObject ? msgOf(json.error) : null;

  const qRows = useMemo(() => quotaRows(quotas.data ?? [], target), [quotas.data, target]);
  const lRows = useMemo(() => limitRangeRows(ranges.data ?? [], target), [ranges.data, target]);
  const pRows = useMemo(() => (objectLoading || objectError ? [] : pdbRows(pdbs.data ?? [], target)), [pdbs.data, target, objectLoading, objectError]);
  const cRows = useMemo(() => (objectLoading || objectError ? [] : priorityRows(classes.data ?? [], target)), [classes.data, target, objectLoading, objectError]);
  const wRows = useMemo(
    () => [...webhookRows(mwc.data ?? [], target, "mwc"), ...webhookRows(vwc.data ?? [], target, "vwc")],
    [mwc.data, vwc.data, target],
  );

  const pdbErr = msgOf(pdbs.error) ?? objectError;
  const classErr = msgOf(classes.error) ?? objectError;
  // Webhook group: loading until both answered; an error only when neither did, else a partial note.
  const wBoth = !!(mwc.error && vwc.error);
  const wErr = wBoth ? msgOf(mwc.error) : null;
  const wPartial = !wBoth && !!(mwc.error || vwc.error);
  const wCount = (mwc.data?.length ?? 0) + (vwc.data?.length ?? 0);

  return (
    <section className="rounded-lg bg-card/70 ring-1 ring-edge p-3 flex flex-col gap-3">
      <div>
        <h3 className="text-[11px] uppercase tracking-wider text-dim">Constraints</h3>
        <p className={`${quiet} mt-1`}>● Applies: matched from labels or namespace.</p>
        <p className={quiet}>◐ May apply: can't be fully evaluated here.</p>
      </div>
      <Group title="Resource quotas" noun="quotas" rows={qRows} onOpen={onOpen} onRetry={() => void quotas.refetch()}
        state={groupState(quotas.isLoading, msgOf(quotas.error), qRows.length)} errorMessage={msgOf(quotas.error)}
        none={`None in namespace ${namespace}.`} />
      <Group title="Limit ranges" noun="limit ranges" rows={lRows} onOpen={onOpen} onRetry={() => void ranges.refetch()}
        state={groupState(ranges.isLoading, msgOf(ranges.error), lRows.length)} errorMessage={msgOf(ranges.error)}
        none={`None in namespace ${namespace}.`} />
      <Group title="Pod disruption budgets" noun="pod disruption budgets" rows={pRows} onOpen={onOpen}
        onRetry={() => { void pdbs.refetch(); void json.refetch(); }}
        state={groupState(pdbs.isLoading || objectLoading, pdbErr, pRows.length)} errorMessage={pdbErr}
        none={`None in namespace ${namespace}.`} />
      <Group title="Priority class" noun="priority classes" rows={cRows} onOpen={onOpen}
        onRetry={() => { void classes.refetch(); void json.refetch(); }}
        state={groupState(classes.isLoading || objectLoading, classErr, cRows.length)} errorMessage={classErr}
        none="No priority class is set and the cluster has no default." />
      <Group title="Admission webhooks" noun="webhook configurations" rows={wRows} onOpen={onOpen}
        onRetry={() => { void mwc.refetch(); void vwc.refetch(); }}
        state={groupState(mwc.isLoading || vwc.isLoading, wErr, wRows.length)} errorMessage={wErr}
        none={wCount === 0 ? "None configured on this cluster." : "None of this cluster's webhook configurations match."}
        deniedExtra="Webhooks that may apply can't be listed."
        note={wPartial ? "Some webhook configurations couldn't be read. Webhooks that may apply can't be fully listed." : undefined} />
    </section>
  );
}
