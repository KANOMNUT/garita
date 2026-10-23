import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import type { Pod } from "../types/k8s";
import { startLogStream, useNodes } from "../hooks/useResources";
import { useBoundedLines } from "../hooks/useBoundedLines";
import { MAX_LOG_LINES } from "../utils/logBuffer";
import { parseLogLine, type ParsedLogLine } from "../utils/logParse";
import { clearFilters, compileFilters, filteredEmptyText, matchPosition, matchSeqs, passesFilters, pruneToPresent, stepMatch, type LogViewState } from "../utils/logFilter";
import { EXPAND_CAP_NOTICE, expandDropsOldest, toggleExpanded } from "../utils/logJson";
import { downloadText, multiFilename } from "../utils/logDownload";
import { capNotice, facetOptions, hasZoneLabels, noPodsMatchText, placePods, podsButtonLabel, selectStreamingPods } from "../utils/multiPods";
import { crossesMidnight, loadLogPrefs, podTagLabel, podTags, rangeKey, rangePhrase, resolveRange, saveLogPrefs, type LogZone, type RangeSpec } from "../utils/logSource";
import { anyStreaming, emptyLogsText, endedStripText, idleText, streamStatusText, summarizePodStreams, type PodStream } from "../utils/podStreams";
import { isModalOpen } from "../utils/modalLayer";
import { Popover } from "./Popover";
import { LogSourceBar } from "./LogSourceBar";
import { LogViewBar } from "./LogViewBar";
import { LogLine } from "./LogLine";
import { PRODUCT_NAME } from "../brand";

