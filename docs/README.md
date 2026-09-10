---
title: Workforce 文档索引
type: navigation
status: current
owner: maintainers
updated: 2026-09-10
---

# Workforce Documentation

## Directory plan

```text
docs/
├── blueprint/   # Product, architecture and MVP baseline
├── adr/         # Architecture Decision Records
├── guides/      # Development Agent workflows and validation
├── reference/   # Stable capability and tool references
├── protocols/   # Versioned JSON Schemas and protocol specifications
└── operations/  # Development, release, diagnostics and support guides
```

Git does not retain empty directories. The `protocols` and `operations` directories will be added with their first real documents; `adr` already contains accepted decisions.

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
- [Development task backlog](planning/02-development-task-backlog.md)
- [Implementation status (verified)](planning/03-implementation-status.md)
- [Collaboration and review process](planning/04-collab-and-review.md)

## Development Agent governance

- Repository entry and red lines: [AGENTS.md](../AGENTS.md)
- Named-bot PR pipeline (single source): [Collaboration and review](planning/04-collab-and-review.md)
- Delegation, handoff and independent review: [Agent workflow](guides/agent-workflow.md)
- Test selection and evidence boundaries: [Testing and validation](guides/testing-and-validation.md)
- Reasoning levels and tool evidence: [Agent capabilities and tools](reference/agent-runtime.md)
- Documentation status and checks: [Documentation style and governance](STYLE.md)

## Document status

All blueprint documents are V0.1 drafts. Protocols and implementation details may change through Architecture Decision Records and reviewed pull requests. Implementation progress is tracked in `docs/planning/03-implementation-status.md`.

## 架构决策与流程图

- [ADR 0001：混合与分布式执行模型](adr/0001-hybrid-distributed-execution.md)
- [架构流程图索引](diagrams/README.md)
- [ADR 0002：多节点技术栈与演进边界](adr/0002-multi-node-technology-strategy.md)
- [ADR 0003：V0.1 契约冻结与权威来源](adr/0003-v01-contract-freeze.md)

## Product UI

- [页面信息架构](product-ui/01-information-architecture.md)（§2 一级导航；`P0`/`P1` 是切片深度不是侧栏可见性；项目详情六标签以 §4.3 为准）
- [核心用户流程](product-ui/02-core-user-flows.md)
- [P0 页面线框规范](product-ui/03-p0-wireframes.md)（侧栏与 IA §2 对齐；§7 为 P1 只读工作流页）

## 设计评审、冻结决策与开发任务

- [V0.1 设计评审与待冻结决策](planning/01-design-review.md)
- [开发任务清单与 agent 交接模板](planning/02-development-task-backlog.md)
- [实现进度（已验证）](planning/03-implementation-status.md)
- [协作与评审流程](planning/04-collab-and-review.md)
- [决策登记（M0–M3 已冻结）](planning/decision-register.md)
- [状态矩阵](planning/state-matrix.md)
- [页面与 API 能力矩阵](planning/api-capability-matrix.md)

协议草案见 [docs/protocols](protocols/README.md)。`operations` 将在 T17 出现首份真实文件时加入 Git。评审意见不自动替代已接受 ADR；实现以决策登记与 ADR 0003 为准。
