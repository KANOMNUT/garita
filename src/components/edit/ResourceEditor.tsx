import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2, AlertTriangle } from "lucide-react";
import { useResourceJson, usePatchResource } from "../../hooks/useResources";
import type { ResourceType } from "../../types/k8s";
import { RESOURCE_QUERY_KEY } from "../../utils/resourceQueryKey";
import { EDIT_FORM } from "./registry";
import { mergePatch } from "./patch";
import { resolveManagedBy } from "../ResourceDetailPanel";
import { ClusterBadge } from "../ConfirmModal";
import { useClusterIdentity } from "../../utils/clusterIdentity";
import { useModalLayer } from "../../utils/modalLayer";
import { GuardrailBlock, useWriteGate } from "../GuardrailGate";
import { patchEquiv } from "../../utils/kubectlEquiv";

interface ResourceEditorProps {
  open: boolean;
  onClose: () => void;
  context: string;
  namespace: string; // "" for cluster-scoped kinds — pass through whatever
                      // ResourceDetailPanel's own resourceNamespace() already
                      // computed; do not special-case any kind here.
  resourceType: ResourceType;
  name: string;
  /** Friendly display label (e.g. "Deployment") for the modal title —
   *  supplied by the caller, which already has kindLabel() in scope, rather
   *  than duplicating that lookup here. */
  kindLabel: string;
  /** F10: adds a "See field managers" link to the managed-by banner (closes the editor, opens the Summary section). */
  onSeeFieldManagers?: () => void;
}

type Mode = "form" | "patch";

