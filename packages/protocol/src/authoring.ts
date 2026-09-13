import { z } from "zod";

import { teamMemberSchema } from "./team.js";
import { workflowGraphDefinitionSchema, workflowVersionWriteSchema } from "./workflow.js";

/**
 * D17 conversational authoring session / draft DTOs.
 * Not a Runtime, Task, or Run.
 * V0.1 transport is Daemon AuthoringSession HTTP: Project-scoped
 * `POST /projects/:id/authoring-sessions`, message append, and turn confirm.
 * Desktop drives chat through the typed client; `CHAT_SESSION_PROTOCOL_FROZEN`
 * is true. Old name `executionMode` is not D17 and is not accepted here.
 */
export const AUTHORING_SESSION_ID_PREFIX = "cas_" as const;
export const AUTHORING_SESSION_MESSAGE_ID_PREFIX = "cam_" as const;
export const AUTHORING_PROPOSAL_ID_PREFIX = "apr_" as const;
export const AUTHORING_CHANGE_SET_ID_PREFIX = "acs_" as const;
export const AUTHORING_CHANGE_SET_STEP_ID_PREFIX = "acst_" as const;

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

const authoringDraftWorkerProposalSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    role: z.string().min(1).optional(),
    runtimeProfileId: z.string().min(1).optional(),
  })
  .strict();

export const authoringDraftProposalSchema = z
  .object({
    kind: z.literal("proposal"),
    unpublished: z.literal(true),
    workflow: authoringDraftWorkflowProposalSchema.optional(),
    team: authoringDraftTeamProposalSchema.optional(),
    worker: authoringDraftWorkerProposalSchema.optional(),
  })
  .strict();

export const authoringDraftLandedSchema = z
  .object({
    kind: z.literal("landed"),
    unpublished: z.literal(true),
    workflowId: z.string().min(1).optional(),
    workflowVersionId: z.string().min(1).optional(),
    teamId: z.string().min(1).optional(),
    teamVersionId: z.string().min(1).optional(),
    workerId: z.string().min(1).optional(),
    workerDraftId: z.string().min(1).optional(),
  })
  .strict();

export const authoringDraftSchema = z.discriminatedUnion("kind", [
  authoringDraftProposalSchema,
  authoringDraftLandedSchema,
]);

export type AuthoringDraftDto = z.infer<typeof authoringDraftSchema>;

export const workflowDraftSchema = z
  .object({
    id: z.string().min(1),
    workflowId: z.string().min(1),
    revision: z.number().int().min(1),
    status: z.literal("draft"),
    graph: workflowGraphDefinitionSchema,
    contentHash: z.string().min(1),
    updatedAt: z.string().datetime(),
    updatedBy: z.string().min(1),
  })
  .strict();
export type WorkflowDraftDto = z.infer<typeof workflowDraftSchema>;

export const teamDraftSchema = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    revision: z.number().int().min(1),
    status: z.literal("draft"),
    members: z.array(teamMemberSchema),
    contentHash: z.string().min(1),
    updatedAt: z.string().datetime(),
    updatedBy: z.string().min(1),
  })
  .strict();
export type TeamDraftDto = z.infer<typeof teamDraftSchema>;

export const authoringChangeTargetTypes = ["team", "task", "workflow", "worker"] as const;
export type AuthoringChangeTargetType = (typeof authoringChangeTargetTypes)[number];

export const authoringChangeSetStatuses = [
  "proposed",
  "validating",
  "applying",
  "applied",
  "partially_applied",
  "failed",
  "cancelled",
  "expired",
] as const;
export type AuthoringChangeSetStatus = (typeof authoringChangeSetStatuses)[number];

export const authoringChangeSetStepStatuses = [
  "pending",
  "applying",
  "applied",
  "failed",
  "cancelled",
  "expired",
] as const;
export type AuthoringChangeSetStepStatus = (typeof authoringChangeSetStepStatuses)[number];

