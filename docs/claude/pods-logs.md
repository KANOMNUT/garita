# Pods, containers, logs, shell, metrics

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Pod Container Status (`containers_status`)

`Pod.containers_status: Vec<ContainerStatus>` (`pods.rs`) comes from `status.containerStatuses` plus `status.initContainerStatuses`. Init container names are **prefixed `init:`**. Fields:

- `name`, `restart_count`
- `current_state` (`running` / `waiting` / `terminated` / `unknown`), `current_started_at`, `current_reason`
- `last_state`, `last_reason` (e.g. `OOMKilled`), `last_exit_code`, `last_signal`, `last_started_at`, `last_finished_at`

TS mirror: `ContainerStatus` in `k8s.ts`. The Containers tab shows a current/last state grid (exit 137 red, ≥1 amber, 0 green) and "Last crash: X ago". `PodTable` shows a restart pill (`↻ N · <reason>`), red for OOM.

## Pod status vocabulary (`podStatus.ts`)

`pod_status` (`pods.rs`) returns `Terminating`, `CrashLoopBackOff`, `ImagePullBackOff`, `Pending` (also for `ContainerCreating`), or the Kubernetes phase (`Running`, `Pending`, `Succeeded`, `Failed`, `Unknown`). `src/utils/podStatus.ts` (`POD_STATUS_STYLE`, `podStatusStyle`) is the one style table, read by the Pods table pill, the Pod panel header pill, and the status dot in a workload's Pods tab and in the Node panel's "Pods on this node" list. **Do not add a per-component status map**: two maps once drifted until a pod in `ImagePullBackOff` was orange in the table and green in the panel.
- A status the table does not know gets the neutral style (`mute`, no pulse), never the green `Running` one. `Unknown` is neutral too. `Failed` is red and steady (only `Pending`, `CrashLoopBackOff`, `ImagePullBackOff` and `Terminating` pulse).
- `PodStatus` (`k8s.ts`) includes `"Failed"`, and the Pods table status filter lists it, so failed pods can be isolated. `podStatus.test.ts` checks that every string `pod_status` can return has a style and that an unknown string is neutral.
- On the Containers tab, a container card's **logs** link sets the Logs tab's container to that card's container (`setLogPick`, the same pick the Logs tab's selector uses) before it opens the tab, as **exec** sets the shell container. Both links are 24 px high targets with a name (`Open logs for <container>`, `Open shell in <container>`). The ENV, MOUNTS and PROBES section headers are a module-level component (`AccordionHeader`): a component declared inside `DetailPanel` would be a new type on every render and keyboard focus would drop to the page on each toggle. They expose `aria-expanded` and `aria-controls`.

## Workload → Pods

`list_workload_pods(context, namespace, kind, name) -> Vec<Pod>` (`workload_pods.rs`) resolves ownership through `ownerReferences` UIDs:

| `kind` | Resolution |
|--------|------------|
| `deploy` | Deployment → ReplicaSets → Pods |
| `cron` | CronJob → Jobs → Pods |
| `sts` / `ds` / `jobs` / `rs` | direct → Pods |

0 replicas returns an empty `Vec`; an unknown `kind` returns `Err`. Hook: `useWorkloadPods(context, namespace, kind, name, enabled)`, 15 s `refetchInterval`. `tabsFor()` adds a Pods tab after Overview for workload kinds (`WorkloadPodsTab`, rows navigate via `onNavigate`).

## Bulk Pod Operations

`PodTable` multi-select (checkboxes, tri-state header, shift-click range) with a sticky action bar: Delete, Restart, Copy names, Copy YAML, Export logs.

