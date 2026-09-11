# Workforce 项目约定

本文件是所有开发 Agent 的共享入口。它只规定如何在本仓库工作；产品、协议和运行时事实仍以链接的现行文档、源码和测试为准。

## 红线

- 当前日常集成分支是 `dev`，`dev` 同时是仓库**默认分支**：日常开发和集成只发生在 `dev`。从已确认的基线创建短期 `task/*` 分支或独立 worktree；未来发版使用 `release` 分支，不把 `dev` 当发布分支。未经用户明确授权，不 push、不创建 PR、不发布。
- 不让多个 Agent 共用同一个可写 checkout。并行任务的文件范围必须不重叠；公共文件和共享契约只有一个负责人。
- 不绕过 `packages/protocol`、公开 `exports`、Application use case、Runtime SPI、Policy 或 Workspace/Process 边界复制第二套规则。
- 不把 Mock、合成产物、未运行的真实 Runtime 或未验证的平台写成“已完成”。
- 不读取、输出或写入真实 API Key、token、密码和用户私有数据；Task/Artifact/Event 只保存引用或已脱敏内容。
- 不自动 push、创建 PR、强制应用冲突或覆盖用户工作区；这些动作必须符合 Policy，并取得本次任务的明确授权。

## 按任务读取

先读取当前任务命中的最小文档范围，不为形式通读 `docs/`。

| 触发条件                            | 必须读取                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| 选择模型、推理等级或处理工具限制    | [Agent 能力与工具](docs/reference/agent-runtime.md)                    |
| 委派、并行、交接或独立审查          | [Agent 协作指南](docs/guides/agent-workflow.md)                        |
| 开 PR、rebase、书面评审或合入 `dev` | [V0.1 协作与评审](docs/planning/04-collab-and-review.md)               |
| 选择验证命令                        | [测试与验证](docs/guides/testing-and-validation.md)                    |
| 新增或重写文档                      | [文档风格与治理](docs/STYLE.md) 与 [文档索引](docs/README.md)          |
| 修改公共协议、状态或 API            | 对应 `docs/blueprint/`、`docs/protocols/`、ADR、状态矩阵和能力矩阵     |
| 修改 T00–T21 负责范围或共享文件     | [开发任务清单](docs/planning/02-development-task-backlog.md)           |
| 判断当前完成度                      | [实现进度](docs/planning/03-implementation-status.md) 与当前源码、测试 |
| 修改产品或规划文档                  | 同步追加 [产品沟通历史](docs/planning/communication-history.md)        |

必读内容缺失、互相冲突或与代码不一致时，说明差异，只暂停依赖该结论的步骤，不自行补写事实。

## 开工与范围

修改前检查：

```text
git status --short --branch
git rev-parse HEAD
git diff --stat
git diff --cached --stat
```

- 记录目标、验收标准、基线、负责文件和禁止修改范围。
- 已有改动属于当前用户或其他工作者；不得用 reset、checkout 或覆盖文件清理。
- 公共 DTO、Domain、ports、migration、根 lockfile、Daemon composition、Electron preload/路由、Workflow 状态转换和发布配置遵守任务清单中的唯一负责人。
- 公共契约不足时，向负责人提出具体字段、签名、理由和兼容性影响；不得在消费者内复制私有类型或分支规则。

## 协作

- 开始前先判断任务能否拆成至少两个已就绪、互不依赖且文件范围不重叠的子任务；不能则由主 Agent 完成。
- 计划者定义方案和依赖，Developer 修改指定范围，Reviewer 审查固定 diff 或 ArtifactVersion；角色不绑定具体模型。
- 有依赖的实现、整合、审查和验收必须顺序执行。公共文件由指定负责人整合。
- 主 Agent 负责范围、架构决定、敏感操作、结果整合和最终验收；自查不能称为独立审查。
- 交接必须包含基线、实际差异、验证结果、未完成项和环境限制。详细格式见 [Agent 协作指南](docs/guides/agent-workflow.md)。
- 命名 bot 的仓库 PR 管道（Coding / review / PM / Test）与决策红线只写在 [04-collab-and-review.md](docs/planning/04-collab-and-review.md)，此处不重复。

## 改动风险与最小验证

| 级别   | 典型改动                                                   | 最小验证                                           |
| ------ | ---------------------------------------------------------- | -------------------------------------------------- |
| 局部   | 文案、样式、单一纯函数、单文件文档                         | 相关测试或 `pnpm check:docs`；必要时包级 typecheck |
| 模块   | 单个 package/app/runtime 内逻辑                            | 相关 Vitest + 对应 package typecheck               |
| 跨包   | public export、协议、Application port、Daemon/Desktop 边界 | contract/integration 测试 + `pnpm typecheck`       |
| 高风险 | 状态机、持久化、恢复、并发、worktree、进程、Policy、发布   | 明确计划、独立审查、风险对应测试；提交前补完整矩阵 |

风险决定验证强度，不直接决定模型推理等级。日常改动先跑过滤检查；全量 `pnpm test`、`pnpm build` 留给跨包、提交前或 CI。

## 架构边界

- 跨 package 只通过 `@workforce/*` 的公开 `exports` 导入，不使用跨包相对路径或深层内部路径。
- `packages/ui` 和 `apps/desktop/src/renderer` 保持浏览器安全，不导入 Node 内置模块。
- API handler 只调用 Application use case；Runtime Adapter 不直接改变 Task/Run/Workflow 状态。
- Task、Run、ArtifactVersion、Evaluation 和 Approval 是不同对象，不以 Runtime 正常退出代替任务完成。
- 重试创建新 Run，不覆盖旧 Run；取消是请求，必须等待可验证的终态事件。
- Reviewer 和人工审批必须绑定同一最终整合 digest；重新整合后旧审查和审批失效。

## 完成与交付

- 只报告实际修改的文件和实际运行的命令；命令未运行、失败或被环境阻塞时明确说明。
- 不通过削弱断言、伪造 Artifact/Evaluation、静默回退 Mock 或忽略 unsupported capability 宣称完成。
- 交付至少包含：行为结果、改动文件、验证命令与退出结果、未验证的平台/Runtime、遗留风险和下一步。
- 文档变化同步更新索引和 `updated`；提交前运行 `pnpm check:docs`。
- 产品或规划文档（决策登记、能力矩阵、任务清单、实现进度、Product UI）有实质更新时，必须在 [产品沟通历史](docs/planning/communication-history.md) 追加当日（Asia/Taipei）条目：决定 → 文档影响 → 状态（planned / implemented）。