const artifactReferenceSchema = z.string().min(1).max(512);
const authoringFailureSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const authoringProposalTargetSchema = z
  .object({
    targetType: z.enum(authoringChangeTargetTypes),
    targetId: z.string().min(1),
    expectedRevision: z.number().int().min(1),
    patchRef: artifactReferenceSchema,
  })
  .strict();
export type AuthoringProposalTargetDto = z.infer<typeof authoringProposalTargetSchema>;

/** Structured Runtime output; it contains references, never raw prompt or secret material. */
export const authoringProposalSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    sourceRunId: z.string().min(1),
    summary: z.string().min(1),
    targets: z.array(authoringProposalTargetSchema).min(1),
  })
  .strict()
  .superRefine((proposal, context) => {
    const targets = new Set<string>();
    for (const [index, target] of proposal.targets.entries()) {
      const key = `${target.targetType}:${target.targetId}`;
      if (targets.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", index],
          message: `duplicate authoring proposal target: ${key}`,
        });
      }
      targets.add(key);
    }
  });
export type AuthoringProposalDto = z.infer<typeof authoringProposalSchema>;

export const authoringChangeSetStepSchema = z
  .object({
    id: z.string().min(1),
    ordinal: z.number().int().min(1),
    targetType: z.enum(authoringChangeTargetTypes),
    targetId: z.string().min(1),
    expectedRevision: z.number().int().min(1),
    status: z.enum(authoringChangeSetStepStatuses),
    patchRef: artifactReferenceSchema,
    resultRevision: z.number().int().min(1).optional(),
    failure: authoringFailureSchema.optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();
export type AuthoringChangeSetStepDto = z.infer<typeof authoringChangeSetStepSchema>;

export const authoringChangeSetSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    sourceRunId: z.string().min(1),
    status: z.enum(authoringChangeSetStatuses),
    proposalRef: artifactReferenceSchema,
    steps: z.array(authoringChangeSetStepSchema).min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    failure: authoringFailureSchema.optional(),
  })
  .strict()
  .superRefine((changeSet, context) => {
    const ordinals = new Set<number>();
    const targets = new Set<string>();
    for (const [index, step] of changeSet.steps.entries()) {
      if (ordinals.has(step.ordinal)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "ordinal"],
          message: `duplicate authoring change-set ordinal: ${step.ordinal}`,
        });
      }
      ordinals.add(step.ordinal);
      const target = `${step.targetType}:${step.targetId}`;
      if (targets.has(target)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index],
          message: `duplicate authoring change-set target: ${target}`,
        });
      }
      targets.add(target);
    }
  });
export type AuthoringChangeSetDto = z.infer<typeof authoringChangeSetSchema>;

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
  if (
    draft.kind === "proposal" &&
    draft.workflow === undefined &&
    draft.team === undefined &&
    draft.worker === undefined
  ) {
    throw new Error("proposal draft needs workflow or team or worker");
  }
  if (draft.kind === "landed") {
    const hasWorkflow = draft.workflowId !== undefined && draft.workflowVersionId !== undefined;
    if (!hasWorkflow && draft.workerDraftId === undefined && draft.teamId === undefined) {
      throw new Error("landed draft needs workflow, workerDraftId, or team");
    }
  }
}

export function parseAuthoringDraft(input: unknown): AuthoringDraftDto {
  const draft = authoringDraftSchema.parse(input);
  assertAuthoringDraftPayload(draft);
  return draft;
}

export function parseWorkflowDraft(input: unknown): WorkflowDraftDto {
  return workflowDraftSchema.parse(input);
}

export function parseTeamDraft(input: unknown): TeamDraftDto {
  return teamDraftSchema.parse(input);
}

export function parseAuthoringProposal(input: unknown): AuthoringProposalDto {
  return authoringProposalSchema.parse(input);
}

export function parseAuthoringChangeSet(input: unknown): AuthoringChangeSetDto {
  return authoringChangeSetSchema.parse(input);
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
