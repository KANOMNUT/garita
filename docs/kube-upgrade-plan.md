# kube-rs Upgrade Plan: 0.88 → 0.95

## 1. Executive Summary

| Item | Detail |
|------|--------|
| CVEs closed | GHSA-82j2-j2ch-gfr8, GHSA-965h-392x-2mh5, GHSA-xgp8-3hg3-c2mh |
| Root cause | `rustls 0.21.x` and `rustls-webpki 0.101.x` in dependency tree |
| Fix | kube 0.90+ pulls `rustls 0.23` which requires `rustls-webpki ≥ 0.102` |
| Target kube version | **0.95.0** (released 2024-09-16) |
| k8s-openapi pairing | **0.23.0** (mandatory — must upgrade together) |
| MSRV change | 1.75 → **1.77.2** (kube 0.95 workspace requirement) |
| Estimated effort | **1–2 dev days** |
| Risk level | **Low-Medium** — changes are Cargo.toml-only; no source code changes are anticipated based on API verification |

The Cargo.lock already has both `http 1.x` and `hyper 1.x` present (pulled by Tauri), so the ecosystem transition is already partially in place. The kube upgrade aligns kube itself to the same ecosystem versions.

---

## 2. Dependency Changes

| Crate | Old version | New version | Breaking? |
|-------|-------------|-------------|-----------|
| `kube` | `0.88` | `0.95.0` | Yes — see Section 3 |
| `k8s-openapi` | `0.21` (feature `v1_28`) | `0.23` (feature `v1_31`) | Yes — must change feature flag |
| `http` | `0.2` | `1.1` | Yes — import path unchanged, same builder API; Cargo.toml entry must change |
| `rustls` (transitive) | `0.21.12` (vulnerable) | `0.23.x` (via kube 0.90+) | CVE fix |
| `rustls-webpki` (transitive) | `0.101.7` (vulnerable) | `≥ 0.102` (via rustls 0.23) | CVE fix |
| `hyper` (transitive) | `0.14.32` | `1.x` | No change to Watchtower code |
| `tokio-tungstenite` (transitive) | `0.21` | `0.24` | No change to Watchtower code |

### Cargo.toml diff

**File:** `src-tauri/Cargo.toml`

```diff
-kube = { version = "0.88", features = ["runtime", "derive", "ws", "client"] }
+kube = { version = "0.95", features = ["runtime", "derive", "ws", "client"] }

-k8s-openapi = { version = "0.21", features = ["v1_28"] }
+k8s-openapi = { version = "0.23", features = ["v1_31"] }

-http = "0.2"
+http = "1"
```

No other direct dependencies need version changes. `rust-version` in `[package]` must also be bumped:

```diff
-rust-version = "1.75"
+rust-version = "1.77.2"
```

---

## 3. Breaking Changes Analysis

### 3.1 `terminal_size()` API — shell.rs (VERIFY — NO CHANGE EXPECTED)

**Verification source:** `kube-client/src/api/remote_command.rs` at tag `0.95.0`, lines 5–25.

The `terminal_size()` method on `AttachedProcess` returns `futures::channel::mpsc::Sender<TerminalSize>` in **both** kube 0.88 and kube 0.95. The sender type did not change. The kube 0.95 source uses:

```rust
use futures::{
    channel::{mpsc, oneshot},
    FutureExt, SinkExt, StreamExt,
};
...
type TerminalSizeSender = mpsc::Sender<TerminalSize>;
```

The `try_send()` calls in `shell.rs` (lines 69 and 73) are inherent methods on `futures::channel::mpsc::Sender` and will compile without modification.

**CLAUDE.md note is still accurate** — `try_send` remains the correct call. No changes needed to `shell.rs`.

**Optional — if you want `.send().await` style:** Add `use futures::SinkExt;` to shell.rs imports AND keep `mut ts_sink` (SinkExt::send takes `&mut self`). Only do this for stylistic alignment with kube documentation examples; it is not required.

**Affected file:** None — no change required.

If `cargo check` produces an unexpected error against this file, record the exact message and compare against the fallback in the Phase 2 deviation note.

### 3.2 `http` crate major version — argocd.rs (MAJOR)

**Change introduced in:** kube 0.89

Watchtower directly imports `http = "0.2"` and constructs `http::Request` objects in `argocd.rs`. The `http` crate's builder API is identical between 0.2 and 1.x — `Request::get()`, `Request::builder()`, `.header()`, `.body()` all work the same way. The only required change is updating Cargo.toml (already captured in Section 2) and ensuring the import resolves to the new version.

