// Source-group helpers for the log viewers (v1.3.0, F4): Range, display
// timestamps, per-viewer remembered preferences, multi-pod ordering and the
// distinguishing pod tag. Pure except `loadLogPrefs`/`saveLogPrefs`, which wrap
// localStorage in try/catch (per-viewer conveniences only). No React.

import { MAX_LOG_LINES } from "./logBuffer";
import { isForbidden } from "./observability";

// ─── Range ───────────────────────────────────────────────────────────────────

export type RangeId = "lines200" | "m5" | "m15" | "h1" | "h6" | "h24" | "d7" | "lines5000" | "custom";
export type CustomUnit = "minutes" | "hours" | "days";

export interface RangeSpec {
  id: RangeId;
  /** Only meaningful for id "custom". */
  value?: number;
  unit?: CustomUnit;
}

export const DEFAULT_RANGE: RangeSpec = { id: "lines200" };

export const RANGE_OPTIONS: { id: RangeId; label: string }[] = [
  { id: "lines200", label: "Last 200 lines" },
  { id: "m5", label: "Last 5 minutes" },
  { id: "m15", label: "Last 15 minutes" },
  { id: "h1", label: "Last 1 hour" },
  { id: "h6", label: "Last 6 hours" },
  { id: "h24", label: "Last 24 hours" },
  // 02 §5.1 says "All retained"; every request is bounded server-side (5000), so
  // the honest label is the bound (tech-lead override, brief §1.5 item 1).
  { id: "lines5000", label: "Up to 5,000 lines" },
  { id: "custom", label: "Custom…" },
];

const UNIT_SECONDS: Record<CustomUnit, number> = { minutes: 60, hours: 3600, days: 86400 };
const PRESET_SECONDS: Partial<Record<RangeId, number>> = { m5: 300, m15: 900, h1: 3600, h6: 21600, h24: 86400, d7: 604800 };

/** null when valid, else the inline error text. */
export function validateCustomRange(value: string, unit: CustomUnit): string | null {
  const t = value.trim();
  if (!/^\d+$/.test(t)) return "Enter a whole number greater than 0.";
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 1) return "Enter a whole number greater than 0.";
  if (n * UNIT_SECONDS[unit] > Number.MAX_SAFE_INTEGER) return "Enter a whole number greater than 0.";
  return null;
}

export interface ResolvedRange {
  tailLines: number;
  sinceSeconds?: number;
}

/**
 * Range -> request params. A time range is sent as `since_seconds` PLUS
 * `tail_lines = 5000`, so it can never exceed the ring buffer (Q-L1: the log API
 * applies the window, then keeps the last N lines).
 */
export function resolveRange(r: RangeSpec): ResolvedRange {
  switch (r.id) {
    case "lines200": return { tailLines: 200 };
    case "lines5000": return { tailLines: MAX_LOG_LINES };
    case "custom": {
      const unit = r.unit ?? "minutes";
      if (r.value === undefined || validateCustomRange(String(r.value), unit)) return { tailLines: 200 };
      return { tailLines: MAX_LOG_LINES, sinceSeconds: r.value * UNIT_SECONDS[unit] };
    }
    default: {
      const s = PRESET_SECONDS[r.id];
      return s ? { tailLines: MAX_LOG_LINES, sinceSeconds: s } : { tailLines: 200 };
    }
  }
}

/** The phrase used in "Reloading from the last 15 minutes..." */
export function rangePhrase(r: RangeSpec): string {
  switch (r.id) {
    case "lines200": return "the last 200 lines";
    case "lines5000": return "up to 5,000 lines";
    case "m5": return "the last 5 minutes";
    case "m15": return "the last 15 minutes";
    case "h1": return "the last 1 hour";
    case "h6": return "the last 6 hours";
    case "h24": return "the last 24 hours";
    case "d7": return "the last 7 days";
    case "custom": {
      const unit = r.unit ?? "minutes";
      const v = r.value ?? 0;
      return `the last ${v} ${v === 1 ? unit.slice(0, -1) : unit}`;
    }
  }
}

/** A stable string for effect deps / reload detection. */
export function rangeKey(r: RangeSpec): string {
  return r.id === "custom" ? `custom:${r.value ?? ""}:${r.unit ?? ""}` : r.id;
}

// ─── Backend history (v2.3.0 #16b) ───────────────────────────────────────────

