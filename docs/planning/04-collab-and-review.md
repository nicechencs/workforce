# V0.1 协作与评审流程

日期：2026-09-10  
目的：固定**命名 bot** 的仓库 PR 管道，以及对照冻结决策的评审红线。本文不改写决策；冲突以决策登记为准。

通用仓库约定不在此重复：

| 主题 | 权威页 |
|---|---|
| Agent 入口与红线 | [AGENTS.md](../../AGENTS.md) |
| 委派、并行、交接、会话内审查 | [agent-workflow.md](../guides/agent-workflow.md) |
| 验证命令与证据边界 | [testing-and-validation.md](../guides/testing-and-validation.md) |
| 文档风格与 `pnpm check:docs` | [STYLE.md](../STYLE.md) |
| 进度真相 | [03-implementation-status.md](03-implementation-status.md) |

## 1. 权威顺序

后者不得覆盖前者已冻结的字段语义（与 [decision-register.md](decision-register.md) §1 / D01 一致）：

1. [决策登记](decision-register.md)、[状态矩阵](state-matrix.md)、[API 能力矩阵](api-capability-matrix.md)
2. 已 Accepted 的 ADR（当前以 [ADR 0003](../adr/0003-v01-contract-freeze.md) 为契约冻结）
3. `packages/protocol` 生成的 schema / DTO / OpenAPI
4. 蓝图正文（领域看 `02`，状态机看 `08`，Task 看 `05`，Artifact 看 `06`，Runtime SPI 看 `07`，Event 看 `09`，存储看 `10`，HTTP 看 `11`）
5. Product UI：只约束页面能力，不发明 API 或状态值
6. 架构概览 `03`、仓库结构 `04`、MVP 计划 `12`：**方向文档**，不是实现契约

**进度真相** = [03-implementation-status.md](03-implementation-status.md)。不要把 [02-development-task-backlog.md](02-development-task-backlog.md) 里过时的“均未开始”当成现状；backlog 只保留任务卡与文件所有权。

## 2. 角色

命名 bot 的仓库职责只写在本表。会话内 Planner / Developer / Reviewer 见 [agent-workflow.md](../guides/agent-workflow.md)，不与下表混用同一套结论词。

| 角色 | 职责 | 禁止 |
|---|---|---|
| **项目管理-bot** | 排期、边界、领取范围；`main` 的最终合入门禁 | 不写业务代码；不代替 review / headed 验收 |
| **Coding-bot** | 以 Cursor 为主写代码；从最新 `main` rebase；CI 变绿；解决冲突 | **不得自行 merge** 到 `main` |
| **review-bot** | 对照冻结决策做书面 PR 评审：`pass` / `conditional` / `reject` | 不 merge；不做 headed 桌面验收 |
| **Test-bot** | 仅做真实 headed Electron / 桌面点击验收 | 不改代码；不做 PR 代码评审 |
| **UI审查-bot** | UI 包或桌面页面变更时的视觉 / 交互审查 | 不替代 review-bot 的契约评审；不 merge |

## 3. PR 管道

```text
从最新 main 开分支
  → 聚焦 PR（目录所有权见 README / backlog / 决策登记 §4）
  → CI 绿：format:check、lint、typecheck、test、build
  → review-bot 书面评审（对照冻结决策）
  → 项目管理-bot squash merge 进 main
  → 若本 PR 声称桌面主路径可用：Test-bot headed 验收（可选，但声称则必须）
```

规则：

- 分支从最新 `main` 拉出；合入前 rebase / 同步，不把过期基线当现状。
- Coding-bot 负责把 CI 修绿并处理冲突，然后停在待评审；**不自合**。
- 合入 `main` 只用 squash merge，且仅项目管理-bot 执行。
- UI 包 / `apps/desktop` 页面变更时，加 UI审查-bot；仅文档或非 UI 包可跳过。
- 本仓库的协作 PR 由人/项目管理-bot 显式发起。产品默认不自动 push、不开 GitHub PR（D10，见下表）。

## 4. 评审清单（不得回退）

review-bot 对每个 PR 核对；任一项回归则 `reject` 或 `conditional`（写明必须改什么）。会话内独立审查的 `APPROVED` / `CHANGES REQUIRED` 见 [agent-workflow.md](../guides/agent-workflow.md)，不是本表结论。

| 红线 | 对照 |
|---|---|
| 未知成本不得当 0；硬货币上限无法保证时拒绝启动，返回 `unknown_cost_not_enforceable` | D14 / 能力矩阵 |
| Approval 必须绑定 action digest；`plan` 与 `artifact` gate 不得混用 | D02、D11 |
| 持久化实体以 **SQLite** 为权威；`world.json` 只是 sidecar | 进度 T04 / 决策登记 D04 |
| 产品不得自动开 GitHub PR、不得自动 push 用户目标分支 | D10 |
| `waiting_review` **只属于 Task**，不属于 Run | D01 / 状态矩阵 |
| 不得仅凭 unit / integration 声称 headed Electron 或 Codex live 已完成 | 进度 §1、§3 |
| PR 内文档必须匹配实际证据，禁止超前宣称 | 进度文件权威说明 |
| 不得越权改他人包；契约缺口提变更请求，禁止复制类型 | 决策登记 §4、README 所有权表 |

`pass`：红线未回归，证据与文档一致。  
`conditional`：可合入但必须在说明或后续卡里记下缺口（不得把缺口写成已完成）。  
`reject`：回退冻结决策、越权改包、或用未跑过的能力冒充完成。

## 5. 当前后置（禁止塞进随机 PR）

未单独立项、未由项目管理-bot 领取前，不要在普通 PR 里“顺便做”：

1. **Codex live exec**（T15：探测已有，`start` 仍拒绝；需已安装 CLI 的机器跑授权 `codex exec`）
2. **T17 打包 / 签名 / 三平台发布**
