import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";

/**
 * D02: the project execution snapshot is written once and never updated.
 * Platform: Windows + Node 24. macOS / Linux: untested.
 */
describe("project execution snapshot", () => {
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

  const now = "2026-09-11T10:00:00.000Z";

  function seedProject(db: ReturnType<typeof openDb>): void {
    db.connection
      .prepare(
        `INSERT INTO organizations (id, name, slug, settings_json, created_at, updated_at)
         VALUES ('org_1', 'Local', 'slug-org_1', '{}', ?, ?)`,
      )
      .run(now, now);
    db.connection
      .prepare(
        `INSERT INTO projects (id, organization_id, name, objective, status, state_revision,
           created_at, updated_at)
         VALUES ('prj_1', 'org_1', 'P', 'objective', 'planning', 1, ?, ?)`,
      )
      .run(now, now);
    db.connection
      .prepare(
        `INSERT INTO workflow_versions (id, workflow_id, version, definition_json, content_hash,
           created_at)
         VALUES ('wfv_1', 'wf_1', 1, '{}', 'sha256:w', ?)`,
      )
      .run(now);
    db.connection
      .prepare(
        `INSERT INTO team_versions (id, team_id, version, definition_json, content_hash, created_at)
         VALUES ('tmv_1', 'tm_1', 1, '{}', 'sha256:t', ?)`,
      )
      .run(now);
  }

  function snapshot(overrides: Record<string, unknown> = {}) {
    return {
      id: "snp_1",
      projectId: "prj_1",
      workflowVersionId: "wfv_1",
      teamVersionId: "tmv_1",
      contentHash: "sha256:snp",
      policySnapshot: { policyVersion: 1 },
      createdAt: now,
      ...overrides,
    };
  }

  it("writes a snapshot and reads it back with the exact versions", () => {
    const db = openDb();
    try {
      seedProject(db);
      db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.executionSnapshots.insert(tx, snapshot());
      });
      const stored = db.worldSnapshot.executionSnapshots.get("snp_1");
      expect(stored?.workflowVersionId).toBe("wfv_1");
      expect(stored?.teamVersionId).toBe("tmv_1");
      expect(stored?.policySnapshot).toEqual({ policyVersion: 1 });
      expect(stored?.budgetSnapshot).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("is insert-once: re-inserting the same content is a no-op", () => {
    const db = openDb();
    try {
      seedProject(db);
      db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.executionSnapshots.insert(tx, snapshot());
      });
      db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.executionSnapshots.insert(tx, snapshot());
      });
      expect(db.worldSnapshot.executionSnapshots.listAll()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects an attempt to rewrite a snapshot with different content", () => {
    const db = openDb();
    try {
      seedProject(db);
      db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.executionSnapshots.insert(tx, snapshot());
      });
      expect(() =>
        db.uow.withTransaction(async (tx) => {
          db.worldSnapshot.executionSnapshots.insert(
            tx,
            snapshot({ contentHash: "sha256:other", teamVersionId: "tmv_1" }),
          );
        }),
      ).rejects.toThrow(/different content hash/);
      expect(db.worldSnapshot.executionSnapshots.get("snp_1")?.contentHash).toBe("sha256:snp");
    } finally {
      db.close();
    }
  });

  it("round-trips through the world snapshot", () => {
    const db = openDb();
    try {
      seedProject(db);
      db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.executionSnapshots.insert(
          tx,
          snapshot({ budgetSnapshot: { limitMinor: 100 } }),
        );
      });
      const loaded = db.worldSnapshot.load();
      expect(loaded.executionSnapshots).toHaveLength(1);
      expect(loaded.executionSnapshots[0]?.id).toBe("snp_1");
      expect(loaded.executionSnapshots[0]?.budgetSnapshot).toEqual({ limitMinor: 100 });
    } finally {
      db.close();
    }
  });

  it("requires the referenced versions to exist", () => {
    const db = openDb();
    try {
      seedProject(db);
      expect(() =>
        db.uow.withTransaction(async (tx) => {
          db.worldSnapshot.executionSnapshots.insert(
            tx,
            snapshot({ workflowVersionId: "wfv_missing" }),
          );
        }),
      ).rejects.toThrow(/constraint/);
    } finally {
      db.close();
    }
  });
});
