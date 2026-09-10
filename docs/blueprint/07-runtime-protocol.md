# Workforce — Runtime Protocol

**协议名：** Workforce Runtime Protocol  
**协议版本：** `0.1`  
**状态：** Draft  
**日期：** 2026-09-10

## 1. 目的

Runtime Protocol 定义 Workforce Platform 与 Codex、Claude Code、自定义 Agent 等执行引擎之间的稳定边界。平台负责 Task、Run、Workflow、Policy 和持久化；Adapter 负责把通用调用翻译为特定 Runtime 的进程、SDK 或 API 操作。

协议目标：

- Worker/Role 与具体 Runtime 解耦
- 在启动前发现并验证 Runtime 能力
- 统一启动、输入、暂停、恢复、取消、查询和事件流
- 支持 Daemon 重启后的执行对账与恢复
- 对 Runtime 特有信息保留可审计、带命名空间的扩展
- 让 Adapter 可通过同一套契约测试独立演进

本协议不定义 Task 的业务状态机、Agent 内部推理、模型 Prompt 或 Artifact 的存储格式。

## 2. 角色与责任边界

| 组件 | 负责 | 不负责 |
|---|---|---|
| Workflow Engine | 创建 Run、状态转换、重试和审批 | 直接操作 Runtime 进程 |
| Runtime Host | Adapter 生命周期、调用路由、事件归一化 | Task 路由和验收 |
| Runtime Adapter | 协议翻译、进程/SDK/API 控制、状态探测 | 直接修改 Task/Run 数据 |
| Runtime | 实际执行、工具调用、生成候选输出 | 平台策略和业务状态 |
| Event Store | 保存标准事件及允许的原始扩展 | 控制 Runtime |
| Workspace Manager | 分配路径、Git worktree 和访问边界 | 解释 Agent 输出 |

关键不变量：

1. Adapter 只能返回结果或发出事件，不能直接写 Task、Run 或 Workflow 表。
2. Runtime 报告的 `completed` 仅代表执行结束候选；平台验收后才决定 Run 是否成功。
3. 每次重试创建新 Run 和新 Runtime Handle。
4. Run 启动后绑定不可变的 Task、Worker、Policy、Workspace 与 Runtime 快照。
5. Credential 明文不得进入请求快照、事件、日志或 Artifact 元数据。

## 3. 协议 Envelope

跨进程实现可使用 JSON-RPC、IPC 或 WebSocket，但语义必须一致：

```json
{
  "protocol": "workforce.runtime",
  "protocolVersion": "0.1",
  "requestId": "req_01J...",
  "method": "runtime.start",
  "params": {},
  "sentAt": "2026-09-10T00:00:00Z"
}
```

成功响应：

```json
{
  "requestId": "req_01J...",
  "ok": true,
  "result": {}
}
```

失败响应：

```json
{
  "requestId": "req_01J...",
  "ok": false,
  "error": {
    "code": "RUNTIME_NOT_AVAILABLE",
    "message": "Codex executable was not found",
    "retryable": false,
    "details": {}
  }
}
```

## 4. Adapter SPI

```ts
interface RuntimeAdapter {
  describe(): Promise<RuntimeDescriptor>;
  validate(config: RuntimeConfig): Promise<ValidationResult>;
  start(request: StartRunRequest): Promise<RuntimeHandle>;
  sendInput(handle: RuntimeHandleRef, input: RuntimeInput): Promise<InputReceipt>;
  pause?(handle: RuntimeHandleRef): Promise<OperationReceipt>;
  resume?(handle: RuntimeHandleRef): Promise<OperationReceipt>;
  cancel(handle: RuntimeHandleRef, reason?: string): Promise<OperationReceipt>;
  inspect(handle: RuntimeHandleRef): Promise<RuntimeStatus>;
  stream(handle: RuntimeHandleRef, cursor?: EventCursor): AsyncIterable<RuntimeEvent>;
  reconcile(handle: RuntimeHandle): Promise<ReconciliationResult>;
  dispose?(): Promise<void>;
}
```

