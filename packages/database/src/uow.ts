import type { DatabaseSync } from "node:sqlite";

import type { Tx, UnitOfWork } from "@workforce/application";

import { SqliteTx } from "./session.js";

/**
 * SQLite unit of work.
 *
 * BEGIN IMMEDIATE → work → COMMIT. Any thrown error ROLLBACKs the whole
 * transaction (SQLite statement abort is not transaction abort).
 *
 * Do not spawn processes, write Git, or touch external files inside `fn`.
 * Hold the write lock only for state + Event + Outbox rows.
 */
export class SqliteUnitOfWork implements UnitOfWork {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DatabaseSync) {}

  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = this.writeChain.then(
      () => this.execute(fn),
      () => this.execute(fn),
    );
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async execute<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (this.db.isTransaction === true) {
      throw new Error("nested database transactions are not supported");
    }
    this.db.exec("BEGIN IMMEDIATE");
    const tx = new SqliteTx(this.db);
    try {
      const result = await fn(tx);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Node 22.14 DatabaseSync has no isTransaction; ROLLBACK is harmless if idle.
      }
      throw error;
    }
  }
}
