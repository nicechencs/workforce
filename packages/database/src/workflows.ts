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
    const organizationId = organizationIdOfProject(db, record.projectId);
    const graph = publishAndReadCanonicalGraph(db, record, at);
    try {
      db.prepare(
        `INSERT INTO workflow_instances (
           id, organization_id, project_id, workflow_version_id, execution_snapshot_id, status,
           state_revision, started_at, created_at, updated_at, graph_json, cancel_requested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        organizationId,
        record.projectId,
        record.workflowVersionId,
        record.executionSnapshotId ?? null,
        record.status,
        record.stateRevision,
        record.status === "created" ? null : at,
        at,
        at,
        asJsonText(graph),
        record.cancelRequestedAt ?? null,
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
    const graph = publishAndReadCanonicalGraph(db, record, at);
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
        record.workflowVersionId,
        record.executionSnapshotId ?? null,
        record.status,
        record.stateRevision,
        asJsonText(graph),
        record.cancelRequestedAt ?? null,
        at,
        record.status,
        at,
        record.id,
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

function rowToWorkflow(db: DatabaseSync, row: Record<string, unknown>): WorkflowInstanceRecord {
  const workflowVersionId = requiredText(cell(row, "workflow_version_id"), "workflow_version_id");
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    workflowVersionId,
    graph: parseGraph(readPublishedWorkflowVersion(db, workflowVersionId)),
    status: requiredText(cell(row, "status"), "status") as WorkflowInstanceRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    ...ifPresent("executionSnapshotId", optionalText(cell(row, "execution_snapshot_id"))),
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
