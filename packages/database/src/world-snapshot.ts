import type { DatabaseSync } from "node:sqlite";

import type {
  ApprovalRecord,
  ArtifactRecord,
  BudgetRecord,
  ExecutionLeaseRecord,
  NodeInstanceRecord,
  ProjectExecutionSnapshotRecord,
  ProjectRecord,
  ReservationRecord,
  RunRecord as AppRunRecord,
  TaskRecord,
  WorkflowGraph,
  Tx,
  WorkflowInstanceRecord,
} from "@workforce/application";
import {
  parseRunExecutionSnapshot,
  type AuthoringChangeSetDto,
  type TeamDraftDto,
  type WorkflowDraftDto,
} from "@workforce/protocol";

type RunExecutionSnapshot = NonNullable<AppRunRecord["executionSnapshot"]>;

import { SqliteBudgetRepository, SqliteReservationRepository } from "./budgets.js";
import {
  SqliteAuthoringChangeSetRepository,
  SqliteTeamDraftRepository,
  SqliteWorkflowAuthoringScopeRepository,
  SqliteWorkflowDraftRepository,
  type WorkflowAuthoringScopeExpectation,
  type WorkflowAuthoringScopeRecord,
} from "./authoring.js";
import { SqliteWorkflowCatalogRepository } from "./catalog.js";
import { organizationIdOfProject } from "./ensure.js";
import { PersistenceError } from "./errors.js";
import { SqliteProjectExecutionSnapshotRepository } from "./execution-snapshots.js";
import { SqliteProjectRepository } from "./projects.js";
import {
  SqliteApprovalRepository,
  SqliteArtifactBindingRepository,
  SqliteNodeInstanceRepository,
  SqliteUsageRepository,
} from "./records.js";
import { SqliteRunRepository } from "./runs.js";
import { sqliteDbOf } from "./session.js";
import { cell, ifPresent, optionalText, parseJson, requiredInt, requiredText } from "./sql.js";
import { SqliteTaskRepository } from "./tasks.js";
import {
  listPublishedWorkflowGraphs,
  persistPublishedWorkflowGraph,
  SqliteWorkflowInstanceRepository,
} from "./workflows.js";

/**
 * Entity snapshot that can reconstruct MemoryWorld maps after daemon restart.
 * Events stay in SqliteEventStore — this is not a second event envelope.
 */
export interface WorldEntitySnapshot {
  /** Canonical published graph source; absent only in pre-D02 callers. */
  workflowVersions?: WorkflowGraph[];
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  workflows: WorkflowInstanceRecord[];
  nodes: NodeInstanceRecord[];
  approvals: ApprovalRecord[];
  artifacts: ArtifactRecord[];
  runs: AppRunRecord[];
  executionLeases?: ExecutionLeaseRecord[];
  budgets: BudgetRecord[];
  reservations: ReservationRecord[];
  usageKeys: string[];
  executionSnapshots: ProjectExecutionSnapshotRecord[];
  /** T20-B authoring data is independent of executable workflow instances. */
  workflowAuthoringScopes?: WorkflowAuthoringScopeRecord[];
  workflowDrafts?: WorkflowDraftDto[];
  teamDrafts?: TeamDraftDto[];
  authoringChangeSets?: AuthoringChangeSetDto[];
  /** Restart clock/ids authority; absent only before 014. */
  clock?: string;
  idsSeq?: number;
  unknownStatuses?: string[];
}

export interface WorldProjectionMeta {
  clock: string;
  idsSeq: number;
  unknownStatuses: string[];
}

