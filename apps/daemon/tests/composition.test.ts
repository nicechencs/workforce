import fs from "node:fs";
import { realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { MOCK_PLAN_DOCUMENT } from "@workforce/application";
import { WorkforceSqlite } from "@workforce/database";
import { createCanonicalAction } from "@workforce/policy";
import { protocolVersion } from "@workforce/protocol";
import type { StoredHandle } from "@workforce/runtime-sdk";
import type { RuntimeHandle } from "@workforce/runtime-spi";

import { buildApi } from "../src/api/index.js";
import { SessionRegistry } from "../src/api/auth.js";
import { createComposedAppServicesForTest } from "../src/composition/app-services.js";
import { ComposedAppServices, createComposedAppServices } from "../src/composition/index.js";
import {
  dualWriteSqlite,
  hostStorePath,
  loadSnapshot,
  sqlitePath,
  worldPath,
} from "../src/composition/persist.js";
import { startDaemon, type StartedDaemon } from "../src/bootstrap/index.js";
import { createIdFactory } from "../src/modules/ids.js";
import { MemoryReceiptStore } from "../src/modules/receipts.js";
import { commandHeaders, json, uniqueLockPath } from "./helpers.js";

interface Harness {
  daemon: StartedDaemon;
  services: ComposedAppServices;
  stateDir: string;
  auth: Record<string, string>;
}

interface InjectHarness {
  api: FastifyInstance;
  services: ComposedAppServices;
  stateDir: string;
  auth: Record<string, string>;
}

const daemons: Harness[] = [];
const injectedApis: InjectHarness[] = [];

afterEach(async () => {
  for (const item of daemons.splice(0)) {
    await item.daemon.close();
    fs.rmSync(item.stateDir, { recursive: true, force: true });
  }
  for (const item of injectedApis.splice(0)) {
    await item.api.close();
    await item.services.close();
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

async function startInjected(
  stateDir?: string,
  completeAfterMs = 5,
  sqliteWriter?: typeof dualWriteSqlite,
): Promise<InjectHarness> {
  const dir = stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "wf-t10-inject-"));
  const options = { stateDir: dir, completeAfterMs };
  const services = sqliteWriter
    ? await createComposedAppServicesForTest(options, sqliteWriter)
    : await createComposedAppServices(options);
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
    stateDir: dir,
    auth: { authorization: `Bearer ${session.token}` },
  };
  injectedApis.push(harness);
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

async function startRunningRun(
  harness: InjectHarness,
  suffix: string,
): Promise<{
  projectId: string;
  run: { id: string; status: string; stateRevision: number };
}> {
  const created = await injectJson(harness, "/api/v1/projects", {
    method: "POST",
    headers: commandHeaders(harness.auth, `create-${suffix}`),
    body: JSON.stringify({
      name: "Cancel settlement",
      objective: "wait for runtime confirmation",
      operationId: `op_create_${suffix}`,
    }),
  });
  expect(created.status).toBe(201);
  const project = created.body as { id: string; stateRevision: number };
  const planned = await injectJson(harness, `/api/v1/projects/${project.id}:start-planning`, {
    method: "POST",
    headers: commandHeaders(harness.auth, `plan-${suffix}`, project.stateRevision),
    body: JSON.stringify({ operationId: `op_plan_${suffix}` }),
  });
  expect(planned.status).toBe(200);
  const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
  const confirmed = await injectJson(harness, `/api/v1/projects/${project.id}:confirm-plan`, {
    method: "POST",
    headers: commandHeaders(harness.auth, `confirm-${suffix}`, planning.stateRevision),
    body: JSON.stringify({
      planArtifactVersionId: planning.planArtifactVersionId,
      operationId: `op_confirm_${suffix}`,
    }),
  });
  expect(confirmed.status).toBe(200);
  const ready = confirmed.body as { stateRevision: number };
  const started = await injectJson(harness, `/api/v1/projects/${project.id}:start`, {
    method: "POST",
    headers: commandHeaders(harness.auth, `start-${suffix}`, ready.stateRevision),
    body: JSON.stringify({ operationId: `op_start_${suffix}` }),
  });
  expect(started.status).toBe(200);

  const run = await poll(async () => {
    const listed = await injectJson(harness, `/api/v1/runs?projectId=${project.id}`, {
      headers: harness.auth,
    });
    return (
      listed.body as {
        items: Array<{ id: string; status: string; stateRevision: number }>;
      }
    ).items.find((item) => item.status === "running");
  });
  return { projectId: project.id, run };
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
    const workflows = await json(port, "/api/v1/workflows", { headers: auth });
    expect(workflows.status).toBe(200);
    expect(workflows.body).toMatchObject({
      items: [
        {
          id: "software-development-team.feature-delivery",
          name: "Feature delivery",
          status: "published",
        },
      ],
    });
    const workflowVersion = await json(
      port,
      "/api/v1/workflows/software-development-team.feature-delivery/versions/0.1.0",
      { headers: auth },
    );
    expect(workflowVersion.status).toBe(200);
    expect(workflowVersion.body).toMatchObject({
      id: "0.1.0",
      immutable: true,
      entry: "planning",
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
          items: Array<{
            id: string;
            title: string;
            role?: string;
            workflowNodeId?: string;
            status: string;
            dependsOn?: Array<{ taskId: string; waitFor: string }>;
          }>;
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
    const byNode = new Map(tasks.map((task) => [task.workflowNodeId ?? task.title, task] as const));
    const alpha = byNode.get("dev_alpha");
    const bravo = byNode.get("dev_bravo");
    const review = byNode.get("review_integration");
    expect(alpha?.dependsOn).toEqual([]);
    expect(bravo?.dependsOn).toEqual([]);
    expect(review?.dependsOn?.map((edge) => edge.taskId).sort()).toEqual(
      [alpha?.id, bravo?.id].filter((id): id is string => typeof id === "string").sort(),
    );
    expect(review?.dependsOn?.every((edge) => edge.waitFor === "outputs_ready")).toBe(true);

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
    const reviewTask = (
      reviewTasks.body as {
        items: Array<{ workflowNodeId?: string; title: string; status: string }>;
      }
    ).items.find((item) => (item.workflowNodeId ?? item.title) === "review_integration");
    if (finished.status === "running") {
      expect(reviewTask?.status).toBe("waiting_review");
    } else {
      expect(finished.status).toBe("completed");
    }
  });

  it("settles a run only after the Host confirms cancellation and persists it idempotently", async () => {
    const first = await startInjected(undefined, 60_000);
    const { auth, services, stateDir } = first;
    const { run: running } = await startRunningRun(first, "cancel");
    const accepted = await injectJson(first, `/api/v1/runs/${running.id}:cancel`, {
      method: "POST",
      headers: commandHeaders(auth, "cancel-run", running.stateRevision),
      body: JSON.stringify({ reason: "stop", operationId: "op_cancel_run" }),
    });
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({ resource: { type: "run", id: running.id } });
    const durableRun = services.sqlite.worldSnapshot
      .load()
      .runs.find((item) => item.id === running.id);
    expect(durableRun?.cancelRequestedAt).toBeTruthy();

    const pending = await injectJson(first, `/api/v1/runs/${running.id}`, { headers: auth });
    expect(pending.body).toMatchObject({ status: "running", cancelRequested: true });

    const settled = await poll(async () => {
      const current = await injectJson(first, `/api/v1/runs/${running.id}`, { headers: auth });
      const body = current.body as {
        id: string;
        status: string;
        stateRevision: number;
        cancelRequested: boolean;
      };
      return body.status === "cancelled" ? body : undefined;
    });
    expect(settled.cancelRequested).toBe(true);

    const run = services.app.world.runs.get(running.id);
    expect(run?.handleId).toBeTruthy();
    await (
      services as unknown as {
        handleTerminal(event: {
          handleId: string;
          hostRunId: string;
          status: "cancelled";
        }): Promise<void>;
      }
    ).handleTerminal({
      handleId: run!.handleId!,
      hostRunId: running.id,
      status: "cancelled",
    });
    const afterDuplicate = await injectJson(first, `/api/v1/runs/${running.id}`, {
      headers: auth,
    });
    expect(afterDuplicate.body).toMatchObject({
      status: "cancelled",
      stateRevision: settled.stateRevision,
    });

    await first.api.close();
    await services.close();
    injectedApis.splice(injectedApis.indexOf(first), 1);

    const second = await startInjected(stateDir, 60_000);
    const restored = await injectJson(second, `/api/v1/runs/${running.id}`, {
      headers: second.auth,
    });
    expect(restored.body).toMatchObject({
      status: "cancelled",
      stateRevision: settled.stateRevision,
      cancelRequested: true,
    });
  });

  it("preserves a pending cancellation through restart without dispatching another run", async () => {
    const first = await startInjected(undefined, 60_000);
    const { services, stateDir } = first;
    const { projectId, run } = await startRunningRun(first, "cancel-restart");
    const handleId = services.app.world.runs.get(run.id)?.handleId;
    expect(handleId).toBeTruthy();

    const accepted = await injectJson(first, `/api/v1/runs/${run.id}:cancel`, {
      method: "POST",
      headers: commandHeaders(first.auth, "cancel-before-restart", run.stateRevision),
      body: JSON.stringify({ reason: "restart", operationId: "op_cancel_before_restart" }),
    });
    expect(accepted.status).toBe(202);
    const pending = await injectJson(first, `/api/v1/runs/${run.id}`, {
      headers: first.auth,
    });
    expect(pending.body).toMatchObject({ status: "running", cancelRequested: true });

    const before = await injectJson(first, `/api/v1/runs?projectId=${projectId}`, {
      headers: first.auth,
    });
    const beforeIds = (before.body as { items: Array<{ id: string }> }).items.map(
      (item) => item.id,
    );
    await expect(services.host.inspect(handleId!)).resolves.toMatchObject({ status: "running" });
    await first.api.close();
    await services.close();
    injectedApis.splice(injectedApis.indexOf(first), 1);

    const second = await startInjected(stateDir, 60_000);
    const restored = await injectJson(second, `/api/v1/runs/${run.id}`, {
      headers: second.auth,
    });
    expect(restored.body).toMatchObject({ status: "running", cancelRequested: true });
    expect(second.services.app.world.runs.get(run.id)?.handleId).toBe(handleId);

    const after = await injectJson(second, `/api/v1/runs?projectId=${projectId}`, {
      headers: second.auth,
    });
    const afterIds = (after.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(afterIds.sort()).toEqual(beforeIds.sort());
    // The replacement session fences the resolved binding: it reports the last
    // trusted status instead of re-dispatching or re-inspecting the old Run.
    await expect(second.services.host.inspect(handleId!)).resolves.toMatchObject({
      status: "running",
    });
  });

  it.each(["deleted", "corrupt", "stale"] as const)(
    "restores handle identity from SQLite when JSON sidecars are %s",
    async (sidecarState) => {
      const first = await startInjected(undefined, 60_000);
      const { projectId, run } = await startRunningRun(first, `sqlite-handle-${sidecarState}`);
      const handleId = first.services.app.world.runs.get(run.id)?.handleId;
      expect(handleId).toBeTruthy();

      const durable = await poll(() => first.services.sqlite.handles.get(run.id) ?? undefined);
      const durableStored = durable.handle as StoredHandle;
      expect(durable.runId).toBe(run.id);
      expect(durableStored.handle.handleId).toBe(handleId);
      expect(durableStored.handle.process?.startIdentity).toBe(durable.startIdentity);

      const before = await injectJson(first, `/api/v1/runs?projectId=${projectId}`, {
        headers: first.auth,
      });
      const beforeIds = (before.body as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      );
      const stateDir = first.stateDir;
      await first.api.close();
      await first.services.close();
      injectedApis.splice(injectedApis.indexOf(first), 1);

      if (sidecarState === "stale") {
        const sidecar = JSON.parse(fs.readFileSync(hostStorePath(stateDir), "utf8")) as {
          handles: StoredHandle[];
        };
        const stale = sidecar.handles.find(
          (record) => record.request.operationId === durableStored.request.operationId,
        );
        expect(stale).toBeTruthy();
        stale!.handle.handleId = "hdl_stale_sidecar";
        stale!.handle.process = {
          pid: (durable.pid ?? 0) + 1,
          startIdentity: "stale-sidecar-identity",
        };
        fs.writeFileSync(hostStorePath(stateDir), JSON.stringify(sidecar), "utf8");
      } else {
        for (const sidecar of [worldPath(stateDir), hostStorePath(stateDir)]) {
          if (sidecarState === "deleted") {
            fs.unlinkSync(sidecar);
          } else {
            fs.writeFileSync(sidecar, "{not-json", "utf8");
          }
        }
      }

      const second = await startInjected(stateDir, 60_000);
      const restoredRun = second.services.app.world.runs.get(run.id);
      expect(restoredRun?.handleId).toBe(handleId);
      const reopened = second.services.sqlite.handles.get(run.id);
      expect(reopened?.startIdentity).toBe(durable.startIdentity);
      expect((reopened?.handle as StoredHandle).handle.handleId).toBe(handleId);

      let inspectedHandle: RuntimeHandle | undefined;
      second.services.host.adapter.inspect = async (handle) => {
        inspectedHandle = structuredClone(handle as RuntimeHandle);
        return {
          handle: { handleId: handle.handleId, runId: handle.runId },
          status: "running",
        };
      };
      await expect(second.services.host.inspect(handleId!)).resolves.toMatchObject({
        status: "running",
      });
      if (sidecarState === "stale") {
        // This sidecar carries no node session, so the replacement session fences
        // the resolved binding and inspect answers from the stored status instead
        // of asking the runtime adapter. The durable identity is proven by cancel.
        expect(inspectedHandle).toBeUndefined();
      } else {
        expect(inspectedHandle).toMatchObject({
          handleId,
          process: {
            pid: durable.pid,
            startIdentity: durable.startIdentity,
          },
        });
      }

      let cancelledHandle: RuntimeHandle | undefined;
      second.services.host.adapter.cancel = async (handle) => {
        cancelledHandle = structuredClone(handle as RuntimeHandle);
        return { operationId: `cancel:${handle.handleId}`, accepted: true };
      };
      const current = await injectJson(second, `/api/v1/runs/${run.id}`, {
        headers: second.auth,
      });
      const cancelled = await injectJson(second, `/api/v1/runs/${run.id}:cancel`, {
        method: "POST",
        headers: commandHeaders(
          second.auth,
          `cancel-sqlite-${sidecarState}`,
          (current.body as { stateRevision: number }).stateRevision,
        ),
        body: JSON.stringify({ operationId: `op_cancel_sqlite_${sidecarState}` }),
      });
      expect(cancelled.status).toBe(202);
      expect(cancelledHandle).toMatchObject({
        handleId,
        process: {
          pid: durable.pid,
          startIdentity: durable.startIdentity,
        },
      });

      const after = await injectJson(second, `/api/v1/runs?projectId=${projectId}`, {
        headers: second.auth,
      });
      const afterIds = (after.body as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      );
      expect(afterIds.sort()).toEqual(beforeIds.sort());
    },
    20_000,
  );

  it("does not acknowledge cancel when its SQLite commit fails and keeps the queue retryable", async () => {
    let failNextWrite = false;
    const sqliteWriter: typeof dualWriteSqlite = async (...args) => {
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("injected SQLite write failure");
      }
      await dualWriteSqlite(...args);
    };
    const harness = await startInjected(undefined, 60_000, sqliteWriter);
    const { services } = harness;
    const { run } = await startRunningRun(harness, "cancel-write-failure");
    await poll(() =>
      services.sqlite.worldSnapshot.load().runs.some((item) => item.id === run.id)
        ? true
        : undefined,
    );

    failNextWrite = true;
    const failed = await injectJson(harness, `/api/v1/runs/${run.id}:cancel`, {
      method: "POST",
      headers: commandHeaders(harness.auth, "cancel-write-failure", run.stateRevision),
      body: JSON.stringify({ operationId: "op_cancel_write_failure" }),
    });
    expect(failed.status).toBe(500);
    const afterFailure = services.sqlite.worldSnapshot
      .load()
      .runs.find((item) => item.id === run.id);
    expect(afterFailure?.cancelRequestedAt).toBeUndefined();
    expect(
      loadSnapshot(harness.stateDir)?.world.runs.find((item) => item.id === run.id)
        ?.cancelRequestedAt,
    ).toBeUndefined();
    const retryState = await injectJson(harness, `/api/v1/runs/${run.id}`, {
      headers: harness.auth,
    });
    expect(retryState.body).toMatchObject({ status: "running", cancelRequested: true });
    const retryRevision = (retryState.body as { stateRevision: number }).stateRevision;

    const retried = await injectJson(harness, `/api/v1/runs/${run.id}:cancel`, {
      method: "POST",
      headers: commandHeaders(harness.auth, "cancel-write-retry", retryRevision),
      body: JSON.stringify({ operationId: "op_cancel_write_retry" }),
    });
    expect(retried.status).toBe(202);
    const durableRun = services.sqlite.worldSnapshot.load().runs.find((item) => item.id === run.id);
    expect(durableRun?.cancelRequestedAt).toBeTruthy();
  });

  // Requires T09 reconcile to persist an honest recovery-time cancelRequestedAt from Host facts.
  it("recovers a Host-confirmed cancellation after pending and terminal SQLite writes fail", async () => {
    const failureTarget: { runId?: string } = {};
    let pendingWriteFailures = 0;
    let terminalWriteFailures = 0;
    const sqliteWriter: typeof dualWriteSqlite = async (sqlite, world, synced, handles) => {
      const target = failureTarget.runId
        ? world.runs.find((item) => item.id === failureTarget.runId)
        : undefined;
      if (target?.status === "cancelled") {
        terminalWriteFailures += 1;
        throw new Error("injected terminal SQLite write failure");
      }
      if (target?.cancelRequestedAt) {
        pendingWriteFailures += 1;
        throw new Error("injected pending SQLite write failure");
      }
      await dualWriteSqlite(sqlite, world, synced, handles);
    };
    const first = await startInjected(undefined, 60_000, sqliteWriter);
    const { services, stateDir } = first;
    const { projectId, run } = await startRunningRun(first, "cancel-terminal-write-failure");
    const handleId = services.app.world.runs.get(run.id)?.handleId;
    expect(handleId).toBeTruthy();
    await poll(() =>
      services.sqlite.worldSnapshot.load().runs.some((item) => item.id === run.id)
        ? true
        : undefined,
    );
    failureTarget.runId = run.id;

    const failed = await injectJson(first, `/api/v1/runs/${run.id}:cancel`, {
      method: "POST",
      headers: commandHeaders(first.auth, "cancel-terminal-write-failure", run.stateRevision),
      body: JSON.stringify({ operationId: "op_cancel_terminal_write_failure" }),
    });
    expect(failed.status).toBe(500);
    expect(pendingWriteFailures).toBe(1);

    await poll(async () => {
      const current = await injectJson(first, `/api/v1/runs/${run.id}`, {
        headers: first.auth,
      });
      return (current.body as { status: string }).status === "cancelled" ? true : undefined;
    });
    await poll(() => (terminalWriteFailures > 0 ? true : undefined));
    await expect(services.host.inspect(handleId!)).resolves.toMatchObject({
      status: "cancelled",
    });
    const staleSqliteRun = services.sqlite.worldSnapshot
      .load()
      .runs.find((item) => item.id === run.id);
    expect(staleSqliteRun).toMatchObject({ status: "running" });
    expect(staleSqliteRun?.cancelRequestedAt).toBeUndefined();

    const before = await injectJson(first, `/api/v1/runs?projectId=${projectId}`, {
      headers: first.auth,
    });
    const beforeIds = (before.body as { items: Array<{ id: string }> }).items.map(
      (item) => item.id,
    );
    await first.api.close();
    await services.close();
    injectedApis.splice(injectedApis.indexOf(first), 1);

    const second = await startInjected(stateDir, 60_000);
    const restored = await injectJson(second, `/api/v1/runs/${run.id}`, {
      headers: second.auth,
    });
    expect(restored.body).toMatchObject({ status: "cancelled", cancelRequested: true });
    const restoredRun = second.services.app.world.runs.get(run.id);
    expect(restoredRun?.handleId).toBe(handleId);
    expect(restoredRun?.cancelRequestedAt).toBeTruthy();
    await expect(second.services.host.inspect(handleId!)).resolves.toMatchObject({
      status: "cancelled",
    });
    await poll(() => {
      const persisted = second.services.sqlite.worldSnapshot
        .load()
        .runs.find((item) => item.id === run.id);
      return persisted?.status === "cancelled" && persisted.cancelRequestedAt ? true : undefined;
    });
    const after = await injectJson(second, `/api/v1/runs?projectId=${projectId}`, {
      headers: second.auth,
    });
    const afterIds = (after.body as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(afterIds.sort()).toEqual(beforeIds.sort());
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

  it("reloads budget and reservation from sqlite after world.json is deleted", async () => {
    const first = await startComposed();
    const created = await json(first.daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(first.auth, "create-bdg"),
      body: JSON.stringify({
        name: "Budget authority",
        objective: "survive budget without world.json",
        operationId: "op_bdg",
      }),
    });
    expect(created.status).toBe(201);
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(first.daemon.port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(first.auth, "plan-bdg", project.stateRevision),
      body: JSON.stringify({ operationId: "op_bdg_plan" }),
    });
    expect(planned.status).toBe(200);
    const planning = planned.body as { stateRevision: number };
    const budgetId = first.services.app.world.projects.get(project.id)?.budgetId;
    expect(budgetId).toBeTruthy();

    const reserved = first.services.app.reserveBudget({
      budgetId: budgetId!,
      amount: { costMinor: 250, currency: "USD", kind: "estimated" },
      runId: "run_budget_persist",
    });
    first.services.app.settleUsage({
      budgetId: budgetId!,
      amount: { costMinor: 80, currency: "USD", kind: "settled" },
      usageKey: "usage-persist-1",
    });
    expect(reserved.budget.reservedMinor).toBe(170);

    const before = await json(first.daemon.port, `/api/v1/projects/${project.id}/budget`, {
      headers: first.auth,
    });
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      kind: "estimated",
      estimatedLimitMinor: 1_000_000,
      reservedMinor: 170,
      settledMinor: 80,
      authorizationVersion: 1,
    });

    await first.daemon.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const db = WorkforceSqlite.open(sqlitePath(first.stateDir));
    const entities = db.worldSnapshot.load();
    expect(entities.budgets.some((item) => item.id === budgetId && item.settledMinor === 80)).toBe(
      true,
    );
    expect(
      entities.reservations.some((item) => item.budgetId === budgetId && item.amountMinor === 250),
    ).toBe(true);
    expect(entities.usageKeys).toContain("usage-persist-1");
    db.close();
    fs.unlinkSync(path.join(first.stateDir, "world.json"));

    const second = await startComposed(first.stateDir);
    const budget = await json(second.daemon.port, `/api/v1/projects/${project.id}/budget`, {
      headers: second.auth,
    });
    expect(budget.status).toBe(200);
    expect(budget.body).toMatchObject({
      kind: "estimated",
      estimatedLimitMinor: 1_000_000,
      reservedMinor: 170,
      settledMinor: 80,
    });
    expect(second.services.app.world.usageKeys.has("usage-persist-1")).toBe(true);
    expect(
      [...second.services.app.world.reservations.values()].some(
        (item) => item.budgetId === budgetId && item.amountMinor === 250,
      ),
    ).toBe(true);
    expect(
      second.services.app.settleUsage({
        budgetId: budgetId!,
        amount: { costMinor: 80, currency: "USD", kind: "settled" },
        usageKey: "usage-persist-1",
      }).settledMinor,
    ).toBe(80);
    expect(() =>
      second.services.app.reserveBudget({
        budgetId: budgetId!,
        amount: { costMinor: 0, currency: "USD", kind: "unknown" },
      }),
    ).toThrow(/unknown cost/);

    const hardBudget = await json(second.daemon.port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(second.auth, "start-bdg-hard", planning.stateRevision),
      body: JSON.stringify({ budgetHardLimitMinor: 100, operationId: "op_bdg_hard" }),
    });
    expect(hardBudget.status).toBe(422);
    expect(hardBudget.body).toMatchObject({ code: "unknown_cost_not_enforceable" });
  }, 20_000);

  it("keeps Task dependsOn and artifact bytes after world.json is deleted", async () => {
    const first = await startComposed();
    const { daemon, auth, stateDir } = first;
    const port = daemon.port;
    const created = await json(port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-art-auth"),
      body: JSON.stringify({
        name: "Artifact authority",
        objective: "store bytes outside world.json",
        operationId: "op_art_auth_create",
      }),
    });
    expect(created.status).toBe(201);
    const project = created.body as { id: string; stateRevision: number };
    const workspace = await json(port, `/api/v1/projects/${project.id}/workspaces`, {
      method: "POST",
      headers: commandHeaders(auth, "ws-art-auth", project.stateRevision),
      body: JSON.stringify({ authorizationRef: "desktop-picker-ref", operationId: "op_art_ws" }),
    });
    expect(workspace.status).toBe(201);
    const afterWs = await json(port, `/api/v1/projects/${project.id}`, { headers: auth });
    const draft = afterWs.body as { stateRevision: number };
    const planned = await json(port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-art-auth", draft.stateRevision),
      body: JSON.stringify({ operationId: "op_art_plan" }),
    });
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };
    const confirmed = await json(port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-art-auth", planning.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_art_confirm",
      }),
    });
    const ready = confirmed.body as { stateRevision: number };
    const started = await json(port, `/api/v1/projects/${project.id}:start`, {
      method: "POST",
      headers: commandHeaders(auth, "start-art-auth", ready.stateRevision),
      body: JSON.stringify({ operationId: "op_art_start" }),
    });
    expect(started.status).toBe(200);

    const patchArtifacts = await poll(async () => {
      const listed = await json(port, `/api/v1/artifacts?projectId=${project.id}`, {
        headers: auth,
      });
      const items = (
        listed.body as {
          items: Array<{
            id: string;
            kind: string;
            logicalName: string;
            versions: Array<{ id: string; hash: string }>;
          }>;
        }
      ).items.filter(
        (item) =>
          item.kind === "git_diff" ||
          item.logicalName.includes("code") ||
          item.logicalName.includes("change") ||
          item.logicalName.includes("patch"),
      );
      return items.length >= 2 ? items : undefined;
    });
    const firstContent: Array<{ id: string; versionId: string; text: string; hash: string }> = [];
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
      firstContent.push({
        id: artifact.id,
        versionId: versionId!,
        text,
        hash: artifact.versions[0]!.hash,
      });
    }

    const world = JSON.parse(fs.readFileSync(path.join(stateDir, "world.json"), "utf8")) as {
      artifactContents?: Array<{ bodyBase64?: string }>;
    };
    expect((world.artifactContents ?? []).every((record) => record.bodyBase64 === undefined)).toBe(
      true,
    );
    expect(fs.existsSync(path.join(stateDir, "artifacts", "versions"))).toBe(true);

    await first.daemon.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.unlinkSync(path.join(stateDir, "world.json"));

    const second = await startComposed(stateDir);
    const tasks = await json(second.daemon.port, `/api/v1/tasks?projectId=${project.id}`, {
      headers: second.auth,
    });
    const items = (
      tasks.body as {
        items: Array<{
          id: string;
          workflowNodeId?: string;
          title: string;
          dependsOn: Array<{ taskId: string; waitFor: string }>;
        }>;
      }
    ).items;
    const byNode = new Map(items.map((task) => [task.workflowNodeId ?? task.title, task] as const));
    const review = byNode.get("review_integration");
    expect(review?.dependsOn.length).toBe(2);
    expect(review?.dependsOn.every((edge) => edge.waitFor === "outputs_ready")).toBe(true);

    for (const artifact of firstContent) {
      const content = await fetch(
        `http://127.0.0.1:${second.daemon.port}/api/v1/artifacts/${artifact.id}/versions/${artifact.versionId}/content`,
        { headers: second.auth },
      );
      expect(content.ok).toBe(true);
      expect(await content.text()).toBe(artifact.text);
    }
  }, 20_000);

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

  it("stores a policy plan.apply digest and rejects confirm when it no longer matches", async () => {
    const harness = await startComposed();
    const { daemon, auth, services } = harness;
    const created = await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "create-pol"),
      body: JSON.stringify({
        name: "Policy digest",
        objective: "gate confirm",
        operationId: "op_pol_c",
      }),
    });
    const project = created.body as { id: string; stateRevision: number };
    const planned = await json(daemon.port, `/api/v1/projects/${project.id}:start-planning`, {
      method: "POST",
      headers: commandHeaders(auth, "plan-pol", project.stateRevision),
      body: JSON.stringify({ operationId: "op_pol_p" }),
    });
    expect(planned.status).toBe(200);
    const planning = planned.body as { stateRevision: number; planArtifactVersionId: string };

    const listed = await json(daemon.port, `/api/v1/approvals?projectId=${project.id}`, {
      headers: auth,
    });
    const planApproval = (
      listed.body as {
        items: Array<{
          id: string;
          gate: string;
          status: string;
          actionDigest: string;
          resource: string;
          artifactVersionId?: string;
        }>;
      }
    ).items.find((item) => item.gate === "plan");
    expect(planApproval).toBeTruthy();
    if (!planApproval) {
      throw new Error("expected a plan approval");
    }
    expect(planApproval.actionDigest).toBe(
      createCanonicalAction({
        type: "plan.apply",
        resource: planApproval.resource,
        params: MOCK_PLAN_DOCUMENT,
        ...(planApproval.artifactVersionId !== undefined
          ? { version: planApproval.artifactVersionId }
          : {}),
      }).digest,
    );

    const wrongApprove = await json(daemon.port, `/api/v1/approvals/${planApproval.id}:approve`, {
      method: "POST",
      headers: commandHeaders(auth, "approve-wrong", 1),
      body: JSON.stringify({
        decisionReason: "stale",
        digest: "deadbeef",
        operationId: "op_pol_wrong",
      }),
    });
    expect(wrongApprove.status).toBe(409);
    expect(wrongApprove.body).toMatchObject({ code: "conflict" });

    const stored = services.app.world.approvals.get(planApproval.id);
    if (!stored) {
      throw new Error("expected stored plan approval");
    }
    stored.actionDigest = "tampered";
    const confirmed = await json(daemon.port, `/api/v1/projects/${project.id}:confirm-plan`, {
      method: "POST",
      headers: commandHeaders(auth, "confirm-pol", planning.stateRevision),
      body: JSON.stringify({
        planArtifactVersionId: planning.planArtifactVersionId,
        operationId: "op_pol_cf",
      }),
    });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body).toMatchObject({ code: "conflict" });
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
