const COMMAND_PATH =
  /^(\/api\/v1\/(?:projects|tasks|runs|approvals)\/[^/?]+):([a-z][a-z0-9-]*)(\?.*)?$/;

/** Map public `/{id}:action` URLs onto Fastify-safe `/{id}/_cmd/action` routes. */
export function rewriteCommandPath(url: string): string {
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
