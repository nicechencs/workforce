#!/usr/bin/env node
/**
 * Backup / restore the Daemon state directory (SQLite + WAL sidecars + world).
 * Does not print bootstrap tokens or other secrets.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { skipStateNames } from "./config.mjs";
import { ensureDir, fail, writeJson, writeLine } from "./lib.mjs";

function defaultStateDir(platform = process.platform, env = process.env) {
  if (typeof env.WORKFORCE_STATE_DIR === "string" && env.WORKFORCE_STATE_DIR.length > 0) {
    return env.WORKFORCE_STATE_DIR;
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Workforce");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Workforce");
  }
  const xdg = env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "workforce");
}

function shouldSkip(name, isDirectory) {
  if (skipStateNames.files.includes(name)) {
    return true;
  }
  return isDirectory && skipStateNames.dirs.includes(name);
}

function copyTree(sourceDir, destDir, relative, entries) {
  const source = relative.length === 0 ? sourceDir : path.join(sourceDir, relative);
  let dirents;
  try {
    dirents = fs.readdirSync(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  ensureDir(path.join(destDir, relative));
  for (const dirent of dirents) {
    if (shouldSkip(dirent.name, dirent.isDirectory())) {
      continue;
    }
    const child = relative.length === 0 ? dirent.name : path.join(relative, dirent.name);
    if (dirent.isDirectory()) {
      copyTree(sourceDir, destDir, child, entries);
      continue;
    }
    if (!dirent.isFile() && !dirent.isSymbolicLink()) {
      continue;
    }
    const to = path.join(destDir, child);
    ensureDir(path.dirname(to));
    fs.copyFileSync(path.join(sourceDir, child), to);
    entries.push(child.split(path.sep).join("/"));
  }
}

export function backupStateDir(stateDir, destinationDir) {
  const filesDir = path.join(destinationDir, "files");
  ensureDir(filesDir);
  const entries = [];
  copyTree(stateDir, filesDir, "", entries);
  const manifest = {
    kind: "workforce-state-backup",
    createdAt: new Date().toISOString(),
    entries,
  };
  writeJson(path.join(destinationDir, "manifest.json"), manifest);
  return manifest;
}

export function restoreStateDir(backupDir, stateDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
  if (manifest.kind !== "workforce-state-backup" || !Array.isArray(manifest.entries)) {
    throw new Error("backup manifest is not a workforce-state-backup");
  }
  ensureDir(stateDir);
  const filesDir = path.join(backupDir, "files");
  for (const entry of manifest.entries) {
    const from = path.join(filesDir, ...String(entry).split("/"));
    const to = path.join(stateDir, ...String(entry).split("/"));
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
  }
  return manifest;
}

function help() {
  return `Usage:
  node tooling/release/backup.mjs backup [--state-dir DIR] [--out DIR]
  node tooling/release/backup.mjs restore --from DIR [--state-dir DIR]

Default state dir matches the Desktop Daemon (AppData/Workforce, macOS Application Support, XDG).
Backups include workforce.sqlite and WAL sidecars. They also copy bootstrap.json; treat the
output directory as sensitive. start.cmd is not an installer and is unrelated to this tool.
`;
}

function parseArgs(argv) {
  const out = { command: argv[0], stateDir: undefined, out: undefined, from: undefined };
  if (!out.command || out.command === "--help" || out.command === "-h") {
    out.command = "help";
    return out;
  }
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--state-dir" && next) {
      out.stateDir = next;
      i += 1;
    } else if (arg === "--out" && next) {
      out.out = next;
      i += 1;
    } else if (arg === "--from" && next) {
      out.from = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      out.command = "help";
    } else {
      fail(`unknown argument: ${arg}\n${help()}`);
    }
  }
  return out;
}

const invoked =
  Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invoked) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === "help") {
    writeLine(process.stdout, help());
    process.exit(args.command === "help" ? 0 : 1);
  }
  const stateDir = path.resolve(args.stateDir ?? defaultStateDir());
  if (args.command === "backup") {
    const destination =
      args.out ??
      path.join(
        stateDir,
        "backups",
        new Date().toISOString().replaceAll(":", "").replaceAll(".", ""),
      );
    const manifest = backupStateDir(stateDir, destination);
    writeLine(process.stdout, `backup wrote ${manifest.entries.length} files`);
    writeLine(process.stdout, destination);
  } else if (args.command === "restore") {
    if (!args.from) {
      fail("--from is required for restore");
    }
    const manifest = restoreStateDir(path.resolve(args.from), stateDir);
    writeLine(process.stdout, `restore wrote ${manifest.entries.length} files`);
  } else {
    fail(help());
  }
}
