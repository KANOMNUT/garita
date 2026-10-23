// OWNED BY THE RBAC PHASE-B AGENT. Exactly: roles, croles, rbindings,
// crbindings, sa. See docs/plan-guided-edit.md §5 (Tier 1: roles/croles,
// rbindings/crbindings) and Tier 2 (sa), and §5.1 for the upstream
// immutability citations backing every disabled/hint below.
//
// Two components + a scope token, mirroring the shipped
// src/components/create/forms/rbac.tsx's RBAC_FORMS shape exactly:
//   RbacRoleForm({ scope })    -> roles (namespaced) + croles (cluster)
//   RbacBindingForm({ scope }) -> rbindings (namespaced) + crbindings (cluster)
//   SaForm                     -> sa
//
// ── The three-way array merge (rules[] / subjects[]), reviewed hardest ──────
// Both `PolicyRule` (rbac.authorization.k8s.io/v1) and `Subject` are CLOSED
// field sets in the real API type — PolicyRule has exactly apiGroups/
// resources/verbs/resourceNames/nonResourceURLs and nothing else is valid;
// Subject has exactly kind/apiGroup/name/namespace. Unlike ContainerEntry
// (identified by `name`), there is no sibling data an index-based mismatch
// could ever lose here — so buildRules()/buildSubjects() below mutate the
// live-cloned element in place for indices that already existed (preserving
// object identity for forward-compat with any field the schema might one
// day add), build a fresh object from scratch for indices beyond the
// original array length (genuinely new rows), and rows the user removed
// simply do not appear in the rebuilt array. `sa`'s imagePullSecrets is
// rebuilt from scratch unconditionally instead — LocalObjectReference has
// exactly one field (`name`), so there is nothing a rebuild could drop.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ResourceType } from "../../../types/k8s";
import type { EditForm, EditFormProps } from "../registry";
import { entryErrors, type Entry } from "../../create/emit";
import { Section, TextField, SelectField, CheckField, KeyValueField, StringListField } from "../../create/fields";
import { useServiceAccounts, useSecrets } from "../../../hooks/useResources";
import { subjectFromLive, buildBindingNext, type SubjectEntry } from "../transforms";

function mapToEntries(m: Record<string, string> | undefined): Entry[] {
  return Object.entries(m ?? {}).map(([key, value]) => ({ key, value }));
}

function entriesToMap(entries: Entry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) {
    const key = e.key.trim();
    if (key) out[key] = e.value;
  }
  return out;
}

// ─── Role / ClusterRole ─────────────────────────────────────────────────────

type RuleEntry = {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
  resourceNames: string[];
  nonResourceURLs: string[];
};

const VERBS = ["get", "list", "watch", "create", "update", "patch", "delete"];

function ruleFromLive(r: any): RuleEntry {
  return {
    apiGroups: Array.isArray(r?.apiGroups) ? r.apiGroups : [],
    resources: Array.isArray(r?.resources) ? r.resources : [],
    verbs: Array.isArray(r?.verbs) ? r.verbs : [],
    resourceNames: Array.isArray(r?.resourceNames) ? r.resourceNames : [],
    nonResourceURLs: Array.isArray(r?.nonResourceURLs) ? r.nonResourceURLs : [],
  };
}

function ruleValid(r: RuleEntry): boolean {
  const hasTarget = r.resources.some((s) => s.trim() !== "") || r.nonResourceURLs.some((s) => s.trim() !== "");
  return hasTarget && r.verbs.length > 0;
}

