import { startIdempotencyKey } from "@workforce/domain";
import {
  DEFAULT_ORCHESTRATION_MODE,
  type OrchestrationMode,
  type PlacementIntent,
} from "@workforce/protocol";

import type { AppContext } from "../projects/context.js";
import { touch } from "../projects/context.js";
import { UseCaseError } from "../projects/errors.js";
import { evaluateTaskAfterFailure, evaluateTaskAfterRun, requireTask } from "../tasks/tasks.js";
import { requireProject } from "../projects/projects.js";
import type { RunRecord } from "../projects/store.js";
import { admitRun, attachHostAfterAdmit, requireRun } from "./admit.js";
import { unsupportedPause } from "./host.js";
import { markRunSchedulingCancelled } from "./lease.js";

export async function startRun(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey?: string;
    taskId: string;
    expectedStateRevision?: number;
    snapshotRef?: string;
    orchestrationMode?: OrchestrationMode;
    placementIntent?: PlacementIntent;
  },
): Promise<{ reused: boolean; run: RunRecord }> {
  const task = requireTask(ctx, input.taskId);
  const project = requireProject(ctx, task.projectId);
  const orchestrationMode =
    input.orchestrationMode ?? project.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE;
  return startTaskRun(ctx, { ...input, orchestrationMode });
}

/**
 * HTTP `POST /tasks/{id}/runs` entry. Omit `orchestrationMode` → workflow_bound.
 * Direct and workflow-bound share this command; the body selects the mode.
 */
export async function startTaskRun(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey?: string;
    taskId: string;
    expectedStateRevision?: number;
    orchestrationMode?: OrchestrationMode;
    placementIntent?: PlacementIntent;
    snapshotRef?: string;
    requireWorkflowBinding?: boolean;
  },
): Promise<{ reused: boolean; run: RunRecord }> {
  const task = requireTask(ctx, input.taskId);
  const idempotencyKey =
    input.idempotencyKey ??
    startIdempotencyKey({
      taskId: task.id,
      definitionRevision: task.definitionRevision,
      generation: task.generation,
      attempt: task.attempt,
    });
  const admitted = await admitRun(ctx, {
    operationId: input.operationId,
    idempotencyKey,
    taskId: input.taskId,
    orchestrationMode: input.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE,
    ...(input.requireWorkflowBinding ? { requireWorkflowBinding: true } : {}),
    ...(input.expectedStateRevision !== undefined
      ? { expectedStateRevision: input.expectedStateRevision }
      : {}),
    ...(input.placementIntent ? { placementIntent: input.placementIntent } : {}),
    ...(input.snapshotRef ? { snapshotRef: input.snapshotRef } : {}),
  });
  if (!admitted.reused || !admitted.run.handleId) {
    await attachHostAfterAdmit(ctx, {
      operationId: input.operationId,
      idempotencyKey,
      run: admitted.run,
      ...(input.snapshotRef ? { snapshotRef: input.snapshotRef } : {}),
    });
  }
  return { reused: admitted.reused, run: requireRun(ctx, admitted.run.id) };
}

export function recordRunSucceeded(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  if (run.orchestrationMode === "direct") {
    run.status = ctx.engine.nextRunStatus(run.status, "succeed");
    touch(run, ctx.world.nowIso());
    evaluateTaskAfterRun(ctx, run.taskId);
    return run;
  }
  run.status = ctx.engine.nextRunStatus(run.status, "succeed");
  touch(run, ctx.world.nowIso());
  evaluateTaskAfterRun(ctx, run.taskId);
  return run;
}

export function recordRunFailed(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "fail");
  touch(run, ctx.world.nowIso());
  evaluateTaskAfterFailure(ctx, run.taskId);
  return run;
}

export function recordRunTimedOut(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "timeout");
  touch(run, ctx.world.nowIso());
  evaluateTaskAfterFailure(ctx, run.taskId);
  return run;
}

export async function timeoutRun(ctx: AppContext, input: { runId: string }): Promise<RunRecord> {
  const run = requireRun(ctx, input.runId);
  if (run.handleId) {
    await ctx.host.cancel(run.handleId, "timeout");
  }
  return recordRunTimedOut(ctx, run.id);
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
  markRunSchedulingCancelled(ctx.world, run.id);
  touch(run, now);
  return { accepted: true, status: run.status, cancelRequestedAt: now };
}

export function settleRunCancel(ctx: AppContext, runId: string): RunRecord {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "cancel-settled");
  touch(run, ctx.world.nowIso());
  return run;
}

export async function pauseRun(ctx: AppContext, runId: string): Promise<RunRecord> {
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
  } else {
    throw unsupportedPause();
  }
  run.status = ctx.engine.nextRunStatus(run.status, "pause");
  touch(run, ctx.world.nowIso());
  return run;
}

export async function resumeRun(ctx: AppContext, runId: string): Promise<RunRecord> {
  const run = requireRun(ctx, runId);
  run.status = ctx.engine.nextRunStatus(run.status, "resume");
  touch(run, ctx.world.nowIso());
  return run;
}

export { requireRun } from "./admit.js";
