import type { EventListQuery, ListQuery } from "./types.js";

const SECRET_QUERY =
  /(?:^|[?&])(token|access_token|session|session_token|authorization|secret|password)=/i;

export function assertSafePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("API path must be root-relative");
  }
  if (path.includes("://") || path.includes("//") || path.includes("..")) {
    throw new Error("API path must not contain a host or traversal");
  }
  if (SECRET_QUERY.test(path)) {
    throw new Error("Secrets must not be placed in the URL");
  }
  return path;
}

function search(query: Record<string, string | number | undefined | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) {
        params.set(key, value.join(","));
      }
      continue;
    }
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

function listSearch(query: ListQuery | undefined): string {
  if (!query) {
    return "";
  }
  return search({
    limit: query.limit,
    cursor: query.cursor,
    projectId: query.projectId,
    taskId: query.taskId,
    runId: query.runId,
    status: query.status,
  });
}

export const paths = {
  health: () => "/health",
  ready: () => "/ready",
  version: () => "/version",
  capabilities: () => "/api/v1/capabilities",
  operation: (id: string) => `/api/v1/operations/${id}`,
  projects: (query?: ListQuery) => `/api/v1/projects${listSearch(query)}`,
  project: (id: string) => `/api/v1/projects/${id}`,
  projectStartPlanning: (id: string) => `/api/v1/projects/${id}:start-planning`,
  projectConfirmPlan: (id: string) => `/api/v1/projects/${id}:confirm-plan`,
  projectStart: (id: string) => `/api/v1/projects/${id}:start`,
  projectCancel: (id: string) => `/api/v1/projects/${id}:cancel`,
  projectExport: (id: string) => `/api/v1/projects/${id}:export`,
  projectBudget: (id: string) => `/api/v1/projects/${id}/budget`,
  projectWorkspaces: (id: string) => `/api/v1/projects/${id}/workspaces`,
  teams: (query?: ListQuery) => `/api/v1/teams${listSearch(query)}`,
  team: (id: string) => `/api/v1/teams/${id}`,
  nodes: (query?: ListQuery) => `/api/v1/nodes${listSearch(query)}`,
  node: (id: string) => `/api/v1/nodes/${id}`,
  runtimes: (query?: ListQuery) => `/api/v1/runtimes${listSearch(query)}`,
  runtime: (id: string) => `/api/v1/runtimes/${id}`,
  runtimeCapabilities: (id: string) => `/api/v1/runtimes/${id}/capabilities`,
  tasks: (query?: ListQuery) => `/api/v1/tasks${listSearch(query)}`,
  task: (id: string) => `/api/v1/tasks/${id}`,
  taskRetry: (id: string) => `/api/v1/tasks/${id}:retry`,
  taskCancel: (id: string) => `/api/v1/tasks/${id}:cancel`,
  runs: (query?: ListQuery) => `/api/v1/runs${listSearch(query)}`,
  run: (id: string) => `/api/v1/runs/${id}`,
  runCancel: (id: string) => `/api/v1/runs/${id}:cancel`,
  runInput: (id: string) => `/api/v1/runs/${id}:input`,
  runEvents: (id: string, query?: ListQuery) => `/api/v1/runs/${id}/events${listSearch(query)}`,
  approvals: (query?: ListQuery) => `/api/v1/approvals${listSearch(query)}`,
  approval: (id: string) => `/api/v1/approvals/${id}`,
  approvalApprove: (id: string) => `/api/v1/approvals/${id}:approve`,
  approvalReject: (id: string) => `/api/v1/approvals/${id}:reject`,
  approvalRequestChanges: (id: string) => `/api/v1/approvals/${id}:request-changes`,
  artifacts: (query?: ListQuery) => `/api/v1/artifacts${listSearch(query)}`,
  artifact: (id: string) => `/api/v1/artifacts/${id}`,
  artifactVersion: (id: string, versionId: string) =>
    `/api/v1/artifacts/${id}/versions/${versionId}`,
  artifactVersionContent: (id: string, versionId: string) =>
    `/api/v1/artifacts/${id}/versions/${versionId}/content`,
  artifactVersionLineage: (id: string, versionId: string) =>
    `/api/v1/artifacts/${id}/versions/${versionId}/lineage`,
  events: (query?: EventListQuery) =>
    `/api/v1/events${search({
      limit: query?.limit,
      after: query?.after,
      projectId: query?.projectId,
      runId: query?.runId,
      types: query?.types,
    })}`,
  eventsStream: (query?: EventListQuery) =>
    `/api/v1/events/stream${search({
      limit: query?.limit,
      projectId: query?.projectId,
      runId: query?.runId,
      types: query?.types,
      cursor: query?.cursor,
    })}`,
  session: () => "/api/v1/session",
} as const;
