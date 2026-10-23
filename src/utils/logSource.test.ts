import { describe, it, expect } from "vitest";
import { parseLogLine } from "./logParse";
import {
  HISTORY_OPTIONS, backendRaw, crossesMidnight, historyEmptyText, historyFailText, historyLoadingText, historyShownText, historyWindow, loadHistoryRange, saveHistoryRange,
  defaultLogPrefs,
  formatLogTime,
  orderPodsForStreaming,
  parseLogPrefs,
  podTagLabel,
  podTags,
  rangeKey,
  rangePhrase,
  resolveRange,
  validateCustomRange,
} from "./logSource";

describe("resolveRange", () => {
  it("default is 200 lines, no since", () => {
    expect(resolveRange({ id: "lines200" })).toEqual({ tailLines: 200 });
  });
  it("Up to 5,000 lines sends tail 5000 and no since", () => {
    expect(resolveRange({ id: "lines5000" })).toEqual({ tailLines: 5000 });
  });
  it("a time range sends since PLUS tail 5000 (never unbounded)", () => {
    expect(resolveRange({ id: "m15" })).toEqual({ tailLines: 5000, sinceSeconds: 900 });
    expect(resolveRange({ id: "h24" })).toEqual({ tailLines: 5000, sinceSeconds: 86400 });
  });
  it("custom range converts units", () => {
    expect(resolveRange({ id: "custom", value: 3, unit: "hours" })).toEqual({ tailLines: 5000, sinceSeconds: 10800 });
    expect(resolveRange({ id: "custom", value: 2, unit: "days" }).sinceSeconds).toBe(172800);
  });
  it("an invalid custom range falls back to 200 lines", () => {
    expect(resolveRange({ id: "custom", value: 0, unit: "hours" })).toEqual({ tailLines: 200 });
    expect(resolveRange({ id: "custom" })).toEqual({ tailLines: 200 });
  });
});

describe("validateCustomRange", () => {
  it("accepts whole numbers >= 1", () => {
    expect(validateCustomRange("1", "minutes")).toBeNull();
    expect(validateCustomRange(" 30 ", "hours")).toBeNull();
  });
  it("rejects zero, negatives, decimals, blanks, text", () => {
    for (const v of ["0", "-1", "1.5", "", "abc", "1e3"]) {
      expect(validateCustomRange(v, "minutes")).toBe("Enter a whole number greater than 0.");
    }
  });
});

describe("rangePhrase / rangeKey", () => {
  it("phrases for the reload strip", () => {
    expect(rangePhrase({ id: "m15" })).toBe("the last 15 minutes");
    expect(rangePhrase({ id: "custom", value: 1, unit: "hours" })).toBe("the last 1 hour");
    expect(rangePhrase({ id: "custom", value: 3, unit: "days" })).toBe("the last 3 days");
  });
  it("keys differ when a custom value differs", () => {
    expect(rangeKey({ id: "custom", value: 1, unit: "hours" })).not.toBe(rangeKey({ id: "custom", value: 2, unit: "hours" }));
  });
});

describe("log prefs (D-L3)", () => {
  it("timestamps default off for single, on for multi", () => {
    expect(defaultLogPrefs("single").timestamps).toBe(false);
    expect(defaultLogPrefs("multi").timestamps).toBe(true);
  });
  it("tolerates null, junk and partial JSON", () => {
    expect(parseLogPrefs(null, "single")).toEqual(defaultLogPrefs("single"));
    expect(parseLogPrefs("not json", "multi")).toEqual(defaultLogPrefs("multi"));
    expect(parseLogPrefs('{"timestamps":"yes","zone":"mars"}', "single")).toEqual(defaultLogPrefs("single"));
  });
  it("round-trips valid values and rejects an invalid custom range", () => {
    const p = parseLogPrefs('{"range":{"id":"custom","value":3,"unit":"hours"},"timestamps":true,"zone":"utc"}', "single");
    expect(p).toEqual({ range: { id: "custom", value: 3, unit: "hours" }, timestamps: true, zone: "utc" });
    const bad = parseLogPrefs('{"range":{"id":"custom","value":0,"unit":"hours"}}', "single");
    expect(bad.range).toEqual({ id: "lines200" });
  });
});

describe("formatLogTime", () => {
  const iso = "2026-10-03T14:02:11.482123456Z";
  it("UTC carries a Z suffix and milliseconds", () => {
    expect(formatLogTime(iso, "utc", false)).toBe("14:02:11.482Z");
  });
  it("adds the date only when asked", () => {
    expect(formatLogTime(iso, "utc", true)).toBe("10-03 14:02:11.482Z");
  });
  it("local renders in the local zone with no suffix", () => {
    const dt = new Date(iso);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    expect(formatLogTime(iso, "local", false)).toBe(
      `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}.${pad(dt.getMilliseconds(), 3)}`,
    );
  });
  it("returns an unparseable value unchanged", () => {
    expect(formatLogTime("garbage", "utc", false)).toBe("garbage");
  });
});

