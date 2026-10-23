// Own layered layout for the graph canvas (docs/impl/v2.2.0-tasks.md FZ3).
// Pure and synchronous: no React, no Date, no Math.random. Every sort breaks
// ties by id, so the output is a function of the node and edge sets.

export interface LayoutNode {
  id: string;
  column: number;
}
export interface LayoutEdge {
  from: string;
  to: string;
}

export const NODE_W = 184;
export const NODE_H = 52;
/** Gap between columns = COL_PITCH - NODE_W (120 px): wide enough for a two-line edge label. */
export const COL_PITCH = 304;
export const ROW_PITCH = 68;
export const DUMMY_PITCH = 16;
export const ISLAND_GAP = 40;
export const PAD = 24;
const SWEEPS = 4;
const BAND_MIN_SLOTS = 4;

export interface PlacedNode {
  id: string;
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into the island list; the "Not connected" band is the last one. */
  island: number;
  /** Routing point of a long edge, never drawn as a box. */
  dummy: boolean;
}
export interface Pt {
  x: number;
  y: number;
}
export interface PlacedEdge {
  from: string;
  to: string;
  /** Orthogonal route: horizontal out of the source, vertical in a column gap, horizontal into the target. */
  points: Pt[];
  /**
   * Label spots on the route's own vertical track: `[0]` is used when the source is lit and sits at the far end's
   * row, `[1]` when the target is lit and sits at the source-side row of the last gap.
   */
  anchors: [Pt, Pt];
}
export interface GraphLayout {
  /** Reading order: islands, columns left to right, slots top to bottom. Dummies included. */
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SEP = "\u0000";

/** Stable identity of the drawn set: ids and edges only, so a status or label change never relayouts. */
export function layoutKey(nodes: LayoutNode[], edges: LayoutEdge[]): string {
  const n = nodes.map((x) => x.id).sort(cmp);
  const e = edges.map((x) => `${x.from}>${x.to}`).sort(cmp);
  return `${n.join(SEP)}${SEP}${SEP}${e.join(SEP)}`;
}

/** Ids of the real (non-dummy) nodes in reading order. */
export function readingOrder(l: GraphLayout): string[] {
  return l.nodes.filter((n) => !n.dummy).map((n) => n.id);
}

export interface RankResult {
  /** Layout column per layout id: groups 1..k, `src:<id>` 0, `dst:<id>` k+1. */
  columns: Record<string, number>;
  /** Edges with pseudo endpoints renamed to `src:`/`dst:` ids. */
  edges: LayoutEdge[];
  /** Original-direction edges that were reversed for ranking only. */
  reversed: LayoutEdge[];
}

/**
 * Columns for the netpol graph. Back edges (found by DFS in id order) are
 * reversed for ranking only; rank is the longest path in the resulting DAG.
 * A pseudo-node used on both sides becomes `src:<id>` and `dst:<id>`.
 */
export function rankColumns(
  groupIds: string[],
  edges: LayoutEdge[],
  pseudoSrc: string[],
  pseudoDst: string[],
): RankResult {
  const groups = [...new Set(groupIds)].sort(cmp);
  const isGroup = new Set(groups);
  const src = new Set(pseudoSrc);
  const dst = new Set(pseudoDst);
  const out: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const e of [...edges].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to))) {
    if (e.from === e.to) continue;
    const from = src.has(e.from) && !isGroup.has(e.from) ? `src:${e.from}` : e.from;
    const to = dst.has(e.to) && !isGroup.has(e.to) ? `dst:${e.to}` : e.to;
    const k = from + SEP + to;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ from, to });
    }
  }
  const succ = new Map<string, string[]>(groups.map((g) => [g, []]));
  for (const e of out) if (isGroup.has(e.from) && isGroup.has(e.to)) succ.get(e.from)!.push(e.to);
  for (const l of succ.values()) l.sort(cmp);

  const state = new Map<string, 1 | 2>(); // 1 on stack, 2 done
  const post: string[] = [];
  const reversed: LayoutEdge[] = [];
  const dag = new Map<string, string[]>(groups.map((g) => [g, []]));
  const visit = (v: string) => {
    state.set(v, 1);
    for (const w of succ.get(v)!) {
      if (state.get(w) === 1) reversed.push({ from: v, to: w });
      else {
        dag.get(v)!.push(w);
        if (!state.has(w)) visit(w);
      }
    }
    state.set(v, 2);
    post.push(v);
  };
  for (const g of groups) if (!state.has(g)) visit(g);
  // A reversed edge w→v may duplicate a forward edge; ranking only needs the DAG, so add it.
  for (const r of reversed) dag.get(r.to)!.push(r.from);

  // Reverse post-order of the DFS is topological for the forward edges; the
  // reversed ones can break it, so relax until stable (bounded by |groups|).
  const rank = new Map<string, number>(groups.map((g) => [g, 0]));
  for (let pass = 0; pass <= groups.length; pass++) {
    let changed = false;
    for (let i = post.length - 1; i >= 0; i--) {
      const v = post[i];
      for (const w of dag.get(v)!) {
        if (rank.get(w)! < rank.get(v)! + 1) {
          rank.set(w, rank.get(v)! + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  let k = 0;
  const columns: Record<string, number> = {};
  for (const g of groups) {
    columns[g] = rank.get(g)! + 1;
    k = Math.max(k, rank.get(g)! + 1);
  }
  for (const p of [...src].sort(cmp)) if (!isGroup.has(p)) columns[`src:${p}`] = 0;
  for (const p of [...dst].sort(cmp)) if (!isGroup.has(p)) columns[`dst:${p}`] = k + 1;
  return { columns, edges: out, reversed };
}

type Box = Pick<PlacedNode, "column" | "x" | "y" | "w" | "h"> & { id?: string };
const gapX = (c: number) => PAD + c * COL_PITCH + NODE_W + (COL_PITCH - NODE_W) / 2;
/** Where the vertical run of an edge is drawn in gap `gap` (right of column `gap`); `owner` is the chain element on the gap's left. */
export type TrackX = (gap: number, owner: Box) => number;
const SAME_COLUMN_OUT = PAD / 2;

/**
 * Orthogonal route from `a` to `b`. `lanes` are the dummy slots of a long edge, one per intermediate column: the
 * route runs through each slot's own y, so no segment crosses a real box (slots are reserved), and turns in the
 * column gaps only (at `track`, default the gap's middle). Corners are sharp.
 */
export function elbow(a: Box, b: Box, lanes: Box[] = [], track: TrackX = (g) => gapX(g)): { points: Pt[]; anchors: [Pt, Pt] } {
  const cy = (n: Box) => n.y + n.h / 2;
  if (a.column === b.column) {
    const x = a.x + a.w + SAME_COLUMN_OUT;
    return {
      points: [{ x: a.x + a.w, y: cy(a) }, { x, y: cy(a) }, { x, y: cy(b) }, { x: b.x + b.w, y: cy(b) }],
      anchors: [{ x, y: cy(b) }, { x, y: cy(a) }],
    };
  }
  const dir = b.column > a.column ? 1 : -1;
  const chain = [a, ...lanes, b];
  const ys = chain.map(cy);
  const gx = chain.slice(0, -1).map((n, i) => {
    const gap = dir > 0 ? n.column : n.column - 1;
    return track(gap, dir > 0 ? n : chain[i + 1]);
  });
  const raw: Pt[] = [{ x: dir > 0 ? a.x + a.w : a.x, y: ys[0] }];
  gx.forEach((x, i) => raw.push({ x, y: ys[i] }, { x, y: ys[i + 1] }));
  raw.push({ x: dir > 0 ? b.x : b.x + b.w, y: ys[ys.length - 1] });
  const pts = raw.filter((p, i) => i === 0 || p.x !== raw[i - 1].x || p.y !== raw[i - 1].y);
  const points = pts.filter((p, i) => {
    const q = pts[i - 1];
    const r = pts[i + 1];
    return !q || !r || !((q.x === p.x && p.x === r.x) || (q.y === p.y && p.y === r.y));
  });
  return { points, anchors: [{ x: gx[0], y: ys[1] }, { x: gx[gx.length - 1], y: ys[ys.length - 2] }] };
}

export function layout(nodesIn: LayoutNode[], edgesIn: LayoutEdge[]): GraphLayout {
  // 1. Normalise.
  const col = new Map<string, number>();
  // A duplicate id keeps its smallest column, so the result does not depend on input order.
  for (const n of [...nodesIn].sort((a, b) => cmp(a.id, b.id) || a.column - b.column)) if (!col.has(n.id)) col.set(n.id, n.column);
  const ids = [...col.keys()];
  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const e of [...edgesIn].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to))) {
    if (e.from === e.to || !col.has(e.from) || !col.has(e.to)) continue;
    const k = e.from + SEP + e.to;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push(e);
  }

  // 3. Islands: connected components, ordered by smallest id.
  const adj = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const e of edges) {
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const comp = new Map<string, number>();
  const islands: string[][] = [];
  const single: string[] = [];
  for (const id of ids) {
    if (comp.has(id)) continue;
    const members = [id];
    comp.set(id, -1);
    for (let i = 0; i < members.length; i++) {
      for (const w of adj.get(members[i])!) {
        if (!comp.has(w)) {
          comp.set(w, -1);
          members.push(w);
        }
      }
    }
    if (members.length === 1) single.push(id);
    else {
      members.sort(cmp);
      islands.push(members);
    }
  }
  islands.forEach((m, i) => m.forEach((id) => comp.set(id, i)));

  const placed: PlacedNode[] = [];
  const at = new Map<string, PlacedNode>();
  const chains: { e: LayoutEdge; ids: string[] }[] = [];
  const put = (p: PlacedNode) => {
    placed.push(p);
    at.set(p.id, p);
  };
  let top = PAD;

  islands.forEach((members, ii) => {
    const mine = edges.filter((e) => comp.get(e.from) === ii);
    // 4. Long edges: one dummy per intermediate column. Links join adjacent columns only.
    const colOf = new Map<string, number>(members.map((m) => [m, col.get(m)!]));
    const links = new Map<string, string[]>();
    const link = (a: string, b: string) => {
      (links.get(a) ?? links.set(a, []).get(a)!).push(b);
      (links.get(b) ?? links.set(b, []).get(b)!).push(a);
    };
    const key = new Map<string, number>();
    const byCol = new Map<number, string[]>();
    const add = (id: string, c: number) => (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(id);
    members.forEach((m) => add(m, col.get(m)!));
    // 5.1 initial order: reals by id, dummies beside their edge's source.
    for (const list of byCol.values()) list.forEach((m, i) => key.set(m, i));
    for (const e of mine) {
      const a = col.get(e.from)!;
      const b = col.get(e.to)!;
      const chain = [e.from];
      const step = b > a ? 1 : -1;
      if (Math.abs(a - b) > 1) {
        for (let c = a + step; c !== b; c += step) {
          const d = `~${e.from}|${e.to}|${c}`;
          colOf.set(d, c);
          key.set(d, key.get(e.from)! + 0.5);
          add(d, c);
          chain.push(d);
        }
      }
      chain.push(e.to);
      chains.push({ e, ids: chain });
      if (a !== b) for (let i = 0; i + 1 < chain.length; i++) link(chain[i], chain[i + 1]);
    }
    const cols = [...byCol.keys()].sort((a, b) => a - b);
    const pos = new Map<string, number>();
    for (const c of cols) {
      byCol.get(c)!.sort((a, b) => key.get(a)! - key.get(b)! || cmp(a, b));
      byCol.get(c)!.forEach((m, i) => pos.set(m, i));
    }
    // 5.2–5.5 barycenter sweeps, stable, no crossing counting.
    // ponytail: no crossing counting or transposition; add a transposition pass first, then @dagrejs/dagre (needs user OK) if crossings read badly.
    const sweep = (c: number, from: number) => {
      const list = byCol.get(c)!;
      const k = new Map<string, number>();
      for (const m of list) {
        const ns = (links.get(m) ?? []).filter((n) => colOf.get(n) === from);
        k.set(m, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(m)!);
      }
      list.sort((a, b) => k.get(a)! - k.get(b)! || pos.get(a)! - pos.get(b)!);
      list.forEach((m, i) => pos.set(m, i));
    };
    for (let s = 0; s < SWEEPS; s++) {
      if (s % 2 === 0) for (let i = 1; i < cols.length; i++) sweep(cols[i], cols[i] - 1);
      else for (let i = cols.length - 2; i >= 0; i--) sweep(cols[i], cols[i] + 1);
    }
    // 6. Coordinates: stack slots per column, centre in the island band.
    const slot = (m: string) => (col.has(m) ? ROW_PITCH : DUMMY_PITCH);
    const heights = cols.map((c) => byCol.get(c)!.reduce((s, m) => s + slot(m), 0));
    const band = Math.max(...heights);
    cols.forEach((c, ci) => {
      let y = top + (band - heights[ci]) / 2;
      for (const m of byCol.get(c)!) {
        const dummy = !col.has(m);
        put({
          id: m,
          column: c,
          x: PAD + c * COL_PITCH,
          y,
          w: NODE_W,
          h: dummy ? DUMMY_PITCH : NODE_H,
          island: ii,
          dummy,
        });
        y += slot(m);
      }
    });
    top += band + ISLAND_GAP;
  });

  // "Not connected" band: wrapping grid sorted by (column, id).
  if (single.length) {
    const per = Math.max(BAND_MIN_SLOTS, ...islands.map((m) => Math.max(...m.map((i) => col.get(i)!)) + 1));
    [...single]
      .sort((a, b) => col.get(a)! - col.get(b)! || cmp(a, b))
      .forEach((id, i) => {
        put({
          id,
          column: col.get(id)!,
          x: PAD + (i % per) * COL_PITCH,
          y: top + Math.floor(i / per) * ROW_PITCH,
          w: NODE_W,
          h: NODE_H,
          island: islands.length,
          dummy: false,
        });
      });
  }

  // ponytail: a horizontal exit or entry stub can run on another edge's line for 12-55 px when a source and another edge's target share a row in adjacent columns; upgrade path: entry ports per edge, or dagre.
  // 7. Edges: orthogonal routes through the dummy lanes, arrowhead drawn by the renderer at `to`.
  // One vertical track per left-side owner (a node or a lane) in each gap and island, spread inside the gap and
  // ordered by the owner's y: a fan-out keeps one shared bus, and unrelated edges never share a vertical run.
  const owners = new Map<string, Map<string, number>>();
  const trackKey = (gap: number, o: PlacedNode) => `${gap}${SEP}${o.island}`;
  for (const { ids: c } of chains) {
    for (let i = 0; i + 1 < c.length; i++) {
      const p = at.get(c[i])!;
      const q = at.get(c[i + 1])!;
      if (p.column === q.column) continue;
      const o = p.column < q.column ? p : q;
      const k = trackKey(Math.min(p.column, q.column), o);
      (owners.get(k) ?? owners.set(k, new Map()).get(k)!).set(o.id, o.y);
    }
  }
  const tracks = new Map<string, number>();
  for (const [k, m] of owners) {
    const gap = Number(k.split(SEP)[0]);
    const list = [...m].sort((a, b) => a[1] - b[1] || cmp(a[0], b[0]));
    list.forEach(([id], i) => tracks.set(k + SEP + id, PAD + gap * COL_PITCH + NODE_W + ((i + 1) * (COL_PITCH - NODE_W)) / (list.length + 1)));
  }
  const out: PlacedEdge[] = chains.map(({ e, ids: c }) => ({
    from: e.from,
    to: e.to,
    ...elbow(at.get(e.from)!, at.get(e.to)!, c.slice(1, -1).map((d) => at.get(d)!), (gap, o) => tracks.get(trackKey(gap, at.get(o.id!)!) + SEP + o.id!)!),
  }));

  let width = 2 * PAD;
  let height = 2 * PAD;
  for (const p of placed) {
    width = Math.max(width, p.x + p.w + PAD);
    height = Math.max(height, p.y + p.h + PAD);
  }
  return { nodes: placed, edges: out, width, height };
}

export interface LabelSpot {
  x: number;
  y: number;
  text: string;
}
export interface DrawnLabel extends LabelSpot {
  /** How many edges share this card ("... x3" when more than one). */
  n: number;
}
/**
 * Hover labels in screen space: edges with the same anchor x and text become one card at their median y; the rest
 * are moved down until cards that overlap horizontally (closer than `near`) are at least `minGap` apart.
 */
export function spreadLabels(items: LabelSpot[], minGap = 44, near = 120): DrawnLabel[] {
  const groups = new Map<string, LabelSpot[]>();
  for (const it of items) (groups.get(`${it.x}${SEP}${it.text}`) ?? groups.set(`${it.x}${SEP}${it.text}`, []).get(`${it.x}${SEP}${it.text}`)!).push(it);
  const merged: DrawnLabel[] = [...groups.values()].map((g) => {
    const ys = g.map((i) => i.y).sort((a, b) => a - b);
    return { x: g[0].x, text: g[0].text, y: ys[Math.floor(ys.length / 2)], n: g.length };
  });
  merged.sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.text, b.text));
  const out: DrawnLabel[] = [];
  for (const m of merged) {
    let y = m.y;
    for (const p of out) if (Math.abs(p.x - m.x) < near) y = Math.max(y, p.y + minGap);
    out.push({ ...m, y });
  }
  return out;
}

/** Centre for a label card of width `w` inside the column gap [gapLeft, gapRight] (2 px clear of each box); the gap's middle when it does not fit. */
export function clampToGap(x: number, w: number, gapLeft: number, gapRight: number): number {
  if (w + 4 >= gapRight - gapLeft) return (gapLeft + gapRight) / 2;
  return Math.min(gapRight - w / 2 - 2, Math.max(gapLeft + w / 2 + 2, x));
}
