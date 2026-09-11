import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";
import { PersistenceError } from "./errors.js";
import { tableExists, unpublishedOutboxCount } from "./event-store.js";
import { appliedMigrations, checksumSql, migrate } from "./migrate.js";
import {
  MIGRATION_001_SQL,
  MIGRATION_002_SQL,
  MIGRATION_003_SQL,
  SCHEMA_MIGRATIONS_DDL,
} from "./schema.js";
import { startRunIdempotent } from "./start-run.js";
import { STORAGE_MATRIX } from "./storage-matrix.js";

/**
 * Persistence tests for T04.
 * Platform: Windows + Node 24. macOS / Linux: untested.
 */
describe("WorkforceSqlite", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openDb() {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-"));
    dirs.push(dir);
    return WorkforceSqlite.open(join(dir, "workforce.sqlite"));
  }

  const now = "2026-09-10T10:00:00.000Z";
  const ids = {
    organizationId: "org_test",
    projectId: "prj_test",
    taskId: "tsk_test",
  };

  it("initializes schema on an empty database", () => {
    const db = openDb();
    try {
      const applied = appliedMigrations(db.connection);
      expect(applied.has("001_init")).toBe(true);
      expect(applied.has("002_entity_alignment")).toBe(true);
      expect(applied.has("003_budget_alignment")).toBe(true);
      expect(applied.has("004_policy_grants")).toBe(true);
      expect(applied.has("005_catalog_definitions")).toBe(true);
      expect(tableExists(db.connection, "runs")).toBe(true);
      expect(tableExists(db.connection, "events")).toBe(true);
      expect(tableExists(db.connection, "outbox_messages")).toBe(true);
      expect(tableExists(db.connection, "command_receipts")).toBe(true);
      expect(tableExists(db.connection, "runtime_handles")).toBe(true);
      expect(tableExists(db.connection, "timers")).toBe(true);
      expect(tableExists(db.connection, "node_instances")).toBe(true);
      expect(tableExists(db.connection, "policy_grants")).toBe(true);
      expect(tableExists(db.connection, "catalog_workflows")).toBe(true);
      expect(tableExists(db.connection, "catalog_teams")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("applies 002 on a database that already has 001 without rewriting 001", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"), { migrate: false });
    try {
      db.connection.exec(SCHEMA_MIGRATIONS_DDL);
      db.connection.exec(MIGRATION_001_SQL);
      db.connection
        .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
        .run("001_init", checksumSql(MIGRATION_001_SQL), now);
      const ran = migrate(db.connection);
      expect(ran).toEqual([
        "002_entity_alignment",
        "003_budget_alignment",
        "004_policy_grants",
        "005_catalog_definitions",
      ]);
      const applied = appliedMigrations(db.connection);
      expect(applied.get("001_init")).toBe(checksumSql(MIGRATION_001_SQL));
      const columns = db.connection.prepare("PRAGMA table_info(projects)").all();
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "workspace_id",
          "runtime_id",
          "budget_id",
          "plan_artifact_version_id",
          "execution_node_id",
        ]),
      );
      const budgetColumns = db.connection.prepare("PRAGMA table_info(budgets)").all();
      expect(budgetColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "project_id",
          "limit_minor",
          "reserved_minor",
          "settled_minor",
          "authorization_version",
        ]),
      );
    } finally {
      db.close();
    }
  });

  it("applies 003 on a database that already has 001 and 002 without rewriting them", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"), { migrate: false });
    try {
      db.connection.exec(SCHEMA_MIGRATIONS_DDL);
      db.connection.exec(MIGRATION_001_SQL);
      db.connection.exec(MIGRATION_002_SQL);
      db.connection
        .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
        .run("001_init", checksumSql(MIGRATION_001_SQL), now);
      db.connection
        .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
        .run("002_entity_alignment", checksumSql(MIGRATION_002_SQL), now);
      const ran = migrate(db.connection);
      expect(ran).toEqual(["003_budget_alignment", "004_policy_grants", "005_catalog_definitions"]);
      const applied = appliedMigrations(db.connection);
      expect(applied.get("001_init")).toBe(checksumSql(MIGRATION_001_SQL));
      expect(applied.get("002_entity_alignment")).toBe(checksumSql(MIGRATION_002_SQL));
      const budgetColumns = db.connection.prepare("PRAGMA table_info(budgets)").all();
      expect(budgetColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining(["project_id", "limit_minor", "reserved_minor", "settled_minor"]),
      );
    } finally {
      db.close();
    }
  });

  it("applies 004 on a database that already has 001–003 without rewriting them", () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"), { migrate: false });
    try {
      db.connection.exec(SCHEMA_MIGRATIONS_DDL);
      db.connection.exec(MIGRATION_001_SQL);
      db.connection.exec(MIGRATION_002_SQL);
      db.connection.exec(MIGRATION_003_SQL);
      db.connection
        .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
        .run("001_init", checksumSql(MIGRATION_001_SQL), now);
      db.connection
        .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
        .run("002_entity_alignment", checksumSql(MIGRATION_002_SQL), now);
      db.connection
        .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
        .run("003_budget_alignment", checksumSql(MIGRATION_003_SQL), now);
      const ran = migrate(db.connection);
      expect(ran).toEqual(["004_policy_grants", "005_catalog_definitions"]);
      const applied = appliedMigrations(db.connection);
      expect(applied.get("001_init")).toBe(checksumSql(MIGRATION_001_SQL));
      expect(applied.get("002_entity_alignment")).toBe(checksumSql(MIGRATION_002_SQL));
      expect(applied.get("003_budget_alignment")).toBe(checksumSql(MIGRATION_003_SQL));
      expect(tableExists(db.connection, "policy_grants")).toBe(true);
      expect(tableExists(db.connection, "catalog_workflows")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("rolls back state, event, and outbox together", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    try {
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.runs.insertPending(tx, {
            runId: "run_1",
            organizationId: ids.organizationId,
            taskId: ids.taskId,
            operationId: "op_1",
            attempt: 1,
            generation: 1,
            definitionRevision: 1,
            createdAt: now,
          });
          await db.events.append(tx, sampleEvent({ id: "evt_1", stream: "run:run_1" }));
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(db.runs.get("run_1")).toBeNull();
      expect(await db.events.read({ limit: 10 })).toEqual([]);
      expect(unpublishedOutboxCount(db.connection)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("does not leave half-state when a constraint fails", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insertPending(tx, {
          runId: "run_ok",
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_ok",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          createdAt: now,
        });
        await db.events.append(
          tx,
          sampleEvent({ id: "evt_ok", stream: "run:run_ok", sequence: 1 }),
        );
      });

      await expect(
        db.uow.withTransaction(async (tx) => {
          db.runs.updateStatus(tx, {
            runId: "run_ok",
            expectedStateRevision: 1,
            status: "starting",
            at: now,
          });
          await db.events.append(
            tx,
            sampleEvent({ id: "evt_dup", stream: "run:run_ok", sequence: 1 }),
          );
        }),
      ).rejects.toThrow();

      expect(db.runs.get("run_ok")?.status).toBe("pending");
      expect(db.runs.get("run_ok")?.stateRevision).toBe(1);
      expect(await db.events.read({ stream: "run:run_ok", limit: 10 })).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("reuses a Run on duplicate start with the same digest", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const command = startCommand("run_a", "op_start", "key-1", "digest-a");
    try {
      const first = await db.uow.withTransaction(async (tx) => {
        const result = await startRunIdempotent(tx, db, command);
        await db.events.append(tx, sampleEvent({ id: "evt_start", stream: "run:run_a" }));
        return result;
      });
      expect(first.reused).toBe(false);

      const second = await db.uow.withTransaction(async (tx) =>
        startRunIdempotent(tx, db, command),
      );
      expect(second).toEqual({ runId: "run_a", reused: true });
      expect(db.runs.listByTask(ids.taskId)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects a reused idempotency key with a different digest", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    try {
      await db.uow.withTransaction(async (tx) => {
        await startRunIdempotent(tx, db, startCommand("run_a", "op_start", "key-1", "digest-a"));
      });

      await expect(
        db.uow.withTransaction(async (tx) =>
          startRunIdempotent(tx, db, startCommand("run_b", "op_start2", "key-1", "digest-b")),
        ),
      ).rejects.toBeInstanceOf(PersistenceError);

      expect(db.runs.listByTask(ids.taskId)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("reads command receipts after reopening the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-"));
    dirs.push(dir);
    const path = join(dir, "workforce.sqlite");
    const db = WorkforceSqlite.open(path);
    db.seedMinimalGraph(ids, now);
    const scope = {
      principalId: "usr_1",
      clientId: "cli_1",
      canonicalOperation: "run.start",
      resource: ids.taskId,
      idempotencyKey: "key-reopen",
    };
    await db.uow.withTransaction(async (tx) => {
      await db.receipts.putPending(tx, {
        operationId: "op_reopen",
        status: "pending",
        scope,
        requestDigest: "digest",
        acceptedAt: now,
      });
      await db.receipts.complete(tx, "op_reopen", { runId: "run_reopen" });
    });
    db.close();

    const reopened = WorkforceSqlite.open(path);
    try {
      const receipt = await reopened.receipts.get(scope);
      expect(receipt?.status).toBe("committed");
      expect(receipt?.result).toEqual({ runId: "run_reopen" });
      expect(await reopened.receipts.getByOperationId("op_reopen")).not.toBeNull();
    } finally {
      reopened.close();
    }
  });

  it("persists Handle and Timer across reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-"));
    dirs.push(dir);
    const path = join(dir, "workforce.sqlite");
    const db = WorkforceSqlite.open(path);
    db.seedMinimalGraph(ids, now);
    await db.uow.withTransaction(async (tx) => {
      db.runs.insertPending(tx, {
        runId: "run_h",
        organizationId: ids.organizationId,
        taskId: ids.taskId,
        operationId: "op_h",
        attempt: 1,
        generation: 1,
        definitionRevision: 1,
        createdAt: now,
      });
      expect(
        db.handles.putByOperation(tx, {
          operationId: "op_h",
          pid: 4242,
          startIdentity: "start-xyz",
          handle: { adapter: "mock", ref: "h1" },
          recordedAt: now,
        }),
      ).toBe(true);
      db.timers.put(tx, {
        id: "tmr_1",
        scopeType: "run",
        scopeId: "run_h",
        kind: "timeout",
        fireAt: "2026-09-10T10:05:00.000Z",
        status: "scheduled",
        payload: { attempt: 1 },
        createdAt: now,
      });
    });
    db.close();

    const reopened = WorkforceSqlite.open(path);
    try {
      expect(reopened.handles.get("run_h")?.startIdentity).toBe("start-xyz");
      expect(reopened.handles.list()).toEqual([
        expect.objectContaining({
          runId: "run_h",
          pid: 4242,
          startIdentity: "start-xyz",
          handle: { adapter: "mock", ref: "h1" },
        }),
      ]);
      expect(reopened.timers.get("tmr_1")?.kind).toBe("timeout");
      expect(reopened.timers.dueAt("2026-09-10T10:06:00.000Z")).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });

  it("assigns ingestionPosition independently of stream sequence", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    try {
      await db.uow.withTransaction(async (tx) => {
        const a = await db.events.append(
          tx,
          sampleEvent({ id: "evt_s1", stream: "task:tsk_a", sequence: 1 }),
        );
        const b = await db.events.append(
          tx,
          sampleEvent({ id: "evt_s2", stream: "task:tsk_b", sequence: 1 }),
        );
        expect(a.ingestionPosition).toBe(1);
        expect(b.ingestionPosition).toBe(2);
      });
      const events = await db.events.read({ limit: 10 });
      expect(
        events.map((event) => [event.stream, event.sequence, event.ingestionPosition]),
      ).toEqual([
        ["task:tsk_a", 1, 1],
        ["task:tsk_b", 1, 2],
      ]);
    } finally {
      db.close();
    }
  });

  it("CAS-rejects a stale state_revision", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insertPending(tx, {
          runId: "run_cas",
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_cas",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          createdAt: now,
        });
      });
      await db.uow.withTransaction(async (tx) => {
        db.runs.updateStatus(tx, {
          runId: "run_cas",
          expectedStateRevision: 1,
          status: "starting",
          at: now,
        });
      });
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.runs.updateStatus(tx, {
            runId: "run_cas",
            expectedStateRevision: 1,
            status: "running",
            at: now,
          });
        }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      expect(db.runs.get("run_cas")?.status).toBe("starting");
      expect(db.runs.get("run_cas")?.stateRevision).toBe(2);
    } finally {
      db.close();
    }
  });

  it("preserves a legacy cancelled Run's ended_at when its revision is updated", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const endedAt = "2026-09-10T10:01:00.000Z";
    const metadataUpdateAt = "2026-09-10T10:05:00.000Z";
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insert(tx, {
          runId: "run_cancelled",
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_cancelled",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          status: "cancelled",
          stateRevision: 4,
          createdAt: now,
        });
      });
      db.connection
        .prepare("UPDATE runs SET ended_at = ? WHERE id = ?")
        .run(endedAt, "run_cancelled");

      await db.uow.withTransaction(async (tx) => {
        db.runs.updateStatus(tx, {
          runId: "run_cancelled",
          expectedStateRevision: 4,
          status: "cancelled",
          at: metadataUpdateAt,
        });
      });

      expect(
        db.connection
          .prepare("SELECT status, state_revision, ended_at FROM runs WHERE id = ?")
          .get("run_cancelled"),
      ).toMatchObject({ status: "cancelled", state_revision: 5, ended_at: endedAt });
    } finally {
      db.close();
    }
  });

  it("records ended_at when a Run first enters a terminal status", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const endedAt = "2026-09-10T10:01:00.000Z";
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insertPending(tx, {
          runId: "run_first_terminal",
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_first_terminal",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          createdAt: now,
        });
        db.runs.updateStatus(tx, {
          runId: "run_first_terminal",
          expectedStateRevision: 1,
          status: "cancelled",
          at: endedAt,
        });
      });

      expect(
        db.connection
          .prepare("SELECT status, state_revision, ended_at FROM runs WHERE id = ?")
          .get("run_first_terminal"),
      ).toMatchObject({ status: "cancelled", state_revision: 2, ended_at: endedAt });
    } finally {
      db.close();
    }
  });

  it("covers every D04 storage-matrix record", () => {
    const records = STORAGE_MATRIX.map((row) => row.record);
    expect(records).toEqual(
      expect.arrayContaining([
        "NodeInstance generation",
        "persistent Timer / retry schedule",
        "Runtime Handle and process identity",
        "start command and idempotency receipt",
        "pending approval action digest",
        "Artifact staging / output binding",
        "usage dedup and resource occupancy",
        "Budget / reservation / usage key",
        "Policy grant (consume-once)",
        "SSE ingestion position",
      ]),
    );
  });

  function startCommand(runId: string, operationId: string, key: string, digest: string) {
    return {
      run: {
        runId,
        organizationId: ids.organizationId,
        taskId: ids.taskId,
        operationId,
        attempt: 1,
        generation: 1,
        definitionRevision: 1,
        createdAt: now,
      },
      scope: {
        principalId: "usr_1",
        clientId: "cli_1",
        canonicalOperation: "run.start",
        resource: ids.taskId,
        idempotencyKey: key,
      },
      requestDigest: digest,
      acceptedAt: now,
    };
  }
});

function sampleEvent(input: { id: string; stream: string; sequence?: number; type?: string }) {
  return {
    specVersion: "0.1" as const,
    id: input.id,
    type: input.type ?? "run.created",
    source: "workforce.database.test",
    subject: { type: "run", id: input.id },
    time: "2026-09-10T10:00:00.000Z",
    recordedAt: "2026-09-10T10:00:00.100Z",
    actor: { type: "service" as const, id: "database-test" },
    stream: input.stream,
    ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
    correlationId: "op_test",
    dataContentType: "application/json" as const,
    dataSchema: "urn:workforce:event:run.created:0.1",
    data: {},
    sensitivity: "internal" as const,
  };
}
