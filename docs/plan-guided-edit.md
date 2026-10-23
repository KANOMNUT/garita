# Guided Edit — frozen contract

Mirror of the `+New` create-form work (`docs/plan-tls-cert-and-context-new.md`) for **editing
existing resources**. Read that document's §7-8 first: the YAML-emission invariants it
established do **not** apply here, and knowing why is the whole design.

Status: contract frozen. Implementation dispatched in two phases (see §9).

---

## 1. The two traps, resolved

### 1.1 Data loss — and why "emit only what the form models" is NOT sufficient

The naive edit is: parse existing YAML into form state → user edits → re-serialise → `replace()`.
That silently deletes every field the form does not model: sidecar containers, `tolerations`,
`affinity`, `nodeSelector`, `topologySpreadConstraints`, `imagePullSecrets`, unmodelled
annotations, `ownerReferences`, and anything a mutating webhook or service mesh injected.
The apply succeeds; the damage is invisible until production breaks.

The obvious fix — "emit a patch containing only the fields the form models" — **does not close
the class**, because of RFC 7386 semantics:

> **JSON merge patch replaces an entire array wholesale. It does not merge arrays by key.**

Every high-value edit target is an array: `containers`, `env`, `ports`, `rules`, `subjects`,
`limits`. To change one env var, the patch must carry the *whole* `containers` array. If the form
re-serialises that array from its own state, it deletes `volumeMounts`, `probes`,
`securityContext`, `lifecycle`, and any sidecar it didn't model. **The trap re-enters through
the list.**

**FROZEN DECISION — clone-and-mutate, then diff:**

```
get_resource_json  →  live (raw API object, JS object over IPC)
                   →  structuredClone(live)  →  form mutates ONLY its own paths
                   →  mergePatch(live, next) →  patch_resource (Patch::Merge)
```

Every value in the emitted patch either **came from the live object verbatim** or is **exactly
what the user typed**. Arrays are reconstructed from the server's own array with one element's
one field changed, so unmodelled sibling fields ride along untouched. That closes the class
*through lists*, which the "only model what you emit" formulation does not.

Corollaries, all load-bearing:

- **No YAML parser on the frontend.** `get_resource_json` returns JSON; Tauri IPC hands it over
  already parsed. The `js-yaml` dependency cut in §7 of the create plan stays cut.
- **No `resourceVersion` bookkeeping.** A merge patch is per-field, not whole-object, so there
  is no optimistic-concurrency token to carry. (Last-write-wins per field. Accepted: this is
  what `kubectl patch` does.)
- **`apply_resource_yaml` is the WRONG backend for form edits.** It does
  `serde_yaml::from_str` into a typed struct then `api.replace(...)` — a full-object replace.
  Form edits go through the new `patch_resource`. The YAML tab keeps using
  `apply_resource_yaml` (see §8 for its pre-existing caveat).

### 1.2 What survives from `emit.ts` — say it plainly

The instruction was "reuse `fields.tsx` and `emit.ts`". Half of `emit.ts` survives:

| Reusable on the edit path | NOT reusable |
|---|---|
| `validateName`, `validateNamespace`, `validateKey`, `entryErrors` | `doc()`, `blockScalar`, `kv`, `kvRaw`, `emitMap`, `emitList`, `metadata()`, `emitSecret`, `emitContainers`, `emitPodSpec`, `emitPorts`, `emitResources` |
| The `Entry` / `PortEntry` / `ResourceReq` / `ContainerEntry` **types** | every serialiser |
| **all of `fields.tsx`** | — |

The patch is a JS object, not YAML text. There is no string building on this path — no `doc()`,
no `|2-` block scalars, no bare-value quoting rules. Every emission invariant in §8 of the
create plan is irrelevant here, which is itself a simplification: the entire class of
YAML-quoting bugs cannot occur.

### 1.3 Immutable fields

Many fields are rejected on update. A form offering them produces a rejected apply — invisible
to `tsc`. See §5 for the per-kind table with upstream citations.

**FROZEN DECISION — render disabled with a one-line reason, do not omit.** An omitted field is
indistinguishable from an unset one; a user who came to change `spec.selector` needs to be told
why they can't, not left hunting. This requires `disabled?: boolean` + `hint?: string` on
`fields.tsx`'s `TextField` / `NumberField` / `SelectField` / `CheckField` — the same shape of
single-prop addition that `multiline?` was in v1.0.1. **Exactly one agent touches `fields.tsx`.**

**Scope limit — never add a field solely in order to disable it.** The rule applies where the
immutable field is *naturally part of the form the user is already looking at*: Secret `type`,
RoleBinding `roleRef`, PVC `storageClassName` / `accessModes`, Service `clusterIP`. It does **not**
license growing new inputs that exist only to be greyed out — the workload container editor renders
containers, so it never renders `spec.selector`, `serviceName` or `volumeClaimTemplates` at all;
there is nothing there to disable. Adding surface in order to disable it inverts the rule.

---

## 2. Where the form gets its current values — the user's prior is OVERTURNED

