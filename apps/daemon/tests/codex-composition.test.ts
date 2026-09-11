import { describe, expect, it } from "vitest";

import { CODEX_ADAPTER_ID } from "@workforce/runtime-codex";
import { createStartRunRequest } from "@workforce/runtime-sdk";

import { createComposedCodexRuntime } from "../src/composition/codex.js";

describe("createComposedCodexRuntime", () => {
  it("injects Process and still refuses start without resolveStart", async () => {
    const adapter = createComposedCodexRuntime({
      detect: () => ({
        found: true,
        executable: "/opt/codex",
        source: "path",
        version: "0.154.0",
      }),
      platform: "linux",
    });
    const result = await adapter.validate({ adapterId: CODEX_ADAPTER_ID });
    expect(result.valid).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "process_port", ok: true }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "start_context", ok: false }),
    );
    await expect(
      adapter.start(createStartRunRequest({ runtime: { adapterId: CODEX_ADAPTER_ID } })),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      message: expect.stringContaining("resolveStart"),
    });
  });

  it("refuses start when the CLI is not detected even if resolveStart is present", async () => {
    const adapter = createComposedCodexRuntime({
      detect: () => ({ found: false, source: "none" }),
      resolveStart: () => ({
        cwd: "/managed/run",
        prompt: "do not spawn",
        sandbox: "read-only",
        approval: "never",
      }),
      platform: "linux",
    });
    await expect(
      adapter.start(createStartRunRequest({ runtime: { adapterId: CODEX_ADAPTER_ID } })),
    ).rejects.toMatchObject({
      code: "validation_failed",
      message: expect.stringContaining("not detected"),
    });
  });
});
