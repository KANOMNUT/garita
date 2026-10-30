import { useState, useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { CLUSTER_COLOR_CLASSES, useClusterIdentity, type IdentityRole } from "../utils/clusterIdentity";
import { guardrailTypingNotice, readOnlyRefusal, readOnlyTurnedOnWhileOpen } from "../utils/guardrails";
import type { KubectlEquiv } from "../utils/kubectlEquiv";
import { useModalLayer } from "../utils/modalLayer";
import { KubectlEquivalent } from "./KubectlEquivalent";

// Cluster identity badge — prod-accident guard (docs/plan-kubeconfig-and-parity.md
// §2.3). Exported so PodTable's separate bespoke bulk-confirm dialog can render the
// identical badge instead of duplicating this markup — that dialog isn't built on
// top of ConfirmModal, but the guard still belongs on it.
/** `inline`: the badge sits beside the title in one row (no bottom margin) instead of above it. */
export function ClusterBadge({ label, color, inline }: { label?: string; color?: IdentityRole; inline?: boolean }) {
  if (!label) return null;
  const c = color ? CLUSTER_COLOR_CLASSES[color] : null;
  return (
    <div className={`inline-flex items-center gap-1.5 ${inline ? "" : "mb-3 "}max-w-full min-w-0 px-2 py-1 rounded-md bg-surface-tint/3 ring-1 ${c?.chipRing ?? "ring-edge"}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${c?.dot ?? "bg-dim"}`} />
      <span className={`mono text-[10.5px] truncate ${c?.text ?? "text-mute"}`} title={label}>{label}</span>
    </div>
  );
}

// CONFIRM-ANATOMY (docs/ux/00-overview.md §2). Every prop below the original
// set is optional and additive, so existing call sites compile and behave as
// before — apart from the C2 icon change (non-destructive → info glyph, never
// the warning triangle).
export type ConfirmSize = "sm" | "md" | "lg";
export type ConfirmPhase = "review" | "running" | "attention" | "result" | "error";
export interface ConfirmStatus {
  tone: "error" | "info" | "ok";
  text: string;
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requireTyping?: string;
  requireTypingLabel?: string;
  /**
   * The primary action. Also what ⌘↵ / Ctrl+Enter fires — even when a custom
   * `footer` renders the real buttons — so a host with no primary in a given
   * phase must set `confirmDisabled`.
   */
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  /** Which cluster this action fires against — prod-accident guard, see ClusterBadge. */
  contextLabel?: string;
  contextColor?: IdentityRole;
  /** sm ≈ max-w-sm (default), md ≈ max-w-lg, lg ≈ max-w-2xl. */
  size?: ConfirmSize;
  /** Slot 4. Scrolls on its own; header and footer stay pinned. */
  children?: ReactNode;
  /** Slot 5. Errors are announced assertively, the rest politely. */
  status?: ConfirmStatus | null;
  /** Defaults to "review". Drives the Cancel/Close label and the Esc/backdrop rules. */
  phase?: ConfirmPhase;
  /** Replaces the default Cancel + primary footer. */
  footer?: ReactNode;
  /** Primary disabled by the host (separate from the typed-confirm and pending gates). */
  confirmDisabled?: boolean;
  confirmDisabledReason?: string;
  /** Esc in phase "running" calls this instead of closing. */
  onEscapeWhileRunning?: () => void;
  /** Overrides the title glyph (destructive → warning, otherwise info). */
  icon?: ReactNode;

  // ── v1.3.1 (F1), all optional and additive ─────────────────────────────────
  /**
   * The cluster this action fires against. With it the dialog applies that cluster's
   * guardrails on its own: G1 typed label (only when the site has no `requireTyping` of
   * its own — one typed field at most, D3-6), the read-only block, and the `--kubeconfig`
   * footnote. Every write dialog should pass it (`context={identity.context}`).
   */
  context?: string;
  /** The "Turn off read-only" confirm must not be blocked by the mode it turns off. */
  ignoreGuardrails?: boolean;
  /** Replaces "Cancel" / "Close" (PREVIEW-GATE passes "Back to editor"). */
  cancelLabel?: string;
  /**
   * Initial focus, independent of `destructive` (00 C5, amended v1.3). Wins over the derived
   * rule. "cancel" focuses the default Cancel button, or `[data-modal-cancel]` in a custom footer.
   * "first" focuses `[data-modal-initial]` in the body, else the first focusable control
   * (UXA-3: a non-destructive dialog with a required field opens on that field, not on the primary).
   */
  initialFocus?: "cancel" | "primary" | "input" | "first";
  /** Slot 6: collapsed "kubectl equivalent" disclosure. */
  kubectlEquivalent?: KubectlEquiv | null;
  /** Slot 7: a guardrail / notice line, above the typed input. */
  notice?: ReactNode;
  /**
   * An acknowledgement checkbox gate. The primary stays inert until it is ticked, `⌘↵`
   * never fires past it, and it resets whenever the dialog reopens.
   */
  acknowledge?: { label: ReactNode; reason?: string };
}

const SIZE_CLASS: Record<ConfirmSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const STATUS_STYLE: Record<ConfirmStatus["tone"], { cls: string; Icon: typeof Info }> = {
  error: { cls: "text-bad bg-bad/10 ring-bad/25", Icon: XCircle },
  info: { cls: "text-mute bg-surface-tint/3 ring-edge", Icon: Info },
  ok: { cls: "text-ok bg-ok/10 ring-ok/25", Icon: CheckCircle2 },
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  requireTyping,
  requireTypingLabel,
  onConfirm,
  onCancel,
  isPending = false,
  contextLabel,
  contextColor,
  size = "sm",
  children,
  status,
  phase = "review",
  footer,
  confirmDisabled: hostDisabled = false,
  confirmDisabledReason,
  onEscapeWhileRunning,
  icon,
  context,
  ignoreGuardrails = false,
  cancelLabel,
  initialFocus,
  kubectlEquivalent,
  notice,
  acknowledge,
}: ConfirmModalProps) {
  const [typedValue, setTypedValue] = useState("");
  const [acked, setAcked] = useState(false);
  const g = useClusterIdentity(context ?? "");
  const guard = !!context && !ignoreGuardrails;
  // G1: the guardrail types the cluster label — but never adds a SECOND typed field (D3-6).
  const guardTyping = guard && g.typedConfirm && !requireTyping;
  const guardLabel = g.label || context || "";
  const effectiveTyping = requireTyping ?? (guardTyping ? guardLabel : undefined);
  const effectiveTypingLabel = requireTypingLabel ?? (guardTyping ? `Type ${guardLabel} to confirm` : undefined);
  const readOnlyBlocked = guard && g.readOnly;
  const isTopmost = useModalLayer(open);
  const titleId = useId();
  const descId = useId();
  const reasonId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const typingMatches = !effectiveTyping || typedValue === effectiveTyping;
  const ackPending = !!acknowledge && !acked;
  const blocked = isPending || !typingMatches || hostDisabled || ackPending || readOnlyBlocked;
  // One primary reason (00 DISABLE-PRECEDENCE): the host's, then the checkbox, then read-only.
  const reasonText =
    (hostDisabled ? confirmDisabledReason : undefined) ??
    (ackPending ? (acknowledge?.reason ?? "Tick the box to continue.") : undefined) ??
    (readOnlyBlocked ? readOnlyRefusal(guardLabel) : undefined);
  const showReason = !!reasonText && (hostDisabled || ackPending || readOnlyBlocked);

  // C6: the typed value never survives a close, a reopen, or a change of what
  // must be typed (e.g. the drain dialog going back to review). Same for the
  // acknowledgement checkbox.
  useEffect(() => {
    setTypedValue("");
    setAcked(false);
  }, [open, effectiveTyping]);

  // Keep the latest props reachable from the window listener without
  // re-subscribing on every keystroke in the typed-confirm input.
  const live = useRef({
    phase, isPending, blocked, size, requireTyping: effectiveTyping, destructive, initialFocus,
    onCancel, onConfirm, onEscapeWhileRunning,
  });
  live.current = {
    phase, isPending, blocked, size, requireTyping: effectiveTyping, destructive, initialFocus,
    onCancel, onConfirm, onEscapeWhileRunning,
  };

  // Initial focus (C5) and focus return (A11Y 10.2). Runs when `open` flips,
  // not on every phase change — a dialog that moves review → running → result
  // must not yank focus around under the user.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      const l = live.current;
      const mode = l.initialFocus ?? (l.requireTyping ? "input" : l.destructive ? "cancel" : "primary");
      const want =
        mode === "input"
          ? inputRef.current
          : mode === "first"
            ? (card.querySelector<HTMLElement>("[data-modal-initial]") ?? card.querySelector<HTMLElement>(FOCUSABLE))
            : mode === "cancel"
            ? (cancelRef.current ?? card.querySelector<HTMLElement>("[data-modal-cancel]"))
            : confirmRef.current;
      const target =
        want && !want.hasAttribute("disabled")
          ? want
          : (card.querySelector<HTMLElement>(FOCUSABLE) ?? card);
      target.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      if (opener && opener.isConnected) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc, ⌘↵ and the focus trap. Capture phase + stopPropagation on window so
  // the App-level handler (and any other window listener) never sees a key the
  // dialog consumed — Esc over a detail panel closes only the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isTopmost() || e.isComposing) return;
      const s = live.current;
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (s.phase === "running") s.onEscapeWhileRunning?.();
        else if (!s.isPending) s.onCancel();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.stopPropagation();
        e.preventDefault();
        // D-5 / K5: only when the primary is enabled, never past a typed
        // confirm, never while running.
        if (s.phase !== "running" && !s.blocked) s.onConfirm();
        return;
      }
      if (e.key === "Tab") {
        const card = cardRef.current;
        if (!card) return;
        const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (items.length === 0) {
          e.preventDefault();
          card.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!card.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Focus that escapes the card (click on the scrim chrome, a stray programmatic
    // focus) is pulled back; content outside is effectively inert.
    const onFocusIn = (e: FocusEvent) => {
      const card = cardRef.current;
      if (!card || !isTopmost() || card.contains(e.target as Node)) return;
      (card.querySelector<HTMLElement>(FOCUSABLE) ?? card).focus();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, isTopmost]);

  if (!open) return null;

  const closeLabel = cancelLabel ?? (phase === "result" || phase === "error" ? "Close" : "Cancel");
  // A host status wins; otherwise a read-only mode switched on while the dialog is open
  // says why the primary went inert (03 §11.4).
  const shownStatus: ConfirmStatus | null =
    status ?? (readOnlyBlocked && (phase === "review" || phase === "error") ? { tone: "error", text: readOnlyTurnedOnWhileOpen(guardLabel) } : null);
  const statusStyle = shownStatus ? STATUS_STYLE[shownStatus.tone] : null;
  const guardNotice = guardTyping ? guardrailTypingNotice(guardLabel) : null;

  function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    // Only an sm dialog with no typed confirm, still in review, closes on a
    // backdrop click — md/lg and anything mid-flight lose reading position.
    if (size === "sm" && !effectiveTyping && phase === "review" && !isPending) onCancel();
  }

  function handlePrimary() {
    if (!blocked) onConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className={`bg-surface-overlay/95 rounded-xl ring-1 ring-edge-strong shadow-2xl w-full ${SIZE_CLASS[size]} max-h-[90vh] flex flex-col outline-hidden`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Slots 1-3: pinned */}
        <div className="shrink-0 px-5 pt-5">
          <ClusterBadge label={contextLabel} color={contextColor} />

          <div className="flex items-center gap-2.5 mb-2">
            {icon ?? (
              destructive
                ? <AlertTriangle size={16} className="text-warn shrink-0" />
                : <Info size={16} className="text-accent shrink-0" />
            )}
            <h2 id={titleId} className="text-[14px] font-semibold text-ink">{title}</h2>
          </div>

          <div id={descId} className="text-[12.5px] text-mute mb-4">{description}</div>
        </div>

        {/* Slot 4: the only part that scrolls */}
        {children != null && children !== false && (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">{children}</div>
        )}

        {/* Slots 5, 8, 9: pinned */}
        <div className="shrink-0 px-5 pb-5">
          {shownStatus && statusStyle && (
            <div
              role={shownStatus.tone === "error" ? "alert" : "status"}
              className={`mb-4 flex items-start gap-2 rounded-lg px-3 py-2 ring-1 text-[12px] ${statusStyle.cls}`}
            >
              <statusStyle.Icon size={14} className="shrink-0 mt-0.5" />
              <span className="min-w-0 wrap-break-word">{shownStatus.text}</span>
            </div>
          )}

          {/* Slot 6: kubectl equivalent (collapsed, height-capped when open) */}
          {kubectlEquivalent && <KubectlEquivalent equiv={kubectlEquivalent} context={context} />}

          {/* Slot 7: guardrail / notice */}
          {(guardNotice || notice) && (
            <div className="mb-3 flex flex-col gap-1 rounded-lg bg-surface-tint/3 ring-1 ring-edge px-3 py-2 text-[11.5px] text-mute">
              {notice}
              {guardNotice && <span>{guardNotice}</span>}
            </div>
          )}

          {acknowledge && (
            <label className="mb-3 flex items-start gap-2 text-[12px] text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={acked}
                onChange={(e) => setAcked(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>{acknowledge.label}</span>
            </label>
          )}

          {effectiveTyping && (
            <div className="mb-4 flex flex-col gap-1.5">
              {effectiveTypingLabel && (
                <label className="text-[12px] text-mute">{effectiveTypingLabel}</label>
              )}
              <input
                ref={inputRef}
                type="text"
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                placeholder={effectiveTyping}
                aria-label={effectiveTypingLabel ?? `Type ${effectiveTyping} to confirm`}
                className="w-full rounded-lg bg-surface-input/80 ring-1 ring-edge px-3 py-1.5 text-[12.5px] text-ink placeholder:text-dim outline-hidden focus:ring-accent/50 focus:ring-2 transition-shadow"
              />
            </div>
          )}

          {footer ?? (
            <div className="flex items-center justify-end gap-2">
              <button
                ref={cancelRef}
                data-modal-cancel
                onClick={onCancel}
                disabled={isPending}
                className="px-3 py-1.5 rounded-lg text-[12.5px] text-mute ring-1 ring-edge hover:text-ink disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 outline-hidden"
              >
                {closeLabel}
              </button>
              <button
                ref={confirmRef}
                onClick={handlePrimary}
                disabled={isPending || !typingMatches}
                aria-disabled={blocked || undefined}
                aria-describedby={showReason ? reasonId : undefined}
                title={showReason ? reasonText : undefined}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] ring-1 flex items-center gap-1.5 transition-colors disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed focus-visible:ring-2 outline-hidden
                  ${destructive
                    ? "bg-bad/10 text-bad ring-bad/30 hover:bg-bad/20 focus-visible:ring-bad/60"
                    : "bg-accent/10 text-accent ring-accent/30 hover:bg-accent/20 focus-visible:ring-accent/60"
                  }`}
              >
                {isPending && <Loader2 size={12} className="animate-spin" />}
                {confirmLabel}
              </button>
              {showReason && (
                <span id={reasonId} className="sr-only">{reasonText}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
