// Cluster identity — prod-accident guard (docs/plan-kubeconfig-and-parity.md §2.3).
//
// A per-context color + label the user can set once, surfaced on every destructive
// action's confirmation dialog plus the Sidebar chip and TopBar rule, so "wrong
// cluster" is visually obvious before a click lands.
//
// Colors are stored as NAMES of existing tailwind.config.js design tokens, never as
// hex values — every consumer maps a name to a literal Tailwind class string via
// CLUSTER_COLOR_CLASSES below. That is what keeps this feature "Tailwind classes
// only, zero inline styles" without inventing a palette: the literal class strings
// live in this file's source, so Tailwind's content scanner picks them up at build
// time even though the color is chosen at runtime.
import { useCallback, useEffect, useState } from "react";
import type { LogLabelMap, LogsTarget, Observability, ServiceTarget } from "../types/k8s";

// Order is the legacy order (accent, ok, warn, orange, bad, purple): defaultColorFor hashes into it,
// so reordering would recolour every unconfigured context.
export const IDENTITY_ROLES = ["identity-blue", "identity-green", "identity-yellow", "identity-orange", "identity-red", "identity-purple"] as const;
export type IdentityRole = (typeof IDENTITY_ROLES)[number];

// Names stored by v1.3.1..v1.4.1. Read-only: no migration, new writes use role names.
export const LEGACY_IDENTITY_ALIAS: Record<string, IdentityRole> = {
  accent: "identity-blue", ok: "identity-green", warn: "identity-yellow",
  orange: "identity-orange", bad: "identity-red", purple: "identity-purple",
};

// Accessible swatch names (the swatches are colour-only buttons).
export const IDENTITY_ROLE_LABELS: Record<IdentityRole, string> = {
  "identity-blue": "Blue", "identity-green": "Green", "identity-yellow": "Yellow",
  "identity-orange": "Orange", "identity-red": "Red", "identity-purple": "Purple",
};

export const CLUSTER_COLOR_CLASSES: Record<
  IdentityRole,
  { dot: string; chipBg: string; chipRing: string; text: string }
> = {
  "identity-blue":   { dot: "bg-identity-blue",   chipBg: "bg-identity-blue/20",   chipRing: "ring-identity-blue/40",   text: "text-identity-blue" },
  "identity-green":  { dot: "bg-identity-green",  chipBg: "bg-identity-green/20",  chipRing: "ring-identity-green/40",  text: "text-identity-green" },
  "identity-yellow": { dot: "bg-identity-yellow", chipBg: "bg-identity-yellow/20", chipRing: "ring-identity-yellow/40", text: "text-identity-yellow" },
  "identity-orange": { dot: "bg-identity-orange", chipBg: "bg-identity-orange/20", chipRing: "ring-identity-orange/40", text: "text-identity-orange" },
  "identity-red":    { dot: "bg-identity-red",    chipBg: "bg-identity-red/20",    chipRing: "ring-identity-red/40",    text: "text-identity-red" },
  "identity-purple": { dot: "bg-identity-purple", chipBg: "bg-identity-purple/20", chipRing: "ring-identity-purple/40", text: "text-identity-purple" },
};

export interface ClusterIdentity {
  color: IdentityRole;
  label: string;
}

// v1.3.1 guardrails (docs/ux/03 §11): stored on the SAME per-context record as color
// and label. Nothing defaults on and nothing is inferred from the label or colour.
export interface GuardrailSettings {
  /** Disables the app's write actions for this cluster. A guardrail, not a security boundary. */
  readOnly: boolean;
  /** Every write dialog needs the cluster label typed. */
  typedConfirm: boolean;
  /** Bulk selections above this are refused. null = off. 1..500. */
  bulkLimit: number | null;
}

export const GUARDRAILS_OFF: GuardrailSettings = { readOnly: false, typedConfirm: false, bulkLimit: null };
export const BULK_LIMIT_MIN = 1;
export const BULK_LIMIT_MAX = 500;

export function isValidBulkLimit(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= BULK_LIMIT_MIN && n <= BULK_LIMIT_MAX;
}

const STORAGE_KEY = "cluster-identity";

// The stored entry keeps fields this module does not own (00 Q4): the writer spreads it.
type StoredEntry = Record<string, unknown> & {
  color?: unknown;
  label?: string;
  readOnly?: boolean;
  typedConfirm?: boolean;
  bulkLimit?: number | null;
};
type Store = Record<string, StoredEntry>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parses the stored text. `corrupt` is true when the text exists but is not a record of
 * records — "empty" (never written) and "corrupt" are different states, because the
 * editor shows a one-time note for the second. A corrupt store reads as everything off.
 */
