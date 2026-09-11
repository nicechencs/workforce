---
title: D15–D18 落地方案（实现前检查点）
type: proposal
status: proposed
owner: maintainers
updated: 2026-09-11
---

# D15–D18 落地方案（实现前检查点）

本页把最近三轮文档改动（`39990b9`、`cb339fe`、`c613609`）冻结的语义翻译成**可领取的实现序列**。它不发明契约、不改状态机、不宣称任何能力已实现。冻结规则以 [decision-register.md](decision-register.md) 与 [state-matrix.md](state-matrix.md) 为准；本文只回答「按什么顺序、由谁、动哪些文件、怎么证明」。

基线：`c613609`（`dev`）。代码事实以本轮实际读取的源码为准，验证环境限制见 §8。

## 1. 结论摘要

文档改动看起来是「M7 画布 + M8 双执行模式」，但真正卡住整个 D15–D18 的不是画布，而是**三条被文档埋在执行面里的前置不变量**。在它们落地前，画布、对话生成、双执行模式任何一条都无法诚实实现：

0. **SQLite 现在不是权威，也没有权威到能承载这些不变量。** 实际写入链是「Application 内存 world → `dumpWorld` → 写 `world.json` → 之后才异步投影进 SQLite」，且这次投影**吞掉约束错误与 `revision_conflict`**（`apps/daemon/src/composition/persist.ts:552-556, 591-595`）。文档的 migration expand → backfill → switch → contract 假设 SQLite 是事实来源；要让它成为事实，`switch` 阶段就不只是加列，而是一次「谁来负责不变量」的架构切换。在没做这个切换前，任何 NOT NULL/CHECK 收紧都可能**静默不生效**——见 §3.6。
1. **迁移是公共前置，不是 D18 的收尾工作。** 文档把 `orchestration_mode`、`transport`、`placement_snapshot_json`、`execution_snapshot_id` 的目标形态定义为 `NOT NULL` + 互斥 `CHECK`，同时要求「现行 M3 Run 先 nullable」。这意味着 expand 阶段必须**先于**任何会写 Run 的 D17/D18 代码——否则新代码要么写不进库，要么必须写一个立刻要拆掉的临时分支。
2. **映射必须显式，而当前 Run 的 placement 语义是倒的。** `StartRunRequest` 现在要求调用方**先给出** `executionNodeId` / `runtimeInstallationId` / `workspaceInstanceId`；文档冻结的顺序是先解析 placement intent，再选 Node/Runtime、拿 Lease、建 WorkspaceInstance，**最后**组装唯一 `PlacementSnapshot`。wire 契约与执行顺序互相矛盾，必须先解决再写调度。另外 `runs.snapshot_ref` 现在的取值是 Mock 场景名字面量（`"mock:success"`），与 `execution_snapshot_id` **不是同一个概念**，不能复用。
3. **`ProjectExecutionSnapshot` 的写入时机和归属都要挪。** 文档要求计划确认只创建 snapshot 并进入 `ready`，`workflow.start` 才创建 `WorkflowInstance`；当前 `confirmPlan` 直接创建 `WorkflowInstance` 并把 `project.workflowInstanceId` 写死。这是 M3 主路径的真实行为改动，牵动 daemon、typed client、桌面页 driver 与集成测试。

另外三个**文档没写、但会直接决定 D15–D18 正确性**的代码事实：公开 Task 的 `dependsOn` 从 `task_dependencies` 投影，而该表**全库无生产写入方**；`workflow_versions.definition_json` 每次写实例都被 upsert 覆盖，等价于**可变版本表**；D15/D18 要新增字段的 `RunDto`/`ProjectDto`/`TeamDto` **不在 `packages/protocol`**，而是 daemon 与 desktop-client 两处手写副本。这三条不是措辞问题，而是实现路径上的硬约束，见 §3.5 与 §4。

## 2. 基线事实（已实际读取）

### 2.1 公共契约现状

| 对象 | 现状 | 证据 |
|---|---|---|
| 公开 `WorkflowVersionDto` | `{ id, workflowId, version, status, immutable, entry, steps[] }`，`steps` 是 `id/kind/title/worker?/gate?/notes`，**无 nodes/edges**，且 schema `.strict()` | `packages/protocol/src/workflow.ts:12-49` |
| 公开 `TaskDto` | 含 `workflowNodeId?` 与 `dependsOn`；无 mode/版本/snapshot 字段 | `packages/protocol/src/task.ts:14-33` |
| `StartRunRequest` | `operationId, idempotencyKey, taskId, definitionRevision, generation, attempt, principalId, clientId, placement{executionNodeId, runtimeInstallationId, workspaceInstanceId}, runtime{adapterId, protocolVersion}, snapshotRef`，`.strict()` | `packages/protocol/src/command.ts:30-55` |
| `RunDto` / `ProjectDto` / `TeamDto` | **不在 `packages/protocol`**：daemon 与 desktop-client 各手写一份（同一事实两个来源） | `apps/daemon/src/modules/dto.ts:42-74,196-203`；`packages/desktop-client/src/types.ts:42,56,215` |
| `ProjectDto` 的 team 绑定 | 既无 `teamId` 也无 `teamVersionId`（内部 `ProjectRecord.teamVersionId` 存在但不出公开面） | `dto.ts:42-54`；`packages/application/src/use-cases/projects/store.ts:34` |
| `orchestrationMode` / `transport` / `placementSnapshot` / `executionSnapshotId` | 协议与 domain 均无；grep 全库 0 命中 | `packages/protocol/src/index.ts:4-11` |
| `WorkflowDraft` / `TeamDraft` / `AuthoringChangeSet` / `ProjectExecutionSnapshot` | 类型、表、DTO 全无 | 同上 |
| 品牌 ID | `packages/domain/src/ids.ts` 有 17 个 Id，**缺** `WorkflowId`/`WorkflowVersionId`/`WorkflowDraftId`/`TeamId`/`TeamVersionId`/`TeamDraftId`/`ExecutionSnapshotId`/`SnapshotRef` | `packages/domain/src/ids.ts:21-39` |
| `NodeInstanceStatus` | **重复定义两处** | `packages/workflow-engine/src/types.ts:3-14`；`packages/application/src/use-cases/projects/engine-port.ts:9-20` |
| 图定义（引擎层） | 已存在 `WorkflowGraph{id,workflowId,version,entryNodeIds,nodes[],edges[],terminalNodeIds?}`，节点/边种类齐备；`validateWorkflowGraph` 已覆盖环、端点、入口可达、joinPolicy、绑定、condition 默认分支 | `packages/workflow-engine/src/types.ts:16-56`；`packages/workflow-engine/src/dag.ts:60-150` |
| JSON Schema 生成 | **不存在 codegen**。`docs/protocols/v0.1/*.schema.json` 是手写副本，与 zod 无自动校验，漂移不可发现 | 根 `package.json:11-20`；`docs/protocols/README.md:3,34` |

