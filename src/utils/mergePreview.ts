// Merge-from-file change preview (docs/plan-kubeconfig-and-parity.md §3.1).
//
// React/JSX-free so scripts/check-emit.ts can import it directly under
// Node's native TS type-stripping (strips types, not JSX) — same
// dependency direction as create/emit.ts and edit/patch.ts.
//
// deepEqual is duplicated from edit/patch.ts on purpose rather than
// imported: that file's header keeps its exported surface deliberately
// narrow (mergePatch/applyMergePatch only) so nobody "improves" a shared
// helper in a way that changes patch semantics. Twelve lines duplicated is
// cheaper than that risk.

import type { DiffRow } from "./diffRows";
import { isSecretMaskedPath, maskSecretValue } from "./diffRows.ts";

// Re-typed onto the shared DiffRow (F3). The state set stays NARROWER on purpose: Merge
// from file never renders a `removed` row from absence (00 §3.5) and never `dropped`.
// `import type` only — check-emit.ts loads this file under Node type-stripping.
export type PreviewRow = DiffRow & {
  to: string;
  state: "added" | "changed" | "unchanged" | "replaced";
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

function stringify(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Flattens `desired` into leaf rows, each compared against `live` at the
 * same path. A JSON merge patch (RFC 7386) only ever SETS the keys present
 * in `desired` — it never removes a key `desired` simply omits — so this
 * walks `desired`'s own shape only; a live-only key is never reported as a
 * pending removal (it would need an explicit `null` in the file for that,
 * which is a "changed" row like any other).
 *
 * Plain objects are walked (not leaves); arrays and scalars are leaves.
 * Arrays are NEVER diffed element-wise: merge patch replaces an array
 * wholesale, so a row implying an element-wise merge would misdescribe what
 * "Merge" is about to do. Their state is "replaced", never "changed".
 */
export function previewRows(live: unknown, desired: unknown, path = "", maskSecret = false): PreviewRow[] {
  const rows = walkRows(live, desired, path);
  if (!maskSecret) return rows;
  // #33 (B-5): a Secret document's values (and its last-applied annotation) never print, from or to.
  // The row state is computed on the real values first, so changed/unchanged stays true.
  return rows.map((r) =>
    isSecretMaskedPath(r.path)
      ? { ...r, from: r.from === null ? null : maskSecretValue(r.path, r.from), to: maskSecretValue(r.path, r.to), masked: "secret" as const }
      : r,
  );
}

function walkRows(live: unknown, desired: unknown, path: string): PreviewRow[] {
  const rows: PreviewRow[] = [];

  if (isPlainObject(desired)) {
    for (const k of Object.keys(desired)) {
      const childPath = path ? `${path}.${k}` : k;
      const desiredChild = desired[k];
      const liveHasKey = isPlainObject(live) && Object.prototype.hasOwnProperty.call(live, k);
      const liveChild = liveHasKey ? (live as Record<string, unknown>)[k] : undefined;

      if (isPlainObject(desiredChild)) {
        rows.push(...walkRows(liveChild, desiredChild, childPath));
        continue;
      }

      if (!liveHasKey) {
        rows.push({ path: childPath, from: null, to: stringify(desiredChild), state: "added" });
        continue;
      }
      if (deepEqual(liveChild, desiredChild)) {
        rows.push({ path: childPath, from: stringify(liveChild), to: stringify(desiredChild), state: "unchanged" });
        continue;
      }
      const isArrayLeaf = Array.isArray(desiredChild) || Array.isArray(liveChild);
      rows.push({
        path: childPath,
        from: stringify(liveChild),
        to: stringify(desiredChild),
        state: isArrayLeaf ? "replaced" : "changed",
      });
    }
    return rows;
  }

  // `desired` at this path isn't a plain object — a scalar/array document
  // root, or the bottom of the recursion. Treat it as one leaf row.
  if (live === undefined) {
    rows.push({ path: path || "(root)", from: null, to: stringify(desired), state: "added" });
  } else if (deepEqual(live, desired)) {
    rows.push({ path: path || "(root)", from: stringify(live), to: stringify(desired), state: "unchanged" });
  } else {
    const isArrayLeaf = Array.isArray(desired) || Array.isArray(live);
    rows.push({
      path: path || "(root)",
      from: stringify(live),
      to: stringify(desired),
      state: isArrayLeaf ? "replaced" : "changed",
    });
  }
  return rows;
}
