# Dependency security fix: Dependabot #5, #8, #10

Status: PLAN (decide only; nothing implemented, no alert dismissed).
Branch: `chore/deps-security-checkpoints` (cut from main e3ef782, v2.1.3).
Every commit message carries `[skip ci]`.

**Summary.** None of the three alerts is exploitable in Garita. #5 and #8 are build-time only, and Tailwind 4 removes both; a trial migration builds and passes every test. Its real cost is a webview floor (`color-mix()`), which the in-app updater cannot enforce. #10 is Linux only, sits in a function nothing calls, and has no upstream fix inside Tauri 2. Recommendation: migrate with the JS config kept (M2), dismiss #10, and make `cargo deny` check transitive unsoundness. Decisions: §6. Work: §7. Gates: §8.

## 1. Alerts, re-verified 2026-10-15

Sources for this section: `gh api repos/KANOMNUT/watchtower/dependabot/alerts` (state `open`), `npm audit`, `npm ls`, `cargo tree -i glib` under the MSVC recipe (host `x86_64-pc-windows-msvc` confirmed), `cargo deny check advisories` (cargo-deny 0.20.2), the crates.io sparse index, `npm view`. The older docs (`docs/impl/security-dependency-fix-plan.md` F5/F6/R3, `docs/security-report.md` F-04) were re-checked rather than trusted. Several of their claims are stale or wrong; see 1.4.

### 1.1 #5 high, npm `braces` 3.0.3 (GHSA-vfj7-8cjw-p6xm)

- **Path.** `tailwindcss@3.4.19` → `chokidar@3.6.0` → `braces@3.0.3`, and `tailwindcss` → `micromatch@4.0.8` (also via `fast-glob@3.3.3`) → `braces`. Dependabot scope `development`. Nothing else in the tree pulls `braces`.
- **Root cause.** Stack exhaustion on deeply nested brace patterns. There is **no patched release**: `first_patched_version` is null and 3.0.3 is the latest `braces`.
- **Exploitability for Garita: none.** `braces` runs only inside the Vite/PostCSS build, on the `content` globs in `tailwind.config.js` (`./index.html`, `./src/**/*.{ts,tsx}`). Those are repo-controlled. Nothing from `braces` is in `dist/`, so no shipped installer contains it. A worst case is a crashed `npm run build` on a malicious commit, which already has code execution in the build anyway.
- **Fix options.**

| Option | Clears #5 | Cost |
|---|---|---|
| A. Tailwind 4 (`tailwindcss@4.3.3`; the scanner is the Rust `@tailwindcss/oxide`, no chokidar/micromatch/fast-glob) | Yes | The migration in §2 plus the WebKit floor in §3. `npm audit` names it as the only fix (`fix available via npm audit fix --force`, "Will install tailwindcss@4.3.3"). |
| B. `overrides` to replace `chokidar`/`micromatch`/`fast-glob` under tailwind 3 | No | Every candidate still depends on `braces` (micromatch 4 and fast-glob 3 both do), or changes tailwind 3's watcher API. Nothing to override **to**. Rejected. |
| C. Dismiss with reason `tolerable_risk` ("Risk is tolerable to this project"). Not `not_used`: `braces` does run, at build time. | Hides it | Zero code. The alert cannot close any other way while Tailwind 3 stays, because there is no fixed `braces`. Not needed if A lands: the migration closes it. |

### 1.2 #8 medium, npm `postcss-selector-parser` 6.1.4 (GHSA-rj75-hqrm-r3gf)

- **Path.** `tailwindcss@3.4.19` → `postcss-selector-parser@6.1.4` (direct, `^6.1.2`), and `tailwindcss` → `postcss-nested@6.2.0` → same copy (`^6.1.1`). Scope `development`.
- **Root cause.** Quadratic parse time on long flat selectors (CPU exhaustion). Fixed only in **7.1.6**. The 6.x line has no backport (6.1.4 is the newest 6.x).
- **Exploitability for Garita: none.** The parser runs at build time on Garita's own CSS and on class names Tailwind generated from repo sources. The advisory itself says ordinary build-time use on trusted sources is not affected. Nothing reaches `dist/`.
- **Fix options.**

| Option | Clears #8 | Cost |
|---|---|---|
| A. Tailwind 4 | Yes. Tailwind 4 has its own CSS parser and drops `postcss-selector-parser` and `postcss-nested`. `@tailwindcss/postcss` still uses `postcss`, but not the selector parser. | Same as #5 A. One migration clears both npm alerts. |
| B. `"overrides": { "postcss-selector-parser": "^7.1.6" }` under tailwind 3 | Yes, on paper | **Still rejected.** 7.0.0 is a major ("make insertions during iteration safe"); tailwind 3 (9 files under `node_modules/tailwindcss/lib` import the parser, among them `util/formatVariantSelector.js`, `util/pseudoElements.js`, `lib/expandApplyAtRules.js`) and `postcss-nested` mutate selector ASTs while walking them, which is exactly the behaviour 7.0 changed. A silent wrong selector (for example a variant like `group-hover:` or `[&>x]:` emitted wrong) would not fail `tsc`, Vitest or the build. It needs the same full CSS comparison as option A, for a forced combination nobody upstream tests. |
| C. Dismiss with reason `tolerable_risk` (the parser runs at build time, so not `not_used`) | Hides it | Zero code. Not needed if A lands. |

