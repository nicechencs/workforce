import type { DatabaseSync } from "node:sqlite";

import type {
  AuthoringTaskPatch,
  AuthoringTaskPatchRepository,
  AuthoringTaskPatchTarget,
  TaskRecord,
  Tx,
} from "@workforce/application";

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

export class SqliteTaskRepository implements AuthoringTaskPatchRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): TaskRecord | null {
    return this.loadTask(this.db, id);
  }

  getInTransaction(tx: Tx, taskId: string): AuthoringTaskPatchTarget | null {
    const db = sqliteDbOf(tx);
    const row = db
      .prepare("SELECT id, project_id, definition_revision FROM tasks WHERE id = ?")
      .get(taskId);
    if (!row) {
      return null;
    }
    return {
      id: requiredText(cell(row, "id"), "id"),
      projectId: requiredText(cell(row, "project_id"), "project_id"),
      definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    };
  }

  listByProject(projectId: string): TaskRecord[] {
    return this.db
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(projectId)
      .map((row) => this.withNormalizedDependencies(this.db, rowToTask(row)));
  }

  listAll(): TaskRecord[] {
    return this.db
      .prepare(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY created_at ASC, id ASC`)
      .all()
      .map((row) => this.withNormalizedDependencies(this.db, rowToTask(row)));
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

  /**
   * Same-transaction CAS for Chat Task confirmation. Reads the live
   * `definition_revision`, applies a partial patch through the existing
   * `update` columns, and fail-closes on revision mismatch. Does not publish
   * or start a Run.
   */
  applyInTransaction(
    tx: Tx,
    input: {
      taskId: string;
      expectedRevision: number;
      patch: AuthoringTaskPatch;
      at: string;
    },
  ): AuthoringTaskPatchTarget {
    if (input.patch.taskId !== input.taskId) {
      throw new PersistenceError(
        "constraint",
        `task patch ${input.patch.taskId} does not match ${input.taskId}`,
      );
    }
    const current = this.loadTask(sqliteDbOf(tx), input.taskId);
    if (current === null) {
      throw new PersistenceError("not_found", `task ${input.taskId} was not found`);
    }
    if (
      current.definitionRevision !== input.expectedRevision ||
      input.patch.revision !== input.expectedRevision + 1
    ) {
      throw new PersistenceError("revision_conflict", `task ${input.taskId} revision mismatch`);
    }
    const next = applyAuthoringPatch(current, input.patch, input.at);
    this.update(tx, next, current.stateRevision);
    if (input.patch.dependsOn !== undefined) {
      this.syncDependencies(tx, [next], input.at);
    }
    return {
      id: next.id,
      projectId: next.projectId,
      definitionRevision: next.definitionRevision,
    };
  }

  /**
   * Keep the normalized dependency projection in the same transaction as the
   * Task snapshot. It deliberately runs after every Task row has been
   * inserted/updated so a graph whose nodes are not topologically ordered
   * cannot violate the dependency foreign keys.
   */
  syncDependencies(tx: Tx, tasks: readonly TaskRecord[], createdAt: string): void {
    const db = sqliteDbOf(tx);
    const deleteForTask = db.prepare("DELETE FROM task_dependencies WHERE task_id = ?");
    const insert = db.prepare(
      `INSERT INTO task_dependencies (
         task_id, depends_on_task_id, condition, required_status, created_at
       ) VALUES (?, ?, NULL, ?, ?)`,
    );
    for (const task of tasks) {
      deleteForTask.run(task.id);
      const seen = new Set<string>();
      for (const dependency of task.dependsOn) {
        if (dependency.taskId === task.id) {
          throw new PersistenceError("constraint", `task ${task.id} cannot depend on itself`);
        }
        if (seen.has(dependency.taskId)) {
          throw new PersistenceError(
            "constraint",
            `task ${task.id} has duplicate dependency ${dependency.taskId}`,
          );
        }
        seen.add(dependency.taskId);
        insert.run(task.id, dependency.taskId, dependency.waitFor, createdAt);
      }
    }
  }

  private loadTask(db: DatabaseSync, id: string): TaskRecord | null {
    const row = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id);
    return row ? this.withNormalizedDependencies(db, rowToTask(row)) : null;
  }

  private withNormalizedDependencies(db: DatabaseSync, task: TaskRecord): TaskRecord {
    const rows = db
      .prepare(
        `SELECT depends_on_task_id, required_status
           FROM task_dependencies
          WHERE task_id = ?
          ORDER BY depends_on_task_id ASC`,
      )
      .all(task.id) as Record<string, unknown>[];
    // Existing M3 databases can have only depends_on_json until their first
    // current snapshot write. Keep that read compatibility; after a synced
    // row exists, the normalized table is the restart authority.
    if (rows.length === 0) {
      return task;
    }
    return {
      ...task,
      dependsOn: rows.map((row) => {
        const waitFor = requiredText(cell(row, "required_status"), "required_status");
        if (waitFor !== "outputs_ready" && waitFor !== "completed") {
          throw new PersistenceError(
            "constraint",
            `task dependency ${task.id} has unsupported required_status ${waitFor}`,
          );
        }
        return {
          taskId: requiredText(cell(row, "depends_on_task_id"), "depends_on_task_id"),
          waitFor,
        };
      }),
    };
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
    expectedOutputs: asExpectedOutputs(
      parseJson(cell(row, "expected_outputs_json"), "expected_outputs_json"),
    ),
    outputBindings: asStringRecord(
      parseJson(cell(row, "output_bindings_json"), "output_bindings_json"),
    ),
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

function applyAuthoringPatch(
  current: TaskRecord,
  patch: AuthoringTaskPatch,
  at: string,
): TaskRecord {
  return {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.requiresReview !== undefined ? { requiresReview: patch.requiresReview } : {}),
    ...(patch.expectedOutputs !== undefined ? { expectedOutputs: [...patch.expectedOutputs] } : {}),
    ...(patch.dependsOn !== undefined ? { dependsOn: [...patch.dependsOn] } : {}),
    ...(patch.maxAttempts !== undefined ? { maxAttempts: patch.maxAttempts } : {}),
    ...(patch.maxReworkCycles !== undefined ? { maxReworkCycles: patch.maxReworkCycles } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    definitionRevision: patch.revision,
    updatedAt: at,
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
