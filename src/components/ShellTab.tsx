import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Info } from "lucide-react";
import { ShellTerminal } from "./ShellTerminal";
import { disabledAttrs, shellClosedByReadOnly } from "../utils/guardrails";
import { shellOptions } from "../utils/containerSelect";
import {
  detachedText, exitedText, NO_SHELL_BANNER, POD_GONE_TEXT, pullFailingText, STRIP_STEPS, waitingLabel,
  type StripStep,
} from "../utils/debugContainer";
import type { DebugActions, DebugState } from "../hooks/useDebugSession";
import type { Container, Pod } from "../types/k8s";

// The Shell tab body (docs/ux/02 §3.8-3.9, §4.3, §5.4). Presentational: every piece of debug
// session state lives in useDebugSession (held by DetailPanel, UXP-24), because this
// component is remounted on every tab switch.

const BTN = "h-7 px-2.5 rounded-md ring-1 ring-edge text-[11.5px] text-mute hover:text-ink";
const BTN_PRIMARY = "h-7 px-2.5 rounded-md bg-accent/15 ring-1 ring-accent/30 text-[11.5px] text-accent hover:bg-accent/25";

interface ShellTabProps {
  pod: Pod;
  context: string;
  /** Real containers + `[debug]` ones. */
  selectable: { containers: Container[]; containers_status: Pod["containers_status"]; default_container: Pod["default_container"] };
  shellContainer: string;
  onPickContainer: (name: string) => void;
  /** D3-7: set while read-only blocks shells. */
  shellReason: string | undefined;
  clusterLabel: string;
  dbg: DebugState & DebugActions;
  /** UXP-25: the message that explains the missing shell, or null. */
  noShell: string | null;
  onShellFailure: (message: string | null) => void;
}

