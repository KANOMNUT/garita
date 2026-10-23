import { describe, expect, it } from "vitest";
import {
  COL_PITCH,
  NODE_W,
  PAD,
  elbow,
  layout,
  layoutKey,
  rankColumns,
  readingOrder,
  spreadLabels,
  clampToGap,
  type LayoutEdge,
  type LayoutNode,
} from "./graphLayout";

const n = (id: string, column: number): LayoutNode => ({ id, column });
const e = (from: string, to: string): LayoutEdge => ({ from, to });
const real = (l: ReturnType<typeof layout>) => l.nodes.filter((x) => !x.dummy);
const byId = (l: ReturnType<typeof layout>, id: string) => l.nodes.find((x) => x.id === id)!;

describe("layout", () => {
  it("gives identical output for shuffled input", () => {
    const nodes = [n("a", 0), n("b", 1), n("c", 1), n("d", 2), n("e", 3), n("lone", 2)];
    const edges = [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d"), e("a", "e")];
    const shuffled = layout([...nodes].reverse(), [...edges, e("a", "b"), e("a", "a")].reverse());
    expect(shuffled).toEqual(layout(nodes, edges));
  });

  it("respects columns", () => {
    const l = layout([n("a", 0), n("b", 2), n("c", 5)], [e("a", "b"), e("b", "c")]);
    for (const p of real(l)) expect(p.x).toBe(PAD + p.column * COL_PITCH);
  });

  it("orders islands by smallest id and puts singletons in the last band", () => {
    const l = layout(
      [n("z1", 0), n("z2", 1), n("a1", 0), n("a2", 1), n("m", 3), n("b", 2)],
      [e("z1", "z2"), e("a1", "a2")],
    );
    expect(byId(l, "a1").island).toBe(0);
    expect(byId(l, "z1").island).toBe(1);
    expect(byId(l, "b").island).toBe(2);
    expect(byId(l, "m").island).toBe(2);
    expect(byId(l, "b").y).toBeGreaterThan(byId(l, "z1").y);
    expect(readingOrder(l)).toEqual(["a1", "a2", "z1", "z2", "b", "m"]);
  });

  it("adds one dummy per intermediate column to a 0 to 3 edge and routes through their lanes", () => {
    const l = layout([n("a", 0), n("b", 3)], [e("a", "b")]);
    const dummies = l.nodes.filter((x) => x.dummy);
    expect(dummies.map((d) => d.column)).toEqual([1, 2]);
    const pts = l.edges[0].points;
    expect(pts[0].x).toBe(byId(l, "a").x + NODE_W);
    expect(pts[pts.length - 1].x).toBe(byId(l, "b").x);
    // The route holds each dummy lane's own y (a horizontal run through its column).
    for (const d of dummies) expect(pts.some((p) => p.y === d.y + d.h / 2)).toBe(true);
  });

  it("routes a leftward edge from the left side to the right side", () => {
    const l = layout([n("a", 0), n("b", 1)], [e("b", "a")]);
    const pts = l.edges[0].points;
    expect(pts[0].x).toBe(byId(l, "b").x);
    expect(pts[pts.length - 1].x).toBe(byId(l, "a").x + NODE_W);
  });

  it("dedupes node ids to the smallest column, whatever the input order", () => {
    const a = layout([n("x", 2), n("x", 1), n("y", 3)], [e("x", "y")]);
    const b = layout([n("y", 3), n("x", 1), n("x", 2)], [e("x", "y")]);
    expect(a).toEqual(b);
    expect(real(a).filter((p) => p.id === "x")).toHaveLength(1);
    expect(byId(a, "x").column).toBe(1);
  });

  it("uncrosses a 2x2 crossing fixture", () => {
    const l = layout([n("a0", 0), n("a1", 0), n("b0", 1), n("b1", 1)], [e("a0", "b1"), e("a1", "b0")]);
    const y = (id: string) => byId(l, id).y;
    expect(Math.sign(y("a0") - y("a1"))).toBe(Math.sign(y("b1") - y("b0")));
  });
});

describe("rankColumns", () => {
  it("ranks A to B to A and reverses exactly one edge, ignoring a self-loop", () => {
    const r = rankColumns(["A", "B"], [e("A", "B"), e("B", "A"), e("A", "A")], [], []);
    expect(r.reversed).toHaveLength(1);
    expect(r.columns).toEqual({ A: 1, B: 2 });
    expect(r.edges).toHaveLength(2);
  });

  it("pins src: and dst: pseudo-nodes to the first and last columns", () => {
    const r = rankColumns(["g1", "g2"], [e("ext", "g1"), e("g1", "g2"), e("g2", "ext")], ["ext"], ["ext"]);
    expect(r.columns).toEqual({ "src:ext": 0, g1: 1, g2: 2, "dst:ext": 3 });
    expect(r.edges).toEqual([e("src:ext", "g1"), e("g1", "g2"), e("g2", "dst:ext")]);
  });
});

describe("layoutKey and readingOrder", () => {
  it("layoutKey ignores status and input order, not the set", () => {
    const a = [{ id: "x", column: 0, status: "ok" }, n("y", 1)];
    const b = [n("y", 1), { id: "x", column: 0, status: "bad" }];
    expect(layoutKey(a, [e("x", "y")])).toBe(layoutKey(b, [e("x", "y")]));
    expect(layoutKey(a, [])).not.toBe(layoutKey(a, [e("x", "y")]));
    expect(layoutKey(a, [])).not.toBe(layoutKey([n("x", 0)], []));
  });

  it("readingOrder excludes dummies", () => {
    const l = layout([n("a", 0), n("b", 3)], [e("a", "b")]);
    expect(l.nodes.some((x) => x.dummy)).toBe(true);
    expect(readingOrder(l)).toEqual(["a", "b"]);
  });
});

const box = (column: number, y: number, h = 52) => ({ column, x: PAD + column * COL_PITCH, y, w: NODE_W, h });

describe("elbow", () => {
  it("is a straight line when both ends share a y", () => {
    const r = elbow(box(0, 100), box(1, 100));
    expect(r.points).toEqual([{ x: PAD + NODE_W, y: 126 }, { x: PAD + COL_PITCH, y: 126 }]);
  });

  it("turns once in the gap: horizontal, vertical, horizontal", () => {
    const gx = PAD + NODE_W + (COL_PITCH - NODE_W) / 2;
    const r = elbow(box(0, 100), box(1, 200));
    expect(r.points).toEqual([
      { x: PAD + NODE_W, y: 126 }, { x: gx, y: 126 }, { x: gx, y: 226 }, { x: PAD + COL_PITCH, y: 226 },
    ]);
    expect(r.anchors).toEqual([{ x: gx, y: 226 }, { x: gx, y: 126 }]);
  });

  it("uses the lane y inside each intermediate column", () => {
    const lane1 = box(1, 10, 16);
    const lane2 = box(2, 300, 16);
    const r = elbow(box(0, 100), box(3, 200), [lane1, lane2]);
    expect(r.points.some((p) => p.y === 18)).toBe(true);
    expect(r.points.some((p) => p.y === 308)).toBe(true);
    for (let i = 1; i < r.points.length; i++) {
      expect(r.points[i].x === r.points[i - 1].x || r.points[i].y === r.points[i - 1].y).toBe(true);
    }
  });

  it("goes right to left for a leftward edge and loops out the right side for a same-column edge", () => {
    const r = elbow(box(2, 100), box(0, 100));
    expect(r.points[0].x).toBe(PAD + 2 * COL_PITCH);
    expect(r.points[r.points.length - 1].x).toBe(PAD + NODE_W);
    const s = elbow(box(2, 100), box(2, 200));
    expect(s.points[0].x).toBe(s.points[3].x);
    expect(s.points[1].x).toBeGreaterThan(s.points[0].x);
  });
});

describe("layout routing invariant", () => {
  // A screenshot-shaped namespace: Ingress, Service, HPA, Deployment, 5 ReplicaSets, Pod, ConfigMap, Secrets.
  const nodes = [
    n("ing", 0), n("svc", 2), n("hpa", 2), n("dep", 3),
    ...["rs1", "rs2", "rs3", "rs4", "rs5"].map((id) => n(id, 4)),
    n("pod", 5), n("cm", 6), n("s1", 6), n("s2", 6), n("s3", 6),
  ];
  const edges = [
    e("ing", "svc"), e("svc", "pod"), e("hpa", "dep"), e("dep", "rs1"), e("dep", "rs2"), e("dep", "rs3"), e("dep", "rs4"),
    e("dep", "rs5"), e("rs1", "pod"), e("pod", "cm"), e("pod", "s1"), e("pod", "s2"), e("pod", "s3"),
    e("pod", "dep"), e("ing", "pod"), e("hpa", "svc"),
  ];

  it("on this fixture no segment crosses a box other than its own two ends, and every point stays on the canvas", () => {
    const l = layout(nodes, edges);
    const boxes = real(l);
    for (const ed of l.edges) {
      for (const p of ed.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(l.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(l.height);
      }
      for (const a of ed.anchors) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThanOrEqual(l.width);
      }
      for (let i = 1; i < ed.points.length; i++) {
        const p = ed.points[i - 1];
        const q = ed.points[i];
        // Orthogonal.
        expect(p.x === q.x || p.y === q.y).toBe(true);
        const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
        for (const b of boxes) {
          if (b.id === ed.from || b.id === ed.to) continue;
          const hit = x1 > b.x && x0 < b.x + b.w && y1 > b.y && y0 < b.y + b.h;
          expect(hit, `${ed.from}>${ed.to} crosses ${b.id}`).toBe(false);
        }
      }
    }
  });

  it("on this fixture no two edges without a shared endpoint run on the same vertical or horizontal line (stubs next to a shared row are a known ceiling)", () => {
    const l = layout(nodes, edges);
    const segs = l.edges.flatMap((ed) => ed.points.slice(1).map((q, i) => ({ ed, p: ed.points[i], q })));
    const span = (a: number, b: number, c: number, d: number) => Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i], b = segs[j];
        if (a.ed === b.ed || [a.ed.from, a.ed.to].some((x) => x === b.ed.from || x === b.ed.to)) continue;
        const vv = a.p.x === a.q.x && b.p.x === b.q.x && a.p.x === b.p.x && span(a.p.y, a.q.y, b.p.y, b.q.y) > 0;
        const hh = a.p.y === a.q.y && b.p.y === b.q.y && a.p.y === b.p.y && span(a.p.x, a.q.x, b.p.x, b.q.x) > 0;
        expect(vv || hh, `${a.ed.from}>${a.ed.to} overlaps ${b.ed.from}>${b.ed.to}`).toBe(false);
      }
    }
  });

  it("a fan-out shares one vertical track; different sources in one gap get different tracks inside it", () => {
    const l = layout(nodes, edges);
    const turn = (from: string, to: string) => l.edges.find((x) => x.from === from && x.to === to)!.points[1].x;
    expect(turn("dep", "rs1")).toBe(turn("dep", "rs5"));
    const gapLeft = PAD + 2 * COL_PITCH + NODE_W;
    expect(turn("hpa", "dep")).not.toBe(turn("svc", "pod"));
    for (const x of [turn("hpa", "dep"), turn("svc", "pod")]) {
      expect(x).toBeGreaterThan(gapLeft);
      expect(x).toBeLessThan(gapLeft + COL_PITCH - NODE_W);
    }
  });
});

