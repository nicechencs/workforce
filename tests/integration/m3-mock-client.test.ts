import { afterEach, describe, expect, it } from "vitest";

import { ComposedDaemonHarnesses } from "../helpers/composed-daemon.js";

const harnesses = new ComposedDaemonHarnesses();

afterEach(async () => {
  await harnesses.closeAll();
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
      const { client } = await harnesses.start({ testId: "m3-client", completeAfterMs: 5 });

      const teams = await client.listTeams();
      expect(teams.items.some((team) => team.id === "tm_software_development")).toBe(true);
      const workflows = await client.listWorkflows();
      expect(
        workflows.items.some((item) => item.id === "software-development-team.feature-delivery"),
      ).toBe(true);
      const workflow = await client.getWorkflow("software-development-team.feature-delivery");
      expect(workflow.status).toBe("published");
      const version = await client.getWorkflowVersion(
        "software-development-team.feature-delivery",
        "0.1.0",
      );
      expect(version.immutable).toBe(true);
      expect(version.steps.map((step) => step.id)).toContain("planning");
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
      const byNode = new Map(
        tasks.map((task) => [task.workflowNodeId ?? task.title, task] as const),
      );
      const alpha = byNode.get("dev_alpha");
      const bravo = byNode.get("dev_bravo");
      const review = byNode.get("review_integration");
      expect(alpha?.dependsOn).toEqual([]);
      expect(bravo?.dependsOn).toEqual([]);
      expect(review?.dependsOn.map((edge) => edge.taskId).sort()).toEqual(
        [alpha?.id, bravo?.id].filter((id): id is string => typeof id === "string").sort(),
      );
      expect(review?.dependsOn.every((edge) => edge.waitFor === "outputs_ready")).toBe(true);

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
