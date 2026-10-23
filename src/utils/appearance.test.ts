import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, parseAppearance, resolveTheme, setAppearance, STORAGE_KEY } from "./appearance";

describe("parseAppearance", () => {
  it("missing, empty and corrupt input give the defaults", () => {
    for (const raw of [null, "", "{nope", "5", "null", "[]", '"x"']) expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
  });
  it("reads a valid record", () => {
    expect(parseAppearance('{"theme":"light","accent":"teal"}')).toEqual({ theme: "light", accent: "teal" });
  });
  it("falls back per field", () => {
    expect(parseAppearance('{"theme":"neon","accent":"rose"}')).toEqual({ theme: "system", accent: "rose" });
    expect(parseAppearance('{"theme":"dark","accent":"hotpink"}')).toEqual({ theme: "dark", accent: "blue" });
    expect(parseAppearance('{"theme":5,"accent":null}')).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("resolveTheme", () => {
  it("system follows the OS; explicit wins", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("setAppearance (node: no window, no localStorage)", () => {
  it("a missing store does not throw and system resolves to dark", () => {
    expect(() => setAppearance({ accent: "teal" })).not.toThrow();
  });
  it("writes the record when storage works, and reports a failed write", () => {
    const data = new Map<string, string>();
    const g = globalThis as unknown as { localStorage: Partial<Storage> };
    g.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    setAppearance({ theme: "light", accent: "amber" });
    expect(parseAppearance(data.get(STORAGE_KEY) ?? null)).toEqual({ theme: "light", accent: "amber" });
    g.localStorage = { setItem: () => { throw new Error("quota"); } };
    expect(() => setAppearance({ theme: "dark" })).not.toThrow();
    delete (g as { localStorage?: unknown }).localStorage;
  });
});
