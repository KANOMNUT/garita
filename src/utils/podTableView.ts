// Pure helpers behind the Pod table and the Pod panel (docs/ux/24 POD-6, POD-7, POD-9). They read plain numbers and
// strings so the rules can be tested without a DOM.

/** Which kind of number a bar draws. Metrics-server (or Prometheus) usage, or the pod's requested amount. */
export type BarValueKind = "usage" | "request";

/**
 * The denominator of a CPU or Memory bar, or null when the number should stand alone without a bar.
 * The limit when there is one. Without a limit, a usage value is drawn against twice the request (the rule
 * `DualZoneBar` already uses); a request value has no basis for comparison, because a request against twice itself is
 * always 50 %. Nothing is invented: no limit and no request gives null.
 */
export function barDenominator(
  limit: number | null | undefined,
  request: number | null | undefined,
  valueKind: BarValueKind,
): number | null {
  if (limit != null && limit > 0) return limit;
  if (valueKind === "usage" && request != null && request > 0) return request * 2;
  return null;
}

export interface DisplayedUsage {
  /** The last sample when the pod has metrics, else the request (0 when absent). */
  value: number;
  /** True when `value` is a usage sample, false when it is the request. */
  fromMetrics: boolean;
}

/** The number the CPU or Memory column shows, and what the sort uses. Usage when metrics exist, else the request. */
export function displayedUsage(history: readonly number[] | undefined, request: number | null | undefined): DisplayedUsage {
  if (history && history.length > 0) return { value: history[history.length - 1], fromMetrics: true };
  return { value: request ?? 0, fromMetrics: false };
}

/** "120m", or "120m req" when the number is a request rather than usage. */
export function usageLabel(d: DisplayedUsage, unit: "m" | "Mi"): string {
  return `${d.value}${unit}${d.fromMetrics ? "" : " req"}`;
}

/** The ready fraction ("1/2") as numbers, or null when the string is not a fraction. */
export function readyFraction(ready: string): { ready: number; total: number } | null {
  const [r, t] = ready.split("/").map(Number);
  if (!Number.isFinite(r) || !Number.isFinite(t)) return null;
  return { ready: r, total: t };
}

/** A pod the phase calls Running whose containers are not all ready. */
export function isNotReady(status: string, ready: string): boolean {
  if (status !== "Running") return false;
  const f = readyFraction(ready);
  return f !== null && f.total > 0 && f.ready < f.total;
}

/** Pods per status word, for the filter buttons. */
export function statusCounts(pods: readonly { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of pods) counts[p.status] = (counts[p.status] ?? 0) + 1;
  return counts;
}

/** A TCP port typed into the port-forward form: digits only, 1 to 65535. */
export function validPort(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

/** Least room (px) below a menu's button at which the menu still opens downwards. */
export const MENU_MIN_ROOM = 160;
/** A menu is never squeezed below this height (px), so a very small window still shows a few rows. */
export const MENU_FLOOR = 96;

export interface MenuPlacement {
  /** Open above the button instead of below it. */
  up: boolean;
  /** Tallest the menu may be (px); it scrolls inside when its content is taller. */
  maxHeight: number;
}

/**
 * Where a toolbar menu opens and how tall it may be, from the room (px, edge margin already taken off) below and above
 * its button inside the visible pane. Downwards while there is at least `minRoom` below, or while above has no more
 * room than below; otherwise upwards. The height is the room on the chosen side, never under `MENU_FLOOR`, and never
 * over `cap` when one is given (the Labels menu keeps its old 320 px ceiling).
 */
export function menuPlacement(spaceBelow: number, spaceAbove: number, cap?: number, minRoom = MENU_MIN_ROOM): MenuPlacement {
  const below = Number.isFinite(spaceBelow) ? spaceBelow : 0;
  const above = Number.isFinite(spaceAbove) ? spaceAbove : 0;
  const up = below < minRoom && above > below;
  const room = Math.max(Math.floor(up ? above : below), MENU_FLOOR);
  return { up, maxHeight: cap != null ? Math.min(room, cap) : room };
}
