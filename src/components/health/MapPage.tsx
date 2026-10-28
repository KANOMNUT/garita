import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Ban, ChevronDown, Circle, Info, ShieldOff } from "lucide-react";
import type { MapKind, MapSource, ResourceType } from "../../types/k8s";
import { useDaemonSets, useDeployments, useIngresses, useResourceMap, useServices, useStatefulSets } from "../../hooks/useResources";
import {
  DRAW_CAP, KIND_GROUPS, KIND_LABEL, KIND_PLURAL, MAP_COLUMN, NO_STATUS_KINDS, SKIPPED_COPY, START_KINDS, countByKind, edgeFamily,
  focusBanner, focusNodeId, groupState, groupZeroReason, hideKinds, hiddenLinks, hiddenLinkText, hiddenPresent, kindsAnnouncement, lineage, mapState,
  matchIds, matchLineText, nodeText, prepareMap, relationLabel, relationsOf, setGroupShown, zeroReason, type KindGroupId, type MapViewNode,
} from "../../utils/resourceMap";
import { GraphCanvas, STATUS_VIEW, type GraphCanvasHandle, type GraphEdgeView, type GraphNodeView } from "../graph/GraphCanvas";
import { GraphList, type GraphListSection } from "../graph/GraphList";
import { Popover } from "../Popover";
import { disabledAttrs } from "../../utils/guardrails";
import { Block, PageHeader, PartialStrip, Segmented, useRefocus } from "./HealthShell";
import { StaleStrip } from "./StaleStrip";
import { ModeToggle, NetpolView, type MapMode } from "./NetpolView";

// #18 Namespace resource map (docs/ux/06 §3). Read only: it reads and navigates. Open goes through
// jumpFromHealth (X1): the object's list view filtered to its name, no panel.

export interface MapFocus {
  kind: MapKind;
  name: string;
  /** Set by the panel's Map action: focus lands on that node once (UX 3.1 B). */
  enter?: boolean;
}
interface Props {
  context: string;
  namespace: string;
  namespaces: string[];
  /** Hidden mount (Q3): the query runs only while the page is visible. */
  visible: boolean;
  search: string;
  /** Panel entry point / "Show only this": `get_resource_map` focus. */
  focus: MapFocus | null;
  onFocusChange: (f: MapFocus | null) => void;
  onOpenObject: (kind: ResourceType, namespace: string, name: string) => void;
  onPickNamespace: (ns: string) => void;
  /** Resources or Network policies (approximation); owned by App so the palette and the pod panel can set it. */
  mode: MapMode;
  onModeChange: (m: MapMode) => void;
  /** Pod panel "Show on map": the pod whose group the netpol view focuses. */
  netpolPod: string | null;
  /** The pod request is still unconsumed (see `onEntered`). */
  netpolEnter: boolean;
  /** The page moved focus to the requested node; the host clears its one-shot request. */
  onEntered: (which: "map" | "netpol") => void;
}

const MemoCanvas = memo(GraphCanvas);
const btn = "min-h-6 px-2 rounded-sm ring-1 ring-edge text-[11.5px] text-ink hover:bg-surface-tint/6 focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden";
const NAME_HOOK = { deploy: useDeployments, sts: useStatefulSets, ds: useDaemonSets, svc: useServices, ing: useIngresses } as const;

