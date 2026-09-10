# Spike: 进程树与取消（Windows）

- **Date:** 2026-09-10
- **Env:**
  - Windows NT 10.0.19045 x64
  - Node v24.19.0 (`C:\Program Files\nodejs\node.exe`)
  - PowerShell 7.6.6
- **macOS:** 未测
- **Linux:** 未测

可重复入口（无额外 npm 依赖）：

```text
node tooling/spikes/process-tree/run.mjs
```

脚本：

| 文件 | 作用 |
|---|---|
| `tooling/spikes/process-tree/child-tree.mjs` | 父进程打印 pid，再 spawn 两个 `node -e` 孙进程；写入 pidfile |
| `tooling/spikes/process-tree/run.mjs` | 实验 A–F |
| `tooling/spikes/process-tree/query-tree.ps1` | Toolhelp32 快照（ParentProcessId） |
| `tooling/spikes/process-tree/job-object.ps1` | Win32 Job Object + `KILL_ON_JOB_CLOSE` |

临时输出：`tooling/spikes/.tmp/process-tree/`（含 `results.json`）。

`Get-CimInstance Win32_Process` 在本机从 Node 拉起的 pwsh 7.6.6 中失败（`Microsoft.Management.Infrastructure.Native.ApplicationMethods` type initializer）。本 spike 改用 Toolhelp32 + `Get-Process.StartTime` + `tasklist /FI "PID eq N"`。

---

## Commands

```text
node tooling/spikes/process-tree/run.mjs
```

内部调用（由 runner 发出，不必手工跑）：

```text
child_process.spawn(process.execPath, [child-tree.mjs], { stdio: ['ignore','pipe','pipe'], windowsHide: true, detached: false })
child.kill('SIGTERM') | process.kill(pid, 'SIGINT'|'SIGTERM') | child.kill('SIGKILL')
taskkill /PID <parent> /T /F
tasklist /FI "PID eq N" /FO CSV /NH
tasklist /FI "IMAGENAME eq node.exe"     # 只列举，绝不 /IM 杀
pwsh -File query-tree.ps1 -ProcessIds <pids>
pwsh -File job-object.ps1 -ProcessId <parent> ...
```

未执行（危险）：`taskkill /IM node.exe /F`。

---

## Expected

| 实验 | 预期 |
|---|---|
| A | 能记录 runner → parent → 2 grandchildren（及可能的 `conhost.exe`）pid / parent / startTime |
| B | `child.kill('SIGTERM')` **不是** POSIX 优雅退出；Windows 上等价于对该 pid `TerminateProcess`。孙进程 **不保证** 一起死 |
| C | 根仍活着时 `taskkill /PID <parent> /T /F` 杀掉整棵可见树 |
| C2 | 先杀掉根再 `/T`：孤儿还活着，`taskkill` 报 process not found |
| D | `/T /F` 不误杀 sibling sentinel；runner 仍活 |
| E | 能展示 ParentProcessId；Job Object 若能 Assign，则 close handle 后整树应死 |
| F | Node 的 SIGINT/SIGTERM/SIGKILL 在 Windows 上对**其他进程**都是强制终止；已安装的 JS signal handler 不应被调用 |
| 镜像名 | 本机大量 `node.exe` 同名；按镜像杀会误伤 IDE / runner / sentinel |

---

## Actual

实测 runner pid = **11072**（`2026-09-10T10:13:36.447Z`）。`process.kill(pid,0)` 在刚终止后可能仍成功，而 `tasklist` 已显示不存在——对账必须以 tasklist / `GetExitCodeProcess != STILL_ACTIVE` / startIdentity 为准。

### A — spawn tree

`spawn(process.execPath, [child-tree.mjs], { stdio: pipe, windowsHide: true, detached: false })`。

| label | pid | alive | parentPid | name | startIdentity |
|---|---:|---|---:|---|---|
| runner | 11072 | true | 22896 | node.exe | `win32:11072:2026-09-10T10:13:36.1658308Z` |
| parent | 37528 | true | 11072 | node.exe | `win32:37528:2026-09-10T10:13:36.4528782Z` |
| grandchild-1 | 22752 | true | 37528 | node.exe | `win32:22752:2026-09-10T10:13:36.5232676Z` |
| grandchild-2 | 19864 | true | 37528 | node.exe | `win32:19864:2026-09-10T10:13:36.5494281Z` |
| extra | 13208 | true | 37528 | conhost.exe | （未取 StartTime） |

