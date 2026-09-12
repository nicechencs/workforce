---
title: Workforce V0.1 API and Capability Matrix
type: reference
status: current
owner: maintainers
updated: 2026-09-12
---

# V0.1 页面与 API 能力矩阵

日期：2026-09-12  
状态：**已冻结（首版按钮与 endpoint；项目制主循环；M7 补齐 Team/Workflow 编排与对话生成；M8 双执行模式 planned）**  
权威：[decision-register.md](decision-register.md) §0、D08、D15、D16、D17、D18。沟通历史：[communication-history.md](communication-history.md)。实现深度以 [03-implementation-status.md](03-implementation-status.md) 为准。  
未实现能力必须在 UI 隐藏或 disabled，并返回明确错误；禁止前端假成功。  
修订：2026-09-12 — catalog 写切片已接通现有 `POST/PATCH /workflows|/teams`、`/versions`、`:publish`（**不是** 下表 `/drafts` path）。`:start` 可带可选 `orchestrationMode`；**不发明** chat 或 `:direct` path。`StartRunRequest` 不加该字段。对话 Agent send 与 `direct` 调度仍未实现。  
修订：2026-09-11 — 主对象是 Project。画布与自定义 Team 从 `later` 迁出，列入 **M7**，作为项目循环（Team → Tasks → Workflow）的必达环节，不是外挂页。只读 `GET /workflows` 是已接通的 M3/P1 过渡目录（不是 Mock 闭环硬依赖，也不是可执行 Runtime）。同日补公开 Task DTO 的 `dependsOn` 与 Artifact 权威存储规则（`LocalArtifactStore`）；未发明可写项目策略或远程 enrollment。同日冻结 D17 对话生成（**M7 planned**）与 D18 双执行模式（**M8 planned**）；**不发明** chat / execution-mode endpoint，待 T02 再写入 path。

**项目制：** 页面与 API 围着 Project。M3 用预设 Team + 只读工作流目录走完 Mock 项目闭环。M7 补齐「给该项目编排 Team / 用画布或对话生成并编辑 Workflow」。M8 补齐「Agent 跟随已发布工作流或直接执行」。M7/M8 **未完成**；部分写 API 与画布壳已有代码，见 03。

图例：

- **M3**：Mock 闭环必须可用
- **M4**：真实 Codex 接入后
- **M5**：治理全链路
- **M7**：补齐项目制循环上的画布、自定义 Team 与对话生成草稿（产品必达；M3 之后领取，见 D15/D16/D17）
- **M8**：按 Agent 双执行模式（workflow-bound / direct；产品必达；见 D18）。**未实现**，不发明 path
- **later**：V0.1 后或不做（**不含**画布、自定义 Team、对话生成、双执行模式）
- **readonly**：可展示，不可改（M3 过渡深度）
- **unsupported**：探测后禁用

## 1. 页面范围

P0 最小切片（M3 必须能走完主路径）：

| 页面 | M3 | 说明 |
|---|---|---|
| 应用壳 / 连接状态 | 必须 | Daemon 健康、重连、版本不兼容错误 |
| 工作台 | 部分 | 待审批、运行中 Run、活跃项目；不做复杂统计 |
| 项目列表 / 创建 / 详情 | 必须 | **主对象**。创建、配置（Workspace / Team / 预算）、规划确认、Task DAG。详情分区见 IA §4.3：配置写入在 Settings，DAG 在 Tasks，项目命令在页头 |
| Task 详情 | 必须 | 依赖、验收、Run 历史 |
| Run 控制台 | 必须 | 时间线、日志、取消、用量（未知成本展示） |
| Artifact 查看 | 必须 | 固定版本 diff/内容/Evaluation |
| 审批卡 | 必须 | plan + artifact；digest/版本/到期 |
| 本机诊断 / Local Node | 必须 | 只读本机节点与 Mock/Codex 探测 |
| AI 团队 | readonly → M7 | 项目循环第一环。M3：只读预设 Software Development Team。M7：为项目自定义编排（创建/版本/发布）。见 D16 |
| 设置 | 部分 | 本机 Runtime 探测、预算展示 |

P1 一级导航（壳上可见。权威：[IA §2](../product-ui/01-information-architecture.md)）：