const POD_TAG_CLASSES = ["text-series-1", "text-series-2", "text-series-3", "text-series-4", "text-series-5", "text-series-6"];
function hashIndex(text: string, mod: number): number { let hash = 0; for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0; return Math.abs(hash) % mod; }
function saveLog(content: string, filename: string): void { const url = URL.createObjectURL(new Blob([content], { type: "text/plain" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }
function reloadText(range: RangeSpec, pods: number): string { const phrase = rangePhrase(range); return range.id === "lines200" || range.id === "lines5000" ? `Reloading ${pods} pods: ${phrase}…` : `Reloading ${pods} pods from ${phrase}…`; }
function streamMessage(stream: PodStream | undefined): string { return stream?.kind === "error" || stream?.kind === "start_error" ? stream.message : ""; }

interface MultiLine { seq: number; pod: string; line: ParsedLogLine }
interface MultiLogViewerProps {
  context: string;
  namespace: string;
  pods: Pod[];
  container?: string;
  view: LogViewState;
  onViewChange: Dispatch<SetStateAction<LogViewState>>;
}

export function MultiLogViewer({ context, namespace, pods, container, view, onViewChange }: MultiLogViewerProps) {
  const { data: nodes = [] } = useNodes(context);
  const placement = useMemo(() => placePods(pods, nodes), [pods, nodes]);
  const narrowed = useMemo(() => selectStreamingPods(pods, placement, { node: view.narrowNode, zone: view.narrowZone }), [pods, placement, view.narrowNode, view.narrowZone]);
  const matchingPods = narrowed.matching;
  const activePods = narrowed.active;
  const podsKey = activePods.map((pod) => pod.name).sort().join(",");
  const containerNames = useMemo(() => {
    const names: string[] = [];
    for (const pod of activePods) for (const candidate of pod.containers) if (!candidate.is_init && !names.includes(candidate.name)) names.push(candidate.name);
    return names;
  }, [activePods]);
  const containerNamesKey = containerNames.join(",");
  const [selectedContainer, setSelectedContainer] = useState(container ?? "");
  const [prefs] = useState(() => loadLogPrefs("multi"));
  const [range, setRange] = useState<RangeSpec>(prefs.range);
  const [timestamps, setTimestamps] = useState(prefs.timestamps);
  const [zone, setZone] = useState<LogZone>(prefs.zone);
  const [follow, setFollow] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [podStreams, setPodStreams] = useState<Record<string, PodStream>>({});
  const [showWhich, setShowWhich] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [podsOpen, setPodsOpen] = useState(false);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [activeMatch, setActiveMatch] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seqRef = useRef(0);
  const includeRef = useRef<HTMLInputElement>(null);
  const podsTriggerRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const reconnectRef = useRef<((names: readonly string[]) => void) | null>(null);
  const { lines, dropped, push, clear, removeWhere } = useBoundedLines<MultiLine>();
  const rKey = rangeKey(range);

  useEffect(() => { saveLogPrefs("multi", { range, timestamps, zone }); }, [range, timestamps, zone]);
  useEffect(() => {
    if (container) { setSelectedContainer(container); return; }
    if (selectedContainer && containerNames.includes(selectedContainer)) return;
    setSelectedContainer(containerNames[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, containerNamesKey]);

  useEffect(() => {
    if (!selectedContainer || !podsKey) {
      setPodStreams({});
      seqRef.current = 0; clear(); setExpanded([]); setActiveMatch(null); setReloading(false);
      return;
    }
    seqRef.current = 0; clear(); setExpanded([]); setActiveMatch(null); setReloading(true);
    const initial: Record<string, PodStream> = {}; for (const pod of activePods) initial[pod.name] = { kind: "streaming" }; setPodStreams(initial);
    const settle = window.setTimeout(() => setReloading(false), 2500);
    const { tailLines, sinceSeconds } = resolveRange(range);
    const setStream = (pod: string, next: PodStream) => setPodStreams((old) => ({ ...old, [pod]: next }));
    const open = (pod: string) => startLogStream({ context, namespace, pod, container: selectedContainer, tailLines, sinceSeconds, timestamps }, (event) => {
      switch (event.type) {
        case "line": setReloading(false); push({ seq: seqRef.current++, pod, line: parseLogLine(event.line, timestamps) }); break;
        case "end": setStream(pod, { kind: "ended" }); break;
        case "error": setStream(pod, { kind: "error", message: event.message }); break;
        case "start_error": setStream(pod, { kind: "start_error", message: event.message }); break;
      }
    });
    const stops = new Map<string, () => void>(); for (const pod of activePods) stops.set(pod.name, open(pod.name));
    reconnectRef.current = (names) => {
      const targets = names.filter((name) => stops.has(name)); if (!targets.length) return;
      const targetSet = new Set(targets); for (const name of targets) stops.get(name)?.(); removeWhere((line) => targetSet.has(line.pod));
      setPodStreams((old) => { const next = { ...old }; for (const name of targets) next[name] = { kind: "streaming" }; return next; });
      for (const name of targets) stops.set(name, open(name));
    };
    return () => { window.clearTimeout(settle); reconnectRef.current = null; stops.forEach((stop) => stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, namespace, podsKey, selectedContainer, rKey, timestamps]);

  const hiddenPods = new Set(view.hiddenPods);
  const shownPods = activePods.filter((pod) => !hiddenPods.has(pod.name));
  const filters = useMemo(() => compileFilters(view), [view]);
  const visible = useMemo(() => lines.filter((entry) => !hiddenPods.has(entry.pod) && passesFilters(entry.line, filters)), [lines, hiddenPods, filters]);
  const matches = useMemo(() => matchSeqs(visible, (entry) => entry.line.body, filters.highlight), [visible, filters.highlight]);
  const activePosition = matchPosition(matches, activeMatch);
  useEffect(() => { const present = new Set(lines.map((entry) => entry.seq)); setExpanded((old) => pruneToPresent(old, present)); setActiveMatch((old) => old !== null && !present.has(old) ? null : old); }, [lines]);
  useEffect(() => { if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [visible, follow]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !isModalOpen()) { event.preventDefault(); includeRef.current?.focus(); } }; window.addEventListener("keydown", onKey, true); return () => window.removeEventListener("keydown", onKey, true); }, []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const toggleRow = (seq: number) => {
    if (expandDropsOldest(expanded, seq)) setNotice(EXPAND_CAP_NOTICE);
    setExpanded((old) => toggleExpanded(old, seq));
  };
  const goToMatch = useCallback((direction: 1 | -1) => { const next = stepMatch(matches, activeMatch, direction); if (next === null) return; setActiveMatch(next); setFollow(false); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-log-seq="${next}"]`)?.scrollIntoView({ block: "center" })); }, [matches, activeMatch]);
  const onRegionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => { if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return; if (event.key === "f") { event.preventDefault(); setFollow((old) => !old); } if (event.key === "End") { event.preventDefault(); setFollow(true); if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; } if (event.key === "Enter" && view.highlight) { event.preventDefault(); goToMatch(event.shiftKey ? -1 : 1); } };
  const reconnectPods = useCallback((names: readonly string[]) => reconnectRef.current?.(names), []);
  const tags = useMemo(() => podTags(activePods.map((pod) => pod.name)), [podsKey]);
  const summary = summarizePodStreams(activePods.map((pod) => pod.name), podStreams);
  const shownSummary = summarizePodStreams(shownPods.map((pod) => pod.name), podStreams);
  const failed = activePods.filter((pod) => summary.failed.includes(pod.name));
  const streaming = anyStreaming(shownSummary);
  const idle = idleText(shownSummary);
  const emptyText = emptyLogsText(shownSummary, rangePhrase(range), resolveRange(range).sinceSeconds !== undefined);
  const withDate = timestamps && crossesMidnight(lines[0]?.line.k8sTs, lines[lines.length - 1]?.line.k8sTs, zone);
  const nodeOptions = facetOptions(pods, placement, "node");
  const zoneOptions = facetOptions(pods, placement, "zone");
  const zonesAvailable = hasZoneLabels(pods, placement);
  // UXA-7: each Pods-popover row reads "node · zone · N lines"; an unreadable label says why.
  const lineCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.pod, (m.get(l.pod) ?? 0) + 1);
    return m;
  }, [lines]);
  const labelText = (v: string): ReactNode => v === "unknown" ? <span title={`${PRODUCT_NAME} couldn't read this label.`}>unknown</span> : v;
  const podRowText = (name: string): ReactNode => {
    const place = placement.get(name);
    return <>{labelText(place?.node ?? "unknown")} · {labelText(place?.zone ?? "unknown")} · {lineCounts.get(name) ?? 0} lines</>;
  };
  const cap = capNotice(pods.length, matchingPods.length, view.narrowNode !== null || view.narrowZone !== null);
  const podLabel = podsButtonLabel(activePods.length, pods.length, { node: view.narrowNode, zone: view.narrowZone });
  const containerControl = containerNames.length > 1 && !container ? <select aria-label="Container" value={selectedContainer} onChange={(event) => setSelectedContainer(event.target.value)} className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[11px] mono text-ink"><option value="">Select container</option>{containerNames.map((name) => <option key={name} value={name}>{name}</option>)}</select> : <span className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[11px] mono text-ink flex items-center gap-1">{selectedContainer || "—"}<ChevronDown size={10} /></span>;
  const togglePod = (name: string) => onViewChange((old) => ({ ...old, hiddenPods: old.hiddenPods.includes(name) ? old.hiddenPods.filter((x) => x !== name) : [...old.hiddenPods, name] }));
  const extraChip = view.hiddenPods.length ? <button type="button" onClick={() => onViewChange((old) => ({ ...old, hiddenPods: [] }))} className="mono text-[10px] px-1.5 py-0.5 rounded-sm bg-accent/10 ring-1 ring-accent/20 text-accent">{view.hiddenPods.length} pods hidden ×</button> : null;

  return <div className="flex flex-col h-full">
    <div className="px-4 py-2 border-b border-edge flex flex-col gap-2 shrink-0">
      <LogSourceBar range={range} onRangeChange={setRange} timestamps={timestamps} onTimestampsChange={setTimestamps} zone={zone} onZoneChange={setZone} leading={<><>{containerControl}</><div className="relative"><button ref={podsTriggerRef} type="button" onClick={() => setPodsOpen((old) => !old)} aria-expanded={podsOpen} className="h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono">{podLabel} <ChevronDown size={10} className="inline" /></button><Popover open={podsOpen} onClose={() => setPodsOpen(false)} triggerRef={podsTriggerRef} label="Pods" className="left-0 top-8 w-[min(360px,calc(100vw-3rem))] p-3 flex flex-col gap-2"><div><p className="text-[10px] uppercase tracking-wider text-dim">Narrow which pods stream <span className="normal-case">(reloads)</span></p><div className="mt-1 flex gap-2"><select aria-label="Node" value={view.narrowNode ?? ""} onChange={(event) => onViewChange((old) => ({ ...old, narrowNode: event.target.value || null }))} className="min-w-0 flex-1 h-6 rounded-sm bg-card ring-1 ring-edge text-[10.5px]"><option value="">Any node</option>{nodeOptions.map((option) => <option key={option.value} value={option.value}>{option.value} ({option.count})</option>)}</select>{!zonesAvailable ? <p className="text-[10.5px] text-dim">This cluster has no zone labels.</p> : <select aria-label="Zone" value={view.narrowZone ?? ""} onChange={(event) => onViewChange((old) => ({ ...old, narrowZone: event.target.value || null }))} className="min-w-0 flex-1 h-6 rounded-sm bg-card ring-1 ring-edge text-[10.5px]"><option value="">Any zone</option>{zoneOptions.map((option) => <option key={option.value} value={option.value}>{option.value} ({option.count})</option>)}</select>}</div><p className="mt-1 text-[10px] text-dim">{matchingPods.length} of {pods.length}</p></div><div className="border-t border-edge pt-2"><p className="text-[10px] uppercase tracking-wider text-dim">Show or hide <span className="normal-case">(instant)</span></p>{activePods.length === 0 ? <p className="mt-1 text-[11px] text-dim">{noPodsMatchText({ node: view.narrowNode, zone: view.narrowZone })}</p> : <div className="mt-1 max-h-40 overflow-auto">{activePods.map((pod) => <label key={pod.name} className="flex items-center gap-2 py-1 text-[11px] text-mute"><input type="checkbox" checked={!hiddenPods.has(pod.name)} onChange={() => togglePod(pod.name)} /><span className="mono truncate" title={pod.name}>{podTagLabel(pod.name, tags[pod.name] ?? pod.name)}</span><span className="ml-auto text-dim">{podRowText(pod.name)}{summary.ended.includes(pod.name) ? " · ended" : summary.failed.includes(pod.name) ? " · couldn't be tailed" : ""}</span></label>)}</div>}<button type="button" onClick={() => onViewChange((old) => ({ ...old, hiddenPods: [] }))} className="mt-1 text-[10.5px] text-accent hover:underline">Show all</button></div></Popover></div></>} />
      <LogViewBar lines={lines} visibleCount={visible.length} view={view} setView={onViewChange} includeRef={includeRef} activeMatch={activePosition} notice={notice} onEscapeEmpty={() => logRef.current?.focus()} onStepMatch={goToMatch} status={reloading ? reloadText(range, activePods.length) : streamStatusText(shownSummary, follow)} extraChips={extraChip}
        onDownload={(filtered) => saveLog(downloadText((filtered ? visible : lines).map((entry) => ({ pod: entry.pod, raw: entry.line.raw }))), multiFilename(namespace, selectedContainer, activePods.length, filtered))}
        trailing={<button type="button" onClick={() => setFollow((old) => !old)} className={`mono text-[10.5px] px-1.5 py-0.5 rounded-sm ring-1 ${follow ? "bg-accent/20 text-accent ring-accent/40" : "text-dim ring-edge hover:text-ink"}`}>follow</button>} />
    </div>
    <div role="status" aria-live="polite" className="sr-only">{reloading ? reloadText(range, activePods.length) : streamStatusText(shownSummary, follow)}{activePosition ? `. Match ${activePosition.index} of ${activePosition.total}` : ""}</div>
    {cap && <div className="px-4 py-1.5 border-b border-edge shrink-0 text-[11px] text-warn">{cap}</div>}
    {reloading && <div className="px-4 py-1.5 bg-accent/6 border-b border-accent/20 flex items-center gap-2 shrink-0 text-[11px] text-mute"><Loader2 size={11} className="animate-spin shrink-0" />{reloadText(range, activePods.length)}</div>}
    {failed.length > 0 && <div role="alert" className="px-4 py-1.5 bg-warn/6 border-b border-warn/20 shrink-0 text-[11px] text-warn"><div className="flex items-center gap-2"><span>Tailing {activePods.length - failed.length} of {activePods.length} pods. {failed.length} could not be tailed.</span><button type="button" onClick={() => setShowWhich((old) => !old)} className="ml-auto text-mute hover:text-ink mono">{showWhich ? "Hide" : "Show which"}</button><button type="button" onClick={() => reconnectPods(summary.failed)} className="text-mute hover:text-ink mono">Retry</button></div>{showWhich && <ul className="mt-1 mono text-[10.5px]">{failed.map((pod) => <li key={pod.name}>{podTagLabel(pod.name, tags[pod.name] ?? pod.name)}: {streamMessage(podStreams[pod.name])}</li>)}</ul>}</div>}
    {summary.ended.length > 0 && <div className="px-4 py-1.5 bg-warn/6 border-b border-warn/20 shrink-0 text-[11px] text-warn"><div className="flex items-center gap-2"><span>{endedStripText(summary)}</span><button type="button" onClick={() => setShowEnded((old) => !old)} className="ml-auto text-mute hover:text-ink mono">{showEnded ? "Hide" : "Show which"}</button><button type="button" onClick={() => reconnectPods(summary.ended)} className="text-mute hover:text-ink mono">Reconnect</button></div>{showEnded && <ul className="mt-1 mono text-[10.5px]">{summary.ended.map((name) => <li key={name}>{podTagLabel(name, tags[name] ?? name)}</li>)}</ul>}</div>}
    {dropped > 0 && <div className="px-4 py-1.5 border-b border-edge shrink-0 text-[11px] text-mute">Showing most recent {MAX_LOG_LINES.toLocaleString()} lines. {dropped.toLocaleString()} older lines dropped while following.</div>}
    <div ref={logRef} onScroll={() => { const el = logRef.current; if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }} onKeyDown={onRegionKeyDown} tabIndex={0} role="region" aria-label={`Logs for container ${selectedContainer}`} className="flex-1 overflow-auto p-3 bg-surface-sunken focus:outline-hidden focus-visible:ring-1 focus-visible:ring-accent/40"><div className={`mono text-[11px] leading-[1.55] ${view.wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}>
      {activePods.length === 0 && (
        <div className="flex flex-col items-start gap-1.5 text-dim">
          {pods.length === 0 ? (
            <><p className="text-[12px]">No pods to tail.</p><p className="text-[11px]">This workload has no running pods.</p></>
          ) : (
            <><p className="text-[12px]">{noPodsMatchText({ node: view.narrowNode, zone: view.narrowZone })}</p>
              <button type="button" onClick={() => onViewChange((old) => ({ ...old, narrowNode: null, narrowZone: null }))} className="h-5 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink">Clear narrowing</button></>
          )}
        </div>
      )}
      {activePods.length > 0 && visible.length === 0 && !reloading && <span className="text-dim">{shownPods.length === 0 && activePods.length > 0 ? <>All pods are hidden. <button type="button" onClick={() => onViewChange((old) => ({ ...old, hiddenPods: [] }))} className="text-accent hover:underline">Show all</button></> : lines.length ? <>{filteredEmptyText(lines.length)}<button type="button" onClick={() => onViewChange((v) => clearFilters(v))} className="ml-2 text-accent hover:underline">Clear filters</button></> : emptyText}</span>}
      {visible.map((entry) => <LogLine key={entry.seq} seq={entry.seq} line={entry.line} timestamps={timestamps} zone={zone} withDate={withDate} include={filters.include} highlight={filters.highlight} jsonView={view.json} expanded={expanded.includes(entry.seq)} onToggleExpanded={() => toggleRow(entry.seq)} activeMatch={activeMatch === entry.seq} prefix={<span className={`shrink-0 ${POD_TAG_CLASSES[hashIndex(entry.pod, POD_TAG_CLASSES.length)]}`} title={entry.pod} aria-label={`pod ${tags[entry.pod] ?? entry.pod}`}>{podTagLabel(entry.pod, tags[entry.pod] ?? entry.pod)}</span>} />)}
      {follow && streaming && <div className="mt-2 text-dim flex items-center gap-2 text-[10.5px]"><span className="h-1.5 w-1.5 rounded-full bg-ok animate-blink" />Following</div>}{idle && <div className="mt-2 text-dim text-[10.5px]">{idle}</div>}
    </div></div>
  </div>;
}
