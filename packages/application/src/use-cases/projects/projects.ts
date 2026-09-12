import {
  DEFAULT_ORCHESTRATION_MODE,
  type OrchestrationMode,
} from "@workforce/protocol";

import type { AppContext } from "./context.js";
import { expectRevision, touch } from "./context.js";
import type { WorkflowGraph } from "./engine-port.js";
import { notFound, validationFailed } from "./errors.js";
import { appendEvent } from "./events.js";
import { digestOf, withIdempotency } from "./idempotency.js";
import type { ProjectRecord, WorkflowInstanceRecord } from "./store.js";

export interface CreateProjectInput {
  operationId: string;
  idempotencyKey: string;
  organizationId: string;
  name: string;
  objective: string;
}

export interface StartPlanningInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  expectedStateRevision?: number;
  workspaceId: string;
  teamVersionId: string;
  runtimeId: string;
  budgetId: string;
  executionNodeId: string;
  runtimeInstallationId: string;
  workspaceInstanceId: string;
  planDigest: string;
}

export interface ConfirmPlanInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  approvalId: string;
  expectedStateRevision?: number;
  graph: WorkflowGraph;
}

export interface StartExecutionInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  expectedStateRevision?: number;
  /** Existing `:start` field. Omit → workflow_bound. Not a StartRunRequest field. */
  orchestrationMode?: OrchestrationMode;
}

export interface CancelProjectInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  expectedStateRevision?: number;
}

export async function createProject(
  ctx: AppContext,
  input: CreateProjectInput,
): Promise<{ reused: boolean; project: ProjectRecord }> {
  if (input.name.trim() === "") {
    throw validationFailed("project name is required");
  }
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ name: input.name, objective: input.objective }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "project.create",
          resource: `org:${input.organizationId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const now = ctx.world.nowIso();
        const project: ProjectRecord = {
          id: ctx.world.ids.ulid("prj_"),
          organizationId: input.organizationId,
          name: input.name,
          objective: input.objective,
          status: "draft",
          stateRevision: 1,
          createdAt: now,
          updatedAt: now,
        };
        ctx.world.projects.set(project.id, project);
        await appendEvent(ctx.world, tx, {
          type: "project.created",
          subjectType: "project",
          subjectId: project.id,
          projectId: project.id,
          correlationId: input.operationId,
          data: { to: "draft" },
        });
        return project;
      },
    );
    return { reused: result.reused, project: result.value };
  });
}

export async function startPlanning(
  ctx: AppContext,
  input: StartPlanningInput,
): Promise<{ reused: boolean; project: ProjectRecord; approvalId: string }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          teamVersionId: input.teamVersionId,
          runtimeId: input.runtimeId,
          budgetId: input.budgetId,
          planDigest: input.planDigest,
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "project.start-planning",
          resource: `project:${input.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const project = requireProject(ctx, input.projectId);
        expectRevision(project, input.expectedStateRevision);
        if (!input.workspaceId || !input.teamVersionId || !input.runtimeId || !input.budgetId) {
          throw validationFailed("workspace, team, runtime, and budget are required");
        }
        const next = ctx.engine.nextProjectStatus(project.status, "start-planning");
        const now = ctx.world.nowIso();
        project.workspaceId = input.workspaceId;
        project.teamVersionId = input.teamVersionId;
        project.runtimeId = input.runtimeId;
        project.budgetId = input.budgetId;
        project.executionNodeId = input.executionNodeId;
        project.runtimeInstallationId = input.runtimeInstallationId;
        project.workspaceInstanceId = input.workspaceInstanceId;
        project.status = next;
        touch(project, now);

        const planArtifactId = ctx.world.ids.ulid("arv_");
        ctx.world.artifacts.set(planArtifactId, {
          artifactVersionId: planArtifactId,
          projectId: project.id,
          slotId: "plan",
          digest: input.planDigest,
          status: "available",
        });
        project.planArtifactVersionId = planArtifactId;

        const approvalId = ctx.world.ids.ulid("apr_");
        ctx.world.approvals.set(approvalId, {
          id: approvalId,
          projectId: project.id,
          gate: "plan",
          status: "pending",
          stateRevision: 1,
          actionDigest: input.planDigest,
          resource: `artifactVersion:${planArtifactId}`,
          artifactVersionId: planArtifactId,
          createdAt: now,
        });

        if (!ctx.world.budgets.has(input.budgetId)) {
          ctx.world.budgets.set(input.budgetId, {
            id: input.budgetId,
            projectId: project.id,
            currency: "USD",
            limitMinor: 1_000_000,
            reservedMinor: 0,
            settledMinor: 0,
            authorizationVersion: 1,
          });
        }

        await appendEvent(ctx.world, tx, {
          type: "project.planning_started",
          subjectType: "project",
          subjectId: project.id,
          projectId: project.id,
          correlationId: input.operationId,
          data: { to: next },
        });
        return { project, approvalId };
      },
    ).then((result) => ({
      reused: result.reused,
      project: result.value.project,
      approvalId: result.value.approvalId,
    }));
  });
}

