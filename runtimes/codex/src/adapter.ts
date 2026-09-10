import type {
  EventCursor,
  InputReceipt,
  OperationReceipt,
  ReconciliationResult,
  RuntimeAdapter,
  RuntimeConfig,
  RuntimeDescriptor,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeHandleRef,
  RuntimeStatus,
  ValidationResult,
} from "@workforce/runtime-spi";
import { RuntimeSdkError } from "@workforce/runtime-sdk";

import { detectCodex, type CodexDetection } from "./detect.js";

export const CODEX_ADAPTER_ID = "codex";
export const CODEX_ADAPTER_VERSION = "0.1.0";

export interface CodexRuntimeAdapterOptions {
  detect?: () => CodexDetection;
}

export class CodexRuntimeAdapter implements RuntimeAdapter {
  private readonly detectFn: () => CodexDetection;

  constructor(options: CodexRuntimeAdapterOptions = {}) {
    this.detectFn = options.detect ?? (() => detectCodex());
  }

  async describe(): Promise<RuntimeDescriptor> {
    const detection = this.detectFn();
    return {
      adapter: {
        id: CODEX_ADAPTER_ID,
        name: "Codex Runtime",
        version: CODEX_ADAPTER_VERSION,
        protocolVersions: ["0.1"],
      },
      runtime: {
        id: CODEX_ADAPTER_ID,
        displayName: "OpenAI Codex CLI",
        ...(detection.version ? { version: detection.version } : {}),
        transport: "process",
      },
      platforms: ["windows", "macos", "linux"],
      capabilities: [
        {
          name: "lifecycle.start",
          version: "0.1",
          available: false,
          constraints: { reason: "live exec not enabled; T03 measured help only" },
        },
        { name: "lifecycle.pause", version: "0.1", available: false },
        { name: "event.resume", version: "0.1", available: false },
        { name: "lifecycle.cancel", version: "0.1", available: true, features: ["process-tree"] },
        {
          name: "usage",
          version: "0.1",
          available: false,
          constraints: { unknownCost: true },
        },
      ],
    };
  }

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    const detection =
      config.executable !== undefined
        ? detectCodex({ configuredExecutable: config.executable })
        : this.detectFn();
    const adapterOk = config.adapterId === CODEX_ADAPTER_ID;
    const found = detection.found;
    const checks: ValidationResult["checks"] = [
      {
        name: "adapterId",
        ok: adapterOk,
        ...(adapterOk ? {} : { detail: `expected ${CODEX_ADAPTER_ID}` }),
      },
      {
        name: "executable",
        ok: found,
        detail: found
          ? (detection.executable ?? "codex executable detected")
          : "codex executable not detected",
      },
      {
        name: "live_exec",
        ok: false,
        detail: "V0.1 has not run a live Codex exec on this host; start is refused",
      },
    ];
    return {
      valid: adapterOk && found,
      ...(detection.version ? { runtimeVersion: detection.version } : {}),
      checks,
    };
  }

  async start(_request: Parameters<RuntimeAdapter["start"]>[0]): Promise<RuntimeHandle> {
    void _request;
    throw new RuntimeSdkError(
      "unsupported_capability",
      "Codex live exec is not enabled. Mock the M3 loop; T15 live start waits for an authorized exec fixture.",
      { details: { capability: "lifecycle.start", runtime: CODEX_ADAPTER_ID } },
    );
  }

  async sendInput(): Promise<InputReceipt> {
    throw new RuntimeSdkError("unsupported_capability", "Codex mid-run input is untested", {
      details: { capability: "input" },
    });
  }

  async pause(): Promise<OperationReceipt> {
    throw new RuntimeSdkError("unsupported_capability", "Codex has no pause command", {
      details: { capability: "lifecycle.pause" },
    });
  }

  async resume(): Promise<OperationReceipt> {
    throw new RuntimeSdkError(
      "unsupported_capability",
      "Codex resume restores a session, not an event cursor",
      { details: { capability: "event.resume" } },
    );
  }

  async cancel(): Promise<OperationReceipt> {
    throw new RuntimeSdkError(
      "unsupported_capability",
      "Codex CLI has no cancel RPC; Host process-tree kill is not wired in this slice",
      { details: { capability: "lifecycle.cancel" } },
    );
  }

  async inspect(handle: RuntimeHandleRef): Promise<RuntimeStatus> {
    return { handle, status: "unknown" };
  }

  stream(_handle: RuntimeHandleRef, _cursor?: EventCursor): AsyncIterable<RuntimeEvent> {
    void _handle;
    void _cursor;
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: true as const, value: undefined }),
        };
      },
    };
  }

  async reconcile(handle: RuntimeHandle): Promise<ReconciliationResult> {
    return {
      attached: false,
      status: { handle, status: "unknown" },
    };
  }
}

export function createCodexRuntime(options?: CodexRuntimeAdapterOptions): CodexRuntimeAdapter {
  return new CodexRuntimeAdapter(options);
}
