---
title: 产品沟通历史
type: decision
status: current
owner: maintainers
updated: 2026-09-13
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

## 2026-09-13（Asia/Taipei）角色版本库与全局 Chat 壳现在就要有

- **决定：** 用户纠正：跨项目复用角色；模型第一天就是 WorkerVersion；**现在就要有我的角色版本库**（找、搜、引用、归档、Team 选用/fork；发布不可变，不适应则 fork）。**Chat 功能也要有**：随时随地用语言创建角色、创建流程，并可用语言问进度、交流工作内容。Chat 是全局壳，不是作者页专属，也不是 IM（不要 Worker 收件箱、无项目聊天室、`workerId` 当对端）。仍禁止聊天当完成；问进度只读 Task/Run/Event/Artifact 投影，不得编造终态。Marketplace 未来要做、**现在不是一等面**；装进来仍进自己的库。现行 `{ role, runtimeProfileId, quantity }` 不再写成目标模型；Team 成员目标是 `workerVersionId`。
- **文档影响：** [决策登记](decision-register.md) 收窄 D16/D17/D18 非目标并写入冻结表；[PRD](../blueprint/01-product-vision-prd.md) 把「自由聊天」读成禁 IM；[领域模型](../blueprint/02-domain-model.md) TeamMember 目标 `workerVersionId`；[IA](../product-ui/01-information-architecture.md) 库挂 AI 团队、Chat 挂壳；[核心流程](../product-ui/02-core-user-flows.md) §8/§9；[线框](../product-ui/03-p0-wireframes.md) 壳上 Chat 与库；[任务清单](02-development-task-backlog.md) 只改 T19/T20 目标句与 planned 子任务名；[实现进度](03-implementation-status.md) 只标 planned。不改能力矩阵 path、不发明 HTTP。
- **状态：** **planned**。本条只冻结产品方向并回写规划文档；角色库页、全局 Chat、`workerVersionId` 写入与 Marketplace 均未实现。

## 2026-09-12（Asia/Taipei）T00-DOC-ALIGN：规划文档对齐到当前 `dev` 源码

- **决定：** 不改任何产品决策。只把规划页里落后于 `dev` tip `79528a0` 的实现事实改成与源码一致：`CHAT_SESSION_PROTOCOL_FROZEN=true`；Daemon AuthoringSession HTTP 与 typed send 已接线；Host 一次性 transient prompt handoff（磁盘只存 digest）；Codex authoring input fail-closed；JSON Schema 31 个；`RunDto`/`ProjectDto` 在 `packages/protocol`；受管 `startRun` 现构造 `RunExecutionSnapshot`。Electron allowlist **仍缺** authoring-sessions；Daemon **无** `POST /tasks/{id}/runs`。`packages/protocol/src/authoring.ts` 过时文件头不在本项范围。不宣称 M7/M8 完成、T20 headed 或 ad-hoc `direct` 调度。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T02/T04/T05/T10/T20/T20-B/T21 与 §5；[02-development-task-backlog.md](02-development-task-backlog.md) T18–T21/T20-B 当前切片；[api-capability-matrix.md](api-capability-matrix.md) 作者 HTTP 与旗标；[05-d17-d18-landing-plan.md](05-d17-d18-landing-plan.md) 标明历史基线 vs 现行事实；[04-collab-and-review.md](04-collab-and-review.md) 去掉「D17/D18 未实现」绝对句。
- **状态：** 文档对齐 **implemented**。M7/M8 产品完成、T20 真窗口、Codex 编排 Agent、`direct` 调度仍 **planned**。本轮不改源码、不跑测试。

## 2026-09-12（Asia/Taipei）Run 级 Placement 与 ExecutionLease 与 NodeSession 分离

- **决定：** NodeSession 只表示节点在线会话；每个 Run 必须有独立 ExecutionLease 与 fencing token，同一节点仍可并发多个 Agent。Project 只保存 PlacementIntent 或默认策略，Run 启动时解析 Node / RuntimeInstallation / WorkspaceInstance 并写入不可变 `RunExecutionSnapshot`。启动事务先落 Run、Placement、Lease、Event 和 dispatch/outbox，提交后再启动 Runtime，且必须幂等。Workflow Scheduler 只做 DAG 就绪；Placement Scheduler 另有 Local Node 实现。文档明确 Local / Remote Server / Distributed 三种部署，当前 `apps/daemon` 是 V0.1 本地组合，不是未来独立 Control Plane。不实现远程节点、集群通信或 GitHub 协同。
- **文档影响：** 新增 [部署模式与边界](../architecture/deployment-modes-and-boundaries.md)；根 README 与 [文档索引](../README.md)；本页；[实现进度](03-implementation-status.md) T09 切片。
- **状态：** 本机 Local Node / Mock 路径 **implemented**（源码与定向测试）。Remote Server / Distributed、真实远程 runner 仍 **planned**。

## 2026-09-12（Asia/Taipei）#34 T19/T21 headed 真窗 PASS 后 squash 进 `ae0f4e6`

- **决定：** Test-bot 对 PR #34 head `06e6b659` 的 T19 自定义 Team 写 UI / 草稿 persist 与 T21 项目详情 `orchestrationMode` + start 记 headed Electron 真窗口 **PASS**（报告 `/workspace/qa-issues/WORKFORCE-PR34-06e6b659-T19-T21-TRUEWINDOW.md`，Test-bot workspace，未必入库）。随后 #34 squash 进 `dev` tip `ae0f4e6`。进度页只把这两张卡标 PASS，不宣称 M7/M8 完成，不宣称 T20 Agent/send；`CHAT_SESSION_PROTOCOL_FROZEN` 仍为 false。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T19/T21 与 §4/§5；[02-development-task-backlog.md](02-development-task-backlog.md) T19/T21 当前切片去掉「headed 未跑」。
- **状态：** T19/T21 headed 真窗 **implemented**（PASS，证据在该报告）。M7/M8 完成、T20 Agent/send、T18 画布 headed 仍 **planned**。

---

## 2026-09-12（Asia/Taipei）把 main 隔夜剩余缺口迁到 `dev`（不并进 `main`）

- **决定：** 日常线是 `dev`。在 tip `122600d`（#32 + #33）之上补迁 main 仍多出来的隔夜工作：T19 完整自定义 Team 写 UI + 草稿 persist（#21）；T21 项目详情挂载 orchestrationMode 控件（#26）；composed `orchestrationMode` 传入 `app.start()` / Run / host 记录（#28 深度，**不**重开 C5–C9，不把该字段写入 `StartRunRequest`）；#20 Placement 文档（本机默认，远程与容器为一等产品能力，实现未完成）。不 merge 到 `main`，不删除 `main`。不宣称 M7/M8 完成、headed PASS、`direct` 调度、生产 Codex direct，或远程/容器 runner 已实现。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T12/T16/T19/T21 与 §5；[02-development-task-backlog.md](02-development-task-backlog.md) T19/T21 当前切片；[decision-register.md](decision-register.md) §0 / 冻结表 / D07 / **D19**；[api-capability-matrix.md](api-capability-matrix.md) 页面动作与 T18–T21 约定；[01-information-architecture.md](../product-ui/01-information-architecture.md) §4.7；[02-core-user-flows.md](../product-ui/02-core-user-flows.md) §3；[0001-hybrid-distributed-execution.md](../adr/0001-hybrid-distributed-execution.md)。
- **状态：** T19 写 UI + 草稿 persist、T21 详情挂载、composed passthrough、D19 文档 **implemented**（本 tip 单测 / happy-dom）。M7/M8 完成、headed、Codex direct、远程 enrollment、容器 runner 仍 **planned**。

---

## 2026-09-12（Asia/Taipei）把 #31 session store 迁到 `dev`，不并进 `main`

- **决定：** 日常线是 `dev`。#31 指向 `main` 且已分叉，不把 #31 合进 `main`。只把 Desktop-local authoring session store、仅用户 append、renderer `localStorage`（跨 Ctrl+R）迁到当前 `dev` tip。`CHAT_SESSION_PROTOCOL_FROZEN` 保持 false；无 Agent/send、无 chat HTTP。不宣称 M7/M8 完成，不照搬 #30/#31 在 main 上的 headed PASS。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T20 与 §5.6；[02-development-task-backlog.md](02-development-task-backlog.md) T20 当前切片；[api-capability-matrix.md](api-capability-matrix.md) 对话生成行；[decision-register.md](decision-register.md) §0 切片一句。
- **状态：** session store / 仅用户 append / `localStorage` **implemented**（本机 store + 单测）。编排 Agent / send / chat HTTP / M7 完成仍 **planned**。headed 真窗仍未跑。

