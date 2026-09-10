import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OsProcessController } from "./os-process-controller.js";
import { UNTESTED_PROCESS_PLATFORMS } from "./start-identity.js";
import { pollUntil, tasklistHasPid } from "./windows-inspect.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windowsTree = process.platform === "win32" ? describe : describe.skip;

const TREE_SCRIPT = `import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = process.env.WF_TREE_DIR;
if (!dir) {
  process.exit(2);
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "parent.pid"), String(process.pid));

const grandchild = \`
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.WF_TREE_DIR;
const role = process.env.WF_TREE_ROLE;
fs.writeFileSync(path.join(dir, role + ".pid"), String(process.pid));
setInterval(() => {}, 60000);
\`;

for (const role of ["grandchild-1", "grandchild-2"]) {
  const child = spawn(process.execPath, ["-e", grandchild], {
    env: { ...process.env, WF_TREE_ROLE: role },
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });
  child.unref();
}

setInterval(() => {}, 60000);
`;

function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") {
        continue;
      }
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|ps1|js|mjs|cjs)$/.test(name) && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("OsProcessController source invariants", () => {
  it("never uses image-name taskkill", () => {
    const files = [
      ...collectSourceFiles(join(packageRoot, "src")),
      ...collectSourceFiles(join(packageRoot, "scripts")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/taskkill\s+\/IM\b/i);
    }
  });

  it("exports UNTESTED_PROCESS_PLATFORMS documenting darwin and linux", () => {
    expect(UNTESTED_PROCESS_PLATFORMS).toEqual(["darwin", "linux"]);
  });
});

windowsTree("Windows process tree (skipped: macOS/Linux process-tree cancel is untested)", () => {
  let controller: OsProcessController;
  const handles: Array<{ pid: number; startIdentity: string }> = [];
  const extraPids: number[] = [];
  const tempDirs: string[] = [];

  beforeEach(() => {
    controller = new OsProcessController();
  });

  afterEach(async () => {
    for (const handle of handles.splice(0)) {
      try {
        await controller.cancel(handle, "force");
      } catch {
        // leftover may already be dead or have mismatched identity
      }
    }
    for (const pid of extraPids.splice(0)) {
      if (tasklistHasPid(pid)) {
        try {
          execFileSync("taskkill", ["/PID", String(pid), "/F"], {
            stdio: "ignore",
            windowsHide: true,
            timeout: 15_000,
          });
        } catch {
          // already gone
        }
      }
    }
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }, 30_000);

  async function waitForPidFile(file: string, timeoutMs: number): Promise<number> {
    const ok = await pollUntil(() => existsSync(file), timeoutMs);
    if (!ok) {
      throw new Error(`timeout waiting for ${file}`);
    }
    const n = Number(readFileSync(file, "utf8").trim());
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`bad pid in ${file}`);
    }
    return n;
  }

  async function spawnTree(): Promise<{
    handle: { pid: number; startIdentity: string };
    parentPid: number;
    gc1: number;
    gc2: number;
    dir: string;
  }> {
    const dir = mkdtempSync(join(tmpdir(), "wf-process-tree-"));
    tempDirs.push(dir);
    const scriptPath = join(dir, "child-tree.mjs");
    writeFileSync(scriptPath, TREE_SCRIPT, "utf8");
    const handle = await controller.spawn({
      argv: [process.execPath, scriptPath],
      cwd: dir,
      env: { WF_TREE_DIR: dir },
    });
    handles.push(handle);
    extraPids.push(handle.pid);
    const parentPid = await waitForPidFile(join(dir, "parent.pid"), 15_000);
    const gc1 = await waitForPidFile(join(dir, "grandchild-1.pid"), 15_000);
    const gc2 = await waitForPidFile(join(dir, "grandchild-2.pid"), 15_000);
    extraPids.push(gc1, gc2);
    expect(parentPid).toBe(handle.pid);
    const parentListed = await pollUntil(() => tasklistHasPid(parentPid), 10_000);
    const gc1Listed = await pollUntil(() => tasklistHasPid(gc1), 10_000);
    const gc2Listed = await pollUntil(() => tasklistHasPid(gc2), 10_000);
    expect(parentListed).toBe(true);
    expect(gc1Listed).toBe(true);
    expect(gc2Listed).toBe(true);
    return { handle, parentPid, gc1, gc2, dir };
  }

  it("force-cancel kills detached grandchildren and leaves an unrelated sentinel alive", async () => {
    const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},60000)"], {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
    });
    if (sentinel.pid === undefined) {
      throw new Error("sentinel spawn produced no pid");
    }
    extraPids.push(sentinel.pid);
    const sentinelReady = await pollUntil(() => tasklistHasPid(sentinel.pid!), 10_000);
    expect(sentinelReady).toBe(true);

    const tree = await spawnTree();
    const before = await controller.inspect(tree.handle);
    expect(before.alive).toBe(true);
    expect(before.startIdentity).toBe(tree.handle.startIdentity);

    await controller.cancel(tree.handle, "force");

    const parentDead = await pollUntil(() => !tasklistHasPid(tree.parentPid), 15_000);
    const gc1Dead = await pollUntil(() => !tasklistHasPid(tree.gc1), 15_000);
    const gc2Dead = await pollUntil(() => !tasklistHasPid(tree.gc2), 15_000);
    expect(parentDead).toBe(true);
    expect(gc1Dead).toBe(true);
    expect(gc2Dead).toBe(true);
    expect(tasklistHasPid(sentinel.pid)).toBe(true);

    const after = await controller.inspect(tree.handle);
    expect(after.alive).toBe(false);
    expect(after.startIdentity).toBe(tree.handle.startIdentity);

    await controller.cancel(tree.handle, "force");
  }, 30_000);

  it("identity mismatch does not kill the live process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-process-sleeper-"));
    tempDirs.push(dir);
    const handle = await controller.spawn({
      argv: [process.execPath, "-e", "setInterval(()=>{},60000)"],
      cwd: dir,
    });
    handles.push(handle);
    extraPids.push(handle.pid);
    const alive = await pollUntil(() => tasklistHasPid(handle.pid), 10_000);
    expect(alive).toBe(true);

    const fake = {
      pid: handle.pid,
      startIdentity: `win32:${handle.pid}:1999-01-01T00:00:00.0000000Z`,
    };
    await expect(controller.cancel(fake, "force")).rejects.toThrow(/identity_mismatch/);
    expect(tasklistHasPid(handle.pid)).toBe(true);

    await controller.cancel(handle, "force");
    const dead = await pollUntil(() => !tasklistHasPid(handle.pid), 15_000);
    expect(dead).toBe(true);
  }, 30_000);

  it("force kills detached grandchildren via job close or tree taskkill while the root is alive", async () => {
    const tree = await spawnTree();
    await controller.cancel(tree.handle, "force");
    const parentDead = await pollUntil(() => !tasklistHasPid(tree.parentPid), 15_000);
    const gc1Dead = await pollUntil(() => !tasklistHasPid(tree.gc1), 15_000);
    const gc2Dead = await pollUntil(() => !tasklistHasPid(tree.gc2), 15_000);
    expect(parentDead).toBe(true);
    expect(gc1Dead).toBe(true);
    expect(gc2Dead).toBe(true);
  }, 30_000);
});
