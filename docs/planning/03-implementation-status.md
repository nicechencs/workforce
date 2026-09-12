---
title: Workforce V0.1 Implementation Status
type: status
status: current
owner: maintainers
updated: 2026-09-12
---

# V0.1 实现进度（以代码与测试为准）

日期：2026-09-12  
权威：本文件记录**实际已验证**的实现。任务清单 `02-development-task-backlog.md` 的“均未开始”已过时。协作与评审见 [04-collab-and-review.md](04-collab-and-review.md)。  
修订：2026-09-12 — T11 完成设计系统收口：`renderer/components/` 补齐 Dialog / DropdownMenu / Tooltip / Toast / Table / Skeleton；画布与 Team 写页改组合共享组件；`features/projects/ui.ts` 收成对 `--wf-*` 语义变量的兼容再导出，删除第二套 hex。作者壳与 orchestration 控件仍走该再导出，未改其文件。未跑 Vitest；headed 画布仍未宣称。

修订：2026-09-12 — T02 完成 **canonical graph / authoring operation 协议切片**：`WorkflowGraphDefinition` 成为画布、作者和发布共用的严格有限 DAG，拒绝悬空引用、重复 ID 与环；新增 `WorkflowDraft`、`TeamDraft`、结构化 `AuthoringProposal`、`AuthoringChangeSet` 与逐目标 CAS step DTO。Proposal/ChangeSet 只保存摘要或 Artifact 引用，不接受 raw prompt 字段；ChangeSet 应用也不代表发布或执行。14 个版本化 JSON Schema 由 registry 生成并受门禁检查，协议完整测试 53/53 通过。Application authoring use case、Runtime 调用、staged apply/recovery 和 Daemon 接线仍未实现。

修订：2026-09-12 — T04 完成 **authoring persistence 切片**：`workflow_drafts` 与 `team_drafts` 由 append-only、revision-CAS repository 写入；`AuthoringChangeSet` 与其全量 step 在同一事务入库，并校验 source Run 与 Project/organization 的归属。ChangeSet/step 状态均以预期当前状态 CAS 推进，避免并发覆盖。Database typecheck 和定向 3/3 通过。Application staged apply/recovery、Runtime proposal 产出与 Daemon/Renderer send 仍未实现。

修订：2026-09-12 — T20-B 完成 **Application staged-apply M3 切片**：已校验的 `validating` ChangeSet 只可应用到已有 Workflow/Team Draft revision；用例先校验 Project/organization、source Run、所有 target 和全部 CAS 基线，再一次性写入新 draft revision、`applied` steps 和审计事件。Draft/ChangeSet 现已纳入 SQLite world snapshot、Daemon dual-write 与 composition reload，可跨重启恢复。Task patch、Runtime proposal、部分失败恢复与 Daemon/Renderer send 均不在本切片；不发布、不启动生成的 Workflow。Application/Database/Daemon typecheck 和跨层定向测试通过。

修订：2026-09-12 — T20-B 完成 **authoring Proposal 生命周期 M3 切片**：`authoring.start` 创建受治理 Task/Run，复用既有 placement/Runtime Host 检查；Runtime 的结构化 Proposal 由 Daemon 从已绑定 handle 反查 source Run/Project 后回调到 Application，创建 `proposed` ChangeSet，再由显式 validate 进入 `validating`。raw intent 不写 Event、ChangeSet 或 Draft；当前也没有安全的 Runtime 交接，必须先完成 `T20-B-PROMPT-HANDOFF`，不得误报为 Agent 已收到输入。Task patch、失败/取消/重试、Codex 映射和 Renderer send 未实现。

修订：2026-09-12 — T20-B 完成 **Application Chat Proposal 确认切片**：`confirmAuthoringChatProposal` 严格解析受信 chat proposal，解析 authoring session / turn / Run 授权后，在同一事务写入 identity、authority、revision 1 WorkflowDraft 与 committed command receipt，重放不会产生第二份 draft；只有严格解析通过的 committed receipt 才算成功重放，pending/failed 不算；key/digest 冲突、跨 scope proof 与 stale update CAS 被拒绝，事件 append 失败时回滚全部领域写入并记录诚实失败。Application typecheck 与 75 项测试通过。Daemon/session 持久化、受保护 prompt handoff、typed HTTP 与 Renderer send 仍未实现。

修订：2026-09-12 — T04 完成 **009_workflow_authoring_scopes 与 draft 授权切片**：catalog workflow 只有显式绑定到唯一 organization/project 后才可被 chat authoring 写入；跨项目/跨组织绑定被拒绝，proposed/failed/applied ChangeSet 不授予授权。Workflow draft 的 CAS revision 读取与 append 与授权检查共用同一 `SqliteTx`，world snapshot 在 Project 之后、任何 draft 读写之前建立 scope，并在遇到缺授权的 pre-009 draft 时 fail closed。`MIGRATION_009_SQL` 是 001–008 之后的向前迁移。数据库 typecheck 与定向测试通过。**已知缺口：** Daemon composition 尚未持久化/创建 `workflowAuthoringScopes`，`apps/daemon/tests/persist-snapshot.test.ts` 的 authoring 恢复用例在消费者接线前失败。

修订：2026-09-12 — 用户将 D17 明确为“聊天创建工作流”的主路径。T02 已实现并通过 schema 门禁的 Phase 0：AuthoringSession / Message / Turn 严格 DTO、命令 accepted 结果、create/update Proposal target 与真实 `workflowDraftId` 标识；它不提供泛用 Chat API。Application 已有受信 ChatProposal 确认 create/update WorkflowDraft 的定向切片，但尚未接入 Daemon/session 或持久 repository。当前仍只有 Desktop-local 壳与本地草稿预览：Daemon 会话持久化、受保护 prompt handoff、真实发送、Turn 生命周期、画布深链与 headed 验收均未实现，不能把新契约写成聊天可用。

修订：2026-09-12 — T05 完成 **Authoring Proposal Runtime/Mock/Daemon 切片**：Runtime SPI 唯一声明 `runtime.authoring.proposal`；Mock 可重复产出严格 `AuthoringProposal`；`LocalNodeHost` 在写入 Host Store 前以 protocol parser 清洗事件、替换 adapter 提供的摘要文本，非法对象转为 `runtime.authoring.proposal.rejected`。Daemon 只消费非 audit-only 且 Host request 标记为 `authoring:proposal` 的事件，按绑定 handle 反查 Application Run/Project；未绑定或回调失败会重放。ChangeSet/Event SQLite 投影成功后才写入 `inbox_receipts` per-event consumer ACK，重放优先查询该 ACK。端到端测试确认 intent 不落事件。Codex 未实现真实/unsupported 映射，Task patch、失败/取消/重试和 Renderer send 仍未实现。

修订：2026-09-12 — T04 完成 D15 **不可变 WorkflowVersion 写入切片**：实例首次引用版本时以稳定 JSON 的 SHA-256 写入 `workflow_versions`；真实版本只允许同内容重用，后续不同图会以 conflict 拒绝，实例读回图也以版本表为准而非 instance `graph_json`。旧 M3 仅为 FK 创建的空 `{}` placeholder 可一次性提升为真实版本，不能覆盖已有真实版本。数据库 typecheck 与实体/world snapshot 定向测试 17/17 通过。Application 的 published graph 发布流程、历史 backfill/contract 与 T16 跨模块验收仍未完成。

