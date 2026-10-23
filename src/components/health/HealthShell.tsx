import { useCallback, useEffect, useRef, type RefObject } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { clock } from "./StaleStrip";
import { disabledAttrs } from "../../utils/guardrails";
import { stepIndex } from "../../utils/segmented";

// HEALTH-SHELL (07 P6): the pieces Problems, Possibly unused and Deprecated APIs share. Extracted from
// ProblemsPage as a mechanical move; nothing here is generalised beyond what those pages use.

/**
 * Focus must not fall to <body> when the control a keyboard user just used unmounts (a chip, a too-many block).
 * `request()` is called by the handler; when `trigger` then changes within a second, focus moves to `preferred`
 * (a selector inside `root`, e.g. the Name select) or else the page heading.
 */
export function useRefocus(root: RefObject<HTMLElement | null>, trigger: string, preferred: string | null): () => void {
  const until = useRef(0);
  useEffect(() => {
    if (Date.now() > until.current) return;
    until.current = 0;
    const r = root.current;
    // Only when focus was lost (body) or is still on this page: never take it from the TopBar or a panel.
    const a = document.activeElement;
    if (a && a !== document.body && !r?.contains(a)) return;
    const h = r?.querySelector<HTMLElement>("h1");
    if (h) h.tabIndex = -1;
    (preferred ? r?.querySelector<HTMLElement>(preferred) : null)?.focus();
    if (!preferred || !r?.querySelector(preferred)) h?.focus();
  }, [trigger]);
  return useCallback(() => { until.current = Date.now() + 1000; }, []);
}

// A mode switch swaps the whole tree, so the radio that had focus unmounts; the next mount takes focus back.
let pendingSeg: { label: string; until: number } | null = null;

