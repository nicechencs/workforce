---
title: Workforce Product Vision & PRD
type: reference
status: current
owner: maintainers
updated: 2026-09-13
---

# Workforce — Product Vision & PRD

**版本：** V0.1 Draft  
**状态：** Baseline for architecture design  
**日期：** 2026-09-13

## 1. 产品定义

Workforce 是一个通用 AI Workforce 编排平台。用户提交目标，平台将工作拆分为可执行任务，分配给具备不同角色与能力的 AI Worker，在受控 Workspace 中调用合适的 Runtime 与工具，产出可追踪的 Artifact，并通过评估、审批和失败恢复完成闭环。

Workforce 不是单一 Coding Agent。产品**不是**多 Agent 自由聊天的 IM（每个 Worker 一个收件箱、没有项目边界的聊天室），但 **V0.1 必须有全局 Chat 壳**：随时用语言创建角色、创建流程、问进度、交流工作。Chat 是入口，对象仍是 WorkerVersion / Workflow / Task / Run / Artifact。产品是**项目制**：主对象是 Project。围着一个项目，用户从**我的角色版本库**编排 Team（含自定义）、编排 Tasks、编排 Workflow（含可视化画布），再执行与验收。核心产品动作是：

> 围绕一个 Project，把工作交给配好的 Team，按编排好的 Workflow 执行 Task，并验证其 Output。

## 2. 产品愿景

让个人和组织能够像组建、管理真实团队一样，创建、运行、监督和持续优化由 AI Worker 与人类共同组成的数字化团队。

长期目标是成为 AI Workforce Infrastructure：提供统一的任务协议、运行时协议、工作流、权限治理、产物追踪和评估数据，而不绑定某一家模型或 Agent Runtime。

## 3. 目标用户

### V0.1 核心用户

- 使用 Codex、Claude Code 等工具的软件开发者
- 希望让多个 AI 角色协作完成项目的技术团队
- 需要观察、审批和接管 AI 工作过程的项目负责人

### 后续用户

- 研究、内容、数据分析、运营和客户支持团队
- 需要本地部署、权限控制和审计能力的企业
- 构建自定义 Worker、Runtime Adapter 和 Workflow 的平台开发者

## 4. 核心概念

| 对象 | 定义 |
|---|---|
| Organization | 用户、团队、策略、凭据和预算的治理边界 |
| Project | **主对象**。围绕一个目标组织 Team、Task、Workflow、Workspace 与 Artifact |
| Workspace | Worker 实际执行工作的环境与资源集合 |
| Team | 为项目协作的一组 Worker；成员引用已发布 `WorkerVersion` |
| Worker / WorkerVersion | 具备角色、能力、工具、策略和 Runtime 配置的执行者；**发布后不可变**，不适应则 fork |
| 我的角色版本库 | **V0.1 产品面**：找、搜、引用关系、归档；给 Team 选用/fork |
| Chat | **V0.1 就要有的语言壳**（全局入口）；自己不是一等业务对象 |
| Role | Worker 在团队中的职责标签，不是员工身份 |
| Runtime | 实际执行任务的 Agent 或执行环境，如 Codex、Claude Code |
| Workflow | Task 的依赖、路由、审批与失败恢复规则 |
| Task | 平台中最小的可分配、可执行、可验收工作单元 |
| Run | 某个 Task 的一次具体执行记录 |
| Artifact | Run 产生的文件、代码、数据、网页、消息或外部资源 |
| Event | 执行过程中的不可变状态与行为记录 |
| Evaluation | 对 Artifact、Run、Worker 和 Workflow 的质量与效率评价 |
| Approval | 人类或有权限的监督者作出的审批决策 |

## 5. 核心价值主张

1. **统一编排**：用同一种 Task/Artifact/Runtime 协议连接不同 Agent。
2. **真实执行**：Worker 在明确 Workspace 中操作文件、Git、终端和工具。
3. **过程可见**：状态、事件、日志、成本和产物实时可观察。
4. **人机协作**：支持审批、修改、接管、暂停、重试和重新分配。
5. **安全可控**：权限、Credential、预算和 Sandbox 不进入 Prompt 裸奔。
6. **持续优化**：通过 Evaluation 数据比较 Worker、Runtime 和 Workflow。

