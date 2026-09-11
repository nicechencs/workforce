# V0.1 开发任务清单：供后续 agent 领取

日期：2026-09-11  
状态：**实现已开始。** 本文仍是任务卡与文件所有权；进度以 [03-implementation-status.md](03-implementation-status.md) 和仓库测试为准，不要把本节旧句“均未开始代码实现”当成现状。产品主对象是 **Project（项目制）**。M7 补齐画布、自定义 Team 与对话生成；M8 补齐双执行模式。**T18–T21 代码均未实现**。  
前置阅读：[设计评审与待冻结决策](01-design-review.md)、[决策登记 §0 / D15–D19](decision-register.md)、[产品沟通历史](communication-history.md)、[MVP 原计划](../blueprint/12-mvp-implementation-plan.md)、[实现进度](03-implementation-status.md)。

## 1. 使用方式

这是一份后续开发交接清单，不是当前已经分配给 agent 的工作。任务按依赖分批领取，不建议同时开全部 agent。领取 T18–T21 时按**项目制**实现：画布、对话生成、自定义 Team 与双执行模式都围着一个项目，不是独立产品。

- 先完成 T00 的共享决策与 T01 工程骨架，再用 T02 冻结可执行契约。
- T03 的独立技术实验可以与前两项并行，不向产品目录复制未经整理的实验代码。
- 其余任务在契约稳定后可用 fake port/fixture 并行编写；“可开工”不等于“可验收合并”。
- 每个任务只能修改自己的目录。遇到公共类型缺口，提交契约变更请求，不自己复制类型或直接改邻接模块。
- 任务路径是建议目标目录，目前仓库只有文档。T01/T02 创建基础结构后，应在各任务领取前确认准确文件所有权。

## 2. 里程碑与总体依赖

| 里程碑 | 用户可验证结果 | 主要任务 |
|---|---|---|
| M0 契约基线 | 跨文档无核心冲突，Schema/状态矩阵/接口 fixture 可用 | T00、T01、T02 |
| M1 本地壳与连接 | Desktop 安全连接独立 Daemon，退出/重开可重连 | T04 基础、T10、T11 |
| M2 本地核心 | Project/Task/Run 和 Event 持久化，可查询/订阅 | T04、T05、T09、T10 |
| M3 确定性闭环 | Mock 规划/实现 → 临时 Git 工作区 → 产物 → 测试 → 审批；重启不重复执行 | T04–T14 的首切片部分、T16 |
| M4 真实编码 | 已探测能力的 Codex 在隔离仓库执行并输出固定版本 diff/报告 | T03、T06、T07、T15、T16 |
| M5 完整受控 Alpha | 真实规划、返工、接管、整合验收、预算和恢复全部走通 | T08、T09、T12–T16 完整验收 |
| M6 三平台 Alpha | Windows/macOS/Linux 安装与恢复 smoke 通过 | T17 |
| M7 补齐项目制循环 | 围着 Project：自定义 Team 可编排并绑定；Tasks 可解释；对话可生成草稿；画布可编排并发布 WorkflowVersion。未发布图/草稿 Team 不可执行、不可开始规划 | T02 扩展、T09 校验发布、T10 写 API、T18、T19、T20、T16 |
| M8 双执行模式 | 每个 Agent 可跟随已发布工作流或直接执行；capability probe 诚实显隐；无能力不得假 mode | T02 扩展、T09 调度、T10 API、T21、T16 |

M1/M2 允许交错开发。M3 必须包含最小权限与审批 gate，不能先把真实 Runtime 无约束接进来，最后才补安全。

~~~mermaid
flowchart TD
  T00[决策冻结 T00] --> T02[可执行契约 T02]
  T01[工程骨架 T01] --> T02
  T03[技术实验 T03] --> T15[Codex T15]
  T02 --> Infra[持久化 / Mock / Workspace / Policy / Artifact T04-T08]
  T02 --> Core[Workflow / API T09-T10]
  T02 --> Desktop[桌面壳 / 页面 T11-T13]
  T02 --> Template[软件开发模板 T14]
  Infra --> M3[Mock 闭环联调 T16]
  Core --> M3
  Desktop --> M3
  Template --> M3
  M3 --> Live[真实运行与治理验收 T16]
  T15 --> Live
  Live --> T17[三平台发布 T17]
  T02 --> Orchestration[画布 T18 / 自定义 Team T19 / 对话生成 T20]
  T10 --> Orchestration
  T09 --> Orchestration
  M3 --> Orchestration
  Orchestration --> M7[M7 补齐项目制循环]
  M7 --> Dual[双执行模式 T21]
  T09 --> Dual
  T10 --> Dual
  Dual --> M8[M8 双执行模式]
~~~

图表示集成依赖；精确开工条件见任务卡。所有阶段均以实际可运行证据验收，不估算固定日历日期。

## 3. 任务总表

