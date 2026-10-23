// #19 Deprecated APIs (v1.4.1 B-12, B-14, 07 P9/P11). Pure helpers for the Health page.
// The status word comes from `served_by_this_server`, never from version arithmetic.
import type { DeprecatedApiFinding, ResourceType, SkippedSource } from "../types/k8s";
import { KIND_TO_RESOURCE_TYPE } from "./kindToResourceType";
import { reasonWord } from "./problems";

/** Closed source ids of scan_deprecated_apis's `skipped` (B-12). */
export type DeprecationSource = "helm-releases" | "last-applied";

export type DeprecationStatus = "removed" | "deprecated" | "deprecated-no-removal";

export function statusOf(f: DeprecatedApiFinding): DeprecationStatus {
  if (!f.served_by_this_server) return "removed";
  return f.removed_in ? "deprecated" : "deprecated-no-removal";
}
export const STATUS_WORD: Record<DeprecationStatus, string> = { removed: "Removed", deprecated: "Deprecated", "deprecated-no-removal": "Deprecated" };
/** Cards: "Removed" and "Deprecated" (the no-removal variant counts as Deprecated). */
export const cardOf = (f: DeprecatedApiFinding): "removed" | "deprecated" => (statusOf(f) === "removed" ? "removed" : "deprecated");

export function parseMinor(v: string): { major: number; minor: number } | null {
  const m = /^v?(\d+)\.(\d+)/.exec(v.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}
export const minorText = (m: { major: number; minor: number }) => `${m.major}.${m.minor}`;

/** True only when both versions parse and the cluster is above the table. Unparseable = false (note suppressed). */
export function clusterNewerThanTable(serverVersion: string, coversUpTo: string): boolean {
  const s = parseMinor(serverVersion);
  const t = parseMinor(coversUpTo);
  return !!s && !!t && (s.major > t.major || (s.major === t.major && s.minor > t.minor));
}

export function headerLine(serverVersion: string, coversUpTo: string, count: number | null): string {
  const s = parseMinor(serverVersion);
  const parts = [
    s ? `Cluster runs Kubernetes ${minorText(s)}` : "Couldn't read this cluster's Kubernetes version.",
    `Table covers Kubernetes up to ${coversUpTo}`,
  ];
  if (count !== null) parts.push(`${count} found`);
  return parts.join(" · ");
}

export function newerNote(serverVersion: string, coversUpTo: string): string {
  const s = parseMinor(serverVersion);
  return `This cluster runs Kubernetes ${s ? minorText(s) : serverVersion}. The table covers up to ${coversUpTo}, so APIs removed after ${coversUpTo} won't be reported. Fewer findings here is not a clean result.`;
}

export const SCOPE_SENTENCE = "Checks Helm release manifests and kubectl last-applied annotations only. It doesn't scan live objects or files in git.";

export const findingKey = (f: DeprecatedApiFinding) =>
  [f.source, f.helm_release_namespace ?? "", f.helm_release ?? "", f.api_version, f.kind, f.namespace, f.name].join("|");

export const apiLine = (f: DeprecatedApiFinding) => `${f.api_version} ${f.kind}`;

/** " in Helm release shop/web" / " in kubectl last-applied annotation (shop)". */
export function whereSuffix(f: DeprecatedApiFinding): string {
  if (f.source === "helm") {
    const rel = f.helm_release ? `${f.helm_release_namespace ? `${f.helm_release_namespace}/` : ""}${f.helm_release}` : "";
    return ` in Helm release ${rel}`.trimEnd();
  }
  return ` in kubectl last-applied annotation${f.namespace ? ` (${f.namespace})` : ""}`;
}
export const whereLine = (f: DeprecatedApiFinding) => `${f.name}${whereSuffix(f)}`;

export function summaryLine(f: DeprecatedApiFinding): string {
  const dep = `Deprecated in ${f.deprecated_in}`;
  if (!f.removed_in) return `${dep}. No removal is planned.${f.replacement ? ` Use ${f.replacement}.` : ""}`;
  return `${dep}, removed in ${f.removed_in}.${f.replacement ? ` Use ${f.replacement}.` : ""}`;
}

export function evidenceLines(f: DeprecatedApiFinding): string[] {
  const lines = [f.source === "helm" ? "Source: Helm release manifest" : "Source: kubectl last-applied-configuration annotation"];
  lines.push(f.served_by_this_server ? `This cluster still serves ${f.api_version}.` : `This cluster no longer serves ${f.api_version}.`);
  if (f.source === "last-applied" && !f.served_by_this_server) {
    lines.push("The annotation records an old apiVersion, so the next apply of that manifest fails. The live object itself is not broken.");
  }
  return lines;
}

/**
 * Open target (P9): a Helm finding opens the release (the live object may not exist); a last-applied finding opens
 * the object when its API kind maps to a ResourceType, else there is no Open.
 */
export function openTarget(f: DeprecatedApiFinding): { kind: ResourceType; namespace: string; name: string } | null {
  if (f.source === "helm") return f.helm_release ? { kind: "helm", namespace: f.helm_release_namespace ?? "", name: f.helm_release } : null;
  const kind = Object.prototype.hasOwnProperty.call(KIND_TO_RESOURCE_TYPE, f.kind) ? KIND_TO_RESOURCE_TYPE[f.kind] : undefined;
  return kind ? { kind, namespace: f.namespace, name: f.name } : null;
}

/** Reasons are `<ns>/<release>: <err>` or `<plural>.<group>: <err>`; the word comes from the error after the prefix. */
const word = (reason: string) => {
  const w = reasonWord(reason);
  return w !== "error" ? w : reasonWord(reason.replace(/^[^:]*:\s*/, ""));
};

export type DeprecationState = "nothing-partial" | "nothing" | "partial" | "list";

/**
 * Zero findings with any skip is "nothing-partial": a view-only account is denied Helm release Secrets and some
 * kinds but may still have read others, so "no access" would overstate it.
 */
export function deprecationState(count: number, skipped: SkippedSource<DeprecationSource>[]): DeprecationState {
  if (count === 0) return skipped.length > 0 ? "nothing-partial" : "nothing";
  return skipped.length > 0 ? "partial" : "list";
}

/** Strip sentence per skipped source family. */
export function partialLine(skipped: SkippedSource<DeprecationSource>[]): string {
  const helm = skipped.filter((s) => s.source === "helm-releases");
  const la = skipped.filter((s) => s.source === "last-applied");
  const parts: string[] = [];
  if (helm.length) parts.push(`Couldn't read Helm release Secrets (${word(helm[0].reason)}).${la.length ? "" : " Only kubectl last-applied annotations were checked."}`);
  if (la.length) parts.push(`Couldn't read last-applied annotations for ${la.length} ${la.length === 1 ? "kind" : "kinds"} (${word(la[0].reason)}).`);
  return parts.join(" ");
}

export const loadedLine = (n: number) => `Deprecated APIs loaded. ${n} found.`;