export class SqliteWorldSnapshot {
  readonly projects: SqliteProjectRepository;
  readonly tasks: SqliteTaskRepository;
  readonly workflows: SqliteWorkflowInstanceRepository;
  readonly nodes: SqliteNodeInstanceRepository;
  readonly approvals: SqliteApprovalRepository;
  readonly artifacts: SqliteArtifactBindingRepository;
  readonly runs: SqliteRunRepository;
  readonly budgets: SqliteBudgetRepository;
  readonly reservations: SqliteReservationRepository;
  readonly usage: SqliteUsageRepository;
  readonly executionSnapshots: SqliteProjectExecutionSnapshotRepository;
  readonly catalogWorkflows: SqliteWorkflowCatalogRepository;
  readonly workflowAuthoringScopes: SqliteWorkflowAuthoringScopeRepository;
  readonly workflowDrafts: SqliteWorkflowDraftRepository;
  readonly teamDrafts: SqliteTeamDraftRepository;
  readonly authoringChangeSets: SqliteAuthoringChangeSetRepository;

  constructor(private readonly db: DatabaseSync) {
    this.projects = new SqliteProjectRepository(db);
    this.tasks = new SqliteTaskRepository(db);
    this.workflows = new SqliteWorkflowInstanceRepository(db);
    this.nodes = new SqliteNodeInstanceRepository(db);
    this.approvals = new SqliteApprovalRepository(db);
    this.artifacts = new SqliteArtifactBindingRepository(db);
    this.runs = new SqliteRunRepository(db);
    this.budgets = new SqliteBudgetRepository(db);
    this.reservations = new SqliteReservationRepository(db);
    this.usage = new SqliteUsageRepository(db);
    this.executionSnapshots = new SqliteProjectExecutionSnapshotRepository(db);
    this.catalogWorkflows = new SqliteWorkflowCatalogRepository(db);
    this.workflowAuthoringScopes = new SqliteWorkflowAuthoringScopeRepository(db);
    this.workflowDrafts = new SqliteWorkflowDraftRepository(db, this.workflowAuthoringScopes);
    this.teamDrafts = new SqliteTeamDraftRepository(db);
    this.authoringChangeSets = new SqliteAuthoringChangeSetRepository(db);
  }

  load(): WorldEntitySnapshot {
    const meta = this.loadMeta();
    return {
      workflowVersions: listPublishedWorkflowGraphs(this.db),
      projects: this.projects.listAll(),
      tasks: this.tasks.listAll(),
      workflows: this.workflows.listAll(),
      nodes: this.nodes.listAll(),
      approvals: this.approvals.listAll(),
      artifacts: this.artifacts.listAll(),
      runs: loadAppRuns(this.db),
      executionLeases: loadExecutionLeases(this.db),
      budgets: this.budgets.listAll(),
      reservations: this.reservations.listActive(),
      usageKeys: this.usage.listIdempotencyKeys(),
      executionSnapshots: this.executionSnapshots.listAll(),
      workflowAuthoringScopes: this.workflowAuthoringScopes.listAll(),
      workflowDrafts: this.workflowDrafts.listAll(),
      teamDrafts: this.teamDrafts.listAll(),
      authoringChangeSets: this.authoringChangeSets.listAll(),
      ...(meta
        ? {
            clock: meta.clock,
            idsSeq: meta.idsSeq,
            unknownStatuses: meta.unknownStatuses,
          }
        : {}),
    };
  }

