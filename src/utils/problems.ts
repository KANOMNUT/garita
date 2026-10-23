import type {
  CertExpiryFact, Finding, ProblemReport, ProblemRule, ProblemSeverity, ProblemSource, ResourceType, SkippedSource,
} from "../types/k8s";
import { expiryState, relativeFromIso } from "./expiry";
import { CLUSTER_SCOPED_KINDS } from "./scope";

/** Backend rules plus the two frontend-only certificate rules (A-4). */
export type UiRule = ProblemRule | "cert-expired" | "cert-expiring";
export type UiFinding = Omit<Finding, "rule"> & { rule: UiRule };

export const EVENTS_NOTE = "Kubernetes keeps events for about 1 hour. Older causes may not appear.";

export const RULE_LABEL: Record<UiRule, string> = {
  crashloop: "Crash loop",
  "oom-killed": "Out of memory",
  "image-pull": "Image pull failing",
  "init-failing": "Init container failing",
  unschedulable: "Can't be scheduled",
  "node-not-ready": "Node not ready",
  "workload-unavailable": "Workload unavailable",
  "job-failed": "Job failed",
  "service-no-endpoints": "Service has no ready endpoints",
  "pvc-pending": "Volume claim pending",
  "missing-probes": "No readiness probe",
  "cert-expired": "Certificate expired",
  "cert-expiring": "Certificate expiring",
};

/**
 * The one source-to-rules table (A-3, A-5). Keyed by the closed ProblemRule union, so a new
 * backend rule fails `tsc` here. For each kind a rule reports on it lists the sources the rule
 * needs for that kind (a skipped source means the rule did not run), so a forbidden
 * `daemonsets` list never marks a Deployment's card partial. `events` is evidence only and is
 * not listed: it blocks no rule. The explain card's covered kinds and relevant sources derive
 * from this table, so a new ResourceType gets no card until it is added here (fails safe).
 */
export const RULES: Record<ProblemRule, Partial<Record<ResourceType, ProblemSource[]>>> = {
  crashloop: { pods: ["pods"] },
  "oom-killed": { pods: ["pods"] },
  "image-pull": { pods: ["pods"] },
  "init-failing": { pods: ["pods"] },
  unschedulable: { pods: ["pods"] },
  "workload-unavailable": { deploy: ["deployments"], sts: ["statefulsets"], ds: ["daemonsets"] },
  "job-failed": { jobs: ["jobs"] },
  "service-no-endpoints": { svc: ["services", "endpointslices"] },
  "pvc-pending": { pvc: ["persistentvolumeclaims"] },
  "node-not-ready": { nodes: ["nodes"] },
  "missing-probes": { deploy: ["deployments"], sts: ["statefulsets"] },
};

const RULE_IDS = Object.keys(RULES) as ProblemRule[];
export const RULE_COUNT = RULE_IDS.length;

const KIND_NOUN: Partial<Record<ResourceType, string>> = {
  pods: "Pod", deploy: "Deployment", sts: "StatefulSet", ds: "DaemonSet", jobs: "Job", svc: "Service",
  pvc: "PVC", nodes: "Node", cert: "Certificate", sec: "Secret",
};
export const kindNoun = (kind: ResourceType): string => KIND_NOUN[kind] ?? kind;
const kindsOf = (r: ProblemRule) => Object.keys(RULES[r]) as ResourceType[];

/** Kinds that get an explain card and chip. Cluster-scoped kinds (nodes) are cluster-wide only: no card. */
export const COVERED_KINDS: ReadonlySet<string> = new Set(
  RULE_IDS.flatMap(kindsOf).filter((k) => !CLUSTER_SCOPED_KINDS.has(k)),
);

/** Kinds whose findings use event evidence, so a skipped events list weakens their card. */
const EVENT_EVIDENCE_KINDS: ReadonlySet<string> = new Set(["pods", "pvc"]);

/** Rule labels a skipped source stops. `events` stops none; certificates and secrets stop the cert rules. */
export function rulesBlockedBy(source: ProblemSource): UiRule[] {
  if (source === "certificates" || source === "secrets") return ["cert-expired", "cert-expiring"];
  return RULE_IDS.filter((r) => Object.values(RULES[r]).some((srcs) => srcs?.includes(source)));
}

// ─── Certificates (A-4): one expiry rule, expiryState; the sign of the delta picks the rule ──────

export function certFindings(facts: CertExpiryFact[]): UiFinding[] {
  const out: UiFinding[] = [];
  for (const f of facts) {
    if (expiryState(f.not_after, f.not_before ?? undefined).cls !== "text-bad") continue;
    const { label, deltaMs } = relativeFromIso(f.not_after);
    const expired = deltaMs !== null && deltaMs < 0;
    const rule: UiRule = expired ? "cert-expired" : "cert-expiring";
    const noun = f.kind === "sec" ? "TLS Secret" : "Certificate";
    const evidence: UiFinding["evidence"] = [
      { source: "field", path: "Not valid after", value: f.not_after, event_age: null },
    ];
    if (f.not_before) evidence.push({ source: "field", path: "Not valid before", value: f.not_before, event_age: null });
    out.push({
      id: `${rule}/${f.kind}/${f.namespace}/${f.name}`,
      rule,
      severity: expired ? "critical" : "warning",
      kind: f.kind,
      namespace: f.namespace,
      name: f.name,
      container: null,
      summary: `${noun} "${f.name}" ${expired ? "expired" : "expires"} ${label}.`,
      evidence,
    });
  }
  return out;
}

