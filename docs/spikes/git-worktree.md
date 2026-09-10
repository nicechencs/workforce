# Spike: Git worktree 异常（Windows）

**日期：** 2026-09-10  
**环境：** Windows 10.0.19045（10 Pro for Workstations, win32 x64），git 2.55.0.windows.3，Node v24.19.0  
**macOS / Linux：** 未测  
**可重复命令：** `node tooling/spikes/git-worktree/run.mjs`（可选 `--keep` 保留沙箱）  
**沙箱：** 仅 `tooling/spikes/.tmp/git-worktree/`，不使用产品仓库作实验对象，不 `git push`、不创建 remote。

相关产物：

- `tooling/spikes/git-worktree/run.mjs`
- `tooling/spikes/git-worktree/lock-hold.mjs`（Node `fs.openSync`，Windows 上带 `FILE_SHARE_DELETE`）
- `tooling/spikes/git-worktree/lock-hold-share-none.ps1`（`FileShare.None`，模拟 IDE/杀毒/Office 类原生锁）

本机补充：

| 项 | 值 |
|---|---|
| `core.ignoreCase`（`git init` 默认） | `true` |
| `core.symlinks` | `false` |
| `core.longpaths` | 未设置 |
| OS `LongPathsEnabled` | `1`（`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`） |
| 文件符号链接 | `EPERM`（无 `SeCreateSymbolicLinkPrivilege` / 未开 Developer Mode） |
| 目录 junction | 无需管理员，可创建 |

Git 在 Windows 上的输出统一使用正斜杠 `C:/Users/...`；Node/`fs` 与 `cwd` 使用反斜杠。T06 必须归一化后再比较。

---

## 能力表

| 能力 | Windows 实测 | 分类 | 说明 |
|---|---|---|---|
| 独立可写目录 | 是 | **enforceable** | 每个 worktree 独立 checkout，inode/内容均不共享 |
| dirty-main 隔离 | 是 | **enforceable** | 主工作区脏文件/未跟踪文件不泄漏进新 worktree |
| 并发 worktree | 是 | **enforceable** | 不同 branch 可并行；同一相对路径互不影响 |
| 崩溃后清理 | 部分 | **observable** + 可重试 | 目录已删则 `prune` 清 metadata；锁导致删失败时 metadata 可能已注销、目录残留 |
| Windows 文件锁 | 视锁类型 | **enforceable**（进程 cwd / `FileShare.None`）；Node `open` **不能**当锁 | `--force` 不覆盖 OS 锁 |
| prune 残留 metadata | 是 | **enforceable** | `gitdir` 指向不存在路径时 `prune -v` 删除 `.git/worktrees/<name>` |
| 同 branch 双 checkout | 默认拒绝 | **enforceable**（只要 T06 不用 `--force`） | `--force` 可绕过，危险 |
| 长路径 | ~200 可；≥240 失败 | **unsupported**（超出短路径预算） | 即使 OS long path + `core.longpaths=true` 仍 `fatal: '$GIT_DIR' too big` |
| junction 逃逸 | 可逃逸 | **observable**，T06 必须拒绝 | 无需管理员 |
| 文件/目录 symlink | 本机创建失败 | **unsupported**（无特权）；逃逸 **未测** | |
| 脏 submodule worktree | 未做 | **untested**（本 spike 跳过） | |
| macOS / Linux | 未做 | **untested** | |

---

## A. 干净仓库 + 带空格路径

**Commands**

```text
git init -b main
git add . && git commit -m "init spike repo"
git worktree add "<tmp>/wt a spaces" -b run-a
git worktree list --porcelain
```

**Expected**

`worktree add` 在带空格路径上成功；checkout 为已提交树；worktree 的 `.git` 是 `gitdir:` 指针文件。

**Actual**

- `exit=0`。`HEAD is now at c16d09f`，stderr：`Preparing worktree (new branch 'run-a')`。
- worktree `README.md` = `committed-v1`（干净）。
- `.git` 文件内容：`gitdir: C:/Users/chen/.../main-repo/.git/worktrees/wt-a-spaces`（空格被 metadata 名规范化为连字符）。
- `--git-dir` 指向 `main-repo/.git/worktrees/wt-a-spaces`；`--git-common-dir` 指向 `main-repo/.git`。
- metadata 目录含 `commondir, gitdir, HEAD, index, logs, ORIG_HEAD, refs`。

