// Relative-time formatter for ISO timestamps. Returns the human label plus the
// signed milliseconds delta (positive = future) so callers can apply thresholds.
// Moved out of ResourceViews.tsx so it has one home shared by certColumns and
// the TLS detail tab (see expiryState below).
export function relativeFromIso(iso: string): { label: string; deltaMs: number | null } {
  if (!iso) return { label: "—", deltaMs: null };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { label: "—", deltaMs: null };
  const deltaMs = t - Date.now();
  const abs = Math.abs(deltaMs);
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  let mag: string;
  if (days >= 1) mag = `${days}d`;
  else if (hours >= 1) mag = `${hours}h`;
  else if (mins >= 1) mag = `${mins}m`;
  else mag = `<1m`;
  const label = deltaMs >= 0 ? `in ${mag}` : `${mag} ago`;
  return { label, deltaMs };
}

// Proportional, per cert-manager's renewal model (2/3 of duration), capped so a
// long-lived internal CA doesn't sit amber for years, floored so a 6-day
// Let's Encrypt cert still gets a warning window.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function expiryState(notAfter: string, notBefore?: string) {
  const { label, deltaMs } = relativeFromIso(notAfter);
  if (deltaMs === null) return { label, cls: "text-dim" };
  const lifetime = notBefore ? Date.parse(notAfter) - Date.parse(notBefore) : NaN;
  const threshold = Number.isFinite(lifetime) && lifetime > 0
    ? Math.min(lifetime / 3, THIRTY_DAYS_MS)
    : 7 * 24 * 60 * 60 * 1000;          // preserves today's certColumns behaviour
  return { label, cls: deltaMs < threshold ? "text-bad" : "text-dim" };
}
