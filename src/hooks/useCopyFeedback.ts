import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/**
 * Clipboard copy with inline feedback (docs/ux/24 X-6). The app has no toast system, so the caller flips the button
 * label while `state` is "copied" or "failed" and mirrors it in a sr-only `role="status"`. `copy` resolves true when the
 * clipboard accepted the text; it never rejects, because the clipboard can be denied. The state returns to "idle" after
 * `ms`, and the timer is cleared on unmount.
 */
export function useCopyFeedback(ms = 1500) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "failed");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setState("idle");
    }, ms);
    return ok;
  }, [ms]);

  return { state, copy };
}
