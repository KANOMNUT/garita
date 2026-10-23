// OWNED BY THE RBAC AGENT. Exactly these five kinds, no others:
//   sa, roles, croles, rbindings, crbindings
//
// NOT in scope: argocd, flux-ks, flux-hr. GitOps kinds were not in the
// request and stay template-only.
//
// Three components cover the five kinds, and this is the ONE place in the
// whole feature where parameterising is honest rather than the Rancher trap:
//   RbacRoleForm({ scope })    -> roles (namespaced) + croles (cluster)
//   RbacBindingForm({ scope }) -> rbindings (namespaced) + crbindings (cluster)
//   SaForm                     -> sa
// roles/croles differ only in kind: and whether metadata carries a
// namespace. Same for the bindings. That is genuinely one shape.
//
// TRAP, and it is not the metadata one: subjects[].namespace is REQUIRED
// when a subject is kind: ServiceAccount, in BOTH RoleBinding AND
// ClusterRoleBinding. "Cluster-scoped => no namespace field" is right for
// metadata() and WRONG one level down. The shipped crbindings template in
// src/utils/resourceTemplates.ts already gets this right — read it.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CreatableKind } from "../../../utils/resourceTemplates";
import type { CreateForm, CreateFormProps } from "../registry";
import { validateName, validateNamespace, metadata, doc, kv, kvRaw, emitList, type Entry } from "../emit";
import { Section, TextField, SelectField, CheckField, KeyValueField, StringListField } from "../fields";
import { useNamespaces, useServiceAccounts, useRoles, useClusterRoles, useSecrets } from "../../../hooks/useResources";

function pad(indent: number): string {
  return " ".repeat(indent);
}

// Turns a block whose first line is `${pad(indent)}key: ...` (or
// `${pad(indent)}key:`) into a list item — replaces that leading whitespace
// with a dash at `dashIndent`, same total width, so sibling lines already
// emitted at `indent` line up under the dash exactly like every other
// hand-nested block in this file (rules, subjects, imagePullSecrets).
function dashBlock(lines: string[], dashIndent: number): string[] {
  if (lines.length === 0) return [];
  return [`${pad(dashIndent)}- ${lines[0].trimStart()}`, ...lines.slice(1)];
}

// ─── Role / ClusterRole ─────────────────────────────────────────────────────

type RuleEntry = { apiGroups: string[]; resources: string[]; verbs: string[]; resourceNames: string[] };

const VERBS = ["get", "list", "watch", "create", "update", "patch", "delete"];

function ruleValid(r: RuleEntry): boolean {
  return r.resources.some((s) => s.trim() !== "") && r.verbs.length > 0;
}

// A rule item's apiGroups/resources/verbs/resourceNames are each a plain
// string list nested under a list-item map — exactly emitList()'s shape,
// just dash-prefixed for the first field. apiGroups falls back to [""] if
// the user empties every row, so the emitted rule always has a valid (if
// incomplete) apiGroups list rather than a malformed item.
function emitRule(r: RuleEntry, indent: number): string[] {
  const groups = r.apiGroups.length > 0 ? r.apiGroups : [""];
  const resources = r.resources.map((s) => s.trim()).filter((s) => s !== "");
  const resourceNames = r.resourceNames.map((s) => s.trim()).filter((s) => s !== "");
  const lines = dashBlock(emitList("apiGroups", groups, indent + 4), indent + 2);
  lines.push(...emitList("resources", resources, indent + 4));
  lines.push(...emitList("verbs", r.verbs, indent + 4));
  if (resourceNames.length > 0) lines.push(...emitList("resourceNames", resourceNames, indent + 4));
  return lines;
}

function emitRules(rules: RuleEntry[], indent: number): string[] {
  if (rules.length === 0) return [];
  return [`${pad(indent)}rules:`, ...rules.flatMap((r) => emitRule(r, indent))];
}

