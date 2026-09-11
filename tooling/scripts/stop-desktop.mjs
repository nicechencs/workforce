#!/usr/bin/env node
/**
 * Workforce Desktop 开发期进程清理。
 *
 * 目的：`start.cmd` 通过 bat 启动时，Vite dev server / Electron 窗口 / Daemon 在被
 * 强杀（关控制台、超时中断、任务管理器结束父进程）后会变成残留进程，继续占着
 * 5173 端口和 Electron 单实例锁，使下一次启动失败或静默不弹窗。
 *
 * 本脚本在重启前清掉这些进程。安全边界：
 * - 只杀命令行能证明属于**本仓库**的进程，绝不按端口号无差别杀（机器上可能同时
 *   跑着其它仓库的 Vite，例如 AgentHub 也监听 127.0.0.1:5173）。
 * - dev server 额外用 HTTP 探针确认是本仓库的 Vite（响应本仓库的入口模块），
 *   因为 `node ./scripts/dev.mjs` 的命令行不含仓库路径。
 * - 不删除任何 state 文件、数据库或 worktree；只结束进程。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEV_PORT_RANGE = { min: 5173, max: 5180 };
const PROBE_TIMEOUT_MS = 700;

function write(stream, message) {
  stream.write(`${message}\n`);
}

function fail(message, code = 1) {
  write(process.stderr, message);
  process.exit(code);
}

function parseArgs(argv) {
  const flags = new Set();
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      flags.add("help");
      continue;
    }
    if (arg === "--dry-run") {
      flags.add("dry-run");
      continue;
    }
    if (arg === "--keep-daemon") {
      flags.add("keep-daemon");
      continue;
    }
    if (arg === "--quiet") {
      flags.add("quiet");
      continue;
    }
    fail(`Unknown argument: ${arg}\nUse --help.`);
  }
  return flags;
}

function helpText() {
  return [
    "Workforce desktop process cleanup",
    "",
    "Usage:",
    "  node tooling/scripts/stop-desktop.mjs [options]",
    "  restart.cmd                 (stop, then start)",
    "  ./restart.sh                (stop, then start)",
    "",
    "Options:",
    "  --help         Show this help",
    "  --dry-run      List what would be stopped without killing anything",
    "  --keep-daemon  Leave the loopback Daemon running (UI and dev server still stop)",
    "  --quiet        Only print the summary line",
    "",
    "Only processes whose command line proves they belong to this repository are",
    "stopped. The Daemon is identified by its own daemon.json pid. Nothing on disk",
    "is deleted: state files, the SQLite database and git worktrees are untouched.",
  ].join("\n");
}

/* ─── 纯逻辑（可在测试中直接断言） ─────────────────────────────────────── */

/**
 * 命令行标记：全部片段都出现才算命中。
 * 归一化后比较（小写、统一斜杠），因此同时覆盖 `\` 与 `/` 两种写法。
 */
export const CMDLINE_MARKERS = [
  { reason: "desktop-ui", need: ["apps/desktop/dist/main/electron-main.js"] },
  { reason: "desktop-ui", need: ["apps/desktop/src/main/electron-main.ts"] },
  { reason: "daemon", need: ["apps/daemon/src/index.ts"] },
  { reason: "daemon", need: ["apps/daemon/dist/index.js"] },
  { reason: "launcher", need: ["tooling/scripts/start-desktop.mjs"] },
  { reason: "dev-server", need: ["apps/desktop/scripts/dev.mjs"] },
  { reason: "dev-run", need: ["--filter @workforce/desktop dev"] },
];

/**
 * 自身 pid 加上它的全部祖先。调用方（cmd.exe / bash / IDE 任务）的命令行里会出现
 * 本脚本路径，若不当则会被自己的标记命中并把调用者杀掉。
 */
export function collectAncestors(processes, selfPid) {
  const parentOf = new Map(processes.map((proc) => [proc.pid, proc.parentPid]));
  const excluded = new Set([selfPid]);
  let current = parentOf.get(selfPid);
  while (typeof current === "number" && current > 1 && !excluded.has(current)) {
    excluded.add(current);
    current = parentOf.get(current);
  }
  return excluded;
}

export function normalizeCommandLine(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\\/g, "/");
}

/** 命中返回 reason，未命中返回 null。 */
export function classifyProcess(commandLine) {
  const normalized = normalizeCommandLine(commandLine);
  if (!normalized) {
    return null;
  }
  for (const marker of CMDLINE_MARKERS) {
    if (marker.need.every((fragment) => normalized.includes(fragment))) {
      return marker.reason;
    }
  }
  return null;
}

/**
 * 从进程快照里挑出要停的进程。
 * `portOwners` 是已通过 HTTP 探针确认属于本仓库的 dev server pid。
 */
