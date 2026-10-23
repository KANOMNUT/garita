import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";
import { DiffRows } from "./DiffRows";
import { usePreviewHelmUpgrade, useUpgradeHelmRelease } from "../hooks/useResources";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { changeCountText, helmValuesDiff } from "../utils/diffRows";
import { helmUpgradeEquiv } from "../utils/kubectlEquiv";
import type { HelmRenderedResource, HelmResourceChange } from "../types/k8s";

// PREVIEW-GATE for #37 Helm upgrade (docs/ux/03 §9). Two panels: Values (a key-path diff,
// credential-looking keys masked) and Rendered resources (what the chart renders, marked
// new / changed / removed / unchanged against the current release). The chart source is
// never described as a repository or a version lookup: upgrade extracts the chart from the
// release secret, so the consequence line says "the chart stored with this release".
//
// rejected    — Helm's template engine (or the API server) answered no: primary blocked.
// unavailable — the app could not ask (helm missing, auth, chart extraction): the invoke
//               itself rejected. Primary becomes "Upgrade without preview" + typed release name.
// Loading is phase "review" + confirmDisabled (UXP-16), never `running` / `isPending`.

interface HelmUpgradeGateProps {
  context: string;
  namespace: string;
  release: string;
  chartName: string;
  chart: string;
  valuesYaml: string;
  onClose: () => void;
  onUpgraded: () => void;
}

const nowText = () => new Date().toLocaleTimeString([], { hour12: false });

const CHANGE_GLYPH: Record<HelmResourceChange, string> = { new: "+", changed: "~", removed: "−", unchanged: " " };
const CHANGE_ROLE: Record<HelmResourceChange, string> = {
  new: "text-ok", changed: "text-warn", removed: "text-bad", unchanged: "text-dim",
};

function ResourceList({ resources }: { resources: HelmRenderedResource[] }) {
  if (resources.length === 0) {
    return <p className="text-[12px] text-dim py-2">The chart renders no resources.</p>;
  }
  return (
    <ul aria-label="Rendered resources" className="flex flex-col gap-0.5">
      {resources.map((r) => (
        <li key={`${r.kind}/${r.namespace}/${r.name}`} className="flex items-baseline gap-2 px-2 py-1 text-[11.5px] rounded-md hover:bg-surface-tint/3">
          <span className={`mono w-3 shrink-0 text-center ${CHANGE_ROLE[r.change]}`} aria-hidden>{CHANGE_GLYPH[r.change]}</span>
          <span className="mono text-ink/90 shrink-0">{r.kind}</span>
          <span className="mono text-mute min-w-0 break-all">{r.namespace}/{r.name}</span>
          <span className="flex-1" />
          <span className={`text-[10px] uppercase tracking-wider shrink-0 ${CHANGE_ROLE[r.change]}`}>{r.change}</span>
        </li>
      ))}
    </ul>
  );
}

