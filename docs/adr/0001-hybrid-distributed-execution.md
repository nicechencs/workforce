# ADR 0001：混合与分布式执行模型

**状态：** Accepted  
**日期：** 2026-09-10

## 决策

1. 本机和远程服务器统一建模为 ExecutionNode。
2. 一台 Node 可以安装多个 Runtime，并发执行多个隔离 Run。
3. Worker、RuntimeProfile、RuntimeInstallation 与 ExecutionNode 解耦。
4. Control Plane 是 Task、Placement 和 ExecutionLease 的权威来源。
5. 每个非终态 Run 同一时刻只有一个有效 Lease；fencing token 阻止旧节点提交迟到结果。
6. 每个并发 Run 使用独立 WorkspaceInstance、进程树、权限、凭据授权、日志和资源配额。
7. Git/GitHub 用于代码与文档 Artifact 的版本化协作；Task、Event 和结构化 CoordinationMessage 用于信息协作。
8. V0.1 只实现 Local Node，但核心协议不得假设客户端与执行位置相同。
9. 多服务器调度、跨节点 Agent 协作、Artifact 复制和故障转移作为远期能力。

## 理由

该决策保留 Local-first MVP 的实现速度，同时避免领域模型、Runtime 协议、Workspace 和数据库绑定单机拓扑。

## 影响

V0.1 需要增加 Local Node、RuntimeInstallation、WorkspaceInstance 和 node-aware Run 快照；远程 enrollment、heartbeat 和分布式 lease 可以只有契约与 Mock 测试。

## 后续澄清（2026-09-11）

不改写上列 Accepted 条款。产品 Placement kind 现冻结为 `local`（**默认**）/ `remote` / `container`，见 [D19](../planning/decision-register.md#d19-执行-placement本机远程与容器)。本机与远程仍是同一 ExecutionNode 抽象；容器不是第四种机器。V0.1 只实现 Local Node 的条款仍有效；远程与容器是产品能力，不是「V0.1 不做」，也不是控制面/runner 已完成。
