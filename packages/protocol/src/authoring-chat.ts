import { z } from "zod";

import {
  authoringChangeTargetTypes,
  authoringDraftProposalSchema,
  authoringSessionSchema,
  createAuthoringSessionInputSchema,
  type AuthoringSessionDto,
} from "./authoring.js";

/**
 * Project-scoped conversational authoring wire contracts.
 *
 * A turn is an authoring command/result boundary, not a Runtime, Task, or Run
 * itself. Task/Run/ChangeSet/Draft values below are references to the
 * governed objects created by the Application use case. Raw prompt text,
 * transport, placement, credentials, and Runtime metadata deliberately do
 * not appear in any response DTO.
 */

export const authoringTurnStatuses = [
  "accepted",
  "running",
  "awaiting_confirmation",
  "completed",
  "failed",
  "cancelled",
  "closed",
] as const;
export type AuthoringTurnStatus = (typeof authoringTurnStatuses)[number];

export const authoringTurnActionNames = ["confirm", "cancel", "retry", "close"] as const;
export type AuthoringTurnActionName = (typeof authoringTurnActionNames)[number];

const authoringIdSchema = z.string().trim().min(1).max(256);
const operationIdSchema = z.string().trim().min(1).max(256);
const idempotencyKeySchema = z.string().trim().min(1).max(256);
const revisionSchema = z.number().int().min(1);

/** Artifact references are bounded independently from object identifiers. */
export const authoringPatchRefSchema = z.string().trim().min(1).max(512);
export type AuthoringPatchRef = z.infer<typeof authoringPatchRefSchema>;