| 页面 | 阶段 | 说明 |
|---|---|---|
| 运行记录列表 | M3 部分 | IA P1；查询走已有 `GET /runs`。控制台仍走 `GET /runs/{id}` |
| 工作流目录 / 画布 / 对话生成 | M3 readonly → M7 必达 | 项目循环的 Workflow 编排环。M3：只读目录已接通 `GET /workflows`。M7：可视化画布 + 写接口 + 对话生成草稿（D15/D17）。目录不是可执行 Runtime |

M7 必达——补齐项目制循环（当前**未实现**；未领取前不要塞进随机 PR）：

| 页面/动作 | 处理 |
|---|---|
| 可视化工作流画布编辑器 | 为项目编排 Workflow；与只读目录共用「工作流」入口 |
| 对话生成工作流草稿 | M7 planned（D17）。用户对话生成 bot/角色/流程/任务草稿，再进画布编辑。无冻结 chat endpoint；不得假成功 |
| 自定义 Team 编排 | 为项目配团队；M3 只读预设仍必须可用 |

D17 后端 owner：T14 的 Application authoring use case 负责 `AuthoringProposal` / `ChangeSet` 的 schema、Project/Team/Task/Workflow 边界、CAS/staged apply、Policy/Budget/CredentialRef、Event、cancel/retry、retention/redaction；T20 只负责 Renderer 会话面，T18 负责画布。未冻结的会话 DTO 不进入本矩阵的 endpoint 清单。

M8 必达——双执行模式（当前**未实现**；未领取前不要塞进随机 PR）：

| 页面/动作 | 处理 |
|---|---|
| 按 Agent 选择执行模式 | M8 planned（D18）。workflow-bound（跟随已发布 WorkflowVersion）或 direct（绕过该次图、即席执行）。靠 capability probe；无能力则禁用。不发明 `/runs/{id}:direct` |

仍后置或示意（与 D15/D16 无关）：

| 页面/动作 | 处理 |
|---|---|
| 项目归档 | later；无按钮 |
| 远程节点 drain/revoke | later；不得显示在线远程节点 |
| 完整仪表盘图表 | later |
| GitHub PR / push | unsupported |
| 通用交互终端接到 Renderer | unsupported |

## 2. Endpoint 矩阵

前缀 `/api/v1`。所有 POST command 需要 `Idempotency-Key` + `operationId`（body 或头，T02 定一种并生成 schema）。写命令需要 `If-Match`（创建类除外）。

### 系统

| Method | Path | M3 | 页面 |
|---|---|---|---|
| GET | `/health` | 必须 | 壳 |
| GET | `/ready` | 必须 | 壳 |
| GET | `/version` | 必须 | 壳、不兼容提示 |
| GET | `/operations/{operationId}` | 必须 | 所有 command 回放 |
| GET | `/capabilities` | 必须 | 设置、禁用 unsupported 按钮 |

### 项目

| Method | Path | M3 | 页面 |
|---|---|---|---|
| POST | `/projects` | 必须 | 创建 |
| GET | `/projects` | 必须 | 列表、工作台 |
| GET | `/projects/{id}` | 必须 | 详情 |
| PATCH | `/projects/{id}` | 必须 | 详情编辑（draft/planning 名称目标） |
| POST | `/projects/{id}:start-planning` | 必须 | 配置齐后进入 planning |
| POST | `/projects/{id}:confirm-plan` | 必须 | 确认 Plan 版本 |
| POST | `/projects/{id}:start` | 必须 | 启动执行 DAG |
| POST | `/projects/{id}:pause` | M5 | 详情；M3 可隐藏 |
| POST | `/projects/{id}:resume` | M5 | 同上 |
| POST | `/projects/{id}:cancel` | 必须 | 详情 |
| POST | `/projects/{id}:archive` | later | 无按钮 |

### Tasks / Runs

