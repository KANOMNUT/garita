import { describe, expect, it } from "vitest";
import { nodeInstanceType, nodePool, nodeZone } from "./nodeLabels";

describe("nodeLabels", () => {
  it("pool follows the precedence and reports the key", () => {
    expect(nodePool({ "eks.amazonaws.com/nodegroup": "sys", "karpenter.sh/nodepool": "k" }))
      .toEqual({ value: "sys", key: "eks.amazonaws.com/nodegroup" });
    expect(nodePool({ "cloud.google.com/gke-nodepool": "g", "eks.amazonaws.com/nodegroup": "e" })?.value).toBe("g");
    expect(nodePool({ "karpenter.sh/provisioner-name": "old" })?.value).toBe("old");
  });
  it("zone reuses the shared precedence, with the legacy label as fallback", () => {
    expect(nodeZone({ "topology.kubernetes.io/zone": "a", "failure-domain.beta.kubernetes.io/zone": "b" }))
      .toEqual({ value: "a", key: "topology.kubernetes.io/zone" });
    expect(nodeZone({ "failure-domain.beta.kubernetes.io/zone": "b" }))
      .toEqual({ value: "b", key: "failure-domain.beta.kubernetes.io/zone" });
  });
  it("instance type falls back to the beta label", () => {
    expect(nodeInstanceType({ "beta.kubernetes.io/instance-type": "m5" })?.value).toBe("m5");
    expect(nodeInstanceType({ "node.kubernetes.io/instance-type": "c6", "beta.kubernetes.io/instance-type": "m5" })?.value).toBe("c6");
  });
  it("missing or empty labels are null", () => {
    expect(nodePool({})).toBeNull();
    expect(nodePool(undefined)).toBeNull();
    expect(nodeZone({ "topology.kubernetes.io/zone": "" })).toBeNull();
    expect(nodeInstanceType({ unrelated: "x" })).toBeNull();
  });
});
