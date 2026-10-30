import { useState, useMemo, useCallback, useEffect } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Settings, Trash2 } from "lucide-react";
import { ReadOnlyStrip } from "./ReadOnlyBadge";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { ViewState } from "./ViewState";
import { useApiPresence } from "../hooks/useResources";
import { isForbidden, viewState } from "../utils/viewState";
import { disabledAttrs, READ_ONLY_REASON_SHORT } from "../utils/guardrails";
import { groupRows, searchRows, sortRows, type SortState } from "../utils/tableRows";

export interface Column<T> {
  id: string;
  header: string;
  width?: number | string;
  sortable?: boolean;
  sortValue?: (item: T) => string | number;
  cell: (item: T) => React.ReactNode;
  /**
   * The cell holds a control (a checkbox, button or link). A button cannot contain another control, so the
   * row's name button (X-1) goes in the first visible column that is not `interactive`.
   */
  interactive?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  keyFn: (item: T) => string;
  selectedKey?: string | null;
  onSelect?: (item: T) => void;
  emptyIcon?: React.ReactNode;
  emptyText?: string;
  title?: string;
  count?: number;
  extra?: React.ReactNode;
  extraLeft?: React.ReactNode;
  search?: string;
  storageKey?: string;
  onDelete?: (item: T) => void;
  /**
   * Name of the per-row delete button (default "Delete"): its `aria-label` always, and its `title` while it is enabled.
   * A function gives each row its own name ("Delete namespace payments").
   */
  deleteLabel?: string | ((item: T) => string);
  /**
   * Why this row cannot be deleted, or undefined when it can. Checked after read-only mode, which always wins
   * (DISABLE-PRECEDENCE). A row with a reason keeps its trash present, focusable and dimmed with the reason as
   * its description, never hidden. Needs `onDelete`.
   */
  deleteReason?: (item: T) => string | undefined;
  /** Icon for the per-row delete button (default <Trash2 size={12} />). */
  deleteIcon?: React.ReactNode;
  /**
   * The cluster this table lists. With it the table shows the read-only strip and disables
   * the row delete while read-only mode is on (a disabled control, never a hidden one).
   */
  context?: string;
  /** Column ids hidden until the user chooses otherwise (a saved choice wins). Needs `storageKey`. */
  defaultHidden?: string[];
  /**
   * `list_api_presence` key (flux-ks, gw, cert, vs, argocd, ...). Opts a CRD-backed view into the
   * #15 states: not installed / no access / nothing here. Needs `context` and `title`.
   */
  presenceKey?: string;
  /**
   * Controlled sort. When `onSortChange` is given, the table shows `sort` and reports header
   * clicks instead of keeping its own state, so the caller knows the displayed order.
   */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /**
   * Group rows under header rows: groups A-Z by key (`groupRows`), search and sort applied inside each group.
   * A group with no matching row is left out. While a search is set, every group with a match is shown expanded.
   */
  groupBy?: (item: T) => string;
  /** [singular, plural] noun for a group's screen-reader count, e.g. ["CRD", "CRDs"]. Default ["row", "rows"]. */
  groupNoun?: [string, string];
}

const GROUP_OPEN_WHILE_SEARCHING = "Groups stay open while a search is set.";

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-edge-raw/70">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-2 py-3 first:pl-3">
          <div className="h-3 rounded-sm bg-surface-tint/4 animate-pulse" style={{ width: i === 0 ? 200 : 80 }} />
        </td>
      ))}
    </tr>
  );
}

