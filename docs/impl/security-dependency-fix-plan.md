# Security dependency fix plan (Dependabot)

Status: **waves 1–3 EXECUTED** on branch `docs/security-dependency-plan` (2026-10-11), with Q1–Q5 decided. Wave 4 and the accepted-risk rows remain. The results are in §8. The sections before §8 are the plan as written and keep its wording. 2026-10-15: §10 records glib (alert 10) and §11 the Tailwind 4 migration that removed F5 and F6; the older rows they change carry a pointer.
Baseline: `main` @ `da805e5` (v2.1.0, untagged). Gathered 2026-10-10 (13:59–14:11 UTC) by `security-engineer`, using read-only commands only.
Engineers: `frontend-engineer` (npm, `package.json`, docs), `rust-engineer` (`src-tauri/Cargo.toml`), `security-engineer` (verification gates), main session (merges, GitHub settings, Dependabot PR handling).

**Posture: shipped app GREEN.** No advisory hits the webview bundle or the release binary. Every open Dependabot alert is `scope: development`, in the build and test toolchain. The plan clears what can be cleared within the current semver ranges, and fixes the CI blind spot in §6. It parks the rest behind the planned majors, with a review date.

---

## 1. Scope and method

Scope: npm and Cargo dependency advisories, Dependabot configuration, and the CI audit gates. Out of scope: SAST, Tauri capabilities, and secrets in the repo.

Commands (run from the repo root unless noted; re-run them to refresh every result below):

```bash
npm audit --json                       # all deps
npm audit --omit=dev --json            # runtime deps only
npm ls <pkg> --all                     # dependency path per finding
npm view <pkg> versions|dist-tags|dependencies|engines   # fixed versions, ranges
gh api advisories/<GHSA>               # vulnerable range + first patched version
gh api "repos/KANOMNUT/watchtower/dependabot/alerts?state=open&per_page=100"
gh api repos/KANOMNUT/watchtower/vulnerability-alerts -i   # 204 = alerts enabled
gh api repos/KANOMNUT/watchtower/automated-security-fixes  # security updates
gh pr list --repo KANOMNUT/watchtower --state open

# src-tauri/, MSVC recipe from CLAUDE.md on Windows
cargo deny check advisories                            # repo policy (deny.toml)
cargo deny --config <copy of deny.toml with unmaintained = "all"> check advisories
cargo tree -i <crate> --target all
cargo tree -e features -i kube-runtime
```

Tool versions: npm 10.9.0, Node 22.11.0 (local), cargo-deny 0.20.2. Advisory DB snapshot: RustSec `advisory-db` commit `7eebec69` (2026-10-09T10:12+02:00).

**Wave 0 is already done.** The task brief said Dependabot alerts were disabled. On 2026-10-10 the endpoint `vulnerability-alerts` returned `204` and `automated-security-fixes` returned `{"enabled":true,"paused":false}`. The alerts were created at 13:59:44Z. Dependabot then opened security PRs #26 and #27 (§4, wave 1). The open alert list is the baseline for this plan.

---

## 2. What ships

