import type {
  RuntimeAdapter,
  RuntimeHandle,
  RuntimeHandleRef,
  RuntimeStatus,
} from "@workforce/runtime-spi";

import { RuntimeSdkError } from "./errors.js";
import { isTerminalStatus } from "./types.js";

export async function assertPauseUnsupported(adapter: RuntimeAdapter): Promise<void> {
  const descriptor = await adapter.describe();
  const pause = descriptor.capabilities.find((capability) => capability.name === "lifecycle.pause");
  if (!pause || pause.available) {
    throw new Error("lifecycle.pause must be declared unavailable");
  }
  const handle: RuntimeHandleRef = { handleId: "hdl_missing", runId: "run_missing" };
  try {
    if (!adapter.pause) {
      throw new RuntimeSdkError("unsupported_capability", "lifecycle.pause is unsupported");
    }
    await adapter.pause(handle);
    throw new Error("pause must not succeed");
  } catch (error) {
    if (!(error instanceof RuntimeSdkError) || error.code !== "unsupported_capability") {
      throw error;
    }
  }
}

export async function assertEventResumeUnsupported(adapter: RuntimeAdapter): Promise<void> {
  const descriptor = await adapter.describe();
  const resume = descriptor.capabilities.find((capability) => capability.name === "event.resume");
  if (!resume || resume.available) {
    throw new Error("event.resume must be declared unavailable");
  }
  const handle: RuntimeHandleRef = { handleId: "hdl_missing", runId: "run_missing" };
  try {
    const iterator = adapter.stream(handle, { sourceCursor: "adapter:1" })[Symbol.asyncIterator]();
    await iterator.next();
    throw new Error("stream with cursor must not succeed");
  } catch (error) {
    if (!(error instanceof RuntimeSdkError) || error.code !== "unsupported_capability") {
      throw error;
    }
  }
}

export function assertHandleIdentity(handle: RuntimeHandle): void {
  if (!handle.process?.startIdentity) {
    throw new Error("RuntimeHandle.process.startIdentity is required for recovery");
  }
}

export function assertCancelNotTerminal(status: RuntimeStatus): void {
  if (isTerminalStatus(status.status)) {
    throw new Error("cancel receipt must not pretend the process is already dead");
  }
}
