import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { COL_PITCH, NODE_W, PAD, clampToGap, layout, layoutKey, readingOrder, spreadLabels, type PlacedNode } from "../../utils/graphLayout";

export type GraphStatus = "ok" | "warn" | "bad" | "unknown";
export type EdgeFamily = "solid" | "dashed" | "dotted";

/** Glyph and word for a status; the word is ink, the glyph carries the colour. */
export const STATUS_VIEW: Record<GraphStatus, { glyph: string; word: string; tone: string }> = {
  ok: { glyph: "✓", word: "OK", tone: "text-status-ok" },
  warn: { glyph: "▲", word: "Warning", tone: "text-status-warn" },
  bad: { glyph: "✕", word: "Failing", tone: "text-status-bad" },
  unknown: { glyph: "○", word: "Unknown", tone: "text-mute" },
};

export interface GraphNodeView {
  id: string;
  column: number;
  kindLabel: string;
  name: string;
  status?: GraphStatus;
  accessibleName: string;
  /** Small mute suffix after the kind, e.g. "cluster-scoped". */
  note?: string;
  /** Search match: dashed accent ring. */
  match?: boolean;
  /** A stand-in peer (netpol): tinted fill instead of the panel fill. */
  pseudo?: boolean;
  /** A third, small line under the name (netpol: the direction words). */
  sub?: string;
  /** The same line in full words, for the tooltip when `sub` is abbreviated. */
  subFull?: string;
}
export interface GraphEdgeView {
  from: string;
  to: string;
  family: EdgeFamily;
  /** Drawn only while a node at either end is hovered or has keyboard focus (UX 2.3). */
  label?: string;
}
export interface GraphCanvasProps {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onOpen: (id: string) => void;
  /** Space on a node: the page expands its details strip. */
  onExpandDetails?: () => void;
  ariaLabel: string;
  /**
   * Changes when the page itself changes what is drawn (hiding a kind, narrowing to an object). A node that
   * disappears across such a change is not announced as removed; only a background refresh is (UX 9.3).
   */
  epoch?: string;
  /** Changes when the page narrows or widens the map (focus): the canvas then fits the new set once (zoom at most 100%). */
  fitKey?: string;
}
export interface GraphCanvasHandle {
  /** Move DOM focus to a node and scroll it into view (details-strip links). */
  focusNode: (id: string) => void;
}

