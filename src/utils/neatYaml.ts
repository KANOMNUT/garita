// #6 neat YAML — pure helpers (docs/ux/03-diffs-write-safety.md §4, copy §17.6).
// DISPLAY ONLY: the neat text comes from get_resource_yaml_neat. The editor seed and
// Save always use get_resource_yaml; neat data never reaches apply_resource_yaml.

/** The closed list get_resource_yaml_neat removes, in the backend's order. */
export const NEAT_HIDDEN_PATHS = [
  "metadata.managedFields",
  "metadata.annotations.kubectl.kubernetes.io/last-applied-configuration",
  "status",
  "metadata.uid",
  "metadata.resourceVersion",
  "metadata.generation",
  "metadata.creationTimestamp",
] as const;

const PREF_KEY = "yaml-neat";

/** D3-2: off by default, remembered per viewer (localStorage, always in try/catch). */
export function loadNeatPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveNeatPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* per-viewer convenience only */
  }
}

/** "Hiding managedFields, status and 3 other fields. Display only; editing shows the full object." */
export function neatNote(hidden: readonly string[]): string {
  if (hidden.length === 0) {
    return "Nothing to hide on this object. Display only; editing shows the full object.";
  }
  const named = [
    hidden.includes("metadata.managedFields") ? "managedFields" : null,
    hidden.includes("status") ? "status" : null,
  ].filter((x): x is string => x !== null);
  const others = hidden.length - named.length;
  const head = named.length === 2 ? "managedFields and status" : named.join("");
  let what: string;
  if (named.length === 0) what = `${others} field${others === 1 ? "" : "s"}`;
  else if (others === 0) what = head;
  else what = `${named.length === 2 ? "managedFields, status" : head} and ${others} other field${others === 1 ? "" : "s"}`;
  return `Hiding ${what}. Display only; editing shows the full object.`;
}
