// #32 Who can (v1.4.1 B-10..B-12, 07 P5/P12/P13). Pure helpers for the page and the Permissions sections.
// Computed from RBAC bindings: never the user's own access (no SSAR here), never "no one can".
import type { CRD, RbacSubject, RoleBinding, ClusterRoleBinding, RuleGrant, SkippedSource, WhoCanGrant } from "../types/k8s";
import { CLUSTER_SCOPED_KINDS } from "./scope";
import { reasonWord } from "./problems";

/** Closed source ids of who_can's `skipped` (B-12). */
export type WhoCanSource = "roles" | "clusterroles" | "rolebindings" | "clusterrolebindings";
const SOURCE_NAME: Record<WhoCanSource, string> = {
  roles: "roles", clusterroles: "cluster roles", rolebindings: "role bindings", clusterrolebindings: "cluster role bindings",
};

// ─── Resource input (Q8) ─────────────────────────────────────────────────────

export interface ParsedResource { resource: string; group: string | null; subresource: string }

/** `resource`, `resource.group`, `resource/subresource`, `resource.group/subresource` (kubectl forms). */
export function parseResourceInput(text: string): ParsedResource {
  const t = text.trim();
  const slash = t.indexOf("/");
  const head = slash < 0 ? t : t.slice(0, slash);
  const subresource = slash < 0 ? "" : t.slice(slash + 1).trim();
  const dot = head.indexOf(".");
  if (dot < 0) return { resource: head, group: null, subresource };
  return { resource: head.slice(0, dot), group: head.slice(dot + 1), subresource };
}

export interface ResourceChoice { label: string; resource: string; group: string; clusterScoped: boolean }

