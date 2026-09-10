import {
  ProblemError,
  type CommandAcceptedDto,
  type CommandOptions,
  type ProblemDetails,
} from "@workforce/desktop-client";

export function newId(prefix: string): string {
  const bytes = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  return `${prefix}_${bytes}`;
}

export function commandOptions(ifMatch?: number): CommandOptions {
  const options: CommandOptions = {
    idempotencyKey: newId("idem"),
    operationId: newId("op"),
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

export function isProblemError(error: unknown): error is ProblemError {
  return error instanceof ProblemError;
}

export function isRevisionConflict(error: unknown): boolean {
  return (
    isProblemError(error) && (error.status === 412 || error.problem.code === "revision_conflict")
  );
}

export function errorMessage(error: unknown): string {
  if (isProblemError(error)) {
    return error.problem.detail || error.problem.title;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败";
}

export function revisionConflictMessage(): string {
  return "版本冲突（412 revision_conflict）。已保留你的输入，请刷新后再提交。";
}

export function isCommandAccepted(value: unknown): value is CommandAcceptedDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.operationId === "string" &&
    typeof record.acceptedAt === "string" &&
    typeof record.resource === "object" &&
    record.resource !== null
  );
}

export function problemFrom(
  partial: Partial<ProblemDetails> & Pick<ProblemDetails, "code">,
): ProblemError {
  const status = partial.status ?? 400;
  return new ProblemError(
    {
      type: partial.type ?? `urn:workforce:error:${partial.code}`,
      title: partial.title ?? partial.code,
      status,
      code: partial.code,
      detail: partial.detail ?? partial.title ?? partial.code,
      instance: partial.instance ?? "",
      requestId: partial.requestId ?? "",
      retryable: partial.retryable ?? false,
    },
    status,
  );
}
