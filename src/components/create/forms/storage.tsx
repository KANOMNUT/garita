// OWNED BY THE STORAGE AGENT. Exactly these five kinds, no others:
//   pvc, pv, sc, rq, lr
//
// NOT in scope: cert (cert-manager CRD) and pc (PriorityClass). Neither was
// in the request; both stay template-only.
//
// cm/sec are already migrated and live in ./keyvalue.tsx — do not touch.
//
// pv and sc are CLUSTER-SCOPED: metadata(name, null, ...) and no namespace
// input at all. rq/lr/pvc are namespaced.
//
// rq (flat spec.hard map) and lr (array of per-type blocks) are NOT the same
// shape despite sitting together in the sidebar. Separate components.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CreatableKind } from "../../../utils/resourceTemplates";
import type { CreateForm, CreateFormProps } from "../registry";
import { validateName, validateNamespace, entryErrors, kv, kvRaw, emitMap, emitList, metadata, doc, type Entry } from "../emit";
import { Section, TextField, SelectField, CheckField, KeyValueField, StringListField } from "../fields";
import { useNamespaces, useStorageClasses } from "../../../hooks/useResources";

// ─── Shared: access-mode checkboxes (pvc + pv) ─────────────────────────────

const ACCESS_MODES = ["ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany", "ReadWriteOncePod"] as const;
type AccessMode = (typeof ACCESS_MODES)[number];
type AccessModeState = Record<AccessMode, boolean>;
const DEFAULT_ACCESS_MODES: AccessModeState = {
  ReadWriteOnce: true,
  ReadOnlyMany: false,
  ReadWriteMany: false,
  ReadWriteOncePod: false,
};

function AccessModesField(p: { value: AccessModeState; onChange: (v: AccessModeState) => void }) {
  return (
    <Section label="Access Modes">
      <div className="flex flex-col gap-1.5">
        {ACCESS_MODES.map((m) => (
          <CheckField key={m} label={m} value={p.value[m]} onChange={(v) => p.onChange({ ...p.value, [m]: v })} />
        ))}
      </div>
    </Section>
  );
}

// Storage quantities (Ki/Mi/Gi/Ti/Pi/Ei binary or k/M/G/T/P/E decimal
// suffixes, or a bare byte count) — shared by pvc's `storage` and pv's
// `capacity.storage`.
const QUANTITY_RE = /^\d+(\.\d+)?(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/;
function validateQuantity(v: string): string {
  if (!v.trim()) return "Required";
  if (!QUANTITY_RE.test(v.trim())) return "Invalid quantity (e.g. 1Gi, 500Mi)";
  return "";
}

const pad = (n: number) => " ".repeat(n);

// ─── pvc ────────────────────────────────────────────────────────────────────

function serialisePvc(
  name: string,
  ns: string,
  labels: Entry[],
  modes: AccessModeState,
  storage: string,
  storageClassName: string,
  volumeMode: string,
  volumeName: string,
): string {
  const spec: string[] = ["spec:"];
  spec.push(...emitList("accessModes", ACCESS_MODES.filter((m) => modes[m]), 2));
  spec.push("  resources:", "    requests:");
  spec.push(...kv("storage", storage.trim(), 6));
  if (storageClassName.trim()) spec.push(...kv("storageClassName", storageClassName.trim(), 2));
  if (volumeMode) spec.push(...kvRaw("volumeMode", volumeMode, 2));
  if (volumeName.trim()) spec.push(...kv("volumeName", volumeName.trim(), 2));
  const head = ["apiVersion: v1", "kind: PersistentVolumeClaim", ...metadata(name, ns, labels)];
  return doc([head, spec]);
}

function PvcForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [modes, setModes] = useState<AccessModeState>(DEFAULT_ACCESS_MODES);
  const [storage, setStorage] = useState("1Gi");
  const [storageClassName, setStorageClassName] = useState("");
  const [volumeMode, setVolumeMode] = useState("");
  const [volumeName, setVolumeName] = useState("");
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);
  const { data: storageClasses = [], isLoading: scLoading } = useStorageClasses(context);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const storageError = validateQuantity(storage);
  const modeCount = ACCESS_MODES.filter((m) => modes[m]).length;
  const valid = !nameError && !namespaceError && !storageError && modeCount > 0 && !entryErrors(labels, "label").some(Boolean);

  useEffect(() => {
    onChange(serialisePvc(name, ns, labels, modes, storage, storageClassName, volumeMode, volumeName), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, modes, storage, storageClassName, volumeMode, volumeName]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="example-data" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <AccessModesField value={modes} onChange={setModes} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Storage" value={storage} onChange={setStorage} placeholder="1Gi" error={storage ? storageError : ""} mono />
        <SelectField
          label="Storage Class"
          value={storageClassName}
          onChange={setStorageClassName}
          options={storageClasses.map((sc) => sc.name)}
          loading={scLoading}
          allowCustom
          placeholder="(cluster default)"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Volume Mode"
          value={volumeMode}
          onChange={setVolumeMode}
          options={["Filesystem", "Block"]}
          placeholder="(default: Filesystem)"
        />
        <TextField label="Volume Name" value={volumeName} onChange={setVolumeName} placeholder="(for static binding)" mono />
      </div>
    </div>
  );
}