The prior was: read from the existing typed structs, which already carry structured data.
**Verified false for almost every kind.** The list structs are *display-shaped*, not
*spec-shaped* — they were built to fill table cells:

| Struct | Field | Reality |
|---|---|---|
| `Service` | `ports: string` | A rendered display string (`"80:8080/TCP"`). Cannot seed a `PortListField`. |
| `RoleBinding` / `ClusterRoleBinding` | `subjects: string` | Display string. Cannot seed a subject list. |
| `PersistentVolumeClaim` | `capacity: string`, `access_modes: string` | Display strings. |
| `Deployment` | — | **No `replicas` field at all.** Only `ready: "2/3"`. |
| `PodTemplateContainer` | `{name, image, is_init, cpu/mem_request/limit}` | **No `env`, no `command`, no `args`, no `ports`, no `volumeMounts`.** |
| `Ingress` | `rules: IngressRule[]` | Structured, but lossy — no TLS block, no annotations. |
| `ConfigMap` / `Secret` | `data: Record<string,string>` | **The only two kinds carrying their full editable payload.** |

So prefill from list structs is viable for `cm` and `sec` and nothing else. The gap is not a
handful of fields; it is most of every form.

**FROZEN DECISION — one new generic Rust command, `get_resource_json`, returns the raw live
object.** This is strictly better than extending 20 display structs:

