# Spike: Desktop/Daemon 生命周期（Windows）

日期：2026-09-10  
状态：Windows 已测；macOS / Linux **未测**  
范围：两个 Node 进程模拟 Desktop（parent）与 Daemon（child）。**未写 Electron。**

## 环境

| 项 | 值 |
|---|---|
| OS | Windows 10 Pro for Workstations `10.0.19045` (win32 x64) |
| Node | v24.19.0 |
| 工作目录 | `C:\Users\chen\.herdr\worktrees\workforce\task-t03-spikes` |
| 实验代码 | `tooling/spikes/daemon-lifecycle/` |
| 状态/锁/结果 | `tooling/spikes/.tmp/daemon-lifecycle/`（`daemon.json`、`daemon.lock`、`results.json`） |
| 协议字段 | `protocolVersion: "0.1-spike"`（仅 JSON 字段比较，无版本矩阵） |
| 实例锁端口 | `127.0.0.1:18765`（`exclusive: true`，Node 侧代替 named mutex） |
| HTTP API | `127.0.0.1:0`（ephemeral；本次 A 实际为 `3541`） |

## 命令

```text
node tooling/spikes/daemon-lifecycle/run.mjs
```

单步（同一 `--state-dir`）：

```text
node tooling/spikes/daemon-lifecycle/desktop.mjs --state-dir tooling/spikes/.tmp/daemon-lifecycle
node tooling/spikes/daemon-lifecycle/daemon.mjs --state-dir tooling/spikes/.tmp/daemon-lifecycle
```

本次编排结果：`ALL PASS`，结束于 `2026-09-10T10:09:34.629Z`。原始 JSON：`tooling/spikes/.tmp/daemon-lifecycle/results.json`（临时目录，不入库）。

## 实验

### A. Desktop1 启动 Daemon，health ok

**命令：** `run.mjs` 调起 `desktop.mjs`（`spawn({ detached: true, stdio: 'ignore' })` + `unref()`）。

**预期：** Desktop 退出码 0；Daemon 监听 loopback；`GET /health` ok；状态文件含 `{pid, port, startIdentity, startedAt}`。

**实际：** PASS。Desktop pid `15724` 于 `10:09:26.060Z` spawn Daemon pid `20584`；`10:09:26.360Z` `connected mode=spawn`，port `3541`，`startIdentity=20584:2026-09-10T10:09:26.0358128Z:acbe7e9c2dba1333`（含 `Get-Process.StartTime`）。`/health` ok，`protocolVersion` 匹配。

### B. Desktop1 退出后 Daemon 仍在

**预期：** Desktop1 进程已死；同一 Daemon pid/port 持续 `/health` ok（关窗不杀后台，D13）。

**实际：** PASS。`desktop1Alive=false`；五次轮询（`10:09:26.586Z`–`10:09:27.220Z`）均为 pid `20584` / port `3541` / `ok`。

### C. Desktop2 重连同一实例

**预期：** 不二次 spawn；`mode=reconnect`；pid/port/`startIdentity` 与 A 相同。

**实际：** PASS。Desktop pid `26648` 于 `10:09:27.659Z` 重连 `daemonPid=20584` `port=3541`，无 `spawned-daemon` 事件。

### D. 直接再启第二个 Daemon → 拒绝

**预期：** 退出码 2；打印已有实例；原 Daemon 仍活。

**实际：** PASS。pid `25404` 绑定 `127.0.0.1:18765` → `EADDRINUSE`；`single-instance-rejected` 报告 existing pid `20584` port `3541` `pidAlive=true`；exit `2`。

### E. 杀掉 Daemon，残留 stale lock → 新 Desktop 恢复

**预期：** `fs.open(..., 'wx')` 对残留锁文件 `EEXIST`（仅文件锁不够）；inspect 为 `stale-dead-pid`；新 Desktop spawn **不同** pid/port，health ok。不得把 PID 复用当成旧 Daemon。