// See file header — PolicyRule is a closed field set, so index-based
// mutate-in-place / build-fresh / drop-removed is lossless.
//
// A resource rule and a non-resource rule are MUTUALLY EXCLUSIVE per
// ValidatePolicyRule (pkg/apis/rbac/validation/validation.go): a rule with
// `nonResourceURLs` set is rejected if it also carries apiGroups/resources/
// resourceNames. Writing `apiGroups: [""]` unconditionally on every rule —
// the original bug here — corrupted every non-resource rule on a
// ClusterRole (e.g. `system:discovery`'s `/healthz` rule), producing a
// guaranteed-rejected patch on a form the user never even touched, because
// merge patch resends the whole `rules` array on ANY change.
function buildRules(cloneRules: unknown, rules: RuleEntry[]): unknown[] {
  const base = Array.isArray(cloneRules) ? cloneRules : [];
  return rules.map((r, i) => {
    const target: Record<string, unknown> =
      i < base.length && typeof base[i] === "object" && base[i] !== null ? (base[i] as Record<string, unknown>) : {};
    const nonResourceURLs = r.nonResourceURLs.map((s) => s.trim()).filter((s) => s !== "");
    if (nonResourceURLs.length > 0) {
      target.nonResourceURLs = nonResourceURLs;
      target.verbs = r.verbs;
      delete target.apiGroups;
      delete target.resources;
      delete target.resourceNames;
      return target;
    }
    const groups = r.apiGroups.length > 0 ? r.apiGroups : [""];
    const resources = r.resources.map((s) => s.trim()).filter((s) => s !== "");
    const resourceNames = r.resourceNames.map((s) => s.trim()).filter((s) => s !== "");
    target.apiGroups = groups;
    target.resources = resources;
    target.verbs = r.verbs;
    if (resourceNames.length > 0) target.resourceNames = resourceNames;
    else delete target.resourceNames;
    delete target.nonResourceURLs;
    return target;
  });
}

function RuleCard(p: { rule: RuleEntry; scope: "namespaced" | "cluster"; onChange: (r: RuleEntry) => void; onRemove: () => void }) {
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
      {p.scope === "cluster" && (
        // nonResourceURLs is rejected on a namespaced Role's rules by
        // ValidatePolicyRule (non-resource requests are inherently
        // cluster-scoped) — not rendered at all for `roles`, per the
        // "never add a field solely to disable it" scope limit. This is the
        // inverse case: removing an affordance that can only produce a
        // guaranteed-rejected apply, not adding one to grey out.
        <StringListField
          label="Non-Resource URLs (optional)"
          values={p.rule.nonResourceURLs}
          onChange={(v) => p.onChange({ ...p.rule, nonResourceURLs: v })}
          placeholder="/healthz"
        />
      )}
    </div>
  );
}

function RuleListField(p: { rules: RuleEntry[]; scope: "namespaced" | "cluster"; onChange: (r: RuleEntry[]) => void }) {
  const update = (i: number, r: RuleEntry) => p.onChange(p.rules.map((x, idx) => (idx === i ? r : x)));
  const remove = (i: number) => p.onChange(p.rules.filter((_, idx) => idx !== i));
  const add = () => p.onChange([...p.rules, { apiGroups: [""], resources: [], verbs: [], resourceNames: [], nonResourceURLs: [] }]);
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
      {p.rules.length === 0 && <p className="text-[11.5px] text-dim">No rules yet — click "add rule" to add one.</p>}
      {p.rules.map((r, i) => (
        <RuleCard key={i} rule={r} scope={p.scope} onChange={(nr) => update(i, nr)} onRemove={() => remove(i)} />
      ))}
    </Section>
  );
}

// Read-only fallback for a ClusterRole with `aggregationRule` — StringListField
// and CheckField in fields.tsx have no `disabled` prop (only TextField/
// NumberField/SelectField/CheckField do), and fields.tsx is read-only to
// Phase B. Rather than growing that primitive, a controller-owned rule set
// is rendered as plain read-only text instead of the interactive editor —
// arguably better UX here anyway ("don't bother editing this") than a form
// half-greyed-out field by field.
function RuleSummary(p: { rules: RuleEntry[] }) {
  return (
    <Section label="Rules (read-only — controller-owned)">
      {p.rules.length === 0 && <p className="text-[11.5px] text-dim">No rules.</p>}
      {p.rules.map((r, i) => (
        <div key={i} className="rounded-lg bg-card/50 ring-1 ring-edge p-2 mb-2 text-[11.5px] mono text-dim">
          <div>apiGroups: {r.apiGroups.join(", ") || "(core)"}</div>
          <div>resources: {r.resources.join(", ") || "—"}</div>
          <div>verbs: {r.verbs.join(", ") || "—"}</div>
          {r.resourceNames.length > 0 && <div>resourceNames: {r.resourceNames.join(", ")}</div>}
          {r.nonResourceURLs.length > 0 && <div>nonResourceURLs: {r.nonResourceURLs.join(", ")}</div>}
        </div>
      ))}
    </Section>
  );
}

