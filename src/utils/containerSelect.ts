// Container pre-selection for the pod Logs and Shell tabs (v1.3.0, #3 + #4,
// docs/ux/02-logs-debug.md §2.3 / §4.2 / §5.3). Pure client-side selection over
// data the Pod already carries; no React, no I/O. `now` is passed in so the
// "3m ago" text is testable.

import type { ContainerStatus } from "../types/k8s";

export interface SelectableContainer {
  name: string;
  is_init?: boolean;
  /** An ephemeral debug container (v1.3.1): labelled `[debug]`, never an `init:` status bridge. */
  is_debug?: boolean;
  /** Pod-level container status text ("Running", ...). Fallback when containers_status has no entry. */
  status?: string;
}

export interface SelectablePod {
  containers: SelectableContainer[];
  containers_status?: ContainerStatus[];
  /** kubectl.kubernetes.io/default-container, verbatim; null/absent when unset. */
  default_container?: string | null;
}

export type FailKind = "crash-loop" | "image-pull" | "create-error" | "crashed" | "init-failed";

export interface FailingContainer {
  name: string;
  isInit: boolean;
  kind: FailKind;
  /** waiting / terminated reason, e.g. CrashLoopBackOff, OOMKilled */
  reason: string;
  restartCount: number;
  exitCode?: number;
  finishedAt?: string;
  /** The current instance is waiting (so its current log is usually empty). */
  waiting: boolean;
  /** A previous instance exists to read. */
  hasPrevious: boolean;
}

const WAITING_FAILURES: Record<string, FailKind> = {
  CrashLoopBackOff: "crash-loop",
  ImagePullBackOff: "image-pull",
  ErrImagePull: "image-pull",
  CreateContainerError: "create-error",
};

/** `containers_status` names init containers with an `init:` prefix (pods.rs). */
export function statusFor(pod: SelectablePod, c: SelectableContainer): ContainerStatus | undefined {
  const list = pod.containers_status ?? [];
  if (c.is_init) return list.find((s) => s.name === `init:${c.name}`) ?? list.find((s) => s.name === c.name);
  return list.find((s) => s.name === c.name);
}

