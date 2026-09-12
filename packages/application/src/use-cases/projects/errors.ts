import type { ProtocolError, ProtocolErrorCode } from "@workforce/protocol";

export class UseCaseError extends Error implements ProtocolError {
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    options?: { retryable?: boolean; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "UseCaseError";
    this.retryable = options?.retryable ?? false;
    if (options?.details) {
      this.details = options.details;
    }
  }
}

export function notFound(entity: string, id: string): UseCaseError {
  return new UseCaseError("not_found", `${entity} ${id} not found`, { details: { id } });
}

export function revisionConflict(id: string, expected: number, actual: number): UseCaseError {
  return new UseCaseError("revision_conflict", `${id} revision mismatch`, {
    details: { expected, actual },
  });
}

export function validationFailed(message: string, details?: Record<string, unknown>): UseCaseError {
  return new UseCaseError("validation_failed", message, details ? { details } : undefined);
}

export function invalidTransition(
  message: string,
  details?: Record<string, unknown>,
): UseCaseError {
  return new UseCaseError("invalid_transition", message, details ? { details } : undefined);
}
