# Contributing to Garita

Thanks for helping. This guide covers setup, the checks a pull request must pass, and how changes are reviewed.

Security issues: do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Before you start

- For anything larger than a small fix, open an issue first so the approach can be agreed before you write code.
- Read "What Garita deliberately does not do" in the [README](README.md). Pull requests that add a kubectl dependency, write to the user's kubeconfig, add server-side apply or add telemetry will not be merged.
- Per-feature rules live in [`docs/claude/`](docs/claude/). Read the file for each area you change ([`CLAUDE.md`](CLAUDE.md) has the table). Many carry "do not simplify this back" rules.

## Setup

Requirements: Rust stable >= 1.90 (via [rustup](https://rustup.rs)), Node.js >= 22.6 (the emit check needs `--experimental-strip-types`; CI uses 22), and tauri-cli v2 (`cargo install tauri-cli --version "^2.0" --locked`). Platform packages are listed in [`docs/build-and-release.md`](docs/build-and-release.md).

```bash
make deps    # Rust targets and npm dependencies for this OS
make dev     # run the app with hot reload
```

## Checks

CI runs these on every pull request. Run them locally first:

```bash
npm run build                                          # tsc + vite build
npm test                                               # Vitest
node --experimental-strip-types scripts/check-emit.ts  # emit and patch helpers
cd src-tauri
cargo clippy --all-targets --locked
cargo test --lib --locked                              # no cluster needed
cargo deny check                                       # advisories, licenses, sources (cargo install cargo-deny --locked)
```

| Workflow | What it checks | Runs on |
|---|---|---|
| CI | Type check, frontend build, Vitest, emit checks, clippy, Rust unit tests | Every pull request and push to `main` |
| Build | Debug build on macOS, Windows and Linux | Pull requests that touch `src-tauri/` or npm manifests |
| Security | Secret scan (TruffleHog), `cargo deny`, `npm audit`, dependency review, workflow lint (actionlint, zizmor) | Every pull request, `main`, weekly |
| CodeQL | Static analysis of TypeScript, Rust and workflows | Every pull request, `main`, weekly (public repository) |
| PR title | Conventional Commits title | Pull requests |

## Code guidelines

- Kubernetes calls and business logic stay in Rust commands (`src-tauri/src/commands/`); React is UI only and gets data through hooks in `src/hooks/useResources.ts`. Components never call `invoke()`.
- Every TypeScript type that mirrors a Rust struct matches its serde field names.
- Optional or new Tauri command parameters are `Option<T>`.
- Every cluster write goes through `invokeWrite()`.
- No `unwrap()` or `expect()` in command handlers or in parsers of untrusted input (release builds use `panic = "abort"`).
- Every pure helper has a `*.test.ts` beside it. New Rust logic gets unit tests.
- Use Tailwind classes and the design tokens in `tailwind.config.js`.

## Commits and pull requests

- Branch from `main`.
- Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(helm): ...`, `fix(logs): ...`, `docs: ...`, `ci: ...`, `chore(deps): ...`. A squash merge turns the title into the commit message on `main`.
- Keep a pull request to one change. Docs that describe the behaviour change in the same pull request.
- Add user-facing changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) groups: Added, Changed, Deprecated, Removed, Fixed, Security).
- Fill in the pull request template, including how you tested and on which OS.
- Never include kubeconfig files, tokens, Secret values or private cluster names in code, tests, screenshots or logs.

## Releases

Maintainers only. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, rename `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD`, merge, then push a `vX.Y.Z` tag. The Release workflow builds the installers and opens a draft GitHub release for review. Details: [`docs/build-and-release.md`](docs/build-and-release.md).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
