# Create / edit / delete / merge write paths

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Delete propagation (v1.3.0)

`delete_resource(context, namespace, resource_type, name, propagation: Option<String>)`. Pure, tested `delete_params_for`: `None`, `""`, `"background"` → Background; `"foreground"` → Foreground; `"orphan"` → Orphan; anything else → `Failed to delete: unknown propagation policy '…'` **before** the client is built. Every arm (typed macros and `DynamicObject`) uses it.

**Always send Background explicitly.** With no policy the server default applies, and for `batch/v1` Jobs that is **orphan** (deleting a Job left its pods). kubectl sends Background. `delete_namespace(context, name)` is its own command and also sends Background explicitly, through `delete_params_for(None)` (the namespace controller removes the contents either way, so the effect is unchanged). Checks: `grep -n "DeleteParams::default()" src-tauri/src/commands/extras.rs` is empty; `grep -rn "DeleteParams::default()" src-tauri/src` matches only `delete_pod` (`pods.rs`), `delete_node` (`nodes.rs`) and `delete_argocd_app` (`argocd.rs`). `delete_pod`, `delete_node` and `delete_argocd_app` are separate commands that keep the library default on purpose (no dependents to orphan, or an ArgoCD finalizer choice).

- **Picker** (radio group in the delete confirm) only for `deploy sts ds jobs rs cron`, per-row and panel header. Resets to Background on open and sends the policy explicitly. Other kinds omit it; the backend sends Background.
- **ArgoCD cascade is a finalizer choice, never `propagationPolicy`.** `delete_argocd_app` ("Delete app + resources" / "Delete app only") adds or clears finalizers.
- Without cascade it merge-patches `finalizers: []`, clearing **all** finalizers (Known Open Item).

## Neat YAML (v1.3.0)

`get_resource_yaml_neat(context, namespace, resource_type, name) -> NeatYaml { yaml, hidden }` is **display only**. Same fetch as `get_resource_yaml` (one function, `neat` flag), then pure `neat_value` removes, in order, listing in `hidden` only paths that existed:

1. `metadata.managedFields`
2. `metadata.annotations.kubectl.kubernetes.io/last-applied-configuration` (an emptied `annotations` is dropped, not listed)
3. `status`
4. `metadata.uid`
5. `metadata.resourceVersion`
6. `metadata.generation`
7. `metadata.creationTimestamp`

`spec` is never touched. `get_resource_yaml` is unchanged. **Neat output never reaches `apply_resource_yaml`**: the editor seed and Save use `get_resource_yaml`. Neat keys are alphabetical (serialised from JSON).

## Resource Creation (v0.8.0)

`ResourceCreator.tsx` (⌘N) calls `create_resource_from_yaml` (`resource_create.rs`), shows the result inline, auto-closes 2 s after success.

## Universal Delete Button (v0.9.3)

- Backend: one `delete_resource` in `pods.rs`, matching `resource_type` to a typed `Api` or `DynamicObject`. Unsupported kinds: `Err("delete_resource: unsupported resource type '<k>'")`.
- Hook: `useDeleteResource()` calls `invokeWrite("delete_resource", { context, namespace, resourceType, name, propagation })` (`propagation` optional) and invalidates via `RESOURCE_QUERY_KEY` (`src/utils/resourceQueryKey.ts`).
- UI: per-row in `GenericResourceTable` and the `ResourceDetailPanel` header, both behind `ConfirmModal`. Cluster-scoped kinds require typing the name (`requireTyping`).

## TLS Certificate Tab (v1.0.0)

`get_tls_certificate_info(context, namespace, name) -> Result<Vec<TlsCertInfo>, String>` (`tls_cert.rs`). The TLS tab shows only for `kind === "sec"` **and** `type_ === "kubernetes.io/tls"`, through one hoisted `hasTlsTab` used by `tabsFor()`, the hook's `enabled` and the render branch (three gates would let a stale tab fire on an Opaque Secret).

- **Invariant: `result.len()` == number of PEM CERTIFICATE blocks. Never drop a block.** Unparseable blocks come back with `parse_error` set and other fields defaulted. No `filter_map`. Only skips: EOF with no BEGIN, and well-formed non-CERTIFICATE labels.
- **`panic = "abort"`**: a parser panic kills the app. No `unwrap`/`expect`/indexing; `catch_unwind` does nothing under abort.
- IP SANs are raw bytes (`GeneralName::IPAddress(&[u8])`): format via length-checked `Ipv4Addr::from` / `Ipv6Addr::from`, never hex or `{:?}`.
- **Security:** reads `tls.crt` and `ca.crt` only; never `tls.key`. No raw PEM/DER returned. `parse_error` holds categorical library messages, never input bytes.
- Crates: `x509-parser` + `sha2` (11 transitive crates, no C, no openssl).
- Role badge (`TLS` / `Root CA` / `Intermediate CA`) comes from `is_ca` + `self_signed` in the frontend. Render the whole chain, not only the leaf.

