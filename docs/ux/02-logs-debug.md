# UX 02: Logs and debug (v1.3)

Status: wave 2 draft, for tech lead review. Depends on `docs/ux/00-overview.md`; cites contracts by name (CONFIRM-ANATOMY, DISABLE-PRECEDENCE, STATE-VOCAB, TOKEN-ROLES, KEYMAP, COPY-RULES, A11Y-BASELINE). Does not redefine them.
Baseline: Watchtower v1.2.1 as shipped (`ConfirmModal` has sizes, phases, status slot, focus trap, Esc layering; `modalLayer.ts` exists). Design only: no code, no command signatures. Data needs are in section 9.

## Contents

1. Scope, findings, components touched
2. User flows
3. Wireframes
4. States
5. Microcopy
6. Keyboard and accessibility
7. Light and dark notes
8. Constraint checklist
9. Open questions for tech lead
10. Decisions, with recommendations

---

## 1. Scope

| ID | Item | Class | Surface |
|---|---|---|---|
| #1 | Timestamps toggle and "since" range, single and multi-pod | (a) | `LogViewer.tsx`, `MultiLogViewer.tsx` |
| #2 | Include, exclude, highlight, level filter, JSON view; node/zone filter (multi only); MultiLogViewer to parity | (a) | same two files |
| #3 | Honour `kubectl.kubernetes.io/default-container` | (b) | `DetailPanel.tsx` Logs and Shell tabs |
| #4 | Open logs on the failing container | (b) | same |
| #5 | Ephemeral debug container: image + target picker, attach (not exec) | (a) | `DetailPanel.tsx` Shell tab, `ShellTerminal.tsx`, `ConfirmModal.tsx` |

The user job behind all five: "something is wrong with this workload, show me the right lines, from the right container, around the right time, and let me get inside if the image has no shell."

### 1.1 Findings from the shipped code

Read on 2026-10-03 against v1.2.1. These shape the design.

| # | Finding | Where | Consequence |
|---|---|---|---|
| L1 | Stream errors are swallowed. `stream_pod_logs` is invoked with an empty catch in both viewers. A container that never started shows "No log lines" plus a blinking "streaming..." forever. | `LogViewer.tsx` (stream effect), `MultiLogViewer.tsx` (per-pod invoke) | Violates *visibility of system status*. The design needs an Error state and an "ended" state (section 4). Needs a data signal (Q-L3). |
| L2 | Single-pod `LogViewer` has **no ring buffer**. The array grows without bound while following. Only `MultiLogViewer` caps at 5,000. | `LogViewer.tsx` | "Searching the last 5,000 lines" copy is only true if both viewers cap. Decision D-L5. |
| L3 | Level detection only recognises one line shape: `HH:MM:SS.fff LEVEL message`. Real workloads log JSON or `level=info` logfmt. For those lines no level is found, and a line with no level is always shown. So the E/W/I/D chips silently do nothing for most logs. | `parseLogLine` | The level filter needs a wider detection rule and an explicit "no level" chip (section 3.4). |
| L4 | Level chip colours disagree with line colours: the `I` chip is the ok role, INFO line text is the info role; `D` chip is accent, DEBUG text is dim. FATAL is folded under ERROR with no sign of it. | `LogViewer.tsx` | One `log-*` role per level, used by chip and line (TOKEN-ROLES). |
| L5 | MultiLogViewer pod prefix is a 128 px column truncated at the end, coloured by hash from six tokens. Pods of one Deployment differ only in their **suffix** (`api-7d9f8c-xk2lp`), which is the part that gets cut. Six colours for up to 20 pods repeat. | `MultiLogViewer.tsx` | Prefix must show the distinguishing tail as text. Colour is secondary (A11Y no colour alone). |
| L6 | Pod objects expose `labels` but **not annotations**, and `containers_status` already carries current state, last reason, exit code and restart count. | `types/k8s.ts` | #4 needs no new data. #3 needs the annotation (Q-L4). |
| L7 | The Logs tab's container selector starts at `containers[0]`; the Shell tab's selector lists init containers without the `[init]` label that Logs uses. If the backend lists init containers first, `containers[0]` may be an init container. | `LogViewer.tsx`, `DetailPanel.tsx` ~1097 | One shared selection rule and one label convention. Verify order (Q-L18). |
| L8 | Pressing Esc in a toolbar input closes the whole detail panel (the app handler only exempts the terminal and open dialogs). | `App.tsx` ~197 | New text fields in the toolbar make this worse. Behaviour defined in 6.1; needs an app-level change (Q-L13). |
| L9 | The viewer renders every line as a DOM row and has no accessible structure for a streaming list. | both viewers | Semantics in 6.3; virtualisation is the tech lead's call (Q-L12). |
| L10 | The Shell tab writes a red "Failed to start shell: ..." into the terminal and offers nothing next. On a distroless image that is a dead end. | `ShellTerminal.tsx` | The natural entry point for #5 (section 2.4). |

### 1.2 Components touched

| Path | Change |
|---|---|
| `src/components/LogViewer.tsx` | Toolbar redesign (Source and View groups), Range, timestamps, exclude, highlight, levels, JSON, hint row, states |
| `src/components/MultiLogViewer.tsx` | Parity with LogViewer; Pods popover; node/zone narrowing; pod tag redesign; cap notice |
| `src/components/DetailPanel.tsx` | Container pre-select (Logs and Shell), selector labels, Shell tab states, debug entry |
| `src/components/ShellTerminal.tsx` | Session states: connecting, attached, detached, exited, failed |
| `src/components/ConfirmModal.tsx` | Consumer only (size `md`, non-destructive, phases `review`, `running`, `error`). No change to the component. |
| `src/components/ResourceDetailPanel.tsx` | Workload Logs tab hosts MultiLogViewer; receives the new toolbar. No new tab. |
| `src/hooks/useResources.ts` | `usePermissions` for the debug gate (data need Q-L11) |
| `src/utils/modalLayer.ts` | Esc layering for toolbar popovers (Q-L13) |
| `tailwind.config.js` | Token role requests only (section 7) |

---

## 2. User flows

### 2.1 Reading logs with a time window (#1)

1. User opens a pod's Logs tab. Container is pre-selected (2.3). Range defaults to "Last 200 lines" (today's behaviour). Timestamps are off.
2. User opens **Range** and picks "Last 15 minutes". The Source group highlights, the buffer clears, a strip shows "Reloading from the last 15 minutes..." and streaming resumes.
   - Branch: zero lines in the window. The empty state offers "Widen to 1 hour" and "All retained".
   - Branch: Range is "All retained" and the cap is hit. The strip shows "Showing the most recent 5,000 lines. N older lines were dropped."
