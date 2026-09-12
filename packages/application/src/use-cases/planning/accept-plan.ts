import type { CommandReceipt, ProtocolError, WorkforceEvent } from "@workforce/protocol";
import { protocolError } from "@workforce/protocol";

import { contentDigest } from "./digest.js";
import type { AcceptPlannerArtifactDeps } from "./ports.js";
import { parsePlanArtifact } from "./schema.js";
import type {
  AcceptPlannerArtifactCommand,
  AcceptPlannerArtifactResult,
  AcceptPlannerArtifactSuccess,
  PlanApprovalRecord,
} from "./types.js";

const CANONICAL_OPERATION = "project.accept_plan_artifact";
const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function fail(error: ProtocolError): AcceptPlannerArtifactResult {
  return { ok: false, error };
}

function requestDigest(command: AcceptPlannerArtifactCommand): string {
  return contentDigest({
    projectId: command.projectId,
    taskId: command.taskId,
    runId: command.runId,
  });
}

function receiptResult(value: unknown): AcceptPlannerArtifactSuccess | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as {
    ok?: unknown;
    planArtifactVersionId?: unknown;
    planDigest?: unknown;
    approvalId?: unknown;
    plan?: unknown;
  };
  if (
    record.ok !== true ||
    typeof record.planArtifactVersionId !== "string" ||
    typeof record.planDigest !== "string" ||
    typeof record.approvalId !== "string" ||
    !record.plan ||
    typeof record.plan !== "object"
  ) {
    return undefined;
  }
  return {
    ok: true,
    replayed: true,
    planArtifactVersionId: record.planArtifactVersionId,
    planDigest: record.planDigest,
    approvalId: record.approvalId,
    plan: record.plan as AcceptPlannerArtifactSuccess["plan"],
  };
}

function planAcceptedEvent(input: {
  id: string;
  command: AcceptPlannerArtifactCommand;
  now: string;
  planArtifactVersionId: string;
  planDigest: string;
  approvalId: string;
  replayed: boolean;
}): WorkforceEvent {
  return {
    specVersion: "0.1",
    id: input.id,
    type: "project.plan_artifact_accepted",
    source: "workforce.application.planning",
    subject: { type: "artifact_version", id: input.planArtifactVersionId },
    time: input.now,
    recordedAt: input.now,
    projectId: input.command.projectId,
    taskId: input.command.taskId,
    runId: input.command.runId,
    actor: { type: "user", id: input.command.principalId },
    stream: `project:${input.command.projectId}`,
    correlationId: input.command.operationId,
    dataContentType: "application/json",
    dataSchema: "urn:workforce:event:project.plan_artifact_accepted:0.1",
    data: {
      planArtifactVersionId: input.planArtifactVersionId,
      planDigest: input.planDigest,
      approvalId: input.approvalId,
      taskId: input.command.taskId,
      runId: input.command.runId,
      workflowStarted: false,
      replayed: input.replayed,
    },
    sensitivity: "internal",
  };
}

/**
 * Validates a Planner Run's Plan Artifact, then records it for human plan-gate
 * confirmation. Does not publish a WorkflowVersion and does not start developers.
 */