**实际：** PASS。`process.kill(20584)` 后 pid 死，`daemon.json` 与 `daemon.lock` 仍在。`wx` → `EEXIST`。Desktop `39384` 记录 `stale-state`，spawn `46972`，`connected mode=spawn` port `3553`，新 `startIdentity=46972:2026-09-10T10:09:28.2260367Z:d3b42fdbf64607ed`。实现注意：重连不得信任 stale JSON 里的旧 port；必须等到 **新 child 覆写** `startIdentity` 后再 `GET /health`。

### F. 对比：非 detached / 进程树

#### F1. `detached: false`，parent `process.exit()`

**预期（Windows + Node）：** 子进程**不能**在父退出后继续。Node 文档要求 Windows 上 `detached: true`（且通常 `stdio: 'ignore'`）才能让 child 活过 parent。这与 A/B 的 detached 存活形成对照。

**实际：** PASS。Holder `48728` 在父仍活时 health ok（Daemon `52924` port `3557`）；holder exit 0 后 `daemonAliveAfterParentExit=false`，`/health` `fetch failed`。

#### F2. `detached: false`，`taskkill /T /F` 杀父进程树

**预期：** holder 与 daemon 均死；health 失败。

**实际：** PASS。Holder `53092`、Daemon `27740` port `3567` 在杀前 health ok；`taskkill /PID 53092 /T /F` 退出码 0，树内进程（含 `27740`）被终止；之后 health 失败。

### MUTEX. PowerShell `System.Threading.Mutex`（CreateMutex）

Node 无内置 named mutex。用 `mutex-probe.ps1` 跨进程探测 `Local\WorkforceDaemonSpikeT03`。

**预期：** 持有期间第二进程 `BUSY` / exit 2；释放后第三进程可 `HELD`。

**实际：** PASS。第一进程 `HELD`；第二 `BUSY` exit 2；释放后第三 `HELD` + `RELEASED`。这是 **CreateMutex 语义的轻量证据**，不是产品 Daemon 已链上 Win32 mutex。

## 限制

- 未使用 Electron；未测 Chromium Job Object / `KILL_ON_JOB_CLOSE` / `utilityProcess`。T11 必须避免把 Daemon 放进会随 App 退出而杀树的 job。
- 未测 `CreateMutexW` 原生绑定（仅 PowerShell `.NET Mutex`）。
- 未测 PID 复用实锤（有 `osStartIdentity` 字段与校验路径，未注入复用 pid）。
- 版本握手只比较 JSON `protocolVersion`；**未测**旧 Daemon / 新 Desktop 的 skew 矩阵与可恢复错误 UI。
- **升级期间活动 Run：未测**（设计备注：drain 或拒绝升级，见下）。
- Token bootstrap / session 轮换：**未测**（属 T10）。
- 未测多窗口 Desktop、托盘、安装包、自启动。
- 锁端口 `18765` 只是 spike 替身；产品 HTTP 仍应是 ephemeral loopback（T10），单实例不要靠固定业务端口。
- `wx` 文件锁在 Windows 上：进程被杀后文件残留，`delete-on-close`/`flock` 语义与 Unix 不同；本实验已证明仅 `EEXIST` 不能恢复。
- macOS、Linux：**未测**。

## 给 T11 的建议

- Daemon 必须是**独立 Node 进程**，不是随窗口关闭而死的 Electron child。
- Desktop spawn（Windows）：

  ```js
  spawn(execPath, daemonArgs, { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  ```

  关最后一窗时**不要** `child.kill()` / 不要 `taskkill /T` 整棵树。若仍有允许继续的 Run（D13），只退出 UI 或退到托盘。