export function selectProcessesToStop(input) {
  const { processes, excludePids, daemonPid, portOwners = [], skipReasons } = input;
  const excluded = excludePids instanceof Set ? excludePids : new Set(excludePids ?? []);
  const skipped = skipReasons instanceof Set ? skipReasons : new Set(skipReasons ?? []);
  const selected = new Map();

  for (const proc of processes) {
    if (excluded.has(proc.pid)) {
      continue;
    }
    const reason = classifyProcess(proc.commandLine);
    if (reason && !skipped.has(reason)) {
      selected.set(proc.pid, { pid: proc.pid, reason, commandLine: proc.commandLine });
    }
  }

  const confirmedPortOwners = new Set(portOwners);
  if (!skipped.has("dev-server")) {
    for (const proc of processes) {
      if (excluded.has(proc.pid) || !confirmedPortOwners.has(proc.pid)) {
        continue;
      }
      if (!selected.has(proc.pid)) {
        selected.set(proc.pid, {
          pid: proc.pid,
          reason: "dev-server",
          commandLine: proc.commandLine,
        });
      }
    }
  }

  if (
    !skipped.has("daemon") &&
    typeof daemonPid === "number" &&
    daemonPid > 0 &&
    !excluded.has(daemonPid)
  ) {
    const known = processes.find((proc) => proc.pid === daemonPid);
    if (known) {
      selected.set(daemonPid, {
        pid: daemonPid,
        reason: "daemon",
        commandLine: known.commandLine,
      });
    }
  }

  return [...selected.values()].sort((a, b) => a.pid - b.pid);
}

export function defaultStateDir(env = process.env) {
  const override = env.WORKFORCE_STATE_DIR;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  if (process.platform === "win32") {
    const appData = env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Workforce");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Workforce");
  }
  const xdg = env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "workforce");
}

export function readDaemonPid(stateDir) {
  const statePath = path.join(stateDir, "daemon.json");
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    return typeof parsed.pid === "number" && parsed.pid > 0 ? parsed.pid : null;
  } catch {
    return null;
  }
}

/* ─── 平台实现 ─────────────────────────────────────────────────────────── */

function powershell(script) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function parseJsonOutput(raw) {
  if (!raw) {
    return [];
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function listProcessesWin32() {
  const output = powershell(
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 3",
  );
  if (output === null) {
    fail("Failed to enumerate processes via PowerShell.");
  }
  return parseJsonOutput(output).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    name: String(row.Name ?? ""),
    commandLine: String(row.CommandLine ?? ""),
  }));
}

function listProcessesPosix() {
  const output = execFileSync("ps", ["-eo", "pid=,ppid=,comm=,args="], { encoding: "utf8" });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!match) {
        return null;
      }
      const [, pid, ppid, name, args] = match;
      return {
        pid: Number(pid),
        parentPid: Number(ppid),
        name,
        commandLine: `${name} ${args}`.trim(),
      };
    })
    .filter((proc) => proc !== null);
}

function listProcesses() {
  return process.platform === "win32" ? listProcessesWin32() : listProcessesPosix();
}

/** Linux 上可读 /proc/<pid>/cwd，用于识别相对路径启动的 dev server。 */
function posixCwdOf(pid) {
  if (process.platform !== "linux") {
    return null;
  }
  try {
    return readFileSync(`/proc/${pid}/cwd`, "utf8");
  } catch {
    return null;
  }
}

function findPosixDevServerPids(processes, selfPid) {
  const found = [];
  for (const proc of processes) {
    if (proc.pid === selfPid) {
      continue;
    }
    const commandLine = normalizeCommandLine(proc.commandLine);
    if (!commandLine.includes("scripts/dev.mjs")) {
      continue;
    }
    const cwd = posixCwdOf(proc.pid);
    if (cwd && path.resolve(cwd) === root) {
      found.push(proc.pid);
    }
  }
  return found;
}

/**
 * 从本仓库的 index.html 读取“这是我们的 dev server”的指纹。
 * 不能只看状态码：Vite 的 SPA fallback 对不存在的路径也回 200，所以必须比对响应正文。
 * 指纹直接从源文件读，改标题/入口时探针自动跟随。
 */
export function rendererFingerprint(html) {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  const entry = /<script[^>]+src="([^"]+)"/i.exec(html)?.[1]?.trim();
  return { title, entry };
}

function readRendererFingerprint() {
  const indexPath = path.join(root, "apps/desktop/index.html");
  return rendererFingerprint(readFileSync(indexPath, "utf8"));
}

export function bodyMatchesFingerprint(body, fingerprint) {
  if (typeof fingerprint.title !== "string" || fingerprint.title.length === 0) {
    return false;
  }
  if (!body.includes(`<title>${fingerprint.title}</title>`)) {
    return false;
  }
  if (typeof fingerprint.entry === "string" && fingerprint.entry.length > 0) {
    return body.includes(fingerprint.entry);
  }
  return true;
}

