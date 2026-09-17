import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createComposedAppServices } from "../src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../src/bootstrap/index.js";
import { commandHeaders, json, uniqueLockPath } from "./helpers.js";

// This slice's real validation and confirmPlan/publishedExecutionGraph logic
// lives in the composed app-services (`apps/daemon/src/composition/app-services.ts`).
// The bootstrap default `FakeAppServices` used by `startTestDaemon()` has not
// been taught about `workflowVersionId` (documented gap, out of scope for this
// slice), so these tests stand up a real composed daemon directly, the same
// way `workflow-team-writes.test.ts` and `composition.test.ts` do.
interface ComposedHarness {
  daemon: StartedDaemon;
  stateDir: string;
  auth: Record<string, string>;
}

async function startComposedDaemon(): Promise<ComposedHarness> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-wvb-"));
  const services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
  const daemon = await startDaemon({
    stateDir,
    services,
    lockPath: uniqueLockPath(),
    heartbeatMs: 30,
    pollMs: 20,
  });
  return { daemon, stateDir, auth: { authorization: `Bearer ${daemon.sessionToken}` } };
}

// A minimal, linear custom graph whose node ids ("plan"/"build") are chosen to
// be unmistakably different from the generated software-delivery template's
// node ids ("dev_alpha", "dev_bravo", "review_integration", "approve_delivery").
const linearGraph = {
  entry: "plan",
  nodes: [
    { id: "plan", kind: "task", role: "planner", title: "Plan" },
    { id: "build", kind: "task", role: "developer", title: "Build" },
  ],
  edges: [{ id: "e1", from: "plan", to: "build", waitFor: "outputs_ready" }],
};

async function createProject(
  port: number,
  auth: Record<string, string>,
  key: string,
  name = "Bind test",
): Promise<{ id: string; stateRevision: number }> {
  const created = await json(port, "/api/v1/projects", {
    method: "POST",
    headers: commandHeaders(auth, key),
    body: JSON.stringify({ name, objective: "bind a published workflow version" }),
  });
  expect(created.status).toBe(201);
  return created.body as { id: string; stateRevision: number };
}

async function createDraftWorkflowVersion(
  port: number,
  auth: Record<string, string>,
  keyPrefix: string,
): Promise<{
  workflow: { id: string; stateRevision: number };
  draft: { id: string; stateRevision: number };
}> {
  const workflowRes = await json(port, "/api/v1/workflows", {
    method: "POST",
    headers: commandHeaders(auth, `${keyPrefix}-wf`),
    body: JSON.stringify({ name: "Bind target", description: "custom project graph" }),
  });
  expect(workflowRes.status).toBe(201);
  const workflow = workflowRes.body as { id: string; stateRevision: number };

  const versionRes = await json(port, `/api/v1/workflows/${workflow.id}/versions`, {
    method: "POST",
    headers: commandHeaders(auth, `${keyPrefix}-ver`, workflow.stateRevision),
    body: JSON.stringify(linearGraph),
  });
  expect(versionRes.status).toBe(201);
  const draft = versionRes.body as { id: string; stateRevision: number };
  return { workflow, draft };
}

async function publish(
  port: number,
  auth: Record<string, string>,
  keyPrefix: string,
  workflowId: string,
  versionId: string,
  stateRevision: number,
): Promise<{ id: string; stateRevision: number }> {
  const publishRes = await json(
    port,
    `/api/v1/workflows/${workflowId}/versions/${versionId}:publish`,
    {
      method: "POST",
      headers: commandHeaders(auth, `${keyPrefix}-publish`, stateRevision),
      body: JSON.stringify({}),
    },
  );
  expect(publishRes.status).toBe(200);
  return publishRes.body as { id: string; stateRevision: number };
}

describe("PATCH /projects binds a published WorkflowVersion (domain model §4.2)", () => {
  const harnesses: ComposedHarness[] = [];

  afterEach(async () => {
    for (const item of harnesses.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
  });

  it("refuses an unpublished draft bind, then accepts and echoes the published version", async () => {
    const harness = await startComposedDaemon();
    harnesses.push(harness);
    const { daemon, auth } = harness;

    const project = await createProject(daemon.port, auth, "wvb-create");
    const { workflow, draft } = await createDraftWorkflowVersion(daemon.port, auth, "wvb");

    const bindDraft = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: commandHeaders(auth, "wvb-bind-draft", project.stateRevision),
      body: JSON.stringify({ workflowVersionId: draft.id }),
    });
    expect(bindDraft.status).toBe(422);
    expect(bindDraft.body).toMatchObject({ code: "invalid_transition" });

    // A rejected bind must not burn the project's stateRevision (same as the
    // existing unpublished teamVersionId bind behavior).
    const afterRejection = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      headers: auth,
    });
    expect((afterRejection.body as { stateRevision: number }).stateRevision).toBe(
      project.stateRevision,
    );
    expect((afterRejection.body as { workflowVersionId?: string }).workflowVersionId).toBe(
      undefined,
    );

    const published = await publish(
      daemon.port,
      auth,
      "wvb",
      workflow.id,
      draft.id,
      draft.stateRevision,
    );

    const bindPublished = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: commandHeaders(auth, "wvb-bind-pub", project.stateRevision),
      body: JSON.stringify({ workflowVersionId: published.id }),
    });
    expect(bindPublished.status).toBe(200);
    expect((bindPublished.body as { workflowVersionId?: string }).workflowVersionId).toBe(
      published.id,
    );

    const detail = await json(daemon.port, `/api/v1/projects/${project.id}`, { headers: auth });
    expect(detail.status).toBe(200);
    expect((detail.body as { workflowVersionId?: string }).workflowVersionId).toBe(published.id);
  });

  it("rejects binding an unknown WorkflowVersion id", async () => {
    const harness = await startComposedDaemon();
    harnesses.push(harness);
    const { daemon, auth } = harness;
    const project = await createProject(daemon.port, auth, "wvb-unknown-create");

    const bindUnknown = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: commandHeaders(auth, "wvb-unknown", project.stateRevision),
      body: JSON.stringify({ workflowVersionId: "wfv_does_not_exist" }),
    });
    expect(bindUnknown.status).toBe(404);
    expect(bindUnknown.body).toMatchObject({ code: "not_found" });
  });
});

