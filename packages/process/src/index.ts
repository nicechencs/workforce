export const packageName = "@workforce/process" as const;

export {
  OsProcessController,
  type CapturedProcess,
  type CapturedSpawnRequest,
  type ProcessCancelMode,
  type ProcessExitResult,
  type ProcessHandle,
  type ProcessStatus,
  type SpawnRequest,
} from "./os-process-controller.js";
export {
  formatWin32StartIdentity,
  UNTESTED_CAPTURED_PROCESS_PLATFORMS,
  UNTESTED_PROCESS_PLATFORMS,
} from "./start-identity.js";
