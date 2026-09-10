import { describe, expect, it } from "vitest";

import {
  appendSseChunk,
  createDaemonSseBridge,
  eventsStreamPath,
  parseSseBlock,
} from "../src/main/ipc/sse-bridge.js";
import { EventSubscriptionHub } from "../src/main/ipc/subscriptions.js";

describe("SSE bridge", () => {
  it("parses event-stream blocks and ignores heartbeats", () => {
    expect(parseSseBlock(": heartbeat")).toBeNull();
    expect(
      parseSseBlock('id: cur_1\nevent: run.status_changed\ndata: {"type":"run.status_changed"}'),
    ).toEqual({
      id: "cur_1",
      event: "run.status_changed",
      data: '{"type":"run.status_changed"}',
    });
    const chunked = appendSseChunk("", 'id: 1\ndata: {"ok":true}\n\n: heartbeat\n\n');
    expect(chunked.events).toEqual([{ data: '{"ok":true}', id: "1" }]);
  });

  it("reuses the hub key and does not open a second live stream", async () => {
    let fetches = 0;
    const hub = new EventSubscriptionHub();
    const bridge = createDaemonSseBridge({
      getTarget: () => ({ port: 3456, session: { sessionToken: "secret" } }),
      send: () => undefined,
      fetchImpl: async () => {
        fetches += 1;
        return new Promise<Response>(() => undefined);
      },
    });
    const first = hub.subscribe({ cursor: "10", types: ["run.status_changed"] });
    expect(first.created).toBe(true);
    void bridge.start(first.subscription);
    await Promise.resolve();
    const second = hub.subscribe({ cursor: "10", types: ["run.status_changed"] });
    expect(second.created).toBe(false);
    if (second.created) {
      void bridge.start(second.subscription);
    }
    expect(hub.size).toBe(1);
    expect(fetches).toBe(1);
    expect(eventsStreamPath(first.subscription)).toBe(
      "/api/v1/events/stream?cursor=10&types=run.status_changed",
    );
    bridge.stop();
  });
});
