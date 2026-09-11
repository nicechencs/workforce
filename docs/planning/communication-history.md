---
title: 产品沟通历史
type: decision
status: current
owner: maintainers
updated: 2026-09-11
---

# 产品沟通历史

日期：2026-09-11  
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

## 2026-09-11（Asia/Taipei）D15–D18 契约对齐与流程图复核

- **决定：** 冻结并贯通 D15–D18 的文档语义：`transport`、`placement`、`orchestrationMode` 三轴正交；Project 绑定精确 `TeamVersion`；Workflow 采用 `WorkflowDraft → published WorkflowVersion → ProjectExecutionSnapshot/WorkflowInstance` 三层；direct 仅绕过 Workflow 图调度，仍创建项目内 ad-hoc Task/Run 并经过 Policy、Workspace、Budget、Approval、Capability、Artifact/Evaluation 治理，默认不推进 WorkflowInstance/Project 完成度；M3 缺省模式兼容为 `workflow_bound`。
- **文档影响：** 更新 blueprint 01/02/03/05/07/08/09/10/11/12、planning decision/state/API/backlog/status、Product UI 核心流程/线框、diagrams 索引与三张既有图；新增 D17 authoring 与 D18 双模式流程图。D17 明确 Application authoring use case（T20-B/T14 owner）负责 proposal/change-set、CAS/staged apply、Policy/Budget/Credential/Event、cancel/retry、retention/redaction；catalog DTO 只作为 published projection；Artifact API 统一精确版本路径。`check-docs` 分阶段扩大为全 docs 链接/锚点及 Mermaid fenced-block 完整性检查，current 元数据仍按迁移范围强制。
- **状态：** **planned**。本次仅完成文档/检查器契约对齐；D17/D18 代码、公共 schema、endpoint 与真实 Runtime 仍未实现。

---

## 2026-09-11（Asia/Taipei）Reviewer 复核：wire/canonical 与 authoring Runtime 边界修订

- **决定：** 当前严格 `workforce.task/0.1` wire DTO 不接受 `orchestrationMode`；若 T02 保持 `0.1`，只能新增可选字段并由 Application 归一化，否则升级协议。`orchestrationMode` 只在解析后的 canonical Run snapshot 中必填。D17 的 conversation turn/raw intent 通过受治理 authoring Task/Run 与 Runtime SPI 执行编排 Agent，Proposal 是该 Run 输出；生成出的 Workflow 仍须发布和计划确认后才执行。
- **文档影响：** 补 TeamDraft、WorkflowGraphDefinition、唯一 `PlacementSnapshot`、Project/WorkflowInstance execution snapshot FK 与 DB CHECK；补 authoring usage/budget/cancel/retry/failure/expired/partially_applied 状态、普通 prerequisite edge 投影规则，以及全量 fenced-code 检查测试。旧条目关于 `WorkflowDefinition`/未发布 `WorkflowVersion` 保留为历史记录，不作为现行契约。
- **状态：** **planned**。本次仍仅调整文档/检查器；T02 公共 schema、T14 authoring use case、M7/M8 代码与真实 Runtime 未实现。

---

## 2026-09-11（Asia/Taipei）最终审阅修订：ChangeSet、snapshot 唯一来源、启动顺序与迁移门槛

- **决定：** `WorkflowDraft` 始终保持 draft，作者操作状态只属于 `AuthoringChangeSet`/step；多目标使用逐目标 `expectedRevision`，staged steps 持久化状态并支持失败、部分应用、取消、过期、重试和恢复。`ProjectExecutionSnapshot` 是 workflow-bound 的唯一版本来源，direct 永不推进 WorkflowInstance/Project；吸收 direct 产物必须新建 workflow-bound/follow-up command，显式引用精确 `ArtifactVersion` 并重新验收。启动流程前段只解析 placement intent，选定 Node/Runtime、Lease、WorkspaceInstance 后组装 PlacementSnapshot，再原子创建 Run、snapshot、Event/Outbox。
- **文档影响：** `blueprint/10-database-schema.md` 删除 runs CHECK 对已移除 `workflow_version_id` 的引用，统一 step `patchRef` 存储/保留规则，并补齐现行 M3 Run 尚无 mode/transport/placement/snapshot 字段时的 T04 expand → backfill → switch → contract migration；`blueprint/03-system-architecture.md`、`diagrams/node-scheduling-flow.md`、`diagrams/dual-execution-mode-flow.md`、`diagrams/workflow-authoring-flow.md` 与 Product UI 核心流程同步启动顺序和 Run/snapshot/Event/Outbox 原子边界；Project 计划确认只创建 execution snapshot，`workflow.start` 才创建 WorkflowInstance。API blueprint/矩阵保持 `/teams/{id}/drafts...`、`/workflows/{id}/drafts...` 写草稿、`versions` 只读 published。`03-implementation-status.md` 与 MVP 计划明确 T04 migration、T16 current-M3 upgrade fixture 仍 planned/not implemented；`check-docs` fenced block 只识别 0–3 个前导空格，并覆盖 4 空格/tab 测试。
- **状态：** **planned**。本轮仍只修正文档与文档检查器；T04 migration、T16 upgrade fixture、D17/D18 实现与公共 schema 均未实现。