export function GenericResourceTable<T>({
  columns, data, isLoading, error, onRetry, keyFn,
  selectedKey, onSelect, emptyIcon, emptyText = "No resources found",
  title, count, extra, extraLeft, search, storageKey, onDelete,
  deleteLabel = "Delete", deleteReason, deleteIcon, context, presenceKey, defaultHidden,
  sort, onSortChange, groupBy, groupNoun = ["row", "rows"],
}: Props<T>) {
  const identity = useClusterIdentity(context ?? "");
  const readOnly = !!context && identity.readOnly;
  const presenceQ = useApiPresence(context ?? "", !!presenceKey);
  const presence = presenceQ.data?.find((p) => p.key === presenceKey);
  const errorMessage: string | null = error ? ((error as any)?.message ?? String(error)) : null;
  const vs = presenceKey ? viewState(presence?.state ?? "unknown", errorMessage, data.length) : null;
  const [ownSort, setOwnSort] = useState<SortState | null>(null);
  // Controlled when the caller passes `onSortChange` (the caller needs the displayed order).
  const currentSort = onSortChange ? (sort ?? null) : ownSort;

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (!storageKey) return new Set();
    const fallback = new Set<string>(defaultHidden);
    try {
      const saved = localStorage.getItem(`columns-${storageKey}`);
      return saved ? new Set<string>(JSON.parse(saved) as string[]) : fallback;
    } catch { return fallback; }
  });

  const [showColMenu, setShowColMenu] = useState(false);

  const toggleCol = useCallback((colId: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      if (storageKey) localStorage.setItem(`columns-${storageKey}`, JSON.stringify([...next]));
      return next;
    });
  }, [storageKey]);

  // Close the column menu on outside mousedown (mousedown fires before click,
  // so the gear button's own click handler won't re-open it on the same event).
  useEffect(() => {
    if (!showColMenu) return;
    function handleOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-col-menu]")) {
        setShowColMenu(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showColMenu]);

  const filtered = useMemo(() => searchRows(data, search, keyFn), [data, search, keyFn]);

  const sorted = useMemo(
    () => sortRows(filtered, columns, currentSort),
    [filtered, columns, currentSort],
  );

  // Header rows only exist while `groupBy` is set. Collapse state is the table's own, all open on mount, not persisted.
  const groups = useMemo(() => (groupBy ? groupRows(sorted, groupBy) : null), [sorted, groupBy]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleSort = useCallback(
    (colId: string) => {
      const next: SortState = currentSort?.col === colId
        ? { col: colId, asc: !currentSort.asc }
        : { col: colId, asc: true };
      if (onSortChange) onSortChange(next);
      else setOwnSort(next);
    },
    [currentSort, onSortChange],
  );

  // Never hide the first (name) column.
  const visibleColumns = columns.filter(
    (col, i) => i === 0 || !hiddenCols.has(col.id),
  );
  // X-1: the one keyboard stop of a row. The <tr onClick> stays for the mouse; the name cell holds a native
  // button with no handler, and Enter / Space dispatch a click that bubbles to the row. It cannot wrap a cell
  // that holds a control, so it goes in the first column that is not `interactive` (-1: none, no button).
  const nameColIndex = visibleColumns.findIndex((col) => !col.interactive);

  if (error && !presenceKey) {
    return (
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        {(title || storageKey) && (
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
          </div>
        )}
        <div className="rounded-xl bg-card/70 ring-1 ring-edge flex-1 min-h-0 flex items-center justify-center flex-col gap-4 p-8">
          {errorMessage !== null && isForbidden(errorMessage) ? (
            // Q21: a 403 on a core list is "no access", not a raw error box. No Retry: a 403 repeats (the TopBar refresh re-queries).
            <ViewState state={{ kind: "no-access", unconfirmed: false }} things={title ?? "resources"} onRetry={onRetry} />
          ) : (
            <>
              <div className="w-full max-w-2xl rounded-lg bg-bad/6 ring-1 ring-bad/20 p-4 overflow-auto max-h-64">
                <p className="text-[11.5px] text-bad whitespace-pre-wrap font-mono leading-relaxed">{(error as any)?.message ?? String(error)}</p>
              </div>
              <button
                type="button"
                onClick={onRetry}
                className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const colSpan = visibleColumns.length + (onDelete ? 1 : 0);

  const renderRow = (item: T) => {
    const key = keyFn(item);
    const isSelected = key === selectedKey;
    // Read-only wins; then the view's own per-row reason. A row with a reason shows its trash dimmed,
    // never in the enabled look. Exclusive class strings: Tailwind's output order must not decide.
    const rowReason = readOnly ? READ_ONLY_REASON_SHORT : deleteReason?.(item);
    const trashReveal = rowReason
      ? "opacity-0 group-hover:opacity-50 group-focus-within:opacity-50 focus-visible:opacity-50 cursor-not-allowed"
      : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:text-bad hover:bg-bad/10";
    const rowDeleteLabel = typeof deleteLabel === "function" ? deleteLabel(item) : deleteLabel;
    return (
      <tr
        key={key}
        onClick={() => onSelect?.(item)}
        className={`border-b border-edge-raw/70 transition-colors group
          ${onSelect ? "cursor-pointer row-hover" : ""}
          ${isSelected ? "row-selected" : ""}`}
      >
        {visibleColumns.map((col, ci) => (
          <td
            key={col.id}
            className={`px-2 py-2 align-middle ${ci === 0 ? "pl-3 row-bar" : ""} ${!onDelete && ci === visibleColumns.length - 1 ? "pr-3" : ""}`}
          >
            {onSelect && ci === nameColIndex ? (
              <button
                type="button"
                aria-current={isSelected ? "true" : undefined}
                className="max-w-full text-left rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                {col.cell(item)}
              </button>
            ) : (
              col.cell(item)
            )}
          </td>
        ))}
        {onDelete && (
          <td className="px-2 py-2 align-middle w-12 pr-3" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label={rowDeleteLabel}
              onClick={(e) => {
                e.stopPropagation();
                if (rowReason) return;
                // WebKit does not focus a button on click; the confirm returns focus to the element focused when it opened.
                e.currentTarget.focus();
                onDelete(item);
              }}
              {...(rowReason ? disabledAttrs(rowReason) : { title: rowDeleteLabel })}
              className={`h-6 w-6 flex items-center justify-center rounded-sm text-mute transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 ${trashReveal}`}
            >
              {deleteIcon ?? <Trash2 size={12} aria-hidden />}
            </button>
          </td>
        )}
      </tr>
    );
  };

  // The rows of every state that is not "the data": loading, the #15 view states, empty, no search hit.
  // null means "show the data", which the grouped layout renders as one <tbody> per group.
  // A-11: hold the skeleton while presence loads, so "Nothing here" never flashes before "Not installed".
  const stateBody: React.ReactNode | null =
    isLoading || (!!presenceKey && presenceQ.isLoading && data.length === 0) ? (
      Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={colSpan} />)
    ) : vs && vs.kind !== "ok" ? (
      <tr>
        <td colSpan={colSpan}>
          <ViewState state={vs} things={title ?? "resources"} group={presence?.group}
            message={errorMessage ?? undefined} emptyIcon={emptyIcon} onRetry={onRetry} />
        </td>
      </tr>
    ) : data.length === 0 ? (
      <tr>
        <td colSpan={colSpan}>
          <div className="py-16 flex flex-col items-center gap-3">
            <div className="text-dim">{emptyIcon}</div>
            <p className="text-[13px] text-mute">{emptyText}</p>
          </div>
        </td>
      </tr>
    ) : search && filtered.length === 0 ? (
      <tr>
        <td colSpan={colSpan}>
          <div className="py-16 flex flex-col items-center gap-3">
            <div className="text-dim">{emptyIcon}</div>
            <p className="text-[13px] text-mute">No results for "{search}"</p>
          </div>
        </td>
      </tr>
    ) : null;

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {(title || extra || extraLeft || storageKey) && (
        <div className="flex items-center gap-2">
          {title && (
            <>
              <h2 className="text-[14px] font-semibold tracking-tight whitespace-nowrap shrink-0">{title}</h2>
              {count != null && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] mono font-medium bg-accent/10 text-accent/80 ring-1 ring-accent/20 shrink-0">
                  {search && filtered.length !== data.length
                    ? `${filtered.length} / ${data.length}`
                    : `${data.length} total`}
                </span>
              )}
            </>
          )}
          {extraLeft}
          <div className="flex-1" />
          {storageKey && (
            <div className="relative" data-col-menu>
              <button
                type="button"
                onClick={() => setShowColMenu(v => !v)}
                aria-label="Show or hide columns"
                aria-expanded={showColMenu}
                className="h-7 w-7 rounded-md flex items-center justify-center text-dim hover:text-ink hover:bg-surface-tint/6 transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
                title="Show or hide columns"
              >
                <Settings size={13} aria-hidden />
              </button>
              {showColMenu && (
                <div className="absolute right-0 top-8 z-20 bg-surface-overlay rounded-lg ring-1 ring-edge-strong shadow-xl p-2 min-w-[160px]">
                  {columns.slice(1).map(col => (
                    <label
                      key={col.id}
                      className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-tint/4 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenCols.has(col.id)}
                        onChange={() => toggleCol(col.id)}
                        className="accent-accent h-3 w-3"
                      />
                      <span className="text-[12px] text-mute select-none">{col.header}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {extra}
        </div>
      )}
      {/* The row delete is opacity-0 until hover, so this strip is the ONLY persistent
          read-only signal on a list view. It reports the mode, even if RBAC hid the column. */}
      {context && <ReadOnlyStrip context={context} />}
      <div className="rounded-xl bg-card/70 ring-1 ring-edge flex-1 min-h-0 overflow-hidden">
        <div className="h-full overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    style={col.width ? { width: col.width } : undefined}
                    // X-5: the sorted column says so (the PodTable header does the same). The sort control is the button inside.
                    aria-sort={currentSort?.col === col.id ? (currentSort.asc ? "ascending" : "descending") : undefined}
                    className={`sticky top-0 z-1 bg-panel/95 backdrop-blur-sm border-b border-edge text-left text-[10.5px] uppercase tracking-[0.06em] font-semibold py-2 px-2 first:pl-3 last:pr-3
                      ${currentSort?.col === col.id ? "text-accent" : "text-dim"}`}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.id)}
                        className="flex items-center gap-1 rounded-xs hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70"
                      >
                        {col.header}
                        {currentSort?.col === col.id
                          ? currentSort.asc ? <ChevronUp size={9} /> : <ChevronDown size={9} />
                          : <ChevronDown size={9} className="opacity-40" />}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                ))}
                {onDelete && <th className="sticky top-0 z-1 bg-panel/95 backdrop-blur-sm border-b border-edge w-12" />}
              </tr>
            </thead>
            {stateBody !== null || !groups ? (
              <tbody>{stateBody ?? sorted.map((item) => renderRow(item))}</tbody>
            ) : (
              groups.map((g) => {
                // A search shows every group that has a match, expanded: a collapsed group must not hide a hit.
                const open = !!search || !collapsed.has(g.key);
                const [one, many] = groupNoun;
                return (
                  <tbody key={g.key}>
                    <tr>
                      <th
                        scope="rowgroup"
                        colSpan={colSpan}
                        className="p-0 bg-surface-tint/3 border-b border-edge text-left font-normal"
                      >
                        <button
                          type="button"
                          aria-expanded={open}
                          // The button spans the whole table, which can be wider than its pane. Without this the browser
                          // centres it on focus and the table scrolls sideways, taking every group label off screen.
                          onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "start" })}
                          onClick={() => { if (!search) toggleGroup(g.key); }}
                          {...disabledAttrs(search ? GROUP_OPEN_WHILE_SEARCHING : undefined)}
                          className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-[10.5px] font-semibold text-mute outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 ${search ? "cursor-default" : "hover:text-ink"}`}
                        >
                          <ChevronRight size={11} aria-hidden className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                          <span className="mono truncate">{g.key}</span>
                          <span aria-hidden className="mono tabular-nums">{g.rows.length}</span>
                          <span className="sr-only">, {g.rows.length} {g.rows.length === 1 ? one : many}</span>
                        </button>
                      </th>
                    </tr>
                    {open && g.rows.map((item) => renderRow(item))}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
