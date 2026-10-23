import { describe, expect, it } from "vitest";
// @ts-expect-error no @types/node in this repo; vitest runs in node and css ?raw comes back empty
import { readdirSync, readFileSync, statSync } from "node:fs";

const css: string = readFileSync("src/index.css", "utf8");
const cfg: string = readFileSync("tailwind.config.js", "utf8");

// :root block, dark theme (light/accent blocks arrive with F2).
const root = css.match(/:root\s*\{([^}]*)\}/)![1];
const vars = new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");

// v1.4.1 literal -> role. Accepted deltas (brief 1.5 D-1..D-7) are not value-for-value renames,
// so none belong here; D-5 (body bg) is checked in the last test.
const PARITY: [string, string][] = [
  ["#0b0d12", "surface-base"], ["#12151d", "surface-panel"], ["#1a1e29", "surface-card"],
  ["#1f2937", "surface-overlay"], ["#111827", "surface-input"], ["#070a10", "surface-sunken"],
  ["#ffffff", "surface-tint"], ["#000000", "scrim"],
  ["#e6e9ef", "ink"], ["#8a93a6", "mute"], ["#5b6377", "dim"],
  ["#4ea1ff", "accent"], ["#4ea1ff", "status-progress"], ["#4ea1ff", "metric-cpu"], ["#a78bfa", "metric-mem"],
  ["#34d399", "status-ok"], ["#fbbf24", "status-warn"], ["#f87171", "status-bad"], ["#60a5fa", "status-info"],
  ["#fb923c", "status-orange"], ["#a78bfa", "status-purple"],
  ["#4ea1ff", "identity-blue"], ["#34d399", "identity-green"], ["#fbbf24", "identity-yellow"],
  ["#fb923c", "identity-orange"], ["#f87171", "identity-red"], ["#a78bfa", "identity-purple"],
  ["#60a5fa", "bar-low"], ["#fbbf24", "bar-mid"], ["#f87171", "bar-high"], ["#5b6377", "log-debug"],
  ["#f472b6", "series-1"], ["#a3e635", "series-2"], ["#22d3ee", "series-3"],
  ["#d946ef", "series-4"], ["#2dd4bf", "series-5"], ["#cbd5e1", "series-6"],
  // ShellTerminal.tsx xterm object, verbatim, plus xterm 6 defaults for the rest.
  ["#c9d1d9", "term-fg"], ["#000000", "term-cursor-accent"], ["#0d1117", "term-black"],
  ["#f87171", "term-red"], ["#34d399", "term-green"], ["#fbbf24", "term-yellow"], ["#4ea1ff", "term-blue"],
  ["#a78bfa", "term-magenta"], ["#22d3ee", "term-cyan"], ["#c9d1d9", "term-white"],
  ["#555753", "term-bright-black"], ["#ef2929", "term-bright-red"], ["#8ae234", "term-bright-green"],
  ["#fce94f", "term-bright-yellow"], ["#729fcf", "term-bright-blue"], ["#ad7fa8", "term-bright-magenta"],
  ["#34e2e2", "term-bright-cyan"], ["#eeeeec", "term-bright-white"],
];
const ALPHA: [string, string, number][] = [
  ["edge", "255 255 255", 0.06], ["edge-strong", "255 255 255", 0.1],
  ["log-match", hex("#4ea1ff"), 0.28], ["log-highlight", hex("#fbbf24"), 0.38],
  ["term-selection", "255 255 255", 0.3], ["hairline", "255 255 255", 0.04],
];

