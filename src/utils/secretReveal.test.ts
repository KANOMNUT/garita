import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { formatSecretSize, hasRedactionSentinel, helmEditSeed, HELM_REDACTION_SENTINEL, LEGACY_HELM_REDACTION_SENTINEL } from "./secretReveal";

describe("formatSecretSize", () => {
  it("formats", () => {
    expect(formatSecretSize(0)).toBe("empty value");
    expect(formatSecretSize(1)).toBe("1 byte");
    expect(formatSecretSize(12)).toBe("12 bytes");
    expect(formatSecretSize(1229)).toBe("1.2 KiB");
    expect(formatSecretSize(3 * 1024 * 1024)).toBe("3.0 MiB");
  });
});

describe("helmEditSeed", () => {
  it("reads only the revealed key, never the redacted one", () => {
    const qc = new QueryClient();
    qc.setQueryData(["helm-values", "c", "ns", "r"], `password: ${HELM_REDACTION_SENTINEL}`);
    expect(helmEditSeed(qc, "c", "ns", "r")).toBe("");
    qc.setQueryData(["helm-values", "c", "ns", "r", "revealed"], "password: hunter2");
    expect(helmEditSeed(qc, "c", "ns", "r")).toBe("password: hunter2");
  });
});

describe("hasRedactionSentinel", () => {
  it("detects the current and the legacy placeholder", () => {
    expect(HELM_REDACTION_SENTINEL).toBe("<redacted>");
    expect(LEGACY_HELM_REDACTION_SENTINEL).toBe("<redacted by Watchtower>");
    expect(hasRedactionSentinel("a: <redacted>")).toBe(true);
    expect(hasRedactionSentinel("a: <redacted by Watchtower>")).toBe(true);
    expect(hasRedactionSentinel("a: real")).toBe(false);
  });
});
