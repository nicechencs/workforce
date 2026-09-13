import type { WorkflowGraph, WorkflowNodeDefinition } from "../projects/engine-port.js";
import type {
  PlanArtifact,
  ConfirmedWorkflowEdge,
  ConfirmedWorkflowNode,
  ConfirmedWorkflowVersion,
} from "./types.js";

export function entryNodeIds(plan: PlanArtifact): string[] {
  const incoming = new Set(plan.edges.map((edge) => edge.to));
  return plan.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
}

export function toWorkflowNodes(plan: PlanArtifact): ConfirmedWorkflowNode[] {
  return plan.nodes.map((node) => {
    if (node.kind === "approval") {
      return {
        id: node.id,
        kind: node.kind,
        role: node.role,
        title: node.title,
        objective: node.objective,
        gate: node.gate,
      };
    }
    return {
      id: node.id,
      kind: node.kind,
      role: node.role,
      title: node.title,
      objective: node.objective,
      workerRef: node.workerRef,
      expectedOutputs: node.expectedOutputs,
      acceptanceCriteria: node.acceptanceCriteria,
      maxAttempts: node.maxAttempts,
      maxReworkCycles: node.maxReworkCycles,
    };
  });
}

export function toWorkflowEdges(plan: PlanArtifact): ConfirmedWorkflowEdge[] {
  return plan.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    onUpstream: edge.onUpstream,
  }));
}

/**
 * Execution graph for confirm-plan when the caller does not supply a
 * published WorkflowVersion graph. Approval nodes stay on the Plan Artifact;
 * Runtime DAG nodes are tasks only.
 */
export function planToExecutionGraph(plan: PlanArtifact, graphId: string): WorkflowGraph {
  const taskNodes = plan.nodes.filter((node) => node.kind === "task");
  const taskIds = new Set(taskNodes.map((node) => node.id));
  const entries = entryNodeIds(plan).filter((id) => taskIds.has(id));
  const nodes: WorkflowNodeDefinition[] = taskNodes.map((node) => {
    const definition: WorkflowNodeDefinition = {
      id: node.id,
      kind: "task",
      role: node.role,
      requiresReview: node.role === "reviewer",
      expectedOutputIds: node.expectedOutputs
        .filter((output) => output.required)
        .map((output) => output.id),
      maxAttempts: node.maxAttempts,
      maxReworkCycles: node.maxReworkCycles,
      priority: node.role === "reviewer" ? 10 : 80,
    };
    if (!entries.includes(node.id)) {
      definition.joinPolicy = "all_success";
    }
    return definition;
  });
  return {
    id: graphId,
    workflowId: plan.workflowId,
    version: 1,
    entryNodeIds: entries,
    terminalNodeIds: taskNodes.filter((node) => node.role === "reviewer").map((node) => node.id),
    nodes,
    edges: plan.edges
      .filter((edge) => taskIds.has(edge.from) && taskIds.has(edge.to))
      .map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        waitFor: edge.onUpstream,
      })),
  };
}

export function describeWorkflowVersion(input: {
  workflowVersionId: string;
  version: number;
  projectId: string;
  planArtifactVersionId: string;
  planDigest: string;
  publishedAt: string;
  plan: PlanArtifact;
}): ConfirmedWorkflowVersion {
  return {
    workflowVersionId: input.workflowVersionId,
    workflowId: input.plan.workflowId,
    version: input.version,
    projectId: input.projectId,
    planArtifactVersionId: input.planArtifactVersionId,
    planDigest: input.planDigest,
    templateId: input.plan.templateId,
    templateVersion: input.plan.templateVersion,
    policyRef: input.plan.policyRef,
    runtime: input.plan.runtime,
    immutable: true,
    publishedAt: input.publishedAt,
    intendedProjectStatus: "ready",
    workflowStarted: false,
    entryNodeIds: entryNodeIds(input.plan),
    nodes: toWorkflowNodes(input.plan),
    edges: toWorkflowEdges(input.plan),
    failurePolicy: { type: "fail_workflow" },
    concurrencyPolicy: { runWorktree: "isolated", integrationWorktree: "dedicated" },
    integration: input.plan.integration,
    bounds: input.plan.bounds,
  };
}
