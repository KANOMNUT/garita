# Cluster auth, kubeconfig, trust, RBAC gating

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Cluster Auth

kube-rs handles auth natively. Exec plugins must be on `PATH` at launch:

| Provider | Plugin | Install |
|----------|--------|---------|
| GKE | `gke-gcloud-auth-plugin` | `gcloud components install gke-gcloud-auth-plugin` |
| EKS | `aws-iam-authenticator` or `aws` CLI v2 | `brew install aws-iam-authenticator` / AWS pkg |
| AKS | `kubelogin` | `brew install Azure/kubelogin/kubelogin` |
| OIDC | `kubelogin` or provider plugin | varies |

`fix_path()` (startup, all kube-rs calls) and `helm_path()` (each helm call) prepend these dirs, so launches from Finder/Spotlight work. GKE service accounts: set `GOOGLE_APPLICATION_CREDENTIALS`.

**kube-rs 0.95 runs exec plugins lazily, on the first request.** A built client proves nothing; a missing plugin surfaces as `kube::Error::Auth` from the first call.

Garita reads the union of the default kubeconfig and in-app registered files, and **never writes to any of them**. `helm_run` gets the same union via `KUBECONFIG`.

## Kubeconfig Lifecycle (v1.2.0)

Contract: `docs/plan-kubeconfig-and-parity.md` §1.

**Never merge an imported kubeconfig into `~/.kube/config`. The user's file is read-only to us.** An app-local registry at `<app_config_dir>/kubeconfigs.json` lists paths; `load_merged_kubeconfig()` unions default + enabled entries **at read time**.

`remove_kubeconfig` **de-registers only; it never deletes a file**, ours or the user's.

### De-anchoring

`switch_context`, `set_current_context_in_yaml` and `kubeconfig_path()` were deleted: they rewrote `current-context:` in the user's kubeconfig (wrong file with multi-entry `$KUBECONFIG`, broke CRLF). The write was never needed: every command takes `context` first and `client_for_context()` resolves it.

- Active context is app-local: `useActiveContext` + `localStorage["active-context"]`. Resolution, re-run whenever the enabled set changes: stored value *if in `list_contexts()`* → `get_current_context()` *if present* → first available → `""`.
- Cost: users who relied on Garita to change their kubectl default run `kubectl config use-context <name>`. The switcher shows that command as copyable text (no shell-out).
- `get_current_context` is read-only; it only seeds the active context.
- `KubeContext.is_kubeconfig_default` (renamed from `is_current`) means "your kubectl default", **not** "active in Garita".

### Merge semantics: first wins, per name, per section

`Kubeconfig::merge` keeps the first entry by name (kubectl-compatible); order is default, then registration order. **It runs separately over `clusters`, `auth_infos`, `contexts`**: a context can come from file A and its cluster from file B. So `KubeContext.source` is where the **context entry** came from; UI says "context defined in", never "cluster from". Losers appear in `shadowed_sources`. A unit test in `kubeconfig.rs` locks first-wins.

**The enabled set is the only set.** `list_contexts` shows the enabled union only; a disabled file adds no contexts and no `shadowed_sources`. `list_kubeconfigs` lists disabled files too, read pre-merge (for the toggle UI). Their sets differ on purpose.

### Paste vs file import

`Kubeconfig::read_from(path)` makes relative `certificate-authority`, `client-certificate`, `client-key`, `token_file` absolute against the file's directory. Pasted YAML has no base directory.

**Paste path only:** reject a relative value in any of those four fields, naming the field and context. Absolute paths and inline `*-data` are fine. `exec.command` is exempt (`resolve_command()` in `utils.rs`). **Both `preview_kubeconfig_yaml` and `add_kubeconfig_yaml` validate**; never trust the preview alone.

### Other frozen rules

