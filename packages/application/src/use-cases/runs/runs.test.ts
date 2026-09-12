import { describe, expect, it } from "vitest";

import {
  decideRecovery,
  nextApprovalStatus,
  nextBackoffMs,
  nextNodeStatus,
  nextProjectStatus,
  nextRunStatus,
  nextTaskStatus,
  nextWorkflowStatus,
  raiseBudget,
  releaseReservation,
  reserveBudget,
  reviewerCircularWait,
  schedule,
  settleUsage,
  validateWorkflowGraph,
} from "../../../../workflow-engine/src/index.js";

import type { EnginePort } from "../projects/engine-port.js";
import { createWorkforceApp } from "../projects/service.js";
import { UseCaseError } from "../projects/errors.js";
import { FakeRuntimeHost, type RuntimeHostPort, type StartRunHostRequest } from "./host.js";
import { recordRunTimedOut, settleRunCancel } from "./runs.js";

function engine(): EnginePort {
  return {
    nextProjectStatus,
    nextTaskStatus,
    nextRunStatus,
    nextApprovalStatus,
    nextWorkflowStatus,
    nextNodeStatus,
    validateWorkflowGraph,
    reviewerCircularWait,
    schedule,
    decideRecovery,
    reserveBudget,
    releaseReservation,
    settleUsage,
    raiseBudget,
    nextBackoffMs,
  };
}

class FlakyStartHost implements RuntimeHostPort {
  starts = 0;

  async start(request: StartRunHostRequest): Promise<{ handleId: string; runId: string }> {
    this.starts += 1;
    if (this.starts === 1) {
      throw new Error("runtime unavailable");
    }
    return { handleId: `hdl_${request.operationId}`, runId: `host_${request.operationId}` };
  }