function ts(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * "Failing" is a deterministic test, no scoring (02 §2.3): current state waiting
 * with CrashLoopBackOff / ImagePullBackOff / ErrImagePull / CreateContainerError,
 * or terminated non-zero, or an init container that terminated non-zero.
 *
 * ContainerStatus carries the exit code only for the PREVIOUS run, so a current
 * terminated state is judged by its reason: anything but "Completed" is non-zero.
 *
 * Most recently finished first; ties go to spec order.
 */
export function findFailing(pod: SelectablePod): FailingContainer[] {
  const found: { f: FailingContainer; order: number; at: number }[] = [];
  pod.containers.forEach((c, order) => {
    const s = statusFor(pod, c);
    if (!s) return;
    const isInit = !!c.is_init;
    const hasPrevious = s.restart_count > 0 || s.last_state != null;
    let f: FailingContainer | null = null;
    if (s.current_state === "waiting") {
      const kind = s.current_reason ? WAITING_FAILURES[s.current_reason] : undefined;
      if (kind) {
        f = {
          name: c.name, isInit, kind, reason: s.current_reason ?? "", restartCount: s.restart_count,
          exitCode: s.last_exit_code, finishedAt: s.last_finished_at, waiting: true, hasPrevious,
        };
      }
    } else if (s.current_state === "terminated" && s.current_reason && s.current_reason !== "Completed") {
      f = {
        name: c.name, isInit, kind: isInit ? "init-failed" : "crashed", reason: s.last_reason ?? s.current_reason,
        restartCount: s.restart_count, exitCode: s.last_exit_code,
        finishedAt: s.last_finished_at ?? s.current_started_at, waiting: false, hasPrevious,
      };
    }
    if (f) found.push({ f, order, at: ts(f.finishedAt) });
  });
  found.sort((a, b) => b.at - a.at || a.order - b.order);
  return found.map((x) => x.f);
}

export function relativeAgo(iso: string | undefined, now: number): string | null {
  const t = ts(iso);
  if (!t) return null;
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function failingHint(f: FailingContainer, now: number): string {
  switch (f.kind) {
    case "crash-loop":
      return `Selected: crash looping (${f.reason}, ${plural(f.restartCount, "restart")})`;
    case "image-pull":
      return `Selected: can't pull its image (${f.reason})`;
    case "create-error":
      return `Selected: couldn't be created (${f.reason})`;
    case "init-failed":
      return `Selected: init container "${f.name}" failed${f.exitCode != null ? ` (exit ${f.exitCode})` : ""}`;
    case "crashed": {
      const bits = [f.reason];
      if (f.exitCode != null) bits.push(`exit ${f.exitCode}`);
      const ago = relativeAgo(f.finishedAt, now);
      if (ago) bits.push(ago);
      return `Selected: last crashed (${bits.join(", ")})`;
    }
  }
}

export interface LogSelection {
  container: string;
  /** What rule (2) / (3) would have chosen instead; null when it is the same container or there is none. */
  alternative: string | null;
  /** "Selected: …" text; null for rule (3), which needs no explanation. */
  hint: string | null;
  /** D-L2: the failing container's current instance is waiting and a previous run exists. */
  openPrevious: boolean;
  /** "Showing the previous run: …" text, set exactly when openPrevious is. */
  previousHint: string | null;
  /** Names of every failing container (the dropdown marks each). */
  failing: string[];
}

function firstNonInit(pod: SelectablePod): string {
  return pod.containers.find((c) => !c.is_init)?.name ?? pod.containers[0]?.name ?? "";
}

/** The annotation's container, ignored (undefined) when no such container exists. */
function annotated(pod: SelectablePod): string | undefined {
  const d = pod.default_container;
  if (!d) return undefined;
  return pod.containers.some((c) => c.name === d) ? d : undefined;
}

/** Logs precedence: failing -> default-container annotation -> first non-init. */
export function selectLogContainer(pod: SelectablePod, now: number = Date.now()): LogSelection {
  const failing = findFailing(pod);
  const ann = annotated(pod);
  const base = ann ?? firstNonInit(pod);
  const failingNames = failing.map((f) => f.name);

  if (failing.length > 0) {
    const f = failing[0];
    const alt = base !== f.name ? base : null;
    const openPrevious = f.waiting && f.hasPrevious;
    const why = f.kind === "crash-loop" ? `${f.reason}, ${plural(f.restartCount, "restart")}` : f.reason;
    return {
      container: f.name,
      alternative: alt,
      hint: failingHint(f, now),
      openPrevious,
      previousHint: openPrevious ? `Showing the previous run: the current one is waiting (${why}).` : null,
      failing: failingNames,
    };
  }
  if (ann) {
    const first = firstNonInit(pod);
    return {
      container: ann,
      alternative: first !== ann ? first : null,
      hint: "Selected: this pod's default container (annotation)",
      openPrevious: false,
      previousHint: null,
      failing: failingNames,
    };
  }
  return {
    container: firstNonInit(pod),
    alternative: null,
    hint: null,
    openPrevious: false,
    previousHint: null,
    failing: failingNames,
  };
}

/** Dropdown text for the Logs tab (02 §5.3): "app (crashed)", "sidecar (default)", "migrate [init]". */
export function logOptionLabel(pod: SelectablePod, c: SelectableContainer, sel: LogSelection): string {
  let label = c.is_init ? `[init] ${c.name}` : c.is_debug ? `[debug] ${c.name}` : c.name;
  if (sel.failing.includes(c.name)) {
    const f = findFailing(pod).find((x) => x.name === c.name);
    label += f && (f.kind === "image-pull" || f.kind === "create-error") ? " (can't start)" : " (crashed)";
  } else if (annotated(pod) === c.name) {
    label += " (default)";
  }
  return label;
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function isRunning(pod: SelectablePod, c: SelectableContainer): boolean {
  const s = statusFor(pod, c);
  if (s) return s.current_state === "running";
  return (c.status ?? "").toLowerCase() === "running";
}

export interface ShellOption {
  name: string;
  label: string;
  disabled: boolean;
  /** Shown as the option's tooltip when disabled. */
  reason?: string;
}

export const SHELL_NOT_RUNNING_REASON = "A shell needs a running container.";

/**
 * Shell precedence: annotation -> first running. "Failing" does not apply (a
 * container that isn't running can't take a shell). Falls back to the first
 * non-init container when nothing is running, so the terminal shows its own
 * failure rather than an empty selector.
 */
export function selectShellContainer(pod: SelectablePod): string {
  const ann = annotated(pod);
  const annC = ann ? pod.containers.find((c) => c.name === ann) : undefined;
  if (annC && isRunning(pod, annC)) return annC.name;
  const running = pod.containers.filter((c) => isRunning(pod, c));
  return (running.find((c) => !c.is_init) ?? running[0])?.name ?? firstNonInit(pod);
}

export function shellOptions(pod: SelectablePod): ShellOption[] {
  const ann = annotated(pod);
  return pod.containers.map((c) => {
    const running = isRunning(pod, c);
    let label = c.is_init ? `[init] ${c.name}` : c.is_debug ? `[debug] ${c.name}` : c.name;
    if (ann === c.name) label += " (default)";
    if (!running) label += " (not running)";
    return running
      ? { name: c.name, label, disabled: false }
      : { name: c.name, label, disabled: true, reason: SHELL_NOT_RUNNING_REASON };
  });
}
