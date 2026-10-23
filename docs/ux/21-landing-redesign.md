# 21. Landing page redesign (`site/index.html`)

Status: spec for L1 (frontend-engineer). Branch `feat/landing-redesign`. Author: senior-ux-specialist, 2026-10-23. Baseline: v2.3.0 page of 12.8 KB.

Decisions already taken by the user: style is a mix of modern product (Linear/Vercel), "match the app" (tokens, cluster chips, panels, map motif) and terminal flavour (mono accents, real CLI). Hero visual is a stylised HTML/CSS/SVG illustration, not a screenshot. Theme follows the system, light and dark, both AA.

Frozen constraints (ledger): one static self-contained file; no external fonts, scripts, images or trackers; the set of unique `https://github.com/KANOMNUT/garita/releases/latest/download/…` URLs is exactly the 5 assets (`pages.yml:73-74`); Scoop line `scoop install https://kanomnut.github.io/garita/scoop/garita.json`; Homebrew lines `brew tap KANOMNUT/garita https://github.com/KANOMNUT/garita` and `brew install --cask kanomnut/garita/garita`; the macOS `xattr` note stays next to the macOS download; works with JS off; reduced motion; 44 px targets.

## 1. Goals and audience

Audience: DevOps and platform engineers who are deciding whether to try a Kubernetes desktop client. They know the terms. They distrust anything that touches their kubeconfig or phones home. They decide in under a minute.

The one action: **download for my OS**. Everything else answers one of three doubts, in this order: "what is it" (hero + illustration), "what can it do that I lack" (highlights), "can I trust it near production" (safety).

Success looks like: the primary button is visible without scrolling at 360 px and 1280 px; a visitor sees the product shape in the hero without reading; every other action (GitHub, install commands) is one scroll away.

## 2. Information architecture

| # | Section | Purpose | Notes |
|---|---|---|---|
| 0 | Skip link, sticky header | Orientation, `Download` shortcut | Brand, 3 anchors, GitHub. |
| 1 | Hero (`#top`) | What it is, the one action, the product shape | h1, lede, platform-aware primary button, platform links, one-line OS note, illustration. |
| 2 | Highlights (`#features`) | Proof it does real work: 6 cards plus an "also" chip row | Bento grid; one wide card (Map), one terminal card (CLI). |
| 3 | Safety (`#safety`) | Trust near production | Three guardrail cards and the "does not do" panel. |
| 4 | Install (`#install`) | Per-OS files and commands | `details` per OS, copy buttons, requirements line, SECURITY.md link. |
| 5 | Open source (`#open`) | Licence, repo links, the name | Short. Merged visually with the footer band. |
| 6 | Footer | Copyright, trademark line | Unchanged text. |

Cut from today, and why:

- **Dashed screenshot placeholder** (`.shot`). Replaced by the illustration. A placeholder box reads as unfinished.
- **"43 resource kinds" card title.** The number equals the `ResourceType` union in `src/types/k8s.ts` (43 members, including `crd-instances`), but the README groups kinds differently and the union is an implementation detail. A count a reader can recount differently invites doubt. Dropped; the card is now claim-free about counts (Section 3). If the user wants a number, it needs a counted, documented source first.
- **Separate "Who can do what" and "Journal" cards.** Kept as chips in the "Also included" row. Six cards is the most a bento grid carries before it becomes a list again.
- **`#dl-linux` hide/show trick.** Replaced by a platform-links row that is always visible, so no-JS visitors on Linux or Windows see their file in the hero.
- **"Apple Silicon only. Intel Macs: build from source" pointing at `#install`.** Install had no such text. The link now goes to the README Development section.
- **Pronunciation line in the hero.** Moved to the Open source section, beside the logo. The hero keeps one eyebrow chip instead.
- **No theme toggle, no web fonts, no scroll-reveal JS, no social image.** A social image would be a second file or an external one (breaks "one self-contained file"). Open question 2.

## 3. Copy

All final. Sentence case. Copy rules apply: hints "may apply", no "smart/auto-fix", read-only mode is "a guardrail", never "protected" or "secured".

### Header
Brand `Garita`. Nav: `Features`, `Safety`, `Install`, `GitHub` (external, `https://github.com/KANOMNUT/garita`). Nav `aria-label="Sections"`.

### Hero
- Eyebrow chip: `Free and open source · Apache-2.0`
- h1: `Browse, debug and change Kubernetes clusters without leaving one window.` The last three words, "one window", carry the gradient (section 4).
- Lede: `Garita is a desktop client that talks to the Kubernetes API directly. No kubectl binary needed, and your kubeconfig is never rewritten.`
- Primary button (JS picks by platform; no-JS default is macOS): `Download for macOS (Apple Silicon)` / `Download for Linux (.deb)` / `Download for Windows (.exe)`.
- Secondary button: `View on GitHub`.
- Platform links row, label `All downloads:` then `macOS`, `Linux .deb`, `Linux .rpm`, `Windows .exe`, `Windows .msi`. Always visible. Each link is a 44 px target (padding, not just text).
- OS note under the row, one `<p id="dl-note">`. Default (no JS): `macOS builds are not notarized: on first launch run xattr -rd com.apple.quarantine /Applications/Garita.app. Windows installers are unsigned, so SmartScreen will warn.` The `xattr` command is in a `<code>`. With JS the note shows only the line for the detected OS:
  - macOS: `Apple Silicon only. Not notarized: on first launch run xattr -rd com.apple.quarantine /Applications/Garita.app (the Homebrew cask does this for you). Intel Mac? Build from source.` ("Build from source" links to `https://github.com/KANOMNUT/garita#development`.)
  - Linux: `x86_64. The garita command is on your PATH after installing.`
  - Windows: `x86_64. Unsigned: SmartScreen will warn. Choose More info, then Run anyway.`
