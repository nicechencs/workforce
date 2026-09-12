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
  team_version_id, workflow_version_id, execution_snapshot_id, runtime_id, workspace_id, budget_id,
  execution_node_id, runtime_installation_id, workspace_instance_id,
  workflow_instance_id, plan_artifact_version_id, cancel_requested_at,
  created_at, updated_at
`;

export class SqliteProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ProjectRecord | null {
    const row = this.db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id);
    return row ? rowToProject(this.db, row) : null;
  }

  getInTransaction(tx: Tx, id: string): ProjectRecord | null {
    const row = sqliteDbOf(tx)
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`)
      .get(id);
    return row ? rowToProject(sqliteDbOf(tx), row) : null;
  }

  listByOrganization(organizationId: string): ProjectRecord[] {
    return this.db
      .prepare(
        `SELECT ${PROJECT_COLUMNS} FROM projects
          WHERE organization_id = ?
          ORDER BY updated_at ASC, id ASC`,
      )
      .all(organizationId)
      .map((row) => rowToProject(this.db, row));
  }

  listAll(): ProjectRecord[] {
    return this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at ASC, id ASC`)
      .all()
      .map((row) => rowToProject(this.db, row));
  }

  insert(tx: Tx, record: ProjectRecord): void {
    const db = sqliteDbOf(tx);
    const persisted = snapshotOwnedProject(db, record);
    prepareProjectRefs(db, persisted);
    try {
      db.prepare(
        `INSERT INTO projects (
           id, organization_id, name, objective, status, state_revision,
           team_version_id, workflow_version_id, execution_snapshot_id, runtime_id, workspace_id,
           budget_id, execution_node_id, runtime_installation_id, workspace_instance_id,
           workflow_instance_id, plan_artifact_version_id, cancel_requested_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        persisted.id,
        persisted.organizationId,
        persisted.name,
        persisted.objective,
        persisted.status,
        persisted.stateRevision,
        persisted.teamVersionId ?? null,
        persisted.workflowVersionId ?? null,
        persisted.executionSnapshotId ?? null,
        persisted.runtimeId ?? null,
        persisted.workspaceId ?? null,
        persisted.budgetId ?? null,
        persisted.executionNodeId ?? null,
        persisted.runtimeInstallationId ?? null,
        persisted.workspaceInstanceId ?? null,
        persisted.workflowInstanceId ?? null,
        persisted.planArtifactVersionId ?? null,
        persisted.cancelRequestedAt ?? null,
        persisted.createdAt,
        persisted.updatedAt,
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
    const persisted = snapshotOwnedProject(db, record);
    prepareProjectRefs(db, persisted);
    const result = db
      .prepare(
        `UPDATE projects
            SET name = ?,
                objective = ?,
                status = ?,
                state_revision = ?,
                team_version_id = ?,
                workflow_version_id = ?,
                execution_snapshot_id = ?,
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
        persisted.name,
        persisted.objective,
        persisted.status,
        persisted.stateRevision,
        persisted.teamVersionId ?? null,
        persisted.workflowVersionId ?? null,
        persisted.executionSnapshotId ?? null,
        persisted.runtimeId ?? null,
        persisted.workspaceId ?? null,
        persisted.budgetId ?? null,
        persisted.executionNodeId ?? null,
        persisted.runtimeInstallationId ?? null,
        persisted.workspaceInstanceId ?? null,
        persisted.workflowInstanceId ?? null,
        persisted.planArtifactVersionId ?? null,
        persisted.cancelRequestedAt ?? null,
        persisted.updatedAt,
        persisted.id,
        expectedStateRevision,
      );
    assertCas(result.changes, "project", persisted.id);
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

function snapshotOwnedProject(db: DatabaseSync, record: ProjectRecord): ProjectRecord {
  if (!record.executionSnapshotId) {
    return record;
  }
  const snapshot = readSnapshot(db, record.executionSnapshotId);
  if (!snapshot) {
    return record;
  }
  if (record.workflowVersionId && record.workflowVersionId !== snapshot.workflowVersionId) {
    throw new PersistenceError(
      "conflict",
      `project ${record.id} workflowVersionId conflicts with execution snapshot ${snapshot.id}`,
    );
  }
  if (record.teamVersionId && record.teamVersionId !== snapshot.teamVersionId) {
    throw new PersistenceError(
      "conflict",
      `project ${record.id} teamVersionId conflicts with execution snapshot ${snapshot.id}`,
    );
  }
  return {
    ...record,
    workflowVersionId: snapshot.workflowVersionId,
    teamVersionId: snapshot.teamVersionId,
    executionSnapshotId: snapshot.id,
  };
}

function readSnapshot(
  db: DatabaseSync,
  id: string,
): { id: string; workflowVersionId: string; teamVersionId: string } | null {
  const row = db
    .prepare(
      `SELECT id, workflow_version_id, team_version_id
         FROM project_execution_snapshots WHERE id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: requiredText(cell(row, "id"), "id"),
    workflowVersionId: requiredText(cell(row, "workflow_version_id"), "workflow_version_id"),
    teamVersionId: requiredText(cell(row, "team_version_id"), "team_version_id"),
  };
}

function rowToProject(db: DatabaseSync, row: Record<string, unknown>): ProjectRecord {
  const snapshotId = optionalText(cell(row, "execution_snapshot_id"));
  const snapshot = snapshotId === null ? null : readSnapshot(db, snapshotId);
  if (snapshotId !== null && snapshot === null) {
    throw new PersistenceError(
      "not_found",
      `project execution snapshot ${snapshotId} is missing; version columns are not an authority`,
    );
  }
  return {
    id: requiredText(cell(row, "id"), "id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
    name: requiredText(cell(row, "name"), "name"),
    objective: requiredText(cell(row, "objective"), "objective"),
    status: requiredText(cell(row, "status"), "status") as ProjectRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
    ...ifPresent(
      "teamVersionId",
      snapshot?.teamVersionId ?? optionalText(cell(row, "team_version_id")),
    ),
    ...ifPresent(
      "workflowVersionId",
      snapshot?.workflowVersionId ?? optionalText(cell(row, "workflow_version_id")),
    ),
    ...ifPresent("executionSnapshotId", snapshotId),
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
