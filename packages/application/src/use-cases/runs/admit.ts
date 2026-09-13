import { startIdempotencyKey } from "@workforce/domain";
import {
  DEFAULT_ORCHESTRATION_MODE,
  type OrchestrationMode,
  type PlacementIntent,
} from "@workforce/protocol";

import { assertExecutionBinding } from "../projects/admission.js";
import type { AppContext } from "../projects/context.js";
import { expectRevision, touch } from "../projects/context.js";
import { notFound, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { captureProjectPolicySnapshot } from "../projects/policy-snapshot.js";
import { requireProject } from "../projects/projects.js";
import type { RunRecord, TaskRecord } from "../projects/store.js";
import { dispatchTask, queueTask, requireTask } from "../tasks/tasks.js";
import { assembleRunExecutionSnapshot } from "./execution-snapshot.js";
import { acquireManagedRunLease, nodeSessionForCandidate } from "./lease.js";
import { DEFAULT_PLACEMENT_INTENT } from "./placement.js";

export interface AdmitRunInput {
  operationId: string;
  idempotencyKey?: string;
  taskId: string;
  expectedStateRevision?: number;
  orchestrationMode?: OrchestrationMode;
  placementIntent?: PlacementIntent;
  snapshotRef?: string;
  /** Only `workflow_bound` may require a WorkflowInstance. Direct never sets this. */
  requireWorkflowBinding?: boolean;
}

/**
 * Single Run admission for workflow-bound and direct. Both paths resolve
 * axes, Policy/Workspace/budget/Approval, Node/Runtime and Lease before the
 * Run exists. Direct never creates a NodeInstance or advances a
 * WorkflowInstance / Project.
 */
export async function admitRun(
  ctx: AppContext,
  input: AdmitRunInput,
): Promise<{ reused: boolean; run: RunRecord }> {
  const task = requireTask(ctx, input.taskId);
  const project = requireProject(ctx, task.projectId);
  const orchestrationMode = input.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE;
  const requireWorkflowBinding =
    orchestrationMode === "direct" ? false : input.requireWorkflowBinding === true;
  assertModeAgainstTask(task, orchestrationMode, requireWorkflowBinding);

  const intent = input.placementIntent ?? project.placementIntent ?? DEFAULT_PLACEMENT_INTENT;
  const placement = ctx.placement.resolve({
    intent: intent.nodeId ? { mode: intent.mode, nodeId: intent.nodeId } : { mode: intent.mode },
    inventory: {
      ...(project.executionNodeId ? { nodeId: project.executionNodeId } : {}),
      ...(project.runtimeInstallationId
        ? { runtimeInstallationId: project.runtimeInstallationId }
        : {}),
      ...(project.workspaceInstanceId ? { workspaceInstanceId: project.workspaceInstanceId } : {}),
    },
  });
  const hostSession = ctx.host.ensureNodeSession ? await ctx.host.ensureNodeSession() : undefined;
  const session = nodeSessionForCandidate(hostSession, placement.candidate, () =>
    ctx.world.ids.ulid("ses_"),
  );
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

  const admitted = await ctx.world.uow.withTransaction(async (tx) => {
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
          placementIntent: input.placementIntent,
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
        return ctx.world.withDomainRollback(async () => {
          const live = requireTask(ctx, input.taskId);
          expectRevision(live, input.expectedStateRevision);
          const liveProject = requireProject(ctx, live.projectId);
          if (liveProject.id !== project.id || live.projectId !== project.id) {
            throw validationFailed("task does not belong to this project");
          }
          if (liveProject.organizationId.trim() === "") {
            throw validationFailed("project organization is required");
          }
          if (liveProject.status === "paused" || liveProject.cancelRequestedAt) {
            throw validationFailed("project is not accepting new work");
          }
          assertModeAgainstTask(live, orchestrationMode, requireWorkflowBinding);
          assertGovernance(ctx, live, liveProject, orchestrationMode, requireWorkflowBinding);

          const existingActive = ctx.world.activeRunForTask(live.id);
          if (existingActive) {
            return { run: existingActive };
          }
          const now = ctx.world.nowIso();
          const runId = ctx.world.ids.ulid("run_");
          const leased = acquireManagedRunLease(ctx.world, {
            runId,
            candidate: placement.candidate,
            session,
            reason: placement.reason,
            now,
          });
          const workflowBound =
            orchestrationMode === "workflow_bound" && live.workflowInstanceId !== undefined;
          let executionSnapshot;
          let directPolicy: ReturnType<typeof captureProjectPolicySnapshot> | undefined;
          if (orchestrationMode === "direct") {
            directPolicy = captureProjectPolicySnapshot({
              project: liveProject,
              principalId: ctx.principalId,
              capturedAt: now,
            });
            executionSnapshot = assembleRunExecutionSnapshot({
              orchestrationMode: "direct",
              transport: placement.candidate.transport,
              placementSnapshot: leased.placementSnapshot,
            });
          } else if (workflowBound) {
            const snapshot = liveProject.executionSnapshotId
              ? ctx.world.executionSnapshots.get(liveProject.executionSnapshotId)
              : undefined;
            if (!snapshot) {
              throw validationFailed("workflow_bound run requires an execution snapshot");
            }
            const workflow = live.workflowInstanceId
              ? ctx.world.workflows.get(live.workflowInstanceId)
              : undefined;
            assertExecutionBinding({
              project: liveProject,
              snapshot,
              ...(workflow ? { workflow } : {}),
              task: live,
            });
            executionSnapshot = assembleRunExecutionSnapshot({
              orchestrationMode: "workflow_bound",
              transport: placement.candidate.transport,
              executionSnapshotId: snapshot.id,
              placementSnapshot: leased.placementSnapshot,
            });
          }

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
            ...(executionSnapshot ? { executionSnapshot } : {}),
          };
          ctx.world.runs.set(run.id, run);

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
            data: {
              to: run.status,
              orchestrationMode,
              transport: placement.candidate.transport,
              executionLeaseId: leased.lease.id,
              fencingToken: leased.lease.fencingToken,
              ...(directPolicy
                ? {
                    policySnapshot: directPolicy,
                    budgetId: liveProject.budgetId,
                  }
                : {}),
            },
          });
          return { run };
        });
      },
    );
  });
  return { reused: admitted.reused, run: admitted.value.run };
}

