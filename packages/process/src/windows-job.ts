import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mergeMinimalEnv } from "./env.js";
import { identityMismatchError } from "./start-identity.js";
import type { TrackedProcess } from "./tracked.js";
import {
  pollUntil,
  queryWin32StartIdentity,
  resolveJobSupervisorScript,
  resolveWindowsShell,
  sleep,
  snapshotDescendants,
  taskkillPid,
  tasklistHasPid,
} from "./windows-inspect.js";

export function quoteWin32Arg(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  if (!/[\s"]/.test(arg)) {
    return arg;
  }
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      slashes += 1;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(slashes * 2 + 1);
      out += '"';
      slashes = 0;
      continue;
    }
    out += "\\".repeat(slashes);
    out += ch;
    slashes = 0;
  }
  out += "\\".repeat(slashes * 2);
  out += '"';
  return out;
}

export function buildWin32CommandLine(argv: string[]): string {
  return argv.map(quoteWin32Arg).join(" ");
}

export async function spawnWindows(req: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<TrackedProcess> {
  try {
    const job = await trySpawnInJob(req);
    if (job) {
      return job;
    }
  } catch {
    // Job Object path is preferred but not required; fall back to spawn + taskkill.
  }
  return spawnFallback(req);
}

export async function inspectWindows(handle: {
  pid: number;
  startIdentity: string;
}): Promise<{ alive: boolean; startIdentity: string }> {
  if (!tasklistHasPid(handle.pid)) {
    return { alive: false, startIdentity: handle.startIdentity };
  }
  const observed = await observedIdentity(handle.pid);
  if (observed === handle.startIdentity) {
    return { alive: true, startIdentity: observed };
  }
  return { alive: false, startIdentity: handle.startIdentity };
}

export async function cancelWindows(
  handle: { pid: number; startIdentity: string },
  mode: "graceful" | "force",
  tracked: TrackedProcess | undefined,
): Promise<void> {
  if (!tasklistHasPid(handle.pid)) {
    await cleanupTracked(tracked);
    return;
  }
  const observed = await observedIdentity(handle.pid);
  if (observed !== handle.startIdentity) {
    throw identityMismatchError(handle, observed);
  }
  if (mode === "graceful") {
    try {
      tracked?.child?.stdin?.end();
    } catch {
      // stdin may already be closed; graceful is a no-op at this layer on Windows
    }
    return;
  }

  rememberDescendants(tracked, handle.pid);

  if (tracked?.usedJob && tracked.closeFlag) {
    try {
      fs.writeFileSync(tracked.closeFlag, "close\n");
    } catch {
      // helper may already have exited
    }
    try {
      tracked.helper?.stdin?.end();
    } catch {
      // ignore
    }
    const died = await pollUntil(() => !tasklistHasPid(handle.pid), 10_000);
    if (died) {
      await killRecordedDescendants(tracked);
      await cleanupTracked(tracked);
      return;
    }
  }

  if (tasklistHasPid(handle.pid)) {
    const stillMatches = (await observedIdentity(handle.pid)) === handle.startIdentity;
    if (!stillMatches) {
      throw identityMismatchError(handle, await observedIdentity(handle.pid));
    }
    rememberDescendants(tracked, handle.pid);
    taskkillPid(handle.pid, true);
    await pollUntil(() => !tasklistHasPid(handle.pid), 8_000);
  }

  await killRecordedDescendants(tracked);
  await cleanupTracked(tracked);
}

async function trySpawnInJob(req: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<TrackedProcess | undefined> {
  const exe = req.argv[0];
  if (exe === undefined) {
    throw new Error("SpawnRequest.argv[0] must be an executable");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-job-"));
  const requestFile = path.join(dir, "request.json");
  const statusFile = path.join(dir, "status.json");
  const closeFlag = path.join(dir, "close.flag");
  const applicationName = resolveApplicationName(exe, req.cwd);
  const request: {
    commandLine: string;
    cwd: string;
    env: Record<string, string>;
    applicationName?: string;
  } = {
    commandLine: buildWin32CommandLine(req.argv),
    cwd: req.cwd,
    env: req.env,
  };
  if (applicationName) {
    request.applicationName = applicationName;
  }
  fs.writeFileSync(requestFile, JSON.stringify(request), "utf8");

  const helper = spawn(
    resolveWindowsShell(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      resolveJobSupervisorScript(),
      "-Action",
      "spawn",
      "-RequestFile",
      requestFile,
      "-StatusFile",
      statusFile,
      "-CloseFlag",
      closeFlag,
    ],
    {
      cwd: dir,
      env: helperEnv(),
      windowsHide: true,
      detached: false,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );

  try {
    await waitForChildSpawn(helper);
    const status = await waitForStatus(statusFile, helper, 25_000);
    if (
      status.ok === true &&
      typeof status.pid === "number" &&
      typeof status.startIdentity === "string" &&
      status.startIdentity.startsWith("win32:")
    ) {
      const tracked: TrackedProcess = {
        handle: { pid: status.pid, startIdentity: status.startIdentity },
        platform: "win32",
        descendants: [],
        usedJob: true,
        closeFlag,
        helper,
        dir,
      };
      return tracked;
    }
  } catch {
    // fall through to cleanup + fallback
  }

  try {
    helper.stdin?.end();
  } catch {
    // ignore
  }
  if (helper.pid !== undefined && tasklistHasPid(helper.pid)) {
    taskkillPid(helper.pid, false);
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  return undefined;
}

async function spawnFallback(req: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<TrackedProcess> {
  const exe = req.argv[0];
  if (exe === undefined) {
    throw new Error("SpawnRequest.argv[0] must be an executable");
  }
  const child = spawn(exe, req.argv.slice(1), {
    cwd: req.cwd,
    env: req.env,
    windowsHide: true,
    detached: false,
    stdio: ["pipe", "ignore", "ignore"],
  });
  await waitForChildSpawn(child);
  if (child.pid === undefined) {
    throw new Error("windows spawn produced no pid");
  }
  const startIdentity = await waitForStartIdentity(child.pid);
  return {
    handle: { pid: child.pid, startIdentity },
    platform: "win32",
    descendants: [],
    usedJob: false,
    child,
  };
}

async function waitForStartIdentity(pid: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < 8_000) {
    const id = queryWin32StartIdentity(pid);
    if (id) {
      return id;
    }
    if (!tasklistHasPid(pid)) {
      break;
    }
    await sleep(50);
  }
  throw new Error(`failed to read startIdentity for pid ${pid}`);
}

async function observedIdentity(pid: number): Promise<string | undefined> {
  for (let i = 0; i < 8; i += 1) {
    const id = queryWin32StartIdentity(pid);
    if (id) {
      return id;
    }
    if (!tasklistHasPid(pid)) {
      return undefined;
    }
    await sleep(50);
  }
  return queryWin32StartIdentity(pid);
}

function rememberDescendants(tracked: TrackedProcess | undefined, rootPid: number): void {
  if (!tracked || !tasklistHasPid(rootPid)) {
    return;
  }
  const snap = snapshotDescendants(rootPid);
  for (const row of snap) {
    if (
      !tracked.descendants.some((d) => d.pid === row.pid && d.startIdentity === row.startIdentity)
    ) {
      tracked.descendants.push(row);
    }
  }
}

async function killRecordedDescendants(tracked: TrackedProcess | undefined): Promise<void> {
  if (!tracked) {
    return;
  }
  for (const descendant of tracked.descendants) {
    if (!tasklistHasPid(descendant.pid)) {
      continue;
    }
    const observed = await observedIdentity(descendant.pid);
    if (observed !== descendant.startIdentity) {
      continue;
    }
    taskkillPid(descendant.pid, false);
  }
}

async function cleanupTracked(tracked: TrackedProcess | undefined): Promise<void> {
  if (!tracked) {
    return;
  }
  try {
    tracked.helper?.stdin?.end();
  } catch {
    // ignore
  }
  const helperPid = tracked.helper?.pid;
  if (helperPid !== undefined && tasklistHasPid(helperPid)) {
    const exited = await pollUntil(() => !tasklistHasPid(helperPid), 3_000);
    if (!exited) {
      taskkillPid(helperPid, false);
      await pollUntil(() => !tasklistHasPid(helperPid), 3_000);
    }
  }
  if (tracked.dir) {
    try {
      fs.rmSync(tracked.dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function helperEnv(): Record<string, string> {
  const env = mergeMinimalEnv();
  for (const key of [
    "PSModulePath",
    "ProgramFiles",
    "ProgramW6432",
    "LOCALAPPDATA",
    "ProgramFiles(x86)",
  ]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function resolveApplicationName(exe: string, cwd: string): string | undefined {
  if (path.isAbsolute(exe)) {
    return exe;
  }
  if (exe.includes("/") || exe.includes("\\")) {
    return path.resolve(cwd, exe);
  }
  return undefined;
}

function waitForChildSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      child.off("spawn", onSpawn);
      reject(err);
    };
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

type HelperStatus = {
  ok?: unknown;
  pid?: unknown;
  startIdentity?: unknown;
};

async function waitForStatus(
  statusFile: string,
  helper: ChildProcess,
  timeoutMs: number,
): Promise<HelperStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(statusFile)) {
      try {
        const raw = fs
          .readFileSync(statusFile, "utf8")
          .replace(/^\uFEFF/, "")
          .trim();
        if (raw.length > 0) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
            return parsed as HelperStatus;
          }
        }
      } catch {
        // incomplete write
      }
    }
    if (helper.exitCode !== null && helper.exitCode !== undefined && !fs.existsSync(statusFile)) {
      throw new Error(`job helper exited ${helper.exitCode} before writing status`);
    }
    await sleep(50);
  }
  throw new Error("timed out waiting for job helper status");
}