---

## 2026-09-12（Asia/Taipei）合入 `dev` 前再钉本分支切片边界

- **决定：** 向 `dev` 开 PR 的进度页必须只写本分支实有代码。T18 = 画布 + 草稿写 API（部分 M7 UI）；T19 = 写 API 已通、页面仍 stub；T20 = 作者壳在、`CHAT_SESSION_PROTOCOL_FROZEN=false`、无 Agent/send、无 session store；T21 = 项目 start 的 mode UI 模块 + capability gating 已有，控件未挂详情，composed passthrough 比 main #28 更薄。公共 `orchestrationMode` 权威仍是 `execution.ts`（C5–C9），Daemon `modules/orchestration.ts` 只做 parse/gate。不宣称 M7/M8 完成、headed PASS、Codex direct。不发明 chat / `:direct` / enrollment。未迁 main #20 placements 文档深度、#21 完整 T19 写 UI、#28 passthrough 测试深度、#30/#31 session store + localStorage。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) T18–T21 与 §5.4–5.7；[02-development-task-backlog.md](02-development-task-backlog.md) 各卡当前切片；[decision-register.md](decision-register.md) §0 / §9 去掉「可写面尚未实现 / 代码尚未实现」的绝对句；[api-capability-matrix.md](api-capability-matrix.md) M7/M8 行与页面动作表。
- **状态：** 文档对齐 **implemented**。M7/M8 产品完成仍 **planned**。headed 真窗仍未跑。

---

## 2026-09-12（Asia/Taipei）进度文档与部分移植切片对齐

- **决定：** `task/port-main-m7-t18-t21` 是部分移植，不是 T18–T21 全量。合入 `dev` 前进度真源必须与代码一致：有画布壳 / catalog 写 API / 作者壳 / `:start` 回显，就不得再写「都还没有代码」。同时钉死诚实边界：不宣称 M7/M8 完成、headed PASS、Agent send、`direct` 调度；`StartRunRequest` 不加 `orchestrationMode`；T19 页面仍拒保存；T21 控件未入项目页；画布与设计系统两套皮肤并存。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 重写 T18–T21 与 §5.4–5.7；[02-development-task-backlog.md](02-development-task-backlog.md) 去掉「T18–T21 代码均未实现」并给各卡加当前切片；[api-capability-matrix.md](api-capability-matrix.md) 写明现切片走 `.../versions` 而非表内 `/drafts` path。
- **状态：** 文档对齐 **implemented**。M7/M8 产品完成仍 **planned**。headed 真窗仍未跑。

---

## 2026-09-12（Asia/Taipei）把 main 上的 M7 写 API 迁回 dev，保留 C5–C9 契约

- **决定：** 日常集成分支是 `dev`。`main` 上 15c058f 起的 M7 catalog 写 API、D17 authoring DTO、T18–T21 功能要迁回 `dev`，但不得覆盖 `dev` 已裁决的 C5–C9：`StartRunRequest` 不承载 `orchestrationMode`；migration `005_execution_axes_expand` 不改号；catalog 四张表使用 `006_catalog_definitions`。UI 重贴 `dev` 设计系统另切片。
- **文档影响：** [protocols/README.md](../protocols/README.md) 增加 team / authoring-session / orchestration-mode schema 索引；`orchestration-mode.schema.json` 写明权威在 `execution.ts` 而非 `StartRunRequest`。
- **状态：** 写 API + protocol DTO + 006 迁移 **implemented**（源码与测试）。T18/T19/T20 页面重贴与 T21 UI **planned**。

---

## 2026-09-11（Asia/Taipei）本机为默认执行位置；远程连接为一等产品能力

- **决定：** 产品支持在用户**本机**工作，也支持经**远程连接**工作。**默认是本机**（本机 Workspace / Local Node）。远程不是「以后再说的 nicety」，也不是把 UI 假设永远锁在客户端所在电脑；它与本机共用 ExecutionNode 抽象。V0.1 实现深度不变：只做单用户 Local Node；远程 enrollment / heartbeat / 服务器 lease 仍是版本化契约 + Mock，不建服务器控制面，不发明矩阵未列的 enrollment endpoint，UI 不得伪造在线远程节点。
- **文档影响：** [decision-register.md](decision-register.md) 冻结表、D07（默认 `local_only`、与 transport / D18 正交）与 **D19**（Placement kind `local` / `remote`）。
- **状态：** 产品模型 **planned 已冻结**。本机 Local Node **已实现**（只读诊断 + worktree）。远程执行 **未实现**（契约/Mock）。

---

## 2026-09-11（Asia/Taipei）容器为一等执行 Placement

- **决定：** 产品必须支持在**容器**中工作。容器是与本机、远程并列的 Placement kind（`container`），不是 D10 worktree 隔离的别名，也不是 `transport`。容器 Run 仍绑定某个 ExecutionNode（本机或远程宿主机）上的 WorkspaceInstance；`container` 不是第四种机器类型。
- **文档影响：** [decision-register.md](decision-register.md) **D19** 冻结 `container`；D07 / later 表写明与 isolation、enrollment、控制面的边界。不发明 Docker / K8s / 编排 endpoint。
- **状态：** 产品模型 **planned 已冻结**。容器 runner / 编排 **未实现**。不得写成已完成。

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

---

## 2026-09-11（Asia/Taipei）投影失败可见性收口与一条前序判断的更正

- **决定：** (1) 更正本文件上一条与 [03-implementation-status.md](03-implementation-status.md) 中对「投影被吞掉」的描述：实测 `packages/database` 的实体 repository（`runs` / `budgets` / `projects` / `records` / `workflows` / `tasks` / `execution-snapshots`）都已把 `isConstraintError` 覆盖的 2067/1555 转换为 `PersistenceError("conflict")` 并向上抛，因此 `dualWriteSqlite` 外层 `isConstraintError` 分支对实体的 insert / upsert 路径不可达（`node_instances.update`、`runs.updateStatus` 与 `receipts.putPending` 等未包装路径仍可到达）。真正造成静默的是 `persist()` 的 fire-and-forget `catch`（`apps/daemon/src/composition/app-services.ts`），该项已在上一轮改为 `console.error` 上报。(2) 顺手把该分支也从「丢弃」改为「上报」，使这些未包装路径的约束失败不再静默；新增两条单元测试（`apps/daemon/tests/persist-snapshot.test.ts`）分别断言原始约束错误被上报、且非约束错误仍然向上传播。不改任何冻结规则、状态机或公共契约。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) §3 与修订段更正「仍吞掉 UNIQUE/PK」的表述；[05-d17-d18-landing-plan.md](05-d17-d18-landing-plan.md) §2 历史标注同步更正，并说明该页 §6「投影失败可见性」的字面要求（失败可被观测）已满足、更强的「可阻断 / 可对账」仍为 planned。上一条历史条目保留原文，以本文为准。
- **状态：** **implemented**（可见性收口 + 测试）。**仍未实现 / 仍为 planned：** 投影失败「可阻断 / 可对账」（落地计划 §3.6 的更强语义）、D02 confirm/start 拆分、D15 `workflow_versions` 不可变、D17、D18。**未验证：** 本轮未跑全量 `pnpm test` 之外的 `pnpm build`、headed Electron、live `codex exec`。

---

## 2026-09-11（Asia/Taipei）新增 T02 契约变更请求（C5–C9）

- **决定：** 把 [D15–D18 落地方案](05-d17-d18-landing-plan.md) §4 的 C5–C9 整理成一份可供 T02 直接裁决的契约变更请求，并**更正该表的现状描述**：`3c46807` 已把 C6/C7/C8 与 C9 的 Adapter SPI 侧冻结进 `packages/protocol/src/execution.ts` 与 [ports.md](../protocols/v0.1/ports.md)，落地方案 §5 S0 亦已记录 C9 方案 A 废弃，§4 表中 C6/C7 两行仍写「无」、C8/C9 两行仍写冻结前的旧现状，属文档滞后而非待办。请求本身**不做任何裁决**，只给出建议字段/签名、理由与兼容性影响，并列出六处必须先了断的既有文档互相矛盾（`PlacementSnapshot.mode`、`policySnapshotRef` vs inline JSON、`NodeExecutionBinding` 平行模型、`placement_snapshot_json` 双归属、`transport` 无权威列、`RuntimeHandle` 缺绑定字段）。
- **文档影响：** 新增 [06-t02-contract-request-c5-c9.md](06-t02-contract-request-c5-c9.md)（`type: proposal`、`status: proposed`）；[docs/README.md](../README.md) 的中英文 Planning 索引各补一条；本文件追加本条。**未改** decision-register、state-matrix、api-capability-matrix、05-d17-d18-landing-plan 的任何结论，也未改任何源码、测试或锁文件——契约裁决权仍在 T02。
- **状态：** **planned / proposed**（等待 T02 裁决）。CR-1–CR-6 与 X1–X8 均未落地；`packages/protocol` 中现有 execution 轴代码不受影响，无行为变更。**另更正上一条历史里的一处判断：** 该条把 `pnpm format:check` 的红写成仓库既有缺陷；实测那是本机 `core.autocrlf=true` 造成 CRLF 检出、与 `.prettierrc` 的 `endOfLine: "lf"` 不一致所致，Linux CI 上为绿，仓库并无此缺陷。

