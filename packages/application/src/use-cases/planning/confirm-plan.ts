import type { CommandReceipt, ProtocolError, WorkforceEvent } from "@workforce/protocol";
import { protocolError } from "@workforce/protocol";

import { contentDigest } from "./digest.js";
import type { ConfirmPlanDeps } from "./ports.js";
import { parsePlanArtifact } from "./schema.js";
import type {
  ConfirmPlanCommand,
  ConfirmPlanResult,
  ConfirmPlanSuccess,
  ConfirmedWorkflowVersion,
  PlanApprovalRecord,
} from "./types.js";
import { describeWorkflowVersion } from "./workflow-version.js";

const CANONICAL_OPERATION = "project.confirm_plan";

function fail(error: ProtocolError): ConfirmPlanResult {
  return { ok: false, error };
}

function requestDigest(command: ConfirmPlanCommand): string {
  return contentDigest({
    projectId: command.projectId,
    planArtifactVersionId: command.planArtifactVersionId,
    planDigest: command.planDigest,
    approvalId: command.approvalId,
  });
}

function receiptResult(value: unknown): ConfirmPlanSuccess | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as { ok?: unknown; workflowVersion?: unknown };
  if (record.ok !== true || !record.workflowVersion || typeof record.workflowVersion !== "object") {
    return undefined;
  }
  return {
    ok: true,
    replayed: true,
    workflowVersion: record.workflowVersion as ConfirmedWorkflowVersion,
  };
}

function approvalAllowsPublish(approval: PlanApprovalRecord, now: Date): ProtocolError | undefined {
  if (approval.gate !== "plan") {
    return protocolError("forbidden", "approval gate must be plan");
  }
  if (approval.status === "expired" || new Date(approval.expiresAt).getTime() <= now.getTime()) {
    return protocolError("invalid_transition", "plan approval has expired");
  }
  if (approval.status === "rejected" || approval.status === "cancelled") {
    return protocolError("invalid_transition", "plan is not approved", {
      details: { status: approval.status },
    });
  }
  if (approval.status === "pending" || approval.status === "changes_requested") {
    return protocolError("invalid_transition", "plan is not approved", {
      details: { status: approval.status },
    });
  }
  if (
    approval.status !== "approved" &&
    approval.status !== "consumed" &&
    approval.status !== "superseded"
  ) {
    return protocolError("invalid_transition", "plan is not approved", {
      details: { status: approval.status },
    });
  }
  return undefined;
}

function planConfirmedEvent(input: {
  id: string;
  command: ConfirmPlanCommand;
  now: string;
  workflowVersionId: string;
  planDigest: string;
  replayed: boolean;
}): WorkforceEvent {
  return {
    specVersion: "0.1",
    id: input.id,
    type: "project.plan_confirmed",
    source: "workforce.application.planning",
    subject: { type: "project", id: input.command.projectId },
    time: input.now,
    recordedAt: input.now,
    projectId: input.command.projectId,
    actor: { type: "user", id: input.command.principalId },
    stream: `project:${input.command.projectId}`,
    correlationId: input.command.operationId,
    dataContentType: "application/json",
    dataSchema: "urn:workforce:event:project.plan_confirmed:0.1",
    data: {
      planArtifactVersionId: input.command.planArtifactVersionId,
      planDigest: input.planDigest,
      workflowVersionId: input.workflowVersionId,
      workflowStarted: false,
      replayed: input.replayed,
    },
    sensitivity: "internal",
  };
}

export async function confirmPlan(
  command: ConfirmPlanCommand,
  deps: ConfirmPlanDeps,
): Promise<ConfirmPlanResult> {
  const scope = {
    principalId: command.principalId,
    clientId: command.clientId,
    canonicalOperation: CANONICAL_OPERATION,
    resource: `project:${command.projectId}:plan:${command.planArtifactVersionId}`,
    idempotencyKey: command.idempotencyKey,
  };
  const digest = requestDigest(command);
  const existingReceipt = await deps.receipts.get(scope);
  if (existingReceipt) {
    if (existingReceipt.requestDigest !== digest) {
      return fail(
        protocolError(
          "idempotency_key_reused",
          "confirmPlan idempotency key reused with different payload",
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

  const artifact = await deps.plans.get(command.planArtifactVersionId);
  if (!artifact) {
    return fail(
      protocolError("not_found", `plan artifact ${command.planArtifactVersionId} not found`),
    );
  }
  if (artifact.status !== "available") {
    return fail(
      protocolError("invalid_transition", "plan artifact is not available", {
        details: { status: artifact.status },
      }),
    );
  }

  const parsed = parsePlanArtifact(artifact.body);
  if (!parsed.ok) {
    return parsed;
  }
  const computedDigest = contentDigest(parsed.plan);
  if (computedDigest !== command.planDigest || computedDigest !== artifact.hash) {
    return fail(
      protocolError("conflict", "plan digest mismatch", {
        details: { expected: computedDigest, provided: command.planDigest, stored: artifact.hash },
      }),
    );
  }

  const approval = await deps.approvals.get(command.approvalId);
  if (!approval) {
    return fail(protocolError("not_found", `approval ${command.approvalId} not found`));
  }
  if (approval.projectId !== command.projectId) {
    return fail(protocolError("forbidden", "approval does not belong to this project"));
  }
  if (approval.planArtifactVersionId !== command.planArtifactVersionId) {
    return fail(protocolError("conflict", "approval is bound to a different plan version"));
  }
  if (approval.digest !== computedDigest) {
    return fail(protocolError("conflict", "approval digest does not match plan"));
  }

  const now = deps.clock.now();
  const approvalError = approvalAllowsPublish(approval, now);
  if (approvalError) {
    return fail(approvalError);
  }

  const already = await deps.confirmed.getByProject(command.projectId);
  if (already) {
    if (
      already.planArtifactVersionId === command.planArtifactVersionId &&
      already.planDigest === computedDigest
    ) {
      return { ok: true, replayed: true, workflowVersion: already };
    }
    return fail(
      protocolError("conflict", "project already has a confirmed workflow version", {
        details: { workflowVersionId: already.workflowVersionId },
      }),
    );
  }

  if (project.status !== "planning") {
    return fail(
      protocolError("invalid_transition", "project must be in planning to confirm a plan", {
        details: { status: project.status },
      }),
    );
  }

  if (approval.status === "consumed" || approval.status === "superseded") {
    return fail(
      protocolError(
        "invalid_transition",
        "plan approval was consumed without a confirmed workflow",
      ),
    );
  }

  const publishedAt = now.toISOString();
  const workflowVersion = describeWorkflowVersion({
    workflowVersionId: deps.ids.ulid("wfv_"),
    version: 1,
    projectId: command.projectId,
    planArtifactVersionId: command.planArtifactVersionId,
    planDigest: computedDigest,
    publishedAt,
    plan: parsed.plan,
  });

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
    await deps.confirmed.put(workflowVersion);
    if (approval.status === "approved") {
      await deps.approvals.consume(command.approvalId, publishedAt);
    }
    await deps.events.append(
      tx,
      planConfirmedEvent({
        id: deps.ids.ulid("evt_"),
        command,
        now: publishedAt,
        workflowVersionId: workflowVersion.workflowVersionId,
        planDigest: computedDigest,
        replayed: false,
      }),
    );
    await deps.receipts.complete(tx, command.operationId, {
      ok: true,
      replayed: false,
      workflowVersion,
    });
  });

  return { ok: true, replayed: false, workflowVersion };
}
