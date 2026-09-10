import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backup } from "node:sqlite";
import type { DatabaseSync } from "node:sqlite";

import { assertNotInTransaction } from "./session.js";

/**
 * Snapshot a file-backed database using the SQLite backup API (includes WAL).
 * Must not run inside a write transaction.
 */
export async function backupDatabase(db: DatabaseSync, destinationPath: string): Promise<void> {
  assertNotInTransaction(db, "backup");
  mkdirSync(dirname(destinationPath), { recursive: true });
  await backup(db, destinationPath);
}

/** Last-resort file copy for a closed database. Caller must close first. */
export function copyDatabaseFile(sourcePath: string, destinationPath: string): void {
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}
