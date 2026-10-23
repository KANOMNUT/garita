// OWNED BY THE WORKLOADS AGENT. Exactly these five kinds, no others:
//   deploy, sts, ds, jobs, cron
//
// NOT in scope: pods, hpa, pdb. They stay template-only — they were not in
// the request, and a speculative form is the thing this design exists to
// avoid.
//
// FIVE SEPARATE COMPONENTS, not one parameterised form. They share the
// ContainerListField widget and the emitPodSpec() helper, and nothing else:
// ds has no replicas, jobs has NO selector at all (Kubernetes generates it
// and a hand-written one is a footgun), cron nests a Job. Forcing one form
// across them is Rancher #10171 ("shenanigans behind-the-scenes with pod
// creation in order to use the same form as workloads"). Do not add a kind
// switch to emitPodSpec.
import { useEffect, useState } from "react";
import type { CreatableKind } from "../../../utils/resourceTemplates";
import type { CreateForm, CreateFormProps } from "../registry";
import {
  validateName,
  validateNamespace,
  metadata,
  doc,
  kv,
  kvRaw,
  emitMap,
  emitPodSpec,
  type Entry,
  type ContainerEntry,
} from "../emit";
import { TextField, NumberField, SelectField, CheckField, KeyValueField, ContainerListField } from "../fields";
import { validateQuantity } from "../../edit/quantity";
import { useNamespaces } from "../../../hooks/useResources";

// Local indent helper — emit.ts's own `pad` is not exported, and hand-typing
// runs of spaces in the string literals below is exactly how a cron nesting
// bug gets introduced. Same idea, kept private to this file.
const sp = (n: number) => " ".repeat(n);

const emptyContainer = (name: string, image: string): ContainerEntry => ({
  name,
  image,
  command: [],
  args: [],
  ports: [],
  env: [],
  envFrom: [],
  resources: { cpuReq: "", memReq: "", cpuLim: "", memLim: "" },
});

function resourcesValid(r: ContainerEntry["resources"]): boolean {
  return !validateQuantity(r.cpuReq) && !validateQuantity(r.memReq) && !validateQuantity(r.cpuLim) && !validateQuantity(r.memLim);
}

function containersValid(containers: ContainerEntry[]): boolean {
  return (
    containers.length > 0 &&
    containers.every((c) => c.name.trim() !== "" && c.image.trim() !== "" && resourcesValid(c.resources))
  );
}

// Name + Namespace row, identical across all five forms.
function NameNamespaceRow(p: {
  name: string;
  onName: (v: string) => void;
  ns: string;
  onNs: (v: string) => void;
  namespaces: string[];
  nsLoading: boolean;
}) {
  const nameError = validateName(p.name);
  return (
    <div className="grid grid-cols-2 gap-2">
      <TextField label="Name" value={p.name} onChange={p.onName} placeholder="my-app" error={p.name ? nameError : ""} mono />
      <SelectField label="Namespace" value={p.ns} onChange={p.onNs} options={p.namespaces} loading={p.nsLoading} allowCustom />
    </div>
  );
}

// ─── serialisers ────────────────────────────────────────────────────────

function serialiseDeploy(
  name: string,
  ns: string,
  labels: Entry[],
  replicas: string,
  podLabels: Entry[],
  containers: ContainerEntry[],
  serviceAccountName: string,
  nodeSelector: Entry[],
): string {
  const lines: string[] = ["apiVersion: apps/v1", "kind: Deployment", ...metadata(name, ns, labels), "spec:"];
  if (replicas.trim() !== "") lines.push(...kvRaw("replicas", replicas.trim(), 2));
  lines.push(`${sp(2)}selector:`);
  lines.push(...emitMap("matchLabels", podLabels, 4));
  lines.push(`${sp(2)}template:`);
  lines.push(`${sp(4)}metadata:`);
  lines.push(...emitMap("labels", podLabels, 6));
  lines.push(`${sp(4)}spec:`);
  lines.push(...emitPodSpec({ containers, serviceAccountName, nodeSelector }, 6));
  return doc([lines]);
}

