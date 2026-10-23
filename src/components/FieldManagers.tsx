import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useResourceJson } from "../hooks/useResources";
import { classifyReadError } from "../utils/resourceCompare";
import {
  agoText, findFields, HONESTY_LINE, INTRO_LINE, NO_DATA_DETAIL, NO_DATA_TITLE, parseManagedFields, PATHS_SHOWN,
} from "../utils/managedFields";

// #7 field managers (docs/ux/03 §5): a collapsible Summary-tab section, read-only. Reads the
// raw object with get_resource_json (managedFields is present: that command filters nothing).
// Manager names are shown verbatim. Wording: "field managers", "last set by", "wrote" — never
// server-side-apply vocabulary, and never a hint that the user can change who manages a field.

interface Props {
  context: string;
  namespace: string;
  kind: string;
  kindLabel: string;
  name: string;
  /** Bumped by a "See field managers" link elsewhere: opens the section. */
  openNonce?: number;
}

export function FieldManagers({ context, namespace, kind, kindLabel, name, openNonce = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  useEffect(() => { if (openNonce > 0) setOpen(true); }, [openNonce]);

  const q = useResourceJson(context, namespace, kind, name, open);
  const entries = useMemo(() => parseManagedFields(q.data), [q.data]);
  const hits = useMemo(() => findFields(entries, find), [entries, find]);
  const err = q.isError ? ((q.error as any)?.message ?? String(q.error)) : "";
  const denied = err && classifyReadError(err) === "no-access";
  const keyOf = (e: { manager: string; operation: string; subresource: string | null }) => `${e.manager}|${e.operation}|${e.subresource ?? ""}`;

  return (
    <section id="field-managers" className="mx-4 mb-4 rounded-xl bg-card/70 ring-1 ring-edge hairline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-[11px] uppercase tracking-wider text-dim font-semibold hover:text-ink"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Field managers{q.data ? ` (${entries.length})` : ""}
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <p className="text-[11px] text-dim">{INTRO_LINE}</p>

          {q.isLoading && (
            <div role="status" className="flex flex-col gap-1.5">
              <span className="sr-only">Loading field managers.</span>
              {[0, 1, 2].map((i) => <div key={i} className="h-7 rounded-sm bg-surface-tint/5 motion-safe:animate-pulse" />)}
            </div>
          )}

          {err && (
            <div role="alert" className="text-[12px] text-mute flex flex-col gap-1.5">
              <p>
                {denied
                  ? `You don't have access to ${kindLabel}s${namespace ? ` in ${namespace}` : ""}. Your account can't get this resource. Ask a cluster admin for the get permission.`
                  : `Couldn't load field managers: ${err}.`}
              </p>
              <button type="button" onClick={() => void q.refetch()} className="self-start px-2 py-1 rounded-md text-[11.5px] ring-1 ring-edge hover:text-ink">Retry</button>
            </div>
          )}

          {q.data && entries.length === 0 && (
            <div className="text-[12px] text-mute">
              <p className="text-ink">{NO_DATA_TITLE}</p>
              <p className="text-dim">{NO_DATA_DETAIL}</p>
            </div>
          )}

          {entries.length > 0 && (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-dim">
                Find a field
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  spellCheck={false}
                  className="h-7 px-2 rounded-sm bg-card/80 ring-1 ring-edge mono text-[11px] text-ink focus:outline-hidden focus:ring-accent/40"
                />
              </label>

              {find.trim() !== "" ? (
                <div role="status" className="flex flex-col gap-1">
                  <p className="text-[11.5px] text-mute">
                    {hits.length === 0 ? `No field matches "${find.trim()}".` : `${hits.length} match${hits.length === 1 ? "" : "es"}`}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {hits.map((h, i) => (
                      <li key={`${h.path}-${h.manager}-${i}`} className="text-[11px]">
                        <span className="mono text-ink break-all">{h.path}</span>
                        <span className="text-dim"> last set by </span>
                        <span className="mono text-mute">{h.manager}</span>
                        <span className="text-dim" title={h.time ?? undefined}> ({agoText(h.time)})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {entries.map((e) => {
                    const k = keyOf(e);
                    const isOpen = expanded === k;
                    const all = showAll.has(k);
                    const shown = all ? e.paths : e.paths.slice(0, PATHS_SHOWN);
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : k)}
                          aria-expanded={isOpen}
                          aria-label={`${e.manager}, ${e.operation}, ${agoText(e.time)}, ${e.paths.length} fields, ${isOpen ? "expanded" : "collapsed"}`}
                          className="w-full text-left rounded-md px-2 py-1.5 hover:bg-surface-tint/4"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="mono text-[11.5px] text-ink break-all flex-1">{e.manager}</span>
                            {isOpen ? <ChevronDown size={11} className="text-dim" /> : <ChevronRight size={11} className="text-dim" />}
                          </span>
                          <span className="block text-[10.5px] text-dim" title={e.time ?? undefined}>
                            {e.operation} · {agoText(e.time)} · {e.paths.length} field{e.paths.length === 1 ? "" : "s"}
                          </span>
                          {e.subresource && <span className="block text-[10.5px] text-dim">{e.subresource} (subresource)</span>}
                        </button>
                        {isOpen && (
                          <div className="pl-4 pr-2 pb-1">
                            <ul className="flex flex-col gap-0.5">
                              {shown.map((p) => <li key={p} className="mono text-[10.5px] text-mute break-all">{p}</li>)}
                            </ul>
                            {!all && e.paths.length > PATHS_SHOWN && (
                              <button
                                type="button"
                                onClick={() => setShowAll((s) => new Set(s).add(k))}
                                className="mt-1 text-[10.5px] text-accent hover:underline"
                              >
                                … {e.paths.length - PATHS_SHOWN} more · Show all
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[10.5px] text-dim">{HONESTY_LINE}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