3. User switches Timestamps on. Same reload behaviour. Lines now start with a time.
4. User switches Local to UTC. **No reload**: display only. The control says so in its tooltip.
5. User switches to **previous** instance. Range and Timestamps apply to it if the backend supports that (Q-L1); otherwise Range shows the capability reason (DISABLE-PRECEDENCE position 4).

### 2.2 Narrowing what is shown (#2)

1. Type in **Include**. Lines not matching disappear instantly. The count reads "37 of 5,000 lines".
2. Type in **Exclude** ("healthcheck"). Matching lines disappear. Exclude wins over Include.
3. Type in **Highlight**. Matches are marked in place; nothing is hidden. Enter and Shift+Enter jump between marks ("3 of 17").
4. Toggle levels. Levels with a count of zero stay clickable but read as empty.
5. Toggle **JSON**. JSON lines show as structured rows; click a row's chevron to see the full tree.
6. None of 1 to 5 touches the stream. The View group is labelled "Filters the lines already loaded".
7. Branch: filters hide everything. Empty state says how many lines are hidden and offers "Clear filters".

### 2.3 Container pre-selection (#3, #4)

Precedence, first match wins: **(1) failing container, (2) the pod's default-container annotation, (3) the first non-init container.** Shell uses a different list for (1), see below.

1. Panel opens on Logs. The app evaluates the pod and picks a container.
2. If (1) or (2) chose it, a one-line **reason hint** sits directly under the toolbar: "Selected: last crashed (OOMKilled, exit 137, 3m ago)". It has one button: "Use <other container>" (the container rule (2) or (3) would have chosen). Rule (3) shows no hint, because there is nothing to explain.
3. Clicking "Use <other>" swaps the container and removes the hint. A manual choice from the dropdown also removes it and sticks for this pod until the panel closes.
4. When the failing container's current instance is **waiting** (CrashLoopBackOff and similar), its current log is usually empty. The Logs tab opens on **previous** with the hint "Showing the previous run: the current one is waiting (CrashLoopBackOff, 5 restarts)", and a button "Show current". See D-L2.
5. **Shell tab** rule: (1) is replaced by "not applicable": a container that is not running cannot take a shell, so it is not pre-selected. Order is annotation, then first running container. Non-running containers stay in the list, disabled, with the reason in text.

"Failing" is a deterministic test, no scoring: a container whose current state is waiting with CrashLoopBackOff, ImagePullBackOff, ErrImagePull or CreateContainerError; or terminated with a non-zero exit code; or an init container that terminated non-zero. If several qualify, the most recently finished wins, ties go to spec order, and the dropdown marks every failing one.

### 2.4 Debug container (#5)

Entry points: **Shell tab toolbar button "Debug container..."** (always visible), and the **recovery banner** that appears when a shell cannot start (finding L10).

1. User is on the Shell tab. The selected container has no shell. Terminal prints the failure; below it a banner reads "This container may not include a shell. Start a debug container to get one." with a button.
2. User clicks **Debug container...** The `md` ConfirmModal opens in phase `review` (3.8). Fields: Image, Target container, read-only Name. kubectl-equivalent is collapsed (slot 6).
3. User reads the consequence summary, which states plainly that the container cannot be removed.
4. User clicks **Start debug container** (or presses ⌘↵ per K5).
5. Phase `running`: "Adding debug container to the pod..." There is no Stop (the request cannot be taken back once sent); the summary says so.
6. Modal closes. The Shell tab shows a **status strip** (3.9): Added, Waiting for container (image pull), Connecting, Attached.
7. Terminal attaches to the debug container. Toolbar shows `[debug] debugger-x7k2p` with Detach.
8. Branch **rejected** (phase `error`): server message verbatim in slot 5, plus one plain line. Retry and Close.
9. Branch **image pull failing**: strip shows "Waiting: ImagePullBackOff" with the kubelet message. Actions: "Choose another image" (opens the modal again; the stuck container stays in the spec), "Keep waiting".
10. Branch **Detach**: terminal is replaced by a card, "Detached. debugger-x7k2p is still running in this pod." with Attach and "Start another".
11. Branch **user types `exit`**: the process ends and so does the container. Card: "debugger-x7k2p exited (code 0). A debug container can't be restarted." with "Start new debug container...".
12. Branch **pod is replaced or deleted**: card "This pod no longer exists. Debug containers go away with the pod."

Never offered: a node shell. No copy refers to nodes as a place to get a shell.

---

## 3. Wireframes

Widths refer to the detail panel (resizable 320 to 900 px). Role names, not colours.

### 3.1 LogViewer toolbar, expanded (panel at 900 px)

Two labelled groups. The Source group changes what is loaded and reloads. The View group filters what is already loaded and never reloads.

```
900 px panel, single pod
┌──────────────────────────────────────────────────────────────────────────────┐
│ SOURCE  reloads the log                                                      │
│ [app            ▾] [Range: Last 200 lines ▾] [☐ Timestamps][Local ▾] [previous]│
│                                                                              │
│ VIEW  filters the lines already loaded                                       │
│ Include [______________] Exclude [______________] Highlight [____________]   │
│ [.*] regex  [Aa] case                                                        │
│ Levels [✕ ERROR][▲ WARN][● INFO][○ DEBUG][– no level]   [{} JSON] [wrap]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ 37 of 5,000 lines · searching the last 5,000 lines     ● Following  [Download▾]│
│ Active: [exclude: healthcheck ×] [level: no DEBUG ×]            [Clear all]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Selected: last crashed (OOMKilled, exit 137, 3m ago)        [Use "sidecar"]  │  hint row (2.3)
├──────────────────────────────────────────────────────────────────────────────┤
│ 14:02:11.482 ERROR  connection refused to payments:8443                      │
│ ...                                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Notes:

- Group labels are visible text ("SOURCE", "VIEW"), small, role `dim`. They are also `group` landmarks with accessible names.
- The group boundary is also visual: a hairline (`edge`) between them.
- The **active filters strip** makes hidden state visible (*visibility of system status*). Each chip removes its filter. It renders only when something is active.
- The status line holds count, honesty note, follow state and Download. It is one line and never wraps below 480 px: the honesty note shortens to the tooltip at narrow widths.
- The hint row renders only when the pre-selection rule needs explaining (2.3).

### 3.2 LogViewer toolbar, compact (panel at 480 px)

```
480 px panel
┌──────────────────────────────────────────────────┐
│ [app ▾] [Range ▾] [☐ Time][Local▾] [previous]    │  SOURCE (reloads)
│ ───────────────────────────────────────────────  │
│ Include [______________] [Filters (2) ▾] [Follow]│  VIEW
│ [exclude: healthcheck ×] [no DEBUG ×]            │  active chips
│ 37 of 5,000 lines                  [Download ▾]  │
└──────────────────────────────────────────────────┘
```

- Below about 640 px panel width, Exclude, Highlight, regex, case, Levels, JSON and wrap move into the **Filters popover** (3.3). The button shows a count of active filters ("Filters (2)"). Include stays in the bar because it is the most used.
- At 320 px (minimum) Range and Time stay on row 1 and wrap to a second Source row. Nothing is hidden behind icons only; every control keeps its text label.
- The popover is a layer for Esc (6.1).

### 3.3 Filters popover (compact mode)

```
Popover, 300 px, anchored under [Filters]
┌──────────────────────────────────────────┐
│ Filters the lines already loaded         │
│ Exclude    [__________________]          │
│ Highlight  [__________________] 3 of 17 ↑↓│
│ [.*] regex   [Aa] case                   │
│ Levels                                   │
│ [✕ ERROR 12][▲ WARN 40][● INFO 3,120]    │
│ [○ DEBUG 0 ][– no level 1,828]           │
│ [{} JSON]   [wrap]                       │
│                                [Clear all]│
└──────────────────────────────────────────┘
```

Level chips show counts in the popover and as tooltips in the expanded bar. A count of 0 reads "0" and the chip stays enabled.

### 3.4 Level chips

Each chip pairs a **glyph, a word (or letter at compact width) and the `log-*` role**. Colour is never the only signal.

| Chip | Glyph | Matches |
|---|---|---|
| ERROR | `✕` | error, err, fatal, critical, panic, severity ERROR |
| WARN | `▲` | warn, warning |
| INFO | `●` | info, notice |
| DEBUG | `○` | debug, trace |
| no level | `–` | any line where no level could be found |

Level detection order (finding L3): the existing `HH:MM:SS.fff LEVEL` shape; then a JSON object with `level`, `severity`, `lvl` or `levelname`; then logfmt `level=`; then a leading bracketed token such as `[ERROR]` or `ERROR:`. Otherwise "no level". FATAL is shown inside ERROR and the line keeps its own word. The "no level" chip is on by default, so the default view equals today's.

### 3.5 JSON view

Two states, one toggle.

```
JSON off (default): raw text. JSON lines get a small {} marker at hover/focus.
 14:02:11  {"ts":"2026-10-03T14:02:11Z","level":"error","msg":"refused","host":"payments","retry":3}

