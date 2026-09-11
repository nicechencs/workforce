import {
  HostCapabilityError,
  type RuntimeHostPort,
  type StartRunHostRequest,
} from "@workforce/application";
import { parseStartRunRequest } from "@workforce/protocol";
import { MockRuntimeAdapter } from "@workforce/runtime-mock";
import { LocalNodeHost, type RuntimeHostStore } from "@workforce/runtime-sdk";
import type { RuntimeHandle } from "@workforce/runtime-spi";

import { LOCAL_NODE_ID, MOCK_RUNTIME_ID } from "./catalog.js";

export type RunTerminalStatus = "succeeded" | "failed" | "cancelled";

export interface RunTerminalEvent {
  handleId: string;
  hostRunId: string;
  status: RunTerminalStatus;
}

export interface ComposedMockHostOptions {
  store: RuntimeHostStore;
  onTerminal: (event: RunTerminalEvent) => Promise<void>;
  completeAfterMs?: number;
  nodeId?: string;
}

export class ComposedMockHost implements RuntimeHostPort {
  readonly adapter: MockRuntimeAdapter;
  readonly host: LocalNodeHost;
  private readonly store: RuntimeHostStore;
  private readonly onTerminal: (event: RunTerminalEvent) => Promise<void>;
  private readonly watching = new Set<string>();
  private readonly handles = new Map<string, RuntimeHandle>();
  private disposed = false;

  constructor(options: ComposedMockHostOptions) {
    this.adapter = new MockRuntimeAdapter({
      completeAfterMs: options.completeAfterMs ?? 10,
    });
    this.host = new LocalNodeHost({
      adapter: this.adapter,
      store: options.store,
      nodeId: options.nodeId ?? LOCAL_NODE_ID,
    });
    this.store = options.store;
    this.onTerminal = options.onTerminal;
  }

  async start(request: StartRunHostRequest): Promise<{ handleId: string; runId: string }> {
    const parsed = parseStartRunRequest({
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      taskId: request.taskId,
      definitionRevision: request.definitionRevision,
      generation: request.generation,
      attempt: request.attempt,
      principalId: request.principalId,
      clientId: request.clientId,
      placement: request.placement,
      runtime: {
        adapterId: request.runtime.adapterId || MOCK_RUNTIME_ID,
        protocolVersion: request.runtime.protocolVersion || "0.1",
      },
      snapshotRef: request.snapshotRef || "mock:success",
    });
    const handle = await this.host.start(parsed);
    this.handles.set(handle.handleId, handle);
    this.watch(handle);
    return { handleId: handle.handleId, runId: handle.runId };
  }

  async pause(_handleId: string): Promise<{ accepted: boolean }> {
    void _handleId;
    throw new HostCapabilityError();
  }

  async cancel(handleId: string, reason?: string): Promise<{ accepted: boolean }> {
    const receipt = await this.host.cancel(this.requireHandle(handleId), reason);
    return { accepted: receipt.accepted };
  }

  async inspect(handleId: string): Promise<{ status: string }> {
    const status = await this.host.inspect(this.requireHandle(handleId));
    return { status: status.status };
  }

  async sendInput(
    handleId: string,
    input: { operationId: string; text?: string; payload?: Record<string, unknown> },
  ): Promise<void> {
    const payload: { operationId: string; text?: string; payload?: Record<string, unknown> } = {
      operationId: input.operationId,
    };
    if (input.text !== undefined) {
      payload.text = input.text;
    }
    if (input.payload !== undefined) {
      payload.payload = input.payload;
    }
    await this.host.sendInput(this.requireHandle(handleId), payload);
  }

  async recover(): Promise<void> {
    for (const stored of await this.store.listHandles()) {
      this.handles.set(stored.handle.handleId, stored.handle);
    }
    await this.host.recover();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.adapter.dispose();
    await this.host.dispose();
  }

  private requireHandle(handleId: string): RuntimeHandle {
    const handle = this.handles.get(handleId);
    if (handle) {
      return handle;
    }
    return {
      handleId,
      runId: handleId,
      adapterId: MOCK_RUNTIME_ID,
      createdAt: new Date().toISOString(),
    };
  }

  private watch(handle: RuntimeHandle): void {
    if (this.watching.has(handle.handleId) || this.disposed) {
      return;
    }
    this.watching.add(handle.handleId);
    void this.pump(handle);
  }

  private async pump(handle: RuntimeHandle): Promise<void> {
    try {
      for await (const event of this.host.stream(handle)) {
        if (this.disposed) {
          return;
        }
        const status = terminalStatus(event.type);
        if (!status) {
          continue;
        }
        await this.onTerminal({
          handleId: handle.handleId,
          hostRunId: handle.runId,
          status,
        });
        return;
      }
    } catch {
      // Restart reconcile inspects handles; never invent a second start.
    }
  }
}

function terminalStatus(type: string): RunTerminalStatus | undefined {
  if (type === "runtime.completed") {
    return "succeeded";
  }
  if (type === "runtime.failed") {
    return "failed";
  }
  if (type === "runtime.cancelled") {
    return "cancelled";
  }
  return undefined;
}
