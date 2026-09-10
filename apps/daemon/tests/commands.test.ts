import fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAppServices } from "../src/modules/fake-app-services.js";
import { commandHeaders, json, startTestDaemon, type TestDaemon } from "./helpers.js";

describe("daemon resource commands", () => {
  const daemons: TestDaemon[] = [];

  afterEach(async () => {
    for (const item of daemons.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
  });

  it("walks the M3 project, task, run, approval, and artifact path", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, auth } = harness;
    const port = daemon.port;

    const created = await json(port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-1"),
      body: JSON.stringify({ name: "Demo", objective: "Ship the mock loop" }),
    });
    expect(created.status).toBe(201);
    const project = created.body as { id: string; status: string; stateRevision: number };
    expect(project.status).toBe("draft");

    const unknownField = await json(port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-bad"),
      body: JSON.stringify({ name: "X", objective: "Y", extra: true }),
    });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body).toMatchObject({ code: "validation_failed" });

    const planned = await json(port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-1", project.stateRevision),
      body: JSON.stringify({}),
    });
    expect(planned.status).toBe(200);
    const planning = planned.body as {
      status: string;
      stateRevision: number;
      planArtifactVersionId: string;
    };
    expect(planning.status).toBe("planning");

    const mismatch = await json(
      port,
      `/api/v1/projects/${planning.planArtifactVersionId ? project.id : project.id}:confirm-plan`,
      {
        method: "POST",
        headers: commandHeaders(auth, "confirm-stale", 1),
        body: JSON.stringify({ planArtifactVersionId: planning.planArtifactVersionId }),
      },
    );
    expect(mismatch.status).toBe(412);
    expect(mismatch.body).toMatchObject({ code: "revision_conflict" });

    const confirmed = await json(port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-1", planning.stateRevision),
      body: JSON.stringify({ planArtifactVersionId: planning.planArtifactVersionId }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: "ready" });
    const ready = confirmed.body as { stateRevision: number };

    const hardBudget = await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-budget", ready.stateRevision),
      body: JSON.stringify({ budgetHardLimitMinor: 100 }),
    });
    expect(hardBudget.status).toBe(422);
    expect(hardBudget.body).toMatchObject({ code: "unknown_cost_not_enforceable" });

    const started = await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-1", ready.stateRevision),
      body: JSON.stringify({}),
    });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: "running" });

    const runs = await json(port, `/api/v1/runs?projectId=${project.id}`, { headers: auth });
    expect(runs.status).toBe(200);
    const run = (
      runs.body as {
        items: Array<{
          id: string;
          status: string;
          usage: { kind: string; costMinor: number };
          stateRevision: number;
        }>;
      }
    ).items[0];
    expect(run?.status).toBe("waiting_input");
    expect(run?.usage.kind).toBe("unknown");
    expect(run?.usage.costMinor).toBe(0);

    const inputted = await json(port, `/api/v1/runs/${run?.id}:input`, {
      method: "POST",
      headers: commandHeaders(auth, "input-1", run?.stateRevision),
      body: JSON.stringify({ text: "continue" }),
    });
    expect(inputted.status).toBe(200);
    expect(inputted.body).toMatchObject({ status: "running" });
    const running = inputted.body as { id: string; stateRevision: number };

    const cancelled = await json(port, `/api/v1/runs/${running.id}:cancel`, {
      method: "POST",
      headers: commandHeaders(auth, "cancel-run", running.stateRevision),
      body: JSON.stringify({ reason: "stop" }),
    });
    expect(cancelled.status).toBe(202);
    expect(cancelled.body).toMatchObject({ resource: { type: "run", id: running.id } });
    const afterCancel = await json(port, `/api/v1/runs/${running.id}`, { headers: auth });
    expect(afterCancel.body).toMatchObject({ status: "running", cancelRequested: true });

    const artifacts = await json(port, `/api/v1/artifacts?projectId=${project.id}`, {
      headers: auth,
    });
    const artifact = (
      artifacts.body as { items: Array<{ id: string; versions: Array<{ id: string }> }> }
    ).items[0];
    expect(artifact).toBeTruthy();
    const versionId = artifact?.versions[0]?.id as string;
    const content = await fetch(
      `http://127.0.0.1:${port}/api/v1/artifacts/${artifact?.id}/versions/${versionId}/content`,
      { headers: auth },
    );
    expect(content.ok).toBe(true);
    expect(content.url).not.toMatch(/token=/);
    expect(await content.text()).toContain("Ship the mock loop");

    const approvals = await json(port, `/api/v1/approvals?projectId=${project.id}`, {
      headers: auth,
    });
    expect((approvals.body as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it("replays idempotent commands after session rotation and conflicts on a different payload", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, auth } = harness;

    const first = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "same-key"),
      body: JSON.stringify({ name: "A", objective: "one" }),
    });
    expect(first.status).toBe(201);
    const project = first.body as { id: string };

    const replay = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "same-key"),
      body: JSON.stringify({ name: "A", objective: "one" }),
    });
    expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({ id: project.id });

    const conflict = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "same-key"),
      body: JSON.stringify({ name: "B", objective: "two" }),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: "idempotency_key_reused" });

    const rotated = daemon.sessions.rotate();
    const afterRotate = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders({ authorization: `Bearer ${rotated.token}` }, "same-key"),
      body: JSON.stringify({ name: "A", objective: "one" }),
    });
    expect(afterRotate.status).toBe(201);
    expect(afterRotate.body).toMatchObject({ id: project.id });

    const oldToken = await json(daemon.port, "/api/v1/projects", { headers: auth });
    expect(oldToken.status).toBe(401);

    const op = await json(daemon.port, `/api/v1/operations/${(first.body as { id: string }).id}`, {
      headers: { authorization: `Bearer ${rotated.token}` },
    });
    expect(op.status).toBe(404);

    const receipt = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders({ authorization: `Bearer ${rotated.token}` }, "op-lookup"),
      body: JSON.stringify({ name: "C", objective: "three", operationId: "op_lookup" }),
    });
    expect(receipt.status).toBe(201);
    const got = await json(daemon.port, "/api/v1/operations/op_lookup", {
      headers: { authorization: `Bearer ${rotated.token}` },
    });
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ operationId: "op_lookup", status: "committed" });
  });

  it("returns unsupported_capability when run input is disabled", async () => {
    const services = new FakeAppServices({ runInput: false });
    const harness = await startTestDaemon({ services });
    daemons.push(harness);
    const { daemon, auth } = harness;

    const created = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "p"),
      body: JSON.stringify({ name: "N", objective: "O" }),
    });
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(daemon.port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "pl", project.stateRevision),
      body: "{}",
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await json(daemon.port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "cf", planning.stateRevision),
      body: JSON.stringify({ planArtifactVersionId: planning.planArtifactVersionId }),
    });
    const ready = confirmed.body as { stateRevision: number };
    await json(daemon.port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "st", ready.stateRevision),
      body: "{}",
    });
    const runs = await json(daemon.port, `/api/v1/runs?projectId=${project.id}`, { headers: auth });
    const run = (runs.body as { items: Array<{ id: string; stateRevision: number }> }).items[0];
    const input = await json(daemon.port, `/api/v1/runs/${run?.id}:input`, {
      method: "POST",
      headers: commandHeaders(auth, "in", run?.stateRevision),
      body: JSON.stringify({ text: "nope" }),
    });
    expect(input.status).toBe(422);
    expect(input.body).toMatchObject({ code: "unsupported_capability" });
  });

  it("retries a failed task", async () => {
    const services = new FakeAppServices();
    const harness = await startTestDaemon({ services });
    daemons.push(harness);
    const { daemon, auth } = harness;
    const created = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "p"),
      body: JSON.stringify({ name: "N", objective: "O" }),
    });
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(daemon.port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "pl", project.stateRevision),
      body: "{}",
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await json(daemon.port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "cf", planning.stateRevision),
      body: JSON.stringify({ planArtifactVersionId: planning.planArtifactVersionId }),
    });
    const ready = confirmed.body as { stateRevision: number };
    await json(daemon.port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "st", ready.stateRevision),
      body: "{}",
    });
    const tasks = await json(daemon.port, `/api/v1/tasks?projectId=${project.id}`, {
      headers: auth,
    });
    const task = (tasks.body as { items: Array<{ id: string }> }).items[0];
    const failed = services.failTask(task?.id as string);
    const retried = await json(daemon.port, `/api/v1/tasks/${failed.id}:retry`, {
      method: "POST",
      headers: commandHeaders(auth, "retry", failed.stateRevision),
      body: "{}",
    });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ task: { attempt: 2, status: "running" } });
  });
});
