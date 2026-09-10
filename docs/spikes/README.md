# T03 技术可行性实验 — 能力矩阵

日期：2026-09-10  
状态：Windows 已测；macOS / Linux **未测**  
范围：隔离 spike，代码只在 `tooling/spikes/**`，记录只在 `docs/spikes/**`。未改产品目录、协议或根工具链。

基线：commit `03f495b` / 分支 `task/t03-spikes`。

## 环境

| 项 | 值 |
|---|---|
| OS | Windows 10.0.19045 (AMD64) |
| Node | v24.19.0（内置 `node:sqlite`，SQLite 3.53.3） |
| npm | 12.0.2 |
| git | 2.55.0.windows.3 |
| PowerShell | 7.6.6 |
| Codex CLI | `codex-cli 0.153.4`（不在 PATH；见 [codex.md](codex.md)） |
| `sqlite3` CLI | 未找到 |
| macOS / Linux | **未测** |

临时文件一律写在 `tooling/spikes/.tmp/`（已 gitignore）。不要把实验代码复制进 `packages/` / `apps/` / `runtimes/`。

## 如何复跑

在仓库根：

```text
node tooling/spikes/codex/probe.mjs
node tooling/spikes/process-tree/run.mjs
node tooling/spikes/git-worktree/run.mjs
node tooling/spikes/sqlite/run.mjs
node tooling/spikes/daemon-lifecycle/run.mjs
```

每项报告含命令、预期、实际、限制。无法验证的平台写 **未测**，不伪造。

| Spike | 报告 |
|---|---|
| Codex 接入探测 | [codex.md](codex.md) |
| 进程树与取消 | [process-tree.md](process-tree.md) |
| Git worktree 异常 | [git-worktree.md](git-worktree.md) |
| SQLite 原子状态+事件 | [sqlite.md](sqlite.md) |
| Desktop/Daemon 生命周期 | [daemon-lifecycle.md](daemon-lifecycle.md) |

状态取值：

| 值 | 含义 |
|---|---|
| **enforceable** | 本机可用平台/OS/运行时机制保证，产品应依赖它 |
| **observable** | 能看到事实或 CLI 声明，但不能当作强保证 |
| **unsupported** | 本机证据表明没有该能力，或不得当作已支持 |
| **untested** | 本次未跑；包括全部 macOS/Linux |

---

## 能力矩阵

### Runtime / Codex（供 T15、T05、T07）

| 能力 | 状态 | Enforcement owner | 证据摘要 |
|---|---|---|---|
| 发现 Codex executable | **enforceable** | T15 `validate` | PATH 无 `codex`；`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe` 与 MSIX `resources\codex.exe` 可运行 `--version` |
| 版本探测 | **enforceable** | T15 | `codex-cli 0.153.4`。勿信过期 `~/.codex/version.json` |
| 启动（`codex exec`） | **observable** | T15 Adapter | `--help` 有 `exec` / `--json` / `-C`。**未跑 live 付费 exec**。TUI 在非 TTY 拒绝 |
| 事件流 JSONL | **observable** | T15 | `exec --json` 声明 JSONL。schema / 背压 **untested**。0.153.4 **无** `proto` 子命令 |
| 中途输入 | **observable** | T15 | `codex queue --thread --message`；exec 可从 stdin 读 prompt。live 中途输入 **untested** |
| 审批策略标志 | **observable** | T07 策略 + T15 翻译 | `-a on-request\|never`。live 审批环 **untested**。CLI 标志 ≠ 平台 Policy 已执行 |
| 取消 | **untested**（CLI） / **enforceable**（进程树） | T06 杀树；T15 映射终态 | 无 `cancel` 子命令。取消 = Host 进程树 force（见下）。Codex 进程形态 **untested** |
| 事件 cursor 续流 `event.resume` | **unsupported** | T15 声明 false；T05 Host 缓冲 | `resume` / `exec resume` 是**会话**恢复，不是 cursor。协议不得把 session resume 当成 event cursor |
| 用量 | **observable**（落盘） / **untested**（live JSONL） | T15 翻译；T07/T09 入账 | 本机 rollout jsonl 有 `token_usage_record` / `token_count`（只采样类型与 key）。无独立 usage 子命令。货币硬上限不可因此启用 |
| 认证边界 | **observable** | T15 `validate`；T07 Broker | `login status` → `Logged in using ChatGPT`。`auth.json` 不得进事件。未登录则拒绝 start |
| 原生 pause | **unsupported** | T15 返回 `UNSUPPORTED_OPERATION` | 无 pause 命令。Windows 也无 POSIX SIGSTOP 可冒充 pause |
| 强沙箱 | **unsupported** | T07 启动前拒绝无法保证的组合 | 本机 `danger-full-access` / 无限制 fs + 网络。`codex sandbox` 是 Windows restricted token，**不是**强 OS sandbox。`--dangerously-bypass-approvals-and-sandbox` 禁止默认 |
| 文件写范围 | **observable** | T07 + T06 path check | CLI `-s workspace-write` / `-C` 存在；本机默认 unrestricted。junction 可逃出 worktree（见 git spike） |
| 命令审批 | **observable** | T07 | `-a on-request` 存在；live 绕过 **untested**。不得宣称「审批一定无法绕过」 |
| 网络限制 | **observable** / 默认未开 | T07 | sandbox 值含 read-only；本机 doctor：network enabled。Policy 不能假设 CLI 已断网 |
| 凭据注入 | **observable** | T07 Broker | ChatGPT 登录走 Codex 自有 store。`--with-api-key` 从 stdin 读。禁止复制用户整个环境/认证目录 |