- The bulk dialog `ConfirmBulkModal` is built on `ConfirmModal` `md`: Esc, focus trap, `⌘↵`, kubectl equivalent, typed guardrail.
- Above **10 pods** the user types the namespace (one namespace) or the cluster label (several namespaces).
- A per-cluster bulk limit (see Read-only mode and guardrails) disables the confirm with a reason.
- `useBulkDeletePods()` runs `delete_pod` through `Promise.allSettled` and returns `{ ok, failed: { name, error }[] }`. A partial result switches the dialog to `phase="result"` and lists failed pods.
- Per-row Delete is disabled while a bulk selection exists. It is a named trash button on the row (`aria-label="Delete pod <name>"`), disabled with a reason (`disabledAttrs`) rather than removed: read-only mode wins (`READ_ONLY_REASON_SHORT`), then "Clear the selection to delete a single pod." Its dialog stays open on a failed delete (see `ui.md` → Confirm-on-Destructive).

## Shell Terminal (xterm.js)

`ShellTerminal.tsx` uses `@xterm/xterm ^6` + `@xterm/addon-fit ^0.11`.

- `import "@xterm/xterm/css/xterm.css"` **must** be a static top-level import. Without it `fitAddon.fit()` measures zero and the terminal renders garbage.
- Pass `initialCols` / `initialRows` to `start_shell_session` right after `fitAddon.fit()`. Rust sends it as the first `TerminalSize` before the resize loop, so `sh` never starts at width 0 (`$$$$` prompt spam).
- Guard `resize_shell` against zero size: frontend falls back to 80×24, backend skips `try_send` at 0.
- `terminal_size()` returns a `futures::channel::mpsc::Sender` (kube-rs 0.95): use `try_send`, not `.send().await`.

`start_shell_session` (`shell.rs`):

- **`mode: Option<String>`**: absent or `"exec"` runs `sh` via exec; `"attach"` attaches to the main process (debug containers) with the same size handshake. Other values: `Err("Failed to start shell: unknown mode '…'")`, checked before connecting. Errors read `Failed to start shell: …` (exec) or `Failed to attach: …` (attach).
- **Client-supplied `session_id: Option<String>`** (invoke key `sessionId`), from `newSessionId()` (`utils/sessionId.ts`: `crypto.randomUUID()`, else 32 chars of `[A-Za-z0-9_-]` from `getRandomValues` for WebKit before Safari 15.4). The frontend registers `shell-output-{id}` and `shell-closed-{id}` listeners **before** invoking, because a session can close at once.
  - `Some(id)` must be 1-64 chars of `[A-Za-z0-9_-]`, else `Err("Failed to start shell: invalid session id")`.
  - A duplicate id is detected under the insert lock and returns `Err("Failed to start shell: session id already in use")`. Never overwrite an entry (it orphans its abort handle). The output task waits for a oneshot "go" sent only after a successful insert.
  - `None` generates `{pod}-{millis}` with every `.` replaced by `-` (Tauri event names reject `.`). The call returns the id used.
- **`shell-closed-{id}` carries the real reason.** kube-rs `exec` resolves on WebSocket upgrade; a missing `sh` arrives later as a `Status` on channel 3. The task calls `take_status()` first and, after stdout ends with `Ok(0)`, waits at most 2 s for it. Pure `close_for_status` maps it:
  - `Failure` with reason other than `NonZeroExitCode`: `{reason: "error", message: <status.message verbatim>}`
  - non-zero exit, `Success`, no status, timeout: `{reason: "eof", message: ""}`
  - stdout read error: `{reason: "error", message: <io error>}`
  - Emitted **exactly once**, never after `stop_shell_session` aborts the task. The frontend feeds the message to `isNoShellError` for the "no shell" banner.
- The xterm theme follows the app theme live through a separate effect; the session effect must not depend on it. See `ui.md` Appearance.
- `ShellTerminal.tsx` keeps a `cancelled` flag and stops a session whose start resolves after unmount.
- **Read-only mode blocks shells** behind the single switch `READ_ONLY_BLOCKS_SHELL`. See Read-only mode and guardrails.

## Debug containers (v1.3.1)

