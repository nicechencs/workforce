import type { DatabaseSync } from "node:sqlite";

import type {
  ApprovalRecord,
  ArtifactRecord,
  BudgetRecord,
  NodeInstanceRecord,
  ProjectRecord,
  ReservationRecord,
  RunRecord as AppRunRecord,
  TaskRecord,
  Tx,
  WorkflowInstanceRecord,
} from "@workforce/application";

import { SqliteBudgetRepository, SqliteReservationRepository } from "./budgets.js";
import { organizationIdOfProject } from "./ensure.js";
import { PersistenceError } from "./errors.js";
import { SqliteProjectRepository } from "./projects.js";
import {
  SqliteApprovalRepository,
  SqliteArtifactBindingRepository,
  SqliteNodeInstanceRepository,
  SqliteUsageRepository,
} from "./records.js";
import { SqliteRunRepository } from "./runs.js";
import { sqliteDbOf } from "./session.js";
import { cell, ifPresent, optionalText, requiredInt, requiredText } from "./sql.js";
import { SqliteTaskRepository } from "./tasks.js";
import { SqliteWorkflowInstanceRepository } from "./workflows.js";

/**
 * Entity snapshot that can reconstruct MemoryWorld maps after daemon restart.
 * Events stay in SqliteEventStore — this is not a second event envelope.
 */
export interface WorldEntitySnapshot {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  workflows: WorkflowInstanceRecord[];
  nodes: NodeInstanceRecord[];
  approvals: ApprovalRecord[];
  artifacts: ArtifactRecord[];
  runs: AppRunRecord[];
  budgets: BudgetRecord[];
  reservations: ReservationRecord[];
  usageKeys: string[];
}

export class SqliteWorldSnapshot {
  readonly projects: SqliteProjectRepository;
  readonly tasks: SqliteTaskRepository;
  readonly workflows: SqliteWorkflowInstanceRepository;
  readonly nodes: SqliteNodeInstanceRepository;
  readonly approvals: SqliteApprovalRepository;
  readonly artifacts: SqliteArtifactBindingRepository;
  readonly runs: SqliteRunRepository;
  readonly budgets: SqliteBudgetRepository;
  readonly reservations: SqliteReservationRepository;
  readonly usage: SqliteUsageRepository;

  constructor(private readonly db: DatabaseSync) {
    this.projects = new SqliteProjectRepository(db);
    this.tasks = new SqliteTaskRepository(db);
    this.workflows = new SqliteWorkflowInstanceRepository(db);
    this.nodes = new SqliteNodeInstanceRepository(db);
    this.approvals = new SqliteApprovalRepository(db);
    this.artifacts = new SqliteArtifactBindingRepository(db);
    this.runs = new SqliteRunRepository(db);
    this.budgets = new SqliteBudgetRepository(db);
    this.reservations = new SqliteReservationRepository(db);
    this.usage = new SqliteUsageRepository(db);
  }

  load(): WorldEntitySnapshot {
    return {
      projects: this.projects.listAll(),
      tasks: this.tasks.listAll(),
      workflows: this.workflows.listAll(),
      nodes: this.nodes.listAll(),
      approvals: this.approvals.listAll(),
      artifacts: this.artifacts.listAll(),
      runs: loadAppRuns(this.db),
      budgets: this.budgets.listAll(),
      reservations: this.reservations.listActive(),
      usageKeys: this.usage.listIdempotencyKeys(),
    };
  }

  /**
   * Persist entity maps. Callers still append events through SqliteEventStore
   * in the same transaction when mutating live state.
   */
  save(tx: Tx, snapshot: WorldEntitySnapshot, at: string): void {
    for (const project of snapshot.projects) {
      putWithCas(this.projects.get(project.id), project, (expected) => {
        if (expected === undefined) {
          this.projects.insert(tx, project);
        } else {
          this.projects.update(tx, project, expected);
        }
      });
    }
    for (const workflow of snapshot.workflows) {
      putWithCas(this.workflows.get(workflow.id), workflow, (expected) => {
        if (expected === undefined) {
          this.workflows.insert(tx, workflow, at);
        } else {
          this.workflows.update(tx, workflow, expected, at);
        }
      });
    }
    for (const task of snapshot.tasks) {
      putWithCas(this.tasks.get(task.id), task, (expected) => {
        if (expected === undefined) {
          this.tasks.insert(tx, task);
        } else {
          this.tasks.update(tx, task, expected);
        }
      });
    }
    for (const node of snapshot.nodes) {
      putWithCas(this.nodes.get(node.id), node, (expected) => {
        if (expected === undefined) {
          this.nodes.insert(tx, node);
        } else {
          this.nodes.update(tx, node, expected);
        }
      });
    }
    for (const approval of snapshot.approvals) {
      putWithCas(this.approvals.get(approval.id), approval, (expected) => {
        if (expected === undefined) {
          this.approvals.insert(tx, approval);
        } else {
          this.approvals.update(tx, approval, expected);
        }
      });
    }
    for (const artifact of snapshot.artifacts) {
      if (this.artifacts.get(artifact.artifactVersionId)) {
        this.artifacts.update(tx, artifact);
      } else {
        this.artifacts.insert(tx, artifact, at);
      }
    }
    for (const run of snapshot.runs) {
      saveAppRun(tx, this.runs, this.db, run);
    }
    for (const budget of snapshot.budgets) {
      this.budgets.upsert(tx, budget, at);
    }
    // Whole-world call: empty snapshot.reservations releases all actives.
    this.reservations.syncActive(tx, snapshot.reservations, at);
    const organizationId =
      snapshot.projects[0]?.organizationId ??
      (snapshot.budgets[0]
        ? organizationIdOfProject(this.db, snapshot.budgets[0].projectId)
        : undefined);
    if (organizationId && snapshot.usageKeys.length > 0) {
      this.usage.putKeys(tx, {
        organizationId,
        keys: snapshot.usageKeys,
        createdAt: at,
      });
    }
  }
}

