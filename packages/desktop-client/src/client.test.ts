import { describe, expect, it } from "vitest";

import { createDesktopClient } from "./client.js";
import { ProblemError } from "./errors.js";
import type { ClientTransport, TransportRequest } from "./transport.js";

function memoryTransport(): { transport: ClientTransport; calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  const transport: ClientTransport = {
    async request(req) {
      calls.push(req);
      if (req.path.includes("missing")) {
        return {
          status: 404,
          headers: { "content-type": "application/problem+json" },
          body: {
            type: "urn:workforce:error:not_found",
            title: "Not found",
            status: 404,
            code: "not_found",
            detail: "missing",
            instance: req.path,
            requestId: "req_1",
            retryable: false,
          },
        };
      }
      return { status: 200, headers: {}, body: { ok: true, path: req.path } };
    },
  };
  return { transport, calls };
}

describe("desktop-client", () => {
  it("sends Idempotency-Key and If-Match headers without putting them in the URL", async () => {
    const { transport, calls } = memoryTransport();
    const client = createDesktopClient({ transport });
    await client.startPlanning("prj_1", { idempotencyKey: "k1", ifMatch: 3 });
    expect(calls[0]?.path).toBe("/api/v1/projects/prj_1:start-planning");
    expect(calls[0]?.path).not.toMatch(/token|authorization|secret/i);
    expect(calls[0]?.headers).toMatchObject({
      "idempotency-key": "k1",
      "if-match": '"3"',
    });
  });

  it("lists and reads published workflow catalog paths", async () => {
    const { transport, calls } = memoryTransport();
    const client = createDesktopClient({ transport });
    await client.listWorkflows();
    await client.getWorkflow("software-development-team.feature-delivery");
    await client.getWorkflowVersion("software-development-team.feature-delivery", "0.1.0");
    expect(calls.map((item) => item.path)).toEqual([
      "/api/v1/workflows",
      "/api/v1/workflows/software-development-team.feature-delivery",
      "/api/v1/workflows/software-development-team.feature-delivery/versions/0.1.0",
    ]);
  });

  it("sends M7 workflow and team write paths", async () => {
    const { transport, calls } = memoryTransport();
    const client = createDesktopClient({ transport });
    const options = { idempotencyKey: "k2", ifMatch: 1 };
    await client.createWorkflow({ name: "Draft" }, { idempotencyKey: "k1" });
    await client.createWorkflowVersion("wfd_1", { nodes: [], edges: [] }, options);
    await client.patchWorkflowVersion(
      "wfd_1",
      "wfv_1",
      { nodes: [{ id: "a", kind: "task" }], edges: [] },
      options,
    );
    await client.publishWorkflowVersion("wfd_1", "wfv_1", options);
    await client.createTeam({ name: "Squad" }, { idempotencyKey: "k3" });
    await client.patchTeam("tm_1", { name: "Renamed" }, options);
    await client.createTeamVersion(
      "tm_1",
      { members: [{ role: "developer", runtimeProfileId: "mock", quantity: 1 }] },
      options,
    );
    await client.patchTeamVersion(
      "tm_1",
      "tmv_1",
      { members: [{ role: "developer", runtimeProfileId: "mock", quantity: 2 }] },
      options,
    );
    await client.publishTeamVersion("tm_1", "tmv_1", options);
    await client.getTeamVersion("tm_software_development", "tmv_software_development_0_1_0");
    expect(calls.map((item) => `${item.method} ${item.path}`)).toEqual([
      "POST /api/v1/workflows",
      "POST /api/v1/workflows/wfd_1/versions",
      "PATCH /api/v1/workflows/wfd_1/versions/wfv_1",
      "POST /api/v1/workflows/wfd_1/versions/wfv_1:publish",
      "POST /api/v1/teams",
      "PATCH /api/v1/teams/tm_1",
      "POST /api/v1/teams/tm_1/versions",
      "PATCH /api/v1/teams/tm_1/versions/tmv_1",
      "POST /api/v1/teams/tm_1/versions/tmv_1:publish",
      "GET /api/v1/teams/tm_software_development/versions/tmv_software_development_0_1_0",
    ]);
  });

  it("throws ProblemError for problem+json responses", async () => {
    const { transport } = memoryTransport();
    const client = createDesktopClient({ transport });
    await expect(client.getProject("missing")).rejects.toBeInstanceOf(ProblemError);
  });
});
