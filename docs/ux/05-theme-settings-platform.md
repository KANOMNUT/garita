# UX 05: Theme, Settings sections and platform

Status: **v1.4.2 theme sections (1 to 8) are the freeze gate. Sections 9 onward (v1.5.x platform, backlog low-fi) do not gate it.**
Sources: `docs/ux/00-overview.md` §6 and §7.1, `docs/ux-task-briefs.md` UX-05, `docs/impl/v1.4.2-tasks.md` (brief wins on disagreement), `tailwind.config.js`, `src/index.css`.
Role names are fixed by 00 §6.1 and brief §2.1/§2.3. This file supplies values. The only new names are in §1.3, each with a reason.
Ratios are WCAG 2.1 relative-luminance contrast, computed, not estimated. Overlays are modelled as solid colours; tints are alpha-blended over the stated surface.

## 0. Summary for the freeze

1. **Dark = today, verbatim.** Every dark value below is read from `tailwind.config.js`, `src/index.css`, `ShellTerminal.tsx` or the component literals. Where today's value fails AA, it is **kept** and listed in §5 with a fix that is off by default.
2. **Light** keeps the same hue families as dark, darker. Identity, status and diff colours share one light value per hue so there is a single fit to verify.
3. **Accent never touches identity, status, bars, metrics, log, diff, series or terminal ANSI.**
4. **Brief corrections** (§8): edge roles need an alpha companion; the colour-literal grep misses hundreds of Tailwind-palette sites; `bg-accent text-white` fails today.
5. **Decisions needed** (§5, default = leave dark as is): D1 to D6.

## 1. Light value of every role

### 1.1 Storage rules

- Channels are space-separated RGB (`--c-<role>: 18 21 29`). Hex below is for reading.
- **Alpha-baked roles** (`edge`, `edge-strong`, `log-match`, `log-highlight`, `term-selection`) carry a companion `--a-<role>`. Everything else is channels only; the alpha stays at the use site (`bg-surface-tint/[0.03]`).
- `focus-ring` holds the accent channels (`--c-focus-ring: var(--c-accent)`), alpha 0.70 baked, both themes.
- Hex in the "Dark" column is today's value. "Dark source" names where it was read.

### 1.2 Role table

| Role | Dark | Light | Dark source / note |
|---|---|---|---|
| `surface-base` | #0b0d12 | #f1f3f8 | `base` |
| `surface-panel` | #12151d | #f8f9fc | `panel` |
| `surface-card` | #1a1e29 | #ffffff | `card`. Light cards rely on `edge` ring, not fill |
| `surface-overlay` | #1f2937 | #ffffff | gray-800; sites keep `/95` |
| `surface-input` | #111827 | #f1f3f8 | gray-900; sites keep `/80`; also `bg-black/20` textarea (§3) |
| `surface-sunken` | #070a10 | #e9edf4 | `surface-sunken`: log pane, terminal, YAML view |
| `surface-tint` | 255 255 255 | 15 23 42 | white tints; alpha at site (0.02 to 0.10 today) |
| `scrim` | 0 0 0 | 15 23 42 | black at 40/50/60 at site |
| `edge` | 255 255 255, a 0.06 | 15 23 42, a 0.08 | rgba(255,255,255,.06) |
| `edge-strong` | 255 255 255, a 0.10 | 15 23 42, a 0.14 | `edge2` |
| `ink` | #e6e9ef | #0f172a | |
| `mute` | #8a93a6 | #566176 | |
| `dim` | #5b6377 | #7a8397 | glyph/disabled only; fails as text in both themes (use `mute`) |
| `status-ok` | #34d399 | #036748 | `ok` |
| `status-warn` | #fbbf24 | #705600 | `warn` |
| `status-bad` | #f87171 | #ad0017 | `bad` |
| `status-info` | #60a5fa | #1f52c3 | `info` |
| `status-progress` | #4ea1ff | #1758b1 | today's accent value; **fixed, does not follow the accent** |
| `accent` | #4ea1ff (blue) | #1758b1 (blue) | runtime, see §4 |
| `focus-ring` | accent, a 0.70 | accent, a 0.70 | see D5 |
| `identity-blue` | #4ea1ff | #1758b1 | `accent` |
| `identity-green` | #34d399 | #036748 | `ok` |
| `identity-yellow` | #fbbf24 | #705600 | `warn`. **Known risk, fixed here**, §2.3 |
| `identity-orange` | #fb923c | #993d00 | `orange` |
| `identity-red` | #f87171 | #ad0017 | `bad` |
| `identity-purple` | #a78bfa | #6d33d1 | `purple` |
| `identity-demo` | #22d3ee | #055a68 | reserved, not selectable (#45); provisional |
| `banner-impersonation` | #f0abfc | #86198f | no today value (#34 not shipped); provisional |
| `diff-add` / `diff-remove` / `diff-change` | = `status-ok` / `status-bad` / `status-warn` | same | DiffRows `ROLE` map |
| `log-error` | #f87171 | #ad0017 | `text-bad` |
| `log-fatal` | #f87171 | #ad0017 | FATAL folds into ERROR today; same value |
| `log-warn` | #fbbf24 | #705600 | |
| `log-info` | #60a5fa | #1f52c3 | INFO word |
| `log-debug` | #5b6377 | #5f6b80 | `text-dim` today (fails, §5) |
| `log-match` | 78 161 255, a 0.28 | 84 133 212, a 1.00 | tailwind config |
| `log-highlight` | 251 191 36, a 0.38 | 170 127 19, a 1.00 | always paired with underline |
| `bar-low` / `bar-mid` / `bar-high` | #60a5fa / #fbbf24 / #f87171 | #397fef / #a87900 / #ea4843 | thresholds unchanged |
| `series-1` to `series-6` | #f472b6 #a3e635 #22d3ee #d946ef #2dd4bf #cbd5e1 | #cb106e #52760a #0b7489 #b210cb #0a7669 #5c6b7f | |

### 1.3 Proposed new roles (explicit; none introduced silently)

| Proposed role | Dark | Light | Reason |
|---|---|---|---|
| `on-accent` | #ffffff | #ffffff | Text on a solid accent or `status-bad` fill (`bg-accent text-white` in 4 primary buttons, `bg-bad/80 text-white` count badge, terminal cursor accent). A role is needed so D1 can fix it in one value. |
| `metric-cpu` / `metric-mem` | #4ea1ff / #a78bfa | #2b82ee / #9767e9 | CPU and memory strokes and low-bar fills (NodeStrip, PodTable, DetailPanel, ResourceDetailPanel, Sparkline). `bar-low` (#60a5fa) is a different value, so parity forbids reusing it, and `accent` is forbidden (Q42-2). |
| `status-orange` / `status-purple` | #fb923c / #a78bfa | #993d00 / #6d33d1 | Legacy `orange` and `purple` tokens used as non-identity status: ImagePullBackOff, Terminating, diff "replaced". Reusing `identity-*` would couple status to identity. Same light values as the identity roles. |
| `term-fg`, `term-cursor-accent`, `term-selection` (alpha-baked), `term-black`, `term-red`, `term-green`, `term-yellow`, `term-blue`, `term-magenta`, `term-cyan`, `term-white`, `term-bright-black`, `term-bright-red`, `term-bright-green`, `term-bright-yellow`, `term-bright-blue`, `term-bright-magenta`, `term-bright-cyan`, `term-bright-white` | §2.9 | §2.9 | 00 §6.3 defers "a terminal-specific role set" to UX-05 without names. Background = `surface-sunken`, cursor = `accent`. |

Not proposed (decided without a new role): the `html, body` background (`#06080c`) maps to `surface-base`, §3.

