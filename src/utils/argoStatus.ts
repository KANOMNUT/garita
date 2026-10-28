/**
 * ArgoCD status vocabulary and the Resources-tab filter logic, as pure functions.
 *
 * Health and Sync are independent (argocd.md): Sync is whether the cluster matches git, Health is whether the
 * object works. A Healthy but OutOfSync resource is normal, so no function here derives one from the other.
 * The panel header, the Overview and the Resources tab read the same pill tables, so a status has one look.
 */

import type { ArgoCdResource } from "../types/k8s";

export interface ArgoPill { label: string; icon: string; cls: string }

/** Unknown, Suspended and any status the tables do not list. `mute`, never `dim` (text contrast). */
export const ARGO_NEUTRAL_CLS = "bg-surface-tint/5 text-mute ring-edge";

const HEALTH_PILL: Record<string, ArgoPill> = {
  Healthy:     { label: "Healthy",     icon: "●", cls: "bg-ok/10 text-ok ring-ok/30" },
  Degraded:    { label: "Degraded",    icon: "✕", cls: "bg-bad/10 text-bad ring-bad/30" },
  Progressing: { label: "Progressing", icon: "↻", cls: "bg-status-progress/10 text-status-progress ring-status-progress/30" },
  Missing:     { label: "Missing",     icon: "?", cls: "bg-warn/10 text-warn ring-warn/30" },
  Suspended:   { label: "Suspended",   icon: "⏸", cls: ARGO_NEUTRAL_CLS },
  Unknown:     { label: "Unknown",     icon: "?", cls: ARGO_NEUTRAL_CLS },
};
const SYNC_PILL: Record<string, ArgoPill> = {
  Synced:    { label: "Synced",    icon: "✓", cls: "bg-ok/10 text-ok ring-ok/30" },
  OutOfSync: { label: "OutOfSync", icon: "↑", cls: "bg-warn/10 text-warn ring-warn/30" },
  Unknown:   { label: "Unknown",   icon: "?", cls: ARGO_NEUTRAL_CLS },
};
const PHASE_PILL: Record<string, ArgoPill> = {
  Succeeded: { label: "Succeeded", icon: "✓", cls: "bg-ok/10 text-ok ring-ok/30" },
  Running:   { label: "Running",   icon: "↻", cls: "bg-status-progress/10 text-status-progress ring-status-progress/30" },
  Failed:    { label: "Failed",    icon: "✕", cls: "bg-bad/10 text-bad ring-bad/30" },
  Error:     { label: "Error",     icon: "✕", cls: "bg-bad/10 text-bad ring-bad/30" },
};

/** Own keys only: a status such as "constructor" must not resolve to something on Object.prototype. */
function lookup(table: Record<string, ArgoPill>, key: string): ArgoPill | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

export function argoHealthPill(status: string): ArgoPill {
  return lookup(HEALTH_PILL, status) ?? { label: status || "Unknown", icon: "?", cls: ARGO_NEUTRAL_CLS };
}
export function argoSyncPill(status: string): ArgoPill {
  return lookup(SYNC_PILL, status) ?? { label: status || "Unknown", icon: "?", cls: ARGO_NEUTRAL_CLS };
}
/** The last operation's phase (`status.operationState.phase`); a phase the table does not list keeps its own word. */
export function argoPhasePill(phase: string): ArgoPill {
  return lookup(PHASE_PILL, phase) ?? { label: phase, icon: "?", cls: ARGO_NEUTRAL_CLS };
}

/** Header "Healthy": the Health status alone. An OutOfSync Application is still Healthy. */
export function isArgoHealthy(healthStatus: string): boolean {
  return healthStatus === "Healthy";
}

// ─── Resources tab: filter groups ─────────────────────────────────────────────

export type ArgoHealthStatus = "Healthy" | "Progressing" | "Degraded" | "Missing" | "Suspended" | "Unknown";
export type ArgoSyncStatus = "Synced" | "OutOfSync";

