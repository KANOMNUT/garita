import { describe, it, expect } from "vitest";
import { mergePatch } from "./patch";
import {
  buildConfigMapNext,
  buildSecretNext,
  decodeSecretData,
  buildWorkloadNext,
  seedContainers,
  buildServiceNext,
  seedServicePorts,
  buildBindingNext,
  subjectFromLive,
  toEntries,
} from "./transforms";

describe("cm", () => {
  const live = { metadata: { name: "c" }, data: { a: "1", b: "2" } };

  it("untouched form yields no patch", () => {
    const next = buildConfigMapNext(live, { labels: [], annotations: [], data: toEntries(live.data) });
    expect(mergePatch(live, next)).toBeUndefined();
  });

  it("removed key becomes the null sentinel", () => {
    const next = buildConfigMapNext(live, { labels: [], annotations: [], data: [{ key: "a", value: "1" }] });
    expect(mergePatch(live, next)).toEqual({ data: { b: null } });
  });

  it("edited key emits only that key", () => {
    const next = buildConfigMapNext(live, {
      labels: [],
      annotations: [],
      data: [
        { key: "a", value: "changed" },
        { key: "b", value: "2" },
      ],
    });
    expect(mergePatch(live, next)).toEqual({ data: { a: "changed" } });
  });
});

describe("sec", () => {
  const live = {
    metadata: { name: "s" },
    type: "Opaque",
    data: { keep: btoa("same"), edit: btoa("old"), drop: btoa("gone") },
  };
  const { decoded, failedKeys } = decodeSecretData(live.data);
  const orig: Record<string, string> = {};
  for (const e of decoded) orig[e.key] = e.value;

  it("untouched form yields no patch", () => {
    const next = buildSecretNext(live, { entries: decoded, labels: [], annotations: [] }, orig, failedKeys);
    expect(mergePatch(live, next)).toBeUndefined();
  });

  it("edit and add go to stringData in cleartext", () => {
    const entries = [
      { key: "keep", value: "same" },
      { key: "edit", value: "new" },
      { key: "drop", value: "gone" },
      { key: "added", value: "x" },
    ];
    const next = buildSecretNext(live, { entries, labels: [], annotations: [] }, orig, failedKeys);
    expect(mergePatch(live, next)).toEqual({ stringData: { edit: "new", added: "x" } });
  });

  it("removal goes through data as null, not stringData", () => {
    const entries = decoded.filter((e) => e.key !== "drop");
    const next = buildSecretNext(live, { entries, labels: [], annotations: [] }, orig, failedKeys);
    expect(mergePatch(live, next)).toEqual({ data: { drop: null } });
  });

  it("both channels can appear in one patch", () => {
    const entries = [
      { key: "keep", value: "same" },
      { key: "edit", value: "new" },
    ];
    const next = buildSecretNext(live, { entries, labels: [], annotations: [] }, orig, failedKeys);
    const patch = mergePatch(live, next) as Record<string, unknown>;
    expect(patch.stringData).toEqual({ edit: "new" });
    expect(patch.data).toEqual({ drop: null });
  });

  it("an undecodable key is never deleted by omission", () => {
    const l = { ...live, data: { ...live.data, bin: "!!not base64!!" } };
    const d = decodeSecretData(l.data);
    expect(d.failedKeys).toEqual(["bin"]);
    const o: Record<string, string> = {};
    for (const e of d.decoded) o[e.key] = e.value;
    const next = buildSecretNext(l, { entries: d.decoded, labels: [], annotations: [] }, o, d.failedKeys);
    expect(mergePatch(l, next)).toBeUndefined();
  });
});

