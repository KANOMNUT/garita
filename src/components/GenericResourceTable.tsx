import { useState, useMemo, useCallback, useEffect } from "react";
import { ChevronDown, ChevronUp, Settings, Trash2 } from "lucide-react";
import { ReadOnlyStrip } from "./ReadOnlyBadge";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { ViewState } from "./ViewState";
import { useApiPresence } from "../hooks/useResources";
import { viewState } from "../utils/viewState";
import { disabledAttrs, READ_ONLY_REASON_SHORT } from "../utils/guardrails";
import { searchRows, sortRows, type SortState } from "../utils/tableRows";

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
  /** Tooltip label for the per-row delete button (default "Delete"). */
  deleteLabel?: string;
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
}

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
  deleteLabel = "Delete", deleteIcon, context, presenceKey, defaultHidden,
  sort, onSortChange,
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
          <div className="w-full max-w-2xl rounded-lg bg-bad/6 ring-1 ring-bad/20 p-4 overflow-auto max-h-64">
            <p className="text-[11.5px] text-bad whitespace-pre-wrap font-mono leading-relaxed">{(error as any)?.message ?? String(error)}</p>
          </div>
          <button
            onClick={onRetry}
            className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

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
                onClick={() => setShowColMenu(v => !v)}
                className="h-7 w-7 rounded-md flex items-center justify-center text-dim hover:text-ink hover:bg-surface-tint/6 transition-colors"
                title="Show/hide columns"
              >
                <Settings size={13} />
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
                    className={`sticky top-0 z-1 bg-panel/95 backdrop-blur-sm border-b border-edge text-left text-[10.5px] uppercase tracking-[0.06em] font-semibold py-2 px-2 first:pl-3 last:pr-3
                      ${currentSort?.col === col.id ? "text-accent" : "text-dim"}`}
                  >
                    {col.sortable ? (
                      <button
                        onClick={() => handleSort(col.id)}
                        className="flex items-center gap-1 hover:text-ink"
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
            <tbody>
              {/* A-11: hold the skeleton while presence loads, so "Nothing here" never flashes before "Not installed". */}
              {isLoading || (!!presenceKey && presenceQ.isLoading && data.length === 0) ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow key={i} cols={visibleColumns.length + (onDelete ? 1 : 0)} />
                ))
              ) : vs && vs.kind !== "ok" ? (
                <tr>
                  <td colSpan={visibleColumns.length + (onDelete ? 1 : 0)}>
                    <ViewState state={vs} things={title ?? "resources"} group={presence?.group}
                      message={errorMessage ?? undefined} emptyIcon={emptyIcon} onRetry={onRetry} />
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + (onDelete ? 1 : 0)}>
                    <div className="py-16 flex flex-col items-center gap-3">
                      <div className="text-dim">{emptyIcon}</div>
                      <p className="text-[13px] text-mute">{emptyText}</p>
                    </div>
                  </td>
                </tr>
              ) : search && filtered.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + (onDelete ? 1 : 0)}>
                    <div className="py-16 flex flex-col items-center gap-3">
                      <div className="text-dim">{emptyIcon}</div>
                      <p className="text-[13px] text-mute">No results for "{search}"</p>
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((item) => {
                  const key = keyFn(item);
                  const isSelected = key === selectedKey;
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
                            onClick={(e) => { e.stopPropagation(); if (readOnly) return; onDelete(item); }}
                            {...(readOnly ? disabledAttrs(READ_ONLY_REASON_SHORT) : {})}
                            className={`h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad hover:bg-bad/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60 ${readOnly ? "cursor-not-allowed" : ""}`}
                            {...(readOnly ? {} : { title: deleteLabel })}
                          >
                            {deleteIcon ?? <Trash2 size={12} />}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
