import type { DatabaseSync } from "node:sqlite";

import type { ApprovalRecord, ArtifactRecord, NodeInstanceRecord, Tx } from "@workforce/application";

import { assertCas, organizationIdOfProject } from "./ensure.js";
import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, ifPresent, optionalText, requiredInt, requiredText } from "./sql.js";

const NODE_COLUMNS = `
  id, workflow_instance_id, workflow_node_id, task_id, generation, status, state_revision
`;

export class SqliteNodeInstanceRepository {
  constructor(private readonly db: DatabaseSync) {}

  put(
    tx: Tx,
    input: {
      id: string;
      workflowInstanceId: string;
      workflowNodeId: string;
      generation: number;
      status: string;
      stateRevision: number;
      taskId?: string;
    },
  ): void {
    sqliteDbOf(tx)
      .prepare(
        `INSERT INTO node_instances (
           id, workflow_instance_id, workflow_node_id, generation, status, state_revision, task_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.workflowInstanceId,
        input.workflowNodeId,
        input.generation,
        input.status,
        input.stateRevision,
        input.taskId ?? null,
      );
  }

  insert(tx: Tx, record: NodeInstanceRecord): void {
    try {
      this.put(tx, {
        id: record.id,
        workflowInstanceId: record.workflowInstanceId,
        workflowNodeId: record.nodeId,
        generation: record.generation,
        status: record.status,
        stateRevision: record.stateRevision,
        ...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
      });
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `node instance ${record.id} already exists`);
      }
      throw error;
    }
  }

  get(id: string): NodeInstanceRecord | null {
    const row = this.db
      .prepare(`SELECT ${NODE_COLUMNS} FROM node_instances WHERE id = ?`)
      .get(id);
    return row ? rowToNode(row) : null;
  }

  listByProject(projectId: string): NodeInstanceRecord[] {
    return this.db
      .prepare(
        `SELECT n.id, n.workflow_instance_id, n.workflow_node_id, n.task_id,
                n.generation, n.status, n.state_revision
           FROM node_instances n
           INNER JOIN workflow_instances w ON w.id = n.workflow_instance_id
          WHERE w.project_id = ?
          ORDER BY n.id ASC`,
      )
      .all(projectId)
      .map(rowToNode);
  }

  listAll(): NodeInstanceRecord[] {
    return this.db
      .prepare(`SELECT ${NODE_COLUMNS} FROM node_instances ORDER BY id ASC`)
      .all()
      .map(rowToNode);
  }

  update(tx: Tx, record: NodeInstanceRecord, expectedStateRevision: number): void {
    const result = sqliteDbOf(tx)
      .prepare(
        `UPDATE node_instances
            SET workflow_instance_id = ?,
                workflow_node_id = ?,
                task_id = ?,
                generation = ?,
                status = ?,
                state_revision = ?
          WHERE id = ? AND state_revision = ?`,
      )
      .run(
        record.workflowInstanceId,
        record.nodeId,
        record.taskId ?? null,
        record.generation,
        record.status,
        record.stateRevision,
        record.id,
        expectedStateRevision,
      );
    assertCas(result.changes, "node instance", record.id);
  }
}

function rowToNode(row: Record<string, unknown>): NodeInstanceRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    workflowInstanceId: requiredText(cell(row, "workflow_instance_id"), "workflow_instance_id"),
    nodeId: requiredText(cell(row, "workflow_node_id"), "workflow_node_id"),
    status: requiredText(cell(row, "status"), "status") as NodeInstanceRecord["status"],
    generation: requiredInt(cell(row, "generation"), "generation"),
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    ...ifPresent("taskId", optionalText(cell(row, "task_id"))),
  };
}

const APPROVAL_COLUMNS = `
  id, project_id, task_id, gate, status, state_revision, action_digest, resource,
  artifact_version_id, due_at, requested_at
`;

export class SqliteApprovalRepository {
  constructor(private readonly db: DatabaseSync) {}

  put(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      projectId: string;
      gate: string;
      status: string;
      actionDigest: string;
      resource: string;
      request: unknown;
      requestedAt: string;
      taskId?: string;
    },
  ): void {
    sqliteDbOf(tx)
      .prepare(
        `INSERT INTO approvals (
           id, organization_id, project_id, task_id, gate, status, action_digest,
           resource, request_json, state_revision, requested_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        input.id,
        input.organizationId,
        input.projectId,
        input.taskId ?? null,
        input.gate,
        input.status,
        input.actionDigest,
        input.resource,
        asJsonText(input.request),
        input.requestedAt,
      );
  }

  insert(tx: Tx, record: ApprovalRecord): void {
    const db = sqliteDbOf(tx);
    const organizationId = organizationIdOfProject(db, record.projectId);
    try {
      db.prepare(
        `INSERT INTO approvals (
           id, organization_id, project_id, task_id, run_id, artifact_version_id,
           gate, status, action_digest, resource, request_json, state_revision,
           requested_at, due_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        organizationId,
        record.projectId,
        record.taskId ?? null,
        record.artifactVersionId ?? null,
        record.gate,
        record.status,
        record.actionDigest,
        record.resource,
        asJsonText({ resource: record.resource }),
        record.stateRevision,
        record.createdAt,
        record.expiresAt ?? null,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `approval ${record.id} already exists`);
      }
      throw error;
    }
  }

  get(id: string): ApprovalRecord | null {
    const row = this.db.prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`).get(id);
    return row ? rowToApproval(row) : null;
  }

  listByProject(projectId: string): ApprovalRecord[] {
    return this.db
      .prepare(
        `SELECT ${APPROVAL_COLUMNS} FROM approvals
          WHERE project_id = ?
          ORDER BY requested_at ASC, id ASC`,
      )
      .all(projectId)
      .map(rowToApproval);
  }

  listAll(): ApprovalRecord[] {
    return this.db
      .prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals ORDER BY requested_at ASC, id ASC`)
      .all()
      .map(rowToApproval);
  }

  update(tx: Tx, record: ApprovalRecord, expectedStateRevision: number): void {
    const decided =
      record.status === "pending" || record.status === "expired" ? null : record.createdAt;
    const result = sqliteDbOf(tx)
      .prepare(
        `UPDATE approvals
            SET task_id = ?,
                artifact_version_id = ?,
                gate = ?,
                status = ?,
                action_digest = ?,
                resource = ?,
                state_revision = ?,
                due_at = ?,
                decided_at = COALESCE(?, decided_at)
          WHERE id = ? AND state_revision = ?`,
      )
      .run(
        record.taskId ?? null,
        record.artifactVersionId ?? null,
        record.gate,
        record.status,
        record.actionDigest,
        record.resource,
        record.stateRevision,
        record.expiresAt ?? null,
        decided,
        record.id,
        expectedStateRevision,
      );
    assertCas(result.changes, "approval", record.id);
  }
}

function rowToApproval(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    gate: requiredText(cell(row, "gate"), "gate") as ApprovalRecord["gate"],
    status: requiredText(cell(row, "status"), "status") as ApprovalRecord["status"],
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    actionDigest: requiredText(cell(row, "action_digest"), "action_digest"),
    resource: requiredText(cell(row, "resource"), "resource"),
    createdAt: requiredText(cell(row, "requested_at"), "requested_at"),
    ...ifPresent("taskId", optionalText(cell(row, "task_id"))),
    ...ifPresent("artifactVersionId", optionalText(cell(row, "artifact_version_id"))),
    ...ifPresent("expiresAt", optionalText(cell(row, "due_at"))),
  };
}

const ARTIFACT_COLUMNS = `
  v.id AS artifact_version_id,
  a.project_id AS project_id,
  v.task_id AS task_id,
  b.slot_id AS slot_id,
  v.sha256 AS digest,
  v.status AS status
`;

export class SqliteArtifactBindingRepository {
  constructor(private readonly db: DatabaseSync) {}

  stage(
    tx: Tx,
    input: {
      artifactId: string;
      organizationId: string;
      projectId: string;
      logicalName: string;
      kind: string;
      versionId: string;
      version: number;
      stagingRef: string;
      createdAt: string;
      taskId?: string;
      runId?: string;
    },
  ): void {
    const db = sqliteDbOf(tx);
    db.prepare(
      `INSERT OR IGNORE INTO artifacts (
         id, organization_id, project_id, logical_name, kind, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.artifactId,
      input.organizationId,
      input.projectId,
      input.logicalName,
      input.kind,
      input.createdAt,
    );
    db.prepare(
      `INSERT INTO artifact_versions (
         id, artifact_id, version, task_id, run_id, status, staging_ref, created_at
       ) VALUES (?, ?, ?, ?, ?, 'staging', ?, ?)`,
    ).run(
      input.versionId,
      input.artifactId,
      input.version,
      input.taskId ?? null,
      input.runId ?? null,
      input.stagingRef,
      input.createdAt,
    );
  }

  bindOutput(
    tx: Tx,
    input: { taskId: string; slotId: string; artifactVersionId: string; createdAt: string },
  ): void {
    sqliteDbOf(tx)
      .prepare(
        `INSERT INTO output_bindings (task_id, slot_id, artifact_version_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.taskId, input.slotId, input.artifactVersionId, input.createdAt);
  }

  insert(tx: Tx, record: ArtifactRecord, createdAt: string): void {
    const db = sqliteDbOf(tx);
    const organizationId = organizationIdOfProject(db, record.projectId);
    const artifactId = `art_${record.artifactVersionId}`;
    try {
      db.prepare(
        `INSERT OR IGNORE INTO artifacts (
           id, organization_id, project_id, logical_name, kind, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        artifactId,
        organizationId,
        record.projectId,
        record.slotId ?? "artifact",
        "file",
        createdAt,
      );
      db.prepare(
        `INSERT INTO artifact_versions (
           id, artifact_id, version, task_id, status, sha256, created_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?)`,
      ).run(
        record.artifactVersionId,
        artifactId,
        record.taskId ?? null,
        record.status,
        record.digest,
        createdAt,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError(
          "conflict",
          `artifact version ${record.artifactVersionId} already exists`,
        );
      }
      throw error;
    }
    if (record.taskId && record.slotId) {
      db.prepare(
        `INSERT OR IGNORE INTO output_bindings (task_id, slot_id, artifact_version_id, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(record.taskId, record.slotId, record.artifactVersionId, createdAt);
    }
  }

  update(tx: Tx, record: ArtifactRecord): void {
    const db = sqliteDbOf(tx);
    const result = db
      .prepare(
        `UPDATE artifact_versions
            SET task_id = ?, status = ?, sha256 = ?
          WHERE id = ?`,
      )
      .run(
        record.taskId ?? null,
        record.status,
        record.digest,
        record.artifactVersionId,
      );
    if (Number(result.changes) === 0) {
      throw new PersistenceError("not_found", `artifact version ${record.artifactVersionId}`);
    }
    if (record.taskId && record.slotId) {
      db.prepare(
        `INSERT INTO output_bindings (task_id, slot_id, artifact_version_id, created_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(task_id, slot_id) DO UPDATE SET artifact_version_id = excluded.artifact_version_id`,
      ).run(record.taskId, record.slotId, record.artifactVersionId);
    }
  }

  get(artifactVersionId: string): ArtifactRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${ARTIFACT_COLUMNS}
           FROM artifact_versions v
           INNER JOIN artifacts a ON a.id = v.artifact_id
           LEFT JOIN output_bindings b ON b.artifact_version_id = v.id
          WHERE v.id = ?`,
      )
      .get(artifactVersionId);
    return row ? rowToArtifact(row) : null;
  }

  listByProject(projectId: string): ArtifactRecord[] {
    return this.db
      .prepare(
        `SELECT ${ARTIFACT_COLUMNS}
           FROM artifact_versions v
           INNER JOIN artifacts a ON a.id = v.artifact_id
           LEFT JOIN output_bindings b ON b.artifact_version_id = v.id
          WHERE a.project_id = ?
          ORDER BY v.created_at ASC, v.id ASC`,
      )
      .all(projectId)
      .map(rowToArtifact);
  }

  listAll(): ArtifactRecord[] {
    return this.db
      .prepare(
        `SELECT ${ARTIFACT_COLUMNS}
           FROM artifact_versions v
           INNER JOIN artifacts a ON a.id = v.artifact_id
           LEFT JOIN output_bindings b ON b.artifact_version_id = v.id
          ORDER BY v.created_at ASC, v.id ASC`,
      )
      .all()
      .map(rowToArtifact);
  }

  getVersion(id: string): { id: string; status: string; stagingRef: string | null } | null {
    const row = this.db
      .prepare("SELECT id, status, staging_ref FROM artifact_versions WHERE id = ?")
      .get(id);
    if (!row) {
      return null;
    }
    return {
      id: requiredText(cell(row, "id"), "id"),
      status: requiredText(cell(row, "status"), "status"),
      stagingRef:
        row.staging_ref === null || row.staging_ref === undefined
          ? null
          : requiredText(cell(row, "staging_ref"), "staging_ref"),
    };
  }
}

function rowToArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    artifactVersionId: requiredText(cell(row, "artifact_version_id"), "artifact_version_id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    digest: optionalText(cell(row, "digest")) ?? "",
    status: requiredText(cell(row, "status"), "status") as ArtifactRecord["status"],
    ...ifPresent("taskId", optionalText(cell(row, "task_id"))),
    ...ifPresent("slotId", optionalText(cell(row, "slot_id"))),
  };
}

export class SqliteUsageRepository {
  constructor(private readonly db: DatabaseSync) {}

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM usage_ledger").get();
    return row ? Number(row.n) : 0;
  }

  append(
    tx: Tx,
    input: {
      id: string;
      organizationId: string;
      runId?: string;
      metric: string;
      quantity: number;
      amountMinor: number;
      currency: string;
      idempotencyKey: string;
      createdAt: string;
    },
  ): { inserted: boolean } {
    const result = sqliteDbOf(tx)
      .prepare(
        `INSERT OR IGNORE INTO usage_ledger (
           id, organization_id, run_id, metric, quantity, amount_minor, currency, idempotency_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.organizationId,
        input.runId ?? null,
        input.metric,
        input.quantity,
        input.amountMinor,
        input.currency,
        input.idempotencyKey,
        input.createdAt,
      );
    return { inserted: Number(result.changes) === 1 };
  }
}

export class SqliteResourceRepository {
  constructor(private readonly db: DatabaseSync) {}

  heldForRun(runId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM resource_allocations WHERE run_id = ? AND status = 'held'")
      .get(runId);
    return row !== undefined;
  }

  hold(
    tx: Tx,
    input: {
      id: string;
      runId: string;
      nodeId?: string;
      cpuMillis?: number;
      memoryBytes?: number;
      createdAt: string;
    },
  ): void {
    sqliteDbOf(tx)
      .prepare(
        `INSERT INTO resource_allocations (
           id, run_id, node_id, cpu_millis, memory_bytes, status, created_at
         ) VALUES (?, ?, ?, ?, ?, 'held', ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.nodeId ?? null,
        input.cpuMillis ?? null,
        input.memoryBytes ?? null,
        input.createdAt,
      );
  }

  release(tx: Tx, runId: string, releasedAt: string): void {
    const changes = sqliteDbOf(tx)
      .prepare(
        `UPDATE resource_allocations SET status = 'released', released_at = ?
          WHERE run_id = ? AND status = 'held'`,
      )
      .run(releasedAt, runId);
    if (Number(changes.changes) === 0) {
      throw new PersistenceError("not_found", `no held allocation for run ${runId}`);
    }
  }
}

export class SqliteInbox {
  constructor(private readonly db: DatabaseSync) {}

  seen(consumer: string, messageId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM inbox_receipts WHERE consumer = ? AND message_id = ?")
      .get(consumer, messageId);
    return row !== undefined;
  }

  /** Returns true when this consumer first observes the message. */
  record(tx: Tx, consumer: string, messageId: string, processedAt: string): boolean {
    const result = sqliteDbOf(tx)
      .prepare(
        `INSERT OR IGNORE INTO inbox_receipts (consumer, message_id, processed_at)
         VALUES (?, ?, ?)`,
      )
      .run(consumer, messageId, processedAt);
    return Number(result.changes) === 1;
  }
}
