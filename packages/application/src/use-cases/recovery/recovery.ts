import type { AppContext } from "../projects/context.js";
import { requireProject } from "../projects/projects.js";
import { settleRunCancel } from "../runs/runs.js";
import { settleTaskCancel } from "../tasks/tasks.js";
import type { ProjectRecord, RunRecord } from "../projects/store.js";

export interface ReconcileResult {
  attached: boolean;
  unknown: string[];
  cancelled: string[];
  project?: ProjectRecord;
}

/**
 * Restart reconcile: inspect existing handles, never start a second active Run
 * for unknown/orphaned processes.
 */
export async function reconcile(ctx: AppContext, projectId: string): Promise<ReconcileResult> {
  const project = requireProject(ctx, projectId);
  const unknown: string[] = [];
  const cancelled: string[] = [];
  for (const run of ctx.world.runs.values()) {
    if (run.projectId !== projectId) {
      continue;
    }
    if (
      run.status === "succeeded" ||
      run.status === "failed" ||
      run.status === "timed_out" ||
      run.status === "cancelled"
    ) {
      ctx.world.unknownStatuses.delete(run.id);
      continue;
    }

    if (!run.handleId) {
      ctx.world.unknownStatuses.add(run.id);
      unknown.push(run.id);
      continue;
    }

    let inspected: { status: string };
    try {
      inspected = await ctx.host.inspect(run.handleId);
    } catch {
      ctx.world.unknownStatuses.add(run.id);
      unknown.push(run.id);
      continue;
    }

    if (inspected.status === "cancelled") {
      const recoveredCancelAt = run.cancelRequestedAt ?? ctx.world.nowIso();
      settleRunCancel(ctx, run.id);
      run.cancelRequestedAt ??= recoveredCancelAt;
      settleTaskCancel(ctx, run.taskId);
      ctx.world.unknownStatuses.delete(run.id);
      cancelled.push(run.id);
      continue;
    }

    if (inspected.status === "unknown" || inspected.status === "orphaned") {
      ctx.world.unknownStatuses.add(run.id);
      unknown.push(run.id);
      continue;
    }

    ctx.world.unknownStatuses.delete(run.id);
  }

  if (project.cancelRequestedAt && project.status !== "cancelled") {
    const active = ctx.world
      .tasksForProject(project.id)
      .some((task) => Boolean(ctx.world.activeRunForTask(task.id)));
    if (!active) {
      const workflow = project.workflowInstanceId
        ? ctx.world.workflows.get(project.workflowInstanceId)
        : undefined;
      if (workflow && workflow.status === "cancelling") {
        workflow.status = ctx.engine.nextWorkflowStatus(workflow.status, "settle");
        workflow.stateRevision += 1;
      }
      if (project.status === "running" || project.status === "paused") {
        project.status = ctx.engine.nextProjectStatus(project.status, "cancel-settled");
        project.stateRevision += 1;
      } else if (
        project.status === "draft" ||
        project.status === "ready" ||
        project.status === "planning"
      ) {
        project.status = ctx.engine.nextProjectStatus(project.status, "cancel");
        project.stateRevision += 1;
      }
    }
  }

  return { attached: unknown.length === 0, unknown, cancelled, project };
}

export function markRunUnknown(ctx: AppContext, runId: string): RunRecord | undefined {
  ctx.world.unknownStatuses.add(runId);
  return ctx.world.runs.get(runId);
}
