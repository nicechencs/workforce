import type { TaskStatus } from "@workforce/domain";

import { incomingEdges, outgoingEdges } from "./dag.js";
import {
  NODE_TERMINAL,
  nodeById,
  type JoinPolicy,
  type NodeInstanceStatus,
  type UpstreamWait,
  type WorkflowEdgeDefinition,
  type WorkflowGraph,
  type WorkflowNodeDefinition,
} from "./types.js";

export interface NodeRuntimeState {
  nodeId: string;
  status: NodeInstanceStatus;
  taskStatus?: TaskStatus;
  requiredOutputsReady: boolean;
  selected?: boolean;
}

export function defaultWaitFor(edge: WorkflowEdgeDefinition): UpstreamWait {
  return edge.waitFor ?? "outputs_ready";
}

export function upstreamSatisfied(
  edge: WorkflowEdgeDefinition,
  upstream: NodeRuntimeState,
): boolean {
  if (upstream.status === "skipped") {
    return true;
  }
  const wait = defaultWaitFor(edge);
  switch (wait) {
    case "outputs_ready":
      return upstream.requiredOutputsReady;
    case "completed":
      return upstream.status === "completed" || upstream.taskStatus === "completed";
    case "failed":
      return upstream.status === "failed" || upstream.taskStatus === "failed";
    case "cancelled":
      return upstream.status === "cancelled" || upstream.taskStatus === "cancelled";
    case "any_terminal":
      return NODE_TERMINAL.has(upstream.status);
  }
}

export function joinSatisfied(
  policy: JoinPolicy,
  minSuccess: number,
  predecessors: readonly { edge: WorkflowEdgeDefinition; state: NodeRuntimeState }[],
): boolean {
  const selected = predecessors.filter((item) => item.state.selected !== false);
  if (selected.length === 0) {
    return predecessors.every((item) => item.state.status === "skipped");
  }
  const successes = selected.filter(
    (item) => item.state.status === "completed" || item.state.requiredOutputsReady,
  ).length;
  switch (policy) {
    case "all_success":
      return selected.every(
        (item) => item.state.status === "skipped" || upstreamSatisfied(item.edge, item.state),
      );
    case "all_terminal":
      return selected.every(
        (item) => item.state.status === "skipped" || NODE_TERMINAL.has(item.state.status),
      );
    case "min_success":
      return successes >= minSuccess;
  }
}

export function nodeEligible(
  graph: WorkflowGraph,
  node: WorkflowNodeDefinition,
  states: ReadonlyMap<string, NodeRuntimeState>,
): boolean {
  const current = states.get(node.id);
  if (!current || NODE_TERMINAL.has(current.status) || current.status === "active") {
    return false;
  }
  const inbound = incomingEdges(graph, node.id);
  if (inbound.length === 0) {
    return graph.entryNodeIds.includes(node.id);
  }
  const predecessors = inbound.map((edge) => {
    const state = states.get(edge.from);
    return {
      edge,
      state: state ?? {
        nodeId: edge.from,
        status: "pending" as const,
        requiredOutputsReady: false,
      },
    };
  });
  if (inbound.length > 1 && node.joinPolicy) {
    return joinSatisfied(node.joinPolicy, node.minSuccess ?? 1, predecessors);
  }
  return predecessors.every((item) => upstreamSatisfied(item.edge, item.state));
}

/**
 * Reviewer must consume a fixed ArtifactVersion (outputs_ready).
 * Developer must not wait for reviewer completion. Either pattern is a cycle.
 */
export function reviewerCircularWait(graph: WorkflowGraph): string | undefined {
  for (const edge of graph.edges) {
    const from = nodeById(graph, edge.from);
    const to = nodeById(graph, edge.to);
    if (!from || !to) {
      continue;
    }
    if (
      from.role === "developer" &&
      to.role === "reviewer" &&
      defaultWaitFor(edge) === "completed"
    ) {
      return `reviewer ${to.id} waits on developer ${from.id} completed`;
    }
    if (from.role === "reviewer" && to.role === "developer") {
      return `developer ${to.id} waits on reviewer ${from.id}`;
    }
  }

  const developerNeedsReview = new Set(
    graph.nodes.filter((node) => node.role === "developer" && node.requiresReview).map((n) => n.id),
  );
  if (developerNeedsReview.size === 0) {
    return undefined;
  }
  for (const devId of developerNeedsReview) {
    for (const edge of outgoingEdges(graph, devId)) {
      const downstream = nodeById(graph, edge.to);
      if (downstream?.role === "reviewer" && defaultWaitFor(edge) === "completed") {
        return `developer ${devId} and reviewer ${downstream.id} would wait on each other`;
      }
    }
  }
  return undefined;
}

export function selectedConditionBranches(
  node: WorkflowNodeDefinition,
  value: string | undefined,
): Set<string> {
  const selected = new Set<string>();
  if (node.kind !== "condition") {
    return selected;
  }
  const branches = node.branches ?? [];
  const hit = branches.find((branch) => branch.value === value);
  const fallback = branches.find((branch) => branch.isDefault);
  const chosen = hit ?? fallback;
  if (chosen) {
    selected.add(chosen.value);
  }
  return selected;
}
