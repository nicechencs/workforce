import process from "node:process";

import { mergeMinimalEnv } from "./env.js";
import { cancelPosix, inspectPosix, spawnPosix } from "./posix-process.js";
import type { TrackedProcess } from "./tracked.js";
import { cancelWindows, inspectWindows, spawnWindows } from "./windows-job.js";

type ProcessCancelMode = "graceful" | "force";

interface ProcessHandle {
  pid: number;
  startIdentity: string;
}

interface SpawnRequest {
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
}

interface ProcessStatus {
  alive: boolean;
  startIdentity: string;
}

export class OsProcessController {
  readonly #tracked = new Map<string, TrackedProcess>();

  async spawn(req: SpawnRequest): Promise<ProcessHandle> {
    const exe = req.argv[0];
    if (!Array.isArray(req.argv) || exe === undefined || exe === "") {
      throw new Error("SpawnRequest.argv[0] must be an executable");
    }
    if (typeof req.cwd !== "string" || req.cwd.length === 0) {
      throw new Error("SpawnRequest.cwd is required");
    }
    const env = mergeMinimalEnv(req.env);
    const normalized = { argv: req.argv, cwd: req.cwd, env };
    const tracked =
      process.platform === "win32" ? await spawnWindows(normalized) : await spawnPosix(normalized);
    this.#tracked.set(trackKey(tracked.handle), tracked);
    return { pid: tracked.handle.pid, startIdentity: tracked.handle.startIdentity };
  }

  async cancel(handle: ProcessHandle, mode: ProcessCancelMode): Promise<void> {
    const tracked = this.#tracked.get(trackKey(handle));
    if (process.platform === "win32") {
      await cancelWindows(handle, mode, tracked);
    } else {
      await cancelPosix(handle, mode, tracked);
    }
    if (mode === "force") {
      this.#tracked.delete(trackKey(handle));
    }
  }

  async inspect(handle: ProcessHandle): Promise<ProcessStatus> {
    if (process.platform === "win32") {
      return inspectWindows(handle);
    }
    return inspectPosix(handle);
  }
}

function trackKey(handle: ProcessHandle): string {
  return `${handle.pid}\n${handle.startIdentity}`;
}
