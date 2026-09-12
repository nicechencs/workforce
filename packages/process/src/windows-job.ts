import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProcessControllerError } from "@workforce/application/ports";

import { captureChildOutput } from "./captured-output.js";
import { mergeMinimalEnv } from "./env.js";
import { identityMismatchError } from "./start-identity.js";
import { observeChild, type TrackedProcess, type TrackedProcessExit } from "./tracked.js";
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
  capture?: boolean;
}): Promise<TrackedProcess> {
  if (req.capture) {
    try {
      const job = await trySpawnInJob(req, true);
      if (job) {
        return job;
      }
    } catch (error) {
      if (error instanceof ProcessControllerError) {
        throw error;
      }
      throw capturedProcessUnsupported(toError(error));
    }
    throw capturedProcessUnsupported(new Error("Windows Job Object stream capture is unavailable"));
  }
  try {
    const job = await trySpawnInJob(req, false);
    if (job) {
      return job;
    }
  } catch {
    // Job Object path is preferred but not required for uncaptured spawn; fall back to spawn + taskkill.
  }
  return spawnFallback(req);
}

export async function inspectWindows(
  handle: {
    pid: number;
    startIdentity: string;
  },
  tracked?: TrackedProcess,
): Promise<{ alive: boolean; startIdentity: string }> {
  if (isTrackedJobHandle(tracked, handle)) {
    const root = await liveMatchingRoot(handle);
    if (root === "mismatch") {
      releaseTrackedJob(tracked);
      return { alive: false, startIdentity: handle.startIdentity };
    }
    const state = trackedWindowsJobState(tracked);
    if (state === "alive") {
      return { alive: true, startIdentity: handle.startIdentity };
    }
    if (state === "unknown") {
      throw unverifiedWindowsJobError(handle.pid, "inspect");
    }
    return { alive: false, startIdentity: handle.startIdentity };
  }
  if (!tasklistHasPid(handle.pid)) {
    return { alive: false, startIdentity: handle.startIdentity };
  }
  const observed = await observedIdentity(handle.pid);
  if (observed === handle.startIdentity) {
    return { alive: true, startIdentity: observed };
  }
  return { alive: false, startIdentity: handle.startIdentity };
}

export function trackedWindowsJobAlive(tracked: TrackedProcess): boolean {
  return trackedWindowsJobState(tracked) !== "dead";
}

/** Waits until the Job Object created for captured execution is empty. */
export async function waitForTrackedWindowsJobExit(tracked: TrackedProcess): Promise<void> {
  if (tracked.win32Job?.terminalVerified) {
    return;
  }
  if (!tracked.usedJob || !tracked.win32Job?.owned) {
    throw unverifiedWindowsJobError(tracked.handle.pid, "wait");
  }
  for (;;) {
    const state = trackedWindowsJobState(tracked);
    if (state === "dead") {
      if (tracked.win32Job?.terminalVerified) {
        return;
      }
      throw unverifiedWindowsJobError(tracked.handle.pid, "wait");
    }
    if (state === "unknown") {
      throw unverifiedWindowsJobError(tracked.handle.pid, "wait");
    }
    await sleep(25);
  }
}

