import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useInstallHelmRelease, useHelmRepos } from "../hooks/useResources";
import { validateName, validateNamespace } from "./create/emit";
import { ClusterBadge } from "./ConfirmModal";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { useModalLayer } from "../utils/modalLayer";
import { GuardrailBlock, useWriteGate } from "./GuardrailGate";
import { helmInstallEquiv } from "../utils/kubectlEquiv";

// docs/plan-kubeconfig-and-parity.md §3.3. A standalone modal, not a
// CreatableKind/CREATE_FORM entry — a Helm install is not a K8s manifest,
// so it doesn't belong in the create-form registry. Reached from the Helm
// view's own +New (App.tsx branches on activeResource === "helm").
//
// list_helm_repos is read-only (repo add/remove/update is cut per the
// plan) — the chip list below is a convenience for prefilling the chart
// field, not a repo browser.

interface HelmInstallModalProps {
  open: boolean;
  onClose: () => void;
  context: string;
  namespace: string;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-dim">{label}</span>
      {children}
    </div>
  );
}

const inputCls = "w-full h-8 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[12px] mono text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40";

export function HelmInstallModal({ open, onClose, context, namespace }: HelmInstallModalProps) {
  const [ns, setNs] = useState(namespace === "all" ? "default" : namespace);
  const [release, setRelease] = useState("");
  const [chart, setChart] = useState("");
  const [version, setVersion] = useState("");
  const [valuesYaml, setValuesYaml] = useState("");
  const [createNs, setCreateNs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  const install = useInstallHelmRelease();
  const { data: repos = [] } = useHelmRepos();
  const identity = useClusterIdentity(context);
  const gate = useWriteGate(context, open);
  const isTopmost = useModalLayer(open);

  useEffect(() => {
    if (open) {
      setNs(namespace === "all" ? "default" : namespace);
      setRelease("");
      setChart("");
      setVersion("");
      setValuesYaml("");
      setCreateNs(false);
      setStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, namespace]);

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

  const nsError = validateNamespace(ns);
  const releaseError = validateName(release);
  // Read-only blocks both buttons (the backstop refuses a dry run too); the typed
  // guardrail gates only the real install.
  const canSubmit = !nsError && !releaseError && chart.trim().length > 0 && !gate.readOnly;
  const canInstall = canSubmit && gate.typedOk;

  const submit = async (dryRun: boolean) => {
    setStatus(null);
    setLoading(true);
    try {
      const result = await install.mutateAsync({
        context, namespace: ns, release, chart, version, valuesYaml,
        createNamespace: createNs, dryRun,
      });
      // Same defensive shape as ResourceCreator/ResourceEditor: an additive
      // dry_run flag the backend doesn't honor yet would silently install
      // for real. Use the response text, not the request, to tell.
      if (dryRun && !result.toLowerCase().includes("dry run")) {
        setStatus({
          msg: `Backend does not support dry-run yet — this call installed the release for real. (${result})`,
          ok: false,
        });
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
        if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName === "INPUT" && canSubmit && !loading) {
          submit(false);
        }
      }}
    >
      <div className="max-w-lg w-full mx-4 bg-panel rounded-xl ring-1 ring-edge shadow-2xl">
        <div className="flex items-start justify-between px-4 py-3 border-b border-edge">
          <div className="min-w-0">
            <ClusterBadge label={identity.label} color={identity.color} />
            <div className="text-[13px] font-semibold text-ink">Install Helm Release</div>
          </div>
          <button onClick={onClose} disabled={loading} className="text-dim hover:text-mute transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto flex flex-col gap-3">
          <Field label="Release name">
            <input value={release} onChange={(e) => setRelease(e.target.value)} placeholder="my-release" className={inputCls} />
            {release && releaseError && <p className="text-[10.5px] text-bad mt-1">{releaseError}</p>}
          </Field>
          <Field label="Namespace">
            <input value={ns} onChange={(e) => setNs(e.target.value)} placeholder="default" className={inputCls} />
            {ns && nsError && <p className="text-[10.5px] text-bad mt-1">{nsError}</p>}
            <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-mute">
              <input type="checkbox" checked={createNs} onChange={(e) => setCreateNs(e.target.checked)} />
              Create namespace if it doesn't exist
            </label>
          </Field>
          <Field label="Chart">
            <input
              value={chart} onChange={(e) => setChart(e.target.value)}
              placeholder="repo/chart, oci://…, or a local path"
              className={inputCls}
            />
            {repos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {repos.map((r) => (
                  <button
                    key={r.name} type="button" onClick={() => setChart(`${r.name}/`)}
                    title={r.url}
                    className="text-[10.5px] mono px-1.5 py-0.5 rounded-sm bg-surface-tint/4 ring-1 ring-edge text-dim hover:text-ink transition-colors"
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Version (optional)">
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" className={inputCls} />
          </Field>
          <Field label="Values (optional)">
            <textarea
              value={valuesYaml} onChange={(e) => setValuesYaml(e.target.value)} rows={6} spellCheck={false}
              placeholder={"key: value\nreplicaCount: 2"}
              className="w-full font-mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-lg focus:outline-hidden focus:ring-accent/40 resize-y p-2.5 text-ink placeholder:text-dim"
            />
          </Field>
          {status && (
            <div className={`font-mono text-[12px] ${status.ok ? "text-ok" : "text-bad"}`}>{status.msg}</div>
          )}
        </div>

        <div className="px-4 pt-3 border-t border-edge">
          <GuardrailBlock
            gate={gate}
            equivalent={chart.trim() && !releaseError && !nsError
              ? helmInstallEquiv({
                  context, namespace: ns, release, chart: chart.trim(), version: version.trim() || undefined,
                  createNamespace: createNs, hasValues: valuesYaml.trim().length > 0,
                })
              : null}
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button onClick={onClose} disabled={loading} className="px-4 py-1.5 rounded-lg text-[13px] text-mute hover:text-ink ring-1 ring-edge disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => submit(true)} disabled={loading || !canSubmit}
            title="Validate against the API server without installing anything"
            className="px-4 py-1.5 rounded-lg text-[13px] text-mute hover:text-ink ring-1 ring-edge disabled:opacity-50"
          >
            Dry run
          </button>
          <button
            onClick={() => submit(false)} disabled={loading || !canInstall}
            title={gate.reason}
            className="bg-accent text-on-accent px-4 py-1.5 rounded-lg text-[13px] font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
