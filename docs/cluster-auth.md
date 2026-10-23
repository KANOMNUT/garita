# Garita — Kubernetes Authentication and Cluster Connectivity

How Garita finds clusters and auth plugins. Contracts (registry rules, trust states, `can_i`) are in `docs/claude/cluster-access.md`.

## Kubeconfig contexts

- Garita reads the default kubeconfig (`~/.kube/config` or `$KUBECONFIG`) plus every **enabled** file registered in-app, unioned by `load_merged_kubeconfig()`. **It never writes to any of them.**
- `list_contexts` returns each context with its provenance (`source`, `shadowed_sources`) and `is_kubeconfig_default`.
- There is no context-switching command. The active context is app-local (`useActiveContext`, `localStorage`); every command takes `context` first. To change your kubectl default, run `kubectl config use-context <name>` (the switcher shows it with a copy button).
- One cached `kube::Client` per context per session. kube-rs refreshes tokens and runs exec plugins lazily, on the first request, so a built client proves nothing about auth. Registry changes call `invalidate_client_cache()`.

## Auth plugins

| Provider | Plugin | Install | Common location |
|----------|--------|---------|-----------------|
| GKE | `gke-gcloud-auth-plugin` | `gcloud components install gke-gcloud-auth-plugin` | `/opt/homebrew/share/google-cloud-sdk/bin/`, `~/google-cloud-sdk/bin/` |
| EKS | `aws-iam-authenticator` | `brew install aws-iam-authenticator` | `/usr/local/bin/`, `~/bin/` |
| EKS | `aws` (CLI v2) | `brew install awscli` or the [AWS pkg](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) | `/usr/local/aws-cli/v2/current/bin/` |
| AKS | `kubelogin` | `brew install Azure/kubelogin/kubelogin` | `~/.azure/bin/`, `/opt/homebrew/bin/` |
| OIDC | `kubelogin` or provider plugin | varies | `~/.krew/bin/`, `~/.azure/bin/` |
| krew | any `kubectl-*` | `kubectl krew install <plugin>` | `~/.krew/bin/` |

GKE service accounts: set `GOOGLE_APPLICATION_CREDENTIALS` to the key file before launch (for Finder launches, via a launchd plist).

## Why `PATH` is fixed at startup

macOS apps launched from Finder, Spotlight or Launchpad get launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), without Homebrew, gcloud, the AWS CLI or user installs. kube-rs then cannot spawn the exec plugin and auth fails.

Three layers handle it:

1. **`fix_path()`** (`lib.rs`, macOS only, at startup): runs `/bin/zsh -l -c` (then `/bin/bash`) sourcing both the profile and rc files, and takes the last output line containing `/` as `PATH`. If both fail, it prepends a static list: Homebrew, the gcloud SDK paths (Homebrew, pkg, Linux, snap, `~`), the AWS CLI v2 pkg paths, `~/.local/bin`, `~/bin`, `~/.azure/bin`, `~/.krew/bin`.
2. **`resolve_command()`** (`utils.rs`): rewrites each kubeconfig exec command to an absolute path before the client is built (login-shell lookup, then known paths, cached).
3. **`helm_path()`** (`helm.rs`): builds the same extended `PATH` for each `helm` subprocess, which spawns its own auth plugin.

## Testing auth

1. `cargo tauri dev` from a terminal: if it connects, the plugin is on your shell `PATH`.
2. Open the built `.app` from Finder: if it fails here only, add the plugin's location to `fix_path()`'s fallback list or to `~/.zprofile`.
3. `kubectl config view --raw | grep -A3 exec` shows the `command:` Garita must find.
4. The trust banner (`check_cluster_access`) names the failure: unreachable, expired auth, forbidden, or unknown, with an install hint for GKE, EKS and AKS plugins.

## Cluster quirks

- **Services:** some clusters (often GKE) deny cluster-wide `list`. `list_services` falls back to per-namespace lists; total denial is reported as an error, partial success returns what it could read.
- **Metrics:** without metrics-server, nodes show no usage bars (`cpu_percent: None`), and the pod Metrics tab shows "Metrics server not available or pod not yet scraped" (`usePodMetrics` does not retry).
- **StorageClass:** fields sit on the struct (`sc.provisioner`), not under `.spec`. Default class annotation: `storageclass.kubernetes.io/is-default-class`.
- **ArgoCD:** Applications are listed from all namespaces (the `argoproj.io` version is discovered at runtime). Commit info tries the `argocd` namespace first, then the application's own.
