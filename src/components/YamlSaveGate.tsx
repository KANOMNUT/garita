import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";
import { DiffRows } from "./DiffRows";
import {
  useApplyCustomResource, useApplyResource, usePreviewCustomResourceYaml, usePreviewResourceYaml,
} from "../hooks/useResources";
import type { CRD } from "../types/k8s";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { changeCountText, yamlSaveDiff } from "../utils/diffRows";
import { replaceEquiv } from "../utils/kubectlEquiv";
import { PRODUCT_NAME } from "../brand";

// PREVIEW-GATE for #10 YAML Save (docs/ux/03 §8). Opens in "review.loading", asks the server
// to run the SAME typed replace as a dry run, and shows what would actually be stored.
//
// Two failure kinds that must never be confused (03 §3.1):
//   rejected    — the API server answered no. The save would fail. Primary blocked.
//   unavailable — the app could not ask (the invoke itself rejected). The save may still
//                 be fine: primary becomes "Save without preview" with the name typed.
// Loading is phase "review" + confirmDisabled — NEVER `running` or `isPending` (UXP-16),
// so a hung dry run can be backed out of. The editor text is never touched by this dialog.

interface YamlSaveGateProps {
  context: string;
  namespace: string;
  /** Ignored when `crd` is set. */
  resourceType: string;
  /**
   * A custom resource: the preview and the save go through the custom resource commands (the CRD's own group, version,
   * kind, plural and scope; `namespace` is "" for a cluster-scoped object). Everything else in the gate is the same.
   */
  crd?: CRD;
  name: string;
  kindLabel: string;
  yaml: string;
  /** The kind has a guided edit form: offers "Open form" when fields would be dropped. */
  hasForm: boolean;
  onOpenForm: () => void;
  /** "Back to editor": close the dialog, keep the text. */
  onClose: () => void;
  /** The real save succeeded. */
  onSaved: () => void;
}

const nowText = () => new Date().toLocaleTimeString([], { hour12: false });

