# 混合执行拓扑

产品 Placement kind：`local`（默认）/ `remote` / `container`（[D19](../planning/decision-register.md#d19-执行-placement本机远程与容器)）。下图是拓扑，不是 V0.1 已实现清单。容器 Run 仍画在某个 Node 上，不是第四种机器。V0.1 只实现 Local Node。

```mermaid
flowchart TB
  Client[Desktop or Web Client] --> Control[Control Plane]
  Control --> Scheduler[Scheduler and Lease Manager]
  Scheduler --> Local[Local Execution Node 默认]
  Scheduler --> RemoteA[Remote Execution Node A]
  Scheduler --> RemoteB[Remote Execution Node B]
  Local --> L1[Run 1]
  Local --> L2[Container Run 仍在 Node 上]
  RemoteA --> R1[Run 3]
  RemoteB --> R2[Run 4]
```
