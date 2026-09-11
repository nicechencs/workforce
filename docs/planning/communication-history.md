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