  loadMeta(): WorldProjectionMeta | null {
    let row: Record<string, unknown> | undefined;
    try {
      row = this.db
        .prepare(
          `SELECT clock, ids_seq, unknown_statuses_json
             FROM world_projection_meta WHERE id = 1`,
        )
        .get();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("no such table")) {
        return null;
      }
      throw error;
    }
    if (!row) {
      return null;
    }
    const unknownStatuses = parseJson(
      cell(row, "unknown_statuses_json"),
      "unknown_statuses_json",
    );
    if (
      !Array.isArray(unknownStatuses) ||
      unknownStatuses.some((item) => typeof item !== "string")
    ) {
      throw new PersistenceError(
        "constraint",
        "world_projection_meta.unknown_statuses_json must be a string array",
      );
    }
    return {
      clock: requiredText(cell(row, "clock"), "clock"),
      idsSeq: requiredInt(cell(row, "ids_seq"), "ids_seq"),
      unknownStatuses,
    };
  }

  /**
   * Persist entity maps. Callers still append events through SqliteEventStore
   * in the same transaction when mutating live state.
   */
  save(tx: Tx, snapshot: WorldEntitySnapshot, at: string): void {
    for (const graph of snapshot.workflowVersions ?? []) {
      persistPublishedWorkflowGraph(tx, graph, at);
    }
    for (const project of snapshot.projects) {
      putWithCas(this.projects.get(project.id), project, (expected) => {
        if (expected === undefined) {
          this.projects.insert(tx, project);
        } else {
          this.projects.update(tx, project, expected);
        }
      });
    }
    for (const workflow of snapshot.workflows) {
      putWithCas(this.workflows.get(workflow.id), workflow, (expected) => {
        if (expected === undefined) {
          this.workflows.insert(tx, workflow, at);
        } else {
          this.workflows.update(tx, workflow, expected, at);
        }
      });
    }
    // Insert-once: an existing snapshot with the same content is a no-op. This runs after the
    // project and workflow-version loops because project_execution_snapshots has foreign keys to
    // projects / workflow_versions / team_versions. A snapshot referencing a project or version
    // absent from this same snapshot still fails the foreign key check and rolls back the whole save.
    for (const executionSnapshot of snapshot.executionSnapshots) {
      this.executionSnapshots.insert(tx, executionSnapshot);
    }
    for (const task of snapshot.tasks) {
      putWithCas(this.tasks.get(task.id), task, (expected) => {
        if (expected === undefined) {
          this.tasks.insert(tx, task);
        } else {
          this.tasks.update(tx, task, expected);
        }
      });
    }
    this.tasks.syncDependencies(tx, snapshot.tasks, at);
    for (const node of snapshot.nodes) {
      putWithCas(this.nodes.get(node.id), node, (expected) => {
        if (expected === undefined) {
          this.nodes.insert(tx, node);
        } else {
          this.nodes.update(tx, node, expected);
        }
      });
    }
    for (const approval of snapshot.approvals) {
      putWithCas(this.approvals.get(approval.id), approval, (expected) => {
        if (expected === undefined) {
          this.approvals.insert(tx, approval);
        } else {
          this.approvals.update(tx, approval, expected);
        }
      });
    }
    for (const artifact of snapshot.artifacts) {
      if (this.artifacts.get(artifact.artifactVersionId)) {
        this.artifacts.update(tx, artifact);
      } else {
        this.artifacts.insert(tx, artifact, at);
      }
    }
    for (const run of snapshot.runs) {
      saveAppRun(tx, this.runs, this.db, run);
    }
    for (const lease of snapshot.executionLeases ?? []) {
      saveExecutionLease(tx, lease);
    }

    // Authoring authority is established only after Project rows are present,
    // and before any workflow draft can be read or appended. A snapshot must
    // carry an explicit scope record, or the database must already contain the
    // scope; ChangeSet metadata is not an authority grant.
    const workflowScopes = ensureWorkflowAuthoringScopes(this, tx, snapshot, at);
    for (const draft of sortWorkflowDrafts(snapshot.workflowDrafts ?? [])) {
      persistWorkflowDraft(
        tx,
        this.workflowAuthoringScopes,
        this.workflowDrafts,
        draft,
        workflowScopes,
      );
    }
    for (const draft of sortTeamDrafts(snapshot.teamDrafts ?? [])) {
      persistTeamDraft(tx, this.teamDrafts, draft);
    }
    // Source Run is an FK, so ChangeSets are intentionally written after runs.
    for (const changeSet of snapshot.authoringChangeSets ?? []) {
      const existing = this.authoringChangeSets.get(changeSet.id);
      if (!existing) {
        this.authoringChangeSets.insert(tx, changeSet);
      } else if (!sameJson(existing, changeSet)) {
        throw new PersistenceError(
          "conflict",
          `authoring change set ${changeSet.id} differs from the durable record`,
        );
      }
    }
    for (const budget of snapshot.budgets) {
      this.budgets.upsert(tx, budget, at);
    }
    // Whole-world call: empty snapshot.reservations releases all actives.
    this.reservations.syncActive(tx, snapshot.reservations, at);
    const organizationId =
      snapshot.projects[0]?.organizationId ??
      (snapshot.budgets[0]
        ? organizationIdOfProject(this.db, snapshot.budgets[0].projectId)
        : undefined);
    if (organizationId && snapshot.usageKeys.length > 0) {
      this.usage.putKeys(tx, {
        organizationId,
        keys: snapshot.usageKeys,
        createdAt: at,
      });
    }
    if (typeof snapshot.idsSeq === "number") {
      saveWorldProjectionMeta(tx, {
        clock: at,
        idsSeq: snapshot.idsSeq,
        unknownStatuses: snapshot.unknownStatuses ?? [],
      });
    }
  }
}

