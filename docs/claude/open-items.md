# Known open items and deferred work

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Simultaneous Multi-Cluster Views — out of scope, but not foreclosed

Deferred. Every view, hook and panel takes one `context: string`; invalidation assumes a `[key, context]` prefix. It stays reachable because query keys are already `[kind, context]`-shaped: remaining work is view-layer (cluster column, N parallel queries, merged sort). App-local active context could become a set.

## Known Open Items

Each item carries its version tag.

### Verification owed against a live cluster

**Only what the v2.1.2 harness run observed (see "Live harness ledger" below) has been seen against a real API server; every other row here is source-read.** Pure Rust/TS functions have tests that need no cluster.

`docs/plan-kubeconfig-and-parity.md` §7 is the v1.2.0 verification ledger; keep it separate. Highest-risk rows: exec-plugin auth through `load_merged_kubeconfig` (every command's path), client-cache invalidation after add/remove/toggle (stale client serves the previous cluster), SSAR fail-open where SSAR is unavailable.

- **Create/edit:** no patch has been accepted or rejected live; **Dry run** closes it (worth more on edit: immutability). Immutability table (`docs/plan-guided-edit.md` §5.1) is source-read; likeliest wrong: grow-only PVC resize, `sts` partial-spec rejection, `croles` aggregation. Create cases: `ing` blank host (omit `host:`), `sts` selector/label agreement, `crbindings` subjects namespace, `pv` with each source type. Cheapest end-to-end: TLS Secret via the form, then its TLS tab.
- **v1.2.1:** PDB refusal is 429 with "disruption budget" in `ErrorResponse.message`; mirror/DaemonSet classification; evicting completed/terminating pods returns 2xx or 404, never 429; `involvedObject.kind` field selector accepted (ArgoCD Application events still show); `rollback_argocd_app` on single- and multi-source apps, refused with auto-sync (check `revisions` shape); RBAC gating on node actions fails open without SSAR.
- **v1.3.0:** Background propagation (Job delete removes pods; Deployment Orphan keeps RS and pods); `LogStreamEvent` `end` / `error` / start rejection text; `since_seconds` + `previous` + `timestamps` together; `update` SSAR denies for read-only users, fails open without SSAR; rollback reuses the old RS (no duplicate); Neat YAML hides `managedFields` / last-applied while the editor shows the full object.
- **v1.3.1:**
  - Debug containers: SMP `patch_ephemeral_containers` on 1.25+ and 1.23-1.24; rejection text under restricted PSA; a second debug container leaves the first; attach TTY prompt (may need Enter), resize, `shell-closed` on `exit`, `stderr: false` with tty; `get_pod` null on delete, 2 s poll cost; `update pods/ephemeralcontainers` SSAR.
  - Shell: missing-shell failure on channel 3 matches `isNoShellError` substrings (`executable file not found`, `oci runtime exec failed`, `no such file or directory`); pod names with `.`; immediate close still emits `shell-closed`; WebView2 `Ctrl+F` does not open the native find bar.
  - Previews: dry run returns the defaulted object; stale `resourceVersion` → 409; `dropped_paths` false positives (empty maps/arrays skipped by `k8s-openapi`); `helm upgrade --dry-run -o json` `.manifest` shape across Helm versions (client-side on 3.13+); template error → `rejected`; helm missing → unavailable; credential masking on a real values file.
  - `gvk_for` widening / compare: `get_resource_json` per new kind incl. cluster-scoped; `RevisionInfo.template` on a real RS; `fieldsV1` shapes and large-object performance; `classifyReadError` on real errors; unreachable/auth-failing other cluster; same-`server` contexts compare equal, empty `server` shows no line; rollout compare when the Deployment read is forbidden.
  - Diagnostics: log path per OS, rotation at 5 MiB, "Open log folder" on all OSes, `file_exists`, **no token in the file after an exec-plugin auth failure**.
  - Drain: force-delete under a real PDB; `create pods/eviction` SSAR hint and fail-open.
  - Read-only: no write reaches the cluster (the test only proves source shape); shell/attach refused and ended; `aria-describedby` reason spans in WKWebView/WebKitGTK; PowerShell 5.1 quoting of JSON patches; Filters popover below 640 px; zone labels on a multi-zone cluster.
- **v1.4.0:** `list_api_presence` absent/installed/403 → `unknown`; each Problems rule on a fixture (a 3-replica Deployment without readiness gives **one** `missing-probes` row); field selectors `type=Warning` and `type=kubernetes.io/tls` accepted; namespace-scoped user sees `skipped`, not an error page; cert-manager and TLS Secret facts classify like the TLS tab; `list_node_capacity` matches `kubectl describe node` for init-heavy, native-sidecar and overhead pods; node CPU%/MEM% match `kubectl top node`; container split matches `kubectl top pod --containers`; Kyverno/Gatekeeper webhooks read "may apply". Designed to close via the v1.5.1 kind harness.
- **v1.4.1:**
  - Secret reveal: the decode toggle, guided Secret edit, TLS tab and secret pickers work from keys and sizes. The four Secret query keys are gone after Hide, panel close and selection change. Compare's keys are gone after its dialog closes. Merge from file masks Secret rows. The Helm gate's rendered manifest shows the sentinel for Secret documents. A `kubectl apply`'d Secret shows the sentinel for last-applied in Metadata and Compare. Install dry run shows the fixed line.
  - Secret identity change: Secret `x` → `y` → back to `x` stays masked until Reveal is clicked again.
  - Helm redaction: a chart with `password:` values shows the sentinel. Reveal, Edit and Review upgrade send the real values. A pasted sentinel is refused by the backend.
  - Saved searches: save, apply, replace by name, remove with Undo, and the 20 limit on a real profile. With storage blocked, the button still opens and Save says why. A CRD instances view saves under its own CRD.
  - Journal: one line per write across every write family, including a failed write and a Secret edit. No Secret value appears in the file (grep it for a known test value). `journal.jsonl` in the log folder rotates at 5 MiB, keeps the newest entries and still pages across slots. Entries are still written with the log level at `warn`.
  - Who can: aggregated ClusterRoles (`admin`, `edit`, `view`) and wildcard rules. A ServiceAccount reached through `system:serviceaccounts:<ns>` shows "through group". EKS/GKE show the non-RBAC note, and the page never claims "no one".
  - Possibly unused: no false positive for a ConfigMap referenced only by a CronJob template, a projected volume or an init container. A Secret used only by an Ingress `tls`, a Gateway listener or a Certificate is not listed. With `pods` forbidden, ConfigMaps, Secrets, PVCs and ServiceAccounts are named as unchecked. Check that the `type!=` field selector is accepted.
  - Deprecated APIs: a Helm release with a removed API on a cluster one minor behind and one ahead. A `kubectl apply`'d object with an old last-applied `apiVersion`. Served-version discovery on EKS/GKE.
- **v1.4.2 (appearance, build checks, not cluster checks):**
  - Dark parity, user-run screenshots, v1.4.1 vs v1.4.2 with theme Dark and accent Blue: Cluster Overview, Pods, a detail panel with Logs and Shell, a ConfirmModal, Problems, Node capacity, the diff dialog, Settings. The only allowed differences are the accepted dark deltas below. The agent-run checks (`themeTokens.test.ts`, the compiled-CSS diff at the time) prove variable values, not what a screen looks like.
  - OS follow: switching the OS appearance flips the app live on macOS, Windows and Linux (GNOME) while the theme is System, and an open terminal re-themes without restarting its shell.
  - First paint: launching in light mode shows no dark flash on an installed bundle. Dev mode flashes by construction.
  - Identity under the teal accent: primary buttons, links, tabs and row selection turn teal. CPU bars and sparklines, Progressing pills, "Pods running", identity chips and the terminal ANSI colours do not. A cluster stored as `"accent"` keeps its blue chip. A read-only or typed-confirm toggle leaves the stored colour as it was. With a non-blue dark accent the primary-button labels and the count-badge label are dark.
  - Native decorations: Windows/Linux with the OS in dark and the app forced to Light keep a dark title bar (accepted). macOS traffic lights over both themes.
  - Contrast spot-checks on a real display against `docs/ux/05-theme-settings-platform.md` §2.1: `identity-yellow` and `status-warn` on light, the light terminal palette, and each accent's `on-accent` label.
- **v2.0.0 (rebrand to Garita, build checks only):**
  - Upgrade from a real v1.4.x install on macOS and Linux: one registered kubeconfig and one pasted import. On first v2 launch both contexts are present, the pasted import path is under the `io.github.kanomnut.garita` config dir, `diagnostics.json` carried over, and the legacy `com.watchtower.app` dir is byte-identical before and after.
  - Fail-closed seed: on that first launch every listed cluster is read-only and the upgrade notice shows; it survives a restart until dismissed; a fresh install (no legacy dir) shows nothing.
  - Bundle names: `Garita.app` with executable `garita`, DMG volume `Garita`, deb/rpm package `garita`. `dpkg-deb -I` shows `Provides/Conflicts/Replaces: watchtower` and `rpm -qp --obsoletes` shows `watchtower`; the v1 package names were derived from tauri-bundler 2.10.1 source (kebab-case productName), not read from a v1 artifact.
  - LICENSE, NOTICE and THIRD_PARTY_LICENSES land in each bundle (`.app/Contents/Resources/`, deb `/usr/lib/garita/`).
  - Icon at 16 and 32 px in Finder list view, the Dock (light and dark) and a Linux launcher; the sidebar mark in both themes.
  - `pages.yml` deploys `site/` once the repo is public, Pages source is GitHub Actions and a release is published.
  - **AppImage (dropped from releases in 2.0.0):** release.yml no longer builds it. Before re-adding: the AppImage likely bundles WebKitGTK/GTK/GLib/libsoup (LGPL-2.1+), which cargo/npm tooling cannot see. Check with `--appimage-extract` and `ls usr/lib`. If bundled, ship the LGPL-2.1 text plus a source pointer (Ubuntu 22.04 source packages) in the bundle resources, then restore `appimage` in the release matrix, the collect step, README, the root `index.html` and the `pages.yml` link count.
- **In-app updater (since v2.1.0; nothing observed until a real published release).** 2.3.0 is the first published release, so L1 to L5 close on 2.3.0 and L6 and L7 on 2.3.1:
  - **L1** v2.3.0 draft: 14 assets; `latest.json` has the five platform keys and versioned URLs; Check signing key passed.
  - **L2** published, repo public: `curl -fsSL https://github.com/KANOMNUT/garita/releases/latest/download/latest.json` returns `2.3.0`; every `url` passes `curl -fsIL` logged out.
  - **L3** 2.3.0 installed by hand on macOS (DMG), Ubuntu (deb) and Fedora (rpm): Settings → Updates says "You're up to date". A Linux failure means the bundle-type patch is missing. After the cask bump, `brew install --cask kanomnut/garita/garita` installs 2.3.0 (no earlier version was published, so there is no brew upgrade from one).
  - **L4** offline: no modal, no toast; the automatic check stays silent; a manual check shows the failure and the release-page action.
  - **L5** automatic check off, relaunch: no notice; "Check for updates" still works.
  - **L6** 2.3.1 published: macOS Sidebar notice, Download update (progress), Restart to update, confirm, relaunch as 2.3.1 past Gatekeeper with `codesign -dv` showing `Signature=adhoc`. Repeat on the brew install. Also: `requireSignedVersion` accepts the `--app-version` signatures; connect to a cluster after the update. After the 2.3.1 cask bump, `brew upgrade --cask garita` moves a brew 2.3.0 to 2.3.1 despite `auto_updates true`.
  - **L7** 2.3.1 published, Linux deb and rpm: notice and "Download" opens the release page; no install or restart controls; `download()` from devtools is refused by the capability.
- **v2.2.0** (source-read, none observed live; `docs/impl/v2.2.0-tasks.md` §7.2):
  - Map edges: on the harness fixtures every relation type appears at least once and no edge points at a missing node.
  - Scale: a namespace over 2000 objects returns `truncated: true` with empty `nodes`/`edges` within a few seconds; over 400 drawable nodes (after hide and group) shows the start-from-an-object prompt.
  - Islands: two unrelated Deployments come back as two components (no `kube-root-ca.crt` hub).
  - Secret noise: a namespace with a Helm release shows no `sh.helm.release.v1.*` Secret nodes, i.e. the `type!=` field selector is accepted on the metadata list.
  - NetworkPolicy: default-deny, allow-from-namespace and ipBlock fixtures; the evaluator's edges match a real connectivity probe from a debug container.
  - Timeline: Events, rollout revisions, Helm history and ArgoCD history interleave in timestamp order on a real cluster; Helm's RFC3339Nano `updated` parses in WebKit.
- **v2.3.0** (source-read, none observed live; `docs/impl/v2.3.0-tasks.md` §6.2). The kind harness installs no Prometheus, Loki or VictoriaLogs, so every row needs a real cluster:
  - kube-prometheus-stack: discovery finds it; `pod-cpu` / `pod-mem` values match Grafana for the same pod; NodeStrip shows node history, and which node selector answered (`node_uname_info` join, cAdvisor `node=`, cAdvisor `instance=~`) is recorded. The node selectors are reasoned, not observed.
  - Plain `prometheus-community/prometheus`: the same node-history check.
  - Prometheus behind a path prefix or an https port: `path_prefix` and `scheme` work through the service proxy.
  - RBAC: a user without `services/proxy` sees the hint, a `forbidden` Test and the fallback strip, not an error page; a `resourceNames`-scoped Role still passes Test.
  - An auth proxy in front of Prometheus (for example OpenShift oauth-proxy): a backend 403 reads as unreachable or "Failed to query metrics", not as "No access to services/proxy" (`classify`).
  - Loki: the probe (`/loki/api/v1/labels`) returns `ok`; history lines arrive in order; the nanosecond-epoch `start` / `end` and `direction=backward` work; filters and JSON mode work on them; a deleted pod's logs come back from `query_backend_logs` for the window (there is no UI entry point for deleted pods).
  - Multi-tenant Loki (`auth_enabled: true`; record the chart's actual default): with no tenant the Test says `unreachable` and Why? shows "no org id"; with the tenant set, Test is `ok` and history loads. This proves the service proxy forwards `X-Scope-OrgID`; if it does not, log history is single-tenant only.
  - VictoriaLogs: the probe query and `"f":="v" … | sort by (_time) desc limit N` return lines; unix-second `start` / `end` are accepted. The query shapes are not live-verified.
  - An exec-plugin cluster (GKE, EKS, AKS): the service proxy works with exec auth.
- **macOS standard (non-admin) account** (Makefile `mac-app` / `mac` / `mac-install`; source-read and `make -n` only, no Mac on the dev box):
  - `make mac` on a desktop session finishes without `Resource busy` and without a Finder Automation prompt; the DMG holds only `Garita.app` and opens it.
  - `make mac-install` asks for no password; `~/Applications/Garita.app` opens directly (no quarantine flag) and `codesign -dv` shows `Signature=adhoc`.
  - Dragging the release DMG's app into `~/Applications` asks for no password; after `xattr -rd com.apple.quarantine ~/Applications/Garita.app` it opens.
  - In-app update of a copy in `~/Applications` asks for no password; of a copy in `/Applications` on a standard account it asks for an administrator (tauri-plugin-updater 2.13.2 `with administrator privileges` fallback).
  - `HOMEBREW_CASK_OPTS="--appdir=$HOME/Applications"`: the cask installs into `~/Applications`, `postflight` clears the flag there, and the `binary` link points into it.
  - Settings → Command line → Install (per-user link target, `commands/cli.rs`; unit-tested on Windows only, never run on a Mac):
    - Standard account with `~/.local/bin` (or `~/bin`) existing and on the login-shell PATH: Install creates `~/.local/bin/garita` with no prompt, Settings reads "installed at …", and `garita --version` works in a new terminal.
    - Standard account with neither on PATH: Install shows `mkdir -p ~/.local/bin && ln -s '<exe>' ~/.local/bin/garita` and the `export PATH="$HOME/.local/bin:$PATH"` line; after running both, `garita` works in a new terminal, and Settings reads installed only after Garita is relaunched (`fix_path` reads PATH once, at startup).
    - Administrator on Apple Silicon (`/usr/local/bin` root-owned, nothing per-user on PATH): the `sudo ln -s … /usr/local/bin/garita` line as before; `mac_admin` reads true. `mac_admin` stands in for admin-group membership by testing write access to `/Applications`; a standard account must read false.
    - Administrator with a writable `/usr/local/bin` (Intel Homebrew): the link still lands in `/usr/local/bin`.
- **Edit-form transforms:** `src/components/edit/transforms.ts` is tested through `mergePatch` (`transforms.test.ts`). Transforms still inline in `.tsx` handlers are inspection-only (`check-emit.ts` cannot strip JSX).
- On Windows the Rust tests need the MSVC `PATH` recipe (`CLAUDE.md` Development).

### v2.1.3 ledger (command-line launcher, Windows installers)

Nothing below has been observed in an installed bundle yet; every row is open unless it says what was seen. The Windows build gate (`cargo tauri build --target x86_64-pc-windows-msvc`) produced both bundles; the MSI tables (Environment, Component, Registry) and the NSIS hook logic were checked offline (a throwaway test exe against a scratch registry key), not by installing.

**Observed**
- **Windows Installer transactions on the dev box, 2026-10-15 (not planned).** The Application log (MsiInstaller, all under the user's SID) shows, for `Garita_2.1.2_x64_en-US.msi` built under `src-tauri/target/.../bundle/msi/`: a "success" pair (1033/11707) at 14:56:31 with no transaction begin/end, a 1602 at 14:57:57 (cancelled; an install UI was shown), a full transaction (1040 → 1042) and success at 14:58:05 to 14:58:08, and a begin and end within the same second at 15:01:56, which fits an `msiexec /a` admin extraction. The 14:56:31 pair is the bundle build, not an install: the 2.1.2 bundles were written at 14:56, and the 2.1.3 rebuild (`make windows`, 19:22:47) logged the same 1033/11707 pair with no 1040/1042 while the registered product stayed 2.1.2. An admin install neither registers the product nor writes PATH, so the registration and the PATH entry came from the full install at 14:58. Its cause is not established. Observed afterwards: the product is registered; the system PATH holds exactly ONE `C:\Program Files\Garita\` (one full install is evidenced, so a reinstall not duplicating it is still unverified); the HKCU PATH holds no Garita entry; `HKLM\Software\Garita\PathEntry=1` exists. This is the `path.wxs` component behaving as written, seen by accident, not a verification run. The user decides the cleanup. **Row stays open: the MSI uninstall removes the PATH entry and the HKLM key** (not verified until the cleanup is checked).
- **Linux (Docker, 04eb88a):** `cargo clippy --all-targets` exit 0 and 264 tests pass; the one warning (`expand_env` unused off Windows) is fixed by a `cfg_attr` allow. This covers Linux only; the macOS compile row below stays open.

**Open**
- **cfg(unix) compile (M2):** `cargo check` and `cargo test --lib` on macOS and on Linux (WSL Ubuntu with the Linux build deps is enough). Covers the detach, the stderr gating, the macOS `install_cli_command` (now a loop over `install_links`) with its `statfs` and `access` (`mac_admin`) shims, the `user_bin` probe in `current_probe`, and the Linux status path (including the Linux `mac_admin` stub). Closes before the tag.
- **cfg(unix) runtime:** `garita` from a terminal opens the app detached and closing the terminal leaves it running; stderr lines for an ignored token appear only on a terminal.
- **`.deb`/`.rpm`:** `dpkg -c` / `rpm -qlp` list `/usr/bin/garita`; Settings reads "on your PATH, installed by the package".
- **macOS:** `Garita.app/Contents/MacOS/garita` exists; the Settings install creates `/usr/local/bin/garita` and `garita` launches past Gatekeeper; a non-writable or absent `/usr/local/bin` shows the `sudo` line (with `mkdir -p` when absent); the cask `binary` stanza links into the Homebrew prefix and Settings reads that as installed.
- **NSIS install and uninstall:** a fresh install adds `$INSTDIR` to the user PATH; `garita --version` prints in a new PowerShell and cmd window; a Start-menu launch shows no console; uninstall removes exactly that entry. With an ordinary PATH containing `%USERPROFILE%`-style entries, PATH is byte-identical after install then uninstall and the value type is still `REG_EXPAND_SZ` (the only check that `ReadRegStr` returns the raw value on a real key; the offline test showed the raw value survives).
- **PATH over 1024 characters:** PATH is byte-identical after install and after uninstall, and Settings shows the folder.
- **User PATH of 1000 to 1023 characters that contains our entry:** stays byte-identical after uninstall (the uninstall hook leaves it untouched; our entry stays). Offline test passed at 1000, 1022 and 1023; a real NSIS uninstall is still to do.
- **MSI (admin install):** the folder is on the system PATH after install and gone after uninstall.
- **SmartScreen:** the site text matches what SmartScreen shows for the unsigned installers.
- **Forwarding:** with the app running, `garita --context <other> -n kube-system pods` focuses the window and lands on that view on macOS, Linux and Windows; with a dialog open it defers with **Go now**; an unknown context shows the strip; a second `garita` during startup is not lost (K6).
- **Updater:** `latest.json` lists 5 platforms including `windows-x86_64-nsis` and `-msi`; a Windows install shows the notice and Download opens the release page.
- **Scoop:** `scoop install https://kanomnut.github.io/garita/scoop/garita.json` installs the current version; `garita` through the shim gives the prompt back instead of blocking on the GUI app and `garita --help` prints; `scoop update garita` picks up the next release. Cannot close while the repo is private (Pages and release downloads).
- **Download links and Pages:** the 5 `releases/latest/download/` links and the Scoop render resolve once the repo is public and a release is published.

### Live harness ledger (v2.1.2 run, `make live`)

One run of the harness (`live-verification.md`) on a throwaway kind cluster: Kubernetes v1.31.0, three nodes, Docker Desktop on Windows, 22 live tests, 0 failures in the final run (earlier failures were harness bugs, fixed in the harness). Rows below are only what that run observed; every row of "Verification owed" not named here is **still owed**. "Not coverable" means the harness cannot reach it (reason given); it stays a manual row.

**Observed**
- **v1.2.1:** PDB refusal: `evict_pod` returns `blocked` with "Cannot evict pod as it would violate the pod's disruption budget."; a completed pod returns `evicted`, never 429; `involvedObject.kind` field selector accepted (Deployment events include `ScalingReplicaSet`); `preview_node_drain` on a worker.
- **v1.3.0:** Background delete of a Job removes its pod; Deployment `orphan` keeps ReplicaSet and pods; `since_seconds` + `timestamps` + `tail_lines` together, and `previous`; start rejection text `Failed to stream logs: container nope is not valid for pod logger`; rollback reuses the old ReplicaSet (two total, no duplicate); `scale_workload` write; Neat YAML hides `managedFields` on 14 kinds. Propagation strings are lowercase (`background`, `foreground`, `orphan`); `Background` errors.
- **v1.3.1:** `start_debug_container` (strategic merge on `ephemeralcontainers`, 1.31): a second container leaves the first. `preview_resource_yaml`: ok (dry run returns the edited object, nothing written), stale `resourceVersion` gives `conflict` ("the object has been modified"), bad YAML gives `invalid`; `apply_resource_yaml` round trip; `dropped_paths` empty for a ConfigMap. `preview_helm_upgrade`: ok with one rendered resource and the new values, `invalid` for bad values. `get_resource_yaml` / `_neat` for 10 namespaced and 4 cluster-scoped kinds incl. `nodes`, `sc`, `croles`, `crbindings`.
- **v1.4.0:** `list_api_presence` on a bare cluster returns only `installed` / `absent` / `unknown`, with `absent` rows. Problems: `crashloop`, `unschedulable`, `job-failed`, `service-no-endpoints` fire on fixtures; the namespace-scoped call returns `skipped: []`. `list_node_capacity` returns 3 rows with allocatable CPU and memory, usage `None` (no metrics-server) and no error.
- **v1.4.1:** Possibly unused lists the orphan ConfigMap and does not list ConfigMaps referenced only by a CronJob template, an init container or a projected volume. Deprecated APIs: a `last-applied` finding for a `batch/v1beta1` CronJob, `server_version` `v1.31.0`. Who can: a ServiceAccount reached through a RoleBinding shows `scope: namespace`; the cluster-admin groups appear; `subject_permissions` lists the Role's pods rule; `delete` does not list the viewer.
- **v2.1.2 proxy (T51-10):** http via squid and SOCKS5 each pass `check_cluster_access` (`ok`, `via_proxy: true`), list, get, logs, logs stream (`stream_pod_logs` channel, at least 2 lines), exec, port-forward (kube `portforward` through `client_for_context`) and a scale write against the internal server name; squid's access log shows `CONNECT garita-live-control-plane:6443`. Negative control: the internal context without proxy-url is `unreachable`, `via_proxy: false`. `-deadproxy`: `unreachable`, `via_proxy: true`. `list_contexts` shows `proxy` without `@` for the userinfo context, and that context connects. `list_helm_releases` works through squid. Every non-proxy test passed with a dead `HTTP(S)_PROXY` set (T51-7).

**Not coverable by the harness**
- `update` / `create pods/eviction` / `ephemeralcontainers` SSAR denials and fail-open (kind's admin is never denied; `can_i` allowed was observed only); read-only user behaviour.
- Exec-plugin auth, with or without a proxy; EKS/GKE served versions and non-RBAC notes.
- `oom-killed` Problems rule: kind on Docker Desktop reports the kill as reason `Error`, exit 137.
- Helm release with a removed API: the server refuses to install one on 1.31; only the `last-applied` path is covered.
- Everything under Diagnostics and the journal: `CONFIG_DIR` and the logger are never initialised under `cargo test`, so `log_write` is a no-op. All UI rows (Secret reveal, saved searches, banner copy, shell/attach TTY, appearance, Findings UI), v1.4.2, v2.0.0 and v2.1.0 L1 to L7 (release and updater).
- `node-drain` itself, node cordon/taint writes: nodes are not harness-owned (T51-6).

**Observed behaviour worth a row**
- **`pvc-pending` fires only after 5 minutes** (`pvc_pending`, `problems.rs`); the harness asserts it only with `GARITA_LIVE_SLOW=1` (not run).
- **Debug containers do not keep append order:** after two `start_debug_container` calls `spec.ephemeralContainers` read `dbg2 dbg1`. Both are present; the UI should not assume order.
- **`get_pod_logs` can return kubelet text as the log body** (`unable to retrieve container logs for containerd://<id>`) as `Ok`, for a container that has just started or restarted. Seen twice in the harness. The app shows it as log lines; open question whether to map it.
- **`helm_run` sees only the first `$KUBECONFIG` entry** (source-read, not run; real app limit, pre-existing): `kubeconfig_env_value` joins `enabled_kubeconfig_paths()`, which starts with `default_kubeconfig_display_path()` (first entry only) plus the registry. kube-rs calls use `Kubeconfig::read()` (the whole list), so a context defined only in the second or later `$KUBECONFIG` entry works everywhere except Helm. The harness avoids it with one combined file.
- **Test-only:** the global client cache outlives each `#[tokio::test]` runtime (`Service(Closed)`); `live::ctx()` calls `invalidate_client_cache()`. The app has one runtime and is not affected.

### Open bugs and limitations

- **Map edge stubs can share a line** (v2.3.0): in `graphLayout.ts` a horizontal exit or entry stub can run on another edge's line for 12-55 px when a source and another edge's target share a row in adjacent columns. The routing-invariant test covers only its fixture. Upgrade path: entry ports per edge, or `@dagrejs/dagre` (needs the user's OK).
- **Dialog focus return on macOS** (predates v2.3.0): WKWebView does not focus a clicked button, so a `ConfirmModal` opened by a click records `<body>` as its opener, and Cancel leaves focus on `<body>` until the next Tab. The Observability dialog's Cancel button focuses itself first (v2.3.0); an Esc after clicking Test, Use or Clear still lands on `<body>`. Root fix in the shared primitive: `ConfirmModal` treats a `<body>` opener as none and falls back, or an app-wide WebKit `pointerdown` focuses the pressed button. Needs a check on macOS.
- **Destructive primary hover contrast** (predates v2.3.0): the shared `ConfirmModal` destructive primary on hover (`text-bad` on `bg-bad/20`) is about 4.0:1 in the dark theme, below WCAG AA 4.5:1 for 12.5 px text (rest state about 4.6:1; computed from `src/index.css`, `docs/ux/19-v2.3.0-discard-confirm.md`). Fix in the token or the hover alpha, for every destructive dialog at once.
- **ArgoCD bulk-select scope** (v1.0.0): shift-range and "Select all" in `ArgoCDView` use the view's own `filtered` array, not `GenericResourceTable`'s sorted/searched view; after sort/search shift-range can span wrong rows. Fix needs a wider `GenericResourceTable` API (`Column<T>.header` is `string`).
- **ArgoCD header below ~720 px** (v1.0.0): 7 health cards + nowrap title overflow. Cheap step: move `items-start` from the card to the `extra` wrapper.
- **Label/annotation values unvalidated** (v1.1.0, deliberate). See Key & Quantity Validators.
- **Narrower PVC/PV `validateQuantity`** in `create/forms/storage.tsx` (v1.1.0, deliberate; fails closed). If it rejects a real value, point it at `edit/quantity.ts`; do not loosen the regex.
- **YAML tab drops fields newer than pinned `k8s-openapi`** (pre-existing). The Save preview lists them (`dropped_paths`). Guided edit is unaffected.
- **v2.2.0 deferred:**
  - Ghost nodes for dangling references (UX D4): a missing target shows no edge and no node.
  - Opening a panel from the map (UX X1): Open is `jumpFromHealth`, the list view filtered to the name.
  - Expanding a pod group in place: groups are collapsed-only; members are listed in the details strip.
  - Cross-namespace nodes (only PVs cross) and `imagePullSecrets` edges.
  - StatefulSet and DaemonSet ControllerRevisions in the Timeline.
  - Gateway API clusters that serve only `v1beta1` read as "none" (`gateway.rs` hard-codes `gateway.networking.k8s.io/v1`; existing behaviour).
  - Health pages have no distinct "Can't reach {cluster}" state (UX AC-18): an unreachable cluster shows the page's own "Couldn't …" error block with the raw message, not the STATE-VOCAB Unreachable state.
  - The Timeline's "Today" / "Nm ago" labels are computed when the list renders and go stale if the panel stays open past midnight (G3 T5).
  - Timeline day grouping uses one UTC offset (the current one) for every entry, so a DST change between an entry and now shifts its day (G3 T6).
  - A Timeline "Show in Journal" link (`TimelineTab.onOpenJournal` exists, the panel does not pass it).
- **Per-kind sites are synced by hand** (five silent tables + other sites). See Adding a New Resource Type.
- **Drain** (v1.2.1): no quit warning (closing leaves the node cordoned); does not wait for evicted pods to terminate; "Retry blocked pods" skips `failed` rows.
- **Helm Values upgrade has no RBAC hint** (v1.3.0, by design): an upgrade spans many kinds; no single `can_i` answers it. The YAML **Save…** is gated by `canUpdate`.
- **"Delete app only" clears all finalizers** (v1.3.0): `metadata.finalizers: []` drops other controllers' finalizers too.
- **Multi-pod backfill in arrival order** (v1.3.0, deliberate).
- **No log virtualisation** (v1.3.0): 5,000-line ring buffer, max 200 expanded JSON rows.
- **Merge-from-file preview stops at the first bad document** (v1.2.0, deliberate; `serde_yaml` hang).
- **Two cluster-scope predicates** (`CLUSTER_SCOPED_KINDS`, `viewHidesNamespacePicker`) deliberately disagree on `argocd` and friends. See `resource-types.md`.
- **Field managers unavailable on ArgoCD Applications and Helm releases** (v1.3.1): no Summary tab.
- **Compare and field managers lack `argo-appsets` / `argo-projects`** (v1.3.1): `gvk_for` needs discovery first.
- **Compare has no name combobox** (v1.3.1).
- **Hardcoded `v1alpha1`** (pre-existing): the `argocd` `gvk_for` row, `pods.rs` `argo-appsets` / `argo-projects` arms (yaml, replace, delete), and `live_api_resource`'s two literals. Fix by routing through `argo_api_resource`.
- **App log lacks kube-rs/hyper/Tauri records**; debug read logging covers three commands only (v1.3.1).
- **`dropped_paths` cannot see unknown `metadata.*`** (v1.3.1).
- **Debug containers cannot be removed** (structural). **Read-only is a hint** (by design).
- **Three CPU parsers** (v1.4.0, deferred): `utils::parse_cpu_millis`, `pods::parse_cpu_millis_usage`, `nodes::parse_cpu_millicores`. Memory is unified.
- **Health UX deferred from v1.4.0:** owner link on a finding (Q1); open panel after a Health jump (Q2); roving finding list and "Resolved" / "New critical" announcements; **No access** in `GenericResourceTable` for core views (Q12); header chip only if F4 dropped it. (The `Bar` / `DualZoneBar` move to `bar-*` and `metric-*` roles shipped in v1.4.2.)
- **Contrast failures kept by the v1.4.2 dark-parity lock** (`docs/ux/05-theme-settings-platform.md` §5, D1 to D6). Dark with the blue accent must match v1.4.1, so these stay until the user asks for a "contrast fixes" commit after signing off the parity screenshots. Each fix is one value.
  - **D1:** white `on-accent` on the blue accent (2.67, primary buttons) and on the `bg-bad/80` count badge (3.87). Fix: dark `on-accent` `#0b0d12`. The five non-blue dark accents already use it, because they have no parity to keep.
  - **D3:** DEBUG log lines use `text-log-debug`, whose dark value equals `dim` (3.30 on the log pane), so dark is parity-locked. Fix: dark `log-debug` `#7a8397`. Light already passes (`#5f6b80`).
  - **D4:** terminal `black` (1.05) and `brightBlack` (2.71). Fix: `brightBlack` `#7d8590`; leave `black`, which is a background colour in terminal themes.
  - **D5:** focus rings at `/40` to `/60` alpha (2.4 to 3.3). Fix: one 0.70 alpha; only focus states change.
  - **D6:** `log-match` / `log-highlight` tints against the pane (1.57 / 2.52). Fix: alpha 0.56 / 0.44.
  - **D2 and rows 7 and 8** are deliberate: `dim` as a glyph on card or overlay (2.77 / 2.44; `dim` as text is banned), `edge` / `edge-strong` hairlines and input borders (about 1.2) and the scrollbar thumb (about 1.2) are decorative. Changing them is visible in both themes.
- **Older focus rings are under 3:1 in light** (v1.4.2; `docs/ux/09-v1.4.2-acceptance.md` S3, U1 D5). The `ring-accent/40` to `/60` focus rings on fields, icon buttons and dialog inputs composite below 3:1 on panel and card for the blue, teal and amber accents. The new Appearance controls use `/70`. This is deferred work, not a parity lock in light: the alpha is a shared class, so the fix (`/70` on `focus` / `focus-visible` variants) also changes dark focus states.
- **Native `<select>` popups use the light native style on the dark UI** (v1.4.2). No `color-scheme` is set on purpose: it would restyle native controls in dark mode, a parity break.
- **Accepted dark-mode deltas of v1.4.2.** These are the only intended differences from v1.4.1; `ACCEPTED_DELTAS` in `themeTokens.test.ts` mirrors them.
  - **D-1:** `ring-gray-700` (`#374151`) became `ring-edge-strong` (white at 0.10; about `#353e4b` over gray-800). `ConfirmModal`, `GenericResourceTable`.
  - **D-2:** `text-yellow-400` (`#facc15`) and yellow-500 tints (`#eab308`) became `warn` (`#fbbf24`). Secret env-from chip, "ro" volume chip, "% of req" text.
  - **D-3:** blue-500 tints (`#3b82f6`) became `info` (`#60a5fa`). ConfigMap env-from chip.
  - **D-4:** the purple init chip was a no-op in v1.4.1 (its classes never emitted CSS); it is now styled with `status-purple` (`#a78bfa`).
  - **D-5:** the body background before React mounts, `#06080c`, became `surface-base` (`#0b0d12`), matching the app's first frame.
  - **D-6:** `text-black/50` on the identity dot's palette glyph became `text-surface-base/50`.
  - **D-7:** `bg-black/20` on the paste-kubeconfig textarea became `bg-surface-input` (`#111827`).
  - **D-8:** the native checkbox and radio tint changed from `accent-blue-400` (`#60a5fa`) to `accent-accent` (`#4ea1ff` in dark with the blue accent), a small hue shift. The tint now follows the chosen accent.
- **Constraints overstates scoped ResourceQuotas** (v1.4.0): says "applies to every pod" despite `scopes` / `scopeSelector`. Needs an additive field on `ResourceQuotaInfo` (`quotas.rs`) + TS mirror.
- **Option A, the strict #33 (v1.4.1, follow-up).** `get_resource_json`, `get_resource_yaml` and `get_resource_yaml_neat` still return the whole Secret for Reveal, the YAML tab, the guided editor, Field managers and Compare. These copies are dropped on close (`secretReadOptions`, `forgetSecret`). Backend stripping without `reveal` is blocked by two things. A stripped object is the base the guided editor diffs against and the YAML tab replaces with, so using it wipes the Secret. Compare and the merge preview compute changed or unchanged from the values. It needs a separate reveal-only read and a value-free base first.
- **Deprecation table not diffed against the published guide** (v1.4.1). The 43 entries were reviewed at the release check (B-24, no wrong row found). Verify a `removed_in` before relying on it.
- **The deprecation scan decodes every deployed Helm release in backend memory** (v1.4.1). It runs on demand and drops the decoded release, but cost grows with the number and size of releases.
- **Possibly unused still transfers the non-excluded Secrets' values into backend memory** (v1.4.1). The `type!=` field selector drops SA tokens and Helm release blobs on the server. `list_metadata` cannot carry `type`.
- **Who-can grants collapse to one row per binding** (v1.4.1, ruled B-22 (a)). With several matching rules, `resource_names` is non-empty only if all of them are named-only. Follow-up: compute `via_wildcard` from the rules that decide the grant, not from every matching rule (`rbac.rs` `compute_who_can`).
- **Possibly unused has no presence field** (v1.4.1, ruled B-23 (d)). The Gateway and Certificate lines come from `useApiPresence` keys `gw` / `cert`. Unchecked kinds come from `skipped` plus `REQUIRED_SOURCES`.
- **Journal path** (v1.4.1, accepted B-25): `<app_log_dir>/journal.jsonl`, rotated with the shared `rotate_file`.
- **The journal cursor skips entries in the boundary millisecond** (v1.4.1, follow-up). `page` returns entries strictly older than `before`, so a page boundary that falls inside one millisecond drops the rest of it. A `(ts, index)` cursor fixes it.
- **The last-applied scan lists whole objects** (v1.4.1, follow-up). `scan_deprecated_apis` lists each table kind in full to read one annotation; `list_metadata` would transfer much less.

- **Live harness workflow** (v2.1.2, T51-11): after U2, a separate `.github/workflows/live.yml`, `workflow_dispatch` only, outside `CI OK`, actions pinned to SHAs, passing actionlint and zizmor. Until then the harness runs on a developer machine (`make live`).
- **Unparsable env proxy** (v2.1.2, T51-7): an `HTTP_PROXY`-style value that `http::Uri` cannot parse still fails inside `from_custom_kubeconfig` before `client_for_context` overwrites `config.proxy_url`. Pre-existing; not fixed.
- **`https://` proxies and SOCKS5 credentials** (v2.1.2): refused with a message (kube 0.95 cannot do either). They arrive with a kube upgrade (kube-client 4.2.0 has both); its errors may format the proxy URL, so the `scrub` userinfo rule is already in place.
- **A 407 banner class** (v2.1.2, deferred): a 407 reaches the banner as `unreachable` with the detail `unsuccessful tunnel (HTTP/1.1 407 ...`; a later class can match it.
- **Rejected proxy-url lands in the `auth` state** (v2.1.2, T51-3, frozen state set; see `cluster-access.md` Proxy URL).
- **Plain `http://` API server behind an HTTP proxy is unverified** (v2.1.2): kube does not add proxy headers to non-tunnelled requests.

### Structural, not bugs

- ArgoCD Events tab shows controller events about the Application only, not workload events in `dest_namespace`. Path: Resources tab → workload → its Events tab.
- AppProjects effectively never emit events.
