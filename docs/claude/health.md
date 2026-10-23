# Health (v1.4.0, extended v1.4.1)

Health sidebar section (first): **Problems**, **Node capacity**, **Possibly unused** and **Deprecated APIs** (the last two are v1.4.1), plus **Map** (v2.2.0, last), plus the "Why is this unhealthy?" card, Constraints, right-sizing hints, CRD view states. **All read-only**: no Health command writes to a cluster. Contract: `docs/impl/v1.4.0-tasks.md` (Addendum wins over §2), and `docs/impl/v1.4.1-tasks.md` for the two new pages; UX: `docs/ux/04-health-capacity-rbac.md`.

## Where it lives

| Piece | Backend | Frontend |
|---|---|---|
| API presence | `presence.rs` `list_api_presence` | `useApiPresence`, `utils/viewState.ts`, `ViewState.tsx` |
| Problems | `problems.rs` `list_problems` | `useProblems`, `utils/problems.ts`, `health/ProblemsPage.tsx`, `FindingRow.tsx`, `ExplainCard.tsx` |
| Possibly unused | `unused.rs` `list_possibly_unused` | `usePossiblyUnused`, `utils/unused.ts`, `health/UnusedPage.tsx` |
| Deprecated APIs | `deprecations.rs` `scan_deprecated_apis`, `src-tauri/data/deprecated-apis.json` | `useDeprecatedApis`, `utils/deprecations.ts`, `health/DeprecatedApisPage.tsx` |
| Node capacity | `capacity.rs` `list_node_capacity` | `useNodeCapacity`, `utils/capacity.ts`, `health/NodeCapacityPage.tsx`, `NodeStrip.tsx` overlay |
| Right-sizing | `PodUsage.containers` (`pods.rs`) | `utils/rightSizing.ts`, `SizingHint.tsx`, `usePodMetricsHistory` |
| Constraints | `pdb.rs`, `admission.rs`, `Pod.priority_class` | `utils/constraints.ts`, `ConstraintsSection.tsx` |
| Node columns | none | `utils/nodeLabels.ts` (Pool, Zone, Instance type; hidden by default) |
| Map (v2.2.0) | `map.rs` `get_resource_map`, `netpol.rs` `get_network_policy_model` | `useResourceMap`, `useNetworkPolicyModel`, `utils/resourceMap.ts`, `health/MapPage.tsx`, `NetpolView.tsx`. See `ui.md` → Resource map and NetworkPolicy view |

Health pages are `mainView`/`healthPage` values, **not** `ResourceType`. Keys live in `HEALTH_QUERY_KEY` (`resourceQueryKey.ts`), outside `RESOURCE_QUERY_KEY`; no per-kind table gains a row. TopBar refresh invalidates the active page's key. Problems, Possibly unused, Deprecated APIs and the Map page (with its Network policies mode) share `health/HealthShell.tsx` (header, state blocks, filter cards, groups, partial strip, `Segmented`, `useRefocus`); Node capacity does not. The three finding pages also share `FindingRow` (optional `meta`, `evidenceNode`, `onOpen`). `useRefocus` is a do-not-simplify rule: when the control a keyboard user just used unmounts (a kind chip, a too-many block, a mode switch), focus moves to a preferred control or the page heading instead of falling to `<body>`. Each page mounts hidden, queries only while visible, and never polls. The Map page follows the same rules (hidden mount, on demand, `staleTime` 30 s, no interval, `retry: false`, TopBar refresh invalidates `["resource-map", ctx]`) and has its own skipped-source copy (`SKIPPED_COPY` in `resourceMap.ts`: a forbidden list is named with what it costs, never an empty map; `mapState` never says "nothing" while a source was skipped).

## API presence (`list_api_presence`)

- One discovery call per group, concurrent. `MissingApiGroup` or resource not served = `absent`; other errors = `unknown` + verbatim message. **Never `Err` for one group**; `Err` only for client construction. Keys and pure `presence_state` in `presence.rs`.
- `viewState.ts`: `absent` + empty list = **Not installed**; list 403 = **No access**; empty list = **Nothing here** (subtitle "couldn't confirm" when `unknown`); other errors = **Error**. A non-empty list outranks `absent`. Presence loading + empty list keeps the skeleton (no Nothing-here flash). Failed presence query = `unknown`.
- The CRD list commands keep their signatures and 404-to-empty arms.

## Problems (`list_problems`)

