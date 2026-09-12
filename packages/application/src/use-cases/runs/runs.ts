import { startIdempotencyKey } from "@workforce/domain";
import {
  DEFAULT_ORCHESTRATION_MODE,
  type OrchestrationMode,
} from "@workforce/protocol";

import type { AppContext } from "../projects/context.js";
import { expectRevision, touch } from "../projects/context.js";
import { notFound, UseCaseError, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { requireProject } from "../projects/projects.js";
import { dispatchTask, evaluateTaskAfterRun, queueTask, requireTask } from "../tasks/tasks.js";
import type { RunRecord } from "../projects/store.js";
import { unsupportedPause } from "./host.js";

export async function startRun(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey?: string;
    taskId: string;
    expectedStateRevision?: number;
    snapshotRef?: string;
    orchestrationMode?: OrchestrationMode;
  },
): Promise<{ reused: boolean; run: RunRecord }> {
  const task = requireTask(ctx, input.taskId);
  const project = requireProject(ctx, task.projectId);
  const orchestrationMode =
    input.orchestrationMode ?? project.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE;
  if (!project.executionNodeId || !project.runtimeInstallationId || !project.workspaceInstanceId) {
    throw validationFailed("run start requires node, runtime, and workspace placement");
  }
  const idempotencyKey =
    input.idempotencyKey ??
    startIdempotencyKey({
      taskId: task.id,
      definitionRevision: task.definitionRevision,
      generation: task.generation,
      attempt: task.attempt,
    });

  if (task.status === "ready") {
    await queueTask(ctx, {
      operationId: `${input.operationId}:queue`,
      idempotencyKey: `${idempotencyKey}:queue`,
      taskId: task.id,
    });
  }
  const queued = requireTask(ctx, task.id);
  if (queued.status === "queued") {
    dispatchTask(ctx, queued.id);
  }

  return ctx.world.uow.withTransaction(async (tx) => {
    return withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          taskId: task.id,
          definitionRevision: task.definitionRevision,
          generation: task.generation,
          attempt: task.attempt,
          orchestrationMode,
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "runtime.start",
          resource: `task:${task.id}:definitionRevision:${task.definitionRevision}:generation:${task.generation}:attempt:${task.attempt}`,
          idempotencyKey,
        },
      },
      async () => {
        const live = requireTask(ctx, input.taskId);
        expectRevision(live, input.expectedStateRevision);
        const existingActive = ctx.world.activeRunForTask(live.id);
        if (existingActive) {
          return { run: existingActive };
        }
        const now = ctx.world.nowIso();
        const runId = ctx.world.ids.ulid("run_");
        const run: RunRecord = {
          id: runId,
          taskId: live.id,
          projectId: live.projectId,
          status: "pending",
          stateRevision: 1,
          attempt: live.attempt,
          generation: live.generation,
          definitionRevision: live.definitionRevision,
          operationId: input.operationId,
          orchestrationMode,
          createdAt: now,
          updatedAt: now,
        };
        ctx.world.runs.set(run.id, run);

        const handle = await ctx.host.start({
          operationId: input.operationId,
          idempotencyKey,
          taskId: live.id,
          definitionRevision: live.definitionRevision,
          generation: live.generation,
          attempt: live.attempt,
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          placement: {
            executionNodeId: project.executionNodeId ?? "",
            runtimeInstallationId: project.runtimeInstallationId ?? "",
            workspaceInstanceId: project.workspaceInstanceId ?? "",
          },
          runtime: { adapterId: project.runtimeId ?? "mock", protocolVersion: "0.1" },
          snapshotRef: input.snapshotRef ?? "mock:success",
          orchestrationMode,
        });
        run.handleId = handle.handleId;
        run.status = ctx.engine.nextRunStatus(run.status, "begin-start");
        run.status = ctx.engine.nextRunStatus(run.status, "attach");
        touch(run, now);
        if (live.status === "queued") {
          dispatchTask(ctx, live.id);
        }
        await appendEvent(ctx.world, tx, {
          type: "run.started",
          subjectType: "run",
          subjectId: run.id,
          projectId: live.projectId,
          taskId: live.id,
          runId: run.id,
          correlationId: input.operationId,
          data: { to: run.status },
        });
        return { run };
      },
    ).then((result) => ({ reused: result.reused, run: result.value.run }));
  });
}

export function recordRunSucceeded(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "succeed");
  touch(run, ctx.world.nowIso());
  evaluateTaskAfterRun(ctx, run.taskId);
  return run;
}

export function recordRunFailed(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "fail");
  touch(run, ctx.world.nowIso());
  return run;
}

export function recordRunTimedOut(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "timeout");
  touch(run, ctx.world.nowIso());
  return run;
}

export async function cancelRun(
  ctx: AppContext,
  input: { operationId: string; idempotencyKey: string; runId: string },
): Promise<{ accepted: true; status: RunRecord["status"]; cancelRequestedAt: string }> {
  const run = requireRun(ctx, input.runId);
  if (run.status === "cancelled") {
    if (!run.cancelRequestedAt) {
      const now = ctx.world.nowIso();
      run.cancelRequestedAt = now;
      touch(run, now);
    }
    return {
      accepted: true,
      status: run.status,
      cancelRequestedAt: run.cancelRequestedAt,
    };
  }
  if (run.status === "succeeded" || run.status === "failed" || run.status === "timed_out") {
    throw new UseCaseError("invalid_transition", `run cannot 'cancel' from '${run.status}'`, {
      details: { entity: "run", id: run.id, from: run.status, command: "cancel" },
    });
  }
  if (run.cancelRequestedAt) {
    return { accepted: true, status: run.status, cancelRequestedAt: run.cancelRequestedAt };
  }

  if (run.handleId) {
    const result = await ctx.host.cancel(run.handleId, "user_cancel");
    if (!result.accepted) {
      throw new UseCaseError("conflict", "runtime did not accept run cancellation", {
        retryable: true,
        details: { runId: run.id, handleId: run.handleId },
      });
    }
  }

  const now = ctx.world.nowIso();
  run.cancelRequestedAt = now;
  touch(run, now);
  return { accepted: true, status: run.status, cancelRequestedAt: now };
}

export function settleRunCancel(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "cancel-settled");
  touch(run, ctx.world.nowIso());
  return run;
}

export async function pauseRun(ctx: AppContext, runId: string): Promise<never> {
  const run = requireRun(ctx, runId);
  if (run.handleId) {
    try {
      await ctx.host.pause(run.handleId);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "unsupported_capability"
      ) {
        throw unsupportedPause();
      }
      throw error;
    }
  }
  throw unsupportedPause();
}

export function requireRun(ctx: AppContext, runId: string): RunRecord {
  const run = ctx.world.runs.get(runId);
  if (!run) {
    throw notFound("run", runId);
  }
  return run;
}