修订：2026-09-12 — T09 完成 D02 **confirm/start 拆分的 M3 snapshot 切片**：confirm-plan 校验图后只创建 `ProjectExecutionSnapshot`、写 Project `executionSnapshotId` 并进入 `ready`；不创建 WorkflowInstance、Node 或 Task。`:start` 从该 snapshot 的 canonical graph 创建唯一实例并实例化节点/任务。SQLite/world/Daemon 已先持久化 canonical graph，再持久化 snapshot，重启以 SQLite 图源恢复。Application typecheck、M3 定向 8/8（authoring 3 + m3-path 5）、Database/Daemon typecheck、world snapshot 11/11、Daemon sidecar 8/8 与 Daemon HTTP confirm/start 场景通过。当前 snapshot 的 policy 为显式空 M3 事实、图仍由现有 confirm 输入提供；已发布 catalog 图源、真实 policy snapshot、历史 backfill/contract 和 T16 upgrade 仍未完成。**已知缺口：** `packages/database/src/execution-snapshots.test.ts` 的 fixture 以非 placeholder 的 `sha256:w` + `{}` 写入版本，新的已发布图读取会拒绝它，该用例在 fixture 或兼容路径更新前失败。

修订：2026-09-12 — Test-bot headed 真窗口对 PR #34 head `06e6b659` 的 T19（自定义 Team 写 UI / 草稿 persist）与 T21（项目详情 `orchestrationMode` + start）记 **PASS**。报告路径 `/workspace/qa-issues/WORKFORCE-PR34-06e6b659-T19-T21-TRUEWINDOW.md`（Test-bot workspace，未必入库）。#34 已 squash 进本 `dev` tip `ae0f4e6`。**不**宣称 M7/M8 完成，**不**宣称 T20 Agent/send；`CHAT_SESSION_PROTOCOL_FROZEN` 仍为 false。T18 画布 headed 仍未在本 tip 复验。

修订：2026-09-12 — T04 完成 D18 的**运行快照 SQLite 投影切片**：新增可空 `007_runtime_profile_transport_expand`；完整 `RunExecutionSnapshot` 由 `@workforce/protocol` 严格解析后，在普通、幂等和 world snapshot Run 写入口原子写入四轴，并能跨 reopen 读回；部分列、替换和 `null` 等伪值 fail closed，旧 M3 Run 仍为四轴全 `NULL`。Windows 实跑数据库定向 30/30、数据库/Application/Daemon/Desktop typecheck 与桌面 smoke 5/5 均通过，独立审查通过。**不**宣称生产编排已构造并传入该快照、D18 direct 调度、backfill/switch/contract、D02 confirm/start 拆分或 M8 完成。

修订：2026-09-12 — T04 增加 **008 execution-axis migration audit**：只读分类所有历史 `runs`，向独立、无 Run FK 的 append-only ledger 写入 `already_canonical` / `repair_required` / `quarantined` 观察记录。账本只保留字段存在性和 SHA-256 摘要；即使历史 DB 列或外部 evidence 含未知值、路径或 secret，均不复制原文。外部 evidence 一律仍为 `repair_required`，不能生成 `eligible`；quarantine 保持隔离，旧 source 重现也不会静默提升。定向数据库测试 29/29、数据库 typecheck 和独立审查通过。**不**写 Run、不创建 ProjectExecutionSnapshot，故这不是 backfill、switch 或 contract。

修订：2026-09-12 — T04 完成 SQLite/world **projection reconciliation** 的写入侧切片：`dualWriteSqlite()` 的原始约束错误和 CAS `revision_conflict` 均向调用方传播；`world.json` / host sidecar 只在 SQLite 事务提交后发布，因此失败投影不会使新的 sidecar 超前。定向测试覆盖 raw constraint、CAS 与取消写入失败后的 sidecar，Daemon typecheck 通过。旧版本已留下的 sidecar 不做自动修复；完整 backfill/switch/contract 和 T16 故障注入恢复验收仍未完成。

修订：2026-09-12 — T02 完成 V0.1 **JSON Schema 生成与漂移门禁**：显式 Zod registry 生成 14 个已发布 `docs/protocols/v0.1/*.schema.json`；`pnpm protocol:schema:generate` 更新生成物，`pnpm protocol:schema:check` 拒绝缺失、额外或漂移文件。JSON Schema 只表达跨语言结构；`superRefine` 等运行时不变量继续由 protocol fixture/tests 负责。协议 typecheck、53 项协议测试、生成/check 与文档检查通过；OpenAPI 和未登记的新协议面仍未实现。

修订：2026-09-12 — T09 完成 **task dependency normalized projection**：世界快照在所有 Task 行已写入后，同一 SQLite 事务同步 `task_dependencies`；普通 `dependsOn` 映射为 `required_status`，旧边会被替换，节点在 snapshot 中乱序也不会触发 FK 失败。定向数据库测试覆盖乱序依赖与移除旧边，数据库 typecheck 通过。当前 confirm-plan 仍使用现有执行图来源，D02 confirm/start 拆分、已发布 canonical graph 作为唯一来源、条件/失败/取消路由语义和 T16 跨模块验收仍未完成。

修订：2026-09-12 — T11 完成 TypeScript Daemon 源码入口的 Node 版本 preflight：仅源码入口在 Node <22.7 时拒绝 spawn 并说明要求；已有可重连 Daemon 与分发 JS 入口不受影响。曾尝试以 Desktop-owned stderr pipe 报告启动错误，独立审查证实关闭父端 pipe 会让 detached Daemon 后续 stderr 写入 EPIPE 并可能退出，故已完整撤回；Daemon 崩溃、端口冲突、结构化 sidecar/状态诊断、诊断导出和三平台真机证据仍是 `T11-DAEMON-CRASH-OBSERVABILITY` 的 planned 工作。

修订：2026-09-12 — T08 受管测试命令的审计确认：现有 `ProcessController.inspect()` 只报告存活与 identity，规范 `spawnCaptured().wait()` 才返回 exit/signal，而 captured process 当前在 Windows 明确 fail closed。故不能在 `packages/artifacts` 私自扩展 `inspect()` 并以 fake exit code 宣称测试失败已阻断；已登记 `T06-PROCESS-TERMINAL-OUTCOME`，由 T02/T06 先提供跨平台终态 Process 契约，T08 再消费。T08 的 Evaluation/retention/M5 仍 planned。

修订：2026-09-12 — T06/T02 审计确认现有 `CapturedProcess.wait()` 仅返回根进程 close，不能证明受管树收敛。独立契约审查已冻结：底层只提供原生 root `{ exitCode, signal }`，或以稳定 `ProcessControllerError` 表示树收敛、output 或取消无法可信得出；timeout/cancel/output 策略归因是 Application/Workflow 的业务事实，不进入 exit result。`wait()` 只在 root exit、output EOF 和受管树收敛均验证后 resolve；`inspect()` 继续只表示 liveness/identity，Windows Job capture 不可用时必须 fail closed。T06 尚未实现实际树收敛，T08/T15 尚未迁移消费者，Windows capture 仍 unsupported。