- Mobile note (viewport at most 640 px, visible above the buttons): `Garita is a desktop app. Open this page on a computer to install it.` Buttons stay, so someone can still send themselves a link.
- Illustration caption, under the window, 12 px mute: `Illustration, not a screenshot. Names are made up.`

### Highlights (`#features`)
- h2: `From alert to fix, in one window.`
- Lede: `Everything you would otherwise switch between a terminal, a log tailer and a YAML editor to do.`

Cards (h3 + body):

1. **See how it connects** (wide, 2 columns at 960 px and up). `Open a namespace as a graph: owners, Service and Ingress routes, volumes and environment references. Lines run at right angles between the boxes; dashed and dotted lines, not colour, tell the relations apart.` Mono tag in the corner: `Health → Map`.
2. **Logs, shells, debug containers.** `Stream and filter logs across up to 20 pods of a workload. Open a shell in a container, or attach a debug container to an image that has none.`
3. **Edit with a preview.** `Change YAML or Helm values and see a server-side dry run and a diff before anything is written. Edits are JSON merge patches, so fields the form does not model are left alone.`
4. **History from your own monitoring.** `Point a cluster at its Prometheus and Loki or VictoriaLogs services. Garita reads them only through the API server's service proxy: metric charts up to 7 days, log history, and right-sizing hints from the 24 h 95th percentile when the data allows.`
5. **Health at a glance.** `Problems, node capacity, deprecated APIs and possibly unused objects, from fixed rules with the evidence shown. No scores or grades.`
6. **Open it from your shell** (terminal card, mono block): `Jump straight to a context, namespace and kind.` then the snippet `garita --context staging -n web po` with a copy button, and the caption `po, deploy, svc and other kubectl short names work. garita --help lists them.`

"Also included" row (chips, not links): `Helm`, `ArgoCD`, `Flux`, `Who can…`, `Action journal`, `Network policies (approximation)`, `⌘K palette`. Label before it: `Also included:`.

### Safety (`#safety`)
- h2: `Built to avoid surprises`
- Card A, with a live cluster chip pair (`production` red, `staging` green, as illustration): **A colour and label per cluster.** `So production looks like production. The identity shows in the sidebar, the top bar and every destructive confirmation.`
- Card B: **Read-only mode.** `Turns off the app's write actions for a cluster, and every write shows a confirmation. It is a guardrail in the app, not a security boundary.`
- Card C: **Secrets stay hidden.** `Secret values stay hidden until you click Reveal, and are never shown in diffs or previews.`
- Panel (solid, not glass): h3 `What it deliberately does not do`. List: `No kubectl binary dependency.` / `Never writes to your kubeconfig.` / `No server-side apply; edits are JSON merge patches.` / `No node shell, no privileged pods.` / `No in-cluster agent.` / `No AI, telemetry, analytics or crash upload.` Then: `Garita checks GitHub once a day for a new version and never sends cluster data. You can turn the check off in Settings.`

### Install (`#install`)
- h2: `Install`
- Requirements line (small): `Needs a current system webview: macOS 13.3 or later, Ubuntu 22.04 or later, Fedora/RHEL with current webkit2gtk, Windows 10 or later.`
- `details` **macOS (Apple Silicon)**, open by default on macOS and unknown platforms: `Download Garita-macOS-arm64.dmg and drag it to Applications. The app is ad-hoc signed, not notarized, so macOS blocks the first launch. Run once:` then `xattr -rd com.apple.quarantine /Applications/Garita.app`. `Or with Homebrew (the cask does this for you):` then the two brew lines as one copy block (tap line, install line).
- `details` **Linux (x86_64)**: `Debian/Ubuntu:` link `Garita-linux-amd64.deb`; `Fedora/RHEL:` link `Garita-linux-amd64.rpm`; `The garita command is on your PATH after installing.`
- `details` **Windows (x86_64)**: `Download Garita-windows-amd64-setup.exe (per user) or Garita-windows-amd64.msi (all users).` `Unsigned: Windows SmartScreen will warn. Choose "More info", then "Run anyway".` `After installing, open a new terminal window to use the garita command.` `Or with Scoop:` then `scoop install https://kanomnut.github.io/garita/scoop/garita.json`.
- After the details: `Then, in any terminal:` `garita --help`. And `Verify downloads: see SECURITY.md.` (link kept).

### Open source (`#open`)
- h2: `Open source`
- `Garita is licensed under Apache-2.0. Report bugs, read the code and send patches on GitHub.`
- Links: `Source` · `Issues` · `Security advisories` (unchanged URLs).
- Name note beside the logo (mute): `Garita (gah-REE-tah) is the Spanish word for a fortress sentry box.`

