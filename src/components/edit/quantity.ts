// Kubernetes Quantity helpers for the PVC grow-only check.
//
// Lives in its own .ts file (no JSX) for one reason: scripts/check-emit.ts runs
// under Node's native type-stripping, which strips TYPES but not JSX — so
// nothing in a .tsx file is importable there. Parsing a Quantity is
// non-trivial logic on a data path (get it wrong and the UI permits a shrink
// the API server rejects, or blocks a legal grow), so it needs a durable test
// rather than a throwaway script. Same no-React/no-JSX rule as edit/patch.ts.

export const UNITS = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"] as const;
export type Unit = (typeof UNITS)[number];

const BINARY_MULT: Record<Unit, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };
const DECIMAL_MULT: Record<string, number> = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

export function unitMultiplier(u: Unit): number {
  return BINARY_MULT[u];
}

// Accepts both binary (Ki/Mi/Gi/...) and decimal (k/M/G/...) suffixes, or a
// bare byte count — a PVC hand-applied via kubectl/YAML can carry either, and
// 1Gi != 1G, so a lexicographic compare is wrong in both directions.
//
// Returns null for anything it cannot parse, INCLUDING the legal-but-rare
// exponent form ("1e9"). Callers treat null as "no floor", i.e. this fails
// OPEN: the client permits the edit and the API server rejects it with a clear
// message. That is the correct failure direction — the alternative (fail
// closed) would block a legal grow on an unparseable current value.
// ponytail: regex over a full Quantity grammar; widen only if a real cluster
// value shows up that this rejects.
export function quantityToBytes(q: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?$/.exec(q.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const suffix = m[2];
  if (!suffix) return n;
  return n * (BINARY_MULT[suffix as Unit] ?? DECIMAL_MULT[suffix]);
}

// Splits a quantity into {amount, unit} ONLY when it already uses one of our
// binary suffixes — used purely to seed the picker with a clean starting value.
// A quantity in a decimal suffix or bare bytes still participates in the
// grow-only check correctly (quantityToBytes handles it); it just can't be
// represented in the two-field widget, so the picker starts blank.
export function splitQuantity(q: string): { amount: string; unit: Unit } {
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei)$/.exec(q.trim());
  if (!m) return { amount: "", unit: "Gi" };
  return { amount: m[1], unit: m[2] as Unit };
}

// Full Quantity grammar (the BNF comment in
// apimachinery/pkg/api/resource/quantity.go):
//   <quantity>        ::= <signedNumber><suffix>
//   <number>          ::= <digits> | <digits>.<digits> | <digits>. | .<digits>
//   <suffix>          ::= <binarySI> | <decimalExponent> | <decimalSI>
//   <binarySI>        ::= Ki | Mi | Gi | Ti | Pi | Ei
//   <decimalSI>       ::= m | "" | k | M | G | T | P | E
//   <decimalExponent> ::= "e" <signedNumber> | "E" <signedNumber>
// This is the primitive that closes the create/edit-form "1000x" bug: typing
// "100m" (100 millicores) into a NumberField (digits-only) silently became
// "100" (100 WHOLE cores). CPU/memory are Quantities, not numbers.
//
// ponytail: the exponent form is a plain [eE][+-]?\d+ rather than the full
// recursive <signedNumber> the BNF allows (e.g. "1e1.5" is technically
// grammar-adjacent but not a real Quantity) — stricter than upstream here is
// fine, looser would not be.
const QUANTITY_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)((Ki|Mi|Gi|Ti|Pi|Ei)|[mkMGTPE]|([eE][+-]?\d+))?$/;

// "" -> "" (blank means "omit this key", not an error — same contract as
// NumberField). A leading "-" is rejected outright: every caller of this is
// a resource request/limit, which upstream requires to be non-negative
// (ValidateResourceQuantityValue -> ValidateNonnegativeQuantity).
export function validateQuantity(v: string): string {
  const t = v.trim();
  if (t === "") return "";
  if (t.startsWith("-")) return "Must not be negative";
  if (!QUANTITY_RE.test(t)) return "Invalid quantity (e.g. 100m, 128Mi, 4)";
  return "";
}
