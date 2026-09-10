import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createDesktopClient, ProblemError } from "@workforce/desktop-client";

import { createIpcTransport } from "../src/renderer/app/ipc-transport.js";

describe("IPC transport mapping", () => {
  it("maps DesktopClient calls onto window.workforce.api.request", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const transport = createIpcTransport(async (req) => {
      calls.push({ method: req.method, path: req.path });
      return {
        ok: true,
        status: 200,
        body: { items: [], page: { nextCursor: null, hasMore: false } },
      };
    });
    const client = createDesktopClient({ transport });
    await client.listProjects();
    expect(calls).toEqual([{ method: "GET", path: "/api/v1/projects" }]);
  });

  it("maps failed IPC responses onto ProblemError", async () => {
    const transport = createIpcTransport(async () => ({
      ok: false,
      status: 412,
      code: "revision_conflict",
      message: "If-Match failed",
    }));
    const client = createDesktopClient({ transport });
    await expect(client.getProject("prj_1")).rejects.toBeInstanceOf(ProblemError);
  });

  it("does not import createLoopbackTransport from the renderer", () => {
    const src = fs.readFileSync(
      fileURLToPath(new URL("../src/renderer/app/ipc-transport.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/createLoopbackTransport/);
    expect(src).not.toMatch(/sessionToken/);
  });
});
