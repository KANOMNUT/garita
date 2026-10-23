import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { parentPath, type DiffResult, type DiffRow, type DiffState } from "../utils/diffRows";
import { PRODUCT_NAME } from "../brand";

// The ONE diff-row renderer (docs/ux/00 §3): #8, #9, #10, #37 and Merge from file all use it.
// State is encoded by glyph + word + role colour — never colour alone.

const GLYPH: Record<DiffState, string> = {
  added: "+",
  removed: "−",
  changed: "~",
  replaced: "⇄",
  unchanged: " ",
  dropped: "−",
};
const WORD: Record<DiffState, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  replaced: "replaced",
  unchanged: "unchanged",
  dropped: "dropped by schema",
};
const ROLE: Record<DiffState, string> = {
  added: "text-ok",
  removed: "text-bad",
  changed: "text-warn",
  replaced: "text-orange",
  unchanged: "text-dim",
  dropped: "text-bad",
};
const TINT: Record<DiffState, string> = {
  added: "bg-ok/6",
  removed: "bg-bad/6",
  changed: "bg-warn/6",
  replaced: "bg-orange/6",
  unchanged: "",
  dropped: "bg-bad/6",
};

const LONG_VALUE = 120;
export const INSIDE_ARRAY_HEADER = `For reading only. ${PRODUCT_NAME} writes the whole array.`;

function Value({ text, mutedWhenAbsent }: { text: string | null; mutedWhenAbsent?: boolean }) {
  const [full, setFull] = useState(false);
  if (text === null) return <span className={mutedWhenAbsent ? "text-dim" : "text-dim"}>—</span>;
  const long = text.length > LONG_VALUE || text.includes("\n");
  if (!long) return <span className="break-all">{text}</span>;
  if (full) {
    return (
      <span className="inline-flex flex-col gap-0.5 max-w-full">
        <span className="block max-w-full overflow-x-auto whitespace-pre">{text}</span>
        <button type="button" onClick={() => setFull(false)} className="self-start text-[10.5px] text-accent hover:underline">
          Hide full value
        </button>
      </span>
    );
  }
  const firstLine = text.split("\n", 1)[0];
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      <span className="break-all">{firstLine.slice(0, LONG_VALUE)}…</span>
      <button type="button" onClick={() => setFull(true)} className="text-[10.5px] text-accent hover:underline">
        Show full value
      </button>
    </span>
  );
}

