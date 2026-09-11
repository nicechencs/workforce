# V0.1 协作与评审流程

日期：2026-09-11  
目的：固定**命名 bot** 的仓库 PR 管道，以及对照冻结决策的评审红线。本文不改写决策；冲突以决策登记为准。

通用仓库约定不在此重复：

| 主题 | 权威页 |
|---|---|
| Agent 入口与红线 | [AGENTS.md](../../AGENTS.md) |
| 委派、并行、交接、会话内审查 | [agent-workflow.md](../guides/agent-workflow.md) |
| 验证命令与证据边界 | [testing-and-validation.md](../guides/testing-and-validation.md) |
| 文档风格与 `pnpm check:docs` | [STYLE.md](../STYLE.md) |
| 进度真相 | [03-implementation-status.md](03-implementation-status.md) |
| 产品沟通历史（只追加） | [communication-history.md](communication-history.md) |

权威顺序以 [decision-register.md](decision-register.md) §1 / D01 为准，此处不抄录。不要把 [02-development-task-backlog.md](02-development-task-backlog.md) 里过时的“均未开始”当成现状。

## 1. 角色

命名 bot 的仓库职责只写在本表。会话内 Planner / Developer / Reviewer 见 [agent-workflow.md](../guides/agent-workflow.md)，不与下表混用同一套结论词。

| 角色 | 职责 | 禁止 |
|---|---|---|
| **项目管理-bot** | 排期、边界、领取范围；`main` 的最终合入门禁 | 不写业务代码；不代替 review / headed 验收 |
| **Coding-bot** | 以 Cursor 为主写代码；从最新 `main` rebase；CI 变绿；解决冲突 | **不得自行 merge** 到 `main` |
| **review-bot** | 对照冻结决策做书面 PR 评审：`pass` / `conditional` / `reject` | 不 merge；不做 headed 桌面验收 |
| **Test-bot** | 仅做真实 headed Electron / 桌面点击验收 | 不改代码；不做 PR 代码评审 |
| **UI审查-bot** | UI 包或桌面页面变更时的视觉 / 交互审查 | 不替代 review-bot 的契约评审；不 merge |

## 2. PR 管道

```text
从最新 main 开分支
  → 聚焦 PR
  → CI 绿：format:check、lint、typecheck、test、build、check:docs
  → review-bot 书面评审（对照冻结决策）
  → 项目管理-bot squash merge 进 main
  → 若本 PR 声称桌面主路径可用：Test-bot headed 验收（可选，但声称则必须）
```

- 分支从最新 `main` 拉出；合入前 rebase / 同步。
- Coding-bot 把 CI 修绿并处理冲突后停在待评审；**不自合**。
- 合入 `main` 只用 squash merge，且仅项目管理-bot 执行。
- UI 包 / `apps/desktop` 页面变更时加 UI审查-bot；仅文档或非 UI 包可跳过。
- 本仓库的协作 PR 由人/项目管理-bot 显式发起。

## 3. 评审清单（不得回退）

review-bot 对每个 PR 核对下列**决策登记**红线；任一项回归则 `reject` 或 `conditional`。会话内独立审查结论见 [agent-workflow.md](../guides/agent-workflow.md)，不在此重复。

| 红线 | 对照 |
|---|---|
| 未知成本不得当 0；硬货币上限无法保证时拒绝启动，返回 `unknown_cost_not_enforceable` | D14 / 能力矩阵 |
| Approval 必须绑定 action digest；`plan` 与 `artifact` gate 不得混用 | D02、D11 |
| 持久化实体以 **SQLite** 为权威；`world.json` 只是 sidecar | 进度 T04 / 决策登记 D04 |
| `waiting_review` **只属于 Task**，不属于 Run | D01 / 状态矩阵 |

`pass`：上表未回归，证据与文档一致。  
`conditional`：可合入但必须在说明或后续卡里记下缺口（不得把缺口写成已完成）。  
`reject`：回退冻结决策、越权改包、或用未跑过的能力冒充完成。

## 4. 当前后置（禁止塞进随机 PR）

未单独立项、未由项目管理-bot 领取前，不要在普通 PR 里“顺便做”：

1. **Codex live exec**（T15：Process 已接线；本机无 live `codex exec`。需已安装 CLI 的机器跑授权 `codex exec`）
2. **T17 打包 / 签名 / 三平台发布**
3. **项目制循环上已落地的画布 / 自定义 Team 写接口**（M7 / T18–T19：已在 main。给 Project 编排 Team 与 Workflow，不是外挂。不要在普通 PR 里顺便改 T18 画布文件或 T19 Team 写面）
4. **对话生成工作流 / 双执行模式**（M7–M8 / T20–T21：D17 会话 / 草稿 DTO 已冻结。V0.1 传输已冻结为 Desktop-local / in-process，**无** Daemon chat 资源。T20 仅有作者面壳 + 写 API 落草稿；**发送仍禁用**（`CHAT_SESSION_PROTOCOL_FROZEN=false`），禁止假 Agent 成功或发明 chat path。D18 `orchestrationMode` 已由 T02 冻结在 `StartRunRequest`；T21 **项目启动面已探针 + composed start 透传**，Task 详情不挂未接线控件；M8 调度 / 完整 headed 套件 / 生产 Codex direct **未完成**。不要顺便发明 `:direct` path、假 mode 或假对话成功）
5. **远程控制面 / 容器 runner**（D19：产品能力已冻结；enrollment / Docker / K8s **未实现**。未领取前不要顺便做远程节点或容器调度）