SPI 方法必须：

- 接受经过 Schema 验证的输入
- 支持超时和取消信号
- 返回结构化错误，不把异常字符串作为协议
- 对重复请求提供规定的幂等行为
- 不把 Runtime 原始状态直接冒充平台状态

`validate` 只做可用性和配置检查，不启动真实工作。检查可包括 executable、版本、身份状态、必要目录和平台兼容性。

## 5. Runtime Descriptor 与能力发现

```ts
interface RuntimeDescriptor {
  adapter: {
    id: string;
    name: string;
    version: string;
    protocolVersions: string[];
  };
  runtime: {
    id: string;
    displayName: string;
    version?: string;
    transport: "process" | "sdk" | "http" | "remote";
  };
  platforms: Array<"windows" | "macos" | "linux">;
  capabilities: RuntimeCapability[];
  limits: RuntimeLimits;
  extensions?: Record<string, unknown>;
}
```

能力声明示例：

```json
{
  "name": "filesystem.write",
  "version": "1.0",
  "available": true,
  "features": ["workspace_scoped"],
  "constraints": { "maxFileBytes": 104857600 }
}
```

标准能力命名：

| 能力 | 含义 |
|---|---|
| `coding` | 理解和修改代码 |
| `terminal` | 执行允许的命令 |
| `terminal.pty` | 交互式终端 |
| `filesystem.read` | 读取 Workspace |
| `filesystem.write` | 修改 Workspace |
| `git.diff` | 读取 Git diff |
| `git.commit` | 创建 Commit |
| `network` | 访问 Policy 允许的网络 |
| `interactive_input` | 执行中接收输入 |
| `lifecycle.pause` | 原生暂停和恢复 |
| `event.resume` | 从事件 cursor 续流 |
| `usage.reporting` | 报告 token/费用等用量 |

能力发现必须反映当前机器和当前配置，而不是 Adapter 的理论能力。动态变化时，Host 重新调用 `describe`/`validate` 并更新带时间戳的 Runtime Profile；已启动 Run 继续使用启动快照。

## 6. 配置与验证

```ts
interface RuntimeConfig {
  adapterId: string;
  executable?: string;
  transport?: Record<string, unknown>;
  credentialRefs?: string[];
  options?: Record<string, unknown>;
}

interface ValidationResult {
  valid: boolean;
  runtimeVersion?: string;
  checks: Array<{
    name: string;
    status: "pass" | "warn" | "fail";
    message?: string;
  }>;
}
```

未知配置字段默认拒绝；Adapter 专有字段必须置于 `options.<adapterId>` 命名空间并由 Adapter Schema 验证。Credential 只传引用，Runtime Host 在 Policy 允许时以最小范围注入。

## 7. 启动 Run

```ts
interface StartRunRequest {
  operationId: string;
  runId: string;
  taskSnapshot: TaskExecutionSnapshot;
  workerSnapshot: WorkerExecutionSnapshot;
  runtimeSnapshot: RuntimeProfileSnapshot;
  contextBundleRef: string;
  workspace: WorkspaceGrant;
  permissionGrant: PermissionGrant;
  credentialRefs: string[];
  budget: RunBudget;
  deadline?: string;
  environment: Record<string, string>;
  extensions?: Record<string, unknown>;
}
```

启动规则：

- `operationId` 是幂等键；同一 Adapter 中重复请求必须返回同一 Handle 或确定性冲突。
- Adapter 必须在启动前再次检查关键能力、Workspace 和 Permission Grant。
- `environment` 只能包含平台批准的最小变量集合。
- Adapter 必须先建立事件捕获，再启动 Runtime，避免丢失首批输出。
- 成功返回 Handle 不等于 Runtime 已完成初始化；`runtime.started` 事件才表示已进入执行态。
- 启动部分失败时必须清理已创建的进程和临时资源，并返回结构化错误。

## 8. Runtime Handle

