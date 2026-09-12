import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";
import {
  parseAuthoringChangeSet,
  parseTeamDraft,
  parseWorkflowDraft,
  type AuthoringChangeSetDto,
  type AuthoringChangeSetStatus,
  type AuthoringChangeSetStepDto,
  type AuthoringChangeSetStepStatus,
  type TeamDraftDto,
  type WorkflowDraftDto,
} from "@workforce/protocol";

import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, optionalText, parseJson, requiredInt, requiredText } from "./sql.js";

/** Append-only, revision-CAS storage for un-published workflow drafts. */
export class SqliteWorkflowDraftRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): WorkflowDraftDto | null {
    const row = this.db.prepare("SELECT * FROM workflow_drafts WHERE id = ?").get(id);
    return row === undefined ? null : rowToWorkflowDraft(row);
  }

  listAll(): WorkflowDraftDto[] {
    return this.db
      .prepare("SELECT * FROM workflow_drafts ORDER BY workflow_id ASC, revision ASC")
      .all()
      .map(rowToWorkflowDraft);
  }

  listByWorkflow(workflowId: string): WorkflowDraftDto[] {
    return this.db
      .prepare("SELECT * FROM workflow_drafts WHERE workflow_id = ? ORDER BY revision ASC")
      .all(workflowId)
      .map(rowToWorkflowDraft);
  }

  append(tx: Tx, input: WorkflowDraftDto, expectedRevision: number): void {
    const draft = parseWorkflowDraft(input);
    const db = sqliteDbOf(tx);
    assertNextRevision(
      db,
      "workflow_drafts",
      "workflow_id",
      draft.workflowId,
      draft.revision,
      expectedRevision,
    );
    try {
      db.prepare(
        `INSERT INTO workflow_drafts (
           id, workflow_id, revision, status, graph_json, content_hash, updated_at, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        draft.id,
        draft.workflowId,
        draft.revision,
        draft.status,
        asJsonText(draft.graph),
        draft.contentHash,
        draft.updatedAt,
        draft.updatedBy,
      );
    } catch (error) {
      mapAuthoringWriteError(error, `workflow draft ${draft.id} already exists`);
    }
  }
}

/** Append-only, revision-CAS storage for un-published team drafts. */
export class SqliteTeamDraftRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): TeamDraftDto | null {
    const row = this.db.prepare("SELECT * FROM team_drafts WHERE id = ?").get(id);
    return row === undefined ? null : rowToTeamDraft(row);
  }

  listAll(): TeamDraftDto[] {
    return this.db
      .prepare("SELECT * FROM team_drafts ORDER BY team_id ASC, revision ASC")
      .all()
      .map(rowToTeamDraft);
  }

  listByTeam(teamId: string): TeamDraftDto[] {
    return this.db
      .prepare("SELECT * FROM team_drafts WHERE team_id = ? ORDER BY revision ASC")
      .all(teamId)
      .map(rowToTeamDraft);
  }

  append(tx: Tx, input: TeamDraftDto, expectedRevision: number): void {
    const draft = parseTeamDraft(input);
    const db = sqliteDbOf(tx);
    assertNextRevision(
      db,
      "team_drafts",
      "team_id",
      draft.teamId,
      draft.revision,
      expectedRevision,
    );
    try {
      db.prepare(
        `INSERT INTO team_drafts (
           id, team_id, revision, status, definition_json, content_hash, updated_at, updated_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        draft.id,
        draft.teamId,
        draft.revision,
        draft.status,
        asJsonText({ members: draft.members }),
        draft.contentHash,
        draft.updatedAt,
        draft.updatedBy,
      );
    } catch (error) {
      mapAuthoringWriteError(error, `team draft ${draft.id} already exists`);
    }
  }
}

export interface AuthoringStepUpdate {
  changeSetId: string;
  stepId: string;
  expectedStatus: AuthoringChangeSetStepStatus;
  status: AuthoringChangeSetStepStatus;
  resultRevision?: number;
  failure?: { code: string; message: string };
  startedAt?: string;
  completedAt?: string;
}

