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

`StartRunRequest` 必须包含 D07 的 node/runtime/workspace binding。`transport` ∈ `process | sdk | http`。产品 Placement kind 默认 `local`（[D19](../../planning/decision-register.md#d19-执行-placement本机远程与容器)）；远程/容器与 enrollment 不进入本 SPI 结构，也不在此发明 path。D18 `orchestrationMode` ∈ `workflow_bound | direct` 已冻结在同一 `StartRunRequest`（`packages/protocol`）；省略则默认 `workflow_bound`。composed `startProject` 经 `StartRunHostRequest` 把该字段传入本结构。旧名 `executionMode` 不是同义词，也不表示 Placement。本条不增加 `/runs/{id}:direct` 或其它 Run path。`direct` 字段可解析或回读不等于已有 direct 调度或生产 Codex 已支持直接执行。

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