- Four commands (path/yaml × preview/add), not one with `Option` unions.
- `preview_*` never writes or mutates the registry. A preview from input text is cleared when the text changes.
- **Identifier migration (v2.0.0).** The bundle identifier changed from `com.watchtower.app` to `io.github.kanomnut.garita`, which moves `app_config_dir`. `commands/migrate.rs` runs first in `.setup()` (before `init_config_dir`): if the new `kubeconfigs.json` is absent and the legacy sibling dir has one, it copies `kubeconfigs/*.yaml` and `diagnostics.json`, rebases `path` for `app_owned: true` entries under the legacy dir, leaves `app_owned: false` entries verbatim, and writes the registry last. It never modifies the legacy dir, swallows failures, and calls `invalidate_client_cache()` on success. `detect_legacy_install` reports whether the legacy dir exists. The log and journal are not migrated.
- `add_kubeconfig_yaml` writes `<app_config_dir>/kubeconfigs/<sanitised-name>.yaml` with **mode 0600 on unix**.
- `set_kubeconfig_enabled` on `"default"` is a no-op `Ok(())`; default is always in the union.
- **Every registry mutation calls `invalidate_client_cache()`**, else the cached client serves the previous cluster.
- `init_config_dir(app.handle())` runs in `.setup(…)` (`lib.rs::run()`), because `client_for_context()` has no `AppHandle`.
- The file picker needs `"dialog:allow-open"` in `capabilities/default.json`.
- `client_for_context()` is on every command's path: suspect it first for auth regressions.

## Proxy URL (v2.1.2, #50)

The `proxy-url` of the cluster entry a context references, and nothing else, decides whether a kube-rs call goes through a proxy. `client_for_context` (the only client construction site) sets `config.proxy_url` from `effective_proxy(proxy_url_for_context(..))`.

| proxy-url | Result |
|---|---|
| `http://host:port` | Supported. Userinfo, if present, is sent as Basic on the CONNECT (not percent-decoded). |
| `socks5://`, `socks5h://` | Supported; `socks5h` is rewritten to `socks5` (kube resolves DNS at the proxy either way). No credentials. |
| `socks5(h)://` with userinfo | Refused: `SOCKS5 proxies with a user name and password aren't supported yet. Remove them from the proxy-url, or use an http proxy.` |
| `https://` or any other scheme | Refused: `This proxy type isn't supported: {scheme}. Supported types: http, socks5.` |
| no scheme, no host, unparsable | Refused: `The proxy-url in your kubeconfig isn't a valid URL. Use http://host:port or socks5://host:port.` |

Fail closed (T51-8): kube 0.95 silently ignores forms it cannot honour, which would send traffic where the user said it must not go. The messages name the scheme at most, never the host or userinfo.

