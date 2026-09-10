import { DatabaseSync } from "node:sqlite";

export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface OpenSqliteOptions {
  timeoutMs?: number;
}

export function openSqlite(path: string, options?: OpenSqliteOptions): DatabaseSync {
  const timeout = options?.timeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const db = new DatabaseSync(path, {
    timeout,
    enableForeignKeyConstraints: true,
  });
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  return db;
}