// ─── pv (cluster-scoped) ────────────────────────────────────────────────────

type HostPathSource = { path: string; type: string };
type NfsSource = { server: string; path: string };
type CsiSource = { driver: string; volumeHandle: string; fsType: string };
type PvSource = "hostPath" | "nfs" | "csi";

// Three fixed branches — deliberately not a config-driven source registry.
function serialisePv(
  name: string,
  labels: Entry[],
  capacity: string,
  modes: AccessModeState,
  reclaimPolicy: string,
  storageClassName: string,
  volumeMode: string,
  source: PvSource,
  hostPath: HostPathSource,
  nfs: NfsSource,
  csi: CsiSource,
): string {
  const spec: string[] = ["spec:", "  capacity:"];
  spec.push(...kv("storage", capacity.trim(), 4));
  spec.push(...emitList("accessModes", ACCESS_MODES.filter((m) => modes[m]), 2));
  spec.push(...kvRaw("persistentVolumeReclaimPolicy", reclaimPolicy, 2));
  if (storageClassName.trim()) spec.push(...kv("storageClassName", storageClassName.trim(), 2));
  if (volumeMode) spec.push(...kvRaw("volumeMode", volumeMode, 2));
  if (source === "hostPath") {
    spec.push("  hostPath:");
    spec.push(...kv("path", hostPath.path.trim(), 4));
    if (hostPath.type) spec.push(...kvRaw("type", hostPath.type, 4));
  } else if (source === "nfs") {
    spec.push("  nfs:");
    spec.push(...kv("server", nfs.server.trim(), 4));
    spec.push(...kv("path", nfs.path.trim(), 4));
  } else {
    spec.push("  csi:");
    spec.push(...kv("driver", csi.driver.trim(), 4));
    spec.push(...kv("volumeHandle", csi.volumeHandle.trim(), 4));
    if (csi.fsType.trim()) spec.push(...kv("fsType", csi.fsType.trim(), 4));
  }
  const head = ["apiVersion: v1", "kind: PersistentVolume", ...metadata(name, null, labels)];
  return doc([head, spec]);
}

