import process from "node:process";
import type { Writable } from "node:stream";

import { ProcessControllerError } from "@workforce/application/ports";
import type {
  CapturedProcess,
  CapturedSpawnRequest,
  ProcessCancelMode,
  ProcessController,
  ProcessHandle,
  ProcessExitResult,
  ProcessStatus,
  SpawnRequest,
} from "@workforce/application/ports";

import { mergeMinimalEnv } from "./env.js";
import {
  cancelPosix,
  inspectPosix,
  spawnPosix,
  trackedPosixGroupAlive,
  waitForTrackedPosixGroupExit,
} from "./posix-process.js";
import type { TrackedProcess } from "./tracked.js";
import { cancelWindows, inspectWindows, spawnWindows } from "./windows-job.js";

export class OsProcessController implements ProcessController {
  readonly #tracked = new Map<string, TrackedProcess>();

  async spawn(req: SpawnRequest): Promise<ProcessHandle> {
    try {
      const tracked = await this.#spawnTracked(validateSpawnRequest(req), false);
      return publicHandle(tracked);
    } catch (error) {
      throw normalizeControllerError(error, "spawn", "spawn_failed");
    }
  }

  async spawnCaptured(req: CapturedSpawnRequest): Promise<CapturedProcess> {
    const normalized = validateSpawnRequest(req);
    if (req.stdin !== undefined && !(req.stdin instanceof Uint8Array)) {
      throw new ProcessControllerError(
        "invalid_request",
        "spawn",
        "CapturedSpawnRequest.stdin must be a Uint8Array",
      );
    }
    assertCapturedProcessSupported(process.platform);
    let tracked: TrackedProcess;
    try {
      tracked = await this.#spawnTracked(normalized, true);
    } catch (error) {
      throw normalizeControllerError(error, "spawn", "spawn_failed");
    }
    const child = tracked.child;
    const completion = tracked.completion;
    const output = tracked.output;
    if (!child?.stdin || !output || !completion) {
      try {
        await this.cancel(tracked.handle, "force");
      } catch {
        // The primary failure remains missing required capture streams.
      }
      throw new ProcessControllerError(
        "spawn_failed",
        "spawn",
        "captured process streams are unavailable",
      );
    }

    const handle = publicHandle(tracked);
    output.setAbortHandler(() => this.cancel(handle, "force"));
    const stdinCompletion = finishStdin(child.stdin, req.stdin);
    const settled: Promise<CapturedWaitOutcome> = Promise.race([
      Promise.all([completion, stdinCompletion, output.completion]).then(
        async ([processResult, stdinResult, outputResult]) => {
          if (processResult.kind === "error") {
            return waitError(
              processControllerError("process_wait_failed", "wait", processResult.error),
            );
          }
          try {
            if (process.platform !== "win32") {
              await waitForTrackedPosixGroupExit(tracked);
            }
          } catch (error) {
            return waitError(normalizeWaitError(error));
          }
          if (stdinResult.kind === "error" && !isClosedPipeError(stdinResult.error)) {
            return waitError(
              processControllerError("process_input_failed", "wait", stdinResult.error),
            );
          }
          if (outputResult.kind === "error") {
            return waitError(
              processControllerError(
                outputErrorCode(outputResult.error),
                "output",
                outputResult.error,
              ),
            );
          }
          if (outputResult.kind === "abandoned") {
            return waitError(
              new ProcessControllerError(
                "process_output_abandoned",
                "output",
                "captured process output was abandoned before EOF",
              ),
            );
          }
          return {
            kind: "complete" as const,
            result: { exitCode: processResult.exitCode, signal: processResult.signal },
          };
        },
        (error: unknown) => waitError(normalizeWaitError(error)),
      ),
      output.abortFailure.then((error) =>
        waitError(processControllerError("process_cancel_failed", "cancel", error)),
      ),
    ]);
    return {
      handle,
      output: output.iterable,
      async wait() {
        const outcome = await settled;
        if (outcome.kind === "error") {
          throw outcome.error;
        }
        return outcome.result;
      },
    };
  }

