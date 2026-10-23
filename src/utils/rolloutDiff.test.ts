import { describe, expect, it } from "vitest";
import { currentTemplate, diffFailedText, stripTemplateHash, templateDiff } from "./rolloutDiff";

const tpl = (image: string, hash?: string) => ({
  metadata: { labels: { app: "api", ...(hash ? { "pod-template-hash": hash } : {}) } },
  spec: { containers: [{ name: "api", image }] },
});

describe("rollout template diff", () => {
  it("strips pod-template-hash without mutating", () => {
    const t = tpl("a", "abc");
    expect((stripTemplateHash(t) as any).metadata.labels).toEqual({ app: "api" });
    expect(t.metadata.labels["pod-template-hash"]).toBe("abc");
  });
  it("reads the current template from a raw deployment, hash stripped", () => {
    expect((currentTemplate({ spec: { template: tpl("a", "h") } }) as any).metadata.labels).toEqual({ app: "api" });
    expect(currentTemplate({})).toBeNull();
  });
  it("ignores the hash on either side: same template = no differences", () => {
    expect(templateDiff(tpl("a", "h1"), tpl("a", "h2")).changed).toBe(0);
  });
  it("reports the image change as a replaced array with an Inside panel", () => {
    const r = templateDiff(tpl("v2"), tpl("v1"));
    const row = r.rows.find((x) => x.path === "spec.containers");
    expect(row?.state).toBe("replaced");
    expect(row?.inside?.find((x) => x.path === "[api] image")).toMatchObject({ from: "v2", to: "v1" });
  });
  it("words the failure", () => {
    expect(diffFailedText("boom")).toBe("Couldn't load the comparison: boom. You can still roll back.");
  });
});
