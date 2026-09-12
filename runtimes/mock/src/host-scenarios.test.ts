import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@workforce/runtime-spi";
import {
  createStartRunRequest,
  DEFAULT_LOCAL_NODE_ID,
  isRuntimeSdkError,
  parseStartRunRequest,
  RuntimeSdkError,
} from "@workforce/runtime-sdk";

import { createMockRuntime } from "./harness.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

async function collectEvents(stream: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function settle(scheduler: { flush(): Promise<void> }): Promise<void> {
  for (let index = 0; index < 64; index += 1) {
    await scheduler.flush();
    await Promise.resolve();
  }
}

describe("LocalNodeHost + MockRuntimeAdapter", () => {
  it("starts the frozen command.run.start fixture as a success scenario", async () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(fixtures, "command.run.start.json"), "utf8"),
    );
    const request = parseStartRunRequest(raw);
    const { host, scheduler } = await createMockRuntime();
    const handle = await host.start(request);
    expect(handle.adapterId).toBe("mock");
    expect(handle.process?.startIdentity).toMatch(/^mock:\d+:/);
    await settle(scheduler);
    expect((await host.inspect(handle)).status).toBe("succeeded");
  });

  it("runs success, failure, waiting_input, and timeout scenarios", async () => {
    const { host, scheduler } = await createMockRuntime({ timeoutMs: 5_000 });

    const success = await host.start(
      createStartRunRequest({ operationId: "op_success", snapshotRef: "mock:success" }),
    );
    await settle(scheduler);
    expect((await host.inspect(success)).status).toBe("succeeded");

    const failure = await host.start(
      createStartRunRequest({
        operationId: "op_failure",
        attempt: 2,
        snapshotRef: "mock:failure",
      }),
    );
    await settle(scheduler);
    expect((await host.inspect(failure)).status).toBe("failed");

    const waiting = await host.start(
      createStartRunRequest({
        operationId: "op_wait",
        attempt: 3,
        snapshotRef: "mock:waiting_input",
      }),
    );
    expect((await host.inspect(waiting)).status).toBe("waiting_input");
    const input = await host.sendInput(waiting, { operationId: "op_input_1", text: "continue" });
    expect(input.accepted).toBe(true);
    await settle(scheduler);
    expect((await host.inspect(waiting)).status).toBe("succeeded");

    const timeout = await host.start(
      createStartRunRequest({
        operationId: "op_timeout",
        attempt: 4,
        snapshotRef: "mock:timeout",
      }),
    );
    expect((await host.inspect(timeout)).status).toBe("running");
    await scheduler.advance(4_999);
    expect((await host.inspect(timeout)).status).toBe("running");
    await scheduler.advance(1);
    expect((await host.inspect(timeout)).status).toBe("failed");
  });

  it("persists only protocol-shaped authoring proposals and rejects raw output", async () => {
    const { host, scheduler, store } = await createMockRuntime();
    const proposalHandle = await host.start(
      createStartRunRequest({
        operationId: "op_authoring_proposal",
        snapshotRef: "mock:authoring_proposal",
      }),
    );
    await settle(scheduler);

    const proposalEvents = await collectEvents(host.stream(proposalHandle));
    const proposalEvent = proposalEvents.find(
      (event) => event.type === "runtime.authoring.proposal",
    );
    expect(proposalEvent?.data).toMatchObject({
      proposal: {
        id: expect.stringMatching(/^apr_/),
        projectId: "prj_mock_authoring",
        sourceRunId: "run_mock_authoring",
        summary: "Structured authoring proposal",
        targets: [
          {
            targetType: "workflow",
            targetId: "wf_mock_authoring",
            expectedRevision: 1,
            patchRef: "arv_mock_authoring_patch",
          },
        ],
      },
    });
    const storedProposal = (await store.listEvents(proposalHandle.handleId)).find(
      (event) => event.type === "runtime.authoring.proposal",
    );
    expect(Object.keys(storedProposal?.data ?? {}).sort()).toEqual(["adapterSequence", "proposal"]);

    const invalidHandle = await host.start(
      createStartRunRequest({
        operationId: "op_authoring_proposal_invalid",
        attempt: 2,
        snapshotRef: "mock:authoring_proposal_invalid",
      }),
    );
    await settle(scheduler);
    const invalidEvents = await collectEvents(host.stream(invalidHandle));
    expect(invalidEvents).toContainEqual(
      expect.objectContaining({
        type: "runtime.authoring.proposal.rejected",
        data: expect.objectContaining({ reason: "invalid_authoring_proposal" }),
      }),
    );
    expect(JSON.stringify(await store.listEvents(invalidHandle.handleId))).not.toContain(
      "must-not-reach-host-storage",
    );

    const secretSummaryHandle = await host.start(
      createStartRunRequest({
        operationId: "op_authoring_proposal_secret_summary",
        attempt: 3,
        snapshotRef: "mock:authoring_proposal_secret_summary",
      }),
    );
    await settle(scheduler);
    const secretSummaryEvents = await collectEvents(host.stream(secretSummaryHandle));
    expect(JSON.stringify(secretSummaryEvents)).not.toContain("must-not-reach-host-storage");
    expect(
      secretSummaryEvents.find((event) => event.type === "runtime.authoring.proposal")?.data,
    ).toMatchObject({ proposal: { summary: "Structured authoring proposal" } });
  });

  it("returns the same handle for the same operation and conflicts on payload reuse", async () => {
    const { host } = await createMockRuntime();
    const request = createStartRunRequest({ snapshotRef: "mock:waiting_input" });
    const first = await host.start(request);
    const second = await host.start(request);
    expect(second.handleId).toBe(first.handleId);
    expect(second.runId).toBe(first.runId);

    const sameKeySamePayload = await host.start(
      createStartRunRequest({
        operationId: "op_retry_new_id",
        snapshotRef: "mock:waiting_input",
      }),
    );
    expect(sameKeySamePayload.handleId).toBe(first.handleId);

    await expect(
      host.start(
        createStartRunRequest({
          operationId: request.operationId,
          snapshotRef: "mock:failure",
        }),
      ),
    ).rejects.toSatisfy((error: unknown) => isRuntimeSdkError(error) && error.code === "conflict");

    await expect(
      host.start(
        createStartRunRequest({
          operationId: "op_conflict_key",
          snapshotRef: "mock:failure",
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "idempotency_key_reused",
    );
  });

  it("rejects start when local node capacity is exhausted", async () => {
    const { host } = await createMockRuntime({ maxConcurrentRuns: 1 });
    await host.start(
      createStartRunRequest({ snapshotRef: "mock:waiting_input", operationId: "op_cap_1" }),
    );
    await expect(
      host.start(
        createStartRunRequest({
          operationId: "op_cap_2",
          attempt: 2,
          snapshotRef: "mock:waiting_input",
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "resource_exhausted",
    );
  });

  it("accepts cancel without pretending the process is dead, then force-kills after grace", async () => {
    const { host, scheduler, killer } = await createMockRuntime({ cancelGraceMs: 1_000 });
    const handle = await host.start(
      createStartRunRequest({ snapshotRef: "mock:waiting_input", operationId: "op_cancel" }),
    );
    const receipt = await host.cancel(handle, "user_cancel");
    expect(receipt.accepted).toBe(true);
    expect((await host.inspect(handle)).status).toBe("waiting_input");
    expect(killer.calls).toHaveLength(0);

    const again = await host.cancel(handle);
    expect(again.accepted).toBe(true);

    await scheduler.advance(1_000);
    expect((await host.inspect(handle)).status).toBe("cancelled");
    expect(killer.calls).toHaveLength(1);
    expect(killer.calls[0]?.startIdentity).toBe(handle.process?.startIdentity);
  });

  it("does not implement pause or adapter event-cursor resume, but Host can replay its buffer", async () => {
    const { host, adapter, scheduler } = await createMockRuntime();
    const handle = await host.start(
      createStartRunRequest({ operationId: "op_cursor", snapshotRef: "mock:success" }),
    );
    await expect(host.pause(handle)).rejects.toBeInstanceOf(RuntimeSdkError);
    await expect(host.resume(handle)).rejects.toBeInstanceOf(RuntimeSdkError);
    await expect(async () => {
      const iterator = adapter.stream(handle, { sourceCursor: "mock:x:1" })[Symbol.asyncIterator]();
      await iterator.next();
    }).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "unsupported_capability",
    );

    await settle(scheduler);
    const all = await collectEvents(host.stream(handle));
    expect(all.map((event) => event.type)).toContain("runtime.starting");
    expect(all.map((event) => event.type).at(-1)).toBe("runtime.completed");
    const sequences = all.map((event) => event.data["sequence"]);
    expect(sequences).toEqual([...sequences].sort((a, b) => Number(a) - Number(b)));

    const resumed = await collectEvents(host.stream(handle, { sourceCursor: "host:1" }));
    expect(resumed).toEqual(all.slice(1));
    expect(
      all.some((event) => event.type === "runtime.usage.updated" && event.data["tokens"] === 12),
    ).toBe(true);
    expect(
      all.some((event) => event.type === "runtime.usage.updated" && event.data["costMinor"] === 0),
    ).toBe(false);
  });

  it("generates a node-aware binding and keeps inspect/cancel after lease expiry", async () => {
    const { host, scheduler } = await createMockRuntime({ leaseDurationMs: 1_000 });
    const handle = await host.start(
      createStartRunRequest({ snapshotRef: "mock:waiting_input", operationId: "op_lease" }),
    );
    const binding = await host.getBinding(handle.handleId);
    expect(binding.nodeId).toBe(DEFAULT_LOCAL_NODE_ID);
    expect(binding.fencingToken).toBe(1);
    expect(binding.executionLeaseId).toMatch(/^lse_/);

    await scheduler.advance(1_001);
    await expect(
      host.start(
        createStartRunRequest({
          operationId: "op_lease_2",
          attempt: 2,
          snapshotRef: "mock:waiting_input",
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "lease_expired",
    );
    await expect(
      host.sendInput(handle, { operationId: "op_late_input", text: "nope" }),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "lease_expired",
    );

    expect((await host.inspect(handle)).status).toBe("waiting_input");
    expect((await host.cancel(handle)).accepted).toBe(true);
  });

  it("accepts only its configured remote Mock node and isolates an old binding after replacement", async () => {
    const remoteNodeId = "ndl_01JTESTREMOTEMOCKNODE00000";
    const placement = {
      executionNodeId: remoteNodeId,
      runtimeInstallationId: "rtm_01JTESTREMOTEINSTALL00000",
      workspaceInstanceId: "wsi_01JTESTREMOTEWORKSPACE000",
    };
    const first = await createMockRuntime({ nodeId: remoteNodeId });
    const request = createStartRunRequest({
      operationId: "op_remote_node",
      snapshotRef: "mock:waiting_input",
      placement,
    });
    const handle = await first.host.start(request);
    await settle(first.scheduler);
    expect((await first.host.inspect(handle)).status).toBe("waiting_input");
    const statusBeforeReplacement = await first.store.getHandle(handle.handleId);

    expect(await first.host.getBinding(handle.handleId)).toMatchObject({
      nodeId: remoteNodeId,
      runtimeInstallationId: placement.runtimeInstallationId,
      workspaceInstanceId: placement.workspaceInstanceId,
      fencingToken: 1,
    });
    await expect(
      first.host.start(
        createStartRunRequest({ operationId: "op_wrong_remote_node", snapshotRef: "mock:success" }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "validation_failed",
    );

    await first.host.dispose();
    const second = await createMockRuntime({
      nodeId: remoteNodeId,
      store: first.store,
      adapter: first.adapter,
      scheduler: first.scheduler,
      ids: first.ids,
    });
    const recovered = await second.host.recover();
    expect(recovered).toEqual([
      expect.objectContaining({
        attached: false,
        status: expect.objectContaining({ status: "waiting_input" }),
      }),
    ]);
    expect((await second.store.getNodeSession())?.fencingToken).toBe(2);
    const iterator = second.host.stream(handle)[Symbol.asyncIterator]();
    await iterator.next();

    await expect(
      second.host.sendInput(handle, { operationId: "op_remote_node_input", text: "continue" }),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "lease_expired",
    );
    const staleInputOperationId = "op_stale_remote_node_input";
    await first.adapter.sendInput(handle, { operationId: staleInputOperationId, text: "late" });
    await second.scheduler.advance(10_000);
    await settle(second.scheduler);
    const staleEvents = await second.store.listEvents(handle.handleId);
    expect(staleEvents).toContainEqual(
      expect.objectContaining({
        type: "runtime.message",
        auditOnly: true,
        data: expect.objectContaining({ inputOperationId: staleInputOperationId }),
      }),
    );
    expect(staleEvents).toContainEqual(
      expect.objectContaining({ type: "runtime.completed", auditOnly: true }),
    );
    const isolated = await second.store.getHandle(handle.handleId);
    expect(isolated).toMatchObject({
      status: statusBeforeReplacement?.status,
      terminal: statusBeforeReplacement?.terminal,
      lastTrustedFactAt: statusBeforeReplacement?.lastTrustedFactAt,
      auditOnly: true,
    });
    await expect(second.host.inspect(handle)).resolves.toMatchObject({
      status: statusBeforeReplacement?.status,
      lastTrustedFactAt: statusBeforeReplacement?.lastTrustedFactAt,
    });
    await expect(second.host.recover()).resolves.toEqual([
      expect.objectContaining({
        attached: false,
        status: expect.objectContaining({ status: statusBeforeReplacement?.status }),
      }),
    ]);
    for (let index = 1; index < staleEvents.length; index += 1) {
      await iterator.next();
    }
    let streamClosed = false;
    void iterator.next().then(() => {
      streamClosed = true;
    });
    await Promise.resolve();
    expect(streamClosed).toBe(false);
    await second.host.dispose();
  });

  it("does not restart an execution when a Host replacement fences its stored binding", async () => {
    const first = await createMockRuntime();
    const request = createStartRunRequest({
      snapshotRef: "mock:waiting_input",
      operationId: "op_restart",
    });
    const handle = await first.host.start(request);
    await first.host.dispose();

    const second = await createMockRuntime({
      store: first.store,
      adapter: first.adapter,
      scheduler: first.scheduler,
      ids: first.ids,
    });
    const replayed = await second.host.start(request);
    expect(replayed.handleId).toBe(handle.handleId);
    expect((await second.store.listHandles()).map((record) => record.handle.handleId)).toEqual([
      handle.handleId,
    ]);

    const recovered = await second.host.recover();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      attached: false,
      status: expect.objectContaining({ status: "waiting_input" }),
    });
    expect((await second.store.listHandles())[0]?.auditOnly).toBe(true);
  });

  it("does not rerun or promote stale adapter state after Host replacement", async () => {
    const first = await createMockRuntime();
    const request = createStartRunRequest({
      snapshotRef: "mock:waiting_input",
      operationId: "op_lost",
    });
    const handle = await first.host.start(request);
    await first.host.dispose();
    await first.adapter.dispose();

    const second = await createMockRuntime({
      store: first.store,
      scheduler: first.scheduler,
    });
    const recovered = await second.host.recover();
    expect(recovered[0]?.attached).toBe(false);
    expect(recovered[0]?.status.status).toBe("waiting_input");
    expect((await second.store.listHandles()).map((record) => record.handle.runId)).toEqual([
      handle.runId,
    ]);
    expect((await second.host.inspect(handle)).status).toBe("waiting_input");
    expect((await second.host.inspect(handle)).lastTrustedFactAt).toBeDefined();
    const replayed = await second.host.start(request);
    expect(replayed.handleId).toBe(handle.handleId);
    expect(await second.store.listHandles()).toHaveLength(1);
  });

  it("never kills on identity mismatch and isolates old fencing events from status", async () => {
    const first = await createMockRuntime();
    const handle = await first.host.start(
      createStartRunRequest({ snapshotRef: "mock:waiting_input", operationId: "op_fence" }),
    );
    await settle(first.scheduler);
    expect((await first.host.inspect(handle)).status).toBe("waiting_input");
    const statusBeforeReplacement = await first.store.getHandle(handle.handleId);
    const forged = {
      ...handle,
      process: { pid: 1, startIdentity: "mock:1:not-the-original" },
    };
    const mismatch = await first.host.reconcile(forged);
    expect(mismatch.attached).toBe(false);
    expect(mismatch.status.status).toBe("orphaned");
    expect(first.killer.calls).toHaveLength(0);

    await first.host.dispose();
    const second = await createMockRuntime({
      store: first.store,
      adapter: first.adapter,
      scheduler: first.scheduler,
      ids: first.ids,
    });
    await expect(second.host.recover()).resolves.toEqual([
      expect.objectContaining({
        attached: false,
        status: expect.objectContaining({ status: "waiting_input" }),
      }),
    ]);
    const iterator = second.host.stream(handle)[Symbol.asyncIterator]();
    await iterator.next();
    await expect(
      second.host.sendInput(handle, { operationId: "op_fence_input", text: "go" }),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "lease_expired",
    );
    const staleInputOperationId = "op_fence_stale_input";
    await first.adapter.sendInput(handle, { operationId: staleInputOperationId, text: "go" });
    await second.scheduler.advance(10_000);
    await settle(second.scheduler);
    const staleEvents = await second.store.listEvents(handle.handleId);
    expect(staleEvents).toContainEqual(
      expect.objectContaining({
        type: "runtime.message",
        auditOnly: true,
        data: expect.objectContaining({ inputOperationId: staleInputOperationId }),
      }),
    );
    expect(staleEvents).toContainEqual(
      expect.objectContaining({ type: "runtime.completed", auditOnly: true }),
    );
    expect(await second.store.getHandle(handle.handleId)).toMatchObject({
      status: statusBeforeReplacement?.status,
      terminal: statusBeforeReplacement?.terminal,
      lastTrustedFactAt: statusBeforeReplacement?.lastTrustedFactAt,
      auditOnly: true,
    });
    await expect(second.host.inspect(handle)).resolves.toMatchObject({
      status: statusBeforeReplacement?.status,
      lastTrustedFactAt: statusBeforeReplacement?.lastTrustedFactAt,
    });
    await second.host.dispose();
  });

  it("rejects unknown protocol majors", async () => {
    const { host } = await createMockRuntime();
    await expect(
      host.start(
        createStartRunRequest({
          runtime: { adapterId: "mock", protocolVersion: "1.0" },
        }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isRuntimeSdkError(error) && error.code === "unsupported_protocol",
    );
  });
});
