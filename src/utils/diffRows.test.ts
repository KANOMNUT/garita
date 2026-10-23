import { describe, expect, it } from "vitest";
import {
  base64ByteLength, capRows, changeCountText, COMPARE_IGNORED, diffObjects, droppedRows, getAtPath,
  helmValuesDiff, insideArray, K8S_IGNORED, MASK_TEXT, parentPath, removePaths, yamlSaveDiff,
  type DiffRow,
} from "./diffRows";

const byPath = (rows: DiffRow[], path: string) => rows.find((r) => r.path === path);

describe("diffObjects", () => {
  it("classifies added, removed, changed and unchanged scalars", () => {
    const { rows } = diffObjects({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 });
    expect(byPath(rows, "a")?.state).toBe("unchanged");
    expect(byPath(rows, "b")).toMatchObject({ state: "changed", from: "2", to: "5" });
    expect(byPath(rows, "c")).toMatchObject({ state: "removed", from: "3", to: null });
    expect(byPath(rows, "d")).toMatchObject({ state: "added", from: null, to: "4" });
  });

  it("walks nested objects with dotted paths and expands one-sided subtrees per leaf", () => {
    const { rows } = diffObjects({}, { metadata: { labels: { app: "x", tier: "web" } } });
    expect(rows.map((r) => r.path)).toEqual(["metadata.labels.app", "metadata.labels.tier"]);
    expect(rows.every((r) => r.state === "added")).toBe(true);
  });

  it("treats arrays as leaf `replaced` rows and never recurses element-wise", () => {
    const { rows } = diffObjects(
      { spec: { containers: [{ name: "a", image: "1" }] } },
      { spec: { containers: [{ name: "a", image: "2" }] } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "spec.containers", state: "replaced", from: "array, 1 item", to: "array, 1 item" });
    expect(rows[0].fromText).toContain('"image": "1"');
  });

  it("reports an unchanged array as unchanged, not replaced", () => {
    const { rows } = diffObjects({ a: [1, 2] }, { a: [1, 2] });
    expect(rows[0].state).toBe("unchanged");
  });

  it("honours the ignore list for a path and everything under it", () => {
    const left = { metadata: { name: "a", uid: "1", resourceVersion: "5", labels: { x: "1" } }, status: { ready: 1 } };
    const right = { metadata: { name: "a", uid: "2", resourceVersion: "6", labels: { x: "2" } }, status: { ready: 2 } };
    const { rows } = diffObjects(left, right, { ignore: K8S_IGNORED });
    expect(rows.filter((r) => r.state !== "unchanged").map((r) => r.path)).toEqual(["metadata.labels.x"]);
    const cmp = diffObjects({ metadata: { name: "a", namespace: "n" } }, { metadata: { name: "b", namespace: "m" } }, { ignore: COMPARE_IGNORED });
    expect(cmp.rows).toHaveLength(0);
  });

  it("treats null, {} and [] as absent only when asked", () => {
    const left = { a: null, b: {}, c: [], d: 1 };
    const right = { d: 1 };
    expect(diffObjects(left, right, { emptyEqualsAbsent: true }).changed).toBe(0);
    expect(diffObjects(left, right).changed).toBe(3);
  });

  it("caps changed rows at 200 and counts the rest, leaving unchanged rows alone", () => {
    const left: Record<string, number> = {};
    const right: Record<string, number> = {};
    for (let i = 0; i < 250; i++) { left[`k${i}`] = 1; right[`k${i}`] = 2; }
    left.same = 1; right.same = 1;
    const r = diffObjects(left, right);
    expect(r.changed).toBe(250);
    expect(r.more).toBe(50);
    expect(r.rows.filter((x) => x.state === "changed")).toHaveLength(200);
    expect(r.unchanged).toBe(1);
    expect(capRows([{ path: "a", state: "added", from: null, to: "1" }], 0).more).toBe(1);
  });
});

