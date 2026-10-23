// #7 field-manager blame (docs/ux/03 §5). Pure. Turns `metadata.managedFields[].fieldsV1`
// into readable dotted paths. No server-side-apply vocabulary anywhere: the section says
// "field managers", "last set by", "wrote"; it is read-only and never suggests the user can
// change who manages a field.

export interface ManagerEntry {
  manager: string;
  /** "Apply" or "Update", as recorded. */
  operation: string;
  time: string | null;
  subresource: string | null;
  paths: string[];
}

export interface FieldHit { path: string; manager: string; operation: string; time: string | null }

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** `k:{"name":"api"}` -> `api`; `k:{"containerPort":8080,"protocol":"TCP"}` -> `8080/TCP`. Falls back to the raw text. */
function keySegment(raw: string): string {
  try {
    const o: unknown = JSON.parse(raw);
    if (isObj(o)) {
      const vals = Object.values(o).map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
      if (vals.length > 0) return vals.join("/");
    }
  } catch {
    /* fall through */
  }
  return raw;
}

function valueSegment(raw: string): string {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return raw;
  }
}

function walk(node: unknown, prefix: string, out: string[], budget: { left: number }): void {
  if (budget.left <= 0) return;
  if (!isObj(node)) return;
  const keys = Object.keys(node);
  const children = keys.filter((k) => k !== ".");
  // A node is itself a written field when it carries "." or has no children (a leaf).
  if (prefix !== "" && (keys.includes(".") || children.length === 0)) {
    out.push(prefix);
    budget.left--;
  }
  for (const k of children) {
    let next: string;
    if (k.startsWith("f:")) next = prefix === "" ? k.slice(2) : `${prefix}.${k.slice(2)}`;
    else if (k.startsWith("k:")) next = `${prefix}[${keySegment(k.slice(2))}]`;
    else if (k.startsWith("v:")) next = `${prefix}[${valueSegment(k.slice(2))}]`;
    else if (k.startsWith("i:")) next = `${prefix}[${k.slice(2)}]`;
    else continue;
    walk(node[k], next, out, budget);
  }
}

/** Paths a manager wrote, sorted. Capped far above the 50-per-manager display so a huge object cannot hang the UI. */
export function fieldsV1ToPaths(fields: unknown, max = 5000): string[] {
  const out: string[] = [];
  walk(fields, "", out, { left: max });
  return out.sort();
}

export function parseManagedFields(obj: unknown): ManagerEntry[] {
  if (!isObj(obj) || !isObj(obj.metadata) || !Array.isArray(obj.metadata.managedFields)) return [];
  const entries: ManagerEntry[] = [];
  for (const mf of obj.metadata.managedFields) {
    if (!isObj(mf) || typeof mf.manager !== "string") continue;
    entries.push({
      manager: mf.manager,
      operation: typeof mf.operation === "string" ? mf.operation : "Update",
      time: typeof mf.time === "string" ? mf.time : null,
      subresource: typeof mf.subresource === "string" ? mf.subresource : null,
      paths: fieldsV1ToPaths(mf.fieldsV1),
    });
  }
  const t = (e: ManagerEntry) => (e.time ? Date.parse(e.time) : 0) || 0;
  return entries.sort((a, b) => t(b) - t(a) || a.manager.localeCompare(b.manager));
}

/** Substring match over every manager's paths; most recent writer first. A field may appear under several managers. */
export function findFields(entries: readonly ManagerEntry[], text: string): FieldHit[] {
  const q = text.trim().toLowerCase();
  if (q === "") return [];
  const hits: FieldHit[] = [];
  for (const e of entries) {
    for (const p of e.paths) {
      if (p.toLowerCase().includes(q)) hits.push({ path: p, manager: e.manager, operation: e.operation, time: e.time });
    }
  }
  return hits;
}

export const PATHS_SHOWN = 50;

/** "3m ago", "2d ago"; "unknown time" when absent or unparseable. */
export function agoText(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "unknown time";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown time";
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const HONESTY_LINE = "Managed fields reflect what the API server recorded. Not every tool writes the same way.";
export const INTRO_LINE = "Who last wrote each field, as recorded by the API server. Read-only.";
export const NO_DATA_TITLE = "No field manager data on this object.";
export const NO_DATA_DETAIL = "The API server didn't record any, or it was created before field management was enabled.";
