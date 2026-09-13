import { z } from "zod";

/**
 * Role-library wire contracts. WorkerVersion is the identity Team binds.
 * Published + immutable versions are not edited in place; fork creates a new
 * Worker identity and a new draft. This module is not a Marketplace catalog
 * and not an IM inbox: there is no worker-as-peer session object.
 *
 * The printable card is exactly three optional fields: who / how / skills.
 * Runtime and Policy stay optional on the version and are never card-required.
 * Old records without these keys still parse; new writes may fill them.
 */

export const workerDefinitionStatuses = ["draft", "published"] as const;
export type WorkerDefinitionStatus = (typeof workerDefinitionStatuses)[number];

/** Printable role-card slots. These three keys are the card; values are optional. */
export const workerCardFieldNames = ["who", "how", "skills"] as const;
export type WorkerCardFieldName = (typeof workerCardFieldNames)[number];
export const workerCardFieldNameSchema = z.enum(workerCardFieldNames);

/**
 * 他是谁 / 怎么干活 / 会哪些技能.
 * Absent means empty on old rows. Empty string is an explicit blank cell.
 * Not Runtime, Policy, placement, or a Marketplace listing.
 */
const workerCardFieldShape = {
  who: z.string().optional(),
  how: z.string().optional(),
  skills: z.string().optional(),
};

export const workerCardFieldsDtoSchema = z.object(workerCardFieldShape).strict();
export type WorkerCardFieldsDto = z.infer<typeof workerCardFieldsDtoSchema>;

export const workerVersionDtoSchema = z
  .object({
    id: z.string().min(1),
    workerId: z.string().min(1),
    version: z.string().min(1),
    status: z.enum(workerDefinitionStatuses),
    immutable: z.boolean(),
    archived: z.boolean(),
    name: z.string().min(1),
    description: z.string().optional(),
    /** Duty label, not the Worker identity. */
    role: z.string().min(1),
    /** Published members take this version as the source of truth. Not a card field. */
    runtimeProfileId: z.string().min(1).optional(),
    forkedFromWorkerVersionId: z.string().min(1).optional(),
    stateRevision: z.number().int().min(1).optional(),
    publishedAt: z.string().datetime().optional(),
    archivedAt: z.string().datetime().optional(),
    ...workerCardFieldShape,
  })
  .strict();

export type WorkerVersionDto = z.infer<typeof workerVersionDtoSchema>;

export const workerDraftDtoSchema = z
  .object({
    id: z.string().min(1),
    workerId: z.string().min(1),
    revision: z.number().int().min(1),
    status: z.literal("draft"),
    name: z.string().min(1),
    description: z.string().optional(),
    role: z.string().min(1),
    /** Optional execution binding. Not a required card field. */
    runtimeProfileId: z.string().min(1).optional(),
    contentHash: z.string().min(1),
    updatedAt: z.string().datetime(),
    updatedBy: z.string().min(1),
    ...workerCardFieldShape,
  })
  .strict();

export type WorkerDraftDto = z.infer<typeof workerDraftDtoSchema>;

export const workerDtoSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    protocolVersion: z.literal("0.1"),
    status: z.enum(workerDefinitionStatuses),
    activeVersionId: z.string().min(1).optional(),
    /** Open unpublished draft for this identity. Absent after publish. */
    activeDraftId: z.string().min(1).optional(),
    versions: z.array(workerVersionDtoSchema).optional(),
    stateRevision: z.number().int().min(1).optional(),
    definitionRevision: z.number().int().min(1).optional(),
  })
  .strict();

export type WorkerDto = z.infer<typeof workerDtoSchema>;

export const workerPageDtoSchema = z
  .object({
    items: z.array(workerDtoSchema),
    page: z
      .object({
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type WorkerPageDto = z.infer<typeof workerPageDtoSchema>;

export const listWorkersInputSchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    status: z.enum(workerDefinitionStatuses).optional(),
    includeArchived: z.boolean().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ListWorkersInput = z.infer<typeof listWorkersInputSchema>;

export const createWorkerInputSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    role: z.string().min(1).optional(),
    runtimeProfileId: z.string().min(1).optional(),
    ...workerCardFieldShape,
  })
  .strict();

export type CreateWorkerInput = z.infer<typeof createWorkerInputSchema>;

export const patchWorkerInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();

export type PatchWorkerInput = z.infer<typeof patchWorkerInputSchema>;

export const workerDraftWriteSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    role: z.string().min(1).optional(),
    runtimeProfileId: z.string().min(1).optional(),
    ...workerCardFieldShape,
  })
  .strict();

