---
title: 卸载与数据保留
type: operations
status: current
owner: t17
updated: 2026-09-12
---

# 卸载与数据保留

卸载应用目录不得删除 Daemon 状态。用户数据、SQLite、Artifacts 与升级备份留在状态目录，直到用户显式删除。开发启动器 `start.cmd` / `dev` 不是安装包，也没有卸载程序。

打包布局见 [三平台打包与随包 Daemon](packaging.md)。状态目录路径见 [升级、备份与恢复](upgrade-backup-restore.md)。

## 保留什么

| 平台 | 卸载时删除 | 默认保留 |
| --- | --- | --- |
| Windows | 解压出的应用目录、开始菜单快捷方式（若有） | `%APPDATA%\Workforce` |
| macOS | `Workforce.app`（拖到废纸篓） | `~/Library/Application Support/Workforce` |
| Linux | 解压目录 | `${XDG_CONFIG_HOME:-$HOME/.config}/workforce` |

`electron-builder` NSIS 配置（尚未进 lockfile）使用 `deleteAppDataOnUninstall: false`，并包含 `tooling/release/nsis/uninstall-retain-data.nsh`。当前 packer 在每个解压树写入 `UNINSTALL.txt`，Windows 另有 `Uninstall.ps1`，Linux 有 `uninstall.sh`。这些脚本只说明如何删应用目录，不删状态目录。

## 用户要清数据时

手动删除状态目录。会一并去掉 `workforce.sqlite`、sidecar、`artifacts/`、`backups/` 和 bootstrap。没有回收站保证。有升级备份时，先把 `backups/` 拷走再删。

## 已知限制

- 没有 Windows 程序和功能条目，除非日后 T01 装上 electron-builder 并授权打 NSIS。
- 没有 macOS 公证卸载收据。
- 未做三平台卸载实测；本页描述的是打包器写入的保留策略，不是 T16 证据。
