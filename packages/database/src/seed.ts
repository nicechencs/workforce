import type { DatabaseSync } from "node:sqlite";

export interface SeededGraph {
  organizationId: string;
  projectId: string;
  taskId: string;
}

export function seedMinimalGraph(db: DatabaseSync, ids: SeededGraph, now: string): void {
  db.prepare(
    `INSERT INTO organizations (id, name, slug, settings_json, created_at, updated_at)
     VALUES (?, 'Local', ?, '{}', ?, ?)`,
  ).run(ids.organizationId, `slug-${ids.organizationId}`, now, now);
  db.prepare(
    `INSERT INTO projects (
       id, organization_id, name, objective, status, state_revision, created_at, updated_at
     ) VALUES (?, ?, 'Test project', 'objective', 'draft', 1, ?, ?)`,
  ).run(ids.projectId, ids.organizationId, now, now);
  db.prepare(
    `INSERT INTO tasks (
       id, organization_id, project_id, title, objective, status, state_revision,
       definition_revision, generation, attempt, protocol_version, created_at, updated_at
     ) VALUES (?, ?, ?, 'Task', 'objective', 'queued', 1, 1, 1, 1, '0.1', ?, ?)`,
  ).run(ids.taskId, ids.organizationId, ids.projectId, now, now);
}
