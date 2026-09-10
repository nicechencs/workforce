import type { ProjectStatus, WorkflowInstanceStatus } from "@workforce/domain";

import { outgoingEdges, validateWorkflowGraph } from "./dag.js";
import {
  nodeEligible,
  reviewerCircularWait,
  selectedConditionBranches,
  type NodeRuntimeState,
} from "./eligibility.js";
import { NODE_TERMINAL, nodeById, type WorkflowGraph } from "./types.js";

export type ScheduleAction =
  | { type: "make-ready"; nodeId: string }
  | { type: "skip"; nodeId: string }
  | { type: "queue"; nodeId: string }
  | { type: "wait"; reason: string };

export interface ScheduleInput {
  graph: WorkflowGraph;
  nodes: readonly NodeRuntimeState[];
  conditionValues?: Readonly<Record<string, string>>;
  projectStatus: ProjectStatus;
  workflowStatus: WorkflowInstanceStatus;
  capacityAvailable: number;
  now?: number;
  eligibleAt?: Readonly<Record<string, number>>;
}

const BLOCKING_PROJECT = new Set<ProjectStatus>([
  "paused",
  "cancelled",
  "completed",
  "failed",
  "archived",
]);

const BLOCKING_WORKFLOW = new Set<WorkflowInstanceStatus>([
  "paused",
  "cancelling",
  "cancelled",
  "completed",
  "failed",
]);

export function compareReady(
  a: { nodeId: string; priority: number; eligibleAt: number; createdAt: number },
  b: { nodeId: string; priority: number; eligibleAt: number; createdAt: number },
): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  if (a.eligibleAt !== b.eligibleAt) {
    return a.eligibleAt - b.eligibleAt;
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.nodeId.localeCompare(b.nodeId);
}

export function schedule(input: ScheduleInput): ScheduleAction[] {
  const dag = validateWorkflowGraph(input.graph);
  if (!dag.ok) {
    return [{ type: "wait", reason: dag.reason }];
  }
  const circular = reviewerCircularWait(input.graph);
  if (circular) {
    return [{ type: "wait", reason: circular }];
  }
  if (BLOCKING_PROJECT.has(input.projectStatus) || BLOCKING_WORKFLOW.has(input.workflowStatus)) {
    return [{ type: "wait", reason: "scheduling is paused or settled" }];
  }

  const states = new Map(input.nodes.map((node) => [node.nodeId, { ...node }]));
  const actions: ScheduleAction[] = [];
  const ready: Array<{ nodeId: string; priority: number; eligibleAt: number; createdAt: number }> =
    [];

  for (const node of input.graph.nodes) {
    if (node.kind !== "condition") {
      continue;
    }
    const chosen = selectedConditionBranches(node, input.conditionValues?.[node.id]);
    for (const edge of outgoingEdges(input.graph, node.id)) {
      if (edge.conditionValue !== undefined && !chosen.has(edge.conditionValue)) {
        const target = states.get(edge.to);
        if (target && !NODE_TERMINAL.has(target.status)) {
          actions.push({ type: "skip", nodeId: edge.to });
          states.set(edge.to, { ...target, status: "skipped" });
        }
      }
    }
  }

  for (const node of input.graph.nodes) {
    const state = states.get(node.id);
    if (!state || NODE_TERMINAL.has(state.status)) {
      continue;
    }
    if (!nodeEligible(input.graph, node, states)) {
      continue;
    }
    if (state.status === "pending" || state.status === "blocked") {
      ready.push({
        nodeId: node.id,
        priority: node.priority ?? 50,
        eligibleAt: input.eligibleAt?.[node.id] ?? 0,
        createdAt: 0,
      });
    } else if (state.status === "ready") {
      ready.push({
        nodeId: node.id,
        priority: node.priority ?? 50,
        eligibleAt: input.eligibleAt?.[node.id] ?? 0,
        createdAt: 1,
      });
    }
  }

  ready.sort(compareReady);
  let remaining = input.capacityAvailable;
  for (const item of ready) {
    const node = nodeById(input.graph, item.nodeId);
    const state = states.get(item.nodeId);
    if (!node || !state) {
      continue;
    }
    if (state.status === "pending" || state.status === "blocked") {
      actions.push({ type: "make-ready", nodeId: item.nodeId });
    }
    if (remaining <= 0) {
      actions.push({ type: "wait", reason: `capacity exhausted before ${item.nodeId}` });
      continue;
    }
    if (state.status === "ready" || state.status === "pending" || state.status === "blocked") {
      actions.push({ type: "queue", nodeId: item.nodeId });
      remaining -= 1;
    }
  }
  return actions;
}
