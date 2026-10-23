// PreToolUse hook (Bash, Monitor, PowerShell): `rtk hook claude`, MSYS noglob scoped to `rtk grep` / `rtk find`,
// then the whole command wrapped in `rtk proxy` (user rule: every command runs through rtk, always).
// Native rtk.exe starts MSYS grep/find, whose runtime re-globs argv: `rtk grep -cE 'fo{1,2}$'`
// silently searches for "fo1$" and "fo2$". noglob must NOT be set globally: Claude Code (native)
// starts bash.exe with a quoted command line that noglob breaks. Also applied to `rtk grep` the
// model wrote itself (rtk passes those through). PowerShell: only `rtk ls` is undone (no ls binary).
// The wrapped command reaches the child shell on stdin, never argv: rtk.exe -> MSYS argv loses `\\`,
// path-converts a leading `/usr/bin/x` and globs. The child writes its final cwd to a temp file and the
// outer shell cds there, so `cd` still persists across calls. Exit codes pass through `rtk proxy`.
// This file governs the project alone: the user-level copy (~/.claude/hooks/rtk-hook.mjs) exits
// without output when a project copy exists. Keep the two identical; never run `rtk init` here.
// Without rtk on PATH (a contributor's machine) nothing is wrapped: a leading `rtk ` / `rtk proxy ` is stripped from each command.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NOGLOB = 'MSYS="${MSYS:+$MSYS }noglob" ';
// ponytail: regex over shell text, so "; rtk grep" inside a quoted string is prefixed too; a bash parser if that ever bites.
const AT_COMMAND = /(^|[\n;&|(]|\b(?:do|then|else))(\s*)rtk (grep|find)\b([^\n;&|]*)/g;
// noglob also breaks MSYS's parsing of the \" Rust writes for an arg holding a literal `"` ("Trailing backslash").
// Such an arg is quoted, and MSYS never globs a quoted arg, so those segments keep globbing.
// ponytail: single-quote pairing by regex; a `|` or `'` inside quotes can fool it.
const literalDq = (seg) => /\\"/.test(seg) || (seg.match(/'[^']*'/g) ?? []).some((s) => s.includes('"'));
// PowerShell has no `ls` binary for `rtk ls` to run; keep the Get-ChildItem alias.
const PS_LS = /(^|[\n;|{(])(\s*)rtk ls\b/g;
export const scope = (cmd) => cmd.replace(AT_COMMAND, (m, pre, ws, tool, rest) => literalDq(rest) ? m : `${pre}${ws}${NOGLOB}rtk ${tool}${rest}`);

// No-rtk path: drop the maintainer's `rtk ` / `rtk proxy ` prefix at each command start.
// ponytail: same regex ceiling as AT_COMMAND, so "; rtk x" inside a quoted string is stripped too.
export const unrtk = (cmd) => cmd.replace(/(^|[\n;&|(]|\b(?:do|then|else))(\s*)rtk (?:proxy )?/g, "$1$2");

// "$BASH", never bare `bash` (System32's WSL launcher wins Rust's lookup).
// ponytail: a command that sets its own EXIT trap or `exec`s loses the cwd hand-back; cwd then stays put.
export const wrapBash = (cmd, id) => {
  const f = `/tmp/rtk-cwd-${id}`;
  return `rtk proxy "$BASH" -c 'eval "$(cat)"' <<'RTK_CMD_${id}'\ntrap 'pwd -P >"${f}"' EXIT\n${cmd}\nRTK_CMD_${id}\n` +
    `r=$?; cd "$(cat "${f}" 2>/dev/null || pwd)"; rm -f "${f}"; (exit $r)`;
};

// PS 5.1 mangles `"` in native args, so the command goes over stdin as UTF-8; exit code = last native one, as the PowerShell tool reports it.
export const wrapPs = (cmd, id) => {
  const f = `$env:TEMP\\rtk-cwd-${id}`;
  const lit = `'${cmd.replace(/['‘’‚‛]/g, "$&$&")}'`;
  return `$OutputEncoding = [Text.UTF8Encoding]::new($false)\n${lit} | rtk proxy powershell -NoProfile -NonInteractive -Command ` +
    `'[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); try { iex ([Console]::In.ReadToEnd().TrimStart([char]0xFEFF)); exit $LASTEXITCODE } finally { (Get-Location).ProviderPath | Set-Content -LiteralPath ${f} }'\n` +
    `if (Test-Path -LiteralPath ${f}) { Set-Location -LiteralPath (Get-Content -LiteralPath ${f}); Remove-Item -LiteralPath ${f} }`;
};

// Request + rtk's hook stdout -> our stdout. Scopes even when rtk passes through: a model-written `rtk grep` gets no rewrite.
export const decide = (input, rtkOut, id = randomUUID().slice(0, 8)) => {
  const req = JSON.parse(input);
  const j = rtkOut.trim() ? JSON.parse(rtkOut) : {};
  const ui = j.hookSpecificOutput?.updatedInput ?? req.tool_input;
  if (typeof ui?.command !== "string" || !ui.command.trim()) return rtkOut;
  const cmd = req.tool_name === "PowerShell" ? wrapPs(ui.command.replace(PS_LS, "$1$2ls"), id) : wrapBash(scope(ui.command), id);
  return JSON.stringify({ ...j, hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecisionReason: "RTK auto-rewrite", ...j.hookSpecificOutput, updatedInput: { ...ui, command: cmd } } });
};

if (process.argv[2] === "--test") {
  const eq = (a, b) => { if (a !== b) throw new Error(`\n got: ${a}\nwant: ${b}`); };
  eq(scope("rtk grep -cE 'fo{1,2}$' f"), `${NOGLOB}rtk grep -cE 'fo{1,2}$' f`);
  eq(scope("cd x && rtk find . -name '*.ts'"), `cd x && ${NOGLOB}rtk find . -name '*.ts'`);
  eq(scope("rtk git status; rtk grep a | rtk grep b"), `rtk git status; ${NOGLOB}rtk grep a | ${NOGLOB}rtk grep b`);
  eq(scope("for f in *; do rtk grep x $f; done"), `for f in *; do ${NOGLOB}rtk grep x $f; done`);
  eq(scope("rtk git log --grep foo"), "rtk git log --grep foo");
  eq(scope("rtk grepx"), "rtk grepx");
  eq(scope(`rtk grep -c '"name"' package.json`), `rtk grep -c '"name"' package.json`);
  eq(scope(`rtk grep -c "say \\"hi\\"" f`), `rtk grep -c "say \\"hi\\"" f`);
  eq(scope(`rtk find . -name "*.ts"`), `${NOGLOB}rtk find . -name "*.ts"`);
  eq(scope(`cd "a b" && rtk grep -c 'x{2}' f`), `cd "a b" && ${NOGLOB}rtk grep -c 'x{2}' f`);
  eq(scope(`rtk grep -c '"k"' f; rtk grep -c 'x{2}' f`), `rtk grep -c '"k"' f; ${NOGLOB}rtk grep -c 'x{2}' f`);
  eq(scope("rtk proxy grep -E 'x{2}' f"), "rtk proxy grep -E 'x{2}' f");
  const req = (tool, command) => JSON.stringify({ tool_name: tool, tool_input: { command, timeout: 5 } });
  const rw = (command) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecisionReason: "RTK auto-rewrite", updatedInput: { command, timeout: 5 } } });
  const ui = (out) => JSON.parse(out).hookSpecificOutput.updatedInput;
  const run = (tool, command, rtkOut = "") => ui(decide(req(tool, command), rtkOut, "t")).command;
  eq(run("Bash", "rtk grep -cE 'fo{1,2}$' f"), wrapBash(`${NOGLOB}rtk grep -cE 'fo{1,2}$' f`, "t"));
  eq(ui(decide(req("Bash", "cd x && rtk find . -name '*.ts'"), "", "t")).timeout, 5);
  eq(run("Bash", "grep x f", rw("rtk grep x f")), wrapBash(`${NOGLOB}rtk grep x f`, "t"));
  eq(run("Bash", `grep -c '"name"' f`, rw(`rtk grep -c '"name"' f`)), wrapBash(`rtk grep -c '"name"' f`, "t"));
  eq(run("Bash", "git status", rw("rtk git status")), wrapBash("rtk git status", "t"));
  eq(run("Bash", "echo hi"), wrapBash("echo hi", "t"));
  eq(run("Monitor", "tail -f x"), wrapBash("tail -f x", "t"));
  eq(run("PowerShell", "cd x; ls; git status", rw("cd x; rtk ls; rtk git status")), wrapPs("cd x; ls; rtk git status", "t"));
  eq(run("PowerShell", "rtk grep x f"), wrapPs("rtk grep x f", "t"));
  eq(decide(req("Bash", "  "), ""), "");
  eq(JSON.parse(decide(JSON.stringify({ tool_name: "Bash", tool_input: { command: "x" } }), JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } }), "t")).hookSpecificOutput.permissionDecision, "ask");
  eq(wrapPs("echo 'it’s'", "t").includes(`'echo ''it’’s'''`), true);
  // Pinned shape: stdin heredoc, cwd trap, cd hand-back, rc restore. Corpus-checked 2026-10-22; re-run one if this changes.
  eq(wrapBash("echo hi", "t"), `rtk proxy "$BASH" -c 'eval "$(cat)"' <<'RTK_CMD_t'\ntrap 'pwd -P >"/tmp/rtk-cwd-t"' EXIT\necho hi\nRTK_CMD_t\nr=$?; cd "$(cat "/tmp/rtk-cwd-t" 2>/dev/null || pwd)"; rm -f "/tmp/rtk-cwd-t"; (exit $r)`);
  eq(unrtk("rtk git status && rtk grep -n x f"), "git status && grep -n x f");
  console.log("rtk-hook: ok");
  process.exit(0);
}