JSON on: structured summary, chevron to expand
 ▸ 14:02:11  ✕ ERROR  refused           host=payments retry=3

Expanded line
 ▾ 14:02:11  ✕ ERROR  refused
      {
        "ts": "2026-10-03T14:02:11Z",
        "level": "error",
        "msg": "refused",
        "host": "payments",
        "retry": 3
      }
```

- Decision (D-L4): **per-line expand, plus a toolbar toggle that switches all JSON lines to the summary form.** A whole-view mode alone loses access to the raw line; a per-line expand alone makes a JSON-heavy log unreadable.
- Search, Include, Exclude and Highlight always run on the **raw line text**. The Filters popover says so: "Filters match the raw line."
- Lines that are not complete JSON (truncated, prefixed text) show as raw with no marker. Never an error.
- Values over 120 characters truncate with "Show full value", same rule as DIFF-ROW 3.4.
- The chevron is a button; Enter or Space on a focused row toggles it (6.3).

### 3.6 Timestamps

Display: `HH:MM:SS.mmm` in the viewer's chosen zone. A date appears (`10-03 14:02:11.482`) only when the loaded range crosses midnight in that zone. UTC shows a `Z` suffix on the time so the zone is never ambiguous. Hover on a time shows the full ISO-8601 value with offset.

The in-line prefix from the container's own logger (an app timestamp already in the message) is left alone. The Kubernetes timestamp is a separate leading column, labelled in the tooltip "Time Kubernetes received the line". The two can differ.

### 3.7 MultiLogViewer, expanded (panel at 900 px)

Same two groups as 3.1, with these differences.

```
900 px panel, workload Logs tab
┌──────────────────────────────────────────────────────────────────────────────┐
│ SOURCE  reloads the log                                                      │
│ [app ▾] [Range ▾] [☐ Timestamps][Local ▾] [Pods: 12 of 45 · zone a ▾]        │
│ ⓘ Streaming 12 of 45 pods.                                                   │
│                                                                              │
│ VIEW  filters the lines already loaded                                       │
│ Include [__________] Exclude [__________] Highlight [__________] [.*] [Aa]   │
│ Levels [✕ ERROR][▲ WARN][● INFO][○ DEBUG][– no level]  [{} JSON][wrap]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ 412 of 5,000 lines · searching the last 5,000 lines     ● Following [Download▾]│
├──────────────────────────────────────────────────────────────────────────────┤
│ 14:02:11.482  …xk2lp  ✕ ERROR  connection refused to payments:8443           │
│ 14:02:11.490  …9fq7d  ● INFO   retrying in 2s                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Pod tag (finding L5).** Each line carries a tag made of the **distinguishing tail** of the pod name: the name with the prefix shared by all active pods removed, at least 5 characters, monospace, never truncated from the end. The full name is in the tooltip and in the accessible text of the line. The hash colour stays as a secondary cue only. If two tags would collide, the tag extends until they differ.

**Pods popover** (view-level, no reload):

```
Popover, 360 px, under [Pods ▾]
┌────────────────────────────────────────────────────┐
│ NARROW WHICH PODS STREAM  (reloads)                │
│ Node  [any ▾]   Zone [eu-west-1a ▾]    14 of 45    │
│ ─────────────────────────────────────────────────  │
│ SHOW OR HIDE  (instant, lines already loaded)      │
│ ☑ …xk2lp   worker-3   eu-west-1a    120 lines      │
│ ☑ …9fq7d   worker-5   eu-west-1b     88 lines      │
│ ☐ …2m1ab   worker-3   eu-west-1a      0 lines      │
│ [Show all]                                         │
└────────────────────────────────────────────────────┘
```

- The top block is the **only** thing in the viewer that changes which pods stream, so it sits in the Source group's popover and carries the word "reloads". The bottom block is a pure view filter.
- Node and Zone menus list values with pod counts: "eu-west-1a (14)". Selecting both applies AND. A value with 0 pods is not listed.
- If node/zone data is missing for a pod, the pod appears under "unknown" and the menu says so. A missing label is never treated as a match or a non-match silently.

**Cap interaction.** The 20-pod cap applies **after** the node/zone narrowing. The notice under the Source row:

| Situation | Notice |
|---|---|
| 45 pods, no narrowing | "Streaming 20 of 45 pods. Narrow by node or zone to choose which." |
| Narrowed to 14 | No cap notice. Pods button reads "Pods: 14 of 45 · zone eu-west-1a". |
| Narrowed to 31 | "Streaming 20 of 31 matching pods. Narrow further to see the rest." |
| 12 pods, no narrowing | No notice. |

Which 20: pods that are not ready or have restarted come first, then by name (D-L7). Without that rule the first 20 are arbitrary and the failing pod can be the 21st.