### Footer
`Copyright 2026 the Garita contributors · Apache-2.0 · GitHub` and `Not affiliated with the Kubernetes project or the CNCF. Kubernetes is a trademark of The Linux Foundation.` Unchanged.

### Meta
`<title>Garita: Kubernetes desktop client</title>` (unchanged). Description unchanged: `Garita is a desktop client that talks to the Kubernetes API directly. No kubectl binary needed, and your kubeconfig is never rewritten.`

### Fact sources

| Claim in copy | Source |
|---|---|
| Talks to the API directly, no kubectl binary | `README.md` l.5, l.121; `CLAUDE.md` Architecture |
| Kubeconfig never written | `README.md` l.7, l.122; `docs/claude/cluster-access.md` |
| Apache-2.0, free and open source | `README.md` License; `LICENSE` |
| Map: owners, selectors, Ingress/HTTPRoute backends, volumes, env references; line style not colour; right-angle lines between boxes | `CHANGELOG.md` 2.2.0 "Map", 2.3.0 "Map lines and labels" |
| Network policies, with "(approximation)" | `CHANGELOG.md` 2.2.0 "Network policies (approximation)" |
| Logs across up to 20 pods | `README.md` l.87 (Pods and logs) |
| Shell, debug containers for images without a shell | `README.md` l.88 |
| Server-side dry-run and diff before YAML Save and Helm upgrade | `README.md` l.96-97; `CLAUDE.md` PREVIEW-GATE |
| Edits are JSON merge patches; unmodelled fields untouched | `README.md` l.96, l.123; `CLAUDE.md` Guided edit |
| Prometheus, Loki, VictoriaLogs only through the service proxy; charts to 7 d; log history | `CHANGELOG.md` 2.3.0 Added (Observability, Metric history, Log history) |
| Right-sizing hint from the 24 h 95th percentile "when the data allows" | `CHANGELOG.md` 2.3.0 ("at least 18 of the last 24 hours"); `docs/claude/health.md` (hints) |
| Problems, capacity, deprecated APIs, possibly unused; fixed rules, no scores | `README.md` l.105-110; `CLAUDE.md` Health rule |
| Helm, ArgoCD, Flux | `README.md` l.65, l.112-115 |
| Who can… | `CHANGELOG.md` 1.4.1 "Who can…" |
| Action journal (local, no Secret data) | `docs/claude/diagnostics.md` l.21 ("Write payloads are never logged"; journal summary only); today's site text |
| ⌘K palette | `README.md` l.78 |
| `garita --context <ctx> -n <ns> <kind>`, `po`, `--help` | `docs/claude/launcher.md` Grammar; `README.md` l.45 |
| Command on PATH after Linux package install | `launcher.md` Per-OS install, `README.md` l.47 |
| Cluster colour and label in sidebar chip, top bar and every destructive confirmation | `README.md` l.72; `docs/claude/ui.md` Cluster identity surfaces |
| Read-only mode turns off write controls; confirmations; "guardrail, not a security boundary" | `README.md` l.103; `ui.md`; `CLAUDE.md` `invokeWrite` ("a hint, not a security boundary") |
| Secret values hidden until Reveal, never in diffs/previews | `CLAUDE.md` Secret rule; `docs/claude/writes.md` |
| Does-not-do list incl. no in-cluster agent | `README.md` l.117-130 |
| GitHub update check, once a day, no cluster data, can be turned off | `README.md` l.126; `CHANGELOG.md` 2.1.0 |
| Requirements: macOS 13.3+, Ubuntu 22.04+, Windows 10+ | `README.md` l.22; `CHANGELOG.md` 2.1.3 |
| Windows installers unsigned, SmartScreen; new terminal for `garita` | `README.md` l.24; `launcher.md` Windows build facts |
| macOS ad-hoc signed, not notarized, `xattr` command; the cask does it | `README.md` l.39-43; `CLAUDE.md` Build |
| Scoop and Homebrew command text | `README.md` l.26-35; `docs/homebrew-tap-setup.md` |
| "Garita" = fortress sentry box, gah-REE-tah | `README.md` l.3 |
| Platform and architecture: macOS arm64, Linux and Windows x86_64 | `README.md` l.20 |

The one claim that needs the author's eye: "Action journal" appears only as a chip name, no behaviour claimed beyond today's page.

## 4. Visual system

The page keeps its own small variable set (it is a separate file, not Tailwind), named after the app's role names so a reader can map them. Channel triplets (`--accent-rgb`) allow `rgb(var(--accent-rgb) / .1)` the same way the app does, which avoids `color-mix()` fallbacks.

### Tokens

| Site var | App role (`src/index.css`) | Dark | Light |
|---|---|---|---|
| `--base` | surface-base | `#0b0d12` | `#f1f3f8` |
| `--panel` | surface-panel | `#12151d` | `#f8f9fc` |
| `--card` | surface-card | `#1a1e29` | `#ffffff` |
| `--sunken` | surface-sunken (code blocks, log strip) | `#070a10` | `#e9edf4` |
| `--ink` | ink | `#e6e9ef` | `#0f172a` |
| `--mute` | mute | `#8a93a6` | `#566176` |
| `--accent` / `--accent-rgb` | accent (blue) | `#4ea1ff` / `78 161 255` | `#1758b1` / `23 88 177` |
| `--on-accent` | on-accent | `#0b0d12` | `#ffffff` |
| `--edge` | edge | `rgb(255 255 255 / .08)` | `rgb(15 23 42 / .08)` |
| `--edge2` | edge-strong | `rgb(255 255 255 / .14)` | `rgb(15 23 42 / .14)` |
| `--ok` | status-ok / identity-green | `#34d399` | `#036748` |
| `--warn` | status-warn | `#fbbf24` | `#705600` |
| `--bad` | status-bad / identity-red | `#f87171` | `#ad0017` |
| `--purple` / `--purple-rgb` | status-purple | `#a78bfa` / `167 139 250` | `#6d33d1` / `109 51 209` |
| `--term-fg` | term-fg (code text) | `#c9d1d9` | `#1f2937` |

