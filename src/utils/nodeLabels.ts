import { ZONE_LABELS, zoneOf } from "./multiPods";

export const POOL_LABELS = [
  "cloud.google.com/gke-nodepool",
  "eks.amazonaws.com/nodegroup",
  "kubernetes.azure.com/agentpool",
  "karpenter.sh/nodepool",
  "karpenter.sh/provisioner-name",
] as const;
export const INSTANCE_TYPE_LABELS = ["node.kubernetes.io/instance-type", "beta.kubernetes.io/instance-type"] as const;

type Labels = Readonly<Record<string, string | undefined>> | undefined;
/** The value and the label key it came from (for the cell tooltip). null = no such label. */
export interface LabelHit { value: string; key: string }

function firstLabel(labels: Labels, keys: readonly string[]): LabelHit | null {
  for (const key of keys) {
    const value = labels?.[key];
    if (value) return { value, key };
  }
  return null;
}

export const nodePool = (labels: Labels): LabelHit | null => firstLabel(labels, POOL_LABELS);
export const nodeInstanceType = (labels: Labels): LabelHit | null => firstLabel(labels, INSTANCE_TYPE_LABELS);

/** Zone precedence lives in multiPods (ZONE_LABELS / zoneOf); this only adds the source key. */
export function nodeZone(labels: Labels): LabelHit | null {
  const value = zoneOf(labels);
  return value ? { value, key: ZONE_LABELS.find((k) => labels?.[k] === value) ?? ZONE_LABELS[0] } : null;
}