---

## 2026-09-11（Asia/Taipei）分支模型改为 `dev` / `release`

- **决定：** 仓库默认分支由 `main` 改为 `dev`。`dev` 是唯一的日常开发与集成分支，同时是默认分支；未来发版使用 `release` 分支（从 `dev` 切出）。既有 `main` 上的提交历史整体保留并落到 `dev`，`main` 不再作为集成分支存在。
- **文档影响：** [AGENTS.md](../../AGENTS.md) 红线与「按任务读取」的合入目标改为 `dev`；[04-collab-and-review.md](04-collab-and-review.md) 新增 §0 分支模型，PR 管道的合并目标与角色表改为 `dev`；[04-repository-structure.md](../blueprint/04-repository-structure.md) §17 GitHub 基线改为默认分支 `dev` 并补 `release`；[01-product-vision-prd.md](../blueprint/01-product-vision-prd.md) §13 与 [12-mvp-implementation-plan.md](../blueprint/12-mvp-implementation-plan.md) 的建仓步骤改为设置 `dev` 保护。
- **不改动：** `docs/spikes/` 里的 `main` 是隔离实验仓的分支名，保留为历史记录；`05-task-protocol.md`、`11-api-design.md` 中 DTO 示例的 `ref` / `baseRef: "main"` 是任意 ref 取值示例，不是分支策略，本轮不改协议。
- **状态：** 本地 **implemented**（`dev` 已建立并含原 `main` 与待合并任务分支的全部内容）。远程默认分支、远程 `main` 的处置与 `release` 发布流程 **未实现**：远程仍为 `origin/main`，推送与改默认分支需本次任务之外的明确授权，`release` 流程属 T17。

---

## 2026-09-11（Asia/Taipei）D15–D18 落地方案与实现前检查点

- **决定：** 为最近三轮文档冻结的 D15–D18 语义（画布、自定义 Team、对话生成、双执行模式）补一份**实现前检查点**，把「文档要求」翻译成可领取的顺序，不改任何已冻结规则。就本轮代码核查得出四条影响顺序的判断：(1) migration 的 **expand 阶段必须先于任何会写 Run 的 D17/D18 代码**，否则会积累第三批需要 backfill 的历史数据；(2) 当前 `StartRunRequest.placement` 要求调用方先给出已解析的节点/Workspace，与文档冻结的「先解析 intent、守卫通过后才选定」顺序相反，wire 契约与执行顺序必须显式二选一（保持 `0.1` 并把 `placement` 降级为 intent，或升协议版本）；(3) `ProjectExecutionSnapshot` 的写入时机要挪：现在 `:confirm-plan` 直接创建 `WorkflowInstance`，文档要求只创建 snapshot 并进入 `ready`，由 `:start` 创建实例；(4) SQLite 当前是 `world.json` 之后的事后投影且投影吞掉约束错误，因此文档的 `switch/contract` 阶段缺少「谁是权威」的前提，需先让投影失败可见。
- **文档影响：** 新增 [05-d17-d18-landing-plan.md](05-d17-d18-landing-plan.md) 并在 [docs/README.md](../README.md) 两处索引挂入口。该文档只记录本轮实际读取到的代码事实（含文件与行号）、公共契约缺口 C1–C13、S0–S5 落地序列、验收与测试矩阵、风险登记，以及本轮**未能运行测试**的环境限制。**未修改** decision-register、state-matrix、api-capability-matrix 与 02-development-task-backlog 的任何结论；T18–T21 仍为 planned/未实现。
- **不改动：** `.github/workflows/pull-request.yml` 仍在 `push.branches: [main]`，远程默认分支仍是 `origin/main`；本轮文档已记该不一致，但改 CI 触发分支与远程默认分支属仓库配置与远程操作，需明确授权。根 `README.md` 未改。
- **状态：** **planned**。本轮只新增方案文档与索引；无源码改动，无迁移执行，无 endpoint 变更。本轮**未运行任何单元/集成测试**（DSH 文件沙箱禁止程序管道捕获子进程输出，`pnpm`/`vitest`/`node --test` 均 EPERM；`node tooling/docs/check-docs.mjs` 可正常执行），该限制与待补验证项已写在方案文档 §8。

