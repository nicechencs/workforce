---
title: Workforce V0.1 Decision Register
type: decision
status: current
owner: maintainers
updated: 2026-09-13
---

# V0.1 决策登记

日期：2026-09-13  
状态：**已冻结（M0–M3 开工基线；项目制主对象；我的角色版本库与全局 Chat 壳现在就要有；Marketplace 现在不是一等面、未来要做；M7 补齐 Team/Workflow 编排与对话生成；M8 双执行模式；执行 Placement：本机默认，远程与容器为一等能力）**  
范围：设计评审 R01–R09 及评审推荐默认值；2026-09-11 用户决定：产品是**项目制**；可视化画布与自定义 Team 是项目主循环的必达环节；工作流必须高度可定制；用户可通过对话让 Agent **生成**可编辑工作流；每个 Agent 可绑定已发布工作流或直接执行；产品支持在**本机（默认）**、经**远程连接**和在**容器**中工作。2026-09-13 收窄：第一天对象就是 WorkerVersion，**我的角色版本库现在就要有**；**全局 Chat 现在就要有**（按句意落到库 / Team / Workflow；建/改角色走库；空闲说话写卡，不是 direct）；Marketplace 原为 V0.1 非目标，收窄为**现在不做一等面、未来要做**。  
协调者：当前 Herdr 主会话。后续公共契约变更只通过 T00/T02 走兼容流程。产品/规划文档变更必须追加 [communication-history.md](communication-history.md)。