### 1.4 Non-role literals that stay in `index.css` / `tailwind.config.js`

These are not components, so the allow-list in brief §2.4 holds. Both themes defined there.

| Item | Dark (today) | Light |
|---|---|---|
| `::-webkit-scrollbar-thumb` / hover | white a 0.08 / 0.14 | ink-channel a 0.22 / 0.34 (still under 3:1, as dark is; see §5 row 9) |
| `.grain` glows | accent a 0.06 at 20% 0%, `status-purple` a 0.05 at 100% 0% | accent a 0.05, `status-purple` a 0.04 |
| `.row-hover` / `.row-selected` / `.row-bar` | accent a 0.04 / 0.08 / solid | same alphas, accent channel |
| `shadow-hairline` | inset 0 1px white a 0.04 | inset 0 1px white a 0.70 |
| `shadow-window` | 0 30px 80px -20px black a 0.7, ring white a 0.05 | 0 30px 80px -20px ink-channel a 0.25, ring ink-channel a 0.08 |

## 2. Contrast

Targets: 4.5 text, 3.0 UI and non-text. "FAIL" rows in Dark are today's values (see §5); Light has no failures.

### 2.1 Tables

Diff rows (+, -, ~, replaced) use the status values, so the "diff row 6%" column of the status table is the diff-row result. Glyph and word are always shown with the colour.

#### Dark

**Text roles on surfaces** (min 4.5; `dim` is a glyph/disabled role, 3.0 applies)

| Role | base | panel | card | sunken | overlay |
|---|---|---|---|---|---|
| `ink` #e6e9ef | 15.98 | 15.00 | 13.69 | 16.29 | 12.07 |
| `mute` #8a93a6 | 6.30 | 5.91 | 5.39 | 6.42 | 4.76 |
| `dim` #5b6377 (as text) | 3.24 (not text) | 3.04 (not text) | 2.77 (not text) | 3.30 (not text) | 2.44 (not text) |
| `dim` #5b6377 (as glyph, 3.0) | 3.24 | 3.04 | **2.77 FAIL** | 3.30 | **2.44 FAIL** |

**Identity chips**: role colour as text on its own 20% fill, over the surface the chip sits on (Sidebar = panel, TopBar = base). ClusterBadge label: role text over `surface-tint` 3% on `overlay` (confirm dialogs).

| Identity role | value | on panel | on base | ClusterBadge on overlay | dot vs panel (3.0) |
|---|---|---|---|---|---|
| `identity-blue` | #4ea1ff | 4.94 | 5.38 | 5.05 | 6.84 |
| `identity-green` | #34d399 | 6.35 | 6.94 | 7.02 | 9.49 |
| `identity-yellow` | #fbbf24 | 7.03 | 7.69 | 8.08 | 10.93 |
| `identity-orange` | #fb923c | 5.66 | 6.17 | 5.96 | 8.06 |
| `identity-red` | #f87171 | 4.91 | 5.33 | 4.88 | 6.60 |
| `identity-purple` | #a78bfa | 4.83 | 5.32 | 4.96 | 6.71 |

**Status pills and rows**: role text on its own tint over the surface. Pill = 10% (`bg-X/10`), toggle = 20% (`bg-X/20`), diff/banner row = 6%.

| Role | value | text on panel | pill 10% panel / card / overlay | toggle 20% panel | diff row 6% panel / overlay |
|---|---|---|---|---|---|
| `status-ok` | #34d399 | 9.49 | 7.99 / 7.16 / 6.26 | 6.35 | 8.66 / 6.82 |
| `status-warn` | #fbbf24 | 10.93 | 9.05 / 8.10 / 7.11 | 7.03 | 9.87 / 7.78 |
| `status-orange` | #fb923c | 8.06 | 6.90 / 6.20 / 5.46 | 5.66 | 7.38 / 5.91 |
| `status-bad` | #f87171 | 6.60 | 5.81 / 5.25 / 4.62 | 4.91 | 6.12 / 4.92 |
| `status-info` | #60a5fa | 7.18 | 6.20 / 5.53 / 4.88 | 5.10 | 6.58 / 5.24 |
| `status-progress` | #4ea1ff | 6.84 | 5.92 / 5.34 / 4.67 | 4.94 | 6.32 / 5.00 |
| `status-purple` | #a78bfa | 6.71 | 5.80 / 5.22 / 4.57 | 4.83 | 6.19 / 4.90 |

**Log pane (`surface-sunken`)**

| Item | value | ratio | need |
|---|---|---|---|
| ERROR word / line (`log-error`) | #f87171 | 7.16 | 4.5 |
| WARN (`log-warn`) | #fbbf24 | 11.87 | 4.5 |
| INFO word (`log-info`) | #60a5fa | 7.79 | 4.5 |
| DEBUG line (`log-debug`) | #5b6377 | **3.30 FAIL** | 4.5 |
| plain line (`ink` at 85%) | - | 11.82 | 4.5 |

**Bars and metric strokes** (non-text, 3.0) against the track (`surface-tint` 6% over card) and the card.

| Role | value | vs track | vs card |
|---|---|---|---|
| `bar-low` | #60a5fa | 5.49 | 6.55 |
| `bar-mid` | #fbbf24 | 8.37 | 9.97 |
| `bar-high` | #f87171 | 5.05 | 6.02 |
| `metric-cpu` | #4ea1ff | 5.23 | 6.23 |
| `metric-mem` | #a78bfa | 5.13 | 6.12 |

**Pod-tag series** (text on `surface-sunken`, 4.5)

| Role | value | ratio |
|---|---|---|
| `series-1` | #f472b6 | 7.48 |
| `series-2` | #a3e635 | 13.14 |
| `series-3` | #22d3ee | 10.96 |
| `series-4` | #d946ef | 5.73 |
| `series-5` | #2dd4bf | 10.64 |
| `series-6` | #cbd5e1 | 13.34 |

**Accent set** (link/tab text: 4.5 on base, panel, card; tab/button tint `accent/20`: 4.5; solid fill label: 4.5; focus ring at 70%: 3.0)

| Accent | value | link on base / panel / card | text on accent/20 (panel) | label white (parity) on fill | label #0b0d12 (fix D1) | ring 70% on base / overlay |
|---|---|---|---|---|---|---|
| blue | #4ea1ff | 7.28 / 6.84 / 6.23 | 4.94 | **2.67 FAIL** | 7.28 | 4.09 / 3.45 |
| teal | #2dd4bf | 10.44 / 9.80 / 8.94 | 6.52 | **1.86 FAIL** | 10.44 | 5.49 / 4.64 |
| violet | #b197fc | 8.05 / 7.56 / 6.90 | 5.30 | **2.41 FAIL** | 8.05 | 4.45 / 3.75 |
| amber | #f59e0b | 9.05 / 8.50 / 7.75 | 5.93 | **2.15 FAIL** | 9.05 | 4.89 / 4.06 |
| rose | #f472b6 | 7.34 / 6.89 / 6.28 | 5.02 | **2.65 FAIL** | 7.34 | 4.08 / 3.41 |
| slate | #b8c7da | 11.31 / 10.62 / 9.69 | 6.76 | **1.72 FAIL** | 11.31 | 5.93 / 4.99 |

#### Light

**Text roles on surfaces** (min 4.5; `dim` is a glyph/disabled role, 3.0 applies)