/** One list hook per kind, keyed by kind so the hook never changes under a mounted component. */
function NameSelect({ kind, context, namespace, value, onChange }: { kind: keyof typeof NAME_HOOK; context: string; namespace: string; value: string; onChange: (v: string) => void }) {
  const { data = [] } = (NAME_HOOK[kind] as unknown as (c: string, n: string) => { data?: { name: string }[] })(context, namespace);
  return (
    <select aria-label="Name" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 rounded-sm bg-surface-input ring-1 ring-edge text-[11.5px] text-ink px-1 max-w-56">
      <option value="">Choose…</option>
      {[...data].sort((a, b) => (a.name < b.name ? -1 : 1)).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
    </select>
  );
}

const chipFocus = "focus-visible:ring-2 focus-visible:ring-accent/70 outline-hidden";
const headerBtn = `min-h-6 px-2 rounded-sm text-[11.5px] text-accent hover:bg-surface-tint/6 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${chipFocus}`;
const NO_GROUPS: ReadonlyMap<string, string> = new Map();
const NO_LINKS: ReadonlyMap<string, number> = new Map();

/**
 * One group chip that opens a dropdown with the group's kinds (v2.3.1; supersedes the single Kinds button of UX 22 §3.3).
 * The trigger keeps its visible text as its name (WCAG 2.5.3): the group label, then the object count, or "shown of total"
 * when part of the group is hidden. It is a menu trigger, not a toggle, so it has no `aria-pressed`.
 */
function GroupChip({ group, counts, hidden, skipped, scopeWord, open, onToggle, onClose, onChange }: {
  group: (typeof KIND_GROUPS)[number];
  counts: Record<MapKind, number>;
  hidden: ReadonlySet<MapKind>;
  skipped: readonly MapSource[];
  scopeWord: "namespace" | "chain";
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (next: Set<MapKind>) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const { state, shown, total } = groupState(group.id, hidden, counts);
  const flagged = group.kinds.some((k) => hidden.has(k));
  // A group with no objects is a dead chip, unless its kinds are flagged hidden (after Hide all): then it stays openable.
  const reason = state === "empty" && !flagged ? groupZeroReason(group.id, counts, skipped, scopeWord) : null;
  const isOpen = open && !reason;
  // A group that empties on a refetch closes for good: otherwise it would reopen by itself, and take focus, when its objects return.
  useEffect(() => { if (open && reason) onClose(); }, [open, reason, onClose]);
  // The Popover does not move focus: the first enabled checkbox takes it (else the first enabled header button). Rows are native tab stops (C-2).
  useEffect(() => {
    if (!isOpen) return;
    const b = body.current;
    (b?.querySelector<HTMLElement>('input:not([aria-disabled="true"])') ?? b?.querySelector<HTMLElement>('button:not([aria-disabled="true"])'))?.focus();
  }, [isOpen]);
  const showAllReason = flagged ? undefined : "All kinds in this group are already shown.";
  const hideAllReason = group.kinds.every((k) => hidden.has(k) || counts[k] === 0) ? "All kinds in this group are already hidden." : undefined;
  const muted = state === "none" || (state === "empty" && flagged);
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        data-kind-chip
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-disabled={reason ? true : undefined}
        title={reason ?? undefined}
        onClick={() => { if (!reason) onToggle(); }}
        className={`min-h-6 px-2.5 py-1 rounded-lg text-[11.5px] ring-1 flex items-center gap-1.5 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${chipFocus} ${muted ? "bg-card/70 ring-edge text-mute" : "bg-accent/12 ring-accent/30 text-ink"}`}
      >
        {group.label} <span className="mono tabular-nums">{state === "some" || state === "none" ? `${shown} of ${total}` : total}</span>
        <ChevronDown size={11} aria-hidden className={isOpen ? "rotate-180" : ""} />
        {reason && <span className="sr-only">. {reason}</span>}
      </button>
      <Popover open={isOpen} onClose={onClose} triggerRef={trigger} label={`${group.label}: kinds to show`} className="left-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] text-left">
        <div ref={body}>
          <div className="flex items-center gap-1 px-3 pt-2 pb-1.5 border-b border-edge">
            <span className="flex-1 text-[12px] font-semibold text-ink">{group.label}</span>
            <button type="button" {...disabledAttrs(showAllReason)} onClick={() => { if (!showAllReason) onChange(setGroupShown(group.id, hidden, true)); }} className={headerBtn}>Show all</button>
            <button type="button" {...disabledAttrs(hideAllReason)} onClick={() => { if (!hideAllReason) onChange(setGroupShown(group.id, hidden, false)); }} className={headerBtn}>Hide all</button>
          </div>
          <div className="max-h-[min(24rem,60vh)] overflow-auto p-1.5">
            {group.kinds.map((k) => {
              const rowReason = zeroReason(k, counts, skipped, scopeWord);
              const n = counts[k];
              return (
                <label
                  key={k}
                  title={rowReason ?? undefined}
                  className={`flex items-center gap-2 min-h-6 px-2 rounded-sm text-[11.5px] text-ink hover:bg-surface-tint/6 ${rowReason ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    className="accent-accent h-3.5 w-3.5"
                    checked={!hidden.has(k)}
                    {...disabledAttrs(rowReason ?? undefined)}
                    onChange={() => {
                      if (rowReason) return;
                      const next = new Set(hidden);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      onChange(next);
                    }}
                  />
                  <span>{KIND_PLURAL[k]}<span className="sr-only">, {n} {n === 1 ? "object" : "objects"}</span></span>
                  <span aria-hidden className="ml-auto mono text-[11px] tabular-nums text-mute">{n}</span>
                </label>
              );
            })}
          </div>
        </div>
      </Popover>
    </div>
  );
}

/**
 * The group chips, each a dropdown over its kinds, plus "Show all kinds" while anything is hidden. The hidden state is a
 * set of kinds; every change goes out through `onChange` as the next set. One dropdown is open at a time. `scopeWord`:
 * counts come from the namespace, or from the chain while focused. `label` names the `role="group"`.
 */
function KindFilter({ label, counts, hidden, skipped, onChange, onShowAll, scopeWord, className = "" }: {
  label: string;
  counts: Record<MapKind, number>;
  hidden: ReadonlySet<MapKind>;
  skipped: readonly MapSource[];
  onChange: (next: Set<MapKind>) => void;
  onShowAll: () => void;
  scopeWord: "namespace" | "chain";
  className?: string;
}) {
  const id = useId();
  const [openId, setOpenId] = useState<KindGroupId | null>(null);
  return (
    <div role="group" aria-labelledby={`${id}-label`} className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span id={`${id}-label`} className="text-[11.5px] text-mute">{label}</span>
      {KIND_GROUPS.map((g) => (
        <GroupChip
          key={g.id}
          group={g}
          counts={counts}
          hidden={hidden}
          skipped={skipped}
          scopeWord={scopeWord}
          open={openId === g.id}
          onToggle={() => setOpenId((v) => (v === g.id ? null : g.id))}
          onClose={() => setOpenId((v) => (v === g.id ? null : v))}
          onChange={onChange}
        />
      ))}
      {hidden.size > 0 && <button type="button" onClick={onShowAll} className={btn}>Show all kinds</button>}
    </div>
  );
}

export function MapPage({ context, namespace, namespaces, visible, search, focus, onFocusChange, onOpenObject, onPickNamespace, mode, onModeChange, netpolPod, netpolEnter, onEntered }: Props) {
  const focusStr = focus ? `${focus.kind}/${focus.name}` : null;
  const fid = focus ? focusNodeId(focus.kind, namespace, focus.name) : null;
  const q = useResourceMap(context, namespace, focusStr, visible && mode === "resources");
  const map = q.data;

  const [hidden, setHidden] = useState<ReadonlySet<MapKind>>(new Set());
  const [view, setView] = useState<"graph" | "list">("graph");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [shows, setShows] = useState(false);
  const [showWhich, setShowWhich] = useState(false);
  const [stripFull, setStripFull] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [startKind, setStartKind] = useState<keyof typeof NAME_HOOK>("deploy");
  const [startName, setStartName] = useState("");
  const [pickNs, setPickNs] = useState("");
  const canvas = useRef<GraphCanvasHandle>(null);
  const strip = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Per-scope state resets on a stable string, never on the query result.
  const scope = `${context}/${namespace}`;
  useEffect(() => { setHidden(new Set()); setFocusedId(null); setStartName(""); }, [scope]);
  useEffect(() => { if (fid) setFocusedId(fid); }, [fid]);
  useEffect(() => { setStartName(""); }, [startKind]);

  const state = map ? mapState(map, fid) : null;
  // "Show only this": the focus's lineage. The one source for the graph, the List, the counts, the scope line and the announcement.
  const narrowed = useMemo(() => (map && state === "ok" ? lineage(map, fid) : map), [map, state, fid]);
  const prepared = useMemo(() => (narrowed && state === "ok" ? prepareMap(narrowed, hidden) : null), [narrowed, state, hidden]);
  const rawCounts = useMemo(() => countByKind(narrowed?.nodes ?? []), [narrowed]);
  const skippedSources = useMemo<MapSource[]>(() => (map?.skipped ?? []).map((s) => s.source), [map]);
  // N of "Kinds · N hidden": hidden kinds that have objects here. A stable string stands for the set in effects and the canvas epoch.
  const hiddenCount = useMemo(() => hiddenPresent(hidden, rawCounts), [hidden, rawCounts]);
  const kindsKey = useMemo(() => [...hidden].sort().join(","), [hidden]);
  const byId = useMemo(() => new Map<string, MapViewNode>((prepared?.nodes ?? []).map((n) => [n.id, n])), [prepared]);
  const matches = useMemo(() => matchIds(prepared?.nodes ?? [], search), [prepared, search]);
  // A search must not say "no match" while a hidden kind holds the object (UX 22 §3.7).
  const hiddenMatches = useMemo(
    () => (narrowed && state === "ok" && hiddenCount > 0 && search.trim() ? matchIds(narrowed.nodes.filter((n) => hidden.has(n.kind)), search).size : 0),
    [narrowed, state, hidden, hiddenCount, search],
  );

  // Links to hidden kinds, once per prepared map (a collapsed pod group counts its members' distinct links, C-5).
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of prepared?.nodes ?? []) for (const p of n.members ?? []) m.set(p.id, n.id);
    return m;
  }, [prepared]);
  const hidLinks = useMemo(
    () => (narrowed && state === "ok" && hiddenCount > 0 ? hiddenLinks(narrowed, hidden, groupOf) : NO_LINKS),
    [narrowed, state, hidden, hiddenCount, groupOf],
  );

  // Relations once per prepared map; a search keystroke only re-flags matches.
  const rels = useMemo(() => new Map((prepared?.nodes ?? []).map((n) => [n.id, relationsOf(n.id, prepared!.edges, byId)])), [prepared, byId]);
  const baseNodes = useMemo<GraphNodeView[]>(() => {
    if (!prepared) return [];
    return prepared.nodes.map((n) => {
      const rel = rels.get(n.id) ?? [];
      const verbs: string[] = [];
      for (const r of rel) {
        const i = verbs.findIndex((v) => v.startsWith(`${r.verb} `));
        if (i >= 0) verbs[i] = `${r.verb} ${Number(verbs[i].slice(r.verb.length + 1)) + 1}`;
        else verbs.push(`${r.verb} 1`);
      }
      const st = NO_STATUS_KINDS.has(n.kind) ? undefined : n.status;
      const hiddenSentence = hiddenLinkText(rel.length, hidLinks.get(n.id) ?? 0, hiddenCount > 0);
      return {
        id: n.id,
        column: MAP_COLUMN[n.kind],
        kindLabel: n.members ? "Pods" : KIND_LABEL[n.kind],
        name: n.members ? `${n.name} · ${n.counts}` : n.name,
        status: st,
        note: n.kind === "pv" ? "cluster-scoped" : undefined,
        accessibleName: `${nodeText(n)} in ${namespace}.${st ? ` ${STATUS_VIEW[st].word}.` : ""} ${verbs.length ? `${verbs.join(", ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}.` : hiddenSentence ?? "No connections."}${verbs.length && hiddenSentence ? ` ${hiddenSentence}` : ""}`,
      };
    });
  }, [prepared, rels, namespace, hidLinks, hiddenCount]);
  const canvasNodes = useMemo<GraphNodeView[]>(() => (matches.size ? baseNodes.map((n) => (matches.has(n.id) ? { ...n, match: true } : n)) : baseNodes), [baseNodes, matches]);
  const canvasEdges = useMemo<GraphEdgeView[]>(
    () => (prepared?.edges ?? []).map((e) => ({ from: e.from, to: e.to, family: edgeFamily(e.relation), label: relationLabel(e) })),
    [prepared],
  );

  // S7: the panel's Map action closes the panel; focus lands on the requested node once, when it first renders.
  const enterFocus = useRef<string | null>(null);
  // Armed per request (the host makes a new `focus` object each time), cleared when the request is gone or consumed.
  useEffect(() => { enterFocus.current = fid && focus?.enter ? fid : null; }, [focus, fid]);
  useEffect(() => {
    const id = enterFocus.current;
    if (!id || !visible || view !== "graph" || !canvasNodes.some((n) => n.id === id)) return;
    enterFocus.current = null;
    canvas.current?.focusNode(id);
    onEntered("map");
  }, [canvasNodes, visible, view, fid]);

  const open = useCallback((id: string) => {
    const n = byId.get(id);
    if (!n) return;
    if (n.members) strip.current?.querySelector<HTMLButtonElement>("[data-member-open]")?.focus(); // D6b: no expand in place
    else onOpenObject(n.kind as ResourceType, n.namespace, n.name);
  }, [byId, onOpenObject]);
  const toggleStrip = useCallback(() => setStripFull((v) => !v), []);

  // List view: the data already loaded, ungrouped, as the keyboard / screen-reader fallback.
  const flat = useMemo(() => {
    if (!narrowed || state !== "ok") return null;
    const f = hideKinds(narrowed.nodes, narrowed.edges, hidden);
    const ids = new Map<string, MapViewNode>(f.nodes.map((n) => [n.id, n]));
    const links = hiddenLinks(narrowed, hidden, NO_GROUPS); // ungrouped, like the rows
    return {
      ...f,
      text: new Map(f.nodes.map((n) => {
        const rel = relationsOf(n.id, f.edges, ids).map((r) => r.text);
        const hl = links.get(n.id) ?? 0;
        const extra = hl > 0 ? hiddenLinkText(rel.length, hl, true) : null;
        return [n.id, [rel.join(" · "), extra].filter(Boolean).join(" · ") || "No connections found."] as const;
      })),
    };
  }, [narrowed, state, hidden]);
  const sections = useMemo<GraphListSection[]>(() => {
    if (!flat) return [];
    const hit = matchIds(flat.nodes, search);
    const out: GraphListSection[] = [];
    for (const g of KIND_GROUPS) {
      for (const k of g.kinds) {
        const rows = flat.nodes
          .filter((n) => n.kind === k && (!search.trim() || hit.has(n.id)))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map((n) => ({
            id: n.id,
            status: NO_STATUS_KINDS.has(n.kind) ? undefined : n.status,
            name: n.namespace ? `${n.namespace}/${n.name}` : n.name,
            relations: flat.text.get(n.id) ?? "",
            onOpen: () => onOpenObject(n.kind as ResourceType, n.namespace, n.name),
          }));
        if (rows.length) out.push({ heading: KIND_PLURAL[k], count: rows.length, rows });
      }
    }
    return out;
  }, [flat, search, onOpenObject]);

  const announced = useRef("");
  useEffect(() => {
    if (!narrowed || !visible || !state) return;
    const key = `${scope}/${focusStr}/${state}/${prepared?.tooMany ?? ""}`;
    if (announced.current === key) return;
    announced.current = key;
    if (state === "truncated" || prepared?.tooMany) setAnnouncement("Too many objects to draw. Choose where to start.");
    else if (state === "ok") setAnnouncement(`${focus ? `Showing the chain for ${focusLabel}. ` : "Map loaded. "}${narrowed.nodes.length} objects, ${narrowed.edges.length} connections.`);
  }, [narrowed, visible, state, scope, focusStr, prepared]);

  // A kind toggle is announced once per burst (400 ms). The scope reset empties the set without a word, and the first render is not a toggle.
  const kindsSeen = useRef({ scope, key: "" });
  useEffect(() => {
    const seen = kindsSeen.current;
    if (seen.scope !== scope) { kindsSeen.current = { scope, key: "" }; return; }
    if (seen.key === kindsKey) return;
    seen.key = kindsKey;
    if (!flat || !visible || prepared?.tooMany) return; // nothing is drawn in the too-many state
    const t = setTimeout(() => setAnnouncement(kindsAnnouncement(hiddenCount, flat.nodes.length, flat.edges.length)), 400);
    return () => clearTimeout(t);
  }, [kindsKey, scope]);

  const tooManyShown = state === "truncated" || (state === "ok" && !!prepared?.tooMany);
  const requestFocus = useRefocus(root, `${namespace}|${fid ?? ""}|${state}|${tooManyShown}`, tooManyShown ? 'select[aria-label="Name"]' : '[data-graph-node][tabindex="0"]');
  const setKinds = useCallback((next: Set<MapKind>) => { requestFocus(); setHidden(next); }, [requestFocus]);
  // The "Show all kinds" buttons (the filter row's and the all-hidden sentence's) unmount with the state they clear, so focus goes to
  // the first enabled group chip, which stays. Arms useRefocus first: if showing everything crosses into the too-many state, the
  // filter row unmounts too.
  const showAllKinds = useCallback(() => {
    requestFocus();
    setHidden(new Set());
    root.current?.querySelector<HTMLElement>('[data-kind-chip]:not([aria-disabled="true"])')?.focus();
  }, [requestFocus]);

  const cur = focusedId ? byId.get(focusedId) : undefined;
  const skipped = map?.skipped ?? [];
  const focusLabel = focus ? `${KIND_LABEL[focus.kind]} ${focus.name}` : "";
  const matchLine = search.trim() && prepared ? matchLineText(matches.size, hiddenMatches) : "";

  const clearFocus = (
    <button type="button" onClick={() => { requestFocus(); onFocusChange(null); }} className={btn}>Show whole namespace</button>
  );

  const renderChooser = (rf: () => void) => (
      <Block icon={<Info size={32} />} title="The map shows one namespace at a time.">
        <div className="flex items-center gap-2">
          <select aria-label="Namespace" value={pickNs} onChange={(e) => setPickNs(e.target.value)} className="h-7 rounded-sm bg-surface-input ring-1 ring-edge text-[12px] text-ink px-1.5">
            <option value="">Choose…</option>
            {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            type="button"
            aria-disabled={!pickNs || undefined}
            title={pickNs ? undefined : "Choose a namespace first."}
            onClick={() => { if (!pickNs) return; rf(); onPickNamespace(pickNs); }}
            className="h-7 px-3 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
          >
            Show map{!pickNs && <span className="sr-only">. Choose a namespace first.</span>}
          </button>
        </div>
      </Block>
    
  );

  let body: React.ReactNode;
  if (namespace === "all") {
    body = renderChooser(requestFocus);
  } else if (!map) {
    body = q.error ? (
      <Block icon={<AlertCircle size={32} />} title="Couldn't build the map." body={(q.error as any)?.message ?? String(q.error)}>
        <button onClick={() => void q.refetch()} className="h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12px] hover:bg-accent/25">Retry</button>
      </Block>
    ) : (
      <div role="status" className="flex flex-col gap-2">
        <span className="text-[12px] text-mute">Mapping namespace {namespace}…</span>
        <div aria-hidden className="flex gap-4">
          {[0, 1, 2].map((c) => (
            <div key={c} className="flex flex-col gap-4">
              {[0, 1, 2].map((r) => <div key={r} className="w-46 h-13 rounded-md bg-surface-tint/4" />)}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (state === "truncated" || (state === "ok" && prepared?.tooMany)) {
    const truncated = state === "truncated";
    const hint = truncated
      ? focus
        ? `The objects connected to ${focusLabel} are too many to load (more than 2,000). Start from a narrower object.`
        : `More than 2,000 objects in namespace ${namespace}.`
      : focus
      ? `The chain for ${focusLabel} has ${prepared!.count} objects (the limit is ${DRAW_CAP}). Hide ConfigMaps and Secrets, or start from a narrower object.`
      : `${prepared!.count} objects in namespace ${namespace} (the limit is ${DRAW_CAP}). Start from one object, or hide some kinds.`;
    body = (
      <Block icon={<Ban size={32} />} title={focus ? (truncated ? "Too many objects to load." : "This chain has too many objects to draw.") : "This namespace has too many objects to draw."} body={hint}>
        <div className="flex flex-col gap-3 items-center">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="text-[11.5px] text-mute">Start from an object:</span>
            <select aria-label="Kind" value={startKind} onChange={(e) => setStartKind(e.target.value as keyof typeof NAME_HOOK)} className="h-6 rounded-sm bg-surface-input ring-1 ring-edge text-[11.5px] text-ink px-1">
              {START_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            {visible && <NameSelect key={startKind} kind={startKind} context={context} namespace={namespace} value={startName} onChange={setStartName} />}
            <button
              type="button"
              aria-disabled={!startName || undefined}
              title={startName ? undefined : "Choose an object first."}
              onClick={() => { if (!startName) return; requestFocus(); onFocusChange({ kind: startKind, name: startName }); }}
              className={`${btn} aria-disabled:opacity-50 aria-disabled:cursor-not-allowed`}
            >
              Show map{!startName && <span className="sr-only">. Choose an object first.</span>}
            </button>
          </div>
          {!truncated && (
            <KindFilter label="Or hide kinds:" counts={rawCounts} hidden={hidden} skipped={skippedSources} onChange={setKinds} onShowAll={showAllKinds} scopeWord={focus ? "chain" : "namespace"} className="justify-center" />
          )}
          {focus && clearFocus}
        </div>
      </Block>
    );
  } else if (state === "no-access") {
    body = (
      <Block icon={<ShieldOff size={32} />} title={`You don't have access to pods in namespace ${namespace}.`} body="Your account can't list pods. Ask a cluster admin for the list permission.">
        <button type="button" onClick={() => { requestFocus(); onPickNamespace("all"); }} className={btn}>Try a namespace</button>
      </Block>
    );
  } else if (state === "focus-gone") {
    body = <Block icon={<Info size={32} />} title={`${focus ? `${KIND_LABEL[focus.kind]} "${focus.name}"` : "That object"} isn't in namespace ${namespace}.`}>{clearFocus}</Block>;
  } else if (state === "nothing-partial") {
    body = <Block icon={<Info size={32} />} title="Nothing found in what could be read." />;
  } else if (state === "nothing") {
    body = <Block icon={<Circle size={32} />} title={`No objects to map in namespace ${namespace}.`} />;
  } else if (prepared) {
    const show = view === "graph" && prepared.nodes.length > 0;
    body = (
      <>
        {prepared.nodes.length === 0 ? (
          <div className="flex items-center gap-3 flex-wrap px-1">
            <p className="text-[12px] text-mute">All kinds are hidden. Turn a kind back on to see the map.</p>
            <button type="button" onClick={showAllKinds} className={btn}>Show all kinds</button>
          </div>
        ) : show ? (
          <div className="h-[60vh] min-h-80">
            <MemoCanvas
              ref={canvas}
              nodes={canvasNodes}
              edges={canvasEdges}
              focusedId={focusedId}
              onFocus={setFocusedId}
              onOpen={open}
              onExpandDetails={toggleStrip}
              ariaLabel={`Resource map for namespace ${namespace}`}
              epoch={`${kindsKey}|${focusStr ?? ""}`}
              fitKey={focusStr ?? ""}
            />
          </div>
        ) : sections.length ? (
          <GraphList sections={sections} />
        ) : (
          <p className="text-[12px] text-mute px-1">{matchLine || "Nothing to list."}</p>
        )}
        {show && (
          <section ref={strip} aria-label="Details" className={`rounded-lg bg-card/70 ring-1 ring-edge p-3 text-[11.5px] overflow-auto ${stripFull ? "max-h-[60vh]" : "h-28"}`}>
            {cur ? renderDetails(cur) : <p className="text-mute">Select a node to see what it is connected to.</p>}
          </section>
        )}
      </>
    );
  }

  if (mode === "netpol") {
    return (
      <NetpolView
        context={context}
        namespace={namespace}
        visible={visible}
        search={search}
        modeToggle={<ModeToggle mode={mode} onChange={onModeChange} />}
        chooser={renderChooser}
        podName={netpolPod}
        enter={netpolEnter}
        onEntered={() => onEntered("netpol")}
        onOpenObject={onOpenObject}
      />
    );
  }

  // A plain function, not a component: a nested component would remount (and drop focus) on every render.
  function renderDetails(n: MapViewNode) {
    const rel = rels.get(n.id) ?? [];
    const st = NO_STATUS_KINDS.has(n.kind) ? null : STATUS_VIEW[n.status];
    const verbs = [...new Set(rel.map((r) => r.verb))];
    // Edges to hidden kinds are not listed; say how many there are (UX 22 §3.7). Replaces "No connections found" when that would be false.
    const hiddenText = hiddenCount > 0 && (hidLinks.get(n.id) ?? 0) > 0 ? hiddenLinkText(rel.length, hidLinks.get(n.id) ?? 0, true) : null;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-mute">{n.members ? "Pods" : KIND_LABEL[n.kind]}</span>
          <span className="mono break-all text-ink">{n.members ? `${n.members.length} pods in ${n.namespace}` : n.namespace ? `${n.namespace}/${n.name}` : n.name}</span>
          {n.kind === "pv" && <span className="text-mute">cluster-scoped</span>}
          {st && <span className="text-ink"><span aria-hidden className={st.tone}>{st.glyph}</span> {st.word}</span>}
          {matches.has(n.id) && <span className="text-accent">match</span>}
          <span className="flex-1" />
          {!n.members && <button type="button" className={btn} onClick={() => open(n.id)}>Open ↗</button>}
          {!n.members && n.id !== fid && (
            <button type="button" className={btn} onClick={() => { requestFocus(); onFocusChange({ kind: n.kind, name: n.name }); }}>Show only this</button>
          )}
        </div>
        {n.members && (
          <ul className="flex flex-col gap-1">
            {[...n.members].sort((a, b) => badness(b.status) - badness(a.status) || (a.name < b.name ? -1 : 1)).map((m) => {
              const ms = STATUS_VIEW[m.status];
              return (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="w-20 shrink-0"><span aria-hidden className={ms.tone}>{ms.glyph}</span> {ms.word}</span>
                  <span className="mono break-all flex-1">{m.name}</span>
                  <button type="button" data-member-open className={btn} aria-label={`Open Pod ${m.name}`} onClick={() => onOpenObject("pods", m.namespace, m.name)}>Open ↗</button>
                </li>
              );
            })}
          </ul>
        )}
        {verbs.map((v) => (
          <p key={v} className="text-mute">
            {v}:{" "}
            {rel.filter((r) => r.verb === v).map((r) => (
              <button key={`${r.relation}${r.other}${r.outgoing}`} type="button" onClick={() => canvas.current?.focusNode(r.other)} className="mr-2 text-ink hover:underline focus-visible:underline focus-visible:ring-1 focus-visible:ring-accent/60 rounded-sm">
                {r.text.slice(v.length + 1)} ▸
              </button>
            ))}
          </p>
        ))}
        {hiddenText && <p className="text-mute">{hiddenText}</p>}
        {rel.length === 0 && !hiddenText && (
          <p className="text-mute">No connections found for this object. References to objects that don&apos;t exist aren&apos;t shown.</p>
        )}
      </div>
    );
  }

  const scopeLine = namespace === "all" ? "Choose a namespace" : narrowed && state !== "truncated" ? `Namespace ${namespace} · ${narrowed.nodes.length} objects · ${narrowed.edges.length} connections` : `Namespace ${namespace}${map ? "" : " · Checking…"}`;

  return (
    <div ref={root} className={`flex-1 min-h-0 min-w-0 overflow-auto p-4 flex flex-col gap-3 ${visible ? "" : "hidden"}`}>
      <div role="status" aria-live="polite" className="sr-only">{visible ? announcement : ""}</div>
      <PageHeader
        title="Map"
        subtitle={scopeLine}
        checkedAt={map ? q.dataUpdatedAt : undefined}
        toggle={{ label: "What this map shows", open: shows, onToggle: () => setShows((v) => !v) }}
      />
      <ModeToggle mode={mode} onChange={onModeChange} />
      {shows && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3 text-[11.5px] text-mute flex flex-col gap-1.5">
          <h2 className="text-[12px] font-semibold text-ink">What this map shows</h2>
          <p>
            Connections Kubernetes records on the objects themselves: ownership, Service and PodDisruptionBudget selectors, Ingress and
            HTTPRoute backends, Gateway routes, volumes (including projected sources), environment references, PVC binding, and
            HorizontalPodAutoscaler targets. Gateway and HTTPRoute appear only when the cluster has the Gateway API.
          </p>
          <p>Not shown: live traffic, connections inferred from events, other namespaces (except PersistentVolumes), and references to objects that don&apos;t exist.</p>
          <p>Secrets appear by name only. No values are read. The cluster CA ConfigMap that every pod mounts isn&apos;t shown.</p>
        </div>
      )}
      {focus && state !== "focus-gone" && (
        <p className="rounded-lg bg-info/10 ring-1 ring-info/30 text-[11.5px] text-ink px-3 py-2 flex items-center gap-2">
          <Info size={13} className="text-info shrink-0" aria-hidden />
          <span className="flex-1">{narrowed ? focusBanner(focusLabel, narrowed.nodes.length, map!.nodes.length) : `Showing the chain for ${focusLabel}.`}</span>
          {clearFocus}
        </p>
      )}
      {skipped.length > 0 && state !== "truncated" && (
        <PartialStrip
          which={skipped.map((s) => (
            <li key={s.source}><span className="mono text-ink">{s.source}</span> ({s.reason}). {SKIPPED_COPY[s.source]}</li>
          ))}
          open={showWhich}
          onToggle={() => setShowWhich((v) => !v)}
        >
          {skipped.length === 1
            ? <>Partially visible. Couldn&apos;t read {skipped[0].source} ({skipped[0].reason}). {SKIPPED_COPY[skipped[0].source]}</>
            : <>Partially visible. Couldn&apos;t read {skipped.length} sources: {skipped.map((s) => s.source).join(", ")}.</>}
        </PartialStrip>
      )}
      {q.isRefetchError && map && <StaleStrip at={q.dataUpdatedAt} />}
      {prepared && !prepared.tooMany && (
        <div className="flex flex-wrap items-center gap-2">
          <KindFilter label="Show:" counts={rawCounts} hidden={hidden} skipped={skippedSources} onChange={setKinds} onShowAll={showAllKinds} scopeWord={focus ? "chain" : "namespace"} />
          <span className="flex-1" />
          {matchLine && <span className="text-[11.5px] text-mute" role="status">{matchLine}</span>}
          <Segmented label="Map view" value={view} options={[["graph", "Graph"], ["list", "List"]] as const} onChange={setView} />
        </div>
      )}
      {body}
      {prepared && !prepared.tooMany && (
        <div aria-label="Legend" role="group" className="text-[11px] text-mute flex flex-col gap-0.5">
          <p>Solid line: owns, selects, routes to, attaches to. Dashed: mounts, binds, uses config, uses secret. Dotted: scales, protects.</p>
          <p>Status summarises each object&apos;s state, in the style of the resource lists. References to objects that don&apos;t exist aren&apos;t shown.</p>
        </div>
      )}
    </div>
  );
}

const badness = (s: string) => ({ ok: 0, unknown: 1, warn: 2, bad: 3 })[s] ?? 0;
