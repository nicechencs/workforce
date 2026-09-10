import { afterEach, describe, expect, it } from "vitest";

import { getT13Client, resetT13Client, setT13ApiRequest } from "./_t13_client.js";

afterEach(() => {
  resetT13Client();
});

describe("T13 desktop client wrapper", () => {
  it("sends typed client calls through the injected preload request, not loopback", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    setT13ApiRequest(async (input) => {
      calls.push({ method: input.method, path: input.path });
      return {
        ok: true,
        status: 200,
        body: { items: [], page: { nextCursor: null, hasMore: false } },
      };
    });
    await getT13Client().listRuns();
    expect(calls).toEqual([{ method: "GET", path: "/api/v1/runs" }]);
  });

  it("surfaces cancel 202 as accepted without inventing a cancelled run", async () => {
    setT13ApiRequest(async (input) => {
      expect(input.method).toBe("POST");
      expect(input.path).toBe("/api/v1/runs/run_1:cancel");
      return {
        ok: true,
        status: 202,
        body: {
          operationId: "op_1",
          acceptedAt: "2026-09-10T00:00:00.000Z",
          resource: { type: "run", id: "run_1" },
        },
      };
    });
    const accepted = await getT13Client().cancelRun("run_1", { idempotencyKey: "k1" });
    expect(accepted.resource).toEqual({ type: "run", id: "run_1" });
    expect(accepted).not.toMatchObject({ status: "cancelled" });
  });

  it("does not turn a failed approve into success", async () => {
    setT13ApiRequest(async () => ({
      ok: false,
      status: 409,
      code: "conflict",
      message: "Approval digest does not match the canonical action",
    }));
    await expect(
      getT13Client().approve(
        "apr_1",
        { decisionReason: "ok", digest: "stale" },
        { idempotencyKey: "k2" },
      ),
    ).rejects.toThrow(/digest/);
  });
});
