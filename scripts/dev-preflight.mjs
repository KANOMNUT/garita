// Dev-server port preflight. Wired as the npm `predev` script, so it runs for
// `make dev`, `cargo tauri dev` (beforeDevCommand = `npm run dev`) and `npm run dev`.
//
// Why: vite.config.ts pins `server.port: 1420` with `strictPort: true` (Tauri's devUrl
// is fixed at 1420). When a dev run is killed (terminal closed, Ctrl+C under make,
// `timeout`), Windows does not kill the grandchild tree, so an orphaned vite keeps
// listening on 1420 and the next run dies with "Port 1420 is already in use" followed
// by "The beforeDevCommand terminated with a non-zero status code".
//
// Behaviour:
//   - port free                                  -> exit 0, silent
//   - held by a vite from THIS repo              -> stop it, print one line, exit 0
//   - held by anything else                      -> kill nothing, print who + how, exit 1
//   - detection itself fails / unexpected error  -> warn, exit 0 (vite reports the real error)
//
// Keep PORT in sync with vite.config.ts and src-tauri/tauri.conf.json (devUrl).
// No dependencies; every child process has a timeout and a global watchdog backs it up.

import net from "node:net";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 1420;
// Mirrors vite.config.ts: `host: host || false`, and vite resolves `false` to "localhost"
// through the same Node lookup. A successful bind here therefore means vite will bind too.
const HOST = process.env.TAURI_DEV_HOST || "localhost";
const IS_WIN = process.platform === "win32";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Normalise a path-ish string for comparison: lowercase on Windows, forward slashes, no `//`. */
function norm(s) {
  let out = s.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (IS_WIN) out = out.toLowerCase();
  return out;
}

/** Run a command with a hard timeout and no stdin. Resolves { ok, stdout, stderr }; never rejects. */
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    try {
      const child = execFile(
        cmd,
        args,
        {
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
        },
        (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? "" }),
      );
      child.stdin?.end(); // an open stdin pipe can stall powershell.exe until the timeout
    } catch (e) {
      resolve({ ok: false, stdout: "", stderr: String(e) });
    }
  });
}

/** Try to bind PORT exactly like vite does. Resolves "free" | "inuse" | "denied" | "error:<code>". */
function probe() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve("inuse");
      else if (err.code === "EACCES") resolve("denied");
      else resolve(`error:${err.code ?? err.message}`);
    });
    server.listen(PORT, HOST, () => server.close(() => resolve("free")));
  });
}

/** Poll until the port can be bound again. */
async function waitFree(totalMs) {
  const deadline = Date.now() + totalMs;
  for (;;) {
    if ((await probe()) === "free") return true;
    if (Date.now() >= deadline) return false;
    await sleep(200);
  }
}

/** Holders of PORT as [{ pid, name, cmd }] (name/cmd may be null). Returns null if detection failed. */
async function findHolders() {
  return IS_WIN ? findHoldersWindows() : findHoldersUnix();
}

