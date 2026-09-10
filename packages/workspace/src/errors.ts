export class WorkspaceError extends Error {
  override readonly name: string = "WorkspaceError";

  constructor(message: string, options?: { cause?: unknown }) {
    if (options && "cause" in options && options.cause !== undefined) {
      super(message, { cause: options.cause });
    } else {
      super(message);
    }
  }
}