**Limits**

路径必须用 argv 数组传给 git，不要拼进 shell 字符串。metadata 名 ≠ 目录 basename。

---

## B. Dirty main 时 `worktree add`

**Commands**

```text
# main: modify tracked README.md + add untracked-only.txt (not committed)
git worktree add "<tmp>/wt-b-dirty" -b run-b
git status --porcelain=v1   # in main and in wt-b-dirty
git worktree add "<tmp>/wt-b-same-branch"          # no -b
git worktree add "<tmp>/wt-b-main-again" main      # explicit same branch
git worktree add --force "<tmp>/wt-b-force-main" main
```

**Expected**

新 branch 的 worktree 可以在主工作区脏时创建；脏文件不泄漏。显式签出已被占用的 `main` 应失败。

**Actual**

- 主区 `status`：` M README.md` 与 `?? untracked-only.txt`。
- `worktree add -b run-b` **成功**（`exit=0`）。新 worktree `README.md` 仍为 `committed-v1`；`untracked-only.txt` **不存在**于新 worktree；主区保持脏。
- **无 `-b`：** Git 2.55 会**新建**名为 `basename(path)` 的分支（此处 `wt-b-same-branch`），**不会**复用 `main`。`exit=0`。
- **显式 `main`：** `exit=128`  
  `fatal: 'main' is already used by worktree at '.../main-repo'`
- **`--force` + `main`：** `exit=0`，允许第二个 `main` checkout（两个 worktree 共享同一 branch HEAD，危险）。

**Limits**

脏主区**不是**创建隔离 Run 的阻塞条件，也**不能**当作隔离失败。T06 仍不得把用户脏主区当可写 checkout。必须显式 `-b <run-branch>`，禁止省略 `-b`，禁止 `--force` 复用已 checkout 的 branch。

---

## C / I. 两个并发 worktree

**Commands**

```text
git worktree add "<tmp>/wt-c1" -b run-c1
git worktree add "<tmp>/wt-c2" -b run-c2
# edit shared.txt differently in each; commit in each
```

**Expected**

两个 worktree 可独立编辑同一相对路径；主区不受影响；工作文件不共享。

**Actual**

- `c1/shared.txt=edited-in-c1`，`c2/shared.txt=edited-in-c2`，`main/shared.txt=shared-base`。
- 未编辑的 `only-b.txt` / `only-a.txt` 仍为 base。
- Windows inode 不同（`4503599628964107` vs `3377699722122434`）。
- 各自 commit 后主区 `HEAD` 仍为初始 commit。

**Limits**

隔离的是**工作区文件**，不是 object store / refs。分支名、`HEAD`、index 在 `.git/worktrees/<name>/` 下独立；blob 仍进同一个 `.git`。T14 整合必须另开 integration worktree，而不是在某个 Developer Run 的目录里 merge。

---

## D. 文件占用时 `worktree remove`（Windows 锁）

**Commands**

```text
git worktree add "<tmp>/wt-d-lock" -b run-d
node lock-hold.mjs <worktree>/src/app.js          # Node fs.openSync r+
git worktree remove <wt-d-lock>

git worktree add "<tmp>/wt-d-share-none" -b run-d-share
powershell lock-hold-share-none.ps1 <file>        # FileShare.None
git worktree remove <wt>
git worktree remove --force <wt>

# child node process with cwd=<worktree>
git worktree remove --force <wt-d-cwd>
```

**Expected**

打开的文件句柄或占用 cwd 的进程会阻止删除；`--force` 只忽略脏文件，不覆盖 OS 锁。

**Actual**