async function findHoldersWindows() {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ids = @(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$rows = @()
foreach ($id in $ids) {
  $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $id) -ErrorAction SilentlyContinue
  if ($p) { $rows += [pscustomobject]@{ pid = [int]$id; name = $p.Name; cmd = $p.CommandLine } }
  else { $rows += [pscustomobject]@{ pid = [int]$id; name = $null; cmd = $null } }
}
ConvertTo-Json -InputObject @($rows) -Compress
`;
  // -EncodedCommand (base64 UTF-16LE) avoids every quoting problem in argv.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const r = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    15000,
  );
  if (!r.ok) return null;
  try {
    const parsed = JSON.parse(r.stdout.trim() || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map((h) => ({
      pid: Number(h.pid),
      name: h.name ?? null,
      cmd: h.cmd ?? null,
    }));
  } catch {
    return null;
  }
}

async function findHoldersUnix() {
  let pids = [];
  const lsof = await run("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"], 8000);
  if (lsof.ok || lsof.stdout.trim()) {
    pids = lsof.stdout.split(/\s+/).filter(Boolean).map(Number);
  } else {
    const ss = await run("ss", ["-Hltnp", `sport = :${PORT}`], 8000);
    if (!ss.ok) return null;
    pids = [...ss.stdout.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  }
  pids = [...new Set(pids.filter((n) => Number.isInteger(n) && n > 0))];
  if (pids.length === 0) return null; // port is held but we cannot see by whom (other user?)
  const holders = [];
  for (const pid of pids) {
    const comm = await run("ps", ["-ww", "-o", "comm=", "-p", String(pid)], 5000);
    const cmd = await run("ps", ["-ww", "-o", "command=", "-p", String(pid)], 5000);
    holders.push({
      pid,
      name: comm.ok ? comm.stdout.trim() || null : null,
      cmd: cmd.ok ? cmd.stdout.trim() || null : null,
    });
  }
  return holders;
}

/**
 * Is this holder a vite dev server started from THIS checkout? The command line must point
 * into `<repo>/node_modules/` and name vite right there (`vite/...`, `.bin/vite`, or npm's
 * `.bin/../vite/...` shim form). A bare "contains the repo path" test would also match a
 * sibling checkout (`app-old`); a worktree nested under this path does not contain
 * `<repo>/node_modules/` at all, so it is classed as foreign.
 */
function isOurVite(holder) {
  if (!holder.cmd) return false;
  if (holder.pid === process.pid || holder.pid === process.ppid) return false;
  const cmd = norm(holder.cmd);
  const prefix = norm(REPO_ROOT).replace(/\/$/, "") + "/node_modules/";
  const at = cmd.indexOf(prefix);
  if (at === -1) return false;
  return /^(\.bin\/(\.\.\/)?)?vite([/."'\s]|$)/.test(cmd.slice(at + prefix.length));
}

/** Stop one holder. Resolves { ok, detail }. */
async function stopHolder(pid) {
  if (IS_WIN) {
    // /T also takes the vite child tree (esbuild); /F because a console app ignores WM_CLOSE.
    const r = await run("taskkill", ["/PID", String(pid), "/T", "/F"], 10000);
    return { ok: r.ok, detail: (r.stderr || r.stdout).trim() };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    return e.code === "ESRCH" ? { ok: true, detail: "" } : { ok: false, detail: String(e.message ?? e) };
  }
  if (await waitFree(3000)) return { ok: true, detail: "" };
  try {
    process.kill(pid, "SIGKILL");
  } catch (e) {
    if (e.code !== "ESRCH") return { ok: false, detail: String(e.message ?? e) };
  }
  return { ok: true, detail: "" };
}

function describe(h) {
  const cmd = h.cmd ? (h.cmd.length > 200 ? h.cmd.slice(0, 200) + "..." : h.cmd) : "(command line not readable)";
  return `  PID ${h.pid}  ${h.name ?? "(unknown process)"}\n  ${cmd}`;
}

function reportForeign(foreign) {
  const lines = [
    `Port ${PORT} is held by another program, not a dev server of this app. The app's dev server needs exactly this port (Tauri devUrl is fixed), so nothing was stopped.`,
    ...foreign.map(describe),
    "Stop it yourself, then retry:",
    ...foreign.map((h) => (IS_WIN ? `  taskkill /PID ${h.pid} /F` : `  kill ${h.pid}`)),
  ];
  console.error(lines.join("\n"));
}

async function main() {
  // Backstop: this script must never be the reason a dev start hangs.
  const watchdog = setTimeout(() => {
    console.warn(`[dev-preflight] timed out checking port ${PORT}; continuing, vite will report any conflict.`);
    process.exit(0);
  }, 40000);
  watchdog.unref();

  for (let round = 0; round < 3; round++) {
    const state = await probe();
    if (state === "free") return 0;
    if (state === "denied") {
      console.warn(
        `[dev-preflight] Windows denied binding port ${PORT} (EACCES). It is probably inside a reserved range; check:\n` +
          "  netsh interface ipv4 show excludedportrange protocol=tcp\n" +
          "Continuing; vite will report the real error.",
      );
      return 0;
    }
    if (state !== "inuse") {
      console.warn(`[dev-preflight] could not probe port ${PORT} (${state}); continuing.`);
      return 0;
    }

    const holders = await findHolders();
    if (!holders || holders.length === 0) {
      console.warn(
        `[dev-preflight] port ${PORT} is in use but the owning process could not be identified; continuing, vite will report it.`,
      );
      return 0;
    }

    const foreign = holders.filter((h) => !isOurVite(h));
    if (foreign.length > 0) {
      reportForeign(foreign);
      return 1;
    }

    for (const h of holders) {
      const r = await stopHolder(h.pid);
      if (!r.ok) {
        console.error(
          `Could not stop the stale dev server (PID ${h.pid}) holding port ${PORT}: ${r.detail || "unknown error"}\n` +
            (IS_WIN ? `  taskkill /PID ${h.pid} /F` : `  kill ${h.pid}`),
        );
        return 1;
      }
      console.log(`Stopped stale dev server (PID ${h.pid}) holding port ${PORT}.`);
    }
    if (await waitFree(5000)) return 0;
    // Still held: a v4 and a v6 listener can both be stale. Re-identify and go round again.
  }

  console.error(`Port ${PORT} is still in use after stopping the stale dev server. Close whatever holds it and retry.`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.warn(`[dev-preflight] unexpected failure (${err?.message ?? err}); continuing.`);
    process.exit(0);
  },
);