### 进程树取消（供 T06、T15、T05）

| 能力 | 状态 | Enforcement owner | 证据摘要 |
|---|---|---|---|
| `child.kill()` / `process.kill(SIGTERM)` | **unsupported** 作为优雅/整树 | T06 禁止当 cancel 实现 | Windows = 单 pid `TerminateProcess`；JS handler 不运行 |
| `taskkill /PID /T /F`（根仍活） | **enforceable** | T06 fallback | 整棵可见树（含 `conhost`）被杀；sibling sentinel 存活 |
| `taskkill /T` 在根已死后 | **unsupported** | T06 必须改走后代名单 | `process not found`；detached 孙进程成为孤儿 |
| Job Object `KILL_ON_JOB_CLOSE` | **enforceable**（需 spawn 时入 job） | T06 首选 Windows API | 本机 Assign + close 可杀树。事后 Assign 有竞态 |
| 按镜像名杀 | **unsupported** / 危险 | Adapter 禁止 | 当时 33 个 `node.exe` |
| 进程 identity | **observable** | T06 + Handle | `pid + Get-Process.StartTime`；`process.kill(pid,0)` 会假阳性 |
| 无关进程安全 | **enforceable**（按 pid/job） | T06 | sentinel 不被 `/T` 误杀 |
| macOS killpg / Linux cgroup | **untested** | T06 CI | — |

### Git worktree（供 T06、T14、T08）

| 能力 | 状态 | Enforcement owner | 证据摘要 |
|---|---|---|---|
| 每 Run 独立可写 checkout | **enforceable** | T06 | 并发 worktree 文件/inode 不共享 |
| 脏主工作区不泄漏 | **enforceable** | T06 | dirty + untracked 不进入新 worktree |
| 同 branch 双 checkout | **enforceable**（拒绝） | T06 禁止 `--force` | 显式 `main` → exit 128；`--force` 可绕过，危险 |
| Windows 文件锁阻止删除 | **enforceable**（真锁） | T06 先杀进程树再 remove | `FileShare.None` / cwd 占用 → `--force` 仍 255。Node `fs.open` **不能**当锁 |
| 崩溃后 prune | **observable** | T06 对账 list + gitdir + 目录 | 目录已删则 prune 清 metadata。remove 255 时 git 可能已注销、目录残留 |
| `git worktree lock` | **enforceable** | T06 在 Artifact 落盘前 lock | `--force` 不能覆盖 lock（需 `-f -f`，产品禁止默认） |
| 长路径 ≥240 | **unsupported** | T06 路径预算 <200 | 即使 OS long path + `core.longpaths=true` 仍 `$GIT_DIR too big` |
| junction 逃逸 | **observable**（必须拒绝） | T06 realpath | 无需管理员即可建 junction 指向工作区外 |
| 文件 symlink 逃逸 | **unsupported**（本机无特权） | T06 仍要检查 | 创建 `EPERM`；逃逸 **untested** |
| 脏 submodule | **untested** | T06 若支持需另测 | — |

### SQLite 状态+事件（供 T04、T05、T09）

