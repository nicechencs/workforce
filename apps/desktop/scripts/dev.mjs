import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { bundlePreload } from "./bundle-preload.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = require("electron");

function resolveBin(name) {
  const dir = path.join(root, "node_modules", ".bin");
  if (process.platform === "win32") {
    for (const ext of [".cmd", ".exe", ""]) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return path.join(dir, name);
}

const tscBin = resolveBin("tsc");

function quoteForCmd(arg) {
  const value = String(arg);
  if (/^[A-Za-z0-9_./:=@+-\\]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const file = isWin ? (process.env.ComSpec ?? "cmd.exe") : command;
    const spawnArgs = isWin
      ? ["/d", "/s", "/c", [command, ...args].map(quoteForCmd).join(" ")]
      : args;
    const child = spawn(file, spawnArgs, {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "null"}`));
    });
    child.on("error", reject);
  });
}

await run(tscBin, ["-p", "tsconfig.json"]);
await bundlePreload();

const server = await createServer({
  configFile: path.join(root, "vite.config.ts"),
  root,
});
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) {
  await server.close();
  throw new Error("Vite did not publish a local URL for the desktop dev shell");
}
process.stdout.write(`Renderer dev server: ${url}\n`);

const electron = spawn(electronPath, [path.join(root, "dist/main/electron-main.js")], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: url,
  },
});

const shutdown = async (code = 0) => {
  if (!electron.killed) {
    electron.kill();
  }
  await server.close();
  process.exit(code);
};

electron.on("exit", (code) => {
  void shutdown(code ?? 0);
});

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});
