import type { ApiMethod, ApiRequest } from "@workforce/ui";

const ID = "[-A-Za-z0-9_:.]+";

/**
 * Renderer IPC 只放行 Daemon 当前已注册的 handler。
 * 契约里有、Daemon 尚未实现的路径见 {@link UNIMPLEMENTED_API_ROUTE_TEMPLATES}，不得编进本表。
 */
export const API_ROUTE_TEMPLATES: readonly { method: ApiMethod; path: string }[] = [
  { method: "GET", path: "/health" },
  { method: "GET", path: "/ready" },
  { method: "GET", path: "/version" },
  { method: "GET", path: "/capabilities" },
  { method: "GET", path: "/api/v1/capabilities" },
  { method: "GET", path: "/api/v1/operations/{operationId}" },
  { method: "POST", path: "/api/v1/projects" },
  { method: "GET", path: "/api/v1/projects" },
  { method: "GET", path: "/api/v1/projects/{id}" },
  { method: "GET", path: "/api/v1/projects/{id}/progress" },
  { method: "PATCH", path: "/api/v1/projects/{id}" },
  { method: "POST", path: "/api/v1/projects/{id}:start-planning" },
  { method: "POST", path: "/api/v1/projects/{id}:confirm-plan" },
  { method: "POST", path: "/api/v1/projects/{id}:start" },
  { method: "POST", path: "/api/v1/projects/{id}:cancel" },
  { method: "POST", path: "/api/v1/projects/{id}:export" },
  { method: "POST", path: "/api/v1/projects/{id}/workspaces" },
  { method: "POST", path: "/api/v1/projects/{id}/tasks" },
  { method: "GET", path: "/api/v1/tasks" },
  { method: "GET", path: "/api/v1/tasks/{id}" },
  { method: "POST", path: "/api/v1/tasks/{id}:cancel" },
  { method: "POST", path: "/api/v1/tasks/{id}:retry" },
  { method: "POST", path: "/api/v1/tasks/{id}/runs" },
  { method: "GET", path: "/api/v1/runs" },
  { method: "GET", path: "/api/v1/runs/{id}" },
  { method: "POST", path: "/api/v1/runs/{id}:cancel" },
  { method: "POST", path: "/api/v1/runs/{id}:pause" },
  { method: "POST", path: "/api/v1/runs/{id}:input" },
  { method: "GET", path: "/api/v1/runs/{id}/events" },
  { method: "POST", path: "/api/v1/projects/{id}/authoring-sessions" },
  { method: "GET", path: "/api/v1/authoring-sessions" },
  { method: "GET", path: "/api/v1/authoring-sessions/{id}" },
  { method: "GET", path: "/api/v1/authoring-sessions/{sessionId}/turns/{turnId}" },
  { method: "GET", path: "/api/v1/authoring-sessions/{sessionId}/proposals/{proposalId}" },
  { method: "POST", path: "/api/v1/authoring-sessions/{id}/messages" },
  { method: "POST", path: "/api/v1/authoring-sessions/{sessionId}/turns/{turnId}/_cmd/confirm" },
  { method: "POST", path: "/api/v1/authoring-sessions/{sessionId}/turns/{turnId}/_cmd/cancel" },
  { method: "POST", path: "/api/v1/authoring-sessions/{sessionId}/turns/{turnId}/_cmd/retry" },
  { method: "POST", path: "/api/v1/authoring-sessions/{sessionId}/turns/{turnId}/_cmd/close" },
  { method: "POST", path: "/api/v1/chat-intents:classify" },
  { method: "GET", path: "/api/v1/approvals" },
  { method: "GET", path: "/api/v1/approvals/{id}" },
  { method: "POST", path: "/api/v1/approvals/{id}:approve" },
  { method: "POST", path: "/api/v1/approvals/{id}:reject" },
  { method: "POST", path: "/api/v1/approvals/{id}:request-changes" },
  { method: "GET", path: "/api/v1/artifacts" },
  { method: "GET", path: "/api/v1/artifacts/{id}" },
  { method: "GET", path: "/api/v1/artifacts/{id}/versions/{versionId}" },
  { method: "GET", path: "/api/v1/artifacts/{id}/versions/{versionId}/content" },
  { method: "GET", path: "/api/v1/artifacts/{id}/versions/{versionId}/lineage" },
  { method: "GET", path: "/api/v1/events" },
  { method: "GET", path: "/api/v1/events/stream" },
  { method: "GET", path: "/api/v1/runtimes" },
  { method: "GET", path: "/api/v1/runtimes/{id}" },
  { method: "GET", path: "/api/v1/runtimes/{id}/capabilities" },
  { method: "GET", path: "/api/v1/nodes" },
  { method: "GET", path: "/api/v1/nodes/{id}" },
  { method: "GET", path: "/api/v1/teams" },
  { method: "GET", path: "/api/v1/teams/{id}" },
  { method: "GET", path: "/api/v1/teams/{id}/versions/{versionId}" },
  { method: "POST", path: "/api/v1/teams" },
  { method: "PATCH", path: "/api/v1/teams/{id}" },
  { method: "POST", path: "/api/v1/teams/{id}/versions" },
  { method: "PATCH", path: "/api/v1/teams/{id}/versions/{versionId}" },
  { method: "POST", path: "/api/v1/teams/{id}/versions/{versionId}:publish" },
  { method: "GET", path: "/api/v1/workers" },
  { method: "GET", path: "/api/v1/workers/{id}" },
  { method: "GET", path: "/api/v1/workers/{id}/versions/{versionId}" },
  { method: "GET", path: "/api/v1/workers/{id}/versions/{versionId}/references" },
  { method: "GET", path: "/api/v1/workers/{id}/drafts/{draftId}" },
  { method: "POST", path: "/api/v1/workers" },
  { method: "PATCH", path: "/api/v1/workers/{id}" },
  { method: "POST", path: "/api/v1/workers/{id}/drafts" },
  { method: "PATCH", path: "/api/v1/workers/{id}/drafts/{draftId}" },
  { method: "POST", path: "/api/v1/workers/{id}/drafts/{draftId}:publish" },
  { method: "POST", path: "/api/v1/workers/{id}/versions/{versionId}:archive" },
  { method: "POST", path: "/api/v1/workers/{id}/versions/{versionId}:fork" },
  { method: "GET", path: "/api/v1/workflows" },
  { method: "GET", path: "/api/v1/workflows/{id}" },
  { method: "GET", path: "/api/v1/workflows/{id}/versions/{versionId}" },
  { method: "POST", path: "/api/v1/workflows" },
  { method: "PATCH", path: "/api/v1/workflows/{id}" },
  { method: "POST", path: "/api/v1/workflows/{id}/versions" },
  { method: "PATCH", path: "/api/v1/workflows/{id}/versions/{versionId}" },
  { method: "POST", path: "/api/v1/workflows/{id}/versions/{versionId}:publish" },
  { method: "GET", path: "/api/v1/projects/{id}/budget" },
];

