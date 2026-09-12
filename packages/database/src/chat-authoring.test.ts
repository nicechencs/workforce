import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";

const now = "2026-09-12T10:00:00.000Z";
const graph = { organizationId: "org_chat", projectId: "prj_chat", taskId: "tsk_chat" };

describe("D17 persistent chat authoring metadata", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function openDb(path?: string): WorkforceSqlite {
    const dir = path ? undefined : mkdtempSync(join(tmpdir(), "wf-chat-"));
    if (dir) dirs.push(dir);
    const file = path ?? join(dir!, "workforce.sqlite");
    const db = WorkforceSqlite.open(file);
    db.seedMinimalGraph(graph, now);
    return db;
  }

  async function seedRun(db: WorkforceSqlite, runId = "run_chat") {
    await db.uow.withTransaction((tx) => {
      db.runs.insertPending(tx, {
        runId,
        organizationId: graph.organizationId,
        taskId: graph.taskId,
        operationId: `op_${runId}`,
        attempt: 1,
        generation: 1,
        definitionRevision: 1,
        createdAt: now,
      });
    });
  }

  async function createChain(db: WorkforceSqlite) {
    await seedRun(db);
    await db.uow.withTransaction((tx) => {
      db.authoringSessions.create(tx, {
        id: "acs_chat",
        organizationId: graph.organizationId,
        projectId: graph.projectId,
        protocolVersion: "0.1",
        createdAt: now,
        updatedAt: now,
      });
      db.authoringSessions.addMessage(tx, {
        id: "acm_chat",
        sessionId: "acs_chat",
        role: "user",
        contentRef: "content://chat/acm_chat",
        contentHash: "sha256:user",
        redactedPreview: "create a workflow",
        retentionUntil: "2026-10-12T00:00:00.000Z",
        createdAt: now,
      });
      db.authoringTurns.create(tx, {
        id: "act_chat",
        sessionId: "acs_chat",
        organizationId: graph.organizationId,
        projectId: graph.projectId,
        sourceRunId: "run_chat",
        protocolVersion: "0.1",
        status: "awaiting_confirmation",
        patchRefs: ["patch_chat"],
        changeSetId: "acs_change",
        workflowDraftId: "wfd_chat",
        createdAt: now,
        updatedAt: now,
      });
      db.authoringProposals.create(tx, {
        id: "apr_chat",
        sessionId: "acs_chat",
        turnId: "act_chat",
        organizationId: graph.organizationId,
        projectId: graph.projectId,
        sourceRunId: "run_chat",
        proposalRef: "artifact://proposal/apr_chat",
        proposalHash: "sha256:proposal",
        redactedPreview: "workflow proposal",
        targets: [
          {
            ordinal: 1,
            targetType: "workflow",
            operation: "create",
            patchRef: "patch_chat",
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  it("persists and reloads session, refs, message metadata and patch binding", async () => {
    const fileDir = mkdtempSync(join(tmpdir(), "wf-chat-reopen-"));
    dirs.push(fileDir);
    const path = join(fileDir, "workforce.sqlite");
    const db = openDb(path);
    await createChain(db);
    expect(db.authoringPatches.getInTransaction).toBeTypeOf("function");
    db.close();

    const reopened = WorkforceSqlite.open(path);
    try {
      const session = reopened.authoringSessions.get("acs_chat");
      expect(session).toMatchObject({ id: "acs_chat", projectId: graph.projectId });
      expect(reopened.authoringTurns.get("act_chat")).toMatchObject({
        sessionId: "acs_chat",
        sourceRunId: "run_chat",
        patchRefs: ["patch_chat"],
        changeSetId: "acs_change",
        workflowDraftId: "wfd_chat",
      });
      expect(reopened.authoringProposals.get("apr_chat")?.targets).toEqual([
        expect.objectContaining({ patchRef: "patch_chat", operation: "create" }),
      ]);
      const binding = await reopened.uow.withTransaction((tx) =>
        reopened.authoringPatches.getInTransaction(tx, "patch_chat"),
      );
      expect(binding).toEqual({
        patchRef: "patch_chat",
        organizationId: graph.organizationId,
        projectId: graph.projectId,
        sessionId: "acs_chat",
        turnId: "act_chat",
        sourceRunId: "run_chat",
      });
    } finally {
      reopened.close();
    }
  });

  it("completes a turn by state CAS and rejects a second idempotency key", async () => {
    const db = openDb();
    await createChain(db);
    try {
      const first = await db.uow.withTransaction((tx) =>
        db.authoringTurns.complete(tx, {
          turnId: "act_chat",
          expectedStateRevision: 1,
          idempotencyKey: "confirm-a",
          proposalId: "apr_chat",
          at: now,
        }),
      );
      expect(first).toMatchObject({ status: "completed", stateRevision: 2 });
      const same = await db.uow.withTransaction((tx) =>
        db.authoringTurns.complete(tx, {
          turnId: "act_chat",
          expectedStateRevision: 2,
          idempotencyKey: "confirm-a",
          at: now,
        }),
      );
      expect(same.completedOperationId).toBe("confirm-a");
      await expect(
        db.uow.withTransaction((tx) =>
          db.authoringTurns.complete(tx, {
            turnId: "act_chat",
            expectedStateRevision: 2,
            idempotencyKey: "confirm-b",
            at: now,
          }),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    } finally {
      db.close();
    }
  });

  it("rejects cross-project and cross-run bindings in one transaction", async () => {
    const db = openDb();
    const other = { organizationId: "org_other", projectId: "prj_other", taskId: "tsk_other" };
    db.seedMinimalGraph(other, now);
    try {
      await seedRun(db);
      await db.uow.withTransaction((tx) =>
        db.authoringSessions.create(tx, {
          id: "acs_scope",
          organizationId: graph.organizationId,
          projectId: graph.projectId,
          protocolVersion: "0.1",
          createdAt: now,
          updatedAt: now,
        }),
      );
      await db.uow.withTransaction((tx) =>
        db.runs.insert(tx, {
          runId: "run_other",
          organizationId: other.organizationId,
          taskId: other.taskId,
          operationId: "op_other",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          status: "succeeded",
          createdAt: now,
        }),
      );
      await expect(
        db.uow.withTransaction((tx) =>
          db.authoringTurns.create(tx, {
            id: "act_bad_scope",
            sessionId: "acs_scope",
            organizationId: other.organizationId,
            projectId: other.projectId,
            sourceRunId: "run_chat",
            protocolVersion: "0.1",
            status: "accepted",
            createdAt: now,
            updatedAt: now,
          }),
        ),
      ).rejects.toMatchObject({ code: "constraint" });
      await expect(
        db.uow.withTransaction((tx) =>
          db.authoringTurns.create(tx, {
            id: "act_bad_run",
            sessionId: "acs_scope",
            organizationId: graph.organizationId,
            projectId: graph.projectId,
            sourceRunId: "run_other",
            protocolVersion: "0.1",
            status: "accepted",
            createdAt: now,
            updatedAt: now,
          }),
        ),
      ).rejects.toMatchObject({ code: "constraint" });
    } finally {
      db.close();
    }
  });

  it("rolls back the complete authoring setup when event/confirm work fails", async () => {
    const db = openDb();
    await seedRun(db);
    try {
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.authoringSessions.create(tx, {
            id: "acs_rollback",
            organizationId: graph.organizationId,
            projectId: graph.projectId,
            protocolVersion: "0.1",
            createdAt: now,
            updatedAt: now,
          });
          db.authoringSessions.addMessage(tx, {
            id: "acm_rollback",
            sessionId: "acs_rollback",
            role: "user",
            contentRef: "content://rollback",
            contentHash: "sha256:rollback",
            createdAt: now,
          });
          db.authoringTurns.create(tx, {
            id: "act_rollback",
            sessionId: "acs_rollback",
            organizationId: graph.organizationId,
            projectId: graph.projectId,
            sourceRunId: "run_chat",
            protocolVersion: "0.1",
            status: "awaiting_confirmation",
            createdAt: now,
            updatedAt: now,
          });
          throw new Error("event append failed");
        }),
      ).rejects.toThrow("event append failed");
      expect(db.authoringSessions.get("acs_rollback")).toBeNull();
      expect(
        db.connection.prepare("SELECT COUNT(*) AS count FROM authoring_messages").get(),
      ).toEqual({ count: 0 });
      expect(db.authoringTurns.get("act_rollback")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("stores no raw content or proposal summary and catalog identity is create-only", async () => {
    const db = openDb();
    try {
      const messageColumns = db.connection.prepare("PRAGMA table_info(authoring_messages)").all();
      const proposalColumns = db.connection.prepare("PRAGMA table_info(authoring_proposals)").all();
      expect(messageColumns.map((column) => column.name)).not.toContain("content");
      expect(proposalColumns.map((column) => column.name)).not.toContain("summary");
      const workflow = {
        id: "wf_create_only",
        name: "Original",
        description: "",
        status: "draft" as const,
        stateRevision: 1,
        definitionRevision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await db.uow.withTransaction((tx) => db.catalogWorkflows.create(tx, workflow));
      await expect(
        db.uow.withTransaction((tx) =>
          db.catalogWorkflows.create(tx, { ...workflow, name: "Must not overwrite" }),
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(db.catalogWorkflows.listAll().find((entry) => entry.id === workflow.id)?.name).toBe(
        "Original",
      );
    } finally {
      db.close();
    }
  });
});
