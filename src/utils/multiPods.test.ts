import { describe, expect, it } from "vitest";
import {
  capNotice, facetOptions, hasZoneLabels, narrowActive, narrowPhrase, narrowPods, noPodsMatchText, placePods,
  podsButtonLabel, selectStreamingPods, zoneOf, type PlacedPod,
} from "./multiPods";

const pod = (name: string, node: string, extra: Partial<PlacedPod> = {}): PlacedPod => ({
  name, node, status: "Running", ready: "1/1", restarts: 0, ...extra,
});
const nodes = [
  { name: "n1", labels: { "topology.kubernetes.io/zone": "eu-1a" } },
  { name: "n2", labels: { "failure-domain.beta.kubernetes.io/zone": "eu-1b" } },
  { name: "n3", labels: {} },
];

describe("zoneOf", () => {
  it("prefers the GA label and falls back to the beta one", () => {
    expect(zoneOf({ "topology.kubernetes.io/zone": "a", "failure-domain.beta.kubernetes.io/zone": "b" })).toBe("a");
    expect(zoneOf({ "failure-domain.beta.kubernetes.io/zone": "b" })).toBe("b");
    expect(zoneOf({})).toBeNull();
    expect(zoneOf(undefined)).toBeNull();
  });
});

describe("placement and narrowing", () => {
  const pods = [pod("p1", "n1"), pod("p2", "n2"), pod("p3", "n3"), pod("p4", "gone"), pod("p5", "—"), pod("p6", "n1")];
  const placement = placePods(pods, nodes);

  it("puts pods with no node, an unlisted node or an unlabelled node under unknown", () => {
    expect(placement.get("p3")).toEqual({ node: "n3", zone: "unknown" });
    expect(placement.get("p4")).toEqual({ node: "gone", zone: "unknown" });
    expect(placement.get("p5")).toEqual({ node: "unknown", zone: "unknown" });
  });
  it("lists values with counts, unknown last, and omits empty values", () => {
    expect(facetOptions(pods, placement, "zone")).toEqual([
      { value: "eu-1a", count: 2 }, { value: "eu-1b", count: 1 }, { value: "unknown", count: 3 },
    ]);
  });
  it("narrows by node, zone, both (AND) and neither", () => {
    expect(narrowPods(pods, placement, { node: null, zone: null })).toHaveLength(6);
    expect(narrowPods(pods, placement, { node: null, zone: "eu-1a" }).map((p) => p.name)).toEqual(["p1", "p6"]);
    expect(narrowPods(pods, placement, { node: "n1", zone: "eu-1b" })).toEqual([]);
    expect(narrowPods(pods, placement, { node: null, zone: "unknown" }).map((p) => p.name)).toEqual(["p3", "p4", "p5"]);
  });
  it("hides the Zone menu when no pod has a zone", () => {
    expect(hasZoneLabels(pods, placement)).toBe(true);
    const bare = [pod("a", "n3"), pod("b", "x")];
    expect(hasZoneLabels(bare, placePods(bare, nodes))).toBe(false);
  });
});

describe("selectStreamingPods: narrow, then order, then cap", () => {
  const many = Array.from({ length: 45 }, (_, i) => pod(`web-${String(i).padStart(2, "0")}`, i < 31 ? "n1" : "n2"));
  const placement = placePods(many, nodes);

  it("caps at 20 after narrowing, and reports the matching count", () => {
    const none = selectStreamingPods(many, placement, { node: null, zone: null });
    expect(none.matching).toHaveLength(45);
    expect(none.active).toHaveLength(20);
    const zoned = selectStreamingPods(many, placement, { node: null, zone: "eu-1a" });
    expect(zoned.matching).toHaveLength(31);
    expect(zoned.active).toHaveLength(20);
    const small = selectStreamingPods(many, placement, { node: null, zone: "eu-1b" });
    expect(small.matching).toHaveLength(14);
    expect(small.active).toHaveLength(14);
  });
  it("streams not-ready and restarted pods first", () => {
    const sick = [...many.slice(0, 25), pod("web-zz-sick", "n1", { restarts: 3 })];
    const r = selectStreamingPods(sick, placePods(sick, nodes), { node: null, zone: null });
    expect(r.active[0].name).toBe("web-zz-sick");
  });
  it("can match zero pods", () => {
    expect(selectStreamingPods(many, placement, { node: "nope", zone: null }).active).toEqual([]);
  });
});

describe("copy", () => {
  it("cap notice: the two cases, and none under the cap", () => {
    expect(capNotice(45, 45, false)).toBe(
      "Streaming 20 of 45 pods. Narrow by node or zone to choose which. Pods that aren't ready or have restarted are tailed first.",
    );
    expect(capNotice(45, 31, true)).toBe("Streaming 20 of 31 matching pods. Narrow further to see the rest.");
    expect(capNotice(45, 14, true)).toBeNull();
    expect(capNotice(12, 12, false)).toBeNull();
  });
  it("Pods button label", () => {
    expect(podsButtonLabel(12, 12, { node: null, zone: null })).toBe("Pods: 12");
    expect(podsButtonLabel(14, 45, { node: null, zone: "eu-west-1a" })).toBe("Pods: 14 of 45 · zone eu-west-1a");
    expect(podsButtonLabel(2, 45, { node: "w3", zone: "a" })).toBe("Pods: 2 of 45 · node w3 · zone a");
  });
  it("zero-match text and narrowActive", () => {
    expect(noPodsMatchText({ node: "w3", zone: "a" })).toBe("No pods match node w3 · zone a.");
    expect(narrowPhrase({ node: null, zone: null })).toBe("");
    expect(narrowActive({ node: null, zone: null })).toBe(false);
    expect(narrowActive({ node: "x", zone: null })).toBe(true);
  });
});