## Shared Expiry Rule (v1.0.0)

`src/utils/expiry.ts` is the **single** expiry definition; `grep -rn "DAYS_MS" src/` returns one hit. `expiryState(notAfter, notBefore?)` uses a **proportional** threshold `min(lifetime/3, 30d)`, falling back to 7 days without `not_before` (cert-manager rows). An absolute 30-day rule would paint 6-day Let's Encrypt certs permanently red. `relativeFromIso` lives here too.

## Context-Aware `+New` (v1.0.0)

`+New` / ⌘N opens a kind-aware creator: a guided form where one exists, plus YAML mode pre-filled from `src/utils/resourceTemplates.ts`.

`src/components/create/`:

| File | Purpose |
|------|---------|
| `emit.ts` | Types, validators, serialisers. No React. |
| `fields.tsx` | Shared field primitives |
| `registry.ts` | Frozen `CreateFormProps` contract + kind→form map (`CREATE_FORM`) |
| `forms/*.tsx` | `keyvalue`, `namespace`, `workloads`, `networking`, `storage`, `rbac` |

23 kinds have forms. Rules:

- **Primitives shared, form shape explicit per kind.** No schema/OpenAPI form engine (rejected: widget registry, `oneOf`/`anyOf`, incomplete CRD schemas, worse than a template). Never add a per-kind branch to a primitive.
- **`metadata(name, namespace: string | null, …)` in `emit.ts` is the ONLY code that emits `namespace:`.** Cluster-scoped forms pass `null` and have no namespace input. Exception one level down: `subjects[].namespace` is required for `kind: ServiceAccount` in both RoleBinding and ClusterRoleBinding.
- **Each form reports `(yaml, valid)`; `ResourceCreator` never re-serialises**, so the YAML toggle equals what submit sends.
- **Block scalars use an explicit indicator (`|2-`).** Bare `|-` auto-detects indent from the first line, stripping a value's own leading whitespace or failing on a less-indented later line.
- **Parameterise only identical shapes.** `roles`/`croles` and `rbindings`/`crbindings`: one component + scope token. `deploy`/`sts`/`ds`/`jobs`/`cron`: five components sharing `ContainerListField` / `emitPodSpec` (`ds` no replicas, `jobs` no selector, `cron` nests a Job). `cm` and `sec` are separate (Secret has four type bodies); they share only `emitDataBlock()`. `rq` (flat map) and `lr` (array) differ.
- **Validate all free text interpolated into YAML** (DNS-1123 names/namespaces, newline guards). A pasted newline injects a sibling key.
- The namespace form opens from TopBar **New** (`New namespace…`) and `⌘N` on the Namespaces page (kind `ns`); the Sidebar `+` is gone. `ns` is a `ResourceType` member now, so the extra `"ns"` in `CreatableKind = ResourceType | "ns"` is redundant but harmless.
- **Namespace delete.** It is not a `delete_resource` kind: the page's row trash and the panel's header trash both open `DeleteNamespaceConfirm`, which calls `useDeleteNamespace` (`invokeWrite("delete_namespace")`, Background). The protected set (`default`, `kube-system`, `kube-public`, `kube-node-lease`) is offered disabled with a reason, never hidden, and so is a namespace that is already Terminating; the reasons and their order are in `utils/namespaces.ts` (`namespaceDeleteReason`, tested) and `ui.md` → Namespaces: picker and page. A namespace label edit is a YAML Save through the same preview gate as any kind (`ns` arm in the one replace path); there is no namespace edit form.
- `create_resource_from_yaml` takes `dry_run: Option<bool>` (a bare `bool` errors `missing required key dry_run`).
- A new picker almost always has an existing hook in `useResources.ts`.
- `scripts/check-emit.ts` asserts serialiser invariants, incl. byte identity of the original `cm`/`sec` output.

No create form has been verified against a live API server (Known Open Items). Cheapest end-to-end check: create a `kubernetes.io/tls` Secret via the form, then open its TLS tab.

### Secret Types (v1.0.1)

`SecretForm` (`forms/keyvalue.tsx`) switches over four `type`s. `emitSecret()` (`emit.ts`) is the one serialiser, over the `SecretPayload` discriminated union; every switch returns in each case with **no `default`**, so `tsc` (TS2366) enforces exhaustiveness. Per-type state is not reset on type change.