| Method | Path | M3 | 页面 |
|---|---|---|---|
| GET | `/tasks` | 必须 | DAG/列表。公开 Task DTO **必须**含 `dependsOn`（来自已发布执行 DAG；无依赖则为 `[]`） |
| GET | `/tasks/{id}` | 必须 | Task 详情；同上，返回该 Task 的 `dependsOn` |
| PATCH | `/tasks/{id}` | M5 | 未冻结定义；M3 Planner/模板生成即可 |
| POST | `/tasks/{id}:queue` | 必须 | 调度也可内部调用 |
| POST | `/tasks/{id}:cancel` | 必须 | Task 详情 |
| POST | `/tasks/{id}:retry` | 必须 | 失败后 |
| POST | `/tasks/{id}/runs` | 必须 | 显式启动（内部亦可） |
| GET | `/runs` | 必须 | 工作台、记录 |
| GET | `/runs/{id}` | 必须 | 控制台 |
| POST | `/runs/{id}:cancel` | 必须 | 控制台；202=已接受 |
| POST | `/runs/{id}:pause` | unsupported unless probe | 无能力则隐藏 |
| POST | `/runs/{id}:resume` | 同上 | 同上 |
| POST | `/runs/{id}:input` | Mock 必须 | Mock waiting_input 场景 |
| POST | `/runs/{id}:take-over` | M5 | 接管进度；M3 可后置但契约要有 |
| GET | `/runs/{id}/logs` | 必须 | 控制台 |
| GET | `/runs/{id}/events` | 必须 | 时间线 |

`TaskDto.dependsOn` 只投影普通 prerequisite 边，`waitFor` 允许 `outputs_ready` 或 `completed`；Workflow 的 `failed`、`cancelled`、`any_terminal` 等 failure/cancel/routing 边留在已发布 graph/Event 中，不进入该字段。未来 contract test 必须覆盖投影，UI test 必须覆盖普通依赖与路由边分开展示。

不提供公共 `POST /runtimes/{id}:start`。

### Approvals / Artifacts / Events

| Method | Path | M3 | 说明 |
|---|---|---|---|
| GET | `/approvals` | 必须 | 工作台、审批中心 |
| GET | `/approvals/{id}` | 必须 | 审批卡 |
| POST | `/approvals/{id}:approve` | 必须 | 含 gate、digest、version |
| POST | `/approvals/{id}:reject` | 必须 | — |
| POST | `/approvals/{id}:request-changes` | 必须 | — |
| POST | `/approvals/{id}:take-over` | M5 | 与 Run takeover 配合 |
| GET | `/artifacts` | 必须 | — |
| GET | `/artifacts/{id}` | 必须 | 元数据 |
| GET | `/artifacts/{id}/versions/{versionId}` | 必须 | 精确版本 |
| GET | `/artifacts/{id}/versions/{versionId}/content` | 必须 | 受控 stream；禁止无版本 content。M3 Mock 字节/元数据以 `LocalArtifactStore` 为权威；`world.json` 不得作为 content 权威 |
| GET | `/artifacts/{id}/versions/{versionId}/lineage` | 必须 | — |
| POST | `/artifacts/{id}/versions/{versionId}:verify` | 必须 | — |
| GET | `/events` | 必须 | cursor 分页 |
| GET | `/events/stream` | 必须 | SSE；Last-Event-ID=ingestion cursor |

旧草案 `GET /artifacts/{artifactId}/content` 作废，除非重定向到默认浏览且标注 non-executing。

**Artifact 权威（M3 Mock）：** `LocalArtifactStore`（`stateDir/artifacts`）是产物字节与登记元数据的权威。公开 list/get/content/lineage/verify 必须解析到精确 `artifactVersionId` 并从 store 读取。SQLite 实体表保存 Task/Run 绑定与 digest；`world.json` 只是 sidecar，删除后 content 仍须可恢复。禁止把仅存在于 world snapshot 的 `bodyBase64` 当作已持久化产物。

### Workspace / Runtime / Node / Team / Budget