/** The History source's own ranges; the pod-log range is kept separately and never clobbered. */
export const HISTORY_RANGES = ["h1", "h6", "h24", "d7"] as const;
export type HistoryRangeId = (typeof HISTORY_RANGES)[number];
export const HISTORY_OPTIONS: { id: RangeId; label: string }[] = [
  { id: "h1", label: "Last 1 hour" },
  { id: "h6", label: "Last 6 hours" },
  { id: "h24", label: "Last 24 hours" },
  { id: "d7", label: "Last 7 days" },
];
const HISTORY_KEY = "log-history-range";

export function loadHistoryRange(): HistoryRangeId {
  try {
    const v = localStorage.getItem(HISTORY_KEY);
    return (HISTORY_RANGES as readonly string[]).includes(v ?? "") ? (v as HistoryRangeId) : "h1";
  } catch {
    return "h1";
  }
}
export function saveHistoryRange(id: HistoryRangeId): void {
  try { localStorage.setItem(HISTORY_KEY, id); } catch { /* per-viewer convenience only */ }
}

/** Unix-second window for query_backend_logs. */
export function historyWindow(id: HistoryRangeId, nowSec: number): { start: number; end: number } {
  const end = Math.floor(nowSec);
  return { start: end - (PRESET_SECONDS[id] ?? 3600), end };
}

/** Feeds parseLogLine(raw, true) unchanged: the backend timestamp is the line's leading token. */
export const backendRaw = (l: { ts: string; line: string }) => `${l.ts} ${l.line}`;

export const HISTORY_ALWAYS_TS = "History always shows timestamps.";
export const HISTORY_NO_PREVIOUS = "History already includes earlier container instances.";
export const HISTORY_NO_FOLLOW = "History doesn't stream.";
export const HISTORY_CAPPED = "Showing the latest 5,000 lines of this range.";

const sansThe = (id: HistoryRangeId) => rangePhrase({ id }).replace(/^the /, "");
export const historyLoadingText = (flavour: string) => `Loading history from ${flavour}…`;
export const historyShownText = (flavour: string, id: HistoryRangeId) => `Showing history from ${flavour}, ${sansThe(id)}.`;
export const historyEmptyText = (flavour: string, id: HistoryRangeId) => `No log lines from ${flavour} for this pod in ${rangePhrase({ id })}.`;
/** The strip above the pod log after History failed; the control has already reverted to Pod log. */
export const historyFailText = (message: string, namespace: string) =>
  isForbidden(message) ? `No access to services/proxy in ${namespace}. Showing the pod's current log.` : "Log history unavailable, showing the pod's current log.";

// ─── Remembered preferences ──────────────────────────────────────────────────

export type LogZone = "local" | "utc";
export type LogViewerKind = "single" | "multi";

export interface LogPrefs {
  range: RangeSpec;
  timestamps: boolean;
  zone: LogZone;
}

/** D-L3: timestamps off for a single pod, ON for multi-pod. */
export function defaultLogPrefs(kind: LogViewerKind): LogPrefs {
  return { range: DEFAULT_RANGE, timestamps: kind === "multi", zone: "local" };
}

const RANGE_IDS: RangeId[] = ["lines200", "m5", "m15", "h1", "h6", "h24", "lines5000", "custom"];

/** Tolerant parse: anything malformed falls back to the default for that field. */
export function parseLogPrefs(json: string | null, kind: LogViewerKind): LogPrefs {
  const d = defaultLogPrefs(kind);
  if (!json) return d;
  try {
    const o: unknown = JSON.parse(json);
    if (typeof o !== "object" || o === null) return d;
    const r = o as Record<string, unknown>;
    let range = d.range;
    const rr = r.range as Record<string, unknown> | undefined;
    if (rr && typeof rr === "object" && RANGE_IDS.includes(rr.id as RangeId)) {
      range = { id: rr.id as RangeId };
      if (rr.id === "custom") {
        const unit = rr.unit as CustomUnit;
        if (
          (unit === "minutes" || unit === "hours" || unit === "days") &&
          typeof rr.value === "number" &&
          validateCustomRange(String(rr.value), unit) === null
        ) {
          range = { id: "custom", value: rr.value, unit };
        } else {
          range = d.range;
        }
      }
    }
    return {
      range,
      timestamps: typeof r.timestamps === "boolean" ? r.timestamps : d.timestamps,
      zone: r.zone === "utc" || r.zone === "local" ? r.zone : d.zone,
    };
  } catch {
    return d;
  }
}

