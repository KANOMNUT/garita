import { beforeEach, describe, expect, it } from "vitest";
import {
  assertWritable, checkBulk, disabledAttrs, disabledReasonId, registeredDisabledReasons, pickDisabledReason, READ_ONLY_REASON, readOnlyRefusal,
} from "./guardrails";
import {
  getClusterIdentity, getGuardrailSettings, guardrailsFromEntry, isGuardrailStoreCorrupt, parseStore,
  setClusterIdentity,
} from "./clusterIdentity";
import { PRODUCT_NAME } from "../brand";

// A minimal localStorage for the node test environment.
function installStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set("cluster-identity", initial);
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("parseStore", () => {
  it("distinguishes empty from corrupt", () => {
    expect(parseStore(null)).toEqual({ store: {}, corrupt: false });
    expect(parseStore("")).toEqual({ store: {}, corrupt: false });
    expect(parseStore("{not json").corrupt).toBe(true);
    expect(parseStore("[1,2]").corrupt).toBe(true);
    expect(parseStore('{"a": 5}')).toEqual({ store: {}, corrupt: true });
  });
  it("keeps good entries next to a bad one", () => {
    const r = parseStore('{"a":{"label":"x"},"b":7}');
    expect(r.store.a.label).toBe("x");
    expect(r.corrupt).toBe(true);
  });
});

describe("guardrailsFromEntry", () => {
  it("reads everything off by default and validates the limit", () => {
    expect(guardrailsFromEntry(undefined)).toEqual({ readOnly: false, typedConfirm: false, bulkLimit: null });
    expect(guardrailsFromEntry({ readOnly: true, typedConfirm: true, bulkLimit: 10 })).toEqual({ readOnly: true, typedConfirm: true, bulkLimit: 10 });
    expect(guardrailsFromEntry({ bulkLimit: 0 }).bulkLimit).toBeNull();
    expect(guardrailsFromEntry({ bulkLimit: 501 }).bulkLimit).toBeNull();
    expect(guardrailsFromEntry({ bulkLimit: 2.5 }).bulkLimit).toBeNull();
    expect(guardrailsFromEntry({ readOnly: "yes" as unknown as boolean }).readOnly).toBe(false);
  });
});

describe("store round trip", () => {
  beforeEach(() => installStorage());
  it("setClusterIdentity preserves fields it does not own (00 Q4)", () => {
    installStorage(JSON.stringify({ prod: { color: "bad", label: "PROD", readOnly: true, alias: "keep-me" } }));
    setClusterIdentity("prod", { label: "Production" });
    const stored = JSON.parse(localStorage.getItem("cluster-identity") ?? "{}");
    expect(stored.prod.alias).toBe("keep-me");
    expect(stored.prod.readOnly).toBe(true);
    expect(stored.prod.label).toBe("Production");
    expect(stored.prod.color).toBe("bad");
  });
  it("a corrupt store reads as all off and flags itself", () => {
    installStorage("{broken");
    expect(getGuardrailSettings("prod")).toEqual({ readOnly: false, typedConfirm: false, bulkLimit: null });
    expect(isGuardrailStoreCorrupt()).toBe(true);
    expect(getClusterIdentity("prod").label).toBe("prod");
  });
  it("identity-only writes do not switch guardrails on", () => {
    setClusterIdentity("dev", { color: "identity-green" });
    expect(getGuardrailSettings("dev").readOnly).toBe(false);
  });
});

describe("write backstop", () => {
  it("throws the refusal only while read-only is on for that context", () => {
    installStorage(JSON.stringify({ prod: { label: "prod-eu-1", readOnly: true }, dev: { readOnly: false } }));
    expect(() => assertWritable("prod")).toThrowError(readOnlyRefusal("prod-eu-1"));
    expect(() => assertWritable("dev")).not.toThrow();
    expect(() => assertWritable("unknown")).not.toThrow();
    expect(() => assertWritable("")).not.toThrow();
  });
  it("refusal text is the spec string", () => {
    expect(readOnlyRefusal("x")).toBe(`Read-only mode (${PRODUCT_NAME} guardrail) is on for x. Turn it off with the Read-only chip in the top bar to make changes.`);
  });
});

describe("checkBulk", () => {
  it("allows everything when the limit is off or not exceeded", () => {
    expect(checkBulk(500, null, "c").ok).toBe(true);
    expect(checkBulk(10, 10, "c").ok).toBe(true);
  });
  it("refuses over the limit with the deselect count", () => {
    const r = checkBulk(14, 10, "prod-eu-1");
    expect(r.ok).toBe(false);
    expect(r.over).toBe(4);
    expect(r.message).toBe("Guardrail: bulk actions are limited to 10 on prod-eu-1. Deselect 4 to continue.");
  });
});

describe("DISABLE-PRECEDENCE", () => {
  it("picks read-only, then RBAC, then capability, then finished", () => {
    expect(pickDisabledReason({ readOnly: true, rbac: "rbac", capability: "cap" })).toBe(READ_ONLY_REASON);
    expect(pickDisabledReason({ rbac: "rbac", capability: "cap" })).toBe("rbac");
    expect(pickDisabledReason({ capability: "cap", finished: "done" })).toBe("cap");
    expect(pickDisabledReason({ finished: "done" })).toBe("done");
    expect(pickDisabledReason({})).toBeUndefined();
  });
  it("disabledAttrs is empty without a reason, aria-disabled with one", () => {
    expect(disabledAttrs(undefined)).toEqual({});
    expect(disabledAttrs("why")).toEqual({ "aria-disabled": true, "aria-describedby": disabledReasonId("why"), title: "why" });
  });
  it("disabledAttrs registers the reason so the host can render the described-by text", () => {
    disabledAttrs("registered reason");
    expect(registeredDisabledReasons()).toContain("registered reason");
    expect(disabledReasonId("a")).not.toBe(disabledReasonId("b"));
    expect(disabledReasonId("a")).toMatch(/^dr-[0-9a-z]+$/);
  });
});