```ts
interface RuntimeHandle {
  handleId: string;
  runId: string;
  adapterId: string;
  adapterVersion: string;
  runtimeVersion?: string;
  createdAt: string;
  process?: {
    pid: number;
    startIdentity: string;
  };
  session?: {
    id: string;
    resumeTokenRef?: string;
  };
  transport?: Record<string, unknown>;
  lastCursor?: string;
}
```

Handle 是恢复执行所需的最小不透明状态，由平台加密持久化。`pid` 单独不足以标识进程，必须结合启动时间、平台进程标识或等价 identity，防止 PID 复用误杀其他进程。Handle 中禁止保存 Credential 明文；敏感 session token 只能保存安全存储引用。

## 9. 控制操作

### 9.1 `runtime.input`

```ts
type RuntimeInput =
  | { type: "text"; content: string; sensitive?: false }
  | { type: "approval"; approvalId: string; decision: "approved" | "rejected" }
  | { type: "artifact_ref"; artifactId: string; version: number }
  | { type: "signal"; name: string; payload?: unknown };
```

每个输入带独立 `operationId`。Adapter 返回 receipt；receipt 只证明已接受，不证明 Runtime 已处理。敏感值不能通过普通文本输入传递。

### 9.2 `runtime.pause` / `runtime.resume`

- 仅当 Descriptor 声明 `lifecycle.pause` 时可调用。
- `pause` 必须说明是原生挂起、Runtime checkpoint，还是仅停止调度新动作。
- 不支持暂停时返回 `UNSUPPORTED_OPERATION`，平台不得把它模拟成成功。
- 恢复后事件 sequence 继续递增，不重新开始。

### 9.3 `runtime.cancel`

取消是幂等操作，采用分阶段终止：

1. 请求 Runtime 优雅停止。
2. 等待配置的 grace period。
3. 必要时终止完整进程树。
4. 发出 `runtime.cancelled` 或 `runtime.orphaned`。

已终止 Handle 再次取消返回成功 receipt 和当前终态。Adapter 不得通过宽泛进程名杀死其他 Run。

### 9.4 `runtime.status`

```ts
type RuntimeExecutionState =
  | "starting"
  | "running"
  | "waiting_input"
  | "paused"
  | "completing"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"
  | "orphaned";

interface RuntimeStatus {
  state: RuntimeExecutionState;
  observedAt: string;
  heartbeatAt?: string;
  exitCode?: number;
  signal?: string;
  lastCursor?: string;
  usage?: RuntimeUsage;
}
```

该状态是外部执行状态，不直接等同于领域 `RunStatus`。

## 10. Event Streaming

```ts
interface RuntimeEvent<T = unknown> {
  protocol: "workforce.runtime.event";
  schemaVersion: "0.1";
  id: string;
  runId: string;
  handleId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  observedAt: string;
  payload: T;
  correlationId?: string;
  causationId?: string;
  raw?: { namespace: string; payload: unknown };
}
```

V0.1 标准事件：

| 事件 | 说明 |
|---|---|
| `runtime.starting` | 已接受启动请求 |
| `runtime.started` | Runtime 已进入执行态 |
| `runtime.message` | 面向用户或系统的结构化消息 |
| `runtime.command.started` | 工具或命令开始 |
| `runtime.command.output` | stdout/stderr 分片 |
| `runtime.command.completed` | 命令结束及 exit code |
| `runtime.file.changed` | Workspace 文件变化提示 |
| `runtime.artifact.proposed` | 候选 Artifact 引用 |
| `runtime.input.requested` | 等待用户、审批或结构化输入 |
| `runtime.usage.updated` | token、费用、时间或工具用量 |
| `runtime.heartbeat` | 活性信号 |
| `runtime.paused` | 已暂停 |
| `runtime.resumed` | 已恢复 |
| `runtime.completed` | Runtime 正常退出并给出候选结果 |
| `runtime.failed` | Runtime 执行失败 |
| `runtime.cancelled` | 已确认取消 |
| `runtime.orphaned` | 无法确认或控制原执行 |

### 10.1 顺序与交付

