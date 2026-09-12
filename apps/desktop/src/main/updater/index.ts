export {
  decideDaemonUpgrade,
  isNonTerminalRunStatus,
  isTerminalRunStatus,
  TERMINAL_RUN_STATUSES,
  UPGRADE_ACTIVE_RUN_POLICY,
} from "./policy.js";
export type { TerminalRunStatus, UpgradeDecision, UpdaterHandoffInput } from "./policy.js";

export { probeNonTerminalRuns } from "./active-runs.js";
export type { ActiveRunProbe, ActiveRunProbeInput } from "./active-runs.js";

export { createStateBackup, readBackupManifest, restoreStateBackup } from "./backup.js";
export type { CreateStateBackupInput, StateBackupManifest } from "./backup.js";

export { prepareDaemonUpgrade, rollbackUpgradeBackup } from "./prepare.js";
export type { PrepareDaemonUpgradeInput, PrepareUpgradeResult } from "./prepare.js";

export {
  defaultBackupRoot,
  PACKAGED_DAEMON_ENTRY,
  PACKAGED_DAEMON_RESOURCE_DIR,
  PACKAGING_MARKER_NAME,
  packagedDaemonEntry,
  packagingMarkerPath,
  sqlitePath,
  STATE_BACKUP_DIR_NAME,
} from "./paths.js";

export { readPackagingMarker } from "./marker.js";
export type { PackagingMarker, SigningStatus } from "./marker.js";

export const updaterDirectory = "src/main/updater" as const;
