import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";

import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, parseJson, requiredText } from "./sql.js";

export interface TimerRecord {
  id: string;
  scopeType: string;
  scopeId: string;
  kind: string;
  fireAt: string;
  status: "scheduled" | "fired" | "cancelled";
  payload: unknown;
  createdAt: string;
}

export class SqliteTimerRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): TimerRecord | null {
    const row = this.db.prepare("SELECT * FROM timers WHERE id = ?").get(id);
    return row ? rowToTimer(row) : null;
  }

  dueAt(now: string): TimerRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM timers
          WHERE status = 'scheduled' AND fire_at <= ?
          ORDER BY fire_at ASC`,
      )
      .all(now)
      .map(rowToTimer);
  }

  put(tx: Tx, timer: TimerRecord): void {
    const db = sqliteDbOf(tx);
    db.prepare(
      `INSERT INTO timers (
         id, scope_type, scope_id, kind, fire_at, status, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      timer.id,
      timer.scopeType,
      timer.scopeId,
      timer.kind,
      timer.fireAt,
      timer.status,
      asJsonText(timer.payload),
      timer.createdAt,
    );
  }
}

function rowToTimer(row: Record<string, unknown>): TimerRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    scopeType: requiredText(cell(row, "scope_type"), "scope_type"),
    scopeId: requiredText(cell(row, "scope_id"), "scope_id"),
    kind: requiredText(cell(row, "kind"), "kind"),
    fireAt: requiredText(cell(row, "fire_at"), "fire_at"),
    status: requiredText(cell(row, "status"), "status") as TimerRecord["status"],
    payload: parseJson(cell(row, "payload_json"), "payload_json"),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
  };
}
