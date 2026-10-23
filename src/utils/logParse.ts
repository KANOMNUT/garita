// Pure log-line parsing for LogViewer and MultiLogViewer (v1.3.0, F3).
// No React, no DOM, never throws on any input: log lines are untrusted bytes
// from the cluster. Tested in logParse.test.ts.

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "none";

export interface ParsedLogLine {
  /** The line exactly as received (timestamp prefix included, if one was requested). */
  raw: string;
  /** Kubernetes timestamp (RFC 3339, as received) when `timestamps` was requested and the token parsed. */
  k8sTs?: string;
  /** The line with the Kubernetes timestamp prefix removed. Equals `raw` when there was none. */
  body: string;
  /** Normalised level; "none" when no shape matched. */
  lvl: LogLevel;
  /** The line's own level word upper-cased (e.g. "FATAL" folds into ERROR but keeps its word). */
  word?: string;
  /** Legacy `HH:MM:SS.fff LEVEL message` shape: the app's own time and message columns. */
  appTs?: string;
  msg?: string;
  /** True when `body` is a complete JSON object. */
  json: boolean;
}

// ─── Kubernetes timestamp prefix (Q-L2) ──────────────────────────────────────
// With `timestamps: true` every line arrives as `<RFC3339Nano UTC><space><line>`.
// Trailing zeros of the fraction may be trimmed. Split at the FIRST space; the
// token must parse as a date or the line is treated as untimestamped. A line
// with no space is a timestamp with an empty message.

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isTimestampToken(tok: string): boolean {
  return RFC3339.test(tok) && !Number.isNaN(Date.parse(tok));
}

export function splitK8sTimestamp(raw: string): { ts?: string; rest: string } {
  const sp = raw.indexOf(" ");
  if (sp === -1) {
    return isTimestampToken(raw) ? { ts: raw, rest: "" } : { rest: raw };
  }
  const tok = raw.slice(0, sp);
  if (!isTimestampToken(tok)) return { rest: raw };
  return { ts: tok, rest: raw.slice(sp + 1) };
}

// ─── Level detection (02 §3.4 order) ─────────────────────────────────────────

const LEVEL_WORDS: Record<string, LogLevel> = {
  error: "ERROR", err: "ERROR", fatal: "ERROR", critical: "ERROR", crit: "ERROR", panic: "ERROR",
  emerg: "ERROR", alert: "ERROR", severe: "ERROR",
  warn: "WARN", warning: "WARN",
  info: "INFO", notice: "INFO",
  debug: "DEBUG", trace: "DEBUG", dbg: "DEBUG",
};

/** Maps a level word ("Fatal", "WARNING", "notice") to a level, or undefined. */
export function normalizeLevel(word: unknown): LogLevel | undefined {
  if (typeof word !== "string") return undefined;
  return LEVEL_WORDS[word.trim().toLowerCase()];
}

/** Parses `s` only when it is a COMPLETE JSON object; null for anything else (truncated, array, scalar). Never throws. */
export function parseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (t.length < 2 || t[0] !== "{" || t[t.length - 1] !== "}") return null;
  try {
    const v: unknown = JSON.parse(t);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const LEGACY = /^(\d{2}:\d{2}:\d{2}\.\d+)\s+(INFO|WARN|ERROR|FATAL|DEBUG)\s+(.*)$/;
const JSON_LEVEL_KEYS = ["level", "severity", "lvl", "levelname"];
const LOGFMT_LEVEL = /(?:^|\s)level=(?:"([A-Za-z]+)"|([A-Za-z]+))(?=\s|$)/;
const LEADING_TOKEN = /^\s*(?:\[\s*([A-Za-z]+)\s*\]|([A-Za-z]+):)/;

export function detectLevel(body: string): { lvl: LogLevel; word?: string } {
  // 1. The existing `HH:MM:SS.fff LEVEL message` shape.
  const m = LEGACY.exec(body);
  if (m) return { lvl: normalizeLevel(m[2]) ?? "none", word: m[2] };

  // 2. A JSON object with level / severity / lvl / levelname.
  const obj = parseJsonObject(body);
  if (obj) {
    for (const k of JSON_LEVEL_KEYS) {
      const lvl = normalizeLevel(obj[k]);
      if (lvl) return { lvl, word: String(obj[k]).toUpperCase() };
    }
    return { lvl: "none" };
  }

  // 3. logfmt `level=`.
  const lf = LOGFMT_LEVEL.exec(body);
  if (lf) {
    const w = lf[1] ?? lf[2];
    const lvl = normalizeLevel(w);
    if (lvl) return { lvl, word: w.toUpperCase() };
  }

  // 4. A leading `[ERROR]` / `ERROR:` token.
  const lt = LEADING_TOKEN.exec(body);
  if (lt) {
    const w = lt[1] ?? lt[2];
    const lvl = normalizeLevel(w);
    if (lvl) return { lvl, word: w.toUpperCase() };
  }

  return { lvl: "none" };
}

export function parseLogLine(raw: string, timestamps: boolean): ParsedLogLine {
  let k8sTs: string | undefined;
  let body = raw;
  if (timestamps) {
    const s = splitK8sTimestamp(raw);
    k8sTs = s.ts;
    body = s.rest;
  }
  const { lvl, word } = detectLevel(body);
  const legacy = LEGACY.exec(body);
  return {
    raw,
    k8sTs,
    body,
    lvl,
    word,
    appTs: legacy?.[1],
    msg: legacy?.[3],
    json: parseJsonObject(body) !== null,
  };
}
