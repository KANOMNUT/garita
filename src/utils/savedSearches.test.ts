import { describe, expect, it } from "vitest";
import {
  insertAt, loadView, MAX_SAVED, parseStore, removeAt, saveDisabledReason, savedSearchKey, saveView, SAVED_KEY, suggestName, upsert,
  type SavedSearch, type StoreLike,
} from "./savedSearches";

const fake = (initial: string | null = null): StoreLike & { raw: string | null } => {
  const s = { raw: initial, getItem: () => s.raw, setItem: (_k: string, v: string) => { s.raw = v; } };
  return s;
};
const many = (n: number): SavedSearch[] => Array.from({ length: n }, (_, i) => ({ name: `n${i}`, text: `t${i}` }));

describe("parseStore", () => {
  it("reads empty for no store, and flags corrupt JSON or a non-object", () => {
    expect(parseStore(null)).toEqual({ map: {}, corrupt: false });
    expect(parseStore("{nope")).toEqual({ map: {}, corrupt: true });
    expect(parseStore("[1]")).toEqual({ map: {}, corrupt: true });
    expect(parseStore("null")).toEqual({ map: {}, corrupt: true });
  });
  it("drops malformed entries silently and caps a view at 20", () => {
    const raw = JSON.stringify({ pods: [{ name: "a", text: "x" }, { name: 1, text: "x" }, { name: "", text: "x" }, null, { name: "b", text: "" }], deploy: many(30) });
    const { map, corrupt } = parseStore(raw);
    expect(corrupt).toBe(false);
    expect(map.pods).toEqual([{ name: "a", text: "x" }]);
    expect(map.deploy).toHaveLength(MAX_SAVED);
  });
});

describe("loadView / saveView", () => {
  it("round-trips one view and keeps the others", () => {
    const s = fake(JSON.stringify({ pods: [{ name: "a", text: "x" }] }));
    expect(saveView(s, "deploy", [{ name: "d", text: "api-" }])).toBe(true);
    expect(loadView(s, "pods").items).toEqual([{ name: "a", text: "x" }]);
    expect(loadView(s, "deploy").items).toEqual([{ name: "d", text: "api-" }]);
    saveView(s, "deploy", []);
    expect(Object.keys(JSON.parse(s.raw ?? "{}"))).toEqual(["pods"]);
  });
  it("a corrupt store reads empty and is overwritten by the next save", () => {
    const s = fake("{nope");
    expect(loadView(s, "pods")).toEqual({ items: [], corrupt: true, unavailable: false });
    expect(saveView(s, "pods", [{ name: "a", text: "x" }])).toBe(true);
    expect(loadView(s, "pods").corrupt).toBe(false);
  });
  it("storage that throws is unavailable, never an exception", () => {
    const bad: StoreLike = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadView(bad, "pods")).toEqual({ items: [], corrupt: false, unavailable: true });
    expect(saveView(bad, "pods", many(1))).toBe(false);
    expect(loadView(null, "pods").unavailable).toBe(true);
    expect(saveView(null, "pods", many(1))).toBe(false);
    expect(SAVED_KEY).toBe("saved-searches");
  });
});

describe("upsert / removeAt / insertAt", () => {
  it("replaces a same-named entry in place and trims", () => {
    expect(upsert([{ name: "a", text: "x" }, { name: "b", text: "y" }], "a", " z ")).toEqual([{ name: "a", text: "z" }, { name: "b", text: "y" }]);
  });
  it("uses the text as the name when the name is blank, and refuses an empty search", () => {
    expect(upsert([], " ", "crashloop")).toEqual([{ name: "crashloop", text: "crashloop" }]);
    expect(upsert([], "n", "  ")).toBeNull();
  });
  it("refuses a 21st but still replaces at the cap", () => {
    expect(upsert(many(20), "new", "t")).toBeNull();
    expect(upsert(many(20), "n3", "changed")?.[3]).toEqual({ name: "n3", text: "changed" });
  });
  it("undo puts a removed entry back at its index", () => {
    const l = many(3);
    expect(insertAt(removeAt(l, 1), l[1], 1)).toEqual(l);
    expect(insertAt(l, l[1], 0)).toEqual(l);
  });
});

describe("saveDisabledReason", () => {
  const base = { text: "api-", name: "api-", items: [] as SavedSearch[], unavailable: false };
  it("orders the reasons", () => {
    expect(saveDisabledReason({ ...base, unavailable: true, text: "" })).toBe("Saved searches can't be stored in this session.");
    expect(saveDisabledReason({ ...base, text: " " })).toBe("Type a search first.");
    expect(saveDisabledReason({ ...base, items: many(20) })).toBe("20 saved searches is the limit. Remove one first.");
    expect(saveDisabledReason({ ...base, items: many(20), name: "n2" })).toBeUndefined();
    expect(saveDisabledReason(base)).toBeUndefined();
  });
});

describe("keys and names", () => {
  it("keys the CRD instances view by CRD name and waits for one", () => {
    expect(savedSearchKey("pods", undefined)).toBe("pods");
    expect(savedSearchKey("crd-instances", "widgets.acme.io")).toBe("crd-instances:widgets.acme.io");
    expect(savedSearchKey("crd-instances", undefined)).toBeNull();
  });
  it("prefills a short name from the text", () => {
    expect(suggestName("  api-  ")).toBe("api-");
    expect(suggestName("x".repeat(60))).toHaveLength(40);
  });
});
