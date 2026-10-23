// Node / zone narrowing and show-hide for the multi-pod log tail (docs/impl/v1.3.1-tasks.md
// F2; 02 §3.7; D-L1; Q-L5; §0.3 UXP-7/8). Pure and React-free.
//
// Narrowing is a SOURCE control: it changes which pods stream (and reloads). The 20-pod cap
// applies AFTER it. A pod whose node is missing, or whose node carries no zone label, goes
// under "unknown" — a missing label is never silently a match or a non-match.

import { MAX_STREAM_PODS, orderPodsForStreaming } from "./logSource";

export const UNKNOWN = "unknown";
export const ZONE_LABELS = ["topology.kubernetes.io/zone", "failure-domain.beta.kubernetes.io/zone"] as const;

export interface PlacedPod {
  name: string;
  status: string;
  ready: string;
  restarts: number;
  node: string;
}

export interface Placement { node: string; zone: string }

export function zoneOf(labels: Readonly<Record<string, string | undefined>> | undefined): string | null {
  if (!labels) return null;
  for (const k of ZONE_LABELS) {
    const v = labels[k];
    if (v) return v;
  }
  return null;
}

/** pod.node, or "unknown" when absent ("" or the "—" placeholder). */
export function nodeOf(pod: { node: string }): string {
  const n = (pod.node ?? "").trim();
  return n === "" || n === "—" ? UNKNOWN : n;
}

export function placePods(
  pods: readonly PlacedPod[], nodes: readonly { name: string; labels?: Record<string, string | undefined> }[],
): Map<string, Placement> {
  const byNode = new Map(nodes.map((n) => [n.name, n.labels]));
  const out = new Map<string, Placement>();
  for (const p of pods) {
    const node = nodeOf(p);
    out.set(p.name, { node, zone: zoneOf(byNode.get(node)) ?? UNKNOWN });
  }
  return out;
}

export interface NarrowSpec { node: string | null; zone: string | null }

export function narrowPods<T extends PlacedPod>(pods: readonly T[], placement: Map<string, Placement>, n: NarrowSpec): T[] {
  return pods.filter((p) => {
    const pl = placement.get(p.name);
    if (n.node !== null && pl?.node !== n.node) return false;
    if (n.zone !== null && pl?.zone !== n.zone) return false;
    return true;
  });
}

export interface FacetOption { value: string; count: number }

/** Values with pod counts ("eu-west-1a (14)"). A value with 0 pods is not listed. "unknown" sorts last. */
export function facetOptions(pods: readonly PlacedPod[], placement: Map<string, Placement>, key: "node" | "zone"): FacetOption[] {
  const counts = new Map<string, number>();
  for (const p of pods) {
    const v = placement.get(p.name)?.[key] ?? UNKNOWN;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (a.value === UNKNOWN ? 1 : b.value === UNKNOWN ? -1 : a.value.localeCompare(b.value)));
}

/** When NO pod has a zone, the Zone menu is not rendered ("This cluster has no zone labels."). */
export function hasZoneLabels(pods: readonly PlacedPod[], placement: Map<string, Placement>): boolean {
  return pods.some((p) => (placement.get(p.name)?.zone ?? UNKNOWN) !== UNKNOWN);
}

/** Narrow, THEN order (D-L7), THEN cap. */
export function selectStreamingPods<T extends PlacedPod>(
  pods: readonly T[], placement: Map<string, Placement>, n: NarrowSpec,
): { matching: T[]; active: T[] } {
  const matching = narrowPods(pods, placement, n);
  return { matching, active: orderPodsForStreaming(matching).slice(0, MAX_STREAM_PODS) };
}

export function narrowActive(n: NarrowSpec): boolean {
  return n.node !== null || n.zone !== null;
}

/** "node worker-3 · zone eu-west-1a" — shared by the Pods button and the zero-match state. */
export function narrowPhrase(n: NarrowSpec): string {
  const parts: string[] = [];
  if (n.node !== null) parts.push(`node ${n.node}`);
  if (n.zone !== null) parts.push(`zone ${n.zone}`);
  return parts.join(" · ");
}

/** The cap notice under the Source row; null when every matching pod streams. */
export function capNotice(total: number, matching: number, narrowed: boolean): string | null {
  if (matching <= MAX_STREAM_PODS) return null;
  if (!narrowed) {
    return `Streaming ${MAX_STREAM_PODS} of ${total} pods. Narrow by node or zone to choose which. Pods that aren't ready or have restarted are tailed first.`;
  }
  return `Streaming ${MAX_STREAM_PODS} of ${matching} matching pods. Narrow further to see the rest.`;
}

/** The Pods button: "Pods: 12", or "Pods: 14 of 45 · zone eu-west-1a" while narrowed. */
export function podsButtonLabel(streaming: number, total: number, n: NarrowSpec): string {
  if (!narrowActive(n)) return `Pods: ${streaming}`;
  return `Pods: ${streaming} of ${total} · ${narrowPhrase(n)}`;
}

export function noPodsMatchText(n: NarrowSpec): string {
  return `No pods match ${narrowPhrase(n)}.`;
}
