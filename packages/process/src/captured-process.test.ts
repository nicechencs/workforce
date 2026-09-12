import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import type { ProcessOutput } from "@workforce/application/ports";

import { CAPTURED_OUTPUT_BUFFER_LIMIT } from "./captured-output.js";
import { assertCapturedProcessSupported, OsProcessController } from "./os-process-controller.js";
import {
  UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS,
  UNTESTED_CAPTURED_PROCESS_PLATFORMS,
} from "./start-identity.js";
import { pollUntil } from "./windows-inspect.js";

const cwd = tmpdir();
const capturedProcess = process.platform === "win32" ? describe.skip : describe;
const linuxProcess = process.platform === "linux" ? describe : describe.skip;

capturedProcess(`OsProcessController.spawnCaptured (${process.platform})`, () => {
  it("passes argv literally without shell interpretation", async () => {
    const controller = new OsProcessController();
    const literal = `literal; echo not-a-shell-${randomUUID()}`;
    const captured = await controller.spawnCaptured({
      argv: ["/usr/bin/printf", "%s", literal],
      cwd,
    });

    const [output, exit] = await Promise.all([collect(captured.output), captured.wait()]);
    expect(output.stdout).toBe(literal);
    expect(output.stderr).toBe("");
    expect(exit).toEqual({ exitCode: 0, signal: null });
  });

  it("writes optional stdin to EOF and multiplexes stdout/stderr", async () => {
    const controller = new OsProcessController();
    const input = new TextEncoder().encode("prompt from stdin\nsecond line");
    const captured = await controller.spawnCaptured({
      argv: ["/bin/sh", "-c", "cat; printf stdin-ended >&2"],
      cwd,
      stdin: input,
    });

    const [output, exit] = await Promise.all([collect(captured.output), captured.wait()]);
    expect(output.stdout).toBe(new TextDecoder().decode(input));
    expect(output.stderr).toBe("stdin-ended");
    expect(exit).toEqual({ exitCode: 0, signal: null });
  });

  it("uses the minimal environment plus the requested overlay", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: ["/bin/sh", "-c", 'printf %s "$WF_CAPTURE_TEST"'],
      cwd,
      env: { WF_CAPTURE_TEST: "overlay-value" },
    });

    const [output, exit] = await Promise.all([collect(captured.output), captured.wait()]);
    expect(output.stdout).toBe("overlay-value");
    expect(exit).toEqual({ exitCode: 0, signal: null });
  });

  it("returns a structured non-zero exit and wait is idempotent", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: ["/bin/sh", "-c", "exit 7"],
      cwd,
    });

    const expected = { exitCode: 7, signal: null };
    await expect(captured.wait()).resolves.toEqual(expected);
    await expect(captured.wait()).resolves.toEqual(expected);
    await expect(collect(captured.output)).resolves.toEqual({ stdout: "", stderr: "" });
  });

  it("reliably captures 300 immediately exiting processes", async () => {
    const controller = new OsProcessController();

    for (let index = 0; index < 300; index += 1) {
      const captured = await controller.spawnCaptured({ argv: ["/bin/true"], cwd });
      await expect(captured.wait()).resolves.toEqual({ exitCode: 0, signal: null });
      await expect(collect(captured.output)).resolves.toEqual({ stdout: "", stderr: "" });
    }
  }, 30_000);

  it("treats a child closing a large stdin early as a settled pipe", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: ["/bin/sh", "-c", "exit 0"],
      cwd,
      stdin: new Uint8Array(4 * 1024 * 1024),
    });

    await expect(captured.wait()).resolves.toEqual({ exitCode: 0, signal: null });
    await expect(collect(captured.output)).resolves.toEqual({ stdout: "", stderr: "" });
  });

  it("drains large stdout and stderr fairly through one consumer", async () => {
    const controller = new OsProcessController();
    const bytesPerSource = 2 * 1024 * 1024;
    const captured = await controller.spawnCaptured({
      argv: [
        "/bin/sh",
        "-c",
        "dd if=/dev/zero bs=65536 count=32 2>/dev/null & dd if=/dev/zero bs=65536 count=32 >&2 2>/dev/null & wait",
      ],
      cwd,
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    for await (const event of captured.output) {
      if (event.source === "stdout") {
        stdoutBytes += event.chunk.byteLength;
      } else {
        // This consumer intentionally ignores stderr content while still draining the mux.
        stderrBytes += event.chunk.byteLength;
      }
    }

    expect(stdoutBytes).toBe(bytesPerSource);
    expect(stderrBytes).toBe(bytesPerSource);
    await expect(captured.wait()).resolves.toEqual({ exitCode: 0, signal: null });
  });

  it("force-cancels on bounded-output overflow when output is not consumed", async () => {
    const controller = new OsProcessController();
    const blocks = Math.ceil(CAPTURED_OUTPUT_BUFFER_LIMIT / 65_536) + 1;
    const captured = await controller.spawnCaptured({
      argv: ["/bin/sh", "-c", `dd if=/dev/zero bs=65536 count=${blocks} 2>/dev/null; sleep 60`],
      cwd,
    });

    await expect(withTimeout(captured.wait(), 5_000)).rejects.toMatchObject({
      name: "ProcessControllerError",
      code: "process_output_overflow",
      operation: "output",
    });
    await expect(collect(captured.output)).rejects.toMatchObject({
      name: "ProcessOutputOverflowError",
      code: "process_output_overflow",
    });
    await expect(controller.inspect(captured.handle)).resolves.toMatchObject({ alive: false });
  });

  it("force-cancels when the sole output iterator returns before EOF", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: ["/bin/sh", "-c", "while :; do printf x; sleep 0.01; done"],
      cwd,
    });

    for await (const event of captured.output) {
      expect(event.source).toBe("stdout");
      break;
    }

    await expect(withTimeout(captured.wait(), 5_000)).rejects.toMatchObject({
      name: "ProcessControllerError",
      code: "process_output_abandoned",
      operation: "output",
    });
    await expect(controller.inspect(captured.handle)).resolves.toMatchObject({ alive: false });
  });

  it("force-cancels when output return is called before the first next", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({ argv: ["/bin/sleep", "60"], cwd });
    const iterator = captured.output[Symbol.asyncIterator]();

    await expect(withTimeout(iterator.return!(), 5_000)).resolves.toMatchObject({ done: true });
    await expect(withTimeout(iterator.return!(), 5_000)).resolves.toMatchObject({ done: true });
    await expect(withTimeout(captured.wait(), 5_000)).rejects.toMatchObject({
      code: "process_output_abandoned",
    });
    await expect(controller.inspect(captured.handle)).resolves.toMatchObject({ alive: false });
  });

  it("return wakes a pending output next and terminates the process", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({ argv: ["/bin/sleep", "60"], cwd });
    const iterator = captured.output[Symbol.asyncIterator]();
    const pending = iterator.next();

    const returning = iterator.return!();
    await expect(withTimeout(pending, 1_000)).resolves.toMatchObject({ done: true });
    await expect(withTimeout(returning, 5_000)).resolves.toMatchObject({ done: true });
    await expect(withTimeout(captured.wait(), 5_000)).rejects.toMatchObject({
      code: "process_output_abandoned",
    });
    await expect(controller.inspect(captured.handle)).resolves.toMatchObject({ alive: false });
  });

  it("uses a captured handle with the existing inspect and cancel path", async () => {
    const controller = new OsProcessController();
    const captured = await controller.spawnCaptured({ argv: ["/bin/sleep", "60"], cwd });

    await expect(controller.inspect(captured.handle)).resolves.toEqual({
      alive: true,
      startIdentity: captured.handle.startIdentity,
    });
    await controller.cancel(captured.handle, "force");
    await expect(withTimeout(captured.wait(), 5_000)).resolves.toEqual({
      exitCode: null,
      signal: "SIGKILL",
    });
    await expect(controller.inspect(captured.handle)).resolves.toMatchObject({ alive: false });
  });

  it("rejects spawn errors and invalid requests", async () => {
    const controller = new OsProcessController();
    await expect(
      controller.spawnCaptured({ argv: [`workforce-missing-${randomUUID()}`], cwd }),
    ).rejects.toThrow();
    await expect(controller.spawnCaptured({ argv: [], cwd })).rejects.toThrow(
      "SpawnRequest.argv[0] must be an executable",
    );
    await expect(
      controller.spawnCaptured({ argv: ["/usr/bin/printf", "bad\0argument"], cwd }),
    ).rejects.toThrow("without null bytes");
    await expect(
      controller.spawnCaptured({
        argv: ["/usr/bin/printf"],
        cwd,
        stdin: "not bytes" as unknown as Uint8Array,
      }),
    ).rejects.toThrow("CapturedSpawnRequest.stdin must be a Uint8Array");
  });
});

