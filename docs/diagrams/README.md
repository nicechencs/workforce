---
title: Workforce 架构流程图索引
type: navigation
status: current
owner: maintainers
updated: 2026-09-11
---

# Workforce 架构流程图

- [混合执行拓扑](hybrid-execution-topology.md)
- [节点调度与执行流程](node-scheduling-flow.md)
- [Git 与信息协作流程](git-coordination-flow.md)
- [D17 Authoring：Proposal → Draft → CAS → Publish](workflow-authoring-flow.md)
- [D18 双执行模式：Bound / Direct 汇合](dual-execution-mode-flow.md)

这些 Mermaid 源文件是可复用的流程索引；蓝图中的内嵌图必须与其保持同一语义。统一术语包括 `WorkflowDraft`、published `WorkflowVersion`、`ProjectExecutionSnapshot`、`TeamVersion`、`ExecutionNode`、`RuntimeInstallation`、`Run`、`WorkspaceInstance`、`ExecutionLease`、`transport`、`placement` 和 `orchestrationMode`。

所有流程都保留 `Renderer → Electron Main → Daemon → Application → Ports → Runtime/Workspace/Policy` 边界。D17 不发明 chat endpoint，D18 不发明 `:direct` endpoint；未发布草稿不得进入 Runtime，direct 仍由 Application 创建受治理 Task/Run。

执行类图统一采用“仅解析 placement intent → Policy/Budget/Approval 授权 → 选择 Node/Runtime → Lease/fencing → WorkspaceInstance → 解析其余 `transport`/`orchestrationMode` 并组装 PlacementSnapshot → 原子创建 Run/snapshot/Event/Outbox → Ports/Runtime”的顺序；retry 重新创建 Run 并沿用已解析模式。direct 在此链路之前只创建 ad-hoc Task，不提前创建 Run。
