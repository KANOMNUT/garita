# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A Namespaces page.** "Namespaces" is the first item in the sidebar's Cluster section (and in the command palette). It lists every namespace with its status (Active, or Terminating with how long it has been deleting), age and labels, and opens the usual detail panel: Overview, Summary (labels and annotations), Events and YAML, plus Compare and field managers. For a namespace that is stuck in Terminating, the Overview explains what is blocking it (the namespace's own conditions) and points to Events and YAML. **New** and Ctrl/Cmd+N create a namespace here, and the trash button deletes one after you type its name. A deleted namespace usually stays Terminating for a while; the page refreshes every 5 seconds until it is gone. "Show pods in this namespace" in the panel jumps to the Pods list for it.
- **`garita ns` opens the Namespaces page.** On the command line, `ns`, `namespace` and `namespaces` now name the Namespaces page, like `garita nodes`. They used to be ignored. A `-n` namespace given with it is dropped, because the page lists all namespaces.
- **Pods table: sort by CPU and Memory, and a count on every status.** Both columns sort by the number they show (usage when metrics are available, otherwise the request), from the header or the Sort menu ("CPU most first"). Each status button shows how many pods have that status under the current label and search filters. When a status or label filter leaves nothing, the empty state offers "Clear status and label filters".
- **Copy buttons say what happened.** "Copy pod name", the YAML "Copy" and "Copy neat", and the Pods table's "Copy names" switch to "Copied …" for a moment, or to "Couldn't copy" when the clipboard is denied. Screen readers announce the same text.

### Changed

- **The namespace picker in the top bar has a filter.** It opens as a panel with a "Filter namespaces" field (Enter picks the first match), a check mark on the current namespace, a "Terminating" tag on namespaces that are being deleted, and a "Manage namespaces" link to the new page. When your account cannot list namespaces, it says so instead of showing an empty list.
- **The namespace list is gone from the sidebar.** Pick a namespace in the top bar; create and delete namespaces on the Namespaces page. Deleting the namespace the picker was set to resets the picker to "All namespaces".
- **`kube-node-lease` can no longer be deleted from the app,** like `default`, `kube-system` and `kube-public`. Its delete button is dimmed and gives the reason in its tooltip.
- **A list you may not read says so.** When your account is not allowed to list a resource (a 403), every resource list except Pods now shows "You don't have access to …" instead of the raw error text.
- **ArgoCD: the Actions card comes first.** An Application's Overview now opens with Actions (the Prune, Dry run and Force options, Sync, Refresh and Hard Refresh) instead of ending with them below the field list, and the field list gains a **Sync policy** row that reads Automated or Manual.
- **The Pod panel's Overview and Summary tabs are one Summary tab.** They repeated each other (labels twice in two styles, the phase and node three times). Summary is now the first tab and holds Metadata, Conditions, Container States and Labels, followed by the existing Constraints, "Who can reach this pod" and field managers.
- **Pods table: "Copy names" keeps your selection,** so you can copy the names and then delete or restart the same pods.
- **A Running pod that is not ready stands out.** In the Pods table and the panel header the ready count (such as 0/1) turns amber, with "Running but not ready" as its tooltip.
- **The Pod Events tab matches the other panels' Events tab.** It has a Warnings-only filter, an event count, "Warning" or "Normal" written out beside the colour, and a note that Kubernetes keeps events for about an hour.
- **The log toolbar has less chrome.** The "View" heading is gone, and the note about what filters match shows only while a filter is set. Previous and Follow are written in sentence case and report whether they are on.
- **Pod panel text is never smaller than 10.5 px,** and sentences are no longer set in the monospace font (names, ports, numbers and commands still are). Text fields in the port-forward form and the log toolbar have a visible outline, and the focus rings on the Pod panel's buttons and tabs, the Pods table and the log toolbar are strong enough to see in both themes.

### Fixed

