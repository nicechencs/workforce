import { describe, expect, it } from "vitest";

import type { StartRunHostRequest } from "@workforce/application";
import { MemoryRuntimeHostStore } from "@workforce/runtime-sdk";

import { ComposedMockHost } from "../src/composition/mock-host.js";

const authoringRequest = (snapshotRef: string): StartRunHostRequest => ({
  operationId: `op_${snapshotRef.replace(/[^a-z]/g, "_")}`,
  idempotencyKey: `key_${snapshotRef.replace(/[^a-z]/g, "_")}`,
  taskId: "tsk_authoring",
  definitionRevision: 1,
  generation: 1,
  attempt: 1,
  principalId: "usr_test",
  clientId: "cli_test",
  placement: {
    executionNodeId: "ndl_local",
    runtimeInstallationId: "rti_mock_local",
    workspaceInstanceId: "wsi_test",
  },
  runtime: { adapterId: "mock", protocolVersion: "0.1" },
  snapshotRef,
});

async function eventually(assertion: () => void, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw last;
}

describe("ComposedMockHost authoring proposal consumption", () => {
  it("replays an unacknowledged proposal after recovery and ignores a non-authoring Run", async () => {
    const store = new MemoryRuntimeHostStore();
    let firstAttempts = 0;
    const first = new ComposedMockHost({
      store,
      completeAfterMs: 0,
      onTerminal: async () => undefined,
      onAuthoringProposal: async () => {
        firstAttempts += 1;
        return false;
      },
    });
    const authoring = authoringRequest("authoring:proposal");
    first.setInitialInput(authoring.operationId, {
      operationId: `${authoring.operationId}:input`,
      text: "transient authoring intent",
    });
    await first.start(authoring);
    await eventually(() => expect(firstAttempts).toBeGreaterThan(0));
    await first.dispose();

    let replayed = 0;
    const recovered = new ComposedMockHost({
      store,
      completeAfterMs: 0,
      onTerminal: async () => undefined,
      onAuthoringProposal: async () => {
        replayed += 1;
        return true;
      },
    });
    await recovered.recover();
    await eventually(() => expect(replayed).toBe(1));
    await recovered.dispose();

    let ordinaryRunProposal = 0;
    const ordinary = new ComposedMockHost({
      store: new MemoryRuntimeHostStore(),
      completeAfterMs: 0,
      onTerminal: async () => undefined,
      onAuthoringProposal: async () => {
        ordinaryRunProposal += 1;
        return true;
      },
    });
    await ordinary.start(authoringRequest("mock:authoring_proposal"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ordinaryRunProposal).toBe(0);
    await ordinary.dispose();
  });
});
