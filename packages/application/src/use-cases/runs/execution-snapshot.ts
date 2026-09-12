import {
  parseRunExecutionSnapshot,
  type OrchestrationMode,
  type PlacementSnapshot,
  type RunExecutionSnapshot,
  type RuntimeTransport,
} from "@workforce/protocol";

import { validationFailed } from "../projects/errors.js";

export function resolveTransport(runtimeId: string | undefined): RuntimeTransport {
  if (runtimeId === "codex") {
    return "process";
  }
  return "sdk";
}

/**
 * Assemble the immutable Run four-axis after admission. Parsed only through
 * `@workforce/protocol`. `direct` must not carry a ProjectExecutionSnapshot;
 * `workflow_bound` must.
 */
export function assembleRunExecutionSnapshot(input: {
  orchestrationMode: OrchestrationMode;
  transport: RuntimeTransport;
  executionSnapshotId?: string;
  placementSnapshot: PlacementSnapshot;
}): RunExecutionSnapshot {
  if (input.orchestrationMode === "direct") {
    if (input.executionSnapshotId !== undefined) {
      throw validationFailed("direct execution must not reference a ProjectExecutionSnapshot");
    }
    return parseRunExecutionSnapshot({
      orchestrationMode: "direct",
      transport: input.transport,
      placementSnapshot: input.placementSnapshot,
    });
  }
  if (input.executionSnapshotId === undefined) {
    throw validationFailed("workflow_bound run requires an execution snapshot");
  }
  return parseRunExecutionSnapshot({
    orchestrationMode: "workflow_bound",
    transport: input.transport,
    executionSnapshotId: input.executionSnapshotId,
    placementSnapshot: input.placementSnapshot,
  });
}
