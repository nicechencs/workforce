import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";

import { isConstraintError, PersistenceError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { cell, optionalText, requiredText, type SqlValue } from "./sql.js";

/**
 * D02: the confirmed execution snapshot for one Project.
 *
 * Written exactly once, when the plan is confirmed. WorkflowVersion and
 * TeamVersion for every workflow-bound Run and WorkflowInstance are read from
 * here, never from separately written version columns.
 *
 * Deliberately imports nothing from `@workforce/domain` or `@workforce/policy`
 * so this repository stays independent of those packages.
 */
export interface ProjectExecutionSnapshotRecord {
  id: string;
  projectId: string;
  workflowVersionId: string;
  teamVersionId: string;
  contentHash: string;
  policySnapshot: Record<string, unknown>;
  budgetSnapshot?: Record<string, unknown>;
  createdAt: string;
}

function asJsonText(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export class SqliteProjectExecutionSnapshotRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ProjectExecutionSnapshotRecord | null {
    const row = this.db
      .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM project_execution_snapshots WHERE id = ?`)
      .get(id);
    return row ? rowToSnapshot(row) : null;
  }

  findByProject(projectId: string): ProjectExecutionSnapshotRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${SNAPSHOT_COLUMNS} FROM project_execution_snapshots
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1`,
      )
      .get(projectId);
    return row ? rowToSnapshot(row) : null;
  }

  listAll(): ProjectExecutionSnapshotRecord[] {
    return this.db
      .prepare(
        `SELECT ${SNAPSHOT_COLUMNS} FROM project_execution_snapshots
          ORDER BY created_at ASC, id ASC`,
      )
      .all()
      .map(rowToSnapshot);
  }

  /**
   * Insert-once. A snapshot is immutable: re-inserting the same id is a
   * no-op only when the content matches, and a conflict otherwise. There is
   * intentionally no update method.
   */
  insert(tx: Tx, record: ProjectExecutionSnapshotRecord): void {
    const db = sqliteDbOf(tx);
    const existing = db
      .prepare("SELECT content_hash FROM project_execution_snapshots WHERE id = ?")
      .get(record.id) as Record<string, unknown> | undefined;
    if (existing) {
      const storedHash = requiredText(cell(existing, "content_hash"), "content_hash");
      if (storedHash !== record.contentHash) {
        throw new PersistenceError(
          "conflict",
          `project execution snapshot ${record.id} already exists with a different content hash`,
        );
      }
      return;
    }

    try {
      db.prepare(
        `INSERT INTO project_execution_snapshots (
           id, project_id, workflow_version_id, team_version_id, content_hash,
           policy_snapshot_json, budget_snapshot_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.projectId,
        record.workflowVersionId,
        record.teamVersionId,
        record.contentHash,
        asJsonText(record.policySnapshot),
        record.budgetSnapshot === undefined ? null : asJsonText(record.budgetSnapshot),
        record.createdAt,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError(
          "conflict",
          `project execution snapshot ${record.id} violates a database constraint`,
        );
      }
      throw error;
    }
  }
}

const SNAPSHOT_COLUMNS = `id, project_id, workflow_version_id, team_version_id, content_hash,
       policy_snapshot_json, budget_snapshot_json, created_at`;

function rowToSnapshot(row: Record<string, unknown>): ProjectExecutionSnapshotRecord {
  const budgetJson = optionalText(cell(row, "budget_snapshot_json"));
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    workflowVersionId: requiredText(cell(row, "workflow_version_id"), "workflow_version_id"),
    teamVersionId: requiredText(cell(row, "team_version_id"), "team_version_id"),
    contentHash: requiredText(cell(row, "content_hash"), "content_hash"),
    policySnapshot: parseJsonObject(cell(row, "policy_snapshot_json"), "policy_snapshot_json"),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    ...(budgetJson === null
      ? {}
      : { budgetSnapshot: parseJsonObject(budgetJson, "budget_snapshot_json") }),
  };
}

function parseJsonObject(value: SqlValue | undefined, field: string): Record<string, unknown> {
  const text = requiredText(value, field);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PersistenceError("constraint", `${field} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
