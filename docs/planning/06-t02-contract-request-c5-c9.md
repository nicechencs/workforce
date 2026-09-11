---
title: T02 契约变更请求（C5–C9）
type: proposal
status: current
owner: maintainers
updated: 2026-09-11
---

# T02 契约变更请求：C5–C9

本页把 [D15–D18 落地方案](05-d17-d18-landing-plan.md) §4 的 **C5–C9** 翻译成可直接裁决的契约变更请求：每项给出**建议形态（字段与签名）**、理由与**兼容性影响**，标出只有 T02 能定的问题。2026-09-11 已按下列默认全批并开始落入 `packages/protocol`。未实现 HTTP `POST /tasks/{id}/runs`、未改 `confirmPlan`、未加 `runtime_profile_versions.transport` 列。

基线：`dev` @ `f7d4925`。权威顺序按 [决策登记](decision-register.md) D01：决策登记 / 状态矩阵 / 能力矩阵 → 已接受 ADR → `packages/protocol` → 蓝图正文 → Product UI。

## 0. 结论摘要

1. **C 表现状需更正。** `3c46807` 已把 C6/C7/C8 与 C9 的 **Adapter SPI 侧**冻结进 `packages/protocol/src/execution.ts` 与 [ports.md](../protocols/v0.1/ports.md)；落地方案 §5 S0 也已记录 **C9 方案 A 已废弃**。§4 表中 C6/C7 两行仍写「无」，C8/C9 两行仍写冻结前的旧现状，均属文档滞后，不是待办。
2. **真正待裁决的是六项**：CR-1（C5 快照 DTO/ID）、CR-2（C9 HTTP 入口）、CR-3（C6/C7 Run 响应面）、CR-4（C13 归属，CR-3 的前置）、CR-5（C8 单一形状的三个矛盾）、CR-6（`snp_` 前缀）。
3. **有八处文档与代码互相矛盾**（§3），必须在同一批裁决里一并了断，否则新字段会落在互相矛盾的权威上。

### 已裁决（2026-09-11）

- CR-2：HTTP 落点为已登记的 `POST /tasks/{id}/runs`，可选 `orchestrationMode?` + `placementIntent?`；`StartRunRequest` 不动；`GET /capabilities` 后续加 mode 维度。**本切片不实现该路由。**
- CR-3：目标语义是响应必填三轴；**当前无写入方，HTTP `RunDto` 先可选**，禁止填假 `workflow_bound`。`transport` 只读、不接受请求。
- CR-4：`ProjectDto` / `RunDto` / `TeamDto` / `TeamRoleDto` 迁入 `packages/protocol`；其余 DTO 另卡；schema 继续手写。
- CR-1：公共快照 DTO 不含 policy/budget；域品牌 `ExecutionSnapshotId`，`SnapshotRef` 为其别名；`contentHash` 覆盖 workflowVersionId + teamVersionId + policy + budget。
- CR-5：snapshot 无 `mode`；Host 使用 protocol `PlacementSnapshot`；`RuntimeHandle` 补可选 node 字段；`runs.placement_snapshot_json` 为 C8 权威。
- CR-6：`ID_PREFIX.snapshot = "snp_"`。
- `transport` 权威列为 `runtime_profile_versions.transport`（T04 再 expand）；`runtime-spi` 的 `RuntimeTransport` 改为从 protocol 再导出。

### C 表现状更正

