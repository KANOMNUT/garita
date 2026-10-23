import { describe, expect, it } from "vitest";
import SOURCE from "./useResources.ts?raw";

// The read-only backstop is a PROPERTY (v1.3.1 C-7/C-8), not a promise: every command that
// changes cluster state is invoked through invokeWrite() in useResources.ts, which refuses
// while read-only is on. This test scans the source so a new write command that calls raw
// invoke() fails here.

// Commands that are NOT cluster writes, with the reason each is exempt.
const EXEMPT: Record<string, string> = {
  add_kubeconfig_path: "app-local registry; must stay reachable so read-only can be turned off",
  add_kubeconfig_yaml: "app-local registry",
  remove_kubeconfig: "app-local registry",
  set_kubeconfig_enabled: "app-local registry",
  set_log_level: "app-local diagnostics; Settings must stay reachable under read-only",
  install_cli_command: "local symlink in /usr/local/bin, not a cluster write; works read-only",
  start_pod_port_forward: "opens a local listener, changes no cluster object",
  start_service_port_forward: "opens a local listener, changes no cluster object",
  stop_port_forward: "local listener",
  write_to_shell: "acts on an already-open session; turning read-only on ends those instead",
  resize_shell: "already-open session",
  stop_shell_session: "already-open session",
  start_shell_session: "guards itself in startShellSession (D3-7 is a switch: READ_ONLY_BLOCKS_SHELL)",
};

const WRITE_VERBS = /^(create_|delete_|apply_|patch_|cordon_|uncordon_|add_|remove_|scale_|restart_|pause_|resume_|rollback_|sync_|refresh_|trigger_|install_|uninstall_|upgrade_|evict_|start_|set_)/;

function calls(): { fn: string; command: string }[] {
  const out: { fn: string; command: string }[] = [];
  const re = /\b(invokeWrite|invoke)(?:<[^>(]*>)?\(\s*"([a-z_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SOURCE)) !== null) out.push({ fn: m[1], command: m[2] });
  return out;
}

describe("write backstop", () => {
  const all = calls();

  it("finds the calls it scans for", () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((c) => c.fn === "invokeWrite")).toBe(true);
  });

  it("sends every write command through invokeWrite, never raw invoke", () => {
    const raw = all.filter((c) => c.fn === "invoke" && WRITE_VERBS.test(c.command) && !(c.command in EXEMPT));
    expect(raw).toEqual([]);
  });

  it("uses invokeWrite only for commands that write", () => {
    const wrapped = all.filter((c) => c.fn === "invokeWrite");
    expect(wrapped.filter((c) => c.command in EXEMPT)).toEqual([]);
    expect(wrapped.filter((c) => !WRITE_VERBS.test(c.command))).toEqual([]);
  });

  it("guards the shell start behind the D3-7 switch", () => {
    expect(SOURCE).toMatch(/if \(READ_ONLY_BLOCKS_SHELL\) \{\s*try \{\s*assertWritable\(args\.context\)/);
  });

  it("checks once up front in the bulk hooks, not per row", () => {
    expect(SOURCE).toMatch(/if \(pods\.length > 0\) assertWritable\(pods\[0\]\.context\)/);
    expect(SOURCE).toMatch(/if \(apps\.length > 0\) assertWritable\(apps\[0\]\.context\)/);
  });

  it("keeps previews and can_i out of the backstop (reads)", () => {
    const wrapped = all.filter((c) => c.fn === "invokeWrite").map((c) => c.command);
    expect(wrapped.some((c) => c.startsWith("preview_") || c === "can_i")).toBe(false);
  });
});
