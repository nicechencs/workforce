import { describe, expect, it } from "vitest";

import {
  decideRecovery,
  nextApprovalStatus,
  nextBackoffMs,
  nextNodeStatus,
  nextProjectStatus,
  nextRunStatus,
  nextTaskStatus,
  nextWorkflowStatus,
  raiseBudget,
  releaseReservation,
  reserveBudget,
  reviewerCircularWait,
  schedule,
  settleUsage,
  validateWorkflowGraph,
} from "../../../../workflow-engine/src/index.js";

import type { EnginePort } from "../projects/engine-port.js";
import { createWorkforceApp } from "../projects/service.js";

function engine(): EnginePort {
  return {
    nextProjectStatus,
    nextTaskStatus,
    nextRunStatus,
    nextApprovalStatus,
    nextWorkflowStatus,
    nextNodeStatus,
    validateWorkflowGraph,
    reviewerCircularWait,
    schedule,
    decideRecovery,
    reserveBudget,
    releaseReservation,
    settleUsage,
    raiseBudget,
    nextBackoffMs,
  };
}

describe("budget use cases", () => {
  it("reserves, dedupes usage, and raises a new authorization version", () => {
    const app = createWorkforceApp({ engine: engine() });
    app.world.budgets.set("bdg_1", {
      id: "bdg_1",
      projectId: "prj_1",
      currency: "USD",
      limitMinor: 10_000,
      reservedMinor: 0,
      settledMinor: 0,
      authorizationVersion: 1,
    });
    const reserved = app.reserveBudget({
      budgetId: "bdg_1",
      amount: { costMinor: 100, currency: "USD", kind: "estimated" },
    });
    expect(reserved.budget.reservedMinor).toBe(100);
    app.settleUsage({
      budgetId: "bdg_1",
      amount: { costMinor: 80, currency: "USD", kind: "settled" },
      usageKey: "usage-1",
    });
    const again = app.settleUsage({
      budgetId: "bdg_1",
      amount: { costMinor: 80, currency: "USD", kind: "settled" },
      usageKey: "usage-1",
    });
    expect(again.settledMinor).toBe(80);
    const raised = app.raiseBudget({ budgetId: "bdg_1", newLimitMinor: 50_000 });
    expect(raised.authorizationVersion).toBe(2);
    expect(() =>
      app.reserveBudget({
        budgetId: "bdg_1",
        amount: { costMinor: 0, currency: "USD", kind: "unknown" },
      }),
    ).toThrow(/unknown cost/);
  });
});