function assertModeAgainstTask(
  task: TaskRecord,
  mode: OrchestrationMode,
  requireWorkflowBinding: boolean,
): void {
  if (mode === "direct") {
    if (task.workflowInstanceId !== undefined || task.workflowNodeId !== undefined) {
      throw validationFailed("direct execution never targets an existing WorkflowInstance");
    }
    return;
  }
  if (requireWorkflowBinding && task.workflowInstanceId === undefined) {
    throw validationFailed("workflow_bound run requires a workflow-bound Task");
  }
}

function assertGovernance(
  ctx: AppContext,
  task: TaskRecord,
  project: ReturnType<typeof requireProject>,
  mode: OrchestrationMode,
  requireWorkflowBinding: boolean,
): void {
  if (
    (mode === "direct" || requireWorkflowBinding) &&
    !project.workspaceId &&
    !project.workspaceInstanceId
  ) {
    throw validationFailed("run start requires a workspace");
  }
  if (mode === "direct") {
    if (!project.budgetId || !ctx.world.budgets.get(project.budgetId)) {
      throw validationFailed("run start requires a budget");
    }
  }
  const blocking = [...ctx.world.approvals.values()].find(
    (approval) =>
      approval.projectId === project.id &&
      approval.status === "pending" &&
      ((approval.gate === "action" && approval.taskId === task.id) ||
        (approval.gate === "plan" && mode === "workflow_bound" && project.status === "planning")),
  );
  if (blocking) {
    throw validationFailed(`run start blocked by pending ${blocking.gate} approval`);
  }
}

export function requireRun(ctx: AppContext, runId: string): RunRecord {
  const run = ctx.world.runs.get(runId);
  if (!run) {
    throw notFound("run", runId);
  }
  return run;
}

export function attachHostAfterAdmit(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey: string;
    run: RunRecord;
    snapshotRef?: string;
  },
): Promise<void> {
  return attachIfNeeded(ctx, input);
}

async function attachIfNeeded(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey: string;
    run: RunRecord;
    snapshotRef?: string;
  },
): Promise<void> {
  const run = requireRun(ctx, input.run.id);
  if (run.handleId) {
    return;
  }
  const project = requireProject(ctx, run.projectId);
  const snapshot = run.executionSnapshot;
  const lease = ctx.world.leaseForRun(run.id);
  const placement =
    snapshot?.placementSnapshot ?? ctx.world.schedulingRecordForRun(run.id)?.placementSnapshot;
  let nodeSessionId = placement?.nodeSessionId;
  if (lease && nodeSessionId === undefined && ctx.host.ensureNodeSession) {
    nodeSessionId = (await ctx.host.ensureNodeSession()).nodeSessionId;
  }
  const handle = await ctx.host.start({
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    taskId: run.taskId,
    definitionRevision: run.definitionRevision,
    generation: run.generation,
    attempt: run.attempt,
    principalId: ctx.principalId,
    clientId: ctx.clientId,
    placement: {
      executionNodeId: placement?.nodeId ?? project.executionNodeId ?? "",
      runtimeInstallationId:
        placement?.runtimeInstallationId ?? project.runtimeInstallationId ?? "",
      workspaceInstanceId: placement?.workspaceInstanceId ?? project.workspaceInstanceId ?? "",
    },
    runtime: { adapterId: project.runtimeId ?? "mock", protocolVersion: "0.1" },
    snapshotRef: input.snapshotRef ?? "mock:success",
    orchestrationMode: run.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE,
    ...(lease && nodeSessionId
      ? {
          executionLease: {
            id: lease.id,
            fencingToken: lease.fencingToken,
            nodeSessionId,
            runId: run.id,
          },
        }
      : {}),
  });
  await ctx.world.uow.withTransaction(async () => {
    run.handleId = handle.handleId;
    run.status = ctx.engine.nextRunStatus(run.status, "begin-start");
    run.status = ctx.engine.nextRunStatus(run.status, "attach");
    touch(run, ctx.world.nowIso());
  });
}