---

## 2026-09-11（Asia/Taipei）前端设计风格对齐 AgentHub

- **决定：** 接受用户要求，把 Workforce 桌面客户端的前端设计风格对齐 AgentHub（`D:\demo\chen\2026\AgentHub`）。对齐的是**语义与几何**，不是实现栈：四档字号（display 22 / title 18 / body 14 / meta 12）、8/12/16 圆角加 22% 标记、4/8/12/16/24/32 间距阶梯、surface / text / border / status / accent 角色划分、浅深两套主题、5 个主题色与 8 个浅色画布色板、应用壳 12px 画布缝与方角贴窗底栏，以及「一页最多一个主操作」「状态不能只靠颜色」「空态可行动」「不伪造成功」等组件与状态规则。**刻意不对齐**：不引入 Tailwind / CVA / Radix / lucide-react（renderer 目前只有 React + Vite，引入会改根 lockfile 与构建链）；token 保留 `--wf-` 前缀避免串档；图标改为内联 SVG（同尺寸与描边档）；主题注入改在 `main.tsx` 挂载前同步落地，因为桌面 `index.html` 的 CSP 不允许内联脚本。差异清单写入设计系统文档 §7，后续若要升级到 Tailwind/Radix 栈需单独提交并作为契约变更评估。
- **文档影响：** 新增 [UI 设计系统](../product-ui/04-design-system.md)（`type: reference`、`status: current`），规定 token、组件选择、状态、可访问性、实现边界与所有权（T11 持有 token / 主题模型 / `styles.css` / `components/`，feature 目录只组合）；[docs/README.md](../README.md) 的 Product UI 索引补一条；[02-development-task-backlog.md](02-development-task-backlog.md) 的 T11 所有权与「避免冲突的硬规则」表补上设计 token 与基础组件唯一负责人；[03-implementation-status.md](03-implementation-status.md) 补 T11 行与 §3 第 7 条并加本轮修订说明。**未改** decision-register、state-matrix、api-capability-matrix，也未改任何公共 DTO、Daemon、Protocol 或锁文件。
- **状态：** **implemented**（展示层与设计文档）。改动文件：`packages/ui/src/tokens.ts`（重建）、`packages/ui/src/theme.ts`（新增）、`packages/ui/src/index.ts`、`packages/ui/src/tokens.test.ts` 与 `theme.test.ts`（新增，共 14 例）；`apps/desktop/src/renderer/styles.css`（重建）、`renderer/components/{ui.tsx,icons.tsx,cn.ts,index.ts,shell-frame.tsx,placeholder-page.tsx}`、`renderer/app/theme.tsx`（新增）与 `renderer/app/index.ts`、`renderer/main.tsx`；`renderer/features/` 下的 projects（含删除 `projects/ui.ts`）、tasks、teams、workflows、dashboard、runs、artifacts、approvals、nodes、settings 与 `_t13_client.ts`（移除 inline 样式层）。验证（Windows，Node v24.19.0，pnpm 9.4.0）：`pnpm typecheck` 24/24 通过；`pnpm lint` 退出 0；`pnpm --filter @workforce/desktop build` 成功（含 `vite build`）；全量 `pnpm test` → 116 个测试文件中 114 通过 / 1 失败 / 1 跳过，513 例中 488 通过 / 4 失败 / 21 跳过；唯一失败文件是 `apps/daemon/tests/composition.test.ts` 的 4 条 Windows `fs.rmSync` 拆卸期 EPERM，与本次改动前基线完全相同（基线 474 通过 / 4 失败，本轮 +14 例来自新增的 `packages/ui` token 与主题测试）。定向 `pnpm exec vitest run apps/desktop/src apps/desktop/tests packages/ui` → 40 files / 137 tests 通过、1 skipped，含 `apps/desktop/tests/main-path.smoke.test.ts` 对 composed Mock daemon 的 happy-dom 端到端点击（创建 → 绑定工作区 → 开始规划 → 确认计划 → 开始执行 → Tasks 依赖文案）；`pnpm check:docs` 通过（52 个 Markdown 文件）。**未验证：** headed Electron 真窗口点击与 live `codex exec` 仍为环境限制；`pnpm format:check` 在本机仍因 `core.autocrlf=true` 的 CRLF 检出为红，属既有环境状态（已在本变更涉及的文件上跑过 `prettier --write`）。**已知无关失败：** 同上 4 条 EPERM。本条目**不**宣称 D15 画布、D16 自定义 Team 写面、D17 对话生成、D18 双执行模式或任何 M7/M8 能力已实现。

---

## 2026-09-11（Asia/Taipei）桌面 Daemon 源码启动修复（「无法安全连接」根因）

- **决定：** 只修已被实测坐实的启动链缺陷，不改任何冻结规则、协议或公共契约。现象：用户用 `start.cmd` / `pnpm --filter @workforce/desktop dev` 启动后窗口显示「无法安全连接 / `Daemon state file was not replaced after spawn.`」。根因：`apps/daemon/dist/index.js` 不存在时 supervisor 会回退到 Daemon 的 TypeScript 源码入口，而 `apps/desktop/src/main/smoke-env.ts` 给 `.ts` 入口加的只有 `--experimental-strip-types`（strip-only 只删类型）。Daemon 依赖图使用了参数属性（`apps/daemon/src/modules/errors.ts`、`apps/daemon/src/composition/{persist,policy}.ts`、`packages/database/*` 等），节点在 import 阶段就抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` 退出，从不执行 `writePublicState`，因此 `daemon.json` 永远不会出现；supervisor 等满 `DEFAULT_SPAWN_WAIT_MS`（8s）后把「没换状态文件」当成错误上报，UI 按 `packages/ui/src/banners.ts` 的映射渲染成「无法安全连接」。修复：改用 `--experimental-transform-types`（完整类型转换，需 Node ≥ 22.7，`.nvmrc` 与 CI 的 `node-version: 22` 解析到最新 22.x），并新增真实启动回归测试（实际 spawn 源码入口 → 轮询 `daemon.json` → 断言 `/health`），因为原有 `smoke-env.test.ts` 只断言 flag 字符串、发现不了该缺陷。**未改**：Daemon 协议/状态机/公共 DTO、supervisor 的重连与防双开策略、`stdio: "ignore"`（Daemon 崩溃 stderr 仍不进桌面日志，登记为遗留可观测性缺口）。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) §3 新增第 8 条（启动链修复切片与负向证据）、§6「如何跑」修正 Daemon 单跑命令（原命令同时缺 `--import` 且用 strip-only 模式，实测起不来）、并追加本轮修订说明。**未改** decision-register、state-matrix、api-capability-matrix、02-development-task-backlog 的任何结论，也未改根 lockfile 或 Protocol。
- **状态：** **implemented**（启动链修复 + 回归测试）。改动文件：`apps/desktop/src/main/smoke-env.ts`、`apps/desktop/tests/smoke-env.test.ts`、`apps/desktop/tests/daemon-source-launch.test.ts`（新增）、`docs/planning/03-implementation-status.md`、本文件。验证（Windows，Node v24.19.0，pnpm 9.4.0）：`pnpm exec vitest run apps/desktop/tests/daemon-source-launch.test.ts apps/desktop/tests/smoke-env.test.ts apps/desktop/tests/supervisor.test.ts` → 3 files / 12 tests 通过；把 flag 临时改回 `--experimental-strip-types` 重跑 `daemon-source-launch.test.ts` → 失败并在断言消息中给出真实 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` 日志（证明该测试是有效回归闸门）；用真实 `createSupervisorDeps`（已编译 `dist/main`）跑守卫级 E2E → `ensureDaemon` 返回 `{"ok":true,"mode":"spawn","snapshot":{"status":"online",...}}` 且 `GET /health` 200；手工 `node --import ./tooling/scripts/register-ts-esm.mjs --experimental-transform-types apps/daemon/src/index.ts --state-dir <tmp>` → 写出 `daemon.json`；`pnpm --filter @workforce/desktop typecheck` 与 `pnpm check:docs`（52 个 Markdown 文件）均退出 0。**未运行：** 全量 `pnpm test`、`pnpm build`、`pnpm lint`；真窗口点击仍是人工项，且本机当时存在一个 22:33 启动、持有 Electron 单实例锁的**修复前**旧实例，需关窗后重跑脚本。**既有缺陷（本轮未修）：** `apps/desktop/scripts/smoke.mjs` 在 Windows 上直接 spawn `node_modules/.bin/tsc`（缺 `.cmd`）而 ENOENT（`dev.mjs` 有 `resolveBin` 处理，smoke 没有）；Daemon 崩溃日志被 `supervisor` 的 `stdio: "ignore"` 吞掉。**验证环境说明：** 本次验证时该 checkout 还存在另一名工作者未提交的 `packages/domain` / `packages/protocol`（`ExecutionSnapshotId`、`dto.ts`、`execution-snapshot.ts`）在途改动，本条目未触碰它们（验证前后 md5 未变），因此未做全仓运行。