  async pause(_handleId: string): Promise<{ accepted: boolean }> {
    void _handleId;
    return { accepted: true };
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

class RecordingRuntimeHost implements RuntimeHostPort {
  readonly cancelCalls: { handleId: string; reason?: string }[] = [];
  cancelFailuresRemaining = 0;
  acceptCancellation = true;

  async start(request: StartRunHostRequest): Promise<{ handleId: string; runId: string }> {
    return { handleId: `hdl_${request.operationId}`, runId: `host_${request.operationId}` };
  }

  async pause(_handleId: string): Promise<{ accepted: boolean }> {
    void _handleId;
    return { accepted: true };
  }

  async cancel(handleId: string, reason?: string): Promise<{ accepted: boolean }> {
    this.cancelCalls.push({ handleId, ...(reason ? { reason } : {}) });
    if (this.cancelFailuresRemaining > 0) {
      this.cancelFailuresRemaining -= 1;
      throw new Error("runtime cancel transport failed");
    }
    return { accepted: this.acceptCancellation };
  }

  async inspect(_handleId: string): Promise<{ status: string }> {
    void _handleId;
    return { status: "running" };
  }
}

async function startRunningRun(host?: RuntimeHostPort) {
  const app = createWorkforceApp({ engine: engine(), ...(host ? { host } : {}) });
  const created = await app.createProject({
    operationId: "op_create",
    idempotencyKey: "create",
    organizationId: "org",
    name: "n",
    objective: "o",
  });
  const planning = await app.startPlanning({
    operationId: "op_plan",
    idempotencyKey: "plan",
    projectId: created.project.id,
    workspaceId: "wsp",
    teamVersionId: "tmv",
    runtimeId: "mock",
    budgetId: "bdg",
    executionNodeId: "ndl_local",
    runtimeInstallationId: "rtm",
    workspaceInstanceId: "wsi",
    planDigest: "digest",
  });
  await app.confirmPlan({
    operationId: "op_confirm",
    idempotencyKey: "confirm",
    projectId: created.project.id,
    approvalId: planning.approvalId,
    graph: {
      id: "wfv",
      workflowId: "wf",
      version: 1,
      entryNodeIds: ["solo"],
      nodes: [{ id: "solo", kind: "task", role: "developer", expectedOutputIds: ["out"] }],
      edges: [],
    },
  });
  await app.start({
    operationId: "op_start",
    idempotencyKey: "start",
    projectId: created.project.id,
  });
  const task = [...app.world.tasks.values()][0];
  if (!task) {
    throw new Error("missing task");
  }
  const started = await app.startRun({ operationId: "op_run", taskId: task.id });
  return { app, run: started.run };
}

describe("run cancellation", () => {
  it.each(["succeeded", "failed", "timed_out"] as const)(
    "rejects cancellation from terminal status %s without side effects",
    async (terminalStatus) => {
      const host = new RecordingRuntimeHost();
      const { app, run } = await startRunningRun(host);
      if (terminalStatus === "succeeded") {
        app.recordRunSucceeded(run.id);
      } else if (terminalStatus === "failed") {
        app.recordRunFailed(run.id);
      } else {
        recordRunTimedOut(app.ctx, run.id);
      }
      const before = { ...run };

      await expect(
        app.cancelRun({
          operationId: `op_cancel_${terminalStatus}`,
          idempotencyKey: `cancel_${terminalStatus}`,
          runId: run.id,
        }),
      ).rejects.toMatchObject({
        code: "invalid_transition",
        retryable: false,
        details: { entity: "run", id: run.id, from: terminalStatus, command: "cancel" },
      });

      expect(run).toEqual(before);
      expect(host.cancelCalls).toEqual([]);
    },
  );

  it("treats cancellation of an already cancelled run as idempotent", async () => {
    const host = new RecordingRuntimeHost();
    const { app, run } = await startRunningRun(host);
    const first = await app.cancelRun({
      operationId: "op_cancel_first",
      idempotencyKey: "cancel_first",
      runId: run.id,
    });
    settleRunCancel(app.ctx, run.id);
    const before = { ...run };

    const repeated = await app.cancelRun({
      operationId: "op_cancel_repeated",
      idempotencyKey: "cancel_repeated",
      runId: run.id,
    });

    expect(repeated).toEqual({
      accepted: true,
      status: "cancelled",
      cancelRequestedAt: first.cancelRequestedAt,
    });
    expect(run).toEqual(before);
    expect(host.cancelCalls).toEqual([{ handleId: run.handleId, reason: "user_cancel" }]);
  });

  it("records a real no-op acceptance for a legacy cancelled run without a timestamp", async () => {
    const host = new RecordingRuntimeHost();
    const { app, run } = await startRunningRun(host);
    await app.cancelRun({
      operationId: "op_cancel_legacy_setup",
      idempotencyKey: "cancel_legacy_setup",
      runId: run.id,
    });
    settleRunCancel(app.ctx, run.id);
    delete run.cancelRequestedAt;
    const revision = run.stateRevision;
    app.world.clock.advance(1_000);
    const acceptedAt = app.world.nowIso();

    const accepted = await app.cancelRun({
      operationId: "op_cancel_legacy",
      idempotencyKey: "cancel_legacy",
      runId: run.id,
    });

    expect(accepted).toEqual({
      accepted: true,
      status: "cancelled",
      cancelRequestedAt: acceptedAt,
    });
    expect(run).toMatchObject({
      status: "cancelled",
      cancelRequestedAt: acceptedAt,
      updatedAt: acceptedAt,
      stateRevision: revision + 1,
    });
    expect(host.cancelCalls).toHaveLength(1);

    const beforeRepeat = { ...run };
    app.world.clock.advance(1_000);
    const repeated = await app.cancelRun({
      operationId: "op_cancel_legacy_again",
      idempotencyKey: "cancel_legacy_again",
      runId: run.id,
    });
    expect(repeated).toEqual(accepted);
    expect(run).toEqual(beforeRepeat);
    expect(host.cancelCalls).toHaveLength(1);
  });

  it("rejects a new cancel after a requested cancellation loses the terminal race", async () => {
    const host = new RecordingRuntimeHost();
    const { app, run } = await startRunningRun(host);
    await app.cancelRun({
      operationId: "op_cancel_before_success",
      idempotencyKey: "cancel_before_success",
      runId: run.id,
    });
    app.recordRunSucceeded(run.id);
    const before = { ...run };

    await expect(
      app.cancelRun({
        operationId: "op_cancel_after_success",
        idempotencyKey: "cancel_after_success",
        runId: run.id,
      }),
    ).rejects.toMatchObject({
      code: "invalid_transition",
      details: { from: "succeeded", command: "cancel" },
    });
    expect(run).toEqual(before);
    expect(host.cancelCalls).toHaveLength(1);
  });

  it.each(["same", "new"] as const)(
    "keeps a failed Host cancellation retryable for a %s command",
    async (retryKind) => {
      const host = new RecordingRuntimeHost();
      host.cancelFailuresRemaining = 1;
      const { app, run } = await startRunningRun(host);
      const before = { ...run };
      const command = {
        operationId: "op_cancel_retry",
        idempotencyKey: "cancel_retry",
        runId: run.id,
      };

      await expect(app.cancelRun(command)).rejects.toThrow("runtime cancel transport failed");
      expect(run).toEqual(before);

      const retried = await app.cancelRun(
        retryKind === "same"
          ? command
          : {
              operationId: "op_cancel_retry_new",
              idempotencyKey: "cancel_retry_new",
              runId: run.id,
            },
      );
      expect(retried).toMatchObject({ accepted: true, status: "running" });
      expect(run.cancelRequestedAt).toBe(retried.cancelRequestedAt);
      expect(run.stateRevision).toBe(before.stateRevision + 1);
      expect(host.cancelCalls).toHaveLength(2);

      await app.cancelRun({
        operationId: "op_cancel_after_success",
        idempotencyKey: "cancel_after_success",
        runId: run.id,
      });
      expect(host.cancelCalls).toHaveLength(2);
      expect(run.stateRevision).toBe(before.stateRevision + 1);
    },
  );

  it("does not record cancellation when Host declines it", async () => {
    const host = new RecordingRuntimeHost();
    host.acceptCancellation = false;
    const { app, run } = await startRunningRun(host);
    const before = { ...run };

    await expect(
      app.cancelRun({
        operationId: "op_cancel_declined",
        idempotencyKey: "cancel_declined",
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: "conflict", retryable: true });
    expect(run).toEqual(before);
    expect(host.cancelCalls).toHaveLength(1);
  });

  it("records a no-handle cancellation locally without calling Host", async () => {
    const host = new RecordingRuntimeHost();
    const { app, run } = await startRunningRun(host);
    delete run.handleId;
    const revision = run.stateRevision;

    const accepted = await app.cancelRun({
      operationId: "op_cancel_no_handle",
      idempotencyKey: "cancel_no_handle",
      runId: run.id,
    });

    expect(accepted).toMatchObject({ accepted: true, status: "running" });
    expect(run.cancelRequestedAt).toBe(accepted.cancelRequestedAt);
    expect(run.stateRevision).toBe(revision + 1);
    expect(host.cancelCalls).toEqual([]);

    const repeated = await app.cancelRun({
      operationId: "op_cancel_no_handle_again",
      idempotencyKey: "cancel_no_handle_again",
      runId: run.id,
    });
    expect(repeated.cancelRequestedAt).toBe(accepted.cancelRequestedAt);
    expect(run.stateRevision).toBe(revision + 1);
    expect(host.cancelCalls).toEqual([]);
  });
});

describe("run pause on Mock", () => {
  it("returns unsupported_capability and does not fake paused", async () => {
    const app = createWorkforceApp({ engine: engine() });
    const created = await app.createProject({
      operationId: "op_c",
      idempotencyKey: "c",
      organizationId: "org",
      name: "n",
      objective: "o",
    });
    const planning = await app.startPlanning({
      operationId: "op_p",
      idempotencyKey: "p",
      projectId: created.project.id,
      workspaceId: "wsp",
      teamVersionId: "tmv",
      runtimeId: "mock",
      budgetId: "bdg",
      executionNodeId: "ndl_local",
      runtimeInstallationId: "rtm",
      workspaceInstanceId: "wsi",
      planDigest: "d",
    });
    await app.confirmPlan({
      operationId: "op_cf",
      idempotencyKey: "cf",
      projectId: created.project.id,
      approvalId: planning.approvalId,
      graph: {
        id: "wfv",
        workflowId: "wf",
        version: 1,
        entryNodeIds: ["solo"],
        nodes: [{ id: "solo", kind: "task", role: "developer", expectedOutputIds: ["out"] }],
        edges: [],
      },
    });
    await app.start({
      operationId: "op_s",
      idempotencyKey: "s",
      projectId: created.project.id,
    });
    const task = [...app.world.tasks.values()][0];
    if (!task) {
      throw new Error("missing task");
    }
    const started = await app.startRun({ operationId: "op_r", taskId: task.id });
    await expect(app.pauseRun(started.run.id)).rejects.toBeInstanceOf(UseCaseError);
    await expect(app.pauseRun(started.run.id)).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    expect(app.world.runs.get(started.run.id)?.status).toBe("running");
  });
});

describe("run placement and start boundary", () => {
  it("persists an immutable RunExecutionSnapshot and lease before Runtime start", async () => {
    const host = new FakeRuntimeHost();
    const { app, run } = await startRunningRun(host);
    expect(run.executionSnapshot?.placementSnapshot.executionLeaseId).toMatch(/^lse_/);
    expect(run.executionSnapshot?.placementSnapshot.fencingToken).toBe(1);
    expect(run.executionSnapshot?.transport).toBe("sdk");
    expect([...app.world.executionLeases.values()]).toHaveLength(1);
    expect(host.started.get("op_run")?.executionLease?.id).toBe(
      run.executionSnapshot?.placementSnapshot.executionLeaseId,
    );
    expect(app.world.projects.get(run.projectId)?.placementIntent).toEqual({ mode: "local_only" });
  });

  it("retries Runtime start without creating a second Run after a failed spawn", async () => {
    const host = new FlakyStartHost();
    const app = createWorkforceApp({ engine: engine(), host });
    const created = await app.createProject({
      operationId: "op_create",
      idempotencyKey: "create",
      organizationId: "org",
      name: "n",
      objective: "o",
    });
    const planning = await app.startPlanning({
      operationId: "op_plan",
      idempotencyKey: "plan",
      projectId: created.project.id,
      workspaceId: "wsp",
      teamVersionId: "tmv",
      runtimeId: "mock",
      budgetId: "bdg",
      executionNodeId: "ndl_local",
      runtimeInstallationId: "rtm",
      workspaceInstanceId: "wsi",
      planDigest: "digest",
    });
    await app.confirmPlan({
      operationId: "op_confirm",
      idempotencyKey: "confirm",
      projectId: created.project.id,
      approvalId: planning.approvalId,
      graph: {
        id: "wfv",
        workflowId: "wf",
        version: 1,
        entryNodeIds: ["solo"],
        nodes: [{ id: "solo", kind: "task", role: "developer", expectedOutputIds: ["out"] }],
        edges: [],
      },
    });
    await app.start({
      operationId: "op_start",
      idempotencyKey: "start",
      projectId: created.project.id,
    });
    const task = [...app.world.tasks.values()][0];
    if (!task) {
      throw new Error("missing task");
    }
    await expect(app.startRun({ operationId: "op_run", taskId: task.id })).rejects.toThrow(
      "runtime unavailable",
    );
    expect([...app.world.runs.values()]).toHaveLength(1);
    expect([...app.world.runs.values()][0]?.handleId).toBeUndefined();
    const retried = await app.startRun({ operationId: "op_run", taskId: task.id });
    expect(retried.reused).toBe(true);
    expect(retried.run.handleId).toBe("hdl_op_run");
    expect([...app.world.runs.values()]).toHaveLength(1);
    expect(host.starts).toBe(2);
  });
});
