import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { RuntimeHostPort, StartRunHostRequest, TaskRecord } from "@workforce/application";
import { GitWorkspaceService } from "@workforce/workspace";

const execFileAsync = promisify(execFile);

const MOCK_GIT_NAME = "workforce-mock";
const MOCK_GIT_EMAIL = "workforce-mock@local";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: MOCK_GIT_NAME,
  GIT_AUTHOR_EMAIL: MOCK_GIT_EMAIL,
  GIT_COMMITTER_NAME: MOCK_GIT_NAME,
  GIT_COMMITTER_EMAIL: MOCK_GIT_EMAIL,
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  LANG: "C",
};

export interface ProvisionedWorktree {
  projectId: string;
  taskId: string;
  attempt: number;
  role: string;
  nodeId: string;
  gitWorkspaceId: string;
  workspaceInstanceId: string;
  worktreePath: string;
  baseSha: string;
  runKey: string;
}

export interface CompositionWorktreeHostOptions {
  stateDir: string;
}

function isWorktreeRole(role: string): boolean {
  return role === "developer" || role === "reviewer";
}

function runKeyFor(taskId: string, attempt: number): string {
  return `${taskId}-a${attempt}`;
}

export async function runMockGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-c", "core.hooksPath=", ...args], {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    windowsHide: true,
  });
  return String(stdout ?? "")
    .replace(/\r\n/gu, "\n")
    .trim();
}

export async function ensureMockGitRepository(
  repoPath: string,
): Promise<{ repoPath: string; baseSha: string }> {
  await mkdir(repoPath, { recursive: true });
  try {
    const inside = await runMockGit(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") {
      throw new Error("not a work tree");
    }
  } catch {
    await runMockGit(repoPath, ["init", "-b", "main"]);
    await runMockGit(repoPath, ["config", "user.name", MOCK_GIT_NAME]);
    await runMockGit(repoPath, ["config", "user.email", MOCK_GIT_EMAIL]);
  }
  let baseSha: string | undefined;
  try {
    baseSha = await runMockGit(repoPath, ["rev-parse", "HEAD"]);
  } catch {
    // Empty repo has no HEAD until the initial commit below.
  }
  if (!baseSha) {
    await writeFile(path.join(repoPath, "README.md"), "workforce mock workspace\n");
    await writeFile(path.join(repoPath, "shared.txt"), "shared-base\n");
    await runMockGit(repoPath, ["add", "-A"]);
    await runMockGit(repoPath, ["commit", "-m", "init"]);
    baseSha = await runMockGit(repoPath, ["rev-parse", "HEAD"]);
  }
  return { repoPath, baseSha };
}

export class CompositionWorktreeHost {
  readonly git: GitWorkspaceService;
  readonly repoPath: string;
  readonly worktreeRoot: string;
  readonly baseSha: string;
  private readonly gitAuthorizationRef: string;
  private readonly projectToGitWorkspace = new Map<string, string>();
  private readonly byRunKey = new Map<string, ProvisionedWorktree>();

  private constructor(input: {
    git: GitWorkspaceService;
    repoPath: string;
    worktreeRoot: string;
    baseSha: string;
    gitAuthorizationRef: string;
  }) {
    this.git = input.git;
    this.repoPath = input.repoPath;
    this.worktreeRoot = input.worktreeRoot;
    this.baseSha = input.baseSha;
    this.gitAuthorizationRef = input.gitAuthorizationRef;
  }

  static async open(options: CompositionWorktreeHostOptions): Promise<CompositionWorktreeHost> {
    const repoPath = path.join(options.stateDir, "repo");
    const worktreeRoot = path.join(options.stateDir, "wt");
    const ensured = await ensureMockGitRepository(repoPath);
    const git = new GitWorkspaceService({ worktreeRoot });
    const registered = await git.registerLocalRepository(ensured.repoPath);
    return new CompositionWorktreeHost({
      git,
      repoPath: ensured.repoPath,
      worktreeRoot,
      baseSha: ensured.baseSha,
      gitAuthorizationRef: registered.authorizationRef,
    });
  }

  async bindProject(projectId: string): Promise<{ gitWorkspaceId: string }> {
    const existing = this.projectToGitWorkspace.get(projectId);
    if (existing) {
      return { gitWorkspaceId: existing };
    }
    const binding = await this.git.bind({
      projectId,
      authorizationRef: this.gitAuthorizationRef,
    });
    this.projectToGitWorkspace.set(projectId, binding.workspaceId);
    return { gitWorkspaceId: binding.workspaceId };
  }

  async provisionForTask(input: {
    projectId: string;
    taskId: string;
    attempt: number;
    role: string;
    nodeId: string;
  }): Promise<ProvisionedWorktree> {
    const runKey = runKeyFor(input.taskId, input.attempt);
    const already = this.byRunKey.get(runKey);
    if (already) {
      return already;
    }
    const { gitWorkspaceId } = await this.bindProject(input.projectId);
    this.git.attachRun(runKey, gitWorkspaceId);
    const instance = await this.git.provisionRunWorkspace(runKey, this.baseSha);
    const worktreePath = await this.git.assertInstancePath(instance.workspaceInstanceId, ".");
    const record: ProvisionedWorktree = {
      projectId: input.projectId,
      taskId: input.taskId,
      attempt: input.attempt,
      role: input.role,
      nodeId: input.nodeId,
      gitWorkspaceId,
      workspaceInstanceId: instance.workspaceInstanceId,
      worktreePath,
      baseSha: instance.baseSha,
      runKey,
    };
    this.byRunKey.set(runKey, record);
    return record;
  }

  getForTask(taskId: string, attempt: number): ProvisionedWorktree | undefined {
    return this.byRunKey.get(runKeyFor(taskId, attempt));
  }

  listForProject(projectId: string): ProvisionedWorktree[] {
    return [...this.byRunKey.values()].filter((item) => item.projectId === projectId);
  }

  developerWorktrees(projectId: string): ProvisionedWorktree[] {
    return this.listForProject(projectId).filter((item) => item.role === "developer");
  }

  async dispose(): Promise<void> {
    const records = [...this.byRunKey.values()];
    this.byRunKey.clear();
    for (const record of records) {
      try {
        await this.git.releaseInstance(record.workspaceInstanceId, {
          requiredArtifactsPersisted: true,
        });
      } catch (error) {
        // Do not swallow: a worktree that is not released keeps Windows state dirs locked and
        // would otherwise only show up as an unexplained teardown failure.
        console.error(
          `[workforce] failed to release workspace instance ${record.workspaceInstanceId}`,
          error,
        );
      }
    }
  }
}

export function bindWorktreesToHost(input: {
  inner: RuntimeHostPort;
  worktrees: CompositionWorktreeHost;
  resolveTask: (taskId: string) => TaskRecord | undefined;
}): RuntimeHostPort {
  return {
    async start(request: StartRunHostRequest): Promise<{ handleId: string; runId: string }> {
      const task = input.resolveTask(request.taskId);
      if (task && isWorktreeRole(task.role)) {
        await input.worktrees.provisionForTask({
          projectId: task.projectId,
          taskId: task.id,
          attempt: request.attempt,
          role: task.role,
          nodeId: task.workflowNodeId ?? task.title,
        });
      }
      return input.inner.start(request);
    },
    pause: (handleId) => input.inner.pause(handleId),
    cancel: (handleId, reason) => input.inner.cancel(handleId, reason),
    inspect: (handleId) => input.inner.inspect(handleId),
  };
}