async function probeWorkforceDevServer(port, fingerprint) {
  for (const host of ["127.0.0.1", "[::1]"]) {
    try {
      const response = await fetch(`http://${host}:${port}/`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        redirect: "manual",
      });
      if (response.status !== 200) {
        continue;
      }
      const body = await response.text();
      if (bodyMatchesFingerprint(body, fingerprint)) {
        return true;
      }
    } catch {
      // 端口没开、不是本仓库、或超时：继续看下一个。
    }
  }
  return false;
}

function portOwnerWin32(port) {
  const output = powershell(
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess | ConvertTo-Json -Compress`,
  );
  if (output === null) {
    return null;
  }
  try {
    const rows = parseJsonOutput(output);
    const pid = Number(rows[0]?.OwningProcess);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** 用 HTTP 探针确认哪些端口上是本仓库的 dev server。 */
async function findDevServerPortOwners() {
  if (process.platform !== "win32") {
    return [];
  }
  const fingerprint = readRendererFingerprint();
  const owners = [];
  for (let port = DEV_PORT_RANGE.min; port <= DEV_PORT_RANGE.max; port += 1) {
    if (!(await probeWorkforceDevServer(port, fingerprint))) {
      continue;
    }
    const pid = portOwnerWin32(port);
    if (pid !== null) {
      owners.push(pid);
    }
  }
  return owners;
}

function killTree(pid) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0;
  }
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitForExit(pids, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let remaining = pids.filter(isAlive);
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    remaining = remaining.filter(isAlive);
  }
  return remaining;
}

/* ─── 主流程 ───────────────────────────────────────────────────────────── */

/**
 * 只有被直接执行时才跑主流程。没有这道门时，单元测试里 `import` 本模块
 * 就会真的把本机的 Workforce 进程杀掉。
 */
export function isDirectRun(argv1, moduleUrl) {
  if (typeof argv1 !== "string" || argv1.length === 0) {
    return false;
  }
  try {
    return pathToFileURL(path.resolve(argv1)).href === moduleUrl;
  } catch {
    return false;
  }
}

/** 返回进程退出码；不直接调用 process.exit，方便测试直接断言。 */
export async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.has("help")) {
    write(process.stdout, helpText());
    return 0;
  }

  const quiet = flags.has("quiet");
  const dryRun = flags.has("dry-run");
  const keepDaemon = flags.has("keep-daemon");
  const stateDir = defaultStateDir();
  const daemonPid = keepDaemon ? null : readDaemonPid(stateDir);

  const processes = listProcesses();
  const portOwners =
    process.platform === "win32"
      ? await findDevServerPortOwners()
      : findPosixDevServerPids(processes, process.pid);

  const targets = selectProcessesToStop({
    processes,
    excludePids: collectAncestors(processes, process.pid),
    daemonPid,
    portOwners,
    skipReasons: keepDaemon ? new Set(["daemon"]) : new Set(),
  });

  if (targets.length === 0) {
    write(process.stdout, quiet ? "clean" : "没有发现属于本仓库的残留进程。");
    return 0;
  }

  if (!quiet) {
    write(
      process.stdout,
      `发现 ${targets.length} 个残留进程${dryRun ? "（dry-run，不结束）" : ""}：`,
    );
    for (const target of targets) {
      const commandLine = target.commandLine.trim().replace(/\s+/g, " ");
      const preview = commandLine.length > 120 ? `${commandLine.slice(0, 117)}...` : commandLine;
      write(process.stdout, `  [${target.reason}] pid=${target.pid}  ${preview}`);
    }
  }

  if (dryRun) {
    return 0;
  }

  const failed = [];
  for (const target of targets) {
    // taskkill 在子树中已有进程先退出时会返回非零，因此退出码不能当作失败依据；
    // 真正的事实以结束后的存活检查为准。
    if (!killTree(target.pid)) {
      failed.push(target.pid);
    }
  }

  // Windows 的 taskkill /T 同步结束整棵树；POSIX 上 SIGTERM 后仍未退出则升级到 SIGKILL。
  let survivors = await waitForExit(targets.map((target) => target.pid));
  if (survivors.length > 0 && process.platform !== "win32") {
    for (const pid of survivors) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // 已经退出
      }
    }
    survivors = await waitForExit(survivors, 2000);
  }

  if (survivors.length > 0) {
    write(process.stderr, `以下进程未能结束，请手动处理：${survivors.join(", ")}`);
    if (failed.length > 0) {
      write(process.stderr, `taskkill 也报告了失败：${failed.join(", ")}`);
    }
  }

  if (quiet) {
    write(process.stdout, `stopped ${targets.length - survivors.length}/${targets.length}`);
  } else {
    write(process.stdout, `已结束 ${targets.length - survivors.length}/${targets.length} 个进程。`);
  }

  return survivors.length === 0 ? 0 : 1;
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  process.exit(await main());
}
