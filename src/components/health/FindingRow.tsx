import { useState } from "react";
import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight, Info, XCircle } from "lucide-react";
import type { ProblemEvidence, ProblemSeverity } from "../../types/k8s";
import { EVENTS_NOTE, RULE_LABEL, type UiRule } from "../../utils/problems";

export const SEVERITY_WORD: Record<ProblemSeverity, string> = { critical: "Critical", warning: "Warning", info: "Info" };

const SEVERITY_TEXT: Record<ProblemSeverity, string> = { critical: "text-bad", warning: "text-warn", info: "text-info" };

/** Glyph (decorative) + the word, so severity is never colour alone. */
export function SeverityMark({ severity }: { severity: ProblemSeverity }) {
  const Icon = severity === "critical" ? XCircle : severity === "warning" ? AlertTriangle : Info;
  return (
    <span className={`inline-flex items-center gap-1 ${SEVERITY_TEXT[severity]}`}>
      <Icon size={12} aria-hidden />
      <span className="text-[11px] font-semibold">{SEVERITY_WORD[severity]}</span>
    </span>
  );
}

/** The Problems lead (A-14): severity glyph, severity word and the rule label. */
export function ProblemLead({ severity, rule }: { severity: ProblemSeverity; rule: UiRule }) {
  return (
    <span className="inline-flex items-center gap-2">
      <SeverityMark severity={severity} />
      <span className="text-[11.5px] text-ink">{RULE_LABEL[rule]}</span>
    </span>
  );
}

/** Evidence rows: "Field" path + value, or "Event, 4m ago" reason + message, then the events note once. */
export function EvidenceBlock({ evidence, note = true }: { evidence: ProblemEvidence[]; note?: boolean }) {
  const hasEvent = evidence.some((e) => e.source === "event");
  return (
    <dl className="flex flex-col gap-1.5 rounded-md bg-surface-sunken/60 ring-1 ring-edge p-2 text-[11.5px]">
      {evidence.map((e, i) => (
        <div key={i} className="flex flex-col">
          <dt className="text-dim">
            {e.source === "event" ? (e.event_age ? `Event, ${e.event_age} ago` : "Event") : "Field"}
            <span className="mono text-mute ml-2 break-all">{e.path}</span>
          </dt>
          <dd className="mono text-ink wrap-break-word whitespace-pre-wrap">{e.value}</dd>
        </div>
      ))}
      {hasEvent && note && <p className="text-dim">{EVENTS_NOTE}</p>}
    </dl>
  );
}

interface FindingRowProps {
  /** Lead slot (A-14): Problems passes severity + rule; v1.4.1 pages pass their own. */
  lead: React.ReactNode;
  /** "Pod", "Deployment" ... */
  kindLabel: string;
  namespace: string;
  name: string;
  container?: string | null;
  summary: string;
  evidence: ProblemEvidence[];
  /** Absent = no Open button (a finding with no live object to open). */
  onOpen?: () => void;
  /** Tooltip on Open, e.g. "Open pod shop/api-1". */
  openTitle?: string;
  /** v1.4.1 pages: replaces the container suffix ("in Helm release shop/web"). */
  meta?: React.ReactNode;
  /** v1.4.1 pages: rendered instead of `evidence` (no fake "Field" label). */
  evidenceNode?: React.ReactNode;
}

/** FINDING-ROW: lead, object, summary, evidence disclosure, Open. Keyed by finding id by the caller. */
export function FindingRow({ lead, kindLabel, namespace, name, container, summary, evidence, onOpen, openTitle, meta, evidenceNode }: FindingRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 border-b border-edge-raw/70 last:border-b-0">
      <div>{lead}</div>
      <div className="text-[11.5px] text-mute">
        {kindLabel} <span className="mono text-ink break-all">{namespace ? `${namespace}/${name}` : name}</span>
        {meta ?? (container && <span> · container "{container}"</span>)}
      </div>
      <p className="text-[12px] text-ink">{summary}</p>
      <div className="flex items-center gap-2 justify-end">
        {(evidenceNode || evidence.length > 0) && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 min-h-6 px-1.5 rounded-sm text-[11.5px] text-mute hover:text-ink hover:bg-surface-tint/4"
          >
            {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
            {!evidenceNode && evidence.length > 1 ? `Evidence (${evidence.length})` : "Evidence"}
          </button>
        )}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            title={openTitle}
            aria-label={openTitle}
            className="inline-flex items-center gap-1 min-h-6 px-1.5 rounded-sm text-[11.5px] text-accent hover:bg-accent/10"
          >
            Open <ArrowUpRight size={12} aria-hidden />
          </button>
        )}
      </div>
      {open && (evidenceNode
        ? <div className="rounded-md bg-surface-sunken/60 ring-1 ring-edge p-2 text-[11.5px] text-mute flex flex-col gap-1">{evidenceNode}</div>
        : evidence.length > 0 && <EvidenceBlock evidence={evidence} />)}
    </li>
  );
}
