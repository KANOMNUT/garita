import { describe, expect, it } from "vitest";
import { stepIndex } from "./segmented";

describe("stepIndex", () => {
  const opts = [["a", "A"], ["b", "B", "off"], ["c", "C"]] as const;
  it("wraps at both ends", () => {
    expect(stepIndex(opts, 2, 1)).toBe(0);
    expect(stepIndex(opts, 0, -1)).toBe(2);
  });
  it("lands on a disabled option (the caller focuses it instead of picking)", () => {
    expect(stepIndex(opts, 0, 1)).toBe(1);
    expect(opts[stepIndex(opts, 0, 1)][2]).toBe("off");
  });
  it("a single option stays put", () => {
    expect(stepIndex([["a", "A"]], 0, 1)).toBe(0);
    expect(stepIndex([["a", "A"]], 0, -1)).toBe(0);
  });
});
