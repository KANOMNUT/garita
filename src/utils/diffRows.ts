// DIFF-ROW: the ONE shared row model for #8 resource diff, #9 rollout diff, #10 YAML
// dry-run diff, #37 Helm upgrade preview and Merge from file (docs/ux/00 §3, 03 §3.4).
//
// React/JSX-free so scripts/check-emit.ts can import it under Node's native TS
// type-stripping. Arrays are LEAF rows everywhere (CLAUDE.md, Merge from file): RFC 7386
// replaces an array wholesale, so a row implying an element-wise merge would lie about
// what a write does. The one amendment (D3-1) is a READING AID on a replaced row —
// `inside`, "For reading only. <product> writes the whole array." — never a row state.

export type DiffState = "added" | "removed" | "changed" | "replaced" | "unchanged" | "dropped";

/** "secret": Secret data/stringData, never revealable here (#33 owns reveal). "credential": a Helm value whose key looks like one. */
export type MaskKind = "secret" | "credential";

export interface DiffRow {
  /** Dotted path, `[i]` for array indexes. Inside rows read `[name] sub.path`. */
  path: string;
  state: DiffState;
  /** Display text. null = absent on that side. */
  from: string | null;
  to: string | null;
  masked?: MaskKind;
  /** Real values for a "credential" row, behind the dialog-scoped Show control (D3-3). */
  reveal?: { from: string | null; to: string | null };
  /** D3-1: per-name rows for a replaced array whose elements all carry a unique `name`. */
  inside?: DiffRow[];
  /** Pretty JSON of each side of a replaced row, for "View both". */
  fromText?: string;
  toText?: string;
}

export interface DiffOptions {
  /** Dotted paths (and everything under them) that are not compared. */
  ignore?: readonly string[];
  /** Mask values under top-level `data` / `stringData` (a Secret). */
  maskSecretData?: boolean;
  /** Mask values whose KEY matches password|secret|token|key|credential, case-insensitive (D3-3). */
  maskCredentialKeys?: boolean;
  /** Treat null, {} and [] as absent. #10 compares a raw object with a typed re-serialisation. */
  emptyEqualsAbsent?: boolean;
  /** Cap on CHANGED rows returned (default 200). Unchanged rows are not capped. */
  maxChanged?: number;
}

export interface DiffResult {
  rows: DiffRow[];
  /** Number of changed rows before the cap. */
  changed: number;
  /** Changed rows past the cap, not in `rows`. */
  more: number;
  unchanged: number;
}

export const MAX_CHANGED_ROWS = 200;
export const MASK_TEXT = "••••••••";

/** The fields that never take part in a comparison of a live object (00 §3, 03 §4.4). */
export const K8S_IGNORED: readonly string[] = [
  "status",
  "metadata.managedFields",
  "metadata.uid",
  "metadata.resourceVersion",
  "metadata.generation",
  "metadata.creationTimestamp",
  "metadata.selfLink",
];
/** #8 compares two different objects, so name and namespace differ by construction. */
export const COMPARE_IGNORED: readonly string[] = [...K8S_IGNORED, "metadata.name", "metadata.namespace"];

/** kubectl apply stores the whole manifest here, Secret values included (#33, B-5). */
const LAST_APPLIED_PATH = "metadata.annotations.kubectl.kubernetes.io/last-applied-configuration";

const CREDENTIAL_KEY = /password|secret|token|key|credential/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

/**
 * Drops null / {} / [] PROPERTIES recursively (not array elements, not "" / 0 / false).
 * #10 compares a raw live object with a typed re-serialisation, which omits what the raw
 * object spells as `{}`; inside an array that would otherwise read as a replaced array.
 */
export function normalizeEmpty(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeEmpty);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const n = normalizeEmpty(val);
      if (!isEmptyValue(n)) out[k] = n;
    }
    return out;
  }
  return v;
}

function isEmptyValue(v: unknown): boolean {
  return v === null || (isPlainObject(v) && Object.keys(v).length === 0) || (Array.isArray(v) && v.length === 0);
}

export function formatValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function arraySummary(v: unknown): string {
  if (Array.isArray(v)) return `array, ${v.length} item${v.length === 1 ? "" : "s"}`;
  return formatValue(v);
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}

