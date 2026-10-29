import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type ReactNode, type SetStateAction } from "react";
import { Download, ChevronDown } from "lucide-react";
import type { LogLevel, ParsedLogLine } from "../utils/logParse";
import {
  ALL_LEVELS, LEVEL_GLYPH, LEVEL_LETTER, LEVEL_WORD, activeChips, clearFilters, compileFilters,
  countText, filtersCount, isFiltering, levelCounts, removeChip, toggleLevel, type LogViewState,
} from "../utils/logFilter";
import { downloadMenuItems } from "../utils/logDownload";
import { Popover } from "./Popover";
import { PRODUCT_NAME } from "../brand";

interface ViewLine {
  seq: number;
  line: ParsedLogLine;
}

interface LogViewBarProps {
  lines: readonly ViewLine[];
  visibleCount: number;
  view: LogViewState;
  setView: Dispatch<SetStateAction<LogViewState>>;
  includeRef: RefObject<HTMLInputElement | null>;
  activeMatch: { index: number; total: number } | null;
  onStepMatch: (direction: 1 | -1) => void;
  onDownload: (visible: boolean) => void;
  trailing?: ReactNode;
  extraChips?: ReactNode;
  /** The visible status word (Following / Paused / Stream ended …). */
  status?: string;
  /** A transient notice line (e.g. the JSON expand cap). */
  notice?: string | null;
  /** Esc in an EMPTY toolbar field moves focus to the log region. */
  onEscapeEmpty?: () => void;
}

// The one focus-visible ring of the app's controls (docs/ux/24 X-8: at least 3:1 against the panel in both themes).
const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70";
// A text field: a visible boundary (Q14 A, `ring-mute/70`) and the same ring on focus.
const FIELD = "ring-1 ring-mute/70 focus:outline-hidden focus:ring-2 focus:ring-accent/70";

const levelClass: Record<LogLevel, string> = {
  ERROR: "bg-bad/20 text-bad ring-bad/40",
  WARN: "bg-warn/20 text-warn ring-warn/40",
  INFO: "bg-info/20 text-info ring-info/40",
  DEBUG: "bg-surface-tint/6 text-log-debug ring-edge2",
  none: "bg-surface-tint/8 text-mute ring-edge",
};

function Toggle({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active}
      className={`mono text-[10.5px] px-1.5 py-0.5 rounded-sm ring-1 transition-colors ${FOCUS_RING} ${active ? "bg-accent/20 text-accent ring-accent/30" : "text-mute ring-edge hover:text-ink"}`}>
      {label}
    </button>
  );
}

