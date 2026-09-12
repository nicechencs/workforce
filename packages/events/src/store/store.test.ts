import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import type { WorkforceEvent } from "@workforce/protocol";

import { recordInbox } from "../outbox/index.js";
import {
  EVENT_STORE_TABLES_SQL,
  SqliteEventStore,
  attachSqliteSession,
  highWaterMark,
  type StoreTx,
} from "./index.js";

/**
 * Event store tests for T04.
 * Platform: Windows + Node 24. macOS / Linux: untested.
 */
describe("SqliteEventStore", () => {
  it("assigns a global ingestionPosition separate from per-stream sequence", async () => {
    const db = openEvents();
    const store = new SqliteEventStore(db);
    await inTx(db, async (tx) => {
      const first = await store.append(
        tx,
        sample({ id: "evt_a", stream: "task:one", sequence: 1 }),
      );
      const second = await store.append(
        tx,
        sample({ id: "evt_b", stream: "task:two", sequence: 1 }),
      );
      expect(first.ingestionPosition).toBe(1);
      expect(second.ingestionPosition).toBe(2);
    });
    const events = await store.read({ limit: 10 });
    expect(events.map((event) => [event.stream, event.sequence, event.ingestionPosition])).toEqual([
      ["task:one", 1, 1],
      ["task:two", 1, 2],
    ]);
    expect(highWaterMark(db)).toBe(2);
    db.close();
  });

  it("writes Event and Outbox in the same transaction and rolls both back", async () => {
    const db = openEvents();
    const store = new SqliteEventStore(db);
    await expect(
      inTx(db, async (tx) => {
        await store.append(tx, sample({ id: "evt_r", stream: "run:1" }));
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(await store.read({ limit: 10 })).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM outbox_messages").get()?.n).toBe(0);
    db.close();
  });

  it("dedups inbox receipts", async () => {
    const db = openEvents();
    const first = await inTx(db, async (tx) =>
      recordInbox(tx, "sse", "evt_1", "2026-09-10T10:00:00.000Z"),
    );
    const second = await inTx(db, async (tx) =>
      recordInbox(tx, "sse", "evt_1", "2026-09-10T10:00:01.000Z"),
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
    db.close();
  });
});

function openEvents(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(EVENT_STORE_TABLES_SQL);
  return db;
}

async function inTx<T>(db: DatabaseSync, fn: (tx: StoreTx) => Promise<T>): Promise<T> {
  db.exec("BEGIN IMMEDIATE");
  const tx: StoreTx = { kind: "tx" };
  attachSqliteSession(tx, db);
  try {
    const result = await fn(tx);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Node 22 DatabaseSync may not expose isTransaction; ROLLBACK is idle-safe.
    }
    throw error;
  }
}

function sample(input: { id: string; stream: string; sequence?: number }): WorkforceEvent {
  const event: WorkforceEvent = {
    specVersion: "0.1",
    id: input.id,
    type: "run.created",
    source: "workforce.events.test",
    subject: { type: "run", id: input.id },
    time: "2026-09-10T10:00:00.000Z",
    recordedAt: "2026-09-10T10:00:00.100Z",
    actor: { type: "service", id: "events-test" },
    stream: input.stream,
    correlationId: "op_test",
    dataContentType: "application/json",
    dataSchema: "urn:workforce:event:run.created:0.1",
    data: {},
    sensitivity: "internal",
  };
  if (input.sequence !== undefined) {
    return { ...event, sequence: input.sequence };
  }
  return event;
}