function InsidePanel({ rows, open, onToggle }: { rows: DiffRow[]; open: boolean; onToggle: () => void }) {
  return (
    <div className="mt-1.5 rounded-md bg-surface-tint/3 ring-1 ring-edge px-2.5 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-[11px] font-semibold text-mute hover:text-ink"
      >
        Inside this array{open ? "" : ` (${rows.length})`}
      </button>
      {open && (
        <div className="mt-1">
          <p className="text-[10.5px] text-dim mb-1">{INSIDE_ARRAY_HEADER}</p>
          <ul className="flex flex-col gap-0.5">
            {rows.map((r, i) => (
              <li key={`${r.path}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className={`mono w-3 shrink-0 text-center ${ROLE[r.state]}`} aria-hidden>{GLYPH[r.state]}</span>
                <span className="mono text-ink/90 break-all">{r.path}</span>
                <span className="mono text-mute">
                  {r.state !== "added" && <><Value text={r.from} />{" "}</>}
                  {r.state !== "removed" && <>→ <Value text={r.to} /></>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const Row = memo(function Row({ row, insideDefaultOpen }: { row: DiffRow; insideDefaultOpen: boolean }) {
  const [both, setBoth] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [insideOpen, setInsideOpen] = useState(insideDefaultOpen);
  const showReal = revealed && row.reveal;
  const from = showReal ? row.reveal!.from : row.from;
  const to = showReal ? row.reveal!.to : row.to;
  const changedRow = row.state !== "unchanged";
  return (
    <li
      data-diff-changed={changedRow ? "" : undefined}
      tabIndex={-1}
      className={`rounded-md px-2 py-1 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60 ${TINT[row.state]}`}
    >
      <div className="flex items-baseline gap-2 text-[11.5px]">
        <span className={`mono w-3 shrink-0 text-center ${ROLE[row.state]}`} aria-hidden>{GLYPH[row.state]}</span>
        <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="mono text-ink/90 break-all">{row.path}</span>
          {row.state === "dropped" ? (
            <span className="mono text-[10.5px] text-bad">(dropped by schema)</span>
          ) : row.state === "unchanged" ? (
            <span className="mono text-dim"><Value text={row.to ?? row.from} /></span>
          ) : (
            <span className="mono text-mute min-w-0">
              {row.state !== "added" && <><Value text={from} />{" "}</>}
              {row.state !== "removed" && <>{row.state === "added" ? "" : "→ "}<Value text={to} /></>}
            </span>
          )}
        </div>
        <span className={`text-[10px] uppercase tracking-wider shrink-0 ${ROLE[row.state]}`}>{WORD[row.state]}</span>
        {row.masked === "credential" && (
          <button type="button" onClick={() => setRevealed((v) => !v)} className="text-[10.5px] text-accent hover:underline shrink-0">
            {revealed ? "Hide" : "Show"}
          </button>
        )}
        {row.state === "replaced" && row.fromText !== undefined && (
          <button type="button" onClick={() => setBoth((v) => !v)} aria-expanded={both} className="text-[10.5px] text-accent hover:underline shrink-0">
            {both ? "Hide both" : "View both"}
          </button>
        )}
      </div>
      {both && (
        <div className="mt-1 pl-5">
          {row.inside && row.inside.length > 0 && (
            <InsidePanel rows={row.inside} open={insideOpen} onToggle={() => setInsideOpen((v) => !v)} />
          )}
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {[["Before", row.fromText], ["After", row.toText]].map(([label, text]) => (
              <div key={label} className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-dim mb-0.5">{label}</div>
                <pre className="mono text-[10.5px] leading-normal max-h-40 overflow-auto rounded-sm bg-surface-input/80 ring-1 ring-edge p-1.5 text-ink/90">
                  {text ?? "—"}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
});

interface Item {
  type: "row" | "group";
  row?: DiffRow;
  group?: string;
  members?: DiffRow[];
}

/** Changed rows keep their order; unchanged rows collapse into one item per parent path. */
export function buildItems(rows: DiffRow[]): Item[] {
  const items: Item[] = [];
  const groups = new Map<string, Item>();
  for (const row of rows) {
    if (row.state !== "unchanged") {
      items.push({ type: "row", row });
      continue;
    }
    const key = parentPath(row.path);
    let g = groups.get(key);
    if (!g) {
      g = { type: "group", group: key, members: [] };
      groups.set(key, g);
      items.push(g);
    }
    g.members!.push(row);
  }
  return items;
}

interface DiffRowsProps {
  result: DiffResult;
  /** D3-1: "Inside this array" starts open in the read-only comparisons (#8, #9), closed in write previews. */
  insideDefaultOpen?: boolean;
  /** Shown instead of rows when nothing changed. */
  emptyTitle?: string;
  emptySecondary?: string;
  /** Accessible name for the list. */
  label?: string;
}

export function DiffRows({
  result, insideDefaultOpen = false, emptyTitle = "No differences.", emptySecondary, label = "Changes",
}: DiffRowsProps) {
  const items = useMemo(() => buildItems(result.rows), [result.rows]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);

  // ⌥↓ / ⌥↑ move between changed rows (03 §14.2). No single-letter keys (K1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      const list = listRef.current;
      if (!list || list.offsetParent === null) return;
      const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-diff-changed]"));
      if (rows.length === 0) return;
      e.preventDefault();
      const current = rows.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, current + 1) : Math.max(0, current <= 0 ? 0 : current - 1);
      rows[next].focus();
      rows[next].scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (result.changed === 0) {
    return (
      <div className="py-3 text-center">
        <p className="text-[12.5px] text-ink">{emptyTitle}</p>
        {emptySecondary && <p className="text-[11.5px] text-dim mt-0.5">{emptySecondary}</p>}
      </div>
    );
  }

  return (
    <div>
      <ul ref={listRef} aria-label={label} className="flex flex-col gap-0.5">
        {items.map((item, i) => {
          if (item.type === "row" && item.row) {
            return <Row key={`${item.row.path}-${i}`} row={item.row} insideDefaultOpen={insideDefaultOpen} />;
          }
          const key = item.group ?? "";
          const members = item.members ?? [];
          const expanded = open.has(key);
          return (
            <Fragment key={`g-${key}-${i}`}>
              <li className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-dim">
                <span className="mono w-3 shrink-0 text-center" aria-hidden>⋯</span>
                <span>
                  {members.length} unchanged field{members.length === 1 ? "" : "s"}
                  {key ? <span className="mono"> in {key}</span> : null}
                </span>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Hide" : "Show"} ${members.length} unchanged field${members.length === 1 ? "" : "s"}`}
                  onClick={() => setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  })}
                  className="text-accent hover:underline"
                >
                  {expanded ? "Hide" : "Show"}
                </button>
              </li>
              {expanded && members.map((m) => <Row key={`u-${m.path}`} row={m} insideDefaultOpen={insideDefaultOpen} />)}
            </Fragment>
          );
        })}
      </ul>
      {result.more > 0 && (
        <p className="mt-2 text-[11.5px] text-dim">
          {result.more} more change{result.more === 1 ? "" : "s"}. Narrow the comparison to see them.
        </p>
      )}
    </div>
  );
}