结论：**canonical graph 只在引擎层存在，公开协议里只有目录投影**。D15 的「画布保存与对话生成必须落到同一 canonical graph」需要把引擎图提升为协议对象，并且要处理公开 catalog schema 是 `.strict()` 这一事实——加字段不是纯新增，而是协议变更，且现有 protocol 测试**显式拒绝** `status:"draft"` 与 `canvas` 字段（`packages/protocol/src/workflow.test.ts:47-71`）。文档 [api-capability-matrix.md](api-capability-matrix.md) §2 Workflows 行要求「同一路径返回已发布图（nodes/edges）」，与该 strict schema 冲突，T02 必须显式选择：升协议版本，或把目录投影与 canonical graph 拆成两个 DTO。

### 2.2 持久化现状

45 张表已建（`packages/database/src/schema.ts`，4 个 migration：`001_init`/`002_entity_alignment`/`003_budget_alignment`/`004_policy_grants`）。与目标 DDL 的差异集中在四处：

```text
runs                 实测：execution_node_id / runtime_installation_id / workspace_instance_id 三列
                           + runtime_adapter / snapshot_ref；无 orchestration_mode /
                           execution_snapshot_id / transport / placement_snapshot_json
                     目标：唯一 placement_snapshot_json + orchestration_mode + transport
                           + execution_snapshot_id，且带 workflow_bound/direct 互斥 CHECK
projects             实测：team_version_id / workflow_version_id，无 execution_snapshot_id
workflow_instances   实测：workflow_version_id + graph_json，无 execution_snapshot_id
缺失表               team_drafts / workflow_drafts / authoring_change_sets /
                     authoring_change_set_steps / project_execution_snapshots
```

证据：`schema.ts:224-251`（runs）、`schema.ts:93-107`（projects）、`schema.ts:156-169`（workflow_instances）、`schema.ts:557`（`graph_json` 由 002 加入）。

值得注意的是**已经存在但没有写方的表**：`scheduling_records`（含 `placement_snapshot_json NOT NULL`）、`execution_leases`（含 `fencing_token`）、`timers`、`node_sessions`、`run_snapshots`、`workspaces`、`execution_nodes`、`runtime_installations`、`workspace_instances` 在 `apps/` 下 0 引用，只有 repository 代码。也就是说 D07 的存储骨架早已建好，缺的是**接线**，不是建表——这降低了 S2b 的迁移风险，但不改变它有实现风险的事实。

迁移器的三个事实决定了写法：

- 每个 migration 以 SQL 文本 sha256 存 checksum，已应用版本若 SQL 变了就 `throw`（`packages/database/src/migrate.ts:24-38`）。`001_init` 自首次提交后**从未被改写过**（`git log -p -- packages/database/src/schema.ts` 只显示追加常量），所以 expand 阶段是安全的；但 contract 阶段**必须新增 migration**，不能回改 001。
- `openSqlite` 已开启 `foreign_keys = ON` 与 WAL（`packages/database/src/connection.ts:15-18`）。因此 `runs.execution_snapshot_id` 这类新 FK 会在 expand 之后立刻生效，backfill 顺序错了会直接失败。
- migration 只做 DDL，**没有 dirty 标记、没有迁移锁、没有 down 迁移**（`migrate.ts:40-58`）。失败即整个 migration 事务回滚，但已应用的更早 migration 不回滚；启动顺序是先备份再迁移（`packages/database/src/backup.ts`）。

现有「升级测试」是用**当前源码常量**重放历史 DDL（`persistence.test.ts:67-162`），不是真实旧版本库文件；真正意义上的 current-M3 upgrade fixture 不存在，与 [03-implementation-status.md](03-implementation-status.md) §2 T16 行的记载一致。

### 2.3 实际写入架构（决定了 migration 的可行边界）

这是本轮最重要的发现。生产写入链不是「用例逐条写表」，而是**整世界快照投影**：

```text
HTTP command
  → WorkforceApp 用例改的是内存 MemoryWorld（app-services.ts）
  → this.persist()                       app-services.ts:1367-1377
  → dumpWorld()                          persist.ts:272-311
  → persistSnapshot() 写 world.json      persist.ts:391-395   ← 先落盘
  → dualWriteSqlite()（异步）             persist.ts:504-596
  → SqliteWorldSnapshot.save()           world-snapshot.ts:93-166   ← 全实体 upsert
```

两个直接后果：

- **SQLite 是投影，不是权威。** 读取侧 `loadComposition()` 先读 `world.json`，仅当 `entities.projects.length > 0` 时才用 SQLite 实体表覆盖（`persist.ts:443-445`）。所以「从 `ProjectExecutionSnapshot` 读版本」这类不变量，**必须先在内存模型里成立**，否则会出现「SQLite 列已按新语义写、行为仍按旧语义跑」的分叉。
- **投影失败被吞掉。** `dualWriteSqlite` 在外层 catch 里丢弃所有 `isConstraintError`（`persist.ts:591-595`），并在 handle 写入处丢弃 `revision_conflict`（`persist.ts:552-556`）；同一时刻 `world.json` 已经写成功。这意味着：**在 expand 之后新增的 NOT NULL/CHECK 列，如果忘记同步某条 insert/update SQL，失败会静默发生**，表现为 SQLite 落后于 `world.json`，而不是报错。

另外 `SqliteWorldSnapshot.save` 会在 `state_revision` 跳变时用裸 `UPDATE runs SET state_revision = ?` 绕过 CAS（`world-snapshot.ts:251-255`）。

### 2.4 应用与用例现状

- `confirmPlan` 在同一个事务里：消费 `gate=plan` 审批 → 校验 `input.graph` DAG → 把 `project.workflowVersionId` 设为 `input.graph.id` → **创建 `WorkflowInstance`（`status: "created"`）** → 写 `project.workflowInstanceId`（`packages/application/src/use-cases/projects/projects.ts:202-281`）。
- `startExecution` 只从已存在的 `project.workflowInstanceId` 取实例并推进（`projects.ts:283-309`）。
- 传给 `confirmPlan` 的图来自请求体：`apps/daemon/src/composition/app-services.ts:540` 使用 `mockPlanGraph()`。已发布目录模板 `FEATURE_DELIVERY_WORKFLOW`（`catalog.ts:33-84`）与执行图是**两套对象**，目录只用于展示。
- `workflow_instances` 落库时会**隐式 upsert** `workflow_versions`（`packages/database/src/workflows.ts:54`），即版本表当前是可变的。

### 2.5 调度与准入现状

`packages/workflow-engine` 已提供纯函数形式的图能力：`validateWorkflowGraph`、`topologicalOrder`、`nodeEligible`、`joinSatisfied`、`selectedConditionBranches`、`reviewerCircularWait`、`schedule`/`compareReady`、`nextBackoffMs`/`decideRecovery`、预算 `reserveBudget`/`settleUsage`（`packages/workflow-engine/src/index.ts:13-47`）。持久化侧的 Run 准入是 `startRunIdempotent`：查 receipt → 写 pending receipt → `insertPending` → 完成 receipt（`packages/database/src/start-run.ts:30-58`），它**不解析三轴、不选节点、不建 Lease**，placement 三列由调用方直接传入（`packages/database/src/runs.ts:101-135`）。

### 2.6 版本对象当前的语义

`team_versions` / `workflow_versions` 现在承载的不是「已发布版本」：

