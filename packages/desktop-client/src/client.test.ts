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

  it("uses the project-scoped authoring session resources", async () => {
    const { transport, calls } = memoryTransport();
    const client = createDesktopClient({ transport });

    await client.createAuthoringSession("prj_1", {
      idempotencyKey: "authoring-create-1",
      operationId: "op_authoring_create",
    });
    await client.listAuthoringSessions({ projectId: "prj_1", limit: 20 });
    await client.getAuthoringSession("cas_1");
    await client.sendAuthoringMessage("cas_1", "Create a workflow", {
      idempotencyKey: "authoring-message-1",
      operationId: "op_authoring_message",
      ifMatch: 1,
    });
    await client.getAuthoringTurn("cas_1", "cat_1");
    await client.getAuthoringProposal("cas_1", "apr_1");
    await client.confirmAuthoringTurn("cas_1", "cat_1", {
      idempotencyKey: "authoring-confirm-1",
      operationId: "op_authoring_confirm",
      ifMatch: 2,
    });
    await client.cancelAuthoringTurn("cas_1", "cat_1", {
      idempotencyKey: "authoring-cancel-1",
      ifMatch: 3,
    });
    await client.retryAuthoringTurn("cas_1", "cat_1", {
      idempotencyKey: "authoring-retry-1",
      ifMatch: 4,
    });
    await client.closeAuthoringTurn("cas_1", "cat_1", {
      idempotencyKey: "authoring-close-1",
      ifMatch: 5,
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/projects/prj_1/authoring-sessions",
      "/api/v1/authoring-sessions?projectId=prj_1&limit=20",
      "/api/v1/authoring-sessions/cas_1",
      "/api/v1/authoring-sessions/cas_1/messages",
      "/api/v1/authoring-sessions/cas_1/turns/cat_1",
      "/api/v1/authoring-sessions/cas_1/proposals/apr_1",
      "/api/v1/authoring-sessions/cas_1/turns/cat_1/_cmd/confirm",
      "/api/v1/authoring-sessions/cas_1/turns/cat_1/_cmd/cancel",
      "/api/v1/authoring-sessions/cas_1/turns/cat_1/_cmd/retry",
      "/api/v1/authoring-sessions/cas_1/turns/cat_1/_cmd/close",
    ]);
    expect(calls[0]?.body).toEqual({ operationId: "op_authoring_create" });
    expect(calls[3]?.body).toEqual({
      content: "Create a workflow",
      operationId: "op_authoring_message",
    });
    expect(calls[3]?.headers).toMatchObject({
      "idempotency-key": "authoring-message-1",
      "if-match": '"1"',
    });
    expect(calls[6]?.headers).toMatchObject({
      "idempotency-key": "authoring-confirm-1",
      "if-match": '"2"',
    });
  });

  it("throws ProblemError for problem+json responses", async () => {
    const { transport } = memoryTransport();
    const client = createDesktopClient({ transport });
    await expect(client.getProject("missing")).rejects.toBeInstanceOf(ProblemError);
  });
});
