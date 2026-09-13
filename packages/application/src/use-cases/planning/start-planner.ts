import type { CommandReceipt, ProtocolError, WorkforceEvent } from "@workforce/protocol";
import { protocolError } from "@workforce/protocol";

import { bindTeamVersionGuardError } from "../projects/progress.js";
import { contentDigest } from "./digest.js";
import type { StartPlannerDeps } from "./ports.js";
import {
  PLANNER_SNAPSHOT_REF,
  PLANNER_WORKER_REF,
  type PlannerProjectRecord,
  type StartPlannerCommand,
  type StartPlannerResult,
  type StartPlannerSuccess,
} from "./types.js";

const CANONICAL_OPERATION = "project.start_planner";

function fail(error: ProtocolError): StartPlannerResult {
  return { ok: false, error };
}

function requestDigest(command: StartPlannerCommand): string {
  return contentDigest({
    projectId: command.projectId,
    objective: command.objective,
    snapshotRef: command.snapshotRef ?? PLANNER_SNAPSHOT_REF,
  });
}

function receiptResult(value: unknown): StartPlannerSuccess | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { ok?: unknown; taskId?: unknown; runId?: unknown };
  if (record.ok !== true || typeof record.taskId !== "string" || typeof record.runId !== "string") {
    return undefined;
  }
  const handleId =
    "handleId" in record && typeof record.handleId === "string" ? record.handleId : undefined;
  return {
    ok: true,
    replayed: true,
    taskId: record.taskId,
    runId: record.runId,
    ...(handleId !== undefined ? { handleId } : {}),
  };
}

function placementReady(project: PlannerProjectRecord): ProtocolError | undefined {
  if (!project.workspaceId || !project.teamVersionId || !project.runtimeId || !project.budgetId) {
    return protocolError(
      "invalid_transition",
      "planner requires workspace, team, runtime, and budget bindings",
    );
  }
  if (!project.executionNodeId || !project.runtimeInstallationId || !project.workspaceInstanceId) {
    return protocolError(
      "invalid_transition",
      "planner run requires node, runtime installation, and workspace placement",
    );
  }
  return undefined;
}

function plannerStartedEvent(input: {
  id: string;
  command: StartPlannerCommand;
  now: string;
  taskId: string;
  runId: string;
  replayed: boolean;
}): WorkforceEvent {
  return {
    specVersion: "0.1",
    id: input.id,
    type: "project.planner_run_started",
    source: "workforce.application.planning",
    subject: { type: "task", id: input.taskId },
    time: input.now,
    recordedAt: input.now,
    projectId: input.command.projectId,
    taskId: input.taskId,
    runId: input.runId,
    actor: { type: "user", id: input.command.principalId },
    stream: `project:${input.command.projectId}`,
    correlationId: input.command.operationId,
    dataContentType: "application/json",
    dataSchema: "urn:workforce:event:project.planner_run_started:0.1",
    data: {
      taskId: input.taskId,
      runId: input.runId,
      via: "task_run",
      runtimeAdapterDirect: false,
      replayed: input.replayed,
    },
    sensitivity: "internal",
  };
}

function runIsReusable(status: string): boolean {
  return (
    status === "pending" || status === "starting" || status === "running" || status === "succeeded"
  );
}

/**
 * Starts the software-development-team Planner as an ordinary Task/Run.
 * The Runtime SPI Host is reached only through `deps.runs.startRun`.
 */
export async function startPlanner(
  command: StartPlannerCommand,
  deps: StartPlannerDeps,
): Promise<StartPlannerResult> {
  if (command.objective.trim() === "") {
    return fail(protocolError("validation_failed", "planner objective is required"));
  }

  const scope = {
    principalId: command.principalId,
    clientId: command.clientId,
    canonicalOperation: CANONICAL_OPERATION,
    resource: `project:${command.projectId}:planner`,
    idempotencyKey: command.idempotencyKey,
  };
  const digest = requestDigest(command);
  const existingReceipt = await deps.receipts.get(scope);
  if (existingReceipt) {
    if (existingReceipt.requestDigest !== digest) {
      return fail(
        protocolError(
          "idempotency_key_reused",
          "startPlanner idempotency key reused with different payload",
        ),
      );
    }
    if (existingReceipt.status === "committed") {
      const replayed = receiptResult(existingReceipt.result);
      if (replayed) {
        return replayed;
      }
    }
  }

  const project = await deps.projects.get(command.projectId);
  if (!project) {
    return fail(protocolError("not_found", `project ${command.projectId} not found`));
  }
  if (project.status !== "planning") {
    return fail(
      protocolError("invalid_transition", "project must be in planning to start the planner", {
        details: { status: project.status },
      }),
    );
  }
  const placementError = placementReady(project);
  if (placementError) {
    return fail(placementError);
  }
  const bindError = bindTeamVersionGuardError(project.teamVersionId, deps.teamVersions);
  if (bindError) {
    return fail(bindError);
  }

  const existingTask = await deps.tasks.getByProject(command.projectId);
  if (existingTask) {
    const existingRun = await deps.runRecords.getByTask(existingTask.taskId);
    if (existingRun && runIsReusable(existingRun.status)) {
      return {
        ok: true,
        replayed: true,
        taskId: existingTask.taskId,
        runId: existingRun.runId,
        ...(existingRun.handleId !== undefined ? { handleId: existingRun.handleId } : {}),
      };
    }
  }

  const snapshotRef = command.snapshotRef ?? PLANNER_SNAPSHOT_REF;
  const now = deps.clock.now().toISOString();
  const taskId = existingTask?.taskId ?? deps.ids.ulid("tsk_");

  const receipt: CommandReceipt = {
    operationId: command.operationId,
    status: "pending",
    scope,
    requestDigest: digest,
    acceptedAt: now,
  };

  await deps.uow.withTransaction(async (tx) => {
    if (!existingReceipt) {
      await deps.receipts.putPending(tx, receipt);
    }
    if (!existingTask) {
      await deps.tasks.put({
        taskId,
        projectId: command.projectId,
        role: "planner",
        title: "Produce software-development plan",
        status: "ready",
        definitionRevision: 1,
        generation: 1,
        attempt: 1,
        workerRef: PLANNER_WORKER_REF,
      });
    }
  });

  const started = await deps.runs.startRun({
    operationId: `${command.operationId}:run`,
    idempotencyKey: `${command.idempotencyKey}:run`,
    taskId,
    snapshotRef,
  });

  const success: StartPlannerSuccess = {
    ok: true,
    replayed: started.reused,
    taskId,
    runId: started.runId,
    ...(started.handleId !== undefined ? { handleId: started.handleId } : {}),
  };

  await deps.uow.withTransaction(async (tx) => {
    await deps.events.append(
      tx,
      plannerStartedEvent({
        id: deps.ids.ulid("evt_"),
        command,
        now: deps.clock.now().toISOString(),
        taskId,
        runId: started.runId,
        replayed: started.reused,
      }),
    );
    await deps.receipts.complete(tx, command.operationId, success);
  });

  return success;
}
