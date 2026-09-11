---
title: 产品沟通历史
type: decision
status: current
owner: maintainers
updated: 2026-09-12
---

# 产品沟通历史

日期：2026-09-12  
时区：**Asia/Taipei**  
状态：现行、只追加  
权威：本文记录驱动规划文档的**用户产品决定**与 PM 澄清。已冻结规则仍以 [decision-register.md](decision-register.md) 为准；实现真相以 [03-implementation-status.md](03-implementation-status.md) 为准。本文不发明 API，也不把 planned 写成已实现。

## 用途

这是一份**只追加**的产品沟通与决策日志。每次更新产品或规划文档（决策登记、能力矩阵、任务清单、实现进度、Product UI、本文件自身的规则）时，必须在本文追加一条注明日期（Asia/Taipei）的条目，写清：

1. **决定** — 用户拍板或 PM 澄清的实质（不是聊天原文堆砌）
2. **文档影响** — 写进了哪一页、哪一条决策/任务
3. **状态** — `planned`（已冻结、未实现）或 `implemented`（源码与测试可确认）

禁止：删改旧条目的结论；用本文件覆盖决策登记；把 Mock / 未跑 Runtime 标成 `implemented`。

## 条目格式

```text
## YYYY-MM-DD（Asia/Taipei）<短标题>

- 决定：…
- 文档影响：…
- 状态：planned | implemented
```

同一自然日可有多条；后写的条目不得假装改写先写的决定，只能追加澄清。

---

## 2026-09-11（Asia/Taipei）项目制主对象；画布与自定义 Team 升为 M7

- **决定：** 产品是**项目制**。主对象是 Project，不是独立团队工作室，也不是脱离项目的通用工作流 IDE。围着一个项目，用户必须能编排 Team、编排 Tasks、编排 Workflow。可视化画布与自定义 Team 是这条主循环的必达环节，不是调研项、外挂目录或「以后再说的 nicety」。M3 Mock 仍可用预设 Team + 只读已发布工作流走完闭环——那是切片深度，不是产品模型。
- **文档影响：** [decision-register.md](decision-register.md) §0、D15、D16、§8；[api-capability-matrix.md](api-capability-matrix.md) 将画布/自定义 Team 从 `later` 迁到 **M7**；[02-development-task-backlog.md](02-development-task-backlog.md) 增加 T18/T19；[03-implementation-status.md](03-implementation-status.md) 写明可写面未实现；[01-information-architecture.md](../product-ui/01-information-architecture.md) / [02-core-user-flows.md](../product-ui/02-core-user-flows.md) 按项目制改主循环。只读 `GET /workflows` 是已接通的 M3/P1 过渡目录，不是画布完成。
- **状态：** 决策与文档 **planned 已冻结**。画布写接口、自定义 Team 写接口 **未实现**（T18/T19）。M3 只读目录（含 Desktop IPC allowlist 放行 `GET /workflows`，见 #18）是已验证切片，不等于 M7 完成。

---

## 2026-09-11（Asia/Taipei）工作流必须高度可定制；对话生成；生成后可编辑；按 Agent 双执行模式；规划更新必须回写本历史

- **决定：**
  1. **工作流必须高度可定制。** 这是产品必达，不是后期 nicety，也不是「画布做完再看要不要灵活」。定制面仍围着 Project，不做通用 iPaaS。
  2. **对话式 Agent 编排是一等作者路径。** 用户用自然语言与 Agent 对话来**生成**工作流定义，例如：创建 bot1（角色）、bot2、bot3；跑流程 X；某个 bot 负责任务 Y。Agent 理解意图后生成 Team 角色、Tasks 与 Workflow 草稿，而不是只给一份不可改的夹具。
  3. **生成结果必须可编辑。** 对话产出的是草稿 `WorkflowDefinition` / 未发布 `WorkflowVersion`（及可一并生成的 Team/Task 草稿）。用户随后在既有 D15 画布或结构化编辑面上改节点、边、角色与任务，再按 D02 发布不可变版本。对话生成不能绕过发布校验，也不能让未发布图被 Runtime 执行。
  4. **每个 bot/Agent 的执行模式是一等能力。** 该 Agent 做事时可以：**跟随已发布工作流**（workflow-bound），或**直接执行**（direct / ad-hoc，不走该次已发布图）。两种模式都必须在 UI 与 API 诚实出现：靠 capability probe 显隐；无能力则禁用或启动前拒绝；禁止假 mode、假成功按钮或把「看起来像直接跑」写成已支持。
  5. **必须有一份可追溯的产品沟通历史。** 即本文件。此后每一次产品/规划文档更新都要在此追加当日条目，使决定 → 文档 → 实现状态可追踪。