- `ensureTeamVersion` 写 `definition_json='{}'`、`content_hash='sha256:empty'`（`ensure.ts:23-29`）；`ensureWorkflowVersion` 同（`:31-42`）。
- `upsertWorkflowVersion` 在每次写 `workflow_instances` 时用实例图 `record.graph` **覆盖** `workflow_versions.definition_json`（`ensure.ts:44-58`，被 `workflows.ts:54,84` 调用）。

即：版本表当前是**可变的实例图快照存储**，`content_hash` 恒为常量，D15「已发布版本不可变」与 `docs/blueprint/10-database-schema.md` §4.2「一旦被引用禁止 UPDATE/DELETE」都还没有实现基础。做发布路径时必须同时把「实例图快照」与「已发布版本」分开，否则画布的「新版本」会改写历史。

## 3. 关键判断（文档未直说，但决定落地顺序）

### 3.1 迁移是公共前置

目标 DDL 的 `CHECK ((mode='workflow_bound' AND snapshot IS NOT NULL) OR (mode='direct' AND snapshot IS NULL))` 与 `UNIQUE(task_id, attempt)` 意味着：只要 expand 还没跑，任何新写的 Run 都不带 mode/snapshot；等 contract 收紧时这批 Run 全部变成需要 backfill 的历史数据。反过来，如果先做 D18 再迁移，就要写一段「临时用三列模拟 placement」的代码，而这段代码正是文档要删除的东西。

因此 **expand 必须先落地**，且 expand 只做「加列 + 加表 + 可空」，不写业务逻辑。配套要求：expand 落地后，新 Run 写入路径立刻**双写**已解析的 mode/transport/placement，避免积累第二批历史脏数据。

### 3.2 三轴解析要成为单一入口，不能有两条准入路径

D18 的 direct 与 workflow-bound 在文档里共用同一条治理链，只在「是否进入本次 Workflow 调度」上分流。若由两个用例各写一遍准入，最可能的结果是 direct 少走一条守卫（预算、Policy、workspace 隔离、Approval），而这类缺陷不会在 happy path 上暴露。

建议把准入抽成一个 Application 层不变量（名字待 T09 定，例如 `admitRun`），**签名接收已解析的三轴 + 已完成的 placement binding**，两条路径都只通过它创建 Run。可测的判据：workflow-bound 与 direct 的准入契约测试可以共用同一组用例，只在「是否写 snapshot」与「是否创建 NodeInstance」上分叉。

这与文档的启动顺序一致：`resolve placement intent → Policy/Budget/Approval → 选 Node/RuntimeInstallation + capability → Lease/fencing → WorkspaceInstance → 解析 transport + orchestrationMode → 组装 PlacementSnapshot → 原子创建 Run + snapshot + Event/Outbox`（[node-scheduling-flow.md](../diagrams/node-scheduling-flow.md)、[dual-execution-mode-flow.md](../diagrams/dual-execution-mode-flow.md)）。

### 3.3 计划确认与工作流启动必须拆开

按 [state-matrix.md](state-matrix.md) §2/§3，`:confirm-plan` 只应创建 `ProjectExecutionSnapshot` 并让 Project 进入 `ready`；`workflow.start` 才创建引用该 snapshot 的 `WorkflowInstance`。当前实现把两件事合并在 `confirmPlan` 里。

这是一个**跨模块行为变更**，不是重构：它同时改动用例事务边界、Project 状态矩阵的执行点、`project.workflowInstanceId` 的生命周期、typed client 的调用序列，以及桌面页 driver 的点击序列（`apps/desktop/tests/main-path.smoke.test.ts` 与 `tests/integration` 的 M3 场景都按「确认计划 → 开始执行」两步走，需要确认第二步的语义变化不会破坏既有断言）。

同时它带来一个需要显式记录的中间态：`ready` 但 `executionSnapshotId` 已存在、还没有 `WorkflowInstance`。此状态下 `:start` 失败可重试，不应留下半创建的实例——这正好是 D04 崩溃窗口 1 的一个新实例，应有测试。

### 3.4 wire 契约与执行顺序矛盾，不能靠归一化掩盖

`StartRunRequest.placement` 要求调用方指定节点与 workspace 实例，等于把「选定」放在调用方；文档要求由 Application 在守卫之后选定。当前协议里没有「placement intent」这个对象，也没有 `orchestrationMode`。

[communication-history.md](communication-history.md) 已记录评审结论：当前严格 `workforce.task/0.1` wire DTO 不接受 `orchestrationMode`；若保持 `0.1`，只能新增**可选**字段并由 Application 归一化，否则升协议。这条结论需要扩展到 `placement`：T02 必须明确以下之一，并写进协议而不是留在实现里：

- **A（保持 0.1，最小改动）**：`placement` 改为可选，语义降级为「placement intent 提示」；Application 在守卫后解析并组装 canonical `PlacementSnapshot`；`orchestrationMode` 可选，缺省归一化为 `workflow_bound`。
- **B（升 0.1 → 0.2）**：引入显式 `placementIntent` 与 `orchestrationMode`，`StartRunRequest` 不再携带已解析 binding；`packages/protocol` 与 `docs/protocols/v0.1/` 生成物一起升版本。

两者都可行，但**不能选「字段留着、行为按文档走」**：那会让 wire 上出现一个调用方以为自己在选节点、实际被覆盖的字段，属于文档禁止的「映射不显式」。

### 3.5 三个新暴露的实现陷阱
**(a) `TaskDto.dependsOn` 的来源与写入路径不一致。** 公开投影按 [decision-register.md](decision-register.md) D08 必须含 `dependsOn`，[03-implementation-status.md](03-implementation-status.md) §3 记录它来自已发布执行 DAG，并有 `composition.test.ts` 覆盖。但 `confirmPlan` 只写 `project` 与 `workflowInstance`，没有写 `task_dependencies`。因此一旦执行图的来源从「请求体 `input.graph`」换成「已发布 `WorkflowVersion`」，DAG 边的落库必须一并补上；否则换个图来源就会静默丢掉依赖边，而 UI 的「依赖：无」回退文案会掩盖它。这条要有 contract test 覆盖投影与落库两侧。

**(b) 版本表当前可变。** `workflows.ts:54` 的 `upsertWorkflowVersion` 会在插入实例时按需创建/覆盖 `workflow_versions.definition_json`。这与 D15「已发布版本不可变」、以及 `docs/blueprint/10-database-schema.md` §4.2「一旦被引用禁止 UPDATE/DELETE」冲突。做 D15 发布路径时，这个 upsert 必须收敛为「发布时 insert once」，并给已发布版本加不可变约束（或至少在 repository 层拒绝 UPDATE）；否则画布发布的「新版本」可能悄悄改写历史版本。

**(c) 公开 DTO 有两个手写来源。** `RunDto`/`ProjectDto`/`TeamDto` 不在 `packages/protocol`，而是 `apps/daemon/src/modules/dto.ts` 与 `packages/desktop-client/src/types.ts` 各一份。D18 要给 Run 加 `orchestrationMode`/`transport`/`executionSnapshotId`，就必须同时改两处并且无法被 schema 单测发现漂移。**[AGENTS.md](../../AGENTS.md) 禁止「绕过 `packages/protocol` 复制第二套规则」**，所以这三个 DTO 的归属必须在 S0 里一并裁决：要么迁入 `packages/protocol`，要么明确写出它们的权威方与校验方式。不裁决就直接加字段，等于把 D18 的字段冻结在两个不受检查器约束的地方。

