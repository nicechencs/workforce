import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { readDaemonState } from "../src/main/daemon-supervisor/state.js";
import { resolveDaemonLaunchArgs } from "../src/main/smoke-env.js";
import { resolveWorkspaceTsEsmRegisterUrl } from "../src/main/ts-esm-loader.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const daemonEntry = fileURLToPath(new URL("../../daemon/src/index.ts", import.meta.url));

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isolatedLockPath(stateDir: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\WorkforceDaemon-test-${path.basename(stateDir)}`;
  }
  return path.join(stateDir, "daemon.lock.sock");
}

function readLog(logPath: string): string {
  try {
    return fs.readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
}

describe("daemon source launch", () => {
  const pids: number[] = [];
  const stateDirs: string[] = [];

  afterEach(() => {
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid);
      } catch {
        // already exited
      }
    }
    for (const dir of stateDirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may hold the SQLite handles until the child is gone;
        // a leftover temp dir must not fail the test.
      }
    }
  });

  it("boots the TypeScript daemon entry with the supervisor launch args", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-daemon-src-"));
    stateDirs.push(stateDir);
    const logPath = path.join(stateDir, "daemon.log");
    const args = [
      ...resolveDaemonLaunchArgs(daemonEntry, stateDir, {
        importModule: resolveWorkspaceTsEsmRegisterUrl(appRoot),
      }),
      "--lock-path",
      isolatedLockPath(stateDir),
    ];
    const logFd = fs.openSync(logPath, "a");
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    fs.closeSync(logFd);
    child.unref();
    if (child.pid) {
      pids.push(child.pid);
    }

    let state = null;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      state = readDaemonState(stateDir);
      if (state?.port) {
        break;
      }
      await wait(100);
    }

    // The daemon must replace the state file. Strip-only type stripping cannot
    // compile the daemon sources, so a crashing entry point shows up here.
    expect(state, `daemon did not write state; log:\n${readLog(logPath)}`).not.toBeNull();
    expect(state?.pid, readLog(logPath)).toBe(child.pid);
    expect(state?.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${state?.port}/health`);
    expect(res.ok).toBe(true);
    const health = (await res.json()) as { ok: boolean; protocolVersion: string };
    expect(health.ok).toBe(true);
    expect(health.protocolVersion).toBe(state?.protocolVersion);
  });
});
