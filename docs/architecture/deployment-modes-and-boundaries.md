---
title: 部署模式与边界
type: architecture
status: current
owner: maintainers
updated: 2026-09-12
---

# 部署模式与边界

本页说明 Workforce 的三种部署模式，以及 V0.1 实际组合了什么。它不替代 [系统架构](../blueprint/03-system-architecture.md)、[ADR 0001](../adr/0001-hybrid-distributed-execution.md) 或协议。远程节点、集群通信和 GitHub 协同**未实现**。

## 三种模式

| 模式 | 谁做 Control Plane | 谁跑 Runtime | V0.1 状态 |
| --- | --- | --- | --- |
| Local | 本机进程内的 Application + SQLite | 同一台机器上的 Local Node Host | **当前默认**：`apps/daemon` 把两边组合在一个 loopback 进程里 |
| Remote Server | 独立服务器上的 Control Plane | 一台或多台已注册 Execution Node | 契约与 Placement kind 存在；**没有** enrollment、网络心跳或远程 runner |
| Distributed | 高可用 Control Plane | 多节点调度、容量与故障转移 | 远期；禁止把当前 Daemon 写成这个角色 |

Local、Remote Server 和 Distributed 共用同一套领域对象：`PlacementIntent` 只是偏好，`RunExecutionSnapshot` 才是一次 Run 的不可变绑定，`NodeSession` 是节点在线会话，`ExecutionLease` 是每个 Run 的独立执行权。

## 当前 V0.1 组合

`apps/daemon` 是 **V0.1 本地组合部署**：Desktop 连 loopback Fastify，Daemon 进程内同时装配 Application use case、SQLite、Local Node Host 和 Mock/Codex Adapter。这是为了本机闭环，**不是**未来独立 Control Plane 的雏形，也不得在文档或 API 里自称集群调度器。

解析顺序保持：

1. Workflow Scheduler 只判断 DAG 就绪。
2. Placement Scheduler（当前仅 Local Node）解析 Node、RuntimeInstallation、WorkspaceInstance。
3. 事务内写入 Run、Placement、Lease、Event 和 outbox/receipt。
4. 事务提交后再启动 Runtime；相同 operation 的启动必须幂等，不得第二次 spawn。

同一 Local Node 可以并发多个 Agent；每个 Run 有自己的 `ExecutionLease` 和 fencing token。节点会话替换后，旧 session 上的 lease 不能再推进状态。

## 明确不做

- 不把 Project 上的节点三 ID 当成已解析 Run 绑定；Project 只保留 `PlacementIntent` 或本机默认库存。
- 不实现远程节点、分布式 lease 仲裁、跨节点心跳或 GitHub 协同控制面。
- 不把 Mock 本地流程写成真实 Runtime 或三平台已验证。
