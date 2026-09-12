import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";
import { parseRunExecutionSnapshot, type RunExecutionSnapshot } from "@workforce/protocol";

import { PersistenceError, isCheckConstraintError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { cell, optionalText, requiredInt, requiredText } from "./sql.js";

export const ACTIVE_RUN_STATUSES = [
  "pending",
  "starting",
  "running",
  "waiting_input",
  "paused",
] as const;

export interface StartRunInput {
  runId: string;
  organizationId: string;
  taskId: string;
  operationId: string;
  attempt: number;
  generation: number;
  definitionRevision: number;
  executionNodeId?: string;
  runtimeInstallationId?: string;
  workspaceInstanceId?: string;
  runtimeAdapter?: string;
  snapshotRef?: string;
  createdAt: string;
  executionSnapshot?: RunExecutionSnapshot;
}

export interface RunRecord {
  id: string;
  organizationId: string;
  taskId: string;
  operationId: string | null;
  attempt: number;
  generation: number;
  definitionRevision: number;
  status: string;
  stateRevision: number;
}

export class SqliteRunRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): RunRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, organization_id, task_id, operation_id, attempt, generation,
                definition_revision, status, state_revision
           FROM runs WHERE id = ?`,
      )
      .get(id);
    return row ? rowToRun(row) : null;
  }

  listByTask(taskId: string): RunRecord[] {
    return this.db
      .prepare(
        `SELECT id, organization_id, task_id, operation_id, attempt, generation,
                definition_revision, status, state_revision
           FROM runs WHERE task_id = ? ORDER BY attempt ASC`,
      )
      .all(taskId)
      .map(rowToRun);
  }

  activeForTask(taskId: string): RunRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, organization_id, task_id, operation_id, attempt, generation,
                definition_revision, status, state_revision
           FROM runs
          WHERE task_id = ?
            AND status IN ('pending','starting','running','waiting_input','paused')`,
      )
      .get(taskId);
    return row ? rowToRun(row) : null;
  }

  listByProject(projectId: string): RunRecord[] {
    return this.db
      .prepare(
        `SELECT r.id, r.organization_id, r.task_id, r.operation_id, r.attempt, r.generation,
                r.definition_revision, r.status, r.state_revision
           FROM runs r
           INNER JOIN tasks t ON t.id = r.task_id
          WHERE t.project_id = ?
          ORDER BY r.created_at ASC, r.id ASC`,
      )
      .all(projectId)
      .map(rowToRun);
  }

  /** Complete the additive execution-axis projection exactly once. */
  setExecutionSnapshot(tx: Tx, runId: string, snapshot: RunExecutionSnapshot): void {
    const db = sqliteDbOf(tx);
    const executionSnapshot = validateExecutionSnapshot(snapshot, runId);
    try {
      const result = db
        .prepare(
          `UPDATE runs
              SET orchestration_mode = ?,
                  transport = ?,
                  execution_snapshot_id = ?,
                  placement_snapshot_json = ?
            WHERE id = ?
              AND orchestration_mode IS NULL
              AND transport IS NULL
              AND execution_snapshot_id IS NULL
              AND placement_snapshot_json IS NULL`,
        )
        .run(
          executionSnapshot.orchestrationMode,
          executionSnapshot.transport,
          executionSnapshot.executionSnapshotId ?? null,
          JSON.stringify(executionSnapshot.placementSnapshot),
          runId,
        );
      if (Number(result.changes) === 0) {
        throw new PersistenceError(
          "conflict",
          `run ${runId} execution snapshot already exists or is partially populated`,
        );
      }
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      if (isCheckConstraintError(error)) {
        throw new PersistenceError("constraint", `run ${runId} execution-axis contract violated`);
      }
      throw error;
    }
  }

  /**
   * Insert a pending Run. Duplicate (task_id, attempt) or a second active Run
   * fails the whole caller transaction.
   */
  insertPending(tx: Tx, input: StartRunInput): void {
    const db = sqliteDbOf(tx);
    const executionSnapshot =
      input.executionSnapshot === undefined
        ? undefined
        : validateExecutionSnapshot(input.executionSnapshot, input.runId);
    try {
      db.prepare(
        `INSERT INTO runs (
           id, organization_id, task_id, operation_id, attempt, generation,
           definition_revision, status, state_revision,
           execution_node_id, runtime_installation_id, workspace_instance_id,
            runtime_adapter, snapshot_ref,
            orchestration_mode, transport, execution_snapshot_id, placement_snapshot_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.runId,
        input.organizationId,
        input.taskId,
        input.operationId,
        input.attempt,
        input.generation,
        input.definitionRevision,
        input.executionNodeId ?? null,
        input.runtimeInstallationId ?? null,
        input.workspaceInstanceId ?? null,
        input.runtimeAdapter ?? null,
        input.snapshotRef ?? null,
        executionSnapshot?.orchestrationMode ?? null,
        executionSnapshot?.transport ?? null,
        executionSnapshot?.executionSnapshotId ?? null,
        executionSnapshot ? JSON.stringify(executionSnapshot.placementSnapshot) : null,
        input.createdAt,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError(
          "conflict",
          "run already exists or task already has an active run",
        );
      }
      if (isCheckConstraintError(error)) {
        throw new PersistenceError(
          "constraint",
          `run ${input.runId} execution-axis contract violated`,
        );
      }
      throw error;
    }
  }

  /**
   * Insert a Run at an arbitrary status (snapshot / recovery). The one-active-run
   * partial unique index still applies.
   */
  insert(
    tx: Tx,
    input: StartRunInput & {
      status?: string;
      stateRevision?: number;
      cancelRequestedAt?: string;
    },
  ): void {
    const db = sqliteDbOf(tx);
    const executionSnapshot =
      input.executionSnapshot === undefined
        ? undefined
        : validateExecutionSnapshot(input.executionSnapshot, input.runId);
    try {
      db.prepare(
        `INSERT INTO runs (
           id, organization_id, task_id, operation_id, attempt, generation,
           definition_revision, status, state_revision,
           execution_node_id, runtime_installation_id, workspace_instance_id,
           runtime_adapter, snapshot_ref, cancel_requested_at,
           orchestration_mode, transport, execution_snapshot_id, placement_snapshot_json,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.runId,
        input.organizationId,
        input.taskId,
        input.operationId,
        input.attempt,
        input.generation,
        input.definitionRevision,
        input.status ?? "pending",
        input.stateRevision ?? 1,
        input.executionNodeId ?? null,
        input.runtimeInstallationId ?? null,
        input.workspaceInstanceId ?? null,
        input.runtimeAdapter ?? null,
        input.snapshotRef ?? null,
        input.cancelRequestedAt ?? null,
        executionSnapshot?.orchestrationMode ?? null,
        executionSnapshot?.transport ?? null,
        executionSnapshot?.executionSnapshotId ?? null,
        executionSnapshot ? JSON.stringify(executionSnapshot.placementSnapshot) : null,
        input.createdAt,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError(
          "conflict",
          "run already exists or task already has an active run",
        );
      }
      if (isCheckConstraintError(error)) {
        throw new PersistenceError(
          "constraint",
          `run ${input.runId} execution-axis contract violated`,
        );
      }
      throw error;
    }
  }

  /**
   * Persist the first accepted cancellation request. A later snapshot cannot
   * clear or replace the original request timestamp.
   */
  recordCancelRequest(tx: Tx, runId: string, requestedAt: string): void {
    sqliteDbOf(tx)
      .prepare(
        "UPDATE runs SET cancel_requested_at = COALESCE(cancel_requested_at, ?) WHERE id = ?",
      )
      .run(requestedAt, runId);
  }

  updateStatus(
    tx: Tx,
    input: { runId: string; expectedStateRevision: number; status: string; at: string },
  ): void {
    const db = sqliteDbOf(tx);
    const ended =
      input.status === "succeeded" ||
      input.status === "failed" ||
      input.status === "timed_out" ||
      input.status === "cancelled"
        ? input.at
        : null;
    const changes = db
      .prepare(
        `UPDATE runs
            SET status = ?, state_revision = state_revision + 1, ended_at = COALESCE(ended_at, ?)
          WHERE id = ? AND state_revision = ?`,
      )
      .run(input.status, ended, input.runId, input.expectedStateRevision);
    if (Number(changes.changes) === 0) {
      throw new PersistenceError("revision_conflict", `run ${input.runId} revision mismatch`);
    }
  }
}

function validateExecutionSnapshot(value: unknown, runId: string): RunExecutionSnapshot {
  try {
    return parseRunExecutionSnapshot(value);
  } catch {
    throw new PersistenceError("constraint", `run ${runId} has an invalid execution snapshot`);
  }
}

function rowToRun(row: Record<string, unknown>): RunRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
    taskId: requiredText(cell(row, "task_id"), "task_id"),
    operationId: optionalText(cell(row, "operation_id")),
    attempt: requiredInt(cell(row, "attempt"), "attempt"),
    generation: requiredInt(cell(row, "generation"), "generation"),
    definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    status: requiredText(cell(row, "status"), "status"),
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
  };
}
