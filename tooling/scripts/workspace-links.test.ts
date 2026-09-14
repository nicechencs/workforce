import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  findMissingWorkspaceLinks,
  isWorkspaceDepLinked,
  listWorkspacePackageDirs,
  workspaceDependencyNames,
  workspaceInstallReason,
} from "./workspace-links.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-workspace-links-"));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n  - "apps/*"\n',
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"workforce","private":true}\n', "utf8");
  return dir;
}

function writePackage(root: string, relDir: string, pkg: unknown): string {
  const dir = path.join(root, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return dir;
}

describe("workspace-links", () => {
  it("lists workspace package dirs from pnpm-workspace.yaml globs", () => {
    const root = fixtureRoot();
    writePackage(root, "packages/artifacts", { name: "@workforce/artifacts" });
    writePackage(root, "apps/daemon", { name: "@workforce/daemon" });
    fs.mkdirSync(path.join(root, "packages", "not-a-package"));
    const dirs = listWorkspacePackageDirs(root).map((dir) =>
      path.relative(root, dir).split(path.sep).join("/"),
    );
    expect(dirs).toEqual(["apps/daemon", "packages/artifacts"]);
  });

  it("reads workspace:* from dependencies and devDependencies only", () => {
    expect(
      workspaceDependencyNames({
        dependencies: { "@workforce/process": "workspace:*", leftpad: "1.0.0" },
        devDependencies: { "@workforce/testkit": "workspace:^" },
        optionalDependencies: { "@workforce/ui": "workspace:*" },
        peerDependencies: { "@workforce/protocol": "workspace:*" },
      }),
    ).toEqual(["@workforce/process", "@workforce/testkit"]);
  });

  it("walks node_modules the same way Node resolves from the importer", () => {
    const root = fixtureRoot();
    const artifacts = writePackage(root, "packages/artifacts", {
      name: "@workforce/artifacts",
      dependencies: { "@workforce/process": "workspace:*" },
    });
    expect(isWorkspaceDepLinked(artifacts, "@workforce/process", root)).toBe(false);
    fs.mkdirSync(path.join(artifacts, "node_modules", "@workforce", "process"), {
      recursive: true,
    });
    expect(isWorkspaceDepLinked(artifacts, "@workforce/process", root)).toBe(true);
  });

  it("reports missing workspace links and the matching install reason", () => {
    const root = fixtureRoot();
    writePackage(root, "packages/artifacts", {
      name: "@workforce/artifacts",
      dependencies: { "@workforce/process": "workspace:*" },
    });
    writePackage(root, "packages/process", { name: "@workforce/process" });
    fs.mkdirSync(path.join(root, "node_modules"));

    expect(findMissingWorkspaceLinks(root)).toEqual([
      { packageDir: "packages/artifacts", dependency: "@workforce/process" },
    ]);
    expect(workspaceInstallReason(root)).toBe("workspace links incomplete");

    fs.mkdirSync(path.join(root, "packages", "artifacts", "node_modules", "@workforce", "process"), {
      recursive: true,
    });
    expect(findMissingWorkspaceLinks(root)).toEqual([]);
    expect(workspaceInstallReason(root)).toBeNull();
  });

  it("treats a missing root node_modules or --install as an install reason", () => {
    const root = fixtureRoot();
    expect(workspaceInstallReason(root)).toBe("node_modules missing");
    fs.mkdirSync(path.join(root, "node_modules"));
    expect(workspaceInstallReason(root, { force: true })).toBe("forced");
  });

  it("finds no missing workspace links in this checkout after install", () => {
    expect(findMissingWorkspaceLinks(repoRoot)).toEqual([]);
    expect(workspaceInstallReason(repoRoot)).toBeNull();
  });
});
