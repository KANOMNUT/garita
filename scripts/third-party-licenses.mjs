// Generates THIRD_PARTY_LICENSES at the repo root from two sources:
//   - the Rust crates in the release binary, as reported by cargo-about (config: src-tauri/about.toml);
//   - the npm packages whose code ends up in dist/ (the NPM list below).
//
// Regenerate after any Cargo.lock or package-lock.json change:
//   cargo install --locked cargo-about --version 0.9.2 --features cli   # once; without `cli` no binary is installed
//   npm ci                                                               # node_modules must match the lockfile
//   node scripts/third-party-licenses.mjs
// With no args the script runs
//   cargo about generate --manifest-path src-tauri/Cargo.toml --locked --format json --fail -o <tmp>
// itself. It writes through -o because cargo-about refuses to write to stdout when it
// detects PowerShell, which includes Git Bash on Windows.
//
// Args (optional): [cargo-about.json] [out-file]. Default output: <repo>/THIRD_PARTY_LICENSES.
// The file is always written. The script exits 1 if:
//   - a component has no licence text;
//   - a licence is not in ALLOWED (keep it in step with src-tauri/deny.toml);
//   - part of an AND expression has no text.
// When src/ imports a new package, add it to NPM.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [aboutArg, outPath = path.join(root, "THIRD_PARTY_LICENSES")] = process.argv.slice(2);
let about;
if (aboutArg) about = JSON.parse(fs.readFileSync(aboutArg, "utf8"));
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "about-"));
  try {
    execFileSync("cargo", ["about", "generate", "--manifest-path", path.join(root, "src-tauri", "Cargo.toml"), "--locked", "--format", "json", "--fail", "-o", path.join(tmp, "about.json")], { stdio: "inherit" });
    about = JSON.parse(fs.readFileSync(path.join(tmp, "about.json"), "utf8"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const ALLOWED = new Set(["MIT", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Zlib", "Unicode-3.0", "MPL-2.0", "BSL-1.0", "0BSD", "CC0-1.0", "MIT-0", "Unlicense"]);
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };
const norm = (t) => t.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();

// One pool of licence texts, deduplicated by exact (normalised) text, so differing copyright lines all survive.
const texts = new Map(); // text -> { id, n, users:Set }
const addText = (id, text, user) => {
  const k = norm(text);
  if (!texts.has(k)) texts.set(k, { id, users: new Set() });
  texts.get(k).users.add(user);
  return k;
};

// ---- Rust ----
const crates = about.crates.map((c) => ({
  key: `${c.package.name} ${c.package.version}`,
  name: c.package.name,
  version: c.package.version,
  declared: c.package.license ?? null,
  repo: c.package.repository || `https://crates.io/crates/${c.package.name}/${c.package.version}`,
  dir: path.dirname(c.package.manifest_path),
  ids: new Set(),
  textKeys: new Set(),
}));
const byId = new Map(crates.map((c) => [`${c.name}@${c.version}`, c]));
for (const l of about.licenses) {
  for (const u of l.used_by) {
    const c = byId.get(`${u.crate.name}@${u.crate.version}`);
    if (!c) { fail(`licence user not in crate list: ${u.crate.name}`); continue; }
    c.ids.add(l.id);
    c.textKeys.add(addText(l.id, l.text, c.key));
  }
}

// ---- npm: every package whose code is in dist/ (the @tauri-apps/* dependencies imported by src/ included) ----
const reg = path.join(process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"), "registry", "src");
const crateDir = (name, ver) => fs.readdirSync(reg).map((d) => path.join(reg, d, `${name}-${ver}`)).find((d) => fs.existsSync(d));
const NPM = [
  ["react", "LICENSE", "runtime"],
  ["react-dom", "LICENSE", "runtime"],
  ["scheduler", "LICENSE", "runtime (dependency of react-dom)"],
  ["loose-envify", "LICENSE", "production dependency of react (build-time transform)"],
  ["js-tokens", "LICENSE", "production dependency of loose-envify"],
  ["@tanstack/react-query", "LICENSE", "runtime"],
  ["@tanstack/query-core", "LICENSE", "runtime (dependency of @tanstack/react-query)"],
  ["@xterm/xterm", "LICENSE", "runtime"],
  ["@xterm/addon-fit", "LICENSE", "runtime"],
  ["lucide-react", "LICENSE", "runtime"],
  ["@tauri-apps/api", "LICENSE-MIT", "runtime"],
  ["@tauri-apps/plugin-dialog", null, "runtime"],
  ["@tauri-apps/plugin-updater", null, "runtime"],
  ["@tauri-apps/plugin-process", null, "runtime"],
  ["tailwindcss", "LICENSE", "generated CSS (preflight) in the bundle"],
  ["vite", "LICENSE.md", "module-preload helper in the bundle"],
];
const npm = NPM.map(([name, file, why]) => {
  const dir = path.join(root, "node_modules", name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  let text;
  if (name.startsWith("@tauri-apps/plugin-")) {
    // npm tarball ships only LICENSE.spdx; same upstream repo publishes the crate with full texts.
    const crate = name.replace("@tauri-apps/plugin-", "tauri-plugin-");
    const d = crateDir(crate, pkg.version);
    if (!d) fail(`${crate}-${pkg.version} not in cargo registry`);
    text = d ? fs.readFileSync(path.join(d, "LICENSE_MIT"), "utf8") : "";
  } else {
    text = fs.readFileSync(path.join(dir, file), "utf8");
    if (name === "vite") text = text.slice(text.indexOf("MIT License"), text.indexOf("# Licenses of bundled dependencies"));
  }
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? `https://www.npmjs.com/package/${name}`;
  const declared = pkg.license;
  const id = /^(MIT|ISC)$/.test(declared) ? declared : "MIT"; // dual MIT/Apache: used under MIT
  const key = `${name} ${pkg.version}`;
  return { key, name, version: pkg.version, declared, why, dir, repo: repo.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^([\w.-]+\/[\w.-]+)$/, "https://github.com/$1"), ids: new Set([id]), textKeys: new Set([addText(id, text, key)]) };
});

// ---- checks ----
const ands = (expr) => (expr ?? "").split(/\s+AND\s+/).map((p) => p.replace(/[()]/g, "").split(/\s+OR\s+/).map((s) => s.trim()));
for (const c of [...crates, ...npm]) {
  if (!c.textKeys.size) fail(`${c.key}: no licence text`);
  for (const id of c.ids) if (!ALLOWED.has(id)) fail(`${c.key}: licence ${id} not on the allow-list`);
  if (c.declared && /\bAND\b/.test(c.declared))
    for (const alts of ands(c.declared)) if (!alts.some((a) => c.ids.has(a))) fail(`${c.key}: AND component (${alts.join(" OR ")}) has no text`);
}

// NOTICE files (Apache-2.0 §4d): copy verbatim if any component ships one.
const notices = [];
for (const c of [...crates, ...npm])
  for (const f of fs.readdirSync(c.dir)) if (/^notice/i.test(f)) notices.push([c.key, norm(fs.readFileSync(path.join(c.dir, f), "utf8"))]);

// ---- render ----
const ordered = [...texts.entries()].sort((a, b) => a[1].id.localeCompare(b[1].id) || [...a[1].users][0].localeCompare([...b[1].users][0]));
ordered.forEach(([, v], i) => (v.n = `L${i + 1}`));
const ref = (c) => [...c.textKeys].map((k) => texts.get(k).n).sort((a, b) => a.slice(1) - b.slice(1)).join(", ");
const wrap = (words, head) => {
  const lines = [head];
  for (const w of words) {
    const cur = lines[lines.length - 1], sep = cur === head ? "" : ", ";
    if (cur !== head && (cur + sep + w).length > 78) { lines[lines.length - 1] += ","; lines.push(" ".repeat(head.length) + w); }
    else lines[lines.length - 1] = cur + sep + w;
  }
  return lines.join("\n");
};
const row = (c, declared) => `  ${c.key}\n      Licence: ${declared}   Text: ${ref(c)}\n      Source:  ${c.repo}` + (c.why ? `\n      Use:     ${c.why}` : "");
const rule = "=".repeat(78);
const mpl = crates.filter((c) => c.ids.has("MPL-2.0"));

const out = [
  "Third-party software included in this application",
  rule,
  "",
  "This application includes the open-source components listed below. Each",
  "component is licensed under its own terms; the full licence texts follow in",
  "Part 4. Where a component offers a choice of licences (\"A OR B\"), it is used",
  "under the licence whose text is referenced.",
  "",
  "This file is generated (cargo-about over the Rust dependency graph, plus the",
  "npm packages whose code is in the web bundle). Do not edit it by hand.",
  "",
  `Part 1. Rust crates (${crates.length})`,
  rule,
  ...crates.sort((a, b) => a.key.localeCompare(b.key)).map((c) => row(c, c.declared ?? "(not declared; MIT per its LICENSE file)")),
  "",
  `Part 2. JavaScript packages (${npm.length})`,
  rule,
  ...npm.map((c) => row(c, c.declared)),
  "",
  "Part 3. Source code of MPL-2.0 components",
  rule,
  "The following components are covered by the Mozilla Public License 2.0 and",
  "are used unmodified. Their source code is available from:",
  ...mpl.map((c) => `  ${c.key}: ${c.repo}  (https://crates.io/crates/${c.name}/${c.version})`),
  "",
  "NOTICE files",
  "-".repeat(12),
  ...(notices.length ? notices.flatMap(([k, t]) => [`From ${k}:`, t, ""]) : ["None of the components above ships a NOTICE file.", ""]),
  "",
  `Part 4. Licence texts (${ordered.length} distinct)`,
  rule,
  ...ordered.flatMap(([t, v]) => ["", "-".repeat(78), `[${v.n}] ${v.id}`, wrap([...v.users].sort(), "Used by: "), "-".repeat(78), "", t]),
  "",
].join("\n");

fs.writeFileSync(outPath, out);
console.log(`crates=${crates.length} npm=${npm.length} texts=${ordered.length} notices=${notices.length} mpl=${mpl.map((c) => c.key).join("; ")}`);
const hist = {}; for (const c of crates) for (const id of c.ids) hist[id] = (hist[id] || 0) + 1;
console.log("rust licence-text histogram (a crate with an AND expression counts once per licence):", hist);