修订：2026-09-12 — 把 main 隔夜剩余缺口迁到本 `dev` tip（`122600d` 之上）：T19 自定义 Team 写 UI + `GET /teams?status=draft` / `GET /teams/{id}` 草稿 reload；T21 项目详情挂载 orchestrationMode 控件；composed `startProject` → `app.start` / Run / host 记录回传 `orchestrationMode`（**不**写入 `StartRunRequest`）；#20 Placement 文档（本机默认，远程/容器为一等产品能力，实现未完成）。**不**宣称 M7/M8 完成、headed PASS、`direct` 调度或生产 Codex direct。

修订：2026-09-12 — 从 main #31（`43f281e4`）把 Desktop-local authoring session store + 仅用户 append + renderer `localStorage` 快照迁到本 `dev` tip。`CHAT_SESSION_PROTOCOL_FROZEN` **仍为 false**；无 Agent/send、无 chat HTTP。**不**宣称 M7 完成，也**不**照搬 #30/#31 在 main 上的 headed PASS。其余 T18/T19/T21 边界不变。

修订：2026-09-12 — `task/port-main-m7-t18-t21` 把 main 上的 M7 catalog 写 API / 画布 + 草稿写路径 / 作者壳 / `:start` orchestrationMode 回显迁到 `dev` 契约上。本文件只记**本分支实有代码**，禁止再写「都还没有代码」。**不**宣称 M7/M8 完成、headed Electron PASS、编排 Agent / chat send、`direct` 调度、Codex direct，或未发布图可被 Runtime 执行。`orchestrationMode` 公共权威仍是 `packages/protocol/src/execution.ts`（C5–C9）；`StartRunRequest` 不加该字段。catalog 表是 `006_catalog_definitions`，不改 `005`。相对 main 隔夜：未迁 #20 placements 文档深度、#21 完整 T19 写 UI、#28 composed passthrough 测试深度。#31 session store 另见同日后续修订。

修订：2026-09-11 — 桌面 IPC allowlist 补上只读 `GET /workflows` / `{id}` / `{id}/versions/{versionId}`（Daemon composition 早已返回已发布模板；headed 真窗口读失败是 Electron 代理拒路，不是 Fake-only）。不宣称 headed Electron / live Codex 已在 CI 复验。同日规划冻结 D17 对话生成工作流、D18 双执行模式与[产品沟通历史](communication-history.md)；当时这些 UI/API **尚未实现**。#16 `dependsOn` + `LocalArtifactStore`、#17 画布/自定义 Team 决策文档、#18 IPC 目录放行的已验证结论仍有效。

修订：2026-09-11（本轮，基线 `fdce1b2` + 未提交修复）— 发现并修复 daemon 持久化回归：`dumpWorld` / `dualWriteSqlite` / `loadComposition` / `hydrateWorld` 都没有传递 `world.executionSnapshots`，于是 `SqliteWorldSnapshot.save()` 在 `for..of` 处解引用 `undefined` 抛错，`persist()` 又把该失败静默 `catch` 掉。修复后该字段全链贯通、旧 `world.json` 缺字段回退 `[]`，且投影失败不再静默：实体 repository 已把 2067/1555 映射为 `PersistenceError("conflict")` 并向上抛，真正的静默点是 `persist()` 的 fire-and-forget `catch`（本轮已改为 `console.error`）；`dualWriteSqlite` 外层 `isConstraintError` 分支现已改为上报而不是丢弃，但它只覆盖未被 repository 包装的原始约束错误（实体的 insert / upsert 路径不会走到；`node_instances.update`、`runs.updateStatus` 与 `receipts.putPending` 仍可到达），见 §3「持久化回归修复切片」。本轮另外修掉 `SqliteWorldSnapshot.save()` 的插入顺序缺陷：`project_execution_snapshots` 对 projects / workflow_versions / team_versions 有外键，原实现先插 snapshot 再插父表，任何非空 snapshot 都会 `FOREIGN KEY constraint failed` 并回滚整个事务；现改为在 project / workflow 循环之后插入，并加了回归测试（`packages/database/src/world-snapshot.test.ts`）。证据见 §3「持久化回归修复切片」：基线 `fdce1b2` 上 `apps/daemon/tests/composition.test.ts` 的真实断言失败 `expected 500 to be 202` 已消失，该文件只剩 Windows `fs.rmSync` 拆除期的 EPERM。本轮**不**宣称 D02 confirm/start 拆分、D15 `workflow_versions` 不可变、D17 对话生成或 D18 双执行模式已实现；T04 仍只完成 005 expand。

修订：2026-09-11（UI 设计系统对齐）— renderer 视觉层改为对齐 AgentHub 的设计基线：`packages/ui/src/tokens.ts` 重建为语义 token（四档字号、8/12/16 圆角、浅/深主题、5 主题色、8 浅色画布、Agent 色槽）并生成 CSS 变量，新增 `packages/ui/src/theme.ts` 与 `apps/desktop/src/renderer/app/theme.tsx` 承载主题偏好的读取、持久化与首屏落地；`renderer/styles.css` 与 `renderer/components/` 提供语义 class 层与基础组件，T12/T13 页面改为只组合这些组件，当时删除了 `features/projects/ui.ts` 与 `_t13_client.ts` 中的 inline 样式层。2026-09-12 部分移植为接 T18/T20 画布与作者壳，**重新引入** `features/projects/ui.ts`（仅这些页使用 inline style）。设计系统页与画布/作者面两套皮肤并存，不是「ui.ts 已删除」。未新增运行依赖（无 Tailwind / Radix / CVA / lucide-react）。权威文档见 [UI 设计系统](../product-ui/04-design-system.md)。本修订**不**声称 M7/M8 已实现。

修订：2026-09-11（桌面 Daemon 源码启动修复）— 修掉「用脚本启动程序后提示无法安全连接 / `Daemon state file was not replaced after spawn.`」的根因：`apps/desktop/src/main/smoke-env.ts` 给 TypeScript Daemon 入口加的是 `--experimental-strip-types`，而 strip-only 模式不支持参数属性，Daemon 在 import 阶段就崩溃、从不写 `daemon.json`。现改为 `--experimental-transform-types`（Node ≥ 22.7），新增真实启动回归测试 `apps/desktop/tests/daemon-source-launch.test.ts`，并修正 §6 中「Daemon 单独」命令（原命令同时缺 `--import` 与正确的类型 flag，实测无法启动）。未改协议、状态机、公共 DTO 或 `supervisor` 的 `stdio: "ignore"`。

## 1. 本轮目标与结果

目标：跑通 **M3 Mock 完整流程**（规划文档 §5），并行补齐 Daemon 真实用例、Electron/React 壳与 P0 页面。产品主对象是 **Project（项目制）**：M3 用预设 Team + 只读工作流目录走完一个项目闭环。画布、自定义 Team 与对话生成是该循环上的 **M7** 编排面；按 Agent 双执行模式是 **M8**。都不是外挂功能。

**HTTP Mock 闭环已通过（headless）。** 桌面项目页有 happy-dom 点击 driver（默认 `pnpm test`）；这不是真实 Electron 窗口。真窗口人工点击仍需要。Codex **未**做 live `exec`。

