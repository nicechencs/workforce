import type { DatabaseSync } from "node:sqlite";

import type { Tx, WorkflowGraph, WorkflowInstanceRecord } from "@workforce/application";

import {
  assertCas,
  organizationIdOfProject,
  publishWorkflowVersion,
  readPublishedWorkflowVersion,
} from "./ensure.js";
import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, ifPresent, optionalText, requiredInt, requiredText } from "./sql.js";

const WORKFLOW_COLUMNS = `
  id, project_id, workflow_version_id, execution_snapshot_id, status, state_revision, graph_json,
  cancel_requested_at, created_at, updated_at
`;

export class SqliteWorkflowInstanceRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): WorkflowInstanceRecord | null {
    const row = this.db
      .prepare(`SELECT ${WORKFLOW_COLUMNS} FROM workflow_instances WHERE id = ?`)
      .get(id);
    return row ? rowToWorkflow(this.db, row) : null;
  }

  listByProject(projectId: string): WorkflowInstanceRecord[] {
    return this.db
      .prepare(
        `SELECT ${WORKFLOW_COLUMNS} FROM workflow_instances
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(projectId)
      .map((row) => rowToWorkflow(this.db, row));
  }

  listAll(): WorkflowInstanceRecord[] {
    return this.db
      .prepare(`SELECT ${WORKFLOW_COLUMNS} FROM workflow_instances ORDER BY created_at ASC, id ASC`)
      .all()
      .map((row) => rowToWorkflow(this.db, row));
  }

  insert(tx: Tx, record: WorkflowInstanceRecord, at: string): void {
    const db = sqliteDbOf(tx);
    const persisted = snapshotOwnedWorkflow(db, record);
    const organizationId = organizationIdOfProject(db, persisted.projectId);
    const graph = publishAndReadCanonicalGraph(db, persisted, at);
    try {
      db.prepare(
        `INSERT INTO workflow_instances (
           id, organization_id, project_id, workflow_version_id, execution_snapshot_id, status,
           state_revision, started_at, created_at, updated_at, graph_json, cancel_requested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        persisted.id,
        organizationId,
        persisted.projectId,
        persisted.workflowVersionId,
        persisted.executionSnapshotId ?? null,
        persisted.status,
        persisted.stateRevision,
        persisted.status === "created" ? null : at,
        at,
        at,
        asJsonText(graph),
        persisted.cancelRequestedAt ?? null,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `workflow instance ${record.id} already exists`);
      }
      throw error;
    }
  }

  update(tx: Tx, record: WorkflowInstanceRecord, expectedStateRevision: number, at: string): void {
    const db = sqliteDbOf(tx);
    const persisted = snapshotOwnedWorkflow(db, record);
    const graph = publishAndReadCanonicalGraph(db, persisted, at);
    const result = db
      .prepare(
        `UPDATE workflow_instances
            SET workflow_version_id = ?,
                execution_snapshot_id = ?,
                status = ?,
                state_revision = ?,
                graph_json = ?,
                cancel_requested_at = ?,
                updated_at = ?,
                ended_at = CASE
                  WHEN ? IN ('completed','failed','cancelled') THEN COALESCE(ended_at, ?)
                  ELSE ended_at
                END
          WHERE id = ? AND state_revision = ?`,
      )
      .run(
        persisted.workflowVersionId,
        persisted.executionSnapshotId ?? null,
        persisted.status,
        persisted.stateRevision,
        asJsonText(graph),
        persisted.cancelRequestedAt ?? null,
        at,
        persisted.status,
        at,
        persisted.id,
        expectedStateRevision,
      );
    assertCas(result.changes, "workflow instance", record.id);
  }
}

/** Persist canonical graphs before any ProjectExecutionSnapshot can reference them. */
export function persistPublishedWorkflowGraph(tx: Tx, graph: WorkflowGraph, at: string): void {
  const db = sqliteDbOf(tx);
  publishWorkflowVersion(
    db,
    {
      id: graph.id,
      workflowId: graph.workflowId,
      version: graph.version,
      definition: graph,
    },
    at,
  );
}

/** SQLite is the restart authority for the canonical execution graph map. */
export function listPublishedWorkflowGraphs(db: DatabaseSync): WorkflowGraph[] {
  return db
    .prepare(
      "SELECT id FROM workflow_versions WHERE content_hash <> ? ORDER BY created_at ASC, id ASC",
    )
    .all("sha256:empty")
    .map((row) => {
      const id = requiredText(cell(row as Record<string, unknown>, "id"), "id");
      const graph = parseGraph(readPublishedWorkflowVersion(db, id));
      if (graph.id !== id) {
        throw new PersistenceError("conflict", `workflow version ${id} definition id mismatch`);
      }
      return graph;
    });
}

function snapshotOwnedWorkflow(
  db: DatabaseSync,
  record: WorkflowInstanceRecord,
): WorkflowInstanceRecord {
  if (!record.executionSnapshotId) {
    return record;
  }
  const snapshot = readSnapshot(db, record.executionSnapshotId);
  if (!snapshot) {
    return record;
  }
  if (record.workflowVersionId !== snapshot.workflowVersionId) {
    throw new PersistenceError(
      "conflict",
      `workflow instance ${record.id} workflowVersionId conflicts with execution snapshot ${snapshot.id}`,
    );
  }
  return {
    ...record,
    workflowVersionId: snapshot.workflowVersionId,
    executionSnapshotId: snapshot.id,
  };
}

function readSnapshot(
  db: DatabaseSync,
  id: string,
): { id: string; workflowVersionId: string } | null {
  const row = db
    .prepare("SELECT id, workflow_version_id FROM project_execution_snapshots WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: requiredText(cell(row, "id"), "id"),
    workflowVersionId: requiredText(cell(row, "workflow_version_id"), "workflow_version_id"),
  };
}

function rowToWorkflow(db: DatabaseSync, row: Record<string, unknown>): WorkflowInstanceRecord {
  const snapshotId = optionalText(cell(row, "execution_snapshot_id"));
  const snapshot = snapshotId === null ? null : readSnapshot(db, snapshotId);
  if (snapshotId !== null && snapshot === null) {
    throw new PersistenceError(
      "not_found",
      `project execution snapshot ${snapshotId} is missing; instance version columns are not an authority`,
    );
  }
  const workflowVersionId =
    snapshot?.workflowVersionId ??
    requiredText(cell(row, "workflow_version_id"), "workflow_version_id");
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    workflowVersionId,
    graph: parseGraph(readPublishedWorkflowVersion(db, workflowVersionId)),
    status: requiredText(cell(row, "status"), "status") as WorkflowInstanceRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    ...ifPresent("executionSnapshotId", snapshotId),
    ...ifPresent("cancelRequestedAt", optionalText(cell(row, "cancel_requested_at"))),
  };
}

function publishAndReadCanonicalGraph(
  db: DatabaseSync,
  record: WorkflowInstanceRecord,
  at: string,
): WorkflowGraph {
  publishWorkflowVersion(
    db,
    {
      id: record.workflowVersionId,
      workflowId: record.graph.workflowId,
      version: record.graph.version,
      definition: record.graph,
    },
    at,
  );
  return parseGraph(readPublishedWorkflowVersion(db, record.workflowVersionId));
}

function parseGraph(value: unknown): WorkflowGraph {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid workflow graph_json");
  }
  return value as WorkflowGraph;
}