Toolhelp 子进程：`conhost.exe` + 两个 `node.exe`。即使 `windowsHide: true`，树根仍可能挂一个 `conhost.exe`。`/T` 会把它一并杀掉。

### B — `child.kill('SIGTERM')`（stdio inherit，无 `/T`）

Before：

| label | pid | alive | parentPid |
|---|---:|---|---:|
| parent | 19096 | true | 11072 |
| grandchild-1 | 24856 | true | 19096 |
| grandchild-2 | 30128 | true | 19096 |
| conhost | 31600 | true | 19096 |

`child.kill('SIGTERM')` → `true`。父 `exit`：`signal=SIGTERM`, `killed=true`。pidfile 中 **无** `signal … SIGTERM` 日志（JS handler 未运行）。

After 2s：parent / gc1 / gc2 **全部 dead**。

这 **不能** 当成 Windows 会杀整树。见 B3：同样 `child.kill('SIGTERM')`，孙进程 `detached:true` + `stdio:'ignore'` 时全部幸存。inherit 情况下孙进程随父退出，更像共享 console/`conhost`/stdio 生命周期，而不是内核保证。

### B2 / F — SIGINT vs SIGTERM vs SIGKILL

| 方法 | parent 死 | 孙进程（inherit） | JS signal 日志 | ChildProcess exit |
|---|---|---|---|---|
| `process.kill(pid, 'SIGINT')` | 是 | 同死 | 空 | `exitCode=1`, `signal=null`, `killed=false` |
| `process.kill(pid, 'SIGTERM')` | 是 | 同死 | 空 | 强制终止 |
| `child.kill('SIGKILL')` | 是 | 同死 | 空 | 强制终止 |

Windows 上 Node 对**其他进程**的 `SIGINT` / `SIGTERM` / `SIGKILL` 都是 `TerminateProcess`（文档亦写明 abrupt，类似 SIGKILL）。没有 POSIX 优雅 SIGTERM。真正的 Ctrl+C 需要独立 console + `GenerateConsoleCtrlEvent`，且容易误伤同 console 的 runner，本 spike 未采用。

### B3 — 父进程-only kill + **detached** 孙进程（孤儿）

`SPIKE_GC_DETACHED=1`：`stdio:'ignore'`, `detached:true`, `unref()`。

| 阶段 | parent 8240 | gc 32148 | gc 48512 |
|---|---|---|---|
| before | alive, parent=11072 | alive, parent=8240 | alive, parent=8240 |
| `child.kill('SIGTERM')` +2s | **dead** | **alive** | **alive** |

**孙进程在父被 TerminateProcess 后继续运行。** Windows 不会因为父死而杀子进程。

### C — `taskkill /PID <parent> /T /F`（根仍活着）

Before：parent 11192，gc 52248 / 31120，conhost 52656。

```text
SUCCESS: The process with PID 52656 (child process of PID 11192) has been terminated.
SUCCESS: The process with PID 52248 (child process of PID 11192) has been terminated.
SUCCESS: The process with PID 31120 (child process of PID 11192) has been terminated.
SUCCESS: The process with PID 11192 (child process of PID 11072) has been terminated.
```

After：三个 node 记录全部 dead。`allDescendantsGone=true`。`/T` 在**根仍存活**时能按当前 ParentProcessId 快照杀掉整棵可见树（含 conhost）。

### C2 — 先杀根，再对已死根 `/T /F`（孤儿空洞）

Detached 孙进程：parent 26252，gc 39924 / 2660。

1. `child.kill('SIGTERM')`：父死，两孙仍活（Toolhelp 仍显示 `parentPid=26252`）。
2. `taskkill /PID 26252 /T /F` → **`ERROR: The process "26252" not found.`** (exit 128)。
3. After：gc 39924、2660 **仍然 alive**，startIdentity 未变。

**结论：** 先 `child.kill()` 再 `taskkill /T` 会漏掉孤儿。force 路径必须在根还活着时 `/T`，或事先记下整棵树的 `(pid, startIdentity)` 并逐个核对后杀掉。

### D — 无关 sentinel

Sibling `node -e` sentinel pid **52416**（parent=runner 11072），与 tree parent **41396** 并列，不在树内。

`taskkill /PID 41396 /T /F` 杀掉 50156(conhost) / 41536 / 48140 / 41396。

After：

| label | pid | alive |
|---|---:|---|
| parent | 41396 | false |
| grandchild-1 | 41536 | false |
| grandchild-2 | 48140 | false |
| **sentinel** | **52416** | **true** |
| runner | 11072 | true |
| sentinel 的 conhost | 24856 | true |

