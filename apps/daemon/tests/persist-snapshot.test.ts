import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PersistedHostStore, PersistedWorld } from "../src/composition/persist.js";
import { loadSnapshot, persistSnapshot, worldPath } from "../src/composition/persist.js";

/**
 * D04: the world.json sidecar must stay readable across upgrades. State written
 * before `executionSnapshots` existed must not break the load path.
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

  it("defaults executionSnapshots to [] for a legacy world.json that lacks the field", () => {
    const dir = stateDir();
    writeFileSync(worldPath(dir), JSON.stringify(legacyWorld()), "utf8");

    const snapshot = loadSnapshot(dir);

    expect(snapshot?.world.executionSnapshots).toEqual([]);
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
});
