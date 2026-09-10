import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { startDaemon, type DaemonOptions, type StartedDaemon } from "../src/bootstrap/index.js";

export interface TestDaemon {
  daemon: StartedDaemon;
  stateDir: string;
  auth: Record<string, string>;
}

export function uniqueLockPath(): string {
  const id = randomBytes(6).toString("hex");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\WorkforceT10-${process.pid}-${id}`;
  }
  return path.join(os.tmpdir(), `workforce-t10-${process.pid}-${id}.lock.sock`);
}

export async function startTestDaemon(overrides: Partial<DaemonOptions> = {}): Promise<TestDaemon> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-t10-"));
  const daemon = await startDaemon({
    stateDir,
    lockPath: uniqueLockPath(),
    heartbeatMs: 30,
    pollMs: 20,
    ...overrides,
  });
  return {
    daemon,
    stateDir,
    auth: { authorization: `Bearer ${daemon.sessionToken}` },
  };
}

export async function json(
  port: number,
  pathName: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathName}`, init);
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

export function commandHeaders(
  auth: Record<string, string>,
  key: string,
  ifMatch?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...auth,
    "content-type": "application/json",
    "idempotency-key": key,
  };
  if (ifMatch !== undefined) {
    headers["if-match"] = `"${ifMatch}"`;
  }
  return headers;
}
