const COMMAND_PATH =
  /^(\/api\/v1\/(?:projects|tasks|runs|approvals)\/[^/?]+):([a-z][a-z0-9-]*)(\?.*)?$/;
const NESTED_COMMAND_PATH =
  /^(\/api\/v1\/(?:workflows|teams)\/[^/?]+\/versions\/[^/?]+):([a-z][a-z0-9-]*)(\?.*)?$/;

/** Map public `/{id}:action` URLs onto Fastify-safe `/{id}/_cmd/action` routes. */
export function rewriteCommandPath(url: string): string {
  const nested = NESTED_COMMAND_PATH.exec(url);
  if (nested) {
    return `${nested[1]}/_cmd/${nested[2]}${nested[3] ?? ""}`;
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
