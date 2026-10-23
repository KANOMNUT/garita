// Modal layer registry (docs/ux/00-overview.md KEYMAP K1-K3, K5).
//
// The App-level key handler needs to know "is a dialog open?" so Esc, `r`, ⌘K
// and ⌘N stay out of the dialog's way, and ConfirmModal needs to know whether
// it is the TOPMOST dialog so a nested dialog takes Esc first.
//
// Layers are keyed by a unique id minted INSIDE the effect, never by a bare
// counter incremented on open/decrement on close: StrictMode mounts, unmounts
// and re-mounts every effect, so a counter that is bumped in the effect body
// and decremented in cleanup is only correct if the two always pair — a unique
// id removed by that same id cannot drift.
import { useCallback, useEffect, useRef } from "react";

const layers: number[] = [];
let nextId = 0;

/**
 * Registers a modal layer while `open` is true. Returns `isTopmost()`, which is
 * safe to call from event handlers (it reads the registry at call time).
 */
export function useModalLayer(open: boolean): () => boolean {
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = ++nextId;
    idRef.current = id;
    layers.push(id);
    return () => {
      const i = layers.indexOf(id);
      if (i !== -1) layers.splice(i, 1);
      if (idRef.current === id) idRef.current = null;
    };
  }, [open]);

  return useCallback(
    () => idRef.current !== null && layers[layers.length - 1] === idRef.current,
    [],
  );
}

export function isModalOpen(): boolean {
  return layers.length > 0;
}

/** True for anything the user types into: input, textarea, select, contenteditable, and the xterm terminal. */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  return t.closest(".xterm") !== null;
}

/** True when the event originated inside the xterm terminal (its helper textarea included). */
export function isInTerminal(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest(".xterm") !== null;
}
