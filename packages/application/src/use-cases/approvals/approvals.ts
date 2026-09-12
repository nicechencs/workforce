import type { ApprovalGate } from "@workforce/domain";

import type { AppContext } from "../projects/context.js";
import { expectRevision } from "../projects/context.js";
import { notFound, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { requireProject } from "../projects/projects.js";
import { refreshDownstream, requireTask } from "../tasks/tasks.js";
import type { ApprovalRecord } from "../projects/store.js";

export async function createApproval(
  ctx: AppContext,
  input: {
    projectId: string;
    gate: ApprovalGate;
    actionDigest: string;
    resource: string;
    taskId?: string;
    artifactVersionId?: string;
  },
): Promise<ApprovalRecord> {
  const now = ctx.world.nowIso();
  const approval: ApprovalRecord = {
    id: ctx.world.ids.ulid("apr_"),
    projectId: input.projectId,
    gate: input.gate,
    status: "pending",
    stateRevision: 1,
    actionDigest: input.actionDigest,
    resource: input.resource,
    createdAt: now,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.artifactVersionId ? { artifactVersionId: input.artifactVersionId } : {}),
  };
  ctx.world.approvals.set(approval.id, approval);
  return approval;
}

export async function decideApproval(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey: string;
    approvalId: string;
    decision: "approve" | "reject" | "request-changes";
    actionDigest: string;
    expectedStateRevision?: number;
  },
): Promise<{ reused: boolean; approval: ApprovalRecord }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          approvalId: input.approvalId,
          decision: input.decision,
          actionDigest: input.actionDigest,
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: `approval.${input.decision}`,
          resource: `approval:${input.approvalId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const approval = ctx.world.approvals.get(input.approvalId);
        if (!approval) {
          throw notFound("approval", input.approvalId);
        }
        expectRevision(approval, input.expectedStateRevision);
        if (approval.actionDigest !== input.actionDigest) {
          approval.status = ctx.engine.nextApprovalStatus(approval.status, "supersede");
          approval.stateRevision += 1;
          throw validationFailed("approval digest no longer matches the frozen action");
        }
        if (input.decision === "approve") {
          const approved = ctx.engine.nextApprovalStatus(approval.status, "approve");
          approval.status = ctx.engine.nextApprovalStatus(approved, "consume");
        } else {
          approval.status = ctx.engine.nextApprovalStatus(approval.status, input.decision);
        }
        approval.stateRevision += 1;
        await appendEvent(ctx.world, tx, {
          type: "approval.decided",
          subjectType: "approval",
          subjectId: approval.id,
          projectId: approval.projectId,
          ...(approval.taskId ? { taskId: approval.taskId } : {}),
          correlationId: input.operationId,
          data: { to: approval.status, gate: approval.gate },
        });
        if (input.decision === "approve" && approval.gate === "artifact") {
          completeRelatedTasks(ctx, approval);
        }
        if (input.decision === "approve" && approval.gate === "action") {
          // Consumed above. The gated action may now proceed; it is not a Task complete.
        }
        if (input.decision === "approve" && approval.gate === "budget") {
          // Consumed above. raiseProjectBudget requires this consumed grant.
        }
        if (input.decision === "approve" && approval.gate === "plan") {
          // Consumed above. confirm-plan is the only command that advances Project.
        }
        if (input.decision === "request-changes" && approval.taskId) {
          const task = requireTask(ctx, approval.taskId);
          const decision = ctx.engine.decideRecovery({
            kind: "rework",
            attempt: task.attempt,
            maxAttempts: task.maxAttempts,
            generation: task.generation,
            maxReworkCycles: task.maxReworkCycles,
            capacityAvailable: true,
          });
          if (decision.action === "fail") {
            task.status = ctx.engine.nextTaskStatus(task.status, "reject");
          } else if (decision.action === "rework") {
            task.status = ctx.engine.nextTaskStatus(task.status, "request-changes");
            task.generation = decision.nextGeneration;
            task.definitionRevision += 1;
            task.attempt = decision.nextAttempt;
          }
        }
        return { approval };
      },
    ).then((result) => ({ reused: result.reused, approval: result.value.approval }));
  });
}

function completeRelatedTasks(ctx: AppContext, approval: ApprovalRecord): void {
  if (approval.artifactVersionId) {
    const artifact = ctx.world.artifacts.get(approval.artifactVersionId);
    if (!artifact || artifact.status !== "available") {
      return;
    }
    const failed = ctx.world
      .evaluationsForArtifact(approval.artifactVersionId)
      .some((evaluation) => evaluation.verdict === "fail");
    if (failed) {
      return;
    }
  }
  const related = ctx.world.tasksForProject(approval.projectId).filter((task) => {
    if (task.status !== "waiting_review") {
      return false;
    }
    if (approval.taskId && task.id === approval.taskId) {
      return true;
    }
    if (!approval.artifactVersionId) {
      return false;
    }
    return (
      Object.values(task.outputBindings).includes(approval.artifactVersionId) ||
      task.inputArtifactVersionIds.includes(approval.artifactVersionId)
    );
  });
  for (const task of related) {
    task.status = ctx.engine.nextTaskStatus(task.status, "approve");
    task.stateRevision += 1;
    if (task.workflowInstanceId && task.workflowNodeId) {
      for (const node of ctx.world.nodes.values()) {
        if (
          node.workflowInstanceId === task.workflowInstanceId &&
          node.nodeId === task.workflowNodeId
        ) {
          node.status = ctx.engine.nextNodeStatus(node.status, "complete");
          node.stateRevision += 1;
        }
      }
    }
  }
  maybeCompleteProject(ctx, approval.projectId);
  refreshDownstream(ctx, approval.projectId);
}

export function maybeCompleteProject(ctx: AppContext, projectId: string): void {
  const project = requireProject(ctx, projectId);
  const workflow = project.workflowInstanceId
    ? ctx.world.workflows.get(project.workflowInstanceId)
    : undefined;
  if (!workflow || project.status !== "running") {
    return;
  }
  const required = ctx.world
    .tasksForProject(projectId)
    .filter(
      (task) =>
        Boolean(task.workflowInstanceId) && (task.role === "developer" || task.role === "reviewer"),
    );
  if (required.length === 0 || required.some((task) => task.status !== "completed")) {
    return;
  }
  const artifactApproved = [...ctx.world.approvals.values()].some(
    (approval) =>
      approval.projectId === projectId &&
      approval.gate === "artifact" &&
      approval.status === "consumed",
  );
  if (!artifactApproved) {
    return;
  }
  workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "complete");
  workflow.stateRevision += 1;
  project.status = ctx.engine.nextProjectStatus(project.status, "complete");
  project.stateRevision += 1;
}

export function expireDueApprovals(ctx: AppContext): void {
  const now = ctx.world.clock.now().getTime();
  for (const approval of ctx.world.approvals.values()) {
    if (approval.status !== "pending" || !approval.expiresAt) {
      continue;
    }
    if (Date.parse(approval.expiresAt) <= now) {
      approval.status = ctx.engine.nextApprovalStatus(approval.status, "expire");
      approval.stateRevision += 1;
    }
  }
}