function RbacRoleForm({
  scope,
  context: _context,
  namespace: _namespace,
  name: _name,
  live,
  onChange,
}: EditFormProps & { scope: "namespaced" | "cluster" }) {
  const [rules, setRules] = useState<RuleEntry[]>(() => (Array.isArray(live.rules) ? live.rules.map(ruleFromLive) : []));
  // Only a ClusterRole can carry aggregationRule — a namespaced Role never
  // has one, so this is constant for the mounted instance regardless of
  // `scope`, and is deliberately left out of the effect's deps (see
  // registry.ts's header comment — only this form's own STATE belongs
  // there, and this is derived from the frozen `live` + fixed `scope` prop).
  const hasAggregation = scope === "cluster" && !!live.aggregationRule;
  const valid = hasAggregation || (rules.length > 0 && rules.every(ruleValid));

  useEffect(() => {
    const next = structuredClone(live);
    if (!hasAggregation) next.rules = buildRules(next.rules, rules);
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules]);

  return (
    <div className="flex flex-col gap-3">
      {hasAggregation && (
        <p className="text-[11.5px] text-dim rounded-lg bg-card/50 ring-1 ring-edge p-2">
          This ClusterRole has an <span className="mono">aggregationRule</span> — its rules are recomputed and overwritten by
          the aggregation controller on the next reconcile.
        </p>
      )}
      {hasAggregation ? <RuleSummary rules={rules} /> : <RuleListField rules={rules} scope={scope} onChange={setRules} />}
    </div>
  );
}

// ─── RoleBinding / ClusterRoleBinding ───────────────────────────────────────

