# Workforce Protocols

**状态：** T02 的 V0.1 JSON Schema 与 OpenAPI 3.1 均由同一 Zod registry 生成；`protocol:schema:check` 拒绝漂移与破坏性 OpenAPI 变化。可执行源为 `packages/protocol`。
**权威：** [decision-register.md](../planning/decision-register.md)、[state-matrix.md](../planning/state-matrix.md)、[api-capability-matrix.md](../planning/api-capability-matrix.md)、[ADR 0003](../adr/0003-v01-contract-freeze.md)。

蓝图是解释；本目录与 `packages/protocol` 是实现契约。冲突以决策登记 + 本目录 fixture 为准。

## 分层

| 层 | 位置 | 禁止 |
|---|---|---|
| Domain 不变量 | `packages/domain` | Node/Electron/SQLite 类型 |
| JSON/DTO/OpenAPI | `packages/protocol` | 宿主绝对路径、secret |
| Runtime SPI | `packages/runtime-spi` | 直接写 Task/Run 表 |
| Ports | `packages/application/src/ports` | 具体 Drizzle/Fastify |
| HTTP | `apps/daemon` 实现；OpenAPI 由 protocol 生成 | handler 内写业务状态机 |

## V0.1 标识前缀（仅可读，不参与判断）

`org_` `prj_` `tsk_` `run_` `wfd_` `wfv_` `wfi_` `wfn_` `tm_` `tmv_` `art_` `arv_` `apr_` `wsp_` `wsi_` `evt_` `op_` `ndl_` `rtm_` `snp_` `usr_` `cli_` `wrk_` `wrv_` `wrdraft_`

ID 为不透明字符串；推荐 UUIDv7。未知 major `protocolVersion` 必须拒绝。

## 本目录文件

- `v0.1/event-envelope.schema.json` — Event 权威 envelope
- `v0.1/money.schema.json` — `costMinor` + `currency`
- `v0.1/expected-output.schema.json` — 稳定 `id` + `kind`
- `v0.1/workflow-catalog.schema.json` — WorkflowDefinition / WorkflowVersion 目录；GET 列表仍只返回 published
- `v0.1/team.schema.json` — Team / TeamVersion 写契约（draft | published）
- `v0.1/authoring-session.schema.json` — D17 会话 / 草稿 DTO；创建类仍走 Project-scoped AuthoringSession。全局 Chat 四类意图在 `chat-classify-result.schema.json`，不是 IM 消息库
- `v0.1/workflow-graph-definition.schema.json` — 画布、作者与发布共用的严格有限 DAG；目录 DTO 不替代它
- `v0.1/workflow-draft.schema.json` — 可编辑 `WorkflowDraft`，含 graph、revision 与内容摘要
- `v0.1/team-draft.schema.json` — 可编辑 `TeamDraft`，含 members、revision 与内容摘要
- `v0.1/worker.schema.json` — 角色库 Worker identity
- `v0.1/worker-version.schema.json` — 已发布/草稿投影 `WorkerVersion`；`published + immutable` 不可改
- `v0.1/worker-draft.schema.json` — 可编辑 `WorkerDraft`
- `v0.1/worker-page.schema.json` — 库列表/搜索分页
- `v0.1/worker-version-references.schema.json` — 某 WorkerVersion 被哪些 TeamVersion 引用
- `v0.1/fork-worker-version-accepted.schema.json` — fork 得到新 identity + 新草稿
- `v0.1/chat-classify-result.schema.json` — 全局 Chat 四类意图或诚实 unsupported；不是 IM，不是完成态
- `v0.1/project-progress-projection.schema.json` — 问进度只读投影；无记录显式「还没有记录」
- `v0.1/authoring-proposal.schema.json` — 编排 Runtime 的结构化输出；只允许脱敏摘要与 Artifact 引用
- `v0.1/authoring-change-set.schema.json` — 逐目标 CAS 的 ChangeSet / staged step 状态；应用不等于发布或执行
- `v0.1/orchestration-mode.schema.json` — D18 `orchestrationMode` 枚举；权威在 `packages/protocol/src/execution.ts`
- `v0.1/task.schema.json` — 公开 `TaskDto`，含已发布 DAG 的 `dependsOn`
- `v0.1/project.schema.json` — 公开 `ProjectDto`；`executionSnapshotId` / `orchestrationMode` 可选，直至 Application 写入已解析快照
- `v0.1/run.schema.json` — 公开 `RunDto`；三轴字段可选，直至 Application 写入已解析快照
- `v0.1/project-execution-snapshot.schema.json` — 公开 `ProjectExecutionSnapshotDto`；不含 policy/budget 载荷
- `v0.1/openapi.json` — 由同一 registry 生成的 OpenAPI 3.1 文档；只发布 `components.schemas`，HTTP paths 仍由 Daemon 实现
- `v0.1/fixtures/` — 可校验完整示例；概念节选不得放这里
- `v0.1/ports.md` — M3 公共 ports 签名（T02 编码进 TypeScript）；ArtifactStore 权威与 Task `dependsOn` 映射

所有 `*.schema.json` 与 `v0.1/openapi.json` 均由 `packages/protocol/src/json-schema-registry.ts` 中明确登记的 Zod 权威 schema 生成，禁止手改。新公开 DTO 必须写入该 registry（`export const *DtoSchema` 会在生成/门禁中强制入册），避免再出现「代码有、schema 无」。修改协议后运行 `pnpm protocol:schema:generate`；CI/本地门禁运行 `pnpm protocol:schema:check`，它会拒绝缺失、额外或内容漂移的生成物，并标出 OpenAPI 破坏性变化（删除 schema/字段、收紧 required、删枚举值、改 type）。JSON Schema / OpenAPI 是跨语言**结构**契约；Zod 的 `superRefine` 与其它运行时不变量仍必须由 protocol 测试和 fixture 覆盖。
