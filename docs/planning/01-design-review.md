# V0.1 设计评审与待冻结决策

日期：2026-09-10  
范围：README、12 份蓝图、2 份 ADR、架构流程图及 3 份 Product UI 文档。  
性质：基于仓库文档的静态评审；未验证真实 Runtime 能力，未开始产品代码实现。本文建议不自动替代已接受 ADR，也不代表产品决策已获确认。

## 1. 结论

架构方向可以继续：Local-first、独立 Daemon、Worker/Runtime/Node 解耦、Task 与 Run 分层、不可变执行快照、Artifact 验收、确定性 Mock 闭环都适合作为基础。

当前材料适合启动协议冻结、工程骨架和技术实验；还不适合把所有业务模块立即交给多个 agent 各自实现。主要缺口是跨文档契约漂移、执行计划生成规则、持久化恢复的具体载体，以及验收结果如何对应最终代码。

建议按“单本机闭环 → 本机多个隔离 Run → 真实 Codex → 三平台 Alpha”逐层验收。远程节点保留协议与 Mock，不建设服务器控制面。不能为了压缩第一切片而删除 V0.1 已承诺的最终能力；阶段性交付与发布完成要分开。

配套任务：[并行开发任务清单](02-development-task-backlog.md)。

## 2. 分级

- **B0：共享实现前必须冻结。** 不解决会让不同 agent 写出不兼容接口或状态逻辑。
- **B1：相关功能接入或发布前必须解决。** 可先用假实现推进其他模块，但不能宣称功能完成。
- **B2：文档整理或范围优化。** 不必阻塞工程骨架。

这里的等级是开发阻塞等级，不是已经存在的软件缺陷严重度。

## 3. B0 问题与建议

### R01：缺少统一的契约来源和文档优先级

证据：

