import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import { identityMismatchError } from "./start-identity.js";
import type { TrackedProcess } from "./tracked.js";

// POSIX process-group cancel is untested (see UNTESTED_PROCESS_PLATFORMS).

export async function spawnPosix(req: {
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
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
  });
  await waitForChildSpawn(child);
  if (child.pid === undefined) {
    throw new Error("posix spawn produced no pid");
  }
  const startIdentity = queryPosixStartIdentity(child.pid) ?? `posix:${child.pid}:unresolved`;
  return {
    handle: { pid: child.pid, startIdentity },
    platform: "posix",
    descendants: [],
    usedJob: false,
    child,
  };
}

export async function inspectPosix(handle: {
  pid: number;
  startIdentity: string;
}): Promise<{ alive: boolean; startIdentity: string }> {
  if (!posixAlive(handle.pid)) {
    return { alive: false, startIdentity: handle.startIdentity };
  }
  const observed = queryPosixStartIdentity(handle.pid);
  if (observed === handle.startIdentity) {
    return { alive: true, startIdentity: observed };
  }
  return { alive: false, startIdentity: handle.startIdentity };
}

export async function cancelPosix(
  handle: { pid: number; startIdentity: string },
  mode: "graceful" | "force",
  tracked: TrackedProcess | undefined,
): Promise<void> {
  if (!posixAlive(handle.pid)) {
    return;
  }
  const observed = queryPosixStartIdentity(handle.pid);
  if (!posixAlive(handle.pid)) {
    return;
  }
  if (observed !== handle.startIdentity) {
    throw identityMismatchError(handle, observed);
  }
  const signal = mode === "graceful" ? "SIGTERM" : "SIGKILL";
  try {
    process.kill(-handle.pid, signal);
  } catch {
    try {
      if (mode === "graceful") {
        tracked?.child?.stdin?.end();
      } else {
        process.kill(handle.pid, "SIGKILL");
      }
    } catch {
      // already gone
    }
  }
}

function posixAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (process.platform === "linux") {
    try {
      fs.accessSync(`/proc/${pid}`);
      return true;
    } catch {
      return false;
    }
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
      const starttime = rest[19];
      if (!starttime) {
        return undefined;
      }
      return `posix:${pid}:${starttime}`;
    } catch {
      return undefined;
    }
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
