import { describe, expect, it } from "vitest";

import { createStartRunRequest, RuntimeSdkError } from "@workforce/runtime-sdk";

import { CodexRuntimeAdapter, CODEX_ADAPTER_ID } from "./adapter.js";

describe("CodexRuntimeAdapter", () => {
  it("describes every operation blocked by missing public ports as unavailable", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({ found: false, source: "none" }),
    });
    const descriptor = await adapter.describe();
    expect(descriptor.adapter.id).toBe(CODEX_ADAPTER_ID);
    expect(descriptor.runtime.transport).toBe("process");
    const pause = descriptor.capabilities.find((item) => item.name === "lifecycle.pause");
    const resume = descriptor.capabilities.find((item) => item.name === "event.resume");
    const cancel = descriptor.capabilities.find((item) => item.name === "lifecycle.cancel");
    const usage = descriptor.capabilities.find((item) => item.name === "usage.reporting");
    expect(pause?.available).toBe(false);
    expect(resume?.available).toBe(false);
    expect(cancel?.available).toBe(false);
    expect(usage).toMatchObject({ available: false, constraints: { monetaryCost: "unknown" } });
  });

  it("validate is false when the executable is missing", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({ found: false, source: "none" }),
    });
    const result = await adapter.validate({ adapterId: CODEX_ADAPTER_ID });
    expect(result.valid).toBe(false);
    expect(result.checks.some((check) => check.name === "executable" && !check.ok)).toBe(true);
  });

  it("refuses start rather than spawning an untested live exec", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({
        found: true,
        executable: "/usr/bin/codex",
        source: "path",
        version: "0.153.4",
      }),
    });
    await expect(
      adapter.start(createStartRunRequest({ runtime: { adapterId: CODEX_ADAPTER_ID } })),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    await expect(adapter.pause()).rejects.toBeInstanceOf(RuntimeSdkError);
    const result = await adapter.validate({ adapterId: CODEX_ADAPTER_ID });
    expect(result.valid).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "runtime_operations", ok: false }),
    );
  });

  it("fails stream explicitly instead of silently returning an empty stream", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({ found: true, executable: "/usr/bin/codex", source: "path" }),
    });
    const iterator = adapter.stream({ handleId: "hdl_1", runId: "run_1" })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "unsupported_capability" });
  });
});
