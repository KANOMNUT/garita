# Roadmap v1.4.0 → v2.0.0: Index

Date: 2026-10-04. Baseline: v1.3.0 in the tree; v1.3.1 planned (`docs/impl/v1.3.1-tasks.md`) and assumed shipped before v1.4.0 starts.
This file is an index only. **Each version's full plan (scope, contracts, tasks, acceptance, live items, commit order) lives in its own `docs/impl/v<X.Y.Z>-tasks.md`.** Every file is DRAFT until its own freeze conditions are met.

Bundling principle (from `docs/feature-recommendations.md` §4): ship shared helpers once and reuse them; keep risky pipeline and auth-path changes in releases of their own.

## Versions

| Version | Theme | Items | Plan |
|---|---|---|---|
| v1.4.0 | What is broken, and why | P3/#49, #15, #11, #12, #13, #14, #25 (+ Health section, UX-04 doc) | [v1.4.0-tasks.md](v1.4.0-tasks.md) |
| v1.4.1 | Secrets, access and hygiene | #33 (first, alone), #31, #32, #20, #19, #40 | [v1.4.1-tasks.md](v1.4.1-tasks.md) |
| v1.4.2 | Appearance | #41 (+ identity decoupling, UX-05 doc) | [v1.4.2-tasks.md](v1.4.2-tasks.md) |
| v1.5.0 → v2.1.0 | Updates (pipeline change, alone) | #51 | [v2.1.0-tasks.md](v2.1.0-tasks.md) |
| v2.1.1 | Updater test release (version bump only, Q21-1) | none | [v2.1.1-tasks.md](v2.1.1-tasks.md) |
| v1.5.1 → v2.1.2 | Proxies and live verification (auth-path change, alone) | #50, #47 | [v2.1.2-tasks.md](v2.1.2-tasks.md) |
| v1.5.2 → v2.1.3 | Distribution | #52, #55, #53 | [v2.1.3-tasks.md](v2.1.3-tasks.md) |
| v1.6.0 → v2.2.0 | Map and timeline | #18, #24, #17 (+ UX-06 doc) | [v2.2.0-tasks.md](v2.2.0-tasks.md) |
| v1.7.0 → v2.3.0 | External observability | #16 (+ #13 upgrade) | [v2.3.0-tasks.md](v2.3.0-tasks.md) |
| v2.3.1 | Search and filter (frontend only) | Map kind filter, YAML find (Ctrl/Cmd+F), ArgoCD bulk-select fix (+ UX 22 doc) | [v2.3.1-tasks.md](v2.3.1-tasks.md) |
| v2.0.0 | Real-time and fleet, plus the rebrand | Rebrand, #38, #39 | [v2.0.0-tasks.md](v2.0.0-tasks.md) (incl. Rebrand section). **v2.0.0 shipped the rebrand only; #38/#39 are unscheduled** (plan text: v2.0.0-tasks.md §1–§9; UX 06 §7–§8 are low-fidelity) |

**2026-10-09 (user decision):** the v2.0.0 Rebrand ships next and on its own, from v1.4.2 (`feat/v2.0.0-rebrand`; v2.0.0-tasks.md → Freeze addendum). It moves to Apache-2.0 and public GitHub Releases, which reopens "public GitHub-style releases" under Rejected. v1.5.0–v1.7.0 and #38/#39 follow it, and their version numbers are re-cut then.

**2026-10-10 (user decision):** the v1.5.0 Updates plan ships as **v2.1.0** ([v2.1.0-tasks.md](v2.1.0-tasks.md)); later versions shift: v1.5.1 → v2.1.2, v1.5.2 → v2.1.3, v1.6.0 → v2.2.0, v1.7.0 → v2.3.0; v2.1.1 = updater test release (Q21-1).