function serialiseRole(scope: "namespaced" | "cluster", name: string, ns: string, labels: Entry[], rules: RuleEntry[]): string {
  const head = [
    "apiVersion: rbac.authorization.k8s.io/v1",
    `kind: ${scope === "cluster" ? "ClusterRole" : "Role"}`,
    ...metadata(name, scope === "cluster" ? null : ns, labels),
  ];
  // rules: sits at the top level of the document, not under spec: — Role/
  // ClusterRole have no spec at all.
  return doc([head, emitRules(rules, 0)]);
}

function RuleCard(p: { rule: RuleEntry; onChange: (r: RuleEntry) => void; onRemove: () => void }) {
  const hasWildcard = p.rule.verbs.includes("*");
  const toggleVerb = (v: string, checked: boolean) => {
    if (v === "*") {
      p.onChange({ ...p.rule, verbs: checked ? ["*"] : [] });
      return;
    }
    p.onChange({ ...p.rule, verbs: checked ? [...p.rule.verbs, v] : p.rule.verbs.filter((x) => x !== v) });
  };
  return (
    <div className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={p.onRemove}
          title="Remove rule"
          className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <StringListField
        label="API Groups"
        values={p.rule.apiGroups}
        onChange={(v) => p.onChange({ ...p.rule, apiGroups: v })}
        placeholder="apps (blank = core)"
        suggest={["", "apps", "batch", "networking.k8s.io", "rbac.authorization.k8s.io"]}
      />
      <StringListField
        label="Resources"
        values={p.rule.resources}
        onChange={(v) => p.onChange({ ...p.rule, resources: v })}
        placeholder="pods"
        suggest={["pods", "services", "deployments", "configmaps", "secrets", "*"]}
      />
      <Section label="Verbs">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <CheckField label="* (all verbs)" value={hasWildcard} onChange={(v) => toggleVerb("*", v)} />
        </div>
        {!hasWildcard && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1.5">
            {VERBS.map((v) => (
              <CheckField key={v} label={v} value={p.rule.verbs.includes(v)} onChange={(checked) => toggleVerb(v, checked)} />
            ))}
          </div>
        )}
      </Section>
      <StringListField
        label="Resource Names (optional)"
        values={p.rule.resourceNames}
        onChange={(v) => p.onChange({ ...p.rule, resourceNames: v })}
        placeholder="my-object-name"
      />
    </div>
  );
}

function RuleListField(p: { rules: RuleEntry[]; onChange: (r: RuleEntry[]) => void }) {
  const update = (i: number, r: RuleEntry) => p.onChange(p.rules.map((x, idx) => (idx === i ? r : x)));
  const remove = (i: number) => p.onChange(p.rules.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.rules, { apiGroups: [""], resources: [], verbs: [], resourceNames: [] }]);
  return (
    <Section
      label="Rules"
      action={
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={11} /> add rule
        </button>
      }
    >
      {p.rules.map((r, i) => (
        <RuleCard key={i} rule={r} onChange={(nr) => update(i, nr)} onRemove={() => remove(i)} />
      ))}
    </Section>
  );
}

function RbacRoleForm({ scope, context, namespace, onChange }: CreateFormProps & { scope: "namespaced" | "cluster" }) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [rules, setRules] = useState<RuleEntry[]>([
    { apiGroups: [""], resources: ["pods"], verbs: ["get", "list", "watch"], resourceNames: [] },
  ]);
  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const valid = !nameError && (scope === "cluster" || !namespaceError) && rules.length > 0 && rules.every(ruleValid);

  useEffect(() => {
    onChange(serialiseRole(scope, name, ns, labels, rules), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, name, ns, labels, rules]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="example-role" error={name ? nameError : ""} mono />
        {scope === "namespaced" && (
          <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
        )}
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <RuleListField rules={rules} onChange={setRules} />
    </div>
  );
}

// ─── RoleBinding / ClusterRoleBinding ───────────────────────────────────────

type SubjectEntry = { kind: "ServiceAccount" | "User" | "Group"; namespace: string; name: string };

function subjectValid(s: SubjectEntry): boolean {
  if (!s.name.trim()) return false;
  if (s.kind === "ServiceAccount" && !s.namespace.trim()) return false;
  return true;
}

