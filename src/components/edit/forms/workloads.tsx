// OWNED BY THIS AGENT (Phase B, docs/plan-guided-edit.md §9): exactly
// deploy/sts/ds (one shared container editor — spec.template.spec.containers[]
// is the same path across all three) and cron (its own narrow form). See
// docs/plan-guided-edit.md §5 Tier 1 + Tier 2.
//
// ── Central rule, restated for this file specifically ───────────────────
// The container editor NEVER reconstructs a container object from its own
// state. It mutates image/args/env/resources fields on the CLONED element
// in place, one field at a time. Everything else on that element
// (volumeMounts, probes, securityContext, lifecycle, ports, command,
// terminationMessagePath, any sidecar this form renders no row for) rides
// along untouched because it is never overwritten. `env` gets the same
// treatment one level down: entries carrying `valueFrom` are copied through
// verbatim in their original slot; only plain-value entries are rebuilt
// from the form's own KeyValueField state (see reconcileEnv). `spec.
// template.spec.initContainers` is a sibling array this form never
// references at all, so it survives on the clone by construction.
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ResourceType } from "../../../types/k8s";
import type { EditForm, EditFormProps } from "../registry";
import { entryErrors, type Entry, type ResourceReq } from "../../create/emit";
import { TextField, NumberField, SelectField, CheckField, StringListField, KeyValueField, QuantityField, Section } from "../../create/fields";
import { validateQuantity } from "../quantity";
import { toEntries, seedContainers, buildWorkloadNext, type ContainerEdit } from "../transforms";

// Same QuantityField primitive fields.tsx's create-side ResourcesField now
// uses — see CLAUDE.md's quantity-1000x bug entry. This form seeds from the
// live Quantity strings ("100m", "128Mi"), so a plain NumberField (digits
// only) would have silently stripped the unit on every retype.
function ContainerResourcesFields(p: { value: ResourceReq; onChange: (v: ResourceReq) => void }) {
  const set = (patch: Partial<ResourceReq>) => p.onChange({ ...p.value, ...patch });
  return (
    <Section label="Resources">
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
    </Section>
  );
}

function resourcesValid(r: ResourceReq): boolean {
  return !validateQuantity(r.cpuReq) && !validateQuantity(r.memReq) && !validateQuantity(r.cpuLim) && !validateQuantity(r.memLim);
}

function containersValid(containers: ContainerEdit[]): boolean {
  return containers.every(
    (c) => c.image.trim() !== "" && !entryErrors(c.env, "data").some(Boolean) && resourcesValid(c.resources),
  );
}

// deploy / sts / ds share this ONE component — spec.selector,
// sts.spec.serviceName/volumeClaimTemplates/podManagementPolicy are
// immutable (§5.1) but are never rendered here at all: this form renders
// containers, not the workload's top-level spec, so there is nothing to
// grey out (§1.3's scope limit). `replicas` is deliberately not modelled —
// WorkloadActions already ships scale/restart/pause/rollback.
export function WorkloadContainersForm({
  context: _context,
  namespace: _namespace,
  name: _name,
  live,
  onChange,
}: EditFormProps) {
  const [containers, setContainers] = useState<ContainerEdit[]>(() => seedContainers(live));
  const [labels, setLabels] = useState<Entry[]>(() => toEntries(live.metadata?.labels));
  const [annotations, setAnnotations] = useState<Entry[]>(() => toEntries(live.metadata?.annotations));
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));

  const valid =
    containersValid(containers) &&
    !entryErrors(labels, "label").some(Boolean) &&
    !entryErrors(annotations, "annotation").some(Boolean);

  const updateContainer = (i: number, patch: Partial<ContainerEdit>) =>
    setContainers((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  useEffect(() => {
    const next = buildWorkloadNext(live, { containers, labels, annotations });
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, labels, annotations]);

  const multi = containers.length > 1;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-dim">
        Replica count, restart, pause/resume and rollback are handled by the existing Scale action, not this form.
      </p>
      {containers.length === 0 && <p className="text-[11.5px] text-dim">No containers found on this workload.</p>}
      {containers.map((c, i) => {
        const isOpen = !multi || open.has(i);
        return (
          <div key={c.name || i} className="rounded-lg bg-card/50 ring-1 ring-edge p-2">
            <div className="flex items-center gap-1.5">
              {multi && (
                <button type="button" onClick={() => toggle(i)} className="text-dim hover:text-ink shrink-0">
                  <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
              )}
              <span className="mono text-[11.5px] text-ink flex-1 truncate">{c.name || `container[${i}]`}</span>
            </div>
            {isOpen && (
              <div className="flex flex-col gap-2 mt-2">
                <TextField
                  label="Image"
                  value={c.image}
                  onChange={(v) => updateContainer(i, { image: v })}
                  placeholder="nginx:1.27"
                  mono
                />
                <StringListField label="Args" values={c.args} onChange={(v) => updateContainer(i, { args: v })} placeholder="-c" />
                <KeyValueField keyKind="data"
                  label="Env"
                  entries={c.env}
                  onChange={(v) => updateContainer(i, { env: v })}
                  multiline
                  addLabel="add env"
                  keyPlaceholder="NAME"
                  valuePlaceholder="value"
                />
                <ContainerResourcesFields value={c.resources} onChange={(v) => updateContainer(i, { resources: v })} />
              </div>
            )}
          </div>
        );
      })}
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <KeyValueField keyKind="annotation"
        label="Annotations"
        entries={annotations}
        onChange={setAnnotations}
        keyPlaceholder="key"
        valuePlaceholder="value"
      />
    </div>
  );
}

