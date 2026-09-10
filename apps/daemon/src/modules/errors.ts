import type { ProtocolErrorCode } from "@workforce/protocol";

export class AppError extends Error {
  override readonly name = "AppError";

  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    readonly details: { currentRevision?: number; fields?: unknown[] } = {},
  ) {
    super(message);
  }
}
