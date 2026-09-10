import type { DatabaseSync } from "node:sqlite";

import type { Tx } from "@workforce/application";

import { PersistenceError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, requiredInt, requiredText } from "./sql.js";

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
    },
  ): void {
    sqliteDbOf(tx)
      .prepare(
        `INSERT INTO node_instances (
           id, workflow_instance_id, workflow_node_id, generation, status, state_revision
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.workflowInstanceId,
        input.workflowNodeId,
        input.generation,
        input.status,
        input.stateRevision,
      );
  }

  get(
    id: string,
  ): { id: string; generation: number; status: string; stateRevision: number } | null {
    const row = this.db
      .prepare("SELECT id, generation, status, state_revision FROM node_instances WHERE id = ?")
      .get(id);
    if (!row) {
      return null;
    }
    return {
      id: requiredText(cell(row, "id"), "id"),
      generation: requiredInt(cell(row, "generation"), "generation"),
      status: requiredText(cell(row, "status"), "status"),
      stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    };
  }
}

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

  get(id: string): { id: string; actionDigest: string; status: string } | null {
    const row = this.db
      .prepare("SELECT id, action_digest, status FROM approvals WHERE id = ?")
      .get(id);
    if (!row) {
      return null;
    }
    return {
      id: requiredText(cell(row, "id"), "id"),
      actionDigest: requiredText(cell(row, "action_digest"), "action_digest"),
      status: requiredText(cell(row, "status"), "status"),
    };
  }
}

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
