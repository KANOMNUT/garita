// Per-pod stream state for the multi-pod log tail, and the copy derived from it.
// Pure and React-free so the "is anything still streaming?" rules are testable
// (the Following dot, the idle line and the empty state all hang off them).
//
// Why this exists: a Job/CronJob pod finishes, the backend sends `end`, and the
// viewer used to keep a blinking "Following" forever because nothing looked at
// the per-pod `ended` state (docs/ux/02-logs-debug.md 4.1, "Error: stream ended").

export type PodStream =
  | { kind: "streaming" }
  | { kind: "ended" }
  | { kind: "error"; message: string }
  | { kind: "start_error"; message: string };

export interface PodStreamSummary {
  total: number;
  /** Still receiving. A pod with no entry yet counts here: its stream is being opened. */
  streaming: string[];
  /** The server closed the stream normally (`end`). */
  ended: string[];
  /** Broke mid-way (`error`) or was rejected at start (`start_error`). */
  failed: string[];
}

/**
 * Buckets `names` (the pods currently being tailed) by stream state, keeping the
 * input order. Entries in `streams` for pods not in `names` are ignored — they are
 * stale until the stream effect re-seeds the record.
 */
export function summarizePodStreams(
  names: readonly string[],
  streams: Readonly<Record<string, PodStream | undefined>>,
): PodStreamSummary {
  const out: PodStreamSummary = { total: names.length, streaming: [], ended: [], failed: [] };
  for (const name of names) {
    const s = streams[name];
    if (s === undefined || s.kind === "streaming") out.streaming.push(name);
    else if (s.kind === "ended") out.ended.push(name);
    else out.failed.push(name);
  }
  return out;
}

/** True when at least one stream is still open: the only time "Following" is honest. */
export function anyStreaming(s: PodStreamSummary): boolean {
  return s.streaming.length > 0;
}

const streamWord = (n: number) => `${n} stream${n === 1 ? "" : "s"}`;
const podWord = (n: number) => (n === 1 ? "this pod" : `these ${n} pods`);

/** The line in the log region once nothing is streaming; null when there is nothing to say. */
export function idleText(s: PodStreamSummary): string | null {
  if (anyStreaming(s) || s.ended.length === 0) return null;
  // Some pods failed, so "all ended" would hide that: the failure strip owns those.
  return s.failed.length === 0 ? "All streams ended" : "No streams running";
}

/** Text of the ended strip; empty when no stream has ended. */
export function endedStripText(s: PodStreamSummary): string {
  const k = s.ended.length;
  if (k === 0) return "";
  if (s.total === 1) return "Stream ended. The container stopped or the connection dropped.";
  if (k === s.total) return `All ${streamWord(k)} ended. The containers stopped or the connections dropped.`;
  return `${k} of ${s.total} streams ended.`;
}

/**
 * Polite live-region text (the reloading text is handled by the caller, it takes
 * priority). Strings are deliberately count-free for "ended" so a burst of pods
 * finishing within a few ms does not queue one announcement per pod.
 */
export function streamStatusText(s: PodStreamSummary, follow: boolean): string {
  const parts: string[] = [];
  if (s.failed.length > 0) parts.push(`Tailing ${s.total - s.failed.length} of ${s.total} pods`);
  if (s.ended.length > 0) parts.push(anyStreaming(s) ? "Some streams ended" : (idleText(s) ?? "Streams ended"));
  if (anyStreaming(s) && s.failed.length === 0) parts.push(follow ? "Following" : "Paused");
  return parts.length > 0 ? parts.join(". ") : follow ? "Following" : "Paused";
}

/**
 * Empty-state copy for a log region with zero lines, or null when the viewer
 * should show nothing (every pod failed: the failure strip already says so).
 * Once nothing is streaming the answer is final, so it says so (02 4.1, "Nothing here").
 */
export function emptyLogsText(s: PodStreamSummary, rangePhrase: string, timeRange: boolean): string | null {
  if (!anyStreaming(s)) {
    if (s.ended.length === 0) return null;
    const who = podWord(s.ended.length);
    return timeRange ? `No log lines from ${who} in ${rangePhrase}.` : `No log lines from ${who}.`;
  }
  return "No log lines yet";
}
