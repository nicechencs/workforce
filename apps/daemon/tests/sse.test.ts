import fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { encodeSseCursor } from "@workforce/protocol";
import { cursorFilterDigest } from "@workforce/events/subscriptions";

import { commandHeaders, json, startTestDaemon, type TestDaemon } from "./helpers.js";

async function readSse(
  port: number,
  path: string,
  headers: Record<string, string>,
  ms = 80,
): Promise<string> {
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { ...headers, accept: "text/event-stream" },
    signal: ac.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(`sse HTTP ${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  let out = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining),
        ),
      ]);
      if (result.value) {
        out += new TextDecoder().decode(result.value);
      }
      if (result.done && !result.value) {
        break;
      }
    }
  } finally {
    ac.abort();
    await reader.cancel().catch(() => undefined);
  }
  return out;
}

describe("daemon SSE", () => {
  const daemons: TestDaemon[] = [];

  afterEach(async () => {
    for (const item of daemons.splice(0)) {
      await item.daemon.close();
      fs.rmSync(item.stateDir, { recursive: true, force: true });
    }
  });

  it("streams events with ingestionPosition cursors and heartbeats", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, auth } = harness;
    await json(daemon.port, "/api/v1/projects", {
      method: "POST",
      headers: commandHeaders(auth, "sse-create"),
      body: JSON.stringify({ name: "S", objective: "stream" }),
    });

    const body = await readSse(daemon.port, "/api/v1/events/stream", auth, 90);
    expect(body).toContain("event: project.created");
    expect(body).toContain("ingestionPosition");
    expect(body).toContain(": heartbeat");
    expect(body).toMatch(/^id: /m);
  });

  it("returns 410 when the cursor filter no longer matches", async () => {
    const harness = await startTestDaemon();
    daemons.push(harness);
    const { daemon, auth } = harness;
    const digest = cursorFilterDigest({ projectId: "prj_a" });
    const cursor = encodeSseCursor({ ingestionPosition: 1, filterDigest: digest });
    const res = await json(daemon.port, `/api/v1/events/stream?projectId=prj_b`, {
      headers: { ...auth, "Last-Event-ID": cursor },
    });
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: "event_cursor_expired" });
  });
});
