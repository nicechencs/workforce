import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";
import type { ExecutionAxisMigrationEvidence } from "./execution-axis-migration.js";
import { appliedMigrations, checksumSql, migrate } from "./migrate.js";
import { MIGRATIONS, MIGRATION_008_SQL, SCHEMA_MIGRATIONS_DDL } from "./schema.js";

describe("execution-axis migration audit", () => {
  const dirs: string[] = [];
  const now = "2026-09-12T10:00:00.000Z";

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies migration 008 and creates the unresolved audit index", () => {
    const db = openDb();
    try {
      expect(appliedMigrations(db.connection).get("008_execution_axis_migration_audit")).toBe(
        checksumSql(MIGRATION_008_SQL),
      );
      expect(
        db.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_axis_migration_items'",
          )
          .get(),
      ).toEqual({ name: "execution_axis_migration_items" });
      expect(
        db.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_execution_axis_migration_unresolved'",
          )
          .get(),
      ).toEqual({ name: "idx_execution_axis_migration_unresolved" });
    } finally {
      db.close();
    }
  });

  it("classifies an all-empty historical Run as repair_required without changing runs", () => {
    const db = openDb();
    insertRun(db, "run_empty");
    const before = axisColumns(db, "run_empty");
    try {
      const [item] = db.executionAxisMigration.audit({ now });
      expect(item).toMatchObject({
        runId: "run_empty",
        classification: "repair_required",
      });
      expect(item.reason).toContain("no canonical execution-axis provenance");
      expect(axisColumns(db, "run_empty")).toEqual(before);
      expect(db.executionAxisMigration.listUnresolved()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("quarantines a partial persisted axis and never silently promotes prior quarantine", () => {
    const db = openContractedAfter((opened) =>
      insertRun(opened, "run_partial", { orchestrationMode: "direct" }),
    );
    const evidence: ExecutionAxisMigrationEvidence = {
      runId: "run_partial",
      provenance: { source: "operator", reference: "ticket-42" },
      orchestrationMode: "direct",
      transport: "sdk",
      placementSnapshot: placement("partial"),
    };
    try {
      const first = db.executionAxisMigration.audit({ now });
      expect(first[0]?.classification).toBe("quarantined");

      const second = db.executionAxisMigration.audit({
        now: "2026-09-12T10:01:00.000Z",
        evidence: [evidence],
      });
      expect(second[0]?.classification).toBe("quarantined");
      expect(second[0]?.reason).toContain("partial execution-axis projection");
      expect(db.executionAxisMigration.list()).toHaveLength(2);
      expect(axisColumns(db, "run_partial")).toEqual({
        orchestration_mode: "direct",
        transport: null,
        execution_snapshot_id: null,
        placement_snapshot_json: null,
      });
    } finally {
      db.close();
    }
  });

  it("keeps a quarantine sticky when an older repair-required source returns", () => {
    const db = openDb();
    insertRun(db, "run_quarantine_cycle");
    try {
      expect(db.executionAxisMigration.audit({ now })[0]?.classification).toBe("repair_required");
      db.connection
        .prepare("UPDATE runs SET orchestration_mode = ? WHERE id = ?")
        .run("direct", "run_quarantine_cycle");
      expect(
        db.executionAxisMigration.audit({ now: "2026-09-12T10:01:00.000Z" })[0]?.classification,
      ).toBe("quarantined");
      db.connection
        .prepare("UPDATE runs SET orchestration_mode = NULL WHERE id = ?")
        .run("run_quarantine_cycle");

      const [returned] = db.executionAxisMigration.audit({ now: "2026-09-12T10:02:00.000Z" });
      expect(returned?.classification).toBe("quarantined");
      expect(returned?.reason).toContain("prior quarantine retained");
      expect(returned?.auditSequence).toBeGreaterThan(2);
      expect(db.executionAxisMigration.list()).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it("records canonical Runs as already_canonical and is idempotent", () => {
    const db = openDb();
    insertRun(db, "run_canonical", {
      orchestrationMode: "direct",
      transport: "sdk",
      placementSnapshot: placement("canonical"),
    });
    try {
      const first = db.executionAxisMigration.audit({ now });
      expect(first[0]).toMatchObject({
        runId: "run_canonical",
        classification: "already_canonical",
      });
      const second = db.executionAxisMigration.audit({ now: "2026-09-12T10:01:00.000Z" });
      expect(second[0]).toEqual(first[0]);
      expect(db.executionAxisMigration.list()).toHaveLength(1);
      expect(db.executionAxisMigration.listUnresolved()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("records changed external evidence as repair-required, without writing a snapshot", () => {
    const db = openDb();
    insertRun(db, "run_evidence");
    const evidence: ExecutionAxisMigrationEvidence = {
      runId: "run_evidence",
      provenance: { source: "operator", reference: "ticket-43" },
      orchestrationMode: "direct",
      transport: "sdk",
      placementSnapshot: placement("evidence"),
    };
    const before = axisColumns(db, "run_evidence");
    try {
      expect(db.executionAxisMigration.audit({ now })[0]?.classification).toBe("repair_required");
      const changed = db.executionAxisMigration.audit({
        now: "2026-09-12T10:01:00.000Z",
        evidence: [evidence],
      });
      expect(changed[0]?.classification).toBe("repair_required");
      expect(db.executionAxisMigration.list()).toHaveLength(2);
      expect(changed[0]?.sourceDigest).not.toBe(db.executionAxisMigration.list()[0]?.sourceDigest);
      expect(axisColumns(db, "run_evidence")).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("stores only evidence digests and survives later legacy Run removal", () => {
    const db = openDb();
    insertRun(db, "run_sanitized");
    const secret = "never-persist-this-secret";
    try {
      const [item] = db.executionAxisMigration.audit({
        now,
        evidence: [
          {
            runId: "run_sanitized",
            provenance: { source: "operator", reference: `token=${secret}` },
            orchestrationMode: "direct",
            transport: "sdk",
            placementSnapshot: { ...placement("sanitized"), token: secret, unknown: { secret } },
          },
        ],
      });
      expect(item?.classification).toBe("repair_required");
      expect(JSON.stringify(item?.source)).not.toContain(secret);
      expect(JSON.stringify(item?.source)).not.toContain('"token"');

      db.connection.prepare("DELETE FROM runs WHERE id = ?").run("run_sanitized");
      expect(db.executionAxisMigration.list()).toHaveLength(1);
      expect(db.executionAxisMigration.list()[0]?.runId).toBe("run_sanitized");
    } finally {
      db.close();
    }
  });

  it("does not copy malformed database axis values into the audit ledger", () => {
    const db = openContractedAfter((opened) => {
      insertRun(opened, "run_malformed_database");
      const secret = "database-secret-must-not-be-copied";
      opened.connection
        .prepare(
          `UPDATE runs
              SET orchestration_mode = ?, transport = ?, execution_snapshot_id = ?, placement_snapshot_json = ?
            WHERE id = ?`,
        )
        .run(
          `token=${secret}`,
          `path:C:\\private\\${secret}`,
          secret,
          JSON.stringify({ token: secret, sidecar: { secret } }),
          "run_malformed_database",
        );
    });
    const secret = "database-secret-must-not-be-copied";
    try {
      const [item] = db.executionAxisMigration.audit({ now });
      expect(item?.classification).toBe("quarantined");
      expect(JSON.stringify(item?.source)).not.toContain(secret);
      expect(JSON.stringify(item?.source)).not.toContain("token=");
      expect(JSON.stringify(item?.source)).not.toContain("path:C:\\private");
    } finally {
      db.close();
    }
  });

  function openDb() {
    const dir = mkdtempSync(join(tmpdir(), "wf-axis-audit-"));
    dirs.push(dir);
    // 008 audit tests mutate historical nullable axes. Apply 001–010 first so
    // 013's insert/update triggers are not yet present; unresolved rows stay
    // readable after 011–014 because those triggers do not rewrite existing rows.
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"), { migrate: false });
    db.connection.exec(SCHEMA_MIGRATIONS_DDL);
    const stop = MIGRATIONS.findIndex((item) => item.version === "010_authoring_chat_metadata");
    for (const migration of MIGRATIONS.slice(0, stop + 1)) {
      db.connection.exec(migration.sql);
      db.connection
        .prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, checksumSql(migration.sql), now);
    }
    return db;
  }

  function openContractedAfter(seed: (db: WorkforceSqlite) => void): WorkforceSqlite {
    const db = openDb();
    seed(db);
    migrate(db.connection, now);
    return db;
  }
});

function insertRun(
  db: WorkforceSqlite,
  runId: string,
  axes: {
    orchestrationMode?: string;
    transport?: string;
    executionSnapshotId?: string;
    placementSnapshot?: Record<string, unknown>;
  } = {},
): void {
  db.seedMinimalGraph(
    { organizationId: `org_${runId}`, projectId: `prj_${runId}`, taskId: `tsk_${runId}` },
    "2026-09-12T09:00:00.000Z",
  );
  db.connection
    .prepare(
      `INSERT INTO runs (
         id, organization_id, task_id, attempt, generation, definition_revision,
         status, state_revision, orchestration_mode, transport, execution_snapshot_id,
         placement_snapshot_json, created_at
       ) VALUES (?, ?, ?, 1, 1, 1, 'succeeded', 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      `org_${runId}`,
      `tsk_${runId}`,
      axes.orchestrationMode ?? null,
      axes.transport ?? null,
      axes.executionSnapshotId ?? null,
      axes.placementSnapshot === undefined ? null : JSON.stringify(axes.placementSnapshot),
      "2026-09-12T09:00:00.000Z",
    );
}

function placement(suffix: string): Record<string, unknown> {
  return {
    nodeId: `node_${suffix}`,
    nodeSessionId: `session_${suffix}`,
    runtimeInstallationId: `runtime_${suffix}`,
    workspaceInstanceId: `workspace_${suffix}`,
    executionLeaseId: `lease_${suffix}`,
    fencingToken: 1,
  };
}

function axisColumns(db: WorkforceSqlite, runId: string): Record<string, unknown> {
  return db.connection
    .prepare(
      `SELECT orchestration_mode, transport, execution_snapshot_id, placement_snapshot_json
         FROM runs WHERE id = ?`,
    )
    .get(runId) as Record<string, unknown>;
}