// ─── CronJob — its own narrow form (Tier 2) ─────────────────────────────
// Per §5.1, ValidateCronJobUpdate makes ZERO ValidateImmutableField calls —
// nothing here needs a disabled/hint pair. jobTemplate is deliberately not
// modelled: editing it only affects future job runs, which is confusing UI
// for little gain, and the YAML tab already covers it.
const CONCURRENCY_POLICIES = ["Allow", "Forbid", "Replace"];

export function CronEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const [schedule, setSchedule] = useState<string>(() => live.spec?.schedule ?? "");
  const [suspend, setSuspend] = useState<boolean>(() => !!live.spec?.suspend);
  const [concurrencyPolicy, setConcurrencyPolicy] = useState<string>(() => live.spec?.concurrencyPolicy ?? "Allow");
  const [successLimit, setSuccessLimit] = useState<string>(() =>
    live.spec?.successfulJobsHistoryLimit !== undefined ? String(live.spec.successfulJobsHistoryLimit) : "",
  );
  const [failedLimit, setFailedLimit] = useState<string>(() =>
    live.spec?.failedJobsHistoryLimit !== undefined ? String(live.spec.failedJobsHistoryLimit) : "",
  );

  // NumberField allows transient partial input like "." (Number(".") is
  // NaN). NaN JSON-serialises to `null`, which on this wire IS the RFC 7386
  // delete sentinel — writing it unguarded would silently clear the field
  // on the server for a value the user hasn't finished typing. Only ever
  // write a value once it's actually finite; an unparseable non-empty
  // string blocks submit via `valid` instead of touching the clone.
  const successNum = successLimit.trim() === "" ? undefined : Number(successLimit);
  const successValid = successLimit.trim() === "" || Number.isFinite(successNum);
  const failedNum = failedLimit.trim() === "" ? undefined : Number(failedLimit);
  const failedValid = failedLimit.trim() === "" || Number.isFinite(failedNum);

  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};
    next.spec.schedule = schedule;
    // suspend/concurrencyPolicy are server-defaulted at admission (Allow /
    // false) and that default is normally persisted onto the stored
    // object, so this is a no-op for almost every real CronJob — but guard
    // presence anyway now that this effect is already being touched for
    // the NaN fix below, for the same reason args/env are guarded on the
    // workload form: writing a key the live object never had would make a
    // zero-edit render diverge from `live` and produce a phantom patch.
    if (suspend || Object.prototype.hasOwnProperty.call(live.spec ?? {}, "suspend")) next.spec.suspend = suspend;
    if (
      concurrencyPolicy !== "Allow" ||
      Object.prototype.hasOwnProperty.call(live.spec ?? {}, "concurrencyPolicy")
    ) {
      next.spec.concurrencyPolicy = concurrencyPolicy;
    }
    if (successLimit.trim() === "") delete next.spec.successfulJobsHistoryLimit;
    else if (Number.isFinite(successNum)) next.spec.successfulJobsHistoryLimit = successNum;
    if (failedLimit.trim() === "") delete next.spec.failedJobsHistoryLimit;
    else if (Number.isFinite(failedNum)) next.spec.failedJobsHistoryLimit = failedNum;
    onChange(next, schedule.trim() !== "" && successValid && failedValid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, suspend, concurrencyPolicy, successLimit, failedLimit]);

  return (
    <div className="flex flex-col gap-3">
      <TextField label="Schedule" value={schedule} onChange={setSchedule} placeholder="*/5 * * * *" mono />
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Concurrency Policy" value={concurrencyPolicy} onChange={setConcurrencyPolicy} options={CONCURRENCY_POLICIES} />
        <CheckField label="Suspend" value={suspend} onChange={setSuspend} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Successful Jobs History Limit" value={successLimit} onChange={setSuccessLimit} placeholder="3" />
        <NumberField label="Failed Jobs History Limit" value={failedLimit} onChange={setFailedLimit} placeholder="1" />
      </div>
    </div>
  );
}

export const WORKLOAD_EDIT_FORMS: Partial<Record<ResourceType, EditForm>> = {
  deploy: WorkloadContainersForm,
  sts: WorkloadContainersForm,
  ds: WorkloadContainersForm,
  cron: CronEditForm,
};
