import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  EVENT_STORE_TABLES_SQL,
  SqliteEventStore,
  attachSqliteSession,
  type StoreTx,
} from "../store/index.js";
import { claimOutbox, markFailed, markPublished } from "./index.js";

describe("outbox", () => {
  it("claims unpublished messages and records publish or retry", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(EVENT_STORE_TABLES_SQL);
    const store = new SqliteEventStore(db);

    await inTx(db, async (tx) => {
      await store.append(tx, {
        specVersion: "0.1",
        id: "evt_ob",
        type: "run.created",
        source: "test",
        subject: { type: "run", id: "run_1" },
        time: "2026-09-10T10:00:00.000Z",
        recordedAt: "2026-09-10T10:00:00.100Z",
        actor: { type: "service", id: "test" },
        stream: "run:run_1",
        correlationId: "op",
        dataContentType: "application/json",
        dataSchema: "urn:workforce:event:run.created:0.1",
        data: {},
        sensitivity: "internal",
      });
    });

    await inTx(db, async (tx) => {
      const claimed = claimOutbox(tx, { now: "2026-09-10T10:00:01.000Z", limit: 10 });
      expect(claimed).toHaveLength(1);
      markFailed(tx, claimed[0]!.id, "delivery failed", "2026-09-10T10:00:05.000Z");
    });

    await inTx(db, async (tx) => {
      const claimed = claimOutbox(tx, { now: "2026-09-10T10:00:06.000Z", limit: 10 });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.attempts).toBeGreaterThanOrEqual(1);
      markPublished(tx, claimed[0]!.id, "2026-09-10T10:00:07.000Z");
    });

    const unpublished = db
      .prepare("SELECT COUNT(*) AS n FROM outbox_messages WHERE published_at IS NULL")
      .get();
    expect(unpublished?.n).toBe(0);
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
