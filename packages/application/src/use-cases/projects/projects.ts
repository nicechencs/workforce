import { DEFAULT_ORCHESTRATION_MODE, type OrchestrationMode } from "@workforce/protocol";
import { DEFAULT_PLACEMENT_INTENT } from "../runs/placement.js";

import type { AppContext } from "./context.js";
import { expectRevision, touch } from "./context.js";
import type { WorkflowGraph } from "./engine-port.js";
import { notFound, validationFailed } from "./errors.js";
import { appendEvent } from "./events.js";
import { digestOf, withIdempotency } from "./idempotency.js";
import type {
  ProjectExecutionSnapshotRecord,
  ProjectRecord,
  WorkflowInstanceRecord,
} from "./store.js";

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
          placementIntent: DEFAULT_PLACEMENT_INTENT,
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
        project.placementIntent = project.placementIntent ?? DEFAULT_PLACEMENT_INTENT;
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
        if (!project.teamVersionId) {
          throw validationFailed("confirm-plan requires a published team version");
        }
        const existingGraph = ctx.world.workflowVersions.get(input.graph.id);
        if (existingGraph && digestOf(existingGraph) !== digestOf(input.graph)) {
          throw validationFailed(`workflow version ${input.graph.id} is immutable`);
        }
        const graph = cloneGraph(input.graph);
        ctx.world.workflowVersions.set(graph.id, graph);
        const budget = project.budgetId ? ctx.world.budgets.get(project.budgetId) : undefined;
        const snapshotId = ctx.world.ids.ulid("snp_");
        const snapshot: ProjectExecutionSnapshotRecord = {
          id: snapshotId,
          projectId: project.id,
          workflowVersionId: graph.id,
          teamVersionId: project.teamVersionId,
          contentHash: executionSnapshotContentHash({
            graph,
            teamVersionId: project.teamVersionId,
            budget,
          }),
          // M3 has no PolicySnapshot port yet. An explicit empty object denotes
          // unavailable policy facts; it is not a fabricated policy decision.
          policySnapshot: {},
          ...(budget
            ? {
                budgetSnapshot: {
                  id: budget.id,
                  currency: budget.currency,
                  limitMinor: budget.limitMinor,
                  reservedMinor: budget.reservedMinor,
                  settledMinor: budget.settledMinor,
                  authorizationVersion: budget.authorizationVersion,
                },
              }
            : {}),
          createdAt: now,
        };
        ctx.world.executionSnapshots.set(snapshot.id, snapshot);
        project.status = next;
        project.workflowVersionId = graph.id;
        project.executionSnapshotId = snapshot.id;
        touch(project, now);

        await appendEvent(ctx.world, tx, {
          type: "project.plan_confirmed",
          subjectType: "project",
          subjectId: project.id,
          projectId: project.id,
          correlationId: input.operationId,
          data: { to: next, workflowVersionId: graph.id, executionSnapshotId: snapshot.id },
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
        if (!project.executionSnapshotId) {
          throw validationFailed("project has no execution snapshot");
        }
        const snapshot = ctx.world.executionSnapshots.get(project.executionSnapshotId);
        if (!snapshot || snapshot.projectId !== project.id) {
          throw validationFailed("project execution snapshot is unavailable");
        }
        const published = ctx.world.workflowVersions.get(snapshot.workflowVersionId);
        if (!published) {
          throw validationFailed("published workflow graph is unavailable");
        }
        const active = [...ctx.world.workflows.values()].find(
          (item) =>
            item.projectId === project.id &&
            item.status !== "completed" &&
            item.status !== "failed" &&
            item.status !== "cancelled",
        );
        if (active) {
          throw validationFailed("project already has an active workflow instance");
        }

        const now = ctx.world.nowIso();
        const workflow: WorkflowInstanceRecord = {
          id: ctx.world.ids.ulid("wfi_"),
          projectId: project.id,
          workflowVersionId: snapshot.workflowVersionId,
          executionSnapshotId: snapshot.id,
          graph: cloneGraph(published),
          status: "created",
          stateRevision: 1,
        };
        ctx.world.workflows.set(workflow.id, workflow);
        project.status = nextStatus;
        project.workflowInstanceId = workflow.id;
        touch(project, now);

        workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "validate");
        workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "pass");
        workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "start");
        workflow.stateRevision += 3;

        instantiateGraph(ctx, project, workflow, published);
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
  publishedGraph: WorkflowGraph,
): void {
  const now = ctx.world.nowIso();
  const nodeToTask = new Map<string, string>();
  for (const node of publishedGraph.nodes) {
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
    const isEntry = publishedGraph.entryNodeIds.includes(node.id);
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
  for (const projection of projectTaskDependencies(publishedGraph, nodeToTask)) {
    const task = ctx.world.tasks.get(projection.taskId);
    task?.dependsOn.push(...projection.dependsOn);
  }
}

/**
 * Public Task dependencies represent only unconditional task-to-task
 * prerequisites projected from the published canonical graph. Condition,
 * failure, cancel, and other routing edges stay on the Workflow graph.
 */
export function projectTaskDependencies(
  graph: WorkflowGraph,
  nodeToTask: ReadonlyMap<string, string>,
): Array<{
  taskId: string;
  dependsOn: Array<{ taskId: string; waitFor: "outputs_ready" | "completed" }>;
}> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const dependenciesByTask = new Map<
    string,
    Array<{ taskId: string; waitFor: "outputs_ready" | "completed" }>
  >();
  for (const edge of graph.edges) {
    if (!isPublishedTaskPrerequisiteEdge(nodes, edge)) {
      continue;
    }
    const fromTask = nodeToTask.get(edge.from);
    const toTask = nodeToTask.get(edge.to);
    if (!fromTask || !toTask) {
      continue;
    }
    const waitFor = edge.waitFor === "completed" ? "completed" : "outputs_ready";
    const dependencies = dependenciesByTask.get(toTask) ?? [];
    if (!dependencies.some((dependency) => dependency.taskId === fromTask)) {
      dependencies.push({ taskId: fromTask, waitFor });
    }
    dependenciesByTask.set(toTask, dependencies);
  }
  return [...dependenciesByTask.entries()].map(([taskId, dependsOn]) => ({ taskId, dependsOn }));
}

function isPublishedTaskPrerequisiteEdge(
  nodes: ReadonlyMap<string, WorkflowGraph["nodes"][number]>,
  edge: WorkflowGraph["edges"][number],
): boolean {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to || from.kind !== "task" || to.kind !== "task") {
    return false;
  }
  if (edge.conditionValue !== undefined) {
    return false;
  }
  const waitFor = edge.waitFor ?? "outputs_ready";
  return waitFor === "outputs_ready" || waitFor === "completed";
}

function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

function executionSnapshotContentHash(value: unknown): string {
  // Application deliberately has no Node crypto dependency. Durable SQLite
  // publication computes the cryptographic graph hash; this in-memory slice
  // keeps a canonical-content fingerprint until that source is wired through.
  return `canonical-json:${digestOf(value)}`;
}