### 3.6 SQLite 还不是权威，migration 的「switch/contract」缺一个前提

文档把 `expand → backfill → switch → contract` 写成纯数据库动作，但 §2.3 的事实是：**不变量现在由内存 `MemoryWorld` 持有，SQLite 只是事后投影**。所以：

- `switch`（「只从 `ProjectExecutionSnapshot` 读版本」）**必须先在内存模型与 Application 用例里成立**，然后才轮到 SQLite 列。顺序反了会出现「列已按新语义写、行为仍按旧语义跑」，而两种状态在 `world.json` 与 SQLite 之间都会被读取（`persist.ts:443-445`）。
- `contract`（收紧 NOT NULL/CHECK）在投影吞错的前提下**无法自证生效**：列约束违反了也只是 SQLite 静默落后。要让 contract 有意义，必须先让投影失败变成可见错误（至少对新增列的约束失败不再吞），否则「回填审计通过」这个前提是不可观测的。

因此建议把「投影失败可见化」列为 S1 的伴随项，而不是留到 S5：它是后续所有收紧动作的**观测前提**。这条不改协议、不改状态机，只改 `dualWriteSqlite` 的错误处理策略，但属于高风险改动（它会改变现有「世界上永远写成功」的行为假设），需要独立审查。

### 3.7 三个会直接卡住实现的细节

**(a) 事务嵌套。** `UnitOfWork` 是进程内串行化且**不允许嵌套事务**（`packages/database/src/uow.ts:34-36`）。当前 `:confirm-plan` 的 `policy.consumeGrant` 在 `app.confirmPlan` 事务**之外**（`app-services.ts:529`），而 `SqliteGrantStore` 自己开事务（`grants.ts:33-37, 53-60`）。把 snapshot 创建搬进审批消费的同一事务会直接触发 `nested database transactions are not supported`；S2a 必须明确 snapshot 创建、审批消费、Project 更新三者的边界。

**(b) SSE 读的是内存，不是 events 表。** SSE `flush()` 读 `services.listEvents()`，而它过滤的是内存 `app.world.events`（`app-services.ts:932-964`）；SQLite `events` 表只写不读，`trimHorizon()` 恒为 0（`:971-973`），cursor 过期判断实际上失效。D18 要求「重试创建新 Run、模式可审计」，若审计依赖事件流，这条分裂会在恢复场景先暴露。它不在 D15–D18 的文档范围内，但会影响 S2a/S5 的验收可信度。

**(c) 已建未接线的表意味着「收紧无历史数据」，也意味着「没有回归网」。** `scheduling_records`（含 `placement_snapshot_json NOT NULL`）、`execution_leases`（含 `fencing_token`）、`timers`、`node_sessions`、`run_snapshots` 在 `apps/` 下 0 引用。好消息是这些表为空、加约束没有 backfill 风险；坏消息是它们**没有任何生产测试覆盖**，S2b 一接线就等于同时引入新写入路径与新约束。

**(d) 当前执行图是「请求体 + 手工转换」的产物，且已经丢过节点。** `mockPlanGraph()`（`apps/daemon/src/composition/catalog.ts:192-231`）把 fixture 转成 `WorkflowGraph` 时**只保留 `kind === "task"` 的节点**（`:194`），fixture 里的 `approve_delivery`（`kind: "approval"`, `role: "human"`, `gate: "artifact"`）被直接过滤掉；表格另一侧的 `FEATURE_DELIVERY_WORKFLOW` 是硬编码的 5 个 `steps`，注释写明「Catalog only — not a Runtime execution graph」（`catalog.ts:32`）。也就是说：**目录展示的 5 步、fixture 的 4 节点 + 1 审批、真正跑起来的图，三者互不相同**。D15 要求「画布保存与对话生成落到同一 canonical graph」，第一步不是加画布，而是先把这三者收敛成「已发布 `WorkflowVersion` 是唯一执行图来源」。同理，`commandRoute()` 的 URL 改写只白名单 `projects|tasks|runs|approvals` 四种资源（`apps/daemon/src/api/rewrite.ts:13-18`）；若新写接口想沿用 `/{id}:action` 形式，必须同步扩这个白名单，否则路由不会被改写（纯路径段形式如 `/workflows/{id}/drafts/{draftId}:publish` 不受影响，但它同样要经过 Electron allowlist）。

## 4. 公共契约缺口清单（T02 冻结项）

以下每一项都属于「公共 DTO / Domain / ports」，按 [AGENTS.md](../../AGENTS.md) 与任务清单只能由 T02 冻结。缺口性质分三类：**纯新增**（可兼容加）、**改已有契约**（需兼容策略）、**需迁移**（DB 侧）。

| # | 缺口 | 现状 | 性质 | 文档依据 |
|---|---|---|---|---|
| C1 | `WorkflowGraphDefinition`（nodes/edges/failurePolicy/concurrencyPolicy）作为协议对象 | 仅引擎层 `WorkflowGraph` | 改已有契约（catalog DTO 是 `.strict()`） | 02 §4.6、08 §2.1 |
| C2 | `WorkflowDraft` DTO + revision/CAS `status="draft"` | 无 | 纯新增 | 08 §2.1、state-matrix §1 |
| C3 | `TeamDraft` / `TeamVersion` DTO（members: role + RuntimeProfile + quantity） | `teams` 表无 draft 表，只有 `team_versions` | 纯新增 | decision-register D16 |
| C4 | `AuthoringProposal` / `AuthoringChangeSet` / step（逐目标 `expectedRevision`、`patchRef`、status 枚举） | 无 | 纯新增 | 08 §2.1、state-matrix §2A |
| C5 | `ProjectExecutionSnapshot` DTO/ID | 无 | 纯新增 | 02 §4.6、10 §4.3 |
| C6 | `orchestrationMode`（`workflow_bound`\|`direct`）+ wire 可选性策略 | 无 | 改已有契约（0.1 严格 DTO） | decision-register D18、communication-history 2026-09-11 第 5 条 |
| C7 | `transport`（`process`\|`sdk`\|`http`）在 Run 上的表达 + RuntimeProfile 来源规则 | 无 `transport`；`runtime_adapters` 语义不等价 | 改已有契约 + 需迁移 | decision-register D07、02 §4.9A |
| C8 | 唯一 `PlacementSnapshot` 形状（nodeId/nodeSessionId/runtimeInstallationId/workspaceInstanceId/lease/fencing） | `StartRunRequest.placement` 三 ID + `ProviderPlacementSnapshot` | 改已有契约 | 07 §4、10 §18 |
| C9 | `placement` intent 的 wire 语义（或移除） | 现为必填已解析 binding | 改已有契约 | §3.4 |
| C10 | `WorkflowInstance.executionSnapshotId`（替代直接 `workflowVersionId`） | 实例直接存 version + graph | 需迁移 | 10 §4.3、state-matrix §3 |
| C11 | `dependsOn` 投影规则与落库约定（普通 prerequisite 边 vs 路由边） | 投影已存在、落库缺失 | 改已有契约（配 contract test） | 08 §2.3、api-capability-matrix §2 |
| C12 | 能力探针输出（哪些 mode 可选）与 `unsupported_capability` 的判定点 | `GET /capabilities` 存在但是硬编码静态对象（`app-services.ts:279-295`），无 mode 维度 | 纯新增 | decision-register D18.3 |
| C13 | `RunDto`/`ProjectDto`/`TeamDto` 的归属与单一来源 | daemon 与 desktop-client 各手写一份；protocol 只有 `TaskDto`/`WorkflowDto` | 改已有契约（结构性问题） | §3.5c、AGENTS.md 红线 |

