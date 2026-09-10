import type { ApiMethod, ApiRequest } from "@workforce/ui";

const ID = "[-A-Za-z0-9_:.]+";

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
  { method: "PATCH", path: "/api/v1/projects/{id}" },
  { method: "POST", path: "/api/v1/projects/{id}:start-planning" },
  { method: "POST", path: "/api/v1/projects/{id}:confirm-plan" },
  { method: "POST", path: "/api/v1/projects/{id}:start" },
  { method: "POST", path: "/api/v1/projects/{id}:pause" },
  { method: "POST", path: "/api/v1/projects/{id}:resume" },
  { method: "POST", path: "/api/v1/projects/{id}:cancel" },
  { method: "POST", path: "/api/v1/projects/{id}:export" },
  { method: "POST", path: "/api/v1/projects/{id}/workspaces" },
  { method: "GET", path: "/api/v1/tasks" },
  { method: "GET", path: "/api/v1/tasks/{id}" },
  { method: "PATCH", path: "/api/v1/tasks/{id}" },
  { method: "POST", path: "/api/v1/tasks/{id}:queue" },
  { method: "POST", path: "/api/v1/tasks/{id}:cancel" },
  { method: "POST", path: "/api/v1/tasks/{id}:retry" },
  { method: "POST", path: "/api/v1/tasks/{id}/runs" },
  { method: "GET", path: "/api/v1/runs" },
  { method: "GET", path: "/api/v1/runs/{id}" },
  { method: "POST", path: "/api/v1/runs/{id}:cancel" },
  { method: "POST", path: "/api/v1/runs/{id}:pause" },
  { method: "POST", path: "/api/v1/runs/{id}:resume" },
  { method: "POST", path: "/api/v1/runs/{id}:input" },
  { method: "POST", path: "/api/v1/runs/{id}:take-over" },
  { method: "GET", path: "/api/v1/runs/{id}/logs" },
  { method: "GET", path: "/api/v1/runs/{id}/events" },
  { method: "GET", path: "/api/v1/approvals" },
  { method: "GET", path: "/api/v1/approvals/{id}" },
  { method: "POST", path: "/api/v1/approvals/{id}:approve" },
  { method: "POST", path: "/api/v1/approvals/{id}:reject" },
  { method: "POST", path: "/api/v1/approvals/{id}:request-changes" },
  { method: "POST", path: "/api/v1/approvals/{id}:take-over" },
  { method: "GET", path: "/api/v1/artifacts" },
  { method: "GET", path: "/api/v1/artifacts/{id}" },
  { method: "GET", path: "/api/v1/artifacts/{id}/versions/{versionId}" },
  { method: "GET", path: "/api/v1/artifacts/{id}/versions/{versionId}/content" },
  { method: "GET", path: "/api/v1/artifacts/{id}/versions/{versionId}/lineage" },
  { method: "POST", path: "/api/v1/artifacts/{id}/versions/{versionId}:verify" },
  { method: "GET", path: "/api/v1/events" },
  { method: "GET", path: "/api/v1/events/stream" },
  { method: "GET", path: "/api/v1/workspaces/{id}" },
  { method: "POST", path: "/api/v1/workspaces/{id}:validate" },
  { method: "POST", path: "/api/v1/workspaces/{id}:provision" },
  { method: "GET", path: "/api/v1/workspaces/{id}/changes" },
  { method: "GET", path: "/api/v1/runtimes" },
  { method: "GET", path: "/api/v1/runtimes/{id}" },
  { method: "GET", path: "/api/v1/runtimes/{id}/capabilities" },
  { method: "POST", path: "/api/v1/runtimes/{id}:validate" },
  { method: "POST", path: "/api/v1/runtimes/{id}:diagnose" },
  { method: "GET", path: "/api/v1/nodes" },
  { method: "GET", path: "/api/v1/nodes/{id}" },
  { method: "GET", path: "/api/v1/teams" },
  { method: "GET", path: "/api/v1/teams/{id}" },
  { method: "GET", path: "/api/v1/projects/{id}/budget" },
  { method: "POST", path: "/api/v1/projects/{id}/budget:raise" },
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