- **Env proxies (T51-7):** Garita's own cluster connections (kube-rs) ignore proxy environment variables: `HTTP_PROXY`, `HTTPS_PROXY` and the lowercase forms are overwritten by the cluster entry's value (or none), and `NO_PROXY` is not read by kube 0.95. **Helm differs:** `helm_output` inherits the environment, so client-go keeps honouring `HTTP(S)_PROXY` / `NO_PROXY` when the cluster entry has no `proxy-url`. Known edge (open item): an env proxy value `http::Uri` cannot parse still fails inside `from_custom_kubeconfig` before the override.
- **Provenance:** `KubeContext.proxy` is `display_proxy` of the raw value: `scheme://host[:port]`, with userinfo, path and query dropped. `display_proxy` (and `effective_proxy`, with the invalid-URL message) rejects a URL whose userinfo contains `/`, `?` or `#`, and a port that is not a valid u16. `ClusterAccess.via_proxy` is true when the context's cluster entry has a non-empty proxy-url (computed in `classify_cluster_access`).
- **Where userinfo can and cannot appear:** the raw proxy-url is read only by `proxy_for_cluster` / `proxy_url_for_context` (grep) and handed to `display_proxy` and `effective_proxy`; no command returns it. `app_log::scrub` redacts URL userinfo (`scheme://<redacted>@host`; userinfo runs to the LAST `@` before whitespace or end of input, so over-redaction such as `oci://<redacted>@sha256:` is accepted). It is applied to every app-log line (`app_log::log`), to `ClusterAccess.message` on every state, and to Helm error text (`helm_run`'s `Err` and the preview stderr in `helm.rs`). Other commands' errors are not scrubbed: the proxy crates do not format the URI and the refusal messages above never include it.
- **Scrub limits (accepted):** userinfo stops at whitespace, so a password with a space keeps its head in Helm text (Go rejects that URL and client-go echoes it; the kube path refuses it without echoing). On compact JSON the last-`@` rule swallows neighbouring fields (`"url":"https://<redacted>@e.com"`).
- **Wart (T51-3):** a refused proxy-url fails the client build, so `check_cluster_access` classifies it as `auth` (the message is the text above). The state set is frozen.
- **Helm** is untouched: `helm_run` sets `KUBECONFIG` and client-go reads `proxy-url` itself (observed live, `live::proxy::helm_list_through_http_proxy`).
- **Unverified:** a plain `http://` API server behind an HTTP proxy (kube adds no proxy headers to non-tunnelled requests).
- Observed live through squid and a SOCKS5 server by the harness (`live-verification.md`).

## Cluster Trust States (v1.2.0)

`check_cluster_access(context) -> ClusterAccess { state, message, server_version, via_proxy }`, `state` ∈ `ok` / `unreachable` / `auth` / `forbidden` / `unknown`.

**Returns `Ok` for failures; the state is the payload.** `Err` only when structurally broken (context undefined).

Classification on `Client::apiserver_version()`: `client_for_context()` fails → `auth`; `Ok` → `ok` + version; `Api(ae)` 401 → `auth`, 403 → `forbidden`; connect/DNS/TLS/timeout → `unreachable`; else `unknown`. A missing exec plugin arrives as `kube::Error::Auth` from `apiserver_version()`, not `Error::Api` (the plan's §2.1 table is wrong here; trust the code).

`friendly_auth_error(msg) -> Option<String>` (`utils.rs`) is the one provider-hint bank, shared with `friendly_helm_error` (which still returns a `String` ending `\n---\n{msg}`).

Frontend: `useClusterAccess(context)` shows a dismissible banner when `state !== "ok"` (coloured per state; a genuine query error is muted, never red). `server_version` also feeds the debug-container capability rule. Non-`ok` states log a scrubbed `warn` line.

## Permission Gating — `can_i` (v1.2.0)

`can_i(context, checks: Vec<AccessCheck>) -> Vec<AccessResult>`: one batched `SelfSubjectAccessReview` command, input order, `join_all`. `AccessCheck.subresource` is `Option` with `serde(default)`.

- **Check per `(verb, resource, namespace)`, never per object** (a per-row check on a 200-row table is 200 requests).
- **FAIL OPEN, not negotiable.** Only explicit `allowed: false` disables. Missing `RBAC_RESOURCE` entry, query error, no data: enabled. A cluster where SSAR does not answer must not render a fully-disabled UI.
- **SSAR answers RBAC only**; admission webhooks (Kyverno/OPA/Gatekeeper) can still deny. Greying out is a hint. **Keep the confirm-and-fail error path**; never drop error handling because "we already checked".
- Denied = **disabled with a reason tooltip, never hidden.** Exception: `GenericResourceTable`'s optional `onDelete` hides the column.
- **Namespace `"all"` fails open:** `usePermissions` returns `ALWAYS_ALLOWED` without a query (a cluster-wide SSAR would deny every namespace-scoped user and hide every delete on first launch). Real gating needs a specific namespace.
- **`services/proxy` hint (v2.3.0).** `ObservabilityDialog` runs one `useAccessChecks` for `get services/proxy` (subresource `proxy`, no `resourceName`) in the namespace the user typed, once it is valid and blurred. It is a hint line only: it fails open like every `can_i` use, and it **never disables Test**, because an unnamed SSAR answers `allowed: false` for a Role scoped by `resourceNames`, which still lets the real call through. Only an explicit `allowed: false` changes the wording (`hintLine`); the Test result is the authority.
- `usePermissions` also returns `canUpdate` (verb `update`, same batched call), gating YAML edit and Save… in both panels ("You don't have permission to update {kind}s in {namespace}."). **Helm Values has no RBAC hint**, by design (Known Open Item).
- `RBAC_RESOURCE` (`useResources.ts`, exported) maps `ResourceType` → `{ group, resource }` in **plural API terms**. Verify plurals against the Rust file that lists the kind: a wrong plural greys out a legal action. Absent on purpose: `helm`, `argo-repos` (not RBAC resources), `ep`/`eps` (never deletable).
- **Secret reveal gate.** Reveal is disabled only on an explicit `allowed: false` from a `get secrets` check (`secretGetCheck`) and fails open; a 403 after the click shows the error. Property and paths table: `writes.md` (Secret values in the webview). ArgoCD repo-credential and Helm release-secret reads (`argocd.rs`, `helm.rs`) are backend-only and return no values.

## Who can and subject permissions (v1.4.1, #32)

Both answer "what do the RBAC bindings say", **not** "what can the current user do": no SSAR, and the page never says "no one can". Fixed always-shown note: "Computed from RBAC bindings. Admission webhooks and non-RBAC authorizers (for example cloud IAM mappings) are not visible here." (`WHO_CAN_NOTE`; Permissions sections use the shorter `NOTE_ALWAYS` in `whoCan.ts`, since `subject_permissions` returns no notes.)

- `who_can(context, verb, group, resource, namespace?, subresource?) -> { grants, notes, skipped }`. `group` is verbatim (`""` = core); the frontend resolves it from `RBAC_RESOURCE`, the CRD list, or free text via `parseResourceInput` (`resource`, `resource.group`, `resource/sub`). No discovery call.
- **Namespace:** `None` (or `""` / `"all"`) = ClusterRoleBindings only (grants valid in every namespace). `Some(ns)` = ClusterRoleBindings plus the RoleBindings and Roles in `ns`. A RoleBinding never grants cluster-scoped resources or non-resource URLs, even through a ClusterRole; the frontend sends `None` for `CLUSTER_SCOPED_KINDS`. `scope` is `cluster` for a ClusterRoleBinding, `namespace` for a RoleBinding.
- **Matching:** pure `rule_matches(rule, verb, group, resource, subresource) -> Option<bool>` (`Some(true)` = via `*`): wildcards in verbs/groups/resources, `resource/sub`, `*/sub` (RBAC has no `resource/*`). `resourceNames` cannot restrict `create` or `deletecollection`, so for those verbs a named rule grants nothing; otherwise it limits the grant (`resource_names` non-empty). Several matching rules in one role: unrestricted if any has no `resourceNames`; `via_wildcard` only if every one used `*`.
- **Notes** (fixed strings): the always-note; an aggregated ClusterRole with no rules ("ClusterRole {name} is aggregated and its rules are not filled in yet; results may be incomplete."); a binding to a missing role ("Binding {name} references {kind} {role}, which does not exist."), **not** emitted when that role kind's list was skipped.
- **Partial = `skipped`** (`problems::SkippedSource`, ids `roles`, `clusterroles`, `rolebindings`, `clusterrolebindings`). A forbidden list goes to `skipped`; `Err` only for client construction. `whoCanState` No access = zero grants and a source the answer depends on was skipped: the binding sources read (ClusterRoleBindings always; RoleBindings with a namespace) or the role sources (`clusterroles`, plus `roles` with a namespace), since an unread role yields no grant and would read as "nobody".
- `subject_permissions(context, subject_kind, name, namespace?) -> RuleGrant[]`: every rule reachable by the subject from all bindings, labelled by binding. `via_group` = the implicit group the binding reaches it through (`None` when named directly, which wins): ServiceAccount ∈ `system:serviceaccounts`, `system:serviceaccounts:<ns>`, `system:authenticated`; User ∈ `system:authenticated`; Group none. RoleBinding grants carry `non_resource_urls: []`. **`Err` if any of its four lists fails** (`Failed to list roles|cluster roles|role bindings|cluster role bindings: {e}`): an unread role must never read as "can do nothing".
- **A ServiceAccount subject without `namespace` in a RoleBinding means the binding's namespace** (Kubernetes `appliesToUser`); `subject_list` and the binding flattening apply it. ClusterRoleBindings have nothing to default to; User/Group never get a namespace.
- `RoleBindingRow` / `ClusterRoleBindingRow` gain `subject_list: RbacSubject[]` (additive; `subjects: string` stays). Role/ClusterRole "Bound to" comes from explicit binding reads (a ClusterRole reads cluster role bindings and role bindings in all namespaces; a failed role-binding list shows a partial line) via pure `boundTo`. A User subject adds "Group memberships come from the identity provider and aren't visible here."
- On demand: `staleTime` 30 s, `retry: false`, no interval. A binding to a Group does not expand its members.
