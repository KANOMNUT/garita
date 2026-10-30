import { useState, useEffect, useMemo, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import type { Container, ContainerStatus } from "../types/k8s";
import { startLogStream, fetchPodLogs, fetchBackendLogs } from "../hooks/useResources";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { FLAVOUR_LABEL, requestObservabilityDialog, targetKey } from "../utils/observability";
import { disabledAttrs } from "../utils/guardrails";
import { Segmented } from "./health/HealthShell";
import { useBoundedLines } from "../hooks/useBoundedLines";
import { MAX_LOG_LINES } from "../utils/logBuffer";
import { parseLogLine, type ParsedLogLine } from "../utils/logParse";
import { clearFilters, compileFilters, filteredEmptyText, matchPosition, matchSeqs, passesFilters, pruneToPresent, stepMatch, type LogViewState } from "../utils/logFilter";
import { EXPAND_CAP_NOTICE, expandDropsOldest, toggleExpanded } from "../utils/logJson";
import { downloadText, singleFilename } from "../utils/logDownload";
import {
  HISTORY_ALWAYS_TS, HISTORY_CAPPED, HISTORY_NO_FOLLOW, HISTORY_NO_PREVIOUS, HISTORY_OPTIONS, backendRaw, crossesMidnight, historyEmptyText,
  historyFailText, historyLoadingText, historyShownText, historyWindow, loadHistoryRange, loadLogPrefs, rangeKey, rangePhrase, resolveRange,
  saveHistoryRange, saveLogPrefs, type HistoryRangeId, type LogZone, type RangeSpec,
} from "../utils/logSource";
import { logOptionLabel, selectLogContainer } from "../utils/containerSelect";
import { isModalOpen } from "../utils/modalLayer";
import { LogSourceBar } from "./LogSourceBar";
import { LogViewBar } from "./LogViewBar";
import { LogLine } from "./LogLine";

type StreamState = { kind: "streaming" } | { kind: "ended" } | { kind: "error"; message: string } | { kind: "start_error"; message: string };
interface SequencedLine { seq: number; line: ParsedLogLine }

interface LogViewerProps {
  context: string;
  namespace: string;
  podName: string;
  containers: Container[];
  containersStatus?: ContainerStatus[];
  defaultContainer?: string | null;
  pick: string | null;
  onPick: (name: string | null) => void;
  view: LogViewState;
  onViewChange: Dispatch<SetStateAction<LogViewState>>;
}

function reloadText(range: RangeSpec): string {
  const phrase = rangePhrase(range);
  return range.id === "lines200" || range.id === "lines5000" ? `Reloading ${phrase}…` : `Reloading from ${phrase}…`;
}

function saveLog(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function LogViewer({ context, namespace, podName, containers, containersStatus, defaultContainer, pick, onPick, view, onViewChange }: LogViewerProps) {
  const selectable = useMemo(() => ({ containers, containers_status: containersStatus, default_container: defaultContainer }), [containers, containersStatus, defaultContainer]);
  const selection = useMemo(() => selectLogContainer(selectable, Date.now()), [selectable]);
  const selectedContainer = pick !== null && containers.some((c) => c.name === pick) ? pick : selection.container;
  const hintVisible = pick === null && selection.hint !== null;
  const [prefs] = useState(() => loadLogPrefs("single"));
  const [range, setRange] = useState<RangeSpec>(prefs.range);
  const [timestamps, setTimestamps] = useState(prefs.timestamps);
  const [zone, setZone] = useState<LogZone>(prefs.zone);
  const [follow, setFollow] = useState(true);
  const [previous, setPrevious] = useState(() => pick === null && selection.openPrevious);
  const [prevError, setPrevError] = useState("");
  const [stream, setStream] = useState<StreamState>({ kind: "streaming" });
  const [reloading, setReloading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [activeMatch, setActiveMatch] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // History (v2.3.0 #16b): a configured Loki/VictoriaLogs through the service proxy. The control always shows the source on screen.
  const logsT = useClusterIdentity(context).observability?.logs;
  const logsKey = logsT ? `${targetKey(logsT.service)}|${logsT.flavour}|${logsT.labels.namespace}|${logsT.labels.pod}|${logsT.labels.container}` : "";
  // A failure belongs to the pod, container and target it happened for; another pod never shows it.
  const histKey = `${context}/${namespace}/${podName}/${selectedContainer}|${logsKey}`;
  const logsRef = useRef(logsT);
  logsRef.current = logsT;
  const [source, setSource] = useState<"pod" | "history">("pod");
  const [histRange, setHistRange] = useState<HistoryRangeId>(loadHistoryRange);
  const [histErr, setHistErr] = useState<{ key: string; message: string } | null>(null);
  const histFail = histErr && histErr.key === histKey ? histErr.message : null;
  const [histWhy, setHistWhy] = useState(false);
  const [capped, setCapped] = useState(false);
  const hist = source === "history" && !!logsT;
  const flavour = logsT ? FLAVOUR_LABEL[logsT.flavour] : "";
  const seqRef = useRef(0);
  const includeRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const { lines, dropped, push, replace, clear } = useBoundedLines<SequencedLine>();
  const rKey = rangeKey(range);

  useEffect(() => { saveLogPrefs("single", { range, timestamps, zone }); }, [range, timestamps, zone]);

  useEffect(() => {
    if (!selectedContainer || previous || hist) return;
    seqRef.current = 0; clear(); setExpanded([]); setActiveMatch(null); setStream({ kind: "streaming" }); setReloading(true);
    const settle = window.setTimeout(() => setReloading(false), 2000);
    const { tailLines, sinceSeconds } = resolveRange(range);
    const stop = startLogStream({ context, namespace, pod: podName, container: selectedContainer, tailLines, sinceSeconds, timestamps }, (event) => {
      switch (event.type) {
        case "line": setReloading(false); push({ seq: seqRef.current++, line: parseLogLine(event.line, timestamps) }); break;
        case "end": setReloading(false); setStream({ kind: "ended" }); break;
        case "error": setReloading(false); setStream({ kind: "error", message: event.message }); break;
        case "start_error": setReloading(false); setStream({ kind: "start_error", message: event.message }); break;
      }
    });
    return () => { window.clearTimeout(settle); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, namespace, podName, selectedContainer, previous, hist, rKey, timestamps, nonce]);

  useEffect(() => {
    if (!selectedContainer || !previous || hist) return;
    let cancelled = false;
    seqRef.current = 0; clear(); setExpanded([]); setActiveMatch(null); setPrevError(""); setReloading(true);
    const { tailLines, sinceSeconds } = resolveRange(range);
    fetchPodLogs({ context, namespace, pod: podName, container: selectedContainer, tailLines, previous: true, sinceSeconds, timestamps })
      .then((raw) => { if (!cancelled) { replace(raw.split("\n").filter(Boolean).map((text) => ({ seq: seqRef.current++, line: parseLogLine(text, timestamps) }))); setReloading(false); } })
      .catch((error) => { if (!cancelled) { setReloading(false); setPrevError(String((error as any)?.message ?? error).replace("Failed to get logs: ", "")); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, namespace, podName, selectedContainer, previous, hist, rKey, timestamps, nonce]);

  // One request per (source, range, container, target); a late response for an older one is dropped. A failure reverts to the pod log.
  useEffect(() => {
    const target = logsRef.current;
    if (!hist || !selectedContainer || !target) return;
    let cancelled = false;
    seqRef.current = 0; clear(); setExpanded([]); setActiveMatch(null); setHistErr(null); setCapped(false); setReloading(true);
    const { start, end } = historyWindow(histRange, Date.now() / 1000);
    fetchBackendLogs({ context, target, namespace, pod: podName, container: selectedContainer, start, end })
      .then((r) => { if (!cancelled) { replace(r.lines.map((l) => ({ seq: seqRef.current++, line: parseLogLine(backendRaw(l), true) }))); setCapped(r.truncated); setReloading(false); } })
      .catch((error) => { if (!cancelled) { setReloading(false); setHistErr({ key: histKey, message: String((error as any)?.message ?? error) }); setSource("pod"); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, namespace, podName, selectedContainer, hist, histRange, logsKey, nonce]);

  const filters = useMemo(() => compileFilters(view), [view]);
  const visible = useMemo(() => lines.filter((entry) => passesFilters(entry.line, filters)), [lines, filters]);
  const matches = useMemo(() => matchSeqs(visible, (entry) => entry.line.body, filters.highlight), [visible, filters.highlight]);
  const activePosition = matchPosition(matches, activeMatch);
  useEffect(() => {
    const present = new Set(lines.map((entry) => entry.seq));
    setExpanded((old) => pruneToPresent(old, present));
    setActiveMatch((old) => old !== null && !present.has(old) ? null : old);
  }, [lines]);
  useEffect(() => { if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [lines, follow]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !isModalOpen()) { event.preventDefault(); includeRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const toggleRow = (seq: number) => {
    if (expandDropsOldest(expanded, seq)) setNotice(EXPAND_CAP_NOTICE);
    setExpanded((old) => toggleExpanded(old, seq));
  };
  const goToMatch = useCallback((direction: 1 | -1) => {
    const next = stepMatch(matches, activeMatch, direction);
    if (next === null) return;
    setActiveMatch(next); setFollow(false);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-log-seq="${next}"]`)?.scrollIntoView({ block: "center" }));
  }, [matches, activeMatch]);
  const onRegionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "f") { event.preventDefault(); setFollow((old) => !old); }
    if (event.key === "End") { event.preventDefault(); setFollow(true); if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }
    if (event.key === "Enter" && view.highlight) { event.preventDefault(); goToMatch(event.shiftKey ? -1 : 1); }
  };
  const containerControl = containers.length > 1 ? (
    <select aria-label="Container" value={selectedContainer} onChange={(event) => onPick(event.target.value)} className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-mute/70 text-[11px] mono text-ink focus:outline-hidden focus:ring-2 focus:ring-accent/70">
      {containers.map((container) => <option key={container.name} value={container.name}>{logOptionLabel(selectable, container, selection)}</option>)}
    </select>
  ) : <span className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[11px] mono text-ink flex items-center gap-1">{containers[0]?.is_init ? "[init] " : ""}{selectedContainer} <ChevronDown size={10} /></span>;
  const liveStatus = hist ? "" : reloading ? reloadText(range) : stream.kind === "ended" ? "Stream ended" : stream.kind === "error" || stream.kind === "start_error" ? "Log stream failed" : follow && !previous ? "Following" : "Paused";
  const nothingLoaded = lines.length === 0 && !reloading;
  const timeRange = resolveRange(range).sinceSeconds !== undefined;
  const showTs = timestamps || hist; // History lines always carry a timestamp
  const withDate = showTs && crossesMidnight(lines[0]?.line.k8sTs, lines[lines.length - 1]?.line.k8sTs, zone);
  const pickSource = (v: "pod" | "history") => {
    setHistErr(null); setHistWhy(false);
    if (v === "history") setPrevious(false);
    setSource(v);
  };
  const sourceControl = logsT ? (
    <Segmented<"pod" | "history"> label="Log source" value={hist ? "history" : "pod"} options={[["pod", "Pod log"], ["history", "History"]] as const} onChange={pickSource} />
  ) : null;
  const noHistory = !logsT && (
    <span className="text-[10.5px] text-mute flex items-center gap-1.5">Log history isn't set up for this cluster.
      <button type="button" onClick={() => requestObservabilityDialog(context)} className="text-accent hover:underline inline-flex items-center min-h-6 px-2 rounded-sm focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden">Configure…</button>
    </span>
  );
  const prevReason = hist ? HISTORY_NO_PREVIOUS : undefined;
  const followReason = hist ? HISTORY_NO_FOLLOW : undefined;
  const startErrorWaiting = stream.kind === "start_error" && /waiting/i.test(stream.message);

  return <div className="flex flex-col h-full">
    <div className="px-4 py-2 border-b border-edge flex flex-col gap-2 shrink-0">
      <LogSourceBar range={hist ? { id: histRange } : range} onRangeChange={(r) => (hist ? (setHistRange(r.id as HistoryRangeId), saveHistoryRange(r.id as HistoryRangeId)) : setRange(r))} rangeOptions={hist ? HISTORY_OPTIONS : undefined}
        timestamps={timestamps} onTimestampsChange={setTimestamps} timestampsLockedReason={hist ? HISTORY_ALWAYS_TS : undefined} zone={zone} onZoneChange={setZone} leading={<>{sourceControl}{containerControl}</>}
        trailing={<>{noHistory}<button type="button" onClick={() => { if (!prevReason) setPrevious((old) => !old); }} aria-pressed={previous} {...disabledAttrs(prevReason)} className={`text-[10.5px] px-1.5 py-0.5 rounded-sm ring-1 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${previous ? "bg-warn/15 text-warn ring-warn/30" : "text-mute ring-edge hover:text-ink"}`}>{previous && <span aria-hidden>◀ </span>}Previous</button></>} />
      <LogViewBar lines={lines} visibleCount={visible.length} view={view} setView={onViewChange} includeRef={includeRef} activeMatch={activePosition} notice={notice} onEscapeEmpty={() => logRef.current?.focus()} onStepMatch={goToMatch} status={liveStatus}
        onDownload={(filtered) => saveLog(downloadText((filtered ? visible : lines).map((entry) => ({ raw: entry.line.raw }))), singleFilename(podName, selectedContainer, previous, filtered))}
        trailing={<button type="button" onClick={() => { if (!followReason) setFollow((old) => !old); }} aria-pressed={follow && !previous && !hist} {...disabledAttrs(followReason)} className={`text-[10.5px] px-1.5 py-0.5 rounded-sm ring-1 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${follow && !previous && !hist ? "bg-accent/20 text-accent ring-accent/30" : "text-mute ring-edge hover:text-ink"}`}>Follow</button>} />
    </div>
    <div role="status" aria-live="polite" className="sr-only">{liveStatus}{activePosition ? `. Match ${activePosition.index} of ${activePosition.total}` : ""}</div>
    {hintVisible && <div className="px-4 py-1.5 border-b border-edge flex items-center gap-2 shrink-0 text-[11px] text-mute"><span className="min-w-0 truncate">{selection.hint}</span>{selection.alternative && <button type="button" onClick={() => onPick(selection.alternative!)} className="ml-auto shrink-0 h-5 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">Use “{selection.alternative}”</button>}</div>}
    {histFail !== null && !hist && <div role="status" className="px-4 py-1.5 bg-info/10 border-b border-info/30 flex flex-col gap-1 shrink-0 text-[11px] text-ink"><div className="flex items-center gap-2"><span>{historyFailText(histFail, logsT?.service.namespace ?? "")}</span><span className="ml-auto flex gap-3 shrink-0"><button type="button" onClick={() => pickSource("history")} className="text-mute hover:text-ink inline-flex items-center min-h-6 px-2 rounded-sm focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden">Retry</button><button type="button" aria-expanded={histWhy} onClick={() => setHistWhy((v) => !v)} className="text-mute hover:text-ink inline-flex items-center min-h-6 px-2 rounded-sm focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden">Why?</button></span></div>{histWhy && <p className="mono break-words text-mute">{histFail}</p>}</div>}
    {hist && !reloading && <div role="status" className="px-4 py-1.5 border-b border-edge flex items-center gap-2 shrink-0 text-[11px] text-mute"><span>{historyShownText(flavour, histRange)}{capped ? ` ${HISTORY_CAPPED}` : ""}</span><button type="button" onClick={() => setNonce((n) => n + 1)} className="ml-auto text-mute hover:text-ink inline-flex items-center min-h-6 px-2 rounded-sm focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden">Reload</button></div>}
    {reloading && <div className="px-4 py-1.5 bg-accent/6 border-b border-accent/20 flex items-center gap-2 shrink-0 text-[11px] text-mute"><Loader2 size={11} className="animate-spin shrink-0" />{hist ? historyLoadingText(flavour) : reloadText(range)}</div>}
    {previous && <div className="px-4 py-1.5 bg-warn/6 border-b border-warn/20 flex items-center gap-2 shrink-0"><span className="text-[11px] text-warn">{selection.previousHint ?? "Showing logs from previous container instance"}</span><button type="button" onClick={() => setPrevious(false)} className="ml-auto text-[10.5px] text-mute hover:text-ink rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">Show current</button></div>}
    {dropped > 0 && <div className="px-4 py-1.5 border-b border-edge shrink-0 text-[11px] text-mute">Showing most recent {MAX_LOG_LINES.toLocaleString()} lines. {dropped.toLocaleString()} older lines dropped while following.</div>}
    {!previous && !hist && stream.kind === "ended" && <div className="px-4 py-1.5 bg-warn/6 border-b border-warn/20 flex items-center gap-2 shrink-0 text-[11px] text-warn"><span>Stream ended. Container stopped or connection dropped.</span><button type="button" onClick={() => setNonce((n) => n + 1)} className="ml-auto text-mute hover:text-ink rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">Reconnect</button></div>}
    {!previous && !hist && stream.kind === "error" && <div role="alert" className="px-4 py-2 bg-bad/6 border-b border-bad/20 flex items-start gap-2 shrink-0 text-[11px] text-bad"><span className="mono break-all min-w-0">{stream.message}</span><button type="button" onClick={() => setNonce((n) => n + 1)} className="ml-auto text-mute hover:text-ink rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70">Reconnect</button></div>}
    {previous && prevError && <div className="px-4 py-3 text-center text-[12px] text-bad mono">{prevError}</div>}
    {!previous && !hist && stream.kind === "start_error" && <div role="alert" className="px-4 py-3 flex flex-col items-center gap-1.5 text-center"><p className="text-[12px] text-bad mono break-all">{stream.message}</p>{startErrorWaiting && <p className="text-[11px] text-mute">Container “{selectedContainer}” has not started yet. Logs appear once it runs.</p>}<button type="button" onClick={() => setNonce((n) => n + 1)} className="h-6 px-2.5 rounded-sm bg-card/80 ring-1 ring-edge text-[11px] text-mute hover:text-ink">Retry</button></div>}
    <div ref={logRef} onScroll={() => { const el = logRef.current; if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }} onKeyDown={onRegionKeyDown} tabIndex={0} role="region" aria-label={`Logs for container ${selectedContainer}`} className="flex-1 overflow-auto p-3 bg-surface-sunken focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70">
      <div className={`mono text-[11px] leading-[1.55] ${view.wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}>
        {visible.length === 0 && !prevError && (hist || stream.kind !== "start_error") && !reloading && <span className="text-mute">{nothingLoaded && hist ? historyEmptyText(flavour, histRange) : nothingLoaded && timeRange && !previous ? `No log lines in ${rangePhrase(range)}.` : lines.length ? <>{filteredEmptyText(lines.length)}<button type="button" onClick={() => onViewChange((v) => clearFilters(v))} className="ml-2 text-accent hover:underline">Clear filters</button></> : "No log lines"}</span>}
        {nothingLoaded && timeRange && !previous && !hist && stream.kind === "streaming" && <div className="mt-2 flex gap-2"><button type="button" onClick={() => setRange({ id: "h1" })} className="h-5 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute">Widen to 1 hour</button><button type="button" onClick={() => setRange({ id: "lines5000" })} className="h-5 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute">Up to 5,000 lines</button></div>}
        {visible.map((entry) => <LogLine key={entry.seq} seq={entry.seq} line={entry.line} timestamps={showTs} zone={zone} withDate={withDate} include={filters.include} highlight={filters.highlight} jsonView={view.json} expanded={expanded.includes(entry.seq)} onToggleExpanded={() => toggleRow(entry.seq)} activeMatch={activeMatch === entry.seq} />)}
        {follow && !previous && !hist && stream.kind === "streaming" && <div className="mt-2 text-mute flex items-center gap-2 text-[10.5px]"><span className="h-1.5 w-1.5 rounded-full bg-ok animate-blink" />Following</div>}
      </div>
    </div>
  </div>;
}
