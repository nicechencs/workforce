import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuthoringChangeSetDto, TeamDraftDto, WorkflowDraftDto } from "@workforce/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";

describe("authoring repositories", () => {
  const dirs: string[] = [];
  const now = "2026-09-12T10:00:00.000Z";
  const later = "2026-09-12T10:01:00.000Z";
  const ids = {
    organizationId: "org_authoring",
    projectId: "prj_authoring",
    taskId: "tsk_authoring",
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openDb(): WorkforceSqlite {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-authoring-"));
    dirs.push(dir);
    return WorkforceSqlite.open(join(dir, "workforce.sqlite"));
  }

  it("appends workflow and team drafts only with the expected preceding revision", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const workflowDraft = sampleWorkflowDraft();
    const teamDraft = sampleTeamDraft();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.workflowDrafts.append(tx, workflowDraft, 0);
        db.teamDrafts.append(tx, teamDraft, 0);
      });
      expect(db.workflowDrafts.get(workflowDraft.id)).toEqual(workflowDraft);
      expect(db.teamDrafts.listByTeam(teamDraft.teamId)).toEqual([teamDraft]);

      const nextWorkflow = {
        ...workflowDraft,
        id: "wfd_2",
        revision: 2,
        contentHash: "sha256:workflow-2",
        updatedAt: later,
      };
      await db.uow.withTransaction(async (tx) => {
        db.workflowDrafts.append(tx, nextWorkflow, 1);
      });
      expect(db.workflowDrafts.listByWorkflow(workflowDraft.workflowId)).toEqual([
        workflowDraft,
        nextWorkflow,
      ]);
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.teamDrafts.append(tx, { ...teamDraft, id: "tmd_stale", revision: 2 }, 0);
        }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
    } finally {
      db.close();
    }
  });

  it("writes all ChangeSet steps atomically and advances them with status CAS", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const changeSet = sampleChangeSet();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insertPending(tx, {
          runId: changeSet.sourceRunId,
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_authoring",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          createdAt: now,
        });
        db.authoringChangeSets.insert(tx, changeSet);
      });
      expect(db.authoringChangeSets.get(changeSet.id)).toEqual(changeSet);

      await db.uow.withTransaction(async (tx) => {
        db.authoringChangeSets.updateStatus(tx, changeSet.id, "proposed", "applying", later);
        db.authoringChangeSets.updateStep(tx, {
          changeSetId: changeSet.id,
          stepId: changeSet.steps[0].id,
          expectedStatus: "pending",
          status: "applying",
          startedAt: later,
        });
      });
      expect(db.authoringChangeSets.get(changeSet.id)).toMatchObject({
        status: "applying",
        steps: [{ status: "applying", startedAt: later }],
      });

      await expect(
        db.uow.withTransaction(async (tx) => {
          db.authoringChangeSets.updateStep(tx, {
            changeSetId: changeSet.id,
            stepId: changeSet.steps[0].id,
            expectedStatus: "pending",
            status: "applied",
            resultRevision: 2,
            completedAt: later,
          });
        }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
    } finally {
      db.close();
    }
  });

  it("rejects a ChangeSet whose source Run belongs to another project", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const changeSet = sampleChangeSet();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insertPending(tx, {
          runId: changeSet.sourceRunId,
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_authoring",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          createdAt: now,
        });
      });
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.authoringChangeSets.insert(tx, { ...changeSet, projectId: "prj_other" });
        }),
      ).rejects.toMatchObject({ code: "constraint" });
      expect(db.authoringChangeSets.get(changeSet.id)).toBeNull();
    } finally {
      db.close();
    }
  });

  function sampleWorkflowDraft(): WorkflowDraftDto {
    return {
      id: "wfd_1",
      workflowId: "wf_authoring",
      revision: 1,
      status: "draft",
      graph: {
        entryNodeIds: ["node_authoring"],
        nodes: [{ id: "node_authoring", kind: "task", title: "Authoring", role: "developer" }],
        edges: [],
        failurePolicy: { default: "fail" },
        concurrencyPolicy: { runWorktree: "isolated", integrationWorktree: "dedicated" },
      },
      contentHash: "sha256:workflow-1",
      updatedAt: now,
      updatedBy: "usr_author",
    };
  }

  function sampleTeamDraft(): TeamDraftDto {
    return {
      id: "tmd_1",
      teamId: "team_authoring",
      revision: 1,
      status: "draft",
      members: [{ role: "developer", runtimeProfileId: "rp_authoring", quantity: 1 }],
      contentHash: "sha256:team-1",
      updatedAt: now,
      updatedBy: "usr_author",
    };
  }

  function sampleChangeSet(): AuthoringChangeSetDto {
    return {
      id: "acs_1",
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      workflowId: "wf_authoring",
      sourceRunId: "run_authoring",
      status: "proposed",
      proposalRef: "arv_proposal",
      steps: [
        {
          id: "acst_1",
          ordinal: 1,
          targetType: "workflow",
          targetId: "wf_authoring",
          expectedRevision: 1,
          status: "pending",
          patchRef: "arv_patch",
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }
});