- **文档影响：**
  - 本文件新建，作为只追加日志。
  - [decision-register.md](decision-register.md) 冻结 **D17**（对话式编排生成工作流）与 **D18**（绑定已发布工作流 vs 直接执行）；§0 写明高度可定制是项目制循环上的产品要求。里程碑：D17 **扩展 M7**（与画布同一作者环）；D18 列入 **M8**（执行面，不并进 M3/M6）。均标注 **未实现**，不发明 chat/mode endpoint。
  - [api-capability-matrix.md](api-capability-matrix.md) 增加 M7–M8 **planned** 行；对话会话协议与执行 mode 字段待 T02 冻结后才列 path。
  - [01-information-architecture.md](../product-ui/01-information-architecture.md) / [02-core-user-flows.md](../product-ui/02-core-user-flows.md) 补：对话生成 → 编辑草稿 → 按 Agent 选择绑定工作流或直接执行。
  - [02-development-task-backlog.md](02-development-task-backlog.md) 增加 **T20**（对话式编排）、**T21**（双执行模式）及 M8。
  - [03-implementation-status.md](03-implementation-status.md) 只记规划，不宣称对话生成或双执行已完成；保留 #16/#17/#18 已验证结论。
  - [04-collab-and-review.md](04-collab-and-review.md) 将 T20/T21 列入禁止塞进随机 PR 的后置项。
  - [docs/README.md](../README.md)、[AGENTS.md](../../AGENTS.md) 增加本文件入口；规划文档变更须回写本历史。
- **状态：** 全部 **planned**。当前代码仍是 M3 目录/只读 + M7 画布/自定义 Team **已规划未实现**。对话生成、生成后画布编辑、按 Agent 直接执行均 **未实现**。

---

## 2026-09-11（Asia/Taipei）M7 写 API + 协议切片（非画布 / 非 M7 完成）

- **决定：** 按 D15/D16 与能力矩阵补齐 Workflow / Team 的写契约与 Daemon 写路由，让后续画布（T18）与可写 Team UI（T19）有同一套 protocol，而不是第二套图协议。不发明 chat 或 `executionMode` endpoint（D17/D18 仍 planned）。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 只把写 API / protocol / SQLite catalog 记为已验证；T18/T19 UI 仍未实现。协议索引增加 `team.schema.json`，并扩展 `workflow-catalog.schema.json` 的 draft + nodes/edges。
- **状态：** 写 API + 协议 **implemented**（本切片）。画布、可写 Team UI、对话生成、双执行模式 **planned**。M7 **未完成**。

---

## 2026-09-11（Asia/Taipei）本机为默认执行位置；远程连接为一等产品能力