`kube::Client::request<T>()` in kube 0.95 still takes `Request<Vec<u8>>` as input — the signature is unchanged. No code changes in argocd.rs are required beyond the Cargo.toml version bump.

**Affected file:** `src-tauri/src/commands/argocd.rs`

**Affected sites (compile-verify only — no code change needed):**
- Line ~122: `http::Request::get(path.as_str()).header(...).body(body)`
- Lines ~309–314: `http::Request::get(path).header(...).body(body)` in `proxy_revision_metadata()`
- Lines ~338–343: `http::Request::builder().method("POST").uri(...).header(...).body(login_body.into_bytes())` in `proxy_argocd_login()`

If the compiler reports a type mismatch on `.body()` at any of these sites, the fix is:
```diff
-let body: Vec<u8> = vec![];
+let body: Vec<u8> = vec![];  // unchanged — http 1.x body(Vec<u8>) is identical
```
This is not expected to be needed. Document any error here if it surfaces.

### 3.3 `k8s-openapi` feature flag — all command files (REQUIRED)

The `v1_28` feature no longer exists in k8s-openapi 0.23. The feature must change to `v1_31` in Cargo.toml (captured in Section 2). This is a Cargo.toml-only change. No source code changes — the k8s API types used by Watchtower (Pod, Deployment, StatefulSet, Service, etc.) are all stable and present in v1_31.

**Risk:** If any struct field used in the codebase was added after 1.28 or removed before 1.31, the compiler will surface it. Given Watchtower uses only stable core/apps/networking/rbac/storage API types, the risk of field removal is very low.

### 3.4 MSRV bump (REQUIRED)

kube 0.95 sets `rust-version = "1.77.2"` in its workspace. Cargo will enforce this. The project's `rust-version = "1.75"` in Cargo.toml must be bumped to `1.77.2`. CI/CD pipelines and local toolchains must be updated to use at least rustc 1.77.2.

Check your toolchain:
```bash
rustc --version   # must be ≥ 1.77.2
rustup update stable
```

### 3.5 `watcher::Event` variants — NOT AFFECTED

kube 0.92 introduced a breaking change to `watcher::Event` (new `Init`, `InitApply`, `InitDone` variants). Watchtower does not use `kube_runtime::watcher`, `reflector`, or `Controller`. The `runtime` feature is requested in Cargo.toml but Watchtower only uses the `client` API (`Api<T>`, list/get/watch calls). No action required.

### 3.6 `portforward` API — NO CHANGE

`api.portforward()`, `pf.take_stream(port)`, and `pf.join()` have the same signatures in kube 0.95 as in 0.88. `portforward.rs` requires no changes.

### 3.7 `exec` / `AttachedProcess` stdin/stdout — NO CHANGE

`attached.stdin()`, `attached.stdout()`, `attached.stderr()` return the same `Option<impl AsyncRead/AsyncWrite + Unpin>` in kube 0.95. `terminal_size()` is also unchanged (see 3.1). No changes to `shell.rs` or `pods.rs` exec usage.

### 3.8 `ApiResource` struct literal — VERIFY AT COMPILE TIME

`argocd.rs` constructs `ApiResource` as a struct literal. This struct is in `kube-core` and its fields did not change between 0.88 and 0.95. No code change expected — verify at compile time.

### 3.9 `ListParams::default().labels()` / `.fields()` — NO CHANGE

The builder methods `.labels()` and `.fields()` on `ListParams` are unchanged in kube 0.95. Used in `argocd.rs`, `portforward.rs`, and `nodes.rs` — no action required.

### 3.10 `Config` / `Kubeconfig` / `KubeConfigOptions` — NO CHANGE

`utils.rs` uses `Config::from_custom_kubeconfig()`, `KubeConfigOptions`, `Kubeconfig::read()`. These APIs are stable and unchanged across the 0.88–0.95 range.

### 3.11 `context.rs` — ctx.cluster / ctx.user field types

The `ctx.cluster` and `ctx.user` fields (noted in code comments as `String in kube 0.88`) remain `String` in kube 0.95's `NamedContext`. No change required.

---

## 4. Migration Phases

### Phase 1: Cargo.toml bump + compile error triage

**Goal:** Get the project compiling. All code changes happen here based on actual compiler errors.

**Steps:**

1. Edit `src-tauri/Cargo.toml`:
   - Change `kube` version from `"0.88"` to `"0.95"`
   - Change `k8s-openapi` version from `"0.21"` + feature `"v1_28"` to `"0.23"` + feature `"v1_31"`
   - Change `http` version from `"0.2"` to `"1"`
   - Change `rust-version` from `"1.75"` to `"1.77.2"`

