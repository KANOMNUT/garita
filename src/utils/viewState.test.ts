import { describe, expect, it } from "vitest";
import { viewState } from "./viewState";

describe("viewState", () => {
  it("absent -> not-installed, whatever the list did", () => {
    expect(viewState("absent", null, 0).kind).toBe("not-installed");
    expect(viewState("absent", "Failed to list: 500", 0).kind).toBe("not-installed");
    expect(viewState("absent", "403 Forbidden", 0).kind).toBe("not-installed");
  });
  it("403 with installed/unknown/undefined presence -> no-access", () => {
    for (const p of ["installed", "unknown"] as const)
      expect(viewState(p, "Failed to list x: forbidden: User cannot list", 0).kind).toBe("no-access");
    expect(viewState("installed", "ApiError 403", 0).kind).toBe("no-access");
  });
  it("installed + [] -> nothing-here, no subtitle", () => {
    expect(viewState("installed", null, 0)).toEqual({ kind: "nothing-here", unconfirmed: false });
  });
  it("unknown + [] -> nothing-here with unconfirmed subtitle", () => {
    expect(viewState("unknown", null, 0)).toEqual({ kind: "nothing-here", unconfirmed: true });
  });
  it("other error -> error", () => {
    expect(viewState("installed", "connection reset", 0).kind).toBe("error");
    expect(viewState("unknown", "timeout", 0).kind).toBe("error");
  });
  it("rows present -> ok, even if presence says absent", () => {
    expect(viewState("installed", null, 3).kind).toBe("ok");
    expect(viewState("absent", null, 3).kind).toBe("ok");
  });
});
