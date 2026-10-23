// #9 rollout-history template diff (docs/ux/03 §7). Left = the CURRENT pod template,
// right = revision #N: the direction of the rollback. Pure.
import { diffObjects, type DiffResult } from "./diffRows";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Removes `pod-template-hash` (it differs by construction) from template.metadata.labels. Non-mutating. */
export function stripTemplateHash(template: unknown): unknown {
  if (!isObj(template)) return template;
  const meta = template.metadata;
  if (!isObj(meta) || !isObj(meta.labels) || !("pod-template-hash" in meta.labels)) return template;
  const { "pod-template-hash": _drop, ...labels } = meta.labels;
  return { ...template, metadata: { ...meta, labels } };
}

/** spec.template of a raw Deployment, hash-stripped; null when absent. */
export function currentTemplate(deployment: unknown): unknown {
  if (!isObj(deployment) || !isObj(deployment.spec)) return null;
  const t = deployment.spec.template;
  return t === undefined ? null : stripTemplateHash(t);
}

export function templateDiff(current: unknown, revision: unknown): DiffResult {
  return diffObjects(stripTemplateHash(current ?? {}), stripTemplateHash(revision ?? {}), {
    ignore: ["metadata.creationTimestamp"],
    emptyEqualsAbsent: true,
  });
}

export const ROLLBACK_CONSEQUENCE =
  "Restores the pod template from this revision and rolls the pods. Replicas, strategy and other fields stay as they are.";
export const NO_ROLLOUT_DIFF = "Revision has the same pod template as the current one.";
export function noDiffSecondary(revision: number): string {
  return `Revision #${revision} has the same pod template as the current one.`;
}
export function diffFailedText(message: string): string {
  return `Couldn't load the comparison: ${message}. You can still roll back.`;
}
