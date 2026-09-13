import {
  parseStartDirectTaskRunAccepted,
  type PlacementIntent,
} from "@workforce/protocol";

import { startTaskRun } from "../runs/runs.js";
import { requireTask } from "../tasks/tasks.js";
import type { AppContext } from "./context.js";
import { createAdHocTask } from "./direct-task.js";
import { validationFailed } from "./errors.js";
import { requireProject } from "./projects.js";
import type { RunRecord, TaskRecord } from "./store.js";

export interface StartDirectWorkInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  /** Existing project-scoped ad-hoc Task. Omit → `createAdHocTask`. */
  taskId?: string;
  title?: string;
  expectedStateRevision?: number;
  expectedTaskStateRevision?: number;
  placementIntent?: PlacementIntent;
}

/**
 * Chat / HTTP shared entry for D18 direct: ad-hoc Task then
 * `POST /tasks/{id}/runs` with `orchestrationMode=direct`.
 *
 * Does not instantiate a published graph, does not create a NodeInstance,
 * and does not advance WorkflowInstance / Project status.
 */
export async function startDirectWork(
  ctx: AppContext,
  input: StartDirectWorkInput,
): Promise<{ reused: boolean; task: TaskRecord; run: RunRecord }> {
  const project = requireProject(ctx, input.projectId);
  const projectStatus = project.status;
  const workflowInstanceId = project.workflowInstanceId;
  const executionSnapshotId = project.executionSnapshotId;

  let task: TaskRecord;
  if (input.taskId) {
    task = requireOwnedAdHocTask(ctx, input.projectId, input.taskId);
  } else {
    const created = await createAdHocTask(ctx, {
      operationId: `${input.operationId}:adhoc`,
      idempotencyKey: `${input.idempotencyKey}:adhoc`,
      projectId: input.projectId,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.expectedStateRevision !== undefined
        ? { expectedStateRevision: input.expectedStateRevision }
        : {}),
      ...(input.placementIntent ? { placementIntent: input.placementIntent } : {}),
    });
    task = created.task;
  }

  const started = await startTaskRun(ctx, {
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    taskId: task.id,
    orchestrationMode: "direct",
    ...(input.expectedTaskStateRevision !== undefined
      ? { expectedStateRevision: input.expectedTaskStateRevision }
      : {}),
    ...(input.placementIntent ? { placementIntent: input.placementIntent } : {}),
  });

  const liveProject = requireProject(ctx, input.projectId);
  if (
    liveProject.status !== projectStatus ||
    liveProject.workflowInstanceId !== workflowInstanceId ||
    liveProject.executionSnapshotId !== executionSnapshotId
  ) {
    throw validationFailed("direct execution must not advance Project or WorkflowInstance");
  }
  if (started.run.executionSnapshot?.executionSnapshotId !== undefined) {
    throw validationFailed("direct execution must not reference a ProjectExecutionSnapshot");
  }
  if (started.run.orchestrationMode !== "direct") {
    throw validationFailed("direct execution must persist orchestrationMode=direct");
  }

  parseStartDirectTaskRunAccepted({
    projectId: liveProject.id,
    taskId: started.run.taskId,
    runId: started.run.id,
    orchestrationMode: "direct",
  });

  return {
    reused: started.reused,
    task: requireTask(ctx, started.run.taskId),
    run: started.run,
  };
}

function requireOwnedAdHocTask(ctx: AppContext, projectId: string, taskId: string): TaskRecord {
  const task = requireTask(ctx, taskId);
  if (task.projectId !== projectId) {
    throw validationFailed("task does not belong to this project");
  }
  if (task.workflowInstanceId !== undefined || task.workflowNodeId !== undefined) {
    throw validationFailed("direct execution never targets an existing WorkflowInstance");
  }
  return task;
}