| 能力 | 状态 | Enforcement owner | 证据摘要 |
|---|---|---|---|
| 同事务写 state + event + outbox | **enforceable** | T04 UoW | 三行同 `BEGIN IMMEDIATE`/`COMMIT` |
| 错误回滚无半状态 | **enforceable**（须显式 ROLLBACK） | T04 | SQLite 默认 **statement abort**；失败后 COMMIT 会留下半状态 |
| COMMIT 前进程崩溃 | **observable**（软件中止） | T04 recovery | `exit(1)` / `SIGKILL` 后新连接只见已提交行。掉电 **untested** |
| WAL 读者不见未提交行 | **enforceable** | T04 | 写事务中读者只见 seed |
| `SQLITE_BUSY` / `busy_timeout` | **enforceable** | T04 单写者 + timeout | 默认 timeout=0 立即 busy；timeout=3000 可等待 |
| 掉电 / 磁盘满 | **untested** | — | 不得把软件 abort 外推为掉电耐久 |
| 外部 spawn 放进长事务 | **unsupported**（禁止） | T04/T05 | 设计+锁证据：commit → spawn → 再短事务写 Handle |

### Desktop / Daemon（供 T11、T10）

| 能力 | 状态 | Enforcement owner | 证据摘要 |
|---|---|---|---|
| 单实例 | **enforceable** | T11 Daemon | loopback exclusive bind 拒绝第二实例。PowerShell named mutex 语义成立 |
| 关窗后 Daemon 继续 | **enforceable**（须 detached） | T11 | `detached:true` + `unref` 后父退出子仍活。非 detached 则父退出子死 |
| Desktop 重连同一 Daemon | **enforceable** | T11 | 第二 parent `mode=reconnect`，同 pid/port |
| Stale lock 恢复 | **enforceable** | T11 | 仅 `wx` 文件锁在杀进程后残留 `EEXIST`，必须用 pid + startIdentity |
| Named mutex | **observable** | T11 native | Node 无内置；`.NET Mutex` 可证。产品用 `CreateMutexW` + bind + 状态文件 |
| 版本握手 | **observable**（轻量） | T11/T10 | 只比较 JSON `protocolVersion`。skew 矩阵 **untested** |
| 升级期间活动 Run | **untested** | T11/T17 | 建议有非终态 Run 则拒绝升级或先 drain |
| Token bootstrap | **untested** | T10 | — |
| Electron Job Object / 关窗 | **untested** | T11 | 未写 Electron。勿把 Daemon 放进随 App 退出而杀树的 job |

---

## 给下游任务的推荐接入

### T05 Mock Runtime / Host

- Descriptor 必须能表达 **pause unsupported**、**event cursor resume unsupported**、**usage 可能只有 token 没有钱**。UI 不得为此显示可点的 pause。
- cancel：202 接受 → grace → force 整树 → `cancelled` / `orphaned`。Mock 可用定时器，但契约要有「force 必须整树」钩子。
- 不要把 Node `child.kill()` 的 Windows 行为写成 Adapter 保证。
- worktree 只通过 T06 申请，不要自己在用户仓库 `git worktree add`。
- Handle：先短事务提交 intent，再 spawn，再短事务写 Handle（D04 窗口 1/2）。spawn 不进长 DB 事务。
- live Codex 不阻塞 Mock PR。

### T06 Workspace / `packages/process`

- **Windows 进程：** 首选 Job Object（`CREATE_SUSPENDED` → assign → resume，`KILL_ON_JOB_CLOSE`）。回退：根仍活时 `taskkill /PID /T /F`；根已死则按已记录 `(pid, startIdentity)` 逐个杀。禁止 `taskkill /IM`。禁止把 `tree-kill` 当架构。
- Handle 持久化 `pid + startIdentity`（建议 `win32:<pid>:<UTC StartTime>`）。identity mismatch **禁止杀**。
- 存活探测不要只靠 `process.kill(pid,0)`。
- 每个 Run 独立 worktree + 显式新 branch。不写用户脏主区。禁止省略 `-b`，禁止 `--force` 抢已占用 branch。
- 路径 < 200 字符；realpath 拒绝 junction 逃逸；Windows 大小写折叠。
- 清理顺序：杀进程树 → Artifact 已落盘才 unlock → `worktree remove --force` → 对账目录/list/gitdir → prune。失败则保留工作区。
- Artifact 未持久化时 `git worktree lock`。
- macOS/Linux 标未测直到 CI fixture。

### T07 Policy / 凭据 / 脱敏

