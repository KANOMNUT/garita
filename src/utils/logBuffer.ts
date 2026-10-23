// Bounded line buffer shared by LogViewer and MultiLogViewer (D-L5, v1.3.0).
// Pure and non-mutating: an unbounded array is an OOM on a chatty container.

/** The ring-buffer cap, equal to the server-side `tail_lines` ceiling (5000). */
export const MAX_LOG_LINES = 5000;

/**
 * Appends `incoming` to `buf`, keeping at most `cap` entries (oldest dropped).
 * Returns a new array and how many entries were dropped by this call.
 * Returns `buf` itself when `incoming` is empty and nothing was dropped.
 */
export function appendBounded<T>(buf: readonly T[], incoming: readonly T[], cap: number = MAX_LOG_LINES): { buf: T[]; dropped: number } {
  if (incoming.length === 0) return { buf: buf as T[], dropped: 0 };
  const total = buf.length + incoming.length;
  if (total <= cap) return { buf: [...buf, ...incoming], dropped: 0 };
  const dropped = total - cap;
  if (incoming.length >= cap) return { buf: incoming.slice(incoming.length - cap), dropped };
  return { buf: [...buf.slice(dropped), ...incoming], dropped };
}

/**
 * Removes every entry matching `pred` from `buf` AND from the not-yet-flushed
 * `pending` queue, then appends what is left of `pending` under the cap.
 * Used when one pod's stream is re-subscribed: its tail replays on reconnect,
 * so keeping the old copy would show every replayed line twice. Folding the
 * queue in first means a queued line from the old stream cannot survive the
 * removal. `dropped` counts only cap overflow, never the removed entries.
 */
export function removeMatching<T>(
  buf: readonly T[],
  pending: readonly T[],
  pred: (item: T) => boolean,
  cap: number = MAX_LOG_LINES,
): { buf: T[]; dropped: number } {
  const keep = (item: T) => !pred(item);
  return appendBounded(buf.filter(keep), pending.filter(keep), cap);
}
