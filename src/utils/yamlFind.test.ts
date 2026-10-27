import { describe, expect, it } from "vitest";
import {
  FIND_CAP, MIRROR_TAIL, findCountText, findStatusText, firstAtOrAfter, lineOf, prefillFrom, scrollTopFor,
  shortcutMatches, yamlMatches, yamlSegments,
} from "./yamlFind";

describe("yamlMatches", () => {
  it("finds literal, case-insensitive matches in order", () => {
    const r = yamlMatches("spec:\n  Replicas: 3\n  replicas: 3\n", "REPLICAS");
    expect(r.ranges).toEqual([{ start: 8, end: 16 }, { start: 22, end: 30 }]);
    expect(r.more).toBe(false);
  });
  it("has no matches for a blank or whitespace-only query", () => {
    expect(yamlMatches("a b c", "")).toEqual({ ranges: [], more: false });
    expect(yamlMatches("a b c", "   ")).toEqual({ ranges: [], more: false });
  });
  it("uses a query with spaces as typed (no trimming)", () => {
    expect(yamlMatches("a b ab", " b").ranges).toEqual([{ start: 1, end: 3 }]);
  });
  it("takes regex metacharacters literally", () => {
    expect(yamlMatches("axb a.b", "a.b").ranges).toEqual([{ start: 4, end: 7 }]);
    expect(yamlMatches("x(y)", "(y)").ranges).toEqual([{ start: 1, end: 4 }]);
  });
  it("keeps offsets of the original string where lower-casing changes a length", () => {
    // "İ".toLowerCase() is two code units; the regex runs on the original, so the match still starts at 1.
    expect(yamlMatches("İreplicas", "replicas").ranges).toEqual([{ start: 1, end: 9 }]);
  });
  it("does not overlap matches", () => {
    expect(yamlMatches("aaa", "aa").ranges).toEqual([{ start: 0, end: 2 }]);
  });
  it("caps at FIND_CAP and reports more", () => {
    const text = "x".repeat(FIND_CAP + 5);
    const r = yamlMatches(text, "x");
    expect(r.ranges).toHaveLength(FIND_CAP);
    expect(r.more).toBe(true);
    const exact = yamlMatches("x".repeat(FIND_CAP), "x");
    expect(exact.ranges).toHaveLength(FIND_CAP);
    expect(exact.more).toBe(false);
  });
  it("honours a custom cap", () => {
    expect(yamlMatches("a a a a", "a", 2)).toEqual({ ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }], more: true });
  });
});

describe("yamlSegments", () => {
  const joined = (text: string, ranges: { start: number; end: number }[], current: number | null) =>
    yamlSegments(text, ranges, current).map((s) => s.text).join("");
  const currents = (text: string, ranges: { start: number; end: number }[], current: number | null) =>
    yamlSegments(text, ranges, current).filter((s) => s.mark === "current").length;

  it("returns one unmarked segment without ranges", () => {
    expect(yamlSegments("abc", [], null)).toEqual([{ text: "abc", mark: "none" }]);
  });
  it("returns nothing for an empty text", () => {
    expect(yamlSegments("", [], null)).toEqual([]);
  });
  it("marks other matches and the current one", () => {
    const ranges = yamlMatches("a-b-a", "a").ranges;
    expect(yamlSegments("a-b-a", ranges, 1)).toEqual([
      { text: "a", mark: "match" }, { text: "-b-", mark: "none" }, { text: "a", mark: "current" },
    ]);
  });
  it("joins back to the text for ranges at the start, at the end, adjacent and around a trailing newline", () => {
    const cases: [string, string][] = [
      ["replicas: 3\n", "replicas"],
      ["x: replicas", "replicas"],
      ["aaaa", "a"],
      ["abab\n", "ab"],
      ["tail replicas\n", "replicas"],
      ["\nreplicas\n\n", "replicas"],
      ["\n", "\n"],
    ];
    for (const [text, query] of cases) {
      const ranges = yamlMatches(text, query).ranges;
      for (const current of [null, 0, ranges.length - 1]) {
        expect(joined(text, ranges, current), `${JSON.stringify(text)} / ${current}`).toBe(text);
      }
    }
  });
  it("has exactly one current segment when a current match is given, none otherwise", () => {
    const text = "ab ab ab\nab";
    const ranges = yamlMatches(text, "ab").ranges;
    expect(ranges).toHaveLength(4);
    for (const current of [0, 1, 3]) expect(currents(text, ranges, current)).toBe(1);
    expect(currents(text, ranges, null)).toBe(0);
    expect(currents(text, ranges, 9)).toBe(0);
    expect(currents(text, ranges, -1)).toBe(0);
  });
  it("joins back to the text at the cap with the current match last", () => {
    const text = "x\n".repeat(FIND_CAP + 10);
    const { ranges, more } = yamlMatches(text, "x");
    expect(more).toBe(true);
    expect(ranges).toHaveLength(FIND_CAP);
    expect(joined(text, ranges, FIND_CAP - 1)).toBe(text);
    expect(currents(text, ranges, FIND_CAP - 1)).toBe(1);
  });
});

