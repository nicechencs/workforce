import { OsProcessController } from "@workforce/process";
import {
  createCodexRuntime,
  type CodexRuntimeAdapter,
  type CodexRuntimeAdapterOptions,
} from "@workforce/runtime-codex";

/**
 * Composition hook: inject the captured Process port. Host still defaults to
 * Mock. Start stays fail-closed until detect/validate/CLI and `resolveStart`
 * all allow. This does not enable live `codex exec`.
 */
export function createComposedCodexRuntime(
  options: Pick<CodexRuntimeAdapterOptions, "detect" | "resolveStart" | "platform"> = {},
): CodexRuntimeAdapter {
  return createCodexRuntime({
    process: new OsProcessController(),
    ...options,
  });
}