/** Shared F2 View group. Source stays in each viewer because it changes streams. */
export function LogViewBar({
  lines, visibleCount, view, setView, includeRef, activeMatch, onStepMatch, onDownload, trailing, extraChips, status, notice, onEscapeEmpty,
}: LogViewBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const downloadTriggerRef = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const compiled = useMemo(() => compileFilters(view), [view]);
  const counts = useMemo(() => levelCounts(lines.map((x) => x.line), compiled), [lines, compiled]);
  const filtering = isFiltering(view);
  const invalidRegex = [compiled.include, compiled.exclude, compiled.highlight].some((m) => m?.invalid);
  const chips = activeChips(view, compact);
  const downloadItems = downloadMenuItems(lines.length, visibleCount, filtering || !!extraChips);

  // UXA-1: the visible count changes on every streamed line, so it is plain text. Screen readers
  // get ONE sr-only status, refreshed 800 ms after the filters change (never when lines change).
  const countNow = countText(lines.length, visibleCount, filtering || !!extraChips);
  const countRef = useRef(countNow);
  countRef.current = countNow;
  const [announced, setAnnounced] = useState("");
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    const t = window.setTimeout(() => setAnnounced(countRef.current), 800);
    return () => window.clearTimeout(t);
  }, [view]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 640));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!compact) setFiltersOpen(false);
  }, [compact]);

  const patch = (next: Partial<LogViewState>) => setView((old) => ({ ...old, ...next }));
  const onFieldKey = (key: "include" | "exclude" | "highlight") => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (view[key]) patch({ [key]: "" });
      else onEscapeEmpty?.();
    }
    if (e.key === "Enter" && key === "highlight" && activeMatch) {
      e.preventDefault();
      onStepMatch(e.shiftKey ? -1 : 1);
    }
  };

  const levelButtons = (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Levels">
      <span className="text-[10.5px] text-mute">Levels</span>
      {ALL_LEVELS.map((level) => {
        const on = !view.hiddenLevels.includes(level);
        return (
          <button key={level} type="button" onClick={() => setView((old) => toggleLevel(old, level))}
            aria-pressed={on} title={`${LEVEL_WORD[level]}: ${counts[level]} lines${on ? "" : " (hidden)"}`}
            className={`mono text-[10.5px] px-1.5 py-0.5 rounded-sm ring-1 transition-colors ${FOCUS_RING} ${on ? levelClass[level] : "text-mute ring-edge hover:text-ink"}`}>
            <span className="mr-1">{LEVEL_GLYPH[level]}</span>
            <span className="hidden sm:inline">{LEVEL_WORD[level]}</span><span className="sm:hidden">{LEVEL_LETTER[level]}</span>
            <span className="ml-1 text-[10.5px] opacity-80">{counts[level]}</span>
          </button>
        );
      })}
    </div>
  );

  const details = (
    <>
      <label className="flex items-center gap-1.5 text-[11px] text-mute">
        Exclude
        <input value={view.exclude} onChange={(e) => patch({ exclude: e.target.value })} onKeyDown={onFieldKey("exclude")}
          placeholder="text or regex" className={`h-6 min-w-0 flex-1 px-2 rounded-sm bg-card/80 mono text-[11px] text-ink placeholder:text-mute ${FIELD}`} />
      </label>
      <label className="flex items-center gap-1.5 text-[11px] text-mute">
        Highlight
        <input value={view.highlight} onChange={(e) => patch({ highlight: e.target.value })} onKeyDown={onFieldKey("highlight")}
          placeholder="text or regex" className={`h-6 min-w-0 flex-1 px-2 rounded-sm bg-card/80 mono text-[11px] text-ink placeholder:text-mute ${FIELD}`} />
        {activeMatch && <span className="mono text-[10.5px] text-mute shrink-0">{activeMatch.index} of {activeMatch.total}</span>}
        {view.highlight && <><button type="button" onClick={() => onStepMatch(-1)} title="Previous match" aria-label="Previous match" className={`text-mute hover:text-ink rounded-xs ${FOCUS_RING}`}>↑</button><button type="button" onClick={() => onStepMatch(1)} title="Next match" aria-label="Next match" className={`text-mute hover:text-ink rounded-xs ${FOCUS_RING}`}>↓</button></>}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle label=".* regex" active={view.regex} onClick={() => patch({ regex: !view.regex })} title="Treat Include, Exclude and Highlight as regular expressions." />
        <Toggle label="Aa case" active={view.caseSensitive} onClick={() => patch({ caseSensitive: !view.caseSensitive })} title="Match case." />
        <Toggle label="{} JSON" active={view.json} onClick={() => patch({ json: !view.json })} title="Show JSON lines as structured rows. Click a row to expand it." />
        <Toggle label="wrap" active={view.wrap} onClick={() => patch({ wrap: !view.wrap })} />
      </div>
      {levelButtons}
      {invalidRegex && <p role="alert" className="text-[10.5px] text-bad">Not a valid regular expression. Matching it as plain text.</p>}
    </>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5 border-t border-edge-raw/60 pt-2" role="group" aria-label="View: filters the lines already loaded">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-mute">
          Include
          <input ref={includeRef as RefObject<HTMLInputElement>} value={view.include} onChange={(e) => patch({ include: e.target.value })} onKeyDown={onFieldKey("include")}
            placeholder="text or regex" className={`h-6 w-32 max-w-[40vw] px-2 rounded-sm bg-card/80 mono text-[11px] text-ink placeholder:text-mute ${FIELD}`} />
        </label>
        {compact ? (
          <div className="relative"><button ref={filterTriggerRef} type="button" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} aria-haspopup="dialog"
            className={`h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink mono ${FOCUS_RING}`}>Filters ({filtersCount(view, true)}) <ChevronDown size={10} aria-hidden className="inline" /></button>
            <Popover open={filtersOpen} onClose={() => setFiltersOpen(false)} triggerRef={filterTriggerRef} label="Filters the lines already loaded" className="left-0 top-8 w-[min(300px,calc(100vw-3rem))] p-3 flex flex-col gap-2">{details}<button type="button" onClick={() => setView((old) => clearFilters(old))} className={`self-end text-[10.5px] text-accent hover:underline rounded-xs ${FOCUS_RING}`}>Clear all</button></Popover>
          </div>
        ) : <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">{details}</div>}
      </div>
      {(chips.length > 0 || extraChips) && <div className="flex flex-wrap items-center gap-1"><span className="text-[10.5px] text-mute">Active:</span>{chips.map((chip) => <button key={chip.id} type="button" onClick={() => setView((old) => removeChip(old, chip.id))} aria-label={`Remove filter: ${chip.label}`} className={`mono text-[10.5px] px-1.5 py-0.5 rounded-sm bg-accent/10 ring-1 ring-accent/20 text-accent hover:bg-accent/20 ${FOCUS_RING}`}>{chip.label} ×</button>)}{extraChips}<button type="button" onClick={() => setView((old) => clearFilters(old))} className={`ml-1 text-[10.5px] text-accent hover:underline rounded-xs ${FOCUS_RING}`}>Clear all</button></div>}
      {notice && <p role="status" className="text-[10.5px] text-mute">{notice}</p>}
      {filtering && <p className="text-[10.5px] text-mute">Filters match the line text, including any JSON. The Kubernetes timestamp isn't searched.</p>}
      <div className="flex items-center gap-2 min-w-0"><span className="mono text-[10.5px] text-mute truncate">{countNow}</span><span role="status" aria-live="polite" className="sr-only">{announced}</span>{status && <span className="mono text-[10.5px] text-mute shrink-0">· {status}</span>}{trailing}<div className="flex-1" />
        <div className="relative"><button ref={downloadTriggerRef} type="button" disabled={lines.length === 0} onClick={() => downloadItems ? setDownloadOpen((v) => !v) : onDownload(false)} aria-haspopup={downloadItems ? "dialog" : undefined} aria-expanded={downloadItems ? downloadOpen : undefined} className={`h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink disabled:opacity-40 flex items-center gap-1 mono ${FOCUS_RING}`} title={`Downloads what ${PRODUCT_NAME} has loaded, not the full log.`}><Download size={11} aria-hidden /> Download {downloadItems && <ChevronDown size={10} aria-hidden />}</button>
          {downloadItems && <Popover open={downloadOpen} onClose={() => setDownloadOpen(false)} triggerRef={downloadTriggerRef} label="Download logs" className="right-0 top-8 w-52 py-1">{downloadItems.map((item) => <button key={item.id} type="button" onClick={() => { onDownload(item.id === "visible"); setDownloadOpen(false); }} className="w-full px-3 py-1.5 text-left text-[11px] text-mute hover:bg-surface-tint/4 hover:text-ink outline-hidden focus-visible:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70">{item.label}</button>)}</Popover>}
        </div>
      </div>
    </div>
  );
}
