# Helm

Section names are grep targets (`CLAUDE.md`, Detailed docs).

## Helm

Shell-out only: `helm.rs` spawns `helm` via `tokio::process::Command`. kube-rs is not used for Helm.

- `helm_path()` prepends auth-plugin dirs to `PATH` per invocation: GKE (`gke-gcloud-auth-plugin`), EKS (`aws-iam-authenticator`, AWS CLI v2 `/usr/local/aws-cli/v2/current/bin`), AKS (`kubelogin`, `~/.azure/bin`), krew (`~/.krew/bin`). `fix_path()` in `lib.rs` does the same at startup for kube-rs. Needed when the app launches outside a terminal.
- `friendly_helm_error()` turns provider auth errors into install instructions.
- **`helm_run` sets `KUBECONFIG` to the enabled registry paths.** helm resolves `--kube-context` against its own `$KUBECONFIG`; without this, contexts from registered non-default kubeconfigs fail every Helm call with "context not found". Never drop it.
- `helm_run` wraps `helm_output`, which returns raw output so the preview can tell a render failure from an unrunnable binary.
- Detail tabs: Overview / Values / History / Events (no YAML). History lists `list_helm_history` with per-revision Rollback (`rollback_helm_release`).
- Values tab: inline edit, **Review upgrade…** opens the PREVIEW-GATE (`preview_helm_upgrade`, see `writes.md`), then `upgrade_helm_release`. `useUpgradeHelmRelease` invalidates `["helm-releases", context]` and the redacted `["helm-values", context, namespace, release]`, and removes the revealed key (`forgetHelmValues`).
- All four writes (upgrade, install, uninstall, rollback) go through `log_write`: one app-log line plus one journal entry (upgrade/install summary `values: <n> top-level keys`).

### Helm Values: redacted by default (v1.4.1, #33)

`get_helm_values(context, namespace, release, reveal: Option<bool>)` runs `helm get values -o yaml` (so there is no `USER-SUPPLIED VALUES:` header; `null` or empty becomes `""` on both paths). Unless `reveal == Some(true)`, `redact_values` parses a **single** document (`serde_yaml::from_str`, never an iterator) and replaces every scalar whose nearest enclosing mapping key contains `password|secret|token|key|credential` (case-insensitive; `HELM_REDACT_KEYS`, the Rust twin of `diffRows.ts` `CREDENTIAL_KEY`: change both together; it is not `app_log.rs` `SCRUB_KEYS`) with `HELM_REDACTION_SENTINEL` (`<redacted>`, mirrored in `secretReveal.ts`). A sequence passes its key to its scalars; a map inside it uses its own keys (`imagePullSecrets: [{name: regcred}]` keeps `regcred`). Unparsable input returns `# Values could not be parsed for redaction. Use Reveal to view them.`, never raw text. Comments and ordering are not preserved in the redacted view. `reveal` is `Option<bool>` (additive IPC param rule).

- **Reveal to edit.** The redacted view is read-only and has no plain Edit. It offers **Reveal and edit…** (fetches `reveal: true`, then opens the editor) and **Copy redacted text**; when the redacted text is empty it offers **Add values…**, which seeds `""` with no fetch. Values under credential-looking keys are redacted; other values may still be sensitive, and the note says so (nothing calls the redacted text safe).
- **The editor is seeded only from the revealed read** (`helmEditSeed` reads the key `["helm-values", ctx, ns, release, "revealed"]`; a vitest pins it). The revealed query spreads `secretReadOptions`, is mounted in the panel root, and is removed by `forgetHelmValues` on Hide, panel close, selection change and a successful upgrade.
- **Guard.** `upgrade_helm_release` and `preview_helm_upgrade` refuse `values_yaml` containing the sentinel `<redacted>` **or** the pre-v2 sentinel `<redacted by Watchtower>` (`LEGACY_HELM_REDACTION_SENTINEL`, refused permanently) (`reject_redacted`), before any shell-out, with `Failed to upgrade: ...` / `Failed to preview upgrade: the values contain a redacted placeholder. Reveal the values and edit again.` The UI makes this unreachable (the review button is disabled while a placeholder is in the edit); it is the second line of defence.
- **Rendered manifest.** `preview_helm_upgrade.rendered_manifest` goes through `mask_rendered_secrets` (hang-safe `split_yaml_documents` loop; Secret `data` and `stringData` values become the sentinel; a parse error yields the fixed line `# The rendered manifest could not be parsed for masking.`). `resources`, `current_values` and `new_values` are unchanged.
- **Install dry run.** `install_helm_release` with `dry_run` returns the fixed line `Dry run succeeded. The rendered manifest isn't shown because it can contain Secret values.` on success (`install_output`), never helm's output; errors are unchanged. `HelmInstallModal` keys on the lower-cased text containing "dry run".
- **Find in values (v2.3.1).** The Values tab has the YAML find (`⌘F` / `Ctrl+F`, `ui.md` → YAML find (v2.3.1)). The redacted view searches the redacted string, so a value under a credential-looking key cannot be matched or counted, and the no-match hint says so (`REDACTED_NO_MATCH_HINT`, not shown in the edit view). The find is keyed on `${idKey}\u0000${helmRevealedNow}`, so Hide unmounts it and drops the query. It reads only the text it is given, never a query cache.

