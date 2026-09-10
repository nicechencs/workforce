import { describe, expect, it } from "vitest";

import type { DiffArtifactProposal, WorkspaceInstance } from "../../ports/index.js";
import { parsePatchPaths } from "./digest.js";
import { integratePatches, PatchConflictError, previousApprovalStillValid } from "./integrate.js";
import { recordTargetMergeIntent } from "./merge-target.js";
import type {
  IntegratePatchesCommand,
  IntegrationRecord,
  IntegrationStore,
  IntegrationWorkspacePort,
  PatchContribution,
} from "./ports.js";

function newFilePatch(path: string, content: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    `+${content}`,
    "",
  ].join("\n");
}

class MemoryStore implements IntegrationStore {
  records: IntegrationRecord[] = [];

  async list(projectId: string, workflowVersionId: string): Promise<IntegrationRecord[]> {
    return this.records.filter(
      (record) => record.projectId === projectId && record.workflowVersionId === workflowVersionId,
    );
  }

  async put(record: IntegrationRecord): Promise<void> {
    this.records.push(record);
  }

  async markSuperseded(projectId: string, workflowVersionId: string): Promise<void> {
    this.records = this.records.map((record) =>
      record.projectId === projectId && record.workflowVersionId === workflowVersionId
        ? { ...record, superseded: true }
        : record,
    );
  }
}

class FakeWorkspace implements IntegrationWorkspacePort {
  readonly applied: { nodePatch: string }[] = [];
  readonly provisionCalls: { taskId: string; workspaceId: string; baseSha: string }[] = [];
  readonly files = new Set<string>();
  conflictOnOverlap = true;
  instanceId = "wsi_int_1";
  baseSha = "";

  async provisionIntegrationWorkspace(input: {
    taskId: string;
    workspaceId: string;
    baseSha: string;
  }): Promise<WorkspaceInstance> {
    this.provisionCalls.push(input);
    this.baseSha = input.baseSha;
    this.files.clear();
    this.applied.length = 0;
    return { workspaceInstanceId: this.instanceId, baseSha: input.baseSha };
  }

  async applyPatch(_instanceId: string, patch: string): Promise<void> {
    const paths = parsePatchPaths(patch);
    const overlappingPaths = paths.filter((path) => this.files.has(path));
    if (this.conflictOnOverlap && overlappingPaths.length > 0) {
      throw new PatchConflictError(`conflict on ${overlappingPaths.join(",")}`, {
        overlappingPaths,
      });
    }
    for (const path of paths) {
      this.files.add(path);
    }
    this.applied.push({ nodePatch: patch });
  }

  async captureDiff(): Promise<DiffArtifactProposal> {
    return {
      baseSha: this.baseSha,
      patch: this.applied.map((item) => item.nodePatch).join(""),
      changedPaths: [...this.files].sort((a, b) => a.localeCompare(b)),
    };
  }
}

const BASE = "0123456789abcdef0123456789abcdef01234567";

function contribution(nodeId: string, path: string, body: string): PatchContribution {
  const patch = newFilePatch(path, body);
  return {
    nodeId,
    runId: `run_${nodeId}`,
    artifactVersionId: `arv_${nodeId}`,
    patch,
    changedPaths: [path],
    baseSha: BASE,
  };
}

function command(contributions: PatchContribution[]): IntegratePatchesCommand {
  return {
    operationId: "op_int_1",
    projectId: "prj_1",
    workspaceId: "wsp_1",
    integrationTaskId: "tsk_integrate",
    baseSha: BASE,
    workflowVersionId: "wfv_1",
    contributions,
  };
}

