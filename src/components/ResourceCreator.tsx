import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import { useCreateResource } from "../hooks/useResources";
import { RESOURCE_TEMPLATE, type CreatableKind } from "../utils/resourceTemplates";
import { RESOURCE_QUERY_KEY } from "../utils/resourceQueryKey";
import { CREATE_FORM } from "./create/registry";
import { ClusterBadge } from "./ConfirmModal";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { useModalLayer } from "../utils/modalLayer";
import { GuardrailBlock, useWriteGate } from "./GuardrailGate";
import { createFromFileEquiv } from "../utils/kubectlEquiv";

interface ResourceCreatorProps {
  open: boolean;
  onClose: () => void;
  context: string;
  resourceType: CreatableKind;
  namespace: string;
}

type Mode = "form" | "yaml";

export function ResourceCreator({ open, onClose, context, resourceType, namespace }: ResourceCreatorProps) {
  const tpl = RESOURCE_TEMPLATE[resourceType];
  const Form = CREATE_FORM[resourceType];
  // "all" isn't a real namespace to create into — fall back to "default"
  // (every real cluster has one) for template interpolation and form prefill.
  const effectiveNs = namespace === "all" ? "default" : namespace;

  const [mode, setMode] = useState<Mode>(Form ? "form" : "yaml");
  const [yaml, setYaml] = useState("");
  const [yamlDirty, setYamlDirty] = useState(false);
  const [formYaml, setFormYaml] = useState("");
  const [formValid, setFormValid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  const createResource = useCreateResource();
  const qc = useQueryClient();
  const identity = useClusterIdentity(context);
  const gate = useWriteGate(context, open);
  const isTopmost = useModalLayer(open);

  // Stable across re-renders — required so each form's own reporting
  // useEffect (registry.ts's frozen contract) can safely list only its own
  // state in its deps without this identity changing underneath it.
  const handleFormChange = useCallback((y: string, valid: boolean) => {
    setFormYaml(y);
    setFormValid(valid);
  }, []);

  useEffect(() => {
    if (open) {
      setMode(Form ? "form" : "yaml");
      setYaml(tpl ? tpl.yaml(effectiveNs) : "");
      setYamlDirty(false);
      // The modal container itself never unmounts (App.tsx renders it
      // unconditionally), so these must be reset here — otherwise
      // reopening on a different kind can submit the previous kind's YAML
      // before the new form's first reporting effect fires.
      setFormYaml("");
      setFormValid(false);
      setStatus(null);
    }
    // resourceType/namespace included so re-opening after a page switch
    // reseeds from the new page's template rather than the previous one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceType, namespace]);

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

  // Read-only blocks both buttons (the backstop refuses a dry run too); the typed guardrail
  // gates only the real create.
  const canSubmit = (mode === "form" ? formValid : yaml.trim().length > 0) && !gate.readOnly;
  const canApply = canSubmit && gate.typedOk;

  // R7: the ONLY place that decides what YAML submit sends — form mode
  // reads back the last value the form itself reported via onChange, never
  // re-derives it, so the Form/YAML toggle can never disagree with submit.
  const currentYaml = () => (mode === "form" ? formYaml : yaml);

  const switchToYaml = () => {
    if (mode === "form") setYaml(currentYaml());
    setMode("yaml");
  };

  const submit = async (dryRun: boolean) => {
    setStatus(null);
    setLoading(true);
    try {
      const result = await createResource.mutateAsync({ context, yaml: currentYaml(), dryRun });
      // create_resource_from_yaml's dry_run param is additive and, until it
      // lands on the Rust side, an unrecognised invoke arg is silently
      // dropped — meaning a "Dry run" click would actually create the
      // resource for real while reporting success as a validation. The
      // frozen success string for a real dry run is "{kind}/{name} would be
      // created (dry run)", so use the response itself to detect whether the
      // backend actually honored the flag, rather than trusting the request.
      if (dryRun && !result.includes("dry run")) {
        setStatus({
          msg: `Backend does not support dry-run yet — this call created the resource for real. (${result})`,
          ok: false,
        });
        const key = resourceType === "ns" ? "namespaces" : RESOURCE_QUERY_KEY[resourceType];
        if (key) qc.invalidateQueries({ queryKey: [key, context] });
        return;
      }
      setStatus({ msg: result, ok: true });
      if (!dryRun) {
        const key = resourceType === "ns" ? "namespaces" : RESOURCE_QUERY_KEY[resourceType];
        if (key) qc.invalidateQueries({ queryKey: [key, context] });
        setTimeout(() => onClose(), 2000);
      }
    } catch (e) {
      setStatus({ msg: (e as any)?.message ?? String(e), ok: false });
    } finally {
      setLoading(false);
    }
  };

  const title = `New ${tpl?.kind ?? "Resource"}`;

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
            <ClusterBadge label={identity.label} color={identity.color} />
            <span className="text-[13px] font-semibold text-ink">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            {Form && (
              <div className="flex items-center rounded-lg ring-1 ring-edge overflow-hidden">
                <button
                  onClick={() => setMode("form")}
                  disabled={yamlDirty}
                  title={yamlDirty ? "YAML has been edited — switch back would discard your changes" : undefined}
                  className={`px-2.5 py-1 text-[11px] mono transition-colors ${
                    mode === "form" ? "bg-accent/20 text-accent" : "text-dim hover:text-ink"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Form
                </button>
                <button
                  onClick={switchToYaml}
                  className={`px-2.5 py-1 text-[11px] mono transition-colors ${
                    mode === "yaml" ? "bg-accent/20 text-accent" : "text-dim hover:text-ink"
                  }`}
                >
                  YAML
                </button>
              </div>
            )}
            <button onClick={onClose} className="text-dim hover:text-mute transition-colors" disabled={loading}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="p-4 max-h-[70vh] overflow-y-auto">
          {mode === "form" && Form ? (
            <Form context={context} namespace={effectiveNs} onChange={handleFormChange} />
          ) : (
            <textarea
              value={yaml}
              onChange={(e) => {
                setYaml(e.target.value);
                setYamlDirty(true);
              }}
              placeholder={tpl ? undefined : `Paste your YAML here...\n\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: my-config\n  namespace: default\ndata:\n  key: value`}
              className="w-full font-mono text-[12px] min-h-[300px] bg-card/50 ring-1 ring-edge rounded-lg focus:outline-hidden focus:ring-accent/40 resize-y p-3 text-ink placeholder:text-dim"
              spellCheck={false}
            />
          )}
          {status && (
            <div className={`mt-2 font-mono text-[12px] ${status.ok ? "text-ok" : "text-bad"}`}>
              {status.msg}
            </div>
          )}
        </div>

        <div className="px-4 pt-3 border-t border-edge">
          <GuardrailBlock gate={gate} equivalent={createFromFileEquiv({ context })} />
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
            disabled={loading || !canSubmit}
            title="Validate against the API server without creating anything"
            className="px-4 py-1.5 rounded-lg text-[13px] text-mute hover:text-ink ring-1 ring-edge disabled:opacity-50"
          >
            Dry run
          </button>
          <button
            onClick={() => submit(false)}
            disabled={loading || !canApply}
            title={gate.reason}
            className="bg-accent text-on-accent px-4 py-1.5 rounded-lg text-[13px] font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
