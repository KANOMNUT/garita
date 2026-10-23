// Appearance preference (v1.4.2): theme + accent, stored per viewer in localStorage.
// The inline <script> in app.html repeats ONLY the storage key, the allowed values and the
// resolve rule (system -> matchMedia, unreadable -> dark); keep the two in step.
import { useSyncExternalStore } from "react";

export const STORAGE_KEY = "appearance";
export const THEMES = ["system", "light", "dark"] as const;
export const ACCENTS = ["blue", "teal", "violet", "amber", "rose", "slate"] as const;
export type ThemePref = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type ResolvedTheme = "light" | "dark";
export interface Appearance { theme: ThemePref; accent: Accent }

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", accent: "blue" };

/** Per-field fallback: a corrupt record, or an unknown value in one field, never breaks the other. */
export function parseAppearance(raw: string | null): Appearance {
  let o: unknown;
  try { o = raw ? JSON.parse(raw) : null; } catch { o = null; }
  const r = (typeof o === "object" && o !== null ? o : {}) as Record<string, unknown>;
  return {
    theme: (THEMES as readonly unknown[]).includes(r.theme) ? (r.theme as ThemePref) : DEFAULT_APPEARANCE.theme,
    accent: (ACCENTS as readonly unknown[]).includes(r.accent) ? (r.accent as Accent) : DEFAULT_APPEARANCE.accent,
  };
}

export function resolveTheme(theme: ThemePref, osDark: boolean): ResolvedTheme {
  return theme === "system" ? (osDark ? "dark" : "light") : theme;
}

const MQ = "(prefers-color-scheme: dark)";
/** matchMedia missing or throwing reads as dark. */
function osDark(): boolean {
  try { return window.matchMedia(MQ).matches; } catch { return true; }
}

function readStored(): Appearance {
  try { return parseAppearance(localStorage.getItem(STORAGE_KEY)); } catch { return DEFAULT_APPEARANCE; }
}

export interface AppearanceState extends Appearance {
  resolved: ResolvedTheme;
  /** The last write to localStorage failed: the choice applies until the app closes. */
  saveFailed: boolean;
}

// One cached snapshot object, replaced only when something changes. useSyncExternalStore
// compares getSnapshot() results by identity, so returning a fresh object per call would loop.
let state: AppearanceState = build(readStored(), false);
const listeners = new Set<() => void>();

function build(a: Appearance, saveFailed: boolean): AppearanceState {
  return { ...a, resolved: resolveTheme(a.theme, osDark()), saveFailed };
}

function apply(s: AppearanceState) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", s.resolved);
  document.documentElement.setAttribute("data-accent", s.accent);
}

// DOM first, then listeners: a subscriber (the terminal) reads computed CSS variables.
function commit(next: AppearanceState) {
  if (next.theme === state.theme && next.accent === state.accent && next.resolved === state.resolved && next.saveFailed === state.saveFailed) return;
  state = next;
  apply(state);
  listeners.forEach((fn) => fn());
}

/** Call once at startup: syncs the DOM with the store and follows the OS while theme is "system". */
export function initAppearance() {
  apply(state);
  try {
    window.matchMedia(MQ).addEventListener("change", () => commit(build(state, state.saveFailed)));
  } catch {}
}

export function setAppearance(patch: Partial<Appearance>) {
  const a: Appearance = { theme: patch.theme ?? state.theme, accent: patch.accent ?? state.accent };
  let failed = false;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)); } catch { failed = true; }
  commit(build(a, failed));
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const getSnapshot = () => state;

export function useAppearance(): AppearanceState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
