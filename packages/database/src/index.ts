export const packageName = "@workforce/database" as const;

export { backupDatabase, copyDatabaseFile } from "./backup.js";
export { DEFAULT_BUSY_TIMEOUT_MS, openSqlite } from "./connection.js";
export { WorkforceSqlite } from "./database.js";
export {
  PersistenceError,
  SQLITE_BUSY,
  SQLITE_CONSTRAINT_PRIMARYKEY,
  SQLITE_CONSTRAINT_UNIQUE,
  isConstraintError,
  sqliteErrcode,
  type PersistenceErrorCode,
} from "./errors.js";
export { SqliteEventStore, highWaterMark, unpublishedOutboxCount } from "./event-store.js";
export { SqliteHandleRepository, type RuntimeHandleRecord } from "./handles.js";
export { appliedMigrations, checksumSql, migrate } from "./migrate.js";
export { SqliteProjectRepository } from "./projects.js";
export {
  SqliteApprovalRepository,
  SqliteArtifactBindingRepository,
  SqliteInbox,
  SqliteNodeInstanceRepository,
  SqliteResourceRepository,
  SqliteUsageRepository,
} from "./records.js";
export { SqliteCommandReceiptRepository } from "./receipts.js";
export {
  ACTIVE_RUN_STATUSES,
  SqliteRunRepository,
  type RunRecord,
  type StartRunInput,
} from "./runs.js";
export { MIGRATIONS, MIGRATION_001_SQL, MIGRATION_002_SQL } from "./schema.js";
export { seedMinimalGraph, type SeededGraph } from "./seed.js";
export { SqliteTaskRepository } from "./tasks.js";
export { SqliteWorldSnapshot, type WorldEntitySnapshot } from "./world-snapshot.js";
export { SqliteWorkflowInstanceRepository } from "./workflows.js";
export { SQLITE_SESSION, SqliteTx, assertNotInTransaction, sqliteDbOf } from "./session.js";
export { startRunIdempotent, type StartRunCommand, type StartRunResult } from "./start-run.js";
export { STORAGE_MATRIX, type StorageLocation } from "./storage-matrix.js";
export { SqliteTimerRepository, type TimerRecord } from "./timers.js";
export { SqliteUnitOfWork } from "./uow.js";
