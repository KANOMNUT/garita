# Garita — Build and Release

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust toolchain | stable >= 1.90 (`rust-version` in `Cargo.toml`) | `rustup install stable` |
| tauri-cli | ^2.0 | `cargo install tauri-cli --version "^2.0"` |
| Node.js | >= 18 | via nvm or official installer |
| npm | bundled with Node | — |

Platform-specific requirements are listed in the sections below.

---

## `make` Targets Reference

| Target | Platform | What it does | Output |
|--------|----------|-------------|--------|
| `make dev` | any | `cargo tauri dev` — hot-reload dev server | — |
| `make deps` | any | Installs Rust targets + Linux system packages + `npm ci` | — |
| `make build` | any | Auto-detects OS, delegates to `mac` / `linux` / `windows` | platform native |
| `make mac` | macOS only | ARM64 `.dmg` + ad-hoc sign + recreate DMG | `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/` |
| `make mac-universal` | macOS only | Universal binary (ARM64 + x86_64) `.dmg` | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/` |
| `make windows` | Windows only | x86_64 `.msi` + NSIS `.exe` | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/{msi,nsis}/` |
| `make linux` | Linux only | x86_64 `.deb` + `.rpm` + `.AppImage` | `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/{deb,rpm,appimage}/` |
| `make linux-deb` | Linux only | `.deb` only (Debian/Ubuntu) | `.../bundle/deb/` |
| `make linux-rpm` | Linux only | `.rpm` only (Fedora/RHEL/openSUSE) | `.../bundle/rpm/` |
| `make linux-appimage` | Linux only | `.AppImage` only (universal) | `.../bundle/appimage/` |
| `make linux-pacman` | Linux only | `.tar.zst` (Arch Linux pacman) | `.../bundle/pacman/` |
| `make clean` | any | `rm -rf dist && cargo clean` | — |

### When to use which target

- **Day-to-day development:** `make dev`
- **First setup on a new machine:** `make deps` then `make dev`
- **Produce an installer for your current OS:** `make build`
- **Apple Silicon distribution:** `make mac` — produces an ARM64-only DMG, faster build
- **Wide macOS distribution:** `make mac-universal` — fat binary works on both Intel and Apple Silicon
- **CI on each platform:** run the appropriate single-platform target

---

## Platform-Specific Requirements

### macOS

