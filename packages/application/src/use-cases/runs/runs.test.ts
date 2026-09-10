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
