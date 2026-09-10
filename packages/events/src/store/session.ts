/** Must match `@workforce/database` SQLITE_SESSION. */
export const SQLITE_SESSION = Symbol.for("workforce.sqlite.session");

export interface SqliteQueryable {
  prepare(sql: string): {
    run(...params: Array<null | number | bigint | string>): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    get(...params: Array<null | number | bigint | string>): Record<string, unknown> | undefined;
    all(...params: Array<null | number | bigint | string>): Record<string, unknown>[];
  };
  exec(sql: string): void;
}

export interface StoreTx {
  readonly kind: "tx";
}

export function attachSqliteSession(tx: StoreTx, db: SqliteQueryable): void {
  Object.defineProperty(tx, SQLITE_SESSION, {
    value: db,
    enumerable: false,
    configurable: true,
  });
}

export function sqliteDbOf(tx: StoreTx): SqliteQueryable {
  const db = (tx as unknown as Record<symbol, SqliteQueryable | undefined>)[SQLITE_SESSION];
  if (!db) {
    throw new Error("Tx was not created by SqliteUnitOfWork");
  }
  return db;
}
