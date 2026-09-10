import type { DatabaseSync } from "node:sqlite";

import type { TaskRecord, Tx } from "@workforce/application";

import { assertCas, organizationIdOfProject } from "./ensure.js";
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

const TASK_COLUMNS = `
  id, project_id, workflow_instance_id, workflow_node_id, role, title, status,
  state_revision, definition_revision, generation, attempt, max_attempts,
  max_rework_cycles, priority, requires_review, expected_outputs_json,
  output_bindings_json, depends_on_json, input_artifact_version_ids_json,
  next_attempt_at, created_at, updated_at
`;

const PROTOCOL_VERSION = "0.1";

export class SqliteTaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): TaskRecord | null {
    const row = this.db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id);
    return row ? rowToTask(row) : null;
  }

  listByProject(projectId: string): TaskRecord[] {
    return this.db
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(projectId)
      .map(rowToTask);
  }

  listAll(): TaskRecord[] {
    return this.db
      .prepare(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY created_at ASC, id ASC`)
      .all()
      .map(rowToTask);
  }

  insert(tx: Tx, record: TaskRecord): void {
    const db = sqliteDbOf(tx);
    const organizationId = organizationIdOfProject(db, record.projectId);
    try {
      db.prepare(
        `INSERT INTO tasks (
           id, organization_id, project_id, workflow_instance_id, workflow_node_id,
           title, objective, status, state_revision, definition_revision, generation,
           attempt, priority, protocol_version, created_at, updated_at, role,
           max_attempts, max_rework_cycles, requires_review, expected_outputs_json,
           output_bindings_json, depends_on_json, input_artifact_version_ids_json,
           next_attempt_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        organizationId,
        record.projectId,
        record.workflowInstanceId ?? null,
        record.workflowNodeId ?? null,
        record.title,
        record.title,
        record.status,
        record.stateRevision,
        record.definitionRevision,
        record.generation,
        record.attempt,
        record.priority,
        PROTOCOL_VERSION,
        record.createdAt,
        record.updatedAt,
        record.role,
        record.maxAttempts,
        record.maxReworkCycles,
        record.requiresReview ? 1 : 0,
        asJsonText(record.expectedOutputs),
        asJsonText(record.outputBindings),
        asJsonText(record.dependsOn),
        asJsonText(record.inputArtifactVersionIds),
        record.nextAttemptAt ?? null,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `task ${record.id} already exists`);
      }
      throw error;
    }
  }

  update(tx: Tx, record: TaskRecord, expectedStateRevision: number): void {
    const db = sqliteDbOf(tx);
    const result = db
      .prepare(
        `UPDATE tasks
            SET workflow_instance_id = ?,
                workflow_node_id = ?,
                title = ?,
                objective = ?,
                status = ?,
                state_revision = ?,
                definition_revision = ?,
                generation = ?,
                attempt = ?,
                priority = ?,
                updated_at = ?,
                role = ?,
                max_attempts = ?,
                max_rework_cycles = ?,
                requires_review = ?,
                expected_outputs_json = ?,
                output_bindings_json = ?,
                depends_on_json = ?,
                input_artifact_version_ids_json = ?,
                next_attempt_at = ?
          WHERE id = ? AND state_revision = ?`,
      )
      .run(
        record.workflowInstanceId ?? null,
        record.workflowNodeId ?? null,
        record.title,
        record.title,
        record.status,
        record.stateRevision,
        record.definitionRevision,
        record.generation,
        record.attempt,
        record.priority,
        record.updatedAt,
        record.role,
        record.maxAttempts,
        record.maxReworkCycles,
        record.requiresReview ? 1 : 0,
        asJsonText(record.expectedOutputs),
        asJsonText(record.outputBindings),
        asJsonText(record.dependsOn),
        asJsonText(record.inputArtifactVersionIds),
        record.nextAttemptAt ?? null,
        record.id,
        expectedStateRevision,
      );
    assertCas(result.changes, "task", record.id);
  }
}

function rowToTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    role: (optionalText(cell(row, "role")) ?? "developer") as TaskRecord["role"],
    title: requiredText(cell(row, "title"), "title"),
    status: requiredText(cell(row, "status"), "status") as TaskRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    generation: requiredInt(cell(row, "generation"), "generation"),
    attempt: requiredInt(cell(row, "attempt"), "attempt"),
    maxAttempts: requiredInt(cell(row, "max_attempts"), "max_attempts"),
    maxReworkCycles: requiredInt(cell(row, "max_rework_cycles"), "max_rework_cycles"),
    priority: requiredInt(cell(row, "priority"), "priority"),
    requiresReview: requiredInt(cell(row, "requires_review"), "requires_review") !== 0,
    expectedOutputs: asExpectedOutputs(parseJson(cell(row, "expected_outputs_json"), "expected_outputs_json")),
    outputBindings: asStringRecord(parseJson(cell(row, "output_bindings_json"), "output_bindings_json")),
    dependsOn: asDependsOn(parseJson(cell(row, "depends_on_json"), "depends_on_json")),
    inputArtifactVersionIds: asStringArray(
      parseJson(cell(row, "input_artifact_version_ids_json"), "input_artifact_version_ids_json"),
    ),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
    ...ifPresent("workflowInstanceId", optionalText(cell(row, "workflow_instance_id"))),
    ...ifPresent("workflowNodeId", optionalText(cell(row, "workflow_node_id"))),
    ...ifPresent("nextAttemptAt", optionalText(cell(row, "next_attempt_at"))),
  };
}

function asExpectedOutputs(value: unknown): TaskRecord["expectedOutputs"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as TaskRecord["expectedOutputs"];
}

function asDependsOn(value: unknown): TaskRecord["dependsOn"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as TaskRecord["dependsOn"];
}

function asStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") {
      record[key] = item;
    }
  }
  return record;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
