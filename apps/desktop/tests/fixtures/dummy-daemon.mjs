import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] ?? fallback;
}

const stateDir = arg("state-dir");
if (!stateDir) {
  process.stderr.write("dummy-daemon: --state-dir is required\n");
  process.exit(2);
}

const protocolVersion = arg("protocol-version", process.env.WORKFORCE_PROTOCOL_VERSION ?? "0.1");
const lockPath = arg(
  "lock-path",
  process.platform === "win32"
    ? `\\\\.\\pipe\\WorkforceDummy-${process.pid}`
    : path.join(stateDir, "daemon.lock.sock"),
);

const startedAt = new Date().toISOString();
const nonce = Math.random().toString(16).slice(2);
const startIdentity = `${process.pid}:${startedAt}:${nonce}`;
const osStartIdentity = `${process.platform}:${process.pid}:${startedAt}`;

function writeState(port) {
  fs.mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, "daemon.json");
  const tmp = `${file}.${process.pid}.tmp`;
  const body = `${JSON.stringify(
    {
      pid: process.pid,
      port,
      startIdentity,
      osStartIdentity,
      startedAt,
      protocolVersion,
    },
    null,
    2,
  )}\n`;
  fs.writeFileSync(tmp, body, "utf8");
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  fs.renameSync(tmp, file);
}

const lock = net.createServer();
lock.on("error", (error) => {
  process.stderr.write(`dummy-daemon lock: ${error.message}\n`);
  process.exit(2);
});

lock.listen({ path: lockPath, exclusive: true }, () => {
  const api = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/version")) {
      const payload = {
        ok: true,
        pid: process.pid,
        port: api.address().port,
        startIdentity,
        protocolVersion,
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(`${JSON.stringify(payload)}\n`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  api.listen(0, "127.0.0.1", () => {
    writeState(api.address().port);
  });
});