// subject name/namespace are free user text (typed via "custom…" whenever
// RBAC blocks the list call — exactly the case this page exists for), so
// route them through kv() rather than raw interpolation, unlike the
// existing envFrom-name precedent in emit.ts which references an object the
// cluster has already validated. kind is a fixed enum (no custom option),
// safe raw.
function emitSubject(s: SubjectEntry, indent: number): string[] {
  const lines = [`${pad(indent)}- kind: ${s.kind}`];
  lines.push(...kv("name", s.name.trim(), indent + 2));
  // THE TRAP: namespace is required on a ServiceAccount subject in BOTH
  // RoleBinding and ClusterRoleBinding — never gated on scope here.
  if (s.kind === "ServiceAccount") lines.push(...kv("namespace", s.namespace.trim(), indent + 2));
  else lines.push(`${pad(indent + 2)}apiGroup: rbac.authorization.k8s.io`);
  return lines;
}

function emitSubjects(subjects: SubjectEntry[], indent: number): string[] {
  if (subjects.length === 0) return [];
  return [`${pad(indent)}subjects:`, ...subjects.flatMap((s) => emitSubject(s, indent + 2))];
}

function emitRoleRef(kind: "Role" | "ClusterRole", name: string, indent: number): string[] {
  return [
    `${pad(indent)}roleRef:`,
    `${pad(indent + 2)}kind: ${kind}`,
    ...kv("name", name.trim(), indent + 2),
    `${pad(indent + 2)}apiGroup: rbac.authorization.k8s.io`,
  ];
}

function serialiseBinding(
  scope: "namespaced" | "cluster",
  name: string,
  ns: string,
  labels: Entry[],
  subjects: SubjectEntry[],
  roleRefKind: "Role" | "ClusterRole",
  roleRefName: string,
): string {
  const head = [
    "apiVersion: rbac.authorization.k8s.io/v1",
    `kind: ${scope === "cluster" ? "ClusterRoleBinding" : "RoleBinding"}`,
    ...metadata(name, scope === "cluster" ? null : ns, labels),
  ];
  return doc([head, emitSubjects(subjects, 0), emitRoleRef(roleRefKind, roleRefName, 0)]);
}

function SubjectCard(p: { subject: SubjectEntry; saNames: string[]; onChange: (s: SubjectEntry) => void; onRemove: () => void }) {
  return (
    <div className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 flex flex-col gap-2">
      <div className="flex items-end gap-1.5">
        <div className="flex-1">
          <SelectField
            label="Kind"
            value={p.subject.kind}
            onChange={(v) => p.onChange({ ...p.subject, kind: v as SubjectEntry["kind"] })}
            options={["ServiceAccount", "User", "Group"]}
          />
        </div>
        <button
          type="button"
          onClick={p.onRemove}
          title="Remove subject"
          className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {p.subject.kind === "ServiceAccount" ? (
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Name"
            value={p.subject.name}
            onChange={(v) => p.onChange({ ...p.subject, name: v })}
            options={p.saNames}
            allowCustom
          />
          <TextField
            label="Namespace"
            value={p.subject.namespace}
            onChange={(v) => p.onChange({ ...p.subject, namespace: v })}
            placeholder="default"
            mono
          />
        </div>
      ) : (
        <TextField
          label="Name"
          value={p.subject.name}
          onChange={(v) => p.onChange({ ...p.subject, name: v })}
          placeholder={p.subject.kind === "User" ? "jane@example.com" : "my-group"}
          mono
        />
      )}
    </div>
  );
}

function SubjectListField(p: {
  subjects: SubjectEntry[];
  onChange: (s: SubjectEntry[]) => void;
  defaultNamespace: string;
  saNames: string[];
}) {
  const update = (i: number, s: SubjectEntry) => p.onChange(p.subjects.map((x, idx) => (idx === i ? s : x)));
  const remove = (i: number) => p.onChange(p.subjects.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.subjects, { kind: "ServiceAccount", namespace: p.defaultNamespace, name: "" }]);
  return (
    <Section
      label="Subjects"
      action={
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={11} /> add subject
        </button>
      }
    >
      {p.subjects.map((s, i) => (
        <SubjectCard key={i} subject={s} saNames={p.saNames} onChange={(ns) => update(i, ns)} onRemove={() => remove(i)} />
      ))}
    </Section>
  );
}