| Method | Path | M3 | 说明 |
|---|---|---|---|
| POST | `/projects/{id}/workspaces` | 必须 | 项目详情 Settings；Main 传入一次性授权引用 |
| GET | `/workspaces/{id}` | 必须 | 安全化元数据，无宿主绝对路径明文（内部 token 可有） |
| POST | `/workspaces/{id}:validate` | 必须 | — |
| POST | `/workspaces/{id}:provision` | 必须 | Mock 可用临时目录 |
| GET | `/workspaces/{id}/changes` | 必须 | 受控 diff |
| GET | `/runtimes` | 必须 | Mock + 已探测 Codex |
| GET | `/runtimes/{id}` | 必须 | — |
| GET | `/runtimes/{id}/capabilities` | 必须 | probe 结果 |
| POST | `/runtimes/{id}:validate` | 必须 | — |
| POST | `/runtimes/{id}:diagnose` | 必须 | 本机诊断 |
| GET | `/nodes` | 必须 | 仅 Local Node |
| GET | `/nodes/{id}` | 必须 | 容量只读 |
| GET | `/teams` | 必须 | M3 预设列表；M7 含已发布自定义 Team |
| GET | `/teams/{id}` | 必须 | M3 只读 Worker 版本 |
| GET | `/teams/{id}/versions/{versionId}` | M7 | 精确已发布 TeamVersion；Project 绑定快照用此，不用 `latest` 执行 |
| POST | `/teams` | M7 | 创建自定义 Team 草稿 |
| PATCH | `/teams/{id}` | M7 | 编辑未发布 Team 元数据 |
| POST | `/teams/{id}/drafts` | M7 | 创建/保存 `TeamDraft`（成员/角色/RuntimeProfile 嵌在 payload；不产生 TeamVersion） |
| GET | `/teams/{id}/drafts/{draftId}` | M7 | 读取指定 `TeamDraft` revision |
| PATCH | `/teams/{id}/drafts/{draftId}` | M7 | 以 If-Match/CAS 编辑指定 `TeamDraft` |
| POST | `/teams/{id}/drafts/{draftId}:publish` | M7 | 将指定 `TeamDraft` 发布为不可变 TeamVersion，并写 `team.version.published` |
| GET | `/projects/{id}/budget` | 必须 | 页头只读 + Settings；unknown/estimated/settled |
| POST | `/projects/{id}/budget:raise` | M5 | 需 budget gate |

### Workflows

只读目录是 M3/P1 **过渡切片**（`GET /workflows` 已接通）。写接口与画布同属 M7。未发布图不是 Runtime 执行对象。

目录 DTO 是 published `WorkflowVersion` 的只读投影（模板名称、版本、结构化步骤）；它不等价于 `WorkflowDraft`，不含可编辑 CAS 状态，也不是 `WorkflowInstance`/Project Execution Snapshot。画布保存和对话生成都必须落到同一 canonical graph，不能另造目录图协议。

| Method | Path | 阶段 | 说明 |
|---|---|---|---|
| GET | `/workflows` | readonly | 已发布模板列表（已接通）。不是 M3 Mock 闭环硬依赖。数据来自已发布模板（如 software-dev feature-delivery），不是项目内执行图 |
| GET | `/workflows/{id}` | readonly | 单个已发布模板 |
| GET | `/workflows/{id}/versions/{versionId}` | readonly / M7 | M3：不可变版本 + 结构化步骤（已接通）。M7：同一路径返回已发布图（nodes/edges）；已发布不可改 |
| POST | `/workflows` | M7 | 创建 Workflow identity 与初始 `WorkflowDraft` |
| PATCH | `/workflows/{id}` | M7 | 编辑未发布定义元数据 |
| POST | `/workflows/{id}/drafts` | M7 | 创建带 `WorkflowGraphDefinition` 的 `WorkflowDraft` |
| GET | `/workflows/{id}/drafts/{draftId}` | M7 | 读取未发布图草稿与 revision |
| PATCH | `/workflows/{id}/drafts/{draftId}` | M7 | 画布以 If-Match/CAS 保存未发布图 |
| POST | `/workflows/{id}/drafts/{draftId}:publish` | M7 | 发布不可变 WorkflowVersion；失败不得假装已发布 |

对话生成（D17）与双执行模式（D18）**不在本表发明 path**。当前实现复用 `GET /capabilities` 与现有 `:start`，加可选 `orchestrationMode`；**没有** chat 或 `:direct` 资源。表中 `/drafts` 行仍是更长周期形状；2026-09-12 切片走 `.../versions` + `:publish`，不要把两条 path 写成已经是同一个。`transport`、`placement`、`orchestrationMode` 三轴分开表达；旧 `executionMode` 不作为公共字段。`orchestrationMode` 权威在 `packages/protocol/src/execution.ts`，不进入 `StartRunRequest`。

