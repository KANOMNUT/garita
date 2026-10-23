// Download text and filenames for the log viewers (docs/impl/v1.3.1-tasks.md §0.3 UXP-3, 14).
// Pure. "Visible lines" downloads the `raw` lines (timestamp prefix as received); the
// filename gets `-filtered`. Multi-pod writes `{podName} {raw}` per line.

export interface DownloadLine { raw: string; pod?: string }

export function downloadText(lines: readonly DownloadLine[]): string {
  return lines.map((l) => (l.pod ? `${l.pod} ${l.raw}` : l.raw)).join("\n");
}

export function singleFilename(pod: string, container: string, previous: boolean, filtered: boolean): string {
  return `${pod}-${container}${previous ? "-previous" : ""}${filtered ? "-filtered" : ""}.log`;
}

export function multiFilename(namespace: string, container: string, podCount: number, filtered: boolean): string {
  return `${namespace}-${container}-${podCount}pods${filtered ? "-filtered" : ""}.log`;
}

/** No filter active: one plain button (null). A filter active: a two-item menu with real counts. */
export function downloadMenuItems(loaded: number, visible: number, filtering: boolean): { id: "all" | "visible"; label: string }[] | null {
  if (!filtering) return null;
  const n = (x: number) => x.toLocaleString("en-US");
  return [
    { id: "all", label: `All loaded lines (${n(loaded)})` },
    { id: "visible", label: `Visible lines (${n(visible)})` },
  ];
}
