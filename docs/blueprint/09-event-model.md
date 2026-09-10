# Workforce — Event Model

**协议名：** Workforce Event Protocol  
**协议版本：** `0.1`  
**状态：** Draft  
**日期：** 2026-09-10

## 1. 目的

Event Model 是 Workforce 的事实记录与实时观察协议。所有重要状态变化、Runtime 活动、安全决策和人工操作都以不可变 Event 表达，使系统能够重建执行历史、驱动 UI、恢复任务、审计责任并计算运行指标。

原则：

- Event 表达已经发生的事实，不表达待执行命令
- 业务状态由受控事务修改；Event 是该状态变化的持久化记录
- Domain Event、Runtime Event 与 Audit Event 使用同一 Envelope，但语义和保留策略不同
- 核心消费者只依赖标准字段；Runtime 私有信息放入命名空间扩展
- 至少一次投递，消费者必须幂等
- Event 不得成为 Credential、Prompt 全文或敏感文件内容的泄露通道

## 2. Event Envelope

```ts
interface WorkforceEvent<T = unknown> {
  specVersion: "0.1";
  id: string;
  type: string;
  source: string;
  subject: {
    type: string;
    id: string;
  };
  time: string;
  recordedAt: string;
  organizationId?: string;
  projectId?: string;
  workflowInstanceId?: string;
  taskId?: string;
  runId?: string;
  actor: EventActor;
  sequence?: number;
  stream: string;
  correlationId: string;
  causationId?: string;
  trace?: {
    traceId: string;
    spanId?: string;
  };
  dataContentType: "application/json";
  dataSchema: string;
  data: T;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  redaction?: RedactionSummary;
  extensions?: Record<string, unknown>;
}
```

### 2.1 必需字段

| 字段 | 规则 |
|---|---|
| `id` | 全局唯一，推荐 UUIDv7；用于投递去重 |
| `type` | 小写点分命名，使用过去式，如 `task.completed` |
| `source` | 产生事实的逻辑组件，如 `workforce.workflow-engine` |
| `subject` | 事件主要实体，而非所有关联实体 |
| `time` | 事实发生时间，RFC 3339 UTC |
| `recordedAt` | 平台持久化时间，RFC 3339 UTC |
| `actor` | 触发动作的用户、Worker、Runtime 或系统 |
| `stream` | 顺序保证的事件流标识 |
| `correlationId` | 一次业务操作或执行链的关联标识 |
| `dataSchema` | Payload Schema 的稳定 URI/URN 与版本 |
| `data` | 事件特有负载，只保存必要信息 |

`time` 可由 Runtime 提供；`recordedAt` 只能由平台写入。计算延迟和审计时必须保留两者。

### 2.2 Actor

```ts
type EventActor =
  | { type: "user"; id: string }
  | { type: "worker"; id: string; workerVersionId?: string }
  | { type: "runtime"; id: string; adapterVersion?: string }
  | { type: "service"; id: string }
  | { type: "system"; id: "workforce" };
```

服务代理用户执行动作时，`actor` 记录直接执行者，并在 `data.onBehalfOf` 记录授权主体；禁止覆盖原始身份。

## 3. Taxonomy 与命名

标准事件分为四类：

| 类别 | 命名空间 | 用途 | 示例 |
|---|---|---|---|
| Domain | 领域对象 | 驱动业务状态和投影 | `task.ready`, `approval.requested` |
| Runtime | `runtime.*` / `tool.*` | 归一化执行过程 | `runtime.started`, `tool.completed` |
| Artifact | `artifact.*` | 产物生命周期与血缘 | `artifact.created`, `artifact.verified` |
| Audit/Security | `audit.*` / `policy.*` | 安全、权限和人工责任 | `policy.denied`, `audit.credential.used` |

命名规则：

- 使用 `<aggregate>.<past-tense>`，不在名称中携带版本
- 状态事件只描述真实转换：`run.completed`，不用含糊的 `run.updated`
- 数据量事件可用 `runtime.output.appended`，但不能把 stdout 内容塞进事件名称
- 自定义扩展使用反向域或厂商命名空间，如 `runtime.openai.codex.turn_completed`
- 新字段向后兼容；语义变化创建新 Schema 版本，必要时创建新 Event Type

## 4. Domain Events

V0.1 标准集合：

