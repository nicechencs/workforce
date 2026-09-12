import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";

import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { cell, optionalInt, optionalText, parseJson, requiredInt, requiredText } from "./sql.js";

export type AuthoringMessageRole = "user" | "system" | "authoring_agent";
export type AuthoringSessionStatus = "open" | "failed" | "closed";
export type AuthoringTurnStatus =
  | "accepted"
  | "running"
  | "awaiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled"
  | "closed";
export type AuthoringProposalStatus = "proposed" | "confirmed" | "rejected" | "failed";

export interface AuthoringProjectRecord {
  id: string;
  organizationId: string;
}

export interface AuthoringSourceRunRecord {
  id: string;
  projectId: string;
  organizationId: string;
}

export interface AuthoringSessionRecord {
  id: string;
  organizationId: string;
  projectId: string;
  protocolVersion: string;
  status: AuthoringSessionStatus;
  stateRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringMessageRecord {
  id: string;
  sessionId: string;
  role: AuthoringMessageRole;
  contentRef: string | null;
  contentHash: string;
  redactedPreview: string | null;
  retentionUntil: string | null;
  createdAt: string;
}

export interface CreateAuthoringMessageInput {
  id: string;
  sessionId: string;
  role: AuthoringMessageRole;
  contentRef?: string;
  contentHash: string;
  redactedPreview?: string;
  retentionUntil?: string;
  createdAt: string;
}

export interface AuthoringTurnRecord {
  id: string;
  sessionId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  protocolVersion: string;
  status: AuthoringTurnStatus;
  stateRevision: number;
  taskId: string | null;
  runId: string | null;
  proposalId: string | null;
  changeSetId: string | null;
  workflowDraftId: string | null;
  patchRefs: string[];
  completedOperationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAuthoringTurnInput {
  id: string;
  sessionId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  protocolVersion: string;
  status: AuthoringTurnStatus;
  stateRevision?: number;
  taskId?: string;
  runId?: string;
  proposalId?: string;
  changeSetId?: string;
  workflowDraftId?: string;
  patchRefs?: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringProposalTargetInput {
  ordinal: number;
  targetType: "team" | "task" | "workflow";
  operation: "create" | "update";
  targetId?: string;
  expectedRevision?: number;
  patchRef: string;
}

export interface AuthoringProposalRecord {
  id: string;
  sessionId: string;
  turnId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  proposalRef: string;
  proposalHash: string;
  redactedPreview: string | null;
  status: AuthoringProposalStatus;
  stateRevision: number;
  targets: AuthoringProposalTargetInput[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAuthoringProposalInput {
  id: string;
  sessionId: string;
  turnId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  proposalRef: string;
  proposalHash: string;
  redactedPreview?: string;
  status?: AuthoringProposalStatus;
  stateRevision?: number;
  targets: readonly AuthoringProposalTargetInput[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringChatPatchBinding {
  patchRef: string;
  organizationId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  sourceRunId: string;
}

export interface CompleteAuthoringTurnInput {
  turnId: string;
  expectedStateRevision: number;
  idempotencyKey: string;
  proposalId?: string;
  changeSetId?: string;
  workflowDraftId?: string;
  at: string;
}

export class SqliteAuthoringProjectRepository {
  constructor(_db: DatabaseSync) {}

  getInTransaction(tx: Tx, projectId: string): AuthoringProjectRecord | null {
    const row = sqliteDbOf(tx)
      .prepare("SELECT id, organization_id FROM projects WHERE id = ?")
      .get(projectId);
    return row ? rowToProject(row) : null;
  }
}

/** Resolves a Run through its Task so project and organization are authoritative. */
export class SqliteAuthoringSourceRunRepository {
  constructor(_db: DatabaseSync) {}

  getInTransaction(tx: Tx, sourceRunId: string): AuthoringSourceRunRecord | null {
    const row = sqliteDbOf(tx)
      .prepare(
        `SELECT r.id, t.project_id, p.organization_id
           FROM runs r
           INNER JOIN tasks t ON t.id = r.task_id
           INNER JOIN projects p ON p.id = t.project_id
          WHERE r.id = ?`,
      )
      .get(sourceRunId);
    return row ? rowToSourceRun(row) : null;
  }
}

export class SqliteAuthoringSessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  getInTransaction(tx: Tx, sessionId: string): AuthoringSessionRecord | null {
    const row = sqliteDbOf(tx)
      .prepare(
        `SELECT id, organization_id, project_id, protocol_version, status,
                state_revision, created_at, updated_at
           FROM authoring_sessions WHERE id = ?`,
      )
      .get(sessionId);
    return row ? rowToSession(row) : null;
  }

  loadInTransaction(tx: Tx, sessionId: string): AuthoringSessionRecord | null {
    return this.getInTransaction(tx, sessionId);
  }

  get(sessionId: string): AuthoringSessionRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, organization_id, project_id, protocol_version, status,
                state_revision, created_at, updated_at
           FROM authoring_sessions WHERE id = ?`,
      )
      .get(sessionId);
    return row ? rowToSession(row) : null;
  }

  create(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      projectId: string;
      protocolVersion: string;
      status?: AuthoringSessionStatus;
      stateRevision?: number;
      createdAt: string;
      updatedAt: string;
    },
  ): void {
    assertProjectOrganization(tx, input.projectId, input.organizationId);
    try {
      sqliteDbOf(tx)
        .prepare(
          `INSERT INTO authoring_sessions (
             id, organization_id, project_id, protocol_version, status,
             state_revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.organizationId,
          input.projectId,
          input.protocolVersion,
          input.status ?? "open",
          input.stateRevision ?? 1,
          input.createdAt,
          input.updatedAt,
        );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `authoring session ${input.id} already exists`);
      }
      throw error;
    }
  }

  addMessage(tx: Tx, input: CreateAuthoringMessageInput): void {
    const session = this.getInTransaction(tx, input.sessionId);
    if (!session) {
      throw new PersistenceError("not_found", `authoring session ${input.sessionId} not found`);
    }
    if (!input.contentRef && !input.redactedPreview) {
      throw new PersistenceError(
        "constraint",
        "authoring message requires contentRef or redactedPreview",
      );
    }
    try {
      sqliteDbOf(tx)
        .prepare(
          `INSERT INTO authoring_messages (
             id, session_id, role, content_ref, content_hash,
             redacted_preview, retention_until, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.sessionId,
          input.role,
          input.contentRef ?? null,
          input.contentHash,
          input.redactedPreview ?? null,
          input.retentionUntil ?? null,
          input.createdAt,
        );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `authoring message ${input.id} already exists`);
      }
      throw error;
    }
  }

  getMessageInTransaction(tx: Tx, messageId: string): AuthoringMessageRecord | null {
    const row = sqliteDbOf(tx)
      .prepare(
        `SELECT id, session_id, role, content_ref, content_hash,
                redacted_preview, retention_until, created_at
           FROM authoring_messages WHERE id = ?`,
      )
      .get(messageId);
    return row ? rowToMessage(row) : null;
  }
}

/** Dedicated message surface; the session repository keeps the same operation for convenience. */
export class SqliteAuthoringMessageRepository {
  private readonly sessions: SqliteAuthoringSessionRepository;

  constructor(private readonly db: DatabaseSync) {
    this.sessions = new SqliteAuthoringSessionRepository(db);
  }

  create(tx: Tx, input: CreateAuthoringMessageInput): void {
    this.sessions.addMessage(tx, input);
  }

  add(tx: Tx, input: CreateAuthoringMessageInput): void {
    this.create(tx, input);
  }

  getInTransaction(tx: Tx, messageId: string): AuthoringMessageRecord | null {
    return this.sessions.getMessageInTransaction(tx, messageId);
  }

  get(messageId: string): AuthoringMessageRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, role, content_ref, content_hash,
                redacted_preview, retention_until, created_at
           FROM authoring_messages WHERE id = ?`,
      )
      .get(messageId);
    return row ? rowToMessage(row) : null;
  }
}

export class SqliteAuthoringTurnRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sessions = new SqliteAuthoringSessionRepository(db),
    private readonly sourceRuns = new SqliteAuthoringSourceRunRepository(db),
  ) {}

