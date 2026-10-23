import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import type { BackendProbe, ObservabilityDiscovery, ObservabilityKind, ServiceTarget } from "../types/k8s";
import { discoverObservability, probeObservabilityBackend, useAccessChecks } from "../hooks/useResources";
import { CLUSTER_COLOR_CLASSES, getClusterIdentity, observabilityFor, setClusterIdentity } from "../utils/clusterIdentity";
import { PRODUCT_NAME } from "../brand";
import { disabledAttrs } from "../utils/guardrails";
import { ConfirmModal } from "./ConfirmModal";
import { useModalLayer } from "../utils/modalLayer";
import {
  FLAVOUR_LABEL, LOG_LABEL_PRESETS, draftErrors, draftsToObservability, emptyLogsDraft, emptyServiceDraft, hintLine, isForbidden,
  isUnsetDraft, logsDraft, logsTarget, metricsDraft, metricsTarget, onObservabilityDialogRequest, probeKey, probeLine, sameDrafts, skippedLine,
  validNamespace, withFlavour, type LogsDraft, type ServiceDraft,
} from "../utils/observability";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const BTN = "px-3 py-1.5 rounded-lg text-[12.5px] ring-1 ring-edge text-mute hover:text-ink transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden";
const BTN_PRIMARY = "px-3 py-1.5 rounded-lg text-[12.5px] ring-1 bg-accent/10 text-accent ring-accent/30 hover:bg-accent/20 transition-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden";
const INPUT = "w-full rounded-lg bg-surface-input/80 ring-1 ring-edge px-2 py-1 text-[12px] text-ink mono placeholder:text-dim outline-hidden focus:ring-accent/50 focus:ring-2 read-only:text-mute aria-invalid:ring-bad/60";

const errText = (e: unknown) => (e as any)?.message ?? String(e);

/** App-level host: listens for requestObservabilityDialog and mounts one dialog per open (key), so state never leaks between opens. */
export function ObservabilityDialogHost() {
  const [req, setReq] = useState<{ context: string; n: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const counter = useRef(0);
  // A request while a dialog is open is ignored.
  // Clearing the text first makes a second save announce again.
  useEffect(() => onObservabilityDialogRequest((context) => { setAnnounce(""); setReq((r) => r ?? { context, n: ++counter.current }); }), []);
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>
      {req && (
        <ObservabilityDialog
          key={req.n}
          context={req.context}
          onClose={(saved) => {
            if (saved) setAnnounce(`Observability settings saved for ${getClusterIdentity(req.context).label}.`);
            setReq(null);
          }}
        />
      )}
    </>
  );
}

