// CRDs page helpers (v2.4.1). Pure and React-free, so the node test environment covers them.
// The read version, the CRD fields every custom resource command takes, why "Instances" is disabled, the
// remembered "Group by API group" switch, and the strings and identity rule of the custom resource writes.

import type { CRD, CustomResourceSelection } from "../types/k8s";

/**
 * The version every read of a CRD's objects uses: `crd.read_version` (the storage version when it is
 * served, else the first served one), else the first served version in `versions` ("v1beta1, v1"),
 * so a build whose backend does not send `read_version` yet keeps working. "" for null or none.
 */
export function crdReadVersion(crd: Pick<CRD, "versions" | "read_version"> | null | undefined): string {
  if (!crd) return "";
  const own = crd.read_version?.trim() ?? "";
  if (own) return own;
  return crd.versions.split(",")[0].trim();
}

/** The CRD fields every custom resource command takes, flat (the same five as `list_crd_resources`). */
export function crdRef(crd: CRD): { group: string; version: string; kind: string; plural: string; scope: string } {
  return { group: crd.group, version: crdReadVersion(crd), kind: crd.kind, plural: crd.plural, scope: crd.scope };
}

export const CRD_NOT_ESTABLISHED_REASON = "This CRD is not established yet, so its objects can't be listed.";
export const CRD_NO_SERVED_VERSION_REASON = "No version of this CRD is served, so its objects can't be listed.";

/** Why "Instances" / "Show instances" is disabled, or undefined. Not established is checked first. */
export function crdInstancesReason(crd: Pick<CRD, "versions" | "read_version" | "established">): string | undefined {
  if (!crd.established) return CRD_NOT_ESTABLISHED_REASON;
  if (!crdReadVersion(crd)) return CRD_NO_SERVED_VERSION_REASON;
  return undefined;
}

const GROUPING_KEY = "crds-grouped";

/** `localStorage["crds-grouped"]` ("1" / "0"). On unless it says "0": the default, and what a blocked or throwing store reads. */
export function loadCrdGrouping(): boolean {
  try {
    return localStorage.getItem(GROUPING_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Remembers the switch on this computer. Returns false when the write failed (the switch still works for this session). */
export function saveCrdGrouping(on: boolean): boolean {
  try {
    localStorage.setItem(GROUPING_KEY, on ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

/** kubectl's noun for a CRD: "<plural>.<group>". Used by the delete confirm's kubectl equivalent (`deleteEquiv`). */
export function crdKubectlNoun(crd: Pick<CRD, "plural" | "group">): string {
  return `${crd.plural}.${crd.group}`;
}

/**
 * The reason a custom resource write is disabled after an explicit RBAC denial. `namespace` is "" for a
 * cluster-scoped object (and for a CRD that is cluster-scoped): the sentence then says "in this cluster".
 */
export function crDeniedReason(verb: "delete" | "update", plural: string, namespace: string): string {
  return `You don't have permission to ${verb} ${plural} ${namespace ? `in namespace ${namespace}` : "in this cluster"}.`;
}

/** Same CRD name, namespace and name: the identity of a custom resource (the CRD's name is `<plural>.<group>`, so unique per cluster). */
export function sameCustomResource(a: CustomResourceSelection, b: CustomResourceSelection): boolean {
  return a.crd.name === b.crd.name && a.item.namespace === b.item.namespace && a.item.name === b.item.name;
}
