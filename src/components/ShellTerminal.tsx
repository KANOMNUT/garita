import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { startShellSession, writeToShell, resizeShell, stopShellSession } from "../hooks/useResources";
import type { Pod, ShellClosed } from "../types/k8s";
import { newSessionId, stripShellPrefix } from "../utils/sessionId";
import { terminalContrast, terminalTheme } from "../utils/terminalTheme";
import { useAppearance } from "../utils/appearance";

interface Props {
  pod: Pod;
  container: string;
  context: string;
  /** "attach" joins a debug container's already-running process; default is exec (v1.3.1). */
  mode?: "exec" | "attach";
  /** The connection is up (the start invoke resolved). */
  onConnected?: () => void;
  /**
   * The session could not start (the invoke rejected). The message is the backend text,
   * verbatim, so the caller can recognise a missing shell (UXP-25).
   */
  onStartFailed?: (message: string) => void;
  /** `shell-closed-{id}`: the output loop ended on its own. Never fired after our own stop. */
  onClosed?: (closed: ShellClosed) => void;
}

export function ShellTerminal({ pod, container, context, mode, onConnected, onStartFailed, onClosed }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | null>(null);
  // Live handle for the theme effect below. The session effect must NOT depend on the theme: it would restart the shell.
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const { resolved, accent } = useAppearance();
  // Latest callbacks, so the session effect does not restart when a parent re-renders.
  const cb = useRef({ onConnected, onStartFailed, onClosed });
  cb.current = { onConnected, onStartFailed, onClosed };

  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  // Live re-theme. xterm 6 ignores in-place mutation of options.theme, so assign a fresh object.
  // accent is a dep because the cursor follows it.
  useEffect(() => {
    const t = xtermRef.current;
    if (!t) return;
    t.options.theme = terminalTheme();
    t.options.minimumContrastRatio = terminalContrast(resolved);
  }, [resolved, accent]);

  useEffect(() => {
    if (!termRef.current) return;

    // C-5: set by the cleanup. A start that resolves AFTER an unmount must stop the session it
    // just opened, or it runs on unseen (auto-attach and a read-only session end both make an
    // unmount mid-start common).
    let cancelled = false;
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let unlistenOut: (() => void) | null = null;
    let unlistenClose: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    // C-4 / RA-1: the id is generated HERE, and both listeners are registered BEFORE the
    // invoke, so a session that prints or closes at once loses nothing. The cleanup stops the
    // pre-generated id too.
    const sessionId = newSessionId();
    sessionRef.current = sessionId;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (cancelled || !termRef.current) return;

      terminal = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "ui-monospace, 'Cascadia Code', monospace",
        theme: terminalTheme(),
        minimumContrastRatio: terminalContrast(resolvedRef.current),
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current);
      fitAddon.fit();
      xtermRef.current = terminal;

      const initialCols = terminal.cols > 0 ? terminal.cols : 80;
      const initialRows = terminal.rows > 0 ? terminal.rows : 24;

      const outFn = await listen<string>(`shell-output-${sessionId}`, (event) => {
        terminal?.write(event.payload);
      });
      const closeFn = await listen<ShellClosed>(`shell-closed-${sessionId}`, (event) => {
        if (!cancelled) cb.current.onClosed?.(event.payload);
      });
      if (cancelled) {
        outFn();
        closeFn();
        return;
      }
      unlistenOut = outFn;
      unlistenClose = closeFn;

      try {
        await startShellSession({
          context,
          namespace: pod.namespace,
          pod: pod.name,
          container,
          initialCols,
          initialRows,
          mode,
          sessionId,
        });
        if (cancelled) {
          // Unmounted while the start was in flight: stop what we just opened.
          stopShellSession(sessionId).catch(() => {});
          return;
        }

        terminal.onData((data) => {
          writeToShell(sessionId, data).catch(() => {});
        });

        terminal.onResize(({ cols, rows }) => {
          resizeShell(sessionId, cols, rows).catch(() => {});
        });

        resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(termRef.current);

        fitAddon.fit();
        resizeShell(sessionId, terminal.cols, terminal.rows).catch(() => {});
        cb.current.onConnected?.();
      } catch (e) {
        if (cancelled) return;
        // Nothing was opened: do not try to stop it on cleanup.
        sessionRef.current = null;
        const message = stripShellPrefix((e as any)?.message ?? String(e));
        terminal.write(`\r\n\x1b[31mFailed to start shell: ${message}\x1b[0m\r\n`);
        cb.current.onStartFailed?.(message);
      }
    };

    void init();

    return () => {
      cancelled = true;
      unlistenOut?.();
      unlistenClose?.();
      resizeObserver?.disconnect();
      if (sessionRef.current) {
        stopShellSession(sessionRef.current).catch(() => {});
        sessionRef.current = null;
      }
      terminal?.dispose();
      xtermRef.current = null;
    };
    // `mode` is part of the session identity: switching exec/attach is a different session.
  }, [pod.name, pod.namespace, container, context, mode]);

  return (
    <div
      ref={termRef}
      className="w-full h-full bg-surface-sunken p-1"
    />
  );
}
