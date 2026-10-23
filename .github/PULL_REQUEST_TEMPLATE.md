<!--
Title: Conventional Commits, e.g. "feat(helm): show chart notes" or "fix(logs): keep filter on reconnect".
The title becomes the commit message on main when the pull request is squash merged.
-->

## Summary

<!-- What changes and why. Link the issue: "Closes #123". -->

## Area

<!-- Delete the ones that do not apply. -->

- Rust backend (`src-tauri/`)
- Frontend (`src/`)
- Resource kinds / per-kind tables
- Cluster writes (edit, merge, delete, drain, Helm, ArgoCD)
- Secrets / credentials / kubeconfig
- Build, CI or release
- Documentation

## How it was tested

<!--
Commands run and what you checked by hand. Name the OS.
Say whether you tested against a live cluster, and which one (kind, minikube, EKS, ...).
-->

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `node --experimental-strip-types scripts/check-emit.ts`
- [ ] `cargo test --lib` in `src-tauri/`
- [ ] Ran the app (`make dev`) on: <!-- macOS / Windows / Linux -->

## Checklist

- [ ] I read the `docs/claude/` file for each area I changed, and this change keeps its rules.
- [ ] Docs that describe this behaviour change in this pull request.
- [ ] User-facing changes are listed under `## [Unreleased]` in `CHANGELOG.md`.
- [ ] New pure helpers have a `*.test.ts` beside them; new Rust logic has unit tests.
- [ ] New or changed Tauri command parameters that are optional are `Option<T>`.
- [ ] Cluster writes go through `invokeWrite()`; components do not call `invoke()`.
- [ ] No Secret value, token or kubeconfig content reaches logs, the journal, a diff or a preview unmasked.

## Screenshots

<!-- For UI changes: before and after. Blur cluster names, namespaces and anything else private. -->
