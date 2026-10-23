import type { ArgoCdHistoryEntry, HelmRevision, JournalEntry, K8sEvent, ResourceType, RevisionInfo } from "../types/k8s";
import { journalResourceType, RESULT_WORD } from "./journal";

// #17 change timeline (docs/impl/v2.2.0-tasks.md FZ5, O3, O8, O9). Pure merge of the sources a panel already reads.

export type TimelineSource = "event" | "rollout" | "helm" | "argocd" | "journal";
export type TimelineSeverity = "info" | "warning" | "failed";
export interface TimelineEntry {
  id: string;
  /** RFC3339 as received; "" = time unknown. */
  ts: string;
  source: TimelineSource;
  title: string;
  detail: string;
  severity: TimelineSeverity;
}

/** Sources offered per panel kind (UX 5.3). */
export const TIMELINE_KINDS: ReadonlySet<ResourceType> = new Set<ResourceType>(["deploy", "sts", "ds", "helm", "argocd"]);

/**
 * O8: epoch ms, or null for "" and anything unparseable. The fraction is trimmed to 3 digits first, because WebKit's
 * Date.parse can reject RFC3339Nano ("2026-10-16T12:00:00.123456789+07:00", Helm's `updated`).
 */
export function parseTs(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const ms = Date.parse(t.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? null : ms;
}

/** "2026-10-16 12:00 UTC", for text that must not depend on the locale. */
const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const entry = (e: Omit<TimelineEntry, "severity"> & { severity?: TimelineSeverity }): TimelineEntry => ({ severity: "info", ...e });

export interface MergeInput {
  kind: ResourceType;
  events: K8sEvent[];
  revisions: RevisionInfo[];
  helm: HelmRevision[];
  argocd: ArgoCdHistoryEntry[];
  journal: JournalEntry[];
}

/** Newest first by parsed time; entries with no usable time last, in input order. */
export function mergeTimeline({ kind, events, revisions, helm, argocd, journal }: MergeInput): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const e of events) {
    out.push(entry({
      id: `event:${e.name}`, ts: e.last_timestamp, source: "event", title: e.reason,
      detail: e.count > 1 ? `${e.message} (seen ${e.count} times)` : e.message,
      severity: e.type_ === "Warning" ? "warning" : "info",
    }));
  }
  if (kind === "deploy") {
    const byRev = [...revisions].sort((a, b) => b.revision - a.revision);
    byRev.forEach((r, i) => {
      const prev = byRev[i + 1];
      const was = prev && prev.image && prev.image !== r.image ? ` (was ${prev.image})` : "";
      const made = parseTs(r.created_at);
      out.push(entry({
        id: `rollout:${r.revision}`, ts: r.created_at, source: "rollout", title: `Revision ${r.revision}`,
        detail: `Image ${r.image}${was}${made === null ? "" : `. ReplicaSet created ${utc(made)}`}`,
      }));
    });
  }
  if (kind === "helm") {
    for (const h of helm) {
      out.push(entry({
        id: `helm:${h.revision}`, ts: h.updated, source: "helm", title: `Helm revision ${h.revision} ${h.status}`,
        detail: [h.description, h.chart && `Chart ${h.chart}`].filter(Boolean).join(". "),
        severity: h.status === "failed" ? "failed" : "info",
      }));
    }
  }
  if (kind === "argocd") {
    for (const a of argocd) {
      out.push(entry({
        // `revision` is already the display form (a 40-hex SHA is shortened by the backend); never cut it again.
        id: `argocd:${a.id}`, ts: a.deployed_at_iso, source: "argocd", title: a.revision ? `ArgoCD synced to ${a.revision}` : "ArgoCD synced",
        detail: [a.message, a.author && `by ${a.author}`].filter(Boolean).join(". "),
      }));
    }
  }
  for (const j of journal) {
    if (journalResourceType(j.kind) !== kind) continue;
    out.push(entry({
      id: `journal:${j.ts}:${j.verb}:${j.name}`, ts: j.ts, source: "journal", title: j.summary || j.verb,
      detail: `${RESULT_WORD[j.result]}${j.message ? `: ${j.message}` : ""}`,
      severity: j.result === "error" ? "failed" : "info",
    }));
  }
  const keyed = out.map((x, i) => ({ x, i, t: parseTs(x.ts) }));
  keyed.sort((a, b) => (a.t === null ? (b.t === null ? 0 : 1) : b.t === null ? -1 : b.t - a.t) || a.i - b.i);
  return keyed.map((k) => k.x);
}

export interface DayGroup { heading: string; entries: TimelineEntry[] }

/** Today / Yesterday / date headings by local day (`offsetMin` = minutes east of UTC), then "Time unknown". */
export function groupByDay(entries: TimelineEntry[], nowMs: number, offsetMin: number = -new Date(nowMs).getTimezoneOffset()): DayGroup[] {
  const day = (ms: number) => Math.floor((ms + offsetMin * 60_000) / 86_400_000);
  const today = day(nowMs);
  const groups: DayGroup[] = [];
  const unknown: TimelineEntry[] = [];
  for (const e of entries) {
    const t = parseTs(e.ts);
    if (t === null) { unknown.push(e); continue; }
    const d = day(t);
    const heading = d === today ? "Today" : d === today - 1 ? "Yesterday" : new Date(d * 86_400_000).toISOString().slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.entries.push(e);
    else groups.push({ heading, entries: [e] });
  }
  if (unknown.length) groups.push({ heading: "Time unknown", entries: unknown });
  return groups;
}
