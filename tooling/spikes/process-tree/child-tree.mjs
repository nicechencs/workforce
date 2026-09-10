/**
 * Spike worker: one parent + two grandchild Node processes.
 * Writes pids under SPIKE_PID_FILE's directory and waits until killed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const pidFile = process.env.SPIKE_PID_FILE;
if (!pidFile) {
  console.error("SPIKE_PID_FILE is required");
  process.exit(2);
}

const role = process.env.SPIKE_ROLE ?? "parent";
const dir = path.dirname(pidFile);
fs.mkdirSync(dir, { recursive: true });

function writePid(label, pid) {
  fs.writeFileSync(path.join(dir, `${label}.pid`), String(pid), "utf8");
  fs.appendFileSync(pidFile, `${label} ${pid}\n`, "utf8");
}

function installSignalLog(label) {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      const line = `signal ${label} ${sig}\n`;
      try {
        fs.appendFileSync(pidFile, line, "utf8");
      } catch {
        // ignore: process may be tearing down
      }
      console.log(`SIGNAL ${label} ${sig}`);
      process.exit(128);
    });
  }
}

function waitForever() {
  setInterval(() => {}, 60_000);
  try {
    process.stdin.resume();
  } catch {
    // stdin may be ignored
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // spin
    }
  }
}

function waitForFileSync(file, timeoutMs) {
  const start = Date.now();
  while (!fs.existsSync(file)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for ${file}`);
    }
    sleepSync(50);
  }
}

writePid(role, process.pid);
console.log(`PID ${role} ${process.pid}`);
installSignalLog(role);

if (role !== "parent") {
  waitForever();
} else {
  const holdFile = process.env.SPIKE_HOLD_FILE;
  if (holdFile) {
    waitForFileSync(holdFile, 20_000);
  }

  const grandchildScript = `
const fs = require("node:fs");
const path = require("node:path");
const role = process.env.SPIKE_ROLE;
const pidFile = process.env.SPIKE_PID_FILE;
const dir = path.dirname(pidFile);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, role + ".pid"), String(process.pid), "utf8");
fs.appendFileSync(pidFile, role + " " + process.pid + "\\n", "utf8");
console.log("PID " + role + " " + process.pid);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    try { fs.appendFileSync(pidFile, "signal " + role + " " + sig + "\\n", "utf8"); } catch {}
    console.log("SIGNAL " + role + " " + sig);
    process.exit(128);
  });
}
setInterval(() => {}, 60000);
try { process.stdin.resume(); } catch {}
`;

  const detached = process.env.SPIKE_GC_DETACHED === "1";
  for (let i = 1; i <= 2; i++) {
    const child = spawn(process.execPath, ["-e", grandchildScript], {
      env: {
        ...process.env,
        SPIKE_ROLE: `grandchild-${i}`,
        SPIKE_PID_FILE: pidFile,
      },
      stdio: detached ? "ignore" : "inherit",
      windowsHide: true,
      detached,
    });
    child.on("error", (err) => {
      console.error(`grandchild-${i} spawn error: ${err.message}`);
    });
    if (detached) child.unref();
  }

  waitForever();
}
