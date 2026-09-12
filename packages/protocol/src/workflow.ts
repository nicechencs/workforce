import { z } from "zod";

export const workflowStepKinds = ["task", "delivery", "approval"] as const;
export type WorkflowStepKind = (typeof workflowStepKinds)[number];

export const workflowGates = ["plan", "artifact"] as const;
export type WorkflowGate = (typeof workflowGates)[number];

export const workflowDefinitionStatuses = ["draft", "published"] as const;
export type WorkflowDefinitionStatus = (typeof workflowDefinitionStatuses)[number];

/** @deprecated Use workflowDefinitionStatuses. Published-only catalog rows still parse. */
export const workflowCatalogStatuses = workflowDefinitionStatuses;
export type WorkflowCatalogStatus = WorkflowDefinitionStatus;

export const workflowGraphNodeKinds = ["task", "approval", "condition", "parallel"] as const;
export type WorkflowGraphNodeKind = (typeof workflowGraphNodeKinds)[number];

export const workflowWorkerRoles = ["planner", "developer", "reviewer", "approver"] as const;
export type WorkflowWorkerRole = (typeof workflowWorkerRoles)[number];

export const workflowJoinPolicies = ["all_success", "all_terminal", "min_success"] as const;
export type WorkflowJoinPolicy = (typeof workflowJoinPolicies)[number];

export const workflowUpstreamWaits = [
  "outputs_ready",
  "completed",
  "failed",
  "cancelled",
  "any_terminal",
] as const;
export type WorkflowUpstreamWait = (typeof workflowUpstreamWaits)[number];

export const workflowStepSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(workflowStepKinds),
    title: z.string().min(1),
    worker: z.string().min(1).optional(),
    gate: z.enum(workflowGates).optional(),
    notes: z.array(z.string()),
  })
  .strict();

export type WorkflowStepDto = z.infer<typeof workflowStepSchema>;

export const workflowGraphBranchSchema = z
  .object({
    value: z.string().min(1),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const workflowGraphNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(workflowGraphNodeKinds),
    title: z.string().min(1).optional(),
    role: z.enum(workflowWorkerRoles).optional(),
    joinPolicy: z.enum(workflowJoinPolicies).optional(),
    minSuccess: z.number().int().min(1).optional(),
    maxAttempts: z.number().int().min(1).optional(),
    maxReworkCycles: z.number().int().min(0).optional(),
    requiresReview: z.boolean().optional(),
    expectedOutputIds: z.array(z.string().min(1)).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    conditionKey: z.string().min(1).optional(),
    branches: z.array(workflowGraphBranchSchema).optional(),
  })
  .strict();

export type WorkflowGraphNodeDto = z.infer<typeof workflowGraphNodeSchema>;

export const workflowGraphInputBindingSchema = z
  .object({
    slotId: z.string().min(1),
    fromOutputId: z.string().min(1),
  })
  .strict();

export const workflowGraphEdgeSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    waitFor: z.enum(workflowUpstreamWaits).optional(),
    conditionValue: z.string().min(1).optional(),
    inputBindings: z.array(workflowGraphInputBindingSchema).optional(),
  })
  .strict();

export type WorkflowGraphEdgeDto = z.infer<typeof workflowGraphEdgeSchema>;

export const workflowFailureDefaults = ["fail", "continue_independent", "request_human"] as const;
export type WorkflowFailureDefault = (typeof workflowFailureDefaults)[number];

export const workflowFailureRecoveries = ["retry", "request_approval", "fail"] as const;
export type WorkflowFailureRecovery = (typeof workflowFailureRecoveries)[number];

export const workflowFailurePolicySchema = z
  .object({
    default: z.enum(workflowFailureDefaults),
    maxReworkCycles: z.number().int().min(0).optional(),
    onRuntimeUnavailable: z.enum(workflowFailureRecoveries).optional(),
    onBudgetExceeded: z.enum(workflowFailureRecoveries).optional(),
    onDependencyFailure: z.enum(workflowFailureDefaults).optional(),
  })
  .strict();
export type WorkflowFailurePolicyDto = z.infer<typeof workflowFailurePolicySchema>;

export const workflowRunWorktreePolicies = ["isolated", "shared"] as const;
export const workflowIntegrationWorktreePolicies = ["dedicated", "disabled"] as const;

export const workflowConcurrencyPolicySchema = z
  .object({
    runWorktree: z.enum(workflowRunWorktreePolicies),
    integrationWorktree: z.enum(workflowIntegrationWorktreePolicies),
  })
  .strict();
export type WorkflowConcurrencyPolicyDto = z.infer<typeof workflowConcurrencyPolicySchema>;

/**
 * The one canonical, editable graph shared by authoring, canvas and publication.
 * Catalog DTOs remain published-version projections and must not replace this shape.
 */
