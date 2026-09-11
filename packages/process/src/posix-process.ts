import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import { captureChildOutput } from "./captured-output.js";
import { identityMismatchError } from "./start-identity.js";
import { observeChild, type TrackedProcess } from "./tracked.js";

// macOS process-group behavior remains untested (see UNTESTED_PROCESS_PLATFORMS).

export async function spawnPosix(req: {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  capture?: boolean;
}): Promise<TrackedProcess> {
  const exe = req.argv[0];
  if (exe === undefined) {
    throw new Error("SpawnRequest.argv[0] must be an executable");
  }
  const child = spawn(exe, req.argv.slice(1), {
    cwd: req.cwd,
    env: req.env,
    detached: true,
    stdio: ["pipe", req.capture ? "pipe" : "ignore", req.capture ? "pipe" : "ignore"],
  });
  const output = req.capture ? captureChildOutput(child) : undefined;
  const completion = observeChild(child);
  await waitForChildSpawn(child);
  if (child.pid === undefined) {
    throw new Error("posix spawn produced no pid");
  }
  const info = queryPosixProcessInfo(child.pid);
  const startIdentity = info?.startIdentity ?? `posix:${child.pid}:unresolved`;
  const posixGroup =
    info?.startIdentity !== undefined && info.pgrp === child.pid && info.sessionId === child.pid
      ? {
          pgid: child.pid,
          sessionId: child.pid,
          rootStartIdentity: startIdentity,
          owned: true,
        }
      : undefined;
  if (req.capture && !posixGroup) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The just-spawned root may already have exited.
      }
    }
    throw unverifiedProcessGroupError(child.pid);
  }
  const tracked: TrackedProcess = {
    handle: { pid: child.pid, startIdentity },
    platform: "posix",
    descendants: [],
    usedJob: false,
    child,
    completion,
  };
  if (output) {
    tracked.output = output;
  }
  if (posixGroup) {
    tracked.posixGroup = posixGroup;
  }
  return tracked;
}

export async function inspectPosix(
  handle: {
    pid: number;
    startIdentity: string;
  },
  tracked?: TrackedProcess,
): Promise<{ alive: boolean; startIdentity: string }> {
  if (posixAlive(handle.pid)) {
    const observed = queryPosixStartIdentity(handle.pid);
    if (observed === handle.startIdentity) {
      return { alive: true, startIdentity: observed };
    }
    releaseTrackedGroup(tracked, handle);
    return { alive: false, startIdentity: handle.startIdentity };
  }
  if (isTrackedHandle(tracked, handle) && trackedPosixGroupAlive(tracked)) {
    return { alive: true, startIdentity: handle.startIdentity };
  }
  return { alive: false, startIdentity: handle.startIdentity };
}

export async function cancelPosix(
  handle: { pid: number; startIdentity: string },
  mode: "graceful" | "force",
  tracked: TrackedProcess | undefined,
): Promise<void> {
  const signal = mode === "graceful" ? "SIGTERM" : "SIGKILL";
  if (posixAlive(handle.pid)) {
    const observed = queryPosixStartIdentity(handle.pid);
    if (!posixAlive(handle.pid)) {
      return cancelTrackedGroup(handle, signal, tracked);
    }
    if (observed !== handle.startIdentity) {
      releaseTrackedGroup(tracked, handle);
      throw identityMismatchError(handle, observed);
    }
  } else {
    return cancelTrackedGroup(handle, signal, tracked);
  }

  if (isTrackedHandle(tracked, handle) && trackedPosixGroupAlive(tracked)) {
    signalProcessGroup(tracked, signal);
    return;
  }
  try {
    process.kill(handle.pid, signal);
  } catch {
    if (mode === "graceful") {
      tracked?.child?.stdin?.end();
    }
  }
}

export function trackedPosixGroupAlive(tracked: TrackedProcess): boolean {
  const group = tracked.posixGroup;
  if (!group?.owned) {
    return false;
  }
  const members = queryPosixGroupMembers(group.pgid, group.sessionId);
  const leader = members.find((member) => member.pid === group.pgid);
  if (leader && leader.startIdentity !== group.rootStartIdentity) {
    group.owned = false;
    return false;
  }
  if (members.length === 0) {
    group.owned = false;
    return false;
  }
  return true;
}

function cancelTrackedGroup(
  handle: { pid: number; startIdentity: string },
  signal: NodeJS.Signals,
  tracked: TrackedProcess | undefined,
): void {
  if (!isTrackedHandle(tracked, handle) || !trackedPosixGroupAlive(tracked)) {
    return;
  }
  signalProcessGroup(tracked, signal);
}