- Xcode Command Line Tools: `xcode-select --install`
- For universal builds, both Rust targets must be installed. `make deps` handles this, or manually: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- By default `tauri.conf.json` sets `"signingIdentity": "-"` for ad-hoc signing; no Apple Developer account is required. See [macOS Code Signing](#macos-code-signing) below.

### Windows

- MSVC build tools: install "Desktop development with C++" from Visual Studio Build Tools 2022, plus the MSVC Rust toolchain. The Makefile prepends the MSVC toolchain's bin dir to `PATH` and fails fast if the host is not MSVC (see `CLAUDE.md` Development).
- Rust target: `rustup target add x86_64-pc-windows-msvc` (or `make deps` on Windows)
- WebView2 runtime: included in Windows 10 1803+ and later. For older Windows, Tauri embeds the installer.

### Linux

`make deps` detects the distro (apt/dnf/zypper/pacman) and installs the necessary WebKit + AppIndicator + RSVG packages. The required packages are:

| Distro family | Key packages |
|---------------|-------------|
| Debian / Ubuntu | `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `squashfs-tools`, `libfuse2` |
| Fedora / RHEL | `webkit2gtk4.1-devel`, `libappindicator-gtk3-devel`, `librsvg2-devel`, `openssl-devel`, `patchelf`, `fuse-libs` |
| openSUSE | `webkit2gtk3-devel`, `libappindicator3-devel`, `librsvg-devel`, `libopenssl-devel`, `patchelf` |
| Arch | `webkit2gtk-4.1`, `libayatana-appindicator`, `librsvg`, `openssl`, `patchelf`, `squashfs-tools`, `fuse2` |

The `APPIMAGE_EXTRACT_AND_RUN=1` env var is set for AppImage builds to avoid requiring a FUSE mount in CI environments.

---

## macOS Code Signing

Garita ships **ad-hoc signed only**: no Apple Developer account, no Developer ID
certificate, no notarization. Both the Makefile (`mac` / `mac-universal`) and `release.yml`
run the same `codesign --sign -` step. Developer ID signing and
notarization were removed on 2026-05-27 and are not planned.

The app runs and can be distributed, but macOS shows a Gatekeeper warning on first launch
unless the user right-clicks and selects Open (see the install notes in the README).

```bash
# 1. Find the built .app inside the writable bundle/macos/ directory
APP=$(find src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ -maxdepth 1 -name "*.app" | head -1)
# 2. Sign with --deep so nested binaries (helper processes) are also signed
codesign --sign - --deep --force "$APP"
# 3. Recreate the DMG from the signed .app (the original was built before signing)
DMG=$(find src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/ -name "*.dmg" | head -1)
rm -f "$DMG"
hdiutil create -volname "Garita" -srcfolder "$APP" -ov -format UDZO "$DMG"
```

**Why the DMG must be recreated (not signed in-place):** Tauri builds a read-only HFS+
DMG. You cannot sign the `.app` inside a mounted DMG (the volume is read-only), and
signing the DMG itself doesn't make the nested `.app` signed in Gatekeeper's eyes.

**Do not:**
- Use `hdiutil attach` to mount the original DMG and sign inside it — the volume is read-only.
- Use `--options runtime` with ad-hoc signing (`-`) — that flag is **only** valid with a
  Developer ID certificate. Apple rejects it for ad-hoc and `codesign` errors out.

---

## Release Profile

`src-tauri/Cargo.toml` configures an aggressive release profile:

```toml
[profile.release]
panic = "abort"       # smaller binary, no stack unwinding overhead
codegen-units = 1     # full LTO opportunity
lto = true            # link-time optimization
opt-level = "s"       # optimize for binary size (not speed)
strip = true          # strip debug symbols from output binary
```

This produces a significantly smaller binary at the cost of longer compile times. A typical release compile takes 3–5 minutes on Apple Silicon.

---

## Vite / Frontend Build

The Makefile invokes `npm ci` before each build to ensure a clean, locked dependency install. Tauri orchestrates the Vite build automatically as part of `cargo tauri build`.

In development, Vite runs on port `1420` (`strictPort: true`). Tauri connects to this dev server. The `watch.ignored: ["**/src-tauri/**"]` setting prevents Vite from restarting when Rust files change.

---

## CI/CD Notes

Tauri cannot cross-compile — each platform's installer must be built natively on that platform. A typical multi-platform CI setup uses three parallel jobs:

```
macOS runner    → make mac         → upload DMG artifact
Windows runner  → make windows     → upload MSI/NSIS artifacts
Linux runner    → make linux       → upload DEB/RPM artifacts
```

`release.yml` follows this pattern for macOS (arm64), Linux (x86_64) and Windows (x86_64, `windows-2022`, bundles `msi,nsis`, **unsigned**: no Authenticode). It runs only on a version tag or by hand, so the Windows leg adds no per-merge minutes (`build.yml` keeps its own path-filtered Windows debug leg). The macOS job ad-hoc signs the `.app` (`codesign --sign - --deep --force`), makes the updater tarball from it and recreates the DMG, with no signing secrets (the updater key exists only in the publish job, see In-app updater).

For GKE/EKS/AKS integration testing in CI, ensure the appropriate auth plugin binary is installed on the CI runner and available on PATH before running `cargo tauri dev` or any test that invokes the Kubernetes client.

---

## GitHub Actions

`.github/workflows/` is the only pipeline. Every third-party action is pinned to a commit SHA, with its version in a comment; Dependabot (`.github/dependabot.yml`) bumps the pins, npm and Cargo weekly. Every workflow starts from `contents: read` and grants more per job only where needed.

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | Pull request, push to `main`, merge queue | `npm run build`, `npm test`, `check-emit.ts`; `cargo clippy --all-targets` and `cargo test --lib` on Ubuntu; exactly one `Patch::Strategic` in `src-tauri/src`; `CI OK` aggregates them |
| `build.yml` | Pull request or push touching `src-tauri/**` or npm manifests | `tauri build --debug --no-bundle` on macOS arm64, Windows x64, Linux x64 |
| `security.yml` | Pull request, push to `main`, weekly | TruffleHog secret scan; `cargo deny check` (policy `src-tauri/deny.toml`); `npm audit`; dependency review; actionlint and zizmor on the workflows |
| `codeql.yml` | Pull request, push to `main`, weekly | CodeQL `security-extended` for `actions`, `javascript-typescript`, `rust` |
| `scorecard.yml` | Push to `main`, weekly | OpenSSF Scorecard |
| `pr-title.yml` | Pull request | Conventional Commits title |
| `labeler.yml` | Pull request | Area labels from `.github/labeler.yml` |
| `release.yml` | `vX.Y.Z` tag, manual | Installers, updater tarball and signatures, `latest.json`, `SHA256SUMS.txt`, SPDX SBOM, build provenance, draft release (publish job runs in Environment `release`) |
| `pages.yml` | Release published, manual | Landing page `site/` to GitHub Pages. First renders `site/scoop/garita.json` from the latest release (see Scoop below), then a 1-byte GET check of the 5 unique `releases/latest/download/` links (dmg, deb, rpm, msi, setup exe; the count is asserted, so adding or removing a link on the page changes it deliberately). Pages source must be "GitHub Actions" |

What blocks and what only reports:

- **Clippy** fails on errors only; warnings print in the log. Add `-- -D warnings` once the existing warnings are fixed. **rustfmt** is not checked: the code base is not `cargo fmt` clean.
- **`cargo deny` advisories** fail on `main` and on the weekly run, and only report on a pull request, so an advisory published today does not block unrelated work. Bans, licenses and sources fail everywhere.
- **`npm audit`** fails on a high or critical advisory in runtime dependencies (`--omit=dev`), which include the `@tauri-apps/*` packages bundled into `dist/`. Dev and build tooling fails on a critical advisory (malicious packages are rated critical, and build tools run on the release runners); a high one prints a warning.
- **Dependency review, CodeQL, Scorecard and build provenance** need a public repository (or GitHub Advanced Security / Enterprise Cloud on a private one) and skip themselves otherwise. On a private repository with GitHub Code Security, set the repository variable `CODE_SCANNING` to `true` to run dependency review, CodeQL and Scorecard. Scheduled runs carry no repository data, so the weekly CodeQL and Scorecard runs need `CODE_SCANNING` set to `true` even on a public repository.

### Releasing from GitHub

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and rename `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD`. Merge to `main`.
2. Tag and push: `git tag -s vX.Y.Z -m "Garita vX.Y.Z" && git push origin vX.Y.Z`.
3. `release.yml` checks that the three versions match the tag and that the changelog section exists, then builds on macOS 14 (arm64 `.dmg`, ad-hoc signed and DMG rebuilt as in `make mac`; plus the updater tarball) and Ubuntu 22.04 (`.deb`, `.rpm`; no AppImage, see `docs/claude/open-items.md`; the oldest runner, for the widest glibc range). Windows x64 on `windows-2022` (`.msi` and NSIS `-setup.exe`). Files get the README names (`Garita-macOS-arm64.dmg`, `Garita-windows-amd64.msi`, `Garita-windows-amd64-setup.exe`, ...).
4. The workflow creates a **draft** release with the changelog section as notes, the installers, the updater files, `SHA256SUMS.txt` and `Garita-sbom.spdx.json` (14 assets, see In-app updater). Review it and publish it by hand, with "Set as the latest release" ticked. Re-running for the same tag replaces the files of a draft, never of a published release.

Release jobs use no caches, so nothing a pull request writes to the Actions cache can reach a shipped binary.

### Repository settings

The workflows assume these settings; none can be set from a file:

- Branch protection or a ruleset on `main`: require pull requests, require the `CI OK` status check (add `Security` jobs as wanted), block force pushes. Do not require `Build` jobs: that workflow is path-filtered, so a pull request that does not touch those paths would wait for them forever.
- Settings > Code security: enable Dependabot alerts and security updates, secret scanning and push protection, and private vulnerability reporting (`SECURITY.md` points reporters there).
- Settings > Actions > General: workflow permissions "Read repository contents", and require approval for workflows from outside collaborators.
- Settings > Pages: source "GitHub Actions". `pages.yml` deploys from the release's tag ref, so if Settings > Environments > `github-pages` limits deployments to `main`, add a tag rule `v*`.
- A new repository starts from defaults: re-create the Environment `release` with its rules and both secrets (Key custody below) before the first tag.

### In-app updater

Garita checks `https://github.com/KANOMNUT/garita/releases/latest/download/latest.json` (`plugins.updater.endpoints` in `tauri.conf.json`). The signature is minisign (`tauri signer`) and has nothing to do with Apple code signing: macOS stays **ad-hoc signed** (never `--options runtime`, Developer ID or notarization). `bundle.createUpdaterArtifacts` is deliberately absent, so `tauri build` never needs the key and local `make` builds and `build.yml` produce no updater files. `requireSignedVersion` is on: every signature carries the release version.

**Order in `release.yml`:**

1. Build job, macOS leg: `tauri build`, `codesign --sign - --deep --force`, `codesign --verify --deep --strict`, then the tarball from the **signed** app (`COPYFILE_DISABLE=1 tar`), then self-checks (one top-level `Garita.app`, no `._*` entries, `codesign --verify` of the unpacked copy), then the DMG from the same app. `Garita-macOS-arm64.app.tar.gz` joins the artifacts. The Linux `.deb`/`.rpm` are their own updater artifacts.
2. Publish job, in Environment `release`: checkout of the tag and `npm ci --ignore-scripts` (supplies the lock-pinned tauri CLI and the pubkey), downloads, **Sign updater files**, **Check signing key**, **Write latest.json**, checksums, provenance, draft.
3. Sign updater files signs the tarball, `.deb`, `.rpm`, `.msi` and the NSIS `-setup.exe` with `tauri signer sign --app-version X.Y.Z`. It is the only step that sees `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Check signing key (`minisign` from apt) fails the job unless every `.sig` verifies with `minisign -V` against `plugins.updater.pubkey`, has its key ID, and carries `version:X.Y.Z` (a pubkey that does not decode already fails Prepare → Check updater pubkey). tauri-cli only warns on a mismatch.
5. `latest.json` is written with `jq` (platforms `darwin-aarch64`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64-msi`, `windows-x86_64-nsis`; versioned URLs) and checked: five platforms, every URL names a file in `dist/`. The updater looks up `{os}-{arch}-{bundle}` before `{os}-{arch}`, and `check()` fails with `TargetNotFound` when the running platform has no key, which is why the Windows entries are signed even though Windows only shows a notice.

The draft has 14 assets: `Garita-macOS-arm64.dmg`, `Garita-macOS-arm64.app.tar.gz` + `.sig`, `Garita-linux-amd64.deb` + `.sig`, `Garita-linux-amd64.rpm` + `.sig`, `Garita-windows-amd64.msi` + `.sig`, `Garita-windows-amd64-setup.exe` + `.sig`, `latest.json`, `SHA256SUMS.txt`, `Garita-sbom.spdx.json`. The Checksums step asserts the file count.

**Windows has no in-app install.** `updateMode()` (`src/utils/updateState.ts`) returns `"app"` only for macOS; Windows and Linux show a notice and Download opens the release page. `capabilities/updater-macos.json` is unchanged.

**Key custody.**

- Generate the key once on a trusted machine (`npx tauri signer generate -w ~/.tauri/garita-updater.key`) with a random password of 24+ characters. Never commit it, never regenerate it.
- Put the key ID in `EXPECTED_KEY_ID` in `release.yml`. It is the raw keynum bytes that Prepare → Check updater pubkey prints, byte-reversed vs the ID in the `.pub` comment. This key: `8ca87849178bcf25` (comment `25CF8B174978A88C`).
- Keep the key file and the password in two places (password manager with the file attached, offline USB). Delete the local `.key` after the two backups exist.
- Store both as **Environment** secrets of `release` (not repository secrets), from **Git Bash**:
  `gh secret set TAURI_SIGNING_PRIVATE_KEY --env release -R KANOMNUT/garita < ~/.tauri/garita-updater.key`
  A PowerShell pipe appends CRLF and breaks the key. The password goes only through the interactive prompt of `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release -R KANOMNUT/garita`, never `-b` or a file.
- Environment `release`: required reviewer KANOMNUT, admin bypass off, deployment tag rule `v*`. Once the repo is public also add a tag ruleset on `refs/tags/v*` and turn on immutable releases.
- Account hygiene: hardware 2FA on every account that can write to the repo, and no classic PAT with `repo` scope.
- **Losing the key or its password strands every installed copy:** none can ever auto-update again, and the only recovery is a manual install of a build with a new pubkey.
- **Rotation:** ship a bridge release signed with the OLD key that carries the NEW pubkey in `tauri.conf.json`, and keep it the latest release for at least 30 days so installs can reach it. Only then sign with the new key.
- **Leak response:** delete both environment secrets, ship the bridge release immediately, and publish a security advisory with manual reinstall steps (download, verify against `SHA256SUMS.txt` and `gh attestation verify`).

**Rules:**

- A `workflow_dispatch` rebuild must be dispatched **from the tag ref** ("Use workflow from: vX.Y.Z"), or the `release` environment rule refuses the publish job.
- The tagged commit's message must not carry `[skip ci]` (or `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]`): GitHub may then skip the tag-push run. If no Release run appears, dispatch it from the tag ref: `gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`.
- Publishing a release that is not the newest version must untick "Set as the latest release". `latest.json` is served from GitHub's latest release, and `make_latest` defaults to true on publish.
- The repo must be public for anonymous update checks. 2.3.0 is the first published release, so the in-app update path can first be observed at the release after it.
- macOS installs in-app (capabilities in `updater-macos.json`). Linux checks and notifies; "Download" opens the release page (`open_release_page`). AppImage is not shipped.

---

### Windows installers and Scoop

- `make windows` builds both bundles locally (`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/{msi,nsis}/`); CI runs `tauri build --bundles msi,nsis` on `windows-2022`. Both are **unsigned**: Windows SmartScreen warns, and the site and README say so ("More info", then "Run anyway"). Authenticode signing is not planned.
- PATH entries for the `garita` command come from `src-tauri/windows/hooks.nsh` (NSIS, user PATH, never writes a PATH it did not read in full) and `src-tauri/windows/path.wxs` (MSI, system PATH); details and limits in `docs/claude/launcher.md`.
- **Scoop:** `site/scoop/garita.json` is a template with placeholder version and hash. `pages.yml` → "Render Scoop manifest" fills it from the **latest published release**: tag from `gh release view`, URL `releases/download/<tag>/Garita-windows-amd64.msi` (versioned, never `latest`), SHA-256 from that release's `SHA256SUMS.txt`, a 1-byte GET on the URL, then a `jq -e` check. Any failure fails the job, so a page with a dead Scoop line is never deployed. `gh` gets its token through `env:`; the job's `contents: read` is enough. The install line hard-codes `https://kanomnut.github.io/garita/scoop/garita.json` in `site/index.html`; change it (and the README) if a custom Pages domain is ever set. Scoop extracts the MSI (default `msiexec /a` extraction), so no installer or PATH hook runs; `extract_dir` is `PFiles\Garita`, read from the built MSI's Directory table and an admin extraction (`garita.exe` landed in `PFiles/Garita`).
- winget and AUR are not built.

## Homebrew Distribution

macOS users can install Garita via Homebrew rather than downloading the DMG by hand.
The cask lives in **this repo** at `Casks/garita.rb`. Homebrew can tap any Git URL, so
the repo doubles as the tap (no separate repo needed):

```bash
brew tap KANOMNUT/garita https://github.com/KANOMNUT/garita
brew install --cask kanomnut/garita/garita
```

The cask is **bumped by hand** after each release is published: set `version` and
`sha256` (from `SHA256SUMS.txt` on the release) in `Casks/garita.rb`, check it on a Mac
from a local test tap, and merge it to `main`. No workflow does this. Check after each
release that the bump landed. Users then `brew upgrade --cask garita`.

Details and the manual bump steps: **[`homebrew-tap-setup.md`](./homebrew-tap-setup.md)**.