- **Deterministic Rust rules, one pure tested function each** (`problems.rs`): `crashloop`, `oom-killed`, `image-pull`, `init-failing`, `unschedulable`, `workload-unavailable`, `job-failed`, `service-no-endpoints`, `pvc-pending`, `node-not-ready`, `missing-probes`. The frontend adds only the two certificate rules.
- **Scope = namespace picker.** `None`, `""`, `"all"` = cluster-wide. `node-not-ready` runs only cluster-wide (nodes not fetched otherwise).
- **Failed source → `skipped`, never `Err`.** Rules needing it do not run. Closed `SkippedSource.source` set: `pods`, `deployments`, `statefulsets`, `daemonsets`, `jobs`, `services`, `endpointslices`, `persistentvolumeclaims`, `events`, `nodes`, `certificates`, `secrets` (TS `ProblemSource`).
- **Events are evidence only**; skipped `events` blocks no rule. Evidence matches `involvedObject.kind` **and** name (and namespace), never name alone; truncated at 500 chars on a char boundary. The page always shows the events-TTL honesty line once loaded (empty state too); the explain card shows it when any evidence is an event.
- Certificates 404 = cert-manager not installed, not a skip.
- `missing-probes` reads Deployment/StatefulSet **templates**: one `info` per (workload, container) without a readiness probe; skips `replicas: 0`.
- **No Secret data leaves the backend.** TLS Secrets (field selector `type=kubernetes.io/tls`) go through the panic-free `tls_cert.rs` parser, `tls.crt` only; only `not_after` / `not_before` return (`CertExpiryFact`). `tls.key` never read. `grep -n "\.data" src-tauri/src/commands/problems.rs` shows Secret data only as parser input. No `unwrap`/`expect`/indexing.
- **One expiry rule, frontend.** Backend returns facts, never a cert severity. `certFindings` (`problems.ts`) emits a finding only when `expiryState(...)` is `text-bad`: `cert-expired` (critical) or `cert-expiring` (warning). Frontend-only rules (`UiRule`).
- **Explain card + header chip** use `list_problems` scoped to the **object's own namespace**, enabled only while a covered panel is open. Covered kinds (pods, deploy, sts, ds, jobs, svc, pvc) and relevant skipped sources derive from the one `RULES` table (`problems.ts`, keyed by `ProblemRule`). Other kinds get no card/chip (safe default, not a silent table). Partial/unavailable lines name only sources feeding that kind's rules, plus `events` for pods and PVCs.
- Findings navigate only; no writes. `ClusterOverview`'s "Problem pods" card links to Problems.

## Node capacity (`list_node_capacity`)

- One small row per node. Pods listed cluster-wide with `status.phase!=Succeeded,status.phase!=Failed` (terminal also skipped defensively); no node / unknown node skipped. Errors: `Err("Failed to list pods: …")` / `Err("Failed to list nodes: …")`; 403 (`isForbidden`) = **No access**, else Error + Retry. Metrics via graceful `fetch_node_metrics`.
- **Effective requests/limits follow upstream** `PodRequests` / `PodLimits` (what `kubectl describe node` sums): per resource `max(sum(app) + sum(native sidecars), peak init)`; sidecar = init container with `restartPolicy: Always`; a plain init container counts with the sidecars started before it. Overhead added to requests, and to a limit **only where that aggregated limit is non-zero**. Pure, tested: `pod_effective_requests`, `aggregate_by_node`.
- Memory summed in **bytes**, converted to MiB once per node.
- Limits over 100% shown, never clamped. Everything is a share of **allocatable**. One threshold pair (65% / 85%) for all capacity bars (`capacity.ts`).

## One memory parser

`utils::parse_mem_bytes`: full Quantity grammar (binary `Ki`-`Ei`, decimal `k`-`E` and `m`, plain bytes, exponents, decimal mantissas); `None` for garbage, negative, non-finite, overflow; never slices bytes. `parse_mem_mib` is its floor wrapper. Used by `pods.rs`, `workloads.rs`, `nodes.rs`, `capacity.rs`; no other memory parser. CPU parsers are still three (`open-items.md`).

## Right-sizing (a hint, not a recommendation)

