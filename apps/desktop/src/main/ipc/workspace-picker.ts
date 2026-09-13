import path from "node:path";

import type { ApiRequest, ApiResponse, WorkspaceGrant, WorkspacePickResult } from "@workforce/ui";

export interface DirectoryDialog {
  pick(): Promise<string | null>;
}

export class WorkspaceGrantStore {
  readonly #grants = new Map<string, string>();

  issue(absolutePath: string): WorkspaceGrant {
    const resolved = path.resolve(absolutePath);
    const displayLabel = path.basename(resolved);
    if (
      !displayLabel ||
      displayLabel.includes("/") ||
      displayLabel.includes("\\") ||
      displayLabel.includes(":")
    ) {
      throw new Error("Workspace display label must not include a host path");
    }
    const authorizationId = `wsauth_${crypto.randomUUID()}`;
    this.#grants.set(authorizationId, resolved);
    return { authorizationId, displayLabel };
  }

  resolve(authorizationId: string): string | undefined {
    return this.#grants.get(authorizationId);
  }

  has(authorizationId: string): boolean {
    return this.#grants.has(authorizationId);
  }
}

const PROJECT_WORKSPACE_POST = /^\/api\/v1\/projects\/[^/]+\/workspaces$/;

/**
 * Renderer 只能提交本窗口 picker 发出的 opaque grant。
 * 未知 authorizationRef fail-closed。绝对路径仍留在 Main，不代填进 Daemon body。
 */
export function unknownWorkspaceGrantResponse(
  request: ApiRequest,
  grants: WorkspaceGrantStore,
): ApiResponse | null {
  if (request.method !== "POST" || !PROJECT_WORKSPACE_POST.test(request.path)) {
    return null;
  }
  const body = request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const ref = (body as { authorizationRef?: unknown }).authorizationRef;
  if (typeof ref !== "string" || ref.length === 0) {
    return null;
  }
  if (grants.has(ref)) {
    return null;
  }
  return {
    ok: false,
    status: 403,
    code: "WORKSPACE_GRANT_UNKNOWN",
    message: "Workspace authorization is unknown to this Desktop session",
  };
}

export async function pickWorkspaceDirectory(
  dialog: DirectoryDialog,
  store: WorkspaceGrantStore,
): Promise<WorkspacePickResult> {
  const selected = await dialog.pick();
  if (!selected) {
    return { ok: false, reason: "cancelled" };
  }
  return { ok: true, grant: store.issue(selected) };
}
