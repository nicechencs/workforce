export interface ContentVersion {
  definitionRevision: number;
  generation: number;
}

export interface ConcurrencyVersion {
  stateRevision: number;
}

export interface TaskAttempt extends ContentVersion {
  attempt: number;
}

export function startIdempotencyKey(input: {
  taskId: string;
  definitionRevision: number;
  generation: number;
  attempt: number;
}): string {
  return `start:${input.taskId}:definitionRevision:${input.definitionRevision}:generation:${input.generation}:attempt:${input.attempt}`;
}
