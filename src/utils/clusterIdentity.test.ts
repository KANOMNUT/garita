import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error no @types/node in this repo; vitest runs in node and css ?raw comes back empty
import { readFileSync } from "node:fs";
import {
  CLUSTER_COLOR_CLASSES, IDENTITY_ROLES, LEGACY_IDENTITY_ALIAS, getClusterIdentity, dismissUpgradeNotice, getGuardrailSettings, isGuardrailStoreCorrupt, isIdentityStoreUnset, observabilityFor, isUpgradeNoticePending, readIdentityColor, seedReadOnly, setClusterIdentity, writeSeedIfUnset,
} from "./clusterIdentity";

const KEY = "cluster-identity";
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as Storage;
});

const LEGACY = ["accent", "ok", "warn", "orange", "bad", "purple"];
// v1.4.1 hash default, verbatim.
const legacyIndex = (ctx: string) => {
  let h = 0;
  for (let i = 0; i < ctx.length; i++) h = (h * 31 + ctx.charCodeAt(i)) | 0;
  return Math.abs(h) % LEGACY.length;
};

describe("readIdentityColor", () => {
  it("maps every legacy name", () => {
    LEGACY.forEach((n, i) => expect(readIdentityColor(n, "x")).toBe(IDENTITY_ROLES[i]));
    expect(Object.keys(LEGACY_IDENTITY_ALIAS)).toEqual(LEGACY);
  });
  it("legacy order is index-aligned with the roles", () => {
    IDENTITY_ROLES.forEach((r, i) => expect(LEGACY_IDENTITY_ALIAS[LEGACY[i]]).toBe(r));
  });
  it("a role reads as itself", () => {
    for (const r of IDENTITY_ROLES) expect(readIdentityColor(r, "x")).toBe(r);
  });
  it("unknown falls back to the unchanged v1.4.1 hash default", () => {
    for (const ctx of ["prod", "staging-eu-1", "kind-dev", "a"]) {
      for (const bad of [undefined, null, 5, "teal", "toString", ""]) {
        expect(readIdentityColor(bad, ctx)).toBe(IDENTITY_ROLES[legacyIndex(ctx)]);
      }
    }
  });
  it("classes are keyed by every role", () => {
    for (const r of IDENTITY_ROLES) expect(CLUSTER_COLOR_CLASSES[r].dot).toBe(`bg-${r}`);
  });
});

describe("setClusterIdentity", () => {
  it("a guardrail-only patch leaves the stored record's colour byte-identical", () => {
    const rec = { prod: { color: "accent", label: "PROD", alias: "keep-me" } };
    data.set(KEY, JSON.stringify(rec));
    setClusterIdentity("prod", { readOnly: true });
    const out = JSON.parse(data.get(KEY)!).prod;
    expect(out.color).toBe("accent");
    expect(out.alias).toBe("keep-me");
    expect(out.readOnly).toBe(true);
    expect(getClusterIdentity("prod").color).toBe("identity-blue");
  });
  it("an unconfigured context stays unwritten for colour", () => {
    setClusterIdentity("dev", { typedConfirm: true });
    expect(JSON.parse(data.get(KEY)!).dev.color).toBeUndefined();
  });
  it("an explicit pick writes the role name", () => {
    setClusterIdentity("dev", { color: "identity-red" });
    expect(JSON.parse(data.get(KEY)!).dev.color).toBe("identity-red");
  });
});

