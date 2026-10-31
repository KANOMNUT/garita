# Live verification harness (v2.1.2, #47)

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## What it is

`#[cfg(test)] mod live;` in `src-tauri/src/lib.rs`, files in `src-tauri/src/live/`, plus `scripts/live/`. It ships nothing in the binary. Every live test is `#[ignore]` and returns early unless `GARITA_LIVE_CONTEXT` is set, so `cargo test --lib` never needs Docker or a cluster.

| Path | Content |
|---|---|
| `src/live/mod.rs` | Gate (`ctx()`, `context_allowed`), `Ns` (owned namespace), `kubectl`/`helm` wrappers, `eventually`, `js` |
| `src/live/{workloads,logs,preview,access,health,rbac,proxy}.rs` | The areas: drain/eviction, events, delete propagation, rollback, debug container, logs, YAML and Helm previews, `can_i`, per-kind reads, presence, problems, capacity, unused, deprecations, who-can, proxy |
| `src/live/crds.rs` | The custom resource commands (v2.4.1) run on a built-in API group: a `Role` (`rbac.authorization.k8s.io/v1`) in the test's own namespace. It passes `cr_request` (a non-empty group), the `ReplaceTarget::Custom` arm, the dry run, the conflict and the delete on a real API server, and writes only inside a `garita-live-*` namespace (T51-6). Run it with `make live` |
| `scripts/live/run.sh` | Whole flow: kind cluster, proxies, kubeconfig, `cargo test`, teardown |
| `scripts/live/kind-config.yaml` | Control plane plus two workers |
| `scripts/live/fixtures/*.yaml`, `fixtures/chart/` | Applied by the tests into their own namespaces (`__NS__` is replaced); a tiny Helm chart |

## Running it

- `make live` (all platforms). On Windows it goes through the `RUN` macro, so the MSVC toolchain env is set, and runs the Makefile's pinned Git Bash, never a bare `bash`.
- macOS and Linux may run `scripts/live/run.sh` directly.
- Needs `docker` (daemon running), `kind`, `kubectl`, `helm`, and `cargo` on `PATH`. Windows: Docker Desktop's CLI is often not on `PATH`; `run.sh` adds `%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin` when `docker` is missing.
- It refuses to start if a kind cluster named `garita-live` already exists (it would not be its own).
- Flow: `kind create` (own `--kubeconfig`); squid (config inline in `run.sh`, `SQCONF`) and a SOCKS5 server on the `kind` Docker network (images pinned by digest, published on `127.0.0.1`); one combined kubeconfig; `cargo test --lib --no-run`; `cargo test --lib --offline live -- --ignored --test-threads=1 --nocapture`; a check that squid logged a `CONNECT`; teardown of containers, cluster and temp dir.
- Only the final test line gets `HTTP_PROXY`/`HTTPS_PROXY=http://127.0.0.1:9` and `NO_PROXY=127.0.0.1,localhost`. `kind create` and the build never get them (kind copies proxy env into the nodes; cargo would route its fetches through the dead proxy).

| Env var | Effect |
|---|---|
| `GARITA_LIVE_CONTEXT` | The context under test. Unset: every live test returns early. `run.sh` sets `kind-garita-live`. |
| `GARITA_LIVE_ALLOW_ANY=1` | Lifts the context-name gate (below). Never set by `run.sh`. |
| `GARITA_LIVE_KEEP=1` | `run.sh` leaves the cluster, `garita-live-squid`, `garita-live-socks` and the temp dir; delete them by hand (`kind delete cluster --name garita-live`). For debugging. |
| `GARITA_LIVE_SLOW=1` | `problems_fire_on_fixtures` also waits for `pvc-pending`, which fires only after 5 minutes. |

## Safety (T51-6)

- `live::ctx()` panics unless the context starts with `kind-` or `k3d-`, or `GARITA_LIVE_ALLOW_ANY=1`.
- Writes go only into `garita-live-<random>` namespaces created by `Ns::create` and deleted by `Ns::cleanup`. Cluster-scoped objects are only read. Node drain is previewed, never run.
- The harness reads only `$KUBECONFIG` (`run.sh` points it at its own file). `CONFIG_DIR` is never set under `cargo test`, so the registry is empty and the developer's `~/.kube/config` and app config are never read (T51-5).
- A test that panics leaks its namespace until the kind cluster is deleted; the harness runs nowhere else.
- No literal URL with a user name and password exists in the repo (brief section 0.8). `run.sh` builds the userinfo proxy-url at runtime.
- `live::ctx()` calls `invalidate_client_cache()`: each `#[tokio::test]` has its own runtime, and a cached client's buffer worker dies with the previous one (`Service(Closed)`). The app has one runtime; test-only.

## Proxy discrimination (T51-10)

The proxied contexts use the internal server name `https://garita-live-control-plane:6443`, which only resolves on the `kind` Docker network. The proxies sit on that network, so a bypass fails on DNS. Contexts in the generated file:

- `kind-garita-live`: host server, no proxy.
- `-direct`: internal server, no proxy-url. Negative control, must be `unreachable`.
- `-http` (squid), `-socks5`.
- `-userinfo`: http proxy-url with userinfo built at runtime (squid without auth ignores it).
- `-deadproxy`: `127.0.0.1:9`, nothing listens.

No test stops a proxy container. Squid allows `CONNECT` to port 6443 only and keeps its access log, which `run.sh` greps at the end.

## What it cannot cover

- A denied `can_i` / SSAR (kind's admin kubeconfig cannot be denied); read-only-user behaviour.
- A real CRD (v2.4.1): the harness never writes cluster-scoped objects (T51-6) and kind ships no CRD, so `live/crds.rs` uses a built-in group. A conversion webhook, a status subresource and schema validation by an installed CRD stay unobserved (`open-items.md`).
- Exec-plugin auth (GKE/EKS/AKS), and exec-plugin behind a proxy.
- OOMKilled: Docker Desktop kind reports the kill as reason `Error` (exit 137), so the `oom-killed` Problems rule never fires there.
- `pvc-pending` without `GARITA_LIVE_SLOW=1`.
- Metrics: kind has no metrics-server, so usage is `None`.
- Anything in the UI (banners, ContextSwitcher, the app log file), installed-bundle checks, the updater, webview behaviour per OS.
- Other Kubernetes versions: one kind node image (kind v0.24 defaults to 1.31), and EKS/GKE served versions.
- No CI job (T51-11): after U2 a `workflow_dispatch`-only `live.yml` may run it.
