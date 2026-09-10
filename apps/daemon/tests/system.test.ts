import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { json, startTestDaemon, type TestDaemon } from "./helpers.js";

function requestWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/health", headers: { host } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("daemon system endpoints", () => {
  const daemons: TestDaemon[] = [];

  afterEach(async () => {
    for (const item of daemons.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
  });

  it("listens on loopback, writes public state without secrets, and serves health", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, stateDir } = harness;

    expect(daemon.port).toBeGreaterThan(0);
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, "daemon.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(state.port).toBe(daemon.port);
    expect(state.startIdentity).toBe(daemon.startIdentity);
    expect(JSON.stringify(state)).not.toMatch(/session|token|Bearer|bootstrap/i);

    const health = await json(daemon.port, "/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({
      ok: true,
      pid: daemon.pid,
      port: daemon.port,
      startIdentity: daemon.startIdentity,
      protocolVersion: "0.1",
    });

    const version = await json(daemon.port, "/version");
    expect(version.status).toBe(200);
    expect(version.body).toMatchObject({ protocolVersion: "0.1", apiVersion: "v1" });

    const ready = await json(daemon.port, "/ready");
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ ready: true });

    const v1health = await json(daemon.port, "/api/v1/health");
    expect(v1health.status).toBe(200);
  });

  it("rejects unauthenticated capabilities and secret query parameters", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const denied = await json(harness.daemon.port, "/api/v1/capabilities");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("content-type")).toMatch(/application\/problem\+json/);
    expect(denied.body).toMatchObject({ code: "unauthenticated" });

    const secret = await json(harness.daemon.port, "/health?token=secret");
    expect(secret.status).toBe(400);
    expect(secret.body).toMatchObject({ code: "validation_failed" });
  });

  it("rejects untrusted Host and Origin", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const host = await requestWithHost(harness.daemon.port, "evil.example");
    expect(host).toBe(403);
    const origin = await json(harness.daemon.port, "/health", {
      headers: { origin: "https://evil.example" },
    });
    expect(origin.status).toBe(403);
  });
});
