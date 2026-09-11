import process from "node:process";
import type { Writable } from "node:stream";

import type {
  CapturedProcess,
  CapturedSpawnRequest,
  ProcessCancelMode,
  ProcessController,
  ProcessHandle,
  ProcessStatus,
  SpawnRequest,
} from "@workforce/application/ports";

import { mergeMinimalEnv } from "./env.js";
import { cancelPosix, inspectPosix, spawnPosix, trackedPosixGroupAlive } from "./posix-process.js";
import type { TrackedProcess } from "./tracked.js";
import { cancelWindows, inspectWindows, spawnWindows } from "./windows-job.js";

export class OsProcessController implements ProcessController {
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
    assertCapturedProcessSupported(process.platform);
    const tracked = await this.#spawnTracked(normalized, true);
    const child = tracked.child;
    const completion = tracked.completion;
    const output = tracked.output;
    if (!child?.stdin || !output || !completion) {
      await this.cancel(tracked.handle, "force");
      throw new Error("captured process streams are unavailable");
    }

    const handle = publicHandle(tracked);
    output.setAbortHandler(() => this.cancel(handle, "force"));
    const stdinCompletion = finishStdin(child.stdin, req.stdin);
    const settled = Promise.race([
      Promise.all([completion, stdinCompletion]).then(([processResult, stdinResult]) => ({
        kind: "complete" as const,
        processResult,
        stdinResult,
      })),
      output.abortFailure.then((error) => ({ kind: "abort-error" as const, error })),
    ]);
    return {
      handle,
      output: output.iterable,
      async wait() {
        const result = await settled;
        if (result.kind === "abort-error") {
          throw result.error;
        }
        const { processResult, stdinResult } = result;
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
      this.#releaseTrackedWhenStopped(trackKey(handle), tracked);
    }
  }

  async inspect(handle: ProcessHandle): Promise<ProcessStatus> {
    const key = trackKey(handle);
    const tracked = this.#tracked.get(key);
    if (process.platform === "win32") {
      return inspectWindows(handle);
    }
    const status = await inspectPosix(handle, tracked);
    if (!status.alive && this.#tracked.get(key) === tracked) {
      clearCleanupTimer(tracked);
      this.#tracked.delete(key);
    }
    return status;
  }

  async #spawnTracked(
    req: { argv: string[]; cwd: string; env: Record<string, string> },
    capture: boolean,
  ): Promise<TrackedProcess> {
    const tracked =
      process.platform === "win32"
        ? await spawnWindows(req)
        : await spawnPosix({ ...req, capture });
    const key = trackKey(tracked.handle);
    this.#tracked.set(key, tracked);
    void tracked.completion?.then(() => this.#releaseTrackedWhenStopped(key, tracked));
    return tracked;
  }

  #releaseTrackedWhenStopped(key: string, tracked: TrackedProcess | undefined): void {
    if (!tracked || this.#tracked.get(key) !== tracked) {
      clearCleanupTimer(tracked);
      return;
    }
    if (tracked.platform === "posix" && trackedPosixGroupAlive(tracked)) {
      if (tracked.cleanupTimer) {
        return;
      }
      const timer = setTimeout(() => {
        delete tracked.cleanupTimer;
        this.#releaseTrackedWhenStopped(key, tracked);
      }, 1_000);
      tracked.cleanupTimer = timer;
      timer.unref();
      return;
    }
    clearCleanupTimer(tracked);
    this.#tracked.delete(key);
  }
}

function clearCleanupTimer(tracked: TrackedProcess | undefined): void {
  if (!tracked?.cleanupTimer) {
    return;
  }
  clearTimeout(tracked.cleanupTimer);
  delete tracked.cleanupTimer;
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

function isClosedPipeError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function assertCapturedProcessSupported(platform: NodeJS.Platform): void {
  if (platform !== "win32") {
    return;
  }
  const error = new Error(
    "captured processes are unsupported on win32 until Job Object stream capture is available",
  );
  error.name = "UnsupportedProcessCapabilityError";
  Object.assign(error, {
    code: "unsupported_capability",
    capability: "process.capture",
    platform: "win32",
  });
  throw error;
}
