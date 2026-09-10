import path from "node:path";

import type { WorkspaceGrant } from "./types.js";

export function normalizeLogicalPath(input: string): string {
  const converted = input.replace(/\\/g, "/");
  let normalized = path.posix.normalize(converted);
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathInsideGrant(root: string, candidate: string): boolean {
  const r = normalizeLogicalPath(root);
  const c = normalizeLogicalPath(candidate);
  if (c === r) {
    return true;
  }
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return c.startsWith(prefix);
}

export function authorizeWorkspacePath(
  grants: readonly WorkspaceGrant[],
  resource: string,
  write: boolean,
): boolean {
  for (const grant of grants) {
    if (write && grant.mode !== "readwrite") {
      continue;
    }
    if (pathInsideGrant(grant.root, resource) || resource === grant.workspaceId) {
      return true;
    }
  }
  return false;
}
