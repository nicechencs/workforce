import type { AppContext } from "../projects/context.js";
import { expectRevision, touch } from "../projects/context.js";
import { notFound, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { requireProject } from "../projects/projects.js";
import type { NodeRuntimeState } from "../projects/engine-port.js";
import type { EvaluationEvidenceRecord, TaskRecord } from "../projects/store.js";

export async function queueTask(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey: string;
    taskId: string;
    expectedStateRevision?: number;
  },
): Promise<{ reused: boolean; task: TaskRecord }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ taskId: input.taskId }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "task.queue",
          resource: `task:${input.taskId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const task = requireTask(ctx, input.taskId);
        expectRevision(task, input.expectedStateRevision);
        const project = requireProject(ctx, task.projectId);
        if (project.status === "paused" || project.cancelRequestedAt) {
          throw validationFailed("project is not accepting new work");
        }
        if (!dependenciesSatisfied(ctx, task)) {
          throw validationFailed("task dependencies are not outputs_ready");
        }
        if (
          ctx.engine.retryIsDue &&
          !ctx.engine.retryIsDue(ctx.world.nowIso(), task.nextAttemptAt)
        ) {
          throw validationFailed("task retry backoff has not elapsed");
        }
        task.status = ctx.engine.nextTaskStatus(task.status, "queue");
        touch(task, ctx.world.nowIso());
        activateNode(ctx, task, "activate");
        await appendEvent(ctx.world, tx, {
          type: "task.queued",
          subjectType: "task",
          subjectId: task.id,
          projectId: task.projectId,
          taskId: task.id,
          correlationId: input.operationId,
          data: { to: "queued" },
        });
        return { task };
      },
    ).then((result) => ({ reused: result.reused, task: result.value.task }));
  });
}

export function dispatchTask(ctx: AppContext, taskId: string): TaskRecord {
  const task = requireTask(ctx, taskId);
  task.status = ctx.engine.nextTaskStatus(task.status, "dispatch");
  touch(task, ctx.world.nowIso());
  return task;
}

export function bindTaskOutput(
  ctx: AppContext,
  input: { taskId: string; slotId: string; artifactVersionId: string; digest: string },
): TaskRecord {
  const task = requireTask(ctx, input.taskId);
  ctx.world.artifacts.set(input.artifactVersionId, {
    artifactVersionId: input.artifactVersionId,
    projectId: task.projectId,
    taskId: task.id,
    slotId: input.slotId,
    digest: input.digest,
    status: "available",
  });
  task.outputBindings[input.slotId] = input.artifactVersionId;
  touch(task, ctx.world.nowIso());
  propagateOutputsReady(ctx, task);
  return task;
}

/**
 * Copies a T08 evaluation verdict into `world.evaluations`. Does not
 * inspect Process/Artifacts, mutate T08, or complete the Task.
 */
export function recordEvaluationEvidence(
  ctx: AppContext,
  input: {
    artifactVersionId: string;
    verdict: "pass" | "fail" | "inconclusive";
    id?: string;
  },
): EvaluationEvidenceRecord {
  const artifactVersionId = input.artifactVersionId.trim();
  if (artifactVersionId === "") {
    throw validationFailed("evaluation evidence requires artifactVersionId");
  }
  const record: EvaluationEvidenceRecord = {
    id: input.id?.trim() ? input.id.trim() : ctx.world.ids.ulid("eval_"),
    artifactVersionId,
    verdict: input.verdict,
  };
  ctx.world.evaluations.set(record.id, record);
  return record;
}

export function evaluateTaskAfterRun(ctx: AppContext, taskId: string): TaskRecord {
  const task = requireTask(ctx, taskId);
  if (task.status !== "running") {
    return task;
  }
  const succeeded = [...ctx.world.runs.values()].some(
    (run) => run.taskId === task.id && run.status === "succeeded",
  );
  if (!succeeded) {
    return task;
  }
  const barrier = completionBarrierFor(ctx, task);
  if (!barrier.ok) {
    return task;
  }
  if (task.requiresReview) {
    task.status = ctx.engine.nextTaskStatus(task.status, "outputs-ready");
    activateNode(ctx, task, "wait");
  } else {
    task.status = ctx.engine.nextTaskStatus(task.status, "auto-complete");
    activateNode(ctx, task, "complete");
  }
  touch(task, ctx.world.nowIso());
  if (task.workflowInstanceId) {
    refreshDownstream(ctx, task.projectId);
  }
  return task;
}

export function evaluateTaskAfterFailure(ctx: AppContext, taskId: string): TaskRecord {
  const task = requireTask(ctx, taskId);
  if (task.status !== "running") {
    return task;
  }
  const decision = ctx.engine.decideRecovery({
    kind: "retry",
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    generation: task.generation,
    maxReworkCycles: task.maxReworkCycles,
    capacityAvailable: true,
    nowIso: ctx.world.nowIso(),
    ...(task.nextAttemptAt !== undefined ? { nextAttemptAt: task.nextAttemptAt } : {}),
  });
  if (decision.action === "wait-capacity") {
    return task;
  }
  if (decision.action === "fail") {
    task.status = ctx.engine.nextTaskStatus(task.status, "fail");
    touch(task, ctx.world.nowIso());
    activateNode(ctx, task, "fail");
    return task;
  }
  if (decision.action === "retry") {
    task.status = ctx.engine.nextTaskStatus(task.status, "retry-ready");
    task.attempt = decision.nextAttempt;
    task.nextAttemptAt = new Date(
      ctx.world.clock.now().getTime() + decision.backoffMs,
    ).toISOString();
    touch(task, ctx.world.nowIso());
  }
  return task;
}

function completionBarrierFor(
  ctx: AppContext,
  task: TaskRecord,
): { ok: true } | { ok: false; reason: string } {
  const artifacts = ctx.world.artifactsForTask(task);
  const evaluations = ctx.world.evaluationsForTask(task);
  const requiredOutputsBound = ctx.world.requiredOutputsReady(task);
  if (ctx.engine.taskCompletionBarrier) {
    return ctx.engine.taskCompletionBarrier({
      requiredOutputsBound,
      artifacts,
      evaluations,
    });
  }
  if (!requiredOutputsBound) {
    return { ok: false, reason: "missing_artifact" };
  }
  if (artifacts.some((item) => item.status === "quarantined" || item.status === "staging")) {
    return { ok: false, reason: "integrity" };
  }
  if (evaluations.length === 0 || evaluations.some((item) => item.verdict !== "pass")) {
    return { ok: false, reason: "evaluation_failed" };
  }
  return { ok: true };
}

export async function retryTask(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey: string;
    taskId: string;
    capacityAvailable?: boolean;
  },
): Promise<TaskRecord> {
  const task = requireTask(ctx, input.taskId);
  const decision = ctx.engine.decideRecovery({
    kind: "retry",
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    generation: task.generation,
    maxReworkCycles: task.maxReworkCycles,
    capacityAvailable: input.capacityAvailable !== false,
    nowIso: ctx.world.nowIso(),
    ...(task.nextAttemptAt !== undefined ? { nextAttemptAt: task.nextAttemptAt } : {}),
  });
  if (decision.action === "wait-capacity") {
    return task;
  }
  if (decision.action === "fail") {
    task.status = ctx.engine.nextTaskStatus(task.status, "fail");
    touch(task, ctx.world.nowIso());
    return task;
  }
  if (decision.action === "retry") {
    task.status = ctx.engine.nextTaskStatus(task.status, "retry-ready");
    task.attempt = decision.nextAttempt;
    task.nextAttemptAt = new Date(
      ctx.world.clock.now().getTime() + decision.backoffMs,
    ).toISOString();
    touch(task, ctx.world.nowIso());
  }
  return task;
}

export async function requestTaskChanges(
  ctx: AppContext,
  input: { taskId: string },
): Promise<TaskRecord> {
  const task = requireTask(ctx, input.taskId);
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
  touch(task, ctx.world.nowIso());
  return task;
}

export async function cancelTask(
  ctx: AppContext,
  input: { operationId: string; idempotencyKey: string; taskId: string },
): Promise<{ accepted: true; status: TaskRecord["status"] }> {
  const task = requireTask(ctx, input.taskId);
  const run = ctx.world.activeRunForTask(task.id);
  if (run) {
    run.cancelRequestedAt = ctx.world.nowIso();
    return { accepted: true, status: task.status };
  }
  if (task.status === "queued" || task.status === "running") {
    task.status = ctx.engine.nextTaskStatus(task.status, "cancel");
    touch(task, ctx.world.nowIso());
    activateNode(ctx, task, "cancel");
    return { accepted: true, status: task.status };
  }
  task.status = ctx.engine.nextTaskStatus(task.status, "cancel");
  touch(task, ctx.world.nowIso());
  return { accepted: true, status: task.status };
}

export function settleTaskCancel(ctx: AppContext, taskId: string): TaskRecord {
  const task = requireTask(ctx, taskId);
  const run = ctx.world.activeRunForTask(task.id);
  if (run) {
    return task;
  }
  if (task.status === "queued" || task.status === "running") {
    task.status = ctx.engine.nextTaskStatus(task.status, "cancel");
    touch(task, ctx.world.nowIso());
    activateNode(ctx, task, "cancel");
  }
  return task;
}

export function requireTask(ctx: AppContext, taskId: string): TaskRecord {
  const task = ctx.world.tasks.get(taskId);
  if (!task) {
    throw notFound("task", taskId);
  }
  return task;
}

export function dependenciesSatisfied(ctx: AppContext, task: TaskRecord): boolean {
  return task.dependsOn.every((dep) => {
    const upstream = ctx.world.tasks.get(dep.taskId);
    if (!upstream) {
      return false;
    }
    if (dep.waitFor === "completed") {
      return upstream.status === "completed";
    }
    return ctx.world.requiredOutputsReady(upstream);
  });
}

export function refreshDownstream(ctx: AppContext, projectId: string): void {
  const project = requireProject(ctx, projectId);
  const workflow = project.workflowInstanceId
    ? ctx.world.workflows.get(project.workflowInstanceId)
    : undefined;
  if (!workflow) {
    return;
  }
  const nodeStates: NodeRuntimeState[] = [];
  for (const node of ctx.world.nodes.values()) {
    if (node.workflowInstanceId !== workflow.id) {
      continue;
    }
    const task = node.taskId ? ctx.world.tasks.get(node.taskId) : undefined;
    nodeStates.push({
      nodeId: node.nodeId,
      status: node.status,
      ...(task ? { taskStatus: task.status } : {}),
      requiredOutputsReady: task
        ? ctx.world.requiredOutputsReady(task)
        : node.status === "completed",
    });
  }
  const actions = ctx.engine.schedule({
    graph: workflow.graph,
    nodes: nodeStates,
    projectStatus: project.status,
    workflowStatus: workflow.status,
    capacityAvailable: 8,
  });
  for (const action of actions) {
    if (action.type === "wait") {
      continue;
    }
    const node = [...ctx.world.nodes.values()].find(
      (item) => item.workflowInstanceId === workflow.id && item.nodeId === action.nodeId,
    );
    const task = node?.taskId ? ctx.world.tasks.get(node.taskId) : undefined;
    if (action.type === "skip" && node) {
      node.status = ctx.engine.nextNodeStatus(node.status, "skip");
      node.stateRevision += 1;
      continue;
    }
    if ((action.type === "make-ready" || action.type === "queue") && task && node) {
      if (task.status === "draft" || task.status === "blocked") {
        task.status = ctx.engine.nextTaskStatus(task.status, "make-ready");
        touch(task, ctx.world.nowIso());
      }
      if (node.status === "pending" || node.status === "blocked") {
        node.status = ctx.engine.nextNodeStatus(node.status, "make-ready");
        node.stateRevision += 1;
      }
    }
  }
}

function propagateOutputsReady(ctx: AppContext, producer: TaskRecord): void {
  if (!ctx.world.requiredOutputsReady(producer)) {
    return;
  }
  const versions = Object.values(producer.outputBindings);
  for (const task of ctx.world.tasksForProject(producer.projectId)) {
    if (
      task.dependsOn.some((dep) => dep.taskId === producer.id && dep.waitFor === "outputs_ready")
    ) {
      for (const version of versions) {
        if (!task.inputArtifactVersionIds.includes(version)) {
          task.inputArtifactVersionIds.push(version);
        }
      }
    }
  }
  evaluateTaskAfterRun(ctx, producer.id);
}

function activateNode(ctx: AppContext, task: TaskRecord, command: string): void {
  if (!task.workflowInstanceId || !task.workflowNodeId) {
    return;
  }
  for (const node of ctx.world.nodes.values()) {
    if (
      node.workflowInstanceId === task.workflowInstanceId &&
      node.nodeId === task.workflowNodeId
    ) {
      node.status = ctx.engine.nextNodeStatus(node.status, command);
      node.stateRevision += 1;
    }
  }
}
