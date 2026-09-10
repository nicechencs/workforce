import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  EVENT_STORE_TABLES_SQL,
  SqliteEventStore,
  attachSqliteSession,
  type StoreTx,
} from "../store/index.js";
import {
  EventCursorExpired,
  SqliteSubscriptionReader,
  decodeSubscriptionCursor,
  encodeSubscriptionCursor,
} from "./index.js";

describe("subscriptions", () => {
  it("binds Last-Event-ID to ingestionPosition and the filter digest", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(EVENT_STORE_TABLES_SQL);
    const store = new SqliteEventStore(db);
    await inTx(db, async (tx) => {
      await store.append(tx, event("evt_1", "prj_a", "task.ready"));
      await store.append(tx, event("evt_2", "prj_b", "task.ready"));
      await store.append(tx, event("evt_3", "prj_a", "task.completed"));
    });

    const query = { projectId: "prj_a", types: ["task.completed"], limit: 10 };
    const reader = new SqliteSubscriptionReader(db);
    expect(reader.highWaterMark()).toBe(3);

    const cursor = encodeSubscriptionCursor(1, query);
    const page = await reader.readAfterCursor(cursor, query);
    expect(page.map((item) => item.id)).toEqual(["evt_3"]);

    expect(() => decodeSubscriptionCursor(cursor, { projectId: "prj_b", limit: 10 })).toThrow(
      EventCursorExpired,
    );
    expect(() => decodeSubscriptionCursor("not-a-cursor", query)).toThrow(EventCursorExpired);
    db.close();
  });
});

async function inTx<T>(db: DatabaseSync, fn: (tx: StoreTx) => Promise<T>): Promise<T> {
  db.exec("BEGIN IMMEDIATE");
  const tx: StoreTx = { kind: "tx" };
  attachSqliteSession(tx, db);
  try {
    const result = await fn(tx);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

function event(id: string, projectId: string, type: string) {
  return {
    specVersion: "0.1" as const,
    id,
    type,
    source: "test",
    subject: { type: "task", id },
    time: "2026-09-10T10:00:00.000Z",
    recordedAt: "2026-09-10T10:00:00.100Z",
    projectId,
    actor: { type: "service" as const, id: "test" },
    stream: `project:${projectId}`,
    correlationId: "op",
    dataContentType: "application/json" as const,
    dataSchema: `urn:workforce:event:${type}:0.1`,
    data: {},
    sensitivity: "internal" as const,
  };
}
