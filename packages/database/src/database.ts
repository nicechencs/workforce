import type { DatabaseSync } from "node:sqlite";

import { backupDatabase } from "./backup.js";
import { openSqlite, type OpenSqliteOptions } from "./connection.js";
import { SqliteEventStore } from "./event-store.js";
import { SqliteHandleRepository } from "./handles.js";
import { migrate } from "./migrate.js";
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
import { SqliteTimerRepository } from "./timers.js";
import { SqliteUnitOfWork } from "./uow.js";

export interface OpenWorkforceDbOptions extends OpenSqliteOptions {
  migrate?: boolean;
}

export class WorkforceSqlite {
  readonly uow: SqliteUnitOfWork;
  readonly events: SqliteEventStore;
  readonly receipts: SqliteCommandReceiptRepository;
  readonly runs: SqliteRunRepository;
  readonly handles: SqliteHandleRepository;
  readonly timers: SqliteTimerRepository;
  readonly nodeInstances: SqliteNodeInstanceRepository;
  readonly approvals: SqliteApprovalRepository;
  readonly artifacts: SqliteArtifactBindingRepository;
  readonly usage: SqliteUsageRepository;
  readonly resources: SqliteResourceRepository;
  readonly inbox: SqliteInbox;

  private constructor(
    readonly path: string,
    readonly connection: DatabaseSync,
  ) {
    this.uow = new SqliteUnitOfWork(connection);
    this.events = new SqliteEventStore(connection);
    this.receipts = new SqliteCommandReceiptRepository(connection);
    this.runs = new SqliteRunRepository(connection);
    this.handles = new SqliteHandleRepository(connection);
    this.timers = new SqliteTimerRepository(connection);
    this.nodeInstances = new SqliteNodeInstanceRepository(connection);
    this.approvals = new SqliteApprovalRepository(connection);
    this.artifacts = new SqliteArtifactBindingRepository(connection);
    this.usage = new SqliteUsageRepository(connection);
    this.resources = new SqliteResourceRepository(connection);
    this.inbox = new SqliteInbox(connection);
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