export async function cancelWindows(
  handle: { pid: number; startIdentity: string },
  mode: "graceful" | "force",
  tracked: TrackedProcess | undefined,
): Promise<void> {
  if (!tasklistHasPid(handle.pid)) {
    if (isTrackedJobHandle(tracked, handle) && trackedWindowsJobState(tracked) === "alive") {
      if (mode === "force") {
        requestJobClose(tracked);
      }
      return;
    }
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
    requestJobClose(tracked);
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

async function trySpawnInJob(
  req: {
    argv: string[];
    cwd: string;
    env: Record<string, string>;
  },
  capture: boolean,
): Promise<TrackedProcess | undefined> {
  const exe = req.argv[0];
  if (exe === undefined) {
    throw new Error("SpawnRequest.argv[0] must be an executable");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-job-"));
  const requestFile = path.join(dir, "request.json");
  const statusFile = path.join(dir, "status.json");
  const closeFlag = path.join(dir, "close.flag");
  const exitFile = path.join(dir, "exit.json");
  const jobFile = path.join(dir, "job.json");
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

  const helperArgs = [
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
  ];
  if (capture) {
    helperArgs.push("-Capture", "-ExitFile", exitFile, "-JobFile", jobFile);
  }

  let helper: ChildProcess;
  try {
    helper = spawn(resolveWindowsShell(), helperArgs, {
      cwd: dir,
      env: helperEnv(),
      windowsHide: true,
      detached: false,
      stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "ignore", "ignore"],
    });
  } catch (error) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    if (capture) {
      throw capturedProcessUnsupported(toError(error));
    }
    return undefined;
  }
  const helperCompletion = observeChild(helper);

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
      if (capture) {
        if (!helper.stdin || !helper.stdout || !helper.stderr) {
          throw new ProcessControllerError(
            "spawn_failed",
            "spawn",
            "captured process streams are unavailable",
          );
        }
        tracked.child = helper;
        tracked.output = captureChildOutput(helper);
        tracked.win32Job = { owned: true, jobFile, exitFile };
        tracked.completion = waitForCapturedRootExit(tracked, helperCompletion);
      } else {
        tracked.completion = helperCompletion.then((result) => {
          cleanupJobArtifacts(tracked);
          return result;
        });
      }
      return tracked;
    }
    if (capture) {
      throw classifyCapturedHelperFailure(status, helper);
    }
  } catch (error) {
    if (capture) {
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
      if (error instanceof ProcessControllerError) {
        throw error;
      }
      throw classifyCapturedHelperFailure(undefined, helper, toError(error));
    }
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
  const completion = observeChild(child);
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
    completion,
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
      return `win32:${pid}:unresolved`;
    }
    await sleep(50);
  }
  if (tasklistHasPid(pid)) {
    taskkillPid(pid, true);
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

async function liveMatchingRoot(handle: {
  pid: number;
  startIdentity: string;
}): Promise<"alive" | "dead" | "mismatch"> {
  if (!tasklistHasPid(handle.pid)) {
    return "dead";
  }
  const observed = await observedIdentity(handle.pid);
  if (observed === handle.startIdentity) {
    return "alive";
  }
  if (observed === undefined) {
    return "dead";
  }
  return "mismatch";
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
    cleanupJobArtifacts(tracked);
  }
}

function cleanupJobArtifacts(tracked: TrackedProcess): void {
  if (!tracked.dir) {
    return;
  }
  try {
    fs.rmSync(tracked.dir, { recursive: true, force: true });
  } catch {
    // cleanup is best-effort; the helper and target are already observably stopped
  }
  delete tracked.dir;
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
  stage?: unknown;
  win32?: unknown;
  error?: unknown;
  exitCode?: unknown;
  activeProcesses?: unknown;
  jobClosed?: unknown;
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
        const parsed = readJsonFile(statusFile);
        if (parsed !== undefined && "ok" in parsed) {
          return parsed;
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

async function waitForCapturedRootExit(
  tracked: TrackedProcess,
  helperCompletion: Promise<TrackedProcessExit>,
): Promise<TrackedProcessExit> {
  const exitFile = tracked.win32Job?.exitFile;
  if (!exitFile) {
    return {
      kind: "error",
      error: new Error("captured job is missing an exit file"),
    };
  }
  const helperFailure = helperCompletion.then((result) => {
    const existing = readExitStatus(exitFile);
    if (existing) {
      return existing;
    }
    if (result.kind === "error") {
      return result;
    }
    return {
      kind: "error" as const,
      error: new Error(
        `job helper exited ${result.exitCode ?? result.signal} before writing captured exit`,
      ),
    };
  });
  const exitWritten = (async (): Promise<TrackedProcessExit> => {
    for (;;) {
      const parsed = readExitStatus(exitFile);
      if (parsed) {
        return parsed;
      }
      await sleep(25);
    }
  })();
  const result = await Promise.race([exitWritten, helperFailure]);
  if (result.kind === "exit" && tracked.win32Job) {
    trackedWindowsJobState(tracked);
  }
  return result;
}

function readExitStatus(exitFile: string): TrackedProcessExit | undefined {
  const parsed = readJsonFile(exitFile);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed.ok === false) {
    const stage = typeof parsed.stage === "string" ? parsed.stage : "captured-exit";
    return {
      kind: "error",
      error: new Error(`job helper failed to observe captured exit (${stage})`),
    };
  }
  if (parsed.ok !== true || typeof parsed.exitCode !== "number" || parsed.exitCode === 259) {
    return {
      kind: "error",
      error: new Error("job helper wrote an unusable captured exit"),
    };
  }
  if (parsed.activeProcesses !== 0) {
    return {
      kind: "error",
      error: new Error("job helper reported root exit before the job was empty"),
    };
  }
  return { kind: "exit", exitCode: parsed.exitCode, signal: null };
}

function readJsonFile(file: string): HelperStatus | undefined {
  try {
    if (!fs.existsSync(file)) {
      return undefined;
    }
    const raw = fs
      .readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .trim();
    if (raw.length === 0) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as HelperStatus;
    }
  } catch {
    // incomplete write
  }
  return undefined;
}

