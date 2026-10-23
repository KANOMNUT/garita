import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Circle, Info, XCircle } from "lucide-react";
import type { DeprecatedApiFinding, ResourceType } from "../../types/k8s";
import { useDeprecatedApis } from "../../hooks/useResources";
import {
  apiLine, cardOf, clusterNewerThanTable, deprecationState, evidenceLines, findingKey, headerLine, loadedLine, newerNote,
  openTarget, partialLine, SCOPE_SENTENCE, statusOf, STATUS_WORD, summaryLine, whereSuffix,
} from "../../utils/deprecations";
import { FindingRow } from "./FindingRow";
import { Block, FilterCards, PageHeader, PartialStrip } from "./HealthShell";
import { StaleStrip } from "./StaleStrip";

// #19 Deprecated APIs (docs/ux/04 §3.12, §4.10, §5.9). Read only. The status word comes from `served_by_this_server`.
// The page never says "clean": the table is finite and the scan covers Helm manifests and last-applied annotations only.

interface Props {
  context: string;
  namespace: string;
  /** Hidden mount (Q3): the query runs only while the page is visible. */
  visible: boolean;
  search: string;
  onOpenObject: (kind: ResourceType, namespace: string, name: string) => void;
}

function Lead({ f }: { f: DeprecatedApiFinding }) {
  const st = statusOf(f);
  const Icon = st === "removed" ? XCircle : st === "deprecated" ? AlertTriangle : Info;
  const cls = st === "removed" ? "text-bad" : st === "deprecated" ? "text-warn" : "text-info";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center gap-1 ${cls}`}>
        <Icon size={12} aria-hidden />
        <span className="text-[11px] font-semibold">{STATUS_WORD[st]}</span>
      </span>
      <span className="mono text-[11.5px] text-ink">{apiLine(f)}</span>
    </span>
  );
}

export function DeprecatedApisPage({ context, namespace, visible, search, onOpenObject }: Props) {
  const q = useDeprecatedApis(context, namespace, visible);
  const [card, setCard] = useState<"removed" | "deprecated" | null>(null);
  const [showWhich, setShowWhich] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const report = q.data;
  const findings = report?.findings ?? [];
  const skipped = report?.skipped ?? [];
  const q2 = search.trim().toLowerCase();
  const shown = useMemo(
    () => findings.filter((f) =>
      (!card || cardOf(f) === card) &&
      (!q2 || [f.api_version, f.kind, f.name, f.namespace, f.helm_release ?? "", STATUS_WORD[statusOf(f)]].join(" ").toLowerCase().includes(q2))),
    [findings, card, q2],
  );
  const removed = findings.filter((f) => cardOf(f) === "removed").length;
  const state = report ? deprecationState(findings.length, skipped) : null;

  const announced = useRef("");
  useEffect(() => {
    const key = `${context}/${namespace}`;
    if (!report || announced.current === key) return;
    announced.current = key;
    setAnnouncement(loadedLine(report.findings.length));
  }, [report, context, namespace]);
  useEffect(() => { setCard(null); }, [context, namespace]);

  const where = namespace === "all" ? "all namespaces" : `namespace ${namespace}`;
  const newer = !!report && clusterNewerThanTable(report.server_version, report.table_covers_up_to);

  let body: React.ReactNode;
  if (!report) {
    body = q.error ? (
      <Block icon={<AlertCircle size={32} />} title="Couldn't scan for deprecated APIs." body={(q.error as any)?.message ?? String(q.error)}>
        <button onClick={() => void q.refetch()} className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25">Retry</button>
      </Block>
    ) : (
      <div role="status" className="flex flex-col gap-2">
        <span className="text-[12px] text-mute">Scanning for deprecated APIs…</span>
        {Array.from({ length: 4 }).map((_, i) => <div key={i} aria-hidden className="h-20 rounded-lg bg-surface-tint/4 motion-safe:animate-pulse" />)}
      </div>
    );
  } else if (state === "nothing-partial") {
    body = <Block icon={<Info size={32} />} title="Nothing found in what could be read." body={`${partialLine(skipped)} Table covers Kubernetes up to ${report.table_covers_up_to}.`} />;
  } else if (state === "nothing") {
    body = (
      <Block icon={<Circle size={32} />} title={`No deprecated APIs found in Helm releases or last-applied annotations in ${where}.`}
        body={`Table covers Kubernetes up to ${report.table_covers_up_to}.`} />
    );
  } else if (shown.length === 0) {
    body = <p className="text-[12px] text-mute px-1">No findings match the current filters.</p>;
  } else {
    body = (
      <ul className="rounded-xl bg-card/70 ring-1 ring-edge">
        {shown.map((f) => {
          const target = openTarget(f);
          return (
            <FindingRow
              key={findingKey(f)}
              lead={<Lead f={f} />}
              kindLabel=""
              namespace=""
              name={f.name}
              meta={<span>{whereSuffix(f)}</span>}
              summary={summaryLine(f)}
              evidence={[]}
              evidenceNode={evidenceLines(f).map((l) => <p key={l}>{l}</p>)}
              openTitle={target ? `Open ${target.kind === "helm" ? "Helm release" : f.kind} ${target.name}` : undefined}
              onOpen={target ? () => onOpenObject(target.kind, target.namespace, target.name) : undefined}
            />
          );
        })}
      </ul>
    );
  }

  return (
    <div className={`flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3 ${visible ? "" : "hidden"}`}>
      <div role="status" aria-live="polite" className="sr-only">{visible ? announcement : ""}</div>
      <PageHeader
        title="Deprecated APIs"
        subtitle={report ? headerLine(report.server_version, report.table_covers_up_to, findings.length) : q.error ? "" : "Scanning…"}
        checkedAt={report ? q.dataUpdatedAt : undefined}
      />
      <p className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex items-start gap-2">
        <Info size={13} className="text-info mt-0.5 shrink-0" aria-hidden />
        {SCOPE_SENTENCE}
      </p>
      {newer && report && (
        <p role="note" className="rounded-lg bg-warn/10 ring-1 ring-warn/30 text-[11.5px] text-ink px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={13} className="text-warn mt-0.5 shrink-0" aria-hidden />
          {newerNote(report.server_version, report.table_covers_up_to)}
        </p>
      )}
      {report && q.error && <StaleStrip at={q.dataUpdatedAt} />}
      {state === "partial" && (
        <PartialStrip
          open={showWhich}
          onToggle={() => setShowWhich((v) => !v)}
          which={skipped.map((s, i) => <li key={i}><span className="mono text-ink">{s.source}</span>: {s.reason}.</li>)}
        >
          Partially visible. {partialLine(skipped)}
        </PartialStrip>
      )}
      {report && (state === "list" || state === "partial") && (
        <FilterCards
          noun="finding"
          cards={[
            { id: null, label: "All", count: findings.length },
            { id: "removed", label: "Removed", count: removed },
            { id: "deprecated", label: "Deprecated", count: findings.length - removed },
          ]}
          selected={card}
          onSelect={(id) => setCard(id as "removed" | "deprecated" | null)}
        />
      )}
      {body}
    </div>
  );
}
