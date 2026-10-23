import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmModal } from "./ConfirmModal";
import { DiffRows } from "./DiffRows";
import { useKubeContexts, useNamespaces, useResourceJson } from "../hooks/useResources";
import { CLUSTER_COLOR_CLASSES, getClusterIdentity, useClusterIdentity } from "../utils/clusterIdentity";
import { changeCountText, diffObjects } from "../utils/diffRows";
import {
  classifyReadError, compareIgnore, IGNORED_NOTE, notFoundText, sameApiServer, sameApiServerLine,
} from "../utils/resourceCompare";

// #8 resource diff (docs/ux/03 §6): "is staging really the same as prod?". A READ — it writes
// nothing — so it is not a write confirm; it borrows ConfirmModal's shell (focus trap, Esc
// layering, size lg) and opts out of the guardrails (`ignoreGuardrails`): read-only mode and
// RBAC never disable it. Both sides are read with get_resource_json (which takes a context),
// so no new backend is involved.

interface Side { ctx: string; ns: string; name: string }

interface Props {
  context: string;
  kind: string;
  kindLabel: string;
  namespace: string;
  name: string;
  /** Cluster-scoped kinds hide the Namespace select. */
  clusterScoped: boolean;
  onClose: () => void;
}

function Who({ ctx, ns }: { ctx: string; ns: string }) {
  const id = getClusterIdentity(ctx);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full shrink-0 ${CLUSTER_COLOR_CLASSES[id.color].dot}`} />
      <span className="mono text-[11.5px] text-ink truncate">{id.label || ctx}</span>
      {ns && <span className="mono text-[11px] text-dim truncate">/ {ns}</span>}
    </span>
  );
}

const field = "h-8 px-2.5 rounded-md bg-surface-input/80 ring-1 ring-edge text-[12px] text-ink focus:outline-hidden focus:ring-accent/50 focus:ring-2";
const now = () => new Date().toLocaleTimeString([], { hour12: false });

export function ResourceCompareDialog({ context, kind, kindLabel, namespace, name, clusterScoped, onClose }: Props) {
  const identity = useClusterIdentity(context);
  const { data: contexts = [] } = useKubeContexts();
  const [step, setStep] = useState<"pick" | "diff">("pick");
  const [mode, setMode] = useState<"ns" | "cluster">("ns");
  const [otherCtx, setOtherCtx] = useState("");
  const [otherNs, setOtherNs] = useState("");
  const [otherName, setOtherName] = useState(name);
  const [includeStatus, setIncludeStatus] = useState(false);
  const [sides, setSides] = useState<{ left: Side; right: Side } | null>(null);
  const [comparedAt, setComparedAt] = useState("");

  const pickCtx = mode === "cluster" ? otherCtx : context;
  const nsQuery = useNamespaces(pickCtx);
  const namespaces = nsQuery.data ?? [];
  const nsLoading = !clusterScoped && !!pickCtx && nsQuery.isLoading;
  const effectiveNs = clusterScoped ? "" : otherNs;
  const pickReady =
    otherName.trim() !== "" && !nsLoading &&
    (mode === "cluster" ? otherCtx !== "" : true) &&
    (clusterScoped || effectiveNs !== "");

  const left = useResourceJson(sides?.left.ctx ?? "", sides?.left.ns ?? "", kind, sides?.left.name ?? "", step === "diff");
  const right = useResourceJson(sides?.right.ctx ?? "", sides?.right.ns ?? "", kind, sides?.right.name ?? "", step === "diff");
  const loading = step === "diff" && (left.isLoading || right.isLoading);

  const result = useMemo(
    () =>
      left.data && right.data
        ? diffObjects(left.data, right.data, {
            ignore: compareIgnore(includeStatus),
            maskSecretData: kind === "sec",
            emptyEqualsAbsent: true,
          })
        : null,
    [left.data, right.data, includeStatus, kind],
  );

  // #33 (B-2): both sides of a Secret compare are whole-object reads. Remove their exact keys on unmount
  // (not forgetSecret: that would also end the panel's own reveal).
  const qc = useQueryClient();
  const secretKeys = useRef<unknown[][]>([]);
  useEffect(() => () => { for (const queryKey of secretKeys.current) qc.removeQueries({ queryKey }); }, [qc]);

  const run = () => {
    const next = {
      left: { ctx: context, ns: namespace, name },
      right: { ctx: mode === "cluster" ? otherCtx : context, ns: effectiveNs, name: otherName.trim() },
    };
    if (kind === "sec") for (const s of [next.left, next.right]) secretKeys.current.push(["resource-json", "sec", s.ctx, s.ns, s.name]);
    setSides(next);
    setComparedAt(now());
    setStep("diff");
  };
  const swap = () => { if (sides) { setSides({ left: sides.right, right: sides.left }); setComparedAt(now()); } };
  const retry = () => { void left.refetch(); void right.refetch(); setComparedAt(now()); };

  const msg = (e: unknown) => (e as any)?.message ?? String(e);
  const leftCtx = contexts.find((c) => c.name === sides?.left.ctx);
  const rightCtx = contexts.find((c) => c.name === sides?.right.ctx);
  const identical =
    !!sides && sides.left.ctx !== sides.right.ctx && sameApiServer(leftCtx, rightCtx) &&
    sides.left.ns === sides.right.ns && sides.left.name === sides.right.name;
  const label = (ctx: string) => getClusterIdentity(ctx).label || ctx;

  // The OTHER side's problems are states, not generic errors; the left side keeps rendering.
  let body: React.ReactNode = null;
  if (step === "diff" && sides) {
    const rightErr = right.isError ? msg(right.error) : "";
    const leftErr = left.isError ? msg(left.error) : "";
    const rc = rightErr ? classifyReadError(rightErr) : null;
    if (loading) {
      body = (
        <div className="flex flex-col gap-2" aria-hidden>
          <p className="text-[11.5px] text-dim">Comparing…</p>
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-3 rounded-sm bg-surface-tint/5 motion-safe:animate-pulse" />)}
        </div>
      );
    } else if (rightErr || leftErr) {
      const err = rightErr || leftErr;
      const side = rightErr ? sides.right : sides.left;
      const cls = classifyReadError(err);
      const c = label(side.ctx);
      let text: string;
      if (rightErr && rc === "not-found") text = `${notFoundText(kindLabel, side.name, c, side.ns)} Check the name, or pick another namespace.`;
      else if (cls === "not-installed") text = `${kindLabel} isn't installed on ${c}.`;
      else if (cls === "no-access") text = `You don't have access to ${kindLabel}s in ${c}${side.ns ? ` / ${side.ns}` : ""}. Your account can't get this resource. Ask a cluster admin for the get permission.${rightErr ? " Couldn't read the other side." : ""}`;
      else if (cls === "unreachable") text = `Can't reach ${c}. ${err}`;
      else text = `Couldn't load ${kindLabel} "${side.name}" from ${c}: ${err}.`;
      body = (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-surface-tint/3 ring-1 ring-edge px-3 py-2.5 text-[12px] text-mute">
          <p>{text}</p>
          {cls !== "not-found" && <button type="button" onClick={retry} className="self-start px-2 py-1 rounded-md text-[11.5px] ring-1 ring-edge hover:text-ink">Retry</button>}
        </div>
      );
    } else if (result) {
      body = (
        <div className="flex flex-col gap-2">
          {identical && <p className="text-[11.5px] text-mute">{sameApiServerLine(label(sides.left.ctx), label(sides.right.ctx))}</p>}
          <p className="text-[10.5px] text-dim">
            − only in {label(sides.left.ctx)}   + only in {label(sides.right.ctx)}   ~ differs
          </p>
          <span className="self-start text-[11.5px] text-ink px-2 py-0.5 rounded-md bg-surface-tint/4 ring-1 ring-edge">
            {result.changed === 0 ? "No differences" : `${changeCountText(result.changed)}`}
          </span>
          <DiffRows
            result={result}
            insideDefaultOpen
            label={`Differences between the two ${kindLabel} objects`}
            emptyTitle="No differences."
            emptySecondary="These two objects match after ignoring status and managed fields."
          />
          <p className="text-[10.5px] text-dim">{IGNORED_NOTE}</p>
        </div>
      );
    }
  }

  const picker = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1 text-[12px]">
        <span className="text-[10.5px] uppercase tracking-wider text-dim font-semibold">This object</span>
        <Who ctx={context} ns={namespace} />
        <span className="mono text-[11.5px] text-mute">{name}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        <span className="text-[10.5px] uppercase tracking-wider text-dim font-semibold">Compare with</span>
        <div role="radiogroup" aria-label="Compare with" className="flex flex-col gap-1">
          {([["ns", "Another namespace"], ["cluster", "Another cluster"]] as const).map(([id, text]) => (
            <label key={id} className="flex items-center gap-2 text-[12px] text-ink cursor-pointer">
              <input type="radio" name="compare-mode" checked={mode === id} onChange={() => { setMode(id); setOtherNs(""); }} className="accent-accent" />
              {text}
            </label>
          ))}
        </div>
        {mode === "cluster" && (
          <label className="flex flex-col gap-1 text-[11px] text-dim">
            Cluster
            <select value={otherCtx} onChange={(e) => { setOtherCtx(e.target.value); setOtherNs(""); }} className={field}>
              <option value="">Select a cluster…</option>
              {contexts.map((c) => <option key={c.name} value={c.name}>{getClusterIdentity(c.name).label || c.name}</option>)}
            </select>
          </label>
        )}
        {!clusterScoped && (
          <label className="flex flex-col gap-1 text-[11px] text-dim">
            Namespace
            <select value={otherNs} onChange={(e) => setOtherNs(e.target.value)} disabled={nsLoading || (mode === "cluster" && !otherCtx)} className={field}>
              <option value="">{nsLoading ? "Loading namespaces…" : "Select a namespace…"}</option>
              {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-dim">
          Name
          <input value={otherName} onChange={(e) => setOtherName(e.target.value)} spellCheck={false} className={`${field} mono`} />
        </label>
      </div>
      <div className="sm:col-span-2 flex flex-col gap-1.5">
        <p className="text-[10.5px] text-dim">{IGNORED_NOTE}</p>
        <label className="flex items-center gap-2 text-[12px] text-ink cursor-pointer">
          <input type="checkbox" checked={includeStatus} onChange={(e) => setIncludeStatus(e.target.checked)} className="accent-accent" />
          Include status
        </label>
      </div>
    </div>
  );

  const btn = "px-3 py-1.5 rounded-lg text-[12.5px] text-mute ring-1 ring-edge hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <ConfirmModal
      open
      size="lg"
      destructive={false}
      initialFocus={step === "pick" ? undefined : "cancel"}
      context={identity.context}
      ignoreGuardrails
      contextLabel={identity.label}
      contextColor={identity.color}
      title={`Compare ${kindLabel} ${name}`}
      description={
        step === "diff" && sides ? (
          <>
            <span className="flex flex-wrap items-center gap-2">
              <Who ctx={sides.left.ctx} ns={sides.left.ns} /> <span className="text-dim">vs</span> <Who ctx={sides.right.ctx} ns={sides.right.ns} />
            </span>
            {comparedAt && <span className="block mt-0.5 text-[11.5px] text-dim">Compared {comparedAt}. Either side can change after this.</span>}
          </>
        ) : (
          "Reads the same kind from another namespace or cluster and shows what differs. Nothing is written."
        )
      }
      confirmLabel="Compare"
      confirmDisabled={!pickReady}
      confirmDisabledReason={!pickReady ? "Choose what to compare with." : undefined}
      footer={
        step === "diff" ? (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={swap} className={btn}>Swap sides</button>
            <button type="button" onClick={() => setStep("pick")} className={btn}>Change comparison</button>
            <button type="button" data-modal-cancel onClick={onClose} className={btn}>Close</button>
          </div>
        ) : undefined
      }
      onConfirm={() => { if (step === "pick") run(); }}
      onCancel={onClose}
    >
      {step === "pick" ? picker : body}
    </ConfirmModal>
  );
}
