import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";

import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, optionalInt, parseJson, requiredText } from "./sql.js";

export interface RuntimeHandleRecord {
  runId: string;
  pid: number | null;
  startIdentity: string;
  handle: unknown;
  recordedAt: string;
}

export class SqliteHandleRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(runId: string): RuntimeHandleRecord | null {
    const row = this.db
      .prepare(
        `SELECT run_id, pid, start_identity, handle_json, recorded_at
           FROM runtime_handles WHERE run_id = ?`,
      )
      .get(runId);
    if (!row) {
      return null;
    }
    return {
      runId: requiredText(cell(row, "run_id"), "run_id"),
      pid: optionalInt(cell(row, "pid")),
      startIdentity: requiredText(cell(row, "start_identity"), "start_identity"),
      handle: parseJson(cell(row, "handle_json"), "handle_json"),
      recordedAt: requiredText(cell(row, "recorded_at"), "recorded_at"),
    };
  }

  put(tx: Tx, record: RuntimeHandleRecord): void {
    const db = sqliteDbOf(tx);
    db.prepare(
      `INSERT INTO runtime_handles (run_id, pid, start_identity, handle_json, recorded_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         pid = excluded.pid,
         start_identity = excluded.start_identity,
         handle_json = excluded.handle_json,
         recorded_at = excluded.recorded_at`,
    ).run(
      record.runId,
      record.pid,
      record.startIdentity,
      asJsonText(record.handle),
      record.recordedAt,
    );
  }
}
