# 10 - v2.0.0 rebrand: UX spec

Owner: senior-ux-specialist. Plan: `docs/impl/v2.0.0-tasks.md` §Freeze addendum A3, A4, A6 (RB-6). Name is `<NEWNAME>` until G-NAME clears. Copy only; files belong to their owners.

---

## Part 1. RB-6 upgrade notice (BLOCKING, ready to build)

### 1.1 Surface

Reuse the **`ClusterAccessBanner` strip** (`src/App.tsx`: `mx-4 mt-3 shrink-0 px-3 py-2 rounded-lg ring-1 flex items-start gap-2.5 text-[12px]`, dismiss `✕` button). Reasons: it is the app's one existing non-modal, dismissible, above-content notice; no toast system exists; a modal would block a user who opened the app mid-incident to read a pod log (Nielsen: user control, flexibility). The notice is not an error, so:

- Tone: the neutral variant, `bg-surface-tint/[0.03] ring-edge text-mute` (same as the banner's quiet `queryError` variant). **Never** `warn`/`bad` classes, **never** `AlertTriangle`.
- Icon: `Eye` size 14 (the read-only glyph from `ReadOnlyBadge.tsx`; "never a padlock").
- Title: `text-ink font-medium` on its own line. Body `text-mute`. Buttons below the body, right-aligned is not needed; left-aligned, `gap-3`.
- Placement: same slot as `ClusterAccessBanner`. If both show, stack them with the access banner **first** (it may need action; this one is informational). Region: `role="region" aria-label="Upgrade notice"`. Not `role="alert"` (calm; no focus steal, no assertive announcement).
- Focus: never moved to the notice. Tab order: after TopBar, before the content area, like the banner.

### 1.2 Copy (verbatim)

Title:

> All clusters start read-only

Body (36 words):

> Settings from your earlier install couldn't be carried over, so every cluster starts read-only. Colours, labels, typed confirmation, bulk limits, the active cluster and view preferences were reset. Turn read-only off per cluster from the Read-only chip in the top bar.

Buttons:

| Order | Label | Style | Action |
|---|---|---|---|
| 1 | `Got it` | primary: `px-2.5 py-1 rounded-md text-[11.5px] bg-accent text-on-accent` (use the existing primary-button class used in `ConfirmModal` if one exists; no new token) | dismiss |
| 2 | `Open cluster switcher` | secondary: `text-accent hover:underline text-[11.5px]` | `setSwitcherOpen(true)`, then **keep** the notice (user may want to read it again) |

`✕` (existing dismiss) gets `aria-label="Dismiss"` and does the same as `Got it`.

### 1.3 Why this wording

- "couldn't be carried over": states the cause without blaming the user and without naming the old product (RB-2 grep stays clean).
- "so every cluster starts read-only": cause then effect in one sentence. Never "protected", "secured" or "safe" (copy rules). Never "fail-closed", "seeded", "migration" (jargon the user cannot act on).
- "Colours, labels, typed confirmation, bulk limits": exact names from the ContextSwitcher Guardrails group ("Confirm writes by typing the cluster label" is shortened to "typed confirmation"; "Bulk action limit" to "bulk limits"). Per A4 also lists active cluster and view preferences. Column widths, saved searches, theme and accent are inside "view preferences" (theme and accent are in `appearance`; if the user sees the theme reset, the notice covers it).
- Path: verified in code. Read-only chip is in `TopBar.tsx` (shown only for the **current** cluster); its popover has `Keep on` / `Turn off…`, which opens `TurnOffReadOnlyConfirm` (always a confirm, no typed confirm). Table views also show `ReadOnlyStrip` with `Turn off…`. The per-cluster checkbox lives in the ContextSwitcher guardrails group (reached by the colour/label button on a cluster row). Settings has **no** read-only control (sections are Diagnostics and Appearance only), so the copy must not say "Settings". "per cluster" tells the user it is not one global switch.
- No "guardrail, not a security boundary" sentence here: it is already in the chip popover and ContextSwitcher; repeating it makes this notice long. If tech-lead wants it, append: `It limits the app's own write actions only.` (47 words total).

### 1.4 States and behaviour

| State | Behaviour |
|---|---|
| Seed written, notice queued | Show on the next render of `AppInner`, on any main view (resources, Settings, Health, Journal). |
| Dismissed (`Got it` or `✕`) | Hide for good. Never re-shown. |
| App closed before dismiss | **Show again on next launch until dismissed.** The seed is once-only (store no longer `null`), so without this the user would see read-only everywhere and never learn why. Frontend persists a tiny flag (e.g. `localStorage["upgrade-notice"] = "pending"`, removed on dismiss); wrap in try/catch, and if storage is unavailable show for the session only. |
| User turns read-only off on some clusters | Notice stays until dismissed. Do not auto-dismiss (it also reports the resets). |
| `list_contexts` failed, nothing seeded | No notice (nothing happened; next launch retries). |
| Detection rejected (fail closed) | Same notice, same copy. |
| No clusters listed | No seed, no notice. |
| Narrow window (min 1024) | Body wraps; buttons wrap below. No horizontal scroll. |
| Screen reader | Region is announced by landmark navigation only. Do not also write to the `role="status"` announcer on mount (it would speak at launch with no user action). |

### 1.5 Release-notes line (for CHANGELOG, tech-lead)

`v2.0.0 starts every cluster read-only on first launch and resets colours, labels, typed confirmation, bulk limits, the active cluster and view preferences. Turn read-only off per cluster from the top bar.`

---

## Part 2. RB-6 string review checklist (run when G-NAME clears)

Source: `git grep -nIi watchtower -- src` (2026-10-09). All strings must read `PRODUCT_NAME` (`src/brand.ts`); do not hand-type the name. Run each with the candidate name before C1.

### 2.1 Rules

1. **Never put `a`/`an` directly before the name.** "an Lanthorn" fails. Write "the app" where no article is needed.
2. **Possessive.** `'s` is fine for all four shortlist names (none ends in s). If the final name ends in `s`/`x`, switch every "X's write actions" to "the write actions of X" or "the app's".
3. **Prefer "the app"** in sentences where the name adds nothing. Fewer name occurrences means fewer re-reviews and shorter sentences. Keep the name only where the product is contrasted with kubectl or another tool.
4. **Name as subject of "no longer"/"never"** is fine. Name must not be pluralised or lowercased in UI (the lowercase slug is only for ArgoCD `initiatedBy` and filenames).
5. Do not shorten; no "LT". One spelling, one capitalisation.

### 2.2 Per-string table

| File | String (today) | Check / suggested edit |
|---|---|---|
| `Sidebar.tsx:167` | brand text `Watchtower` | See §2.3 fit. |
| `ContextSwitcher.tsx:123` | "Disables Watchtower's write actions on this cluster. A guardrail, not a security boundary: kubectl and other tools aren't affected. …" | Possessive OK. Best: "Disables the app's write actions on this cluster." Shorter, and the rest still contrasts with kubectl. |
| `ContextSwitcher.tsx:227` | title "Copy: kubectl config use-context (sets your kubectl default — Watchtower no longer does this for you)" | History-flavoured: it explains a v1.2 change that v2 users never saw. Suggest "Copy: kubectl config use-context (sets your kubectl default; this app doesn't change it)". |
| `ContextSwitcher.tsx:271` | title "Remove from Watchtower — does not delete the file" | Keep the name or "Remove from the app list"; if kept, "Remove from <NEWNAME>. Does not delete the file." (drop the em dash per house style). |
| `ReadOnlyBadge.tsx:40` | "Watchtower's write actions become available again for {label}." | "Write actions become available again for {label}." (name adds nothing). |
| `utils/guardrails.ts:17` | `READ_ONLY_REASON` "Read-only mode (Watchtower guardrail). Turn off in cluster settings." | **Two issues.** "Watchtower guardrail" reads as the app's brand adjective; with a short name it is fine ("Read-only mode (<NEWNAME> guardrail)"); with a long one use "Read-only mode (guardrail)". And "cluster settings" is not a real UI label (the control is the Read-only chip / ContextSwitcher). Suggest "Read-only mode is on. Turn it off from the Read-only chip in the top bar." Update the test `guardrails.test.ts:82` with it. |
| `utils/guardrails.ts:26,31` | `readOnlyBadgePopover` / `readOnlyRefusal` | Same pair of edits. Line 26: "It disables Watchtower's write actions" → "It disables the app's write actions". |
| `DiffRows.tsx:41`, `diffRows.ts:8,323` | "For reading only. Watchtower writes the whole array." | Name is load-bearing (the tool, not the user, writes). Keep. Fine with any name. Do not use "the app writes" (ambiguous). |
| `JournalPage.tsx:131` | "Records what Watchtower sent, not what the cluster did afterwards." | Keep (contrast with the cluster). |
| `LogViewBar.tsx:170` | title "Downloads what Watchtower has loaded, not the full log." | "Downloads what the app has loaded, not the full log." |
| `MultiLogViewer.tsx:147` | "Watchtower couldn't read this label." | "Couldn't read this label." |
| `NodeDrainDialog.tsx:226` | "You can still drain. Watchtower only asks the API server to evict pods, and PodDisruptionBudgets are enforced…" | Keep: contrast with kubectl is the point. |
| `SettingsView.tsx:79` | "Controls how much detail Watchtower writes to its log file." | "…detail the app writes to its log file." |
| `SettingsView.tsx:121` | "Logs stay on this machine. Watchtower never uploads logs." | Keep the name: a privacy promise should name the product. |
| `SettingsView.tsx:226` | "…It applies until you close Watchtower." | Keep. "until you close the app" is equal; use the name. |
| `YamlSaveGate.tsx:206` | "…will be dropped because Watchtower's schema does not know it." | Keep; reads right with any name. |
| `health/ProblemsPage.tsx:154` | "Fixed rules over fields and events Watchtower can read. There is no score or grade." | "…events the app can read." Keep "no score or grade" (copy rule). |
| `utils/constraints.ts:113`, `.test.ts:90` | "May apply. Uses label expressions, which Watchtower doesn't evaluate." | "…which the app doesn't evaluate." Keep "May apply". |
| `utils/kubectlEquiv.ts:32,34,40,42` | footnotes: "Watchtower calls the Kubernetes API directly…", "Watchtower stops and reports them", "Watchtower reads the source…", "Watchtower upgrades from the chart…" | Contrast with kubectl: **keep the name** in all four (the sentence is "kubectl does X, <NEWNAME> does Y"). |
| `utils/secretReveal.ts:5` | `"<redacted by Watchtower>"` | Plan already moves it to `"<redacted>"`; check the new neutral value is what the Values tab shows. |
| Comments (`useActiveContext.ts`, `useResources.ts`, `types/k8s.ts`, `clusterIdentity.ts`, `HelmUpgradeGate.tsx`, `YamlSaveGate.tsx`) | internal | Not user-facing; "the app". |
| New (RB-3b notice) | none | Name-free by design (Part 1). |
| Window title, `index.html` `<title>` | `tauri.conf.json`, `index.html` | `<NEWNAME>` alone, no tagline; `index.html` currently says "Kube View" (old). |

Also add at G-NAME: README "formerly Watchtower" line (Q-N3; the one place the old name is allowed in UI-adjacent copy) and the pronunciation note (RB-6 deliverable). Lanthorn pronunciation note: "LAN-tern or LANT-horn; both are heard." State it once in README, not in the app.

### 2.3 Sidebar brand fit

Measured from `Sidebar.tsx`: `<aside className="w-[280px]">` fixed; brand row `pl-4 pr-3 gap-2`, a `flex-1` spacer, icon 22 px, name `text-[16px] font-semibold tracking-tight`, version `mono 12px` (`v2.0.0`, about 43 px). Window `minWidth` is 1024, so the sidebar never narrows; the 1024 limit does not matter, the **280 px** does.

Budget: 280 - 28 (padding) - 22 (icon) - 43 (version) - 3 gaps x 8 = 163 px for the name; at 16 px semibold ~ 9 px per capital-heavy char gives **about 18 characters**. All four shortlist names (7 to 9 chars: Lanthorn 8, Plimsoll 8, Taffrail 8, Keelson 7) fit with 70+ px spare. Ask frontend to add `min-w-0 truncate` and `title={PRODUCT_NAME}` to the name span anyway, so a future long name never pushes the version off. Also check: ligatures/descenders at 16 px for `ll`/`rr` (Plimsoll, Taffrail) look fine at that weight; check `Lanthorn` in the drag region (double-click maximises; unaffected).

### 2.4 Review with "Garita" (2026-10-09, final): copy fixes for the frontend

Checked against the tree after `PRODUCT_NAME = "Garita"`. Garita is 6 characters, ends in a vowel (possessive `Garita's` fine), takes no article ("Garita", never "the Garita"), and is not an English word, so no sentence misreads. Sidebar fit: 6 chars of about 18 available; no change needed (the `truncate` and `title` are already there). The 20+ other strings pass unchanged; only the lines below change. Line numbers are from the tree at review time; match on the quoted text if they drift.

| File:line | Current | New |
|---|---|---|
| `src/components/ContextSwitcher.tsx:228` | `Copy: kubectl config use-context (sets your kubectl default — ${PRODUCT_NAME} no longer does this for you)` | `Copy: kubectl config use-context (sets your kubectl default; ${PRODUCT_NAME} doesn't change it)` |
| `src/components/ContextSwitcher.tsx:272` | `Remove from ${PRODUCT_NAME} — does not delete the file` | `Remove from ${PRODUCT_NAME}. Does not delete the file.` |
| `src/utils/guardrails.ts:27` | `Read-only mode (${PRODUCT_NAME} guardrail) is on for ${cluster}. It disables ${PRODUCT_NAME}'s write actions. It doesn't affect kubectl or other tools.` | `Read-only mode (${PRODUCT_NAME} guardrail) is on for ${cluster}. It disables the app's write actions. It doesn't affect kubectl or other tools.` |
| `src/components/ReadOnlyBadge.tsx:41` | `${PRODUCT_NAME}'s write actions become available again for ${identity.label \|\| context}.` | `Write actions become available again for ${identity.label \|\| context}.` |
| `src/components/ContextSwitcher.tsx:124` | `Disables {PRODUCT_NAME}'s write actions on this cluster. A guardrail, not a security boundary: kubectl and other tools aren't affected. …` | `Disables the app's write actions on this cluster. A guardrail, not a security boundary: kubectl and other tools aren't affected. …` (rest of the sentence unchanged) |

Why: the first two drop a v1.2-era history note and an em dash; the other three stop the name repeating inside one sentence or panel (the Read-only chip popover already carries `Garita guardrail`). Update `guardrails.test.ts` for `readOnlyRefusal`/`readOnlyBadgePopover` if it asserts line 27's text.

**Keep as is (checked):** `DiffRows` header, `JournalPage`, `LogViewBar` download title, `MultiLogViewer`, `NodeDrainDialog`, `SettingsView` (3), `YamlSaveGate`, `ProblemsPage`, `constraints`, the four `kubectlEquiv` footnotes, `guardrails.ts:18,32`.

**Allow-list in the RB-2 grep:** `src/utils/secretReveal.ts:7` `LEGACY_HELM_REDACTION_SENTINEL = "<redacted by Watchtower>"` (it exists only to be refused), plus the matching Rust constant and tests.

**Pronunciation and meaning.** Yes, state it, once each, no more:
- README intro: `Garita (gah-REE-tah) is the Spanish word for a fortress sentry box.` Then the Q-N3 line `Formerly Watchtower.`
- Landing hero, small `--mute` text under the buttons (not in the h1): `Garita (gah-REE-tah): the lookout turret on a fortress wall.`
- Not in the app UI: the sidebar and dialogs have no room, and users who see the name daily learn it from the README.

---

## Part 3. Landing page (`public/index.html`) redesign spec

### 3.1 Critique of the current page (28 KB, 0 `<script>`, dark only)

1. **Dark only** (`color-scheme:dark`); the app has had a light theme since v1.4.2. Fails users with light OS setting and printing.
2. **Hero sells the mechanism, not the job.** "talks to the API, not to kubectl" is a design fact; an on-call engineer wants "see and fix what is wrong, safely". Tech-stack line ("Tauri v2 · React 18…") is noise above the fold.
3. **Download is a table of four files** with a hard-coded macOS button; Linux users must hunt. No OS detection, so the primary action is wrong for half the visitors.
4. **Download is GitLab package-registry links with a `{{VERSION}}` substitution step**, which moves to `releases/latest/download/` (no substitution; kills the stale-link trap noted in the README checklist).
5. **Homebrew is "Team members only"** (private tap). Needs to become the public form or be dropped (§3.4).
6. Good and worth keeping: skip link, `:focus-visible`, a "what it deliberately does not do" section, honest platform limits, "macOS will block the first launch" note. 
7. Feature list is long (grouped Safety/Editing/Observability + 43 kinds) with no hierarchy or visuals; zero screenshots.

### 3.2 Constraints

Single static `public/index.html`; no build step; no frameworks, trackers, analytics or external requests (no Google Fonts, no CDN: system font stack). Inline CSS. One inline `<script>` (about 15 lines) only for OS-detected download; the page must be fully usable with JS off. Light and dark via `prefers-color-scheme` (no toggle; keep it simple). Placeholders for `<NEWNAME>` and logo (`logo.svg`, inline-able; until RB-5 lands use a text `[logo]` box with `alt=""`). Target: under 40 KB total, no web fonts, images `loading="lazy"` with `width`/`height` set (no layout shift).

### 3.3 Tokens

Reuse the app's role names as CSS variables. Dark (current page values, which match the app) and light (from `src/index.css` `[data-theme="light"]`):

| Var | Dark | Light |
|---|---|---|
| `--base` | `#0b0d12` | `#f1f3f8` |
| `--panel` | `#12151d` | `#f8f9fc` |
| `--card` | `#1a1e29` | `#ffffff` |
| `--ink` | `#e6e9ef` | `#0f172a` |
| `--mute` | `#8a93a6` | `#566176` |
| `--accent` | `#4ea1ff` | `#1758b1` |
| `--on-accent` | `#0b0d12` | `#ffffff` |
| `--edge` | `rgba(255,255,255,.08)` | `rgba(15,23,42,.08)` |
| `--edge2` | `rgba(255,255,255,.14)` | `rgba(15,23,42,.14)` |
| `--ok` | `#34d399` | `#036748` |

Do not use `dim` for text. Contrast (checked on the app's own pairs): `mute` on `base` 6:1 in both themes; `accent` on `base` 7:1 dark, 6.8:1 light; `on-accent` on `accent` over 4.5:1 in both. Declare `color-scheme: light dark`. Links underlined in running text. Focus: `outline:2px solid var(--accent); outline-offset:3px` (keep). Respect `prefers-reduced-motion` (no animation is the default; do not add any). Body line-height 1.65, max line length 65ch, content width 70rem (as today).

### 3.4 Information architecture (top to bottom)

```
[skip link]
HEADER (sticky)   [logo] <NEWNAME>  v?           Features  Safety  Install  GitHub
HERO
  h1  One-line pitch
  p   Lede (2 lines max)
  [ Download for <your OS> ]  [ View on GitHub ]     small: "macOS Apple Silicon . Linux x86_64 . Apache-2.0"
  [ screenshot placeholder, 16:10, dark/light via <picture> ]
FEATURES (6 cards, 3x2 at >=900px, 1 col <600px)
SAFETY (the differentiator: 2 columns text + "does not do" list)
INSTALL (tabs-free: three <details>, macOS open by default if detected)
OPEN SOURCE (Apache-2.0, GitHub, issues, security advisories)
FOOTER
```

**Header.** Logo 26 px, name, no version (version is on the Releases page; dropping it removes the stale-version problem). Nav 4 links, wraps to a second row under 560 px (no hamburger; no JS).

**Hero.**
- h1: `Browse, debug and change Kubernetes clusters without leaving one window.` (grounded: 43 resource kinds, logs, shell, YAML editing, Helm, ArgoCD, per README/CHANGELOG).
- Lede: `<NEWNAME> is a desktop client that talks to the Kubernetes API directly. No kubectl binary needed, and your kubeconfig is never rewritten.` (README: "no kubectl binary dependency", "Your kubeconfig is read-only"). 
- Primary button (OS-detected, §3.5). Secondary ghost button: `View on GitHub`.
- Small meta line under buttons: `macOS (Apple Silicon) and Linux (x86_64). Free and open source under Apache-2.0.` Windows: add `Windows: build from source` as a link to the Install section (README: no Windows build published).
- Screenshot placeholder: `<picture>` with two `<source media="(prefers-color-scheme: dark|light)">` + `<img src="shot-1-dark.png" alt="[describe the real screenshot when it exists]" width="1280" height="800">`. Until screenshots exist render a bordered `--card` box with the text `Screenshot: pod list with logs panel open` (a real `<div role="img" aria-label="…">`), never a fake UI mockup.

**Features** (6 cards, each `h3` + 1 sentence; all verified in CHANGELOG/README; do not add others):

| Card | Sentence |
|---|---|
| 43 resource kinds | `Workloads, networking, config, RBAC and cluster objects, plus every installed CRD, Helm release, ArgoCD Application and Flux resource.` |
| Pods, logs and shells | `Stream and filter logs across pods, open a shell in a container, attach a debug container, and read CPU and memory from metrics-server.` |
| Edit with a preview | `Change YAML or Helm values and see a server-side dry run and a diff before anything is written.` (README/ui: PREVIEW-GATE) |
| Health at a glance | `Problems, capacity, deprecated APIs and possibly unused objects, from fixed rules. No scores or grades.` |
| Who can do what | `Ask which subjects can do a verb on a resource, and see what a service account's bindings grant.` (v1.4.1) |
| Journal | `A local record of every change the app sent, per cluster. Secret values are never recorded.` (v1.4.1) |

If the engineer cannot verify a card against CHANGELOG/README at build time, drop it; five true cards beat six padded ones.

**Safety section** (h2 `Built to avoid surprises`), left column prose, right column "What it does not do":

Left (3 short items, `ok`-coloured bullets are not used; plain list with an `Eye` or check inline SVG at `--mute`):
- `Read-only mode per cluster. Turns off the app's write actions; every write shows a confirm.` Add: `It is a guardrail in the app, not a security boundary.` (house rule: never "protected").
- `Colour and label per cluster, so production looks like production.`
- `Secret values stay hidden until you click Reveal, and are never shown in diffs or previews.` (v1.4.1)

Right ("What it deliberately does not do", reuse the existing `#not-do` list content; read it and keep its true items, trimmed to 5 lines).

No claims of "secure", "safe", "protected", "auto-fix", "smart".

**Install.** Three `<details class="card">`, `summary` min height 44 px:
1. macOS (Apple Silicon): download the `.dmg`, drag to Applications. `The app is ad-hoc signed, not notarized, so macOS blocks the first launch. Run once:` then `<pre><code>sudo xattr -rd com.apple.quarantine /Applications/<NEWNAME>.app</code></pre>` with a Copy button (JS enhancement; without JS the pre is still selectable). Keep it exactly as the README does (with `sudo`).
2. Linux: three links (`.deb` Debian/Ubuntu, `.rpm` Fedora/RHEL, `.AppImage` any), each a row with filename in `<code>`.
3. Windows: `No Windows build is published. Build it from source:` link to README Development section.
4. Homebrew line **TBD** (see open question): if public tap exists, show `brew install --cask KANOMNUT/<newname>/<newname>` in a `<pre>` under macOS; otherwise omit the line entirely (no "team only" text).
5. `Verify downloads` one-liner linking to SECURITY.md (`gh attestation verify`), since the release workflow produces attestations and an SBOM.

**Open source.** h2 `Open source`. One paragraph: `<NEWNAME> is licensed under Apache-2.0. Report bugs, read the code and send patches on GitHub.` Three links: Source, Issues, Security advisories (new advisory URL from `.github/ISSUE_TEMPLATE/config.yml`).

**Footer.** `Copyright 2026 the <NEWNAME> contributors · Apache-2.0` plus `Not affiliated with the Kubernetes project or the CNCF. Kubernetes is a trademark of The Linux Foundation.` (small, `--mute`). Optional line `Formerly Watchtower` is **not** added (Q-N3 puts it in README only).

### 3.5 OS-detected download

HTML has all four download links visible by default (JS off = complete). Inline script (progressive enhancement, no libraries, no storage, no network):

```
primary = <a id="dl" href=".../releases/latest/download/<NEWNAME>-macOS-arm64.dmg">Download for macOS (Apple Silicon)</a>   // default markup
JS: ua = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent
  mac   -> keep dmg (default)
  linux -> label "Download for Linux (.AppImage)", href AppImage; show a small line "Debian/Ubuntu: .deb . Fedora/RHEL: .rpm" with both links
  windows/other -> label "Install from source", href "#install"; add line "No Windows build is published."
```

States:

| State | Behaviour |
|---|---|
| JS off | Default macOS button + the Install section lists every file. No broken state. |
| Intel Mac | Cannot be detected reliably (UA says "MacIntel" on Apple Silicon too). Always put under the button: `Apple Silicon only. Intel Macs: build from source.` |
| Mobile | Hide the primary download; show `Desktop app. Open this page on a computer.` and keep the GitHub link. |
| Link 404 (no release yet) | Cannot detect; accept. The Releases link beside it is the fallback. |

Link form: `https://github.com/KANOMNUT/<newname>/releases/latest/download/<file>` with files `<NEWNAME>-macOS-arm64.dmg`, `<NEWNAME>-linux-amd64.deb`, `.rpm`, `.AppImage`. These names are case-sensitive and must equal the release assets; the engineer verifies against `.github/workflows/release.yml` (RB-7), because `latest/download` serves the file name exactly.

### 3.6 Responsive and accessibility

- Breakpoints: 1 column below 640 px; features 2 columns from 640; 3 from 960. 16 px side gutter minimum (`clamp(1rem,4vw,2rem)` as today). No horizontal page scroll; `pre` scrolls internally.
- Touch/click targets 44 px min for buttons and `summary`.
- One `h1`; sections are `h2`; cards `h3`. Landmarks: `header`, `nav aria-label="Sections"`, `main`, `footer`.
- Images have real alt text; decorative logo `alt=""`. Colour is never the only signal.
- The copy button announces `Copied` via a visually hidden `role="status"` span; if clipboard fails, select the text.
- Title: `<NEWNAME>: Kubernetes desktop client`. Meta description one sentence matching the lede. `<link rel="icon" href="logo.svg" type="image/svg+xml">` with a PNG fallback.
- Publishing mechanism (GitHub Pages job vs deleting the page) is Q-H3, a product decision; this spec assumes (a).

---

## Part 4. Logo brief (superseded by C2, name = Garita)

Directions A, B, C (beacon, nodes, viewfinder) were rejected by the user. Chosen style: **minimal, one colour, relates to the name**. Round C2 is a garita (fortress sentry box): a domed turret silhouette with a lookout slit or lit window, one ink on a rounded-square body. Files: `docs/ux/logo/garita-{1,2,3}.svg` (app icon, 1024 viewBox, Big Sur body 824 at (100,100), rx 185, offset-shape shadow), `garita-{1,2,3}-mark.svg` (body-less, `currentColor`, true evenodd holes, for the sidebar and landing page), `preview.html`.

| Variant | Ink on body | Idea |
|---|---|---|
| 1 | amber `#fbbf24` on graphite `#1f2937` | Domed turret with flared cornice, one slit, sitting on a wall bar. Reads as "turret on a wall". |
| 2 | white on blue `#1758b1` | Round dome over a stepped (inverted-pyramid) corbel, one lit round window. Most abstract. |
| 3 | ink `#0f172a` on pale `#f8f9fc` | Same turret, no wall, arched lit window. Inverse (dark mark on light body). |

32 px render check (`npx tauri icon`, scratchpad only): V1 reads as a turret on a ledge, slit visible; V2 reads as a dome with a hole, the corbel steps are lost (weakest); V3 reads as a turret with a keyhole-like arch, mark is small in its body. `tauri icon` emits no 16 px; check 16 px in `preview.html`.

Constraints kept from Part 4 above: no hexagon, no three-arm shape, no circle-in-polygon, no helm wheel; avoid El Morro tourism marks (no sea, no flag, no stone texture). Recommended: **Variant 1**.

---

### 4.4 Final: Variant 3 refined (user pick)

Files: `docs/ux/logo/garita-final.svg` (app icon master, Big Sur grid) and `garita-final-mark.svg` (body-less, `currentColor`, for sidebar, favicon, landing page). Variants 1 and 2 and the first-round files are deleted.

Changes versus V3:
- Mark scaled 1.25x: turret is 525 px tall on the 824 px body (64%), bbox centred on the body centre.
- Lit window: arched, wider (100 x 110 vs 64 x 70) and filled amber `#fbbf24` in the app icon, so it reads as a window rather than a keyhole. In the mark it is a true hole (single ink).
- Dark Dock: body stays pale `#f8f9fc` (high contrast on dark); a 8 px inner edge in ink at 22% holds the shape on a light tile, plus two offset-shape shadows (no filters).

Render check (`npx tauri icon`, scratchpad only; `src-tauri/icons` untouched): at 128 px the dome, cornice, corbel and amber arch window read clearly. At 32 px the turret silhouette holds and the amber window is visible. At 16 px (`-p 16` works) the dark turret reads; the window is a faint light spot, so at favicon size use the mark, which has a hole and no body.

## Open questions

1. **Q-H3 (user):** keep and update `public/index.html` with a GitHub Pages job (Part 3 assumes yes), or delete it and let README + Releases be the landing page? Part 3 is wasted if the answer is delete.
2. **Homebrew:** is there a public tap (`KANOMNUT/homebrew-<newname>`) at v2.0.0 launch? If not, the page omits Homebrew entirely.
3. **Notice persistence (tech-lead/user):** Part 1 asks that the notice survive a restart until dismissed (one extra `localStorage` flag). If the plan wants strictly "shown once", say so; the cost is a user who closes the app before reading it never learns why every cluster is read-only.