describe("MIRROR_TAIL", () => {
  it("is one zero-width character", () => {
    expect(MIRROR_TAIL).toHaveLength(1);
    expect(MIRROR_TAIL.charCodeAt(0)).toBe(0x200b);
  });
});

describe("firstAtOrAfter", () => {
  const ranges = [{ start: 4, end: 6 }, { start: 10, end: 12 }, { start: 20, end: 22 }];
  it("finds the first range starting at or after the caret", () => {
    expect(firstAtOrAfter(ranges, 0)).toBe(0);
    expect(firstAtOrAfter(ranges, 4)).toBe(0);
    expect(firstAtOrAfter(ranges, 5)).toBe(1);
    expect(firstAtOrAfter(ranges, 20)).toBe(2);
  });
  it("wraps to the first range past the last start", () => {
    expect(firstAtOrAfter(ranges, 21)).toBe(0);
  });
  it("is null without ranges", () => {
    expect(firstAtOrAfter([], 3)).toBeNull();
  });
});

describe("lineOf", () => {
  const text = "a\nbb\n\nccc";
  it("is 1-based", () => {
    expect(lineOf(text, 0)).toBe(1);
    expect(lineOf(text, 1)).toBe(1); // on the newline itself
    expect(lineOf(text, 2)).toBe(2);
    expect(lineOf(text, 5)).toBe(3);
    expect(lineOf(text, 6)).toBe(4);
  });
  it("clamps an offset outside the text", () => {
    expect(lineOf(text, 999)).toBe(4);
    expect(lineOf(text, -5)).toBe(1);
    expect(lineOf("", 0)).toBe(1);
  });
});

describe("findCountText", () => {
  it("is empty while the query is blank", () => {
    expect(findCountText("", false, null, 0, false)).toBe("");
    expect(findCountText("  ", false, null, 0, false)).toBe("");
  });
  it("reads an empty text first", () => {
    expect(findCountText("", true, null, 0, false)).toBe("Nothing to search.");
    expect(findCountText("x", true, null, 0, false)).toBe("Nothing to search.");
  });
  it("says No matches", () => {
    expect(findCountText("x", false, null, 0, false)).toBe("No matches");
  });
  it("counts from 1", () => {
    expect(findCountText("x", false, 2, 12, false)).toBe("3 of 12");
    expect(findCountText("x", false, 0, 1, false)).toBe("1 of 1");
  });
  it("marks the cap", () => {
    expect(findCountText("x", false, 0, 1000, true)).toBe("1 of 1000+");
  });
});

describe("findStatusText", () => {
  it("speaks counts", () => {
    expect(findStatusText("count", 0, 12, false)).toBe("12 matches");
    expect(findStatusText("count", 0, 1, false)).toBe("1 match");
    expect(findStatusText("count", null, 0, false)).toBe("No matches");
    expect(findStatusText("count", 0, 1000, true)).toBe("More than 1000 matches. Showing the first 1000.");
  });
  it("speaks positions", () => {
    expect(findStatusText("step", 2, 12, false)).toBe("3 of 12");
    expect(findStatusText("step", 2, 12, false, 48)).toBe("3 of 12, line 48");
    expect(findStatusText("step", 0, 12, false, undefined, true)).toBe("1 of 12, wrapped");
    expect(findStatusText("step", 0, 12, false, 3, true)).toBe("1 of 12, line 3, wrapped");
    expect(findStatusText("step", 0, 1000, true)).toBe("1 of 1000+");
    expect(findStatusText("step", null, 0, false)).toBe("No matches");
  });
});

