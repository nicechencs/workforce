import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import type { DaemonLaunchSpec, SpawnedDaemon } from "./types.js";

export function detachedDaemonSpawnOptions(): SpawnOptions {
  return {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
}

export function spawnDetachedDaemon(spec: DaemonLaunchSpec): ChildProcess {
  const child = spawn(spec.execPath, [...spec.args], detachedDaemonSpawnOptions());
  child.unref();
  return child;
}

export function asSpawnedDaemon(child: ChildProcess): SpawnedDaemon {
  return {
    pid: child.pid,
    unref: () => child.unref(),
    kill: (signal) => child.kill(signal),
  };
}
