---
title: Agent 协作指南
type: guide
status: current
owner: maintainers
updated: 2026-09-10
---

# Agent 协作指南

本页规定开发 Agent 如何分工、交接和审查。产品运行时的 Task、Run、Artifact、Approval 和 DAG 契约仍以蓝图、协议和代码为准。

命名 bot 的仓库 PR 管道（项目管理 / Coding / review / Test / UI审查）与对照决策登记的 `pass` / `conditional` / `reject` **只写在** [04-collab-and-review.md](../planning/04-collab-and-review.md)。本页的 Planner / Developer / Reviewer 和 `APPROVED` / `CHANGES REQUIRED` 是会话内委派与独立审查，不替代那条 PR 管道。

## 委派与并行

开始任务时先判断是否存在至少两个已经就绪、互不依赖、文件范围不重叠的子任务。满足时才并行；单文件修改、共享契约设计、架构决定、敏感操作和最终验收由主 Agent 负责。

派工必须包含：

```text
目标与验收标准：
仓库、分支、基线和当前差异：
负责文件、writeScopes 与禁止事项：
必读规则和依赖的 ArtifactVersion：
允许的工具、网络、外部动作和预算：
预期输出、验证和停止条件：
```

- Planner 明确方案、依赖和可验证输出；Developer 修改指定范围；Reviewer 审查固定 diff、commit 或 ArtifactVersion。
- 并行 Developer 使用独立分支或 worktree，不共享可写 checkout。
- 公共 DTO、ports、migration、lockfile、composition root、共享路由和状态转换由唯一负责人修改。
- 公共契约不足时，消费者提交具体变更请求，不复制类型或临时分叉协议。
- 不允许递归无界派工。产品工作流遵守 DAG、最大深度、最大 Task 数和 rework 限制。

## 依赖和交付

开发对话中的交接应与 Workforce 产品模型保持一致：下游依赖固定输入和可验证产物，而不是依赖另一位 Agent 的临时上下文。

推荐交接格式：

```text
目标、验收标准与负责范围：
分支、基线、HEAD、未提交差异及归属：
已完成、未完成与关键决定：
产物、commit、diff 或 ArtifactVersion：
验证命令、退出码、结果及环境版本：
下一步、环境限制、未验证能力与审查缺口：
```

- 有代码改动时提供 commit、patch 或可定位 diff；不要依赖另一台机器无法取得的临时文件。
- 上游变化后，只有受影响的结论、审查和验证证据失效；不要无理由重跑全部工作。
- 产品工作流中优先使用 `outputs_ready` 和固定 ArtifactVersion 传递结果。Developer 不等待 Reviewer 完成，Reviewer 不读取仍在变化的共享目录。

## 整合

- 多个 Developer 的结果按稳定节点顺序进入专用 integration worktree。
- 冲突必须停止自动整合并交给人工处理，不能静默覆盖或强制应用。
- 整合后重新运行受影响检查，并生成新的 digest。
- Reviewer、测试结果和人工 Artifact Approval 必须绑定同一最终 digest；重新整合后旧批准失效。
- 未经明确授权，不把结果 push 到远端，不创建 PR，不修改用户目标分支。

## 独立审查

Reviewer 从实际 diff、commit 或固定 ArtifactVersion 开始，检查正确性、回归、边界、失败路径和缺少的测试。返回：

- `APPROVED`；或
- `CHANGES REQUIRED`，每项包含位置、触发条件、影响、证据和建议验证。

自查不能称为独立审查。Reviewer 不应为了形式重复全仓调查；发现具体影响时再扩大范围。审查对象的 digest 或 diff 改变后，受影响的审查结论必须更新。

## 最终验收

主 Agent 汇总实现、独立审查和验证证据，并明确区分：

- 源码或文档确认；
- 自动测试确认；
- Mock 流程确认；
- 真实 Runtime 或本机复现；
- 未验证的平台、能力和外部动作。

运行成功不等于 Task 完成；缺少 required output、Evaluation、Review 或 Approval 时必须保留为未完成项。
