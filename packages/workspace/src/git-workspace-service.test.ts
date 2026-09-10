import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspaceService } from "./git-workspace-service.js";
import { UNTESTED_WORKSPACE_PLATFORMS } from "./path-policy.js";

const execFileAsync = promisify(execFile);

function gitIsAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const gitOk = gitIsAvailable();

const GIT_TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "workspace-test",
  GIT_AUTHOR_EMAIL: "workspace-test@example.invalid",
  GIT_COMMITTER_NAME: "workspace-test",
  GIT_COMMITTER_EMAIL: "workspace-test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  LANG: "C",
};

interface Harness {
  tmpDir: string;
  repo: string;
  svc: GitWorkspaceService;
  instanceIds: string[];
}

const harnesses: Harness[] = [];

async function gitIn(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-c", "core.hooksPath=", ...args], {
    cwd,
    env: GIT_TEST_ENV,
    encoding: "utf8",
    windowsHide: true,
  });
  return String(stdout).replace(/\r\n/gu, "\n").trim();
}

async function createHarness(): Promise<Harness> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "wf-t06-"));
  const repo = path.join(tmpDir, "repo");
  await mkdir(repo);
  await gitIn(repo, ["init", "-b", "main"]);
  await gitIn(repo, ["config", "user.name", "workspace-test"]);
  await gitIn(repo, ["config", "user.email", "workspace-test@example.invalid"]);
  await writeFile(path.join(repo, "README.md"), "committed-v1");
  await writeFile(path.join(repo, "shared.txt"), "shared-base");
  await gitIn(repo, ["add", "-A"]);
  await gitIn(repo, ["commit", "-m", "init"]);
  const svc = new GitWorkspaceService({ worktreeRoot: path.join(tmpDir, "wt") });
  const harness: Harness = { tmpDir, repo, svc, instanceIds: [] };
  harnesses.push(harness);
  return harness;
}

async function bindRepo(h: Harness): Promise<{
  authorizationRef: string;
  workspaceId: string;
  baseSha: string;
}> {
  const { authorizationRef } = await h.svc.registerLocalRepository(h.repo);
  expect(authorizationRef).not.toContain(h.repo);
  expect(authorizationRef).not.toMatch(/^[A-Za-z]:[\\/]/u);
  const binding = await h.svc.bind({ projectId: "prj_test", authorizationRef });
  const baseSha = await gitIn(h.repo, ["rev-parse", "HEAD"]);
  return { authorizationRef, workspaceId: binding.workspaceId, baseSha };
}

