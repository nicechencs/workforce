---
title: Workforce MVP Implementation Plan
type: reference
status: current
owner: maintainers
updated: 2026-09-11
---

# Workforce — MVP Implementation Plan

**版本：** V0.1 Draft  
**状态：** Execution baseline  
**日期：** 2026-09-11

## 1. MVP 目标

V0.1 要证明的不是“很多 Agent 可以聊天”，而是一条软件开发工作流能够在 Windows、macOS、Linux 上安全、可观察、可恢复地完成：

```text
创建项目 → 绑定 Git Workspace → 规划任务 → 执行代码修改
→ 运行测试 → 人工审批 → 产出可追踪 Artifact → 项目完成
```

成功标准：用户能够理解每一步由谁执行、使用什么 Runtime、修改了什么、产生什么、消耗多少，以及失败后如何恢复。

## 2. 范围

### 必须交付

- Electron + React 跨平台桌面端
- 独立 Node.js/TypeScript Local Daemon
- SQLite 本地数据与迁移
- Project、Workspace、Team、Worker、Task、Run、Artifact、Event、Approval、Evaluation
- Software Development Team 模板
- 持久化 DAG/状态机 Workflow
- Mock Runtime 与 Codex Runtime Adapter
- Git repository/worktree Workspace
- Run 实时日志与事件流
- 超时、取消、有限重试与启动恢复
- 人工批准、拒绝、要求修改和接管
- 基础 Policy、危险动作确认和 CredentialRef
- Windows、macOS、Linux CI smoke tests

### 不进入 V0.1

- 强制云端账号和多人实时协作
- Marketplace、插件商店、通用 iPaaS 或任意 connector 生态
- 完整 Claude Code Adapter（可做实验，不作为发布门槛）
- Temporal、Go daemon、完整 OS 强沙箱
- 企业 SSO/SCIM、多租户计费
- 自动生产部署、无人审批发布
- 高级长期 Memory、智能成本路由

## 3. 用户主流程

1. 安装并启动 Workforce Desktop。
2. 系统检测本地 Git、Node、Shell、Codex Runtime。
3. 用户新建 Project，选择本地 Git repository。
4. 用户选择 Software Development Team 模板。
5. 用户输入目标和验收条件。
6. Planner 生成 Task DAG；用户确认。
7. Developer 在独立 worktree 中执行。
8. 系统展示事件、命令、文件变化和预算。
9. Reviewer 执行测试与代码检查。
10. 用户批准、要求修改或接管。
11. 系统生成代码变更、测试结果和运行报告 Artifact。

## 4. 交付阶段

### Phase 0 — Blueprint Freeze

**目标：** 冻结 12 份蓝图中的 V0.1 接口。

交付：

- 完成蓝图一致性审查
- 建立关键 ADR
- 将协议示例转为首批 JSON Schema
- 建立术语表和 unresolved decisions 清单

退出条件：Domain、Task、Artifact、Runtime、Workflow、Event 的 ID、状态和版本语义一致。

### Phase 1 — Repository Foundation

**目标：** 可重复构建的 monorepo。

交付：

- pnpm + Turborepo
- TypeScript strict、ESLint、Prettier、Vitest
- Desktop、Daemon 和核心 packages 骨架
- GitHub Actions 基础流水线
- 依赖边界检查

退出条件：全新环境执行 install、lint、typecheck、test、build 成功。

### Phase 2 — Domain & Persistence

**目标：** 核心实体和本地持久化可运行。

交付：

- branded IDs、entities、state transitions
- SQLite/Drizzle schema 和 migrations
- T04 的 D17/D18 migration（expand → backfill → switch → contract）及 T16 的 current-M3 upgrade fixture 作为 planned upgrade gate；仓库已落地 `005_execution_axes_expand` 的 **expand**（5 张新表 + 6 个可空列，无 backfill、无 `NOT NULL`/互斥 CHECK），backfill/switch/contract 与 upgrade fixture 仍未实现
- repository ports 与实现
- append-only Event Store
- 配置版本快照

退出条件：可通过 API 创建 Project/Task/Run，并在重启后恢复。

### Phase 3 — Daemon & Desktop Shell

**目标：** Desktop 安全连接独立 Daemon。

交付：