Values are the app's own except two deliberate deviations: `--on-accent` in dark is `#0b0d12`, not the app's white (white on `#4ea1ff` is about 2.3:1; the site must pass), and edges are `.08/.14` as on today's page (app: `.06/.10`). `dim` is not used: it fails AA as text. Do not use `--dim` anywhere. Theme: `@media (prefers-color-scheme: dark)` on `:root`, `<meta name="color-scheme" content="light dark">`. No toggle (the user chose "follow the system").

### Contrast (computed, WCAG relative luminance)

| Pair | Dark | Light | Need |
|---|---|---|---|
| ink on base | 15.98 | 16.08 | 4.5 |
| ink on card | 13.69 | 17.85 | 4.5 |
| mute on base | 6.30 | 5.62 | 4.5 |
| mute on panel | 5.91 | 5.92 | 4.5 |
| mute on card | 5.39 | 6.24 | 4.5 |
| mute on sunken | 6.42 | 5.31 | 4.5 |
| accent (links, focus ring) on base | 7.28 | 6.17 | 4.5 text / 3 ring |
| accent on card | 6.23 | 6.85 | 4.5 |
| accent on panel | 6.84 | 6.50 | 4.5 |
| on-accent on accent (primary button) | 7.28 | 6.85 | 4.5 |
| term-fg on sunken (code) | 12.84 | 12.50 | 4.5 |
| ok / warn / bad / purple / orange text on its own 12 % tint over card (chips) | 6.84 / 7.76 / 5.06 / 5.05 / 6.00 | 5.76 / 5.83 / 5.97 / 5.72 / 5.77 | 4.5 |
| ink on base under 10 % accent glow | 14.09 | 13.92 | 4.5 |
| mute on base under 10 % accent glow | 5.55 | 4.86 | 4.5 |

Rule that keeps the glow honest: **no text sits on a glow stronger than 10 % accent** (at 20 % light mute drops to 4.15 and fails). The purple glow is at most 6 % and is placed beside the headline, not under body text.

Edges (`--edge`, `--edge2`) measure 1.3 to 1.5:1 against the base. They are decoration only: no control is identified by its border alone (every button has a text label, every card has a heading). Do not use `--edge` for anything a user must see to operate the page. Focus ring is `--accent`, 2 px, offset 3 px (6.17 to 7.28:1).

Identity chips in the illustration reuse `--bad` (production, red) and `--ok` (staging, green): chip recipe `background: rgb(var(--c-rgb) / .10); box-shadow: 0 0 0 1px rgb(var(--c-rgb) / .30); color: var(--c)`. Add `--ok-rgb` and `--bad-rgb` channel triplets (dark `52 211 153` / `248 113 113`, light `3 103 72` / `173 0 23`).

### Type scale

