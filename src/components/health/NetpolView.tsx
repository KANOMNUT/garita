import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Ban, Circle, Info, ShieldOff } from "lucide-react";
import type { ResourceType } from "../../types/k8s";
import { useNetworkPolicyModel } from "../../hooks/useResources";
import { evaluateNetpol, type NetpolGroup, type NetpolResult } from "../../utils/netpolEval";
import { rankColumns } from "../../utils/graphLayout";
import { DRAW_CAP } from "../../utils/resourceMap";
import { GraphCanvas, type GraphCanvasHandle, type GraphEdgeView, type GraphNodeView } from "../graph/GraphCanvas";
import { GraphList, type GraphListSection } from "../graph/GraphList";
import { Block, PageHeader, PartialStrip, Segmented, useRefocus } from "./HealthShell";
import { StaleStrip } from "./StaleStrip";

// #24 NetworkPolicy view (docs/ux/06 §4), the second mode of the Map page. An APPROXIMATION, and it says so
// in the title, the note, the legend and the empty state. Wording rules: "restricted" / "not restricted", never
// "isolated", "protected", "blocked"; a missing edge reads "No allow rule found".

export type MapMode = "resources" | "netpol";
export const NETPOL_LABEL = "Network policies (approximation)";
export const NETPOL_NOTE =
  "Approximation. Built from standard NetworkPolicy objects only. Real traffic can differ: CNI-specific policies (Calico, Cilium, AdminNetworkPolicy) aren't included, named ports aren't resolved to numbers, and traffic to or from the node itself is handled differently by some CNIs. This is not a connectivity test. Policies in other namespaces aren't read.";

const btn = "min-h-6 px-2 rounded-sm ring-1 ring-edge text-[11.5px] text-ink hover:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden";
const MemoCanvas = memo(GraphCanvas);