linuxProcess("POSIX managed process group", () => {
  it("allows another controller to cancel a verified live root and its complete group", async () => {
    const owner = new OsProcessController();
    const other = new OsProcessController();
    const sentinelController = new OsProcessController();
    const dir = fs.mkdtempSync(`${tmpdir()}/wf-cross-controller-`);
    const childFile = `${dir}/child.pid`;
    let handle: { pid: number; startIdentity: string } | undefined;
    let sentinel: { pid: number; startIdentity: string } | undefined;
    let childPid: number | undefined;

    try {
      handle = await owner.spawn({
        argv: [
          "/bin/sh",
          "-c",
          'sleep 60 & child=$!; printf "%s\\n" "$child" > "$WF_CHILD_PID_FILE"; wait',
        ],
        cwd,
        env: { WF_CHILD_PID_FILE: childFile },
      });
      sentinel = await sentinelController.spawn({ argv: ["/bin/sleep", "60"], cwd });
      expect(await pollUntil(() => fs.existsSync(childFile), 5_000)).toBe(true);
      childPid = Number(fs.readFileSync(childFile, "utf8").trim());
      expect(isLiveLinuxPid(handle.pid)).toBe(true);
      expect(isLiveLinuxPid(childPid)).toBe(true);
      expect(isLiveLinuxPid(sentinel.pid)).toBe(true);

      await other.cancel(handle, "force");

      expect(await pollUntil(() => !isLiveLinuxPid(handle!.pid), 5_000)).toBe(true);
      expect(await pollUntil(() => !isLiveLinuxPid(childPid!), 5_000)).toBe(true);
      expect(isLiveLinuxPid(sentinel.pid)).toBe(true);
    } finally {
      if (handle) {
        await owner.cancel(handle, "force");
      }
      if (sentinel) {
        await sentinelController.cancel(sentinel, "force");
      }
      if (childPid && isLiveLinuxPid(childPid)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // already stopped
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inspects and force-cancels a group after its root exits", async () => {
    const controller = new OsProcessController();
    const nonOwner = new OsProcessController();
    const captured = await controller.spawnCaptured({
      argv: ["/bin/sh", "-c", "sleep 60 & child=$!; printf '%s\\n' \"$child\"; exit 0"],
      cwd,
    });
    const iterator = captured.output[Symbol.asyncIterator]();

    try {
      const first = await withTimeout(iterator.next(), 5_000);
      expect(first.done).toBe(false);
      const childPid = Number((await readStdoutLine(iterator, first)).trim());
      expect(Number.isInteger(childPid)).toBe(true);
      expect(await pollUntil(() => !isLiveLinuxPid(captured.handle.pid), 5_000)).toBe(true);
      expect(isLiveLinuxPid(childPid)).toBe(true);

      await expect(nonOwner.inspect(captured.handle)).rejects.toMatchObject({
        code: "process_tree_unverified",
        operation: "inspect",
      });
      await expect(nonOwner.cancel(captured.handle, "force")).rejects.toMatchObject({
        code: "process_tree_unverified",
        operation: "cancel",
      });
      expect(isLiveLinuxPid(childPid)).toBe(true);
      await expect(controller.inspect(captured.handle)).resolves.toEqual({
        alive: true,
        startIdentity: captured.handle.startIdentity,
      });

      const wait = captured.wait();
      await expect(withTimeout(wait, 100)).rejects.toThrow("timed out");
      await controller.cancel(captured.handle, "force");
      await expect(withTimeout(wait, 5_000)).resolves.toEqual({
        exitCode: 0,
        signal: null,
      });
      expect(await pollUntil(() => !isLiveLinuxPid(childPid), 5_000)).toBe(true);
      await expect(controller.inspect(captured.handle)).resolves.toMatchObject({ alive: false });
    } finally {
      await controller.cancel(captured.handle, "force");
    }
  });

  it("treats an untracked exited handle with no remaining group as dead", async () => {
    const owner = new OsProcessController();
    const other = new OsProcessController();
    const handle = await owner.spawn({ argv: ["/bin/true"], cwd });

    expect(await pollUntil(() => !isLiveLinuxPid(handle.pid), 5_000)).toBe(true);
    await expect(other.inspect(handle)).resolves.toEqual({
      alive: false,
      startIdentity: handle.startIdentity,
    });
    await expect(other.cancel(handle, "force")).resolves.toBeUndefined();
  });

  it("rejects a mismatched root identity without killing the live group", async () => {
    const controller = new OsProcessController();
    const handle = await controller.spawn({ argv: ["/bin/sleep", "60"], cwd });
    const mismatched = { ...handle, startIdentity: `${handle.startIdentity}:reused` };

    try {
      await expect(controller.cancel(mismatched, "force")).rejects.toMatchObject({
        code: "identity_mismatch",
      });
      await expect(controller.inspect(handle)).resolves.toMatchObject({ alive: true });
    } finally {
      await controller.cancel(handle, "force");
    }
  });

  it("keeps existing non-captured spawn/inspect/cancel behavior", async () => {
    const controller = new OsProcessController();
    const handle = await controller.spawn({ argv: ["/bin/sleep", "60"], cwd });

    await expect(controller.inspect(handle)).resolves.toEqual({
      alive: true,
      startIdentity: handle.startIdentity,
    });
    await controller.cancel(handle, "force");
    expect(await pollUntil(async () => !(await controller.inspect(handle)).alive, 5_000)).toBe(
      true,
    );
  });
});

describe("captured process platform support", () => {
  it("reports invalid captured requests through the public stable error", async () => {
    const controller = new OsProcessController();

    await expect(controller.spawnCaptured({ argv: [], cwd })).rejects.toMatchObject({
      name: "ProcessControllerError",
      code: "invalid_request",
      operation: "spawn",
    });
  });

  it("fails closed before spawn on Windows", () => {
    expect(() => assertCapturedProcessSupported("win32")).toThrowError(
      expect.objectContaining({
        name: "ProcessControllerError",
        code: "unsupported_capability",
        capability: "process.capture",
        platform: "win32",
      }),
    );
  });

  it("records Windows as unsupported and macOS as untested", () => {
    expect(UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS).toEqual(["win32"]);
    expect(UNTESTED_CAPTURED_PROCESS_PLATFORMS).toEqual(["darwin"]);
  });
});

async function collect(
  output: AsyncIterable<ProcessOutput>,
): Promise<{ stdout: string; stderr: string }> {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  for await (const event of output) {
    (event.source === "stdout" ? stdout : stderr).push(event.chunk);
  }
  return {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isLiveLinuxPid(pid: number): boolean {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closed = stat.lastIndexOf(")");
    return (
      closed >= 0 &&
      stat
        .slice(closed + 1)
        .trim()
        .split(/\s+/)[0] !== "Z"
    );
  } catch {
    return false;
  }
}

async function readStdoutLine(
  iterator: AsyncIterator<ProcessOutput>,
  first: IteratorResult<ProcessOutput>,
): Promise<string> {
  let result = "";
  let current = first;
  while (!current.done) {
    if (current.value.source === "stdout") {
      result += new TextDecoder().decode(current.value.chunk);
      const newline = result.indexOf("\n");
      if (newline >= 0) {
        return result.slice(0, newline);
      }
    }
    current = await iterator.next();
  }
  throw new Error("process output ended before the child pid line");
}
