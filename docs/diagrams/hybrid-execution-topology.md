---
title: Workforce 混合执行拓扑
type: architecture
status: current
owner: maintainers
updated: 2026-09-11
---

# 混合执行拓扑

```mermaid
flowchart TB
  Client[Desktop or Web Client] --> Control[Control Plane]
  Control --> Scheduler[Scheduler and Lease Manager]
  Scheduler --> Local[Local Execution Node]
  Scheduler --> RemoteA[Remote Execution Node A]
  Scheduler --> RemoteB[Remote Execution Node B]
  Local -. placement .-> LTransport[transport: process / sdk / http]
  RemoteA -. placement .-> RTransport[transport: process / sdk / http]
  Local --> L1[Run 1]
  Local --> L2[Run 2]
  RemoteA --> R1[Run 3]
  RemoteB --> R2[Run 4]
```

`placement` 由 ExecutionNode/Workspace/Lease 决定，`transport` 由 Runtime Adapter 描述；两者正交。节点位置不改变 Renderer → Daemon → Application → Ports → Runtime 边界，也不把远程节点写成 Runtime transport。

Project 在执行前绑定唯一 `ProjectExecutionSnapshot`，由 snapshot 提供精确 `WorkflowVersion`/`TeamVersion`；`workflow_bound`/`direct` 两种 `orchestrationMode` 最终都由 Application 创建受治理 Task/Run。direct 永不推进 WorkflowInstance/Project，图中 Node 仅代表实际 placement。
