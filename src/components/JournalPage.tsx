import { Fragment, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, Info } from "lucide-react";
import { useJournal } from "../hooks/useResources";
import { CLUSTER_COLOR_CLASSES, getClusterIdentity } from "../utils/clusterIdentity";
import {
  ACCEPTED_TIP, filterJournal, isFiltered, journalKind, journalOptions, NO_FILTERS, relativeTime, RESULT_WORD,
  type JournalFilters, type ResultFilter,
} from "../utils/journal";
import { PRODUCT_NAME } from "../brand";

// #31 Journal (docs/ux/04 §3.17, §4.15). Read only: no row actions, selection, clear or export.
// The TopBar search filters the entries loaded so far.

const select = "h-7 px-2 rounded-md bg-surface-input/80 ring-1 ring-edge text-[12px] text-ink focus:outline-hidden focus:ring-accent/50 focus:ring-2";

function Chip({ context }: { context: string }) {
  if (!context) return <span className="text-dim">—</span>;
  const id = getClusterIdentity(context);
  const c = CLUSTER_COLOR_CLASSES[id.color];
  return (
    <span className={`inline-flex items-center gap-1.5 max-w-[160px] px-1.5 py-0.5 rounded-sm ring-1 ${c.chipBg} ${c.chipRing}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full shrink-0 ${c.dot}`} />
      <span className={`mono text-[11px] truncate ${c.text}`}>{id.label || context}</span>
    </span>
  );
}

export function JournalPage({ search, onClearSearch }: { search: string; onClearSearch: () => void }) {
  const q = useJournal(true);
  const [filters, setFilters] = useState<JournalFilters>(NO_FILTERS);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = useMemo(() => (q.data?.pages ?? []).flat(), [q.data]);
  const f = { ...filters, search };
  const shown = useMemo(() => filterJournal(all, f), [all, filters, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = useMemo(() => journalOptions(all), [all]);
  const errMsg = q.error ? ((q.error as any)?.message ?? String(q.error)) : "";

  let body: React.ReactNode;
  if (q.isLoading) {
    body = (
      <div role="status" className="flex flex-col gap-1.5">
        <span className="text-[12px] text-mute">Loading the journal…</span>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 rounded-sm bg-surface-tint/4 motion-safe:animate-pulse" />)}
      </div>
    );
  } else if (q.isError && all.length === 0) {
    body = (
      <div role="alert" className="flex items-center gap-3 rounded-lg bg-bad/10 ring-1 ring-bad/30 px-3 py-2 text-[12px] text-bad">
        <AlertCircle size={14} aria-hidden />
        <span className="flex-1 min-w-0 wrap-break-word">Couldn't read the journal: {errMsg}</span>
        <button type="button" onClick={() => void q.refetch()} className="h-6 px-2 rounded-sm ring-1 ring-edge text-mute hover:text-ink text-[11px]">Retry</button>
      </div>
    );
  } else if (all.length === 0) {
    body = <p className="text-[12px] text-mute">No actions recorded yet. Writes you make from this app appear here.</p>;
  } else if (shown.length === 0) {
    body = (
      <p className="text-[12px] text-mute">
        No entries match these filters.{" "}
        <button type="button" onClick={() => { setFilters(NO_FILTERS); onClearSearch(); }} className="text-accent hover:underline">Clear filters</button>
      </p>
    );
  } else {
    body = (
      <div className="overflow-x-auto rounded-xl bg-card/70 ring-1 ring-edge">
        <table className="w-full text-[12px]">
          <caption className="sr-only">Actions performed from this app on this machine, newest first</caption>
          <thead>
            <tr className="text-left text-dim text-[10.5px] uppercase tracking-wider border-b border-edge">
              {["Time", "Cluster", "Verb", "Object", "Summary", "Result"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => {
              const key = `${e.ts}|${e.context}|${e.verb}|${e.kind}|${e.namespace}|${e.name}|${i}`;
              const failed = e.result === "error";
              const expanded = open.has(key);
              return (
                <Fragment key={key}>
                  <tr className="border-b border-edge-raw/70 last:border-b-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <time dateTime={e.ts} title={new Date(e.ts).toUTCString()} className="text-mute">
                        {relativeTime(e.ts)}
                        <span className="sr-only"> ({new Date(e.ts).toUTCString()})</span>
                      </time>
                    </td>
                    <td className="px-3 py-2"><Chip context={e.context} /></td>
                    <td className="px-3 py-2 mono text-[11.5px] text-ink whitespace-nowrap">{e.verb}</td>
                    <td className="px-3 py-2 mono text-[11.5px] text-ink break-all">
                      <span className="text-dim">{journalKind(e.kind)}</span> {e.namespace ? `${e.namespace}/` : ""}{e.name}
                    </td>
                    <td className="px-3 py-2 mono text-[11.5px] text-mute wrap-break-word">{e.summary || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {failed ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                          className="inline-flex items-center gap-1 text-bad hover:underline"
                        >
                          {expanded ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                          <span aria-hidden>✕</span> {RESULT_WORD.error}
                        </button>
                      ) : (
                        <span className="text-ok"><span aria-hidden>✓</span> {RESULT_WORD.ok}</span>
                      )}
                    </td>
                  </tr>
                  {failed && expanded && (
                    <tr className="border-b border-edge-raw/70">
                      <td colSpan={6} className="px-3 pb-2 mono text-[11px] text-bad wrap-break-word whitespace-pre-wrap">{e.message || "No message recorded."}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3">
      <div>
        <h1 className="text-[14px] font-semibold tracking-tight">Journal</h1>
        <p className="text-[11.5px] text-mute">Actions performed from this app on this machine</p>
      </div>
      <p className="text-[11.5px] text-dim flex items-start gap-2">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Records what {PRODUCT_NAME} sent, not what the cluster did afterwards. Secret values are never recorded. Writes blocked by
          read-only mode aren't recorded because nothing was sent. Keeps recent entries only, up to about 25 MiB. Older entries are
          deleted automatically.
        </span>
      </p>
      <p className="text-[11.5px] text-dim">{ACCEPTED_TIP}</p>
      {q.data && q.isError && (
        <p className="rounded-lg bg-warn/10 ring-1 ring-warn/30 text-warn text-[11.5px] px-3 py-2">Couldn't refresh the journal: {errMsg}</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-mute">
        <label className="flex items-center gap-1.5">Cluster
          <select className={select} value={filters.context} onChange={(e) => setFilters({ ...filters, context: e.target.value })}>
            <option value="">All</option>
            {opts.contexts.map((c) => <option key={c} value={c}>{getClusterIdentity(c).label || c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">Kind
          <select className={select} value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}>
            <option value="">All</option>
            {opts.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">Result
          <select className={select} value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value as ResultFilter })}>
            <option value="all">All</option>
            <option value="ok">{RESULT_WORD.ok}</option>
            <option value="error">{RESULT_WORD.error}</option>
          </select>
        </label>
        {isFiltered(f) && <span className="text-dim">{shown.length} of {all.length} loaded</span>}
      </div>
      {body}
      {all.length > 0 && (q.hasNextPage ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
            className="h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink disabled:opacity-50"
          >
            {q.isFetchingNextPage ? "Loading…" : "Load older"}
          </button>
        </div>
      ) : (
        <p className="text-center text-[11.5px] text-dim">End of journal. Older entries are deleted automatically.</p>
      ))}
    </div>
  );
}