function RbacBindingForm({ scope, context, namespace, onChange }: CreateFormProps & { scope: "namespaced" | "cluster" }) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  // "the form's namespace under namespaced scope, 'default' under cluster
  // scope" — a fixed value derived from the incoming prop, matching how ns
  // itself is seeded, so every subject (initial or later-added) defaults
  // consistently rather than drifting if the user edits ns afterward.
  const defaultSubjectNs = scope === "namespaced" ? namespace : "default";
  const [subjects, setSubjects] = useState<SubjectEntry[]>([{ kind: "ServiceAccount", namespace: defaultSubjectNs, name: "" }]);
  const [roleRefKind, setRoleRefKind] = useState<"Role" | "ClusterRole">(scope === "cluster" ? "ClusterRole" : "Role");
  const [roleRefName, setRoleRefName] = useState("");

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);
  // useServiceAccounts takes ONE namespace, but subjects can each point at a
  // different one — calling it per-subject-row would call a hook inside a
  // .map(). Instead it's called once at the form level (this form's own
  // namespace, or "default" for a ClusterRoleBinding, which has none); rows
  // whose subject namespace differs just fall through to "custom…" via
  // allowCustom, same as when RBAC blocks the list entirely.
  const primarySaNamespace = scope === "namespaced" ? ns : "default";
  const { data: serviceAccounts = [] } = useServiceAccounts(context, primarySaNamespace);
  const { data: roles = [] } = useRoles(context, ns);
  const { data: clusterRoles = [] } = useClusterRoles(context);
  const saNames = serviceAccounts.map((s) => s.name);
  const roleNames = roleRefKind === "Role" ? roles.map((r) => r.name) : clusterRoles.map((r) => r.name);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const valid =
    !nameError &&
    (scope === "cluster" || !namespaceError) &&
    subjects.length > 0 &&
    subjects.every(subjectValid) &&
    roleRefName.trim() !== "";

  useEffect(() => {
    onChange(serialiseBinding(scope, name, ns, labels, subjects, roleRefKind, roleRefName), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, name, ns, labels, subjects, roleRefKind, roleRefName]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="example-role-binding"
          error={name ? nameError : ""}
          mono
        />
        {scope === "namespaced" && (
          <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
        )}
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <SubjectListField subjects={subjects} onChange={setSubjects} defaultNamespace={defaultSubjectNs} saNames={saNames} />
      <Section label="Role Ref">
        <div className="grid grid-cols-2 gap-2">
          {/* A ClusterRoleBinding cannot reference a namespaced Role — no kind widget under cluster scope. */}
          {scope === "namespaced" && (
            <SelectField
              label="Kind"
              value={roleRefKind}
              onChange={(v) => {
                setRoleRefKind(v as "Role" | "ClusterRole");
                setRoleRefName("");
              }}
              options={["Role", "ClusterRole"]}
            />
          )}
          <SelectField
            label={scope === "cluster" ? "Name (ClusterRole)" : "Name"}
            value={roleRefName}
            onChange={setRoleRefName}
            options={roleNames}
            allowCustom
          />
        </div>
      </Section>
    </div>
  );
}

// ─── ServiceAccount ─────────────────────────────────────────────────────────

// imagePullSecrets is a list of {name} objects, one per line item — same
// dash-then-kv shape as a rule's fields, just a single key per item.
function emitImagePullSecrets(names: string[], indent: number): string[] {
  const clean = names.map((s) => s.trim()).filter((s) => s !== "");
  if (clean.length === 0) return [];
  return [`${pad(indent)}imagePullSecrets:`, ...clean.flatMap((n) => dashBlock(kv("name", n, indent + 4), indent + 2))];
}