### 1.3 #10 medium, cargo `glib` 0.18.5 (GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429)

- **Path (Linux only).** `cargo tree -i glib --target x86_64-unknown-linux-gnu`: `tauri 2.12.2`, `tauri-runtime-wry 2.12.1`, `wry 0.57.0`, `tao 0.37.1`, `muda 0.20.0` → `gtk 0.18.2` / `webkit2gtk 2.0.2` / `soup3 0.5` / `javascriptcore-rs 1.1.2` → `glib 0.18.5`. For `aarch64-apple-darwin` and `x86_64-pc-windows-msvc` the same command prints "nothing to print". **macOS and Windows builds do not contain glib.** (`docs/security-report.md` F-04 says "Linux/macOS"; that is wrong.)
- **Root cause.** `glib::VariantStrIter::impl_get` passed `&p` where the C out-parameter needed `&mut p`, so `VariantStrIter` iteration (`next`, `nth`, `last`, `next_back`, `nth_back`) dereferences NULL under optimisation. RustSec marks it `informational = "unsound"` and lists exactly those functions as affected. Fixed in glib 0.20.0.
- **Exploitability for Garita: not reachable.** `VariantStrIter` is produced only by `Variant::array_iter_str()`. A grep of every crate source in `~/.cargo/registry/src` for `array_iter_str|VariantStrIter` hits only `glib-0.18.5` itself: no hit in gtk, gdk, gio, atk, pango, cairo-rs, webkit2gtk, soup3, javascriptcore-rs, wry, tao, muda, tray-icon, libappindicator or tauri. No hit in `src-tauri/src`. Even if it were called, the effect is a NULL-pointer crash, not attacker-controlled memory corruption, and no untrusted GVariant input reaches it.
- **Why there is no upgrade.** On the crates.io index today:

| Crate | Newest | glib/gtk requirement |
|---|---|---|
| tauri | 2.12.4 (stable), 3.0.0-alpha.5 | 3.0.0-alpha.5 still declares `gtk = "^0.18"` (plus an optional `gtk4 = "^0.11.4"`) |
| wry | 0.57.0 | `gtk ^0.18`, `webkit2gtk =2.0.2`, `javascriptcore-rs =1.1.2`, `soup3 ^0.5` |
| tao | 0.37.1 | `gtk ^0.18` |
| muda | 0.21.2 | `gtk ^0.18` |
| webkit2gtk | 2.0.2 | newest release; built on gtk-rs 0.18 |
| gtk | 0.19.0 exists (`glib ^0.22`) | nothing in Tauri's stack accepts it |

  The gtk3-rs bindings stopped at 0.18; the newer gtk 0.19 is not something wry, tao or muda depend on. No released Tauri 2 line moves off glib 0.18. A `[patch.crates-io]` with a forked glib 0.18 carrying the one-line fix is possible in principle but breaks `deny.toml` (`unknown-git = "deny"`), needs a fork to maintain, and buys nothing for an unreachable function. Rejected.
- **Fix options.**

| Option | Clears #10 | Cost |
|---|---|---|
| A. Wait for Tauri/wry to move to gtk4 or gtk-rs ≥ 0.20 | Yes, later | Zero now. No date upstream. |
| B. `[patch]` a forked glib 0.18 | Yes | Rejected (above). |
| C. Dismiss on GitHub with reason `not_used` ("Vulnerable code is not actually used"), and record it in `deny.toml` (§1.4) | Hides it | One `deny.toml` edit. |

### 1.4 Corrections to existing docs and config

- **`cargo deny check advisories` says `advisories ok` with this alert open.** cargo-deny 0.20.2 does not fail on a transitive `unsound` advisory under the current `deny.toml`. Checked by running the same policy with `unsound = "all"` added: it then fails with `error[unsound]` on RUSTSEC-2024-0429 via `glib v0.18.5`. It is the only hit (full untruncated run). So the `deny.toml` comment "Every vulnerability and unsoundness advisory fails the check" is false today. With `unsound = "all"` **and** `ignore = [{ id = "RUSTSEC-2024-0429", reason = … }]` the full `cargo deny check` prints `advisories ok, bans ok, licenses ok, sources ok` (tried with a temporary config). The policy and the comment must agree; see decision D3.
- `docs/security-report.md` F-04 says glib is linked on Linux/macOS and that `cargo update glib` fixes it. Both are wrong: Linux only, and no in-range update exists.
- `docs/impl/security-dependency-fix-plan.md` F6 names `postcss-selector-parser@6.1.2`; the lockfile now has 6.1.4 (alert 2, the 6.1.3 fix, landed). The rest of F5/F6 still holds.

