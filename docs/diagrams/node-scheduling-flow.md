# 节点调度与执行流程

```mermaid
flowchart TD
  Task[Ready Task] --> Match[Match Worker Runtime and Capabilities]
  Match --> Capacity[Select Node and Reserve Capacity]
  Capacity --> Lease[Create Execution Lease]
  Lease --> Workspace[Provision Isolated Workspace]
  Workspace --> Start[Start Runtime Handle]
  Start --> Events[Persist Events and Artifacts]
  Events --> Review[Evaluate and Review]
```
