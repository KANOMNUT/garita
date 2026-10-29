import { describe, expect, it } from "vitest";
import { liveHistoryId } from "./argoHistory";

const entry = (id: number, revision: string) => ({ id, revision });

describe("liveHistoryId", () => {
  it("returns the id of the entry with the same revision", () => {
    const history = [entry(1, "aaaaaaa"), entry(2, "bbbbbbb"), entry(3, "ccccccc")];
    expect(liveHistoryId(history, "bbbbbbb")).toBe(2);
  });

  it("returns null when nothing matches", () => {
    expect(liveHistoryId([entry(1, "aaaaaaa")], "bbbbbbb")).toBeNull();
    expect(liveHistoryId([], "bbbbbbb")).toBeNull();
  });

  it("takes the highest id when a revision was deployed more than once", () => {
    const history = [entry(7, "aaaaaaa"), entry(2, "bbbbbbb"), entry(9, "aaaaaaa"), entry(4, "aaaaaaa")];
    expect(liveHistoryId(history, "aaaaaaa")).toBe(9);
  });

  it("does not depend on the order of the list", () => {
    const asc = [entry(1, "x1"), entry(2, "x2"), entry(3, "x1")];
    const desc = [...asc].reverse();
    expect(liveHistoryId(asc, "x1")).toBe(3);
    expect(liveHistoryId(desc, "x1")).toBe(3);
  });

  it("matches exactly, never by prefix: a chart version is not another version it starts", () => {
    const history = [entry(1, "10.11.1"), entry(2, "10.11.12")];
    expect(liveHistoryId(history, "10.11.12")).toBe(2);
    expect(liveHistoryId(history, "10.11.1")).toBe(1);
    expect(liveHistoryId([entry(1, "10.11.12")], "10.11.1")).toBeNull();
    expect(liveHistoryId([entry(1, "10.11.1")], "10.11.12")).toBeNull();
  });

  it("is case sensitive and does not trim", () => {
    expect(liveHistoryId([entry(1, "AbCdEf0")], "abcdef0")).toBeNull();
    expect(liveHistoryId([entry(1, "abcdef0")], " abcdef0")).toBeNull();
  });

  it("matches a tag or branch name whole", () => {
    expect(liveHistoryId([entry(1, "v1.2.3"), entry(2, "main")], "main")).toBe(2);
  });

  it("never marks an entry for an empty or dash last_commit", () => {
    const history = [entry(1, ""), entry(2, "—"), entry(3, "aaaaaaa")];
    expect(liveHistoryId(history, "")).toBeNull();
    expect(liveHistoryId(history, "—")).toBeNull();
  });
});