/**
 * 能力矩阵/API 设计里有、当前 Daemon `routes.ts` 无 handler 的路径。
 * 编进 {@link API_ROUTE_TEMPLATES} 会让真窗口 IPC 放行后 404，假装可写。
 * T10/T09 落地对应 handler 后再移入 allowlist。
 */
export const UNIMPLEMENTED_API_ROUTE_TEMPLATES: readonly {
  method: ApiMethod;
  path: string;
  blockedUntil: string;
}[] = [
  { method: "POST", path: "/api/v1/projects/{id}:pause", blockedUntil: "T09-M5" },
  { method: "POST", path: "/api/v1/projects/{id}:resume", blockedUntil: "T09-M5" },
  { method: "PATCH", path: "/api/v1/tasks/{id}", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/tasks/{id}:queue", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/runs/{id}:resume", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/runs/{id}:take-over", blockedUntil: "T09-M5" },
  { method: "GET", path: "/api/v1/runs/{id}/logs", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/approvals/{id}:take-over", blockedUntil: "T09-M5" },
  {
    method: "POST",
    path: "/api/v1/artifacts/{id}/versions/{versionId}:verify",
    blockedUntil: "T10",
  },
  { method: "GET", path: "/api/v1/workspaces/{id}", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/workspaces/{id}:validate", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/workspaces/{id}:provision", blockedUntil: "T10" },
  { method: "GET", path: "/api/v1/workspaces/{id}/changes", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/runtimes/{id}:validate", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/runtimes/{id}:diagnose", blockedUntil: "T10" },
  { method: "POST", path: "/api/v1/projects/{id}/budget:raise", blockedUntil: "T10" },
];

const FORBIDDEN_BODY_KEYS = new Set([
  "absolutePath",
  "executable",
  "command",
  "argv",
  "cwd",
  "shell",
  "filePath",
  "hostPath",
]);

const ALLOWED_RENDERER_HEADERS = new Set(["if-match", "accept", "idempotency-key"]);

function templateToRegex(path: string): RegExp {
  const escaped = path
    .replace(/\{[^}]+\}/g, "§ID§")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/§ID§/g, ID);
  return new RegExp(`^${escaped}$`);
}

const compiled = API_ROUTE_TEMPLATES.map((route) => ({
  method: route.method,
  regex: templateToRegex(route.path),
}));

export function normalizeApiPath(path: string): string | null {
  if (!path.startsWith("/")) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.includes("..") ||
    decoded.includes("//") ||
    decoded.includes("://")
  ) {
    return null;
  }
  const q = decoded.indexOf("?");
  return q === -1 ? decoded : decoded.slice(0, q);
}

export function isAllowedApiRequest(input: { method: string; path: string }): boolean {
  if (input.method !== "GET" && input.method !== "POST" && input.method !== "PATCH") {
    return false;
  }
  const path = normalizeApiPath(input.path);
  if (!path) {
    return false;
  }
  return compiled.some((route) => route.method === input.method && route.regex.test(path));
}

export function sanitizeRendererHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (ALLOWED_RENDERER_HEADERS.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

function bodyHasForbiddenKeys(value: unknown, depth: number): boolean {
  if (depth < 0 || typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      return true;
    }
    if (bodyHasForbiddenKeys((value as Record<string, unknown>)[key], depth - 1)) {
      return true;
    }
  }
  return false;
}

export function assertSafeApiRequest(request: ApiRequest): ApiRequest {
  if (!isAllowedApiRequest(request)) {
    throw new Error(
      `API request is not on the Desktop allowlist: ${request.method} ${request.path}`,
    );
  }
  if (bodyHasForbiddenKeys(request.body, 2)) {
    throw new Error("API request body includes forbidden host path or command fields");
  }
  const pathname = normalizeApiPath(request.path);
  if (!pathname) {
    throw new Error("API path is invalid");
  }
  const queryIndex = request.path.indexOf("?");
  const path = queryIndex === -1 ? pathname : `${pathname}${request.path.slice(queryIndex)}`;
  const headers = sanitizeRendererHeaders(request.headers);
  const safe: ApiRequest = { method: request.method, path };
  if (Object.keys(headers).length > 0) {
    safe.headers = headers;
  }
  if (request.body !== undefined) {
    safe.body = request.body;
  }
  return safe;
}