- Daemon lifecycle、health、local auth
- typed command/query API
- SSE/WebSocket event stream
- Electron main/preload/renderer 边界
- Project 列表、Project 详情和 Run 控制台基础 UI

退出条件：Desktop 重启可重连 Daemon，Renderer 无直接 Node 权限。

### Phase 4 — Workflow & Mock Runtime

**目标：** 不依赖真实 Agent 跑通确定性闭环。

交付：

- DAG validation 和 scheduler
- Task/Run 状态机
- timeout、retry、cancel、approval
- Runtime SPI 与 contract test kit
- Mock Runtime 的成功、失败、等待输入、超时和 Artifact 场景

退出条件：主流程 E2E 可重复通过，Daemon 崩溃恢复测试通过。

### Phase 5 — Workspace & Codex Adapter

**目标：** 真实 Agent 在隔离 Git Workspace 中执行。

交付：

- repository binding 与 worktree provision
- process/PTY controller
- Codex capability discovery、start、stream、cancel、reconcile
- 标准 Runtime Event translation
- 文件变化和 Git diff Artifact

退出条件：Codex 能在示例仓库完成受限代码任务，取消不会遗留失控进程。

### Phase 6 — Evaluation, Approval & Safety

**目标：** 输出不是“Agent 说完成”，而是可验证结果。

交付：

- Artifact integrity、lineage 和生命周期
- test/schema/rule evaluation
- approval queue 与 request changes
- Policy decision 与危险动作 gate
- secret redaction 和预算阈值

退出条件：缺少 Artifact 或测试失败时 Task 不能 completed；危险动作不能绕过审批。

### Phase 7 — Cross-platform Alpha

**目标：** 三平台可安装、运行和诊断。

交付：

- Windows PowerShell/native 路径适配
- macOS arm64/x64 构建
- Linux x64 首发包
- platform integration tests
- diagnostics bundle、崩溃报告和升级策略

退出条件：三平台 smoke flow 通过；已知限制记录清晰。

## 5. 建议里程碑

| 里程碑 | 可演示结果 |
|---|---|
| M0 Blueprint | 12 份一致的可实施规格 |
| M1 Foundation | Desktop 启动并连接 Daemon |
| M2 Local Core | Project/Task/Run 持久化和事件流 |
| M3 Deterministic Workflow | Mock Runtime 完整闭环 |
| M4 Real Coding Run | Codex 修改隔离仓库并产出 diff |
| M5 Governed Alpha | Evaluation、审批、权限、预算生效 |
| M6 Cross-platform Alpha | 三平台安装包和 smoke test |
| M7 Project Authoring | 自定义 TeamVersion、对话生成可编辑 WorkflowDraft、画布发布不可变 WorkflowVersion；未发布图不可执行 |
| M8 Dual Execution | 每个 Agent 可选 `workflow_bound`/`direct`；两模式共享 Task/Run 治理，unsupported 能力启动前拒绝 |

M7/M8 是 V0.1 产品 release gate（不是 M3 Mock 闭环 gate）：M7 必须完成项目制编排作者环，M8 必须完成双执行模式及真实 capability/Policy/Run 证据。T04 migration 必须完成历史 workflow-bound/direct 数据的 snapshot 回填、切换和约束收紧，T16 current-M3 upgrade fixture 必须真实验证升级与 repair/quarantine；两者当前均**未完成**：`005_execution_axes_expand` 只落了 expand，backfill/switch/contract 与 upgrade fixture 仍未实现。未达 M7/M8 时不得宣称产品需求整体完成；M3–M6 可独立演示其已验证切片。仍不在文档中承诺固定日历日期。

## 6. 工作分解

M7 的 D17 后端由 T14 负责 Application authoring use case（proposal/change-set 校验、CAS/staged apply、Policy/Budget/Credential/Event、取消/重试、保留与脱敏）；T20 负责 Renderer 会话面，T18 负责画布。T04 负责 authoring/snapshot migration，T16 负责 current-M3 upgrade fixture 和恢复验收；这些迁移与 fixture 仍**未完成**（仅 `005_execution_axes_expand` 的 expand 已落地：建表与可空列，无 backfill、无约束收紧、无写入方），不能按现有 M3 代码宣称完成。M8 的 D18 由 T02/T09/T10/T21 共同按契约、调度、API、UI 分层负责；T02 已冻结协议三轴枚举与 `runExecutionSnapshotSchema`，但 Run/HTTP/UI 面仍无 mode 字段。具体会话与 mode endpoint 由 T02 冻结前不在本计划发明。

