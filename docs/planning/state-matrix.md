# V0.1 状态矩阵

日期：2026-09-10  
状态：**已冻结（M0–M3）**  
权威：[decision-register.md](decision-register.md) D02/D03/D09/D13。  
未列出的转换一律非法，返回对应 `*_INVALID_TRANSITION`。状态写入必须带 `expectedStateRevision` / `If-Match`。

中间子状态（取消中、对账中、孤儿）**不是**新的主状态枚举，记在 operation/recovery 记录与 `cancelRequestedAt` / `lastTrustedFact`。

事务：状态行 + Event + Outbox 同提交。外部进程/文件 I/O 在事务外。

## 1. 枚举

### ProjectStatus

`draft | planning | ready | running | paused | completed | failed | cancelled | archived`

`archived` 为 V0.1 后置命令；首版 UI 可不提供按钮，API 可暂不实现。

### WorkflowInstanceStatus

`created | validating | ready | running | waiting | paused | cancelling | completed | failed | cancelled`

### NodeInstanceStatus

`pending | blocked | ready | active | waiting | completed | failed | skipped | cancelled`

### TaskStatus

`draft | blocked | ready | queued | running | waiting_review | completed | failed | cancelled`

### RunStatus

`pending | starting | running | waiting_input | paused | succeeded | failed | timed_out | cancelled`

### ApprovalStatus

`pending | approved | rejected | changes_requested | expired | consumed | superseded | cancelled`

### ArtifactVersionStatus

`staging | available | quarantined | archived`

### CommandReceiptStatus

`pending | committed | failed`

## 2. Project

| 当前 | 命令/事实 | 守卫 | 下一状态 | Event | 事务内 | 非法时 |
|---|---|---|---|---|---|---|
| — | `project.create` | 名称非空 | `draft` | `project.created` | 插入 Project | 校验错误 |
| `draft` | `workspace.bind` + team/runtime/budget 齐备 | 本机路径一次性授权、预设 Team 存在、Runtime 可探测或允许 Mock | `planning` | `project.planning_started` | 更新配置快照 | 缺配置 |
| `planning` | Plan Artifact available + `approval.approve` (gate=plan) | 精确 Plan 版本、digest 未变、审批未过期 | `ready` | `project.plan_confirmed`；发布 WorkflowVersion | 审批消费 + 版本发布 | 未批准不得 start 开发图 |
| `ready` | `workflow.start` | 无活动 WorkflowInstance | `running` | `workflow.started` | 创建实例 | 已有活动实例 |
| `running` | 必需终点完成且最终 artifact 审批通过 | 同一 content digest | `completed` | `project.completed` | 收尾 | 缺产物不能完成 |
| `running` | `project.pause` | Policy 允许 | `paused` | `project.paused` | 停新调度 | 不自动杀进程 |
| `paused` | `project.resume` | 阻塞解除 | `running` | `project.resumed` | — | — |
| 非终态 | `project.cancel` | — | 先 `cancelling` 于 workflow，再 Project `cancelled` | `project.cancel_requested` / `project.cancelled` | 取消请求 | `202` 不表示已取消 |
| `draft`/`ready` | `project.cancel` | 无活动 Run | `cancelled` | `project.cancelled` | — | — |
| 非 `archived` | `project.archive` | 后置；无活动 Run | `archived` | `project.archived` | — | M3 可不实现 |

`planning` 期间 Planner Run 失败：Project 保持 `planning`，允许重试 Planner 或取消。不得直接进入开发 DAG。

## 3. WorkflowInstance

沿用蓝图 `08 §5`，补充计划发布：

| 当前 | 命令/事实 | 守卫 | 下一状态 | 主要副作用 |
|---|---|---|---|---|
| — | Plan 确认后 `workflow.publish+instantiate` | Plan 版本已批准 | `created` | 冻结 WorkflowVersion、Policy、Budget 快照 |
| `created` | `validate` | 版本存在 | `validating` | DAG/绑定/权限/预算校验 |
| `validating` | 通过 | — | `ready` | 创建 NodeInstance generation=1 |
| `validating` | 失败 | — | `failed` | 结构化失败 |
| `ready` | `start` | Project 可运行 | `running` | 入口节点 eligible |
| `running` | 无可立即运行节点 | 存在非终态等待 | `waiting` | 下一唤醒时间 |
| `waiting` | 依赖/审批/timer | 节点 eligible | `running` | 入队 |
| `running`/`waiting` | `pause` | Policy | `paused` | 停新调度 |
| `paused` | `resume` | — | `running` | reconcile |
| 非终态 | `cancel` | — | `cancelling` | 对活动 Run 发取消 |
| `cancelling` | 子级全部终态 | 无活动 Run | `cancelled` | 保留 Workspace/Artifact |
| `running`/`waiting` | 必需终点成功 | — | `completed` | — |
| `running`/`waiting` | 不可恢复失败 | recovery exhausted | `failed` | — |

修改命令使用 `expectedStateRevision`。

## 4. Task

