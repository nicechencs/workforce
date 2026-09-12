/**
 * T21 dual-execution UI slice. Importable only: T11 FeatureSlot has no
 * `orchestration` entry. Do not export `feature` — that would overwrite a
 * catalog module. Do not touch T18 canvas or T19 Team write files.
 */
export { OrchestrationModeControl } from "./control.js";
export type { OrchestrationTaskOption } from "./control.js";
export {
  DEFAULT_MODE,
  DIRECT_TASK_REQUIRED,
  DIRECT_UNSUPPORTED,
  MODE_UNREAD,
  SLICE_NOTE,
  TASK_RUN_NOT_WIRED,
  buildStartProjectInput,
  emptyOrchestrationProbe,
  probeOrchestrationSupport,
  resolveSelectedMode,
  runOrchestrationModeLabel,
} from "./model.js";
export type { OrchestrationMode } from "./model.js";
export { startDirectTaskRun, taskRunsPath } from "./start-task-run.js";
