import type { OrchestrationMode } from "@workforce/protocol";

import { UseCaseError } from "../projects/errors.js";

export interface StartRunHostRequest {
  operationId: string;
  idempotencyKey: string;
  taskId: string;
  definitionRevision: number;
  generation: number;
  attempt: number;
  principalId: string;
  clientId: string;
  placement: {
    executionNodeId: string;
    runtimeInstallationId: string;
    workspaceInstanceId: string;
  };
  runtime: { adapterId: string; protocolVersion: string };
  snapshotRef: string;
  /** Existing StartRunRequest field. Echoed; not a direct-execution scheduler. */
  orchestrationMode?: OrchestrationMode;
}

/**
 * T05 LocalNodeHost surface. Pause on Mock is unsupported and must not be faked.
 */
export interface RuntimeHostPort {
  start(request: StartRunHostRequest): Promise<{ handleId: string; runId: string }>;
  pause(handleId: string): Promise<{ accepted: boolean }>;
  cancel(handleId: string, reason?: string): Promise<{ accepted: boolean }>;
  inspect(handleId: string): Promise<{ status: string }>;
}

export class HostCapabilityError extends Error {
  readonly code = "unsupported_capability" as const;

  constructor(message = "lifecycle.pause is unsupported") {
    super(message);
    this.name = "HostCapabilityError";
  }
}

export class FakeRuntimeHost implements RuntimeHostPort {
  readonly started = new Map<string, StartRunHostRequest>();

  async start(request: StartRunHostRequest): Promise<{ handleId: string; runId: string }> {
    this.started.set(request.operationId, request);
    return { handleId: `hdl_${request.operationId}`, runId: `run_host_${request.operationId}` };
  }

  async pause(_handleId: string): Promise<{ accepted: boolean }> {
    void _handleId;
    throw new HostCapabilityError();
  }

  async cancel(_handleId: string, _reason?: string): Promise<{ accepted: boolean }> {
    void _handleId;
    void _reason;
    return { accepted: true };
  }

  async inspect(_handleId: string): Promise<{ status: string }> {
    void _handleId;
    return { status: "running" };
  }
}

export function unsupportedPause(): UseCaseError {
  return new UseCaseError("unsupported_capability", "lifecycle.pause is unsupported", {
    details: { capability: "lifecycle.pause" },
  });
}
