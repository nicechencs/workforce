import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createComposedAppServices, startDaemon, type StartedDaemon } from "@workforce/daemon";
import {
  createDesktopClient,
  createLoopbackTransport,
  type ApprovalDto,
  type DesktopClient,
} from "@workforce/desktop-client";

interface Harness {
  client: DesktopClient;
  daemon: StartedDaemon;
  stateDir: string;
}

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.daemon.close();
    fs.rmSync(harness.stateDir, { recursive: true, force: true });
  }
});

async function startProductionComposition(): Promise<Harness> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-t16-approval-"));
  const lockPath = path.join(
    os.tmpdir(),
    `wf-t16-approval-${process.pid}-${randomBytes(6).toString("hex")}.sock`,
  );
  let services: Awaited<ReturnType<typeof createComposedAppServices>> | undefined;
  try {
    services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
    const daemon = await startDaemon({
      stateDir,
      services,
      lockPath,
      heartbeatMs: 30,
      pollMs: 20,
    });
    const harness = {
      daemon,
      stateDir,
      client: createDesktopClient({
        transport: createLoopbackTransport({
          port: daemon.port,
          getSessionToken: () => daemon.sessionToken,
        }),
      }),
    };
    harnesses.push(harness);
    return harness;
  } catch (error) {
    await services?.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
    throw error;
  }
}

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
    const { client } = await startProductionComposition();
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
