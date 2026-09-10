import { z } from "zod";

export const eventActorSchema = z
  .object({
    type: z.enum(["user", "worker", "runtime", "service", "system"]),
    id: z.string().min(1),
    workerVersionId: z.string().optional(),
    adapterVersion: z.string().optional(),
  })
  .strict();

export const workforceEventSchema = z
  .object({
    specVersion: z.literal("0.1"),
    id: z.string().min(1),
    type: z.string().regex(/^[a-z][a-z0-9_.]*[a-z0-9]$/),
    source: z.string().min(1),
    subject: z
      .object({
        type: z.string().min(1),
        id: z.string().min(1),
      })
      .strict(),
    time: z.string().datetime(),
    recordedAt: z.string().datetime(),
    organizationId: z.string().optional(),
    projectId: z.string().optional(),
    workflowInstanceId: z.string().optional(),
    taskId: z.string().optional(),
    runId: z.string().optional(),
    actor: eventActorSchema,
    sequence: z.number().int().min(1).optional(),
    stream: z.string().min(1),
    ingestionPosition: z.number().int().min(1).optional(),
    correlationId: z.string().min(1),
    causationId: z.string().optional(),
    trace: z
      .object({
        traceId: z.string(),
        spanId: z.string().optional(),
      })
      .strict()
      .optional(),
    dataContentType: z.literal("application/json"),
    dataSchema: z.string().min(1),
    data: z.record(z.unknown()),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    redaction: z.record(z.unknown()).optional(),
    extensions: z.record(z.unknown()).optional(),
  })
  .strict();

export type WorkforceEvent = z.infer<typeof workforceEventSchema>;
export type EventActor = z.infer<typeof eventActorSchema>;

export function parseWorkforceEvent(input: unknown): WorkforceEvent {
  return workforceEventSchema.parse(input);
}

export interface SseCursor {
  ingestionPosition: number;
  filterDigest: string;
}

export function encodeSseCursor(cursor: SseCursor): string {
  return `${cursor.ingestionPosition}:${encodeURIComponent(cursor.filterDigest)}`;
}

export function decodeSseCursor(raw: string): SseCursor {
  const separator = raw.indexOf(":");
  if (separator <= 0) {
    throw new Error("invalid SSE cursor");
  }
  const ingestionPosition = Number(raw.slice(0, separator));
  const filterDigest = decodeURIComponent(raw.slice(separator + 1));
  const schema = z
    .object({
      ingestionPosition: z.number().int().min(1),
      filterDigest: z.string().min(1),
    })
    .strict();
  return schema.parse({ ingestionPosition, filterDigest });
}
