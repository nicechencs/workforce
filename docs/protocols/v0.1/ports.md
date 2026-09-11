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

`StartRunRequest` 必须包含 D07 的 node/runtime/workspace binding。`transport` ∈ `process | sdk | http`。

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

公开 DTO 不得包含宿主绝对路径；内部 grant 另存。

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