---

## 2026-09-11（Asia/Taipei）T02 切片：执行三轴公共契约冻结（加法式）

- **决定：** 领取 T02 的第一个可交付切片，冻结 D07/D18 的执行三轴公共契约。关键取舍：**不改 `StartRunRequest`**。原方案（把 `StartRunRequest.placement` 从必填已解析绑定改成可选 intent）经读码评估会波及 `packages/runtime-sdk` 的 `assertNode`/`bindingFor`、mock/codex adapter 与 5 个测试文件，属于顺手重写运行时，超出契约冻结范围。改为**加法式**：新增 `packages/protocol/src/execution.ts` 承载三条正交轴，`StartRunRequest` 作为 Adapter SPI 边界请求保持「必须带已解析绑定」不变，并以回归测试锁定其键集合。
- **契约内容：** `orchestrationModes = workflow_bound | direct`；`runtimeTransports = process | sdk | http`（`remote` 不是 transport 取值）；`placementIntentModes = automatic | local_only | remote_only | specific_node`；`placementSnapshotSchema` 为唯一已解析绑定（node / nodeSession / runtimeInstallation / workspaceInstance / lease / fencing，含仅由 backfill 写入的 `legacySchemaVersion`）；`runExecutionSnapshotSchema` 用 `superRefine` 强制 `workflow_bound` 必带 `executionSnapshotId`、`direct` 必不带。字段名对齐 `blueprint/10` 的 `runs.orchestration_mode` / `transport` / `placement_snapshot_json` / `execution_snapshot_id`，不留映射歧义。
- **文档影响：** 新增 `packages/protocol/src/execution.ts` 与 `execution.test.ts`（14 例），`packages/protocol/src/index.ts` 增加一行 re-export；新增 fixture `docs/protocols/v0.1/fixtures/run.execution.workflow-bound.json` 与 `illegal.run.execution.direct-with-snapshot.json`；`docs/protocols/v0.1/ports.md` 的 `StartRunRequest` 段落改写，明确它是 Adapter SPI 边界请求、三轴不进该结构，并写入解析顺序。**未改** decision-register、state-matrix、api-capability-matrix、数据库 migration、daemon、desktop。
- **状态：** 契约层 **implemented**（仅本切片）。验证：`node node_modules/typescript/bin/tsc -p packages/protocol/tsconfig.json --noEmit` 退出 0；含新测试文件的定向 typecheck 退出 0；`node tooling/docs/check-docs.mjs` 通过（50 文件）；14 条断言以纯 Node 复算全部通过。**vitest 未运行**（本环境任何 Node→子进程 spawn 均 EPERM，已实测 `execFileSync(process.execPath)` 与 `cmd.exe` 同样失败）；`turbo run typecheck` 有 2 个包报 `TS2307` 找不到 `@workforce/domain` / `@workforce/application/ports`，经 `git stash` 复测确认**属基线既有**，与本切片无关。调度、数据库迁移、HTTP 与 UI 仍未实现。

---

## 2026-09-11（Asia/Taipei）T04 切片：D17/D18 migration 的 expand 阶段

