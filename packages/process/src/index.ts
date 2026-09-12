export const packageName = "@workforce/process" as const;

export { OsProcessController } from "./os-process-controller.js";
export { ProcessControllerError } from "@workforce/application/ports";
export type {
  CapturedProcess,
  CapturedSpawnRequest,
  ProcessCancelMode,
  ProcessController,
  ProcessControllerErrorCode,
  ProcessControllerOperation,
  ProcessExitResult,
  ProcessHandle,
  ProcessOutput,
  ProcessOutputSource,
  ProcessStatus,
  SpawnRequest,
} from "@workforce/application/ports";
export {
  formatWin32StartIdentity,
  UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS,
  UNTESTED_CAPTURED_PROCESS_PLATFORMS,
  UNTESTED_PROCESS_PLATFORMS,
} from "./start-identity.js";
