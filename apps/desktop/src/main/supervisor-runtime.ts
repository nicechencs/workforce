import fs from "node:fs";
import path from "node:path";

import { protocolVersion } from "@workforce/protocol";

import {
  daemonDiagnosticSnapshotPath,
  daemonDiagnosticsDir,
  daemonStderrLogPath,
  readCappedText,
  recordLaunchDiagnostic as persistLaunchDiagnostic,
  type DesktopDaemonDiagnostic,
} from "./daemon-supervisor/diagnostics.js";
import { fetchDaemonHealth } from "./daemon-supervisor/health.js";
import { readOsStartIdentity } from "./daemon-supervisor/identity.js";
import { probeExclusiveListenHeld, probeNamedPipe } from "./daemon-supervisor/lock.js";
import { asSpawnedDaemon, spawnDetachedDaemon } from "./daemon-supervisor/spawn.js";
import {
  daemonLockSocketPath,
  defaultDaemonStateDir,
  pidAlive,
  readDaemonState,
  writeDaemonState,
} from "./daemon-supervisor/state.js";
import type { SupervisorDeps } from "./daemon-supervisor/types.js";
import { resolveDaemonLaunchArgs, sourceDaemonNodeRequirement } from "./smoke-env.js";
import { resolveWorkspaceTsEsmRegisterUrl } from "./ts-esm-loader.js";

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

export function desktopDiagnosticPaths(stateDir: string): {
  directory: string;
  stderr: string;
  latest: string;
} {
  return {
    directory: daemonDiagnosticsDir(stateDir),
    stderr: daemonStderrLogPath(stateDir),
    latest: daemonDiagnosticSnapshotPath(stateDir),
  };
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
  const stderrPath = daemonStderrLogPath(input.stateDir);
  return {
    expectedProtocolVersion,
    stateDir: input.stateDir,
    launch: {
      execPath: process.execPath,
      args: resolveDaemonLaunchArgs(entry, input.stateDir, {
        importModule: resolveWorkspaceTsEsmRegisterUrl(input.appRoot),
      }),
    },
    now: () => new Date(),
    readState: () => readDaemonState(input.stateDir),
    writeState: (state) => {
      writeDaemonState(input.stateDir, state);
    },
    pidAlive,
    readOsStartIdentity,
    healthOf: (port) => fetchDaemonHealth(port),
    preflightLaunch: () =>
      entry.endsWith(".ts") || entry.endsWith(".mts") || entry.endsWith(".cts")
        ? sourceDaemonNodeRequirement(process.versions.node)
        : null,
    spawn: (spec) => asSpawnedDaemon(spawnDetachedDaemon(spec, { stderrPath })),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    probeLockHeld: () => probeNamedPipe(daemonLockSocketPath(input.stateDir)),
    probePortBusy: (port) =>
      probeExclusiveListenHeld({ kind: "tcp", host: "127.0.0.1", port }),
    readLaunchStderr: () => readCappedText(stderrPath),
    recordLaunchDiagnostic: (diagnostic) => {
      persistLaunchDiagnostic(input.stateDir, diagnostic as DesktopDaemonDiagnostic);
    },
  };
}
