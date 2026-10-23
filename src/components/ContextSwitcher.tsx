import { useState, useEffect, useRef } from "react";
import { Search, Check, AlertCircle, FolderOpen, FileText, Trash2, Copy, Plus, Loader2, Palette } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { KubeContext, KubeconfigEntry } from "../types/k8s";
import {
  useKubeconfigs, usePreviewKubeconfigPath, usePreviewKubeconfigYaml,
  useAddKubeconfigPath, useAddKubeconfigYaml, useRemoveKubeconfig, useSetKubeconfigEnabled,
} from "../hooks/useResources";
import { useClusterIdentity, IDENTITY_ROLES, IDENTITY_ROLE_LABELS, CLUSTER_COLOR_CLASSES, BULK_LIMIT_MAX, BULK_LIMIT_MIN } from "../utils/clusterIdentity";
import { CORRUPT_STORE_NOTE, INVALID_BULK_LIMIT, readOnlyOnAnnouncement } from "../utils/guardrails";
import { ReadOnlyChip, TurnOffReadOnlyConfirm } from "./ReadOnlyBadge";
import { PRODUCT_NAME } from "../brand";
import { proxyLabel } from "../utils/proxyLabel";
import { observabilitySummary, requestObservabilityDialog } from "../utils/observability";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-tint/6 text-mute ring-1 ring-edge">
      {children}
    </kbd>
  );
}

function detectProvider(name: string, cluster: string): string {
  const n = name.toLowerCase();
  const c = cluster.toLowerCase();
  if (n.startsWith("gke_") || c.startsWith("gke_")) return "GKE";
  if (n.startsWith("eks_") || c.startsWith("arn:aws:eks") || c.includes("_eks_") || c.includes("-eks-")) return "EKS";
  if (n.startsWith("aks_") || c.includes("_aks_") || c.includes("-aks-") || c.includes("azure")) return "AKS";
  if (n.includes("k3s") || c.includes("k3s")) return "K3s";
  if (n.includes("kind") || c.includes("kind")) return "kind";
  if (n.includes("minikube") || c.includes("minikube")) return "minikube";
  if (n.includes("rancher") || c.includes("rancher")) return "Rancher";
  return "k8s";
}

// Display-only: a path's last segment, for both '/' and '\' separators (Windows
// kubeconfigs are real). Full path always stays available via `title`.
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={title}
      className="h-5 w-5 flex items-center justify-center rounded-sm text-dim hover:text-ink transition-colors shrink-0"
    >
      {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
    </button>
  );
}

interface CtxRowProps {
  ctx: KubeContext;
  isCurrent: boolean;
  onSelect: () => void;
}

function parseLimit(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= BULK_LIMIT_MIN && n <= BULK_LIMIT_MAX ? n : null;
}

