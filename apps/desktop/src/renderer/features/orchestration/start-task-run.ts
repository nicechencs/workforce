import {
  ProblemError,
  assertSafePath,
  isProblemDetails,
  type CommandOptions,
  type ProblemDetails,
} from "@workforce/desktop-client";
import { parseStartTaskRunInput } from "@workforce/protocol";

import { getPreloadApi } from "../../app/renderer-client.js";
import {
  DIRECT_TASK_REQUIRED,
  DIRECT_UNSUPPORTED,
  TASK_RUN_NOT_WIRED,
  type OrchestrationProbe,
} from "./model.js";

/** Frozen HTTP resource. Do not invent `/runs/{id}:direct`. */
export function taskRunsPath(taskId: string): string {
  return assertSafePath(`/api/v1/tasks/${taskId}/runs`);
}

export interface StartTaskRunClient {
  startTaskRun?: (
    taskId: string,
    options: CommandOptions,
    input: { operationId: string; orchestrationMode: "direct" },
  ) => Promise<unknown>;
}

export interface StartDirectTaskRunArgs {
  client: unknown;
  taskId: string;
  options: CommandOptions;
  probe: OrchestrationProbe;
}

/**
 * POST /tasks/{id}/runs with orchestrationMode=direct.
 *
 * Prefers a typed `startTaskRun` method when T10 has landed on the client.
 * Otherwise uses the same preload request path DesktopClient already uses.
 * A 404 is a failure, not a completed direct start.
 */
export async function startDirectTaskRun(args: StartDirectTaskRunArgs): Promise<unknown> {
  if (!args.probe.direct) {
    throw problem("unsupported_capability", DIRECT_UNSUPPORTED, 403, "");
  }
  const taskId = args.taskId.trim();
  if (taskId.length === 0) {
    throw problem("validation_failed", DIRECT_TASK_REQUIRED, 400, "");
  }
  const operationId = args.options.operationId;
  if (operationId === undefined || operationId.length === 0) {
    throw problem("validation_failed", "direct 启动缺少 operationId。", 400, "");
  }
  const body = parseStartTaskRunInput({
    operationId,
    orchestrationMode: "direct",
  });
  if (body.orchestrationMode !== "direct") {
    throw problem("unsupported_capability", DIRECT_UNSUPPORTED, 403, "");
  }
  const typed = args.client as StartTaskRunClient;
  if (typeof typed.startTaskRun === "function") {
    return typed.startTaskRun(taskId, args.options, {
      operationId: body.operationId,
      orchestrationMode: "direct",
    });
  }
  return postTaskRun(taskId, args.options, {
    operationId: body.operationId,
    orchestrationMode: "direct",
  });
}

async function postTaskRun(
  taskId: string,
  options: CommandOptions,
  input: { operationId: string; orchestrationMode: "direct" },
): Promise<unknown> {
  const path = taskRunsPath(taskId);
  const api = getPreloadApi();
  if (!api) {
    throw problem("unsupported_capability", TASK_RUN_NOT_WIRED, 503, path);
  }
  const headers: Record<string, string> = {
    "idempotency-key": options.idempotencyKey,
  };
  if (options.ifMatch !== undefined) {
    headers["if-match"] = `"${options.ifMatch}"`;
  }
  const res = await api.api.request({
    method: "POST",
    path,
    headers,
    body: input,
  });
  if (!res.ok || res.status >= 400) {
    throw problemFromResponse(path, res);
  }
  return res.body;
}

function problemFromResponse(
  path: string,
  res:
    | { ok: true; status: number; body: unknown }
    | { ok: false; status: number; code: string; message: string },
): ProblemError {
  if (res.ok) {
    if (isProblemDetails(res.body)) {
      return new ProblemError(res.body, res.status);
    }
    return problem("request_failed", httpFailureDetail(res.status), res.status, path);
  }
  return problem(res.code, httpFailureDetail(res.status, res.message, res.code), res.status, path);
}

function httpFailureDetail(status: number, message?: string, code?: string): string {
  if (status === 404) {
    return "POST /tasks/{id}/runs 返回 404。这不是 direct 启动成功，也不是 M8 完成。T10 路由未实现时必须诚实失败。";
  }
  if (message && message.length > 0) {
    return message;
  }
  if (code && code.length > 0) {
    return `POST /tasks/{id}/runs 失败（${code}）。`;
  }
  return `POST /tasks/{id}/runs 失败（HTTP ${status}）。`;
}

function problem(code: string, detail: string, status: number, instance: string): ProblemError {
  const payload: ProblemDetails = {
    type: `urn:workforce:error:${code}`,
    title: code,
    status,
    code,
    detail,
    instance,
    requestId: "",
    retryable: status >= 500,
  };
  return new ProblemError(payload, status);
}
