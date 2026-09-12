import { z } from "zod";

import { acceptanceCriterionSchema, expectedOutputSchema } from "./expected-output.js";

export const taskDependencyWaitFor = ["outputs_ready", "completed"] as const;

export const taskDependencySchema = z
  .object({
    taskId: z.string().min(1),
    waitFor: z.enum(taskDependencyWaitFor),
  })
  .strict();

export type TaskDependency = z.infer<typeof taskDependencySchema>;

const taskInputIntegritySchema = z
  .object({
    algorithm: z.literal("sha256"),
    value: z.string().min(1),
  })
  .strict();

const taskInputBaseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    required: z.boolean(),
    mediaType: z.string().min(1).optional(),
    integrity: taskInputIntegritySchema.optional(),
  })
  .strict();

const requiredTaskInputValueSchema = z.unknown().refine((value) => value !== undefined, {
  message: "input value is required",
});

const artifactTaskInputSchema = taskInputBaseSchema
  .extend({
    type: z.literal("artifact"),
    artifactId: z.string().min(1),
    version: z.number().int().min(1),
  })
  .strict();

const workspaceTaskInputSchema = taskInputBaseSchema
  .extend({
    type: z.literal("workspace"),
    workspaceId: z.string().min(1),
    selector: z
      .object({
        kind: z.literal("git"),
        ref: z.string().min(1),
        path: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const dataTaskInputSchema = taskInputBaseSchema
  .extend({
    type: z.literal("data"),
    value: requiredTaskInputValueSchema,
  })
  .strict();

const externalResourceTaskInputSchema = taskInputBaseSchema
  .extend({
    type: z.literal("external_resource"),
    uri: z.string().url(),
    credentialRef: z.string().min(1).optional(),
  })
  .strict();

const inlineTaskInputSchema = taskInputBaseSchema
  .extend({
    type: z.literal("inline"),
    value: requiredTaskInputValueSchema,
  })
  .strict();

export const taskInputSchema = z.discriminatedUnion("type", [
  artifactTaskInputSchema,
  workspaceTaskInputSchema,
  dataTaskInputSchema,
  externalResourceTaskInputSchema,
  inlineTaskInputSchema,
]);

export type TaskInput = z.infer<typeof taskInputSchema>;

const taskContextSchema = z
  .object({
    include: z.array(
      z
        .object({
          scope: z.string().min(1),
          selector: z.string().min(1),
        })
        .strict(),
    ),
    exclude: z.array(z.string().min(1)).optional(),
    maxBytes: z.number().int().positive(),
    freshness: z.enum(["latest_at_run_start"]).optional(),
  })
  .strict();

const requiredCapabilitySchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1).optional(),
    scope: z.string().min(1).optional(),
    features: z.array(z.string().min(1)).optional(),
    platforms: z.array(z.string().min(1)).optional(),
  })
  .strict();

const createTaskDependencySchema = z
  .object({
    taskId: z.string().min(1),
    condition: z.enum(["outputs_ready", "completed", "failed", "cancelled", "any_terminal"]),
    requiredArtifacts: z.array(z.string().min(1)).optional(),
  })
  .strict();

const taskAssignmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("unassigned") }).strict(),
  z.object({ mode: z.literal("worker"), workerVersionId: z.string().min(1) }).strict(),
  z.object({ mode: z.literal("role"), roleId: z.string().min(1) }).strict(),
  z.object({ mode: z.literal("dynamic"), strategy: z.string().min(1) }).strict(),
]);

const taskExecutionPolicySchema = z
  .object({
    timeoutSeconds: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    retry: z
      .object({
        strategy: z.enum(["exponential"]),
        initialDelaySeconds: z.number().int().nonnegative(),
        maxDelaySeconds: z.number().int().nonnegative(),
        retryableErrors: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
    concurrencyKey: z.string().min(1).optional(),
    approval: z
      .object({
        beforeStart: z.boolean(),
        beforeActions: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
    onCancel: z.string().min(1).optional(),
  })
  .strict();

const taskBudgetSchema = z
  .object({
    currency: z.string().min(1).optional(),
    maxCost: z.number().nonnegative().optional(),
    maxInputTokens: z.number().int().nonnegative().optional(),
    maxOutputTokens: z.number().int().nonnegative().optional(),
    maxRuntimeSeconds: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().nonnegative().optional(),
    onLimit: z.enum(["stop", "pause", "request_approval"]).optional(),
  })
  .strict();

const createTaskAcceptanceCriterionSchema = acceptanceCriterionSchema
  .extend({
    description: z.string().min(1).optional(),
    required: z.boolean().optional(),
    reviewerRole: z.string().min(1).optional(),
  })
  .strict();

/** Request body for POST /projects/{projectId}/tasks. */
export const createTaskInputSchema = z
  .object({
    protocol: z.literal("workforce.task").optional(),
    protocolVersion: z.literal("0.1").optional(),
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1),
    instructions: z.string().optional(),
    priority: z.number().int().min(0).max(100).optional(),
    inputs: z.array(taskInputSchema).optional(),
    context: taskContextSchema.optional(),
    requiredCapabilities: z.array(requiredCapabilitySchema).optional(),
    expectedOutputs: z.array(expectedOutputSchema).optional(),
    acceptanceCriteria: z.array(createTaskAcceptanceCriterionSchema).optional(),
    constraints: z.record(z.unknown()).optional(),
    dependencies: z.array(createTaskDependencySchema).optional(),
    assignment: taskAssignmentSchema.optional(),
    executionPolicy: taskExecutionPolicySchema.optional(),
    budget: taskBudgetSchema.optional(),
    labels: z.array(z.string().min(1)).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const taskDtoSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string(),
    objective: z.string(),
    status: z.string(),
    stateRevision: z.number().int(),
    definitionRevision: z.number().int(),
    generation: z.number().int(),
    attempt: z.number().int(),
    protocolVersion: z.literal("0.1"),
    cancelRequested: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    role: z.string().optional(),
    workflowNodeId: z.string().optional(),
    dependsOn: z.array(taskDependencySchema),
  })
  .strict();

export type TaskDto = z.infer<typeof taskDtoSchema>;

export function parseTaskDto(input: unknown): TaskDto {
  return taskDtoSchema.parse(input);
}

export function parseTaskDependsOn(input: unknown): TaskDependency[] {
  return z.array(taskDependencySchema).parse(input);
}

export function parseCreateTaskInput(input: unknown): CreateTaskInput {
  return createTaskInputSchema.parse(input);
}