- 同一 Handle 的 `sequence` 从 1 开始严格递增。
- V0.1 采用 at-least-once 交付；Event Store 以 `event.id` 去重。
- 重连时传入 `lastCursor`；不支持续流的 Adapter 必须明确声明。
- 检测到 sequence 缺口时先 `inspect`/`reconcile`，不得假定缺失事件成功。
- 大型 stdout、二进制数据和完整文件不能内嵌事件；写入受控 blob 后只传引用。
- `raw` 仅供调试，必须限长、脱敏，并使用如 `openai.codex` 的命名空间。

### 10.2 背压

Host 对高频输出实施有界队列。Adapter 应支持合并输出分片；队列达到上限时可以把低价值输出落入日志 blob 并发出摘要引用，但不得丢弃生命周期、错误、用量、Artifact 或审批事件。

## 11. 对账与恢复

Daemon 启动时扫描非终态 Run，对每个持久化 Handle 调用 `reconcile`：

```ts
type ReconciliationResult =
  | { outcome: "attached"; status: RuntimeStatus; nextCursor?: string }
  | { outcome: "completed"; status: RuntimeStatus }
  | { outcome: "not_found"; reason?: string }
  | { outcome: "identity_mismatch"; reason: string }
  | { outcome: "unreachable"; retryAfterMs?: number };
```

处理规则：

- `attached`：续接事件流并补齐状态。
- `completed`：摄取剩余事件，由 Workflow Engine 完成验收。
- `not_found`：标记 Runtime 丢失，并按 Run Policy 决定失败或重试。
- `identity_mismatch`：绝不控制当前 PID，标记 orphaned 并告警。
- `unreachable`：保持恢复中，按退避策略重试，超过期限再升级。

对账必须可重复执行；它只能报告事实，最终 Run 状态由 Workflow Engine 决定。远程 Runtime 应使用 session identity/lease；本地进程使用 process identity 和 Workspace lease。

## 12. 错误模型

```ts
interface RuntimeProtocolError {
  code: string;
  message: string;
  retryable: boolean;
  category:
    | "configuration"
    | "capability"
    | "permission"
    | "authentication"
    | "transport"
    | "runtime"
    | "resource"
    | "protocol"
    | "internal";
  details?: Record<string, unknown>;
  causeRef?: string;
}
```

标准错误码：

| Code | 默认可重试 | 含义 |
|---|---:|---|
| `INVALID_REQUEST` | 否 | 请求不符合 Schema |
| `UNSUPPORTED_PROTOCOL` | 否 | 不支持协议 major 版本 |
| `UNSUPPORTED_OPERATION` | 否 | Runtime 不支持该操作 |
| `CAPABILITY_MISMATCH` | 否 | 所需能力缺失 |
| `RUNTIME_NOT_AVAILABLE` | 视情况 | executable/服务不可用 |
| `AUTHENTICATION_REQUIRED` | 否 | 需要用户完成身份配置 |
| `PERMISSION_DENIED` | 否 | Policy 或 OS 拒绝 |
| `WORKSPACE_UNAVAILABLE` | 视情况 | Workspace 无法访问 |
| `START_FAILED` | 视情况 | Runtime 启动失败 |
| `TRANSPORT_LOST` | 是 | IPC/网络中断 |
| `TIMEOUT` | 是 | 操作或 Runtime 超时 |
| `RESOURCE_EXHAUSTED` | 视情况 | 内存、磁盘或并发不足 |
| `RUNTIME_EXITED` | 视 exit | 非预期退出 |
| `HANDLE_NOT_FOUND` | 否 | Handle 不存在 |
| `HANDLE_IDENTITY_MISMATCH` | 否 | 句柄与进程不匹配 |
| `EVENT_GAP` | 是 | 事件序列不连续 |

`retryable` 是 Adapter 基于当前错误给出的建议；是否重试仍由平台的 Task/Run Policy 决定。错误 message 必须适合日志展示且已脱敏。

## 13. 安全模型

Runtime Protocol 执行以下最小安全基线：