- **决定：** 承接 T02 切片，落地 `blueprint/10` §12 的 **expand → backfill → switch → contract** 中的 **expand**。严格限定为加法：5 张新表（`team_drafts`、`workflow_drafts`、`authoring_change_sets`、`authoring_change_set_steps`、`project_execution_snapshots`）+ 6 个**可空**列（`projects.execution_snapshot_id`、`workflow_instances.execution_snapshot_id`、`runs.orchestration_mode` / `transport` / `execution_snapshot_id` / `placement_snapshot_json`）+ 2 个索引。**本阶段不加 `NOT NULL`、不加互斥 CHECK、不做 backfill**——历史 M3 Run 的 mode/transport/placement/snapshot 事实必须由 S3 从既有 Runtime/Local Node/Workspace 证据回填，不能猜测。新增迁移版本 `005_execution_axes_expand`；001–004 保持不可改写。
- **文档影响：** `packages/database/src/schema.ts` 新增 `MIGRATION_005_SQL` 并挂入 `MIGRATIONS`；`packages/database/src/index.ts` 导出该常量；`packages/database/src/persistence.test.ts` 同步两处既有迁移列表断言并新增两例（001–004 带真实历史 `runs` 行的升级、checksum 守卫拒绝篡改的 001）。方案文档 [05-d17-d18-landing-plan.md](05-d17-d18-landing-plan.md) 补 S1 进度、并把 §8 的环境限制改写为实测结论与可用验证手段表。**未改** daemon、desktop、desktop-client、runtime-sdk 或任何 endpoint。
- **状态：** expand 层 **implemented**（仅本切片）。验证：6 条 Node 真实探针全部通过——空库 5 个迁移全绿且 5 张表存在；从 001–004 升级后历史行四列均为 `NULL`、列保持 `notnull=0`、`runs` 表 SQL 不含互斥 CHECK、`projects`/`workflow_instances` 新列存在；checksum 守卫抛 `checksum mismatch`；迁移可重入；新 DDL 的 CHECK 与 `(change_set_id, target_type, target_id)` 唯一约束确实生效。
- **新记录的环境阻塞（非代码问题）：** 本会话沙箱**禁止任何 Node 进程创建子进程**，故 `vitest`、`node --test`、`pnpm install` 均无法运行（`tsc`/`turbo` 可用）。另有**独立的 pnpm store 不完整**：`packages/database` 声明了 `@workforce/domain`/`@workforce/policy` 但 `node_modules/@workforce/` 下只有 `application`；`packages/process` 声明了 `@workforce/application` 却只装了 `domain`。这解释了 `turbo run typecheck` 的两个 `TS2307`，也解释了为何按包独立 typecheck 不可用。修复需一次 `pnpm install`，本环境无法执行。
- **未做（诚实登记）：** backfill、switch、contract 收紧、`current-M3 upgrade fixture`（T16）、`ProjectExecutionSnapshot` 的 repository 与写入路径（S2a）、调度与三轴解析（S2b）、作者面（S2c/S2d）、HTTP 与 UI。

---

## 2026-09-11（Asia/Taipei）S2a 数据面：ProjectExecutionSnapshot 记录与 repository

- **决定：** 为 D02 的"计划确认只冻结一份执行快照、后续只从它读版本"先落地**数据面**，行为拆分（`:confirm-plan`/`:start` 分离）留作下一步。快照的不可变通过 repository 语义强制：**只有 `insert`，没有 `update`**——同 id 同 `contentHash` 为幂等 no-op，同 id 不同 hash 抛 `conflict`，因此"只写一次"不依赖调用方自觉。新 repository 刻意不 import `@workforce/domain` 与 `@workforce/policy`，以便在 §8 的 pnpm store 缺口下仍能独立执行与验证。
- **文档影响：** `packages/application/src/use-cases/projects/store.ts` 新增 `ProjectExecutionSnapshotRecord`，`ProjectRecord` / `WorkflowInstanceRecord` 补 `executionSnapshotId?`，`MemoryWorld` 新增 `executionSnapshots` 与 `executionSnapshotForProject()`，并同步 `use-cases/projects/index.ts` 导出；`packages/database` 新增 `execution-snapshots.ts`（`SqliteProjectExecutionSnapshotRepository`）与 `execution-snapshots.test.ts`，`SqliteWorldSnapshot` 增加 `executionSnapshots` 成员与 `WorldEntitySnapshot.executionSnapshots`（`save` 中先写快照以保证 FK 顺序），`SqliteProjectRepository` / `SqliteWorkflowInstanceRepository` 补 `execution_snapshot_id` 读写，`world-snapshot.test.ts` 的样例快照同步新字段。方案文档 [05-d17-d18-landing-plan.md](05-d17-d18-landing-plan.md) 补 S2a 进度。**未改** daemon、desktop、desktop-client、runtime-sdk 或任何 endpoint。
- **状态：** 数据面 **implemented**（S2a 的一部分）。验证：12 条 Node 真实探针全部通过（快照 insert/读回、同内容幂等、不同 hash 冲突、budget JSON 往返、缺失 budget 不产生 `null` 字段、`findByProject`、FK 约束、畸形 JSON 读取守卫、`ProjectRecord.executionSnapshotId` insert/update 往返、`WorkflowInstanceRecord.executionSnapshotId` 往返且不影响 M3 无快照实例、SQL 占位符与实参数量一致）；`tsc -p packages/protocol` 退出 0；`node tooling/docs/check-docs.mjs` 通过（50 文件）。
- **仍未做：** `:confirm-plan` 只建 snapshot 并进入 `ready`、`:start` 才建 `WorkflowInstance`、执行图来源改为 snapshot 引用的已发布 `WorkflowVersion`、`task_dependencies` 落库、`:confirm-plan` 的审批消费事务边界（§3.7a）、backfill/switch/contract、调度、作者面、HTTP 与 UI。`tsc -p packages/database` 仍因 §8 的 store 缺口无法独立运行。

