import { describe, expect, it } from "vitest";
import { newSessionId, stripShellPrefix } from "./sessionId";

const VALID = /^[A-Za-z0-9_-]{1,64}$/;

describe("newSessionId", () => {
  it("uses randomUUID when present", () => {
    expect(newSessionId({ randomUUID: () => "11111111-2222-3333-4444-555555555555" })).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("falls back to getRandomValues with a backend-valid id", () => {
    const c = {
      getRandomValues: (a: Uint8Array) => {
        const u = a;
        for (let i = 0; i < u.length; i++) u[i] = (i * 37 + 200) % 256;
      },
    };
    const id = newSessionId(c);
    expect(id).toMatch(VALID);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it("still yields a valid id with no crypto at all", () => {
    expect(newSessionId({})).toMatch(VALID);
  });

  it("produces different ids across calls", () => {
    expect(newSessionId({})).not.toBe(newSessionId({}));
  });
});

describe("stripShellPrefix", () => {
  it("strips the known prefix once", () => {
    expect(stripShellPrefix("Failed to start shell: boom")).toBe("boom");
  });
  it("leaves other messages alone", () => {
    expect(stripShellPrefix("boom")).toBe("boom");
  });
});
