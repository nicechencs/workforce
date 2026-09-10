import type { DatabaseSync } from "node:sqlite";

import type { Tx, WorkflowGraph, WorkflowInstanceRecord } from "@workforce/application";

import { assertCas, organizationIdOfProject, upsertWorkflowVersion } from "./ensure.js";
import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, ifPresent, optionalText, parseJson, requiredInt, requiredText } from "./sql.js";

const WORKFLOW_COLUMNS = `
  id, project_id, workflow_version_id, status, state_revision, graph_json,
  cancel_requested_at, created_at, updated_at
`;

export class SqliteWorkflowInstanceRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): WorkflowInstanceRecord | null {
    const row = this.db
      .prepare(`SELECT ${WORKFLOW_COLUMNS} FROM workflow_instances WHERE id = ?`)
      .get(id);
    return row ? rowToWorkflow(row) : null;
  }

  listByProject(projectId: string): WorkflowInstanceRecord[] {
    return this.db
      .prepare(
        `SELECT ${WORKFLOW_COLUMNS} FROM workflow_instances
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(projectId)
      .map(rowToWorkflow);
  }

  listAll(): WorkflowInstanceRecord[] {
    return this.db
      .prepare(`SELECT ${WORKFLOW_COLUMNS} FROM workflow_instances ORDER BY created_at ASC, id ASC`)
      .all()
      .map(rowToWorkflow);
  }

  insert(tx: Tx, record: WorkflowInstanceRecord, at: string): void {
    const db = sqliteDbOf(tx);
    const organizationId = organizationIdOfProject(db, record.projectId);
    upsertWorkflowVersion(db, record.workflowVersionId, at, record.graph);
    try {
      db.prepare(
        `INSERT INTO workflow_instances (
           id, organization_id, project_id, workflow_version_id, status, state_revision,
           started_at, created_at, updated_at, graph_json, cancel_requested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        organizationId,
        record.projectId,
        record.workflowVersionId,
        record.status,
        record.stateRevision,
        record.status === "created" ? null : at,
        at,
        at,
        asJsonText(record.graph),
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
    upsertWorkflowVersion(db, record.workflowVersionId, at, record.graph);
    const result = db
      .prepare(
        `UPDATE workflow_instances
            SET workflow_version_id = ?,
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
        record.status,
        record.stateRevision,
        asJsonText(record.graph),
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

function rowToWorkflow(row: Record<string, unknown>): WorkflowInstanceRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    workflowVersionId: requiredText(cell(row, "workflow_version_id"), "workflow_version_id"),
    graph: parseGraph(parseJson(cell(row, "graph_json"), "graph_json")),
    status: requiredText(cell(row, "status"), "status") as WorkflowInstanceRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    ...ifPresent("cancelRequestedAt", optionalText(cell(row, "cancel_requested_at"))),
  };
}

function parseGraph(value: unknown): WorkflowGraph {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid workflow graph_json");
  }
  return value as WorkflowGraph;
}
