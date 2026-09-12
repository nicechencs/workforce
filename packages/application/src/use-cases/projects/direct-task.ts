import type { PlacementIntent } from "@workforce/protocol";

import type { AppContext } from "./context.js";
import { expectRevision, touch } from "./context.js";
import { notFound, validationFailed } from "./errors.js";
import { appendEvent } from "./events.js";
import { digestOf, withIdempotency } from "./idempotency.js";
import type { ProjectRecord, TaskRecord } from "./store.js";

export interface CreateAdHocTaskInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  title?: string;
  expectedStateRevision?: number;
  placementIntent?: PlacementIntent;
}

/**
 * Project-scoped Task with no WorkflowInstance / NodeInstance. Direct
 * scheduling creates this before `admitRun`.
 */
export async function createAdHocTask(
  ctx: AppContext,
  input: CreateAdHocTaskInput,
): Promise<{ reused: boolean; task: TaskRecord }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          projectId: input.projectId,
          title: input.title ?? "",
          placementIntent: input.placementIntent,
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "task.create-adhoc",
          resource: `project:${input.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const project = requireProjectRecord(ctx, input.projectId);
        expectRevision(project, input.expectedStateRevision);
        if (project.organizationId.trim() === "") {
          throw validationFailed("project organization is required");
        }
        const existing = findAdHocTask(ctx, project.id);
        if (existing) {
          return existing;
        }
        return insertAdHocTask(ctx, project, input.title ?? project.name, input.operationId);
      },
    ).then(async (result) => {
      if (!result.reused) {
        await appendEvent(ctx.world, tx, {
          type: "task.created",
          subjectType: "task",
          subjectId: result.value.id,
          projectId: result.value.projectId,
          taskId: result.value.id,
          correlationId: input.operationId,
          data: { to: result.value.status, orchestrationMode: "direct" },
        });
      }
      return { reused: result.reused, task: result.value };
    });
  });
}

export function findAdHocTask(ctx: AppContext, projectId: string): TaskRecord | undefined {
  return ctx.world
    .tasksForProject(projectId)
    .find((task) => task.workflowInstanceId === undefined && task.workflowNodeId === undefined);
}

export function insertAdHocTask(
  ctx: AppContext,
  project: ProjectRecord,
  title: string,
  _operationId: string,
): TaskRecord {
  const now = ctx.world.nowIso();
  const task: TaskRecord = {
    id: ctx.world.ids.ulid("tsk_"),
    projectId: project.id,
    role: "developer",
    title,
    status: ctx.engine.nextTaskStatus("draft", "make-ready"),
    stateRevision: 1,
    definitionRevision: 1,
    generation: 1,
    attempt: 1,
    maxAttempts: 2,
    maxReworkCycles: 1,
    priority: 50,
    requiresReview: false,
    expectedOutputs: [{ id: "result", kind: "code", required: true }],
    outputBindings: {},
    dependsOn: [],
    inputArtifactVersionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  ctx.world.tasks.set(task.id, task);
  return task;
}

function requireProjectRecord(ctx: AppContext, projectId: string): ProjectRecord {
  const project = ctx.world.projects.get(projectId);
  if (!project) {
    throw notFound("project", projectId);
  }
  return project;
}

/**
 * Absorbing a direct Run's artifact into a Workflow requires a new
 * workflow-bound command that names the exact ArtifactVersion. The original
 * direct Run / Task / Project are never advanced.
 */
export async function absorbDirectArtifact(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey: string;
    sourceRunId: string;
    targetTaskId: string;
    artifactVersionId: string;
  },
): Promise<{ reused: boolean; task: TaskRecord }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          sourceRunId: input.sourceRunId,
          targetTaskId: input.targetTaskId,
          artifactVersionId: input.artifactVersionId,
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "task.absorb-direct-artifact",
          resource: `task:${input.targetTaskId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const run = ctx.world.runs.get(input.sourceRunId);
        if (!run) {
          throw validationFailed(`run ${input.sourceRunId} not found`);
        }
        if (run.orchestrationMode !== "direct") {
          throw validationFailed("absorb requires a direct source Run");
        }
        if (run.executionSnapshot?.executionSnapshotId !== undefined) {
          throw validationFailed("direct source Run must not reference a ProjectExecutionSnapshot");
        }
        const target = ctx.world.tasks.get(input.targetTaskId);
        if (!target) {
          throw validationFailed(`task ${input.targetTaskId} not found`);
        }
        if (!target.workflowInstanceId) {
          throw validationFailed("absorb target must be a workflow-bound Task");
        }
        if (target.projectId !== run.projectId) {
          throw validationFailed("absorb target must belong to the same project");
        }
        const artifact = ctx.world.artifacts.get(input.artifactVersionId);
        if (!artifact || artifact.artifactVersionId !== input.artifactVersionId) {
          throw validationFailed("absorb requires a precise ArtifactVersion");
        }
        if (artifact.status !== "available") {
          throw validationFailed("absorb requires an available ArtifactVersion");
        }
        if (artifact.projectId !== run.projectId) {
          throw validationFailed("artifact does not belong to this project");
        }
        if (!target.inputArtifactVersionIds.includes(artifact.artifactVersionId)) {
          target.inputArtifactVersionIds.push(artifact.artifactVersionId);
        }
        touch(target, ctx.world.nowIso());
        await appendEvent(ctx.world, tx, {
          type: "task.input_bound",
          subjectType: "task",
          subjectId: target.id,
          projectId: target.projectId,
          taskId: target.id,
          correlationId: input.operationId,
          data: {
            artifactVersionId: artifact.artifactVersionId,
            sourceRunId: run.id,
            orchestrationMode: "workflow_bound",
          },
        });
        return target;
      },
    ).then((result) => ({ reused: result.reused, task: result.value }));
  });
}
