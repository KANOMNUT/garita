import { describe, expect, it } from "vitest";
import {
  activeChips, clearFilters, compileFilters, compileMatcher, countText, defaultLogView, filtersCount, findRanges,
  filteredEmptyText, isFiltering, legacyColumns, levelCounts, markSegments, matchPosition, matchSeqs, matchesLine,
  passesFilters, pruneToPresent, removeChip, stepMatch, toggleLevel, type LogViewState,
} from "./logFilter";
import { parseLogLine } from "./logParse";

const view = (patch: Partial<LogViewState> = {}): LogViewState => ({ ...defaultLogView("single"), ...patch });
const line = (raw: string, timestamps = false) => parseLogLine(raw, timestamps);

describe("compileMatcher / findRanges", () => {
  it("is null for empty text", () => {
    expect(compileMatcher("", false, false)).toBeNull();
  });
  it("matches plain text case-insensitively by default and escapes regex characters", () => {
    const m = compileMatcher("a.b", false, false);
    expect(findRanges("xA.B a-b", m)).toEqual([{ start: 1, end: 4 }]);
  });
  it("honours the case toggle", () => {
    expect(findRanges("Err err", compileMatcher("err", false, true))).toEqual([{ start: 4, end: 7 }]);
    expect(findRanges("Err err", compileMatcher("err", false, false))).toHaveLength(2);
  });
  it("treats an invalid regex as plain text and says so", () => {
    const m = compileMatcher("a(", true, false);
    expect(m?.invalid).toBe(true);
    expect(findRanges("xa(y", m)).toEqual([{ start: 1, end: 3 }]);
  });
  it("ignores zero-length matches so they neither mark nor count", () => {
    const m = compileMatcher("x*", true, false);
    expect(findRanges("abc", m)).toEqual([]);
    expect(matchesLine("abc", m)).toBe(false);
    expect(matchesLine("abxc", m)).toBe(true);
  });
  it("never leaves lastIndex dirty between calls", () => {
    const m = compileMatcher("a", false, false);
    expect(findRanges("aa", m)).toHaveLength(2);
    expect(findRanges("aa", m)).toHaveLength(2);
    expect(matchesLine("a", m)).toBe(true);
    expect(matchesLine("a", m)).toBe(true);
  });
  it("matches HTML-looking text literally, not inside escaped entities", () => {
    expect(matchesLine('say "hi" <b> & more', compileMatcher('"hi"', false, false))).toBe(true);
    expect(matchesLine('say "hi"', compileMatcher("quot", false, false))).toBe(false);
    expect(matchesLine("a < b", compileMatcher("<", false, false))).toBe(true);
  });
});

describe("filters match the body, not the Kubernetes timestamp", () => {
  it("does not search the timestamp prefix", () => {
    const l = line("2026-10-03T14:02:11.482Z connection refused", true);
    const f = compileFilters(view({ include: "2026" }));
    expect(passesFilters(l, f)).toBe(false);
    expect(passesFilters(l, compileFilters(view({ include: "refused" })))).toBe(true);
  });
  it("Exclude wins over Include", () => {
    const l = line("healthcheck ok");
    expect(passesFilters(l, compileFilters(view({ include: "ok", exclude: "healthcheck" })))).toBe(false);
    expect(passesFilters(l, compileFilters(view({ include: "ok" })))).toBe(true);
  });
  it("hides lines whose level is switched off", () => {
    const err = line('{"level":"error","msg":"x"}');
    const f = compileFilters(toggleLevel(view(), "ERROR"));
    expect(passesFilters(err, f)).toBe(false);
    expect(passesFilters(line("plain"), f)).toBe(true);
  });
});

describe("levelCounts", () => {
  it("counts loaded lines that pass Include and Exclude, not the level filter itself", () => {
    const lines = [
      line("[ERROR] boom a"), line("[ERROR] boom b healthcheck"), line("[WARN] careful"), line("plain boom"),
    ];
    const f = compileFilters(view({ exclude: "healthcheck", hiddenLevels: ["ERROR"] }));
    expect(levelCounts(lines, f)).toEqual({ ERROR: 1, WARN: 1, INFO: 0, DEBUG: 0, none: 1 });
  });
});

describe("active-filter strip", () => {
  it("lists exclude, highlight and hidden levels, not Include, wrap or JSON", () => {
    const v = view({ include: "a", exclude: "healthcheck", highlight: "refused", hiddenLevels: ["DEBUG", "none"], json: true, wrap: true });
    expect(activeChips(v, false).map((c) => c.label)).toEqual([
      "exclude: healthcheck", "highlight: refused", "levels: no DEBUG, no level",
    ]);
    expect(filtersCount(v, false)).toBe(3);
  });
  it("adds regex and case chips only in compact mode", () => {
    const v = view({ regex: true, caseSensitive: true });
    expect(activeChips(v, false)).toEqual([]);
    expect(activeChips(v, true).map((c) => c.id)).toEqual(["regex", "case"]);
    expect(filtersCount(v, true)).toBe(2);
  });
  it("removes one chip at a time", () => {
    const v = view({ exclude: "x", hiddenLevels: ["INFO"] });
    expect(removeChip(v, "exclude").exclude).toBe("");
    expect(removeChip(v, "levels").hiddenLevels).toEqual([]);
    expect(removeChip(v, "exclude").hiddenLevels).toEqual(["INFO"]);
  });
  it("clearFilters clears the text and level filters but keeps display modes", () => {
    const v = clearFilters(view({ include: "a", exclude: "b", highlight: "c", hiddenLevels: ["INFO"], json: true, wrap: true }));
    expect(v).toMatchObject({ include: "", exclude: "", highlight: "", hiddenLevels: [], json: true, wrap: true });
  });
  it("highlight alone does not count as filtering", () => {
    expect(isFiltering(view({ highlight: "x" }))).toBe(false);
    expect(isFiltering(view({ include: "x" }))).toBe(true);
    expect(isFiltering(view({ hiddenLevels: ["INFO"] }))).toBe(true);
  });
});

