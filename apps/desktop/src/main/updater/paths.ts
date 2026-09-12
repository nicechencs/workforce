import path from "node:path";

/** extraResources layout consumed by the packer and by `resolveDaemonEntry`. */
export const PACKAGED_DAEMON_RESOURCE_DIR = "daemon" as const;
export const PACKAGED_DAEMON_ENTRY = path.join("daemon", "dist", "index.js");
export const PACKAGING_MARKER_NAME = "packaging.json" as const;
export const STATE_BACKUP_DIR_NAME = "backups" as const;
export const SQLITE_BASENAME = "workforce.sqlite" as const;

export const SQLITE_SIDECARS = ["-wal", "-shm", "-journal"] as const;

export const STATE_SKIP_DIR_NAMES = new Set([
  "backups",
  "Cache",
  "Code Cache",
  "GPUCache",
  "CachedData",
]);

export const STATE_SKIP_FILE_NAMES = new Set(["daemon.lock.sock"]);

export function packagedDaemonEntry(resourcesPath: string): string {
  return path.join(resourcesPath, PACKAGED_DAEMON_ENTRY);
}

export function packagingMarkerPath(resourcesPath: string): string {
  return path.join(resourcesPath, PACKAGING_MARKER_NAME);
}

export function sqlitePath(stateDir: string): string {
  return path.join(stateDir, SQLITE_BASENAME);
}

export function defaultBackupRoot(stateDir: string): string {
  return path.join(stateDir, STATE_BACKUP_DIR_NAME);
}