本文把 [01-design-review.md](01-design-review.md) 的建议默认写成唯一实现规则。蓝图原文若与本文冲突，**以本文为准**；蓝图正文整合属于 B2，不阻塞 M0。PRD「明确不做大型无代码编辑器」已被 D15 取代：产品**必须**有可视化画布，但画布不是 Runtime，也不做通用 iPaaS。高度可定制、对话生成与双执行模式是产品要求，**完成态尚未实现**。远程与容器是已冻结的产品 Placement，**不是** later nicety；V0.1 实现深度仍是 Local Node + worktree，见 [D19](#d19-执行-placement本机远程与容器)。进度以 [03-implementation-status.md](03-implementation-status.md) 为准，不得把已有画布/写 API/作者壳/mode 回显切片写成「都还没有代码」。`e142f72` 上**我的角色版本库** HTTP/UI 与**全局 Chat 壳**（含 `POST /workers` 进库、Team `workerVersionId`、问进度投影）**已接线**；卡片三字段（他是谁 / 怎么干活 / 技能）、按句意分类、空闲说话写卡仍 **planned**。不得把已接线写成产品完成，也不得把已接线写成还没做。

未测的真实 Runtime 能力转交 T03，不得用猜测当决定。

## 0. 产品模型：项目制

**主对象是 Project。** Workforce 不是独立的团队工作室，也不是脱离项目的通用工作流 IDE。围着**一个项目**，用户：

1. **编排 / 配置 Team**（从**我的角色版本库**选用或 fork 已发布 `WorkerVersion`，不只是只读预设或成员三字段）
2. **编排 Tasks**
3. **编排 Workflow**（必须高度可定制：对话生成 + 可视化画布/结构化编辑 + 发布）

主循环：`Project → Team → Tasks → Workflow 编排 → 执行与验收`。语言是随时入口，不是另一套主对象。

画布编辑器与自定义 Team 是这条循环上的承诺能力（D15 / D16），**不是**外挂目录、可选插件或「以后再说的 nicety」。**我的角色版本库**与**全局 Chat**同样是现在就要有的产品面，不是过渡、也不是 later。工作流高度可定制、对话式生成（D17）以及按 Agent 选择「跟随已发布工作流 / 直接执行」（D18）同样是产品要求。M3 Mock 仍可用预设 Team + 只读已发布工作流走完闭环——那是**切片深度**，不是产品模型。实现进度以 [03-implementation-status.md](03-implementation-status.md) 为准：循环可写面的**完成态**尚未实现（M7/M8 未完成）。本分支已有部分切片——画布 + catalog 写 API、自定义 Team 写 UI + 草稿 persist、角色库页、全局 Chat 壳、作者壳 + Desktop-local session store、项目详情挂载 orchestrationMode 控件与 composed start/Run 回传。D17：**建/改角色走库**（可无 `projectId`，不经 AuthoringSession）；AuthoringSession / Message / Turn **只**服务项目内流程 / 组队。**「不发明泛用 Chat」读成禁止 IM**（Worker 收件箱、无项目聊天室），不是禁止全局语言入口。本文不发明 HTTP path、`:direct` 或 enrollment path，也**不**宣称 M7/M8 完成、句意分类完成或远程/容器 runner 已实现。

## 1. 冻结总表

| 决策 | 冻结值 | 主要受影响任务 |
|---|---|---|
| 产品主对象 | 项目制：一切围绕 Project；Team / Task / Workflow 在项目内编排；工作流必须高度可定制 | T00、T12、T14、T18–T21 |
| 角色版本 | 第一天对象就是 WorkerVersion；**我的角色版本库现在就要有**（找、搜、引用、归档、选用/fork）；卡片必印他是谁 / 怎么干活 / 技能（Runtime / Policy 不是必印）；Team 成员目标是 `workerVersionId`，请来时带上卡片 | T00、T02、T19 |
| 语言入口 | **全局 Chat 现在就要有**：按句意落到库 / Team / Workflow；建/改角色（含空闲写卡）走库；项目内流程 / 组队走 AuthoringSession；认不出再问，不默成交流工作；不是 IM，不是聊天当完成 | T00、T02、T20 |
| Marketplace | **现在不是一等面，未来要做**；装进来仍进自己的库再 Team 绑 Project。不要写成永久禁止 | T00；契约扩展归 T02 |
| 工作流作者路径 | 对话生成草稿（D17）后必须可在画布/结构化面编辑（D15）；未发布不得执行 | T18、T20、T02 |
| Agent 执行模式 | 绑定已发布工作流，或直接执行；两者皆一等、靠 probe 诚实显隐（D18） | T21、T09、T10 |
| 执行 Placement | 种类：`local`（本机，**默认**）\| `remote` \| `container`。调度意图仍为 `automatic \| local_only \| remote_only \| specific_node`，系统默认 `local_only`。V0.1 只实现 Local Node + worktree；远程=契约/Mock，容器=planned，均非 later nicety（D07 / D19） | T02、T05、T09、T10、T13 |
| 初始交付结果 | 固定基线 SHA 的整合 patch/分支 + 报告；合回用户目标分支是显式动作 | T06、T08、T14、T16 |
| Planner 流程 | 先配置再规划；Planner 是普通受控 Task/Run；确认 Plan 版本后才发布冻结执行 DAG | T02、T09、T12、T14 |
| 接管含义 | 先停写入并确认，再人工编辑，再重新注册 Artifact / Evaluation / 审批 | T05、T06、T09、T13 |
| 协议唯一来源 | `packages/protocol` 可执行 schema 源；生成 JSON Schema、DTO、OpenAPI | T02 及所有消费者 |
| 本地通信 | Daemon REST+SSE；Electron Main 代理；Renderer 仅 typed bridge | T10、T11、T12、T13 |
| 版本 | `definitionRevision` 与 `stateRevision` 分开 | T02、T04、T09、T10 |
| 运行能力 | capability probe + 受测 fixture；不支持则禁用或启动前拒绝 | T03、T05、T07、T15 |
| 预算 | `costMinor` 整数 + `currency`；时间/次数/并发先硬约束；未知成本不得当 0 | T02、T04、T07、T09、T13 |
| 共享进程控制 | 独立包 `packages/process`，实现所有权归 T06 | T01、T06、T08、T15 |

## 2. B0 决策（R01–R09）

### D01 / R01 — 契约权威来源

**权威顺序（后者不得覆盖前者的已冻结字段语义）：**

1. 本决策登记、[state-matrix.md](state-matrix.md)、[api-capability-matrix.md](api-capability-matrix.md)
2. 已 Accepted 的 ADR
3. `packages/protocol` 生成的 schema / DTO / OpenAPI（T02 落地后）
4. 蓝图正文：领域不变量看 `02`，状态机看 `08`，Task 看 `05`，Artifact 看 `06`，Runtime SPI 看 `07`，Event envelope 看 `09`，存储意图看 `10`，HTTP 资源看 `11`
5. Product UI 只约束页面能力，不发明 API 或状态值。主对象与循环以本文 §0 与 [IA §1](../product-ui/01-information-architecture.md#1-设计目标) 为准；项目详情六标签、页头与标签职责以 IA §4.3 为准；线框 §3 若与 IA 冲突，以 IA 为准。
6. 架构概览 `03`、仓库结构 `04`、MVP 计划 `12` 是方向文档

**类型分层，禁止混用同一组字段名：**

| 层 | 用途 | 例子 |
|---|---|---|
| Domain | 持久化实体与不变量 | `Task.status`, `Run.status` |
| Protocol DTO | 跨进程/HTTP JSON | `TaskDto`, `WorkforceEvent` |
| Persistence | 表/列/JSON 载体 | `tasks.definition_revision` |
| Runtime SPI | Adapter 输入输出 | `StartRunRequest`, `RuntimeHandleRef` |

映射必须显式。文档示例分为：

- **可校验 fixture**：进入 `packages/testkit` 与 contract 测试
- **概念节选**：不得当作实现契约

**Event envelope 以 `09` 为准：**

```text
specVersion, id, type, source, subject, time, recordedAt,
actor, stream, sequence, correlationId, dataSchema, data
```

`02` 的 `schemaVersion` / `occurredAt` / `payload` 视为过时别名：

| 过时 | 权威 |
|---|---|
| schemaVersion | specVersion |
| occurredAt | time |
| payload | data |
| eventVersion | specVersion |

SSE `data` 必须是完整 `WorkforceEvent` JSON，或明确的投影 DTO；禁止另造 `from/to` 事件把 Run 迁到不存在的 `waiting_review`。`waiting_review` 只属于 Task，不属于 Run。

**Runtime SPI 以 `07 §4` 为准：** `describe/validate/start/sendInput/cancel/inspect/stream/reconcile`，使用 `RuntimeHandleRef`、receipt、cursor。`03` 中只收 `runId` 的 Adapter 图是概览。

**Task 输出与验收以 `05` 为准：** `expectedOutputs[].id` + `kind` 稳定；`acceptanceCriteria[].id` 稳定。API 示例里的 `type: code_change` 与无 id 的 criterion 作废。

### D02 / R02 — Planner 与不可变 DAG

1. 新建 Project 先进入 `draft`：绑定 Workspace、Team（M3 只读预设；M7 可为已发布自定义 TeamVersion）、Runtime、权限、预算。配置未完成不得启动 Planner。桌面 V0.1：WorkspaceBinding 写入在项目详情 Settings；页头只读展示绑定状态；开始规划 / 确认计划 / 开始执行留在页头（IA §4.3.4）。这是项目制循环的入口，不是「先做完项目再另开团队/画布产品」。
2. 配置齐备后进入 `planning`。Planner 是普通 Task/Run（Mock 或真实），产出不可变 **Plan Artifact**（精确 ArtifactVersion）。
3. 用户确认指定 Plan 版本（gate 类型 `plan`）。确认成功后原子创建唯一 **ProjectExecutionSnapshot**（精确 WorkflowVersion/TeamVersion/Policy/Budget），Project 写入 `executionSnapshotId` 并进入 `ready`。
4. 开发 DAG 只从 ProjectExecutionSnapshot 读取已发布 WorkflowVersion/TeamVersion。Planner **不得**修改活动执行图。
5. 取消或重生成计划：保留旧 Plan Artifact 与审批记录；新 Plan 新版本。已发布执行图不原地改；若需改计划，取消或完成后走新 WorkflowInstance。
6. M3 允许固定 Mock Plan fixture；V0.1 最终必须接真实 Planner。未批准 Plan 不得启动 Developer。

计划审批（`plan`）与最终代码审批（`artifact`）是不同 gate。

### D03 / R03 — 版本、retry、rework

| 字段 | 含义 |
|---|---|
| `definitionRevision` | 可编辑内容版本；进入 Run 快照后该快照不可变 |
| `stateRevision` | 状态 CAS / ETag；每次合法状态写入 +1 |
| `generation` | 质量返工代数；同一 Task 身份上递增 |
| `attempt` | 同一 Task 内单调增加的技术尝试序号 |

规则：

- 技术 retry：同一 `definitionRevision` + 同一 snapshot，**新 Run**，`attempt+1`。不改已终态 Run。
- 质量返工（waiting_review 被 request-changes，或 Evaluation 未通过且未耗尽 rework）：新 `definitionRevision` 与新 `generation`，新 Run；不是新 Task。
- `completed` 的 Task **不可重开**。后续工作创建 follow-up Task。
- `maxAttempts` 按 `(taskId, generation)` 计数。
- `maxReworkCycles` 单独约束质量循环。
- Project 硬上限约束总 Run 次数。
- `queued → running` **不**产生新 definitionRevision。
- 启动幂等键：`start:{taskId}:definitionRevision:{n}:generation:{g}:attempt:{a}`。

### D04 / R04 — 可恢复执行的存储原则

不要求一对象一表。T04 必须提交「状态/记录 → 存储位置 → 唯一约束 → 恢复入口」矩阵，至少覆盖：

- NodeInstance generation
- 持久 Timer / retry schedule
- Runtime Handle 与进程 identity
- start command 与 idempotency receipt
- pending approval action digest
- Artifact staging / output binding
- usage 去重与资源占用
- SSE ingestion position

事务规则：

- 业务状态、Event、Outbox **同事务**
- 外部 spawn、文件写入、Git 操作 **不得**夹在长数据库事务中
- 先持久化再发布；禁止用 Event replay 重放副作用

三个崩溃窗口必须可测：

1. 命令已提交，进程未启动
2. 进程已启动，Handle 未提交
3. Artifact 已落盘，元数据未提交

未知/孤儿进程：只允许 inspect 与安全终止；禁止盲目重跑。

### D05 / R05 — 幂等身份

持久作用域：

```text
principalId + clientId + canonicalOperation + resource + idempotencyKey
```

- Session token 只认证，不构成收据边界。重连换 token 后，同一 clientId + key 仍命中原收据。
- 先比 key 的请求摘要与历史收据，再对首次命令检查 `If-Match`。
- Receipt 状态：`pending | committed | failed`；至少保留 24 小时；过期后可通过 operationId 查询已发生操作，不得当「从未发生」。
- 所有状态命令与 Runtime 输入携带可持久化 `operationId`。
- 相同 key + 相同摘要 → 原结果；相同 key + 不同摘要 → `409 idempotency_key_reused`。

### D06 / R06 — 事件序号与 SSE cursor

三层序号：

| 层 | 作用 |
|---|---|
| Runtime source cursor | Adapter 续流 |
| 聚合 stream sequence | 单 stream 内业务顺序，可从 1 开始 |
| SQLite ingestionPosition | 全库单调；SSE 补拉权威 |

SSE：

- `Last-Event-ID` / cursor 是不透明值，必须能解析为 `ingestionPosition`，并绑定过滤条件
- 这是本地投递顺序，不是跨机器因果顺序
- 握手：资源快照 + high-water mark，避免快照与订阅之间漏事件
- cursor 过期 → `410`，客户端重建快照再订
- heartbeat 不持久化、不占 ingestionPosition

### D07 / R07 — Node 与 Placement

- 本地新建 Run 在 **starting 之前**必须有 `executionNodeId`、`runtimeInstallationId`、`workspaceInstanceId`。分配前可空，starting 时缺一不可。
- `workflowNodeId`（图节点）与 `executionNodeId`（执行位置）禁止混用同一字段名。
- `RuntimeDescriptor.transport` 只表示接入方式：`process | sdk | http`。删除 `remote` 作为 transport 的含义。位置用 Placement。
- V0.1 实现单机容量与 Node ports。远程 enrollment / heartbeat / 服务器 lease：版本化契约 + Mock，不建服务器控制面。**不发明**矩阵中不存在的 enrollment / orchestrator endpoint。
- Lease 到期 ≠ 旧进程已停。fencing 只阻止旧结果被平台接纳，不能阻止旧进程写外部系统。
- 恢复不确定时不得直接重跑。取消与 inspect 必须有明确授权路径。
- 产品执行位置种类（本机 / 远程 / 容器）与默认本机见 [D19](#d19-执行-placement本机远程与容器)。本条的 Node、Lease、transport 与 enrollment 边界仍然有效，D19 **不得**改写它们。
- 调度意图（Placement intent mode）仍为蓝图已有取值：`automatic | local_only | remote_only | specific_node`。系统默认 **`local_only`**（本机 Local Node）。`automatic` 在仅 Local Node 可用时必须解析为本机，不得假装已选中远程或容器节点。

执行字段冻结为三条正交轴：`transport`（`process | sdk | http`，Adapter 接入方式）、`placement`（`automatic | local_only | remote_only | specific_node`，节点/Workspace 位置）和 `orchestrationMode`（`workflow_bound | direct`，是否进入本次 Workflow 调度）。旧名 `executionMode` 不再承载任何一轴；Runtime descriptor 不使用 `remote` 作为 transport。

默认与覆盖层级冻结为：启动命令的显式、经 Capability/Policy 允许的 override → Task 定义/Placement intent → Project 配置 → Team/Worker/RuntimeProfile 默认 → V0.1 系统默认。三轴分别解析：`orchestrationMode` 的系统默认是 `workflow_bound`（M3 兼容）；`placement` 的系统默认是 `local_only` Local Node；`transport` 必须来自选定 RuntimeProfile/RuntimeInstallation，不能由 UI 任意改写。缺失字段按上述默认补齐并写入 Run snapshot；任何 override 不得放宽 Policy、预算、Workspace 或 capability。

### D08 / R08 — 首版 API 与页面

以 [api-capability-matrix.md](api-capability-matrix.md) 为准。硬规则：

- 前端不得私自创造矩阵中不存在的 endpoint
- Team：项目循环的第一环。M3 Mock 主路径只读预设模板；自定义编排是 **M7 必达**（D16），用来给**该项目**配团队，不是后置或独立 HR 产品
- 工作流：项目循环的编排环。M3 只读已发布目录（`GET /workflows` 已接通）；可视化画布是 **M7 必达**（D15）；对话生成草稿是 **M7 扩展**（D17），生成后必须可编辑。用来给**该项目**编排并发布执行图，不是后置或独立 IDE
- Agent 执行：每个 bot/Agent 可 **跟随已发布工作流** 或 **直接执行**（D18，**M8**）。无 capability 则禁用；禁止假 mode。endpoint / 字段待 T02 冻结，本登记不发明 path
- 项目归档可延后，列表不展示伪造的归档成功
- Artifact content / read / verify / approval / input **必须**带 `artifactVersionId` 或精确 `version`；`latest` 只用于非执行性浏览
- 公开 `TaskDto` **必须**包含 `dependsOn: { taskId, waitFor }[]`，映射已发布执行 DAG；无依赖返回 `[]`，不得省略后让 UI 编造边
- M3 Mock 产物字节与登记元数据以 `LocalArtifactStore` 为权威；`world.json` 不得作为 content 权威；公开 content 路由从 store 读取精确版本
- Run takeover 与 Approval decision 分离：takeover 是执行权转移流程，不是把任意 shell 接到 Renderer
- 提供 operation receipt 查询

### D09 / R09 — 三层结果

| 层 | 含义 | 成功条件 |
|---|---|---|
| Runtime execution outcome | Adapter 报告进程/会话结束 | Runtime 自己的 completed/failed |
| Run 平台结果 | 平台对这一次执行的判定 | `succeeded` = Runtime 成功结束且平台已记录终态；**不**要求 Task 验收通过 |
| Task acceptance verdict | 业务是否完成 | 全部 required outputs + criteria + 所需 gate 通过 |

- Artifact 不完整或测试失败 → Evaluation/Task 不通过；**不回写**已终态 Run。
- `03 §8`「Artifact 不完整则 Run 不得成功」废止，改为：缺产物则 Task 不得 completed，Run 保持其执行终态。
- 依赖边默认 `onUpstream: outputs_ready`（上游 required outputs 已有精确版本），不是必须等待上游 Task `completed`。
- Review/Gate 节点消费固定 ArtifactVersion，禁止 Developer completed ↔ Reviewer completed 循环等待。
- 软件开发模板中 Reviewer 依赖 Developer 的 **输出版本**，Developer 不等待 Reviewer 才能 completed。最终人工验收是独立 Approval 节点。

## 3. B1 默认（实现时遵守，T03 可补充证据）

### D10 / R10 — 代码汇总

- 每个 Project 冻结 immutable base SHA。
- 每个 Run 独立 worktree，不共享可写目录。
- 输出含 patch/commit、base SHA、changed paths、测试结果、内容 hash。
- 依赖任务用上游精确 ArtifactVersion 构建工作区。
- 并行分支在独立 integration worktree 按稳定 Node ID 顺序整合；冲突进人工处理。
- 测试、Reviewer、最终审批绑定整合后同一 content digest。
- 默认不自动 push、不开 GitHub PR。
- 不得把两份分别通过测试的 diff 称为合并后项目通过。

### D11 / R11 — 审批与接管

Approval 必须绑定：action type、规范化参数 digest、resource/version、principal、policy version、expiry、一次性消费记录。目标版本/参数/权限变化必须重新审批。

四类 gate：`plan`、`artifact`、`action`、`budget`。

接管顺序：

1. 请求停止/冻结 Agent 写入
2. 确认其失去写入权（或进入只读诊断）
3. 授予用户工作区操作
4. 捕获人工变更为新 ArtifactVersion
5. 重新 Evaluation / 审批

结果不确定时只允许诊断，禁止人工与未知活动进程双写。

### D12 / R12 — Policy 执行点

- 能力矩阵记录 enforceable / observable / unsupported，并标明 enforcement owner。
- Runtime 不能实施必需限制时，启动前拒绝该组合。
- 默认使用既有本地 Runtime 身份；CredentialRef 与 Broker 独立。
- 不默认复制用户整个环境变量或认证目录。
- 脱敏覆盖跨输出分块、错误、raw payload、诊断导出。
- 外部文本只是数据，不能修改 Policy。

### D13 / R13 — 暂停、未知、恢复

不新增 RunStatus 枚举值。用 operation/recovery 子状态表达：

- `cancelRequestedAt`、deadline、lastTrustedFact
- 取消 API `202` = 接受请求，UI 不得立即显示已取消
- Daemon 重启用 durable Handle + 进程 identity 对账
- Desktop 关窗不杀允许继续的 Run

RunStatus 仍为：`pending | starting | running | waiting_input | paused | succeeded | failed | timed_out | cancelled`。

### D14 / R14 — 预算

- 存储与比较使用 `costMinor: integer` + `currency: ISO-4217`。展示层可换算，禁止各模块私自解析 `5.0`。
- 展示区分 unknown / estimated / settled。未知 ≠ 0。
- V0.1 硬约束：调度前预留、最大运行时长、尝试次数、并发、可观测 token/tool 限制。
- 货币硬上限只对有可靠计量且可停止的 Runtime 生效；否则阻止启动并说明。
- 晚到 usage 仍入账（去重）；不回写冻结快照与终态。

## 4. 包与文件所有权（领取前锁定）

| 包/目录 | 写入负责人 | 备注 |
|---|---|---|
| `docs/planning/decision-register.md`、`communication-history.md` 等决策文件、蓝图一致性 | T00 / 协调者 | 规划变更须回写沟通历史 |
| 根 `package.json` / lockfile / turbo / tsconfig / lint / CI | T01，完成后 lockfile 归协调者 | 本批 |
| `packages/protocol`, `domain`, `runtime-spi`, `application/src/ports`, `events/src/contracts`, `testkit/src/contracts` | T02 | 等 T00+T01 |
| `tooling/spikes`, `docs/spikes` | T03 | 本批 |
| `packages/database`, `packages/events/src/store\|outbox\|subscriptions` | T04 | 等 T02 |
| `runtimes/mock`, `packages/runtime-sdk` | T05 | 等 T02 |
| `packages/workspace`, `packages/process` | T06 | 等 T02 |
| `packages/policy`, `packages/observability` | T07 | 等 T02 |
| `packages/artifacts` | T08 | 等 T02 |
| `packages/workflow-engine`, `application/src/use-cases/{projects,tasks,runs,approvals,budgets,recovery}` | T09 | 等 T02 |
| `apps/daemon`, `packages/desktop-client` | T10 | 等 T02 |
| `apps/desktop/src/{main,preload,renderer/app,renderer/routes,renderer/components}`, `packages/ui` | T11 | 等 T02 |
| `renderer/features/{projects,tasks,teams}` | T12（M3 只读 Team） | 等 UI 约定；可写 Team 归 T19 |
| `renderer/features/{runs,artifacts,approvals,nodes,settings,dashboard}` | T13 | 等 UI 约定 |
| `templates/software-development-team`, `application/src/use-cases/{planning,delivery}` | T14 | 等 T02 |
| `runtimes/codex` | T15 | 等 T02+T03 |
| `tests/{contract,integration,e2e,platform}` | T16 / 协调者 | 从 T02 起可写场景 |
| `tooling/release`, 打包配置 | T17 | 后置 |
| `renderer/features/workflows` 画布与目录 | T18 | M7；M3 只读页可由现有桌面切片维护 |
| `renderer/features/teams` 可写编排 | T19 | M7；领取前不与 T12 同时改同一文件 |
| `renderer/features/workflow-authoring` 对话生成 | T20 | M7 扩展；不与 T18 同改画布文件；会话协议归 T02 |
| 双执行模式（capability + 启动路径诚实显隐） | T21 | M8；契约归 T02，调度归 T09，HTTP 归 T10；领取前不与 T13/T19 同改同一文件 |

公共类型缺口：提交契约变更请求，禁止复制类型或改邻接模块。

## 5. M3 Mock 主路径（首个可校验闭环）

```text
创建 Project(draft)
  → 绑定 Workspace + 预设 Team + Mock Runtime + 预算
  → Project(planning)
  → Planner Task/Run(Mock) 产出 Plan ArtifactVersion
  → Approval(gate=plan) 确认该版本
  → 发布执行 WorkflowVersion，Project(ready/running)
  → Developer A、Developer B 两个隔离 Run（独立 worktree，Mock 产出 patch）
  → 输出就绪后 Review/Test 消费精确版本
  → 整合 worktree + 测试证据 Artifact
  → Approval(gate=artifact) 人工验收同一 digest
  → 导出 bundle/report
```

重启不得重复创建 Run。同 operationId/key 返回原 Handle/收据。

## 6. T03 已证实并回写的能力（Windows）

来源：`task/t03-spikes` / `docs/spikes/README.md`。macOS/Linux 仍未测。

| 项 | 冻结 |
|---|---|
| `lifecycle.pause` | 可选；默认关闭。本机 Codex 无 pause |
| `event.resume`（cursor） | unsupported。Codex `resume` 是会话恢复，不得映射为 cursor |
| `codex proto` | 不是 V0.1 必选传输；0.153.4 无该子命令 |
| Windows 进程 identity | `win32:<pid>:<CreateTime UTC>`；mismatch 禁止杀进程 |
| Windows cancel | Job Object `KILL_ON_JOB_CLOSE` 首选；根仍活时才可用 `taskkill /T /F` |
| Codex 沙箱 | 本机默认 unrestricted；无法实施的硬限制必须 start 前拒绝 |
| Daemon | 独立 detached 进程；关窗不得杀树 |

## 7. 明确不在本冻结内

- 真实 Codex 能力（T03 实测后才能写入能力矩阵的 live 列）
- 三平台安装签名/公证（T17）
- 远程节点**控制面**（enrollment / heartbeat / 服务器 lease 的真实实现）、云账号、GitHub PR、自动 push
- Docker / Kubernetes runner、容器编排控制面
- 复杂仪表盘

远程连接与容器工作本身**已迁出本节**：它们是产品 Placement（[D19](#d19-执行-placement本机远程与容器)），不是 later nicety。未实现的是控制面与 runner，不是「产品不做远程/容器」。

可视化画布与自定义 Team **已迁出本节**：它们属于 [§0 项目制](#0-产品模型项目制) 主循环，细则见 [§8](#8-项目制循环上的-team-与-workflow-编排m7) / D15 / D16。对话生成（D17）与双执行模式（D18）见 [§9](#9-对话生成与双执行模式m7m8)。不得再写成 later、后置、外挂或「V0.1 不做」。

## 8. 项目制循环上的 Team 与 Workflow 编排（M7）

用户决定（2026-09-11）：围着一个 Project，必须能编排 Team、编排 Tasks、编排 Workflow。画布与自定义 Team 是该循环的必达环节，不是调研项，也不是与项目并列的第二产品。M3 Mock 主路径仍可用预设 Team + 只读已发布工作流走完，不阻塞 M4–M6。**可写面实现仍未开始**；进度以 [03-implementation-status.md](03-implementation-status.md) 为准。

M7 与 M4（真实 Codex）、M5（治理全链路）、M6（三平台打包）并行可排，但不并进 M3 闭环，也不并进 T17 发布任务。未领取 T18/T19 前，禁止在普通 PR 里顺便做画布或可写 Team。

### D15 — 可视化工作流画布编辑器

画布是**项目制循环里编排 Workflow 的主编辑面**，用来为项目准备、发布并绑定有限 DAG。它不是脱离项目的通用自动化 IDE。

**范围（M7 必达）：**

1. 用户在项目循环中编排 Workflow identity：创建/编辑可复用 `WorkflowGraphDefinition` 的有限 DAG（节点与边），保存为 `WorkflowDraft`，发布产生不可变 `WorkflowVersion`，再经确认计划绑定到该 Project 的执行实例（D02）。
2. 一级导航「工作流」与项目详情共用这套定义；画布编辑的是可复用定义，执行仍只绑定已发布版本。
3. 节点类型对齐领域模型：Task / Approval / Condition / Parallel（及现有软件开发模板已用的交付/审批步）。不引入任意第三方 connector 节点。
4. 已发布版本不可变。编辑已发布图必须新建 version；不得原地改活动执行图（D02 仍有效）。
5. 只读已发布目录（`GET /workflows` 已接通）是 **M3/P1 过渡切片**，让项目在画布就绪前仍能浏览将要绑定的模板。目录与画布同一循环，不是终态，也不得关掉目录只留画布承诺。

**M3 Mock 仍允许：**

- 项目只用预设 Team 与只读已发布目录走规划 → 确认 → 执行。
- 页面可以没有画布、没有写接口；不得假成功保存。
- 不把目录接通写成「Runtime 已执行这些定义」或「项目编排已完成」。

**M7 起变为必需：**

- 用户能在项目循环里新建草稿、在画布上保存、发布通过校验的有限 DAG，并绑定到 Project。
- 发布走矩阵中的写 endpoint（T02 生成 schema；见能力矩阵 Workflows 行）。
- 空目录、无草稿、发布失败必须诚实空态/错误，不回退夹具冒充已保存。

**非目标：**

- 画布不是 Runtime。未发布图、未绑定到已确认 Plan / 已发布执行 `WorkflowVersion` 的图，**不得**被 Mock 或真实 Runtime 执行。
- 不把画布当成 n8n/Dify 式通用自动化、Marketplace，或与 Project 脱钩的独立产品。
- 不支持 V0.1 任意循环；仍是有限 DAG。
- 不宣称「画布上点运行」等于 Task/Run 已完成。

### D16 — 自定义 Team 编排

自定义 Team 是**项目制循环里给该项目配团队**的能力。找员工现在就用**我的角色版本库**，不是花名册或 IM 联系人，也不是把成员三字段当目标模型。请来时带上库里卡片（他是谁 / 怎么干活 / 技能）；Runtime / Policy 在请来时再选，不是卡片必印。

**范围（M7 必达）：**

1. 围着 Project 编排 Team：创建 Team identity，在 `TeamDraft` 中编辑成员并以 revision/CAS 保存；发布 Draft 才产生不可变、带 `publishedAt` 的 `TeamVersion`，供该项目（及后续项目）绑定。
2. 第一天对象就是 **WorkerVersion**。发布或绑定成员的**目标**是已发布、未归档的 `workerVersionId`。`role` 只作职责标签，不是身份。现行协议切片 `{ role, runtimeProfileId, quantity }` 可继续被读取，但不得再写成编辑目标。契约字段归 T02，本文不发明 HTTP path。
3. **我的角色版本库现在就要有**：找、搜、引用关系、归档；Team 从库选用或 fork，选用时能看见卡片三字段。WorkerVersion 发布不可变；不适应或空闲说话会改已发布版本则 fork 出新草稿，不得改仍被引用的已发布版本。Chat 建/改角色（含空闲写卡）确认后进同一座库，**不挂 `projectId`**，不经 AuthoringSession。
4. Project 仍绑定 **TeamVersion 快照**（D02：draft 先配齐 Workspace / Team / Runtime / 预算才能开始规划）。绑定未发布草稿或成员缺已发布 `workerVersionId` 的阵容不得 `:start-planning`。
5. 预设 Software Development Team 保留，作为 M3 主路径与默认选项。自定义 Team 补齐项目循环，不删除模板。

**M3 Mock 仍允许：**

- 项目只绑定只读预设（`GET /teams` / `GET /teams/{id}`）。
- 无写接口；UI 不得把「新建团队」渲染为可点击成功态。

**M7 起变为必需：**

- 写接口见能力矩阵 Team 行。成员写入以库中 `workerVersionId` 为目标（T02 冻结后）。**现在不另开一等 Marketplace 面。**
- 已发布 `TeamVersion` 可供项目绑定；编辑已发布编排必须创建新的 `TeamDraft` revision，不能 UPDATE 旧 version。

**非目标：**

- **现在不做一等面、未来要做：** Agent/角色 Marketplace（上架/安装别人的已发布 WorkerVersion）。装进来仍须进自己的库，再 Team 绑 Project。不要写成永久禁止商店。
- 仍禁止：云端组织、SSO、跨用户分享；没有项目也能养联系人、花名册或 Worker IM。
- 把 Worker 标成固定跑在某台机器（节点仍由 Placement 决定）。
- 自定义 Team 不是 M3 Mock 闭环的硬依赖；缺它时项目仍可用预设走完 Mock。

**收窄对照（相对原 D16 非目标）：**

| 原表述 | 收窄后 |
|---|---|
| 不做独立员工目录；Marketplace 为 V0.1 非目标 | **自己的角色版本库现在就要有**；商店现在不是一等面、未来要做 |
| 成员行 `{ role, runtimeProfileId, quantity }` 当编辑目标 | 目标是 `workerVersionId`；三字段是当前实现切片，不是目标模型 |
| 角色身份 = Runtime / Policy | 卡片必印他是谁 / 怎么干活 / 技能；Runtime / Policy 请来时再选 |

## 9. 对话生成与双执行模式（M7/M8）

用户决定（2026-09-11；2026-09-12 明确聊天为创建主入口；2026-09-13 收窄为全局 Chat，见 [communication-history.md](communication-history.md)）：工作流必须**高度可定制**；用户随时通过语言按句意落到对象（建/改角色走库、请到项目走 Team、建流程走 Workflow）；生成的流程可在画布上继续编辑；每个 Agent 做事时可跟随已发布工作流，或直接执行。这是产品要求，不是 later。**产品完成态尚未实现**。AuthoringSession / Message / Turn **只**服务项目内流程 / 组队；**建/改角色不走这条**。**不发明 IM / Worker 收件箱 / `:direct` endpoint**。切片进度以 [03-implementation-status.md](03-implementation-status.md) 为准（壳已接线 ≠ 句意分类 / 空闲写卡 / D17/D18 完成）。

D17 从「只在作者页生成工作流」扩成：**全局 Chat → 按句意落到对象**（库 / Team / Workflow 及问进度、交流工作）。建流程仍与 D15 同一作者环（生成 → 画布编辑 → 发布）；建/改角色走库。D18 列入 **M8**（执行面；可与 M4–M7 并行排期，但不并进 M3 闭环或 T17）。空闲对角色说话 **不是** D18 direct。未领取 T20/T21 前，禁止在普通 PR 里顺便做对话生成或假 mode 按钮。

### D17 — 对话式 Agent 编排工作流

对话是项目制循环里**生成**可定制工作流的一等作者路径，也是 **V0.1 就要有的全局语言入口**。Chat 自己不是一等业务对象：每句必须按发信人句意落到 WorkerVersion / Team / Workflow / Task / Run / Artifact。认不出再问，**禁止**默成交流工作。它不是 IM，也不是替代画布的第二套 Runtime。

**范围（M7 扩展，必达，完成态尚未实现）：**

1. **Chat 全局可开**，不限于工作流作者页或 `?authoring=1`。
2. 按句意落到对象（分类结果不是完成态；一句话多意图可分别落地，**不**强制三张确认卡向导）：
   - **建/改角色** — 语言 → 我的角色版本库（WorkerVersion 草稿）。**不挂 `projectId`**，**不经 AuthoringSession**。用户确认后才落库；发布后才可被 Team 引用。卡片必印他是谁 / 怎么干活 / 技能。
   - **空闲说话写卡** — 没人正在执行时对角色说的话，写入该角色卡片相应字段（谁 / 怎么干 / 技能）。下次请到项目干活时带上。已发布（含已被 TeamVersion 引用）则 fork / 新草稿，不 UPDATE 源版本。**不是** IM，**不是** D18 direct，**不**新建 Task/Run。
   - **请到项目** — 把库里已发布 `workerVersionId` 写入该 Project 的 Team；缺项目再问。请来时带上卡片。
   - **创建流程** — 语言 → 项目内 AuthoringSession → WorkflowDraft；确认后进画布；发布后才可执行。
   - **询问进度** — 只读已有 Task / Run / Event / Artifact 投影。没有事实就说「还没有记录」，禁止模型编造「做完了」。
   - **交流工作内容** — 补约束、返工、讨论**正在执行**的工作。必填 `projectId`；针对执行中再挂 `runId`。落到已有 Run 输入命令。无进行中 Run 不得把闲话当成交流工作。
3. AuthoringSession 是受鉴权、Project-scoped 的会话资源，**只**服务项目内流程 / 组队：提案 → 用户确认 → 草稿。无用户确认不落库。未发布不得执行。**禁止**把 AuthoringSession 当建角色闸门。
4. 生成的**流程**必须可编辑：进入 D15 画布或结构化编辑面，改节点/边/角色/任务后再保存、发布。禁止「对话一次生成即锁定、不可改」。
5. 发布仍走 D02 / D15：已发布 `WorkflowVersion` 不可变；未发布图不得被 Mock 或真实 Runtime 执行。
6. 「现在改这个 bug」一类即席执行仍是 D18：必须落成项目内 Task/Run。本批不得渲染已在跑。空闲说话不走本条。
7. 高度可定制是本条与 D15 的共同产品要求：用户能按项目改角色、步骤与边，而不是只能选预设模板。

Authoring 契约：对话 turn/raw intent 先由 Application 创建受治理 authoring Task/Run，通过 Runtime SPI 执行编排 Agent，`AuthoringProposal` / `ChangeSet` 是该 Run 的输出；Application 再做 schema、Policy、Budget、CredentialRef、DAG 和 Project 边界校验，以 `expectedRevision` 执行 CAS 原子应用，跨 Team/Task/Workflow 无法同事务提交时使用持久化 staged apply。成功只代表草稿 revision 更新，不代表发布或执行生成出的 Workflow。生成、应用、取消、重试、失败与过期事件均保存脱敏摘要/引用；会话原文按 Project retention/redaction policy 管理，禁止进入 Secret、Task、Event 或 Artifact。

项目内流程 / 组队的会话资源仍是受鉴权、Project-scoped 的 AuthoringSession / Message / Turn（confirm/cancel/retry/close）。建/改角色与空闲写卡复用角色库草稿写入与 fork，不新开 IM / remarks / 收件箱资源。**「不发明泛用 Chat」读成禁止 IM**：不要每个 Worker 一个收件箱，不要没有项目边界的聊天室，不要以 `workerId` 为会话对端。这**不是**禁止全局语言入口。公开 path 由 T02 写入能力矩阵；本文不发明 endpoint。发送命令返回引用型 accepted 结果，不能将原文复制进 command receipt。Runtime 输入使用受保护、短生命周期的一次性引用，不能写入 `StartRunRequest`、Host handle、Event、ChangeSet 或 receipt。

**M3 Mock 仍允许：**

- 无对话入口、无生成用例；不得渲染可点击成功的「用对话生成工作流」。
- 项目继续用预设 Team + 只读已发布目录走闭环。

**M7 起变为必需：**

- 任意页面能打开 Chat；创建流程后用户能打开画布编辑并发布（依赖 T18 写接口）。建角色确认后进库，不经 AuthoringSession。
- 会话协议 / 草稿 DTO / 意图分类由 T02 冻结后写入能力矩阵；卡片三字段、句意分类、空闲写卡领取前只标 **planned**，不列虚构 path。库 HTTP 与 Chat 壳已接线，见 03。
- 生成失败、空意图、认不出、校验失败、无进度记录必须诚实错误、再问或「还没有记录」，不默成交流工作，不回退夹具冒充已生成或已完成。

**非目标：**

- **仍禁止 IM 化：** Worker 收件箱、无项目聊天室、把会话对象当成某个员工私聊。空闲说话写卡片，不是私聊线程。
- **仍禁止聊天当完成：** 不把对话窗口当成 Runtime，也不把「Agent 在聊天里说做完了」写成 Task/Run 完成；问进度不得编造终态。
- 空闲说话不马上派 Task/Run。
- 不另造一套与 D15 无关的图协议。
- 不在未冻结 endpoint 时让前端假装已保存对话产物、已创建员工或已在跑。

**收窄对照（相对原 D17 非目标）：**

| 原表述 | 收窄后 |
|---|---|
| 不是独立聊天产品；只在作者页 | **全局 Chat 现在就要有**；仍不是 IM |
| 不发明泛用 Chat API | 禁止 IM / `workerId` 对端；问进度只读投影由 T02 冻结 |
| 创建类一律 AuthoringSession | **建/改角色走库**（可无 `projectId`）；AuthoringSession **只**服务项目内流程 / 组队 |
| 未识别句默成交流工作 | 认不出再问；有 `projectId` 也不得默成 `discuss_work` |

### D18 — 双执行模式：绑定工作流与直接执行

当某个 bot/Agent 做事时，执行模式是一等产品能力，不是隐藏开关。

**范围（M8 必达，完成态尚未实现）：**

1. **workflow-bound：** 跟随该项目已确认、已发布的 `WorkflowVersion`（D02）。Agent 只执行图中轮到它的节点，不得暗改活动执行图。
2. **direct：** 直接执行用户/任务此刻给出的目标（ad-hoc / 绕过该次已发布图）。Application 先创建项目内 ad-hoc Task，待三轴解析与同一 Policy、Workspace、预算、Approval、Artifact/Evaluation、capability probe 治理完成后再创建正常 Run；它只绕过 WorkflowInstance 调度，不绕过控制面，不是「无协议乱跑」。direct 永不推进 WorkflowInstance 或 Project；若吸收成果，必须另发 workflow-bound/follow-up command，显式引用精确 ArtifactVersion 并重新验收，原 direct Run 不改变父聚合。
3. 两种模式都必须在 UI 与 API **诚实**出现：用 `GET /capabilities` 或 Runtime/Agent probe 决定能否选；无能力则禁用或启动前 `422 unsupported_capability`；禁止假 mode、假成功、把只读文案做成可点。
4. 模式记录在 Run / 启动命令的可审计字段 `orchestrationMode` 上（与 `transport`、`placement` 分轴；三者及版本/Policy/Budget/Workspace 写入不可变 snapshot）；重试创建新 Run，不改写旧 Run 的模式。M3 缺省请求兼容解析为 `workflow_bound`，不得将缺省当 direct。

**M3 Mock 仍允许：**

- 只有跟随已发布执行图的 Mock 闭环。无「直接执行」按钮。
- 不得把「在聊天里让 bot 去做」渲染成已支持的 direct mode。全局 Chat 里的即席「去做」仍落 D18；未就绪时诚实 unsupported，不假装已在跑。
- **空闲对角色说话不是 direct。** 写入该角色卡片相应字段，不新建 Task/Run，不开 IM。已发布则 fork / 新草稿。direct 仍只覆盖「现在改这个 bug」一类即席执行。

**M8 起变为必需：**

- 用户能在 Agent / Task / 启动面选择模式（具体落点由 IA 与 T21，不在此发明控件 id）。
- 无 probe 支持的组合不得启动。
- 能力矩阵在 T02 冻结字段前只保留 planned 行，不发明 `/runs/{id}:direct` 之类 path。

**非目标：**

- direct 不是取消 Approval、预算或隔离 worktree。
- 不是第二套 Workflow 引擎，也不是让 Renderer 直接 spawn Runtime。
- 不得用 Mock 成功冒充 direct 已在真实 Codex 验证。
- 空闲对角色说话不是 direct，也不因此新建 Task/Run 或开 IM。

**收窄对照（相对「做事 = Task/Run」的误读）：**

| 原表述 | 收窄后 |
|---|---|
| 对角色说话 = 派活 / direct | 空闲说话写卡片；下次请来才带上；不新建 Task/Run |
| Chat「去做」可先假装跑起来 | 继续诚实 `unsupported_capability`；本批不实现 D18 调度 |

## 10. 执行 Placement：本机默认；远程与容器为一等能力

用户决定（2026-09-11，见 [communication-history.md](communication-history.md)）：产品必须能在**本机**工作，也必须能经**远程连接**工作，**默认是本机**；同时必须能在**容器**中工作。这是产品模型，不是后期 nicety。

[D07](#d07-r07-node-与-placement) 的 Local Node、transport、enrollment=契约/Mock、无服务器控制面仍然有效。本条只冻结用户可理解的位置种类与默认，**不**发明 enrollment / orchestrator / Docker / K8s endpoint，也**不**把未实现写成已完成。

### D19 — 执行 Placement：本机、远程与容器

产品支持三类 **Placement kind**。UX 与 API 缺省必须偏向本机 Workspace / Local Node。

| kind | 中文 | 产品地位 | V0.1 实现深度 |
|---|---|---|---|
| `local` | 本机 | **默认。** 新项目、Workspace 绑定、Placement intent 与 `GET /nodes` 均以本机 Local Node 为准 | **已实现**：单用户 Local Node、只读节点诊断、每个 Run 独立 git worktree（D10） |
| `remote` | 远程 | **一等能力。** 经远程连接在另一台 ExecutionNode 上工作；与本机共用同一抽象（ADR 0001） | **契约 + Mock。** 无服务器控制面；无公开 enrollment / heartbeat / 远程 lease API；UI **不得**伪造在线远程节点 |
| `container` | 容器 | **一等能力。** 在容器中工作。不是 worktree 别名，也不是 `transport` | **planned / 未实现 runner。** 不发明 Docker / K8s / 编排 endpoint；不得写成已完成 |

**不得混用的正交轴：**

1. **Runtime transport**（D07）：`process | sdk | http`。`remote` 不是 transport。
2. **Placement intent mode**（D07）：`automatic | local_only | remote_only | specific_node`。系统默认 **`local_only`**。这是调度怎么选节点，不是用户说的三种位置种类。
3. **Placement kind**（本条）：`local | remote | container`。这是用户选择的执行位置种类，默认 **`local`**。
4. **Isolation**（D10）：V0.1 已实现独立 git worktree。蓝图 isolation 枚举里的 `"container"` **不是**本条已落地的容器 Placement。
5. **ExecutionNode.kind**：`local | remote | enterprise` 是节点分类。`container` **不是**第四种机器。
6. **orchestrationMode**（D18）：`workflow_bound | direct`。与 Placement 正交。`StartRunRequest` 仍不承载该字段（C5–C9）。

**默认与诚实显隐：**

- UX / API 缺省 Placement 与 Workspace 绑定优先本机。未写 intent 时按 `local_only` + kind `local` 补齐。
- `automatic` 在仅 Local Node 可调度时解析为本机；不得因此画出可选的在线远程节点或可点成功的容器调度。
- 远程与容器在产品模型里**已经支持**（planned / 契约），页面可以展示「远程 / 容器」并标成尚未接通，但必须 disabled 或启动前 `422 unsupported_capability`。禁止假成功、假在线、假 runner。
- `GET /nodes` 在 V0.1 **仍仅 Local Node**。本条不增加 path。

**非目标：**

- 不建设远程节点控制面，不发明 enrollment / heartbeat / 服务器 lease 的新公开 API。
- 不实现 Docker / Kubernetes runner。
- 不得把尚未出现在当前源码与测试中的 protocol 字段写成已实现。T02 若要把 `placementKind` 落进 schema，走兼容流程；本条只冻结产品语义。

## 11. 交接

- 决策：本文
- 沟通历史：[communication-history.md](communication-history.md)
- 状态： [state-matrix.md](state-matrix.md)
- 页面/API：[api-capability-matrix.md](api-capability-matrix.md)
- ADR：[0003-v01-contract-freeze.md](../adr/0003-v01-contract-freeze.md)

T02 必须把已冻结的 M3 字段变成单一 schema 源与 fixture。T01/T03 不依赖本节字段即可开工。M7 写接口、M8 执行 mode 与 D19 的 `placementKind`（若落地）是 T02 的兼容扩展，不回退已冻结的 M3 字段，也不在本登记发明 path。`StartRunRequest` 仍不承载 `orchestrationMode`。