function CopyBtn({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setDone(true)).catch(() => {});
      }}
      className="self-start px-2 py-1 rounded-md text-[11.5px] text-mute ring-1 ring-edge hover:text-ink"
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function YamlSaveGate({
  context, namespace, resourceType, crd, name, kindLabel, yaml, hasForm, onOpenForm, onClose, onSaved,
}: YamlSaveGateProps) {
  const identity = useClusterIdentity(context);
  // Both pairs are called every render (hook rules); `crd` picks which one this dialog uses.
  const kindPreview = usePreviewResourceYaml();
  const crPreview = usePreviewCustomResourceYaml();
  const kindApply = useApplyResource();
  const crApply = useApplyCustomResource();
  const preview = crd ? crPreview : kindPreview;
  const applyPending = crd ? crApply.isPending : kindApply.isPending;
  const [comparedAt, setComparedAt] = useState("");
  const [saveError, setSaveError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const onSuccess = () => setComparedAt(nowText());
    if (crd) crPreview.mutate({ context, crd, namespace, name, yaml }, { onSuccess });
    else kindPreview.mutate({ context, namespace, resourceType, name, yaml }, { onSuccess });
    // One preview per open: the gate is mounted fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = preview.data;
  const loading = preview.isPending || preview.isIdle;
  // The invoke ITSELF rejected: the app could not ask. Not the same as the server saying no.
  const unavailable = preview.isError;
  const outcome = data?.outcome;
  const rejected = outcome === "rejected" || outcome === "invalid";
  const conflict = outcome === "conflict";

  const diff = useMemo(
    () => (outcome === "ok" && data?.live && data.result ? yamlSaveDiff(data.live, data.result, data.dropped_paths) : null),
    [outcome, data],
  );
  const changed = diff?.result.changed ?? 0;
  const dropped = diff?.dropped ?? [];
  const noDifferences = !!diff && changed === 0 && dropped.length === 0;
  const unavailableMessage = (preview.error as any)?.message ?? String(preview.error ?? "");

  let confirmLabel = "Save changes";
  if (unavailable) confirmLabel = "Save without preview";
  else if (dropped.length > 0) confirmLabel = `Save and drop ${dropped.length} field${dropped.length === 1 ? "" : "s"}`;

  const canSave = unavailable || (!!diff && !noDifferences);
  let disabledReason: string | undefined;
  if (loading) disabledReason = "Waiting for the preview.";
  else if (rejected || conflict) disabledReason = "The preview did not pass.";
  else if (noDifferences) disabledReason = "Nothing changed.";
  else if (!diff && !unavailable) disabledReason = "The preview returned no result.";

  let status: { tone: "error" | "info" | "ok"; text: string } | null = null;
  if (saveError) status = { tone: "error", text: saveError };
  else if (loading) status = { tone: "info", text: "Asking the API server what would change…" };
  else if (conflict) status = { tone: "error", text: "This object changed on the cluster after you opened the editor. Your YAML wasn't saved." };
  else if (outcome === "invalid") status = { tone: "error", text: data?.message ?? "Invalid YAML." };
  else if (rejected) status = { tone: "error", text: `The API server rejected this change: ${data?.message ?? ""}` };

  const description = (
    <>
      Saving replaces the whole object with your YAML.
      {comparedAt && (
        <span className="block mt-0.5 text-[11.5px] text-dim">
          Compared {comparedAt}. The cluster can change before you confirm.
        </span>
      )}
    </>
  );

  return (
    <ConfirmModal
      open
      size="lg"
      destructive={false}
      initialFocus="cancel"
      cancelLabel="Back to editor"
      context={identity.context}
      contextLabel={identity.label}
      contextColor={identity.color}
      title={`Review changes to ${kindLabel} ${name}`}
      description={description}
      confirmLabel={confirmLabel}
      confirmDisabled={!canSave || loading}
      confirmDisabledReason={disabledReason}
      requireTyping={unavailable ? name : undefined}
      requireTypingLabel={unavailable ? `Type ${name} to save without a preview` : undefined}
      acknowledge={
        dropped.length > 0
          ? {
              label: `I understand ${dropped.length} field${dropped.length === 1 ? "" : "s"} I didn't edit will be removed.`,
              reason: "Tick the box to continue.",
            }
          : undefined
      }
      status={status}
      kubectlEquivalent={replaceEquiv({ context })}
      isPending={applyPending}
      onCancel={onClose}
      onConfirm={async () => {
        setSaveError("");
        try {
          if (crd) await crApply.mutateAsync({ context, crd, namespace, name, yaml });
          else await kindApply.mutateAsync({ context, namespace, resourceType, name, yaml });
          onSaved();
        } catch (e) {
          // The dialog stays open, the diff stays, and the editor text is untouched.
          setSaveError((e as any)?.message ?? String(e));
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <div role="status" className="sr-only">
          {diff ? `Comparison ready: ${changeCountText(changed)}.` : ""}
        </div>

        {loading && (
          <div className="flex flex-col gap-2" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 rounded-sm bg-surface-tint/5 motion-safe:animate-pulse" />
            ))}
          </div>
        )}

        {unavailable && (
          <div className="rounded-lg bg-surface-tint/3 ring-1 ring-edge px-3 py-2 text-[12px] text-mute">
            Couldn't ask the API server for a preview: {unavailableMessage}. You can still save. The server checks the change when you do.
          </div>
        )}

        {(rejected || conflict) && (
          <div className="flex flex-col gap-2 text-[12px] text-mute">
            <p>{conflict ? "Reload the object in a fresh editor to see what changed. Your text is kept here." : "Nothing was saved. Fix the YAML and review again."}</p>
            {conflict
              ? <CopyBtn label="Copy my YAML" text={yaml} />
              : <CopyBtn label="Copy error" text={data?.message ?? ""} />}
          </div>
        )}

        {diff && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-ink px-2 py-0.5 rounded-md bg-surface-tint/4 ring-1 ring-edge">
                {changeCountText(changed)}
              </span>
            </div>
            <DiffRows
              result={diff.result}
              label={`Changes to ${kindLabel} ${name}`}
              emptyTitle="No differences."
              emptySecondary={dropped.length === 0 ? "The server would store this object exactly as it is now." : undefined}
            />
            {dropped.length > 0 && (
              <div className="rounded-lg ring-1 ring-warn/40 bg-warn/5 px-3 py-2 flex flex-col gap-1.5">
                <div className="flex items-start gap-2 text-[12px] text-ink">
                  <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
                  <p>
                    {dropped.length} field{dropped.length === 1 ? " will" : "s will"} be dropped because {PRODUCT_NAME}'s schema does not know {dropped.length === 1 ? "it" : "them"}. You didn't edit {dropped.length === 1 ? "it" : "them"}.
                  </p>
                </div>
                <ul className="flex flex-col gap-0.5 pl-6">
                  {dropped.map((r) => (
                    <li key={r.path} className="text-[11.5px] flex flex-wrap gap-x-2">
                      <span className="mono text-bad" aria-hidden>−</span>
                      <span className="mono text-ink/90 break-all">{r.path}</span>
                      <span className="text-[10px] uppercase tracking-wider text-bad">dropped by schema</span>
                    </li>
                  ))}
                </ul>
                <p className="pl-6 text-[11.5px] text-mute">Saving replaces the whole object, so these are removed.</p>
                {hasForm && (
                  <p className="pl-6 text-[11.5px] text-mute">
                    Edit with the form instead. It only changes the fields you edit.{" "}
                    <button type="button" onClick={onOpenForm} className="text-accent hover:underline">Open form</button>
                  </p>
                )}
              </div>
            )}
            <p className="text-[10.5px] text-dim">
              Ignored in the comparison: status, managed fields, uid, resourceVersion, generation and creation time.
            </p>
          </>
        )}
      </div>
    </ConfirmModal>
  );
}
