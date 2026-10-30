/**
 * One pod status vocabulary for the Pods table and the Pod detail panel.
 *
 * The strings are what `pod_status` in `commands/pods.rs` returns: `Terminating`, `CrashLoopBackOff`,
 * `ImagePullBackOff`, `Pending` (also for ContainerCreating), or the Kubernetes phase (`Running`, `Pending`,
 * `Succeeded`, `Failed`, `Unknown`). Both `StatusPill` components read this table, so a status can never be
 * green in one place and orange in the other. A string the table does not know gets the neutral style, never
 * the green one.
 */

export interface PodStatusStyle {
  dot: string;
  text: string;
  bg: string;
  ring: string;
  pulse: boolean;
}

/** Classes are literal strings so Tailwind sees them. `Unknown` is neutral on purpose (`mute`, never `dim`). */
const NEUTRAL: PodStatusStyle = { dot: "bg-mute", text: "text-mute", bg: "bg-surface-tint/5", ring: "ring-edge", pulse: false };

export const POD_STATUS_STYLE: Record<string, PodStatusStyle> = {
  Running:          { dot: "bg-ok",     text: "text-ok",     bg: "bg-ok/10",     ring: "ring-ok/30",     pulse: false },
  Pending:          { dot: "bg-warn",   text: "text-warn",   bg: "bg-warn/10",   ring: "ring-warn/30",   pulse: true  },
  CrashLoopBackOff: { dot: "bg-bad",    text: "text-bad",    bg: "bg-bad/10",    ring: "ring-bad/30",    pulse: true  },
  ImagePullBackOff: { dot: "bg-orange", text: "text-orange", bg: "bg-orange/10", ring: "ring-orange/30", pulse: true  },
  Terminating:      { dot: "bg-purple", text: "text-purple", bg: "bg-purple/10", ring: "ring-purple/30", pulse: true  },
  Succeeded:        { dot: "bg-info",   text: "text-info",   bg: "bg-info/10",   ring: "ring-info/30",   pulse: false },
  Failed:           { dot: "bg-bad",    text: "text-bad",    bg: "bg-bad/10",    ring: "ring-bad/30",    pulse: false },
  Unknown:          NEUTRAL,
};

/** The style for a pod status string. Own keys only: `toString` and friends must not resolve to a style. */
export function podStatusStyle(status: string): PodStatusStyle {
  return Object.prototype.hasOwnProperty.call(POD_STATUS_STYLE, status) ? POD_STATUS_STYLE[status] : NEUTRAL;
}
