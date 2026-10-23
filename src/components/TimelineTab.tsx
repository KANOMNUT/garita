import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, Info } from "lucide-react";
import type { ArgoCdHistoryEntry, ResourceType } from "../types/k8s";
import { OBJECT_JOURNAL_LIMIT, useHelmHistory, useObjectJournal, useResourceEvents, useRolloutHistory } from "../hooks/useResources";
import { relativeTime } from "../utils/journal";
import { groupByDay, mergeTimeline, parseTs, type TimelineEntry, type TimelineSource } from "../utils/timeline";
import { clock, StaleStrip } from "./health/StaleStrip";

// #17 Timeline tab (docs/ux/06 §5). Reads the sources the panel already has, merges them, and says what it is not.
// Read only. The retention line is verbatim and shows in every state.

const RETENTION = "Events are kept about 1 hour; ReplicaSet, Helm and ArgoCD history go back further. This is not a full audit log.";
const REVISIONS = "StatefulSet and DaemonSet revisions aren't included.";
const PAGE = 100;
const UNKNOWN_COLLAPSE = 20;
const JOURNAL_TIP = "Actions performed from this app on this machine. Times use this computer's clock.";
const CHIP: Record<TimelineSource, string> = { event: "Event", rollout: "Rollout", helm: "Helm", argocd: "ArgoCD", journal: "From this app" };
const SEV = { info: { glyph: "●", word: "" }, warning: { glyph: "▲", word: "Warning" }, failed: { glyph: "✕", word: "Failed" } } as const;
const SEV_TONE = { info: "text-mute", warning: "text-status-warn", failed: "text-status-bad" } as const;
const EMPTY: never[] = [];
const msg = (e: unknown) => (e as any)?.message ?? String(e);
const btn = "min-h-6 px-2 rounded-sm text-[11.5px] text-accent hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-accent/60 outline-hidden";

export type TimelineTarget = "Events" | "History" | "Overview";
interface Props {
  context: string;
  namespace: string;
  name: string;
  kind: ResourceType;
  /** "Deployment" etc., for the empty state. */
  kindLabel: string;
  /** Kind filter for the Events query (the panel's EVENT_INVOLVED_KIND). */
  eventsKind: string | null;
  /** The ArgoCD app's own `status.history`; undefined for other kinds. Keep the reference stable. */
  argocdHistory?: ArgoCdHistoryEntry[];
  /** The panel shows this tab: sources are read only then. */
  active: boolean;
  onShowTab: (t: TimelineTarget) => void;
  /** "Show in Journal"; omitted when the host has no Journal route for it. */
  onOpenJournal?: (name: string) => void;
}

