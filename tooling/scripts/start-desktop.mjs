#!/usr/bin/env node
/**
 * Local one-click launcher for Workforce Desktop (dev).
 * Checks Node.js, ensures pnpm, installs when node_modules is missing,
 * then runs `@workforce/desktop` `dev`. Electron starts the loopback Daemon.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PNPM_VERSION = "9.4.0";
const MIN_NODE_MAJOR = 22;
const DESKTOP_FILTER = "@workforce/desktop";

function write(stream, message) {
  stream.write(`${message}\n`);
}

function fail(message, code = 1) {
  write(process.stderr, message);
  process.exit(code);
}

function parseArgs(argv) {
  const flags = new Set();
  const passthrough = [];
  let afterDash = false;
  for (const arg of argv) {
    if (afterDash) {
      passthrough.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDash = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      flags.add("help");
      continue;
    }
    if (arg === "--dry-run") {
      flags.add("dry-run");
      continue;
    }
    if (arg === "--install") {
      flags.add("install");
      continue;
    }
    fail(`Unknown argument: ${arg}\nUse --help.`);
  }
  return { flags, passthrough };
}

function helpText() {
  return [
    "Workforce local desktop launcher",
    "",
    "Usage:",
    "  node tooling/scripts/start-desktop.mjs [options] [-- extra-pnpm-args]",
    "  start.cmd",
    "  ./start.sh",
    "",
    "Options:",
    "  --help       Show this help",
    "  --dry-run    Check toolchain and print the launch command without starting Electron",
    "  --install    Run pnpm install --frozen-lockfile even if node_modules exists",
    "",
    "This starts the Electron dev shell. The app launches the loopback Daemon.",
    "It is not a packaged installer and does not enable live Codex exec.",
  ].join("\n");
}

function nodeMajor(version = process.versions.node) {
  return Number(version.split(".")[0]);
}

function assertNode() {
  const major = nodeMajor();
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    fail(`Node.js >= ${MIN_NODE_MAJOR} is required (found ${process.versions.node}).`);
  }
}

function quoteForCmd(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function spawnOnce(command, args, options = {}) {
  const isWin = process.platform === "win32";
  const file = isWin ? (process.env.ComSpec ?? "cmd.exe") : command;
  const spawnArgs = isWin
    ? ["/d", "/s", "/c", [command, ...args].map(quoteForCmd).join(" ")]
    : args;
  return new Promise((resolve, reject) => {
    const child = spawn(file, spawnArgs, {
      cwd: root,
      stdio: options.stdio ?? "inherit",
      env: { ...process.env, ...(options.env ?? {}) },
      ...options.spawn,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (error && error.code === "ENOENT") {
        resolve({ code: 127, signal: null, stdout, stderr });
        return;
      }
      reject(error);
    });
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

async function commandExists(command, args) {
  const result = await spawnOnce(command, args, { stdio: "pipe" });
  return result.code === 0;
}

async function ensurePnpm(dryRun) {
  if (await commandExists("pnpm", ["--version"])) {
    return "pnpm";
  }
  if (dryRun) {
    return "pnpm (would enable via corepack)";
  }
  write(process.stderr, `pnpm not found; enabling via corepack (pnpm@${PNPM_VERSION})...`);
  if (!(await commandExists("corepack", ["--version"]))) {
    fail("pnpm is not on PATH and corepack is unavailable. Install pnpm 9.4.x and retry.");
  }
  const enable = await spawnOnce("corepack", ["enable"]);
  if (enable.code !== 0) {
    fail("corepack enable failed.");
  }
  const prepare = await spawnOnce("corepack", ["prepare", `pnpm@${PNPM_VERSION}`, "--activate"]);
  if (prepare.code !== 0) {
    fail(`corepack prepare pnpm@${PNPM_VERSION} failed.`);
  }
  if (!(await commandExists("pnpm", ["--version"]))) {
    fail("pnpm is still not available after corepack prepare.");
  }
  return "pnpm";
}

function needsInstall(force) {
  return force || !existsSync(path.join(root, "node_modules"));
}

function assertWorkspaceRoot() {
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) {
    fail(`Cannot find package.json at ${pkgPath}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.name !== "workforce") {
    fail(`Expected workspace name "workforce" at ${pkgPath}`);
  }
}

const { flags, passthrough } = parseArgs(process.argv.slice(2));
if (flags.has("help")) {
  write(process.stdout, helpText());
  process.exit(0);
}

assertWorkspaceRoot();
assertNode();
const dryRun = flags.has("dry-run");
const pnpm = await ensurePnpm(dryRun);
const install = needsInstall(flags.has("install"));
const launchArgs = ["--filter", DESKTOP_FILTER, "dev", ...passthrough];

write(
  process.stdout,
  [
    "Workforce Desktop (dev)",
    `  repo:  ${root}`,
    `  node:  ${process.versions.node}`,
    `  pnpm:  ${pnpm}`,
    `  install: ${install ? "pnpm install --frozen-lockfile" : "skip (node_modules present)"}`,
    `  launch: pnpm ${launchArgs.join(" ")}`,
  ].join("\n"),
);

if (dryRun) {
  process.exit(0);
}

if (install) {
  write(process.stdout, "Installing dependencies...");
  const installed = await spawnOnce(pnpm, ["install", "--frozen-lockfile"]);
  if (installed.code !== 0) {
    fail(`pnpm install --frozen-lockfile exited ${installed.code}`);
  }
}

write(process.stdout, "Starting Electron. Close the window to stop.");
const launched = await spawnOnce(pnpm, launchArgs);
if (launched.signal) {
  process.exit(0);
}
process.exit(launched.code);
