import fs from "node:fs";
import path from "node:path";

import { protocolVersion } from "@workforce/protocol";

import { asSpawnedDaemon, spawnDetachedDaemon } from "./daemon-supervisor/spawn.js";
import { fetchDaemonHealth } from "./daemon-supervisor/health.js";
import { readOsStartIdentity } from "./daemon-supervisor/identity.js";
import { probeNamedPipe } from "./daemon-supervisor/lock.js";
import {
  daemonLockSocketPath,
  defaultDaemonStateDir,
  pidAlive,
  readDaemonState,
  writeDaemonState,
} from "./daemon-supervisor/state.js";
import type { SupervisorDeps } from "./daemon-supervisor/types.js";
import { resolveDaemonLaunchArgs } from "./smoke-env.js";

export function resolveDaemonEntry(
  appRoot: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.WORKFORCE_DAEMON_ENTRY;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  const dist = path.join(appRoot, "..", "daemon", "dist", "index.js");
  if (fs.existsSync(dist)) {
    return dist;
  }
  return path.join(appRoot, "..", "daemon", "src", "index.ts");
}

export function resolveDesktopStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.WORKFORCE_STATE_DIR;
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  return defaultDaemonStateDir();
}

export function createSupervisorDeps(input: {
  stateDir: string;
  appRoot: string;
  expectedProtocolVersion?: string;
  env?: Record<string, string | undefined>;
}): SupervisorDeps {
  const env = input.env ?? process.env;
  const entry = resolveDaemonEntry(input.appRoot, env);
  const expectedProtocolVersion = input.expectedProtocolVersion ?? protocolVersion;
  return {
    expectedProtocolVersion,
    stateDir: input.stateDir,
    launch: {
      execPath: process.execPath,
      args: resolveDaemonLaunchArgs(entry, input.stateDir),
    },
    now: () => new Date(),
    readState: () => readDaemonState(input.stateDir),
    writeState: (state) => {
      writeDaemonState(input.stateDir, state);
    },
    pidAlive,
    readOsStartIdentity,
    healthOf: (port) => fetchDaemonHealth(port),
    spawn: (spec) => asSpawnedDaemon(spawnDetachedDaemon(spec)),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    probeLockHeld: () => probeNamedPipe(daemonLockSocketPath(input.stateDir)),
  };
}
