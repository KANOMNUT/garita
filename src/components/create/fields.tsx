import { useId, useState, type ReactNode } from "react";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import { entryErrors, type Entry, type PortEntry, type ResourceReq, type ContainerEntry } from "./emit";
import { validateQuantity } from "../edit/quantity";
import { useConfigMaps, useSecrets } from "../../hooks/useResources";

// Styling in every widget below matches the shipped KeyValueForm exactly
// (same Tailwind token classes) — this is the shared field layer four
// Phase-2 agents build ~19 forms out of, so consistency here is the whole
// point.

export function Section(p: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center mb-1.5">
        <span className="text-[10.5px] text-dim uppercase tracking-wider flex-1">{p.label}</span>
        {p.action}
      </div>
      {p.children}
    </div>
  );
}

// multiline: true -> <textarea> instead of <input>, same classes. Added for
// the Secret tls form's PEM fields (a single-line input is unusable for a
// multi-line certificate) — this is the one permitted addition to this
// shared primitive rather than a bespoke textarea component.
//
// disabled/hint: added for the guided-edit feature (docs/plan-guided-edit.md
// §1.3) — an immutable field is rendered disabled with a one-line reason
// beneath it, never omitted, so a user who came to change it is told why
// they can't rather than left hunting. Same shape of minimal additive
// change `multiline?` was. Scope limit: only apply this to a field the form
// already renders for other reasons — never add a field solely to disable
// it (see edit/registry.ts's header comment).
export function TextField(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  mono?: boolean;
  multiline?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const className = `mt-1 w-full ${p.mono ? "mono" : ""} text-[12px] bg-card/50 ring-1 rounded-lg px-2.5 py-1.5 text-ink placeholder:text-dim focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed ${
    p.error ? "ring-bad/50" : "ring-edge focus:ring-accent/40"
  }`;
  return (
    <div>
      <label className="text-[10.5px] text-dim uppercase tracking-wider">{p.label}</label>
      {p.multiline ? (
        <textarea
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          placeholder={p.placeholder}
          rows={6}
          disabled={p.disabled}
          className={`${className} resize-y`}
        />
      ) : (
        <input
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          placeholder={p.placeholder}
          disabled={p.disabled}
          className={className}
        />
      )}
      {p.error && <p className="text-[10.5px] text-bad mt-1">{p.error}</p>}
      {!p.error && p.hint && <p className="text-[10.5px] text-dim mt-1">{p.hint}</p>}
    </div>
  );
}

// State stays a string, never a coerced number — an empty field must mean
// "omit this key", which a number type cannot express (0 is a valid value,
// NaN is not "empty").
export function NumberField(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-[10.5px] text-dim uppercase tracking-wider">{p.label}</label>
      <input
        value={p.value}
        onChange={(e) => {
          // Numeric-only at the source. These values go out through kvRaw as
          // bare YAML literals, so "abc" would emit an unquoted non-number
          // the API server rejects with an opaque type error.
          const v = e.target.value;
          if (/^-?\d*\.?\d*$/.test(v)) p.onChange(v);
        }}
        placeholder={p.placeholder}
        inputMode="decimal"
        disabled={p.disabled}
        className="mt-1 w-full mono text-[12px] bg-card/50 ring-1 ring-edge rounded-lg px-2.5 py-1.5 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {p.hint && <p className="text-[10.5px] text-dim mt-1">{p.hint}</p>}
    </div>
  );
}

// A Kubernetes Quantity ("100m", "128Mi", "4") is NOT a number — it carries a
// unit suffix that is part of the value, not noise to strip. Unlike
// NumberField, this does NO source-level character filtering (that's the
// 1000x CPU/memory bug this field exists to close — see CLAUDE.md's Known
// Open Items). Validated via validateQuantity from edit/quantity.ts, the
// same primitive the PVC grow-only check uses.
export function QuantityField(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const error = p.value ? validateQuantity(p.value) : "";
  const className = `mt-1 w-full mono text-[12px] bg-card/50 ring-1 rounded-lg px-2.5 py-1.5 text-ink placeholder:text-dim focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed ${
    error ? "ring-bad/50" : "ring-edge focus:ring-accent/40"
  }`;
  return (
    <div>
      <label className="text-[10.5px] text-dim uppercase tracking-wider">{p.label}</label>
      <input
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        placeholder={p.placeholder}
        inputMode="text"
        disabled={p.disabled}
        className={className}
      />
      {error && <p className="text-[10.5px] text-bad mt-1">{error}</p>}
      {!error && p.hint && <p className="text-[10.5px] text-dim mt-1">{p.hint}</p>}
    </div>
  );
}