---

## 2026-09-11（Asia/Taipei）C5–C9 按推荐默认全批并落入 protocol

- **决定：** 按 [06-t02-contract-request-c5-c9.md](06-t02-contract-request-c5-c9.md) 的推荐默认全批，并做一处更优修正：HTTP `RunDto` 的三轴在 Application 写入方落地前保持**可选**，禁止填假 `workflow_bound`。其余：`POST /tasks/{id}/runs` 为 HTTP 落点但本切片不实现该路由；`StartRunRequest` 不动；`ProjectDto`/`RunDto`/`TeamDto` 迁入 `packages/protocol`；快照公共 DTO 不含 policy/budget；`ExecutionSnapshotId` + `SnapshotRef` 别名 + `snp_`；`PlacementSnapshot` 无 `mode`，Host 不再平行维护一套 binding 形状；`RuntimeHandle` 增加可选 node 字段；`transport` 类型以 protocol 为唯一声明，Profile 列留给 T04。
- **文档影响：** 本请求页改为 `status: current` 并写「已裁决」；补手写 `run.schema.json` 与 `project-execution-snapshot.schema.json`；蓝图 07 §18 去掉 snapshot 上的 `mode`，§7 标明内部 Ports 请求 ≠ protocol `StartRunRequest`；本文件追加本条。
- **状态：** 契约层 **implemented**（protocol/domain/spi/sdk 再导出）。HTTP 启动路由、confirmPlan 拆分、Profile `transport` 列、capabilities mode 维度、Run 响应必填 **仍 planned**。

---

## 2026-09-11（Asia/Taipei）桌面壳：折叠轨品牌标与切页空白

- **决定：** 启动后的壳缺陷按可见行为收口，不改产品对象或协议。(1) 折叠后的 56px 图标轨只保留品牌标，悬停/聚焦变为展开，禁止 Logo 与折叠按钮并排；(2) 页标题与说明只出现在顶栏，壳内 `Page` 不再重复 h1；(3) 特性页必须作为 React 元素挂载，禁止把 `Page()` 当函数调用，避免切左侧菜单时 hooks 数量变化把整棵树打成空白。
- **文档影响：** [UI 设计系统](../product-ui/04-design-system.md) §2.4 / §3 补折叠轨与顶栏标题规则。**未改** decision-register、state-matrix、api-capability-matrix、任务清单结论。
- **状态：** **implemented**（展示层）。真窗口点击仍为人工项。

---

## 2026-09-12（Asia/Taipei）T04 运行快照 SQLite 投影切片

- **决定：** D18 的历史兼容阶段只增加可空、严格校验的 SQLite 投影能力：完整 `RunExecutionSnapshot` 在明确传入时原子持久化并跨重启读回；历史 M3 Run 不回填、不猜测执行事实。`undefined` 是唯一允许的“未提供”，`null` 等其它伪值一律拒绝。生产编排、direct 调度、backfill/switch/contract 不因此视为完成。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 的修订、D17/D18 前置说明及 T04/T16 状态行，区分已验证 repository 投影能力与未接线的生产语义。
- **状态：** **implemented**（migration 007、Repository/world snapshot、定向 30/30 数据库测试、跨包 typecheck、独立审查）；生产运行快照组装/接线、D02、direct、升级回填与收紧约束仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）D15/D02 前置审计与补缺任务登记

- **决定：** 不把 `:confirm-plan` / `:start` 的拆分伪装成局部状态修改。当前执行图来自请求体 `mockPlanGraph()`，而 SQLite 的 `workflow_versions` 只由 `WorkflowInstance` 持久化时隐式 upsert；直接取消确认阶段的实例创建会使 `ProjectExecutionSnapshot` 缺失其必须引用的已发布版本。先以 `T04-D15-PUBLISH` 收口不可变执行图源，再实施 `T09-D02-SNAPSHOT-START`。同时登记协议图源、Run wire、持久事件补拉、Evaluation/保留、远程 Node 兼容实验、Daemon 崩溃诊断和三平台 smoke 等独立缺口。
- **文档影响：** [02-development-task-backlog.md](02-development-task-backlog.md) 新增 3.1 的受限子任务表；不改变任何已冻结状态机、API 或任务 owner。
- **状态：** 任务发现与边界澄清 **implemented**；全部新增子任务均为 **planned**。T04 运行快照投影保持已实现，D15/D02 产品行为与其余 release gate 不因此视为完成。

---

## 2026-09-12（Asia/Taipei）T11 Daemon 启动 stderr 方案撤回

- **决定：** 拒绝 `T11-DAEMON-CRASH-OBSERVABILITY` 的 Desktop stderr-pipe 实现。虽然它只提取白名单错误码，但 supervisor 在完成启动观察后关闭父端 pipe，成功的 detached Daemon 随后写 stderr 会收到 EPIPE 并可能退出，破坏后台生命周期。恢复 `stdio: "ignore"`；Daemon 崩溃和端口冲突必须等 T10 所有权范围内的结构化、Daemon-owned sidecar/state 通道，不能把 raw stderr pipe 变成常驻依赖。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 更正为仅记录已验证的 Node preflight，不再把 stderr 摘要或端口冲突提示记为完成；任务清单的 T11 子任务名称与边界不变。
- **状态：** stderr 方案 **rejected / removed**；T11 崩溃诊断仍为 **planned**。恢复验证将在本轮最终 T11 测试中执行。

---

## 2026-09-12（Asia/Taipei）T08 受管测试命令终态前置审计

- **决定：** 不在 ArtifactEvaluator 内创建与 `ProcessController` 不兼容的私有退出码接口。规范 port 的普通 `inspect()` 只有 liveness/identity；`spawnCaptured().wait()` 才有 `{ exitCode, signal }`，但 Windows 当前明确不支持 captured process。故将跨平台终态、timeout/cancel、bounded-output 与 fail-closed 行为登记为 `T06-PROCESS-TERMINAL-OUTCOME`（T02/T06 顺序交接），它是 T08 command criterion 真实验收的前置。
- **文档影响：** [02-development-task-backlog.md](02-development-task-backlog.md) 的补缺子任务表新增 T06 Process terminal outcome；[03-implementation-status.md](03-implementation-status.md) 明确 T08 不能以 fake adapter 或 `inspect()` 扩展宣称阻断失败测试。
- **状态：** 诊断与任务登记 **implemented**；`T06-PROCESS-TERMINAL-OUTCOME`、T08 M5 Evaluation/retention 和 T09 完成判定接线均为 **planned**。审查发现的实验性 T08 代码已撤回；恢复验证 `pnpm exec vitest run packages/artifacts/src/evaluation/evaluator.test.ts`（6 tests）与 `pnpm --filter @workforce/artifacts typecheck` 均退出 0。

---

## 2026-09-12（Asia/Taipei）T11 源码入口 Node 预检