const self = fileURLToPath(import.meta.url).toLowerCase();
// Importable: the hook runs only when node is started on this file.
if (resolve(process.argv[1] ?? "").toLowerCase() === self) {
  const input = readFileSync(0, "utf8");
  // The user-level copy defers to a project copy, so a project with its own hook is governed by it alone.
  const projectCopy = process.env.CLAUDE_PROJECT_DIR && resolve(process.env.CLAUDE_PROJECT_DIR, ".claude/hooks/rtk-hook.mjs");
  if (projectCopy && existsSync(projectCopy) && projectCopy.toLowerCase() !== self) process.exit(0);
  const rtk = spawnSync("rtk", ["hook", "claude"], { input, encoding: "utf8", shell: false, env: { ...process.env, RTK_SUPPRESS_HOOK_WARNING: "1" } });
  if (rtk.error) { // rtk not installed: strip prefixes, print only if something changed, never wrap
    try {
      const ti = JSON.parse(input).tool_input;
      const command = typeof ti?.command === "string" ? unrtk(ti.command) : "";
      if (command !== ti?.command) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...ti, command } } }));
    } catch { /* non-JSON = passthrough */ }
    process.exit(0);
  }
  let out = rtk.stdout || "";
  try { out = decide(input, out); } catch { /* non-JSON = passthrough; print rtk's output as is */ }
  process.stdout.write(out);
  process.exit(rtk.status ?? 0);
}
