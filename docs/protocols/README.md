# Workforce Protocols

**状态：** T02 起草中（文档层）。可执行源落地后为 `packages/protocol`，由该包生成 JSON Schema / DTO / OpenAPI。  
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

`org_` `prj_` `tsk_` `run_` `wfd_` `wfv_` `wfi_` `wfn_` `tm_` `tmv_` `art_` `arv_` `apr_` `wsp_` `wsi_` `evt_` `op_` `ndl_` `rtm_` `usr_` `cli_`

ID 为不透明字符串；推荐 UUIDv7。未知 major `protocolVersion` 必须拒绝。

## 本目录文件

- `v0.1/event-envelope.schema.json` — Event 权威 envelope
- `v0.1/money.schema.json` — `costMinor` + `currency`
- `v0.1/expected-output.schema.json` — 稳定 `id` + `kind`
- `v0.1/workflow-catalog.schema.json` — WorkflowDefinition / WorkflowVersion（已发布目录 + M7 草稿图 nodes/edges；未发布不可执行）
- `v0.1/team.schema.json` — Team / TeamVersion（预设 + M7 自定义草稿/发布；未发布不可 `:start-planning`）
- `v0.1/task.schema.json` — 公开 `TaskDto`，含已发布 DAG 的 `dependsOn`
- `v0.1/fixtures/` — 可校验完整示例；概念节选不得放这里
- `v0.1/ports.md` — M3 公共 ports 签名（T02 编码进 TypeScript）；ArtifactStore 权威与 Task `dependsOn` 映射

生成器就绪后，schema 由代码生成覆盖手写副本；fixture 仍作为 contract 测试输入。