function PvForm({ namespace: _namespace, context, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<Entry[]>([]);
  const [capacity, setCapacity] = useState("1Gi");
  const [modes, setModes] = useState<AccessModeState>(DEFAULT_ACCESS_MODES);
  const [reclaimPolicy, setReclaimPolicy] = useState("Retain");
  const [storageClassName, setStorageClassName] = useState("");
  const [volumeMode, setVolumeMode] = useState("");
  const [source, setSource] = useState<PvSource>("hostPath");
  const [hostPath, setHostPath] = useState<HostPathSource>({ path: "", type: "" });
  const [nfs, setNfs] = useState<NfsSource>({ server: "", path: "" });
  const [csi, setCsi] = useState<CsiSource>({ driver: "", volumeHandle: "", fsType: "" });
  const { data: storageClasses = [], isLoading: scLoading } = useStorageClasses(context);

  const nameError = validateName(name);
  const capacityError = validateQuantity(capacity);
  const modeCount = ACCESS_MODES.filter((m) => modes[m]).length;
  const sourceValid =
    source === "hostPath"
      ? hostPath.path.trim() !== ""
      : source === "nfs"
        ? nfs.server.trim() !== "" && nfs.path.trim() !== ""
        : csi.driver.trim() !== "" && csi.volumeHandle.trim() !== "";
  const valid = !nameError && !capacityError && modeCount > 0 && sourceValid && !entryErrors(labels, "label").some(Boolean);

  useEffect(() => {
    onChange(
      serialisePv(name, labels, capacity, modes, reclaimPolicy, storageClassName, volumeMode, source, hostPath, nfs, csi),
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, labels, capacity, modes, reclaimPolicy, storageClassName, volumeMode, source, hostPath, nfs, csi]);

  return (
    <div className="flex flex-col gap-3">
      <TextField label="Name" value={name} onChange={setName} placeholder="example-pv" error={name ? nameError : ""} mono />
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Capacity" value={capacity} onChange={setCapacity} placeholder="1Gi" error={capacity ? capacityError : ""} mono />
        <SelectField
          label="Reclaim Policy"
          value={reclaimPolicy}
          onChange={setReclaimPolicy}
          options={["Retain", "Delete", "Recycle"]}
        />
      </div>
      <AccessModesField value={modes} onChange={setModes} />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Storage Class"
          value={storageClassName}
          onChange={setStorageClassName}
          options={storageClasses.map((sc) => sc.name)}
          loading={scLoading}
          allowCustom
          placeholder="(none)"
        />
        <SelectField
          label="Volume Mode"
          value={volumeMode}
          onChange={setVolumeMode}
          options={["Filesystem", "Block"]}
          placeholder="(default: Filesystem)"
        />
      </div>
      <SelectField
        label="Source"
        value={source}
        onChange={(v) => setSource(v as PvSource)}
        options={["hostPath", "nfs", "csi"]}
      />
      {source === "hostPath" && (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Path"
            value={hostPath.path}
            onChange={(v) => setHostPath({ ...hostPath, path: v })}
            placeholder="/mnt/data/example-pv"
            mono
          />
          <SelectField
            label="Type"
            value={hostPath.type}
            onChange={(v) => setHostPath({ ...hostPath, type: v })}
            options={["DirectoryOrCreate", "Directory", "FileOrCreate", "File"]}
            placeholder="(none)"
          />
        </div>
      )}
      {source === "nfs" && (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Server" value={nfs.server} onChange={(v) => setNfs({ ...nfs, server: v })} placeholder="nfs.example.com" mono />
          <TextField label="Path" value={nfs.path} onChange={(v) => setNfs({ ...nfs, path: v })} placeholder="/exports/data" mono />
        </div>
      )}
      {source === "csi" && (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Driver" value={csi.driver} onChange={(v) => setCsi({ ...csi, driver: v })} placeholder="ebs.csi.aws.com" mono />
          <TextField
            label="Volume Handle"
            value={csi.volumeHandle}
            onChange={(v) => setCsi({ ...csi, volumeHandle: v })}
            placeholder="vol-xxxxxxxx"
            mono
          />
          <TextField label="FS Type" value={csi.fsType} onChange={(v) => setCsi({ ...csi, fsType: v })} placeholder="ext4" mono />
        </div>
      )}
    </div>
  );
}

// ─── sc (cluster-scoped) ────────────────────────────────────────────────────
// Fields sit at the TOP LEVEL of the document — no `spec:` wrapper. Matches
// the shipped `sc` template and the Rust side's `sc.provisioner` (there is
// no `sc.spec`).

function serialiseSc(
  name: string,
  labels: Entry[],
  annotations: Entry[],
  provisioner: string,
  reclaimPolicy: string,
  volumeBindingMode: string,
  allowVolumeExpansion: boolean,
  parameters: Entry[],
  mountOptions: string[],
): string {
  const body: string[] = [];
  body.push(...kv("provisioner", provisioner.trim(), 0));
  body.push(...kvRaw("volumeBindingMode", volumeBindingMode, 0));
  body.push(...kvRaw("reclaimPolicy", reclaimPolicy, 0));
  if (allowVolumeExpansion) body.push(...kvRaw("allowVolumeExpansion", "true", 0));
  if (parameters.some((e) => e.key)) body.push(...emitMap("parameters", parameters, 0));
  body.push(...emitList("mountOptions", mountOptions.filter((v) => v.trim() !== ""), 0));
  const head = ["apiVersion: storage.k8s.io/v1", "kind: StorageClass", ...metadata(name, null, labels, annotations)];
  return doc([head, body]);
}

function ScForm({ namespace: _namespace, context: _context, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<Entry[]>([]);
  const [annotations, setAnnotations] = useState<Entry[]>([]);
  const [provisioner, setProvisioner] = useState("");
  const [reclaimPolicy, setReclaimPolicy] = useState("Delete");
  const [volumeBindingMode, setVolumeBindingMode] = useState("WaitForFirstConsumer");
  const [allowVolumeExpansion, setAllowVolumeExpansion] = useState(false);
  const [parameters, setParameters] = useState<Entry[]>([]);
  const [mountOptions, setMountOptions] = useState<string[]>([]);

  const nameError = validateName(name);
  const valid =
    !nameError &&
    provisioner.trim() !== "" &&
    !entryErrors(labels, "label").some(Boolean) &&
    !entryErrors(annotations, "annotation").some(Boolean) &&
    !entryErrors(parameters, "label").some(Boolean);

  useEffect(() => {
    onChange(
      serialiseSc(name, labels, annotations, provisioner, reclaimPolicy, volumeBindingMode, allowVolumeExpansion, parameters, mountOptions),
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, labels, annotations, provisioner, reclaimPolicy, volumeBindingMode, allowVolumeExpansion, parameters, mountOptions]);

  return (
    <div className="flex flex-col gap-3">
      <TextField label="Name" value={name} onChange={setName} placeholder="example-storage-class" error={name ? nameError : ""} mono />
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <KeyValueField keyKind="annotation" label="Annotations" entries={annotations} onChange={setAnnotations} keyPlaceholder="key" valuePlaceholder="value" />
      <TextField label="Provisioner" value={provisioner} onChange={setProvisioner} placeholder="kubernetes.io/no-provisioner" mono />
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Reclaim Policy" value={reclaimPolicy} onChange={setReclaimPolicy} options={["Delete", "Retain"]} />
        <SelectField
          label="Volume Binding Mode"
          value={volumeBindingMode}
          onChange={setVolumeBindingMode}
          options={["Immediate", "WaitForFirstConsumer"]}
        />
      </div>
      <CheckField label="Allow Volume Expansion" value={allowVolumeExpansion} onChange={setAllowVolumeExpansion} />
      <KeyValueField keyKind="label" label="Parameters" entries={parameters} onChange={setParameters} keyPlaceholder="key" valuePlaceholder="value" />
      <StringListField label="Mount Options" values={mountOptions} onChange={setMountOptions} placeholder="discard" />
    </div>
  );
}

// ─── rq ─────────────────────────────────────────────────────────────────────

const RQ_SEED: Entry[] = [
  { key: "requests.cpu", value: "" },
  { key: "requests.memory", value: "" },
  { key: "limits.cpu", value: "" },
  { key: "limits.memory", value: "" },
];
const RQ_SCOPES_SUGGEST = ["BestEffort", "NotBestEffort", "Terminating", "NotTerminating", "PriorityClass"];

function serialiseRq(name: string, ns: string, labels: Entry[], hard: Entry[], scopes: string[]): string {
  // Blank-value rows are dropped — a row the user seeded but never filled in
  // must not turn into `key: ""`, which for a quota key is a hard-rejection
  // by the API server, not a harmless no-op.
  const cleanHard = hard.filter((e) => e.key.trim() !== "" && e.value.trim() !== "");
  const spec: string[] = ["spec:"];
  spec.push(...emitMap("hard", cleanHard, 2));
  spec.push(...emitList("scopes", scopes.filter((s) => s.trim() !== ""), 2));
  const head = ["apiVersion: v1", "kind: ResourceQuota", ...metadata(name, ns, labels)];
  return doc([head, spec]);
}

function RqForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [hard, setHard] = useState<Entry[]>(RQ_SEED);
  const [scopes, setScopes] = useState<string[]>([]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const cleanHardCount = hard.filter((e) => e.key.trim() !== "" && e.value.trim() !== "").length;
  const valid =
    !nameError && !namespaceError && cleanHardCount > 0 && !entryErrors(hard, "label").some(Boolean) && !entryErrors(labels, "label").some(Boolean);

  useEffect(() => {
    onChange(serialiseRq(name, ns, labels, hard, scopes), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, hard, scopes]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="example-quota" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
      <KeyValueField keyKind="label"
        label="Hard Limits"
        entries={hard}
        onChange={setHard}
        addLabel="add limit"
        keyPlaceholder="requests.cpu"
        valuePlaceholder="4"
      />
      <StringListField label="Scopes" values={scopes} onChange={setScopes} placeholder="BestEffort" suggest={RQ_SCOPES_SUGGEST} />
    </div>
  );
}

// ─── lr ─────────────────────────────────────────────────────────────────────
// Not the same shape as rq: an array of per-type blocks, each with four
// optional sub-blocks (default / defaultRequest / max / min), each itself
// omitted when both its cpu and memory are blank.

type LimitRow = {
  type: string;
  defaultCpu: string;
  defaultMemory: string;
  defaultRequestCpu: string;
  defaultRequestMemory: string;
  maxCpu: string;
  maxMemory: string;
  minCpu: string;
  minMemory: string;
};

const DEFAULT_LIMIT_ROW: LimitRow = {
  type: "Container",
  defaultCpu: "500m",
  defaultMemory: "256Mi",
  defaultRequestCpu: "100m",
  defaultRequestMemory: "128Mi",
  maxCpu: "",
  maxMemory: "",
  minCpu: "",
  minMemory: "",
};

function emptyLimitRow(): LimitRow {
  return {
    type: "Container",
    defaultCpu: "",
    defaultMemory: "",
    defaultRequestCpu: "",
    defaultRequestMemory: "",
    maxCpu: "",
    maxMemory: "",
    minCpu: "",
    minMemory: "",
  };
}

// Built at indent 0, then uniformly re-indented in emitLimitRow — the
// relative indentation baked in here (children at 2) is what makes that
// uniform shift work.
function emitLimitBlock(key: string, cpu: string, memory: string): string[] {
  if (!cpu.trim() && !memory.trim()) return [];
  const lines = [`${key}:`];
  if (cpu.trim()) lines.push(...kv("cpu", cpu.trim(), 2));
  if (memory.trim()) lines.push(...kv("memory", memory.trim(), 2));
  return lines;
}

function emitLimitRow(row: LimitRow, indent: number): string[] {
  const body: string[] = [
    ...kvRaw("type", row.type, 0),
    ...emitLimitBlock("default", row.defaultCpu, row.defaultMemory),
    ...emitLimitBlock("defaultRequest", row.defaultRequestCpu, row.defaultRequestMemory),
    ...emitLimitBlock("max", row.maxCpu, row.maxMemory),
    ...emitLimitBlock("min", row.minCpu, row.minMemory),
  ];
  return body.map((line, i) => (i === 0 ? `${pad(indent)}- ${line}` : `${pad(indent + 2)}${line}`));
}

function serialiseLr(name: string, ns: string, labels: Entry[], rows: LimitRow[]): string {
  const head = ["apiVersion: v1", "kind: LimitRange", ...metadata(name, ns, labels)];
  const spec: string[] = ["spec:", "  limits:"];
  for (const row of rows) spec.push(...emitLimitRow(row, 4));
  return doc([head, spec]);
}

function LimitRowFields(p: { row: LimitRow; onChange: (r: LimitRow) => void; onRemove: () => void; removable: boolean }) {
  const set = (patch: Partial<LimitRow>) => p.onChange({ ...p.row, ...patch });
  return (
    <div className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
      <div className="flex items-end gap-1.5">
        <div className="flex-1">
          <SelectField label="Type" value={p.row.type} onChange={(v) => set({ type: v })} options={["Container", "Pod", "PersistentVolumeClaim"]} />
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
        <TextField label="Default CPU" value={p.row.defaultCpu} onChange={(v) => set({ defaultCpu: v })} placeholder="500m" mono />
        <TextField label="Default Memory" value={p.row.defaultMemory} onChange={(v) => set({ defaultMemory: v })} placeholder="256Mi" mono />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Default Request CPU"
          value={p.row.defaultRequestCpu}
          onChange={(v) => set({ defaultRequestCpu: v })}
          placeholder="100m"
          mono
        />
        <TextField
          label="Default Request Memory"
          value={p.row.defaultRequestMemory}
          onChange={(v) => set({ defaultRequestMemory: v })}
          placeholder="128Mi"
          mono
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Max CPU" value={p.row.maxCpu} onChange={(v) => set({ maxCpu: v })} placeholder="1" mono />
        <TextField label="Max Memory" value={p.row.maxMemory} onChange={(v) => set({ maxMemory: v })} placeholder="1Gi" mono />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Min CPU" value={p.row.minCpu} onChange={(v) => set({ minCpu: v })} placeholder="50m" mono />
        <TextField label="Min Memory" value={p.row.minMemory} onChange={(v) => set({ minMemory: v })} placeholder="64Mi" mono />
      </div>
    </div>
  );
}

function LrForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [rows, setRows] = useState<LimitRow[]>([DEFAULT_LIMIT_ROW]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const hasNonBlankRow = rows.some((r) =>
    [r.defaultCpu, r.defaultMemory, r.defaultRequestCpu, r.defaultRequestMemory, r.maxCpu, r.maxMemory, r.minCpu, r.minMemory].some(
      (v) => v.trim() !== "",
    ),
  );
  const valid = !nameError && !namespaceError && rows.length > 0 && hasNonBlankRow && !entryErrors(labels, "label").some(Boolean);

  useEffect(() => {
    onChange(serialiseLr(name, ns, labels, rows), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, rows]);

  const updateRow = (i: number, r: LimitRow) => setRows(rows.map((row, idx) => (idx === i ? r : row)));
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const addRow = () => setRows([...rows, emptyLimitRow()]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="example-limits" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} keyPlaceholder="key" valuePlaceholder="value" />
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
          <LimitRowFields key={i} row={row} onChange={(r) => updateRow(i, r)} onRemove={() => removeRow(i)} removable={rows.length > 1} />
        ))}
      </Section>
    </div>
  );
}

export const STORAGE_FORMS: Partial<Record<CreatableKind, CreateForm>> = {
  pvc: PvcForm,
  pv: PvForm,
  sc: ScForm,
  rq: RqForm,
  lr: LrForm,
};
