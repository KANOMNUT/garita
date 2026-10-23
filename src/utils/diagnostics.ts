// Pure copy for the Settings > Diagnostics section (docs/ux/00 §7.2, 03 §13.3).
import type { LogSettings } from "../types/k8s";

export const DEBUG_NOTE = "Debug logs are larger and may include request URLs. Switch back to Info when done.";
export const NO_LOG_FILE_REASON = "No log file has been written yet.";

/** "Keeps up to 5 files of 5 MiB each. Older files are deleted." Built only from supplied numbers. */
export function retentionLine(s: Pick<LogSettings, "max_files" | "max_file_bytes">): string {
  const mib = s.max_file_bytes / (1024 * 1024);
  const size = Number.isInteger(mib) ? `${mib} MiB` : `${mib.toFixed(1)} MiB`;
  return `Keeps up to ${s.max_files} files of ${size} each. Older files are deleted.`;
}