function Card({ children, actions, tone = "info" }: { children: ReactNode; actions?: ReactNode; tone?: "info" | "bad" }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`m-4 rounded-lg ring-1 px-4 py-3 flex flex-col gap-2.5 ${tone === "bad" ? "ring-bad/30 bg-bad/5" : "ring-edge bg-surface-tint/3"}`}>
      <div className="text-[12.5px] text-ink flex flex-col gap-1">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function Strip({ step, line, extra, action, focusRef }: { step: StripStep; line: string; extra?: string; action?: ReactNode; focusRef?: RefObject<HTMLDivElement> }) {
  const order = STRIP_STEPS.map((s) => s.id);
  const at = order.indexOf(step);
  return (
    <div ref={focusRef} tabIndex={-1} className="px-4 py-2.5 border-b border-edge flex flex-col gap-1.5 shrink-0 focus:outline-hidden">
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]" aria-label="Debug container progress">
        {STRIP_STEPS.map((s, i) => (
          <li key={s.id} aria-current={i === at ? "step" : undefined} className={i < at ? "text-ok" : i === at ? "text-ink" : "text-dim"}>
            <span aria-hidden>{i < at ? "✓" : i === at ? "●" : "○"}</span> {s.label}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 text-[11.5px] text-mute">
        {/* UXA-12: the live text changes only on a step or reason change; the per-second counter is aria-hidden. */}
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 wrap-break-word flex-1">
          <span>{line}</span>
          {extra && <span aria-hidden> {extra}</span>}
        </div>
        {action}
      </div>
    </div>
  );
}

function useElapsedSeconds(since: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

export function ShellTab({
  pod, context, selectable, shellContainer, onPickContainer, shellReason, clusterLabel, dbg, noShell, onShellFailure,
}: ShellTabProps) {
  const { session, mode, card, closed, entryReason } = dbg;
  const seconds = useElapsedSeconds(session?.startedAt, !!session && mode === "strip");
  const options = shellOptions(selectable);
  const stripRef = useRef<HTMLDivElement>(null);

  // UXA-13: once a debug session starts, focus moves to the progress strip so it is announced
  // in context. Two rAFs so ConfirmModal's focus-restore to the opener cannot win the race.
  const sessionName = session?.name;
  useEffect(() => {
    if (!sessionName) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => stripRef.current?.focus()); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [sessionName]);

  // Remember whether a shell was actually open, so the read-only state says "closed" only when
  // something was closed. `shellWasOpen` freezes while read-only is on.
  const [plainOpen, setPlainOpen] = useState(false);
  const shellWasOpen = useRef(false);
  const debugOpen = !!session && mode === "terminal" && dbg.connected;
  if (!shellReason) shellWasOpen.current = plainOpen || debugOpen;
  useEffect(() => { if (shellReason) setPlainOpen(false); }, [shellReason]);

  const toolbar = (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-edge shrink-0">
      <span className="text-[11px] text-dim">Container:</span>
      <select
        aria-label="Container"
        value={shellContainer}
        onChange={(e) => { dbg.clear(); onShellFailure(null); onPickContainer(e.target.value); }}
        className="h-6 px-2 rounded-md bg-base ring-1 ring-edge mono text-[11px] text-ink focus:outline-hidden focus:ring-accent"
      >
        {options.map((o) => <option key={o.name} value={o.name} disabled={o.disabled} title={o.reason}>{o.label}</option>)}
      </select>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => { if (entryReason) return; dbg.openDialog(); }}
        {...disabledAttrs(entryReason)}
        className={`${BTN} ${entryReason ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Debug container…
      </button>
    </div>
  );

  const startAnother = (label: string) => (
    <button type="button" onClick={() => { if (entryReason) return; dbg.openDialog(); }} {...disabledAttrs(entryReason)} className={`${BTN} ${entryReason ? "opacity-50 cursor-not-allowed" : ""}`}>{label}</button>
  );

  let body: ReactNode;
  if (session && (card.kind === "pod-gone" || (mode === "detached" && card.kind === "exited"))) {
    body = card.kind === "pod-gone"
      ? <Card tone="bad">{POD_GONE_TEXT}</Card>
      : <Card actions={startAnother("Start new debug container…")}>{exitedText(session.name, card.kind === "exited" ? card.exitCode : null)}</Card>;
  } else if (shellReason) {
    // D3-7 / §0.5: while read-only is on the terminal is not rendered. Unmounting it already
    // ran ShellTerminal's cleanup (stop_shell_session). A debug container keeps running in the
    // pod because it cannot be removed: the strip says Detached and Attach is disabled.
    body = (
      <>
        {session && (
          <Card actions={<button type="button" {...disabledAttrs(shellReason)} onClick={() => {}} className={`${BTN_PRIMARY} opacity-50 cursor-not-allowed`}>Attach</button>}>
            <span>{detachedText(session.name)}</span>
          </Card>
        )}
        <div className="px-4 py-3 flex flex-col items-start gap-1.5" role="status">
          {shellWasOpen.current && <p className="text-[12.5px] text-ink">{shellClosedByReadOnly(clusterLabel || context)}</p>}
          <p className="text-[11.5px] text-dim">{shellReason}</p>
        </div>
      </>
    );
  } else if (session && mode === "strip") {
    const pulling = card.kind === "pull-failing";
    body = (
      <>
        <Strip
          focusRef={stripRef}
          step={card.kind === "pending" && !dbg.ephemeral ? "added" : "waiting"}
          line={
            pulling && card.kind === "pull-failing"
              ? pullFailingText(card)
              : `${session.name} · ${session.image} · ${waitingLabel(card.kind === "waiting" ? card.reason : null)}`
          }
          extra={pulling ? undefined : `${seconds}s`}
          action={
            <button type="button" onClick={dbg.stopWaitingNow} title="The container keeps going. You can attach to it later." className={BTN}>
              Stop waiting
            </button>
          }
        />
        {pulling && !dbg.keepWaiting && (
          <Card
            actions={
              <>
                {startAnother("Choose another image")}
                <button type="button" onClick={dbg.keepWaitingNow} className={BTN}>Keep waiting</button>
              </>
            }
          >
            <span>This container stays in the pod's spec, stuck. A new one will be added alongside it.</span>
          </Card>
        )}
        {dbg.stopWaiting && (
          <Card actions={<button type="button" onClick={dbg.attach} className={BTN_PRIMARY}>Attach</button>}>
            <span>Stopped waiting. {session.name} is still being added to this pod.</span>
          </Card>
        )}
      </>
    );
  } else if (session && mode === "terminal") {
    body = (
      <div className="flex flex-col h-full min-h-0">
        <Strip
          focusRef={stripRef}
          step={dbg.connected ? "attached" : "connecting"}
          line={`[debug] ${session.name} · ${session.image}${session.target ? ` · target: ${session.target}` : ""} · ${dbg.connected ? "attached" : "connecting"}`}
          action={<button type="button" onClick={dbg.detach} className={BTN}>Detach</button>}
        />
        <p className="px-4 py-1 text-[11px] text-dim shrink-0">Type exit to end it. Closing this tab detaches and leaves it running.</p>
        <div className="flex-1 min-h-0 overflow-hidden">
          <ShellTerminal
            pod={pod}
            container={session.name}
            context={context}
            mode="attach"
            onConnected={dbg.onConnected}
            onClosed={dbg.onClosed}
          />
        </div>
      </div>
    );
  } else if (session && mode === "detached") {
    body = closed?.reason === "error" ? (
      <Card tone="bad" actions={<><button type="button" onClick={dbg.attach} className={BTN_PRIMARY}>Attach</button>{startAnother("Start another…")}</>}>
        <span>Connection lost. {session.name} may still be running. Attach again when the cluster is reachable.</span>
        {closed.message && <span className="mono text-[11px] text-dim wrap-break-word">{closed.message}</span>}
      </Card>
    ) : (
      <Card actions={<><button type="button" onClick={dbg.attach} className={BTN_PRIMARY}>Attach</button>{startAnother("Start another…")}</>}>
        <span>{detachedText(session.name)}</span>
      </Card>
    );
  } else {
    body = (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 min-h-0 overflow-hidden">
          <ShellTerminal
            pod={pod}
            container={shellContainer}
            context={context}
            onConnected={() => setPlainOpen(true)}
            onStartFailed={(m) => { setPlainOpen(false); onShellFailure(m); }}
            onClosed={(c) => { setPlainOpen(false); onShellFailure(c.message || null); }}
          />
        </div>
        {noShell && (
          // UXP-25: shown only when the failure text names a missing shell. Any other
          // failure keeps the plain terminal error; the toolbar button is always there anyway.
          <div role="status" className="shrink-0 border-t border-edge px-4 py-2.5 flex items-center gap-3 text-[12px] text-mute">
            <Info size={13} className="shrink-0" aria-hidden />
            <span className="flex-1">{NO_SHELL_BANNER}</span>
            <button
              type="button"
              onClick={() => { if (entryReason) return; dbg.openDialog(); }}
              {...disabledAttrs(entryReason)}
              className={`${BTN_PRIMARY} ${entryReason ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Debug container…
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {toolbar}
      <div className="flex-1 min-h-0 flex flex-col overflow-auto">{body}</div>
    </div>
  );
}