System UI only: `font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

| Role | Size | Line | Weight | Notes |
|---|---|---|---|---|
| h1 | `clamp(2.25rem, 1.4rem + 4.2vw, 4rem)` | 1.08 | 700 | letter-spacing `-0.03em`, `max-width: 18ch`, `text-wrap: balance` |
| h2 | `clamp(1.6rem, 1.2rem + 1.6vw, 2.25rem)` | 1.15 | 650 | `-0.02em` |
| h3 | `1.05rem` | 1.3 | 600 | |
| Lede | `clamp(1.05rem, 1rem + .4vw, 1.25rem)` | 1.55 | 400 | `max-width: 60ch`, ink at full |
| Body | `1rem` | 1.6 | 400 | |
| Small / caption | `.875rem` | 1.5 | 400 | `--mute` |
| Mono (code, chips, tags) | `.875em` of context, min 13 px | 1.5 | 500 | |
| Illustration text | 11 to 12 px | 1.4 | mono | decorative, `aria-hidden` |

### Spacing, radius, layout

4 px base: 4, 8, 12, 16, 24, 32, 48, 64, 96. `.wrap` max 72 rem, side gutter `clamp(1rem, 4vw, 2rem)`. Section vertical padding `clamp(3rem, 8vw, 6rem)`. Grid gaps 16 px (24 px at 960 and up). Card padding 20 to 24 px. Radius: 8 px buttons and code, 12 px cards, 16 px hero window, 6 px chips (same as the app chip). Tap targets at least 44 px (buttons, nav links, platform links, `summary`, copy buttons).

### Glow and gradient recipe

Hero background, behind content (`z-index: -1`, container `position: relative; isolation: isolate; overflow: clip`):

```
radial-gradient(60% 55% at 50% 0%, rgb(var(--accent-rgb) / .10), transparent 70%),
radial-gradient(35% 40% at 88% 8%, rgb(var(--purple-rgb) / .06), transparent 70%)
```

Headline accent: `.grad { background: linear-gradient(90deg, var(--ink), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent }` with the fallback `color: var(--accent)` declared first and the gradient inside `@supports (background-clip: text)`. Both ends pass 4.5:1 on base. A faint 1 px hairline grid is not used (bytes without a job).

### Glass card recipe

```
.glass{
  background: var(--card);                         /* solid fallback, passes AA */
  border: 1px solid var(--edge);
  border-radius: 12px;
  box-shadow: 0 1px 0 rgb(255 255 255 / .05) inset, 0 12px 32px -16px rgb(0 0 0 / .6);  /* dark */
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){
  .glass{ background: rgb(var(--card-rgb) / .72); -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2) }
}
```

Light shadow: `0 1px 0 rgb(255 255 255 / .8) inset, 0 8px 24px -12px rgb(15 23 42 / .18)`. Card rgb: dark `26 30 41`, light `255 255 255` (add `--card-rgb`). Glass is used for the header, highlight cards, safety cards and the window chrome. The "does not do" panel, `pre` and `details` bodies are solid (`--card` / `--sunken`), because they hold the most text. Card hover (pointer only, `@media (hover:hover)`): border `--edge2`, `translateY(-2px)`, 150 ms.

### Buttons

Primary: `--accent` fill, `--on-accent` text, 44 px min height, 20 px side padding, radius 8, weight 600; hover adds `box-shadow: 0 0 0 4px rgb(var(--accent-rgb) / .18)`. Secondary: glass fill, `--edge2` border, ink text. Both: visible focus ring (above), no outline removal.

### Motion

| What | Duration | Easing | Detail |
|---|---|---|---|
| Hero text + window entrance | 500 ms, window delayed 120 ms | `cubic-bezier(.2,.7,.2,1)` | opacity 0 to 1, `translateY(12px)` to 0; CSS only, runs once on load |
| Card and button hover | 150 ms | ease-out | border, shadow, `translateY(-2px)` (cards) or `-1px` (buttons) |
| Copy button label change | instant | none | text swap, no animation |
| Log caret in the illustration | 1.6 s blink, `animation-iteration-count: 3` | ease-in-out | ends after about 5 s (WCAG 2.2.2: nothing auto-plays longer than 5 s without a pause) |
| `details` open | none | none | native |
| Smooth scroll | native | none | `html{scroll-behavior:smooth}` |

Cut on purpose: scroll-reveal (needs JS or `animation-timeline`, bytes without payoff), parallax, an animated gradient, a flowing dashed edge on the map (infinite animation would need a pause control). `@media (prefers-reduced-motion: reduce)`: remove the entrance (final state at once), the hover `transform`, the caret blink and smooth scroll; colour and border changes on hover stay, since they are not motion.

## 5. Hero illustration

A mini "Garita window", clearly drawn: flat tokens, mono text, no real data. Built from HTML + CSS (so text scales and wraps like page text) with one small inline SVG for the map.

Accessible name: the container is `<div class="win" role="img" aria-label="Illustration of the Garita window">`; every child is `aria-hidden="true"`; nothing inside is focusable or a link. Caption below (Section 3) is a normal `<p>` and says it is an illustration.

Size: `width: min(100%, 960px)`, centred, `margin-top: 48px`. At 960 px the body is about 400 px tall. Radius 16, glass fill, `--edge2` border, big soft shadow. It sits over the hero glow, so the glow reads as light behind a window.

### Composition (960 px)

```
+--------------------------------------------------------------------------+
| o o o        [ production ]  Pods · web                          Read-only |  title bar 36 px
+------------+-------------------------------------------+-----------------+
| [production]| NAME               STATUS          RESTART AGE | [ map card 320 ]|
|  red rule   | web-7d9f4-x2k4   . Running            0   2d  |                 |
| staging     | web-7d9f4-m8q1   . Running            0   2d  | [Ingress]->[Svc]|
|             | web-7d9f4-r5t7   ! CrashLoopBackOff   6  14m  |   ->[Pod x3]    |
| NAMESPACES  | worker-5c6b8-k3p9 ~ Pending           0   3m  | [CM]->[Deploy]  |
|  default    +-------------------------------------------+                 |
|  web  <-    | Logs · web-7d9f4-r5t7                      |                 |
|  data       | 12:04:11 INFO  listening on :8080          |                 |
| Pods <-     | 12:04:13 WARN  upstream timeout, retry 2/5 |                 |
| Deployments | 12:04:15 ERROR readiness probe failed  _   |                 |
| Services    |                                           |                 |
+-------------+-------------------------------------------+-----------------+
  188 px        flex                                         320 px