function putWithCas<T extends { id: string; stateRevision: number }>(
  existing: T | null,
  record: T,
  write: (expected: number | undefined) => void,
): void {
  if (!existing) {
    write(undefined);
    return;
  }
  if (existing.stateRevision > record.stateRevision) {
    throw new PersistenceError(
      "revision_conflict",
      `${record.id} stored revision ${existing.stateRevision} is newer than ${record.stateRevision}`,
    );
  }
  write(existing.stateRevision);
}

function loadAppRuns(db: DatabaseSync): AppRunRecord[] {
  return db
    .prepare(
      `SELECT r.id, r.task_id, t.project_id, r.status, r.state_revision, r.attempt,
              r.generation, r.definition_revision, r.operation_id, r.cancel_requested_at,
              r.created_at
         FROM runs r
         INNER JOIN tasks t ON t.id = r.task_id
        ORDER BY r.created_at ASC, r.id ASC`,
    )
    .all()
    .map(rowToAppRun);
}

function rowToAppRun(row: Record<string, unknown>): AppRunRecord {
  const createdAt = requiredText(cell(row, "created_at"), "created_at");
  return {
    id: requiredText(cell(row, "id"), "id"),
    taskId: requiredText(cell(row, "task_id"), "task_id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    status: requiredText(cell(row, "status"), "status") as AppRunRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    attempt: requiredInt(cell(row, "attempt"), "attempt"),
    generation: requiredInt(cell(row, "generation"), "generation"),
    definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    operationId: optionalText(cell(row, "operation_id")) ?? "",
    createdAt,
    updatedAt: createdAt,
    ...ifPresent("cancelRequestedAt", optionalText(cell(row, "cancel_requested_at"))),
  };
}

function saveAppRun(tx: Tx, runs: SqliteRunRepository, db: DatabaseSync, run: AppRunRecord): void {
  const existing = runs.get(run.id);
  const organizationId = organizationIdForTask(db, run.taskId);
  if (!existing) {
    runs.insert(tx, {
      runId: run.id,
      organizationId,
      taskId: run.taskId,
      operationId: run.operationId,
      attempt: run.attempt,
      generation: run.generation,
      definitionRevision: run.definitionRevision,
      createdAt: run.createdAt,
      status: run.status,
      stateRevision: run.stateRevision,
    });
    if (run.cancelRequestedAt) {
      sqliteDbOf(tx)
        .prepare("UPDATE runs SET cancel_requested_at = ? WHERE id = ?")
        .run(run.cancelRequestedAt, run.id);
    }
    return;
  }
  if (existing.stateRevision > run.stateRevision) {
    throw new PersistenceError(
      "revision_conflict",
      `run ${run.id} stored revision ${existing.stateRevision} is newer than ${run.stateRevision}`,
    );
  }
  if (existing.stateRevision !== run.stateRevision || existing.status !== run.status) {
    runs.updateStatus(tx, {
      runId: run.id,
      expectedStateRevision: existing.stateRevision,
      status: run.status,
      at: run.updatedAt,
    });
    if (run.stateRevision !== existing.stateRevision + 1) {
      sqliteDbOf(tx)
        .prepare("UPDATE runs SET state_revision = ? WHERE id = ?")
        .run(run.stateRevision, run.id);
    }
  }
}

function organizationIdForTask(db: DatabaseSync, taskId: string): string {
  const row = db.prepare("SELECT organization_id FROM tasks WHERE id = ?").get(taskId);
  if (!row) {
    throw new PersistenceError("not_found", `task ${taskId} not found`);
  }
  return requiredText(cell(row, "organization_id"), "organization_id");
}