| ID | 开发包 | 修改所有权概要 | 可开工条件 | 风险/体量 |
|---|---|---|---|---|
| T00 | 决策与蓝图一致性冻结 | blueprint、product-ui、ADR、决策矩阵 | 可立即开始 | 高影响 / 中 |
| T01 | Monorepo 与工具链 | 根配置、包 manifest、tooling 配置、基础 CI | 可立即开始 | 中 / 中 |
| T02 | Schema、Domain、公共 ports | protocol、domain、runtime-spi、公共 contracts/ports | T00 + T01 | 高影响 / 大 |
| T03 | 技术可行性实验 | tooling/spikes、docs/spikes | 可立即开始 | 高不确定性 / 中 |
| T04 | SQLite、事务、Event Store | database、events 的持久化/投递实现 | T02 | 高 / 大 |
| T05 | Mock Runtime 与 Local Node Host | runtimes/mock、runtime-sdk | T02 | 高 / 中 |
| T06 | Workspace、Git 与进程控制 | workspace、process | T02；吸收 T03 平台实验 | 高 / 大 |
| T07 | Policy、凭据与脱敏 | policy、observability | T02 | 高 / 大 |
| T08 | Artifact 与 Evaluation | artifacts | T02 | 高 / 大 |
| T09 | Workflow、调度与治理用例 | workflow-engine、application 的核心 use cases | T02 | 高 / 大 |
| T10 | Daemon API 与 typed client | apps/daemon、desktop-client | T02 | 高 / 大 |
| T11 | Electron Main / preload / UI 外壳 | desktop main/preload、renderer app/routes、ui | T02 | 高 / 中 |
| T12 | 项目、Task、团队页面 | renderer/features/projects,tasks,teams | T02 + UI 接口约定 | 中 / 中 |
| T13 | Run、Artifact、审批与诊断页面 | renderer/features/runs,artifacts,approvals,nodes,settings,dashboard | T02 + UI 接口约定 | 中 / 大 |
| T14 | 规划与软件开发交付流程 | templates、application 的 planning/delivery 用例 | T02 | 高 / 大 |
| T15 | Codex Adapter | runtimes/codex | T02 + T03 | 高 / 大 |
| T16 | 联调、恢复与端到端验证 | 根 tests，受协调的 composition 接线 | 可从 T02 写场景；验收等待依赖 | 高 / 大 |
| T17 | 打包、升级、诊断与发布 | 发布脚本、release CI、打包资源、operations | T03 后可准备；验收等待 T16 | 高 / 中 |
| T18 | 项目循环：Workflow 画布 | `renderer/features/workflows` 画布；协调 T02/T09/T10 写契约 | M3 只读目录已接通；写接口需 T02 扩展 | 高 / 大 |
| T19 | 项目循环：自定义 Team | `renderer/features/teams` 可写面；协调 TeamVersion 写契约 | T12 M3 只读完成后领取；不与 T12 同时改同一文件 | 中 / 中 |
| T20 | 项目循环：对话生成工作流 | `renderer/features/workflow-authoring`；协调会话 DTO | T18 画布入口可复用；不与 T18 同改画布文件；T02 冻结会话协议后才能宣称接通 | 高 / 中 |
| T21 | 双执行模式 | 启动字段诚实显隐 + 相关 UI；不发明未冻结 path | T02 冻结 `executionMode`（或等价）后领取；不与 T13/T19 同改同一文件 | 高 / 中 |

体量为相对复杂度，不是工时承诺。T09/T13 如需继续拆分，先按子目录/状态机所有权切开，再分配，禁止两人同时改共享控制器。

## 4. 详细任务卡

### T00 — 决策与蓝图一致性冻结

**目标：** 把 R01–R09 从分析意见变成唯一可实现规则。

**所有权：** docs/blueprint/、docs/product-ui/、docs/adr/；新增 docs/planning/decision-register.md、state-matrix.md、api-capability-matrix.md、communication-history.md。不修改后续 agent 的源码或现有评审结论以掩盖未解决问题。产品/规划变更必须回写沟通历史。

**工作：**

- 确认 V0.1 Local Node 范围及远程/容器契约边界（D19：本机默认；远程与容器为一等 Placement；enrollment / runner 未实现），吸收附加章节到主体模型。
- 冻结 Event、Task/Run、Runtime SPI、ArtifactVersion、NodeExecutionBinding、Approval、Budget 的术语与版本。
- 决定 planning → Plan Artifact → 人工确认 → 冻结执行 DAG 的流程，以及成果汇总、接管、retry/rework 语义。
- 输出完整状态矩阵：含 command、guard、next state、Event、事务边界、非法操作及中间状态。
- 输出首版页面与 endpoint 能力矩阵，标记只读、后续、不支持。
- 清理旧待定项、重复章节和过时目录说明。

