import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ApprovalRecord,
  ArtifactRecord,
  NodeInstanceRecord,
  ProjectRecord,
  TaskRecord,
  WorkflowGraph,
  WorkflowInstanceRecord,
} from "@workforce/application";
import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";
import { PersistenceError } from "./errors.js";

describe("entity repositories", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openDb() {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-ent-"));
    dirs.push(dir);
    return WorkforceSqlite.open(join(dir, "workforce.sqlite"));
  }

  const now = "2026-09-10T10:00:00.000Z";
  const ids = {
    organizationId: "org_test",
    projectId: "prj_test",
    taskId: "tsk_test",
  };

  it("inserts, loads, and CAS-updates a ProjectRecord including M3 columns", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const project = sampleProject({
      id: "prj_full",
      workspaceId: "ws_1",
      runtimeId: "rt_mock",
      budgetId: "bdg_1",
      executionNodeId: "nd_1",
      runtimeInstallationId: "ri_1",
      workspaceInstanceId: "wsi_1",
      teamVersionId: "tmv_1",
      planArtifactVersionId: "arv_plan",
    });
    try {
      await db.uow.withTransaction(async (tx) => {
        db.projects.insert(tx, project);
      });
      expect(db.projects.get("prj_full")).toEqual(project);
      expect(
        db.projects
          .listByOrganization(ids.organizationId)
          .map((row) => row.id)
          .sort(),
      ).toEqual(["prj_full", "prj_test"].sort());

      const next = {
        ...project,
        status: "planning" as const,
        stateRevision: 2,
        workflowVersionId: "wfv_m3",
        updatedAt: "2026-09-10T10:01:00.000Z",
      };
      await db.uow.withTransaction(async (tx) => {
        db.projects.update(tx, next, 1);
      });
      expect(db.projects.get("prj_full")).toEqual(next);

      await expect(
        db.uow.withTransaction(async (tx) => {
          db.projects.update(tx, { ...next, status: "ready", stateRevision: 3 }, 1);
        }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      expect(db.projects.get("prj_full")?.stateRevision).toBe(2);
    } finally {
      db.close();
    }
  });

  it("inserts, lists by project, and CAS-updates tasks with JSON fields", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const task = sampleTask();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.tasks.insert(tx, task);
      });
      expect(db.tasks.get(task.id)).toEqual(task);
      expect(
        db.tasks
          .listByProject(ids.projectId)
          .map((row) => row.id)
          .sort(),
      ).toEqual([ids.taskId, task.id].sort());

      const next: TaskRecord = {
        ...task,
        status: "queued",
        stateRevision: 2,
        outputBindings: { code: "arv_1" },
        updatedAt: "2026-09-10T10:01:00.000Z",
      };
      await db.uow.withTransaction(async (tx) => {
        db.tasks.update(tx, next, 1);
      });
      expect(db.tasks.get(task.id)).toEqual(next);

      await expect(
        db.uow.withTransaction(async (tx) => {
          db.tasks.update(tx, { ...next, stateRevision: 3, status: "running" }, 1);
        }),
      ).rejects.toBeInstanceOf(PersistenceError);
    } finally {
      db.close();
    }
  });

  it("round-trips a workflow instance graph and lists by project", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const workflow = sampleWorkflow();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.workflows.insert(tx, workflow, now);
      });
      expect(db.workflows.get(workflow.id)).toEqual(workflow);
      expect(db.workflows.listByProject(ids.projectId)).toEqual([workflow]);

      const next: WorkflowInstanceRecord = {
        ...workflow,
        status: "running",
        stateRevision: 2,
      };
      await db.uow.withTransaction(async (tx) => {
        db.workflows.update(tx, next, 1, now);
      });
      expect(db.workflows.get(workflow.id)?.status).toBe("running");
      expect(db.workflows.get(workflow.id)?.graph).toEqual(sampleGraph());

      await expect(
        db.uow.withTransaction(async (tx) => {
          db.workflows.update(tx, { ...next, stateRevision: 3, status: "paused" }, 1, now);
        }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
    } finally {
      db.close();
    }
  });

  it("inserts approvals and artifacts listed by project", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const approval = sampleApproval();
    const artifact = sampleArtifact();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.approvals.insert(tx, approval);
        db.artifacts.insert(tx, artifact, now);
      });
      expect(db.approvals.get(approval.id)).toEqual(approval);
      expect(db.approvals.listByProject(ids.projectId)).toEqual([approval]);
      expect(db.artifacts.get(artifact.artifactVersionId)).toEqual(artifact);
      expect(db.artifacts.listByProject(ids.projectId)).toEqual([artifact]);

      const next: ApprovalRecord = {
        ...approval,
        status: "consumed",
        stateRevision: 2,
      };
      await db.uow.withTransaction(async (tx) => {
        db.approvals.update(tx, next, 1);
      });
      expect(db.approvals.get(approval.id)?.status).toBe("consumed");
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.approvals.update(tx, { ...next, stateRevision: 3, status: "cancelled" }, 1);
        }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
    } finally {
      db.close();
    }
  });

  it("CAS-updates node instances and lists them by project", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    const workflow = sampleWorkflow();
    const node = sampleNode();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.workflows.insert(tx, workflow, now);
        db.nodeInstances.insert(tx, node);
      });
      expect(db.nodeInstances.get(node.id)).toEqual(node);
      expect(db.nodeInstances.listByProject(ids.projectId)).toEqual([node]);

      const next: NodeInstanceRecord = { ...node, status: "active", stateRevision: 2 };
      await db.uow.withTransaction(async (tx) => {
        db.nodeInstances.update(tx, next, 1);
      });
      expect(db.nodeInstances.get(node.id)?.status).toBe("active");
    } finally {
      db.close();
    }
  });

  it("still rejects a second active run for the same task", async () => {
    const db = openDb();
    db.seedMinimalGraph(ids, now);
    try {
      await db.uow.withTransaction(async (tx) => {
        db.runs.insertPending(tx, {
          runId: "run_a",
          organizationId: ids.organizationId,
          taskId: ids.taskId,
          operationId: "op_a",
          attempt: 1,
          generation: 1,
          definitionRevision: 1,
          createdAt: now,
        });
      });
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.runs.insert(tx, {
            runId: "run_b",
            organizationId: ids.organizationId,
            taskId: ids.taskId,
            operationId: "op_b",
            attempt: 2,
            generation: 1,
            definitionRevision: 1,
            createdAt: now,
            status: "running",
          });
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(db.runs.listByProject(ids.projectId)).toHaveLength(1);
      expect(db.runs.activeForTask(ids.taskId)?.id).toBe("run_a");
    } finally {
      db.close();
    }
  });

  function sampleProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
    return {
      id: "prj_full",
      organizationId: ids.organizationId,
      name: "Full project",
      objective: "ship M3",
      status: "draft",
      stateRevision: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function sampleTask(): TaskRecord {
    return {
      id: "tsk_extra",
      projectId: ids.projectId,
      role: "developer",
      title: "Implement slice",
      status: "ready",
      stateRevision: 1,
      definitionRevision: 1,
      generation: 1,
      attempt: 1,
      maxAttempts: 2,
      maxReworkCycles: 1,
      priority: 80,
      requiresReview: true,
      expectedOutputs: [{ id: "code", kind: "code", required: true }],
      outputBindings: {},
      dependsOn: [{ taskId: ids.taskId, waitFor: "outputs_ready" }],
      inputArtifactVersionIds: ["arv_plan"],
      createdAt: now,
      updatedAt: now,
    };
  }

  function sampleGraph(): WorkflowGraph {
    return {
      id: "wfv_m3",
      workflowId: "wf_feature",
      version: 1,
      entryNodeIds: ["dev_a"],
      nodes: [{ id: "dev_a", kind: "task", role: "developer" }],
      edges: [],
    };
  }

  function sampleWorkflow(): WorkflowInstanceRecord {
    return {
      id: "wfi_1",
      projectId: ids.projectId,
      workflowVersionId: "wfv_m3",
      graph: sampleGraph(),
      status: "created",
      stateRevision: 1,
    };
  }

  function sampleNode(): NodeInstanceRecord {
    return {
      id: "wfn_1",
      workflowInstanceId: "wfi_1",
      nodeId: "dev_a",
      taskId: ids.taskId,
      status: "pending",
      generation: 1,
      stateRevision: 1,
    };
  }

  function sampleApproval(): ApprovalRecord {
    return {
      id: "apr_1",
      projectId: ids.projectId,
      taskId: ids.taskId,
      gate: "plan",
      status: "pending",
      stateRevision: 1,
      actionDigest: "digest-plan",
      resource: "artifactVersion:arv_plan",
      artifactVersionId: "arv_plan",
      createdAt: now,
    };
  }

  function sampleArtifact(): ArtifactRecord {
    return {
      artifactVersionId: "arv_plan",
      projectId: ids.projectId,
      taskId: ids.taskId,
      slotId: "plan",
      digest: "sha256:plan",
      status: "available",
    };
  }
});
