// FROZEN CONTRACT (docs/plan-guided-edit.md §4.1). This is the single choke
// point between form state and the wire for the whole guided-edit feature:
// every value in an emitted patch either came from the live object verbatim
// (untouched fields, and untouched sibling array elements) or is exactly
// what the user typed, because ResourceEditor is the ONLY caller and it
// diffs a clone-and-mutated copy of the live object, never a re-serialised
// one. Do NOT add an element-wise array merge here — RFC 7386 replaces
// arrays wholesale, and "improving" that here is precisely the data-loss bug
// this feature exists to close (see docs/plan-guided-edit.md §1.1).
//
// This file MUST stay React/JSX-free and MUST import nothing from
// `registry.ts` (which pulls in JSX), so `scripts/check-emit.ts` can import
// it directly under Node 24's native TS type-stripping. Mirrors the existing
// `emit.ts` (no React) / `fields.tsx` (React) split and its fixed dependency
// direction. Do not let it drift.
//
// `mergePatch` returns `undefined` when nothing changed, so a caller can
// distinguish "no change" from "empty object". Per §4.1, normalise that away
// exactly ONCE, at the host (`ResourceEditor` does
// `const patch = mergePatch(live, next) ?? {}`) — everything downstream
// (preview, empty-check, invoke) should see a plain object, never
// `undefined`. Do not add a second `?? {}` anywhere else; a stray
// `undefined` leaking past the host is the failure mode this note exists to
// prevent (`Object.keys(undefined)` throws).

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

/** RFC 7386 diff. Returns the minimal merge patch turning `orig` into `next`,
 *  or `undefined` when they are deep-equal.
 *  - object: recurse; keys in `orig` missing from `next` emit `null` (the
 *    RFC 7386 delete sentinel); keys equal in both are omitted.
 *  - array: NO element-wise merge (RFC 7386 has none). Deep-equal → omitted;
 *    otherwise the whole `next` array is emitted.
 *  - scalar: emitted when different.
 */
export function mergePatch(orig: unknown, next: unknown): unknown | undefined {
  if (deepEqual(orig, next)) return undefined;

  if (isPlainObject(orig) && isPlainObject(next)) {
    const patch: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(orig), ...Object.keys(next)]);
    for (const k of keys) {
      const inOrig = Object.prototype.hasOwnProperty.call(orig, k);
      // A key explicitly set to `undefined` is treated the same as an
      // absent key: JSON has no `undefined`, so `next.spec.foo = undefined`
      // is the other intuitive way a form clears a field (alongside
      // `delete next.spec.foo`). Without this, `hasOwnProperty` alone would
      // say the key is present, mergePatch would try to diff against
      // `undefined`, and `patch[k] = undefined` would then be silently
      // dropped by JSON serialisation at the Tauri IPC boundary — the field
      // would be left alone on the server with no error anywhere. Same
      // failure class §3.3 exists to prevent.
      const inNext = Object.prototype.hasOwnProperty.call(next, k) && next[k] !== undefined;
      if (inOrig && !inNext) {
        // RFC 7386 delete sentinel. Omitting the key instead would mean
        // "leave it alone" — this is the single most likely correctness bug
        // in the feature (docs/plan-guided-edit.md §3.3).
        patch[k] = null;
      } else if (!inOrig && inNext) {
        patch[k] = next[k];
      } else {
        const sub = mergePatch(orig[k], next[k]);
        if (sub !== undefined) patch[k] = sub;
      }
    }
    return Object.keys(patch).length > 0 ? patch : undefined;
  }

  // Arrays (no element-wise merge — whole array wins), scalars, and
  // object<->non-object type changes all fall through to a wholesale
  // replace with `next`; the deepEqual check above already ruled out "no
  // change".
  return next;
}

/** RFC 7386 apply. Exists ONLY as the test oracle for scripts/check-emit.ts —
 *  the app never applies a patch locally. `null` deletes the key, a plain
 *  object recurses, anything else replaces.
 */
export function applyMergePatch(doc: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const result: Record<string, unknown> = isPlainObject(doc) ? { ...doc } : {};
  for (const key of Object.keys(patch)) {
    const v = patch[key];
    if (v === null) delete result[key];
    else if (isPlainObject(v)) result[key] = applyMergePatch(result[key], v);
    else result[key] = v;
  }
  return result;
}
