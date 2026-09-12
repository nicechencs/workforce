import { z } from "zod";

export const teamDefinitionStatuses = ["draft", "published"] as const;
export type TeamDefinitionStatus = (typeof teamDefinitionStatuses)[number];

export const teamRoleSchema = z
  .object({
    id: z.string().min(1),
    role: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();

export type TeamRoleDto = z.infer<typeof teamRoleSchema>;

export const teamMemberSchema = z
  .object({
    id: z.string().min(1).optional(),
    role: z.string().min(1),
    runtimeProfileId: z.string().min(1),
    quantity: z.number().int().min(1),
  })
  .strict();

export type TeamMemberDto = z.infer<typeof teamMemberSchema>;

export const teamVersionSchema = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    version: z.string().min(1),
    status: z.enum(teamDefinitionStatuses),
    immutable: z.boolean(),
    members: z.array(teamMemberSchema),
    stateRevision: z.number().int().min(1).optional(),
    publishedAt: z.string().datetime().optional(),
  })
  .strict();

export type TeamVersionDto = z.infer<typeof teamVersionSchema>;

export const teamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string(),
    status: z.enum(teamDefinitionStatuses),
    protocolVersion: z.literal("0.1"),
    roles: z.array(teamRoleSchema),
    activeVersionId: z.string().min(1).optional(),
    versions: z.array(teamVersionSchema).optional(),
    stateRevision: z.number().int().min(1).optional(),
    definitionRevision: z.number().int().min(1).optional(),
  })
  .strict();

export type TeamDto = z.infer<typeof teamSchema>;

export const teamPageSchema = z
  .object({
    items: z.array(teamSchema),
    page: z
      .object({
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type TeamPageDto = z.infer<typeof teamPageSchema>;

export const createTeamInputSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

export type CreateTeamInput = z.infer<typeof createTeamInputSchema>;

export const patchTeamInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

export type PatchTeamInput = z.infer<typeof patchTeamInputSchema>;

export const teamVersionWriteSchema = z
  .object({
    version: z.string().min(1).optional(),
    members: z.array(teamMemberSchema),
  })
  .strict();

export type CreateTeamVersionInput = z.infer<typeof teamVersionWriteSchema>;
export type PatchTeamVersionInput = z.infer<typeof teamVersionWriteSchema>;

export function parseTeam(input: unknown): TeamDto {
  return teamSchema.parse(input);
}

export function parseTeamVersion(input: unknown): TeamVersionDto {
  return teamVersionSchema.parse(input);
}

export function parseTeamPage(input: unknown): TeamPageDto {
  return teamPageSchema.parse(input);
}

export function parseCreateTeamInput(input: unknown): CreateTeamInput {
  return createTeamInputSchema.parse(input);
}

export function parsePatchTeamInput(input: unknown): PatchTeamInput {
  return patchTeamInputSchema.parse(input);
}

export function parseTeamVersionWrite(input: unknown): CreateTeamVersionInput {
  return teamVersionWriteSchema.parse(input);
}

export function isPublishedTeamVersion(
  version: Pick<TeamVersionDto, "status" | "immutable">,
): boolean {
  return version.status === "published" && version.immutable === true;
}

export function isBindableTeamVersion(
  version: Pick<TeamVersionDto, "status" | "immutable">,
): boolean {
  return isPublishedTeamVersion(version);
}