export async function confirmPlan(
  ctx: AppContext,
  input: ConfirmPlanInput,
): Promise<{ reused: boolean; project: ProjectRecord }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          projectId: input.projectId,
          approvalId: input.approvalId,
          graphId: input.graph.id,
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "project.confirm-plan",
          resource: `project:${input.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const project = requireProject(ctx, input.projectId);
        expectRevision(project, input.expectedStateRevision);
        const approval = ctx.world.approvals.get(input.approvalId);
        if (!approval) {
          throw notFound("approval", input.approvalId);
        }
        if (approval.gate !== "plan") {
          throw validationFailed("confirm-plan requires gate=plan");
        }
        if (approval.artifactVersionId !== project.planArtifactVersionId) {
          throw validationFailed("plan artifact version does not match");
        }
        const dag = ctx.engine.validateWorkflowGraph(input.graph);
        if (!dag.ok) {
          throw validationFailed(dag.reason);
        }
        const circular = ctx.engine.reviewerCircularWait(input.graph);
        if (circular) {
          throw validationFailed(circular);
        }

        const approved = ctx.engine.nextApprovalStatus(approval.status, "approve");
        approval.status = ctx.engine.nextApprovalStatus(approved, "consume");
        approval.stateRevision += 1;

        const next = ctx.engine.nextProjectStatus(project.status, "confirm-plan");
        const now = ctx.world.nowIso();
        project.status = next;
        project.workflowVersionId = input.graph.id;
        touch(project, now);

        const instanceId = ctx.world.ids.ulid("wfi_");
        ctx.world.workflows.set(instanceId, {
          id: instanceId,
          projectId: project.id,
          workflowVersionId: input.graph.id,
          graph: input.graph,
          status: "created",
          stateRevision: 1,
        });
        project.workflowInstanceId = instanceId;

        await appendEvent(ctx.world, tx, {
          type: "project.plan_confirmed",
          subjectType: "project",
          subjectId: project.id,
          projectId: project.id,
          workflowInstanceId: instanceId,
          correlationId: input.operationId,
          data: { to: next, workflowVersionId: input.graph.id },
        });
        return { project };
      },
    ).then((result) => ({ reused: result.reused, project: result.value.project }));
  });
}

export async function startExecution(
  ctx: AppContext,
  input: StartExecutionInput,
): Promise<{ reused: boolean; project: ProjectRecord }> {
  const orchestrationMode = input.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE;
  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ projectId: input.projectId, orchestrationMode }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "project.start",
          resource: `project:${input.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const project = requireProject(ctx, input.projectId);
        expectRevision(project, input.expectedStateRevision);
        const nextStatus = ctx.engine.nextProjectStatus(project.status, "start");
        project.orchestrationMode = orchestrationMode;
        if (!project.workflowInstanceId) {
          throw validationFailed("project has no published workflow");
        }
        const workflow = ctx.world.workflows.get(project.workflowInstanceId);
        if (!workflow) {
          throw notFound("workflow", project.workflowInstanceId);
        }
        const active = [...ctx.world.workflows.values()].find(
          (item) =>
            item.projectId === project.id &&
            item.status !== "completed" &&
            item.status !== "failed" &&
            item.status !== "cancelled" &&
            item.id !== workflow.id,
        );
        if (active) {
          throw validationFailed("project already has an active workflow instance");
        }

        const now = ctx.world.nowIso();
        project.status = nextStatus;
        touch(project, now);

        workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "validate");
        workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "pass");
        workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "start");
        workflow.stateRevision += 3;

        instantiateGraph(ctx, project, workflow);
        await appendEvent(ctx.world, tx, {
          type: "workflow.started",
          subjectType: "workflow",
          subjectId: workflow.id,
          projectId: project.id,
          workflowInstanceId: workflow.id,
          correlationId: input.operationId,
          data: { to: workflow.status },
        });
        return { project };
      },
    ).then((result) => ({ reused: result.reused, project: result.value.project }));
  });
}

export async function pauseProject(
  ctx: AppContext,
  input: { projectId: string; expectedStateRevision?: number },
): Promise<ProjectRecord> {
  const project = requireProject(ctx, input.projectId);
  expectRevision(project, input.expectedStateRevision);
  project.status = ctx.engine.nextProjectStatus(project.status, "pause");
  touch(project, ctx.world.nowIso());
  const workflow = project.workflowInstanceId
    ? ctx.world.workflows.get(project.workflowInstanceId)
    : undefined;
  if (workflow && (workflow.status === "running" || workflow.status === "waiting")) {
    workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "pause");
    workflow.stateRevision += 1;
  }
  return project;
}

