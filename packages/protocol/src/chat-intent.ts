import { z } from "zod";

import { runDtoSchema } from "./dto.js";
import { taskDtoSchema } from "./task.js";
import { workerCardFieldNameSchema } from "./worker.js";

/**
 * Global Chat language-entry contracts. Classification is not completion.
 * There is no IM message store, no worker inbox, and no workerId peer.
 * Create worker lands on `POST /workers` (projectId optional). Create
 * workflow stays Project-scoped AuthoringSession. invite_team lands on
 * existing Team member writes with a published workerVersionId.
 * Idle remarks reuse draft PATCH + fork; they are not IM and not a new Task/Run.
 * discuss_work writes through the already frozen `POST /runs/{id}:input`.
 * Unrecognized utterances are `need_clarification`, never default `discuss_work`.
 * "去做" / direct has no new URL; this batch only admits honest unsupported.
 */

export const chatIntentKinds = [
  "create_worker",
  "create_workflow",
  "query_progress",
  "discuss_work",
  "update_worker",
  "invite_team",
] as const;
export type ChatIntentKind = (typeof chatIntentKinds)[number];

/** Frozen empty copy. Progress must not invent a completed status. */
export const PROJECT_PROGRESS_NO_RECORDS_MESSAGE = "还没有记录" as const;

/** Existing command for in-flight discuss_work. Not a chat-room path. */
export const DISCUSS_WORK_RUN_INPUT_PATH = "POST /runs/{id}:input" as const;

/** Create-role Chat intent lands on the library, not AuthoringSession. */
export const CREATE_WORKER_CHAT_PATH = "POST /workers" as const;

/** Idle card writes reuse draft CAS. Not `/remarks` and not IM. */
export const IDLE_WORKER_REMARK_DRAFT_PATH = "PATCH /workers/{id}/drafts/{draftId}" as const;

/** Published + immutable card writes must fork first. */
export const IDLE_WORKER_REMARK_FORK_PATH = "POST /workers/{id}/versions/{versionId}:fork" as const;

export const CHAT_FORBIDDEN_PATHS = [
  "/workers/{id}/messages",
  "/chat/inbox",
  "/workers/{id}/remarks",
] as const;

/** Unrecognized sentences classify as this outcome. Never `discuss_work`. */
export const UNRECOGNIZED_CHAT_OUTCOME = "need_clarification" as const;

export const chatNeedContextMissing = ["projectId", "runId", "workerId"] as const;
export type ChatNeedContextMissing = (typeof chatNeedContextMissing)[number];

const chatIdSchema = z.string().trim().min(1).max(256);

export const createWorkerChatIntentSchema = z
  .object({
    kind: z.literal("create_worker"),
    projectId: chatIdSchema.optional(),
    workerDraftId: chatIdSchema.optional(),
    summary: z.string().trim().min(1).optional(),
    who: z.string().optional(),
    how: z.string().optional(),
    skills: z.string().optional(),
  })
  .strict();

export const createWorkflowChatIntentSchema = z
  .object({
    kind: z.literal("create_workflow"),
    projectId: chatIdSchema,
    workflowDraftId: chatIdSchema.optional(),
    summary: z.string().trim().min(1).optional(),
  })
  .strict();

export const queryProgressChatIntentSchema = z
  .object({
    kind: z.literal("query_progress"),
    projectId: chatIdSchema,
  })
  .strict();

export const discussWorkChatIntentSchema = z
  .object({
    kind: z.literal("discuss_work"),
    projectId: chatIdSchema,
    runId: chatIdSchema.optional(),
  })
  .strict();

/**
 * Idle talk that writes one printable card slot. Lands on draft PATCH or
 * fork + PATCH. Never a Task/Run and never an IM thread.
 */
export const updateWorkerChatIntentSchema = z
  .object({
    kind: z.literal("update_worker"),
    workerId: chatIdSchema,
    workerDraftId: chatIdSchema.optional(),
    workerVersionId: chatIdSchema.optional(),
    cardField: workerCardFieldNameSchema,
    text: z.string().trim().min(1).optional(),
  })
  .strict();

/**
 * Invite a published WorkerVersion onto a Project Team. No new HTTP path:
 * existing Team member write with workerVersionId.
 */
export const inviteTeamChatIntentSchema = z
  .object({
    kind: z.literal("invite_team"),
    projectId: chatIdSchema,
    workerVersionId: chatIdSchema,
    summary: z.string().trim().min(1).optional(),
  })
  .strict();

export const chatIntentSchema = z.discriminatedUnion("kind", [
  createWorkerChatIntentSchema,
  createWorkflowChatIntentSchema,
  queryProgressChatIntentSchema,
  discussWorkChatIntentSchema,
  updateWorkerChatIntentSchema,
  inviteTeamChatIntentSchema,
]);

export type ChatIntentDto = z.infer<typeof chatIntentSchema>;
export const chatIntentDtoSchema = chatIntentSchema;
export type UpdateWorkerChatIntentDto = z.infer<typeof updateWorkerChatIntentSchema>;
export type InviteTeamChatIntentDto = z.infer<typeof inviteTeamChatIntentSchema>;

