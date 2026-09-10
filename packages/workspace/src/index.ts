export const packageName = "@workforce/workspace" as const;

export { WorkspaceError } from "./errors.js";
export { GitCommandError } from "./git.js";
export { GitWorkspaceService, RandomUuidIdGenerator } from "./git-workspace-service.js";
export type { GitWorkspaceServiceOptions } from "./git-workspace-service.js";
export {
  UNTESTED_WORKSPACE_PLATFORMS,
  assertPathInside,
  isInside,
  normalizePath,
} from "./path-policy.js";