### Epic A：Foundation

- 初始化 monorepo 和工具链
- 建立 package exports 与依赖边界
- 建立 CI matrix
- 建立 ADR、贡献和安全规范

### Epic B：Core Domain

- 实现 ID/value objects
- 实现 Task/Run/Project 状态转换
- 实现配置 snapshot 和 optimistic concurrency
- 实现领域错误和 command result

### Epic C：Persistence & Events

- SQLite schema/migrations
- repositories 和 transaction manager
- Event envelope、sequence 和 subscriptions
- D17/D18 schema upgrade：T04 `005_execution_axes_expand` 已落 expand（新表 + 可空列）；backfill/switch/contract，以及 T16 current-M3 upgrade fixture、repair/quarantine 与恢复演练仍 planned
- retention、redaction 和 diagnostics

### Epic D：Workflow

- DAG validation
- ready queue 和 scheduling lease
- retry/timeout/cancel
- approval/rework/failure propagation
- restart reconciliation

### Epic E：Runtime Platform

- Runtime SPI 和 SDK contract tests
- Mock Runtime
- Codex Adapter
- process tree、PTY、input/output stream
- capability discovery

### Epic F：Workspace

- local directory/repository binding
- worktree lifecycle
- path policy 与 file change capture
- Artifact preservation 与 cleanup

### Epic G：Desktop UX

- onboarding/runtime diagnostics
- project creation
- workflow/task board
- run console/event timeline
- artifact diff/review
- approval controls

### Epic H：Governance

- Policy evaluation
- OS credential store adapter
- budget tracking
- evaluation engine
- approval audit

## 7. 首个垂直切片

第一批开发优先形成最小但真实的纵向能力：

```text
Desktop “Run Demo”
→ Local API create project/task
→ SQLite transaction + event
→ Workflow schedules run
→ Mock Runtime streams output
→ Artifact registered
→ Human approval
→ Task/project completed
```

此切片完成前，不优先建设复杂页面、多个 Runtime 或云端服务。

## 8. 质量门槛

### 每个 PR

- format、lint、typecheck
- affected unit/contract tests
- build 成功
- 协议变更附 schema/fixture/compatibility test
- 数据库变更附 forward migration
- 安全敏感变更附 threat note

### 发布候选

- 主流程 E2E 通过
- 三平台 smoke 通过
- 无 P0/P1 已知缺陷
- 数据库升级与回滚恢复演练通过
- T04 legacy snapshot migration 与 T16 current-M3 upgrade fixture 通过；未通过不得收紧 workflow-bound/direct 约束
- secret scan、依赖扫描通过
- 安装包签名状态明确
- 已知限制和数据备份方式已发布

## 9. 测试策略

| 层级 | 重点 |
|---|---|
| Unit | 状态、不变量、DAG、Policy、翻译器 |
| Contract | Runtime、Store、API、Schema |
| Integration | SQLite、Git、process/PTY、Daemon |
| E2E | Mock Runtime 的完整用户流 |
| Live | Codex 示例任务；独立运行，不阻塞普通 PR |
| Platform | Windows/macOS/Linux 路径、进程、安装 |
| Recovery | crash、orphan Run、重试、Artifact 完整性 |

## 10. 风险与降险

| 风险 | 降险措施 |
|---|---|
| Codex CLI/API 行为变化 | Adapter 隔离、contract fixtures、版本探测 |
| Windows 进程与路径差异 | 早期进入 CI；原生 smoke fixture |
| Agent 破坏用户仓库 | worktree、最小权限、默认不 push、保留 diff |
| 长任务恢复困难 | 先持久化事件与 handle；restart reconcile |
| Scope 过大 | Mock Runtime 垂直切片；严格 V0.1 out-of-scope |
| UI 与执行耦合 | 独立 Daemon 和 typed API |
| Secret 泄漏 | CredentialRef、OS store、统一 redaction |
| “完成”不可验证 | required Artifact + Evaluation + Approval |
| 跨文档协议漂移 | schema-first fixtures 和 blueprint consistency check |

## 11. 关键技术 Spike

建仓后优先用短实验验证：