- **决定：** 把已知的 `--experimental-transform-types` 最低版本要求变为 Supervisor 的 spawn 前检查：仅 TypeScript 源码入口要求 Node ≥22.7，已有可重连 Daemon 与分发 JS 入口不受影响。不引入日志持久化、stderr pipe 或新公共协议。
- **文档影响：** [03-implementation-status.md](03-implementation-status.md) 的 T11 启动链记录改为反映版本 preflight、撤回的 stderr 方案及更新后的验证范围。
- **状态：** **implemented**（T11 源码入口版本 preflight）。改动文件：`apps/desktop/src/main/{smoke-env,supervisor-runtime}.ts`、`apps/desktop/src/main/daemon-supervisor/{types,supervisor}.ts`、`apps/desktop/tests/{smoke-env,supervisor}.test.ts`、[03-implementation-status.md](03-implementation-status.md)、本文件。恢复验证（Windows，Node v24.19.0，pnpm 9.4.0）：`pnpm exec vitest run apps/desktop/tests/smoke-env.test.ts apps/desktop/tests/supervisor.test.ts apps/desktop/tests/app-lifecycle.test.ts apps/desktop/tests/daemon-source-launch.test.ts apps/desktop/tests/smoke-script.test.ts` → 5 files / 23 tests 通过；`pnpm --filter @workforce/desktop typecheck` 退出 0。Daemon 崩溃/端口冲突的结构化诊断、运行期日志、诊断导出和三平台真机仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）T06 受管进程终态契约拆分

- **决定：** 保留唯一的 `@workforce/application/ports` `ProcessController`：不向 `inspect()` 加历史退出码，也不创建 Artifact 私有 CommandRunner。把 `T02-PROCESS-TERMINAL-CONTRACT` 从 T06 实现中拆出，先定义 `CapturedProcess.wait()` 的树级终态、signal 正规化、timeout/overflow/cancel 与 capability 语义；T06 后续实现 POSIX 进程组收敛和 Windows Job-only capture，T08 最后消费可信结论。Windows capture 失败必须 fail closed，不能退化普通 spawn/taskkill。
- **文档影响：** [02-development-task-backlog.md](02-development-task-backlog.md) 增加 T02 Process terminal contract 并把 T06 的依赖改为显式顺序；[03-implementation-status.md](03-implementation-status.md) 同步实际前置与未实现边界。
- **状态：** 设计与任务拆分 **implemented**；T02 契约、T06 adapter、T08 Evaluation 接线、三平台验证均为 **planned**。本条不修改 Process SPI 或 Windows helper，也不宣称任何平台的 captured process 新增支持。

---

## 2026-09-12（Asia/Taipei）T02 Process 终态契约范围确认

- **决定：** 不以文档或 fake test 把根进程 `close` 误称为受管树终态。T02 将以破坏性 API 升级为 `CapturedSpawnRequest` 增加可验证 timeout 语义、`ProcessExitResult` 增加稳定 `reason` 并将 signal 限制为跨平台枚举；`wait()` 仅在同一受管树已收敛时 resolve，无法证明收敛时稳定 fail closed。`inspect()` 继续只表示 liveness/identity。Windows capture 在可信 Job capture 实现前继续 unsupported。
- **文档影响：** [02-development-task-backlog.md](02-development-task-backlog.md) 的 T02 Process terminal contract 写入具体升级形状；[03-implementation-status.md](03-implementation-status.md) 更正现有 wait 的证据边界。
- **状态：** 契约设计 **implemented**；公共类型、T06 adapter、T08 消费和跨平台证据均为 **planned**。该决定是后续兼容性变更的前置，不把已有 POSIX root exit 或 Windows unsupported 当成完整终态实现。

---

## 2026-09-12（Asia/Taipei）T03 Remote Node Mock 兼容性证据

- **决定：** 用现有 `LocalNodeHost` / `MockRuntimeAdapter` 做一个受限的 synthetic remote-node 回归场景：Host 只接受其配置的远程节点 ID，完整保留 placement binding；同一 store 上的 replacement Host 获得更高 fencing token 后把旧 binding 视为 unattached，拒绝它的 input，且其迟到事件仅 audit-only、不得经 event、inspect 或 reconcile 推进已存 Runtime 状态。该验证不新建 Domain/Task/Event/API 字段，也不把 placement 误写成 `remote` runtime transport；它没有实现 stale binding 的 rebind 或继续执行。
- **文档影响：** 新增 [Remote Node Mock compatibility spike](../spikes/remote-node-compatibility.md)，并在 [spikes 索引](../spikes/README.md)、[文档索引](../README.md) 与 [实现进度](03-implementation-status.md) 登记受限证据。
- **状态：** **implemented（in-process Mock compatibility only）**；Windows 自动化测试 `pnpm exec vitest run runtimes/mock/src/host-scenarios.test.ts` 已通过（12 tests），并完成 Mock/Runtime SDK typecheck 与文档校验。真实远程进程/网络、enrollment、heartbeat、分布式 lease、Daemon/Application 选择路径和 macOS/Linux 实机仍为 **planned / untested**。

---

## 2026-09-12（Asia/Taipei）T02 Process 终态契约裁决

- **决定：** 撤回「`CapturedSpawnRequest.timeoutMs`、`ProcessExitResult.reason`、有限 signal」方案。Process 层不能从 force cancel 判断用户取消、deadline、预算停止或 output 策略，也不应把原生 signal 截断成业务枚举。`wait()` 只在 root exit、output EOF 和受管树收敛均已验证时返回原生 `{ exitCode, signal }`；无法安全得出该结果时，以稳定 `ProcessControllerError` fail closed。timeout/cancel 的业务归因仍由 Application/Workflow 记录并在完成 graceful/force 后等待 `wait()`。
- **文档影响：** [公共 ports](../protocols/v0.1/ports.md)、[开发任务清单](02-development-task-backlog.md) 与 [实现进度](03-implementation-status.md) 同步唯一语义；`packages/application/src/ports/index.ts` 导出稳定错误类型。后续 T06 实现、T08/T15 消费者迁移和平台证据仍需分别完成。
- **状态：** **implemented（T02 public contract slice）**；不宣称受管树收敛、Windows Job capture、Evaluation command criterion 或 Codex 终态时序已经实现。

---

## 2026-09-12（Asia/Taipei）T02 契约审查收口与 T11 状态更正

- **决定：** 稳定 `ProcessControllerError` 还必须覆盖 stdin、stdout/stderr 和 root wait 的 I/O 失败，避免 T06 泄露运行时原始异常或把它误报为 overflow。同步撤回实现进度表中残留的 T11 stderr pipe/启动错误摘要描述：目前唯一已实现的 T11 新切片是 TypeScript 源码入口 Node ≥22.7 preflight。
- **文档影响：** [公共 ports](../protocols/v0.1/ports.md) 与 `packages/application/src/ports/index.ts` 增加 `process_input_failed`、`process_output_failed`、`process_wait_failed`；[实现进度](03-implementation-status.md) 的 T11 行与已撤回 stderr 方案一致。
- **状态：** **implemented（契约/状态更正）**；T06 尚未将上述错误映射到 OS I/O，T11 崩溃和端口冲突诊断仍 **planned**。

---

## 2026-09-12（Asia/Taipei）T06 POSIX captured-process 可信终态切片

- **决定：** 在唯一 `ProcessController` 内实现 POSIX captured process 的可信 `wait()`：仅 root `close`、stdout/stderr 的真实 `end`（不是仅 `close`）以及受管 session/process group 经内核存在性检查确认终结后，才返回原生 `{ exitCode, signal }`。流溢出、消费者在 EOF 前停止、截断关闭、stdin/stdout/stderr/root I/O、取消失败和树不可验证均返回稳定 `ProcessControllerError`，不伪造正常终态。timeout、用户取消与预算归因仍留在 Application/Workflow。
- **文档影响：** [实现进度](03-implementation-status.md) 将 T06 从笼统的“完成库”更正为本次 POSIX 实现切片，并明确 Windows capture 与跨平台真机证据仍未完成。任务清单与公共 ports 的既有契约保持不变。
- **状态：** **implemented（POSIX source slice，平台证据受限）**。验证（Windows，Node v24.19.0，pnpm 9.4.0）：`pnpm --filter @workforce/application typecheck`、`pnpm --filter @workforce/process typecheck` 均退出 0；`pnpm --filter @workforce/process exec vitest run` 为 4 files / 21 passed / 18 skipped；`pnpm exec prettier --check`（6 个 T06 文件）与 `git diff --check` 通过。POSIX 受管进程组终态用例在当前 Windows 环境跳过，macOS/Linux 实机验证、Windows Job Object stream capture，以及 T08/T15 对此 port 的消费仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）补缺任务第二轮发现