// Deliverable 0: a native <input list>+<datalist> could not be visually
// verified in the Tauri WKWebView from this environment (screencapture has
// no Screen Recording grant here, and System Events hangs on an
// Accessibility permission prompt — see the phase report). Took the
// documented fallback: a real <select>, always carrying the current value
// as an option even when it's outside the fetched list, plus a "custom…"
// option that swaps to a plain text input. `isCustom` is its own state,
// independent of list membership — otherwise, once the user starts typing
// a value that happens to not be in `options`, the widget would never be
// able to tell "user is typing a custom value" from "value just isn't
// loaded yet" and could flip back to select mode mid-keystroke.
export function SelectField(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  loading?: boolean;
  placeholder?: string;
  allowCustom?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const [isCustom, setIsCustom] = useState(
    () => !!p.allowCustom && p.value !== "" && !p.options.includes(p.value),
  );
  const isDisabled = p.loading || p.disabled;

  if (p.allowCustom && isCustom) {
    return (
      <div>
        {p.label && <label className="text-[10.5px] text-dim uppercase tracking-wider">{p.label}</label>}
        <div className="mt-1 flex items-center gap-1.5">
          <input
            value={p.value}
            onChange={(e) => p.onChange(e.target.value)}
            placeholder={p.placeholder}
            disabled={isDisabled}
            className="flex-1 mono text-[12px] bg-card/50 ring-1 ring-edge rounded-lg px-2.5 py-1.5 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={() => setIsCustom(false)}
            disabled={isDisabled}
            title="Pick from list"
            className="mono text-[10.5px] text-dim hover:text-ink px-1.5 py-1 rounded-sm hover:bg-surface-tint/6 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            list
          </button>
        </div>
        {p.hint && <p className="text-[10.5px] text-dim mt-1">{p.hint}</p>}
      </div>
    );
  }

  const options = !p.value || p.options.includes(p.value) ? p.options : [p.value, ...p.options];

  return (
    <div>
      {p.label && <label className="text-[10.5px] text-dim uppercase tracking-wider">{p.label}</label>}
      <select
        value={p.value}
        disabled={isDisabled}
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            setIsCustom(true);
            return;
          }
          p.onChange(e.target.value);
        }}
        className="mt-1 w-full mono text-[12px] bg-card/50 ring-1 ring-edge rounded-lg px-2.5 py-1.5 text-ink focus:outline-hidden focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {!p.value && <option value="">{p.placeholder ?? "select…"}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {p.allowCustom && <option value="__custom__">custom…</option>}
      </select>
      {p.hint && <p className="text-[10.5px] text-dim mt-1">{p.hint}</p>}
    </div>
  );
}

