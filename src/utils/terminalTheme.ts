// xterm theme from the --c-* variables in src/index.css (brief 2.4). The only file allowed to hold
// colour literals: they are the dark fallback per role, used when a variable cannot be read.

/** [xterm key, CSS role, dark fallback]. The 21 keys xterm themes; the mapping is total (tested). */
export const XTERM_ROLES: readonly (readonly [string, string, string])[] = [
  ["background", "surface-sunken", "#070a10"],
  ["foreground", "term-fg", "#c9d1d9"],
  ["cursor", "accent", "#4ea1ff"],
  ["cursorAccent", "term-cursor-accent", "#000000"],
  ["black", "term-black", "#0d1117"],
  ["red", "term-red", "#f87171"],
  ["green", "term-green", "#34d399"],
  ["yellow", "term-yellow", "#fbbf24"],
  ["blue", "term-blue", "#4ea1ff"],
  ["magenta", "term-magenta", "#a78bfa"],
  ["cyan", "term-cyan", "#22d3ee"],
  ["white", "term-white", "#c9d1d9"],
  ["brightBlack", "term-bright-black", "#555753"],
  ["brightRed", "term-bright-red", "#ef2929"],
  ["brightGreen", "term-bright-green", "#8ae234"],
  ["brightYellow", "term-bright-yellow", "#fce94f"],
  ["brightBlue", "term-bright-blue", "#729fcf"],
  ["brightMagenta", "term-bright-magenta", "#ad7fa8"],
  ["brightCyan", "term-bright-cyan", "#34e2e2"],
  ["brightWhite", "term-bright-white", "#eeeeec"],
];
const SELECTION = ["selectionBackground", "term-selection", "rgba(255, 255, 255, 0.3)"] as const;

function read(name: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  } catch {
    return "";
  }
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** A fresh object every call: xterm ignores in-place mutation of options.theme. */
export function terminalTheme(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, role, fallback] of XTERM_ROLES) {
    const m = read(`--c-${role}`).match(/^(\d+) (\d+) (\d+)$/);
    out[key] = m ? `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}` : fallback;
  }
  const m = read(`--c-${SELECTION[1]}`).match(/^(\d+) (\d+) (\d+)$/);
  const a = parseFloat(read(`--a-${SELECTION[1]}`));
  out[SELECTION[0]] = m && a >= 0 && a <= 1 ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : SELECTION[2];
  return out;
}

/** Light panes correct programs that pick low-contrast colours; dark keeps xterm's default (1) for parity. */
export const terminalContrast = (resolved: "light" | "dark") => (resolved === "light" ? 4.5 : 1);