- **决定：** 不以新的平行 T 卡稀释所有权；将从当前落地方案、状态页和源码交叉确认的缺口归入既有 owner：T09 的 canonical DAG dependency 持久化与 placement/lease 接线，T04 的 SQLite/world 投影对账，T02 的 protocol JSON Schema 生成/漂移门禁，T11 的 Renderer typed client 唯一化。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) §3.1 新增 `T09-DAG-DEPENDENCY-PERSISTENCE`、`T04-PROJECTION-RECONCILIATION`、`T02-PROTOCOL-SCHEMA-GENERATION`、`T11-RENDERER-CLIENT-CANONICALIZATION` 与 `T09-PLACEMENT-LEASE-WIRING`，并写入依赖和验收边界。
- **状态：** **planned**。本条只登记已由源码/文档证据确认的工作，不宣称 DAG、投影对账、schema codegen、client 收口或 lease 生命周期已实现。

---

## 2026-09-12（Asia/Taipei）T04 历史执行轴迁移审计分类

- **决定：** 在自动 backfill 前先交付安全的 `008_execution_axis_migration_audit`。它只读 `runs`，并在与未来 Run 表重建解耦的 append-only ledger 中记录分类；任何 DB 轴列、placement、sidecar 或外部 evidence 只允许字段存在性和 SHA-256 摘要入账，绝不复制原文。未验证精确 Project、transport 与 placement 关系时，外部 evidence 只能是 `repair_required`，不得生成 `eligible`；quarantine 以稳定 origin 摘要保持隔离，旧 source 重现不得静默提升。
- **文档影响：** [数据库蓝图](../blueprint/10-database-schema.md)、[D17/D18 落地计划](05-d17-d18-landing-plan.md) 与 [实现进度](03-implementation-status.md) 同步为“审计分类已实现，backfill/switch/contract 未实现”。
- **状态：** **implemented（audit-only slice）**。独立审查通过；`pnpm exec vitest run packages/database/src/execution-axis-migration.test.ts packages/database/src/persistence.test.ts` 为 29 passed，`pnpm --filter @workforce/database typecheck`、Prettier 与 `git diff --check` 通过。未修改 Run，不创建 ProjectExecutionSnapshot；真实 current-M3 upgrade fixture、回填、切换、约束收紧仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）T04 投影写入对账与 T02 Schema 漂移门禁

- **决定：** SQLite 投影失败不得再被吞掉或让 `world.json` 超前：所有 raw constraint 与 CAS conflict 均向调用方传播，sidecar 只在 SQLite commit 后发布。当前写入侧切片不自动修复旧 sidecar，也不替代 backfill/switch/contract。协议层以显式、受限的 Zod registry 作为当前 10 个 V0.1 JSON Schema 的唯一生成输入；未登记的协议面不因内部 export 而自动公开，JSON Schema 也不代替 `superRefine` 语义测试。
- **文档影响：** [实现进度](03-implementation-status.md)、[D17/D18 落地计划](05-d17-d18-landing-plan.md) 记录投影 fail-fast 的真实边界；[协议说明](../protocols/README.md) 写明生成/检查命令和手改禁令。
- **状态：** **implemented（T04 写入侧 reconciliation slice；T02 V0.1 Schema generation/check）**。验证：Daemon typecheck；T04 定向 5 个 persistence 测试和取消失败集成用例通过；`pnpm protocol:schema:generate`、`pnpm protocol:schema:check`、protocol typecheck、49 个 protocol 测试及 `pnpm check:docs` 通过。旧 sidecar repair、OpenAPI、未登记 schema、backfill/switch/contract 与 T16 真实升级恢复仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）T09 标准化任务依赖投影

- **决定：** 不再只把 `TaskRecord.dependsOn` 留在 `depends_on_json`。世界快照在插入/更新全部 Task 后，在同一 SQLite 事务同步 `task_dependencies`；这让任意 snapshot 节点顺序均满足依赖外键，也会删除已不属于当前图的旧边。普通 `dependsOn.waitFor` 写为 `required_status`；未定义的 routing/condition/failure/cancel 语义不得凭空映射为 Task prerequisite。
- **文档影响：** [实现进度](03-implementation-status.md) 与 [D17/D18 落地计划](05-d17-d18-landing-plan.md) 将“无生产写入方”更正为已实现的标准化投影，并保留 canonical published graph 图源切换和跨模块验收为未完成。
- **状态：** **implemented（T09 normalized persistence slice）**。`pnpm --filter @workforce/database typecheck` 与 `pnpm exec vitest run packages/database/src/world-snapshot.test.ts`（10 passed）通过。D02 confirm/start 拆分、已发布 graph 作为唯一来源、direct/lease 和 T16 端到端验收仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）T02 canonical graph 与 Authoring ChangeSet 协议

- **决定：** 把 `WorkflowGraphDefinition` 从仅引擎内部的形状提升为画布、作者与发布共用的公开严格有限 DAG；`WorkflowDraft`、`TeamDraft`、结构化 `AuthoringProposal`、`AuthoringChangeSet` 和逐目标 CAS step 同时成为唯一作者态契约。Proposal/ChangeSet 仅承载脱敏摘要和 Artifact 引用，严格拒绝未定义字段；应用 ChangeSet 不代表发布或执行生成的 Workflow。
- **文档影响：** [协议说明](../protocols/README.md) 列出新增的四个版本化 Schema；[实现进度](03-implementation-status.md)、[开发任务清单](02-development-task-backlog.md) 与 [D17/D18 落地计划](05-d17-d18-landing-plan.md) 将协议层完成与 Application/SQLite/Daemon 未接线的边界分开记录。
- **状态：** **implemented（T02 protocol slice）**。`pnpm --filter @workforce/protocol typecheck`、`pnpm protocol:schema:generate`、`pnpm protocol:schema:check` 和协议测试 53 passed 通过。Authoring Task/Run、Runtime 调用、ChangeSet repository、staged apply/recovery、Daemon/Renderer send 仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）T04 D15 不可变执行图版本

- **决定：** `workflow_versions` 的真实执行图以稳定 JSON SHA-256 insert-once 持久化；实例只引用并从版本表读取图，不再能通过 instance 更新改写历史版本。为兼容历史 M3 的 FK 预建行，只有 `sha256:empty` 与 `{}` 的 placeholder 可在首次真实引用时升级一次；一旦为真实版本即不能改变。
- **文档影响：** [开发任务清单](02-development-task-backlog.md)、[实现进度](03-implementation-status.md) 与 [D17/D18 落地计划](05-d17-d18-landing-plan.md) 将 D15 repository 收口与尚未完成的 Application 发布、图源切换、backfill/contract 分开记录。
- **状态：** **implemented（T04 repository slice）**。`pnpm --filter @workforce/database typecheck` 与 `pnpm exec vitest run packages/database/src/entities.test.ts packages/database/src/world-snapshot.test.ts`（17 passed）通过。D02 confirm/start 拆分、Application published-graph 图源、历史回填与 T16 升级恢复验收仍为 **planned**。

---

## 2026-09-12（Asia/Taipei）T09 D02 snapshot/start M3 拆分

- **决定：** confirm-plan 只冻结 `ProjectExecutionSnapshot`，Project 进入 `ready` 时不产生 WorkflowInstance、Node 或 Task；`:start` 从该 snapshot 指向的 canonical graph 创建实例并实例化任务。SQLite/world/Daemon 必须先持久化和恢复 graph，再持久化和恢复 snapshot。
- **文档影响：** [实现进度](03-implementation-status.md)、[开发任务清单](02-development-task-backlog.md) 与 [D17/D18 落地计划](05-d17-d18-landing-plan.md) 更新为 D02 M3 slice 已实现，并明确已发布 catalog 图源、真实 policy snapshot、backfill/contract 和 T16 upgrade 尚未完成。
- **状态：** **implemented（T09 D02 M3 slice）**。Application typecheck、M3 定向 8 passed、Database/Daemon typecheck、SQLite/sidecar 16 passed 与 Daemon HTTP confirm/start 场景通过。当前 policy snapshot 显式为空 M3 事实，不把它写成授权决定；direct 调度不在本切片。

---

## 2026-09-12（Asia/Taipei）T04 authoring 持久化切片

