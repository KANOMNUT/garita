import { useCallback, useEffect, useRef, useState } from "react";
import { appendBounded, MAX_LOG_LINES, removeMatching } from "../utils/logBuffer";

// Ring buffer for streamed log lines (D-L5). Incoming lines are queued and
// flushed once per animation frame, so a burst of N lines costs one render and
// one O(cap) copy instead of N of each. The refs are the source of truth;
// state only mirrors them for rendering.
export function useBoundedLines<T>(cap: number = MAX_LOG_LINES) {
  const [lines, setLines] = useState<T[]>([]);
  const [dropped, setDropped] = useState(0);
  const linesRef = useRef<T[]>([]);
  const droppedRef = useRef(0);
  const pending = useRef<T[]>([]);
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const batch = pending.current;
    if (batch.length === 0) return;
    pending.current = [];
    const r = appendBounded(linesRef.current, batch, cap);
    linesRef.current = r.buf;
    droppedRef.current += r.dropped;
    setLines(r.buf);
    if (r.dropped > 0) setDropped(droppedRef.current);
  }, [cap]);

  const push = useCallback(
    (item: T) => {
      pending.current.push(item);
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  /** Pushes several lines in one go (the previous-instance snapshot). */
  const replace = useCallback(
    (items: T[]) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = [];
      const r = appendBounded([], items, cap);
      linesRef.current = r.buf;
      droppedRef.current = r.dropped;
      setLines(r.buf);
      setDropped(r.dropped);
    },
    [cap],
  );

  /** Drops every line (buffered and still queued) matching `pred`; keeps the rest in order. */
  const removeWhere = useCallback(
    (pred: (item: T) => boolean) => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      const r = removeMatching(linesRef.current, pending.current, pred, cap);
      pending.current = [];
      linesRef.current = r.buf;
      droppedRef.current += r.dropped;
      setLines(r.buf);
      if (r.dropped > 0) setDropped(droppedRef.current);
    },
    [cap],
  );

  const clear = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = [];
    linesRef.current = [];
    droppedRef.current = 0;
    setLines([]);
    setDropped(0);
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { lines, dropped, push, replace, clear, removeWhere };
}
