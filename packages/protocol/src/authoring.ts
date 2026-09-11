import { z } from "zod";

import { teamMemberSchema } from "./team.js";
import { workflowVersionWriteSchema } from "./workflow.js";

/**
 * D17 conversational authoring session / draft DTOs.
 * Not a Runtime, Task, or Run. Not a chat HTTP resource.
 * T20 send stays disabled until a follow-up wires these types.
 * Old name `executionMode` is not D17 and is not accepted here.
 */
export const AUTHORING_SESSION_ID_PREFIX = "cas_" as const;
export const AUTHORING_SESSION_MESSAGE_ID_PREFIX = "cam_" as const;

export const authoringSessionStatuses = ["open", "failed", "closed"] as const;
export type AuthoringSessionStatus = (typeof authoringSessionStatuses)[number];

export const authoringSessionMessageRoles = ["user", "system", "authoring_agent"] as const;
export type AuthoringSessionMessageRole = (typeof authoringSessionMessageRoles)[number];

export const authoringDraftKinds = ["proposal", "landed"] as const;
export type AuthoringDraftKind = (typeof authoringDraftKinds)[number];

export const authoringSessionMessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(authoringSessionMessageRoles),
    content: z.string().trim().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AuthoringSessionMessageDto = z.infer<typeof authoringSessionMessageSchema>;

const authoringDraftWorkflowProposalSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    graph: workflowVersionWriteSchema.optional(),
  })
  .strict();

const authoringDraftTeamProposalSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    members: z.array(teamMemberSchema).optional(),
  })
  .strict();

export const authoringDraftProposalSchema = z
  .object({
    kind: z.literal("proposal"),
    unpublished: z.literal(true),
    workflow: authoringDraftWorkflowProposalSchema.optional(),
    team: authoringDraftTeamProposalSchema.optional(),
  })
  .strict();

export const authoringDraftLandedSchema = z
  .object({
    kind: z.literal("landed"),
    unpublished: z.literal(true),
    workflowId: z.string().min(1),
    workflowVersionId: z.string().min(1),
    teamId: z.string().min(1).optional(),
    teamVersionId: z.string().min(1).optional(),
  })
  .strict();

export const authoringDraftSchema = z.discriminatedUnion("kind", [
  authoringDraftProposalSchema,
  authoringDraftLandedSchema,
]);

export type AuthoringDraftDto = z.infer<typeof authoringDraftSchema>;

export const authoringSessionSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    protocolVersion: z.literal("0.1"),
    status: z.enum(authoringSessionStatuses),
    messages: z.array(authoringSessionMessageSchema),
    draft: authoringDraftSchema.optional(),
    stateRevision: z.number().int().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type AuthoringSessionDto = z.infer<typeof authoringSessionSchema>;

export const createAuthoringSessionInputSchema = z
  .object({
    projectId: z.string().min(1),
    intentText: z.string().trim().min(1).optional(),
  })
  .strict();

export type CreateAuthoringSessionInput = z.infer<typeof createAuthoringSessionInputSchema>;

/** User turn only. Agent replies are not produced by this contract. */
export const appendAuthoringSessionMessageInputSchema = z
  .object({
    sessionId: z.string().min(1),
    role: z.literal("user"),
    content: z.string().trim().min(1),
  })
  .strict();

export type AppendAuthoringSessionMessageInput = z.infer<
  typeof appendAuthoringSessionMessageInputSchema
>;

export function parseAuthoringSessionMessage(input: unknown): AuthoringSessionMessageDto {
  return authoringSessionMessageSchema.parse(input);
}

function assertAuthoringDraftPayload(draft: AuthoringDraftDto): void {
  if (draft.kind === "proposal" && draft.workflow === undefined && draft.team === undefined) {
    throw new Error("proposal draft needs workflow or team");
  }
}

export function parseAuthoringDraft(input: unknown): AuthoringDraftDto {
  const draft = authoringDraftSchema.parse(input);
  assertAuthoringDraftPayload(draft);
  return draft;
}

export function parseAuthoringSession(input: unknown): AuthoringSessionDto {
  const session = authoringSessionSchema.parse(input);
  if (session.draft) {
    assertAuthoringDraftPayload(session.draft);
  }
  return session;
}

export function parseCreateAuthoringSessionInput(input: unknown): CreateAuthoringSessionInput {
  return createAuthoringSessionInputSchema.parse(input);
}

export function parseAppendAuthoringSessionMessageInput(
  input: unknown,
): AppendAuthoringSessionMessageInput {
  return appendAuthoringSessionMessageInputSchema.parse(input);
}

export function isUnpublishedAuthoringDraft(
  draft: Pick<AuthoringDraftDto, "unpublished">,
): boolean {
  return draft.unpublished === true;
}
