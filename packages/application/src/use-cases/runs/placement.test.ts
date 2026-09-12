import { describe, expect, it } from "vitest";

import { UseCaseError } from "../projects/errors.js";
import { LocalNodePlacementScheduler } from "./placement.js";

describe("LocalNodePlacementScheduler", () => {
  it("resolves local_only to the configured local node", () => {
    const scheduler = new LocalNodePlacementScheduler();
    const decision = scheduler.resolve({ intent: { mode: "local_only" } });
    expect(decision.reason).toBe("local_node");
    expect(decision.candidate.nodeId).toBe("ndl_local");
    expect(decision.candidate.transport).toBe("sdk");
  });

  it("uses project inventory as the local default without treating it as a Run binding", () => {
    const scheduler = new LocalNodePlacementScheduler();
    const decision = scheduler.resolve({
      intent: { mode: "automatic" },
      inventory: {
        nodeId: "ndl_from_project",
        runtimeInstallationId: "rtm_from_project",
        workspaceInstanceId: "wsi_from_project",
      },
    });
    expect(decision.candidate.nodeId).toBe("ndl_from_project");
    expect(decision.candidate.runtimeInstallationId).toBe("rtm_from_project");
  });

  it("rejects remote_only without inventing a remote runner", () => {
    const scheduler = new LocalNodePlacementScheduler();
    expect(() => scheduler.resolve({ intent: { mode: "remote_only" } })).toThrow(UseCaseError);
    try {
      scheduler.resolve({ intent: { mode: "remote_only" } });
    } catch (error) {
      expect(error).toMatchObject({ code: "unsupported_capability" });
    }
  });
});
