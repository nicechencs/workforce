import type { DatabaseSync } from "node:sqlite";

import type {
  TeamDefinitionRecord,
  TeamVersionRecord,
  Tx,
  WorkflowDefinitionRecord,
  WorkflowVersionRecord,
} from "@workforce/application";

import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import {
  asJsonText,
  cell,
  ifPresent,
  optionalText,
  parseJson,
  requiredInt,
  requiredText,
} from "./sql.js";

const WORKFLOW_COLUMNS = `
  id, name, description, status, state_revision, definition_revision,
  active_version_id, created_at, updated_at
`;

const WORKFLOW_VERSION_COLUMNS = `
  id, workflow_id, version, status, immutable, state_revision,
  definition_json, published_at, created_at, updated_at
`;

const TEAM_COLUMNS = `
  id, name, description, status, state_revision, definition_revision,
  active_version_id, created_at, updated_at
`;

const TEAM_VERSION_COLUMNS = `
  id, team_id, version, status, immutable, state_revision,
  definition_json, published_at, created_at, updated_at
`;

export class SqliteWorkflowCatalogRepository {
  constructor(private readonly db: DatabaseSync) {}

  listAll(): WorkflowDefinitionRecord[] {
    return this.db
      .prepare(`SELECT ${WORKFLOW_COLUMNS} FROM catalog_workflows ORDER BY created_at ASC, id ASC`)
      .all()
      .map(rowToWorkflow);
  }

  listVersions(workflowId?: string): WorkflowVersionRecord[] {
    const sql =
      workflowId === undefined
        ? `SELECT ${WORKFLOW_VERSION_COLUMNS} FROM catalog_workflow_versions ORDER BY created_at ASC, id ASC`
        : `SELECT ${WORKFLOW_VERSION_COLUMNS} FROM catalog_workflow_versions
            WHERE workflow_id = ? ORDER BY created_at ASC, id ASC`;
    const rows =
      workflowId === undefined ? this.db.prepare(sql).all() : this.db.prepare(sql).all(workflowId);
    return rows.map(rowToWorkflowVersion);
  }

  upsert(tx: Tx, record: WorkflowDefinitionRecord): void {
    const db = sqliteDbOf(tx);
    try {
      db.prepare(
        `INSERT INTO catalog_workflows (
           id, name, description, status, state_revision, definition_revision,
           active_version_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           status = excluded.status,
           state_revision = excluded.state_revision,
           definition_revision = excluded.definition_revision,
           active_version_id = excluded.active_version_id,
           updated_at = excluded.updated_at`,
      ).run(
        record.id,
        record.name,
        record.description,
        record.status,
        record.stateRevision,
        record.definitionRevision,
        record.activeVersionId ?? null,
        record.createdAt,
        record.updatedAt,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `catalog workflow ${record.id} already exists`);
      }
      throw error;
    }
  }

  upsertVersion(tx: Tx, record: WorkflowVersionRecord): void {
    const db = sqliteDbOf(tx);
    db.prepare(
      `INSERT INTO catalog_workflow_versions (
         id, workflow_id, version, status, immutable, state_revision,
         definition_json, published_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         status = excluded.status,
         immutable = excluded.immutable,
         state_revision = excluded.state_revision,
         definition_json = excluded.definition_json,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at`,
    ).run(
      record.id,
      record.workflowId,
      record.version,
      record.status,
      record.immutable ? 1 : 0,
      record.stateRevision,
      asJsonText({
        entry: record.entry,
        steps: record.steps,
        nodes: record.nodes,
        edges: record.edges,
      }),
      record.publishedAt ?? null,
      record.createdAt,
      record.updatedAt,
    );
  }
}

export class SqliteTeamCatalogRepository {
  constructor(private readonly db: DatabaseSync) {}

  listAll(): TeamDefinitionRecord[] {
    return this.db
      .prepare(`SELECT ${TEAM_COLUMNS} FROM catalog_teams ORDER BY created_at ASC, id ASC`)
      .all()
      .map(rowToTeam);
  }

