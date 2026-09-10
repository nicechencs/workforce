import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PROTOCOL_VERSION,
  DEFAULT_LOCK_PORT,
  defaultStateDir,
  desktopScript,
  daemonScript,
  mutexProbeScript,
  ensureDir,
  writeJsonAtomic,
  readState,
  parseJsonLines,
  runCaptured,
  inspectExisting,
  healthOf,
  pidAlive,
  wait,
  tryWxCreate,
  lockPath,
  statePath,
  fetchJson,
  getParentPid,
  getProcessStartIdentity,
} from './shared.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = defaultStateDir();
const lockPort = DEFAULT_LOCK_PORT;
const resultsFile = path.join(stateDir, 'results.json');

ensureDir(stateDir);

const envInfo = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  osType: os.type(),
  osRelease: os.release(),
  osVersion: typeof os.version === 'function' ? os.version() : null,
  cwd: process.cwd(),
  spikeDir: here,
  stateDir,
  protocolVersion: PROTOCOL_VERSION,
  lockPort,
  startedAt: new Date().toISOString(),
};

const results = { env: envInfo, steps: {} };

function record(id, data) {
  results.steps[id] = { id, at: new Date().toISOString(), ...data };
  return results.steps[id];
}

async function runDesktop(extraArgs = [], { timeoutMs = 12000 } = {}) {
  return runCaptured(
    process.execPath,
    [desktopScript(), '--state-dir', stateDir, '--lock-port', String(lockPort), ...extraArgs],
    { timeoutMs },
  );
}

async function stopDaemon(state) {
  if (!state?.port) return { skipped: true };
  try {
    return await fetchJson(`http://127.0.0.1:${state.port}/stop`, { method: 'POST', timeoutMs: 800 });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function killPid(pid) {
  if (!pidAlive(pid)) return { alreadyDead: true, pid };
  try {
    process.kill(pid);
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && pidAlive(pid)) await wait(50);
    return { killed: true, pid, stillAlive: pidAlive(pid) };
  } catch (err) {
    return { killed: false, pid, error: err.message, stillAlive: pidAlive(pid) };
  }
}

async function cleanupLeftovers() {
  const existing = await inspectExisting(stateDir);
  if (existing.status === 'live') {
    await stopDaemon(existing.state);
    await wait(200);
  }
  if (existing.state?.pid && pidAlive(existing.state.pid)) {
    await killPid(existing.state.pid);
  }
}

function spawnHolder({ detached, exitAfterMs }) {
  const args = [
    path.join(here, 'holder.mjs'),
    '--state-dir',
    stateDir,
    '--lock-port',
    String(lockPort),
    '--detached',
    detached ? 'true' : 'false',
  ];
  if (exitAfterMs != null) args.push('--exit-after-ms', String(exitAfterMs));
  const child = spawn(process.execPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  return {
    child,
    output: () => parseJsonLines(stdout),
    waitClose: (timeoutMs = 8000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('holder close timeout')), timeoutMs);
        child.on('close', (code) => {
          clearTimeout(t);
          resolve({ code, events: parseJsonLines(stdout) });
        });
      }),
  };
}

async function namedMutexProbe() {
  const name = 'Local\\WorkforceDaemonSpikeT03';
  const script = mutexProbeScript();
  const p1 = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Name', name, '-HoldSeconds', '10'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out1 = '';
  p1.stdout.setEncoding('utf8');
  p1.stdout.on('data', (d) => {
    out1 += d;
  });
  const heldDeadline = Date.now() + 5000;
  while (Date.now() < heldDeadline && !out1.includes('HELD')) await wait(50);
  const firstHeld = out1.includes('HELD');
  const p2 = await runCaptured(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Name', name, '-HoldSeconds', '1'],
    { timeoutMs: 8000 },
  );
  try {
    p1.kill();
  } catch {
    // holder may have already exited
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && pidAlive(p1.pid)) await wait(50);
  const p3 = await runCaptured(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Name', name, '-HoldSeconds', '1'],
    { timeoutMs: 8000 },
  );
  return {
    name,
    firstHeld,
    firstPid: p1.pid,
    secondWhileHeld: { code: p2.code, stdout: p2.stdout.trim(), stderr: p2.stderr.trim() },
    thirdAfterRelease: { code: p3.code, stdout: p3.stdout.trim(), stderr: p3.stderr.trim() },
  };
}

