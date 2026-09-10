import { describe, expect, it } from "vitest";

import { validateWorkflowGraph } from "./dag.js";
import { reviewerCircularWait } from "./eligibility.js";
import { schedule } from "./scheduler.js";
import { decideRecovery } from "./retry.js";
import { raiseBudget, reserveBudget, settleUsage } from "./budget.js";
import type { NodeRuntimeState } from "./eligibility.js";
import type { WorkflowGraph } from "./types.js";

function m3Graph(): WorkflowGraph {
  return {
    id: "wfv_m3",
    workflowId: "wf_feature",
    version: 1,
    entryNodeIds: ["dev_a"],
    terminalNodeIds: ["review"],
    nodes: [
      {
        id: "dev_a",
        kind: "task",
        role: "developer",
        requiresReview: true,
        expectedOutputIds: ["code_a"],
        maxAttempts: 2,
        maxReworkCycles: 1,
        priority: 80,
      },
      {
        id: "dev_b",
        kind: "task",
        role: "developer",
        expectedOutputIds: ["code_b"],
        joinPolicy: "all_success",
        maxAttempts: 2,
        maxReworkCycles: 1,
        priority: 50,
      },
      {
        id: "review",
        kind: "task",
        role: "reviewer",
        requiresReview: true,
        joinPolicy: "all_success",
        maxAttempts: 1,
        maxReworkCycles: 1,
        priority: 10,
      },
    ],
    edges: [
      { id: "e1", from: "dev_a", to: "dev_b", waitFor: "outputs_ready" },
      { id: "e2", from: "dev_a", to: "review", waitFor: "outputs_ready" },
      { id: "e3", from: "dev_b", to: "review", waitFor: "outputs_ready" },
    ],
  };
}

function state(
  nodeId: string,
  status: NodeRuntimeState["status"],
  extra: Partial<NodeRuntimeState> = {},
): NodeRuntimeState {
  return { nodeId, status, requiredOutputsReady: false, ...extra };
}

describe("workflow DAG", () => {
  it("accepts the M3 developer/reviewer graph", () => {
    const result = validateWorkflowGraph(m3Graph());
    expect(result.ok).toBe(true);
    expect(reviewerCircularWait(m3Graph())).toBeUndefined();
  });

  it("rejects a cycle", () => {
    const cyclic: WorkflowGraph = {
      id: "wfv_cycle",
      workflowId: "wf",
      version: 1,
      entryNodeIds: ["a"],
      nodes: [
        { id: "a", kind: "task" },
        { id: "b", kind: "task" },
      ],
      edges: [
        { id: "ab", from: "a", to: "b" },
        { id: "ba", from: "b", to: "a" },
      ],
    };
    expect(validateWorkflowGraph(cyclic)).toEqual({
      ok: false,
      reason: "workflow graph contains a cycle",
    });
  });

  it("rejects reviewer waiting on developer completed", () => {
    const graph = m3Graph();
    const edges = graph.edges.map((edge) =>
      edge.id === "e2" ? { ...edge, waitFor: "completed" as const } : edge,
    );
    expect(reviewerCircularWait({ ...graph, edges })).toMatch(/completed/);
  });
});

describe("scheduler eligibility", () => {
  it("makes developer B ready from A's outputs, not A's completed", () => {
    const graph = m3Graph();
    const actions = schedule({
      graph,
      projectStatus: "running",
      workflowStatus: "running",
      capacityAvailable: 2,
      nodes: [
        state("dev_a", "waiting", {
          taskStatus: "waiting_review",
          requiredOutputsReady: true,
        }),
        state("dev_b", "pending"),
        state("review", "pending"),
      ],
    });
    expect(actions.some((action) => action.type === "queue" && action.nodeId === "dev_b")).toBe(
      true,
    );
    expect(actions.some((action) => action.type === "queue" && action.nodeId === "review")).toBe(
      false,
    );
  });

  it("skips the unselected condition branch and still joins", () => {
    const graph: WorkflowGraph = {
      id: "wfv_cond",
      workflowId: "wf",
      version: 1,
      entryNodeIds: ["cond"],
      nodes: [
        {
          id: "cond",
          kind: "condition",
          conditionKey: "path",
          branches: [{ value: "left" }, { value: "right", isDefault: true }],
        },
        { id: "left", kind: "task" },
        { id: "right", kind: "task" },
        { id: "join", kind: "task", joinPolicy: "all_success" },
      ],
      edges: [
        { id: "cl", from: "cond", to: "left", conditionValue: "left" },
        { id: "cr", from: "cond", to: "right", conditionValue: "right" },
        { id: "lj", from: "left", to: "join", waitFor: "outputs_ready" },
        { id: "rj", from: "right", to: "join", waitFor: "outputs_ready" },
      ],
    };
    const actions = schedule({
      graph,
      projectStatus: "running",
      workflowStatus: "running",
      capacityAvailable: 2,
      conditionValues: { cond: "left" },
      nodes: [
        state("cond", "completed", { requiredOutputsReady: true, selected: true }),
        state("left", "pending"),
        state("right", "pending"),
        state("join", "pending"),
      ],
    });
    expect(actions).toContainEqual({ type: "skip", nodeId: "right" });
    expect(actions.some((action) => action.nodeId === "left" && action.type === "queue")).toBe(
      true,
    );
  });

  it("does not consume attempts when capacity is exhausted", () => {
    expect(
      decideRecovery({
        kind: "retry",
        attempt: 1,
        maxAttempts: 2,
        generation: 1,
        maxReworkCycles: 1,
        capacityAvailable: false,
      }),
    ).toEqual({ action: "wait-capacity" });
  });
});

describe("budget", () => {
  it("refuses to treat unknown cost as zero", () => {
    const state = {
      currency: "USD",
      limitMinor: 10_000,
      reservedMinor: 0,
      settledMinor: 0,
      authorizationVersion: 1,
    };
    expect(reserveBudget(state, { costMinor: 0, currency: "USD", kind: "unknown" }).ok).toBe(false);
  });

  it("dedupes usage keys and bumps authorization on raise", () => {
    const state = {
      currency: "USD",
      limitMinor: 10_000,
      reservedMinor: 100,
      settledMinor: 0,
      authorizationVersion: 1,
    };
    const first = settleUsage(
      state,
      { costMinor: 50, currency: "USD", kind: "settled" },
      "u1",
      new Set(),
    );
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);
    if (!first.ok) {
      return;
    }
    const second = settleUsage(
      first.state,
      { costMinor: 50, currency: "USD", kind: "settled" },
      "u1",
      new Set(["u1"]),
    );
    expect(second.duplicate).toBe(true);
    const raised = raiseBudget(first.state, 20_000);
    expect(raised.ok).toBe(true);
    if (raised.ok) {
      expect(raised.state.authorizationVersion).toBe(2);
    }
  });
});
