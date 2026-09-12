import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { protocolVersion } from "@workforce/protocol";

import { buildApi } from "../src/api/index.js";
import { SessionRegistry } from "../src/api/auth.js";
import { createComposedAppServices, type ComposedAppServices } from "../src/composition/index.js";
import { createIdFactory } from "../src/modules/ids.js";
import { MemoryReceiptStore } from "../src/modules/receipts.js";
import { commandHeaders } from "./helpers.js";

interface InjectHarness {
  api: FastifyInstance;
  services: ComposedAppServices;
  stateDir: string;
  auth: Record<string, string>;
}

const injected: InjectHarness[] = [];

afterEach(async () => {
  for (const item of injected.splice(0)) {
    await item.api.close();
    await item.services.close();
    fs.rmSync(item.stateDir, { recursive: true, force: true });
  }
});

async function startInjected(): Promise<InjectHarness> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-orch-pass-"));
  const services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
  const sessions = new SessionRegistry("usr_test", "cli_test");
  const session = sessions.issue();
  const api = buildApi({
    services,
    receipts: new MemoryReceiptStore(),
    sessions,
    ids: createIdFactory(),
    now: () => new Date(),
    protocolVersion,
    pid: process.pid,
    startIdentity: `test:${process.pid}`,
    bootstrapToken: "test-bootstrap-token",
    sse: { heartbeatMs: 30, pollMs: 20 },
    getPort: () => 0,
  });
  await api.ready();
  const harness = {
    api,
    services,
    stateDir,
    auth: { authorization: `Bearer ${session.token}` },
  };
  injected.push(harness);
  return harness;
}

async function injectJson(
  harness: InjectHarness,
  pathName: string,
  init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await harness.api.inject({
    method: init.method ?? "GET",
    url: pathName,
    headers: init.headers,
    payload: init.body,
  });
  return {
    status: response.statusCode,
    body: response.body.length > 0 ? (JSON.parse(response.body) as unknown) : null,
  };
}

describe("composed orchestrationMode pass-through", () => {
  it(
    "threads workflow_bound into project.start / Run records and still refuses unsupported direct",
    { timeout: 40_000 },
    async () => {
    const harness = await startInjected();
    const { auth, services } = harness;

    const created = await injectJson(harness, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "orch-comp-create"),
      body: JSON.stringify({ name: "Orch composed", objective: "Pass through" }),
    });
    expect(created.status).toBe(201);
    const project = created.body as { id: string; stateRevision: number };

    const planned = await injectJson(harness, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "orch-comp-plan", project.stateRevision),
      body: "{}",
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await injectJson(harness, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "orch-comp-confirm", planning.stateRevision),
      body: JSON.stringify({ planArtifactVersionId: planning.planArtifactVersionId }),
    });
    const ready = confirmed.body as { stateRevision: number };

    const refused = await injectJson(harness, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "orch-comp-direct", ready.stateRevision),
      body: JSON.stringify({ orchestrationMode: "direct" }),
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: "unsupported_capability" });

    const started = await injectJson(harness, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "orch-comp-bound", ready.stateRevision),
      body: JSON.stringify({
        orchestrationMode: "workflow_bound",
        operationId: "op_orch_comp_bound",
      }),
    });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      status: "running",
      orchestrationMode: "workflow_bound",
    });

    const listed = await injectJson(harness, `/api/v1/runs?projectId=${project.id}`, {
      headers: auth,
    });
    expect(listed.status).toBe(200);
    const runs = (
      listed.body as {
        items: Array<{ orchestrationMode?: string }>;
      }
    ).items;
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((item) => item.orchestrationMode === "workflow_bound")).toBe(true);

    const receipt = await injectJson(harness, "/api/v1/operations/op_orch_comp_bound", {
      headers: auth,
    });
    expect(receipt.status).toBe(200);
    expect(receipt.body).toMatchObject({
      result: { orchestrationMode: "workflow_bound" },
    });

    const worldProject = services.app.world.projects.get(project.id);
    expect(worldProject?.orchestrationMode).toBe("workflow_bound");
    const worldRun = [...services.app.world.runs.values()].find(
      (item) => item.projectId === project.id,
    );
    expect(worldRun?.orchestrationMode).toBe("workflow_bound");
  },
);
});
