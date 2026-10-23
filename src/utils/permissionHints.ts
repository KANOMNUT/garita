// SSAR hints for SUBRESOURCES (docs/impl/v1.3.1-tasks.md C-7). Pure: builds the
// batched can_i checks and reads the results back.
//
// `usePermissions` is keyed by ResourceType and has no subresource, so these go through the
// dedicated useAccessChecks hook. Every reader here FAILS OPEN: only an explicit
// `allowed: false` counts as denied; a missing result, an error or no data is "unknown",
// never "denied". A hint, not a guarantee — the real error still surfaces on the action.
import type { AccessCheck, AccessResult, DrainPreview } from "../types/k8s";

/** One `create pods/eviction` check per distinct namespace among the pods a drain will evict. */
export function evictionChecks(preview: DrainPreview | null | undefined): AccessCheck[] {
  if (!preview) return [];
  const namespaces = [...new Set(preview.pods.filter((p) => p.category === "evict").map((p) => p.namespace))].sort();
  return namespaces.map((namespace) => ({
    group: "",
    resource: "pods",
    subresource: "eviction",
    verb: "create",
    namespace,
  }));
}

/** `update pods/ephemeralcontainers` in the pod's OWN namespace (never "all"). */
export function ephemeralContainerCheck(namespace: string): AccessCheck[] {
  if (!namespace) return [];
  return [{ group: "", resource: "pods", subresource: "ephemeralcontainers", verb: "update", namespace }];
}

/** `get secrets` in the Secret's OWN namespace: gates Reveal (#33, B-7). Fails open like the rest. */
export function secretGetCheck(namespace: string): AccessCheck[] {
  if (!namespace) return [];
  return [{ group: "", resource: "secrets", verb: "get", namespace }];
}

/** Namespaces whose check came back with an explicit deny. Results are in input order. */
export function deniedNamespaces(checks: AccessCheck[], results: AccessResult[] | undefined): string[] {
  if (!results) return [];
  const out: string[] = [];
  checks.forEach((c, i) => {
    if (results[i]?.allowed === false) out.push(c.namespace);
  });
  return out;
}

export function evictionDeniedLine(namespaces: string[]): string {
  return `Your account can't evict pods in ${namespaces.join(", ")}. Those evictions will fail.`;
}
