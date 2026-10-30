import { afterEach, describe, expect, it } from "vitest";
import {
  CRD_NOT_ESTABLISHED_REASON, CRD_NO_SERVED_VERSION_REASON,
  crDeniedReason, crdInstancesReason, crdKubectlNoun, crdReadVersion, crdRef, loadCrdGrouping, sameCustomResource, saveCrdGrouping,
} from "./crds";
import { deleteEquiv } from "./kubectlEquiv";
import type { CRD, CustomResourceSelection } from "../types/k8s";

const crd = (over: Partial<CRD> = {}): CRD => ({
  name: "widgets.acme.io", group: "acme.io", kind: "Widget", plural: "widgets", scope: "Namespaced",
  versions: "v1beta1, v1", read_version: "v1", established: true, age: "5d",
  ...over,
});

describe("crdReadVersion", () => {
  it("uses read_version when it is set", () => {
    expect(crdReadVersion(crd({ read_version: "v1" }))).toBe("v1");
    expect(crdReadVersion(crd({ read_version: "v2", versions: "v1" }))).toBe("v2");
  });
  it("falls back to the first served version in versions", () => {
    expect(crdReadVersion(crd({ read_version: "", versions: "v1beta1, v1" }))).toBe("v1beta1");
    expect(crdReadVersion(crd({ read_version: "", versions: "v1" }))).toBe("v1");
  });
  it("trims spaces around either source", () => {
    expect(crdReadVersion(crd({ read_version: "  v1  " }))).toBe("v1");
    expect(crdReadVersion(crd({ read_version: "", versions: "  v1alpha1 ,v1" }))).toBe("v1alpha1");
  });
  it("is empty when no version is served", () => {
    expect(crdReadVersion(crd({ read_version: "", versions: "" }))).toBe("");
    expect(crdReadVersion(crd({ read_version: "   ", versions: "  " }))).toBe("");
  });
  it("is empty for null and undefined", () => {
    expect(crdReadVersion(null)).toBe("");
    expect(crdReadVersion(undefined)).toBe("");
  });
  it("falls back when read_version is missing at run time (a backend without it)", () => {
    const old = { versions: "v1beta1, v1" } as unknown as CRD;
    expect(crdReadVersion(old)).toBe("v1beta1");
  });
});

describe("crdRef", () => {
  it("has exactly the five fields every custom resource command takes", () => {
    expect(crdRef(crd())).toEqual({ group: "acme.io", version: "v1", kind: "Widget", plural: "widgets", scope: "Namespaced" });
  });
  it("takes the version from crdReadVersion, fallback included", () => {
    expect(crdRef(crd({ read_version: "", versions: "v1beta1, v1" })).version).toBe("v1beta1");
  });
  it("keeps a cluster scope as the CRD states it", () => {
    expect(crdRef(crd({ scope: "Cluster" })).scope).toBe("Cluster");
  });
});

describe("crdInstancesReason", () => {
  it("is undefined for an established CRD with a served version", () => {
    expect(crdInstancesReason(crd())).toBeUndefined();
  });
  it("says the CRD is not established", () => {
    expect(crdInstancesReason(crd({ established: false }))).toBe(CRD_NOT_ESTABLISHED_REASON);
    expect(CRD_NOT_ESTABLISHED_REASON).toBe("This CRD is not established yet, so its objects can't be listed.");
  });
  it("says no version is served", () => {
    expect(crdInstancesReason(crd({ read_version: "", versions: "" }))).toBe(CRD_NO_SERVED_VERSION_REASON);
    expect(CRD_NO_SERVED_VERSION_REASON).toBe("No version of this CRD is served, so its objects can't be listed.");
  });
  it("checks not established first", () => {
    expect(crdInstancesReason(crd({ established: false, read_version: "", versions: "" }))).toBe(CRD_NOT_ESTABLISHED_REASON);
  });
});

