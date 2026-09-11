import process from "node:process";
import type { Readable, Writable } from "node:stream";

import { mergeMinimalEnv } from "./env.js";
import { cancelPosix, inspectPosix, spawnPosix } from "./posix-process.js";
import type { TrackedProcess } from "./tracked.js";
import { cancelWindows, inspectWindows, spawnWindows } from "./windows-job.js";

export type ProcessCancelMode = "graceful" | "force";

export interface ProcessHandle {
  pid: number;
  startIdentity: string;
}

export interface SpawnRequest {
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface CapturedSpawnRequest extends SpawnRequest {
  stdin?: Uint8Array;
}

export interface ProcessStatus {
  alive: boolean;
  startIdentity: string;
}

export interface ProcessExitResult {
  exitCode: number | null;
  signal: string | null;
}

export interface CapturedProcess {
  handle: ProcessHandle;
  stdout: AsyncIterable<Uint8Array>;
  stderr: AsyncIterable<Uint8Array>;
  wait(): Promise<ProcessExitResult>;
}

export class OsProcessController {
  readonly #tracked = new Map<string, TrackedProcess>();

  async spawn(req: SpawnRequest): Promise<ProcessHandle> {
    const tracked = await this.#spawnTracked(validateSpawnRequest(req), false);
    return publicHandle(tracked);
  }

  async spawnCaptured(req: CapturedSpawnRequest): Promise<CapturedProcess> {
    const normalized = validateSpawnRequest(req);
    if (req.stdin !== undefined && !(req.stdin instanceof Uint8Array)) {
      throw new Error("CapturedSpawnRequest.stdin must be a Uint8Array");
    }
    const tracked = await this.#spawnTracked(normalized, true);
    const child = tracked.child;
    const completion = tracked.completion;
    if (!child?.stdin || !tracked.stdout || !tracked.stderr || !completion) {
      await this.cancel(tracked.handle, "force");
      throw new Error("captured process streams are unavailable");
    }

    const stdinCompletion = finishStdin(child.stdin, req.stdin);
    const settled = Promise.all([completion, stdinCompletion]);
    return {
      handle: publicHandle(tracked),
      stdout: readBytes(tracked.stdout),
      stderr: readBytes(tracked.stderr),
      async wait() {
        const [processResult, stdinResult] = await settled;
        if (processResult.kind === "error") {
          throw processResult.error;
        }
        if (stdinResult.kind === "error" && !isClosedPipeError(stdinResult.error)) {
          throw stdinResult.error;
        }
        return {
          exitCode: processResult.exitCode,
          signal: processResult.signal,
        };
      },
    };
  }

  async cancel(handle: ProcessHandle, mode: ProcessCancelMode): Promise<void> {
    const tracked = this.#tracked.get(trackKey(handle));
    if (process.platform === "win32") {
      await cancelWindows(handle, mode, tracked);
    } else {
      await cancelPosix(handle, mode, tracked);
    }
    if (mode === "force") {
      this.#tracked.delete(trackKey(handle));
    }
  }

  async inspect(handle: ProcessHandle): Promise<ProcessStatus> {
    if (process.platform === "win32") {
      return inspectWindows(handle);
    }
    return inspectPosix(handle);
  }

  async #spawnTracked(
    req: { argv: string[]; cwd: string; env: Record<string, string> },
    capture: boolean,
  ): Promise<TrackedProcess> {
    const normalized = { ...req, capture };
    const tracked =
      process.platform === "win32" ? await spawnWindows(normalized) : await spawnPosix(normalized);
    const key = trackKey(tracked.handle);
    this.#tracked.set(key, tracked);
    void tracked.completion?.then(() => {
      if (this.#tracked.get(key) === tracked) {
        this.#tracked.delete(key);
      }
    });
    return tracked;
  }
}

function trackKey(handle: ProcessHandle): string {
  return `${handle.pid}\n${handle.startIdentity}`;
}

function publicHandle(tracked: TrackedProcess): ProcessHandle {
  return {
    pid: tracked.handle.pid,
    startIdentity: tracked.handle.startIdentity,
  };
}

function validateSpawnRequest(req: SpawnRequest): {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
} {
  const exe = Array.isArray(req?.argv) ? req.argv[0] : undefined;
  if (typeof exe !== "string" || exe.length === 0) {
    throw new Error("SpawnRequest.argv[0] must be an executable");
  }
  for (const arg of req.argv) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      throw new Error("SpawnRequest.argv must contain only strings without null bytes");
    }
  }
  if (typeof req.cwd !== "string" || req.cwd.length === 0 || req.cwd.includes("\0")) {
    throw new Error("SpawnRequest.cwd is required and must not contain null bytes");
  }
  if (req.env !== undefined && (typeof req.env !== "object" || Array.isArray(req.env))) {
    throw new Error("SpawnRequest.env must be a string record");
  }
  for (const [key, value] of Object.entries(req.env ?? {})) {
    if (key.length === 0 || key.includes("=") || key.includes("\0")) {
      throw new Error(
        "SpawnRequest.env keys must be non-empty and must not contain '=' or null bytes",
      );
    }
    if (typeof value !== "string" || value.includes("\0")) {
      throw new Error("SpawnRequest.env values must be strings without null bytes");
    }
  }
  return {
    argv: [...req.argv],
    cwd: req.cwd,
    env: mergeMinimalEnv(req.env),
  };
}

type StdinCompletion = { kind: "complete" } | { kind: "error"; error: Error };

function finishStdin(stdin: Writable, input: Uint8Array | undefined): Promise<StdinCompletion> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: StdinCompletion) => {
      if (settled) {
        return;
      }
      settled = true;
      stdin.off("error", onError);
      stdin.off("close", onClose);
      resolve(result);
    };
    const onError = (error: Error) => {
      settle({ kind: "error", error });
    };
    const onClose = () => {
      settle({ kind: "complete" });
    };
    stdin.once("error", onError);
    stdin.once("close", onClose);
    try {
      stdin.end(input, () => {
        settle({ kind: "complete" });
      });
    } catch (error) {
      settle({ kind: "error", error: toError(error) });
    }
  });
}

async function* readBytes(stream: Readable): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) {
      yield chunk;
      continue;
    }
    yield Buffer.from(String(chunk));
  }
}

function isClosedPipeError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