M7/M8 是 V0.1 release gate，**不是**当前 M3 通过条件，也**尚未完成**。2026-09-12 起仓库里**已有**部分 M7/M8 切片代码（见 T18–T21），不得再写「都还没有代码」。M7 完成仍需 T20 的安全 prompt handoff、typed send/结果读取与 Agent 生成 draft，Task patch/失败恢复、自定义 Team 发布/绑定闭环；T19 写 UI headed 已 PASS，不等于 M7 完成。M8 完成仍需 `direct` 调度，以及生产编排构造并传入运行快照。T21 项目详情 start headed 已 PASS，不等于 M8 完成。D17/D18 前置：T02 已冻结执行三轴（`packages/protocol/src/execution.ts`），T04 已落地 `005_execution_axes_expand`、**`006_catalog_definitions`**（catalog_workflows / catalog_teams 四表）、运行快照投影用的可空 **`007_runtime_profile_transport_expand`** 与只读分类用 **`008_execution_axis_migration_audit`**，S2a 已落地 `SqliteProjectExecutionSnapshotRepository`（insert-once）。**仍未实现**：backfill / switch / contract、生产 Run 快照组装与接线、T16 current-M3 upgrade fixture。

## 2. 任务状态（对照实现，不是旧清单）

| ID | 状态 | 证据 |
|---|---|---|
| T00 | 完成（项目制 + M7/M8 决策已补写） | M0–M3 冻结仍有效；§0 项目制；D15–D18 已登记。M7/M8 **未完成**；切片进度见 T18–T21，不以本行代替 03 各卡 |
| T01 | 完成 | pnpm + turbo monorepo；本轮补了 Electron/React/Vite lockfile |
| T02 | 完成（M3 字段 + 图/Authoring 契约 + V0.1 Schema 门禁） | `packages/protocol` 公开 `TaskDto` / `task.schema.json`；`dependsOn` 是公开契约（`GET /tasks`、`GET /tasks/{id}`、typed client 再导出），不是内部-only `TaskRecord`。`WorkflowGraphDefinition` 是严格有限 DAG，`WorkflowDraft` / `TeamDraft` / `AuthoringProposal` / `AuthoringChangeSet` 为唯一公开作者契约；显式 Zod registry 生成当前 14 个公开 JSON Schema，`protocol:schema:check` 阻止漂移。Application 的 authoring use case、持久化与 Daemon 接线仍不由本行宣称完成；OpenAPI 和未登记协议面仍未实现 |
| T03 | 完成（Windows 证据） | `docs/spikes/*`；新增 Remote Node Mock 兼容性测试证明现有 Host 可在不改 Domain/Task/Event schema 下绑定 synthetic remote node，并在 replacement 后隔离旧 binding 的写入和迟到事件；它不是网络远程 runner。macOS/Linux 未测 |
| T04 | M3 持久化完成；D17/D18 为 expand + Run 快照投影 + 审计分类 + 写入侧对账 + D15 不可变版本 + authoring repository 切片 | migration **001–008** + entity repos；重启以 SQLite 实体表为准。`005_execution_axes_expand` 未改号（drafts / change_sets / snapshots + 可空轴列）；`006_catalog_definitions` 为 catalog 四表；`007_runtime_profile_transport_expand` 新增可空、受约束的 profile transport；`008_execution_axis_migration_audit` 是无 Run FK、只存摘要的 append-only 历史分类账本，**不会**回填或提升记录。真实 `workflow_versions` 使用稳定 JSON SHA-256 insert-once，实例从版本读图；仅旧空 FK placeholder 可一次升级。workflow/team 草稿 append-only revision CAS；ChangeSet 与 steps 同事务持久化、验证 source Run 的 Project/organization 归属，并以 status CAS 推进。新 sidecar 仅在 SQLite commit 后发布，raw constraint/CAS conflict fail-fast；旧 sidecar 不自动修复。数据库 Run repository / world snapshot 能严格校验、原子读写、跨重启读回完整执行快照；旧 Run 保持全空轴。**无** backfill / switch / contract，生产编排尚未构造该快照 |
| T05 | 部分：Runtime/Mock/Daemon Proposal 输出链已实现 | `runtime.authoring.proposal` 是唯一结构化输出；Mock fixture、Host 入库前 parser 清洗/摘要替换、audit-only 与非 Authoring Run 拒绝、composition 从 handle 反查 Run/Project 后调用 Application `recordAuthoringProposal` 均已测；未绑定/失败会重放，SQLite `inbox_receipts` 在 ChangeSet/Event 投影后写 per-event ACK。`authoring.start` 现阶段不会把 raw intent 交给 Runtime，因 `StartRunRequest` 会被 Host 持久化，故必须先完成 `T20-B-PROMPT-HANDOFF`，再实现 Renderer send；Codex 映射、Task patch、重试也未完成 |
| T06 | POSIX captured-process 终态切片已实现；Windows capture 仍 fail-closed | `CapturedProcess.wait()` 在 POSIX 上等待 root exit、stdout/stderr EOF 与已验证的受管进程组终结；output overflow、提前放弃、截断关闭、I/O、取消与不可验证树均映射 `ProcessControllerError`，不伪造 exit result。当前 Windows 环境包测通过但 POSIX 进程树用例跳过；macOS/Linux 真机与 Windows Job capture 仍未验证/未实现 |
| T07 | 完成库并接入 composition | Policy/redaction 单测通过；生产 composition 用 `decideStart` 做启动前拒绝，审批 create/consume 用 `createCanonicalAction` digest；`GrantStore` 为 `SqliteGrantStore`（`policy_grants`），进程内 `InMemoryGrantStore` 仅测试默认 |
| T08 | 完成库并接入 Mock composition（本切片权威） | 所有权仍是 `packages/artifacts`（不是 Daemon 私有第二套规则）。composition 以 `LocalArtifactStore` 为 Mock 产物字节/元数据权威；公开 content 读精确 `artifactVersionId`。**不是**未开始，也**不是** world.json / `bodyBase64` 权威 |
| T09 | M3 用例 + normalized dependency + D02 snapshot/start 切片 | `m3-path.test.ts`；Daemon 已调用 `WorkforceApp`。confirm-plan 只冻结 snapshot 并进入 `ready`，`:start` 才从 snapshot graph 建实例/任务；SQLite/world restart 先恢复 canonical graph 再恢复 snapshot。`SqliteWorldSnapshot` 在所有 Task 落行后同步 `task_dependencies`，以 `required_status` 保留普通依赖并替换过时边；当前仍未切到已发布 catalog graph、没有真实 policy snapshot、direct 调度或 lease 生命周期 |
| T10 | **本轮完成 composition** | 生产 `main()` 用真实服务；`taskDto()` 填公开 `dependsOn`；Mock 产物经 `LocalArtifactStore` `register`；测试默认 Fake 仍绿 |
| T11 | **本轮完成壳；源码入口 Node preflight 已接线；设计系统收口画布/Team** | Electron + Vite + React + IPC + feature glob；2026-09-11 补齐设计系统：`packages/ui/src/tokens.ts` / `theme.ts`（四档字号、8/12/16 圆角、浅深主题、5 主题色、8 浅色画布、Agent 色槽）、`renderer/styles.css` 语义 class 层、`renderer/components/` 基础组件与图标、`renderer/app/theme.tsx` 主题提供者与首屏 `bootstrapTheme()`。2026-09-12 补 Dialog / DropdownMenu / Tooltip / Toast / Table / Skeleton；画布与 Team 写页改组合这些组件；`features/projects/ui.ts` 不再持有第二套 hex，只再导出 `--wf-*` 供作者壳 / orchestration 过渡。崩溃/端口冲突的结构化诊断、运行期诊断导出和三平台证据仍 planned。对齐 AgentHub 视觉基线，实现栈刻意不同（无 Tailwind/Radix/lucide 依赖），差异见 [UI 设计系统](../product-ui/04-design-system.md) §7 |
| T12 | **本轮完成页面** | 项目 / Task / 团队目录 / 工作流目录。Tasks 展示已发布 `dependsOn` 边。画布入口与写 API 见 T18；自定义 Team 写 UI 见 T19。项目详情按 IA §4.3，并挂 T21 执行模式控件 |
| T13 | **本轮完成页面** | 工作台 / Run / 产物 / 审批 / 节点 / 设置；运行记录已进入一级导航（仍标 P1） |
| T14 | 完成 fixture | `mockPlanFixture` 已用于 confirm-plan |
| T15 | **Process 已接线，live exec 未宣称** | detect/validate + 注入 Process 的 start/stream/cancel（fake Process + fixture 可执行文件）；本机 **没有** live `codex exec`。`authoring.proposal` 明确 unavailable：现有 Codex JSONL 无可验证的结构化 Proposal item，禁止从 agent message 推断 |
| T16 | M3 HTTP/桌面验证切片；D17/D18 upgrade fixture planned，未实现 | HTTP M3 + typed client；桌面 happy-dom（非真窗口）。current-M3 upgrade fixture 未跑。执行三轴协议已冻结；DB 有 005 expand、006 catalog 与 007 profile transport / Run 快照投影。`:start` 可回显 `orchestrationMode` 并传入 `app.start()` / Run 记录（不进 `StartRunRequest`），但尚未组装并持久化完整运行快照。无 headed PASS |
| T17 | 未开始 | 打包/签名 |
| T18 | 部分 M7 UI：画布 + 草稿写 API 已有，未完成、未 headed | 画布页 + `write-client` + catalog 写路由（`POST/PATCH /workflows`、`/versions`、`:publish`）+ IPC 写 allowlist。列表「新建画布」。happy-dom / 包测已跑。**未** headed 验收。未发布图仍不可被 Runtime 执行。皮肤用 `features/projects/ui.ts` inline，未重贴设计系统。**不**宣称 M7 完成 |
| T19 | 写 UI + 草稿 persist 已接线；headed 真窗 **PASS**；M7 未完成 | 换掉只读 `rejectCustomTeamSave()` 桩。列表/详情走 `GET /teams` + `GET /teams?status=draft` + `GET /teams/{id}`；保存走已有 `POST/PATCH /teams` 与 versions。发布按钮诚实：无假 publish/bind 成功。项目 Settings 可选手动绑定已发布自定义 TeamVersion（须服务端回传 `teamVersionId`）。headed 真窗口 **PASS**（PR #34 head `06e6b659`，报告 `/workspace/qa-issues/WORKFORCE-PR34-06e6b659-T19-T21-TRUEWINDOW.md`；已 squash 进 `dev` `ae0f4e6`）。**不**宣称 M7 完成 |
| T20 | 本地作者会话 / 草稿预览切片已实现；`CHAT_SESSION_PROTOCOL_FROZEN=false`；无 Agent/send | `workflow-authoring` 由工作流页 `?authoring=1` 挂入；可从 route query/hash 绑定真实 Project，否则明确进入 renderer-only 本地笔记/手工草稿空间。`InProcessAuthoringSessionStore` 只追加 `role=user`，快照写入 renderer `localStorage`，Ctrl+R reload 可恢复；结构化 proposal 会显示为「本地结构化预览，非 Agent 输出」。旗标为 **false**；「发送给编排 Agent」仍禁用。V0.1 **无** chat HTTP path。禁止假 Agent 成功，**不**宣称对话编排或 M7 完成。 |
| T20-B | authoring Proposal + 持久化 + staged-apply M3 切片已实现 | `authoring.start` 建受治理 Task/Run；Runtime SPI/Mock 的 Proposal 由 Daemon 从 handle 绑定反查 Run/Project 后交给 Application，生成 proposed ChangeSet，再显式转为 validating。SQLite 有 WorkflowDraft/TeamDraft append-only revision CAS 与 ChangeSet/step 原子写入、来源 Run 归属校验和状态 CAS；Application 对 Workflow/Team target 全量校验后原子应用新 Draft revision，并记录审计事件；SQLite world snapshot、Daemon dual-write 和 composition reload 可跨重启恢复。安全 prompt handoff、Task patch、部分失败恢复、Codex 映射、typed HTTP/Renderer send 仍未完成 |
| T21 | 项目详情已挂 mode 控件；composed passthrough 已加厚；headed 真窗 **PASS**；M8 未完成 | `GET /capabilities.orchestration`；`:start` 可选 `orchestrationMode`；`direct` 无 probe → 422。项目「开始执行」把控件选中的 mode 传入 `startProject`。composed `startProject` 把 mode 传入 `app.start()`，写入 ProjectRecord / RunRecord / `StartRunHostRequest` 并回显 DTO。**不**写入 protocol `StartRunRequest`，也**不**双写 `runs.orchestration_mode` 列。headed 真窗口 **PASS**（同一报告 / tip `06e6b659` / 合入 tip `ae0f4e6`）。无 Codex direct、无 `direct` 调度、**不**宣称 M8 完成 |

