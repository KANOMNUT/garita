import { describe, it, expect } from "vitest";
import {
  anyStreaming,
  emptyLogsText,
  endedStripText,
  idleText,
  streamStatusText,
  summarizePodStreams,
  type PodStream,
} from "./podStreams";

const S: PodStream = { kind: "streaming" };
const E: PodStream = { kind: "ended" };
const ERR: PodStream = { kind: "error", message: "boom" };
const START: PodStream = { kind: "start_error", message: "waiting" };

describe("summarizePodStreams", () => {
  it("buckets by state in input order; error and start_error are both failed", () => {
    const r = summarizePodStreams(["a", "b", "c", "d"], { a: S, b: E, c: ERR, d: START });
    expect(r).toEqual({ total: 4, streaming: ["a"], ended: ["b"], failed: ["c", "d"] });
  });

  it("a pod with no entry yet counts as streaming (its stream is being opened)", () => {
    expect(summarizePodStreams(["a", "b"], { a: E })).toEqual({ total: 2, streaming: ["b"], ended: ["a"], failed: [] });
  });

  it("ignores stale entries for pods no longer tailed", () => {
    expect(summarizePodStreams(["a"], { a: S, gone: E })).toEqual({ total: 1, streaming: ["a"], ended: [], failed: [] });
  });

  it("no pods", () => {
    expect(summarizePodStreams([], {})).toEqual({ total: 0, streaming: [], ended: [], failed: [] });
  });
});

describe("Following / idle state", () => {
  it("anyStreaming is false only when every stream ended or failed", () => {
    expect(anyStreaming(summarizePodStreams(["a", "b"], { a: S, b: E }))).toBe(true);
    expect(anyStreaming(summarizePodStreams(["a", "b"], { a: E, b: E }))).toBe(false);
    expect(anyStreaming(summarizePodStreams(["a", "b"], { a: E, b: ERR }))).toBe(false);
  });

  it("a finished Job/CronJob (every pod ended) is idle: 'All streams ended'", () => {
    const s = summarizePodStreams(["a", "b", "c"], { a: E, b: E, c: E });
    expect(anyStreaming(s)).toBe(false);
    expect(idleText(s)).toBe("All streams ended");
  });

  it("no idle line while anything streams", () => {
    expect(idleText(summarizePodStreams(["a", "b"], { a: E, b: S }))).toBeNull();
  });

  it("ended + failed with nothing streaming does not claim 'all ended'", () => {
    expect(idleText(summarizePodStreams(["a", "b"], { a: E, b: ERR }))).toBe("No streams running");
  });

  it("all failed, none ended: no idle line (the failure strip says it)", () => {
    expect(idleText(summarizePodStreams(["a", "b"], { a: ERR, b: START }))).toBeNull();
  });
});

describe("endedStripText", () => {
  it("empty when nothing ended", () => {
    expect(endedStripText(summarizePodStreams(["a", "b"], { a: S, b: ERR }))).toBe("");
  });
  it("k of n when only some ended", () => {
    expect(endedStripText(summarizePodStreams(["a", "b", "c"], { a: E, b: S, c: S }))).toBe("1 of 3 streams ended.");
  });
  it("all ended", () => {
    expect(endedStripText(summarizePodStreams(["a", "b"], { a: E, b: E }))).toBe(
      "All 2 streams ended. The containers stopped or the connections dropped.",
    );
  });
  it("a single pod reuses the single-pod viewer's sentence", () => {
    expect(endedStripText(summarizePodStreams(["a"], { a: E }))).toBe(
      "Stream ended. The container stopped or the connection dropped.",
    );
  });
});

describe("streamStatusText (live region)", () => {
  it("steady states", () => {
    expect(streamStatusText(summarizePodStreams(["a", "b"], { a: S, b: S }), true)).toBe("Following");
    expect(streamStatusText(summarizePodStreams(["a", "b"], { a: S, b: S }), false)).toBe("Paused");
  });
  it("count-free wording when some ended, so a burst of ends does not spam announcements", () => {
    const one = streamStatusText(summarizePodStreams(["a", "b", "c"], { a: E, b: S, c: S }), true);
    const two = streamStatusText(summarizePodStreams(["a", "b", "c"], { a: E, b: E, c: S }), true);
    expect(one).toBe("Some streams ended. Following");
    expect(two).toBe(one);
  });
  it("all ended", () => {
    expect(streamStatusText(summarizePodStreams(["a", "b"], { a: E, b: E }), true)).toBe("All streams ended");
  });
  it("keeps the existing failed wording", () => {
    expect(streamStatusText(summarizePodStreams(["a", "b", "c"], { a: S, b: ERR, c: S }), true)).toBe("Tailing 2 of 3 pods");
  });
  it("failed and ended together", () => {
    expect(streamStatusText(summarizePodStreams(["a", "b"], { a: E, b: ERR }), true)).toBe(
      "Tailing 1 of 2 pods. No streams running",
    );
  });
});

describe("emptyLogsText", () => {
  it("still streaming: the existing 'No log lines yet'", () => {
    expect(emptyLogsText(summarizePodStreams(["a", "b"], { a: S, b: E }), "the last 200 lines", false)).toBe("No log lines yet");
  });
  it("all ended with a time range uses 02 4.1 copy", () => {
    const s = summarizePodStreams(Array.from({ length: 12 }, (_, i) => `p${i}`), Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}`, E])));
    expect(emptyLogsText(s, "the last 15 minutes", true)).toBe("No log lines from these 12 pods in the last 15 minutes.");
  });
  it("all ended with a line-count range omits the range", () => {
    expect(emptyLogsText(summarizePodStreams(["a", "b"], { a: E, b: E }), "the last 200 lines", false)).toBe(
      "No log lines from these 2 pods.",
    );
  });
  it("one ended pod reads 'this pod'", () => {
    expect(emptyLogsText(summarizePodStreams(["a"], { a: E }), "the last 5 minutes", true)).toBe(
      "No log lines from this pod in the last 5 minutes.",
    );
  });
  it("counts only the pods that were tailed when others failed", () => {
    expect(emptyLogsText(summarizePodStreams(["a", "b", "c"], { a: E, b: ERR, c: START }), "the last 200 lines", false)).toBe(
      "No log lines from this pod.",
    );
  });
  it("every pod failed: nothing (the failure strip owns it)", () => {
    expect(emptyLogsText(summarizePodStreams(["a", "b"], { a: ERR, b: START }), "the last 200 lines", false)).toBeNull();
  });
});