describe("crossesMidnight", () => {
  it("detects a day change in UTC", () => {
    expect(crossesMidnight("2026-10-03T23:59:59Z", "2026-10-04T00:00:01Z", "utc")).toBe(true);
    expect(crossesMidnight("2026-10-03T10:00:00Z", "2026-10-03T23:00:00Z", "utc")).toBe(false);
  });
  it("is false when either end is missing or unparseable", () => {
    expect(crossesMidnight(undefined, "2026-10-03T10:00:00Z", "utc")).toBe(false);
    expect(crossesMidnight("x", "y", "utc")).toBe(false);
  });
});

describe("orderPodsForStreaming (D-L7)", () => {
  const mk = (name: string, ready: string, restarts = 0, status = "Running") => ({ name, ready, restarts, status });
  it("not-ready and restarted pods come first, then by name", () => {
    const ordered = orderPodsForStreaming([
      mk("c", "1/1"),
      mk("b", "0/1"),
      mk("a", "1/1"),
      mk("d", "1/1", 3),
    ]).map((p) => p.name);
    expect(ordered).toEqual(["b", "d", "a", "c"]);
  });
  it("does not mutate its input", () => {
    const input = [mk("b", "1/1"), mk("a", "1/1")];
    orderPodsForStreaming(input);
    expect(input.map((p) => p.name)).toEqual(["b", "a"]);
  });
  it("the failing pod survives a 20-pod cap even when its name sorts last", () => {
    const pods = Array.from({ length: 30 }, (_, i) => mk(`pod-${String(i).padStart(2, "0")}`, "1/1"));
    pods[29] = mk("pod-29", "0/1", 5);
    expect(orderPodsForStreaming(pods).slice(0, 20).map((p) => p.name)).toContain("pod-29");
  });
});

describe("podTags", () => {
  it("shows the distinguishing tail, not the shared prefix", () => {
    const t = podTags(["api-7d9f8c-xk2lp", "api-7d9f8c-9fq7d"]);
    expect(t["api-7d9f8c-xk2lp"]).toBe("xk2lp");
    expect(t["api-7d9f8c-9fq7d"]).toBe("9fq7d");
  });
  it("is at least 5 characters, or the whole name if shorter", () => {
    const t = podTags(["db-0", "db-1"]);
    expect(t["db-0"]).toBe("db-0");
    const t2 = podTags(["web-server-0", "web-server-1"]);
    expect(t2["web-server-0"].length).toBeGreaterThanOrEqual(5);
  });
  it("tags are distinct for distinct names", () => {
    const names = ["a-xx-12345", "a-yy-12345", "a-xx-67890"];
    const t = podTags(names);
    expect(new Set(Object.values(t)).size).toBe(names.length);
  });
  it("a single pod gets its last 5 characters", () => {
    expect(podTags(["api-7d9f8c-xk2lp"])["api-7d9f8c-xk2lp"]).toBe("xk2lp");
  });
  it("label adds an ellipsis only for a true tail", () => {
    expect(podTagLabel("api-7d9f8c-xk2lp", "xk2lp")).toBe("…xk2lp");
    expect(podTagLabel("db-0", "db-0")).toBe("db-0");
  });
  it("empty input", () => {
    expect(podTags([])).toEqual({});
  });
});

describe("backend history (v2.3.0)", () => {
  it("7 days has its phrase and seconds; the pod-log options are unchanged", () => {
    expect(rangePhrase({ id: "d7" })).toBe("the last 7 days");
    expect(resolveRange({ id: "d7" })).toEqual({ tailLines: 5000, sinceSeconds: 604800 });
    expect(HISTORY_OPTIONS.map((o) => o.id)).toEqual(["h1", "h6", "h24", "d7"]);
  });
  it("history range is remembered separately; unknown or blocked storage reads 1 h", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadHistoryRange()).toBe("h1");
    saveHistoryRange("d7");
    expect(loadHistoryRange()).toBe("d7");
    expect(store.has("log-prefs-single")).toBe(false);
    store.set("log-history-range", "lines200");
    expect(loadHistoryRange()).toBe("h1");
    (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(loadHistoryRange()).toBe("h1");
    expect(() => saveHistoryRange("h6")).not.toThrow();
  });
  it("historyWindow is unix seconds ending now", () => {
    expect(historyWindow("h6", 1000.9)).toEqual({ start: 1000 - 21600, end: 1000 });
    expect(historyWindow("d7", 1_000_000)).toEqual({ start: 1_000_000 - 604800, end: 1_000_000 });
  });
  it("backendRaw feeds parseLogLine unchanged", () => {
    const p = parseLogLine(backendRaw({ ts: "2026-10-22T10:00:00.123456789Z", line: "level=error boom" }), true);
    expect(p.k8sTs).toBe("2026-10-22T10:00:00.123456789Z");
    expect(p.body).toBe("level=error boom");
  });
  it("copy", () => {
    expect(historyShownText("Loki", "h6")).toBe("Showing history from Loki, last 6 hours.");
    expect(historyEmptyText("Loki", "h6")).toBe("No log lines from Loki for this pod in the last 6 hours.");
    expect(historyLoadingText("VictoriaLogs")).toBe("Loading history from VictoriaLogs…");
    expect(historyFailText("No access to services/proxy: x", "monitoring")).toBe("No access to services/proxy in monitoring. Showing the pod's current log.");
    expect(historyFailText("Failed to query logs: x", "monitoring")).toBe("Log history unavailable, showing the pod's current log.");
  });
});