function persistWorkflowDraft(
  tx: Tx,
  scopeRepository: SqliteWorkflowAuthoringScopeRepository,
  repository: SqliteWorkflowDraftRepository,
  draft: WorkflowDraftDto,
  scopes: ReadonlyMap<string, WorkflowAuthoringScopeExpectation>,
): void {
  const expected = scopes.get(draft.workflowId);
  if (expected === undefined) {
    throw new PersistenceError(
      "not_found",
      `workflow ${draft.workflowId} has no authoring scope metadata`,
    );
  }

  // Check authority before the identical-row short circuit as well: an old
  // draft row must not become an implicit write authority after migration.
  scopeRepository.requireInTransaction(tx, draft.workflowId, expected);
  const existing = repository.get(draft.id);
  if (existing) {
    if (!sameJson(existing, draft)) {
      throw new PersistenceError(
        "conflict",
        `workflow draft ${draft.id} differs from the durable record`,
      );
    }
    return;
  }
  // Read the CAS revision through the same SqliteTx as the append. This also
  // enforces workflow authoring authority before any draft write is attempted.
  const current = repository.getCurrentRevision(tx, draft.workflowId, expected);
  repository.append(tx, draft, current, expected);
}

function ensureWorkflowAuthoringScopes(
  snapshot: SqliteWorldSnapshot,
  tx: Tx,
  input: WorldEntitySnapshot,
  at: string,
): Map<string, WorkflowAuthoringScopeExpectation> {
  const expected = new Map<string, WorkflowAuthoringScopeExpectation>();
  const records = new Map<string, WorkflowAuthoringScopeRecord>();

  for (const scope of input.workflowAuthoringScopes ?? []) {
    mergeWorkflowScope(records, scope);
  }

  for (const [workflowId, scope] of records) {
    const db = sqliteDbOf(tx);
    const catalogExists = db
      .prepare("SELECT 1 AS present FROM catalog_workflows WHERE id = ?")
      .get(workflowId);
    if (catalogExists === undefined) {
      // This compatibility path writes only a stable identity label. It never
      // copies prompt/summary content into catalog or authority metadata.
      snapshot.catalogWorkflows.upsert(tx, {
        id: workflowId,
        name: "Authoring workflow",
        description: "",
        status: "draft",
        stateRevision: 1,
        definitionRevision: 1,
        createdAt: scope.createdAt,
        updatedAt: at,
      });
    }

    const authority = snapshot.workflowAuthoringScopes.getInTransaction(tx, workflowId);
    if (authority === null) {
      snapshot.workflowAuthoringScopes.create(tx, scope);
    } else {
      snapshot.workflowAuthoringScopes.requireInTransaction(tx, workflowId, scope);
    }
    expected.set(workflowId, {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
    });
  }

  // A pre-009 snapshot may contain a draft with an already durable scope but
  // no ChangeSet (for example, after a sidecar-only restart). Reuse the
  // existing database authority; a missing one remains fail-closed below.
  for (const draft of input.workflowDrafts ?? []) {
    if (expected.has(draft.workflowId)) continue;
    const authority = snapshot.workflowAuthoringScopes.getInTransaction(tx, draft.workflowId);
    if (authority !== null) {
      expected.set(draft.workflowId, {
        organizationId: authority.organizationId,
        projectId: authority.projectId,
      });
    }
  }
  return expected;
}

