import { z } from "zod";

export const expectedOutputKinds = [
  "code",
  "data",
  "document",
  "evaluation",
  "plan",
  "log",
  "other",
] as const;

export const expectedOutputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    kind: z.enum(expectedOutputKinds),
    required: z.boolean(),
    cardinality: z
      .object({
        min: z.number().int().min(0).optional(),
        max: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    mediaTypes: z.array(z.string()).optional(),
    schema: z.record(z.unknown()).optional(),
  })
  .strict();

export type ExpectedOutput = z.infer<typeof expectedOutputSchema>;

export const acceptanceCriterionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["rule", "test", "schema", "review", "composite"]),
    commandRef: z.string().optional(),
    schemaRef: z.string().optional(),
  })
  .strict();

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