export type WorkerDraftWrite = z.infer<typeof workerDraftWriteSchema>;

export const workerVersionTeamReferenceSchema = z
  .object({
    teamId: z.string().min(1),
    teamVersionId: z.string().min(1),
    status: z.enum(["draft", "published"]),
  })
  .strict();

export type WorkerVersionTeamReferenceDto = z.infer<typeof workerVersionTeamReferenceSchema>;

export const workerVersionReferencesDtoSchema = z
  .object({
    workerVersionId: z.string().min(1),
    teamVersions: z.array(workerVersionTeamReferenceSchema),
  })
  .strict();

export type WorkerVersionReferencesDto = z.infer<typeof workerVersionReferencesDtoSchema>;

export const forkWorkerVersionAcceptedDtoSchema = z
  .object({
    workerId: z.string().min(1),
    workerDraftId: z.string().min(1),
    forkedFromWorkerVersionId: z.string().min(1),
  })
  .strict();

export type ForkWorkerVersionAcceptedDto = z.infer<typeof forkWorkerVersionAcceptedDtoSchema>;

export function parseWorker(input: unknown): WorkerDto {
  return workerDtoSchema.parse(input);
}

export function parseWorkerVersion(input: unknown): WorkerVersionDto {
  return workerVersionDtoSchema.parse(input);
}

export function parseWorkerDraft(input: unknown): WorkerDraftDto {
  return workerDraftDtoSchema.parse(input);
}

export function parseWorkerPage(input: unknown): WorkerPageDto {
  return workerPageDtoSchema.parse(input);
}

export function parseListWorkersInput(input: unknown): ListWorkersInput {
  return listWorkersInputSchema.parse(input);
}

export function parseCreateWorkerInput(input: unknown): CreateWorkerInput {
  return createWorkerInputSchema.parse(input);
}

export function parsePatchWorkerInput(input: unknown): PatchWorkerInput {
  return patchWorkerInputSchema.parse(input);
}

export function parseWorkerDraftWrite(input: unknown): WorkerDraftWrite {
  return workerDraftWriteSchema.parse(input);
}

export function parseWorkerVersionReferences(input: unknown): WorkerVersionReferencesDto {
  return workerVersionReferencesDtoSchema.parse(input);
}

export function parseForkWorkerVersionAccepted(input: unknown): ForkWorkerVersionAcceptedDto {
  return forkWorkerVersionAcceptedDtoSchema.parse(input);
}

export function parseWorkerCardFields(input: unknown): WorkerCardFieldsDto {
  return workerCardFieldsDtoSchema.parse(input);
}

export function isWorkerCardFieldName(value: string): value is WorkerCardFieldName {
  return (workerCardFieldNames as readonly string[]).includes(value);
}

export function isPublishedWorkerVersion(
  version: Pick<WorkerVersionDto, "status" | "immutable">,
): boolean {
  return version.status === "published" && version.immutable === true;
}

/**
 * Card who/how/skills follow the version. Published + immutable must not be
 * patched in place; writers fork (new identity + new draft) instead.
 * There is no UPDATE-published WorkerVersion path.
 */
export function workerCardFieldsAreImmutable(
  version: Pick<WorkerVersionDto, "status" | "immutable">,
): boolean {
  return isPublishedWorkerVersion(version);
}

/**
 * Archived versions remain valid on existing TeamVersion references.
 * They must not be selected by a new Team publish/bind.
 */
export function isSelectableWorkerVersion(
  version: Pick<WorkerVersionDto, "status" | "immutable" | "archived">,
): boolean {
  return isPublishedWorkerVersion(version) && version.archived === false;
}

export function isEditableWorkerDraft(draft: Pick<WorkerDraftDto, "status">): boolean {
  return draft.status === "draft";
}
