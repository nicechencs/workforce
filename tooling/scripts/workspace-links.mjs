/**
 * Detect stale pnpm workspace links. Root `node_modules` can exist while a
 * package.json `workspace:*` dependency was added later and never linked.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const WORKSPACE_DEP_FIELDS = ["dependencies", "devDependencies"];

export function readWorkspaceGlobs(root) {
  const file = path.join(root, "pnpm-workspace.yaml");
  const text = readFileSync(file, "utf8");
  const globs = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*-\s*["']([^"']+)["']\s*$/.exec(line);
    if (match) {
      globs.push(match[1]);
    }
  }
  return globs;
}

export function listWorkspacePackageDirs(root) {
  const dirs = [];
  for (const glob of readWorkspaceGlobs(root)) {
    if (glob.endsWith("/*")) {
      const parent = path.join(root, glob.slice(0, -2));
      if (!existsSync(parent)) {
        continue;
      }
      for (const name of readdirSync(parent)) {
        const dir = path.join(parent, name);
        if (isPackageDir(dir)) {
          dirs.push(dir);
        }
      }
    } else {
      const dir = path.join(root, glob);
      if (isPackageDir(dir)) {
        dirs.push(dir);
      }
    }
  }
  return dirs.sort();
}

export function workspaceDependencyNames(pkg) {
  const names = [];
  for (const field of WORKSPACE_DEP_FIELDS) {
    const block = pkg[field];
    if (!block || typeof block !== "object") {
      continue;
    }
    for (const [name, spec] of Object.entries(block)) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        names.push(name);
      }
    }
  }
  return names;
}

/** Same upward `node_modules` walk Node uses for a file inside `fromDir`. */
export function isWorkspaceDepLinked(fromDir, depName, root) {
  const parts = depName.split("/");
  let dir = fromDir;
  while (true) {
    if (existsSync(path.join(dir, "node_modules", ...parts))) {
      return true;
    }
    if (path.resolve(dir) === path.resolve(root)) {
      return false;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return false;
    }
    dir = parent;
  }
}

export function findMissingWorkspaceLinks(root) {
  const missing = [];
  for (const dir of listWorkspacePackageDirs(root)) {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    for (const dependency of workspaceDependencyNames(pkg)) {
      if (!isWorkspaceDepLinked(dir, dependency, root)) {
        missing.push({
          packageDir: path.relative(root, dir).split(path.sep).join("/"),
          dependency,
        });
      }
    }
  }
  return missing;
}

export function workspaceInstallReason(root, { force = false } = {}) {
  if (force) {
    return "forced";
  }
  if (!existsSync(path.join(root, "node_modules"))) {
    return "node_modules missing";
  }
  if (findMissingWorkspaceLinks(root).length > 0) {
    return "workspace links incomplete";
  }
  return null;
}

function isPackageDir(dir) {
  try {
    return statSync(dir).isDirectory() && existsSync(path.join(dir, "package.json"));
  } catch {
    return false;
  }
}