```

Zones and tokens:

- **Title bar** (36 px, `--panel`, bottom `--edge`): three 10 px dots in `--edge2` (not traffic-light colours, so no OS is implied). Centre-left: cluster chip `production` in `--bad` recipe with a 3 px left rule in `--bad` (the app's TopBar left rule). Breadcrumb `Pods · web` in `--mute` mono 12 px. Right: a `Read-only` chip in `--mute` neutral recipe (shows the guardrail exists).
- **Sidebar** (188 px, `--panel`, right `--edge`): active-context chip `production` (red recipe, 3 px left rule); beneath, a row `staging` with a 8 px `--ok` swatch. Group label `NAMESPACES` (10 px, `--mute`, tracking .08em); items `default`, `web` (active: `rgb(var(--accent-rgb)/.12)` fill, accent text), `data`. Then nav items `Pods` (active), `Deployments`, `Services`. Neutral names only.
- **Table** (`--card`): header row mono 11 px `--mute` uppercase; 4 rows at 32 px, zebra none, row hover none (static). Row 3 selected (`rgb(var(--accent-rgb)/.10)`). Status cell = 6 px dot + word, colour `--ok` / `--bad` / `--warn`; the word always present (colour is never the only signal). Names: `web-7d9f4-x2k4`, `web-7d9f4-m8q1`, `web-7d9f4-r5t7`, `worker-5c6b8-k3p9`.
- **Logs strip** (under the table, `--sunken`, mono 12 px, 3 lines, header `Logs · web-7d9f4-r5t7` in `--mute`): level words `INFO` (`--mute`), `WARN` (`--warn`), `ERROR` (`--bad`); a 7 px caret block after the last line blinks three times (Section 4 Motion).
- **Map card** (320 px, `--panel`, left `--edge`, header `Map · web` mono 11 px mute). SVG `viewBox="0 0 320 170"`, `width: 100%`, `height: auto`. Boxes 84 x 34, radius 6, fill `--card`, stroke `--edge2`; two text lines (kind in `--mute` 9 px, name in `--ink` 11 px mono):

```
 x=8          x=118         x=228
 [Ingress ]--[Service ]---[Pod x3  ]    y=18..52
 [ web    ]  [ web     ]  [ web    ]
                          +-- (tracks at x=210/215)
 [ConfigMap]..[Deployment]-+            y=100..134
 [ web-env ]  [ web     ]
```

Edges (stroke `--mute`, width 1.5, no arrowheads on the page, `fill: none`): Ingress to Service `M92 35 H118` (solid); Service to Pod `M202 28 H228` (solid); Deployment to Pod, a real elbow on its own track `M202 117 H215 V42 H228` (solid); ConfigMap to Deployment `M92 117 H118` (dotted, `stroke-dasharray: 1 4`, round cap, "env reference"); one dashed edge is optional and may be dropped to save bytes. Lines never cross a box. No edge labels (the app shows them on hover only; the illustration is static).

Box names are made up: `web`, `web-env`. No status words on the map boxes (illustration only).

### Responsive behaviour

| Width | Window |
|---|---|
| 960 and up | Full: sidebar, table + logs, map column. |
| 640 to 959 | Sidebar hidden; map moves under the table + logs, full width of the window (SVG scales; text stays at least 10 px). |
| Under 640 | Title bar keeps the chip and breadcrumb (breadcrumb truncated with ellipsis, Read-only chip hidden); table shows NAME and STATUS only (3 rows); logs strip shows 2 lines, no wrap, `overflow: hidden`; map card below at 100 % width (the SVG's 320 units fit a 328 px column at about 1:1). Window `margin-top: 32px`. |

Implementation: CSS grid with `grid-template-columns` changed at the two breakpoints, `display: none` on hidden parts. No JS. The illustration markup is at most 8 KB.

## 6. Terminal touches

Real commands only, each verifiable above:

| Where | Snippet | Source |
|---|---|---|
| Highlights card 6 | `garita --context staging -n web po` | `launcher.md` Grammar (`po` is a kubectl short name in the kind table) |
| Install, macOS | `xattr -rd com.apple.quarantine /Applications/Garita.app` | `README.md` l.41-43 |
| Install, macOS | `brew tap KANOMNUT/garita https://github.com/KANOMNUT/garita` / `brew install --cask kanomnut/garita/garita` (one block, two lines, one copy button copies both lines) | `README.md` l.33-34 |
| Install, Windows | `scoop install https://kanomnut.github.io/garita/scoop/garita.json` | `README.md` l.27 |
| Install, after the OS details | `garita --help` | `launcher.md` |

Style of a snippet: `<pre>` on `--sunken`, `--term-fg` text, radius 8, a dim `$ ` prompt in `--mute` that is **CSS-generated** (`pre code::before{content:"$ "; user-select:none}`) so copy and selection never include it. A one-line top-left tab is not used. The hero has no snippet: the one action there is the download.

Copy buttons (progressive enhancement). Without JS: a plain, selectable `<pre>`. With JS, a script inserts into each `pre[data-copy]` a `<button type="button" class="copy">Copy</button>` at the top right of the block:

- 44 x 44 hit area (the visual label is small; padding fills it), `aria-label="Copy <what>"` e.g. `Copy Homebrew install commands`, visible focus ring, reachable by Tab right after the block's text.
- On click: `navigator.clipboard.writeText(text)`. On success, button text becomes `Copied` for 2 s and a single page-level `<p class="sr-only" role="status" aria-live="polite" id="live">` receives `Copied to clipboard`. On failure (insecure context, denied): the block's text is selected with `getSelection` and the live region says `Copy failed. Text is selected, press Ctrl+C.` (use `⌘C` text on macOS only if cheap; otherwise keep `Ctrl+C or ⌘C`).
- If `navigator.clipboard` is missing at load, do not add buttons.
- The live region is cleared after 2 s so a repeat press announces again.