await cleanupLeftovers();
for (const f of [statePath(stateDir), lockPath(stateDir), resultsFile]) {
  try {
    fs.unlinkSync(f);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// A. desktop1 starts daemon
const aDesktop = await runDesktop();
const aEvents = parseJsonLines(aDesktop.stdout);
const aState = readState(stateDir);
const aHealth = aState ? await healthOf(aState.port) : null;
const aInspect = await inspectExisting(stateDir);
record('A', {
  title: 'Start desktop1 → daemon starts → health ok',
  expected: 'desktop exits 0 after spawning a live daemon; /health ok',
  desktop: { code: aDesktop.code, events: aEvents, stderr: aDesktop.stderr.trim() },
  state: aState,
  health: aHealth,
  inspect: aInspect.status,
  daemonAlive: aState ? pidAlive(aState.pid) : false,
  pass:
    aDesktop.code === 0 &&
    aEvents.some((e) => e.event === 'connected' && e.mode === 'spawn') &&
    aHealth?.ok === true &&
    aInspect.status === 'live',
});

// B. desktop1 already gone; daemon must still live
const bDesktopAlive = pidAlive(aDesktop.pid);
const bPoll = [];
for (let i = 0; i < 5; i += 1) {
  const h = await healthOf(aState.port);
  bPoll.push({ i, at: new Date().toISOString(), pid: h.pid, port: h.port, ok: h.ok });
  await wait(150);
}
record('B', {
  title: 'Exit desktop1 → daemon still healthy',
  expected: 'desktop1 pid dead; daemon pid unchanged; health still ok',
  desktop1Alive: bDesktopAlive,
  daemonAlive: pidAlive(aState.pid),
  samePid: bPoll.every((p) => p.pid === aState.pid),
  poll: bPoll,
  pass: !bDesktopAlive && pidAlive(aState.pid) && bPoll.every((p) => p.ok && p.pid === aState.pid),
});

// C. desktop2 reconnects to same pid/port
const cDesktop = await runDesktop();
const cEvents = parseJsonLines(cDesktop.stdout);
const cConnected = cEvents.find((e) => e.event === 'connected');
const cState = readState(stateDir);
record('C', {
  title: 'Start desktop2 → reconnect same pid/port, no second daemon',
  expected: 'mode=reconnect; same daemon pid and port as A',
  desktop: { code: cDesktop.code, events: cEvents, stderr: cDesktop.stderr.trim() },
  connected: cConnected ?? null,
  samePid: cConnected?.daemonPid === aState.pid,
  samePort: cConnected?.port === aState.port,
  stateUnchanged: cState?.startIdentity === aState.startIdentity,
  pass:
    cDesktop.code === 0 &&
    cConnected?.mode === 'reconnect' &&
    cConnected?.daemonPid === aState.pid &&
    cConnected?.port === aState.port &&
    !cEvents.some((e) => e.event === 'spawned-daemon'),
});

// D. second daemon process rejected
const dDaemon = await runCaptured(
  process.execPath,
  [daemonScript(), '--state-dir', stateDir, '--lock-port', String(lockPort)],
  { timeoutMs: 8000 },
);
const dEvents = parseJsonLines(`${dDaemon.stdout}\n${dDaemon.stderr}`);
const dRejected = dEvents.find((e) => e.event === 'single-instance-rejected');
const dAfter = await inspectExisting(stateDir);
record('D', {
  title: 'Direct second daemon process → rejected',
  expected: 'exit 2; prints existing pid/port; original daemon still live',
  exitCode: dDaemon.code,
  events: dEvents,
  stderr: dDaemon.stderr.trim(),
  rejected: dRejected ?? null,
  originalStillLive: dAfter.status === 'live' && dAfter.state?.pid === aState.pid,
  pass:
    dDaemon.code === 2 &&
    Boolean(dRejected) &&
    dRejected?.existing?.pid === aState.pid &&
    dAfter.status === 'live',
});

// E. kill daemon, stale files remain, desktop recovers
const eKill = await killPid(aState.pid);
await wait(200);
const ePidDead = !pidAlive(aState.pid);
const eStateLeft = readState(stateDir);
const eLockLeft = fs.existsSync(lockPath(stateDir));
const eWx = tryWxCreate(lockPath(stateDir));
if (eWx.ok) fs.closeSync(eWx.fd);
const eWxRetry = tryWxCreate(lockPath(stateDir));
if (eWxRetry.ok) fs.closeSync(eWxRetry.fd);
const eInspect = await inspectExisting(stateDir);
const eDesktop = await runDesktop();
const eEvents = parseJsonLines(eDesktop.stdout);
const eConnected = eEvents.find((e) => e.event === 'connected');
const eState = readState(stateDir);
const eHealth = eState ? await healthOf(eState.port) : null;
record('E', {
  title: 'Kill daemon, stale lock/state remains → new desktop replaces',
  expected: 'wx leftover EEXIST; inspect stale-dead-pid; new daemon different pid; health ok',
  kill: eKill,
  pidDead: ePidDead,
  staleStateRemained: Boolean(eStateLeft) && eStateLeft.pid === aState.pid,
  staleLockRemained: eLockLeft,
  wxAfterKill: { ok: eWx.ok, code: eWx.code, message: eWx.message },
  wxSecondOpen: { ok: eWxRetry.ok, code: eWxRetry.code },
  inspectBeforeReplace: eInspect.status,
  desktop: { code: eDesktop.code, events: eEvents, stderr: eDesktop.stderr.trim() },
  newPid: eState?.pid ?? null,
  newPort: eState?.port ?? null,
  replacedPid: eState?.pid !== aState.pid,
  health: eHealth,
  pass:
    ePidDead &&
    Boolean(eStateLeft) &&
    eLockLeft &&
    eWx.ok === false &&
    eWx.code === 'EEXIST' &&
    eInspect.status === 'stale-dead-pid' &&
    eDesktop.code === 0 &&
    eConnected?.mode === 'spawn' &&
    eState?.pid !== aState.pid &&
    eHealth?.ok === true,
});

// F. non-detached contrast
await stopDaemon(eState);
await wait(200);
if (eState?.pid && pidAlive(eState.pid)) await killPid(eState.pid);
await wait(100);
for (const f of [statePath(stateDir), lockPath(stateDir)]) {
  try {
    fs.unlinkSync(f);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

const f1 = spawnHolder({ detached: false, exitAfterMs: 2000 });
let f1HealthBeforeExit = null;
let f1StateBeforeExit = null;
const f1ReadyDeadline = Date.now() + 1800;
while (Date.now() < f1ReadyDeadline) {
  f1StateBeforeExit = readState(stateDir);
  if (f1StateBeforeExit?.port) {
    try {
      f1HealthBeforeExit = await healthOf(f1StateBeforeExit.port, 300);
      if (f1HealthBeforeExit?.ok) break;
    } catch {
      // still booting
    }
  }
  await wait(80);
}
const f1Close = await f1.waitClose(8000);
const f1Spawn = f1Close.events.find((e) => e.event === 'holder-spawned');
await wait(400);
const f1State = readState(stateDir);
let f1HealthAfter = null;
try {
  f1HealthAfter = f1State ? await healthOf(f1State.port, 400) : { error: 'no-state' };
} catch (err) {
  f1HealthAfter = { error: err.message };
}
const f1HolderAlive = pidAlive(f1.child.pid);
const f1DaemonAlive = f1State?.pid ? pidAlive(f1State.pid) : false;
const f1Parent = f1State?.pid ? await getParentPid(f1State.pid) : null;

record('F1', {
  title: 'Non-detached spawn: parent process.exit() — child dies on Windows',
  expected:
    'Node docs: on Windows, detached:true is required for a child to outlive the parent. Without it, process.exit() of the holder kills the daemon (contrast with A/B detached survival).',
  holderExit: f1Close.code,
  holderAlive: f1HolderAlive,
  spawn: f1Spawn ?? null,
  healthBeforeParentExit: f1HealthBeforeExit,
  daemonPid: f1State?.pid ?? f1StateBeforeExit?.pid ?? null,
  daemonAliveAfterParentExit: f1DaemonAlive,
  healthAfterParentExit: f1HealthAfter,
  parentPidAfterHolderExit: f1Parent,
  pass:
    f1Close.code === 0 &&
    !f1HolderAlive &&
    f1HealthBeforeExit?.ok === true &&
    !f1DaemonAlive &&
    Boolean(f1HealthAfter?.error),
});

await stopDaemon(f1State);
await wait(200);
if (f1State?.pid && pidAlive(f1State.pid)) await killPid(f1State.pid);
await wait(100);
for (const f of [statePath(stateDir), lockPath(stateDir)]) {
  try {
    fs.unlinkSync(f);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

const f2 = spawnHolder({ detached: false, exitAfterMs: 0 });
let f2StateBefore = null;
let f2HealthBefore = null;
const f2ReadyDeadline = Date.now() + 5000;
while (Date.now() < f2ReadyDeadline) {
  f2StateBefore = readState(stateDir);
  if (f2StateBefore?.port) {
    try {
      f2HealthBefore = await healthOf(f2StateBefore.port, 400);
      if (f2HealthBefore?.ok) break;
    } catch {
      // still booting
    }
  }
  await wait(80);
}
const f2Events = f2.output();
const f2Spawn = f2Events.find((e) => e.event === 'holder-spawned');
const f2Kill = await runCaptured('taskkill.exe', ['/PID', String(f2.child.pid), '/T', '/F'], { timeoutMs: 8000 });
await wait(400);
const f2HolderAlive = pidAlive(f2.child.pid);
const f2DaemonAlive = f2StateBefore?.pid ? pidAlive(f2StateBefore.pid) : false;
let f2HealthAfter = null;
try {
  f2HealthAfter = f2StateBefore ? await healthOf(f2StateBefore.port, 400) : null;
} catch (err) {
  f2HealthAfter = { error: err.message };
}

record('F2', {
  title: 'Non-detached spawn: taskkill /T on parent kills the tree',
  expected: 'holder and daemon both dead; health fails',
  spawn: f2Spawn ?? null,
  healthBefore: f2HealthBefore,
  taskkill: { code: f2Kill.code, stdout: f2Kill.stdout.trim(), stderr: f2Kill.stderr.trim() },
  holderAlive: f2HolderAlive,
  daemonAlive: f2DaemonAlive,
  healthAfter: f2HealthAfter,
  pass: !f2HolderAlive && !f2DaemonAlive && Boolean(f2HealthAfter?.error),
});

// Named mutex (CreateMutex via PowerShell)
let mutex = null;
try {
  mutex = await namedMutexProbe();
  record('MUTEX', {
    title: 'Windows named mutex via PowerShell System.Threading.Mutex',
    expected: 'second waiter BUSY/exit 2 while held; after release a new owner can create it',
    ...mutex,
    pass:
      mutex.firstHeld === true &&
      mutex.secondWhileHeld.code === 2 &&
      String(mutex.secondWhileHeld.stdout).includes('BUSY') &&
      mutex.thirdAfterRelease.code === 0 &&
      String(mutex.thirdAfterRelease.stdout).includes('HELD'),
  });
} catch (err) {
  record('MUTEX', {
    title: 'Windows named mutex via PowerShell System.Threading.Mutex',
    expected: 'second waiter BUSY while held',
    error: err.message,
    pass: false,
  });
}

const leftover = await inspectExisting(stateDir);
if (leftover.status === 'live') {
  await stopDaemon(leftover.state);
  await wait(200);
}
if (leftover.state?.pid && pidAlive(leftover.state.pid)) await killPid(leftover.state.pid);

results.finishedAt = new Date().toISOString();
results.pass = Object.values(results.steps).every((s) => s.pass);
writeJsonAtomic(resultsFile, results);

const order = ['A', 'B', 'C', 'D', 'E', 'F1', 'F2', 'MUTEX'];
for (const id of order) {
  const s = results.steps[id];
  if (!s) continue;
  process.stdout.write(`${id} ${s.pass ? 'PASS' : 'FAIL'}  ${s.title}\n`);
}
process.stdout.write(`ALL ${results.pass ? 'PASS' : 'FAIL'}  results=${resultsFile}\n`);
process.exit(results.pass ? 0 : 1);