建议 T02 的产出顺序：**C5/C6/C8/C9 先冻结**（它们阻塞迁移与调度），再冻结 C1–C4（阻塞作者面），然后 C13（否则 C6/C7 的字段会落在两个不受检查器约束的副本里），最后处理 C10/C11/C12 的兼容细节。理由是前四项一旦不定，T04 的 migration 就没有目标列名。

## 5. 落地序列

阶段编号与依赖如下。同一阶段内的任务文件范围互不重叠；跨阶段的公共文件（protocol、migration、composition root、preload/路由、allowlist）只有一个负责人。

```text
S0 契约冻结（T02）            ── 阻塞一切写 Run / 写库的代码
      │
S1 迁移 expand（T04）         ── 加列加表，只可空，无业务逻辑
      │
      ├── S2a 快照与实例拆分（T09/T10/T14/T16）
      ├── S2b 三轴解析与统一准入（T09）
      ├── S2c 作者面持久化 + 发布不可变（T04/T09）
      └── S2d authoring ChangeSet 表与用例骨架（T04/T14）
                   │
S3 迁移 backfill → switch（T04，与 S2 并行验证）
                   │
S4 写接口与页面（T10/T18/T19/T20/T21）
                   │
S5 contract 收紧 + upgrade fixture 验收（T04/T16）
```

### S0 — 契约冻结（T02）

- 冻结 §4 的 C1–C13，产出 `packages/protocol` 单一 schema 源 + `docs/protocols/v0.1/` 生成物 + fixture。
- 明确 `orchestrationMode` 的 wire 策略（§3.4 A/B 二选一）并回写沟通历史。
- 产出必须包含：合法与非法 fixture 各一组（非法至少覆盖 `workflow_bound` 无 snapshot、`direct` 带 snapshot、缺 mode 归一化、`placement` intent 与已解析 binding 混用）。
- **验收**：完整示例过同一 schema；不存在两套手写分叉类型；`packages/protocol` 不依赖 Electron/Fastify/SQLite。
- **不做**：不实现调度、不建表。

#### S0 进度（2026-09-11）

已落地第一个切片：`packages/protocol/src/execution.ts` 冻结 C6/C7/C8（三条正交轴 + 唯一 `PlacementSnapshot` + canonical `RunExecutionSnapshot`），C9 的 intent 形状（`placementIntentSchema`）也一并给出；`docs/protocols/v0.1/ports.md` 已同步。

**取舍记录：** 原计划的 A 方案（把 `StartRunRequest.placement` 降级为可选 intent）经读码后放弃——它会波及 `packages/runtime-sdk` 的 `assertNode`/`bindingFor`、mock/codex 两个 adapter 与 5 个测试文件，属于顺手重写运行时而非冻结契约。改为**加法式**：`StartRunRequest` 定位为 **Adapter SPI 边界请求**（必须带已解析绑定，键集合由回归测试锁定），三轴走独立协议对象。因此 §3.4 的 A/B 二选一**只剩一件事待定**：是否新增一条 wire 入口在请求里携带 `placementIntent`（HTTP 层），还是让 mode/intent 从 Task/Project 配置推导、`POST /tasks/{id}/runs` 不带这些字段。见 §9.1。

仍待冻结：C1–C4（作者面图与草稿 DTO）、C10（`WorkflowInstance.executionSnapshotId`）、C11（`dependsOn` 落库约定）、C12（mode 维度 probe）、C13（`RunDto`/`ProjectDto`/`TeamDto` 归属）。

**本切片验证**：`tsc -p packages/protocol/tsconfig.json --noEmit` 退出 0；含新测试文件的定向 typecheck 退出 0；`node tooling/docs/check-docs.mjs` 通过（50 文件）；14 条断言以纯 Node 复算全部通过。**vitest 未跑**（本环境 Node→子进程 spawn 全部 EPERM）；`turbo run typecheck` 的 2 个 `TS2307` 经 `git stash` 复测确认为基线既有。

### S1 — migration expand（T04）

- 新增 migration（编号建议 `005`，禁止回改 001–004）：
  - `CREATE TABLE team_drafts` / `workflow_drafts`（`revision`、`status CHECK (= 'draft')`、`definition_json`/`graph_json`、`content_hash`、`UNIQUE(parent_id, revision)`）。
  - `CREATE TABLE authoring_change_sets` / `authoring_change_set_steps`（沿用 `docs/blueprint/10-database-schema.md` §10 DDL，含逐目标 `UNIQUE(change_set_id, target_type, target_id)`）。
  - `CREATE TABLE project_execution_snapshots`（只写一次；`workflow_version_id NOT NULL`、`team_version_id NOT NULL`、`content_hash`）。
  - `ALTER TABLE projects ADD COLUMN execution_snapshot_id`；`ALTER TABLE workflow_instances ADD COLUMN execution_snapshot_id`。
  - `ALTER TABLE runs ADD COLUMN orchestration_mode` / `execution_snapshot_id` / `transport` / `placement_snapshot_json`——**全部 nullable**，此阶段不加 CHECK、不加 NOT NULL。
- **伴随项（§3.6）**：让投影失败可见。至少做到「新增列的约束失败不再被 `dualWriteSqlite` 吞掉」，否则后续 backfill 审计与 contract 收紧都不可观测。这条会改变现有「整世界写永远成功」的假设，属高风险，需独立审查。
- **验收**：空库全量迁移通过；从上一发布 schema（含真实 M3 Runs）执行 expand 不报错；旧列仍可读；checksum 行为不变（回改旧 migration 应失败）。
- **风险**：`foreign_keys = ON` 下新增 FK 列的历史行为空，不能在此阶段加 `REFERENCES` + `NOT NULL` 组合。若 `execution_snapshot_id` 需要 FK，SQLite 的 `ALTER TABLE ADD COLUMN` 加 FK 需默认 NULL，符合本阶段设计。

#### S1 进度（2026-09-11）

已落地：`packages/database/src/schema.ts` 新增 `MIGRATION_005_SQL`（`005_execution_axes_expand`）并挂入 `MIGRATIONS`，`src/index.ts` 导出。内容严格限定为 expand——5 张新表（`team_drafts`、`workflow_drafts`、`authoring_change_sets`、`authoring_change_set_steps`、`project_execution_snapshots`）+ 6 个可空列（`projects.execution_snapshot_id`、`workflow_instances.execution_snapshot_id`、`runs` 的 `orchestration_mode`/`transport`/`execution_snapshot_id`/`placement_snapshot_json`）+ 2 个索引。**没有** `NOT NULL`，**没有**互斥 CHECK，**没有** backfill——这些留给 S3/S5。