**验收：** 每个 B0 有明确决策、理由、受影响字段；无两套活动契约；未决的真实 Runtime 能力转交 T03，不能用猜测当决定。用户未明确的产品偏好按评审建议记录“建议默认”，在依赖实现开工前由协调者正式选定。

**交接：** decision register、状态矩阵、能力矩阵、受影响文档清单。

### T01 — Monorepo 与工具链

**所有权：** 根 package.json / lockfile / workspace / tsconfig / lint / format / turbo 配置，tooling 配置，基础 CI，初始 package manifest。不编写业务逻辑。

**工作：** 固定工具版本、TypeScript strict、测试与构建命令、browser/Node 分离、依赖边界校验、最小 apps/packages 骨架；为 T02–T15 建立明确包入口。

新增建议目录 packages/process 用于复用进程树控制（Workspace、Evaluation、Codex 均需要），由 T00/T01 确认后采用；若不独立成包，仍必须指定唯一共享实现所有者。

**验收：** 干净 checkout 可 install --frozen-lockfile；format/lint/typecheck/test/build 正常；违规跨包/Node-only 导入可被检查发现；不靠空测试声称业务已通过。

**交接：** README 开发命令、包与目录所有权表、基础 CI 实际结果。首次骨架完成后，包源码交给各任务；新增依赖和 lockfile 继续由协调者/T01 单独处理。

### T02 — 可执行 Schema、Domain 与公共 ports

**所有权：** packages/protocol/、packages/domain/、packages/runtime-spi/、packages/application/src/ports/、packages/events/src/contracts/、docs/protocols/、packages/testkit/src/contracts/。

**输入：** T00 决策与 T01 包骨架。

**工作：**

- 统一 ID、版本、状态、错误、金额、时间、Artifact 精确版本引用和 Event envelope。
- 定义 Runtime/Node、Workspace/Process、Policy/Credential、Artifact/Evaluation、Budget、Repository/UoW、Clock/Timer、Approval、EventStore ports。
- 定义 TaskDefinitionSnapshot 与状态 CAS、StartRunRequest、全部操作 operationId、Handle 与恢复结果、SSE cursor、command receipt。
- 建立 API request/response schemas、能力矩阵所需 DTO、JSON Schema/OpenAPI 生成；内部 grants 与公开 DTO 分离，禁止宿主路径进入公开响应。
- 提供最小合法 fixture、错误 fixture、fake clock 和 contract harness 公共接口。

**验收：** 完整示例通过同一 schema；不存在多份手写分叉类型；核心包不依赖 Electron/Fastify/SQLite/Node-only 类型；版本变更、未知 major、未知字段与金额校验有实际测试；依赖方只使用公开 exports。

**交接：** 协议版本/tag、fixture 清单、ports 使用示例。后续公共契约变更继续由本任务所有者处理；不得让 T04–T15 各自改 DTO。

### T03 — 技术可行性实验

**所有权：** tooling/spikes/、docs/spikes/。可独立运行，不触碰产品实现。

**工作：**

- 实测本机 Codex 可用接入方式、版本、启动/事件/输入/审批/取消/续流/用量和认证边界。
- 验证 Desktop 独立 Daemon 启动、单实例、重连、退出、升级与活动进程策略。
- 验证三平台进程树与 Git worktree 异常恢复；当前无法访问的平台记录未测，由 CI/对应环境补证据。
- 验证 SQLite 原子状态+事件，以及输出背压关键方案。

**验收：** 每项有可重复命令或 fixture、环境版本、预期/实际结果、限制；形成能力矩阵。无法恢复/不支持 pause 等必须明确，不伪造支持。试验仅使用临时示例仓库和授权的 Runtime 身份。

**交接：** T05/T06/T07/T11/T15 可引用的证据与推荐接入方案；需要改变共享契约时交回 T00/T02。

### T04 — SQLite、事务和 Event Store

**所有权：** packages/database/ 全部 schema/repository/migration；packages/events/src/store/、outbox/、subscriptions/ 及各自测试。公共 contracts 只读。

**工作：**

- 将 T02 ports 映射到 SQLite/Drizzle，补足 node instances、timers、handles、command receipts、staging/output binding、approval、budget/resource 记录。
- UoW、CAS、唯一活动 Run 约束、attempt 分配、迁移锁、备份、forward migration。
- 状态/Event/Outbox 同事务，Inbox 去重；stream sequence 与 ingestion cursor 分开。
- 先持久化再发布，保留/缺口/失败重试与恢复查询；不得用 Event replay 重新执行副作用。

**验收：** 空库迁移、升级失败备份恢复、事务回滚无半状态；重复消息/并发启动不重复 Run；重启后命令收据/Timer/Handle 可读取；SSE 补拉所需顺序与筛选查询可验证。所有表/JSON 载体在存储矩阵中有解释。

**集成依赖：** T02。业务模块需要新表必须提交存储请求，由本任务生成迁移，避免多个 agent 争抢 migration 编号。

### T05 — Mock Runtime 与 Local Node Host