- **决定：** 产品支持在用户**本机**工作，也支持经**远程连接**工作。**默认是本机**（本机 Workspace / Local Node）。远程不是「以后再说的 nicety」，也不是把 UI 假设永远锁在客户端所在电脑；它与本机共用 ExecutionNode 抽象。V0.1 实现深度不变：只做单用户 Local Node；远程 enrollment / heartbeat / 服务器 lease 仍是版本化契约 + Mock，不建服务器控制面，不发明矩阵未列的 enrollment endpoint，UI 不得伪造在线远程节点。
- **文档影响：** [decision-register.md](decision-register.md) 冻结表、D07（默认 `local_only`、与 transport / D18 正交）与 **D19**（Placement kind `local`）；[01-information-architecture.md](../product-ui/01-information-architecture.md)、[02-core-user-flows.md](../product-ui/02-core-user-flows.md)、[03-p0-wireframes.md](../product-ui/03-p0-wireframes.md) 写明缺省本机、远程诚实显隐；[api-capability-matrix.md](api-capability-matrix.md) 只改注释，不增加 path；[03-implementation-status.md](03-implementation-status.md) 保持「远程未实现」；PRD §14 / 领域模型 §10 / Runtime §18 与 ADR 0001 对齐，不以蓝图覆盖 D19。
- **状态：** 产品模型 **planned 已冻结**。本机 Local Node **已实现**（只读诊断 + worktree）。远程执行 **未实现**（契约/Mock）。

---

## 2026-09-11（Asia/Taipei）容器为一等执行 Placement

- **决定：** 产品必须支持在**容器**中工作。容器是与本机、远程并列的 Placement kind（`container`），不是 D10 worktree 隔离的别名，也不是 `transport`，也不是把 core-user-flows「独立 worktree/目录/容器」一语当成已落地 runner。容器 Run 仍绑定某个 ExecutionNode（本机或远程宿主机）上的 WorkspaceInstance；`container` 不是第四种机器类型。
- **文档影响：** [decision-register.md](decision-register.md) **D19** 冻结 `container`；D07 / D10 写明与 isolation、enrollment、控制面的边界；IA §4.7、核心流程 §2/§3、能力矩阵 later 表与实现进度写明 runner **未实现**，不发明 Docker / K8s / 编排 endpoint。本条不领取画布 UI / 可写 Team UI，不改 Daemon。M7 写 API + 协议已由 #23 接通，本条不回退该结论，也不把写接口写成画布或 M7 完成。
- **状态：** 产品模型 **planned 已冻结**。容器 runner / 编排 **未实现**。不得写成已完成。

---

## 2026-09-12（Asia/Taipei）T18 画布接线：草稿保存走 #23 写 API

- **决定：** 合前验收要求 create + edit + **save** 必须过。画布不得再因 typed client 写 path 未挂载而禁用保存，也不得假成功 toast。保存必须真实 POST/PATCH 未发布 version；reload 后仍能看到同名草稿与 nodes/edges。发布走 `publishWorkflowVersion`；非法图/空图诚实失败。依赖已合并的写契约（PR #23 / `cursor/m7-write-contracts-f059`），不另开 PR。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 将 T18 改为「画布 UI 已接线且草稿保存走写 API（依赖 #23）」；明确 headed 真窗 `WORKFORCE-PR22-62b1e620-CANVAS-TRUEWINDOW` 尚未复验通过。去掉「保存因 client 未挂载而禁用」。
- **状态：** 画布 UI + 草稿写路径 **implemented**（headless / Electron proxy）。headed 真窗 **planned**（待复测）。T19/T20/T21 与 M7 整体仍 **planned**。远程 enrollment 与容器 runner 仍 **未实现**（D19）。

---

## 2026-09-12（Asia/Taipei）T18 rebase 到 #23 squash tip

- **决定：** #23 写 API 已 squash 合入 `main` `15c058f`。T18（#22）不再叠 squash 前的写 API commit，只保留画布 UI + desktop write-client 接线。不发明 chat / `executionMode` / enrollment endpoint。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 写明 T18 画布已接线且草稿保存走已合入的写 API；M7 未完成；T19/T20/T21 仍未实现；headed 真窗待复测。
- **状态：** T18 画布接线 **implemented**（headless / proxy）。headed 真窗 **planned**。M7 / T19 / T20 / T21 **planned**。

---

## 2026-09-12（Asia/Taipei）T18 rebase 到 #20 D19 squash tip

