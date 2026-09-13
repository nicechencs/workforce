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
export { SqliteGrantStore } from "./grants.js";
export {
  SqliteHandleRepository,
  type RuntimeHandleByOperationRecord,
  type RuntimeHandleRecord,
} from "./handles.js";
export { appliedMigrations, checksumSql, migrate } from "./migrate.js";
export { SqliteBudgetRepository, SqliteReservationRepository } from "./budgets.js";
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
export {
  SqliteProjectExecutionSnapshotRepository,
  type ProjectExecutionSnapshotRecord,
} from "./execution-snapshots.js";
export {
  MIGRATIONS,
  MIGRATION_001_SQL,
  MIGRATION_002_SQL,
  MIGRATION_003_SQL,
  MIGRATION_004_SQL,
  MIGRATION_005_SQL,
  MIGRATION_006_SQL,
  MIGRATION_007_SQL,
  MIGRATION_008_SQL,
  MIGRATION_009_SQL,
  MIGRATION_010_SQL,
  MIGRATION_011_SQL,
  MIGRATION_012_SQL,
  MIGRATION_013_SQL,
  MIGRATION_014_SQL,
  MIGRATION_015_SQL,
} from "./schema.js";
export {
  EXECUTION_AXIS_MIGRATION_CLASSIFICATIONS,
  SqliteExecutionAxisMigrationRepository,
  type ExecutionAxisMigrationAuditOptions,
  type ExecutionAxisMigrationClassification,
  type ExecutionAxisMigrationEvidence,
  type ExecutionAxisMigrationItem,
} from "./execution-axis-migration.js";
export {
  applyExecutionAxisBackfill,
  LEGACY_PLACEMENT_SCHEMA_VERSION,
  EXECUTION_AXIS_BACKFILL_ACTIONS,
  type ExecutionAxisBackfillAction,
  type ExecutionAxisBackfillResult,
} from "./execution-axis-backfill.js";
export {
  PROJECTION_RECONCILIATION_CLASSIFICATIONS,
  SqliteProjectionReconciliationRepository,
  digestOf as projectionSourceDigest,
  entityAuthorityDigest,
  hasDurableEntities,
  planWorldProjectionRepair,
  type ProjectionReconciliationClassification,
  type ProjectionReconciliationItem,
  type ProjectionRepairPlan,
  type RecordProjectionReconciliationInput,
} from "./projection-reconciliation.js";
export { SqliteTeamCatalogRepository, SqliteWorkflowCatalogRepository } from "./catalog.js";
export { SqliteWorkerLibraryRepository } from "./workers.js";
export {
  SqliteAuthoringChatPatchRepository,
  SqliteAuthoringMessageRepository,
  SqliteAuthoringProposalRepository,
  SqliteAuthoringSessionRepository,
  SqliteAuthoringSourceRunRepository,
  SqliteAuthoringTurnRepository,
  type AuthoringChatPatchBinding,
  type AuthoringMessageRecord,
  type AuthoringProjectRecord,
  type AuthoringProposalRecord,
  type AuthoringProposalTargetInput,
  type AuthoringSessionRecord,
  type AuthoringSourceRunRecord,
  type AuthoringTurnRecord,
  type CompleteAuthoringTurnInput,
  type CreateAuthoringMessageInput,
  type CreateAuthoringProposalInput,
  type CreateAuthoringTurnInput,
} from "./chat-authoring.js";
export {
  SqliteAuthoringChangeSetRepository,
  SqliteTeamDraftRepository,
  SqliteWorkflowAuthoringScopeRepository,
  SqliteWorkflowDraftRepository,
  type AuthoringStepUpdate,
  type CreateWorkflowAuthoringScopeInput,
  type WorkflowAuthoringScopeExpectation,
  type WorkflowAuthoringScopeRecord,
} from "./authoring.js";
export { seedMinimalGraph, type SeededGraph } from "./seed.js";
export { SqliteTaskRepository } from "./tasks.js";
export { SqliteWorldSnapshot, type WorldEntitySnapshot, type WorldProjectionMeta } from "./world-snapshot.js";
export { SqliteWorkflowInstanceRepository } from "./workflows.js";
export { SQLITE_SESSION, SqliteTx, assertNotInTransaction, sqliteDbOf } from "./session.js";
export { startRunIdempotent, type StartRunCommand, type StartRunResult } from "./start-run.js";
export { STORAGE_MATRIX, type StorageLocation } from "./storage-matrix.js";
export { SqliteTimerRepository, type TimerRecord } from "./timers.js";
export { SqliteUnitOfWork } from "./uow.js";
