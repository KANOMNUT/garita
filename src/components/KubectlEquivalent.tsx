import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useKubeContexts, useKubeconfigs } from "../hooks/useResources";
import {
  HONESTY_FOOTER, kubeconfigFootnote, renderCommand, renderCopyText, truncateForDisplay,
  type KubectlEquiv, type ShellKind,
} from "../utils/kubectlEquiv";

// Slot 6 of CONFIRM-ANATOMY (docs/ux/03 §10.2): a collapsed "kubectl equivalent"
// disclosure. Text plus a Copy button — no shell-out, no kubectl dependency.

const OPEN_KEY = "kubectl-equiv-open";
const SHELL_KEY = "kubectl-equiv-shell";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const IS_WINDOWS = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);

export function KubectlEquivalent({ equiv, context }: { equiv: KubectlEquiv; context?: string }) {
  const [open, setOpen] = useState(() => readPref(OPEN_KEY) === "1");
  const [shell, setShell] = useState<ShellKind>(() => {
    const stored = readPref(SHELL_KEY);
    if (stored === "posix" || stored === "powershell") return stored;
    return IS_WINDOWS ? "powershell" : "posix";
  });
  const [copied, setCopied] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const { data: contexts } = useKubeContexts();
  const { data: kubeconfigs } = useKubeconfigs();
  const ctxSource = context ? contexts?.find((c) => c.name === context)?.source : undefined;
  const defaultPath = kubeconfigs?.find((k) => k.source === "default")?.path;
  const kubeNote = context && !equiv.note ? kubeconfigFootnote(context, ctxSource, defaultPath) : null;

  const toggle = () => {
    setOpen((v) => {
      writePref(OPEN_KEY, v ? "0" : "1");
      return !v;
    });
  };
  const pickShell = (s: ShellKind) => {
    setShell(s);
    writePref(SHELL_KEY, s);
  };

  const copyText = equiv.unavailable ? "" : renderCopyText(equiv, shell);
  const onCopy = () => {
    if (!copyText) return;
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const lines = equiv.commands.map((c) => renderCommand(c, shell));
  const long = lines.length === 1 ? truncateForDisplay(lines[0]) : { shown: "", truncated: false };

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-1 text-[11.5px] text-mute hover:text-ink outline-hidden focus-visible:ring-2 focus-visible:ring-accent/60 rounded-sm"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          kubectl equivalent
        </button>
        <div className="flex-1" />
        {open && IS_WINDOWS && !equiv.note && !equiv.unavailable && (
          <div role="group" aria-label="Shell" className="flex items-center rounded-sm ring-1 ring-edge overflow-hidden">
            {(["powershell", "posix"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={shell === s}
                onClick={() => pickShell(s)}
                className={`px-1.5 py-0.5 text-[10.5px] ${shell === s ? "bg-surface-tint/6 text-ink" : "text-dim hover:text-ink"}`}
              >
                {s === "powershell" ? "PowerShell" : "POSIX shell"}
              </button>
            ))}
          </div>
        )}
        {open && !equiv.note && (
          <button
            type="button"
            onClick={onCopy}
            disabled={equiv.unavailable}
            aria-label="Copy kubectl command"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10.5px] text-mute ring-1 ring-edge hover:text-ink disabled:opacity-40"
          >
            {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
            <span className={copied ? "text-ok" : undefined}>{copied ? "Copied" : "Copy"}</span>
          </button>
        )}
        <span role="status" aria-live="polite" className="sr-only">{copied ? "Command copied" : ""}</span>
      </div>

      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {equiv.unavailable ? (
            <p className="text-[11.5px] text-dim">No equivalent available for this action.</p>
          ) : equiv.note ? (
            <p className="text-[11.5px] text-mute">{equiv.note}</p>
          ) : (
            <>
              <div
                role="region"
                aria-label="kubectl equivalent"
                tabIndex={0}
                className="max-h-40 overflow-auto rounded-lg bg-surface-input/80 ring-1 ring-edge px-2.5 py-2 mono text-[11px] leading-[1.6] text-ink select-text whitespace-pre-wrap break-all"
              >
                {lines.length === 1 && !showFull ? long.shown : lines.join("\n")}
              </div>
              {lines.length === 1 && long.truncated && (
                <button
                  type="button"
                  onClick={() => setShowFull((v) => !v)}
                  className="self-start text-[11px] text-accent hover:underline"
                >
                  {showFull ? "Show less" : "Show full command"}
                </button>
              )}
              <p className="text-[11px] text-dim">{HONESTY_FOOTER}</p>
            </>
          )}
          {equiv.footnotes.map((f) => (
            <p key={f} className="text-[11px] text-dim">{f}</p>
          ))}
          {kubeNote && <p className="text-[11px] text-dim">{kubeNote}</p>}
        </div>
      )}
    </div>
  );
}
