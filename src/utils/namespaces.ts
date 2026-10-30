// Pure helpers for the Namespaces page and the namespace picker (docs/ux/24 Part B).
// React-free so they are tested without a DOM (namespaces.test.ts).
import { PRODUCT_NAME } from "../brand";
import type { NamespaceRow } from "../types/k8s";
import { pickDisabledReason } from "./guardrails";

/**
 * Delete is offered disabled, with a reason, for these. The first three are the Sidebar's old set;
 * `kube-node-lease` joined on the user's decision (2026-10-28). The control is never hidden.
 */
export const PROTECTED_NAMESPACES: ReadonlySet<string> = new Set([
  "default", "kube-system", "kube-public", "kube-node-lease",
]);

export const PROTECTED_NAMESPACE_REASON = `Built-in namespace. Deleting it can break the cluster, so ${PRODUCT_NAME} doesn't offer it.`;
export const TERMINATING_NAMESPACE_REASON = "This namespace is already being deleted.";
export const NAMESPACE_DELETE_RBAC_REASON = "You don't have permission to delete namespaces on this cluster.";

/** The label Kubernetes puts on every namespace; it equals the name, so the Labels column leaves it out. */
const METADATA_NAME_LABEL = "kubernetes.io/metadata.name";

/** A namespace that is being deleted: the phase says so, or a deletion time is set. */
export function isTerminating(row: Pick<NamespaceRow, "phase" | "deletion_timestamp">): boolean {
  return row.phase === "Terminating" || row.deletion_timestamp !== null;
}

/**
 * Why delete is disabled for this row, or undefined when it is allowed. DISABLE-PRECEDENCE order
 * (`pickDisabledReason`): read-only, then an explicit RBAC denial, then the protected set, then
 * "already being deleted". One reason, never several.
 */
export function namespaceDeleteReason(
  row: NamespaceRow,
  i: { readOnly: boolean; canDelete: boolean },
): string | undefined {
  return pickDisabledReason({
    readOnly: i.readOnly,
    rbac: i.canDelete ? undefined : NAMESPACE_DELETE_RBAC_REASON,
    capability: PROTECTED_NAMESPACES.has(row.name) ? PROTECTED_NAMESPACE_REASON : undefined,
    finished: isTerminating(row) ? TERMINATING_NAMESPACE_REASON : undefined,
  });
}

/**
 * Rows the picker lists, in order:
 * 1. "all", only while the trimmed query is empty;
 * 2. `selected`, when it is not "all" and not in `names` (set by the launcher, a list that failed, or a
 *    namespace that was just deleted), and it contains the query;
 * 3. `names`, in the given order, that contain the trimmed query, ignoring case.
 * No duplicates.
 */
export function namespaceRows(names: readonly string[], selected: string, query: string): string[] {
  const q = query.trim().toLowerCase();
  const matches = (n: string) => n.toLowerCase().includes(q);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  };
  if (q === "") add("all");
  if (selected !== "all" && !names.includes(selected) && matches(selected)) add(selected);
  for (const n of names) if (matches(n)) add(n);
  return out;
}

/** The `select` of `useNamespaces` and the launcher check: names out of the one rows query. Module scope, so it is stable. */
export function namespaceNames(rows: readonly NamespaceRow[]): string[] {
  return rows.map((r) => r.name);
}

/** Label chips for the table: every label except `kubernetes.io/metadata.name`, in the given key order. */
export function chipLabels(labels: Record<string, string>): [string, string][] {
  return Object.entries(labels).filter(([k]) => k !== METADATA_NAME_LABEL);
}

/**
 * "45s" | "3m" | "2h" | "5d": the time since an RFC 3339 deletion time, truncated to its largest unit.
 * null for null or a time that does not parse. A time in the future (clock skew) reads "0s".
 */
export function deletingFor(deletionTimestamp: string | null, now: number = Date.now()): string | null {
  if (deletionTimestamp === null) return null;
  const t = Date.parse(deletionTimestamp);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