**所有权：** runtimes/mock/、packages/runtime-sdk/；包含 Host、Mock Node、Runtime contract suite。不写 Workflow 业务状态或具体 Codex 进程启动。

**工作：** Host 使用 Node/Runtime ports，生成 node-aware binding，管理 operation/Handle、有效执行权、事件翻译入口和恢复；提供成功、失败、等待输入、超时、取消、重复事件、缺口、容量不足、失联和 lease 过期场景。

**验收：** 同 operation start 得到同 Handle；不同 payload 同 key 冲突；输出与终态不丢失；旧 fencing 结果只能审计；lease 过期后仍有受限的 inspect/安全终止路径；未知进程状态不触发盲目重跑。

**集成依赖：** T04 的 Handle/receipt 持久化、T07 的权限、T06 的资源/工作区接口。可先用 fake 实现，但最终必须验证 Host 重启及丢失响应窗口，不能只测同一内存实例。

### T06 — Workspace、Git 和共享进程控制

**所有权：** packages/workspace/、packages/process/（或 T01 确认的等价唯一目录）及包内平台测试。

**工作：**

- 受管目录绑定、一次性选择授权、WorkspaceBinding/Instance/Snapshot、固定 Git baseline。
- 每 Run 独立 worktree、并发锁、branch 命名、diff/patch/commit 引用、保留/清理。
- 路径 normalization、realpath/symlink/junction 越界、Windows 大小写/盘符/空格/非 ASCII。
- argv 进程启动、最小环境、stdout/stderr 流、进程 identity、graceful/force 取消、超时、完整子进程树；PTY 仅在能力验证需要时实现。
- 提供 patch application/integration worktree 原语，由 T14 决定业务整合顺序。

**验收：** 两个并发 Run 不共享可写目录；不污染用户脏工作区/主分支；取消不误杀其他进程；异常退出可对账；required Artifact 未持久化不得清理。路径及进程测试三平台覆盖，未运行平台明确标记。

**集成依赖：** T07 grants、T08 产物持久化确认。禁止实现自动 push 或在本任务内部决定审批通过。

### T07 — Policy、Credential Broker 与脱敏

**所有权：** packages/policy/、packages/observability/。不拥有 Approval 状态机或 Workflow。

**工作：** allow/deny/require_approval、规范化动作 digest、最小 grant、权限版本/有效期校验、OS 凭据存储适配、最小注入、日志/raw/Event/诊断统一脱敏；实现已探测能力对应的 enforcement mapping。

**验收：** 未授权路径/命令/凭据操作被拒绝；改变参数或 Artifact 版本不能复用旧批准；敏感值不进入快照/日志，包含跨输出分块测试；Runtime 无法实施必需限制时拒绝启动；不把“能力声明”当作“权限已执行”。

**集成依赖：** T04 元数据持久化、T05/T06/T15 执行点、T09 的批准结果。预算值与决定使用 T02 契约；本任务不独立维护第二套预算账本。

### T08 — Artifact Store 与 Evaluation

**所有权：** packages/artifacts/（storage/registration/lineage/evaluation 子目录）。数据库实现与迁移仍归 T04。

**工作：** staging → hash/size/schema verify → available；不可变 ArtifactVersion、output slot、固定版本 lineage、内容受控读取、隔离/quarantine、保留及导出；规则/schema/test evaluator 与测试证据 Artifact。

**验收：** 内容落盘后崩溃可恢复且不重复 available；篡改内容被隔离；不符合 required output 的结果不能验收；新版本不继承旧 pass；读取/审批固定版本；测试命令通过 Process/Policy ports，不能另开不受管 shell。

**集成依赖：** T04、T06、T07。Evaluation 只报告 verdict/证据，Task 完成决策交给 T09；不直接修改 Workflow 表。

### T09 — Workflow、调度、审批与预算用例

**所有权：** packages/workflow-engine/；packages/application/src/use-cases/ 中 projects、tasks、runs、approvals、budgets、recovery 等核心目录。明确排除 planning/ 与 delivery/，归 T14。

**工作：**

- 四类节点、DAG/绑定校验、条件 skip/join、依赖与就绪队列。
- Task/Run/Workflow/Project 分层状态、CAS、启动命令/Outbox、单活动 Run、Local Node 容量分配。
- retry/backoff/timer、有限 rework generation、pause/cancel/timeout、restart reconcile。
- Approval 的四类 gate（计划、产物、动作、预算）、一次性决策/消费、拒绝/要求修改/到期、接管状态。
- 预算预留、usage 去重与结算、资源释放；审批提高预算应产生新授权版本。

**验收：** 合法/非法状态矩阵通过；并行结果乱序不改变最终判定；重复 start/approve/cancel 不重复副作用；容量等待不消耗失败次数；未知状态不并发重跑；未通过 Artifact/Evaluation/Approval 不能完成 Task；取消收敛前保持中间状态；Reviewer 无循环等待。

