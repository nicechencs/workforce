import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function writeLine(stream, message) {
  stream.write(`${message}\n`);
}

export function fail(message, code = 1) {
  writeLine(process.stderr, message);
  process.exit(code);
}

export function run(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "null"}`));
    });
  });
}

export function runCapture(command, args, options = {}) {
  return run(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

export function copyDir(from, to, options = {}) {
  ensureDir(path.dirname(to));
  fs.cpSync(from, to, {
    recursive: true,
    dereference: options.dereference === true,
    filter: options.filter,
  });
}

export function which(command) {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(sep)) {
    for (const suffix of ext) {
      const candidate = path.join(dir, `${command}${suffix}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
