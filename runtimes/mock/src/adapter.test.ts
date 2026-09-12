import { describe, expect, it } from "vitest";
import {
  assertEventResumeUnsupported,
  assertHandleIdentity,
  assertPauseUnsupported,
  createStartRunRequest,
  ManualScheduler,
  SequentialIdGenerator,
} from "@workforce/runtime-sdk";

import { MockRuntimeAdapter, parseMockScenario } from "./adapter.js";

describe("MockRuntimeAdapter", () => {
  it("parses scenario names from snapshotRef", () => {
    expect(parseMockScenario("snap_01JTESTDEVA_TASKDEF000000")).toBe("success");
    expect(parseMockScenario("mock:waiting_input")).toBe("waiting_input");
    expect(parseMockScenario("mock:timeout")).toBe("timeout");
    expect(parseMockScenario("mock:failure")).toBe("failure");
    expect(parseMockScenario("mock:authoring_proposal")).toBe("authoring_proposal");
    expect(parseMockScenario("authoring:proposal")).toBe("authoring_proposal");
  });

  it("declares pause and event cursor resume unsupported", async () => {
    const adapter = new MockRuntimeAdapter();
    const descriptor = await adapter.describe();
    expect(descriptor.adapter.id).toBe("mock");
    expect(descriptor.runtime.transport).toBe("sdk");
    expect(descriptor.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "lifecycle.pause", available: false }),
        expect.objectContaining({ name: "event.resume", available: false }),
        expect.objectContaining({
          name: "usage.reporting",
          available: true,
          constraints: { money: false, tokens: true },
        }),
        expect.objectContaining({
          name: "authoring.proposal",
          available: true,
          constraints: { structured: true, rawIntent: false },
        }),
      ]),
    );
    await assertPauseUnsupported(adapter);
    await assertEventResumeUnsupported(adapter);
  });

  it("returns the same handle for the same operationId", async () => {
    const adapter = new MockRuntimeAdapter({
      scheduler: new ManualScheduler(),
      ids: new SequentialIdGenerator(),
    });
    const request = createStartRunRequest({ snapshotRef: "mock:waiting_input" });
    const first = await adapter.start(request);
    const second = await adapter.start(request);
    expect(second).toEqual(first);
    assertHandleIdentity(first);
  });

  it("accepts cancel without immediately becoming cancelled", async () => {
    const scheduler = new ManualScheduler();
    const adapter = new MockRuntimeAdapter({ scheduler, cancelGraceMs: 1000 });
    const handle = await adapter.start(
      createStartRunRequest({
        snapshotRef: "mock:waiting_input",
        operationId: "op_cancel_adapter",
      }),
    );
    const receipt = await adapter.cancel(handle);
    expect(receipt.accepted).toBe(true);
    expect((await adapter.inspect(handle)).status).toBe("waiting_input");
    await scheduler.advance(1000);
    expect((await adapter.inspect(handle)).status).toBe("cancelled");
  });
});
