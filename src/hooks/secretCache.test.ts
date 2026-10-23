import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { forgetHelmValues, forgetSecret, secretReadOptions } from "./useResources";

describe("secretReadOptions", () => {
  it("is gcTime 0 for sec only", () => {
    expect(secretReadOptions("sec")).toEqual({ gcTime: 0, staleTime: 0, retry: false });
    expect(secretReadOptions("cm")).toEqual({});
  });
});

describe("forgetSecret", () => {
  it("removes exactly the four Secret read keys of that object", () => {
    const qc = new QueryClient();
    const keep: unknown[][] = [
      ["resource-json", "sec", "c", "ns", "other"],
      ["resource-json", "cm", "c", "ns", "x"],
      ["resource-yaml", "cm", "c", "ns", "x"],
      ["secrets", "c", "ns"],
    ];
    const gone: unknown[][] = [
      ["secret-reveal", "c", "ns", "x"],
      ["resource-json", "sec", "c", "ns", "x"],
      ["resource-yaml", "sec", "c", "ns", "x"],
      ["resource-yaml", "neat", "sec", "c", "ns", "x"],
    ];
    for (const k of [...keep, ...gone]) qc.setQueryData(k, "v");
    forgetSecret(qc, "c", "ns", "x");
    for (const k of gone) expect(qc.getQueryData(k)).toBeUndefined();
    for (const k of keep) expect(qc.getQueryData(k)).toBe("v");
  });
});

describe("forgetHelmValues", () => {
  it("removes the revealed key only", () => {
    const qc = new QueryClient();
    qc.setQueryData(["helm-values", "c", "ns", "r"], "red");
    qc.setQueryData(["helm-values", "c", "ns", "r", "revealed"], "real");
    forgetHelmValues(qc, "c", "ns", "r");
    expect(qc.getQueryData(["helm-values", "c", "ns", "r", "revealed"])).toBeUndefined();
    expect(qc.getQueryData(["helm-values", "c", "ns", "r"])).toBe("red");
  });
});