function IdentityEditor({ context }: { context: string }) {
  const identity = useClusterIdentity(context);
  const [limitText, setLimitText] = useState(identity.bulkLimit !== null ? String(identity.bulkLimit) : "10");
  const [announce, setAnnounce] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const limitOn = identity.bulkLimit !== null;
  const limitInvalid = limitOn && parseLimit(limitText) === null;
  const summary = observabilitySummary(identity.observability);
  return (
    <div className="mx-3 mb-1.5 p-2 rounded-lg ring-1 ring-edge bg-surface-tint/2 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        value={identity.label}
        onChange={(e) => identity.setIdentity({ label: e.target.value })}
        placeholder={context}
        spellCheck={false}
        className="w-full bg-transparent ring-1 ring-edge rounded-sm px-1.5 py-1 text-[11.5px] mono outline-hidden focus:ring-accent/50 focus:ring-2"
      />
      <div className="flex items-center gap-1.5">
        {IDENTITY_ROLES.map((c) => (
          <button
            key={c}
            onClick={() => identity.setIdentity({ color: c })}
            title={IDENTITY_ROLE_LABELS[c]}
            aria-label={IDENTITY_ROLE_LABELS[c]}
            aria-pressed={identity.color === c}
            className={`h-5 w-5 rounded-full ${CLUSTER_COLOR_CLASSES[c].dot} ${identity.color === c ? "ring-2 ring-offset-2 ring-offset-panel ring-ink" : ""}`}
          />
        ))}
      </div>

      {/* Guardrails (#29): per cluster, stored beside colour and label. Nothing defaults on. */}
      <div role="group" aria-label="Guardrails" className="mt-1 pt-1.5 border-t border-edge-raw/60 flex flex-col gap-1.5">
        <div className="text-[9.5px] uppercase tracking-wider text-dim font-semibold">Guardrails</div>
        {identity.corrupt && <p className="text-[10.5px] text-warn">{CORRUPT_STORE_NOTE}</p>}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={identity.readOnly}
            onChange={(e) => {
              if (e.target.checked) {
                // Turning it on is the safe direction: immediate, no confirm.
                identity.setIdentity({ readOnly: true });
                setAnnounce(readOnlyOnAnnouncement(identity.label || context));
              } else {
                setConfirmOff(true);
              }
            }}
            className="mt-0.5 accent-accent"
          />
          <span className="min-w-0">
            <span className="block text-[11.5px] text-ink">Read-only mode</span>
            <span className="block text-[10.5px] text-dim">
              Disables the app's write actions on this cluster. A guardrail, not a security boundary: kubectl and other tools aren't affected. Open pod shells for this cluster end. Other actions already running aren't stopped.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={identity.typedConfirm}
            onChange={(e) => identity.setIdentity({ typedConfirm: e.target.checked })}
            className="accent-accent"
          />
          <span className="text-[11.5px] text-ink">Confirm writes by typing the cluster label</span>
        </label>
        <div className="flex flex-col gap-0.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={limitOn}
              onChange={(e) => {
                if (!e.target.checked) { identity.setIdentity({ bulkLimit: null }); return; }
                const n = parseLimit(limitText) ?? 10;
                if (parseLimit(limitText) === null) setLimitText("10");
                identity.setIdentity({ bulkLimit: n });
              }}
              className="accent-accent"
            />
            <span className="text-[11.5px] text-ink">Limit bulk actions to</span>
            <input
              type="text"
              inputMode="numeric"
              aria-label="Bulk action limit"
              aria-invalid={limitInvalid || undefined}
              value={limitText}
              onChange={(e) => {
                setLimitText(e.target.value);
                const n = parseLimit(e.target.value);
                if (limitOn && n !== null) identity.setIdentity({ bulkLimit: n });
              }}
              className="w-12 bg-transparent ring-1 ring-edge rounded-sm px-1 py-0.5 text-[11px] mono text-center outline-hidden focus:ring-accent/50 focus:ring-2"
            />
            <span className="text-[11.5px] text-ink">items</span>
          </label>
          {limitInvalid && <p className="text-[10.5px] text-bad pl-5">{INVALID_BULK_LIMIT}</p>}
        </div>
      </div>
      {/* Observability (v2.3.0): a summary and one button; the form lives in ObservabilityDialog. */}
      <div role="group" aria-label="Observability" className="mt-1 pt-1.5 border-t border-edge-raw/60 flex items-start gap-2">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <div className="text-[9.5px] uppercase tracking-wider text-dim font-semibold">Observability</div>
          <p className="text-[11.5px] text-ink wrap-break-word"><span className="text-mute">Metrics </span>{summary.metrics}</p>
          <p className="text-[11.5px] text-ink wrap-break-word"><span className="text-mute">Logs </span>{summary.logs}</p>
          {!identity.observability && <p className="text-[10.5px] text-mute">{PRODUCT_NAME} uses metrics-server for current usage.</p>}
        </div>
        <button
          onClick={() => requestObservabilityDialog(context)}
          className="shrink-0 px-2 py-1 rounded-lg text-[11.5px] text-mute ring-1 ring-edge hover:text-ink transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden"
        >
          Configure…
        </button>
      </div>
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>
      <TurnOffReadOnlyConfirm context={context} open={confirmOff} onClose={() => setConfirmOff(false)} />
    </div>
  );
}

