---
title: Workforce 文档索引
type: navigation
status: current
owner: maintainers
updated: 2026-09-13
---

# Workforce Documentation

## Directory plan

```text
docs/
├── architecture/ # Deployment modes and implementation boundaries
├── blueprint/   # Product, architecture and MVP baseline
├── adr/         # Architecture Decision Records
├── guides/      # Development Agent workflows and validation
├── reference/   # Stable capability and tool references
├── protocols/   # Versioned JSON Schemas and protocol specifications
└── operations/  # Development, release, diagnostics and support guides
```

Git does not retain empty directories. `docs/operations/` 现有 T17 打包/升级/卸载文档；`adr` already contains accepted decisions.

## V0.1 Blueprint

1. [Product Vision & PRD](blueprint/01-product-vision-prd.md)
2. [Domain Model](blueprint/02-domain-model.md)
3. [System Architecture](blueprint/03-system-architecture.md)
4. [Repository Structure](blueprint/04-repository-structure.md)
5. [Task Protocol](blueprint/05-task-protocol.md)
6. [Artifact Protocol](blueprint/06-artifact-protocol.md)
7. [Runtime Protocol](blueprint/07-runtime-protocol.md)
8. [Workflow State Machine](blueprint/08-workflow-state-machine.md)
9. [Event Model](blueprint/09-event-model.md)
10. [Database Schema](blueprint/10-database-schema.md)
11. [API Design](blueprint/11-api-design.md)
12. [MVP Implementation Plan](blueprint/12-mvp-implementation-plan.md)

## Planning

- [Decision register](planning/decision-register.md)
- [产品沟通历史](planning/communication-history.md)（只追加；产品/规划文档变更必须回写）
- [Development task backlog](planning/02-development-task-backlog.md)
- [Implementation status (verified)](planning/03-implementation-status.md)
- [Collaboration and review process](planning/04-collab-and-review.md)
- [D15–D18 落地方案（实现前检查点）](planning/05-d17-d18-landing-plan.md)
- [T02 契约变更请求（C5–C9）](planning/06-t02-contract-request-c5-c9.md)

## Development Agent governance

- Repository entry and red lines: [AGENTS.md](../AGENTS.md)
- Named-bot PR pipeline (single source): [Collaboration and review](planning/04-collab-and-review.md)
- Delegation, handoff and independent review: [Agent workflow](guides/agent-workflow.md)
- Test selection and evidence boundaries: [Testing and validation](guides/testing-and-validation.md)
- Reasoning levels and tool evidence: [Agent capabilities and tools](reference/agent-runtime.md)
- Documentation status and checks: [Documentation style and governance](STYLE.md)

## Reference

- [开源对标学习笔记](reference/open-source-benchmarks.md) — Eigent / OpenHands 深读指针；对照冻结决策，不表示将采用这些栈
- [Remote Node Mock compatibility spike](spikes/remote-node-compatibility.md) — in-process protocol evidence only; not a production remote runner

## Operations

- [三平台打包与随包 Daemon](operations/packaging.md) — unpacked packs; `start.cmd` / `dev` are not installers; not a published release
- [升级、备份与恢复](operations/upgrade-backup-restore.md) — 升级前活动 Run 策略为 `reject`；状态目录备份/恢复
- [卸载与数据保留](operations/uninstall-data-retention.md) — 卸载保留 `%APPDATA%\Workforce` 等状态目录

## Document status

All blueprint documents are V0.1 drafts. Protocols and implementation details may change through Architecture Decision Records and reviewed pull requests. Implementation progress is tracked in `docs/planning/03-implementation-status.md`.

## 架构决策与流程图

- [部署模式与边界](architecture/deployment-modes-and-boundaries.md)（Local / Remote Server / Distributed；当前 `apps/daemon` 是本地组合，不是独立 Control Plane）
- [ADR 0001：混合与分布式执行模型](adr/0001-hybrid-distributed-execution.md)
- [架构流程图索引](diagrams/README.md)（含 D17 Authoring、D18 双执行模式；Mermaid 源与蓝图同步）
- [ADR 0002：多节点技术栈与演进边界](adr/0002-multi-node-technology-strategy.md)
- [ADR 0003：V0.1 契约冻结与权威来源](adr/0003-v01-contract-freeze.md)

## Product UI

- [页面信息架构](product-ui/01-information-architecture.md)（§2 一级导航；`P0`/`P1` 是切片深度不是侧栏可见性；项目详情六标签以 §4.3 为准；角色版本库挂 AI 团队；Chat 为壳 §6.4）
- [核心用户流程](product-ui/02-core-user-flows.md)
- [P0 页面线框规范](product-ui/03-p0-wireframes.md)（侧栏与 IA §2 对齐；壳上 Chat；§7 为 M3 只读目录过渡；§10–§12 为 M7 画布、角色库/Team 与全局 Chat；§13 为 M8 双执行模式）
- [UI 设计系统](product-ui/04-design-system.md)（token、字号、圆角、组件与状态规则；含与 AgentHub 的对齐基线与刻意差异）

## 设计评审、冻结决策与开发任务

- [V0.1 设计评审与待冻结决策](planning/01-design-review.md)
- [开发任务清单与 agent 交接模板](planning/02-development-task-backlog.md)
- [实现进度（已验证）](planning/03-implementation-status.md)
- [协作与评审流程](planning/04-collab-and-review.md)
- [D15–D18 落地方案（实现前检查点）](planning/05-d17-d18-landing-plan.md)
- [T02 契约变更请求（C5–C9）](planning/06-t02-contract-request-c5-c9.md)
- [决策登记（项目制主对象；角色版本库与全局 Chat 壳现在就要有；Marketplace 现在不是一等面；M0–M3 已冻结；M7 补齐 Team/Workflow/对话生成；M8 双执行模式）](planning/decision-register.md)
- [产品沟通历史](planning/communication-history.md)
- [状态矩阵](planning/state-matrix.md)
- [页面与 API 能力矩阵](planning/api-capability-matrix.md)

协议草案见 [docs/protocols](protocols/README.md)。打包、升级与卸载见 [operations](operations/packaging.md)。`pnpm check:docs` 对固定根文档（`AGENTS.md`、根 `README.md`、`CONTRIBUTING.md`）与全部 `docs/**/*.md` 做链接/锚点、CommonMark fenced-block 和 Mermaid fenced-block 完整性检查，仅对已迁移 current 文档强制元数据；历史文档不会因一次性迁移而阻塞。评审意见不自动替代已接受 ADR；实现以决策登记与 ADR 0003 为准。
