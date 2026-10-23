import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Circle, Info, ShieldOff } from "lucide-react";
import type { ResourceType } from "../../types/k8s";
import { useApiPresence, usePossiblyUnused } from "../../hooks/useResources";
import {
  candidateKey, cardCounts, CLUSTER_SCOPED_NOTE, filterCandidates, groupByKind, KIND_LABEL, KIND_PLURAL, loadedLine, partialLine,
  QUALIFIER, REASON_SENTENCE, scopeLine, unusedPageState, type UnusedCard,
} from "../../utils/unused";
import { FindingRow } from "./FindingRow";
import { Block, FilterCards, GroupSection, PageHeader, PartialStrip } from "./HealthShell";
import { StaleStrip } from "./StaleStrip";

// #20 Possibly unused (docs/ux/04 §3.11, §4.9, §5.8). Read only: no checkbox, no select-all, no delete.
// Every label says "possibly". The only action is Open, which jumps to the object's own panel.

interface Props {
  context: string;
  namespace: string;
  /** Hidden mount (Q3): the query runs only while the page is visible. */
  visible: boolean;
  search: string;
  onOpenObject: (kind: ResourceType, namespace: string, name: string) => void;
}

export function UnusedPage({ context, namespace, visible, search, onOpenObject }: Props) {
  const q = usePossiblyUnused(context, namespace, visible);
  const presence = useApiPresence(context, visible);
  const absent = (key: string) => presence.data?.find((p) => p.key === key)?.state === "absent";

  const [card, setCard] = useState<UnusedCard | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [checkedOpen, setCheckedOpen] = useState(false);
  const [showWhich, setShowWhich] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const report = q.data;
  const all = report?.candidates ?? [];
  const cards = useMemo(() => cardCounts(all), [all]);
  const shown = useMemo(() => filterCandidates(all, card, search), [all, card, search]);
  const groups = useMemo(() => groupByKind(shown), [shown]);
  const skipped = report?.skipped ?? [];
  const state = report ? unusedPageState(all.length, skipped, namespace) : null;

  const announced = useRef("");
  useEffect(() => {
    const key = `${context}/${namespace}`;
    if (!report || announced.current === key) return;
    announced.current = key;
    setAnnouncement(loadedLine(report.candidates.length));
  }, [report, context, namespace]);
  useEffect(() => { setCard(null); }, [context, namespace]);

  const scope = scopeLine(namespace, report?.excluded_namespaces ?? [], report ? all.length : null);
  const where = namespace === "all" ? "all namespaces" : `namespace ${namespace}`;

  let body: React.ReactNode;
  if (!report) {
    body = q.error ? (
      <Block icon={<AlertCircle size={32} />} title="Couldn't check for possibly unused objects." body={(q.error as any)?.message ?? String(q.error)}>
        <button onClick={() => void q.refetch()} className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25">Retry</button>
      </Block>
    ) : (
      <div role="status" className="flex flex-col gap-2">
        <span className="text-[12px] text-mute">Checking for possibly unused objects…</span>
        {Array.from({ length: 5 }).map((_, i) => <div key={i} aria-hidden className="h-16 rounded-lg bg-surface-tint/4 motion-safe:animate-pulse" />)}
      </div>
    );
  } else if (state === "no-access") {
    const pods = skipped.some((s) => s.source === "pods");
    body = (
      <Block icon={<ShieldOff size={32} />} title={pods ? "Your account can't list pods, so references can't be checked." : "Your account can't read enough objects to check references."}
        body={`Ask a cluster admin for the list permission.${namespace === "all" ? " Or pick a namespace in the picker." : ""}`} />
    );
  } else if (state === "nothing-partial") {
    body = <Block icon={<Info size={32} />} title="Nothing found in what could be read." body={partialLine(skipped, namespace)} />;
  } else if (state === "nothing") {
    body = <Block icon={<Circle size={32} />} title={`Nothing looks possibly unused in ${where}.`} />;
  } else if (shown.length === 0) {
    body = <p className="text-[12px] text-mute px-1">No findings match the current filters.</p>;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <GroupSection
            key={g.kind}
            open={openGroups[g.kind] ?? true}
            onToggle={() => setOpenGroups((o) => ({ ...o, [g.kind]: !(o[g.kind] ?? true) }))}
            header={<span>{KIND_PLURAL[g.kind]}</span>}
            count={g.rows.length}
          >
            {g.rows.map((c) => (
              <FindingRow
                key={candidateKey(c)}
                lead={<span className="mono text-[10.5px] px-1.5 py-0.5 rounded-sm ring-1 ring-edge text-mute">{KIND_LABEL[c.kind]}</span>}
                kindLabel=""
                namespace={c.namespace}
                name={c.name}
                summary={REASON_SENTENCE[c.reason] ?? c.reason}
                evidence={[]}
                evidenceNode={c.detail ? <p className="mono wrap-break-word whitespace-pre-wrap">{c.detail}</p> : undefined}
                openTitle={`Open ${KIND_LABEL[c.kind].toLowerCase()} ${c.namespace ? `${c.namespace}/` : ""}${c.name}. Delete from its own panel.`}
                onOpen={() => onOpenObject(c.kind, c.namespace, c.name)}
              />
            ))}
          </GroupSection>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3 ${visible ? "" : "hidden"}`}>
      <div role="status" aria-live="polite" className="sr-only">{visible ? announcement : ""}</div>
      <PageHeader
        title="Possibly unused"
        subtitle={report ? scope : q.error ? scopeLine(namespace, [], null) : `${scopeLine(namespace, [], null)} · Checking…`}
        checkedAt={report ? q.dataUpdatedAt : undefined}
        toggle={{ label: "How this was checked", open: checkedOpen, onToggle: () => setCheckedOpen((v) => !v) }}
      />
      <p className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex items-start gap-2">
        <Info size={13} className="text-info mt-0.5 shrink-0" aria-hidden />
        {QUALIFIER}
      </p>
      {namespace !== "all" && <p className="text-[11.5px] text-dim">{CLUSTER_SCOPED_NOTE}</p>}

      {checkedOpen && (
        <div
          className="rounded-lg bg-card/70 ring-1 ring-edge p-3 text-[11.5px] text-mute flex flex-col gap-1.5"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setCheckedOpen(false); } }}
        >
          <h2 className="text-[12px] font-semibold text-ink">How this was checked</h2>
          <p>
            A ConfigMap or Secret counts as referenced when a pod, a workload template, an Ingress, a Gateway listener, a service account or a
            cert-manager Certificate points at it, including init containers, projected volumes and env sources.
          </p>
          {absent("gw") && <p>Gateways: Gateway API isn't installed, so Gateway listeners weren't checked.</p>}
          {absent("cert") && <p>Certificates: cert-manager isn't installed, so Certificate references weren't checked.</p>}
          <p>Always skipped: service account token and Helm release Secrets, Argo CD repository Secrets, kube-root-ca.crt.</p>
          <p>
            This can be wrong when an app reads the object through the API at run time, something outside the cluster uses it, or an
            operator reads a field this check doesn't scan. Secret values are never read.
          </p>
        </div>
      )}

      {report && q.error && <StaleStrip at={q.dataUpdatedAt} />}

      {state === "partial" && (
        <PartialStrip
          open={showWhich}
          onToggle={() => setShowWhich((v) => !v)}
          which={skipped.map((s) => <li key={s.source}><span className="mono text-ink">{s.source}</span>: {s.reason}.</li>)}
        >
          Partially visible. {partialLine(skipped, namespace)}
        </PartialStrip>
      )}

      {report && state !== "no-access" && state !== "nothing" && state !== "nothing-partial" && (
        <FilterCards
          noun="finding"
          cards={[{ id: null, label: "All", count: all.length }, ...cards]}
          selected={card}
          onSelect={(id) => setCard(id as UnusedCard | null)}
        />
      )}
      {body}
    </div>
  );
}