describe("CRD grouping switch (localStorage crds-grouped)", () => {
  const g = globalThis as unknown as { localStorage?: unknown };
  afterEach(() => { delete g.localStorage; });

  it("is on when there is no storage at all (node)", () => {
    delete g.localStorage;
    expect(loadCrdGrouping()).toBe(true);
  });
  it("is on when the storage throws", () => {
    g.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadCrdGrouping()).toBe(true);
  });
  it("is on by default and for a missing or unknown value", () => {
    const store = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadCrdGrouping()).toBe(true);
    store.set("crds-grouped", "banana");
    expect(loadCrdGrouping()).toBe(true);
  });
  it("reads 0 as off and 1 as on", () => {
    const store = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    store.set("crds-grouped", "0");
    expect(loadCrdGrouping()).toBe(false);
    store.set("crds-grouped", "1");
    expect(loadCrdGrouping()).toBe(true);
  });
  it("saves and reads back, and returns true", () => {
    const store = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(saveCrdGrouping(false)).toBe(true);
    expect(store.get("crds-grouped")).toBe("0");
    expect(loadCrdGrouping()).toBe(false);
    expect(saveCrdGrouping(true)).toBe(true);
    expect(store.get("crds-grouped")).toBe("1");
    expect(loadCrdGrouping()).toBe(true);
  });
  it("returns false when the write throws, and does not throw", () => {
    g.localStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(saveCrdGrouping(false)).toBe(false);
  });
  it("returns false when there is no storage", () => {
    delete g.localStorage;
    expect(saveCrdGrouping(true)).toBe(false);
  });
});

describe("crdKubectlNoun", () => {
  it("is <plural>.<group>", () => {
    expect(crdKubectlNoun(crd())).toBe("widgets.acme.io");
    expect(crdKubectlNoun({ plural: "certificates", group: "cert-manager.io" })).toBe("certificates.cert-manager.io");
  });
  it("feeds deleteEquiv: -n for a namespaced object, none for an empty namespace", () => {
    const noun = crdKubectlNoun(crd());
    const argv = (namespace: string) => deleteEquiv({ context: "c", namespace, kind: noun, name: "w1" }).commands[0].argv;
    expect(argv("ns")).toEqual(["kubectl", "delete", "widgets.acme.io", "w1", "-n", "ns", "--context", "c"]);
    expect(argv("")).toEqual(["kubectl", "delete", "widgets.acme.io", "w1", "--context", "c"]);
  });
});

describe("crDeniedReason", () => {
  it("names the verb, the plural and the namespace", () => {
    expect(crDeniedReason("delete", "widgets", "ns1")).toBe("You don't have permission to delete widgets in namespace ns1.");
    expect(crDeniedReason("update", "widgets", "ns1")).toBe("You don't have permission to update widgets in namespace ns1.");
  });
  it("says this cluster for an empty namespace", () => {
    expect(crDeniedReason("delete", "clusterwidgets", "")).toBe("You don't have permission to delete clusterwidgets in this cluster.");
    expect(crDeniedReason("update", "clusterwidgets", "")).toBe("You don't have permission to update clusterwidgets in this cluster.");
  });
});

describe("sameCustomResource", () => {
  const sel = (over: { crd?: Partial<CRD>; ns?: string; name?: string } = {}): CustomResourceSelection => ({
    crd: crd(over.crd), item: { name: over.name ?? "w1", namespace: over.ns ?? "ns1", age: "1d" },
  });
  it("is true for the same CRD name, namespace and name, whatever the rest says", () => {
    expect(sameCustomResource(sel(), sel())).toBe(true);
    expect(sameCustomResource(sel(), { crd: crd({ age: "9d", read_version: "v2" }), item: { name: "w1", namespace: "ns1", age: "9d" } })).toBe(true);
  });
  it("is false when any one of the three differs", () => {
    expect(sameCustomResource(sel(), sel({ crd: { name: "gadgets.acme.io" } }))).toBe(false);
    expect(sameCustomResource(sel(), sel({ ns: "ns2" }))).toBe(false);
    expect(sameCustomResource(sel(), sel({ name: "w2" }))).toBe(false);
  });
  it("treats a cluster-scoped object (empty namespace) as its own identity", () => {
    expect(sameCustomResource(sel({ ns: "" }), sel({ ns: "" }))).toBe(true);
    expect(sameCustomResource(sel({ ns: "" }), sel({ ns: "ns1" }))).toBe(false);
  });
});
