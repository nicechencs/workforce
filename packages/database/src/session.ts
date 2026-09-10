import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";

/** Shared with `@workforce/events/store` so Event/Outbox can join a database Tx. */
export const SQLITE_SESSION = Symbol.for("workforce.sqlite.session");

export class SqliteTx implements Tx {
  readonly kind = "tx" as const;

  constructor(readonly db: DatabaseSync) {
    Object.defineProperty(this, SQLITE_SESSION, {
      value: db,
      enumerable: false,
    });
  }
}

export function sqliteDbOf(tx: Tx): DatabaseSync {
  const db = (tx as unknown as Record<symbol, DatabaseSync | undefined>)[SQLITE_SESSION];
  if (!db) {
    throw new Error("Tx was not created by SqliteUnitOfWork");
  }
  return db;
}

export function assertNotInTransaction(db: DatabaseSync, action: string): void {
  if (db.isTransaction) {
    throw new Error(`${action} must not run inside a database transaction`);
  }
}
