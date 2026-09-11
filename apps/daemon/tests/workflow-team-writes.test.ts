import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isExecutableWorkflowVersion,
  parseTeam,
  parseTeamVersion,
  parseWorkflow,
  parseWorkflowPage,
  parseWorkflowVersion,
} from "@workforce/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createComposedAppServices } from "../src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../src/bootstrap/index.js";
import {
  commandHeaders,
  json,
  startTestDaemon,
  uniqueLockPath,
  type TestDaemon,
} from "./helpers.js";

const linearGraph = {
  entry: "plan",
  nodes: [
    { id: "plan", kind: "task", role: "planner", title: "Plan" },
    { id: "build", kind: "task", role: "developer", title: "Build" },
  ],
  edges: [{ id: "e1", from: "plan", to: "build", waitFor: "outputs_ready" }],
};

describe("M7 workflow and team write API", () => {
  const daemons: TestDaemon[] = [];
  const composed: Array<{ daemon: StartedDaemon; stateDir: string }> = [];

  afterEach(async () => {
    for (const item of daemons.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
    for (const item of composed.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
  });

  it("saves a draft graph, keeps it off the published list, then lists it after publish", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, auth } = harness;

    const created = await json(daemon.port, "/api/v1/workflows", {
      method: "POST",
      headers: commandHeaders(auth, "wf-create"),
      body: JSON.stringify({ name: "Custom delivery", description: "project dag" }),
    });
    expect(created.status).toBe(201);
    const workflow = parseWorkflow(created.body);
    expect(workflow.status).toBe("draft");
    expect(workflow.stateRevision).toBe(1);

    const listedDraft = parseWorkflowPage(
      (await json(daemon.port, "/api/v1/workflows", { headers: auth })).body,
    );
    expect(listedDraft.items.some((item) => item.id === workflow.id)).toBe(false);

    const versionRes = await json(daemon.port, `/api/v1/workflows/${workflow.id}/versions`, {
      method: "POST",
      headers: commandHeaders(auth, "wf-version", workflow.stateRevision),
      body: JSON.stringify(linearGraph),
    });
    expect(versionRes.status).toBe(201);
    const draftVersion = parseWorkflowVersion(versionRes.body);
    expect(draftVersion.status).toBe("draft");
    expect(draftVersion.immutable).toBe(false);
    expect(isExecutableWorkflowVersion(draftVersion)).toBe(false);

    const publishedRes = await json(
      daemon.port,
      `/api/v1/workflows/${workflow.id}/versions/${draftVersion.id}:publish`,
      {
        method: "POST",
        headers: commandHeaders(auth, "wf-publish", draftVersion.stateRevision),
        body: JSON.stringify({}),
      },
    );
    expect(publishedRes.status).toBe(200);
    const published = parseWorkflowVersion(publishedRes.body);
    expect(published.status).toBe("published");
    expect(published.immutable).toBe(true);
    expect(isExecutableWorkflowVersion(published)).toBe(true);
    expect(published.nodes?.map((node) => node.id)).toEqual(["plan", "build"]);

    const listed = parseWorkflowPage(
      (await json(daemon.port, "/api/v1/workflows", { headers: auth })).body,
    );
    expect(
      listed.items.some((item) => item.id === workflow.id && item.status === "published"),
    ).toBe(true);

    const mutate = await json(
      daemon.port,
      `/api/v1/workflows/${workflow.id}/versions/${draftVersion.id}`,
      {
        method: "PATCH",
        headers: commandHeaders(auth, "wf-mutate", published.stateRevision),
        body: JSON.stringify({ entry: "build" }),
      },
    );
    expect(mutate.status).toBe(422);
    expect(mutate.body).toMatchObject({ code: "invalid_transition" });
  });

  it("publishes a custom TeamVersion and refuses unpublished :start-planning bind", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, auth } = harness;

    const teamRes = await json(daemon.port, "/api/v1/teams", {
      method: "POST",
      headers: commandHeaders(auth, "tm-create"),
      body: JSON.stringify({ name: "Squad" }),
    });
    expect(teamRes.status).toBe(201);
    const team = parseTeam(teamRes.body);
    expect(team.status).toBe("draft");

    const versionRes = await json(daemon.port, `/api/v1/teams/${team.id}/versions`, {
      method: "POST",
      headers: commandHeaders(auth, "tm-version", team.stateRevision),
      body: JSON.stringify({
        members: [{ role: "developer", runtimeProfileId: "mock", quantity: 1 }],
      }),
    });
    expect(versionRes.status).toBe(201);
    const draftVersion = parseTeamVersion(versionRes.body);
    expect(draftVersion.immutable).toBe(false);

    const projectRes = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "prj-create"),
      body: JSON.stringify({ name: "Bind test", objective: "check unpublished team" }),
    });
    expect(projectRes.status).toBe(201);
    const project = projectRes.body as { id: string; stateRevision: number };

    const bindDraft = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: commandHeaders(auth, "prj-bind-draft", project.stateRevision),
      body: JSON.stringify({ teamVersionId: draftVersion.id }),
    });
    expect(bindDraft.status).toBe(422);
    expect(bindDraft.body).toMatchObject({ code: "invalid_transition" });

    const publishedRes = await json(
      daemon.port,
      `/api/v1/teams/${team.id}/versions/${draftVersion.id}:publish`,
      {
        method: "POST",
        headers: commandHeaders(auth, "tm-publish", draftVersion.stateRevision),
        body: JSON.stringify({}),
      },
    );
    expect(publishedRes.status).toBe(200);
    const published = parseTeamVersion(publishedRes.body);
    expect(published.immutable).toBe(true);

    const listed = await json(daemon.port, "/api/v1/teams", { headers: auth });
    expect(
      (listed.body as { items: Array<{ id: string }> }).items.some((item) => item.id === team.id),
    ).toBe(true);

    const versionDetail = await json(
      daemon.port,
      `/api/v1/teams/${team.id}/versions/${published.id}`,
      { headers: auth },
    );
    expect(versionDetail.status).toBe(200);
    expect(parseTeamVersion(versionDetail.body).members[0]?.role).toBe("developer");

    const bindPublished = await json(daemon.port, `/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: commandHeaders(auth, "prj-bind-pub", project.stateRevision),
      body: JSON.stringify({ teamVersionId: published.id }),
    });
    expect(bindPublished.status).toBe(200);
    expect((bindPublished.body as { teamVersionId?: string }).teamVersionId).toBe(published.id);
  });

  it("persists published catalog rows across composed daemon restart", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-m7-"));
    const services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
    const daemon = await startDaemon({
      stateDir,
      services,
      lockPath: uniqueLockPath(),
      heartbeatMs: 30,
      pollMs: 20,
    });
    const auth = { authorization: `Bearer ${daemon.sessionToken}` };

    const created = await json(daemon.port, "/api/v1/workflows", {
      method: "POST",
      headers: commandHeaders(auth, "wf-create-c"),
      body: JSON.stringify({ name: "Persisted" }),
    });
    const workflow = parseWorkflow(created.body);
    const versionRes = await json(daemon.port, `/api/v1/workflows/${workflow.id}/versions`, {
      method: "POST",
      headers: commandHeaders(auth, "wf-version-c", workflow.stateRevision),
      body: JSON.stringify(linearGraph),
    });
    const version = parseWorkflowVersion(versionRes.body);
    await json(daemon.port, `/api/v1/workflows/${workflow.id}/versions/${version.id}:publish`, {
      method: "POST",
      headers: commandHeaders(auth, "wf-publish-c", version.stateRevision),
      body: JSON.stringify({}),
    });

    await daemon.close();

    const restarted = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
    const daemon2 = await startDaemon({
      stateDir,
      services: restarted,
      lockPath: uniqueLockPath(),
      heartbeatMs: 30,
      pollMs: 20,
    });
    composed.push({ daemon: daemon2, stateDir });
    const auth2 = { authorization: `Bearer ${daemon2.sessionToken}` };
    const listed = parseWorkflowPage(
      (await json(daemon2.port, "/api/v1/workflows", { headers: auth2 })).body,
    );
    expect(
      listed.items.some((item) => item.id === workflow.id && item.status === "published"),
    ).toBe(true);
  });
});
