import type { DatabaseSync } from "node:sqlite";

import type { EventStore, Tx } from "@workforce/application";

import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, parseJson, requiredInt } from "./sql.js";

type StoredEvent = Parameters<EventStore["append"]>[1];

const OUTBOX_TOPIC = "workforce.event";

export class SqliteEventStore implements EventStore {
  constructor(private readonly db: DatabaseSync) {}

  async append(tx: Tx, event: StoredEvent): Promise<{ ingestionPosition: number }> {
    const db = sqliteDbOf(tx);
    const sequence = event.sequence ?? nextStreamSequence(db, event.stream);
    const envelope = { ...event, sequence };
    const recordedAt = event.recordedAt;
    const result = db
      .prepare(
        `INSERT INTO events (
           id, organization_id, project_id, workflow_instance_id, task_id, run_id,
           stream, sequence, event_type, envelope_json, occurred_at, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.organizationId ?? null,
        event.projectId ?? null,
        event.workflowInstanceId ?? null,
        event.taskId ?? null,
        event.runId ?? null,
        event.stream,
        sequence,
        event.type,
        asJsonText(envelope),
        event.time,
        recordedAt,
      );

    const ingestionPosition = Number(result.lastInsertRowid);
    const stored = { ...envelope, ingestionPosition };
    db.prepare("UPDATE events SET envelope_json = ? WHERE ingestion_position = ?").run(
      asJsonText(stored),
      ingestionPosition,
    );
    db.prepare(
      `INSERT INTO outbox_messages (
         id, event_id, topic, payload_json, available_at, attempts
       ) VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(event.id, event.id, OUTBOX_TOPIC, asJsonText(stored), recordedAt);

    return { ingestionPosition };
  }

  async read(query: {
    stream?: string;
    afterIngestionPosition?: number;
    types?: string[];
    projectId?: string;
    limit: number;
  }): Promise<StoredEvent[]> {
    const clauses = ["ingestion_position > ?"];
    const params: Array<string | number> = [query.afterIngestionPosition ?? 0];

    if (query.stream !== undefined) {
      clauses.push("stream = ?");
      params.push(query.stream);
    }
    if (query.projectId !== undefined) {
      clauses.push("project_id = ?");
      params.push(query.projectId);
    }
    if (query.types !== undefined && query.types.length > 0) {
      clauses.push(`event_type IN (${query.types.map(() => "?").join(", ")})`);
      params.push(...query.types);
    }

    params.push(query.limit);
    const sql = `SELECT envelope_json, ingestion_position, sequence
                 FROM events
                 WHERE ${clauses.join(" AND ")}
                 ORDER BY ingestion_position ASC
                 LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params);
    return rows.map((row) => {
      const envelope = parseJson(cell(row, "envelope_json"), "envelope_json") as StoredEvent;
      return {
        ...envelope,
        sequence: requiredInt(cell(row, "sequence"), "sequence"),
        ingestionPosition: requiredInt(cell(row, "ingestion_position"), "ingestion_position"),
      };
    });
  }
}

export function nextStreamSequence(db: DatabaseSync, stream: string): number {
  const row = db
    .prepare("SELECT MAX(sequence) AS max_seq FROM events WHERE stream = ?")
    .get(stream);
  if (!row || row.max_seq === null || row.max_seq === undefined) {
    return 1;
  }
  return requiredInt(cell(row, "max_seq"), "max_seq") + 1;
}

export function highWaterMark(db: DatabaseSync): number {
  const row = db.prepare("SELECT COALESCE(MAX(ingestion_position), 0) AS hw FROM events").get();
  if (!row) {
    return 0;
  }
  return requiredInt(cell(row, "hw"), "hw");
}

export function unpublishedOutboxCount(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM outbox_messages WHERE published_at IS NULL")
    .get();
  if (!row) {
    return 0;
  }
  return requiredInt(cell(row, "n"), "n");
}

export function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}
