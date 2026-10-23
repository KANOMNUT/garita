import { describe, expect, it } from "vitest";
import { EXPAND_CAP_NOTICE, expandDropsOldest, MAX_EXPANDED_JSON, prettyJson, summarizeJson, toggleExpanded } from "./logJson";

describe("toggleExpanded", () => {
  it("expands and collapses", () => {
    expect(toggleExpanded([], 5)).toEqual([5]);
    expect(toggleExpanded([5, 6], 5)).toEqual([6]);
  });
  it("collapses the OLDEST when a 201st row is expanded", () => {
    let set: number[] = [];
    for (let i = 1; i <= MAX_EXPANDED_JSON; i++) set = toggleExpanded(set, i);
    expect(set).toHaveLength(MAX_EXPANDED_JSON);
    set = toggleExpanded(set, 999);
    expect(set).toHaveLength(MAX_EXPANDED_JSON);
    expect(set[0]).toBe(2);
    expect(set.slice(-1)[0]).toBe(999);
    expect(set).not.toContain(1);
  });
});

describe("summarizeJson", () => {
  it("takes the first present of msg, message, log, event", () => {
    expect(summarizeJson({ message: "m", log: "l" }).message).toBe("m");
    expect(summarizeJson({ log: "l", event: "e" }).message).toBe("l");
    expect(summarizeJson({ event: "e" }).message).toBe("e");
    expect(summarizeJson({ a: 1 }).message).toBe("");
  });
  it("skips level, time and the message key, and keeps scalar key=value fields", () => {
    const s = summarizeJson({ ts: "2026", level: "error", msg: "refused", host: "payments", retry: 3, ok: false, nothing: null });
    expect(s.message).toBe("refused");
    expect(s.fields.map((f) => `${f.key}=${f.value}`)).toEqual(["host=payments", "retry=3", "ok=false", "nothing=null"]);
  });
  it("skips nested objects and arrays", () => {
    expect(summarizeJson({ msg: "x", ctx: { a: 1 }, list: [1], k: "v" }).fields.map((f) => f.key)).toEqual(["k"]);
  });
  it("keeps at most six fields and flags values over 120 characters", () => {
    const obj: Record<string, unknown> = { msg: "x" };
    for (let i = 0; i < 9; i++) obj[`k${i}`] = i;
    expect(summarizeJson(obj).fields).toHaveLength(6);
    const long = summarizeJson({ msg: "x", blob: "y".repeat(121), short: "z" }).fields;
    expect(long.find((f) => f.key === "blob")?.long).toBe(true);
    expect(long.find((f) => f.key === "short")?.long).toBe(false);
  });
  it("prettyJson indents with two spaces", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("expand cap notice", () => {
  it("fires only when a new row would exceed the cap", () => {
    const full = Array.from({ length: MAX_EXPANDED_JSON }, (_, i) => i);
    expect(expandDropsOldest(full, 999)).toBe(true);
    expect(expandDropsOldest(full, 5)).toBe(false);
    expect(expandDropsOldest([1], 2)).toBe(false);
    expect(EXPAND_CAP_NOTICE).toContain("200");
  });
});