| C | §4 表原文 | 实际（基线 `15e76bf`） | 性质 |
|---|---|---|---|
| C5 | `ProjectExecutionSnapshot` DTO/ID 无 | 确认无公共 DTO；只有 `runExecutionSnapshotSchema.executionSnapshotId?`（`packages/protocol/src/execution.ts:86`） | **待裁决**（CR-1） |
| C6 | `orchestrationMode` 无 | 枚举**已冻结**（`execution.ts:18,28`），canonical snapshot 中必填（`execution.ts:82-105`）；**wire/Run 面无** | 部分已冻结（CR-2/CR-3） |
| C7 | 无 `transport` | 枚举**已冻结**（`execution.ts:17,27`），snapshot 中必填（`:85`）；**无 DB 权威来源列** | 部分已冻结（CR-3/§3） |
| C8 | 三 ID + `ProviderPlacementSnapshot` | **唯一 `placementSnapshotSchema` 已冻结**（`execution.ts:58-69`，含 `nodeSessionId`/`executionLeaseId`/`fencingToken`）；但存在第二份 `NodeExecutionBinding` 与蓝图 07 §18 Node-aware Runtime Binding 冲突 | 部分已冻结（CR-5） |
| C9 | `placement` 现为必填已解析 binding | **Adapter SPI 侧已冻结**：`StartRunRequest.placement` 保持必填三 ID，axes 不进入其中（`command.ts:40-46`；[ports.md](../protocols/v0.1/ports.md) §76-78）；方案 A 已废弃（`05:239`） | 仅剩 HTTP 入口（CR-2） |

## 1. 变更请求

### CR-1（C5）ProjectExecutionSnapshot 的公共 DTO、ID 品牌与前缀

**请求：** 在 `packages/protocol` 新增公共快照 schema，并确定 id 品牌与前缀。

**现状：**
- `packages/protocol/src/index.ts:4-12` 无 snapshot 模块；公共面唯一出现是 `executionSnapshotId?: string`（`execution.ts:86`）。
- `packages/domain/src/ids.ts:22-38` 的 `ID_PREFIX` 有 17 个前缀，**无 `snp_`**；但 `packages/protocol/src/execution.test.ts:55` 与夹具 `docs/protocols/v0.1/fixtures/run.execution.workflow-bound.json` 已把前缀钉成 `snp_`。
- 蓝图定义的域接口（`docs/blueprint/02-domain-model.md:239-249`、`08-workflow-state-machine.md:70-79`）用 `SnapshotRef` + `policySnapshotRef` / `budgetSnapshotRef?`；已落地实现用 **inline JSON**（`packages/application/src/use-cases/projects/store.ts:57-66`、`packages/database/src/execution-snapshots.ts:19-28`、`schema.ts:690-691`）。

**建议形态（需 T02 批准）：**

```ts
// packages/protocol/src/execution-snapshot.ts
export const projectExecutionSnapshotSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    workflowVersionId: z.string().min(1),
    teamVersionId: z.string().min(1),
    contentHash: z.string().min(1),
    immutable: z.literal(true),
    createdAt: z.string(),
  })
  .strict();
export type ProjectExecutionSnapshotDto = z.infer<typeof projectExecutionSnapshotSchema>;
```

- id 一律 `z.string().min(1)`：现有公共 DTO 从不用品牌（`task.ts:14-33`、`workflow.ts:12-49`），品牌留在 `packages/domain`。
- 理由：`workflowVersionId` + `teamVersionId` 同处一个不可变对象，正好满足 D02「Run 不重复保存/直读这两个版本」；`contentHash` 承载统一 digest；`immutable: true` 与 `packages/protocol/src/workflow.ts:31` 的既有写法一致。
- **policy/budget：建议公共 DTO 不暴露。** 它们是执行凭据细节，按 D12（脱敏）与最小暴露原则留在域/存储；公开面只给引用事实。若 T02 要求公开，需同时定 `policySnapshotRef` 的对象与存储位置（见 §3）。

**兼容性：** 纯新增 schema，不改动任何现有 wire 对象；`snp_` 前缀与既有测试/夹具一致。

**待 T02 裁决：** ①品牌名 `ExecutionSnapshotId` 还是蓝图用的 `SnapshotRef`（二者只能取其一，若都保留须明说一个是别名）；②`snp_` 是否冻结并写入 `ID_PREFIX`；③policy/budget 是否公开；④`contentHash` 的**输入字段集合**（`state-matrix.md:85` 只说「统一 `contentHash`」，未定义输入）。

### CR-2（C9）HTTP 启动入口的三轴：复用 `POST /tasks/{id}/runs`

**请求：** 确认三轴的 HTTP 落点，并冻结其**可选**字段与归一化规则；`StartRunRequest` 不动。

