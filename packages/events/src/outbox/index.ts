import { sqliteDbOf, type StoreTx } from "../store/session.js";

export interface OutboxEnqueue {
  id: string;
  eventId: string;
  topic: string;
  payload: unknown;
  availableAt: string;
}

export interface OutboxMessage {
  id: string;
  eventId: string;
  topic: string;
  payloadJson: string;
  availableAt: string;
  attempts: number;
  claimedAt: string | null;
  publishedAt: string | null;
  lastError: string | null;
}

export function enqueueOutbox(tx: StoreTx, message: OutboxEnqueue): void {
  sqliteDbOf(tx)
    .prepare(
      `INSERT INTO outbox_messages (
         id, event_id, topic, payload_json, available_at, attempts
       ) VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(
      message.id,
      message.eventId,
      message.topic,
      JSON.stringify(message.payload),
      message.availableAt,
    );
}

export function claimOutbox(tx: StoreTx, input: { now: string; limit: number }): OutboxMessage[] {
  const db = sqliteDbOf(tx);
  const rows = db
    .prepare(
      `SELECT id, event_id, topic, payload_json, available_at, attempts, claimed_at, published_at, last_error
         FROM outbox_messages
        WHERE published_at IS NULL AND available_at <= ?
        ORDER BY available_at ASC
        LIMIT ?`,
    )
    .all(input.now, input.limit);
  const claimed: OutboxMessage[] = [];
  for (const row of rows) {
    const id = String(row.id);
    db.prepare(
      `UPDATE outbox_messages
          SET claimed_at = ?, attempts = attempts + 1
        WHERE id = ? AND published_at IS NULL`,
    ).run(input.now, id);
    claimed.push(rowToOutbox(row));
  }
  return claimed;
}

export function markPublished(tx: StoreTx, id: string, publishedAt: string): void {
  sqliteDbOf(tx)
    .prepare("UPDATE outbox_messages SET published_at = ?, last_error = NULL WHERE id = ?")
    .run(publishedAt, id);
}

export function markFailed(tx: StoreTx, id: string, error: string, nextAvailableAt: string): void {
  sqliteDbOf(tx)
    .prepare(
      `UPDATE outbox_messages
          SET last_error = ?, available_at = ?, claimed_at = NULL
        WHERE id = ?`,
    )
    .run(error, nextAvailableAt, id);
}

export function recordInbox(
  tx: StoreTx,
  consumer: string,
  messageId: string,
  processedAt: string,
): boolean {
  const result = sqliteDbOf(tx)
    .prepare(
      `INSERT OR IGNORE INTO inbox_receipts (consumer, message_id, processed_at)
       VALUES (?, ?, ?)`,
    )
    .run(consumer, messageId, processedAt);
  return Number(result.changes) === 1;
}

function rowToOutbox(row: Record<string, unknown>): OutboxMessage {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    topic: String(row.topic),
    payloadJson: String(row.payload_json),
    availableAt: String(row.available_at),
    attempts: Number(row.attempts),
    claimedAt:
      row.claimed_at === null || row.claimed_at === undefined ? null : String(row.claimed_at),
    publishedAt:
      row.published_at === null || row.published_at === undefined ? null : String(row.published_at),
    lastError:
      row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
  };
}
