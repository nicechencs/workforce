import { describe, expect, it } from "vitest";

import { MemoryRuntimeHostStore } from "./memory-store.js";
import { createStartRunRequest } from "./request.js";
import type { StoredHandle } from "./types.js";

describe("MemoryRuntimeHostStore", () => {
  it("round-trips handles independently of the caller object", async () => {
    const store = new MemoryRuntimeHostStore();
    const request = createStartRunRequest();
    const record: StoredHandle = {
      handle: {
        handleId: "hdl_1",
        runId: "run_1",
        adapterId: "mock",
        createdAt: "2026-09-10T10:00:00.000Z",
        process: { pid: 4242, startIdentity: "mock:4242:2026-09-10T10:00:00.000Z" },
      },
      binding: {
        nodeId: request.placement.executionNodeId,
        nodeSessionId: "ses_1",
        runtimeInstallationId: request.placement.runtimeInstallationId,
        executionLeaseId: "lse_1",
        fencingToken: 1,
        workspaceInstanceId: request.placement.workspaceInstanceId,
      },
      status: "running",
      terminal: false,
      request,
      auditOnly: false,
    };

    await store.putHandle(record);
    record.status = "failed";
    const loaded = await store.getHandle("hdl_1");
    expect(loaded?.status).toBe("running");
  });

  it("finds operations by receipt scope", async () => {
    const store = new MemoryRuntimeHostStore();
    await store.putOperation({
      operationId: "op_1",
      status: "committed",
      scope: {
        principalId: "usr_1",
        clientId: "cli_1",
        canonicalOperation: "runtime.start",
        resource: "task:tsk_1",
        idempotencyKey: "key-1",
      },
      requestDigest: "abc",
      acceptedAt: "2026-09-10T10:00:00.000Z",
      handleId: "hdl_1",
    });

    const found = await store.getOperationByScope({
      principalId: "usr_1",
      clientId: "cli_1",
      canonicalOperation: "runtime.start",
      resource: "task:tsk_1",
      idempotencyKey: "key-1",
    });
    expect(found?.handleId).toBe("hdl_1");
  });
});