2. Run `cargo check 2>&1 | tee /tmp/kube-upgrade-errors.txt` from `src-tauri/`

3. Expected errors and resolutions:

   | Expected error | File | Fix |
   |----------------|------|-----|
   | Feature flag `v1_28` not found in k8s-openapi 0.23 | Cargo.toml | Already resolved by changing to `v1_31` |
   | Any type mismatch on `http::Request` body | `argocd.rs` | See Section 3.2 fallback (unlikely) |
   | Unexpected API change in `AttachedProcess` | `shell.rs` | Record error text; compare against Section 3.1 |

   No shell.rs errors are expected. The terminal_size sender type is `futures::channel::mpsc::Sender` in both 0.88 and 0.95 (verified against kube 0.95.0 source).

4. For any unexpected errors: record the error text and file:line, apply the minimal fix, and document it in a deviation note appended to this plan.

5. Run `cargo check` again until clean.

**Acceptance criteria:** `cargo check` exits 0.

---

### Phase 2: shell.rs — compile verification

**Goal:** Confirm shell.rs compiles without changes. No code edits are expected.

After Phase 1 `cargo check` passes, explicitly verify:
```bash
cargo check -p Watchtower 2>&1 | grep shell
```
Expected output: empty (no errors).

**Deviation note:** If `cargo check` surfaces an error against shell.rs, record the exact compiler message. The most likely scenario is a `try_send` method resolution issue if any intermediate kube version changed the sender type. In that case, the fix would be to add `use futures::SinkExt;` to shell.rs and replace `try_send(size)` with `send(size).await` while keeping `mut ts_sink` — but do NOT apply this change pre-emptively.

**Acceptance criteria:** `cargo check` clean, interactive shell test passes (Phase 4).

---

### Phase 3: http crate migration verification (argocd.rs)

**Goal:** Confirm `http 1.x` does not break the ArgoCD request construction.

The builder API in `http 1.x` is source-compatible with `0.2.x` for the patterns used in argocd.rs. No code changes are anticipated. After Phase 1 `cargo check` passes, verify:

```bash
cargo check -p Watchtower 2>&1 | grep argocd
```

If there are type errors (unlikely), the fix pattern is:

For `Request::get(path).body(vec![])`:
```rust
// http 0.2 and 1.x — identical for Vec<u8> body
let body: Vec<u8> = vec![];
let req = http::Request::get(path)
    .header("Accept", "application/json")
    .body(body)
    .map_err(|e| format!("Bad request: {}", e))?;
```

For `Request::builder().method("POST").uri(...).body(bytes)`:
```rust
// http 0.2 and 1.x — identical
let req = http::Request::builder()
    .method("POST")
    .uri(login_path.as_str())
    .header("Content-Type", "application/json")
    .body(login_body.into_bytes())
    .map_err(|e| format!("Bad request: {}", e))?;
```

**Acceptance criteria:** `cargo check` clean, ArgoCD commit metadata test passes (Phase 4).

---

### Phase 4: Full verification

**Goal:** Confirm runtime correctness. All tests below must pass before merging.

See Section 5 (Test Checklist).

Run the full build:
```bash
cd <repo>
make deps
make build   # or: cargo tauri dev for interactive testing
```

Verify `rustls` and `rustls-webpki` versions in the lockfile:
```bash
grep -A2 "name = \"rustls\"" src-tauri/Cargo.lock | head -6
grep -A2 "name = \"rustls-webpki\"" src-tauri/Cargo.lock | head -6
```

Expected:
- `rustls` version: `0.23.x`
- `rustls-webpki` version: `0.102.x` or higher

If either still shows `0.21.x` / `0.101.x`, a transitive dep is pinning the old version. Fix with:
```bash
cargo update -p rustls
cargo tree -i rustls   # to identify what pins it
```

---

## 5. Test Checklist

Execute each item against a live cluster (minikube or real) with `cargo tauri dev`. Mark each complete before merge.

### 5.1 Pod log streaming
- [ ] Open a pod detail panel and navigate to the Logs tab
- [ ] Verify real-time log lines appear for a running pod
- [ ] Verify the "Previous instance" toggle works (fetches prior container logs)
- [ ] Verify the Download button produces a non-empty file
- [ ] Verify log streaming continues for >30 seconds without disconnect

### 5.2 Interactive shell
- [ ] Open a pod detail panel and navigate to the Shell tab
- [ ] Verify the terminal renders with correct dimensions (no `$$$$` prompt-wrapping)
- [ ] Type `echo hello` and confirm output appears
- [ ] Resize the Watchtower window and verify the terminal reflows correctly (resize_shell path)
- [ ] Open a second shell on a different pod simultaneously; confirm both sessions are independent
- [ ] Close the panel and reopen — verify a new session starts cleanly (old session aborted)

