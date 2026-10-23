import { useEffect, useRef, useState } from "react";
import { X, Loader2, FolderOpen, ChevronDown } from "lucide-react";
import { usePreviewYamlDocuments, useApplyYamlDocuments } from "../hooks/useResources";
import { previewRows } from "../utils/mergePreview";
import { capRows, MAX_CHANGED_ROWS } from "../utils/diffRows";
import { DiffRows } from "./DiffRows";
import type { DocPreview, ApplyResult } from "../types/k8s";
import { useQueryClient } from "@tanstack/react-query";
import { ClusterBadge } from "./ConfirmModal";
import { useClusterIdentity } from "../utils/clusterIdentity";
import { useModalLayer } from "../utils/modalLayer";
import { GuardrailBlock, useWriteGate } from "./GuardrailGate";
import { mergeFromFileEquiv } from "../utils/kubectlEquiv";
import { checkBulk } from "../utils/guardrails";

// docs/plan-kubeconfig-and-parity.md §3.1.
//
// Naming is load-bearing: this is "Merge from file", never "Apply". Every
// document is sent as an RFC 7386 merge patch (or a create, if it doesn't
// exist yet) — it never prunes fields the file removed, unlike
// `kubectl apply`'s three-way merge. Never use the word "Apply" anywhere in
// this file's UI strings.
//
// File loading uses a plain <input type="file"> + File.text() rather than
// @tauri-apps/plugin-dialog's open(), which returns only a path — there is
// no path-taking command in the frozen §3.1 contract (both
// preview_yaml_documents and apply_yaml_documents take YAML text), and
// reading a path Rust-side would need the fs plugin/capability, which isn't
// present and is out of scope here (src-tauri/ is @rust-engineer's).
//
// Preview-staleness guard (the bug that bit the Phase 1 paste-kubeconfig
// modal): `preview` is cleared on every edit to `yaml`, from either typing
// or loading a new file, so "Merge" can never commit text different from
// what the accordion below is showing.

interface MergeFromFileModalProps {
  open: boolean;
  onClose: () => void;
  context: string;
}

function actionBadgeCls(action: DocPreview["action"]): string {
  if (action === "create") return "text-accent bg-accent/10 ring-accent/30";
  if (action === "error") return "text-bad bg-bad/10 ring-bad/30";
  return "text-warn bg-warn/10 ring-warn/30";
}

