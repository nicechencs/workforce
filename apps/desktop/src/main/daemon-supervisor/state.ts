import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DaemonStateFile } from "./types.js";

export function defaultDaemonStateDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Workforce");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Workforce");
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdg, "workforce");
}

export function daemonStatePath(stateDir: string): string {
  return path.join(stateDir, "daemon.json");
}

export function daemonLockSocketPath(stateDir: string): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\WorkforceDaemon";
  }
  return path.join(stateDir, "daemon.lock.sock");
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }
    return code === "EPERM";
  }
}

export function readDaemonState(stateDir: string): DaemonStateFile | null {
  try {
    const raw = fs.readFileSync(daemonStatePath(stateDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<DaemonStateFile>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.port !== "number" ||
      typeof parsed.startIdentity !== "string" ||
      typeof parsed.osStartIdentity !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.protocolVersion !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      startIdentity: parsed.startIdentity,
      osStartIdentity: parsed.osStartIdentity,
      startedAt: parsed.startedAt,
      protocolVersion: parsed.protocolVersion,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export function writeDaemonState(stateDir: string, value: DaemonStateFile): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = daemonStatePath(stateDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  fs.renameSync(tmp, file);
}

export function loadOrCreateClientId(stateDir: string): string {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, "desktop-client-id");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length > 0) {
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const created = `desktop:${crypto.randomUUID()}`;
  fs.writeFileSync(file, `${created}\n`, "utf8");
  return created;
}

export function formatStartIdentity(pid: number, startedAt: string, nonce: string): string {
  return `${pid}:${startedAt}:${nonce}`;
}

export function formatOsStartIdentity(
  platform: NodeJS.Platform,
  pid: number,
  osStart: string,
): string {
  return `${platform}:${pid}:${osStart}`;
}
