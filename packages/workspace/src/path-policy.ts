import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { WorkspaceError } from "./errors.js";

/** Platforms where worktree/junction/lock behavior has not been measured. */
export const UNTESTED_WORKSPACE_PLATFORMS = ["darwin", "linux"] as const;

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Normalize path strings for comparison: slash direction, Windows drive/case fold,
 * and trailing separators (except filesystem roots).
 */
export function normalizePath(input: string): string {
  let p = input.replace(/[\\/]+/g, path.sep);
  p = path.normalize(p);

  if (process.platform === "win32") {
    p = p.toLowerCase();
  }

  const root = path.parse(p).root;
  if (p !== root) {
    p = p.replace(/[\\/]+$/u, "");
  }
  return p;
}

/** True if `candidate` is `root` or a descendant, after {@link normalizePath}. */
export function isInside(root: string, candidate: string): boolean {
  const r = normalizePath(root);
  const c = normalizePath(candidate);
  if (c === r) {
    return true;
  }
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(prefix);
}

function splitAbsolute(absPath: string): { root: string; parts: string[] } {
  const parsed = path.parse(absPath);
  const dirAfterRoot = parsed.dir.slice(parsed.root.length);
  const parts = dirAfterRoot.split(/[/\\]/u).filter((p) => p.length > 0);
  if (parsed.base.length > 0 && parsed.base !== parsed.root) {
    parts.push(parsed.base);
  }
  return { root: parsed.root, parts };
}

/**
 * Resolve `candidate` (absolute, or relative to `root`) and reject symlink/junction
 * components under `root` whose realpath leaves it. Returns the resolved path.
 */
export async function assertPathInside(root: string, candidate: string): Promise<string> {
  let rootReal: string;
  try {
    rootReal = await realpath(path.resolve(root));
  } catch (err) {
    throw new WorkspaceError(`workspace root does not exist: ${root}`, { cause: err });
  }
  const rootNorm = normalizePath(rootReal);

  const candidateAbs = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(rootReal, candidate);

  const { root: fsRoot, parts } = splitAbsolute(candidateAbs);
  let current = fsRoot.length > 0 ? fsRoot : path.sep;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === undefined) {
      continue;
    }
    const next = path.join(current, part);
    let lst;
    try {
      lst = await lstat(next);
    } catch (err) {
      if (isEnoent(err)) {
        let reconstructed = current;
        for (const rest of parts.slice(i)) {
          reconstructed = path.join(reconstructed, rest);
        }
        if (!isInside(rootNorm, reconstructed)) {
          throw new WorkspaceError(`path is outside workspace: ${candidate}`);
        }
        return reconstructed;
      }
      throw err;
    }

    if (lst.isSymbolicLink()) {
      let real: string;
      try {
        real = await realpath(next);
      } catch (err) {
        throw new WorkspaceError(`path escapes workspace via broken symlink or junction: ${next}`, {
          cause: err,
        });
      }
      if (isInside(rootNorm, next) && !isInside(rootNorm, real)) {
        throw new WorkspaceError(`path escapes workspace via symlink or junction: ${next}`);
      }
      current = real;
    } else {
      current = next;
    }
  }

  let resolvedFinal: string;
  try {
    resolvedFinal = await realpath(current);
  } catch {
    resolvedFinal = current;
  }
  if (!isInside(rootNorm, resolvedFinal)) {
    throw new WorkspaceError(`path is outside workspace: ${candidate}`);
  }
  return resolvedFinal;
}