export const workflowGraphDefinitionSchema = z
  .object({
    entryNodeIds: z.array(z.string().min(1)).min(1),
    nodes: z.array(workflowGraphNodeSchema).min(1),
    edges: z.array(workflowGraphEdgeSchema),
    failurePolicy: workflowFailurePolicySchema,
    concurrencyPolicy: workflowConcurrencyPolicySchema,
  })
  .strict()
  .superRefine((graph, context) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of graph.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "id"],
          message: `duplicate workflow node id: ${node.id}`,
        });
      }
      nodeIds.add(node.id);
    }

    const entryIds = new Set<string>();
    for (const [index, entryId] of graph.entryNodeIds.entries()) {
      if (!nodeIds.has(entryId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entryNodeIds", index],
          message: `workflow entry node does not exist: ${entryId}`,
        });
      }
      if (entryIds.has(entryId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entryNodeIds", index],
          message: `duplicate workflow entry node id: ${entryId}`,
        });
      }
      entryIds.add(entryId);
    }

    const edgeIds = new Set<string>();
    const outgoing = new Map<string, string[]>();
    for (const [index, edge] of graph.edges.entries()) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index, "id"],
          message: `duplicate workflow edge id: ${edge.id}`,
        });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index],
          message: `workflow edge ${edge.id} references a missing node`,
        });
        continue;
      }
      if (edge.from === edge.to) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edges", index],
          message: `workflow edge ${edge.id} cannot reference itself`,
        });
      }
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const next of outgoing.get(nodeId) ?? []) {
        if (visit(next)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    if (graph.nodes.some((node) => visit(node.id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges"],
        message: "workflow graph must be a finite DAG",
      });
    }
  });
export type WorkflowGraphDefinitionDto = z.infer<typeof workflowGraphDefinitionSchema>;

export const workflowVersionSchema = z
  .object({
    id: z.string().min(1),
    workflowId: z.string().min(1),
    version: z.string().min(1),
    status: z.enum(workflowDefinitionStatuses),
    immutable: z.boolean(),
    entry: z.string().min(1).optional(),
    steps: z.array(workflowStepSchema).optional(),
    nodes: z.array(workflowGraphNodeSchema).optional(),
    edges: z.array(workflowGraphEdgeSchema).optional(),
    stateRevision: z.number().int().min(1).optional(),
    publishedAt: z.string().datetime().optional(),
  })
  .strict();

export type WorkflowVersionDto = z.infer<typeof workflowVersionSchema>;

export const workflowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    protocolVersion: z.literal("0.1"),
    status: z.enum(workflowDefinitionStatuses),
    activeVersionId: z.string().min(1).optional(),
    versions: z.array(workflowVersionSchema),
    stateRevision: z.number().int().min(1).optional(),
    definitionRevision: z.number().int().min(1).optional(),
  })
  .strict();

export type WorkflowDto = z.infer<typeof workflowSchema>;

export const workflowPageSchema = z
  .object({
    items: z.array(workflowSchema),
    page: z
      .object({
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type WorkflowPageDto = z.infer<typeof workflowPageSchema>;

export const createWorkflowInputSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

export type CreateWorkflowInput = z.infer<typeof createWorkflowInputSchema>;

export const patchWorkflowInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

export type PatchWorkflowInput = z.infer<typeof patchWorkflowInputSchema>;

export const workflowVersionWriteSchema = z
  .object({
    version: z.string().min(1).optional(),
    entry: z.string().min(1).optional(),
    steps: z.array(workflowStepSchema).optional(),
    nodes: z.array(workflowGraphNodeSchema).optional(),
    edges: z.array(workflowGraphEdgeSchema).optional(),
  })
  .strict();

export type CreateWorkflowVersionInput = z.infer<typeof workflowVersionWriteSchema>;
export type PatchWorkflowVersionInput = z.infer<typeof workflowVersionWriteSchema>;

export function parseWorkflow(input: unknown): WorkflowDto {
  return workflowSchema.parse(input);
}

export function parseWorkflowVersion(input: unknown): WorkflowVersionDto {
  return workflowVersionSchema.parse(input);
}

export function parseWorkflowPage(input: unknown): WorkflowPageDto {
  return workflowPageSchema.parse(input);
}

export function parseCreateWorkflowInput(input: unknown): CreateWorkflowInput {
  return createWorkflowInputSchema.parse(input);
}

export function parsePatchWorkflowInput(input: unknown): PatchWorkflowInput {
  return patchWorkflowInputSchema.parse(input);
}

export function parseWorkflowVersionWrite(input: unknown): CreateWorkflowVersionInput {
  return workflowVersionWriteSchema.parse(input);
}

export function parseWorkflowGraphDefinition(input: unknown): WorkflowGraphDefinitionDto {
  return workflowGraphDefinitionSchema.parse(input);
}

export function isPublishedWorkflowVersion(
  version: Pick<WorkflowVersionDto, "status" | "immutable">,
): boolean {
  return version.status === "published" && version.immutable === true;
}

export function isExecutableWorkflowVersion(
  version: Pick<WorkflowVersionDto, "status" | "immutable">,
): boolean {
  return isPublishedWorkflowVersion(version);
}