type GroupState = "alive" | "dead" | "unknown";

function trackedWindowsJobState(tracked: TrackedProcess): GroupState {
  const job = tracked.win32Job;
  if (!job?.owned) {
    return "dead";
  }
  if (job.terminalVerified) {
    return "dead";
  }
  const snapshot = readJsonFile(job.jobFile);
  const helperGone = tracked.helper?.exitCode !== null && tracked.helper?.exitCode !== undefined;
  if (snapshot && typeof snapshot.activeProcesses === "number") {
    if (snapshot.activeProcesses > 0) {
      return "alive";
    }
    if (snapshot.activeProcesses === 0) {
      if (tasklistHasPid(tracked.handle.pid)) {
        const observed = queryWin32StartIdentity(tracked.handle.pid);
        if (observed === tracked.handle.startIdentity) {
          return "alive";
        }
        if (observed !== undefined && observed !== tracked.handle.startIdentity) {
          job.owned = false;
          return "dead";
        }
        return "unknown";
      }
      job.owned = false;
      job.terminalVerified = true;
      cleanupJobArtifacts(tracked);
      return "dead";
    }
  }
  if (snapshot?.jobClosed === true && !tasklistHasPid(tracked.handle.pid)) {
    job.owned = false;
    job.terminalVerified = true;
    cleanupJobArtifacts(tracked);
    return "dead";
  }
  if (!snapshot && !helperGone) {
    return "alive";
  }
  if (helperGone) {
    const exitStatus = readExitStatus(job.exitFile);
    if (exitStatus?.kind === "exit" && !tasklistHasPid(tracked.handle.pid)) {
      job.owned = false;
      job.terminalVerified = true;
      cleanupJobArtifacts(tracked);
      return "dead";
    }
    return "unknown";
  }
  return "alive";
}

function isTrackedJobHandle(
  tracked: TrackedProcess | undefined,
  handle: { pid: number; startIdentity: string },
): tracked is TrackedProcess {
  return (
    tracked?.platform === "win32" &&
    tracked.usedJob === true &&
    tracked.handle.pid === handle.pid &&
    tracked.handle.startIdentity === handle.startIdentity
  );
}

function releaseTrackedJob(tracked: TrackedProcess | undefined): void {
  if (tracked?.win32Job) {
    tracked.win32Job.owned = false;
  }
}

function requestJobClose(tracked: TrackedProcess): void {
  if (!tracked.closeFlag) {
    return;
  }
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
}

function classifyCapturedHelperFailure(
  status: HelperStatus | undefined,
  helper: ChildProcess,
  cause?: Error,
): ProcessControllerError {
  const stage = typeof status?.stage === "string" ? status.stage : undefined;
  if (
    stage === "CreateJobObject" ||
    stage === "SetInformationJobObject" ||
    stage === "AssignProcessToJobObject" ||
    stage === "CreateStdPipes"
  ) {
    return capturedProcessUnsupported(new Error(`Windows Job Object capture failed at ${stage}`));
  }
  if (stage === "CreateProcessW") {
    return new ProcessControllerError(
      "spawn_failed",
      "spawn",
      `Windows CreateProcessW failed${typeof status?.win32 === "number" ? ` (${status.win32})` : ""}`,
    );
  }
  if (cause && (cause as NodeJS.ErrnoException).code === "ENOENT") {
    return capturedProcessUnsupported(cause);
  }
  if (helper.exitCode !== null && helper.exitCode !== undefined && status?.ok !== true) {
    if (!stage || stage === "trap") {
      return capturedProcessUnsupported(
        cause ?? new Error("job helper exited before captured spawn was confirmed"),
      );
    }
  }
  return new ProcessControllerError(
    "spawn_failed",
    "spawn",
    cause?.message ?? "captured Windows process failed to start",
    cause === undefined ? undefined : { cause },
  );
}

function capturedProcessUnsupported(cause: Error): ProcessControllerError {
  return new ProcessControllerError("unsupported_capability", "spawn", cause.message, {
    capability: "process.capture",
    platform: "win32",
    cause,
  });
}

function unverifiedWindowsJobError(
  pid: number,
  operation: "wait" | "inspect" | "spawn",
): ProcessControllerError {
  return new ProcessControllerError(
    "process_tree_unverified",
    operation,
    `windows job for pid ${pid} could not be verified during ${operation}`,
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
