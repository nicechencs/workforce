import { describe, expect, it } from "vitest";

import type {
  CapturedProcess,
  CapturedSpawnRequest,
  ProcessController,
  ProcessHandle,
  ProcessOutput,
  ProcessStatus,
  SpawnRequest,
} from "@workforce/process";
import { createStartRunRequest, RuntimeSdkError } from "@workforce/runtime-sdk";

import {
  CodexRuntimeAdapter,
  CODEX_ADAPTER_ID,
  createCodexRuntime,
} from "./adapter.js";
import { buildCodexExecArgv } from "./command.js";
import type { CodexResolvedStartContext } from "./start-context.js";

const PROMPT = "Read only the fixture. Reply exactly SAFE_PROBE_OK.";
const CWD = "/managed/run";

const SUCCESS_JSONL = [
  '{"type":"thread.started","thread_id":"omitted"}',
  '{"type":"turn.started"}',
  '{"type":"turn.completed","usage":{"input_tokens":2,"output_tokens":1}}',
].join("\n");

function detected() {
  return {
    found: true as const,
    executable: "/opt/codex",
    source: "path" as const,
    version: "0.154.0",
  };
}

function context(overrides: Partial<CodexResolvedStartContext> = {}): CodexResolvedStartContext {
  return {
    cwd: CWD,
    prompt: PROMPT,
    sandbox: "read-only",
    approval: "never",
    ...overrides,
  };
}

function startRequest() {
  return createStartRunRequest({ runtime: { adapterId: CODEX_ADAPTER_ID } });
}

class FakeProcessController implements ProcessController {
  readonly spawned: CapturedSpawnRequest[] = [];
  readonly cancelled: ProcessHandle[] = [];
  private nextPid = 7100;
  private readonly byKey = new Map<string, FakeCaptured>();
  constructor(
    private readonly script: (req: CapturedSpawnRequest) => {
      chunks: ProcessOutput[];
      exit?: { exitCode: number | null; signal: string | null };
      hang?: boolean;
    },
  ) {}

  async spawn(_req: SpawnRequest): Promise<ProcessHandle> {
    void _req;
    throw new Error("Codex adapter must use spawnCaptured");
  }

  async spawnCaptured(req: CapturedSpawnRequest): Promise<CapturedProcess> {
    this.spawned.push(req);
    const handle = {
      pid: this.nextPid,
      startIdentity: `fake:${this.nextPid}:2026-09-11T00:00:00.000Z`,
    };
    this.nextPid += 1;
    const planned = this.script(req);
    const captured = new FakeCaptured(handle, planned);
    this.byKey.set(keyOf(handle), captured);
    return captured;
  }

  async cancel(handle: ProcessHandle): Promise<void> {
    this.cancelled.push(handle);
    this.byKey.get(keyOf(handle))?.cancel();
  }

  async inspect(handle: ProcessHandle): Promise<ProcessStatus> {
    const captured = this.byKey.get(keyOf(handle));
    return {
      alive: captured?.alive ?? false,
      startIdentity: handle.startIdentity,
    };
  }
}

class FakeCaptured implements CapturedProcess {
  readonly handle: ProcessHandle;
  readonly output: AsyncIterable<ProcessOutput>;
  alive = true;
  private readonly exitResult: { exitCode: number | null; signal: string | null };
  private readonly hang: boolean;
  private cancelled = false;
  private readonly waiters: Array<() => void> = [];

  constructor(
    handle: ProcessHandle,
    planned: {
      chunks: ProcessOutput[];
      exit?: { exitCode: number | null; signal: string | null };
      hang?: boolean;
    },
  ) {
    this.handle = handle;
    this.exitResult = planned.exit ?? { exitCode: 0, signal: null };
    this.hang = planned.hang === true;
    const chunks = planned.chunks;
    const self = this;
    this.output = {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          if (self.cancelled) {
            return;
          }
          yield chunk;
        }
        if (self.hang) {
          await new Promise<void>((resolve) => {
            self.waiters.push(resolve);
          });
        }
      },
    };
  }

  cancel(): void {
    this.cancelled = true;
    this.alive = false;
    this.exitResult.signal = "SIGKILL";
    this.exitResult.exitCode = null;
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }

  async wait(): Promise<{ exitCode: number | null; signal: string | null }> {
    if (this.hang && !this.cancelled) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.alive = false;
    return this.exitResult;
  }
}

