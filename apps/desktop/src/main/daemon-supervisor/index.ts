export { handshakeProtocolVersion } from "./handshake.js";
export { fetchDaemonHealth, fetchDaemonVersion } from "./health.js";
export { readOsStartIdentity, readWindowsOsStartIdentity } from "./identity.js";
export { canSpawnReplacement, inspectExistingDaemon } from "./inspect.js";
export {
  acquireExclusiveListen,
  closeServer,
  DAEMON_MUTEX_NAME,
  probeExclusiveListenHeld,
  probeNamedPipe,
} from "./lock.js";
export { asSpawnedDaemon, detachedDaemonSpawnOptions, spawnDetachedDaemon } from "./spawn.js";
export {
  daemonLockSocketPath,
  daemonStatePath,
  defaultDaemonStateDir,
  formatOsStartIdentity,
  formatStartIdentity,
  loadOrCreateClientId,
  pidAlive,
  readDaemonState,
  writeDaemonState,
} from "./state.js";
export { ensureDaemon, reconnectDaemon } from "./supervisor.js";
export type {
  DaemonHealth,
  DaemonLaunchSpec,
  DaemonStateFile,
  EnsureDaemonResult,
  InspectResult,
  InspectStatus,
  SpawnedDaemon,
  SupervisorDeps,
  SupervisorPhase,
} from "./types.js";
