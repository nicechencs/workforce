import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import {
  PROTOCOL_VERSION,
  DEFAULT_LOCK_PORT,
  defaultStateDir,
  parseArgs,
  emit,
  ensureDir,
  writeState,
  readState,
  recoverStaleLockFile,
  writeJsonAtomic,
  lockPath,
  statePath,
  pidAlive,
  getProcessStartIdentity,
  removeFile,
} from "./shared.mjs";

process.title = "workforce-spike-daemon";
process.stdin.pause();
process.stdin.unref?.();

const args = parseArgs();
const stateDir = args["state-dir"] ? String(args["state-dir"]) : defaultStateDir();
const lockPort = Number(args["lock-port"] ?? DEFAULT_LOCK_PORT);
const startedAt = new Date().toISOString();
const nonce = crypto.randomBytes(8).toString("hex");

ensureDir(stateDir);

function listenExclusive(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => resolve(server));
  });
}

function listenHttp() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleRequest);
    server.keepAliveTimeout = 1000;
    server.headersTimeout = 2000;
    server.requestTimeout = 2000;
    server.on("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => resolve(server));
  });
}

function allowedHost(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).split(",")[0].trim().toLowerCase();
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

function send(res, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    connection: "close",
  });
  res.end(payload);
}

let state = null;
let httpServer = null;
let lockServer = null;
let stopping = false;

function snapshot() {
  return {
    ok: true,
    role: "daemon",
    pid: process.pid,
    port: state?.port ?? null,
    lockPort,
    startIdentity: state?.startIdentity ?? null,
    osStartIdentity: state?.osStartIdentity ?? null,
    startedAt,
    protocolVersion: PROTOCOL_VERSION,
    uptimeMs: Date.now() - Date.parse(startedAt),
  };
}

function handleRequest(req, res) {
  if (!allowedHost(req.headers.host)) {
    send(res, 403, { ok: false, error: "host-not-loopback" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, snapshot());
    return;
  }
  if (req.method === "GET" && url.pathname === "/pid") {
    send(res, 200, { ok: true, pid: process.pid });
    return;
  }
  if (req.method === "POST" && url.pathname === "/stop") {
    send(res, 200, { ok: true, stopping: true, pid: process.pid });
    setTimeout(() => shutdown(0, "stop-endpoint"), 30);
    return;
  }
  send(res, 404, { ok: false, error: "not-found" });
}

async function rejectDuplicate() {
  const existing = readState(stateDir);
  emit("single-instance-rejected", {
    lockPort,
    existing: existing
      ? {
          pid: existing.pid,
          port: existing.port,
          startIdentity: existing.startIdentity,
          startedAt: existing.startedAt,
          protocolVersion: existing.protocolVersion,
          pidAlive: pidAlive(existing.pid),
        }
      : null,
    error: "another daemon holds the instance lock",
  });
  process.exitCode = 2;
  process.exit(2);
}

async function shutdown(code, reason) {
  if (stopping) return;
  stopping = true;
  emit("stopping", { reason, code });
  await new Promise((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
    setTimeout(resolve, 500);
  });
  await new Promise((resolve) => {
    if (!lockServer) return resolve();
    lockServer.close(() => resolve());
    setTimeout(resolve, 200);
  });
  const current = readState(stateDir);
  if (current?.pid === process.pid) {
    removeFile(statePath(stateDir));
    removeFile(lockPath(stateDir));
  }
  process.exit(code);
}

process.on("SIGTERM", () => shutdown(0, "SIGTERM"));
process.on("SIGINT", () => shutdown(0, "SIGINT"));

try {
  lockServer = await listenExclusive(lockPort);
} catch (err) {
  emit("lock-port-busy", { lockPort, code: err.code, message: err.message });
  await rejectDuplicate();
}

try {
  httpServer = await listenHttp();
} catch (err) {
  emit("http-listen-failed", { message: err.message });
  await shutdown(1, "http-listen-failed");
}

const addr = httpServer.address();
const port = addr.port;
const osStartIdentity = await getProcessStartIdentity(process.pid);
const startIdentity = `${process.pid}:${osStartIdentity ?? startedAt}:${nonce}`;
const lockRecovery = recoverStaleLockFile(stateDir, process.pid);

state = {
  pid: process.pid,
  port,
  lockPort,
  startIdentity,
  osStartIdentity,
  startedAt,
  protocolVersion: PROTOCOL_VERSION,
  nonce,
  exe: process.execPath,
  lockRecovery: lockRecovery.action,
};

writeState(stateDir, state);
writeJsonAtomic(lockPath(stateDir), {
  pid: process.pid,
  startIdentity,
  startedAt,
  lockPort,
});

emit("listening", {
  port,
  lockPort,
  startIdentity,
  osStartIdentity,
  protocolVersion: PROTOCOL_VERSION,
  lockRecovery: lockRecovery.action,
  stateFile: statePath(stateDir),
});