describe("confirmPlan / :start prefer the bound published WorkflowVersion graph", () => {
  const harnesses: ComposedHarness[] = [];

  afterEach(async () => {
    for (const item of harnesses.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
  });

  // Tasks are only materialized by `instantiateGraph` inside `:start` (from
  // the execution snapshot's graph captured at confirm-plan time), not by
  // confirm-plan itself, so the graph-preference assertion has to run after
  // `:start` and read `GET /api/v1/tasks`.
  async function planConfirmAndStart(
    port: number,
    auth: Record<string, string>,
    projectId: string,
    revision: number,
    keyPrefix: string,
  ): Promise<{ stateRevision: number }> {
    const planned = await json(port, `/api/v1/projects/${projectId}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, `${keyPrefix}-plan`, revision),
      body: "{}",
    });
    expect(planned.status).toBe(200);
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };

    const confirmed = await json(port, `/api/v1/projects/${projectId}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, `${keyPrefix}-confirm`, planning.stateRevision),
      body: JSON.stringify({ planArtifactVersionId: planning.planArtifactVersionId }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: "ready" });
    const ready = confirmed.body as { stateRevision: number };

    const started = await json(port, `/api/v1/projects/${projectId}:start`, {
      method: "POST",
      headers: commandHeaders(auth, `${keyPrefix}-start`, ready.stateRevision),
      body: "{}",
    });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: "running" });
    return started.body as { stateRevision: number };
  }

  it("uses the bound graph's own node ids for tasks, not the software-delivery template", async () => {
    const harness = await startComposedDaemon();
    harnesses.push(harness);
    const { daemon, auth } = harness;

    const project = await createProject(daemon.port, auth, "wvb-graph-create", "Bound graph");
    const { workflow, draft } = await createDraftWorkflowVersion(daemon.port, auth, "wvb-graph");
    const published = await publish(
      daemon.port,
      auth,
      "wvb-graph",
      workflow.id,
      draft.id,
      draft.stateRevision,
    );

    const bound = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: commandHeaders(auth, "wvb-graph-bind", project.stateRevision),
      body: JSON.stringify({ workflowVersionId: published.id }),
    });
    expect(bound.status).toBe(200);
    const boundProject = bound.body as { stateRevision: number; workflowVersionId?: string };
    expect(boundProject.workflowVersionId).toBe(published.id);

    await planConfirmAndStart(
      daemon.port,
      auth,
      project.id,
      boundProject.stateRevision,
      "wvb-graph",
    );

    const tasks = await json(daemon.port, `/api/v1/tasks?projectId=${project.id}`, {
      headers: auth,
    });
    expect(tasks.status).toBe(200);
    const nodeIds = (tasks.body as { items: Array<{ workflowNodeId?: string }> }).items
      .map((task) => task.workflowNodeId)
      .sort();
    expect(nodeIds).toEqual(["build", "plan"]);
    // This must not be, and must not look like, a Planner Run or the mock
    // feature-delivery template — those node ids must not leak in.
    expect(nodeIds).not.toContain("dev_alpha");
    expect(nodeIds).not.toContain("dev_bravo");
  });

  it("falls back to the generated software-delivery template when nothing is bound", async () => {
    const harness = await startComposedDaemon();
    harnesses.push(harness);
    const { daemon, auth } = harness;

    const project = await createProject(
      daemon.port,
      auth,
      "wvb-fallback-create",
      "Unbound project",
    );
    const detailBeforePlanning = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      headers: auth,
    });
    expect((detailBeforePlanning.body as { workflowVersionId?: string }).workflowVersionId).toBe(
      undefined,
    );

    await planConfirmAndStart(daemon.port, auth, project.id, project.stateRevision, "wvb-fallback");

    const tasks = await json(daemon.port, `/api/v1/tasks?projectId=${project.id}`, {
      headers: auth,
    });
    expect(tasks.status).toBe(200);
    const nodeIds = (tasks.body as { items: Array<{ workflowNodeId?: string }> }).items.map(
      (task) => task.workflowNodeId,
    );
    // Honest fallback: still the mock feature-delivery template DAG, never a
    // Planner Run and never the "plan"/"build" ids from the custom graph test.
    expect(nodeIds).toEqual(expect.arrayContaining(["dev_alpha", "dev_bravo"]));
    expect(nodeIds).not.toContain("plan");
    expect(nodeIds).not.toContain("build");
  });
});
