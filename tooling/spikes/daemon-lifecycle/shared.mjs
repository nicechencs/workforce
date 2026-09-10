import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROTOCOL_VERSION = '0.1-spike';
export const DEFAULT_LOCK_PORT = 18765;

const here = path.dirname(fileURLToPath(import.meta.url));

export function defaultStateDir() {
  return path.resolve(here, '..', '.tmp', 'daemon-lifecycle');
}

export function daemonScript() {
  return path.join(here, 'daemon.mjs');
}

export function desktopScript() {
  return path.join(here, 'desktop.mjs');
}

export function mutexProbeScript() {
  return path.join(here, 'mutex-probe.ps1');
}

export function statePath(stateDir) {
  return path.join(stateDir, 'daemon.json');
}

export function lockPath(stateDir) {
  return path.join(stateDir, 'daemon.lock');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    // EPERM: process exists but we cannot signal it.
    if (err.code === 'EPERM') return true;
    return false;
  }
}

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return null;
  }
}

export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  fs.renameSync(tmp, file);
}

export function readState(stateDir) {
  return readJsonFile(statePath(stateDir));
}

export function writeState(stateDir, value) {
  writeJsonAtomic(statePath(stateDir), value);
}

export function removeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export function emit(event, extra = {}) {
  const row = { ts: new Date().toISOString(), event, pid: process.pid, ...extra };
  process.stdout.write(`${JSON.stringify(row)}\n`);
  return row;
}

export async function fetchJson(url, { method = 'GET', timeoutMs = 800, body } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ac.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

export async function healthOf(port, timeoutMs = 800) {
  const r = await fetchJson(`http://127.0.0.1:${port}/health`, { timeoutMs });
  if (!r.ok || !r.json?.ok) {
    throw new Error(`health HTTP ${r.status}`);
  }
  return r.json;
}

export async function waitForHealth(port, { timeoutMs = 8000, startIdentity } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await healthOf(port, 400);
      if (!startIdentity || h.startIdentity === startIdentity) return h;
      last = new Error('startIdentity mismatch');
    } catch (err) {
      last = err;
    }
    await wait(80);
  }
  throw new Error(`health timeout on port ${port}: ${last?.message ?? 'no response'}`);
}

export function runCaptured(command, args, { timeoutMs = 15000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout ${command} ${args.join(' ')}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, pid: child.pid });
    });
  });
}

export function parseJsonLines(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(s));
    } catch {
      // ignore non-JSON noise
    }
  }
  return rows;
}

export function getProcessStartIdentity(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$p = Get-Process -Id ${n} -ErrorAction SilentlyContinue; if (-not $p) { exit 1 }; $p.StartTime.ToUniversalTime().ToString('o')`,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      const s = out.trim();
      resolve(code === 0 && s ? s : null);
    });
  });
}

export function getParentPid(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${n}").ParentProcessId`,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const n2 = Number(out.trim());
      resolve(Number.isInteger(n2) && n2 > 0 ? n2 : null);
    });
  });
}

export async function inspectExisting(stateDir) {
  const state = readState(stateDir);
  if (!state) return { status: 'none', state: null };
  const alive = pidAlive(state.pid);
  if (!alive) return { status: 'stale-dead-pid', state };
  const osStart = await getProcessStartIdentity(state.pid);
  if (state.osStartIdentity && osStart && osStart !== state.osStartIdentity) {
    return { status: 'stale-pid-reuse', state, osStart };
  }
  try {
    const health = await healthOf(state.port, 500);
    if (health.startIdentity !== state.startIdentity) {
      return { status: 'stale-identity-mismatch', state, health };
    }
    return { status: 'live', state, health, osStart };
  } catch (err) {
    return { status: 'stale-unhealthy', state, error: err.message, osStart };
  }
}

export function tryWxCreate(file) {
  try {
    const fd = fs.openSync(file, 'wx');
    return { ok: true, fd };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}

export function recoverStaleLockFile(stateDir, ownerPid) {
  const file = lockPath(stateDir);
  const existing = readJsonFile(file);
  if (!existing) {
    const created = tryWxCreate(file);
    if (created.ok) {
      fs.closeSync(created.fd);
      return { action: 'created', file };
    }
    return { action: 'wx-failed', file, ...created };
  }
  if (existing.pid === ownerPid) return { action: 'owned', file, existing };
  if (!pidAlive(existing.pid)) {
    removeFile(file);
    const created = tryWxCreate(file);
    if (created.ok) {
      fs.closeSync(created.fd);
      return { action: 'replaced-stale', file, previous: existing };
    }
    return { action: 'replace-failed', file, previous: existing, ...created };
  }
  return { action: 'held-by-live-pid', file, existing };
}
