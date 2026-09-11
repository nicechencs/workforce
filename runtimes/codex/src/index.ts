export const packageName = "@workforce/runtime-codex" as const;

export {
  CodexRuntimeAdapter,
  CODEX_ADAPTER_ID,
  CODEX_ADAPTER_VERSION,
  createCodexRuntime,
} from "./adapter.js";
export type { CodexRuntimeAdapterOptions } from "./adapter.js";
export { buildCodexExecArgv } from "./command.js";
export type { CodexApprovalMode, CodexExecCommand, CodexSandboxMode } from "./command.js";
export { detectCodex, parseCodexVersion } from "./detect.js";
export type { CodexDetection, DetectCodexOptions } from "./detect.js";
export { CodexJsonlDecoder } from "./jsonl.js";
export type { CodexJsonlDecoderOptions } from "./jsonl.js";
