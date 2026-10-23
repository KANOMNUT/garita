import type {
  LimitRangeInfo, PdbRow, PriorityClassInfo, ResourceQuotaInfo, ResourceType, WebhookConfigRow, WebhookMatch,
} from "../types/k8s";
import { isForbidden } from "./viewState";
import { PRODUCT_NAME } from "../brand";

/**
 * The kinds that get a Constraints section, each with the (group, plural) admission targets a
 * webhook rule must match (A-13). Typed over exactly these six: any other kind gets no section,
 * which fails safe (this is not one of the five per-kind tables).
 */
export const CONSTRAINT_TARGETS = {
  pods: [{ group: "", plural: "pods" }],
  deploy: [{ group: "apps", plural: "deployments" }, { group: "", plural: "pods" }],
  sts: [{ group: "apps", plural: "statefulsets" }, { group: "", plural: "pods" }],
  ds: [{ group: "apps", plural: "daemonsets" }, { group: "", plural: "pods" }],
  rs: [{ group: "apps", plural: "replicasets" }, { group: "", plural: "pods" }],
  jobs: [{ group: "batch", plural: "jobs" }, { group: "", plural: "pods" }],
} as const;
export type ConstraintKind = keyof typeof CONSTRAINT_TARGETS;
export const isConstraintKind = (k: string): k is ConstraintKind => k in CONSTRAINT_TARGETS;

/** What a constraint is evaluated against. For workloads labels and priority class come from the pod template. */
export interface ConstraintTarget {
  kind: ConstraintKind;
  namespace: string;
  labels: Readonly<Record<string, string>>;
  priorityClass: string | null;
}

export type Applicability = "applies" | "may-apply";
export type ConstraintGroup = "quota" | "limit-range" | "pdb" | "priority" | "webhook";
export interface ConstraintRow {
  group: ConstraintGroup;
  name: string;
  applicability: Applicability;
  /** One sentence or two, from facts the contract carries. Never claims a webhook "will" run. */
  detail: string;
  /** For the Open link. Cluster-scoped kinds have an empty namespace. */
  open: { kind: ResourceType; namespace: string };
}

// ─── Webhook match (A-13) ───────────────────────────────────────────────────────────────────────

/**
 * A rule matches a target (group, plural) when: api_groups has the group or the wildcard (core is
 * the empty string); resources has the plural, the wildcard or the wildcard-slash-wildcard form
 * (subresource-only rules such as pods/exec do not match); and scope is the wildcard or
 * "Namespaced". Operations do not filter.
 */
export function webhookMatches(m: WebhookMatch, group: string, plural: string): boolean {
  return (m.api_groups.includes(group) || m.api_groups.includes("*"))
    && (m.resources.includes(plural) || m.resources.includes("*") || m.resources.includes("*/*"))
    && (m.scope === "*" || m.scope === "Namespaced");
}

const OPERATION_ORDER = ["CREATE", "UPDATE", "DELETE", "CONNECT", "*"];
const byOperation = (a: string, b: string) => OPERATION_ORDER.indexOf(a) - OPERATION_ORDER.indexOf(b);
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");

export function webhookRows(configs: WebhookConfigRow[], target: ConstraintTarget, kind: "mwc" | "vwc"): ConstraintRow[] {
  const rows: ConstraintRow[] = [];
  for (const cfg of configs) {
    const hit: { plural: string; m: WebhookMatch }[] = [];
    for (const { group, plural } of CONSTRAINT_TARGETS[target.kind]) {
      for (const m of cfg.matches) if (webhookMatches(m, group, plural)) hit.push({ plural, m });
    }
    if (hit.length === 0) continue;
    const plurals = [...new Set(hit.map((h) => h.plural))];
    const ops = [...new Set(hit.flatMap((h) => h.m.operations))].sort(byOperation);
    const parts = [`May apply to ${andList(plurals)}${ops.length > 0 ? ` on ${ops.join(", ")}` : ""}.`];
    if (hit.some((h) => h.m.has_namespace_selector)) parts.push("Has a namespace selector.");
    if (hit.some((h) => h.m.has_object_selector)) parts.push("Has an object selector.");
    const policies = [...new Set(hit.map((h) => h.m.failure_policy))];
    if (policies.length === 1 && (policies[0] === "Fail" || policies[0] === "Ignore")) {
      parts.push(`If it is unreachable, requests are ${policies[0] === "Fail" ? "rejected" : "allowed"} (failure policy: ${policies[0]}).`);
    } else if (policies.length > 1) {
      parts.push(`Failure policy: ${policies.join(", ")}.`);
    }
    // A webhook is never "applies": it can filter at runtime.
    rows.push({ group: "webhook", name: cfg.name, applicability: "may-apply", detail: parts.join(" "), open: { kind, namespace: "" } });
  }
  return rows;
}