/** Only the user message can be supplied by a Desktop/client command. */
export const authoringUserMessageSchema = z
  .object({
    id: authoringIdSchema,
    role: z.literal("user"),
    content: z.string().trim().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();
export type AuthoringUserMessageDto = z.infer<typeof authoringUserMessageSchema>;

export const authoringTurnRefsSchema = z
  .object({
    taskId: authoringIdSchema.optional(),
    runId: authoringIdSchema.optional(),
    changeSetId: authoringIdSchema.optional(),
    /** The identity of the mutable draft, never a published version id. */
    workflowDraftId: authoringIdSchema.optional(),
    /** Unpublished Worker draft; never a published WorkerVersion id. */
    workerDraftId: authoringIdSchema.optional(),
  })
  .strict();
export type AuthoringTurnRefsDto = z.infer<typeof authoringTurnRefsSchema>;

export const authoringTurnSchema = z
  .object({
    id: authoringIdSchema,
    sessionId: authoringIdSchema,
    protocolVersion: z.literal("0.1"),
    status: z.enum(authoringTurnStatuses),
    userMessage: authoringUserMessageSchema,
    refs: authoringTurnRefsSchema,
    revision: revisionSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AuthoringTurnDto = z.infer<typeof authoringTurnSchema>;

/**
 * A canonical landed workflow draft reference. Keeping this separate from
 * the legacy `workflowVersionId` field prevents a draft from being presented
 * as an immutable/published workflow version in the chat contract.
 */
export const authoringWorkflowDraftRefSchema = z
  .object({
    workflowDraftId: authoringIdSchema,
    workflowId: authoringIdSchema.optional(),
    revision: revisionSchema.optional(),
  })
  .strict();
export type AuthoringWorkflowDraftRefDto = z.infer<typeof authoringWorkflowDraftRefSchema>;

/**
 * Chat projection for a draft that has been landed by an authoring command.
 * A landed draft is still unpublished. `workflowVersionId` is not a member
 * of this DTO. Worker confirmations carry `workerDraftId` instead of a
 * published WorkerVersion id.
 */
export const authoringLandedDraftSchema = z
  .object({
    kind: z.literal("landed"),
    unpublished: z.literal(true),
    workflowDraftId: authoringIdSchema.optional(),
    workerDraftId: authoringIdSchema.optional(),
    workflowId: authoringIdSchema.optional(),
    revision: revisionSchema.optional(),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.workflowDraftId === undefined && draft.workerDraftId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "landed draft needs workflowDraftId or workerDraftId",
      });
    }
  });
export type AuthoringLandedDraftDto = z.infer<typeof authoringLandedDraftSchema>;

/**
 * The chat-only draft union deliberately does not reuse the legacy landed
 * projection. The legacy projection calls a published-version-shaped field
 * `workflowVersionId`; a chat landed draft must carry its mutable
 * `workflowDraftId` instead.
 */
export const authoringChatDraftSchema = z.union([
  authoringDraftProposalSchema,
  authoringLandedDraftSchema,
]);
export type AuthoringChatDraftDto = z.infer<typeof authoringChatDraftSchema>;

/** New create/update target input. Legacy output targets remain unchanged. */
const authoringProposalTargetBaseSchema = z
  .object({
    targetType: z.enum(authoringChangeTargetTypes),
    patchRef: authoringPatchRefSchema,
  })
  .strict();

export const authoringProposalTargetCreateSchema = authoringProposalTargetBaseSchema
  .extend({
    operation: z.literal("create"),
    targetId: z.never().optional(),
    expectedRevision: z.never().optional(),
  })
  .strict();

export const authoringProposalTargetUpdateSchema = authoringProposalTargetBaseSchema
  .extend({
    operation: z.literal("update"),
    targetId: authoringIdSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

export const authoringProposalTargetInputSchema = z.union([
  authoringProposalTargetCreateSchema,
  authoringProposalTargetUpdateSchema,
]);
export type AuthoringProposalTargetInput = z.infer<typeof authoringProposalTargetInputSchema>;

/** Aliases make the create/update evolution explicit at the public surface. */
export const authoringProposalTargetCommandSchema = authoringProposalTargetInputSchema;
export type AuthoringProposalTargetCommand = AuthoringProposalTargetInput;

/**
 * Chat proposal wire shape. This is intentionally a new contract rather than
 * widening AuthoringProposalDto: the existing Application consumer requires
 * update targets and must remain source-compatible until it gains a resolver
 * for create targets.
 */
export const authoringChatProposalSchema = z
  .object({
    id: authoringIdSchema,
    projectId: authoringIdSchema,
    sessionId: authoringIdSchema,
    turnId: authoringIdSchema,
    sourceRunId: authoringIdSchema,
    summary: z.string().trim().min(1),
    targets: z.array(authoringProposalTargetInputSchema).min(1),
  })
  .strict()
  .superRefine((proposal, context) => {
    const identities = new Set<string>();
    for (const [index, target] of proposal.targets.entries()) {
      const identity =
        target.operation === "create"
          ? `${target.targetType}:create:${target.patchRef}`
          : `${target.targetType}:update:${target.targetId}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", index],
          message: `duplicate authoring chat proposal target: ${identity}`,
        });
      }
      identities.add(identity);
    }
  });
export type AuthoringChatProposalDto = z.infer<typeof authoringChatProposalSchema>;

export const authoringSessionListInputSchema = z
  .object({
    projectId: authoringIdSchema,
    cursor: authoringIdSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type AuthoringSessionListInput = z.infer<typeof authoringSessionListInputSchema>;

export const authoringSessionSummarySchema = z
  .object({
    id: authoringIdSchema,
    projectId: authoringIdSchema,
    protocolVersion: z.literal("0.1"),
    status: z.enum(["open", "failed", "closed"]),
    stateRevision: revisionSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AuthoringSessionSummaryDto = z.infer<typeof authoringSessionSummarySchema>;

export const authoringSessionPageSchema = z
  .object({
    items: z.array(authoringSessionSummarySchema),
    page: z
      .object({
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type AuthoringSessionPageDto = z.infer<typeof authoringSessionPageSchema>;

export const authoringSessionGetInputSchema = z
  .object({
    sessionId: authoringIdSchema,
  })
  .strict();
export type AuthoringSessionGetInput = z.infer<typeof authoringSessionGetInputSchema>;

export const authoringSessionViewSchema = authoringSessionSchema
  .omit({ draft: true })
  .extend({
    draft: authoringChatDraftSchema.optional(),
    turns: z.array(authoringTurnSchema),
  })
  .strict();
export type AuthoringSessionViewDto = z.infer<typeof authoringSessionViewSchema>;

export const createAuthoringSessionCommandSchema = createAuthoringSessionInputSchema
  .extend({
    operationId: operationIdSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type CreateAuthoringSessionCommand = z.infer<typeof createAuthoringSessionCommandSchema>;

/**
 * Send is intentionally a user-only command. There is no role field for the
 * caller to spoof and no place for Runtime transport/placement metadata.
 */
export const sendAuthoringMessageInputSchema = z
  .object({
    operationId: operationIdSchema,
    idempotencyKey: idempotencyKeySchema,
    sessionId: authoringIdSchema,
    expectedRevision: revisionSchema,
    content: z.string().trim().min(1),
  })
  .strict();
export type SendAuthoringMessageInput = z.infer<typeof sendAuthoringMessageInputSchema>;

export const sendAuthoringMessageCommandSchema = sendAuthoringMessageInputSchema;
export type SendAuthoringMessageCommand = SendAuthoringMessageInput;

export const authoringTurnActionInputSchema = z
  .object({
    operationId: operationIdSchema,
    idempotencyKey: idempotencyKeySchema,
    sessionId: authoringIdSchema,
    turnId: authoringIdSchema,
    expectedRevision: revisionSchema,
  })
  .strict();
export type AuthoringTurnActionInput = z.infer<typeof authoringTurnActionInputSchema>;

function actionInputSchema(action: AuthoringTurnActionName) {
  return authoringTurnActionInputSchema.extend({ action: z.literal(action).optional() }).strict();
}

export const confirmAuthoringTurnInputSchema = actionInputSchema("confirm");
export type ConfirmAuthoringTurnInput = z.infer<typeof confirmAuthoringTurnInputSchema>;
export const cancelAuthoringTurnInputSchema = actionInputSchema("cancel");
export type CancelAuthoringTurnInput = z.infer<typeof cancelAuthoringTurnInputSchema>;
export const retryAuthoringTurnInputSchema = actionInputSchema("retry");
export type RetryAuthoringTurnInput = z.infer<typeof retryAuthoringTurnInputSchema>;
export const closeAuthoringTurnInputSchema = actionInputSchema("close");
export type CloseAuthoringTurnInput = z.infer<typeof closeAuthoringTurnInputSchema>;

export const authoringTurnActionCommandSchema = z.discriminatedUnion("action", [
  authoringTurnActionInputSchema.extend({ action: z.literal("confirm") }),
  authoringTurnActionInputSchema.extend({ action: z.literal("cancel") }),
  authoringTurnActionInputSchema.extend({ action: z.literal("retry") }),
  authoringTurnActionInputSchema.extend({ action: z.literal("close") }),
]);
export type AuthoringTurnActionCommand = z.infer<typeof authoringTurnActionCommandSchema>;

export const authoringCommandAcceptedSchema = z
  .object({
    operationId: operationIdSchema,
    acceptedAt: z.string().datetime(),
    sessionId: authoringIdSchema,
    turnId: authoringIdSchema.optional(),
    revision: revisionSchema,
  })
  .strict();
export type AuthoringCommandAcceptedDto = z.infer<typeof authoringCommandAcceptedSchema>;

export const createAuthoringSessionAcceptedSchema = authoringCommandAcceptedSchema.extend({
  sessionId: authoringIdSchema,
});
export type CreateAuthoringSessionAcceptedDto = z.infer<
  typeof createAuthoringSessionAcceptedSchema
>;

export const sendAuthoringMessageAcceptedSchema = authoringCommandAcceptedSchema.extend({
  turnId: authoringIdSchema,
});
export type SendAuthoringMessageAcceptedDto = z.infer<typeof sendAuthoringMessageAcceptedSchema>;

export const authoringTurnActionAcceptedSchema = authoringCommandAcceptedSchema.extend({
  turnId: authoringIdSchema,
  action: z.enum(authoringTurnActionNames),
});
export type AuthoringTurnActionAcceptedDto = z.infer<typeof authoringTurnActionAcceptedSchema>;

export function parseAuthoringTurn(input: unknown): AuthoringTurnDto {
  return authoringTurnSchema.parse(input);
}

export function parseAuthoringWorkflowDraftRef(input: unknown): AuthoringWorkflowDraftRefDto {
  return authoringWorkflowDraftRefSchema.parse(input);
}

export function parseAuthoringLandedDraft(input: unknown): AuthoringLandedDraftDto {
  return authoringLandedDraftSchema.parse(input);
}

export function parseAuthoringProposalTargetInput(input: unknown): AuthoringProposalTargetInput {
  return authoringProposalTargetInputSchema.parse(input);
}

export function parseAuthoringChatProposal(input: unknown): AuthoringChatProposalDto {
  return authoringChatProposalSchema.parse(input);
}

export function parseAuthoringSessionListInput(input: unknown): AuthoringSessionListInput {
  return authoringSessionListInputSchema.parse(input);
}

export function parseAuthoringSessionPage(input: unknown): AuthoringSessionPageDto {
  return authoringSessionPageSchema.parse(input);
}

export function parseAuthoringSessionGetInput(input: unknown): AuthoringSessionGetInput {
  return authoringSessionGetInputSchema.parse(input);
}

export function parseAuthoringSessionView(input: unknown): AuthoringSessionViewDto {
  return authoringSessionViewSchema.parse(input);
}

export function parseCreateAuthoringSessionCommand(input: unknown): CreateAuthoringSessionCommand {
  return createAuthoringSessionCommandSchema.parse(input);
}

export function parseSendAuthoringMessageInput(input: unknown): SendAuthoringMessageInput {
  return sendAuthoringMessageInputSchema.parse(input);
}

export function parseSendAuthoringMessageCommand(input: unknown): SendAuthoringMessageCommand {
  return sendAuthoringMessageCommandSchema.parse(input);
}

export function parseAuthoringTurnActionCommand(input: unknown): AuthoringTurnActionCommand {
  return authoringTurnActionCommandSchema.parse(input);
}

export function parseAuthoringCommandAccepted(input: unknown): AuthoringCommandAcceptedDto {
  return authoringCommandAcceptedSchema.parse(input);
}

export function parseCreateAuthoringSessionAccepted(
  input: unknown,
): CreateAuthoringSessionAcceptedDto {
  return createAuthoringSessionAcceptedSchema.parse(input);
}

export function parseSendAuthoringMessageAccepted(input: unknown): SendAuthoringMessageAcceptedDto {
  return sendAuthoringMessageAcceptedSchema.parse(input);
}

export function parseAuthoringTurnActionAccepted(input: unknown): AuthoringTurnActionAcceptedDto {
  return authoringTurnActionAcceptedSchema.parse(input);
}

/** Type-only compatibility marker for consumers that already own a session DTO. */
export type AuthoringSessionLike = AuthoringSessionDto | AuthoringSessionViewDto;
