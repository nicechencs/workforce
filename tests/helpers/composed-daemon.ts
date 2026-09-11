import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createComposedAppServices, startDaemon, type StartedDaemon } from "@workforce/daemon";
import {
  createDesktopClient,
  createLoopbackTransport,
  type DesktopClient,
} from "@workforce/desktop-client";

export interface ComposedDaemonHarness {
  client: DesktopClient;
  daemon: StartedDaemon;
  stateDir: string;
}

export interface ComposedDaemonOptions {
  testId: string;
  completeAfterMs?: number;
}

export function daemonLockPath(
  testId: string,
  platform: NodeJS.Platform = process.platform,
  id = randomBytes(6).toString("hex"),
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\WorkforceTests-${testId}-${process.pid}-${id}`;
  }
  return path.join(os.tmpdir(), `workforce-${testId}-${process.pid}-${id}.lock.sock`);
}

async function closeHarness(harness: ComposedDaemonHarness): Promise<void> {
  try {
    await harness.daemon.close();
  } finally {
    fs.rmSync(harness.stateDir, { recursive: true, force: true });
  }
}

export class ComposedDaemonHarnesses {
  private readonly active: ComposedDaemonHarness[] = [];

  async start(options: ComposedDaemonOptions): Promise<ComposedDaemonHarness> {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), `wf-${options.testId}-`));
    let services: Awaited<ReturnType<typeof createComposedAppServices>> | undefined;
    try {
      services = await createComposedAppServices({
        stateDir,
        ...(options.completeAfterMs !== undefined
          ? { completeAfterMs: options.completeAfterMs }
          : {}),
      });
      const daemon = await startDaemon({
        stateDir,
        services,
        lockPath: daemonLockPath(options.testId),
        heartbeatMs: 30,
        pollMs: 20,
      });
      const harness = {
        daemon,
        stateDir,
        client: createDesktopClient({
          transport: createLoopbackTransport({
            port: daemon.port,
            getSessionToken: () => daemon.sessionToken,
          }),
        }),
      };
      this.active.push(harness);
      return harness;
    } catch (error) {
      if (services) {
        await services.close().catch(() => undefined);
      }
      fs.rmSync(stateDir, { recursive: true, force: true });
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    let firstError: unknown;
    for (const harness of this.active.splice(0)) {
      try {
        await closeHarness(harness);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }
}
