import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Info, XCircle } from "lucide-react";
import type { ResourceType } from "../../types/k8s";
import { useProblems } from "../../hooks/useResources";
import { cardModel, COVERED_KINDS, EVENTS_NOTE, hasEventEvidence, RULE_LABEL, reasonWord, worstSeverity, type CardModel } from "../../utils/problems";
import { EvidenceBlock, SEVERITY_WORD, SeverityMark } from "./FindingRow";

const clock = (ms: number) => new Date(ms).toLocaleTimeString();

/**
 * The explain card's data (A-5): one scoped `list_problems` read for the OBJECT's namespace,
 * enabled only while a panel for a covered kind is open and visible. null model = no card, no chip.
 */
export function useExplain(context: string, kind: ResourceType, ns: string, name: string, visible: boolean) {
  const q = useProblems(context, ns, COVERED_KINDS.has(kind) && visible);
  const error = q.error ? ((q.error as any)?.message ?? String(q.error)) : null;
  const model = useMemo(
    () => cardModel(kind, ns, name, { report: q.data, error }),
    [kind, ns, name, q.data, error],
  );
  return { model, checkedAt: q.dataUpdatedAt, retry: () => void q.refetch() };
}

const CHIP_CLASS = {
  critical: "text-bad bg-bad/10 ring-bad/30 hover:bg-bad/20",
  warning: "text-warn bg-warn/10 ring-warn/30 hover:bg-warn/20",
  info: "text-info bg-info/10 ring-info/30 hover:bg-info/20",
} as const;
const CHIP_ICON = { critical: XCircle, warning: AlertTriangle, info: Info } as const;

/** "Problem found: N" in the panel header, coloured and glyphed by the worst severity. Only when findings exist. */
export function ProblemChip({ model, onClick }: { model: CardModel | null; onClick: () => void }) {
  if (model?.kind !== "findings") return null;
  const n = model.findings.length;
  const worst = worstSeverity(model.findings);
  const Icon = CHIP_ICON[worst];
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open the Summary tab to see why."
      aria-label={`${n} ${n === 1 ? "problem" : "problems"} found for this object, worst ${SEVERITY_WORD[worst]}. Open Summary.`}
      className={`inline-flex items-center gap-1 px-2 py-[3px] rounded-md text-[11px] font-medium ring-1 ${CHIP_CLASS[worst]}`}
    >
      <Icon size={11} aria-hidden /> Problem found: {n}
    </button>
  );
}

interface CardProps {
  model: CardModel | null;
  checkedAt: number;
  onRetry: () => void;
  /** Existing tabs and "See in Problems". Nothing here writes or fixes. */
  links: { label: string; onClick: () => void }[];
  /** True for workloads: their pods' findings live on the Problems page (UX Q1 is rejected). */
  ownsPods: boolean;
  /** Bumped by the header chip: focuses the card heading. */
  focusNonce: number;
}

const quiet = "text-[11.5px] text-dim";

export function ExplainCard({ model, checkedAt, onRetry, links, ownsPods, focusNonce }: CardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusNonce > 0) headingRef.current?.focus(); }, [focusNonce]);
  if (!model) return null;

  const podsNote = ownsPods && <p className={quiet}>Findings in this workload's pods appear on the Problems page.</p>;
  const eventsMissing = (partial: string[]) => partial.includes("events") && <p className={quiet}>Event evidence is missing.</p>;

  switch (model.kind) {
    case "checking":
      return <p className={quiet}>Checking this object…</p>;
    case "error":
      return (
        <p className={quiet}>
          Problems check unavailable: {model.message}.{" "}
          <button type="button" onClick={onRetry} className="text-accent hover:underline">Retry</button>
        </p>
      );
    case "unavailable":
      return (
        <p className={quiet}>
          Problems check unavailable: couldn't read {model.skipped.map((s) => `${s.source} (${reasonWord(s.reason)})`).join(", ")}.
        </p>
      );
    case "clear":
      return (
        <div className="flex flex-col gap-1">
          <p className={quiet}>
            Problems check: nothing found for this object ({clock(checkedAt)}). It runs a fixed set of rules and is not a health score.
          </p>
          {eventsMissing(model.partial)}
          {podsNote}
        </div>
      );
    case "findings": {
      const others = model.partial.filter((s) => s !== "events");
      return (
        <section className="rounded-lg bg-card/70 ring-1 ring-edge p-3 flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 ref={headingRef} tabIndex={-1} className="text-[11px] uppercase tracking-wider text-dim outline-hidden rounded-xs focus-visible:ring-1 focus-visible:ring-accent/60">
              Why is this unhealthy?
            </h3>
            <span className={quiet}>Checked {clock(checkedAt)}</span>
          </div>
          {model.findings.map((f) => (
            <div key={f.id} className="flex flex-col gap-1 border-t border-edge-raw/60 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-2 text-[11.5px]">
                <SeverityMark severity={f.severity} />
                <span className="text-ink">{RULE_LABEL[f.rule]}</span>
                {f.container && <span className="text-mute">container "{f.container}"</span>}
              </div>
              <p className="text-[12px] text-ink">{f.summary}</p>
              {f.evidence.length > 0 && <EvidenceBlock evidence={f.evidence} note={false} />}
            </div>
          ))}
          {hasEventEvidence(model.findings) && <p className={quiet}>{EVENTS_NOTE}</p>}
          {(others.length > 0 || model.partial.includes("events")) && (
            <p className={quiet}>
              {others.length > 0 && `Some sources couldn't be read: ${others.join(", ")}. `}
              {model.partial.includes("events") && "Event evidence is missing."}
            </p>
          )}
          {podsNote}
          <div className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <button key={l.label} type="button" onClick={l.onClick}
                className="h-7 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink">
                {l.label}
              </button>
            ))}
          </div>
        </section>
      );
    }
  }
}
