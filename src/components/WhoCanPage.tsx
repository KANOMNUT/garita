import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, ChevronDown, ChevronRight, Info, Loader2, ShieldOff } from "lucide-react";
import type { ResourceType, WhoCanGrant } from "../types/k8s";
import { RBAC_RESOURCE, useCRDs, useNamespaces, useWhoCan, type WhoCanQuery } from "../hooks/useResources";
import {
  bindingLine, emptyLine, foundAnnouncement, groupSubjects, resolveResource, resourceChoices, scopeWords, skipLine,
  subjectCount, subjectLabel, whoCanState, type SubjectRow,
} from "../utils/whoCan";
import { clock, StaleStrip } from "./health/StaleStrip";

// #32 Who can… (docs/ux/04 §3.13, §4.11, §5.10). Mounted hidden so the form and the last result survive leaving.
// Computed from RBAC bindings: never the user's own access check, never "no one can".

const VERBS = ["get", "list", "watch", "create", "update", "patch", "delete", "deletecollection"];
const field = "h-8 px-2.5 rounded-md bg-surface-input/80 ring-1 ring-edge text-[12px] text-ink focus:outline-hidden focus:ring-accent/50 focus:ring-2";
const tag = "mono text-[10px] px-1.5 py-0.5 rounded-sm ring-1 ring-edge text-mute";

interface Props {
  context: string;
  visible: boolean;
  /** TopBar search: filters the result subjects ("Filter subjects…"). */
  search: string;
  /** Namespace-setting navigation (P9). */
  onOpen: (kind: ResourceType, namespace: string, name: string) => void;
}

function GrantLine({ g, onOpen }: { g: WhoCanGrant; onOpen: Props["onOpen"] }) {
  const [named, setNamed] = useState(false);
  const open = () => (g.binding_kind === "RoleBinding" ? onOpen("rbindings", g.binding_namespace ?? "", g.binding) : onOpen("crbindings", "", g.binding));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-mute">{scopeWords(g)} · <span className="mono">{bindingLine(g)}</span></span>
        {g.via_wildcard && <span className={tag}>Wildcard</span>}
        {g.resource_names.length > 0 && (
          <button type="button" aria-expanded={named} onClick={() => setNamed((v) => !v)} className={`${tag} inline-flex items-center gap-1 hover:text-ink`}>
            {named ? <ChevronDown size={10} aria-hidden /> : <ChevronRight size={10} aria-hidden />}
            Limited to {g.resource_names.length} named {g.resource_names.length === 1 ? "object" : "objects"}
          </button>
        )}
        <button type="button" onClick={open} title={`Open ${g.binding_kind} ${g.binding}`} aria-label={`Open ${g.binding_kind} ${g.binding}`} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline">
          Open <ArrowUpRight size={11} aria-hidden />
        </button>
      </div>
      {named && <p className="mono text-[11px] text-ink break-all pl-2">{g.resource_names.join(", ")}</p>}
    </div>
  );
}

function SubjectCard({ row, onOpen }: { row: SubjectRow; onOpen: Props["onOpen"] }) {
  const s = row.subject;
  return (
    <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="mono text-[12px] text-ink break-all">{subjectLabel(s)}</span>
        {s.kind === "ServiceAccount" && s.namespace && (
          <button type="button" onClick={() => onOpen("sa", s.namespace ?? "", s.name)} title={`Open service account ${s.name}`} aria-label={`Open service account ${s.name}`} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline">
            Open service account <ArrowUpRight size={11} aria-hidden />
          </button>
        )}
      </div>
      {row.grants.map((g, i) => <GrantLine key={`${g.binding_kind}/${g.binding_namespace}/${g.binding}/${i}`} g={g} onOpen={onOpen} />)}
    </div>
  );
}

