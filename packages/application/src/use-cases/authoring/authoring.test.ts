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

const engine: EnginePort = {
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

describe("applyAuthoringChangeSet", () => {
  it("creates a governed authoring Task/Run and converts only structured Proposal output", async () => {
    const app = createWorkforceApp({ engine });
    const created = await app.createProject({
      operationId: "op_create",
      idempotencyKey: "create",
      organizationId: "org_authoring",
      name: "Authoring project",
      objective: "draft a workflow",
    });
    Object.assign(app.world.projects.get(created.project.id)!, {
      runtimeId: "mock",
      executionNodeId: "node_local",
      runtimeInstallationId: "runtime_mock",
      workspaceInstanceId: "workspace_authoring",
    });

    const started = await app.startAuthoring({
      operationId: "op_authoring",
      idempotencyKey: "authoring",
      projectId: created.project.id,
      intent: "build a private proposal that must not be persisted as event data",
    });
    expect(started.reused).toBe(false);
    expect(app.world.tasks.get(started.taskId)).toMatchObject({ title: "Authoring proposal" });
    expect(app.world.runs.get(started.runId)?.taskId).toBe(started.taskId);
    const startedRequest = [
      ...(app.ctx.host as { started: Map<string, { snapshotRef: string }> }).started.values(),
    ][0];
    expect(startedRequest?.snapshotRef).toBe("authoring:proposal");
    expect(JSON.stringify(app.world.events.events)).not.toContain("private proposal");

    const proposal = {
      id: "apr_1",
      projectId: created.project.id,
      sourceRunId: started.runId,
      summary: "Create a workflow draft",
      targets: [
        {
          targetType: "workflow" as const,
          targetId: "wf_authoring",
          expectedRevision: 1,
          patchRef: "arv_workflow_patch",
        },
      ],
    };
    const proposed = await app.recordAuthoringProposal({
      operationId: "op_proposal",
      idempotencyKey: "proposal",
      proposal,
    });
    expect(proposed.changeSet).toMatchObject({
      status: "proposed",
      proposalRef: proposal.id,
      sourceRunId: started.runId,
      steps: [{ targetId: "wf_authoring", status: "pending" }],
    });
    const validating = await app.validateAuthoringChangeSet({
      operationId: "op_validate",
      idempotencyKey: "validate",
      changeSetId: proposed.changeSet.id,
    });
    expect(validating.changeSet.status).toBe("validating");
    await expect(
      app.recordAuthoringProposal({
        operationId: "op_proposal",
        idempotencyKey: "proposal",
        proposal,
      }),
    ).resolves.toMatchObject({ reused: true, changeSet: { id: proposed.changeSet.id } });
  });

  it("atomically advances validated Workflow and Team drafts without publishing or starting a graph", async () => {
    const app = createWorkforceApp({ engine });
    const created = await app.createProject({
      operationId: "op_create",
      idempotencyKey: "create",
      organizationId: "org_authoring",
      name: "Authoring project",
      objective: "draft a workflow",
    });
    app.world.runs.set("run_authoring", {
      id: "run_authoring",
      taskId: "tsk_authoring",
      projectId: created.project.id,
      status: "succeeded",
      stateRevision: 1,
      attempt: 1,
      generation: 1,
      definitionRevision: 1,
      operationId: "op_authoring",
      createdAt: "2026-09-12T10:00:00.000Z",
      updatedAt: "2026-09-12T10:00:00.000Z",
    });
    app.world.workflowDrafts.set("wfd_base", {
      id: "wfd_base",
      workflowId: "wf_authoring",
      revision: 1,
      status: "draft",
      graph: {
        entryNodeIds: ["node_base"],
        nodes: [{ id: "node_base", kind: "task", role: "developer" }],
        edges: [],
        failurePolicy: { default: "fail" },
        concurrencyPolicy: { runWorktree: "isolated", integrationWorktree: "dedicated" },
      },
      contentHash: "sha256:wfd_base",
      updatedAt: "2026-09-12T10:00:00.000Z",
      updatedBy: "usr_author",
    });
    app.world.teamDrafts.set("tmd_base", {
      id: "tmd_base",
      teamId: "team_authoring",
      revision: 1,
      status: "draft",
      members: [{ role: "developer", runtimeProfileId: "rp_authoring", quantity: 1 }],
      contentHash: "sha256:tmd_base",
      updatedAt: "2026-09-12T10:00:00.000Z",
      updatedBy: "usr_author",
    });
    const input = {
      operationId: "op_apply",
      idempotencyKey: "apply",
      changeSet: {
        id: "acs_1",
        organizationId: created.project.organizationId,
        projectId: created.project.id,
        sourceRunId: "run_authoring",
        status: "validating" as const,
        proposalRef: "arv_proposal",
        steps: [
          {
            id: "acst_workflow",
            ordinal: 1,
            targetType: "workflow" as const,
            targetId: "wf_authoring",
            expectedRevision: 1,
            status: "pending" as const,
            patchRef: "arv_workflow_patch",
          },
          {
            id: "acst_team",
            ordinal: 2,
            targetType: "team" as const,
            targetId: "team_authoring",
            expectedRevision: 1,
            status: "pending" as const,
            patchRef: "arv_team_patch",
          },
        ],
        createdAt: "2026-09-12T10:00:00.000Z",
        updatedAt: "2026-09-12T10:00:00.000Z",
      },
      workflowDrafts: [
        {
          id: "wfd_1",
          workflowId: "wf_authoring",
          revision: 2,
          status: "draft" as const,
          graph: {
            entryNodeIds: ["node_1"],
            nodes: [{ id: "node_1", kind: "task" as const, role: "developer" as const }],
            edges: [],
            failurePolicy: { default: "fail" as const },
            concurrencyPolicy: {
              runWorktree: "isolated" as const,
              integrationWorktree: "dedicated" as const,
            },
          },
          contentHash: "sha256:wfd_1",
          updatedAt: "2026-09-12T10:00:00.000Z",
          updatedBy: "usr_author",
        },
      ],
      teamDrafts: [
        {
          id: "tmd_1",
          teamId: "team_authoring",
          revision: 2,
          status: "draft" as const,
          members: [{ role: "developer", runtimeProfileId: "rp_authoring", quantity: 1 }],
          contentHash: "sha256:tmd_1",
          updatedAt: "2026-09-12T10:00:00.000Z",
          updatedBy: "usr_author",
        },
      ],
    };
    app.world.authoringChangeSets.set(input.changeSet.id, input.changeSet);

    const applied = await app.applyAuthoringChangeSet(input);
    expect(applied).toMatchObject({
      reused: false,
      changeSet: { status: "applied", steps: [{ resultRevision: 2 }, { resultRevision: 2 }] },
    });
    expect(app.world.workflowDrafts.get("wfd_1")?.status).toBe("draft");
    expect(app.world.teamDrafts.get("tmd_1")?.status).toBe("draft");
    expect(app.world.workflows).toHaveLength(0);
    expect(app.world.events.events.at(-1)?.type).toBe("workflow.authoring.applied");
    await expect(app.applyAuthoringChangeSet(input)).resolves.toMatchObject({ reused: true });
  });

  it("rejects unimplemented task patches before writing a partial authoring result", async () => {
    const app = createWorkforceApp({ engine });
    const created = await app.createProject({
      operationId: "op_create",
      idempotencyKey: "create",
      organizationId: "org_authoring",
      name: "Authoring project",
      objective: "draft a workflow",
    });
    app.world.runs.set("run_authoring", {
      id: "run_authoring",
      taskId: "tsk_authoring",
      projectId: created.project.id,
      status: "succeeded",
      stateRevision: 1,
      attempt: 1,
      generation: 1,
      definitionRevision: 1,
      operationId: "op_authoring",
      createdAt: "2026-09-12T10:00:00.000Z",
      updatedAt: "2026-09-12T10:00:00.000Z",
    });
    const taskPatchInput = {
      operationId: "op_task_patch",
      idempotencyKey: "task-patch",
      changeSet: {
        id: "acs_task",
        organizationId: created.project.organizationId,
        projectId: created.project.id,
        sourceRunId: "run_authoring",
        status: "validating" as const,
        proposalRef: "arv_proposal",
        steps: [
          {
            id: "acst_task",
            ordinal: 1,
            targetType: "task" as const,
            targetId: "tsk_authoring",
            expectedRevision: 1,
            status: "pending" as const,
            patchRef: "arv_task_patch",
          },
        ],
        createdAt: "2026-09-12T10:00:00.000Z",
        updatedAt: "2026-09-12T10:00:00.000Z",
      },
    };
    app.world.authoringChangeSets.set(taskPatchInput.changeSet.id, taskPatchInput.changeSet);
    await expect(app.applyAuthoringChangeSet(taskPatchInput)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(app.world.authoringChangeSets.get(taskPatchInput.changeSet.id)).toEqual(
      taskPatchInput.changeSet,
    );
    expect(app.world.workflowDrafts).toHaveLength(0);
  });
});