Ephemeral container added from the Shell tab's "Debug container…" button. Backend: `pods.rs` (`start_debug_container`, `get_pod`, `build_ephemeral_containers`), `shell.rs` (attach). Frontend: `DebugContainerDialog.tsx`, `ShellTab.tsx`, `useDebugSession.ts`, `utils/debugContainer.ts`.

- **Attach, not exec.** Created with `stdin: true`, `tty: true`, `terminationMessagePolicy: "File"` and **no command** (image entrypoint runs, as `kubectl debug -it`). The frontend then calls `start_shell_session` with `mode: "attach"`. The dialog has no command field.
- **`start_debug_container(context, namespace, pod, name, image, target_container: Option<String>) -> String`** returns the container name. The frontend generates the name (`debugger-` + 5 chars `[a-z0-9]`) to show it before confirm. Pure `build_debug_container_patch` validates first: name is a DNS-1123 label ≤ 63 chars; image non-empty, no whitespace; `targetContainerName` sent only when non-blank. API refusal: `Failed to start debug container: {ae.message}`; the frontend strips that prefix.
- **The one sanctioned strategic merge patch:** `Api::<Pod>::patch_ephemeral_containers(..., &Patch::Strategic(body))` on the `ephemeralcontainers` subresource. SMP merges the array by `name`, so existing debug containers stay; a merge patch would need a get-then-append race. **Never generalise it.** `grep -rn "Patch::Strategic" src-tauri/src` must return exactly one hit.
- **Never in `Pod.containers`.** `Pod.ephemeral_containers: Vec<EphemeralContainerInfo>` (`name`, `image`, `target_container`, `state` = `running` / `waiting` / `terminated` / `pending`, `reason`, `message`, `exit_code`, `started_at`), in spec order, matched by name to `status.ephemeralContainerStatuses`. `pending` = in spec, no status yet. No `init:`-style prefix. The frontend adds `[debug]` entries to the Containers tab and the Logs/Shell selectors (`debugAsContainers`).
- **Status by polling `get_pod`** (`-> Option<Pod>`, 404 = `None`). `useDebugSession` polls every 2 s while the strip shows (`staleTime: 0`, `retry: false`). Freshness: `get_pod` data, then the App pods list row (`podsList` prop), then the click-time snapshot. `running` triggers attach; waiting `ImagePullBackOff` / `ErrImagePull` shows pull-failing copy; `null` shows "This pod no longer exists…"; `shell-closed` becomes the Detached or Exited card.
- **Session state lives in `DetailPanel`, not `ShellTab`.** Tab content is keyed `pod.name-tab`, so leaving the Shell tab unmounts it. Strip steps: Added, Waiting for container, Connecting, Attached. End states: Detached, Exited, Connection lost, Pod gone.
- **Gates, DISABLE-PRECEDENCE order, one reason shown:** (1) read-only mode; (2) RBAC `update pods/ephemeralcontainers` in the pod's **own** namespace via `useAccessChecks`, fail open (the "all" skip never applies); (3) disabled **only** when `server_version` parses to minor < 23, unparseable stays enabled (`supportsEphemeralContainers`); (4) pod `Succeeded`, `Failed` or `Terminating`: "Debug containers can't run in a pod that has finished."
- **Permanent.** A debug container lives until the pod is deleted. The dialog says so, plus a note when `pod.owner` is set (future pods will not have it).
- Image suggestions: `busybox:1.36`, `nicolaka/netshoot:v0.13`, `alpine:3.20`, `ubuntu:24.04`. Up to 5 recent images in `localStorage["debug-images"]` (try/catch).
- `isPsaRejection`: lowercased message contains `podsecurity`, `pod security` or `admission webhook` → PSA line; otherwise "Nothing was added to the pod."
- The no-shell banner triggers on `isNoShellError(ShellClosed.message)` (also a start rejection). Substrings are source-read, on the live-verification list.
- Turning read-only on unmounts the terminal; cleanup calls `stop_shell_session`. The debug container keeps running; strip shows Detached, Attach disabled. Port-forward and log streams are unaffected.
- `start_debug_container` is an `invokeWrite` and logs `verb=debug`.