**集成依赖：** T04–T08。可先基于 fake ports 完成状态机，但真实持久化、Mock Host、取消和恢复通过后才验收。不得直接 spawn Codex 或访问具体数据库表。

### T10 — Daemon API、鉴权与 typed client

**所有权：** apps/daemon/；packages/desktop-client/。composition root 接线由本任务单独维护。

**工作：** loopback 随机端口、受保护 bootstrap、stable principal/session token 分离、Host/Origin 检查、API version、health/readiness、commands/queries、ETag/CAS、持久幂等、统一错误、SSE/high-water mark/expiry/backpressure；实现 T02 能力矩阵中的 endpoint。

**验收：** API handlers 只调用用例；无任意路径/命令能力；重连换 token 后重放同命令仍返回同结果；相同 key 不同 payload 冲突；过期 cursor 触发快照重建；未知成本与 unsupported capability 正确透传；查询与 UI 所用 DTO 一致。

**集成依赖：** T04/T09/T14；T11 handshake。先用 application fake 可开发 HTTP 契约，业务完成验收必须连真实用例。Artifact 传输由服务 resolver 控制，敏感 token 不进入 URL。

### T11 — Electron 进程边界与 UI 外壳

**所有权：** apps/desktop/src/main/、preload/、renderer/app/、renderer/routes/、renderer/components/、packages/ui/；desktop main/preload/app 层测试。排除 renderer/features/。

**工作：** 独立 Daemon 生命周期、单实例与版本握手、短期凭据代理、Main 转发 REST/SSE、白名单 typed preload；应用导航、页面注册约定、设计 tokens、共享错误/加载/离线展示；目录选择授权交给 Workspace 服务。

**验收：** Renderer nodeIntegration 关闭/contextIsolation 开启，无直接 fs/child_process/secret；任意 IPC 被拒绝；关窗不杀后台允许继续的 Run；重启重连无重复订阅；旧 Daemon/新 Desktop 版本不兼容时给出可恢复错误。

**集成依赖：** T10 与 T03。T12/T13 只输出约定 feature entry，由本任务注册路由，避免多人编辑路由表。与 T17 约定 updater 子目录/打包生命周期交接时间。

### T12 — Project、Task 与 Team 页面

**所有权：** apps/desktop/src/renderer/features/projects/、tasks/、teams/ 及各自测试。不改 app shell、路由表、通用 UI 或 API schema。

**工作：** 项目列表/创建/详情；配置 Workspace、预设 Team、Runtime、预算后启动规划；Plan 版本确认；Task DAG/列表、依赖/验收条件/历史 Run；M3 只读预设 Team/Worker 版本。按能力矩阵接入编辑、暂停、取消、重试等实际支持动作。自定义 Team 写面归 T19，不在本卡实现画布。

**验收：** 使用同一 typed client 与 fixture；创建失败不丢表单；412 保留用户输入并提示刷新；规划未批准不启动 Developer；Task 与 Run 状态不混用；只能点击合法状态动作，后端仍执行最终验证。

**集成依赖：** T10/T11/T14。可先使用 typed fake client 构建功能组件；合并时由 T11 接路由，不另造协议或本地状态“假成功”。

### T13 — Run、Artifact、Approval 与诊断页面

**所有权：** renderer/features/runs/、artifacts/、approvals/、nodes/、settings/、dashboard/ 及各自测试。若后续分成两个 agent，按 runs/artifacts/approvals 与 nodes/settings/dashboard 两组分开，不共改文件。

**工作：** Run 时间线/日志/用量/控制；固定版本 diff 与 Evaluation；有参数/目标/版本/权限/到期的审批卡；接管进度；Local Node 与 Runtime 检测；必要设置及待处理工作台。

**验收：** 重复 Event 不重复行/弹窗/费用；断流补拉后顺序稳定；取消 202 不展示已终止；未知恢复状态不显示失败或开放危险重跑；不支持 pause/input 的 Runtime 不展示可用操作；未知成本不是 0；远程占位不能伪造在线节点。

**集成依赖：** T10/T11、T08/T09 的真实数据。首切片优先控制台、审批、产物、本机诊断，复杂统计后做，但任务完整完成必须覆盖冻结的 V0.1 页面范围。

### T14 — 规划、软件开发模板与最终代码交付

**所有权：** templates/software-development-team/；packages/application/src/use-cases/planning/、delivery/ 及相关包内测试。不修改 workflow-engine 或通用 Workspace 原语。

**工作：**

- 版本化 Planner/Developer/Reviewer 模板、输入输出、命令引用与默认 Policy。
- Plan Artifact schema 校验后的确认用例，有限 DAG 发布/实例化；首切片固定 Mock Plan，最终接入真实 Planner。
- 防无界拆分（深度/任务数/权限/预算）、父子 Task 完成规则、计划更新审批。
- 固定基线、依赖输入传播、并行 patch/commit 汇总、integration worktree、冲突人工处理。
- 整合结果重新测试、Review 与人工验收绑定相同 digest；导出最终 bundle/report；按 T00 定义处理合回目标分支。

