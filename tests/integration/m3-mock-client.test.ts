import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

/* T16 root tests are not a workspace package, so public @workforce/* names do not resolve. */
/* eslint-disable no-restricted-imports */
import { createComposedAppServices } from "../../apps/daemon/src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../../apps/daemon/src/bootstrap/index.js";
import {
  createDesktopClient,
  createLoopbackTransport,
} from "../../packages/desktop-client/src/index.js";
/* eslint-enable no-restricted-imports */

function uniqueLockPath(): string {
  const id = randomBytes(6).toString("hex");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\WorkforceM3-${process.pid}-${id}`;
  }
  return path.join(os.tmpdir(), `workforce-m3-${process.pid}-${id}.lock.sock`);
}

interface Harness {
  daemon: StartedDaemon;
  stateDir: string;
}

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const item of harnesses.splice(0)) {
    await item.daemon.close();
    fs.rmSync(item.stateDir, { recursive: true, force: true });
  }
});

async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs = 4000): Promise<T> {
  const started = Date.now();
  let last: T | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

describe("M3 mock loop via typed desktop client", () => {
  it(
    "creates, confirms the fixture plan, runs mock developers, and consumes artifact approval",
    { timeout: 20_000 },
    async () => {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-m3-client-"));
      const services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
      const daemon = await startDaemon({
        stateDir,
        services,
        lockPath: uniqueLockPath(),
        heartbeatMs: 30,
        pollMs: 20,
      });
      harnesses.push({ daemon, stateDir });

      const client = createDesktopClient({
        transport: createLoopbackTransport({
          port: daemon.port,
          getSessionToken: () => daemon.sessionToken,
        }),
      });

      const teams = await client.listTeams();
      expect(teams.items.some((team) => team.id === "tm_software_development")).toBe(true);
      const nodes = await client.listNodes();
      expect(nodes.items.some((node) => node.id === "ndl_local" && node.status === "online")).toBe(
        true,
      );

      const created = await client.createProject(
        { name: "Client mock", objective: "typed M3 path" },
        { idempotencyKey: "create-1", operationId: "op_create" },
      );
      expect(created.status).toBe("draft");

      const planned = await client.startPlanning(created.id, {
        idempotencyKey: "plan-1",
        operationId: "op_plan",
        ifMatch: created.stateRevision,
      });
      expect(planned.status).toBe("planning");
      expect(planned.planArtifactVersionId).toBeTruthy();

      const confirmed = await client.confirmPlan(
        created.id,
        { planArtifactVersionId: planned.planArtifactVersionId ?? "" },
        {
          idempotencyKey: "confirm-1",
          operationId: "op_confirm",
          ifMatch: planned.stateRevision,
        },
      );
      expect(confirmed.status).toBe("ready");

      const started = await client.startProject(created.id, {
        idempotencyKey: "start-1",
        operationId: "op_start",
        ifMatch: confirmed.stateRevision,
      });
      expect(started.status).toBe("running");

      const tasks = await poll(async () => {
        const listed = await client.listTasks({ projectId: created.id, limit: 50 });
        const ids = listed.items.map((item) => item.workflowNodeId ?? item.title);
        if (
          ids.includes("dev_alpha") &&
          ids.includes("dev_bravo") &&
          ids.includes("review_integration")
        ) {
          return listed.items;
        }
        return undefined;
      });
      expect(tasks).toHaveLength(3);

      await poll(async () => {
        const listed = await client.listRuns({ projectId: created.id, limit: 50 });
        const succeeded = listed.items.filter((item) => item.status === "succeeded");
        return succeeded.length >= 2 ? succeeded : undefined;
      });

      const artifactApproval = await poll(async () => {
        const listed = await client.listApprovals({ projectId: created.id, limit: 50 });
        return listed.items.find((item) => item.gate === "artifact" && item.status === "pending");
      });

      const approved = await client.approve(
        artifactApproval.id,
        {
          decisionReason: "accept integrated mock digest",
          digest: artifactApproval.actionDigest,
          ...(artifactApproval.artifactVersionId
            ? { artifactVersionId: artifactApproval.artifactVersionId }
            : {}),
        },
        {
          idempotencyKey: "approve-art",
          operationId: "op_approve_art",
          ifMatch: artifactApproval.stateRevision,
        },
      );
      expect(approved.status).toBe("consumed");

      const replay = await client.startProject(created.id, {
        idempotencyKey: "start-1",
        operationId: "op_start",
        ifMatch: confirmed.stateRevision,
      });
      expect(replay.id).toBe(started.id);

      const runs = await client.listRuns({ projectId: created.id, limit: 50 });
      const replayRuns = await client.listRuns({ projectId: created.id, limit: 50 });
      expect(replayRuns.items.map((item) => item.id).sort()).toEqual(
        runs.items.map((item) => item.id).sort(),
      );
    },
  );
});
