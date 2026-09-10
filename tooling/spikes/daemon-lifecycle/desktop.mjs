import { spawn } from 'node:child_process';
import {
  PROTOCOL_VERSION,
  DEFAULT_LOCK_PORT,
  defaultStateDir,
  daemonScript,
  parseArgs,
  emit,
  inspectExisting,
  waitForHealth,
  readState,
  wait,
  pidAlive,
} from './shared.mjs';

process.title = 'workforce-spike-desktop';

const args = parseArgs();
const stateDir = args['state-dir'] ? String(args['state-dir']) : defaultStateDir();
const lockPort = Number(args['lock-port'] ?? DEFAULT_LOCK_PORT);
const spawnMode = args['spawn-mode'] === 'attached' ? 'attached' : 'detached';
const connectOnly = Boolean(args['connect-only']);

async function attach(existing) {
  const health = existing.health ?? (await waitForHealth(existing.state.port, {
    startIdentity: existing.state.startIdentity,
    timeoutMs: 3000,
  }));
  const versionOk = health.protocolVersion === PROTOCOL_VERSION;
  emit('connected', {
    mode: 'reconnect',
    daemonPid: health.pid,
    port: health.port,
    startIdentity: health.startIdentity,
    protocolVersion: health.protocolVersion,
    versionOk,
    stateDir,
  });
  if (!versionOk) {
    emit('version-handshake', {
      expected: PROTOCOL_VERSION,
      actual: health.protocolVersion,
      note: 'field compared only; no skew matrix in this spike',
    });
  }
  return 0;
}

function spawnDaemon() {
  const childArgs = [daemonScript(), '--state-dir', stateDir, '--lock-port', String(lockPort)];
  const detached = spawnMode === 'detached';
  const child = spawn(process.execPath, childArgs, {
    detached,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (detached) child.unref();
  emit('spawned-daemon', {
    desktopPid: process.pid,
    daemonPid: child.pid,
    detached,
    unref: detached,
    stdio: 'ignore',
  });
  return child;
}

const existing = await inspectExisting(stateDir);

if (existing.status === 'live') {
  process.exit(await attach(existing));
}

if (existing.status !== 'none') {
  emit('stale-state', {
    status: existing.status,
    previousPid: existing.state?.pid ?? null,
    previousPort: existing.state?.port ?? null,
    previousStartIdentity: existing.state?.startIdentity ?? null,
  });
}

if (connectOnly) {
  emit('connect-failed', { reason: existing.status === 'none' ? 'no-daemon' : existing.status });
  process.exit(1);
}

const previousIdentity = existing.state?.startIdentity ?? null;
const child = spawnDaemon();
const deadline = Date.now() + 8000;
let state = null;
while (Date.now() < deadline) {
  state = readState(stateDir);
  // Stale daemon.json still has a port; wait until THIS child rewrites it.
  if (
    state?.port &&
    state.startIdentity &&
    state.startIdentity !== previousIdentity &&
    (state.pid === child.pid || pidAlive(state.pid))
  ) {
    break;
  }
  await wait(80);
}
if (!state?.port || state.startIdentity === previousIdentity) {
  emit('spawn-failed', {
    reason: 'state-file-not-replaced',
    childPid: child.pid,
    previousIdentity,
    observedPid: state?.pid ?? null,
  });
  process.exit(1);
}

const health = await waitForHealth(state.port, {
  startIdentity: state.startIdentity,
  timeoutMs: 5000,
});

emit('connected', {
  mode: 'spawn',
  daemonPid: health.pid,
  port: health.port,
  startIdentity: health.startIdentity,
  protocolVersion: health.protocolVersion,
  versionOk: health.protocolVersion === PROTOCOL_VERSION,
  stateDir,
  spawnMode,
});

process.exit(0);
