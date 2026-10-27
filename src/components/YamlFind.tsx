import { Fragment, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { disabledAttrs } from "../utils/guardrails";
import type { Range } from "../utils/logFilter";
import { isModalOpen } from "../utils/modalLayer";
import { isMacUserAgent } from "../utils/platform";
import { stepIndex } from "../utils/segmented";
import {
  FIND_CAP, MIRROR_TAIL, findCountText, findStatusText, firstAtOrAfter, lineOf, prefillFrom, scrollTopFor,
  shortcutMatches, yamlMatches, yamlSegments,
} from "../utils/yamlFind";

// YAML find (v2.3.1; docs/ux/22-v2.3.1-search-and-filter.md section 4, docs/impl/v2.3.1-tasks.md 3.3 and 3.3.1).
// One component for the three YAML views (generic YAML tab, Pod YAML tab, Helm Values tab).
//
// Secret rules (docs/claude/writes.md, Secret values in the webview):
//  S1 the find reads ONLY the `text` prop, the string the view renders, never a query cache or another variant;
//  S2 its state lives in this component, and the caller keys it on identity (plus the reveal flag), so Hide,
//     a selection change and a panel close unmount it;
//  S3 the query is never persisted, sent or logged: component state only;
//  S4 announcements carry counts and positions, never the query.
//
// Esc and Cmd/Ctrl+F are handled by the root element's React onKeyDown only: no window-level listener,
// no modal layer. A modal open anywhere (isModalOpen) makes the view ignore keys.

const IS_MAC = typeof navigator !== "undefined" && isMacUserAgent(navigator.userAgent);

/**
 * Every class that affects text layout. The textarea and the edit-view mirror both use exactly this
 * string, so they wrap and measure alike. Nothing else on either element may set font, size, line height,
 * letter spacing, padding, border, white space, wrapping or tab size. Fallback if a webview misaligns the
 * mirror (approved by the user): swap `whitespace-pre-wrap wrap-break-word` for `whitespace-pre` here and
 * give the textarea `wrap="off"`.
 */
const EDITOR_TEXT = "mono text-[11px] leading-[1.6] p-3 whitespace-pre-wrap wrap-break-word [tab-size:8]";

const MARK_CLASS = {
  read: {
    match: "rounded-[2px] bg-log-match text-inherit",
    current: "rounded-[2px] bg-log-highlight text-inherit underline decoration-2 underline-offset-2 scroll-mt-14",
  },
  // Transparent text: the textarea above paints the real text. The underline needs its own colour.
  mirror: {
    match: "rounded-[2px] bg-log-match text-transparent",
    current: "rounded-[2px] bg-log-highlight text-transparent underline decoration-2 underline-offset-2 decoration-ink",
  },
} as const;

const SMALL_BTN =
  "h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] mono text-mute hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden";
const ICON_BTN =
  "h-6 w-6 shrink-0 grid place-items-center rounded-sm text-mute hover:text-ink hover:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden";

const NO_MATCHES = { ranges: [] as Range[], more: false };

export interface YamlFindProps {
  /** Exactly the string the view renders (S1): shownYaml, the edit buffer, or the shown Helm text. */
  text: string;
  /** Copy: "Find in YAML" / "Find in values". */
  noun: "YAML" | "values";
  /** Name of the read region: "Deployment api YAML", "Pod api-7d9 YAML", "my-release values". */
  regionLabel: string;
  /** Edit view: the textarea renders `text` and reports changes; null = read view (<pre> with marks). */
  edit: { onChange: (value: string) => void; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void } | null;
  /** Shown on the hint line when the query has no matches: the Neat hint with "Search full object", or the redaction hint. */
  noMatchHint?: { text: string; action?: { label: string; run: () => void } } | null;
  /** Layout stays with the caller: findButton first in its toolbar, bar between its notes and `content`. */
  children: (parts: { findButton: ReactNode; bar: ReactNode; content: ReactNode }) => ReactNode;
}

/** `text` with the matches drawn as <mark>. Read view: real marks. Edit view: the transparent mirror. */
function Marks({ text, ranges, current, kind }: { text: string; ranges: readonly Range[]; current: number | null; kind: "read" | "mirror" }) {
  const segs = useMemo(() => yamlSegments(text, ranges, current), [text, ranges, current]);
  const cls = MARK_CLASS[kind];
  return (
    <>
      {segs.map((s, i) => s.mark === "none"
        ? <Fragment key={i}>{s.text}</Fragment>
        : s.mark === "current"
          ? <mark key={i} data-current="" className={cls.current}>{s.text}</mark>
          : <mark key={i} className={cls.match}>{s.text}</mark>)}
    </>
  );
}

/**
 * The edit-view overlay: an aria-hidden copy of the buffer BEHIND the textarea, text transparent, with the
 * matches as coloured backgrounds. The textarea above has a transparent background, so its own text, caret
 * and selection paint over the marks: if the mirror ever drifts, only a mark background sits off its word.
 * ponytail: the mirror holds a second, transparent copy of the whole buffer with no virtualisation. If typing
 * lags on very large objects, render only the slice around the visible lines.
 */
function Mirror({ vpRef, size, text, ranges, current }: {
  vpRef: RefObject<HTMLDivElement>; size: { w: number; h: number };
  text: string; ranges: readonly Range[]; current: number | null;
}) {
  return (
    <div
      ref={vpRef}
      aria-hidden="true"
      className="absolute left-0 top-0 overflow-hidden pointer-events-none select-none"
      style={{ width: size.w, height: size.h }}
    >
      <div className={`relative ${EDITOR_TEXT} text-transparent`}>
        <Marks text={text} ranges={ranges} current={current} kind="mirror" />
        {MIRROR_TAIL}
      </div>
    </div>
  );
}

export function YamlFind({ text, noun, regionLabel, edit, noMatchHint, children }: YamlFindProps) {
  const isEdit = edit !== null;
  const barId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const mirrorVpRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wantReveal = useRef(false);
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // idx: current match. anchor: until the first step or edit, the current match is the first one at or after this offset.
  const [nav, setNav] = useState<{ idx: number; anchor: number | null }>({ idx: 0, anchor: null });
  const [focusTick, setFocusTick] = useState(0);
  const [status, setStatus] = useState("");
  const [mirrorSize, setMirrorSize] = useState({ w: 0, h: 0 });

  const blank = text.trim() === "";
  // Read view with nothing to show: no find control, Cmd/Ctrl+F inert. The edit view always has one.
  const available = isEdit || !blank;
  const active = open && available;

  const deferredQuery = useDeferredValue(query);
  const found = useMemo(() => (active ? yamlMatches(text, deferredQuery) : NO_MATCHES), [active, text, deferredQuery]);
  const ranges = found.ranges;
  const total = ranges.length;
  const current = total === 0 ? null : nav.anchor !== null ? (firstAtOrAfter(ranges, nav.anchor) ?? 0) : Math.min(nav.idx, total - 1);
  const line = useMemo(
    () => (isEdit && current !== null ? lineOf(text, ranges[current].start) : null),
    [isEdit, text, ranges, current],
  );

  // The mirror renders from deferred values so typing in the textarea stays at the textarea's speed.
  const view = useMemo(() => ({ text, ranges }), [text, ranges]);
  const mirrorView = useDeferredValue(view);
  const mirrorCurrent = current === null || mirrorView.ranges.length === 0 ? null : Math.min(current, mirrorView.ranges.length - 1);
  // measuring: the edit bar is open, so the textarea's size is tracked (before the mirror mounts, so it never lays out at 0 px wide).
  const measuring = isEdit && active;
  const showMirror = measuring && total > 0 && mirrorSize.w > 0;

  const caretNow = () => (isEdit ? taRef.current?.selectionStart ?? 0 : 0);

  const openBar = () => {
    if (!available) return;
    let prefill: string | null = null;
    if (isEdit) {
      const ta = taRef.current;
      if (ta && document.activeElement === ta) prefill = prefillFrom(ta.value.slice(ta.selectionStart, ta.selectionEnd));
    } else {
      const sel = window.getSelection();
      const pre = preRef.current;
      if (sel && pre && sel.rangeCount > 0 && pre.contains(sel.anchorNode) && pre.contains(sel.focusNode)) prefill = prefillFrom(sel.toString());
    }
    if (!open) {
      const ae = document.activeElement;
      openerRef.current = ae instanceof HTMLElement && ae !== document.body && rootRef.current?.contains(ae) ? ae : null;
    }
    if (prefill !== null) setQuery(prefill);
    if (!open || prefill !== null) {
      wantReveal.current = true;
      setNav({ idx: 0, anchor: caretNow() });
    }
    setOpen(true);
    setFocusTick((t) => t + 1);
  };

  const closeBar = () => {
    const ta = taRef.current;
    // The current match becomes the textarea selection, so the user can type the new value at once.
    if (isEdit && ta && current !== null) {
      try { ta.setSelectionRange(ranges[current].start, ranges[current].end); } catch { /* a detached textarea */ }
    }
    wantReveal.current = false;
    setOpen(false);
    setStatus("");
    const opener = openerRef.current;
    const target = opener && opener.isConnected && rootRef.current?.contains(opener) ? opener : (isEdit ? ta : preRef.current) ?? btnRef.current;
    target?.focus({ preventScroll: true });
  };

  const step = (dir: 1 | -1) => {
    if (total === 0 || current === null) return;
    const next = stepIndex(ranges, current, dir);
    const wrapped = dir === 1 ? next <= current : next >= current;
    if (countTimer.current) clearTimeout(countTimer.current);
    wantReveal.current = true;
    setNav({ idx: next, anchor: null });
    setStatus(findStatusText("step", next, total, found.more, isEdit ? lineOf(text, ranges[next].start) : undefined, wrapped));
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    wantReveal.current = true;
    setNav({ idx: 0, anchor: caretNow() });
  };

  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isModalOpen()) return;
    // DOM containment, not React: a modal rendered from this tree bubbles its keys through React.
    if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) return;
    const composing = e.nativeEvent.isComposing;
    if (shortcutMatches({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: composing }, IS_MAC)) {
      if (!available) return;
      e.preventDefault();
      openBar();
      return;
    }
    if (e.key === "Escape" && active && !composing) {
      e.preventDefault();
      e.stopPropagation(); // the detail panel stays open: Esc closes only the topmost layer
      closeBar();
    }
  };

  // Focus and select the input on each open request.
  useEffect(() => {
    if (focusTick === 0) return;
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, [focusTick]);

  // Live region: counts once after typing pauses (500 ms); steps are announced by step().
  const latest = useRef({ total: 0, more: false });
  latest.current = { total, more: found.more };
  useEffect(() => {
    if (countTimer.current) clearTimeout(countTimer.current);
    if (!active || deferredQuery.trim() === "") { setStatus(""); return; }
    countTimer.current = setTimeout(() => setStatus(findStatusText("count", null, latest.current.total, latest.current.more)), 500);
    return () => { if (countTimer.current) clearTimeout(countTimer.current); };
  }, [active, deferredQuery]);

  const syncScroll = () => {
    const ta = taRef.current;
    const vp = mirrorVpRef.current;
    if (ta && vp) { vp.scrollTop = ta.scrollTop; vp.scrollLeft = ta.scrollLeft; }
  };

  // Size the mirror like the textarea's content box (clientWidth and clientHeight exclude a scrollbar, so lines
  // wrap at the same width). Measured here, in the parent, because a parent's layout effect runs after the
  // textarea's ref is attached. The observer lives only while the edit bar is open and is disconnected on cleanup.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!measuring || !ta) return;
    const measure = () => setMirrorSize((m) => (m.w === ta.clientWidth && m.h === ta.clientHeight ? m : { w: ta.clientWidth, h: ta.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(ta);
    return () => ro.disconnect();
  }, [measuring]);
  // Same scroll position after the mirror mounts and after its content or size changes.
  useLayoutEffect(() => { if (showMirror) syncScroll(); }, [showMirror, mirrorView, mirrorCurrent, mirrorSize]);

  // Reveal the current match after a step, an open or a query change; never after typing in the buffer.
  useLayoutEffect(() => {
    if (!wantReveal.current) return;
    if (!active) { wantReveal.current = false; return; }
    if (deferredQuery !== query) return; // the matches have not caught up with the input yet
    if (total === 0 || current === null) { wantReveal.current = false; return; }
    if (isEdit) {
      const ta = taRef.current;
      const vp = mirrorVpRef.current;
      const mark = vp?.querySelector<HTMLElement>("mark[data-current]");
      if (!ta || !vp || !mark) return; // the mirror has not rendered the new matches yet: retry when it does
      if (mirrorSize.w !== ta.clientWidth || mirrorSize.h !== ta.clientHeight) return; // not sized yet: lines would wrap wrongly
      const cs = getComputedStyle(ta);
      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
      ta.scrollTop = scrollTopFor(mark.offsetTop, lineHeight, ta.scrollTop, ta.clientHeight);
      vp.scrollTop = ta.scrollTop;
      vp.scrollLeft = ta.scrollLeft;
      ta.scrollIntoView({ block: "nearest" }); // the outer tab scroller; never a mirror mark
    } else {
      preRef.current?.querySelector<HTMLElement>("mark[data-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    wantReveal.current = false;
  }, [nav, found, mirrorView, mirrorSize, deferredQuery, query, active, isEdit, total, current]);


  const shortcutName = IS_MAC ? "⌘F" : "Ctrl+F";
  const findButton = available ? (
    <button
      ref={btnRef}
      type="button"
      onClick={() => (open ? closeBar() : openBar())}
      aria-label={`Find in ${noun}`}
      aria-expanded={open}
      aria-controls={active ? barId : undefined}
      aria-keyshortcuts={IS_MAC ? "Meta+F" : "Control+F"}
      title={`Find in ${noun} (${shortcutName})`}
      className={isEdit ? `${ICON_BTN} ring-1 ring-edge bg-card/80` : `${SMALL_BTN} flex items-center gap-1`}
    >
      <Search size={12} aria-hidden="true" />
      {!isEdit && "find"}
    </button>
  ) : null;

  const countText = findCountText(deferredQuery, isEdit && blank, current, total, found.more);
  const queryBlank = deferredQuery.trim() === "";
  const stepReason = total > 0 ? undefined : queryBlank ? "Type to search." : "No matches.";
  const showHint = !!noMatchHint && !queryBlank && total === 0 && !blank;

  const bar = active ? (
    <div
      id={barId}
      role="search"
      aria-label={`Find in ${noun}`}
      className="sticky top-0 z-10 -mx-3 px-3 py-1.5 bg-surface-panel border-b border-edge flex flex-col gap-1"
    >
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0" title={found.more ? `More than ${FIND_CAP} matches. Showing the first ${FIND_CAP}.` : undefined}>
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label={`Find in ${noun}`}
            placeholder={`Find in ${noun}`}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
            }}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className={`h-7 w-full min-w-0 rounded-md bg-surface-input ring-1 ring-edge focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden pl-2 ${countText.length > 12 ? "pr-32" : "pr-24"} text-[12px] mono text-ink placeholder:text-mute`}
          />
          <span
            aria-hidden="true"
            className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[11px] mono tabular-nums ${countText === "No matches" ? "text-warn" : "text-mute"}`}
          >
            {countText}
          </span>
        </div>
        {line !== null && <span className="text-[11px] mono text-mute shrink-0">Line {line}</span>}
        <button
          type="button"
          aria-label="Previous match"
          onClick={() => { if (!stepReason) step(-1); }}
          {...(stepReason ? disabledAttrs(stepReason) : { title: "Previous match (Shift+Enter)" })}
          className={`${ICON_BTN} ${stepReason ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <ChevronUp size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next match"
          onClick={() => { if (!stepReason) step(1); }}
          {...(stepReason ? disabledAttrs(stepReason) : { title: "Next match (Enter)" })}
          className={`${ICON_BTN} ${stepReason ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Close find" title="Close find (Esc)" onClick={closeBar} className={ICON_BTN}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {showHint && noMatchHint && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-mute">
          <span>{noMatchHint.text}</span>
          {noMatchHint.action && (
            <button
              type="button"
              onClick={() => { noMatchHint.action?.run(); inputRef.current?.focus(); }}
              className={SMALL_BTN}
            >
              {noMatchHint.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  ) : null;

  const marked = active && total > 0;
  const content = edit ? (
    <div className="relative rounded-lg bg-surface-sunken">
      {showMirror && (
        <Mirror vpRef={mirrorVpRef} size={mirrorSize} text={mirrorView.text} ranges={mirrorView.ranges} current={mirrorCurrent} />
      )}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          // Editing ends "first match after the caret": keep the match the user is on.
          if (nav.anchor !== null) setNav({ idx: current ?? 0, anchor: null });
          edit.onChange(e.target.value);
        }}
        onKeyDown={edit.onKeyDown}
        onScroll={syncScroll}
        wrap="soft"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        className={`relative block w-full ${EDITOR_TEXT} text-ink bg-transparent rounded-lg ring-1 ring-accent/40 resize-none focus:outline-hidden min-h-[60vh] scroll-mt-14`}
      />
    </div>
  ) : (
    <pre
      ref={preRef}
      tabIndex={0}
      role="region"
      aria-label={regionLabel}
      className="mono text-[11px] leading-[1.6] rounded-lg p-3 ring-1 ring-edge overflow-auto bg-surface-sunken focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden"
    >
      {marked ? <Marks text={text} ranges={ranges} current={current} kind="read" /> : text}
    </pre>
  );

  return (
    <div ref={rootRef} onKeyDown={onRootKeyDown} className="flex flex-col gap-2 min-w-0">
      <div role="status" aria-live="polite" className="sr-only">{status}</div>
      {children({ findButton, bar, content })}
    </div>
  );
}
