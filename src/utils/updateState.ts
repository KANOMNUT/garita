// App-update state model (v2.1.0 F1). Pure: no plugin, no DOM. The plugin calls and the store
// live in useResources.ts (useAppUpdate). Copy: docs/ux/05 §9.7.

export type UpdatePhase = "check" | "download" | "install";
export type UpdateState =
  | { s: "unavailable" }
  | { s: "idle" }
  | { s: "checking" }
  | { s: "up-to-date"; checkedAt: number }
  | { s: "available"; version: string; notes: string; checkedAt: number }
  | { s: "downloading"; version: string; received: number; total: number | null }
  | { s: "ready"; version: string }
  | { s: "installing"; version: string }
  | { s: "installed"; version: string }                    // install() ok, relaunch() failed: the bundle is swapped
  | { s: "failed"; phase: UpdatePhase; version: string | null; message: string };

export type UpdateEvent =
  | { t: "check-start" }
  | { t: "none"; at: number }
  | { t: "found"; version: string; notes: string; at: number }
  | { t: "check-failed"; message: string; manual: boolean; prev: UpdateState }
  | { t: "download-start"; version: string }
  | { t: "progress"; chunk: number; total?: number | null }
  | { t: "downloaded" }
  | { t: "download-failed"; message: string }
  | { t: "install-start" }
  | { t: "install-failed"; message: string }
  | { t: "relaunch-failed" };

/** "unavailable": dev build. "app": macOS in-app install.
 *  "notice": Linux and Windows, notice + release page only (T21-4, K1). */
export type UpdateMode = "unavailable" | "app" | "notice";
export function updateMode(userAgent: string, dev: boolean): UpdateMode {
  if (dev) return "unavailable";
  return /macintosh|mac os x/i.test(userAgent) ? "app" : "notice";
}

/** Pending version, if the state holds one (drives the Sidebar notice). */
function pendingVersion(s: UpdateState): string | null {
  switch (s.s) {
    case "available": case "downloading": case "ready": case "installing": return s.version;
    case "failed": return s.phase === "check" ? null : s.version;
    default: return null;
  }
}

export function reduce(s: UpdateState, e: UpdateEvent): UpdateState {
  if (s.s === "unavailable") return s;
  switch (e.t) {
    case "check-start":
      return canCheck(s) ? { s: "checking" } : s;
    case "none":
      return s.s === "checking" ? { s: "up-to-date", checkedAt: e.at } : s;
    case "found":
      return s.s === "checking" ? { s: "available", version: e.version, notes: e.notes, checkedAt: e.at } : s;
    case "check-failed":
      // Automatic: silent, back to what was there. Manual: the failed line, unless an update is pending (kept).
      if (s.s !== "checking") return s;
      return e.manual && pendingVersion(e.prev) === null ? { s: "failed", phase: "check", version: null, message: e.message } : e.prev;
    case "download-start":
      return s.s === "available" || (s.s === "failed" && s.phase !== "check" && s.version)
        ? { s: "downloading", version: e.version, received: 0, total: null }
        : s;
    case "progress":
      return s.s === "downloading"
        ? { ...s, received: s.received + e.chunk, total: e.total ?? s.total }
        : s;
    case "downloaded":
      return s.s === "downloading" ? { s: "ready", version: s.version } : s;
    case "download-failed":
      return s.s === "downloading" ? { s: "failed", phase: "download", version: s.version, message: e.message } : s;
    case "install-start":
      return s.s === "ready" ? { s: "installing", version: s.version } : s;
    case "relaunch-failed":
      return s.s === "installing" ? { s: "installed", version: s.version } : s;
    case "install-failed":
      return s.s === "installing" ? { s: "failed", phase: "install", version: s.version, message: e.message } : s;
  }
}

/** Manual check is allowed from every state that is not busy or waiting on a restart. */
export function canCheck(s: UpdateState): boolean {
  return s.s === "idle" || s.s === "up-to-date" || s.s === "available" || s.s === "failed";
}

/** Why the Check button is disabled (null when it is enabled). */
export function checkDisabledReason(s: UpdateState): string | null {
  switch (s.s) {
    case "unavailable": return "Updates aren't available in this build.";
    case "checking": return "A check is already running.";
    case "failed": return canCheck(s) ? null : "Use Try again.";
    case "downloading": return "Downloading. This can't be cancelled.";
    default: return canCheck(s) ? null : s.s === "installing" ? "Installing." : "Restart to finish installing.";
  }
}

/** Sidebar label, or null when no notice is shown. A dismissed version hides it except in `ready`. */
export function noticeLabel(s: UpdateState, dismissed: string | null): string | null {
  const v = pendingVersion(s);
  if (v === null) return null;
  if (s.s !== "ready" && v === dismissed) return null;
  switch (s.s) {
    case "downloading": return "Downloading update";
    case "ready": case "installing": return "Ready to install";
    default: return "Update available";
  }
}

/** Download percent, or null while the total is unknown. */
export function percent(received: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
}
/** aria-valuenow moves in 10% steps. */
export const ariaStep = (p: number): number => Math.floor(p / 10) * 10;

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "today at 14:02", or "on 9 Oct at 14:02". */
export function formatChecked(at: number, now: number): string {
  const d = new Date(at), n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? `today at ${hm}` : `on ${d.getDate()} ${MONTHS[d.getMonth()]} at ${hm}`;
}

/** Text for the visually hidden live region; only user-started actions pass state here. */
export function announceText(s: UpdateState, lastChecked: number | null, now: number): string {
  switch (s.s) {
    case "checking": return "Checking for updates...";
    case "up-to-date": return "You're up to date.";
    case "available": return `Version ${s.version} is available.`;
    case "downloading": return `Downloading ${s.version}`;
    case "ready": return `${s.version} is downloaded and ready to install.`;
    case "installed": return `Installed ${s.version}. Quit and reopen Garita to finish.`;
    case "installing": return `Installing ${s.version}...`;
    case "failed":
      return s.phase === "check"
        ? `Couldn't check for updates. ${lastResult(lastChecked, now)}`
        : `Couldn't ${s.phase} ${s.version}. ${s.message}`;
    default: return "";
  }
}

export function lastResult(lastChecked: number | null, now: number): string {
  return lastChecked === null ? "Last result: never checked." : `Last result: up to date ${formatChecked(lastChecked, now)}.`;
}

// ─── Preferences: localStorage["updates"] ───────────────────────────────────

export const UPDATES_KEY = "updates";
export interface UpdatePrefs { autoCheck: boolean; dismissed: string | null }
export const DEFAULT_PREFS: UpdatePrefs = { autoCheck: true, dismissed: null };

/** Per-field fallback, like parseAppearance: corrupt input never turns the check off by accident. */
export function parsePrefs(raw: string | null): UpdatePrefs {
  let o: unknown;
  try { o = raw ? JSON.parse(raw) : null; } catch { o = null; }
  const r = (typeof o === "object" && o !== null ? o : {}) as Record<string, unknown>;
  return {
    autoCheck: typeof r.autoCheck === "boolean" ? r.autoCheck : DEFAULT_PREFS.autoCheck,
    dismissed: typeof r.dismissed === "string" ? r.dismissed : null,
  };
}