function keyOf(handle: ProcessHandle): string {
  return `${handle.pid}\n${handle.startIdentity}`;
}

function stdout(text: string): ProcessOutput {
  return { source: "stdout", chunk: new TextEncoder().encode(text) };
}

function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  return (async () => {
    const items: unknown[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    return items;
  })();
}

describe("CodexRuntimeAdapter", () => {
  it("describes start/cancel blocked when Process or resolveStart is missing", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
    });
    const descriptor = await adapter.describe();
    expect(descriptor.adapter.id).toBe(CODEX_ADAPTER_ID);
    expect(descriptor.runtime.transport).toBe("process");
    expect(descriptor.capabilities.find((item) => item.name === "lifecycle.start")).toMatchObject({
      available: false,
      constraints: { reason: "captured Process port is not injected", liveExec: "untested" },
    });
    expect(descriptor.capabilities.find((item) => item.name === "lifecycle.pause")?.available).toBe(
      false,
    );
    expect(descriptor.capabilities.find((item) => item.name === "event.resume")?.available).toBe(
      false,
    );
    expect(descriptor.capabilities.find((item) => item.name === "lifecycle.cancel")?.available).toBe(
      false,
    );
    expect(descriptor.capabilities.find((item) => item.name === "usage.reporting")).toMatchObject({
      available: false,
      constraints: { monetaryCost: "unknown" },
    });
  });

  it("validate is false when the executable is missing", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({ found: false, source: "none" }),
      process: new FakeProcessController(() => ({ chunks: [] })),
      resolveStart: () => context(),
    });
    const result = await adapter.validate({ adapterId: CODEX_ADAPTER_ID });
    expect(result.valid).toBe(false);
    expect(result.checks.some((check) => check.name === "executable" && !check.ok)).toBe(true);
  });

  it("refuses start when CLI is detected but Process is not injected", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
    });
    await expect(adapter.start(startRequest())).rejects.toMatchObject({
      code: "unsupported_capability",
      message: expect.stringContaining("captured Process port"),
    });
    const result = await adapter.validate({ adapterId: CODEX_ADAPTER_ID });
    expect(result.valid).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "process_port", ok: false }),
    );
  });

  it("refuses start when Process is injected but resolveStart is missing", async () => {
    const processPort = new FakeProcessController(() => ({ chunks: [] }));
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: processPort,
    });
    await expect(adapter.start(startRequest())).rejects.toMatchObject({
      code: "unsupported_capability",
      message: expect.stringContaining("resolveStart"),
    });
    expect(processPort.spawned).toHaveLength(0);
  });

  it("refuses start with validation_failed when the CLI is missing", async () => {
    const processPort = new FakeProcessController(() => ({ chunks: [] }));
    const adapter = new CodexRuntimeAdapter({
      detect: () => ({ found: false, source: "none" }),
      process: processPort,
      resolveStart: () => context(),
    });
    await expect(adapter.start(startRequest())).rejects.toMatchObject({
      code: "validation_failed",
      message: expect.stringContaining("not detected"),
    });
    expect(processPort.spawned).toHaveLength(0);
  });

  it("refuses incomplete resolved context without spawning", async () => {
    const processPort = new FakeProcessController(() => ({ chunks: [] }));
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: processPort,
      resolveStart: () => ({ ...context(), prompt: "" }),
    });
    await expect(adapter.start(startRequest())).rejects.toMatchObject({
      code: "unsupported_capability",
      message: expect.stringContaining("complete resolved"),
    });
    expect(processPort.spawned).toHaveLength(0);
  });

  it("fails closed on win32 captured Process even when inputs are present", async () => {
    const processPort = new FakeProcessController(() => ({ chunks: [] }));
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: processPort,
      resolveStart: () => context(),
      platform: "win32",
    });
    await expect(adapter.start(startRequest())).rejects.toMatchObject({
      code: "unsupported_capability",
      message: expect.stringContaining("win32"),
    });
    expect(processPort.spawned).toHaveLength(0);
    const result = await adapter.validate({ adapterId: CODEX_ADAPTER_ID });
    expect(result.valid).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "captured_process", ok: false }),
    );
  });

  it("starts, streams JSONL, and inspects through the captured Process port", async () => {
    const processPort = new FakeProcessController(() => ({
      chunks: [stdout(`${SUCCESS_JSONL}\n`)],
    }));
    const adapter = createCodexRuntime({
      detect: () => detected(),
      process: processPort,
      resolveStart: () => context(),
      platform: "linux",
    });
    const valid = await adapter.validate({ adapterId: CODEX_ADAPTER_ID });
    expect(valid.valid).toBe(true);
    const descriptor = await adapter.describe();
    expect(descriptor.capabilities.find((item) => item.name === "lifecycle.start")?.available).toBe(
      true,
    );

    const handle = await adapter.start(startRequest());
    expect(handle.adapterId).toBe(CODEX_ADAPTER_ID);
    expect(handle.process).toEqual({
      pid: 7100,
      startIdentity: "fake:7100:2026-09-11T00:00:00.000Z",
    });
    expect(processPort.spawned).toHaveLength(1);
    expect(processPort.spawned[0]?.argv).toEqual(
      buildCodexExecArgv({
        executable: "/opt/codex",
        cwd: CWD,
        sandbox: "read-only",
        approval: "never",
      }),
    );
    expect(new TextDecoder().decode(processPort.spawned[0]?.stdin)).toBe(PROMPT);
    expect(processPort.spawned[0]?.cwd).toBe(CWD);

    const events = (await collect(adapter.stream(handle))) as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toEqual([
      "runtime.started",
      "runtime.message",
      "runtime.usage.updated",
      "runtime.completed",
    ]);
    expect(JSON.stringify(events)).not.toContain("SAFE_PROBE_OK");
    await expect(adapter.inspect(handle)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("returns the same handle for a repeated operationId without a second spawn", async () => {
    const processPort = new FakeProcessController(() => ({
      chunks: [stdout(`${SUCCESS_JSONL}\n`)],
    }));
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: processPort,
      resolveStart: () => context(),
      platform: "linux",
    });
    const request = startRequest();
    const first = await adapter.start(request);
    const second = await adapter.start(request);
    expect(second).toEqual(first);
    expect(processPort.spawned).toHaveLength(1);
  });

  it("cancels through Process and maps the exit to runtime.cancelled", async () => {
    const processPort = new FakeProcessController(() => ({
      chunks: [stdout('{"type":"thread.started","thread_id":"omitted"}\n')],
      hang: true,
    }));
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: processPort,
      resolveStart: () => context(),
      platform: "linux",
    });
    const handle = await adapter.start(startRequest());
    const streaming = collect(adapter.stream(handle));
    await expect(adapter.cancel(handle)).resolves.toMatchObject({ accepted: true });
    expect(processPort.cancelled).toEqual([handle.process]);
    const events = (await streaming) as Array<{ type: string }>;
    expect(events.at(-1)?.type).toBe("runtime.cancelled");
    await expect(adapter.inspect(handle)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("fails stream with not_found instead of an empty iterator when the handle is unknown", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: new FakeProcessController(() => ({ chunks: [] })),
      resolveStart: () => context(),
      platform: "linux",
    });
    const iterator = adapter.stream({ handleId: "hdl_1", runId: "run_1" })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps stream fail-closed when Process is missing", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
    });
    const iterator = adapter.stream({ handleId: "hdl_1", runId: "run_1" })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({
      code: "unsupported_capability",
      message: expect.stringContaining("captured Process port"),
    });
  });

  it("rejects event cursor resume and mid-run input", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: new FakeProcessController(() => ({ chunks: [] })),
      resolveStart: () => context(),
      platform: "linux",
    });
    await expect(adapter.pause()).rejects.toBeInstanceOf(RuntimeSdkError);
    await expect(
      collect(adapter.stream({ handleId: "hdl_1", runId: "run_1" }, { sourceCursor: "x" })),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    await expect(adapter.sendInput()).rejects.toMatchObject({ code: "unsupported_capability" });
  });

  it("reconcile cannot re-attach a missing in-memory session", async () => {
    const adapter = new CodexRuntimeAdapter({
      detect: () => detected(),
      process: new FakeProcessController(() => ({ chunks: [] })),
      resolveStart: () => context(),
      platform: "linux",
    });
    await expect(
      adapter.reconcile({
        handleId: "hdl_missing",
        runId: "run_missing",
        adapterId: CODEX_ADAPTER_ID,
        createdAt: "2026-09-11T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      attached: false,
      status: { handle: { handleId: "hdl_missing", runId: "run_missing" }, status: "unknown" },
    });
  });
});
