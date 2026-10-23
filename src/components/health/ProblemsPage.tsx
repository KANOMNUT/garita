import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Circle, Info, ShieldOff } from "lucide-react";
import type { ProblemSeverity, ResourceType } from "../../types/k8s";
import { useApiPresence, useProblems } from "../../hooks/useResources";
import {
  allFindings, countsByRule, countsBySeverity, EVENTS_NOTE, filterFindings, kindNoun, loadedAnnouncement,
  pageState, reasonWord, RULE_COUNT, RULE_LABEL, rulesBlockedBy, skipNote, type UiRule,
} from "../../utils/problems";
import { FindingRow, ProblemLead, SEVERITY_WORD, SeverityMark } from "./FindingRow";
import { clock, StaleStrip } from "./StaleStrip";
import { Block, FilterCards, GroupSection, PageHeader, PartialStrip } from "./HealthShell";
import { PRODUCT_NAME } from "../../brand";

const SEVERITIES: ProblemSeverity[] = ["critical", "warning", "info"];

// "What is checked": static copy that mirrors the rule table (3.3). Severity per rule is fixed.
const CHECKED: Record<ProblemSeverity, UiRule[]> = {
  critical: ["crashloop", "oom-killed", "image-pull", "init-failing", "unschedulable", "node-not-ready", "cert-expired"],
  warning: ["workload-unavailable", "job-failed", "service-no-endpoints", "pvc-pending", "cert-expiring"],
  info: ["missing-probes"],
};


interface Props {
  context: string;
  namespace: string;
  /** Hidden mount (Q3): the query runs only while the page is visible. */
  visible: boolean;
  /** The TopBar search box: filters findings by kind, namespace, name, summary. */
  search: string;
  onOpenObject: (kind: ResourceType, namespace: string, name: string) => void;
}

