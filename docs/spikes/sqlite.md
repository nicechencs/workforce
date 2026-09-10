# Spike: SQLite 原子状态 + Event

**日期：** 2026-09-10  
**范围：** 隔离实验，**不是**产品 schema。不修改 `packages/database`。  
**驱动：** Node 内置 `node:sqlite`（`DatabaseSync`）。未安装 `better-sqlite3`，未使用仓库根依赖。

## 环境

| 项 | 值 |
|---|---|
| OS | Windows 10.0.19045 x64 |
| Node | v24.19.0 |
| SQLite | 3.53.3（`process.versions.sqlite`，随 Node 捆绑） |
| API | `node:sqlite` `DatabaseSync` |
| `sqlite3` CLI | **未找到**（`where.exe sqlite3` 无输出） |
| macOS / Linux | **未测** |

`node:sqlite` 在 Node 文档中仍标记 experimental；本机 Node 24.19.0 可直接 `import { DatabaseSync } from 'node:sqlite'`。

## Commands

```text
node tooling/spikes/sqlite/run.mjs
```

脚本在 `tooling/spikes/.tmp/sqlite/` 写入各实验 `.db` 与 `results.json`（该目录已 gitignore）。可重复；每次覆盖同名文件。

最小 schema（spike only）：

```sql
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
```

`outbox` 只模拟 D04「状态 + Event + Outbox 同事务」，不是产品表。

写事务一律 `BEGIN IMMEDIATE`，除非实验故意对比错误用法。

---

## 1. Happy path

**Expected：** 同一事务插入 `runs` + `events`，`COMMIT` 后两行都可见。

**Actual：** PASS（46 ms）。`run-1` / `ev-1` 同时出现；seed 行仍在。`counts = { runs: 2, events: 2 }`。

---

## 2. Rollback

**Expected：** `BEGIN`；插入两行；`ROLLBACK`；两行都不可见，仅保留此前已提交的 seed。

**Actual：** PASS（39 ms）。事务内 `midCounts = { runs: 2, events: 2 }`；`ROLLBACK` 后只剩 `seed-run` / `seed-ev`。

---

## 3. Constraint fail

**Expected：** 事务内 `UPDATE runs` 且插入重复 `(run_id, sequence)` 的 event 时，**整事务**回滚，run 状态不变。

**Actual：** PASS（44 ms），但必须区分两种用法。

错误：

```text
UNIQUE constraint failed: events.run_id, events.sequence
code=ERR_SQLITE_ERROR  errcode=2067  errstr=constraint failed
```

| 用法 | 结果 |
|---|---|
| `try { BEGIN; UPDATE; INSERT dup; COMMIT } catch { ROLLBACK }` | run 仍为 `queued` / `state_revision=1`，无新 event |
| `BEGIN; UPDATE; INSERT dup` 失败后仍 `COMMIT` | **半状态**：run 变成 `running` / `state_revision=2`，重复 event 未写入 |

SQLite 默认是 **statement abort，不是 transaction abort**。约束失败后事务仍处于打开状态；随后 `COMMIT` 会提交已经成功的语句。

T04 必须用 UoW 包装：任何错误都 `ROLLBACK`，禁止在失败语句之后 `COMMIT`。

---

## 4. Crash window（delete journal）

**Expected：** 进程 A `BEGIN IMMEDIATE; INSERT run; INSERT event;` 后在 `COMMIT` 前中止。进程 B 打开同一文件，只能看到此前已提交行，不能看到 `crash-run`。

两种中止：

1. `process.exit(1)`（不 `close`、不 `COMMIT`）
2. 父进程在 in-txn marker 之后 `SIGKILL` / `TerminateProcess`

**Actual：** PASS（257 ms）。

| 中止 | 子进程 | 崩溃后 sidecar | 恢复后 SELECT |
|---|---|---|---|
| `exit(1)` | status=1 | `*.db` 32768 + `*.db-journal` 21032 | 仅 seed |
| `SIGKILL` | signalCode=`SIGKILL` | 同上，journal 在 txn 内已出现 | 仅 seed |

`process.exit(1)` 仍留下 hot journal，说明并非「析构函数干净 ROLLBACK 后再退出」。恢复连接 `SELECT` 只有 `seed-run` / `seed-ev`，没有 `crash-run`。

本实验是 **软件中止**（exit / kill）。不是 OS crash，不是掉电。

本机在恢复连接 `close()` 之后，Windows 上仍能立刻列出 `-journal`；数据已经回滚。不要把 sidecar 残留当成半状态。

---

## 5. WAL crash

**Expected：** `PRAGMA journal_mode=WAL` 后重复崩溃实验；记录 `-wal` / `-shm`。崩溃前未提交行仍不可见。WAL 读者应只看到已提交行（见实验 6）。