## Log viewers: filters, JSON, multi-pod narrowing (v1.3.1)

`LogViewer` and `MultiLogViewer` share `LogViewBar.tsx` and one row renderer `LogLine.tsx`. **Filters never touch the stream**: they run over the 5,000-line ring buffer, so no change reconnects.

- **Include / Exclude / Highlight match `ParsedLogLine.body`** (no Kubernetes timestamp), never `raw`. Exclude wins over Include. One regex toggle and one case toggle; compiled once per (text, regex, case); zero-length matches neither mark nor count. Pure code: `utils/logFilter.ts`.
- **No `dangerouslySetInnerHTML`.** Marks are ranges; `markSegments` turns them into React segments. Highlight = tint + underline (not colour alone).
- Rows keyed by monotonic `seq`. Expanded-JSON set and active match are pruned by `pruneToPresent`.
- JSON rows: per-line expand plus summary toggle; **max 200 expanded** (`MAX_EXPANDED_JSON`), the 201st collapses the oldest with a notice. No virtualisation; the 5,000-line cap bounds the DOM.
- View state is owned by `DetailPanel` / `ResourceDetailPanel` (`logView`), survives tab switches, **never persisted**. Below 640 px filters collapse into a `Popover`.
- Keys: `⌘F`/`Ctrl+F` focuses Include (inert while a modal layer is open); Enter / Shift+Enter step highlight matches; `f` toggles follow, `End` jumps to latest, both scoped to the log region.
- **Multi-pod narrowing is a Source control, not a filter**: it changes which pods stream. Order: **narrow, then sort (not-ready and restarted first), then cap at 20** (`selectStreamingPods`, `utils/multiPods.ts`). Zone = `topology.kubernetes.io/zone`, fallback `failure-domain.beta.kubernetes.io/zone`, from cached `useNodes` labels. No label or unknown node = "unknown"; no zones at all hides the Zone menu. Per-pod show/hide **never enters the stream effect key** (`podsKey` = narrowed, capped pods).
- Download: all loaded lines or only visible ones; file name says which (`utils/logDownload.ts`).

## Log Streaming (v0.8.1, channel payload changed v1.3.0)

`stream_pod_logs` uses a per-invocation `tauri::ipc::Channel<LogStreamEvent>`, never a global `app.emit`. Each stream is isolated, so switching pods never mixes output.

Signature: `stream_pod_logs(on_log: Channel<LogStreamEvent>, context, namespace, pod, container, tail_lines: Option<i64>, since_seconds: Option<i64>, timestamps: Option<bool>)`. `on_log` stays first. Frozen tagged enum:

| Event | JSON | Meaning |
|---|---|---|
| `Line` | `{"type":"line","line":"…"}` | One log line |
| `End` | `{"type":"end"}` | Server closed the stream normally |
| `Error` | `{"type":"error","message":"…"}` | Stream broke mid-way |

- `End` or `Error` is sent at most once; nothing after it. A failed `on_log.send()` means the frontend dropped the channel; the task exits silently (the only cancellation signal).
- A start failure rejects the invoke with `Failed to stream logs: {message}` (`ae.message` for API errors). The frontend must show it.
- `tail_lines` defaults to 200, capped at 5000; `< 1` rejected. `since_seconds < 1` rejected. Both in pure `stream_log_params`. Always `follow: true`.
- `get_pod_logs` takes `since_seconds` and `timestamps` (both `Option`), also for `previous: true`. The API applies `sinceSeconds` then keeps the last `tailLines`. `tail_lines: None` = no limit.
- `timestamps: true` prefixes each line with `<RFC3339Nano UTC><space>`; fraction zeros may be trimmed. Split at the **first** space; if the token is not a date, treat the line as untimestamped.
- Multi-pod backfill is in arrival order, not sorted.

