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

import type { EnginePort, WorkflowGraph } from "./engine-port.js";
import { createWorkforceApp } from "./service.js";
import { UseCaseError } from "./errors.js";
import { FakeRuntimeHost } from "../runs/host.js";

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

function soloGraph(): WorkflowGraph {
  return {
    id: "wfv_orch",
    workflowId: "wf_orch",
    version: 1,
    entryNodeIds: ["solo"],
    nodes: [{ id: "solo", kind: "task", role: "developer", expectedOutputIds: ["out"] }],
    edges: [],
  };
}

async function readyProject(host = new FakeRuntimeHost()) {
  const app = createWorkforceApp({ engine: engine(), host });
  const created = await app.createProject({
    operationId: "op_create",
    idempotencyKey: "create",
    organizationId: "org",
    name: "orch",
    objective: "pass-through",
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
    graph: soloGraph(),
  });
  return { app, host, projectId: created.project.id };
}

describe("orchestrationMode start pass-through", () => {
  it("records omit/workflow_bound on the project.start receipt, project, run, and host request", async () => {
    const omitted = await readyProject();
    const omittedStart = await omitted.app.start({
      operationId: "op_start_omit",
      idempotencyKey: "start-omit",
      projectId: omitted.projectId,
    });
    expect(omittedStart.project.orchestrationMode).toBe("workflow_bound");
    const omittedReceipt = await omitted.app.world.receipts.getByOperationId("op_start_omit");
    expect(omittedReceipt?.requestDigest).toContain("workflow_bound");

    const omittedTask = [...omitted.app.world.tasks.values()][0];
    expect(omittedTask).toBeDefined();
    const omittedRun = await omitted.app.startRun({
      operationId: "op_run_omit",
      taskId: omittedTask!.id,
    });
    expect(omittedRun.run.orchestrationMode).toBe("workflow_bound");
    expect(omitted.host.started.get("op_run_omit")?.orchestrationMode).toBe("workflow_bound");

    const explicit = await readyProject();
    const boundStart = await explicit.app.start({
      operationId: "op_start_bound",
      idempotencyKey: "start-bound",
      projectId: explicit.projectId,
      orchestrationMode: "workflow_bound",
    });
    expect(boundStart.project.orchestrationMode).toBe("workflow_bound");
    const boundTask = [...explicit.app.world.tasks.values()][0];
    const boundRun = await explicit.app.startRun({
      operationId: "op_run_bound",
      taskId: boundTask!.id,
    });
    expect(boundRun.run.orchestrationMode).toBe("workflow_bound");
    expect(explicit.host.started.get("op_run_bound")?.orchestrationMode).toBe("workflow_bound");
  });

  it("echoes requested direct onto run/host records without changing the published-graph start", async () => {
    const { app, host, projectId } = await readyProject();
    const started = await app.start({
      operationId: "op_start_direct",
      idempotencyKey: "start-direct",
      projectId,
      orchestrationMode: "direct",
    });
    expect(started.project.status).toBe("ready");
    expect(started.project.orchestrationMode).toBe("direct");
    expect(started.project.workflowInstanceId).toBeDefined();
    expect([...app.world.tasks.values()]).toHaveLength(1);

    const receipt = await app.world.receipts.getByOperationId("op_start_direct");
    expect(receipt?.requestDigest).toContain('"orchestrationMode":"direct"');

    const task = [...app.world.tasks.values()][0]!;
    const run = await app.startRun({ operationId: "op_run_direct", taskId: task.id });
    expect(run.run.orchestrationMode).toBe("direct");
    expect(host.started.get("op_run_direct")?.orchestrationMode).toBe("direct");
  });

  it("conflicts when the same start idempotency key is reused with a different mode", async () => {
    const { app, projectId } = await readyProject();
    await app.start({
      operationId: "op_start",
      idempotencyKey: "start-mode",
      projectId,
      orchestrationMode: "workflow_bound",
    });
    await expect(
      app.start({
        operationId: "op_start_other",
        idempotencyKey: "start-mode",
        projectId,
        orchestrationMode: "direct",
      }),
    ).rejects.toBeInstanceOf(UseCaseError);
  });
});