| Artifact | What is in it | Evidence |
|---|---|---|
| Webview bundle (`dist/`) | `dependencies` (react, react-dom, @tanstack/react-query, @xterm/*, lucide-react) **plus four devDependencies that are imported in `src/`**: `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-process`, `@tauri-apps/plugin-updater` | `grep -rhoE --exclude='*.test.ts' --exclude='*.test.tsx' "from ['\"][^.'\"][^'\"]*" src \| sort -u` |
| Release binary | Cargo graph for the four targets in `src-tauri/deny.toml` | `cargo deny check advisories` |

- `npm audit --omit=dev` → 0 findings. This proves less than it seems, because `--omit=dev` skips the four bundled `@tauri-apps/*` packages (§6, G1).
- They are covered by the full audit. Their dependency tree has nothing flagged: `npm ls @tauri-apps/<pkg> --all` shows that the three plugins depend only on `@tauri-apps/api`, which has no dependencies.
- Every npm finding below sits under `vitest`, `tailwindcss`, `postcss` or `@vitejs/plugin-react` (paths in §3). None of them is a runtime import.
- Release build path: release.yml `build` runs `npm ci --ignore-scripts` → `npx tauri build`. That calls `beforeBuildCommand: npm run build` (`tsc && vite build`), so postcss, tailwind, babel and source-map-js **run on release runners**.
- `vitest` and `tinypool` run only in `ci.yml` (`npm test`) and on developer machines.
- The `publish` job (environment `release`, which holds `TAURI_SIGNING_PRIVATE_KEY`) runs only `npx --no-install tauri signer sign` with the key in env. That is `@tauri-apps/cli`, which has no finding.

**Build-tool poisoning risk: LOW.** None of these advisories is a malicious-package or code-injection advisory in the release build path. They are DoS, local file read and prototype-pollution gadgets. Each needs attacker-controlled input, and the build reads only repository sources.

---

## 3. Findings, ordered by real risk

"Alert" means the Dependabot alert number. "In range" means the parent's declared semver range already admits the fixed version, so a lockfile-only update is enough.

| # | Advisory | GH sev | Package@ver | Path | Shipped? | Exploitable here? | Fixed in | In range? | Fix path | Wave |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | GHSA-5gmw-xhrv-c9v3 / CVE-2026-104848 (alert 7) | critical | tinypool@1.1.1 | vitest@3.2.7 → tinypool | No. Dev/CI test runner | Needs a prototype-pollution primitive inside the test process (`Object.prototype.execArgv`/`env`). Tests run repo code only. **Low**, but a CI-runner RCE class, so fix first. | tinypool 2.1.1. **vitest ≥ 4.1.11 drops tinypool** (`npm view vitest@4.1.11 dependencies`) | No (vitest major) | (a) PR #21, or (d) vitest 4.1.11 | 1 |
| F2 | GHSA-85c8-ppgw-ccpr / CVE-2026-104849 (alert 6) | critical | tinypool@1.1.1 | same | No | Same precondition (`Object.prototype.filename` plus a caller-supplied `run()` options object). **Low** | tinypool 2.1.2 / vitest ≥ 4.1.11 | No | same as F1 | 1 |
| F3 | GHSA-82fw-gwwq-j7x9 / CVE-2026-84373 (alerts 3, 4) | medium | vitest@3.2.7, @vitest/mocker@3.2.7 | direct; vitest → @vitest/mocker | No | Unauthenticated only through the public `mockerPlugin`/`interceptorPlugin` exports used by third-party dev servers. Garita runs `vitest run`, `environment: "node"`, no browser mode (`vitest.config.ts`). **Not reachable** | 4.1.11 | No | same as F1 | 1 |
| F4 | GHSA-68fv-2mgg-jv7q / CVE-2026-93749 (alert 9) | high | source-map-js@1.2.1 | postcss@8.5.28 (`^1.2.1`) | No; runs in the release build | Event-loop DoS on a crafted indexed source map. The input is the repo's own CSS. **Not exploitable** | 1.2.2 | **Yes** | (a) security PR **#26** (lockfile only) | 1 |
| F5 | GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 (alert 5) | high | braces@3.0.3 (+ chokidar@3.6.0, micromatch@4.0.8, fast-glob@3.3.3 as `npm audit` effects) | tailwindcss@3.4.19 → chokidar / micromatch / fast-glob → braces | No; runs in the release build | Stack-exhaustion DoS on deeply nested brace patterns. The input is the `content` globs in `tailwind.config.js` (repo-controlled). **Not exploitable** | **None.** `first_patched_version: null`; 3.0.3 is the latest. Tailwind 4.3.3 drops the chain (`npm audit` fixAvailable) | n/a | (d) Tailwind 4, else (e) | 4 / accept. **Done 2026-10-15: (d), `f225b8a`, §11** |
| F6 | GHSA-rj75-hqrm-r3gf / CVE-2026-104844 (alert 8) | medium | postcss-selector-parser@6.1.2 (6.1.4 after wave 1, `865ce84`) | tailwindcss@3.4.19 (`^6.1.2`), postcss-nested@6.2.0 (`^6.1.1`) | No; runs in the release build | Quadratic parse of flat selectors. The advisory says "Ordinary build-time use on trusted sources is not affected". **Not exploitable** | 7.1.6 only. The v6 line has no backport: 6.1.4 was published 2026-06-11, and the fix landed 2026-09-03 in 7.1.6 | No (major) | (d) Tailwind 4, else (e) | 4 / accept. **Done 2026-10-15: (d), `f225b8a`, §11** |
| F7 | GHSA-w9m9-85wc-3x92 / CVE-2026-9358 (alert 2) | low | postcss-selector-parser@6.1.2 | same | No | Recursion DoS. Trusted CSS. **Not exploitable** | 6.1.3 | **Yes** | (b) lockfile, or the Dependabot security PR if one opens | 1 |
| F8 | GHSA-4x5r-pxfx-6jf8 / CVE-2026-49356 (alert 1) | low | @babel/core@7.29.0 | @vitejs/plugin-react@4.7.0 (`^7.28.0`) | No; runs in the release build | Needs attacker-controlled source code. The advisory says "Users that only compile trusted code are not impacted". **Not exploitable** | 7.29.6 | **Yes** | (a) security PR **#27** (→ 7.29.7, lockfile only) | 1 |
| R1 | RUSTSEC-2025-0012 `backoff` 0.4.0; RUSTSEC-2024-0384 `instant` 0.1.13; RUSTSEC-2024-0388 `derivative` 2.2.0 (proc-macro) | unmaintained | | kube 0.95 → kube-runtime 0.95.0 → … | backoff, instant: yes; derivative: compile-time only | No vulnerability. Repo policy (`unmaintained = "workspace"`) does not fail on these. `kube-runtime` is pulled only by kube's `runtime` feature (`runtime = ["kube-runtime"]` in kube 0.95.0's Cargo.toml), and `src-tauri/src` uses none of it (`grep -rn "runtime::\|kube::runtime\|await_condition\|WatchStreamExt" src-tauri/src` → no hit) | Drop the feature | Cargo.toml feature change | (c)-like: delete the unused feature | 2 |
| R2 | RUSTSEC-2025-0134 `rustls-pemfile` 2.2.0 | unmaintained | | kube-client 0.95.0 | Yes (binary) | No vulnerability | kube 4.x (kube-client 4.2.0 depends on `pem`, not `rustls-pemfile`) | No (kube major; Dependabot ignores kube* version updates) | (d) kube upgrade | 4 |
| R3 | RUSTSEC-2024-0370 `proc-macro-error` 1.0.4 | unmaintained | | tauri / wry → gtk 0.18 → glib-macros, gtk3-macros (Linux) | No; proc-macro, compile time | No vulnerability | Upstream (gtk-rs 0.18 in Tauri's Linux stack) | n/a | (e) | accept |
| G1 | CI gate gap (no advisory) | process | `@tauri-apps/{api,plugin-dialog,plugin-process,plugin-updater}` | devDependencies, bundled into `dist/` | **Yes** | The blocking `npm audit --omit=dev --audit-level=high` step never sees them. A future advisory against them would only warn | n/a | n/a | Move them to `dependencies` | 3 |

Not findings, for the record:

- `vite@6.4.3` is outside every listed vite advisory: GHSA-fx2h-pf6j-xcff, GHSA-v6wh-96g9-6wx3 and GHSA-4w7w-66w2-5vf9 all stop at `<= 6.4.2`. `vite@6.4.4` (2026-10-06) is held by the 7-day cooldown and is not tied to any advisory (`gh api "advisories?ecosystem=npm&affects=vite@6.4.3"` → empty).
- PR #20 (typescript 7.0.2) fixes no advisory.
- `cargo deny check advisories` under the repo policy → `advisories ok`. That covers vulnerabilities, unsoundness and yanked crates for `kube`, `rustls`, `tokio`, `hyper`, `serde_yaml` and `x509-parser`. (Superseded 2026-10-15, §10: that policy checked unsoundness in direct dependencies only.)
- No Cargo Dependabot alert exists. (Superseded 2026-10-15, §10: alert 10, glib.)

**Correction to the earlier triage.** "No open PR fixes an advisory" no longer holds. PR #21 (vitest 5.0.3) removes `node_modules/tinypool` from the lockfile and fixes F1, F2 and F3. Its CI is green, because CI's `node-version: 22` resolves to a release ≥ 22.12.

---

## 4. Fix waves

Common rules for every wave:

- One PR per wave step.
- The main session merges.
- `security-engineer` runs the gates before the merge.
- Rollback is `git revert <merge>`. No wave touches app code, so a revert is lockfile/manifest-only.

### Wave 0: GitHub settings (user): DONE

| Item | State | Check |
|---|---|---|
| Dependabot alerts | enabled | `gh api repos/KANOMNUT/watchtower/vulnerability-alerts -i` → `204` |
| Dependabot security updates | enabled, not paused | `gh api repos/KANOMNUT/watchtower/automated-security-fixes` |
| Baseline | open alerts are all `ecosystem npm`, `scope development` | alerts API (§1) |

There is no further user action in wave 0. Dependency review (security.yml) stays skipped until the repository is public or `CODE_SCANNING=true`; that is expected.

### Wave 1: npm dev toolchain, in-range updates and vitest (`frontend-engineer`)

**1a. Lockfile-only (closes alerts 1, 9; and 2 if done here).**

- Merge Dependabot security PRs **#26** (source-map-js 1.2.2) and **#27** (@babel/core 7.29.7). Both change `package-lock.json` only.
- Alert 2 (postcss-selector-parser 6.1.3+) had no security PR as of 14:11 UTC. If none appears, `frontend-engineer` runs `npm update postcss-selector-parser`, which stays inside tailwind's `^6.1.2`.
- Files: `package-lock.json`.

**1b. vitest (closes alerts 3, 4, 6, 7).** Pick one (Q1):

- **Option A (default if local Node stays 22.11): vitest `^4.1.11`.**
  - Engines `^20 || ^22 || >=24`, so Node 22.11 is fine.
  - Peer `vite ^6 || ^7 || ^8`, so it keeps vite 6.
  - No tinypool.
  - Files: `package.json`, `package-lock.json`.
  - Close PR #21 with a comment. Add the vitest major ignore (§5) so Dependabot does not re-propose 5.x.
  - `vitest.config.ts` is minimal, and the tests use no `vi.mock`/`vi.fn`/`vi.spyOn`, so the migration surface is small. `npm test` is the gate.
  - The security update targets "the minimum version that includes the patch", so Dependabot may itself open this as a PR.
- **Option B: merge PR #21 (vitest 5.0.3).**
  - Engines `^22.12.0 || ^24 || >=26`.
  - The user upgrades local Node to ≥ 22.12 first.
  - In the same diff, raise the documented floor from 22.6 to 22.12 in `README.md:143`, `CLAUDE.md:101`, `CONTRIBUTING.md:15`, and the "(Node 22.11)" note at `CLAUDE.md:91`.
  - This also pays the Node prerequisite for Vite 8 and plugin-react 6 (engines `^20.19.0 || >=22.12.0`).

**Gates (1a + 1b):**

```bash
npm audit --json   # no entries for tinypool, vitest, @vitest/mocker, source-map-js, @babel/core
npm ls tinypool    # empty
npm ls source-map-js @babel/core postcss-selector-parser   # 1.2.2, >=7.29.6, >=6.1.3
npm test && npm run build && node --experimental-strip-types scripts/check-emit.ts
git diff main -- package-lock.json | grep -cE '^[-+].*"node_modules/@tauri-apps/'   # 0: Tauri npm/crate pair untouched
sha256sum dist/assets/*.css   # compare with a main build: postcss-selector-parser feeds the CSS
```

CI: `Frontend`, `npm audit` and the build jobs must be green. After the merge, check that the alerts list shows 1, 2, 3, 4, 6, 7 and 9 as `fixed`.

**Tauri pair.** No wave-1 step touches `@tauri-apps/*` or the `tauri*` crates, so the `tauri build` minor-match rule is not exercised. If a grouped PR ever drags `@tauri-apps/*` in, `npx tauri info` must show the npm and crate minors equal before the merge (dependabot.yml header).

### Wave 2: drop the unused kube `runtime` feature (`rust-engineer`)

- `src-tauri/Cargo.toml`: `kube = { version = "0.95", features = ["derive", "ws", "client"] }` (remove `"runtime"`), plus the `Cargo.lock` that follows.
- No kube version change, so the Dependabot kube* ignore is unaffected.
- Removes R1 (backoff, instant, derivative), which shrinks the binary's dependency surface.
- Gates (MSVC recipe on Windows; CI runs the same on Linux):

```bash
cargo check && cargo test --lib && cargo clippy   # not --locked: the lockfile must shrink; CI's --locked runs after
cargo tree -i backoff; cargo tree -i instant; cargo tree -i derivative   # each: "did not match any packages"
cargo deny check                                   # all checks green
cargo deny --config <unmaintained=all copy> check advisories   # only RUSTSEC-2025-0134, RUSTSEC-2024-0370 remain
grep -rn "Patch::Strategic" src | wc -l            # still 1
```

- Rollback: revert. If `cargo check` fails, some module needs `kube::runtime`. Keep the feature, and move R1 into wave 4.

### Wave 3: CI gate coverage (`frontend-engineer`, main session)

- `package.json`: move `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-process` and `@tauri-apps/plugin-updater` from `devDependencies` to `dependencies`. Keep the version specs unchanged (`~2.4.0`, `~2.13.2` stay pinned). `@tauri-apps/cli` stays a devDependency.
- `package-lock.json` changes only the `dev` flags.
- Gates:
  - `npm ls --omit=dev @tauri-apps/api` lists it.
  - `npm audit --omit=dev` → 0.
  - `npm run build` produces the same `dist/assets/*.js` hashes as `main`.
  - `scripts/third-party-licenses.mjs` already lists these packages explicitly (lines 87–90), labelled "runtime (bundled from devDependencies)". Update that label in the same diff and regenerate. The only expected `THIRD_PARTY_LICENSES` diff is the label.
- Optional, Q3: after wave 1 lands, make the full audit block at `critical` (§6).

### Wave 4: majors that clear the rest (separate plans, not security-urgent)

| Migration | Clears | Prerequisites | Status |
|---|---|---|---|
| Tailwind 3 → 4 | F5 (braces chain), F6. Gate: `npm ls braces postcss-selector-parser` empty | macOS WebKit floor Safari 16.4 (dependabot.yml comment); lift the tailwindcss major ignore | Planned; no brief yet. **Done 2026-10-15 in `f225b8a`** (brief `docs/impl/deps-security-fix.md`; §11) |
| kube 0.95 → 4.x (+ k8s-openapi) | R2 (`rustls-pemfile` → `pem`); R1 too if wave 2 was skipped | kube 4.2.0 `rust-version` 1.89 (repo floor 1.90 is fine); the Dependabot kube* ignore stays | **No plan exists.** The dependabot.yml comment cites `docs/kube-upgrade-plan.md`, which documents the finished 0.88 → 0.95 move. Needs a new plan |
| Vite 8 + plugin-react 6 | nothing security-related today | Node ≥ 22.12 | Planned |
| Vitest 5 | F1–F3 if Option B was not taken | Node ≥ 22.12 | PR #21 |
| TypeScript 7 (PR #20), React 19 | nothing security-related | `src/utils/sessionId.ts:8` (TS 7); `SettingsView.tsx` `inert` (React 19, `docs/impl/v1.4.2-review.md` N-4) | Planned |

### Accepted risk (e)

**Review date 2027-01-10**, or earlier at the Tailwind 4 or Tauri gtk-rs upgrade. (2026-10-15: Tailwind 4 landed, so F5 and F6 leave this table, §11. R3 stays, and R4 glib joins it, §10.)

| Item | Reason |
|---|---|
| F5 braces | No patched version exists. Build-time only, with trusted globs. **Closed 2026-10-15: gone from the tree, `f225b8a` (§11).** |
| F6 postcss-selector-parser GHSA-rj75 | The fix exists only in 7.1.6. An `overrides` pin to `^7.1.6` under tailwind 3's `^6.1.2` is rejected: 7.0.0 is a major ("make insertions during iteration safe"), and tailwind 3 mutates selectors. Build-time only, with trusted CSS. **Closed 2026-10-15: gone from the tree, `f225b8a` (§11).** |
| R3 proc-macro-error | Compile-time proc-macro from Tauri's Linux stack. Upstream fix only. |

At the review date, re-run §1. If braces publishes a patch, or postcss-selector-parser backports to 6.x, convert the row to (b).

**Expect a Tailwind 4 security PR for alert 8.** For npm, Dependabot updates the parent when it has to, and `update-types` ignores do not stop security updates (§5). So alert 8 may arrive as a PR that bumps `tailwindcss` to 4.x. Alert 5 cannot, because braces has no patched version. (Superseded 2026-10-15, §11: it arrived as PR #31, and `f225b8a` is the real migration.)

- If that PR appears, close it with a link to the planned Tailwind 4 migration (Safari 16.4 floor). Do not merge it as a drive-by.
- Dismissing alert 8 (Q2) prevents the PR. Never prevent it with a name-only `tailwindcss` ignore: that would also block every future Tailwind security fix.

---

## 5. dependabot.yml changes (applied, §8)

```diff
   - package-ecosystem: npm
@@
     groups:
       npm-minor-patch:
         update-types: [minor, patch]
+      # Security PRs for the same run land as one PR instead of one per package.
+      npm-security:
+        applies-to: security-updates
+        patterns: ["*"]
     ignore:
@@
       - dependency-name: tailwindcss
         update-types: ["version-update:semver-major"]
+      # Only with wave 1 option A (vitest 4): vitest 5 needs Node >= 22.12 and
+      # moves with Vite 8. Security updates still arrive (update-types ignores
+      # are version-only).
+      - dependency-name: vitest
+        update-types: ["version-update:semver-major"]
@@
   - package-ecosystem: cargo
@@
     ignore:
-      # kube-rs and k8s-openapi move together, as a planned upgrade
-      # (docs/kube-upgrade-plan.md). update-types limits the ignore to version
+      # kube-rs and k8s-openapi move together, as a planned upgrade (0.95 -> 4.x,
+      # not yet written; docs/kube-upgrade-plan.md is the finished 0.88 -> 0.95
+      # move). update-types limits the ignore to version
```

What the GitHub docs say. Only statements actually read on the pages are cited:

- **Cooldown is version-only.** "The `cooldown` option is only available for *version* updates, not *security* updates." ([Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference), `cooldown`). The 7-day cooldown does not delay security PRs.
- **`update-types` is version-only.** "`update-types` only affects *version* updates, not *security* updates." and "Security updates will always be created regardless of the `update-types` setting." ([Controlling which dependencies are updated](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/controlling-dependencies-updated)). Every current ignore (react, vite, tailwindcss, sha2, kube*, k8s-openapi) uses `update-types`, so none of them blocks a security update. The existing comment in dependabot.yml is correct.
- **A dependency-name ignore applies to both.** Dependabot will "ignore those dependencies when it opens pull requests for version updates and security updates." (same page, "Ignoring specific dependencies"). Never add a name-only ignore.
- **Security PRs are exempt from the PR limit.** "*Security update* pull requests are not subject to this limit and do not count toward it." (options reference, `open-pull-requests-limit`)
- **Groups default to version updates.** `applies-to` "When undefined, defaults to version updates. Supported values: `version-updates` or `security-updates`." (options reference, `groups`). This is why the existing groups never bundled #26 and #27.
- **Target version and transitive dependencies.** Security updates go to "the minimum version that includes the patch", and for npm "even if it means updating the parent dependency or dependencies" ([Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates)). F5 has no patched version, so no PR can come for alert 5.

---

## 6. CI gate recommendations (security.yml)

- **Keep `npm audit --omit=dev --audit-level=high` blocking.** It is the right gate for shipped JS. After wave 3 it also covers the four bundled `@tauri-apps/*` packages (G1).
- **Full audit (report-only today).** After wave 1, make it blocking at `--audit-level=critical` and keep the `high` warning (Q3). Malicious-package advisories are rated critical, and a poisoned build tool runs on release runners. Making it blocking today would fail on F1/F2.
- **cargo-deny advisories: keep the policy as is.** (Superseded 2026-10-15, §10: `unsound = "all"` and one ignore; the rest stands.)
  - vulnerability, unsound and yanked = deny;
  - `unmaintained = "workspace"`;
  - `continue-on-error` on PRs only, failing on `main` and the weekly run;
  - `ignore = []`.
  
  Do not widen `unmaintained` to `"all"`: it would fail on R2/R3, which have no in-range fix. Instead, run the `unmaintained = "all"` variant by hand at each review date (§1 command).
- **Dependency review.** No change. It starts gating (`fail-on-severity: high`) once the repo is public.

---

## 7. Open questions

1. **Q1, vitest.** Option A (vitest 4.1.11, Node stays 22.11, close #21, add the vitest major ignore) or Option B (upgrade local Node to ≥ 22.12, merge #21, raise the documented floor)?
2. **Q2, alerts 5 and 8.** Dismiss them as "tolerable risk" with the §4 reason, or leave them open as the reminder until Tailwind 4? (Decided in §8; outcome in §11.)
3. **Q3.** Make the full `npm audit` block at `critical` once wave 1 lands?
4. **Q4.** Do wave 2 (drop kube `runtime`) now, or fold it into the kube 4.x plan?
5. **Q5.** Apply the `npm-security` group diff, or keep one PR per security update?

---

## 8. Execution record (2026-10-11)

Branch `docs/security-dependency-plan`, on top of the plan commit `2da5f53`. Nothing was merged to `main`, and no Dependabot PR was merged, closed or commented on.

**Decisions.**

- Q1: Option A, vitest `^4.1.11`. The Node floor stays at 22.6.
- Q2: alerts 5 and 8 stay open as the reminder until Tailwind 4. (Outcome 2026-10-15: Tailwind 4 landed in `f225b8a`, so neither was dismissed; §11.)
- Q3: yes. The full audit fails on `critical`, and `high` stays a warning.
- Q4: wave 2 now.
- Q5: the `npm-security` group is applied.

| Commit | Wave | Change |
|---|---|---|
| `c7728a6` | §5, §6 | `security.yml`: full `npm audit --audit-level=critical` blocks, after the `high` report-only step. `dependabot.yml`: `npm-security` group, vitest major ignore, kube* comment. `docs/build-and-release.md` describes the gate. |
| `865ce84` | 1a, 1b | vitest 3.2.7 → 4.1.11 (tinypool removed). source-map-js 1.2.2. @babel/core 7.29.7 (its `@babel/*` dependencies move with it). postcss-selector-parser 6.1.4 (newest 6.x, inside `^6.1.2`). |
| `415f3a3` | 3 | The four bundled `@tauri-apps/*` packages are now `dependencies`, with the version specs unchanged. The lockfile changes `dev` flags only. The label in `scripts/third-party-licenses.mjs` is updated. |
| `9fe2552` | 2 | kube features `["derive", "ws", "client"]`. `Cargo.lock` loses 18 packages, with no version change. `deny.toml` comment and two planning docs are updated. |
| `5ebab17` | 2, 3 | `THIRD_PARTY_LICENSES` regenerated. It also catches up with bumps merged earlier without a regeneration. |

**Gates (Linux, Node 22.22, npm 10.9.4, cargo 1.97, cargo-deny 0.20.2).**

- `npm test`: 44 files and 594 tests pass on vitest 4.1.11. No test or config change was needed.
- `npm run build` and `scripts/check-emit.ts` pass.
- `sha256sum dist/assets/*` is byte-identical to the pre-change build after wave 1 and after wave 3 (CSS and JS).
- `npm ls tinypool` is empty.
- `npm audit --omit=dev`: 0.
- `npm audit`: 0 critical. What remains is the braces chain (F5) and GHSA-rj75 (F6), both §4 accepted risk.
- The lockfile diff touches no `node_modules/@tauri-apps/` entry in wave 1.
- `cargo check`, `cargo test --lib` (226 pass) and `cargo clippy --all-targets` pass, with and without `--locked`.
- `cargo tree -i backoff|instant|derivative|kube-runtime --target all`: none match.
- `cargo deny check`: all ok.
- With `unmaintained = "all"`, only RUSTSEC-2025-0134 and RUSTSEC-2024-0370 remain.
- `Patch::Strategic` hits: 1.

**Deviations.**

- npm 10.9.4 and 10.9.9 crash while resolving vitest 4: `TypeError: Cannot read properties of null (reading 'edgesOut')`, in arborist `#loadPeerSet`. The lockfile was resolved with npm 11.21.0. It installs with `npm ci` on npm 10.9.4, and `npm install --package-lock-only` on 10.9.4 leaves it unchanged. A from-scratch vitest re-resolve on npm 10 (by a person or by Dependabot) may hit the same crash.
- The `@babel/core` update moves its `@babel/*` siblings to 7.29.7–7.29.10, as core's `^7.29.7` ranges require.

**Left for the main session or the user (GitHub).**

- Close PR #21 (vitest 5), PR #26 and PR #27, each with a comment. #26 and #27 are superseded by `865ce84`. #21 is not taken (Q1).
- After the merge, check that alerts 1, 2, 3, 4, 6, 7 and 9 read `fixed`.
- Expect a Tailwind 4 security PR for alert 8. Close it, as §4 says. (Superseded 2026-10-15, §11: it is PR #31.)
- Wave 4 and the review date 2027-01-10 are unchanged. The Watch API (#38) must re-add kube's `runtime` feature.

## 9. Re-verification (2026-10-15)

`security-engineer` and `frontend-engineer` checked the branch again before the merge. The CI and Security workflows were also dispatched on it.

- **The npm side holds.** Each alerted package has exactly one lockfile entry. Alerts 1, 2, 3, 4, 6, 7 and 9 are out of range; 5 and 8 stay as §4 accepted risk. `npm audit --audit-level=critical` and `npm audit --omit=dev --audit-level=high` exit 0. `npm ci`, `tsc`, `npm test` (594), check-emit and the build pass on Node 22.11.0 / npm 10.9.0.
- **§8's "`cargo deny check`: all ok" no longer holds.** RUSTSEC-2026-0346, 0347, 0348 and 0349 (rustls 0.23.45, published 2026-10-14) turn `cargo-deny (advisories)` red here and on `main`. Dependabot raises no alert for them.
  - Fix: `cargo update -p rustls --precise 0.23.46`.
- **GHSA-7gcf-g7xr-8hxj, serde_with 3.20.0** (via `tauri-utils`). RustSec has no entry, so cargo-deny cannot see it, and Dependabot raised no alert.
  - Fix: `--precise 3.21.0`, the first fixed version. 3.24.0 would pull in `darling` 0.24, `jiff`, `defmt` and `portable-atomic`.
- **RUSTSEC-2024-0449, `unsafe-libyaml` unmaintained** (under `serde_yaml`), was added 2026-10-12. The `unmaintained = "all"` run now lists three IDs, not §8's two. It does not fail the gate. Review it with R1–R3 on 2027-01-10.
- **The full-history secret scan is red on `main` too.** The weekly and dispatched runs flag an example URI at `docs/impl/v1.5.1-tasks.md:18` in commits before `3dc2460`. The current file is clean, and PR runs scan only the added lines.
- **PR #29 order.** Merge this branch first, then `@dependabot rebase` #29. Never resolve its lockfile toward `main`'s or #29's root block: that brings back vitest 3 and tinypool, and undoes wave 3.

The Cargo.lock bump changes only rustls, serde_with and serde_with_macros. `THIRD_PARTY_LICENSES` versions were edited by hand (same licences). The Rust gates run in CI: the local Windows machine has no MSVC linker.

## 10. glib and the cargo-deny `unsound` policy (2026-10-15)

Branch `chore/deps-security-checkpoints`. Analysis: `docs/impl/deps-security-fix.md` §1.3 and §1.4. Decisions D2 (a) and D3 (a), its §6. §3's R3 row is unchanged; glib gets its own row because it is an unsoundness advisory, not an unmaintained one.

| # | Advisory | GH sev | Package@ver | Path | Shipped? | Exploitable here? | Fixed in | In range? | Fix path | Wave |
|---|---|---|---|---|---|---|---|---|---|---|
| R4 | RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g (alert 10) | medium | glib@0.18.5 | tauri / wry / tao / muda → gtk 0.18, webkit2gtk 2.0.2, soup3, javascriptcore-rs → glib. **Linux only**: `cargo tree -i glib` prints nothing for both macOS targets and for Windows | Yes, in the Linux binary | Unsound `VariantStrIter` iteration: a NULL-pointer crash, not memory corruption. Nothing calls `VariantStrIter` or `Variant::array_iter_str`: the sources of every crate in `cargo tree -i glib@0.18.5 --target x86_64-unknown-linux-gnu` were searched for `array_iter_str|VariantStrIter`, and only `glib` itself matches (definition, iterator impls and `#[cfg(test)]` code; no other glib function uses it); `src-tauri/src` has no match. **Not reachable** | 0.20.0 | No. tauri 2.12.4, tauri 3.0.0-alpha.5, wry 0.57.0, tao 0.37.1 and muda 0.21.2 all require `gtk ^0.18` (crates.io index, 2026-10-15) | (e); dismiss alert 10 as `not_used` | accept |

- **Why §3 saw `advisories ok`.** cargo-deny's `unsound` defaults to `"workspace"`, which fails only on direct dependencies, and glib is transitive.
- **Policy** (`src-tauri/deny.toml`): `unsound = "all"`, plus `ignore = [{ id = "RUSTSEC-2024-0429", reason = … }]`; the comment now says what the policy checks. `unmaintained = "workspace"`, `yanked = "deny"` and the by-hand `unmaintained = "all"` run at each review (§6) are unchanged.
- **Gates** (Windows, MSVC host `x86_64-pc-windows-msvc`, cargo-deny 0.20.2, the version CI pins per `deps-security-fix.md` §8 G6):
  - `cargo deny check` → exit 0, `advisories ok, bans ok, licenses ok, sources ok`, with no `advisory-not-detected` warning.
  - The same policy with `ignore = []` → exit 1, `advisories FAILED`. Its only error is `error[unsound]` RUSTSEC-2024-0429 on `glib v0.18.5`.
  - The ignore with a wrong ID → `warning[advisory-not-detected]`. This is the signal to delete the entry once glib 0.18 leaves the graph.
- **Accepted risk (e)**, under §4's rules: review on 2027-01-10, or earlier when wry/tao/muda move to gtk-rs ≥ 0.20 or gtk4. R3 (`proc-macro-error`) sits in the same gtk 0.18 stack and clears with it.
- **Alert 10.** The owner dismisses it as `not_used` with the command in `deps-security-fix.md` §6 D2. Agents never dismiss.
- `docs/security-report.md` F-04 is corrected to match: Linux only, not reachable, no in-range fix.

## 11. Tailwind 4: F5 and F6 removed (2026-10-15)

Branch `chore/deps-security-checkpoints`, commit `f225b8a` (`build(deps): Tailwind 4, closing Dependabot #5 and #8`). Brief and decisions: `docs/impl/deps-security-fix.md` §2–§8, with D1 (a) shape M2, D4 default, D5 (a) and D6 (a).

| # | Alert | Before | After `f225b8a` |
|---|---|---|---|
| F5 | 5, braces GHSA-vfj7 (high) | `tailwindcss@3.4.19` → chokidar / micromatch / fast-glob → `braces@3.0.3`; no patched version exists | `braces` is not in the tree. Tailwind 4's content scanner does not use chokidar, micromatch or fast-glob (`deps-security-fix.md` §1.1) |
| F6 | 8, postcss-selector-parser GHSA-rj75 (medium) | `tailwindcss@3.4.19`, `postcss-nested@6.2.0` → `postcss-selector-parser@6.1.4`; fixed only in 7.1.6 | `postcss-selector-parser` is not in the tree. Tailwind 4 has its own CSS parser and drops it and `postcss-nested` (§1.2 there) |

- **Change.**
  - `package.json`: `tailwindcss` `^3.4.7` → `^4.3.3`, plus `@tailwindcss/postcss` `^4.3.3`; `autoprefixer` removed.
  - `tailwind.config.js` is kept through `@config` (M2), and the source scan is pinned with `source(none)`.
  - `.github/dependabot.yml` no longer ignores the `tailwindcss` major.
  - No Rust change. Nothing new ships in the installers: Tailwind stays a devDependency.
- **Gates.** The main session re-ran these on the tree after the commit:
  - `npm audit`: 0 vulnerabilities;
  - `npm ls braces postcss-selector-parser`: empty;
  - `tsc`: clean;
  - `npm test`: 622/622;
  - `npm run build` and `scripts/check-emit.ts`: pass.

  S1 checked `npm ls braces postcss-selector-parser` (empty), `package.json` and `.github/dependabot.yml` (no `tailwindcss` entry) on its own.
- **Accepted risk (e)** now holds only R3 (`proc-macro-error`) and R4 (glib, §10). The review date 2027-01-10 is unchanged.
- **Q2 is settled.** Neither alert was dismissed or needs to be: the migration removes the cause. Nothing to dismiss for 5 and 8.
- **Alerts 5 and 8 stay `open` on GitHub until the merge.** They close only when the default branch's lockfile drops the packages. After the merge to `main`, check that both read `fixed`.
- **PR #31** (`dependabot/npm_and_yarn/npm-security-4bb469df06`, "bump postcss-selector-parser from 6.1.4 to removed") is the Tailwind 4 security PR that §4 expected.
  - It is a drive-by: its `package.json` change is only `tailwindcss` `^3.4.7` → `^4.3.3`, without `@tailwindcss/postcss` or the M2 config, so it is not a working migration.
  - `f225b8a` supersedes it. The main session or the owner closes it with a comment pointing here; agents leave it alone.
- **The new webview floor is a functional cost, not a security finding.** `color-mix()` and cascade layers mean Safari 16.2 / Chromium 111 for full styling. README states the floor (D4); details are in `deps-security-fix.md` §3.