Frontend: both viewers keep a **5,000-line ring buffer** and show `error`, `end` and a rejected start. **No component calls `invoke`.** `startLogStream(args, onEvent)` in `useResources.ts` creates the channel and returns a cleanup that sets `channel.onmessage = () => {}`, which ends the backend stream. No global `listen("log-line", ...)`.

## Node Metrics

Usage comes from `metrics.k8s.io/v1beta1` via `DynamicObject` (k8s-openapi has no `NodeMetrics`). Metrics server absent: empty map. **Node `cpu_percent` / `mem_percent` are shares of `status.allocatable`**, not capacity (`kubectl top node` default), `None` when allocatable is absent. Memory parses through the one `utils::parse_mem_bytes` (see `health.md`).

## Metrics History Sparklines (v0.8.0)

- Nodes: `useNodeMetricsHistory` wraps `useNodes` with a 20-sample circular buffer (`useRef<Map<string, number[]>>`, updated on `dataUpdatedAt`), returns `{ cpuHistory, memHistory }` for `NodeStrip`.
- Pods: `usePodMetricsHistory(context, namespace)` calls `list_pod_metrics` → `PodUsage { name, namespace, cpu_m, mem_mi, containers: Vec<PodContainerUsage { name, cpu_m, mem_mi }> }`. History is keyed by namespace. `PodRow` renders `<Sparkline>` when `length >= 2`. `Bar` takes `requestPct?` for a request tick; with metrics it fills by latest usage, without them by request.
- **Now stays the 20-sample ring (v2.3.0).** The Metrics-tab range control and the NodeStrip range control default to "Now": the `useNodeMetricsHistory` / `usePodMetricsHistory` buffers and metrics-server are unchanged. Longer ranges are the Prometheus path below and never replace the ring; with no target, or on failure, the session view is what shows.

## External observability (v2.3.0)

Metric history and log history come from a Prometheus, Loki or VictoriaLogs the user points at. Config is per cluster and optional; the app works without it.

