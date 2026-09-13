import { z } from "zod";

import { orchestrationModeSchema, placementIntentSchema } from "./execution.js";

export const commandReceiptStatusSchema = z.enum(["pending", "committed", "failed"]);

export const receiptScopeSchema = z
  .object({
    principalId: z.string().min(1),
    clientId: z.string().min(1),
    canonicalOperation: z.string().min(1),
    resource: z.string().min(1),
    idempotencyKey: z.string().min(1),
  })
  .strict();

export type ReceiptScope = z.infer<typeof receiptScopeSchema>;

export const commandReceiptSchema = z
  .object({
    operationId: z.string().min(1),
    status: commandReceiptStatusSchema,
    scope: receiptScopeSchema,
    requestDigest: z.string().min(1),
    acceptedAt: z.string().datetime(),
    result: z.unknown().optional(),
  })
  .strict();

export type CommandReceipt = z.infer<typeof commandReceiptSchema>;

export const startRunRequestSchema = z
  .object({
    operationId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    taskId: z.string().min(1),
    definitionRevision: z.number().int().min(1),
    generation: z.number().int().min(1),
    attempt: z.number().int().min(1),
    principalId: z.string().min(1),
    clientId: z.string().min(1),
    placement: z
      .object({
        executionNodeId: z.string().min(1),
        runtimeInstallationId: z.string().min(1),
        workspaceInstanceId: z.string().min(1),
      })
      .strict(),
    runtime: z
      .object({
        adapterId: z.string().min(1),
        protocolVersion: z.string().min(1),
      })
      .strict(),
    snapshotRef: z.string().min(1),
  })
  .strict();

export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

export function parseStartRunRequest(input: unknown): StartRunRequest {
  return startRunRequestSchema.parse(input);
}

/** Request body for POST /tasks/{taskId}/runs. */
export const startTaskRunInputSchema = z
  .object({
    operationId: z.string().min(1),
    orchestrationMode: orchestrationModeSchema.optional(),
    placementIntent: placementIntentSchema.optional(),
  })
  .strict();

export type StartTaskRunInput = z.infer<typeof startTaskRunInputSchema>;

export function parseStartTaskRunInput(input: unknown): StartTaskRunInput {
  return startTaskRunInputSchema.parse(input);
}

/**
 * Request body for `POST /projects/{id}/tasks` (Chat `start_direct` without
 * `taskId`). Application `createAdHocTask`. Ad-hoc only: body must not
 * carry `workflowInstanceId`. `StartRunRequest` is unchanged and still has
 * no `orchestrationMode`.
 */
export const createAdHocTaskInputSchema = z
  .object({
    operationId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    title: z.string().trim().min(1).optional(),
    expectedStateRevision: z.number().int().min(1).optional(),
    workflowInstanceId: z.never().optional(),
  })
  .strict();

export type CreateAdHocTaskInput = z.infer<typeof createAdHocTaskInputSchema>;

export function parseCreateAdHocTaskInput(input: unknown): CreateAdHocTaskInput {
  return createAdHocTaskInputSchema.parse(input);
}