1. **Node `fs.openSync`：** `worktree remove` **成功** `exit=0`，目录消失，list 中已无该项；持锁进程仍活着（`lockerAlive=true`）。Node/libuv 默认 `FILE_SHARE_DELETE`，**不能**模拟「文件正在使用」。
2. **`FileShare.None`：** 无 `--force` 时 `exit=128`：`contains modified or untracked files, use --force to delete it`（锁住的文件使 git 无法按干净树删除）。`--force` 时 `exit=255`：`error: failed to delete '.../wt-d-share-none': Invalid argument`，**目录仍在**。
3. **进程 cwd = worktree：** `--force` 仍 `exit=255`：`failed to delete '.../wt-d-cwd': Permission denied`，目录仍在。
4. **关键异常：** 上述 255 失败之后，`git worktree list` **已经不含该 worktree**，`.git/worktrees/` 中 metadata 已删除。再 `remove --force` → `fatal: '...' is not a working tree`，但目录还在。杀掉持锁进程后 `fs.rmSync` 才能删掉残留目录。

**Limits**

- `--force` ≠ 解锁。
- remove 失败也可能已经注销 git 侧登记 → 残留目录成为孤儿，必须单独 `rm` + `prune`。
- 清理顺序必须是：先杀 Run 进程树（含 cwd 在工作区的子进程）→ 再 `worktree remove` → 再确认目录不存在 → `prune`。失败则保留目录，不得报「已清理」。

---

## E. `--force` / `prune` / 崩溃式删除残留

**Commands**

```text
git worktree add "<tmp>/wt-e-prune" -b run-e
# dirty README.md
git worktree remove <wt>                 # should fail
git worktree remove --force <wt>         # should succeed

git worktree add "<tmp>/wt-e-crash" -b run-e-crash
# fs.rmSync the worktree directory (crash / manual delete)
git worktree list
git worktree prune -v
```

**Expected**

脏 worktree 无 `--force` 不能删；无 OS 锁时 `--force` 可删。直接删目录后 list 显示 prunable，`prune` 清 metadata。

**Actual**

- 无 `--force`：`exit=128`  
  `fatal: '.../wt-e-prune' contains modified or untracked files, use --force to delete it`，目录仍在。
- `--force`：`exit=0`，目录消失。
- 崩溃式 `fs.rmSync` 后 list：`.../wt-e-crash  c16d09f [run-e-crash] prunable`，porcelain 含 `prunable gitdir file points to non-existent location`。
- `git worktree prune -v`：`exit=0`，stderr `Removing worktrees/wt-e-crash: gitdir file points to non-existent location`。metadata 目录中不再有该项。

**Limits**

`prune` 只清 **git metadata**，不删「已从 list 注销但仍占盘」的孤儿目录（见 D）。T06 要对账三件事：list、`.git/worktrees/<name>/`、文件系统路径。

---

## F. Locked index / gitdir / `worktree lock` / repair

**Commands**

```text
# F1 stale index.lock in .git/worktrees/<name>/
git status
git add README.md

# F2 Node open handle on worktree index
# F2b FileShare.None on worktree index
git add / git commit

# F3 Node open handle on gitdir file
git worktree remove --force <wt>

git worktree lock <wt> --reason spike-keep-until-artifact
git worktree remove --force <wt>     # should refuse
git worktree unlock <wt>
git worktree remove --force <wt>

# move directory without git worktree move
git worktree list                    # prunable
git worktree repair <new-path>
```

**Expected**

`index.lock` 阻塞写入；`git worktree lock` 阻止 remove；搬目录后 `repair` 能修 `gitdir`。

**Actual**

- **`index.lock`：** `git status` 仍 `exit=0`（optional lock / 只读刷新）。`git add` `exit=128`：  
  `fatal: Unable to create '.../.git/worktrees/wt-f-index/index.lock': File exists.`  
  `Another git process seems to be running in this repository, or the lock file may be stale`
- **Node 打开 index：** `add`/`commit` 仍成功（同样因为 `FILE_SHARE_DELETE` / 共享读写）。
- **`FileShare.None` 打开 index：** `add`/`commit` 均 `exit=128`：  
  `fatal: .../worktrees/wt-f-index/index: index file open failed: Permission denied`