## 7. Responsive layout

Breakpoints: 640 and 960 px. Single column below 640; two columns 640 to 959; three at 960.

360 px:

```
+----------------------+
| [T] Garita           |  header, not sticky below 640
| Features Safety      |
| Install  GitHub      |  4 links, 44 px tall, wrap in 2 rows
+----------------------+
| (Free & open source) |
| Browse, debug and    |
| change Kubernetes    |
| clusters without     |
| leaving one window.  |
| lede ...             |
| Desktop app. Open    |
| this page on a       |
| computer.            |
| [Download for macOS] |  full width, 44 px+
| [  View on GitHub  ] |
| All downloads:       |
|  macOS  Linux .deb   |
|  Linux .rpm  ...     |
| note (xattr ...)     |
| +- window ---------+ |
| |[production] Pods | |
| | NAME     STATUS  | |
| | rows x3          | |
| | logs x2          | |
| | [map 320]        | |
| +------------------+ |
| illustration caption |
+----------------------+
 Highlights: 1 column
 Safety: cards stacked, then the panel
 Install: details stacked
```

768 px:

```
+--------------------------------------------+
| [T] Garita              Features Safety .. |  header sticky from 640 up
|   chip                                     |
|   h1 (2 lines)                             |
|   lede                                     |
|   [Download for X] [View on GitHub]        |
|   All downloads: ... (one line)            |
|  +--------------------------------------+  |
|  | title bar                            |  |
|  | table + logs                         |  |
|  | map (full width)                     |  |
|  +--------------------------------------+  |
| Highlights: 2 columns (Map card spans 2)   |
| Safety: cards A and B in a row, C below    |
| Install: details                            |
+--------------------------------------------+
```

1280 px (wrap 1152 px):

```
+--------------------------------------------------------------+
| [T] Garita                    Features Safety Install GitHub |
|                 (Free and open source . Apache-2.0)          |
|        Browse, debug and change Kubernetes clusters          |
|             without leaving one window.      (centred)       |
|                    lede (60ch)                               |
|            [Download for macOS]  [View on GitHub]            |
|        All downloads: macOS  Linux .deb  ... note            |
|     +------------------------------------------------+       |
|     | window 960: sidebar | table+logs | map          |       |
|     +------------------------------------------------+       |
| Highlights: [ Map (wide) ......... ][ Logs      ]            |
|             [ Edit   ][ History   ][ Health ][ CLI ]         |
|             Also included: chips                             |
| Safety: [A][B][C]   then panel "does not do" full width       |
| Install: details x3 (max 48rem), copy buttons                |
| Open source + footer                                          |
+--------------------------------------------------------------+
```

Hero text is centred at 640 px and up; left aligned below 640 for reading comfort. Highlights grid: 1 / 2 / 3 columns with the Map card spanning 2 at 640 and up (3-column grid at 960: Map spans 2 and Logs 1, then 4 cards fill the next row with CLI spanning the last two slots of its row; the implementer may reorder to avoid a hole). Header goes sticky and glass from 640 px; below that it is static so it does not take about 100 px of a small screen. `scroll-margin-top: 72px` on section anchors when sticky.

## 8. Accessibility and performance

Accessibility checklist (WCAG 2.1 AA):

- `lang="en"`, one `h1`, `h2` per section, `h3` per card; no skipped levels.
- Skip link first in the DOM, visible on focus, targets `#main`.
- Landmarks: `header`, `nav aria-label="Sections"`, `main#main`, `footer`.
- All text pairs meet Section 4 ratios in both themes; no text on a glow above 10 %; no `--dim` text.
- Link text is never colour only: body links stay underlined. Nav links are plain but are in a labelled nav.
- Focus: every interactive element has the 2 px accent ring (6.17 to 7.28:1), offset 3; none removed. Tab order equals DOM order: skip, brand, nav, hero buttons, platform links, then sections; the illustration is skipped (no focusable children).
- Targets at least 44 x 44: nav links, buttons, platform links, `summary`, copy buttons, GitHub links in the footer row (use padding).
- Status words, not colour alone, in the illustration table, logs and map (kind word on every box). Chips carry their label.
- Illustration: `role="img"` with `aria-label="Illustration of the Garita window"`, all children `aria-hidden="true"`, no decorative text read out.
- Copy buttons labelled, with a polite live region; failure is announced.
- `prefers-reduced-motion` honoured (Section 4); no animation longer than 5 s; no flashing.
- Reflow: no horizontal scroll at 320 px; `pre` scrolls inside its own box (`overflow:auto`, `tabindex="0"` so keyboard users can scroll it, with `aria-label`), text resizes to 200 % without loss.
- No JS needed for any content; JS only picks the primary button, swaps the OS note and adds copy buttons.
- `details`/`summary` native: keyboard and screen reader behaviour for free; the open state set by JS for the detected OS.
- Forced colours (Windows high contrast): borders must not vanish; add `@media (forced-colors: active){ .glass,.btn,pre{ border:1px solid CanvasText } }`.

Performance budget (the page is the only request):

