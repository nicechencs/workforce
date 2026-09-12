import type {
  WorkflowGraphEdgeDto,
  WorkflowGraphNodeDto,
  WorkflowStepDto,
} from "@workforce/protocol";

import type { WorkflowGraph, WorkflowNodeDefinition } from "../projects/engine-port.js";

export function deriveEntryNodeIds(
  nodes: readonly WorkflowGraphNodeDto[],
  edges: readonly WorkflowGraphEdgeDto[],
  explicit?: string,
): string[] {
  if (explicit) {
    return [explicit];
  }
  const incoming = new Set(edges.map((edge) => edge.to));
  const entries = nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
  return entries;
}

export function deriveStepsFromGraph(nodes: readonly WorkflowGraphNodeDto[]): WorkflowStepDto[] {
  return nodes.map((node) => {
    const step: WorkflowStepDto = {
      id: node.id,
      kind: node.kind === "approval" ? "approval" : "task",
      title: node.title ?? node.id,
      notes: [],
    };
    if (node.role !== undefined) {
      step.worker = node.role;
    }
    if (node.kind === "approval") {
      step.gate = "artifact";
    }
    return step;
  });
}

export function toEngineGraph(input: {
  id: string;
  workflowId: string;
  versionLabel: string;
  entry?: string;
  nodes: readonly WorkflowGraphNodeDto[];
  edges: readonly WorkflowGraphEdgeDto[];
}): WorkflowGraph {
  const entryNodeIds = deriveEntryNodeIds(input.nodes, input.edges, input.entry);
  const versionNumber = Number.parseInt(input.versionLabel, 10);
  return {
    id: input.id,
    workflowId: input.workflowId,
    version: Number.isInteger(versionNumber) && versionNumber > 0 ? versionNumber : 1,
    entryNodeIds,
    nodes: input.nodes.map(toEngineNode),
    edges: input.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.waitFor !== undefined ? { waitFor: edge.waitFor } : {}),
      ...(edge.conditionValue !== undefined ? { conditionValue: edge.conditionValue } : {}),
      ...(edge.inputBindings !== undefined ? { inputBindings: edge.inputBindings } : {}),
    })),
  };
}

function toEngineNode(node: WorkflowGraphNodeDto): WorkflowNodeDefinition {
  const definition: WorkflowNodeDefinition = {
    id: node.id,
    kind: node.kind,
  };
  if (node.role !== undefined) definition.role = node.role;
  if (node.joinPolicy !== undefined) definition.joinPolicy = node.joinPolicy;
  if (node.minSuccess !== undefined) definition.minSuccess = node.minSuccess;
  if (node.maxAttempts !== undefined) definition.maxAttempts = node.maxAttempts;
  if (node.maxReworkCycles !== undefined) definition.maxReworkCycles = node.maxReworkCycles;
  if (node.requiresReview !== undefined) definition.requiresReview = node.requiresReview;
  if (node.expectedOutputIds !== undefined) definition.expectedOutputIds = node.expectedOutputIds;
  if (node.priority !== undefined) definition.priority = node.priority;
  if (node.conditionKey !== undefined) definition.conditionKey = node.conditionKey;
  if (node.branches !== undefined) {
    definition.branches = node.branches.map((branch) => {
      const mapped: { value: string; isDefault?: boolean } = { value: branch.value };
      if (branch.isDefault !== undefined) {
        mapped.isDefault = branch.isDefault;
      }
      return mapped;
    });
  }
  return definition;
}
