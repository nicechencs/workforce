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
import type { RuntimeHostPort, StartRunHostRequest } from "../runs/host.js";
import { recordRunTimedOut, settleRunCancel } from "../runs/runs.js";

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

class InspectingRuntimeHost implements RuntimeHostPort {
  readonly inspectCalls: string[] = [];

  constructor(private readonly inspections: (string | Error)[]) {}

  async start(request: StartRunHostRequest): Promise<{ handleId: string; runId: string }> {
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

  async inspect(handleId: string): Promise<{ status: string }> {
    this.inspectCalls.push(handleId);
    const inspection = this.inspections.shift() ?? "unknown";
    if (inspection instanceof Error) {
      throw inspection;
    }
    return { status: inspection };
  }
}

async function startRunningRun(host: RuntimeHostPort = new InspectingRuntimeHost([])) {
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
  const started = await app.startRun({ operationId: "op_run", taskId: task.id });
  return { app, project: created.project, task, run: started.run };
}

describe("recovery", () => {
  it("does not start a new run for an unknown process", async () => {
    const { app, project, task, run } = await startRunningRun();
    app.markRunUnknown(run.id);
    const result = await app.reconcile(project.id);
    expect(result.unknown).toEqual([run.id]);
    expect(app.world.runs.size).toBe(1);
    expect(app.world.activeRunForTask(task.id)?.id).toBe(run.id);
  });

  it("settles cancellation only after Host confirms cancelled", async () => {
    const host = new InspectingRuntimeHost(["cancelled"]);
    const { app, project, run } = await startRunningRun(host);
    await app.cancelRun({
      operationId: "op_cancel",
      idempotencyKey: "cancel",
      runId: run.id,
    });
    const revision = run.stateRevision;

    const result = await app.reconcile(project.id);

    expect(result).toMatchObject({ attached: true, unknown: [], cancelled: [run.id] });
    expect(run.status).toBe("cancelled");
    expect(run.stateRevision).toBe(revision + 1);
    expect(app.world.unknownStatuses.has(run.id)).toBe(false);
    expect(host.inspectCalls).toEqual([run.handleId]);
  });

  it.each(["running", "starting", "waiting_input", "paused"])(
    "keeps cancellation pending without marking known Host status %s unknown",
    async (inspection) => {
      const host = new InspectingRuntimeHost([inspection]);
      const { app, project, task, run } = await startRunningRun(host);
      const cancellation = await app.cancelRun({
        operationId: `op_cancel_${inspection}`,
        idempotencyKey: `cancel_${inspection}`,
        runId: run.id,
      });
      const revision = run.stateRevision;
      app.markRunUnknown(run.id);

      const result = await app.reconcile(project.id);

      expect(result).toMatchObject({ attached: true, unknown: [], cancelled: [] });
      expect(run).toMatchObject({
        status: "running",
        cancelRequestedAt: cancellation.cancelRequestedAt,
        stateRevision: revision,
      });
      expect(app.world.unknownStatuses.has(run.id)).toBe(false);

      const repeatedStart = await app.startRun({ operationId: "op_duplicate", taskId: task.id });
      expect(repeatedStart.run.id).toBe(run.id);
      expect(app.world.runs.size).toBe(1);
    },
  );

  it.each(["unknown", "orphaned"])(
    "keeps cancellation pending when Host inspection returns %s",
    async (inspection) => {
      const host = new InspectingRuntimeHost([inspection]);
      const { app, project, run } = await startRunningRun(host);
      const cancellation = await app.cancelRun({
        operationId: `op_cancel_${inspection}`,
        idempotencyKey: `cancel_${inspection}`,
        runId: run.id,
      });
      const revision = run.stateRevision;

      const result = await app.reconcile(project.id);

      expect(result).toMatchObject({ attached: false, unknown: [run.id], cancelled: [] });
      expect(run).toMatchObject({
        status: "running",
        cancelRequestedAt: cancellation.cancelRequestedAt,
        stateRevision: revision,
      });
      expect(app.world.unknownStatuses.has(run.id)).toBe(true);
    },
  );

  it.each(["succeeded", "failed"])(
    "does not expand recovery mapping for Host terminal status %s",
    async (inspection) => {
      const host = new InspectingRuntimeHost([inspection]);
      const { app, project, run } = await startRunningRun(host);
      const cancellation = await app.cancelRun({
        operationId: `op_cancel_runtime_${inspection}`,
        idempotencyKey: `cancel_runtime_${inspection}`,
        runId: run.id,
      });
      const revision = run.stateRevision;
      app.markRunUnknown(run.id);

      const result = await app.reconcile(project.id);

      expect(result).toMatchObject({ attached: true, unknown: [], cancelled: [] });
      expect(run).toMatchObject({
        status: "running",
        cancelRequestedAt: cancellation.cancelRequestedAt,
        stateRevision: revision,
      });
      expect(app.world.unknownStatuses.has(run.id)).toBe(false);
    },
  );

  it("keeps cancellation pending when Host inspection throws", async () => {
    const host = new InspectingRuntimeHost([new Error("inspect unavailable")]);
    const { app, project, run } = await startRunningRun(host);
    const cancellation = await app.cancelRun({
      operationId: "op_cancel_inspect_error",
      idempotencyKey: "cancel_inspect_error",
      runId: run.id,
    });
    const revision = run.stateRevision;

    const result = await app.reconcile(project.id);

    expect(result).toMatchObject({ attached: false, unknown: [run.id], cancelled: [] });
    expect(run).toMatchObject({
      status: "running",
      cancelRequestedAt: cancellation.cancelRequestedAt,
      stateRevision: revision,
    });
    expect(app.world.unknownStatuses.has(run.id)).toBe(true);
  });

  it("re-inspects an unknown cancel-pending Run and settles it when later confirmed", async () => {
    const host = new InspectingRuntimeHost(["unknown", "cancelled"]);
    const { app, project, run } = await startRunningRun(host);
    await app.cancelRun({
      operationId: "op_cancel_later",
      idempotencyKey: "cancel_later",
      runId: run.id,
    });

    const first = await app.reconcile(project.id);
    expect(first).toMatchObject({ attached: false, unknown: [run.id], cancelled: [] });
    expect(app.world.unknownStatuses.has(run.id)).toBe(true);

    const second = await app.reconcile(project.id);
    expect(second).toMatchObject({ attached: true, unknown: [], cancelled: [run.id] });
    expect(run.status).toBe("cancelled");
    expect(app.world.unknownStatuses.has(run.id)).toBe(false);
    expect(host.inspectCalls).toEqual([run.handleId, run.handleId]);
  });

  it("recovers a confirmed cancellation when the request timestamp was not persisted", async () => {
    const host = new InspectingRuntimeHost(["cancelled"]);
    const { app, project, run } = await startRunningRun(host);
    const revision = run.stateRevision;
    app.world.clock.advance(1_000);
    const recoveredAt = app.world.nowIso();

    const result = await app.reconcile(project.id);

    expect(result).toMatchObject({ attached: true, unknown: [], cancelled: [run.id] });
    expect(run).toMatchObject({
      status: "cancelled",
      cancelRequestedAt: recoveredAt,
      updatedAt: recoveredAt,
      stateRevision: revision + 1,
    });
    expect(app.world.unknownStatuses.has(run.id)).toBe(false);
    expect(host.inspectCalls).toEqual([run.handleId]);
  });

  it.each(["succeeded", "failed", "timed_out", "cancelled"] as const)(
    "skips terminal lost-race Run %s and clears stale unknown state",
    async (terminalStatus) => {
      const host = new InspectingRuntimeHost(["cancelled"]);
      const { app, project, run } = await startRunningRun(host);
      await app.cancelRun({
        operationId: `op_cancel_before_${terminalStatus}`,
        idempotencyKey: `cancel_before_${terminalStatus}`,
        runId: run.id,
      });
      if (terminalStatus === "succeeded") {
        app.recordRunSucceeded(run.id);
      } else if (terminalStatus === "failed") {
        app.recordRunFailed(run.id);
      } else if (terminalStatus === "timed_out") {
        recordRunTimedOut(app.ctx, run.id);
      } else {
        settleRunCancel(app.ctx, run.id);
        delete run.cancelRequestedAt;
      }
      app.markRunUnknown(run.id);
      const before = { ...run };

      const result = await app.reconcile(project.id);

      expect(result).toMatchObject({ attached: true, unknown: [], cancelled: [] });
      expect(run).toEqual(before);
      expect(app.world.unknownStatuses.has(run.id)).toBe(false);
      expect(host.inspectCalls).toEqual([]);
    },
  );

  it("marks a no-handle cancellation unknown instead of settling it", async () => {
    const host = new InspectingRuntimeHost([]);
    const { app, project, run } = await startRunningRun(host);
    delete run.handleId;
    const cancellation = await app.cancelRun({
      operationId: "op_cancel_no_handle",
      idempotencyKey: "cancel_no_handle",
      runId: run.id,
    });
    const revision = run.stateRevision;

    const result = await app.reconcile(project.id);

    expect(result).toMatchObject({ attached: false, unknown: [run.id], cancelled: [] });
    expect(run).toMatchObject({
      status: "running",
      cancelRequestedAt: cancellation.cancelRequestedAt,
      stateRevision: revision,
    });
    expect(app.world.unknownStatuses.has(run.id)).toBe(true);
    expect(host.inspectCalls).toEqual([]);
  });
});