```text
project.created              workflow.instance.created
project.updated              workflow.instance.started
                              workflow.instance.completed
team.assigned                 workflow.instance.failed
worker.assigned
worker.unassigned             task.created
                              task.revised
task.ready                    task.assigned
task.blocked                  task.started
task.waiting_review           task.completed
task.failed                   task.cancelled

run.created                   run.started
run.paused                    run.resumed
run.retry_scheduled           run.completed
run.failed                    run.cancelled

approval.requested            approval.approved
approval.rejected             approval.changes_requested
approval.expired              approval.cancelled

budget.threshold_reached      budget.exceeded
evaluation.completed
```

领域状态转换应在同一数据库事务中写入实体状态和 Outbox Event。Event 发布失败不得导致状态事实丢失。

## 5. Runtime 与 Tool Events

Adapter 必须把供应商输出转换为以下标准事件：

```text
runtime.starting
runtime.started
runtime.heartbeat
runtime.message.created
runtime.output.appended
runtime.waiting_input
runtime.usage.reported
runtime.warning
runtime.completed
runtime.failed
runtime.cancelled

tool.started
tool.output.appended
tool.completed
tool.failed

workspace.file.changed
workspace.command.started
workspace.command.completed
```

约束：

- Runtime Event 是执行观察，不可直接绕过 Workflow Engine 修改 Task 最终状态
- 高频 stdout/stderr 必须分块、限速；大块内容写入 Blob/Log Storage，Event 仅携带 `contentRef`
- `runtime.completed` 只表示 Runtime 退出成功；Task 是否完成仍由输出验证和 Workflow 决定
- `runtime.heartbeat` 可短期保留或聚合，不作为业务完成依据
- 原始厂商 Payload 仅允许放入 `extensions["vendor.<name>"]`，且必须经过大小限制和脱敏

示例：

```json
{
  "specVersion": "0.1",
  "id": "evt_01J...",
  "type": "tool.completed",
  "source": "workforce.runtime-adapter.codex",
  "subject": { "type": "tool_call", "id": "call_01J..." },
  "time": "2026-09-10T09:16:03.241Z",
  "recordedAt": "2026-09-10T09:16:03.260Z",
  "projectId": "prj_01J...",
  "taskId": "tsk_01J...",
  "runId": "run_01J...",
  "actor": { "type": "runtime", "id": "rt_codex_local" },
  "stream": "run/run_01J...",
  "sequence": 18,
  "correlationId": "run_01J...",
  "causationId": "evt_tool_started_01J...",
  "trace": { "traceId": "5b8...", "spanId": "9aa..." },
  "dataContentType": "application/json",
  "dataSchema": "urn:workforce:event:tool.completed:0.1",
  "data": {
    "toolCallId": "call_01J...",
    "tool": "shell",
    "outcome": "success",
    "exitCode": 0,
    "durationMs": 1240,
    "outputRef": "log://run_01J.../call_01J..."
  },
  "sensitivity": "internal"
}
```

## 6. Artifact Events 与 Lineage

```text
artifact.declared
artifact.created
artifact.version_created
artifact.verified
artifact.rejected
artifact.published
artifact.archived
artifact.lineage_linked
```

`artifact.created` 必须包含 `artifactId`、`version`、`kind`、`mediaType`、`storageRef`、`integrity`、`createdBy` 和来源 `runId`。内容本身不进入 Event。

`artifact.lineage_linked` 表达有向边：

```json
{
  "fromArtifactId": "art_sources",
  "fromVersion": 2,
  "toArtifactId": "art_report",
  "toVersion": 1,
  "relation": "derived_from"
}
```

## 7. Audit 与 Security Events

审计事件独立于普通活动日志，必须追加写且访问受限：

```text
audit.user.signed_in
audit.settings.changed
audit.credential.created
audit.credential.used
audit.credential.revoked
audit.artifact.accessed
audit.data.exported

policy.allowed
policy.denied
policy.approval_required
permission.granted
permission.revoked
```

审计 Payload 记录 `principal`、`action`、`resource`、决策、Policy 版本、请求来源和理由码。禁止记录 Credential value、Authorization header、完整环境变量或密钥衍生值。

高频 `policy.allowed` 可按策略采样，但 Credential 使用、拒绝、权限变更、导出和破坏性操作不得采样。

## 8. Ordering、Sequence 与时间

系统不承诺全局顺序，只保证单个 `stream` 内的逻辑顺序。

