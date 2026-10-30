import { describe, expect, it } from "vitest";
import { groupRows, rangeSelect, searchRows, shownRows, sortRows, type SortableColumn } from "./tableRows";

interface App { namespace: string; name: string; age: number; health: string }

const key = (a: App) => `${a.namespace}/${a.name}`;
const app = (namespace: string, name: string, age = 0, health = ""): App => ({ namespace, name, age, health });

const columns: SortableColumn<App>[] = [
  { id: "name", sortValue: (a) => a.name },
  { id: "age", sortValue: (a) => a.age },
  { id: "health", sortValue: (a) => a.health },
  { id: "plain" },
];

const apps = [
  app("argocd", "web", 30, "Healthy"),
  app("argocd", "api", 5, "Degraded"),
  app("team-a", "Worker", 100, "Healthy"),
  app("team-b", "db", 9, "Missing"),
];

describe("searchRows", () => {
  it("matches the key case-insensitively", () => {
    expect(searchRows(apps, "WEB", key).map(key)).toEqual(["argocd/web"]);
    expect(searchRows(apps, "worker", key).map(key)).toEqual(["team-a/Worker"]);
  });
  it("matches the namespace part of the key", () => {
    expect(searchRows(apps, "team-", key).map(key)).toEqual(["team-a/Worker", "team-b/db"]);
    expect(searchRows(apps, "argocd/", key).map(key)).toEqual(["argocd/web", "argocd/api"]);
  });
  it("returns the input for an empty or missing search", () => {
    expect(searchRows(apps, "", key)).toBe(apps);
    expect(searchRows(apps, undefined, key)).toBe(apps);
  });
  it("returns nothing when no key matches", () => {
    expect(searchRows(apps, "nope", key)).toEqual([]);
  });
  it("does not change the input", () => {
    const before = [...apps];
    searchRows(apps, "a", key);
    expect(apps).toEqual(before);
  });
});

describe("sortRows", () => {
  it("sorts numbers numerically in both directions", () => {
    expect(sortRows(apps, columns, { col: "age", asc: true }).map((a) => a.age)).toEqual([5, 9, 30, 100]);
    expect(sortRows(apps, columns, { col: "age", asc: false }).map((a) => a.age)).toEqual([100, 30, 9, 5]);
  });
  it("sorts strings with localeCompare in both directions", () => {
    expect(sortRows(apps, columns, { col: "name", asc: true }).map((a) => a.name)).toEqual(["api", "db", "web", "Worker"]);
    expect(sortRows(apps, columns, { col: "name", asc: false }).map((a) => a.name)).toEqual(["Worker", "web", "db", "api"]);
  });
  it("keeps the order of equal values (stable)", () => {
    expect(sortRows(apps, columns, { col: "health", asc: true }).map(key)).toEqual([
      "argocd/api", "argocd/web", "team-a/Worker", "team-b/db",
    ]);
  });
  it("keeps the order for a null sort", () => {
    expect(sortRows(apps, columns, null)).toEqual(apps);
  });
  it("keeps the order for an unknown column and for a column without sortValue", () => {
    expect(sortRows(apps, columns, { col: "missing", asc: true })).toEqual(apps);
    expect(sortRows(apps, columns, { col: "plain", asc: false })).toEqual(apps);
  });
  it("sorts a copy when it sorts", () => {
    const before = [...apps];
    sortRows(apps, columns, { col: "age", asc: true });
    expect(apps).toEqual(before);
  });
});

describe("shownRows", () => {
  it("searches first, then sorts what is left", () => {
    expect(shownRows(apps, "argocd", key, columns, { col: "name", asc: true }).map(key)).toEqual([
      "argocd/api", "argocd/web",
    ]);
  });
  it("is the identity with no search and no sort", () => {
    expect(shownRows(apps, undefined, key, columns, null)).toEqual(apps);
  });
});

describe("groupRows", () => {
  it("orders the groups with localeCompare and puts the empty key first", () => {
    const groups = groupRows(apps, (a) => a.namespace);
    expect(groups.map((g) => g.key)).toEqual(["argocd", "team-a", "team-b"]);
    const mixed = [app("zeta", "a"), app("", "b"), app("Beta", "c"), app("alpha", "d")];
    expect(groupRows(mixed, (a) => a.namespace).map((g) => g.key)).toEqual(["", "alpha", "Beta", "zeta"]);
  });
  it("keeps the row order inside a group", () => {
    const sorted = sortRows(apps, columns, { col: "age", asc: false });
    const groups = groupRows(sorted, (a) => a.namespace);
    expect(groups[0].rows.map(key)).toEqual(["argocd/web", "argocd/api"]);
  });
  it("returns no group for no rows", () => {
    expect(groupRows([], (a: App) => a.namespace)).toEqual([]);
  });
  it("returns one group when every row has the same key", () => {
    const groups = groupRows(apps, () => "all");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("all");
    expect(groups[0].rows).toEqual(apps);
  });
  it("does not change the input", () => {
    const before = [...apps];
    groupRows(apps, (a) => a.health);
    expect(apps).toEqual(before);
  });
});

describe("rangeSelect", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("toggles a key without shift", () => {
    expect([...rangeSelect(new Set(), order, null, "b", false)]).toEqual(["b"]);
    expect([...rangeSelect(new Set(["b"]), order, "b", "b", false)]).toEqual([]);
  });
  it("sets a range from the anchor in order's order, forward and backward", () => {
    expect([...rangeSelect(new Set(["b"]), order, "b", "d", true)]).toEqual(["b", "c", "d"]);
    expect([...rangeSelect(new Set(["d"]), order, "d", "b", true)].sort()).toEqual(["b", "c", "d"]);
  });
  it("clears the range when the clicked key was already selected", () => {
    const prev = new Set(["a", "b", "c", "d", "e"]);
    expect([...rangeSelect(prev, order, "b", "d", true)].sort()).toEqual(["a", "e"]);
  });
  it("keeps keys outside the range", () => {
    expect([...rangeSelect(new Set(["a"]), order, "c", "d", true)].sort()).toEqual(["a", "c", "d"]);
  });
  it("falls back to a toggle when the anchor is absent or not in order", () => {
    expect([...rangeSelect(new Set(), order, null, "c", true)]).toEqual(["c"]);
    expect([...rangeSelect(new Set(), order, "gone", "c", true)]).toEqual(["c"]);
  });
  it("a shift-click on the anchor clears or sets that one row", () => {
    expect([...rangeSelect(new Set(["c"]), order, "c", "c", true)]).toEqual([]);
  });
  it("never adds a key that is not in order", () => {
    expect([...rangeSelect(new Set(), order, "a", "zzz", true)]).toEqual([]);
    expect([...rangeSelect(new Set(), order, "a", "zzz", false)]).toEqual([]);
    const range = rangeSelect(new Set(), order, "a", "c", true);
    for (const k of range) expect(order).toContain(k);
  });
  it("can still clear a selected key that left the order", () => {
    expect([...rangeSelect(new Set(["gone"]), order, null, "gone", false)]).toEqual([]);
  });
  it("does not change prev", () => {
    const prev = new Set(["a"]);
    rangeSelect(prev, order, "a", "c", true);
    expect([...prev]).toEqual(["a"]);
  });
});
