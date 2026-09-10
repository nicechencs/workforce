export const packageName = "@workforce/runtime-codex" as const;

export {
  CodexRuntimeAdapter,
  CODEX_ADAPTER_ID,
  CODEX_ADAPTER_VERSION,
  createCodexRuntime,
} from "./adapter.js";
export type { CodexRuntimeAdapterOptions } from "./adapter.js";
export { detectCodex, parseCodexVersion } from "./detect.js";
export type { CodexDetection, DetectCodexOptions } from "./detect.js";