**Actual：** PASS（219 ms）。`journal_mode=wal` 会持久化到库文件。

| 阶段 | 文件 |
|---|---|
| init 后关闭 | 仅 `*.db`（checkpoint 后 sidecar 被删） |
| 崩溃窗口 / kill 当时 | `*.db` 32768、`*.db-shm` 32768、`*.db-wal`（本 run stat 为 0） |
| 恢复连接打开并关闭后 | 仅 `*.db` |

两种中止的 SELECT 都只有 seed。`-wal` 本 run 的 `stat.size` 为 0，但文件存在；可能是 Windows 上 WAL mmap 尚未反映到目录项大小。不能用「size=0」推断没有 WAL 帧，以恢复后的 SELECT 为准。

WAL 并发读者：见实验 6。

---

## 6. Concurrent writers / busy

**Expected：** 两个进程提交不同 run；其中一个可能 `SQLITE_BUSY`。记录 `busy_timeout`。WAL 下读者在写事务进行中仍可读已提交行。

**Actual：** PASS（1368 ms）。WAL + `BEGIN IMMEDIATE`。

| 连接 | timeout | 结果 |
|---|---|---|
| writer-a 持锁 ~1200 ms | 0 | COMMIT 成功，`elapsedMs=1212` |
| 写事务中的读者 | 1000 | 只看到 seed，**看不到**未提交的 `writer-a` |
| writer-b | **0** | **1 ms** 失败：`database is locked` / `errcode=5` / `ERR_SQLITE_ERROR` |
| writer-c | **3000** | 等待后成功，`elapsedMs=1088` |

最终行：`seed-run`、`writer-a`、`writer-c`。`writer-b` 未写入。

默认 `PRAGMA busy_timeout = 0`（`DatabaseSync` 的 `timeout` 选项默认也是 0）→ 立刻 `SQLITE_BUSY`。`new DatabaseSync(path, { timeout: 2500 })` 会把 busy_timeout 设为 2500 ms（实验 8 核实）。

---

## 7. State + Event + Outbox 三行同事务

**Expected：** D04 模拟：同一事务写 state、event、outbox 三行；随后约束失败时三行变更一起回滚。

**Actual：** PASS（44 ms）。

- Happy：`run-7` + `ev-7` + `ob-7` 同事务提交后都可见。
- 失败路径：`UPDATE run-7` + 新 event + 重复 `outbox.id='ob-7'` → `UNIQUE constraint failed: outbox.id`（`errcode=1555`，`SQLITE_CONSTRAINT_PRIMARYKEY`）。catch+ROLLBACK 后 run 仍为 `queued` / revision 1，没有 `ev-7b`，outbox 仍只有 `ob-7`。

---

## 8. Durability pragmas

**Expected：** 记录默认 `synchronous` 与 WAL 下 FULL vs NORMAL 的含义。软件中止原子性与 `synchronous` 无关。不声称掉电/磁盘满原子性。

**Actual：** PASS（241 ms）。

| PRAGMA | 文件库默认 | `journal_mode=WAL` 后 | 显式设置 |
|---|---|---|---|
| `journal_mode` | `delete` | `wal`（持久） | — |
| `synchronous` | `2` FULL | 仍为 `2` FULL（**按连接**，不随 WAL 自动改） | `NORMAL` → `1`；`FULL` → `2` |
| `busy_timeout` | `0` | `0` | 构造函数 `timeout: 2500` → 2500 |
| `foreign_keys` | `1`（`enableForeignKeyConstraints` 默认 true） | `1` | — |
| `wal_autocheckpoint` | 1000 | 1000 | — |

WAL + `SIGKILL` 在 `synchronous=NORMAL` 与 `FULL` 下，软件中止都只留下 seed（无半状态）。`synchronous` **不会**写入库文件；恢复连接若未再设 NORMAL，读到的仍是默认 FULL。

含义（SQLite 文档，非本机掉电证据）：

- `FULL`：提交时 fsync；更保守。
- `NORMAL` + WAL：常见推荐；进程崩溃通常不丢已提交事务，**掉电可能丢掉最后一条已提交事务**，但不应损坏库。本 spike **未测**该区别。
- `OFF`：本 spike 未用。

**Power-loss / 磁盘满 / OS crash：未测。** 不得把软件 abort 的原子性外推为掉电耐久性。

---

## Limits

