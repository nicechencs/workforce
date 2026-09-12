import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import { ProcessControllerError } from "@workforce/application/ports";

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
    throw unverifiedProcessGroupError(child.pid, "spawn");
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
  const root = livePosixProcessInfo(handle.pid);
  if (root) {
    if (root.startIdentity === handle.startIdentity) {
      return { alive: true, startIdentity: handle.startIdentity };
    }
    releaseTrackedGroup(tracked, handle);
    return { alive: false, startIdentity: handle.startIdentity };
  }
  if (isTrackedHandle(tracked, handle)) {
    const state = trackedPosixGroupState(tracked);
    if (state === "alive") {
      return { alive: true, startIdentity: handle.startIdentity };
    }
    if (state === "unknown") {
      throw unverifiedProcessGroupError(handle.pid, "inspect");
    }
  } else {
    const state = untrackedPosixGroupState(handle);
    if (state === "alive" || state === "unknown") {
      throw unverifiedProcessGroupError(handle.pid, "inspect");
    }
  }
  return { alive: false, startIdentity: handle.startIdentity };
}

export async function cancelPosix(
  handle: { pid: number; startIdentity: string },
  mode: "graceful" | "force",
  tracked: TrackedProcess | undefined,
): Promise<void> {
  const signal = mode === "graceful" ? "SIGTERM" : "SIGKILL";
  const root = livePosixProcessInfo(handle.pid);
  if (root) {
    if (root.startIdentity !== handle.startIdentity) {
      releaseTrackedGroup(tracked, handle);
      throw identityMismatchError(handle, root.startIdentity);
    }
  } else {
    return cancelTrackedGroup(handle, signal, tracked);
  }

  if (isTrackedHandle(tracked, handle) && tracked.posixGroup) {
    signalProcessGroup(tracked, signal);
    return;
  }
  signalVerifiedUntrackedGroup(handle, root, signal);
}

export function trackedPosixGroupAlive(tracked: TrackedProcess): boolean {
  return trackedPosixGroupState(tracked) !== "dead";
}

/** Waits until the session/process group created for captured execution is empty. */
export async function waitForTrackedPosixGroupExit(tracked: TrackedProcess): Promise<void> {
  if (tracked.posixGroup?.terminalVerified) {
    return;
  }
  if (!tracked.posixGroup?.owned) {
    throw unverifiedProcessGroupError(tracked.handle.pid, "wait");
  }
  for (;;) {
    const state = trackedPosixGroupState(tracked);
    if (state === "dead") {
      if (tracked.posixGroup?.terminalVerified) {
        return;
      }
      throw unverifiedProcessGroupError(tracked.handle.pid, "wait");
    }
    if (state === "unknown") {
      throw unverifiedProcessGroupError(tracked.handle.pid, "wait");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

type GroupState = "alive" | "dead" | "unknown";

function trackedPosixGroupState(tracked: TrackedProcess): GroupState {
  const group = tracked.posixGroup;
  if (!group?.owned) {
    return "dead";
  }
  const members = queryPosixGroupMembers(group.pgid, group.sessionId);
  if (!members) {
    return "unknown";
  }
  const leader = members.find((member) => member.pid === group.pgid);
  if (leader && leader.startIdentity !== group.rootStartIdentity) {
    group.owned = false;
    return "dead";
  }
  if (members.length === 0) {
    const presence = queryPosixGroupPresence(group.pgid);
    if (presence === "empty") {
      group.owned = false;
      group.terminalVerified = true;
      return "dead";
    }
    // A live numeric PGID alone does not prove it still belongs to this
    // session. Treat an empty non-atomic member scan as unverified rather
    // than signalling a potentially reused group.
    return "unknown";
  }
  return "alive";
}

function cancelTrackedGroup(
  handle: { pid: number; startIdentity: string },
  signal: NodeJS.Signals,
  tracked: TrackedProcess | undefined,
): void {
  if (!isTrackedHandle(tracked, handle)) {
    const state = untrackedPosixGroupState(handle);
    if (state === "alive" || state === "unknown") {
      throw unverifiedProcessGroupError(handle.pid, "cancel");
    }
    return;
  }
  const state = trackedPosixGroupState(tracked);
  if (state === "unknown") {
    throw unverifiedProcessGroupError(handle.pid, "cancel");
  }
  if (state === "dead") {
    return;
  }
  signalProcessGroup(tracked, signal);
}

function signalProcessGroup(tracked: TrackedProcess, signal: NodeJS.Signals): void {
  const group = tracked.posixGroup;
  if (!group?.owned) {
    return;
  }
  const state = trackedPosixGroupState(tracked);
  if (state === "unknown") {
    throw unverifiedProcessGroupError(group.pgid, "cancel");
  }
  if (state === "dead") {
    return;
  }
  try {
    process.kill(-group.pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      group.owned = false;
      group.terminalVerified = true;
      return;
    }
    throw error;
  }
}

function signalVerifiedUntrackedGroup(
  handle: { pid: number; startIdentity: string },
  root: PosixProcessInfo,
  signal: NodeJS.Signals,
): void {
  if (
    root.startIdentity !== handle.startIdentity ||
    root.pgrp !== handle.pid ||
    root.sessionId !== handle.pid
  ) {
    throw unverifiedProcessGroupError(handle.pid, "cancel");
  }
  const verified = livePosixProcessInfo(handle.pid);
  if (!verified) {
    const state = untrackedPosixGroupState(handle);
    if (state === "alive" || state === "unknown") {
      throw unverifiedProcessGroupError(handle.pid, "cancel");
    }
    return;
  }
  if (
    verified.startIdentity !== handle.startIdentity ||
    verified.pgrp !== handle.pid ||
    verified.sessionId !== handle.pid
  ) {
    if (verified.startIdentity !== handle.startIdentity) {
      throw identityMismatchError(handle, verified.startIdentity);
    }
    throw unverifiedProcessGroupError(handle.pid, "cancel");
  }
  try {
    process.kill(-handle.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function untrackedPosixGroupState(handle: { pid: number; startIdentity: string }): GroupState {
  const members = queryPosixGroupMembers(handle.pid, handle.pid);
  if (!members) {
    return "unknown";
  }
  const leader = members.find((member) => member.pid === handle.pid);
  if (leader) {
    if (leader.startIdentity === handle.startIdentity) {
      return "alive";
    }
    if (leader.startIdentity !== undefined) {
      return "dead";
    }
    return "unknown";
  }
  return members.length === 0 ? "dead" : "unknown";
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

function livePosixProcessInfo(pid: number): PosixProcessInfo | undefined {
  const info = queryPosixProcessInfo(pid);
  return info && !info.state.startsWith("Z") ? info : undefined;
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

function queryPosixGroupMembers(pgid: number, sessionId: number): PosixProcessInfo[] | undefined {
  if (process.platform === "linux") {
    const members: PosixProcessInfo[] = [];
    let entries: string[];
    try {
      entries = fs.readdirSync("/proc");
    } catch {
      return undefined;
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
    return undefined;
  }
}

function queryPosixGroupPresence(pgid: number): "alive" | "empty" | "unknown" {
  try {
    process.kill(-pgid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return "empty";
    }
    return "unknown";
  }
}

function unverifiedProcessGroupError(
  pid: number,
  operation: "spawn" | "wait" | "inspect" | "cancel",
): ProcessControllerError {
  return new ProcessControllerError(
    "process_tree_unverified",
    operation,
    `process group for pid ${pid} could not be verified during ${operation}`,
  );
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
