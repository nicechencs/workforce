import { execFile } from "node:child_process";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { RuntimeHostPort, StartRunHostRequest, TaskRecord } from "@workforce/application";
import { GitWorkspaceService, WorkspaceError } from "@workforce/workspace";

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

export const WORKSPACE_GRANTS_FILENAME = "workspace-grants.json";

export function workspaceGrantsFile(stateDir: string): string {
  return path.join(stateDir, WORKSPACE_GRANTS_FILENAME);
}

export function isDesktopWorkspaceGrant(authorizationRef: string): boolean {
  return authorizationRef.startsWith("wsauth_");
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

/** Init or reuse a git repo at a user-selected directory. Does not invent mock fixture files when the tree already has content. */
export async function ensureUserGitRepository(
  repoPath: string,
): Promise<{ repoPath: string; baseSha: string }> {
  const resolved = path.resolve(repoPath);
  await mkdir(resolved, { recursive: true });
  try {
    const inside = await runMockGit(resolved, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") {
      throw new Error("not a work tree");
    }
  } catch {
    await runMockGit(resolved, ["init", "-b", "main"]);
    await runMockGit(resolved, ["config", "user.name", MOCK_GIT_NAME]);
    await runMockGit(resolved, ["config", "user.email", MOCK_GIT_EMAIL]);
  }
  let baseSha: string | undefined;
  try {
    baseSha = await runMockGit(resolved, ["rev-parse", "HEAD"]);
  } catch {
    // Empty repo has no HEAD until the initial commit below.
  }
  if (!baseSha) {
    const entries = fs.readdirSync(resolved).filter((name) => name !== ".git");
    if (entries.length === 0) {
      await writeFile(path.join(resolved, "README.md"), "workforce workspace\n");
    }
    await runMockGit(resolved, ["add", "-A"]);
    await runMockGit(resolved, ["commit", "-m", "init", "--allow-empty"]);
    baseSha = await runMockGit(resolved, ["rev-parse", "HEAD"]);
  }
  return { repoPath: resolved, baseSha };
}

interface ProjectGitBinding {
  gitWorkspaceId: string;
  baseSha: string;
  hostGrantRef?: string;
}

export class CompositionWorktreeHost {
  readonly git: GitWorkspaceService;
  readonly repoPath: string;
  readonly worktreeRoot: string;
  readonly baseSha: string;
  private readonly gitAuthorizationRef: string;
  private readonly grantsFile: string;
  private readonly hostGrants = new Map<string, string>();
  private readonly projectBindings = new Map<string, ProjectGitBinding>();
  private readonly projectToGitWorkspace = new Map<string, string>();
  private readonly byRunKey = new Map<string, ProvisionedWorktree>();

  private constructor(input: {
    git: GitWorkspaceService;
    repoPath: string;
    worktreeRoot: string;
    baseSha: string;
    gitAuthorizationRef: string;
    grantsFile: string;
  }) {
    this.git = input.git;
    this.repoPath = input.repoPath;
    this.worktreeRoot = input.worktreeRoot;
    this.baseSha = input.baseSha;
    this.gitAuthorizationRef = input.gitAuthorizationRef;
    this.grantsFile = input.grantsFile;
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
      grantsFile: workspaceGrantsFile(options.stateDir),
    });
  }

  registerHostGrant(authorizationRef: string, hostPath: string): void {
    this.hostGrants.set(authorizationRef, path.resolve(hostPath));
  }

  resolveGrant(authorizationRef: string): string | undefined {
    const remembered = this.hostGrants.get(authorizationRef);
    if (remembered) {
      return remembered;
    }
    const persisted = readPersistedGrant(this.grantsFile, authorizationRef);
    if (persisted) {
      this.hostGrants.set(authorizationRef, persisted);
    }
    return persisted;
  }

  baseShaFor(projectId: string): string {
    return this.projectBindings.get(projectId)?.baseSha ?? this.baseSha;
  }

  async bindProject(
    projectId: string,
    authorizationRef?: string,
  ): Promise<{ gitWorkspaceId: string }> {
    if (authorizationRef) {
      const hostPath = this.resolveGrant(authorizationRef);
      if (hostPath) {
        return this.bindUserRepo(projectId, authorizationRef, hostPath);
      }
      if (isDesktopWorkspaceGrant(authorizationRef)) {
        throw new WorkspaceError("unknown authorizationRef");
      }
    }
    const existing = this.projectToGitWorkspace.get(projectId);
    if (existing) {
      return { gitWorkspaceId: existing };
    }
    const binding = await this.git.bind({
      projectId,
      authorizationRef: this.gitAuthorizationRef,
    });
    this.projectToGitWorkspace.set(projectId, binding.workspaceId);
    this.projectBindings.set(projectId, {
      gitWorkspaceId: binding.workspaceId,
      baseSha: this.baseSha,
    });
    return { gitWorkspaceId: binding.workspaceId };
  }

  private async bindUserRepo(
    projectId: string,
    authorizationRef: string,
    hostPath: string,
  ): Promise<{ gitWorkspaceId: string }> {
    const already = this.projectBindings.get(projectId);
    if (already?.hostGrantRef === authorizationRef) {
      return { gitWorkspaceId: already.gitWorkspaceId };
    }
    const ensured = await ensureUserGitRepository(hostPath);
    const registered = await this.git.registerLocalRepository(ensured.repoPath);
    const binding = await this.git.bind({
      projectId,
      authorizationRef: registered.authorizationRef,
    });
    this.projectToGitWorkspace.set(projectId, binding.workspaceId);
    this.projectBindings.set(projectId, {
      gitWorkspaceId: binding.workspaceId,
      baseSha: ensured.baseSha,
      hostGrantRef: authorizationRef,
    });
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
    const instance = await this.git.provisionRunWorkspace(runKey, this.baseShaFor(input.projectId));
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

  projectCwd(projectId: string): string {
    const binding = this.projectBindings.get(projectId);
    if (binding?.hostGrantRef) {
      const hostPath = this.resolveGrant(binding.hostGrantRef);
      if (hostPath) {
        return hostPath;
      }
    }
    return this.repoPath;
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
  const port: RuntimeHostPort = {
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
  if (input.inner.ensureNodeSession) {
    port.ensureNodeSession = () => input.inner.ensureNodeSession!();
  }
  return port;
}

function readPersistedGrant(file: string, authorizationRef: string): string | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as { grants?: unknown };
  const grants = record.grants;
  if (grants === null || typeof grants !== "object" || Array.isArray(grants)) {
    return undefined;
  }
  const value = (grants as Record<string, unknown>)[authorizationRef];
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\")) {
    return path.resolve(value);
  }
  return undefined;
}
