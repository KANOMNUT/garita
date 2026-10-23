// FROZEN CONTRACT. CreateFormProps / CreateForm are what every create-form
// across all five agents (this one plus four Phase-2 agents) builds
// against. Do not change these shapes without re-coordinating everywhere.
//
// ── Effect-loop hazard (tsc cannot see this) ────────────────────────────
// ResourceCreator's `onChange` passed down as CreateFormProps.onChange is
// useCallback-stable. Every form reports its own state via a useEffect that
// must list ONLY that form's own state fields in the deps array — never
// `onChange` itself, never `context`/`namespace` unless the serialiser
// actually depends on them changing mid-mount. Copy this shape exactly:
//
//   useEffect(() => {
//     onChange(serialise(...state), isValid(...state));
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [/* only this form's own state fields */]);
//
// Getting this wrong (e.g. including `onChange` in the deps, or omitting
// the eslint-disable and "fixing" it by adding `onChange`) reintroduces a
// render loop that tsc and eslint's default config will not flag as wrong
// — this project already disables exhaustive-deps at the one other place
// it matters (ResourceCreator.tsx's open/resourceType reset effect).
//
// ── noUnusedLocals/noUnusedParameters (ON project-wide) ─────────────────
// A form that doesn't need one of the three CreateFormProps fields (e.g. a
// cluster-scoped form ignoring `namespace`) MUST rename it at destructure
// time with a leading underscore — this is an existing project convention
// (see Sidebar.tsx's `setNs: _setNs`), not something new:
//
//   export function SomeClusterScopedForm({ namespace: _namespace, context, onChange }: CreateFormProps) { ... }

import type { CreatableKind } from "../../utils/resourceTemplates";
import { KV_FORMS } from "./forms/keyvalue";
import { NS_FORMS } from "./forms/namespace";
import { WORKLOAD_FORMS } from "./forms/workloads";
import { NETWORK_FORMS } from "./forms/networking";
import { STORAGE_FORMS } from "./forms/storage";
import { RBAC_FORMS } from "./forms/rbac";

export interface CreateFormProps {
  context: string;
  namespace: string; // "" for cluster-scoped forms
  onChange: (yaml: string, valid: boolean) => void;
}

export type CreateForm = (props: CreateFormProps) => JSX.Element;

export const CREATE_FORM: Partial<Record<CreatableKind, CreateForm>> = {
  ...KV_FORMS,
  ...NS_FORMS,
  ...WORKLOAD_FORMS,
  ...NETWORK_FORMS,
  ...STORAGE_FORMS,
  ...RBAC_FORMS,
};
