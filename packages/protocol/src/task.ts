import { z } from "zod";

export const taskDependencyWaitFor = ["outputs_ready", "completed"] as const;

export const taskDependencySchema = z
  .object({
    taskId: z.string().min(1),
    waitFor: z.enum(taskDependencyWaitFor),
  })
  .strict();

export type TaskDependency = z.infer<typeof taskDependencySchema>;

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