  async cancel(handle: ProcessHandle, mode: ProcessCancelMode): Promise<void> {
    try {
      const tracked = this.#tracked.get(trackKey(handle));
      if (process.platform === "win32") {
        await cancelWindows(handle, mode, tracked);
      } else {
        await cancelPosix(handle, mode, tracked);
      }
      if (mode === "force") {
        this.#releaseTrackedWhenStopped(trackKey(handle), tracked);
      }
    } catch (error) {
      throw normalizeControllerError(error, "cancel", "process_cancel_failed");
    }
  }

  async inspect(handle: ProcessHandle): Promise<ProcessStatus> {
    try {
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
    } catch (error) {
      throw normalizeControllerError(error, "inspect", "process_tree_unverified");
    }
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

type CapturedWaitOutcome =
  | { kind: "complete"; result: ProcessExitResult }
  | { kind: "error"; error: ProcessControllerError };

function waitError(error: ProcessControllerError): CapturedWaitOutcome {
  return { kind: "error", error };
}

function normalizeWaitError(error: unknown): ProcessControllerError {
  if (error instanceof ProcessControllerError) {
    return error;
  }
  return processControllerError("process_wait_failed", "wait", toError(error));
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
    throw invalidRequestError("SpawnRequest.argv[0] must be an executable");
  }
  for (const arg of req.argv) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      throw invalidRequestError("SpawnRequest.argv must contain only strings without null bytes");
    }
  }
  if (typeof req.cwd !== "string" || req.cwd.length === 0 || req.cwd.includes("\0")) {
    throw invalidRequestError("SpawnRequest.cwd is required and must not contain null bytes");
  }
  if (req.env !== undefined && (typeof req.env !== "object" || Array.isArray(req.env))) {
    throw invalidRequestError("SpawnRequest.env must be a string record");
  }
  for (const [key, value] of Object.entries(req.env ?? {})) {
    if (key.length === 0 || key.includes("=") || key.includes("\0")) {
      throw invalidRequestError(
        "SpawnRequest.env keys must be non-empty and must not contain '=' or null bytes",
      );
    }
    if (typeof value !== "string" || value.includes("\0")) {
      throw invalidRequestError("SpawnRequest.env values must be strings without null bytes");
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
  throw new ProcessControllerError(
    "unsupported_capability",
    "spawn",
    "captured processes are unsupported on win32 until Job Object stream capture is available",
    { capability: "process.capture", platform: "win32" },
  );
}

function outputErrorCode(error: Error): "process_output_overflow" | "process_output_failed" {
  return (error as { code?: unknown }).code === "process_output_overflow"
    ? "process_output_overflow"
    : "process_output_failed";
}

function processControllerError(
  code:
    | "process_wait_failed"
    | "process_input_failed"
    | "process_output_overflow"
    | "process_output_failed"
    | "process_cancel_failed",
  operation: "wait" | "output" | "cancel",
  cause: Error,
): ProcessControllerError {
  return new ProcessControllerError(code, operation, cause.message, { cause });
}

function invalidRequestError(message: string): ProcessControllerError {
  return new ProcessControllerError("invalid_request", "spawn", message);
}

function normalizeControllerError(
  error: unknown,
  operation: "spawn" | "inspect" | "cancel",
  fallback: "spawn_failed" | "process_tree_unverified" | "process_cancel_failed",
): ProcessControllerError {
  if (error instanceof ProcessControllerError) {
    return error;
  }
  const cause = toError(error);
  const code = (cause as { code?: unknown }).code;
  if (code === "identity_mismatch") {
    return new ProcessControllerError("identity_mismatch", operation, cause.message, { cause });
  }
  return new ProcessControllerError(fallback, operation, cause.message, { cause });
}
