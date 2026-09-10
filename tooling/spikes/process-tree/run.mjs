/**
 * Windows process-tree cancellation spike.
 * Isolated experiments A–F; no extra npm deps.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const tmpRoot = path.join(repoRoot, "tooling", "spikes", ".tmp", "process-tree");
const childTreePath = path.join(__dirname, "child-tree.mjs");
const jobObjectPs1 = path.join(__dirname, "job-object.ps1");
const queryTreePs1 = path.join(__dirname, "query-tree.ps1");
const RUNNER_PID = process.pid;

const tracked = new Set();
const results = {
  env: {},
  experiments: {},
};

function log(msg) {
  const line = `[spike] ${msg}`;
  console.log(line);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function tasklistLine(pid) {
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    return out.trim();
  } catch (err) {
    return `tasklist-error: ${err.message}`;
  }
}

function execPwsh(command, timeout = 30_000) {
  return execFileSync("pwsh", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout,
  });
}

function parseJsonArray(raw) {
  const text = (raw || "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function queryTree(pids) {
  const unique = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (unique.length === 0) return [];
  try {
    const raw = execFileSync(
      "pwsh",
      ["-NoProfile", "-File", queryTreePs1, "-ProcessIds", unique.join(",")],
      { encoding: "utf8", windowsHide: true, timeout: 20_000 },
    );
    return parseJsonArray(raw);
  } catch (err) {
    return [{ error: err.message, stdout: err.stdout?.toString?.() }];
  }
}

function startTimes(pids) {
  const unique = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (unique.length === 0) return [];
  const script = `
    $ids = @(${unique.join(",")})
    $rows = Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object {
      [pscustomobject]@{
        pid = $_.Id
        name = $_.ProcessName
        startTime = if ($_.StartTime) { $_.StartTime.ToUniversalTime().ToString('o') } else { $null }
      }
    }
    if ($null -eq $rows) { '[]' } else { @($rows) | ConvertTo-Json -Compress -Depth 4 }
  `;
  try {
    return parseJsonArray(execPwsh(script));
  } catch (err) {
    return [{ error: err.message }];
  }
}

function childrenOf(pid) {
  return queryTree([pid]).filter((r) => r.parentPid === pid);
}

function processSnapshot(pids) {
  const tree = queryTree(pids);
  const times = startTimes(pids);
  const timeByPid = new Map(times.filter((r) => r.pid).map((r) => [r.pid, r]));
  return tree.map((row) => {
    const t = timeByPid.get(row.pid);
    return {
      ...row,
      startTime: t?.startTime ?? null,
      startIdentity: t?.startTime ? `win32:${row.pid}:${t.startTime}` : null,
    };
  });
}

function parsePidFile(pidFile) {
  if (!fs.existsSync(pidFile)) return [];
  return fs
    .readFileSync(pidFile, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return { kind: parts[0], a: parts[1], b: parts[2], raw: line };
    });
}

function readRolePids(dir) {
  const roles = ["parent", "grandchild-1", "grandchild-2"];
  const out = {};
  for (const role of roles) {
    const file = path.join(dir, `${role}.pid`);
    if (fs.existsSync(file)) {
      out[role] = Number(fs.readFileSync(file, "utf8").trim());
    }
  }
  return out;
}

async function waitForRoles(dir, roles, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const got = readRolePids(dir);
    if (roles.every((r) => Number.isInteger(got[r]) && got[r] > 0)) {
      return got;
    }
    await sleep(50);
  }
  throw new Error(
    `timeout waiting for roles ${roles.join(", ")} in ${dir}; have ${JSON.stringify(readRolePids(dir))}`,
  );
}

function pidStatusTable(labelPids) {
  const pids = Object.values(labelPids).filter((p) => Number.isInteger(p));
  const snap = processSnapshot(pids);
  const times = startTimes(pids);
  const byPid = new Map(snap.filter((r) => r.pid).map((r) => [r.pid, r]));
  const timeByPid = new Map(times.filter((r) => r.pid).map((r) => [r.pid, r]));
  const owned = new Set(pids.filter((p) => p !== RUNNER_PID));
  const extras = snap.filter(
    (r) => Number.isInteger(r.pid) && !pids.includes(r.pid) && owned.has(r.parentPid),
  );
  const rows = [];
  for (const [label, pid] of Object.entries(labelPids)) {
    const alive = isAlive(pid);
    const info = byPid.get(pid);
    const t = timeByPid.get(pid);
    const startTime = info?.startTime ?? t?.startTime ?? null;
    rows.push({
      label,
      pid,
      alive,
      tasklist: tasklistLine(pid),
      parentPid: info?.parentPid ?? null,
      name: info?.name ?? t?.name ?? (alive ? "unknown" : null),
      startTime,
      startIdentity: startTime ? `win32:${pid}:${startTime}` : null,
    });
  }
  for (const extra of extras) {
    rows.push({
      label: `extra:${extra.name ?? "proc"}`,
      pid: extra.pid,
      alive: isAlive(extra.pid),
      tasklist: tasklistLine(extra.pid),
      parentPid: extra.parentPid ?? null,
      name: extra.name ?? null,
      startTime: extra.startTime ?? null,
      startIdentity: extra.startIdentity ?? null,
    });
    trackPid(extra.pid);
  }
  return rows;
}

function formatTable(rows) {
  return rows
    .map(
      (r) =>
        `  ${String(r.label).padEnd(22)} pid=${String(r.pid).padEnd(8)} alive=${String(r.alive).padEnd(5)} parent=${String(r.parentPid ?? "-").padEnd(8)} ${r.name ?? ""} ${r.startIdentity ?? ""}`,
    )
    .join("\n");
}

function trackPid(pid) {
  if (Number.isInteger(pid) && pid > 0 && pid !== RUNNER_PID) tracked.add(pid);
}

function forceKillPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === RUNNER_PID) return;
  if (!isAlive(pid)) {
    tracked.delete(pid);
    return;
  }
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/F"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  tracked.delete(pid);
}

function cleanupTracked() {
  for (const pid of [...tracked]) forceKillPid(pid);
}

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    windowsHide: true,
    detached: false,
    ...options,
  });
  const prefix = options.logPrefix ?? path.basename(command);
  if (child.stdout) {
    child.stdout.on("data", (buf) => {
      for (const line of buf.toString().split(/\r?\n/).filter(Boolean)) {
        console.log(`[${prefix}:out] ${line}`);
      }
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (buf) => {
      for (const line of buf.toString().split(/\r?\n/).filter(Boolean)) {
        console.log(`[${prefix}:err] ${line}`);
      }
    });
  }
  trackPid(child.pid);
  return child;
}

function spawnTree({ dir, holdFile, detachedGrandchildren = false }) {
  ensureDir(dir);
  const pidFile = path.join(dir, "pids.txt");
  const child = spawnLogged(process.execPath, [childTreePath], {
    cwd: dir,
    env: {
      ...process.env,
      SPIKE_PID_FILE: pidFile,
      SPIKE_ROLE: "parent",
      ...(holdFile ? { SPIKE_HOLD_FILE: holdFile } : {}),
      ...(detachedGrandchildren ? { SPIKE_GC_DETACHED: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
    logPrefix: "tree",
  });
  return { child, pidFile };
}

function spawnSentinel(dir) {
  ensureDir(dir);
  const pidFile = path.join(dir, "sentinel.pid");
  const script = `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
console.log("PID sentinel " + process.pid);
setInterval(() => {}, 60000);
try { process.stdin.resume(); } catch {}
`;
  const child = spawnLogged(process.execPath, ["-e", script], {
    cwd: dir,
    env: { ...process.env, SPIKE_SENTINEL: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
    logPrefix: "sentinel",
  });
  return { child, pidFile };
}

function waitChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({
        exitCode: child.exitCode,
        signal: child.signalCode,
        killed: child.killed,
      });
      return;
    }
    const timer = setTimeout(() => {
      resolve({
        timeout: true,
        exitCode: child.exitCode,
        signal: child.signalCode,
        killed: child.killed,
      });
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, signal, killed: child.killed });
    });
  });
}

function taskkill(args) {
  const cmdline = args.map((a) => String(a)).join(" ");
  try {
    const out = execFileSync("cmd.exe", ["/d", "/c", `chcp 437>nul & taskkill ${cmdline}`], {
      encoding: "ascii",
      windowsHide: true,
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: out.trim(), stderr: "" };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || "").toString().trim(),
      stderr: (err.stderr || "").toString().trim(),
      message: err.message,
      status: err.status,
    };
  }
}

function collectEnv() {
  let pwshVersion = "unknown";
  try {
    pwshVersion = execPwsh("$PSVersionTable.PSVersion.ToString()").trim();
  } catch (err) {
    pwshVersion = `error: ${err.message}`;
  }
  return {
    date: new Date().toISOString(),
    platform: process.platform,
    osType: os.type(),
    osRelease: os.release(),
    osArch: os.arch(),
    node: process.version,
    execPath: process.execPath,
    pwsh: pwshVersion,
    cwd: process.cwd(),
    runnerPid: RUNNER_PID,
    macOS: "未测",
    linux: "未测",
  };
}

async function experimentA() {
  log("==== A: spawn tree, record parent + child pids ====");
  const dir = path.join(tmpRoot, "A");
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const { child, pidFile } = spawnTree({ dir });
  const roles = await waitForRoles(dir, ["parent", "grandchild-1", "grandchild-2"]);
  trackPid(roles["grandchild-1"]);
  trackPid(roles["grandchild-2"]);
  const before = pidStatusTable({
    runner: RUNNER_PID,
    parent: roles.parent,
    "grandchild-1": roles["grandchild-1"],
    "grandchild-2": roles["grandchild-2"],
  });
  const kidsOfParent = childrenOf(roles.parent);
  log(`spawned parent=${roles.parent} gc1=${roles["grandchild-1"]} gc2=${roles["grandchild-2"]}`);
  log("pid table:\n" + formatTable(before));
  log("toolhelp children of parent: " + JSON.stringify(kidsOfParent));
  const rec = {
    spawn: {
      execPath: process.execPath,
      args: [childTreePath],
      options: { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: false },
      childPid: child.pid,
    },
    roles,
    pidFileLines: parsePidFile(pidFile),
    table: before,
    childrenOfParent: kidsOfParent,
  };
  forceKillPid(roles.parent);
  forceKillPid(roles["grandchild-1"]);
  forceKillPid(roles["grandchild-2"]);
  await waitChildExit(child, 3000);
  rec.afterCleanup = pidStatusTable({
    parent: roles.parent,
    "grandchild-1": roles["grandchild-1"],
    "grandchild-2": roles["grandchild-2"],
  });
  return rec;
}

async function experimentB() {
  log("==== B: graceful process.kill / child.kill without /T ====");
  const dir = path.join(tmpRoot, "B");
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const { child } = spawnTree({ dir });
  const roles = await waitForRoles(dir, ["parent", "grandchild-1", "grandchild-2"]);
  trackPid(roles["grandchild-1"]);
  trackPid(roles["grandchild-2"]);
  const before = pidStatusTable(roles);
  log("before kill:\n" + formatTable(before));

  let killError = null;
  try {
    const sent = child.kill("SIGTERM");
    log(`child.kill('SIGTERM') returned ${sent}`);
  } catch (err) {
    killError = err.message;
    log(`child.kill error: ${err.message}`);
  }

  await sleep(2000);
  const after = pidStatusTable(roles);
  log("after 2s:\n" + formatTable(after));
  const parentExit = await waitChildExit(child, 100);
  const signals = parsePidFile(path.join(dir, "pids.txt")).filter((x) => x.kind === "signal");
  const orphans = ["grandchild-1", "grandchild-2"].filter(
    (k) => after.find((r) => r.label === k)?.alive,
  );
  const orphanSnap = processSnapshot(orphans.map((k) => roles[k]));

  const rec = {
    method:
      "child.kill('SIGTERM')  // Node on Windows: TerminateProcess of that pid only; not a POSIX signal",
    before,
    after,
    parentExit,
    killError,
    signalLog: signals,
    grandchildrenSurvived: orphans.length > 0,
    surviving: orphans,
    orphanReparent: orphanSnap,
  };

  for (const k of ["parent", "grandchild-1", "grandchild-2"]) forceKillPid(roles[k]);
  rec.cleaned = pidStatusTable(roles);
  return rec;
}

async function experimentB2() {
  log("==== B2/F: SIGINT vs SIGTERM vs SIGKILL vs process.kill(pid) ====");
  const methods = [
    { name: "process.kill(pid, SIGINT)", apply: (child) => process.kill(child.pid, "SIGINT") },
    { name: "process.kill(pid, SIGTERM)", apply: (child) => process.kill(child.pid, "SIGTERM") },
    { name: "child.kill(SIGKILL)", apply: (child) => child.kill("SIGKILL") },
  ];
  const recs = [];
  for (const method of methods) {
    const dir = path.join(tmpRoot, "B2", method.name.replace(/[^A-Za-z0-9]+/g, "_"));
    fs.rmSync(dir, { recursive: true, force: true });
    ensureDir(dir);
    const { child } = spawnTree({ dir });
    const roles = await waitForRoles(dir, ["parent", "grandchild-1", "grandchild-2"]);
    trackPid(roles["grandchild-1"]);
    trackPid(roles["grandchild-2"]);
    const before = pidStatusTable(roles);
    let applyResult = null;
    let applyError = null;
    try {
      applyResult = method.apply(child);
    } catch (err) {
      applyError = { message: err.message, code: err.code };
    }
    await sleep(2000);
    const after = pidStatusTable(roles);
    const parentExit = await waitChildExit(child, 100);
    const signals = parsePidFile(path.join(dir, "pids.txt")).filter((x) => x.kind === "signal");
    log(
      `${method.name}: parentAlive=${after.find((r) => r.label === "parent")?.alive} gc1=${after.find((r) => r.label === "grandchild-1")?.alive} gc2=${after.find((r) => r.label === "grandchild-2")?.alive} signals=${JSON.stringify(signals)}`,
    );
    recs.push({
      method: method.name,
      applyResult,
      applyError,
      before,
      after,
      parentExit,
      signalLog: signals,
      parentDied: !after.find((r) => r.label === "parent")?.alive,
      grandchildrenSurvived: ["grandchild-1", "grandchild-2"].some(
        (k) => after.find((r) => r.label === k)?.alive,
      ),
    });
    for (const k of Object.keys(roles)) forceKillPid(roles[k]);
  }
  return recs;
}

async function experimentB3() {
  log("==== B3: parent-only kill with DETACHED grandchildren (orphan probe) ====");
  const dir = path.join(tmpRoot, "B3");
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const { child } = spawnTree({ dir, detachedGrandchildren: true });
  const roles = await waitForRoles(dir, ["parent", "grandchild-1", "grandchild-2"]);
  trackPid(roles["grandchild-1"]);
  trackPid(roles["grandchild-2"]);
  const before = pidStatusTable(roles);
  log("before (detached gc):\n" + formatTable(before));
  const kids = childrenOf(roles.parent);
  let sent;
  try {
    sent = child.kill("SIGTERM");
  } catch (err) {
    sent = err.message;
  }
  await sleep(2000);
  const after = pidStatusTable(roles);
  log("after parent-only kill, detached gc:\n" + formatTable(after));
  const rec = {
    method:
      "SPIKE_GC_DETACHED=1 (stdio:ignore, detached:true) then child.kill('SIGTERM') on parent only",
    before,
    childrenOfParent: kids,
    killReturned: sent,
    after,
    parentDied: after.find((r) => r.label === "parent")?.alive === false,
    grandchildrenSurvived: ["grandchild-1", "grandchild-2"].some(
      (k) => after.find((r) => r.label === k)?.alive,
    ),
    surviving: ["grandchild-1", "grandchild-2"].filter(
      (k) => after.find((r) => r.label === k)?.alive,
    ),
  };
  for (const k of Object.keys(roles)) forceKillPid(roles[k]);
  rec.cleaned = pidStatusTable(roles);
  return rec;
}

async function experimentC() {
  log("==== C: taskkill /PID parent /T /F ====");
  const dir = path.join(tmpRoot, "C");
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const { child } = spawnTree({ dir });
  const roles = await waitForRoles(dir, ["parent", "grandchild-1", "grandchild-2"]);
  trackPid(roles["grandchild-1"]);
  trackPid(roles["grandchild-2"]);
  const before = pidStatusTable(roles);
  log("before taskkill /T /F:\n" + formatTable(before));
  const kill = taskkill(["/PID", String(roles.parent), "/T", "/F"]);
  log(`taskkill stdout:\n${kill.stdout}\n${kill.stderr}`);
  await sleep(500);
  const after = pidStatusTable(roles);
  log("after:\n" + formatTable(after));
  const parentExit = await waitChildExit(child, 2000);
  const rec = {
    method: "taskkill /PID <parent> /T /F",
    before,
    kill,
    after,
    parentExit,
    allDescendantsGone: after.every((r) => r.alive === false),
  };

  log(
    "==== C2: taskkill /PID parent /T /F after parent already dead (orphan hole, detached gc) ====",
  );
  const dir2 = path.join(tmpRoot, "C2");
  fs.rmSync(dir2, { recursive: true, force: true });
  ensureDir(dir2);
  const tree2 = spawnTree({ dir: dir2, detachedGrandchildren: true });
  const roles2 = await waitForRoles(dir2, ["parent", "grandchild-1", "grandchild-2"]);
  trackPid(roles2["grandchild-1"]);
  trackPid(roles2["grandchild-2"]);
  const before2 = pidStatusTable(roles2);
  let firstKill = null;
  try {
    tree2.child.kill("SIGTERM");
    firstKill = { ok: true };
  } catch (err) {
    firstKill = { ok: false, message: err.message };
  }
  await sleep(1500);
  const mid = pidStatusTable(roles2);
  const late = taskkill(["/PID", String(roles2.parent), "/T", "/F"]);
  await sleep(500);
  const after2 = pidStatusTable(roles2);
  log("C2 after parent SIGTERM then taskkill /T /F on dead parent:\n" + formatTable(after2));
  rec.orphanHole = {
    note: "If the root is already dead, Windows reparents children; taskkill /T on the old root cannot see them.",
    before: before2,
    firstKill,
    afterParentKill: mid,
    lateTaskkillOnDeadParent: late,
    after: after2,
    orphansStillAlive: ["grandchild-1", "grandchild-2"].some(
      (k) => after2.find((r) => r.label === k)?.alive,
    ),
  };
  for (const k of Object.keys(roles2)) forceKillPid(roles2[k]);
  for (const k of Object.keys(roles)) forceKillPid(roles[k]);
  return rec;
}

async function experimentD() {
  log("==== D: unrelated sentinel must survive tree kill ====");
  const dir = path.join(tmpRoot, "D");
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
  const sentinel = spawnSentinel(dir);
  const started = Date.now();
  while (!fs.existsSync(sentinel.pidFile) && Date.now() - started < 8000) {
    await sleep(50);
  }
  const sentinelPid = Number(fs.readFileSync(sentinel.pidFile, "utf8").trim());
  trackPid(sentinelPid);

  const { child } = spawnTree({ dir: path.join(dir, "tree") });
  const roles = await waitForRoles(path.join(dir, "tree"), [
    "parent",
    "grandchild-1",
    "grandchild-2",
  ]);
  trackPid(roles["grandchild-1"]);
  trackPid(roles["grandchild-2"]);

  const before = pidStatusTable({
    ...roles,
    sentinel: sentinelPid,
    runner: RUNNER_PID,
  });
  log("before tree kill:\n" + formatTable(before));

  const imageNameNote = {
    warning:
      "Adapter MUST NOT kill by image name (taskkill /IM node.exe). Tree, sentinel, runner, and often the IDE share ImageName=node.exe.",
    executed: false,
    nodeImageMatches: null,
  };
  try {
    const csv = execFileSync("tasklist", ["/FI", "IMAGENAME eq node.exe", "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    imageNameNote.nodeImageMatches = {
      count: lines.length,
      sample: lines.slice(0, 8),
      includesRunner: lines.some(
        (l) => l.includes(`"${RUNNER_PID}"`) || l.includes(`,${RUNNER_PID},`),
      ),
      includesSentinel: lines.some((l) => l.includes(`"${sentinelPid}"`)),
      includesTreeParent: lines.some((l) => l.includes(`"${roles.parent}"`)),
    };
    log(`node.exe image matches: ${lines.length} (NOT running taskkill /IM)`);
  } catch (err) {
    imageNameNote.error = err.message;
  }

  const kill = taskkill(["/PID", String(roles.parent), "/T", "/F"]);
  await sleep(500);
  const after = pidStatusTable({
    ...roles,
    sentinel: sentinelPid,
    runner: RUNNER_PID,
  });
  log("after tree kill:\n" + formatTable(after));
  await waitChildExit(child, 2000);

  const rec = {
    before,
    kill,
    after,
    imageNameNote,
    treeDead: ["parent", "grandchild-1", "grandchild-2"].every(
      (k) => after.find((r) => r.label === k)?.alive === false,
    ),
    sentinelAlive: after.find((r) => r.label === "sentinel")?.alive === true,
    runnerAlive: isAlive(RUNNER_PID),
  };

  forceKillPid(sentinelPid);
  await waitChildExit(sentinel.child, 3000);
  rec.sentinelAfterCleanup = { pid: sentinelPid, alive: isAlive(sentinelPid) };
  return rec;
}

async function experimentE() {
  log("==== E: CIM parent/child + optional Job Object ====");
  const dir = path.join(tmpRoot, "E");
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);

  const holdFile = path.join(dir, "go.flag");
  const { child } = spawnTree({ dir, holdFile });
  await waitForRoles(dir, ["parent"]);
  const parentPid = Number(fs.readFileSync(path.join(dir, "parent.pid"), "utf8").trim());
  const cimBeforeKids = {
    parent: processSnapshot([parentPid]),
    childrenOfParent: childrenOf(parentPid),
    note: "Get-CimInstance Win32_Process failed in pwsh 7.6.6 from Node (MMI type initializer). Used Toolhelp32 + Get-Process.StartTime instead.",
  };

  const closeFlag = path.join(dir, "close-job.flag");
  const statusFile = path.join(dir, "job-status.json");
  const jobProc = spawnLogged(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      jobObjectPs1,
      "-ProcessId",
      String(parentPid),
      "-CloseFlag",
      closeFlag,
      "-StatusFile",
      statusFile,
    ],
    { logPrefix: "job", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: false },
  );

  const jobWaitStart = Date.now();
  while (!fs.existsSync(statusFile) && Date.now() - jobWaitStart < 20_000) {
    await sleep(50);
  }
  let jobStatus = null;
  if (fs.existsSync(statusFile)) {
    try {
      jobStatus = JSON.parse(fs.readFileSync(statusFile, "utf8").replace(/^\uFEFF/, ""));
    } catch (err) {
      jobStatus = { parseError: err.message, raw: fs.readFileSync(statusFile, "utf8") };
    }
  } else {
    jobStatus = { ok: false, stage: "no-status-file" };
  }
  log(`job object status: ${JSON.stringify(jobStatus)}`);

  fs.writeFileSync(holdFile, "go\n");
  const roles = await waitForRoles(dir, ["parent", "grandchild-1", "grandchild-2"], 15_000);
  trackPid(roles["grandchild-1"]);
  trackPid(roles["grandchild-2"]);
  const assignedTable = pidStatusTable(roles);
  const kids = childrenOf(roles.parent);

  let afterClose = null;
  let closedStatus = jobStatus;
  if (jobStatus && jobStatus.ok && jobStatus.stage === "assigned") {
    fs.writeFileSync(closeFlag, "close\n");
    await waitChildExit(jobProc, 10_000);
    await sleep(800);
    afterClose = pidStatusTable(roles);
    if (fs.existsSync(statusFile)) {
      try {
        closedStatus = JSON.parse(fs.readFileSync(statusFile, "utf8").replace(/^\uFEFF/, ""));
      } catch {
        // keep previous
      }
    }
    log("after job close:\n" + formatTable(afterClose));
  } else {
    log("Job Object assign failed or unavailable; tree left for CIM snapshot then cleanup.");
    try {
      jobProc.kill();
    } catch {
      // ignore
    }
  }

  const rec = {
    cimBeforeKids,
    jobStatus,
    closedStatus,
    assignedTable,
    childrenOfParent: kids,
    afterClose,
    jobObjectWorked: Boolean(
      jobStatus && jobStatus.ok && afterClose && afterClose.every((r) => r.alive === false),
    ),
    note: "Node child_process cannot create a Win32 Job Object without native bindings. This spike uses PowerShell Add-Type P/Invoke (no npm). AssignProcessToJobObject fails when the process is already in a non-breakaway job (common under Windows Terminal, VS Code, Cursor).",
  };

  for (const k of Object.keys(roles)) forceKillPid(roles[k]);
  forceKillPid(jobProc.pid);
  await waitChildExit(child, 2000);
  return rec;
}

async function main() {
  ensureDir(tmpRoot);
  results.env = collectEnv();
  log(`env ${JSON.stringify(results.env, null, 2)}`);

  process.on("exit", () => {
    cleanupTracked();
  });
  process.on("SIGINT", () => {
    cleanupTracked();
    process.exit(130);
  });
  process.on("uncaughtException", (err) => {
    console.error(err);
    cleanupTracked();
    process.exit(1);
  });

  try {
    results.experiments.A = await experimentA();
    results.experiments.B = await experimentB();
    results.experiments.B2 = await experimentB2();
    results.experiments.B3 = await experimentB3();
    results.experiments.C = await experimentC();
    results.experiments.D = await experimentD();
    results.experiments.E = await experimentE();
  } finally {
    cleanupTracked();
  }

  const summary = {
    gracefulChildKillKillsWholeTree: results.experiments.B?.grandchildrenSurvived === false,
    grandchildrenSurvivedGracefulInherit: results.experiments.B?.grandchildrenSurvived,
    grandchildrenSurvivedGracefulDetached: results.experiments.B3?.grandchildrenSurvived,
    taskkillTFKillsWholeTree: results.experiments.C?.allDescendantsGone,
    orphanHoleAfterParentFirst: results.experiments.C?.orphanHole?.orphansStillAlive,
    sentinelSurvivedTreeKill: results.experiments.D?.sentinelAlive,
    jobObjectWorked: results.experiments.E?.jobObjectWorked,
    signalHandlersFired: {
      B: results.experiments.B?.signalLog ?? [],
      B2: (results.experiments.B2 ?? []).map((x) => ({ method: x.method, signalLog: x.signalLog })),
    },
  };
  results.summary = summary;
  const outJson = path.join(tmpRoot, "results.json");
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2), "utf8");
  log(`wrote ${outJson}`);
  log(`SUMMARY ${JSON.stringify(summary, null, 2)}`);
}

await main();
