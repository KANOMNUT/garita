import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useModalLayer } from "../utils/modalLayer";

// ONE popover primitive for the read-only badge, the log Filters / Pods / Download
// popovers (docs/impl/v1.3.1-tasks.md §0.3 UXP-6). A popover is not a modal — no scrim,
// no focus trap — so a layer that registers itself must also close itself, or a click
// elsewhere strands Esc, `r` and ⌘K for the whole app (App's key handler returns early
// whenever `isModalOpen()`). It therefore closes on:
//   - Esc (window keydown, capture, only when it is the topmost layer; focus returns to the trigger)
//   - a pointerdown outside the panel and outside its trigger
//   - focus leaving the panel for somewhere outside it and its trigger
// The owner closes it on any other condition (e.g. a viewer crossing its compact width).

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The control that opens it. Pointer events on it are not "outside", and Esc returns focus to it. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Accessible name of the panel. */
  label: string;
  /** Layout classes for the absolutely positioned panel (parent must be `relative`). */
  className?: string;
  children: ReactNode;
}

export function Popover({ open, onClose, triggerRef, label, className = "", children }: PopoverProps) {
  const isTopmost = useModalLayer(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const live = useRef({ onClose, isTopmost });
  live.current = { onClose, isTopmost };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || !live.current.isTopmost()) return;
      e.stopPropagation();
      e.preventDefault();
      live.current.onClose();
      triggerRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      live.current.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, triggerRef]);

  if (!open) return null;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      // Focusable but not a tab stop: a click on anything inside that is not itself focusable (text, and on WebKit
      // every button and checkbox) focuses the panel instead of the nearest focusable ancestor (`<main tabIndex={-1}>`),
      // so the blur handler below does not see focus leave and close the panel before the click lands.
      tabIndex={-1}
      className={`absolute z-30 rounded-lg bg-panel ring-1 ring-edge2 shadow-xl outline-hidden ${className}`}
      // A popover may sit inside a draggable header: do not let a click inside it start a window drag.
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        // null = focus went nowhere focusable (window blur, a click on plain text): the
        // pointerdown handler covers a click; ignoring null avoids closing on window blur.
        if (!next) return;
        if (panelRef.current?.contains(next) || triggerRef.current?.contains(next)) return;
        live.current.onClose();
      }}
    >
      {children}
    </div>
  );
}