## 6. V0.1 目标

V0.1 只验证一条可信、可观察、可恢复的端到端闭环：

1. 用户创建软件开发 Project，并关联一个本地或 Git 仓库 Workspace。
2. 用户选择预设 Software Development Team。
3. 系统将目标转化为有依赖关系的 Tasks。
4. Worker 通过至少一个 Runtime Adapter 执行 Task。
5. 系统实时记录 Run Events、日志、文件变化和成本/用量。
6. Worker 输出 Artifact；Reviewer 或人类可以批准、要求修改或接管。
7. 失败任务支持超时、取消和有限次数重试。
8. 项目可以从创建运行到最终完成，并保留完整审计轨迹。

### M7/M8 与 V0.1 release gate

M3–M6 是可独立演示和验收的基础切片；V0.1 产品整体 release gate 还包括 M7 与 M8。M7 必须完成项目制 TeamVersion/WorkflowDraft/画布作者环（含 D17 对话生成后可编辑并发布），M8 必须完成每个 Agent 的 `workflow_bound`/`direct` 双执行及 capability/Policy/Task/Run 证据。未达 M7/M8 时，只能报告已验证的早期切片，不能宣称 V0.1 产品需求全部完成。

### V0.1 首个 Workflow

```text
需求输入
  → Planner 拆分任务
  → Developer 在隔离 Workspace 中实现
  → Reviewer 检查代码与测试
  → Human Approval
  → 生成最终代码 Artifact 与执行报告
```

## 7. V0.1 功能范围

### 必须具备

- 跨平台桌面端：Windows、macOS、Linux
- Project、Workspace、Team、Worker、Task、Run、Artifact、Event 基础模型
- 软件开发团队模板
- 自定义 Team 编排：从**我的角色版本库**选用或 fork 已发布 WorkerVersion，再版本化 Team；不只使用预设
- **我的角色版本库**：WorkerVersion 发布不可变；可搜、筛、引用、归档（M7；**planned**）
- **全局 Chat 壳**：随时可用；用语言创建角色草稿、创建流程、询问进度、交流工作；创建经确认；问进度只读事实；交流挂 `projectId` / 执行中 `runId`（**planned**）
- 轻量 DAG/状态机 Workflow
- 高度可定制的 Workflow 作者环：对话生成可编辑草稿、画布/结构化编辑、校验后发布不可变 WorkflowVersion；未发布图不可执行（M7）
- 每个 Agent 可选择 `workflow_bound` 或 `direct` 执行模式；两者均经过 Task/Run、Policy、Workspace、预算、Approval 与 capability probe（M8）
- Codex Runtime Adapter（首选）
- 第二 Runtime Adapter 的接口预留；是否实现 Claude Code 取决于首轮集成成本
- 本地进程、终端、文件系统与 Git 操作
- 单任务隔离 Workspace；编码任务优先使用 Git worktree
- 实时事件流与运行日志
- Artifact 注册、版本和基础 lineage
- 人类批准、拒绝、要求修改、暂停、取消、重试
- 基础权限策略和命令确认
- Task/Run 级别的时间、重试和用量限制
- 本地数据存储；云端能力保持可插拔

### 明确不做

- **现在不是一等面、未来要做：** Agent/角色 Marketplace（上架/安装别人的已发布版本）。装进来仍进自己的库，再 Team 绑 Project。不要写成永久不做商店。
- Worker IM 收件箱、没有项目边界的聊天室、以 `workerId` 为会话对端
- **聊天当完成**：bot 回复不是验收；问进度不得编造终态。完成只看 Artifact / Run / Approval
- 通用 iPaaS、任意 connector 生态或脱离 Project 的工作流 IDE
- 把未发布画布图当作 Runtime，或把产品做成脱离 Project 的通用 IDE
- 自主无限循环与完全无人值守运行
- 生产环境自动部署
- 企业级 SSO、SCIM、复杂组织管理
- 完整多租户计费系统
- 任意第三方 Runtime 的即插即用生态
- 高级长期 Memory 与跨组织知识图谱
- 移动端
- 一开始就迁移到 Go daemon 或 Temporal

