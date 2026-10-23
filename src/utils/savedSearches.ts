// #40 Saved searches (v1.4.1 B-16, T41-10, 07 P19). Pure, React-free. Search TEXT only: no namespace, no sort.
// localStorage["saved-searches"] = Record<viewKey, {name, text}[]>, view key = a ResourceType or
// `crd-instances:<crd name>`. Every storage touch is in try/catch; a corrupt store reads as empty.

export const SAVED_KEY = "saved-searches";
export const MAX_SAVED = 20;

export interface SavedSearch { name: string; text: string }
export type SavedMap = Record<string, SavedSearch[]>;

/** The slice of Storage this module needs, so tests can pass a fake. */
export interface StoreLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

const clean = (v: unknown): SavedSearch[] =>
  (Array.isArray(v) ? v : [])
    .filter((e): e is SavedSearch => !!e && typeof e.name === "string" && typeof e.text === "string" && e.name.trim() !== "" && e.text.trim() !== "")
    .slice(0, MAX_SAVED);

/** A malformed entry is dropped silently; unparseable or non-object JSON is `corrupt` and reads as empty. */
export function parseStore(raw: string | null): { map: SavedMap; corrupt: boolean } {
  if (raw === null) return { map: {}, corrupt: false };
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { map: {}, corrupt: true };
    const map: SavedMap = {};
    for (const [k, list] of Object.entries(v)) {
      const items = clean(list);
      if (items.length) map[k] = items;
    }
    return { map, corrupt: false };
  } catch {
    return { map: {}, corrupt: true };
  }
}

export interface ViewState { items: SavedSearch[]; corrupt: boolean; unavailable: boolean }

export function loadView(store: StoreLike | null, key: string): ViewState {
  if (!store) return { items: [], corrupt: false, unavailable: true };
  try {
    const { map, corrupt } = parseStore(store.getItem(SAVED_KEY));
    return { items: map[key] ?? [], corrupt, unavailable: false };
  } catch {
    return { items: [], corrupt: false, unavailable: true };
  }
}

/** Writes one view's list, keeping the other views. False when storage refuses. */
export function saveView(store: StoreLike | null, key: string, items: SavedSearch[]): boolean {
  if (!store) return false;
  try {
    const { map } = parseStore(store.getItem(SAVED_KEY));
    if (items.length) map[key] = items; else delete map[key];
    store.setItem(SAVED_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export const nameFor = (name: string, text: string) => (name.trim() || text.trim());
export const suggestName = (text: string) => text.trim().slice(0, 40);
export const hasName = (items: SavedSearch[], name: string) => items.some((s) => s.name === name);

/** Same name replaces in place. Returns null when it would be the 21st. */
export function upsert(items: SavedSearch[], name: string, text: string): SavedSearch[] | null {
  const n = nameFor(name, text);
  const t = text.trim();
  if (!n || !t) return null;
  if (hasName(items, n)) return items.map((s) => (s.name === n ? { name: n, text: t } : s));
  return items.length >= MAX_SAVED ? null : [...items, { name: n, text: t }];
}

export const removeAt = (items: SavedSearch[], index: number) => items.filter((_, i) => i !== index);
export function insertAt(items: SavedSearch[], entry: SavedSearch, index: number): SavedSearch[] {
  if (items.length >= MAX_SAVED || hasName(items, entry.name)) return items;
  const out = [...items];
  out.splice(Math.min(index, out.length), 0, entry);
  return out;
}

/** The ONE reason Save is disabled, in the order 04 5.14 lists them. */
export function saveDisabledReason(i: { text: string; name: string; items: SavedSearch[]; unavailable: boolean }): string | undefined {
  if (i.unavailable) return "Saved searches can't be stored in this session.";
  if (!i.text.trim()) return "Type a search first.";
  if (i.items.length >= MAX_SAVED && !hasName(i.items, nameFor(i.name, i.text))) return "20 saved searches is the limit. Remove one first.";
  return undefined;
}

/** The view key for the TopBar: a ResourceType, or the CRD's name for the instances view (null until a CRD is picked). */
export function savedSearchKey(view: string, crdName: string | undefined): string | null {
  if (view === "crd-instances") return crdName ? `crd-instances:${crdName}` : null;
  return view;
}

export const FOOTNOTE = "Saves the search text only. The namespace and sort aren't saved.";
export const PODS_FOOTNOTE = "Status and label filters aren't saved.";