## 3. 实际验证

环境：历史切片多为 Linux（Node 22+，pnpm 9.4）；本轮持久化回归修复切片为 Windows（Node v24.19.0，pnpm 9.4.0）。每个代码块都注明了实际环境。

```text
pnpm lint                 # 通过（tooling/spikes 已从 ESLint 忽略，因其为实验脚本）
pnpm --filter @workforce/daemon typecheck
pnpm --filter @workforce/desktop typecheck
pnpm --filter @workforce/desktop-client typecheck
pnpm exec vitest run      # 全量 unit + integration + happy-dom 页 driver
```

Grant 持久化切片补充（Linux，2026-09-11；未重跑全量 `pnpm test` / `pnpm build`）：

```text
pnpm --filter @workforce/database typecheck
pnpm --filter @workforce/policy typecheck
pnpm --filter @workforce/daemon typecheck
pnpm exec vitest run packages/database packages/policy \
  apps/daemon/tests/grant-store.test.ts apps/daemon/tests/policy.test.ts
pnpm exec vitest run apps/daemon/tests/composition.test.ts
pnpm check:docs
```

公开 Task `dependsOn` + Artifact 权威切片（Linux，2026-09-11；代码已在同分支先前 CI 绿；本文件只同步进度，本轮只跑文档检查）：

```text
pnpm check:docs
```

