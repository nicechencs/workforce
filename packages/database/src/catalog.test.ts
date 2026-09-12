import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";

describe("catalog repositories", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists draft and published workflow / team catalog rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-cat-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const now = "2026-09-11T12:00:00.000Z";
    try {
      await db.uow.withTransaction(async (tx) => {
        db.catalogWorkflows.upsert(tx, {
          id: "wfd_1",
          name: "Custom",
          description: "",
          status: "draft",
          stateRevision: 1,
          definitionRevision: 1,
          createdAt: now,
          updatedAt: now,
        });
        db.catalogWorkflows.upsertVersion(tx, {
          id: "wfv_1",
          workflowId: "wfd_1",
          version: "1",
          status: "draft",
          immutable: false,
          stateRevision: 1,
          entry: "a",
          steps: [],
          nodes: [{ id: "a", kind: "task", role: "planner" }],
          edges: [],
          createdAt: now,
          updatedAt: now,
        });
        db.catalogTeams.upsert(tx, {
          id: "tm_1",
          name: "Squad",
          description: "",
          status: "published",
          stateRevision: 2,
          definitionRevision: 2,
          activeVersionId: "tmv_1",
          createdAt: now,
          updatedAt: now,
        });
        db.catalogTeams.upsertVersion(tx, {
          id: "tmv_1",
          teamId: "tm_1",
          version: "1",
          status: "published",
          immutable: true,
          stateRevision: 2,
          members: [{ id: "dev", role: "developer", runtimeProfileId: "mock", quantity: 1 }],
          publishedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      });

      expect(db.catalogWorkflows.listAll()[0]?.id).toBe("wfd_1");
      expect(db.catalogWorkflows.listVersions("wfd_1")[0]?.nodes[0]?.id).toBe("a");
      expect(db.catalogTeams.listVersions("tm_1")[0]?.immutable).toBe(true);
      expect(db.catalogTeams.listVersions("tm_1")[0]?.members[0]?.quantity).toBe(1);
    } finally {
      db.close();
    }
  });
});