export async function cancelProject(
  ctx: AppContext,
  input: CancelProjectInput,
): Promise<{ accepted: true; status: ProjectRecord["status"]; cancelRequestedAt?: string }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ projectId: input.projectId }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "project.cancel",
          resource: `project:${input.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const project = requireProject(ctx, input.projectId);
        expectRevision(project, input.expectedStateRevision);
        const now = ctx.world.nowIso();
        const hasActiveRun = ctx.world
          .tasksForProject(project.id)
          .some((task) => Boolean(ctx.world.activeRunForTask(task.id)));
        if ((project.status === "draft" || project.status === "ready") && !hasActiveRun) {
          project.status = ctx.engine.nextProjectStatus(project.status, "cancel");
          touch(project, now);
          await appendEvent(ctx.world, tx, {
            type: "project.cancelled",
            subjectType: "project",
            subjectId: project.id,
            projectId: project.id,
            correlationId: input.operationId,
            data: { to: "cancelled" },
          });
          return { accepted: true as const, status: project.status };
        }

        project.cancelRequestedAt = now;
        const workflow = project.workflowInstanceId
          ? ctx.world.workflows.get(project.workflowInstanceId)
          : undefined;
        if (workflow) {
          workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "cancel");
          workflow.cancelRequestedAt = now;
          workflow.stateRevision += 1;
        }
        await appendEvent(ctx.world, tx, {
          type: "project.cancel_requested",
          subjectType: "project",
          subjectId: project.id,
          projectId: project.id,
          correlationId: input.operationId,
          data: { to: project.status },
        });
        return {
          accepted: true as const,
          status: project.status,
          cancelRequestedAt: now,
        };
      },
    );
    return result.value;
  });
}

export function requireProject(ctx: AppContext, projectId: string): ProjectRecord {
  const project = ctx.world.projects.get(projectId);
  if (!project) {
    throw notFound("project", projectId);
  }
  return project;
}

function instantiateGraph(
  ctx: AppContext,
  project: ProjectRecord,
  workflow: WorkflowInstanceRecord,
): void {
  const now = ctx.world.nowIso();
  const nodeToTask = new Map<string, string>();
  for (const node of workflow.graph.nodes) {
    if (node.kind !== "task") {
      const nodeInstanceId = ctx.world.ids.ulid("wfn_");
      ctx.world.nodes.set(nodeInstanceId, {
        id: nodeInstanceId,
        workflowInstanceId: workflow.id,
        nodeId: node.id,
        status: "pending",
        generation: 1,
        stateRevision: 1,
      });
      continue;
    }
    const taskId = ctx.world.ids.ulid("tsk_");
    nodeToTask.set(node.id, taskId);
    const isEntry = workflow.graph.entryNodeIds.includes(node.id);
    const taskStatus = isEntry
      ? ctx.engine.nextTaskStatus("draft", "make-ready")
      : ctx.engine.nextTaskStatus("draft", "block");
    ctx.world.tasks.set(taskId, {
      id: taskId,
      projectId: project.id,
      workflowInstanceId: workflow.id,
      workflowNodeId: node.id,
      role: node.role ?? "developer",
      title: node.id,
      status: taskStatus,
      stateRevision: 1,
      definitionRevision: 1,
      generation: 1,
      attempt: 1,
      maxAttempts: node.maxAttempts ?? 2,
      maxReworkCycles: node.maxReworkCycles ?? 1,
      priority: node.priority ?? 50,
      requiresReview: node.requiresReview === true,
      expectedOutputs: (node.expectedOutputIds ?? []).map((id) => ({
        id,
        kind: "code",
        required: true,
      })),
      outputBindings: {},
      dependsOn: [],
      inputArtifactVersionIds: [],
      createdAt: now,
      updatedAt: now,
    });
    const nodeInstanceId = ctx.world.ids.ulid("wfn_");
    ctx.world.nodes.set(nodeInstanceId, {
      id: nodeInstanceId,
      workflowInstanceId: workflow.id,
      nodeId: node.id,
      taskId,
      status: isEntry ? ctx.engine.nextNodeStatus("pending", "make-ready") : "pending",
      generation: 1,
      stateRevision: 1,
    });
  }
  for (const edge of workflow.graph.edges) {
    const fromTask = nodeToTask.get(edge.from);
    const toTask = nodeToTask.get(edge.to);
    if (!fromTask || !toTask) {
      continue;
    }
    const task = ctx.world.tasks.get(toTask);
    if (!task) {
      continue;
    }
    task.dependsOn.push({
      taskId: fromTask,
      waitFor: edge.waitFor === "completed" ? "completed" : "outputs_ready",
    });
  }
}