`persistence.test.ts` 同步更新两处既有断言（迁移列表），并新增两例：从 001–004 带真实历史 `runs` 行的升级、以及 checksum 守卫拒绝被篡改的 001。

**本切片验证**（Node 24.19.0，真实执行）：6 条探针全部通过——空库 5 个迁移全绿、5 张表存在；001–004 升级后历史行四列均为 `NULL` 且列保持 `notnull=0`、`runs` 表 SQL 中不含互斥 CHECK、`projects`/`workflow_instances` 新列存在；checksum 守卫抛 `checksum mismatch`；迁移可重入；新 DDL 的 CHECK 与 `(change_set_id, target_type, target_id)` 唯一约束确实生效。`tsc -p packages/database/tsconfig.json --noEmit` 受 §8 的 store 缺口影响**未能独立运行**（`@workforce/domain`/`@workforce/policy` 未链接），`turbo run typecheck` 里该包报的正是同一个 `TS2307`，与基线一致。

### S2a — 快照与实例拆分（T09 用例、T10 API、T14 图来源、T16 场景）

- `:confirm-plan` 改为：消费审批 → 校验 → **创建 `ProjectExecutionSnapshot`** → Project `ready` + 写回 `executionSnapshotId`；**不创建 `WorkflowInstance`**。
- `:start` 改为：校验无活动实例 → 从 snapshot 取版本 → 创建 `WorkflowInstance`（引用 snapshot）→ 激活入口节点。
- 执行图来源从「请求体 `input.graph`」改为「snapshot 引用的已发布 `WorkflowVersion`」；补齐 `task_dependencies` 落库（§3.5a）；同时收敛「目录 5 步 / fixture 4+1 节点 / 执行图」三者（§3.7d）。
- **事务边界必须先定**（§3.7a）：snapshot 创建、审批消费（`policy.consumeGrant` 自带事务且不可嵌套）、Project 更新三者不可能都塞进一个 UoW 事务，需要明确哪一步在事务内、失败如何补偿。
- **验收**：`ready` 但无实例的中间态可重试；`:start` 失败不留下半创建实例；同一 `operationId` 重放不重复创建实例；`dependsOn` 投影与落库一致（contract test 覆盖普通边与路由边分离）。
- **风险**：高风险（状态机 + 持久化 + 幂等）。需要独立审查与 §6 的恢复测试。

### S2b — 三轴解析与统一准入（T09）

- 新增 Application 准入不变量（§3.2），输入为 intent + 已解析 binding；workflow-bound 与 direct 共用。
- 解析默认层级按 [decision-register.md](decision-register.md) D07：启动命令 override（经 Capability/Policy 允许）→ Task/Placement intent → Project 配置 → Team/Worker/RuntimeProfile 默认 → 系统默认（`workflow_bound` + `local_only`）。`transport` 只能来自选定的 RuntimeProfile/RuntimeInstallation。
- 缺字段按默认补齐并写入 canonical Run snapshot；任何 override 不得放宽 Policy/预算/Workspace/capability。
- **验收**：缺省请求归一化为 `workflow_bound`；direct 不创建 `NodeInstance`、不推进 `WorkflowInstance`/`Project`；两模式共用同一组守卫契约测试；无能力组合在启动前被拒绝而不是运行中失败。

### S2c — 作者面持久化与不可变发布（T04 repository、T09 发布校验）

- Draft 的 CAS 读写；publish 产生**新** `WorkflowVersion`/`TeamVersion`，`source_draft_id` + `publishedAt`，Draft 永远保持 `status="draft"`。
- 把「实例图快照」与「已发布版本」拆开（§2.6），并收敛 `workflows.ts:54` 的 `upsertWorkflowVersion`（§3.5b）：已发布版本只写一次，repository 拒绝 UPDATE，`content_hash` 由真实内容计算而不是常量 `sha256:empty`。
- 发布校验复用引擎既有原语：`validateWorkflowGraph`（含环、端点、入口可达、joinPolicy）+ `reviewerCircularWait`。
- **验收**：编辑已发布版本必须新建 revision；非法 DAG（环、悬空边、缺 joinPolicy）发布被拒且草稿保留；发布失败不产生版本行、不写审计外的半成品。

### S2d — authoring ChangeSet 与用例骨架（T04 表、T14 用例）

- 表在 S1 已建；本阶段实现 CAS/staged apply 状态机（`proposed` → `validating` → `applying` → `applied`/`partially_applied`/`failed`/`cancelled`/`expired`）与逐 step 持久化。
- 跨聚合无法同事务时走持久化 staged steps，崩溃恢复从最后一个已提交 step 继续。
- authoring Agent 通过 Runtime SPI 执行；生成出的 Workflow **不**在该 Run 中执行。
- **验收**：revision 冲突、空意图、校验失败、部分失败、取消、重试、过期都不假成功；`applied` 只推进 draft revision，不发布、不创建实例。

### S3 — backfill → switch（T04，与 S2 并行验证）

- **backfill**：历史 M3 Run 归一化为 `workflow_bound`；依据既有精确 WorkflowVersion/TeamVersion 与 Project/租户关系创建唯一 `ProjectExecutionSnapshot` 并回填；`transport` 只能从既有 RuntimeProfile/adapter 事实解析；`placement_snapshot_json` 只能从既有 Local Node、Workspace、Run 三列重建，并标注 legacy snapshot schema version。缺失或冲突行走 repair/quarantine，**不猜测版本、不伪造远程能力**。
- **switch**：repository/Application 改为只从 snapshot 读 WorkflowVersion/TeamVersion；新 Run 双写 mode/transport/placement；旧三列降为迁移审计只读。
- **验收**：backfill 后 `execution_snapshot_id` 无空值（workflow_bound 行）；quarantine 行可枚举、可审计、不被下游消费；switch 后删除旧列读取仍能跑通 M3 主路径。

### S4 — 写接口与页面（T10 / T18 / T19 / T20 / T21）

按 [api-capability-matrix.md](api-capability-matrix.md) §2 已列 path 实现，不发明新 path：

| 交付 | Owner | 关键约束 |
|---|---|---|
| `/workflows` 与 `/teams` 草稿/发布写接口 | T10（契约 T02、校验 T09） | 已发布不可改；未发布不可执行 |
| 画布（`renderer/features/workflows`） | T18 | 复用 canonical graph；未发布图明确提示「Runtime 不会执行此图」；发布失败保留画布内容 |
| 可写 Team（`renderer/features/teams`） | T19 | 与 T12 不共改文件；预设保留 |
| 对话生成（`renderer/features/workflow-authoring`） | T20 | 无冻结会话协议前入口不得假成功；会话回复不写成 Task/Run 完成 |
| 双执行模式选择面 | T21 | 靠 probe 显隐；无能力 disabled；UI 不得预置可点击 `direct` |
| `capabilities` 扩展与启动字段 | T10 | `unsupported_capability` 在启动前返回 |

共享文件（每个只能一个负责人，按任务清单的唯一负责人规则串行修改）：

