import { describe, expect, it } from "vitest";
import { previewRows } from "./mergePreview";

const LA = "kubectl.kubernetes.io/last-applied-configuration";

describe("previewRows", () => {
  it("shows values for a non-Secret document", () => {
    const rows = previewRows({ data: { a: "1" } }, { data: { a: "2" } });
    expect(rows[0]).toMatchObject({ path: "data.a", from: "1", to: "2", state: "changed" });
  });

  it("masks data, stringData and last-applied on both sides of a Secret, keeping the row state", () => {
    const live = { metadata: { annotations: { [LA]: "{live-manifest}", keep: "x" } }, data: { pw: "aHVudGVyMg==", same: "c2Ft" } };
    const desired = { metadata: { annotations: { [LA]: "{new-manifest}", keep: "y" } }, data: { pw: "bmV3", same: "c2Ft", fresh: "YWJj" }, stringData: { s: "héllo" } };
    const rows = previewRows(live, desired, "", true);
    const by = (p: string) => rows.find((r) => r.path === p);
    expect(by("data.pw")).toMatchObject({ state: "changed", from: "•••••••• (7 bytes)", to: "•••••••• (3 bytes)", masked: "secret" });
    expect(by("data.same")).toMatchObject({ state: "unchanged", masked: "secret" });
    expect(by("data.fresh")).toMatchObject({ state: "added", from: null, to: "•••••••• (3 bytes)" });
    expect(by("stringData.s")?.to).toBe("•••••••• (6 bytes)");
    expect(by(`metadata.annotations.${LA}`)).toMatchObject({ state: "changed", masked: "secret" });
    expect(by("metadata.annotations.keep")).toMatchObject({ from: "x", to: "y" });
    const json = JSON.stringify(rows);
    for (const leak of ["aHVudGVyMg", "bmV3", "c2Ft", "live-manifest", "new-manifest", "héllo"]) expect(json).not.toContain(leak);
  });

  it("masks a Secret whose data or metadata is replaced by null (the whole live map would otherwise print)", () => {
    const live = { metadata: { annotations: { [LA]: "{live-manifest}" } }, data: { pw: "aHVudGVyMg==" } };
    for (const desired of [{ data: null }, { metadata: { annotations: null } }, { metadata: null }]) {
      const rows = previewRows(live, desired, "", true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.masked === "secret")).toBe(true);
      const json = JSON.stringify(rows);
      for (const leak of ["aHVudGVyMg", "live-manifest"]) expect(json).not.toContain(leak);
    }
  });

  it("masks a scalar document root for a Secret", () => {
    const rows = previewRows({ data: { pw: "aHVudGVyMg==" } }, "x", "", true);
    expect(JSON.stringify(rows)).not.toContain("aHVudGVyMg");
  });
});
