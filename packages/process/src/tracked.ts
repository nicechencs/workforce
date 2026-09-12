import type { ChildProcess } from "node:child_process";

import type { ManagedCapturedOutput } from "./captured-output.js";

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
  output?: ManagedCapturedOutput;
  cleanupTimer?: NodeJS.Timeout;
  posixGroup?: {
    pgid: number;
    sessionId: number;
    rootStartIdentity: string;
    owned: boolean;
    /** The owned group was observed empty (or gone) before ownership was released. */
    terminalVerified?: true;
  };
  dir?: string;
};

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
