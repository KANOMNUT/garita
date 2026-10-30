/**
 * Which History entry is the revision the Application is running now (ARGO-7, user decision Q11 A).
 *
 * `ArgoCdApp.last_commit` and `ArgoCdHistoryEntry.revision` are both produced by `short_revision` in `argocd.rs`
 * (only a 40-hex SHA is shortened to 7 characters; a chart version, tag or branch name stays whole), so for one
 * revision the two strings are equal and an exact match is the whole rule. Never compare a prefix: `10.11.1` is
 * not `10.11.12`.
 */

import type { ArgoCdHistoryEntry } from "../types/k8s";

/** What the backend prints for "no revision". It must never match an entry. */
const NO_REVISION = new Set(["", "—"]);

/**
 * The `id` of the entry whose `revision` equals `lastCommit` exactly, or null when nothing matches (no chip then).
 * The same revision can appear in several entries (a sync that changed nothing, or a rollback and a later sync);
 * the highest `id` is the latest deployment, so that one is "Current". Comparing `id` rather than list position
 * keeps this independent of the order the backend returns.
 */
export function liveHistoryId(history: readonly Pick<ArgoCdHistoryEntry, "id" | "revision">[], lastCommit: string): number | null {
  if (NO_REVISION.has(lastCommit)) return null;
  let best: number | null = null;
  for (const entry of history) {
    if (entry.revision !== lastCommit) continue;
    if (best === null || entry.id > best) best = entry.id;
  }
  return best;
}
