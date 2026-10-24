import { describe, expect, it } from "vitest";
import type { CliStatus } from "../types/k8s";
import { cliView } from "./cliStatus";

const s = (p: Partial<CliStatus>): CliStatus => ({ method: "symlink", on_path: false, resolved_path: null, manual_command: null, path_hint: null, ...p });

describe("cliView", () => {
  it("mac installed prints resolved_path, not a hard-coded one", () => {
    const v = cliView(s({ on_path: true, resolved_path: "/opt/homebrew/bin/garita", manual_command: "sudo ln" }), false);
    expect(v).toMatchObject({ tone: "ok", text: "✓ garita is installed at /opt/homebrew/bin/garita.", helper: "To remove it, delete /opt/homebrew/bin/garita.", action: null, copy: null });
  });
  it("mac not installed offers Install, no copy line even though manual_command is set", () => {
    const v = cliView(s({ manual_command: "sudo ln -s a b" }), false);
    expect(v).toMatchObject({ tone: "plain", action: 'Install the "garita" command', copy: null });
  });
  it("mac stale link offers Reinstall", () => {
    expect(cliView(s({ resolved_path: "/usr/local/bin/garita", manual_command: "x" }), false))
      .toMatchObject({ tone: "warn", text: "▲ /usr/local/bin/garita doesn't point to this copy of Garita.", action: 'Reinstall the "garita" command' });
  });
  it("mac install denied (Ok, on_path false, manual_command) shows the copy line", () => {
    expect(cliView(s({ manual_command: "sudo ln -s a b" }), true))
      .toMatchObject({ text: "Garita can't write to /usr/local/bin. Run this in a terminal:", copy: "sudo ln -s a b", action: null, helper: null });
  });
  it("standard account: per-user line plus the profile line to add, never a sudo line", () => {
    const line = "mkdir -p ~/.local/bin && ln -s 'x' ~/.local/bin/garita";
    const hint = 'export PATH="$HOME/.local/bin:$PATH"';
    expect(cliView(s({ manual_command: line, path_hint: hint }), true)).toMatchObject({
      copy: line,
      helper: `Then add this line to ~/.zprofile, open a new terminal window and reopen Garita: ${hint}`,
      action: null,
    });
    // ~/.local/bin already on PATH: no profile line
    expect(cliView(s({ manual_command: line }), true).helper).toBeNull();
  });
  it("not installed: the helper names both link folders", () => {
    expect(cliView(s({}), false).helper).toBe(
      "Creates a link to the app at /usr/local/bin/garita, or in ~/.local/bin or ~/bin when Garita can't write there and that folder is on your PATH.",
    );
  });
  it("denied install with a different resolved_path (shadowing garita) is stale, not 'can't write'", () => {
    expect(cliView(s({ resolved_path: "/opt/homebrew/bin/garita", manual_command: "x" }), true))
      .toMatchObject({ tone: "warn", copy: null, action: 'Reinstall the "garita" command' });
    expect(cliView(s({ resolved_path: "/usr/local/bin/garita", manual_command: "x" }), true).copy).toBe("x");
  });
  it("linux package found / missing", () => {
    expect(cliView(s({ method: "package", on_path: true }), false).tone).toBe("ok");
    expect(cliView(s({ method: "package" }), false).tone).toBe("warn");
  });
  it("appimage shows the command and hint", () => {
    expect(cliView(s({ method: "manual", manual_command: "ln -s x ~/.local/bin/garita" }), false))
      .toMatchObject({ copy: "ln -s x ~/.local/bin/garita", helper: "Make sure ~/.local/bin is on your PATH." });
  });
  it("windows found / not found with folder", () => {
    expect(cliView(s({ method: "installer", on_path: true }), false).tone).toBe("ok");
    const dir = String.raw`C:\Program Files\Garita`;
    expect(cliView(s({ method: "installer", manual_command: dir }), false)).toMatchObject({ tone: "warn", copy: dir, copyLabel: "Copy folder", action: null });
  });
});
