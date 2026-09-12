import fs from "node:fs";
import path from "node:path";

import {
  defaultBackupRoot,
  SQLITE_BASENAME,
  SQLITE_SIDECARS,
  STATE_SKIP_DIR_NAMES,
  STATE_SKIP_FILE_NAMES,
} from "./paths.js";

export interface StateBackupManifest {
  kind: "workforce-state-backup";
  createdAt: string;
  entries: string[];
}

export interface CreateStateBackupInput {
  stateDir: string;
  destinationDir?: string;
  now?: () => Date;
}

function stamp(now: Date): string {
  return now.toISOString().replaceAll(":", "").replaceAll(".", "");
}

function shouldSkip(name: string, isDirectory: boolean): boolean {
  if (STATE_SKIP_FILE_NAMES.has(name)) {
    return true;
  }
  return isDirectory && STATE_SKIP_DIR_NAMES.has(name);
}

function copyTree(sourceDir: string, destDir: string, relative: string, entries: string[]): void {
  const source = relative.length === 0 ? sourceDir : path.join(sourceDir, relative);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(source, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  fs.mkdirSync(path.join(destDir, relative), { recursive: true });
  for (const dirent of dirents) {
    if (shouldSkip(dirent.name, dirent.isDirectory())) {
      continue;
    }
    const childRelative = relative.length === 0 ? dirent.name : path.join(relative, dirent.name);
    if (dirent.isDirectory()) {
      copyTree(sourceDir, destDir, childRelative, entries);
      continue;
    }
    if (!dirent.isFile() && !dirent.isSymbolicLink()) {
      continue;
    }
    const from = path.join(sourceDir, childRelative);
    const to = path.join(destDir, childRelative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    entries.push(childRelative.split(path.sep).join("/"));
  }
}

export function createStateBackup(input: CreateStateBackupInput): {
  backupDir: string;
  manifest: StateBackupManifest;
} {
  const now = input.now?.() ?? new Date();
  const backupDir =
    input.destinationDir ?? path.join(defaultBackupRoot(input.stateDir), stamp(now));
  const filesDir = path.join(backupDir, "files");
  fs.mkdirSync(filesDir, { recursive: true });
  const entries: string[] = [];
  copyTree(input.stateDir, filesDir, "", entries);
  for (const sidecar of SQLITE_SIDECARS) {
    const name = `${SQLITE_BASENAME}${sidecar}`;
    if (entries.includes(name)) {
      continue;
    }
    const from = path.join(input.stateDir, name);
    if (fs.existsSync(from)) {
      const to = path.join(filesDir, name);
      fs.copyFileSync(from, to);
      entries.push(name);
    }
  }
  const manifest: StateBackupManifest = {
    kind: "workforce-state-backup",
    createdAt: now.toISOString(),
    entries,
  };
  fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { backupDir, manifest };
}

export function readBackupManifest(backupDir: string): StateBackupManifest {
  const raw = JSON.parse(
    fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8"),
  ) as Partial<StateBackupManifest>;
  if (
    raw.kind !== "workforce-state-backup" ||
    !Array.isArray(raw.entries) ||
    typeof raw.createdAt !== "string"
  ) {
    throw new Error("backup manifest is not a workforce-state-backup");
  }
  return {
    kind: "workforce-state-backup",
    createdAt: raw.createdAt,
    entries: raw.entries.filter((item): item is string => typeof item === "string"),
  };
}

export function restoreStateBackup(backupDir: string, stateDir: string): StateBackupManifest {
  const manifest = readBackupManifest(backupDir);
  const filesDir = path.join(backupDir, "files");
  fs.mkdirSync(stateDir, { recursive: true });
  for (const entry of manifest.entries) {
    const from = path.join(filesDir, ...entry.split("/"));
    const to = path.join(stateDir, ...entry.split("/"));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return manifest;
}
