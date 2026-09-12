import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PersistenceError, WorkforceSqlite } from "@workforce/database";
import { MemoryWorld } from "@workforce/application";

import type { PersistedHostStore, PersistedWorld } from "../src/composition/persist.js";
import {
  dualWriteSqlite,
  dumpWorld,
  hydrateWorld,
  loadComposition,
  loadSnapshot,
  persistSnapshot,
  worldPath,
} from "../src/composition/persist.js";

/**
 * D04: the world.json sidecar must stay readable across upgrades. State written
 * before `executionSnapshots` or `workflowVersions` existed must not break the load path.
 */
function legacyWorld(): Omit<PersistedWorld, "executionSnapshots"> {
  return {
    version: 1,
    clock: "2026-09-11T00:00:00.000Z",
    idsSeq: 4096,
    projects: [],
    tasks: [],
    runs: [],
    approvals: [],
    artifacts: [],
    workflows: [],
    nodes: [],
    budgets: [],
    usageKeys: [],
    unknownStatuses: [],
    reservations: [],
    events: [],
    receipts: [],
    operations: [],
    artifactContents: [],
    workspaces: [],
  };
}

const host: PersistedHostStore = { version: 1, operations: [], handles: [], events: [] };

describe("composition world sidecar", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function stateDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "wf-persist-"));
    dirs.push(dir);
    return dir;
  }

  it("defaults D02 fields to [] for a legacy world.json that lacks them", () => {
    const dir = stateDir();
    writeFileSync(worldPath(dir), JSON.stringify(legacyWorld()), "utf8");

    const snapshot = loadSnapshot(dir);

    expect(snapshot?.world.executionSnapshots).toEqual([]);
    expect(snapshot?.world.workflowVersions).toEqual([]);
  });

  it("round-trips executionSnapshots through world.json", () => {
    const dir = stateDir();
    const record = {
      id: "snp_1",
      projectId: "prj_1",
      workflowVersionId: "wfv_1",
      teamVersionId: "tmv_1",
      contentHash: "sha256:snp",
      policySnapshot: { policyVersion: 1 },
      createdAt: "2026-09-11T00:00:00.000Z",
    };

    persistSnapshot(dir, { world: { ...legacyWorld(), executionSnapshots: [record] }, host });

    expect(loadSnapshot(dir)?.world.executionSnapshots).toEqual([record]);
  });

  it("round-trips canonical workflow versions through world.json", () => {
    const dir = stateDir();
    const graph = {
      id: "wfv_1",
      workflowId: "wfd_1",
      version: 1,
      entryNodeIds: ["plan"],
      nodes: [{ id: "plan", kind: "task", role: "planner" }],
      edges: [],
    };

    persistSnapshot(dir, {
      world: { ...legacyWorld(), executionSnapshots: [], workflowVersions: [graph] },
      host,
    });

    expect(loadSnapshot(dir)?.world.workflowVersions).toEqual([graph]);
  });

  it("round-trips authoring drafts and ChangeSets through the Daemon world snapshot", async () => {
    const source = new MemoryWorld();
    const workflowDraft = {
      id: "wfd_1",
      workflowId: "wf_authoring",
      revision: 1,
      status: "draft" as const,
      graph: {
        entryNodeIds: ["node_1"],
        nodes: [{ id: "node_1", kind: "task" as const, role: "developer" as const }],
        edges: [],
        failurePolicy: { default: "fail" as const },
        concurrencyPolicy: {
          runWorktree: "isolated" as const,
          integrationWorktree: "dedicated" as const,
        },
      },
      contentHash: "sha256:wfd_1",
      updatedAt: "2026-09-12T00:00:00.000Z",
      updatedBy: "usr_author",
    };
    const teamDraft = {
      id: "tmd_1",
      teamId: "team_authoring",
      revision: 1,
      status: "draft" as const,
      members: [{ role: "developer", runtimeProfileId: "rp_authoring", quantity: 1 }],
      contentHash: "sha256:tmd_1",
      updatedAt: "2026-09-12T00:00:00.000Z",
      updatedBy: "usr_author",
    };
    const changeSet = {
      id: "acs_1",
      organizationId: "org_authoring",
      projectId: "prj_authoring",
      sourceRunId: "run_authoring",
      status: "applied" as const,
      proposalRef: "arv_proposal",
      steps: [
        {
          id: "acst_1",
          ordinal: 1,
          targetType: "workflow" as const,
          targetId: "wf_authoring",
          expectedRevision: 1,
          status: "applied" as const,
          patchRef: "arv_patch",
          resultRevision: 1,
          completedAt: "2026-09-12T00:00:00.000Z",
        },
      ],
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    source.workflowDrafts.set(workflowDraft.id, workflowDraft);
    source.teamDrafts.set(teamDraft.id, teamDraft);
    source.authoringChangeSets.set(changeSet.id, changeSet);

    const snapshot = dumpWorld({
      world: source,
      operations: [],
      artifactContents: [],
      workspaces: [],
    });
    const restored = new MemoryWorld();
    await hydrateWorld(restored, snapshot);

    expect([...restored.workflowDrafts.values()]).toEqual([workflowDraft]);
    expect([...restored.teamDrafts.values()]).toEqual([teamDraft]);
    expect([...restored.authoringChangeSets.values()]).toEqual([changeSet]);
  });

  it("restores authoring state through SQLite dual-write and composition reload", async () => {
    const dir = stateDir();
    const sqlite = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const source = new MemoryWorld();
    const now = "2026-09-12T00:00:00.000Z";
    source.projects.set("prj_authoring", {
      id: "prj_authoring",
      organizationId: "org_authoring",
      name: "Authoring",
      objective: "draft",
      status: "draft",
      stateRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
    source.tasks.set("tsk_authoring", {
      id: "tsk_authoring",
      projectId: "prj_authoring",
      role: "developer",
      title: "authoring",
      status: "queued",
      stateRevision: 1,
      definitionRevision: 1,
      generation: 1,
      attempt: 1,
      maxAttempts: 1,
      maxReworkCycles: 0,
      priority: 1,
      requiresReview: false,
      expectedOutputs: [],
      outputBindings: {},
      dependsOn: [],
      inputArtifactVersionIds: [],
      createdAt: now,
      updatedAt: now,
    });
    source.runs.set("run_authoring", {
      id: "run_authoring",
      taskId: "tsk_authoring",
      projectId: "prj_authoring",
      status: "succeeded",
      stateRevision: 1,
      attempt: 1,
      generation: 1,
      definitionRevision: 1,
      operationId: "op_authoring",
      createdAt: now,
      updatedAt: now,
    });
    source.workflowDrafts.set("wfd_1", {
      id: "wfd_1",
      workflowId: "wf_authoring",
      revision: 1,
      status: "draft",
      graph: {
        entryNodeIds: ["node_1"],
        nodes: [{ id: "node_1", kind: "task", role: "developer" }],
        edges: [],
        failurePolicy: { default: "fail" },
        concurrencyPolicy: { runWorktree: "isolated", integrationWorktree: "dedicated" },
      },
      contentHash: "sha256:wfd_1",
      updatedAt: now,
      updatedBy: "usr_author",
    });
    source.authoringChangeSets.set("acs_1", {
      id: "acs_1",
      organizationId: "org_authoring",
      projectId: "prj_authoring",
      workflowId: "wf_authoring",
      sourceRunId: "run_authoring",
      status: "applied",
      proposalRef: "arv_proposal",
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: "acst_1",
          ordinal: 1,
          targetType: "workflow",
          targetId: "wf_authoring",
          expectedRevision: 1,
          status: "applied",
          patchRef: "arv_patch",
          resultRevision: 1,
          completedAt: now,
        },
      ],
    });
    try {
      await dualWriteSqlite(
        sqlite,
        dumpWorld({ world: source, operations: [], artifactContents: [], workspaces: [] }),
        { eventIds: new Set(), operationIds: new Set() },
      );
      const reloaded = await loadComposition(dir, sqlite);
      expect(reloaded?.world.workflowDrafts).toEqual([...source.workflowDrafts.values()]);
      expect(reloaded?.world.authoringChangeSets).toEqual([...source.authoringChangeSets.values()]);
    } finally {
      sqlite.close();
    }
  });

  it("propagates a raw constraint failure from the projection", async () => {
    const dir = stateDir();
    const sqlite = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const constraint = Object.assign(new Error("UNIQUE constraint failed: runs.id"), {
      errcode: 2067,
    });
    const save = vi.spyOn(sqlite.worldSnapshot, "save").mockImplementation(() => {
      throw constraint;
    });
    try {
      await expect(
        dualWriteSqlite(
          sqlite,
          { ...legacyWorld(), executionSnapshots: [] },
          { eventIds: new Set<string>(), operationIds: new Set<string>() },
        ),
      ).rejects.toThrow(constraint);
    } finally {
      save.mockRestore();
      sqlite.close();
    }
  });

  it("still propagates a non-constraint projection failure", async () => {
    const dir = stateDir();
    const sqlite = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const failure = new Error("projection exploded");
    const save = vi.spyOn(sqlite.worldSnapshot, "save").mockImplementation(() => {
      throw failure;
    });
    try {
      await expect(
        dualWriteSqlite(
          sqlite,
          { ...legacyWorld(), executionSnapshots: [] },
          { eventIds: new Set<string>(), operationIds: new Set<string>() },
        ),
      ).rejects.toThrow(failure);
    } finally {
      save.mockRestore();
      sqlite.close();
    }
  });

  it("propagates a projection CAS conflict instead of accepting a stale authority", async () => {
    const dir = stateDir();
    const sqlite = WorkforceSqlite.open(join(dir, "workforce.sqlite"));
    const conflict = new PersistenceError("revision_conflict", "project prj_1 revision mismatch");
    const save = vi.spyOn(sqlite.worldSnapshot, "save").mockImplementation(() => {
      throw conflict;
    });
    try {
      await expect(
        dualWriteSqlite(
          sqlite,
          { ...legacyWorld(), executionSnapshots: [] },
          { eventIds: new Set<string>(), operationIds: new Set<string>() },
        ),
      ).rejects.toThrow(conflict);
    } finally {
      save.mockRestore();
      sqlite.close();
    }
  });
});