| Role | base | panel | card | sunken | overlay |
|---|---|---|---|---|---|
| `ink` #0f172a | 16.08 | 16.96 | 17.85 | 15.20 | 17.85 |
| `mute` #566176 | 5.62 | 5.92 | 6.24 | 5.31 | 6.24 |
| `dim` #7a8397 (as text) | 3.43 (not text) | 3.61 (not text) | 3.80 (not text) | 3.24 (not text) | 3.80 (not text) |
| `dim` #7a8397 (as glyph, 3.0) | 3.43 | 3.61 | 3.80 | 3.24 | 3.80 |

**Identity chips**: role colour as text on its own 20% fill, over the surface the chip sits on (Sidebar = panel, TopBar = base). ClusterBadge label: role text over `surface-tint` 3% on `overlay` (confirm dialogs).

| Identity role | value | on panel | on base | ClusterBadge on overlay | dot vs panel (3.0) |
|---|---|---|---|---|---|
| `identity-blue` | #1758b1 | 4.79 | 4.56 | 6.45 | 6.50 |
| `identity-green` | #036748 | 4.83 | 4.59 | 6.51 | 6.57 |
| `identity-yellow` | #705600 | 4.88 | 4.68 | 6.55 | 6.60 |
| `identity-orange` | #993d00 | 4.80 | 4.59 | 6.55 | 6.60 |
| `identity-red` | #ad0017 | 4.85 | 4.61 | 7.09 | 7.15 |
| `identity-purple` | #6d33d1 | 4.75 | 4.56 | 6.50 | 6.55 |

**Status pills and rows**: role text on its own tint over the surface. Pill = 10% (`bg-X/10`), toggle = 20% (`bg-X/20`), diff/banner row = 6%.

| Role | value | text on panel | pill 10% panel / card / overlay | toggle 20% panel | diff row 6% panel / overlay |
|---|---|---|---|---|---|
| `status-ok` | #036748 | 6.57 | 5.64 / 5.94 / 5.94 | 4.83 | 5.99 / 6.32 |
| `status-warn` | #705600 | 6.60 | 5.72 / 6.00 / 6.00 | 4.88 | 6.05 / 6.37 |
| `status-orange` | #993d00 | 6.60 | 5.66 / 5.96 / 5.96 | 4.80 | 6.03 / 6.32 |
| `status-bad` | #ad0017 | 7.15 | 5.93 / 6.25 / 6.25 | 4.85 | 6.39 / 6.74 |
| `status-info` | #1f52c3 | 6.53 | 5.60 / 5.92 / 5.92 | 4.81 | 5.98 / 6.30 |
| `status-progress` | #1758b1 | 6.50 | 5.61 / 5.87 / 5.87 | 4.79 | 5.93 / 6.25 |
| `status-purple` | #6d33d1 | 6.55 | 5.60 / 5.90 / 5.90 | 4.75 | 5.97 / 6.29 |

**Log pane (`surface-sunken`)**

| Item | value | ratio | need |
|---|---|---|---|
| ERROR word / line (`log-error`) | #ad0017 | 6.41 | 4.5 |
| WARN (`log-warn`) | #705600 | 5.92 | 4.5 |
| INFO word (`log-info`) | #1f52c3 | 5.86 | 4.5 |
| DEBUG line (`log-debug`) | #5f6b80 | 4.58 | 4.5 |
| plain line (`ink` at 85%) | - | 10.13 | 4.5 |

**Bars and metric strokes** (non-text, 3.0) against the track (`surface-tint` 6% over card) and the card.

| Role | value | vs track | vs card |
|---|---|---|---|
| `bar-low` | #397fef | 3.41 | 3.85 |
| `bar-mid` | #a87900 | 3.45 | 3.89 |
| `bar-high` | #ea4843 | 3.38 | 3.81 |
| `metric-cpu` | #2b82ee | 3.36 | 3.80 |
| `metric-mem` | #9767e9 | 3.42 | 3.87 |

**Pod-tag series** (text on `surface-sunken`, 4.5)

| Role | value | ratio |
|---|---|---|
| `series-1` | #cb106e | 4.66 |
| `series-2` | #52760a | 4.52 |
| `series-3` | #0b7489 | 4.62 |
| `series-4` | #b210cb | 4.67 |
| `series-5` | #0a7669 | 4.70 |
| `series-6` | #5c6b7f | 4.63 |

**Accent set** (link/tab text: 4.5 on base, panel, card; tab/button tint `accent/20`: 4.5; solid fill label: 4.5; focus ring at 70%: 3.0)

| Accent | value | link on base / panel / card | text on accent/20 (panel) | label white on fill | - | ring 70% on base / overlay |
|---|---|---|---|---|---|---|
| blue | #1758b1 | 6.17 / 6.50 / 6.85 | 4.79 | 6.85 | - | 3.32 / 3.54 |
| teal | #036360 | 6.40 / 6.74 / 7.10 | 4.94 | 7.10 | - | 3.41 / 3.59 |
| violet | #6924e0 | 6.46 / 6.81 / 7.17 | 4.84 | 7.17 | - | 3.69 / 3.91 |
| amber | #805100 | 6.11 / 6.45 / 6.79 | 4.76 | 6.79 | - | 3.25 / 3.45 |
| rose | #a51257 | 6.70 / 7.06 / 7.44 | 4.94 | 7.44 | - | 3.93 / 4.17 |
| slate | #334155 | 9.33 / 9.84 / 10.35 | 6.98 | 10.35 | - | 4.14 / 4.35 |

### 2.2 Other pairs

| Pair | Dark | Light |
|---|---|---|
| `ink` text on `log-match` tint over `surface-sunken` | 10.38 | 4.83 |
| `ink` text on `log-highlight` tint over `surface-sunken` | 6.46 | 4.89 |
| `log-match` tint vs pane (3:1 per 00 §6.1) | **1.57 FAIL** (today) | 3.15 |
| `log-highlight` tint vs pane (3:1) | **2.52 FAIL** (today; underline carries the cue) | 3.11 |
| `mute` text on `surface-tint` 10% over panel | 4.51 | 4.82 |
| `on-accent` white on `status-bad` 80% over card (count badge) | **3.87 FAIL** (today) | 5.64 |

### 2.3 `identity-yellow` on light (the known risk) and identity distinctness

