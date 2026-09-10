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
