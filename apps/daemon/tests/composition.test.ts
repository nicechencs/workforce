import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createComposedAppServices } from "../src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../src/bootstrap/index.js";
import { commandHeaders, json, uniqueLockPath } from "./helpers.js";

interface Harness {
  daemon: StartedDaemon;
  stateDir: string;
  auth: Record<string, string>;
}

const daemons: Harness[] = [];

afterEach(async () => {
  for (const item of daemons.splice(0)) {
    await item.daemon.close();
    fs.rmSync(item.stateDir, { recursive: true, force: true });
  }
});

async function startComposed(stateDir?: string): Promise<Harness> {
  const dir = stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "wf-t10-comp-"));
  const services = await createComposedAppServices({ stateDir: dir, completeAfterMs: 5 });
  const daemon = await startDaemon({
    stateDir: dir,
    services,
    lockPath: uniqueLockPath(),
    heartbeatMs: 30,
    pollMs: 20,
  });
  const harness = {
    daemon,
    stateDir: dir,
    auth: { authorization: `Bearer ${daemon.sessionToken}` },
  };
  daemons.push(harness);
  return harness;
}

async function poll<T>(
  fn: () => Promise<T | undefined | false | null>,
  timeoutMs = 2500,
): Promise<T> {
  const started = Date.now();
  let last: T | undefined | false | null;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out after ${timeoutMs}ms (last=${JSON.stringify(last)})`);
}

describe("composed M3 mock loop", () => {
  it("walks create → plan → confirm → start over HTTP with mock completion", async () => {
    const harness = await startComposed();
    const { daemon, auth } = harness;
    const port = daemon.port;

    const teams = await json(port, "/api/v1/teams", { headers: auth });
    expect(teams.status).toBe(200);
    expect(teams.body).toMatchObject({
      items: [{ id: "tm_software_development", name: "Software Development Team" }],
    });
    const nodes = await json(port, "/api/v1/nodes", { headers: auth });
    expect(nodes.status).toBe(200);
    expect(nodes.body).toMatchObject({ items: [{ id: "ndl_local", status: "online" }] });
    const runtimes = await json(port, "/api/v1/runtimes", { headers: auth });
    expect(runtimes.status).toBe(200);
    expect(runtimes.body).toMatchObject({ items: [{ id: "mock", adapterId: "mock" }] });
    const caps = await json(port, "/api/v1/runtimes/mock/capabilities", { headers: auth });
    expect(caps.status).toBe(200);
    expect(caps.body).toMatchObject({ input: true, pause: false });

    const created = await json(port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-1"),
      body: JSON.stringify({
        name: "Mock feature",
        objective: "ship a patch",
        operationId: "op_create",
      }),
    });
    expect(created.status).toBe(201);
    const project = created.body as { id: string; status: string; stateRevision: number };
    expect(project.status).toBe("draft");

    const workspace = await json(port, `/api/v1/projects/${project.id}/workspaces`, {
      method: "POST",
      headers: commandHeaders(auth, "ws-1", project.stateRevision),
      body: JSON.stringify({ authorizationRef: "desktop-picker-ref", operationId: "op_ws" }),
    });
    expect(workspace.status).toBe(201);
    const bound = workspace.body as { authorizationRef: string; kind: string };
    expect(bound.kind).toBe("local");
    expect(bound.authorizationRef).not.toMatch(/^\//);
    expect(JSON.stringify(bound)).not.toMatch(/absolutePath|hostPath/);

    const afterWs = await json(port, `/api/v1/projects/${project.id}`, { headers: auth });
    const draft = afterWs.body as { stateRevision: number };

    const planned = await json(port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-1", draft.stateRevision),
      body: JSON.stringify({ operationId: "op_plan" }),
    });
    expect(planned.status).toBe(200);
    const planning = planned.body as {
      status: string;
      stateRevision: number;
      planArtifactVersionId: string;
    };
    expect(planning.status).toBe("planning");
    expect(planning.planArtifactVersionId).toBeTruthy();

    const budget = await json(port, `/api/v1/projects/${project.id}/budget`, { headers: auth });
    expect(budget.status).toBe(200);
    const budgetBody = budget.body as { kind: string; estimatedLimitMinor?: number };
    expect(["unknown", "estimated"]).toContain(budgetBody.kind);
    if (budgetBody.kind === "unknown") {
      expect(budgetBody).not.toHaveProperty("costMinor");
    }

    const confirmed = await json(port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-1", planning.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_confirm",
      }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: "ready" });
    const ready = confirmed.body as { stateRevision: number };

    const approvalsAfterConfirm = await json(port, `/api/v1/approvals?projectId=${project.id}`, {
      headers: auth,
    });
    const planApproval = (
      approvalsAfterConfirm.body as { items: Array<{ gate: string; status: string }> }
    ).items.find((item) => item.gate === "plan");
    expect(planApproval?.status).toBe("consumed");

    const hardBudget = await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-budget", ready.stateRevision),
      body: JSON.stringify({ budgetHardLimitMinor: 100, operationId: "op_start_budget" }),
    });
    expect(hardBudget.status).toBe(422);
    expect(hardBudget.body).toMatchObject({ code: "unknown_cost_not_enforceable" });

    const started = await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-1", ready.stateRevision),
      body: JSON.stringify({ operationId: "op_start" }),
    });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: "running" });

    const tasks = await poll(async () => {
      const listed = await json(port, `/api/v1/tasks?projectId=${project.id}`, { headers: auth });
      const items = (
        listed.body as {
          items: Array<{ title: string; role?: string; workflowNodeId?: string; status: string }>;
        }
      ).items;
      const ids = items.map((item) => item.workflowNodeId ?? item.title);
      if (
        ids.includes("dev_alpha") &&
        ids.includes("dev_bravo") &&
        ids.includes("review_integration")
      ) {
        return items;
      }
      return undefined;
    });
    expect(tasks.some((task) => (task.workflowNodeId ?? task.title) === "dev_alpha")).toBe(true);
    expect(tasks.some((task) => (task.workflowNodeId ?? task.title) === "dev_bravo")).toBe(true);
    expect(
      tasks.some(
        (task) =>
          (task.role ?? "") === "reviewer" ||
          (task.workflowNodeId ?? task.title) === "review_integration",
      ),
    ).toBe(true);

    await poll(async () => {
      const listed = await json(port, `/api/v1/runs?projectId=${project.id}`, { headers: auth });
      const items = (listed.body as { items: Array<{ status: string; taskId: string }> }).items;
      const succeeded = items.filter((item) => item.status === "succeeded");
      return succeeded.length >= 2 ? succeeded : undefined;
    });

    await poll(async () => {
      const listed = await json(port, `/api/v1/artifacts?projectId=${project.id}`, {
        headers: auth,
      });
      const items = (
        listed.body as { items: Array<{ logicalName: string; versions: Array<{ id: string }> }> }
      ).items;
      const bound = items.filter((item) => item.logicalName !== "plan");
      return bound.length >= 2 ? bound : undefined;
    });

    const artifactApproval = await poll(async () => {
      const listed = await json(port, `/api/v1/approvals?projectId=${project.id}`, {
        headers: auth,
      });
      const items = (
        listed.body as {
          items: Array<{
            id: string;
            gate: string;
            status: string;
            stateRevision: number;
            actionDigest: string;
            artifactVersionId?: string;
          }>;
        }
      ).items;
      return items.find((item) => item.gate === "artifact" && item.status === "pending");
    });

    const approved = await json(port, `/api/v1/approvals/${artifactApproval.id}:approve`, {
      method: "POST",
      headers: commandHeaders(auth, "approve-art", artifactApproval.stateRevision),
      body: JSON.stringify({
        decisionReason: "looks good",
        digest: artifactApproval.actionDigest,
        operationId: "op_approve_art",
        ...(artifactApproval.artifactVersionId
          ? { artifactVersionId: artifactApproval.artifactVersionId }
          : {}),
      }),
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: "consumed", gate: "artifact" });

    const finished = await poll(async () => {
      const current = await json(port, `/api/v1/projects/${project.id}`, { headers: auth });
      const body = current.body as { status: string };
      if (body.status === "completed" || body.status === "running") {
        return body;
      }
      return undefined;
    });
    const reviewTasks = await json(port, `/api/v1/tasks?projectId=${project.id}`, {
      headers: auth,
    });
    const review = (
      reviewTasks.body as {
        items: Array<{ workflowNodeId?: string; title: string; status: string }>;
      }
    ).items.find((item) => (item.workflowNodeId ?? item.title) === "review_integration");
    if (finished.status === "running") {
      expect(review?.status).toBe("waiting_review");
    } else {
      expect(finished.status).toBe("completed");
    }
  });

  it("rehydrates the same project and does not duplicate runs on replay", async () => {
    const first = await startComposed();
    const { daemon, auth, stateDir } = first;
    const port = daemon.port;

    const created = await json(port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-1"),
      body: JSON.stringify({
        name: "Persist me",
        objective: "restart",
        operationId: "op_create",
      }),
    });
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-1", project.stateRevision),
      body: JSON.stringify({ operationId: "op_plan" }),
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await json(port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-1", planning.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_confirm",
      }),
    });
    const ready = confirmed.body as { stateRevision: number };
    await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-1", ready.stateRevision),
      body: JSON.stringify({ operationId: "op_start" }),
    });

    await poll(async () => {
      const listed = await json(port, `/api/v1/runs?projectId=${project.id}`, { headers: auth });
      const items = (listed.body as { items: Array<{ id: string }> }).items;
      return items.length > 0 ? items : undefined;
    });
    const before = await json(port, `/api/v1/runs?projectId=${project.id}`, { headers: auth });
    const beforeIds = (before.body as { items: Array<{ id: string }> }).items.map(
      (item) => item.id,
    );

    await daemon.close();
    daemons.splice(daemons.indexOf(first), 1);

    const second = await startComposed(stateDir);
    const listed = await json(second.daemon.port, "/api/v1/projects", { headers: second.auth });
    expect(listed.status).toBe(200);
    const restored = (listed.body as { items: Array<{ id: string; name: string }> }).items;
    expect(restored.some((item) => item.id === project.id && item.name === "Persist me")).toBe(
      true,
    );

    const live = await json(second.daemon.port, `/api/v1/projects/${project.id}`, {
      headers: second.auth,
    });
    const liveProject = live.body as { stateRevision: number; status: string };

    await json(second.daemon.port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(second.auth, "plan-1", liveProject.stateRevision),
      body: JSON.stringify({ operationId: "op_plan" }),
    });
    await json(second.daemon.port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(second.auth, "confirm-1", liveProject.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_confirm",
      }),
    });
    await json(second.daemon.port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(second.auth, "start-1", liveProject.stateRevision),
      body: JSON.stringify({ operationId: "op_start" }),
    });

    const after = await json(second.daemon.port, `/api/v1/runs?projectId=${project.id}`, {
      headers: second.auth,
    });
    const afterIds = (after.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(afterIds.sort()).toEqual(beforeIds.sort());
  });

  it("returns 422 unsupported_capability for mock pause", async () => {
    const harness = await startComposed();
    const { daemon, auth } = harness;
    const created = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-1"),
      body: JSON.stringify({ name: "Pause", objective: "n", operationId: "op_c" }),
    });
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(daemon.port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-1", project.stateRevision),
      body: JSON.stringify({ operationId: "op_p" }),
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await json(daemon.port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-1", planning.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_cf",
      }),
    });
    const ready = confirmed.body as { stateRevision: number };
    await json(daemon.port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-1", ready.stateRevision),
      body: JSON.stringify({ operationId: "op_s" }),
    });
    const run = await poll(async () => {
      const listed = await json(daemon.port, `/api/v1/runs?projectId=${project.id}`, {
        headers: auth,
      });
      return (listed.body as { items: Array<{ id: string; stateRevision: number }> }).items[0];
    });
    const paused = await json(daemon.port, `/api/v1/runs/${run.id}:pause`, {
      method: "POST",
      headers: commandHeaders(auth, "pause-1", run.stateRevision),
      body: JSON.stringify({ operationId: "op_pause" }),
    });
    expect(paused.status).toBe(422);
    expect(paused.body).toMatchObject({ code: "unsupported_capability" });
  });
});