export function ModeToggle({ mode, onChange }: { mode: MapMode; onChange: (m: MapMode) => void }) {
  return <Segmented label="Map mode" value={mode} options={[["resources", "Resources"], ["netpol", NETPOL_LABEL]] as const} onChange={onChange} remounts className="self-start" />;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const restricted = (dir: string, by: string[]) => (by.length ? `${dir}: restricted by ${plural(by.length, "policy", "policies")}` : `${dir}: not restricted`);
const pseudoBase = (id: string) => id.replace(/^(src|dst):(?=pseudo:)/, "");

interface Props {
  context: string;
  namespace: string;
  /** Hidden mount: the query runs only while the page is visible in this mode. */
  visible: boolean;
  search: string;
  modeToggle: React.ReactNode;
  /** The "Choose a namespace" block, built by the page. */
  chooser: (requestFocus: () => void) => React.ReactNode;
  /** "Show on map" from a pod panel: focus the group holding this pod. */
  podName: string | null;
  /** The pod request is still unconsumed; focus lands on the group once, then `onEntered` clears it. */
  enter: boolean;
  onEntered: () => void;
  onOpenObject: (kind: ResourceType, namespace: string, name: string) => void;
}

export function NetpolView({ context, namespace, visible, search, modeToggle, chooser, podName, enter, onEntered, onOpenObject }: Props) {
  const q = useNetworkPolicyModel(context, namespace, visible);
  const model = q.data;
  const res = useMemo<NetpolResult | null>(() => (model ? evaluateNetpol(model, namespace) : null), [model, namespace]);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [shows, setShows] = useState(false);
  const [showWhich, setShowWhich] = useState(false);
  const [stripFull, setStripFull] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [startId, setStartId] = useState("");
  const canvas = useRef<GraphCanvasHandle>(null);
  const root = useRef<HTMLDivElement>(null);

  const scope = `${context}/${namespace}`;
  useEffect(() => { setFocusedId(null); setOnly(null); setStartId(""); }, [scope]);
  const podGroupId = useMemo(() => res?.groups.find((g) => podName && g.pods.includes(podName))?.id ?? null, [res, podName]);
  useEffect(() => { if (podGroupId) setFocusedId(podGroupId); }, [podGroupId]);

  // "Start from a pod group" narrows to a group and its direct neighbours.
  const sub = useMemo<NetpolResult | null>(() => {
    if (!res) return null;
    if (!only) return res;
    const keep = new Set([only]);
    for (const e of res.edges) { if (e.from === only) keep.add(e.to); if (e.to === only) keep.add(e.from); }
    return {
      ...res,
      groups: res.groups.filter((g) => keep.has(g.id)),
      pseudo: res.pseudo.filter((p) => keep.has(p.id)),
      edges: res.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  }, [res, only]);

  const total = sub ? sub.groups.length + sub.pseudo.reduce((n, p) => n + (p.side === "both" ? 2 : 1), 0) : 0;
  const tooMany = total > DRAW_CAP;
  const groupById = useMemo(() => new Map((sub?.groups ?? []).map((g) => [g.id, g])), [sub]);
  const pseudoById = useMemo(() => new Map((sub?.pseudo ?? []).map((p) => [p.id, p])), [sub]);
  const nameOf = useCallback((id: string) => groupById.get(id)?.name ?? pseudoById.get(id)?.label ?? id, [groupById, pseudoById]);

  // Layout input: columns from rankColumns (pseudo-nodes pinned to the first and last column), its renamed edges.
  const graph = useMemo(() => {
    if (!sub || tooMany) return null;
    const src = sub.pseudo.filter((p) => p.side !== "dst").map((p) => p.id);
    const dst = sub.pseudo.filter((p) => p.side !== "src").map((p) => p.id);
    const rank = rankColumns(sub.groups.map((g) => g.id), sub.edges.map((e) => ({ from: e.from, to: e.to })), src, dst);
    const sS = new Set(src);
    const sD = new Set(dst);
    const info = new Map<string, (typeof sub.edges)[number]>();
    for (const e of sub.edges) info.set(`${sS.has(e.from) ? `src:${e.from}` : e.from}\u0000${sD.has(e.to) ? `dst:${e.to}` : e.to}`, e);
    return { rank, info };
  }, [sub, tooMany]);

  const matchQ = search.trim().toLowerCase();
  const matches = useMemo(() => {
    const out = new Set<string>();
    if (!matchQ) return out;
    for (const g of sub?.groups ?? []) if (g.name.toLowerCase().includes(matchQ) || g.pods.some((p) => p.toLowerCase().includes(matchQ))) out.add(g.id);
    for (const p of sub?.pseudo ?? []) if (p.label.toLowerCase().includes(matchQ)) out.add(p.id);
    return out;
  }, [sub, matchQ]);

  // Edges indexed once per result, not filtered per node per render.
  const io = useMemo(() => {
    const i = new Map<string, NetpolResult["edges"]>();
    const o = new Map<string, NetpolResult["edges"]>();
    for (const e of sub?.edges ?? []) {
      (i.get(e.to) ?? i.set(e.to, []).get(e.to)!).push(e);
      (o.get(e.from) ?? o.set(e.from, []).get(e.from)!).push(e);
    }
    return { i, o };
  }, [sub]);
  const incoming = useCallback((id: string) => io.i.get(id) ?? [], [io]);
  const outgoing = useCallback((id: string) => io.o.get(id) ?? [], [io]);

  const canvasNodes = useMemo<GraphNodeView[]>(() => {
    if (!graph) return [];
    return Object.keys(graph.rank.columns).map((cid) => {
      const id = pseudoBase(cid);
      const g = groupById.get(id);
      const p = pseudoById.get(id);
      const name = g?.name ?? p?.label ?? id;
      const dirs = g ? ` ${restricted("Ingress", g.ingress.restrictedBy)}. ${restricted("Egress", g.egress.restrictedBy)}.` : "";
      const nIn = incoming(id).length;
      const nOut = outgoing(id).length;
      return {
        id: cid,
        column: graph.rank.columns[cid],
        kindLabel: g ? "Pod group" : "Peer",
        pseudo: !g,
        // Short enough for 168 px; the full words are in the tooltip, the accessible name and the strip.
        sub: g ? `In: ${g.ingress.restrictedBy.length ? "restricted" : "no limit"} · Out: ${g.egress.restrictedBy.length ? "restricted" : "no limit"}` : undefined,
        subFull: g ? `Ingress: ${g.ingress.restrictedBy.length ? "restricted" : "not restricted"} · Egress: ${g.egress.restrictedBy.length ? "restricted" : "not restricted"}` : undefined,
        name,
        note: g ? plural(g.pods.length, "pod") : cid.startsWith("src:") ? "source" : "destination",
        match: matches.has(id),
        accessibleName: `${g ? "Pod group" : "Peer"} ${name} in ${namespace}.${dirs} Can receive from ${nIn}, can send to ${nOut}.`,
      };
    });
  }, [graph, groupById, pseudoById, incoming, outgoing, matches, namespace]);
  // S7: "Show on map" from a pod panel closes the panel; focus lands on that pod's group once, when it first renders.
  const enterFocus = useRef<string | null>(null);
  useEffect(() => { enterFocus.current = enter && podGroupId && podName ? podGroupId : null; }, [enter, podGroupId, podName]);
  useEffect(() => {
    const id = enterFocus.current;
    if (!id || !visible || view !== "graph" || !canvasNodes.some((n) => n.id === id)) return;
    enterFocus.current = null;
    canvas.current?.focusNode(id);
    onEntered();
  }, [canvasNodes, visible, view]);
  const canvasEdges = useMemo<GraphEdgeView[]>(
    () => (graph?.rank.edges ?? []).map((e) => ({ from: e.from, to: e.to, family: "solid" as const, label: graph!.info.get(`${e.from}\u0000${e.to}`)?.ports.join(", ") })),
    [graph],
  );

  const openGroup = useCallback((g: NetpolGroup) => {
    // The pod list filtered by the owner name when the group is named after one, else by its first pod.
    onOpenObject("pods", namespace, g.pods.every((p) => p.startsWith(g.name)) ? g.name : g.pods[0]);
  }, [namespace, onOpenObject]);
  const onOpen = useCallback((cid: string) => {
    const g = groupById.get(pseudoBase(cid));
    if (g) openGroup(g);
  }, [groupById, openGroup]);
  const toggleStrip = useCallback(() => setStripFull((v) => !v), []);

  const sections = useMemo<GraphListSection[]>(() => {
    if (!sub) return [];
    const rows = sub.groups
      .filter((g) => !matchQ || matches.has(g.id))
      .map((g) => {
        const from = incoming(g.id).map((e) => `${nameOf(e.from)} (${e.ports.join(", ")}; allowed by ${e.allowedBy.join(", ")})`);
        const to = outgoing(g.id).map((e) => `${nameOf(e.to)} (${e.ports.join(", ")}; allowed by ${e.allowedBy.join(", ")})`);
        return {
          id: g.id,
          name: `${g.name} (${plural(g.pods.length, "pod")})`,
          relations: [
            `${restricted("Ingress", g.ingress.restrictedBy)}. ${restricted("Egress", g.egress.restrictedBy)}.`,
            !g.ingress.restrictedBy.length ? "Can receive from: not restricted by its own policies (any source)." : from.length ? `Can receive from ${from.join("; ")}.` : "No allow rule found for traffic from other groups.",
            !g.egress.restrictedBy.length ? "Can send to: not restricted by its own policies (any destination)." : to.length ? `Can send to ${to.join("; ")}.` : "No allow rule found for traffic to other groups.",
          ].join(" "),
          onOpen: () => openGroup(g),
        };
      });
    return rows.length ? [{ heading: "Pod groups", count: rows.length, rows }] : [];
  }, [sub, matchQ, matches, incoming, outgoing, nameOf, openGroup]);

  const announced = useRef("");
  useEffect(() => {
    if (!res || !visible) return;
    const key = `${scope}/${tooMany}`;
    if (announced.current === key) return;
    announced.current = key;
    setAnnouncement(tooMany ? "Too many pod groups to draw. Choose where to start." : `Network policy map loaded. ${plural(res.groups.length, "pod group")}, ${plural(res.edges.length, "connection")}.`);
  }, [res, visible, scope, tooMany]);

  const requestFocus = useRefocus(root, `${namespace}|${only ?? ""}|${tooMany}`, tooMany ? 'select[aria-label="Pod group"]' : '[data-graph-node][tabindex="0"]');
  const skipped = model?.skipped ?? [];
  const policies = model?.policies.length ?? 0;
  const noAccess = !!model && skipped.some((s) => s.source === "networkpolicies");
  const subtitle = namespace === "all" ? "Choose a namespace" : res
    ? `Namespace ${namespace} · ${plural(policies, "policy", "policies")} · ${plural(res.groups.length, "pod group")}${res.selectsNothing.length ? ` · ${res.selectsNothing.length} select${res.selectsNothing.length === 1 ? "s" : ""} no pods` : ""}`
    : `Namespace ${namespace} · Checking…`;
  const SKIP_COPY: Record<string, string> = {
    pods: "Pod groups aren't shown.",
    namespaces: "Namespace selectors can't be matched, so traffic from other namespaces isn't shown.",
    networkpolicies: "Policies aren't shown.",
  };

  const cur = focusedId ? groupById.get(pseudoBase(focusedId)) ?? null : null;
  const curPseudo = focusedId ? pseudoById.get(pseudoBase(focusedId)) ?? null : null;
  const focusEnd = (id: string) => {
    // A pseudo-node may be on screen as src:<id> and/or dst:<id>; either reaches the same peer.
    const ids = Object.keys(graph?.rank.columns ?? {});
    canvas.current?.focusNode(ids.includes(id) ? id : ids.find((c) => pseudoBase(c) === id) ?? id);
  };

  function renderStrip() {
    const id = cur?.id ?? curPseudo?.id;
    if (!id) return <p className="text-mute">Select a node to see what it can send to and receive from.</p>;
    const inc = incoming(id);
    const out = outgoing(id);
    const self = inc.find((e) => e.from === id);
    const link = (e: (typeof inc)[number], other: string) => (
      <span key={`${e.from}>${e.to}`} className="mr-3 inline-block">
        <button type="button" onClick={() => focusEnd(other)} className="text-ink hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-accent/60 rounded-sm">{nameOf(other)} ▸</button>{" "}
        <span className="text-mute">({e.ports.join(", ")}; allowed by {e.allowedBy.join(", ")})</span>
      </span>
    );
    const noRule = cur ? (sub!.noRule[id] ?? []).map((x) => groupById.get(x)).filter((g): g is NetpolGroup => !!g) : [];
    const inList = inc.filter((e) => e.from !== id);
    const outList = out.filter((e) => e.to !== id);
    const freeIn = !!cur && cur.ingress.restrictedBy.length === 0;
    const freeOut = !!cur && cur.egress.restrictedBy.length === 0;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-mute">{cur ? "Pod group" : "Peer"}</span>
          <span className="mono break-all text-ink">{cur ? `${cur.name} (${plural(cur.pods.length, "pod")})` : curPseudo!.label}</span>
          {matches.has(id) && <span className="text-accent">match</span>}
          {cur && <span className="text-mute">{restricted("Ingress", cur.ingress.restrictedBy)} · {restricted("Egress", cur.egress.restrictedBy)}</span>}
          <span className="flex-1" />
          {cur && <button type="button" className={btn} onClick={() => openGroup(cur)}>Open pod list ↗</button>}
          {cur && id !== only && <button type="button" className={btn} onClick={() => { requestFocus(); setOnly(id); }}>Show only this</button>}
        </div>
        {cur && cur.ingress.restrictedBy.length > 0 && <p className="text-mute">Ingress restricted by: {cur.ingress.restrictedBy.join(", ")}</p>}
        {cur && cur.egress.restrictedBy.length > 0 && <p className="text-mute">Egress restricted by: {cur.egress.restrictedBy.join(", ")}</p>}
        <p className="text-mute">
          Can receive from:{" "}
          {freeIn ? "not restricted by its own policies (any source)." : inList.length === 0 ? "no allow rule found." : null}
          {freeIn && inList.length > 0 && " Egress rules that name it: "}
          {inList.map((e) => link(e, e.from))}
        </p>
        <p className="text-mute">
          Can send to:{" "}
          {freeOut ? "not restricted by its own policies (any destination)." : outList.length === 0 ? "no allow rule found." : null}
          {freeOut && outList.length > 0 && " Ingress rules that name it: "}
          {outList.map((e) => link(e, e.to))}
        </p>
        {self && <p className="text-mute">This group can reach itself ({self.ports.join(", ")}; allowed by {self.allowedBy.join(", ")}).</p>}
        {noRule.length > 0 && (
          <p className="text-mute">
            No allow rule found for traffic from:{" "}
            {noRule.map((g) => <button key={g.id} type="button" onClick={() => focusEnd(g.id)} className="mr-2 text-ink hover:underline rounded-sm">{g.name} ▸</button>)}
          </p>
        )}
      </div>
    );
  }

  let body: React.ReactNode;
  if (namespace === "all") body = chooser(requestFocus);
  else if (!res) {
    body = q.error ? (
      <Block icon={<AlertCircle size={32} />} title="Couldn't read network policies." body={(q.error as any)?.message ?? String(q.error)}>
        <button onClick={() => void q.refetch()} className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25">Retry</button>
      </Block>
    ) : (
      <div role="status" className="flex flex-col gap-2">
        <span className="text-[12px] text-mute">Reading network policies…</span>
        <div aria-hidden className="flex gap-4">
          {[0, 1, 2].map((c) => <div key={c} className="w-46 h-13 rounded-md bg-surface-tint/4" />)}
        </div>
      </div>
    );
  } else if (noAccess && policies === 0) {
    body = (
      <Block icon={<ShieldOff size={32} />} title={`You don't have access to NetworkPolicies in namespace ${namespace}.`} body="Your account can't list networkpolicies. Ask a cluster admin for the list permission." />
    );
  } else if (policies === 0) {
    body = (
      <Block
        icon={<Circle size={32} />}
        title={`No NetworkPolicies in namespace ${namespace}.`}
        body={`Kubernetes lets pods that no policy selects send and receive any traffic, so nothing here is restricted by a standard policy. This is an approximation: CNI-specific policies aren't shown.${res.groups.length ? `\n${plural(res.groups.length, "pod group")}, none selected by a policy: ${res.groups.map((g) => g.name).join(", ")}.` : ""}`}
      />
    );
  } else if (tooMany) {
    body = (
      <Block icon={<Ban size={32} />} title="This namespace has too many pod groups to draw." body={`${total} pod groups and peers in namespace ${namespace} (the limit is ${DRAW_CAP}). Start from one pod group.`}>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="text-[11.5px] text-mute">Start from a pod group:</span>
          <select aria-label="Pod group" value={startId} onChange={(e) => setStartId(e.target.value)} className="h-6 rounded-sm bg-surface-input ring-1 ring-edge text-[11.5px] text-ink px-1 max-w-56">
            <option value="">Choose…</option>
            {res.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button
            type="button"
            aria-disabled={!startId || undefined}
            title={startId ? undefined : "Choose a pod group first."}
            onClick={() => { if (!startId) return; requestFocus(); setOnly(startId); setFocusedId(startId); }}
            className={`${btn} aria-disabled:opacity-50 aria-disabled:cursor-not-allowed`}
          >
            Show map{!startId && <span className="sr-only">. Choose a pod group first.</span>}
          </button>
        </div>
      </Block>
    );
  } else {
    const show = view === "graph" && canvasNodes.length > 0;
    body = (
      <>
        {res.groups.every((g) => !g.ingress.restrictedBy.length && !g.egress.restrictedBy.length) && (
          <p className="text-[11.5px] text-mute">{plural(policies, "policy", "policies")} exist; none selects a pod in this namespace.</p>
        )}
        {show ? (
          <div className="h-[60vh] min-h-80">
            <MemoCanvas
              ref={canvas}
              nodes={canvasNodes}
              edges={canvasEdges}
              focusedId={focusedId}
              onFocus={setFocusedId}
              onOpen={onOpen}
              onExpandDetails={toggleStrip}
              ariaLabel={`${NETPOL_LABEL} for namespace ${namespace}`}
              epoch={only ?? ""}
            />
          </div>
        ) : sections.length ? (
          <GraphList sections={sections} />
        ) : (
          <p className="text-[12px] text-mute px-1">{matchQ ? "No match on the map." : "Nothing to list."}</p>
        )}
        {show && (
          <section aria-label="Details" className={`rounded-lg bg-card/70 ring-1 ring-edge p-3 text-[11.5px] overflow-auto ${stripFull ? "max-h-[60vh]" : "h-28"}`}>
            {renderStrip()}
          </section>
        )}
      </>
    );
  }

  const drawn = !!res && !tooMany && policies > 0 && namespace !== "all";

  return (
    <div ref={root} className={`flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3 ${visible ? "" : "hidden"}`}>
      <div role="status" aria-live="polite" className="sr-only">{visible ? announcement : ""}</div>
      <PageHeader
        title={NETPOL_LABEL}
        subtitle={subtitle}
        checkedAt={res ? q.dataUpdatedAt : undefined}
        toggle={{ label: "What this view shows", open: shows, onToggle: () => setShows((v) => !v) }}
      />
      {modeToggle}
      <p className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex items-start gap-2">
        <Info size={13} className="text-info mt-0.5 shrink-0" aria-hidden />
        {NETPOL_NOTE}
      </p>
      {shows && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3 text-[11.5px] text-mute flex flex-col gap-1.5">
          <h2 className="text-[12px] font-semibold text-ink">What this view shows (approximation)</h2>
          <p>
            Pods with the same labels form one group, named after their workload when they share one. An arrow is traffic that an allow rule
            permits, drawn only when at least one side is restricted by a policy. A group that no policy selects is not restricted and can
            send and receive any traffic, so it gets no arrow of its own.
          </p>
          <p>Peers that stand for many objects are drawn as one node: all pods in the namespace, other namespaces, an IP range, or anywhere.</p>
          {res && res.selectsNothing.length > 0 && <p>Policies that select no pod: {res.selectsNothing.join(", ")}.</p>}
        </div>
      )}
      {only && (
        <p className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex items-center gap-2">
          <Info size={13} className="text-info shrink-0" aria-hidden />
          <span className="flex-1">Showing what is connected to {groupById.get(only)?.name ?? "this group"}.</span>
          <button type="button" onClick={() => { requestFocus(); setOnly(null); }} className={btn}>Show whole namespace</button>
        </p>
      )}
      {skipped.length > 0 && !noAccess && (
        <PartialStrip
          which={skipped.map((s) => <li key={s.source}><span className="mono text-ink">{s.source}</span> ({s.reason}). {SKIP_COPY[s.source]}</li>)}
          open={showWhich}
          onToggle={() => setShowWhich((v) => !v)}
        >
          Partially visible. Couldn&apos;t read {skipped.map((s) => `${s.source} (${s.reason})`).join(", ")}. {skipped.map((s) => SKIP_COPY[s.source]).join(" ")}
        </PartialStrip>
      )}
      {q.isRefetchError && res && <StaleStrip at={q.dataUpdatedAt} />}
      {drawn && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1" />
          {matchQ && <span className="text-[11.5px] text-mute" role="status">{matches.size ? plural(matches.size, "match", "matches") : "No match on the map."}</span>}
          <Segmented label="Map view" value={view} options={[["graph", "Graph"], ["list", "List"]] as const} onChange={setView} />
        </div>
      )}
      {body}
      {drawn && (
        <div role="group" aria-label="Legend (approximation)" className="text-[11px] text-mute flex flex-col gap-0.5">
          <h2 className="text-[11px] font-semibold text-ink">Legend (approximation)</h2>
          <p>Arrow: traffic an allow rule permits, from source to destination. No arrow does not mean a guarantee of no traffic.</p>
          <p>Restricted: some policy of that type selects the group. Not restricted: no policy does, so the group sends or receives any traffic.</p>
        </div>
      )}
    </div>
  );
}
