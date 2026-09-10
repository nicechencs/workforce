#!/usr/bin/env node
/**
 * Repeatable Git worktree anomaly spike (Windows).
 *
 *   node tooling/spikes/git-worktree/run.mjs [--keep]
 *
 * Creates a throwaway repo under tooling/spikes/.tmp/git-worktree/ only.
 * Never touches the product repository's history, remotes, or worktrees.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here);
const repoRoot = path.resolve(here, "..", "..", "..");
const tmpRoot = path.resolve(repoRoot, "tooling", "spikes", ".tmp", "git-worktree");
const mainRepo = path.join(tmpRoot, "main-repo");
const lockHold = path.join(spikeRoot, "lock-hold.mjs");
const lockHoldShareNone = path.join(spikeRoot, "lock-hold-share-none.ps1");
const keep = process.argv.includes("--keep");

const gitEnv = {
  ...process.env,
  LC_ALL: "C",
  LANG: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "spike",
  GIT_AUTHOR_EMAIL: "spike@example.invalid",
  GIT_COMMITTER_NAME: "spike",
  GIT_COMMITTER_EMAIL: "spike@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: path.join(tmpRoot, "empty-gitconfig"),
};

const children = [];
const findings = [];

function log(line = "") {
  process.stdout.write(`${line}\n`);
}

function heading(title) {
  log("");
  log("=".repeat(78));
  log(title);
  log("=".repeat(78));
}

function rel(p) {
  return path.relative(tmpRoot, p) || ".";
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (err) {
    return `<unreadable: ${err.message}>`;
  }
}

function safeStat(p) {
  try {
    const s = fs.statSync(p);
    return {
      ino: s.ino,
      size: s.size,
      nlink: s.nlink,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
    };
  } catch (err) {
    return { error: err.message };
  }
}

function run(cmd, args, cwd, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env: gitEnv,
    encoding: "utf8",
    windowsHide: true,
    timeout: opts.timeout ?? 60_000,
  });
  const rec = {
    cmd: [cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" "),
    cwd: cwd ? rel(cwd) : "(none)",
    cwdAbs: cwd || "",
    exit: result.status === null ? `signal:${result.signal}` : result.status,
    stdout: (result.stdout || "").replace(/\r\n/g, "\n").trimEnd(),
    stderr: (result.stderr || "").replace(/\r\n/g, "\n").trimEnd(),
    error: result.error ? result.error.message : "",
  };
  log(`$ ${rec.cmd}`);
  log(`  cwd=${cwd || "(none)"}`);
  log(`  exit=${rec.exit}`);
  if (rec.stdout) {
    for (const line of rec.stdout.split("\n")) log(`  | ${line}`);
  }
  if (rec.stderr) {
    for (const line of rec.stderr.split("\n")) log(`  ! ${line}`);
  }
  if (rec.error) log(`  error=${rec.error}`);
  return rec;
}

function git(args, cwd = mainRepo, opts) {
  return run("git", ["-c", "core.hooksPath=", ...args], cwd, opts);
}

function note(id, expected, actual, extra = {}) {
  const item = { id, expected, actual, ...extra };
  findings.push(item);
  log(`  EXPECTED: ${expected}`);
  log(`  ACTUAL:   ${actual}`);
}

function listDir(p) {
  try {
    return fs.readdirSync(p);
  } catch (err) {
    return [`<error ${err.message}>`];
  }
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function spawnLocker(file, flags = "r+") {
  const child = spawn(process.execPath, [lockHold, file, flags], {
    cwd: tmpRoot,
    env: gitEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (b) => {
    out += b.toString("utf8");
  });
  child.stderr.on("data", (b) => {
    err += b.toString("utf8");
  });
  return { child, getOut: () => out.trim(), getErr: () => err.trim() };
}

function spawnShareNone(file) {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", lockHoldShareNone, file],
    {
      cwd: tmpRoot,
      env: gitEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  children.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (b) => {
    out += b.toString("utf8");
  });
  child.stderr.on("data", (b) => {
    err += b.toString("utf8");
  });
  return { child, getOut: () => out.trim(), getErr: () => err.trim() };
}

function spawnCwdHold(dir) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "setInterval(() => {}, 1 << 30); process.stdout.write('CWD_HOLD pid=' + process.pid + '\\n')",
    ],
    {
      cwd: dir,
      env: gitEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  children.push(child);
  let out = "";
  child.stdout.on("data", (b) => {
    out += b.toString("utf8");
  });
  return { child, getOut: () => out.trim() };
}

function waitFor(pred, ms = 3000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred()) return resolve(true);
      if (Date.now() - start > ms) return reject(new Error("timeout waiting for lock"));
      setTimeout(tick, 40);
    };
    tick();
  });
}

function killChild(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    child.kill();
  } catch {
    // ignore
  }
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      encoding: "utf8",
    });
  }
}

function killAllChildren() {
  for (const c of children) killChild(c);
}

function nestedPath(root, targetLen, component = "x".repeat(20)) {
  let p = root;
  while (p.length + 1 + component.length < targetLen) {
    p = path.join(p, component);
  }
  const remain = targetLen - p.length - 1;
  if (remain >= 1) p = path.join(p, "y".repeat(remain));
  return p;
}

function dumpWorktrees(label, cwd = mainRepo) {
  log(`-- ${label} --`);
  git(["worktree", "list", "--porcelain"], cwd);
  const gitDir = path.join(cwd, ".git");
  const wtMeta = path.join(gitDir, "worktrees");
  log(
    `  worktrees metadata dir exists=${exists(wtMeta)} entries=${exists(wtMeta) ? listDir(wtMeta).join(",") : ""}`,
  );
  if (exists(wtMeta)) {
    for (const name of listDir(wtMeta)) {
      const dir = path.join(wtMeta, name);
      log(`  meta ${name}: ${listDir(dir).join(", ")}`);
      const gitdirFile = path.join(dir, "gitdir");
      if (exists(gitdirFile)) log(`    gitdir=${readText(gitdirFile).trim()}`);
      const locked = path.join(dir, "locked");
      if (exists(locked)) log(`    locked=${readText(locked).trim()}`);
    }
  }
}

function assertTempRepo(cwd) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  const common = git(["rev-parse", "--git-common-dir"], cwd);
  const topAbs = path.resolve(cwd, (top.stdout || "").trim());
  const commonAbs = path.resolve(cwd, (common.stdout || "").trim());
  const expectedTop = path.resolve(cwd);
  if (path.resolve(topAbs) !== expectedTop && !expectedTop.startsWith(path.resolve(mainRepo))) {
    throw new Error(`safety abort: toplevel ${topAbs} is not the temp repo`);
  }
  if (!path.resolve(commonAbs).toLowerCase().startsWith(path.resolve(mainRepo).toLowerCase())) {
    throw new Error(`safety abort: git-common-dir ${commonAbs} escaped temp repo`);
  }
}

async function setup() {
  heading("0. Environment + sandbox setup");
  log(`os=${os.version()} ${os.release()} ${os.platform()} ${os.arch()}`);
  log(`node=${process.version}`);
  run("git", ["--version"], spikeRoot);
  run(
    "reg",
    ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem", "/v", "LongPathsEnabled"],
    spikeRoot,
  );
  run("whoami", ["/priv"], spikeRoot);
  log(`tmpRoot=${tmpRoot}`);
  log(`mainRepo=${mainRepo}`);
  log(`productRepoRoot=${repoRoot} (not used as guinea pig)`);

  killAllChildren();
  if (exists(tmpRoot)) {
    log("removing leftover tmp from previous run");
    const r = rmrf(tmpRoot);
    if (!r.ok) log(`leftover rm failed: ${r.error}`);
  }
  fs.mkdirSync(tmpRoot, { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, "empty-gitconfig"), "# spike isolated gitconfig\n");
  fs.mkdirSync(mainRepo, { recursive: true });

  git(["init", "-b", "main"], mainRepo);
  git(["config", "user.name", "spike"], mainRepo);
  git(["config", "user.email", "spike@example.invalid"], mainRepo);
  git(["config", "core.autocrlf", "false"], mainRepo);
  git(["config", "core.hooksPath", ""], mainRepo);
  git(["config", "--list", "--local", "--show-origin"], mainRepo);
  git(["config", "--get", "core.ignoreCase"], mainRepo);
  git(["config", "--get", "core.longpaths"], mainRepo);

  fs.writeFileSync(path.join(mainRepo, "README.md"), "committed-v1\n");
  fs.writeFileSync(path.join(mainRepo, "shared.txt"), "shared-base\n");
  fs.writeFileSync(path.join(mainRepo, "only-a.txt"), "a-base\n");
  fs.writeFileSync(path.join(mainRepo, "only-b.txt"), "b-base\n");
  fs.mkdirSync(path.join(mainRepo, "src"), { recursive: true });
  fs.writeFileSync(path.join(mainRepo, "src", "app.js"), "console.log('app');\n");
  git(["add", "."], mainRepo);
  git(["commit", "-m", "init spike repo"], mainRepo);
  git(["rev-parse", "HEAD"], mainRepo);
  git(["status", "--porcelain=v1"], mainRepo);
  assertTempRepo(mainRepo);
  dumpWorktrees("after init");
}

async function scenarioA() {
  heading("A. Clean repo: worktree add with spaces in path");
  const wt = path.join(tmpRoot, "wt a spaces");
  const rec = git(["worktree", "add", wt, "-b", "run-a"], mainRepo);
  const readme = exists(path.join(wt, "README.md"))
    ? readText(path.join(wt, "README.md")).trim()
    : "<missing>";
  const gitFile = exists(path.join(wt, ".git"))
    ? readText(path.join(wt, ".git")).trim()
    : "<missing>";
  log(`  worktree README=${JSON.stringify(readme)}`);
  log(`  worktree .git file=${JSON.stringify(gitFile)}`);
  git(["branch", "--show-current"], wt);
  git(["rev-parse", "--git-dir"], wt);
  git(["rev-parse", "--git-common-dir"], wt);
  dumpWorktrees("after A");
  const ok = rec.exit === 0 && readme === "committed-v1" && /gitdir:/i.test(gitFile);
  note(
    "A",
    "worktree add succeeds on a path with spaces; checkout is a clean committed tree; .git is a gitdir file",
    ok
      ? `success exit=${rec.exit} README=${readme} gitdir pointer present`
      : `exit=${rec.exit} README=${readme} git=${gitFile} stderr=${rec.stderr}`,
    { path: wt, gitFile },
  );
  return wt;
}

async function scenarioB() {
  heading("B. Dirty main: uncommitted tracked + untracked, then worktree add");
  fs.writeFileSync(path.join(mainRepo, "README.md"), "DIRTY-MAIN-UNCOMMITTED\n");
  fs.writeFileSync(path.join(mainRepo, "untracked-only.txt"), "untracked-on-main\n");
  git(["status", "--porcelain=v1"], mainRepo);
  const wt = path.join(tmpRoot, "wt-b-dirty");
  const rec = git(["worktree", "add", wt, "-b", "run-b"], mainRepo);
  const wtReadme = exists(path.join(wt, "README.md"))
    ? readText(path.join(wt, "README.md")).trim()
    : "<missing>";
  const mainReadme = readText(path.join(mainRepo, "README.md")).trim();
  const leakUntracked = exists(path.join(wt, "untracked-only.txt"));
  git(["status", "--porcelain=v1"], wt);
  git(["status", "--porcelain=v1"], mainRepo);
  const isolated =
    rec.exit === 0 &&
    wtReadme === "committed-v1" &&
    mainReadme === "DIRTY-MAIN-UNCOMMITTED" &&
    !leakUntracked;
  note(
    "B",
    "worktree add succeeds while main is dirty; dirty/untracked files do not leak into the new worktree",
    isolated
      ? `add ok; worktree README=${wtReadme}; main still dirty; untracked leak=${leakUntracked}`
      : `exit=${rec.exit} wtREADME=${wtReadme} mainREADME=${mainReadme} untrackedLeak=${leakUntracked} stderr=${rec.stderr}`,
    { leakUntracked, wtReadme, mainReadme },
  );

  heading("B2. git worktree add <path> with no -b (Git convenience branch)");
  const wtSame = path.join(tmpRoot, "wt-b-same-branch");
  const recSame = git(["worktree", "add", wtSame], mainRepo);
  const impliedBranch = git(["branch", "--show-current"], wtSame);
  note(
    "B2",
    "modern Git: worktree add <path> with no -b creates a NEW branch named basename(path), it does not reuse main",
    `exit=${recSame.exit} branch=${impliedBranch.stdout} stderr=${recSame.stderr} stdout=${recSame.stdout}`,
  );

  heading("B3. Explicit second checkout of already-used branch `main`");
  const wtMain2 = path.join(tmpRoot, "wt-b-main-again");
  const recMain2 = git(["worktree", "add", wtMain2, "main"], mainRepo);
  note(
    "B3",
    "git worktree add <path> main fails because main is already checked out in the primary worktree",
    recMain2.exit === 0
      ? `UNEXPECTED success stdout=${recMain2.stdout}`
      : `failed exit=${recMain2.exit} stderr=${recMain2.stderr}`,
  );

  heading("B4. --force second checkout of an already-used branch");
  const wtForce = path.join(tmpRoot, "wt-b-force-main");
  const recForce = git(["worktree", "add", "--force", wtForce, "main"], mainRepo);
  note(
    "B4",
    "git worktree add --force <path> main may allow a second checkout of the same branch (dangerous shared HEAD)",
    `exit=${recForce.exit} stderr=${recForce.stderr} stdout=${recForce.stdout} exists=${exists(wtForce)}`,
  );
  if (exists(wtForce)) {
    git(["worktree", "remove", "--force", wtForce], mainRepo);
  }
  return wt;
}

async function scenarioC() {
  heading("C. Two concurrent worktrees: independent edits, same relative path");
  const wt1 = path.join(tmpRoot, "wt-c1");
  const wt2 = path.join(tmpRoot, "wt-c2");
  git(["worktree", "add", wt1, "-b", "run-c1"], mainRepo);
  git(["worktree", "add", wt2, "-b", "run-c2"], mainRepo);
  fs.writeFileSync(path.join(wt1, "shared.txt"), "edited-in-c1\n");
  fs.writeFileSync(path.join(wt1, "only-a.txt"), "c1-only-a\n");
  fs.writeFileSync(path.join(wt2, "shared.txt"), "edited-in-c2\n");
  fs.writeFileSync(path.join(wt2, "only-b.txt"), "c2-only-b\n");
  const c1Shared = readText(path.join(wt1, "shared.txt")).trim();
  const c2Shared = readText(path.join(wt2, "shared.txt")).trim();
  const mainShared = readText(path.join(mainRepo, "shared.txt")).trim();
  const c1b = readText(path.join(wt1, "only-b.txt")).trim();
  const c2a = readText(path.join(wt2, "only-a.txt")).trim();
  log(`  c1/shared=${c1Shared} c2/shared=${c2Shared} main/shared=${mainShared}`);
  log(`  c1/only-b (untouched)=${c1b} c2/only-a (untouched)=${c2a}`);
  const ino1 = safeStat(path.join(wt1, "shared.txt"));
  const ino2 = safeStat(path.join(wt2, "shared.txt"));
  log(`  stat c1=${JSON.stringify(ino1)} c2=${JSON.stringify(ino2)}`);
  git(["add", "shared.txt", "only-a.txt"], wt1);
  git(["commit", "-m", "c1 edits"], wt1);
  git(["add", "shared.txt", "only-b.txt"], wt2);
  git(["commit", "-m", "c2 edits"], wt2);
  git(["log", "-1", "--oneline"], wt1);
  git(["log", "-1", "--oneline"], wt2);
  git(["log", "-1", "--oneline"], mainRepo);
  const independent =
    c1Shared === "edited-in-c1" &&
    c2Shared === "edited-in-c2" &&
    mainShared === "shared-base" &&
    c1b === "b-base" &&
    c2a === "a-base";
  note(
    "C",
    "two worktrees can edit the same relative path independently; main stays clean of those edits",
    independent
      ? `isolated: c1=${c1Shared} c2=${c2Shared} main=${mainShared}; inodes c1=${ino1.ino} c2=${ino2.ino}`
      : `LEAK c1=${c1Shared} c2=${c2Shared} main=${mainShared}`,
  );
  note(
    "I",
    "worktrees do not share working files (independent checkouts)",
    independent && ino1.ino !== ino2.ino
      ? `independent contents and different inodes (${ino1.ino} vs ${ino2.ino})`
      : independent
        ? `independent contents; inode compare inconclusive c1=${ino1.ino} c2=${ino2.ino} (Windows inodes may collide)`
        : "working files were not independent",
  );
  return { wt1, wt2 };
}

async function scenarioD() {
  heading("D. git worktree remove while a file is open (Windows lock)");
  const wt = path.join(tmpRoot, "wt-d-lock");
  git(["worktree", "add", wt, "-b", "run-d"], mainRepo);
  const lockedFile = path.join(wt, "src", "app.js");
  const locker = spawnLocker(lockedFile, "r+");
  await waitFor(() => /LOCKED/.test(locker.getOut())).catch((err) =>
    log(`  lock wait: ${err.message} out=${locker.getOut()} err=${locker.getErr()}`),
  );
  log(
    `  locker: ${locker.getOut() || locker.getErr() || "(no output yet)"} pid=${locker.child.pid}`,
  );

  const removeLocked = git(["worktree", "remove", wt], mainRepo);
  const stillThere = exists(wt);
  const listAfter = git(["worktree", "list"], mainRepo);
  note(
    "D-open-handle",
    "Node fs.openSync uses FILE_SHARE_DELETE on Windows; git worktree remove may succeed even while the Node handle is open",
    `exit=${removeLocked.exit} exists=${stillThere} lockerAlive=${locker.child.exitCode === null} stderr=${removeLocked.stderr} stdout=${removeLocked.stdout} listHasWt=${/wt-d-lock/.test(listAfter.stdout)}`,
    { exists: stillThere },
  );
  killChild(locker.child);

  heading("D2. FileShare.None (native Windows lock) then worktree remove");
  const wtShare = path.join(tmpRoot, "wt-d-share-none");
  git(["worktree", "add", wtShare, "-b", "run-d-share"], mainRepo);
  const shareFile = path.join(wtShare, "src", "app.js");
  const shareLocker = spawnShareNone(shareFile);
  await waitFor(() => /LOCKED/.test(shareLocker.getOut())).catch((err) =>
    log(
      `  share-none wait: ${err.message} out=${shareLocker.getOut()} err=${shareLocker.getErr()}`,
    ),
  );
  log(
    `  share-none: ${shareLocker.getOut() || shareLocker.getErr() || "(no output)"} pid=${shareLocker.child.pid}`,
  );
  const removeShare = git(["worktree", "remove", wtShare], mainRepo);
  const shareExists = exists(wtShare);
  note(
    "D-share-none",
    "FileShare.None should block unlink; git worktree remove fails or leaves the locked file/dir",
    `exit=${removeShare.exit} exists=${shareExists} stderr=${removeShare.stderr} stdout=${removeShare.stdout}`,
  );
  heading("D2b. remove --force while FileShare.None still held");
  const removeShareForce = git(["worktree", "remove", "--force", wtShare], mainRepo);
  dumpWorktrees("after share-none remove --force");
  note(
    "D-share-none-force",
    "--force does not override OS FileShare.None; may still fail AND may unregister the worktree leaving a leftover dir",
    `exit=${removeShareForce.exit} exists=${exists(wtShare)} stderr=${removeShareForce.stderr} stdout=${removeShareForce.stdout}`,
  );
  killChild(shareLocker.child);
  await new Promise((r) => setTimeout(r, 400));
  if (exists(wtShare)) {
    const retryShare = git(["worktree", "remove", "--force", wtShare], mainRepo);
    log(
      `  retry after share-none kill: exit=${retryShare.exit} exists=${exists(wtShare)} stderr=${retryShare.stderr}`,
    );
    if (exists(wtShare)) {
      const r = rmrf(wtShare);
      log(`  fs.rmSync after share-none: ok=${r.ok} ${r.error || ""}`);
      git(["worktree", "prune", "-v"], mainRepo);
    }
  }

  heading("D3. process with cwd inside worktree");
  const wtCwd = path.join(tmpRoot, "wt-d-cwd");
  git(["worktree", "add", wtCwd, "-b", "run-d-cwd"], mainRepo);
  const holder = spawnCwdHold(wtCwd);
  await waitFor(() => /CWD_HOLD/.test(holder.getOut())).catch((err) =>
    log(`  cwd hold wait: ${err.message}`),
  );
  log(`  cwd-holder pid=${holder.child.pid} out=${holder.getOut()}`);
  const removeCwd = git(["worktree", "remove", "--force", wtCwd], mainRepo);
  const cwdStill = exists(wtCwd);
  dumpWorktrees("immediately after cwd-hold remove --force (before killing holder)");
  note(
    "D-cwd-hold",
    "a process whose cwd is the worktree locks the directory; remove may fail with Permission denied and/or unregister metadata leaving a leftover dir",
    `exit=${removeCwd.exit} exists=${cwdStill} stderr=${removeCwd.stderr} stdout=${removeCwd.stdout}`,
  );
  killChild(holder.child);
  await new Promise((r) => setTimeout(r, 400));
  if (exists(wtCwd)) {
    const retry = git(["worktree", "remove", "--force", wtCwd], mainRepo);
    log(
      `  retry after cwd-hold kill: exit=${retry.exit} exists=${exists(wtCwd)} stderr=${retry.stderr}`,
    );
    if (exists(wtCwd)) {
      const r = rmrf(wtCwd);
      log(`  fs.rmSync after cwd-hold: ok=${r.ok} ${r.error || ""}`);
      git(["worktree", "prune"], mainRepo);
    }
  }
  dumpWorktrees("after D");
}

async function scenarioE() {
  heading("E. remove --force, prune, leftover dirs after crash-style delete");
  const wt = path.join(tmpRoot, "wt-e-prune");
  git(["worktree", "add", wt, "-b", "run-e"], mainRepo);
  fs.writeFileSync(path.join(wt, "README.md"), "dirty-in-e\n");
  heading("E1. remove without --force on dirty worktree");
  const removeDirty = git(["worktree", "remove", wt], mainRepo);
  note(
    "E-dirty-remove",
    "remove of a dirty worktree fails without --force",
    `exit=${removeDirty.exit} exists=${exists(wt)} stderr=${removeDirty.stderr}`,
  );
  heading("E2. remove --force on dirty worktree");
  const removeForce = git(["worktree", "remove", "--force", wt], mainRepo);
  note(
    "E-force-remove",
    "remove --force deletes a dirty worktree when no OS lock is held",
    `exit=${removeForce.exit} exists=${exists(wt)} stderr=${removeForce.stderr}`,
  );

  heading("E3. crash-style: delete worktree directory, leave git metadata");
  const wtCrash = path.join(tmpRoot, "wt-e-crash");
  git(["worktree", "add", wtCrash, "-b", "run-e-crash"], mainRepo);
  const gitFile = readText(path.join(wtCrash, ".git")).trim();
  log(`  crash target gitfile=${gitFile}`);
  const rm = rmrf(wtCrash);
  log(`  fs.rmSync worktree dir ok=${rm.ok} ${rm.error || ""}`);
  dumpWorktrees("after crash-style delete (before prune)");
  git(["worktree", "list"], mainRepo);
  heading("E4. prune stale worktree metadata");
  const prune = git(["worktree", "prune", "-v"], mainRepo);
  dumpWorktrees("after prune");
  const metaDir = path.join(mainRepo, ".git", "worktrees");
  const leftoverMeta = exists(metaDir)
    ? listDir(metaDir).filter(
        (n) =>
          n.startsWith("wt-e") || n.includes("run-e") || n.includes("crash") || n.includes("prune"),
      )
    : [];
  note(
    "E-prune",
    "after deleting a worktree dir without git worktree remove, list shows prunable; prune clears metadata",
    `prune exit=${prune.exit} stdout=${prune.stdout} stderr=${prune.stderr} meta entries now=${exists(metaDir) ? listDir(metaDir).join(",") : "(none)"} leftoverFilter=${leftoverMeta.join(",")}`,
  );
}

async function scenarioF() {
  heading("F. Locked index / gitdir / worktree lock / repair");
  const wt = path.join(tmpRoot, "wt-f-index");
  git(["worktree", "add", wt, "-b", "run-f"], mainRepo);
  const gitDir = git(["rev-parse", "--absolute-git-dir"], wt).stdout.trim();
  log(`  worktree git-dir=${gitDir}`);
  const indexPath = path.join(gitDir, "index");
  const gitdirFile = path.join(gitDir, "gitdir");
  log(`  index exists=${exists(indexPath)} gitdir file exists=${exists(gitdirFile)}`);

  heading("F1. stale index.lock");
  const indexLock = path.join(gitDir, "index.lock");
  fs.writeFileSync(indexLock, `${process.pid}\n`);
  const statusLocked = git(["status"], wt);
  const addLocked = git(["add", "README.md"], wt);
  note(
    "F-index.lock",
    "stale index.lock: git status may still run (optional locks); git add/commit must fail with unable to create index.lock",
    `status exit=${statusLocked.exit} stderr=${statusLocked.stderr} stdout=${(statusLocked.stdout || "").split("\n")[0]}; add exit=${addLocked.exit} stderr=${addLocked.stderr}`,
  );
  fs.unlinkSync(indexLock);
  const statusOk = git(["status", "--porcelain=v1"], wt);
  log(`  status after removing index.lock exit=${statusOk.exit}`);

  heading("F2. open handle on worktree index");
  const idxLocker = spawnLocker(indexPath, "r+");
  await waitFor(() => /LOCKED/.test(idxLocker.getOut())).catch((err) => log(`  ${err.message}`));
  log(`  index locker ${idxLocker.getOut()}`);
  fs.writeFileSync(path.join(wt, "README.md"), "f2-dirty\n");
  const addWhileLocked = git(["add", "README.md"], wt);
  const commitWhileLocked = git(["commit", "-m", "should fail if index locked"], wt);
  note(
    "F-index-handle",
    "open handle on worktree index may block add/commit on Windows",
    `add exit=${addWhileLocked.exit} stderr=${addWhileLocked.stderr}; commit exit=${commitWhileLocked.exit} stderr=${commitWhileLocked.stderr}`,
  );
  killChild(idxLocker.child);
  await new Promise((r) => setTimeout(r, 300));

  heading("F2b. FileShare.None on worktree index");
  fs.writeFileSync(path.join(wt, "README.md"), "f2b-dirty\n");
  const idxShare = spawnShareNone(indexPath);
  await waitFor(() => /LOCKED/.test(idxShare.getOut())).catch((err) =>
    log(`  ${err.message} err=${idxShare.getErr()}`),
  );
  log(`  index share-none ${idxShare.getOut() || idxShare.getErr()}`);
  const addShare = git(["add", "README.md"], wt);
  const commitShare = git(["commit", "-m", "index share none"], wt);
  note(
    "F-index-share-none",
    "FileShare.None on worktree index should block git add/commit",
    `add exit=${addShare.exit} stderr=${addShare.stderr}; commit exit=${commitShare.exit} stderr=${commitShare.stderr}`,
  );
  killChild(idxShare.child);
  await new Promise((r) => setTimeout(r, 300));

  heading("F3. open handle on gitdir file during remove");
  const gdLocker = spawnLocker(gitdirFile, "r+");
  await waitFor(() => /LOCKED/.test(gdLocker.getOut())).catch((err) => log(`  ${err.message}`));
  const removeGitdirLock = git(["worktree", "remove", "--force", wt], mainRepo);
  note(
    "F-gitdir-handle",
    "open handle on .git/worktrees/<name>/gitdir may block remove/prune metadata cleanup",
    `exit=${removeGitdirLock.exit} exists=${exists(wt)} stderr=${removeGitdirLock.stderr} stdout=${removeGitdirLock.stdout}`,
  );
  killChild(gdLocker.child);
  await new Promise((r) => setTimeout(r, 300));
  if (exists(wt)) {
    git(["worktree", "remove", "--force", wt], mainRepo);
  } else {
    git(["worktree", "prune", "-v"], mainRepo);
  }

  heading("F4. git worktree lock / unlock");
  const wtLock = path.join(tmpRoot, "wt-f-lock");
  git(["worktree", "add", wtLock, "-b", "run-f-lock"], mainRepo);
  git(["worktree", "lock", wtLock, "--reason", "spike-keep-until-artifact"], mainRepo);
  dumpWorktrees("locked worktree");
  const removeLocked = git(["worktree", "remove", "--force", wtLock], mainRepo);
  note(
    "F-worktree-lock",
    "git worktree lock should prevent remove even with --force",
    `exit=${removeLocked.exit} exists=${exists(wtLock)} stderr=${removeLocked.stderr}`,
  );
  git(["worktree", "unlock", wtLock], mainRepo);
  const removeUnlocked = git(["worktree", "remove", "--force", wtLock], mainRepo);
  note(
    "F-worktree-unlock",
    "after unlock, remove --force succeeds",
    `exit=${removeUnlocked.exit} exists=${exists(wtLock)} stderr=${removeUnlocked.stderr}`,
  );

  heading("F5. moved worktree + git worktree repair");
  const wtMove = path.join(tmpRoot, "wt-f-move");
  const wtMoved = path.join(tmpRoot, "wt-f-moved");
  git(["worktree", "add", wtMove, "-b", "run-f-move"], mainRepo);
  fs.renameSync(wtMove, wtMoved);
  log("  renamed worktree directory without git worktree move");
  dumpWorktrees("after manual rename (before repair)");
  const listBroken = git(["worktree", "list"], mainRepo);
  const repair = git(["worktree", "repair", wtMoved], mainRepo);
  dumpWorktrees("after repair");
  git(["status", "--porcelain=v1"], wtMoved);
  note(
    "F-repair",
    "after moving a worktree dir, list is broken/prunable; git worktree repair <newpath> restores gitdir pointers",
    `listBefore=${listBroken.stdout} ${listBroken.stderr}; repair exit=${repair.exit} stdout=${repair.stdout} stderr=${repair.stderr}`,
  );
  git(["worktree", "remove", "--force", wtMoved], mainRepo);
}

async function scenarioG() {
  heading("G. Path length, case, junction/symlink");
  const baseLen = tmpRoot.length;
  log(`  tmpRoot length=${baseLen} chars: ${tmpRoot}`);

  heading("G1. long path worktree add (approach MAX_PATH=260)");
  const lengths = [200, 240, 258, 280, 320];
  for (const n of lengths) {
    const p = nestedPath(path.join(tmpRoot, `g${n}`), n);
    log(`  target len=${n} actual=${p.length} path=${p}`);
    let mkdirErr = "";
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
    } catch (err) {
      mkdirErr = err.message;
    }
    const rec = mkdirErr
      ? { exit: "mkdir-failed", stdout: "", stderr: mkdirErr }
      : git(["worktree", "add", p, "-b", `run-g-${n}`], mainRepo);
    const added = rec.exit === 0 && exists(path.join(p, "README.md"));
    note(
      `G-long-${n}`,
      `worktree add at ~${n} chars (MAX_PATH=260; OS LongPathsEnabled=1 on this machine)`,
      `pathLen=${p.length} mkdirErr=${mkdirErr || "none"} exit=${rec.exit} added=${added} stderr=${rec.stderr}`,
      { pathLength: p.length, path: p },
    );
    if (added) {
      git(["worktree", "remove", "--force", p], mainRepo);
    } else if (exists(p) || exists(path.dirname(p))) {
      git(["worktree", "prune", "-v"], mainRepo);
      rmrf(path.join(tmpRoot, `g${n}`));
    }
  }

  heading("G1b. same long paths with core.longpaths=true");
  git(["config", "core.longpaths", "true"], mainRepo);
  for (const n of [240, 258, 280]) {
    const p = nestedPath(path.join(tmpRoot, `glong${n}`), n);
    log(`  longpaths=true target len=${n} actual=${p.length}`);
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
    } catch (err) {
      log(`  mkdir failed: ${err.message}`);
    }
    const rec = git(
      ["-c", "core.longpaths=true", "worktree", "add", p, "-b", `run-glong-${n}`],
      mainRepo,
    );
    const added = rec.exit === 0 && exists(path.join(p, "README.md"));
    note(
      `G-longpaths-${n}`,
      `with core.longpaths=true, git may create worktrees beyond MAX_PATH when OS LongPathsEnabled=1`,
      `pathLen=${p.length} exit=${rec.exit} added=${added} stderr=${rec.stderr}`,
      { pathLength: p.length },
    );
    if (added) git(["worktree", "remove", "--force", p], mainRepo);
    else {
      git(["worktree", "prune", "-v"], mainRepo);
      rmrf(path.join(tmpRoot, `glong${n}`));
    }
  }
  git(["config", "core.longpaths", "false"], mainRepo);

  heading("G2. case sensitivity");
  const wtCase = path.join(tmpRoot, "wt-g-case");
  git(["worktree", "add", wtCase, "-b", "run-g-case"], mainRepo);
  const lower = path.join(wtCase, "readme.md");
  const upper = path.join(wtCase, "README.md");
  const lowerExists = exists(lower);
  const sameReal = (() => {
    try {
      return fs.realpathSync.native(lower) === fs.realpathSync.native(upper);
    } catch (err) {
      return `err:${err.message}`;
    }
  })();
  log(`  exists(readme.md)=${lowerExists} exists(README.md)=${exists(upper)} sameReal=${sameReal}`);
  try {
    fs.writeFileSync(lower, "lowercase-name-write\n");
  } catch (err) {
    log(`  write readme.md failed: ${err.message}`);
  }
  const afterWrite = readText(upper).trim();
  git(["status", "--porcelain=v1"], wtCase);
  git(["config", "--get", "core.ignoreCase"], wtCase);
  note(
    "G-case",
    "Windows NTFS default is case-insensitive; writing readme.md overwrites README.md; core.ignoreCase=true",
    `lowerExistsAsWinPath=${lowerExists} sameReal=${sameReal} README.md contents after writing readme.md=${JSON.stringify(afterWrite)}`,
  );
  git(["worktree", "remove", "--force", wtCase], mainRepo);

  heading("G3. junction (no admin) and symlink (may need privilege)");
  const wtJ = path.join(tmpRoot, "wt-g-junction");
  git(["worktree", "add", wtJ, "-b", "run-g-junc"], mainRepo);
  const outside = path.join(tmpRoot, "outside-secret.txt");
  fs.writeFileSync(outside, "secret-outside-worktree\n");
  const junc = path.join(wtJ, "junc-out");
  let juncErr = "";
  try {
    fs.symlinkSync(tmpRoot, junc, "junction");
  } catch (err) {
    juncErr = err.message;
    const mklink = run("cmd.exe", ["/c", "mklink", "/J", junc, tmpRoot], wtJ);
    if (mklink.exit !== 0) juncErr += ` mklink=${mklink.stderr || mklink.stdout}`;
    else juncErr = "";
  }
  const juncPoints = exists(junc) ? listDir(junc).slice(0, 8).join(",") : "(missing)";
  const escaped = exists(path.join(junc, "outside-secret.txt"));
  note(
    "G-junction",
    "directory junction can be created without admin and can point outside the worktree (path-escape risk for T06)",
    `juncErr=${juncErr || "none"} exists=${exists(junc)} listing=${juncPoints} escapedOutsideFile=${escaped}`,
  );

  const fileLink = path.join(wtJ, "link-secret.txt");
  let symErr = "";
  try {
    fs.symlinkSync(outside, fileLink, "file");
  } catch (err) {
    symErr = err.message;
  }
  note(
    "G-symlink",
    "file symlink may fail without SeCreateSymbolicLinkPrivilege / Developer Mode",
    symErr
      ? `unsupported/failed: ${symErr}`
      : `created; target readable=${exists(fileLink)} content=${exists(fileLink) ? readText(fileLink).trim() : ""}`,
  );

  const dirLink = path.join(wtJ, "dir-symlink");
  let dirSymErr = "";
  try {
    fs.symlinkSync(tmpRoot, dirLink, "dir");
  } catch (err) {
    dirSymErr = err.message;
  }
  note(
    "G-dir-symlink",
    "directory symlink may also require privilege; junctions are the practical Windows escape hatch",
    dirSymErr ? `failed: ${dirSymErr}` : `created exists=${exists(dirLink)}`,
  );

  git(["worktree", "remove", "--force", wtJ], mainRepo);
}

async function scenarioHskip() {
  heading("H. Dirty submodule — skipped (too heavy for this spike)");
  note(
    "H",
    "skip dirty submodule worktree interactions unless already cheap",
    "skipped: no submodule fixture",
  );
}

async function cleanup() {
  heading("Cleanup (best-effort)");
  killAllChildren();
  await new Promise((r) => setTimeout(r, 300));
  if (exists(mainRepo)) {
    git(["worktree", "list"], mainRepo);
    const list = git(["worktree", "list", "--porcelain"], mainRepo);
    const paths = [];
    for (const line of (list.stdout || "").split("\n")) {
      if (line.startsWith("worktree ")) paths.push(line.slice("worktree ".length).trim());
    }
    for (const p of paths) {
      const abs = path.resolve(p);
      if (path.resolve(abs) === path.resolve(mainRepo)) continue;
      log(`  removing worktree ${abs}`);
      git(["worktree", "remove", "--force", abs], mainRepo);
    }
    git(["worktree", "prune", "-v"], mainRepo);
  }
  if (!keep) {
    const r = rmrf(tmpRoot);
    log(`  rmrf tmpRoot ok=${r.ok} ${r.error || ""}`);
    if (!r.ok || exists(tmpRoot)) {
      log("  LEFTOVER after cleanup:");
      log(`    exists=${exists(tmpRoot)}`);
      if (exists(tmpRoot)) {
        const walk = (dir, depth = 0) => {
          if (depth > 4) return;
          for (const name of listDir(dir)) {
            const p = path.join(dir, name);
            log(`    ${"  ".repeat(depth)}${name}`);
            try {
              if (fs.statSync(p).isDirectory()) walk(p, depth + 1);
            } catch {
              // ignore
            }
          }
        };
        walk(tmpRoot);
      }
    } else {
      log("  tmp sandbox removed");
    }
  } else {
    log("  --keep: leaving tmp sandbox on disk");
  }
}

function printSummary() {
  heading("Summary");
  for (const f of findings) {
    log(`[${f.id}]`);
    log(`  expected: ${f.expected}`);
    log(`  actual:   ${f.actual}`);
  }
  log("");
  log("macOS/Linux: 未测");
}

async function main() {
  process.on("exit", () => killAllChildren());
  process.on("SIGINT", () => {
    killAllChildren();
    process.exit(130);
  });
  try {
    await setup();
    await scenarioA();
    await scenarioB();
    await scenarioC();
    await scenarioD();
    await scenarioE();
    await scenarioF();
    await scenarioG();
    await scenarioHskip();
  } catch (err) {
    log(`FATAL: ${err.stack || err}`);
  } finally {
    try {
      await cleanup();
    } catch (err) {
      log(`cleanup error: ${err.stack || err}`);
    }
    printSummary();
  }
}

await main();