**现状：**
- Adapter SPI 侧已冻结：`StartRunRequest.placement` 必填三 ID，且 [ports.md](../protocols/v0.1/ports.md) §78 明确「执行位置与编排方式**不进入** `StartRunRequest`」；方案 A（把 `placement` 降级为 intent）已废弃。
- [能力矩阵](api-capability-matrix.md) §120 已把 `POST /tasks/{id}/runs` 列为「必须」，但 `apps/daemon/src/api/routes.ts` 尚无该路由。**准确的范围是：** 没有任何 Application/HTTP 写路径消费 `orchestrationMode`/`placementIntent`，也没有任何代码写 `runs.orchestration_mode`/`transport`/`placement_snapshot_json`；但轴类型**已有一份 protocol 之外的声明**（`packages/runtime-spi/src/adapter.ts:3,24` 自行声明 `RuntimeTransport`），且 `transport` 以硬编码形式出现在公共 `RuntimeDto`（`dto.ts:222`、`types.ts:241`、`catalog.ts:139`）——二者已列入 §3。
- 矩阵 §204 要求「优先复用…现有 Run 启动命令，而不是另开未登记的 `:direct` 资源」。

**建议形态（需 T02 批准）：**

```ts
// POST /tasks/{id}/runs 请求体（两个轴字段均为可选）
{
  operationId: string;
  placementIntent?: {           // 复用已冻结的 placementIntentSchema
    mode: "automatic" | "local_only" | "remote_only" | "specific_node";
    nodeId?: string;
    requiredLabels?: Record<string, string>;
    preferredLabels?: Record<string, string>;
    dataLocality?: "workspace_local" | "replicated" | "remote_access";
  };
  orchestrationMode?: "workflow_bound" | "direct";
}
```

Application 归一化（D07 默认层级）：缺失 → `orchestrationMode = workflow_bound`、`placement = local_only`；`transport` 永不接受客户端输入，只从选定 RuntimeProfile/RuntimeInstallation 解析；解析后写入 canonical `RunExecutionSnapshot`（其中三者必填）。`direct` 仍创建 Task/Run 并走 Policy/Budget/Workspace/Approval，只是不推进 WorkflowInstance/Project 完成度。

**备选（若 T02 不采纳）：** 不加任何 wire 轴字段，mode/intent 完全由 Task/Project 配置派生——则须同时冻结 Task 上的默认 mode 字段，否则「按 Agent 选择」无处承载（[api-capability-matrix.md](api-capability-matrix.md) §68）。

**兼容性：** 新增**可选**字段，0.1 无需升版；`POST /tasks/{id}/runs` 尚未实现，无历史消费者。若坚持必填则必须升 0.2。

**待 T02 裁决：** ①落点是否就是该路由；②是否需要 Task 级默认 mode；③`GET /capabilities` 是否必须新增 mode 维度以支撑「无能力则禁用」。

### CR-3（C6/C7）Run 响应面暴露三轴

**请求：** 提供公共 `RunDto`，暴露 `orchestrationMode` / `transport` / `executionSnapshotId?`。

**现状：** `RunDto` 在 `apps/daemon/src/modules/dto.ts:56-74` 与 `packages/desktop-client/src/types.ts:56-74` 各手写一份，均无三轴；生产者 `apps/daemon/src/composition/app-services.ts:1638-1655` 也不产出。`RuntimeDto.transport` 在 `dto.ts:222` 硬编码 `"sdk"`。

**建议形态（需 T02 批准）：**响应描述**已解析**的 Run，故：

| 字段 | 响应面 | 请求面 |
|---|---|---|
| `orchestrationMode` | **必填** | 可选（CR-2） |
| `transport` | **必填**，只读 | **不接受** |
| `executionSnapshotId` | 仅 `workflow_bound` 出现 | 不接受 |

**兼容性：** 依赖 CR-4；DB 侧 `runs.orchestration_mode` / `transport` 已 expand 为**可空**，而 canonical 快照必填——需 T02 明说「响应必填」发生在内存/canonical 层，DB 收紧留给 contract 阶段（否则与 `blueprint/10:382` 的 expand→contract 顺序冲突）。

