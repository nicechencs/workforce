#!/usr/bin/env node
/**
 * Fail if any workspace:* dependency is not linked on disk.
 * Usage: node tooling/scripts/check-workspace-links.mjs [--json]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findMissingWorkspaceLinks } from "./workspace-links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const json = process.argv.includes("--json");
const missing = findMissingWorkspaceLinks(root);

if (json) {
  process.stdout.write(`${JSON.stringify({ ok: missing.length === 0, missing }, null, 2)}\n`);
} else if (missing.length === 0) {
  process.stdout.write("Workspace links are complete.\n");
} else {
  process.stderr.write(
    `Missing workspace links (${missing.length}). Run pnpm install --frozen-lockfile.\n`,
  );
  for (const item of missing) {
    process.stderr.write(`  ${item.packageDir} -> ${item.dependency}\n`);
  }
}

process.exit(missing.length === 0 ? 0 : 1);