**验收：** 用户未批准 Plan 不执行开发图；重复批准不重复实例化；多 Task 成果能形成一个实际可检查结果；冲突不静默覆盖；重整合后旧审批失效；原用户分支保持在显式授权范围内；报告可追溯每个 Run、代码版本和测试证据。

**集成依赖：** T06/T08/T09。禁止在本任务实现第二套 Scheduler、绕过 Task/Run 直接调用 Runtime，或自动 push/创建 PR。

### T15 — Codex Adapter

**所有权：** runtimes/codex/ 及内部 fixtures/tests。不改 Runtime SPI、Workspace/Process 或 Workflow 的公共契约。

**输入：** T03 实测选定的接入模式与能力矩阵；T02 SPI。

**工作：** detect/validate/auth-reference、版本协商、start/stream/input/cancel/inspect/reconcile、namespaced raw translation、Artifact proposal、usage；通过 T06 进程端口和 T07 权限/脱敏执行。

**验收：** Runtime contract suite 通过；真实安全示例仓库可执行、取消后无遗留失控进程；unsupported 能力如实返回；首批事件不丢、重复 start 不重启；Daemon 中断后按受测恢复边界处理；环境版本与实际 live 结果有记录。

**集成依赖：** T05/T06/T07。真实模型/账号测试单独标记，不阻塞普通 Mock PR；但未做 live 测试不能宣布 Codex 集成完成。不把实验中推测的 CLI 参数写成正式支持。

### T16 — 集成、恢复与端到端验收

**所有权：** tests/contract/、integration/、e2e/、platform/ 及统一验收报告；不拥有其他包源码。需要改 composition root 时，先由 T10 修改，或明确短期移交后再改。

**工作：** 从 T02 起编写跨模块场景；依次接通 M3 Mock、M4 Codex、M5 治理全链路。缺陷发回相应模块所有者，不能在测试中绕过生产逻辑。

**必须覆盖：**

1. 创建项目 → Plan → 确认 → 两个隔离开发 Run → 汇总 → 测试/Review → 人工验收 → 导出。
2. 同一次启动丢失响应、重连后重试；同一审批重复点击、冲突决定、到期与参数变更。
3. 数据库事务中断、启动后未记 Handle、Artifact 写盘后未记元数据、未决 Timer/预算恢复。
4. 运行中取消、超时、进程 identity 不符、未知进程、lease 失效；不重复启动、不误杀。
5. Runtime 成功但缺产物/测试失败；返工次数耗尽；Reviewer 不等待自己才能完成的上游。
6. 事件重复/乱序/缺口、晚到、cursor expiry、快照/订阅竞争、慢消费者。
7. worktree 冲突、脏用户仓库、路径越界、secret 跨分块、未授权动作。
8. 接管期间不双写，人工结果重新注册/验收；审批绑定最终整合版本。

**验收：** 相关 lint/typecheck/build 与 unit/contract/integration/E2E 实际成功；报告清楚区分 Mock/live/平台覆盖；没有未修复的核心数据一致性、安全或恢复问题。首次集成通过后，重复测试应由新变更/失败/未解决风险驱动，避免无意义全量反复运行。

### T17 — 跨平台打包、升级与发布准备

**所有权：** tooling/release/、release CI、apps/desktop 的打包配置/resources 与经 T11 移交的 updater 目录、docs/operations/。根 lockfile 和共享 CI 变更由协调者汇总。

**工作：** Windows/macOS/Linux 打包、随应用分发 Daemon/运行依赖、平台路径/权限、日志和诊断导出、升级前活动 Run 策略、数据库备份/恢复、卸载数据保留与已知限制；签名/公证按可用凭据验证。

**验收：** 各目标实际安装启动、临时 Git Mock 流程、后台继续/重连、升级失败恢复、卸载/数据保留验证；至少一台 Windows/macOS/Linux 完成 V0.1 主流程的要求有证据；未取得签名证书或未测架构必须明确标记，不能算发布完成。

**外部动作：** 创建 Release 草稿/上传/正式发布/推送代码仅在用户后续授权范围内进行。本清单不构成自动对外发布授权。

### T18 — 可视化工作流画布

**目标：** 兑现 D15：用户能在项目循环里用画布为该项目编排、发布有限 DAG（不是独立工作流 IDE）。

**所有权：** `apps/desktop/src/renderer/features/workflows/` 及包内测试。不改 protocol、daemon composition、workflow-engine 或路由表。已接通的只读目录（`GET /workflows`）保留为列表/详情过渡面。

**工作：**

