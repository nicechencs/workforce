import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProtocolErrorCode } from "@workforce/protocol";

import { AppError } from "../modules/errors.js";

export const ERROR_STATUS: Record<ProtocolErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_key_reused: 409,
  conflict: 409,
  event_cursor_expired: 410,
  revision_conflict: 412,
  invalid_transition: 422,
  unsupported_capability: 422,
  unknown_cost_not_enforceable: 422,
  accepted: 202,
};

const TITLES: Record<ProtocolErrorCode, string> = {
  validation_failed: "Validation failed",
  unauthenticated: "Unauthenticated",
  forbidden: "Forbidden",
  not_found: "Not found",
  idempotency_key_reused: "Idempotency key reused",
  conflict: "Conflict",
  event_cursor_expired: "Event cursor expired",
  revision_conflict: "Revision conflict",
  invalid_transition: "Invalid state transition",
  unsupported_capability: "Unsupported capability",
  unknown_cost_not_enforceable: "Unknown cost is not enforceable",
  accepted: "Accepted",
};

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ProtocolErrorCode;
  detail: string;
  instance: string;
  requestId: string;
  retryable: boolean;
  fields?: unknown[];
  currentRevision?: number;
}

export function problemFromCode(
  code: ProtocolErrorCode,
  detail: string,
  request: FastifyRequest,
  extras: { currentRevision?: number; fields?: unknown[]; retryable?: boolean } = {},
): ProblemBody {
  const status = ERROR_STATUS[code];
  const body: ProblemBody = {
    type: `urn:workforce:error:${code}`,
    title: TITLES[code],
    status,
    code,
    detail,
    instance: request.url.split("?")[0] ?? request.url,
    requestId: request.id,
    retryable: extras.retryable ?? false,
  };
  if (extras.fields !== undefined) {
    body.fields = extras.fields;
  }
  if (extras.currentRevision !== undefined) {
    body.currentRevision = extras.currentRevision;
  }
  return body;
}

export function sendProblem(reply: FastifyReply, body: ProblemBody): void {
  void reply
    .code(body.status)
    .header("content-type", "application/problem+json; charset=utf-8")
    .send(body);
}

export function mapError(error: unknown, request: FastifyRequest): ProblemBody {
  if (error instanceof AppError) {
    const extras: { currentRevision?: number; fields?: unknown[] } = {};
    if (error.details.currentRevision !== undefined) {
      extras.currentRevision = error.details.currentRevision;
    }
    if (error.details.fields !== undefined) {
      extras.fields = error.details.fields;
    }
    return problemFromCode(error.code, error.message, request, extras);
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (code === "event_cursor_expired") {
      return problemFromCode(
        "event_cursor_expired",
        error instanceof Error ? error.message : "SSE cursor expired",
        request,
      );
    }
    if (code === "FST_ERR_CTP_INVALID_JSON_BODY" || code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return problemFromCode("validation_failed", "Request body is not valid JSON", request);
    }
  }
  return problemFromCode(
    "validation_failed",
    error instanceof Error ? error.message : "Unexpected error",
    request,
  );
}