- Aggregate Stream：`task/{taskId}`、`approval/{approvalId}`
- Execution Stream：`run/{runId}`
- Audit Stream：`organization/{organizationId}/audit`
- `sequence` 在同一 Stream 内从 1 单调递增且唯一
- 事件跨 Stream 的先后关系使用 `causationId`，不能依赖时间戳排序
- 并发写同一 Stream 使用乐观并发控制，提交时提供 expected sequence
- Runtime 离线缓存事件可晚到；平台分配最终 `recordedAt` 和 Stream sequence
- 时钟偏差不得改变业务状态机判断

投影消费者发现 sequence gap 时必须暂停该 Stream、补拉缺失事件，然后继续；不能静默跳过。

## 9. Correlation、Causation 与 Trace

三个标识用途不同：

| 字段 | 回答的问题 |
|---|---|
| `correlationId` | 哪些事件属于同一次用户操作、Run 或业务链？ |
| `causationId` | 哪一个 Event/Command 直接导致此 Event？ |
| `trace.traceId` | 哪些同步及异步调用属于同一技术 Trace？ |

规则：

- 创建 Run 时，后续执行事件默认使用 `runId` 作为 correlation ID
- 重试产生新 Run；Workflow 级 correlation ID 通过 `data.workflowCorrelationId` 保留
- 根事件没有 `causationId`
- 一个 Event 只有一个直接 cause；多个业务依赖放在 `data.relatedEventIds`
- Trace ID 可以缺失，不得用 Trace 替代持久业务关联

## 10. Delivery 与 Idempotency

V0.1 采用 **transactional outbox + at-least-once delivery**：

1. 领域事务写状态和 Outbox Event。
2. Publisher 按 Stream 顺序投递。
3. 消费者以 `consumerId + eventId` 记录处理结果。
4. 成功后确认；失败按退避策略重试。
5. 超过上限进入 Dead Letter，并创建告警事件。

要求：

- Producer 重试必须复用原 `event.id` 或稳定 idempotency key
- Consumer 必须让重复 Event 成为 no-op
- 外部副作用使用 Inbox/Outbox 或单独的 action idempotency key
- WebSocket/SSE 只是通知通道；断线后客户端按 cursor 从持久 Event API 补拉
- 不承诺 exactly-once；UI 不得因重复 Event 重复弹窗或重复累加用量

## 11. Storage、Projection 与 Retention

建议存储分层：

| 层 | 内容 | V0.1 |
|---|---|---|
| Event Store | 标准 Envelope 与小型 Payload | SQLite 追加表 |
| Outbox | 待发布 Event | 与领域事务同库 |
| Projection | Task/Run 状态、活动流、统计 | 可重建的查询表 |
| Log/Blob Store | stdout、stderr、大 Payload | 本地文件 + content hash |
| Audit Store | 高价值安全事件 | 独立逻辑表与访问策略 |

V0.1 默认建议：

- Domain、Artifact、Approval 和关键 Audit Event：项目存续期内保留
- Runtime heartbeat：7 天或压缩为区间摘要
- stdout/stderr：默认 30 天，可由 Project Policy 调整
- Telemetry 聚合数据：90 天
- 用户删除 Project 时执行可验证删除流程，但安全或合规留存优先遵循组织 Policy

Event Store 不支持原地修改。需要纠正时追加 `*.corrected` 或补偿 Event；加密擦除可通过删除独立数据密钥使敏感 Payload 不可恢复。

## 12. Redaction 与数据安全

事件进入持久层前必须经过 Redaction Pipeline：

1. 按字段 Schema 删除禁止字段。
2. 检测 token、密码、私钥、Authorization header 和常见连接串。
3. 对路径、用户名、邮件等按 Policy 掩码或哈希。
4. 超大文本转存受控 Blob，只留下引用。
5. 记录脱敏规则版本和命中数量，不记录原值。

```ts
interface RedactionSummary {
  applied: boolean;
  policyVersion: string;
  categories: string[];
  replacements: number;
}
```

敏感级别控制同步、导出和 UI 展示：`restricted` Event 默认不上传云端、不进入普通搜索索引，且只能由授权主体读取。

## 13. Schema Registry 与兼容性

每个标准 Event Type 对应 JSON Schema：

```text
schemas/events/0.1/envelope.schema.json
schemas/events/0.1/task.completed.schema.json
schemas/events/0.1/runtime.output.appended.schema.json
```

兼容规则：

