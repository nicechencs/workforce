import { chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { OsProcessController, UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS } from "@workforce/process";
import { createStartRunRequest } from "@workforce/runtime-sdk";

import { CodexRuntimeAdapter, CODEX_ADAPTER_ID } from "./adapter.js";

const fixture = fileURLToPath(new URL("../fixtures/jsonl-double.mjs", import.meta.url));
const capturedUnsupported = (UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS as readonly string[]).includes(
  process.platform,
);
const liveSuite = capturedUnsupported ? describe.skip : describe;

function startRequest() {
  return createStartRunRequest({ runtime: { adapterId: CODEX_ADAPTER_ID } });
}

liveSuite("Codex captured Process wiring (fixture executable, not live Codex CLI)", () => {
  beforeAll(async () => {
    await chmod(fixture, 0o755);
  });

  it("starts, streams, and inspects through OsProcessController", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({ found: true, executable: fixture, source: "configured" }),
      process: new OsProcessController(),
      resolveStart: () => ({
        cwd: path.dirname(fixture),
        prompt: "fixture-prompt",
        sandbox: "read-only",
        approval: "never",
      }),
    });
    const handle = await adapter.start(startRequest());
    expect(handle.process?.pid).toBeGreaterThan(0);
    const types: string[] = [];
    for await (const event of adapter.stream(handle)) {
      types.push(event.type);
    }
    expect(types).toEqual([
      "runtime.started",
      "runtime.message",
      "runtime.usage.updated",
      "runtime.completed",
    ]);
    await expect(adapter.inspect(handle)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("cancels a hanging fixture through Process", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({ found: true, executable: fixture, source: "configured" }),
      process: new OsProcessController(),
      resolveStart: () => ({
        cwd: path.dirname(fixture),
        prompt: "fixture-prompt",
        sandbox: "read-only",
        approval: "never",
        environment: { CODEX_FIXTURE_SLEEP_MS: "60000" },
      }),
    });
    const handle = await adapter.start(startRequest());
    const streaming = (async () => {
      const types: string[] = [];
      for await (const event of adapter.stream(handle)) {
        types.push(event.type);
      }
      return types;
    })();
    await expect(adapter.cancel(handle)).resolves.toMatchObject({ accepted: true });
    const types = await streaming;
    expect(types.at(-1)).toBe("runtime.cancelled");
    await expect(adapter.inspect(handle)).resolves.toMatchObject({ status: "cancelled" });
  }, 10_000);
});

describe("live Codex CLI", () => {
  it("is absent or left untested on this machine", () => {
    const pathValue = process.env.PATH ?? "";
    const looksPresent = pathValue.split(path.delimiter).some((dir) => dir.includes("codex"));
    if (!looksPresent) {
      expect(process.env.CODEX_LIVE_EXEC).toBeUndefined();
    }
    expect(process.env.CODEX_LIVE_EXEC ?? "").not.toBe("1");
  });
});
