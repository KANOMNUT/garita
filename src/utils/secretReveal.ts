// #33 (B-6, B-7): pure helpers for the Secret reveal and the Helm Values reveal.
import type { QueryClient } from "@tanstack/react-query";

/** Mirrors Rust `HELM_REDACTION_SENTINEL` (helm.rs). */
export const HELM_REDACTION_SENTINEL = "<redacted>";
/** Mirrors Rust `LEGACY_HELM_REDACTION_SENTINEL`. Written by v1.x, so it is refused and detected forever (hard rule: a redacted values file is never pushed). The old product name is deliberate here. */
export const LEGACY_HELM_REDACTION_SENTINEL = "<redacted by Watchtower>";

/** True when `text` still holds a redaction placeholder, current or legacy. */
export function hasRedactionSentinel(text: string): boolean {
  return text.includes(HELM_REDACTION_SENTINEL) || text.includes(LEGACY_HELM_REDACTION_SENTINEL);
}

/** 12 bytes · 1.2 KiB · empty value. The mask never reflects length; only this does. */
export function formatSecretSize(n: number): string {
  if (n <= 0) return "empty value";
  if (n === 1) return "1 byte";
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

/** The Helm editor seed. Reads ONLY the revealed key: the redacted text can never feed an editor. */
export function helmEditSeed(qc: QueryClient, context: string, namespace: string, release: string): string {
  return qc.getQueryData<string>(["helm-values", context, namespace, release, "revealed"]) ?? "";
}