- Envelope `specVersion` 与 Payload `dataSchema` 分开版本化
- minor 版本只能新增可选字段或允许接收方忽略的新枚举值
- 删除、重命名、改变单位或收紧约束需要 major 版本
- Producer 在写入前校验；Adapter contract test 校验全部标准事件
- 未知扩展应保留并转发；未知核心 major 版本应拒绝并产生兼容性告警
- 时间、金额、token、字节和持续时间单位必须显式；持续时间统一用 `*Ms`

`task.completed` Payload 示例：

```json
{
  "taskId": "tsk_01J...",
  "taskRevision": 3,
  "runId": "run_01J...",
  "outputArtifactRefs": [
    { "artifactId": "art_01J...", "version": 1 }
  ],
  "acceptance": {
    "status": "passed",
    "evaluationId": "eval_01J..."
  },
  "completedAt": "2026-09-10T09:20:11.000Z"
}
```

## 14. Observability Mapping

Event、Log、Metric 和 Trace 各自承担不同职责：

| 信号 | 用途 | 映射 |
|---|---|---|
| Event | 持久业务事实 | Run/Task timeline、replay、audit |
| Log | 详细诊断文本 | 通过 `eventId/runId/traceId` 关联 |
| Metric | 聚合趋势与告警 | 从事件计算 counter/histogram/gauge |
| Trace | 请求与调用路径 | Envelope 携带 W3C trace context 标识 |

基础指标：

- `workforce_runs_total{status,runtime}`
- `workforce_run_duration_ms{runtime,worker_role}`
- `workforce_task_retries_total{reason}`
- `workforce_runtime_cost_total{provider,model}`
- `workforce_approval_wait_ms{outcome}`
- `workforce_event_delivery_lag_ms{consumer}`
- `workforce_event_dead_letters_total{type}`

禁止把 `taskId`、`runId`、用户 ID 或文件路径作为 Metric label，避免高基数和敏感信息泄露。

## 15. Replay 与状态重建

V0.1 的 Event Store 支持重建查询投影和 Timeline，但不承诺仅靠 Event 完整重建所有领域对象；领域表仍是当前状态主存储。

Replay 分为：

- **Projection replay**：从 Event 重建活动流、统计和搜索投影，不产生外部副作用
- **Execution replay**：从历史 Task/Run 快照创建新 Run，生成新的 Event ID 和 correlation ID

任何 Replay 都不能重新发送邮件、提交 PR 或执行命令，除非通过新 Command 明确授权。历史 Event 永远不改写。

## 16. V0.1 实现范围

V0.1 必须实现：

- 统一 Event Envelope 与 JSON Schema 校验
- Task、Run、Approval、Artifact 的关键 Domain Events
- Codex Adapter 的标准 Runtime/Tool Events
- 单 Stream sequence 和乐观并发
- correlation、causation 与可选 trace context
- SQLite Event Store、transactional outbox 和 consumer cursor
- 至少一次投递、去重与 Dead Letter
- SSE/WebSocket 实时订阅及断线补拉
- stdout/stderr 的外部存储引用、大小和速率限制
- 写入前 secret redaction
- Task/Run Timeline 与基础 metrics

V0.1 明确不做：

- 跨区域全局 Event Bus
- exactly-once delivery 承诺
- 完整 Event Sourcing 领域模型
- 任意用户自定义 Schema 执行业务逻辑
- 无限期保留所有 Runtime 输出
- 自动对历史外部副作用进行 Replay
- Kafka/Pulsar 等分布式日志基础设施

## 17. 验收标准

Event Model 达到可实现状态需满足：

1. 同一 Run 的 Timeline 在重复投递、断线和晚到事件后仍保持确定顺序。
2. Task 状态变化与对应 Event 不会出现一方提交、一方丢失。
3. 重复消费不会重复更新 Projection、累计费用或触发通知。
4. Event 中注入测试密钥后，持久层与 UI 均无法读取原值。
5. Runtime 输出超过限制时自动转存，Event 仍可定位完整受控日志。
6. 从 cursor 恢复订阅不会漏掉持久事件。
7. Domain、Runtime、Audit Event 均能以 `taskId/runId/correlationId` 形成可查询执行链。
8. Schema contract tests 能阻止不兼容 Payload 发布。

该协议使 Workforce 的执行过程从临时日志升级为可持久化、可追踪、可恢复和可治理的事实流，同时避免把 V0.1 过早建设成复杂的分布式 Event Sourcing 系统。
