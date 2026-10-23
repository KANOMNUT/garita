import type { PresenceState } from "../types/k8s";

/** #15 state vocabulary for CRD-backed list views. "ok" = render the rows. */
export type ViewStateKind = "ok" | "not-installed" | "no-access" | "nothing-here" | "error";

export interface ViewStateResult {
  kind: ViewStateKind;
  /** True only for nothing-here when presence could not be confirmed (subtitle). */
  unconfirmed: boolean;
}

/** Tauri rejects with a plain string; kube-rs forbidden errors carry "Forbidden"/"403". */
export const isForbidden = (msg: string): boolean => /\b403\b|forbidden/i.test(msg);

/**
 * presence: a failed or missing presence answer is passed as "unknown" (subtitle shows); the
 * caller holds the skeleton while presence is still loading (A-11).
 * errorMessage: the list query's error text, null when it succeeded.
 */
export function viewState(
  presence: PresenceState,
  errorMessage: string | null,
  count: number,
): ViewStateResult {
  const r = (kind: ViewStateKind, unconfirmed = false): ViewStateResult => ({ kind, unconfirmed });
  // A non-empty list outranks "absent": never hide rows we actually have.
  if (presence === "absent" && count === 0) return r("not-installed");
  if (errorMessage !== null) return r(isForbidden(errorMessage) ? "no-access" : "error");
  if (count === 0) return r("nothing-here", presence === "unknown");
  return r("ok");
}