| 共享文件 | 为什么必须串行 |
|---|---|
| `apps/daemon/src/api/routes.ts` | 唯一 `registerRoutes`，所有新 HTTP 路径都在此 |
| `apps/daemon/src/api/rewrite.ts` | 命令式 URL 的资源白名单只有 projects/tasks/runs/approvals（§3.7d） |
| `apps/daemon/src/modules/index.ts`（`AppServices`） | API↔Application 公共契约；新用例必须扩面 |
| `apps/daemon/src/modules/dto.ts` + `fake-app-services.ts` | DTO 与第二个 AppServices 实现必须同步，否则 Fake HTTP 契约测试断 |
| `apps/daemon/src/composition/app-services.ts` / `catalog.ts` | 生产 composition root 与模板夹具 |
| `packages/protocol/src/workflow.ts` + `index.ts` | 加 nodes/edges 会动公共 strict schema |
| `packages/desktop-client/src/{paths,client,types,index}.ts` | 每条新路由要加 path + 方法 + 类型 + 导出 |
| `apps/desktop/src/main/ipc/allowlist.ts` | 唯一写路径闸门；`ipc-whitelist.test.ts:44-78` 已固定断言 workflows 写路径被拒，加写路径必须同步改测试 |
| `apps/desktop/src/preload/contracts.ts` / `bridge.ts` + `packages/ui/src/bridge.ts` | IPC channel 与 preload 形状有契约测试 |
| `apps/desktop/src/renderer/routes/catalog.ts` + `app/feature-modules.ts` | 路由表唯一来源与 glob 装载约定 |

Renderer 侧目前有**两套并行的 client 装配**（`features/_t13_client.ts` 与 `features/hooks.ts` + `_client-fallback.ts`），T18/T19/T20 新增页面前必须先裁决接哪一套，否则同一目录会出现第三套。

### S5 — contract 收紧与 upgrade fixture（T04 / T16）

- 回填与恢复演练通过后：删除 `WorkflowInstance`/`Run` 的冗余 version 列（SQLite 需重建表：create-copy-drop-rename，或 `ALTER TABLE DROP COLUMN`，取决于最低支持版本）；把 `orchestration_mode`/`transport`/`placement_snapshot_json` 收紧为 `NOT NULL`/`CHECK`；施加 workflow_bound 必有 snapshot、direct 必为 NULL 的互斥 CHECK。
- T16 的 `current-M3 upgrade fixture` **必须真跑迁移**（从带历史 Run 的真实 M3 schema 出发），不得只测空库。
- **验收**：contract 后旧列读取关闭；缺失/冲突行仍在 quarantine；升级前后 M3 主路径行为一致（除已声明的模式字段）。

### 关键路径与可并行性

- **关键路径**：S0 → S1 → S2a → S3 → S5。
- **可并行**：S2b/S2c/S2d 之间文件范围不重叠，可同时领取；S4 中 T18 与 T19 可并行（不同目录），T20 依赖 T18 的画布入口但可与 S2d 并行开发（先对 fake port）。
- **必须串行**：S0 内 C5/C6/C8/C9 的冻结顺序；S4 的共享文件改动；S5 依赖 S3 的回填审计结论。

## 6. 验收与测试矩阵

| 场景 | 归属 | 判据 |
|---|---|---|
| 空库全量迁移 + checksum 保护 | T04 | 迁移可重入；回改旧 migration 报 checksum mismatch |
| 历史 M3 schema → expand（真实数据） | T16 | 不丢行、不报 FK 错；旧列可读 |
| backfill 正确性与 quarantine | T04/T16 | workflow_bound 行 snapshot 非空；冲突行进入可审计 quarantine 且不被消费 |
| 计划确认 / 启动拆分 | T09/T16 | `ready` 中间态可重试；重放不重复实例；无半创建实例 |
| 三轴归一化与统一准入 | T09 | 缺省 → `workflow_bound`；direct 不创建 NodeInstance、不推进父聚合；两模式共用守卫测试 |
| 发布不可变 | T04/T09 | 已发布版本 UPDATE 被拒；编辑必须新建 revision |
| `dependsOn` 投影与落库一致性 | T16 | 普通 prerequisite 边进 `dependsOn`；failure/cancel/routing 边不进；换图来源不丢边 |
| 作者面部分失败与恢复 | T14/T16 | 部分应用可枚举 step、可重试/取消/过期；不宣称完整成功 |
| 无能力组合 | T10/T21 | 启动前 `unsupported_capability`，不做假 mode |
| 迁移后崩溃窗口 | T16 | 命令已提交进程未启动 / 进程已启动 Handle 未提交 / Artifact 落盘元数据未提交，三者可测 |
| 投影失败可见性 | T04 | 新增列的约束失败不再被 `dualWriteSqlite` 吞掉；world.json 与 SQLite 不一致可被观测 |
| Electron 写路径闸门 | T10/T11/T18 | 新写路径同时进 daemon 路由与 allowlist，并同步 `ipc-whitelist.test.ts` 的固定断言 |

`docs/blueprint/08-workflow-state-machine.md` §19 的九条验收标准与 `docs/blueprint/10-database-schema.md` §14 的七条同样适用；本表只补 D15–D18 新增部分，不复制既有条目。

现状提醒：Electron allowlist（66 条，`apps/desktop/src/main/ipc/allowlist.ts:5-72`）是 daemon 已注册路由（53 条）的**超集**，其中 17 条 daemon 未实现、命中返回 404；反向有 4 条 daemon 路由未放行。新增写路径时两侧都要动，且 `ipc-whitelist.test.ts:65-77` 目前**断言 workflows 写路径被拒**——那条断言必须随功能落地一起改，否则功能会被测试锁死。

## 7. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 迁移阶段与 D17/D18 代码交错提交 | 产生第三批需 backfill 的脏数据；contract 无法收紧 | expand 先行并冻结「expand 后禁止写不带 mode 的 Run」；新写入路径必须双写 |
| SQLite 只是投影且投影吞错 | 「backfill 审计通过」不可观测；新增 NOT NULL 列可能静默不生效 | S1 伴随「投影失败可见化」；contract 前先证明不一致可被观测 |
| `PlacementSnapshot` 语义在 wire 与 Application 之间重叠 | 调用方以为在选节点，实际被覆盖；文档禁止的「映射不显式」 | §3.4 的 A/B 二选一并写进协议；禁止保留字段但改变行为 |
| 计划确认/启动拆分打破既有 M3 断言 | 桌面 driver 与集成测试红；可能被误判为回归 | 同一 PR 内同步更新精确断言并记录行为变更；headed 验收另行安排 |
| `:confirm-plan` 的审批消费事务不可嵌套 | `nested database transactions are not supported`，或 snapshot 与审批不一致 | S2a 先定事务边界（§3.7a），不把 `consumeGrant` 包进外层事务 |
| `task_dependencies` 落库缺失被 UI 回退文案掩盖 | 换图来源后静默丢依赖边 | contract test 同时覆盖投影与落库；不允许「依赖：未返回」作为通过条件 |
| `workflow_versions` upsert 改写已发布版本 | 历史版本被静默覆写，审计链断裂 | 发布只 insert once；repository 拒绝 UPDATE；`content_hash` 真实计算；加不可变测试 |
| 目录 / fixture / 执行图三者不一致 | 画布编辑的对象与真正执行的图不是同一个 | S2a 先收敛为「已发布 `WorkflowVersion` 是唯一执行图来源」，再做画布 |
| SQLite 收紧 CHECK 需要重建表 | 迁移时间长；重建期间「一 Task 一活动 Run」部分唯一索引短暂消失 | 按 D04 分批回填；启动先备份并校验 checksum；重建期间禁止并发启动 |
| 双执行模式出现两条准入路径 | direct 少走守卫，治理被绕过 | §3.2 的单一准入不变量 + 共用契约测试 |
| 公开 DTO 双份手写（`RunDto` 等） | 新字段落在两个不受检查器约束的副本里，漂移不可发现 | C13 先裁决归属；未裁决前不加 D18 字段 |
| Renderer 两套 client 装配并存 | 新增页面出现第三套装配 | S4 前裁决接哪一套 |