- Lossless: the raw API object, including fields newer than the pinned `k8s-openapi`.
- Zero new match arms per kind (see §3's GVK table).
- Needed anyway, since a patch must be diffed against the server's actual state, not a summary.

---

## 3. Rust contract — FROZEN

One new file, `src-tauri/src/commands/resource_edit.rs`. Two commands, **one GVK table, zero
35-arm matches.** `create_resource_from_yaml` already proves `DynamicObject` +
`ApiResource` works generically for every kind including CRDs; this follows that precedent, not
`get_resource_yaml`'s / `apply_resource_yaml`'s / `delete_resource`'s per-kind matches.

```rust
/// resource_type (Watchtower's short kind) → (group, version, kind, plural, namespaced)
/// The ONLY per-kind knowledge in this file. Adding an editable kind = one row.
fn gvk_for(resource_type: &str)
    -> Result<(&'static str, &'static str, &'static str, &'static str, bool), String>;

/// The raw live object, exactly as the API server has it. No filtering, no
/// status stripping — the frontend diffs against this, so any omission here
/// becomes a field the patch could clobber.
#[tauri::command]
pub async fn get_resource_json(
    context: String,
    namespace: String,
    resource_type: String,
    name: String,
) -> Result<serde_json::Value, String>;

/// RFC 7386 JSON merge patch. `patch` is built frontend-side by diffing a
/// mutated clone against the object `get_resource_json` returned.
#[tauri::command]
pub async fn patch_resource(
    context: String,
    namespace: String,
    resource_type: String,
    name: String,
    patch: serde_json::Value,
    dry_run: Option<bool>,
) -> Result<String, String>;
```

Implementation notes, all mandatory:

- `Patch::Merge(&patch)` with `PatchParams { dry_run, ..Default::default() }`.
  **`dry_run: Option<bool>`, never a bare `bool`** — a bare `bool` goes through
  `deserialize_json()` and errors `"missing required key dry_run"` when the arg is absent,
  breaking every call at runtime with nothing caught at compile time (v1.0.0 note in CLAUDE.md).
- **Do not set `field_manager`.** `PatchParams::force` is apply-only; leave both defaulted.
- Success string mirrors create's shape: `format!("{}/{} patched", kind, name)` and
  `format!("{}/{} would be patched (dry run)", kind, name)`. The frontend asserts the
  `"dry run"` substring the same defensive way `ResourceCreator` does.
- Namespaced vs cluster-scoped comes from the table's `bool`:
  `Api::<DynamicObject>::namespaced_with(client, &namespace, &ar)` vs `all_with(client, &ar)`.
  A cluster-scoped kind must **ignore** the `namespace` arg, never interpolate it.
- Conventions: `async`, `Result<T, String>`, `context: String` first,
  `format!("Failed to …: {}", e)`, **no `unwrap()`**.
- Register `mod resource_edit;` + both commands in `lib.rs` `generate_handler![]`.
- **Do NOT refactor** `get_resource_yaml` / `apply_resource_yaml` / `delete_resource` onto the
  new table. They work; touching three 35-arm matches is unrelated risk. Note the future
  consolidation in a comment and stop.

### 3.1 Why merge patch, and not the alternatives

| Option | Verdict |
|---|---|
| **JSON merge patch (RFC 7386)** — `Patch::Merge` | **CHOSEN.** Already the house pattern (`nodes.rs`, `workload_actions.rs`, `argocd.rs`). The one patch type that works uniformly on typed kinds *and* custom resources. Per-field, so no `resourceVersion`. |
| Strategic merge patch | **Rejected — cannot work.** CRDs do not support `application/strategic-merge-patch+json`, which rules out every GitOps kind (`argocd`, `flux-ks`, `flux-hr`) and Gateway API. A patch type that works for half the scope is worse than one that works for all of it. |
| JSON Patch (RFC 6902) | Rejected. Positional array indices (`/spec/containers/0/image`) are a race against any controller that reorders, and it needs `test` ops to be safe. More machinery, same result. |
| Server-side apply | Rejected — but this was the closest call in the design; see §3.2. |

### 3.2 SSA vs merge patch — the conflict, and the tie-breaker

The upstream research done for §5.1 closes with a recommendation *against* the choice made here:
"prefer SSA with a fixed field manager over PUT or merge-patch-on-lists". That recommendation is
recorded rather than buried, because it is not obviously wrong. Its facts are all confirmed and
all consistent with this design:

- RFC 7386 replaces lists wholesale — confirmed (RFC text + the kubectl "Update API objects in
  place" doc).
- CRDs genuinely cannot take strategic merge patch — confirmed *from source*, stronger than a doc
  citation: `staging/src/k8s.io/apiextensions-apiserver/pkg/apiserver/customresource_handler.go`
  advertises exactly `[JSONPatchType, MergePatchType, ApplyPatchType]`. `StrategicMergePatchType`
  is absent.
- An SSA patch from a manager that only ever includes its own fields does not remove fields owned
  by another manager — confirmed.

The recommendation nevertheless does not apply, for two reasons:

1. **It is scoped to "merge-patch-on-lists" meaning *a form re-serialising the list from its own
   model*.** That is the trap §1.1 exists to prevent, and this design does not do it. Here the
   list sent is the **server's own array**, cloned, with one field of one element changed. Every
   other element and every unmodelled field on the touched element carries the server's value
   verbatim. The research's risk table does not model that mitigation.
2. **SSA would conflict with ArgoCD.** SSA fails on any field co-owned by another field manager
   unless `force: true`. ArgoCD's application controller *is* a field manager on every resource it
   manages — which, in this app, is the common case. Adopting SSA means either constant conflict
   errors on exactly the resources users most want to edit, or shipping `force: true` by default,
   which reintroduces a clobber. `Patch::Merge` never conflicts.

Secondary: SSA merges lists by key only where the schema declares
`x-kubernetes-list-type: map`. CRDs frequently don't, so for `argocd`/`flux-*` SSA is atomic on
lists anyway — the same as merge patch, at the cost of the conflict machinery.

**Decision stands: `Patch::Merge`.** Revisit only if a concrete case appears where two writers
must safely co-edit different elements of the same list on a built-in type.

### 3.3 The two sharp edges of RFC 7386

1. **Deleting a map key requires the explicit `null` sentinel.** `{"data": {"oldKey": null}}`
   deletes; omitting `oldKey` **leaves it alone**. Every map-shaped form must diff for removals,
   not just additions/changes. This is the single most likely correctness bug in the feature.
2. **Merge patch merges *maps* by key** — which is a safety property for GitOps:
   `{"metadata":{"annotations":{...}}}` cannot clobber ArgoCD's
   `argocd.argoproj.io/refresh` annotation, and a patch on `spec` cannot disturb `.operation`.
   See §6.

### 3.4 Secret — the read path and the write path are DIFFERENT FIELDS

The sharpest trap in Tier 1. Clone-and-mutate does **not** work naively for Secrets, because
three different fields are involved:

| Operation | Field | Note |
|---|---|---|
| **Read / display** | `live.data` — **base64** | `get_resource_json` returns the raw object, so values arrive base64-encoded. The form must decode to display. |
| **Add / edit a key** | `stringData` — **cleartext** | `stringData` is merged into `data` *before* `ValidateSecret` runs, which is what makes the create-side TLS form work. Never hand-base64 anything except the docker `auth` field. |
| **Delete a key** | `data: { oldKey: null }` | **Deletion cannot go through `stringData`.** A patch that only sets `stringData` leaves every existing `data` key intact — the removed key silently survives. |

So the Secret form's `next` is **not** a plain clone-mutate: edits and additions land in
`stringData`, removals land in `data` as `null` sentinels, and both channels can appear in one
patch. This needs its own `check-emit` fixture — edit one key **and** delete another in the same
patch, then assert via `applyMergePatch` that the edit landed, the deletion took effect, and every
untouched key survived.

**ConfigMap has none of this**: plaintext `data`, straight clone-and-mutate, removals as `null`.

---

## 4. Frontend contract — FROZEN

New directory `src/components/edit/`, deliberately parallel to `src/components/create/`.

### 4.1 `edit/patch.ts` — the single choke point

```ts
/** RFC 7386 diff. Returns the minimal merge patch turning `orig` into `next`,
 *  or `undefined` when they are deep-equal.
 *  - object: recurse; keys in `orig` missing from `next` emit `null` (the
 *    RFC 7386 delete sentinel); keys equal in both are omitted.
 *  - array: NO element-wise merge (RFC 7386 has none). Deep-equal → omitted;
 *    otherwise the whole `next` array is emitted.
 *  - scalar: emitted when different.
 */
export function mergePatch(orig: unknown, next: unknown): unknown | undefined;

/** RFC 7386 apply. Exists ONLY as the test oracle for scripts/check-emit.ts —
 *  the app never applies a patch locally. ~15 lines: null deletes, object
 *  recurses, anything else replaces. */
export function applyMergePatch(doc: unknown, patch: unknown): unknown;
```

`mergePatch` is to this feature what `doc()` is to the create feature: **the one function
between form state and the wire.** Get it right once.

**`patch.ts` must stay React/JSX-free and must import nothing from `registry.ts`** (which pulls in
JSX), so `scripts/check-emit.ts` can import it directly under Node 24's native type-stripping.
Mirrors the existing `emit.ts` (no React) / `fields.tsx` (React) split and its fixed dependency
direction. Do not let it drift.

**`undefined` vs `{}` — normalise once, at the host.** `mergePatch` returns `undefined` when
nothing changed, so a caller can distinguish "no change". `ResourceEditor` does
`const patch = mergePatch(live, next) ?? {}` **once**, and everything downstream — preview,
empty-check, invoke — sees a plain object. Nothing but the host ever sees `undefined`;
`Object.keys(undefined)` is the failure mode if both conventions leak past that line.

### 4.2 `edit/registry.ts` — the frozen form contract

```ts
export interface EditFormProps {
  context: string;
  namespace: string;          // "" for cluster-scoped kinds
  name: string;
  /** The live object from get_resource_json. TREAT AS FROZEN — never mutate. */
  live: Record<string, any>;
  /** Report a MUTATED CLONE of `live`, not a patch. The host diffs it.
   *  A form therefore cannot emit a malformed patch — it structurally cannot
   *  construct one. */
  onChange: (next: Record<string, any>, valid: boolean) => void;
}
export type EditForm = (props: EditFormProps) => JSX.Element;
export const EDIT_FORM: Partial<Record<ResourceType, EditForm>>;
```

**Forms report `next`, NOT a patch.** The host (`ResourceEditor`) is the only caller of
`mergePatch`. This is deliberate: it makes "the form emitted a bad patch shape" unrepresentable,
and gives one place to render the patch preview.

Every form's shape:

```tsx
export function SomeEditForm({ live, onChange }: EditFormProps) {
  const [foo, setFoo] = useState(() => live.spec?.foo ?? "");   // seed from live
  useEffect(() => {
    const next = structuredClone(live);
    next.spec ??= {};
    next.spec.foo = foo;                 // touch ONLY modelled paths
    onChange(next, isValid(foo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foo]);                             // ONLY this form's own state — see below
  return /* fields.tsx primitives */;
}
```

**The effect-loop hazard from `create/registry.ts` applies verbatim** and `tsc`/eslint cannot
see it: `onChange` is `useCallback`-stable, so the deps array lists **only this form's own state
fields** — never `onChange`, never `live`. Copy the shape exactly.

`noUnusedLocals` / `noUnusedParameters` are on project-wide: a form ignoring a prop renames it
with a leading underscore at destructure time (`namespace: _namespace`).

### 4.3 `ResourceEditor.tsx` — the host

Direct mirror of `ResourceCreator.tsx`. A modal, **not a new tab** — the YAML tab already ships
raw editing, and duplicating it inside a modal would be two editors for one job.

- Opened by a pencil button in the `ResourceDetailPanel` header (beside the existing delete
  button), rendered **only when `EDIT_FORM[kind]` exists**.
- Fetches via `useResourceJson(context, ns, kind, name, open)` — `retry: false`,
  `staleTime: 0` (an edit must diff against *now*, not a 30s-stale cache).
- Toggle is **Form / Patch**, where Patch is a **read-only** `JSON.stringify(patch, null, 2)`
  preview. There is no YAML mode: raw editing lives in the YAML tab.
- Footer: `Cancel` · `Dry run` · `Apply`, exactly as `ResourceCreator`.
- **Apply and Dry run are disabled when the patch is `{}`** ("no changes"). Sending an empty
  merge patch is a no-op round trip; disabling it is also the clearest possible signal that
  nothing was actually changed.
- On success: invalidate via the existing `RESOURCE_QUERY_KEY` map **and**
  `["resource-yaml", ...]` and `["resource-json", ...]`.
- Errors: `(error as any)?.message ?? String(error)` (Tauri v2 rejects with a plain string).

### 4.4 Hooks (`useResources.ts`)

```ts
export function useResourceJson(
  context: string, namespace: string, kind: string, name: string, enabled: boolean,
);  // queryKey ["resource-json", kind, context, namespace, name], staleTime: 0, retry: false

export function usePatchResource();
// useMutation<string, Error, { context; namespace; resourceType; name;
//                             patch: Record<string, any>; dryRun?: boolean }>
```

All data fetching stays in hooks. No `invoke()` inside a component.

---

## 5. Tiered scope — with an explicit cut list

**Hard rule: no edit form for any kind that has no create form.** 23 kinds have create forms;
that is the ceiling. It keeps the cut defensible and stops the surface from growing sideways.
Two deliberate exceptions, both because the user named GitOps in scope and both flat specs:
`argocd`, `flux-ks`, `flux-hr`.

Tiering criterion (not "commonly edited"): **legally-mutable surface × map-vs-list shape × does
an existing action already cover it.** A form that is 80% disabled inputs is worse than the YAML
tab that already ships.

### Tier 1 — full guided edit (8 components, 12 registrations)

| kind(s) | Editable | Disabled, with reason |
|---|---|---|
| `cm` | `data` map, labels, annotations | `immutable: true` → whole form read-only |
| `sec` | `stringData` per type (Opaque / tls / dockerconfigjson) | `type` (immutable); `immutable: true` → read-only |
| `deploy` / `sts` / `ds` | `spec.template.spec.containers[]`: image, env, args, resources · labels · annotations | Not rendered at all (nothing to grey out): `spec.selector`; `sts.spec.serviceName`, `volumeClaimTemplates`, `podManagementPolicy` |
| `svc` | `ports[]`, `selector` map, `type`, `sessionAffinity` | `clusterIP`, `ipFamilies`, `ipFamilyPolicy` |
| `ing` | `ingressClassName`, `rules[]`, `tls[]` — fully mutable | — |
| `roles` / `croles` | `rules[]` | `croles` with `aggregationRule`: `rules` is controller-owned |
| `rbindings` / `crbindings` | `subjects[]` | `roleRef` (immutable) |
| `argocd` | `spec.source.{repoURL,path,targetRevision}`, `spec.syncPolicy.automated.{prune,selfHeal}`, `spec.destination` | — (see §6) |

`deploy`/`sts`/`ds` are **one component**, three registrations: the path
`spec.template.spec.containers` is genuinely identical across all three, which is exactly the
bar `create/`'s "parameterise only genuinely identical shapes" rule sets. `roles`/`croles` and
`rbindings`/`crbindings` are one component each with a scope token, matching `RBAC_FORMS`.

**`replicas` is NOT in the deploy/sts form.** `WorkloadActions` already ships scale, restart,
pause/resume and rollback. The form links to the existing Scale action instead of rebuilding it.

### Tier 2 — narrow, "the two fields people actually change" (7 kinds)

| kind | Fields | Why narrow |
|---|---|---|
| `pvc` | storage size only, `min` = current | Everything else is immutable; growth is gated |
| `sa` | `imagePullSecrets`, labels, annotations | `secrets` has token-controller semantics |
| `rq` | `spec.hard` map | Map-shaped, fully mutable, trivially small |
| `lr` | `spec.limits[]` | List-shaped but flat |
| `cron` | `schedule`, `suspend`, `concurrencyPolicy`, history limits | `jobTemplate` edits only affect future jobs — confusing; YAML for that |
| `flux-ks` | `suspend`, `interval`, `path`, `prune` | Flat spec, high-frequency ops toggles |
| `flux-hr` | `suspend`, `interval`, `chart.spec.version` | Same |

### Tier 3 — YAML only. **Explicitly cut.**

| kind | Reason cut |
|---|---|
| `jobs` | `spec.template` is immutable upstream. The real workflow is delete-and-recreate, not edit. |
| `netpol` | Deeply nested `ingress[]/egress[]` × `from[]/to[]/ports[]`. A "narrow" version isn't meaningful and a full one is a week. YAML is genuinely better here. |
| `gw`, `httproute` | Nested `listeners[]` / `rules[]`, low edit frequency. Same reasoning as `netpol`. |
| `pv` | Cluster-admin-only and rarely hand-edited. **Cut on frequency, not immutability** — see §5.1, `capacity`/`reclaimPolicy`/`claimRef` are in fact mutable. |
| `sc` | `provisioner`, `parameters`, `reclaimPolicy`, `volumeBindingMode` all immutable; only `allowedTopologies` + `allowVolumeExpansion` remain. Not a form. |
| `pc` | `value` **and** `preemptionPolicy` immutable. Only `description`/`globalDefault` remain — near-zero value. |
| `nodes` | Already covered: drain / cordon / taints actions ship. |
| `helm` | Already covered: Values tab + upgrade ship. |
| `crd` | Editing a CRD schema from a GUI is a foot-gun with no upside. |
| `pdb`, `cert`, `argo-appsets`, `argo-projects` | No create form → out of scope by the hard rule. |
| `ns` | **Cut late, deliberately.** Two blockers: `ns` is not in `ResourceType` (create needed `CreatableKind = ResourceType \| "ns"` for exactly this reason), and — the larger half — **there is no ResourceDetailPanel for a Namespace**, so §4.3's pencil button has nothing to attach to. Hosting it would mean a whole new Sidebar affordance to edit two metadata fields. Not worth the surface. |

**7 of the 23 create-form kinds get no edit form at all** — `ns`, `netpol`, `gw`, `httproute`, `pv`, `sc`, `jobs`.
That is the point of the ladder. (Recount during the v1.1.0 doc audit: this line previously read
"10", which counted Tier 3 *rows* — several of those rows, e.g. `pc`, `nodes`, `helm`, `crd`, `pdb`,
`cert`, `argo-appsets`, `argo-projects`, have no create form either, so they were never in the 23 to
begin with. Registrations are unchanged at 19: 16 create-form kinds + the 3 GitOps exceptions.)

### 5.1 Immutability table — verified against upstream source

Verified against `kubernetes/kubernetes` **release-1.31** (with `master` cross-checked where
noted). Every "disabled, with reason" hint in a Tier-1/2 form must trace to a row here, and the
hint text must name the field, not just say "immutable". **Do not quote server error strings in
hints** — see the RoleBinding row for why.

| Kind | Immutable on update | Enforced by |
|---|---|---|
| **Deployment** | `spec.selector` **only**. `replicas`, `template`, `strategy` all mutable. | `pkg/apis/apps/validation/validation.go` → `ValidateDeploymentUpdate` (`ValidateImmutableField` on `Spec.Selector`) |
| **StatefulSet** | `spec.selector`, `spec.volumeClaimTemplates`, `spec.serviceName`, **`spec.podManagementPolicy`**. `template` IS mutable. | same file → `ValidateStatefulSetUpdate` — exactly four `ValidateImmutableField` calls |
| **DaemonSet** | `spec.selector` only. `template` mutable. | same file → `ValidateDaemonSetSpecUpdate` |
| **Service** | `spec.clusterIP`/`clusterIPs` and `spec.ipFamilies` are **conditionally** immutable (dual-stack up/downgrade rules, not a flat block); `spec.healthCheckNodePort` immutable while `type=LoadBalancer`+`externalTrafficPolicy=Local`; `spec.loadBalancerClass` immutable once set. **`spec.type` has NO immutability check.** | `pkg/apis/core/validation/validation.go` → `ValidateServiceUpdate`, `validateUpgradeDowngradeClusterIPs`, `validateUpgradeDowngradeIPFamilies`, `validateLoadBalancerClassField` |
| **Service — silent reset** | On a `type` transition the server **zeroes** fields that no longer apply (`clusterIP(s)`, `ipFamilies`, `ipFamilyPolicy`, nodePorts, `healthCheckNodePort`, `loadBalancerClass`) *before* validation — unless the client also tried to set them, which is then rejected. | `pkg/registry/core/service/strategy.go` → `dropTypeDependentFields` (from `PrepareForUpdate`) |
| **Ingress** | **Nothing.** `oldIngress` is used only to grandfather now-stricter values, never as a diff. | `pkg/apis/networking/validation/validation.go` → `ValidateIngressUpdate` |
| **ConfigMap / Secret** | Once `immutable: true`: `data`/`binaryData` frozen **and `immutable` cannot be flipped back to false** — strict one-way, delete+recreate is the only path. | `ValidateConfigMapUpdate` / `ValidateSecretUpdate` |
| **Secret** | `type` immutable. An *empty* type in the request is silently defaulted back to the old value; an explicit *different* type is rejected. | `ValidateSecretUpdate` + `pkg/registry/core/secret/strategy.go` `PrepareForUpdate` |
| **PVC** | `storageClassName`, `volumeName` (mutable exactly once, while still `""`), `accessModes`, `selector`, `dataSource`/`dataSourceRef`, `volumeMode`. **Mutable:** `resources.requests.storage` **grow-only** (`"field can not be less than previous value"`), and `volumeAttributesClassName`. | `ValidatePersistentVolumeClaimUpdate` — clones both specs, zeroes the mutable fields, diffs the rest |
| **RoleBinding / ClusterRoleBinding** | `roleRef`. **`subjects` fully mutable.** Error text is version-dependent: 1.31 says `cannot change roleRef` (plain equality check); `master` refactors it to `ValidateImmutableField` → `field is immutable`. **Therefore hints must not quote the server message.** | `pkg/apis/rbac/validation/validation.go` → `ValidateRoleBindingUpdate` |
| **Role / ClusterRole** | **Nothing** — `rules` fully mutable. **But** a ClusterRole with `aggregationRule.clusterRoleSelectors` has its `rules` recomputed and overwritten by the aggregation controller on the next reconcile (SSA, field manager `clusterrole-aggregation-controller`). Not API-immutable; effectively controller-owned. | `pkg/controller/clusterroleaggregation/clusterroleaggregation_controller.go` |
| **ServiceAccount** | **Nothing** immutable. **But** `PrepareForUpdate` → `cleanSecretReferences` strips every `.secrets` entry down to `{Name}` on every write, silently discarding namespace/uid/fieldPath. `imagePullSecrets` untouched. | `pkg/registry/core/serviceaccount/strategy.go` |
| **Namespace** | `spec.finalizers` is **silently discarded** on a normal update — `PrepareForUpdate` does `new.Spec.Finalizers = old.Spec.Finalizers` before validation, so there is no error, the edit just vanishes. Changeable **only** via the `/finalize` subresource. Labels/annotations fully mutable. | `pkg/registry/core/namespace/strategy.go` |
| **ResourceQuota** | `spec.scopes` (set-equality). **`spec.hard` fully mutable.** | `ValidateResourceQuotaUpdate` |
| **LimitRange** | **Nothing** — no `ValidateLimitRangeUpdate` exists at all; the registry re-runs the create-time validator with no comparison to `old`. | `pkg/registry/core/limitrange/strategy.go` |
| **CronJob** | **Nothing.** `ValidateCronJobUpdate` contains **zero** `ValidateImmutableField` calls — `schedule`, `jobTemplate`, `concurrencyPolicy`, `suspend`, history limits all freely mutable. | `pkg/apis/batch/validation/validation.go` → `ValidateCronJobUpdate` |

Kinds cut in Tier 3, for the record — these corrected two of my cut *reasons*:

- **Job** — `selector`, `completionMode`, `podFailurePolicy`, `backoffLimitPerIndex`, `managedBy`,
  `successPolicy` unconditionally immutable. `spec.template` immutable **while running**, partly
  mutable while `suspend: true` behind two feature gates. `completions` mutable only in lockstep
  with `parallelism` for Indexed jobs. Cut reason confirmed. (`ValidateJobSpecUpdate`)
- **PersistentVolume** — **my original cut reason was WRONG.** `spec.capacity`,
  `spec.persistentVolumeReclaimPolicy` and `spec.claimRef` are all **mutable** (absent from
  `ValidatePersistentVolumeUpdate` entirely — this is what makes the `kubectl patch pv … claimRef: null`
  release pattern work). Only the volume source block, `volumeMode` and `nodeAffinity` are
  immutable. **The cut still stands, but on frequency grounds only** (cluster-admin, rare), not
  immutability. Revisit if `claimRef` release is a workflow users want.
- **StorageClass** — `provisioner`, `parameters`, `reclaimPolicy`, `volumeBindingMode` all four
  immutable. Only `allowedTopologies` and `allowVolumeExpansion` are mutable. Cut confirmed.
- **PriorityClass** — `value` **and** `preemptionPolicy` immutable; only `globalDefault` and
  `description` remain. Cut confirmed.
- **NetworkPolicy** — **fully mutable**, including `podSelector`. The cut is purely about the
  nested-list shape, not legality. Honest reason: cost, not correctness.
- **HPA** — **nothing immutable at all**, including `spec.scaleTargetRef` (repointing an HPA at a
  different workload is a legal plain update). Out of scope only by the no-create-form rule; it
  would be the cheapest Tier-1 form in the set if that rule were relaxed.

---

## 6. GitOps

Two distinct problems, both in scope:

**(a) Editing a GitOps object itself** — legitimate and Tier 1/2 (`argocd`, `flux-ks`,
`flux-hr`). The ArgoCD write contract in CLAUDE.md is immutable and this must not disturb it:
sync is `.operation` with `syncStrategy.hook.force`; refresh is an annotation. Merge patch
protects both structurally — it merges maps by key, so a patch touching `spec` cannot remove
`.operation`, and a patch touching `spec` cannot remove the refresh annotation. **A form must
never emit a `.operation` or `metadata.annotations["argocd.argoproj.io/refresh"]` key**, and
`check-emit.ts` asserts that.

**(b) Editing a resource *managed by* GitOps** — futile: ArgoCD/Flux reverts it on the next
reconciliation (~3 min default). **DECISION: warn.** We already have the signal —
`resolveManagedBy()` in `ResourceDetailPanel.tsx` reads
`argocd.argoproj.io/tracking-id` → `argocd.argoproj.io/instance` →
`app.kubernetes.io/instance`. The warning is a banner at the top of the editor modal:

> Managed by **{app}** — changes will be reverted on the next sync.

It does **not** block Apply (drift-then-observe is a legitimate debugging move). It costs
nothing: the annotations are already in the `live` object the editor fetched, so **zero extra
requests** — `resolveManagedBy(live.metadata?.annotations ?? {}, live.metadata?.labels ?? {})`.
The confident/possible distinction it already makes carries through ("Possibly managed by" for
the Helm-instance-label fallback). The alternative is users mystified by vanishing edits.

---

## 7. Verification

Per phase, in order:

| Check | Command |
|---|---|
| Rust compiles | `cd src-tauri && cargo check` |
| Rust tests | `cd src-tauri && cargo test` |
| Types | `npx tsc --noEmit` |
| Build | `npm run build` |
| Emission/patch invariants | `node scripts/check-emit.ts` |

### 7.1 The `check-emit.ts` extension that actually guards the trap

"The patch contains only changed fields" is **necessary but not sufficient** — it does not catch
a list sent whole with an element silently dropped. That is the exact failure mode. The oracle:

1. Implement `applyMergePatch` (§4.1) — ~15 lines, no deps.
2. For **each Tier-1 kind**, a fixture `live` object that deliberately carries **unmodelled
   fields**: a sidecar container, `tolerations`, `affinity`, `securityContext`,
   `volumeMounts`, a webhook-injected annotation, `ownerReferences`.
3. Mutate one modelled leaf through the form's own transform.
4. Assert `applyMergePatch(live, patch)` **deep-equals `live` with only that leaf changed** —
   i.e. every unmodelled field survives.

That is the data-loss regression test, and it needs no cluster. Plus:

- `mergePatch(x, x) === undefined` for every fixture (no-op produces no patch).
- Map-key removal emits `null`, not omission.
- Array with one changed element emits the **whole** array, with sibling element fields intact.
- No patch for any kind contains `.operation` or the ArgoCD refresh annotation key.
- `applyMergePatch` round-trip: `applyMergePatch(orig, mergePatch(orig, next))` deep-equals `next`.

**As shipped, cases 16-24** (`node scripts/check-emit.ts`, 24 cases total):

| Case | Guards |
|---|---|
| 16 | Deployment: sidecar, tolerations, affinity, volumes, ownerReferences, webhook annotation, **and the edited container's own** volumeMounts/securityContext/ports/resources |
| 17 | ConfigMap: map add/edit/remove, `null` sentinel |
| 18 | RoleBinding: list-of-objects |
| 19 | Secret: the §3.4 dual channel — `stringData` edit + `data:{k:null}` delete in one patch |
| 20 | GitOps: no patch may contain `.operation` or the ArgoCD refresh annotation |
| 21 | PVC grow-only: Quantity compare is **byte-based**, not lexicographic (`1500Mi` vs `2Gi`, `1Gi` vs `1G`); documented `null` fail-open for exponent form |
| 22 | Service ports: whole-array resend keeps controller-assigned `nodePort` + unmodelled `appProtocol`; `clusterIP`/`ipFamilies` never patched |
| 23 | Ingress: two-level nesting (`rules[].http.paths[]`) — sibling rules/paths **and the edited path's own** `backend` |
| 24 | RBAC: a `nonResourceURLs` rule must not gain `apiGroups`/`resources` when a sibling rule is edited (the Phase-B bug) |

**Every one of these was mutation-tested** — the logic was deliberately broken and the
assertion confirmed to fire with a legible message. That pass found a real gap: case 23's
original `applied deepEqual next` was **circular** and could not catch a lossy `next`. The
fix, which generalises: *assert the edited element's own unmodelled fields, not just its
siblings.* Case 16 already did this; case 23 did not until corrected.

`src/components/edit/quantity.ts` exists solely so case 21 is possible — Node's
type-stripping cannot import JSX, so the Quantity parser had to leave `storage.tsx` to be
testable. Same no-React rule as `patch.ts`.

### 7.2 What is NOT verified — owed, not implied

**The cluster is unauthenticated (expired GKE auth). Nothing in this feature has been run
against a live API server.** Specifically owed:

- No patch has been accepted or rejected by a real API server.
- The immutability table (§5.1) is from upstream source reading, not from observed rejections.
- Grow-only PVC resize, `sts` partial-spec rejection, and `croles` aggregation behaviour are
  the three most likely places source-reading is wrong.
- **The Dry run button is how this gets closed.** It is more valuable on edit than on create,
  because an edit can be rejected for reasons (immutability) that a create never hits.

---

## 8. Pre-existing caveat, not a regression

`apply_resource_yaml` deserialises into typed `k8s-openapi` structs before `replace()`. The
**already-shipped YAML tab therefore drops fields newer than the pinned `k8s-openapi`** on save.
"Edit by YAML is shipped" is true with that asterisk. Not in scope to fix here; noted because
the new `get_resource_json`/`patch_resource` path does **not** have this problem (raw
`serde_json::Value` throughout), which is a second reason not to route form edits through the
YAML path.

---

## 9. Dispatch phases

Six agents fanned out at once would invent six incompatible patch helpers. Sequenced:

**Phase A (parallel):**
- **rust-engineer** — `src-tauri/**` exclusively. §3 in full.
- **contract agent (frontend-engineer)** — sole owner of: `src/components/edit/patch.ts`,
  `edit/registry.ts`, `edit/ResourceEditor.tsx`, `src/hooks/useResources.ts`,
  `scripts/check-emit.ts`, **`src/components/create/fields.tsx`**, and
  **`src/components/ResourceDetailPanel.tsx`**. The last two are contended by every agent —
  3079 lines in the panel alone — so they get exactly one owner. Also writes **stub
  `edit/forms/*.tsx`** exporting empty maps, so `registry.ts` type-checks before Phase B lands.

**Phase B (after A, parallel, disjoint file ownership):**
- `edit/forms/workloads.tsx` — deploy/sts/ds shared container editor, cron
- `edit/forms/networking.tsx` — svc, ing
- `edit/forms/keyvalue.tsx` + `storage.tsx` — cm, sec, pvc, rq, lr
- `edit/forms/rbac.tsx` + `gitops.tsx` — roles/croles, rbindings/crbindings, sa, argocd, flux-ks, flux-hr

**Phase B agents do not edit `fields.tsx`.** A form needing a new primitive prop reports it to
the contract agent. `src/components/create/` is read-only to Phase B except as an import source.
