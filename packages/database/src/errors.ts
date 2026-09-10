export type PersistenceErrorCode =
  "revision_conflict" | "idempotency_key_reused" | "conflict" | "not_found" | "constraint";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export function sqliteErrcode(error: unknown): number | undefined {
  if (error !== null && typeof error === "object" && "errcode" in error) {
    const code = (error as { errcode: unknown }).errcode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

/** SQLITE_CONSTRAINT_UNIQUE */
export const SQLITE_CONSTRAINT_UNIQUE = 2067;
/** SQLITE_CONSTRAINT_PRIMARYKEY */
export const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
/** SQLITE_BUSY */
export const SQLITE_BUSY = 5;

export function isConstraintError(error: unknown): boolean {
  const code = sqliteErrcode(error);
  return code === SQLITE_CONSTRAINT_UNIQUE || code === SQLITE_CONSTRAINT_PRIMARYKEY;
}

export function mapWriteError(error: unknown, conflictMessage: string): never {
  if (isConstraintError(error)) {
    throw new PersistenceError("conflict", conflictMessage);
  }
  throw error;
}