const SEVERITY_RANK: Record<ProblemSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function allFindings(report: ProblemReport): UiFinding[] {
  const merged: UiFinding[] = [...report.findings, ...certFindings(report.cert_expiry)];
  return merged.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.kind.localeCompare(b.kind) || a.namespace.localeCompare(b.namespace)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// ─── Page state (X2) ────────────────────────────────────────────────────────────────────────────

export type PageState = "no-access" | "nothing-partial" | "nothing" | "partial" | "list";

export function pageState(findingCount: number, skipped: SkippedSource[]): PageState {
  if (findingCount === 0) {
    if (skipped.some((s) => s.source === "pods")) return "no-access";
    return skipped.length > 0 ? "nothing-partial" : "nothing";
  }
  return skipped.length > 0 ? "partial" : "list";
}

/** "forbidden" / "unauthorized" from the verbatim backend reason, else a neutral word. */
export function reasonWord(reason: string): string {
  const r = reason.toLowerCase();
  if (r.startsWith("forbidden")) return "forbidden";
  if (r.startsWith("unauthorized")) return "unauthorized";
  return "error";
}

// ─── Counts, filter, search ─────────────────────────────────────────────────────────────────────

export function countsBySeverity(findings: UiFinding[]): Record<ProblemSeverity, number> {
  const c: Record<ProblemSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

export function countsByRule(findings: UiFinding[]): Partial<Record<UiRule, number>> {
  const c: Partial<Record<UiRule, number>> = {};
  for (const f of findings) c[f.rule] = (c[f.rule] ?? 0) + 1;
  return c;
}

export function matchesSearch(f: UiFinding, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return `${f.kind} ${f.namespace} ${f.name} ${f.summary}`.toLowerCase().includes(q);
}

export function filterFindings(
  findings: UiFinding[],
  opts: { severity: ProblemSeverity | null; rule: UiRule | null; search: string },
): UiFinding[] {
  return findings.filter((f) =>
    (!opts.severity || f.severity === opts.severity)
    && (!opts.rule || f.rule === opts.rule)
    && matchesSearch(f, opts.search));
}

/**
 * "Rules that need them didn't run." names the non-events skips only: events are evidence, they
 * block no rule. Skipped events add "Event evidence is missing."; events alone say only that.
 */
export function skipNote(skipped: SkippedSource[]): string {
  const rules = skipped.some((s) => s.source !== "events");
  const events = skipped.some((s) => s.source === "events");
  return [rules ? "Rules that need them didn't run." : "", events ? "Event evidence is missing." : ""].filter(Boolean).join(" ");
}

export function worstSeverity(findings: { severity: ProblemSeverity }[]): ProblemSeverity {
  return findings.some((f) => f.severity === "critical") ? "critical" : findings.some((f) => f.severity === "warning") ? "warning" : "info";
}

export const hasEventEvidence = (findings: UiFinding[]): boolean =>
  findings.some((f) => f.evidence.some((e) => e.source === "event"));

export function loadedAnnouncement(findings: UiFinding[]): string {
  const crit = countsBySeverity(findings).critical;
  const n = findings.length;
  return `Problems loaded. ${n} ${n === 1 ? "finding" : "findings"}, ${crit} critical.`;
}

// ─── Explain card (A-5) ─────────────────────────────────────────────────────────────────────────

export type CardModel =
  | { kind: "checking" }
  | { kind: "error"; message: string }
  /** A source this object's rules need was skipped and nothing was found. */
  | { kind: "unavailable"; skipped: SkippedSource[] }
  | { kind: "clear"; partial: ProblemSource[] }
  | { kind: "findings"; findings: UiFinding[]; partial: ProblemSource[] };

/** Skipped sources that matter for this kind: rule inputs plus `events` where the kind uses event evidence. */
export function relevantSkips(kind: ResourceType, skipped: SkippedSource[]): ProblemSource[] {
  const needed = new Set<ProblemSource>();
  for (const r of RULE_IDS) RULES[r][kind]?.forEach((s) => needed.add(s));
  if (EVENT_EVIDENCE_KINDS.has(kind)) needed.add("events");
  return skipped.map((s) => s.source).filter((s) => needed.has(s));
}

export function findingsForObject(findings: UiFinding[], kind: ResourceType, ns: string, name: string): UiFinding[] {
  return findings.filter((f) => f.kind === kind && f.namespace === ns && f.name === name);
}

/** null = the kind is not covered: show no card and no chip. */
export function cardModel(
  kind: ResourceType, ns: string, name: string,
  q: { report: ProblemReport | undefined; error: string | null },
): CardModel | null {
  if (!COVERED_KINDS.has(kind)) return null;
  if (!q.report) return q.error !== null ? { kind: "error", message: q.error } : { kind: "checking" };
  const mine = findingsForObject(allFindings(q.report), kind, ns, name);
  const partial = relevantSkips(kind, q.report.skipped);
  if (mine.length > 0) return { kind: "findings", findings: mine, partial };
  const blocked = q.report.skipped.filter((s) => s.source !== "events" && partial.includes(s.source));
  return blocked.length > 0 ? { kind: "unavailable", skipped: blocked } : { kind: "clear", partial };
}
