import { z } from "zod";

import { orchestrationModeSchema, runtimeTransportSchema } from "./execution.js";
import { moneyKinds } from "./money.js";

/**
 * HTTP/public DTOs that previously lived as hand-written copies in daemon and
 * desktop-client. Axis fields on RunDto are optional until Application writes
 * a resolved snapshot; do not fill fake `workflow_bound` defaults.
 */
export const projectDtoSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string(),
    objective: z.string(),
    status: z.string(),
    stateRevision: z.number().int(),
    protocolVersion: z.literal("0.1"),
    cancelRequested: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    planArtifactVersionId: z.string().min(1).optional(),
    executionSnapshotId: z.string().min(1).optional(),
    teamVersionId: z.string().min(1).optional(),
    /** Echo of requested D18 mode after `:start`. Not a scheduler claim. */
    orchestrationMode: orchestrationModeSchema.optional(),
  })
  .strict();

export type ProjectDto = z.infer<typeof projectDtoSchema>;

export const runUsageSchema = z
  .object({
    costMinor: z.number().int(),
    currency: z.string(),
    kind: z.enum(moneyKinds),
  })
  .strict();

export const runDtoSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    status: z.string(),
    stateRevision: z.number().int(),
    definitionRevision: z.number().int(),
    generation: z.number().int(),
    attempt: z.number().int(),
    protocolVersion: z.literal("0.1"),
    cancelRequested: z.boolean(),
    usage: runUsageSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    orchestrationMode: orchestrationModeSchema.optional(),
    transport: runtimeTransportSchema.optional(),
    executionSnapshotId: z.string().min(1).optional(),
  })
  .strict();

export type RunDto = z.infer<typeof runDtoSchema>;

export function parseProjectDto(input: unknown): ProjectDto {
  return projectDtoSchema.parse(input);
}

export function parseRunDto(input: unknown): RunDto {
  return runDtoSchema.parse(input);
}
