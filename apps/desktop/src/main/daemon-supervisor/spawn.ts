import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { DaemonExitObservation, DaemonLaunchSpec, SpawnedDaemon } from "./types.js";

export function detachedDaemonSpawnOptions(
  stdio: SpawnOptions["stdio"] = "ignore",
): SpawnOptions {
  return {
    detached: true,
    stdio,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}

/**
 * Inherit a file descriptor for stderr. Do not use a parent pipe: closing the
 * parent end would EPIPE a successful detached Daemon and can kill it.
 */
export function openInheritedStderrFile(stderrPath: string): number {
  fs.mkdirSync(path.dirname(stderrPath), { recursive: true });
  return fs.openSync(stderrPath, "w");
}

export function spawnDetachedDaemon(
  spec: DaemonLaunchSpec,
  options: { stderrPath?: string } = {},
): ChildProcess {
  let stderrFd: number | undefined;
  if (options.stderrPath) {
    stderrFd = openInheritedStderrFile(options.stderrPath);
  }
  try {
    const stdio: SpawnOptions["stdio"] =
      stderrFd === undefined ? "ignore" : ["ignore", "ignore", stderrFd];
    const child = spawn(spec.execPath, [...spec.args], detachedDaemonSpawnOptions(stdio));
    child.unref();
    return child;
  } finally {
    if (stderrFd !== undefined) {
      try {
        fs.closeSync(stderrFd);
      } catch {
        // The child keeps the inherited file descriptor; the parent copy is closed.
      }
    }
  }
}

export function asSpawnedDaemon(child: ChildProcess): SpawnedDaemon {
  let exited: DaemonExitObservation | null = currentExit(child);
  let spawnError: string | null = null;
  child.once("exit", (exitCode, signal) => {
    exited = { exitCode, signal };
  });
  child.once("error", (error) => {
    spawnError = error instanceof Error ? error.message : String(error);
    exited = exited ?? { exitCode: null, signal: null };
  });
  return {
    pid: child.pid,
    unref: () => child.unref(),
    kill: (signal) => child.kill(signal),
    exitSnapshot: () => exited,
    spawnErrorMessage: () => spawnError,
  };
}

function currentExit(child: ChildProcess): DaemonExitObservation | null {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child.exitCode, signal: child.signalCode };
  }
  return null;
}