- **ArgoCD: the Revision column no longer cuts a chart version, tag or branch to 7 characters.** An Application that tracks a Helm chart version such as `10.11.12` showed `10.11.1`, which also looked like a different version from the History entry. The list and the panel now show the revision in full; only a 40-character commit SHA is shortened to 7. A revision with non-ASCII characters (a tag or branch name) no longer crashes the app.
- **A YAML save refreshes the list at once.** After saving a resource's YAML, its list used to keep the old values until its next refresh. It now refetches straight away.
- **Deleting a namespace works from the keyboard.** The old sidebar trash button was invisible until the pointer hovered it, so Tab skipped it. The row delete buttons in resource lists now appear while any control in the row has focus, they carry names ("Delete namespace payments"), and a delete that is not allowed (read-only mode, no permission, a built-in or already-deleting namespace) shows dimmed with its reason instead of looking enabled.
- **ArgoCD: Health and Sync are no longer folded into one word.** The panel header called an Application "Degraded" in red when it was Healthy but OutOfSync, Progressing, Suspended or Missing, directly above an Overview that said Healthy. The header now shows a Health chip and a Sync chip, and the Overview's operation badge reads "Last operation: …". On the Resources tab the filter chips are two groups, Health and Sync, with a count per status: "Healthy" means Healthy whatever its sync state, Missing is counted apart from Degraded, and Suspended and Unknown get their own chips when a resource has them.
- **ArgoCD: Sync, Refresh and Hard Refresh look disabled in read-only mode and say why.** They used to look active and do nothing. The reason now shows under the buttons, and a pending request no longer takes focus away from the button.
- **ArgoCD: an action's error stays until you start the next one.** An error from Sync or Refresh (an RBAC refusal, "operation already in progress") used to vanish after 6 seconds and was never announced to a screen reader. It now stays, starts with "Couldn't sync <app>:" or "Couldn't refresh <app>:", and is announced; a success clears itself after 4 seconds.
- **The Pod panel shows the same status colour as the Pods table.** A pod in ImagePullBackOff was orange in the table and green in the panel header, and Failed and Unknown were green in the panel. Both now read one list, an unknown status is neutral rather than green, and **Failed** is a filter in the Pods table.
- **Deleting a pod shows why it failed.** The confirm dialog (panel and table row) used to close at once, so a refusal (no permission, read-only mode, a network error) was never seen. It now stays open with the message until the delete succeeds, and its button reads "Delete pod".
- **The Containers tab `logs` link opens that container's logs.** It used to open the log tab on the default container, so the card for a sidecar showed the wrong container.
- **Keyboard: rows open with Tab and Enter.** In the Pods table, in every resource list that opens a panel (Deployments, Services, ArgoCD Applications and the rest) and in the ArgoCD Resources tab, the row's name or kind is now a button, so a keyboard user can open a panel, or jump from a managed resource to the object, without the mouse. Esc closes the panel and focus stays on the row. The per-row pod menu is replaced by a Delete pod button that appears on hover and on keyboard focus, and gives its reason when it is disabled.
- **Keyboard: the ENV, MOUNTS and PROBES sections keep focus.** Opening one used to drop keyboard focus, so you had to Tab from the top again; focus now stays on the header, which also reports whether it is expanded.
- **Icon-only controls have names.** The close buttons, the pod Actions menu, the pod row checkboxes, the port-forward stop button and the panel's Edit and Delete buttons are announced by screen readers.
- **Text contrast in the Pod panel, the resource panels and the ArgoCD Applications list.** Secondary text (field names, dates, "req / lim" lines, log toolbar labels, the Unknown and Suspended badges) and the faded status text on filter chips used a colour below the 4.5:1 minimum in both themes, as did the "no access" and "not installed" messages in resource lists. They now use the readable secondary colour or the full status colour.
- **The Pod panel no longer shows made-up data.** The Service account was always "default", and the Conditions were guessed from the pod's phase, so a Running pod whose readiness probe was failing read "Ready: True" next to a header that said 0/1 ready. Both now come from the pod itself: the real service account and the real conditions with their reasons and messages (the card is hidden when the pod has none).
- **Pods table: CPU and Memory say whether they show usage or a request.** Without metrics the numbers were the request but looked like usage; they now end in "req", and the column tooltip explains it. A pod without a limit is no longer drawn against an invented 500 m / 512 Mi, so it no longer shows a full red bar: the bar uses the limit, or twice the request for usage, or is left out and only the number is shown. The Metrics tab's fallback lists the request and limit the same way.
- **The Shell tab, Exec shell and a container's exec link explain themselves in read-only mode.** Clicking them did nothing. They now open the Shell tab, which says why shells are blocked.
- **The Pod panel's Events and YAML tabs show a load error.** A failed request used to read "No events found" or leave the YAML blank. They now say "Couldn't load …" with the message and a Retry button.
- **The pod Actions menu, and the Pods table Labels and Sort menus, close with Esc without closing the panel.** Esc used to deselect the pod underneath an open menu. Focus returns to the button, and a click elsewhere closes the menu.
- **Screen readers: tab, filter and sort state is announced.** The Pod panel tabs, the status filter, the label chips, the sortable column headers (now buttons, with their sort direction), and the log toolbar's Previous and Follow report which one is selected.
- **The port-forward form has labelled fields and checks the ports.** "Pod port" and "Local port" are labelled, an empty or out-of-range port (not 1 to 65535) is flagged, and Start forward stays disabled with the reason instead of sending a bad value. The Stop button is larger and reads Stop.
- **The pulsing status dot respects "reduce motion".** Pending, CrashLoopBackOff, ImagePullBackOff and Terminating pods, and the log "Following" dot, no longer pulse for people who asked the system for less motion.

## [2.3.1] - 2026-10-27

### Added

- **Map: filter by kind.** Each group chip on the Map page (Workloads, Services & routing, Storage, Config, Scaling & budgets) is a dropdown. It lists that group's kinds with their object counts, so you can hide or show one kind at a time (only Pods, or just ConfigMaps and Secrets), or the whole group with Show all and Hide all. A chip reads "5 of 9" when only some of its kinds are shown, and **Show all kinds** appears while anything is hidden and brings everything back. Nothing is hidden silently: a search says how many matches sit in hidden kinds, and an object's details and the List view say how many of its connections go to a hidden kind. Hiding ReplicaSets keeps large groups of pods collapsed instead of spreading them out. The same filter is offered when a namespace has too many objects to draw. The choice resets when you change cluster or namespace.
- **Find in YAML.** Press Ctrl+F (Cmd+F on macOS) with the cursor in a resource's YAML, a Pod's YAML or a Helm release's Values to open a find bar. Matches are highlighted, "3 of 12" shows where you are, Enter and Shift+Enter go to the next and previous match, and Esc closes the bar. It works while you edit: the matches are highlighted behind the text you type, and closing the bar selects the current match. The search is literal and ignores case. It looks only at the text on screen, so redacted Helm values cannot be matched and a Secret's YAML is searchable only after you reveal it; with Neat on, "Search full object" turns Neat off to search the rest.
- **macOS: install without an administrator password.** On a standard account Garita can live in the `Applications` folder inside your home folder (`~/Applications`), and in-app updates there need no password either; in `/Applications` they ask for an administrator's. The README and the website show the per-user steps, including Homebrew's `HOMEBREW_CASK_OPTS="--appdir=$HOME/Applications"`. From a source checkout, `make mac-install` builds the app and copies it there, and `make mac-app` builds only the signed `.app`.

### Changed

- **macOS builds from source (`make mac`, `make mac-universal`) name the DMG like the release file:** `Garita-macOS-arm64.dmg` and `Garita-macOS-universal.dmg`.

### Fixed

- **ArgoCD: bulk "Select all" and shift-click cover only the rows shown.** With a search typed in the top bar, "Select all" used to pick Applications the table had hidden, and Sync, Refresh and Hard Refresh then acted on them. Select all, shift-click ranges and the bulk actions now use exactly the rows the table shows, in the order it shows them, including after you sort a column.
- **The YAML text can be reached from the keyboard.** The read-only YAML and Helm Values text now takes focus with Tab and scrolls with the arrow keys, and screen readers announce it as a named region.
- **`make mac` no longer fails with `hdiutil: couldn't unmount "diskN" - Resource busy`.** Local builds now bundle only the `.app` and make the DMG from it, so Tauri's Finder-scripted DMG step no longer runs on your Mac.
- **Settings → Command line → Install works on a macOS standard account.** When Garita can't write `/usr/local/bin`, it links the `garita` command into `~/.local/bin` or `~/bin` if that folder is on your `PATH`. Otherwise a standard account now gets a command without `sudo` (into `~/.local/bin`) plus the `PATH` line to add to `~/.zprofile`, instead of a `sudo` line it cannot run. Garita never edits your shell profile. The "temporary location" message now says to move Garita to `/Applications` or `~/Applications`.

## [2.3.0] - 2026-10-23

### Added

