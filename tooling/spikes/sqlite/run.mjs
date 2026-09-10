/**
 * T03 spike: SQLite atomic state + event (NOT product schema).
 *
 * Uses Node's built-in `node:sqlite` (DatabaseSync). No better-sqlite3.
 *
 *   node tooling/spikes/sqlite/run.mjs
 *
 * Child helpers are invoked by this file; do not call --child directly.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SCRIPT = fileURLToPath(import.meta.url);
const HERE = path.dirname(SCRIPT);
const TMP = path.resolve(HERE, "..", ".tmp", "sqlite");

const SCHEMA = `
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  state_revision INTEGER NOT NULL
);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  topic TEXT NOT NULL
);
`;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function writeMarker(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, "w");
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function waitForFile(file, timeoutMs, label) {
  const start = Date.now();
  while (!fs.existsSync(file)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for ${label ?? file}`);
    }
    sleepSync(20);
  }
}

function sidecarFiles(dbPath) {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name === base || name.startsWith(`${base}-`))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function errInfo(e) {
  if (!e || typeof e !== "object") return { message: String(e) };
  return {
    message: e.message,
    code: e.code,
    errcode: e.errcode,
    errstr: e.errstr,
  };
}

function openDb(file, { timeout = 0, wal = false, synchronous } = {}) {
  const db = new DatabaseSync(file, {
    timeout,
    enableForeignKeyConstraints: true,
  });
  if (wal) {
    const mode = db.prepare("PRAGMA journal_mode = WAL").get();
    if (String(mode.journal_mode).toLowerCase() !== "wal") {
      db.close();
      throw new Error(`failed to enable WAL: ${JSON.stringify(mode)}`);
    }
  }
  if (synchronous) db.exec(`PRAGMA synchronous = ${synchronous}`);
  return db;
}

function pragmas(db) {
  const one = (sql) => db.prepare(sql).get();
  return {
    journal_mode: one("PRAGMA journal_mode").journal_mode,
    synchronous: one("PRAGMA synchronous").synchronous,
    busy_timeout: one("PRAGMA busy_timeout").timeout,
    foreign_keys: one("PRAGMA foreign_keys").foreign_keys,
    wal_autocheckpoint: one("PRAGMA wal_autocheckpoint").wal_autocheckpoint,
  };
}

function initDb(file, { wal = false, synchronous, seed = true } = {}) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  for (const side of [`${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    if (fs.existsSync(side)) fs.unlinkSync(side);
  }
  const db = openDb(file, { timeout: 5000, wal, synchronous });
  db.exec(SCHEMA);
  if (seed) {
    db.prepare("INSERT INTO runs (id, status, state_revision) VALUES (?, ?, ?)").run(
      "seed-run",
      "queued",
      1,
    );
    db.prepare("INSERT INTO events (id, run_id, sequence, type) VALUES (?, ?, ?, ?)").run(
      "seed-ev",
      "seed-run",
      1,
      "seeded",
    );
  }
  const info = pragmas(db);
  db.close();
  return info;
}

function snapshot(db) {
  return {
    runs: db
      .prepare("SELECT * FROM runs ORDER BY id")
      .all()
      .map((r) => ({ ...r })),
    events: db
      .prepare("SELECT * FROM events ORDER BY run_id, sequence")
      .all()
      .map((r) => ({ ...r })),
    outbox: db
      .prepare("SELECT * FROM outbox ORDER BY id")
      .all()
      .map((r) => ({ ...r })),
  };
}

function counts(snap) {
  return {
    runs: snap.runs.length,
    events: snap.events.length,
    outbox: snap.outbox.length,
  };
}

function txn(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // already closed or no active transaction
    }
    throw e;
  }
}

function insertRun(db, id, status, revision) {
  db.prepare("INSERT INTO runs (id, status, state_revision) VALUES (?, ?, ?)").run(
    id,
    status,
    revision,
  );
}

function insertEvent(db, id, runId, sequence, type) {
  db.prepare("INSERT INTO events (id, run_id, sequence, type) VALUES (?, ?, ?, ?)").run(
    id,
    runId,
    sequence,
    type,
  );
}

function insertOutbox(db, id, runId, eventId, topic) {
  db.prepare("INSERT INTO outbox (id, run_id, event_id, topic) VALUES (?, ?, ?, ?)").run(
    id,
    runId,
    eventId,
    topic,
  );
}

function spawnChild(argList, { timeoutMs = 20_000, stdio = "pipe" } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...argList], {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    stdio: stdio === "ignore" ? "ignore" : ["ignore", "pipe", "pipe"],
  });
}

function spawnChildAsync(argList, { stdio = "pipe" } = {}) {
  const child = spawn(process.execPath, [SCRIPT, ...argList], {
    windowsHide: true,
    stdio: stdio === "ignore" ? "ignore" : ["ignore", "pipe", "pipe"],
  });
  const chunks = { out: "", err: "" };
  if (stdio !== "ignore") {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      chunks.out += d;
    });
    child.stderr.on("data", (d) => {
      chunks.err += d;
    });
  }
  return { child, chunks };
}

function waitForChild(child, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for ${label ?? `pid ${child.pid}`}`));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      resolve({
        pid: child.pid,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
      });
    };
    child.once("close", finish);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseChildJson(result) {
  const text = (result.stdout ?? "").trim();
  if (!text) {
    return {
      parseError: "empty stdout",
      status: result.status,
      stderr: result.stderr,
      error: result.error?.message,
    };
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return {
      parseError: e.message,
      stdout: text,
      status: result.status,
      stderr: result.stderr,
    };
  }
}

function openAfterCrash(file, opts = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < 4000) {
    try {
      return openDb(file, opts);
    } catch (e) {
      last = e;
      sleepSync(50);
    }
  }
  throw last ?? new Error(`could not reopen ${file}`);
}

function seedOnly(snap) {
  return (
    snap.runs.length === 1 &&
    snap.runs[0].id === "seed-run" &&
    snap.runs[0].status === "queued" &&
    snap.runs[0].state_revision === 1 &&
    snap.events.length === 1 &&
    snap.events[0].id === "seed-ev" &&
    snap.outbox.length === 0 &&
    !snap.runs.some((r) => r.id === "crash-run") &&
    !snap.events.some((e) => e.run_id === "crash-run")
  );
}

function runChild(args) {
  const mode = args.child;
  if (mode === "writer") return childWriter(args);
  if (mode === "crash-exit") return childCrash(args, "exit");
  if (mode === "crash-hold") return childCrash(args, "hold");
  throw new Error(`unknown child mode: ${mode}`);
}

function childWriter(args) {
  const db = openDb(args.db, {
    timeout: Number(args.timeout ?? 0),
    wal: args.wal === "1" || args.wal === true,
  });
  const started = Date.now();
  try {
    db.exec("BEGIN IMMEDIATE");
    insertRun(db, args["run-id"], "queued", 1);
    insertEvent(db, `${args["run-id"]}-e1`, args["run-id"], 1, "created");
    if (args.marker) writeMarker(args.marker, `in-txn ${process.pid}\n`);
    sleepSync(Number(args["hold-ms"] ?? 0));
    db.exec("COMMIT");
    process.stdout.write(
      JSON.stringify({
        ok: true,
        pid: process.pid,
        elapsedMs: Date.now() - started,
        snap: snapshot(db),
      }),
    );
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    process.stdout.write(
      JSON.stringify({
        ok: false,
        pid: process.pid,
        elapsedMs: Date.now() - started,
        error: errInfo(e),
      }),
    );
    process.exitCode = 2;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

function childCrash(args, kind) {
  const db = openDb(args.db, {
    timeout: 0,
    wal: args.wal === "1" || args.wal === true,
    synchronous: args.synchronous,
  });
  db.exec("BEGIN IMMEDIATE");
  insertRun(db, "crash-run", "running", 2);
  insertEvent(db, "crash-ev", "crash-run", 1, "started");
  if (args.marker) writeMarker(args.marker, `in-txn ${process.pid}\n`);
  if (kind === "exit") {
    // Intentionally no COMMIT and no close: simulate abort in the crash window.
    process.exit(1);
  }
  sleepSync(30_000);
  process.stdout.write(JSON.stringify({ ok: false, reason: "hold timed out" }));
  process.exit(3);
}

async function experiment(id, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { id, ms: Date.now() - started, ...result, pass: !!result.pass };
  } catch (e) {
    return {
      id,
      pass: false,
      ms: Date.now() - started,
      error: errInfo(e),
    };
  }
}

function exp1HappyPath() {
  const file = path.join(TMP, "1-happy.db");
  initDb(file, { seed: true });
  const db = openDb(file, { timeout: 1000 });
  txn(db, () => {
    insertRun(db, "run-1", "queued", 1);
    insertEvent(db, "ev-1", "run-1", 1, "created");
  });
  const snap = snapshot(db);
  db.close();
  const inserted = {
    run: snap.runs.find((r) => r.id === "run-1"),
    event: snap.events.find((e) => e.id === "ev-1"),
  };
  return {
    pass: inserted.run?.status === "queued" && inserted.event?.sequence === 1,
    expected: "BEGIN IMMEDIATE; insert run + event; COMMIT → both visible",
    actual: { counts: counts(snap), inserted },
  };
}

function exp2Rollback() {
  const file = path.join(TMP, "2-rollback.db");
  initDb(file, { seed: true });
  const db = openDb(file, { timeout: 1000 });
  db.exec("BEGIN IMMEDIATE");
  insertRun(db, "run-2", "queued", 1);
  insertEvent(db, "ev-2", "run-2", 1, "created");
  const mid = snapshot(db);
  db.exec("ROLLBACK");
  const after = snapshot(db);
  db.close();
  return {
    pass:
      mid.runs.some((r) => r.id === "run-2") &&
      mid.events.some((e) => e.id === "ev-2") &&
      seedOnly(after),
    expected: "BEGIN; insert both; ROLLBACK → neither visible (seed remains)",
    actual: { midCounts: counts(mid), after, seedOnly: seedOnly(after) },
  };
}

function exp3Constraint() {
  const file = path.join(TMP, "3-constraint.db");
  initDb(file, { seed: true });
  const db = openDb(file, { timeout: 1000 });

  let constraintErr;
  try {
    txn(db, () => {
      db.prepare(
        "UPDATE runs SET status = ?, state_revision = state_revision + 1 WHERE id = ?",
      ).run("running", "seed-run");
      insertEvent(db, "ev-dup", "seed-run", 1, "duplicate-seq");
    });
  } catch (e) {
    constraintErr = errInfo(e);
  }
  const afterRollback = snapshot(db);

  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE runs SET status = ?, state_revision = state_revision + 1 WHERE id = ?").run(
    "running",
    "seed-run",
  );
  let naiveErr;
  try {
    insertEvent(db, "ev-dup-2", "seed-run", 1, "duplicate-seq");
  } catch (e) {
    naiveErr = errInfo(e);
  }
  db.exec("COMMIT");
  const afterNaive = snapshot(db);
  db.close();

  const rollbackOk =
    afterRollback.runs[0].status === "queued" &&
    afterRollback.runs[0].state_revision === 1 &&
    afterRollback.events.length === 1 &&
    constraintErr?.errcode === 2067;

  const footgun =
    afterNaive.runs[0].status === "running" &&
    afterNaive.runs[0].state_revision === 2 &&
    afterNaive.events.length === 1;

  return {
    pass: rollbackOk && footgun,
    expected:
      "duplicate (run_id, sequence) inside a txn that also updates run: catch+ROLLBACK restores both tables; naive COMMIT after statement failure keeps the UPDATE (SQLite statement abort ≠ transaction abort)",
    actual: {
      constraintErr,
      naiveErr,
      afterExplicitRollback: afterRollback,
      afterNaiveCommit: afterNaive,
      rollbackRestoredSeed: rollbackOk,
      naiveCommitPersistedRunUpdate: footgun,
    },
  };
}

async function crashOnce({ name, wal, mode, synchronous }) {
  const file = path.join(TMP, `${name}.db`);
  const marker = path.join(TMP, `${name}.marker`);
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  const initInfo = initDb(file, { wal, synchronous, seed: true });
  const filesBefore = sidecarFiles(file);

  let crashMeta;
  if (mode === "exit") {
    const result = spawnChild(
      [
        "--child",
        "crash-exit",
        "--db",
        file,
        "--marker",
        marker,
        ...(wal ? ["--wal", "1"] : []),
        ...(synchronous ? ["--synchronous", synchronous] : []),
      ],
      { timeoutMs: 10_000 },
    );
    crashMeta = {
      mode,
      status: result.status,
      signal: result.signal,
      stderr: result.stderr?.trim() || undefined,
    };
  } else {
    const { child } = spawnChildAsync(
      [
        "--child",
        "crash-hold",
        "--db",
        file,
        "--marker",
        marker,
        ...(wal ? ["--wal", "1"] : []),
        ...(synchronous ? ["--synchronous", synchronous] : []),
      ],
      { stdio: "ignore" },
    );
    waitForFile(marker, 8000, `${name} in-txn marker`);
    const filesInTxn = sidecarFiles(file);
    child.kill("SIGKILL");
    const closed = await waitForChild(child, 8000, `${name} killed`);
    crashMeta = {
      mode,
      pid: child.pid,
      exitCode: closed.exitCode,
      signalCode: closed.signalCode,
      filesInTxn,
    };
  }

  const filesAfterCrash = sidecarFiles(file);
  const db = openAfterCrash(file, { timeout: 1000, wal });
  const snap = snapshot(db);
  const recoveredPragmas = pragmas(db);
  db.close();
  const filesAfterOpen = sidecarFiles(file);

  return {
    pass: seedOnly(snap),
    initPragmas: initInfo,
    recoveredPragmas,
    crash: crashMeta,
    filesBefore,
    filesAfterCrash,
    filesAfterOpen,
    snap,
    seedOnly: seedOnly(snap),
  };
}

async function exp4CrashDelete() {
  const exitTest = await crashOnce({ name: "4-crash-delete-exit", wal: false, mode: "exit" });
  const killTest = await crashOnce({ name: "4-crash-delete-kill", wal: false, mode: "kill" });
  return {
    pass: exitTest.pass && killTest.pass,
    expected:
      "crash/interrupt before COMMIT (process.exit(1) or SIGKILL) leaves only previously committed rows; no crash-run half-state",
    actual: { exitTest, killTest },
  };
}

async function exp5CrashWal() {
  const exitTest = await crashOnce({ name: "5-crash-wal-exit", wal: true, mode: "exit" });
  const killTest = await crashOnce({ name: "5-crash-wal-kill", wal: true, mode: "kill" });
  const sawWal =
    (killTest.crash.filesInTxn ?? killTest.filesAfterCrash).some((f) => f.name.endsWith("-wal")) ||
    killTest.filesAfterCrash.some((f) => f.name.endsWith("-wal")) ||
    exitTest.filesAfterCrash.some((f) => f.name.endsWith("-wal"));
  return {
    pass: exitTest.pass && killTest.pass && sawWal,
    expected:
      "WAL journal_mode; same crash-before-commit invariant; -wal/-shm appear while a writer is connected",
    actual: {
      sawWal,
      exitTest,
      killTest,
    },
  };
}

async function exp6ConcurrentWriters() {
  const file = path.join(TMP, "6-busy.db");
  const marker = path.join(TMP, "6-busy.marker");
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
  initDb(file, { wal: true, seed: true });

  const holder = spawnChildAsync([
    "--child",
    "writer",
    "--db",
    file,
    "--run-id",
    "writer-a",
    "--hold-ms",
    "1200",
    "--timeout",
    "0",
    "--wal",
    "1",
    "--marker",
    marker,
  ]);

  waitForFile(marker, 8000, "writer-a in-txn marker");

  let readerDuringWrite;
  let readerErr;
  const readerDb = openDb(file, { timeout: 1000, wal: true });
  try {
    readerDuringWrite = snapshot(readerDb);
  } catch (e) {
    readerErr = errInfo(e);
  } finally {
    readerDb.close();
  }

  const busy = spawnChild(
    [
      "--child",
      "writer",
      "--db",
      file,
      "--run-id",
      "writer-b",
      "--hold-ms",
      "0",
      "--timeout",
      "0",
      "--wal",
      "1",
    ],
    { timeoutMs: 5000 },
  );
  const busyJson = parseChildJson(busy);

  const waited = spawnChild(
    [
      "--child",
      "writer",
      "--db",
      file,
      "--run-id",
      "writer-c",
      "--hold-ms",
      "0",
      "--timeout",
      "3000",
      "--wal",
      "1",
    ],
    { timeoutMs: 10_000 },
  );
  const waitedJson = parseChildJson(waited);

  const holderClosed = await waitForChild(holder.child, 8000, "writer-a");
  let holderJson;
  try {
    holderJson = JSON.parse(holder.chunks.out.trim() || "null");
  } catch {
    holderJson = {
      parseError: true,
      stdout: holder.chunks.out,
      stderr: holder.chunks.err,
    };
  }

  const db = openDb(file, { timeout: 1000, wal: true });
  const finalSnap = snapshot(db);
  db.close();

  const readerSawOnlyCommitted =
    !readerErr &&
    readerDuringWrite.runs.every((r) => r.id !== "writer-a") &&
    readerDuringWrite.runs.some((r) => r.id === "seed-run");

  const busyIsBusy = busyJson?.ok === false && busyJson?.error?.errcode === 5;
  const waiterOk = waitedJson?.ok === true;
  const holderOk = holderJson?.ok === true;
  const finalHasAC =
    finalSnap.runs.some((r) => r.id === "writer-a") &&
    finalSnap.runs.some((r) => r.id === "writer-c") &&
    !finalSnap.runs.some((r) => r.id === "writer-b");

  return {
    pass: readerSawOnlyCommitted && busyIsBusy && waiterOk && holderOk && finalHasAC,
    expected:
      "two WAL writers: timeout=0 → SQLITE_BUSY (errcode 5); timeout>hold waits then commits; WAL reader sees only committed rows while writer is in txn",
    actual: {
      readerErr,
      readerDuringWriteCounts: readerDuringWrite ? counts(readerDuringWrite) : null,
      readerSawUncommittedWriterA: readerDuringWrite?.runs.some((r) => r.id === "writer-a") ?? null,
      busy: { status: busy.status, json: busyJson },
      waited: { status: waited.status, json: waitedJson },
      holder: {
        exitCode: holderClosed.exitCode,
        signalCode: holderClosed.signalCode,
        json: holderJson,
        stderr: holder.chunks.err || undefined,
      },
      final: finalSnap,
    },
  };
}

function exp7OutboxThreeRows() {
  const file = path.join(TMP, "7-outbox.db");
  initDb(file, { seed: true });
  const db = openDb(file, { timeout: 1000 });

  txn(db, () => {
    insertRun(db, "run-7", "queued", 1);
    insertEvent(db, "ev-7", "run-7", 1, "created");
    insertOutbox(db, "ob-7", "run-7", "ev-7", "run.created");
  });
  const committed = snapshot(db);

  let failErr;
  try {
    txn(db, () => {
      db.prepare(
        "UPDATE runs SET status = ?, state_revision = state_revision + 1 WHERE id = ?",
      ).run("running", "run-7");
      insertEvent(db, "ev-7b", "run-7", 2, "started");
      insertOutbox(db, "ob-7", "run-7", "ev-7b", "run.started");
    });
  } catch (e) {
    failErr = errInfo(e);
  }
  const afterFail = snapshot(db);
  db.close();

  const happy =
    committed.runs.some((r) => r.id === "run-7") &&
    committed.events.some((e) => e.id === "ev-7") &&
    committed.outbox.some((o) => o.id === "ob-7");
  const rolled =
    afterFail.runs.find((r) => r.id === "run-7")?.status === "queued" &&
    afterFail.runs.find((r) => r.id === "run-7")?.state_revision === 1 &&
    !afterFail.events.some((e) => e.id === "ev-7b") &&
    afterFail.outbox.length === 1;

  return {
    pass: happy && rolled && failErr?.errcode === 1555,
    expected:
      "state + event + outbox in one txn all visible after COMMIT; duplicate outbox PK in a later txn rolls back run update + event + outbox together",
    actual: {
      failErr,
      committedCounts: counts(committed),
      afterFail,
      happy,
      rolled,
    },
  };
}

async function exp8Durability() {
  const file = path.join(TMP, "8-pragmas.db");
  initDb(file, { seed: false });
  const db = openDb(file, { timeout: 0 });
  const defaults = pragmas(db);
  db.prepare("PRAGMA journal_mode = WAL").get();
  const afterWal = pragmas(db);
  db.exec("PRAGMA synchronous = NORMAL");
  const normal = pragmas(db);
  db.exec("PRAGMA synchronous = FULL");
  const full = pragmas(db);
  db.close();

  const timeoutDefault = openDb(path.join(TMP, "8-timeout-default.db"), { timeout: 0 });
  const timeoutDefaultPragma = pragmas(timeoutDefault);
  timeoutDefault.close();
  const timeoutSet = openDb(path.join(TMP, "8-timeout-set.db"), { timeout: 2500 });
  const timeoutSetPragma = pragmas(timeoutSet);
  timeoutSet.close();

  const crashNormal = await crashOnce({
    name: "8-crash-wal-normal",
    wal: true,
    mode: "kill",
    synchronous: "NORMAL",
  });
  const crashFull = await crashOnce({
    name: "8-crash-wal-full",
    wal: true,
    mode: "kill",
    synchronous: "FULL",
  });

  return {
    pass:
      defaults.synchronous === 2 &&
      defaults.journal_mode === "delete" &&
      defaults.busy_timeout === 0 &&
      afterWal.journal_mode === "wal" &&
      afterWal.synchronous === 2 &&
      normal.synchronous === 1 &&
      full.synchronous === 2 &&
      timeoutDefaultPragma.busy_timeout === 0 &&
      timeoutSetPragma.busy_timeout === 2500 &&
      crashNormal.pass &&
      crashFull.pass,
    expected:
      "default file journal_mode=delete, synchronous=FULL(2), busy_timeout=0; WAL keeps synchronous=FULL until changed; software-abort atomicity holds under NORMAL and FULL. Power-loss/disk-full not claimed.",
    actual: {
      defaults,
      afterWal,
      normal,
      full,
      timeoutDefault: timeoutDefaultPragma.busy_timeout,
      timeoutSet: timeoutSetPragma.busy_timeout,
      crashNormal: {
        pass: crashNormal.pass,
        recoveredSynchronous: crashNormal.recoveredPragmas.synchronous,
        seedOnly: crashNormal.seedOnly,
      },
      crashFull: {
        pass: crashFull.pass,
        recoveredSynchronous: crashFull.recoveredPragmas.synchronous,
        seedOnly: crashFull.seedOnly,
      },
      untested: ["OS crash / power loss", "disk full", "macOS", "Linux"],
    },
  };
}

function envInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    node: process.versions.node,
    sqliteBundled: process.versions.sqlite,
    nodeSqlite: "node:sqlite DatabaseSync",
    sqlite3Cli: sqlite3Cli(),
  };
}

function sqlite3Cli() {
  const which = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["sqlite3"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (which.status !== 0) return { found: false };
  return { found: true, path: which.stdout.trim().split(/\r?\n/)[0] };
}

function printSummary(report) {
  console.log(
    `SPIKE sqlite  node ${report.env.node}  sqlite ${report.env.sqliteBundled}  ${report.env.platform}`,
  );
  console.log(
    `sqlite3 CLI: ${report.env.sqlite3Cli.found ? report.env.sqlite3Cli.path : "not found"}`,
  );
  console.log("");
  for (const exp of report.experiments) {
    const mark = exp.pass ? "PASS" : "FAIL";
    console.log(`${mark}  ${exp.id}  (${exp.ms} ms)`);
  }
  const failed = report.experiments.filter((e) => !e.pass).length;
  console.log("");
  console.log(`${report.experiments.length - failed}/${report.experiments.length} passed`);
  console.log(`results: ${report.resultsPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child) {
    runChild(args);
    return;
  }

  fs.mkdirSync(TMP, { recursive: true });
  const experiments = [
    await experiment("1.happy_path", exp1HappyPath),
    await experiment("2.rollback", exp2Rollback),
    await experiment("3.constraint_fail", exp3Constraint),
    await experiment("4.crash_before_commit", exp4CrashDelete),
    await experiment("5.wal_crash", exp5CrashWal),
    await experiment("6.concurrent_writers", exp6ConcurrentWriters),
    await experiment("7.state_event_outbox", exp7OutboxThreeRows),
    await experiment("8.durability_pragmas", exp8Durability),
  ];

  const resultsPath = path.join(TMP, "results.json");
  const report = {
    env: envInfo(),
    tmp: TMP,
    resultsPath,
    experiments,
  };
  fs.writeFileSync(resultsPath, JSON.stringify(report, null, 2));
  printSummary(report);
  process.exitCode = experiments.every((e) => e.pass) ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