export const chatClassifyInputSchema = z
  .object({
    text: z.string().trim().min(1),
    projectId: chatIdSchema.optional(),
    runId: chatIdSchema.optional(),
    workerId: chatIdSchema.optional(),
    workerDraftId: chatIdSchema.optional(),
    workerVersionId: chatIdSchema.optional(),
  })
  .strict();

export type ChatClassifyInput = z.infer<typeof chatClassifyInputSchema>;

export const chatClassifyIntentResultSchema = z
  .object({
    outcome: z.literal("intent"),
    intent: chatIntentSchema,
    /**
     * Multi-intent utterances list every intent in order. When present, the
     * first element must equal `intent`. Single-intent sentences omit this.
     * Equality is enforced in `parseChatClassifyResult` so this object stays
     * a ZodObject member of the classify-result union.
     */
    intents: z.array(chatIntentSchema).min(1).optional(),
  })
  .strict();

export const chatClassifyNeedContextResultSchema = z
  .object({
    outcome: z.literal("need_context"),
    missing: z.enum(chatNeedContextMissing),
  })
  .strict();

export const chatClassifyNeedClarificationResultSchema = z
  .object({
    outcome: z.literal("need_clarification"),
    question: z.string().trim().min(1),
  })
  .strict();

export const chatClassifyUnsupportedResultSchema = z
  .object({
    outcome: z.literal("unsupported"),
    code: z.literal("unsupported_capability"),
    action: z.enum(["direct", "im"]),
  })
  .strict();

export const chatClassifyResultDtoSchema = z.discriminatedUnion("outcome", [
  chatClassifyIntentResultSchema,
  chatClassifyNeedContextResultSchema,
  chatClassifyNeedClarificationResultSchema,
  chatClassifyUnsupportedResultSchema,
]);

export type ChatClassifyResultDto = z.infer<typeof chatClassifyResultDtoSchema>;

const projectProgressTaskSchema = taskDtoSchema.pick({
  id: true,
  title: true,
  status: true,
  updatedAt: true,
});

const projectProgressRunSchema = runDtoSchema.pick({
  id: true,
  taskId: true,
  status: true,
  updatedAt: true,
});

const projectProgressEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    time: z.string().datetime(),
    taskId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .strict();

const projectProgressArtifactSchema = z
  .object({
    id: z.string().min(1),
    versionId: z.string().min(1),
    status: z.string().min(1).optional(),
  })
  .strict();

export const projectProgressProjectionDtoSchema = z
  .object({
    projectId: chatIdSchema,
    generatedAt: z.string().datetime(),
    empty: z.boolean(),
    emptyDisplay: z.literal(PROJECT_PROGRESS_NO_RECORDS_MESSAGE).optional(),
    tasks: z.array(projectProgressTaskSchema),
    runs: z.array(projectProgressRunSchema),
    events: z.array(projectProgressEventSchema),
    artifacts: z.array(projectProgressArtifactSchema),
  })
  .strict()
  .superRefine((projection, context) => {
    const hasRecords =
      projection.tasks.length > 0 ||
      projection.runs.length > 0 ||
      projection.events.length > 0 ||
      projection.artifacts.length > 0;
    if (projection.empty === hasRecords) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["empty"],
        message: "empty must be true only when Task/Run/Event/Artifact arrays are all empty",
      });
    }
    if (projection.empty && projection.emptyDisplay !== PROJECT_PROGRESS_NO_RECORDS_MESSAGE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["emptyDisplay"],
        message: `empty progress must use ${PROJECT_PROGRESS_NO_RECORDS_MESSAGE}`,
      });
    }
    if (!projection.empty && projection.emptyDisplay !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["emptyDisplay"],
        message: "non-empty progress must not include emptyDisplay",
      });
    }
  });

export type ProjectProgressProjectionDto = z.infer<typeof projectProgressProjectionDtoSchema>;

export function parseChatIntent(input: unknown): ChatIntentDto {
  return chatIntentSchema.parse(input);
}

export function parseChatClassifyInput(input: unknown): ChatClassifyInput {
  return chatClassifyInputSchema.parse(input);
}

export function parseChatClassifyResult(input: unknown): ChatClassifyResultDto {
  const parsed = chatClassifyResultDtoSchema.parse(input);
  if (parsed.outcome === "intent" && parsed.intents !== undefined) {
    if (JSON.stringify(parsed.intents[0]) !== JSON.stringify(parsed.intent)) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ["intents", 0],
          message: "intents[0] must equal intent",
        },
      ]);
    }
  }
  return parsed;
}

export function parseProjectProgressProjection(input: unknown): ProjectProgressProjectionDto {
  return projectProgressProjectionDtoSchema.parse(input);
}

export function discussWorkRunInputPath(runId: string): `POST /runs/${string}:input` {
  return `POST /runs/${runId}:input`;
}