- **Service proxy only, GET only.** Every call is `GET /api/v1/namespaces/{ns}/services/{scheme}:{svc}:{port}/proxy{prefix}{api_path}` through the cached kube client (`proxy_get` in `observability.rs`), so exec-plugin auth and the app proxies apply. No direct HTTP from the app, no port-forward. RBAC needed: `get services/proxy`. All four commands are reads (`discover_observability`, `probe_observability_backend`, `query_metric_range`, `query_backend_logs`), use plain `invoke`, and are not `invokeWrite`; no name starts with a `WRITE_VERBS` prefix.
- **Fixed templates.** PromQL is built only in `prometheus.rs` `render`. The template set is closed at `pod-cpu`, `pod-mem`, `node-cpu`, `node-mem`; anything else is an `Err`. There is no p95 template: the 24 h p95 is computed in TS from the `pod-cpu` / `pod-mem` 24 h range. Namespace, pod, container and node names are shape-validated, then escaped (`escape_label`; newlines rejected). Log label names go through `valid_field_name`. LogQL and LogsQL are built in `logs_backend.rs` the same way. The frontend validators in `src/utils/observability.ts` mirror the Rust ones, with the Rust test vectors copied; change both together.
- **Path builder.** `proxy_path` validates namespace, service, port, `scheme` (`http` or `https`) and `path_prefix` (absolute, no `..`, only `[A-Za-z0-9-._~/]`, trailing `/` trimmed). Query values are percent-encoded by the hand-written `pct_encode`.
- **Errors by origin (`classify`).** An API-server `Status` carries its own `reason`; kube builds `"Failed to parse error data"` for any non-Status body, which is the backend's own reply. Only `403` with `Forbidden` is `ProxyErr::Forbidden` (message prefix `No access to services/proxy: `, matched by `isForbidden` in TS), and only `404` with `NotFound` is a missing Service. Every other status is `Backend(code, text)`, text capped at 300 chars, so an auth proxy's 403 in front of Prometheus reads as unreachable, not as an RBAC problem. Query failures read `Failed to query metrics: …` or `Failed to query logs: …`.
- **Caps.** Response body 32 MiB, enforced while reading (`read_capped` over `request_stream`; one byte over is an error). 1,100 points per series (the step widens to stay under it, `effective_step`). 20 series (`truncated: true` beyond). 5,000 log lines (`MAX_LINES`, newest kept). Known ceiling: kube-rs 0.95 still reads 4xx/5xx bodies whole (`ponytail:` comment in `proxy_get`).
- **Probe.** `probe_observability_backend(context, target, flavour)`; `flavour` is required (`prometheus`, `loki` or `victorialogs`) and anything else is `Err("Failed to probe: unknown backend '…'")`. Every other outcome is `Ok(BackendProbe { state, message, version })`, mapped by the pure `outcome`: `ok`; `wrong-service` (a 200 that is not that backend, or a backend 404); `forbidden` (API-server 403); `unreachable` (bad fields, no client, missing Service, transport error, backend 401/400/5xx). Prometheus tries `/api/v1/status/buildinfo`, then `/api/v1/query?query=vector(1)` after a backend 404. Loki uses `/loki/api/v1/labels` and checks the `{"status":"success"}` envelope. VictoriaLogs uses `/select/logsql/query` (`query=*`, `start` five minutes back, `limit=1`); an empty body, or a first line that is a JSON object, is `ok`.
- **Discovery.** `discover_observability(context, all_namespaces: Option<bool>)` returns `ObservabilityDiscovery { candidates, skipped }`. The default scan covers `monitoring`, `observability`, `prometheus`, `loki` and `kube-prometheus-stack`; "Search all namespaces" is one cluster-wide list with `source: "*"`. A failed list goes to `skipped` (via `problems::take`), never `Err`; `Err` is only `Failed to connect: …`. `reason` names the rule: `Matched the service name "…".` or `Matched the label app.kubernetes.io/name=….`. Name matches sort before label matches, so Prometheus stays above the dialog's 8-row cut.
- **Node selectors, in order (`ponytail:` comment in `render`).** `node-cpu`: node-exporter joined to `node_uname_info{nodename="{node}"}`; fallback is cAdvisor root (`id="/"`) by `node="{node}"`, `or` by `instance=~"{node}(:.*)?"` (dot-escaped). `node-mem` follows the same order with `node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes` and `container_memory_working_set_bytes`. The fallback runs only when the primary returns no series. The selectors are reasoned, not observed (`open-items.md`).
- **Ranges and coverage (`METRIC_RANGES`, `rangeWindow`).** 1 h at 15 s, 6 h at 60 s, 24 h at 300 s, 7 d at 900 s; each is at most 1,100 points, and `end` is floored to the step. The 24 h row is shared by the 24 h chart and the p95 hint (same query key, one cache entry). Coverage: `P95_MIN_POINTS = 216` of the 288 points per resource; under that, or for a placeholder from another object, that resource has no p95. `useMetricRange` keys on `[metric-range, context, targetKey, template, namespace, name, range]`; `placeholderData` survives a range change only (`samePlotExceptRange`). `staleTime` and `refetchInterval` are `max(60 s, step)` (a new point appears once per step). `range: "now"` or no target disables the query.
- **Chart.** `MetricChart` draws one series per container, with no tooltip; the numbers under it are the text alternative. The x axis is the query window (`rangeWindow` ending at the query's `dataUpdatedAt`), not the first sample. A gap wider than two steps breaks the line (`splitSegments`); a container younger than the range says "History starts when the container started." Node history is percent of allocatable (`toPercent`); with no allocatable the session ring stays and a note says why.
- **Log history.** The pod log viewer's "Log source" control (Pod log, History) appears only with a configured `logs` target. History is a one-shot fetch (never polls; a late response for an older request is dropped), always shows timestamps, has no Follow and no Previous, and offers 1 h, 6 h, 24 h and 7 d (kept apart from the pod-log range). A failure reverts to the pod log with a strip. Lines go through the same `parseLogLine` as pod logs (`backendRaw`).
- **Label presets and tenant.** Loki: `namespace`, `pod`, `container`. VictoriaLogs: `kubernetes.pod_namespace`, `kubernetes.pod_name`, `kubernetes.container_name`. Rust `label_preset` is the backstop for empty names; TS `LOG_LABEL_PRESETS` mirrors it (a test compares the strings) and the dialog stores the explicit names it showed. `ServiceTarget.tenant` is optional (`#[serde(default)]`): a non-empty value is validated (`[A-Za-z0-9!._*'()-]`, 1 to 150) and sent as `X-Scope-OrgID`, anything else is `Err("invalid tenant …")`, and `None` or `""` sends no header. Only the Logs group shows the field; the Metrics group saves none.
- **Config.** Stored on the cluster identity record under `observability` (`{ prometheus?, logs? }`, already in the IPC shape) in localStorage: per viewer, not synced. `parseObservability` reads tolerantly (a wrong shape is unset for that half, no corrupt note); `setClusterIdentity` spreads the stored entry so unknown fields survive; `observability: null` deletes the key. Edited in `ObservabilityDialog`, opened from ⌘K ("Observability: configure for …"), Cluster switcher → Configure…, and the Configure… buttons in the pod Metrics tab and the log viewer.

## Container Detail (v0.9.0)

`Container` (`pods.rs`, filled by `parse_container_extras()`) carries:

- `env: Vec<ContainerEnvVar>` (`name`, `value`, `value_from`: ConfigMap/Secret key ref, fieldRef, resourceFieldRef)
- `env_from: Vec<ContainerEnvFrom>` (`config_map_ref` / `secret_ref`, optional `prefix`)
- `volume_mounts` (`name`, `mount_path`, `sub_path`, `read_only`)
- `probes: ContainerProbes` (`liveness` / `readiness` / `startup`, each `Option<ContainerProbe>`); `probe_type` is `"HTTP GET"` / `"TCP"` / `"EXEC"` / `"grpc"`
- `cpu_request_m`, `mem_request_mi`, `cpu_limit_m`, `mem_limit_mi: Option<i64>` via `parse_cpu_millis` / `parse_mem_mib`

The Containers tab shows ENV / MOUNTS / PROBES accordions per container. ConfigMap/Secret env rows navigate via `onNavigate` (`App.tsx` → `DetailPanel`). `DualZoneBar` (`DetailPanel.tsx`): denominator is the limit, else `request × 2`; fill ≤65% accent, ≤85% warn, else bad; request tick. Per-container usage comes from `podMetrics.containers` by name.

Workload Summary tabs show a Pod Template section from `pod_template: Option<PodTemplateSpec>` (`build_pod_template()` in `workloads.rs`).

## Init Containers in Pod Detail (v0.9.3)

- `Container.is_init: bool`; `build_containers()` reads `spec.init_containers` with `status.init_container_statuses`.
- The Containers tab bridges the `init:` prefix of `containers_status` for restart history, and groups init containers under their own header with an `[init]` badge.
- `LogViewer` labels them `[init] <name>` but sends the raw name to the log API.

## Multi-Pod Log Tail (v1.2.0)

Zero Rust: one stream per pod; the frontend prefixes lines itself. `MultiLogViewer.tsx` is the Logs tab for `deploy` / `sts` / `ds` / `jobs` / `cron` / `rs`, fed by `useWorkloadPods`.

- Ring buffer capped at 5000 lines; max 20 pods with a visible notice.
- **Effect deps must be a stable joined string of pod names, never the array.** `useWorkloadPods` returns a new array every 15 s; keying on it leaks N backend tasks per cycle. One cleanup clears every channel's `onmessage`.
- Retry (failed) and Reconnect (ended) re-subscribe only those pods through `reconnectRef`, without re-running the effect. The pod's old lines are dropped first (`removeWhere`) because its tail replays.
- The keyed pods are the narrowed, capped set (see Log viewers).
