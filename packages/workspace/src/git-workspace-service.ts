import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  Clock,
  DiffArtifactProposal,
  IdGenerator,
  WorkspaceBinding,
  WorkspaceInstance,
  WorkspaceService,
} from "@workforce/application";
import { ID_PREFIX } from "@workforce/domain";

import { WorkspaceError } from "./errors.js";
import { gitPathToSystem, runGit, toGitPath } from "./git.js";
import { assertPathInside, normalizePath } from "./path-policy.js";

const MAX_WORKTREE_PATH_LENGTH = 200;

export class RandomUuidIdGenerator implements IdGenerator {
  ulid(prefix: string): string {
    return `${prefix}${randomUUID().replaceAll("-", "")}`;
  }
}

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface GitWorkspaceServiceOptions {
  clock?: Clock;
  ids?: IdGenerator;
  worktreeRoot?: string;
}

interface RegisteredRepo {
  authorizationRef: string;
  repoPath: string;
}

interface BoundWorkspace {
  workspaceId: string;
  projectId: string;
  authorizationRef: string;
  createdAt: Date;
}

interface InstanceRecord {
  workspaceInstanceId: string;
  workspaceId: string;
  repoPath: string;
  worktreePath: string;
  gitdirPath: string;
  metadataName: string;
  branch: string;
  baseSha: string;
  ignoreCase: boolean;
  createdAt: Date;
}

function sanitizeRefSegment(value: string): string {
  if (
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("\\") ||
    /[\s~^:?*[\]]/u.test(value)
  ) {
    throw new WorkspaceError(`invalid git ref segment: ${value}`);
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(value)) {
    throw new WorkspaceError(`invalid git ref segment: ${value}`);
  }
  return value;
}

