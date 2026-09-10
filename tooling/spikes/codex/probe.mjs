#!/usr/bin/env node
/**
 * Repeatable Codex CLI detection spike (Windows-first, report-only).
 *
 *   node tooling/spikes/codex/probe.mjs
 *   node tooling/spikes/codex/probe.mjs --deep
 *
 * Searches PATH and common install locations. If an executable is found,
 * runs `<exe> --version` and `<exe> --help` with a 15s timeout.
 * Always exits 0 (missing Codex is a finding, not a script failure).
 *
 * Does not: npm install, login/logout, exec a model task, print secrets,
 * or start the desktop app / app-server daemon.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const tmpDir = path.resolve(repoRoot, "tooling", "spikes", ".tmp", "codex-probe");
const deep = process.argv.includes("--deep");
const HELP_TIMEOUT_MS = 15_000;
const SHORT_TIMEOUT_MS = 15_000;

const home = os.homedir();
const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
const programFiles = process.env.ProgramFiles || "C:\\Program Files";
const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
const isWin = process.platform === "win32";

function log(line = "") {
  process.stdout.write(`${line}\n`);
}

function heading(title) {
  log("");
  log("=".repeat(78));
  log(title);
  log("=".repeat(78));
}

function exists(p) {
  if (!p) return false;
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function tryStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function listDir(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

function resolveWinCommand(command) {
  if (!isWin) return command;
  if (path.extname(command)) return command;
  const where = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8_000,
  });
  const lines = (where.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const withExt = lines.find((p) => /\.(cmd|exe|bat|ps1)$/i.test(p));
  return withExt || lines[0] || command;
}

function spawnCapture(command, args, { timeoutMs = SHORT_TIMEOUT_MS, env } = {}) {
  const resolved = resolveWinCommand(command);
  const useShell = isWin && /\.(cmd|bat)$/i.test(resolved);
  const child = spawnSync(resolved, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    shell: useShell,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return {
    command: resolved,
    args,
    status: child.status,
    signal: child.signal,
    error: child.error ? child.error.message : null,
    stdout: child.stdout || "",
    stderr: child.stderr || "",
    timedOut: Boolean(child.error && child.error.code === "ETIMEDOUT"),
  };
}

function runTimed(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1",
        TERM: "dumb",
      },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const onData = (buf, sink) => {
      sink.value += buf.toString("utf8");
    };
    const out = { value: "" };
    const err = { value: "" };
    if (child.stdout) child.stdout.on("data", (b) => onData(b, out));
    if (child.stderr) child.stderr.on("data", (b) => onData(b, err));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      if (isWin && child.pid) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 5_000,
        });
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exe,
        args,
        code: null,
        error: error.message,
        stdout: out.value,
        stderr: err.value,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      stdout = out.value;
      stderr = err.value;
      resolve({
        exe,
        args,
        code,
        signal,
        error: null,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function trimBlock(text, maxChars = 8000) {
  const s = (text || "").replace(/\r\n/g, "\n");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n...[truncated ${s.length - maxChars} chars]...`;
}

function cmdVersion(bin, args = ["-v"]) {
  const r = spawnCapture(bin, args, { timeoutMs: 10_000 });
  const text = `${r.stdout || ""}${r.stderr || ""}`.trim().split(/\r?\n/)[0] || "";
  return r.error ? `${bin}: ${r.error}` : text || `${bin}: exit ${r.status}`;
}

function whereCommand(name) {
  if (isWin) {
    const r = spawnCapture("where.exe", [name], { timeoutMs: 8_000 });
    const lines = `${r.stdout || ""}`
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { status: r.status, error: r.error, paths: lines, stderr: (r.stderr || "").trim() };
  }
  const r = spawnCapture("which", ["-a", name], { timeoutMs: 8_000 });
  const lines = `${r.stdout || ""}`
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { status: r.status, error: r.error, paths: lines, stderr: (r.stderr || "").trim() };
}

function pathEntries() {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
}

function scanPathForCodex() {
  const hits = [];
  const names = isWin
    ? ["codex.exe", "codex.cmd", "codex.bat", "codex.ps1", "codex"]
    : ["codex"];
  for (const dir of pathEntries()) {
    if (!exists(dir)) continue;
    for (const name of names) {
      const full = path.join(dir, name);
      if (exists(full)) hits.push(full);
    }
    for (const ent of listDir(dir)) {
      if (!ent.isFile() && !ent.isSymbolicLink()) continue;
      if (/codex/i.test(ent.name)) hits.push(path.join(dir, ent.name));
    }
  }
  return [...new Set(hits)];
}

function collectFixedCandidates() {
  const out = [];
  const push = (p, note) => {
    if (!p) return;
    out.push({ path: p, exists: exists(p), note });
  };

  push(path.join(localAppData, "Programs", "codex"), "LocalAppData Programs/codex");
  push(path.join(localAppData, "Programs", "Codex"), "LocalAppData Programs/Codex");
  push(path.join(localAppData, "codex"), "LocalAppData/codex (app data, not necessarily CLI)");
  push(path.join(appData, "npm", "codex.cmd"), "npm global shim");
  push(path.join(appData, "npm", "codex.ps1"), "npm global shim");
  push(path.join(appData, "npm", "codex"), "npm global shim");
  push(path.join(home, ".codex"), "CODEX_HOME / user state");
  push(path.join(home, ".cargo", "bin", "codex.exe"), "cargo bin");
  push(path.join(home, ".cargo", "bin", "codex"), "cargo bin");
  push(path.join(home, ".local", "bin", "codex.exe"), ".local/bin");
  push(path.join(home, ".local", "bin", "codex"), ".local/bin");
  push(path.join(home, "scoop", "shims", "codex.exe"), "scoop shim");
  push(path.join(programFiles, "codex"), "Program Files/codex");
  push(path.join(programFilesX86, "codex"), "Program Files (x86)/codex");
  push("C:\\ProgramData\\chocolatey\\bin\\codex.exe", "chocolatey");
  push(path.join(home, "go", "bin", "codex.exe"), "go bin");
  push(path.join(home, ".bun", "bin", "codex.exe"), "bun");
  push(path.join(home, ".volta", "bin", "codex.exe"), "volta");
  push(path.join(localAppData, "OpenAI", "Codex"), "OpenAI Codex local runtime root");
  return out;
}

function collectHashedLocalCli() {
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  const found = [];
  if (!exists(binRoot)) return found;
  for (const ent of listDir(binRoot)) {
    if (!ent.isDirectory()) continue;
    const exe = path.join(binRoot, ent.name, "codex.exe");
    if (exists(exe)) {
      const st = tryStat(exe);
      found.push({
        path: exe,
        bytes: st ? st.size : null,
        mtime: st ? st.mtime.toISOString() : null,
      });
    }
  }
  return found;
}

function collectMsixCli() {
  const found = [];
  const windowsApps = path.join(programFiles, "WindowsApps");
  let names = listDir(windowsApps).map((e) => e.name);
  if (names.length === 0 && isWin) {
    const r = spawnCapture("cmd.exe", ["/c", `dir /b "${windowsApps}"`], { timeoutMs: 8_000 });
    names = (r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  for (const name of names) {
    if (!/^OpenAI\.Codex_/i.test(name)) continue;
    const exe = path.join(windowsApps, name, "app", "resources", "codex.exe");
    const app = path.join(windowsApps, name, "app", "Codex.exe");
    const st = tryStat(exe);
    found.push({
      package: name,
      cli: exists(exe) ? exe : null,
      app: exists(app) ? app : null,
      bytes: st ? st.size : null,
      mtime: st ? st.mtime.toISOString() : null,
    });
  }
  return found;
}

function collectThirdPartyBundles() {
  const roots = [
    { dir: path.join(localAppData, "Programs", "AionUi"), depth: 14 },
    { dir: path.join(localAppData, "Programs"), depth: 5 },
  ];
  const hits = [];
  const maxFiles = 20;
  function walk(dir, depth) {
    if (hits.length >= maxFiles || depth < 0) return;
    for (const ent of listDir(dir)) {
      if (hits.length >= maxFiles) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (/node_modules|\.git|WindowsApps/i.test(ent.name)) continue;
        walk(full, depth - 1);
      } else if (/^codex(\.exe)?$/i.test(ent.name)) {
        hits.push(full);
      }
    }
  }
  for (const root of roots) {
    if (exists(root.dir)) walk(root.dir, root.depth);
  }
  return [...new Set(hits)];
}

function npmGlobalTop() {
  const r = spawnCapture("npm", ["list", "-g", "--depth=0"], { timeoutMs: 20_000 });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const matches = text
    .split(/\r?\n/)
    .filter((l) => /codex|@openai/i.test(l))
    .map((l) => l.trim());
  return { status: r.status, error: r.error, matches, rawHead: trimBlock(r.stdout || "", 1500) };
}

function npmViewCodex() {
  const r = spawnCapture(
    "npm",
    ["view", "@openai/codex", "name", "version", "description", "bin", "--json"],
    { timeoutMs: 20_000 },
  );
  return {
    status: r.status,
    error: r.error,
    stdout: trimBlock(r.stdout || "", 2000),
    stderr: trimBlock(r.stderr || "", 500),
  };
}

function wingetCodex() {
  if (!isWin) return { skipped: true };
  const r = spawnCapture("winget", ["list", "--name", "ChatGPT"], { timeoutMs: 20_000 });
  return {
    status: r.status,
    error: r.error,
    stdout: trimBlock(r.stdout || "", 2000),
    stderr: trimBlock(r.stderr || "", 400),
  };
}

function appxCodex() {
  if (!isWin) return { skipped: true };
  const r = spawnCapture(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-AppxPackage *Codex* | Select-Object Name,PackageFullName,Version,InstallLocation | Format-List",
    ],
    { timeoutMs: 20_000 },
  );
  return {
    status: r.status,
    error: r.error,
    stdout: trimBlock(r.stdout || "", 2000),
    stderr: trimBlock(r.stderr || "", 400),
  };
}

function pickPreferredCli({ pathHits, hashed, msix }) {
  if (pathHits.length > 0) return { path: pathHits[0], source: "PATH" };
  if (hashed.length > 0) {
    const sorted = [...hashed].sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
    return { path: sorted[0].path, source: "LocalAppData OpenAI Codex hashed bin" };
  }
  const msixCli = msix.map((m) => m.cli).filter(Boolean);
  if (msixCli.length > 0) return { path: msixCli[0], source: "WindowsApps MSIX resources" };
  return null;
}

async function maybeDeep(exe) {
  if (!deep) return;
  heading("Deep probes (help/auth only; no exec, no login, no logout)");
  const probes = [
    ["login", "status"],
    ["login", "--help"],
    ["exec", "--help"],
    ["exec", "resume", "--help"],
    ["queue", "--help"],
    ["sandbox", "--help"],
    ["app-server", "--help"],
    ["doctor", "--help"],
    ["pause", "--help"],
  ];
  for (const args of probes) {
    const r = await runTimed(exe, args, HELP_TIMEOUT_MS);
    log(`$ ${exe} ${args.join(" ")}`);
    log(`timedOut=${r.timedOut} code=${r.code} error=${r.error || ""}`);
    if (r.stdout) log(trimBlock(r.stdout, 4000));
    if (r.stderr) {
      log("--- stderr ---");
      log(trimBlock(r.stderr, 1000));
    }
    log("");
  }
}

async function main() {
  fs.mkdirSync(tmpDir, { recursive: true });

  heading("Environment");
  log(`date: ${new Date().toISOString()}`);
  log(`platform: ${process.platform} ${os.release()} ${os.arch()}`);
  log(`os type: ${os.type()} ${os.version()}`);
  log(`node: ${process.version}`);
  log(`npm: ${cmdVersion("npm", ["-v"])}`);
  log(`git: ${cmdVersion("git", ["--version"])}`);
  log(`pwsh: ${cmdVersion("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])}`);
  log(`cwd: ${process.cwd()}`);
  log(`home: ${home}`);
  log(`macOS: 未测`);
  log(`linux: 未测`);

  heading("PATH entries");
  for (const p of pathEntries()) log(p);

  heading("where/which codex");
  const whereCodex = whereCommand("codex");
  const whereCodexC = whereCommand("Codex");
  log(`where codex status=${whereCodex.status} paths=${JSON.stringify(whereCodex.paths)} stderr=${whereCodex.stderr || whereCodex.error || ""}`);
  log(`where Codex status=${whereCodexC.status} paths=${JSON.stringify(whereCodexC.paths)} stderr=${whereCodexC.stderr || whereCodexC.error || ""}`);

  heading("PATH scan for *codex*");
  const pathHits = scanPathForCodex();
  if (pathHits.length === 0) log("(none)");
  else pathHits.forEach((p) => log(p));

  heading("Common location existence");
  for (const row of collectFixedCandidates()) {
    log(`${row.exists ? "EXISTS" : "missing"}  ${row.path}  (${row.note})`);
  }

  heading("LocalAppData OpenAI Codex hashed CLI");
  const hashed = collectHashedLocalCli();
  if (hashed.length === 0) log("(none)");
  else hashed.forEach((h) => log(`${h.path}  bytes=${h.bytes} mtime=${h.mtime}`));

  heading("WindowsApps MSIX OpenAI.Codex");
  const msix = collectMsixCli();
  if (msix.length === 0) log("(none)");
  else {
    for (const m of msix) {
      log(`package=${m.package}`);
      log(`  cli=${m.cli || "(missing)"} bytes=${m.bytes} mtime=${m.mtime}`);
      log(`  app=${m.app || "(missing)"}`);
    }
  }

  heading("Appx / winget (Windows)");
  const appx = appxCodex();
  log("--- Get-AppxPackage *Codex* ---");
  if (appx.skipped) log("skipped (not Windows)");
  else {
    if (appx.error) log(`error: ${appx.error}`);
    if (appx.stdout) log(appx.stdout.trimEnd());
    if (appx.stderr) log(appx.stderr.trimEnd());
  }
  const winget = wingetCodex();
  log("--- winget list --name ChatGPT ---");
  if (winget.skipped) log("skipped (not Windows)");
  else {
    if (winget.error) log(`error: ${winget.error}`);
    if (winget.stdout) log(winget.stdout.trimEnd());
    if (winget.stderr) log(winget.stderr.trimEnd());
  }

  heading("npm global / registry metadata");
  const npmG = npmGlobalTop();
  log(`npm list -g --depth=0 status=${npmG.status}`);
  if (npmG.matches.length === 0) log("no global package name matching codex/@openai");
  else npmG.matches.forEach((m) => log(m));
  const npmView = npmViewCodex();
  log("npm view @openai/codex:");
  if (npmView.error) log(`error: ${npmView.error}`);
  if (npmView.stdout) log(npmView.stdout.trimEnd());
  if (npmView.stderr) log(npmView.stderr.trimEnd());

  heading("Third-party bundled codex.exe (do not auto-select)");
  const third = collectThirdPartyBundles();
  if (third.length === 0) log("(none under LocalAppData\\Programs, depth-limited)");
  else third.forEach((p) => log(p));

  const preferred = pickPreferredCli({ pathHits, hashed, msix });
  heading("Preferred executable");
  if (!preferred) {
    log("NOT FOUND: no Codex CLI on PATH, LocalAppData hashed bin, or MSIX resources.");
    log("Mark Codex runtime ops unsupported on this host until an executable is installed or configured.");
  } else {
    log(`source: ${preferred.source}`);
    log(`path: ${preferred.path}`);
    const version = await runTimed(preferred.path, ["--version"], SHORT_TIMEOUT_MS);
    log("");
    log(`$ ${preferred.path} --version`);
    log(`timedOut=${version.timedOut} code=${version.code} error=${version.error || ""}`);
    if (version.stdout) log(version.stdout.trimEnd());
    if (version.stderr) {
      log("--- stderr ---");
      log(version.stderr.trimEnd());
    }
    const help = await runTimed(preferred.path, ["--help"], HELP_TIMEOUT_MS);
    log("");
    log(`$ ${preferred.path} --help`);
    log(`timedOut=${help.timedOut} code=${help.code} error=${help.error || ""} stdoutChars=${(help.stdout || "").length} stderrChars=${(help.stderr || "").length}`);
    if (help.stdout) log(trimBlock(help.stdout, 8000));
    if (help.stderr) {
      log("--- stderr ---");
      log(trimBlock(help.stderr, 1500));
    }
    await maybeDeep(preferred.path);
  }

  heading("Notes");
  log("- Probe is report-only and exits 0 even when Codex is missing.");
  log("- Do not parse ~/.codex/auth.json; use `codex login status` for auth (see --deep).");
  log("- Do not auto-select third-party bundled copies (e.g. AionUi) unless explicitly configured.");
  log("- `--help` must be read asynchronously; a sync pipe+wait deadlocks on large help text.");
  log(`- Deep mode: ${deep ? "on" : "off"} (pass --deep for login status and subcommand --help).`);
}

main()
  .catch((err) => {
    log(`probe error: ${err && err.stack ? err.stack : err}`);
  })
  .finally(() => {
    process.exit(0);
  });