  listVersions(teamId?: string): TeamVersionRecord[] {
    const sql =
      teamId === undefined
        ? `SELECT ${TEAM_VERSION_COLUMNS} FROM catalog_team_versions ORDER BY created_at ASC, id ASC`
        : `SELECT ${TEAM_VERSION_COLUMNS} FROM catalog_team_versions
            WHERE team_id = ? ORDER BY created_at ASC, id ASC`;
    const rows =
      teamId === undefined ? this.db.prepare(sql).all() : this.db.prepare(sql).all(teamId);
    return rows.map(rowToTeamVersion);
  }

  upsert(tx: Tx, record: TeamDefinitionRecord): void {
    const db = sqliteDbOf(tx);
    db.prepare(
      `INSERT INTO catalog_teams (
         id, name, description, status, state_revision, definition_revision,
         active_version_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         status = excluded.status,
         state_revision = excluded.state_revision,
         definition_revision = excluded.definition_revision,
         active_version_id = excluded.active_version_id,
         updated_at = excluded.updated_at`,
    ).run(
      record.id,
      record.name,
      record.description,
      record.status,
      record.stateRevision,
      record.definitionRevision,
      record.activeVersionId ?? null,
      record.createdAt,
      record.updatedAt,
    );
  }

  upsertVersion(tx: Tx, record: TeamVersionRecord): void {
    const db = sqliteDbOf(tx);
    db.prepare(
      `INSERT INTO catalog_team_versions (
         id, team_id, version, status, immutable, state_revision,
         definition_json, published_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         status = excluded.status,
         immutable = excluded.immutable,
         state_revision = excluded.state_revision,
         definition_json = excluded.definition_json,
         published_at = excluded.published_at,
         updated_at = excluded.updated_at`,
    ).run(
      record.id,
      record.teamId,
      record.version,
      record.status,
      record.immutable ? 1 : 0,
      record.stateRevision,
      asJsonText({ members: record.members }),
      record.publishedAt ?? null,
      record.createdAt,
      record.updatedAt,
    );
  }
}

function rowToWorkflow(row: Record<string, unknown>): WorkflowDefinitionRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    name: requiredText(cell(row, "name"), "name"),
    description: requiredText(cell(row, "description"), "description"),
    status: requiredText(cell(row, "status"), "status") as WorkflowDefinitionRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    ...ifPresent("activeVersionId", optionalText(cell(row, "active_version_id"))),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
  };
}

function rowToWorkflowVersion(row: Record<string, unknown>): WorkflowVersionRecord {
  const definition = asObject(parseJson(cell(row, "definition_json"), "definition_json"));
  const entry = typeof definition.entry === "string" ? definition.entry : undefined;
  return {
    id: requiredText(cell(row, "id"), "id"),
    workflowId: requiredText(cell(row, "workflow_id"), "workflow_id"),
    version: requiredText(cell(row, "version"), "version"),
    status: requiredText(cell(row, "status"), "status") as WorkflowVersionRecord["status"],
    immutable: requiredInt(cell(row, "immutable"), "immutable") === 1,
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    ...(entry !== undefined ? { entry } : {}),
    steps: asArray<WorkflowVersionRecord["steps"][number]>(definition.steps),
    nodes: asArray<WorkflowVersionRecord["nodes"][number]>(definition.nodes),
    edges: asArray<WorkflowVersionRecord["edges"][number]>(definition.edges),
    ...ifPresent("publishedAt", optionalText(cell(row, "published_at"))),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
  };
}

function rowToTeam(row: Record<string, unknown>): TeamDefinitionRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    name: requiredText(cell(row, "name"), "name"),
    description: requiredText(cell(row, "description"), "description"),
    status: requiredText(cell(row, "status"), "status") as TeamDefinitionRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    ...ifPresent("activeVersionId", optionalText(cell(row, "active_version_id"))),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
  };
}

function rowToTeamVersion(row: Record<string, unknown>): TeamVersionRecord {
  const definition = asObject(parseJson(cell(row, "definition_json"), "definition_json"));
  return {
    id: requiredText(cell(row, "id"), "id"),
    teamId: requiredText(cell(row, "team_id"), "team_id"),
    version: requiredText(cell(row, "version"), "version"),
    status: requiredText(cell(row, "status"), "status") as TeamVersionRecord["status"],
    immutable: requiredInt(cell(row, "immutable"), "immutable") === 1,
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    members: asArray<TeamVersionRecord["members"][number]>(definition.members),
    ...ifPresent("publishedAt", optionalText(cell(row, "published_at"))),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