export function ProblemsPage({ context, namespace, visible, search, onOpenObject }: Props) {
  const q = useProblems(context, namespace, visible);
  const presence = useApiPresence(context, visible);
  const certAbsent = presence.data?.find((p) => p.key === "cert")?.state === "absent";

  const [severity, setSeverity] = useState<ProblemSeverity | null>(null);
  const [rule, setRule] = useState<UiRule | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<ProblemSeverity, boolean>>({ critical: true, warning: true, info: false });
  const [checkedOpen, setCheckedOpen] = useState(false);
  const [showWhich, setShowWhich] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const report = q.data;
  const findings = useMemo(() => (report ? allFindings(report) : []), [report]);
  const bySeverity = useMemo(() => countsBySeverity(findings), [findings]);
  const byRule = useMemo(() => countsByRule(findings), [findings]);
  const shown = useMemo(() => filterFindings(findings, { severity, rule, search }), [findings, severity, rule, search]);

  // One polite announcement per (cluster, scope) on first load; never repeats on the 30 s refetch.
  const announcedKey = useRef("");
  useEffect(() => {
    const key = `${context}/${namespace}`;
    if (!report || announcedKey.current === key) return;
    announcedKey.current = key;
    setAnnouncement(loadedAnnouncement(findings));
  }, [report, findings, context, namespace]);

  // A new scope starts clean: the old filters could name a rule with no findings.
  useEffect(() => { setSeverity(null); setRule(null); }, [context, namespace]);

  const scope = namespace === "all" ? "all namespaces" : `namespace ${namespace}`;
  const skipped = report?.skipped ?? [];
  const state = report ? pageState(findings.length, skipped) : null;

  let body: React.ReactNode;
  if (!report) {
    body = q.error ? (
      <Block icon={<AlertCircle size={32} />} title="Couldn't check for problems." body={(q.error as any)?.message ?? String(q.error)}>
        <button onClick={() => void q.refetch()} className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25">Retry</button>
      </Block>
    ) : (
      <div className="flex flex-col gap-2" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-surface-tint/4 motion-safe:animate-pulse" />)}
      </div>
    );
  } else if (state === "no-access") {
    body = (
      <Block icon={<ShieldOff size={32} />} title={`You don't have access to pods in ${scope}.`}
        body={`Your account can't list pods. Ask a cluster admin for the list permission.${namespace === "all" ? " Or pick a namespace in the picker." : ""}`} />
    );
  } else if (state === "nothing-partial") {
    body = (
      <Block icon={<Info size={32} />} title="Nothing found in what could be read."
        body={`${skipped.map((s) => `Couldn't read ${s.source} (${reasonWord(s.reason)}).`).join(" ")} ${skipNote(skipped)}`} />
    );
  } else if (state === "nothing") {
    body = (
      <Block icon={<Circle size={32} />} title={`No problems found in ${scope}.`}
        body={`Checked ${RULE_COUNT} rules at ${clock(q.dataUpdatedAt)}. Kubernetes keeps events for about 1 hour, so an older cause may not appear. This is not a guarantee that everything works.`} />
    );
  } else if (shown.length === 0) {
    body = <p className="text-[12px] text-mute px-1">No findings match the current filters.</p>;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {SEVERITIES.map((sev) => {
          const rows = shown.filter((f) => f.severity === sev);
          if (rows.length === 0) return null;
          const isOpen = openGroups[sev] || severity === sev;
          return (
            <GroupSection
              key={sev}
              open={isOpen}
              onToggle={() => setOpenGroups((g) => ({ ...g, [sev]: !g[sev] }))}
              header={<SeverityMark severity={sev} />}
              count={rows.length}
            >
              {rows.map((f) => (
                <FindingRow
                  key={f.id}
                  lead={<ProblemLead severity={f.severity} rule={f.rule} />}
                  kindLabel={kindNoun(f.kind)}
                  namespace={f.namespace}
                  name={f.name}
                  container={f.container}
                  summary={f.summary}
                  evidence={f.evidence}
                  openTitle={`Open ${kindNoun(f.kind).toLowerCase()} ${f.namespace ? `${f.namespace}/` : ""}${f.name}`}
                  onOpen={() => onOpenObject(f.kind, f.namespace, f.name)}
                />
              ))}
            </GroupSection>
          );
        })}
      </div>
    );
  }

  const cards = [
    { id: null as string | null, label: "All", count: findings.length },
    ...SEVERITIES.map((s) => ({ id: s as string | null, label: SEVERITY_WORD[s], count: bySeverity[s], mark: <SeverityMark severity={s} /> })),
  ];
  const ruleOptions = (Object.keys(byRule) as UiRule[]).sort((a, b) => RULE_LABEL[a].localeCompare(RULE_LABEL[b]));

  return (
    <div className={`flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3 ${visible ? "" : "hidden"}`}>
      <div role="status" aria-live="polite" className="sr-only">{visible ? announcement : ""}</div>

      <PageHeader
        title="Problems"
        subtitle={`${scope.replace(/^./, (c) => c.toUpperCase())}${report ? ` · ${findings.length} ${findings.length === 1 ? "finding" : "findings"}` : q.error ? "" : " · Checking for problems…"}`}
        checkedAt={report ? q.dataUpdatedAt : undefined}
        toggle={{ label: "What is checked", open: checkedOpen, onToggle: () => setCheckedOpen((v) => !v) }}
      />

      {checkedOpen && (
        <div
          className="rounded-lg bg-card/70 ring-1 ring-edge p-3 text-[11.5px] text-mute flex flex-col gap-1.5"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setCheckedOpen(false); } }}
        >
          <h2 className="text-[12px] font-semibold text-ink">What is checked</h2>
          <p>Fixed rules over fields and events {PRODUCT_NAME} can read. There is no score or grade.</p>
          {SEVERITIES.map((sev) => (
            <p key={sev} className="flex gap-2">
              <SeverityMark severity={sev} />
              <span>{CHECKED[sev].map((r) => RULE_LABEL[r]).join(", ")}</span>
            </p>
          ))}
          {certAbsent && <p>Certificates: cert-manager isn't installed, so only TLS Secrets were checked.</p>}
        </div>
      )}

      {report && q.error && (
        <StaleStrip at={q.dataUpdatedAt} />
      )}

      {state === "partial" && (
        <PartialStrip
          open={showWhich}
          onToggle={() => setShowWhich((v) => !v)}
          which={skipped.map((s) => {
            const blocked = rulesBlockedBy(s.source);
            return (
              <li key={s.source}>
                <span className="mono text-ink">{s.source}</span>: {s.reason}.{" "}
                {s.source === "events" ? "Event evidence is missing."
                  : blocked.length > 0 ? `${blocked.map((r) => RULE_LABEL[r]).join(", ")} didn't run.` : ""}
              </li>
            );
          })}
        >
          Partially visible. Couldn't read {skipped.length} {skipped.length === 1 ? "source" : "sources"}:{" "}
          {skipped.map((s) => `${s.source} (${reasonWord(s.reason)})`).join(", ")}.{" "}
          {skipNote(skipped)}
        </PartialStrip>
      )}

      {report && state !== "no-access" && (
        <>
          <FilterCards cards={cards} selected={severity} onSelect={(id) => setSeverity(id as ProblemSeverity | null)}>
            <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-mute">
              Rule
              <select
                value={rule ?? ""}
                onChange={(e) => setRule(e.target.value === "" ? null : (e.target.value as UiRule))}
                className="h-7 rounded-md bg-card/80 ring-1 ring-edge text-ink text-[11.5px] px-1.5"
              >
                <option value="">All rules</option>
                {ruleOptions.map((r) => <option key={r} value={r}>{RULE_LABEL[r]} ({byRule[r]})</option>)}
              </select>
            </label>
          </FilterCards>
          {state !== "nothing" && <p className="text-[11.5px] text-dim">{EVENTS_NOTE}</p>}
        </>
      )}

      {body}
    </div>
  );
}
