# ADR 0003：V0.1 契约冻结与权威来源

**状态：** Accepted  
**日期：** 2026-09-10  
**对应任务：** T00

## 决策

1. V0.1 M0–M3 的实现以 `docs/planning/decision-register.md`、`state-matrix.md`、`api-capability-matrix.md` 为最高权威。
2. 可执行 schema 的唯一源在 T02 落地为 `packages/protocol`；生成 JSON Schema、DTO 与 OpenAPI，禁止各包手写分叉类型。
3. Event envelope 采用 Event Model（`specVersion` / `time` / `dataSchema` / `data`）。
4. Task 内容版本与状态 CAS 分离为 `definitionRevision` 与 `stateRevision`。
5. Planner 是受控 Task/Run；用户确认 Plan Artifact 版本后再发布不可变执行 DAG。
6. Run `succeeded` 只表示 Runtime 成功结束；Task 验收是独立 verdict。
7. 幂等收据绑定稳定 principal/client，不绑定短期 session token。
8. SSE 补拉使用全库 `ingestionPosition` 的不透明 cursor。
9. 首版只实现 Local Node；`packages/process` 作为共享进程控制包，由 T06 实现。

## 理由

设计评审 R01–R09 证明蓝图之间存在可导致多 agent 写出不兼容接口的漂移。若不先冻结权威来源与状态/API 矩阵，并行开发会复制类型并锁死错误状态机。

## 影响

- 蓝图示例与正文若冲突，先改实现与测试去就决策登记；蓝图正文整合为 B2。
- T01/T03 可与本文并行：骨架与 spike 不依赖业务字段。
- T02 之后的公共契约变更必须向后兼容或升 major，并由 T02 所有者提交。
- 不修改 ADR 0001/0002 的已接受结论。