function ObservabilityDialog({ context, onClose }: { context: string; onClose: (saved: boolean) => void }) {
  const isTopmost = useModalLayer(true);
  const identity = getClusterIdentity(context);
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLButtonElement>(null);
  const [initial] = useState(() => {
    const o = observabilityFor(context);
    return { m: metricsDraft(o?.prometheus), l: logsDraft(o?.logs) };
  });
  const [m, setM] = useState<ServiceDraft>(initial.m);
  const [l, setL] = useState<LogsDraft>(initial.l);
  const [showAll, setShowAll] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [fillNote, setFillNote] = useState("");

  const dirty = !sameDrafts({ m, l }, initial);
  const mErr = draftErrors(m);
  const lErr = draftErrors(l);
  const invalid = Object.keys(mErr).length + Object.keys(lErr).length > 0;

  const live = useRef({ dirty, onClose });
  live.current = { dirty, onClose };

  // Initial focus is Find services; on close, focus returns to the opener, else the Range radio, else the panel heading.
  useEffect(() => {
    // From the command palette the opener is <body>: that counts as no opener.
    const ae = document.activeElement;
    const opener = ae instanceof HTMLElement && ae !== document.body ? ae : null;
    const raf = requestAnimationFrame(() => findRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      const qs = (s: string) => document.querySelector<HTMLElement>(s);
      const back = opener?.isConnected
        ? opener
        : qs('[data-range-group] [aria-checked="true"]') ?? qs("[data-panel-heading]") ?? qs("main");
      back?.focus();
    };
  }, []);

  // Esc belongs to the dialog even inside inputs. Dirty: Esc opens the discard confirm, which owns Esc while open (later layer). Plus the focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTopmost() || e.isComposing) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        const s = live.current;
        if (s.dirty) setDiscard(true);
        else s.onClose(false);
        return;
      }
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); card.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!card.contains(active) || (e.shiftKey && active === first) || (!e.shiftKey && active === last)) {
        e.preventDefault();
        (e.shiftKey && card.contains(active) ? last : first).focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const card = cardRef.current;
      if (card && isTopmost() && !card.contains(e.target as Node)) (card.querySelector<HTMLElement>(FOCUSABLE) ?? card).focus();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [isTopmost]);

  function save() {
    if (invalid) {
      setShowAll(true);
      requestAnimationFrame(() => cardRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    // null deletes the key, so clearing both groups leaves no empty object.
    if (setClusterIdentity(context, { observability: draftsToObservability(m, l) })) onClose(true);
    else setSaveFailed(true);
  }

  function use(kind: ObservabilityKind, t: ServiceTarget) {
    if (kind === "prometheus") setM(metricsDraft(t));
    else setL((d) => ({ ...logsDraft({ service: t, flavour: kind, labels: LOG_LABEL_PRESETS[kind] }), tenant: d.tenant, labelMode: "preset", custom: d.custom }));
    setFillNote(`Filled ${kind === "prometheus" ? "Metrics" : "Logs"} from ${t.namespace}/${t.service}:${t.port}.`);
  }

  const chip = CLUSTER_COLOR_CLASSES[identity.color];
  const saveReason = invalid ? "Fix the highlighted fields." : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-surface-overlay/95 rounded-xl ring-1 ring-edge-strong shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col outline-hidden"
      >
        <div className="shrink-0 px-5 pt-5 pb-3 flex items-center gap-2.5 min-w-0">
          <h2 id={titleId} className="text-[14px] font-semibold text-ink">Observability</h2>
          <span className={`inline-flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-md bg-surface-tint/3 ring-1 ${chip.chipRing}`}>
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${chip.dot}`} />
            <span className={`mono text-[10.5px] truncate ${chip.text}`} title={identity.label}>{identity.label}</span>
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
          <p className="text-[12.5px] text-mute">
            {PRODUCT_NAME} reads metrics and logs through the Kubernetes API server's service proxy, using this cluster's credentials. It never connects to Prometheus, Loki or VictoriaLogs directly, and sends fixed queries only.
          </p>
          <Discovery context={context} findRef={findRef} onUse={use} />
          <div role="status" aria-live="polite" className="sr-only">{fillNote}</div>

          <Group
            title="Metrics: Prometheus" context={context} kind="prometheus" d={m} setD={setM} errors={mErr} showAll={showAll}
            empty={emptyServiceDraft()} buildTarget={metricsTarget}
          />
          <Group
            title="Logs" context={context} kind={l.flavour} d={l} setD={setL} errors={lErr} showAll={showAll}
            empty={{ ...emptyLogsDraft(l.flavour), labelMode: l.labelMode, custom: l.custom }} buildTarget={(d) => logsTarget(d as LogsDraft).service}
            before={
              <div role="radiogroup" aria-label="Backend" className="flex items-center gap-3 text-[12px] text-ink">
                <span className="text-mute">Backend</span>
                {(["loki", "victorialogs"] as const).map((f) => (
                  <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="log-backend" className="accent-accent" checked={l.flavour === f} onChange={() => setL(withFlavour(l, f))} />
                    {FLAVOUR_LABEL[f]}
                  </label>
                ))}
              </div>
            }
            tenant
            after={<LabelFields d={l} setD={setL} errors={lErr} showAll={showAll} />}
          />
        </div>

        <div className="shrink-0 px-5 pb-5 pt-2 border-t border-edge-raw/60">
          {saveFailed && (
            <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg px-3 py-2 ring-1 text-[12px] text-bad bg-bad/10 ring-bad/25">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              Couldn't save the settings on this computer.
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] text-mute">Saved on this computer.</span>
            {/* WKWebView does not focus a clicked button; without this the confirm would record <body> as its opener. */}
            <button onClick={(e) => { e.currentTarget.focus(); if (dirty) setDiscard(true); else onClose(false); }} className={BTN}>Cancel</button>
            <button onClick={save} {...disabledAttrs(saveReason)} className={BTN_PRIMARY}>Save</button>
          </div>
        </div>
      </div>
      {/* No `context`: discarding local edits is not a cluster write, so read-only and typed-label guardrails must not apply. */}
      <ConfirmModal
        open={discard}
        title="Discard changes?"
        description="Your unsaved edits to the observability settings will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        contextLabel={identity.label}
        contextColor={identity.color}
        onConfirm={() => onClose(false)}
        onCancel={() => setDiscard(false)}
      />
    </div>
  );
}

// ─── fields ──────────────────────────────────────────────────────────────────

function TextField({ label, value, onChange, onBlur, error, readOnly, placeholder, helper }: {
  label: string; value: string; onChange?: (v: string) => void; onBlur?: () => void; error?: string; readOnly?: boolean; placeholder?: string; helper?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <label htmlFor={id} className="text-[11px] text-mute">{label}</label>
      <input
        id={id} value={value} readOnly={readOnly} placeholder={placeholder} spellCheck={false}
        onChange={(e) => onChange?.(e.target.value)} onBlur={onBlur}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : helper ? `${id}-h` : undefined}
        className={INPUT}
      />
      {error ? <p id={`${id}-e`} className="text-[10.5px] text-bad">{error}</p> : helper ? <p id={`${id}-h`} className="text-[10.5px] text-mute">{helper}</p> : null}
    </div>
  );
}

function LabelFields({ d, setD, errors, showAll }: { d: LogsDraft; setD: (d: LogsDraft) => void; errors: ReturnType<typeof draftErrors>; showAll: boolean }) {
  const preset = d.labelMode === "preset";
  const names = preset ? LOG_LABEL_PRESETS[d.flavour] : d.custom;
  const [touched, setTouched] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[12px]">
        <label className="text-mute" htmlFor="log-label-mode">Labels</label>
        <select
          id="log-label-mode" value={d.labelMode}
          onChange={(e) => {
            const mode = e.target.value as "preset" | "custom";
            // Opening Custom from an untouched copy of a preset starts from the shown names.
            const untouched = Object.values(LOG_LABEL_PRESETS).some((p) => sameDrafts(p, d.custom));
            setD({ ...d, labelMode: mode, custom: mode === "custom" && untouched ? { ...LOG_LABEL_PRESETS[d.flavour] } : d.custom });
          }}
          className="rounded-lg bg-surface-input/80 ring-1 ring-edge px-2 py-1 text-[12px] text-ink outline-hidden focus:ring-accent/50 focus:ring-2"
        >
          <option value="preset">Preset: {FLAVOUR_LABEL[d.flavour]}</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["namespace", "pod", "container"] as const).map((k) => (
          <TextField
            key={k} label={`${k[0].toUpperCase()}${k.slice(1)} label`} value={names[k]} readOnly={preset}
            onChange={(v) => setD({ ...d, custom: { ...d.custom, [k]: v } })}
            onBlur={() => setTouched(true)}
            error={!preset && (showAll || touched) ? errors[`label_${k}` as const] : undefined}
          />
        ))}
      </div>
    </div>
  );
}

type Draftish = ServiceDraft | LogsDraft;

function Group<T extends Draftish>({ title, context, kind, d, setD, errors, showAll, empty, buildTarget, before, after, tenant }: {
  title: string; context: string; kind: ObservabilityKind; d: T; setD: (d: T) => void; errors: ReturnType<typeof draftErrors>; showAll: boolean;
  empty: T; buildTarget: (d: T) => ServiceTarget; before?: ReactNode; after?: ReactNode; tenant?: boolean;
}) {
  const hid = useId();
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [test, setTest] = useState<{ key: string; r: "testing" | BackendProbe } | null>(null);
  const [committedNs, setCommittedNs] = useState("");
  const req = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const touch = (k: string) => setTouched((s) => new Set(s).add(k));
  const shown = (k: keyof typeof errors) => (showAll || touched.has(k) ? errors[k] : undefined);
  // Any edit clears this group's result: "Reachable" must not stay on screen for a different service.
  const edit = (patch: Partial<Draftish>) => { req.current++; setTest(null); setD({ ...d, ...patch }); };

  // A result belongs to the target it tested: anything that changes the key (edit, Use, Backend switch) hides it.
  const key = probeKey(kind, buildTarget(d));
  const mine = test?.key === key ? test.r : null;
  const unset = isUnsetDraft(d);
  const testReason = unset || Object.keys(errors).length ? "Fill in namespace, service and port first." : undefined;
  // The hint runs on the committed (blurred, valid) namespace. Fails open; it never disables Test.
  const access = useAccessChecks(context, [{ group: "", resource: "services", verb: "get", namespace: committedNs, subresource: "proxy" }], !!committedNs);
  const denied = access.data?.[0]?.allowed === false;

  function runTest() {
    if (testReason || mine === "testing") return;
    const id = ++req.current;
    setTest({ key, r: "testing" });
    const done = (r: BackendProbe) => { if (alive.current && req.current === id) setTest({ key, r }); };
    probeObservabilityBackend(context, buildTarget(d), kind)
      .then(done)
      .catch((e) => { const message = errText(e); done({ state: isForbidden(message) ? "forbidden" : "unreachable", message, version: null }); });
  }

  return (
    <section role="group" aria-labelledby={hid} className="flex flex-col gap-2 pt-3 border-t border-edge-raw/60">
      <h3 id={hid} className="text-[9.5px] uppercase tracking-wider text-dim font-semibold">{title}</h3>
      {before}
      <div className="grid grid-cols-3 gap-2">
        <TextField label="Namespace" value={d.namespace} onChange={(v) => edit({ namespace: v })} error={shown("namespace")}
          onBlur={() => { touch("namespace"); setCommittedNs(validNamespace(d.namespace) ? d.namespace : ""); }} />
        <TextField label="Service" value={d.service} onChange={(v) => edit({ service: v })} onBlur={() => touch("service")} error={shown("service")} />
        <TextField label="Port" value={d.port} onChange={(v) => edit({ port: v })} onBlur={() => touch("port")} error={shown("port")} />
      </div>
      <div className="grid grid-cols-3 gap-2 items-start">
        <div role="radiogroup" aria-label={`${title} scheme`} className="flex flex-col gap-0.5 text-[12px] text-ink">
          <span className="text-[11px] text-mute">Scheme</span>
          <div className="flex items-center gap-3 py-1">
            {(["http", "https"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name={`${hid}-scheme`} className="accent-accent" checked={d.scheme === s} onChange={() => edit({ scheme: s })} />
                {s}
              </label>
            ))}
          </div>
        </div>
        <TextField label="Path prefix" value={d.path_prefix} onChange={(v) => edit({ path_prefix: v })} onBlur={() => touch("path_prefix")} error={shown("path_prefix")} placeholder="optional" />
        {tenant && (
          <TextField label="Tenant (X-Scope-OrgID)" value={d.tenant} onChange={(v) => edit({ tenant: v })} onBlur={() => touch("tenant")} error={shown("tenant")}
            helper="Only for a multi-tenant Loki. Leave empty otherwise." />
        )}
      </div>
      {after}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={runTest} {...disabledAttrs(testReason)} aria-disabled={testReason || mine === "testing" ? true : undefined} className={`${BTN} flex items-center gap-1.5`}>
          {mine === "testing" && <Loader2 size={12} className="animate-spin" />}
          Test
        </button>
        <div role="status" aria-live="polite" className="flex-1 min-w-0 text-[12px] text-ink wrap-break-word">
          {mine === "testing" && "Testing…"}
          {mine && mine !== "testing" && (
            <span className="inline-flex items-start gap-1.5">
              {mine.state === "ok" ? <CheckCircle2 size={13} className="text-ok shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />}
              <span>{probeLine(mine, kind, d)}</span>
            </span>
          )}
        </div>
        <button onClick={() => { req.current++; setTest(null); setTouched(new Set()); setCommittedNs(""); setD(empty); }} className={BTN}>Clear</button>
      </div>
      {committedNs && committedNs === d.namespace && (
        <p className="flex items-start gap-1.5 text-[11px] text-mute">
          <Info size={12} className="shrink-0 mt-0.5" />
          {hintLine(committedNs, denied)}
        </p>
      )}
    </section>
  );
}

// ─── discovery ───────────────────────────────────────────────────────────────

const SHOWN_ROWS = 8;

function Discovery({ context, findRef, onUse }: {
  context: string; findRef: React.RefObject<HTMLButtonElement>; onUse: (kind: ObservabilityKind, t: ServiceTarget) => void;
}) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [res, setRes] = useState<ObservabilityDiscovery | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [more, setMore] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (more) listRef.current?.querySelector<HTMLElement>("[data-first-new]")?.focus(); }, [more]);
  const req = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  function run(allNamespaces: boolean) {
    if (state === "running") return;
    const id = ++req.current;
    setState("running");
    setAll(allNamespaces);
    discoverObservability(context, allNamespaces)
      .then((r) => { if (alive.current && req.current === id) { setRes(r); setState("done"); setMore(false); } })
      .catch((e) => { if (alive.current && req.current === id) { setError(errText(e)); setState("error"); } });
  }

  const running = state === "running";
  const cands = res?.candidates ?? [];
  const rows = more ? cands : cands.slice(0, SHOWN_ROWS);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button ref={findRef} onClick={() => run(false)} aria-disabled={running || undefined} className={`${BTN} flex items-center gap-1.5`}>
          {running && <Loader2 size={12} className="animate-spin" />}
          {running ? "Searching…" : state === "idle" ? "Find services" : "Find services again"}
        </button>
        {state !== "idle" && !all && (
          <button onClick={() => { run(true); findRef.current?.focus(); }} aria-disabled={running || undefined} className={BTN}>Search all namespaces</button>
        )}
        {state === "idle" && <span className="text-[11px] text-mute">Searches monitoring, observability, prometheus, loki and kube-prometheus-stack first.</span>}
        {state !== "idle" && !all && <span className="text-[11px] text-mute">Lists Services in every namespace your account can read.</span>}
      </div>
      <div role="status" aria-live="polite" className="text-[12px] text-ink">
        {state === "done" && (cands.length > 0
          ? `Found ${cands.length} ${cands.length === 1 ? "service" : "services"}.`
          : all
            ? "None found in any namespace you can read. Enter the service manually."
            : "No Prometheus, Loki or VictoriaLogs services found in the common namespaces.")}
        {state === "error" && <p className="text-warn">Couldn't search for services. {error}</p>}
        {state === "done" && (res?.skipped.length ?? 0) > 0 && <p className="text-[11px] text-mute">{skippedLine(res!.skipped)}</p>}
      </div>
      {state === "error" && <div><button onClick={() => run(all)} className={BTN}>Retry</button></div>}
      {rows.length > 0 && (
        <div ref={listRef} className="flex flex-col gap-1 rounded-lg ring-1 ring-edge bg-surface-tint/2 p-2">
          <div className="text-[10.5px] text-mute">Suggestions only; check the service before saving.</div>
          {rows.map((c, i) => (
            <div key={`${c.kind}/${c.target.namespace}/${c.target.service}/${c.target.port}`} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-ink wrap-break-word">
                  <span className="text-mute mr-2">{FLAVOUR_LABEL[c.kind]}</span>
                  <span className="mono">{c.target.namespace}/{c.target.service}:{c.target.port}</span>
                </div>
                <div className="text-[10.5px] text-mute wrap-break-word">{c.reason}</div>
              </div>
              <button data-first-new={more && i === SHOWN_ROWS ? "" : undefined} onClick={() => onUse(c.kind, c.target)} aria-label={`Use ${FLAVOUR_LABEL[c.kind]} ${c.target.namespace}/${c.target.service}:${c.target.port}`} className={BTN}>Use</button>
            </div>
          ))}
          {!more && cands.length > SHOWN_ROWS && (
            <button onClick={() => setMore(true)} className="self-start min-h-6 px-2 rounded-sm text-[11px] text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden">Show {cands.length - SHOWN_ROWS} more</button>
          )}
        </div>
      )}
    </div>
  );
}