function serialiseSa(
  name: string,
  ns: string,
  labels: Entry[],
  annotations: Entry[],
  imagePullSecrets: string[],
  automount: "" | "true" | "false",
): string {
  const head = ["apiVersion: v1", "kind: ServiceAccount", ...metadata(name, ns, labels, annotations)];
  // imagePullSecrets is top-level on a ServiceAccount, not under spec: (a
  // ServiceAccount has no spec at all).
  const secretsLines = emitImagePullSecrets(imagePullSecrets, 0);
  // kvRaw, not kv — this must land as a YAML bool, not the string "true".
  const automountLines = automount !== "" ? kvRaw("automountServiceAccountToken", automount, 0) : [];
  return doc([head, secretsLines, automountLines]);
}

function SaForm({ context, namespace, onChange }: CreateFormProps) {
  const [name, setName] = useState("");
  const [ns, setNs] = useState(namespace);
  const [labels, setLabels] = useState<Entry[]>([]);
  const [annotations, setAnnotations] = useState<Entry[]>([]);
  const [imagePullSecrets, setImagePullSecrets] = useState<string[]>([]);
  const [automount, setAutomount] = useState<"" | "true" | "false">("");

  const { data: namespaces = [], isLoading: nsLoading } = useNamespaces(context);
  const { data: secrets = [] } = useSecrets(context, ns);
  const secretNames = secrets.map((s) => s.name);

  const nameError = validateName(name);
  const namespaceError = validateNamespace(ns);
  const valid = !nameError && !namespaceError;

  useEffect(() => {
    onChange(serialiseSa(name, ns, labels, annotations, imagePullSecrets, automount), valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ns, labels, annotations, imagePullSecrets, automount]);

  const updateSecret = (i: number, v: string) => setImagePullSecrets(imagePullSecrets.map((s, idx) => (idx === i ? v : s)));
  const removeSecret = (i: number) => setImagePullSecrets(imagePullSecrets.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" value={name} onChange={setName} placeholder="example-sa" error={name ? nameError : ""} mono />
        <SelectField label="Namespace" value={ns} onChange={setNs} options={namespaces} loading={nsLoading} allowCustom />
      </div>
      <KeyValueField keyKind="label" label="Labels" entries={labels} onChange={setLabels} addLabel="add label" />
      <KeyValueField keyKind="annotation" label="Annotations" entries={annotations} onChange={setAnnotations} addLabel="add annotation" />
      <Section
        label="Image Pull Secrets"
        action={
          <button
            type="button"
            onClick={() => setImagePullSecrets([...imagePullSecrets, ""])}
            className="flex items-center gap-1 mono text-[10.5px] px-1.5 py-0.5 rounded-sm text-accent hover:bg-accent/10 transition-colors"
          >
            <Plus size={11} /> add secret
          </button>
        }
      >
        {imagePullSecrets.length === 0 && (
          <p className="text-[11.5px] text-dim">No image pull secrets — click "add secret" to add one.</p>
        )}
        {imagePullSecrets.map((secret, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1.5">
            <div className="flex-1">
              <SelectField label="" value={secret} onChange={(v) => updateSecret(i, v)} options={secretNames} allowCustom />
            </div>
            <button
              type="button"
              onClick={() => removeSecret(i)}
              title="Remove"
              className="h-6 w-6 flex items-center justify-center rounded-sm text-dim hover:text-bad transition-colors shrink-0"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </Section>
      <SelectField
        label="Automount Service Account Token"
        value={automount}
        onChange={(v) => setAutomount(v as "" | "true" | "false")}
        options={["true", "false"]}
        placeholder="(unset — cluster default)"
      />
    </div>
  );
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const RBAC_FORMS: Partial<Record<CreatableKind, CreateForm>> = {
  sa: SaForm,
  roles: (p) => <RbacRoleForm {...p} scope="namespaced" />,
  croles: (p) => <RbacRoleForm {...p} scope="cluster" />,
  rbindings: (p) => <RbacBindingForm {...p} scope="namespaced" />,
  crbindings: (p) => <RbacBindingForm {...p} scope="cluster" />,
};
