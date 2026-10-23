import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Copy, Check, Info } from "lucide-react";
import { setAppearance, useAppearance, type Accent, type ThemePref } from "../utils/appearance";
import { CLUSTER_COLOR_CLASSES } from "../utils/clusterIdentity";
import { useAppUpdate, useCliStatus, useInstallCliCommand, useLogSettings, useOpenLogFolder, useSetLogLevel } from "../hooks/useResources";
import type { AppLogLevel } from "../types/k8s";
import { DEBUG_NOTE, NO_LOG_FILE_REASON, retentionLine } from "../utils/diagnostics";
import { PRODUCT_NAME } from "../brand";
import { CLI_STATUS_FAILED, CLI_TRY_IT, cliView } from "../utils/cliStatus";
import {
  announceText, ariaStep, checkDisabledReason, formatBytes, formatChecked, lastResult, percent, type UpdateState,
} from "../utils/updateState";

// Settings shell (docs/ux/00 §7.1) with the Diagnostics section (§7.2, 03 §13.3).
// A VIEW in the main content area, not a modal and not a ResourceType: Esc does not leave
// it. v1.4.2 ships Diagnostics and Appearance; sections that have not shipped are absent (not disabled,
// not "coming soon"), so the shell does not change shape when they arrive.

export type SettingsSection = "diagnostics" | "appearance" | "updates" | "command-line";
const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "diagnostics", label: "Diagnostics" },
  { id: "appearance", label: "Appearance" },
  { id: "updates", label: "Updates" },
  { id: "command-line", label: "Command line" },
];

const LEVELS: { id: AppLogLevel; label: string }[] = [
  { id: "error", label: "Error" },
  { id: "warn", label: "Warn" },
  { id: "info", label: "Info" },
  { id: "debug", label: "Debug" },
  { id: "trace", label: "Trace" },
];