export function parseStore(raw: string | null): { store: Store; corrupt: boolean } {
  if (raw === null || raw === "") return { store: {}, corrupt: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { store: {}, corrupt: true };
  }
  if (!isPlainObject(parsed)) return { store: {}, corrupt: true };
  const store: Store = {};
  let corrupt = false;
  for (const [ctx, entry] of Object.entries(parsed)) {
    if (isPlainObject(entry)) store[ctx] = entry as StoredEntry;
    else corrupt = true;
  }
  return { store, corrupt };
}

export function guardrailsFromEntry(entry: StoredEntry | undefined): GuardrailSettings {
  if (!entry) return GUARDRAILS_OFF;
  return {
    readOnly: entry.readOnly === true,
    typedConfirm: entry.typedConfirm === true,
    bulkLimit: isValidBulkLimit(entry.bulkLimit) ? entry.bulkLimit : null,
  };
}

function readStoreState(): { store: Store; corrupt: boolean } {
  try {
    return parseStore(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { store: {}, corrupt: false };
  }
}

function readStore(): Store {
  return readStoreState().store;
}

/** False when the write failed (quota, blocked storage): the caller must not announce a save. */
function writeStore(store: Store): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

// Deterministic, not random — an unconfigured context must keep the same color
// across reloads, and distinct contexts should spread across the palette instead
// of all defaulting to the same hue.
function defaultColorFor(context: string): IdentityRole {
  let hash = 0;
  for (let i = 0; i < context.length; i++) hash = (hash * 31 + context.charCodeAt(i)) | 0;
  return IDENTITY_ROLES[Math.abs(hash) % IDENTITY_ROLES.length];
}

/** A role or a legacy name reads as its role; anything else falls back to the hash default of `context`. */
export function readIdentityColor(stored: unknown, context: string): IdentityRole {
  if (typeof stored === "string") {
    if ((IDENTITY_ROLES as readonly string[]).includes(stored)) return stored as IdentityRole;
    if (Object.prototype.hasOwnProperty.call(LEGACY_IDENTITY_ALIAS, stored)) return LEGACY_IDENTITY_ALIAS[stored];
  }
  return defaultColorFor(context);
}

// label defaults to the context name (never blank) so the guard is present for
// every context out of the box — it must not be opt-in-only-if-configured.
// `??`, not `||`: an explicitly-cleared label is "" (falsy but SET), and `||`
// would snap it back to the context name on every keystroke while backspacing
// through the last character in the editor.
export function getClusterIdentity(context: string): ClusterIdentity {
  if (!context) return { color: IDENTITY_ROLES[0], label: "" };
  const stored = readStore()[context];
  return {
    color: readIdentityColor(stored?.color, context),
    label: typeof stored?.label === "string" ? stored.label : context,
  };
}

/** Non-React reader (the hook backstop, tests). A corrupt or unreadable store reads as all off. */
export function getGuardrailSettings(context: string): GuardrailSettings {
  if (!context) return GUARDRAILS_OFF;
  return guardrailsFromEntry(readStore()[context]);
}

/** True when the stored record exists but could not be read (editor shows a one-time note). */
export function isGuardrailStoreCorrupt(): boolean {
  return readStoreState().corrupt;
}

/** `observability: null` deletes the key, so clearing both groups leaves no empty object. */
export type IdentityPatch = Partial<ClusterIdentity & GuardrailSettings> & { observability?: Observability | null };

const str = (v: unknown): v is string => typeof v === "string";

function parseTarget(v: unknown): ServiceTarget | undefined {
  if (!isPlainObject(v) || !str(v.namespace) || !str(v.service) || !str(v.port) || !v.namespace || !v.service || !v.port) return undefined;
  const t: ServiceTarget = { namespace: v.namespace, service: v.service, port: v.port };
  if (v.scheme === "http" || v.scheme === "https") t.scheme = v.scheme;
  if (str(v.path_prefix) && v.path_prefix) t.path_prefix = v.path_prefix;
  if (str(v.tenant) && v.tenant) t.tenant = v.tenant;
  return t;
}

/** Tolerant: a wrong shape reads as unset for that half, never as a corrupt store. */
export function parseObservability(v: unknown): Observability | undefined {
  if (!isPlainObject(v)) return undefined;
  const out: Observability = {};
  const prometheus = parseTarget(v.prometheus);
  if (prometheus) out.prometheus = prometheus;
  const l = v.logs;
  if (isPlainObject(l) && (l.flavour === "loki" || l.flavour === "victorialogs") && isPlainObject(l.labels)) {
    const service = parseTarget(l.service);
    const { namespace, pod, container } = l.labels;
    if (service && str(namespace) && str(pod) && str(container)) {
      const labels: LogLabelMap = { namespace, pod, container };
      const logs: LogsTarget = { service, flavour: l.flavour, labels };
      out.logs = logs;
    }
  }
  return out.prometheus || out.logs ? out : undefined;
}

export function observabilityFor(context: string): Observability | undefined {
  return context ? parseObservability(readStore()[context]?.observability) : undefined;
}

// Spreads the stored entry so a field this writer does not own survives (00 Q4). False when the write failed.
export function setClusterIdentity(context: string, patch: IdentityPatch): boolean {
  if (!context) return false;
  const store = readStore();
  const current = getClusterIdentity(context);
  const entry: StoredEntry = { ...(store[context] ?? {}) };
  // Only an explicit pick writes colour: a guardrail toggle must not turn a stored "accent" into "identity-blue" (v1.4.1 rejects that).
  if (patch.color !== undefined) entry.color = patch.color;
  entry.label = patch.label ?? current.label;
  if (patch.readOnly !== undefined) entry.readOnly = patch.readOnly;
  if (patch.typedConfirm !== undefined) entry.typedConfirm = patch.typedConfirm;
  if (patch.bulkLimit !== undefined) entry.bulkLimit = patch.bulkLimit;
  if (patch.observability === null) delete entry.observability;
  else if (patch.observability !== undefined) entry.observability = patch.observability;
  store[context] = entry;
  if (!writeStore(store)) return false;
  notify();
  return true;
}

/** Upgrade seed (RB-3b): every listed context starts read-only. Only `readOnly`; everything else resets. */
export function seedReadOnly(contexts: string[]): Record<string, { readOnly: true }> {
  const out: Record<string, { readOnly: true }> = {};
  for (const c of contexts) if (c) out[c] = { readOnly: true };
  return out;
}

/** True only when nothing was ever stored (not "empty object", not corrupt, not unreadable). */
export function isIdentityStoreUnset(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/**
 * Writes the seed only if the store is still `null`, re-checked right before the write: that
 * check is what makes the seed run once. Returns whether it wrote.
 * ponytail: there is a sub-second window between app start and the seed landing. It is accepted
 * because every write still passes a ConfirmModal. If that is ever not enough, make the read path
 * treat a null store as read-only while detection is pending.
 */
export function writeSeedIfUnset(contexts: string[]): boolean {
  const seed = seedReadOnly(contexts);
  if (Object.keys(seed).length === 0 || !isIdentityStoreUnset()) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  } catch {
    return false;
  }
  try { localStorage.setItem(UPGRADE_NOTICE_KEY, "1"); } catch {}
  notify();
  return true;
}

// The upgrade notice survives a restart: flag set when seeding, removed on dismiss. Session-only if storage fails.
const UPGRADE_NOTICE_KEY = "upgrade-notice";
export function isUpgradeNoticePending(): boolean {
  try { return localStorage.getItem(UPGRADE_NOTICE_KEY) !== null; } catch { return false; }
}
export function dismissUpgradeNotice(): void {
  try { localStorage.removeItem(UPGRADE_NOTICE_KEY); } catch {}
}

// localStorage's own "storage" event fires only in OTHER tabs/windows, never the
// one that wrote it — Sidebar, TopBar and ContextSwitcher can all be mounted at
// once and each needs to see an edit made from any of the others. A tiny
// in-process pub/sub does that job without a new state library.
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}

export function useClusterIdentity(
  context: string,
): ClusterIdentity & GuardrailSettings & {
  /** The context this identity belongs to — passed to ConfirmModal as `context` so guardrails apply. */
  context: string;
  /** The stored record was unreadable; every guardrail reads as off. */
  corrupt: boolean;
  /** Stored observability config (v2.3.0); undefined when unset or unreadable. */
  observability: Observability | undefined;
  setIdentity: (patch: IdentityPatch) => boolean;
} {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const identity = getClusterIdentity(context);
  const guardrails = getGuardrailSettings(context);
  const corrupt = isGuardrailStoreCorrupt();
  const setIdentity = useCallback(
    (patch: IdentityPatch) => setClusterIdentity(context, patch),
    [context],
  );
  return { ...identity, ...guardrails, context, corrupt, observability: observabilityFor(context), setIdentity };
}
