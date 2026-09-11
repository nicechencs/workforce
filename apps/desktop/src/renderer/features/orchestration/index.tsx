/**
 * T21 dual-execution UI slice. Importable only: T11 FeatureSlot has no
 * `orchestration` entry. Do not export `feature` — that would overwrite a
 * catalog module. Do not touch T18 canvas or T19 Team write files.
 */
export { OrchestrationModeControl } from "./control.js";
export {
  DEFAULT_MODE,
  DIRECT_UNSUPPORTED,
  SLICE_NOTE,
  buildStartProjectInput,
  emptyOrchestrationProbe,
  probeOrchestrationSupport,
  resolveSelectedMode,
} from "./model.js";
export type { OrchestrationMode } from "./model.js";