**Compact (480 px):** Pods and Source controls wrap as in 3.2. The Pods popover takes the full panel width.

### 3.8 Debug container dialog (ConfirmModal `md`, phase `review`)

Non-destructive style (CONFIRM-ANATOMY C2): info glyph, accent primary. Irreversibility is stated in words, not with a warning triangle, so the triangle keeps its meaning.

```
512 px dialog
┌───────────────────────────────────────────────────────┐
│ ● prod-eu-1                                           │  slot 1
│ ⓘ Start debug container in "api-7d9f8c-xk2lp"         │  slot 2
│ Adds an ephemeral container to this pod so you can    │  slot 3
│ run tools next to your app. It doesn't restart the    │
│ pod or its other containers.                          │
│ This can't be undone. Kubernetes doesn't allow        │
│ removing an ephemeral container: it stays in the      │
│ pod's spec until the pod is deleted.                  │
│                                                       │
│ Image                                                 │  slot 4
│ [busybox                              ▾]              │
│  busybox · alpine · nicolaka/netshoot · recent…       │
│ The image needs a shell (sh or bash). The node pulls  │
│ it using the pod's image pull secrets.                │
│                                                       │
│ Target container                                      │
│ [app (last crashed)                   ▾]              │
│ Lets you see this container's processes. Not every    │
│ container runtime supports it.                        │
│ Name  debugger-x7k2p  (generated)                     │
│                                                       │
│ ✕ (slot 5: server message appears here on failure)    │
│ ▸ kubectl equivalent                                  │  slot 6
│ Read-only mode (Watchtower guardrail) …  (if on)      │  slot 7
│                         [Cancel] [Start debug container]│  slot 9
└───────────────────────────────────────────────────────┘
```

- **Image field.** Combo: free text plus a short suggestion list (busybox for size, a network-tools image, alpine, ubuntu) plus "recent" images this viewer used (per-viewer convenience, remembered locally). Default is the last image used, else the first suggestion (D-L6). Tags are the tech lead's choice and are not shown as "latest" in the UI.
- **Image validation.** Empty or containing whitespace: inline error under the field, primary disabled with reason (`confirmDisabledReason`): "Enter an image name." No registry lookup. "Image not found" is only knowable after the node pulls, so it appears in the Shell tab status strip (2.4 step 9), not here.
- **Target container.** Select listing the pod's containers (init containers labelled `[init]`; ephemeral containers labelled `[debug]`), default chosen by the same precedence as 2.3 with its reason shown in the option text. First option: "None (don't share a process namespace)".
- **Name** is generated, read-only. It is shown because it will appear in the Shell tab and the Containers tab and the user should recognise it.
- **Phase `running`**: footer shows only the progress line "Adding debug container to the pod..." Esc follows CONFIRM-ANATOMY 2.5 (no silent cancel). Summary adds: "This can't be stopped once started."
- **Phase `error`**: slot 5 shows the server text verbatim, then one plain line (4.3). Footer: Retry, Close.
- **Typed confirm** (slot 8): not required by default. If the context's guardrails (UX-03, #29) require typed confirm, slot 8 appears and asks for the pod name. This spec depends on 03 for that and does not define it.

### 3.9 Shell tab with debug container: states

Tab toolbar (always shown, even for one container, because the debug button lives there):

```
480 px panel, Shell tab
┌──────────────────────────────────────────────────┐
│ Container [app ▾]            [Debug container…]  │
├──────────────────────────────────────────────────┤
│ (terminal)                                       │
└──────────────────────────────────────────────────┘
```

Recovery banner (finding L10), shown under the terminal when the shell failed to start:

```
│ ⓘ This container may not include a shell.        │
│   Start a debug container to get one.            │
│                       [Debug container…]         │
```

Debug session status strip, replacing the toolbar row while a debug container is being brought up:

```
 ✓ Added   ● Waiting for container…  ○ Connecting  ○ Attached
 debugger-x7k2p · busybox · pulling image (12s)           [Stop waiting]
```

"Stop waiting" only leaves the strip; the container keeps going. The copy says so (section 5).

Attached:

```
 [debug] debugger-x7k2p · busybox · target: app · attached     [Detach]
 Type exit to end it. Closing this tab detaches and leaves it running.
```

Detached, exited and rejected states are cards with text, icon and one or two actions (section 5, states table in section 4).

---

## 4. States

Legend: **n/a** carries a reason. Terms follow STATE-VOCAB.

### 4.1 Logs (single and multi)

