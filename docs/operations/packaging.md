---
title: 三平台打包与随包 Daemon
type: operations
status: current
owner: t17
updated: 2026-09-12
---

# 三平台打包与随包 Daemon

本页说明如何从仓库打出 Windows / macOS / Linux 的 **未发布** 解压包，以及 Daemon 如何随包分发。它不是发布授权，也不把 `start.cmd`、`start.sh` 或 `pnpm --filter @workforce/desktop dev` 当成安装包。

升级前活动 Run 策略、备份与卸载保留见 [升级、备份与恢复](upgrade-backup-restore.md) 和 [卸载与数据保留](uninstall-data-retention.md)。

## 范围

- 打包入口：`node tooling/release/pack.mjs`（`pnpm --filter @workforce/desktop pack` 相同）。
- 目标：`win32`、`darwin`、`linux` 的 Electron 解压树 + 压缩包。
- 随包 Daemon：`resources/daemon/dist/index.js`，供现有 `resolveDaemonEntry` 以 `../daemon/dist/index.js` 找到。
- 签名：只在对应平台凭据存在时尝试；缺凭据则跳过。产物标记 `published: false`。
- `electron-builder` **不在** 根 lockfile。`apps/desktop/electron-builder.yml` 是给 T01 日后加入工具后的声明配置；当前 packer 不调用它。

## 不是安装包

| 命令 | 是什么 |
| --- | --- |
| `start.cmd` / `start.sh` / `node tooling/scripts/start-desktop.mjs` | 源码树一键开发启动 |
| `pnpm --filter @workforce/desktop dev` | 开发窗口 + 源码/dist Daemon |
| `pnpm --filter @workforce/desktop start` | 本地 `dist` + 本机 Electron |
| `node tooling/release/pack.mjs` | 解压分发包（仍未发布） |

## 产出布局

```text
out/pack/
├── stage/app/                 # Desktop 生产文件（packaged electron-main 不注册 TS loader）
├── stage/daemon/              # pnpm deploy 的 Daemon + node_modules
├── unpacked/<platform>-<arch>/
│   ├── Workforce.exe | workforce | Workforce.app
│   ├── resources/app/         # Desktop
│   ├── resources/daemon/     # 随包 Daemon
│   ├── resources/packaging.json
│   └── UNINSTALL.txt
├── artifacts/                 # zip 或 tar.gz
└── summary.json
```

`packaging.json` 始终含 `published: false`、`bundledDaemon: true`、`upgradeActiveRunPolicy: "reject"`。`signed` 仅在签名挂钩实际成功时为 true。

Daemon 的 `--import` 仍指向 `{electronRoot}/tooling/scripts/register-ts-esm.mjs`（与 T11 `resolveWorkspaceTsEsmRegisterUrl` 相对 `appRoot` 的 `../..` 一致）。打包器会复制这两份脚本，避免 packaged spawn 因缺少 hook 直接失败。

## 命令

在仓库根目录：

```text
node tooling/release/pack.mjs --platform current
node tooling/release/pack.mjs --platform linux,win32,darwin --skip-sign
```

`--skip-build` 要求 `apps/desktop/dist` 与 `apps/daemon/dist` 已存在。

跨平台包会按 `apps/desktop` 的 Electron 版本下载官方 zip，并用 `SHASUMS256.txt` 校验。当前平台优先复用 `node_modules/electron/dist`。`pnpm deploy` 先写到临时目录再拷进 `out/pack`：直接 deploy 到仓库内名为 `out/...` 的路径会触发 pnpm `mkdir '/out'`。

## 签名挂钩

凭据只读环境变量**名**是否存在，不把密码、PFX 或 API key 写入日志或 `packaging.json`。

| 平台 | 尝试签名的条件 | 缺省 |
| --- | --- | --- |
| Windows | `signtool` + `WINDOWS_PFX_FILE` / `CSC_LINK` / `WINDOWS_CERTIFICATE_FILE` | skip |
| macOS | `codesign` + `APPLE_IDENTITY` / `CSC_NAME` | skip |
| Linux | 无挂钩 | skip |

签名失败时解压包仍保留，标记 `signing: failed`，不得写成已公证或已上架。

## 已知限制

- 本切片产出解压树，不是已公证的 DMG / 已签名 NSIS / AppImage 商店包。
- 未跑 T16 三平台安装 smoke，不能宣称 Alpha 发布完成。
- 根 lockfile 未加入 `electron-builder`；需要安装器格式时由 T01 加入依赖后再用 yml。
- 真实发布、上传 Release、改默认分支不在本页授权范围内。
