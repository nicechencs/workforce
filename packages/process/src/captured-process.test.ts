import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { OsProcessController } from "./os-process-controller.js";
import { UNTESTED_CAPTURED_PROCESS_PLATFORMS } from "./start-identity.js";
import { captureChildOutput } from "./tracked.js";
import { pollUntil } from "./windows-inspect.js";

const cwd = tmpdir();

describe(`OsProcessController.spawnCaptured (${process.platform})`, () => {
  it("passes argv literally without shell interpretation and keeps stdout/stderr separate", async () => {
    const controller = new OsProcessController();
    const literal = `literal; echo not-a-shell-${randomUUID()}`;
    const captured = await controller.spawnCaptured({
      argv: literalArgv(literal),
      cwd,
    });

    const [stdout, stderr, exit] = await Promise.all([
      collect(captured.stdout),
      collect(captured.stderr),
      captured.wait(),
    ]);

    expect(stdout).toBe(literal);
    expect(stderr).toBe("");
    expect(exit).toEqual({ exitCode: 0, signal: null });
  });

  it("writes optional stdin to completion and closes the pipe", async () => {
    const controller = new OsProcessController();
    const input = new TextEncoder().encode("prompt from stdin\nsecond line");
    const captured = await controller.spawnCaptured({
      argv: stdinArgv(),
      cwd,
      stdin: input,
    });

    const [stdout, stderr, exit] = await Promise.all([
      collect(captured.stdout),
      collect(captured.stderr),
      captured.wait(),
    ]);

    expect(stdout).toBe(new TextDecoder().decode(input));
    expect(stderr).toBe("stdin-ended");
    expect(exit).toEqual({ exitCode: 0, signal: null });
  });

  it("adds only the requested environment overlay to the inherited minimal environment", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: environmentArgv(),
      cwd,
      env: { WF_CAPTURE_TEST: "overlay-value" },
    });

    const [stdout, exit] = await Promise.all([collect(captured.stdout), captured.wait()]);
    expect(stdout).toBe("overlay-value");
    expect(exit).toEqual({ exitCode: 0, signal: null });
  });

  it("returns a structured non-zero exit", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: nonZeroArgv(),
      cwd,
    });

    await expect(captured.wait()).resolves.toEqual({ exitCode: 7, signal: null });
    await expect(collect(captured.stdout)).resolves.toBe("");
    await expect(collect(captured.stderr)).resolves.toBe("");
  });

  it("uses the captured handle with the existing inspect and cancel path", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: sleeperArgv(),
      cwd,
    });

    const before = await controller.inspect(captured.handle);
    expect(before).toEqual({ alive: true, startIdentity: captured.handle.startIdentity });

    await controller.cancel(captured.handle, "force");
    await captured.wait();
    const stopped = await pollUntil(
      async () => !(await controller.inspect(captured.handle)).alive,
      5_000,
    );
    expect(stopped).toBe(true);
    if (process.platform !== "win32") {
      await expect(captured.wait()).resolves.toEqual({ exitCode: null, signal: "SIGKILL" });
    }
  });

  it("keeps the existing non-captured spawn/inspect/cancel behavior", async () => {
    const controller = new OsProcessController();
    const handle = await controller.spawn({ argv: sleeperArgv(), cwd });

    await expect(controller.inspect(handle)).resolves.toEqual({
      alive: true,
      startIdentity: handle.startIdentity,
    });
    await controller.cancel(handle, "force");
    const stopped = await pollUntil(async () => !(await controller.inspect(handle)).alive, 5_000);
    expect(stopped).toBe(true);
  });

  it("rejects spawn errors and invalid requests", async () => {
    const controller = new OsProcessController();
    await expect(
      controller.spawnCaptured({
        argv: [`workforce-missing-${randomUUID()}`],
        cwd,
      }),
    ).rejects.toThrow();
    await expect(controller.spawnCaptured({ argv: [], cwd })).rejects.toThrow(
      "SpawnRequest.argv[0] must be an executable",
    );
    await expect(
      controller.spawnCaptured({
        argv: [process.execPath, "bad\0argument"],
        cwd,
      }),
    ).rejects.toThrow("without null bytes");
    await expect(
      controller.spawnCaptured({
        argv: [process.execPath],
        cwd,
        stdin: "not bytes" as unknown as Uint8Array,
      }),
    ).rejects.toThrow("CapturedSpawnRequest.stdin must be a Uint8Array");
  });

  it("records the captured-process platforms not run for this delivery", () => {
    expect(UNTESTED_CAPTURED_PROCESS_PLATFORMS).toEqual(["win32", "darwin"]);
  });
});

describe("captured output streams", () => {
  it("forwards stream completion without waiting for a consumer to attach", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);

    stdout.end("fast stdout");
    stderr.end("fast stderr");

    await expect(collect(captured.stdout)).resolves.toBe("fast stdout");
    await expect(collect(captured.stderr)).resolves.toBe("fast stderr");
  });

  it("surfaces an output stream error to its async consumer", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    const consuming = collect(captured.stdout);

    stdout.destroy(new Error("stdout failed"));

    await expect(consuming).rejects.toThrow("stdout failed");
    stderr.end();
  });
});

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function literalArgv(literal: string): string[] {
  if (process.platform === "win32") {
    return [process.execPath, "-e", "process.stdout.write(process.argv[1])", literal];
  }
  return ["/usr/bin/printf", "%s", literal];
}

function stdinArgv(): string[] {
  if (process.platform === "win32") {
    return [
      process.execPath,
      "-e",
      "process.stdin.on('data', c => process.stdout.write(c)); process.stdin.on('end', () => process.stderr.write('stdin-ended'))",
    ];
  }
  return ["/bin/sh", "-c", "cat; printf stdin-ended >&2"];
}

function nonZeroArgv(): string[] {
  if (process.platform === "win32") {
    return [process.execPath, "-e", "process.exitCode = 7"];
  }
  return ["/bin/sh", "-c", "exit 7"];
}

function environmentArgv(): string[] {
  if (process.platform === "win32") {
    return [process.execPath, "-e", "process.stdout.write(process.env.WF_CAPTURE_TEST ?? '')"];
  }
  return ["/bin/sh", "-c", 'printf %s "$WF_CAPTURE_TEST"'];
}

function sleeperArgv(): string[] {
  if (process.platform === "win32") {
    return [process.execPath, "-e", "setInterval(() => {}, 60_000)"];
  }
  return ["/bin/sleep", "60"];
}