function shortDirName(instanceId: string): string {
  const compact = instanceId.replace(/[^a-zA-Z0-9]/gu, "");
  if (compact.length >= 12) {
    return compact.slice(0, 12);
  }
  return compact.length > 0 ? compact : "wt";
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export class GitWorkspaceService implements WorkspaceService {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly worktreeRoot: string;
  private readonly repos = new Map<string, RegisteredRepo>();
  private readonly byWorkspaceId = new Map<string, BoundWorkspace>();
  private readonly byProjectId = new Map<string, string[]>();
  private readonly runToWorkspace = new Map<string, string>();
  private readonly instances = new Map<string, InstanceRecord>();

  constructor(options: GitWorkspaceServiceOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new RandomUuidIdGenerator();
    this.worktreeRoot = path.resolve(options.worktreeRoot ?? path.join(os.tmpdir(), "wf-wt"));
  }

  async registerLocalRepository(repoPath: string): Promise<{ authorizationRef: string }> {
    let real: string;
    try {
      real = await realpath(repoPath);
    } catch (err) {
      throw new WorkspaceError(`repository path does not exist: ${repoPath}`, { cause: err });
    }

    const st = await stat(real);
    if (!st.isDirectory()) {
      throw new WorkspaceError("repository path is not a directory");
    }

    const probe = await runGit(["rev-parse", "--is-inside-work-tree"], {
      cwd: real,
      allowExitCodes: [0, 128],
    });
    if (probe.exitCode !== 0 || probe.stdout.trim() !== "true") {
      throw new WorkspaceError("not a git repository");
    }

    const topRaw = (await runGit(["rev-parse", "--show-toplevel"], { cwd: real })).stdout.trim();
    const top = await realpath(gitPathToSystem(topRaw));
    const topNorm = normalizePath(top);

    for (const registered of this.repos.values()) {
      if (normalizePath(registered.repoPath) === topNorm) {
        return { authorizationRef: registered.authorizationRef };
      }
    }

    const authorizationRef = this.ids.ulid("aref_");
    this.repos.set(authorizationRef, { authorizationRef, repoPath: top });
    return { authorizationRef };
  }

  async bind(input: { projectId: string; authorizationRef: string }): Promise<WorkspaceBinding> {
    if (!this.repos.has(input.authorizationRef)) {
      throw new WorkspaceError("unknown authorizationRef");
    }
    const workspaceId = this.ids.ulid(ID_PREFIX.workspace);
    const binding: BoundWorkspace = {
      workspaceId,
      projectId: input.projectId,
      authorizationRef: input.authorizationRef,
      createdAt: this.clock.now(),
    };
    this.byWorkspaceId.set(workspaceId, binding);
    const existing = this.byProjectId.get(input.projectId);
    if (existing) {
      existing.push(workspaceId);
    } else {
      this.byProjectId.set(input.projectId, [workspaceId]);
    }
    return { workspaceId, authorizationRef: input.authorizationRef };
  }

  attachRun(runId: string, workspaceId: string): void {
    if (!this.byWorkspaceId.has(workspaceId)) {
      throw new WorkspaceError(`unknown workspace: ${workspaceId}`);
    }
    this.runToWorkspace.set(runId, workspaceId);
  }

  async provisionRunWorkspace(runId: string, baseSha: string): Promise<WorkspaceInstance> {
    const workspaceId = this.resolveWorkspaceId(runId);
    const branch = `workforce/run/${sanitizeRefSegment(runId)}`;
    return this.provisionWorktree({ workspaceId, branch, baseSha });
  }

  async provisionIntegrationWorkspace(input: {
    taskId: string;
    workspaceId: string;
    baseSha: string;
  }): Promise<WorkspaceInstance> {
    const branch = `workforce/integration/${sanitizeRefSegment(input.taskId)}`;
    return this.provisionWorktree({
      workspaceId: input.workspaceId,
      branch,
      baseSha: input.baseSha,
    });
  }

  async captureDiff(instanceId: string): Promise<DiffArtifactProposal> {
    const rec = this.requireInstance(instanceId);
    const indexDir = await mkdtemp(path.join(os.tmpdir(), "wf-idx-"));
    const indexFile = path.join(indexDir, "index");
    const indexEnv: NodeJS.ProcessEnv = { GIT_INDEX_FILE: toGitPath(indexFile) };
    try {
      await runGit(["read-tree", rec.baseSha], { cwd: rec.worktreePath, env: indexEnv });
      await runGit(["add", "-A"], { cwd: rec.worktreePath, env: indexEnv });
      const diff = await runGit(["diff", "--cached", "--binary", "--no-color"], {
        cwd: rec.worktreePath,
        env: indexEnv,
      });
      const names = await runGit(["diff", "--cached", "--name-only", "--no-color"], {
        cwd: rec.worktreePath,
        env: indexEnv,
      });
      const changedPaths = names.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return { baseSha: rec.baseSha, patch: diff.stdout, changedPaths };
    } finally {
      await rm(indexDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  async applyPatch(instanceId: string, patch: string): Promise<void> {
    const rec = this.requireInstance(instanceId);
    const dir = await mkdtemp(path.join(os.tmpdir(), "wf-patch-"));
    const file = path.join(dir, "p.diff");
    try {
      await writeFile(file, patch);
      await runGit(["apply", "--binary", "--", file], { cwd: rec.worktreePath });
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  async assertInstancePath(instanceId: string, targetPath: string): Promise<string> {
    const rec = this.requireInstance(instanceId);
    return assertPathInside(rec.worktreePath, targetPath);
  }

  async releaseInstance(
    instanceId: string,
    opts: { requiredArtifactsPersisted: boolean },
  ): Promise<void> {
    if (!opts.requiredArtifactsPersisted) {
      throw new WorkspaceError(
        `refusing to release instance ${instanceId}: required artifacts not persisted`,
      );
    }
    const rec = this.requireInstance(instanceId);

    await runGit(["worktree", "unlock", "--", rec.worktreePath], {
      cwd: rec.repoPath,
      allowExitCodes: [0, 128],
    });

    const removed = await runGit(["worktree", "remove", "--force", "--", rec.worktreePath], {
      cwd: rec.repoPath,
      allowExitCodes: [0, 128, 255],
    });

    if (removed.exitCode !== 0) {
      const registered = await this.isWorktreeRegistered(rec);
      if (!registered && (await pathExists(rec.worktreePath))) {
        await rm(rec.worktreePath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    }

    await runGit(["worktree", "prune"], {
      cwd: rec.repoPath,
      allowExitCodes: [0, 128],
    });

    if (await pathExists(rec.worktreePath)) {
      throw new WorkspaceError(
        `worktree directory still exists after release: ${rec.worktreePath}`,
      );
    }

    this.instances.delete(instanceId);
  }

  private resolveWorkspaceId(runId: string): string {
    const attached = this.runToWorkspace.get(runId);
    if (attached !== undefined) {
      return attached;
    }
    const all = [...this.byWorkspaceId.keys()];
    const only = all[0];
    if (all.length === 1 && only !== undefined) {
      return only;
    }
    if (all.length === 0) {
      throw new WorkspaceError(`no workspace bound for run ${runId}`);
    }
    throw new WorkspaceError(
      `run ${runId} is not attached and ${all.length} workspaces are bound; call attachRun`,
    );
  }

  private requireInstance(instanceId: string): InstanceRecord {
    const rec = this.instances.get(instanceId);
    if (!rec) {
      throw new WorkspaceError(`unknown workspace instance: ${instanceId}`);
    }
    return rec;
  }

  private async isWorktreeRegistered(rec: InstanceRecord): Promise<boolean> {
    const listed = await runGit(["worktree", "list", "--porcelain"], { cwd: rec.repoPath });
    const target = normalizePath(rec.worktreePath);
    for (const line of listed.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        const listedPath = normalizePath(gitPathToSystem(line.slice("worktree ".length)));
        if (listedPath === target) {
          return true;
        }
      }
    }
    return false;
  }

  private async provisionWorktree(input: {
    workspaceId: string;
    branch: string;
    baseSha: string;
  }): Promise<WorkspaceInstance> {
    const binding = this.byWorkspaceId.get(input.workspaceId);
    if (!binding) {
      throw new WorkspaceError(`unknown workspace: ${input.workspaceId}`);
    }
    const repo = this.repos.get(binding.authorizationRef);
    if (!repo) {
      throw new WorkspaceError(`repository missing for workspace ${input.workspaceId}`);
    }

    const workspaceInstanceId = this.ids.ulid(ID_PREFIX.workspaceInstance);
    const dirName = shortDirName(workspaceInstanceId);
    const plannedRoot = this.worktreeRoot;
    const plannedPath = path.join(plannedRoot, dirName);
    if (plannedPath.length >= MAX_WORKTREE_PATH_LENGTH) {
      throw new WorkspaceError(
        `worktree path length ${plannedPath.length} exceeds budget of ${MAX_WORKTREE_PATH_LENGTH} characters (including room for .git)`,
      );
    }

    await mkdir(plannedRoot, { recursive: true });
    const rootReal = await realpath(plannedRoot);
    const worktreePath = path.join(rootReal, dirName);
    if (worktreePath.length >= MAX_WORKTREE_PATH_LENGTH) {
      throw new WorkspaceError(
        `worktree path length ${worktreePath.length} exceeds budget of ${MAX_WORKTREE_PATH_LENGTH} characters (including room for .git)`,
      );
    }
    await assertPathInside(rootReal, worktreePath);

    let created = false;
    try {
      await runGit(["worktree", "add", "-b", input.branch, "--", worktreePath, input.baseSha], {
        cwd: repo.repoPath,
      });
      created = true;
      await runGit(
        [
          "worktree",
          "lock",
          "--reason",
          `artifact-pending:${workspaceInstanceId}`,
          "--",
          worktreePath,
        ],
        { cwd: repo.repoPath },
      );

      const gitdirRaw = (
        await runGit(["rev-parse", "--absolute-git-dir"], { cwd: worktreePath })
      ).stdout.trim();
      const gitdirPath = gitPathToSystem(gitdirRaw);
      const metadataName = path.basename(gitdirPath);

      let ignoreCase = process.platform === "win32";
      const cfg = await runGit(["config", "--bool", "--get", "core.ignoreCase"], {
        cwd: worktreePath,
        allowExitCodes: [0, 1],
      });
      if (cfg.exitCode === 0) {
        ignoreCase = cfg.stdout.trim() === "true";
      }

      const resolved = await realpath(worktreePath);
      await assertPathInside(rootReal, resolved);

      this.instances.set(workspaceInstanceId, {
        workspaceInstanceId,
        workspaceId: input.workspaceId,
        repoPath: repo.repoPath,
        worktreePath: resolved,
        gitdirPath,
        metadataName,
        branch: input.branch,
        baseSha: input.baseSha,
        ignoreCase,
        createdAt: this.clock.now(),
      });

      return { workspaceInstanceId, baseSha: input.baseSha };
    } catch (err) {
      if (created) {
        await runGit(["worktree", "unlock", "--", worktreePath], {
          cwd: repo.repoPath,
          allowExitCodes: [0, 128],
        }).catch(() => undefined);
        await runGit(["worktree", "remove", "--force", "--", worktreePath], {
          cwd: repo.repoPath,
          allowExitCodes: [0, 128, 255],
        }).catch(() => undefined);
        await runGit(["worktree", "prune"], {
          cwd: repo.repoPath,
          allowExitCodes: [0, 128],
        }).catch(() => undefined);
        if (await pathExists(worktreePath)) {
          await rm(worktreePath, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          }).catch(() => undefined);
        }
      }
      throw err;
    }
  }
}