function mergeWorkflowScope(
  records: Map<string, WorkflowAuthoringScopeRecord>,
  incoming: WorkflowAuthoringScopeRecord,
): void {
  const existing = records.get(incoming.workflowId);
  if (existing === undefined) {
    records.set(incoming.workflowId, incoming);
    return;
  }
  if (
    existing.organizationId !== incoming.organizationId ||
    existing.projectId !== incoming.projectId
  ) {
    throw new PersistenceError(
      "constraint",
      `workflow ${incoming.workflowId} authoring scope has conflicting Project authority`,
    );
  }
}

function persistTeamDraft(
  tx: Tx,
  repository: SqliteTeamDraftRepository,
  draft: TeamDraftDto,
): void {
  const existing = repository.get(draft.id);
  if (existing) {
    if (!sameJson(existing, draft)) {
      throw new PersistenceError(
        "conflict",
        `team draft ${draft.id} differs from the durable record`,
      );
    }
    return;
  }
  const current = repository.listByTeam(draft.teamId).at(-1)?.revision ?? 0;
  repository.append(tx, draft, current);
}

function sortWorkflowDrafts(drafts: readonly WorkflowDraftDto[]): WorkflowDraftDto[] {
  return [...drafts].sort(
    (left, right) =>
      left.workflowId.localeCompare(right.workflowId) || left.revision - right.revision,
  );
}

