# M3 公共 ports

T02 将下列签名编码进 `packages/application/src/ports` 与 `packages/runtime-spi`。实现者只依赖这些接口；缺字段时提契约变更，不复制类型。

时钟与 ID 必须可注入。所有写命令带 `operationId`。

## Clock / Id / UnitOfWork

```ts
interface Clock { now(): Date }
interface IdGenerator { ulid(prefix: string): string }

interface UnitOfWork {
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
```

同事务必须能写：实体状态 + Event + Outbox。禁止在事务内 spawn 进程或写 Git。

## EventStore

```ts
interface EventStore {
  append(tx: Tx, event: WorkforceEvent): Promise<{ ingestionPosition: number }>;
  read(query: {
    stream?: string;
    afterIngestionPosition?: number;
    types?: string[];
    projectId?: string;
    limit: number;
  }): Promise<WorkforceEvent[]>;
}
```

SSE cursor 编码 `ingestionPosition` + 过滤摘要；过期返回 `event_cursor_expired`。

## CommandReceipt

```ts
interface CommandReceiptRepository {
  get(scope: ReceiptScope): Promise<CommandReceipt | null>;
  putPending(tx: Tx, receipt: CommandReceipt): Promise<void>;
  complete(tx: Tx, operationId: string, result: unknown): Promise<void>;
  fail(tx: Tx, operationId: string, error: ProtocolError): Promise<void>;
}

interface ReceiptScope {
  principalId: string;
  clientId: string;
  canonicalOperation: string;
  resource: string;
  idempotencyKey: string;
}
```

## RuntimeAdapter (SPI)

以蓝图 `07 §4` 为准，类型名冻结为：

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

`StartRunRequest` 是 **Adapter SPI 边界上的请求**，因此必须包含 D07 的 node/runtime/workspace binding：Application 只把已解析的绑定交给 Host，Host 用 `placement.executionNodeId` 校验目标节点（`packages/runtime-sdk` 的 `assertNode`/`bindingFor`）。

执行位置与编排方式**不进入 `StartRunRequest`**，它们冻结为 `packages/protocol/src/execution.ts` 的三条正交轴：

- `orchestrationMode` ∈ `workflow_bound | direct`：是否进入本次 Workflow 调度。`workflow_bound` 必须带 `executionSnapshotId`（Project Execution Snapshot），`direct` 必须不带；retry 创建新 Run 并保留模式，不改写旧 Run。
- `transport` ∈ `process | sdk | http`：Adapter 的接入方式，只能来自选定的 RuntimeProfile/RuntimeInstallation，客户端不得改写。`remote` **不是** transport 取值。
- `placement`：`placementIntent`（`automatic | local_only | remote_only | specific_node`，请求侧偏好、永不权威）与 `placementSnapshot`（已解析的唯一绑定：node、node session、RuntimeInstallation、WorkspaceInstance、lease/fencing）是两个不同对象。

解析顺序按 `blueprint/03` 与 `diagrams/node-scheduling-flow.md`：解析 placement intent → Policy/Budget/Approval → 选 Node + RuntimeInstallation → Lease/fencing → WorkspaceInstance → 解析 transport + orchestrationMode → 组装 `PlacementSnapshot` → 原子创建 Run + 冻结快照 + Event/Outbox。Run 进入 `starting` 前 `placementSnapshot` 必须完整；`placementIntent` 不得被当作已解析绑定使用。

## Workspace / Process / Policy / Artifact

```ts
interface WorkspaceService {
  bind(input: BindWorkspace): Promise<WorkspaceBinding>;
  provisionRunWorkspace(runId: string, baseSha: string): Promise<WorkspaceInstance>;
  captureDiff(instanceId: string): Promise<DiffArtifactProposal>;
}

interface ProcessController {
  spawn(req: SpawnRequest): Promise<ProcessHandle>;
  spawnCaptured(req: CapturedSpawnRequest): Promise<CapturedProcess>;
  cancel(handle: ProcessHandle, mode: "graceful" | "force"): Promise<void>;
  inspect(handle: ProcessHandle): Promise<ProcessStatus>;
}

interface CapturedSpawnRequest extends SpawnRequest {
  stdin?: Uint8Array;
}

interface CapturedProcess {
  handle: ProcessHandle;
  /** Single-consumer multiplexed stdout/stderr. Early return force-cancels. */
  output: AsyncIterable<ProcessOutput>;
  wait(): Promise<ProcessExitResult>;
}

interface PolicyEngine {
  decide(action: CanonicalAction): Promise<PolicyDecision>; // allow | deny | require_approval
}

interface ArtifactStore {
  stage(bytes: ArtifactBytes): Promise<StagingRef>;
  commit(staging: StagingRef): Promise<ArtifactVersion>; // hash/size/schema
  get(artifactVersionId: string): Promise<ArtifactVersion>;
  read(artifactVersionId: string): AsyncIterable<Uint8Array>;
}
```

`CapturedProcess.wait()` 是唯一的可验证终态读取点：它只在根进程已退出、stdout/stderr 已 EOF 且受管进程树确认为空时 resolve；无法证明树收敛、输出 overflow/abandon 或取消失败时，以稳定的 `ProcessControllerError` reject，不能伪造一个 `{ exitCode, signal }`。`ProcessExitResult` 只记录 root 的原生 OS 观察值；`signal` 是诊断，不是业务终态。

```ts
type ProcessControllerOperation = "spawn" | "wait" | "output" | "inspect" | "cancel";
type ProcessControllerErrorCode =
  | "unsupported_capability"
  | "invalid_request"
  | "spawn_failed"
  | "identity_mismatch"
  | "process_tree_unverified"
  | "process_input_failed"
  | "process_output_failed"
  | "process_output_overflow"
  | "process_output_abandoned"
  | "process_wait_failed"
  | "process_cancel_failed";
```

`spawnCaptured()` 是一个原子 capability：capture、受管树所有权和可验证 `wait()` 任一不可用时，必须在 spawn 前以 `unsupported_capability` 失败。`inspect()` 始终只报告当前 liveness/identity，不返回历史 exit 或终态原因。timeout、用户取消、预算停止和 Run/Workflow 状态转换由 Application/Workflow Engine 管理：调用方先记录其业务事实，再 graceful/force cancel，最后等待 `wait()`；不得把该业务归因塞进 `ProcessExitResult`。

**权威：** M3 Mock 路径上，`LocalArtifactStore` 是产物字节与登记元数据的权威实现。Daemon composition 必须经 `stage/commit`（或等价 `register`）落盘；公开 `GET /artifacts/{id}/versions/{versionId}/content` 从 store 读取精确版本。`world.json` 只是 sidecar，不得作为 content 权威。崩溃窗口仍遵守决策登记 D04：内容可先于元数据落盘，reconcile 不得发明 `available` 版本。

公开 DTO 不得包含宿主绝对路径；内部 grant 另存。

公开 `TaskDto.dependsOn` 由 `packages/protocol` 的 Task 契约定义，Application 从已发布执行 DAG 的 `TaskRecord.dependsOn` 映射，HTTP 层不得丢弃该字段。

## 实现归属

| Port | 实现任务 |
|---|---|
| UoW / EventStore / Receipt / 表 | T04 |
| RuntimeAdapter Host + Mock | T05 |
| Workspace / Process | T06 |
| Policy | T07 |
| ArtifactStore / Evaluation | T08 |
| 状态机用例 | T09 |
| HTTP 映射 | T10 |
