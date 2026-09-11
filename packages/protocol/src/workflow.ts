import { z } from "zod";

export const workflowStepKinds = ["task", "delivery", "approval"] as const;
export type WorkflowStepKind = (typeof workflowStepKinds)[number];

export const workflowGates = ["plan", "artifact"] as const;
export type WorkflowGate = (typeof workflowGates)[number];

export const workflowCatalogStatuses = ["published"] as const;
export type WorkflowCatalogStatus = (typeof workflowCatalogStatuses)[number];

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

export const workflowVersionSchema = z
  .object({
    id: z.string().min(1),
    workflowId: z.string().min(1),
    version: z.string().min(1),
    status: z.enum(workflowCatalogStatuses),
    immutable: z.literal(true),
    entry: z.string().min(1),
    steps: z.array(workflowStepSchema),
  })
  .strict();

export type WorkflowVersionDto = z.infer<typeof workflowVersionSchema>;

export const workflowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    protocolVersion: z.literal("0.1"),
    status: z.enum(workflowCatalogStatuses),
    activeVersionId: z.string().min(1),
    versions: z.array(workflowVersionSchema),
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

export function parseWorkflow(input: unknown): WorkflowDto {
  return workflowSchema.parse(input);
}

export function parseWorkflowVersion(input: unknown): WorkflowVersionDto {
  return workflowVersionSchema.parse(input);
}

export function parseWorkflowPage(input: unknown): WorkflowPageDto {
  return workflowPageSchema.parse(input);
}
