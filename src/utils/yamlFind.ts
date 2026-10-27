// YAML find (v2.3.1, docs/ux/22-v2.3.1-search-and-filter.md section 4, docs/impl/v2.3.1-tasks.md 3.3).
// Pure and React-free. The matcher is the log viewers' literal matcher (`logFilter.ts`); nothing here
// reads a query cache or any text other than the string the caller passes in (Secret rule S1).

import { compileMatcher, findRanges, markSegments, type Range } from "./logFilter";

/** Hint line copy when a query has no matches (UX 22 4.7, 4.11). */
export const NEAT_NO_MATCH_HINT = "Not found in the neat view. Managed fields, status and other server-set fields are hidden.";
export const REDACTED_NO_MATCH_HINT = "Not found. Values under credential-looking keys are redacted in this view.";

/** Most matches marked and stepped through. */
export const FIND_CAP = 1000;

/**
 * Appended to the edit-view mirror text. A textarea shows an empty last line after a trailing "\n";
 * a div does not. Zero width, so it never changes a wrap.
 */
export const MIRROR_TAIL = "\u200B";

/**
 * Matches of `query` in `text`: literal, case-insensitive, non-overlapping, in order. A blank query
 * (`query.trim() === ""`) has no matches; otherwise the query is used as typed, spaces included.
 * `more` is true when there are over `cap` matches; `ranges` then holds the first `cap`.
 * The regex runs on the original string, so offsets are offsets into `text` even where lower-casing
 * would change a length.
 */
export function yamlMatches(text: string, query: string, cap: number = FIND_CAP): { ranges: Range[]; more: boolean } {
  if (query.trim() === "") return { ranges: [], more: false };
  const all = findRanges(text, compileMatcher(query, false, false), cap + 1);
  return all.length > cap ? { ranges: all.slice(0, cap), more: true } : { ranges: all, more: false };
}

export type YamlMark = "none" | "match" | "current";

/**
 * `text` cut into consecutive pieces: unmarked, another match, or the current match (`current` indexes
 * `ranges`). The pieces always join back to `text`, so a mirror built from them equals the buffer.
 */
export function yamlSegments(
  text: string, ranges: readonly Range[], current: number | null,
): { text: string; mark: YamlMark }[] {
  const cur = current !== null && current >= 0 && current < ranges.length ? [ranges[current]] : [];
  return markSegments(text, 0, text.length, ranges, cur).map((s) => ({
    text: s.text,
    mark: s.kind === "plain" ? "none" : s.kind === "match" ? "match" : "current",
  }));
}

/** Index of the first range starting at or after `caret`, wrapping to 0; null when there are no ranges. */
export function firstAtOrAfter(ranges: readonly Range[], caret: number): number | null {
  if (ranges.length === 0) return null;
  const i = ranges.findIndex((r) => r.start >= caret);
  return i === -1 ? 0 : i;
}

/** 1-based line of `offset` (an offset past the end counts as the last line). */
export function lineOf(text: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < end; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

/** The visible count inside the input: "" (blank query), "3 of 12", "1 of 1000+", "No matches", "Nothing to search.". */
export function findCountText(query: string, textEmpty: boolean, current: number | null, total: number, more: boolean): string {
  if (textEmpty) return "Nothing to search.";
  if (query.trim() === "") return "";
  if (total === 0) return "No matches";
  return `${(current ?? 0) + 1} of ${total}${more ? "+" : ""}`;
}

/**
 * The live-region text. Counts and positions only, never the query (S4):
 * "12 matches", "1 match", "No matches", "3 of 12", "3 of 12, line 48", "1 of 12, wrapped".
 */
export function findStatusText(
  kind: "count" | "step", current: number | null, total: number, more: boolean, line?: number, wrapped?: boolean,
): string {
  if (total === 0) return "No matches";
  if (kind === "count") {
    if (more) return `More than ${total} matches. Showing the first ${total}.`;
    return total === 1 ? "1 match" : `${total} matches`;
  }
  return `${(current ?? 0) + 1} of ${total}${more ? "+" : ""}${line !== undefined ? `, line ${line}` : ""}${wrapped ? ", wrapped" : ""}`;
}

/** Cmd+F on macOS, Ctrl+F elsewhere; the other combination is left alone. No Shift, no Alt, not composing. */
export function shortcutMatches(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; isComposing: boolean },
  isMac: boolean,
): boolean {
  if (e.key.toLowerCase() !== "f" || e.shiftKey || e.altKey || e.isComposing) return false;
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** Prefill for the input: the selection when it is one non-blank line of 1 to 120 characters, else null. */
export function prefillFrom(selection: string): string | null {
  if (selection.length < 1 || selection.length > 120) return null;
  if (/[\r\n]/.test(selection) || selection.trim() === "") return null;
  return selection;
}

/**
 * The textarea `scrollTop` that puts the line at `lineTop` at least two lines inside the visible area
 * (`viewHeight` tall, scrolled to `scrollTop`); unchanged when it already is. `lineTop` is the current
 * mirror mark's `offsetTop`, which is in the textarea's scroll coordinates (same padding, same wrap).
 * A view too short for two lines of margin gets a smaller margin, so the line is always reachable.
 */
export function scrollTopFor(lineTop: number, lineHeight: number, scrollTop: number, viewHeight: number): number {
  const margin = Math.min(2 * lineHeight, Math.max(0, (viewHeight - lineHeight) / 2));
  if (lineTop < scrollTop + margin) return Math.max(0, lineTop - margin);
  const lineBottom = lineTop + lineHeight;
  if (lineBottom > scrollTop + viewHeight - margin) return Math.max(0, lineBottom + margin - viewHeight);
  return scrollTop;
}