- **决定：** 为已冻结的 WorkflowDraft、TeamDraft 与 AuthoringChangeSet 协议补齐 SQLite repository：草稿仅可按父对象 revision 追加并使用 CAS；ChangeSet 和全部 staged steps 同一事务写入；source Run 必须属于相同 Project/organization；ChangeSet/step status 写入均带当前状态 CAS。Repository 只保障持久化并发语义，不自行解释状态转移、不生成 proposal，亦不把 apply 当作 publish 或执行。
- **文档影响：** [实现进度](03-implementation-status.md)、[开发任务清单](02-development-task-backlog.md) 与 [D17/D18 落地计划](05-d17-d18-landing-plan.md) 将 authoring SQLite 写入从“待实现”更新为持久化切片完成，保留 T20-B Application staged apply/recovery、Runtime proposal 与 Daemon/Renderer send 为未完成。
- **状态：** **implemented（T04 repository slice）**。Windows 实跑 `pnpm --filter @workforce/database typecheck` 通过；`pnpm exec vitest run packages/database/src/authoring.test.ts --reporter=verbose` 为 3 passed。未执行 Runtime、Application authoring、Daemon 或 headed Desktop 验收。

---

## 2026-09-12（Asia/Taipei）T20-B Application staged apply M3 切片

- **决定：** Application 只将已经结构化、处于 `validating` 的 ChangeSet 应用于已有 Workflow/Team Draft。它在写入前校验 Project/organization、source Run、每个 target、全部 revision CAS 和 pending step，成功后一次性写入新 Draft revision、applied step 与 `workflow.authoring.applied` 事件；不发布、不启动生成的 Workflow。首次 Draft 创建继续属于独立草稿路径，因 ChangeSet 的 `expectedRevision` 合法值从 1 开始，不能伪造 revision 0。
- **文档影响：** [实现进度](03-implementation-status.md)、[开发任务清单](02-development-task-backlog.md) 与 [D17/D18 落地计划](05-d17-d18-landing-plan.md) 将 T20-B 从无 Application use case 更新为 Workflow/Team 内存 staged-apply 切片；Runtime proposal、Task patch、SQLite composition/restart、部分失败恢复和 Daemon/Renderer send 仍为未完成。
- **状态：** **implemented（T20-B Application M3 slice）**。Windows 实跑 `pnpm --filter @workforce/application typecheck` 通过；`pnpm exec vitest run packages/application/src/use-cases/authoring/authoring.test.ts --reporter=verbose` 为 2 passed。未执行 SQLite composition、Runtime、Daemon 或 headed Desktop 验收。

---

## 2026-09-12（Asia/Taipei）T20-B authoring 跨重启持久化

- **决定：** 将 WorkflowDraft、TeamDraft、AuthoringChangeSet 接入 `WorldEntitySnapshot`、Daemon `PersistedWorld`、SQLite dual-write 与 `loadComposition`。保存时 Draft 按 revision 排序后 append-only 写入；同 ID 的不同持久化内容拒绝，避免 world snapshot 覆盖不可变草稿或 ChangeSet。ChangeSet 必须等 source Run 已写入，满足外键后再入库。
- **文档影响：** [实现进度](03-implementation-status.md)、[开发任务清单](02-development-task-backlog.md) 与 [D17/D18 落地计划](05-d17-d18-landing-plan.md) 更新 T20-B 的 durable composition/restart 已实现；Runtime proposal、Task patch、部分失败恢复以及 Daemon/Renderer send 保持未完成。
- **状态：** **implemented（T20-B persistence/reload slice）**。Windows 实跑 Database/Daemon typecheck；Database authoring + world snapshot 定向 14 passed；Daemon `persist-snapshot` 为 8 passed，含 `dualWriteSqlite → loadComposition` 跨层恢复。未执行 Runtime 或 headed Desktop 验收。

---

## 2026-09-12（Asia/Taipei）T20-B Authoring Proposal 生命周期

- **决定：** 新增 Application `authoring.start`、Proposal 回调消费和 ChangeSet validate 边界。启动只创建正常治理链中的 Task/Run；Runtime 输出必须是 `AuthoringProposal` 的结构化摘要/Artifact 引用，Application 校验其 source Run 与 Project 后生成 `proposed` ChangeSet，显式 validate 才可变为 `validating`。原始 intent 只作短暂 Runtime 输入，禁止写入 Event、Draft 或 ChangeSet。
- **文档影响：** [实现进度](03-implementation-status.md) 与 [开发任务清单](02-development-task-backlog.md) 将 T20-B 更新为受治理 Proposal 生命周期切片，新增 `T20-B-PROPOSAL-LIFECYCLE`；Runtime 实际输出接口仍归 T05/T15，Task patch、失败恢复与 send 均未完成。
- **状态：** **implemented（T20-B Application Proposal slice）**。Windows 实跑 Application typecheck 与 `packages/application/src/use-cases/authoring/authoring.test.ts` 3 passed。未提供实际 Agent/Runtime 输出实现，未执行 Daemon/Renderer 或 headed Desktop 验收。

---

## 2026-09-12（Asia/Taipei）T05 Authoring Proposal 输出契约任务

- **决定：** Runtime SDK 虽可流式转发通用 `RuntimeEvent`，但当前 Runtime Host/Application 没有可信的结构化 Proposal 输出，Mock 也只产生普通文本消息。新增 `T05-AUTHORING-PROPOSAL-OUTPUT`，要求唯一输出携带 Handle/cursor/fencing 关联、严格 `AuthoringProposal` 与 Artifact 引用，禁止从普通 message 文本推断 Proposal。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) 将该缺口归属 T05/T15；[实现进度](03-implementation-status.md) 明确它是 T20-B 下一依赖，不把 Application 回调入口写成已接 Agent。
- **状态：** **planned**。本条是 Runtime/Host 结构缺口登记，未改 Runtime SPI、Mock、Daemon 或 Renderer。

---

## 2026-09-12（Asia/Taipei）T05 Authoring Proposal Runtime/Mock 输出切片

- **决定：** `runtime.authoring.proposal` 是 Runtime 唯一可携带 Authoring Proposal 的事件；`LocalNodeHost` 必须在 Host Store 写入前用 `parseAuthoringProposal` 丢弃未登记字段，解析失败改记为拒绝事件。Mock 用固定结构化 fixture 覆盖这一边界；普通 `runtime.message` 绝不作为 Proposal 来源。
- **文档影响：** [开发任务清单](02-development-task-backlog.md)、[实现进度](03-implementation-status.md) 与 [D17/D18 落地方案](05-d17-d18-landing-plan.md) 将 T05 标记为 Runtime/Mock 已实现、Daemon Application 消费与 Codex 映射待接线。
- **状态：** **implemented（T05 Runtime/Mock slice）**。Windows 实跑 Runtime SPI/SDK/Mock typecheck 与 Mock Adapter/Host 场景 17 passed；未执行 Daemon/Renderer、Codex 或 headed Desktop 验收。

---

## 2026-09-12（Asia/Taipei）T05 Host-bound Proposal Daemon 消费

- **决定：** Daemon 不信任 Runtime 事件内自报的 Project/Run 归属；它仅接受已被 Host 清洗的结构化字段，再从已绑定 handle 反查持久 Application Run 与 Project，构造幂等 `recordAuthoringProposal` 调用。这个边界禁止普通文本消息或未绑定 handle 产出 ChangeSet。
- **文档影响：** [开发任务清单](02-development-task-backlog.md)、[实现进度](03-implementation-status.md) 与 [D17/D18 落地方案](05-d17-d18-landing-plan.md) 将 T05/T20-B 的 Runtime→Daemon→Application Proposal 链标为已实现；Codex、Task patch、失败恢复和 Renderer send 继续保留未完成状态。
- **状态：** **implemented（T05 Daemon consumer slice）**。Windows 实跑 Daemon typecheck；新增 composition 端到端场景通过，确认 Proposal 落为 `proposed` ChangeSet 且 intent 不进入事件。完整 composition 套件另有一项临时目录 `EPERM` 清理失败，和新增场景无关。

---

## 2026-09-12（Asia/Taipei）T05 Proposal 消费可靠性与边界修复

- **决定：** Proposal consumer 只接受非 audit-only、Host request 明确为 `authoring:proposal` 的已清洗事件；adapter 提供的摘要文本不持久化。未绑定 Run 或回调失败不得吞掉事件，改为重放；启动恢复重新挂 Host watcher。Application 幂等键仍防重复，且 per-event consumer ACK 已写入 `inbox_receipts`，只在 ChangeSet/Event 投影提交后才落库。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) 与 [实现进度](03-implementation-status.md) 增加 fencing、purpose、摘要和重放边界，并记录 ACK 的投影后写入顺序。
- **状态：** **implemented（边界修复）**。Windows 实跑 Runtime SDK/Mock/Daemon typecheck；摘要脱敏、恢复重放/普通 Run 拒绝、端到端 Proposal 消费 3 个定向场景通过。

---