## 2. Tailwind 4 migration cost

Measured, not estimated: a throwaway copy of the frontend (`index.html`, `src/`, `package*.json`, `tailwind.config.js`, `postcss.config.js`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`) in a temp directory, `npm ci`, then `npx @tailwindcss/upgrade@4.3.3`, then `vite build` and `vitest run`. Baseline: `vite build` of the current tree (Tailwind 3.4.19). The repo itself was not touched.

### 2.1 What the upgrade tool does

| Area | Change | Verdict |
|---|---|---|
| Packages | `tailwindcss ^3.4.7` → `^4.3.3`; adds `@tailwindcss/postcss ^4.3.3`; removes `autoprefixer` (v4 prefixes itself, via Lightning CSS) | Keep. `npm audit` on the result: **0 vulnerabilities**; `npm ls braces postcss-selector-parser` empty. |
| `postcss.config.js` | `tailwindcss` + `autoprefixer` → `'@tailwindcss/postcss'` | Keep. `@tailwindcss/vite` (peer `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8`, fits vite 6.4.3) is the upstream recommendation, but it means a `vite.config.ts` edit plus deleting `postcss.config.js` for build speed only. Not needed; postcss is the smaller diff. |
| `tailwind.config.js` | **Deleted.** Every colour becomes `--color-<role>: rgb(var(--c-<role>))` in an `@theme {}` block at the top of `src/index.css` (baked-alpha roles keep `/ var(--a-…)`); fonts, keyframes and animations move there too. | See 2.3: keeping the JS file through `@config` is the smaller, test-neutral option. |
| `src/index.css` | `@tailwind base/components/utilities` → `@import 'tailwindcss'`; `@layer components { .mono … .fade-in }` → seven `@utility` blocks (`row-hover`/`row-selected`/`row-bar` split into nested forms); adds a compat `@layer base` that sets `border-color: var(--color-gray-200, currentcolor)` on `*` to keep the v3 default border colour. | `@utility` is only needed for variant use (`hover:mono`); none exists (`grep -rnE "(sm\|md\|lg\|hover\|focus\|group-hover\|dark):(mono\|grain\|hairline\|row-…)"` finds nothing). Plain `@layer components` CSS still works in v4. |
| Templates | 57 files, 617 token edits: `rounded` → `rounded-sm` (v4 renamed the scale), `rounded-sm` → `rounded-xs`, `outline-none` → `outline-hidden`, `break-words` → `wrap-break-word`, `backdrop-blur` → `backdrop-blur-sm`, `bg-gradient-to-br` → `bg-linear-to-br`, `ring` → `ring-3`, `!px-1` → `px-1!`, a bare `"outline"` → `"outline-solid"`, and arbitrary opacities `bg-surface-tint/[0.04]` → `bg-surface-tint/4` (201 diff lines). | Needed in every option (they are v4 scale and semantics changes, not cosmetics). |
| **False positive** | `src/utils/rightSizing.test.ts`: the test title `"caps the ring at 20"` became `"caps the ring-3 at 20"`. The tool rewrites any string that looks like a class. | Every tool edit must be reviewed by diff. Revert this one. Expect more in non-class strings. |

### 2.2 Results of the trial

"M2" below is the real combination §2.5 asks for: the tool's template renames and package/postcss changes, the original `tailwind.config.js`, `@import` + `@config` in `src/index.css`, the tool's border-colour compat block, and the `rightSizing.test.ts` false positive reverted. Node 22.11.0. The copy had no `docs/`, so auto-detection matched the repo's `content` scope; with `source(none)` (2.4.5) the CSS is 91.1 KB.

| Check | Tailwind 3 (today) | Tailwind 4, tool output (M1) | Tailwind 4, M2 |
|---|---|---|---|
| `npm run build` (`tsc` + `vite build`) | pass, CSS 61.9 KB | `vite build` pass, CSS 99.1 KB | pass, CSS 91.5 KB |
| `npm test` | pass | **`themeTokens.test.ts` fails** (reads the deleted `tailwind.config.js`) | 47 files, 622 tests pass |
| `node --experimental-strip-types scripts/check-emit.ts` | pass | not run | pass |
| `color-mix(` in CSS | 0 | 532 | 356 |
| `@property` | 0 | 68, plus an `@layer properties` `@supports` fallback for engines without it | 69, same fallback |
| `@layer` (cascade layers) | 0 | `theme`, `base`, `components`, `utilities`, `properties` | same |
| Native CSS nesting, `:has()`, `@starting-style`, `@container` in output | none | none | none |
| `npm audit` | 7 (2 moderate, 5 high) | 0 | 0 |

### 2.3 The two migration shapes

- **M1, CSS-first** (what the tool writes). Tokens live in `@theme` in `src/index.css`; `tailwind.config.js` is gone. Costs on top of the template renames: `src/utils/themeTokens.test.ts` must be rewritten (its `cfg` reads, the `<alpha-value>` form test at line 68, the alias test at line 81); `docs/claude/ui.md` → Appearance and the CLAUDE.md Architecture line ("mapped in `tailwind.config.js`") change; the 61 colour entries move file.
- **M2, keep the JS config via `@config`** (tried, 2.2). `src/index.css` lines 1–3 become `@import "tailwindcss" source(none);` and `@config "../tailwind.config.js";` plus the compat border block (`source(none)`: see 2.4.5); `tailwind.config.js`, its `<alpha-value>` entries and the `@layer` blocks stay as they are. Every test passes unchanged. Tailwind documents JS config as "still supported for backward compatibility, but … no longer detected automatically"; `corePlugins`, `safelist` and `separator` are unsupported, and Garita uses none of them (`plugins: []`).

**Pick M2.** Smallest diff, no test or doc churn for the token system, same security result. It keeps the CLAUDE.md line "mapped in `tailwind.config.js`" and `ui.md` → Appearance true. M1 is a later cleanup with no security value.

### 2.4 Behaviour changes neither shape fixes by itself

These need hand fixes and are what the CSS gate (§8) exists to catch.

1. **Opacity modifiers on baked-alpha tokens change meaning.** `docs/claude/ui.md` → Appearance makes today's behaviour a rule: "A modifier **replaces** the baked alpha, it does not multiply it: `border-edge/60` is 60 % of the channel colour in both themes". `edge`, `edge-strong`/`edge2`, `log-match`, `log-highlight` carry their own alpha (`rgb(var(--c-edge) / var(--a-edge))`). Tailwind 3 *replaces* that alpha: `border-edge/60` → `rgb(var(--c-edge) / .6)`. Tailwind 4 *multiplies* it: `color-mix(in oklab, rgb(var(--c-edge) / var(--a-edge)) 60%, transparent)`, so 0.06 × 0.6 = 0.036 on dark. Affected uses today: `border-edge/{20,30,40,50,60,70}`, `ring-edge/{40,60}`, `divide-edge/60`, 69 in all. Fix: one non-baked alias key on the same channel (name is F1's call, for example `"edge-raw": "rgb(var(--c-edge) / <alpha-value>)"`), and rewrite the 69 modifier uses to it (`border-edge/60` → `border-edge-raw/60`); plain `border-edge` stays. The result must match the Tailwind 3 CSS for those classes. Two knock-ons, both F1's:
   - `themeTokens.test.ts` "alpha-baked keys use the --a form" (line 68) rejects a `<alpha-value>` key on a baked channel, so it needs an explicit allow-list for the alias.
   - The `ui.md` → Appearance sentence above must name the alias.
   Rejected: an arbitrary value per class (`border-[rgb(var(--c-edge)/0.6)]`), because `ui.md` → Appearance G1 fails any `rgb(var(--c-…))` string in a `.tsx` on purpose. Also rejected: a config function colour (`({ opacityValue }) => …`). Tried under v4 `@config`, it builds but emits no `border-edge*` rule at all.
2. **Every other opacity modifier (1,245 uses on CSS-variable colours) now needs `color-mix()`.** M1 emits `color-mix(in srgb, …)` first and `color-mix(in oklab, …)` under `@supports`, with no non-`color-mix` fallback; on an engine without it the class sets no colour. M2 emits the token at alpha 1 first, so `bg-accent/10` degrades to a solid accent fill. Either way this is the hard floor in §3, not something to code around.
3. **Preflight defaults** (Tailwind upgrade guide):
   - Buttons get `cursor: default` (v3: `pointer`). 392 `<button>` in `src/`, 26 `cursor-pointer`. Fix: one base rule for `button:not(:disabled), [role="button"]:not(:disabled)`, as the guide shows.
   - Placeholder colour becomes the current text colour at 50% (v3: gray-400). 161 `placeholder=` and some `placeholder:` classes (the inputs without one change colour). Fix (corrected after review R1): one base rule `color: var(--color-gray-400)`, the same pattern as the gray-200 border compat line, so both themes keep v3's placeholder colour (`ui.md` → Appearance parity rule). The first version used the `mute` role, which changed the colour.
   - `border`/`divide` default colour becomes `currentColor`: the tool's compat block covers it; keep it.
   - `ring` default width 1px and colour `currentColor` (v3: 3px, blue-500/50). The tool turns bare `ring` into `ring-3`; any `ring-N` without a ring colour class changes colour. Check each.
   - The `hidden` attribute now beats display classes (14 `hidden` attributes in `.tsx`); `space-x/y-*` selectors changed (2 uses); `hover:` applies only under `@media (hover: hover)` (fine on desktop with a pointer).
4. **Two animations start running.** `.slide-in` (2 uses) and `.fade-in` (3 uses) in `src/index.css` name the `slide-in`/`fade-in` keyframes from the config. Tailwind 3 emits those keyframes only when an `animate-slide-in`/`animate-fade-in` class is used, and none is, so today's CSS has `.slide-in{animation:slide-in …}` with no `@keyframes slide-in`: the animation never runs. Tailwind 4 emits them, so panels start sliding and fading in. It is a latent v3 bug becoming visible, not a regression. §6 D6.
5. **Source detection widens unless pinned.** Tailwind 4 scans every non-ignored file in the project by default, on top of the config's `content`. With `docs/claude/`, `README.md` and `CHANGELOG.md` present, the trial emitted 16 extra classes, among them `bg-white/10`, `text-yellow-400`, `ring-gray-700`, `accent-blue-400` (default-palette classes that `ui.md` → Appearance G2 forbids, quoted in docs). With `@import "tailwindcss" source(none);` the config `content` globs are still honoured (845 classes vs 848 auto-detected without docs), which keeps today's scan scope and keeps `ui.md`'s "Tailwind scans `*.test.ts` too (`content` is `./src/**/*.{ts,tsx}`)" true.
6. **Classes Tailwind 3 silently dropped now render.** Example: `ring-current/30` in `src/components/MergeFromFileModal.tsx:95`. Tailwind 3 cannot put an opacity on `currentColor` and emitted nothing; Tailwind 4 emits a `color-mix` ring at 30 % of the text colour. The class diff in §8 lists every such case for a keep-or-drop call.

### 2.5 Cost summary

One frontend task, about a day: run the tool, keep its template renames and package/postcss changes, drop its `@theme` and `@utility` rewrite in favour of M2, revert false positives, fix 2.4.1, 2.4.3 and 2.4.6, pass the §8 gates. No Rust change. No new runtime dependency (Tailwind stays a devDependency; nothing new ships in the installers).

## 3. Browser floor

Tailwind's own statement: "designed for Safari 16.4+, Chrome 111+, and Firefox 128+" and "will not work in older browsers" (upgrade guide). What the M2 output actually needs:

| Feature in the output | Safari | Chromium | If missing |
|---|---|---|---|
| Cascade layers (`@layer theme, base, components, utilities`) | 15.4 | 99 | All Tailwind CSS is dropped: unstyled app |
| `color-mix()` (356 rules: every opacity modifier) | 16.2 | 111 | M2 falls back to the token at alpha 1: tints become solid fills |
| `@property` (69) | 16.4 | 85 | Covered by the `@layer properties` `@supports` fallback (initial values on `*`) |

Per webview:

| Platform | Engine | Meets the floor? | Source |
|---|---|---|---|
| Windows 10/11 | WebView2, evergreen Chromium | Yes | Tauri webview-versions page ("can update itself"). Windows 7/8.1 WebView2 is frozen at Chromium 109 (< 111): Garita should list Windows 10+ |
| Ubuntu 22.04 (oldest Linux target, the release runner) | webkit2gtk | Yes **with updates**: jammy-updates and jammy-security ship 2.50.4 (uploaded 2026-01-06). The GA pocket has 2.36.0, which predates `color-mix` (Tauri maps 2.36 to Safari TP 140, about 16.0) | launchpad.net/ubuntu/jammy/+source/webkit2gtk |
| macOS 13.3+ Ventura and newer | WKWebView | Yes (13.3 bundles Safari 16.4) | Tauri webview-versions table |
| macOS 12 Monterey (cask `depends_on macos: ">= :monterey"`) | WKWebView | **Unverified.** Monterey 12.0–12.5.1 bundles Safari 15.0–15.6.1 (Tauri table). Apple later shipped Safari 16 and 17 for Monterey as separate updates; no source was found on whether those also update the WebKit that WKWebView apps load. Tauri's page only says WebKit "is updated with the regular OS updates". | — |

**The floor only gates new installs.** `depends_on macos:` only stops `brew install`. The macOS in-app updater delivers the next release to every current install whatever its WebKit, and Linux/Windows users act on the update notice. A README or cask line is advice to existing users, not a gate. The population at risk is a machine that has skipped about three years of WebKit updates (Ubuntu 22.04 without `jammy-updates`, Monterey without Safari updates, if those do not reach WKWebView).

One optional mitigation, not a requirement: a startup check `CSS.supports("color", "color-mix(in srgb, red, red)")` that shows a banner ("Update your system WebView") when false. Cost: about 20 lines in one component plus a pure helper and its test. §6 D5.

## 4. Alternatives to a full migration

| Alternative | Result | Why |
|---|---|---|
| `overrides` `postcss-selector-parser` → `^7.1.6` under Tailwind 3 | Rejected (again) | Major with "make insertions during iteration safe"; Tailwind 3 and `postcss-nested` mutate selector ASTs while walking (§1.2). Wrong selectors fail silently. Same CSS-diff cost as migrating, for an untested combination. |
| `overrides` `chokidar` → `^4` (no `braces`) | Does not close #5 | Tailwind 3 loads `chokidar` only in its CLI watcher (`lib/cli/build/watching.js`); Garita uses the PostCSS plugin. The live path is `lib/lib/content.js` → `micromatch` 4.0.8 (newest) → `braces ^3.0.3`, and `fast-glob` 3 → `micromatch`. No `micromatch`/`fast-glob` release drops `braces`. |
| Replace `micromatch`/`fast-glob` | Not possible | Tailwind 3 calls their APIs directly; there is nothing API-compatible without `braces`. |
| Dismiss #5/#8 as `tolerable_risk` | Works, zero code | Honest: both run only at build time on repo-controlled input, and nothing reaches the installers. Costs: the alerts' cause stays. Tailwind 3's last release is 3.4.19 (2025-12-10), and its tree has produced three alerts so far (2, 5, 8). Expect more. |
| Tailwind 4 with the CSS-first config (M1) | Works, more churn | §2.3. No security gain over M2. |

## 5. Recommendation

1. **#5 and #8: migrate to Tailwind 4 using M2** (§2.3), with the fixes in §2.4. It removes the cause, the trial build and test suite pass, and the remaining work is a known list. Today's floor is met by every supported platform that takes updates. The risk that decides it is §3: a webview that has skipped years of updates degrades after the next auto-update, and no README line or cask floor prevents that.
2. **#10: dismiss as `not_used`**, and make `deny.toml` enforce transitive `unsound` advisories with one documented ignore for RUSTSEC-2024-0429. Nothing upstream can fix it today.
3. Correct the stale docs (§1.4).

## 6. User decisions

Defaults in bold. The main session records each answer in the ledger.

**Answered by the user, 2026-10-15:** D1 (a) Tailwind 4, shape M2; D2 (a) dismiss #10 as `not_used`, run by the user; D3 (a) `unsound = "all"` plus the RUSTSEC-2024-0429 ignore; D4 the default wording; D5 (a) no banner; D6 (a) keep the animations, stopped under reduced motion. Review R1 changed one detail: the placeholder colour is gray-400, not `mute`. Shipped in v2.1.3.

1. **D1, alerts #5 and #8.** **(a) Migrate to Tailwind 4 (M2).** You accept that a webview without `color-mix()` (older than Safari 16.2, Chromium 111, or a non-updated Ubuntu 22.04 WebKitGTK) shows solid colours where tints were after it auto-updates, and one without cascade layers (older than Safari 15.4) shows the app unstyled. Or (b) keep Tailwind 3. Under (b) you choose again between your 2026-10-11 Q2 answer (`security-dependency-fix-plan.md` §8: "alerts 5 and 8 stay open as the reminder until Tailwind 4") and dismissing both as `tolerable_risk` with a review on 2027-01-10.
2. **D2, alert #10.** **(a) Dismiss now as `not_used`.** Or (b) leave it open until Tauri leaves gtk 0.18. The `deny.toml` ignore (D3) records the exit condition either way. To dismiss, you run the command below; agents never do. The repo name was checked on 2026-10-15: `gh api repos/KANOMNUT/watchtower --jq .full_name` returns `KANOMNUT/watchtower`. Check it again before you run the command.

   Decided (a) on 2026-10-15. Final text (S1): reason `not_used`; comment 272 characters (the API caps `dismissed_comment` at 280); the token needs the `security_events` scope. One line, for Git Bash:

   ```bash
   "/c/Program Files/GitHub CLI/gh.exe" api -X PATCH repos/KANOMNUT/watchtower/dependabot/alerts/10 -f state=dismissed -f dismissed_reason=not_used -f dismissed_comment="Linux-only glib 0.18 via Tauri 2's gtk ^0.18 stack (wry/tao/muda); macOS/Windows builds have no glib. Nothing in the graph calls VariantStrIter. No Tauri 2 release accepts glib >= 0.20. Ignored as RUSTSEC-2024-0429 in src-tauri/deny.toml until wry/tao/muda leave gtk 0.18."
   ```

   Check afterwards: `"/c/Program Files/GitHub CLI/gh.exe" api repos/KANOMNUT/watchtower/dependabot/alerts/10 --jq '.state, .dismissed_reason'` prints `dismissed` and `not_used`.

   Only if D1 = (b), for #5 and #8, the same command with `dismissed_reason=tolerable_risk` and the comment "Build-time only (Tailwind 3 content scan / CSS parse) on repo-controlled input; nothing ships in the installers. No braces fix exists. Review 2027-01-10."
3. **D3, `deny.toml`.** **(a) `unsound = "all"` plus `ignore = [{ id = "RUSTSEC-2024-0429", reason = "… drop when wry/tao/muda leave gtk 0.18" }]`** (tried: full `cargo deny check` passes), so new transitive unsoundness fails the gate. Or (b) keep the policy and correct the comment to say transitive unsoundness is not checked.
4. **D4, the stated floor (only if D1 = a).**
   - **README, Installation: one line: "Needs a current system webview: macOS 13.3 or later (on macOS 12, install the latest Safari; untested), Ubuntu 22.04 or later with updates, Windows 10 or later."**
   - README tech table: Tailwind CSS 3.4 → 4.
   - **Cask: keep `depends_on macos: ">= :monterey"`.** The alternative, `>= :ventura`, is still not exact (13.0–13.2 lack Safari 16.4), and the in-app updater ignores it anyway.
5. **D5, stale-webview banner (only if D1 = a).** **(a) No.** Or (b) add the `CSS.supports` check from §3, about 20 lines plus a test.
6. **D6, panel animations (only if D1 = a).** **(a) Keep the `.slide-in`/`.fade-in` animations that start running** (§2.4.4), and add both classes to the existing `prefers-reduced-motion` block in `src/index.css`. Or (b) drop them to keep today's static look.

## 7. Task split

Rust: **nothing for rust-engineer to do.** No Rust source or `Cargo.toml`/`Cargo.lock` change; `deny.toml` is policy and goes to security-engineer.

| Task | Agent | Owns (one owner per file) | Commit |
|---|---|---|---|
| S1 | security-engineer | `src-tauri/deny.toml` (D3); `docs/security-report.md` F-04 (Linux only, no in-range fix, not reachable, pointer here); `docs/impl/security-dependency-fix-plan.md` (F6 version 6.1.4; F5/F6 accepted-risk rows and the Wave 4 Tailwind row point here with the outcome of D1; R3 unchanged). Puts the final dismissal comment text (D2) in its report; dismisses nothing. | `chore(security): fail on transitive unsound advisories, record glib RUSTSEC-2024-0429 [skip ci]` |
| F1 (only if D1 = a) | frontend-engineer | `package.json`, `package-lock.json`, `postcss.config.js`, `src/index.css`, `src/**` files the renames touch, `tailwind.config.js` (the 2.4.1 edge alias), `src/utils/themeTokens.test.ts` (alias allow-list), `.github/dependabot.yml` (drop the `tailwindcss` major ignore and "Tailwind 4 (Safari 16.4)" from its comment), `THIRD_PARTY_LICENSES` (regenerate: `node scripts/third-party-licenses.mjs`; `cargo-about` is in `~/.cargo/bin`), `README.md` (D4), `Casks/garita.rb` (only if D4 changes it), `docs/claude/ui.md` (Appearance alpha sentence names the edge alias), `CHANGELOG.md` `[Unreleased]` (sole owner: Changed "Tailwind CSS 4; needs a current system webview", Fixed "panel slide/fade animations run" if D6 = a) | `build(deps): Tailwind CSS 4, closes Dependabot #5 and #8 [skip ci]` |

F1 steps:
0. The upgrade tool runs `npm install`, which swaps `node_modules` under a `make dev` the user may have running. Check who owns :1420 first, and ask the user before installing if it is in use.
1. Run `npx @tailwindcss/upgrade@4.3.3 --force` in the tree. `--force` is needed because `src-tauri/gen/schemas/*.json` are dirty. Check that the tool did not touch them.
2. Keep the tool's package, postcss and template changes. Then:
   - Restore `tailwind.config.js` and the `@layer components` block.
   - Write the M2 header with `source(none)` and keep the compat border block.
   - Review every hunk and revert false positives; `rightSizing.test.ts` is a known one.
3. Fix §2.4 items 1, 3 and 6, plus D6.
4. Regenerate `THIRD_PARTY_LICENSES`. Keep the diffs narrow:
   - `package-lock.json` changes only the Tailwind tree and `autoprefixer`.
   - `THIRD_PARTY_LICENSES` changes only the `tailwindcss` entry. If the Rust part moves after a regeneration on Windows, stop and report; do not commit it.
5. Run the §8 gates.

Stale-doc sweep (`grep -rn -i tailwind docs README.md CONTRIBUTING.md AGENTS.md site`):
- **F1:** `README.md:203` (tech table).
- **S1:** `docs/impl/security-dependency-fix-plan.md` lines 69–70, 179, 187, 192, 197–199, 265, 279 and 316 (the F5/F6 rows, Wave 4, accepted risk, Q2 and the "expect a Tailwind 4 security PR" notes).
- **Still true under M2, no change:** `CONTRIBUTING.md:52`, `AGENTS.md:54`, `docs/claude/key-files.md:43,46` and `ui.md:148–149, 187` all say tokens are in `tailwind.config.js` and `content` is `./src/**`.
- **Historical, leave alone:** `docs/impl/v1.4.2-tasks.md`.

**Ordering.** S1 and F1 run in parallel; their files are disjoint. One one-way dependency: S1 writes the F5/F6 outcome rows in `security-dependency-fix-plan.md` only after F1's gates pass, or after D1 = (b). The main session commits F1 first, then S1. The `[Unreleased]` entry goes in F1's commit.

## 8. Verification gates

| # | Gate | Pass |
|---|---|---|
| G1 | `npm audit`; `npm ls braces postcss-selector-parser` | `found 0 vulnerabilities`; both packages absent (D1 = a) |
| G2 | `npm run build`; `npm test`; `node --experimental-strip-types scripts/check-emit.ts` | all pass (the trial: 47 files, 622 tests) |
| G3 | CSS class diff, below | every entry fixed or signed off in F1's report |
| G4 | Base-layer checks on the candidate `dist/assets/*.css` (G3 cannot see them) | button `cursor: pointer` rule present; `::placeholder` colour as F1 chose (2.4.3), confirmed at G9; compat `border-color` rule present; `@keyframes slide-in`/`fade-in` present and both classes inside `prefers-reduced-motion` (D6 = a) |
| G4b | Ring default colour: v3 sets `--tw-ring-color` to blue-500/50 on `*`, v4 uses `currentColor`, and G3 cannot see the difference. List every className with a ring width (`ring-1`, `ring-2`, `ring-3`, `ring-inset`) and no ring-colour class | each site gets an explicit role colour or a sign-off; dynamic `${cls}` sites are checked by hand |
| G5 | Token presence: `grep -o 'var(--[ac]-[a-z0-9-]*)'` over baseline and candidate CSS, `sort -u`, `comm` | every `--c-*`/`--a-*` the baseline CSS references is referenced by the candidate |
| G6 | `cargo deny check` in `src-tauri` (MSVC recipe, host checked). CI uses the same version: `EmbarkStudios/cargo-deny-action@3c63498…` (v2.1.1) pins `deny_version="0.20.2"` in its Dockerfile, so the `unsound` key parses in CI as it does locally | `advisories ok, bans ok, licenses ok, sources ok` with the D3 policy |
| G7 | `cargo check` and `cargo test --lib` in `src-tauri` (workflow step 6; no Rust change expected) | pass; `kubeconfig::tests::accepts_absolute_paths` is the known Windows-only failure |
| G8 | Doc claims grep: `grep -n unsound src-tauri/deny.toml`, `grep -n tailwindcss .github/dependabot.yml`, the README floor line, `CHANGELOG.md` `[Unreleased]`; plus the `ui.md` → Appearance guard greps G1–G3 (new base rules use roles, no hex or numeric `rgb()`) | comment matches policy; no `tailwindcss` major ignore left (D1 = a); lines present; G1–G3 report nothing new |
| G9 | One look in `make dev`: dark and light, one non-blue accent, a table with selected and hovered rows, a modal, a form with placeholders. The user does this; agents don't start a dev server, since :1420 may be theirs. | user OK |

**G3, CSS class diff.** It is a throwaway Node script in the agent's scratch directory, never committed.
- **Baseline.** Export main read-only (`git archive e3ef782 | tar -x -C <scratch>/base`), then run `npm ci` and `npx vite build` there. It is independent of the working tree, so it can run at any time.
- **Candidate.** F1's tree, `npx vite build`.
- **The script** (F1 writes it):
  1. Parses each CSS into a map from class (variants included) to normalised declarations. For Tailwind 4 it takes the `@supports (color: color-mix(in lab, …))` body where one exists.
  2. Maps baseline names through the §2.1 rename table: `rounded` → `rounded-sm`, `rounded-sm` → `rounded-xs`, `outline-none` → `outline-hidden`, `break-words` → `wrap-break-word`, `backdrop-blur` → `backdrop-blur-sm`, `bg-gradient-to-*` → `bg-linear-to-*`, `!x` → `x!`, `/[0.0N]` → `/N`, `ring` → `ring-3`, `outline` → `outline-solid`, `z-[1]` → `z-1`, `leading-[1.5]` → `leading-normal`.
  3. Treats `rgb(var(--c-X) / A)` as equal to `color-mix(in oklab, <X> P%, transparent)` only when role X has no baked alpha and P = 100 × A. Baked-alpha classes are compared after mapping `edge/N` → the 2.4.1 alias, and must then match exactly.
  4. Prints classes only in the baseline, only in the candidate, and in both but different.
- **Known entries to sign off:** the 2.4.6 newcomers (`ring-current/30`); comment-word classes Tailwind 3 extracted and Tailwind 4 does not (`lowercase`, seen in the trial); the keyframes (2.4.4). The 69 baked-alpha edge uses must show **no** difference.

Alerts #5 and #8 close on GitHub only when the default branch's lockfile drops the packages. That happens after the merge to main, not on this branch.
