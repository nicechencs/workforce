import type { PlacementIntent } from "@workforce/protocol";

import type {
  PlacementCandidate,
  PlacementDecision,
  PlacementScheduler,
} from "../../ports/index.js";
import { UseCaseError } from "../projects/errors.js";

export const DEFAULT_PLACEMENT_INTENT: PlacementIntent = { mode: "local_only" };

export const DEFAULT_LOCAL_PLACEMENT: PlacementCandidate = {
  nodeId: "ndl_local",
  runtimeInstallationId: "rtm_mock_local",
  workspaceInstanceId: "wsi_local",
  transport: "sdk",
};

/**
 * V0.1 Local Node placement. Remote / container kinds are product Placement
 * values (D19) but this implementation does not schedule them.
 */
export class LocalNodePlacementScheduler implements PlacementScheduler {
  constructor(private readonly local: PlacementCandidate = DEFAULT_LOCAL_PLACEMENT) {}

  resolve(input: {
    intent: PlacementIntent;
    inventory?: Partial<PlacementCandidate>;
  }): PlacementDecision {
    if (input.intent.mode === "remote_only") {
      throw new UseCaseError(
        "unsupported_capability",
        "remote placement is not implemented on the local node",
        { details: { capability: "placement.remote" } },
      );
    }
    const candidate: PlacementCandidate = {
      nodeId: input.inventory?.nodeId ?? this.local.nodeId,
      runtimeInstallationId:
        input.inventory?.runtimeInstallationId ?? this.local.runtimeInstallationId,
      workspaceInstanceId: input.inventory?.workspaceInstanceId ?? this.local.workspaceInstanceId,
      transport: input.inventory?.transport ?? this.local.transport,
    };
    if (
      input.intent.mode === "specific_node" &&
      input.intent.nodeId !== undefined &&
      input.intent.nodeId !== candidate.nodeId
    ) {
      throw new UseCaseError("validation_failed", "requested node is not the local node", {
        details: { requested: input.intent.nodeId, local: candidate.nodeId },
      });
    }
    if (!candidate.nodeId || !candidate.runtimeInstallationId || !candidate.workspaceInstanceId) {
      throw new UseCaseError(
        "validation_failed",
        "run start requires node, runtime, and workspace placement",
      );
    }
    return { candidate, reason: "local_node" };
  }
}