describe("theme tokens (dark = v1.4.1)", () => {
  it.each(PARITY)("%s -> --c-%s", (lit, role) => {
    expect(vars.get(`--c-${role}`)).toBe(hex(lit));
  });

  it.each(ALPHA)("--c-%s / --a-%s", (role, rgb, a) => {
    expect(vars.get(`--c-${role}`)).toBe(rgb);
    expect(Number(vars.get(`--a-${role}`))).toBe(a);
  });

  it("scrollbar alphas", () => {
    expect(vars.get("--a-scrollbar")).toBe("0.08");
    expect(vars.get("--a-scrollbar-hover")).toBe("0.14");
  });

  it("totality: every referenced variable is defined on :root", () => {
    const used = new Set([...(css + cfg).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]).filter((v) => !v.startsWith("--color-")));
    for (const u of used) expect(vars.has(u), u).toBe(true);
  });

  it("no hex or numeric rgb literals outside :root (G3)", () => {
    const rest = (css.replace(root, "") + cfg).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([0-9 .,]+\)/g)).toBeNull();
  });

  it("alpha-baked keys use the --a form, others the <alpha-value> form", () => {
    const entries = [...cfg.matchAll(/^\s*"?([\w-]+)"?:\s*"(rgb\(var\(--c-[\w-]+\) \/ [^"]+\))"/gm)];
    expect(entries.length).toBeGreaterThan(40);
    for (const [, key, val] of entries) {
      const role = val.match(/--c-([\w-]+)/)![1];
      // edge-raw is the one deliberate exception: no baked alpha, so a modifier replaces it as in Tailwind 3 (ui.md -> Appearance).
      const baked = vars.has(`--a-${role}`) && key !== "edge-raw";
      expect(val, key).toBe(baked ? `rgb(var(--c-${role}) / var(--a-${role}))` : `rgb(var(--c-${role}) / <alpha-value>)`);
    }
  });

  it("no tsx uses a modifier on a baked-alpha key (use edge-raw)", () => {
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = `${d}/${f}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx") && /-(edge|edge-strong|edge2|log-match|log-highlight)\//.test(readFileSync(p, "utf8"))) bad.push(p);
      }
    };
    walk("src");
    expect(bad).toEqual([]);
  });

  it("legacy aliases resolve to their role", () => {
    const alias = { base: "surface-base", panel: "surface-panel", card: "surface-card", edge2: "edge-strong",
      ok: "status-ok", warn: "status-warn", bad: "status-bad", info: "status-info", orange: "status-orange", purple: "status-purple" };
    for (const [k, r] of Object.entries(alias)) expect(cfg, k).toContain(`${k}: "rgb(var(--c-${r})`);
  });

  it("status/metric/bar/log/identity/series/legacy keys never read the accent", () => {
    const re = /^\s*"?((?:metric|bar|status|log|identity|series)-[\w-]+|ok|warn|bad|info|orange|purple|edge2)"?:\s*"([^"]+)"/gm;
    const hits = [...cfg.matchAll(re)];
    expect(hits.length).toBeGreaterThan(20);
    for (const [, key, val] of hits) expect(val, key).not.toContain("--c-accent");
  });

  it("D-5: body background is surface-base", () => {
    expect(css).toMatch(/background:\s*rgb\(var\(--c-surface-base\)\)/);
  });
});

// Brief 1.5 D-1..D-8: the only dark deltas. [id, v1.4.1 literal, role it moved to]. Each must really differ from the role.
const ACCEPTED_DELTAS: [string, string, string][] = [
  ["D-1", "#374151", "edge-strong"], // gray-700 ring (alpha role: white at 0.10)
  ["D-2", "#facc15", "status-warn"], ["D-2", "#eab308", "status-warn"], // yellow-400, yellow-500
  ["D-3", "#3b82f6", "status-info"], // blue-500 (blue-400 is exact)
  ["D-4", "#c084fc", "status-purple"], ["D-4", "#a855f7", "status-purple"], // purple-400, purple-500
  ["D-5", "#06080c", "surface-base"], // body background
  ["D-6", "#000000", "surface-base"], // black at 50% -> surface-base at 50%
  ["D-7", "#000000", "surface-input"], // black at 20% -> surface-input
  ["D-8", "#60a5fa", "accent"], // native checkbox and radio tint: blue-400 -> accent
];
describe("accepted deltas", () => {
  it.each(ACCEPTED_DELTAS)("%s %s -> %s is a real delta, not parity", (_id, lit, role) => {
    expect(vars.get(`--c-${role}`)).not.toBe(hex(lit));
  });
});


describe("swatches and role usage", () => {
  // Body of the css rule whose selector is exactly `sel` (plain string search, no regex escaping).
  const body = (sel: string) => {
    const i = css.indexOf(sel + " {");
    return css.slice(i, css.indexOf("}", i));
  };
  const get = (b: string, n: string) => b.match(new RegExp(n + ":\s*([^;]+);"))![1].trim();
  const light = body(':root[data-theme="light"]');
  it.each(["teal", "violet", "amber", "rose", "slate"])("swatch %s equals that accent in both themes", (a) => {
    const dark = body(`:root:not([data-theme="light"])[data-accent="${a}"]`);
    const lt = body(`:root[data-theme="light"][data-accent="${a}"]`);
    expect(get(root, `--c-swatch-${a}`)).toBe(get(dark, "--c-accent"));
    expect(get(light, `--c-swatch-${a}`)).toBe(get(lt, "--c-accent"));
  });
  it("swatch blue equals the theme blocks own accent", () => {
    expect(get(root, "--c-swatch-blue")).toBe(get(root, "--c-accent"));
    expect(get(light, "--c-swatch-blue")).toBe(get(light, "--c-accent"));
  });
  it("every --c-* role is read by the config, the css, or the terminal theme", () => {
    const readers: string = cfg + css.replace(root, "") + readFileSync("src/utils/terminalTheme.ts", "utf8");
    for (const n of vars.keys()) {
      if (!n.startsWith("--c-")) continue;
      expect(readers.includes(n + ")") || readers.includes(`"${n.slice(4)}"`), n).toBe(true);
    }
  });
});