- 单实例用三层，缺一不可：
  1. **Windows named mutex**：`CreateMutexW`，名称如 `Local\WorkforceDaemon`（同用户会话用 `Local\`；服务/跨 session 才考虑 `Global\`）。Electron `app.requestSingleInstanceLock()` 只锁 **Desktop UI**，不能代替 Daemon 锁。
  2. **loopback exclusive bind**：证明进程确实在听；可作 Node 无 native 时的后备（本 spike 的 `18765`）。产品 API 端口仍为 `127.0.0.1:0`。
  3. **用户本地状态文件**（`%APPDATA%\Workforce\daemon.json` 一类）：`{ pid, port, startIdentity, osStartIdentity, startedAt, protocolVersion }`。只用于发现与重连，不当唯一锁。
- **不要**只靠 `fs.open(wx)` / 文件锁。Windows 上杀进程后锁文件残留（本实验 `EEXIST`）；没有 Unix `flock` + 可靠 delete-on-close。
- Stale 恢复：`pid` 死亡，或 `GetProcessTimes` / `Get-Process.StartTime` 与 `osStartIdentity` 不一致（PID 复用）→ 视为 stale，覆写状态并启动新 Daemon。**禁止**把新进程当成旧 Daemon 去 attach；也**禁止**因 stale 去杀“活着但 identity 不匹配”的 pid。
- 重连：Desktop 读状态文件 → `GET http://127.0.0.1:{port}/health` → 校验 `startIdentity` + `protocolVersion`。不匹配则给出可恢复错误，不要默默开第二个 Daemon（除非确认 stale）。
- 版本握手：T11 验收要求旧 Daemon / 新 Desktop 不兼容时的可恢复错误。本 spike **只比较了一个 JSON 字段**，未做 skew 矩阵。
- 升级 + 活动 Run：**未测**。建议默认：有非终态 Run 则拒绝升级或先 drain；不要在活动进程上热替换 Daemon 可执行文件。细节交 T17，T11 需留 updater 交接面。
- Token bootstrap：本 spike 未测。Desktop 仍不得在最后一窗关闭时杀掉允许继续的 Daemon（D13）；短时 token 由 T10 在重连时重发，不作为“Daemon 跟窗走”的理由。

## 能力表

| 能力 | 结论 | 证据 |
|---|---|---|
| 单实例 | **enforceable**（本机 Node） | D：`EADDRINUSE` + exit 2 |
| 父退出、子继续 | **enforceable**（须 `detached: true` + `unref`） | A/B vs F1 |
| 重连同一 pid/port | **enforceable** | C |
| Stale lock 恢复 | **enforceable** | E：`wx` 失败但仍能按 dead pid 替换 |
| Named mutex | **observable**（PowerShell CreateMutex 语义） | MUTEX；产品需 native/`CreateMutexW`，Node 无内置 |
| 文件锁单独使用 | **unsupported**（Windows 杀进程残留） | E：`EEXIST` leftover |
| 版本握手 | **observable**（轻量字段） | A/C `protocolVersion` 相等即 `versionOk`；**无 skew 矩阵** |
| 升级期间活动 Run | **untested** | 仅设计备注：drain 或拒绝 |
| Token bootstrap | **untested** | T10 |
| Electron 关窗 / Job Object | **untested** | 未写 Electron |
| macOS launchd / flock | **untested** | 见下 |
| Linux flock / systemd --user | **untested** | 见下 |

## 其他平台（未测）

**macOS（未测）：** 单实例可用 `flock` + pidfile，或 `launchd` bootstrap；GUI 用 `LSMultipleInstancesProhibited` 只锁 App 不锁 Daemon。父退出后子继续通常不需要 Windows 那种 `detached` 控制台语义，但仍应 `setsid`/launchd 以免 App 被 SIGKILL 时误伤。PID 复用同样要用 start time / `kern.proc` 对账。

**Linux（未测）：** `flock` 在进程死后由内核释放，比 Windows 文件锁可靠；pidfile + `/proc/<pid>/stat` starttime 防复用。长期可考虑 `systemd --user` 管 Daemon，Desktop 只 bus/HTTP 连接。不要用固定 TCP 端口当产品锁。

## 契约变更请求

无。本 spike 不改 protocol / API schema。T10/T11 可把 `protocolVersion`、`startIdentity` 放进 health/handshake DTO，由 T02 收口，不在此复制类型。