1. Codex 的非交互启动、流式事件、输入和取消方式。
2. Windows/macOS/Linux 的进程树可靠终止。
3. Git worktree 在异常退出后的恢复和清理。
4. Electron 管理独立 Daemon 的安装、启动和升级。
5. SQLite 同事务状态更新 + Event append 的性能与锁行为。
6. 大量 Runtime output 的背压、分块和 UI 渲染。

Spike 产出 ADR 和可执行 fixture，不直接成为未经整理的产品代码。

## 12. 团队协作建议

初期即使由少量开发者完成，也按以下责任边界组织：

| 责任域 | 所有权 |
|---|---|
| Domain/Protocol | 架构负责人 |
| Daemon/Workflow | Backend/Platform |
| Runtime/Workspace | Systems/Agent Integration |
| Desktop/UI | Desktop Frontend |
| Evaluation/Safety | Platform + Reviewer |
| Release/CI | DevEx |

协议、数据库迁移、权限和 Runtime Adapter 的变更需要额外 review。

## 13. GitHub 初始化时点

12 份蓝图通过一致性检查后立即：

1. 创建私有仓库 `workforce`。
2. 提交蓝图到 `docs/blueprint/`。
3. 初始化 monorepo skeleton。
4. 设置 `dev`（默认分支）保护、PR 模板和 CI。
5. 创建 M1–M6 milestones 与首批 issues。

此时需要关联 GitHub 账号；此前的蓝图工作不依赖 GitHub。

## 14. Go/No-Go 条件

进入编码前必须满足：

- 12 份蓝图无核心术语冲突
- Task、Artifact、Runtime、Event 的 schema 边界明确
- 首个用户流程和 V0.1 不做项已冻结
- Local-first 与 Git Workspace 获得确认
- Codex 作为首个 Runtime 获得确认
- GitHub 仓库可创建或已提供

如果最后两项保持当前默认选择，则无需额外产品决策即可开始初始化代码。

## 15. MVP 完成定义

V0.1 只有在真实用户能够在至少一台 Windows、一台 macOS 和一台 Linux 环境中完成以下动作时才算完成：

- 安装并启动 Workforce
- 绑定一个安全的示例 Git repository
- 创建软件开发 Project
- 运行 Planner/Developer/Reviewer 工作流
- 观察并控制 Run
- 审查代码 diff 和测试结果
- 批准或要求返工
- 在失败或重启后恢复到一致状态
- 导出完整 Artifact 和审计记录

完成后再启动第二条非软件 Workflow，用它验证领域模型的通用性。

## 16. Local Node 兼容性修订

V0.1 保持本地优先，不实现完整远程集群，但必须：

- 将本机建模为默认 ExecutionNode。
- 允许 Local Node 在资源与策略上限内并发执行多个隔离 Run。
- 每个 Run 记录 nodeId、RuntimeInstallation 和 WorkspaceInstance。
- Scheduler 通过 Node/Runtime ports 工作，不直接假设本机进程。
- Mock Node 覆盖容量不足、并发 Run、Lease 失效、节点失联和重复事件。
- Desktop 文案与 UI 不写死 Local Daemon；展示节点、Runtime 与 Run 的实际关系。
- 新增协议兼容性 spike：验证 Local Node 抽象可在不修改 Domain/Task/Event Schema 的情况下替换为远程 Node。

远程节点注册、跨服务器调度、GitHub 自动 PR 协作、Artifact 复制与故障转移仍不属于 V0.1 发布门槛。

## 17. 技术路线结论

本次复核不更换 V0.1 技术栈：

- Electron + React + TypeScript 继续承担跨平台客户端。
- Node.js + TypeScript 继续承担首版本地 Daemon/Local Node。
- Fastify、SQLite、Drizzle、SSE/WebSocket 继续用于本地闭环。
- PostgreSQL 继续作为服务器控制面数据库。
- Go 作为未来独立 Node Agent 的优先候选，但迁移必须由部署、资源占用、并发和进程治理数据驱动。
- Temporal 不进入 V0.1；当多节点长流程、补偿、信号和持久化定时器成为实际负担后再引入。
- Rust 只用于强沙箱与必要的 OS 级组件。

新增架构测试门槛：核心 domain/protocol 包不得依赖 Electron、Fastify、SQLite 或 Node-only 类型；远程 Node Mock 必须能使用生成协议类型完成 start、event、cancel、lease expiry 和 reconcile。
