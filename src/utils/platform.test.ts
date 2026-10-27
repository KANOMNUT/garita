import { describe, expect, it } from "vitest";
import { isMacUserAgent } from "./platform";

describe("isMacUserAgent", () => {
  it("is true for macOS user agents", () => {
    expect(isMacUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)")).toBe(true);
    expect(isMacUserAgent("mozilla/5.0 (macintosh; apple silicon)")).toBe(true);
  });
  it("is false for Windows and Linux user agents", () => {
    expect(isMacUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0")).toBe(false);
    expect(isMacUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)")).toBe(false);
  });
  it("is false for an empty user agent", () => {
    expect(isMacUserAgent("")).toBe(false);
  });
});