- 启动请求携带显式 WorkspaceGrant 与 PermissionGrant，默认拒绝未声明能力。
- Workspace 路径由 Workspace Manager 解析；Adapter 不接受 Runtime 返回的任意宿主路径作为授权依据。
- Credential Broker 只在操作时解析 `credentialRef`，最小范围、最短生命周期注入。
- 禁止把 Credential 放入 Task Prompt、普通环境快照、事件或 stdout 持久化。
- Host 在持久化 Event、raw payload 和日志前统一脱敏并执行 secret scanning。
- Shell 参数使用 argv 传递；不得拼接未经验证的 shell 字符串。
- 取消本地 Runtime 时只控制经过 identity 校验的进程树。
- Adapter 包未来需要签名、来源验证和版本锁定；V0.1 只加载内置 Adapter。
- 网络、文件和命令授权由 Policy/Sandbox 决定，能力声明本身不是权限。

V0.1 Node.js Daemon 和 Codex CLI Adapter 不构成强安全沙箱。只有受信用户应运行本地执行；高风险目录、生产 Credential 和 unrestricted shell 默认禁止。

## 14. 协议与 Adapter 版本

- `protocolVersion` 使用 `major.minor`；未知 major 必须拒绝。
- minor 版本可增加可选字段、事件类型或能力，不改变已有语义。
- Adapter 使用独立 SemVer；Run 快照记录 Adapter、Runtime、模型和协议版本。
- Adapter 必须声明支持的协议版本范围，Host 启动时协商最高共同版本。
- 新增 Runtime 专有字段只能进入 namespaced `extensions`/`raw`。
- 已持久化事件不可原地迁写；读取层按 `schemaVersion` 转换。
- Adapter 升级不得改变运行中 Handle 的解释方式；不能兼容时旧 Adapter 必须保留至 Run 终止或明确迁移。

## 15. Codex Adapter 示例

### 15.1 Descriptor 摘要

```json
{
  "adapter": {
    "id": "workforce.runtime.codex",
    "name": "Codex Adapter",
    "version": "0.1.0",
    "protocolVersions": ["0.1"]
  },
  "runtime": {
    "id": "codex-cli",
    "displayName": "Codex CLI",
    "version": "detected-at-runtime",
    "transport": "process"
  },
  "platforms": ["windows", "macos", "linux"],
  "capabilities": [
    { "name": "coding", "version": "1.0", "available": true },
    { "name": "filesystem.write", "version": "1.0", "available": true },
    { "name": "terminal", "version": "1.0", "available": true },
    { "name": "interactive_input", "version": "1.0", "available": true }
  ]
}
```

### 15.2 执行流程

1. `validate` 检测 Codex executable、版本、登录状态及 Workspace 可访问性。
2. Host 创建事件订阅和受控环境。
3. `start` 以 argv 启动 CLI，cwd 固定为 Run Workspace。
4. Adapter 将 CLI/SDK 输出翻译为标准事件；原始字段置于 `raw.openai.codex`。
5. Codex 请求输入时发出 `runtime.input.requested`。
6. 文件变化由 Codex 事件与 Workspace watcher 交叉确认，候选输出转为 Artifact proposal。
7. Codex 退出后发出 `runtime.completed` 或 `runtime.failed`；平台再运行验收。

简化请求：

```json
{
  "method": "runtime.start",
  "params": {
    "operationId": "op_01J...",
    "runId": "run_01J...",
    "workspace": {
      "workspaceId": "wsp_01J...",
      "root": "/managed/workspaces/run_01J...",
      "mode": "read_write"
    },
    "taskSnapshot": {
      "objective": "Implement authentication and make tests pass"
    },
    "credentialRefs": [],
    "extensions": {
      "workforce.runtime.codex": {
        "approvalMode": "on_request"
      }
    }
  }
}
```

Codex CLI 的具体参数和输出格式属于 Adapter 内部实现，不进入通用协议。

## 16. Contract Test Suite

`packages/runtime-sdk` 提供所有 Adapter 必须通过的黑盒契约测试：

### 16.1 Descriptor 与 Schema

