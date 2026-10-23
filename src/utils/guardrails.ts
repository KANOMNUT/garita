// Read-only mode and guardrails (#29, docs/ux/03-diffs-write-safety.md Â§11).
//
// Non-React readers over the per-cluster record in clusterIdentity.ts, the refusal
// strings (03 Â§17.1, verbatim), and DISABLE-PRECEDENCE (00 Â§5). Read-only is a HINT,
// not a security boundary: it governs the app's own buttons. Copy never says
// "protected", "secured" or "locked".
import { getClusterIdentity, getGuardrailSettings, type GuardrailSettings } from "./clusterIdentity";
import { PRODUCT_NAME } from "../brand";

/**
 * D3-7 (user decision, 2026-10-03, confirmed): shell exec is BLOCKED while read-only is on,
 * and an open session is ended when it turns on (Â§0.5). Reversing the decision is this one line â€” the badge popover copy and the session end both key off it.
 */
export const READ_ONLY_BLOCKS_SHELL = true;

// â”€â”€â”€ Strings (03 Â§17.1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const READ_ONLY_REASON = `Read-only mode (${PRODUCT_NAME} guardrail). Turn it off with the Read-only chip in the top bar.`;
export const READ_ONLY_REASON_SHORT = "Read-only mode.";
export const READ_ONLY_TABLE_STRIP = "Read-only mode. Writes are disabled for this context.";
export const NEW_RESOURCE_BLOCKED_ANNOUNCEMENT = "Read-only mode. New resource is disabled.";
export const SHELLS_BLOCKED_LINE = "Pod shells are blocked.";
export const CORRUPT_STORE_NOTE = "Couldn't read this cluster's guardrail settings. They're off until you set them again.";
export const INVALID_BULK_LIMIT = "Enter a whole number from 1 to 500.";

export function readOnlyBadgePopover(cluster: string): string {
  const base = `Read-only mode (${PRODUCT_NAME} guardrail) is on for ${cluster}. It disables the app's write actions. It doesn't affect kubectl or other tools.`;
  return READ_ONLY_BLOCKS_SHELL ? `${base} ${SHELLS_BLOCKED_LINE}` : base;
}

export function readOnlyRefusal(cluster: string): string {
  return `Read-only mode (${PRODUCT_NAME} guardrail) is on for ${cluster}. Turn it off with the Read-only chip in the top bar to make changes.`;
}

export function readOnlyTurnedOnWhileOpen(cluster: string): string {
  return `Read-only mode was turned on for ${cluster}. This action can't be completed.`;
}

export function readOnlyOnAnnouncement(cluster: string): string {
  return `Read-only mode on for ${cluster}.`;
}

export function guardrailTypingNotice(cluster: string): string {
  return `Guardrail on ${cluster}: confirming this action needs typing.`;
}

export function shellClosedByReadOnly(cluster: string): string {
  return `Shell closed: read-only mode was turned on for ${cluster}. Turn it off to open a shell.`;
}

// â”€â”€â”€ Bulk limit (G2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface BulkCheck {
  ok: boolean;
  /** How many items to deselect to get under the limit (0 when ok or when the limit is off). */
  over: number;
  /** The refusal text, or null when the selection is allowed. */
  message: string | null;
}

export function bulkLimitRefusal(limit: number, over: number, cluster: string): string {
  return `Guardrail: bulk actions are limited to ${limit} on ${cluster}. Deselect ${over} to continue.`;
}

export function checkBulk(count: number, limit: number | null, cluster: string): BulkCheck {
  if (limit === null || count <= limit) return { ok: true, over: 0, message: null };
  const over = count - limit;
  return { ok: false, over, message: bulkLimitRefusal(limit, over, cluster) };
}

// â”€â”€â”€ Readers and the write backstop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function clusterLabelFor(context: string): string {
  return getClusterIdentity(context).label || context;
}

export function isReadOnly(context: string): boolean {
  return getGuardrailSettings(context).readOnly;
}

/**
 * The write backstop (C-8): throws the Â§17.1 refusal when read-only is on for `context`.
 * Called from the one wrapper in useResources.ts that every cluster-writing invoke goes
 * through, so a call site the inventory missed cannot bypass the mode. An Error object
 * (not a string) so `(e as any)?.message ?? String(e)` renders it like any other failure.
 */
export function assertWritable(context: string): void {
  if (isReadOnly(context)) throw new Error(readOnlyRefusal(clusterLabelFor(context)));
}

export function guardrailsFor(context: string): GuardrailSettings {
  return getGuardrailSettings(context);
}

// â”€â”€â”€ DISABLE-PRECEDENCE (00 Â§5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DisableInput {
  /** Cluster has read-only mode on (position 2). */
  readOnly?: boolean;
  /** An explicit RBAC denial's message (position 3). Fail open: leave undefined for "unknown". */
  rbac?: string;
  /** A missing server capability's message (position 4). */
  capability?: string;
  /** Position 4 variant used by the debug container: the pod has finished. */
  finished?: string;
}

/**
 * ONE primary reason, never several: read-only, then RBAC, then capability, then a
 * finished pod. "In progress" (position 1) is not a reason string â€” the control shows its
 * own spinner â€” so callers keep `disabled` for that and use this for the rest.
 */
export function pickDisabledReason(i: DisableInput): string | undefined {
  if (i.readOnly) return READ_ONLY_REASON;
  if (i.rbac) return i.rbac;
  if (i.capability) return i.capability;
  if (i.finished) return i.finished;
  return undefined;
}

// UXA-8: `aria-description` is an ARIA 1.3 draft that WKWebView and WebKitGTK may ignore, so a
// disabled control points `aria-describedby` at a real sr-only element holding the reason.
// Call sites stay unchanged: `disabledAttrs` registers the reason here and returns a stable id,
// and one <DisabledReasonHost /> (mounted in App) renders a hidden span per registered reason.
const reasonRegistry = new Set<string>();
const reasonListeners = new Set<() => void>();
let reasonSnapshot: readonly string[] = [];

/** Stable DOM id for a reason string (djb2 hash). */
export function disabledReasonId(reason: string): string {
  let h = 5381;
  for (let i = 0; i < reason.length; i++) h = ((h << 5) + h + reason.charCodeAt(i)) | 0;
  return `dr-${(h >>> 0).toString(36)}`;
}

export function registeredDisabledReasons(): readonly string[] {
  return reasonSnapshot;
}

export function subscribeDisabledReasons(listener: () => void): () => void {
  reasonListeners.add(listener);
  return () => { reasonListeners.delete(listener); };
}

function registerReason(reason: string): void {
  if (reasonRegistry.has(reason)) return;
  reasonRegistry.add(reason);
  reasonSnapshot = Array.from(reasonRegistry);
  // Deferred: this runs during render, and a subscriber update must not.
  queueMicrotask(() => reasonListeners.forEach((l) => l()));
}

/**
 * Attributes for a control that stays focusable (D1): `aria-disabled`, the reason as its
 * described-by text, and the tooltip. NOTE the click handler must still bail out
 * (`if (reason) return`) â€” aria-disabled does not stop a click the way `disabled` does.
 */
export function disabledAttrs(reason: string | undefined): {
  "aria-disabled"?: true;
  "aria-describedby"?: string;
  title?: string;
} {
  if (!reason) return {};
  registerReason(reason);
  return { "aria-disabled": true, "aria-describedby": disabledReasonId(reason), title: reason };
}
