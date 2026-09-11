export const packageName = "@workforce/process" as const;

export { OsProcessController } from "./os-process-controller.js";
export type {
  CapturedProcess,
  CapturedSpawnRequest,
  ProcessCancelMode,
  ProcessController,
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
