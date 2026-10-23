// View-group filtering for the log viewers (docs/impl/v1.3.1-tasks.md F2, §0.3 UXP-3..5,
// 9..11). Pure and React-free; never throws on any input (log lines are untrusted bytes).
//
// Include / Exclude / Highlight match `ParsedLogLine.body` — the line WITHOUT the
// Kubernetes timestamp prefix — never `raw` and never HTML-escaped text. Each pattern is
// compiled ONCE per (text, regex, case); zero-length matches (`.*`, `x*`) neither mark nor
// count. Marks are returned as ranges so the renderer can draw React segments: there is no
// `dangerouslySetInnerHTML` anywhere in the viewers.

import type { LogLevel, ParsedLogLine } from "./logParse";

// ─── View state (lifted into the detail panel; NEVER persisted) ──────────────

export interface LogViewState {
  include: string;
  exclude: string;
  highlight: string;
  regex: boolean;
  caseSensitive: boolean;
  /** Levels the user switched OFF. Empty = every level shown, so the default view equals today's. */
  hiddenLevels: LogLevel[];
  json: boolean;
  wrap: boolean;
  // Multi-pod only. Narrowing is a SOURCE control (it changes which pods stream and reloads);
  // hiding is a view filter. Both live here so a tab switch does not lose them.
  narrowNode: string | null;
  narrowZone: string | null;
  hiddenPods: string[];
}

export type LogViewKind = "single" | "multi";

/** Wrap defaults ON in Multi (its shipped body already wraps) and OFF in the single viewer. */
export function defaultLogView(kind: LogViewKind): LogViewState {
  return {
    include: "",
    exclude: "",
    highlight: "",
    regex: false,
    caseSensitive: false,
    hiddenLevels: [],
    json: false,
    wrap: kind === "multi",
    narrowNode: null,
    narrowZone: null,
    hiddenPods: [],
  };
}

export const ALL_LEVELS: readonly LogLevel[] = ["ERROR", "WARN", "INFO", "DEBUG", "none"];
export const LEVEL_WORD: Record<LogLevel, string> = {
  ERROR: "ERROR", WARN: "WARN", INFO: "INFO", DEBUG: "DEBUG", none: "no level",
};
export const LEVEL_GLYPH: Record<LogLevel, string> = { ERROR: "✕", WARN: "▲", INFO: "●", DEBUG: "○", none: "–" };
export const LEVEL_LETTER: Record<LogLevel, string> = { ERROR: "E", WARN: "W", INFO: "I", DEBUG: "D", none: "–" };

// ─── Matchers ────────────────────────────────────────────────────────────────

export interface Range { start: number; end: number }

export interface Matcher {
  /** Global; callers must reset `lastIndex` (the helpers below do). */
  re: RegExp;
  /** Regex mode was on but the pattern did not compile: it matches as plain text instead. */
  invalid: boolean;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compiles ONE pattern. Empty text → null. An invalid regex falls back to plain text. */
export function compileMatcher(text: string, regex: boolean, caseSensitive: boolean): Matcher | null {
  if (text === "") return null;
  const flags = caseSensitive ? "g" : "gi";
  if (regex) {
    try {
      return { re: new RegExp(text, flags), invalid: false };
    } catch {
      return { re: new RegExp(escapeRegex(text), flags), invalid: true };
    }
  }
  return { re: new RegExp(escapeRegex(text), flags), invalid: false };
}

const MAX_RANGES_PER_LINE = 200;

/** Non-empty match ranges in `text`, in order. Zero-length matches are skipped. */
export function findRanges(text: string, m: Matcher | null, limit = MAX_RANGES_PER_LINE): Range[] {
  if (!m) return [];
  const out: Range[] = [];
  const re = m.re;
  re.lastIndex = 0;
  let r: RegExpExecArray | null;
  while (out.length < limit && (r = re.exec(text)) !== null) {
    if (r[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: r.index, end: r.index + r[0].length });
  }
  re.lastIndex = 0;
  return out;
}

/** True when `text` has at least one NON-EMPTY match. */
export function matchesLine(text: string, m: Matcher | null): boolean {
  if (!m) return false;
  const re = m.re;
  re.lastIndex = 0;
  let r: RegExpExecArray | null;
  let found = false;
  while ((r = re.exec(text)) !== null) {
    if (r[0].length > 0) { found = true; break; }
    re.lastIndex++;
  }
  re.lastIndex = 0;
  return found;
}

export interface CompiledFilters {
  include: Matcher | null;
  exclude: Matcher | null;
  highlight: Matcher | null;
  hidden: ReadonlySet<LogLevel>;
}

export function compileFilters(v: LogViewState): CompiledFilters {
  return {
    include: compileMatcher(v.include, v.regex, v.caseSensitive),
    exclude: compileMatcher(v.exclude, v.regex, v.caseSensitive),
    highlight: compileMatcher(v.highlight, v.regex, v.caseSensitive),
    hidden: new Set(v.hiddenLevels),
  };
}

/** Passes Include and Exclude only (the level filter excluded) — what the level counts are over. */
export function passesText(line: ParsedLogLine, f: CompiledFilters): boolean {
  if (f.exclude && matchesLine(line.body, f.exclude)) return false;
  if (f.include && !matchesLine(line.body, f.include)) return false;
  return true;
}

/** Exclude wins over Include; then the level filter. */
export function passesFilters(line: ParsedLogLine, f: CompiledFilters): boolean {
  return passesText(line, f) && !f.hidden.has(line.lvl);
}

/** Level chip counts: loaded lines that pass Include and Exclude (not the level filter itself). */
export function levelCounts(lines: readonly ParsedLogLine[], f: CompiledFilters): Record<LogLevel, number> {
  const out: Record<LogLevel, number> = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, none: 0 };
  for (const l of lines) if (passesText(l, f)) out[l.lvl]++;
  return out;
}

