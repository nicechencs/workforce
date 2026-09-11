---
title: D18 Dual Execution Mode Flow
type: architecture
status: current
owner: maintainers
updated: 2026-09-11
---

# D18 双执行模式流程

```mermaid
flowchart TD
  Start[Agent 启动意图] --> Probe[Capability Probe]
  Probe -->|无能力| Reject[禁用/启动前拒绝]
  Probe -->|支持| Choose{orchestrationMode}
  Choose -->|workflow_bound| Bound[已确认 WorkflowVersion / Project Snapshot]
  Choose -->|direct| Direct[当前目标 / ad-hoc]
  Bound --> BoundTask[Application 创建或推进 Task（不创建 Run）]
  Direct --> DirectTask[Application 创建 ad-hoc Task（不创建 Run）]
  BoundTask --> ResolveIntent[仅解析 placement intent]
  DirectTask --> ResolveIntent
  ResolveIntent --> Guard[Policy/Budget/Approval 授权]
  Guard --> Select[选择 Node + RuntimeInstallation + capability]
  Select --> Lease[Lease/fencing]
  Lease --> Workspace[创建 WorkspaceInstance]
  Workspace --> ResolveAxes[解析 transport + orchestrationMode]
  ResolveAxes --> Binding[组装 PlacementSnapshot]
  Binding --> Snapshot[原子创建 Run + 冻结 Snapshot + Event/Outbox]
  Snapshot --> Ports[Application → Ports → Runtime]
  Ports --> Events[Event / Artifact / Evaluation]
  Events --> Retry[retry：保留 mode，创建新 Run]
  Retry --> ResolveIntent
```

两条路径只在 Workflow 调度上分流：direct 仍创建项目内 Task/Run，不绕过治理，永不推进 WorkflowInstance 或 Project。若吸收 direct 产物，必须另发 workflow-bound/follow-up command，显式引用精确 ArtifactVersion 并重新验收；原 direct Run 不推进父聚合。`transport`、`placement`、`orchestrationMode` 是三条正交轴；retry 创建新 Run 并保留模式。流程不对应未冻结的 `:direct` endpoint。
