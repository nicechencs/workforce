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
export { CODEX_RAW_METADATA_MAX_BYTES, CodexJsonlDecoder } from "./jsonl.js";
export type { CodexJsonlDecoderOptions } from "./jsonl.js";
export { parseCodexResolvedStartContext } from "./start-context.js";
export type { CodexResolvedStartContext, ResolveCodexStartContext } from "./start-context.js";