/** Whether any filter currently HIDES lines. Highlight only marks, so it does not count. */
export function isFiltering(v: LogViewState): boolean {
  return v.include !== "" || v.exclude !== "" || v.hiddenLevels.length > 0;
}

// ─── Active-filter strip ─────────────────────────────────────────────────────

export type ChipId = "include" | "exclude" | "highlight" | "levels" | "regex" | "case";
export interface FilterChip { id: ChipId; label: string }

export function levelsChipLabel(hidden: readonly LogLevel[]): string {
  const ordered = ALL_LEVELS.filter((l) => hidden.includes(l));
  return `levels: ${ordered.map((l) => `no ${LEVEL_WORD[l].replace(/^no /, "")}`).join(", ")}`;
}

/**
 * The chips of the active-filter strip. Include is NOT one (it is always visible in the
 * bar); regex / case only appear in compact mode, where the toggles live inside the closed
 * popover and Include would otherwise silently change meaning while looking plain (UXP-11.2).
 */
export function activeChips(v: LogViewState, compact: boolean): FilterChip[] {
  const chips: FilterChip[] = [];
  if (v.exclude !== "") chips.push({ id: "exclude", label: `exclude: ${v.exclude}` });
  if (v.highlight !== "") chips.push({ id: "highlight", label: `highlight: ${v.highlight}` });
  if (v.hiddenLevels.length > 0) chips.push({ id: "levels", label: levelsChipLabel(v.hiddenLevels) });
  if (compact && v.regex) chips.push({ id: "regex", label: "regex" });
  if (compact && v.caseSensitive) chips.push({ id: "case", label: "case" });
  return chips;
}

/** "Filters (n)": the number of strip chips other than Include. Wrap and JSON are display modes and do not count. */
export function filtersCount(v: LogViewState, compact: boolean): number {
  return activeChips(v, compact).length;
}

export function removeChip(v: LogViewState, id: ChipId): LogViewState {
  switch (id) {
    case "include": return { ...v, include: "" };
    case "exclude": return { ...v, exclude: "" };
    case "highlight": return { ...v, highlight: "" };
    case "levels": return { ...v, hiddenLevels: [] };
    case "regex": return { ...v, regex: false };
    case "case": return { ...v, caseSensitive: false };
  }
}

/** "Clear all" / "Clear filters": the text filters and the level filter. Display modes stay. */
export function clearFilters(v: LogViewState): LogViewState {
  return { ...v, include: "", exclude: "", highlight: "", hiddenLevels: [] };
}

export function toggleLevel(v: LogViewState, lvl: LogLevel): LogViewState {
  const hidden = v.hiddenLevels.includes(lvl) ? v.hiddenLevels.filter((l) => l !== lvl) : [...v.hiddenLevels, lvl];
  return { ...v, hiddenLevels: hidden };
}

// ─── Count and empty-state copy ──────────────────────────────────────────────