export function HelmUpgradeGate({
  context, namespace, release, chartName, chart, valuesYaml, onClose, onUpgraded,
}: HelmUpgradeGateProps) {
  const identity = useClusterIdentity(context);
  const preview = usePreviewHelmUpgrade();
  const upgrade = useUpgradeHelmRelease();
  const [tab, setTab] = useState<"values" | "rendered">("values");
  const [showManifest, setShowManifest] = useState(false);
  const [comparedAt, setComparedAt] = useState("");
  const [upgradeError, setUpgradeError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    preview.mutate(
      { context, namespace, release, valuesYaml },
      { onSuccess: () => setComparedAt(nowText()) },
    );
    // One preview per open: the gate is mounted fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = preview.data;
  const loading = preview.isPending || preview.isIdle;
  const unavailable = preview.isError;
  const rejected = data?.outcome === "rejected" || data?.outcome === "invalid";
  const ok = data?.outcome === "ok";

  // "Rendering the chart…" can take seconds: show elapsed time after 3 s.
  useEffect(() => {
    if (!loading) return;
    const t = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [loading]);

  const valuesDiff = useMemo(
    () => (data && data.outcome !== "invalid" ? helmValuesDiff(data.current_values, data.new_values) : null),
    [data],
  );
  const valueChanges = valuesDiff?.changed ?? 0;
  const resources = data?.resources ?? [];
  const unchangedValues = ok && valueChanges === 0;
  const unavailableMessage = (preview.error as any)?.message ?? String(preview.error ?? "");

  let disabledReason: string | undefined;
  if (loading) disabledReason = "Waiting for the preview.";
  else if (rejected) disabledReason = "The preview did not pass.";
  else if (unchangedValues) disabledReason = "Nothing changed.";
  else if (!ok && !unavailable) disabledReason = "The preview returned no result.";
  const canUpgrade = unavailable || (ok && !unchangedValues);

  let status: { tone: "error" | "info" | "ok"; text: string } | null = null;
  if (upgradeError) {
    status = {
      tone: "error",
      text: `${upgradeError} If the upgrade failed partway, Helm may have recorded a failed revision. Check the History tab.`,
    };
  } else if (loading) {
    status = {
      tone: "info",
      // UXA-14: constant text, so the info status is announced once. Seconds go in the description.
      text: "Rendering the chart with your values…",
    };
  } else if (data?.outcome === "invalid") {
    status = { tone: "error", text: data.message };
  } else if (rejected) {
    status = { tone: "error", text: `Helm couldn't render this release: ${data?.message ?? ""}` };
  }

  const tabs: { id: "values" | "rendered"; label: string }[] = [
    { id: "values", label: `Values${valuesDiff ? ` (${valueChanges})` : ""}` },
    { id: "rendered", label: `Rendered resources${ok ? ` (${resources.length})` : ""}` },
  ];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: "values" | "rendered" =
      e.key === "Home" ? "values" : e.key === "End" ? "rendered" : tab === "values" ? "rendered" : "values";
    setTab(next);
    document.getElementById(`helm-gate-tab-${next}`)?.focus();
  };

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
      title={`Upgrade Helm release ${release}`}
      description={
        <>
          Upgrades "{release}" with your edited values, using the chart stored with this release.
          {loading && elapsed >= 3 && <span aria-hidden className="ml-1 text-dim">{elapsed}s</span>}
          {comparedAt && (
            <span className="block mt-0.5 text-[11.5px] text-dim">
              Compared {comparedAt}. The cluster can change before you confirm.
            </span>
          )}
        </>
      }
      confirmLabel={unavailable ? "Upgrade without preview" : "Upgrade release"}
      confirmDisabled={!canUpgrade || loading}
      confirmDisabledReason={disabledReason}
      requireTyping={unavailable ? release : undefined}
      requireTypingLabel={unavailable ? `Type ${release} to upgrade without a preview` : undefined}
      status={status}
      kubectlEquivalent={helmUpgradeEquiv({ context, namespace, release })}
      isPending={upgrade.isPending}
      onCancel={onClose}
      onConfirm={async () => {
        setUpgradeError("");
        try {
          await upgrade.mutateAsync({ context, namespace, release, chartName, chart, valuesYaml });
          onUpgraded();
        } catch (e) {
          // The dialog stays open; the edited values are kept.
          setUpgradeError((e as any)?.message ?? String(e));
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <div role="status" className="sr-only">
          {ok ? `Comparison ready: ${changeCountText(valueChanges)}.` : ""}
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
            {unavailableMessage.replace(/\.+$/, "")}. You can still upgrade. Helm will check the chart when it runs.
          </div>
        )}

        {rejected && (
          <div className="flex flex-col gap-2 text-[12px] text-mute">
            <p>Nothing was upgraded.</p>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(data?.message ?? "").catch(() => {}); }}
              className="self-start px-2 py-1 rounded-md text-[11.5px] text-mute ring-1 ring-edge hover:text-ink"
            >
              Copy error
            </button>
          </div>
        )}

        {data && data.outcome !== "invalid" && (
          <>
            <div role="tablist" aria-label="Preview" className="flex items-center gap-1 border-b border-edge" onKeyDown={onTabKey}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  id={`helm-gate-tab-${t.id}`}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  aria-controls={`helm-gate-panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={`px-2.5 py-1.5 text-[12px] -mb-px border-b-2 ${tab === t.id ? "border-accent text-ink" : "border-transparent text-mute hover:text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "values" && valuesDiff && (
              <div role="tabpanel" id="helm-gate-panel-values" aria-labelledby="helm-gate-tab-values">
                <DiffRows
                  result={valuesDiff}
                  label={`Value changes for ${release}`}
                  emptyTitle="Your values are unchanged."
                />
              </div>
            )}

            {tab === "rendered" && (
              <div role="tabpanel" id="helm-gate-panel-rendered" aria-labelledby="helm-gate-tab-rendered" className="flex flex-col gap-2">
                {ok ? (
                  <>
                    <p className="text-[11.5px] text-dim">
                      Rendered with your values · {resources.length} resource{resources.length === 1 ? "" : "s"}
                    </p>
                    <ResourceList resources={resources} />
                    <button
                      type="button"
                      onClick={() => setShowManifest((v) => !v)}
                      aria-expanded={showManifest}
                      className="self-start text-[11.5px] text-accent hover:underline"
                    >
                      {showManifest ? "Hide rendered manifest" : "View rendered manifest"}
                    </button>
                    {showManifest && (
                      <p className="text-[11px] text-dim">Secret values in the rendered manifest are hidden.</p>
                    )}
                    {showManifest && (
                      <pre className="mono text-[10.5px] leading-normal max-h-72 overflow-auto rounded-sm bg-surface-input/80 ring-1 ring-edge p-2 text-ink/90">
                        {data.rendered_manifest}
                      </pre>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] text-dim">Nothing was rendered.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ConfirmModal>
  );
}
