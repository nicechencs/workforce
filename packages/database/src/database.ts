import type { DatabaseSync } from "node:sqlite";

import { backupDatabase } from "./backup.js";
import { SqliteBudgetRepository, SqliteReservationRepository } from "./budgets.js";
import { SqliteGrantStore } from "./grants.js";
import { openSqlite, type OpenSqliteOptions } from "./connection.js";
import { SqliteEventStore } from "./event-store.js";
import { SqliteHandleRepository } from "./handles.js";
import { migrate } from "./migrate.js";
import { SqliteProjectRepository } from "./projects.js";
import {
  SqliteApprovalRepository,
  SqliteArtifactBindingRepository,
  SqliteInbox,
  SqliteNodeInstanceRepository,
  SqliteResourceRepository,
  SqliteUsageRepository,
} from "./records.js";
import { SqliteCommandReceiptRepository } from "./receipts.js";
import { SqliteRunRepository } from "./runs.js";
import { seedMinimalGraph, type SeededGraph } from "./seed.js";
import { SqliteTaskRepository } from "./tasks.js";
import { SqliteTimerRepository } from "./timers.js";
import { SqliteUnitOfWork } from "./uow.js";
import { SqliteWorkflowInstanceRepository } from "./workflows.js";
import { SqliteTeamCatalogRepository, SqliteWorkflowCatalogRepository } from "./catalog.js";
import { SqliteWorkerLibraryRepository } from "./workers.js";
import { SqliteWorldSnapshot } from "./world-snapshot.js";
import { SqliteExecutionAxisMigrationRepository } from "./execution-axis-migration.js";
import { SqliteProjectionReconciliationRepository } from "./projection-reconciliation.js";
import {
  SqliteAuthoringChangeSetRepository,
  SqliteTeamDraftRepository,
  SqliteWorkflowAuthoringScopeRepository,
  SqliteWorkflowDraftRepository,
} from "./authoring.js";
import {
  SqliteAuthoringChatPatchRepository,
  SqliteAuthoringMessageRepository,
  SqliteAuthoringProposalRepository,
  SqliteAuthoringSessionRepository,
  SqliteAuthoringSourceRunRepository,
  SqliteAuthoringTurnRepository,
} from "./chat-authoring.js";

export interface OpenWorkforceDbOptions extends OpenSqliteOptions {
  migrate?: boolean;
}

export class WorkforceSqlite {
  readonly uow: SqliteUnitOfWork;
  readonly events: SqliteEventStore;
  readonly receipts: SqliteCommandReceiptRepository;
  readonly projects: SqliteProjectRepository;
  readonly tasks: SqliteTaskRepository;
  readonly workflows: SqliteWorkflowInstanceRepository;
  readonly worldSnapshot: SqliteWorldSnapshot;
  readonly runs: SqliteRunRepository;
  readonly handles: SqliteHandleRepository;
  readonly timers: SqliteTimerRepository;
  readonly nodeInstances: SqliteNodeInstanceRepository;
  readonly approvals: SqliteApprovalRepository;
  readonly artifacts: SqliteArtifactBindingRepository;
  readonly usage: SqliteUsageRepository;
  readonly budgets: SqliteBudgetRepository;
  readonly reservations: SqliteReservationRepository;
  readonly resources: SqliteResourceRepository;
  readonly inbox: SqliteInbox;
  readonly grants: SqliteGrantStore;
  readonly catalogWorkflows: SqliteWorkflowCatalogRepository;
  readonly catalogTeams: SqliteTeamCatalogRepository;
  readonly workers: SqliteWorkerLibraryRepository;
  readonly executionAxisMigration: SqliteExecutionAxisMigrationRepository;
  readonly projectionReconciliation: SqliteProjectionReconciliationRepository;
  readonly workflowDrafts: SqliteWorkflowDraftRepository;
  readonly teamDrafts: SqliteTeamDraftRepository;
  readonly workflowAuthoringScopes: SqliteWorkflowAuthoringScopeRepository;
  readonly authoringChangeSets: SqliteAuthoringChangeSetRepository;
  readonly authoringSessions: SqliteAuthoringSessionRepository;
  readonly authoringMessages: SqliteAuthoringMessageRepository;
  readonly authoringTurns: SqliteAuthoringTurnRepository;
  readonly authoringProposals: SqliteAuthoringProposalRepository;
  readonly authoringPatches: SqliteAuthoringChatPatchRepository;
  readonly authoringSourceRuns: SqliteAuthoringSourceRunRepository;

  private constructor(
    readonly path: string,
    readonly connection: DatabaseSync,
  ) {
    this.uow = new SqliteUnitOfWork(connection);
    this.events = new SqliteEventStore(connection);
    this.receipts = new SqliteCommandReceiptRepository(connection);
    this.projects = new SqliteProjectRepository(connection);
    this.tasks = new SqliteTaskRepository(connection);
    this.workflows = new SqliteWorkflowInstanceRepository(connection);
    this.worldSnapshot = new SqliteWorldSnapshot(connection);
    this.runs = new SqliteRunRepository(connection);
    this.handles = new SqliteHandleRepository(connection);
    this.timers = new SqliteTimerRepository(connection);
    this.nodeInstances = new SqliteNodeInstanceRepository(connection);
    this.approvals = new SqliteApprovalRepository(connection);
    this.artifacts = new SqliteArtifactBindingRepository(connection);
    this.usage = new SqliteUsageRepository(connection);
    this.budgets = new SqliteBudgetRepository(connection);
    this.reservations = new SqliteReservationRepository(connection);
    this.resources = new SqliteResourceRepository(connection);
    this.inbox = new SqliteInbox(connection);
    this.grants = new SqliteGrantStore(connection, this.uow);
    this.catalogWorkflows = new SqliteWorkflowCatalogRepository(connection);
    this.catalogTeams = new SqliteTeamCatalogRepository(connection);
    this.workers = new SqliteWorkerLibraryRepository(connection);
    this.executionAxisMigration = new SqliteExecutionAxisMigrationRepository(connection);
    this.projectionReconciliation = new SqliteProjectionReconciliationRepository(connection);
    this.workflowAuthoringScopes = new SqliteWorkflowAuthoringScopeRepository(connection);
    this.workflowDrafts = new SqliteWorkflowDraftRepository(
      connection,
      this.workflowAuthoringScopes,
    );
    this.teamDrafts = new SqliteTeamDraftRepository(connection);
    this.authoringChangeSets = new SqliteAuthoringChangeSetRepository(connection);
    this.authoringSessions = new SqliteAuthoringSessionRepository(connection);
    this.authoringMessages = new SqliteAuthoringMessageRepository(connection);
    this.authoringTurns = new SqliteAuthoringTurnRepository(connection, this.authoringSessions);
    this.authoringProposals = new SqliteAuthoringProposalRepository(
      connection,
      this.authoringSessions,
      this.authoringTurns,
    );
    this.authoringPatches = new SqliteAuthoringChatPatchRepository(this.authoringProposals);
    this.authoringSourceRuns = new SqliteAuthoringSourceRunRepository();
  }

  static open(path: string, options?: OpenWorkforceDbOptions): WorkforceSqlite {
    const db = openSqlite(path, options);
    const store = new WorkforceSqlite(path, db);
    if (options?.migrate !== false) {
      migrate(db);
    }
    return store;
  }

  seedMinimalGraph(ids: SeededGraph, now: string): void {
    seedMinimalGraph(this.connection, ids, now);
  }

  backup(destinationPath: string): Promise<void> {
    return backupDatabase(this.connection, destinationPath);
  }

  close(): void {
    this.connection.close();
  }
}
