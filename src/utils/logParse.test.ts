import { describe, it, expect } from "vitest";
import { detectLevel, normalizeLevel, parseJsonObject, parseLogLine, splitK8sTimestamp } from "./logParse";

describe("splitK8sTimestamp", () => {
  it("splits at the first space (nanosecond fraction)", () => {
    expect(splitK8sTimestamp('2026-10-03T14:02:11.482123456Z {"level":"info"}')).toEqual({
      ts: "2026-10-03T14:02:11.482123456Z",
      rest: '{"level":"info"}',
    });
  });

  it("accepts a trimmed or absent fraction", () => {
    expect(splitK8sTimestamp("2026-10-03T14:02:11.48Z hi").ts).toBe("2026-10-03T14:02:11.48Z");
    expect(splitK8sTimestamp("2026-10-03T14:02:11Z hi")).toEqual({ ts: "2026-10-03T14:02:11Z", rest: "hi" });
  });

  it("a line with no space is a timestamp with an empty message", () => {
    expect(splitK8sTimestamp("2026-10-03T14:02:11.5Z")).toEqual({ ts: "2026-10-03T14:02:11.5Z", rest: "" });
  });

  it("a line with no space that is not a timestamp stays untimestamped", () => {
    expect(splitK8sTimestamp("hello")).toEqual({ rest: "hello" });
  });

  it("an unparseable first token leaves the line untouched", () => {
    expect(splitK8sTimestamp("2026-13-45T99:99:99Z boom")).toEqual({ rest: "2026-13-45T99:99:99Z boom" });
    expect(splitK8sTimestamp("14:02:11 INFO x")).toEqual({ rest: "14:02:11 INFO x" });
  });

  it("keeps the app's own timestamp inside the message untouched", () => {
    const r = splitK8sTimestamp("2026-10-03T14:02:11.1Z 14:02:11.100 INFO started");
    expect(r.rest).toBe("14:02:11.100 INFO started");
  });

  it("only the FIRST space splits (message may contain more)", () => {
    expect(splitK8sTimestamp("2026-10-03T14:02:11Z a b c").rest).toBe("a b c");
  });
});

describe("normalizeLevel", () => {
  it("maps fatal/critical/panic to ERROR, trace to DEBUG, notice to INFO", () => {
    expect(normalizeLevel("FATAL")).toBe("ERROR");
    expect(normalizeLevel("Critical")).toBe("ERROR");
    expect(normalizeLevel("panic")).toBe("ERROR");
    expect(normalizeLevel("trace")).toBe("DEBUG");
    expect(normalizeLevel("notice")).toBe("INFO");
    expect(normalizeLevel("warning")).toBe("WARN");
  });
  it("returns undefined for unknown words and non-strings", () => {
    expect(normalizeLevel("loud")).toBeUndefined();
    expect(normalizeLevel(30)).toBeUndefined();
    expect(normalizeLevel(null)).toBeUndefined();
  });
});

describe("detectLevel (02 §3.4 order)", () => {
  it("1. HH:MM:SS.fff LEVEL shape", () => {
    expect(detectLevel("14:02:11.482 ERROR connection refused")).toEqual({ lvl: "ERROR", word: "ERROR" });
    expect(detectLevel("14:02:11.482 FATAL boom")).toEqual({ lvl: "ERROR", word: "FATAL" });
  });

  it("2. JSON object level keys", () => {
    expect(detectLevel('{"level":"warn","msg":"x"}').lvl).toBe("WARN");
    expect(detectLevel('{"severity":"CRITICAL"}')).toEqual({ lvl: "ERROR", word: "CRITICAL" });
    expect(detectLevel('{"lvl":"debug"}').lvl).toBe("DEBUG");
    expect(detectLevel('{"levelname":"INFO"}').lvl).toBe("INFO");
  });

  it("2. JSON without a level key is none", () => {
    expect(detectLevel('{"msg":"x"}').lvl).toBe("none");
  });

  it("3. logfmt level=", () => {
    expect(detectLevel("ts=2026 level=error msg=boom").lvl).toBe("ERROR");
    expect(detectLevel('level="info" msg=ok').lvl).toBe("INFO");
  });

  it("4. leading [LEVEL] / LEVEL: token", () => {
    expect(detectLevel("[ERROR] disk full").lvl).toBe("ERROR");
    expect(detectLevel("WARN: slow query").lvl).toBe("WARN");
    expect(detectLevel("  [debug] noisy").lvl).toBe("DEBUG");
  });

  it("anything else is none", () => {
    expect(detectLevel("just some text").lvl).toBe("none");
    expect(detectLevel("Note: this is not a level").lvl).toBe("none");
    expect(detectLevel("").lvl).toBe("none");
  });

  it("a truncated JSON line falls through to raw (no throw)", () => {
    const r = detectLevel('{"level":"error","msg":"cut o');
    expect(r.lvl).toBe("none");
  });
});

describe("parseJsonObject", () => {
  it("accepts a complete object only", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('  {"a":1}  ')).toEqual({ a: 1 });
  });
  it("rejects arrays, scalars, truncated and garbage without throwing", () => {
    expect(parseJsonObject("[1,2]")).toBeNull();
    expect(parseJsonObject("42")).toBeNull();
    expect(parseJsonObject('{"a":')).toBeNull();
    expect(parseJsonObject("{not json}")).toBeNull();
    expect(parseJsonObject("")).toBeNull();
    expect(parseJsonObject("{")).toBeNull();
  });
});

describe("parseLogLine", () => {
  it("without timestamps, a date-looking prefix is NOT split", () => {
    const p = parseLogLine("2026-10-03T14:02:11Z hello", false);
    expect(p.k8sTs).toBeUndefined();
    expect(p.body).toBe("2026-10-03T14:02:11Z hello");
  });

  it("with timestamps, strips the prefix and detects level on the body", () => {
    const p = parseLogLine('2026-10-03T14:02:11.482Z {"level":"error","msg":"x"}', true);
    expect(p.k8sTs).toBe("2026-10-03T14:02:11.482Z");
    expect(p.lvl).toBe("ERROR");
    expect(p.json).toBe(true);
    expect(p.raw).toContain("2026-10-03");
  });

  it("legacy shape fills the app time and message columns", () => {
    const p = parseLogLine("14:02:11.482 WARN slow", false);
    expect(p.appTs).toBe("14:02:11.482");
    expect(p.msg).toBe("slow");
    expect(p.lvl).toBe("WARN");
  });

  it("a truncated JSON line is raw: json false, level none", () => {
    const p = parseLogLine('{"level":"error","ms', false);
    expect(p.json).toBe(false);
    expect(p.lvl).toBe("none");
    expect(p.body).toBe('{"level":"error","ms');
  });
});
