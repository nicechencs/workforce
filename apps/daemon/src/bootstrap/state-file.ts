import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface DaemonPublicState {
  pid: number;
  port: number;
  startIdentity: string;
  osStartIdentity: string;
  startedAt: string;
  protocolVersion: string;
}

export interface DaemonBootstrapFile {
  principalId: string;
  clientId: string;
  bootstrapToken: string;
}

export function daemonStatePath(stateDir: string): string {
  return path.join(stateDir, "daemon.json");
}

export function bootstrapPath(stateDir: string): string {
  return path.join(stateDir, "bootstrap.json");
}

export function principalPath(stateDir: string): string {
  return path.join(stateDir, "principal-id");
}

export function desktopClientIdPath(stateDir: string): string {
  return path.join(stateDir, "desktop-client-id");
}

export function defaultLockPath(stateDir: string): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\WorkforceDaemon";
  }
  return path.join(stateDir, "daemon.lock.sock");
}

export function writeJsonAtomic(file: string, value: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(tmp, body, { encoding: "utf8", ...(mode !== undefined ? { mode } : {}) });
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  fs.renameSync(tmp, file);
  if (mode !== undefined) {
    try {
      fs.chmodSync(file, mode);
    } catch {
      // Windows may ignore POSIX modes.
    }
  }
}

export function writePublicState(stateDir: string, state: DaemonPublicState): void {
  writeJsonAtomic(daemonStatePath(stateDir), state);
}

export function writeBootstrapFile(stateDir: string, value: DaemonBootstrapFile): void {
  writeJsonAtomic(bootstrapPath(stateDir), value, 0o600);
}

export function loadOrCreatePrincipalId(stateDir: string): string {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = principalPath(stateDir);
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
  const created = `usr_${randomBytes(8).toString("hex")}`;
  fs.writeFileSync(file, `${created}\n`, "utf8");
  return created;
}

export function loadOrCreateClientId(stateDir: string): string {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = desktopClientIdPath(stateDir);
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
  const created = `cli_${randomBytes(8).toString("hex")}`;
  fs.writeFileSync(file, `${created}\n`, "utf8");
  return created;
}

export function acquireLock(lockPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const lock = net.createServer();
    lock.on("error", reject);
    lock.listen({ path: lockPath, exclusive: true }, () => resolve(lock));
  });
}

export function formatStartIdentity(pid: number, startedAt: string, nonce: string): string {
  return `${pid}:${startedAt}:${nonce}`;
}

export function formatOsStartIdentity(pid: number, startedAt: string): string {
  return `${process.platform}:${pid}:${startedAt}`;
}
