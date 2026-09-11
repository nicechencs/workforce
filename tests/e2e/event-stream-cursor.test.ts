import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposedDaemonHarnesses } from "../helpers/composed-daemon.js";

interface SseEvent {
  cursor: string;
  type: string;
  data: unknown;
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

class SseHttpError extends Error {
  override readonly name = "SseHttpError";

  constructor(
    readonly status: number,
    readonly responseText: string,
  ) {
    super(`SSE request failed with HTTP ${status}: ${responseText}`);
  }
}

const harnesses = new ComposedDaemonHarnesses();

afterEach(async () => {
  vi.useRealTimers();
  await harnesses.closeAll();
});

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
  url: string;
  type: string;
  headers?: ConstructorParameters<typeof Headers>[0];
  lastEventId?: string;
  timeoutMs?: number;
  fetchImpl?: FetchImplementation;
}): Promise<SseEvent[]> {
  const controller = new AbortController();
  const headers = new Headers(input.headers);
  headers.set("accept", "text/event-stream");
  if (input.lastEventId) {
    headers.set("Last-Event-ID", input.lastEventId);
  }
  const timeoutMs = input.timeoutMs ?? 2_000;
  const deadlineError = new Error(`timed out after ${timeoutMs}ms waiting for ${input.type}`);
  const deadlineTimer = setTimeout(() => controller.abort(deadlineError), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SseHttpError(response.status, await response.text());
    }
    if (!response.body) {
      throw new Error(`SSE request returned HTTP ${response.status} without a body`);
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    while (true) {
      const chunk = await reader.read();
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
    throw new Error(`SSE stream ended before ${input.type}; received ${body}`);
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === deadlineError) {
      throw deadlineError;
    }
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }
}

describe("SSE reader deadline cleanup", () => {
  it("times out while the initial fetch is pending and clears its deadline", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: FetchImplementation = (_input, init) => {
      const signal = init?.signal;
      if (!signal) {
        return Promise.reject(new Error("missing abort signal"));
      }
      requestSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };

    const result = readUntilEvent({
      url: "http://127.0.0.1/pending",
      type: "project.created",
      timeoutMs: 50,
      fetchImpl,
    });
    const rejection = expect(result).rejects.toThrow(
      "timed out after 50ms waiting for project.created",
    );
    await vi.advanceTimersByTimeAsync(50);
    await rejection;

    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the reader and clears its deadline when streaming times out", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: FetchImplementation = async (_input, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error("missing abort signal");
      }
      requestSignal = signal;
      const reader = {
        read: () =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        cancel,
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;
      return {
        ok: true,
        status: 200,
        body: { getReader: () => reader },
      } as unknown as Response;
    };

    const result = readUntilEvent({
      url: "http://127.0.0.1/stalled-stream",
      type: "project.planning_started",
      timeoutMs: 75,
      fetchImpl,
    });
    const rejection = expect(result).rejects.toThrow(
      "timed out after 75ms waiting for project.planning_started",
    );
    await vi.advanceTimersByTimeAsync(75);
    await rejection;

    expect(requestSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the reader and clears its deadline after receiving the target event", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    let requestSignal: AbortSignal | undefined;
    const frame = 'id: opaque\nevent: project.created\ndata: {"type":"project.created"}\n\n';
    const fetchImpl: FetchImplementation = async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      const reader = {
        read: vi.fn(async () => ({ done: false, value: new TextEncoder().encode(frame) })),
        cancel,
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;
      return {
        ok: true,
        status: 200,
        body: { getReader: () => reader },
      } as unknown as Response;
    };

    await expect(
      readUntilEvent({
        url: "http://127.0.0.1/ready-stream",
        type: "project.created",
        timeoutMs: 100,
        fetchImpl,
      }),
    ).resolves.toMatchObject([{ cursor: "opaque", type: "project.created" }]);

    expect(requestSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up its deadline and signal for a non-2xx response", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: FetchImplementation = async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ code: "event_cursor_expired" }), {
        status: 410,
      });
    };

    await expect(
      readUntilEvent({
        url: "http://127.0.0.1/expired",
        type: "project.created",
        timeoutMs: 100,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 410,
      responseText: expect.stringContaining("event_cursor_expired"),
    });

    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("event stream recovery through the production Daemon", () => {
  it("resumes strictly after Last-Event-ID and rejects that cursor under another filter", async () => {
    const { client, daemon } = await harnesses.start({
      testId: "t16-events",
      completeAfterMs: 5,
    });
    const project = await client.createProject(
      { name: "Cursor recovery", objective: "resume without duplicate delivery" },
      { idempotencyKey: "create-project", operationId: "op_create_project" },
    );
    const streamPath = client.eventsStreamPath({ projectId: project.id });
    const headers = { authorization: `Bearer ${daemon.sessionToken}` };

    const initial = await readUntilEvent({
      url: `http://127.0.0.1:${daemon.port}${streamPath}`,
      type: "project.created",
      headers,
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
      url: `http://127.0.0.1:${daemon.port}${streamPath}`,
      type: "project.planning_started",
      headers,
      lastEventId: createdEvent.cursor,
    });
    expect(resumed.map((event) => event.type)).toContain("project.planning_started");
    expect(resumed.map((event) => event.type)).not.toContain("project.created");
    expect(resumed.every((event) => event.cursor !== createdEvent.cursor)).toBe(true);

    const otherProject = await client.createProject(
      { name: "Different filter", objective: "must not reuse another subscription cursor" },
      { idempotencyKey: "create-other", operationId: "op_create_other" },
    );
    await expect(
      readUntilEvent({
        url: `http://127.0.0.1:${daemon.port}${client.eventsStreamPath({ projectId: otherProject.id })}`,
        type: "project.created",
        headers,
        lastEventId: createdEvent.cursor,
      }),
    ).rejects.toMatchObject({
      status: 410,
      responseText: expect.stringContaining("event_cursor_expired"),
    });
  });
});
