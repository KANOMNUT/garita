// Ephemeral debug container helpers (v1.3.1 F7; docs/ux/02-logs-debug.md §2.4, §3.8, §4.3,
// §5.4; brief §1.4 items 4-5, Q-L7..Q-L11, §0.3 UXP-24/25, C-9). Pure and React-free except
// the two localStorage wrappers, which are try/catch per-viewer conveniences.

import type { Container, EphemeralContainerInfo } from "../types/k8s";

// ─── Name and image ──────────────────────────────────────────────────────────

const NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `debugger-` plus 5 characters of [a-z0-9]. `rand` is injectable for tests. */
export function generateDebugName(rand: () => number = Math.random): string {
  let tail = "";
  for (let i = 0; i < 5; i++) tail += NAME_ALPHABET[Math.min(NAME_ALPHABET.length - 1, Math.floor(rand() * NAME_ALPHABET.length))];
  return `debugger-${tail}`;
}

/** DNS-1123 label: `[a-z0-9]([-a-z0-9]*[a-z0-9])?`, at most 63 characters. Same rule the backend enforces. */
export function validateDebugName(name: string): string | null {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) || name.length > 63) {
    return "Name must be a DNS-1123 label (lowercase letters, digits and '-', at most 63 characters).";
  }
  return null;
}

/** null when valid. No registry lookup: "image not found" is only knowable after the node pulls. */
export function validateImage(image: string): string | null {
  if (image.trim() === "") return "Enter an image name.";
  if (/\s/.test(image.trim())) return "An image name can't contain spaces.";
  return null;
}

/** Exact strings (brief §1.4 item 4). */
export const DEBUG_IMAGE_SUGGESTIONS: readonly string[] = [
  "busybox:1.36",
  "nicolaka/netshoot:v0.13",
  "alpine:3.20",
  "ubuntu:24.04",
];

export const MAX_RECENT_IMAGES = 5;
const RECENT_KEY = "debug-images";

export function parseRecentImages(json: string | null): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && validateImage(x) === null).slice(0, MAX_RECENT_IMAGES);
  } catch {
    return [];
  }
}

/** Most recent first, deduplicated, capped at 5. */
export function pushRecentImage(list: readonly string[], image: string): string[] {
  const img = image.trim();
  if (validateImage(img) !== null) return [...list];
  return [img, ...list.filter((x) => x !== img)].slice(0, MAX_RECENT_IMAGES);
}