describe("masking", () => {
  it("masks Secret data values with a byte count and still shows the state", () => {
    const { rows } = diffObjects(
      { data: { password: "aHVudGVyMg==", old: "eA==" } },
      { data: { password: "bmV3cGFzcw==", fresh: "YWJj" } },
      { maskSecretData: true },
    );
    const pw = byPath(rows, "data.password");
    expect(pw?.state).toBe("changed");
    expect(pw?.masked).toBe("secret");
    expect(pw?.from).toBe(`${MASK_TEXT} (7 bytes)`);
    expect(pw?.reveal).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("hunter2");
    expect(byPath(rows, "data.old")).toMatchObject({ state: "removed", to: null });
    expect(byPath(rows, "data.fresh")).toMatchObject({ state: "added", to: `${MASK_TEXT} (3 bytes)` });
  });

  it("masks the kubectl last-applied annotation on a Secret", () => {
    const k = "kubectl.kubernetes.io/last-applied-configuration";
    const { rows } = diffObjects(
      { metadata: { annotations: { [k]: "{old-pw}", other: "a" } } },
      { metadata: { annotations: { [k]: "{new-pw}", other: "b" } } },
      { maskSecretData: true },
    );
    const la = byPath(rows, `metadata.annotations.${k}`);
    expect(la?.masked).toBe("secret");
    expect(la?.state).toBe("changed");
    expect(JSON.stringify(rows)).not.toContain("-pw");
    expect(byPath(rows, "metadata.annotations.other")?.from).toBe("a");
  });

  it("masks a parent-path leaf (a Secret diffed against null or a scalar) so no value is printed", () => {
    const secret = { metadata: { name: "s", annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{pw-manifest}" } }, data: { pw: "aHVudGVyMg==" }, stringData: { s: "plain-secret" } };
    for (const other of [null, "x", { data: null, stringData: null, metadata: null }]) {
      const { rows } = diffObjects(secret, other, { maskSecretData: true });
      const json = JSON.stringify(rows);
      for (const leak of ["aHVudGVyMg", "pw-manifest", "plain-secret"]) expect(json).not.toContain(leak);
    }
  });

  it("counts stringData in UTF-8 bytes", () => {
    const { rows } = diffObjects({}, { stringData: { k: "héllo" } }, { maskSecretData: true });
    expect(rows[0].to).toBe(`${MASK_TEXT} (6 bytes)`);
  });

  it("masks Helm credential-looking keys but keeps the real value behind reveal", () => {
    const r = helmValuesDiff(
      { replicas: 1, adminPassword: "old", image: { tag: "1" } },
      { replicas: 2, adminPassword: "new", image: { tag: "1" }, auth: { apiToken: "t" } },
    );
    const pw = byPath(r.rows, "adminPassword");
    expect(pw?.masked).toBe("credential");
    expect(pw?.from).toContain(MASK_TEXT);
    expect(pw?.reveal).toEqual({ from: "old", to: "new" });
    expect(byPath(r.rows, "auth.apiToken")?.masked).toBe("credential");
    expect(byPath(r.rows, "replicas")?.masked).toBeUndefined();
    expect(byPath(r.rows, "image.tag")?.state).toBe("unchanged");
  });

  it("base64ByteLength matches the decoded length", () => {
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength("YQ==")).toBe(1);
    expect(base64ByteLength("YWI=")).toBe(2);
    expect(base64ByteLength("YWJj")).toBe(3);
  });
});

describe("insideArray (D3-1)", () => {
  const left = [{ name: "api", image: "v2.3.1" }, { name: "side", image: "s1" }];
  const right = [{ name: "api", image: "v2.2.0" }, { name: "new", image: "n1" }];

  it("keys rows by name and uses + − ~", () => {
    const rows = insideArray(left, right) ?? [];
    expect(rows.find((r) => r.path === "[api] image")).toMatchObject({ state: "changed", from: "v2.3.1", to: "v2.2.0" });
    expect(rows.find((r) => r.path === "[side]")?.state).toBe("removed");
    expect(rows.find((r) => r.path === "[new]")?.state).toBe("added");
  });

  it("applies only when every element on BOTH sides has a unique string name", () => {
    expect(insideArray([{ name: "a" }, { name: "a" }], [{ name: "a" }])).toBeNull();
    expect(insideArray([{ name: "a" }], [{ image: "x" }])).toBeNull();
    expect(insideArray(["a", "b"], ["a"])).toBeNull();
    expect(insideArray([{ name: "a" }], { name: "a" })).toBeNull();
    expect(insideArray([{ name: 1 }], [{ name: 1 }])).toBeNull();
  });

  it("is attached to the replaced row but never changes its state", () => {
    const { rows } = diffObjects({ containers: left }, { containers: right });
    expect(rows[0].state).toBe("replaced");
    expect(rows[0].inside?.length).toBeGreaterThan(0);
  });

  it("is absent for arrays without names", () => {
    const { rows } = diffObjects({ args: ["a"] }, { args: ["b"] });
    expect(rows[0].inside).toBeUndefined();
  });
});

describe("dropped by schema (#10)", () => {
  const live = {
    metadata: { name: "x", resourceVersion: "1" },
    spec: {
      replicas: 3,
      template: { spec: { containers: [{ name: "api", image: "v1", resources: { claims: [{ name: "c" }] } }], hostUsers: false } },
    },
    status: { ready: 3 },
  };
  const dropped = ["spec.template.spec.containers[0].resources.claims", "spec.template.spec.hostUsers"];

  it("getAtPath and removePaths resolve dotted and indexed paths", () => {
    expect(getAtPath(live, "spec.template.spec.containers[0].image")).toBe("v1");
    const stripped = removePaths(live, dropped);
    expect(getAtPath(stripped, "spec.template.spec.hostUsers")).toBeUndefined();
    expect(getAtPath(stripped, "spec.template.spec.containers[0].resources.claims")).toBeUndefined();
    expect(getAtPath(live, "spec.template.spec.hostUsers")).toBe(false);
  });

  it("removePaths removes array elements without disturbing the others", () => {
    const o = { ports: [{ p: 1 }, { p: 2 }, { p: 3 }] };
    expect(removePaths(o, ["ports[0]", "ports[2]"])).toEqual({ ports: [{ p: 2 }] });
  });

  it("removePaths prefers the longest key when a key contains dots", () => {
    const o = { metadata: { annotations: { "a.b/c": "1", a: "2" } } };
    expect(removePaths(o, ["metadata.annotations.a.b/c"])).toEqual({ metadata: { annotations: { a: "2" } } });
  });

  it("yamlSaveDiff leaves only real changes plus the dropped list", () => {
    // The typed result has lost the two unknown fields and the user changed replicas 3 -> 5.
    const result = {
      metadata: { name: "x", resourceVersion: "2" },
      spec: { replicas: 5, template: { spec: { containers: [{ name: "api", image: "v1", resources: {} }] } } },
      status: { ready: 3 },
    };
    const diff = yamlSaveDiff(live, result, dropped);
    const changed = diff.result.rows.filter((r) => r.state !== "unchanged");
    expect(changed.map((r) => `${r.path}:${r.state}`)).toEqual(["spec.replicas:changed"]);
    expect(diff.dropped.map((r) => r.path)).toEqual(dropped);
    expect(diff.dropped.every((r) => r.state === "dropped")).toBe(true);
    expect(diff.dropped[1].from).toBe("false");
  });

  it("with nothing dropped, an identical object has no differences", () => {
    const diff = yamlSaveDiff(live, { ...live, metadata: { name: "x", resourceVersion: "9" } }, []);
    expect(diff.result.changed).toBe(0);
    expect(changeCountText(diff.result.changed)).toBe("No differences");
    expect(changeCountText(1)).toBe("1 change");
    expect(changeCountText(4)).toBe("4 changes");
  });

  it("droppedRows describes the live value", () => {
    expect(droppedRows({ a: { b: 1 } }, ["a.b"])[0]).toEqual({ path: "a.b", state: "dropped", from: "1", to: null });
  });
});

describe("parentPath", () => {
  it("returns the owning object path", () => {
    expect(parentPath("spec.replicas")).toBe("spec");
    expect(parentPath("a")).toBe("");
    expect(parentPath("spec.containers[0]")).toBe("spec.containers");
  });
});