- **决定：** #20（D19 Placement：本机默认 / 远程 / 容器）已 squash 合入 `main` `c1c86ef`。T18 叠在该 tip 上，保留 D19 产品模型与「远程 enrollment / 容器 runner 未实现」；保留画布 UI + 草稿保存接线。不发明 enrollment / Docker / 编排 endpoint，不宣称 M7 完成。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 同时保留 D19 实现深度与 T18 已接线（headed 未宣称 PASS）。
- **状态：** T18 **implemented**（headless / proxy）。headed **planned**。D19 远程/容器 **planned**。M7 **未完成**。

---

## 2026-09-12（Asia/Taipei）T18 headed 真窗 create/edit/save/publish PASS

- **决定：** Review 有条件通过 #22。Test 报告 `WORKFORCE-PR22-fbe13dea-CANVAS-RETEST.md` 将 headed Electron 真窗 create/edit/save/publish 记为 **PASS**。验证 head 为 `fbe13dea`；之后 rebase 到 `c1c86ef` 的 tip（`3d0bd971`）只是文档/小清理，行为未回退。不因此宣称 M7 完成，也不宣称 T19 / T20 / T21、远程 enrollment 或容器 runner 已完成。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 将 T18 headed 从「未复验 / 待复测」改为 **PASS**，并写清验证 head 与 tip 关系。
- **状态：** T18 画布 UI + 草稿保存 + headed 真窗 create/edit/save/publish **implemented**。M7 / T19 / T20 / T21 / D19 远程与容器仍 **planned**。

---

## 2026-09-11（Asia/Taipei）T19 桌面自定义 Team 写面挂上 #23 写 API

- **决定：** 兑现 D16 的桌面写面，并把 `createTeam` / `patchTeam` / `createTeamVersion` / `patchTeamVersion` 挂到同一 typed client：草稿保存必须真实持久化，reload 后仍在（`GET /teams/{id}`，因 `listTeams` 只含已发布）。Publish / 自定义绑定仅在写 API 与规则允许时启用，**无假 publish/bind**。预设 Software Development Team 保留。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T19 / 目标段：UI + 草稿写 API 已接线；publish 状态诚实。
- **状态：** 桌面写面 + 草稿写 API **implemented**。Publish/bind 按规则诚实。M7 **未完成**。

---

## 2026-09-12（Asia/Taipei）#21 rebase 到 #23 squash tip `15c058f`

- **决定：** #23 已 squash 合入 `main`（`15c058f`）。#21 丢掉叠在旧 #23 上的写 API 提交，只保留 T19 Team 写面 UI 与 `GET /teams/{id}` 草稿持久化。不发明 chat / `executionMode` / enrollment endpoint。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 写明写契约已在 main；T19 是可写 Team UI；M7 未完成；T20 / T21 不由本 PR 宣称完成。
- **状态：** T19 UI **implemented**（本 PR）。M7 **未完成**。

---

## 2026-09-12（Asia/Taipei）T19 草稿 reload：list 只含 published，改走 status=draft

- **决定：** 真窗 FAIL（`dc509c1`）根因是 #23 约定 `GET /teams` 只回 published。create/patch 已写库；save 后内存列表有草稿，Ctrl+R 后默认 list 丢草稿。不改默认 list（绑定/探活仍只见 published）。UI 用已有 `ListQuery.status`：`GET /teams?status=draft` 拉草稿，详情仍 `GET /teams/{id}`。无假 publish/bind，不塞假 RuntimeProfile。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T19：草稿持久化已修。
- **状态：** 草稿 list/reload **implemented**。M7 **未完成**。

---

## 2026-09-12（Asia/Taipei）#21 rebase 到 D19 tip `c1c86ef` 并修 lint

- **决定：** #20 已 squash 合入 `main`（`c1c86ef`，D19 placement：本机默认 + 远程 + 容器）。#21 rebase 到该 tip：保留 main 的 D19 诚实表述（远程/容器 **未实现**）；保留 T19 写面与 `GET /teams?status=draft` reload。修 eslint `no-useless-assignment`（`loadTeamCatalog` 的 `drafts`）。不发明 endpoint，不宣称 M7 / T20 / T21 完成。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 同时保留 D19 与 T19。
- **状态：** lint 修复 + rebase **implemented**。M7 **未完成**。