持久化回归修复切片（Windows，Node v24.19.0，pnpm 9.4.0；基线 `fdce1b2` + 本轮未提交修复）：

```text
pnpm install --frozen-lockfile
  # 本 checkout 缺 workspace links，先补齐
pnpm exec vitest run packages/database packages/protocol packages/application
  # 22 files / 128 tests 通过（本轮复跑确认）
pnpm exec vitest run apps/daemon/tests
  # 8 个文件中 7 个通过；35 passed，4 failed（唯一失败文件 composition.test.ts，全部是 Windows 上 fs.rmSync 拆除期的 EPERM；本轮复跑确认）
pnpm --filter @workforce/database typecheck   # 退出 0
pnpm --filter @workforce/daemon typecheck     # 退出 0
pnpm lint                                     # 退出 0
```

修复内容：`apps/daemon/src/composition/persist.ts` 的 `dumpWorld` / `dualWriteSqlite` / `loadComposition` / `hydrateWorld` 现在贯通 `executionSnapshots`，`loadSnapshot` 对缺失字段回退 `[]`；`apps/daemon/src/composition/app-services.ts` 的 `persist()` 不再静默丢弃失败，而是 `console.error` 报告（请求路径仍为 fire-and-forget；实体 repository 的 2067/1555 已在上游转为 `PersistenceError("conflict")` 向上抛，`dualWriteSqlite` 外层 `isConstraintError` 分支只对未被包装的原始约束错误生效，现已一并改为 `console.error` 上报而不是丢弃）。另修 `packages/database/src/world-snapshot.ts` 的 `save()` 插入顺序：`executionSnapshots` 改为在 projects / workflows 之后插入，避免外键失败回滚整事务；回归测试见 `packages/database/src/world-snapshot.test.ts`。**基线对照：** 未修复的 `fdce1b2` 上 `apps/daemon/tests/composition.test.ts` 有 10 条失败，含真实断言 `expected 500 to be 202`；修复后只剩上述拆除期 EPERM。**全量 `pnpm exec vitest run`（本轮实跑多次）：** 提高 `vitest.config.ts` 的 `testTimeout`（默认 5000ms → 30s）前为 465 passed / 8 failed 与 466 passed / 7 failed，且失败集合每次不同（均为真实 I/O 集成用例在并行负载下 `Test timed out in 5000ms`）；提高后为 **472 passed / 4 failed**。剩余 4 条全部是 `apps/daemon/tests/composition.test.ts` 的 Windows 拆除期 `fs.rmSync` EPERM：被锁的是 `workforce.sqlite` / `-wal` / `-shm` 与 `repo` 目录，由本测试进程持有（断言已全部通过；重试 1s 无效；进程退出后同一目录可正常删除）。属既有、仅 Windows、待跟进，不影响 Linux CI。**随本轮一并修掉的其它缺陷：** `packages/database/src/execution-snapshots.ts` 的 `PersistenceError("validation_failed")` 不是合法 `PersistenceErrorCode`（自 `fdce1b2` 起 `packages/database` 无法 typecheck）；`execution-snapshots.test.ts` 5 条用例缺少 `await`，断言实际未生效；`persistence.test.ts` 的 `003` 迁移列表未随 `005` 更新。**本轮未运行：** `pnpm build`、headed Electron、live `codex exec`。**本轮一并修掉的测试/CI 缺陷：** `apps/desktop/tests/composition.test.ts` 的 Windows 路径分隔符断言（改用 `path.join`）、`runtimes/codex/src/adapter.test.ts` 依赖宿主平台的用例（显式传 `platform: "linux"`）、`.github/workflows/pull-request.yml` 的 `push` 触发分支（`main` → `dev`，`main` 已重命名）。另：`docs/planning/03-implementation-status.md` 记录的全量测试数字已随之更新。

关键场景：

1. **Daemon HTTP M3**（`apps/daemon/tests/composition.test.ts`）  
   创建项目 → 绑定 workspace 授权引用 → `:start-planning`（空 body，内部填 Mock 预设）→ `:confirm-plan`（冻结 fixture：`dev_alpha` / `dev_bravo` / `review_integration`）→ `:start` → Mock 运行完成并绑定产物 → artifact 审批 consumed。  
   `GET /tasks` 返回公开 `dependsOn`：`dev_alpha` / `dev_bravo` 为 `[]`，`review_integration` 依赖二者且 `waitFor` 为 `outputs_ready`（`composition.test.ts`、`tests/integration/m3-mock-client.test.ts`）。公开 DTO 只接受 `outputs_ready` 或 `completed`；映射把非 `completed` 的上游写成 `outputs_ready`（本轮未改此行为）。  
   同 `stateDir` 重启后项目仍在；重放同一 `operationId` **不**新增 Run。  
   删除 `world.json` 后预算/reservation/usage key 仍从 SQLite 恢复；硬货币上限仍为 `422 unknown_cost_not_enforceable`。  
   删除 `world.json` 后未消费 Policy grant 仍可 `decide` 一次；已消费 grant 重启后仍为 `grant_consumed`，不能再消费。`credential.copy_env` 即使有 grant 行仍 deny。  
   删除 `world.json` 后公开 Task `dependsOn` 仍在；`GET /artifacts/{id}/versions/{versionId}/content` 仍从 `LocalArtifactStore` 读出与删除前相同的 git_diff 字节。dump 中的 `artifactContents` **不**带 `bodyBase64`。  
   Mock pause → `422 unsupported_capability`。  
   硬货币上限 → `InMemoryPolicyEngine.decideStart` → `422 unknown_cost_not_enforceable`。  
   计划审批 `actionDigest` 为 `plan.apply` 规范化 digest；digest 不一致的 confirm/approve → `409 conflict`。

2. **Typed client**（`tests/integration/m3-mock-client.test.ts`）  
   `DesktopClient` + loopback 走同一条路径，重放 `:start` 不复制 Run。  
   `listTasks` / `getTask` 的公开 `TaskDto.dependsOn` 与 HTTP 一致（review → alpha/bravo，`outputs_ready`），不是内部 DAG 私有字段。  
   `tests` 现为 workspace package（`@workforce/tests`），integration / 后续 sibling 通过 `@workforce/*` 公共导出导入，不再用相对路径或 eslint 豁免。

3. **既有 Fake HTTP 契约**（`apps/daemon/tests/commands.test.ts` 等）仍通过。`startDaemon` 在未注入 `services` 时仍用 `FakeAppServices`；生产 `apps/daemon/src/index.ts` 使用 `createComposedAppServices`。

