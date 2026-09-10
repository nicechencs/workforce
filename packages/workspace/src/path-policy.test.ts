import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  UNTESTED_WORKSPACE_PLATFORMS,
  assertPathInside,
  isInside,
  normalizePath,
} from "./path-policy.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  const dirs = tmpDirs.splice(0, tmpDirs.length);
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })),
  );
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wf-pp-"));
  tmpDirs.push(dir);
  return dir;
}

describe("UNTESTED_WORKSPACE_PLATFORMS", () => {
  it("documents macOS and Linux as untested", () => {
    expect(UNTESTED_WORKSPACE_PLATFORMS).toEqual(["darwin", "linux"]);
  });
});

describe("normalizePath", () => {
  it("strips trailing separators except the filesystem root", () => {
    const rooted = path.join(os.tmpdir(), "wf-foo");
    expect(normalizePath(rooted + path.sep)).toBe(normalizePath(rooted));
    expect(normalizePath(path.parse(rooted).root)).toBe(normalizePath(path.parse(rooted).root));
  });

  it("treats forward and back slashes as equivalent", () => {
    const mixed = os.tmpdir().replace(/[\\/]/gu, "/") + "/wf-slash/child";
    const system = path.join(os.tmpdir(), "wf-slash", "child");
    expect(normalizePath(mixed)).toBe(normalizePath(system));
  });
});

describe("isInside", () => {
  it("accepts the root and descendants, not sibling prefixes", () => {
    const root = path.join(os.tmpdir(), "wf-foo");
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, path.join(root, "bar"))).toBe(true);
    expect(isInside(root, path.join(os.tmpdir(), "wf-foobar"))).toBe(false);
  });

  it("rejects parent-directory escapes after normalization", () => {
    const root = path.join(os.tmpdir(), "wf-foo");
    expect(isInside(root, path.join(root, "..", "other"))).toBe(false);
  });
});

describe("assertPathInside", () => {
  it("returns the resolved path for an existing descendant", async () => {
    const dir = await tempDir();
    const child = path.join(dir, "child");
    await mkdir(child);
    await writeFile(path.join(child, "a.txt"), "ok");
    const resolved = await assertPathInside(dir, path.join(child, "a.txt"));
    expect(isInside(dir, resolved)).toBe(true);
    expect(normalizePath(resolved)).toBe(normalizePath(path.join(child, "a.txt")));
  });

  it("allows a relative path that stays inside a not-yet-created child", async () => {
    const dir = await tempDir();
    const planned = await assertPathInside(dir, "new-wt");
    expect(isInside(dir, planned)).toBe(true);
  });

  it("rejects a candidate that resolves outside the root", async () => {
    const dir = await tempDir();
    await expect(assertPathInside(dir, path.join(dir, "..", "outside.txt"))).rejects.toThrow(
      /outside workspace/i,
    );
  });
});

describe.skipIf(process.platform !== "win32")("Windows path policy", () => {
  it("folds drive letter and path case", () => {
    expect(normalizePath("C:/Users/Example")).toBe(normalizePath("c:\\users\\example"));
    expect(isInside("C:\\Foo", "c:\\foo\\Bar")).toBe(true);
  });

  it("rejects a junction pointing outside the workspace", async () => {
    const dir = await tempDir();
    const root = path.join(dir, "root");
    const outside = path.join(dir, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "junc"), "junction");
    await expect(assertPathInside(root, path.join(root, "junc", "secret.txt"))).rejects.toThrow(
      /symlink or junction/i,
    );
  });
});