### Helm upgrade — source-agnostic via the K8s release secret

`upgrade_helm_release` **never** uses `helm search repo` (the user's configured repo is often not where the chart came from: private repos, OCI, CI, local → `no chart version found`). Helm embeds the full chart in the release secret, so:

1. List secrets labelled `owner=helm,name=<release>`; take the highest `sh.helm.release.v1.<release>.v<N>`.
2. Decode `release`: `base64(gzip(json))`. kube-rs already strips the outer K8s base64, so `ByteString.0` is helm's bytes: base64-decode, gunzip, parse. Do NOT round-trip through `serde_json::to_value` (re-encodes base64).
3. `write_chart_to_dir()` writes the embedded chart to a tempdir (Chart.yaml, values.yaml, nested templates/, files/, values.schema.json, charts/).
4. `helm upgrade <release> <tmp_dir> --values <tmp_file> --namespace <ns> --kube-context <ctx>`.

Signature unchanged (`context`, `namespace`, `release`, `chart_name`, `chart`, `values_yaml`); `chart_name`/`chart` are ignored. Needs `base64` and `flate2`. **Never revert to a repo lookup.** `preview_helm_upgrade` reuses `extract_chart_from_k8s` and `split_yaml_documents`.

## Helm Uninstall vs Delete (v0.9.3)

Releases are uninstalled, not deleted. `GenericResourceTable` takes `deleteLabel?` / `deleteIcon?`; `HelmView` passes `"Uninstall"` + `<PackageMinus />`. The panel header tooltip reads "Uninstall HelmRelease". Uninstall uses `helm.rs`, not `delete_resource`.

## Helm Install / Rollback / History (v1.2.0)

Commands: `list_helm_history`, `rollback_helm_release`, `install_helm_release`, `list_helm_repos`. All use `helm_path()` and `friendly_helm_error()`.

- **`install_helm_release` must NOT use the release-secret path.** The rule "upgrade extracts the chart from the release secret, not `helm search repo`" covers upgrading an existing release only. An install has no release secret yet, so it needs a repo, OCI or local chart. The code carries a comment saying this. Never unify install and upgrade: doing so breaks upgrade.
- **Args via separate `.arg()` calls, never a shell string**: `chart` and `version` are user input that reaches a subprocess.
- `helm repo list` exits non-zero with no repos configured. That is `Ok(vec![])`, not an error.
- `rollback_helm_release` invalidates `["helm-releases", ctx]`, `["helm-values", …]`, `["helm-history", …]`.
- **`helm repo add` / `remove` / `update` are cut**, not deferred. `list_helm_repos` is read-only (install dropdown). Users run `helm repo add` once in a terminal; three write commands that shell out with user-supplied URLs are not worth that.
- Install is `HelmInstallModal.tsx` from the Helm view's `+New`. **`helm` is not a `CreatableKind`** and not in `CREATE_FORM`, because a Helm install is not a K8s manifest. It reuses `validateName` / `validateNamespace` from `create/emit.ts`.

### Release decoding (v1.4.1)

`decode_helm_release(bytes) -> Result<Value, String>` (pure, tested) is the only place a release Secret's `release` value is decoded: UTF-8, base64, gunzip, JSON. Both `extract_chart_from_k8s` and the deprecated-API scan (`deprecations.rs`) call it. The decoded release holds the chart and values and **never leaves the backend**. The scan reads only `manifest`, the release name and the namespace.