- 本机 Codex **不是**强沙箱。无法实施的硬限制必须在 **start 前拒绝**，不能宣称审批不可绕过。
- 由 Host 选择 `-s` / `-a`；永不默认 `--dangerously-bypass-approvals-and-sandbox`。
- ChatGPT 登录留在 Codex store；Host 只在 API key 模式用 `credentialRef` + stdin。禁止复制用户整份 env / `auth.json`。
- 脱敏覆盖 `auth.json`、token、跨 JSONL 分块、错误、raw、诊断导出。
- 未知成本 ≠ 0。无可靠计量+可停止的 Runtime 不得启用货币硬上限。
- 外部文本不能改 Policy。

### T11 Electron / Daemon 生命周期

- Daemon 是独立 Node 进程，不是随窗口关闭的 Electron child。Windows spawn：`detached: true, stdio: 'ignore', windowsHide: true` + `unref()`。最后一窗关闭 **不要** `taskkill /T` Daemon。
- 单实例三层：`CreateMutexW`（如 `Local\WorkforceDaemon`）+ loopback exclusive bind + `%APPDATA%` 状态文件 `{pid, port, startIdentity, protocolVersion}`。不要只靠 `wx` 文件锁。
- Electron `requestSingleInstanceLock` 只锁 UI，不锁 Daemon。
- Stale：pid 死或 `GetProcessTimes` 不匹配 → 新 Daemon。禁止 attach 到 PID 复用。
- 重连读状态文件 → health → 校验 identity/version。不兼容则可恢复错误，不要默默开第二个 Daemon。
- 升级+活动 Run **未测**：有非终态 Run 则拒绝升级或 drain（交 T17）。
- Renderer 仍无 fs/child_process（本 spike 未写 Electron，不改变该验收）。

### T15 Codex Adapter

1. 探测顺序：`RuntimeConfig.executable` → PATH `codex`/`codex.exe` → `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`（跑 `--version`）→ WindowsApps `OpenAI.Codex_*\app\resources\codex.exe`。不要自动选第三方 bundle（本机有 AionUi 0.144.6）。
2. `validate`：executable + `codex-cli X.Y.Z` + `login status`。未登录 → 不 start。
3. 能力以 **当前二进制 `--help`** 为准，不要写死 `proto` / `pause`。
4. 拟定（**live 未证**）start：`codex exec --json -C <workspace> --skip-git-repo-check` 加上 Host 选定的 `-s`/`-a`。JSONL → 标准事件，原始字段进 `raw.openai.codex`。
5. 声明 **unsupported**：`lifecycle.pause`、`event.resume`（cursor）。cancel = T06 进程树。usage 可从落盘/未来 JSONL 观察 token，货币硬预算默认关。
6. Windows：异步读 stdout，detect 超时；不要同步 pipe 死锁 `--help`。
7. 所有 spawn/cancel 走 T06。假设存在孙进程（shell/git）。

### T04（相邻，非本任务实现）

- WAL + `busy_timeout` + `BEGIN IMMEDIATE`；状态/Event/Outbox 同事务；任何错误 `ROLLBACK`。
- 单写者。`node:sqlite` 在 Node 24 上足够做本实验；产品驱动由 T04 另选并测 Drizzle。

---

## 契约变更请求（交给 T00/T02，本分支不改协议）

1. **不要**把 `codex proto` 写成 V0.1 必选传输。本机 0.153.4 无该子命令。
2. `resume`（会话）≠ `event.resume`（cursor）。Codex 的 `event.resume` 保持 unsupported，除非以后 live 证明 JSONL 可按 cursor 续。
3. `lifecycle.pause` 保持可选，默认关闭。
4. `RuntimeHandle.process.startIdentity` 已存在。建议冻结 Windows 编码 `win32:<pid>:<CreateTime UTC>`；可选并列 `createdAt`。`identity_mismatch` 禁止杀进程。
5. 无其它必须改的 SPI 字段。Windows MSIX 发现属于 T15 内部。

---

## 明确不支持 / 不得宣称完成

- 原生 pause / POSIX SIGSTOP 冒充 pause
- 强 OS 沙箱、审批一定无法绕过
- Exactly-once 事件、cursor 续流
- 按进程名取消
- 掉电耐久的 SQLite 保证
- 三平台（macOS/Linux）行为
- live Codex 付费任务、真实取消/审批环、exec JSONL schema
- Electron 关窗与升级中的活动 Run

V0.1 Node Daemon + Codex CLI Adapter **不是**强安全沙箱。只有受信用户应跑本地执行。
