import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ResourceType } from "../../../types/k8s";
import type { EditForm, EditFormProps } from "../registry";
import { entryErrors, type Entry } from "../../create/emit";
import { TextField, NumberField, SelectField, KeyValueField, Section } from "../../create/fields";
import { UNITS, unitMultiplier, quantityToBytes, splitQuantity, type Unit } from "../quantity";

// docs/plan-guided-edit.md §5 Tier 2: pvc, rq, lr — deliberately narrow.

function toEntries(m: Record<string, string> | undefined): Entry[] {
  return m ? Object.entries(m).map(([key, value]) => ({ key, value })) : [];
}

// Same guard as keyvalue.tsx's setMap: only write the key when there is
// something to write, or `orig` already had it — otherwise `{}` gets
// fabricated against a field `live` never had, producing a spurious patch.
function setMap(obj: Record<string, any>, key: string, entries: Entry[], orig: Record<string, any> | undefined) {
  const value: Record<string, string> = {};
  for (const e of entries) if (e.key.trim() !== "") value[e.key] = e.value;
  if (Object.keys(value).length > 0 || orig?.[key] !== undefined) obj[key] = value;
}

// ─── pvc ────────────────────────────────────────────────────────────────────
// §5.1: everything on a PVC spec is immutable except resources.requests.storage
// (grow-only) and volumeAttributesClassName. Scope is narrowed further, per
// the dispatch brief, to exactly one editable field: storage size. Comparison
// is byte-based (not string/lexicographic) so e.g. "2Gi" -> "1500Mi" is
// correctly rejected as a shrink even though "1500" < "2" as text.

// Quantity parsing/compare lives in ../quantity.ts — pure, no JSX, so
// scripts/check-emit.ts can import and test it under Node type-stripping.

function PvcEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const currentStorage: string = live.spec?.resources?.requests?.storage ?? "0";
  const currentBytes = quantityToBytes(currentStorage) ?? 0;
  const seed = splitQuantity(currentStorage);
  const [amount, setAmount] = useState(seed.amount);
  const [unit, setUnit] = useState<Unit>(seed.unit);

  const amountNum = parseFloat(amount);
  const newBytes = amount.trim() !== "" && Number.isFinite(amountNum) ? amountNum * unitMultiplier(unit) : NaN;
  const tooSmall = Number.isFinite(newBytes) && newBytes < currentBytes;
  const valid = amount.trim() !== "" && Number.isFinite(newBytes) && !tooSmall;

  useEffect(() => {
    const next = structuredClone(live);
    if (valid) {
      next.spec ??= {};
      next.spec.resources ??= {};
      next.spec.resources.requests ??= {};
      next.spec.resources.requests.storage = `${amount}${unit}`;
    }
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, unit]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex gap-1.5 items-end">
          <div className="flex-1">
            <NumberField label="Storage size" value={amount} onChange={setAmount} placeholder="10" />
          </div>
          <div className="w-20">
            <SelectField label="Unit" value={unit} onChange={(v) => setUnit(v as Unit)} options={[...UNITS]} />
          </div>
        </div>
        <TextField
          label="Storage Class"
          value={live.spec?.storageClassName || "(default)"}
          onChange={() => {}}
          disabled
          hint="Immutable — cannot be changed after creation."
          mono
        />
      </div>
      <p className="text-[10.5px] text-dim">
        Current: <span className="mono text-ink">{currentStorage}</span> — storage can only grow, never shrink.
      </p>
      {tooSmall && <p className="text-[10.5px] text-bad">New size must be at least {currentStorage} (grow-only).</p>}
      <TextField
        label="Access Modes"
        value={(live.spec?.accessModes ?? []).join(", ") || "—"}
        onChange={() => {}}
        disabled
        hint="Immutable — cannot be changed after creation."
        mono
      />
    </div>
  );
}

// ─── rq ─────────────────────────────────────────────────────────────────────
// §5.1: spec.hard is fully mutable, map-shaped (mergePatch handles removals
// natively). spec.scopes is immutable — per §1.3's scope limit, not rendered
// at all (nothing to grey out; it isn't otherwise part of this form).

function RqEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const [hard, setHard] = useState<Entry[]>(() => toEntries(live.spec?.hard));
  const valid = !entryErrors(hard, "label").some(Boolean);

  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};
    // A row with a key but a blank value isn't a valid quota entry — drop it
    // rather than emit `key: ""`, which the API server hard-rejects.
    const clean = hard.filter((e) => e.key.trim() !== "" && e.value.trim() !== "");
    setMap(next.spec, "hard", clean, live.spec);
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hard]);

  return (
    <KeyValueField keyKind="label"
      label="Hard Limits"
      entries={hard}
      onChange={setHard}
      addLabel="add limit"
      keyPlaceholder="requests.cpu"
      valuePlaceholder="4"
    />
  );
}

// ─── lr ─────────────────────────────────────────────────────────────────────
// §5.1: nothing on LimitRange is immutable, but spec.limits is an ARRAY, so
// the mutate-in-place rule applies. Each row tracks `origIndex` back into
// `live.spec.limits`; an existing row's item is mutated in place inside the
// clone (never rebuilt from scratch), so any field this form doesn't model
// — including a non-cpu/memory resource key like `storage` on a
// PersistentVolumeClaim-type row's default/max/min block — rides along
// untouched. A row with no origIndex is genuinely new and has nothing prior
// to preserve.

type LimitBlock = { cpu: string; memory: string };
type LimitRow = {
  origIndex: number | undefined;
  type: string;
  default: LimitBlock;
  defaultRequest: LimitBlock;
  max: LimitBlock;
  min: LimitBlock;
};

