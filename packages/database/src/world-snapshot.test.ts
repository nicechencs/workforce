import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ApprovalRecord,
  ArtifactRecord,
  BudgetRecord,
  NodeInstanceRecord,
  ProjectRecord,
  ReservationRecord,
  RunRecord as AppRunRecord,
  TaskRecord,
  WorkflowInstanceRecord,
} from "@workforce/application";
import { afterEach, describe, expect, it } from "vitest";

import { WorkforceSqlite } from "./database.js";
import { unpublishedOutboxCount } from "./event-store.js";
import type { WorldEntitySnapshot } from "./world-snapshot.js";

function byArtifactId(left: ArtifactRecord, right: ArtifactRecord): number {
  return left.artifactVersionId.localeCompare(right.artifactVersionId);
}

describe("SqliteWorldSnapshot", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const now = "2026-09-10T10:00:00.000Z";
  const ids = {
    organizationId: "org_snap",
    projectId: "prj_snap",
    taskId: "tsk_snap",
  };

  it("reloads Project/Task/Workflow/Approval/Artifact after reopen without world.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const path = join(dir, "workforce.sqlite");
    const db = WorkforceSqlite.open(path);

    const snapshot = sampleSnapshot();
    await db.uow.withTransaction(async (tx) => {
      db.worldSnapshot.save(tx, snapshot, now);
    });
    expect(await db.events.read({ limit: 10 })).toEqual([]);
    expect(unpublishedOutboxCount(db.connection)).toBe(0);
    db.close();

    const reopened = WorkforceSqlite.open(path);
    try {
      const loaded = reopened.worldSnapshot.load();
      expect(loaded.projects).toEqual(snapshot.projects);
      expect(loaded.tasks).toEqual(snapshot.tasks);
      expect(loaded.workflows).toEqual(snapshot.workflows);
      expect(loaded.nodes).toEqual(snapshot.nodes);
      expect(loaded.approvals).toEqual(snapshot.approvals);
      expect([...loaded.artifacts].sort(byArtifactId)).toEqual(
        [...snapshot.artifacts].sort(byArtifactId),
      );
      expect(loaded.runs).toEqual(snapshot.runs);
      expect(loaded.budgets).toEqual(snapshot.budgets);
      expect(loaded.reservations).toEqual(snapshot.reservations);
      expect(loaded.usageKeys).toEqual(snapshot.usageKeys);
      expect(loaded.executionSnapshots).toEqual(snapshot.executionSnapshots);
      expect(reopened.projects.get(ids.projectId)?.workspaceId).toBe("ws_1");
      expect(reopened.projects.get(ids.projectId)?.runtimeId).toBe("rt_mock");
      expect(reopened.projects.get(ids.projectId)?.budgetId).toBe("bdg_1");
      expect(reopened.tasks.listByProject(ids.projectId)).toHaveLength(1);
      expect(reopened.runs.listByProject(ids.projectId)).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });

  it("writes an execution snapshot after its parent rows in the same save", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const path = join(dir, "workforce.sqlite");
    const db = WorkforceSqlite.open(path);
    const snapshot = sampleSnapshot();
    // The snapshot FKs reference projects / workflow_versions / team_versions that only
    // exist once the project and workflow loops of the same save have run.
    snapshot.executionSnapshots = [
      {
        id: "snp_snap",
        projectId: ids.projectId,
        workflowVersionId: "wfv_snap",
        teamVersionId: "tmv_1",
        contentHash: "sha256:snp",
        policySnapshot: { policyVersion: 1 },
        createdAt: now,
      },
    ];
    await db.uow.withTransaction(async (tx) => {
      db.worldSnapshot.save(tx, snapshot, now);
    });
    const loaded = db.worldSnapshot.load();
    expect(loaded.executionSnapshots).toHaveLength(1);
    expect(loaded.executionSnapshots[0]?.workflowVersionId).toBe("wfv_snap");
    expect(loaded.executionSnapshots[0]?.teamVersionId).toBe("tmv_1");
    db.close();
  });

  it("reloads budget, active reservation, and usage keys after reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const path = join(dir, "workforce.sqlite");
    const first = WorkforceSqlite.open(path);
    const snapshot = sampleSnapshot();
    const reserved: WorldEntitySnapshot = {
      ...snapshot,
      budgets: snapshot.budgets.map((budget) => ({
        ...budget,
        reservedMinor: 250,
        settledMinor: 80,
      })),
      reservations: [
        {
          id: "rsv_snap",
          budgetId: "bdg_1",
          amountMinor: 250,
          runId: "run_snap",
        },
      ],
      usageKeys: ["usage-1"],
    };
    try {
      await first.uow.withTransaction(async (tx) => {
        first.worldSnapshot.save(tx, reserved, now);
      });
    } finally {
      first.close();
    }

    const reopened = WorkforceSqlite.open(path);
    try {
      const loaded = reopened.worldSnapshot.load();
      expect(loaded.budgets).toEqual(reserved.budgets);
      expect(loaded.reservations).toEqual(reserved.reservations);
      expect(loaded.usageKeys).toEqual(["usage-1"]);

      await reopened.uow.withTransaction(async (tx) => {
        reopened.worldSnapshot.save(
          tx,
          {
            ...reserved,
            budgets: reserved.budgets.map((budget) => ({ ...budget, reservedMinor: 0 })),
            reservations: [], // intended: release every active reservation
            usageKeys: ["usage-1", "usage-2"],
          },
          now,
        );
      });
      const afterRelease = reopened.worldSnapshot.load();
      expect(afterRelease.reservations).toEqual([]);
      expect(afterRelease.budgets[0]?.reservedMinor).toBe(0);
      expect(afterRelease.usageKeys).toEqual(["usage-1", "usage-2"]);
      expect(reopened.reservations.get("rsv_snap")).toBeNull();
    } finally {
      reopened.close();
    }
  });

  it("persists cancelRequestedAt on the first Run snapshot insert", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const cancelRequestedAt = "2026-09-10T10:00:30.000Z";
    const snapshot = sampleSnapshot();
    snapshot.runs = snapshot.runs.map((run) => ({ ...run, cancelRequestedAt }));
    try {
      await db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.save(tx, snapshot, now);
      });

      expect(db.worldSnapshot.load().runs[0]?.cancelRequestedAt).toBe(cancelRequestedAt);
    } finally {
      db.close();
    }
  });

  it("persists the first cancelRequestedAt update for an existing Run across reload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const path = join(dir, "workforce.sqlite");
    const first = WorkforceSqlite.open(path);
    const snapshot = sampleSnapshot();
    const cancelRequestedAt = "2026-09-10T10:00:30.000Z";
    try {
      await first.uow.withTransaction(async (tx) => {
        first.worldSnapshot.save(tx, snapshot, now);
      });
      expect(first.worldSnapshot.load().runs[0]?.cancelRequestedAt).toBeUndefined();

      await first.uow.withTransaction(async (tx) => {
        first.worldSnapshot.save(
          tx,
          {
            ...snapshot,
            runs: snapshot.runs.map((run) => ({ ...run, cancelRequestedAt })),
          },
          now,
        );
      });

      // Missing or repeated requests cannot clear or replace the accepted intent.
      await first.uow.withTransaction(async (tx) => {
        first.worldSnapshot.save(tx, snapshot, now);
        first.worldSnapshot.save(
          tx,
          {
            ...snapshot,
            runs: snapshot.runs.map((run) => ({
              ...run,
              cancelRequestedAt: "2026-09-10T10:00:45.000Z",
            })),
          },
          now,
        );
      });
    } finally {
      first.close();
    }

    const reopened = WorkforceSqlite.open(path);
    try {
      expect(reopened.worldSnapshot.load().runs[0]?.cancelRequestedAt).toBe(cancelRequestedAt);
    } finally {
      reopened.close();
    }
  });

  it("round-trips a complete workflow-bound execution snapshot without inventing legacy axes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const path = join(dir, "workforce.sqlite");
    const first = WorkforceSqlite.open(path);
    const snapshot = sampleSnapshot();
    snapshot.runs = snapshot.runs.map((run) => ({
      ...run,
      executionSnapshot: {
        orchestrationMode: "workflow_bound",
        transport: "process",
        executionSnapshotId: "snp_snap",
        placementSnapshot: {
          nodeId: "nd_1",
          nodeSessionId: "ns_1",
          runtimeInstallationId: "ri_1",
          workspaceInstanceId: "wsi_1",
          executionLeaseId: "lease_1",
          fencingToken: 1,
        },
      },
    }));
    try {
      await first.uow.withTransaction(async (tx) => {
        first.worldSnapshot.save(tx, snapshot, now);
      });
    } finally {
      first.close();
    }

    const reopened = WorkforceSqlite.open(path);
    try {
      expect(reopened.worldSnapshot.load().runs).toEqual(snapshot.runs);
    } finally {
      reopened.close();
    }
  });

  it("rejects a partial or changed execution snapshot on an existing Run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const snapshot = sampleSnapshot();
    const executionSnapshot = {
      orchestrationMode: "direct" as const,
      transport: "sdk" as const,
      placementSnapshot: {
        nodeId: "nd_1",
        nodeSessionId: "ns_1",
        runtimeInstallationId: "ri_1",
        workspaceInstanceId: "wsi_1",
        executionLeaseId: "lease_1",
        fencingToken: 1,
      },
    };
    snapshot.runs = snapshot.runs.map((run) => ({ ...run, executionSnapshot }));
    try {
      await db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.save(tx, snapshot, now);
      });
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.worldSnapshot.save(
            tx,
            {
              ...snapshot,
              runs: snapshot.runs.map((run) => ({
                ...run,
                executionSnapshot: {
                  ...executionSnapshot,
                  placementSnapshot: { ...executionSnapshot.placementSnapshot, fencingToken: 2 },
                },
              })),
            },
            now,
          );
        }),
      ).rejects.toMatchObject({ code: "conflict" });

      db.connection
        .prepare("UPDATE runs SET orchestration_mode = NULL WHERE id = ?")
        .run("run_snap");
      expect(() => db.worldSnapshot.load()).toThrow(/partially populated/);
    } finally {
      db.close();
    }
  });

  it("rejects a non-undefined invalid execution snapshot from the world projection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const snapshot = sampleSnapshot();
    snapshot.runs = snapshot.runs.map((run) => ({
      ...run,
      executionSnapshot: null as never,
    }));
    try {
      await expect(
        db.uow.withTransaction((tx) => db.worldSnapshot.save(tx, snapshot, now)),
      ).rejects.toMatchObject({ code: "constraint" });
      expect(db.runs.get("run_snap")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("CAS-rejects a snapshot save that would rewind state_revision", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-db-snap-"));
    dirs.push(dir);
    const db = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const snapshot = sampleSnapshot();
    try {
      await db.uow.withTransaction(async (tx) => {
        db.worldSnapshot.save(tx, snapshot, now);
      });
      const stale: WorldEntitySnapshot = {
        ...snapshot,
        projects: snapshot.projects.map((project) => ({ ...project, stateRevision: 1 })),
      };
      await expect(
        db.uow.withTransaction(async (tx) => {
          db.worldSnapshot.save(tx, stale, now);
        }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      expect(db.projects.get(ids.projectId)?.stateRevision).toBe(2);
    } finally {
      db.close();
    }
  });

  function sampleSnapshot(): WorldEntitySnapshot {
    const project: ProjectRecord = {
      id: ids.projectId,
      organizationId: ids.organizationId,
      name: "Snap",
      objective: "reload",
      status: "running",
      stateRevision: 2,
      teamVersionId: "tmv_1",
      runtimeId: "rt_mock",
      workspaceId: "ws_1",
      budgetId: "bdg_1",
      executionNodeId: "nd_1",
      runtimeInstallationId: "ri_1",
      workspaceInstanceId: "wsi_1",
      workflowInstanceId: "wfi_snap",
      workflowVersionId: "wfv_snap",
      planArtifactVersionId: "arv_plan",
      createdAt: now,
      updatedAt: now,
    };
    const workflow: WorkflowInstanceRecord = {
      id: "wfi_snap",
      projectId: ids.projectId,
      workflowVersionId: "wfv_snap",
      executionSnapshotId: "snp_snap",
      graph: {
        id: "wfv_snap",
        workflowId: "wf_snap",
        version: 1,
        entryNodeIds: ["dev_a"],
        nodes: [{ id: "dev_a", kind: "task", role: "developer" }],
        edges: [],
      },
      status: "running",
      stateRevision: 2,
    };
    const task: TaskRecord = {
      id: ids.taskId,
      projectId: ids.projectId,
      workflowInstanceId: "wfi_snap",
      workflowNodeId: "dev_a",
      role: "developer",
      title: "dev_a",
      status: "running",
      stateRevision: 2,
      definitionRevision: 1,
      generation: 1,
      attempt: 1,
      maxAttempts: 2,
      maxReworkCycles: 1,
      priority: 50,
      requiresReview: false,
      expectedOutputs: [{ id: "code", kind: "code", required: true }],
      outputBindings: { code: "arv_code" },
      dependsOn: [],
      inputArtifactVersionIds: ["arv_plan"],
      createdAt: now,
      updatedAt: now,
    };
    const node: NodeInstanceRecord = {
      id: "wfn_snap",
      workflowInstanceId: "wfi_snap",
      nodeId: "dev_a",
      taskId: ids.taskId,
      status: "active",
      generation: 1,
      stateRevision: 2,
    };
    const approval: ApprovalRecord = {
      id: "apr_snap",
      projectId: ids.projectId,
      gate: "artifact",
      status: "pending",
      stateRevision: 1,
      actionDigest: "digest-art",
      resource: "artifactVersion:arv_code",
      artifactVersionId: "arv_code",
      createdAt: now,
    };
    const artifacts: ArtifactRecord[] = [
      {
        artifactVersionId: "arv_plan",
        projectId: ids.projectId,
        slotId: "plan",
        digest: "sha256:plan",
        status: "available",
      },
      {
        artifactVersionId: "arv_code",
        projectId: ids.projectId,
        taskId: ids.taskId,
        slotId: "code",
        digest: "sha256:code",
        status: "available",
      },
    ];
    const run: AppRunRecord = {
      id: "run_snap",
      taskId: ids.taskId,
      projectId: ids.projectId,
      status: "running",
      stateRevision: 2,
      attempt: 1,
      generation: 1,
      definitionRevision: 1,
      operationId: "op_snap",
      createdAt: now,
      updatedAt: now,
    };
    const budget: BudgetRecord = {
      id: "bdg_1",
      projectId: ids.projectId,
      currency: "USD",
      limitMinor: 1_000_000,
      reservedMinor: 0,
      settledMinor: 0,
      authorizationVersion: 1,
    };
    const reservations: ReservationRecord[] = [];
    return {
      projects: [project],
      tasks: [task],
      workflows: [workflow],
      nodes: [node],
      approvals: [approval],
      artifacts,
      runs: [run],
      budgets: [budget],
      reservations,
      usageKeys: [],
      executionSnapshots: [],
    };
  }
});