| 当前 | 命令/事实 | 守卫 | 下一状态 | 说明 |
|---|---|---|---|---|
| — | 由 Node 实例化 | 执行图已发布 | `draft` 或直接 `blocked`/`ready` | Planner Task 在 Project.planning 期间创建 |
| `draft` | 定义完整、依赖未满足 | — | `blocked` | — |
| `draft`/`blocked` | 依赖 outputs_ready 且输入绑定完整 | — | `ready` | 不等待上游 Task completed |
| `ready` | `queue` / 调度器 | 容量、预算、Policy | `queued` | Outbox start command |
| `queued` | Dispatcher 取走 | 单活动 Run | `running` | 创建 Run pending |
| `running` | Run 终态 succeeded | required outputs 未齐或 criteria 未过 | `waiting_review` 或保持 `running` 直到 outputs 注册 | 由 Evaluation 决定是否进入 waiting_review |
| `running` | Run succeeded + 自动 criteria 全过且无需人工 gate | — | `completed` | Developer 典型路径：产物就绪即可完成 |
| `running` | Run failed/timed_out | attempt < maxAttempts | `ready` | 新 attempt，同一 definitionRevision |
| `running` | Run failed 且 attempts 耗尽 | — | `failed` | — |
| `running`/`queued` | `cancel` | — | 取消收敛后 `cancelled` | 先请求 Run 取消 |
| `waiting_review` | `approval.approve` (artifact/plan) | digest 匹配 | `completed` | 一次性消费 |
| `waiting_review` | `request-changes` | rework < max | `ready` | generation+1，新 definitionRevision |
| `waiting_review` | reject 或 rework 耗尽 | — | `failed` | — |
| `completed` | 任何重开 | — | 非法 | 只能建 follow-up Task |

Reviewer Task 的输入是固定 ArtifactVersion，完成条件是 Evaluation + 自己的 outputs，不回指 Developer.completed。

## 5. Run

| 当前 | 命令/事实 | 守卫 | 下一状态 | 说明 |
|---|---|---|---|---|
| — | `run.start` | starting 前 node/runtime/workspace 已分配；幂等键未冲突 | `pending` | 写 receipt pending + Outbox |
| `pending` | Host 开始 spawn | Handle 将写入 | `starting` | 崩溃窗口 1 |
| `starting` | Handle 已提交且进程附着 | 进程 identity 匹配 | `running` | 崩溃窗口 2：无 Handle 则 reconcile，不重开第二个活动 Run |
| `running` | Adapter waiting_input | 能力支持 | `waiting_input` | 输入带 operationId |
| `waiting_input` | `run.input` | Policy | `running` | — |
| `running` | `pause` | capability `lifecycle.pause` | `paused` | 不支持则拒绝，UI 不展示 |
| `paused` | `resume` | — | `running` | — |
| `running` | Runtime completed | 平台记录终态 | `succeeded` | 即使缺 Artifact 也保持 succeeded |
| `running` | Runtime failed | — | `failed` | — |
| `running` | deadline | — | `timed_out` | 随后取消进程树 |
| 非终态 | `cancel` 已接受 | — | 保持当前主状态 + cancelRequested | UI 显示「正在取消」 |
| 取消完成 | 进程树终止且 Handle 对账 | — | `cancelled` | — |

同一 Task 同时最多一个非终态 Run。重复 start：同 key 同 payload 返回原 Run；不同 payload 冲突。

lease 过期：fencing 拒绝迟到 `succeeded`；提供 inspect/安全 terminate；不自动 start 新 Run。

## 6. Approval

| 当前 | 命令/事实 | 守卫 | 下一状态 | 说明 |
|---|---|---|---|---|
| — | 创建 gate | 冻结 action digest + 资源版本 | `pending` | — |
| `pending` | `approve` | digest/版本/权限/expiry 未变 | `approved` 然后 `consumed` | 一次性 |
| `pending` | `reject` | — | `rejected` | — |
| `pending` | `request-changes` | — | `changes_requested` | Task 返工 |
| `pending` | 到期 | — | `expired` | — |
| `pending` | 目标版本变化 | — | `superseded` | 必须新审批 |
| `approved` 未消费 | 参数已变 | — | `superseded` | 不得执行旧动作 |
| 任意未决 | takeover 流程开始 | 写入已停止 | 保持 pending 直到人工结果重新注册 | takeover 不是 approve |

重复点击同一 Idempotency-Key 返回原 decision。冲突决定（不同 payload 同 key）→ 409。

## 7. ArtifactVersion

| 当前 | 事实 | 守卫 | 下一 | 说明 |
|---|---|---|---|---|
| — | 内容写入 staging 目录 | 受管路径 | `staging` | 崩溃窗口 3 |
| `staging` | hash/size/schema 通过 | 元数据提交 | `available` | 不可变 |
| `staging`/`available` | hash 不匹配 | — | `quarantined` | 不得验收 |
| `available` | `archive` | 无执行引用强制 | `archived` | 不删盘 |

读取、审批、Task input 必须引用 `artifactVersionId`。新版本不继承旧 Evaluation pass。

## 8. 计数样例

Task `tsk_1`：

1. generation=1, definitionRevision=1, attempt=1, Run `run_a` failed → retry
2. generation=1, definitionRevision=1, attempt=2, Run `run_b` succeeded，缺测试 → Task `waiting_review`（若该节点需要人工）或 Evaluation fail
3. request-changes → generation=2, definitionRevision=2, attempt=1, Run `run_c`
4. `run_c` succeeded 且 criteria 通过 → Task `completed`
5. 之后只能创建 follow-up Task，不能把 `tsk_1` 改回 ready

`maxAttempts=2` 在 generation=1 已用尽；generation=2 重新计数。`maxReworkCycles=1` 时步骤 3 是最后一次质量循环。

## 9. 给 T02 的最小合法 fixture 清单

T02 必须提供并可校验：

1. `events/task.completed.json` — 完整 Event envelope
2. `commands/run.start.json` — 含 operationId、Handle 将返回的字段、node binding
3. `commands/approval.approve.plan.json` 与 `approval.approve.artifact.json`
4. `dto/task.expected-outputs.json` — 带稳定 id + kind
5. `dto/sse-cursor.json` — 不透明 cursor 与过期错误
6. `errors/idempotency-key-reused.json`、`revision-conflict.json`、`invalid-transition.json`
7. 非法：Run 状态 `waiting_review`、expectedOutputs 无 id、SSE 把 Run 迁到 waiting_review

Clock 必须可注入。金额只用 `costMinor`。
