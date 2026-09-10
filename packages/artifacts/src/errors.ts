export type ArtifactErrorCode =
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_SCHEMA_INVALID"
  | "ARTIFACT_INTEGRITY_MISMATCH"
  | "ARTIFACT_QUARANTINED"
  | "ARTIFACT_VERSION_REQUIRED"
  | "ARTIFACT_KIND_UNSUPPORTED"
  | "ARTIFACT_NOT_AVAILABLE"
  | "ARTIFACT_LINEAGE_CYCLE"
  | "ARTIFACT_STAGING_MISSING"
  | "ARTIFACT_IMMUTABLE"
  | "ARTIFACT_ACCESS_DENIED"
  | "ARTIFACT_TEST_PORTS_REQUIRED";

export class ArtifactError extends Error {
  override readonly name = "ArtifactError";
  readonly code: ArtifactErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ArtifactErrorCode,
    message: string,
    options?: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown },
  ) {
    if (options && "cause" in options && options.cause !== undefined) {
      super(message, { cause: options.cause });
    } else {
      super(message);
    }
    this.code = code;
    this.retryable = options?.retryable ?? false;
    if (options?.details) {
      this.details = options.details;
    }
  }
}

export function isArtifactError(error: unknown): error is ArtifactError {
  return error instanceof ArtifactError;
}