按 pid 树杀 **不会** 误伤 sibling。随后 runner 清理了 sentinel。

**按镜像名则危险：** 当时 `tasklist /FI "IMAGENAME eq node.exe"` 命中 **33** 个 `node.exe`，样本含 IDE/工具进程；`includesRunner=true`, `includesSentinel=true`, `includesTreeParent=true`。Adapter **禁止** `taskkill /IM node.exe`（协议 07 §9.3 已禁止按宽泛进程名杀其他 Run）。本 spike **没有** 执行 `/IM`。

### E — 进程关系 + Job Object

- 关系 API：Toolhelp32 可用；CIM/WMI 从该 Node 子 pwsh 不可用。
- `AssignProcessToJobObject` **成功**（pid 17108，`stage=assigned`）。释放 hold 后孙进程再 spawn。
- Close job（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）后：parent 17108、gc1 53112 确认死亡。gc2 26648：`process.kill(0)` 仍 true，但 **tasklist 已无此 PID**（陈旧存活探测）。
- 更早一次完整跑次中，close 后三个 pid 的 `kill(0)` 均为 false。

Job Object **可以** 在本环境工作，但「spawn 后再 Assign」存在竞态：Assign 前已创建的子进程、或 `CREATE_BREAKAWAY_FROM_JOB` 的子进程可能不在 job 里。T06 应在 **CREATE_SUSPENDED 时入 job，再 Resume**，不要依赖事后 Assign。

Node `child_process` 无 Job Object 选项；本 spike 用 PowerShell `Add-Type` P/Invoke，无 npm。

---

## Recommended API for T06 `packages/process`

