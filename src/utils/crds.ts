// CRDs page helpers (v2.4.1). Pure and React-free, so the node test environment covers them.
// F1: the read version, the CRD fields every custom resource command takes, why "Instances" is
// disabled, and the remembered "Group by API group" switch.

import type { CRD } from "../types/k8s";

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