function signalProcessGroup(tracked: TrackedProcess, signal: NodeJS.Signals): void {
  const group = tracked.posixGroup;
  if (!group?.owned || !trackedPosixGroupAlive(tracked)) {
    return;
  }
  try {
    process.kill(-group.pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      group.owned = false;
      return;
    }
    throw error;
  }
}

function releaseTrackedGroup(
  tracked: TrackedProcess | undefined,
  handle: { pid: number; startIdentity: string },
): void {
  if (isTrackedHandle(tracked, handle) && tracked.posixGroup) {
    tracked.posixGroup.owned = false;
  }
}

function isTrackedHandle(
  tracked: TrackedProcess | undefined,
  handle: { pid: number; startIdentity: string },
): tracked is TrackedProcess {
  return (
    tracked?.platform === "posix" &&
    tracked.handle.pid === handle.pid &&
    tracked.handle.startIdentity === handle.startIdentity
  );
}

function posixAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (process.platform === "linux") {
    const info = queryLinuxProcessInfo(pid);
    return info !== undefined && info.state !== "Z";
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

function queryPosixStartIdentity(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  if (process.platform === "linux") {
    return queryLinuxProcessInfo(pid)?.startIdentity;
  }
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 8_000,
    }).trim();
    if (!out) {
      return undefined;
    }
    return `posix:${pid}:${out.replace(/\s+/g, "_")}`;
  } catch {
    return undefined;
  }
}

type PosixProcessInfo = {
  pid: number;
  state: string;
  pgrp: number;
  sessionId: number;
  startIdentity: string | undefined;
};

function queryPosixProcessInfo(pid: number): PosixProcessInfo | undefined {
  if (process.platform === "linux") {
    return queryLinuxProcessInfo(pid);
  }
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "state=,pgid=,sess="], {
      encoding: "utf8",
      timeout: 8_000,
    }).trim();
    const match = /^(\S+)\s+(\d+)\s+(\d+)$/.exec(out);
    if (!match?.[1] || !match[2] || !match[3]) {
      return undefined;
    }
    return {
      pid,
      state: match[1],
      pgrp: Number(match[2]),
      sessionId: Number(match[3]),
      startIdentity: queryPosixStartIdentity(pid),
    };
  } catch {
    return undefined;
  }
}

function queryLinuxProcessInfo(pid: number): PosixProcessInfo | undefined {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closed = raw.lastIndexOf(")");
    if (closed < 0) {
      return undefined;
    }
    const rest = raw
      .slice(closed + 1)
      .trim()
      .split(/\s+/);
    const state = rest[0];
    const pgrp = Number(rest[2]);
    const sessionId = Number(rest[3]);
    const starttime = rest[19];
    if (!state || !Number.isInteger(pgrp) || !Number.isInteger(sessionId) || !starttime) {
      return undefined;
    }
    return {
      pid,
      state,
      pgrp,
      sessionId,
      startIdentity: `posix:${pid}:${starttime}`,
    };
  } catch {
    return undefined;
  }
}

function queryPosixGroupMembers(pgid: number, sessionId: number): PosixProcessInfo[] {
  if (process.platform === "linux") {
    const members: PosixProcessInfo[] = [];
    let entries: string[];
    try {
      entries = fs.readdirSync("/proc");
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue;
      }
      const info = queryLinuxProcessInfo(Number(entry));
      if (info && info.state !== "Z" && info.pgrp === pgid && info.sessionId === sessionId) {
        members.push(info);
      }
    }
    return members;
  }
  try {
    const out = execFileSync("ps", ["-axo", "pid=,state=,pgid=,sess="], {
      encoding: "utf8",
      timeout: 8_000,
    });
    const members: PosixProcessInfo[] = [];
    for (const line of out.split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
      if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
        continue;
      }
      const info: PosixProcessInfo = {
        pid: Number(match[1]),
        state: match[2],
        pgrp: Number(match[3]),
        sessionId: Number(match[4]),
        startIdentity: undefined,
      };
      if (!info.state.startsWith("Z") && info.pgrp === pgid && info.sessionId === sessionId) {
        info.startIdentity = queryPosixStartIdentity(info.pid);
        members.push(info);
      }
    }
    return members;
  } catch {
    return [];
  }
}

function unverifiedProcessGroupError(pid: number): Error {
  const error = new Error(`captured process group for pid ${pid} could not be verified`);
  error.name = "UnverifiedProcessGroupError";
  Object.assign(error, { code: "process_group_unverified" });
  return error;
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
