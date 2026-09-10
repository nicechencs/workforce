import type { ProblemDetails } from "./types.js";

export class ProblemError extends Error {
  override readonly name = "ProblemError";

  constructor(
    readonly problem: ProblemDetails,
    readonly status: number,
  ) {
    super(problem.detail);
  }
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    typeof record.title === "string" &&
    typeof record.status === "number" &&
    typeof record.code === "string" &&
    typeof record.detail === "string"
  );
}