/** "{loaded} lines" with no filter, "{visible} of {loaded} lines" while one hides lines. */
export function countText(loaded: number, visible: number, filtering: boolean): string {
  const n = (x: number) => x.toLocaleString("en-US");
  return filtering ? `${n(visible)} of ${n(loaded)} lines` : `${n(loaded)} lines`;
}

export function filteredEmptyText(loaded: number): string {
  return `No lines match. ${loaded.toLocaleString("en-US")} loaded lines are hidden by the filters.`;
}

// ─── Rendering marks as segments (no dangerouslySetInnerHTML) ────────────────

export type SegKind = "plain" | "match" | "highlight" | "both";
export interface Segment { text: string; kind: SegKind }

/**
 * Splits `body.slice(start, end)` into segments, marking the parts covered by the Include
 * ranges and the Highlight ranges (both given in `body` offsets). Slicing by [start, end)
 * is what lets the legacy `HH:MM:SS.fff LEVEL msg` shape, rendered as three columns, still
 * mark a match in the level word: each column asks for its own slice of the same body.
 */
export function markSegments(
  body: string, start: number, end: number, include: readonly Range[], highlight: readonly Range[],
): Segment[] {
  const s = Math.max(0, start);
  const e = Math.min(body.length, end);
  if (e <= s) return [];
  if (include.length === 0 && highlight.length === 0) return [{ text: body.slice(s, e), kind: "plain" }];

  const cuts = new Set<number>([s, e]);
  for (const r of [...include, ...highlight]) {
    if (r.end <= s || r.start >= e) continue;
    cuts.add(Math.max(s, r.start));
    cuts.add(Math.min(e, r.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const covered = (ranges: readonly Range[], from: number, to: number) => ranges.some((r) => r.start <= from && r.end >= to);

  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const inc = covered(include, from, to);
    const hl = covered(highlight, from, to);
    const kind: SegKind = inc && hl ? "both" : hl ? "highlight" : inc ? "match" : "plain";
    const text = body.slice(from, to);
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) prev.text += text;
    else out.push({ text, kind });
  }
  return out;
}

// ─── Highlight navigation ("Match 3 of 17") ──────────────────────────────────
// Counts LINES that survive Include, Exclude and the level filter (a hidden line cannot be
// navigated to) and that contain at least one Highlight match. Anchored by `seq`, not by
// array index: the buffer is a ring, so indexes shift under every row while streaming.

export function matchSeqs<T extends { seq: number }>(
  visible: readonly T[], bodyOf: (t: T) => string, hl: Matcher | null,
): number[] {
  if (!hl) return [];
  const out: number[] = [];
  for (const t of visible) if (matchesLine(bodyOf(t), hl)) out.push(t.seq);
  return out;
}

/** Next / previous match, wrapping. With no (valid) active match, next = first and previous = last. */
export function stepMatch(matches: readonly number[], active: number | null, dir: 1 | -1): number | null {
  if (matches.length === 0) return null;
  const i = active === null ? -1 : matches.indexOf(active);
  if (i === -1) return dir === 1 ? matches[0] : matches[matches.length - 1];
  return matches[(i + dir + matches.length) % matches.length];
}

export function matchPosition(matches: readonly number[], active: number | null): { index: number; total: number } | null {
  if (matches.length === 0) return null;
  const i = active === null ? -1 : matches.indexOf(active);
  return { index: i + 1, total: matches.length };
}

/** Keeps only seqs still in the buffer (membership, NOT seq below the first line: Reconnect removes from the middle). */
export function pruneToPresent(seqs: readonly number[], present: ReadonlySet<number>): number[] {
  return seqs.filter((s) => present.has(s));
}

/** Column offsets of the legacy `HH:MM:SS.fff LEVEL msg` shape inside `body`, or null. */
export interface LegacyColumns {
  ts: Range;
  word: Range;
  msg: Range;
}

const LEGACY_COLS = /^(\d{2}:\d{2}:\d{2}\.\d+)(\s+)(INFO|WARN|ERROR|FATAL|DEBUG)(\s+)([\s\S]*)$/;

export function legacyColumns(body: string): LegacyColumns | null {
  const m = LEGACY_COLS.exec(body);
  if (!m) return null;
  const tsEnd = m[1].length;
  const wordStart = tsEnd + m[2].length;
  const wordEnd = wordStart + m[3].length;
  const msgStart = wordEnd + m[4].length;
  return {
    ts: { start: 0, end: tsEnd },
    word: { start: wordStart, end: wordEnd },
    msg: { start: msgStart, end: body.length },
  };
}
