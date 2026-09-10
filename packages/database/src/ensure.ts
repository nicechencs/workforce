import type { DatabaseSync } from "node:sqlite";

import { PersistenceError } from "./errors.js";
import { asJsonText, cell, requiredText } from "./sql.js";

const EMPTY_CONTENT_HASH = "sha256:empty";

export function organizationIdOfProject(db: DatabaseSync, projectId: string): string {
  const row = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId);
  if (!row) {
    throw new PersistenceError("not_found", `project ${projectId} not found`);
  }
  return requiredText(cell(row, "organization_id"), "organization_id");
}

export function ensureOrganization(db: DatabaseSync, id: string, now: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO organizations (id, name, slug, settings_json, created_at, updated_at)
     VALUES (?, 'Local', ?, '{}', ?, ?)`,
  ).run(id, `slug-${id}`, now, now);
}

export function ensureTeamVersion(db: DatabaseSync, id: string, now: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO team_versions (
       id, team_id, version, definition_json, content_hash, created_at
     ) VALUES (?, ?, 1, '{}', ?, ?)`,
  ).run(id, id, EMPTY_CONTENT_HASH, now);
}

export function ensureWorkflowVersion(
  db: DatabaseSync,
  id: string,
  now: string,
  definition: unknown = {},
): void {
  db.prepare(
    `INSERT OR IGNORE INTO workflow_versions (
       id, workflow_id, version, definition_json, content_hash, created_at
     ) VALUES (?, ?, 1, ?, ?, ?)`,
  ).run(id, id, asJsonText(definition), EMPTY_CONTENT_HASH, now);
}

export function upsertWorkflowVersion(
  db: DatabaseSync,
  id: string,
  now: string,
  definition: unknown,
): void {
  db.prepare(
    `INSERT INTO workflow_versions (
       id, workflow_id, version, definition_json, content_hash, created_at
     ) VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       definition_json = excluded.definition_json,
       content_hash = excluded.content_hash`,
  ).run(id, id, asJsonText(definition), EMPTY_CONTENT_HASH, now);
}

export function assertCas(changes: number | bigint, entity: string, id: string): void {
  if (Number(changes) === 0) {
    throw new PersistenceError("revision_conflict", `${entity} ${id} revision mismatch`);
  }
}