function CtxRow({
  ctx, isCurrent, onSelect, isActive, rowRef, editing, onToggleEdit,
}: CtxRowProps & { isActive?: boolean; rowRef?: React.Ref<HTMLDivElement>; editing: boolean; onToggleEdit: () => void }) {
  // Rust hasn't shipped yet during the parallel Phase 1 window — guard the one
  // dereference so opening this panel doesn't throw before that lands.
  const shadowed = ctx.shadowed_sources ?? [];
  const identity = useClusterIdentity(ctx.name);
  return (
    <div
      ref={rowRef}
      data-active={isActive ? "true" : undefined}
      className={isActive ? "bg-surface-tint/8" : ""}
    >
      <div className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-tint/4">
        <button onClick={onSelect} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
          <span className="h-1.5 w-1.5 rounded-full bg-ok shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] font-medium truncate">{ctx.name}</span>
              {isCurrent && <Check size={10} className="text-ok shrink-0" />}
              {identity.readOnly && <ReadOnlyChip className="shrink-0" />}
              {ctx.is_kubeconfig_default && (
                <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded-sm bg-surface-tint/6 text-dim shrink-0">
                  kubectl default
                </span>
              )}
            </div>
            <div className="mono text-[10.5px] text-dim truncate">{ctx.cluster}</div>
            {(() => {
              const p = proxyLabel(ctx.proxy);
              return p && (
                <div className="flex min-w-0 gap-1 text-[10.5px] text-mute" title={p.title}>
                  <span className="shrink-0">{p.label}</span>
                  <span className="mono flex min-w-0">
                    <span className="truncate min-w-0">{p.host}</span>
                    {p.port && <span className="shrink-0">:{p.port}</span>}
                  </span>
                </div>
              );
            })()}
            {(ctx.source || shadowed.length > 0) && (
              <div className="text-[9.5px] text-dim/70 truncate flex items-center gap-1" title={ctx.source || undefined}>
                {ctx.source && <span className="truncate">context defined in {basename(ctx.source)}</span>}
                {shadowed.length > 0 && (
                  <span
                    className="px-1 rounded-sm bg-warn/10 text-warn ring-1 ring-warn/30 shrink-0"
                    title={`Also defined in: ${shadowed.map(basename).join(", ")}. The first-listed file wins by name.`}
                  >
                    dup ×{shadowed.length}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
        <span className="mono text-[10.5px] text-dim text-right shrink-0">
          {detectProvider(ctx.name, ctx.cluster)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleEdit(); }}
          title="Set a color and label for this cluster"
          className={`h-5 w-5 flex items-center justify-center rounded-full shrink-0 ${CLUSTER_COLOR_CLASSES[identity.color].dot}`}
        >
          <Palette size={9} className="text-surface-base/50" />
        </button>
        <CopyButton text={`kubectl config use-context ${ctx.name}`} title={`Copy: kubectl config use-context (sets your kubectl default; ${PRODUCT_NAME} doesn't change it)`} />
      </div>
      {editing && <IdentityEditor context={ctx.name} />}
    </div>
  );
}

function KubeconfigRow({ entry }: { entry: KubeconfigEntry }) {
  const removeKubeconfig = useRemoveKubeconfig();
  const setEnabled = useSetKubeconfigEnabled();
  const isDefault = entry.source === "default";

  return (
    <div className="flex items-center gap-2 py-1">
      <input
        type="checkbox"
        checked={entry.enabled}
        disabled={isDefault || setEnabled.isPending}
        onChange={(e) => setEnabled.mutate({ path: entry.path, enabled: e.target.checked })}
        title={isDefault ? "The default kubeconfig is always enabled" : entry.enabled ? "Disable" : "Enable"}
        className="accent-accent shrink-0 disabled:opacity-40"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] truncate" title={entry.path}>{basename(entry.path)}</span>
          <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded-sm bg-surface-tint/6 text-dim shrink-0">
            {entry.source}
          </span>
          {entry.app_owned && (
            <span className="text-[9px] px-1 py-px rounded-sm bg-accent/10 text-accent shrink-0">pasted</span>
          )}
        </div>
        {entry.error ? (
          <div className="text-[10.5px] text-bad break-all">{entry.error}</div>
        ) : (
          <div className="mono text-[10px] text-dim">
            {entry.contexts.length} context{entry.contexts.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
      {!isDefault && (
        <button
          onClick={() => removeKubeconfig.mutate(entry.path)}
          disabled={removeKubeconfig.isPending}
          title={`Remove from ${PRODUCT_NAME}. Does not delete the file.`}
          className="h-5 w-5 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0 disabled:opacity-40"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

type AddMode = "choose" | "file" | "paste";
type Preview = { entry: KubeconfigEntry; path?: string };

function KubeconfigsSection({ contexts, addOpen }: { contexts: KubeContext[]; addOpen: boolean }) {
  const { data: kubeconfigs = [] } = useKubeconfigs();
  const previewPath = usePreviewKubeconfigPath();
  const previewYaml = usePreviewKubeconfigYaml();
  const addPath = useAddKubeconfigPath();
  const addYaml = useAddKubeconfigYaml();

  const [addMode, setAddMode] = useState<AddMode>("choose");
  const [pasteYaml, setPasteYaml] = useState("");
  const [pasteName, setPasteName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Collisions are computed against the enabled union (list_contexts(), passed
  // down as `contexts`) — not against useKubeconfigs() rows, which include
  // disabled files that contribute nothing to what's actually resolvable.
  const existingNames = new Set(contexts.map((c) => c.name));
  const collisions = preview ? preview.entry.contexts.filter((n) => existingNames.has(n)) : [];

  function resetAdd() {
    setAddMode("choose");
    setPasteYaml("");
    setPasteName("");
    setPreview(null);
    setAddError(null);
  }

  async function handlePickFile() {
    setAddError(null);
    let path: string | null;
    try {
      path = await openDialog({
        multiple: false,
        filters: [
          { name: "kubeconfig", extensions: ["yaml", "yml", "config"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
    } catch (e) {
      setAddError((e as any)?.message ?? String(e));
      return;
    }
    if (!path) return; // user canceled the dialog
    setAddMode("file");
    try {
      const entry = await previewPath.mutateAsync(path);
      setPreview({ entry, path });
    } catch (e) {
      setAddError((e as any)?.message ?? String(e));
    }
  }

  async function handlePreviewPaste() {
    setAddError(null);
    try {
      const entry = await previewYaml.mutateAsync(pasteYaml);
      setPreview({ entry });
      if (!pasteName) setPasteName(entry.contexts[0] ?? "kubeconfig");
    } catch (e) {
      setAddError((e as any)?.message ?? String(e));
    }
  }

  async function handleCommit() {
    if (!preview) return;
    setAddError(null);
    try {
      if (preview.path) {
        await addPath.mutateAsync(preview.path);
      } else {
        await addYaml.mutateAsync({ yaml: pasteYaml, name: pasteName });
      }
      resetAdd();
    } catch (e) {
      setAddError((e as any)?.message ?? String(e));
    }
  }

  const committing = addPath.isPending || addYaml.isPending;

  return (
    <div className="border-t border-edge px-3 py-2 max-h-[240px] overflow-y-auto">
      <div className="text-[10px] uppercase tracking-[0.08em] text-dim mb-1">Kubeconfigs</div>
      <div className="flex flex-col divide-y divide-edge-raw/60">
        {kubeconfigs.map((entry) => (
          <KubeconfigRow key={entry.path} entry={entry} />
        ))}
      </div>

      {addOpen && (
        <div className="mt-2 rounded-lg ring-1 ring-edge bg-surface-tint/2 p-2">
          {addMode === "choose" && (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePickFile}
                disabled={previewPath.isPending}
                className="flex-1 text-[11.5px] px-2 py-1.5 rounded-sm ring-1 ring-edge hover:bg-surface-tint/4 flex items-center justify-center gap-1.5 text-mute hover:text-ink disabled:opacity-40"
              >
                {previewPath.isPending ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
                Add from file…
              </button>
              <button
                onClick={() => setAddMode("paste")}
                className="flex-1 text-[11.5px] px-2 py-1.5 rounded-sm ring-1 ring-edge hover:bg-surface-tint/4 flex items-center justify-center gap-1.5 text-mute hover:text-ink"
              >
                <FileText size={12} /> Paste YAML…
              </button>
            </div>
          )}

          {addMode === "paste" && (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={pasteYaml}
                onChange={(e) => {
                  setPasteYaml(e.target.value);
                  // The preview describes a specific string. Once the text
                  // changes, that preview no longer describes what Add would
                  // commit — drop it rather than let Add send stale-relative-
                  // to-the-shown-preview text.
                  setPreview(null);
                  setAddError(null);
                }}
                placeholder={"apiVersion: v1\nkind: Config\n..."}
                rows={6}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="w-full bg-surface-input ring-1 ring-edge rounded-sm px-2 py-1.5 text-[11px] mono resize-none outline-hidden focus:ring-accent/50 focus:ring-2"
              />
              {!preview && (
                <button
                  onClick={handlePreviewPaste}
                  disabled={!pasteYaml.trim() || previewYaml.isPending}
                  className="self-end text-[11px] px-2 py-1 rounded-sm ring-1 ring-edge hover:bg-surface-tint/4 disabled:opacity-40 flex items-center gap-1"
                >
                  {previewYaml.isPending && <Loader2 size={11} className="animate-spin" />}
                  Preview
                </button>
              )}
            </div>
          )}

          {preview && (
            <div className="flex flex-col gap-1.5">
              {preview.entry.error ? (
                <div className="text-[11px] text-bad flex items-start gap-1.5">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span className="break-all">{preview.entry.error}</span>
                </div>
              ) : (
                <>
                  <div className="text-[11px] text-mute">
                    Contributes {preview.entry.contexts.length} context{preview.entry.contexts.length === 1 ? "" : "s"}:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {preview.entry.contexts.map((name) => (
                      <span key={name} className="mono text-[10.5px] px-1.5 py-0.5 rounded-sm bg-surface-tint/6 text-ink">
                        {name}
                      </span>
                    ))}
                  </div>
                  {collisions.length > 0 && (
                    <div className="text-[10.5px] text-warn flex items-start gap-1.5">
                      <AlertCircle size={11} className="shrink-0 mt-0.5" />
                      <span>
                        {collisions.join(", ")} already defined elsewhere — this file is added last, so the
                        existing context{collisions.length === 1 ? "" : "s"} will keep resolving there
                        (first-listed file wins by name).
                      </span>
                    </div>
                  )}
                  {addMode === "paste" && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10.5px] text-dim shrink-0">Save as</label>
                      <input
                        value={pasteName}
                        onChange={(e) => setPasteName(e.target.value)}
                        spellCheck={false}
                        className="flex-1 bg-transparent ring-1 ring-edge rounded-sm px-1.5 py-0.5 text-[11px] mono outline-hidden focus:ring-accent/50 focus:ring-2"
                      />
                    </div>
                  )}
                </>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={resetAdd} className="text-[11px] text-dim hover:text-ink">
                  Cancel
                </button>
                <button
                  onClick={handleCommit}
                  disabled={committing || !!preview.entry.error || (addMode === "paste" && !pasteName.trim())}
                  className="text-[11px] px-2 py-1 rounded-sm bg-accent/10 text-accent ring-1 ring-accent/30 hover:bg-accent/20 disabled:opacity-40 flex items-center gap-1"
                >
                  {committing && <Loader2 size={11} className="animate-spin" />}
                  Add
                </button>
              </div>
            </div>
          )}

          {addError && (
            <div className="text-[11px] text-bad mt-1.5 flex items-start gap-1.5">
              <AlertCircle size={11} className="shrink-0 mt-0.5" />
              <span className="break-all">{addError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ContextSwitcherProps {
  open: boolean;
  onClose: () => void;
  contexts: KubeContext[];
  currentContext: string;
  onSwitch: (name: string) => void;
}

export function ContextSwitcher({
  open,
  onClose,
  contexts,
  currentContext,
  onSwitch,
}: ContextSwitcherProps) {
  const [q, setQ] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState<string | null>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelectedIndex(0), [q]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Reset the add-kubeconfig panel and the identity editor on every close path,
  // including the global Escape handler in App.tsx (which flips `open` directly
  // and doesn't go through a callback here).
  useEffect(() => {
    if (!open) {
      setAddOpen(false);
      setEditingIdentity(null);
    }
  }, [open]);

  if (!open) return null;

  const filtered = contexts.filter(
    (c) =>
      !q.trim() ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.cluster.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="absolute inset-0 z-30 fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-scrim/40 backdrop-blur-[2px]" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute top-[60px] left-1/2 -translate-x-1/2 w-[520px] bg-panel ring-1 ring-edge2 rounded-xl shadow-2xl overflow-hidden"
      >
        {/* search input */}
        <div className="flex items-center gap-2 px-3 h-10 border-b border-edge">
          <Search size={13} className="text-dim" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[selectedIndex];
                if (item) onSwitch(item.name);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Switch context…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1 bg-transparent text-[13px] focus:outline-hidden placeholder:text-dim mono"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="py-1 max-h-[280px] overflow-y-auto">
          {filtered.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-dim">All Contexts</div>
              {filtered.map((c, i) => {
                const isActive = i === selectedIndex;
                return (
                  <CtxRow
                    key={c.name}
                    ctx={c}
                    isCurrent={c.name === currentContext}
                    onSelect={() => onSwitch(c.name)}
                    isActive={isActive}
                    rowRef={isActive ? activeRowRef : undefined}
                    editing={editingIdentity === c.name}
                    onToggleEdit={() => setEditingIdentity((cur) => (cur === c.name ? null : c.name))}
                  />
                );
              })}
            </>
          )}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-dim mono">No contexts found</div>
          )}
        </div>

        <KubeconfigsSection contexts={contexts} addOpen={addOpen} />

        <div className="border-t border-edge px-3 h-8 flex items-center gap-3 text-[10.5px] text-dim">
          <span className="flex items-center gap-1"><Kbd>↑↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> switch</span>
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="ml-auto flex items-center gap-1 text-accent hover:text-ink transition-colors"
          >
            <Plus size={11} /> Add kubeconfig
          </button>
        </div>
      </div>
    </div>
  );
}