function subjectValid(s: SubjectEntry): boolean {
  if (!s.name.trim()) return false;
  if (s.kind === "ServiceAccount" && !s.namespace.trim()) return false;
  return true;
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

function RbacBindingForm({
  scope,
  context,
  namespace,
  name: _name,
  live,
  onChange,
}: EditFormProps & { scope: "namespaced" | "cluster" }) {
  const [subjects, setSubjects] = useState<SubjectEntry[]>(() =>
    Array.isArray(live.subjects) ? live.subjects.map(subjectFromLive) : [],
  );
  const defaultSubjectNs = scope === "namespaced" ? namespace : "default";
  // useServiceAccounts takes ONE namespace, but subjects can each point at a
  // different one — same call-once-at-form-level tradeoff as the create-side
  // form; rows in a different namespace just fall through to "custom…".
  const primarySaNamespace = scope === "namespaced" ? namespace : "default";
  const { data: serviceAccounts = [] } = useServiceAccounts(context, primarySaNamespace);
  const saNames = serviceAccounts.map((s) => s.name);

  const valid = subjects.length > 0 && subjects.every(subjectValid);

  useEffect(() => {
    const next = buildBindingNext(live, subjects);
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects]);

  // roleRef is immutable on update (§5.1) and is naturally part of the form
  // the user is already looking at, so it is licensed to render disabled
  // with a one-line reason rather than being omitted (docs/plan-guided-edit
  // §1.3). Do NOT quote the server's rejection text — it differs between
  // k8s 1.31 ("cannot change roleRef") and master ("field is immutable").
  const roleRefKind = live.roleRef?.kind ?? (scope === "cluster" ? "ClusterRole" : "Role");
  const roleRefName = live.roleRef?.name ?? "";

  return (
    <div className="flex flex-col gap-3">
      <SubjectListField subjects={subjects} onChange={setSubjects} defaultNamespace={defaultSubjectNs} saNames={saNames} />
      <TextField
        label="Role Ref"
        value={`${roleRefKind}/${roleRefName}`}
        onChange={() => {}}
        disabled
        hint="Cannot be changed after creation — create a new binding to reference a different role."
        mono
      />
    </div>
  );
}

// ─── ServiceAccount ─────────────────────────────────────────────────────────

function SaForm({ context, namespace, name: _name, live, onChange }: EditFormProps) {
  const [labels, setLabels] = useState<Entry[]>(() => mapToEntries(live.metadata?.labels));
  const [annotations, setAnnotations] = useState<Entry[]>(() => mapToEntries(live.metadata?.annotations));
  const [imagePullSecrets, setImagePullSecrets] = useState<string[]>(() =>
    Array.isArray(live.imagePullSecrets)
      ? live.imagePullSecrets.map((r: any) => (typeof r?.name === "string" ? r.name : "")).filter((n: string) => n !== "")
      : [],
  );

  const { data: secrets = [] } = useSecrets(context, namespace);
  const secretNames = secrets.map((s) => s.name);

  // imagePullSecrets has no key-shaped validity to gate on; labels/
  // annotations do — see entryErrors' kind split in emit.ts.
  const valid = !entryErrors(labels, "label").some(Boolean) && !entryErrors(annotations, "annotation").some(Boolean);

  useEffect(() => {
    const next = structuredClone(live);
    next.metadata ??= {};
    // Guard against a phantom diff: if the live object never had a
    // labels/annotations key at all (common — K8s omits empty maps), always
    // assigning `{}` here would make mergePatch see "key added" even though
    // nothing changed. Only set the key when there is something to set;
    // otherwise delete it so it matches the "absent" state exactly, which
    // also correctly emits the RFC 7386 `null` deletion sentinel when the
    // user clears out labels/annotations that previously existed.
    const labelsMap = entriesToMap(labels);
    if (Object.keys(labelsMap).length > 0) next.metadata.labels = labelsMap;
    else delete next.metadata.labels;
    const annotationsMap = entriesToMap(annotations);
    if (Object.keys(annotationsMap).length > 0) next.metadata.annotations = annotationsMap;
    else delete next.metadata.annotations;

    // LocalObjectReference has exactly one field (`name`) — rebuilding the
    // whole array from scratch is provably lossless, unlike rules[]/
    // subjects[] above where mutate-in-place guards a schema that could in
    // principle carry more fields.
    const cleanSecrets = imagePullSecrets.map((s) => s.trim()).filter((s) => s !== "");
    if (cleanSecrets.length > 0) next.imagePullSecrets = cleanSecrets.map((n) => ({ name: n }));
    else delete next.imagePullSecrets;

    // next.secrets is NEVER touched — PrepareForUpdate's cleanSecretReferences
    // strips every entry down to `{Name}` on every write regardless of what
    // is sent (§5.1), so modelling it here would be pointless at best and a
    // source of spurious diffs at worst.
    onChange(next, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, annotations, imagePullSecrets]);

  const updateSecret = (i: number, v: string) => setImagePullSecrets(imagePullSecrets.map((s, idx) => (idx === i ? v : s)));
  const removeSecret = (i: number) => setImagePullSecrets(imagePullSecrets.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-3">
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
    </div>
  );
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const RBAC_EDIT_FORMS: Partial<Record<ResourceType, EditForm>> = {
  roles: (p) => <RbacRoleForm {...p} scope="namespaced" />,
  croles: (p) => <RbacRoleForm {...p} scope="cluster" />,
  rbindings: (p) => <RbacBindingForm {...p} scope="namespaced" />,
  crbindings: (p) => <RbacBindingForm {...p} scope="cluster" />,
  sa: SaForm,
};