**待 T02 裁决：** ①响应面必填是否与「0.1 wire DTO 不得必填」的既有结论冲突（该结论原文限定在 `workforce.task/0.1` 信封，未覆盖 HTTP `RunDto`）；②`transport` 的权威来源（见 §3）。

### CR-4（C13）`RunDto` / `ProjectDto` / `TeamDto` 归属——CR-3 的前置

**请求：** 把三个 DTO 移入 `packages/protocol`，daemon 与 desktop-client 改为 re-export。

**理由：** [AGENTS.md](../../AGENTS.md) 红线禁止「绕过 `packages/protocol` 复制第二套规则」；C6/C7 的新字段若落在两份不受检查器约束的副本里，等于把 D18 冻结在两个地方。落地方案 §3.5c 与 §4 C13 已判定必须先解决。

**兼容性：** 纯类型迁移，运行期零变化；但 `docs/protocols/v0.1/*.schema.json` 是**手写副本、无 codegen**（只有 `event-envelope` / `expected-output` / `money` / `task` / `workflow-catalog`），因此需同时决定：手写 schema 并靠检查器比对，还是引入生成。

**待 T02 裁决：** ①迁移范围是否含 `ApprovalDto` / `ArtifactDto` 等其余手写 DTO；②schema 手写还是生成。

### CR-5（C8）`PlacementSnapshot` 的单一形状

**请求：** 消除三处并存形状，使 C8 只有一个权威。

**现状与冲突：**

| 位置 | 形状 | 问题 |
|---|---|---|
| `packages/protocol/src/execution.ts:58-69` | `placementSnapshotSchema`（无 `mode`） | 已冻结的 canonical |
| `docs/blueprint/07-runtime-protocol.md:640-648` | `PlacementSnapshot` 带必填 `mode` | 与 canonical 直接冲突 |
| `packages/runtime-sdk/src/types.ts:4-11` | `NodeExecutionBinding`（同字段集，少 `legacySchemaVersion`） | 蓝图 `10:447` 明说「不再另设平行 NodeExecutionBinding」 |

**建议（需 T02 批准）：** ①`mode` 只属于 intent（`execution.ts:38-46`），把蓝图 07 §18 更正为与 canonical 一致；②`NodeExecutionBinding` 要么由 protocol `PlacementSnapshot` 取代，要么明确声明为**内部存储投影**并写出显式映射（不得两条规则）；③`RuntimeHandle`（`runtime-spi/src/adapter.ts:35-42`）是否按蓝图 `07:651` 补 `nodeId`/`nodeSessionId`/`runtimeInstallationId`；④`placement_snapshot_json` 的单一权威：`runs`（`schema.ts:707`，已解析 binding）与 `scheduling_records`（`schema.ts:478`，`NOT NULL`）哪个是 C8 权威，或二者是「binding vs 决策历史」的不同对象。

### CR-6（C5 附属）`ID_PREFIX` 补齐 `snp_`

**请求：** 若 CR-1 采纳 `snp_`，在 `packages/domain/src/ids.ts` 的 `ID_PREFIX` 增 `snapshot: "snp_"`。

**兼容性：** 纯新增常量；前缀本身是约定，DDL 不校验。当前测试已钉该前缀而常量缺失，属「测试先于常量」。

## 3. 必须一并裁决的文档—代码冲突

这些不是本请求发明的问题，而是**已经互相矛盾**的既有权威；新字段落在任一边都会加固错误一方。