- **Observability settings per cluster.** Each cluster can name a Prometheus and a Loki or VictoriaLogs service. Garita reads them only through the Kubernetes API server's service proxy, with the cluster's own credentials and fixed queries; it never connects to them directly. Configure it from the cluster switcher, the Metrics tab, the log viewer or the command palette. **Find services** suggests candidates from the common monitoring namespaces, and **Search all namespaces** looks in every namespace you can read. **Test** checks the draft before you save, and an optional tenant covers a multi-tenant Loki. The settings are stored on this computer only.
- **Metric history.** The pod Metrics tab has a Range control (Now, 1 h, 6 h, 24 h, 7 d) with one chart per container for CPU and memory, a named source, and a fallback to current usage when Prometheus is unavailable or you lack access. The Nodes strip on the overview can show the same ranges as a percent of allocatable; it starts on Now and makes no Prometheus call until you choose a range.
- **Right-sizing hints from the 24 h 95th percentile.** When Prometheus has at least 18 of the last 24 hours of a container's CPU or memory usage, the Containers tab bases that resource's hint on the 95th percentile of the usage, against the container's own request and limit, and says so. Otherwise the session-based hint is unchanged.
- **Log history.** The pod log viewer has a Pod log or History source when a Loki or VictoriaLogs service is configured, with ranges up to 7 days. If the backend fails, the viewer returns to the pod's current log with a Retry.

### Changed

- **Strip buttons.** The "Show which" toggle on the Health pages' partial-visibility strips now has a 24 px target and a visible focus ring.
- **Map lines and labels.** Connections on the map are right-angle lines that run between the boxes, never through one, and lines from different objects turn on separate tracks between columns. A line's label appears only while you point at one of its objects or that object has keyboard focus; labels that say the same thing merge into one ("selects · 7080 → 3000 ×3"), and Esc hides them. The details strip and the List view now include each connection's details, such as ports, paths or `envFrom`.

### Fixed

- **Map: Show only this.** Show only this, and the Map button in a workload or Service panel, now show the object's own chain: what it depends on and what depends on it, from the Ingress to the ConfigMaps and Secrets. A Pod no longer brings in its Deployment's other ReplicaSets or other apps that share a Secret; a Deployment keeps all its ReplicaSets. Before, the map kept everything connected, so in a namespace with one app it did not change. The banner says how many of the connected objects the chain shows, the Graph, the List and the counts show the same objects, and the view zooms to fit the chain.

## [2.2.0] - 2026-10-17

### Added

- **Map (Health → Map).** One namespace as a graph of what is connected to what: ownership, Service and PodDisruptionBudget selectors, Ingress and HTTPRoute backends, Gateway routes, volumes, environment references, PVC binding and autoscaler targets. Each box shows the kind, the name and, except for ConfigMaps and Secrets, the status in words; line style (solid, dashed, dotted) tells the kinds of relation apart, not colour. Filter by kind group, search by name, switch to a List view, and use the details strip to follow a connection with the keyboard. Open on an object jumps to its list, filtered to its name. Pods of one owner collapse into a single "×N" box when there are more than 8; a namespace that still has more than 400 boxes asks you to start from one object or hide kinds. Secrets appear by name only; no values are read. A source the account can't read is named in a "Partially visible" strip, never silently dropped.
- **Show on map.** Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob and Service panels have a header button that opens the map narrowed to what is connected to that object.
- **Network policies (approximation).** A second Map mode that draws which pod groups the standard NetworkPolicy objects in a namespace let send to which others, with "restricted" and "not restricted" for each group. It is an approximation, and says so where you read it: it uses standard NetworkPolicy objects only, so Calico, Cilium and AdminNetworkPolicy rules aren't included; named ports aren't resolved to numbers; node traffic is handled differently by some CNIs; policies in other namespaces aren't read. It is not a connectivity test. Also in ⌘K as "Network policies (approximation)".
- **Who can reach this pod (approximation).** A section in the Pod panel's Summary tab listing the sources and ports the policies allow to reach the pod, with a link to the same view on the map.
- **Timeline tab.** Deployment, StatefulSet, DaemonSet, Helm release and ArgoCD application panels have a Timeline tab after Events that merges events, rollout revisions (Deployments), Helm history, ArgoCD history and the actions you took from this app, newest first. Entries from this app are marked "From this app" and use this computer's clock. It is not an audit log: events are kept by Kubernetes for about an hour, and the tab says so.

### Changed

- **Panel tabs scroll.** A detail panel with many tabs now scrolls its tab strip sideways instead of wrapping, and keeps the selected tab in view.

## [2.1.3] - 2026-10-15

### Added

- **Windows installers.** `Garita-windows-amd64.msi` and `Garita-windows-amd64-setup.exe` are published with each release and add their folder to your PATH so `garita` works in a new terminal (the `.exe` for your user, the `.msi` for all users; if your user PATH is too long to extend safely, Settings → Command line shows the folder to add). They are unsigned, so Windows SmartScreen will warn. A Scoop manifest is published on the project site. On Windows the app shows the update notice; installing from inside the app stays macOS-only.
- **Homebrew** installs the `garita` command with the cask.
- **The `garita` command.** `garita` opens the app; started from a terminal on macOS and Linux it detaches, so closing the terminal doesn't quit it. It takes `--context`, `-n`/`--namespace` and a resource kind (kubectl short names such as `po` and `deploy` work), plus `--help` and `--version`. A second `garita` while Garita is running focuses the open window and forwards its arguments instead of starting another copy. Arguments that are not understood show an "Ignored" line in the app. A request made while a dialog is open waits behind a "Go now" button.
- **Settings → Command line.** Shows whether `garita` is on your PATH. On macOS, "Install the garita command" links `/usr/local/bin/garita` to the app; if that folder isn't writable it shows the command to run instead.

### Changed

- **Tailwind CSS 4.** Build tooling only. Two small visible changes: the ring on result rows in Merge from file now draws (Tailwind 3 dropped it), and the avatar gradient shown with no context selected in the sidebar now blends in oklab. Garita now needs a current system webview: macOS 13.3 or later (on macOS 12, install the latest Safari; untested), Ubuntu 22.04 or later with updates, Windows 10 or later. A webview that predates `color-mix()` shows solid colours where tints were.

### Fixed

- The detail-panel slide-in and fade-in animations now run (they were defined but never played); both stop under reduced motion.

### Security