4. **桌面**  
   `apps/desktop` unit tests 覆盖 IPC 白名单、hash 路由、feature glob、SSE 解析、页面 view-model（412 保留表单、取消中、未知成本非 0、pause 隐藏）。  
   **项目详情标签：** 对照修订后的 IA §4.3.1–§4.3.4：页头保留项目命令与只读摘要；六标签为 概览 / Tasks / Runs / Artifacts / Activity / Settings。WorkspaceBinding 写入只在 Settings（`project-bind-workspace`）；概览只有进度计数（DAG 边在 Tasks 标签，不在概览）。Tasks / Runs / Artifacts / Activity 复用 `listTasks` / `listRuns` / `listArtifacts` / `listEvents`。composed API 的公开 Task DTO **始终**带 `dependsOn`；Tasks 展示真实依赖边（无依赖写「依赖：无」）。「依赖：未返回」只是旧客户端/夹具缺字段时的 UI 回退，不表示现行协议仍是内部-only。深链 `#/projects/:id?tab=` 由项目页读取（壳路由仍只解析 path）。  
   **Headless page driver：** `apps/desktop/tests/main-path.smoke.test.ts` 在 happy-dom 里点项目页，对 composed Mock daemon 走创建 → Settings 绑定工作区（测试 preload 假 picker）→ 页头开始规划 → 确认计划 → 开始执行 → Tasks 核对 `dev_alpha` / `dev_bravo` 及依赖文案（`outputs_ready` 或「依赖：无」）。这是 DOM driver，不是真窗口。默认 `pnpm test` 会跑。  
   **Electron helper（默认关闭）：** `pnpm --filter @workforce/desktop smoke` 才拉起 Vite + Electron，用 `executeJavaScript` 点同一组 test id。`WORKFORCE_DESKTOP_SMOKE` 未设时**不会**跳过原生目录对话框。该命令不能代替真人在真窗口里点（对话框、SSE / Run 控制台、视觉）。默认 `pnpm test` **跳过** Electron 用例。  
   **T19 / T21 headed 真窗：** Test-bot 对 PR #34 head `06e6b659` **PASS**（`/workspace/qa-issues/WORKFORCE-PR34-06e6b659-T19-T21-TRUEWINDOW.md`：自定义 Team 写 UI / 草稿 persist；项目详情 `orchestrationMode` + start）。#34 已 squash 进 `dev` `ae0f4e6`。只覆盖这两张卡，不是完整 headed 套件，也不是 T18 画布或 T20 Agent/send。

5. **工作流只读目录**（`apps/daemon/tests/workflows-catalog.test.ts` + typed client + Desktop IPC allowlist + `apps/desktop/tests/workflows-catalog-proxy.test.ts`）  
   生产 `createComposedAppServices` 与 Fake 都实现 `listWorkflows` / `getWorkflow` / `getWorkflowVersion`，并返回已发布 `software-development-team.feature-delivery`（不是空种子）。Daemon 路由已注册。headed 真窗口曾读失败，是因为 Desktop `API_ROUTE_TEMPLATES` 放行了 teams/nodes/runtimes，却漏了这三条只读路径，IPC 代理在到达 loopback 前抛 allowlist 错误；页面因此进「无法读取 GET /workflows」，不是空目录。现已放行三条 GET。2026-09-12 起 IPC 另放行 catalog **写** path（`POST/PATCH /workflows`、`/versions`、`:publish` 及对应 teams）。只读目录仍必须列出已发布 `software-development-team.feature-delivery`；桌面页走 `listWorkflows` 渲染 `workflow-row-*`，空目录用 `workflow-empty`，读失败用 `workflow-error`，不回退夹具。写接口接通 **不等于** 画布 headed 可用，也不表示 Mock/Codex Runtime 可执行未发布定义；本切片**未**宣称 headed Electron 已复验。

6. **Codex**  
   `runtimes/codex`：PATH/配置探测、能力描述（pause / event.resume = unsupported）。  
   `start/stream/cancel` 走注入的 captured Process：CLI + validate + `resolveStart` 齐备时 `spawnCaptured`；缺 CLI 为 `validation_failed`；缺 Process/`resolveStart`/不完整 context/win32 capture 为 `unsupported_capability`。  
   证据（2026-09-11，Linux，Node v22.14.0，pnpm 9.4.0）：  
   `pnpm --filter @workforce/runtime-codex typecheck` 退出 0；  
   `pnpm --filter @workforce/daemon typecheck` 退出 0；  
   `pnpm exec vitest run runtimes/codex apps/daemon/tests/codex-composition.test.ts` → 6 files / 34 tests 通过（含 fake Process 与 `OsProcessController` + `fixtures/jsonl-double.mjs`，**不是** Codex CLI）。  
   本机 Linux **没有**授权 live `codex exec`；未宣称真实 Runtime 可执行。Daemon Host 仍默认 Mock。

7. **UI 设计系统（T11 共享层）**
   `packages/ui/src/tokens.ts` 以 AgentHub 的语义角色重建 token 真源（四档字号 display/title/body/meta、8/12/16 圆角 + 22% 标记、4/8/12/16/24/32 间距、浅/深主题、5 主题色、8 浅色画布、Agent 色槽），由 `tokensAsCssVariables()` 生成 CSS 变量；`packages/ui/src/theme.ts` 提供 `light`/`dark`/`system`、accent、canvas 的读取/写入/落地并拒绝未知取值。`apps/desktop/src/renderer/styles.css` 提供语义 class 层，`renderer/components/` 提供 `Page`/`Card`/`Button`/`Badge`/`Input`/`Tabs`/`List`/`Notice`/`EmptyState` 以及 Dialog / DropdownMenu / Tooltip / Toast / Table / Skeleton 与内联 SVG 图标，`renderer/app/theme.tsx` 在 React 挂载前同步落地主题避免闪色，设置页新增「外观」卡片（主题三档 + 主题色 + 浅色画布，深色下画布控件禁用并说明原因）。T12/T13 页面、T18 画布与 T19 Team 写页只组合这些组件。`features/projects/ui.ts` 是作者壳 / orchestration 的兼容再导出，只引用 `--wf-*`，不再带第二套 hex。**不新增运行依赖**。**未改** `features/workflow-authoring/**` 与 `features/orchestration/**` 的页面文件。详见 [UI 设计系统](../product-ui/04-design-system.md)。

8. **桌面 Daemon 源码启动与启动期诊断（T11）**
   `start.cmd` / `pnpm --filter @workforce/desktop dev` 此前连不上 Daemon：`apps/daemon/dist/index.js` 不存在时 supervisor 会回退到源码入口，而 `apps/desktop/src/main/smoke-env.ts` 给 `.ts` 入口加的是 `--experimental-strip-types`（只删类型）。Daemon 依赖图用了参数属性（`apps/daemon/src/modules/errors.ts`、`apps/daemon/src/composition/{persist,policy}.ts`、`packages/database/*` 等），strip-only 模式直接抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，Daemon 在 `startDaemon()` 之前就退出，从不写 `daemon.json`；supervisor 等满 8s 后返回 state-file 错误，UI 按 `packages/ui/src/banners.ts` 渲染成「无法安全连接」。现改为 `--experimental-transform-types`（完整类型转换，需 Node ≥ 22.7），并新增真实启动回归测试 `apps/desktop/tests/daemon-source-launch.test.ts`；Supervisor 在源码入口且 Node <22.7 时还会在 spawn 前给出版本要求。曾实现短时 stderr pipe 的错误摘要，但独立审查证明父端关闭 pipe 后，成功的 detached Daemon 继续写 stderr 会得到 EPIPE 并可能退出，因此该实现已完整撤回，`stdio` 恢复 `ignore`。证据（Windows，Node v24.19.0，pnpm 9.4.0）：`pnpm exec vitest run apps/desktop/tests/smoke-env.test.ts apps/desktop/tests/supervisor.test.ts apps/desktop/tests/app-lifecycle.test.ts apps/desktop/tests/daemon-source-launch.test.ts apps/desktop/tests/smoke-script.test.ts` → 5 files / 23 tests 通过；`pnpm --filter @workforce/desktop typecheck` 退出 0。**未跑真窗口点击**；尚未实现 Daemon 崩溃/端口冲突的结构化安全诊断、运行期日志、诊断导出或 Windows/macOS/Linux 真机完整 evidence。本切片不改变协议、状态机或公共 DTO。