export function CheckField(p: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label
        className={`flex items-center gap-2 text-[12px] text-ink select-none ${
          p.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <input
          type="checkbox"
          checked={p.value}
          onChange={(e) => p.onChange(e.target.checked)}
          disabled={p.disabled}
          className="h-3.5 w-3.5 rounded-sm accent-accent disabled:cursor-not-allowed"
        />
        {p.label}
      </label>
      {p.hint && <p className="text-[10.5px] text-dim mt-1 ml-5">{p.hint}</p>}
    </div>
  );
}

// ponytail: exact-key allowlist of tooling-managed annotations, kept
// read-only IN the entries array rather than filtered out of it — the edit
// forms rebuild their annotations map wholesale from this component's own
// entries, so a filtered-out key would round-trip as a `null` deletion (see
// CLAUDE.md's Bug 1b). Deliberately NOT prefix-based: argocd.argoproj.io/
// sync-wave and .../hook are hand-set by users constantly, and
// kubectl.kubernetes.io/default-container is user intent, not tooling.
// Extend this set on demand as more system-managed keys turn up.
const SYSTEM_MANAGED_ANNOTATION_KEYS = new Set([
  "kubectl.kubernetes.io/last-applied-configuration",
  "argocd.argoproj.io/tracking-id",
  "deployment.kubernetes.io/revision",
  "meta.helm.sh/release-name",
  "meta.helm.sh/release-namespace",
]);

// The repeatable key/value rows block, extracted from the shipped
// KeyValueForm verbatim (including entryErrors inline messages).
// multiline: true -> <textarea rows={3}> (labels/annotations/quota limits
// want a single-line input; ConfigMap/Secret data wants a textarea).
export function KeyValueField(p: {
  label: string;
  entries: Entry[];
  onChange: (e: Entry[]) => void;
  // Required, not defaulted: entryErrors validates a completely different
  // grammar per kind (ConfigMap/Secret data keys vs. label/annotation
  // qualified names — see CLAUDE.md's Known Open Items). A default would let
  // a new call site silently inherit the wrong one; tsc forcing every caller
  // to pick is the whole fix for that bug class.
  keyKind: "data" | "label" | "annotation";
  multiline?: boolean;
  addLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const errs = entryErrors(p.entries, p.keyKind);
  const update = (i: number, patch: Partial<Entry>) =>
    p.onChange(p.entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => p.onChange(p.entries.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.entries, { key: "", value: "" }]);
  const addLabel = p.addLabel ?? "add";

  return (
    <div>
      <div className="flex items-center mb-1.5">
        <span className="text-[10.5px] text-dim uppercase tracking-wider flex-1">{p.label}</span>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={11} /> {addLabel}
        </button>
      </div>
      {p.entries.length === 0 && (
        <p className="text-[11.5px] text-dim">No entries yet — click "{addLabel}" to add one.</p>
      )}
      {p.entries.map((entry, i) => {
        const systemManaged = p.keyKind === "annotation" && SYSTEM_MANAGED_ANNOTATION_KEYS.has(entry.key);
        return (
          <div key={i} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2">
            <div className="flex items-center gap-1.5">
              <input
                value={entry.key}
                onChange={(e) => update(i, { key: e.target.value })}
                placeholder={p.keyPlaceholder ?? "key"}
                disabled={systemManaged}
                className={`flex-1 mono text-[11.5px] bg-transparent ring-1 rounded px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed ${
                  entry.key && errs[i] ? "ring-bad/50" : "ring-edge focus:ring-accent/40"
                }`}
              />
              {!p.multiline && (
                <input
                  value={entry.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={p.valuePlaceholder ?? "value"}
                  disabled={systemManaged}
                  title={systemManaged ? entry.value : undefined}
                  className="flex-1 mono text-[11.5px] bg-transparent ring-1 ring-edge rounded-sm px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              )}
              {!systemManaged && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Remove"
                  className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            {entry.key && errs[i] && !systemManaged && <p className="text-[10.5px] text-bad mt-1">{errs[i]}</p>}
            {systemManaged && <p className="text-[10.5px] text-dim mt-1">tool-managed — read-only</p>}
            {p.multiline && (
              <textarea
                value={entry.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder={p.valuePlaceholder ?? "value"}
                rows={3}
                disabled={systemManaged}
                title={systemManaged ? entry.value : undefined}
                className="mt-1.5 w-full mono text-[11.5px] bg-transparent ring-1 ring-edge rounded-sm px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40 resize-y disabled:opacity-50 disabled:cursor-not-allowed"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Repeatable single-string rows (container command/args). `suggest` is an
// optional <datalist> hint — unlike SelectField, this is a soft enhancement
// (worst case with no WKWebView support: no suggestions, the input still
// works as plain text), not the field's only affordance, so the WKWebView
// datalist-reliability concern from Deliverable 0 doesn't apply here.
export function StringListField(p: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggest?: string[];
}) {
  const listId = useId();
  const update = (i: number, v: string) => p.onChange(p.values.map((val, idx) => (idx === i ? v : val)));
  const remove = (i: number) => p.onChange(p.values.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.values, ""]);

  return (
    <div>
      <div className="flex items-center mb-1.5">
        <span className="text-[10.5px] text-dim uppercase tracking-wider flex-1">{p.label}</span>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={11} /> add
        </button>
      </div>
      {p.suggest && p.suggest.length > 0 && (
        <datalist id={listId}>
          {p.suggest.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {p.values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5 mb-1.5">
          <input
            value={v}
            onChange={(e) => update(i, e.target.value)}
            placeholder={p.placeholder}
            list={p.suggest && p.suggest.length > 0 ? listId : undefined}
            className="flex-1 mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-sm px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            title="Remove"
            className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PortListField(p: {
  label: string;
  ports: PortEntry[];
  onChange: (p: PortEntry[]) => void;
  shape: "container" | "service";
}) {
  const update = (i: number, patch: Partial<PortEntry>) =>
    p.onChange(p.ports.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => p.onChange(p.ports.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.ports, { name: "", port: "", targetPort: "", protocol: "TCP" }]);

  return (
    <div>
      <div className="flex items-center mb-1.5">
        <span className="text-[10.5px] text-dim uppercase tracking-wider flex-1">{p.label}</span>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={11} /> add port
        </button>
      </div>
      {p.ports.map((port, i) => (
        <div key={i} className="flex items-center gap-1.5 mb-1.5">
          <input
            value={port.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="name"
            className="w-20 mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-sm px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40"
          />
          <input
            value={port.port}
            onChange={(e) => update(i, { port: e.target.value })}
            placeholder={p.shape === "container" ? "containerPort" : "port"}
            inputMode="numeric"
            className="w-24 mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-sm px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40"
          />
          {p.shape === "service" && (
            <input
              value={port.targetPort}
              onChange={(e) => update(i, { targetPort: e.target.value })}
              placeholder="targetPort"
              inputMode="numeric"
              className="w-24 mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-sm px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40"
            />
          )}
          <select
            value={port.protocol}
            onChange={(e) => update(i, { protocol: e.target.value })}
            className="mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-sm px-2 py-1 text-ink focus:outline-hidden focus:ring-accent/40"
          >
            <option value="TCP">TCP</option>
            <option value="UDP">UDP</option>
            {p.shape === "container" && <option value="SCTP">SCTP</option>}
          </select>
          <button
            type="button"
            onClick={() => remove(i)}
            title="Remove"
            className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ResourcesField(p: { value: ResourceReq; onChange: (v: ResourceReq) => void }) {
  const set = (patch: Partial<ResourceReq>) => p.onChange({ ...p.value, ...patch });
  return (
    <div>
      <span className="text-[10.5px] text-dim uppercase tracking-wider">Resources</span>
      <div className="grid grid-cols-2 gap-2 mt-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <QuantityField label="CPU request" value={p.value.cpuReq} onChange={(v) => set({ cpuReq: v })} placeholder="100m" />
          <QuantityField label="Mem request" value={p.value.memReq} onChange={(v) => set({ memReq: v })} placeholder="128Mi" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <QuantityField label="CPU limit" value={p.value.cpuLim} onChange={(v) => set({ cpuLim: v })} placeholder="500m" />
          <QuantityField label="Mem limit" value={p.value.memLim} onChange={(v) => set({ memLim: v })} placeholder="256Mi" />
        </div>
      </div>
    </div>
  );
}

// The one composite field. Per-container: name + image + command/args +
// ports + env + envFrom + resources. Collapses into an accordion when there
// is more than one container — reusing the chevron-toggle feel from
// DetailPanel.tsx's Containers tab rather than inventing a new mechanism.
export function ContainerListField(p: {
  containers: ContainerEntry[];
  onChange: (c: ContainerEntry[]) => void;
  context: string;
  namespace: string;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
  const { data: configMaps = [] } = useConfigMaps(p.context, p.namespace);
  const { data: secrets = [] } = useSecrets(p.context, p.namespace);
  const cmNames = configMaps.map((c) => c.name);
  const secretNames = secrets.map((s) => s.name);

  const update = (i: number, patch: Partial<ContainerEntry>) =>
    p.onChange(p.containers.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => p.onChange(p.containers.filter((_, idx) => idx !== i));
  const add = () =>
    p.onChange([
      ...p.containers,
      {
        name: "",
        image: "",
        command: [],
        args: [],
        ports: [],
        env: [],
        envFrom: [],
        resources: { cpuReq: "", memReq: "", cpuLim: "", memLim: "" },
      },
    ]);
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const multi = p.containers.length > 1;

  return (
    <div>
      <div className="flex items-center mb-1.5">
        <span className="text-[10.5px] text-dim uppercase tracking-wider flex-1">Containers</span>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={11} /> add container
        </button>
      </div>
      {p.containers.map((c, i) => {
        const isOpen = !multi || open.has(i);
        return (
          <div key={i} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2">
            <div className="flex items-center gap-1.5">
              {multi && (
                <button type="button" onClick={() => toggle(i)} className="text-dim hover:text-ink shrink-0">
                  <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
              )}
              <input
                value={c.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="container name"
                className="flex-1 mono text-[11.5px] bg-transparent ring-1 ring-edge rounded-sm px-2 py-1 text-ink placeholder:text-dim focus:outline-hidden focus:ring-accent/40"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                title="Remove container"
                className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
            {isOpen && (
              <div className="flex flex-col gap-2 mt-2">
                <TextField label="Image" value={c.image} onChange={(v) => update(i, { image: v })} placeholder="nginx:1.27" mono />
                <StringListField label="Command" values={c.command} onChange={(v) => update(i, { command: v })} placeholder="/bin/sh" />
                <StringListField label="Args" values={c.args} onChange={(v) => update(i, { args: v })} placeholder="-c" />
                <PortListField label="Ports" ports={c.ports} onChange={(v) => update(i, { ports: v })} shape="container" />
                <KeyValueField keyKind="data"
                  label="Env"
                  entries={c.env}
                  onChange={(v) => update(i, { env: v })}
                  multiline
                  addLabel="add env"
                  keyPlaceholder="NAME"
                  valuePlaceholder="value"
                />
                <Section
                  label="Env From"
                  action={
                    <button
                      type="button"
                      onClick={() => update(i, { envFrom: [...c.envFrom, { kind: "configMapRef", name: "" }] })}
                      className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
                    >
                      <Plus size={11} /> add source
                    </button>
                  }
                >
                  {c.envFrom.map((ef, j) => (
                    <div key={j} className="flex items-center gap-1.5 mb-1.5">
                      <select
                        value={ef.kind}
                        onChange={(e) =>
                          update(i, {
                            envFrom: c.envFrom.map((x, idx) =>
                              idx === j ? { ...x, kind: e.target.value as "configMapRef" | "secretRef", name: "" } : x,
                            ),
                          })
                        }
                        className="mono text-[11.5px] bg-card/50 ring-1 ring-edge rounded-sm px-2 py-1 text-ink focus:outline-hidden focus:ring-accent/40"
                      >
                        <option value="configMapRef">ConfigMap</option>
                        <option value="secretRef">Secret</option>
                      </select>
                      <div className="flex-1">
                        <SelectField
                          label="Source"
                          value={ef.name}
                          onChange={(v) =>
                            update(i, { envFrom: c.envFrom.map((x, idx) => (idx === j ? { ...x, name: v } : x)) })
                          }
                          options={ef.kind === "configMapRef" ? cmNames : secretNames}
                          allowCustom
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => update(i, { envFrom: c.envFrom.filter((_, idx) => idx !== j) })}
                        title="Remove"
                        className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </Section>
                <ResourcesField value={c.resources} onChange={(v) => update(i, { resources: v })} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