- Removed the build-time `braces` (Dependabot #5) and `postcss-selector-parser` (#8) advisories by moving to Tailwind CSS 4. Neither package was ever in an installer.

## [2.1.2] - 2026-10-15

### Added

- **Kubeconfig `proxy-url` support.** Clusters behind an `http` proxy (with credentials) or a `socks5`/`socks5h` proxy (no credentials) now connect through it. The context list shows "via proxy" with the proxy host, and the cluster-access banner names the proxy when the cluster can't be reached through it; credentials are never shown.

### Changed

- **A `proxy-url` Garita can't use now fails with a message instead of being silently ignored** (`https` proxies, SOCKS5 with a user name and password, other schemes). Garita's own cluster connections ignore proxy environment variables; Helm keeps honouring them as before.

### Security

- **Credentials are scrubbed from the cluster-access banner, Helm error messages and the app log** (URL user info becomes `<redacted>`).

## [2.1.1] - 2026-10-15

**The first in-app update.** Garita 2.1.0 on macOS installs this version from Settings -> Updates; on Linux it shows the update notice. Otherwise it carries only the fixes below.

### Fixed

- **`THIRD_PARTY_LICENSES` matches what ships.** It listed older versions of `@tanstack/react-query`, `lucide-react` and `vite`.

### Security

- **TLS library updated.** rustls 0.23.46 fixes RUSTSEC-2026-0346, RUSTSEC-2026-0347, RUSTSEC-2026-0348 and RUSTSEC-2026-0349.
- **serde_with 3.21.0** fixes GHSA-7gcf-g7xr-8hxj (pulled in by `tauri-utils`).
- **Fewer unmaintained crates in the app.** kube-rs's unused `runtime` feature is off, so the binary no longer contains `backoff` (RUSTSEC-2025-0012) or `instant` (RUSTSEC-2024-0384). Neither had a known vulnerability.

## [2.1.0] - 2026-10-10

**Updating from 2.0.0 needs one manual install** (the DMG, `brew upgrade --cask garita`, or the `.deb`/`.rpm`). In-app updates start from 2.1.0.

**Known limits.** The update path has not run against a real published release yet. The first real in-app update is 2.1.0 to 2.1.1 (`docs/claude/open-items.md`).

### Added

- **In-app updates on macOS.** Garita checks GitHub shortly after launch and once a day. Settings -> Updates downloads the new version and restarts into it only when you confirm; it never restarts on its own. Only the version is compared; no cluster data is sent. Turn automatic checks off in Settings -> Updates.
- **Update notice on Linux.** The `.deb` and `.rpm` builds show when a new version is out and open its release page. Install it with your package manager as before.
- **Settings: Updates** in the command palette.

### Changed

- **The Homebrew cask is marked `auto_updates`.** A bare `brew upgrade` now skips Garita; `brew upgrade --cask garita` still upgrades it.

### Removed

- **The unused shell plugin** (`tauri-plugin-shell`). The shell tab never used it.

## [2.0.0] - 2026-10-10

**Watchtower is now Garita** (Spanish for a fortress sentry box). Garita is a new app, with a new app identifier (`io.github.kanomnut.garita`), so it installs next to Watchtower 1.x instead of replacing it. Install it, launch it once, then remove `Watchtower.app`. On Linux the `garita` deb and rpm packages replace the `watchtower` package.

**Known limits.** The upgrade path, the bundle names, the new icon and the Pages deploy come from code reading, config checks and unit tests. They have not been checked on a real v1 install or a built bundle yet (`docs/claude/open-items.md`).

### Added

- **Upgrade notice.** On the first launch after upgrading from Watchtower, every cluster starts read-only and a notice says why, what was reset, and that the Read-only chip in the top bar turns it off. It stays until dismissed.
- **LICENSE, NOTICE and THIRD_PARTY_LICENSES ship inside the app.**
- **Landing page on GitHub Pages**, with downloads that always point at the latest release.

### Changed

- **New name, Garita, and a new icon.**
- **Licence: Apache-2.0**, copyright the Garita contributors. Earlier versions said "All rights reserved".
- **What carries over from Watchtower:** your list of kubeconfig files (including pasted imports) and the log level. Your kubeconfig files themselves are never touched.
- **What resets:** cluster colours and labels, typed confirmation, bulk limits, the active cluster, appearance, saved searches, column and panel layouts, and log, YAML and ArgoCD view preferences. Every cluster starts read-only instead, because guardrail settings could not be carried over.
- **Downloads and Homebrew moved to GitHub:** `github.com/KANOMNUT/garita/releases`, and `brew tap KANOMNUT/garita https://github.com/KANOMNUT/garita` then `brew install --cask kanomnut/garita/garita`.
- **ArgoCD sync and rollback are recorded as initiated by `garita`.** Earlier operations in the history still show `watchtower`.
- **The Helm values redaction placeholder is now `<redacted>`.** The old `<redacted by Watchtower>` placeholder is still refused, so a values file saved by 1.x can never be pushed.
- **The app log is `app.log` and the action journal is `journal.jsonl`,** in Garita's log folder. Watchtower's `watchtower.log` and `watchtower-journal.jsonl` stay in Watchtower's log folder.

### Removed

- **The GitLab pipeline and the `watchtower` Homebrew cask.** The old cask gets no more updates.
- **The Linux AppImage download.** It may bundle LGPL system libraries whose notices are not shipped yet. Install the `.deb` or `.rpm`; `make linux-appimage` still builds one from source.

### Security

- **Rust dependencies updated for three advisories.** `rustls` 0.23.45 fixes TLS 1.3 handshake messages being accepted across encryption levels on connections to the cluster API (RUSTSEC-2026-0285). `plist` 1.10.1 moves to `quick-xml` 0.42, which fixes two denial-of-service issues in XML parsing (RUSTSEC-2026-0194, RUSTSEC-2026-0195). `anyhow` 1.0.104 fixes unsoundness in `Error::downcast_mut()` (RUSTSEC-2026-0190).

## [1.4.2] - 2026-10-09

**Known limits.** The light theme, the accents and dark-mode parity come from code reading, compiled-CSS comparison and unit tests. They have not yet been checked on a running build: following the OS, the first paint without a dark flash, and contrast on a real display. Dark mode keeps the v1.4.1 contrast of white text on the blue accent, DEBUG log lines and focus rings. In the light theme, older focus rings are faint with the Blue, Teal and Amber accents.

### Added

- **Light theme.** Settings -> Appearance has a Theme choice of System, Light or Dark. System follows the operating system and switches live when it changes. The choice is stored on this computer only.
- **Accent colour.** Six fixed accents (Blue, Teal, Violet, Amber, Rose, Slate) colour buttons, links, selected tabs, row selection and focus rings. Cluster colours, status colours, charts and terminal colours do not change with it.
- **Settings: Appearance** in the command palette, also found by "theme", "dark", "light", "accent" and "colour".
- **The shell terminal re-themes live** when the theme or accent changes, without restarting the session.

### Changed

- **Cluster identity colours no longer follow the accent.** They are their own colour set, so a production cluster stays the colour you picked. Colours stored by earlier versions are still read, and nothing is migrated.
- **"Progressing" status pills and "Pods running" no longer use the accent colour.** They keep their blue whichever accent is chosen.
- **The tint of native checkboxes and radio buttons follows the accent.**

### Fixed

- **A guardrail toggle no longer rewrites a cluster's stored identity colour.** Colour is written only when you pick one, so a record stays readable by the previous version.
- **The purple init-container chip in the resource detail panel is now styled.** It had no colours in v1.4.1.

## [1.4.1] - 2026-10-09

**Known limits.** Nothing in this release has been verified against a live cluster yet. The Secret reveal and its cache lifetime, the Helm redaction and masked manifests, the journal across a full session, Who can on aggregated ClusterRoles and wildcard rules, the Possibly unused references (CronJob templates, projected volumes, init containers) and the Deprecated APIs scan come from reading the Kubernetes source and unit tests, not from observed behaviour. The deprecation table has not yet been checked against the official Kubernetes deprecation guide, and the page says which Kubernetes version the table covers. Secret values are kept out of the display and out of the webview after a panel closes, but a reveal still sends the whole object to the app while it is open.

### Added

- **Journal.** A Journal entry in the sidebar footer (and the command palette) lists what Watchtower sent from this machine, newest first: time, cluster, verb, object, a one-line summary and Accepted or Failed, with filters for cluster, kind and result, a "Load older" button and the scrubbed error text on failed rows. It records writes and also shell sessions and port-forwards, ignores the Diagnostics log level, keeps up to about 25 MiB, and never records Secret values. It is read only. It hides the namespace picker, New and `Cmd/Ctrl+N`.
- **Who can...** A page under Access Control that answers "which subjects can do this verb on this resource, here?" from Roles, ClusterRoles and their bindings: service accounts, groups and users, the binding and role behind each, wildcard and named-object grants labelled, built-in `system:` subjects collapsed. It always shows its notes, names any source it could not read, and is not a check of your own access. It hides the namespace picker, New and `Cmd/Ctrl+N`.
- **Permissions sections.** On the Summary tab of a ServiceAccount, what its bindings grant, grouped by scope and binding; on a RoleBinding or ClusterRoleBinding, each subject expands to what it can do from all of its bindings; on a Role or ClusterRole, "Bound to" lists the bindings that reference it.
- **Possibly unused.** A Health page that lists ConfigMaps, Secrets, PVCs, PVs, Roles, ClusterRoles, service accounts and workloads scaled to zero that nothing found in the cluster references, with the reason and an Open jump. Every label says "possibly", there is no delete, and a kind whose references could not be read is named as not checked instead of being listed. PVs and ClusterRoles are listed only under All namespaces.
- **Deprecated APIs.** A Health page that checks Helm release manifests and kubectl last-applied annotations against a built-in table of deprecated and removed Kubernetes APIs, showing the status on this cluster, the versions, the replacement and the source, and warning when the cluster is newer than the table.
- **Saved searches.** A bookmark button beside the search box on resource lists saves, picks and removes searches per view (text only, up to 20, with Undo).

### Changed

- **Secret values are hidden until you click Reveal.** The Secret panel shows keys and sizes first, and Reveal needs `get` on Secrets: an account that can only list them sees an error instead of the values. The YAML tab for a Secret waits for Reveal too.
- **Helm values are redacted until "Reveal and edit...".** The plain Edit button is gone; the Values tab shows redacted text read-only, with Reveal values, "Reveal and edit..." and "Add values..." for a release with none. A leftover redaction placeholder blocks Review upgrade.
- **A Helm install dry run no longer prints helm's output.** It reports that the dry run succeeded; errors are unchanged.

### Fixed

- **Unsaved YAML or Helm values from one object no longer carry over when you switch to another.** The edit buffers are cleared on every selection, context or namespace change.
- **The refresh button and `r` no longer act on the previous resource list** while Settings is open.

### Security

- **Secret values no longer travel in list payloads.** Lists carry keys and sizes only. A value is fetched for one object on Reveal, shown only while revealed, and dropped from the app's cache on Hide, on closing the panel and on switching object, context or namespace; Compare drops its own copies when it closes, and mutation results no longer linger after their dialog.
- **Helm values are redacted by the backend** (values under credential-looking keys; other values may still be sensitive), and an upgrade or preview that still contains the redaction placeholder is refused.
- **Secret values in a Helm upgrade's rendered manifest are masked**, and the install dry run no longer returns the rendered manifest.
- **A Secret's `kubectl.kubernetes.io/last-applied-configuration` annotation is masked** in the Metadata tab, in Compare, in the YAML Save preview and in the Merge from file preview.
- **Merge from file masks Secret documents**, both the live and the new value, while keeping each row's changed or unchanged state.

## [1.4.0] - 2026-10-08

**Known limits.** Nothing in this release has been verified against a live cluster yet. The Problems rules, the node capacity totals (native sidecars and pod overhead in particular, against `kubectl describe node`), per-container usage and the webhook and PDB matches in Constraints come from reading the Kubernetes source and unit tests, not from observed behaviour. Right-sizing hints use the last metrics-server samples only.

### Added

- **Health section.** A new HEALTH group at the top of the sidebar (and in the command palette) with two pages. **Problems** runs a fixed set of rules over what Watchtower can read (crash loops, out-of-memory kills, image pulls, failing init containers, unschedulable pods, unavailable workloads, failed Jobs, Services with no ready endpoints, pending volume claims, nodes not ready, expiring certificates and TLS Secrets, containers with no readiness probe) for the namespace picker's scope, with severity cards, a Rule menu, an Evidence disclosure on every finding and a jump to the object. It names any source it could not read and the rules that did not run, says that Kubernetes keeps events for about an hour, and gives no score or grade. **Node capacity** shows each node's CPU and memory requests, limits and current usage against allocatable, the pod count, and the pods without limits; limits over 100% are printed, not clamped.
- **"Why is this unhealthy?"** On the Summary tab of pods, Deployments, StatefulSets, DaemonSets, Jobs, Services and PVCs, a card lists the findings for that object with their evidence, and a "Problem found" chip in the panel header opens it. For these kinds the card always says whether the check is running, found nothing, or could not read a source.
- **Not installed, No access and Nothing here** on the Flux, Gateway API, cert-manager, VolumeSnapshot and ArgoCD views, from a new read-only API-presence check. An absent CRD no longer looks the same as an empty list or a forbidden one.
- **Node requests overlay.** Each node card in the Pods view gains a requests tick on its bars and a `REQ` row, read from the same data as Node capacity. It stays silent if that data cannot be read.
- **Right-sizing hints.** In a pod's Containers tab, a hint appears under a container's bars when its peak usage over the last samples is near its own limit or well under its own request. It needs 10 samples, uses only that container's own request and limit, and never suggests a value.
- **Constraints.** On the Summary tab of pods, Deployments, StatefulSets, DaemonSets, ReplicaSets and Jobs, a section lists the resource quotas, limit ranges, pod disruption budgets, priority class and admission webhooks that apply or may apply, each group with its own loading, empty, no-access and error state. Webhooks are always "may apply".
- **Pool, Zone and Instance type columns** in the Nodes view, hidden until ticked in the column menu.

### Changed

- **NodeStrip turns red at 85%** (it was 80%), the same threshold as the other capacity bars.
- **Node CPU% and MEM% are now shares of allocatable**, not capacity, as `kubectl top node` reports them. The Nodes view and the NodeStrip bars read slightly higher.
- **New and `Cmd/Ctrl+N` are hidden and inert off the resource views** (Health pages and Settings).
- **The namespace picker is hidden on Cluster Roles and Cluster Role Bindings**, which list cluster-wide; it had no effect there.
- **The Pods view "Problem pods" card** links to Problems ("Open Problems") and reads "No CrashLoop or Failed pods" when the count is zero, instead of "All healthy".

### Fixed

- **Memory quantities** in `G`, `k`, `T`, `P` and `E`, binary suffixes up to `Ei`, plain bytes, exponent forms and decimals such as `1.5Gi` now parse in the Pods, workload and Nodes views. There is one parser instead of three.
- **Node requests with native sidecars and pod overhead** now follow the scheduler's rule: init containers with `restartPolicy: Always` count, and overhead is added to a limit only where the pod has one.
- **Same-named pods in different namespaces shared one usage sparkline** when the namespace picker was "all". Usage history is now keyed by namespace.

## [1.3.1] - 2026-10-06

**Known limits.** Field managers are not offered on ArgoCD Applications, whose panel has no Summary tab. Resource Compare is not offered for pods, Helm releases, ApplicationSets or AppProjects. Nothing in this release has been verified against a live cluster yet; the debug container, the dry-run previews, the diffs, eviction permission checks and force-delete in particular come from reading the Kubernetes source, not from observed behaviour.

### Added

- **Ephemeral debug containers.** The Shell tab has a "Debug container..." button that adds an ephemeral container (image and target container picker, a generated name, `kubectl debug` equivalent shown) and attaches to it, so you can get a shell in a pod whose image has none. A status strip follows it from added to attached, and says plainly that an ephemeral container cannot be removed from the pod. If a shell fails to start because the image has none, the tab offers the debug container directly. Debug containers show as `[debug]` in the Containers tab and in the Logs and Shell selectors. Shell sessions now use a client-generated session id and report why they closed.
- **Rollout and resource diffs.** The Deployment rollback confirm shows the pod-template diff against the revision, and each history row has a read-only Compare. A new Compare button on resource panels diffs an object against another namespace or another cluster, ignoring status and server-set fields; Secret values are masked. One diff row renderer is shared by every preview, including Merge from file.
- **Field managers.** A Summary-tab section lists who last wrote each field, from `managedFields`, with search. Read-only.
- **Read-only mode and guardrails, per cluster.** Set in the cluster switcher: read-only mode (every write control is disabled with the reason, and every write command is refused by one backstop), typing the cluster label to confirm writes, and a limit on bulk actions. Pod shells are blocked while read-only is on, and turning it on ends an open shell. It is a guardrail for Watchtower's own buttons, not a security boundary: kubectl and other tools are unaffected.
- **kubectl equivalents on every write dialog**, as text with a copy button (POSIX shell quoting; on Windows, PowerShell quoting by default with a switch to POSIX). Secret values are never included, and Merge from file explains that it has no single kubectl equivalent.
- **Drain can force-delete PDB-blocked pods**, explicitly: a separate Override control, a nested dialog with the node name typed and per-pod checkboxes, counted separately as "force-deleted" and never folded into "evicted". The drain dialog also warns when your account cannot evict pods in a namespace (a hint only, per namespace).
- **Settings and Diagnostics.** A Settings view (gear in the sidebar, `Cmd/Ctrl+,`, or the command palette) with a Diagnostics section: a log file with five rotating files, a log level that applies immediately, the log path, and "Open log folder". Bearer tokens, JWT-shaped tokens and the values of credential keys (`token`, `password`, `client-key-data` and similar) are scrubbed before anything is written; nothing is uploaded.
- **Log view filters.** Include, Exclude and Highlight (with regex and case), level chips with counts, a JSON view with per-line expand, wrap, an active-filter strip, a Download menu (all loaded or visible lines) and a compact Filters popover on narrow panels. Filters match the line text, not the Kubernetes timestamp, and never touch the stream. The multi-pod viewer gains node and zone narrowing, per-pod show and hide, and pod tags with their own colour set.

### Changed

- **Preview before you save or upgrade.** YAML Save is now "Review & save...": the API server dry-runs the same replace and you see exactly what would be stored, including any fields Watchtower's pinned schema would drop (with an acknowledgement and an "Open form" escape). Helm "Upgrade" is now "Review upgrade...": a values diff (values under credential-looking keys such as `password` or `token` masked) and the list of resources the chart renders, marked new, changed, removed or unchanged. A preview that cannot run offers "Save without preview" / "Upgrade without preview" and requires typing the name.
- **Bulk pod delete and restart use the standard confirmation dialog** (Esc, focus trap, kubectl equivalent). Above 10 pods you type the namespace, or the cluster label if the pods span namespaces.

### Fixed

- **Pod shells now start on pods whose name contains a `.`.** The generated session id carried the dot into the shell's event names, which Tauri rejects.
- **A shell session no longer leaks when you leave the tab while it is still starting.** The session is now stopped on unmount even if it was opened a moment later.
- **The bulk pod delete and restart dialog now closes on Esc and traps focus.**
- **The log filter no longer matches the Kubernetes timestamp**, only the line text.
- **Log highlighting no longer breaks on text that contains HTML entities** such as `&lt;` or `&amp;`.

## [1.3.0] - 2026-10-03

### Added

- **Log time range, timestamps and Local/UTC.** Pick the last 200 lines, 5 minutes to 24 hours, up to 5,000 lines, or a custom window; show Kubernetes timestamps (local or UTC, display only); both apply to the previous instance too. Choices are remembered per viewer. In the workload view, pods that are not ready or have restarted are tailed first when over the 20-pod cap, and each line carries the distinguishing tail of its pod name.
- **Neat YAML.** A "Neat" chip on the YAML tab hides managedFields, `last-applied-configuration`, status and other server-set fields. Display only: editing and saving always use the full object.
- **An `update` permission hint on YAML edit and Save**, disabled with a reason when RBAC explicitly denies it. Fails open like every other permission hint.
- **Vitest test harness** (`npm test`), with tests for the edit-form clone-and-mutate transforms and the new log, container-selection and neat helpers.

### Changed

- **Both log viewers keep a 5,000-line buffer**, and say how many older lines were dropped while following. The single-pod viewer previously grew without bound.
- **Levels are detected in JSON and logfmt logs** (`level`, `severity`, `lvl`, `levelname`, `level=`, a leading `[ERROR]`), not just one text shape. The level chips gain a "no level" chip, on by default.
- **Smarter container pre-selection.** The Logs tab opens on the failing container (crash looping, OOM-killed, can't pull its image, failed init container) and says why, with a one-click "Use …" to switch; if its current run is waiting it opens on the previous run. Otherwise it honours the `kubectl.kubernetes.io/default-container` annotation. The Shell tab picks the annotated or first running container and disables containers that are not running.
- **Pod Restart, YAML Save and Helm Values upgrade now ask for confirmation**, each naming the cluster; Restart says it deletes the pod (and that a pod with no controller won't come back). Node delete and namespace delete now require typing the name, and the ArgoCD application delete moved onto the shared dialog.
- **The guided editor and the create dialog show the cluster identity badge**, and the editor's "Apply" is now "Save changes".

### Fixed

- **Deleting a Job left its pods running.** The delete request named no propagation policy, and for `batch/v1` Jobs the API server's default is to orphan dependents. Watchtower now always sends one explicitly (Background, as `kubectl` does). Deployments, StatefulSets, DaemonSets, Jobs, ReplicaSets and CronJobs also get a propagation picker in the delete dialog: Background, Foreground, or Orphan (the button then reads "Delete, keep dependents"). It resets to Background every time the dialog opens.
- **Log stream errors and endings are now shown.** A container that never started used to show "No log lines" and a blinking "streaming…" forever. A failed start shows the server message verbatim with Retry, a dropped stream says so with Reconnect, and the aggregated workload view reports "Tailing k of n pods" with the reason each pod failed.
- **Esc no longer closes the detail panel from a text field**, and a confirmation opened over the editor, creator, Helm install or Merge-from-file dialog closes alone on Esc.
- **Rollback matches `kubectl rollout undo`.** The pod-template-hash label is stripped from the restored template, so the old ReplicaSet is reused instead of a duplicate being created.

## [1.2.1] - 2026-10-03

### Changed

- **Restart, Pause, Resume and Trigger now ask for confirmation**, naming the cluster you are about to act on.

### Removed

- **macOS signing docs are ad-hoc only.** The unused Developer ID and notarization instructions and Makefile branch were removed.

### Fixed

- **Node drain respects PodDisruptionBudgets, and the old fallback is gone.** The previous drain tried an eviction and, if the API refused it, deleted the pod anyway, which bypassed the PDB the eviction exists to honour. Drain now only evicts. It shows a preview first (what will be evicted, which pods a PDB may block, DaemonSet and mirror pods that are skipped, unmanaged pods and `emptyDir` data), reports per-pod progress, and finishes with honest counts: evicted, blocked, already gone and failed. A pod a PDB refuses is reported and left running; drain stops after one pass and offers a manual retry.
- **The Events tab no longer mixes kinds that share a name.** A Deployment and a Service with the same name used to show each other's events; events are now filtered by the involved object's kind as well as its name.
- **ArgoCD rollback restores the source, and no longer truncates the revision.** Rollback is now keyed by history entry and re-syncs the exact revision and source that entry was deployed from, as ArgoCD's own rollback does. It is refused while auto-sync is on. Non-SHA revisions such as Helm chart versions (`10.11.12`) are shown in full instead of being cut to seven characters.
- **Esc no longer closes the detail panel underneath an open dialog**, Esc inside the pod shell belongs to the terminal, and single-letter shortcuts such as `r` no longer fire while you are typing in a field.

## [1.2.0] - 2026-08-26

### Added

- **Import additional kubeconfigs** — by file picker or by pasting YAML, both behind a preview showing which contexts the file defines. Files are registered by path and unioned at read time; they are **never merged into your kubeconfig**, and removing one de-registers it without deleting anything from disk. Contexts show which file defined them and which other files they shadow.
- **Cluster trust states** — an access probe classifies each cluster as reachable, unreachable, expired auth, or forbidden, and says which. A Services list that is forbidden in every namespace now reports the denial instead of returning an empty table that looks like "this cluster has no Services".
- **Cluster identity guard** — per-cluster colour and label, shown on the sidebar chip, in the top bar, and inside every destructive confirmation dialog.
- **Merge from file** — pick or paste a multi-document YAML file, preview which keys each document sets on the live object, dry-run, then merge. Per-document results; one bad document does not abort the batch. Resource plurals are resolved from the cluster's discovery API rather than guessed from the kind name.
- **Aggregated workload logs** — one live tail across up to 20 pods of a workload, colour-tagged per pod.
- **Helm install, history and rollback** — install a chart from a configured repo, browse a release's revisions, roll back to any of them.
- **Permission-aware UI** — actions you lack RBAC for render disabled with the reason rather than failing after you confirm. Batched `SelfSubjectAccessReview`; fails open, so a cluster that cannot answer keeps every action enabled.
- **Six new resource kinds** (37 → 43) — ReplicaSets, Endpoints, EndpointSlices, MutatingWebhookConfigurations, ValidatingWebhookConfigurations, VolumeSnapshots — plus a browsable **Custom Resources** sidebar tree for instances of any installed CRD.

### Changed

- **Watchtower no longer writes to your kubeconfig.** Selecting a cluster in the app used to rewrite `current-context:` in `~/.kube/config` — an in-app choice mutating global `kubectl` state. The active context is now app-local. Two latent bugs went with it: switching to a context defined in a second `$KUBECONFIG` file edited the *first* file, and the line-based rewrite dropped the trailing newline and flattened CRLF on Windows.

### Fixed

- **Single-row pod delete had no confirmation** — it had been documented as confirmed since v0.8.0 but never was.
- **The namespace picker was silently ignored for namespaced custom resources** — both branches of the scope check were identical, so the CRD instance list always queried cluster-wide.
- **`Endpoints` resolved to the plural `endpointss`**, breaking YAML apply and ArgoCD resource lookups for that kind.

## [1.1.0] - 2026-08-25

### Added

- **Guided resource editing** — the detail panel gained a pencil button that opens a guided form for 19 resource kinds (ConfigMaps, Secrets, Deployments/StatefulSets/DaemonSets, Services, Ingresses, Roles and bindings, ServiceAccounts, PVCs, ResourceQuotas, LimitRanges, CronJobs, ArgoCD Applications, and Flux Kustomizations/HelmReleases). Edits are sent as a JSON merge patch built by diffing against the live object, so **fields the form does not model — sidecars, probes, tolerations, injected annotations — are never touched**, which whole-object YAML replacement could not guarantee. A **Patch** tab shows the exact payload before you send it, **Dry run** validates it against the API server, and immutable fields are rendered disabled with the reason instead of quietly omitted.
- **GitOps guard** — editing a resource managed by ArgoCD or Flux shows a warning that the change will be reverted on the next sync. It does not block the edit; drift-then-observe is a legitimate debugging move.
- **System-managed annotations are protected** — `last-applied-configuration`, `tracking-id`, `deployment.kubernetes.io/revision` and the Helm release keys are shown read-only rather than hidden, so an edit cannot silently delete them.
- **Public landing page** — a download page is published to GitLab Pages on each release, linking the Package Registry files that install without a GitLab account.

### Fixed

- **Label and annotation keys were validated against the wrong grammar** — the create forms checked every key against the ConfigMap data-key rule, which rejected legal qualified names like `app.kubernetes.io/name` and blocked Apply. Labels, annotations and data keys now each use their own upstream grammar (annotation keys are case-insensitive, label keys are not).
- **CPU and memory values were silently multiplied by 1000** — resource requests and limits used a digits-only number input, so typing `100m` (100 millicores) submitted `100` (100 whole cores) and the pod never scheduled. They are now Quantity-validated text fields accepting the full `100m` / `128Mi` / `1.5` / `1e9` grammar.

## [1.0.1] - 2026-08-24

### Added

- **Secret type support in the create form** — the Secret form now offers all four types instead of only `Opaque`: `kubernetes.io/tls` (cert/key/optional CA), `kubernetes.io/dockerconfigjson` (registry credentials from friendly fields, with the `auth` value generated client-side as kubectl does), and `kubernetes.io/service-account-token` (ServiceAccount picker, with a note that this is a legacy mechanism — the TokenRequest API is recommended since Kubernetes 1.22). A Secret created as `kubernetes.io/tls` renders immediately in the TLS certificate tab.

## [1.0.0] - 2026-08-24

### Added

- **ArgoCD Lens parity** — new ApplicationSets, Projects, and Repositories views; a 7-bucket health strip (Total / Synced / Healthy / OutOfSync / Degraded / Missing / Progressing) doubling as filter chips; bulk sync/refresh with multi-select; a "Managed by" back-reference linking any managed resource to its owning Application; and prune risk surfaced before you confirm. ArgoCD API group versions are now discovered at runtime instead of hardcoded.
- **TLS certificate tab** — Secrets of type `kubernetes.io/tls` now decode their certificate chain: subject, issuer, SANs, validity window, expiry countdown, serial, signature and key algorithms, SHA-256 fingerprint, and a computed Root CA / Intermediate CA / TLS role badge per certificate. The private key is never read.
- **Context-aware resource creation** — `+New` is now aware of the page you are on. 23 resource kinds have guided forms covering Workloads, Networking, Config & Storage, Access Control, and Namespaces; every kind gets a pre-filled example manifest in YAML mode, and any form can be toggled to YAML at any time. A server-side **Dry run** validates against the API server before you commit.

### Changed

- **Proportional expiry warnings** — certificate urgency is now `min(lifetime/3, 30d)` rather than a fixed threshold, so short-lived certificates (Let's Encrypt 6-day certs are now GA) are not permanently flagged.

### Fixed

- **ArgoCD action correctness** — fixed three bugs that each looked like they worked. **Force** was written to a field that does not exist on ArgoCD's `SyncOperation`, making it a silent no-op. **Revision** was hardcoded to `HEAD`, so apps pinned to a tag were synced to the default branch instead. And a sync issued while another operation was in flight silently discarded its own prune/dryRun/force options. A pre-flight guard now rejects concurrent operations, and prune always asks for confirmation.

## [0.9.3] - 2026-06-05

### Added

- **Universal delete** — every resource page gained a delete action (table row + detail panel header), gated by a confirm modal. Cluster-scoped resources (PV, StorageClass, Node, CRD, ClusterRole, ClusterRoleBinding, PriorityClass) require typing the resource name to confirm. Backed by a single generic `delete_resource` command and a `useDeleteResource` hook.
- **Init container logs** — the pod Containers tab groups init containers under their own section with an `[init]` badge and correct restart history; the log viewer can now stream init-container logs.

### Changed

- **ArgoCD UX redesign** — the Overview, Resources, and Events tabs were reworked for clearer, faster navigation beyond the ArgoCD native UI. Health is still computed locally from each K8s resource's `.status`; Sync and Health remain independent.
- **Helm uninstall** — Helm releases now show "Uninstall" (with a package icon) instead of "Delete", routing through `helm uninstall` rather than a Kubernetes delete.

## [0.9.2] - 2026-06-02

### Fixed

- Fixed context switcher metadata display.

## [0.9.1] - 2026-06-02

### Changed

- Redesigned the probe section in the pod Containers tab for improved readability.

## [0.9.0] - 2026-05-30

### Added

- Container detail accordion (env vars with ConfigMap/Secret navigation, volume mounts, liveness/readiness/startup/gRPC probes), dual-zone CPU/MEM bars, workload pod-template summary, ownership relationship graph, cluster-wide search, Flux v2 and Gateway API support, ResourceQuota / LimitRange / PriorityClass, and confirm-on-destructive actions.