- 工作流列表与详情保留只读目录切片；增加「新建 / 在画布中编辑」。
- 画布编辑未发布 `WorkflowVersion`（nodes/edges）；保存走矩阵写接口；发布产生不可变版本。
- 空态、未发布「Runtime 不会执行此图」、发布失败保留画布内容。
- 不得在画布上改活动执行图；确认计划后的执行 `WorkflowVersion` 仍按 D02 冻结。
- 公共 DTO/endpoint 缺口提交 T02/T10/T09，不在 renderer 发明第二套图协议。

**验收：** 使用 typed client；未实现写接口时按钮不可假成功。写接口就绪后：新建 → 保存草稿 → 发布 → 列表可见新版本；未发布图不能被 `:start` / Runtime 执行。有限 DAG 非法边/循环被拒绝。headed 未跑不得宣称画布可用。

**集成依赖：** T02 图 DTO、T09 发布校验、T10 写 API、T11 路由（已有 workflows slot 则可复用）。可先用 fake client 画 UI，合并时接真实 endpoint。

### T19 — 自定义 Team 编排

**目标：** 兑现 D16：用户能围着 Project 创建并发布自定义 TeamVersion 并绑定到该项目（不是独立员工目录）。

**所有权：** `apps/desktop/src/renderer/features/teams/` 可写切片及测试。领取前确认 T12 不再改同一文件。不改 protocol / daemon composition。

**工作：**

- 保留预设 Software Development Team 只读卡。
- 新建 Team 草稿、编辑成员（role + RuntimeProfile + quantity）、发布不可变 TeamVersion。
- 项目 draft 可绑定已发布自定义 Team；未发布草稿不能 `:start-planning`。
- 空态与 412 保留输入；无写接口时不渲染可点击成功态。

**验收：** typed client；发布后 `GET /teams` 可见；Project 绑定精确 `TeamVersion`。不引入 Marketplace，不把 Worker 标成固定节点。未实现不得写成已完成。

**集成依赖：** T02 TeamVersion 写 DTO、T10 写 API、T12/T14 预设模板并存。

### T20 — 对话式工作流编排

**目标：** 兑现 D17：用户能通过对话让 Agent **生成**可编辑的 Workflow / 角色 / 任务草稿（高度可定制的作者路径），再交给 D15 画布编辑与发布。不是独立聊天产品，也不是 Runtime。

**所有权：** `apps/desktop/src/renderer/features/workflow-authoring/` 及包内测试。不改 protocol、daemon composition、workflow-engine、路由表或 T18 画布文件。会话 / 草稿 DTO 缺口提交 T02。

**工作：**

- 「工作流」入口增加对话生成：用户描述 bot/角色、流程 X、任务 Y；Agent 产出未发布草稿。
- 生成后必须能跳到 T18 画布或结构化编辑；禁止一次生成即锁定。
- 落草稿复用矩阵已列的 M7 workflow（及可选 Team）写接口；**不发明**未冻结 chat endpoint。
- 写接口或会话协议未就绪时，入口不得假成功。
- 空意图、生成失败、校验失败保留对话上下文，不回退夹具冒充已生成。
- 对话回复不得写成 Task/Run 完成。

**验收：** typed client；未实现时无成功态按钮。协议就绪后：对话 → 草稿可见 → 画布可改 → 发布后 Runtime 仍只执行已发布版本。headed 未跑不得宣称对话编排可用。不得把 Mock 聊天冒充已实现。

**集成依赖：** T02 会话/草稿契约、T18 画布、T10 写 API、T19 若生成 Team 草稿。可先用 fake 画 UI，合并时接真实 endpoint。

### T21 — 双执行模式

**目标：** 兑现 D18：每个 bot/Agent 做事时可选择 **跟随已发布工作流** 或 **直接执行**；两者皆一等，靠 capability probe 诚实显隐。

**所有权：** 启动/探测相关 Application 接线说明与 `renderer` 中不与 T13/T19 重叠的执行模式切片（领取时锁定精确文件）。不改 protocol / daemon composition / 路由表。`executionMode`（或 T02 所定等价字段）归 T02；调度归 T09；HTTP 归 T10。

**工作：**

- UI 在 Agent / Task / 启动面展示两种模式；无 probe 则 disabled 并说明。
- workflow-bound：只执行已确认 `WorkflowVersion` 中轮到的节点。
- direct：即席执行当前目标，仍走 Policy、Workspace、预算、Approval；不是 Renderer 直接 spawn。
- 模式写入新 Run 的可审计字段；重试新 Run，不改旧 Run。
- T02 未冻结字段前不发明 `/runs/{id}:direct`，不渲染假 mode。

**验收：** 无能力组合启动被拒绝（`unsupported_capability` 或等价已冻结错误）。有能力时两种模式都可被选且可在 Run 上读回。不得用 Mock 成功宣称真实 Codex 已验证 direct。headed 未跑不得宣称桌面模式选择可用。

**集成依赖：** T02 字段、T09 调度、T10 API、T07 Policy、T05/T15 probe。M7 作者面不是本卡硬依赖，但 workflow-bound 仍要求已发布执行图（现有 M3 路径即可）。

