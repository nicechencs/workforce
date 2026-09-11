import { afterEach, describe, expect, it } from "vitest";

import type { ApprovalDto, DesktopClient } from "@workforce/desktop-client";

import { ComposedDaemonHarnesses } from "../helpers/composed-daemon.js";

const harnesses = new ComposedDaemonHarnesses();

afterEach(async () => {
  await harnesses.closeAll();
});

async function pendingPlanApproval(client: DesktopClient, projectId: string): Promise<ApprovalDto> {
  const approvals = await client.listApprovals({ projectId, limit: 50 });
  const approval = approvals.items.find(
    (item) => item.gate === "plan" && item.status === "pending",
  );
  if (!approval) {
    throw new Error(`pending plan approval not found for ${projectId}`);
  }
  return approval;
}

describe("approval command governance through the production composition", () => {
  it("rejects a stale digest, replays the exact decision, and conflicts when its parameters change", async () => {
    const { client } = await harnesses.start({ testId: "t16-approval", completeAfterMs: 5 });
    const project = await client.createProject(
      { name: "Approval replay", objective: "keep the frozen plan decision stable" },
      { idempotencyKey: "create-project", operationId: "op_create_project" },
    );
    await client.startPlanning(project.id, {
      idempotencyKey: "start-planning",
      operationId: "op_start_planning",
      ifMatch: project.stateRevision,
    });
    const approval = await pendingPlanApproval(client, project.id);

    await expect(
      client.approve(
        approval.id,
        {
          decisionReason: "attempt to approve stale parameters",
          digest: "stale-action-digest",
          ...(approval.artifactVersionId ? { artifactVersionId: approval.artifactVersionId } : {}),
        },
        {
          idempotencyKey: "approve-stale",
          operationId: "op_approve_stale",
          ifMatch: approval.stateRevision,
        },
      ),
    ).rejects.toMatchObject({
      status: 409,
      problem: { code: "conflict" },
    });

    const stillPending = await client.getApproval(approval.id);
    expect(stillPending).toMatchObject({
      status: "pending",
      stateRevision: approval.stateRevision,
      actionDigest: approval.actionDigest,
    });

    const input = {
      decisionReason: "approve the frozen plan action",
      digest: approval.actionDigest,
      ...(approval.artifactVersionId ? { artifactVersionId: approval.artifactVersionId } : {}),
    };
    const options = {
      idempotencyKey: "approve-plan",
      operationId: "op_approve_plan",
      ifMatch: approval.stateRevision,
    };
    const decided = await client.approve(approval.id, input, options);
    expect(decided).toMatchObject({
      id: approval.id,
      gate: "plan",
      status: "consumed",
      actionDigest: approval.actionDigest,
    });

    const replayed = await client.approve(approval.id, input, options);
    expect(replayed).toEqual(decided);

    const receipt = await client.getOperation(options.operationId);
    expect(receipt).toMatchObject({
      operationId: options.operationId,
      status: "committed",
      result: decided,
    });

    await expect(
      client.approve(
        approval.id,
        { ...input, decisionReason: "changed after the committed decision" },
        options,
      ),
    ).rejects.toMatchObject({
      status: 409,
      problem: { code: "idempotency_key_reused" },
    });

    expect(await client.getApproval(approval.id)).toEqual(decided);
  });
});