---

## 2026-09-12（Asia/Taipei）T19 headed 真窗草稿持久化 PASS

- **决定：** Test-bot 在 `406ee6d2` 复测 save→reload：草稿仍在（`WORKFORCE-PR21-406ee6d2-DRAFT-PERSIST-RETEST.md`）。只把这一条 headed 路径记为 **PASS**。不把完整 headed 套件、publish 真窗或 M7 / T20 / T21 写成完成。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T19 / 修订段 / 剩余工作第 5 条：headed 草稿持久化 PASS（验证 head `406ee6d2`）。
- **状态：** T19 草稿持久化 headed **implemented**（已复验）。M7 **未完成**。

---

## 2026-09-12（Asia/Taipei）#21 rebase 到 T18 tip `6eeea107`

- **决定：** #22（T18 画布）已 squash 合入 `main`（`6eeea107`）。#21 rebase 到该 tip：同时保留 T18（画布接线 + headed create/edit/save/publish PASS）与 T19（Team 写面 + `GET /teams?status=draft` reload + headed 草稿持久化 PASS）。不改默认 `GET /teams`（仍只回 published）。无假 publish/bind。不发明 endpoint。不宣称 M7 / T20 / T21 完成，也不宣称远程 enrollment / 容器 runner 已实现。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 同时保留 T18 与 T19；T20 / T21 / D19 远程与容器仍未实现。
- **状态：** T18 **implemented**（main）。T19 **implemented**（本 PR）。M7 **未完成**。

---

## 2026-09-12（Asia/Taipei）T20 rebase 到 T18 squash tip（#22 / `6eeea107`）

- **决定：** #22 画布已 squash 合入 `main` `6eeea107`。T20 只做诚实作者面壳 + 结构化写 API 落草稿，叠在该 tip 上：保留 T18 画布入口与 headed PASS 结论；「对话生成」发送仍禁用（`CHAT_SESSION_PROTOCOL_FROZEN=false`）；有结构化名称才 `POST /workflows` 写未发布草稿，并深链已存在的 T18 画布路由。不发明 chat / enrollment / Docker / `executionMode` endpoint。D19 远程/容器仍未实现。不宣称 M7 完成。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 同时保留 T18 headed PASS 与 T20 UI shell；会话协议仍 planned。
- **状态：** T18 **implemented**（含 headed PASS）。T20 UI shell + 写 API 落草稿 **implemented**（happy-dom / unit，非 headed 对话）。会话协议、编排 Agent、T21、M7、D19 远程/容器 **planned**。当时 T19 尚未进 main。

---

## 2026-09-12（Asia/Taipei）T20 rebase 到 T19 squash tip（#21 / `0e2a156`）

- **决定：** #21（T19 自定义 Team 写面 + 草稿 persist）已 squash 合入 `main` `0e2a156`（父提交为 T18 `6eeea107`）。同一 PR #24 继续 rebase 到该 tip：T18+T19 视为已在 main 实现（含各自 headed PASS 报告）；T20 仍只是作者面 UI 壳 + 已有 M7 write API 落未发布草稿。会话发送仍禁用（`CHAT_SESSION_PROTOCOL_FROZEN=false`）。不发明 chat / enrollment / Docker / `executionMode` endpoint。不宣称 M7 / T21 / 对话编排完成，也不宣称 D19 远程/容器已实现。Test-bot 作者面壳 headed PASS 仅引用 `7f85c503` / `WORKFORCE-PR24-7f85c503-AUTHORING-SHELL.md`，不代替完整 headed 套件。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md)、[02-development-task-backlog.md](02-development-task-backlog.md)、[api-capability-matrix.md](api-capability-matrix.md)、[04-collab-and-review.md](04-collab-and-review.md) 去掉「T19 未实现 / 未领取」的现行概括；T20 保持 UI shell + write-API 草稿。
- **状态：** T18 **implemented**（main）。T19 **implemented**（main）。T20 UI shell + 写 API 落草稿 **implemented**（叠 T19 tip）。会话协议、编排 Agent、T21、M7、D19 远程/容器 **planned**。

