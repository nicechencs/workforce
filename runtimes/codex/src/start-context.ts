import type { StartRunRequest } from "@workforce/protocol";

import type { CodexApprovalMode, CodexSandboxMode } from "./command.js";

/**
 * Host/composition-resolved inputs. Public `StartRunRequest` stays unchanged;
 * the Adapter must not interpret `snapshotRef` or `workspaceInstanceId`.
 */
export interface CodexResolvedStartContext {
  cwd: string;
  prompt: string;
  sandbox: CodexSandboxMode;
  approval: CodexApprovalMode;
  environment?: Record<string, string>;
}

export type ResolveCodexStartContext = (
  request: StartRunRequest,
) => CodexResolvedStartContext | undefined | Promise<CodexResolvedStartContext | undefined>;

const SANDBOX_MODES = new Set<CodexSandboxMode>(["read-only", "workspace-write"]);
const APPROVAL_MODES = new Set<CodexApprovalMode>(["never", "on-request"]);

export function parseCodexResolvedStartContext(
  value: CodexResolvedStartContext | undefined,
): CodexResolvedStartContext | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value.cwd !== "string" || value.cwd.trim().length === 0 || value.cwd.includes("\0")) {
    return undefined;
  }
  if (typeof value.prompt !== "string" || value.prompt.length === 0) {
    return undefined;
  }
  if (!SANDBOX_MODES.has(value.sandbox) || !APPROVAL_MODES.has(value.approval)) {
    return undefined;
  }
  if (value.environment !== undefined) {
    if (typeof value.environment !== "object" || value.environment === null) {
      return undefined;
    }
    for (const [key, envValue] of Object.entries(value.environment)) {
      if (key.length === 0 || key.includes("=") || key.includes("\0")) {
        return undefined;
      }
      if (typeof envValue !== "string" || envValue.includes("\0")) {
        return undefined;
      }
    }
  }
  return {
    cwd: value.cwd,
    prompt: value.prompt,
    sandbox: value.sandbox,
    approval: value.approval,
    ...(value.environment ? { environment: { ...value.environment } } : {}),
  };
}
