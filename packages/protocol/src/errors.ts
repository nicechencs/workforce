export const PROTOCOL_ERROR_CODES = [
  "validation_failed",
  "unauthenticated",
  "forbidden",
  "not_found",
  "idempotency_key_reused",
  "conflict",
  "event_cursor_expired",
  "revision_conflict",
  "invalid_transition",
  "unsupported_capability",
  "unknown_cost_not_enforceable",
  "accepted",
] as const;

export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export function protocolError(
  code: ProtocolErrorCode,
  message: string,
  options?: { retryable?: boolean; details?: Record<string, unknown> },
): ProtocolError {
  return {
    code,
    message,
    retryable: options?.retryable ?? false,
    ...(options?.details ? { details: options.details } : {}),
  };
}