/** A radio group with roving arrows (one tab stop). `remounts`: choosing swaps the tree, so focus is restored on the next mount. */
export function Segmented<T extends string>({ label, value, options, onChange, remounts = false, className = "" }: {
  label: string;
  value: T;
  /** A third element disables that option with a visible-to-AT reason. Arrows step onto it (focus only); it is never picked. */
  options: readonly (readonly [T, string, string?])[];
  onChange: (v: T) => void;
  remounts?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pendingSeg || pendingSeg.label !== label || Date.now() > pendingSeg.until) return;
    pendingSeg = null;
    ref.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
  }, []);
  const pick = (v: T) => {
    if (options.find(([o]) => o === v)?.[2]) return;
    if (remounts) pendingSeg = { label, until: Date.now() + 1000 };
    onChange(v);
    if (!remounts) ref.current?.querySelector<HTMLElement>(`[data-v="${v}"]`)?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    // One step from the focused option (it may be a disabled one), else from the checked one.
    const at = (document.activeElement as HTMLElement | null)?.dataset?.v;
    const from = options.findIndex(([v]) => v === at);
    const [v, , reason] = options[stepIndex(options, from >= 0 ? from : options.findIndex(([o]) => o === value), step)];
    if (reason) ref.current?.querySelector<HTMLElement>(`[data-v="${v}"]`)?.focus();
    else pick(v);
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKey} className={`inline-flex rounded-md ring-1 ring-edge overflow-hidden ${className}`}>
      {options.map(([v, text, reason]) => (
        <button
          key={v}
          type="button"
          role="radio"
          data-v={v}
          aria-checked={value === v}
          tabIndex={value === v ? 0 : -1}
          onClick={() => pick(v)}
          {...disabledAttrs(reason)}
          className={`min-h-6 px-2.5 text-[11.5px] focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden ${value === v ? "bg-accent/12 text-ink" : "text-mute hover:text-ink"} ${reason ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Block({ icon, title, body, children }: { icon: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card/70 ring-1 ring-edge flex flex-col items-center gap-3 text-center px-6 py-14">
      <div className="text-dim">{icon}</div>
      <p className="text-[13px] text-mute">{title}</p>
      {body && <p className="text-[11.5px] text-mute max-w-md whitespace-pre-wrap">{body}</p>}
      {children}
    </div>
  );
}

/** Title, scope line, "Checked HH:MM:SS" and the optional disclosure toggle. */
export function PageHeader({ title, subtitle, checkedAt, toggle }: {
  title: string;
  subtitle: string;
  /** `dataUpdatedAt` of the report, omitted until there is one. */
  checkedAt?: number;
  toggle?: { label: string; open: boolean; onToggle: () => void };
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <h1 className="text-[14px] font-semibold tracking-tight">{title}</h1>
        <p className="text-[11.5px] text-mute">{subtitle}</p>
      </div>
      {checkedAt !== undefined && <span className="text-[11.5px] text-mute shrink-0">Checked {clock(checkedAt)}</span>}
      {toggle && (
        <button
          type="button"
          aria-expanded={toggle.open}
          onClick={toggle.onToggle}
          className="inline-flex items-center gap-1 min-h-6 px-1.5 rounded-sm text-[11.5px] text-mute hover:text-ink hover:bg-surface-tint/4 shrink-0"
        >
          {toggle.label} <ChevronDown size={12} aria-hidden className={toggle.open ? "rotate-180" : ""} />
        </button>
      )}
    </div>
  );
}

/** The "Partially visible" strip: one sentence and a Show which disclosure. */
export function PartialStrip({ children, which, open, onToggle, toggleLabel = "Show which", actions, live }: {
  children: React.ReactNode;
  which: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Label of the disclosure button ("Why?" for the metrics fallback strip). */
  toggleLabel?: string;
  /** Buttons before the disclosure toggle (Retry). */
  actions?: React.ReactNode;
  /** Polite live region: information that can appear or change in the background. */
  live?: boolean;
}) {
  return (
    <div role={live ? "status" : undefined} className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <Info size={13} className="text-info mt-0.5 shrink-0" aria-hidden />
        <p className="flex-1">{children}</p>
        {actions}
        <button type="button" aria-expanded={open} onClick={onToggle} className="text-mute hover:text-ink shrink-0 inline-flex items-center min-h-6 px-2 rounded-sm focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden">{toggleLabel}</button>
      </div>
      {open && <ul className="pl-5 flex flex-col gap-1 text-mute">{which}</ul>}
    </div>
  );
}

export interface FilterCard { id: string | null; label: string; count: number; mark?: React.ReactNode }

/** Count-bearing filter cards (`aria-pressed`). `mark` replaces the bold label (Problems' severity glyph + word). */
export function FilterCards({ cards, selected, onSelect, noun = "finding", children }: {
  cards: FilterCard[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  noun?: string;
  /** Trailing controls (Problems' rule select). */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {cards.map((c) => (
        <button
          key={c.label}
          type="button"
          aria-pressed={selected === c.id}
          aria-label={`${c.label}, ${c.count} ${c.count === 1 ? noun : `${noun}s`}, filter`}
          onClick={() => onSelect(selected === c.id ? null : c.id)}
          className={`min-h-6 px-3 py-1.5 rounded-lg text-[11.5px] ring-1 flex items-center gap-1.5 ${selected === c.id ? "bg-accent/12 ring-accent/30 text-ink" : "bg-card/70 ring-edge text-mute hover:text-ink"}`}
        >
          {c.mark ?? <span className="font-semibold">{c.label}</span>}
          <span className="mono tabular-nums">{c.count}</span>
        </button>
      ))}
      {children}
    </div>
  );
}

/** A collapsible group: header button + a rounded list. The caller supplies the `<FindingRow>` children. */
export function GroupSection({ open, onToggle, header, count, children }: {
  open: boolean;
  onToggle: () => void;
  header: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center gap-1.5 min-h-6 mb-1.5 text-[12px] text-ink"
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        {header}
        <span className="text-mute">· {count}</span>
      </button>
      {open && <ul className="rounded-xl bg-card/70 ring-1 ring-edge">{children}</ul>}
    </section>
  );
}