- **Node 打开 `gitdir` 文件：** `worktree remove --force` 仍成功。
- **`git worktree lock`：** `remove --force` `exit=128`：  
  `fatal: cannot remove a locked working tree, lock reason: spike-keep-until-artifact`  
  `use 'remove -f -f' to override or unlock first`  
  解锁后 `remove --force` `exit=0`。
- **搬目录：** list 将旧路径标 `prunable`。`git worktree repair <newpath>` `exit=0`，stderr `repair: gitdir incorrect: .../worktrees/wt-f-move/gitdir`。之后 list 指向 `wt-f-moved`，在新路径 `git status` 正常。metadata 目录名仍为原来的 `wt-f-move`。

**Limits**

- 记录并持久化 **worktree 路径 + gitdir 路径 + branch + baseline SHA**，崩溃后才能 `repair`。
- 保护「Artifact 未落盘」应使用 `git worktree lock`，不要依赖 OS 文件锁。
- T06 默认不要用 `remove -f -f` 覆盖 lock。
- 残留 `index.lock` 是「另一 git 进程 / 崩溃」信号，不能当成功。

---

## G. 路径长度 / 大小写 / junction

**Commands**

```text
git worktree add <nested-path-len-N> -b run-g-N          # N=200,240,258,280,320
git -c core.longpaths=true worktree add ...              # N=240,258,280
# write readme.md over README.md
fs.symlinkSync(tmpRoot, worktree/junc-out, "junction")
fs.symlinkSync(outsideFile, worktree/link-secret.txt, "file")
```

**Expected**

接近 `MAX_PATH=260` 可能失败；NTFS 默认大小写不敏感；junction 可能指向工作区外。

**Actual**

| 路径长度 | `core.longpaths` | 结果 |
|---|---|---|
| 199 | 默认 off | `exit=0`，worktree 可用 |
| 240 | off | `exit=128` `fatal: '$GIT_DIR' too big` |
| 240 | `true` | 仍 `fatal: '$GIT_DIR' too big` |
| 258 / 280 / 320 | off | `exit=128` `could not create leading directories of '.../.git': Filename too long` |
| 258 / 280 | `true` | 仍 `fatal: '$GIT_DIR' too big` |

OS `LongPathsEnabled=1` **不能**让 git worktree 越过 git 自己的 `GIT_DIR` 长度上限。失败前 Git 可能已经创建了 branch（`Preparing worktree (new branch 'run-g-240')`），需要 `prune` / 删 branch，避免 refs 泄漏。

**大小写：** `exists(readme.md)=true` 且与 `README.md` 同一 realpath；写入 `readme.md` 覆盖了 `README.md` 内容为 `lowercase-name-write`。`core.ignoreCase=true`。

**junction：** `fs.symlinkSync(..., 'junction')` 成功、无需管理员。junction 内能列出 `main-repo`、`outside-secret.txt` 等，`escapedOutsideFile=true`。

**symlink：** 文件与目录 symlink 均为 `EPERM: operation not permitted`。本机不是 symlink 逃逸的主路径；**junction 才是**。

**Limits**

T06 工作区路径必须短（建议整条 `worktree` 路径 < 200 字符，含 `.git` 后缀余量）。对每个写入路径做 `realpath` / `lstat`，junction 逃出 WorkspaceBinding 则拒绝。Windows 上比较路径要大小写折叠 + 盘符折叠。

---

## H. Dirty submodule

**Expected / Actual：** 跳过（过重）。分类：**untested**。T06 若支持 submodule，需另开 spike：脏 submodule + 多 worktree 会共享 submodule gitdir。

---

## Cleanup

`run.mjs` 结束时 `taskkill` 持锁子进程 → `worktree remove --force` 仍登记的 worktree → `worktree prune -v` → `fs.rmSync(tmpRoot)`。本次：`rmrf tmpRoot ok=true`，沙箱无残留。`--keep` 可留下 `.tmp/git-worktree/` 供人工检查。`.tmp/` 已被 `tooling/spikes/.tmp/.gitignore` 忽略。

---

## Recommendations

### T06（Workspace / Git / 进程）

