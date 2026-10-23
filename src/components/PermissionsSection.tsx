import { useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import type { RbacSubject, ResourceType, RuleGrant, SelectedResource } from "../types/k8s";
import { useClusterRoleBindings, useRoleBindings, useSubjectPermissions } from "../hooks/useResources";
import { boundTo, groupRuleGrants, NOTE_ALWAYS, subjectLabel, USER_GROUPS_NOTE } from "../utils/whoCan";
import { isForbidden } from "../utils/viewState";

// #32 Permissions section on the Summary tab of sa / roles / croles / rbindings / crbindings (docs/ux/04 §3.14, §4.12).
// Computed from RBAC bindings, on demand, `staleTime` 30 s. Read only; the only action is Open.

export const PERMISSION_KINDS: ReadonlySet<string> = new Set(["sa", "roles", "croles", "rbindings", "crbindings"]);

const MAX_BINDINGS = 3;
const btn = "h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono";
const tag = "mono text-[10px] px-1.5 py-0.5 rounded-sm ring-1 ring-edge text-mute";

type OnOpen = (kind: ResourceType, namespace: string, name: string) => void;

function Head({ title = "Permissions" }: { title?: string }) {
  return (
    <div className="flex items-center">
      <h3 className="text-[11px] uppercase tracking-wider text-dim flex-1">{title}</h3>
      <span className="text-[10.5px] uppercase tracking-wider text-dim">Hint</span>
    </div>
  );
}

function ErrorLine({ error, what, onRetry }: { error: unknown; what: string; onRetry: () => void }) {
  const msg = (error as any)?.message ?? String(error);
  return (
    <div role="alert" className="rounded-sm bg-bad/10 ring-1 ring-bad/30 px-2 py-1.5 text-[11px] text-bad flex items-start gap-2">
      <span className="flex-1 min-w-0 wrap-break-word">
        {isForbidden(msg) ? `You don't have access to RBAC roles or bindings, so ${what} can't be computed.` : `Couldn't look up ${what}. ${msg}`}
      </span>
      <button type="button" onClick={onRetry} className={btn}>Retry</button>
    </div>
  );
}

function RuleBlocks({ grants }: { grants: RuleGrant[] }) {
  const [all, setAll] = useState(false);
  const scopes = useMemo(() => groupRuleGrants(grants), [grants]);
  const total = scopes.reduce((n, s) => n + s.bindings.length, 0);
  let budget = all ? Infinity : MAX_BINDINGS;
  let hiddenRules = 0;
  return (
    <div className="flex flex-col gap-2">
      {scopes.map((s) => {
        const shown = s.bindings.filter(() => budget-- > 0);
        for (const b of s.bindings.slice(shown.length)) hiddenRules += b.rules.length + b.urls.length;
        if (shown.length === 0) return null;
        return (
          <div key={s.key} className="flex flex-col gap-1.5">
            <p className="text-[10.5px] uppercase tracking-wider text-dim">{s.title}</p>
            {shown.map((b) => (
              <div key={b.key} className="flex flex-col gap-0.5">
                <p className="mono text-[11px] text-ink wrap-break-word">
                  {b.header}{b.viaGroup && <span className="text-dim"> · through group {b.viaGroup}</span>}
                </p>
                {b.rules.map((r, i) => (
                  <p key={i} className="pl-3 text-[11px] text-mute wrap-break-word">
                    <span className="mono text-ink">{r.text}</span> <span className="mono">{r.verbs}</span>
                    {r.wildcard && <span className={`${tag} ml-1`}>Wildcard</span>}
                    {r.wordsAll.length > 0 && <span className="text-dim"> {r.wordsAll.join(", ")}</span>}
                    {r.named.length > 0 && <span className="text-dim"> only named {r.named.join(", ")}</span>}
                  </p>
                ))}
                {b.urls.length > 0 && (
                  <>
                    <p className="pl-3 text-[10.5px] uppercase tracking-wider text-dim">Non-resource URLs</p>
                    {b.urls.map((r, i) => (
                      <p key={i} className="pl-3 text-[11px] text-mute wrap-break-word">
                        <span className="mono text-ink">{r.text}</span> <span className="mono">{r.verbs}</span>
                        {r.wordsAll.length > 0 && <span className="text-dim"> {r.wordsAll.join(", ")}</span>}
                      </p>
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {!all && total > MAX_BINDINGS && (
        <button type="button" onClick={() => setAll(true)} className={`${btn} self-start`}>
          Show {hiddenRules} more {hiddenRules === 1 ? "rule" : "rules"}
        </button>
      )}
    </div>
  );
}

function SubjectRules({ context, subject, emptyText }: { context: string; subject: RbacSubject; emptyText: string }) {
  const q = useSubjectPermissions(context, subject.kind, subject.name, subject.namespace, true);
  if (q.isError) return <ErrorLine error={q.error} what="permissions" onRetry={() => void q.refetch()} />;
  if (!q.data) return <p className="text-[11px] text-mute">Looking up permissions…</p>;
  if (q.data.length === 0) return <p className="text-[11px] text-mute">{emptyText}</p>;
  return <RuleBlocks grants={q.data} />;
}

function ServiceAccountPermissions({ context, ns, name }: { context: string; ns: string; name: string }) {
  return (
    <>
      <p className="text-[11px] text-dim">{NOTE_ALWAYS}</p>
      <SubjectRules context={context} subject={{ kind: "ServiceAccount", name, namespace: ns }} emptyText="No bindings grant this service account any permissions." />
    </>
  );
}

function BindingSubjects({ context, subjects }: { context: string; subjects: RbacSubject[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (subjects.length === 0) return <p className="text-[11px] text-mute">This binding has no subjects.</p>;
  return (
    <>
      <p className="text-[11px] text-dim">{NOTE_ALWAYS}</p>
      {subjects.map((s) => {
        const key = `${s.kind}/${s.namespace ?? ""}/${s.name}`;
        const expanded = open === key;
        return (
          <div key={key} className="flex flex-col gap-1">
            <button
              type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}
              className="self-start inline-flex items-center gap-1 text-[11.5px] text-ink hover:underline"
            >
              {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
              <span className="text-dim">{s.kind}</span> <span className="mono">{subjectLabel(s)}</span>
            </button>
            {expanded && (
              <div className="pl-4 flex flex-col gap-1.5">
                <p className="text-[11px] text-dim">What {subjectLabel(s)} can do, from all of its bindings</p>
                {s.kind === "User" && <p className="text-[11px] text-dim">{USER_GROUPS_NOTE}</p>}
                <SubjectRules context={context} subject={s} emptyText="No bindings grant this subject any permissions." />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function BoundTo({ context, kind, ns, name, onOpen }: { context: string; kind: "Role" | "ClusterRole"; ns: string; name: string; onOpen: OnOpen }) {
  const rbs = useRoleBindings(context, kind === "Role" ? ns : "all");
  const crbs = useClusterRoleBindings(kind === "ClusterRole" ? context : "");
  const refs = useMemo(
    () => boundTo({ kind, name, namespace: ns }, rbs.data ?? [], crbs.data ?? []),
    [kind, name, ns, rbs.data, crbs.data],
  );
  const loading = (rbs.isLoading || (kind === "ClusterRole" && crbs.isLoading));
  return (
    <>
      <p className="text-[11px] text-dim">Bindings that reference this role.</p>
      {kind === "ClusterRole" && rbs.isError && crbs.data && (
        <p className="rounded-sm bg-warn/10 ring-1 ring-warn/30 text-warn text-[11px] px-2 py-1.5">
          Couldn't read role bindings in all namespaces. Only cluster role bindings are shown.
        </p>
      )}
      {loading ? <p className="text-[11px] text-mute">Looking up bindings…</p>
        : (kind === "Role" ? rbs.isError : crbs.isError || (rbs.isError && !crbs.data)) ? (
          <ErrorLine error={(kind === "Role" ? rbs.error : crbs.error ?? rbs.error)} what="bindings" onRetry={() => { void rbs.refetch(); void crbs.refetch(); }} />
        ) : refs.length === 0 ? <p className="text-[11px] text-mute">No bindings reference this role.</p>
        : refs.map((b) => (
          <div key={`${b.kind}/${b.namespace}/${b.name}`} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="mono text-[11.5px] text-ink break-all">{b.kind} {b.namespace ? `${b.namespace}/` : ""}{b.name}</span>
              <button
                type="button" title={`Open ${b.kind} ${b.name}`} aria-label={`Open ${b.kind} ${b.name}`} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
                onClick={() => (b.kind === "RoleBinding" ? onOpen("rbindings", b.namespace, b.name) : onOpen("crbindings", "", b.name))}
              >
                Open <ArrowUpRight size={11} aria-hidden />
              </button>
            </div>
            <p className="pl-3 text-[11px] text-mute wrap-break-word">{b.subjects.length ? b.subjects.map(subjectLabel).join(", ") : "no subjects"}</p>
          </div>
        ))}
    </>
  );
}

export function PermissionsSection({ resource, context, ns, name, onOpen }: {
  resource: SelectedResource; context: string; ns: string; name: string; onOpen: OnOpen;
}) {
  const isRole = resource.kind === "roles" || resource.kind === "croles";
  return (
    <section className="mx-4 mb-4 rounded-xl bg-card/70 ring-1 ring-edge hairline p-3 flex flex-col gap-2">
      <Head title={isRole ? "Bound to" : "Permissions"} />
      {resource.kind === "sa" && <ServiceAccountPermissions context={context} ns={ns} name={name} />}
      {resource.kind === "roles" && <BoundTo context={context} kind="Role" ns={ns} name={name} onOpen={onOpen} />}
      {resource.kind === "croles" && <BoundTo context={context} kind="ClusterRole" ns="" name={name} onOpen={onOpen} />}
      {(resource.kind === "rbindings" || resource.kind === "crbindings") && (
        <BindingSubjects context={context} subjects={resource.item.subject_list ?? []} />
      )}
    </section>
  );
}
