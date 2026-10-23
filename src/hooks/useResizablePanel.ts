import { useState, useEffect, useRef, useCallback } from "react";

export function useResizablePanel(storageKey: string, defaultWidth = 480) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return Math.min(Math.max(parseInt(stored, 10), 320), 900);
    } catch {}
    return defaultWidth;
  });

  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(width)); } catch {}
  }, [storageKey, width]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;

    const onMove = (ev: MouseEvent) => {
      // dragging left = positive delta = wider panel
      const next = Math.min(Math.max(startWidth + (startX - ev.clientX), 320), 900);
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return { width, startResize };
}