1. **每个 Run 独立 worktree + 显式新 branch**（如 `workforce/run/<runId>`）。不要写用户脏主区；不要省略 `-b`；不要 `worktree add --force` 签出已被占用的 branch。
2. **Provision 记录：** worktree 绝对路径、`.git` gitdir 路径、`.git/worktrees/<name>/` metadata 名、branch、baseline SHA、`core.ignoreCase`。路径归一化（`/` vs `\`、盘符大小写）。
3. **路径预算：** 工作区根要浅。不要按仓库内部深层目录再套多层 `runs/.../agent/...`。不要把 `LongPathsEnabled` 或 `core.longpaths=true` 当成可移植能力。
4. **越界：** `realpath`/`lstat` 拒绝指向绑定目录外的 junction/symlink。管理员 junction 与普通用户 junction 在本机都能建，不能用「需要 admin」当防护。
5. **并发：** 两个 Run 绝不共享可写 checkout。同文件相对路径可以各自改，整合交给 T14 的独立 integration worktree。
6. **生命周期锁：** Artifact 未持久化前 `git worktree lock --reason artifact-pending:<artifactId>`。这是 git 层 hold，比 OS 锁可靠。
7. **清理顺序（T06 DoD）：**
   1. 杀 Run 进程树（cwd 在 worktree 内的进程会 `Permission denied`）。
   2. 确认 required Artifact 已由 T08 落盘；未落盘则 **keep workspace**，不要 remove。
   3. `git worktree unlock` 再 `git worktree remove --force`。
   4. 若 `exit!=0`：检查目录是否还在、list 是否已注销。已注销但目录在 → 孤儿目录，进程杀净后 `fs.rm` + `prune`。
   5. 失败重试 `prune`；不得把 255/`Permission denied`/`Invalid argument` 报成已清理。
   6. 禁止默认 `remove -f -f`（会无视 lock）。
8. **Windows 大小写：** 冲突检测按大小写不敏感比对；不要假设 `Foo` 与 `foo` 是两个文件。
9. 空格路径可用，但所有 git 调用走 argv 数组。

### T14（integration worktree）

1. 整合用**第三个** worktree，从冻结的 baseline SHA 创建独立 branch（`workforce/integration/<taskId>`），不要在 Developer A/B 的 Run worktree 里 merge。
2. 按稳定 Node ID 顺序把 patch/commit 应用到 integration worktree；冲突停下来人工处理。
3. 两个分别测过的 diff ≠ 合并后项目通过（D10）。测试/Reviewer/审批绑定整合后的同一 content digest。
4. 不要让 integration branch 同时被另一个 live Run checkout；需要时 `--detach` 或新 branch，不用 `--force` 抢 branch。
5. 整合失败保留 integration worktree（同样 lock 到 Artifact 落盘），不要立刻 prune。

### T08（Artifact）

1. required Artifact 未持久化 → T06 不得 unlock/remove（T06 验收：required Artifact 未持久化不得清理）。
2. 采集工作区内容前先确认无写入进程（cwd 占用会导致读/删失败；`FileShare.None` 会导致 `Permission denied`）。
3. remove 失败时残留目录可能是输出的**唯一副本**，先做成 Artifact 再删。
4. 建议 Artifact 元数据带：`worktreePath`、`gitdir`、`branch`、`baselineSha`、`headSha`、changed paths。`gitdir` 供 T06 `repair`。

### T05 / 其他

Mock Host 通过 T06 申请 worktree，不要自己 `git worktree add` 到用户仓库。本 spike **无契约变更请求**；现有「每 Run 独立 worktree / 不污染脏主区」与证据一致。

---

## 未测

- macOS / Linux 的 worktree 删除、文件锁、大小写敏感卷、symlink。
- 脏 submodule + 多 worktree。
- `core.longpaths` 在 `LongPathsEnabled=0` 的机器上（本机为 1 仍受 `$GIT_DIR` 上限限制）。
- 开启 Developer Mode 后的 symlink 逃逸。
- `git worktree move`（本 spike 用 rename + `repair` 模拟崩溃搬迁）。