export function TimelineTab({ context, namespace, name, kind, kindLabel, eventsKind, argocdHistory, active, onShowTab, onOpenJournal }: Props) {
  const events = useResourceEvents(context, namespace, name, active, eventsKind);
  const rollout = useRolloutHistory(context, namespace, name, active && kind === "deploy");
  const helm = useHelmHistory(context, namespace, name, active && kind === "helm");
  const journal = useObjectJournal(context, namespace, name, active);

  // The sources this kind has (UX 5.3), in chip order.
  type Src = { id: TimelineSource; label: string; stale: boolean; q: { isPending: boolean; error: unknown; dataUpdatedAt: number; refetch: () => unknown } };
  // A failed refetch that still has data is "stale", not a missing source.
  const src = (id: TimelineSource, label: string, q: { isPending: boolean; error: unknown; isRefetchError: boolean; dataUpdatedAt: number; refetch: () => unknown }): Src =>
    ({ id, label, stale: q.isRefetchError, q: { isPending: q.isPending, error: q.isRefetchError ? null : q.error, dataUpdatedAt: q.dataUpdatedAt, refetch: q.refetch } });
  const sources: Src[] = [];
  if (kind === "deploy") sources.push(src("rollout", "rollouts", rollout));
  if (kind === "helm") sources.push(src("helm", "Helm history", helm));
  // The ArgoCD app's history comes with the panel's own data, so this source is always settled and never fails.
  if (kind === "argocd") sources.push({ id: "argocd", label: "ArgoCD history", stale: false, q: { isPending: false, error: null, dataUpdatedAt: 0, refetch: () => undefined } });
  sources.push(src("event", "events", events), src("journal", "entries from this app", journal));

  const settled = sources.every((s) => !s.q.isPending);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (settled || !active) { setWaited(false); return; }
    const t = window.setTimeout(() => setWaited(true), 4000);
    return () => window.clearTimeout(t);
  }, [settled, active]);

  const entries = useMemo(
    () => mergeTimeline({
      kind,
      events: events.data ?? EMPTY,
      revisions: rollout.data ?? EMPTY,
      helm: helm.data ?? EMPTY,
      argocd: argocdHistory ?? EMPTY,
      journal: journal.data ?? EMPTY,
    }),
    [kind, events.data, rollout.data, helm.data, argocdHistory, journal.data],
  );
  const failed = sources.filter((s) => s.q.error);
  const allFailed = failed.length === sources.length;
  const counts = useMemo(() => {
    const c: Partial<Record<TimelineSource, number>> = {};
    for (const e of entries) c[e.source] = (c[e.source] ?? 0) + 1;
    return c;
  }, [entries]);

  const scope = `${context}/${namespace}/${kind}/${name}`;
  const [off, setOff] = useState<ReadonlySet<TimelineSource>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [unknownOpen, setUnknownOpen] = useState(false);
  const [showWhich, setShowWhich] = useState(false);
  const [rove, setRove] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const focusNew = useRef<string | null>(null);
  useEffect(() => { setOff(new Set()); setLimit(PAGE); setOpen(new Set()); setRove(null); setUnknownOpen(false); }, [scope]);

  const filtered = useMemo(() => entries.filter((e) => !off.has(e.source)), [entries, off]);
  const shown = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const groups = useMemo(() => groupByDay(shown, Date.now()), [shown]);
  const ids = useMemo(() => shown.map((e) => e.id), [shown]);
  const idsKey = ids.join("\n");

  // Roving focus: the row id survives a refetch; if it is gone the next one takes over (UX 5.7).
  const prevIds = useRef<string[]>([]);
  const titles = useRef(new Map<string, string>());
  const offSig = useRef("");
  useEffect(() => {
    const sig = [...off].sort().join();
    const filterChanged = offSig.current !== sig; // a chip toggle is the user's doing, not a removal
    offSig.current = sig;
    const prev = prevIds.current;
    prevIds.current = ids;
    const was = titles.current;
    titles.current = new Map(shown.map((e) => [e.id, e.title]));
    if (rove && !ids.includes(rove)) {
      const i = prev.indexOf(rove);
      const next = [...prev.slice(i + 1), ...prev.slice(0, Math.max(i, 0)).reverse()].find((x) => ids.includes(x)) ?? null;
      setRove(next);
      if (!filterChanged) setAnnouncement(`Removed from the timeline: ${was.get(rove) ?? rove}.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // "Show 100 more" keeps focus on the first new entry.
  useEffect(() => {
    const id = focusNew.current;
    if (!id) return;
    focusNew.current = null;
    setRove(id);
    listRef.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(id)}"]`)?.focus();
  }, [limit]);

  const announced = useRef("");
  useEffect(() => {
    if (!active || !settled || allFailed) return;
    if (announced.current === scope) return;
    announced.current = scope;
    setAnnouncement(`Timeline loaded. ${entries.length} entries.`);
  }, [active, settled, allFailed, scope, entries.length]);

  const updatedAt = Math.max(0, ...sources.map((s) => s.q.dataUpdatedAt));
  const cur = rove && ids.includes(rove) ? rove : ids[0] ?? null;
  const toggle = (set: ReadonlySet<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const target = (e: TimelineEntry): TimelineTarget | "Journal" => (e.source === "event" ? "Events" : e.source === "rollout" ? "Overview" : e.source === "journal" ? "Journal" : "History");
  const follow = (e: TimelineEntry) => { const t = target(e); if (t === "Journal") onOpenJournal?.(name); else onShowTab(t); };
  const canFollow = (e: TimelineEntry) => target(e) !== "Journal" || !!onOpenJournal;

  const onRowKey = (ev: KeyboardEvent<HTMLElement>, e: TimelineEntry, i: number) => {
    if (ev.target !== ev.currentTarget) return; // keys inside the row's own buttons stay theirs
    let go: string | undefined;
    if (ev.key === "ArrowDown") go = ids[i + 1];
    else if (ev.key === "ArrowUp") go = ids[i - 1];
    else if (ev.key === "Home") go = ids[0];
    else if (ev.key === "End") go = ids[ids.length - 1];
    else if (ev.key === "ArrowRight") setOpen((o) => new Set(o).add(e.id));
    else if (ev.key === "ArrowLeft") setOpen((o) => { const n = new Set(o); n.delete(e.id); return n; });
    else if (ev.key === " ") setOpen((o) => toggle(o, e.id));
    else if (ev.key === "Enter") { if (canFollow(e)) follow(e); }
    else return;
    ev.preventDefault();
    if (go) { setRove(go); listRef.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(go)}"]`)?.focus(); }
  };

  const header = (
    <>
      <div className="flex items-baseline gap-2">
        <h3 className="text-[13px] font-semibold text-ink flex-1">Timeline</h3>
        {updatedAt > 0 && <span className="text-[11px] text-mute">Updated {clock(updatedAt)}</span>}
      </div>
      <p className="text-[11.5px] text-mute">{RETENTION}</p>
      {(kind === "sts" || kind === "ds") && <p className="text-[11.5px] text-mute">{REVISIONS}</p>}
    </>
  );

  let body: React.ReactNode;
  if (!settled && !waited) {
    body = (
      <div role="status" className="flex flex-col gap-2">
        <span className="text-[12px] text-mute">Loading timeline…</span>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} aria-hidden className="h-12 rounded-lg bg-surface-tint/4 motion-safe:animate-pulse" />)}
      </div>
    );
  } else if (settled && allFailed) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <p className="flex items-center gap-1.5 text-[12px] text-ink"><AlertCircle size={14} aria-hidden /> Couldn&apos;t load the timeline.</p>
        <p className="text-[11.5px] text-mute">{msg(failed[0].q.error)}</p>
        <button type="button" className={btn} onClick={() => failed.forEach((s) => void s.q.refetch())}>Retry</button>
      </div>
    );
  } else {
    const pending = sources.filter((s) => s.q.isPending);
    body = (
      <>
        {sources.some((s) => s.stale) && <StaleStrip at={updatedAt} />}
        {!settled && <p role="status" className="text-[11.5px] text-mute">Still loading {pending.map((s) => s.label).join(", ")}…</p>}
        {failed.length > 0 && (
          <div className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <Info size={13} className="text-info mt-0.5 shrink-0" aria-hidden />
              <p className="flex-1">
                Partially shown. Couldn&apos;t read {failed.map((s) => s.label).join(", ")}{failed.length === 1 ? ` (${msg(failed[0].q.error)})` : ""}. Showing{" "}
                {sources.filter((s) => !s.q.error).map((s) => s.label).join(" and ")}.
              </p>
              <button type="button" aria-expanded={showWhich} onClick={() => setShowWhich((v) => !v)} className="text-mute hover:text-ink shrink-0">Show which</button>
            </div>
            {showWhich && <ul className="pl-5 text-mute">{failed.map((s) => <li key={s.id}>{s.label}: {msg(s.q.error)}</li>)}</ul>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-mute">Show:</span>
          {sources.map((s) => {
            const bad = !!s.q.error;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={!off.has(s.id)}
                aria-disabled={bad || undefined}
                title={bad ? msg(s.q.error) : s.id === "journal" ? JOURNAL_TIP : undefined}
                onClick={() => { if (!bad) setOff((o) => toggle(o, s.id) as ReadonlySet<TimelineSource>); }}
                className={`min-h-6 px-2 rounded-lg text-[11.5px] ring-1 ring-edge flex items-center gap-1.5 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${off.has(s.id) ? "text-mute" : "bg-surface-tint/6 text-ink"}`}
              >
                {CHIP[s.id]} <span className="mono tabular-nums">{bad ? "–" : counts[s.id] ?? 0}</span>
                {bad && <span className="sr-only">. {msg(s.q.error)}</span>}
              </button>
            );
          })}
        </div>
        {(journal.data?.length ?? 0) >= OBJECT_JOURNAL_LIMIT && <p className="text-[11.5px] text-mute">Showing the latest {OBJECT_JOURNAL_LIMIT} actions from this app.</p>}
        {entries.length === 0 ? (
          <p className="text-[12px] text-mute">
            {failed.length
              ? `No timeline entries for ${kindLabel} "${name}" in what could be read.`
              : `No timeline entries for ${kindLabel} "${name}". Events from more than about an hour ago aren't kept.`}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[12px] text-mute">Every source is turned off. Turn one back on to see entries.</p>
        ) : (
          <div ref={listRef} className="flex flex-col gap-3">
            <p className="text-[11px] text-mute">Showing {shown.length} of {filtered.length}</p>
            {groups.map((g) => {
              const collapsed = g.heading === "Time unknown" && g.entries.length > UNKNOWN_COLLAPSE && !unknownOpen;
              return (
                <section key={g.heading} aria-label={g.heading}>
                  <h4 className="text-[10.5px] uppercase tracking-wider text-mute mb-1">{g.heading}</h4>
                  {g.heading === "Time unknown" && <p className="text-[11px] text-mute mb-1">These entries have no timestamp. Their order isn&apos;t meaningful.</p>}
                  {collapsed ? (
                    <button type="button" className={btn} onClick={() => setUnknownOpen(true)}>Show {g.entries.length} entries</button>
                  ) : (
                    <ul className="rounded-xl bg-card/70 ring-1 ring-edge divide-y divide-edge">
                      {g.entries.map((e) => {
                        const i = ids.indexOf(e.id);
                        const sev = SEV[e.severity];
                        const t = parseTs(e.ts);
                        const isOpen = open.has(e.id);
                        const mine = e.id === cur;
                        return (
                          <li
                            key={e.id}
                            data-entry={e.id}
                            aria-posinset={i + 1}
                            aria-setsize={ids.length}
                            tabIndex={mine ? 0 : -1}
                            onFocus={(ev) => { if (ev.target === ev.currentTarget) setRove(e.id); }}
                            onKeyDown={(ev) => onRowKey(ev, e, i)}
                            className="px-3 py-2 text-[11.5px] flex flex-col gap-1 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={SEV_TONE[e.severity]}><span aria-hidden>{sev.glyph}</span>{sev.word && <span className="text-ink"> {sev.word}</span>}</span>
                              {t === null ? (
                                <span className="text-mute">—</span>
                              ) : (
                                <time dateTime={e.ts} title={`${new Date(t).toLocaleString()} (${new Date(t).toISOString()})`} className="text-mute">{relativeTime(new Date(t).toISOString())}</time>
                              )}
                              <span title={e.source === "journal" ? JOURNAL_TIP : undefined} className="px-1.5 py-px rounded-sm bg-surface-tint/6 ring-1 ring-edge text-ink">{CHIP[e.source]}</span>
                              <span className="text-ink font-medium">{e.title}</span>
                            </div>
                            {e.detail && <p className="text-mute whitespace-pre-wrap wrap-break-word">{e.detail}</p>}
                            {isOpen && (
                              <dl className="text-mute">
                                <dt className="inline">Id: </dt><dd className="inline mono break-all">{e.id}</dd>
                                {e.ts && <><br /><dt className="inline">Time: </dt><dd className="inline mono">{e.ts}</dd></>}
                                {e.source === "journal" && <><br /><dd>{JOURNAL_TIP}</dd></>}
                              </dl>
                            )}
                            <div className="flex items-center gap-3">
                              <button type="button" tabIndex={mine ? 0 : -1} aria-expanded={isOpen} className={btn} onClick={() => setOpen((o) => toggle(o, e.id))}>{isOpen ? "▾" : "▸"} Details</button>
                              {canFollow(e) && (
                                <button type="button" tabIndex={mine ? 0 : -1} className={btn} onClick={() => follow(e)}>
                                  Show in {target(e) === "Overview" ? "Overview" : target(e)}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
            {filtered.length > shown.length && (
              <button
                type="button"
                className={`${btn} self-start`}
                onClick={() => { focusNew.current = filtered[limit]?.id ?? null; setLimit((l) => l + PAGE); }}
              >
                Show {Math.min(PAGE, filtered.length - shown.length)} more
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      {header}
      {body}
    </div>
  );
}
