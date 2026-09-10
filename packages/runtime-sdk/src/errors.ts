export const RUNTIME_SDK_ERROR_CODES = [
  "validation_failed",
  "unsupported_capability",
  "unsupported_protocol",
  "idempotency_key_reused",
  "conflict",
  "not_found",
  "resource_exhausted",
  "lease_expired",
  "handle_identity_mismatch",
  "event_cursor_expired",
] as const;

export type RuntimeSdkErrorCode = (typeof RUNTIME_SDK_ERROR_CODES)[number];

export class RuntimeSdkError extends Error {
  readonly code: RuntimeSdkErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: RuntimeSdkErrorCode,
    message: string,
    options?: { retryable?: boolean; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "RuntimeSdkError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    if (options?.details) {
      this.details = options.details;
    }
  }
}

export function isRuntimeSdkError(error: unknown): error is RuntimeSdkError {
  return error instanceof RuntimeSdkError;
}