// ─── The four namespace / label groups ──────────────────────────────────────────────────────────

export function quotaRows(quotas: ResourceQuotaInfo[], t: ConstraintTarget): ConstraintRow[] {
  return quotas.filter((q) => q.namespace === t.namespace).map((q) => ({
    group: "quota", name: q.name, applicability: "applies",
    detail: `Applies to every pod in namespace ${t.namespace}.`, open: { kind: "rq", namespace: t.namespace },
  }));
}

export function limitRangeRows(ranges: LimitRangeInfo[], t: ConstraintTarget): ConstraintRow[] {
  return ranges.filter((l) => l.namespace === t.namespace).map((l) => ({
    group: "limit-range", name: l.name, applicability: "applies",
    detail: `Applies to every pod in namespace ${t.namespace}.`, open: { kind: "lr", namespace: t.namespace },
  }));
}

const labelList = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k}=${v}`).join(", ");

export function pdbRows(pdbs: PdbRow[], t: ConstraintTarget): ConstraintRow[] {
  const rows: ConstraintRow[] = [];
  for (const p of pdbs) {
    if (p.namespace !== t.namespace) continue;
    const wanted = Object.entries(p.match_labels);
    // Labels that are not a subset can never match, with or without expressions.
    if (!wanted.every(([k, v]) => t.labels[k] === v)) continue;
    const open = { kind: "pdb" as const, namespace: t.namespace };
    if (p.has_match_expressions) {
      rows.push({ group: "pdb", name: p.name, applicability: "may-apply", open,
        detail: `May apply. Uses label expressions, which ${PRODUCT_NAME} doesn't evaluate.` });
    } else if (wanted.length === 0) {
      // An empty selector reads the same whether it selects every pod or none: don't claim either.
      rows.push({ group: "pdb", name: p.name, applicability: "may-apply", open,
        detail: "May apply. Its selector has no labels." });
    } else {
      rows.push({ group: "pdb", name: p.name, applicability: "applies", open,
        detail: `Applies. Selects pods with ${labelList(p.match_labels)}.` });
    }
  }
  return rows;
}

/** The class named on the pod (template), else the cluster's global default. At most one row. */
export function priorityRows(classes: PriorityClassInfo[], t: ConstraintTarget): ConstraintRow[] {
  const open = { kind: "pc" as const, namespace: "" };
  const where = t.kind === "pods" ? "the pod" : "the pod template";
  if (t.priorityClass) {
    return [{ group: "priority", name: t.priorityClass, applicability: "applies", open, detail: `Applies. Set on ${where}.` }];
  }
  const def = classes.find((c) => c.global_default);
  return def ? [{ group: "priority", name: def.name, applicability: "applies", open, detail: "Applies. Cluster default class." }] : [];
}

// ─── Per-group state ────────────────────────────────────────────────────────────────────────────

export type GroupState = "loading" | "denied" | "error" | "none" | "rows";

/** One group's state from its own query. Rows win over a stale error; a 403 is "denied", never a generic error. */
export function groupState(isLoading: boolean, errorMessage: string | null, rowCount: number): GroupState {
  if (rowCount > 0) return "rows";
  if (isLoading) return "loading";
  if (errorMessage !== null) return isForbidden(errorMessage) ? "denied" : "error";
  return "none";
}
