// Pure row helpers shared by GenericResourceTable and the views that need to know which rows
// the table shows (the ArgoCD bulk selection). One search predicate and one comparator, so a
// view that derives the shown rows cannot drift from the table.

export interface SortState { col: string; asc: boolean }

/** Structural subset of `Column<T>` (GenericResourceTable.tsx), so this file stays React-free. */
export interface SortableColumn<T> { id: string; sortValue?: (item: T) => string | number }

/**
 * The table's search predicate: a case-insensitive substring match on the row key. No search
 * (undefined or "") returns `data` itself, so memoised callers keep a stable reference.
 */
export function searchRows<T>(
  data: readonly T[],
  search: string | undefined,
  keyFn: (item: T) => string,
): T[] {
  if (!search) return data as T[]; // never mutated: sortRows copies before sorting
  const needle = search.toLowerCase();
  return data.filter((item) => keyFn(item).toLowerCase().includes(needle));
}

/**
 * The table's comparator: numbers numerically, everything else with `localeCompare`. A null
 * sort returns `rows` unchanged; an unknown column compares every pair equal, so the stable
 * sort keeps the order too.
 */
export function sortRows<T>(
  rows: readonly T[],
  columns: readonly SortableColumn<T>[],
  sort: SortState | null,
): T[] {
  if (!sort) return rows as T[]; // never mutated: the sorted branch copies first
  const col = columns.find((c) => c.id === sort.col);
  return [...rows].sort((a, b) => {
    const va = col?.sortValue?.(a) ?? "";
    const vb = col?.sortValue?.(b) ?? "";
    if (typeof va === "number" && typeof vb === "number") {
      return sort.asc ? va - vb : vb - va;
    }
    return sort.asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });
}

/** `sortRows(searchRows(...))`: the rows the table shows, in the order it shows them. */
export function shownRows<T>(
  data: readonly T[],
  search: string | undefined,
  keyFn: (item: T) => string,
  columns: readonly SortableColumn<T>[],
  sort: SortState | null,
): T[] {
  return sortRows(searchRows(data, search, keyFn), columns, sort);
}

/**
 * A checkbox click. With `shift` and an `anchor` found in `order`, set (or, when `key` was
 * already selected, clear) every key from the anchor to `key` in `order`'s order. Otherwise
 * toggle `key`. Never adds a key that is not in `order`: a row the table does not show cannot
 * be selected.
 */
export function rangeSelect(
  prev: ReadonlySet<string>,
  order: readonly string[],
  anchor: string | null,
  key: string,
  shift: boolean,
): Set<string> {
  const next = new Set(prev);
  const to = order.indexOf(key);
  if (shift && anchor !== null) {
    const from = order.indexOf(anchor);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const add = !prev.has(key);
      for (let i = lo; i <= hi; i++) {
        if (add) next.add(order[i]); else next.delete(order[i]);
      }
      return next;
    }
  }
  if (next.has(key)) next.delete(key);
  else if (to !== -1) next.add(key);
  return next;
}
