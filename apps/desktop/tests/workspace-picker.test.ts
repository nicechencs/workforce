import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { assertSafeApiRequest } from "../src/main/ipc/allowlist.js";
import { pickWorkspaceDirectory, unknownWorkspaceGrantResponse, WorkspaceGrantStore } from "../src/main/ipc/workspace-picker.js";

describe("workspace picker", () => {
  it("returns an opaque grant instead of the absolute path", async () => {
    const store = new WorkspaceGrantStore();
    const selected = path.join(os.tmpdir(), "workforce-workspace");
    const result = await pickWorkspaceDirectory({ pick: async () => selected }, store);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.grant.authorizationId.startsWith("wsauth_")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(selected);
    expect(store.resolve(result.grant.authorizationId)).toBe(path.resolve(selected));
  });

  it("rejects workspace POSTs whose authorizationRef was not issued here", () => {
    const store = new WorkspaceGrantStore();
    const denied = unknownWorkspaceGrantResponse(
      {
        method: "POST",
        path: "/api/v1/projects/prj_1/workspaces",
        body: { authorizationRef: "wsauth_forged" },
      },
      store,
    );
    expect(denied).toEqual({
      ok: false,
      status: 403,
      code: "WORKSPACE_GRANT_UNKNOWN",
      message: "Workspace authorization is unknown to this Desktop session",
    });
  });

  it("lets a picker-issued grant through without leaking the host path", async () => {
    const store = new WorkspaceGrantStore();
    const selected = path.join(os.tmpdir(), "workforce-workspace");
    const picked = await pickWorkspaceDirectory({ pick: async () => selected }, store);
    expect(picked.ok).toBe(true);
    if (!picked.ok) {
      return;
    }
    expect(
      unknownWorkspaceGrantResponse(
        {
          method: "POST",
          path: "/api/v1/projects/prj_1/workspaces",
          body: { authorizationRef: picked.grant.authorizationId },
        },
        store,
      ),
    ).toBeNull();
  });

  it("rejects renderer API bodies that smuggle host paths or commands", () => {
    expect(() =>
      assertSafeApiRequest({
        method: "POST",
        path: "/api/v1/projects",
        body: { absolutePath: "C\\\\repo" },
      }),
    ).toThrow(/forbidden/);
    expect(() =>
      assertSafeApiRequest({
        method: "POST",
        path: "/api/v1/projects",
        body: { command: "git status" },
      }),
    ).toThrow(/forbidden/);
  });
});
