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
  const scope = {
    organizationId: ids.organizationId,
    projectId: ids.projectId,
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
        db.catalogWorkflows.upsert(tx, {
          id: workflowDraft.workflowId,
          name: "Authoring workflow",
          description: "",
          status: "draft",
          stateRevision: 1,
          definitionRevision: 1,
          createdAt: now,
          updatedAt: now,
        });
        db.workflowAuthoringScopes.create(tx, {
          workflowId: workflowDraft.workflowId,
          organizationId: ids.organizationId,
          projectId: ids.projectId,
          createdAt: now,
          createdBy: "usr_author",
        });
        db.workflowDrafts.append(tx, workflowDraft, 0, scope);
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
        db.workflowDrafts.append(tx, nextWorkflow, 1, scope);
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

  it("requires workflow authority and rejects cross-project or cross-organization bindings", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const other = {
      organizationId: "org_other",
      projectId: "prj_other",
      taskId: "tsk_other",
    };
    db.seedMinimalGraph(other, now);
    try {
      await db.uow.withTransaction(async (tx) => {
        db.catalogWorkflows.upsert(tx, {
          id: "wf_scoped",
          name: "Scoped workflow",
          description: "",
          status: "draft",
          stateRevision: 1,
          definitionRevision: 1,
          createdAt: now,
          updatedAt: now,
        });
        db.workflowAuthoringScopes.create(tx, {
          workflowId: "wf_scoped",
          organizationId: ids.organizationId,
          projectId: ids.projectId,
          createdAt: now,
          createdBy: "usr_author",
        });
        expect(db.workflowAuthoringScopes.getInTransaction(tx, "wf_scoped")).toEqual({
          workflowId: "wf_scoped",
          organizationId: ids.organizationId,
          projectId: ids.projectId,
          createdAt: now,
          createdBy: "usr_author",
        });
        expect(
          db.workflowAuthoringScopes.requireInTransaction(tx, "wf_scoped", {
            organizationId: ids.organizationId,
            projectId: ids.projectId,
          }),
        ).toMatchObject({ workflowId: "wf_scoped" });
      });

      await expect(
        db.uow.withTransaction(async (tx) => {
          db.workflowAuthoringScopes.requireInTransaction(tx, "wf_scoped", {
            projectId: other.projectId,
          });
        }),
      ).rejects.toMatchObject({ code: "constraint" });

      await db.uow.withTransaction(async (tx) => {
        db.catalogWorkflows.upsert(tx, {
          id: "wf_other",
          name: "Other workflow",
          description: "",
          status: "draft",
          stateRevision: 1,
          definitionRevision: 1,
          createdAt: now,
          updatedAt: now,
        });
      });
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.workflowAuthoringScopes.create(tx, {
            workflowId: "wf_other",
            organizationId: ids.organizationId,
            projectId: other.projectId,
            createdAt: now,
            createdBy: "usr_author",
          });
        }),
      ).rejects.toMatchObject({ code: "constraint" });

      await expect(
        db.uow.withTransaction(async (tx) => {
          db.workflowDrafts.append(
            tx,
            { ...sampleWorkflowDraft(), workflowId: "wf_legacy" },
            0,
            scope,
          );
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      db.close();
    }
  });

  it("does not grant workflow authority from proposed, failed, or applied ChangeSets", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const statuses: AuthoringChangeSetDto["status"][] = ["proposed", "failed", "applied"];
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insertPending(tx, {
          runId: "run_status",
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_status",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          createdAt: now,
        });
      });
      for (const [index, status] of statuses.entries()) {
        await db.uow.withTransaction(async (tx) => {
          db.authoringChangeSets.insert(tx, {
            ...sampleChangeSet(),
            id: `acs_status_${index}`,
            sourceRunId: "run_status",
            status,
            steps: sampleChangeSet().steps.map((step) => ({
              ...step,
              id: `acst_status_${index}`,
            })),
          });
        });
      }

      expect(db.authoringChangeSets.listAll()).toHaveLength(statuses.length);
      expect(db.workflowAuthoringScopes.listAll()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("reads revision and rolls back authority plus draft in the same SQLite transaction", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const workflow = sampleWorkflowDraft();
    try {
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.catalogWorkflows.upsert(tx, {
            id: workflow.workflowId,
            name: "Transactional workflow",
            description: "",
            status: "draft",
            stateRevision: 1,
            definitionRevision: 1,
            createdAt: now,
            updatedAt: now,
          });
          db.workflowAuthoringScopes.create(tx, {
            workflowId: workflow.workflowId,
            organizationId: ids.organizationId,
            projectId: ids.projectId,
            createdAt: now,
            createdBy: "usr_author",
          });
          expect(db.workflowDrafts.getCurrentRevision(tx, workflow.workflowId, scope)).toBe(0);
          db.workflowDrafts.append(tx, workflow, 0, scope);
          expect(db.workflowDrafts.getCurrentRevision(tx, workflow.workflowId, scope)).toBe(1);
          throw new Error("rollback authoring transaction");
        }),
      ).rejects.toThrow("rollback authoring transaction");

      expect(db.workflowAuthoringScopes.get(workflow.workflowId)).toBeNull();
      expect(db.workflowDrafts.get(workflow.id)).toBeNull();
      expect(
        db.connection
          .prepare("SELECT id FROM catalog_workflows WHERE id = ?")
          .get(workflow.workflowId),
      ).toBeUndefined();
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