describe("shortcutMatches", () => {
  const ev = (o: Partial<Parameters<typeof shortcutMatches>[0]>) => ({
    key: "f", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, ...o,
  });
  it("is Cmd+F on macOS and nothing else there", () => {
    expect(shortcutMatches(ev({ metaKey: true }), true)).toBe(true);
    expect(shortcutMatches(ev({ ctrlKey: true }), true)).toBe(false);
    expect(shortcutMatches(ev({ metaKey: true, ctrlKey: true }), true)).toBe(false);
    expect(shortcutMatches(ev({}), true)).toBe(false);
  });
  it("is Ctrl+F elsewhere and nothing else there", () => {
    expect(shortcutMatches(ev({ ctrlKey: true }), false)).toBe(true);
    expect(shortcutMatches(ev({ metaKey: true }), false)).toBe(false);
    expect(shortcutMatches(ev({ metaKey: true, ctrlKey: true }), false)).toBe(false);
    expect(shortcutMatches(ev({}), false)).toBe(false);
  });
  it("compares the key lower-cased", () => {
    expect(shortcutMatches(ev({ key: "F", ctrlKey: true }), false)).toBe(true);
    expect(shortcutMatches(ev({ key: "g", ctrlKey: true }), false)).toBe(false);
  });
  it("rejects Shift, Alt and composition on both platforms", () => {
    for (const isMac of [true, false]) {
      const mod = isMac ? { metaKey: true } : { ctrlKey: true };
      expect(shortcutMatches(ev({ ...mod, shiftKey: true }), isMac)).toBe(false);
      expect(shortcutMatches(ev({ ...mod, altKey: true }), isMac)).toBe(false);
      expect(shortcutMatches(ev({ ...mod, isComposing: true }), isMac)).toBe(false);
    }
  });
});

describe("prefillFrom", () => {
  it("takes a one-line selection of 1 to 120 characters", () => {
    expect(prefillFrom("a")).toBe("a");
    expect(prefillFrom("replicas: 3")).toBe("replicas: 3");
    expect(prefillFrom("x".repeat(120))).toBe("x".repeat(120));
  });
  it("rejects empty, over-long, multi-line and blank selections", () => {
    expect(prefillFrom("")).toBeNull();
    expect(prefillFrom("x".repeat(121))).toBeNull();
    expect(prefillFrom("a\nb")).toBeNull();
    expect(prefillFrom("a\r\nb")).toBeNull();
    expect(prefillFrom("\n")).toBeNull();
    expect(prefillFrom("   ")).toBeNull();
  });
});

describe("scrollTopFor", () => {
  const lh = 17.6;
  const view = 400;
  it("leaves the scroll alone when the line is two lines inside the view", () => {
    expect(scrollTopFor(200, lh, 100, view)).toBe(100);
    expect(scrollTopFor(100 + 2 * lh, lh, 100, view)).toBe(100);
  });
  it("scrolls up so the line sits two lines below the top edge", () => {
    expect(scrollTopFor(150, lh, 300, view)).toBeCloseTo(150 - 2 * lh);
    expect(scrollTopFor(100 + lh, lh, 100, view)).toBeCloseTo(100 + lh - 2 * lh);
  });
  it("scrolls down so the line sits two lines above the bottom edge", () => {
    const top = 900;
    expect(scrollTopFor(top, lh, 0, view)).toBeCloseTo(top + lh + 2 * lh - view);
  });
  it("never returns a negative scroll", () => {
    expect(scrollTopFor(0, lh, 50, view)).toBe(0);
    expect(scrollTopFor(10, lh, 0, view)).toBe(0);
  });
  it("shrinks the margin in a view too short for two lines each side", () => {
    // 3 lines tall: margin = one line, so the line ends up centred.
    const short = 3 * lh;
    const top = scrollTopFor(500, lh, 0, short);
    expect(top).toBeCloseTo(500 + lh + lh - short);
    expect(500).toBeGreaterThanOrEqual(top);
    expect(500 + lh).toBeLessThanOrEqual(top + short);
  });
});
