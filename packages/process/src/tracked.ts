import type { ChildProcess } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

export type TrackedProcessExit =
  | { kind: "exit"; exitCode: number | null; signal: string | null }
  | { kind: "error"; error: Error };

export type TrackedProcess = {
  handle: { pid: number; startIdentity: string };
  platform: "win32" | "posix";
  descendants: Array<{ pid: number; startIdentity: string }>;
  usedJob: boolean;
  closeFlag?: string;
  helper?: ChildProcess;
  child?: ChildProcess;
  completion?: Promise<TrackedProcessExit>;
  stdout?: Readable;
  stderr?: Readable;
  dir?: string;
};

export function captureChildOutput(child: ChildProcess): { stdout: Readable; stderr: Readable } {
  if (!child.stdout || !child.stderr) {
    throw new Error("captured process streams are unavailable");
  }
  return {
    stdout: forwardOutput(child.stdout),
    stderr: forwardOutput(child.stderr),
  };
}

export function observeChild(child: ChildProcess): Promise<TrackedProcessExit> {
  child.stdin?.on("error", ignoreStreamError);
  child.stdout?.on("error", ignoreStreamError);
  child.stderr?.on("error", ignoreStreamError);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: TrackedProcessExit) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => {
      settle({ kind: "error", error });
    });
    child.once("close", (exitCode, signal) => {
      settle({ kind: "exit", exitCode, signal });
    });
  });
}

function ignoreStreamError(): void {
  // Streams surface their stored error to an eventual async iterator or stdin completion callback.
}

function forwardOutput(source: Readable): Readable {
  const output = new PassThrough();
  output.on("error", ignoreStreamError);
  source.once("error", (error) => {
    output.destroy(error);
  });
  source.pipe(output);
  return output;
}