describe("copy", () => {
  it("states the count with and without a filter", () => {
    expect(countText(5000, 5000, false)).toBe("5,000 lines");
    expect(countText(5000, 37, true)).toBe("37 of 5,000 lines");
    expect(filteredEmptyText(4988)).toBe("No lines match. 4,988 loaded lines are hidden by the filters.");
  });
});

describe("markSegments", () => {
  it("returns one plain segment without ranges", () => {
    expect(markSegments("hello", 0, 5, [], [])).toEqual([{ text: "hello", kind: "plain" }]);
  });
  it("marks include, highlight and overlap", () => {
    const segs = markSegments("abcdefgh", 0, 8, [{ start: 1, end: 5 }], [{ start: 3, end: 7 }]);
    expect(segs).toEqual([
      { text: "a", kind: "plain" },
      { text: "bc", kind: "match" },
      { text: "de", kind: "both" },
      { text: "fg", kind: "highlight" },
      { text: "h", kind: "plain" },
    ]);
  });
  it("slices by column so a match in the level word is still marked", () => {
    const body = "14:02:11.482 ERROR connection refused";
    const cols = legacyColumns(body);
    expect(cols).not.toBeNull();
    const ranges = findRanges(body, compileMatcher("error", false, false));
    const word = markSegments(body, cols!.word.start, cols!.word.end, ranges, []);
    expect(word).toEqual([{ text: "ERROR", kind: "match" }]);
    const msg = markSegments(body, cols!.msg.start, cols!.msg.end, ranges, []);
    expect(msg).toEqual([{ text: "connection refused", kind: "plain" }]);
  });
  it("clips a range that straddles a column boundary", () => {
    const body = "14:02:11.482 ERROR boom";
    const cols = legacyColumns(body)!;
    const straddle = [{ start: cols.ts.end - 2, end: cols.word.start + 2 }];
    expect(markSegments(body, cols.ts.start, cols.ts.end, straddle, []).slice(-1)[0]).toEqual({ text: "82", kind: "match" });
    expect(markSegments(body, cols.word.start, cols.word.end, straddle, [])[0]).toEqual({ text: "ER", kind: "match" });
  });
  it("legacyColumns is null for anything else", () => {
    expect(legacyColumns("plain line")).toBeNull();
  });
  it("never emits markup: HTML in the line stays plain text", () => {
    const body = '<img src=x onerror="alert(1)">';
    const segs = markSegments(body, 0, body.length, findRanges(body, compileMatcher("img", false, false)), []);
    expect(segs.map((s) => s.text).join("")).toBe(body);
  });
});

describe("highlight navigation", () => {
  const rows = [
    { seq: 1, body: "alpha" }, { seq: 2, body: "beta refused" }, { seq: 3, body: "gamma" }, { seq: 4, body: "refused again" },
  ];
  const hl = compileMatcher("refused", false, false);
  it("collects the seqs of matching lines", () => {
    expect(matchSeqs(rows, (r) => r.body, hl)).toEqual([2, 4]);
    expect(matchSeqs(rows, (r) => r.body, null)).toEqual([]);
  });
  it("steps with wrap, starting from the first (or last) when nothing is active", () => {
    expect(stepMatch([2, 4], null, 1)).toBe(2);
    expect(stepMatch([2, 4], null, -1)).toBe(4);
    expect(stepMatch([2, 4], 2, 1)).toBe(4);
    expect(stepMatch([2, 4], 4, 1)).toBe(2);
    expect(stepMatch([2, 4], 2, -1)).toBe(4);
    expect(stepMatch([], 2, 1)).toBeNull();
  });
  it("treats an active seq that left the list as no active match", () => {
    expect(stepMatch([2, 4], 99, 1)).toBe(2);
    expect(matchPosition([2, 4], 4)).toEqual({ index: 2, total: 2 });
    expect(matchPosition([2, 4], 99)).toEqual({ index: 0, total: 2 });
    expect(matchPosition([], null)).toBeNull();
  });
  it("prunes by membership, so a line removed from the MIDDLE of the buffer is dropped too", () => {
    expect(pruneToPresent([1, 2, 3, 4], new Set([1, 3, 4]))).toEqual([1, 3, 4]);
  });
});