## 4. M3 主路径对照

```text
创建 Project(draft)                         ✅ HTTP + 项目页
绑定 Workspace + 预设 Team + Mock + 预算     ✅ 默认填充；UI 在 Settings 选目录授权（IA §4.3.4）
Project(planning) + Plan Artifact           ✅ fixture，无真实 Planner Run
Approval(gate=plan)                         ✅ start-planning 创建，confirm 消费
发布执行图，Project(ready/running)           ✅
Developer A/B 隔离 Run + worktree           ✅ 独立 worktree + git_diff 产物
Review 消费精确版本                          ✅ integratePatches 后 artifact 审批
Approval(gate=artifact)                     ✅
导出 bundle/report                          ✅ POST /projects/{id}:export
重启不重复 Run                              ✅ SQLite 实体表权威（可删 world.json）
重启保留预算/reservation                     ✅ SQLite budgets / budget_reservations / usage_ledger
重启保留 Policy grant                        ✅ SQLite `policy_grants`（与 `approvals` 分表；不写 world.json）
公开 Task dependsOn（已发布 DAG）            ✅ GET /tasks；review → alpha/bravo，`outputs_ready`
Mock 产物权威                                ✅ LocalArtifactStore；可删 world.json，content 仍可读
```

壳导航按更正后的 [IA §2](../product-ui/01-information-architecture.md)：**P0/P1 是切片深度，一级导航全部 `primary`**。IA 工作流用户目的现为「查看、编辑和发布可复用工作流（含对话生成与画布）」。**当前代码**：只读目录仍接通；另有画布壳、catalog 写 API、自定义 Team 写 UI、作者壳、项目详情 orchestrationMode 控件与 composed passthrough（见 T18–T21）。T19/T21 headed 真窗已 **PASS**（#34 / `06e6b659` → `ae0f4e6`），不得把该 PASS 写成 M7/M8 完成、T18 画布 headed、T20 Agent/send 或 `direct` 调度。不得宣称 Mock/Codex Runtime 可执行未发布定义。远程/容器 Placement 是产品冻结，runner **未实现**。

## 5. 剩余工作

1. **Headed Electron 真窗口点击验收**：happy-dom / opt-in `executeJavaScript` helper **不能**代替人工。T19 写 UI / 草稿 persist 与 T21 项目详情 `orchestrationMode` + start 已有 headed **PASS**（#34 head `06e6b659` / 合入 `ae0f4e6`，报告 `/workspace/qa-issues/WORKFORCE-PR34-06e6b659-T19-T21-TRUEWINDOW.md`），不代替目录对话框、SSE、Run 控制台、T18 画布或 T20 作者壳。  
2. **Codex live**：Adapter 已能经 Process 启动/流式/取消；本机仍无 Codex CLI。需在已安装 CLI 的机器上跑授权 `codex exec --json`。Auth `login status`、中途 input、event-cursor resume、win32 captured spawn、Daemon 重启后 re-attach 仍未测或 unsupported。  
3. **T17** 打包。  
4. **T18 剩余**：headed 真窗扫画布保存/刷新；画布页已改组合 `components/ui.tsx`（T11 设计系统收口），未发布图仍不得被 `:start` / Runtime 执行。画布 + 写 API **不等于** M7 完成。
5. **T19 剩余**：写 UI + 草稿 persist 已在本 tip。headed 真窗 **PASS**（`06e6b659` / `ae0f4e6`，同上报告）。发布/绑定不得假成功；未发布草稿仍不可开始规划。不等于 M7 完成。  
6. **T20/T20-B 剩余**：本地 session store / 用户 append / `localStorage`、真实 Project 标识和非 Agent proposal 预览已在本 tip。`CHAT_SESSION_PROTOCOL_FROZEN` 仍为 false；受治理 Task/Run、Host 绑定的 Proposal 回调消费、Workflow/Team Draft staged apply、SQLite repository 与 Daemon restart persistence 已具备。仍无安全 prompt handoff、typed send/结果读取、编排 Agent/Codex 映射、Task patch、部分失败恢复或 Renderer 接线。不等于对话编排完成或 M7 完成。无 headed PASS。
7. **T21 剩余**：控件已挂项目详情；composed passthrough 已把 mode 传入 `app.start()` / Run / host 记录。headed 真窗 **PASS**（同上报告）。`direct` 调度与 `runs.orchestration_mode` 列双写未做。**禁止**把 mode 写入 `StartRunRequest`。无 Codex direct。**不**宣称 M8 完成。  
8. 可写项目策略与远程节点 enrollment 仍无公开 API；远程/容器是 D19 产品冻结，runner **未实现**。UI 只读说明，未伪造已接入。  
9. Policy grant 已落 `policy_grants`；未测断电/WAL 强制 fsync。审批记录与 digest 仍在 `approvals`，不要把两张表当成同一对象。  
10. T08 任务卡其余 M5 项（Evaluation / quarantine / 保留）仍未宣称完成；特别是命令 criterion 目前无法从跨平台受管 Process port 获得可信 exit/signal，必须先完成 `T06-PROCESS-TERMINAL-OUTCOME`，不得用 private `inspect()` 扩展或 fake adapter 伪造通过。

## 6. 如何跑

```bash
pnpm install --frozen-lockfile
pnpm test                                          # 含 happy-dom 页 driver；不启动 Electron
pnpm --filter @workforce/desktop smoke             # opt-in Electron helper；不能代替人工真窗口
WORKFORCE_DESKTOP_SMOKE_HEADED=1 pnpm --filter @workforce/desktop smoke
pnpm --filter @workforce/desktop dev               # Vite + Electron；目录对话框仍是原生的
# Daemon 单独（源码入口；--import 解析 .js→.ts，需 Node >= 22.7 的完整类型转换）：
node --import ./tooling/scripts/register-ts-esm.mjs --experimental-transform-types apps/daemon/src/index.ts --state-dir /tmp/wf-state
```

桌面 smoke 环境变量：

| 变量 | 作用 |
|---|---|
| `WORKFORCE_DESKTOP_SMOKE=1` | 才启用 Electron helper（默认关闭）。`dev`/`start` 不读此开关时行为不变 |
| `WORKFORCE_DESKTOP_SMOKE_OUT` | helper 结果 JSON（`scripts/smoke.mjs` 写入） |
| `WORKFORCE_SMOKE_WORKSPACE` | **仅当** `WORKFORCE_DESKTOP_SMOKE=1` 时跳过 `showOpenDialog` |
| `WORKFORCE_DESKTOP_SMOKE_HEADED=1` | helper 显示窗口、不加强制 headless |
| `WORKFORCE_STATE_DIR` | 隔离 daemon / Electron `userData` |
