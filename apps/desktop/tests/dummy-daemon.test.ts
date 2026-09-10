import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { readDaemonState } from "../src/main/daemon-supervisor/state.js";

const fixture = fileURLToPath(new URL("./fixtures/dummy-daemon.mjs", import.meta.url));

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("dummy daemon fixture", () => {
  const pids: number[] = [];

  afterEach(() => {
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid);
      } catch {
        // already exited
      }
    }
  });

  it("listens on loopback and rewrites the state file", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-daemon-"));
    const child = spawn(process.execPath, [fixture, "--state-dir", stateDir], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    if (child.pid) {
      pids.push(child.pid);
    }
    let state = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      state = readDaemonState(stateDir);
      if (state?.port) {
        break;
      }
      await wait(50);
    }
    expect(state?.pid).toBe(child.pid);
    expect(state?.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${state?.port}/health`);
    expect(res.ok).toBe(true);
    const health = (await res.json()) as { ok: boolean; startIdentity: string };
    expect(health.ok).toBe(true);
    expect(health.startIdentity).toBe(state?.startIdentity);
  });
});