function DocCard({ doc }: { doc: DocPreview }) {
  const [expanded, setExpanded] = useState(doc.action !== "error");
  const rows = doc.action === "error" ? [] : previewRows(doc.live, doc.desired, "", doc.kind === "Secret");
  const result = capRows(rows, MAX_CHANGED_ROWS);

  return (
    <div className="rounded-lg ring-1 ring-edge overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-tint/3 transition-colors text-left"
      >
        <span className={`text-[9.5px] mono uppercase px-1.5 py-0.5 rounded-sm ring-1 shrink-0 ${actionBadgeCls(doc.action)}`}>
          {doc.action}
        </span>
        <span className="mono text-[11.5px] text-ink truncate">{doc.kind}/{doc.name}</span>
        {doc.namespace && <span className="mono text-[10.5px] text-dim shrink-0">{doc.namespace}</span>}
        <div className="flex-1" />
        <ChevronDown size={12} className={`text-dim transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-edge-raw/60">
          {doc.action === "error" ? (
            <p className="mono text-[11px] text-bad pt-2">{doc.error}</p>
          ) : rows.length === 0 ? (
            <p className="text-[11px] text-dim pt-2">Empty document</p>
          ) : (
            <div className="pt-2">
              <p className="text-[10.5px] uppercase tracking-wider text-dim font-semibold mb-1.5">
                These keys will be set:
              </p>
              <DiffRows
                result={result}
                emptyTitle="No changes — every key already matches the live object"
                label={`Keys that ${doc.kind}/${doc.name} will set`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ r }: { r: ApplyResult }) {
  const cls = r.action === "failed" ? "text-bad" : r.action === "created" ? "text-accent" : "text-ok";
  return (
    <div className="flex items-center gap-2 text-[11.5px] py-1">
      <span className={`mono text-[9.5px] uppercase px-1.5 py-0.5 rounded-sm ring-1 ${cls} bg-surface-tint/3 ring-current/30`}>
        {r.action}
      </span>
      <span className="mono text-ink/80">{r.kind}/{r.name}</span>
      {r.namespace && <span className="mono text-dim">{r.namespace}</span>}
      <span className="text-mute truncate">{r.message}</span>
    </div>
  );
}

export function MergeFromFileModal({ open, onClose, context }: MergeFromFileModalProps) {
  const [yaml, setYaml] = useState("");
  const [preview, setPreview] = useState<DocPreview[] | null>(null);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const previewMutation = usePreviewYamlDocuments();
  const applyMutation = useApplyYamlDocuments();
  const identity = useClusterIdentity(context);
  const gate = useWriteGate(context, open);
  const isTopmost = useModalLayer(open);

  // App.tsx mounts this modal unconditionally (it never unmounts on close),
  // so state from a previous open survives close/reopen on its own — the
  // per-edit staleness guard in resetToText() only covers "the text
  // changed", not "the world changed since this was last open". Two ways
  // that bites here specifically: reopening after a completed Merge would
  // leave a stale-but-valid-looking preview that re-enables the Merge
  // button immediately, and switching cluster while closed would leave
  // `preview`'s `live` snapshots describing the OLD cluster while `context`
  // now points at a different one. Reset on every open, and again if
  // `context` changes while open. Same pattern as ResourceCreator's
  // identical comment for the identical reason (App.tsx never unmounts it
  // either).
  useEffect(() => {
    if (open) {
      setYaml("");
      setPreview(null);
      setResults(null);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context]);

  // Esc closes only when this is the topmost layer and nothing is in flight.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applyMutation.isPending && isTopmost()) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, applyMutation.isPending, onClose, isTopmost]);

  if (!open) return null;

  function resetToText(text: string) {
    setYaml(text);
    // Preview-staleness guard: any new text invalidates the currently shown
    // preview so a stale accordion can never describe something different
    // from what Merge is about to send.
    setPreview(null);
    setResults(null);
    setError("");
  }

  async function handlePickFile() {
    fileInputRef.current?.click();
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    try {
      resetToText(await file.text());
    } catch (err) {
      setError((err as any)?.message ?? String(err));
    }
  }

  async function handlePreview() {
    setError("");
    try {
      const docs = await previewMutation.mutateAsync({ context, yaml });
      setPreview(docs);
      setResults(null);
    } catch (err) {
      setError((err as any)?.message ?? String(err));
    }
  }

  async function handleApply(dryRun: boolean) {
    setError("");
    try {
      const res = await applyMutation.mutateAsync({ context, yaml, dryRun });
      setResults(res);
      // Same defensive shape as ResourceCreator/ResourceEditor: if dryRun was
      // requested but nothing in the response says so, the backend mutated
      // for real despite the flag — invalidate manually since
      // useApplyYamlDocuments's onSuccess always skips it when dryRun is set.
      if (dryRun && !res.some((r) => r.message.toLowerCase().includes("dry run"))) {
        qc.invalidateQueries();
      }
    } catch (err) {
      setError((err as any)?.message ?? String(err));
    }
  }

  // G2: the document count is a bulk size. Over the limit refuses both buttons with the
  // same text the other bulk surfaces use. Read-only also blocks both (a dry run included).
  const bulk = checkBulk(preview?.length ?? 0, identity.bulkLimit, identity.label || context);
  const canAct = preview !== null && preview.length > 0 && !previewMutation.isPending && !applyMutation.isPending
    && !gate.readOnly && bulk.ok;
  // serde_yaml's multi-doc stream cannot resume after a parse error, so the backend
  // stops there. Documents after it were never read — the preview is a prefix of the
  // file, not the file. Merging would silently write part of it.
  const parseError = preview?.some((d) => d.action === "error") ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50">
      <div className="max-w-2xl w-full mx-4 bg-panel rounded-xl ring-1 ring-edge shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between px-4 py-3 border-b border-edge shrink-0">
          <div className="min-w-0">
            <ClusterBadge label={identity.label} color={identity.color} />
            <div className="text-[13px] font-semibold text-ink">Merge from file</div>
          </div>
          <button onClick={onClose} className="text-dim hover:text-mute transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex flex-col gap-3">
          <p className="text-[11.5px] text-mute">
            Each document is sent as a JSON merge patch — fields present in the file are set;
            fields the file omits are left alone. This does not prune, unlike <span className="mono">kubectl apply</span>.
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePickFile}
              className="h-7 px-2.5 rounded-md ring-1 ring-edge text-[11.5px] text-mute hover:text-ink flex items-center gap-1.5 transition-colors"
            >
              <FolderOpen size={12} /> Choose file…
            </button>
            <span className="text-[10.5px] text-dim">or paste YAML below</span>
            <input ref={fileInputRef} type="file" accept=".yaml,.yml,.yamlx,text/yaml" className="hidden" onChange={handleFileChosen} />
          </div>

          <textarea
            value={yaml}
            onChange={(e) => resetToText(e.target.value)}
            placeholder={"apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n  namespace: default\nspec:\n  ..."}
            rows={10}
            spellCheck={false}
            className="w-full font-mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-lg focus:outline-hidden focus:ring-accent/40 resize-y p-3 text-ink placeholder:text-dim"
          />

          <div className="flex items-center gap-2">
            <button
              onClick={handlePreview}
              disabled={!yaml.trim() || previewMutation.isPending}
              className="h-7 px-3 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[11.5px] hover:bg-accent/25 disabled:opacity-50 flex items-center gap-1.5"
            >
              {previewMutation.isPending && <Loader2 size={11} className="animate-spin" />}
              Preview
            </button>
            {preview && <span className="text-[10.5px] text-dim">{preview.length} document{preview.length !== 1 ? "s" : ""}</span>}
          </div>

          {error && (
            <p className="mono text-[11.5px] text-bad whitespace-pre-wrap">{error}</p>
          )}

          {preview && preview.length > 0 && (
            <div className="flex flex-col gap-2">
              {preview.map((doc) => <DocCard key={doc.index} doc={doc} />)}
            </div>
          )}

          {results && (
            <div className="rounded-lg ring-1 ring-edge p-2.5 flex flex-col gap-0.5">
              {results.map((r) => <ResultRow key={r.index} r={r} />)}
            </div>
          )}
        </div>

        {parseError && (
          <p className="px-4 pt-3 mono text-[11.5px] text-warn shrink-0">
            Parsing stopped at the error above — any documents after it were not read.
          </p>
        )}
        <div className="px-4 pt-3 shrink-0">
          {bulk.message && <p className="mb-2 text-[11.5px] text-mute">{bulk.message}</p>}
          {/* Merge from file is never rendered as `kubectl apply` (E6, D3-10): an explanation, not a command. */}
          <GuardrailBlock gate={gate} equivalent={mergeFromFileEquiv()} />
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[13px] text-mute hover:text-ink ring-1 ring-edge">
            Close
          </button>
          <button
            onClick={() => handleApply(true)}
            disabled={!canAct}
            title="Merge every document with dry_run — nothing is written"
            className="px-4 py-1.5 rounded-lg text-[13px] text-mute hover:text-ink ring-1 ring-edge disabled:opacity-50"
          >
            Dry run
          </button>
          <button
            onClick={() => handleApply(false)}
            disabled={!canAct || parseError || !gate.typedOk}
            title={parseError ? "Fix the parse error first — documents after it were not read" : gate.reason}
            className="bg-accent text-on-accent px-4 py-1.5 rounded-lg text-[13px] font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {applyMutation.isPending && <Loader2 size={13} className="animate-spin" />}
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
