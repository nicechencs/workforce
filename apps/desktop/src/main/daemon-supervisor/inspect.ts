import type { InspectResult, SupervisorDeps } from "./types.js";

export async function inspectExistingDaemon(deps: SupervisorDeps): Promise<InspectResult> {
  const state = deps.readState();
  if (!state) {
    return { status: "none", state: null };
  }
  if (!deps.pidAlive(state.pid)) {
    return { status: "stale-dead-pid", state };
  }
  const osStart = await deps.readOsStartIdentity(state.pid);
  if (state.osStartIdentity && osStart && osStart !== state.osStartIdentity) {
    return { status: "stale-pid-reuse", state };
  }
  try {
    const health = await deps.healthOf(state.port);
    if (health.startIdentity !== state.startIdentity) {
      return { status: "stale-identity-mismatch", state };
    }
    return { status: "live", state, health };
  } catch {
    return { status: "stale-unhealthy", state };
  }
}

export function canSpawnReplacement(status: InspectResult["status"]): boolean {
  return status === "none" || status === "stale-dead-pid" || status === "stale-pid-reuse";
}