function serialiseSts(
  name: string,
  ns: string,
  labels: Entry[],
  serviceName: string,
  replicas: string,
  podLabels: Entry[],
  containers: ContainerEntry[],
  serviceAccountName: string,
  nodeSelector: Entry[],
): string {
  const lines: string[] = ["apiVersion: apps/v1", "kind: StatefulSet", ...metadata(name, ns, labels), "spec:"];
  lines.push(...kv("serviceName", serviceName.trim(), 2));
  if (replicas.trim() !== "") lines.push(...kvRaw("replicas", replicas.trim(), 2));
  lines.push(`${sp(2)}selector:`);
  lines.push(...emitMap("matchLabels", podLabels, 4));
  lines.push(`${sp(2)}template:`);
  lines.push(`${sp(4)}metadata:`);
  lines.push(...emitMap("labels", podLabels, 6));
  lines.push(`${sp(4)}spec:`);
  lines.push(...emitPodSpec({ containers, serviceAccountName, nodeSelector }, 6));
  return doc([lines]);
}

function serialiseDs(
  name: string,
  ns: string,
  labels: Entry[],
  podLabels: Entry[],
  containers: ContainerEntry[],
  serviceAccountName: string,
  nodeSelector: Entry[],
): string {
  const lines: string[] = ["apiVersion: apps/v1", "kind: DaemonSet", ...metadata(name, ns, labels), "spec:"];
  lines.push(`${sp(2)}selector:`);
  lines.push(...emitMap("matchLabels", podLabels, 4));
  lines.push(`${sp(2)}template:`);
  lines.push(`${sp(4)}metadata:`);
  lines.push(...emitMap("labels", podLabels, 6));
  lines.push(`${sp(4)}spec:`);
  lines.push(...emitPodSpec({ containers, serviceAccountName, nodeSelector }, 6));
  return doc([lines]);
}

function serialiseJob(
  name: string,
  ns: string,
  labels: Entry[],
  completions: string,
  parallelism: string,
  backoffLimit: string,
  restartPolicy: string,
  containers: ContainerEntry[],
  serviceAccountName: string,
): string {
  const lines: string[] = ["apiVersion: batch/v1", "kind: Job", ...metadata(name, ns, labels), "spec:"];
  if (completions.trim() !== "") lines.push(...kvRaw("completions", completions.trim(), 2));
  if (parallelism.trim() !== "") lines.push(...kvRaw("parallelism", parallelism.trim(), 2));
  if (backoffLimit.trim() !== "") lines.push(...kvRaw("backoffLimit", backoffLimit.trim(), 2));
  lines.push(`${sp(2)}template:`);
  lines.push(`${sp(4)}spec:`);
  lines.push(...emitPodSpec({ containers, restartPolicy, serviceAccountName }, 6));
  return doc([lines]);
}

function serialiseCron(
  name: string,
  ns: string,
  labels: Entry[],
  schedule: string,
  concurrencyPolicy: string,
  suspend: boolean,
  restartPolicy: string,
  backoffLimit: string,
  containers: ContainerEntry[],
): string {
  const lines: string[] = ["apiVersion: batch/v1", "kind: CronJob", ...metadata(name, ns, labels), "spec:"];
  lines.push(...kv("schedule", schedule.trim(), 2));
  if (concurrencyPolicy) lines.push(...kvRaw("concurrencyPolicy", concurrencyPolicy, 2));
  if (suspend) lines.push(...kvRaw("suspend", "true", 2));
  lines.push(`${sp(2)}jobTemplate:`);
  lines.push(`${sp(4)}spec:`);
  if (backoffLimit.trim() !== "") lines.push(...kvRaw("backoffLimit", backoffLimit.trim(), 6));
  lines.push(`${sp(6)}template:`);
  lines.push(`${sp(8)}spec:`);
  lines.push(...emitPodSpec({ containers, restartPolicy }, 10));
  return doc([lines]);
}

// ─── forms ──────────────────────────────────────────────────────────────

function DeployForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [replicas, setReplicas] = useState("2");
  const [podLabels, setPodLabels] = useState<Entry[]>([{ key: "app", value: "" }]);
  const [containers, setContainers] = useState<ContainerEntry[]>([emptyContainer("app", "nginx:1.27")]);
  const [serviceAccountName, setServiceAccountName] = useState("");
  const [nodeSelector, setNodeSelector] = useState<Entry[]>([]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const valid = !validateName(name) && !validateNamespace(ns) && containersValid(containers);

  useEffect(() => {
    onChange(
      serialiseDeploy(name, ns, labels, replicas, podLabels, containers, serviceAccountName, nodeSelector),
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, replicas, podLabels, containers, serviceAccountName, nodeSelector]);

  return (
    <div className="flex flex-col gap-3">
      <NameNamespaceRow name={name} onName={setName} ns={ns} onNs={setNs} namespaces={namespaces} nsLoading={nsLoading} />
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Replicas" value={replicas} onChange={setReplicas} placeholder="2" />
        <TextField label="Service Account" value={serviceAccountName} onChange={setServiceAccountName} placeholder="default" mono />
      </div>
      <KeyValueField keyKind="label"
        label="Pod Labels — drives selector & template"
        entries={podLabels}
        onChange={setPodLabels}
        addLabel="add label"
      />
      <ContainerListField containers={containers} onChange={setContainers} context={context} namespace={ns} />
      <KeyValueField keyKind="label" label="Node Selector" entries={nodeSelector} onChange={setNodeSelector} addLabel="add rule" />
    </div>
  );
}

function StsForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [serviceName, setServiceName] = useState("");
  const [replicas, setReplicas] = useState("1");
  const [podLabels, setPodLabels] = useState<Entry[]>([{ key: "app", value: "" }]);
  const [containers, setContainers] = useState<ContainerEntry[]>([emptyContainer("app", "nginx:1.27")]);
  const [serviceAccountName, setServiceAccountName] = useState("");
  const [nodeSelector, setNodeSelector] = useState<Entry[]>([]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const valid =
    !validateName(name) && !validateNamespace(ns) && serviceName.trim() !== "" && containersValid(containers);

  useEffect(() => {
    onChange(
      serialiseSts(name, ns, labels, serviceName, replicas, podLabels, containers, serviceAccountName, nodeSelector),
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, serviceName, replicas, podLabels, containers, serviceAccountName, nodeSelector]);

  return (
    <div className="flex flex-col gap-3">
      <NameNamespaceRow name={name} onName={setName} ns={ns} onNs={setNs} namespaces={namespaces} nsLoading={nsLoading} />
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Service Name" value={serviceName} onChange={setServiceName} placeholder="my-app" mono />
        <NumberField label="Replicas" value={replicas} onChange={setReplicas} placeholder="1" />
      </div>
      <TextField label="Service Account" value={serviceAccountName} onChange={setServiceAccountName} placeholder="default" mono />
      <KeyValueField keyKind="label"
        label="Pod Labels — drives selector & template"
        entries={podLabels}
        onChange={setPodLabels}
        addLabel="add label"
      />
      {/* ponytail: no volumeClaimTemplates field here — a PVC template list is a
          whole extra widget class most StatefulSet creates in this UI won't need.
          Escape hatch: the YAML toggle. Add a StorageField if this bites someone. */}
      <ContainerListField containers={containers} onChange={setContainers} context={context} namespace={ns} />
      <KeyValueField keyKind="label" label="Node Selector" entries={nodeSelector} onChange={setNodeSelector} addLabel="add rule" />
    </div>
  );
}

function DsForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [podLabels, setPodLabels] = useState<Entry[]>([{ key: "app", value: "" }]);
  const [containers, setContainers] = useState<ContainerEntry[]>([emptyContainer("app", "nginx:1.27")]);
  const [serviceAccountName, setServiceAccountName] = useState("");
  const [nodeSelector, setNodeSelector] = useState<Entry[]>([]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const valid = !validateName(name) && !validateNamespace(ns) && containersValid(containers);

  useEffect(() => {
    onChange(serialiseDs(name, ns, labels, podLabels, containers, serviceAccountName, nodeSelector), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, podLabels, containers, serviceAccountName, nodeSelector]);

  return (
    <div className="flex flex-col gap-3">
      <NameNamespaceRow name={name} onName={setName} ns={ns} onNs={setNs} namespaces={namespaces} nsLoading={nsLoading} />
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <TextField label="Service Account" value={serviceAccountName} onChange={setServiceAccountName} placeholder="default" mono />
      <KeyValueField keyKind="label"
        label="Pod Labels — drives selector & template"
        entries={podLabels}
        onChange={setPodLabels}
        addLabel="add label"
      />
      <ContainerListField containers={containers} onChange={setContainers} context={context} namespace={ns} />
      <KeyValueField keyKind="label" label="Node Selector" entries={nodeSelector} onChange={setNodeSelector} addLabel="add rule" />
    </div>
  );
}

function JobsForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [completions, setCompletions] = useState("");
  const [parallelism, setParallelism] = useState("");
  const [backoffLimit, setBackoffLimit] = useState("");
  const [restartPolicy, setRestartPolicy] = useState("Never");
  const [containers, setContainers] = useState<ContainerEntry[]>([emptyContainer("job", "busybox:1.36")]);
  const [serviceAccountName, setServiceAccountName] = useState("");
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const valid = !validateName(name) && !validateNamespace(ns) && containersValid(containers);

  useEffect(() => {
    onChange(
      serialiseJob(name, ns, labels, completions, parallelism, backoffLimit, restartPolicy, containers, serviceAccountName),
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, completions, parallelism, backoffLimit, restartPolicy, containers, serviceAccountName]);

  return (
    <div className="flex flex-col gap-3">
      <NameNamespaceRow name={name} onName={setName} ns={ns} onNs={setNs} namespaces={namespaces} nsLoading={nsLoading} />
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Completions" value={completions} onChange={setCompletions} placeholder="1" />
        <NumberField label="Parallelism" value={parallelism} onChange={setParallelism} placeholder="1" />
        <NumberField label="Backoff Limit" value={backoffLimit} onChange={setBackoffLimit} placeholder="6" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Restart Policy" value={restartPolicy} onChange={setRestartPolicy} options={["Never", "OnFailure"]} />
        <TextField label="Service Account" value={serviceAccountName} onChange={setServiceAccountName} placeholder="default" mono />
      </div>
      {/* No selector / pod-labels field for Job: Kubernetes generates the
          Job selector itself — a hand-written one is a footgun. */}
      <ContainerListField containers={containers} onChange={setContainers} context={context} namespace={ns} />
    </div>
  );
}

function CronForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [schedule, setSchedule] = useState("*/5 * * * *");
  const [concurrencyPolicy, setConcurrencyPolicy] = useState("");
  const [suspend, setSuspend] = useState(false);
  const [restartPolicy, setRestartPolicy] = useState("OnFailure");
  const [backoffLimit, setBackoffLimit] = useState("");
  const [containers, setContainers] = useState<ContainerEntry[]>([emptyContainer("job", "busybox:1.36")]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const valid =
    !validateName(name) && !validateNamespace(ns) && schedule.trim() !== "" && containersValid(containers);

  useEffect(() => {
    onChange(
      serialiseCron(name, ns, labels, schedule, concurrencyPolicy, suspend, restartPolicy, backoffLimit, containers),
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, schedule, concurrencyPolicy, suspend, restartPolicy, backoffLimit, containers]);

  return (
    <div className="flex flex-col gap-3">
      <NameNamespaceRow name={name} onName={setName} ns={ns} onNs={setNs} namespaces={namespaces} nsLoading={nsLoading} />
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <TextField
        label="Schedule"
        value={schedule}
        onChange={setSchedule}
        placeholder="*/5 * * * *"
        error={schedule ? "" : "Schedule is required"}
        mono
      />
      <div className="grid grid-cols-2 gap-2 items-end">
        <SelectField
          label="Concurrency Policy"
          value={concurrencyPolicy}
          onChange={setConcurrencyPolicy}
          options={["Allow", "Forbid", "Replace"]}
          placeholder="(default)"
        />
        <CheckField label="Suspend" value={suspend} onChange={setSuspend} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SelectField label="Restart Policy" value={restartPolicy} onChange={setRestartPolicy} options={["Never", "OnFailure"]} />
        <NumberField label="Backoff Limit" value={backoffLimit} onChange={setBackoffLimit} placeholder="6" />
      </div>
      <ContainerListField containers={containers} onChange={setContainers} context={context} namespace={ns} />
    </div>
  );
}

export const WORKLOAD_FORMS: Partial<Record<CreatableKind, CreateForm>> = {
  deploy: DeployForm,
  sts: StsForm,
  ds: DsForm,
  jobs: JobsForm,
  cron: CronForm,
};