| # | 冲突 | 一侧 | 另一侧 |
|---|---|---|---|
| X1 | `PlacementSnapshot` 是否含 `mode` | `blueprint/07:640-648` 含 | `protocol/execution.ts:58-69` 不含（`.strict()`） |
| X2 | policy/budget 表示 | `blueprint/02:239-249`、`08:70-79` 用 `*SnapshotRef` | 落地为 inline JSON（`store.ts:57-66`、`schema.ts:690-691`） |
| X3 | 平行绑定模型 | `blueprint/10:447` 禁止 `NodeExecutionBinding` | `runtime-sdk/src/types.ts:4-11` 定义并使用 |
| X4 | `placement_snapshot_json` 归属 | `runs`（`schema.ts:707`，binding） | `scheduling_records`（`schema.ts:478`，`NOT NULL`） |
| X5 | `transport` 权威来源 | D07 与 `ports.md`：来自选定 RuntimeProfile/RuntimeInstallation | `runtime_profile_versions` **无 transport 列**（`schema.ts:62-70`），`RuntimeDto.transport` 硬编码 `"sdk"`（`dto.ts:222`） |
| X6 | `RuntimeHandle` 绑定字段 | `blueprint/07:651` 要求含 node 字段 | `runtime-spi/src/adapter.ts:35-42` 无 |
| X7 | `StartRunRequest` 的形状 | `blueprint/07:202-223`（`## 7. 启动 Run`）带 `execution{transport, placement, orchestrationMode, executionSnapshotId?, runSnapshotDigest}` | `command.ts:30-55` 冻结为必填三 ID 且无轴字段；[ports.md](../protocols/v0.1/ports.md) §76-78 站在后者一边 |
| X8 | `transport` 轴类型只有一份声明 | `protocol/execution.ts:17,27` | `runtime-spi/src/adapter.ts:3,24` 自行声明 `RuntimeTransport`，未引用 protocol |

## 4. 顺序与阻塞

```text
CR-4（归属）─→ CR-3（Run 响应面）
CR-1 + CR-6（快照 DTO/ID）——独立
CR-2（HTTP 入口）——独立，但「按 Agent 选择」依赖 Task 默认字段是否冻结
CR-5（单一形状）——独立，但改动 runtime-sdk 与蓝图 07/10
X1–X6 ——随各自 CR 一并裁决，不得留到实现期
```

`CR-4 → CR-3` 是硬前置：否则 D18 字段会同时落在 `apps/daemon/src/modules/dto.ts` 与 `packages/desktop-client/src/types.ts` 两份副本（落地方案 §3.5c 已判定）。

## 5. 不在本请求内

- D02 的行为拆分（`:confirm-plan` 只建 snapshot、`:start` 才建实例）——应用层行为变更，属 S2a。
- 迁移 backfill / switch / contract、DB `NOT NULL`/`CHECK` 收紧——属 T04（受限的 expand 已落地）。
- C1–C4（画布 / 草稿 / 作者面）与 C10–C12——不在本请求内。**例外**：CR-4 本身就是 C13；CR-2 ③（`GET /capabilities` 是否新增 mode 维度）触及 C12 的能力探针维度。C10 与 C5 强相关，建议紧随 CR-1。
- D17 对话生成、D18 双执行模式的**功能实现**——本请求只冻结它们依赖的字段与归属。

## 6. 裁决后如何验证

1. `packages/protocol` 新增/变更的 schema 必须有正反用例（沿用 `packages/protocol/src/execution.test.ts` 的 `parse` 断言风格），且 `execution.test.ts:123-141` 对 `StartRunRequest` 的**键集锁定**不得被动：CR-2 落地必须落在 HTTP body 而非该 SPI 对象。
2. `ID_PREFIX` 变更后，`execution.test.ts:55` 与 `fixtures/run.execution.workflow-bound.json` 的 `snp_` 断言仍须通过。
3. CR-4 迁移后，`apps/daemon/src/modules/dto.ts` 与 `packages/desktop-client/src/types.ts` 不得再出现手写副本（以 re-export 取代），并由 typecheck 保证两处同源。
4. 每项裁决落库后，同步回写 [能力矩阵](api-capability-matrix.md)、[状态矩阵](state-matrix.md)（如涉及状态/字段）与 [产品沟通历史](communication-history.md)（按仓库约定必须追加条目），并运行 `pnpm check:docs`。

## 关联文档

- [D15–D18 落地方案](05-d17-d18-landing-plan.md)（§4 本请求的来源表）
- [决策登记](decision-register.md)（D01 权威顺序、D02、D07、D18）
- [状态矩阵](state-matrix.md) / [能力矩阵](api-capability-matrix.md)
- [公共 ports](../protocols/v0.1/ports.md)
- [实现进度](03-implementation-status.md)
- [产品沟通历史](communication-history.md)