describe("accent isolation (CSS)", () => {
  it("--c-identity-* are literal triples, never var() / accent", () => {
    const css: string = readFileSync("src/index.css", "utf8");
    const hits = [...css.matchAll(/--c-identity-[\w-]+:\s*([^;]+);/g)];
    expect(hits.length).toBe(IDENTITY_ROLES.length * 2); // dark + light
    for (const [, v] of hits) expect(v).toMatch(/^\d+ \d+ \d+$/);
  });
  it("accent blocks, once they exist, set only accent vars", () => {
    const css: string = readFileSync("src/index.css", "utf8");
    for (const m of css.matchAll(/\[data-accent[^{]*\{([^}]*)\}/g)) {
      expect([...m[1].matchAll(/(--[\w-]+):/g)].map((x) => x[1]).filter((n) => n !== "--c-accent" && n !== "--c-on-accent")).toEqual([]);
    }
  });
});

describe("upgrade seed (RB-3b)", () => {
  it("seedReadOnly sets only readOnly and skips blank names", () => {
    expect(seedReadOnly(["a", "", "b"])).toEqual({ a: { readOnly: true }, b: { readOnly: true } });
    expect(seedReadOnly([])).toEqual({});
  });
  it("writes once when the store is null, then reads as read-only", () => {
    expect(isIdentityStoreUnset()).toBe(true);
    expect(writeSeedIfUnset(["prod", "dev"])).toBe(true);
    expect(JSON.parse(data.get(KEY)!)).toEqual({ prod: { readOnly: true }, dev: { readOnly: true } });
    expect(getGuardrailSettings("prod").readOnly).toBe(true);
    expect(getGuardrailSettings("prod").typedConfirm).toBe(false);
    expect(isIdentityStoreUnset()).toBe(false);
  });
  it("flags the notice on seed and clears it on dismiss", () => {
    expect(isUpgradeNoticePending()).toBe(false);
    writeSeedIfUnset(["prod"]);
    expect(isUpgradeNoticePending()).toBe(true);
    dismissUpgradeNotice();
    expect(isUpgradeNoticePending()).toBe(false);
  });
  it("never overwrites an existing store, even an empty one", () => {
    data.set(KEY, "{}");
    expect(writeSeedIfUnset(["prod"])).toBe(false);
    expect(data.get(KEY)).toBe("{}");
  });
  it("writes nothing for an empty context list", () => {
    expect(writeSeedIfUnset([])).toBe(false);
    expect(data.has(KEY)).toBe(false);
  });
  it("a store written between detection and the write wins", () => {
    expect(isIdentityStoreUnset()).toBe(true);
    setClusterIdentity("prod", { label: "P" });
    expect(writeSeedIfUnset(["prod"])).toBe(false);
    expect(getGuardrailSettings("prod").readOnly).toBe(false);
  });
});

describe("observability on the identity record (v2.3.0)", () => {
  const prom = { namespace: "monitoring", service: "prom", port: "9090" };
  const logs = { service: { namespace: "m", service: "loki", port: "80", tenant: "t" }, flavour: "loki" as const, labels: { namespace: "namespace", pod: "pod", container: "container" } };

  it("save keeps unknown siblings and a stored legacy accent colour", () => {
    data.set(KEY, JSON.stringify({ c1: { color: "accent", label: "L", future: { a: 1 }, readOnly: true } }));
    expect(setClusterIdentity("c1", { observability: { prometheus: prom, logs } })).toBe(true);
    const e = JSON.parse(data.get(KEY)!).c1;
    expect(e.color).toBe("accent");
    expect(e.future).toEqual({ a: 1 });
    expect(e.readOnly).toBe(true);
    expect(observabilityFor("c1")).toEqual({ prometheus: prom, logs });
  });
  it("null deletes the key; undefined leaves it", () => {
    setClusterIdentity("c1", { observability: { prometheus: prom } });
    setClusterIdentity("c1", { readOnly: true });
    expect(observabilityFor("c1")?.prometheus).toEqual(prom);
    setClusterIdentity("c1", { observability: null });
    expect("observability" in JSON.parse(data.get(KEY)!).c1).toBe(false);
  });
  it("a failed write reports false", () => {
    (globalThis.localStorage as { setItem: unknown }).setItem = () => { throw new Error("quota"); };
    expect(setClusterIdentity("c1", { observability: { prometheus: prom } })).toBe(false);
  });
  it("reads tolerantly: a wrong shape is unset for that half, no corrupt note", () => {
    for (const bad of [null, 5, "x", [], {}, { prometheus: { namespace: "m" } }, { logs: { flavour: "splunk", service: prom, labels: {} } }]) {
      data.set(KEY, JSON.stringify({ c1: { observability: bad } }));
      expect(observabilityFor("c1")).toBeUndefined();
      expect(isGuardrailStoreCorrupt()).toBe(false);
    }
    data.set(KEY, JSON.stringify({ c1: { observability: { prometheus: prom, logs: { flavour: "loki" } } } }));
    expect(observabilityFor("c1")).toEqual({ prometheus: prom });
  });
});