| Type | Emitted | Notes |
|---|---|---|
| `Opaque` | `stringData` map | Shares `emitDataBlock()` with ConfigMap |
| `kubernetes.io/tls` | `stringData` `tls.crt` + `tls.key` (required), `ca.crt` omitted when blank | Cleartext PEM is fine: `stringData` merges into `data` before validation. Only non-empty is checked |
| `kubernetes.io/dockerconfigjson` | `stringData[".dockerconfigjson"]` from `dockerConfigJson()` | `auth = base64(user:pass)` computed **client-side** (kubectl parity). Use `btoa(String.fromCharCode(...new TextEncoder().encode(s)))`; bare `btoa()` throws on non-Latin-1. Blank email/username/password omitted; submit blocked without username and password. Legacy `.dockercfg` unsupported |
| `kubernetes.io/service-account-token` | annotation only | The server accepts a missing SA, then the token controller deletes the Secret seconds later. SA is a live dropdown driven by the form's own `ns` state (not the `namespace` prop), with a non-blocking warning. Legacy since 1.24 |

`TextField` has `multiline?: boolean` (for PEM).

## Guided Edit (v1.1.0)

Pencil button in the `ResourceDetailPanel` header opens `src/components/edit/ResourceEditor.tsx`: form, **Patch** preview, **Dry run**, Save. Contract: `docs/plan-guided-edit.md`.

### The central invariant: clone, mutate, diff. Never re-serialise.

```
get_resource_json  →  base (raw JSON; frozen to the first fetch per open session)
                   →  next = structuredClone(base)  →  form mutates ONLY its own paths
                   →  mergePatch(base, next)        →  patch_resource (Patch::Merge)
```

**Every patch value came from the live object verbatim or is exactly what the user typed.**

**RFC 7386 replaces arrays wholesale.** Edit targets (`containers`, `env`, `ports`, `rules`, `subjects`, `limits`) are arrays, so a form that rebuilds the array from its own state deletes sidecars, `volumeMounts`, `probes`, `securityContext`. Cloning the server array and changing one field closes it.

- No `resourceVersion`: last-write-wins per field, like `kubectl patch`.
- Never use `apply_resource_yaml` for form edits (typed whole-object replace). `patch_resource` is raw `serde_json::Value` end to end.
- **Do NOT add element-wise array merge to `patch.ts`.**
- Tests that guard whole-array replace must assert the **edited element's own** unmodelled fields (e.g. `applied.x[0].securityContext`), not only siblings. `applyMergePatch(orig, patch) deepEqual next` alone is circular. Mutation-test every new oracle.

### Why not server-side apply

**Rejected.** ArgoCD's controller is a field manager on every resource it manages; SSA conflicts on co-owned fields unless `force: true`, which clobbers. `Patch::Merge` never conflicts. SSA also merges lists by key only with `x-kubernetes-list-type: map`, which CRDs often lack. Revisit only if two writers must co-edit different elements of one list on a built-in type.

Strategic merge patch rejected: CRDs do not accept it. JSON Patch (RFC 6902) rejected: positional indices race controllers.

**One sanctioned exception:** `start_debug_container` (`Patch::Strategic` on Pod `ephemeralcontainers`). See Debug containers in `pods-logs.md`. Never generalise; `grep -rn "Patch::Strategic" src-tauri/src` returns exactly one hit.

### The two sharp edges of RFC 7386

1. **Deleting a map key needs an explicit `null`.** `{"data":{"oldKey":null}}` deletes; omission keeps it. `mergePatch` handles this centrally. It also treats `next[k] === undefined` as missing (emits `null`), since `undefined` vanishes in JSON.
2. **Maps merge by key**, so a patch cannot clobber ArgoCD's `argocd.argoproj.io/refresh` annotation or `.operation`. Forms must still never *emit* either.

### Secret: read and write use different fields

| Operation | Field | Note |
|---|---|---|
| Read | `live.data`, base64 | Form decodes to display |
| Add / edit | `stringData`, cleartext | Never hand-base64 (except docker `auth`) |
| Delete | `data: { oldKey: null }` | **Cannot go through `stringData`**; the key would survive |

Both channels can appear in one patch. ConfigMap is plain clone-and-mutate.

### Rust side: one table, two commands

`resource_edit.rs` uses `DynamicObject` + `ApiResource`. `gvk_for(resource_type) -> (group, version, kind, plural, namespaced)` is its only per-kind knowledge.

