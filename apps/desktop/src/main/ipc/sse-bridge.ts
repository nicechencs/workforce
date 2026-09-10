import { buildLoopbackUrl, type SessionSecrets } from "./rest-proxy.js";
import type { LiveSubscription } from "./subscriptions.js";

export interface SseMessage {
  id?: string;
  event?: string;
  data: string;
}

export interface SseTarget {
  port: number;
  session: SessionSecrets;
}

export interface DaemonSseBridge {
  start(subscription: LiveSubscription): Promise<void>;
  stop(): void;
}

export function eventsStreamPath(input: { cursor: string; types: string[] }): string {
  const params = new URLSearchParams();
  if (input.cursor.length > 0) {
    params.set("cursor", input.cursor);
  }
  if (input.types.length > 0) {
    params.set("types", input.types.join(","));
  }
  const query = params.toString();
  return query.length > 0 ? `/api/v1/events/stream?${query}` : "/api/v1/events/stream";
}

export function parseSseBlock(block: string): SseMessage | null {
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const message: SseMessage = { data: dataLines.join("\n") };
  if (id !== undefined) {
    message.id = id;
  }
  if (event !== undefined) {
    message.event = event;
  }
  return message;
}

export function appendSseChunk(
  buffer: string,
  chunk: string,
): { buffer: string; events: SseMessage[] } {
  const combined = `${buffer}${chunk}`.replace(/\r\n/g, "\n");
  const parts = combined.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseMessage[] = [];
  for (const block of parts) {
    const parsed = parseSseBlock(block);
    if (parsed) {
      events.push(parsed);
    }
  }
  return { buffer: rest, events };
}

export function decodeSsePayload(message: SseMessage): unknown {
  try {
    return JSON.parse(message.data) as unknown;
  } catch {
    return { id: message.id, event: message.event, raw: message.data };
  }
}

export function createDaemonSseBridge(input: {
  getTarget(): SseTarget | null;
  send(payload: unknown): void;
  fetchImpl?: typeof fetch;
}): DaemonSseBridge {
  const fetchImpl = input.fetchImpl ?? fetch;
  let abort: AbortController | null = null;
  let activeKey: string | null = null;

  const stop = (): void => {
    abort?.abort();
    abort = null;
    activeKey = null;
  };

  return {
    async start(subscription: LiveSubscription): Promise<void> {
      if (activeKey === subscription.key && abort && !abort.signal.aborted) {
        return;
      }
      stop();
      const target = input.getTarget();
      if (!target) {
        return;
      }
      const controller = new AbortController();
      abort = controller;
      activeKey = subscription.key;
      const headers: Record<string, string> = {
        accept: "text/event-stream",
        authorization: `Bearer ${target.session.sessionToken}`,
      };
      if (subscription.cursor.length > 0) {
        headers["last-event-id"] = subscription.cursor;
      }
      const res = await fetchImpl(buildLoopbackUrl(target.port, eventsStreamPath(subscription)), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        if (!controller.signal.aborted) {
          stop();
        }
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const next = appendSseChunk(buffer, decoder.decode(value, { stream: true }));
          buffer = next.buffer;
          for (const message of next.events) {
            input.send(decodeSsePayload(message));
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
    },
    stop,
  };
}