**2026-10-22 (status):** v2.3.0 (#16 external observability, #13 right-sizing upgrade) is implemented on `feat/v2.3.0`, not yet released; its live rows are in `docs/claude/open-items.md` (v2.3.0). Contracts: `docs/claude/pods-logs.md` (External observability).

**2026-10-27 (status):** v2.3.1 (Search and filter: the Map Kinds filter, YAML find, and the ArgoCD bulk-selection fix) is implemented on `feat/v2.3.1`, not yet released. The user's visual checks (`docs/impl/v2.3.1-tasks.md` §6.2) and the UX acceptance (`docs/ux/23-v2.3.1-acceptance.md`) come before the tag. Requirement 1 of the request (ArgoCD Application search) was dropped by the user. Contracts: `docs/claude/ui.md` (Resource map, YAML find), `docs/claude/argocd.md` (Lens Parity); owed checks: `docs/claude/open-items.md` (v2.3.1).

**2026-10-16 (user decision):** v2.2.0 Q60-1 = no layout dependency. The map and NetworkPolicy view use an own layered layout (`src/utils/graphLayout.ts`); `@dagrejs/dagre` needs a fresh OK.

Why the split differs from recommendations §4: v1.4 is three releases because #33 changes the Secret read path (it needs its own test pass) and #41 rewrites colour usage in most component files (it would collide with every feature task). v1.5 is three because #51 (pipeline) and #50 (auth path) each ship without feature work. #16 left v2.0 because it is large and shares nothing with #38/#39.

## Cross-version dependencies

| Depends on | Needed by | What |
|---|---|---|
| v1.3.1 | v1.4.0 onward | Settings shell and `mainView`; zone helper (Q-L5); `can_i` subresource; read-only guardrails and the spread-preserving identity writer; `app_log.rs` write instrumentation and `scrub`; credential-key masking (D3-3); `split_yaml_documents` as `pub(crate)` |
| v1.4.0 | v1.4.1, v1.6.0 | Health section, `FindingRow`, `SkippedSource` (partial state), presence states |
| v1.4.0 U1 (UX-04 doc) | v1.4.0 F3–F7, v1.4.1 | Health/RBAC/secrets design |
| v1.4.1 #33 | v1.4.1 #31, any future export/MCP idea | Secret values stay backend-side; one masking rule |
| v1.4.1 #31 journal | v1.6.0 #17 | "From this app" timeline entries |
| v1.4.2 U1 (UX-05 doc) | v1.5.0, v1.5.1, v1.5.2 | Updates, proxy, command-line tool designs |
| v1.5.0 updater | v1.5.2 (Windows platform), v2.0.0 (upgrade path across the rebrand) | `latest.json`, signing key |
| v1.5.1 #47 harness | v1.6.0, v1.7.0, v2.0.0 live items | Closes kind-coverable ledger rows |
| v1.5.2 #52 | v1.5.2 #55 (Windows), #53 | A Windows build to test and package |
| v1.6.0 U1 (UX-06 doc) | v1.6.0, v1.7.0, v2.0.0 | Map, timeline, observability, live state, context sets |
| v1.4.0 #13 | v1.7.0 | Right-sizing hints gain a p95 input |
| Rebrand plan | v2.0.0 freeze | Persisted-state migration and updater path (v2.0.0 Q200-1, Q200-2), CLI name (v1.5.2 Q52-4) |

## Excluded: already shipped or planned for v1.3.1

| Item | Status | Evidence in the tree |
|---|---|---|
| P0/#35 PDB drain | Shipped v1.2.1 | `commands/drain.rs` (`preview_node_drain`, `evict_pod`; no delete fallback) |
| P1 events kind filter | Shipped v1.2.1 | `involvedObject` field selector in `cluster_info.rs` |
| P2 confirms, P5 ArgoCD rollback | Shipped v1.2.1 | `build_rollback_patch` in `argocd.rs` |
| #48 signing cleanup | Shipped v1.2.1, **one leftover** | Makefile is ad-hoc only, but `docs/apple-signing-setup.md` still exists; v1.4.0 R6 deletes it |
| #54 "does not do" list | Shipped v1.2.1 | `README.md`, `public/index.html` |
| #44 Vitest, #1, #3+#4, #6, #30, P4 (YAML Save `canUpdate`) | Shipped v1.3.0 | `vitest.config.ts`, `since_seconds`/`default_container`/`neat_value`/`propagation` in `pods.rs`, `canUpdate` in `useResources.ts` |
| #2, #5, #7, #8, #9, #10, #28, #29, #37, #46, drain force-delete | Planned v1.3.1 | `docs/impl/v1.3.1-tasks.md` §1.1 (not yet in code: no `diffRows.ts`, `guardrails.ts`, `app_log.rs`) |

Note for v1.3.1's executor: its R9 targets `CLAUDE.md` sections that commit `417a5d1` moved verbatim into `docs/claude/*.md`. Apply those edits to the `docs/claude/` files (section names are unchanged).

## Backlog (on demand, not scheduled)

#21 cert-manager chain, #22 Flux sources + suspend/resume/reconcile, #23 routing explained, #26 CRD printer columns, #27 add-on panels, #34 impersonation, #36 in-place pod resize, #42 custom keybindings, #43 inline field docs, #45 demo mode. Prerequisites already scheduled: #49 (v1.4.0) before any new kind; #15 (v1.4.0) before #21/#22/#27; v1.6.0's edge model before #23.

Known open items not scheduled by this roadmap (see `docs/claude/open-items.md`): ArgoCD header below ~720 px, `delete_argocd_app` clearing every finalizer, the hardcoded `argocd` `gvk_for` version, no quit warning during drain, drain not waiting for termination, "Retry blocked" not retrying `failed`.

## Rejected (not re-planned)

Everything in `docs/feature-recommendations.md` §5 stays rejected, including: in-app AI assistant and MCP server, node shell, plugin system, server-side apply, kubectl/krew/helm installers and a kubectl command bar, the `argocd` CLI/REST dependency, Zustand, Developer ID signing and notarisation, a scoring engine, an in-cluster agent and stored config history, bundled security scanners, crash reporting/analytics, local Helm/Kustomize render, i18n, mass themes, Helm repo add/remove/update, and public GitHub-style releases.

## Live-cluster verification

Each plan carries its own live table (§7.3 or §6.2). v1.5.1's #47 harness is the point where the accumulated ledger (v1.2.1 → v1.5.0 rows in `docs/claude/open-items.md`) is run and recorded; rows it cannot cover (exec-plugin auth, installed bundles, the updater) stay manual.