/** Combobox entries: known kinds (RBAC_RESOURCE) then installed CRDs as `plural.group`. */
export function resourceChoices(
  known: Record<string, { group: string; resource: string } | undefined>,
  crds: CRD[],
): ResourceChoice[] {
  const out: ResourceChoice[] = [];
  for (const [kind, gr] of Object.entries(known)) {
    if (gr) out.push({ label: gr.group ? `${gr.resource}.${gr.group}` : gr.resource, resource: gr.resource, group: gr.group, clusterScoped: CLUSTER_SCOPED_KINDS.has(kind) });
  }
  for (const c of crds) out.push({ label: `${c.plural}.${c.group}`, resource: c.plural, group: c.group, clusterScoped: c.scope === "Cluster" });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export interface ResolvedResource { resource: string; group: string; subresource: string; clusterScoped: boolean }

/**
 * Known kinds and installed CRDs carry their group; free text accepts `resource.group`. No discovery call.
 * Unknown plain text is sent with group "" (core), which is what kubectl assumes too.
 */
export function resolveResource(text: string, choices: ResourceChoice[]): ResolvedResource | null {
  const p = parseResourceInput(text);
  if (!p.resource) return null;
  const exact = choices.find((c) => c.label === (p.group ? `${p.resource}.${p.group}` : p.resource));
  if (exact) return { resource: exact.resource, group: exact.group, subresource: p.subresource, clusterScoped: exact.clusterScoped };
  if (p.group === null) {
    const byPlural = choices.filter((c) => c.resource === p.resource);
    // A bare plural that exists in one group only is unambiguous; with several, core (group "") wins.
    const pick = byPlural.length === 1 ? byPlural[0] : byPlural.find((c) => c.group === "");
    if (pick) return { resource: pick.resource, group: pick.group, subresource: p.subresource, clusterScoped: pick.clusterScoped };
  }
  return { resource: p.resource, group: p.group ?? "", subresource: p.subresource, clusterScoped: false };
}

// ─── Result grouping (P12) ───────────────────────────────────────────────────

export const SUBJECT_ORDER: RbacSubject["kind"][] = ["ServiceAccount", "Group", "User"];
export const SUBJECT_GROUP_LABEL: Record<RbacSubject["kind"], string> = {
  ServiceAccount: "Service accounts", Group: "Groups", User: "Users",
};

export const subjectKey = (s: RbacSubject) => `${s.kind}/${s.namespace ?? ""}/${s.name}`;
export const subjectLabel = (s: RbacSubject) => (s.kind === "ServiceAccount" && s.namespace ? `${s.namespace}/${s.name}` : s.name);

export interface SubjectRow { key: string; subject: RbacSubject; grants: WhoCanGrant[] }
export interface SubjectGroup { kind: RbacSubject["kind"]; label: string; count: number; rows: SubjectRow[]; builtin: SubjectRow[] }

/** One row per subject; `system:*` subjects go to `builtin` but still count in the header. */
export function groupSubjects(grants: WhoCanGrant[], search = ""): SubjectGroup[] {
  const q = search.trim().toLowerCase();
  const byKey = new Map<string, SubjectRow>();
  for (const g of grants) {
    const key = subjectKey(g.subject);
    const row = byKey.get(key);
    if (row) row.grants.push(g);
    else byKey.set(key, { key, subject: g.subject, grants: [g] });
  }
  const rows = [...byKey.values()].filter((r) => !q || subjectLabel(r.subject).toLowerCase().includes(q));
  return SUBJECT_ORDER.map((kind) => {
    const mine = rows.filter((r) => r.subject.kind === kind).sort((a, b) => subjectLabel(a.subject).localeCompare(subjectLabel(b.subject)));
    return {
      kind, label: SUBJECT_GROUP_LABEL[kind], count: mine.length,
      rows: mine.filter((r) => !r.subject.name.startsWith("system:")),
      builtin: mine.filter((r) => r.subject.name.startsWith("system:")),
    };
  }).filter((g) => g.count > 0);
}

export const subjectCount = (groups: SubjectGroup[]) => groups.reduce((n, g) => n + g.count, 0);
export const foundAnnouncement = (n: number) => `${n} ${n === 1 ? "subject" : "subjects"} found`;

export const scopeWords = (g: { scope: "cluster" | "namespace"; binding_namespace: string | null }) =>
  g.scope === "cluster" ? "Cluster-wide" : `In namespace ${g.binding_namespace ?? ""}`.trim();
export const bindingLine = (g: WhoCanGrant) => `${g.binding_kind} ${g.binding} → ${g.role_kind} ${g.role}`;

// ─── Page state (P5): its own pure state, mirroring A-3/A-5 ──────────────────

export type WhoCanState = "no-access" | "nothing-partial" | "nothing" | "partial" | "list";

/**
 * No access = every binding source the query reads was skipped and nothing came back. ClusterRoleBindings are
 * always read; RoleBindings only when a namespace was given.
 */
export function whoCanState(grantCount: number, skipped: SkippedSource<WhoCanSource>[], usesRoleBindings: boolean): WhoCanState {
  if (grantCount === 0) {
    const has = (s: WhoCanSource) => skipped.some((x) => x.source === s);
    if (has("clusterrolebindings") && (!usesRoleBindings || has("rolebindings"))) return "no-access";
    // The role lists are skipped too: no rules to match, however the bindings read.
    if (has("clusterroles") && (!usesRoleBindings || has("roles"))) return "no-access";
    return skipped.length > 0 ? "nothing-partial" : "nothing";
  }
  return skipped.length > 0 ? "partial" : "list";
}

/** "Couldn't read cluster role bindings (forbidden). The list may be incomplete." */
export function skipLine(skipped: SkippedSource<WhoCanSource>[]): string {
  const parts = skipped.map((s) => `${SOURCE_NAME[s.source] ?? s.source} (${reasonWord(s.reason)})`);
  return `Couldn't read ${parts.join(", ")}. The list may be incomplete.`;
}

export function emptyLine(verb: string, resourceText: string, namespace: string | null): string {
  const what = `${verb === "*" ? "any verb" : verb} ${resourceText}`;
  return `No bindings grant "${what}" in ${namespace ? `namespace ${namespace}` : "every namespace"}.`;
}

// ─── Permissions sections (P13, B-11) ────────────────────────────────────────

export interface BindingRef {
  kind: "RoleBinding" | "ClusterRoleBinding";
  name: string;
  /** "" for a ClusterRoleBinding. */
  namespace: string;
  subjects: RbacSubject[];
}

/**
 * "Bound to": the bindings that reference a role. A Role matches RoleBindings in its own namespace only;
 * a ClusterRole matches every ClusterRoleBinding and the RoleBindings in any namespace. Pure.
 */
export function boundTo(
  role: { kind: "Role" | "ClusterRole"; name: string; namespace: string },
  roleBindings: RoleBinding[],
  clusterRoleBindings: ClusterRoleBinding[],
): BindingRef[] {
  const ref = `${role.kind}/${role.name}`;
  const rbs = roleBindings
    .filter((b) => b.role_ref === ref && (role.kind === "ClusterRole" || b.namespace === role.namespace))
    .map((b): BindingRef => ({ kind: "RoleBinding", name: b.name, namespace: b.namespace, subjects: b.subject_list ?? [] }));
  const crbs = role.kind === "ClusterRole"
    ? clusterRoleBindings.filter((b) => b.role_ref === ref).map((b): BindingRef => ({ kind: "ClusterRoleBinding", name: b.name, namespace: "", subjects: b.subject_list ?? [] }))
    : [];
  return [...crbs, ...rbs].sort((a, b) => a.kind.localeCompare(b.kind) || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

export interface RuleLine { text: string; verbs: string; wildcard: boolean; named: string[]; wordsAll: string[] }
export interface BindingBlock { key: string; header: string; viaGroup: string | null; rules: RuleLine[]; urls: RuleLine[] }
export interface ScopeBlock { key: string; title: string; bindings: BindingBlock[] }

/** Rows are grouped by scope, then by binding; a wildcard row says "all verbs" / "all resources". */
export function groupRuleGrants(grants: RuleGrant[]): ScopeBlock[] {
  const scopes = new Map<string, Map<string, { header: string; via: string | null; rules: RuleLine[]; urls: RuleLine[] }>>();
  for (const g of grants) {
    const title = g.scope === "cluster" ? "Cluster-wide" : `In namespace ${g.binding_namespace ?? ""}`.trim();
    const bm = scopes.get(title) ?? new Map();
    scopes.set(title, bm);
    const bkey = `${g.binding_kind}/${g.binding_namespace ?? ""}/${g.binding}/${g.via_group ?? ""}`;
    const b = bm.get(bkey) ?? { header: `${g.binding_kind} ${g.binding} → ${g.role_kind} ${g.role}`, via: g.via_group, rules: [], urls: [] };
    bm.set(bkey, b);
    const verbs = g.verbs.join(" ");
    const allVerbs = g.verbs.includes("*");
    if (g.non_resource_urls.length > 0) b.urls.push({ text: g.non_resource_urls.join(", "), verbs, wildcard: allVerbs, named: [], wordsAll: allVerbs ? ["all verbs"] : [] });
    if (g.resources.length > 0) {
      const allRes = g.resources.includes("*");
      b.rules.push({
        text: g.resources.map((r) => (g.api_groups.length && g.api_groups[0] !== "" && !r.includes(".") && r !== "*" ? `${r}.${g.api_groups[0]}` : r)).join(", "),
        verbs, wildcard: allVerbs || allRes, named: g.resource_names,
        wordsAll: [...(allVerbs ? ["all verbs"] : []), ...(allRes ? ["all resources"] : [])],
      });
    }
  }
  return [...scopes.entries()]
    .sort(([a], [b]) => (a === "Cluster-wide" ? -1 : b === "Cluster-wide" ? 1 : a.localeCompare(b)))
    .map(([title, bm]) => ({
      key: title, title,
      bindings: [...bm.entries()].map(([key, v]) => ({ key, header: v.header, viaGroup: v.via, rules: v.rules, urls: v.urls })),
    }));
}

export const NOTE_ALWAYS = "Computed from RBAC bindings. Admission webhooks and non-RBAC authorizers are not visible here.";
export const USER_GROUPS_NOTE = "Group memberships come from the identity provider and aren't visible here.";