## 5. 实际并行领取建议

### 第 0 批：澄清与降低不确定性

- T00：整理共享决策。
- T01：工程骨架，仅做不依赖业务字段的基础设施。
- T03：隔离实验。

三者文件范围独立；T00 负责最终架构决定，实验结果不能直接改协议。

### 第 1 批：协议交接

先完成 T02 的最小完整闭环契约。不要在 DTO/状态尚未冻结时把持久化、Workflow、API 和 UI 一起交给不同 agent 自由设计。

T02 不必一次冻结所有远期协议；M3 必需字段和所有消费者使用的公共 ports 必须稳定。后续扩展按兼容变更处理。

### 第 2 批：并行开发主体

如果只有 4 个执行 agent，建议首轮领取 T04、T05、T06、T11；空出后继续 T07、T08、T09、T10；再完成 T12–T15。不是要求前四项全部完成才启动下一项，满足契约与文件边界即可接续。

如果有更多 agent，T07/T08/T09/T10/T12/T13/T14 可基于 fake ports 同时推进；所有 fake 都遵循 T02 fixture，必须有真实集成出口，不能把 Mock 验收当发布验收。

### 第 3 批：集成与发布

T16 从早期维护场景，在模块可用时逐个接通。先 M3 再真实 Codex，再 T17。M7（T18/T19/T20）在 M3 只读面稳定且 T02 写出接口后领取，不塞进 M3/M4 随机 PR。M8（T21）在 T02 冻结执行 mode 字段后领取。最终接线、迁移顺序和主分支验收由一个协调者控制。

## 6. 避免冲突的硬规则

| 共享资源 | 唯一写入负责人 |
|---|---|
| 协议/公共 DTO/Domain 类型/ports | T02 |
| 根 package.json、lockfile、公共工具配置 | T01 或明确移交后的协调者 |
| 所有数据库 migration/schema | T04 |
| Daemon composition root | T10，联调时可明确移交 T16 |
| Electron preload、路由、共享 UI | T11 |
| Workflow 与业务状态转换 | T09 |
| planning/delivery 业务编排 | T14，调用 T09 公共用例 |
| 工作流画布 UI | T18；图协议归 T02，发布校验归 T09，HTTP 归 T10 |
| 自定义 Team 写 UI | T19；TeamVersion 契约归 T02，HTTP 归 T10 |
| 对话生成工作流 UI | T20；会话/草稿契约归 T02，落草稿复用 M7 写接口，画布仍归 T18 |
| 双执行模式 | T21；mode 字段归 T02，调度归 T09，HTTP 归 T10 |
| Release/打包配置 | T17，避免与 T11 同时编辑生命周期文件 |

- 每个 agent 一个分支/独立 worktree；不要让多个 agent 共用同一可写 checkout。
- 分支建议使用 task/t04-persistence 一类名字；按任务领取锁定 commit 基线。
- 公共变更先单独提交并让依赖者同步，不在多个 feature 分支重复手改。
- 不回退他人改动。发现目标文件已有变更，先检查归属，再调整实现。
- 模块单测与契约测试由实现者完成；跨模块测试归 T16。
- 不把未通过测试、未运行的真实 Runtime、未验证的平台写成“完成”。

## 7. 可直接复制给开发 agent 的模板

~~~text
请完成 Workforce 开发任务 <Txx：标题>。

先读取：
1. README.md 与适用 AGENTS.md
2. docs/planning/01-design-review.md
3. docs/planning/02-development-task-backlog.md 中 Txx 的完整任务卡
4. docs/planning/decision-register.md、state-matrix.md、api-capability-matrix.md、communication-history.md
5. 本任务引用的蓝图和已冻结协议

工作基线：<commit/branch>
允许修改：<任务卡目录 + 经协调者确认的准确文件范围>
禁止修改：公共 DTO/ports、数据库 migration、根 lockfile、其他 agent 的文件，除非本任务明确拥有它们。

你不是唯一工作者。不要回退他人的改动；使用自己的分支/worktree，并适应已合入的契约。
按任务卡完成实现与验收，不扩展远程节点/云端等范围。
若公共契约不足，先提出具体字段/签名/理由/兼容性影响，由相应所有者处理，不复制一套类型。
不要在未确认停止旧执行的情况下重新启动具有副作用的 Run。
不要发送消息、创建外部资源、push 或发布，除非此次任务明确授权。

交付：
- 改动文件与 commit
- 实现行为与满足的验收项
- 实际运行的命令、结果、环境/版本
- 未验证的平台/能力、已知限制、阻塞依赖
- 交给下一个任务的接口/fixture/接线说明
~~~

上述新增决策文档由 T00 创建；在它们不存在或关键决策仍未冻结时，下游任务不得声称已满足前置条件。可以先推进自己的测试场景/纯组件/独立实验。
