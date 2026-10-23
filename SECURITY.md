# Security Policy

Garita holds cluster credentials and can change cluster state, so security reports get priority.

## Supported versions

Fixes go into the latest release. Older versions do not get backports; upgrade to the latest release.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/KANOMNUT/garita/security/advisories/new)).

Include:

- The Garita version and OS.
- What an attacker can do, and what they need first (a malicious cluster, a crafted kubeconfig, a crafted log line, local access, ...).
- Steps or a proof of concept. Use a throwaway cluster (kind, minikube); never send real credentials.

What to expect:

- Acknowledgement within 5 working days.
- An assessment and, if confirmed, a planned fix within 30 days of acknowledgement.
- Credit in the release notes and the advisory, unless you prefer not to be named.

Please give us a reasonable time to ship a fix before you disclose publicly.

## Scope

In scope:

- Credential or Secret value exposure: kubeconfig contents, tokens, Secret data or Helm values reaching logs, the action journal, the webview without a reveal, or anything outside the machine.
- Writes to the user's kubeconfig files, or files written with loose permissions.
- Cluster writes that bypass a confirmation, the read-only mode or a dry-run preview where the app promises one.
- Script injection in the webview (for example through pod logs, resource fields or YAML).
- Command injection in the Helm or OS-opener shell-outs.
- A crash caused by untrusted input (certificates, YAML, CRDs, Helm release data) from a cluster.

Out of scope:

- Actions a user with valid cluster credentials can already perform with `kubectl`. Garita acts with the user's own RBAC permissions.
- Read-only mode being bypassed by someone with local access to the machine: it is a safety guard, not a security boundary.
- The Gatekeeper warning on macOS: builds are ad-hoc signed by design.

## Verifying downloads

Each GitHub release includes `SHA256SUMS.txt` and an SPDX SBOM (`Garita-sbom.spdx.json`). Check a download with:

```bash
sha256sum --ignore-missing -c SHA256SUMS.txt       # Linux, Git Bash
shasum -a 256 --ignore-missing -c SHA256SUMS.txt   # macOS
```

When the repository is public, release files also carry signed build provenance:

```bash
gh attestation verify Garita-linux-amd64.deb --repo KANOMNUT/garita
```
