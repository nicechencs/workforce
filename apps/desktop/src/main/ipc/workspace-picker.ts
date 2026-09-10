import path from "node:path";

import type { WorkspaceGrant, WorkspacePickResult } from "@workforce/ui";

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
