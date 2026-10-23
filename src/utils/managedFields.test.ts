import { describe, expect, it } from "vitest";
import { agoText, findFields, fieldsV1ToPaths, parseManagedFields } from "./managedFields";

const FIELDS = {
  "f:metadata": { "f:labels": { ".": {}, "f:app": {} } },
  "f:spec": {
    "f:replicas": {},
    "f:template": {
      "f:spec": {
        "f:containers": {
          'k:{"name":"api"}': {
            ".": {},
            "f:image": {},
            "f:ports": { 'k:{"containerPort":8080,"protocol":"TCP"}': { ".": {}, "f:containerPort": {} } },
          },
        },
      },
    },
  },
};

describe("fieldsV1ToPaths", () => {
  const paths = fieldsV1ToPaths(FIELDS);
  it("renders f: keys as dotted paths", () => {
    expect(paths).toContain("spec.replicas");
    expect(paths).toContain("metadata.labels.app");
  });
  it("renders keyed list entries by name and by port/protocol, not raw JSON", () => {
    expect(paths).toContain("spec.template.spec.containers[api].image");
    expect(paths).toContain("spec.template.spec.containers[api].ports[8080/TCP].containerPort");
    expect(paths.some((p) => p.includes("k:{"))).toBe(false);
  });
  it("includes a node that carries '.' as a field of its own", () => {
    expect(paths).toContain("metadata.labels");
    expect(paths).toContain("spec.template.spec.containers[api]");
  });
  it("handles v: and i: list entries and never throws on junk", () => {
    expect(fieldsV1ToPaths({ "f:finalizers": { 'v:"foo/bar"': {} }, "f:args": { "i:0": {} } })).toEqual(["args[0]", "finalizers[foo/bar]"]);
    expect(fieldsV1ToPaths(null)).toEqual([]);
    expect(fieldsV1ToPaths({ "f:a": "x", zzz: {} })).toEqual([]);
  });
  it("caps the number of paths", () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) big[`f:k${i}`] = {};
    expect(fieldsV1ToPaths(big, 10)).toHaveLength(10);
  });
});

describe("parseManagedFields", () => {
  const obj = {
    metadata: {
      managedFields: [
        { manager: "kubectl", operation: "Update", time: "2026-01-01T00:00:00Z", fieldsV1: { "f:a": {} } },
        { manager: "argocd", operation: "Apply", time: "2026-02-01T00:00:00Z", fieldsV1: { "f:spec": { "f:replicas": {} } } },
        { manager: "kcm", operation: "Update", time: "2026-03-01T00:00:00Z", subresource: "status", fieldsV1: { "f:status": { "f:replicas": {} } } },
        { operation: "Update" },
      ],
    },
  };
  it("shows the manager name verbatim, most recent first, and skips junk entries", () => {
    const m = parseManagedFields(obj);
    expect(m.map((e) => e.manager)).toEqual(["kcm", "argocd", "kubectl"]);
    expect(m[0].subresource).toBe("status");
    expect(m[1].operation).toBe("Apply");
  });
  it("is empty when there is no managedFields", () => {
    expect(parseManagedFields({ metadata: {} })).toEqual([]);
    expect(parseManagedFields(null)).toEqual([]);
  });
  it("find a field: substring, all writers, most recent writer first", () => {
    const hits = findFields(parseManagedFields(obj), "replicas");
    expect(hits.map((h) => `${h.path}:${h.manager}`)).toEqual(["status.replicas:kcm", "spec.replicas:argocd"]);
    expect(findFields(parseManagedFields(obj), "  ")).toEqual([]);
    expect(findFields(parseManagedFields(obj), "nomatch")).toEqual([]);
  });
});

describe("agoText", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("is relative", () => {
    expect(agoText("2026-10-05T11:57:00Z", now)).toBe("3m ago");
    expect(agoText("2026-10-05T09:00:00Z", now)).toBe("3h ago");
    expect(agoText("2026-10-03T12:00:00Z", now)).toBe("2d ago");
    expect(agoText(null, now)).toBe("unknown time");
  });
});