- 领域模型的 Event 使用 schemaVersion / occurredAt / payload：[02 §4.10](../blueprint/02-domain-model.md#410-event)，原文 287 行起。
- Event Model 使用 specVersion / time / dataSchema / data：[09 §2](../blueprint/09-event-model.md#2-event-envelope)，原文 24 行起。
- API 的 SSE 示例使用 eventVersion，且示例把 Run 变为 waiting_review，而 RunStatus 并没有这个值：[11 §11](../blueprint/11-api-design.md#11-sse-与-websocket)，原文 284 行；[08 §4.5](../blueprint/08-workflow-state-machine.md#45-run-状态)，原文 192 行。
- 架构 RuntimeAdapter 接收 runId、没有 reconcile；Runtime Protocol 改成 HandleRef、receipt、cursor 和 reconcile：[03 §5.4](../blueprint/03-system-architecture.md#54-runtime-adapter-host)、[07 §4](../blueprint/07-runtime-protocol.md#4-adapter-spi)。
- API 创建 Task 示例的 expectedOutputs 使用 type: code_change，Task Protocol 使用有稳定 id 的 kind；API criterion 也缺少 Task Protocol 要求的稳定 ID：[11 §12.1](../blueprint/11-api-design.md#121-创建-task)、[05 §9–10](../blueprint/05-task-protocol.md#9-expected-outputs)。

风险：文档中的概览类型、传输 DTO、数据库列名可能有意不同，但目前没有明确映射，agent 会各自选择一套“正确”类型。

建议：T00 声明权威来源；T02 建立一个可执行 Schema 来源，生成 JSON Schema、DTO 和 OpenAPI。明确领域实体与传输类型的映射。示例分为“可校验完整 fixture”与“概念节选”；前者必须进入验证，后者不得充当实现契约。修正 SSE 事件为合法 Run 状态，或改为 Task 的 waiting_review 事件。

### R02：Planner 生成计划与不可变 DAG 的边界没有落定

证据：PRD 首个流程要求 Planner 拆任务；UI 要求用户确认生成计划；Workflow 启动绑定不可变版本，并明确不支持动态修改运行中的图：[01 §6](../blueprint/01-product-vision-prd.md#6-v01-目标)、[UI 核心流程 §1](../product-ui/02-core-user-flows.md#1-创建并运行项目)、[08 §2.2、§18](../blueprint/08-workflow-state-machine.md#22-workflowinstance)。

这些原则可以兼容，但缺少正式的阶段转换：Planner 自身属于哪个 Run/Workflow？计划确认前开发任务是否存在？修改计划是否增加版本？用户尚未配置 Runtime 和预算时如何执行 Planner？

建议：Project 先完成 Workspace、Runtime、权限和预算配置，进入 planning 阶段；Planner 通过普通受控 Task/Run 产出 Plan Artifact；用户确认指定版本后，原子发布/引用执行 WorkflowVersion，再启动开发 DAG。Planner 不直接修改活动执行图。计划审批与最终代码审批使用不同 gate 类型。取消或重生成计划应保留旧 Plan Artifact 和审批记录。

M3 可以先使用固定模板和 Mock Plan；V0.1 最终必须覆盖真实 Planner 生成、校验、修改、确认的过程。

### R03：Task 内容版本、并发版本及返工身份混用

证据：Task Protocol 将 revision 定义为可编辑版本；数据库用同一 revision 做状态更新乐观锁，并用 task_payloads(task_id, revision) 保存内容；Workflow 的返工同时出现“新 generation/revision”和“新 Task”措辞：[05 §3](../blueprint/05-task-protocol.md#3-标识与版本)、[10 §4.3](../blueprint/10-database-schema.md#43-workflow-与-task)、[08 §8.2](../blueprint/08-workflow-state-machine.md#82-rework)。

风险：一次 queued → running 是否导致新任务内容版本？重试引用哪个 snapshot？completed 后“新 revision”是否等于重新打开同一个终态 Task？

建议：分开 definitionRevision（内容版本）与 stateRevision（ETag/CAS）。同一未完成 Task 的技术 retry 使用相同内容快照、新 Run；质量返工明确采用一种规则。推荐等待验收期间创建新的内容版本及 generation，已 completed 的 Task 只创建 follow-up Task。attempt 在同一 Task 内单调增加；maxAttempts 按内容版本/generation 计数，maxReworkCycles 单独约束质量循环，总运行次数受 Project 硬上限约束。T00 可以选择其他模型，但必须给出完整状态矩阵与计数样例。

### R04：数据库规格没有完整承接“可恢复执行”的承诺

证据：[08 §13–15](../blueprint/08-workflow-state-machine.md#13-checkpoint) 要求 NodeInstance、Timer、Retry schedule、Checkpoint；[07 §8、§11](../blueprint/07-runtime-protocol.md#8-runtime-handle) 要求持久化 Handle 和恢复游标。现有 [10 §4–7](../blueprint/10-database-schema.md#4-核心表) 没有给出这些对象的完整表或明确 JSON 存储方案，也未落定 API 命令收据、Artifact output binding、审批 revision、Artifact 生命周期等字段。

这是详细设计缺口，不代表必须为每个对象都新增一张表。

建议：T02 先冻结 repository/UoW ports，T04 提交“状态/记录 → 存储位置 → 唯一约束 → 恢复入口”矩阵。至少覆盖：node instance generation、持久计时器、runtime handle、start command、idempotency receipt、pending approval action digest、output binding、Artifact staging/状态、usage 去重及资源占用。

业务状态、Event、Outbox 必须同事务；外部 spawn/文件写入不得夹在长数据库事务中。分别测试“命令提交后未启动”“进程已启动但 Handle 未提交”“Artifact 已落盘但元数据未提交”三个崩溃窗口。

### R05：短期 session 不能直接作为持久命令幂等的身份边界

证据：[11 §5](../blueprint/11-api-design.md#5-幂等与并发) 用 session + method + route + key 保存收据；[11 §7](../blueprint/11-api-design.md#7-本地认证与安全) 规定 token 短期有效并在重启等场景失效。

风险：服务端已经接受启动/审批，但 UI 没收到响应；重连新 session 后同一请求可能被视为全新命令。现有文本没有区分稳定会话身份与轮换 token。

建议：以稳定 principal/client identity + canonical operation/resource + key 作为持久作用域，token 只用于认证。先检查同 key 请求摘要及历史收据，再对首次命令检查 If-Match，避免重放被最新 revision 拒绝。明确 pending/committed/failed receipt、保留期限，以及过期后如何查询已发生操作。状态命令和 Runtime 输入都必须携带可持久化 operationId。

### R06：SSE 补拉需要独立的全库摄取游标

证据：[09 §8](../blueprint/09-event-model.md#8-orderingsequence-与时间) 只保证单 stream 顺序；[11 §11](../blueprint/11-api-design.md#11-sse-与-websocket) 用 Last-Event-ID 恢复跨 Run/Project 过滤流；数据库没有明确全局摄取 cursor。

风险：多个 stream 的 sequence 都从 1 开始；事件 ID/发生时间不能单独保证晚到事件可无遗漏补拉。

建议：保留三层序号：Runtime source cursor、聚合 stream sequence、SQLite 内单调 ingestion position。SSE 使用能解析为 ingestion position 的不透明 cursor，并绑定过滤条件；这只是本地数据库投递顺序，不是跨机器业务因果顺序。定义“资源快照 + high-water mark”的握手，避免快照查询与订阅之间漏事件。补齐重连、重复、晚到、retention 过期和慢消费者测试。

### R07：Node 补充协议与本地模型必填约束不一致

证据：ADR 0001 要求 node-aware Run；[07 §18 Node-aware](../blueprint/07-runtime-protocol.md#18-node-aware-runtime-binding) 要求本地生成唯一 `PlacementSnapshot` resolved binding；[10 末节](../blueprint/10-database-schema.md#18-execution-node-数据表补充) 允许 Run node 外键先为空。早期蓝图曾把 `remote` 放进 RuntimeDescriptor.transport；D07 已冻结为 `process | sdk | http`，位置改由 Placement 表达。

建议：新建本地 Run 即记录必需的 nodeId、runtimeInstallationId、workspaceInstanceId 或明确“分配前可空、starting 前必填”的阶段约束。移除 transport 中的 remote 含义，以 Placement 表达位置。区分 workflowNodeId 与 executionNodeId，避免 nodeId 双重含义。M3 实现单机容量与 Node ports，远程 enrollment/heartbeat/服务器 lease 只保留版本化契约和 Mock。

Lease 到期不证明旧进程已停止。fencing 只能阻止旧结果被平台接纳，不能自动阻止旧进程写外部系统。恢复不确定时不得直接重跑。取消/检查需要明确的恢复授权路径，不能因为旧 lease 过期就连安全终止和事实查询也全部拒绝。

### R08：API 目录尚不能支撑全部 P0 页面及业务命令

证据：UI 有 Team/Worker 配置、项目归档、Evaluation 展示与 Runtime 设置；[11 endpoint catalog](../blueprint/11-api-design.md#10-endpoint-catalog) 缺少相应完整查询/变更契约。Run 控制台有 take over，而 API 仅提供 Approval 的 take-over。Artifact 内容 endpoint 只有 artifactId，但 [06 §9](../blueprint/06-artifact-protocol.md#9-lineage) 和 UI 要求精确版本引用。

建议：建立“页面动作 → application command/query → DTO → 错误 → 状态前置条件”的能力矩阵。首版 Team 可以只读预设模板，项目归档可延后；不得由前端私自创建不存在的 endpoint。Artifact content/read/verify/approval/input 必须指定 version 或 ArtifactVersionId，latest 只允许用于非执行性的浏览。定义 Run takeover 与 Approval decision 的关系，以及 operation receipt 的查询/订阅方式。

### R09：“Run 成功”与“Task 验收”的契约有冲突

证据：[08 §4.5](../blueprint/08-workflow-state-machine.md#45-run-状态) 规定 Run succeeded 只代表 Runtime 成功结束；[03 §8](../blueprint/03-system-architecture.md#8-故障模型) 写 Artifact 不完整则 Run 不得成功。Task Protocol 又要求所有 required outputs 和 criterion 满足才能完成。

建议：采用清晰的三层结果：Runtime execution outcome、Run 的平台执行结果、Task acceptance verdict；必须选定 Run succeeded 的唯一定义。推荐保留现有 Workflow 语义：Run 成功终止与 Task 验收分离，Artifact 或测试失败影响 Task/Evaluation，不事后改写已终态 Run。图中 Developer 若等待 Reviewer 才 completed，而 Reviewer 又依赖 Developer completed，会形成验收死锁；用独立 Review/Gate 节点消费固定输出版本，并明确 dependency 是等待输出就绪还是等待任务最终验收。

## 4. B1 问题与建议

### R10：多个 worktree 的代码如何汇总还没有交付规则

证据：[UI 核心流程 §6](../product-ui/02-core-user-flows.md#6-git-与信息协作) 和 [Git 协作图](../diagrams/git-coordination-flow.md) 只有 Branch/Patch → Reviewer → Merge；没有规定共享基线、依赖任务代码传播、冲突处理及最终测试对象。

建议：冻结 immutable base SHA；每个 Run 独立工作区；输出包含 patch/commit、base SHA、changed paths、测试结果与内容 hash。依赖任务使用上游精确版本构建自己的工作区；并行分支在独立 integration worktree 按确定顺序整合，冲突进入人工处理。测试、Reviewer 和最终审批必须绑定整合后的同一内容 digest。

推荐 V0.1 默认交付可审查的整合分支/patch bundle 与报告，保留工作区；是否把结果合入用户目标分支作为显式动作。默认不自动 push、不开 GitHub PR。不得把“两份分别通过测试的 diff”直接宣称为“合并后项目通过”。

### R11：审批不能只保存自然语言；接管尚未形成闭环

证据：[03 §5.11](../blueprint/03-system-architecture.md#511-approval--evaluation-service) 要求冻结待审批动作；[UI 审批流程](../product-ui/02-core-user-flows.md#4-人工审批) 批准后签发 PermissionGrant；[02 §4.11](../blueprint/02-domain-model.md#411-approval) 与 [10 §7.1](../blueprint/10-database-schema.md#71-approval) 没有展开动作摘要、一次性消费及接管状态模型。

建议：Approval 绑定 action type、规范化参数 digest、resource/version、principal、policy version、expiry 与一次性消费记录。目标版本、参数或权限发生变化必须重新审批。计划确认、代码验收、命令授权、预算提高使用不同类型。

推荐接管流程为：请求停止/冻结 Agent → 确认其失去写入权 → 授予用户工作区操作 → 捕获人工变更为新 Artifact → 重新 Evaluation/审批。结果不确定时只允许诊断，不能让人工与未知活动进程同时写同一工作区。接管不是自动完成，也不是把任意 shell 接入 Renderer。

### R12：Policy 的实际执行点需要验证，不能只依赖声明

证据：架构要求控制命令/网络/路径，同时明确 Node Daemon 不是强沙箱：[03 §5.7、§9](../blueprint/03-system-architecture.md#57-policy-engine)、[07 §13](../blueprint/07-runtime-protocol.md#13-安全模型)。Codex 具体接入仍属于未冻结实验。

建议：技术 spike 为各能力记录 enforceable / observable / unsupported：文件写范围、命令审批、网络限制、凭据注入、进程树取消、续流、输入、原生 pause。每项说明 enforcement owner。Runtime 不能实施必需限制时，在启动前拒绝该组合或要求用户选择明确受限配置，不能宣称“审批一定无法绕过”。

默认使用既有本地 Runtime 身份；CredentialRef 与 Broker 保持独立。不能默认复制用户整个环境变量或认证目录。secret redaction 要覆盖跨输出分块、错误/raw payload/诊断导出；外部文本只是数据，不获得修改 Policy 的权力。

### R13：暂停、未知状态和恢复需要可显示且可持久的中间状态

证据：RunStatus 没有 cancelling/recovering/orphaned，RuntimeStatus 有 unknown/orphaned；Workflow 要求等待终止确认；UI 要求显示恢复/对账：[07 §9、§11](../blueprint/07-runtime-protocol.md#9-控制操作)、[08 §10–14](../blueprint/08-workflow-state-machine.md#10-timeout-与-deadline)。

建议：不一定新增 RunStatus 枚举，但需 operation/recovery 子状态、cancelRequestedAt、deadline 和最后可信事实。取消 API 的 202 表示接受请求，不能立即展示已取消。Daemon 重启通过 durable Handle 与进程 identity 对账；无法附着输出时明确恢复边界。Desktop 关闭后 Daemon 继续运行，多窗口/多实例、token bootstrap、版本协商和升级期间活动任务策略由 T03/T11 验证。

### R14：预算协议与实际可保证的约束没有完全对齐

证据：Task 示例用 maxCost: 5.0，[10 §7.3](../blueprint/10-database-schema.md#73-budget-与账本) 要求最小货币单位整数；[05 §15](../blueprint/05-task-protocol.md#15-budget) 已说明缺少价格时不能伪造成本，但硬预算如何处理未知/延迟 usage 没有完整规则。

建议：统一 costMinor + currency 或明确十进制定点转换，禁止各模块自行解释金额。展示区分未知、估算、已结算；未知成本不能当 0。V0.1 可保证调度前预留、最大运行时长、尝试次数、并发数和可观测 token/tool 限制；货币硬上限只对有可靠计量/执行控制的 Runtime 生效。若用户配置的硬限制无法保证，应阻止启动并说明原因。已知 usage 晚到与去重仍入账；计费结算投影可更新，冻结的执行快照与终态不回写。

## 5. B2 范围与文档整理

1. **P0 页面过宽。** 最小切片需要项目创建/详情、Run 控制台、Artifact/审批及本机诊断。AI 团队首版可展示预设版本。**后续冻结（2026-09-11）：** 自定义 Team 编排与可视化画布已升为 M7 必达（[D15](decision-register.md#d15-可视化工作流画布编辑器) / [D16](decision-register.md#d16-自定义-team-编排)），不再是「闭环之后再看要不要做」。完整节点管理、复杂仪表盘仍在闭环之后。UI 已写明 Local Node 只读，但远程 drain/revoke、多节点示意及 push 审批图应标成未来示意，避免按全部 P0 实施。
2. **旧待定项需关闭。** PRD §12 仍把是否包含云端、是否实现 Claude 作为待定；MVP/ADR 已给出本地优先与首版范围。架构仍列 HTTP/SSE 待冻结，而 API 已选 REST+SSE。把已决定事项移出 unresolved 列表。
3. **文档追加导致重号。** 05、06、07、08、10 的末尾补充有重复或跳跃章节编号；02/03 的主体模型没有吸收新 Node 字段。把补充整合进正文，保留 ADR 历史依据。
4. **目录入口过时。** docs/README 声称 adr 尚未有实际文件，但已存在两份 ADR；README 中 protocols/operations 应标明计划目录。apps/api 与 apps/control-plane 应统一长期名称。
5. **脚手架验收混入业务里程碑。** Repository Skeleton 的 DoD 包含 Mock 契约、数据库迁移和桌面连接；拆成独立任务门槛，避免工具链 agent 被迫接管业务实现。
6. **先补代码目录所需包，不建立大量空服务。** 保留单向依赖即可，不为远程服务、公共 SDK、Go/Rust、云数据库提前建设运行系统。
7. **GitHub 不是本地开发前置条件。** 可以先本地建仓与验证；远程仓库、账号、分支保护和发布在相应阶段处理。本次不创建远程仓库、不发布任务或发送消息。
8. **跨平台不是最后一周的工作。** 路径、进程、Git 的三平台 fixture 从各模块第一版开始；签名与安装升级集中到发布任务。没有真实三平台运行结果时不得宣布 V0.1 全部完成。

## 6. 推荐冻结表

以下为建议默认值，T00 应将最终选择写成 ADR/decision record；不能让不同任务各自默认。

| 决策 | 推荐默认 | 若选择不同方案，主要受影响任务 |
|---|---|---|
| 执行 Placement | 本机默认；远程与容器为一等产品能力（D19）。V0.1 只实现 Local Node；远程=契约/Mock，容器 runner 未实现 | T02、T05、T09、T10、T13 |
| 初始交付结果 | 固定基线的整合 patch/分支和报告；合回目标分支显式操作 | T06、T08、T14、T16 |
| Planner 流程 | 先受控规划，确认 Plan 版本后启动冻结执行 DAG | T02、T09、T12、T14 |
| 接管含义 | 停止写入并确认后人工编辑，再验收 | T05、T06、T09、T13 |
| 协议唯一来源 | protocol 中一个可执行 schema 源；生成 DTO/JSON Schema/OpenAPI | T02 及所有消费者 |
| 本地通信 | Main 代理 REST+SSE，Renderer 仅 typed bridge | T10、T11、T12、T13 |
| 版本 | definitionRevision 与 stateRevision 分开 | T02、T04、T09、T10 |
| 运行能力 | 以 capability probe 和受测 fixture 为准；不支持就禁用/拒绝 | T03、T05、T07、T15 |
| 预算 | 时间/次数/并发先硬约束；未知成本明确显示且不冒充可强制预算 | T02、T04、T07、T09、T13 |

有偏好时优先决定“最终代码怎样交付”“Planner 是否先确认”“接管如何结束”三项。其他常规技术细节可以按上述默认建议推进冻结，无需逐项打断用户。

## 7. 实施前退出条件

- R01–R09 均有唯一规则、字段与负责人；不得只有“稍后确认”。
- 首个 Mock fixture 从 Task → Run → Event → Artifact → Evaluation → Approval 全链路可按 Schema 解释。
- 业务状态迁移矩阵列出合法状态、失败/取消/返工路径及写入事务。
- 页面/API 能力矩阵覆盖实际首版按钮，未实现能力有明确处理方式。
- T03 的技术实验在真实 Codex 接入前完成；不因未知 Runtime 能力阻塞 Mock 与 UI 开发。
- 本文只是分析；可执行契约、技术实验与测试结果仍属于后续开发交付，尚未完成。