- Descriptor 符合 Schema，ID 和版本稳定
- 声明的平台、能力与实际验证一致
- 未知 major 协议被拒绝
- Adapter 专有字段严格位于命名空间

### 16.2 生命周期

- 同一 `operationId` 重复 start 不创建第二个执行
- start 后先出现合法启动事件，再进入终态
- cancel 幂等且不会影响其他 Run
- 支持 pause 的 Adapter 可暂停/恢复；不支持者返回标准错误
- 输入 receipt 与后续处理事件语义分离

### 16.3 Event

- 同一 Handle sequence 严格递增
- 重连 cursor 不漏关键事件；重复事件可按 ID 去重
- 输出背压不丢生命周期、错误、用量和 Artifact 事件
- raw payload 有命名空间、限长并经过脱敏

### 16.4 Recovery

- Host 重启后可根据 Handle reconcile
- PID/session identity 不匹配时不得附着或终止目标
- 已完成 Runtime 可恢复终态与剩余事件
- 不可达 Runtime 返回可区分的 `unreachable`，而非伪造失败

### 16.5 Security

- Credential 明文不会出现在 Handle、Event 和日志
- Workspace 外路径请求被拒绝
- 命令参数不经过不安全 shell 拼接
- Permission Grant 缺失时默认拒绝操作

契约测试使用 Mock Runtime；Codex Adapter 另有可选本机集成测试，CI 不依赖真实账号执行付费任务。

## 17. V0.1 范围

### 17.1 包含

- TypeScript Runtime SPI 与 JSON Schema
- 进程内/IPC Runtime Host
- Mock Runtime Adapter
- Codex CLI Adapter 的单机、单用户路径
- `describe`、`validate`、`start`、`sendInput`、`cancel`、`inspect`、`stream`、`reconcile`
- 标准生命周期、消息、命令、文件、Artifact、用量和错误事件
- 持久化 Handle、Daemon 重启扫描与基础 reconcile
- Windows、macOS、Linux 的路径和进程抽象
- 有界日志、事件去重和统一脱敏
- Adapter Contract Test Suite

### 17.2 可选能力

- `pause` / `resume`：仅在 Codex 接入方式真实支持时启用
- cursor 续流：Runtime 不支持时由 Host 的持久化缓冲提供有限恢复
- 精确费用：Runtime 无法提供时仅记录已知 token、时长和工具次数

### 17.3 明确不包含

- 公共第三方 Adapter Marketplace
- 动态下载或执行未签名 Adapter
- Claude Code 完整 Adapter
- 多机远程 Runtime 调度和租约集群
- 完整 OS 级 Sandbox
- 任意 Runtime 之间的会话迁移
- Exactly-once 事件交付
- Runtime 内部思维链采集
- Adapter 直接提交、合并或部署的特殊权限捷径

## 18. 验收标准

Runtime Protocol V0.1 在以下条件满足时可冻结：

1. Mock Adapter 通过全部必选契约测试。
2. Codex Adapter 可在三平台至少完成启动、流式观察、取消和终态报告。
3. 同一启动请求不会产生重复 Runtime。
4. Daemon 被强制终止并重启后，可以安全 reconcile 或明确标记 orphaned。
5. Event sequence、去重、背压和脱敏行为可自动验证。
6. Adapter 无权直接改变 Task/Run 状态。
7. Workspace、Permission 和 Credential 边界通过安全测试。
8. 一个 Codex 执行可产生候选 Artifact，并由平台而非 Runtime 完成验收。

## 19. 后续文档依赖

- Event Model 将冻结标准 Runtime Event payload、Event Store 与订阅语义。
- Database Schema 将定义 Handle、Runtime Profile、Event cursor 与 recovery lease 的持久化。
- API Design 将定义 Desktop/Daemon 如何暴露 Runtime 操作，而不会直接泄露 Adapter 实现。
- MVP Implementation Plan 将决定 Codex 的具体接入模式、三平台测试矩阵和安全限制。

本协议的核心判断是：**Runtime 是可替换的执行引擎；Adapter 是受约束的翻译层；平台才拥有 Run 的事实与决策权。**
