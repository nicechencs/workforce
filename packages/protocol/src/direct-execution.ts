import { z } from "zod";

import { placementIntentSchema } from "./execution.js";

/**
 * D18 direct execution command.
 *
 * This is the Application command boundary for starting an ad-hoc Task in a
 * Project.  The HTTP resource remains the canonical
 * `POST /tasks/{taskId}/runs`; `direct` is a command mode, not a second URL
 * hierarchy.  The server resolves the Run identity and all execution axes
 * after policy, capability, workspace and placement admission.
 *
 * Chat `start_direct` uses this same body after a Task exists.  It does not
 * introduce a parallel Run payload.  When Chat has no `taskId`, Application
 * `createAdHocTask` (`POST /projects/{id}/tasks`) runs first, then this
 * command.  `StartRunRequest` does not gain `orchestrationMode`.
 *
 * `projectId` is intentionally carried beside `taskId`.  The Application must
 * verify that the Task belongs to this Project before creating a Run; a caller
 * cannot use a Task id from another Project and rely on a path-only lookup.
 * Runtime-owned fields (`runId`, generation, attempt, placement snapshot,
 * transport and execution snapshot) are not accepted from the client.
 */
const directExecutionIdSchema = z.string().trim().min(1).max(256);
const directExecutionRevisionSchema = z.number().int().min(1);

export const startDirectTaskRunInputSchema = z
  .object({
    operationId: directExecutionIdSchema,
    idempotencyKey: directExecutionIdSchema,
    projectId: directExecutionIdSchema,
    taskId: directExecutionIdSchema,
    expectedTaskStateRevision: directExecutionRevisionSchema.optional(),
    orchestrationMode: z.literal("direct"),
    placementIntent: placementIntentSchema.optional(),
    /** Direct execution has no project execution snapshot. */
    executionSnapshotId: z.never().optional(),
    /** Direct execution never targets an existing WorkflowInstance. */
    workflowInstanceId: z.never().optional(),
  })
  .strict();

export type StartDirectTaskRunInput = z.infer<typeof startDirectTaskRunInputSchema>;

export function parseStartDirectTaskRunInput(input: unknown): StartDirectTaskRunInput {
  return startDirectTaskRunInputSchema.parse(input);
}

/**
 * Reference-only result returned by the direct start command.
 *
 * The response deliberately contains both Project and Task scope together
 * with the newly allocated Run.  It does not claim that the Run completed,
 * and it has no WorkflowInstance/Project transition fields.  The caller must
 * read the Run resource/events for progress and outcomes.
 */
export const startDirectTaskRunAcceptedSchema = z
  .object({
    projectId: directExecutionIdSchema,
    taskId: directExecutionIdSchema,
    runId: directExecutionIdSchema,
    orchestrationMode: z.literal("direct"),
    /** A direct command cannot return a workflow execution reference. */
    executionSnapshotId: z.never().optional(),
    workflowInstanceId: z.never().optional(),
  })
  .strict();

export type StartDirectTaskRunAccepted = z.infer<typeof startDirectTaskRunAcceptedSchema>;

export function parseStartDirectTaskRunAccepted(input: unknown): StartDirectTaskRunAccepted {
  return startDirectTaskRunAcceptedSchema.parse(input);
}
