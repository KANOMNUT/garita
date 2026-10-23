import { useEffect, useState } from "react";
import type { ResourceType } from "../../../types/k8s";
import type { EditForm, EditFormProps } from "../registry";
import { entryErrors, type Entry } from "../../create/emit";
import { TextField, KeyValueField } from "../../create/fields";
import { toEntries, buildConfigMapNext, decodeSecretData, buildSecretNext } from "../transforms";

// docs/plan-guided-edit.md §5 Tier 1: cm, sec.

function ReadOnlyMap({ label, entries }: { label: string; entries: Entry[] }) {
  return (
    <div>
      <span className="text-[10.5px] text-dim uppercase tracking-wider">{label}</span>
      {entries.length === 0 ? (
        <p className="text-[11.5px] text-dim mt-1">—</p>
      ) : (
        <div className="mt-1 flex flex-col gap-1">
          {entries.map((e) => (
            <div
              key={e.key}
              className="rounded-lg bg-card/50 ring-1 ring-edge px-2.5 py-1.5 text-[11.5px] mono text-ink truncate"
            >
              {e.key}={e.value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── cm ─────────────────────────────────────────────────────────────────────
// ConfigMap has none of Secret's dual-channel trap: plaintext `data`, plain
// clone-and-mutate. `data`/`binaryData` are top-level fields (no `.spec`).

function ConfigMapEditForm({ namespace: _namespace, context: _context, name: _name, live, onChange }: EditFormProps) {
  const immutable = live.immutable === true;
  const [labels, setLabels] = useState<Entry[]>(() => toEntries(live.metadata?.labels));
  const [annotations, setAnnotations] = useState<Entry[]>(() => toEntries(live.metadata?.annotations));
  const [data, setData] = useState<Entry[]>(() => toEntries(live.data));

  const valid =
    !immutable &&
    !entryErrors(data, "data").some(Boolean) &&
    !entryErrors(labels, "label").some(Boolean) &&
    !entryErrors(annotations, "annotation").some(Boolean);

  useEffect(() => {
    const next = buildConfigMapNext(live, { labels, annotations, data });
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, annotations, data, immutable]);

  if (immutable) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-warn bg-warn/10 ring-1 ring-warn/30 rounded-lg p-2.5">
          This ConfigMap is immutable — <span className="mono">data</span> is frozen, and{" "}
          <span className="mono">immutable</span> cannot be flipped back to <span className="mono">false</span>.
          Delete and recreate to change it.
        </p>
        <ReadOnlyMap label="Data" entries={data} />
        <ReadOnlyMap label="Labels" entries={labels} />
        <ReadOnlyMap label="Annotations" entries={annotations} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <KeyValueField keyKind="data"
        label="Data"
        entries={data}
        onChange={setData}
        multiline
        addLabel="add key"
        keyPlaceholder="key"
        valuePlaceholder="value"
      />
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

// ─── sec ────────────────────────────────────────────────────────────────────
// §3.4's sharpest trap: read/write/delete are three different fields.
//   read    -> live.data          (base64)
//   write   -> next.stringData    (cleartext, merged into data server-side
//              before ValidateSecret — never hand-base64 anything)
//   delete  -> next.data[key] = null via omission from the clone (deletion
//              CANNOT go through stringData — it only ever adds/overwrites)

function SecretEditForm({ namespace: _namespace, context: _context, name: _name, live, onChange }: EditFormProps) {
  const immutable = live.immutable === true;
  // Computed once from the frozen `live` prop — never re-derived, so a
  // user's in-progress edits always diff against the same original values.
  const [initial] = useState(() => decodeSecretData(live.data));
  const originalValues: Record<string, string> = {};
  for (const e of initial.decoded) originalValues[e.key] = e.value;

  const [entries, setEntries] = useState<Entry[]>(initial.decoded);
  const [labels, setLabels] = useState<Entry[]>(() => toEntries(live.metadata?.labels));
  const [annotations, setAnnotations] = useState<Entry[]>(() => toEntries(live.metadata?.annotations));

  const valid =
    !immutable &&
    !entryErrors(entries, "data").some(Boolean) &&
    !entryErrors(labels, "label").some(Boolean) &&
    !entryErrors(annotations, "annotation").some(Boolean);

  useEffect(() => {
    const next = buildSecretNext(live, { entries, labels, annotations }, originalValues, initial.failedKeys);
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, labels, annotations, immutable]);

  const typeField = (
    <TextField
      label="Type"
      value={live.type ?? "Opaque"}
      onChange={() => {}}
      disabled
      hint="Immutable — delete and recreate the Secret to change its type."
      mono
    />
  );

  const undecodableNote = initial.failedKeys.length > 0 && (
    <div>
      <span className="text-[10.5px] text-dim uppercase tracking-wider">Undecodable keys</span>
      <p className="text-[11.5px] text-dim mt-1">
        <span className="mono">{initial.failedKeys.join(", ")}</span> —{" "}
        {initial.failedKeys.length === 1 ? "its value isn't" : "their values aren't"} valid base64 text and can't be
        safely shown or edited here; left untouched. Use the YAML tab if you need to change{" "}
        {initial.failedKeys.length === 1 ? "it" : "them"}.
      </p>
    </div>
  );

  if (immutable) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-warn bg-warn/10 ring-1 ring-warn/30 rounded-lg p-2.5">
          This Secret is immutable — <span className="mono">data</span> is frozen, and{" "}
          <span className="mono">immutable</span> cannot be flipped back to <span className="mono">false</span>.
          Delete and recreate to change it.
        </p>
        {typeField}
        <ReadOnlyMap label="Data" entries={entries} />
        {undecodableNote}
        <ReadOnlyMap label="Labels" entries={labels} />
        <ReadOnlyMap label="Annotations" entries={annotations} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {typeField}
      <KeyValueField keyKind="data"
        label="Data"
        entries={entries}
        onChange={setEntries}
        multiline
        addLabel="add key"
        keyPlaceholder="key"
        valuePlaceholder="value"
      />
      {undecodableNote}
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

export const KEYVALUE_EDIT_FORMS: Partial<Record<ResourceType, EditForm>> = {
  cm: ConfigMapEditForm,
  sec: SecretEditForm,
};