| Item | Budget |
|---|---|
| Single file, raw | at most 40 KB (today 12.8 KB); target 30 KB |
| Gzip over the wire | at most 12 KB |
| CSS | at most 14 KB; JS at most 2.5 KB inline; illustration markup at most 8 KB |
| Requests | 1 (the document). No fonts, images, scripts, analytics. Favicon stays an inline data URI. |
| Layout | no layout shift: window and SVG sized by `aspect-ratio`/`viewBox` |
| LCP | the h1 text, no image dependency |

## 9. Acceptance checklist

Checkable by reading `site/index.html`:

1. One file; no `<link href=http…>`, `<script src>`, `<img>`, `@import`, `url(http…)`, web fonts or trackers. Only the inline favicon data URI and inline SVG.
2. `grep -o 'https://github.com/KANOMNUT/garita/releases/latest/download/[^"]*' site/index.html | sort -u` returns exactly: `Garita-linux-amd64.deb`, `Garita-linux-amd64.rpm`, `Garita-macOS-arm64.dmg`, `Garita-windows-amd64-setup.exe`, `Garita-windows-amd64.msi` (5 lines). The Scoop line and both Homebrew lines match the frozen text.
3. The `xattr -rd com.apple.quarantine /Applications/Garita.app` command appears in the hero note and in Install, next to the macOS dmg link.
4. No "43" and no unsourced number; every claim in Section 3's table is present only as written there. Banned words absent: "smart", "auto-fix", "protected", "secured", "score(s)" except in "No scores or grades", "Apply" for a write (use "Merge" if a write is ever named).
5. With JS removed the page still reads fully: macOS primary button, all five file links visible, notes present, no empty buttons.
6. `:root` defines every token in Section 4 for light, and the dark set inside `@media (prefers-color-scheme: dark)`; `<meta name="color-scheme" content="light dark">` present; no hex used outside the `:root` blocks except in the favicon.
7. `--dim` is not used anywhere. No text colour other than `--ink`, `--mute`, `--accent`, `--on-accent`, `--term-fg` and the status tokens in chips.
8. Every glass surface has a solid fallback and the `@supports` guard; text-heavy panels (does-not-do, `pre`, `details`) are solid.
9. Glow gradients use alpha at most .10 (accent) and .06 (purple).
10. `@media (prefers-reduced-motion: reduce)` disables the entrance, hover transforms, caret blink and smooth scroll. No `infinite` animation exists (`grep infinite` is empty); the caret uses `animation-iteration-count: 3`.
11. Illustration: container has `role="img"` and `aria-label="Illustration of the Garita window"`; all descendants are inside `aria-hidden="true"`; none is focusable; the caption `Illustration, not a screenshot. Names are made up.` is present.
12. The map SVG has only `M`/`H`/`V` path commands (right angles), no edge passes through a box, and the elbow runs at x=210 to 215 between columns.
13. Illustration text uses only the neutral names `production`, `staging`, `web`, `worker`, `default`, `data`, and the pod names in Section 5. No company, cluster or product name.
14. Every `button`, `a`, `summary` has `min-height: 44px` (or padding that yields it); `:focus-visible` rule uses `--accent`; no `outline: none` without a replacement.
15. Heading outline: one `h1`; `h2` for `Highlights`, `Safety`, `Install`, `Open source`; no skipped level.
16. Skip link is the first focusable element and targets `#main`.
17. Copy buttons exist only after JS inserts them; each has an `aria-label`; one `role="status"` live region exists; the `$ ` prompt is CSS-generated, not in the DOM text.
18. Breakpoints at 640 and 960 px; the sidebar of the illustration is hidden under 960 px; the table shows two columns under 640 px.
19. File size within budget (Section 8): `wc -c site/index.html` at most 40000; `gzip -c site/index.html | wc -c` at most 12000.
20. Copy: h1, lede, button labels, section headings and the six card titles equal Section 3 exactly.
21. Platform links row has the five links, each with a visible label of Section 3.
22. `pages.yml` checks still pass (run the same assertions locally).

Needs the user's eyes (cannot be proven by reading the HTML):

- A. Overall feel: is it "modern product" without being generic; does the glow read as light, not as a smudge, in both themes.
- B. Does the illustration look like the app (chips, rows, the map) and clearly like an illustration, not a screenshot or fake data.
- C. Light theme: no wash-out; glass cards still have enough edge on `#f1f3f8`; the primary button reads as primary.
- D. Rendering in Safari and Firefox: `backdrop-filter`, `background-clip: text`, `text-wrap: balance` fall back cleanly.
- E. Real devices: 360 px phone layout, tap targets, no horizontal scroll; Windows high-contrast mode.
- F. Screen reader pass (VoiceOver or NVDA): the illustration is announced once with its name and nothing else; copy announces "Copied".
- G. Motion at normal and reduced settings, including that nothing feels slow on load.
- H. Copy tone: the h2 `From alert to fix, in one window.` and the safety wording.

## Open questions for the user

1. Keep the h1 (`Browse, debug and change Kubernetes clusters without leaving one window.`) or reword it? It is grounded and unchanged from the rebrand; the redesign only adds the gradient on "one window".
2. A social preview image (`og:image`) needs a second file or an external URL, which breaks the one-self-contained-file rule. Skip it, or relax the rule for one PNG?
3. Is it fine to drop the "43 resource kinds" number, or should the project add a counted, documented figure first?