const PREFS_KEY = (kind: LogViewerKind) => `log-prefs-${kind}`;

export function loadLogPrefs(kind: LogViewerKind): LogPrefs {
  try {
    return parseLogPrefs(localStorage.getItem(PREFS_KEY(kind)), kind);
  } catch {
    return defaultLogPrefs(kind);
  }
}

export function saveLogPrefs(kind: LogViewerKind, prefs: LogPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY(kind), JSON.stringify(prefs));
  } catch {
    /* per-viewer convenience only */
  }
}

// ─── Timestamp display (02 §3.6) ─────────────────────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

interface Parts { mo: number; d: number; h: number; mi: number; s: number; ms: number }

function partsOf(dt: Date, zone: LogZone): Parts {
  return zone === "utc"
    ? { mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds(), ms: dt.getUTCMilliseconds() }
    : { mo: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes(), s: dt.getSeconds(), ms: dt.getMilliseconds() };
}

/**
 * `HH:MM:SS.mmm` in the chosen zone; a leading `MM-DD ` only when `withDate`
 * (the loaded range crosses midnight); a `Z` suffix in UTC so the zone is never
 * ambiguous. Returns the input unchanged if it does not parse.
 */
export function formatLogTime(iso: string, zone: LogZone, withDate: boolean): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const p = partsOf(dt, zone);
  const time = `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}.${pad(p.ms, 3)}`;
  return `${withDate ? `${pad(p.mo)}-${pad(p.d)} ` : ""}${time}${zone === "utc" ? "Z" : ""}`;
}

/** True when the two instants fall on different calendar days in `zone`. */
export function crossesMidnight(firstIso: string | undefined, lastIso: string | undefined, zone: LogZone): boolean {
  if (!firstIso || !lastIso) return false;
  const a = new Date(firstIso);
  const b = new Date(lastIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  const pa = partsOf(a, zone);
  const pb = partsOf(b, zone);
  return pa.mo !== pb.mo || pa.d !== pb.d;
}

// ─── Multi-pod: which pods stream, and how they are tagged ───────────────────

export const MAX_STREAM_PODS = 20;

interface OrderablePod {
  name: string;
  status: string;
  ready: string;
  restarts: number;
}

/** "1/2" -> false; "2/2" -> true; unparseable -> judged by status. */
function podIsReady(p: OrderablePod): boolean {
  const m = /^(\d+)\/(\d+)$/.exec(p.ready);
  if (m) return Number(m[1]) >= Number(m[2]) && p.status !== "Failed";
  return p.status === "Running" || p.status === "Succeeded";
}

/** D-L7: pods that are not ready or have restarted come first, then by name. Stable; does not mutate. */
export function orderPodsForStreaming<T extends OrderablePod>(pods: readonly T[]): T[] {
  const rank = (p: T) => (!podIsReady(p) || p.restarts > 0 ? 0 : 1);
  return [...pods].sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The distinguishing tail of each pod name (02 §3.7 "Pod tag"): the name with
 * the prefix shared by ALL the pods removed, at least 5 characters (or the
 * whole name if shorter), never truncated from the end. Colliding tags are
 * extended leftwards until they differ.
 */
export function podTags(names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (names.length === 0) return out;
  let prefix = names[0];
  for (const n of names) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const start: Record<string, number> = {};
  for (const n of names) start[n] = Math.max(0, Math.min(prefix.length, n.length - 5));
  for (let guard = 0; guard < 256; guard++) {
    const seen = new Map<string, string[]>();
    for (const n of names) {
      const t = n.slice(start[n]);
      seen.set(t, [...(seen.get(t) ?? []), n]);
    }
    let changed = false;
    for (const group of seen.values()) {
      if (group.length < 2) continue;
      for (const n of group) {
        if (start[n] > 0) { start[n] -= 1; changed = true; }
      }
    }
    if (!changed) break;
  }
  for (const n of names) out[n] = n.slice(start[n]);
  return out;
}

/** Display form: an ellipsis when the tag is a tail of a longer name. */
export function podTagLabel(name: string, tag: string): string {
  return tag.length < name.length ? `…${tag}` : tag;
}
