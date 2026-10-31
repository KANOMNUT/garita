import { useEffect, useState } from "react";
import { ArrowUpRight, Boxes, Save, Trash2, X } from "lucide-react";
import { useResizablePanel } from "../hooks/useResizablePanel";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import {
  useCustomResource, useCustomResourcePermissions, useCustomResourceYaml, useCustomResourceYamlNeat, useResourceEvents,
} from "../hooks/useResources";
import type { CRD, CRDResource, CustomResourceDetail, ResourceType } from "../types/k8s";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { crDeniedReason } from "../utils/crds";
import { disabledAttrs, pickDisabledReason } from "../utils/guardrails";
import { isForbidden } from "../utils/viewState";
import { loadNeatPref, saveNeatPref } from "../utils/neatYaml";
import { NEAT_NO_MATCH_HINT } from "../utils/yamlFind";
import { ConditionsTable } from "./ConditionsTable";
import { EventsTabContent } from "./EventsTabContent";
import { NeatChip, NeatNote } from "./NeatYaml";
import { KV, resolveManagedBy } from "./ResourceDetailPanel";
import { YamlFind } from "./YamlFind";
import { YamlSaveGate } from "./YamlSaveGate";

// The panel of one custom resource (an object of a CRD), v2.4.1: Overview, Summary, Events and YAML, plus the two writes,
// a YAML edit through the Review and save gate and a delete (the host owns the delete confirm).
//
// It is a component of its own, not a SelectedResource member (plan D2): a custom resource has a runtime group,
// version and kind, and the per-kind tables are keyed by a static kind. Every call is a hook in useResources.ts,
// addressed by the CRD (crdRef) plus namespace and name, so the panel never reaches the backend itself.
// `item` is identity only: name and namespace ("" for a cluster-scoped object). The host (App.tsx) keys the panel by
// that identity, so the open tab and the neat choice reset per object, and renders it only for the CRD on screen.

const TABS = ["Overview", "Summary", "Events", "YAML"] as const;
type Tab = (typeof TABS)[number];

/** A focus ring of at least 3:1 in both themes, for a control that has no clipping edge. */
const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70";
/** The same ring drawn inside the control: the tab strip scrolls sideways, so an outer ring would be clipped. */
const INSET_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70";
const SMALL_BTN = `h-6 px-2 rounded-sm bg-card/80 ring-1 ring-edge text-[10.5px] text-mute hover:text-ink ${FOCUS_RING}`;

/** Q4 B: a custom resource's conditions have no common meaning for False, so only Ready is coloured. */
const isReadyCondition = (type: string) => type === "Ready";

function Skeleton({ rows }: { rows: number }) {
  return (
    <div role="status" aria-label="Loading." className="flex flex-col gap-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 rounded-lg bg-surface-tint/3 animate-pulse" />
      ))}
    </div>
  );
}

function Overview({ crd, detail }: { crd: CRD; detail: CustomResourceDetail }) {
  const clusterScoped = crd.scope === "Cluster";
  return (
    <>
      <KV k="Kind" v={detail.kind} />
      <KV k="API version" v={detail.api_version} />
      {clusterScoped
        ? <KV k="Scope" v="Cluster" mono={false} />
        : <KV k="Namespace" v={detail.namespace} />}
      {/* The creation time is the tooltip as the API sent it (RFC 3339), not parsed. */}
      <KV k="Age" v={detail.age} title={detail.created || undefined} />
      {/* status.phase, else status.state; empty when neither is a string. */}
      {detail.phase !== "" && <KV k="Phase" v={detail.phase} mono={false} />}
      {detail.generation !== null && <KV k="Generation" v={String(detail.generation)} />}
      {detail.observed_generation !== null && <KV k="Observed generation" v={String(detail.observed_generation)} />}
      {detail.owners.length > 0 && (
        <KV
          k="Owners"
          wrap
          v={detail.owners.map((o) => `${o.kind}/${o.name}${o.controller ? " (controller)" : ""}`).join(", ")}
        />
      )}
      <KV k="Finalizers" wrap v={detail.finalizers.length > 0 ? detail.finalizers.join(", ") : "None"} />
      {detail.deletion_timestamp && <KV k="Deletion requested" v={detail.deletion_timestamp} />}
    </>
  );
}

