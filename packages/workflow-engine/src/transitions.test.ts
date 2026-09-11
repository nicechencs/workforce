import { describe, expect, it } from "vitest";

import { InvalidTransitionError } from "./invalid-transition.js";
import {
  nextApprovalStatus,
  nextNodeStatus,
  nextProjectStatus,
  nextRunStatus,
  nextTaskStatus,
  nextWorkflowStatus,
} from "./transitions.js";

describe("M3 status matrix", () => {
  it("walks the mock planning then execution path", () => {
    let project = nextProjectStatus("draft", "start-planning");
    expect(project).toBe("planning");
    project = nextProjectStatus(project, "confirm-plan");
    expect(project).toBe("ready");
    project = nextProjectStatus(project, "start");
    expect(project).toBe("running");
  });

  it("does not start development before the plan is confirmed", () => {
    expect(() => nextProjectStatus("planning", "start")).toThrow(InvalidTransitionError);
  });

  it("lets a developer task complete from outputs without waiting on reviewer", () => {
    expect(nextTaskStatus("running", "auto-complete")).toBe("completed");
    expect(() => nextTaskStatus("completed", "queue")).toThrow(InvalidTransitionError);
  });

  it("keeps Run succeeded independent of Task waiting_review", () => {
    expect(nextRunStatus("running", "succeed")).toBe("succeeded");
    expect(() => nextRunStatus("running", "waiting_review")).toThrow(InvalidTransitionError);
  });

  it("settles a pending Run after Runtime confirms cancellation", () => {
    expect(nextRunStatus("pending", "cancel-settled")).toBe("cancelled");
  });

  it("continues to settle cancellation from other non-terminal Run states", () => {
    for (const status of ["starting", "running", "waiting_input", "paused"] as const) {
      expect(nextRunStatus(status, "cancel-settled")).toBe("cancelled");
    }
  });

  it("does not extend Run cancellation or completion transitions beyond the matrix", () => {
    for (const status of ["succeeded", "failed", "timed_out", "cancelled"] as const) {
      expect(() => nextRunStatus(status, "cancel-settled")).toThrow(InvalidTransitionError);
    }
    expect(() => nextRunStatus("pending", "succeed")).toThrow(InvalidTransitionError);
  });

  it("consumes an approval once", () => {
    const approved = nextApprovalStatus("pending", "approve");
    expect(nextApprovalStatus(approved, "consume")).toBe("consumed");
    expect(() => nextApprovalStatus("consumed", "approve")).toThrow(InvalidTransitionError);
  });

  it("cancels a workflow without jumping to cancelled", () => {
    expect(nextWorkflowStatus("running", "cancel")).toBe("cancelling");
    expect(() => nextWorkflowStatus("running", "settle")).toThrow(InvalidTransitionError);
    expect(nextWorkflowStatus("cancelling", "settle")).toBe("cancelled");
  });

  it("skips unselected nodes without activating them", () => {
    expect(nextNodeStatus("pending", "skip")).toBe("skipped");
    expect(() => nextNodeStatus("skipped", "activate")).toThrow(InvalidTransitionError);
  });
});