export const HEALTH_FILTERS: ArgoHealthStatus[] = ["Healthy", "Progressing", "Degraded", "Missing", "Suspended", "Unknown"];
export const SYNC_FILTERS: ArgoSyncStatus[] = ["Synced", "OutOfSync"];
/** These health chips always show; Suspended and Unknown show only while a resource has that status (or the filter is on). */
const ALWAYS_HEALTH_CHIPS: ArgoHealthStatus[] = ["Healthy", "Progressing", "Degraded", "Missing"];

/** Chip classes per status, literal strings so Tailwind sees them. The inactive look comes from the background and ring, never from fading the text. */
export const ARGO_CHIP_CLS: Record<ArgoHealthStatus | ArgoSyncStatus, { on: string; off: string }> = {
  Healthy:     { on: "bg-ok/20 text-ok ring-ok/40",                                   off: "bg-ok/10 text-ok ring-ok/20 hover:bg-ok/20" },
  Progressing: { on: "bg-status-progress/20 text-status-progress ring-status-progress/40", off: "bg-status-progress/10 text-status-progress ring-status-progress/20 hover:bg-status-progress/20" },
  Degraded:    { on: "bg-bad/20 text-bad ring-bad/40",                                off: "bg-bad/10 text-bad ring-bad/20 hover:bg-bad/20" },
  Missing:     { on: "bg-warn/20 text-warn ring-warn/40",                             off: "bg-warn/10 text-warn ring-warn/20 hover:bg-warn/20" },
  Suspended:   { on: "bg-surface-tint/10 text-mute ring-edge-strong",                 off: "bg-surface-tint/5 text-mute ring-edge hover:bg-surface-tint/10" },
  Unknown:     { on: "bg-surface-tint/10 text-mute ring-edge-strong",                 off: "bg-surface-tint/5 text-mute ring-edge hover:bg-surface-tint/10" },
  Synced:      { on: "bg-ok/20 text-ok ring-ok/40",                                   off: "bg-ok/10 text-ok ring-ok/20 hover:bg-ok/20" },
  OutOfSync:   { on: "bg-warn/20 text-warn ring-warn/40",                             off: "bg-warn/10 text-warn ring-warn/20 hover:bg-warn/20" },
};

type Statuses = Pick<ArgoCdResource, "health_status" | "sync_status">;

/** Per-status counts, always taken from the full list: a Missing resource counts under Missing, not Degraded. */
export function argoHealthCount(resources: readonly Statuses[], status: ArgoHealthStatus): number {
  return resources.filter((r) => r.health_status === status).length;
}
export function argoSyncCount(resources: readonly Statuses[], status: ArgoSyncStatus): number {
  return resources.filter((r) => r.sync_status === status).length;
}

/** The two groups are independent single-select filters and combine with AND. "all" turns a group off. */
export function filterArgoResources<T extends Statuses>(
  resources: readonly T[],
  health: "all" | ArgoHealthStatus,
  sync: "all" | ArgoSyncStatus,
): T[] {
  return resources.filter((r) =>
    (health === "all" || r.health_status === health) &&
    (sync === "all" || r.sync_status === sync));
}

/** The health chips to render, in order: the always-on four, then Suspended / Unknown while present or active. */
export function visibleHealthFilters(resources: readonly Statuses[], active: "all" | ArgoHealthStatus): ArgoHealthStatus[] {
  return HEALTH_FILTERS.filter((st) =>
    ALWAYS_HEALTH_CHIPS.includes(st) || st === active || argoHealthCount(resources, st) > 0);
}

// ─── Resources tab: problem rows ──────────────────────────────────────────────

/** Degraded and Missing are the two health states that need attention first (row order, tab badge, row accent). */
export function isDegradedOrMissing(r: Pick<ArgoCdResource, "health_status">): boolean {
  return r.health_status === "Degraded" || r.health_status === "Missing";
}

/** Row order: Degraded and Missing, then OutOfSync, then Progressing, then the rest. Lower sorts first. */
export function argoSortScore(r: Statuses): number {
  return isDegradedOrMissing(r) ? 0
    : r.sync_status === "OutOfSync" ? 1
    : r.health_status === "Progressing" ? 2
    : 3;
}