- Naive light yellow (#ca8a04 family) gives about 3.0:1 as chip text. The fix is a dark gold, **#705600**: 4.88 on panel, 4.68 on base, 6.55 inside a ConfirmModal `ClusterBadge`, dot 6.60 against panel.
- The same fit moved orange to #993d00 and red to #ad0017 so all six pass 4.5 on their own 20% fill over base and panel.
- Distinctness is measured as CIE76 delta E between the six: Dark minimum **30.0** (blue/purple). Light minimum **25.8** (orange/red), then 33.0 (yellow/orange). The bar is 25. Colour is never the only cue: chips carry the label text, the dot and the ring (00 §6.2.4).
- `identity-red` and `status-bad` share a value in both themes (accepted in 00 §6.2.6; disambiguated by dot+label vs icon+text).

### 2.4 Accent risks

- **amber** is within delta E 16.8 (dark) and 10.9 (light) of `status-warn`; **rose** is delta E 37.9 / 40.0 from `status-bad`; **slate** is delta E 19.0 / 13.9 from `mute`. These pass contrast but can be misread: a primary button or link must not look like a warning, an error, or secondary text.
- Mitigations that need no new rule: status is always glyph plus word, never accent; the Appearance preview shows accent and status side by side (§6). Rose was moved toward pink and slate toward navy for the same reason.
- **Product flag:** a destructive button is `status-bad` and a non-destructive primary is `accent`. With rose they are close at a glance (red vs pink). The ConfirmModal destructive style also carries the warning glyph and a verb label, so I keep rose. If you disagree, drop rose, not the rule.

### 2.5 Focus ring

Today `ring-accent/40` to `/60`: 2.4 to 3.3:1 in dark, 2.2 to 3.3 in light. At **0.70** all six accents reach at least 3.4 (dark, on overlay) and 3.25 (light, on base). One alpha, both themes. See D5.

### 2.9 Terminal

Background = `surface-sunken`, cursor = `accent`. Today `ShellTerminal.tsx` sets 11 keys; the other keys are xterm 6 defaults, which this release makes explicit (so the role→xterm mapping is total). Defaults read from `node_modules/@xterm/xterm`: bright colours below, selection `rgba(255,255,255,0.3)`, cursorAccent `#000000`.

| Key (role) | Dark | Dark ratio on #070a10 | Light | Light ratio on #e9edf4 |
|---|---|---|---|---|
| foreground (`term-fg`) | #c9d1d9 | 12.84 | #1f2937 | 12.50 |
| cursor (`accent`) | #4ea1ff | 7.42 | #1758b1 | 5.83 |
| cursorAccent (`term-cursor-accent`) | #000000 | n/a | #ffffff | n/a |
| black | #0d1117 | **1.05 FAIL** (D4) | #1f2937 | 12.50 |
| red | #f87171 | 7.16 | #b30918 | 6.02 |
| green | #34d399 | 10.31 | #056636 | 6.04 |
| yellow | #fbbf24 | 11.87 | #6f5506 | 6.01 |
| blue | #4ea1ff | 7.42 | #0a52b8 | 6.14 |
| magenta | #a78bfa | 7.28 | #900abd | 6.03 |
| cyan | #22d3ee | 10.96 | #065e6f | 6.30 |
| white | #c9d1d9 | 12.84 | #566176 | 5.31 |
| brightBlack | #555753 | **2.71 FAIL** (D4) | #4b5565 | 6.42 |
| brightRed | #ef2929 | 4.74 | #d00b1b | 4.77 |
| brightGreen | #8ae234 | 12.27 | #067940 | 4.69 |
| brightYellow | #fce94f | 15.95 | #836407 | 4.72 |
| brightBlue | #729fcf | 7.15 | #0b62da | 4.74 |
| brightMagenta | #ad7fa8 | 6.02 | #aa0cdf | 4.67 |
| brightCyan | #34e2e2 | 12.38 | #077288 | 4.74 |
| brightWhite | #eeeeec | 17.05 | #3b4557 | 8.22 |
| selection (`term-selection`) | white a 0.30 | fg over it 4.93 | 23 88 177, a 0.25 | fg over it 8.62 |

Notes: light "white" is a readable grey, not near-white, because programs that print ANSI white must stay legible on a light pane; light "brightWhite" is darker than "white" (emphasis on light). Light also sets `minimumContrastRatio = 4.5` so programs that pick their own low-contrast colours are corrected; dark keeps xterm's default (1) for parity.

## 3. Per-site role assignment

Rule for every row: **colour props carry class names, not colours.** `accent="#34d399"` becomes a `text-status-ok` class string; `dot: "#fbbf24"` becomes `bg-status-warn`; SVG strokes use `stroke-metric-cpu` or `currentColor` plus a text class. This is what keeps `rgb(` out of components (the brief's grep matches `rgb(var(...))` too). Legacy Tailwind names (`text-ok`, `bg-bad/10`) remain valid aliases (brief §2.1).

### 3.1 Where I differ from 00 §6.3

| Site | 00 §6.3 said | U1 assigns | Because |
|---|---|---|---|
| `NodeStrip` `cpuColor` / `memColor` low branch | `bar-low` | CPU `metric-cpu`, memory `metric-mem`; mid/high stay `bar-mid`/`bar-high` | Today's low colours are #4ea1ff and #a78bfa, not `bar-low` #60a5fa. Reusing `bar-low` breaks dark parity and loses the CPU/memory hue pair. |
| `ClusterBadge` fill, `ConfirmModal` backdrop/card/ring/input, TopBar glow | as 00 | no difference | Listed so the whole 00 table is accounted for. Ring `gray-700` becomes `edge-strong`; white 10% over gray-800 is within delta E 2.3 of gray-700. |

### 3.2 Sites 00 §6.3 delegates to UX-05 (per file)

| File | Sites | Role |
|---|---|---|
| `ClusterOverview` `MetricCard` | Nodes ready value | `status-ok` |
| | Pods running value | `status-progress` (today #4ea1ff; fixed blue, not accent) |
| | Problem pods value | `status-bad` if any, else `status-ok` |
| | In-flight value | `status-warn` if any, else `dim`; default `ink` |
| `DetailPanel`, `PodTable` | `STATUS` map: Running / Pending / CrashLoopBackOff / ImagePullBackOff / Terminating / Succeeded / Unknown | dot `status-ok` / `-warn` / `-bad` / `-orange` / `-purple` / `-info` / `dim` |
| | `Bar` default colour; memory bar | `metric-cpu`; `metric-mem` |
| | Bar tone at 85% / 65% | `bar-high` / `bar-mid` (thresholds unchanged); the 60a5fa branch is `bar-low` |
| | `Sparkline` colours (CPU, memory); `Sparkline` default | `metric-cpu`, `metric-mem`; default `bar-low` |
| | `#070a10` panels (`style` and `bg-[#070a10]`) | `surface-sunken` |
| | `limit` tick `bg-white/30` / `/40` | `surface-tint/30`, `/40` (ink-channel in light) |
| `ResourceDetailPanel` | health dot; health pill (`rgba(52,211,153,.1)`, ring .3) | `status-ok`/`status-bad`; pill as `bg-status-ok/10 ring-status-ok/30` classes |
| | `Bar` tone at 100% / 80% (this file's thresholds) | `bar-high` / `bar-mid` (thresholds unchanged) |
| | toast `bg-gray-800` | `surface-overlay` |
| | `bg-bad/80 text-white` count badge | `status-bad` fill, `on-accent` text |
| `ResourceViews` | ArgoCD tiles: Total / Synced / Healthy / OutOfSync / Missing / Degraded / Progressing | `ink` / `status-ok` / `status-ok` / `status-warn` / `status-warn` / `status-bad` / `status-progress` |
| `LogViewer`, `MultiLogViewer`, `LogLine`, `LogViewBar` | level text and toggles | `log-error`, `log-warn`, `log-info`, `log-debug`; DEBUG toggle `surface-tint/[0.06]` + `edge-strong` |
| | "previous" toggle, banners | `status-warn` / `status-bad` at the existing alphas |
| | Following dot | `status-ok` |
| | follow toggle (`bg-accent/20 text-accent`) | stays `accent` (UI control) |
| `ShellTerminal` | xterm `theme`, container `style` | `terminalTheme.ts` (§2.9); container `surface-sunken` |
| `index.css` | `html, body` background `#06080c` and colour | `surface-base`, `ink`. Only a first-paint pixel differs (never visible after mount) |

### 3.3 Sites 00 omits (found by grep; assigned here)

| Site | Role |
|---|---|
| `bg-white/*`, `hover:bg-white/*`, `ring-white/*`, `fill-white/*`, `[&::-webkit-progress-bar]:bg-white/*`: mechanical, same alpha | `surface-tint` |
| `bg-black/50`, `/60`, `/40` (modal and popover backdrops: CommandPalette, HelmInstall, ResourceEditor, MergeFromFile, ResourceCreator, ContextSwitcher) | `scrim` |
| `bg-black/20` textarea (ContextSwitcher) | `surface-input` (delta E about 3 in dark) |
| `bg-gray-900/80` (DebugContainerDialog, DiffRows, GuardrailGate, KubectlEquivalent, JournalPage, HelmUpgradeGate, ResourceCompareDialog, WhoCanPage) | `surface-input` |
| `bg-gray-800` + `ring-gray-700` (GenericResourceTable popover) | `surface-overlay` + `edge-strong` |
| `text-white` on solid accent buttons (ResourceEditor, HelmInstallModal, MergeFromFileModal, ResourceCreator) | `on-accent` |
| `text-black/50` palette glyph on the identity swatch (ContextSwitcher) | `text-surface-base/50` (decorative, inverts with theme) |
| Tailwind default palette in `DetailPanel`: `text-red-400`, `text-yellow-400`, `bg-blue-500/10 text-blue-400 ring-blue-500/20`, `bg-yellow-500/10 text-yellow-400` | `status-bad`, `status-warn`, `status-info` classes. Dark shift is small (yellow-400 vs warn delta E 9.6; blue-500 tint vs info at 10% is not visible). Accepted. |
| "Progressing" pills `bg-accent/10 text-accent` (ResourceViews x4, ResourceDetailPanel x4 incl. the `Running` icon map) | `status-progress`. **Without this the pill turns teal with a teal accent.** |
| `DiffRows` `ROLE`/`TINT` | `diff-add`/`-remove`/`-change`; "replaced" is `status-orange`, "dropped" is `diff-remove` |
| `TopBar` dot glow `shadow-[0_0_0_3px_rgba(52,211,153,.18)]` | `shadow-[0_0_0_3px_rgb(var(--c-status-ok)/0.18)]` defined in CSS, not a component literal |
| Stays `accent` (UI, follows the user's choice) | primary buttons, links, selected-tab bar, `bg-accent/20` toggles, focus rings, row hover and selection, `NodeDrainDialog` progress fill, terminal cursor, left `.grain` glow |

## 4. Accent set

Final values, both themes. Default is Blue = today's accent and equals `identity-blue` (00 §6.2.3).

| Accent | Dark | Light | `data-accent` |
|---|---|---|---|
| Blue (default) | #4ea1ff | #1758b1 | `blue` |
| Teal | #2dd4bf | #036360 | `teal` |
| Violet | #b197fc | #6924e0 | `violet` |
| Amber | #f59e0b | #805100 | `amber` |
| Rose | #f472b6 | #a51257 | `rose` |
| Slate | #b8c7da | #334155 | `slate` |

Link, tab-tint, label-on-fill and focus-ring ratios for every accent are in §2.1 (Accent set tables). All pass in light. In dark every accent passes as link text, tab tint and focus ring; the **white label on a solid fill fails for all six** (1.72 to 2.67), which is the pre-existing `bg-accent text-white` defect (D1).

Rules: the accent colours buttons, links, selected tabs, toggles, focus and row selection. It never colours status, identity, charts, logs, diffs or ANSI. CSS: `[data-accent="X"]` sets the dark value under `:root, [data-theme="dark"]` and the light value under `[data-theme="light"][data-accent="X"]` (twelve blocks).

## 5. Pre-existing dark failures (parity-locked) and decisions

Dark parity is acceptance criterion 1, so none of these is changed unless you say so. Each fix is one value or one string.

| # | Today (dark) | Ratio | Fix | Decision |
|---|---|---|---|---|
| 1 | `bg-accent text-white` primary buttons and `bg-bad/80 text-white` badge | 2.67 (blue); 3.87 | `on-accent` dark = #0b0d12 (7.28 on blue; 5.02 on the badge) | **D1** |
| 2 | `dim` as glyph on card / overlay | 2.77 / 2.44 | none now; `text-dim` as text is already banned by CLAUDE.md | leave |
| 3 | DEBUG lines `text-dim` on `surface-sunken` | 3.30 | `log-debug` dark #7a8397 (5.21) | **D3** |
| 4 | Terminal `black` / `brightBlack` | 1.05 / 2.71 | `brightBlack` #7d8590 (5.31). Leave `black`: it is a background colour in every terminal theme | **D4** |
| 5 | Focus rings `/40` to `/60` | 2.4 to 3.3 | single 0.70 alpha (§2.5). Only focus states change, not static screens | **D5** |
| 6 | `log-match` / `log-highlight` tint vs pane | 1.57 / 2.52 | alpha 0.56 / 0.44 (text stays at least 5.4; tint reaches 3.0) | **D6** |
| 7 | `edge` / `edge-strong` hairlines and input borders | about 1.2 | none: decorative separators; fields are identified by fill, placement and label | scope: follow-up (visible change in both themes) |
| 8 | Scrollbar thumb | about 1.2 (light about 2.2) | none | scope: follow-up |

(D2 is "leave row 2".) Recommendation: accept D1, D3, D4, D5, D6 together as one "contrast fixes" commit after the parity screenshots are signed off, so parity stays bisectable. Default if unanswered: all off. Identity chips and ClusterBadge already pass in dark (at least 4.83), so no identity fix is needed.

## 6. Settings: Appearance

### 6.1 Placement

Section list per 00 §7.1 order. v1.4.2 ships **Diagnostics, Appearance**. Absent sections stay absent. Opening Settings from the gear or `⌘,` still lands on the first section; "Settings: Appearance" opens straight to Appearance. (Appearance is the likelier first stop, but 00 fixes the order and the shell has no memory; not worth changing.)

```
Sidebar footer gear / ⌘,            Palette: "Settings: Appearance"
┌─ Settings ─────────────────────────────────────────────────────────┐
│ ┌─────────────┐ ┌─────────────────────────────────────────────────┐│
│ │ Diagnostics │ │ Appearance                                      ││
│ │▌Appearance  │ │                                                 ││
│ └─────────────┘ │ Theme                                           ││
│                 │ (•) System        ( ) Light        ( ) Dark     ││
│                 │     Currently Dark                              ││
│                 │ System follows your operating system and        ││
│                 │ changes when it does.                           ││
│                 │                                                 ││
│                 │ Accent colour                                   ││
│                 │  (✓●)     (●)      (●)      (●)     (●)    (●)  ││
│                 │  Blue    Teal    Violet   Amber   Rose   Slate  ││
│                 │ Used for buttons, links, selected tabs and      ││
│                 │ focus rings. Cluster colours, status colours    ││
│                 │ and charts do not change.                       ││
│                 │                                                 ││
│                 │ Preview                                         ││
│                 │ ┌─────────────────────────────────────────────┐ ││
│                 │ │ [ Merge ] [ Cancel ]  Open in YAML   Logs   │ ││
│                 │ │ ✓ Running ▲ Pending ✕ Failed ↻ Progressing  │ ││
│                 │ │ ● my-cluster  Cluster colour. It does not   │ ││
│                 │ │               change with the accent.       │ ││
│                 │ └─────────────────────────────────────────────┘ ││
│                 │ Saved on this computer only.                    ││
│                 └─────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────┘
```

### 6.2 Spec

| Element | Spec |
|---|---|
| Theme | Native radio group, label "Theme", options System / Light / Dark. Row at 720 px and above, stacked below. Selected state is the filled radio dot, not colour. Under System: "Currently Dark" or "Currently Light" in `mute` 11.5 px, inside an `aria-live="polite"` region so an OS-driven switch is announced. |
| Accent | Native radio group "Accent colour". Each option is a 32 px target holding a 20 px swatch (the accent's value for the **current** theme) with its **name always visible below** (11.5 px). Selected: `ring-2 ring-offset-2 ring-offset-surface-panel ring-ink` (the ContextSwitcher swatch pattern), a check glyph on the swatch in `on-accent`, name in `ink` medium weight. Unselected names are `mute`. |
| Preview | Real components in a `surface-card/70 ring-1 ring-edge rounded-lg p-3` box captioned "Preview": primary button "Merge" (accent fill, `on-accent` label), secondary "Cancel", a link, a selected-tab sample, four status pills with glyph and word (fixed colours), one `identity-blue` chip (dot + label "my-cluster") with the visible note "Cluster colour. It does not change with the accent." The row is `inert` and `aria-hidden` (a demo, not controls). |
| Apply | Immediate. No Save or Reset button: each choice is one click from undone. |
| Motion | None on switch (no cross-fade), so no flash and no reduced-motion branch. |
| Narrow (< 720 px) | Section select replaces the list (00 §7.1). Swatches wrap 3 per row; theme radios stack. |

### 6.3 States

| State | Behaviour |
|---|---|
| First run / nothing stored | System + Blue |
| Stored value corrupt or unknown accent | Silent fallback to System + Blue (low stakes, nothing destructive) |
| OS appearance unreadable (`matchMedia` missing or throwing) | System resolves to Dark; reads "Currently Dark" |
| OS changes while System is selected | App, terminal and preview switch live; the live region updates |
| Storage write fails | Inline under the groups, `role="status"`, `status-warn` tone: "Couldn't save this choice. It applies until you close Watchtower." |
| Loading, empty, partial, too much data, denied, read-only mode | Not applicable (synchronous, app-local, no cluster) |
| Terminal open during a change | Re-themes live (T42-5); text drawn with explicit ANSI colours re-maps, existing scrollback follows the new palette |

### 6.4 Keyboard and accessibility

- Tab order: section list, Theme group (one stop), Accent group (one stop). The preview is skipped (inert).
- In a group: arrows move and select (native radio behaviour); Space selects.
- Focus indicator: `focus-visible:ring-2 ring-focus-ring` on the option label, at least 3:1 (§2.5). Targets at least 24 px.
- Esc is not handled here (Settings is a view, not a layer).
- Accent names are real text: "Blue, radio, 1 of 6, checked". Swatches are `aria-hidden`.
- No colour-only state anywhere in the section.

### 6.5 Copy

| Where | Text |
|---|---|
| Section title | Appearance |
| Theme label | Theme |
| System hint | System follows your operating system and changes when it does. |
| System status | Currently Dark / Currently Light |
| Accent label | Accent colour |
| Accent hint | Used for buttons, links, selected tabs and focus rings. Cluster colours, status colours and charts do not change. |
| Preview caption | Preview |
| Chip note | Cluster colour. It does not change with the accent. |
| Storage note | Saved on this computer only. |
| Write failure | Couldn't save this choice. It applies until you close Watchtower. |

### 6.6 Command palette

Entry **"Settings: Appearance"** in the App group beside "Settings" and "Settings: Diagnostics" (00 §7.3). Keywords: theme, dark, light, accent, colour. Action: open Settings on Appearance and focus the selected Theme radio. No separate "Theme: Light" commands.

## 7. Answers to brief §1.4

- **Q42-1 (window chrome): agree, webview only.** `titleBarStyle: "Overlay"` already puts the TopBar in the webview on macOS; the traffic lights follow the OS. A mismatch only appears with a manual override (OS dark, app Light): the Windows/Linux native title bar stays dark, which is acceptable. `window.setTheme` would fix it but needs a capability change in `src-tauri/`, outside this release. Leave `tauri.conf.json` `backgroundColor` alone unless the §7.2 first-paint check shows a visible dark flash on a light OS.
- **Q42-2 (sparkline and bars accent-coupled): agree, no.** They use `bar-*` and `metric-cpu`/`metric-mem`. Trap: today's CPU colour (#4ea1ff) **equals** the accent default, so a lazy `text-accent` passes the dark parity screenshot and breaks on the first non-blue accent. F3's test should assert that no `metric-*`, `bar-*`, `status-*`, `diff-*`, `log-*` or `identity-*` class resolves through `--c-accent`.

## 8. Corrections to the brief

1. **§2.1 storage form.** `edge`/`edge2` and `log-match`/`log-highlight` have baked alpha, and sites use opacity modifiers on them today (`border-edge/40`, `divide-edge/60`; Tailwind replaces the alpha, so `edge/40` is white at 40%). Channels alone cannot express that. Use a companion `--a-<role>` and a config function: `({opacityValue}) => opacityValue === undefined ? "rgb(var(--c-edge) / var(--a-edge))" : "rgb(var(--c-edge) / " + opacityValue + ")"`. This keeps dark parity exact.
2. **§2.4 / §7.1 grep is too narrow.** It finds hex and `rgb(`, not Tailwind palette classes: `bg-white/*`, `bg-black/*`, `bg-gray-*`, `ring-gray-*`, `text-white`, `text-red-400`, `text-yellow-400`, `*-blue-500`. They are most of the work; skipping them leaves light mode unreadable. Add a second grep that must return nothing: `\b(bg|text|ring|border|divide|fill|stroke|from|to|via)-(white|black|gray|slate|zinc|neutral|red|green|yellow|amber|blue)(-[0-9]+)?\b`.
3. **`rgb(var(...))` in a component trips the brief's own grep** (`rgba?\(`). Hence the class-name rule in §3.
4. **Terminal.** Today's xterm theme sets 11 keys; "role→xterm mapping is total" needs the bright eight, selection and cursorAccent defined (§2.9).
5. **§2.3 hash default.** `IDENTITY_ROLES` must keep the order of `CLUSTER_COLOR_NAMES` (accent, ok, warn, orange, bad, purple map to blue, green, yellow, orange, red, purple) or unconfigured contexts change colour. Add that to F3's tests.
6. **Roles with no "today" value** (`focus-ring`, `banner-impersonation`, `identity-demo`, `on-accent`, `term-*`): the brief says dark = today verbatim; these are defined here, provisional where marked.
7. **`data-accent`** needs a block per accent per theme (twelve), not six.
8. **Primary-button contrast** (`bg-accent text-white`) fails today; the brief's contrast acceptance only checks U1's tables. D1.
9. **Native controls.** No `color-scheme` is set, so `<select>` popups use the light native style on the dark UI today. Polish; not parity-safe in dark, nothing needed for light. Left as is.

---

# Part B: platform sections (not part of the v1.4.2 freeze)

Written once here so v1.5.x needs no new UX doc. Data needs are flagged for the tech lead; nothing below changes the v1.4.2 scope.

## 9. Settings: Updates (v2.1.0, X1; revises the v1.5.0 #51 draft)

Source: `docs/impl/v2.1.0-tasks.md` (T21-4, T21-9, T21-10, T21-12). Garita checks GitHub Releases. Order per 00 §7.1: after Appearance. Layout follows the other `SettingsView.tsx` sections (h3 title, `text-[12.5px]`, `mute` secondary text, buttons `h-7 px-3 rounded-md ring-1 ring-edge text-[11.5px]`). No new components.

**Platform split.** `inAppInstall` true (macOS): download and install in the app. `inAppInstall` false (Linux `.deb`/`.rpm`): notice only; the one action is **Download**, which opens the release page. Linux never shows Download update, a progress bar or Restart.

```
macOS, available                                 Linux, available
┌───────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│ Updates                                   │   │ Updates                                   │
│ Garita 2.1.0                              │   │ Garita 2.1.0                              │
│ ↻ Version 2.1.1 is available.             │   │ ↻ Version 2.1.1 is available.             │
│   Release notes ↗                         │   │   Release notes ↗                         │
│ [ Download update ] [ Check for updates ] │   │ [ Download ] [ Check for updates ]        │
│ [x] Check for updates automatically       │   │ Install it with your package manager.     │
│ Checks GitHub shortly after launch, ...   │   │ [x] Check for updates automatically       │
└───────────────────────────────────────────┘   │ Checks GitHub shortly after launch, ...   │
                                                └───────────────────────────────────────────┘
```

### 9.1 States

Glyph and word carry state, never colour alone. Tones: `status-ok`, `status-progress` (neutral, not accent), `status-warn`, `status-bad`.

| State (`UpdateState.s`) | Status line | Controls |
|---|---|---|
| `unavailable` (dev build) | "Updates aren't available in this build." (`mute`) | Check button and checkbox disabled (`aria-disabled`), reason is that line. Never hidden. |
| `idle` | "Not checked yet." | **Check for updates** |
| `checking` | "↻ Checking for updates..." (`status-progress`) | Check button `aria-disabled`, visible reason under it: "A check is already running." |
| `up-to-date` | "✓ You're up to date. Last checked today at 14:02." (older: "on 9 Oct at 14:02") | **Check for updates** |
| `available`, macOS | "↻ Version 2.1.1 is available." + "Release notes ↗" | primary **Download update**; secondary Check for updates |
| `available`, Linux | same line + "Install it with your package manager." | primary **Download** (opens release page); secondary Check for updates |
| `downloading` (macOS) | "Downloading 2.1.1" + progress bar + "42%" (total unknown: bytes, "12.4 MB") + "You can keep using Garita while this downloads." | No Cancel (T21-12). Check disabled, reason "Downloading. This can't be cancelled." |
| `ready` (macOS) | "✓ 2.1.1 is downloaded and ready to install." | primary **Restart to update**. Nothing is installed yet. |
| `installing` (macOS) | "Installing 2.1.1..." | all `aria-disabled` |
| `failed`, `check` (manual only) | "▲ Couldn't check for updates. Last result: up to date on 9 Oct at 14:02." (or "Last result: never checked.") + "Releases on GitHub ↗" (`status-warn`) | **Try again** |
| `failed`, `download` | "✕ Couldn't download 2.1.1. <reason>" + "Download from GitHub ↗" (`status-bad`) | **Try again** |
| `failed`, `install` | "✕ Couldn't install 2.1.1. <reason> Nothing was changed." + "Download from GitHub ↗" (`status-bad`) | **Try again** (downloads again) |
| Offline | same as `failed`/`check` | |

- Too much data: `<reason>` is the plugin message, selectable, wraps, capped at 3 lines with the full text in `title`.
- Release-page links call `openReleasePage` (T21-9); they take no URL. Notes text is not rendered in v2.1.0 (link only).
- **Quiet errors.** No modal, no toast. An automatic check that fails changes nothing on screen. A manual failure shows the `failed`/`check` line, which names the last known result (`checkedAt` of the last success), so a failed manual check never makes "up to date" look unknown.
- A `failed` download/install keeps the Sidebar notice (the update is still pending). A failed check adds none.
- Read-only mode does not affect updating (not a cluster write, no `invokeWrite`).

### 9.2 Restart confirm (macOS)

"Restart to update" swaps to an inline confirm row in place (not a modal, so no `ConfirmModal`):

```
Garita will restart to finish installing 2.1.1. Open shells, log streams and port-forwards end.
[ Restart now ]  [ Cancel ]
```

- Focus moves to **Cancel**. Esc or Cancel closes the row and returns focus to **Restart to update**. Esc closes only this row.
- **Restart now** runs `install()` then `relaunch()`. Never restarts on its own; nothing touches disk before this.

### 9.3 Automatic check (off switch)

The brief has it (T21-10): checkbox **"Check for updates automatically"**, default on, stored in `localStorage["updates"]` with try/catch.

| Item | Spec |
|---|---|
| Hint, on | "Checks GitHub shortly after launch, then once a day. Only the version is compared; no cluster data is sent." (`mute` 11.5 px) |
| Hint, off | "Automatic checks are off. Use Check for updates when you want one." |
| Storage write fails | Inline `role="status"`, `status-warn`: "Couldn't save this choice. It applies until you close Garita." |
| Cadence | First check <= 10 s after launch, then every 24 h while running. Dev builds never check. |

### 9.4 Accessibility

- **Live region only for user-started actions.** The visible status line is plain text, not live. A separate visually hidden `role="status"` span receives text only from click handlers (Check, Download update, Restart now, Try again) and from their results. Automatic checks and the timer never write to it, so a background result is not announced.
- Progress: `role="progressbar"` with `aria-valuemin/max/now` and `aria-label="Downloading 2.1.1"`. `aria-valuenow` updates in 10% steps; the visual bar is continuous. Unknown total: indeterminate, no `aria-valuenow`.
- **No focus steal.** No state change moves focus, except what the user just did: opening the confirm row (to Cancel), closing it (back to Restart to update), and a pressed button that disappears (Download update -> progress), where focus goes to the status line container (`tabindex="-1"`).
- Tab order: section list, primary action, Check for updates, release links, checkbox. Real buttons and links, `focus-visible:ring-2 ring-focus-ring`, targets >= 24 px. Palette and Sidebar notice give keyboard access too (9.5, 9.6).
- `aria-disabled` controls link their reason with `aria-describedby`.
- Spinner and progress honour `prefers-reduced-motion` (static glyph).
- Narrow (< 720 px): buttons stack full width.

### 9.5 Sidebar notice

A one-line row directly under the Sidebar title row (that row is a drag region, so the control must not sit in it). It follows the `UpgradeSeedBanner` calm style: neutral, no ring, no badge count, no pulse, no accent.

```
Garita v2.1.0
↻ Update available   ✕
```

| Item | Spec |
|---|---|
| Visual | `text-[11.5px]`, glyph `status-progress`, text `mute`, hover `ink` |
| Shown when | state is `available`, `downloading`, `ready`, `installing`, or `failed` after a found version; not dismissed for that version; not a dev build |
| Label | available (macOS and Linux): "Update available". downloading: "Downloading update". ready: "Ready to install". |
| Action | The label is a button. It opens Settings -> Updates and focuses the primary action. |
| Dismiss | Separate ✕ button, `aria-label="Dismiss update notice for 2.1.1"`. Stores the dismissed **version** in `localStorage["updates"]` (try/catch). A newer version shows again. Settings still shows the update. |
| Not dismissible | `ready`: downloaded bytes wait for a restart, so the row stays. |
| Live region | None. Reachable by Tab. |
| Narrow sidebar | Glyph only, with `title` and `aria-label` = the label. |

### 9.6 Command palette

Entry **"Settings: Updates"** in the App group beside "Settings: Appearance". Keywords: update, upgrade, version, release, check. Action: open Settings on Updates and focus the primary action (Download update / Download / Restart to update), otherwise **Check for updates**. It does not start a check itself. No separate "Check for updates" command.

### 9.7 Copy

| Where | Text |
|---|---|
| Title / version | Updates / Garita 2.1.0 |
| Idle | Not checked yet. |
| Checking | Checking for updates... |
| Check reason | A check is already running. |
| Up to date | You're up to date. Last checked today at 14:02. |
| Available | Version 2.1.1 is available. |
| Buttons | Download update (macOS) / Download (Linux) / Check for updates / Restart to update / Try again |
| Linux hint | Install it with your package manager. |
| Downloading | Downloading 2.1.1 / You can keep using Garita while this downloads. |
| Download reason | Downloading. This can't be cancelled. |
| Ready | 2.1.1 is downloaded and ready to install. |
| Confirm | Garita will restart to finish installing 2.1.1. Open shells, log streams and port-forwards end. [Restart now] [Cancel] |
| Installing | Installing 2.1.1... |
| Check failed | Couldn't check for updates. Last result: up to date on 9 Oct at 14:02. / Last result: never checked. |
| Download failed | Couldn't download 2.1.1. |
| Install failed | Couldn't install 2.1.1. Nothing was changed. |
| Links | Release notes / Releases on GitHub / Download from GitHub |
| Checkbox | Check for updates automatically |
| Dev build | Updates aren't available in this build. |
| Sidebar | Update available / Downloading update / Ready to install |
| Palette | Settings: Updates |

Copy never says "smart", "auto-fix", "secure" or "protected".

### 9.8 Part B: README and landing-page copy (not applied here)

For the frontend/main session. It is true of the plugin: one GET of `latest.json` from GitHub; macOS installs after confirm; Linux gets a notice.

- **README.md**, one bullet in the behaviour/privacy list (and remove any line that says Garita makes no network calls apart from the cluster):

  > **Checks GitHub for new versions.** Garita looks for a new release shortly after launch and once a day. It sends no cluster data. On macOS it installs an update only after you confirm; on Linux it shows a notice and opens the release page. Turn it off in Settings -> Updates -> "Check for updates automatically".

- **site/index.html**, one plain sentence beside the other trust lines, no new link (the page keeps exactly 3 `releases/latest/download/` links):

  > Garita checks GitHub once a day for a new version and never sends cluster data. You can turn the check off in Settings.

## 10. Settings: Command-line tool (v1.5.2, #55)

The command is `watchtower` (lowercase; the Cargo binary is `Watchtower`).

| Platform | Status line | Action |
|---|---|---|
| macOS, not installed | "The `watchtower` command isn't installed." | **Install the "watchtower" command** (creates the link) |
| macOS, installed | "✓ `watchtower` is installed at /usr/local/bin/watchtower." | none |
| macOS, link points elsewhere or is dangling | "`watchtower` points to <path>, which doesn't exist." | **Reinstall the "watchtower" command** |
| macOS, `/usr/local/bin` not writable | "Watchtower can't write to /usr/local/bin. Run this in a terminal:" + copyable block `sudo ln -sf "<app path>/Contents/MacOS/Watchtower" /usr/local/bin/watchtower` + Copy | no privilege prompt, no shelling out |
| Linux .deb / .rpm | "✓ `watchtower` is on your PATH (installed by the package)." | status only |
| Linux AppImage | "An AppImage doesn't add a command. To add one, run:" + copyable `ln -s <path to AppImage> ~/.local/bin/watchtower` | text only |
| Windows | "✓ The installer added `watchtower` to your PATH. Open a new terminal window to use it." If not detected: "`watchtower` isn't on PATH. Open a new terminal window, or reinstall Watchtower." | status only |

Also: "To remove the command on macOS, delete /usr/local/bin/watchtower." (text, copyable). Data needs: install location, whether the link exists and where it points, platform and package kind.

### 10.1 `watchtower --help`

```
Watchtower 1.5.2: Kubernetes desktop client

Usage:
  watchtower [options]

Options:
  --context <name>   Open with this kubeconfig context selected
  -h, --help         Show this help and exit
  -V, --version      Show the version and exit

Running watchtower while Watchtower is open brings that window to the front.
```

- `--version` prints one line, `Watchtower 1.5.2`, to stdout, exit 0.
- Only `--context` is specified because it is the one UX-05 names; add flags to the help only when they exist.
- **Unknown arguments are never an error dialog.** The process prints `watchtower: ignoring unknown option '--foo' (see watchtower --help)` to stderr and starts normally.

### 10.2 Second invocation

The existing window is shown and focused. If arguments were forwarded:

- A **strip** (not a toast: Watchtower has no toast system) appears above the main content, `role="status"`, text on `surface-card` with an `edge` ring, a Dismiss button, no auto-dismiss: "Context 'foo' not found; staying on 'bar'." or "Ignored unknown option '--foo'."
- If `--context` names a known context and **no dialog is open**, switch and say so in the strip: "Switched to 'foo' (from the command line)."
- If any dialog or confirm is open, **do not switch**. The strip offers "Switch to 'foo'" so a context never changes under a half-read destructive dialog.

## 11. Proxy provenance and banner copy (v1.5.1, #50)

No proxy form and no app-level proxy settings. `proxy-url` is read from the kubeconfig and shown as provenance only.

- **ContextSwitcher row:** a second muted line under the context, "via proxy proxy.corp:3128" (`mute`, 11 px). SOCKS shows "via SOCKS5 proxy host:port". Contexts without a proxy show nothing (no "no proxy" text).
- **Never show credentials.** Strip any `user:pass@` from the displayed value and from the `title` text. Show scheme only for SOCKS.
- Unsupported scheme: the row shows "▲ Proxy type not supported: <scheme>" (`status-warn`); the context stays listed.

Trust banner failure copy (variants; `<ctx>` is the context, never the proxy credentials):

| Cause | Copy |
|---|---|
| Direct unreachable (unchanged) | existing text |
| Proxy unreachable or refused | "Can't reach <ctx> through proxy proxy.corp:3128. The proxy refused the connection or is unreachable. Check the proxy-url in your kubeconfig and your network." |
| Proxy returned 407 | "The proxy at proxy.corp:3128 rejected the request (407). Check the credentials in the proxy-url in your kubeconfig." |
| Unsupported proxy type | "This proxy type isn't supported: <scheme>. Supported types: http, socks5." |

Data needs: parsed proxy host, port and scheme per context; a distinct error class for proxy failures (otherwise the banner cannot pick a variant).

## 12. Low-fi: custom keybindings (#42, backlog)

Settings → Keyboard (after Appearance).

```
┌────────────────────────────────────────────────────────────┐
│ Keyboard                                                   │
│ Action                     Shortcut         │
│ Refresh                    r                 [ Change ]     │
│ New resource               ⌘N                [ Change ]     │
│ Focus search               /                 [ Change ]     │
│ Command palette            ⌘K                [ Change ]     │
│ Esc, ⌘, and ⌘↵ are fixed.                    [ Reset all ]  │
└────────────────────────────────────────────────────────────┘
```

- Change → the row shows "Press the new keys. Esc cancels." and captures one chord.
- Conflicts are checked against the reserved set (00 §8.2), other bindings, and the OS-reserved list: "⌘N is used by New resource. [Replace] [Pick another]". Replace leaves the other action "Unbound" visibly. OS-reserved: "That combination is reserved by your system."
- Single-letter bindings obey K1/K2 (inactive in editable elements and the terminal).
- Per-row Reset when changed; "Reset all" asks inline first. Stored in `localStorage`, per viewer. Not a cluster write.
- Palette entry "Settings: Keyboard". Tooltips and palette hints show the user's binding (K8).

## 13. Low-fi: demo mode (#45, backlog)

- A **fixed banner** across the top of the window, not an identity chip and not themeable: `banner-impersonation`-style fixed fill is reserved for #34, so demo uses `identity-demo` (cyan) as a solid strip with `on-accent` text: "Demo data. Nothing is sent to any cluster." Always visible; cannot be dismissed while demo is on.
- The context chip in Sidebar and TopBar is `identity-demo`, label "demo". It is not selectable in the identity editor.
- **Every confirm in demo mode** states, in the description slot, "Demo data. Nothing is sent." Writes complete locally and the journal marks them "demo".
- Entering and leaving: a Settings or palette action "Start demo" and a banner button "Exit demo". Leaving restores the previous context. Demo state never persists across launches.
- Open: where demo data comes from and whether read-only is forced on (UX recommendation: not forced, because the point is to rehearse writes).

