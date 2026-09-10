import fs from "node:fs";
import { realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "@workforce/database";

import { ComposedAppServices, createComposedAppServices } from "../src/composition/index.js";
import { sqlitePath } from "../src/composition/persist.js";
import { startDaemon, type StartedDaemon } from "../src/bootstrap/index.js";
import { commandHeaders, json, uniqueLockPath } from "./helpers.js";

interface Harness {
  daemon: StartedDaemon;
  services: ComposedAppServices;
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
    services,
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

    const boundArtifacts = await poll(async () => {
      const listed = await json(port, `/api/v1/artifacts?projectId=${project.id}`, {
        headers: auth,
      });
      const items = (
        listed.body as {
          items: Array<{
            id: string;
            logicalName: string;
            kind: string;
            versions: Array<{ id: string }>;
          }>;
        }
      ).items;
      const bound = items.filter((item) => item.logicalName !== "plan");
      const patches = bound.filter(
        (item) =>
          item.kind === "git_diff" ||
          item.logicalName.includes("code") ||
          item.logicalName.includes("change") ||
          item.logicalName.includes("patch"),
      );
      return patches.length >= 2 ? bound : undefined;
    });
    const patchArtifacts = boundArtifacts.filter(
      (item) =>
        item.kind === "git_diff" ||
        item.logicalName.includes("code") ||
        item.logicalName.includes("change") ||
        item.logicalName.includes("patch"),
    );
    expect(patchArtifacts.length).toBeGreaterThanOrEqual(2);
    const patchBodies: string[] = [];
    for (const artifact of patchArtifacts) {
      const versionId = artifact.versions[0]?.id;
      expect(versionId).toBeTruthy();
      const content = await fetch(
        `http://127.0.0.1:${port}/api/v1/artifacts/${artifact.id}/versions/${versionId}/content`,
        { headers: auth },
      );
      expect(content.ok).toBe(true);
      const text = await content.text();
      expect(text).toMatch(/diff --git /);
      patchBodies.push(text);
    }
    expect(patchBodies.some((body) => body.includes("dev_alpha"))).toBe(true);
    expect(patchBodies.some((body) => body.includes("dev_bravo"))).toBe(true);

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

  it("provisions isolated worktrees for developer A and B", async () => {
    const harness = await startComposed();
    const { daemon, auth, services } = harness;
    const port = daemon.port;

    const created = await json(port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-iso"),
      body: JSON.stringify({
        name: "Isolated worktrees",
        objective: "two developers",
        operationId: "op_create_iso",
      }),
    });
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-iso", project.stateRevision),
      body: JSON.stringify({ operationId: "op_plan_iso" }),
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await json(port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-iso", planning.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_confirm_iso",
      }),
    });
    const ready = confirmed.body as { stateRevision: number };
    await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-iso", ready.stateRevision),
      body: JSON.stringify({ operationId: "op_start_iso" }),
    });

    await poll(async () => {
      const listed = await json(port, `/api/v1/runs?projectId=${project.id}`, { headers: auth });
      const items = (listed.body as { items: Array<{ status: string }> }).items;
      const succeeded = items.filter((item) => item.status === "succeeded");
      return succeeded.length >= 2 ? succeeded : undefined;
    });

    const trees = await poll(() => {
      const developers = services.worktrees.developerWorktrees(project.id);
      return developers.length >= 2 ? developers : undefined;
    });
    const alpha = trees.find((item) => item.nodeId === "dev_alpha");
    const bravo = trees.find((item) => item.nodeId === "dev_bravo");
    expect(alpha).toBeTruthy();
    expect(bravo).toBeTruthy();
    if (!alpha || !bravo) {
      throw new Error("expected developer worktrees for dev_alpha and dev_bravo");
    }

    const realA = await realpath(alpha.worktreePath);
    const realB = await realpath(bravo.worktreePath);
    expect(realA).not.toBe(realB);
    expect(realA).not.toBe(await realpath(services.worktrees.repoPath));
    expect(realB).not.toBe(await realpath(services.worktrees.repoPath));

    expect(fs.existsSync(path.join(realA, "dev_alpha.ts"))).toBe(true);
    expect(fs.existsSync(path.join(realB, "dev_bravo.ts"))).toBe(true);
    expect(fs.existsSync(path.join(realA, "dev_bravo.ts"))).toBe(false);
    expect(fs.existsSync(path.join(realB, "dev_alpha.ts"))).toBe(false);

    await writeFile(path.join(realA, "shared.txt"), "edited-in-alpha");
    await writeFile(path.join(realB, "shared.txt"), "edited-in-bravo");
    expect(fs.readFileSync(path.join(realA, "shared.txt"), "utf8")).toBe("edited-in-alpha");
    expect(fs.readFileSync(path.join(realB, "shared.txt"), "utf8")).toBe("edited-in-bravo");
    expect(fs.readFileSync(path.join(services.worktrees.repoPath, "shared.txt"), "utf8")).toBe(
      "shared-base\n",
    );
  });

  it("reloads the project from sqlite after world.json is deleted", async () => {
    const first = await startComposed();
    const created = await json(first.daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(first.auth, "create-sql"),
      body: JSON.stringify({
        name: "SQLite authority",
        objective: "survive without world.json",
        operationId: "op_sql",
      }),
    });
    expect(created.status).toBe(201);
    const project = created.body as { id: string };
    await first.daemon.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const db = WorkforceSqlite.open(sqlitePath(first.stateDir));
    expect(db.worldSnapshot.load().projects.some((item) => item.id === project.id)).toBe(true);
    db.close();
    fs.unlinkSync(path.join(first.stateDir, "world.json"));

    const second = await startComposed(first.stateDir);
    const listed = await json(second.daemon.port, "/api/v1/projects", { headers: second.auth });
    expect(listed.status).toBe(200);
    const items = (listed.body as { items: Array<{ id: string; name: string }> }).items;
    expect(items.some((item) => item.id === project.id && item.name === "SQLite authority")).toBe(
      true,
    );
  });

  it("integrates developer patches and exports a digest after artifact approval", async () => {
    const harness = await startComposed();
    const { daemon, auth } = harness;
    const port = daemon.port;
    const created = await json(port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-exp"),
      body: JSON.stringify({
        name: "Export path",
        objective: "integrate then export",
        operationId: "op_exp_c",
      }),
    });
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-exp", project.stateRevision),
      body: JSON.stringify({ operationId: "op_exp_p" }),
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await json(port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-exp", planning.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_exp_cf",
      }),
    });
    const ready = confirmed.body as { stateRevision: number };
    await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-exp", ready.stateRevision),
      body: JSON.stringify({ operationId: "op_exp_s" }),
    });

    const artifactApproval = await poll(async () => {
      const listed = await json(port, `/api/v1/approvals?projectId=${project.id}`, {
        headers: auth,
      });
      return (
        listed.body as {
          items: Array<{
            id: string;
            gate: string;
            status: string;
            actionDigest: string;
            artifactVersionId?: string;
            stateRevision: number;
          }>;
        }
      ).items.find((item) => item.gate === "artifact" && item.status === "pending");
    }, 4000);

    const approved = await json(port, `/api/v1/approvals/${artifactApproval.id}:approve`, {
      method: "POST",
      headers: commandHeaders(auth, "approve-exp", artifactApproval.stateRevision),
      body: JSON.stringify({
        decisionReason: "accept integrated digest",
        digest: artifactApproval.actionDigest,
        ...(artifactApproval.artifactVersionId
          ? { artifactVersionId: artifactApproval.artifactVersionId }
          : {}),
        operationId: "op_exp_a",
      }),
    });
    expect(approved.status).toBe(200);

    const live = await json(port, `/api/v1/projects/${project.id}`, { headers: auth });
    const liveProject = live.body as { stateRevision: number };
    const exported = await json(port, `/api/v1/projects/${project.id}:export`, {
      method: "POST",
      headers: commandHeaders(auth, "export-1", liveProject.stateRevision),
      body: JSON.stringify({ operationId: "op_export" }),
    });
    expect(exported.status).toBe(200);
    const bundle = exported.body as {
      digest: string;
      artifactVersionId: string;
      report: { projectId: string; approvedDigest?: string; integratedDigest?: string };
    };
    expect(bundle.digest.length).toBeGreaterThan(8);
    expect(bundle.report.projectId).toBe(project.id);
    expect(bundle.report.approvedDigest).toBe(artifactApproval.actionDigest);
  });
});