### 5.3 Port-forward — pod
- [ ] Select a pod with a known port (e.g., nginx on 80)
- [ ] Start a port-forward via the Forward tab in DetailPanel
- [ ] Confirm `curl http://127.0.0.1:<local_port>/` returns the expected response
- [ ] Stop the forward and confirm the local port is released (subsequent curl fails)

### 5.4 Port-forward — service
- [ ] Select a Service with a backing deployment
- [ ] Start a service port-forward
- [ ] Confirm traffic reaches a healthy pod behind the service
- [ ] Verify that selecting a service with no selector returns "Service has no selector" error

### 5.5 ArgoCD commit metadata
- [ ] With an ArgoCD Application visible in the UI, open its detail panel
- [ ] Confirm the commit message and author fields are populated
- [ ] Test against a cluster where the ArgoCD API server is accessible via port-forward path (Strategy 1)
- [ ] If available, test the K8s API-server proxy path (Strategy 2/3)

### 5.6 Context switching
- [ ] Open the Context Switcher modal (keyboard shortcut or sidebar)
- [ ] Switch to a different kubeconfig context
- [ ] Verify pod list refreshes and shows resources from the new cluster
- [ ] Switch back to the original context

### 5.7 YAML apply (get + edit + apply)
- [ ] Open a Deployment detail panel and navigate to the YAML tab
- [ ] Modify a label value in the YAML editor
- [ ] Click Apply and confirm the change is reflected in the cluster (`kubectl get deploy -o yaml`)
- [ ] Test on at least one cluster-scoped resource (e.g., a ClusterRole) to exercise the `fetch_all!` / `replace_all!` macros

### 5.8 CVE verification
- [ ] After upgrade, run: `cargo audit` (install with `cargo install cargo-audit`)
- [ ] Confirm GHSA-82j2-j2ch-gfr8, GHSA-965h-392x-2mh5, GHSA-xgp8-3hg3-c2mh are no longer reported
- [ ] Confirm rustls in lock is 0.23.x: `grep -A2 'name = "rustls"' src-tauri/Cargo.lock`

---

## 6. Rollback Plan

The upgrade is confined to `Cargo.toml` and one source file (`shell.rs`). Rollback is a git revert.

**Steps:**
1. `git revert <commit>` or `git checkout <pre-upgrade-commit> -- src-tauri/Cargo.toml src-tauri/Cargo.lock`
   - If any source files were changed during Phase 1/2/3 triage, include those files in the checkout as well
2. `cargo build` to restore the old lockfile
3. Verify the app builds and launches

There are no database migrations, no API contract changes, and no frontend changes associated with this upgrade. The rollback is clean and total.

**Note:** Cargo.lock is committed (Tauri convention for apps). Include it in both the upgrade commit and any rollback — do not leave the lockfile in a state that resolves to mixed old/new versions.

---

## 7. Post-Upgrade Housekeeping

1. Update `CLAUDE.md` — the note under "Shell Terminal" currently reads:

   > `terminal_size()` returns `futures::channel::mpsc::Sender` in kube-rs 0.88 — use `try_send`, not `.send().await`.

   The note remains factually correct after the upgrade — `terminal_size()` still returns `futures::channel::mpsc::Sender` in kube 0.95. Update the kube version reference only:

   > `terminal_size()` returns `futures::channel::mpsc::Sender` — use `try_send` (non-blocking inherent method). If using `futures::SinkExt`, you can also use `.send().await` with `mut` on the sink, but `try_send` is sufficient and does not require the import.

2. Remove `http = "0.2"` note from any inline comments in argocd.rs if present.

3. Run `cargo audit` in CI — add `cargo install cargo-audit && cargo audit` as a CI step if not already present to catch future CVEs early.

4. Consider pinning to `kube = "0.95"` (exact minor) rather than `"~0.95"` until the team validates that 0.96+ does not introduce new breaking changes relevant to this codebase.

---

## 8. Open Questions

| # | Question | Owner | Unblocks |
|---|----------|-------|---------|
| 1 | Is rustc 1.77.2 available in CI and on all dev machines? | DevOps | Phase 1 |
| 2 | Does the test cluster have ArgoCD installed for 5.5 testing? | QA | Phase 4 |
| 3 | Is `cargo audit` already in CI? If not, who adds it? | DevOps | Post-upgrade |

---

*Plan authored: 2026-05-26. Based on kube-rs CHANGELOG 0.89–0.95, kube-client 0.95.0 source (remote_command.rs), and direct inspection of Watchtower src-tauri codebase.*