function sortTeamDrafts(drafts: readonly TeamDraftDto[]): TeamDraftDto[] {
  return [...drafts].sort(
    (left, right) => left.teamId.localeCompare(right.teamId) || left.revision - right.revision,
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function putWithCas<T extends { id: string; stateRevision: number }>(
  existing: T | null,
  record: T,
  write: (expected: number | undefined) => void,
): void {
  if (!existing) {
    write(undefined);
    return;
  }
  if (existing.stateRevision > record.stateRevision) {
    throw new PersistenceError(
      "revision_conflict",
      `${record.id} stored revision ${existing.stateRevision} is newer than ${record.stateRevision}`,
    );
  }
  write(existing.stateRevision);
}

function loadAppRuns(db: DatabaseSync): AppRunRecord[] {
  return db
    .prepare(
      `SELECT r.id, r.task_id, t.project_id, r.status, r.state_revision, r.attempt,
              r.generation, r.definition_revision, r.operation_id, r.cancel_requested_at,
              r.orchestration_mode, r.transport, r.execution_snapshot_id,
              r.placement_snapshot_json, r.created_at
         FROM runs r
         INNER JOIN tasks t ON t.id = r.task_id
        ORDER BY r.created_at ASC, r.id ASC`,
    )
    .all()
    .map(rowToAppRun);
}

function rowToAppRun(row: Record<string, unknown>): AppRunRecord {
  const createdAt = requiredText(cell(row, "created_at"), "created_at");
  const executionSnapshot = executionSnapshotFromRow(row);
  return {
    id: requiredText(cell(row, "id"), "id"),
    taskId: requiredText(cell(row, "task_id"), "task_id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    status: requiredText(cell(row, "status"), "status") as AppRunRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    attempt: requiredInt(cell(row, "attempt"), "attempt"),
    generation: requiredInt(cell(row, "generation"), "generation"),
    definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    operationId: optionalText(cell(row, "operation_id")) ?? "",
    createdAt,
    updatedAt: createdAt,
    ...(executionSnapshot
      ? { executionSnapshot, orchestrationMode: executionSnapshot.orchestrationMode }
      : {}),
    ...ifPresent("cancelRequestedAt", optionalText(cell(row, "cancel_requested_at"))),
  };
}

function saveAppRun(tx: Tx, runs: SqliteRunRepository, db: DatabaseSync, run: AppRunRecord): void {
  const existing = runs.get(run.id);
  const organizationId = organizationIdForTask(db, run.taskId);
  const executionSnapshot =
    run.executionSnapshot === undefined
      ? undefined
      : validateExecutionSnapshot(run.executionSnapshot, run.id);
  if (
    executionSnapshot &&
    run.orchestrationMode !== undefined &&
    run.orchestrationMode !== executionSnapshot.orchestrationMode
  ) {
    throw new PersistenceError(
      "conflict",
      `run ${run.id} has conflicting orchestrationMode and executionSnapshot`,
    );
  }
  if (!existing) {
    runs.insert(tx, {
      runId: run.id,
      organizationId,
      taskId: run.taskId,
      operationId: run.operationId,
      attempt: run.attempt,
      generation: run.generation,
      definitionRevision: run.definitionRevision,
      createdAt: run.createdAt,
      status: run.status,
      stateRevision: run.stateRevision,
      ...(executionSnapshot ? { executionSnapshot } : {}),
      ...ifPresent("cancelRequestedAt", run.cancelRequestedAt),
    });
    return;
  }
  if (existing.stateRevision > run.stateRevision) {
    throw new PersistenceError(
      "revision_conflict",
      `run ${run.id} stored revision ${existing.stateRevision} is newer than ${run.stateRevision}`,
    );
  }
  const storedExecutionSnapshot = readStoredExecutionSnapshot(db, run.id);
  if (executionSnapshot) {
    if (
      storedExecutionSnapshot &&
      !sameExecutionSnapshot(storedExecutionSnapshot, executionSnapshot)
    ) {
      throw new PersistenceError(
        "conflict",
        `run ${run.id} execution snapshot is immutable and cannot be replaced`,
      );
    }
    if (!storedExecutionSnapshot && hasAnyExecutionAxis(db, run.id)) {
      throw new PersistenceError(
        "conflict",
        `run ${run.id} has a partial execution snapshot and cannot be completed`,
      );
    }
    if (!storedExecutionSnapshot) {
      throw new PersistenceError(
        "conflict",
        `run ${run.id} has no stored execution snapshot; explicit backfill is required`,
      );
    }
  }
  if (existing.stateRevision !== run.stateRevision || existing.status !== run.status) {
    runs.updateStatus(tx, {
      runId: run.id,
      expectedStateRevision: existing.stateRevision,
      status: run.status,
      at: run.updatedAt,
    });
    if (run.stateRevision !== existing.stateRevision + 1) {
      sqliteDbOf(tx)
        .prepare("UPDATE runs SET state_revision = ? WHERE id = ?")
        .run(run.stateRevision, run.id);
    }
  }
  if (run.cancelRequestedAt !== undefined) {
    runs.recordCancelRequest(tx, run.id, run.cancelRequestedAt);
  }
}

function organizationIdForTask(db: DatabaseSync, taskId: string): string {
  const row = db.prepare("SELECT organization_id FROM tasks WHERE id = ?").get(taskId);
  if (!row) {
    throw new PersistenceError("not_found", `task ${taskId} not found`);
  }
  return requiredText(cell(row, "organization_id"), "organization_id");
}

function executionSnapshotFromRow(row: Record<string, unknown>): RunExecutionSnapshot | undefined {
  const mode = optionalText(cell(row, "orchestration_mode"));
  const transport = optionalText(cell(row, "transport"));
  const executionSnapshotId = optionalText(cell(row, "execution_snapshot_id"));
  const placementJson = optionalText(cell(row, "placement_snapshot_json"));
  if (
    mode === null &&
    transport === null &&
    executionSnapshotId === null &&
    placementJson === null
  ) {
    return undefined;
  }
  if (mode === null || transport === null || placementJson === null) {
    throw new PersistenceError("constraint", "run execution axes are partially populated");
  }
  let placement: unknown;
  try {
    placement = JSON.parse(placementJson) as unknown;
  } catch {
    throw new PersistenceError("constraint", "run placement_snapshot_json is invalid JSON");
  }
  return validateExecutionSnapshot(
    {
      orchestrationMode: mode,
      transport,
      ...(executionSnapshotId === null ? {} : { executionSnapshotId }),
      placementSnapshot: placement,
    },
    requiredText(cell(row, "id"), "id"),
  );
}

function readStoredExecutionSnapshot(
  db: DatabaseSync,
  runId: string,
): RunExecutionSnapshot | undefined {
  const row = db
    .prepare(
      `SELECT id, orchestration_mode, transport, execution_snapshot_id,
              placement_snapshot_json
         FROM runs WHERE id = ?`,
    )
    .get(runId) as Record<string, unknown> | undefined;
  return row ? executionSnapshotFromRow(row) : undefined;
}

function hasAnyExecutionAxis(db: DatabaseSync, runId: string): boolean {
  const row = db
    .prepare(
      `SELECT orchestration_mode, transport, execution_snapshot_id,
              placement_snapshot_json
         FROM runs WHERE id = ?`,
    )
    .get(runId) as Record<string, unknown> | undefined;
  if (!row) return false;
  return [
    "orchestration_mode",
    "transport",
    "execution_snapshot_id",
    "placement_snapshot_json",
  ].some((column) => optionalText(cell(row, column)) !== null);
}

function sameExecutionSnapshot(left: RunExecutionSnapshot, right: RunExecutionSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateExecutionSnapshot(value: unknown, runId: string): RunExecutionSnapshot {
  try {
    return parseRunExecutionSnapshot(value);
  } catch {
    throw new PersistenceError("constraint", `run ${runId} has an invalid execution snapshot`);
  }
}

function saveWorldProjectionMeta(
  tx: Tx,
  meta: WorldProjectionMeta,
): void {
  sqliteDbOf(tx)
    .prepare(
      `INSERT INTO world_projection_meta (id, clock, ids_seq, unknown_statuses_json, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         clock = excluded.clock,
         ids_seq = excluded.ids_seq,
         unknown_statuses_json = excluded.unknown_statuses_json,
         updated_at = excluded.updated_at`,
    )
    .run(meta.clock, meta.idsSeq, JSON.stringify(meta.unknownStatuses), atOrNow(meta));
}

function atOrNow(meta: WorldProjectionMeta): string {
  return meta.clock;
}

function loadExecutionLeases(db: DatabaseSync): ExecutionLeaseRecord[] {
  return db
    .prepare(
      `SELECT id, run_id, node_id, fencing_token, acquired_at, renewed_at, expires_at
         FROM execution_leases
         ORDER BY acquired_at ASC, id ASC`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: requiredText(cell(record, "id"), "id"),
        runId: requiredText(cell(record, "run_id"), "run_id"),
        nodeId: requiredText(cell(record, "node_id"), "node_id"),
        fencingToken: requiredInt(cell(record, "fencing_token"), "fencing_token"),
        acquiredAt: requiredText(cell(record, "acquired_at"), "acquired_at"),
        renewedAt: requiredText(cell(record, "renewed_at"), "renewed_at"),
        expiresAt: requiredText(cell(record, "expires_at"), "expires_at"),
      };
    });
}

function saveExecutionLease(tx: Tx, lease: ExecutionLeaseRecord): void {
  const db = sqliteDbOf(tx);
  const existing = db
    .prepare(`SELECT id, fencing_token FROM execution_leases WHERE run_id = ? OR id = ?`)
    .get(lease.runId, lease.id) as Record<string, unknown> | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO execution_leases (
         id, run_id, node_id, fencing_token, acquired_at, renewed_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      lease.id,
      lease.runId,
      lease.nodeId,
      lease.fencingToken,
      lease.acquiredAt,
      lease.renewedAt,
      lease.expiresAt,
    );
    return;
  }
  if (
    requiredText(cell(existing, "id"), "id") !== lease.id ||
    requiredInt(cell(existing, "fencing_token"), "fencing_token") !== lease.fencingToken
  ) {
    throw new PersistenceError(
      "conflict",
      `execution lease for run ${lease.runId} is immutable and cannot be replaced`,
    );
  }
}