## 2026-09-12（Asia/Taipei）T05 Proposal durable consumer ACK

- **决定：** Proposal 复用 SQLite 既有 `inbox_receipts` 作为 per-event consumer ACK，键为受信 handle 与 Host cursor。ACK 只能在 Authoring ChangeSet/Event 已完成 SQLite 投影后写入；重放先检查 ACK，若投影已存在但尚无 ACK，则以同一 event correlationId 和 ChangeSet subject 确认后补写 ACK。不得仅按 Proposal ID 判重，避免不同 cursor 的有效 Proposal 被静默吞掉。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) 与 [实现进度](03-implementation-status.md) 将 per-event ACK 从剩余工作转为已实现，并保留 Codex 映射、Task patch、失败恢复和 Renderer send。
- **状态：** **implemented（durable ACK）**。Windows 实跑 Daemon typecheck 和 composition 定向端到端测试，测试直接验证 `inbox_receipts` 已写入 Proposal ACK。

---

## 2026-09-12（Asia/Taipei）T15 Codex Authoring Proposal capability

- **决定：** 现有 Codex JSONL 仅有脱敏的通用 message/command/usage 事件，缺少可验证的结构化 Authoring Proposal item。因此 Adapter 显式声明 `authoring.proposal` unavailable，且 `textInference=false`；不得从 agent 文本、命令输出或 raw metadata 推断 Proposal。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) 与 [实现进度](03-implementation-status.md) 将 Codex Proposal 状态从未明确改为显式 unsupported，Mock/Daemon 是当前唯一已测的 Proposal producer/consumer 链。
- **状态：** **implemented（unsupported capability）**。待 Codex CLI 给出带版本化 schema 的显式 JSONL item 后，再实施真实映射与 live 验证。

---

## 2026-09-12（Asia/Taipei）T20-B Authoring intent 安全交接

- **决定：** `startAuthoring` 当前只用 raw intent 做校验与幂等摘要，随后传给 Runtime 的 `StartRunRequest` 会由 Host Store 持久化，不能直接承载 prompt；现有调用也没有独立的受保护解析通道。因此新增 `T20-B-PROMPT-HANDOFF`：先设计短生命周期、受信引用的 Runtime input 交接与重启 fail-closed 行为，之后才可暴露 send/启动入口。禁止把 intent 偷塞到 `snapshotRef`、handle、Event、ChangeSet 或 command receipt。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) 和 [实现进度](03-implementation-status.md) 明确记录该前置，避免把“已建 Task/Run”误报成 Agent 已收到输入或对话 send 已完成。
- **状态：** **planned**。这次仅登记安全实现任务；没有新增 HTTP/chat endpoint，也没有修改 Runtime 持久化格式。

---

## 2026-09-12（Asia/Taipei）T20 本地作者草稿可见性

- **决定：** `prj_desktop_local` 明确只代表 renderer-only 本地笔记/手工草稿空间，不得被写成 Daemon Project 或 Agent send target。作者页可从 query/hash 读取真实 Project 标识以归属本地会话；已有结构化 proposal 会被展示，但必须标示为「本地结构化预览，非 Agent 输出」。手工落未发布草稿与进入画布路径保持不变。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) 与 [实现进度](03-implementation-status.md) 将 T20 更新为已完成的本地可见性切片，并继续保留 prompt handoff、typed send 和实际 Agent draft 为后续任务。
- **状态：** **implemented（T20 local visibility slice）**。Windows 实跑 workflow-authoring 21/21、Desktop typecheck 和 diff check 通过；未新增 chat HTTP、未运行 headed Electron，也不宣称 Agent/send 或 M7 完成。

---

## 2026-09-12（Asia/Taipei）T20 作者会话项目隔离

- **决定：** 作者页以完整 URL hash 作为挂载边界；切换真实 Project 时重建本地作者会话，hydration 完成前不显示旧消息、Proposal 或已落地卡片，也禁止追加和结构化草稿提交。异步手工落稿仍绑定发起时的原项目会话，不能附着到切换后的项目。
- **文档影响：** [开发任务清单](02-development-task-backlog.md) 与 [实现进度](03-implementation-status.md) 的 T20 本地可见性结论保持不变，并补充其项目隔离实现依据；prompt handoff、typed send 和实际 Agent draft 仍未完成。
- **状态：** **implemented（T20 project isolation fix）**。Windows 实跑 workflow-authoring 22/22、workflow-authoring + workflows 28/28、Desktop typecheck、`pnpm check:docs` 与 `git diff --check` 通过；未运行 headed Electron，不宣称 Agent/send 或 M7 完成。

---

## 2026-09-12（Asia/Taipei）D17 聊天创建工作流主路径

- **决定：** 用户明确要求可发送聊天，并在聊天中创建工作流。V0.1 不提供泛用 Chat API；改用受鉴权、Project-scoped 的 AuthoringSession / Message / Turn 命令。发送必须走 Policy、Budget、Approval、短生命周期 prompt handoff、受治理 Task/Run 和结构化 Proposal；用户确认后才产生未发布 WorkflowDraft，并可跳到画布继续编辑。桌面本地会话只可保留尚未发送的 composer 草稿，不再是权威会话。
- **文档影响：** 协议索引、API/系统蓝图、D17 决策、T20/T20-B 任务清单与实现进度同步为专用 Authoring API 主路径；新增会话/Turn 持久化、受保护内容存储、prompt handoff、确认落草稿和画布深链的后续实现范围。
- **状态：** **implemented（Phase 0 protocol）/ planned（纵向链）**。Phase 0 协议定向测试、类型检查和 29 个受管 schema 门禁已通过；Daemon 持久化/HTTP、Runtime handoff、Application 组合、Renderer、画布和 headed 验收尚需分别验证；不宣称发送聊天或 Agent 生成已可用。

---

## 2026-09-12（Asia/Taipei）T20-B Chat Proposal 确认与 draft 授权切片

- **决定：** Chat Proposal 的确认由 Application 用例在单一事务内完成：严格解析受信 proposal，解析 session/turn/Run 授权后写入 identity、authority、revision 1 draft 与 committed receipt；重放只接受严格解析的 committed receipt，pending/failed 不算成功，key/digest 冲突、跨 scope proof 与 stale CAS 一律拒绝，事件 append 失败回滚全部领域写入并记录诚实失败。SQLite 侧新增 `009_workflow_authoring_scopes`：catalog workflow 必须显式绑定唯一 organization/project 才能被 chat authoring 写入，ChangeSet 状态不授予授权，draft 的 CAS 读取与 append 与授权检查同事务，world snapshot 在 Project 之后、draft 读写之前建立 scope；缺授权的 pre-009 draft fail closed。
- **文档影响：** [实现进度](03-implementation-status.md) 新增两条修订；本文件追加本条。会话/Turn 持久化、受保护 prompt handoff、typed HTTP、Renderer send 与画布深链仍未实现，不宣称聊天发送或 Agent 生成可用。
- **状态：** **implemented（Application confirm-chat 用例、`MIGRATION_009_SQL` 与授权/draft repository 切片）**；验证：`pnpm lint`、`pnpm typecheck` 24/24、`pnpm exec vitest run packages/application`（75 passed）、`pnpm protocol:schema:check`（29 files）、`pnpm check:docs`。**已知缺口：** Daemon composition 尚未持久化/创建 `workflowAuthoringScopes`，`apps/daemon/tests/persist-snapshot.test.ts` 的 authoring 恢复用例失败，待消费者接线。

---

## 2026-09-12（Asia/Taipei）T11 设计系统收口画布/Team

- **决定：** 画布与 Team 写页去掉第二套 inline 皮肤，改组合 T11 共享组件；`features/projects/ui.ts` 不得再持有独立 hex / `--wf-color-*`，只作为作者壳与 orchestration 对 `--wf-*` 的兼容再导出。按需补 Dialog / Dropdown / Tooltip / Toast / Table / Skeleton，不在 features 内新增全局 CSS 变量。作者壳与 orchestration 页面文件本轮不改（T20/T21 稍后）。
- **文档影响：** [UI 设计系统](../product-ui/04-design-system.md) §3/§7 登记复合组件；[实现进度](03-implementation-status.md) 的 T11 行、§3 第 7 条与 §5 第 4 条同步为画布/Team 已组合、第二套色值已删除。
- **状态：** **implemented**（共享层复合组件 + 画布/Team 组合 + ui.ts 再导出）。未跑 Vitest / headed；未改 `workflow-authoring`、`orchestration`、`apps/desktop/src/main`、protocol、Daemon 或测试文件。