  getInTransaction(tx: Tx, turnId: string): AuthoringTurnRecord | null {
    const row = sqliteDbOf(tx)
      .prepare(
        `SELECT id, session_id, organization_id, project_id, source_run_id,
                protocol_version, status, state_revision, task_id, run_id,
                proposal_id, change_set_id, workflow_draft_id, patch_refs_json,
                completed_operation_id, created_at, updated_at
           FROM authoring_turns WHERE id = ?`,
      )
      .get(turnId);
    return row ? rowToTurn(row) : null;
  }

  loadInTransaction(tx: Tx, turnId: string): AuthoringTurnRecord | null {
    return this.getInTransaction(tx, turnId);
  }

  get(turnId: string): AuthoringTurnRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, organization_id, project_id, source_run_id,
                protocol_version, status, state_revision, task_id, run_id,
                proposal_id, change_set_id, workflow_draft_id, patch_refs_json,
                completed_operation_id, created_at, updated_at
           FROM authoring_turns WHERE id = ?`,
      )
      .get(turnId);
    return row ? rowToTurn(row) : null;
  }

  create(tx: Tx, input: CreateAuthoringTurnInput): void {
    const session = this.sessions.getInTransaction(tx, input.sessionId);
    if (!session) {
      throw new PersistenceError("not_found", `authoring session ${input.sessionId} not found`);
    }
    assertBinding(session.organizationId, session.projectId, input.organizationId, input.projectId);
    const sourceRun = this.sourceRuns.getInTransaction(tx, input.sourceRunId);
    if (!sourceRun) {
      throw new PersistenceError("not_found", `source run ${input.sourceRunId} not found`);
    }
    assertBinding(
      input.organizationId,
      input.projectId,
      sourceRun.organizationId,
      sourceRun.projectId,
    );
    const patchRefs = [...new Set(input.patchRefs ?? [])];
    try {
      sqliteDbOf(tx)
        .prepare(
          `INSERT INTO authoring_turns (
             id, session_id, organization_id, project_id, source_run_id,
             protocol_version, status, state_revision, task_id, run_id,
             proposal_id, change_set_id, workflow_draft_id, patch_refs_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.sessionId,
          input.organizationId,
          input.projectId,
          input.sourceRunId,
          input.protocolVersion,
          input.status,
          input.stateRevision ?? 1,
          input.taskId ?? null,
          input.runId ?? null,
          input.proposalId ?? null,
          input.changeSetId ?? null,
          input.workflowDraftId ?? null,
          JSON.stringify(patchRefs),
          input.createdAt,
          input.updatedAt,
        );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `authoring turn ${input.id} already exists`);
      }
      throw error;
    }
  }

  /** CAS completion. A completed turn is idempotent only for the same key. */
  complete(tx: Tx, input: CompleteAuthoringTurnInput): AuthoringTurnRecord {
    const db = sqliteDbOf(tx);
    const current = this.getInTransaction(tx, input.turnId);
    if (!current) {
      throw new PersistenceError("not_found", `authoring turn ${input.turnId} not found`);
    }
    if (current.status === "completed") {
      if (current.completedOperationId === input.idempotencyKey) {
        return current;
      }
      throw new PersistenceError("conflict", `authoring turn ${input.turnId} already completed`);
    }
    if (
      !(["accepted", "running", "awaiting_confirmation"] as AuthoringTurnStatus[]).includes(
        current.status,
      )
    ) {
      throw new PersistenceError("constraint", `authoring turn ${input.turnId} is not confirmable`);
    }
    if (input.proposalId !== undefined) {
      const proposal = db
        .prepare("SELECT turn_id FROM authoring_proposals WHERE id = ?")
        .get(input.proposalId);
      if (!proposal || requiredText(cell(proposal, "turn_id"), "turn_id") !== input.turnId) {
        throw new PersistenceError("constraint", "authoring completion proposal binding mismatch");
      }
    }
    const changed = db
      .prepare(
        `UPDATE authoring_turns
            SET status = 'completed',
                state_revision = state_revision + 1,
                proposal_id = COALESCE(?, proposal_id),
                change_set_id = COALESCE(?, change_set_id),
                workflow_draft_id = COALESCE(?, workflow_draft_id),
                completed_operation_id = ?,
                updated_at = ?
          WHERE id = ? AND state_revision = ?
            AND status <> 'completed'
            AND completed_operation_id IS NULL`,
      )
      .run(
        input.proposalId ?? null,
        input.changeSetId ?? null,
        input.workflowDraftId ?? null,
        input.idempotencyKey,
        input.at,
        input.turnId,
        input.expectedStateRevision,
      );
    if (Number(changed.changes) === 0) {
      const latest = this.getInTransaction(tx, input.turnId);
      if (latest?.status === "completed" && latest.completedOperationId === input.idempotencyKey) {
        return latest;
      }
      throw new PersistenceError(
        "revision_conflict",
        `authoring turn ${input.turnId} revision mismatch`,
      );
    }
    return this.getInTransaction(tx, input.turnId)!;
  }

  completeInTransaction(tx: Tx, input: CompleteAuthoringTurnInput): AuthoringTurnRecord {
    return this.complete(tx, input);
  }
}

export class SqliteAuthoringProposalRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sessions = new SqliteAuthoringSessionRepository(db),
    private readonly turns = new SqliteAuthoringTurnRepository(db, sessions),
    private readonly sourceRuns = new SqliteAuthoringSourceRunRepository(db),
  ) {}

  create(tx: Tx, input: CreateAuthoringProposalInput): void {
    const session = this.sessions.getInTransaction(tx, input.sessionId);
    const turn = this.turns.getInTransaction(tx, input.turnId);
    const sourceRun = this.sourceRuns.getInTransaction(tx, input.sourceRunId);
    if (!session || !turn || !sourceRun) {
      throw new PersistenceError("not_found", "authoring proposal binding source not found");
    }
    assertBinding(session.organizationId, session.projectId, input.organizationId, input.projectId);
    assertBinding(turn.organizationId, turn.projectId, input.organizationId, input.projectId);
    if (turn.sessionId !== input.sessionId || turn.sourceRunId !== input.sourceRunId) {
      throw new PersistenceError("constraint", "authoring proposal turn binding mismatch");
    }
    assertBinding(
      input.organizationId,
      input.projectId,
      sourceRun.organizationId,
      sourceRun.projectId,
    );
    validateTargets(input.targets);
    const db = sqliteDbOf(tx);
    try {
      db.prepare(
        `INSERT INTO authoring_proposals (
           id, session_id, turn_id, organization_id, project_id, source_run_id,
           proposal_ref, proposal_hash, redacted_preview, status, state_revision,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.sessionId,
        input.turnId,
        input.organizationId,
        input.projectId,
        input.sourceRunId,
        input.proposalRef,
        input.proposalHash,
        input.redactedPreview ?? null,
        input.status ?? "proposed",
        input.stateRevision ?? 1,
        input.createdAt,
        input.updatedAt,
      );
      const insertTarget = db.prepare(
        `INSERT INTO authoring_proposal_targets (
           proposal_id, ordinal, target_type, operation, target_id,
           expected_revision, patch_ref
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const target of input.targets) {
        insertTarget.run(
          input.id,
          target.ordinal,
          target.targetType,
          target.operation,
          target.targetId ?? null,
          target.expectedRevision ?? null,
          target.patchRef,
        );
      }
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `authoring proposal ${input.id} already exists`);
      }
      throw error;
    }
  }

  getInTransaction(tx: Tx, proposalId: string): AuthoringProposalRecord | null {
    const db = sqliteDbOf(tx);
    const row = db
      .prepare(
        `SELECT id, session_id, turn_id, organization_id, project_id, source_run_id,
                proposal_ref, proposal_hash, redacted_preview, status, state_revision,
                created_at, updated_at
           FROM authoring_proposals WHERE id = ?`,
      )
      .get(proposalId);
    if (!row) return null;
    const targets = db
      .prepare(
        `SELECT ordinal, target_type, operation, target_id, expected_revision, patch_ref
           FROM authoring_proposal_targets WHERE proposal_id = ? ORDER BY ordinal ASC`,
      )
      .all(proposalId)
      .map(rowToTarget);
    return rowToProposal(row, targets);
  }

  loadInTransaction(tx: Tx, proposalId: string): AuthoringProposalRecord | null {
    return this.getInTransaction(tx, proposalId);
  }

  get(proposalId: string): AuthoringProposalRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, turn_id, organization_id, project_id, source_run_id,
                proposal_ref, proposal_hash, redacted_preview, status, state_revision,
                created_at, updated_at
           FROM authoring_proposals WHERE id = ?`,
      )
      .get(proposalId);
    if (!row) return null;
    const targets = this.db
      .prepare(
        `SELECT ordinal, target_type, operation, target_id, expected_revision, patch_ref
           FROM authoring_proposal_targets WHERE proposal_id = ? ORDER BY ordinal ASC`,
      )
      .all(proposalId)
      .map(rowToTarget);
    return rowToProposal(row, targets);
  }

  getPatchBindingInTransaction(tx: Tx, patchRef: string): AuthoringChatPatchBinding | null {
    const row = sqliteDbOf(tx)
      .prepare(
        `SELECT p.id AS proposal_id, p.organization_id, p.project_id,
                p.session_id, p.turn_id, p.source_run_id, t.patch_ref
           FROM authoring_proposal_targets t
           INNER JOIN authoring_proposals p ON p.id = t.proposal_id
          WHERE t.patch_ref = ?`,
      )
      .get(patchRef);
    if (!row) return null;
    return {
      patchRef: requiredText(cell(row, "patch_ref"), "patch_ref"),
      organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
      projectId: requiredText(cell(row, "project_id"), "project_id"),
      sessionId: requiredText(cell(row, "session_id"), "session_id"),
      turnId: requiredText(cell(row, "turn_id"), "turn_id"),
      sourceRunId: requiredText(cell(row, "source_run_id"), "source_run_id"),
    };
  }
}

/** Adapter matching ConfirmChatProposalDeps.patch repository shape. */
export class SqliteAuthoringChatPatchRepository {
  constructor(private readonly proposals: SqliteAuthoringProposalRepository) {}

  getInTransaction(tx: Tx, patchRef: string): AuthoringChatPatchBinding | null {
    return this.proposals.getPatchBindingInTransaction(tx, patchRef);
  }
}

function assertProjectOrganization(tx: Tx, projectId: string, organizationId: string): void {
  const row = sqliteDbOf(tx)
    .prepare("SELECT organization_id FROM projects WHERE id = ?")
    .get(projectId);
  if (!row) throw new PersistenceError("not_found", `project ${projectId} not found`);
  const actual = requiredText(cell(row, "organization_id"), "organization_id");
  if (actual !== organizationId) {
    throw new PersistenceError("constraint", `project ${projectId} is outside organization scope`);
  }
}

function assertBinding(
  expectedOrganizationId: string,
  expectedProjectId: string,
  actualOrganizationId: string,
  actualProjectId: string,
): void {
  if (expectedOrganizationId !== actualOrganizationId || expectedProjectId !== actualProjectId) {
    throw new PersistenceError("constraint", "authoring scope binding mismatch");
  }
}

function validateTargets(targets: readonly AuthoringProposalTargetInput[]): void {
  const ordinals = new Set<number>();
  const patches = new Set<string>();
  for (const target of targets) {
    if (ordinals.has(target.ordinal) || patches.has(target.patchRef)) {
      throw new PersistenceError("constraint", "authoring proposal targets must be unique");
    }
    ordinals.add(target.ordinal);
    patches.add(target.patchRef);
    if (target.operation === "create") {
      if (target.targetId !== undefined || target.expectedRevision !== undefined) {
        throw new PersistenceError("constraint", "create target cannot have identity or revision");
      }
    } else if (target.targetId === undefined || target.expectedRevision === undefined) {
      throw new PersistenceError("constraint", "update target requires identity and revision");
    }
  }
}

function rowToProject(row: Record<string, unknown>): AuthoringProjectRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
  };
}

function rowToSourceRun(row: Record<string, unknown>): AuthoringSourceRunRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
  };
}

function rowToSession(row: Record<string, unknown>): AuthoringSessionRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    protocolVersion: requiredText(cell(row, "protocol_version"), "protocol_version"),
    status: requiredText(cell(row, "status"), "status") as AuthoringSessionStatus,
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
  };
}

function rowToMessage(row: Record<string, unknown>): AuthoringMessageRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    sessionId: requiredText(cell(row, "session_id"), "session_id"),
    role: requiredText(cell(row, "role"), "role") as AuthoringMessageRole,
    contentRef: optionalText(cell(row, "content_ref")),
    contentHash: requiredText(cell(row, "content_hash"), "content_hash"),
    redactedPreview: optionalText(cell(row, "redacted_preview")),
    retentionUntil: optionalText(cell(row, "retention_until")),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
  };
}

function rowToTurn(row: Record<string, unknown>): AuthoringTurnRecord {
  const parsed = parseJson(cell(row, "patch_refs_json"), "patch_refs_json");
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("invalid patch_refs_json");
  }
  return {
    id: requiredText(cell(row, "id"), "id"),
    sessionId: requiredText(cell(row, "session_id"), "session_id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    sourceRunId: requiredText(cell(row, "source_run_id"), "source_run_id"),
    protocolVersion: requiredText(cell(row, "protocol_version"), "protocol_version"),
    status: requiredText(cell(row, "status"), "status") as AuthoringTurnStatus,
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    taskId: optionalText(cell(row, "task_id")),
    runId: optionalText(cell(row, "run_id")),
    proposalId: optionalText(cell(row, "proposal_id")),
    changeSetId: optionalText(cell(row, "change_set_id")),
    workflowDraftId: optionalText(cell(row, "workflow_draft_id")),
    patchRefs: parsed as string[],
    completedOperationId: optionalText(cell(row, "completed_operation_id")),
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
  };
}

function rowToTarget(row: Record<string, unknown>): AuthoringProposalTargetInput {
  return {
    ordinal: requiredInt(cell(row, "ordinal"), "ordinal"),
    targetType: requiredText(
      cell(row, "target_type"),
      "target_type",
    ) as AuthoringProposalTargetInput["targetType"],
    operation: requiredText(
      cell(row, "operation"),
      "operation",
    ) as AuthoringProposalTargetInput["operation"],
    ...(optionalText(cell(row, "target_id")) !== null
      ? { targetId: optionalText(cell(row, "target_id"))! }
      : {}),
    ...(optionalInt(cell(row, "expected_revision")) !== null
      ? { expectedRevision: optionalInt(cell(row, "expected_revision"))! }
      : {}),
    patchRef: requiredText(cell(row, "patch_ref"), "patch_ref"),
  };
}

function rowToProposal(
  row: Record<string, unknown>,
  targets: AuthoringProposalTargetInput[],
): AuthoringProposalRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    sessionId: requiredText(cell(row, "session_id"), "session_id"),
    turnId: requiredText(cell(row, "turn_id"), "turn_id"),
    organizationId: requiredText(cell(row, "organization_id"), "organization_id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    sourceRunId: requiredText(cell(row, "source_run_id"), "source_run_id"),
    proposalRef: requiredText(cell(row, "proposal_ref"), "proposal_ref"),
    proposalHash: requiredText(cell(row, "proposal_hash"), "proposal_hash"),
    redactedPreview: optionalText(cell(row, "redacted_preview")),
    status: requiredText(cell(row, "status"), "status") as AuthoringProposalStatus,
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    targets,
    createdAt: requiredText(cell(row, "created_at"), "created_at"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
  };
}
