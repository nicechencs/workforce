import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { bundlePreload } from "./bundle-preload.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = Number(process.env.WORKFORCE_DESKTOP_SMOKE_TIMEOUT_MS ?? 120_000);

export function resolveTscCommand(rootDir, platform = process.platform) {
  if (platform === "win32") {
    // Do not spawn the .cmd shim through a shell: Node does not escape its
    // arguments for cmd.exe, which breaks paths with spaces and is unsafe.
    return {
      command: process.execPath,
      args: [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"],
    };
  }
  return {
    command: path.join(rootDir, "node_modules/.bin/tsc"),
    args: ["-p", "tsconfig.json"],
  };
}

export function electronSmokeEnv(env, input) {
  const safeEnv = { ...env };
  for (const key of Object.keys(safeEnv)) {
    if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") {
      delete safeEnv[key];
    }
  }
  return {
    ...safeEnv,
    ELECTRON_RENDERER_URL: input.url,
    WORKFORCE_STATE_DIR: input.stateDir,
    WORKFORCE_SMOKE_WORKSPACE: input.workspaceDir,
    WORKFORCE_DESKTOP_SMOKE: "1",
    WORKFORCE_DESKTOP_SMOKE_OUT: input.resultPath,
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid);
  } catch {
    // already exited
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const electronPath = require("electron");
  const tsc = resolveTscCommand(root);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-desktop-smoke-"));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-desktop-smoke-ws-"));
  const resultPath = path.join(stateDir, "smoke-result.json");

  await run(tsc.command, tsc.args);
  await bundlePreload();

  const server = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    root,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    await server.close();
    throw new Error("Vite did not publish a local URL for the desktop smoke");
  }

  const electron = spawn(electronPath, [path.join(root, "dist/main/electron-main.js")], {
    cwd: root,
    stdio: "inherit",
    env: electronSmokeEnv(process.env, { url, stateDir, workspaceDir, resultPath }),
  });

  let result = null;
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      result = readJson(resultPath);
      if (result) {
        break;
      }
      if (electron.exitCode !== null) {
        throw new Error(`electron exited ${electron.exitCode} before writing ${resultPath}`);
      }
      await wait(100);
    }
    if (!result) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${resultPath}`);
    }
  } finally {
    if (!electron.killed && electron.exitCode === null) {
      electron.kill();
    }
    const daemonState = readJson(path.join(stateDir, "daemon.json"));
    if (daemonState && typeof daemonState.pid === "number") {
      killPid(daemonState.pid);
    }
    await server.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }

  if (!result?.ok) {
    process.stderr.write(`desktop smoke failed: ${result?.error ?? JSON.stringify(result)}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `desktop smoke passed: status=${result.status} tasks=${(result.tasks ?? []).join(", ")}\n`,
  );
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  await main();
}