---

## 2026-09-11（Asia/Taipei）进度文档对齐已验证事实；daemon 持久化回归修复

- **决定：** 不改任何已冻结规则，只把规划/进度文档与当前已验证事实对齐，并修掉本轮发现的 daemon 持久化回归。(1) T04 的 D17/D18 migration 不再是「全无代码」：`005_execution_axes_expand` 的 **expand** 已落地（5 张新表 `team_drafts` / `workflow_drafts` / `authoring_change_sets` / `authoring_change_set_steps` / `project_execution_snapshots` + 6 个可空列，无 `NOT NULL`、无 workflow_bound/direct 互斥 CHECK、无 backfill）；T02 已冻结执行三轴协议契约（`packages/protocol/src/execution.ts` 的 `orchestrationModes` 与 `runExecutionSnapshotSchema`，带测试）；S2a 的 `SqliteProjectExecutionSnapshotRepository`（insert-once）与 `MemoryWorld.executionSnapshots` 已存在。仍未实现：backfill / switch / contract、snapshot-only contract、`:confirm-plan` 只建 snapshot 而 `:start` 才建 `WorkflowInstance` 的拆分、新 Run 双写三轴、`authoring_change_sets` 写入方、T16 current-M3 upgrade fixture。(2) 发现并修复 daemon 持久化回归：`dumpWorld` / `dualWriteSqlite` / `loadComposition` / `hydrateWorld` 未传递 `world.executionSnapshots`，导致 `SqliteWorldSnapshot.save()` 在 `for..of` 处解引用 `undefined`，`persist()` 又静默 `catch` 掉该失败；现全链贯通、缺字段回退 `[]`、非约束类失败经 `console.error` 可见（`dualWriteSqlite` 仍吞掉 UNIQUE/PK 约束失败）。(3) 另修 `SqliteWorldSnapshot.save()` 的插入顺序：`project_execution_snapshots` 外键指向 projects / workflow_versions / team_versions，原顺序先插 snapshot 会 `FOREIGN KEY constraint failed` 并回滚整事务，现改为在 project / workflow 循环之后插入，并加回归测试。**不**因此宣称 D02 confirm/start 拆分、D15 `workflow_versions` 不可变、D17 对话生成、D18 双执行模式、live Codex 或 headed Electron 已完成。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 改掉「T04 migration（含 snapshot-only contract）只是规划项」的段落，修正 T04 / T16 / T21 行，新增 §3「持久化回归修复切片」与本轮修订说明（保留既有验证历史，不重写、不删除）；[05-d17-d18-landing-plan.md](05-d17-d18-landing-plan.md) 把 §2 明确标注为 `c613609` 基线时点的**历史**事实，并列出此后三项落地与其后仍成立的行为结论；[blueprint/12-mvp-implementation-plan.md](../blueprint/12-mvp-implementation-plan.md) 与 [blueprint/10-database-schema.md](../blueprint/10-database-schema.md) 中「当前 M3 migration 不包含该能力 / 当前未实现」改为「expand 已落地，backfill/switch/contract 未实现」。**未改** decision-register、state-matrix、api-capability-matrix、02-development-task-backlog 的任何结论，也未改任何源码、测试或锁文件。
- **状态：** 本轮文档同步属 **implemented**（只记录已验证事实）；005 expand、协议三轴契约、snapshot repository 与上述持久化修复同为 **implemented** 切片。backfill / switch / contract、D02 拆分、D17、D18、live Codex、headed Electron 与 T16 upgrade fixture 仍为 **planned / 未实现**。验证（Windows，Node v24.19.0，pnpm 9.4.0）：`pnpm exec vitest run apps/daemon/tests` → 8 个测试文件中 7 个通过、35 passed / 4 failed（唯一失败文件是 `apps/daemon/tests/composition.test.ts`，全部为 Windows 上 `fs.rmSync` 拆除期 EPERM；未修复的基线 `fdce1b2` 上该文件有 10 条失败，含真实断言 `expected 500 to be 202`）；`pnpm exec vitest run packages/database packages/protocol packages/application` → 22 files / 128 tests 通过（两项均本轮复跑确认）；`pnpm --filter @workforce/database typecheck`、`pnpm --filter @workforce/daemon typecheck`、`pnpm lint`、`pnpm check:docs` 均退出 0。**未运行**：全量 `pnpm test`、`pnpm build`、headed Electron、live `codex exec`。**已知无关失败**：`apps/desktop/tests/composition.test.ts` 有 1 条 Windows 路径分隔符失败。