function blockFrom(b: Record<string, string> | undefined): LimitBlock {
  return { cpu: b?.cpu ?? "", memory: b?.memory ?? "" };
}

function rowsFromLive(limits: Record<string, any>[] | undefined): LimitRow[] {
  return (limits ?? []).map((item, i) => ({
    origIndex: i,
    type: item.type ?? "Container",
    default: blockFrom(item.default),
    defaultRequest: blockFrom(item.defaultRequest),
    max: blockFrom(item.max),
    min: blockFrom(item.min),
  }));
}

function emptyRow(): LimitRow {
  return {
    origIndex: undefined,
    type: "Container",
    default: { cpu: "", memory: "" },
    defaultRequest: { cpu: "", memory: "" },
    max: { cpu: "", memory: "" },
    min: { cpu: "", memory: "" },
  };
}

// Merges cpu/memory into whatever resource-key map is already at `item[key]`
// (e.g. a PVC row's `max: { storage: "10Gi" }`) instead of replacing it
// wholesale — the same "don't rebuild what you don't fully model" rule
// applied one level deeper, to the per-type resource list itself.
function writeBlock(item: Record<string, any>, key: string, block: LimitBlock) {
  const existing: Record<string, string> = { ...(item[key] ?? {}) };
  if (block.cpu.trim() !== "") existing.cpu = block.cpu.trim();
  else delete existing.cpu;
  if (block.memory.trim() !== "") existing.memory = block.memory.trim();
  else delete existing.memory;
  if (Object.keys(existing).length > 0) item[key] = existing;
  else delete item[key];
}

function hasAnyValue(row: LimitRow): boolean {
  return [row.default, row.defaultRequest, row.max, row.min].some((b) => b.cpu.trim() !== "" || b.memory.trim() !== "");
}

function LimitRowEditor(p: { row: LimitRow; onChange: (r: LimitRow) => void; onRemove: () => void; removable: boolean }) {
  const set = (patch: Partial<LimitRow>) => p.onChange({ ...p.row, ...patch });
  return (
    <div className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
      <div className="flex items-end gap-1.5">
        <div className="flex-1">
          <SelectField
            label="Type"
            value={p.row.type}
            onChange={(v) => set({ type: v })}
            options={["Container", "Pod", "PersistentVolumeClaim"]}
          />
        </div>
        {p.removable && (
          <button
            type="button"
            onClick={p.onRemove}
            title="Remove row"
            className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Default CPU" value={p.row.default.cpu} onChange={(v) => set({ default: { ...p.row.default, cpu: v } })} placeholder="500m" mono />
        <TextField label="Default Memory" value={p.row.default.memory} onChange={(v) => set({ default: { ...p.row.default, memory: v } })} placeholder="256Mi" mono />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Default Request CPU"
          value={p.row.defaultRequest.cpu}
          onChange={(v) => set({ defaultRequest: { ...p.row.defaultRequest, cpu: v } })}
          placeholder="100m"
          mono
        />
        <TextField
          label="Default Request Memory"
          value={p.row.defaultRequest.memory}
          onChange={(v) => set({ defaultRequest: { ...p.row.defaultRequest, memory: v } })}
          placeholder="128Mi"
          mono
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Max CPU" value={p.row.max.cpu} onChange={(v) => set({ max: { ...p.row.max, cpu: v } })} placeholder="1" mono />
        <TextField label="Max Memory" value={p.row.max.memory} onChange={(v) => set({ max: { ...p.row.max, memory: v } })} placeholder="1Gi" mono />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Min CPU" value={p.row.min.cpu} onChange={(v) => set({ min: { ...p.row.min, cpu: v } })} placeholder="50m" mono />
        <TextField label="Min Memory" value={p.row.min.memory} onChange={(v) => set({ min: { ...p.row.min, memory: v } })} placeholder="64Mi" mono />
      </div>
    </div>
  );
}

function LrEditForm({ context: _context, namespace: _namespace, name: _name, live, onChange }: EditFormProps) {
  const [rows, setRows] = useState<LimitRow[]>(() => rowsFromLive(live.spec?.limits));
  const valid = rows.length > 0 && rows.some(hasAnyValue);

  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};
    const nextLimits: Record<string, any>[] = [];
    for (const row of rows) {
      // Mutate the clone's own original item in place when one exists —
      // `next.spec.limits` here is still the untouched deep clone of
      // `live.spec.limits`, so this carries forward every unmodelled field.
      const item: Record<string, any> = row.origIndex !== undefined ? next.spec.limits[row.origIndex] : { type: row.type };
      item.type = row.type;
      writeBlock(item, "default", row.default);
      writeBlock(item, "defaultRequest", row.defaultRequest);
      writeBlock(item, "max", row.max);
      writeBlock(item, "min", row.min);
      nextLimits.push(item);
    }
    next.spec.limits = nextLimits;
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const updateRow = (i: number, r: LimitRow) => setRows(rows.map((row, idx) => (idx === i ? r : row)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const addRow = () => setRows([...rows, emptyRow()]);

  return (
    <Section
      label="Limits"
      action={
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={11} /> add row
        </button>
      }
    >
      {rows.map((row, i) => (
        <LimitRowEditor key={i} row={row} onChange={(r) => updateRow(i, r)} onRemove={() => removeRow(i)} removable={rows.length > 1} />
      ))}
    </Section>
  );
}

export const STORAGE_EDIT_FORMS: Partial<Record<ResourceType, EditForm>> = {
  pvc: PvcEditForm,
  rq: RqEditForm,
  lr: LrEditForm,
};