- **`gvk_for` = "kinds `get_resource_json` / `patch_resource` can reach"**: every `get_resource_yaml` kind plus `argocd`, **except `argo-appsets` / `argo-projects`** (their version must come from `argo_api_resource` discovery; do not widen the hardcoded `v1alpha1`). Editability is decided only by `EDIT_FORM`. The `argocd` row's version is still hardcoded (Known Open Item). `preview_resource_yaml` also uses it, with a fallback for the two Argo kinds.
- `get_resource_json` returns the object **raw**: no filtering, no status stripping (any omission becomes a field the patch could clobber).
- `patch_resource(…, patch, dry_run: Option<bool>)`.
- The table's `namespaced` bool alone decides scope, never the caller. `require_namespace()` turns `""` into a readable error instead of a 404.
- Tests (no cluster): every editable kind and every reachable kind resolves; `namespaced == false` set equals `CLUSTER_SCOPED_KINDS`; `croles`/`crbindings` cluster-scoped; `argocd` namespaced; long aliases match short ones.

### Frontend contract

`patch.ts` and `quantity.ts` are React/JSX-free (Node type-stripping in `check-emit.ts` cannot strip JSX); `registry.ts` and `forms/*.tsx` hold JSX.

- **Forms report a mutated clone, not a patch:** `onChange(next, valid)`. Only `ResourceEditor` calls `mergePatch`.
- `mergePatch` returns `undefined` for no change, normalised to `{}` **once**, at the host. No second `?? {}`.
- **Diff base frozen to the first successful fetch per open session.** `useResourceJson` is `staleTime: 0`; diffing a refetched `live` against old edits creates a phantom patch. `base` and `next` seed from one fetch. The editor stays mounted while closed, so seeding depends on `open` and waits for `!isFetching` (keyed on `[live]` alone, a reopen shows an empty modal).
- **`usePatchResource` skips invalidation for `dryRun`.** If the response lacks `"dry run"` (backend ignored the flag), `ResourceEditor` invalidates manually. Same guard in `ResourceCreator`.
- **Effect-loop hazard:** a form's reporting `useEffect` lists **only its own state**, never `onChange` or `live`. `registry.ts` shows the shape.
- Never filter keys out of form state to hide them: maps are rebuilt wholesale, so a hidden key becomes a `null` deletion. Render it disabled instead.

### Immutable fields: render disabled with a reason, never omit

`TextField` / `NumberField` / `SelectField` / `CheckField` take `disabled?` + `hint?`. Only for immutable fields already part of the form (Secret `type`, RoleBinding `roleRef`, PVC `storageClassName`/`accessModes`, Service `clusterIP`). **Never add a field just to disable it.** Citations: `docs/plan-guided-edit.md` §5.1. Never quote server error text in a hint (it changes across versions).

### Managed-by warning

ArgoCD/Flux revert edits on the next sync (~3 min). Banner: *"Managed by **{app}** — changes will be reverted on the next sync."* It **does not block** saving. Zero extra requests: `resolveManagedBy()` (exported from `ResourceDetailPanel.tsx`) reads the fetched `live`. The `app.kubernetes.io/instance` fallback (Helm sets it too) reads "Possibly managed by".

### Scope: 19 registrations

**Hard rule: no edit form for a kind without a create form.** Exceptions: `argocd`, `flux-ks`, `flux-hr` (flat specs). A request to edit a kind with no create form is two features; say so.

| Tier | Kinds | Registrations |
|---|---|---|
| 1, full | `cm`, `sec`, `deploy`/`sts`/`ds`, `svc`, `ing`, `roles`/`croles`, `rbindings`/`crbindings`, `argocd` | 12 (8 components) |
| 2, narrow | `pvc`, `sa`, `rq`, `lr`, `cron`, `flux-ks`, `flux-hr` | 7 |

No edit form: `jobs` (template immutable), `netpol`/`gw`/`httproute` (nested list-of-list; YAML is better), `pv` (rarely edited), `sc` (almost nothing mutable), `ns` (no detail panel). `deploy`/`sts`/`ds` are one component (identical `spec.template.spec.containers` path). **`replicas` is not in the form**: `WorkloadActions` owns scale/restart/pause/rollback.

## Key & Quantity Validators (v1.1.0)

Both fixed bugs were one shared primitive used across domains that only look alike. Grammars match upstream; do not simplify.

**Three key grammars.** `entryErrors(entries, kind)` (`create/emit.ts`) takes a **required** `kind: "data" | "label" | "annotation"`, no default, so `tsc` forces a choice per call site.

