import { describe, expect, it } from "vitest";

import {
  decideRecovery,
  InvalidTransitionError,
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

import { UseCaseError } from "./errors.js";
import type { EnginePort, WorkflowGraph } from "./engine-port.js";
import { createWorkforceApp } from "./service.js";
import type { TaskRecord } from "./store.js";

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

function m3Graph(): WorkflowGraph {
  return {
    id: "wfv_m3",
    workflowId: "wf_feature",
    version: 1,
    entryNodeIds: ["dev_a"],
    terminalNodeIds: ["review"],
    nodes: [
      {
        id: "dev_a",
        kind: "task",
        role: "developer",
        requiresReview: true,
        expectedOutputIds: ["code_a"],
        maxAttempts: 2,
        maxReworkCycles: 1,
        priority: 80,
      },
      {
        id: "dev_b",
        kind: "task",
        role: "developer",
        expectedOutputIds: ["code_b"],
        joinPolicy: "all_success",
        maxAttempts: 2,
        maxReworkCycles: 1,
        priority: 50,
      },
      {
        id: "review",
        kind: "task",
        role: "reviewer",
        requiresReview: true,
        joinPolicy: "all_success",
        maxAttempts: 1,
        maxReworkCycles: 1,
        priority: 10,
      },
    ],
    edges: [
      { id: "e1", from: "dev_a", to: "dev_b", waitFor: "outputs_ready" },
      { id: "e2", from: "dev_a", to: "review", waitFor: "outputs_ready" },
      { id: "e3", from: "dev_b", to: "review", waitFor: "outputs_ready" },
    ],
  };
}

function taskByNode(tasks: Iterable<TaskRecord>, nodeId: string): TaskRecord {
  const task = [...tasks].find((item) => item.workflowNodeId === nodeId);
  if (!task) {
    throw new Error(`missing task for node ${nodeId}`);
  }
  return task;
}

describe("M3 workflow path", () => {
  it("walks draft → planning → ready → DAG → review → project completed", async () => {
    const app = createWorkforceApp({ engine: engine() });

    const created = await app.createProject({
      operationId: "op_create",
      idempotencyKey: "create-1",
      organizationId: "org_local",
      name: "Mock feature",
      objective: "ship a patch",
    });
    expect(created.project.status).toBe("draft");

    const planning = await app.startPlanning({
      operationId: "op_plan",
      idempotencyKey: "plan-1",
      projectId: created.project.id,
      expectedStateRevision: created.project.stateRevision,
      workspaceId: "wsp_1",
      teamVersionId: "tmv_1",
      runtimeId: "mock",
      budgetId: "bdg_1",
      executionNodeId: "ndl_local",
      runtimeInstallationId: "rtm_mock",
      workspaceInstanceId: "wsi_1",
      planDigest: "plan-digest-1",
    });
    expect(planning.project.status).toBe("planning");

    const confirmed = await app.confirmPlan({
      operationId: "op_confirm",
      idempotencyKey: "confirm-1",
      projectId: created.project.id,
      approvalId: planning.approvalId,
      expectedStateRevision: planning.project.stateRevision,
      graph: m3Graph(),
    });
    expect(confirmed.project.status).toBe("ready");
    expect(app.world.approvals.get(planning.approvalId)?.status).toBe("consumed");

    const started = await app.start({
      operationId: "op_start",
      idempotencyKey: "start-1",
      projectId: created.project.id,
      expectedStateRevision: confirmed.project.stateRevision,
    });
    expect(started.project.status).toBe("running");

    const replayStart = await app.start({
      operationId: "op_start",
      idempotencyKey: "start-1",
      projectId: created.project.id,
    });
    expect(replayStart.reused).toBe(true);
    expect([...app.world.workflows.values()]).toHaveLength(1);

    const devA = taskByNode(app.world.tasks.values(), "dev_a");
    const devB = taskByNode(app.world.tasks.values(), "dev_b");
    const review = taskByNode(app.world.tasks.values(), "review");
    expect(devA.status).toBe("ready");
    expect(devB.status).toBe("blocked");
    expect(devB.dependsOn[0]?.waitFor).toBe("outputs_ready");

    const runA = await app.startRun({ operationId: "op_run_a", taskId: devA.id });
    const succeededA = app.recordRunSucceeded(runA.run.id);
    expect(succeededA.status).toBe("succeeded");
    expect(app.world.tasks.get(devA.id)?.status).toBe("running");

    const artifactA = "arv_code_a";
    app.bindTaskOutput({
      taskId: devA.id,
      slotId: "code_a",
      artifactVersionId: artifactA,
      digest: "sha-a",
    });
    expect(app.world.tasks.get(devA.id)?.status).toBe("waiting_review");
    expect(app.world.tasks.get(devB.id)?.status).toBe("ready");

    const runB = await app.startRun({ operationId: "op_run_b", taskId: devB.id });
    app.recordRunSucceeded(runB.run.id);
    app.bindTaskOutput({
      taskId: devB.id,
      slotId: "code_b",
      artifactVersionId: "arv_code_b",
      digest: "sha-b",
    });
    expect(app.world.tasks.get(devB.id)?.status).toBe("completed");
    expect(app.world.tasks.get(devA.id)?.status).toBe("waiting_review");
    expect(app.world.tasks.get(review.id)?.status).toBe("ready");
    expect(app.world.tasks.get(review.id)?.inputArtifactVersionIds).toContain(artifactA);

    const runR = await app.startRun({ operationId: "op_run_r", taskId: review.id });
    app.recordRunSucceeded(runR.run.id);
    app.bindTaskOutput({
      taskId: review.id,
      slotId: "eval",
      artifactVersionId: "arv_eval",
      digest: "sha-r",
    });
    expect(app.world.tasks.get(review.id)?.status).toBe("waiting_review");

    const artifactApproval = await app.createApproval({
      projectId: created.project.id,
      gate: "artifact",
      actionDigest: "sha-a",
      resource: `artifactVersion:${artifactA}`,
      artifactVersionId: artifactA,
      taskId: review.id,
    });
    const approved = await app.decideApproval({
      operationId: "op_approve_art",
      idempotencyKey: "approve-art-1",
      approvalId: artifactApproval.id,
      decision: "approve",
      actionDigest: "sha-a",
    });
    expect(approved.approval.status).toBe("consumed");
    const replayApprove = await app.decideApproval({
      operationId: "op_approve_art",
      idempotencyKey: "approve-art-1",
      approvalId: artifactApproval.id,
      decision: "approve",
      actionDigest: "sha-a",
    });
    expect(replayApprove.reused).toBe(true);

    expect(app.world.tasks.get(devA.id)?.status).toBe("completed");
    expect(app.world.tasks.get(review.id)?.status).toBe("completed");
    expect(app.world.projects.get(created.project.id)?.status).toBe("completed");
  });

  it("throws InvalidTransitionError on illegal commands", async () => {
    const app = createWorkforceApp({ engine: engine() });
    const created = await app.createProject({
      operationId: "op_c",
      idempotencyKey: "c",
      organizationId: "org_local",
      name: "x",
      objective: "y",
    });
    await expect(app.pauseProject({ projectId: created.project.id })).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    await expect(
      app.start({
        operationId: "op_early",
        idempotencyKey: "early",
        projectId: created.project.id,
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("rejects a reviewer ↔ developer completed cycle at plan confirm", async () => {
    const app = createWorkforceApp({ engine: engine() });
    const created = await app.createProject({
      operationId: "op_c2",
      idempotencyKey: "c2",
      organizationId: "org_local",
      name: "x",
      objective: "y",
    });
    const planning = await app.startPlanning({
      operationId: "op_p2",
      idempotencyKey: "p2",
      projectId: created.project.id,
      workspaceId: "wsp_1",
      teamVersionId: "tmv_1",
      runtimeId: "mock",
      budgetId: "bdg_1",
      executionNodeId: "ndl_local",
      runtimeInstallationId: "rtm_mock",
      workspaceInstanceId: "wsi_1",
      planDigest: "plan",
    });
    const graph = m3Graph();
    const cyclic: WorkflowGraph = {
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === "e2" ? { ...edge, waitFor: "completed" } : edge,
      ),
    };
    await expect(
      app.confirmPlan({
        operationId: "op_bad",
        idempotencyKey: "bad",
        projectId: created.project.id,
        approvalId: planning.approvalId,
        graph: cyclic,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("accepts cancel without immediately marking cancelled", async () => {
    const app = createWorkforceApp({ engine: engine() });
    const created = await app.createProject({
      operationId: "op_c3",
      idempotencyKey: "c3",
      organizationId: "org_local",
      name: "x",
      objective: "y",
    });
    const planning = await app.startPlanning({
      operationId: "op_p3",
      idempotencyKey: "p3",
      projectId: created.project.id,
      workspaceId: "wsp_1",
      teamVersionId: "tmv_1",
      runtimeId: "mock",
      budgetId: "bdg_1",
      executionNodeId: "ndl_local",
      runtimeInstallationId: "rtm_mock",
      workspaceInstanceId: "wsi_1",
      planDigest: "plan",
    });
    await app.confirmPlan({
      operationId: "op_cf3",
      idempotencyKey: "cf3",
      projectId: created.project.id,
      approvalId: planning.approvalId,
      graph: m3Graph(),
    });
    await app.start({
      operationId: "op_s3",
      idempotencyKey: "s3",
      projectId: created.project.id,
    });
    const devA = taskByNode(app.world.tasks.values(), "dev_a");
    const runA = await app.startRun({ operationId: "op_r3", taskId: devA.id });
    const accepted = await app.cancelRun({
      operationId: "op_cancel_run",
      idempotencyKey: "cr",
      runId: runA.run.id,
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.status).toBe("running");
    expect(app.world.runs.get(runA.run.id)?.status).toBe("running");

    const projectCancel = await app.cancelProject({
      operationId: "op_cancel_prj",
      idempotencyKey: "cp",
      projectId: created.project.id,
    });
    expect(projectCancel.accepted).toBe(true);
    expect(projectCancel.status).toBe("running");
    expect(app.world.workflows.get(created.project.workflowInstanceId ?? "")?.status).toBe(
      "cancelling",
    );
  });

  it("conflicts when the same idempotency key is reused with a different payload", async () => {
    const app = createWorkforceApp({ engine: engine() });
    await app.createProject({
      operationId: "op_c4",
      idempotencyKey: "same-key",
      organizationId: "org_local",
      name: "one",
      objective: "y",
    });
    await expect(
      app.createProject({
        operationId: "op_c5",
        idempotencyKey: "same-key",
        organizationId: "org_local",
        name: "two",
        objective: "y",
      }),
    ).rejects.toBeInstanceOf(UseCaseError);
  });
});
