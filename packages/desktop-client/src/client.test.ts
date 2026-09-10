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

  it("throws ProblemError for problem+json responses", async () => {
    const { transport } = memoryTransport();
    const client = createDesktopClient({ transport });
    await expect(client.getProject("missing")).rejects.toBeInstanceOf(ProblemError);
  });
});
