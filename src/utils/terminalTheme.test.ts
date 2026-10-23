// @ts-expect-error no @types/node in this repo
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XTERM_ROLES, terminalContrast, terminalTheme } from "./terminalTheme";

const css: string = readFileSync("src/index.css", "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const block = (sel: string) => css.match(new RegExp(esc(sel) + "\\s*\\{([^}]*)\\}"))![1];
const names = (b: string) => [...b.matchAll(/(--[\w-]+):/g)].map((m) => m[1]);
const darkRoot = block(":root"), lightRoot = block(':root[data-theme="light"]');
const val = (b: string, n: string) => b.match(new RegExp(n + ":\s*([^;]+);"))![1].trim();

describe("terminalTheme", () => {
  it("maps all 21 xterm keys (20 colours + selection)", () => {
    expect(new Set(XTERM_ROLES.map((r) => r[0])).size).toBe(20);
    expect(Object.keys(terminalTheme()).length).toBe(21);
  });
  it("every role resolves in both themes", () => {
    for (const [, role] of XTERM_ROLES) {
      expect(val(darkRoot, `--c-${role}`), role).toMatch(/^\d+ \d+ \d+$/);
      expect(val(lightRoot, `--c-${role}`), role).toMatch(/^\d+ \d+ \d+$/);
    }
  });
  it("the node fallback equals the dark CSS values (dark parity)", () => {
    const t = terminalTheme();
    for (const [key, role] of XTERM_ROLES) {
      const [r, g, b] = val(darkRoot, `--c-${role}`).split(" ").map(Number);
      expect(t[key], key).toBe("#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join(""));
    }
    expect(t.selectionBackground).toBe("rgba(255, 255, 255, 0.3)");
  });
  it("contrast: 4.5 light, 1 dark", () => {
    expect(terminalContrast("light")).toBe(4.5);
    expect(terminalContrast("dark")).toBe(1);
  });
});

describe("light theme and accent blocks", () => {
  it("every variable in :root also exists in the light block", () => {
    const light = new Set(names(lightRoot));
    for (const n of names(darkRoot)) expect(light.has(n), n).toBe(true);
  });
  it("(d) accent blocks set only accent vars; one dark and one light block per non-blue accent", () => {
    for (const a of ["teal", "violet", "amber", "rose", "slate"]) {
      const dark = block(`:root:not([data-theme="light"])[data-accent="${a}"]`);
      const light = block(`:root[data-theme="light"][data-accent="${a}"]`);
      expect(names(dark).sort(), a).toEqual(["--c-accent", "--c-on-accent"]);
      expect(val(dark, "--c-on-accent")).toBe("11 13 18");
      expect(names(light), a).toEqual(["--c-accent"]);
    }
    const all = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*\[data-accent[^{]*)\{/g)].map((m) => m[1].trim());
    expect(all.length).toBe(10);
    for (const sel of all) expect(sel).toMatch(/^:root(:not\(\[data-theme="light"\]\)|\[data-theme="light"\])\[data-accent="\w+"\]$/);
  });
  it("blue keeps white on-accent in dark (parity)", () => {
    expect(val(darkRoot, "--c-on-accent")).toBe("255 255 255");
  });
});