| State | Single pod | Multi pod |
|---|---|---|
| Loading (initial) | Skeleton rows; strip "Loading logs..." | Same; strip "Loading logs from N pods..." |
| Reloading (Source changed) | Buffer cleared. Strip: "Reloading from the last 15 minutes..." The Source group shows a spinner. View filters keep their values. | Same, per pod count: "Reloading 12 pods from the last 15 minutes..." |
| Following | Strip: "Following" with a dot and the word; not a dot alone | Same |
| Paused (scrolled up) | Pill at bottom: "Paused. 24 new lines. Jump to latest" | Same |
| Nothing here, no filter | "No log lines in the last 15 minutes." Actions: "Widen to 1 hour", "All retained" | "No log lines from these 12 pods in the last 15 minutes." Same actions |
| Nothing here, filtered | "No lines match. 4,988 of 5,000 loaded lines are hidden by filters." Action: "Clear filters" | Same |
| Cap reached | Strip: "Showing the most recent 5,000 lines. 1,204 older lines were dropped." | Same |
| Error: start failed | Block with the server text verbatim and "Retry". Plain line, e.g. "Container "app" hasn't started yet. Logs appear once it runs." (when the message says waiting) | Per pod; see Partial |
| Error: stream ended | Strip: "Stream ended. The container stopped or the connection dropped." Actions: "Reconnect" | Per pod |
| Previous: none found | Existing: "No previous instance found. The container may not have restarted yet." Keep. | n/a: multi-pod has no previous mode (out of scope; see D-L10) |
| Denied (reading logs) | Server error verbatim plus: "You don't have access to these logs. Your account can't read pods/log in namespace <ns>." No SSAR pre-check for reads. | Same, per pod; if all denied, the whole view shows No access |
| Partially visible | n/a: single pod | Strip: "Tailing 10 of 12 pods. 2 couldn't be tailed." Action: "Show which" expands pod name plus reason |
| Read-only (#29) | n/a: reading is not a write | n/a |
| Not installed | n/a: logs need no CRD | n/a |
| Unreachable | STATE-VOCAB Unreachable: "Can't reach <cluster label>." Retry. Open streams show "Stream ended". | Same |
| Previous + Range unsupported | Range control disabled, reason "Range doesn't apply to the previous instance." (only if Q-L1 says so) | n/a |

### 4.2 Container pre-selection

| State | Behaviour |
|---|---|
| Failing found | Container chosen, reason hint shown, dropdown marks failing ones in text ("app (crashed)") |
| Annotation found, valid | Chosen; hint "Selected: this pod's default container (annotation)" |
| Annotation names a container that doesn't exist | Ignored silently for selection; hint is not shown. Falls to the first container. |
| Only init containers have data | A failing init container is chosen with `[init]` label and hint "init container "migrate" failed (exit 1)" |
| Pod changes while panel is open | Selection is re-evaluated only when the user has not chosen manually |
| Loading pod status | Selector disabled, text "Loading containers..." |
| Denied / read-only / CRD-absent / unreachable / partial | n/a: pure client-side selection on data already loaded |

### 4.3 Debug container

| State | Where | Presentation |
|---|---|---|
| Idle | Shell tab | Button "Debug container..." enabled |
| Denied (SSAR) | Button | `aria-disabled`, tooltip "You don't have permission to add debug containers. This needs permission to update pods/ephemeralcontainers." Fail open per CLAUDE.md (only an explicit deny greys it). |
| Read-only (#29) | Button, dialog | Disabled, tooltip "Read-only mode (Watchtower guardrail). Turn off in cluster settings." If the dialog is already open when read-only is turned on elsewhere: primary disabled, slot 7 shows the same sentence. |
| Capability missing | Button | Disabled, tooltip "This cluster's API server doesn't support ephemeral containers." (only if the version check says so, Q-L9) |
| Precedence when several apply | | In progress, then read-only, then RBAC, then capability (DISABLE-PRECEDENCE 5.1). One reason shown. |
| In progress | Button | Label "Starting...", spinner; no other tooltip |
| Adding (request in flight) | Dialog phase `running` | "Adding debug container to the pod..." |
| Rejected by PSA or admission | Dialog phase `error` | Slot 5: "The API server rejected this debug container: <message verbatim>". Plain line below: "A Pod Security Admission policy or an admission webhook in this cluster may be blocking it. Try a different image, or ask a cluster admin." Footer: Retry, Close. Nothing was added. |
| Rejected: other (pod gone, forbidden after SSAR passed, invalid) | Dialog phase `error` | Same slot 5 format; plain line "Nothing was added to the pod." |
| Image pull failing | Shell tab strip | "Waiting: ImagePullBackOff. Kubernetes can't pull "busybox:1.36": <kubelet message>" Actions "Choose another image", "Keep waiting". Plain line: "This container stays in the pod's spec, stuck. A new one will be added alongside it." |
| Container waiting (pulling, creating) | Shell tab strip | "Waiting for container (pulling image, 12s)" |
| Connecting | Shell tab strip | "Connecting to debugger-x7k2p..." (shown only if the handshake takes time; Q-L8) |
| Attached | Shell tab | Terminal live, toolbar as 3.9 |
| Detached | Shell tab card | "Detached. debugger-x7k2p is still running in this pod." Actions: Attach, "Start another..." |
| Exited | Shell tab card | "debugger-x7k2p exited (code 0). A debug container can't be restarted." Action "Start new debug container..." |
| Pod deleted or replaced | Shell tab card | "This pod no longer exists. Debug containers go away with the pod." |
| Not installed | n/a: ephemeral containers are core Kubernetes, no CRD. Capability missing is the equivalent (above). |
| Partial | n/a: single pod |
| Unreachable cluster | Dialog phase `error` / Shell card | STATE-VOCAB Unreachable; if the terminal drops: "Connection lost. debugger-x7k2p may still be running. Attach again when the cluster is reachable." |

---

## 5. Microcopy

Conventions: sentence case, straight double quotes around object names, no exclamation marks (COPY-RULES). `<message>` is the text extracted from a rejected `invoke()` (COPY-RULES 9.3).

### 5.1 Toolbar and viewer

| Element | Text |
|---|---|
| Source group label | "Source" with sub-label "Reloads the log" |
| View group label | "View" with sub-label "Filters the lines already loaded" |
| Container select, accessible name | "Container" |
| Range options | "Last 200 lines" (default), "Last 5 minutes", "Last 15 minutes", "Last 1 hour", "Last 6 hours", "Last 24 hours", "All retained", "Custom..." |
| Range tooltip | "Changing the range reloads the log." |
| Custom range | Fields: number + unit (minutes, hours, days). Helper: "Reloads the log from this long ago." Error: "Enter a whole number greater than 0." |
| Timestamps toggle | "Timestamps" |
| Timestamps tooltip | "Turning timestamps on or off reloads the log. Local and UTC only change how they are shown." |
| Zone select | "Local", "UTC" |
| Previous toggle | "previous" (existing). Tooltip: "Show logs from the previous container instance (after a crash or restart)." |
| Include | Label "Include", placeholder "text or regex" |
| Exclude | Label "Exclude", placeholder "text or regex" |
| Highlight | Label "Highlight", placeholder "text or regex" |
| Regex toggle | "regex"; tooltip "Treat Include, Exclude and Highlight as regular expressions." |
| Case toggle | "case"; tooltip "Match case." |
| Invalid regex | Under the field: "Not a valid regular expression. Matching it as plain text." |
| Filters note | "Filters match the raw line, including any JSON." |
| Level chips | "ERROR", "WARN", "INFO", "DEBUG", "no level"; compact: "E", "W", "I", "D", "-"; tooltip "ERROR: 12 lines" |
| JSON toggle | "JSON"; tooltip "Show JSON lines as structured rows. Click a row to expand it." |
| Wrap | "wrap" |
| Count | "37 of 5,000 lines" |
| Honesty note | "Searching the last 5,000 lines." (tooltip at narrow widths) |
| Follow | "Following" / "Paused"; shortcut hint in tooltip "Follow (f)" |
| Jump pill | "Paused. 24 new lines. Jump to latest" |
| Active chips | "exclude: healthcheck", "levels: no DEBUG", "highlight: refused"; each has a remove button named "Remove filter: exclude healthcheck" |
| Clear | "Clear all" |
| Download menu | "All loaded lines (5,000)", "Visible lines (37)" |
| Download note | "Downloads what Watchtower has loaded, not the full log." |
| Reload strip | "Reloading from the last 15 minutes..." |
| Cap strip | "Showing the most recent 5,000 lines. 1,204 older lines were dropped." |

### 5.2 Multi-pod

| Element | Text |
|---|---|
| Pods button | "Pods: 14 of 45 · zone eu-west-1a" (or "Pods: 12") |
| Narrow block heading | "Narrow which pods stream" with "(reloads)" |
| Show/hide block heading | "Show or hide (instant)" |
| Cap notice | See 3.7 table |
| Partial strip | "Tailing 10 of 12 pods. 2 couldn't be tailed." / "Show which" |
| Pod error row | "...9fq7d: <message>" |
| Missing node/zone | "unknown" with tooltip "Watchtower couldn't read this label." |
| Empty | "No pods to tail." with plain line "This workload has no running pods." |

### 5.3 Container pre-selection hints

| Reason | Hint |
|---|---|
| Crashed, terminated | "Selected: last crashed (OOMKilled, exit 137, 3m ago)" |
| Crash looping | "Selected: crash looping (CrashLoopBackOff, 5 restarts)" |
| Image pull | "Selected: can't pull its image (ImagePullBackOff)" |
| Init failed | "Selected: init container "migrate" failed (exit 1)" |
| Annotation | "Selected: this pod's default container (annotation)" |
| Opened on previous | "Showing the previous run: the current one is waiting (CrashLoopBackOff, 5 restarts)." with button "Show current" |
| Override button | "Use "sidecar"" |
| Dropdown suffixes | "app (crashed)", "sidecar (default)", "migrate [init]", "debugger-x7k2p [debug]" |
| Shell, not running | Option text "app (not running)", tooltip "A shell needs a running container." |

### 5.4 Debug container

| Element | Text |
|---|---|
| Shell tab button | "Debug container..." |
| Recovery banner | "This container may not include a shell. Start a debug container to get one." |
| Dialog title | "Start debug container in "<pod>"" |
| Primary button | "Start debug container" |
| Consequence | "Adds an ephemeral container to this pod so you can run tools next to your app. It doesn't restart the pod or its other containers." |
| Permanence | "This can't be undone. Kubernetes doesn't allow removing an ephemeral container: it stays in the pod's spec until the pod is deleted." |
| Controller note | "Pods created later by the owning workload won't have it." (shown when the pod has an owner) |
| Image label / help | "Image" / "The image needs a shell (sh or bash). The node pulls it using the pod's image pull secrets." |
| Image empty | "Enter an image name." |
| Target label / help | "Target container" / "Lets you see this container's processes. Not every container runtime supports it." |
| Target none | "None (don't share a process namespace)" |
| Name label | "Name" with "(generated)" |
| kubectl disclosure | "kubectl equivalent" (collapsed). Content: the `kubectl debug` command for this pod, image and target, with a Copy button. Text only. |
| Running | "Adding debug container to the pod..." / "This can't be stopped once started." |
| Esc during running | "Press Stop to stop. Esc doesn't cancel a running action." Because there is no Stop here, the line is: "This can't be stopped once started. Wait for it to finish." |
| Rejected | "The API server rejected this debug container: <message>" then "A Pod Security Admission policy or an admission webhook in this cluster may be blocking it. Try a different image, or ask a cluster admin." |
| Rejected, other | "The API server rejected this debug container: <message>" then "Nothing was added to the pod." |
| Strip steps | "Added" / "Waiting for container" / "Connecting" / "Attached" |
| Waiting | "Waiting for container (pulling image, 12s)" |
| Pull failing | "Waiting: ImagePullBackOff. Kubernetes can't pull "<image>": <message>" |
| Pull failing note | "This container stays in the pod's spec, stuck. A new one will be added alongside it." |
| Stop waiting | "Stop waiting" with tooltip "The container keeps going. You can attach to it later." |
| Attached | "[debug] debugger-x7k2p · busybox · target: app · attached" |
| Attached note | "Type exit to end it. Closing this tab detaches and leaves it running." |
| Detach | "Detach" |
| Detached | "Detached. debugger-x7k2p is still running in this pod." Buttons "Attach", "Start another..." |
| Exited | "debugger-x7k2p exited (code 0). A debug container can't be restarted." Button "Start new debug container..." |
| Pod gone | "This pod no longer exists. Debug containers go away with the pod." |
| Connection lost | "Connection lost. debugger-x7k2p may still be running. Attach again when the cluster is reachable." |
| Denied tooltip | "You don't have permission to add debug containers. This needs permission to update pods/ephemeralcontainers." |
| Read-only tooltip | "Read-only mode (Watchtower guardrail). Turn off in cluster settings." |
| Capability tooltip | "This cluster's API server doesn't support ephemeral containers." |

Words never used: "node shell", "root access", "safe", "temporary" (a debug container is not temporary from the cluster's point of view), "smart", "auto".

---

## 6. Keyboard and accessibility

### 6.1 Shortcuts, checked against KEYMAP 8.2

| Keys | Action | Scope | Conflict check |
|---|---|---|---|
| `⌘F` | Focus the Include field | Logs tab active, no dialog open | 00 lists `⌘F` as proposed for text views. No existing binding. Not active in the terminal (Shell tab). |
| `Enter` / `Shift+Enter` | Next / previous highlight match | Focus in the Highlight field or the log region | Field-local, no global conflict. |
| `f` | Toggle follow | Focus in the log region only | K1: single letter, only on non-editable focus with no dialog. No conflict with `r`, `/`, `?`. **Proposed addition to 8.2**, tech lead to confirm (K6). |
| `End` | Jump to latest and resume follow | Focus in the log region | Native scroll key. |
| `Esc` | In a toolbar field: clear it if it has text, otherwise move focus to the log region. In a popover: close it. Never closes the detail panel from a toolbar field. | Logs tab | Requires K3 layering (finding L8, Q-L13). |
| `⌘↵` | Primary action of the debug dialog | Dialog `review` | K5: only if the primary is enabled, never while `running`, never past a typed confirm. |
| `Esc` in the debug dialog | Closes in `review`, `error`; does nothing while `running` | Dialog | CONFIRM-ANATOMY 2.5. |
| `Tab` order | See 6.2 | | |

No new global shortcut is used. `/` stays reserved for the TopBar search and is not used by the log toolbar. `r` (refresh) stays inert while focus is in any toolbar field (K2) and in the terminal.

### 6.2 Focus order

1. Container select.
2. Source group: Range, Timestamps toggle, Local/UTC, previous. (Multi: Pods button.)
3. View group: Include, Exclude, Highlight, regex, case, level chips, JSON, wrap. (Compact: Include, Filters button, Follow.)
4. Active filter chips (each removable).
5. Download.
6. Hint row action ("Use ...").
7. Log region (focusable, `tabindex` 0).

Both groups are labelled groups ("Source: changes reload the log", "View: filters the lines already loaded"). Popovers trap focus while open, return focus to their button on close, and are layers in `modalLayer`.

Debug dialog follows A11Y-BASELINE 10.2 (initial focus on the Image field since it is the first required input and the action is non-destructive; focus returns to the Debug container button). After the dialog closes into the Shell tab, focus moves to the status strip heading so the progress is announced in context.

### 6.3 Semantics and announcements

| Item | Rule |
|---|---|
| Log region | Labelled region ("Logs for container app"). Rows are list items with set size and position so a virtualised list reports the right count. `aria-live` is **off** on the region: announcing every streamed line would make it unusable. |
| Streaming status | A separate polite status text announces changes only: "Following", "Paused", "Reloading from the last 15 minutes", "Stream ended", "Cap reached, 1,204 older lines dropped". At most one announcement per 5 seconds (A11Y 10.4). |
| Line accessible text | Time, level word, then message. Multi: time, pod tag, level word, message. Example: "14:02:11, pod xk2lp, error, connection refused". Pod tag text is in the accessible name, so identification never depends on colour. |
| JSON rows | Chevron is a button with `aria-expanded`. Enter or Space toggles. |
| Match navigation | "Match 3 of 17" is announced politely on Enter. |
| Filter changes | The count line is a polite status: "37 of 5,000 lines". Debounced so typing doesn't spam. |
| Level chips | Toggle buttons with `aria-pressed`; accessible name includes the word and count ("ERROR, 12 lines, on"). |
| Disabled debug button | `aria-disabled` plus described-by reason (D1, D2). |
| Debug progress | Strip steps are a list; the current step is announced politely; failures assertively. |
| Reduced motion | The blinking "streaming" dot and spinners follow the existing `prefers-reduced-motion` rule; the text "Following" carries the meaning anyway. |

### 6.4 No colour-only encoding

- Level: glyph + word + role.
- Highlight: mark with background tint **and** an underline; Include's own match mark uses the tint only. They are distinguishable without colour.
- Pod tag: text tail first; colour secondary.
- Failing container: "(crashed)" in text.
- Diff-like states in the debug strip: icon + text ("Waiting", "Attached").
- Identity badge: dot + label text (existing).

---

## 7. Light and dark notes

All references are TOKEN-ROLES; UX-05 assigns values.

| Surface / element | Role |
|---|---|
| Log pane background (today a hard-coded near-black) | Needs a role. 00's list has no "sunken" surface. **Request: `surface-sunken`** for log and terminal backgrounds, so light theme can choose a light-grey rather than inverting. |
| Level text and chips | `log-error`, `log-warn`, `log-info`, `log-debug`, `log-fatal`; chip fill is the same role at low alpha, text is the role. One role each (finding L4). |
| Include match mark | **Request: `log-match`** (tint). |
| Highlight mark | **Request: `log-highlight`** (a second tint plus underline). Both must reach 3:1 against the pane background and keep text at 4.5:1 with the mark behind it, in both themes. |
| Active highlight match (the one Enter is on) | `focus-ring` outline on the mark |
| Timestamps, pod tags | `dim` for timestamp; pod tag uses the six `identity-*`-style hues **only as a secondary cue**. Do not reuse `identity-*` for pod tags: identity colours belong to clusters and a pod tag in `identity-red` reads as "prod". Request a separate small `series-*` role set for tag hues (six). |
| Source/View group hairline | `edge` |
| Group labels | `dim` |
| Hint row | `surface-tint` with `mute` text and an info glyph (not `status-warn`; it is an explanation, not a warning) |
| Cap / reload strip | `surface-tint`, `status-progress` for the spinner |
| Error blocks | `status-bad` icon + text |
| Debug dialog | `surface-overlay`, `edge-strong`, `surface-input` (as TOKEN-ROLES 6.3 maps ConfirmModal) |
| `[debug]` badge | `surface-tint` with `mute` text |
| Terminal background / palette | UX-05 terminal role set; this spec only needs the background to use `surface-sunken` |

Light-theme risks to check in UX-05: `log-warn` on a light pane, the two mark tints on a light pane, and `series-*` hues as small tag text.

---

## 8. Constraint checklist

| Constraint (brief UX-02) | Where satisfied |
|---|---|
| "Since" restarts the stream; filters never do; the difference is visible | 3.1 two labelled groups, Source (reloads) vs View (never); tooltips 5.1; reload strip 4.1. Node/zone narrowing is a Source control (3.7, D-L1). |
| Since window or timestamps toggle clears the buffer and shows a brief reload state | 4.1 "Reloading", 2.1 step 2 and 3. Local/UTC explicitly excluded from reload. |
| Ring buffer drops old lines; say where a user expects full history | 3.1 status line, 4.1 cap strip, 5.1 honesty note and download note; single viewer adopts the cap (D-L5). |
| #3/#4 precedence: failing, annotation, first | 2.3 |
| User sees why a container was pre-selected | Reason hint row, 5.3 |
| One-click override | "Use <other>" button, 2.3 step 3 |
| Init containers use the `init:` prefix bridge | 2.3 failing test covers init containers; labels `[init]`; the bridge is a data detail the frontend already has (restart-history lookup). Section 9 Q-L6 notes ephemeral containers need no bridge. |
| #5 is attach, not exec; image + target; sensible default + free text | 2.4, 3.8 (Image combo, Target select) |
| States listed: denied, rejected (PSA/admission), image pull failing, waiting, attached, detached | 4.3 |
| Persists in the pod spec after detach; say so plainly before confirm | 3.8 slot 3, 5.4 "Permanence" |
| Goes through ConfirmModal with identity badge; read-only blocks it | 3.8 slot 1 and 7; 4.3 Read-only row |
| SSAR gate `update pods/ephemeralcontainers`, disabled with reason, fail open | 4.3 Denied row; Q-L11 |
| Never offer a node shell | 2.4 closing line; 5.4 forbidden words |
| Toolbar wireframes: compact 480, expanded 900 | 3.1, 3.2, 3.7 |
| Since selector and timestamp format incl. local vs UTC | 3.6, 5.1 |
| Node/zone UX and pod-count vs 20-cap | 3.7 |
| JSON: inline expand or whole-view | 3.5, D-L4 |
| Copy for every state | Section 5, state tables in section 4 |
| Keyboard: toolbar focus, next/previous match, follow toggle, checked against 00 keymap | 6.1 |
| Accessibility: virtualised semantics, highlight contrast, pod prefix not colour only | 6.3, 6.4, 7 |
| Reuse `Toggle` chip, `Kbd`, `[init]` label, panel resize, identity badge | Chips keep the existing toggle look (3.4); `[init]` extended to `[debug]` (5.3); resizable panel drives compact/expanded; badge in 3.8 |
| Cross-package: ConfirmModal choke point, `contextLabel`/`contextColor` | 3.8 slot 1, C1 |
| Cross-package: disabled with reason, never hidden | 4.3 |
| Cross-package: permission hints fail open | 4.3 Denied; Q-L11 checks the pod's own namespace so "all" is not an issue |
| Cross-package: read-only is a hint | 5.4 uses the guardrail wording only |
| Cross-package: no AI / "smart" wording | "failing" is a stated deterministic test (2.3); 5.4 forbidden list |
| Cross-package: no new kubectl dependency | kubectl equivalent is text with a copy button (3.8 slot 6) |
| Cross-package: tokens by role | Section 7 |

---

## 9. Open questions for tech lead

Data needs are in plain words. No signature is proposed.

| # | Question |
|---|---|
| Q-L1 | Can the "since" range and the timestamps option apply to **previous-instance** logs too? And when a range and a "last N lines" count are both requested, which wins? The design merges them into one Range control; if both can combine, say so and the control gains a second field. |
| Q-L2 | With timestamps on, what exactly does each line look like on arrival (prefix format and precision)? The viewer must separate the Kubernetes timestamp from any timestamp the app itself wrote. |
| Q-L3 | Can the viewer learn that a stream **failed to start** or **ended**, with the reason text? Today failures are swallowed (L1), so Error and "Stream ended" cannot be shown. For multi-pod the signal must be per pod. |
| Q-L4 | Data need: the pod's **annotations** (at least `kubectl.kubernetes.io/default-container`) on the pod object the panel already holds. Pods carry labels only. |
| Q-L5 | Data need for node/zone filter: per pod its **node name** (exists) and per node its **zone label** (`topology.kubernetes.io/zone`, and the older beta label as fallback). Is the node's label set already in a cached query, or does the multi-pod view need to request it? What should the UI show when a cluster has no zone labels (single-zone, on-prem)? |
| Q-L6 | Data need: ephemeral containers and their **statuses** on the pod (name, image, state, exit code, target) so the Containers tab and selectors can list `[debug]` containers; and a way to tell them apart from regular and init containers. |
| Q-L7 | For starting a debug container: what does the UI get back (name chosen? accepted/rejected?) and how does it learn that the container is **running** vs waiting vs image-pull failing? Poll the pod, or a pushed signal? |
| Q-L8 | Does attach need the same initial columns/rows handshake as the shell? The design only needs to know whether a visible **Connecting** state exists (it appears only if the handshake takes noticeable time). |
| Q-L9 | How does the UI know the **server supports** ephemeral containers (version or discovery)? The design shows a capability tooltip only if this is knowable; otherwise the server's rejection message is the only signal. |
| Q-L10 | Which pod phases reject adding an ephemeral container (Succeeded, Failed, Terminating)? If known, the button can be disabled with a reason; if not, we show the server's rejection. |
| Q-L11 | SSAR gate: `update` on `pods/ephemeralcontainers` is a **subresource**. `usePermissions` today is keyed by kind. Can it check a subresource? The design wants it evaluated against the pod's **own namespace**, which avoids the namespace "all" skip. Fail open stays. |
| Q-L12 | Is list virtualisation in scope for v1.3? The design works without it up to the 5,000-line cap but expanded JSON rows (variable height) are costly to virtualise. If not virtualised, cap expanded JSON rows to a few hundred. |
| Q-L13 | The app Esc handler closes the detail panel on Esc from any non-terminal target (L8). The toolbar behaviour in 6.1 needs Esc inside toolbar fields and popovers to be consumed by them (K3). Confirm this is an app-level change, shared with the YAML editor. |
| Q-L14 | Token requests for 00's TOKEN-ROLES table: `surface-sunken`, `log-match`, `log-highlight`, a six-hue `series-*` set for pod tags (kept apart from `identity-*`). Tech lead updates the table (K6). |
| Q-L15 | Multi-pod backfill: each stream seeds its own recent lines, so on (re)load the first view is N interleaved backlogs. Should the initial backfill be **sorted by timestamp** (needs timestamps on) and live lines then appended in arrival order? The UI copy would say "Initial lines are sorted by time. New lines appear as they arrive." If not feasible, we say "Lines appear in the order they arrive". |
| Q-L16 | Will the debug container always be created interactive (stdin and tty) with a shell as its command? The design assumes yes and gives no command field. |
| Q-L17 | New global shortcut proposal for 8.2: `f` (follow) scoped to the log region. Confirm no conflict and add to the table. `⌘F` is already listed as proposed. |
| Q-L18 | Container order from the backend: are init containers listed before regular ones? If yes, `containers[0]` can be an init container (L7) and the "first non-init" rule matters more. |
| Q-L19 | UX-03 coordination: confirm the debug dialog's slot 7 (read-only) and optional slot 8 (typed confirm from #29 guardrails) are filled by UX-03's pattern. Also, whether read-only mode blocks the plain Shell tab is UX-03's open question; this spec leaves it untouched. |

---

## 10. Decisions, with recommendations

Items marked **needs user decision** change behaviour or scope. The rest are design calls I have made, listed so they can be challenged.

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| D-L1 | **Needs user decision.** Node/zone narrowing: (A) a view filter over the pods already streaming, or (B) a Source control that chooses which pods stream (up to the 20 cap)? | **B**, with show/hide per pod kept as a separate instant view filter | With A and 45 pods, "zone a" would filter an arbitrary 20-pod subset and report a wrong answer without saying so. B costs one reload, which the Source label already communicates. It is the only filter that changes the pod set. |
| D-L2 | **Needs user decision.** When the failing container's current instance is waiting, open Logs on **previous** automatically? | **Yes**, with the visible reason hint and "Show current" | Otherwise the most common crash workflow opens on an empty log. Risk is surprise; the hint removes it. |
| D-L3 | Timestamps default | Off in single-pod (matches today), **on** in multi-pod | Multi-pod without times can't be correlated. Remembered per viewer type. |
| D-L4 | JSON view | Per-line expand **plus** toggle for structured summary | Keeps raw access and makes JSON-heavy logs readable. |
| D-L5 | **Needs user decision.** Give the single-pod viewer the same 5,000-line cap? | **Yes** | Today it is unbounded (L2), and the "last 5,000 lines" honesty copy must be true in both. |
| D-L6 | Debug image default | Last image used, else a small shell image; list also offers a network-tools image; no Settings entry in v1.3 (Settings ships Diagnostics only) | Settings can't host a default until UX-05; a remembered choice needs no new surface. |
| D-L7 | Which 20 pods stream when over the cap | Not-ready or restarted first, then by name | Deterministic and explainable; stops the failing pod being the 21st. |
| D-L8 | **Needs user decision.** PSA rejection: offer a one-click retry with restricted-profile settings (non-root, no privilege escalation, dropped capabilities)? | **Defer**; v1.3 shows the verbatim rejection and plain line only | It needs a user ID that works for the chosen image, which grows the form. Many shell images run as root. Revisit after real PSA reports. |
| D-L9 | Debug entry points | Shell tab button plus the shell-failure banner. No pod-header or palette entry. | The need arises on the Shell tab. More entries multiply the places that must handle read-only and SSAR. |
| D-L10 | Previous-instance in multi-pod | Out of scope | Previous is per container instance, not per workload; adds N error cases. |
| D-L11 | Include/Exclude/Highlight share one regex toggle and one case toggle | Yes | Per-field toggles triple the controls on a 480 px bar. Limit: cannot mix a regex include with a plain exclude. Acceptable. |
| D-L12 | Rename "filter..." to "Include" | Yes | With Exclude and Highlight present, "filter" is ambiguous. |