export async function acceptPlannerArtifact(
  command: AcceptPlannerArtifactCommand,
  deps: AcceptPlannerArtifactDeps,
): Promise<AcceptPlannerArtifactResult> {
  const scope = {
    principalId: command.principalId,
    clientId: command.clientId,
    canonicalOperation: CANONICAL_OPERATION,
    resource: `project:${command.projectId}:run:${command.runId}:plan`,
    idempotencyKey: command.idempotencyKey,
  };
  const digest = requestDigest(command);
  const existingReceipt = await deps.receipts.get(scope);
  if (existingReceipt) {
    if (existingReceipt.requestDigest !== digest) {
      return fail(
        protocolError(
          "idempotency_key_reused",
          "acceptPlannerArtifact idempotency key reused with different payload",
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
      protocolError("invalid_transition", "project must be in planning to accept a plan", {
        details: { status: project.status },
      }),
    );
  }

  const confirmed = await deps.confirmed.getByProject(command.projectId);
  if (confirmed) {
    return fail(
      protocolError("conflict", "planner must not mutate an already confirmed workflow", {
        details: { workflowVersionId: confirmed.workflowVersionId },
      }),
    );
  }

  const task = await deps.tasks.get(command.taskId);
  if (!task) {
    return fail(protocolError("not_found", `planner task ${command.taskId} not found`));
  }
  if (task.projectId !== command.projectId || task.role !== "planner") {
    return fail(protocolError("forbidden", "run is not a planner task in this project"));
  }

  const run = await deps.runRecords.get(command.runId);
  if (!run) {
    return fail(protocolError("not_found", `run ${command.runId} not found`));
  }
  if (run.taskId !== command.taskId || run.projectId !== command.projectId) {
    return fail(protocolError("conflict", "run does not belong to the planner task"));
  }
  if (run.status !== "succeeded") {
    return fail(
      protocolError("invalid_transition", "planner run has not succeeded", {
        details: { status: run.status },
      }),
    );
  }

  const output = await deps.outputs.readPlanSlot({
    runId: command.runId,
    taskId: command.taskId,
  });
  if (!output) {
    return fail(
      protocolError("invalid_transition", "planner run did not produce out_plan", {
        details: { runId: command.runId, taskId: command.taskId },
      }),
    );
  }
  if (output.status !== "available") {
    return fail(
      protocolError("invalid_transition", "plan artifact is not available", {
        details: { status: output.status, artifactVersionId: output.artifactVersionId },
      }),
    );
  }

  const parsed = parsePlanArtifact(output.body);
  if (!parsed.ok) {
    return parsed;
  }
  const planDigest = contentDigest(parsed.plan);
  if (output.hash !== planDigest) {
    return fail(
      protocolError("conflict", "plan digest mismatch", {
        details: { expected: planDigest, stored: output.hash },
      }),
    );
  }

  const now = deps.clock.now();
  const publishedAt = now.toISOString();
  const expiresAt =
    command.approvalExpiresAt ?? new Date(now.getTime() + DEFAULT_APPROVAL_TTL_MS).toISOString();
  const approvalId = deps.ids.ulid("apr_");
  const approval: PlanApprovalRecord = {
    approvalId,
    gate: "plan",
    projectId: command.projectId,
    planArtifactVersionId: output.artifactVersionId,
    digest: planDigest,
    status: "pending",
    principalId: command.principalId,
    policyVersion: parsed.plan.policyRef,
    expiresAt,
  };

  const success: AcceptPlannerArtifactSuccess = {
    ok: true,
    replayed: false,
    planArtifactVersionId: output.artifactVersionId,
    planDigest,
    approvalId,
    plan: parsed.plan,
  };

  const receipt: CommandReceipt = {
    operationId: command.operationId,
    status: "pending",
    scope,
    requestDigest: digest,
    acceptedAt: publishedAt,
  };

  await deps.uow.withTransaction(async (tx) => {
    if (!existingReceipt) {
      await deps.receipts.putPending(tx, receipt);
    }
    await deps.plans.put({
      artifactVersionId: output.artifactVersionId,
      status: "available",
      hash: planDigest,
      body: parsed.plan,
      sourceRunId: command.runId,
      plannerTaskId: command.taskId,
    });
    await deps.approvals.create(approval);
    await deps.events.append(
      tx,
      planAcceptedEvent({
        id: deps.ids.ulid("evt_"),
        command,
        now: publishedAt,
        planArtifactVersionId: output.artifactVersionId,
        planDigest,
        approvalId,
        replayed: false,
      }),
    );
    await deps.receipts.complete(tx, command.operationId, success);
  });

  return success;
}