- 只在 Windows 10 + Node 24.19.0 上测过。macOS / Linux **未测**。
- 只证明 **软件 abort + ROLLBACK**：`ROLLBACK`、约束失败后的显式回滚、`process.exit(1)`、`SIGKILL`。
- **未测：** 掉电、重置、`FlushFileBuffers` 失败、磁盘满、杀盘、BitLocker 掉电、Docker 突然 kill 宿主机。
- `node:sqlite` 仍为 experimental API。
- `sqlite3` CLI 本机不存在；实验只走 Node。
- SQLite 单写者。WAL 允许多读者 + 一写者，不是多写者并行提交。
- 约束失败不会自动 abort 事务（实验 3）。应用层不 `ROLLBACK` 就会半状态。
- 长事务会放大 `SQLITE_BUSY`。外部 spawn / 文件 / Git / 网络不得放进数据库事务。
- 备份/复制必须处理 `-wal` / `-shm` / `-journal` sidecar，或使用 SQLite backup API / `VACUUM INTO`。本 spike 未测备份。
- 本 schema 不是产品表，没有 CAS 冲突重试、lease、idempotency receipt、ingestion cursor。

## Capability

| 能力 | 判定 | 证据 |
|---|---|---|
| 同一事务多行写入 | **enforceable** | 实验 1、7 |
| 错误回滚无半状态 | **enforceable**（必须显式 `ROLLBACK`） | 实验 2、3、7 |
| COMMIT 前崩溃无半状态 | **observable**（软件中止） | 实验 4、5、8 |
| WAL 并发读者只见已提交行 | **enforceable** | 实验 6 |
| `SQLITE_BUSY` / `busy_timeout` | **enforceable** | 实验 6、8 |
| 掉电 / OS crash 耐久性 | **untested** | 实验 8 |
| 磁盘满 | **untested** | — |
| macOS / Linux | **untested** | — |

---

## Recommendations

### T04（database / events / outbox）

1. **业务状态 + Event + Outbox 必须同一事务。** 实验 7 在 SQLite 上可执行。Inbox 去重、stream sequence 仍按蓝图，本 spike 未覆盖。
2. **UoW：** `BEGIN IMMEDIATE` → 工作 → `COMMIT`；任何异常 `ROLLBACK`。不要手写「失败后继续 COMMIT」。
3. **推荐连接设置：** `PRAGMA journal_mode=WAL;` `busy_timeout`（构造函数 `timeout`，例如 5000）; `foreign_keys=ON;` 写事务 `BEGIN IMMEDIATE`。`synchronous` 默认 FULL；若改为 NORMAL，文档中写明这是 WAL 常见配置，**不是**已测掉电保证。
4. **单写者协调。** Daemon 内用一个写连接（或严格串行写队列）。跨进程写依赖 `busy_timeout`，不要假设能并行 COMMIT。
5. 映射错误：`errcode 5` = `SQLITE_BUSY`（`database is locked`）；`2067` = unique；`1555` = primary key。`error.code` 是 `ERR_SQLITE_ERROR`，不要只解析 message。
6. 驱动：本 spike 证明 Node 24 的 `node:sqlite` 足够做事务/WAL/busy/崩溃恢复。T04 若用 Drizzle，需单独确认 `drizzle-orm` 对该 driver 的支持；不要在仓库根为了本实验安装 `better-sqlite3`。
7. 打开数据库即触发 recovery；测试必须包含「脏 journal/WAL + 新进程打开」。
8. 备份要包含 sidecar 或使用 backup API。

### T05（Handle 先持久化再 spawn）

D04 崩溃窗口与本实验的对应关系：

| 窗口 | 做法 | SQLite 含义 |
|---|---|---|
| 1. 命令已提交，进程未启动 | **先**短事务写入 Run/intent + Event + Outbox 并 **COMMIT**，**再** spawn | 崩溃 → 有持久意图、无进程；按收据恢复或补 spawn，禁止再开第二个活动 Run |
| 2. 进程已启动，Handle 未提交 | spawn **之后**再用 **第二个**短事务写 Handle / pid | 崩溃 → 有孤儿进程；只允许 inspect / 安全终止，禁止盲目重跑 |
| 3. Artifact 落盘，元数据未提交 | 本 spike 未做文件；同模式：先盘后短事务，或可对账 | — |

**外部 spawn 不得放进长数据库事务。** 持有 `BEGIN IMMEDIATE` 去 `spawn` 会：拉长写锁、放大 `SQLITE_BUSY`、把进程生命周期和 DB 锁绑在一起。正确顺序是 commit → spawn → commit Handle。

### T09（workflow / 调度）

- Task/Run/Approval 状态迁移必须与 Event、Outbox 同事务（实验 7 的模式）。
- 用 `state_revision`（或等价 CAS）做乐观锁；冲突即整事务回滚。
- Event `(run_id, sequence)` UNIQUE 可防止双写同一序号；失败必须回滚状态，而不是留下「状态已迁、事件缺失」。
- 禁止用 Event replay 重放 spawn / Git / 文件副作用；Outbox 只投递通知。

---

## 契约变更请求

无。本 spike 不要求改 T02 协议。它确认 D04 的事务规则在 SQLite 上可执行，并确认「spawn 不得夹在长 DB 事务中」是性能与锁的实际约束，不只是设计偏好。