| kind | Validator | Upstream | Rule |
|---|---|---|---|
| `data` | `validateKey` | `IsConfigMapKey` | `[-._a-zA-Z0-9]+`, ≤253, not `.`/`..`/`..`-prefixed. CM/Secret keys, env names |
| `label` | `validateLabelKey(k, false)` | `IsLabelKey` | Optional DNS-1123 prefix (≤253) + `/` + name (`[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?`, ≤63); one `/` max; case-sensitive. Also selectors, StorageClass `parameters`, ResourceQuota `hard` |
| `annotation` | `validateLabelKey(k, true)` | `ValidateAnnotations` | Same, lowercased first (`Foo.com/bar` legal) |

- No reserved-prefix rule exists upstream (`kubernetes.io/`, `k8s.io/`). Do not add one.
- **Values are not validated**, on purpose (changing `entryErrors`' per-key contract touches ~29 call sites and risks disabling Save).
- **System-managed annotations are read-only in place, never filtered.** `SYSTEM_MANAGED_ANNOTATION_KEYS` (`create/fields.tsx`) is an exact-key `Set` (`argocd.argoproj.io/sync-wave`, `argocd.argoproj.io/hook`, `kubectl.kubernetes.io/default-container` are hand-authored and stay editable). Matching rows: inputs disabled, no delete, `title={value}`. They stay in state. `check-emit.ts` case 29: every key in the Set passes `validateLabelKey`.
- **CPU/memory are Quantities.** `QuantityField` (no character stripping) backs `ResourcesField` and edit-side container resources. `NumberField` stays digits-only for `replicas`/`port`. `validateQuantity` (`edit/quantity.ts`) implements the full upstream BNF (binarySI Ki-Ei, decimalSI `m`/`k`/`M`/`G`/`T`/`P`/`E`, exponent), rejects leading `-`. Submit is gated: `cpu: 100` is legal but means 100 cores. `check-emit.ts` case 28: `100m` reaches YAML as `cpu: 100m`.
- `create/forms/storage.tsx` keeps a narrower local `validateQuantity` for PVC/PV capacity (fails closed). Left alone.

## Merge from File (v1.2.0)

Contract: `docs/plan-kubeconfig-and-parity.md` §3.1.

**Not `kubectl apply`.** Apply three-way merges and prunes removed fields; RFC 7386 does not. SSA loses for the ArgoCD reason above. **UI says "Merge from file"; preview header "These keys will be set:"; never "Apply".**

### `serde_yaml` 0.9.34 hangs on malformed multi-document YAML

After one document in `Deserializer::from_str` fails, `.next()` **never returns `None`**. One `.next()` + one `deserialize()` on the bad document is fine; advancing past it hangs. So `.collect()` / `.filter_map(…).collect()` loops forever on pasted YAML, hanging a Tokio worker.

- **`split_yaml_documents` (`apply_file.rs`) is a `for` loop with `break` on the first error. Never an iterator chain.**
- Its regression test **hangs rather than fails** if it regresses. Deliberate.
- Preview stops at the first parse error; `MergeFromFileModal` disables Merge and says where parsing stopped. Skipping a bad document is impossible (later bytes are corrupted state).
- Single-document `serde_yaml::from_str` is unaffected.

### Other frozen rules

- **Plural and scope come from discovery** (`kube::discovery::oneshot::pinned_kind`), never `kind_to_plural`.
- Never split on the literal `---` (appears inside block scalars/PEM).
- `split_yaml_documents` is `pub(crate)`; `diff_manifests` / `index_manifest` in `helm.rs` also use it, with their own hang-not-fail test.
- Document count obeys the bulk limit (G2); the dialog has the read-only block, typed cluster label and `mergeFromFileEquiv` note (never `kubectl apply`).
- `api.get_opt(&name)`: `None` = create, `Some` = update.
- One document's failure never aborts the batch (per-doc results).
- `mergePreview.ts`: **arrays are leaf values with state `"replaced"`**; `check-emit.ts` asserts it on `containers`.
- Non-dry-run success calls `qc.invalidateQueries()` **unfiltered**.
- Skip invalidation for `dryRun`; detect an ignored flag from the response text.
- Clear the preview whenever the input text changes, and reset all modal state on `[open, context]` (the modal never unmounts).

## YAML Save and Helm upgrade previews (v1.3.1)

Both writes go through a **PREVIEW-GATE**: an `lg` `ConfirmModal` runs a server dry run, shows a diff, then enables the write. `YamlSaveGate.tsx` ("Review & save…", `⌘S` opens it, never saves directly) and `HelmUpgradeGate.tsx` ("Review upgrade…").

### One replace path

`apply_resource_yaml` and `preview_resource_yaml` both call `replace_resource_yaml(client, namespace, resource_type, name, yaml, dry_run, live_raw)` (`pods.rs`). **The per-kind replace macros exist only there**, so the preview validates exactly what Save does (`PostParams { dry_run: true, .. }`). `ReplaceError::apply_message` keeps the old error strings (`Invalid YAML: …`, `Failed to apply <label>: …`, `Unsupported resource type: …`).

### `preview_resource_yaml` outcomes

`preview_resource_yaml(context, namespace, resource_type, name, yaml) -> YamlSavePreview { outcome, message, live, result, dropped_paths }`. Parses one document (never the multi-doc iterator), reads the **raw** live object, runs the dry-run replace.

| `outcome` | When | `message` |
|---|---|---|
| `ok` | Dry run succeeded | `""`; `result` and `dropped_paths` filled |
| `invalid` | YAML does not parse / deserialise | `Invalid YAML: …`; `live` null |
| `rejected` | API said no (non-409), **incl. a failed live GET** | `ae.message` verbatim |
| `conflict` | 409, stale `resourceVersion` | `ae.message` verbatim |

Pure `classify_replace_error(code)`: 409 conflict, else rejected. **`Err` = preview unavailable** (`Failed to connect: …`, `Failed to preview: …`, unsupported kind). The frontend **never treats `Err` as approval**: Unavailable state, primary "Save without preview", typed name required. Rejected or conflict blocks the primary.

### `dropped_paths`

The YAML tab deserialises into pinned `k8s-openapi` structs, so newer fields drop silently on save. Pure `dropped_paths(raw, typed)` lists sorted dotted paths (`[i]` for indices) non-empty in raw live but missing from its typed round-trip. Values null, `{}`, `[]` are ignored; objects recurse; arrays recurse by index; top-level `status` skipped; scalars not compared. `[]` for `DynamicObject` kinds or a failed round-trip.

Every dropped path is one the user did not edit (the editor is seeded from the typed fetch). The gate lists them with an acknowledgement ("Save and drop N fields"), offers "Open form" when `EDIT_FORM` has the kind, and `yamlSaveDiff` removes them from the live side (empty = absent). Cannot report unknown `metadata.*` fields (`ObjectMeta` is typed).

### Helm upgrade preview

`preview_helm_upgrade(context, namespace, release, values_yaml) -> HelmUpgradePreview { outcome, message, current_values, new_values, resources, rendered_manifest }` (`helm.rs`):

1. Parse `values_yaml` as one document (empty/comment-only = `{}`; non-mapping = invalid). Failure: `invalid`, `Invalid values YAML: …`, both values `null`.
2. `helm get values <rel> -o json` (`null` → `{}`).
3. `extract_chart_from_k8s`: **the release-secret path `upgrade_helm_release` uses, never a repo lookup.**
4. `helm upgrade <rel> <chart_dir> --values <tmp> --namespace … --kube-context … --dry-run -o json`, separate `.arg()`s; read `.manifest`.
5. `helm get manifest`, then pure `diff_manifests(current, rendered, default_ns)`: split via `split_yaml_documents`, keyed `(kind, namespace-or-release-ns, name)`, JSON-compared, sorted, each `new` / `changed` / `removed` / `unchanged`.

Non-zero dry run exit: `Ok` + `rejected` with trimmed stderr, **except** a `friendly_auth_error` match, which is `Err`. Unrunnable helm, failed extraction, non-JSON output: `Err`. Unparseable manifest: `rejected`. `upgrade_helm_release` is unchanged and runs after the gate. Tabs: Values (`helmValuesDiff`, credential keys masked) and Rendered resources ("View rendered manifest"). The slot-6 `helm upgrade` text notes the chart comes from the release.

### PREVIEW-GATE rules

- Loading = `phase="review"` + `confirmDisabled`, **never `running` / `isPending`**, so a hung dry run can be cancelled. Initial focus "Back to editor" (`initialFocus="cancel"`, `cancelLabel`). The dialog never edits the editor text.
- **Rejected blocks; unavailable requires a typed name** ("Save without preview" / "Upgrade without preview"). Never conflate them.
- The preview is a read (not backstopped). The real write (`useApplyResource`, `useUpgradeHelmRelease`) is backstopped and logged.

## Secret values in the webview (v1.4.1, #33)

**No Secret value is shown without a per-object reveal, and none stays in the webview after the panel or dialog that fetched it closes.** `list_secrets` ships keys and sizes only (`Secret.sizes`: decoded byte length per key, empty value = 0; there is no `data`). ConfigMap data is plaintext and unchanged.

- `secretReadOptions(kind)` (`useResources.ts`) is `{ gcTime: 0, staleTime: 0, retry: false }` for `kind === "sec"`, else `{}`. It is spread last into the five hooks that can hold Secret-derived text: `useRevealedSecret`, `useResourceJson`, `useResourceYaml`, `useResourceYamlNeat` and the revealed `useHelmValues`. A new hook that reads a Secret must spread it too.
- Removal is the guarantee and `gcTime: 0` is the backup (React Query keeps the largest `gcTime` any observer of a key ever set). `forgetSecret(qc, context, namespace, name)` removes exactly four keys: `["secret-reveal", ctx, ns, name]`, `["resource-json", "sec", ctx, ns, name]`, `["resource-yaml", "sec", ctx, ns, name]` and `["resource-yaml", "neat", "sec", ctx, ns, name]`. `forgetHelmValues(qc, context, namespace, release)` removes the revealed Helm key `["helm-values", ctx, ns, release, "revealed"]` and never the redacted one. Both have a vitest on a real `QueryClient` (`hooks/secretCache.test.ts`).
- **Where they run.** A cleanup effect in the `ResourceDetailPanel` root, keyed on `(kind, context, namespace, name)`, calls both on close, selection change and context or namespace switch (kind is in the key so Secret `x` then ConfigMap `x` still fires). The same cleanup clears the edit buffers and edit modes (`editContent`, `valuesEditContent`, `editMode`, `valuesEditMode`) for every kind, because those buffers can hold Secret or Helm values. Hide values (Secret) and Hide (Helm values) call them directly; a successful Helm upgrade calls `forgetHelmValues` in `useUpgradeHelmRelease.onSuccess`. The Compare dialog removes the exact `["resource-json", "sec", ...]` key of each side on unmount; it does not call `forgetSecret`, which would also end the panel's own reveal.
- **Reveal lives in the panel root** (`useRevealedSecret`, never in a tab body): an unobserved `gcTime: 0` query is dropped at once. Reveal is keyed on `(kind, context, namespace, name)` and persists across the tabs of one open panel. Values render only while `revealed`; data in the cache never implies display. The Secret YAML tab shows a placeholder until Reveal and its raw and neat queries are disabled until then. The guided editor and Compare are separate reads and never set `revealed`. Reveal is disabled only on an explicit `allowed: false` from the `get secrets` access check (`secretGetCheck`); it fails open like every other gate.
- The `QueryClient` in `App.tsx` sets `defaultOptions.mutations.gcTime: 0`, so preview results (`preview_resource_yaml`, `preview_yaml_documents`, `preview_helm_upgrade`) and write variables (YAML text, `stringData`) do not stay in the MutationCache after their dialog unmounts.
- Every diff and preview of a Secret masks `data.*` / `stringData.*`, their parent rows (`data`, `stringData`, `metadata`, `metadata.annotations` and the document root, so a whole-object added or removed row never prints values) and the `kubectl.kubernetes.io/last-applied-configuration` annotation with one rule (`isSecretMaskedPath` / `maskSecretValue` in `diffRows.ts`). Merge from file reuses it: `previewRows(..., maskSecret)` masks both `from` and `to` of a Secret document after the row state has been computed on the real values, so changed/unchanged stays true. The Helm gate says "Secret values in the rendered manifest are hidden."
- **Option A (the backend strips values unless `reveal`) is rejected for v1.4.1** and logged in `open-items.md`: `get_resource_json` / `get_resource_yaml` are the base the guided editor diffs and the YAML tab replaces with (a stripped base wipes the Secret), and Compare / the merge preview compute their states from the values.
- Search and the command palette read names only. ArgoCD repo Secrets and Helm release Secrets are read backend-side and ship no values.
- **The YAML find (v2.3.1, `YamlFind.tsx`) adds no reader.** It searches only the string its view renders (the YAML tab after Reveal, the edit buffer, or the shown Helm text), is keyed on object identity so Hide, a selection change and a panel close reset it, and never persists, sends or announces its query. No paths-table row. See `ui.md` → YAML find (v2.3.1).

**Paths table: every command that can put Secret-derived text in the webview. Add a row before adding a reader.**

| Command (`sec`) | Reaches the webview as | Control |
|---|---|---|
| `list_secrets` | keys + sizes | no values |
| `get_resource_map` | Secret names only (no data, no type) | Secrets are listed with `list_metadata` and the `type!=kubernetes.io/service-account-token,type!=helm.sh/release.v1` field selector; `map.rs` keeps names. A forbidden list goes to `skipped` and drops only the `uses-secret` edges |
| `get_resource_json` | whole object | explicit action only (Reveal, guided editor, Field managers, Compare); `secretReadOptions`; `forgetSecret`; Compare drops its two keys on unmount |
| `get_resource_yaml`, `get_resource_yaml_neat` | whole object as YAML | YAML tab, enabled only after Reveal; same options |
| `preview_resource_yaml`, `preview_yaml_documents` | `live` and `result` | masked by `diffRows`; mutation `gcTime: 0` |
| `get_resource_metadata` | annotations + labels | Rust replaces the last-applied value with `<redacted>`, key kept (`mask_last_applied`, `extras.rs`) |
| `preview_helm_upgrade` | `rendered_manifest`, values | Rust masks Secret `data`/`stringData` in the manifest (`mask_rendered_secrets`, `helm.rs`); `current_values` is the unredacted `helm get values -o json`: the Rust side does not redact it, the gate is the UI (the upgrade editor is reachable only after Reveal) and the dialog's mutation (`gcTime: 0`) |
| `install_helm_release` dry run | one string | success returns a fixed line, never helm's output (`install_output`); errors unchanged |
| `get_helm_values` | values YAML | redacted unless `reveal: Some(true)`; see `helm.md` |
| `get_tls_certificate_info` | `tls.crt` / `ca.crt` fields | parsed backend-side; `tls.key` never read |

## Shared diff rows (v1.3.1)

**One** helper, **one** renderer. Never add a second.

- `src/utils/diffRows.ts` (pure, tested): `DiffRow { path, state, from, to, masked?, inside? }`, `state` ∈ `added | removed | changed | replaced | unchanged | dropped`. `diffObjects(left, right, opts)`; arrays are leaf `replaced`. `insideArray` ("Inside this array") only when every element on both sides has a unique string `name`. Ignore lists `K8S_IGNORED` (status, managedFields, uid, resourceVersion, generation, creationTimestamp) and `COMPARE_IGNORED` (+ name, namespace). Secret `data`/`stringData` masked `••••••••` + byte count; Helm keys matching `password|secret|token|key|credential` masked. Cap `MAX_CHANGED_ROWS` = 200.
- `src/components/DiffRows.tsx` renders every consumer (YAML Save, Helm values, rollout diff, compare, Merge from file): glyph + word + role, unchanged rows collapsed per parent, `⌥↓` / `⌥↑` stepping.
- `mergePreview.ts` maps onto `DiffRow` but keeps its own state names and never emits `removed`.

## kubectl equivalents (v1.3.1)

Slot 6 of every write dialog (`kubectlEquivalent` prop, `KubectlEquivalent.tsx`); builders in `src/utils/kubectlEquiv.ts`. Text only, no shell-out; footer "Equivalent, not identical".

- Builders return argv lists; quoting happens at render (`quotePosix`, `quotePowerShell` for PowerShell 5.1). Always `--context`; `-n` for namespaced kinds.
- **No Secret value ever appears**: values become `<redacted>` (keys and `null` removals kept). The patch body is built **separately** from the Patch tab text (which shows `stringData` in clear). Never reuse the Patch tab text.
- `--cascade=` only for `CASCADE_KINDS` (deploy, sts, ds, jobs, rs, cron). **ArgoCD delete never shows `--cascade`**; "keep resources" renders two commands (merge patch `metadata.finalizers: []`, then delete) with a clears-every-finalizer footnote.
- ArgoCD sync/rollback render the real merge patch (`syncStrategy.hook.force`; rollback uses a placeholder source). Helm renders the real `helm` command. Trigger CronJob keeps `<job-name>`. Create is `kubectl create -f`.
- Merge from file: `mergeFromFileEquiv` returns a note, never `kubectl apply`.
- Contexts outside the default kubeconfig add a `--kubeconfig <file>` footnote (`kubeconfigFootnote`: `KubeContext.source` vs the `"default"` entry of `list_kubeconfigs`).
- `truncateForDisplay` shortens display only; copy text is complete.

## Rollout diff (v1.3.1)

`RevisionInfo.template` (`workload_actions.rs`) = the ReplicaSet `spec.template` JSON with `pod-template-hash` stripped by `strip_pod_template_hash` (same as rollback), `null` when absent (`revision_template`, tested). Frontend: `RolloutHistory`, `RolloutDiffBody` (`WorkloadActions.tsx`), `utils/rolloutDiff.ts`.

- Rollback confirm is `lg`, **non-destructive**, diffing the current Deployment template (`get_resource_json("deploy")`, hash stripped) against the revision. **The diff informs, never gates**: a failed read shows a notice; rollback stays available.
- Each history row has a read-only **Compare** with a "Roll back to this revision…" link. Read-only mode disables Rollback and the link; Compare stays (no kubectl equivalent, no guardrail).
- Rollback restores the pod template only.
- `rollback_deployment` strips `pod-template-hash` before the merge patch (`kubectl rollout undo` parity; otherwise a duplicate ReplicaSet appears).
