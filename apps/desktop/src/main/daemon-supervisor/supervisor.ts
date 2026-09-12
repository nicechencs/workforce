import { handshakeProtocolVersion } from "./handshake.js";
import { canSpawnReplacement, inspectExistingDaemon } from "./inspect.js";
import type { DaemonHealth, DaemonStateFile, EnsureDaemonResult, SupervisorDeps } from "./types.js";

const DEFAULT_SPAWN_WAIT_MS = 8000;
const DEFAULT_SPAWN_POLL_MS = 80;

function onlineSnapshot(
  mode: "spawn" | "reconnect",
  health: DaemonHealth,
): Extract<EnsureDaemonResult, { ok: true }>["snapshot"] {
  return {
    status: "online",
    protocolVersion: health.protocolVersion,
    mode,
  };
}

function handshakeOrMismatch(
  health: DaemonHealth,
  expectedProtocolVersion: string,
  mode: "spawn" | "reconnect",
  state: DaemonStateFile,
): EnsureDaemonResult {
  const handshake = handshakeProtocolVersion(health, expectedProtocolVersion);
  if (!handshake.ok) {
    return { ok: false, snapshot: handshake.snapshot, spawned: false };
  }
  return {
    ok: true,
    mode,
    state,
    health,
    snapshot: onlineSnapshot(mode, health),
  };
}

async function waitForReplacementState(
  deps: SupervisorDeps,
  previousIdentity: string | null,
  childPid: number | undefined,
): Promise<DaemonStateFile | null> {
  const deadline = Date.now() + (deps.spawnTimeoutMs ?? DEFAULT_SPAWN_WAIT_MS);
  const pollMs = deps.spawnPollMs ?? DEFAULT_SPAWN_POLL_MS;
  while (Date.now() < deadline) {
    const state = deps.readState();
    if (
      state &&
      state.port > 0 &&
      state.startIdentity &&
      state.startIdentity !== previousIdentity &&
      (state.pid === childPid || deps.pidAlive(state.pid))
    ) {
      return state;
    }
    await deps.wait(pollMs);
  }
  return null;
}

export async function ensureDaemon(deps: SupervisorDeps): Promise<EnsureDaemonResult> {
  const existing = await inspectExistingDaemon(deps);

  if (existing.status === "live") {
    return handshakeOrMismatch(
      existing.health,
      deps.expectedProtocolVersion,
      "reconnect",
      existing.state,
    );
  }

  if (existing.status === "none" && (await deps.probeLockHeld())) {
    const state = await waitForReplacementState(deps, null, undefined);
    if (state) {
      try {
        const health = await deps.healthOf(state.port);
        return handshakeOrMismatch(health, deps.expectedProtocolVersion, "reconnect", state);
      } catch {
        return { ok: false, spawned: false, snapshot: { status: "offline" } };
      }
    }
  }

  if (!canSpawnReplacement(existing.status)) {
    const message =
      existing.status === "stale-identity-mismatch"
        ? "Live process identity does not match the state file. Not attaching and not starting a second Daemon."
        : "Daemon process is alive but unhealthy. Not killing it and not starting a second instance.";
    return {
      ok: false,
      spawned: false,
      snapshot: { status: "error", message, recoverable: true },
    };
  }

  const preflightError = deps.preflightLaunch?.();
  if (preflightError) {
    return {
      ok: false,
      spawned: false,
      snapshot: { status: "error", message: preflightError, recoverable: true },
    };
  }

  const previousIdentity = existing.state?.startIdentity ?? null;
  const child = deps.spawn(deps.launch);
  const state = await waitForReplacementState(deps, previousIdentity, child.pid);
  if (!state) {
    return {
      ok: false,
      spawned: false,
      snapshot: {
        status: "error",
        message: "Daemon state file was not replaced after spawn.",
        recoverable: true,
      },
    };
  }
  try {
    const health = await deps.healthOf(state.port);
    if (health.startIdentity !== state.startIdentity) {
      return {
        ok: false,
        spawned: false,
        snapshot: {
          status: "error",
          message: "Spawned Daemon health identity does not match the new state file.",
          recoverable: true,
        },
      };
    }
    return handshakeOrMismatch(health, deps.expectedProtocolVersion, "spawn", state);
  } catch {
    return {
      ok: false,
      spawned: false,
      snapshot: { status: "offline" },
    };
  }
}

export async function reconnectDaemon(deps: SupervisorDeps): Promise<EnsureDaemonResult> {
  return ensureDaemon(deps);
}