function pathIgnored(path: string, ignore: readonly string[]): boolean {
  return ignore.some((p) => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`));
}

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s+/g, "");
  if (clean === "") return 0;
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
}

function utf8ByteLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** The one Secret mask rule (B-5): data.*, stringData.* and the last-applied annotation. */
export function isSecretMaskedPath(path: string): boolean {
  // The exact parent paths too: a leaf row at `data` / `metadata` (a null or scalar on one side) carries the other
  // side's whole object, values and last-applied annotation included.
  return path.startsWith("data.") || path.startsWith("stringData.") || path === LAST_APPLIED_PATH
    || path === "data" || path === "stringData" || path === "metadata" || path === "metadata.annotations" || path === "(root)";
}

/** `•••••••• (N bytes)` for a Secret value at `path`; merge-from-file reuses it. */
export function maskSecretValue(path: string, v: unknown): string {
  return maskedText(v, path.startsWith("data.") ? "data" : path.startsWith("stringData.") ? "stringData" : null);
}

function maskedText(v: unknown, secretField: "data" | "stringData" | null): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  const bytes =
    typeof v === "string"
      ? (secretField === "data" ? base64ByteLength(v) : utf8ByteLength(v))
      : utf8ByteLength(formatValue(v));
  return `${MASK_TEXT} (${bytes} byte${bytes === 1 ? "" : "s"})`;
}

interface Walk {
  opts: DiffOptions;
  ignore: readonly string[];
  rows: DiffRow[];
}

function lastKey(path: string): string {
  const m = /([^.[\]]+)(?:\[\d+\])*$/.exec(path);
  return m ? m[1] : path;
}

function maskKindFor(path: string, opts: DiffOptions): MaskKind | null {
  if (opts.maskSecretData && isSecretMaskedPath(path)) return "secret";
  if (opts.maskCredentialKeys && CREDENTIAL_KEY.test(lastKey(path))) return "credential";
  return null;
}

function leafRow(path: string, left: unknown, right: unknown, w: Walk): DiffRow | null {
  const leftAbsent = left === undefined || (w.opts.emptyEqualsAbsent === true && isEmptyValue(left));
  const rightAbsent = right === undefined || (w.opts.emptyEqualsAbsent === true && isEmptyValue(right));
  if (leftAbsent && rightAbsent) return null;

  const equal =
    !leftAbsent && !rightAbsent &&
    (w.opts.emptyEqualsAbsent === true ? deepEqual(normalizeEmpty(left), normalizeEmpty(right)) : deepEqual(left, right));
  const mask = maskKindFor(path, w.opts);
  const secretField: "data" | "stringData" | null = path.startsWith("data.") ? "data" : path.startsWith("stringData.") ? "stringData" : null;

  let state: DiffState;
  if (leftAbsent) state = "added";
  else if (rightAbsent) state = "removed";
  else if (equal) state = "unchanged";
  else if (Array.isArray(left) || Array.isArray(right)) state = "replaced";
  else state = "changed";

  if (mask) {
    const row: DiffRow = {
      path,
      state,
      from: leftAbsent ? null : maskedText(left, secretField),
      to: rightAbsent ? null : maskedText(right, secretField),
      masked: mask,
    };
    if (mask === "credential") {
      row.reveal = { from: leftAbsent ? null : formatValue(left), to: rightAbsent ? null : formatValue(right) };
    }
    return row;
  }

  if (state === "replaced") {
    const row: DiffRow = {
      path,
      state,
      from: leftAbsent ? null : arraySummary(left),
      to: rightAbsent ? null : arraySummary(right),
      fromText: leftAbsent ? undefined : pretty(left),
      toText: rightAbsent ? undefined : pretty(right),
    };
    const inside = insideArray(left, right, w.opts);
    if (inside) row.inside = inside;
    return row;
  }

  return {
    path,
    state,
    from: leftAbsent ? null : formatValue(left),
    to: rightAbsent ? null : formatValue(right),
  };
}

function walk(path: string, left: unknown, right: unknown, w: Walk): void {
  if (path && pathIgnored(path, w.ignore)) return;
  const l = left === undefined || (w.opts.emptyEqualsAbsent && isPlainObject(left) && Object.keys(left).length === 0) ? undefined : left;
  const r = right === undefined || (w.opts.emptyEqualsAbsent && isPlainObject(right) && Object.keys(right).length === 0) ? undefined : right;

  const lObj = isPlainObject(l);
  const rObj = isPlainObject(r);
  const hasKeys = (v: unknown) => isPlainObject(v) && Object.keys(v).length > 0;
  // Recurse unless both sides are empty/absent: an empty object is then a leaf, so `{}`
  // against an absent key still reads as added/removed instead of vanishing.
  if ((lObj || l === undefined) && (rObj || r === undefined) && (hasKeys(l) || hasKeys(r))) {
    const keys: string[] = [];
    if (lObj) keys.push(...Object.keys(l));
    if (rObj) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    for (const k of keys) {
      walk(path ? `${path}.${k}` : k, lObj ? l[k] : undefined, rObj ? r[k] : undefined, w);
    }
    return;
  }
  const row = leafRow(path || "(root)", l, r, w);
  if (row) w.rows.push(row);
}

/**
 * Two-sided diff of two JSON values. Plain objects are walked; arrays and scalars are
 * leaves. A subtree present on one side only expands into per-leaf added/removed rows.
 */
export function diffObjects(left: unknown, right: unknown, opts: DiffOptions = {}): DiffResult {
  const w: Walk = { opts, ignore: opts.ignore ?? [], rows: [] };
  walk("", left, right, w);
  return capRows(w.rows, opts.maxChanged ?? MAX_CHANGED_ROWS);
}

/** Applies the 200-row cap to the CHANGED rows only; unchanged rows ride along uncapped. */
export function capRows(all: DiffRow[], maxChanged: number): DiffResult {
  const rows: DiffRow[] = [];
  let changed = 0;
  let more = 0;
  let unchanged = 0;
  for (const row of all) {
    if (row.state === "unchanged") {
      unchanged++;
      rows.push(row);
      continue;
    }
    changed++;
    if (changed <= maxChanged) rows.push(row);
    else more++;
  }
  return { rows, changed, more, unchanged };
}

function uniqueNames(arr: unknown[]): string[] | null {
  const names: string[] = [];
  for (const el of arr) {
    if (!isPlainObject(el) || typeof el.name !== "string") return null;
    if (names.includes(el.name)) return null;
    names.push(el.name);
  }
  return names;
}

/**
 * D3-1: per-name rows for a replaced array. Applies ONLY when both sides are arrays and
 * every element on both sides is an object with a unique string `name` (containers, env,
 * ports, volumes, volumeMounts, imagePullSecrets). Arrays without that shape (args,
 * command, rules, subjects) get no panel — text blocks only. Returns null otherwise.
 * The caller renders the fixed header "For reading only. <product> writes the whole array."
 */
export function insideArray(left: unknown, right: unknown, opts: DiffOptions = {}): DiffRow[] | null {
  if (!Array.isArray(left) || !Array.isArray(right)) return null;
  const lNames = uniqueNames(left);
  const rNames = uniqueNames(right);
  if (!lNames || !rNames) return null;
  const names = [...lNames];
  for (const n of rNames) if (!names.includes(n)) names.push(n);
  const out: DiffRow[] = [];
  for (const name of names) {
    const li = lNames.indexOf(name);
    const ri = rNames.indexOf(name);
    const prefix = `[${name}]`;
    if (li === -1) {
      out.push({ path: prefix, state: "added", from: null, to: formatValue(right[ri]) });
      continue;
    }
    if (ri === -1) {
      out.push({ path: prefix, state: "removed", from: formatValue(left[li]), to: null });
      continue;
    }
    // `name` itself is the key, so it is never a difference.
    const sub = diffObjects(left[li], right[ri], { ...opts, ignore: [...(opts.ignore ?? []), "name"], maxChanged: Infinity });
    for (const row of sub.rows) {
      if (row.state === "unchanged") continue;
      out.push({ ...row, path: `${prefix} ${row.path}` });
    }
  }
  return out;
}

/** Parent object path of a row, for collapsing unchanged rows per group. */
export function parentPath(path: string): string {
  const i = Math.max(path.lastIndexOf("."), path.lastIndexOf("["));
  return i <= 0 ? "" : path.slice(0, i);
}

// ─── #10: dropped-by-schema ──────────────────────────────────────────────────
// `dropped_paths` (Rust) lists fields present in the RAW live object that the typed
// k8s-openapi round trip loses. The dry-run `result` is that typed round trip, so each
// dropped field also shows up as a `removed` row (or inside a `replaced` array). Strip
// them from the live side BEFORE diffing, so the only differences left are real ones,
// then render the dropped list itself as `dropped` rows.

const DELETED = Symbol("deleted");

function tokenizeAt(node: unknown, rest: string): { key: string | number; after: string } | null {
  if (rest.startsWith("[")) {
    const m = /^\[(\d+)\]/.exec(rest);
    if (!m || !Array.isArray(node)) return null;
    return { key: Number(m[1]), after: rest.slice(m[0].length).replace(/^\./, "") };
  }
  if (!isPlainObject(node)) return null;
  // Keys may themselves contain dots (annotations), so prefer the LONGEST key that fits.
  let best: string | null = null;
  for (const k of Object.keys(node)) {
    if (rest === k || rest.startsWith(`${k}.`) || rest.startsWith(`${k}[`)) {
      if (best === null || k.length > best.length) best = k;
    }
  }
  if (best === null) return null;
  return { key: best, after: rest.slice(best.length).replace(/^\./, "") };
}

function deleteAt(node: unknown, rest: string): boolean {
  const tok = tokenizeAt(node, rest);
  if (!tok) return false;
  const container = node as Record<string | number, unknown>;
  if (tok.after === "") {
    if (Array.isArray(node) && typeof tok.key === "number") {
      container[tok.key] = DELETED;
    } else {
      delete container[tok.key as string];
    }
    return true;
  }
  return deleteAt(container[tok.key as string | number], tok.after);
}

function compactDeleted(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.filter((v) => v !== DELETED).map(compactDeleted);
  }
  if (isPlainObject(node)) {
    for (const k of Object.keys(node)) node[k] = compactDeleted(node[k]);
  }
  return node;
}

export function getAtPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  let rest = path;
  while (rest !== "") {
    const tok = tokenizeAt(node, rest);
    if (!tok) return undefined;
    node = (node as Record<string | number, unknown>)[tok.key];
    rest = tok.after;
  }
  return node;
}

/** A deep copy of `obj` without the given dotted/`[i]` paths. Unresolvable paths are ignored. */
export function removePaths<T>(obj: T, paths: readonly string[]): T {
  const copy = JSON.parse(JSON.stringify(obj)) as T;
  for (const p of paths) deleteAt(copy, p);
  return compactDeleted(copy) as T;
}

/** `dropped` rows for the callout, one per path, valued from the live object. */
export function droppedRows(live: unknown, paths: readonly string[]): DiffRow[] {
  return paths.map((p) => ({
    path: p,
    state: "dropped" as const,
    from: formatValue(getAtPath(live, p)),
    to: null,
  }));
}

export interface YamlSaveDiff {
  result: DiffResult;
  dropped: DiffRow[];
}

/**
 * The #10 diff: the live object NOW (minus fields the schema would drop) against the
 * object the server would store. A raw live object and a typed re-serialisation differ in
 * null/empty handling, so empty and absent compare equal.
 */
export function yamlSaveDiff(live: unknown, result: unknown, droppedPathList: readonly string[]): YamlSaveDiff {
  const base = droppedPathList.length > 0 ? removePaths(live, droppedPathList) : live;
  return {
    result: diffObjects(base, result, { ignore: K8S_IGNORED, emptyEqualsAbsent: true, maskSecretData: true }),
    dropped: droppedRows(live, droppedPathList),
  };
}

// ─── #37: Helm values ────────────────────────────────────────────────────────

/** Values diff with credential-looking keys masked (D3-3). */
export function helmValuesDiff(current: unknown, next: unknown): DiffResult {
  return diffObjects(current ?? {}, next ?? {}, { maskCredentialKeys: true, emptyEqualsAbsent: false });
}

/** One-line chip text: "4 changes", "No differences". */
export function changeCountText(changed: number): string {
  return changed === 0 ? "No differences" : `${changed} change${changed === 1 ? "" : "s"}`;
}