function Diagnostics({ onOpenSwitcher }: { onOpenSwitcher: () => void }) {
  const { data, isLoading, isError } = useLogSettings();
  const setLevel = useSetLogLevel();
  const openFolder = useOpenLogFolder();
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState("");

  const level = setLevel.data?.level ?? data?.level;
  const settings = setLevel.data ?? data;
  const noFile = !!settings && !settings.file_exists;

  const copyPath = () => {
    if (!settings) return;
    void navigator.clipboard.writeText(settings.log_file).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const open = async () => {
    setOpenError("");
    try {
      await openFolder.mutateAsync();
    } catch {
      setOpenError(`Couldn't open the folder. The log file is at ${settings?.log_file ?? "its default location"}.`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-hidden>
        {[0, 1, 2].map((i) => <div key={i} className="h-8 rounded-sm bg-surface-tint/5 motion-safe:animate-pulse max-w-md" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-[640px]">
      <section className="flex flex-col gap-1.5">
        <label htmlFor="log-level" className="text-[12px] font-medium text-ink">Log level</label>
        <select
          id="log-level"
          value={level ?? ""}
          onChange={(e) => setLevel.mutate(e.target.value as AppLogLevel)}
          disabled={setLevel.isPending}
          className="h-8 w-48 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[12.5px] text-ink focus:outline-hidden focus:ring-accent/40"
        >
          {!level && <option value="">Unknown</option>}
          {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <p className="text-[11.5px] text-dim">
          Controls how much detail {PRODUCT_NAME} writes to its log file. Use Debug when reproducing a problem. Changes apply immediately.
        </p>
        {(level === "debug" || level === "trace") && <p className="text-[11.5px] text-mute">{DEBUG_NOTE}</p>}
        {isError && <p className="text-[11.5px] text-warn">Couldn't read the current log level. Changing it will still apply.</p>}
        {setLevel.isError && (
          <p role="alert" className="text-[11.5px] text-bad">{(setLevel.error as any)?.message ?? String(setLevel.error)}</p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium text-ink">Log file</div>
        <div className="flex items-center gap-2">
          <code className="mono text-[11.5px] text-mute break-all min-w-0 flex-1 select-text">{settings?.log_file ?? "—"}</code>
          <button
            type="button"
            onClick={copyPath}
            disabled={!settings}
            className="shrink-0 h-7 px-2.5 rounded-md ring-1 ring-edge text-[11.5px] text-mute hover:text-ink flex items-center gap-1.5 disabled:opacity-40"
          >
            {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />} {copied ? "Copied" : "Copy path"}
          </button>
        </div>
        {settings && <p className="text-[11px] text-dim">{retentionLine(settings)}</p>}
        <div>
          <button
            type="button"
            onClick={() => { if (noFile) return; void open(); }}
            aria-disabled={noFile || undefined}
            aria-describedby={noFile ? "log-folder-reason" : undefined}
            title={noFile ? NO_LOG_FILE_REASON : undefined}
            className={`h-7 px-3 rounded-md ring-1 ring-edge text-[11.5px] text-ink hover:bg-surface-tint/4 ${noFile ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            Open log folder
          </button>
          {noFile && <span id="log-folder-reason" className="ml-2 text-[11px] text-dim">{NO_LOG_FILE_REASON}</span>}
        </div>
        {openError && <p role="alert" className="text-[11.5px] text-bad">{openError}</p>}
      </section>

      <aside className="flex items-start gap-2 rounded-lg bg-surface-tint/3 ring-1 ring-edge px-3 py-2.5 text-[11.5px] text-mute">
        <Info size={13} className="shrink-0 mt-0.5" aria-hidden />
        <div className="flex flex-col gap-1">
          <p>Logs stay on this machine. {PRODUCT_NAME} never uploads logs.</p>
          <p>Tokens and credentials are removed before anything is written, including output from cluster authentication plugins.</p>
          <p>Write actions are logged by resource name. For Secrets, only key names are logged, never values.</p>
        </div>
      </aside>

      <p className="text-[11.5px] text-dim">
        Per-cluster settings (colour, label, read-only) live in the{" "}
        <button type="button" onClick={onOpenSwitcher} className="text-accent hover:underline">cluster switcher</button>.
      </p>
    </div>
  );
}

const THEME_OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
// Literal class strings (Tailwind scans source); the swatch shows each accent's own value for the current theme.
const ACCENT_OPTIONS: { id: Accent; label: string; swatch: string }[] = [
  { id: "blue", label: "Blue", swatch: "bg-swatch-blue" },
  { id: "teal", label: "Teal", swatch: "bg-swatch-teal" },
  { id: "violet", label: "Violet", swatch: "bg-swatch-violet" },
  { id: "amber", label: "Amber", swatch: "bg-swatch-amber" },
  { id: "rose", label: "Rose", swatch: "bg-swatch-rose" },
  { id: "slate", label: "Slate", swatch: "bg-swatch-slate" },
];
const FOCUS = "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/70";

function Appearance() {
  const a = useAppearance();
  const chip = CLUSTER_COLOR_CLASSES["identity-blue"];
  return (
    <div className="flex flex-col gap-6 max-w-[640px]">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[12px] font-medium text-ink mb-1.5">Theme</legend>
        <div className="flex flex-col min-[720px]:flex-row gap-2 min-[720px]:gap-6">
          {THEME_OPTIONS.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-[12.5px] text-ink cursor-pointer min-h-6">
              <input
                type="radio" name="theme" value={o.id} checked={a.theme === o.id}
                onChange={() => setAppearance({ theme: o.id })}
                className="accent-accent focus-visible:ring-2 focus-visible:ring-accent/70"
              />
              {o.label}
            </label>
          ))}
        </div>
        {a.theme === "system" && (
          <p aria-live="polite" className="text-[11.5px] text-mute">Currently {a.resolved === "dark" ? "Dark" : "Light"}</p>
        )}
        <p className="text-[11.5px] text-mute">System follows your operating system and changes when it does.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[12px] font-medium text-ink mb-1.5">Accent colour</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-3">
          {ACCENT_OPTIONS.map((o) => {
            const on = a.accent === o.id;
            return (
              <label key={o.id} className="relative flex flex-col items-center gap-1 cursor-pointer min-w-[44px]">
                <input
                  type="radio" name="accent" value={o.id} checked={on}
                  onChange={() => setAppearance({ accent: o.id })}
                  className="peer sr-only"
                />
                <span aria-hidden className={`h-8 w-8 flex items-center justify-center rounded-full ${o.swatch} ${on ? "ring-2 ring-offset-2 ring-offset-surface-panel ring-ink" : ""} ${FOCUS}`}>
                  {on && <Check size={14} className="text-on-accent" />}
                </span>
                <span className={`text-[11.5px] ${on ? "text-ink font-medium" : "text-mute"}`}>{o.label}</span>
              </label>
            );
          })}
        </div>
        <p className="text-[11.5px] text-mute">
          Used for buttons, links, selected tabs and focus rings. Cluster colours, status colours and charts do not change.
        </p>
      </fieldset>

      <section className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium text-ink">Preview</div>
        <div {...{ inert: "" }} aria-hidden className="rounded-lg bg-card/70 ring-1 ring-edge p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className="px-3 py-1 rounded-lg bg-accent text-on-accent font-medium">Merge</span>
            <span className="px-3 py-1 rounded-lg ring-1 ring-edge text-ink">Cancel</span>
            <span className="text-accent">Open in YAML</span>
            <span className="px-2 py-0.5 rounded-md bg-accent/12 text-ink ring-1 ring-accent/25">Logs</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2 py-[3px] rounded-md bg-ok/10 text-ok ring-1 ring-ok/30">✓ Running</span>
            <span className="px-2 py-[3px] rounded-md bg-warn/10 text-warn ring-1 ring-warn/30">▲ Pending</span>
            <span className="px-2 py-[3px] rounded-md bg-bad/10 text-bad ring-1 ring-bad/30">✕ Failed</span>
            <span className="px-2 py-[3px] rounded-md bg-status-progress/10 text-status-progress ring-1 ring-status-progress/30">↻ Progressing</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm ring-1 ${chip.chipBg} ${chip.chipRing}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />
              <span className={`mono ${chip.text}`}>my-cluster</span>
            </span>
            <span className="text-mute">Cluster colour. It does not change with the accent.</span>
          </div>
        </div>
        <p className="text-[11px] text-mute">Saved on this computer only.</p>
        {a.saveFailed && (
          <p role="status" className="text-[11.5px] text-warn">Couldn't save this choice. It applies until you close {PRODUCT_NAME}.</p>
        )}
      </section>
    </div>
  );
}

const BTN = "h-7 px-3 rounded-md ring-1 ring-edge text-[11.5px] text-ink hover:bg-surface-tint/4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 w-full min-[720px]:w-auto";
const BTN_PRIMARY = "h-7 px-3 rounded-md bg-accent text-on-accent text-[11.5px] font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 w-full min-[720px]:w-auto";
const LINK = "text-accent hover:underline text-left self-start text-[11.5px] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm";

// Settings → Updates (docs/ux/05 §9). State and plugin calls: useAppUpdate; model: utils/updateState.ts.
// Module-level so a remount of the section does not re-take focus for a request already handled.
let handledFocus = 0;
function Updates({ focusRequest }: { focusRequest: number }) {
  const u = useAppUpdate();
  const { state, inAppInstall } = u;
  const [version, setVersion] = useState("");
  const [announce, setAnnounce] = useState("");
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);
  useEffect(() => {
    if (focusRequest > handledFocus) { handledFocus = focusRequest; rootRef.current?.querySelector<HTMLElement>("[data-update-primary]")?.focus(); }
  }, [focusRequest]);
  useEffect(() => { if (state.s !== "ready") setConfirming(false); }, [state.s]);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (returnFocus.current) { returnFocus.current = false; restartRef.current?.focus(); }
  }, [confirming]);

  // Only user-started actions write the live region; automatic checks never do.
  const act = (fn: () => Promise<UpdateState>, focusStatus = false) => {
    setAnnounce("");
    const p = fn();
    if (focusStatus) statusRef.current?.focus(); // the pressed button is about to disappear
    void p.then((s) => setAnnounce(announceText(s, u.lastChecked, Date.now())));
  };
  const closeConfirm = () => { returnFocus.current = true; setConfirming(false); };

  const unavailable = state.s === "unavailable";
  const reason = checkDisabledReason(state);
  const checkBlocked = reason !== null;
  const reasonId = unavailable ? "upd-status" : "upd-check-reason";
  const now = Date.now();

  let primary: React.ReactNode = null;
  let showCheck = true;
  if (state.s === "available") {
    primary = inAppInstall
      ? <button type="button" data-update-primary onClick={() => act(u.download, true)} className={BTN_PRIMARY}>Download update</button>
      : <button type="button" data-update-primary onClick={u.openReleasePage} className={BTN_PRIMARY}>Download</button>;
  } else if (state.s === "ready" && inAppInstall) {
    showCheck = false;
    primary = <button type="button" ref={restartRef} data-update-primary onClick={() => setConfirming(true)} className={BTN_PRIMARY}>Restart to update</button>;
  } else if (state.s === "failed") {
    showCheck = false;
    primary = <button type="button" data-update-primary onClick={() => act(state.phase === "check" ? u.checkNow : u.download, state.phase !== "check")} className={BTN_PRIMARY}>Try again</button>;
  } else if (state.s === "installing" || state.s === "installed" || state.s === "ready") showCheck = false;

  let status: React.ReactNode;
  switch (state.s) {
    case "unavailable": status = <span className="text-mute">Updates aren't available in this build.</span>; break;
    case "idle": status = <span>Not checked yet.</span>; break;
    case "checking": status = <span className="text-status-progress"><span aria-hidden className="inline-block motion-safe:animate-spin">↻</span> Checking for updates...</span>; break;
    case "up-to-date": status = <span className="text-ok">✓ You're up to date. Last checked {formatChecked(state.checkedAt, now)}.</span>; break;
    case "available":
      status = (
        <>
          <span className="text-status-progress">↻ Version {state.version} is available.</span>
          <button type="button" onClick={u.openReleasePage} className={LINK}>Release notes ↗</button>
          {!inAppInstall && <span className="text-mute">Install it with your package manager.</span>}
        </>
      );
      break;
    case "downloading": {
      const pct = percent(state.received, state.total);
      status = (
        <>
          <span className="text-status-progress">Downloading {state.version}</span>
          <div className="flex items-center gap-2">
            <div
              role="progressbar" aria-label={`Downloading ${state.version}`} aria-valuemin={0} aria-valuemax={100}
              {...(pct !== null ? { "aria-valuenow": ariaStep(pct) } : {})}
              className="h-1.5 flex-1 max-w-xs rounded-full bg-surface-tint/8 overflow-hidden"
            >
              <div className={`h-full bg-status-progress ${pct === null ? "w-1/3 motion-safe:animate-pulse" : ""}`} style={pct !== null ? { width: `${pct}%` } : undefined} />
            </div>
            <span className="mono text-[11.5px] text-mute">{pct !== null ? `${pct}%` : formatBytes(state.received)}</span>
          </div>
          <span className="text-[11.5px] text-mute">You can keep using {PRODUCT_NAME} while this downloads.</span>
        </>
      );
      break;
    }
    case "ready": status = <span className="text-ok">✓ {state.version} is downloaded and ready to install.</span>; break;
    case "installed": status = <span className="text-ok">✓ Installed {state.version}. Quit and reopen {PRODUCT_NAME} to finish.</span>; break;
    case "installing": status = <span className="text-status-progress">Installing {state.version}...</span>; break;
    case "failed":
      status = state.phase === "check" ? (
        <>
          <span className="text-warn" title={state.message}>▲ Couldn't check for updates. {lastResult(u.lastChecked, now)}</span>
          <button type="button" onClick={u.openReleasePage} className={LINK}>Releases on GitHub ↗</button>
        </>
      ) : (
        <>
          <span className="text-bad">✕ Couldn't {state.phase} {state.version}.{state.phase === "install" ? " Nothing was changed." : ""}</span>
          <span className="select-text wrap-break-word line-clamp-3 text-mute" title={state.message}>{state.message}</span>
          <button type="button" onClick={u.openReleasePage} className={LINK}>Download from GitHub ↗</button>
        </>
      );
      break;
  }

  const target = state.s === "ready" ? state.version : null;
  return (
    <div ref={rootRef} className="flex flex-col gap-6 max-w-[640px]">
      <section className="flex flex-col gap-2">
        <div className="text-[12px] font-medium text-ink">{PRODUCT_NAME} {version}</div>
        <div id="upd-status" ref={statusRef} tabIndex={-1} className="flex flex-col gap-1 text-[12.5px] focus:outline-hidden">{status}</div>
        {confirming && state.s === "ready" ? (
          <div role="group" aria-label="Confirm restart" className="flex flex-col gap-2" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeConfirm(); } }}>
            <p className="text-[12px] text-ink">{PRODUCT_NAME} will restart to finish installing {target}. Open shells, log streams and port-forwards end.</p>
            <div className="flex flex-col min-[720px]:flex-row gap-2">
              <button type="button" onClick={() => { setConfirming(false); act(u.restart, true); }} className={BTN_PRIMARY}>Restart now</button>
              <button type="button" ref={cancelRef} onClick={closeConfirm} className={BTN}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col min-[720px]:flex-row gap-2">
            {primary}
            {showCheck && (
              <button
                type="button"
                {...(primary === null ? { "data-update-primary": "" } : {})}
                aria-disabled={checkBlocked || undefined}
                aria-describedby={checkBlocked ? reasonId : undefined}
                onClick={() => { if (!checkBlocked) act(u.checkNow); }}
                className={`${BTN} ${checkBlocked ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                Check for updates
              </button>
            )}
          </div>
        )}
        {checkBlocked && showCheck && !unavailable && !confirming && <p id="upd-check-reason" className="text-[11px] text-mute">{reason}</p>}
        <span role="status" className="sr-only">{announce}</span>
      </section>

      <section className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-[12.5px] text-ink min-h-6 cursor-pointer">
          <input
            type="checkbox" checked={u.autoCheck}
            aria-disabled={unavailable || undefined}
            aria-describedby={unavailable ? "upd-status" : "upd-auto-hint"}
            onChange={(e) => { if (!unavailable) u.setAutoCheck(e.target.checked); }}
            className="accent-accent focus-visible:ring-2 focus-visible:ring-accent/70"
          />
          Check for updates automatically
        </label>
        {!unavailable && (
          <p id="upd-auto-hint" className="text-[11.5px] text-mute">
            {u.autoCheck
              ? "Checks GitHub shortly after launch, then once a day. Only the version is compared; no cluster data is sent."
              : "Automatic checks are off. Use Check for updates when you want one."}
          </p>
        )}
        {u.saveFailed && <p role="status" className="text-[11.5px] text-warn">Couldn't save this choice. It applies until you close {PRODUCT_NAME}.</p>}
      </section>
    </div>
  );
}

// Settings → Command line (docs/ux/13-v2.1.3-preflight.md #7, #8, #10). Status model: utils/cliStatus.ts.
function CopyLine({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <div role="group" aria-labelledby="cli-status" className="flex items-center gap-2">
      <code id="cli-cmd" className="mono text-[11.5px] text-mute break-all min-w-0 flex-1 select-text">{text}</code>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {}); }}
        className="shrink-0 h-7 px-2.5 rounded-md ring-1 ring-edge text-[11.5px] text-mute hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70 flex items-center gap-1.5">
        {copied ? <Check size={11} className="text-ok" aria-hidden /> : <Copy size={11} aria-hidden />} {copied ? "Copied" : label}
      </button>
      <span role="status" className="sr-only">{copied ? "Copied" : ""}</span>
    </div>
  );
}

function CommandLine() {
  const q = useCliStatus();
  const install = useInstallCliCommand();
  const statusRef = useRef<HTMLDivElement>(null);
  const status = install.data ?? q.data;
  const v = status ? cliView(status, !!install.data) : null;
  const installError = install.isError ? ((install.error as any)?.message ?? String(install.error)) : null;
  const run = () => {
    install.mutate(undefined, { onSettled: () => statusRef.current?.focus() }); // the pressed button may disappear
  };
  const tone = v?.tone === "ok" ? "text-ok" : v?.tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="flex flex-col gap-6 max-w-[640px]">
      <section className="flex flex-col gap-2">
        <div id="cli-status" ref={statusRef} tabIndex={-1} className="flex flex-col gap-1 text-[12.5px] focus:outline-hidden">
          {q.isLoading && (
            <div aria-hidden className="flex flex-col gap-1.5">
              <div className="h-3 w-3/4 rounded-sm bg-surface-tint/6" /><div className="h-3 w-1/2 rounded-sm bg-surface-tint/6" />
            </div>
          )}
          {q.isError && !status && <p className="text-warn">{CLI_STATUS_FAILED}</p>}
          {v && (
            <>
              <p className={`wrap-break-word ${tone}`}>{install.isPending ? "Installing..." : v.text}</p>
              {v.helper && <p className="text-[11.5px] text-mute wrap-break-word">{v.helper}</p>}
            </>
          )}
          {installError && <p role="alert" className="text-bad wrap-break-word">{installError}</p>}
        </div>
        <span role="status" className="sr-only">{install.isSuccess && v ? v.text : ""}</span>
        {v?.copy && <CopyLine text={v.copy} label={v.copyLabel} />}
        {v?.action && (
          <div>
            <button type="button" onClick={() => { if (!install.isPending) run(); }} aria-disabled={install.isPending} aria-describedby="cli-status"
              className={`${BTN_PRIMARY} ${install.isPending ? "opacity-50 cursor-not-allowed" : ""}`}>
              {install.isPending ? "Installing..." : v.action}
            </button>
          </div>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <div className="text-[12px] font-medium text-ink">Try it</div>
        {CLI_TRY_IT.map((l) => <code key={l} className="mono text-[11.5px] text-mute break-all select-text">{l}</code>)}
      </section>
    </div>
  );
}

export function SettingsView({
  section, onSectionChange, onOpenSwitcher, focusUpdates = 0,
}: {
  /** Bumped by the palette / Sidebar notice: focus the primary action of Updates (0 = never asked). */
  focusUpdates?: number;
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  onOpenSwitcher: () => void;
}) {
  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-6" role="region" aria-label="Settings">
      <h2 className="text-[16px] font-semibold tracking-tight mb-4">Settings</h2>
      <div className="flex flex-col min-[720px]:flex-row gap-6">
        {/* Below 720px the section list becomes a select above the content. */}
        <select
          aria-label="Settings section"
          value={section}
          onChange={(e) => onSectionChange(e.target.value as SettingsSection)}
          className="min-[720px]:hidden h-8 px-2.5 rounded-md bg-card/80 ring-1 ring-edge text-[12.5px] text-ink"
        >
          {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <nav aria-label="Settings sections" className="hidden min-[720px]:flex flex-col w-40 shrink-0 gap-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSectionChange(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              className={`text-left h-7 px-2.5 rounded-md text-[12.5px] ${section === s.id ? "bg-accent/12 text-ink ring-1 ring-accent/25" : "text-mute hover:bg-surface-tint/4 hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold mb-4">{SECTIONS.find((s) => s.id === section)?.label}</h3>
          {section === "appearance" ? <Appearance /> : section === "updates" ? <Updates focusRequest={focusUpdates} /> : section === "command-line" ? <CommandLine /> : <Diagnostics onOpenSwitcher={onOpenSwitcher} />}
        </div>
      </div>
    </div>
  );
}
