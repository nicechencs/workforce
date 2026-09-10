import { execFile, type ExecFileException } from "node:child_process";
import path from "node:path";

import { WorkspaceError } from "./errors.js";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  allowExitCodes?: readonly number[];
  timeoutMs?: number;
}

export class GitCommandError extends WorkspaceError {
  override readonly name: string = "GitCommandError";
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    args: readonly string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    cause?: unknown;
  }) {
    const detail = (input.stderr || input.stdout).trim();
    const message = `git ${input.args.join(" ")} failed (exit ${input.exitCode ?? "null"})${
      detail ? `: ${detail}` : ""
    }`;
    if (input.cause !== undefined) {
      super(message, { cause: input.cause });
    } else {
      super(message);
    }
    this.args = input.args;
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

const GIT_BASE_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  LANG: "C",
};

function normalizeOutput(text: string): string {
  return text.replace(/\r\n/gu, "\n");
}

function assertSafeGitArgs(args: readonly string[]): void {
  if (args[0] === "worktree" && args[1] === "add") {
    if (!args.includes("-b")) {
      throw new WorkspaceError("git worktree add must pass -b");
    }
    if (args.includes("--force") || args.includes("-f")) {
      throw new WorkspaceError("git worktree add must not use --force");
    }
  }
  if (args[0] === "worktree" && args[1] === "remove") {
    const forces = args.filter((a) => a === "--force" || a === "-f");
    if (forces.length > 1) {
      throw new WorkspaceError("git worktree remove must not use -f -f");
    }
  }
}

/** Convert a git-printed path (forward slashes on Windows) to a system path. */
export function gitPathToSystem(gitPath: string): string {
  return path.normalize(gitPath.trim());
}

/** Convert a system path to the forward-slash form git accepts in env values. */
export function toGitPath(systemPath: string): string {
  return systemPath.replace(/\\/gu, "/");
}

export function runGit(args: readonly string[], options: GitExecOptions): Promise<GitResult> {
  assertSafeGitArgs(args);
  const argv = ["-c", "core.hooksPath=", ...args];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...GIT_BASE_ENV,
    ...options.env,
  };
  const allow = options.allowExitCodes ?? [0];

  return new Promise((resolve, reject) => {
    execFile(
      "git",
      argv,
      {
        cwd: options.cwd,
        env,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        timeout: options.timeoutMs ?? 60_000,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        const out = normalizeOutput(stdout ?? "");
        const errOut = normalizeOutput(stderr ?? "");
        if (error) {
          if (error.code === "ENOENT") {
            reject(new WorkspaceError("git executable not found", { cause: error }));
            return;
          }
          const exitCode = typeof error.code === "number" ? error.code : null;
          if (exitCode !== null && allow.includes(exitCode)) {
            resolve({ stdout: out, stderr: errOut, exitCode });
            return;
          }
          reject(
            new GitCommandError({
              args,
              exitCode,
              stdout: out,
              stderr: errOut,
              cause: error,
            }),
          );
          return;
        }
        resolve({ stdout: out, stderr: errOut, exitCode: 0 });
      },
    );
  });
}