export function ResourceEditor({ open, onClose, context, namespace, resourceType, name, kindLabel, onSeeFieldManagers }: ResourceEditorProps) {
  const Form = EDIT_FORM[resourceType];

  const [mode, setMode] = useState<Mode>("form");
  // `base` is the diff base — frozen to the FIRST successful fetch per
  // "open" session, not the latest one. Without this, a background refetch
  // of resource-json mid-session (staleTime: 0 means one can happen any
  // time React Query decides to revalidate) would move `live` out from
  // under an already-seeded Form: the Form does not reseed (its effect
  // deps are its own state only, by registry.ts's frozen contract), so a
  // diff against the newly-arrived `live` would compare the Form's
  // old-base-relative edits against a base object the Form was never shown
  // — a phantom patch that could revert unrelated server-side changes made
  // after this session opened. `base` and `next` are always seeded from
  // the exact same fetch, and the Form is given `base` (never the raw
  // query result) as its `live` prop for exactly this reason.
  const [base, setBase] = useState<Record<string, any> | undefined>(undefined);
  const [next, setNext] = useState<Record<string, any> | undefined>(undefined);
  const [valid, setValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  const { data: live, isLoading: liveLoading, isFetching: liveFetching, error: liveError } = useResourceJson(
    context, namespace, resourceType, name, open,
  );
  const patchResource = usePatchResource();
  const qc = useQueryClient();
  const identity = useClusterIdentity(context);
  const gate = useWriteGate(context, open);
  const isTopmost = useModalLayer(open);

  // Stable across re-renders — required so each form's own reporting
  // useEffect (registry.ts's frozen contract) can safely list only its own
  // state in its deps without this identity changing underneath it.
  const handleFormChange = useCallback((n: Record<string, any>, v: boolean) => {
    setNext(n);
    setValid(v);
  }, []);

  // The modal container itself never unmounts (same pattern as
  // ResourceCreator), so reset on every open — and again if re-opened
  // against a different resource — otherwise reopening on a different
  // resource could submit the previous resource's patch before the new
  // form's first reporting effect fires.
  useEffect(() => {
    if (open) {
      setMode("form");
      setBase(undefined);
      setNext(undefined);
      setValid(false);
      setStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceType, namespace, name]);

  // Seed `base`/`next` from the freshly-fetched live object — but ONLY the
  // first time per "open" session (the reset effect above sets both back to
  // undefined on open/reopen). Do NOT reseed on a LATER `live` refetch while
  // the modal is still up — e.g. a dry run's own `resource-json`
  // invalidation, or any other cause — or the user's in-progress edits
  // vanish out from under them: the Form child doesn't remount on a `live`
  // identity change, so its inputs keep showing the edited values while
  // `next` silently resets to a clean clone underneath, leaving Apply/Dry
  // run disabled and the Patch preview reading "No changes." even though
  // the screen still shows the edit. `base` is never mutated (EditFormProps
  // says so), so it can hold the query's own object reference directly —
  // only `next` needs a clone.
  // Re-run on `open` too, and seed only once the open-triggered fetch settles
  // (`!isFetching`): the component stays mounted while closed, the query cache
  // keeps `live` with the SAME reference (structural sharing), so on reopen
  // `[live]` alone never fires and the reset effect above leaves base undefined
  // forever (empty modal). Waiting out the fetch also avoids seeding from
  // cache data of an earlier session. A mid-edit background refetch still can't
  // reseed: `prev ??` keeps the frozen base.
  useEffect(() => {
    if (open && live && !liveFetching) {
      setBase((prev) => prev ?? live);
      setNext((prev) => prev ?? structuredClone(live));
    }
  }, [open, live, liveFetching]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // Only the topmost layer reacts: a ConfirmModal opened over this dialog
      // takes Esc itself (it stops propagation) and this one stays open.
      if (e.key === "Escape" && !loading && isTopmost()) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, loading, onClose, isTopmost]);

  if (!open) return null;

  // §4.1: normalise `undefined` -> `{}` exactly ONCE, here. Everything
  // downstream (preview, empty-check, invoke) sees a plain object, never
  // `undefined` — mergePatch's `unknown` return is dynamic-JSON by design
  // (mirrors `live`/`next` on EditFormProps), so a cast is the correct tool
  // here, not an escape hatch. Diffed against `base`, not the raw query
  // result — see the seeding effect above for why.
  const rawPatch = base && next ? mergePatch(base, next) : undefined;
  const patch = (rawPatch ?? {}) as Record<string, any>;
  const hasChanges = Object.keys(patch).length > 0;
  // Read-only blocks both buttons (the backstop refuses a dry run too); the typed guardrail
  // gates only the real write.
  const canSubmit = hasChanges && valid && !!base && !loading && !gate.readOnly;
  const canApply = canSubmit && gate.typedOk;

  const managedBy = base ? resolveManagedBy(base.metadata?.annotations ?? {}, base.metadata?.labels ?? {}) : null;

  const submit = async (dryRun: boolean) => {
    if (!hasChanges) return;
    setStatus(null);
    setLoading(true);
    try {
      const result = await patchResource.mutateAsync({ context, namespace, resourceType, name, patch, dryRun });
      // Mirrors ResourceCreator's defensive dry-run check: an additive
      // backend flag that hasn't landed yet would be silently dropped by
      // Tauri's arg deserializer, so a "Dry run" click could patch for real
      // while reporting success as a validation. Use the response itself to
      // detect whether the backend actually honored the flag, rather than
      // trusting the request.
      if (dryRun && !result.includes("dry run")) {
        setStatus({
          msg: `Backend does not support dry-run yet — this call patched the resource for real. (${result})`,
          ok: false,
        });
        // usePatchResource's onSuccess skips invalidation whenever `dryRun`
        // was requested — a real dry run changed nothing server-side, and
        // invalidating anyway is what would wipe `next` out from under the
        // form while the modal is deliberately still open. This branch is
        // the one case that DID mutate for real despite the request, so
        // invalidate manually here (mirrors ResourceCreator's identical
        // defensive shape for create_resource_from_yaml).
        const key = RESOURCE_QUERY_KEY[resourceType];
        if (key) qc.invalidateQueries({ queryKey: [key, context] });
        qc.invalidateQueries({ queryKey: ["resource-yaml"] });
        qc.invalidateQueries({ queryKey: ["resource-json"] });
        return;
      }
      setStatus({ msg: result, ok: true });
      if (!dryRun) setTimeout(() => onClose(), 2000);
    } catch (e) {
      setStatus({ msg: (e as any)?.message ?? String(e), ok: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50"
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          (e.target as HTMLElement).tagName === "INPUT" &&
          canApply &&
          !loading
        ) {
          submit(false);
        }
      }}
    >
      <div className="max-w-3xl w-full mx-4 bg-panel rounded-xl ring-1 ring-edge shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <ClusterBadge label={identity.label} color={identity.color} inline />
              <span className="text-[13px] font-semibold text-ink whitespace-nowrap shrink-0">Edit {kindLabel}</span>
            </div>
            <div className="mt-1 text-[11px] text-dim mono truncate">{namespace ? `${namespace}/` : ""}{name}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {Form && (
              <div className="flex items-center rounded-lg ring-1 ring-edge overflow-hidden">
                <button
                  onClick={() => setMode("form")}
                  className={`px-2.5 py-1 text-[11px] mono transition-colors ${
                    mode === "form" ? "bg-accent/20 text-accent" : "text-dim hover:text-ink"
                  }`}
                >
                  Form
                </button>
                <button
                  onClick={() => setMode("patch")}
                  className={`px-2.5 py-1 text-[11px] mono transition-colors ${
                    mode === "patch" ? "bg-accent/20 text-accent" : "text-dim hover:text-ink"
                  }`}
                >
                  Patch
                </button>
              </div>
            )}
            <button onClick={onClose} className="text-dim hover:text-mute transition-colors" disabled={loading}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {managedBy && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-warn/10 ring-1 ring-warn/30 p-3 text-[12px] text-warn">
              <AlertTriangle size={14} className="shrink-0 mt-px" />
              <span>
                {managedBy.confident ? "Managed by" : "Possibly managed by"}{" "}
                <span className="mono">{managedBy.app}</span> — changes will be reverted on the next sync.
                {onSeeFieldManagers && (
                  <>
                    {" "}
                    <button type="button" onClick={onSeeFieldManagers} className="underline hover:no-underline">See field managers</button>
                  </>
                )}
              </span>
            </div>
          )}

          {liveLoading && <p className="text-[12px] text-dim">Loading…</p>}
          {liveError && <p className="text-[12px] text-bad">{(liveError as any)?.message ?? String(liveError)}</p>}

          {base &&
            (mode === "form" ? (
              Form ? (
                <Form context={context} namespace={namespace} name={name} live={base} onChange={handleFormChange} />
              ) : (
                <p className="text-[12px] text-dim">No edit form registered for this resource type.</p>
              )
            ) : (
              <pre className="w-full font-mono text-[11.5px] min-h-[300px] max-h-[50vh] overflow-auto bg-card/50 ring-1 ring-edge rounded-lg p-3 text-ink whitespace-pre-wrap">
                {hasChanges ? JSON.stringify(patch, null, 2) : "No changes."}
              </pre>
            ))}

          {status && (
            <div className={`mt-2 font-mono text-[12px] ${status.ok ? "text-ok" : "text-bad"}`}>{status.msg}</div>
          )}
        </div>

        <div className="px-4 pt-3 border-t border-edge">
          <GuardrailBlock gate={gate} equivalent={hasChanges ? patchEquiv({ context, namespace, kind: resourceType, name, patch }) : null} />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-[13px] text-mute hover:text-ink ring-1 ring-edge disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => submit(true)}
            disabled={!canSubmit}
            title="Validate against the API server without applying anything"
            className="px-4 py-1.5 rounded-lg text-[13px] text-mute hover:text-ink ring-1 ring-edge disabled:opacity-50"
          >
            Dry run
          </button>
          <button
            onClick={() => submit(false)}
            disabled={!canApply}
            title={gate.reason}
            className="bg-accent text-on-accent px-4 py-1.5 rounded-lg text-[13px] font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
