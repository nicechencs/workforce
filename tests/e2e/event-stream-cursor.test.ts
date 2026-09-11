import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createComposedAppServices, startDaemon, type StartedDaemon } from "@workforce/daemon";
import {
  createDesktopClient,
  createLoopbackTransport,
  type DesktopClient,
} from "@workforce/desktop-client";

interface Harness {
  client: DesktopClient;
  daemon: StartedDaemon;
  stateDir: string;
}

interface SseEvent {
  cursor: string;
  type: string;
  data: unknown;
}

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.daemon.close();
    fs.rmSync(harness.stateDir, { recursive: true, force: true });
  }
});

async function startProductionComposition(): Promise<Harness> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-t16-events-"));
  const lockPath = path.join(
    os.tmpdir(),
    `wf-t16-events-${process.pid}-${randomBytes(6).toString("hex")}.sock`,
  );
  let services: Awaited<ReturnType<typeof createComposedAppServices>> | undefined;
  try {
    services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
    const daemon = await startDaemon({
      stateDir,
      services,
      lockPath,
      heartbeatMs: 30,
      pollMs: 20,
    });
    const harness = {
      daemon,
      stateDir,
      client: createDesktopClient({
        transport: createLoopbackTransport({
          port: daemon.port,
          getSessionToken: () => daemon.sessionToken,
        }),
      }),
    };
    harnesses.push(harness);
    return harness;
  } catch (error) {
    await services?.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
    throw error;
  }
}

function parseSseEvents(body: string): SseEvent[] {
  const completeFrames = body.split("\n\n");
  completeFrames.pop();
  return completeFrames
    .map((frame) => frame.split("\n"))
    .filter((lines) => lines.some((line) => line.startsWith("data: ")))
    .map((lines) => {
      const cursor = lines.find((line) => line.startsWith("id: "))?.slice(4);
      const type = lines.find((line) => line.startsWith("event: "))?.slice(7);
      const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
      if (!cursor || !type || !data) {
        throw new Error(`incomplete SSE frame: ${lines.join("\\n")}`);
      }
      return { cursor, type, data: JSON.parse(data) as unknown };
    });
}

async function readUntilEvent(input: {
  daemon: StartedDaemon;
  path: string;
  type: string;
  lastEventId?: string;
  timeoutMs?: number;
}): Promise<SseEvent[]> {
  const controller = new AbortController();
  const headers = new Headers({
    accept: "text/event-stream",
    authorization: `Bearer ${input.daemon.sessionToken}`,
  });
  if (input.lastEventId) {
    headers.set("Last-Event-ID", input.lastEventId);
  }
  const response = await fetch(`http://127.0.0.1:${input.daemon.port}${input.path}`, {
    headers,
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE request failed with HTTP ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const timeoutMs = input.timeoutMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let body = "";
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining),
        ),
      ]);
      if (chunk.value) {
        body += decoder.decode(chunk.value, { stream: true });
      }
      const events = parseSseEvents(body);
      if (events.some((event) => event.type === input.type)) {
        return events;
      }
      if (chunk.done) {
        break;
      }
    }
    throw new Error(`timed out waiting for ${input.type}; received ${body}`);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
}

describe("event stream recovery through the production Daemon", () => {
  it("resumes strictly after Last-Event-ID and rejects that cursor under another filter", async () => {
    const { client, daemon } = await startProductionComposition();
    const project = await client.createProject(
      { name: "Cursor recovery", objective: "resume without duplicate delivery" },
      { idempotencyKey: "create-project", operationId: "op_create_project" },
    );
    const streamPath = client.eventsStreamPath({ projectId: project.id });

    const initial = await readUntilEvent({
      daemon,
      path: streamPath,
      type: "project.created",
    });
    const createdEvent = initial.find((event) => event.type === "project.created");
    expect(createdEvent).toBeDefined();
    if (!createdEvent) {
      throw new Error("project.created event was not delivered");
    }
    const createdData = createdEvent.data as { ingestionPosition?: unknown };
    expect(typeof createdData.ingestionPosition).toBe("number");
    expect(createdEvent.cursor).not.toBe(String(createdData.ingestionPosition));

    await client.startPlanning(project.id, {
      idempotencyKey: "start-planning",
      operationId: "op_start_planning",
      ifMatch: project.stateRevision,
    });

    const resumed = await readUntilEvent({
      daemon,
      path: streamPath,
      type: "project.planning_started",
      lastEventId: createdEvent.cursor,
    });
    expect(resumed.map((event) => event.type)).toContain("project.planning_started");
    expect(resumed.map((event) => event.type)).not.toContain("project.created");
    expect(resumed.every((event) => event.cursor !== createdEvent.cursor)).toBe(true);

    const otherProject = await client.createProject(
      { name: "Different filter", objective: "must not reuse another subscription cursor" },
      { idempotencyKey: "create-other", operationId: "op_create_other" },
    );
    const mismatch = await fetch(
      `http://127.0.0.1:${daemon.port}${client.eventsStreamPath({ projectId: otherProject.id })}`,
      {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${daemon.sessionToken}`,
          "Last-Event-ID": createdEvent.cursor,
        },
      },
    );
    expect(mismatch.status).toBe(410);
    expect(await mismatch.json()).toMatchObject({ code: "event_cursor_expired" });
  });
});