---

## 2026-09-11（Asia/Taipei）测试可靠性、CI 触发分支与桌面文案修正

- **决定：** 不改任何冻结规则，只修已被证据坐实的工程缺陷。(1) `vitest.config.ts` 的 `testTimeout` 由默认 5000ms 提到 30s：daemon 集成用例会起真实 git worktree、SQLite 与 HTTP，并行跑时超时集合每次不同，属假红而非断言失败；提高后全量由 466 passed / 7 failed 变为 472 passed / 4 failed。(2) `.github/workflows/pull-request.yml` 的 `push` 触发分支由 `main` 改为 `dev`（`main` 已重命名，该触发此前指向不存在的分支）。(3) `apps/desktop/tests/composition.test.ts` 的渲染入口断言改用 `path.join`，修 Windows 路径分隔符假红；`runtimes/codex/src/adapter.test.ts` 的「resolved context 不完整」用例显式传 `platform: "linux"`，避免被 win32 捕获守卫先拦截，仍断言同一 `unsupported_capability`。(4) `budgetPlaceholder` 改为读取 `ProjectBudgetDto` 的真实字段（`reservedMinor` / `settledMinor` / `estimatedLimitMinor` / `settledLimitMinor`）；此前它读不存在的 `costMinor`，导致已接通的项目预算仍显示「待接入 GET /projects/{id}/budget」。(5) 工作流与团队页文案按 IA §2 / §6.2 去掉「V0.1 没有画布」「自定义团队编排后置」，改为「尚未实现」；行为不变（仍无可点击成功态）。(6) `CompositionWorktreeHost.dispose()` 释放失败不再静默吞掉，改为 `console.error`（与 D04 可见性原则一致）。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) §3 更新全量测试数字与剩余失败归因，并记录本轮一并修掉的测试/CI 缺陷。未改 decision-register、state-matrix、api-capability-matrix、02-development-task-backlog 的任何结论。
- **状态：** 全部 **implemented**（测试/CI/文案/UI 呈现层）。**不**因此宣称 D15 画布、D16 自定义 Team 写面、D17 对话生成、D18 双执行模式或任何 M7/M8 能力已实现。**未解决、待跟进：** Windows 上 `apps/daemon/tests/composition.test.ts` 拆除期仍有 4 条 `fs.rmSync` EPERM，被锁项为 `workforce.sqlite` / `-wal` / `-shm` 与 `repo` 目录、由测试进程持有（断言已通过、重试无效、进程退出后可删），仅影响 Windows，不影响 Linux CI。`pnpm format:check` 在仓库当前状态下即为红（503 个文件未按 Prettier 格式化），属既有状态，本轮未处理。
