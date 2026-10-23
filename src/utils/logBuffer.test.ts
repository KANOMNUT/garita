import { describe, it, expect } from "vitest";
import { appendBounded, MAX_LOG_LINES, removeMatching } from "./logBuffer";

describe("appendBounded", () => {
  it("cap equals the server-side ceiling", () => {
    expect(MAX_LOG_LINES).toBe(5000);
  });

  it("appends under the cap without dropping", () => {
    expect(appendBounded([1, 2], [3], 5)).toEqual({ buf: [1, 2, 3], dropped: 0 });
  });

  it("drops the oldest when over the cap", () => {
    expect(appendBounded([1, 2, 3], [4, 5], 4)).toEqual({ buf: [2, 3, 4, 5], dropped: 1 });
  });

  it("a burst larger than the cap keeps only the newest cap entries", () => {
    const r = appendBounded([1, 2], [3, 4, 5, 6, 7], 3);
    expect(r.buf).toEqual([5, 6, 7]);
    expect(r.dropped).toBe(4);
  });

  it("does not mutate its inputs", () => {
    const a = [1, 2, 3];
    const b = [4];
    appendBounded(a, b, 3);
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([4]);
  });

  it("empty incoming is a no-op", () => {
    const a = [1];
    const r = appendBounded(a, [], 3);
    expect(r.buf).toBe(a);
    expect(r.dropped).toBe(0);
  });

  it("exactly at the cap drops nothing", () => {
    expect(appendBounded([1, 2], [3], 3)).toEqual({ buf: [1, 2, 3], dropped: 0 });
  });
});

describe("removeMatching", () => {
  const a = (pod: string, n: number) => ({ pod, n });

  it("drops one pod's lines from the buffer and keeps the rest in order", () => {
    const buf = [a("x", 1), a("y", 2), a("x", 3), a("y", 4)];
    const r = removeMatching(buf, [], (l) => l.pod === "x", 10);
    expect(r).toEqual({ buf: [a("y", 2), a("y", 4)], dropped: 0 });
  });

  it("also drops matching lines still queued, so none survive the removal", () => {
    const r = removeMatching([a("x", 1), a("y", 2)], [a("x", 3), a("y", 4)], (l) => l.pod === "x", 10);
    expect(r.buf).toEqual([a("y", 2), a("y", 4)]);
  });

  it("does not mutate its inputs", () => {
    const buf = [a("x", 1), a("y", 2)];
    const pending = [a("x", 3)];
    removeMatching(buf, pending, (l) => l.pod === "x", 10);
    expect(buf).toEqual([a("x", 1), a("y", 2)]);
    expect(pending).toEqual([a("x", 3)]);
  });

  it("still applies the cap to what remains, counting only cap overflow as dropped", () => {
    const r = removeMatching([a("y", 1), a("y", 2), a("x", 3)], [a("y", 4), a("y", 5)], (l) => l.pod === "x", 3);
    expect(r.buf).toEqual([a("y", 2), a("y", 4), a("y", 5)]);
    expect(r.dropped).toBe(1);
  });

  it("matching nothing keeps every line", () => {
    const r = removeMatching([a("y", 1)], [a("y", 2)], () => false, 10);
    expect(r).toEqual({ buf: [a("y", 1), a("y", 2)], dropped: 0 });
  });
});