describe("deploy/sts/ds", () => {
  const live = {
    metadata: { name: "d", labels: { app: "x" } },
    spec: {
      template: {
        spec: {
          initContainers: [{ name: "init", image: "busybox" }],
          containers: [
            {
              name: "app",
              image: "app:1",
              env: [
                { name: "A", value: "1" },
                { name: "FROM", valueFrom: { secretKeyRef: { name: "s", key: "k" } } },
              ],
              volumeMounts: [{ name: "v", mountPath: "/v" }],
              livenessProbe: { httpGet: { path: "/", port: 80 } },
              futureField: { keep: true },
            },
            { name: "side", image: "side:1", securityContext: { runAsUser: 1 } },
          ],
        },
      },
    },
  };

  it("untouched form yields no patch", () => {
    const next = buildWorkloadNext(live, { containers: seedContainers(live), labels: toEntries(live.metadata.labels), annotations: [] });
    expect(mergePatch(live, next)).toBeUndefined();
  });

  it("changing one env var preserves every other field and container", () => {
    const containers = seedContainers(live);
    containers[0].env = [{ key: "A", value: "2" }];
    const next = buildWorkloadNext(live, { containers, labels: toEntries(live.metadata.labels), annotations: [] });
    const c = next.spec.template.spec.containers;
    expect(c[0].env).toEqual([
      { name: "A", value: "2" },
      { name: "FROM", valueFrom: { secretKeyRef: { name: "s", key: "k" } } },
    ]);
    expect(c[0].volumeMounts).toEqual(live.spec.template.spec.containers[0].volumeMounts);
    expect(c[0].livenessProbe).toEqual(live.spec.template.spec.containers[0].livenessProbe);
    expect(c[0].futureField).toEqual({ keep: true });
    expect(c[1]).toEqual(live.spec.template.spec.containers[1]);
    expect(next.spec.template.spec.initContainers).toEqual(live.spec.template.spec.initContainers);
    // Arrays replace wholesale: the patch carries the whole containers array.
    const patch = mergePatch(live, next) as any;
    expect(Object.keys(patch.spec.template.spec)).toEqual(["containers"]);
    expect(patch.spec.template.spec.containers).toHaveLength(2);
  });

  it("clearing a resource key keeps unmodelled resource entries", () => {
    const l = JSON.parse(JSON.stringify(live));
    l.spec.template.spec.containers[0].resources = { requests: { cpu: "1", "nvidia.com/gpu": "1" } };
    const cs = seedContainers(l);
    cs[0].resources.cpuReq = "";
    const next = buildWorkloadNext(l, { containers: cs, labels: toEntries(l.metadata.labels), annotations: [] });
    expect(next.spec.template.spec.containers[0].resources).toEqual({ requests: { "nvidia.com/gpu": "1" } });
  });
});

describe("svc ports", () => {
  const live = {
    metadata: { name: "s" },
    spec: {
      type: "NodePort",
      clusterIP: "10.0.0.1",
      sessionAffinity: "None",
      selector: { app: "x" },
      ports: [{ name: "http", port: 80, targetPort: 8080, protocol: "TCP", nodePort: 30080 }],
    },
  };
  const base = { type: "NodePort", sessionAffinity: "None", selector: toEntries(live.spec.selector) };

  it("untouched form yields no patch", () => {
    const next = buildServiceNext(live, { ...base, ports: seedServicePorts(live) });
    expect(mergePatch(live, next)).toBeUndefined();
  });

  it("editing a port keeps nodePort and never touches clusterIP", () => {
    const ports = seedServicePorts(live);
    ports[0].port = "81";
    const next = buildServiceNext(live, { ...base, ports });
    expect(next.spec.ports[0]).toEqual({ name: "http", port: 81, targetPort: 8080, protocol: "TCP", nodePort: 30080 });
    expect(next.spec.clusterIP).toBe("10.0.0.1");
  });

  it("added row is a fresh minimal object; blank rows are dropped", () => {
    const ports = [
      ...seedServicePorts(live),
      { name: "", port: "9090", targetPort: "", protocol: "UDP" },
      { name: "", port: "", targetPort: "", protocol: "TCP" },
    ];
    const next = buildServiceNext(live, { ...base, ports });
    expect(next.spec.ports).toHaveLength(2);
    expect(next.spec.ports[1]).toEqual({ port: 9090, protocol: "UDP" });
  });
});

describe("rbindings subjects", () => {
  const live = {
    metadata: { name: "b" },
    roleRef: { kind: "Role", name: "r", apiGroup: "rbac.authorization.k8s.io" },
    subjects: [
      { kind: "ServiceAccount", name: "sa", namespace: "ns" },
      { kind: "User", name: "bob", apiGroup: "rbac.authorization.k8s.io" },
    ],
  };

  it("untouched form yields no patch", () => {
    const next = buildBindingNext(live, live.subjects.map(subjectFromLive));
    expect(mergePatch(live, next)).toBeUndefined();
  });

  it("adding a subject replaces the array wholesale; roleRef untouched", () => {
    const subjects = [...live.subjects.map(subjectFromLive), { kind: "Group" as const, namespace: "", name: "devs" }];
    const next = buildBindingNext(live, subjects);
    const patch = mergePatch(live, next) as any;
    expect(Object.keys(patch)).toEqual(["subjects"]);
    expect(patch.subjects).toHaveLength(3);
    expect(patch.subjects[2]).toEqual({ kind: "Group", name: "devs", apiGroup: "rbac.authorization.k8s.io" });
  });

  it("a ServiceAccount subject gets its namespace; User/Group drop it", () => {
    const subjects = [{ kind: "User" as const, namespace: "stale", name: "bob" }];
    const next = buildBindingNext(live, subjects);
    expect(next.subjects[0].namespace).toBeUndefined();
  });
});
