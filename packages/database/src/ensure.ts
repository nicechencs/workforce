import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

import { PersistenceError } from "./errors.js";
import { asJsonText, cell, parseJson, requiredInt, requiredText } from "./sql.js";

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

/**
 * Persist the execution graph exactly once. `ensureWorkflowVersion()` may have
 * created an empty FK placeholder for an old M3 project; that placeholder is
 * the only row this function may promote. A real version is never overwritten.
 */
export function publishWorkflowVersion(
  db: DatabaseSync,
  input: { id: string; workflowId: string; version: number; definition: unknown },
  now: string,
): unknown {
  const definitionJson = asJsonText(input.definition);
  const contentHash = workflowContentHash(input.definition);
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO workflow_versions (
         id, workflow_id, version, definition_json, content_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.workflowId, input.version, definitionJson, contentHash, now);
  if (Number(inserted.changes) > 0) {
    return input.definition;
  }

  const existing = db
    .prepare(
      `SELECT workflow_id, version, definition_json, content_hash
         FROM workflow_versions WHERE id = ?`,
    )
    .get(input.id);
  if (!existing) {
    throw new PersistenceError("not_found", `workflow version ${input.id} not found`);
  }
  const existingHash = requiredText(cell(existing, "content_hash"), "content_hash");
  const existingDefinition = requiredText(cell(existing, "definition_json"), "definition_json");
  if (existingHash === EMPTY_CONTENT_HASH && existingDefinition === "{}") {
    const promoted = db
      .prepare(
        `UPDATE workflow_versions
            SET workflow_id = ?, version = ?, definition_json = ?, content_hash = ?
          WHERE id = ? AND content_hash = ? AND definition_json = '{}'`,
      )
      .run(
        input.workflowId,
        input.version,
        definitionJson,
        contentHash,
        input.id,
        EMPTY_CONTENT_HASH,
      );
    if (Number(promoted.changes) > 0) {
      return input.definition;
    }
    return publishWorkflowVersion(db, input, now);
  }
  if (
    requiredText(cell(existing, "workflow_id"), "workflow_id") !== input.workflowId ||
    requiredInt(cell(existing, "version"), "version") !== input.version ||
    existingHash !== contentHash
  ) {
    throw new PersistenceError(
      "conflict",
      `workflow version ${input.id} is immutable and cannot be replaced`,
    );
  }
  return parseJson(existingDefinition, "definition_json");
}

export function readPublishedWorkflowVersion(db: DatabaseSync, id: string): unknown {
  const row = db
    .prepare("SELECT definition_json, content_hash FROM workflow_versions WHERE id = ?")
    .get(id);
  if (!row) {
    throw new PersistenceError("not_found", `workflow version ${id} not found`);
  }
  if (requiredText(cell(row, "content_hash"), "content_hash") === EMPTY_CONTENT_HASH) {
    throw new PersistenceError("not_found", `workflow version ${id} has no published graph`);
  }
  return parseJson(
    requiredText(cell(row, "definition_json"), "definition_json"),
    "definition_json",
  );
}

export function workflowContentHash(definition: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(definition)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function assertCas(changes: number | bigint, entity: string, id: string): void {
  if (Number(changes) === 0) {
    throw new PersistenceError("revision_conflict", `${entity} ${id} revision mismatch`);
  }
}
