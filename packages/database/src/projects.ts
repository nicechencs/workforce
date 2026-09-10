import type { DatabaseSync } from "node:sqlite";

import type { ProjectRecord, Tx } from "@workforce/application";

import {
  ensureOrganization,
  ensureTeamVersion,
  ensureWorkflowVersion,
  assertCas,
} from "./ensure.js";
import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { cell, ifPresent, optionalText, requiredInt, requiredText } from "./sql.js";

const PROJECT_COLUMNS = `
  id, organization_id, name, objective, status, state_revision,
  team_version_id, workflow_version_id, runtime_id, workspace_id, budget_id,
  execution_node_id, runtime_installation_id, workspace_instance_id,
  workflow_instance_id, plan_artifact_version_id, cancel_requested_at,
  created_at, updated_at
`;

export class SqliteProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ProjectRecord | null {
    const row = this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id);
    return row ? rowToProject(row) : null;
  }

  listByOrganization(organizationId: string): ProjectRecord[] {
    return this.db
      .prepare(
        `SELECT ${PROJECT_COLUMNS} FROM projects
          WHERE organization_id = ?
          ORDER BY updated_at ASC, id ASC`,
      )
      .all(organizationId)
      .map(rowToProject);
  }

  listAll(): ProjectRecord[] {
    return this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at ASC, id ASC`)
      .all()
      .map(rowToProject);
  }

  insert(tx: Tx, record: ProjectRecord): void {
    const db = sqliteDbOf(tx);
    prepareProjectRefs(db, record);
    try {
      db.prepare(
        `INSERT INTO projects (
           id, organization_id, name, objective, status, state_revision,
           team_version_id, workflow_version_id, runtime_id, workspace_id, budget_id,
           execution_node_id, runtime_installation_id, workspace_instance_id,
           workflow_instance_id, plan_artifact_version_id, cancel_requested_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.organizationId,
        record.name,
        record.objective,
        record.status,
        record.stateRevision,
        record.teamVersionId ?? null,
        record.workflowVersionId ?? null,
        record.runtimeId ?? null,
        record.workspaceId ?? null,
        record.budgetId ?? null,
        record.executionNodeId ?? null,
        record.runtimeInstallationId ?? null,
        record.workspaceInstanceId ?? null,
        record.workflowInstanceId ?? null,
        record.planArtifactVersionId ?? null,
        record.cancelRequestedAt ?? null,
        record.createdAt,
        record.updatedAt,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `project ${record.id} already exists`);
      }
      throw error;
    }
  }

  update(tx: Tx, record: ProjectRecord, expectedStateRevision: number): void {
    const db = sqliteDbOf(tx);
    prepareProjectRefs(db, record);
    const result = db
      .prepare(
        `UPDATE projects
            SET name = ?,
                objective = ?,
                status = ?,
                state_revision = ?,
                team_version_id = ?,
                workflow_version_id = ?,
                runtime_id = ?,
                workspace_id = ?,
                budget_id = ?,
                execution_node_id = ?,
                runtime_installation_id = ?,
                workspace_instance_id = ?,
                workflow_instance_id = ?,
                plan_artifact_version_id = ?,
                cancel_requested_at = ?,
                updated_at = ?
          WHERE id = ? AND state_revision = ?`,
      )
      .run(
        record.name,
        record.objective,
        record.status,
        record.stateRevision,
        record.teamVersionId ?? null,
        record.workflowVersionId ?? null,
        record.runtimeId ?? null,
        record.workspaceId ?? null,
        record.budgetId ?? null,
        record.executionNodeId ?? null,
        record.runtimeInstallationId ?? null,
        record.workspaceInstanceId ?? null,
        record.workflowInstanceId ?? null,
        record.planArtifactVersionId ?? null,
        record.cancelRequestedAt ?? null,
        record.updatedAt,
        record.id,
        expectedStateRevision,
      );
    assertCas(result.changes, "project", record.id);
  }
}

function prepareProjectRefs(db: DatabaseSync, record: ProjectRecord): void {
  ensureOrganization(db, record.organizationId, record.updatedAt);
  if (record.teamVersionId) {
    ensureTeamVersion(db, record.teamVersionId, record.updatedAt);
  }
  if (record.workflowVersionId) {
    ensureWorkflowVersion(db, record.workflowVersionId, record.updatedAt);
  }
}

function rowToProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
    name: requiredText(cell(row, "name"), "name"),
    objective: requiredText(cell(row, "objective"), "objective"),
    status: requiredText(cell(row, "status"), "status") as ProjectRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
    ...ifPresent("teamVersionId", optionalText(cell(row, "team_version_id"))),
    ...ifPresent("workflowVersionId", optionalText(cell(row, "workflow_version_id"))),
    ...ifPresent("runtimeId", optionalText(cell(row, "runtime_id"))),
    ...ifPresent("workspaceId", optionalText(cell(row, "workspace_id"))),
    ...ifPresent("budgetId", optionalText(cell(row, "budget_id"))),
    ...ifPresent("executionNodeId", optionalText(cell(row, "execution_node_id"))),
    ...ifPresent("runtimeInstallationId", optionalText(cell(row, "runtime_installation_id"))),
    ...ifPresent("workspaceInstanceId", optionalText(cell(row, "workspace_instance_id"))),
    ...ifPresent("workflowInstanceId", optionalText(cell(row, "workflow_instance_id"))),
    ...ifPresent("planArtifactVersionId", optionalText(cell(row, "plan_artifact_version_id"))),
    ...ifPresent("cancelRequestedAt", optionalText(cell(row, "cancel_requested_at"))),
  };
}
