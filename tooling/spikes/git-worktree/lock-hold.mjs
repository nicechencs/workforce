#!/usr/bin/env node
/**
 * Hold an open handle on a file until the process is killed.
 * Usage: node lock-hold.mjs <file> [flags]
 * flags default: r+  (must exist). Use "w" to create.
 */
import fs from "node:fs";
import process from "node:process";

const file = process.argv[2];
const flags = process.argv[3] || "r+";
if (!file) {
  process.stderr.write("usage: lock-hold.mjs <file> [flags]\n");
  process.exit(2);
}

const fd = fs.openSync(file, flags);
process.stdout.write(
  `LOCKED pid=${process.pid} fd=${fd} flags=${flags} file=${file}\n`,
);

const timer = setInterval(() => {}, 1 << 30);

function cleanup() {
  clearInterval(timer);
  try {
    fs.closeSync(fd);
  } catch {
    // already closed or process dying
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);
