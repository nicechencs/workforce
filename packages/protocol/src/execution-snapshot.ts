import { z } from "zod";

/**
 * Public ProjectExecutionSnapshot DTO (C5).
 *
 * Policy and budget stay off this surface (D12). Storage may keep them as
 * inline JSON; `contentHash` covers `workflowVersionId`, `teamVersionId`,
 * canonical policy JSON and canonical budget JSON.
 *
 * Wire ids are plain strings. The domain brand is `ExecutionSnapshotId`
 * (`snp_` prefix); `SnapshotRef` is an alias of that brand.
 */
export const projectExecutionSnapshotSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    workflowVersionId: z.string().min(1),
    teamVersionId: z.string().min(1),
    contentHash: z.string().min(1),
    immutable: z.literal(true),
    createdAt: z.string(),
  })
  .strict();

export type ProjectExecutionSnapshotDto = z.infer<typeof projectExecutionSnapshotSchema>;

export const projectExecutionSnapshotHashFields = [
  "workflowVersionId",
  "teamVersionId",
  "policySnapshot",
  "budgetSnapshot",
] as const;

export function parseProjectExecutionSnapshot(input: unknown): ProjectExecutionSnapshotDto {
  return projectExecutionSnapshotSchema.parse(input);
}