export function WhoCanPage({ context, visible, search, onOpen }: Props) {
  const [verb, setVerb] = useState("list");
  const [resourceText, setResourceText] = useState("");
  const [sub, setSub] = useState("");
  const [ns, setNs] = useState("");
  const [submitted, setSubmitted] = useState<(WhoCanQuery & { text: string }) | null>(null);
  const [builtinOpen, setBuiltinOpen] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState("");

  const crds = useCRDs(visible ? context : "");
  const namespaces = useNamespaces(visible ? context : "");
  const choices = useMemo(() => resourceChoices(RBAC_RESOURCE, crds.data ?? []), [crds.data]);
  const resolved = useMemo(() => resolveResource(resourceText, choices), [resourceText, choices]);
  // The resource field may carry /subresource; the Subresource field wins when both are filled.
  const subresource = sub.trim() || resolved?.subresource || "";
  const hideNs = !!resolved?.clusterScoped;

  const q = useWhoCan(context, submitted, visible);
  // A new cluster starts clean.
  useEffect(() => { setSubmitted(null); setNs(""); }, [context]);

  const submit = () => {
    // aria-disabled, not disabled: the focused button must keep focus while the lookup runs.
    if (!resolved || q.isFetching) return;
    const next = {
      verb, group: resolved.group, resource: resolved.resource, subresource,
      namespace: hideNs || !ns ? null : ns,
      text: subresource ? `${resourceText.split("/")[0].trim()}/${subresource}` : resourceText.trim(),
    };
    if (submitted && JSON.stringify(next) === JSON.stringify(submitted)) void q.refetch();
    else setSubmitted(next);
  };

  const result = q.data;
  const groups = useMemo(() => (result ? groupSubjects(result.grants, search) : []), [result, search]);
  useEffect(() => { if (result) setAnnouncement(foundAnnouncement(subjectCount(groupSubjects(result.grants)))); }, [result]);

  const state = result ? whoCanState(result.grants.length, result.skipped, !!submitted?.namespace) : null;
  const errMsg = q.error ? ((q.error as any)?.message ?? String(q.error)) : "";

  let body: React.ReactNode = null;
  if (!submitted) {
    body = <p id="whocan-prompt" className="text-[12px] text-mute">Choose a verb and a resource, then find subjects.</p>;
  } else if (!result) {
    body = q.isError ? (
      <div role="alert" className="flex items-center gap-3 rounded-lg bg-bad/10 ring-1 ring-bad/30 px-3 py-2 text-[12px] text-bad">
        <AlertCircle size={14} aria-hidden />
        <span className="flex-1 min-w-0 wrap-break-word">Couldn't look up bindings. {errMsg}</span>
        <button type="button" onClick={() => void q.refetch()} className="h-6 px-2 rounded-sm ring-1 ring-edge text-mute hover:text-ink text-[11px]">Retry</button>
      </div>
    ) : (
      <div role="status" className="text-[12px] text-mute">Looking up bindings…</div>
    );
  } else if (state === "no-access") {
    body = (
      <div className="rounded-xl bg-card/70 ring-1 ring-edge flex flex-col items-center gap-2 text-center px-6 py-10">
        <ShieldOff size={28} className="text-dim" aria-hidden />
        <p className="text-[13px] text-mute">You don't have access to roles and bindings.</p>
        <p className="text-[11.5px] text-dim max-w-md">Your account can't list them. Ask a cluster admin for the list permission.</p>
      </div>
    );
  } else if (result.grants.length === 0) {
    body = (
      <p className="text-[12px] text-mute">
        {emptyLine(submitted.verb, submitted.text, submitted.namespace)} Access may still come from outside RBAC, for example cloud IAM or an authorizing webhook.
      </p>
    );
  } else if (groups.length === 0) {
    body = <p className="text-[12px] text-mute">No subjects match the filter.</p>;
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.kind} className="flex flex-col gap-2">
            <h2 className="text-[12px] font-semibold text-ink">{g.label} · {g.count}</h2>
            {g.rows.map((r) => <SubjectCard key={r.key} row={r} onOpen={onOpen} />)}
            {g.builtin.length > 0 && (
              <>
                <button
                  type="button"
                  aria-expanded={!!builtinOpen[g.kind] || !!search.trim()}
                  onClick={() => setBuiltinOpen((o) => ({ ...o, [g.kind]: !o[g.kind] }))}
                  className="self-start inline-flex items-center gap-1 text-[11.5px] text-mute hover:text-ink"
                >
                  {builtinOpen[g.kind] || search.trim() ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                  Built-in (system:…) · {g.builtin.length}
                </button>
                {(builtinOpen[g.kind] || !!search.trim()) && g.builtin.map((r) => <SubjectCard key={r.key} row={r} onOpen={onOpen} />)}
              </>
            )}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3 ${visible ? "" : "hidden"}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[14px] font-semibold tracking-tight">Who can…</h1>
          <p className="text-[11.5px] text-mute">
            Computed from RBAC bindings. This isn't a check of your own access, and admission webhooks or non-RBAC authorizers can still allow or deny.
          </p>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider text-dim shrink-0">Hint</span>
        {result && <span className="text-[11.5px] text-dim shrink-0">Checked {clock(q.dataUpdatedAt)}</span>}
      </div>

      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-dim">Verb
            <select className={field} value={verb} onChange={(e) => setVerb(e.target.value)}>
              {VERBS.map((v) => <option key={v} value={v}>{v}</option>)}
              <option value="*">any verb (*)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-dim">Resource
            <input
              className={`${field} w-[260px] mono`} list="whocan-resources" value={resourceText} spellCheck={false} autoComplete="off"
              placeholder="pods, deployments.apps, pods/log"
              onChange={(e) => setResourceText(e.target.value)}
            />
            <datalist id="whocan-resources">{choices.map((c) => <option key={c.label} value={c.label} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-dim">Subresource (optional)
            <input className={`${field} w-[160px] mono`} value={sub} spellCheck={false} autoComplete="off" onChange={(e) => setSub(e.target.value)} />
          </label>
          {!hideNs && (
            <label className="flex flex-col gap-1 text-[11px] text-dim">Namespace
              <select className={field} value={ns} onChange={(e) => setNs(e.target.value)}>
                <option value="">Cluster-wide</option>
                {(namespaces.data ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
        {!hideNs && (
          <p className="text-[11px] text-dim">
            Cluster-wide shows only grants that apply in every namespace.
            {!resolved || !choices.some((c) => c.resource === resolved.resource) ? " For a cluster-scoped resource, choose Cluster-wide." : ""}
          </p>
        )}
        <div>
          <button
            type="submit"
            aria-disabled={!resolved || q.isFetching || undefined}
            aria-describedby={!resolved && !submitted ? "whocan-prompt" : undefined}
            className={`h-8 px-3 rounded-md bg-accent/20 ring-1 ring-accent/40 text-[12px] text-accent hover:bg-accent/30 inline-flex items-center gap-1.5 ${!resolved || q.isFetching ? "opacity-50" : ""}`}
          >
            {q.isFetching && <Loader2 size={12} className="animate-spin" aria-hidden />}
            {q.isFetching ? "Looking up bindings…" : "Find subjects"}
          </button>
        </div>
      </form>

      {result && q.error && <StaleStrip at={q.dataUpdatedAt} />}
      {result && result.skipped.length > 0 && state !== "no-access" && (
        <p className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex items-start gap-2">
          <Info size={13} className="text-info mt-0.5 shrink-0" aria-hidden />
          <span>Partially visible. {skipLine(result.skipped)}</span>
        </p>
      )}
      {body}
      {result && result.notes.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-[11px] uppercase tracking-wider text-dim font-semibold">Notes</h2>
          <ul className="list-disc pl-5 text-[11.5px] text-mute flex flex-col gap-0.5">
            {result.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      )}
      {result && <span className="sr-only" role="status" aria-live="polite">{announcement}</span>}
    </div>
  );
}