/** ChangeSets are created with all staged steps in the same transaction. */
export class SqliteAuthoringChangeSetRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): AuthoringChangeSetDto | null {
    const row = this.db.prepare("SELECT * FROM authoring_change_sets WHERE id = ?").get(id);
    return row === undefined ? null : this.rowToChangeSet(row);
  }

  listAll(): AuthoringChangeSetDto[] {
    return this.db
      .prepare("SELECT * FROM authoring_change_sets ORDER BY created_at ASC, id ASC")
      .all()
      .map((row) => this.rowToChangeSet(row));
  }

  listByProject(projectId: string): AuthoringChangeSetDto[] {
    return this.db
      .prepare(
        "SELECT * FROM authoring_change_sets WHERE project_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(projectId)
      .map((row) => this.rowToChangeSet(row));
  }

  insert(tx: Tx, input: AuthoringChangeSetDto): void {
    const changeSet = parseAuthoringChangeSet(input);
    const db = sqliteDbOf(tx);
    assertSourceRunBelongsToProject(db, changeSet);
    try {
      db.prepare(
        `INSERT INTO authoring_change_sets (
           id, organization_id, project_id, workflow_id, source_run_id, status, proposal_ref,
           created_at, updated_at, expires_at, failure_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        changeSet.id,
        changeSet.organizationId,
        changeSet.projectId,
        changeSet.workflowId ?? null,
        changeSet.sourceRunId,
        changeSet.status,
        changeSet.proposalRef,
        changeSet.createdAt,
        changeSet.updatedAt,
        changeSet.expiresAt ?? null,
        changeSet.failure === undefined ? null : asJsonText(changeSet.failure),
      );
      const insertStep = db.prepare(
        `INSERT INTO authoring_change_set_steps (
           id, change_set_id, ordinal, target_type, target_id, expected_revision, status,
           patch_ref, result_revision, failure_json, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const step of changeSet.steps) {
        insertStep.run(
          step.id,
          changeSet.id,
          step.ordinal,
          step.targetType,
          step.targetId,
          step.expectedRevision,
          step.status,
          step.patchRef,
          step.resultRevision ?? null,
          step.failure === undefined ? null : asJsonText(step.failure),
          step.startedAt ?? null,
          step.completedAt ?? null,
        );
      }
    } catch (error) {
      mapAuthoringWriteError(
        error,
        `authoring change set ${changeSet.id} already exists or conflicts`,
      );
    }
  }

  updateStatus(
    tx: Tx,
    id: string,
    expectedStatus: AuthoringChangeSetStatus,
    status: AuthoringChangeSetStatus,
    updatedAt: string,
    failure?: { code: string; message: string },
  ): void {
    const result = sqliteDbOf(tx)
      .prepare(
        `UPDATE authoring_change_sets
            SET status = ?, updated_at = ?, failure_json = ?
          WHERE id = ? AND status = ?`,
      )
      .run(
        status,
        updatedAt,
        failure === undefined ? null : asJsonText(failure),
        id,
        expectedStatus,
      );
    if (Number(result.changes) !== 1) {
      throw new PersistenceError("revision_conflict", `authoring change set ${id} status changed`);
    }
  }

  updateStep(tx: Tx, update: AuthoringStepUpdate): void {
    const result = sqliteDbOf(tx)
      .prepare(
        `UPDATE authoring_change_set_steps
            SET status = ?, result_revision = ?, failure_json = ?, started_at = ?, completed_at = ?
          WHERE id = ? AND change_set_id = ? AND status = ?`,
      )
      .run(
        update.status,
        update.resultRevision ?? null,
        update.failure === undefined ? null : asJsonText(update.failure),
        update.startedAt ?? null,
        update.completedAt ?? null,
        update.stepId,
        update.changeSetId,
        update.expectedStatus,
      );
    if (Number(result.changes) !== 1) {
      throw new PersistenceError(
        "revision_conflict",
        `authoring change-set step ${update.stepId} changed`,
      );
    }
  }

  private rowToChangeSet(row: Record<string, unknown>): AuthoringChangeSetDto {
    const id = requiredText(cell(row, "id"), "id");
    const steps = this.db
      .prepare(
        "SELECT * FROM authoring_change_set_steps WHERE change_set_id = ? ORDER BY ordinal ASC",
      )
      .all(id)
      .map(rowToChangeSetStep);
    return parseAuthoringChangeSet({
      id,
      organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
      projectId: requiredText(cell(row, "project_id"), "project_id"),
      ...(optionalText(cell(row, "workflow_id")) === null
        ? {}
        : { workflowId: optionalText(cell(row, "workflow_id")) }),
      sourceRunId: requiredText(cell(row, "source_run_id"), "source_run_id"),
      status: requiredText(cell(row, "status"), "status"),
      proposalRef: requiredText(cell(row, "proposal_ref"), "proposal_ref"),
      steps,
      createdAt: requiredText(cell(row, "created_at"), "created_at"),
      updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
      ...(optionalText(cell(row, "expires_at")) === null
        ? {}
        : { expiresAt: optionalText(cell(row, "expires_at")) }),
      ...optionalFailure(cell(row, "failure_json")),
    });
  }
}

function assertNextRevision(
  db: DatabaseSync,
  table: "workflow_drafts" | "team_drafts",
  ownerColumn: "workflow_id" | "team_id",
  ownerId: string,
  revision: number,
  expectedRevision: number,
): void {
  const row = db
    .prepare(`SELECT COALESCE(MAX(revision), 0) AS revision FROM ${table} WHERE ${ownerColumn} = ?`)
    .get(ownerId) as Record<string, unknown>;
  const current = requiredInt(cell(row, "revision"), "revision");
  if (current !== expectedRevision || revision !== current + 1) {
    throw new PersistenceError("revision_conflict", `${table} ${ownerId} revision changed`);
  }
}

function assertSourceRunBelongsToProject(db: DatabaseSync, changeSet: AuthoringChangeSetDto): void {
  const row = db
    .prepare(
      `SELECT p.organization_id AS organization_id, t.project_id AS project_id
         FROM runs r
         INNER JOIN tasks t ON t.id = r.task_id
         INNER JOIN projects p ON p.id = t.project_id
        WHERE r.id = ?`,
    )
    .get(changeSet.sourceRunId) as Record<string, unknown> | undefined;
  if (
    row === undefined ||
    requiredText(cell(row, "organization_id"), "organization_id") !== changeSet.organizationId ||
    requiredText(cell(row, "project_id"), "project_id") !== changeSet.projectId
  ) {
    throw new PersistenceError(
      "constraint",
      "authoring source run must belong to the same project",
    );
  }
}

function rowToWorkflowDraft(row: Record<string, unknown>): WorkflowDraftDto {
  return parseWorkflowDraft({
    id: requiredText(cell(row, "id"), "id"),
    workflowId: requiredText(cell(row, "workflow_id"), "workflow_id"),
    revision: requiredInt(cell(row, "revision"), "revision"),
    status: requiredText(cell(row, "status"), "status"),
    graph: parseJson(cell(row, "graph_json"), "graph_json"),
    contentHash: requiredText(cell(row, "content_hash"), "content_hash"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
    updatedBy: requiredText(cell(row, "updated_by"), "updated_by"),
  });
}

function rowToTeamDraft(row: Record<string, unknown>): TeamDraftDto {
  const definition = parseJson(cell(row, "definition_json"), "definition_json") as {
    members?: unknown;
  };
  return parseTeamDraft({
    id: requiredText(cell(row, "id"), "id"),
    teamId: requiredText(cell(row, "team_id"), "team_id"),
    revision: requiredInt(cell(row, "revision"), "revision"),
    status: requiredText(cell(row, "status"), "status"),
    members: definition.members,
    contentHash: requiredText(cell(row, "content_hash"), "content_hash"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
    updatedBy: requiredText(cell(row, "updated_by"), "updated_by"),
  });
}

function rowToChangeSetStep(row: Record<string, unknown>): AuthoringChangeSetStepDto {
  return {
    id: requiredText(cell(row, "id"), "id"),
    ordinal: requiredInt(cell(row, "ordinal"), "ordinal"),
    targetType: requiredText(
      cell(row, "target_type"),
      "target_type",
    ) as AuthoringChangeSetStepDto["targetType"],
    targetId: requiredText(cell(row, "target_id"), "target_id"),
    expectedRevision: requiredInt(cell(row, "expected_revision"), "expected_revision"),
    status: requiredText(cell(row, "status"), "status") as AuthoringChangeSetStepDto["status"],
    patchRef: requiredText(cell(row, "patch_ref"), "patch_ref"),
    ...optionalIntRecord(row, "result_revision"),
    ...optionalFailure(cell(row, "failure_json")),
    ...optionalDate(row, "started_at", "startedAt"),
    ...optionalDate(row, "completed_at", "completedAt"),
  };
}

function optionalIntRecord(
  row: Record<string, unknown>,
  column: string,
): { resultRevision?: number } {
  const value = cell(row, column);
  return value === null || value === undefined
    ? {}
    : { resultRevision: requiredInt(value, column) };
}

function optionalDate(
  row: Record<string, unknown>,
  column: string,
  key: "startedAt" | "completedAt",
): { startedAt?: string; completedAt?: string } {
  const value = optionalText(cell(row, column));
  return value === null ? {} : { [key]: value };
}

function optionalFailure(value: unknown): { failure?: { code: string; message: string } } {
  if (value === null || value === undefined) {
    return {};
  }
  return {
    failure: parseJson(value as ReturnType<typeof cell>, "failure_json") as {
      code: string;
      message: string;
    },
  };
}

function mapAuthoringWriteError(error: unknown, message: string): never {
  if (isConstraintError(error)) {
    throw new PersistenceError("conflict", message);
  }
  throw error;
}