describe("clampToGap", () => {
  it("keeps a card inside the gap, 2 px clear of both boxes", () => {
    expect(clampToGap(100, 40, 100, 220)).toBe(122);
    expect(clampToGap(300, 40, 100, 220)).toBe(198);
    expect(clampToGap(160, 40, 100, 220)).toBe(160);
  });
  it("centres on the gap when the card is wider than it", () => {
    expect(clampToGap(105, 130, 100, 220)).toBe(160);
  });
});

describe("spreadLabels", () => {
  it("merges the same anchor x and text into one card with a count", () => {
    const r = spreadLabels([{ x: 100, y: 10, text: "selects" }, { x: 100, y: 26, text: "selects" }, { x: 100, y: 42, text: "selects" }]);
    expect(r).toEqual([{ x: 100, y: 26, text: "selects", n: 3 }]);
  });
  it("spreads three different labels 16 px apart to at least 44 px", () => {
    const r = spreadLabels([{ x: 100, y: 10, text: "a" }, { x: 100, y: 26, text: "b" }, { x: 100, y: 42, text: "c" }]);
    expect(r.map((c) => c.text)).toEqual(["a", "b", "c"]);
    for (let i = 1; i < r.length; i++) expect(r[i].y - r[i - 1].y).toBeGreaterThanOrEqual(44);
  });
  it("leaves cards in different gaps alone", () => {
    const r = spreadLabels([{ x: 100, y: 10, text: "a" }, { x: 500, y: 12, text: "b" }]);
    expect(r.map((c) => c.y)).toEqual([10, 12]);
  });
});
