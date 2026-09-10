import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { protocolVersion as defaultProtocolVersion } from "@workforce/protocol";

import { buildApi } from "../api/index.js";
import { SessionRegistry } from "../api/auth.js";
import { FakeAppServices } from "../modules/fake-app-services.js";
import { createIdFactory, type IdFactory } from "../modules/ids.js";
import type { AppServices } from "../modules/index.js";
import { MemoryReceiptStore } from "../modules/receipts.js";
import {
  acquireLock,
  defaultLockPath,
  formatOsStartIdentity,
  formatStartIdentity,
  loadOrCreateClientId,
  loadOrCreatePrincipalId,
  writeBootstrapFile,
  writePublicState,
} from "./state-file.js";

export interface DaemonOptions {
  stateDir: string;
  protocolVersion?: string;
  lockPath?: string;
  host?: "127.0.0.1";
  port?: number;
  now?: () => Date;
  services?: AppServices;
  ids?: IdFactory;
  sessionToken?: string;
  principalId?: string;
  clientId?: string;
  pid?: number;
  heartbeatMs?: number;
  pollMs?: number;
}

export interface StartedDaemon {
  port: number;
  host: "127.0.0.1";
  pid: number;
  startIdentity: string;
  protocolVersion: string;
  principalId: string;
  clientId: string;
  sessionToken: string;
  bootstrapToken: string;
  services: AppServices;
  sessions: SessionRegistry;
  close(): Promise<void>;
}

export async function startDaemon(options: DaemonOptions): Promise<StartedDaemon> {
  if (!options.stateDir) {
    throw new Error("stateDir is required");
  }
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1") {
    throw new Error("Daemon must bind loopback 127.0.0.1");
  }
  const now = options.now ?? (() => new Date());
  const pid = options.pid ?? process.pid;
  const startedAt = now().toISOString();
  const nonce = randomBytes(8).toString("hex");
  const startIdentity = formatStartIdentity(pid, startedAt, nonce);
  const osStartIdentity = formatOsStartIdentity(pid, startedAt);
  const protocolVersion = options.protocolVersion ?? defaultProtocolVersion;
  const ids = options.ids ?? createIdFactory();
  const services = options.services ?? new FakeAppServices({ now, ids });
  const receipts = new MemoryReceiptStore();
  const principalId = options.principalId ?? loadOrCreatePrincipalId(options.stateDir);
  const clientId = options.clientId ?? loadOrCreateClientId(options.stateDir);
  const sessions = new SessionRegistry(principalId, clientId);
  const session = sessions.issue(options.sessionToken);
  const bootstrapToken = randomBytes(32).toString("base64url");

  const lockPath = options.lockPath ?? defaultLockPath(options.stateDir);
  const lock = await acquireLock(lockPath);

  let port = 0;
  const app = buildApi({
    services,
    receipts,
    sessions,
    ids,
    now,
    protocolVersion,
    pid,
    startIdentity,
    bootstrapToken,
    sse: {
      heartbeatMs: options.heartbeatMs ?? 15_000,
      pollMs: options.pollMs ?? 50,
    },
    getPort: () => port,
  });

  await app.listen({ host, port: options.port ?? 0 });
  const address = app.server.address() as AddressInfo | null;
  if (!address || typeof address.port !== "number" || address.port <= 0) {
    await app.close();
    lock.close();
    throw new Error("Daemon failed to bind a loopback port");
  }
  port = address.port;

  writePublicState(options.stateDir, {
    pid,
    port,
    startIdentity,
    osStartIdentity,
    startedAt,
    protocolVersion,
  });
  writeBootstrapFile(options.stateDir, {
    principalId,
    clientId,
    bootstrapToken,
  });

  const close = async (): Promise<void> => {
    await app.close();
    if (typeof services.close === "function") {
      await services.close();
    }
    await new Promise<void>((resolve) => lock.close(() => resolve()));
  };

  return {
    port,
    host,
    pid,
    startIdentity,
    protocolVersion,
    principalId,
    clientId,
    sessionToken: session.token,
    bootstrapToken,
    services,
    sessions,
    close,
  };
}

export function parseDaemonArgs(argv: string[]): {
  stateDir?: string;
  protocolVersion?: string;
  lockPath?: string;
} {
  const out: { stateDir?: string; protocolVersion?: string; lockPath?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--state-dir" && next) {
      out.stateDir = next;
      i += 1;
    } else if (arg === "--protocol-version" && next) {
      out.protocolVersion = next;
      i += 1;
    } else if (arg === "--lock-path" && next) {
      out.lockPath = next;
      i += 1;
    }
  }
  return out;
}

export function isEntrypoint(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) {
    return false;
  }
  try {
    return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
  } catch {
    return false;
  }
}
