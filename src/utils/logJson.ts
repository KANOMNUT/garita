// JSON view helpers for the log viewers (docs/impl/v1.3.1-tasks.md F2, §0.3 UXP-5; 02 §3.5).
// Pure, never throws. Parsing is the caller's job (`parseJsonObject`) and happens lazily,
// only for rows that are visible AND (summarised or expanded), cached per row.

/** At most this many rows may be expanded at once; expanding one more collapses the oldest (Q-L12). */
export const MAX_EXPANDED_JSON = 200;

/** Expand / collapse `seq`. Insertion order is age, so the OLDEST is dropped past the cap. */
export function toggleExpanded(expanded: readonly number[], seq: number, max: number = MAX_EXPANDED_JSON): number[] {
  if (expanded.includes(seq)) return expanded.filter((s) => s !== seq);
  const next = [...expanded, seq];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** True when expanding `seq` would push the list past the cap (the oldest row is then collapsed). */
export function expandDropsOldest(expanded: readonly number[], seq: number, max: number = MAX_EXPANDED_JSON): boolean {
  return !expanded.includes(seq) && expanded.length >= max;
}

export const EXPAND_CAP_NOTICE = `Up to ${MAX_EXPANDED_JSON} JSON rows can be expanded at once. The oldest expanded row was collapsed.`;

const MESSAGE_KEYS = ["msg", "message", "log", "event"] as const;
const LEVEL_KEYS = ["level", "severity", "lvl", "levelname"];
const TIME_KEYS = ["ts", "time", "timestamp", "@timestamp"];
export const MAX_SUMMARY_FIELDS = 6;
export const LONG_VALUE_CHARS = 120;

export interface JsonField { key: string; value: string; long: boolean }
export interface JsonSummary {
  /** The first present of msg, message, log, event; "" when none. */
  message: string;
  /** Up to 6 remaining top-level SCALAR keys as key=value. */
  fields: JsonField[];
}

function scalarText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  return null;
}

/**
 * Summary of a parsed JSON log object. The level word is the line's own (`ParsedLogLine.word`),
 * so the level and time keys are skipped here, as is the key the message came from. Nested
 * objects and arrays are not scalars and are left to the expanded view.
 */
export function summarizeJson(obj: Record<string, unknown>): JsonSummary {
  let message = "";
  let messageKey: string | null = null;
  for (const k of MESSAGE_KEYS) {
    if (k in obj) {
      const t = scalarText(obj[k]);
      message = t ?? JSON.stringify(obj[k]);
      messageKey = k;
      break;
    }
  }
  const fields: JsonField[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    if (fields.length >= MAX_SUMMARY_FIELDS) break;
    if (key === messageKey || LEVEL_KEYS.includes(key) || TIME_KEYS.includes(key)) continue;
    const value = scalarText(raw);
    if (value === null) continue;
    fields.push({ key, value, long: value.length > LONG_VALUE_CHARS });
  }
  return { message, fields };
}

export function prettyJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return "";
  }
}
