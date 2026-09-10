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
  await scheduler.flush();
  await Promise.resolve();
  await Promise.resolve();
  await scheduler.flush();
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

  it("reattaches from the same store after Host restart without starting a second execution", async () => {
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
    expect(recovered[0]?.attached).toBe(true);
    expect((await second.store.listHandles())[0]?.auditOnly).toBe(true);
  });

  it("does not rerun when the adapter lost the process; inspect remains a safe path", async () => {
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
    expect(recovered[0]?.status.status).toBe("unknown");
    expect((await second.store.listHandles()).map((record) => record.handle.runId)).toEqual([
      handle.runId,
    ]);
    expect((await second.host.inspect(handle)).status).toBe("unknown");
    expect((await second.host.inspect(handle)).lastTrustedFactAt).toBeDefined();
    const replayed = await second.host.start(request);
    expect(replayed.handleId).toBe(handle.handleId);
    expect(await second.store.listHandles()).toHaveLength(1);
  });

  it("never kills on identity mismatch and treats old fencing as audit-only", async () => {
    const first = await createMockRuntime();
    const handle = await first.host.start(
      createStartRunRequest({ snapshotRef: "mock:waiting_input", operationId: "op_fence" }),
    );
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
    await second.host.sendInput(handle, { operationId: "op_fence_input", text: "go" });
    await settle(second.scheduler);
    const events = await collectEvents(second.host.stream(handle));
    expect(events.some((event) => event.data["auditOnly"] === true)).toBe(true);
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
