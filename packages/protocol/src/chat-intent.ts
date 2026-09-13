import { z } from "zod";

import { runDtoSchema } from "./dto.js";
import { taskDtoSchema } from "./task.js";

/**
 * Global Chat language-entry contracts. Classification is not completion.
 * There is no IM message store, no worker inbox, and no workerId peer.
 * Create intents still land through Project-scoped AuthoringSession.
 * discuss_work writes through the already frozen `POST /runs/{id}:input`.
 * "去做" / direct has no new URL; this batch only admits honest unsupported.
 */

export const chatIntentKinds = [
  "create_worker",
  "create_workflow",
  "query_progress",
  "discuss_work",
] as const;
export type ChatIntentKind = (typeof chatIntentKinds)[number];

/** Frozen empty copy. Progress must not invent a completed status. */
export const PROJECT_PROGRESS_NO_RECORDS_MESSAGE = "还没有记录" as const;

/** Existing command for in-flight discuss_work. Not a chat-room path. */
export const DISCUSS_WORK_RUN_INPUT_PATH = "POST /runs/{id}:input" as const;

export const CHAT_FORBIDDEN_PATHS = ["/workers/{id}/messages", "/chat/inbox"] as const;

const chatIdSchema = z.string().trim().min(1).max(256);

export const createWorkerChatIntentSchema = z
  .object({
    kind: z.literal("create_worker"),
    projectId: chatIdSchema.optional(),
    workerDraftId: chatIdSchema.optional(),
    summary: z.string().trim().min(1).optional(),
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

export const chatIntentSchema = z.discriminatedUnion("kind", [
  createWorkerChatIntentSchema,
  createWorkflowChatIntentSchema,
  queryProgressChatIntentSchema,
  discussWorkChatIntentSchema,
]);

export type ChatIntentDto = z.infer<typeof chatIntentSchema>;

export const chatClassifyInputSchema = z
  .object({
    text: z.string().trim().min(1),
    projectId: chatIdSchema.optional(),
    runId: chatIdSchema.optional(),
  })
  .strict();

export type ChatClassifyInput = z.infer<typeof chatClassifyInputSchema>;

export const chatClassifyIntentResultSchema = z
  .object({
    outcome: z.literal("intent"),
    intent: chatIntentSchema,
  })
  .strict();

export const chatClassifyNeedContextResultSchema = z
  .object({
    outcome: z.literal("need_context"),
    missing: z.enum(["projectId", "runId"]),
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
  return chatClassifyResultDtoSchema.parse(input);
}

export function parseProjectProgressProjection(input: unknown): ProjectProgressProjectionDto {
  return projectProgressProjectionDtoSchema.parse(input);
}

export function discussWorkRunInputPath(runId: string): `POST /runs/${string}:input` {
  return `POST /runs/${runId}:input`;
}
