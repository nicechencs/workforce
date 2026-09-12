import {
  classifyLaunchFailure,
  type DesktopDaemonDiagnostic,
} from "./diagnostics.js";
import { handshakeProtocolVersion } from "./handshake.js";
import { canSpawnReplacement, inspectExistingDaemon } from "./inspect.js";
import type {
  DaemonHealth,
  DaemonStateFile,
  EnsureDaemonResult,
  InspectStatus,
  SpawnedDaemon,
  SupervisorDeps,
} from "./types.js";

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

function failWithDiagnostic(
  deps: SupervisorDeps,
  diagnostic: DesktopDaemonDiagnostic,
): EnsureDaemonResult {
  deps.recordLaunchDiagnostic?.(diagnostic);
  return {
    ok: false,
    spawned: false,
    snapshot: { status: "error", message: diagnostic.message, recoverable: true },
  };
}

async function observeLaunchContext(
  deps: SupervisorDeps,
  input: {
    inspectStatus: InspectStatus;
    previousState: DaemonStateFile | null;
    publishedState: DaemonStateFile | null;
    child: SpawnedDaemon | null;
    preflightMessage?: string | null;
    healthFailed?: boolean;
  },
): Promise<DesktopDaemonDiagnostic> {
  const recordedPort = input.publishedState?.port ?? input.previousState?.port;
  const [lockHeld, portBusy] = await Promise.all([
    deps.probeLockHeld(),
    recordedPort && deps.probePortBusy
      ? deps.probePortBusy(recordedPort)
      : Promise.resolve(false),
  ]);
  return classifyLaunchFailure({
    now: deps.now,
    stateDir: deps.stateDir,
    inspectStatus: input.inspectStatus,
    previousState: input.previousState,
    publishedState: input.publishedState,
    child: input.child,
    stderr: deps.readLaunchStderr?.() ?? "",
    spawnErrorMessage: input.child?.spawnErrorMessage?.() ?? null,
    lockHeld,
    portBusy,
    spawnAttempted: input.child !== null,
    preflightMessage: input.preflightMessage,
    healthFailed: input.healthFailed,
  });
}

async function waitForReplacementState(
  deps: SupervisorDeps,
  previousIdentity: string | null,
  child: SpawnedDaemon | null,
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
      (state.pid === child?.pid || deps.pidAlive(state.pid))
    ) {
      return state;
    }
    if (child?.exitSnapshot?.()) {
      return null;
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
    const state = await waitForReplacementState(deps, null, null);
    if (state) {
      try {
        const health = await deps.healthOf(state.port);
        return handshakeOrMismatch(health, deps.expectedProtocolVersion, "reconnect", state);
      } catch {
        return failWithDiagnostic(
          deps,
          await observeLaunchContext(deps, {
            inspectStatus: existing.status,
            previousState: existing.state,
            publishedState: state,
            child: null,
            healthFailed: true,
          }),
        );
      }
    }
    return failWithDiagnostic(
      deps,
      await observeLaunchContext(deps, {
        inspectStatus: existing.status,
        previousState: existing.state,
        publishedState: null,
        child: null,
      }),
    );
  }

  if (!canSpawnReplacement(existing.status)) {
    return failWithDiagnostic(
      deps,
      await observeLaunchContext(deps, {
        inspectStatus: existing.status,
        previousState: existing.state,
        publishedState: null,
        child: null,
        healthFailed: existing.status === "stale-unhealthy",
      }),
    );
  }

  const preflightError = deps.preflightLaunch?.();
  if (preflightError) {
    return failWithDiagnostic(
      deps,
      await observeLaunchContext(deps, {
        inspectStatus: existing.status,
        previousState: existing.state,
        publishedState: null,
        child: null,
        preflightMessage: preflightError,
      }),
    );
  }

  const previousIdentity = existing.state?.startIdentity ?? null;
  const child = deps.spawn(deps.launch);
  const state = await waitForReplacementState(deps, previousIdentity, child);
  if (!state) {
    return failWithDiagnostic(
      deps,
      await observeLaunchContext(deps, {
        inspectStatus: existing.status,
        previousState: existing.state,
        publishedState: null,
        child,
      }),
    );
  }
  try {
    const health = await deps.healthOf(state.port);
    if (health.startIdentity !== state.startIdentity) {
      return failWithDiagnostic(
        deps,
        await observeLaunchContext(deps, {
          inspectStatus: "stale-identity-mismatch",
          previousState: existing.state,
          publishedState: state,
          child,
        }),
      );
    }
    return handshakeOrMismatch(health, deps.expectedProtocolVersion, "spawn", state);
  } catch {
    return failWithDiagnostic(
      deps,
      await observeLaunchContext(deps, {
        inspectStatus: existing.status,
        previousState: existing.state,
        publishedState: state,
        child,
        healthFailed: true,
      }),
    );
  }
}

export async function reconnectDaemon(deps: SupervisorDeps): Promise<EnsureDaemonResult> {
  return ensureDaemon(deps);
}