## 8. 本轮验证与环境限制

已运行并与结论相关的命令（工作目录 `D:\demo\chen\2026\workforce`，Node v24.19.0）：
```text
node tooling/docs/check-docs.mjs
  → Documentation checks passed (49 Markdown files).

git status --short --branch   → ## dev（工作区干净）
git rev-parse HEAD           → c6136098e9bee9f42584f960661dae387b9f2481
```

**未能运行**（环境阻塞，非代码失败）：

```text
pnpm / pnpm install / pnpm test
                     → EPERM（pnpm 启动 node 做版本探测即被拒绝）
node node_modules/vitest/vitest.mjs run ...
                     → vite `optimizeSafeRealPathSync` 的 execFile EPERM，配置加载失败
node --test tooling/docs/check-docs.test.mjs
                     → 测试运行器 spawn 子进程 EPERM
node -e "child_process.execFileSync(process.execPath, ...)"
                     → EPERM（连 cmd.exe 也一样）
```

精确结论（已实测，非推测）：本会话沙箱**禁止任何 Node 进程创建子进程**（`child_process` 的任意 spawn 都返回 EPERM）。因此 `vitest` 与 node 测试运行器都无法启动；而 `tsc`、`turbo` 可用，因为它们是**由 PowerShell 直接启动**、自身不再派生 Node 子进程的那部分路径（`turbo` 派生的 `pnpm run typecheck` 仍在 EPERM 与环境变量之间部分可用）。

**另有第二个独立阻塞：pnpm store 不完整。** `packages/database` 的 `package.json` 声明了 `@workforce/domain` 与 `@workforce/policy`，但 `packages/database/node_modules/@workforce/` 下**只有 `application`**；`packages/process` 声明了 `@workforce/application`（且其源码 import `@workforce/application/ports`），却只装了 `domain`。这既解释了 `turbo run typecheck` 里那两个 `TS2307`，也解释了为什么按包独立跑 `tsc` 或 Node 探针时无法解析工作区包。修复需要 `pnpm install`（或删 `node_modules` 重装），而 `pnpm` 在本沙箱内无法运行。

**因此本文件 §2 的代码结论来自源码阅读 + 用 Node 直接执行的真实探针，不是 vitest 证据。** 需要在可用环境补跑 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm typecheck` 与 `pnpm check:docs`，再据实更新 [03-implementation-status.md](03-implementation-status.md)。

### 8.1 本环境可用的验证手段（供后续复用）

| 手段 | 可用 | 说明 |
|---|---|---|
| `node tooling/docs/check-docs.mjs` | ✅ | 直接执行，无子进程 |
| `node node_modules/typescript/bin/tsc -p <pkg>/tsconfig.json --noEmit` | ✅ | 独立 tsc 不派生子进程 |
| `node node_modules/turbo/bin/turbo run typecheck` | ⚠️ | 能跑，但受 §8 的 pnpm store 缺口影响 |
| Node 探针（`--experimental-transform-types` + `--import ./tooling/scripts/register-ts-esm.mjs`） | ✅ | 可 import 真实源码执行断言；参数属性需 transform-types；跨包裸导入受 store 缺口限制 |
| vitest / `pnpm test` / `node --test` | ❌ | 均需派生 Node 子进程 |

## 9. 未决问题与已定事项

### 9.1 仍需决策（阻塞 S0）

1. **wire 契约策略**：§3.4 的 A（保持 `0.1`，`placement` 降级为 intent + `orchestrationMode` 可选归一化）还是 B（升协议版本，引入显式 `placementIntent`）。这是 S0 的第一个动作，不定就无法冻结 C6/C8/C9。
2. **`RunDto`/`ProjectDto`/`TeamDto` 的归属**（C13）：迁入 `packages/protocol`，还是明确指定权威方与校验方式。不定就直接加 D18 字段，等于把字段冻结在两个不受检查器约束的副本里。
3. **实施范围**：只做 S0+S1（契约冻结 + expand 迁移），还是同时启动 S2a/S2b。
4. **`current-M3 upgrade fixture` 与 headed Electron 验收由谁执行**：本会话环境无法运行测试（§8），需要指定可运行测试的机器或授权。

### 9.2 本轮已定

- **本文档的处理**：保留在工作区供审阅，补齐 [communication-history.md](communication-history.md) 条目并跑通 `check:docs`。
- **T02 切片取舍**：改为加法式，`StartRunRequest` 定位为 Adapter SPI 边界请求、不修改；三轴走 `packages/protocol/src/execution.ts`（见 §5 S0 进度）。
- **验证方式**：接受 §8 的环境限制，用 `tsc` + `check-docs` + Node 真实探针作为本切片证据；vitest 证据待有可用环境再补。

### 9.3 已知不一致（本文不改，仅登记）

1. `.github/workflows/pull-request.yml` 仍为 `push.branches: [main]`，而 [04-collab-and-review.md](04-collab-and-review.md) §0 已把 `dev` 定为唯一集成分支；远程默认分支仍是 `origin/main`。改 CI 触发分支属仓库配置改动，推送与改远程默认分支需要明确授权。影响：合入 `dev` 后不触发 post-merge push 流水线，只有 PR 流水线生效。
2. **pnpm store 与 `package.json` 声明不一致**（§8）：`packages/database` 缺 `@workforce/domain`、`@workforce/policy` 链接；`packages/process` 缺 `@workforce/application` 链接。这不是文档问题，是环境/依赖安装问题，需要一次 `pnpm install` 修复；未修复前 `pnpm typecheck` 不会全绿，且"按包独立 typecheck"不可用。

## 10. 关联文档

- 冻结规则：[decision-register.md](decision-register.md)（D02/D07/D15–D18）、[state-matrix.md](state-matrix.md)、[api-capability-matrix.md](api-capability-matrix.md)
- 契约细节：`docs/blueprint/02-domain-model.md` §4.6/§4.9A、`08-workflow-state-machine.md` §2/§5、`10-database-schema.md` §4.4/§10/§12
- 流程：[dual-execution-mode-flow.md](../diagrams/dual-execution-mode-flow.md)、[workflow-authoring-flow.md](../diagrams/workflow-authoring-flow.md)、[node-scheduling-flow.md](../diagrams/node-scheduling-flow.md)
- 任务与进度：[02-development-task-backlog.md](02-development-task-backlog.md)、[03-implementation-status.md](03-implementation-status.md)
- 决策来源：[communication-history.md](communication-history.md)
