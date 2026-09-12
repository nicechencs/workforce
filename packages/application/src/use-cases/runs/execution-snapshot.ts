import {
  parseRunExecutionSnapshot,
  type PlacementSnapshot,
  type RunExecutionSnapshot,
  type RuntimeTransport,
} from "@workforce/protocol";

import { validationFailed } from "../projects/errors.js";
import type { ProjectRecord } from "../projects/store.js";

function resolveTransport(runtimeId: string | undefined): RuntimeTransport {
  if (runtimeId === "codex") {
    return "process";
  }
  return "sdk";
}

function requirePlacement(project: ProjectRecord): {
  executionNodeId: string;
  runtimeInstallationId: string;
  workspaceInstanceId: string;
} {
  if (!project.executionNodeId || !project.runtimeInstallationId || !project.workspaceInstanceId) {
    throw validationFailed("run start requires node, runtime, and workspace placement");
  }
  return {
    executionNodeId: project.executionNodeId,
    runtimeInstallationId: project.runtimeInstallationId,
    workspaceInstanceId: project.workspaceInstanceId,
  };
}

/**
 * Assemble the immutable Run four-axis after admission. Parsed only through
 * `@workforce/protocol` so persist can write the public database columns.
 *
 * This admission path instantiates a published WorkflowInstance, so the
 * stored snapshot is workflow_bound even when `:start` echoed `direct`.
 */
export function assembleRunExecutionSnapshot(input: {
  project: ProjectRecord;
  nodeSessionId: string;
  executionLeaseId: string;
  fencingToken: number;
}): RunExecutionSnapshot {
  const placement = requirePlacement(input.project);
  if (!input.project.executionSnapshotId) {
    throw validationFailed("workflow_bound run requires an execution snapshot");
  }
  const placementSnapshot: PlacementSnapshot = {
    nodeId: placement.executionNodeId,
    nodeSessionId: input.nodeSessionId,
    runtimeInstallationId: placement.runtimeInstallationId,
    workspaceInstanceId: placement.workspaceInstanceId,
    executionLeaseId: input.executionLeaseId,
    fencingToken: input.fencingToken,
  };
  return parseRunExecutionSnapshot({
    orchestrationMode: "workflow_bound",
    transport: resolveTransport(input.project.runtimeId),
    executionSnapshotId: input.project.executionSnapshotId,
    placementSnapshot,
  });
}
