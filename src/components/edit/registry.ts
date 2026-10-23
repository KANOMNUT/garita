// FROZEN CONTRACT (docs/plan-guided-edit.md §4.2). EditFormProps / EditForm /
// EDIT_FORM are what every edit-form across four Phase-B agents builds
// against. Do not change these shapes without re-coordinating everywhere.
//
// ── Forms report a mutated CLONE, NOT a patch ────────────────────────────
// onChange's first argument is `next` — a full mutated clone of `live`.
// ResourceEditor (the host) is the ONLY caller of mergePatch (from
// `./patch`). This is deliberate: it makes "a form emitted a malformed
// patch" structurally unrepresentable, and gives one place to render the
// patch preview.
//
// ── Effect-loop hazard (tsc cannot see this) ─────────────────────────────
// ResourceEditor's `onChange` passed down as EditFormProps.onChange is
// useCallback-stable. Every form reports its mutated clone via a useEffect
// that must list ONLY that form's own state fields in the deps array —
// never `onChange`, never `live`. Copy this shape exactly:
//
//   export function SomeEditForm({ live, onChange }: EditFormProps) {
//     const [foo, setFoo] = useState(() => live.spec?.foo ?? "");   // seed from live
//     useEffect(() => {
//       const next = structuredClone(live);
//       next.spec ??= {};
//       next.spec.foo = foo;                 // touch ONLY modelled paths
//       onChange(next, isValid(foo));
//       // eslint-disable-next-line react-hooks/exhaustive-deps
//     }, [foo]);                             // ONLY this form's own state
//     return /* fields.tsx primitives */;
//   }
//
// Getting this wrong (e.g. including `onChange` or `live` in the deps, or
// omitting the eslint-disable and "fixing" it by adding them) reintroduces a
// render loop that tsc and eslint's default config will not flag as wrong —
// same hazard as src/components/create/registry.ts.
//
// ── noUnusedLocals/noUnusedParameters (ON project-wide) ──────────────────
// A form that doesn't need one of the EditFormProps fields (e.g. a
// cluster-scoped form ignoring `namespace`) MUST rename it at destructure
// time with a leading underscore — existing project convention:
//
//   export function SomeClusterScopedEditForm({ namespace: _namespace, context, name, live, onChange }: EditFormProps) { ... }
//
// ── disabled/hint scope limit (docs/plan-guided-edit.md §1.3) ────────────
// `fields.tsx`'s TextField/NumberField/SelectField/CheckField carry
// `disabled?: boolean` + `hint?: string` so an immutable field can be shown
// disabled with a one-line reason instead of omitted. That license is
// scoped: only use it where the immutable field is ALREADY naturally part
// of the form the user is looking at (Secret `type`, RoleBinding `roleRef`,
// PVC `storageClassName`/`accessModes`, Service `clusterIP`). It does NOT
// license adding a new input solely in order to grey it out — e.g. the
// workload container editor renders containers, so it never renders
// `spec.selector`/`serviceName`/`volumeClaimTemplates` at all; there is
// nothing there to disable. Adding surface in order to disable it inverts
// the rule. See §5.1 for the per-kind immutability citations backing every
// hint string — and do not quote server error text in a hint (RoleBinding's
// error message differs between k8s 1.31 and master).

import type { ResourceType } from "../../types/k8s";
import { WORKLOAD_EDIT_FORMS } from "./forms/workloads";
import { NETWORKING_EDIT_FORMS } from "./forms/networking";
import { KEYVALUE_EDIT_FORMS } from "./forms/keyvalue";
import { STORAGE_EDIT_FORMS } from "./forms/storage";
import { RBAC_EDIT_FORMS } from "./forms/rbac";
import { GITOPS_EDIT_FORMS } from "./forms/gitops";

export interface EditFormProps {
  context: string;
  namespace: string; // "" for cluster-scoped kinds
  name: string;
  /** The live object from get_resource_json. TREAT AS FROZEN — never mutate. */
  live: Record<string, any>;
  /** Report a MUTATED CLONE of `live`, not a patch. The host diffs it.
   *  A form therefore cannot emit a malformed patch — it structurally cannot
   *  construct one. */
  onChange: (next: Record<string, any>, valid: boolean) => void;
}

export type EditForm = (props: EditFormProps) => JSX.Element;

export const EDIT_FORM: Partial<Record<ResourceType, EditForm>> = {
  ...WORKLOAD_EDIT_FORMS,
  ...NETWORKING_EDIT_FORMS,
  ...KEYVALUE_EDIT_FORMS,
  ...STORAGE_EDIT_FORMS,
  ...RBAC_EDIT_FORMS,
  ...GITOPS_EDIT_FORMS,
};