---

## 2026-09-12（Asia/Taipei）冻结 D18 `orchestrationMode`（非 T21 UI）

- **决定：** 把 D18 双执行模式的可审计字段冻结为 **`orchestrationMode`**：`workflow_bound | direct`。权威位置是 `packages/protocol` 的 `StartRunRequest`。省略则默认 `workflow_bound`，与现有 M3 Mock / 夹具行为一致。未知值拒绝。旧名 `executionMode` 不是本字段，也不得表示 D19 Placement。**不发明** `/runs/{id}:direct` 或其它新 Run path。本切片不实现 T21 UI、假 mode 按钮、Daemon 新路由，也不宣称生产 Codex 已支持 direct。`StartRunHostRequest` 无扩展点，故不改 composition/daemon。
- **文档影响：** [decision-register.md](decision-register.md) D08/D18 写明字段已冻结；[api-capability-matrix.md](api-capability-matrix.md) M8 planned 行命名该字段且不增 path；[03-implementation-status.md](03-implementation-status.md) T02/T21 诚实记录（字段冻结；T21 UI 未实现；M8 未完成）；[02-development-task-backlog.md](02-development-task-backlog.md) T21 字段依赖已满足；[04-collab-and-review.md](04-collab-and-review.md) 仍禁止随机 PR 塞假 mode 按钮；[docs/protocols](../protocols/README.md) 增加 `orchestration-mode.schema.json`。
- **状态：** protocol 字段 **implemented**。T21 UI / M8 调度与生产 Codex direct **planned**。

---

## 2026-09-12（Asia/Taipei）#25 rebase 到 T20 tip `edce1a4`

- **决定：** #24（T20 作者面壳）已 squash 合入 `main` `edce1a4`。#25 rebase 到该 tip：同时保留 T20 UI shell + M7 写 API 落未发布草稿（chat 禁用至 session DTO）与 D18 `orchestrationMode` 协议冻结。作者面壳 headed 复测 **PASS**（`66a9c284` / `WORKFORCE-PR24-66a9c284-AUTHORING-SHELL-RETEST.md`）。不发明 `/runs/{id}:direct` 或 chat path。不宣称对话生成、T21 UI、M8 或生产 Codex direct。D19 远程 enrollment / 容器 runner 仍 **未实现**。
- **文档影响：** 冲突页（实现进度、任务清单、能力矩阵、协作评审、本历史）同时保留 T20 现行状态与 `orchestrationMode` 冻结表述。
- **状态：** T20 UI shell **implemented**（main）。`orchestrationMode` 字段 **implemented**。会话协议 / 对话生成 / T21 UI / M8 / D19 runner **planned**。

---

## 2026-09-12（Asia/Taipei）T21 双执行模式 UI 切片（非 M8 完成）

- **决定：** 在 main tip（含 #25 `b700010` `orchestrationMode` 冻结）上做 T21 Desktop UI 切片：项目详情与 Task 详情展示 `orchestrationMode` 选择面；`GET /capabilities` / Runtime probe 未声明 `orchestration.direct` 时禁用 direct；选择写入现有 `POST /projects/{id}:start`（省略仍默认 `workflow_bound`）。无能力组合返回冻结错误 `unsupported_capability`。**不发明** `/runs/{id}:direct`、chat、enrollment 或容器 path。不改 T18 画布文件或 T19 Team 写面。不宣称 M8 调度完成、headed PASS 或生产 Codex direct。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T21 行改为 UI 切片已接线；[api-capability-matrix.md](api-capability-matrix.md) M8 行记录字段+UI 进度且不增 path；[02-development-task-backlog.md](02-development-task-backlog.md) / [04-collab-and-review.md](04-collab-and-review.md) 去掉「T21 UI 未实现」的现行概括。
- **状态：** T21 UI 切片 **implemented**（happy-dom；headed 未跑）。M8 调度 / 生产 Codex direct / D19 runner / 会话协议 **planned**。