## 8. 长期架构必须预留

- Worker 与 Runtime 解耦
- Runtime capability discovery
- Task、Artifact、Event 和 Runtime 协议版本化
- Cloud Control Plane 与 Headless Worker Node
- Local-only 与企业私有部署模式
- Credential Broker、RBAC、Policy Engine 和 Sandbox
- Workflow checkpoint、resume、fallback、dead-letter 与 replay
- Artifact lineage、评估和可复现运行
- Cost/Budget 分层统计与自动策略
- Schedule、Webhook、Email、Slack、GitHub 等 Trigger
- SDK 与稳定平台 API

## 9. 技术基线

| 层 | V0.1 决策 |
|---|---|
| Desktop | Electron + React + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Local Runtime | Node.js / TypeScript daemon |
| Backend | TypeScript + Fastify |
| Local DB | SQLite |
| Cloud DB | PostgreSQL（云端阶段） |
| Workflow | 自研轻量状态机 |
| Protocol | JSON Schema + JSON-RPC 风格消息 |
| Realtime | WebSocket / SSE |
| Monorepo | pnpm + Turborepo |
| Observability | OpenTelemetry-compatible events |
| CI | GitHub Actions（建仓后启用） |

## 10. 成功指标

V0.1 成功不是功能数量，而是以下闭环可重复运行：

- 新用户在 15 分钟内创建并启动首个 Project
- 一条软件开发 Workflow 能从需求运行到可审查 Artifact
- 每个 Run 都能回答：谁执行、用了什么 Runtime、做了什么、产生什么、耗时多少、为何成功或失败
- 失败后能够安全取消或重试，不破坏原 Workspace
- 人类可以在关键节点审批、要求修改或接管
- 同一套核心抽象能够设计出第二条非软件 Workflow，不需要重写领域模型

## 11. 产品原则

- Task 驱动协作，消息只服务于任务执行
- Artifact 是工作结果的事实来源
- Event Log 是运行历史的事实来源
- 默认最小权限，危险操作需要显式批准
- 运行中配置尽量不可变并保留版本
- 先做可解释、可控制的闭环，再提高自治程度
- 核心协议优先于具体 UI 和具体 Runtime

## 12. 当前待定事项

以下内容在后续蓝图中冻结，不阻塞当前推进：

- 首发是完全本地模式，还是包含最小云端账号与同步
- Codex Adapter 的具体调用边界与身份认证方式
- V0.1 是否同时交付 Claude Code Adapter
- Workspace 的默认隔离等级与各平台差异
- Artifact 文件存储在本地还是同时支持对象存储
- 项目级预算的首版计量口径
- T02 冻结 D17 会话/草稿 DTO 与 D18 执行模式字段前，不在 PRD 发明 endpoint；具体 path 以能力矩阵为准

## 13. 下一阶段交付物

1. Domain Model
2. System Architecture
3. Repository Structure
4. Task & Artifact Protocol
5. Runtime Protocol
6. Workflow State Machine
7. Event Model
8. Database Schema
9. API Contract
10. MVP Implementation Plan

完成以上蓝图并冻结关键接口后，初始化 `workforce` monorepo，关联 GitHub，建立 `dev`（默认分支）分支保护、PR 流程和 GitHub Actions。

## 14. 混合与分布式执行补充

Workforce 的长期产品形态是统一控制本机与远程服务器上的 Agent。客户端负责项目、团队、任务、审批和观测；实际执行由一个或多个 Execution Node 完成。

- 本机与远程服务器使用相同的 Execution Node 抽象。
- 一台 Execution Node 可以安装多个 Runtime，并并发执行多个相互隔离的 Run。
- Worker 是角色配置，Runtime 是执行引擎，Execution Node 是实际机器，三者必须解耦。
- Git/GitHub 用于代码和文档等 Artifact 的版本化协同；Task、Event 和结构化 Message 用于信息协同。
- V0.1 仅实现 Local Node，但核心模型、协议和 UI 不得假设执行一定发生在客户端所在机器。
- 多服务器调度、远程节点注册、故障转移和跨节点 Agent 通信属于后续阶段。