describe("integratePatches", () => {
  it("applies patches in stable Node ID order and binds the digest to review/approval", async () => {
    const workspace = new FakeWorkspace();
    const store = new MemoryStore();
    const bravo = contribution("dev_bravo", "bravo.txt", "bravo");
    const alpha = contribution("dev_alpha", "alpha.txt", "alpha");
    const result = await integratePatches(command([bravo, alpha]), { workspace, store });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.replayed).toBe(false);
    expect(result.outcome.status).toBe("integrated");
    if (result.outcome.status !== "integrated") {
      return;
    }
    expect(workspace.provisionCalls).toEqual([
      { taskId: "tsk_integrate", workspaceId: "wsp_1", baseSha: BASE },
    ]);
    expect(result.outcome.appliedNodeIds).toEqual(["dev_alpha", "dev_bravo"]);
    expect(workspace.applied.map((item) => parsePatchPaths(item.nodePatch))).toEqual([
      ["alpha.txt"],
      ["bravo.txt"],
    ]);
    expect(result.outcome.reviewBinding.gate).toBe("artifact");
    expect(result.outcome.reviewBinding.bindToNodeIds).toEqual([
      "review_integration",
      "approve_delivery",
    ]);
    expect(result.outcome.reviewBinding.contentDigest).toBe(result.outcome.contentDigest);
    expect(result.outcome.pushed).toBe(false);
    expect(result.outcome.pullRequestCreated).toBe(false);
  });

  it("stops on conflict and does not silently overwrite", async () => {
    const workspace = new FakeWorkspace();
    const store = new MemoryStore();
    const alpha = contribution("dev_alpha", "shared.txt", "alpha");
    const bravo = contribution("dev_bravo", "shared.txt", "bravo");
    const result = await integratePatches(command([bravo, alpha]), { workspace, store });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.outcome.status).toBe("conflict");
    if (result.outcome.status !== "conflict") {
      return;
    }
    expect(result.outcome.appliedNodeIds).toEqual(["dev_alpha"]);
    expect(result.outcome.conflict.nodeId).toBe("dev_bravo");
    expect(result.outcome.conflict.requiresHuman).toBe(true);
    expect(result.outcome.conflict.overlappingPaths).toEqual(["shared.txt"]);
    expect(workspace.applied).toHaveLength(1);
    expect(result.outcome.pushed).toBe(false);
  });

  it("invalidates a previous approval after re-integration produces a new digest", async () => {
    const workspace = new FakeWorkspace();
    const store = new MemoryStore();
    const first = await integratePatches(command([contribution("dev_alpha", "alpha.txt", "a1")]), {
      workspace,
      store,
    });
    expect(first.ok && first.outcome.status === "integrated").toBe(true);
    if (!first.ok || first.outcome.status !== "integrated") {
      return;
    }
    const approvedDigest = first.outcome.contentDigest;
    const second = await integratePatches(command([contribution("dev_alpha", "alpha.txt", "a2")]), {
      workspace,
      store,
    });
    expect(second.ok && second.outcome.status === "integrated").toBe(true);
    if (!second.ok || second.outcome.status !== "integrated") {
      return;
    }
    expect(second.outcome.contentDigest).not.toBe(approvedDigest);
    expect(
      previousApprovalStillValid({
        approvedDigest,
        currentDigest: second.outcome.contentDigest,
      }),
    ).toBe(false);
    expect(store.records.some((record) => record.superseded)).toBe(true);
  });

  it("replays an identical contribution set without provisioning again", async () => {
    const workspace = new FakeWorkspace();
    const store = new MemoryStore();
    const patches = [contribution("dev_alpha", "alpha.txt", "alpha")];
    const first = await integratePatches(command(patches), { workspace, store });
    const second = await integratePatches(command(patches), { workspace, store });
    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.replayed).toBe(true);
    expect(workspace.provisionCalls).toHaveLength(1);
  });

  it("records target-branch merge as a local intent and never pushes", () => {
    const result = recordTargetMergeIntent({
      projectId: "prj_1",
      contentDigest: "fnv1a64:abc",
      targetBranch: "main",
      principalId: "usr_1",
      explicitAuthorization: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.intent.pushed).toBe(false);
    expect(result.intent.pullRequestCreated).toBe(false);
    expect(result.intent.mode).toBe("local_intent_only");
  });
});