afterEach(async () => {
  const pending = harnesses.splice(0, harnesses.length);
  for (const h of pending) {
    for (const id of h.instanceIds) {
      try {
        await h.svc.releaseInstance(id, { requiredArtifactsPersisted: true });
      } catch {
        // directory removal below is the fallback
      }
    }
    await rm(h.tmpDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

describe("GitWorkspaceService platforms", () => {
  it("documents macOS and Linux as untested", () => {
    expect(UNTESTED_WORKSPACE_PLATFORMS).toEqual(["darwin", "linux"]);
  });
});

describe.skipIf(!gitOk)("GitWorkspaceService", () => {
  it("provisions two concurrent worktrees that do not share a writable directory", async () => {
    const h = await createHarness();
    const { workspaceId, baseSha } = await bindRepo(h);
    h.svc.attachRun("run_a", workspaceId);
    h.svc.attachRun("run_b", workspaceId);

    const [a, b] = await Promise.all([
      h.svc.provisionRunWorkspace("run_a", baseSha),
      h.svc.provisionRunWorkspace("run_b", baseSha),
    ]);
    h.instanceIds.push(a.workspaceInstanceId, b.workspaceInstanceId);

    const wtA = await h.svc.assertInstancePath(a.workspaceInstanceId, ".");
    const wtB = await h.svc.assertInstancePath(b.workspaceInstanceId, ".");
    const realA = await realpath(wtA);
    const realB = await realpath(wtB);
    expect(realA).not.toBe(realB);

    await writeFile(path.join(wtA, "shared.txt"), "edited-in-a");
    await writeFile(path.join(wtB, "shared.txt"), "edited-in-b");

    expect(await readFile(path.join(wtA, "shared.txt"), "utf8")).toBe("edited-in-a");
    expect(await readFile(path.join(wtB, "shared.txt"), "utf8")).toBe("edited-in-b");
    expect(await readFile(path.join(h.repo, "shared.txt"), "utf8")).toBe("shared-base");
  });

  it("does not leak dirty or untracked main files into a new worktree", async () => {
    const h = await createHarness();
    const { workspaceId, baseSha } = await bindRepo(h);
    await writeFile(path.join(h.repo, "README.md"), "dirty-main");
    await writeFile(path.join(h.repo, "untracked-only.txt"), "not-committed");

    h.svc.attachRun("run_dirty", workspaceId);
    const inst = await h.svc.provisionRunWorkspace("run_dirty", baseSha);
    h.instanceIds.push(inst.workspaceInstanceId);

    const wt = await h.svc.assertInstancePath(inst.workspaceInstanceId, ".");
    expect(await readFile(path.join(wt, "README.md"), "utf8")).toBe("committed-v1");
    await expect(readFile(path.join(wt, "untracked-only.txt"), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(h.repo, "README.md"), "utf8")).toBe("dirty-main");
    expect(await readFile(path.join(h.repo, "untracked-only.txt"), "utf8")).toBe("not-committed");
  });

  it("refuses releaseInstance without persisted artifacts and removes the worktree when confirmed", async () => {
    const h = await createHarness();
    const { workspaceId, baseSha } = await bindRepo(h);
    h.svc.attachRun("run_rel", workspaceId);
    const inst = await h.svc.provisionRunWorkspace("run_rel", baseSha);
    const wt = await h.svc.assertInstancePath(inst.workspaceInstanceId, ".");

    await expect(
      h.svc.releaseInstance(inst.workspaceInstanceId, { requiredArtifactsPersisted: false }),
    ).rejects.toThrow(/required artifacts not persisted/i);
    expect(await readFile(path.join(wt, "README.md"), "utf8")).toBe("committed-v1");

    await h.svc.releaseInstance(inst.workspaceInstanceId, { requiredArtifactsPersisted: true });
    await expect(readFile(path.join(wt, "README.md"), "utf8")).rejects.toThrow();
  });

  it("rejects a computed worktree path of length >= 200 before invoking git", async () => {
    const h = await createHarness();
    const longRoot = path.join(h.tmpDir, "p".repeat(200));
    const longSvc = new GitWorkspaceService({ worktreeRoot: longRoot });
    const { authorizationRef } = await longSvc.registerLocalRepository(h.repo);
    const binding = await longSvc.bind({ projectId: "prj_long", authorizationRef });
    longSvc.attachRun("run_long", binding.workspaceId);
    const baseSha = await gitIn(h.repo, ["rev-parse", "HEAD"]);
    await expect(longSvc.provisionRunWorkspace("run_long", baseSha)).rejects.toThrow(/200/);
  });

  it("captures tracked diffs and untracked files without committing", async () => {
    const h = await createHarness();
    const { workspaceId, baseSha } = await bindRepo(h);
    h.svc.attachRun("run_diff", workspaceId);
    const inst = await h.svc.provisionRunWorkspace("run_diff", baseSha);
    h.instanceIds.push(inst.workspaceInstanceId);
    const wt = await h.svc.assertInstancePath(inst.workspaceInstanceId, ".");

    await writeFile(path.join(wt, "README.md"), "edited-in-wt");
    await writeFile(path.join(wt, "new-untracked.txt"), "fresh");

    const diff = await h.svc.captureDiff(inst.workspaceInstanceId);
    expect(diff.baseSha).toBe(baseSha);
    expect(diff.changedPaths).toEqual(expect.arrayContaining(["README.md", "new-untracked.txt"]));
    expect(diff.patch).toMatch(/README\.md/);
    expect(diff.patch).toMatch(/new-untracked\.txt/);

    const head = await gitIn(wt, ["rev-parse", "HEAD"]);
    expect(head).toBe(baseSha);
    expect(await readFile(path.join(h.repo, "README.md"), "utf8")).toBe("committed-v1");
  });

  it("provisions an integration worktree on a dedicated branch", async () => {
    const h = await createHarness();
    const { workspaceId, baseSha } = await bindRepo(h);
    const inst = await h.svc.provisionIntegrationWorkspace({
      taskId: "tsk_1",
      workspaceId,
      baseSha,
    });
    h.instanceIds.push(inst.workspaceInstanceId);
    const wt = await h.svc.assertInstancePath(inst.workspaceInstanceId, ".");
    expect(await gitIn(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "workforce/integration/tsk_1",
    );
  });
});
