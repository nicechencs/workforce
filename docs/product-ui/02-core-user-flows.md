# Workforce 核心用户流程

**版本：** V0.1 Draft  
**状态：** Product flow baseline  
**日期：** 2026-09-10

## 1. 创建并运行项目

```mermaid
flowchart TD
  Start[新建项目] --> Goal[输入目标与验收条件]
  Goal --> Workspace[绑定 Workspace]
  Workspace --> Team[选择 AI 团队]
  Team --> Plan[Planner 生成 Task 计划]
  Plan --> Confirm{人工确认}
  Confirm -->|修改| Plan
  Confirm -->|通过| Schedule[Scheduler 分配 Worker Runtime 和 Node]
  Schedule --> Execute[并发执行隔离 Run]
  Execute --> Review[Evaluation 与 Reviewer]
  Review --> Approval{人工验收}
  Approval -->|返工| Schedule
  Approval -->|通过| Complete[项目完成]
```

## 2. 单节点多 Agent 调度

```mermaid
flowchart TD
  Ready[Ready Tasks] --> Match[能力与 Runtime 匹配]
  Match --> Capacity{Local Node 有容量?}
  Capacity -->|否| Queue[进入容量队列]
  Queue --> Capacity
  Capacity -->|是| Allocate[分配资源]
  Allocate --> Workspace[创建独立 WorkspaceInstance]
  Workspace --> Runs[启动多个隔离 Run]
  Runs --> Events[事件与 Artifact 入库]
```

约束：

- 同一节点可以并发执行多个 Run。
- 每个 Run 使用独立 worktree/目录/容器、进程树和 PermissionGrant。
- `maxConcurrentRuns` 与资源预算同时生效。
- 容量等待不会消耗 Task attempt。

## 3. 本机与远程节点选择

```mermaid
flowchart TD
  Task[Task Placement Intent] --> Mode{执行位置}
  Mode -->|本机| Local[Local Node]
  Mode -->|指定服务器| Remote[Selected Remote Node]
  Mode -->|自动| Select[能力 容量 数据位置 策略匹配]
  Select --> Local
  Select --> Remote
  Local --> Lease[Create Lease]
  Remote --> Lease
  Lease --> Run[Start Run]
```

V0.1 只实现 Local Node，但界面保留“自动调度 / 本机 / 指定节点”的模型；未实现选项必须清晰标记，而不是伪造可用。

## 4. 人工审批

```mermaid
flowchart TD
  Request[Agent 请求敏感动作] --> Freeze[冻结副作用]
  Freeze --> Explain[展示 Worker Node Resource Impact]
  Explain --> Decision{用户决定}
  Decision -->|批准| Grant[签发最小 PermissionGrant]
  Decision -->|要求修改| Rework[创建返工指令]
  Decision -->|拒绝| Stop[拒绝动作并记录 Event]
  Grant --> Resume[继续当前 Run]
```

审批决定与执行动作分离。重复提交由 Idempotency-Key 收敛。

## 5. 节点断线与恢复

```mermaid
flowchart TD
  Lost[Node heartbeat 丢失] --> Recovering[Run 进入恢复/对账]
  Recovering --> Reachable{节点恢复?}
  Reachable -->|是| Reconcile[校验 Session Lease Handle Cursor]
  Reconcile --> Continue[续接 Event 与执行]
  Reachable -->|否且 Lease 到期| Decide{恢复策略}
  Decide -->|可安全重试| Retry[创建新 Run attempt]
  Decide -->|结果不确定| Human[人工处理]
```

旧节点恢复后，过期 fencing token 对应的结果只能进入审计记录，不能推进 Task 状态。

## 6. Git 与信息协作

```mermaid
flowchart TD
  Planner[Planner] --> Tasks[结构化 Tasks]
  Tasks --> DevA[Developer Run A]
  Tasks --> DevB[Developer Run B]
  DevA --> BranchA[独立 Branch or Patch]
  DevB --> BranchB[独立 Branch or Patch]
  BranchA --> Reviewer[Reviewer]
  BranchB --> Reviewer
  Reviewer --> Merge[人工或 Merge Coordinator]
```

- Git/GitHub 保存代码、文档和版本化 Artifact。
- Task、Event 与 CoordinationMessage 传递状态、请求、反馈和 handoff。
- 消息只传 ArtifactRef，不内嵌大文件。
- 默认禁止 Agent 直接写主分支。
