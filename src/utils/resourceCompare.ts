// #8 resource diff helpers (docs/ux/03 §6; brief §1.4 item 6). Pure.
import { COMPARE_IGNORED } from "./diffRows";

/**
 * Kinds NOT offered: pods (D3-12: noise from status, node, IPs), helm (no object to diff),
 * argo-appsets / argo-projects (gvk_for cannot reach them: their version comes from runtime
 * discovery), and the views that have no detail panel.
 */
const EXCLUDED = new Set(["pods", "helm", "argo-appsets", "argo-projects", "argo-repos", "crd-instances"]);

export function canCompare(kind: string): boolean {
  return !EXCLUDED.has(kind);
}

/** The ignore list is closed; the only toggle is status. */
export function compareIgnore(includeStatus: boolean): readonly string[] {
  return includeStatus ? COMPARE_IGNORED.filter((p) => p !== "status") : COMPARE_IGNORED;
}

export const IGNORED_NOTE =
  "Ignored in the comparison: status, managed fields, uid, resourceVersion, generation, creation time, name and namespace.";

export type ReadClass = "no-access" | "not-installed" | "not-found" | "unreachable" | "error";

/** Classifies the plain-string rejection of a read of the OTHER side. Order matters. */
export function classifyReadError(message: string): ReadClass {
  const m = message.toLowerCase();
  if (/forbidden|unauthorized|permission denied/.test(m)) return "no-access";
  if (m.includes("requested resource") || m.includes("no matches for kind")) return "not-installed";
  if (/\bnot found\b|notfound|\b404\b/.test(m)) return "not-found";
  if (/failed to connect|connection|timed out|timeout|dns|unreachable|refused|tls|certificate|auth/.test(m)) return "unreachable";
  return "error";
}

export function sameApiServer(a: { server?: string } | undefined, b: { server?: string } | undefined): boolean {
  return !!a?.server && !!b?.server && a.server === b.server;
}

export function sameApiServerLine(a: string, b: string): string {
  return `${a} and ${b} use the same API server. You are comparing an object with itself.`;
}

export function notFoundText(kind: string, name: string, cluster: string, namespace: string): string {
  return `${kind} "${name}" doesn't exist in ${cluster}${namespace ? ` / ${namespace}` : ""}.`;
}
