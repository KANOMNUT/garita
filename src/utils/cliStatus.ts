import type { CliStatus } from "../types/k8s";
import { CLI_COMMAND_NAME as CMD } from "../brand";

/** Settings -> Command line: what to show for a CliStatus. Copy: docs/ux/13-v2.1.3-preflight.md #8. */
export interface CliView {
  tone: "ok" | "warn" | "plain";
  text: string;
  /** Muted line under the status. */
  helper: string | null;
  /** Install button label (macOS only), null = no button. */
  action: string | null;
  copy: string | null;
  /** CopyLine button label. */
  copyLabel: string;
}

const view = (tone: CliView["tone"], text: string, o: Partial<CliView> = {}): CliView =>
  ({ tone, text, helper: null, action: null, copy: null, copyLabel: "Copy command", ...o });

/** `afterInstall`: s is the result of install_cli_command, so on_path=false means it could not write. */
export function cliView(s: CliStatus, afterInstall: boolean): CliView {
  switch (s.method) {
    case "symlink": {
      const path = s.resolved_path;
      if (s.on_path) return view("ok", `✓ ${CMD} is installed at ${path}.`, { helper: `To remove it, delete ${path}.` });
      // A different resolved_path is an earlier garita shadowing ours on PATH, not a write failure (N10).
      if (afterInstall && s.manual_command && (!path || path === "/usr/local/bin/garita")) {
        return view("plain", "Garita can't write to /usr/local/bin. Run this in a terminal:", { copy: s.manual_command });
      }
      if (path) return view("warn", `▲ ${path} doesn't point to this copy of Garita.`, { action: `Reinstall the "${CMD}" command` });
      return view("plain", `The ${CMD} command isn't installed.`, { helper: `Creates a link at /usr/local/bin/${CMD} to the app.`, action: `Install the "${CMD}" command` });
    }
    case "package":
      return s.on_path
        ? view("ok", `✓ ${CMD} is on your PATH (installed by the package).`)
        : view("warn", `▲ ${CMD} isn't on your PATH. Reinstall the Garita package to restore /usr/bin/${CMD}.`);
    case "manual":
      return view("plain", "An AppImage doesn't add a command. To add one, run this in a terminal:", {
        helper: "Make sure ~/.local/bin is on your PATH.", copy: s.manual_command,
      });
    case "installer":
      return s.on_path
        ? view("ok", `✓ The installer added ${CMD} to your PATH. If the command isn't found yet, open a new terminal window.`)
        : view("warn", `▲ ${CMD} isn't on your PATH. Reinstall Garita, or add its install folder to your user PATH.`, { copy: s.manual_command, copyLabel: "Copy folder" });
  }
}

export const CLI_STATUS_FAILED = "Couldn't check the command-line setup.";
export const CLI_TRY_IT = [`${CMD} --context prod -n kube-system pods`, `${CMD} --help`];
