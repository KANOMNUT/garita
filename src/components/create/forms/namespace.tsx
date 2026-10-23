import { useEffect, useState } from "react";
import type { CreatableKind } from "../../../utils/resourceTemplates";
import type { CreateForm, CreateFormProps } from "../registry";
import { validateNamespace, entryErrors, metadata, doc, type Entry } from "../emit";
import { TextField, KeyValueField } from "../fields";

function serialise(name: string, labels: Entry[], annotations: Entry[]): string {
  return doc([["apiVersion: v1", "kind: Namespace"], metadata(name, null, labels, annotations)]);
}

// Cluster-scoped: metadata(name, null, ...) — no namespace field on the
// form (a Namespace cannot itself belong to a namespace), so `namespace`
// and `context` from CreateFormProps are unused here.
export function NamespaceForm({ namespace: _namespace, context: _context, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<Entry[]>([]);
  const [annotations, setAnnotations] = useState<Entry[]>([]);

  const nameError = validateNamespace(name);
  const valid = !nameError && !entryErrors(labels, "label").some(Boolean) && !entryErrors(annotations, "annotation").some(Boolean);

  useEffect(() => {
    onChange(serialise(name, labels, annotations), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, labels, annotations]);

  return (
    <div className="flex flex-col gap-3">
      <TextField label="Name" value={name} onChange={setName} placeholder="my-namespace" error={name ? nameError : ""} mono />
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

export const NS_FORMS: Partial<Record<CreatableKind, CreateForm>> = { ns: NamespaceForm };
