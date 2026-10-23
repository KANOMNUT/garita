// #31 Journal (v1.4.1 B-8, B-9, P18): pure helpers. Verbs are shown verbatim; kinds come in three
// spellings (ResourceType ids, singular nouns, PascalCase API kinds) and are labelled, never rewritten.
import type { JournalEntry, ResourceType } from "../types/k8s";
import { KIND_TO_RESOURCE_TYPE, RESOURCE_LABELS } from "./kindToResourceType";

const KIND_ALIAS: Record<string, keyof typeof RESOURCE_LABELS> = {
  pod: "pods", node: "nodes", cronjob: "cron", service: "svc", helmrelease: "helm",
  deployment: "deploy", statefulset: "sts", daemonset: "ds", application: "argocd",
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The ResourceType a journal kind (any of the three spellings) stands for, or null for an unknown kind. */
export function journalResourceType(kind: string): ResourceType | null {
  if (has(KIND_TO_RESOURCE_TYPE, kind)) return KIND_TO_RESOURCE_TYPE[kind];
  if (has(KIND_ALIAS, kind)) return KIND_ALIAS[kind] as ResourceType;
  if (has(RESOURCE_LABELS, kind)) return kind as ResourceType;
  return null;
}

/** Display label for a journal kind. An unknown kind is shown verbatim. */
export function journalKind(kind: string): string {
  const t = journalResourceType(kind);
  return t ? RESOURCE_LABELS[t] : kind;
}

export type ResultFilter = "all" | "ok" | "error";
export interface JournalFilters { context: string; kind: string; result: ResultFilter; search: string }
export const NO_FILTERS: JournalFilters = { context: "", kind: "", result: "all", search: "" };

/** "" / "all" mean no filter. The search covers the loaded entries only. */
export function filterJournal(entries: JournalEntry[], f: JournalFilters): JournalEntry[] {
  const q = f.search.trim().toLowerCase();
  return entries.filter((e) =>
    (!f.context || e.context === f.context) &&
    (!f.kind || journalKind(e.kind) === f.kind) &&
    (f.result === "all" || e.result === f.result) &&
    (!q || [e.verb, journalKind(e.kind), e.kind, e.namespace, e.name, e.summary, e.context].join(" ").toLowerCase().includes(q)),
  );
}

/** Distinct values for the Cluster and Kind selects, sorted. */
export function journalOptions(entries: JournalEntry[]): { contexts: string[]; kinds: string[] } {
  return {
    contexts: [...new Set(entries.map((e) => e.context).filter(Boolean))].sort(),
    kinds: [...new Set(entries.map((e) => journalKind(e.kind)))].sort(),
  };
}

export const isFiltered = (f: JournalFilters) => !!(f.context || f.kind || f.result !== "all" || f.search.trim());

export function relativeTime(ts: string, now: number = Date.now()): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const RESULT_WORD = { ok: "Accepted", error: "Failed" } as const;
export const ACCEPTED_TIP = "Accepted means the API server returned success. It doesn't mean the change has finished taking effect.";