export function loadRecentImages(): string[] {
  try {
    return parseRecentImages(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

export function saveRecentImages(list: readonly string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* per-viewer convenience only */
  }
}

/** Default image: the last used one, else the first suggestion (D-L6). */
export function defaultImage(recent: readonly string[]): string {
  return recent[0] ?? DEBUG_IMAGE_SUGGESTIONS[0];
}

// ─── Backend text ────────────────────────────────────────────────────────────

const START_PREFIX = "Failed to start debug container: ";

/** Strips the EXACT backend prefix so the status line does not say "failed" twice. */
export function stripStartPrefix(message: string): string {
  return message.startsWith(START_PREFIX) ? message.slice(START_PREFIX.length) : message;
}

/** Brief §1.4 item 5: PSA / admission heuristic on the lower-cased message. */
export function isPsaRejection(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("podsecurity") || m.includes("pod security") || m.includes("admission webhook");
}

export const PSA_LINE =
  "A Pod Security Admission policy or an admission webhook in this cluster may be blocking it. Try a different image, or ask a cluster admin.";
export const NOTHING_ADDED_LINE = "Nothing was added to the pod.";

export function rejectionStatus(message: string): string {
  return `The API server rejected this debug container: ${stripStartPrefix(message)}`;
}
export function rejectionPlainLine(message: string): string {
  return isPsaRejection(message) ? PSA_LINE : NOTHING_ADDED_LINE;
}

/**
 * UXP-25: the banner trigger is `ShellClosed.message` (an exec failure arrives AFTER the
 * websocket upgrade, on status channel 3), applied also to a start rejection. Source-read
 * substrings: they are on the live-verification list.
 */
export function isNoShellError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("executable file not found") || m.includes("oci runtime exec failed") || m.includes("no such file or directory");
}

// ─── Capability, finished pod, gates ─────────────────────────────────────────

/** C-9: `server_version` is a git_version like v1.29.3-gke.100 or v1.27.4+k3s1. */
export function parseKubeVersion(v: string | null | undefined): { major: number; minor: number } | null {
  if (!v) return null;
  const m = /^v?(\d+)\.(\d+)/.exec(v.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/** Q-L9: disabled ONLY when the version parses and is below 1.23. Unparseable fails open. */
export function supportsEphemeralContainers(serverVersion: string | null | undefined): boolean {
  const v = parseKubeVersion(serverVersion);
  if (!v) return true;
  return v.major > 1 || v.minor >= 23;
}

/** Q-L10: a debug container never runs in a finished pod. */
export function isFinishedPodStatus(status: string): boolean {
  return status === "Succeeded" || status === "Failed" || status === "Terminating";
}

export const DEBUG_DENIED_REASON =
  "You don't have permission to add debug containers. This needs permission to update pods/ephemeralcontainers.";
export const DEBUG_UNSUPPORTED_REASON = "This cluster's API server doesn't support ephemeral containers.";
export const DEBUG_FINISHED_REASON = "Debug containers can't run in a pod that has finished.";

// ─── Session state shown in the Shell tab ────────────────────────────────────

export type DebugCard =
  | { kind: "pod-gone" }
  | { kind: "pull-failing"; reason: string; message: string; image: string }
  | { kind: "waiting"; reason: string | null }
  | { kind: "running" }
  | { kind: "exited"; exitCode: number | null }
  | { kind: "pending" };

const PULL_REASONS = ["ImagePullBackOff", "ErrImagePull"];

/** What the live pod says about the debug container. `podGone` = get_pod returned null. */
export function debugCard(podGone: boolean, e: EphemeralContainerInfo | undefined): DebugCard {
  if (podGone) return { kind: "pod-gone" };
  if (!e || e.state === "pending") return { kind: "pending" };
  if (e.state === "terminated") return { kind: "exited", exitCode: e.exit_code };
  if (e.state === "running") return { kind: "running" };
  if (e.reason && PULL_REASONS.includes(e.reason)) {
    return { kind: "pull-failing", reason: e.reason, message: e.message ?? "", image: e.image };
  }
  return { kind: "waiting", reason: e.reason };
}

export function pullFailingText(c: { reason: string; message: string; image: string }): string {
  return `Waiting: ${c.reason}. Kubernetes can't pull "${c.image}"${c.message ? `: ${c.message}` : "."}`;
}

export function exitedText(name: string, exitCode: number | null): string {
  return `${name} exited${exitCode === null ? "" : ` (code ${exitCode})`}. A debug container can't be restarted.`;
}

export function detachedText(name: string): string {
  return `Detached. ${name} is still running in this pod.`;
}

export const POD_GONE_TEXT = "This pod no longer exists. Debug containers go away with the pod.";
export const NO_SHELL_BANNER = "This container may not include a shell. Start a debug container to get one.";

/** Strip steps: Added -> Waiting for container -> Connecting -> Attached. */
export type StripStep = "added" | "waiting" | "connecting" | "attached";
export const STRIP_STEPS: { id: StripStep; label: string }[] = [
  { id: "added", label: "Added" },
  { id: "waiting", label: "Waiting for container" },
  { id: "connecting", label: "Connecting" },
  { id: "attached", label: "Attached" },
];

/** The step text without the per-second counter, so a live region does not change every second. */
export function waitingLabel(reason: string | null): string {
  const what = reason === "ContainerCreating" ? "creating" : "pulling image";
  return `Waiting for container (${what})`;
}

export function waitingText(seconds: number, reason: string | null): string {
  const what = reason === "ContainerCreating" ? "creating" : "pulling image";
  return `Waiting for container (${what}, ${seconds}s)`;
}

/** Debug containers as Container rows for the Containers tab and the Logs / Shell selectors (`[debug]`). */
export function debugAsContainers(list: readonly EphemeralContainerInfo[] | undefined): Container[] {
  return (list ?? []).map((e) => ({
    name: e.name,
    image: e.image,
    status: e.state,
    ready: e.state === "running",
    restart_count: 0,
    is_init: false,
    is_debug: true,
    ports: [],
  }));
}
