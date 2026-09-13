const COMMAND_PATH =
  /^(\/api\/v1\/(?:projects|tasks|runs|approvals)\/[^/?]+):([a-z][a-z0-9-]*)(\?.*)?$/;
const NESTED_COMMAND_PATH =
  /^(\/api\/v1\/(?:workflows|teams)\/[^/?]+\/versions\/[^/?]+):([a-z][a-z0-9-]*)(\?.*)?$/;
const WORKER_NESTED_COMMAND_PATH =
  /^(\/api\/v1\/workers\/[^/?]+\/(?:drafts|versions)\/[^/?]+):([a-z][a-z0-9-]*)(\?.*)?$/;
const COLLECTION_COMMAND_PATH = /^(\/api\/v1\/chat-intents):([a-z][a-z0-9-]*)(\?.*)?$/;

/** Map public `/{id}:action` URLs onto Fastify-safe `/{id}/_cmd/action` routes. */
export function rewriteCommandPath(url: string): string {
  const nested = NESTED_COMMAND_PATH.exec(url);
  if (nested) {
    return `${nested[1]}/_cmd/${nested[2]}${nested[3] ?? ""}`;
  }
  const workerNested = WORKER_NESTED_COMMAND_PATH.exec(url);
  if (workerNested) {
    return `${workerNested[1]}/_cmd/${workerNested[2]}${workerNested[3] ?? ""}`;
  }
  const collection = COLLECTION_COMMAND_PATH.exec(url);
  if (collection) {
    return `${collection[1]}/_cmd/${collection[2]}${collection[3] ?? ""}`;
  }
  const match = COMMAND_PATH.exec(url);
  if (!match) {
    return url;
  }
  return `${match[1]}/_cmd/${match[2]}${match[3] ?? ""}`;
}

export function commandRoute(
  resource: "projects" | "tasks" | "runs" | "approvals",
  action: string,
): string {
  return `/api/v1/${resource}/:id/_cmd/${action}`;
}

export function nestedVersionCommandRoute(resource: "workflows" | "teams", action: string): string {
  return `/api/v1/${resource}/:id/versions/:versionId/_cmd/${action}`;
}

export function workerNestedCommandRoute(
  collection: "drafts" | "versions",
  action: string,
): string {
  const idParam = collection === "drafts" ? "draftId" : "versionId";
  return `/api/v1/workers/:id/${collection}/:${idParam}/_cmd/${action}`;
}

export function collectionCommandRoute(resource: "chat-intents", action: string): string {
  return `/api/v1/${resource}/_cmd/${action}`;
}