- Input: the 20-sample metrics history, per container (`PodUsage.containers`, Rust `PodContainerUsage`; `ContainerUsage` is `get_pod_metrics`'s). `list_pod_metrics` still swallows errors (knowingly kept).
- Thresholds: `RIGHT_SIZING` (`rightSizing.ts`). **Under `minSamples` = no hint** ("collecting"). Compares usage to the container's **own** request/limit, never suggests a value, always says "Based on current usage only." Samples come from this app session, not cluster history. Buffers keyed by namespace.
- **24 h p95 path (v2.3.0).** With a Prometheus target configured, the Containers tab (`DetailPanel.tsx`) reads the 24 h `pod-cpu` / `pod-mem` series (the same `useMetricRange` cache entry as the Metrics tab's 24 h chart) and `p95Hints` (`rightSizing.ts`) takes the nearest-rank 95th percentile per container (`percentile`), still against the container's **own** request/limit only. Coverage rule: a resource needs `P95_MIN_POINTS` (216 of the 288 five-minute points) and a non-placeholder result, otherwise it has no p95. `p95Hints` returns `null` when neither resource is covered (the session path runs unchanged) and `{ hints, covered }` otherwise. When only one resource is covered, `withSessionFallback` adds the session hint of the other one, only when the session result is ready (never a "Collecting" line). p95 hints say "95th percentile" and end with `P95_TAIL` ("Based on the 95th percentile over 24 hours."); session hints keep "Based on current usage only." A usable p95 **yields over the metrics-absent line** ("Hints need metrics-server…"), because the percentile does not need metrics-server. A failed or empty Prometheus query is silent here: the session hint shows.

## Constraints (a hint, not a verdict)

- Summary tab for pods and `CONSTRAINT_TARGETS` workload kinds (`constraints.ts`); other kinds get none (safe default). Inputs reuse `rq`, `lr`, `pdb`, `pc`, `mwc`, `vwc` hooks; rows render as data arrives.
- **Applies:** ResourceQuota, LimitRange, PriorityClass, PDB with plain `match_labels`. **May apply:** PDB with `match_expressions`, PDB with a label-less selector (`pdbRows`), and **every webhook** (never "applies").
- `webhookMatches` on `(group, plural)`: group or `*`; resource or `*` / `*/*` (subresource-only rules do not match); scope `*` or `Namespaced`; operations do not filter. Backend: `PdbRow.match_labels` / `has_match_expressions`, `WebhookConfigRow.matches` (one `WebhookMatch` per rule; empty selector = none), `Pod.priority_class`.

## Node pool, zone, instance type

`nodeLabels.ts` reads a label precedence per column, reusing `multiPods.ts`'s zone helper. Hidden by default (`defaultHidden`); missing label = dash.

## Copy rules

"Hint" for right-sizing, "may apply" for webhooks, the events-TTL line for Problems. No score, no grade, no "smart", no "auto-fix".

## Node percentages

`list_nodes` `cpu_percent` / `mem_percent` divide by `status.allocatable` (the `kubectl top node` default), `None` when absent. See Node Metrics in `pods-logs.md`.

## Possibly unused (`list_possibly_unused`, v1.4.1)

Read-only hints: every label says "possibly", and the page says what the check cannot see (dynamic references, consumers outside the cluster). There is **no checkbox, no select-all and no delete**; the only action is Open.

- **Kinds and reasons** (closed set): ConfigMaps and Secrets `not-referenced`; PVCs `not-mounted` (Bound only); PVs `unbound` (Available or Released); Roles and ClusterRoles `no-binding`; ServiceAccounts `no-pods`; Deployments and StatefulSets `zero-replicas`.
- **References scanned:**
  - in pods, in Deployment, StatefulSet, DaemonSet, ReplicaSet and Job templates, and in CronJob job templates: volumes (`configMap`, `secret`, `projected.sources[]`, `persistentVolumeClaim`, `csi.nodePublishSecretRef`), `env[].valueFrom`, `envFrom` and `imagePullSecrets`, init and ephemeral containers included;
  - Ingress `tls`; ServiceAccount `secrets` and `imagePullSecrets`; Gateway listener `certificateRefs`; cert-manager Certificate `secretName`.
  - A pod's ServiceAccount counts as used (`default` when unset).
- **Always excluded:**
  - Secrets of type `kubernetes.io/service-account-token` or `helm.sh/release.v1`, and Secrets labelled `owner=helm` or `argocd.argoproj.io/secret-type`;
  - the ConfigMap `kube-root-ca.crt` and the `default` ServiceAccount;
  - `system:*` Roles and ClusterRoles, ClusterRoles with an `rbac.authorization.k8s.io/aggregate-to-*` label, and ClusterRoles labelled `kubernetes.io/bootstrapping=rbac-defaults` (the built-in `admin`, `edit`, `view`, `cluster-admin`);
  - PVCs owned by a Pod (generic ephemeral volumes).
- **Required sources:**
  - A kind is emitted only when its own list and every reference source it needs were read. `Inputs` fields are `Option<Vec<_>>`, with `None` meaning skipped. `REQUIRED_SOURCES` in `utils/unused.ts` is the same table.
  - Workloads means deployments, statefulsets, daemonsets, replicasets, jobs and cronjobs.
  - A failed source goes to `skipped`. The kinds that need it are **unchecked** and named (`uncheckedKinds`), while checked kinds still list.
  - The page shows No access only when every kind in scope is unchecked and nothing came back.
  - A 404 on gateways or certificates means not installed and is never a skip.
- **Scope:**
  - `namespace: None` or `"all"` is cluster-wide and adds PVs and ClusterRoles. A picked namespace lists namespaced kinds only.
  - Under "all", the system namespaces (`excluded_namespaces`: `kube-system`, `kube-public`, `kube-node-lease`) are excluded **as candidates only**. They are still read as references, so a ClusterRole bound only from `kube-system` is not listed.
  - The scope line prints `excluded_namespaces` from the payload. Rows are keyed `kind/namespace/name`.
- **No Secret value is inspected, returned or kept.** Secrets become `SecretFacts` (namespace, name, type, labels) as soon as they are listed. The typed `Api<Secret>` list uses the field selector `type!=kubernetes.io/service-account-token,type!=helm.sh/release.v1`, with `secret_excluded` as the backstop. The remaining values still pass through backend memory briefly, as with `list_problems`' TLS read.
- Skipped ids (`UnusedSource`): `pods`, `deployments`, `statefulsets`, `daemonsets`, `replicasets`, `jobs`, `cronjobs`, `ingresses`, `gateways`, `certificates`, `serviceaccounts`, `configmaps`, `secrets`, `persistentvolumeclaims`, `persistentvolumes`, `roles`, `clusterroles`, `rolebindings`, `clusterrolebindings`.
- On demand: `staleTime` 60 s, no interval.

## Deprecated APIs (`scan_deprecated_apis`, v1.4.1)

- **The table is data:** `src-tauri/data/deprecated-apis.json`, loaded with `include_str!` and `serde_json`.
  - A parse failure is `Err("Failed to load deprecation table: {e}")`, never a panic.
  - The header reads "Table covers Kubernetes up to {covers_up_to}".
  - It lists removals only: no Event, no review kinds, no core group.
  - It is a hint, not a verdict. The page never says "clean", and it states what is scanned: Helm release manifests and `kubectl.kubernetes.io/last-applied-configuration` annotations only.
- **Helm:**
  - Secrets labelled `owner=helm,status=deployed` go through `decode_helm_release`, then the hang-safe `split_yaml_documents` loop.
  - Only `apiVersion`, `kind` and `metadata.name/namespace` are read. **The decoded release never leaves the backend.**
  - Cost grows with the number of deployed releases.
  - A release that fails to decode or parse is a `helm-releases` skip with reason `<ns>/<release>: <error>`. Nothing after a malformed document is read.
- **last-applied:**
  - Each table kind with a served version is listed through discovery, using the replacement version when it is served. Only the annotation's `apiVersion` is read.
  - A failed kind is one `last-applied` skip with reason `<plural>.<group>: <error>`.
  - A picked namespace skips cluster-scoped kinds.
- **Status comes from discovery, not version arithmetic:**
  - `served_by_this_server`: `false` is Removed; `true` with `removed_in` is Deprecated; `true` without it is Deprecated plus "No removal is planned."
  - `server_version` is the discovery `gitVersion` verbatim, or `""` if the call fails.
  - `parseMinor` only drives the "cluster is newer than the table" note, which is hidden if either version does not parse.
  - A discovery failure is `Err("Failed to read API discovery: {e}")`. A missing group is simply not served.
- **Findings:**
  - They carry `helm_release` and `helm_release_namespace`, which are Some for `source: "helm"`. `namespace` is the object's own.
  - The React key is derived in the frontend.
  - Open on a Helm finding opens the release. Open on a last-applied finding opens the object when `KIND_TO_RESOURCE_TYPE` maps its kind; otherwise there is no Open.
- **Page state:**
  - Zero findings with any skip is the partial state ("nothing found, but some sources could not be read").
  - There is **no No-access state**: a view-only account is denied Helm Secrets and some kinds yet still reads others.
  - The skip word comes from the reason as is first, then from the text after a `<ns>/<release>:` or `<plural>.<group>:` prefix.
- Skipped ids (`DeprecationSource`): `helm-releases`, `last-applied`. On demand: `staleTime` 5 min, no interval.
- The table (43 entries) was reviewed at the v1.4.1 release check (B-24, no wrong row found). It has not been compared line by line with the published deprecation guide; see `open-items.md`.