function Summary({ detail, onNavigate }: {
  detail: CustomResourceDetail;
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
}) {
  const [showAnnotations, setShowAnnotations] = useState(false);
  const labels = Object.entries(detail.labels);
  const annotations = Object.entries(detail.annotations);
  const managedBy = resolveManagedBy(detail.annotations, detail.labels);
  if (!managedBy && detail.conditions.length === 0 && labels.length === 0 && annotations.length === 0) {
    return <p className="p-4 text-[12px] text-mute">No conditions, labels or annotations.</p>;
  }
  return (
    <div className="p-4 flex flex-col gap-4 overflow-auto">
      {managedBy && (
        <button
          type="button"
          onClick={() => onNavigate?.("argocd", "", managedBy.app)}
          className={`flex items-center gap-2 rounded-lg bg-card/70 ring-1 ring-edge p-3 text-left hover:bg-surface-tint/3 transition-colors group ${FOCUS_RING}`}
        >
          <span className="text-[11px] uppercase tracking-wider text-mute shrink-0">
            {managedBy.confident ? "Managed by" : "Possibly managed by"}
          </span>
          <span className={`mono text-[12px] ${managedBy.confident ? "text-accent" : "text-mute"}`}>{managedBy.app}</span>
          <ArrowUpRight size={12} aria-hidden className="text-mute opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity ml-auto" />
        </button>
      )}

      <ConditionsTable conditions={detail.conditions} colourFor={isReadyCondition} />

      {labels.length > 0 && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-mute mb-2">Labels</h3>
          <div className="flex flex-wrap gap-1.5">
            {labels.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 ring-1 ring-accent/20 text-[11px] mono"
              >
                <span className="text-accent">{k}</span>
                <span className="text-mute">=</span>
                <span className="text-ink">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {annotations.length > 0 && (
        <div className="rounded-lg bg-card/70 ring-1 ring-edge p-3">
          <button
            type="button"
            onClick={() => setShowAnnotations((v) => !v)}
            aria-expanded={showAnnotations}
            className={`flex items-center justify-between w-full rounded-xs ${FOCUS_RING}`}
          >
            <h3 className="text-[11px] uppercase tracking-wider text-mute">Annotations ({annotations.length})</h3>
            <span className="text-mute text-[11px]">{showAnnotations ? "Hide" : "Show"}</span>
          </button>
          {showAnnotations && (
            <div className="mt-2 flex flex-col gap-1">
              {annotations.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[11px]">
                  <span className="mono text-accent shrink-0">{k}:</span>
                  <span className="text-mute truncate" title={v}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CustomResourcePanel({ context, crd, item, onClose, onNavigate, onRequestDelete }: {
  context: string;
  crd: CRD;
  /** Identity only: name, and namespace ("" when the CRD is cluster-scoped). */
  item: CRDResource;
  onClose: () => void;
  /** "Managed by": ("argocd", "", app). */
  onNavigate?: (kind: ResourceType, namespace: string, name: string) => void;
  /** The header trash asks the host to open the delete confirm (one dialog, also opened by the list's row trash). Without it there is no trash. */
  onRequestDelete?: () => void;
}) {
  const identity = useClusterIdentity(context);
  const perm = useCustomResourcePermissions(context, crd, item.namespace);
  const { width, startResize } = useResizablePanel("detail-panel-width");
  const [tab, setTab] = useState<Tab>("Overview");
  const namespaced = crd.scope !== "Cluster";

  // Overview and Summary share one query, and only they keep it polling.
  const detailQ = useCustomResource(context, crd, item.namespace, item.name, tab === "Overview" || tab === "Summary");
  const detail = detailQ.data;
  const detailError = detailQ.error ? ((detailQ.error as any)?.message ?? String(detailQ.error)) : "";

  const eventsQ = useResourceEvents(context, item.namespace, item.name, tab === "Events", crd.kind);

  // YAML. The neat text is DISPLAY ONLY (Copy neat copies it); the full text is the other query, Copy, and the only
  // editor seed: the neat text never reaches the editor or a save.
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  useEffect(() => {
    if (tab !== "YAML") { setEditMode(false); setConfirmSave(false); }
  }, [tab]);
  const [neat, setNeat] = useState(loadNeatPref);
  const toggleNeat = () => setNeat((v) => { saveNeatPref(!v); return !v; });
  const yamlQ = useCustomResourceYaml(context, crd, item.namespace, item.name, tab === "YAML");
  const neatQ = useCustomResourceYamlNeat(context, crd, item.namespace, item.name, tab === "YAML" && neat && !editMode);
  const yamlContent = yamlQ.data ?? "";
  const neatShown = neat && !editMode && !!neatQ.data;
  const shownYaml = neatShown && neatQ.data ? neatQ.data.yaml : yamlContent;
  const yamlSkeleton = yamlQ.isLoading || (neat && !editMode && neatQ.isLoading);
  const yamlError = yamlQ.error ? ((yamlQ.error as any)?.message ?? String(yamlQ.error)) : "";
  const copyYaml = useCopyFeedback();
  const yamlCopyLabel = copyYaml.state === "copied"
    ? (neatShown ? "Copied neat YAML" : "Copied")
    : copyYaml.state === "failed" ? "Couldn't copy" : neatShown ? "Copy neat" : "Copy";

  // DISABLE-PRECEDENCE: read-only first, then an explicit RBAC denial. The controls stay present and focusable (never hidden);
  // their click bails out. Edit has a third, "capability" reason: no YAML to edit yet, or the load failed.
  const updateReason = pickDisabledReason({
    readOnly: identity.readOnly,
    rbac: perm.canUpdate ? undefined : crDeniedReason("update", crd.plural, item.namespace),
  });
  const deleteReason = pickDisabledReason({
    readOnly: identity.readOnly,
    rbac: perm.canDelete ? undefined : crDeniedReason("delete", crd.plural, item.namespace),
  });
  const editReason = pickDisabledReason({
    readOnly: identity.readOnly,
    rbac: perm.canUpdate ? undefined : crDeniedReason("update", crd.plural, item.namespace),
    capability: yamlQ.isLoading ? "The YAML is still loading." : yamlQ.isError ? "The YAML didn't load." : undefined,
  });

  // What Overview and Summary show instead of the object: loading, gone, no access, or a failure.
  let detailState: JSX.Element | null = null;
  if (!detail) {
    if (detail === null) {
      detailState = <p className="py-8 text-center text-[12.5px] text-mute">This {crd.kind} no longer exists.</p>;
    } else if (detailQ.isError && isForbidden(detailError)) {
      // No Retry: a 403 repeats.
      detailState = <p role="alert" className="py-8 text-center text-[12.5px] text-mute">You don&apos;t have access to read this {crd.kind}.</p>;
    } else if (detailQ.isError) {
      detailState = (
        <div role="alert" className="py-8 flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] text-bad wrap-break-word max-w-full">{detailError}</p>
          <button type="button" onClick={() => void detailQ.refetch()} className={`h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink ${FOCUS_RING}`}>
            Retry
          </button>
        </div>
      );
    } else {
      detailState = <Skeleton rows={6} />;
    }
  }

  return (
    <aside className="slide-in shrink-0 bg-panel/95 border-l border-edge flex flex-col relative" style={{ width: `${width}px` }}>
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute left-0 inset-y-0 w-1.5 cursor-col-resize z-20 group hover:bg-accent/30 transition-colors"
      >
        <div className="absolute left-0 inset-y-0 w-px bg-edge group-hover:bg-accent/60 transition-colors" />
      </div>

      {/* header: kind, name, namespace chip. No status chip (the conditions are in Summary). */}
      <div className="px-4 pt-3 pb-3 border-b border-edge">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-mute">
              <Boxes size={11} aria-hidden />
              <span>{crd.kind}</span>
            </div>
            <h3 className="mono text-[14px] mt-1 break-all leading-tight">{item.name}</h3>
            {namespaced && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span
                  title="Namespace"
                  className="inline-flex items-center px-2 py-[3px] rounded-md text-[11px] mono ring-1 ring-edge text-mute"
                >
                  <span className="sr-only">Namespace: </span>
                  {item.namespace}
                </span>
              </div>
            )}
          </div>
          {onRequestDelete && (
            <button
              type="button"
              onClick={(e) => {
                if (deleteReason) return;
                // Focus the opener first: the confirm returns focus to what was focused when it opened (WebKit does not focus on click).
                e.currentTarget.focus();
                onRequestDelete();
              }}
              aria-label={`Delete ${crd.kind} ${item.name}`}
              title={`Delete ${crd.kind} ${item.name}`}
              {...disabledAttrs(deleteReason)}
              className={`h-7 w-7 -mr-1 rounded-md hover:bg-bad/10 text-mute hover:text-bad flex items-center justify-center transition-colors ${FOCUS_RING} ${deleteReason ? "opacity-30 cursor-not-allowed" : ""}`}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${crd.kind} panel`}
            title="Close (Esc)"
            className={`h-7 w-7 -mr-1 rounded-md hover:bg-surface-tint/6 text-mute hover:text-ink flex items-center justify-center ${FOCUS_RING}`}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      </div>

      {/* tabs */}
      <div role="group" aria-label={`${crd.kind} sections`} className="flex items-center gap-0.5 px-4 border-b border-edge shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "true" : undefined}
            className={`relative h-9 px-2.5 text-[12px] shrink-0 whitespace-nowrap ${INSET_RING} ${tab === t ? "text-ink" : "text-mute hover:text-ink"}`}
          >
            {t}
            {tab === t && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-t bg-accent" />}
          </button>
        ))}
      </div>

      {/* tab content */}
      <div className="flex-1 overflow-y-auto fade-in" key={tab}>
        {tab === "Overview" && (
          <div className="p-4">
            <div className="rounded-xl bg-card/70 ring-1 ring-edge hairline p-3 pt-2">
              {detail ? <Overview crd={crd} detail={detail} /> : detailState}
            </div>
          </div>
        )}

        {tab === "Summary" && (detail ? <Summary detail={detail} onNavigate={onNavigate} /> : <div className="p-4">{detailState}</div>)}

        {tab === "Events" && (
          <EventsTabContent
            events={eventsQ.data ?? []}
            isLoading={eventsQ.isLoading}
            error={eventsQ.error}
            onRetry={() => { void eventsQ.refetch(); }}
            kind={crd.kind}
            scopedToKind
            childEventsNote={false}
          />
        )}

        {tab === "YAML" && (
          <div className="p-3 flex flex-col gap-2">
            {yamlSkeleton ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-2.5 rounded-sm bg-surface-tint/4 animate-pulse" style={{ width: `${40 + (i % 3) * 20}%` }} />
                ))}
              </div>
            ) : yamlError && !yamlContent ? (
              // A failed request is an error, never a blank YAML view. Stale text from an earlier fetch stays visible instead.
              <div role="alert" className="py-12 flex flex-col items-center gap-3 text-center">
                <p className="text-[13px] text-bad wrap-break-word max-w-full">Couldn&apos;t load YAML: {yamlError}.</p>
                <button type="button" onClick={() => void yamlQ.refetch()} className={`h-7 px-3 rounded-md bg-card/80 ring-1 ring-edge text-[11.5px] text-mute hover:text-ink ${FOCUS_RING}`}>
                  Retry
                </button>
              </div>
            ) : (
              // Keyed on the object identity, so the find bar never outlives its object.
              <YamlFind
                key={`${context}\u0000${crd.name}\u0000${item.namespace}\u0000${item.name}`}
                text={editMode ? editContent : shownYaml}
                noun="YAML"
                regionLabel={`${crd.kind} ${item.name} YAML`}
                edit={editMode ? {
                  onChange: setEditContent,
                  onKeyDown: (e) => {
                    // ⌘S / Ctrl+S opens the review gate; it never saves by itself.
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                      e.preventDefault();
                      if (!updateReason) setConfirmSave(true);
                    }
                  },
                } : null}
                noMatchHint={neatShown && (neatQ.data?.hidden.length ?? 0) > 0
                  ? { text: NEAT_NO_MATCH_HINT, action: { label: "Search full object", run: toggleNeat } }
                  : null}
              >
                {({ findButton, bar, content }) => editMode ? (
                  <>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-warn">Editing — changes apply directly to the cluster</span>
                      <div className="flex-1" />
                      {findButton}
                      <NeatChip on={neat} onToggle={toggleNeat} editing />
                      <button type="button" onClick={() => setEditMode(false)} className={SMALL_BTN}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (updateReason) return; setConfirmSave(true); }}
                        {...disabledAttrs(updateReason)}
                        className={`h-6 px-2 rounded-sm bg-accent/20 ring-1 ring-accent/30 text-[10.5px] text-accent hover:bg-accent/30 flex items-center gap-1.5 ${FOCUS_RING} ${updateReason ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <Save size={12} aria-hidden /> Review &amp; save…
                      </button>
                    </div>
                    {confirmSave && (
                      <YamlSaveGate crd={crd}
                        context={context}
                        namespace={item.namespace}
                        resourceType="crd-instances"
                        name={item.name}
                        kindLabel={crd.kind}
                        yaml={editContent}
                        hasForm={false}
                        onOpenForm={() => {}}
                        onClose={() => setConfirmSave(false)}
                        onSaved={() => { setConfirmSave(false); setEditMode(false); }}
                      />
                    )}
                    <NeatNote hidden={[]} editing />
                    {bar}
                    {content}
                  </>
                ) : (
                  <div className="flex flex-col gap-2 min-w-0">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {findButton}
                      <NeatChip on={neat} onToggle={toggleNeat} editing={false} />
                      <button
                        type="button"
                        onClick={() => { void copyYaml.copy(shownYaml); }}
                        title={neatShown ? "Copies the neat YAML, without the hidden fields." : undefined}
                        className={SMALL_BTN}
                      >
                        {yamlCopyLabel}
                      </button>
                      <span role="status" className="sr-only">{copyYaml.state === "idle" ? "" : yamlCopyLabel}</span>
                      <button
                        type="button"
                        onClick={() => { if (editReason) return; setEditContent(yamlQ.data ?? ""); setEditMode(true); }}
                        {...disabledAttrs(editReason)}
                        className={`${SMALL_BTN} flex items-center gap-1 ${editReason ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <Save size={12} aria-hidden /> Edit
                      </button>
                    </div>
                    {neat && (
                      <div className="min-w-0">
                        <NeatNote
                          hidden={neatQ.data?.hidden ?? []}
                          editing={false}
                          error={neatQ.error ? ((neatQ.error as any)?.message ?? String(neatQ.error)) : undefined}
                        />
                      </div>
                    )}
                    {bar}
                    {content}
                  </div>
                )}
              </YamlFind>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
