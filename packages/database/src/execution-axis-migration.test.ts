import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";
import {
  SqliteExecutionAxisMigrationRepository,
  type ExecutionAxisMigrationEvidence,
} from "./execution-axis-migration.js";
import { appliedMigrations, checksumSql } from "./migrate.js";
import { MIGRATION_008_SQL } from "./schema.js";

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

  it("quarantines a partial axis and never silently promotes prior quarantine", () => {
    const db = openDb();
    insertRun(db, "run_partial");
    const partialEvidence: ExecutionAxisMigrationEvidence = {
      runId: "run_partial",
      provenance: { source: "operator", reference: "ticket-41" },
      orchestrationMode: "direct",
    };
    const evidence: ExecutionAxisMigrationEvidence = {
      runId: "run_partial",
      provenance: { source: "operator", reference: "ticket-42" },
      orchestrationMode: "direct",
      transport: "sdk",
      placementSnapshot: placement("partial"),
    };
    try {
      const first = db.executionAxisMigration.audit({ now, evidence: [partialEvidence] });
      expect(first[0]?.classification).toBe("quarantined");

      const second = db.executionAxisMigration.audit({
        now: "2026-09-12T10:01:00.000Z",
        evidence: [evidence],
      });
      expect(second[0]?.classification).toBe("quarantined");
      expect(second[0]?.reason).toContain("prior quarantine retained");
      expect(db.executionAxisMigration.list()).toHaveLength(2);
      expect(axisColumns(db, "run_partial")).toEqual({
        orchestration_mode: null,
        transport: null,
        execution_snapshot_id: null,
        placement_snapshot_json: null,
      });
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

  it("reclassifies on a changed source digest, without writing a snapshot", () => {
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
      const eligible = db.executionAxisMigration.audit({
        now: "2026-09-12T10:01:00.000Z",
        evidence: [evidence],
      });
      expect(eligible[0]?.classification).toBe("eligible");
      expect(db.executionAxisMigration.list()).toHaveLength(2);
      expect(eligible[0]?.sourceDigest).not.toBe(db.executionAxisMigration.list()[0]?.sourceDigest);
      expect(axisColumns(db, "run_evidence")).toEqual(before);
    } finally {
      db.close();
    }
  });

  function openDb() {
    const dir = mkdtempSync(join(tmpdir(), "wf-axis-audit-"));
    dirs.push(dir);
    return WorkforceSqlite.open(join(dir, "workforce.sqlite"));
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