## 3. 错误与并发（T02 生成）

| HTTP | code | 场景 |
|---|---|---|
| 400 | `validation_failed` | schema / 未知字段 |
| 401 | `unauthenticated` | token |
| 403 | `forbidden` | Policy |
| 404 | `not_found` | — |
| 409 | `idempotency_key_reused` | 同 key 不同 payload |
| 409 | `conflict` | 单活动 Run、容量 |
| 410 | `event_cursor_expired` | SSE |
| 412 | `revision_conflict` | If-Match |
| 422 | `invalid_transition` | 状态矩阵 |
| 422 | `unsupported_capability` | pause/input/硬预算不可执行 |
| 422 | `unknown_cost_not_enforceable` | 硬货币上限无法保证 |
| 202 | `accepted` | cancel/takeover 已接受未完成 |

公开 DTO 禁止宿主绝对路径、secret、原始环境变量。内部 grant 与公开 DTO 分离。

## 4. SSE

- 事件 `id` = 不透明 ingestion cursor
- `event` = `WorkforceEvent.type`（如 `run.status_changed`、`task.waiting_review`）
- `data` = 完整事件或 T02 定义的投影；Run 的 `to` 不得为 `waiting_review`
- 过滤绑定在 cursor 内；换过滤条件必须新订阅
- 重连：snapshot query + cursor high-water

## 5. 页面动作 → 命令（M3 主路径）

| 用户动作 | Command | 前置 |
|---|---|---|
| 新建项目 | `POST /projects` | — |
| 选择仓库 | 项目详情 Settings → 原生 dialog → `POST .../workspaces` | draft |
| 选预设团队/Mock Runtime/预算 | PATCH project 或专用 config（T02 定一个） | draft |
| 新建/保存工作流画布 | `POST/PATCH /workflows` 与 version 写接口 | M7；草稿。未发布不得启动执行 |
| 对话生成工作流草稿 | 复用上列 M7 写接口落草稿；会话协议待 T02 | M7 planned（D17）。**未实现**。无冻结 chat path |
| 发布工作流版本 | `/workflows/{id}/drafts/{draftId}:publish` | M7；有限 DAG 校验通过 |
| 选择绑定工作流或直接执行 | 待 T02 的启动字段（`orchestrationMode`） + `GET /capabilities` | M8 planned（D18）。**未实现**。无能力则禁用；两种模式最终都创建 Task/Run |
| 新建/保存自定义团队 | `POST/PATCH /teams` 与 version 写接口 | M7；草稿不得 `:start-planning` |
| 发布 Team 版本 | `/teams/{id}/drafts/{draftId}:publish` | M7 |
| 开始规划 | `:start-planning` | 配置齐 |
| 确认计划 | `:confirm-plan` 或 `approvals/:approve` gate=plan | Plan Artifact available |
| 开始开发 | `:start` | ready |
| 看 Run | `GET /runs/{id}` + SSE | — |
| 取消 | `:cancel` | 非终态；UI 显示取消中 |
| 审批代码 | `approvals/:approve` gate=artifact | 精确 version + digest |
| 要求修改 | `:request-changes` | waiting_review |
| 导出 | T14 query/command（T02 列入 protocol） | 最终 digest 已批准 |

## 6. T12/T13/T18/T19/T20/T21 约定

- 只使用 `packages/desktop-client` 生成的 typed client
- 公开 Task DTO 的 `dependsOn` 由 `packages/protocol` 定义；页面只消费该字段，不另造 DAG API
- Artifact 内容路由走已列 versioned path；不发明无版本 content
- 不发明可写项目策略 endpoint 或远程节点 enrollment
- 不改 OpenAPI / protocol（缺口交 T02）
- 路由由 T11 注册；本矩阵的页面入口由 T11 挂到 shell
- 不支持的能力：按钮不渲染为可点击成功态
- T18/T19：catalog 写 path 已接通；只读目录不得宣称画布 headed 完成；T19 Renderer 仍拒保存
- T20/T21：会话 DTO 与 `:start` 回显已有切片；不得实现假 Agent send 或假 `direct` 成功；控件未入页不得写成桌面模式选择可用