| 方案 | 优雅？ | 整树？ | 孤儿？ | 误杀无关进程 | 依赖 |
|---|---|---|---|---|---|
| `child.kill()` / `process.kill(pid)` only | 否（Windows = TerminateProcess 单 pid） | 否（detached/breakaway 子进程幸存；inherit 偶发同死不可靠） | 高 | 低（只动一个 pid，但 PID 复用危险） | Node 内置 |
| `taskkill /PID <root> /T /F` | 否 | 根仍活着时：是（本机已证） | 根已死则 **漏杀** | 低（按 pid 树，不按名） | OS 自带 |
| npm `tree-kill` | 否 | 同 `taskkill /T /F`（Windows 实现就是这句） | 同左 | 同左 | 额外依赖，无新能力 |
| Win32 Job Object + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` | 否（close = 强杀整 job） | **设计上是**；需创建时入 job | 低（job 内后代默认继承） | 低（不在 job 的 sentinel 不受影响） | 原生/win32；Node 无内置 |

**推荐（Windows）：**

1. **首选：** T06 用 native/win32（`koffi` / N-API / 小 helper）在 spawn 时创建 Job Object：`CreateJobObject` → `SetInformationJobObject(JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)` → `CreateProcess` **CREATE_SUSPENDED** → `AssignProcessToJobObject` → `ResumeThread`。Handle 持有 job handle；cancel force / Adapter 崩溃 / Daemon 丢弃 Handle 时 close job，整树死。不要给进程 `CREATE_BREAKAWAY_FROM_JOB`，除非明确允许逃逸。
2. **回退：** 启动后立刻 Toolhelp 快照整树，持久化每个节点的 `startIdentity`。Force：若根仍活，`taskkill /PID <root> /T /F`；若根已死，对每个仍匹配 identity 的后代 `taskkill /PID <pid> /F`（不要对已死根 `/T`）。
3. **不要** 把 `tree-kill` 当架构依赖——Windows 上它只是薄封装。
4. **永远不要** 按镜像名 / 窗口标题杀。
5. **PID 不够：** 必须 `pid + create time`（`GetProcessTimes` / `Get-Process.StartTime`）。复用 pid 时 identity mismatch → `orphaned`，禁止杀。
6. **优雅阶段不要用 `child.kill('SIGTERM')`。** 应走 Runtime 自己的 shutdown（stdin/RPC/`runtime.input` signal）。Windows 上若要模拟 Ctrl+C，必须给 Runtime **独立 console process group**，且失败则进入 force。grace period 后走 job close 或 `taskkill /T /F`。

存活探测：不要单靠 `process.kill(pid, 0)`。交叉 `tasklist` 或 `OpenProcess` + `GetExitCodeProcess`（`STILL_ACTIVE`），并核对 startIdentity。

---

## Capability findings

| 能力 | Windows 实测 | 说明 |
|---|---|---|
| cancel graceful | **weak / 非 POSIX** | `child.kill('SIGTERM')` = 单 pid 强杀；JS handler 不运行。真正优雅只能靠 Runtime 协议 |
| force tree kill | **enforceable**（根活着的 `taskkill /T /F`；Job Object close） | 根已死则 `/T` 失败，必须有 pid 名单或 job |
| identity check | **observable** | `Get-Process.StartTime` 稳定；建议 `win32:<pid>:<utcStart>` |
| orphan risk | **高**（若只杀父） | B3/C2：detached 孙进程在父死后仍活；`/T` 找不到死根 |
| unrelated process safety | **enforceable**（按 pid/job） | D：sentinel 与 runner 存活。按 `node.exe` 名则 **unsafe**（33 个同名） |
| pause / SIGSTOP | **unsupported** | Windows 无 POSIX stop；未测 Debug Active Process 挂起（不应冒充 pause） |
| CIM ParentProcessId | **degraded** | 本环境 pwsh+Node 下 CIM 失败；Toolhelp32 可用 |
| macOS process group / Linux cgroup | **未测** | — |

---

## Limits

- 只在 Windows 10.0.19045 + Node 24.19.0 验证。macOS `kill -- -pgid`、Linux cgroup/killpg **未测**。
- 未测 PTY/`GenerateConsoleCtrlEvent` 真 Ctrl+C（怕误伤 runner 所在 console）。
- 未把实验代码链到产品目录；无 Job Object 的生产级 native addon。
- `AssignProcessToJobObject` 在进程已落入不可嵌套 job（Windows Terminal / 部分 IDE）时会 `ERROR_ACCESS_DENIED (5)`。本次 Assign 成功，不代表所有宿主都成功——T06 要用 CREATE_SUSPENDED + 必要时 `CREATE_BREAKAWAY_FROM_JOB` 从父 job 脱离后再加入 **自己的** job。
- Codex/Claude 真实 Runtime 的子进程形态未测；它们几乎一定还会再 spawn shell/git。

---

## Recommendations for T05, T06, T15

**T05 Mock Runtime / Host**

- cancel 分阶段：receipt → grace → force → `runtime.cancelled` / `orphaned`。Mock 可用定时器模拟，不必真 job，但契约要留下「force 必须整树」的测试钩子。
- 不要把 Mock 的 `child.kill()` 行为当成真实 Windows Adapter 的保证。

**T06 `packages/process`**

- Windows supervisor：**Job Object 首选**，`taskkill /T /F` 回退。
- spawn 选项：`windowsHide: true`、禁止随意 `detached: true`（除非要把进程交给 Daemon 且已入 job）。
- Handle 持久化：`pid` + `startIdentity` + 可选 `jobName`/`jobHandleRef` + 启动时 descendant 快照。
- reconcile：identity mismatch 绝不杀；根死且无 job 且后代对不上 → `orphaned`。
- 三平台测试：Windows 本 spike 可作 fixture 思路；macOS/Linux 标未测直到 CI。
- 存活检查：tasklist / `GetExitCodeProcess`，不要只信 `kill(pid,0)`。

**T15 Codex Adapter**

- 所有启动/取消走 T06 process port，禁止 Adapter 自己 `taskkill /IM`。
- 优雅取消优先 Codex 自己的退出协议（若 T03 Codex 探测证明存在）；没有则 grace 后 force tree。
- Codex 会再拉起工具子进程：必须假设存在孙进程，按整树/job 取消。

---

## 契约变更请求

`RuntimeHandle.process.startIdentity` 已在 [07-runtime-protocol.md](../blueprint/07-runtime-protocol.md) 中。**不必改字段名。** 建议 T00/T02 仅冻结编码与校验：

1. 文档规定不透明但可比较：Windows 推荐 `win32:<pid>:<CreateTime UTC>`（`GetProcessTimes` FILETIME 或 `Get-Process.StartTime` 的 ISO）。
2. 可选（非必须）在 `process` 上增加结构化 `createdAt`（ISO-8601），与 `pid` 并列，避免各 Adapter 私有拼接。`startIdentity` 仍为对账主键。
3. 明确：`identity_mismatch` 时禁止 `TerminateProcess` / `taskkill`。
4. 不需要为 tree-kill 或镜像名杀新增协议；保持「禁止按进程名杀」即可。

不改蓝图正文；由 T00/T02 决定是否把 `createdAt` 写入 schema。
