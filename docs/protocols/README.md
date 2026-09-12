# Workforce Protocols

**状态：** T02 的 V0.1 JSON Schema 生成与漂移门禁已实现。可执行源为 `packages/protocol`；OpenAPI 生成仍未实现。
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

`org_` `prj_` `tsk_` `run_` `wfd_` `wfv_` `wfi_` `wfn_` `tm_` `tmv_` `art_` `arv_` `apr_` `wsp_` `wsi_` `evt_` `op_` `ndl_` `rtm_` `snp_` `usr_` `cli_`

ID 为不透明字符串；推荐 UUIDv7。未知 major `protocolVersion` 必须拒绝。

## 本目录文件

- `v0.1/event-envelope.schema.json` — Event 权威 envelope
- `v0.1/money.schema.json` — `costMinor` + `currency`
- `v0.1/expected-output.schema.json` — 稳定 `id` + `kind`
- `v0.1/workflow-catalog.schema.json` — WorkflowDefinition / WorkflowVersion 目录；GET 列表仍只返回 published
- `v0.1/team.schema.json` — Team / TeamVersion 写契约（draft | published）
- `v0.1/authoring-session.schema.json` — D17 会话 / 草稿 DTO；V0.1 不提供泛用 Chat API，而提供受鉴权、Project-scoped 的 AuthoringSession / Message / Turn API，用于生成并确认未发布草稿
- `v0.1/workflow-graph-definition.schema.json` — 画布、作者与发布共用的严格有限 DAG；目录 DTO 不替代它
- `v0.1/workflow-draft.schema.json` — 可编辑 `WorkflowDraft`，含 graph、revision 与内容摘要
- `v0.1/authoring-proposal.schema.json` — 编排 Runtime 的结构化输出；只允许脱敏摘要与 Artifact 引用
- `v0.1/authoring-change-set.schema.json` — 逐目标 CAS 的 ChangeSet / staged step 状态；应用不等于发布或执行
- `v0.1/orchestration-mode.schema.json` — D18 `orchestrationMode` 枚举；权威在 `packages/protocol/src/execution.ts`
- `v0.1/task.schema.json` — 公开 `TaskDto`，含已发布 DAG 的 `dependsOn`
- `v0.1/run.schema.json` — 公开 `RunDto`；三轴字段可选，直至 Application 写入已解析快照
- `v0.1/project-execution-snapshot.schema.json` — 公开 `ProjectExecutionSnapshotDto`；不含 policy/budget 载荷
- `v0.1/fixtures/` — 可校验完整示例；概念节选不得放这里
- `v0.1/ports.md` — M3 公共 ports 签名（T02 编码进 TypeScript）；ArtifactStore 权威与 Task `dependsOn` 映射

所有 `*.schema.json` 均由 `packages/protocol/src/json-schema-registry.ts` 中明确登记的 Zod 权威 schema 生成，禁止手改。修改协议后运行 `pnpm protocol:schema:generate`；CI/本地门禁运行 `pnpm protocol:schema:check`，它会拒绝缺失、额外或内容漂移的生成物。JSON Schema 是跨语言**结构**契约；Zod 的 `superRefine` 与其它运行时不变量仍必须由 protocol 测试和 fixture 覆盖。
