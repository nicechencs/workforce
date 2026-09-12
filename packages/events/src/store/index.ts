import type { WorkforceEvent } from "@workforce/protocol";

import { enqueueOutbox } from "../outbox/index.js";
import { sqliteDbOf, type SqliteQueryable, type StoreTx } from "./session.js";

export { EVENT_STORE_TABLES_SQL } from "./schema.js";
export {
  SQLITE_SESSION,
  attachSqliteSession,
  sqliteDbOf,
  type SqliteQueryable,
  type StoreTx,
} from "./session.js";

export interface EventReadQuery {
  stream?: string;
  afterIngestionPosition?: number;
  types?: string[];
  projectId?: string;
  runId?: string;
  limit: number;
}

/**
 * SQLite Event Store. Stream `sequence` is per-stream; `ingestionPosition` is
 * the database-monotonic SSE cursor and is assigned here, never by the producer.
 */
export class SqliteEventStore {
  constructor(private readonly db: SqliteQueryable) {}

  async append(tx: StoreTx, event: WorkforceEvent): Promise<{ ingestionPosition: number }> {
    const db = sqliteDbOf(tx);
    const sequence = event.sequence ?? nextStreamSequence(db, event.stream);
    const envelope: WorkforceEvent = { ...event, sequence };
    const insert = db
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
        JSON.stringify(envelope),
        event.time,
        event.recordedAt,
      );
    const ingestionPosition = Number(insert.lastInsertRowid);
    const stored: WorkforceEvent = { ...envelope, ingestionPosition };
    db.prepare("UPDATE events SET envelope_json = ? WHERE ingestion_position = ?").run(
      JSON.stringify(stored),
      ingestionPosition,
    );
    enqueueOutbox(tx, {
      id: event.id,
      eventId: event.id,
      topic: "workforce.event",
      payload: stored,
      availableAt: event.recordedAt,
    });
    return { ingestionPosition };
  }

  async read(query: EventReadQuery): Promise<WorkforceEvent[]> {
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
    if (query.runId !== undefined) {
      clauses.push("run_id = ?");
      params.push(query.runId);
    }
    if (query.types !== undefined && query.types.length > 0) {
      clauses.push(`event_type IN (${query.types.map(() => "?").join(", ")})`);
      params.push(...query.types);
    }
    params.push(query.limit);
    const rows = this.db
      .prepare(
        `SELECT envelope_json, ingestion_position, sequence
           FROM events
          WHERE ${clauses.join(" AND ")}
          ORDER BY ingestion_position ASC
          LIMIT ?`,
      )
      .all(...params);
    return rows.map((row) => {
      const envelope = JSON.parse(String(row.envelope_json)) as WorkforceEvent;
      return {
        ...envelope,
        sequence: Number(row.sequence),
        ingestionPosition: Number(row.ingestion_position),
      };
    });
  }
}

export function nextStreamSequence(db: SqliteQueryable, stream: string): number {
  const row = db
    .prepare("SELECT MAX(sequence) AS max_seq FROM events WHERE stream = ?")
    .get(stream);
  if (!row || row.max_seq === null || row.max_seq === undefined) {
    return 1;
  }
  return Number(row.max_seq) + 1;
}

export function highWaterMark(db: SqliteQueryable): number {
  const row = db.prepare("SELECT COALESCE(MAX(ingestion_position), 0) AS hw FROM events").get();
  return row ? Number(row.hw) : 0;
}

/**
 * Last ingestion position that is no longer retained.
 * Derived from the durable events table (and sqlite_sequence after a full trim)
 * so expiry survives Daemon restart. Catch-up only; never used to replay effects.
 */
export function trimHorizon(db: SqliteQueryable): number {
  const minRow = db.prepare("SELECT MIN(ingestion_position) AS min_pos FROM events").get();
  const minPos = minRow?.min_pos;
  if (minPos !== null && minPos !== undefined) {
    return Math.max(0, Number(minPos) - 1);
  }
  const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get("events");
  if (!seqRow || seqRow.seq === null || seqRow.seq === undefined) {
    return 0;
  }
  return Number(seqRow.seq);
}
