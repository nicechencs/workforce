# V0.1 页面与 API 能力矩阵

日期：2026-09-11  
状态：**已冻结（首版按钮与 endpoint）**  
权威：[decision-register.md](decision-register.md) D08。  
未实现能力必须在 UI 隐藏或 disabled，并返回明确错误；禁止前端假成功。  
修订：2026-09-11 — 增补 P1 **只读**工作流目录 `GET /workflows`（及模板/版本详情）。无画布编辑器，不是可执行 Runtime。与 [IA §6.2](../product-ui/01-information-architecture.md) 对齐。

图例：

- **M3**：Mock 闭环必须可用
- **M4**：真实 Codex 接入后
- **M5**：治理全链路
- **later**：V0.1 后或不做
- **readonly**：可展示，不可改
- **unsupported**：探测后禁用

## 1. 页面范围

P0 最小切片（M3 必须能走完主路径）：

| 页面 | M3 | 说明 |
|---|---|---|
| 应用壳 / 连接状态 | 必须 | Daemon 健康、重连、版本不兼容错误 |
| 工作台 | 部分 | 待审批、运行中 Run、活跃项目；不做复杂统计 |
| 项目列表 / 创建 / 详情 | 必须 | 创建、配置、规划确认、Task DAG。详情分区见 IA §4.3：配置写入在 Settings，DAG 在 Tasks，项目命令在页头 |
| Task 详情 | 必须 | 依赖、验收、Run 历史 |
| Run 控制台 | 必须 | 时间线、日志、取消、用量（未知成本展示） |
| Artifact 查看 | 必须 | 固定版本 diff/内容/Evaluation |
| 审批卡 | 必须 | plan + artifact；digest/版本/到期 |
| 本机诊断 / Local Node | 必须 | 只读本机节点与 Mock/Codex 探测 |
| AI 团队 | readonly | 预设 Software Development Team |
| 设置 | 部分 | 本机 Runtime 探测、预算展示 |

P1 一级导航（壳上可见；深度更薄。权威：[IA §2](../product-ui/01-information-architecture.md)）：

| 页面 | M3 | 说明 |
|---|---|---|
| 运行记录列表 | 部分 | IA P1；查询走已有 `GET /runs`。控制台仍走 `GET /runs/{id}` |
| 工作流模板 / 版本 | readonly | IA P1；只读目录：已发布模板、不可变版本、结构化步骤。查询 `GET /workflows`（及模板/版本详情）。无画布编辑器；目录不是可执行 Runtime，不得宣称 Mock/Codex 已执行这些定义 |

明确后置或示意：

| 页面/动作 | 处理 |
|---|---|
| 自定义 Team 编排 | later；只读预设 |
| 项目归档 | later；无按钮 |
| 远程节点 drain/revoke | later；不得显示在线远程节点 |
| 可视化 Workflow 编辑器 | later |
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
| GET | `/tasks` | 必须 | DAG/列表 |
| GET | `/tasks/{id}` | 必须 | Task 详情 |
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
| GET | `/artifacts/{id}/versions/{versionId}/content` | 必须 | 受控 stream；禁止无版本 content |
| GET | `/artifacts/{id}/versions/{versionId}/lineage` | 必须 | — |
| POST | `/artifacts/{id}/versions/{versionId}:verify` | 必须 | — |
| GET | `/events` | 必须 | cursor 分页 |
| GET | `/events/stream` | 必须 | SSE；Last-Event-ID=ingestion cursor |

旧草案 `GET /artifacts/{artifactId}/content` 作废，除非重定向到默认浏览且标注 non-executing。

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
| GET | `/teams` | 必须 | 预设列表 |
| GET | `/teams/{id}` | 必须 | 只读 Worker 版本 |
| POST/PATCH `/teams` | — | later | 无写接口 |
| GET | `/workflows` | readonly | P1 只读目录：已发布模板列表（含版本与结构化步骤）。数据来自已发布模板（如 software-dev feature-delivery），不是 Runtime 执行图 |
| GET | `/workflows/{id}` | readonly | 单个已发布模板 |
| GET | `/workflows/{id}/versions/{versionId}` | readonly | 不可变版本 + 结构化步骤 |
| POST/PATCH `/workflows` | — | later | 无写接口；可视化编辑器仍为 later |
| GET | `/projects/{id}/budget` | 必须 | 页头只读 + Settings；unknown/estimated/settled |
| POST | `/projects/{id}/budget:raise` | M5 | 需 budget gate |

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
| 开始规划 | `:start-planning` | 配置齐 |
| 确认计划 | `:confirm-plan` 或 `approvals/:approve` gate=plan | Plan Artifact available |
| 开始开发 | `:start` | ready |
| 看 Run | `GET /runs/{id}` + SSE | — |
| 取消 | `:cancel` | 非终态；UI 显示取消中 |
| 审批代码 | `approvals/:approve` gate=artifact | 精确 version + digest |
| 要求修改 | `:request-changes` | waiting_review |
| 导出 | T14 query/command（T02 列入 protocol） | 最终 digest 已批准 |

## 6. T12/T13 约定

- 只使用 `packages/desktop-client` 生成的 typed client
- 不改 OpenAPI / protocol
- 路由由 T11 注册；本矩阵的页面入口由 T11 挂到 shell
- 不支持的能力：按钮不渲染为可点击成功态
