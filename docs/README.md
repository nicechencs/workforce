# Workforce Documentation

## Directory plan

```text
docs/
├── blueprint/   # Product, architecture and MVP baseline
├── adr/         # Architecture Decision Records
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

## Document status

All blueprint documents are V0.1 drafts. Protocols and implementation details may change through Architecture Decision Records and reviewed pull requests.

## 架构决策与流程图

- [ADR 0001：混合与分布式执行模型](adr/0001-hybrid-distributed-execution.md)
- [架构流程图索引](diagrams/README.md)
- [ADR 0002：多节点技术栈与演进边界](adr/0002-multi-node-technology-strategy.md)
- [ADR 0003：V0.1 契约冻结与权威来源](adr/0003-v01-contract-freeze.md)

## Product UI

- [页面信息架构](product-ui/01-information-architecture.md)
- [核心用户流程](product-ui/02-core-user-flows.md)
- [P0 页面线框规范](product-ui/03-p0-wireframes.md)

## 设计评审、冻结决策与开发任务

- [V0.1 设计评审与待冻结决策](planning/01-design-review.md)
- [开发任务清单与 agent 交接模板](planning/02-development-task-backlog.md)
- [决策登记（M0–M3 已冻结）](planning/decision-register.md)
- [状态矩阵](planning/state-matrix.md)
- [页面与 API 能力矩阵](planning/api-capability-matrix.md)

协议草案见 [docs/protocols](protocols/README.md)。`operations` 将在 T17 出现首份真实文件时加入 Git。评审意见不自动替代已接受 ADR；实现以决策登记与 ADR 0003 为准。
