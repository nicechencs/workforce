import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { bundlePreload } from "./bundle-preload.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = require("electron");
const tscBin = path.join(root, "node_modules/.bin/tsc");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
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
const url = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:5173/";

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