---

## 2026-09-12（Asia/Taipei）T21 去掉 Task 详情未接线 mode 控件

- **决定：** PM UI P1 打回 #26：Task 详情上的 `orchestrationMode` 控件未接到 start 命令，属于假按钮风险。同 PR 删除该挂载，只保留已接到 `POST /projects/{id}:start` 的项目「开始执行」面。不发明 `/runs/{id}:direct`，不宣称 M8 / Codex direct / headed。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T21 行改为「项目启动面部分接线；Task 详情不挂未接线控件」。
- **状态：** T21 UI **部分接线**（项目 `:start`）。Task 详情无 mode 控件。M8 **planned**。

---

## 2026-09-12（Asia/Taipei）冻结 D17 会话 / 草稿 DTO（非 T20 发送、非 M7）

- **决定：** 把 D17 对话式作者会话与未发布草稿投影冻结为 **`AuthoringSessionDto`** / **`AuthoringDraftDto`**（及 user-only `AppendAuthoringSessionMessageInput`）。权威位置是 `packages/protocol`；JSON Schema 为 `docs/protocols/v0.1/authoring-session.schema.json`。草稿复用已有 Workflow / Team 写 payload，禁止 `published`、`executionMode`、`orchestrationMode`、Run/Task 完成字段。desktop-client **只导出类型**，不增加 chat HTTP path 或 client 方法。T20 可编译对照该 DTO，但 **`CHAT_SESSION_PROTOCOL_FROZEN` 仍为 false**，发送保持禁用。本切片不实现编排 Agent / LLM 循环、假 Agent 回复、Daemon 新路由，也不宣称 M7 / 对话生成完成。Placement 默认仍是本机；不发明 enrollment 或容器编排 API。
- **文档影响：** [decision-register.md](decision-register.md) D17 写明 DTO 已冻结且不列 chat path；[api-capability-matrix.md](api-capability-matrix.md) 命名该 DTO、**不增加** chat 资源；[03-implementation-status.md](03-implementation-status.md) T02/T20 诚实记录（DTO 冻结；发送未接线；M7 未完成）；[02-development-task-backlog.md](02-development-task-backlog.md) T20 会话契约依赖已满足、发送仍是缺口；[04-collab-and-review.md](04-collab-and-review.md) 仍禁止假对话成功；[docs/protocols](../protocols/README.md) 增加 `authoring-session.schema.json`；[02-core-user-flows.md](../product-ui/02-core-user-flows.md) §9 同步。
- **状态：** protocol 会话 / 草稿 DTO **implemented**。T20 发送 / 编排 Agent / 对话生成 / M7 **planned**。

---

## 2026-09-12（Asia/Taipei）#27 rebase 到 T21 tip `f3b2045`

- **决定：** #26（T21 `orchestrationMode` 启动面 + capability gating）已 squash 合入 `main` `f3b2045`。#27 rebase 到该 tip：同时保留 T21 项目启动面探针/部分接线（Task 详情不挂未接线控件；M8 未完成）与 D17 `AuthoringSessionDto` / `AuthoringDraftDto` 协议冻结。`CHAT_SESSION_PROTOCOL_FROZEN` 仍为 false。不发明 chat / `:direct` / enrollment / 容器 path。不宣称对话生成、T20 发送、M7 或 M8 完成。
- **文档影响：** 冲突页同时保留 T21 现行部分接线表述与 D17 会话 DTO 冻结表述。
- **状态：** T21 UI **部分接线**（main）。会话 / 草稿 DTO **implemented**。T20 发送 / 编排 Agent / M7 / M8 **planned**。
