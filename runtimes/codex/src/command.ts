export type CodexSandboxMode = "read-only" | "workspace-write";
export type CodexApprovalMode = "never" | "on-request";

export interface CodexExecCommand {
  executable: string;
  cwd: string;
  sandbox: CodexSandboxMode;
  approval: CodexApprovalMode;
}

/**
 * Builds argv only. The prompt is deliberately read from stdin so it does not
 * appear in the process list. Spawning and stdin delivery remain the Process
 * port's responsibility.
 */
export function buildCodexExecArgv(command: CodexExecCommand): string[] {
  if (command.executable.length === 0) {
    throw new Error("Codex executable is required");
  }
  if (command.cwd.length === 0) {
    throw new Error("Codex workspace cwd is required");
  }
  return [
    command.executable,
    "-a",
    command.approval,
    "-s",
    command.sandbox,
    "-C",
    command.cwd,
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--color",
    "never",
    "--json",
    "-",
  ];
}
