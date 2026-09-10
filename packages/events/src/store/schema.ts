/** Event/outbox/inbox tables. Canonical DDL lives in `@workforce/database` migration 001. */
export const EVENT_STORE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS events (
  ingestion_position INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  organization_id TEXT,
  project_id TEXT,
  workflow_instance_id TEXT,
  task_id TEXT,
  run_id TEXT,
  stream TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL,
  envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (stream, sequence)
);

CREATE TABLE IF NOT EXISTS outbox_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  published_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS inbox_receipts (
  consumer TEXT NOT NULL,
  message_id TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (consumer, message_id)
);
`;
