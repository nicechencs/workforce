---
title: 升级、备份与恢复
type: operations
status: current
owner: t17
updated: 2026-09-12
---

# 升级、备份与恢复

本页描述安装包升级前的活动 Run 策略，以及 Daemon 状态目录的备份/恢复。实现在 `apps/desktop/src/main/updater/` 与 `tooling/release/backup.mjs`。策略与 T11 冻结的 updater handoff 一致：**有非终态 Run 则 `reject`，不热替换 Daemon**。

打包本身见 [三平台打包与随包 Daemon](packaging.md)。

## 升级前活动 Run 策略

`decideDaemonUpgrade` 只返回 `allow` 或 `reject`。`drain` 仍在类型里，但未实现；`prepareDaemonUpgrade` 遇到 `drain` 会失败。

非终态 Run：`pending`、`starting`、`running`、`waiting_input`、`paused`，以及任何未知 status。终态：`succeeded`、`failed`、`timed_out`、`cancelled`。

探测顺序：

1. 读 `daemon.json`；无进程或 pid 已死 → 视为没有活动 Run，允许备份后替换。
2. Daemon 仍活着时，用 bootstrap 换 session，分页 `GET /api/v1/runs`。
3. 读失败、无 session、或 HTTP 失败 → **fail-closed**，视为存在活动 Run，`reject`。
4. 只有 `allow` 才会写备份。

不要在活动 Daemon 可执行文件上就地覆盖。本切片不提供已发布的自动更新通道。

## 状态目录

默认与 Desktop supervisor 相同：

| 平台 | 目录 |
| --- | --- |
| Windows | `%APPDATA%\Workforce` |
| macOS | `~/Library/Application Support/Workforce` |
| Linux | `${XDG_CONFIG_HOME:-$HOME/.config}/workforce` |

`WORKFORCE_STATE_DIR` 覆盖上述路径。备份包含 `workforce.sqlite` 及其 `-wal` / `-shm` / `-journal` sidecar、`world.json`、`host-store.json`、artifacts 与 worktree 等文件。跳过 `daemon.lock.sock`、`backups/` 自身，以及 Electron 的 `Cache` / `Code Cache` / `GPUCache`。

`bootstrap.json` 会进备份。备份目录按敏感本地数据处理，不得提交、不得打进公开 Artifact。

## 命令

```text
node tooling/release/backup.mjs backup [--state-dir DIR] [--out DIR]
node tooling/release/backup.mjs restore --from DIR [--state-dir DIR]
```

升级路径应先 `prepareDaemonUpgrade`（内部先探测再备份）。失败后用 `rollbackUpgradeBackup` 或 CLI `restore` 覆盖回状态目录，再启动 Desktop。

SQLite 在 Daemon 仍打开时以文件复制 sidecar，不是 `node:sqlite` backup API（那条 API 在 T04 库内、且要求打开同一连接）。升级被 `reject` 时根本不应停 Daemon。

## 未宣称完成

- 没有已配置的更新服务器或差分补丁通道。
- 没有 T16 current-M3 schema upgrade fixture；本页的备份/恢复是文件级状态目录，不是 migration 验收。
- 未在三平台实测「升级失败后恢复」之前，不得写成发布完成。