const DASH: Record<EdgeFamily, string | undefined> = { solid: undefined, dashed: "6 4", dotted: "2 4" };
const MIN_Z = 0.5;
const MAX_Z = 2;
const clampZ = (v: number) => Math.min(MAX_Z, Math.max(MIN_Z, Math.round(v * 100) / 100));
const ctl =
  "min-w-6 h-6 px-1 inline-flex items-center justify-center rounded-sm bg-surface-panel ring-1 ring-edge text-ink text-[12px] hover:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden";

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  { nodes, edges, focusedId, onFocus, onOpen, onExpandDetails, ariaLabel, epoch = "", fitKey = "" },
  ref,
) {
  // Relayout only when the id set changes; status and label changes never move a node (L4).
  const key = layoutKey(nodes, edges);
  const lay = useMemo(() => layout(nodes, edges), [key]);
  const { at, order, adj } = useMemo(() => {
    const at = new Map<string, PlacedNode>(lay.nodes.map((p) => [p.id, p]));
    const adj = new Map<string, Set<string>>();
    for (const e of lay.edges) {
      (adj.get(e.from) ?? adj.set(e.from, new Set()).get(e.from)!).add(e.to);
      (adj.get(e.to) ?? adj.set(e.to, new Set()).get(e.to)!).add(e.from);
    }
    return { at, order: readingOrder(lay), adj };
  }, [lay]);
  const views = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const info = useMemo(() => {
    const m = new Map<string, GraphEdgeView>();
    for (const e of edges) if (!m.has(e.from + "\u0000" + e.to)) m.set(e.from + "\u0000" + e.to, e);
    return m;
  }, [edges]);

  // eff is only the roving tab stop (falls back to the first node); sel is what is actually focused, and alone drives ring, edges and labels.
  const sel = focusedId && at.has(focusedId) && !at.get(focusedId)!.dummy ? focusedId : null;
  const eff = sel ?? (order[0] ?? null);
  // Edge labels follow the pointer or DOM focus, not the remembered selection: none while nothing is hovered or focused.
  const [hover, setHover] = useState<string | null>(null);
  const [domFocus, setDomFocus] = useState<string | null>(null);
  // A node that left the map (refetch) may never get its mouseleave or blur: only live ids count.
  const live = (id: string | null) => (id && at.has(id) && !at.get(id)!.dummy ? id : null);
  const kbd = useRef(false); // the last input was a key: keyboard focus wins over a resting pointer
  const hv = live(hover);
  const df = live(domFocus);
  const lit = kbd.current ? df ?? hv : hv ?? df;
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => setDismissed(null), [lit]);
  const [z, setZ] = useState(1);
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const btns = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const anchor = useRef<{ id: string; sx: number; sy: number } | null>(null);
  const prev = useRef<{ order: string[]; names: Map<string, string> } | null>(null);
  const hadFocus = useRef(false);
  const epochAt = useRef(0);
  const mid = useId().replace(/:/g, "");

  const record = () => {
    const el = scrollRef.current;
    const p = eff ? at.get(eff) : undefined;
    anchor.current = el && eff && p ? { id: eff, sx: p.x * z - el.scrollLeft, sy: p.y * z - el.scrollTop } : null;
  };

  useLayoutEffect(() => { epochAt.current = Date.now(); }, [epoch]);

  // New layout: keep the focused node at the same screen offset; if it is gone, move on (UX 9.3).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const a = anchor.current;
    // The page changed what it draws within the last few seconds (including a change that left the node set as it was).
    const pageChange = Date.now() - epochAt.current < 5000;
    if (a) {
      const p = at.get(a.id);
      if (p) {
        el.scrollLeft = p.x * z - a.sx;
        el.scrollTop = p.y * z - a.sy;
      } else if (prev.current && focusedId === a.id) {
        const old = prev.current.order;
        const i = old.indexOf(a.id);
        const next = [...old.slice(i + 1), ...old.slice(0, Math.max(i, 0)).reverse()].find((id) => at.has(id));
        if (!pageChange) setNotice(`Removed from the map: ${prev.current.names.get(a.id) ?? a.id}`);
        if (next) {
          onFocus(next);
          if (hadFocus.current) btns.current.get(next)?.focus({ preventScroll: true });
        }
      }
    }
    prev.current = { order, names: new Map(nodes.map((n) => [n.id, `${n.kindLabel} ${n.name}`])) };
    record();
  }, [lay]);

  useEffect(record, [eff, z]);

  // Ctrl/Cmd + wheel zooms; the listener must be non-passive to cancel the browser's page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const f = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      setZ((v) => clampZ(v * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("wheel", f, { passive: false });
    return () => el.removeEventListener("wheel", f);
  }, []);

  const reveal = (id: string) => {
    const b = btns.current.get(id);
    b?.focus({ preventScroll: true });
    b?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  useImperativeHandle(ref, () => ({ focusNode: reveal }));

  const fit = (max = MAX_Z) => {
    const el = scrollRef.current;
    if (!el || !el.clientWidth || !lay.width || !lay.height) return;
    setZ(clampZ(Math.min(max, el.clientWidth / lay.width, el.clientHeight / lay.height)));
    el.scrollLeft = 0;
    el.scrollTop = 0;
  };
  // Narrowing or widening the map shows the whole new set (not on a plain mount without a focus, not at more than 100%).
  const fitted = useRef<string | undefined>(undefined);
  useEffect(() => {
    const first = fitted.current === undefined;
    if (fitted.current === fitKey || (first && !fitKey)) {
      fitted.current = fitKey;
      return;
    }
    fitted.current = fitKey;
    fit(1);
  }, [fitKey, lay]);

  const target = (key: string, cur: PlacedNode): string | undefined => {
    const reals = lay.nodes.filter((n) => !n.dummy);
    const near = (pool: PlacedNode[]) => {
      const linked = pool.filter((n) => adj.get(cur.id)?.has(n.id));
      const use = linked.length ? linked : pool;
      return use.sort((a, b) => Math.abs(a.y - cur.y) - Math.abs(b.y - cur.y) || (a.id < b.id ? -1 : 1))[0]?.id;
    };
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const dir = key === "ArrowLeft" ? -1 : 1;
      const side = reals.filter((n) => (n.x - cur.x) * dir > 0);
      if (!side.length) return undefined;
      const x = dir < 0 ? Math.max(...side.map((n) => n.x)) : Math.min(...side.map((n) => n.x));
      return near(side.filter((n) => n.x === x));
    }
    const dir = key === "ArrowUp" ? -1 : 1;
    const col = reals.filter((n) => n.x === cur.x && (n.y - cur.y) * dir > 0);
    if (col.length) {
      col.sort((a, b) => a.y - b.y);
      return (dir > 0 ? col[0] : col[col.length - 1]).id;
    }
    // End of the layer: into the next (or previous) island.
    const isl = reals.filter((n) => (n.island - cur.island) * dir > 0);
    return dir > 0 ? isl[0]?.id : isl[isl.length - 1]?.id;
  };

  const onNodeKey = (ev: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const cur = at.get(id)!;
    const k = ev.key;
    kbd.current = true;
    // WCAG 1.4.13: Esc hides drawn labels. Only then is the event consumed, so Esc still reaches a panel or the palette otherwise.
    if (k === "Escape" && cards.length) {
      setDismissed(lit);
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    let go: string | undefined;
    if (k.startsWith("Arrow")) go = target(k, cur);
    else if (k === "Home") go = order[0];
    else if (k === "End") go = order[order.length - 1];
    else if (k === "Enter") onOpen(id);
    else if (k === " ") onExpandDetails?.();
    else if (k === "+" || k === "=") setZ((v) => clampZ(v + 0.1));
    else if (k === "-") setZ((v) => clampZ(v - 0.1));
    else if (k === "0") fit();
    else return;
    ev.preventDefault();
    if (go) reveal(go);
  };

  const down = (ev: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
    const r = el.getBoundingClientRect();
    if (ev.clientX - r.left > el.clientWidth || ev.clientY - r.top > el.clientHeight) return; // scrollbar
    drag.current = { x: ev.clientX, y: ev.clientY, l: el.scrollLeft, t: el.scrollTop };
    el.setPointerCapture(ev.pointerId);
  };
  const move = (ev: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    el.scrollLeft = d.l - (ev.clientX - d.x);
    el.scrollTop = d.t - (ev.clientY - d.y);
  };
  const up = () => {
    drag.current = null;
  };

  const drawn = lay.edges.map((e) => ({
    e,
    v: info.get(e.from + "\u0000" + e.to),
    d: "M" + e.points.map((p) => `${p.x} ${p.y}`).join(" L"),
    hot: e.from === (hv ?? sel) || e.to === (hv ?? sel),
  }));
  // Label cards in screen space (unscaled text, 11 px at every zoom), merged and spread so none overlap.
  const labelW = Math.max(96, (COL_PITCH - NODE_W) * z - 8);
  // Screen-space left edge of the gap that holds an anchor at screen x; a card is clamped inside it so it never covers a box.
  const gapLeft = (x: number) => (PAD + Math.floor((x / z - PAD) / COL_PITCH) * COL_PITCH + NODE_W) * z;
  const cards =
    lit && dismissed !== lit
      ? spreadLabels(
          drawn
            .filter((x) => x.v?.label && (x.e.from === lit || x.e.to === lit))
            .map(({ e, v }) => {
              const a = e.from === lit ? e.anchors[0] : e.anchors[1];
              return { x: a.x * z, y: a.y * z, text: v!.label! };
            }),
          44,
          labelW,
        )
      : [];
  const pos = new Map(order.map((id, i) => [id, i + 1]));

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onFocus={() => (hadFocus.current = true)}
      onBlur={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget)) hadFocus.current = false;
      }}
      className="relative h-full min-h-0 rounded-md ring-1 ring-edge bg-surface-card overflow-hidden"
    >
      <div
        ref={scrollRef}
        onScroll={record}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="h-full w-full overflow-auto cursor-grab"
      >
        <div className="relative" style={{ width: lay.width * z, height: lay.height * z }}>
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: lay.width, height: lay.height, transform: `scale(${z})` }}
          >
            <svg width={lay.width} height={lay.height} className="absolute left-0 top-0" aria-hidden="true">
              <defs>
                {(["m", "i"] as const).map((k) => (
                  <marker
                    key={k}
                    id={`${mid}${k}`}
                    className={k === "m" ? "text-mute" : "text-ink"}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="9"
                    markerHeight="9"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
                  </marker>
                ))}
              </defs>
              {[false, true].map((hot) =>
                drawn
                  .filter((x) => x.hot === hot)
                  .map(({ e, v, d }) => (
                    <path
                      key={`${e.from}>${e.to}`}
                      d={d}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={hot ? 1.75 : 1}
                      strokeDasharray={DASH[v?.family ?? "solid"]}
                      className={hot ? "text-ink" : "text-mute"}
                      markerEnd={`url(#${mid}${hot ? "i" : "m"})`}
                    />
                  )),
              )}
            </svg>
            {lay.nodes
              .filter((p) => !p.dummy)
              .map((p) => {
                const v = views.get(p.id);
                if (!v) return null;
                const st = v.status ? STATUS_VIEW[v.status] : null;
                const on = p.id === sel;
                return (
                  <button
                    key={p.id}
                    type="button"
                    ref={(b) => {
                      if (b) btns.current.set(p.id, b);
                      else btns.current.delete(p.id);
                    }}
                    tabIndex={p.id === eff ? 0 : -1}
                    aria-label={`${v.accessibleName} ${pos.get(p.id)} of ${order.length}.`}
                    data-graph-node
                    title={`${v.kindLabel} ${v.name}${v.sub ? ` · ${v.subFull ?? v.sub}` : ""}`}
                    onFocus={() => {
                      setDomFocus(p.id);
                      onFocus(p.id);
                    }}
                    onBlur={() => setDomFocus((f) => (f === p.id ? null : f))}
                    onMouseEnter={() => {
                      kbd.current = false;
                      setHover(p.id);
                    }}
                    onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
                    onClick={() => onFocus(p.id)}
                    onDoubleClick={() => onOpen(p.id)}
                    onKeyDown={(ev) => onNodeKey(ev, p.id)}
                    style={{ left: p.x, top: p.y, width: p.w, height: p.h, scrollMarginInline: (COL_PITCH - NODE_W) * z + 8, scrollMarginBlock: 24 }}
                    className={`absolute box-border flex flex-col justify-center gap-0.5 px-2 text-left rounded-md ${v.pseudo ? "bg-surface-tint/6" : "bg-surface-panel"} border outline-hidden cursor-pointer ${
                      v.match ? "border-dashed border-accent" : on ? "border-accent" : "border-edge"
                    } ${on ? "ring-2 ring-accent" : "ring-1 ring-edge hover:ring-accent/50"}`}
                  >
                    <span className="flex items-center justify-between gap-1 text-[11px] leading-none">
                      <span className="truncate text-mute">
                        {v.kindLabel}
                        {v.note ? ` · ${v.note}` : ""}
                      </span>
                      {st && (
                        <span className="shrink-0 text-ink">
                          <span aria-hidden="true" className={st.tone}>{st.glyph}</span> {st.word}
                        </span>
                      )}
                    </span>
                    <span className="truncate font-mono text-[12px] leading-none text-ink">{v.name}</span>
                    {v.sub && <span className="truncate text-[10px] leading-none text-mute">{v.sub}</span>}
                  </button>
                );
              })}
          </div>
          {/* ponytail: cards are merged and 44 px apart, but a 3-line card near a gap's top or bottom can still cover a neighbour's lane, and a card is drawn below its anchor near the canvas top; no collision against nodes beyond that. */}
          {cards.map((c) => (
            <span
              key={`l:${c.x}:${c.text}`}
              aria-hidden="true"
              style={{ left: clampToGap(c.x, labelW, gapLeft(c.x), gapLeft(c.x) + (COL_PITCH - NODE_W) * z), top: c.y < 48 ? c.y + 3 : c.y - 3, maxWidth: labelW }}
              className={`pointer-events-none absolute z-10 w-max -translate-x-1/2 ${c.y < 48 ? "" : "-translate-y-full"} rounded-sm bg-surface-card ring-1 ring-edge px-1 py-0.5 text-center text-[11px] leading-tight text-ink line-clamp-3`}
            >
              {c.n > 1 ? `${c.text} ×${c.n}` : c.text}
            </span>
          ))}
        </div>
      </div>
      <div className="absolute top-2 right-4 flex items-center gap-1">
        <button type="button" className={ctl} aria-label="Zoom out" title="Zoom out" onClick={() => setZ((v) => clampZ(v - 0.1))}>
          -
        </button>
        <span className="text-[11px] text-mute tabular-nums w-9 text-center" aria-hidden="true">
          {Math.round(z * 100)}%
        </span>
        <button type="button" className={ctl} aria-label="Zoom in" title="Zoom in" onClick={() => setZ((v) => clampZ(v + 0.1))}>
          +
        </button>
        <button type="button" className={ctl} aria-label="Fit to view" title="Fit to view" onClick={() => fit()}>
          Fit
        </button>
      </div>
      <div role="status" className="sr-only">
        {notice}
      </div>
    </div>
  );
});
