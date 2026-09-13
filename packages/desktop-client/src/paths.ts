import type {
  AuthoringSessionListQuery,
  EventListQuery,
  ListQuery,
  ListWorkersInput,
} from "./types.js";

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

function search(query: Record<string, string | number | boolean | undefined | string[]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value === "boolean") {
      params.set(key, value ? "true" : "false");
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
  projectProgress: (id: string) => `/api/v1/projects/${id}/progress`,
  workers: (query?: ListWorkersInput) =>
    `/api/v1/workers${search({
      q: query?.q,
      status: query?.status,
      includeArchived: query?.includeArchived,
      cursor: query?.cursor,
      limit: query?.limit,
    })}`,
  worker: (id: string) => `/api/v1/workers/${id}`,
  workerVersion: (id: string, versionId: string) => `/api/v1/workers/${id}/versions/${versionId}`,
  workerVersionReferences: (id: string, versionId: string) =>
    `/api/v1/workers/${id}/versions/${versionId}/references`,
  workerDrafts: (id: string) => `/api/v1/workers/${id}/drafts`,
  workerDraft: (id: string, draftId: string) => `/api/v1/workers/${id}/drafts/${draftId}`,
  workerDraftPublish: (id: string, draftId: string) =>
    `/api/v1/workers/${id}/drafts/${draftId}:publish`,
  workerVersionArchive: (id: string, versionId: string) =>
    `/api/v1/workers/${id}/versions/${versionId}:archive`,
  workerVersionFork: (id: string, versionId: string) =>
    `/api/v1/workers/${id}/versions/${versionId}:fork`,
  chatIntentsClassify: () => "/api/v1/chat-intents:classify",
  teams: (query?: ListQuery) => `/api/v1/teams${listSearch(query)}`,
  team: (id: string) => `/api/v1/teams/${id}`,
  teamVersions: (id: string) => `/api/v1/teams/${id}/versions`,
  teamVersion: (id: string, versionId: string) => `/api/v1/teams/${id}/versions/${versionId}`,
  teamVersionPublish: (id: string, versionId: string) =>
    `/api/v1/teams/${id}/versions/${versionId}:publish`,
  workflows: (query?: ListQuery) => `/api/v1/workflows${listSearch(query)}`,
  workflow: (id: string) => `/api/v1/workflows/${id}`,
  workflowVersions: (id: string) => `/api/v1/workflows/${id}/versions`,
  workflowVersion: (id: string, versionId: string) =>
    `/api/v1/workflows/${id}/versions/${versionId}`,
  workflowVersionPublish: (id: string, versionId: string) =>
    `/api/v1/workflows/${id}/versions/${versionId}:publish`,
  nodes: (query?: ListQuery) => `/api/v1/nodes${listSearch(query)}`,
  node: (id: string) => `/api/v1/nodes/${id}`,
  runtimes: (query?: ListQuery) => `/api/v1/runtimes${listSearch(query)}`,
  runtime: (id: string) => `/api/v1/runtimes/${id}`,
  runtimeCapabilities: (id: string) => `/api/v1/runtimes/${id}/capabilities`,
  tasks: (query?: ListQuery) => `/api/v1/tasks${listSearch(query)}`,
  task: (id: string) => `/api/v1/tasks/${id}`,
  taskRetry: (id: string) => `/api/v1/tasks/${id}:retry`,
  taskCancel: (id: string) => `/api/v1/tasks/${id}:cancel`,
  taskRuns: (id: string) => `/api/v1/tasks/${id}/runs`,
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
  authoringSessions: (query?: AuthoringSessionListQuery) =>
    `/api/v1/authoring-sessions${search({
      projectId: query?.projectId,
      cursor: query?.cursor,
      limit: query?.limit,
    })}`,
  authoringSessionCreate: (projectId: string) => `/api/v1/projects/${projectId}/authoring-sessions`,
  authoringSession: (sessionId: string) => `/api/v1/authoring-sessions/${sessionId}`,
  authoringSessionMessages: (sessionId: string) =>
    `/api/v1/authoring-sessions/${sessionId}/messages`,
  authoringTurn: (sessionId: string, turnId: string) =>
    `/api/v1/authoring-sessions/${sessionId}/turns/${turnId}`,
  authoringTurnCommand: (
    sessionId: string,
    turnId: string,
    action: "confirm" | "cancel" | "retry" | "close",
  ) => `/api/v1/authoring-sessions/${sessionId}/turns/${turnId}/_cmd/${action}`,
  authoringProposal: (sessionId: string, proposalId: string) =>
    `/api/v1/authoring-sessions/${sessionId}/proposals/${proposalId}`,
} as const;
